import { and, asc, desc, eq, gte, inArray, isNull, like, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { AiBulkJob, AiBulkJobItem, CsvImportJob, InsertListing, InsertUser, aiBulkJobItems, aiBulkJobs, bonusGrants, csvImportJobs, csvImportMappings, csvImportRows, deletedStorageKeys, listings, officeFiles, storefrontBlocks, storefrontSlugHistory, stripeCheckoutSessions, stripeWebhookEvents, usageLedger, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { OFFICE_FILE_CAP, officeUsageFits } from "./officePolicies";
import { eligibleLivePhotoCount, isLaunchBonusActive, LAUNCH_BONUS_CODE, LAUNCH_BONUS_REQUIRED_LISTINGS, launchBonusCredits, shouldGrantLaunchBonus } from "./launchBonus";
import { assertBatchListingLimit, type SellerPlan } from "./batchUploadPolicies";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function buildStoreSlug(name: string | null | undefined, openId: string) {
  const base = (name || "seller").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "seller";
  return `${base}-${openId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`.slice(0, 120);
}

export function normalizeStoreSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 120);
}

export const RESERVED_STORE_SLUGS = new Set(["dashboard", "listing", "listings", "api", "login", "logout", "signup", "account", "settings", "admin", "help", "support", "about", "terms", "privacy", "community", "collabs", "collab", "studio", "shop", "store", "search", "cart", "checkout", "messages", "inbox", "404", "manus-storage", "seller-agreement", "refunds", "prohibited-items", "community-guidelines", "promotions-terms", "cookies", "contact"]);
export function isReservedStoreSlug(value: string) {
  const normalized = normalizeStoreSlug(value);
  return RESERVED_STORE_SLUGS.has(normalized);
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const storeSlug = user.storeSlug ?? buildStoreSlug(user.name, user.openId);
    const values: InsertUser = {
      openId: user.openId,
      storeSlug,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getSellerBatchPolicy(userId: number) {
  const db = await getDb();
  if (!db) return { plan: "free" as SellerPlan, role: "user" as const, isOwner: false };
  const user = (await db.select({ plan: users.plan, role: users.role, openId: users.openId }).from(users).where(eq(users.id, userId)).limit(1))[0];
  return {
    plan: (user?.plan ?? "free") as SellerPlan,
    role: user?.role ?? "user",
    isOwner: user?.openId === ENV.ownerOpenId,
  };
}

export async function createUserListingsBatch(userId: number, inputs: InsertListing[]) {
  const db = await getDb();
  if (!db) return [];
  const policy = await getSellerBatchPolicy(userId);
  assertBatchListingLimit({ requestedListings: inputs.length, plan: policy.plan, role: policy.role, isOwner: policy.isOwner, freeLimit: ENV.freeBatchMaxListings });
  await db.transaction(async (tx) => {
    await tx.insert(listings).values(inputs);
  });
  return inputs;
}

export async function setUserPlan(userId: number, plan: SellerPlan) {
  const db = await getDb();
  if (!db) return null;
  await db.update(users).set({ plan }).where(eq(users.id, userId));
  return db.select({ id: users.id, plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1).then((rows) => rows[0] ?? null);
}

export async function grantLaunchBonusIfEligible(userId: number) {
  const db = await getDb();
  if (!db || !isLaunchBonusActive()) return { granted: false, eligibleListings: 0, credits: launchBonusCredits() };
  return db.transaction(async (tx) => {
    const user = (await tx.select({ id: users.id, role: users.role, openId: users.openId }).from(users).where(eq(users.id, userId)).for("update"))[0];
    if (!user) return { granted: false, eligibleListings: 0, credits: launchBonusCredits() };
    const existingGrant = (await tx.select({ id: bonusGrants.id }).from(bonusGrants).where(and(eq(bonusGrants.userId, userId), eq(bonusGrants.bonusCode, LAUNCH_BONUS_CODE))).limit(1))[0];
    const liveListings = await tx.select({ status: listings.status, imageUrls: listings.imageUrls }).from(listings).where(eq(listings.userId, userId));
    const eligibleListings = eligibleLivePhotoCount(liveListings);
    const canGrant = shouldGrantLaunchBonus({ active: true, alreadyGranted: Boolean(existingGrant), eligibleListings, role: user.role, isOwner: user.openId === ENV.ownerOpenId });
    if (!canGrant) return { granted: false, eligibleListings, credits: launchBonusCredits() };
    const credits = launchBonusCredits();
    const [grantResult] = await tx.insert(bonusGrants).values({ userId, bonusCode: LAUNCH_BONUS_CODE, credits }).onDuplicateKeyUpdate({ set: { bonusCode: sql`bonusCode` } });
    if (Number(grantResult?.affectedRows ?? 0) !== 1) return { granted: false, eligibleListings, credits };
    await tx.insert(usageLedger).values({ userId, feature: "credits", provider: null, units: credits, amountCents: 0, freeUnits: 0, reason: "launch_bonus", status: "succeeded" });
    return { granted: true, eligibleListings, credits };
  });
}

export async function getLaunchBonusStatus(userId: number) {
  const db = await getDb();
  const credits = launchBonusCredits();
  if (!db) return { active: false, earned: false, eligibleListings: 0, requiredListings: LAUNCH_BONUS_REQUIRED_LISTINGS, credits };
  const user = (await db.select({ role: users.role, openId: users.openId }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const [grant, rows] = await Promise.all([
    db.select({ id: bonusGrants.id }).from(bonusGrants).where(and(eq(bonusGrants.userId, userId), eq(bonusGrants.bonusCode, LAUNCH_BONUS_CODE))).limit(1),
    db.select({ status: listings.status, imageUrls: listings.imageUrls }).from(listings).where(eq(listings.userId, userId)),
  ]);
  return { active: isLaunchBonusActive() && user?.role !== "admin" && user?.openId !== ENV.ownerOpenId, earned: grant.length > 0, eligibleListings: eligibleLivePhotoCount(rows), requiredListings: LAUNCH_BONUS_REQUIRED_LISTINGS, credits };
}

export async function isFoundingSeller(userId: number) {
  const db = await getDb();
  if (!db) return false;
  const row = (await db.select({ id: bonusGrants.id }).from(bonusGrants).where(and(eq(bonusGrants.userId, userId), eq(bonusGrants.bonusCode, LAUNCH_BONUS_CODE))).limit(1))[0];
  return Boolean(row);
}

export async function listOfficeFiles(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: officeFiles.id, userId: officeFiles.userId, name: officeFiles.name, fileType: officeFiles.fileType, sourceMimeType: officeFiles.sourceMimeType, createdAt: officeFiles.createdAt, updatedAt: officeFiles.updatedAt }).from(officeFiles).where(eq(officeFiles.userId, userId)).orderBy(desc(officeFiles.updatedAt));
}

export async function getOfficeUsage(userId: number) {
  const db = await getDb();
  if (!db) return { fileCount: 0, usedBytes: 0 };
  const [summary] = await db.select({ fileCount: sql<number>`count(*)`, usedBytes: sql<number>`coalesce(sum(${officeFiles.sizeBytes}), 0)` }).from(officeFiles).where(eq(officeFiles.userId, userId));
  return { fileCount: Number(summary?.fileCount ?? 0), usedBytes: Number(summary?.usedBytes ?? 0) };
}

export async function getOfficeFile(userId: number, id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(officeFiles).where(and(eq(officeFiles.id, id), eq(officeFiles.userId, userId))).limit(1);
  return rows[0] ?? null;
}

export async function createOfficeFile(input: { userId: number; name: string; fileType: "doc" | "sheet"; snapshotJson: string; sourceKey?: string | null; sourceMimeType?: string | null; sizeBytes?: number }) {
  const db = await getDb();
  if (!db) return null;
  const sizeBytes = input.sizeBytes ?? Buffer.byteLength(input.snapshotJson, "utf8");
  const usage = await getOfficeUsage(input.userId);
  const fit = officeUsageFits({ ...usage, addingFiles: 1, addingBytes: sizeBytes });
  if (!fit.fileCountOk) throw new Error(`You can store up to ${OFFICE_FILE_CAP} files per seller.`);
  if (!fit.bytesOk) throw new Error(`This file would exceed your 100 MB storage limit.`);
  const [result] = await db.insert(officeFiles).values({ ...input, sizeBytes }).$returningId();
  return result?.id ? getOfficeFile(input.userId, result.id) : null;
}

export async function updateOfficeFile(userId: number, input: { id: number; name?: string; snapshotJson?: string; sourceKey?: string | null; sourceMimeType?: string | null; sizeBytes?: number }) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getOfficeFile(userId, input.id);
  if (!existing) return null;
  const sizeBytes = input.sizeBytes ?? existing.sizeBytes;
  const usage = await getOfficeUsage(userId);
  const fit = officeUsageFits({ fileCount: usage.fileCount - 1, usedBytes: usage.usedBytes - existing.sizeBytes, addingFiles: 1, addingBytes: sizeBytes });
  if (!fit.bytesOk) throw new Error(`This save would exceed your 100 MB storage limit.`);
  await db.update(officeFiles).set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.snapshotJson !== undefined ? { snapshotJson: input.snapshotJson } : {}), ...(input.sourceKey !== undefined ? { sourceKey: input.sourceKey } : {}), ...(input.sourceMimeType !== undefined ? { sourceMimeType: input.sourceMimeType } : {}), sizeBytes }).where(and(eq(officeFiles.id, input.id), eq(officeFiles.userId, userId)));
  return getOfficeFile(userId, input.id);
}

export async function deleteOfficeFile(userId: number, id: number) {
  const db = await getDb();
  if (!db) return false;
  const existing = await getOfficeFile(userId, id);
  if (!existing) return false;
  await db.delete(officeFiles).where(and(eq(officeFiles.id, id), eq(officeFiles.userId, userId)));
  return { deleted: true, storageKey: existing.sourceKey };
}

export async function recordDeletedStorageKey(userId: number, storageKey: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(deletedStorageKeys).values({ userId, storageKey }).onDuplicateKeyUpdate({ set: { storageKey: sql`storageKey` } });
}

export async function getSellerProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, displayName: users.displayName, bio: users.bio, suburb: users.suburb, state: users.state, profileImageUrl: users.profileImageUrl, storeSlug: users.storeSlug, showInCatalog: users.showInCatalog }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getProductFeedListings() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: listings.id, status: listings.status, title: listings.title, description: listings.description, priceCents: listings.priceCents, condition: listings.condition, category: listings.category, size: listings.size, tagsJson: listings.tagsJson, imageUrls: listings.imageUrls, showInCatalog: users.showInCatalog }).from(listings).innerJoin(users, eq(listings.userId, users.id)).where(and(eq(listings.status, "live"), eq(users.showInCatalog, true)));
  return rows.map((row) => {
    let imageUrls: string[] = [];
    let tags: string[] = [];
    try { imageUrls = row.imageUrls ? JSON.parse(row.imageUrls) : []; } catch { imageUrls = []; }
    try { tags = row.tagsJson ? JSON.parse(row.tagsJson) : []; } catch { tags = []; }
    const brandTag = tags.find((tag) => typeof tag === "string" && tag.toLowerCase().startsWith("brand:"));
    const colorTag = tags.find((tag) => typeof tag === "string" && tag.toLowerCase().startsWith("color:"));
    return { id: row.id, status: row.status, title: row.title, description: row.description, priceCents: row.priceCents, condition: row.condition, category: row.category, size: row.size, imageUrls: Array.isArray(imageUrls) ? imageUrls.filter((value): value is string => typeof value === "string") : [], brand: brandTag ? brandTag.slice(6).trim() : null, color: colorTag ? colorTag.slice(6).trim() : null, showInCatalog: row.showInCatalog };
  });
}

export async function checkStoreSlugAvailability(slug: string, userId: number) {
  const db = await getDb();
  if (!db) return { slug, available: false };
  const normalized = normalizeStoreSlug(slug);
  if (!normalized) return { slug: normalized, available: false };
  if (isReservedStoreSlug(normalized)) return { slug: normalized, available: false, reserved: true };
  const [current, history] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.storeSlug, normalized)).limit(1),
    db.select({ userId: storefrontSlugHistory.userId }).from(storefrontSlugHistory).where(eq(storefrontSlugHistory.slug, normalized)).limit(1),
  ]);
  const currentTakenByOther = current[0] && current[0].id !== userId;
  const historyTakenByOther = history[0] && history[0].userId !== userId;
  return { slug: normalized, available: !currentTakenByOther && !historyTakenByOther, reserved: false };
}

export async function updateSellerProfile(userId: number, input: { displayName: string; bio: string | null; suburb: string | null; state: string | null; profileImageUrl?: string | null; storeSlug: string; showInCatalog: boolean }) {
  const db = await getDb();
  if (!db) return null;
    const normalizedSlug = normalizeStoreSlug(input.storeSlug);
  if (!normalizedSlug) throw new Error("Choose a valid store address.");
    if (isReservedStoreSlug(normalizedSlug)) throw new Error("This address is reserved");
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!current) throw new Error("Seller account not found.");
    const [currentMatch, historyMatch] = await Promise.all([
      tx.select({ id: users.id }).from(users).where(eq(users.storeSlug, normalizedSlug)).limit(1),
      tx.select({ userId: storefrontSlugHistory.userId }).from(storefrontSlugHistory).where(eq(storefrontSlugHistory.slug, normalizedSlug)).limit(1),
    ]);
    if ((currentMatch[0] && currentMatch[0].id !== userId) || (historyMatch[0] && historyMatch[0].userId !== userId)) throw new Error("That store address is already taken.");
    if (current.storeSlug && current.storeSlug !== normalizedSlug) {
      await tx.insert(storefrontSlugHistory).values({ userId, slug: current.storeSlug }).onDuplicateKeyUpdate({ set: { slug: sql`slug` } });
    }
    await tx.update(users).set({ displayName: input.displayName.trim() || null, bio: input.bio, suburb: input.suburb, state: input.state, showInCatalog: input.showInCatalog, ...(input.profileImageUrl !== undefined ? { profileImageUrl: input.profileImageUrl } : {}), storeSlug: normalizedSlug }).where(eq(users.id, userId));
    const rows = await tx.select({ id: users.id, name: users.name, email: users.email, displayName: users.displayName, bio: users.bio, suburb: users.suburb, state: users.state, profileImageUrl: users.profileImageUrl, storeSlug: users.storeSlug, showInCatalog: users.showInCatalog }).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  });
}

function parseImageUrls(value: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [] as string[];
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function serializeListing(row: typeof listings.$inferSelect) {
  return { ...row, imageUrls: parseImageUrls(row.imageUrls), tags: parseJson<string[]>(row.tagsJson, []), conditionReport: parseJson<Record<string, unknown> | null>(row.conditionReportJson, null) };
}

export async function getUserListings(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(listings).where(eq(listings.userId, userId)).orderBy(desc(listings.createdAt));
  return rows.map(serializeListing);
}

export async function getUserListing(userId: number, id: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, userId))).limit(1))[0];
  return row ? serializeListing(row) : null;
}

export type ListingPageInput = {
  page: number;
  pageSize: number;
  search?: string;
  status?: "live" | "draft" | "review";
  category?: string;
  condition?: string;
};

function listingWhere(userId: number, input: Pick<ListingPageInput, "search" | "status" | "category" | "condition">) {
  const clauses = [eq(listings.userId, userId)];
  if (input.status) clauses.push(eq(listings.status, input.status));
  if (input.category) clauses.push(eq(listings.category, input.category));
  if (input.condition) clauses.push(eq(listings.condition, input.condition));
  const term = input.search?.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(or(like(listings.title, pattern), like(listings.sku, pattern), like(listings.category, pattern))!);
  }
  return and(...clauses);
}

export async function getUserListingsPage(userId: number, input: ListingPageInput) {
  const db = await getDb();
  if (!db) return { items: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 0 };
  const where = listingWhere(userId, input);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(listings).where(where);
  const rows = await db.select().from(listings).where(where).orderBy(desc(listings.createdAt), desc(listings.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
  const totalCount = Number(total ?? 0);
  return { items: rows.map(serializeListing), total: totalCount, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(totalCount / input.pageSize) };
}

export async function getUserListingFacets(userId: number) {
  const db = await getDb();
  if (!db) return { categories: [], conditions: [] };
  const [categoryRows, conditionRows] = await Promise.all([
    db.selectDistinct({ value: listings.category }).from(listings).where(eq(listings.userId, userId)),
    db.selectDistinct({ value: listings.condition }).from(listings).where(eq(listings.userId, userId)),
  ]);
  return {
    categories: categoryRows.map((row) => row.value).filter((value): value is string => Boolean(value)).sort(),
    conditions: conditionRows.map((row) => row.value).filter(Boolean).sort(),
  };
}

export async function getUserListingMetrics(userId: number) {
  const db = await getDb();
  if (!db) {
    return { total: 0, live: 0, draft: 0, review: 0, inventoryValueCents: 0, averagePriceCents: 0 };
  }
  const [summary] = await db.select({
    total: sql<number>`count(*)`,
    live: sql<number>`sum(${listings.status} = 'live')`,
    draft: sql<number>`sum(${listings.status} = 'draft')`,
    review: sql<number>`sum(${listings.status} = 'review')`,
    inventoryValueCents: sql<number>`coalesce(sum(${listings.priceCents}), 0)`,
    averagePriceCents: sql<number>`coalesce(avg(${listings.priceCents}), 0)`,
  }).from(listings).where(eq(listings.userId, userId));
  return {
    total: Number(summary?.total ?? 0),
    live: Number(summary?.live ?? 0),
    draft: Number(summary?.draft ?? 0),
    review: Number(summary?.review ?? 0),
    inventoryValueCents: Number(summary?.inventoryValueCents ?? 0),
    averagePriceCents: Math.round(Number(summary?.averagePriceCents ?? 0)),
  };
}

export async function createUserListing(input: InsertListing) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(listings).values(input).$returningId();
  if (!result?.id) return null;
  const rows = await db.select().from(listings).where(and(eq(listings.id, result.id), eq(listings.userId, input.userId))).limit(1);
  return rows[0] ? serializeListing(rows[0]) : null;
}

export async function updateUserListing(userId: number, input: {
  id: number;
  title?: string;
  description?: string | null;
  priceCents?: number;
  size?: string | null;
  condition?: string;
  category?: string | null;
  sku?: string | null;
  status?: "live" | "draft" | "review";
  imageUrls?: string[];
  tags?: string[];
  conditionReport?: Record<string, unknown> | null;
  videoStatus?: "none" | "queued" | "ready" | "failed";
  videoUrl?: string | null;
  videoRequestId?: string | null;
  videoStatusUrl?: string | null;
  videoUsageId?: number | null;
  videoQueuedAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) return null;
  await db.update(listings).set({
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.condition !== undefined ? { condition: input.condition } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.sku !== undefined ? { sku: input.sku } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.imageUrls !== undefined ? { imageUrls: JSON.stringify(input.imageUrls) } : {}),
    ...(input.tags !== undefined ? { tagsJson: JSON.stringify(input.tags) } : {}),
    ...(input.conditionReport !== undefined ? { conditionReportJson: input.conditionReport ? JSON.stringify(input.conditionReport) : null } : {}),
    ...(input.videoStatus !== undefined ? { videoStatus: input.videoStatus } : {}),
    ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
    ...(input.videoRequestId !== undefined ? { videoRequestId: input.videoRequestId } : {}),
    ...(input.videoStatusUrl !== undefined ? { videoStatusUrl: input.videoStatusUrl } : {}),
    ...(input.videoUsageId !== undefined ? { videoUsageId: input.videoUsageId } : {}),
    ...(input.videoQueuedAt !== undefined ? { videoQueuedAt: input.videoQueuedAt } : {}),
  }).where(and(eq(listings.id, input.id), eq(listings.userId, userId)));
  const rows = await db.select().from(listings).where(and(eq(listings.id, input.id), eq(listings.userId, userId))).limit(1);
  return rows[0] ? serializeListing(rows[0]) : null;
}

export async function duplicateUserListing(userId: number, id: number) {
  const db = await getDb();
  if (!db) return null;
  const source = (await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.userId, userId))).limit(1))[0];
  if (!source) return null;
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = source;
  const [result] = await db.insert(listings).values({ ...copy, title: `${source.title} copy`.slice(0, 180), status: "draft" }).$returningId();
  if (!result?.id) return null;
  const rows = await db.select().from(listings).where(and(eq(listings.id, result.id), eq(listings.userId, userId))).limit(1);
  return rows[0] ? serializeListing(rows[0]) : null;
}

export async function bulkUpdateUserListings(userId: number, ids: number[], status: "live" | "draft" | "review") {
  if (!ids.length) return 0;
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(listings).set({ status }).where(and(eq(listings.userId, userId), inArray(listings.id, ids)));
  return Number(result[0]?.affectedRows ?? 0);
}

export async function bulkDeleteUserListings(userId: number, ids: number[]) {
  if (!ids.length) return 0;
  const db = await getDb();
  if (!db) return 0;
  const result = await db.delete(listings).where(and(eq(listings.userId, userId), inArray(listings.id, ids)));
  return Number(result[0]?.affectedRows ?? 0);
}

export async function deleteUserListing(userId: number, id: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.delete(listings).where(and(eq(listings.id, id), eq(listings.userId, userId)));
  return Number(result[0]?.affectedRows ?? 0) === 1;
}

export async function claimStripeWebhookEvent(input: { eventId: string; sessionId?: string | null; eventType: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is required to process Stripe webhooks safely.");
  const result = await db.insert(stripeWebhookEvents).values(input).onDuplicateKeyUpdate({ set: { eventId: sql`eventId` } });
  return Number(result[0]?.affectedRows ?? 0) === 1;
}

export async function fulfillStripeCheckout(input: { sessionId: string; userId: number; credits: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is required to fulfill Stripe credits safely.");
  return db.transaction(async (tx) => {
    await tx.insert(stripeCheckoutSessions).values({ sessionId: input.sessionId, userId: input.userId, credits: input.credits }).onDuplicateKeyUpdate({ set: { sessionId: sql`sessionId` } });
    const claimed = await tx.update(stripeCheckoutSessions).set({ creditsGrantedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(stripeCheckoutSessions.sessionId, input.sessionId), isNull(stripeCheckoutSessions.creditsGrantedAt)));
    if (Number(claimed[0]?.affectedRows ?? 0) !== 1) return false;
    await tx.insert(usageLedger).values({ userId: input.userId, feature: "credits", provider: "stripe", units: input.credits, amountCents: 0, freeUnits: 0, status: "succeeded" });
    return true;
  });
}

export async function getPublicStorefront(storeSlug: string) {
  const db = await getDb();
  if (!db) return null;
  let seller = (await db.select({ id: users.id, name: users.name, displayName: users.displayName, bio: users.bio, suburb: users.suburb, state: users.state, profileImageUrl: users.profileImageUrl, storeSlug: users.storeSlug }).from(users).where(eq(users.storeSlug, storeSlug)).limit(1))[0];
  let redirectSlug: string | null = null;
  if (!seller) {
    const legacy = (await db.select({ userId: storefrontSlugHistory.userId }).from(storefrontSlugHistory).where(eq(storefrontSlugHistory.slug, storeSlug)).limit(1))[0];
    if (legacy) {
      seller = (await db.select({ id: users.id, name: users.name, displayName: users.displayName, bio: users.bio, suburb: users.suburb, state: users.state, profileImageUrl: users.profileImageUrl, storeSlug: users.storeSlug }).from(users).where(eq(users.id, legacy.userId)).limit(1))[0];
      redirectSlug = seller?.storeSlug ?? null;
    }
  }
  if (!seller) return null;
  const foundingSeller = await isFoundingSeller(seller.id);
  const [liveListings, blocks] = await Promise.all([
    db.select().from(listings).where(and(eq(listings.userId, seller.id), eq(listings.status, "live"))).orderBy(desc(listings.createdAt)),
    db.select({ id: storefrontBlocks.id, blockType: storefrontBlocks.blockType, title: storefrontBlocks.title, body: storefrontBlocks.body, configJson: storefrontBlocks.configJson, sortOrder: storefrontBlocks.sortOrder }).from(storefrontBlocks).where(and(eq(storefrontBlocks.userId, seller.id), eq(storefrontBlocks.isVisible, true))).orderBy(asc(storefrontBlocks.sortOrder)),
  ]);
  return { redirectSlug, seller: { name: seller.name, displayName: seller.displayName, bio: seller.bio, suburb: seller.suburb, state: seller.state, profileImageUrl: seller.profileImageUrl, storeSlug: seller.storeSlug, foundingSeller }, listings: liveListings.map(serializeListing), blocks };
}

export async function getPublicHomeListings() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ listing: listings, seller: { name: users.name, displayName: users.displayName, storeSlug: users.storeSlug } }).from(listings).innerJoin(users, eq(listings.userId, users.id)).where(eq(listings.status, "live")).orderBy(desc(listings.createdAt)).limit(48);
  return rows.map(({ listing, seller }) => ({ ...serializeListing(listing), seller }));
}

export type PublicBrowseInput = { search?: string; category?: string; condition?: string; size?: string; minPrice?: number; maxPrice?: number; sort?: "newest" | "price-low-high" | "price-high-low"; page: number };

export function applyDefaultSellerMix<T extends { seller: { id?: number; storeSlug?: string | null } }>(items: T[], limit = 24) {
  const counts = new Map<string, number>();
  const mixed: T[] = [];
  for (const item of items) {
    const sellerKey = String(item.seller.id ?? item.seller.storeSlug ?? "unknown");
    const count = counts.get(sellerKey) ?? 0;
    if (count >= 4) continue;
    counts.set(sellerKey, count + 1);
    mixed.push(item);
    if (mixed.length === limit) break;
  }
  return mixed;
}

export async function getPublicBrowse(input: PublicBrowseInput) {
  const db = await getDb();
  if (!db) return { items: [], total: 0, categories: [] as string[] };
  const term = input.search?.trim();
  const filters = [eq(listings.status, "live")];
  if (term) {
    const pattern = `%${term}%`;
    filters.push(or(like(listings.title, pattern), like(listings.description, pattern), like(listings.tagsJson, pattern), like(users.name, pattern), like(users.displayName, pattern))!);
  }
  if (input.category) filters.push(eq(listings.category, input.category));
  if (input.condition) filters.push(eq(listings.condition, input.condition));
  if (input.size) filters.push(eq(listings.size, input.size));
  if (input.minPrice !== undefined) filters.push(gte(listings.priceCents, input.minPrice));
  if (input.maxPrice !== undefined) filters.push(lte(listings.priceCents, input.maxPrice));
  const hasBrowseFilters = Boolean(term || input.category || input.condition || input.size || input.minPrice !== undefined || input.maxPrice !== undefined || input.sort);
  const order = input.sort === "price-low-high" ? asc(listings.priceCents) : input.sort === "price-high-low" ? desc(listings.priceCents) : desc(listings.createdAt);
  const [rows, totalRows, categoryRows] = await Promise.all([
    db.select({ listing: listings, seller: { id: users.id, name: users.name, displayName: users.displayName, storeSlug: users.storeSlug } }).from(listings).innerJoin(users, eq(listings.userId, users.id)).where(and(...filters)).orderBy(order).limit(hasBrowseFilters ? 24 : 10000).offset(hasBrowseFilters ? (input.page - 1) * 24 : 0),
    db.select({ count: sql<number>`count(*)` }).from(listings).innerJoin(users, eq(listings.userId, users.id)).where(and(...filters)),
    db.selectDistinct({ category: listings.category }).from(listings).where(eq(listings.status, "live")),
  ]);
  const serialized = rows.map(({ listing, seller }) => ({ ...serializeListing(listing), seller }));
  const total = Number(totalRows[0]?.count ?? 0);
  const mixed = hasBrowseFilters ? serialized : applyDefaultSellerMix(serialized, serialized.length);
  const items = hasBrowseFilters ? mixed : mixed.slice((input.page - 1) * 24, input.page * 24);
  return { items, total, hasMore: hasBrowseFilters ? input.page * 24 < total : input.page * 24 < mixed.length, categories: categoryRows.map((row) => row.category).filter((category): category is string => Boolean(category)).sort() };
}

export async function getPublicListing(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ listing: listings, seller: { name: users.name, displayName: users.displayName, bio: users.bio, suburb: users.suburb, state: users.state, profileImageUrl: users.profileImageUrl, storeSlug: users.storeSlug } }).from(listings).innerJoin(users, eq(listings.userId, users.id)).where(and(eq(listings.id, id), eq(listings.status, "live"))).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...serializeListing(row.listing), seller: { ...row.seller, foundingSeller: await isFoundingSeller(row.listing.userId) } };
}

export async function getPublicSitemapData() {
  const db = await getDb();
  if (!db) return { listingIds: [] as number[], storefrontSlugs: [] as string[] };
  const rows = await db.select({ listingId: listings.id, storeSlug: users.storeSlug }).from(listings).innerJoin(users, eq(listings.userId, users.id)).where(eq(listings.status, "live"));
  return {
    listingIds: rows.map((row) => row.listingId),
    storefrontSlugs: Array.from(new Set(rows.map((row) => row.storeSlug).filter((slug): slug is string => Boolean(slug)))),
  };
}

const DEFAULT_BLOCKS = [
  { blockType: "hero", title: "A shop that feels like you.", body: "A considered edit of pieces with a little more life left in them.", sortOrder: 0 },
  { blockType: "drop", title: "The September drop", body: "New pieces land every Thursday. Come early.", sortOrder: 1 },
  { blockType: "story", title: "Leave a little life in it.", body: "Every piece gets a second chapter, and every seller gets their own corner.", sortOrder: 2 },
  { blockType: "social", title: "Follow the edit", body: "Instagram · Threads · TikTok", sortOrder: 3 },
] as const;

export async function getUsageSummary(userId: number) {
  const db = await getDb();
  if (!db) {
    return { freeTrials: { modelImage: 2, listingCopy: 2, conditionReport: 2, video: 2 }, credits: 0, spentCents: 0 };
  }
  const rows = await db
    .select({ feature: usageLedger.feature, units: usageLedger.units, amountCents: usageLedger.amountCents, freeUnits: usageLedger.freeUnits })
    .from(usageLedger)
    .where(and(eq(usageLedger.userId, userId), inArray(usageLedger.status, ["reserved", "succeeded"])))
  const freeUsed = (feature: string) => rows.filter((row) => row.feature === feature).reduce((total, row) => total + Number(row.freeUnits ?? 0), 0);
  const creditsGranted = rows.filter((row) => row.feature === "credits").reduce((total, row) => total + Number(row.units ?? 0), 0);
  const creditsSpent = rows.filter((row) => row.feature !== "credits" && Number(row.amountCents ?? 0) > 0).reduce((total, row) => total + Math.max(0, Number(row.units ?? 0) - Number(row.freeUnits ?? 0)), 0);
  return {
    freeTrials: {
      modelImage: Math.max(0, 2 - freeUsed("modelImage")),
      listingCopy: Math.max(0, 2 - freeUsed("listingCopy")),
      conditionReport: Math.max(0, 2 - freeUsed("conditionReport")),
      video: Math.max(0, 2 - freeUsed("video")),
    },
    credits: Math.max(0, creditsGranted - creditsSpent),
    spentCents: rows.reduce((total, row) => total + Number(row.amountCents ?? 0), 0),
  };
}

export async function recordUsage(input: {
  userId: number;
  feature: string;
  provider?: string;
  units?: number;
  amountCents?: number;
  freeUnits?: number;
  status?: "reserved" | "succeeded" | "failed";
}) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(usageLedger).values({
    userId: input.userId,
    feature: input.feature,
    provider: input.provider,
    units: input.units ?? 1,
    amountCents: input.amountCents ?? 0,
    freeUnits: input.freeUnits ?? 0,
    status: input.status ?? "succeeded",
  }).$returningId();
  return result?.id ?? null;
}

export function calculateUsageReservation(input: { units: number; freeAllowance: number; freeUsed: number; creditsAvailable: number; unitPriceCents: number; alwaysFree?: boolean }) {
  const freeUnits = input.alwaysFree ? input.units : Math.min(input.units, Math.max(0, input.freeAllowance - input.freeUsed));
  const paidUnits = input.alwaysFree ? 0 : input.units - freeUnits;
  if (paidUnits > Math.max(0, input.creditsAvailable)) throw new Error(`This action needs ${paidUnits} credits. Add a credit pack to continue.`);
  return { freeUnits, paidUnits, chargedCents: paidUnits * input.unitPriceCents };
}

export async function reserveUsage(input: { userId: number; feature: string; provider?: string; units: number; freeAllowance: number; unitPriceCents: number; alwaysFree?: boolean }) {
  if (!Number.isInteger(input.units) || input.units < 1) throw new Error("Usage units must be a positive integer.");
  const db = await getDb();
  if (!db) throw new Error("Database is required to reserve usage safely.");
  return db.transaction(async (tx) => {
    const owner = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
    if (!owner.length) throw new Error("Seller account not found.");
    const rows = await tx.select().from(usageLedger).where(eq(usageLedger.userId, input.userId));
    const activeStatuses = new Set(["reserved", "succeeded"]);
    const freeUsed = rows.filter((row) => row.feature === input.feature && activeStatuses.has(row.status)).reduce((total, row) => total + row.freeUnits, 0);
    const creditsGranted = rows.filter((row) => row.feature === "credits" && row.status === "succeeded").reduce((total, row) => total + row.units, 0);
    const creditsSpent = rows.filter((row) => row.feature !== "credits" && row.status !== "failed" && row.amountCents > 0).reduce((total, row) => total + Math.max(0, row.units - row.freeUnits), 0);
    const { freeUnits, paidUnits, chargedCents } = calculateUsageReservation({ units: input.units, freeAllowance: input.freeAllowance, freeUsed, creditsAvailable: creditsGranted - creditsSpent, unitPriceCents: input.unitPriceCents, alwaysFree: input.alwaysFree });
    const [result] = await tx.insert(usageLedger).values({ userId: input.userId, feature: input.feature, provider: input.provider, units: input.units, freeUnits, amountCents: chargedCents, status: "reserved" }).$returningId();
    return { id: result?.id ?? null, freeUnits, paidUnits, chargedCents };
  });
}

export async function completeUsage(id: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(usageLedger).set({ status: "succeeded" }).where(and(eq(usageLedger.id, id), eq(usageLedger.status, "reserved")));
  return Number(result[0]?.affectedRows ?? 0) === 1;
}

export async function failUsage(id: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(usageLedger).set({ status: "failed" }).where(and(eq(usageLedger.id, id), eq(usageLedger.status, "reserved"), or(isNull(usageLedger.reason), ne(usageLedger.reason, "launch_bonus"))));
  return Number(result[0]?.affectedRows ?? 0) === 1;
}

export async function getStorefrontBlocks(userId: number) {
  const db = await getDb();
  if (!db) return DEFAULT_BLOCKS.map((block, index) => ({ ...block, id: index + 1, userId, body: block.body, configJson: null, isVisible: true, updatedAt: new Date() }));
  const existing = await db.select().from(storefrontBlocks).where(eq(storefrontBlocks.userId, userId)).orderBy(asc(storefrontBlocks.sortOrder));
  if (existing.length) return existing;
  await db.insert(storefrontBlocks).values(DEFAULT_BLOCKS.map((block) => ({ ...block, userId })));
  return db.select().from(storefrontBlocks).where(eq(storefrontBlocks.userId, userId)).orderBy(asc(storefrontBlocks.sortOrder));
}

export async function updateStorefrontBlock(userId: number, input: {
  id: number;
  title?: string;
  body?: string | null;
  isVisible?: boolean;
  sortOrder?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  await db.update(storefrontBlocks).set({
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  }).where(and(eq(storefrontBlocks.id, input.id), eq(storefrontBlocks.userId, userId)));
  const rows = await db.select().from(storefrontBlocks).where(and(eq(storefrontBlocks.id, input.id), eq(storefrontBlocks.userId, userId))).limit(1);
  return rows[0];
}


function serializeCsvJob(row: CsvImportJob) {
  return { ...row, errorRows: row.errorRowsJson ? JSON.parse(row.errorRowsJson) : [] };
}

export async function createCsvImportJob(input: { userId: number; fileKey: string; fileName: string; mapping: unknown; totalRows: number }) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(csvImportJobs).values({ userId: input.userId, fileKey: input.fileKey, fileName: input.fileName, mappingJson: JSON.stringify(input.mapping), totalRows: input.totalRows, status: "queued" }).$returningId();
  if (!result?.id) return null;
  const row = (await db.select().from(csvImportJobs).where(and(eq(csvImportJobs.id, result.id), eq(csvImportJobs.userId, input.userId))).limit(1))[0];
  return row ? serializeCsvJob(row) : null;
}

export async function getCsvImportJob(userId: number, id: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(csvImportJobs).where(and(eq(csvImportJobs.id, id), eq(csvImportJobs.userId, userId))).limit(1))[0];
  return row ? serializeCsvJob(row) : null;
}

export async function updateCsvImportJob(userId: number, id: number, input: { status?: "queued" | "processing" | "completed" | "failed"; processedRows?: number; importedRows?: number; skippedRows?: number; failedRows?: number; errorRows?: unknown[] }) {
  const db = await getDb();
  if (!db) return null;
  await db.update(csvImportJobs).set({ ...(input.status ? { status: input.status } : {}), ...(input.processedRows !== undefined ? { processedRows: input.processedRows } : {}), ...(input.importedRows !== undefined ? { importedRows: input.importedRows } : {}), ...(input.skippedRows !== undefined ? { skippedRows: input.skippedRows } : {}), ...(input.failedRows !== undefined ? { failedRows: input.failedRows } : {}), ...(input.errorRows ? { errorRowsJson: JSON.stringify(input.errorRows) } : {}) }).where(and(eq(csvImportJobs.id, id), eq(csvImportJobs.userId, userId)));
  return getCsvImportJob(userId, id);
}

export async function getSavedCsvMapping(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(csvImportMappings).where(eq(csvImportMappings.userId, userId)).limit(1))[0];
  return row ? JSON.parse(row.mappingJson) : null;
}

export async function saveCsvMapping(userId: number, mapping: unknown) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(csvImportMappings).values({ userId, mappingJson: JSON.stringify(mapping) }).onDuplicateKeyUpdate({ set: { mappingJson: JSON.stringify(mapping), updatedAt: new Date() } });
  return mapping;
}

export async function getExistingListingSkus(userId: number) {
  const db = await getDb();
  if (!db) return new Set<string>();
  const rows = await db.select({ sku: listings.sku }).from(listings).where(eq(listings.userId, userId));
  return new Set(rows.map((row) => row.sku?.trim().toLowerCase()).filter((sku): sku is string => Boolean(sku)));
}

export async function insertCsvDraftBatch(userId: number, rows: Array<{ title: string; description: string | null; priceCents: number; size: string | null; condition: string; category: string | null; sku: string | null; imageUrls: string[]; photoStatus: "ok" | "photo_missing" }>) {
  const db = await getDb();
  if (!db || !rows.length) return 0;
  await db.insert(listings).values(rows.map((row) => ({ ...row, userId, status: "draft" as const, imageUrls: JSON.stringify(row.imageUrls) })));
  return rows.length;
}

export async function getUserListingsForExport(userId: number, input: Pick<ListingPageInput, "search" | "status" | "category" | "condition">) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(listings).where(listingWhere(userId, input)).orderBy(desc(listings.createdAt), desc(listings.id));
  return rows.map(serializeListing);
}


export async function getLatestCsvImportJob(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(csvImportJobs).where(eq(csvImportJobs.userId, userId)).orderBy(desc(csvImportJobs.createdAt), desc(csvImportJobs.id)).limit(1))[0];
  return row ? serializeCsvJob(row) : null;
}


export async function getExistingReservedStoreAddresses() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id, storeSlug: users.storeSlug }).from(users);
  return rows.filter((row) => row.storeSlug && isReservedStoreSlug(row.storeSlug));
}


export async function markProcessingCsvJobsInterrupted() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(csvImportJobs).set({ status: "interrupted" }).where(eq(csvImportJobs.status, "processing"));
  return Number(result[0]?.affectedRows ?? 0);
}

export async function getCsvImportRowStatus(jobId: number, rowNumber: number) {
  const db = await getDb();
  if (!db) return null;
  return (await db.select().from(csvImportRows).where(and(eq(csvImportRows.jobId, jobId), eq(csvImportRows.rowNumber, rowNumber))).limit(1))[0] ?? null;
}

export async function markCsvImportRowSkipped(jobId: number, rowNumber: number) {
  const db = await getDb();
  if (!db) return false;
  await db.insert(csvImportRows).values({ jobId, rowNumber, status: "skipped" }).onDuplicateKeyUpdate({ set: { status: "skipped", updatedAt: new Date() } });
  return true;
}

export async function importCsvListingRow(userId: number, jobId: number, rowNumber: number, row: { title: string; description: string | null; priceCents: number; size: string | null; condition: string; category: string | null; sku: string | null; imageUrls: string[]; photoStatus: "ok" | "photo_missing" }) {
  const db = await getDb();
  if (!db) return { status: "failed" as const };
  return db.transaction(async (tx) => {
    const existing = (await tx.select().from(csvImportRows).where(and(eq(csvImportRows.jobId, jobId), eq(csvImportRows.rowNumber, rowNumber))).limit(1))[0];
    if (existing?.status === "succeeded" || existing?.status === "skipped") return { status: existing.status };
    if (!existing) await tx.insert(csvImportRows).values({ jobId, rowNumber, status: "processing" });
    const [result] = await tx.insert(listings).values({ ...row, userId, status: "draft", imageUrls: JSON.stringify(row.imageUrls) }).$returningId();
    if (!result?.id) throw new Error("Could not create imported listing.");
    await tx.update(csvImportRows).set({ listingId: result.id, status: "succeeded", error: null, updatedAt: new Date() }).where(and(eq(csvImportRows.jobId, jobId), eq(csvImportRows.rowNumber, rowNumber)));
    return { status: "succeeded" as const };
  });
}

function serializeAiBulkJob(row: AiBulkJob) {
  return { ...row, summary: row.summaryJson ? parseJson<Record<string, unknown>>(row.summaryJson, {}) : {} };
}

export async function createAiBulkJob(input: { userId: number; feature: "conditionReport" | "modelImage" | "video" | "listingCopy"; listingIds: number[]; prompt?: string | null }) {
  const db = await getDb();
  if (!db) return null;
  const listingIds = Array.from(new Set(input.listingIds));
  if (!listingIds.length) return null;
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(aiBulkJobs).values({ userId: input.userId, feature: input.feature, prompt: input.prompt ?? null, totalItems: listingIds.length, status: "queued" }).$returningId();
    if (!result?.id) return null;
    await tx.insert(aiBulkJobItems).values(listingIds.map((listingId) => ({ jobId: result.id, listingId, status: "queued" as const })));
    const row = (await tx.select().from(aiBulkJobs).where(and(eq(aiBulkJobs.id, result.id), eq(aiBulkJobs.userId, input.userId))).limit(1))[0];
    return row ? serializeAiBulkJob(row) : null;
  });
}

export async function getAiBulkJob(userId: number, id: number) {
  const db = await getDb();
  if (!db) return null;
  const job = (await db.select().from(aiBulkJobs).where(and(eq(aiBulkJobs.id, id), eq(aiBulkJobs.userId, userId))).limit(1))[0];
  if (!job) return null;
  const items = await db.select().from(aiBulkJobItems).where(eq(aiBulkJobItems.jobId, id));
  return { ...serializeAiBulkJob(job), items };
}

export async function getLatestAiBulkJob(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const job = (await db.select().from(aiBulkJobs).where(eq(aiBulkJobs.userId, userId)).orderBy(desc(aiBulkJobs.createdAt), desc(aiBulkJobs.id)).limit(1))[0];
  return job ? getAiBulkJob(userId, job.id) : null;
}

export async function getAiBulkJobItem(jobId: number, listingId: number) {
  const db = await getDb();
  if (!db) return null;
  return (await db.select().from(aiBulkJobItems).where(and(eq(aiBulkJobItems.jobId, jobId), eq(aiBulkJobItems.listingId, listingId))).limit(1))[0] ?? null;
}

export async function updateAiBulkJob(userId: number, id: number, input: { status?: "queued" | "processing" | "interrupted" | "completed" | "failed"; processedItems?: number; succeededItems?: number; failedItems?: number; skippedItems?: number; summary?: unknown }) {
  const db = await getDb();
  if (!db) return null;
  await db.update(aiBulkJobs).set({ ...(input.status ? { status: input.status } : {}), ...(input.processedItems !== undefined ? { processedItems: input.processedItems } : {}), ...(input.succeededItems !== undefined ? { succeededItems: input.succeededItems } : {}), ...(input.failedItems !== undefined ? { failedItems: input.failedItems } : {}), ...(input.skippedItems !== undefined ? { skippedItems: input.skippedItems } : {}), ...(input.summary !== undefined ? { summaryJson: JSON.stringify(input.summary) } : {}) }).where(and(eq(aiBulkJobs.id, id), eq(aiBulkJobs.userId, userId)));
  return getAiBulkJob(userId, id);
}

export async function updateAiBulkJobItem(jobId: number, listingId: number, input: { status?: "queued" | "processing" | "succeeded" | "failed" | "skipped"; usageId?: number | null; error?: string | null }) {
  const db = await getDb();
  if (!db) return null;
  await db.update(aiBulkJobItems).set({ ...(input.status ? { status: input.status } : {}), ...(input.usageId !== undefined ? { usageId: input.usageId } : {}), ...(input.error !== undefined ? { error: input.error } : {}), updatedAt: new Date() }).where(and(eq(aiBulkJobItems.jobId, jobId), eq(aiBulkJobItems.listingId, listingId)));
  return getAiBulkJobItem(jobId, listingId);
}

export async function markProcessingAiBulkJobsInterrupted() {
  const db = await getDb();
  if (!db) return 0;
  const jobs = await db.select().from(aiBulkJobs).where(eq(aiBulkJobs.status, "processing"));
  for (const job of jobs) {
    const items = await db.select().from(aiBulkJobItems).where(and(eq(aiBulkJobItems.jobId, job.id), eq(aiBulkJobItems.status, "processing")));
    for (const item of items) {
      if (item.usageId) await failUsage(item.usageId);
      await updateAiBulkJobItem(job.id, item.listingId, { status: "queued", usageId: null, error: "Interrupted; queued for resume." });
    }
    await db.update(aiBulkJobs).set({ status: "interrupted" }).where(eq(aiBulkJobs.id, job.id));
  }
  return jobs.length;
}

export async function refundExpiredVideoReservations() {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select({ id: listings.id, userId: listings.userId, videoUsageId: listings.videoUsageId, videoQueuedAt: listings.videoQueuedAt }).from(listings).where(eq(listings.videoStatus, "queued"));
  let refunded = 0;
  for (const row of rows) {
    if (row.videoQueuedAt && row.videoQueuedAt <= cutoff && row.videoUsageId) {
      if (await failUsage(row.videoUsageId)) refunded += 1;
      await db.update(listings).set({ videoStatus: "failed", videoUsageId: null }).where(and(eq(listings.id, row.id), eq(listings.userId, row.userId)));
    }
  }
  return refunded;
}
