import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { SESSION_COOKIE } from "./_core/oidcAuth";
import { systemRouter } from "./_core/systemRouter";
import { invokeLLM } from "./_core/llm";
import { adminProcedure, publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getProviderCatalog, generateListingVideo, generateModelImage, pollListingVideo, removeBackground, storeListingVideo } from "./providerAdapters";
import { CREDIT_PACKS, createCreditCheckout } from "./billing";
import { bulkDeleteUserListings, bulkUpdateUserListings, checkStoreSlugAvailability, completeUsage, createOfficeFile, createUserListing, createUserListingsBatch, deleteOfficeFile, deleteUserListing, duplicateUserListing, failUsage, getAiBulkJob, getCsvImportJob, getLatestAiBulkJob, getLatestCsvImportJob, getLaunchBonusStatus, getOfficeFile, getOfficeUsage, getProductFeedListings, getPublicBrowse, getPublicHomeListings, getPublicListing, getPublicStorefront, getSavedCsvMapping, getSellerProfile, getStorefrontBlocks, getUsageSummary, getUserListing, getUserListingFacets, getUserListingMetrics, getUserListingsForExport, getUserListingsPage, getSellerBatchPolicy, grantLaunchBonusIfEligible, setUserPlan, listOfficeFiles, markProcessingCsvJobsInterrupted, recordDeletedStorageKey, refundExpiredVideoReservations, reserveUsage, saveCsvMapping, updateOfficeFile, updateSellerProfile, updateStorefrontBlock, updateUserListing } from "./db";
import { storageDelete, storagePut } from "./storage";
import { shouldQueueDeletedStorageKey, validateOfficeUpload } from "./officePolicies";
import { CSV_FIELDS, csvErrorText, normalizeMapping, parseCsv, processCsvImport, startCsvImport, validateCsvRows, type CsvMapping } from "./csvImport";
import { appendListingImages, assertSelectedListingPhotos } from "./aiPolicies";
import { LISTING_DATA_SYSTEM_RULE } from "./aiPolicies";
import { resumeAiBulkJob, startAiBulkJob, videoChargeDecision } from "./aiJobs";
import { shouldCheckLaunchBonusAfterStatusChange } from "./launchBonus";
import { ENV } from "./_core/env";
import { assertBatchListingLimit, type SellerPlan } from "./batchUploadPolicies";

const usageFeature = z.enum(["modelImage", "listingCopy", "conditionReport", "video", "backgroundRemoveSingle", "backgroundRemoveBatch"]);
const storageImageUrl = z.string().regex(/^\/manus-storage\/[A-Za-z0-9._/-]+$/).refine((value) => !value.includes(".."), "Only Fingerprints storage URLs are allowed.");
const csvMappingInput = z.object({ title: z.array(z.string()).max(20), price: z.array(z.string()).max(20), size: z.array(z.string()).max(20), condition: z.array(z.string()).max(20), category: z.array(z.string()).max(20), sku: z.array(z.string()).max(20), description: z.array(z.string()).max(20), photoUrls: z.array(z.string()).max(20) });
const csvFilterInput = z.object({ search: z.string().max(180).optional(), status: z.enum(["live", "draft", "review"]).optional(), category: z.string().max(96).optional(), condition: z.string().max(64).optional() });
type LlmContent = string | Array<{ type?: string; text?: string }> | null | undefined;
function contentToText(content: LlmContent) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("\n").trim();
  return "";
}
export function featurePrice(feature: z.infer<typeof usageFeature>, units: number) {
  const cents = { modelImage: 89, listingCopy: 19, conditionReport: 39, video: 149, backgroundRemoveSingle: 0, backgroundRemoveBatch: 12 }[feature];
  return cents * Math.max(1, units);
}

export const appRouter = router({
  system: systemRouter,
  admin: router({
    providerSettings: adminProcedure.query(() => getProviderCatalog()),
    setPlan: adminProcedure.input(z.object({ userId: z.number().int(), plan: z.enum(["free", "basic", "plus", "pro", "ultra"]) })).mutation(({ input }) => setUserPlan(input.userId, input.plan)),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  site: router({
    config: publicProcedure.query(() => ({ businessAbn: ENV.businessAbn, publicSiteUrl: ENV.publicSiteUrl })),
  }),
  profile: router({
    me: protectedProcedure.query(({ ctx }) => getSellerProfile(ctx.user.id)),
    checkSlug: protectedProcedure.input(z.object({ slug: z.string().min(1).max(120) })).query(({ ctx, input }) => checkStoreSlugAvailability(input.slug, ctx.user.id)),
    uploadPhoto: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(180), contentType: z.string().startsWith("image/"), data: z.string().min(1).max(28_000_000) })).mutation(async ({ ctx, input }) => {
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
      const stored = await storagePut(`users/${ctx.user.id}/profile/${Date.now()}-${safeName}`, Buffer.from(input.data, "base64"), input.contentType);
      return { url: stored.url, key: stored.key };
    }),
    update: protectedProcedure.input(z.object({ displayName: z.string().trim().min(1).max(160), bio: z.string().max(1000).nullable(), suburb: z.string().max(120).nullable(), state: z.string().max(64).nullable(), profileImageUrl: storageImageUrl.nullable().optional(), storeSlug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/), showInCatalog: z.boolean().default(true) })).mutation(({ ctx, input }) => updateSellerProfile(ctx.user.id, input)),
  }),
  launchBonus: router({
    status: protectedProcedure.query(({ ctx }) => getLaunchBonusStatus(ctx.user.id)),
  }),
  product: router({
    catalog: publicProcedure.query(() => ({
      creditPacks: CREDIT_PACKS,
      pricing: {
        modelImage: { label: "Model images", options: [{ id: "standard", label: "Standard" }, { id: "pro", label: "Pro quality" }], priceCents: featurePrice("modelImage", 1), firstTwoFree: true },
        listingCopy: { label: "AI listing write-up", priceCents: featurePrice("listingCopy", 1), firstTwoFree: true },
        conditionReport: { label: "Condition report", priceCents: featurePrice("conditionReport", 1), firstTwoFree: true },
        video: { label: "Video generation", priceCents: featurePrice("video", 1), firstTwoFree: true },
        backgroundRemove: { label: "Single background removal", priceCents: 0, firstOneFree: true },
        backgroundRemoveBatch: { label: "Batch background removal", priceCents: featurePrice("backgroundRemoveBatch", 1), firstTwoFree: false },
      },
    })),
  }),
  listings: router({
    list: protectedProcedure.query(async ({ ctx }) => (await getUserListingsPage(ctx.user.id, { page: 1, pageSize: 50 })).items),
    listPage: protectedProcedure.input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(50).default(50), search: z.string().max(180).optional(), status: z.enum(["live", "draft", "review"]).optional(), category: z.string().max(96).optional(), condition: z.string().max(64).optional() })).query(({ ctx, input }) => getUserListingsPage(ctx.user.id, input)),
    facets: protectedProcedure.query(({ ctx }) => getUserListingFacets(ctx.user.id)),
    metrics: protectedProcedure.query(({ ctx }) => getUserListingMetrics(ctx.user.id)),
    uploadImage: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(180), contentType: z.string().startsWith("image/"), data: z.string().min(1).max(28_000_000) })).mutation(async ({ ctx, input }) => {
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
      const stored = await storagePut(`users/${ctx.user.id}/listings/${Date.now()}-${safeName}`, Buffer.from(input.data, "base64"), input.contentType);
      return { url: stored.url, key: stored.key };
    }),
    create: protectedProcedure.input(z.object({
      title: z.string().min(1).max(180),
      description: z.string().nullable().optional(),
      priceCents: z.number().int().min(0),
      size: z.string().max(64).nullable().optional(),
      condition: z.string().min(1).max(64),
      category: z.string().max(96).nullable().optional(),
      sku: z.string().max(96).nullable().optional(),
      status: z.enum(["live", "draft", "review"]).default("draft"),
      imageUrls: z.array(storageImageUrl).max(12).default([]),
    })).mutation(async ({ ctx, input }) => { const listing = await createUserListing({ ...input, userId: ctx.user.id, imageUrls: JSON.stringify(input.imageUrls) }); if (shouldCheckLaunchBonusAfterStatusChange(input.status)) await grantLaunchBonusIfEligible(ctx.user.id); return listing; }),
    batchPolicy: protectedProcedure.query(({ ctx }) => getSellerBatchPolicy(ctx.user.id)),
    batchCreate: protectedProcedure.input(z.object({ listings: z.array(z.object({ title: z.string().min(1).max(180), description: z.string().nullable().optional(), priceCents: z.number().int().min(0), size: z.string().max(64).nullable().optional(), condition: z.string().min(1).max(64), category: z.string().max(96).nullable().optional(), sku: z.string().max(96).nullable().optional(), status: z.enum(["live", "draft", "review"]).default("draft"), imageUrls: z.array(storageImageUrl).max(12).default([]) })).min(1).max(200) })).mutation(async ({ ctx, input }) => { const rows = input.listings.map((listing) => ({ ...listing, userId: ctx.user.id, imageUrls: JSON.stringify(listing.imageUrls) })); const created = await createUserListingsBatch(ctx.user.id, rows); if (rows.some((row) => shouldCheckLaunchBonusAfterStatusChange(row.status))) await grantLaunchBonusIfEligible(ctx.user.id); return { created: created.length }; }),
    update: protectedProcedure.input(z.object({
      id: z.number().int(),
      title: z.string().min(1).max(180).optional(),
      description: z.string().nullable().optional(),
      priceCents: z.number().int().min(0).optional(),
      size: z.string().max(64).nullable().optional(),
      condition: z.string().min(1).max(64).optional(),
      category: z.string().max(96).nullable().optional(),
      sku: z.string().max(96).nullable().optional(),
      status: z.enum(["live", "draft", "review"]).optional(),
      imageUrls: z.array(storageImageUrl).max(12).optional(),
    })).mutation(async ({ ctx, input }) => { const listing = await updateUserListing(ctx.user.id, input); if (input.status && shouldCheckLaunchBonusAfterStatusChange(input.status)) await grantLaunchBonusIfEligible(ctx.user.id); return listing; }),
    delete: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => deleteUserListing(ctx.user.id, input.id)),
    duplicate: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => duplicateUserListing(ctx.user.id, input.id)),
    bulkStatus: protectedProcedure.input(z.object({ ids: z.array(z.number().int()).min(1).max(500), status: z.enum(["live", "draft", "review"]) })).mutation(async ({ ctx, input }) => { const changed = await bulkUpdateUserListings(ctx.user.id, input.ids, input.status); if (shouldCheckLaunchBonusAfterStatusChange(input.status)) await grantLaunchBonusIfEligible(ctx.user.id); return changed; }),
    bulkDelete: protectedProcedure.input(z.object({ ids: z.array(z.number().int()).min(1).max(500) })).mutation(({ ctx, input }) => bulkDeleteUserListings(ctx.user.id, input.ids)),
  }),
  csv: router({
    savedMapping: protectedProcedure.query(({ ctx }) => getSavedCsvMapping(ctx.user.id)),
    latestJob: protectedProcedure.query(({ ctx }) => getLatestCsvImportJob(ctx.user.id)),
    resume: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => { const job = await getCsvImportJob(ctx.user.id, input.id); if (!job || !["interrupted", "queued"].includes(job.status)) throw new Error("This import cannot be resumed."); void processCsvImport(input.id, ctx.user.id).catch((error) => console.error("[CSV import] Resume failed", error)); return { success: true }; }),
    preview: protectedProcedure.input(z.object({ csvText: z.string().min(1).max(20_000_000), mapping: csvMappingInput })).mutation(async ({ ctx, input }) => {
      const parsed = parseCsv(input.csvText);
      const mapping = normalizeMapping(input.mapping as CsvMapping, parsed.headers);
      const rows = validateCsvRows(parsed.rows, mapping, await (await import("./db")).getExistingListingSkus(ctx.user.id));
      return { headers: parsed.headers, previewRows: rows.slice(0, 20), totalRows: rows.length, validRows: rows.filter((row) => row.valid).length, errorRows: rows.filter((row) => !row.valid && !row.duplicate).length, duplicateRows: rows.filter((row) => row.duplicate).length, errorCsv: csvErrorText(rows) };
    }),
    saveMapping: protectedProcedure.input(csvMappingInput).mutation(({ ctx, input }) => saveCsvMapping(ctx.user.id, input)),
    startImport: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(180), csvText: z.string().min(1).max(20_000_000), mapping: csvMappingInput })).mutation(async ({ ctx, input }) => {
      const parsed = parseCsv(input.csvText);
      const mapping = normalizeMapping(input.mapping as CsvMapping, parsed.headers);
      await saveCsvMapping(ctx.user.id, mapping);
      return startCsvImport({ userId: ctx.user.id, fileName: input.fileName, csvText: input.csvText, mapping });
    }),
    job: protectedProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) => getCsvImportJob(ctx.user.id, input.id)),
    export: protectedProcedure.input(csvFilterInput).query(async ({ ctx, input }) => {
      const rows = await getUserListingsForExport(ctx.user.id, input);
      const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const header = ["title", "price", "size", "condition", "category", "SKU", "description", "photo URLs", "status", "photo status"];
      const body = rows.map((row) => [row.title, (row.priceCents / 100).toFixed(2), row.size, row.condition, row.category, row.sku, row.description, row.imageUrls.join("|"), row.status, row.photoStatus].map(escape).join(","));
      return [header.join(","), ...body].join("\n");
    }),
  }),
  office: router({
    list: protectedProcedure.query(({ ctx }) => listOfficeFiles(ctx.user.id)),
    usage: protectedProcedure.query(({ ctx }) => getOfficeUsage(ctx.user.id)),
    get: protectedProcedure.input(z.object({ id: z.number().int() })).query(async ({ ctx, input }) => {
      const file = await getOfficeFile(ctx.user.id, input.id);
      if (!file) throw new Error("File not found.");
      return file;
    }),
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(180), fileType: z.enum(["doc", "sheet"]), snapshotJson: z.string().max(5_000_000) })).mutation(({ ctx, input }) => createOfficeFile({ ...input, userId: ctx.user.id })),
    save: protectedProcedure.input(z.object({ id: z.number().int(), name: z.string().trim().min(1).max(180).optional(), snapshotJson: z.string().max(5_000_000), sizeBytes: z.number().int().min(0) })).mutation(async ({ ctx, input }) => { const file = await updateOfficeFile(ctx.user.id, input); if (!file) throw new Error("File not found."); return file; }),
    rename: protectedProcedure.input(z.object({ id: z.number().int(), name: z.string().trim().min(1).max(180) })).mutation(async ({ ctx, input }) => { const file = await updateOfficeFile(ctx.user.id, input); if (!file) throw new Error("File not found."); return file; }),
    delete: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => { const deleted = await deleteOfficeFile(ctx.user.id, input.id); if (!deleted) throw new Error("File not found."); const storageDeleted = deleted.storageKey ? await storageDelete(deleted.storageKey) : true; if (shouldQueueDeletedStorageKey(deleted.storageKey, storageDeleted)) await recordDeletedStorageKey(ctx.user.id, deleted.storageKey!); return { success: true, cleanupQueued: shouldQueueDeletedStorageKey(deleted.storageKey, storageDeleted) }; }),
    upload: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(180), fileType: z.enum(["doc", "sheet"]), extension: z.enum(["docx", "xlsx", "csv"]), contentType: z.string().max(160), data: z.string().min(1).max(140_000_000), snapshotJson: z.string().max(5_000_000) })).mutation(async ({ ctx, input }) => { const bytes = Buffer.from(input.data, "base64"); validateOfficeUpload(input.extension, bytes); const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const stored = await storagePut(`users/${ctx.user.id}/office/${Date.now()}-${safeName}`, bytes, input.contentType); try { return await createOfficeFile({ userId: ctx.user.id, name: input.name, fileType: input.fileType, snapshotJson: input.snapshotJson, sourceKey: stored.key, sourceMimeType: input.contentType, sizeBytes: bytes.byteLength }); } catch (error) { await storageDelete(stored.key); throw error; } }),
  }),
  usage: router({
    summary: protectedProcedure.query(({ ctx }) => getUsageSummary(ctx.user.id)),
  }),
  ai: router({
    writeListing: protectedProcedure.input(z.object({ listingId: z.number().int(), notes: z.string().optional() })).mutation(async ({ ctx, input }) => {
      const listing = await getUserListing(ctx.user.id, input.listingId);
      if (!listing) throw new Error("Listing not found.");
      const reservation = await reserveUsage({ userId: ctx.user.id, feature: "listingCopy", provider: "manus-llm", units: 1, freeAllowance: 2, unitPriceCents: featurePrice("listingCopy", 1) });
      try {
        const imageContent = listing.imageUrls.slice(0, 12).map((url) => ({ type: "image_url" as const, image_url: { url, detail: "auto" as const } }));
        const response = await invokeLLM({
          messages: [
            { role: "system", content: `${LISTING_DATA_SYSTEM_RULE} You write concise, honest, high-converting resale listing copy. Return JSON only.` },
            { role: "user", content: [{ type: "text", text: `Write a listing for the real item below. Existing title: ${listing.title}. Condition: ${listing.condition}. Size: ${listing.size ?? "not provided"}. Category: ${listing.category ?? "not provided"}. Notes: ${input.notes ?? "none"}. Use only visible facts. Include useful resale tags.` }, ...imageContent] },
          ],
          response_format: { type: "json_schema", json_schema: { name: "listing_copy", strict: true, schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "description", "tags"], additionalProperties: false } } },
        });
        if (reservation.id) await completeUsage(reservation.id);
        const raw = contentToText(response.choices[0]?.message?.content);
        return { ...JSON.parse(raw), chargedCents: reservation.chargedCents, freeTrialUsed: reservation.freeUnits > 0 };
      } catch (error) {
        if (reservation.id) await failUsage(reservation.id);
        console.error("[AI write-up] Provider failure", error);
        throw new Error("Something went wrong, you haven't been charged");
      }
    }),
    applyListingCopy: protectedProcedure.input(z.object({ listingId: z.number().int(), title: z.string().min(1).max(180), description: z.string().min(1), tags: z.array(z.string()).max(20) })).mutation(({ ctx, input }) => updateUserListing(ctx.user.id, { id: input.listingId, title: input.title, description: input.description, tags: input.tags })),
    generateModelImage: protectedProcedure.input(z.object({ listingId: z.number().int(), provider: z.enum(["standard", "pro"]), prompt: z.string().min(8) })).mutation(async ({ ctx, input }) => {
      const listing = await getUserListing(ctx.user.id, input.listingId);
      if (!listing) throw new Error("Listing not found.");
      if (!listing.imageUrls[0]) throw new Error("Add a cover photo before generating a model image.");
      const internalProvider = input.provider === "standard" ? "manus" : "nano_banana";
      const reservation = await reserveUsage({ userId: ctx.user.id, feature: "modelImage", provider: internalProvider, units: 1, freeAllowance: 2, unitPriceCents: featurePrice("modelImage", 1) });
      try {
        const result = await generateModelImage({ provider: internalProvider, prompt: `${LISTING_DATA_SYSTEM_RULE}\n${input.prompt}`, originalImageUrl: listing.imageUrls[0] });
        if (result.imageUrl) await updateUserListing(ctx.user.id, { id: input.listingId, imageUrls: appendListingImages(listing.imageUrls, [result.imageUrl]) });
        if (reservation.id) await completeUsage(reservation.id);
        return { ...result, chargedCents: reservation.chargedCents, freeTrialUsed: reservation.freeUnits > 0 };
      } catch (error) {
        if (reservation.id) await failUsage(reservation.id);
        console.error("[Model image] Provider failure", error);
        throw new Error("Something went wrong, you haven't been charged");
      }
    }),
    conditionReport: protectedProcedure.input(z.object({ listingId: z.number().int(), notes: z.string().optional() })).mutation(async ({ ctx, input }) => {
      const listing = await getUserListing(ctx.user.id, input.listingId);
      if (!listing) throw new Error("Listing not found.");
      const units = 1;
      const reservation = await reserveUsage({ userId: ctx.user.id, feature: "conditionReport", provider: "manus-llm", units, freeAllowance: 2, unitPriceCents: featurePrice("conditionReport", 1) });
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: `${LISTING_DATA_SYSTEM_RULE} You are a meticulous resale condition assessor. Return one honest buyer-friendly report per item as JSON.` },
            { role: "user", content: JSON.stringify([{ name: listing.title, condition: listing.condition, size: listing.size, category: listing.category, notes: input.notes, photos: listing.imageUrls }]) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "condition_reports", strict: true, schema: { type: "object", properties: { reports: { type: "array", items: { type: "object", properties: { name: { type: "string" }, rating: { type: "string" }, summary: { type: "string" }, checks: { type: "array", items: { type: "string" } } }, required: ["name", "rating", "summary", "checks"], additionalProperties: false } } }, required: ["reports"], additionalProperties: false } } },
        });
        const report = JSON.parse(contentToText(response.choices[0]?.message?.content)).reports?.[0];
        await updateUserListing(ctx.user.id, { id: input.listingId, conditionReport: report });
        if (reservation.id) await completeUsage(reservation.id);
        return { report, chargedCents: reservation.chargedCents, freeTrialUsed: reservation.freeUnits > 0 };
      } catch (error) {
        if (reservation.id) await failUsage(reservation.id);
        console.error("[Condition report] Provider failure", error);
        throw new Error("Something went wrong, you haven't been charged");
      }
    }),
    removeBackground: protectedProcedure.input(z.object({ listingId: z.number().int(), imageUrls: z.array(storageImageUrl).min(1).max(12) })).mutation(async ({ ctx, input }) => {
      const listing = await getUserListing(ctx.user.id, input.listingId);
      if (!listing) throw new Error("Listing not found.");
      assertSelectedListingPhotos(listing.imageUrls, input.imageUrls);
      const units = input.imageUrls.length;
      const single = units === 1;
      const reservation = await reserveUsage({ userId: ctx.user.id, feature: single ? "backgroundRemoveSingle" : "backgroundRemoveBatch", provider: "clipdrop", units, freeAllowance: single ? 1 : 0, alwaysFree: single, unitPriceCents: featurePrice(single ? "backgroundRemoveSingle" : "backgroundRemoveBatch", 1) });
      try {
        const result = await removeBackground({ imageUrls: input.imageUrls });
        await updateUserListing(ctx.user.id, { id: input.listingId, imageUrls: appendListingImages(listing.imageUrls, result.urls) });
        if (reservation.id) await completeUsage(reservation.id);
        return { ...result, chargedCents: reservation.chargedCents };
      } catch (error) {
        if (reservation.id) await failUsage(reservation.id);
        console.error("[Background removal] Provider failure", error);
        throw new Error("Something went wrong, you haven't been charged");
      }
    }),
    bulkConditionReports: protectedProcedure.input(z.object({ listingIds: z.array(z.number().int()).min(1).max(500) })).mutation(({ ctx, input }) => startAiBulkJob({ userId: ctx.user.id, feature: "conditionReport", listingIds: input.listingIds })),
    bulkModelImages: protectedProcedure.input(z.object({ listingIds: z.array(z.number().int()).min(1).max(500), prompt: z.string().min(8).max(500).default("Editorial fashion image, natural pose, soft daylight, honest styling") })).mutation(({ ctx, input }) => startAiBulkJob({ userId: ctx.user.id, feature: "modelImage", listingIds: input.listingIds, prompt: input.prompt })),
    bulkVideos: protectedProcedure.input(z.object({ listingIds: z.array(z.number().int()).min(1).max(500), prompt: z.string().min(8).max(500).default("A five second editorial fashion movement from this listing photo") })).mutation(async ({ ctx, input }) => {
      if (!getProviderCatalog().video[0]?.configured) return { status: "coming_soon" as const, results: [] as Array<{ listingId: number; status: string }> };
      return startAiBulkJob({ userId: ctx.user.id, feature: "video", listingIds: input.listingIds, prompt: input.prompt });
    }),
    bulkListingCopy: protectedProcedure.input(z.object({ listingIds: z.array(z.number().int()).min(1).max(500) })).mutation(({ ctx, input }) => startAiBulkJob({ userId: ctx.user.id, feature: "listingCopy", listingIds: input.listingIds })),
    latestJob: protectedProcedure.query(({ ctx }) => getLatestAiBulkJob(ctx.user.id)),
    job: protectedProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) => getAiBulkJob(ctx.user.id, input.id)),
    resumeJob: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => resumeAiBulkJob(input.id, ctx.user.id)),
    bulkRemoveBackground: protectedProcedure.input(z.object({ listingIds: z.array(z.number().int()).min(1).max(50) })).mutation(async ({ ctx, input }) => {
      const results = [];
      for (const listingId of input.listingIds) {
        const listing = await getUserListing(ctx.user.id, listingId);
        if (!listing || !listing.imageUrls.length || listing.imageUrls.length >= 12) { results.push({ listingId, status: "skipped" }); continue; }
        const selected = [listing.imageUrls[0]];
        const reservation = await reserveUsage({ userId: ctx.user.id, feature: "backgroundRemoveSingle", provider: "clipdrop", units: 1, freeAllowance: 1, alwaysFree: true, unitPriceCents: 0 });
        try { const result = await removeBackground({ imageUrls: selected }); await updateUserListing(ctx.user.id, { id: listingId, imageUrls: appendListingImages(listing.imageUrls, result.urls) }); if (reservation.id) await completeUsage(reservation.id); results.push({ listingId, status: "saved" }); }
        catch { if (reservation.id) await failUsage(reservation.id); results.push({ listingId, status: "failed" }); }
      }
      return { results };
    }),
    video: protectedProcedure.input(z.object({ listingId: z.number().int(), prompt: z.string().min(8).default("A five second editorial fashion movement from this listing photo") })).mutation(async ({ ctx, input }) => {
      const listing = await getUserListing(ctx.user.id, input.listingId);
      if (!listing) throw new Error("Listing not found.");
      if (!listing.imageUrls.length) throw new Error("Add a listing photo before creating a video.");
      if (!getProviderCatalog().video[0]?.configured) return { status: "coming_soon" as const, chargedCents: 0 };
      const reservation = await reserveUsage({ userId: ctx.user.id, feature: "video", provider: "higgsfield", units: 1, freeAllowance: 2, unitPriceCents: featurePrice("video", 1) });
        try { const result = await generateListingVideo({ imageUrls: listing.imageUrls, prompt: `${LISTING_DATA_SYSTEM_RULE}\n${input.prompt}` }); await updateUserListing(ctx.user.id, { id: input.listingId, videoStatus: "queued", videoRequestId: result.requestId ?? null, videoStatusUrl: result.statusUrl ?? null, videoUsageId: reservation.id, videoQueuedAt: new Date() }); return { ...result, chargedCents: reservation.chargedCents }; }
        catch (error) { if (reservation.id) await failUsage(reservation.id); console.error("[Video] Provider failure", error); throw new Error("Something went wrong, you haven't been charged"); }
      }),
    refreshVideo: protectedProcedure.input(z.object({ listingId: z.number().int() })).mutation(async ({ ctx, input }) => {
      const listing = await getUserListing(ctx.user.id, input.listingId);
      if (!listing) throw new Error("Listing not found.");
      const raw = listing as typeof listing & { videoStatusUrl?: string | null };
      if (!raw.videoStatusUrl) return { status: raw.videoStatus ?? "none" as const };
      await refundExpiredVideoReservations();
      const refreshed = await getUserListing(ctx.user.id, input.listingId);
      if (!refreshed || refreshed.videoStatus !== "queued" || !refreshed.videoStatusUrl) return { status: refreshed?.videoStatus ?? "failed" as const };
      const refreshedRaw = refreshed as typeof refreshed & { videoStatusUrl?: string | null; videoUsageId?: number | null; videoQueuedAt?: Date | null };
      const videoDecision = videoChargeDecision("queued", refreshedRaw.videoQueuedAt ? Date.now() - new Date(refreshedRaw.videoQueuedAt).getTime() : 0);
      if (videoDecision === "refund") {
        if (refreshedRaw.videoUsageId) await failUsage(refreshedRaw.videoUsageId);
        await updateUserListing(ctx.user.id, { id: input.listingId, videoStatus: "failed", videoUsageId: null });
        return { status: "failed" as const };
      }
      const videoStatusUrl = refreshedRaw.videoStatusUrl;
      if (!videoStatusUrl) return { status: "failed" as const };
      const result = await pollListingVideo(videoStatusUrl);
      if (result.status === "ready" && result.videoUrl) {
        const storedVideoUrl = await storeListingVideo(result.videoUrl, input.listingId);
        await updateUserListing(ctx.user.id, { id: input.listingId, videoStatus: "ready", videoUrl: storedVideoUrl, videoUsageId: null });
        if (refreshedRaw.videoUsageId) await completeUsage(refreshedRaw.videoUsageId);
        return { status: "ready" as const, videoUrl: storedVideoUrl };
      }
      if (result.status === "failed") {
        if (refreshedRaw.videoUsageId) await failUsage(refreshedRaw.videoUsageId);
        await updateUserListing(ctx.user.id, { id: input.listingId, videoStatus: "failed", videoUsageId: null });
      }
      return result;
    }),
  }),
  billing: router({
    createCheckout: protectedProcedure.input(z.object({ packId: z.string() })).mutation(async ({ ctx, input }) => {
      try {
        return await createCreditCheckout({ userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name, packId: input.packId, origin: ctx.req.headers.origin ?? "http://localhost:3000" });
      } catch (error) {
        console.error("[Checkout] Provider failure", error);
        throw new Error("Something went wrong, you haven't been charged");
      }
    }),
  }),
  storefront: router({
    home: publicProcedure.query(() => getPublicHomeListings()),
    browse: publicProcedure.input(z.object({ search: z.string().trim().max(180).optional(), category: z.string().max(96).optional(), condition: z.string().max(64).optional(), size: z.string().max(64).optional(), minPrice: z.number().int().min(0).optional(), maxPrice: z.number().int().min(0).optional(), sort: z.enum(["newest", "price-low-high", "price-high-low"]).optional(), page: z.number().int().min(1).default(1) })).query(({ input }) => getPublicBrowse(input)),
    listing: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => getPublicListing(input.id)),
    public: publicProcedure.input(z.object({ slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/) })).query(({ input }) => getPublicStorefront(input.slug)),
    blocks: protectedProcedure.query(({ ctx }) => getStorefrontBlocks(ctx.user.id)),
    updateBlock: protectedProcedure.input(z.object({ id: z.number().int(), title: z.string().min(1).max(180).optional(), body: z.string().nullable().optional(), isVisible: z.boolean().optional(), sortOrder: z.number().int().optional() })).mutation(({ ctx, input }) => updateStorefrontBlock(ctx.user.id, input)),
  }),
});

export type AppRouter = typeof appRouter;
