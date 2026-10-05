import { invokeLLM } from "./_core/llm";
import { generateListingVideo, generateModelImage } from "./providerAdapters";
import {
  completeUsage,
  createAiBulkJob,
  failUsage,
  getAiBulkJob,
  getUserListing,
  reserveUsage,
  updateAiBulkJob,
  updateAiBulkJobItem,
  updateUserListing,
} from "./db";
import { LISTING_DATA_SYSTEM_RULE, appendListingImages } from "./aiPolicies";

export type AiBulkFeature = "conditionReport" | "modelImage" | "video" | "listingCopy";
export type VideoChargeDecision = "wait" | "complete" | "refund";

export function videoChargeDecision(status: "queued" | "ready" | "failed", ageMs: number, timeoutMs = 24 * 60 * 60 * 1000): VideoChargeDecision {
  if (status === "ready") return "complete";
  if (status === "failed" || ageMs >= timeoutMs) return "refund";
  return "wait";
}

export function summarizeAiBulkStatuses(statuses: Array<"queued" | "processing" | "succeeded" | "failed" | "skipped">) {
  return {
    processed: statuses.filter((status) => ["succeeded", "failed", "skipped"].includes(status)).length,
    succeeded: statuses.filter((status) => status === "succeeded").length,
    failed: statuses.filter((status) => status === "failed").length,
    skipped: statuses.filter((status) => status === "skipped").length,
    resumable: statuses.some((status) => ["queued", "processing"].includes(status)),
  };
}

const PRICES: Record<AiBulkFeature, number> = {
  conditionReport: 39,
  modelImage: 89,
  video: 149,
  listingCopy: 19,
};

function contentToText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : "")).join("\n").trim();
  return "";
}

async function conditionReport(userId: number, jobId: number, listingId: number) {
  const listing = await getUserListing(userId, listingId);
  if (!listing) return "skipped" as const;
  const reservation = await reserveUsage({ userId, feature: "conditionReport", provider: "manus-llm", units: 1, freeAllowance: 2, unitPriceCents: PRICES.conditionReport });
  await updateAiBulkJobItem(jobId, listingId, { usageId: reservation.id });
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: `${LISTING_DATA_SYSTEM_RULE} You are a meticulous resale condition assessor. Return one honest buyer-friendly report as JSON.` },
        { role: "user", content: JSON.stringify({ title: listing.title, condition: listing.condition, size: listing.size, category: listing.category, description: listing.description, photos: listing.imageUrls }) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "condition_report", strict: true, schema: { type: "object", properties: { rating: { type: "string" }, summary: { type: "string" }, checks: { type: "array", items: { type: "string" } } }, required: ["rating", "summary", "checks"], additionalProperties: false } } },
    });
    const report = JSON.parse(contentToText(response.choices[0]?.message?.content));
    await updateUserListing(userId, { id: listingId, conditionReport: report });
    if (reservation.id) await completeUsage(reservation.id);
    return "succeeded" as const;
  } catch (error) {
    if (reservation.id) await failUsage(reservation.id);
    throw error;
  }
}

async function listingCopy(userId: number, jobId: number, listingId: number) {
  const listing = await getUserListing(userId, listingId);
  if (!listing) return "skipped" as const;
  const reservation = await reserveUsage({ userId, feature: "listingCopy", provider: "manus-llm", units: 1, freeAllowance: 2, unitPriceCents: PRICES.listingCopy });
  await updateAiBulkJobItem(jobId, listingId, { usageId: reservation.id });
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: `${LISTING_DATA_SYSTEM_RULE} You write concise, honest, high-converting resale listing copy. Return JSON only.` },
        { role: "user", content: `Describe this real item using only its provided details and photos. Existing title: ${listing.title}. Condition: ${listing.condition}. Size: ${listing.size ?? "not provided"}. Category: ${listing.category ?? "not provided"}. Description: ${listing.description ?? "none"}. Photos: ${listing.imageUrls.join(", ")}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "listing_copy", strict: true, schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "description", "tags"], additionalProperties: false } } },
    });
    const result = JSON.parse(contentToText(response.choices[0]?.message?.content)) as { title: string; description: string; tags: string[] };
    await updateUserListing(userId, { id: listingId, title: result.title, description: result.description, tags: result.tags });
    if (reservation.id) await completeUsage(reservation.id);
    return "succeeded" as const;
  } catch (error) {
    if (reservation.id) await failUsage(reservation.id);
    throw error;
  }
}

async function modelImage(userId: number, jobId: number, listingId: number, prompt: string) {
  const listing = await getUserListing(userId, listingId);
  if (!listing || !listing.imageUrls.length || listing.imageUrls.length >= 12) return "skipped" as const;
  const reservation = await reserveUsage({ userId, feature: "modelImage", provider: "manus", units: 1, freeAllowance: 2, unitPriceCents: PRICES.modelImage });
  await updateAiBulkJobItem(jobId, listingId, { usageId: reservation.id });
  try {
    const result = await generateModelImage({ provider: "manus", prompt: `${LISTING_DATA_SYSTEM_RULE}\n${prompt}`, originalImageUrl: listing.imageUrls[0] });
    if (!result.imageUrl) throw new Error("No model image returned.");
    await updateUserListing(userId, { id: listingId, imageUrls: appendListingImages(listing.imageUrls, [result.imageUrl]) });
    if (reservation.id) await completeUsage(reservation.id);
    return "succeeded" as const;
  } catch (error) {
    if (reservation.id) await failUsage(reservation.id);
    throw error;
  }
}

async function video(userId: number, jobId: number, listingId: number, prompt: string) {
  const listing = await getUserListing(userId, listingId);
  if (!listing || !listing.imageUrls.length) return "skipped" as const;
  const reservation = await reserveUsage({ userId, feature: "video", provider: "higgsfield", units: 1, freeAllowance: 2, unitPriceCents: PRICES.video });
  await updateAiBulkJobItem(jobId, listingId, { usageId: reservation.id });
  try {
    const result = await generateListingVideo({ imageUrls: listing.imageUrls, prompt: `${LISTING_DATA_SYSTEM_RULE}\n${prompt}` });
    if (result.status === "coming_soon") {
      if (reservation.id) await failUsage(reservation.id);
      return "skipped" as const;
    }
    await updateUserListing(userId, { id: listingId, videoStatus: "queued", videoRequestId: result.requestId ?? null, videoStatusUrl: result.statusUrl ?? null, videoUsageId: reservation.id, videoQueuedAt: new Date() });
    return "succeeded" as const;
  } catch (error) {
    if (reservation.id) await failUsage(reservation.id);
    throw error;
  }
}

async function updateJobCounters(userId: number, jobId: number) {
  const job = await getAiBulkJob(userId, jobId);
  if (!job) return null;
  const summary = summarizeAiBulkStatuses(job.items.map((item) => item.status));
  return updateAiBulkJob(userId, jobId, { processedItems: summary.processed, succeededItems: summary.succeeded, failedItems: summary.failed, skippedItems: summary.skipped });
}

export async function processAiBulkJob(jobId: number, userId: number) {
  let job = await getAiBulkJob(userId, jobId);
  if (!job || ["completed", "failed"].includes(job.status)) return job;
  await updateAiBulkJob(userId, jobId, { status: "processing" });
  job = await getAiBulkJob(userId, jobId);
  if (!job) return null;
  for (const item of job.items) {
    if (["succeeded", "skipped"].includes(item.status)) continue;
    const listing = await getUserListing(userId, item.listingId);
    if (!listing) {
      await updateAiBulkJobItem(jobId, item.listingId, { status: "skipped", error: "Listing no longer exists." });
      await updateJobCounters(userId, jobId);
      continue;
    }
    await updateAiBulkJobItem(jobId, item.listingId, { status: "processing", error: null });
    try {
      const prompt = job.prompt ?? (job.feature === "video" ? "A five second editorial fashion movement from this listing photo" : "Editorial fashion image, natural pose, soft daylight, honest styling");
      const status = job.feature === "conditionReport"
        ? await conditionReport(userId, jobId, item.listingId)
        : job.feature === "modelImage"
          ? await modelImage(userId, jobId, item.listingId, prompt)
          : job.feature === "video"
            ? await video(userId, jobId, item.listingId, prompt)
            : await listingCopy(userId, jobId, item.listingId);
      await updateAiBulkJobItem(jobId, item.listingId, { status, error: null });
    } catch (error) {
      console.error("[AI bulk job] Item failed", error);
      await updateAiBulkJobItem(jobId, item.listingId, { status: "failed", error: "Something went wrong, you haven't been charged" });
    }
    await updateJobCounters(userId, jobId);
  }
  const finalJob = await getAiBulkJob(userId, jobId);
  if (!finalJob) return null;
  const status = finalJob.items.some((item) => ["queued", "processing"].includes(item.status)) ? "interrupted" : "completed";
  return updateAiBulkJob(userId, jobId, { status, summary: { succeeded: finalJob.succeededItems, failed: finalJob.failedItems, skipped: finalJob.skippedItems } });
}

export async function startAiBulkJob(input: { userId: number; feature: AiBulkFeature; listingIds: number[]; prompt?: string | null }) {
  const job = await createAiBulkJob(input);
  if (!job) throw new Error("Could not create the AI background job.");
  void processAiBulkJob(job.id, input.userId).catch((error) => console.error("[AI bulk job] Failed", error));
  return job;
}

export async function resumeAiBulkJob(jobId: number, userId: number) {
  const job = await getAiBulkJob(userId, jobId);
  if (!job || !["interrupted", "queued"].includes(job.status)) throw new Error("This AI job cannot be resumed.");
  void processAiBulkJob(jobId, userId).catch((error) => console.error("[AI bulk job] Resume failed", error));
  return { success: true } as const;
}
