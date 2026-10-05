import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Core user table backing auth flow and the Stripe customer reference. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free", "basic", "plus", "pro", "ultra"]).default("free").notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  displayName: varchar("displayName", { length: 160 }),
  bio: text("bio"),
  suburb: varchar("suburb", { length: 120 }),
  state: varchar("state", { length: 64 }),
  profileImageUrl: varchar("profileImageUrl", { length: 500 }),
  storeSlug: varchar("storeSlug", { length: 120 }),
  showInCatalog: boolean("showInCatalog").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => [uniqueIndex("users_store_slug_uq").on(table.storeSlug)]);

export const storefrontSlugHistory = mysqlTable("storefrontSlugHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("storefront_slug_history_slug_uq").on(table.slug), index("storefront_slug_history_user_id_idx").on(table.userId)]);

export const usageLedger = mysqlTable("usageLedger", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  feature: varchar("feature", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }),
  units: int("units").default(1).notNull(),
  amountCents: int("amountCents").default(0).notNull(),
  freeUnits: int("freeUnits").default(0).notNull(),
  reason: varchar("reason", { length: 64 }),
  status: mysqlEnum("status", ["reserved", "succeeded", "failed"]).default("reserved").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("usage_ledger_user_id_idx").on(table.userId)]);

export const bonusGrants = mysqlTable("bonusGrants", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  bonusCode: varchar("bonusCode", { length: 64 }).notNull(),
  credits: int("credits").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("bonus_grants_user_code_uq").on(table.userId, table.bonusCode), index("bonus_grants_user_id_idx").on(table.userId)]);

export const storefrontBlocks = mysqlTable("storefrontBlocks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  blockType: varchar("blockType", { length: 64 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body"),
  configJson: text("configJson"),
  sortOrder: int("sortOrder").default(0).notNull(),
  isVisible: boolean("isVisible").default(true).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("storefront_blocks_user_id_idx").on(table.userId)]);

export const listings = mysqlTable("listings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description"),
  priceCents: int("priceCents").default(0).notNull(),
  size: varchar("size", { length: 64 }),
  condition: varchar("condition", { length: 64 }).notNull(),
  category: varchar("category", { length: 96 }),
  sku: varchar("sku", { length: 96 }),
  status: mysqlEnum("status", ["live", "draft", "review"]).default("draft").notNull(),
  imageUrls: text("imageUrls"),
  photoStatus: mysqlEnum("photoStatus", ["ok", "photo_missing"]).default("ok").notNull(),
  tagsJson: text("tagsJson"),
  conditionReportJson: text("conditionReportJson"),
  videoStatus: mysqlEnum("videoStatus", ["none", "queued", "ready", "failed"]).default("none").notNull(),
  videoUrl: varchar("videoUrl", { length: 500 }),
  videoRequestId: varchar("videoRequestId", { length: 255 }),
  videoStatusUrl: varchar("videoStatusUrl", { length: 500 }),
  videoUsageId: int("videoUsageId"),
  videoQueuedAt: timestamp("videoQueuedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("listings_user_id_idx").on(table.userId),
  index("listings_user_created_idx").on(table.userId, table.createdAt),
  index("listings_user_status_idx").on(table.userId, table.status),
  index("listings_user_category_idx").on(table.userId, table.category),
  index("listings_user_condition_idx").on(table.userId, table.condition),
  index("listings_status_created_idx").on(table.status, table.createdAt),
  index("listings_status_category_idx").on(table.status, table.category),
  index("listings_status_price_idx").on(table.status, table.priceCents),
]);

export const csvImportJobs = mysqlTable("csvImportJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileName: varchar("fileName", { length: 180 }).notNull(),
  mappingJson: text("mappingJson").notNull(),
  totalRows: int("totalRows").default(0).notNull(),
  processedRows: int("processedRows").default(0).notNull(),
  importedRows: int("importedRows").default(0).notNull(),
  skippedRows: int("skippedRows").default(0).notNull(),
  failedRows: int("failedRows").default(0).notNull(),
  errorRowsJson: text("errorRowsJson"),
  status: mysqlEnum("status", ["queued", "processing", "interrupted", "completed", "failed"]).default("queued").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("csv_import_jobs_user_id_idx").on(table.userId), index("csv_import_jobs_user_status_idx").on(table.userId, table.status)]);

export const csvImportMappings = mysqlTable("csvImportMappings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  mappingJson: text("mappingJson").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [uniqueIndex("csv_import_mappings_user_id_uq").on(table.userId)]);

export const csvImportRows = mysqlTable("csvImportRows", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  rowNumber: int("rowNumber").notNull(),
  listingId: int("listingId"),
  status: mysqlEnum("status", ["processing", "succeeded", "skipped", "failed"]).default("processing").notNull(),
  error: text("error"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [uniqueIndex("csv_import_rows_job_row_uq").on(table.jobId, table.rowNumber), index("csv_import_rows_job_status_idx").on(table.jobId, table.status)]);

export const aiBulkJobs = mysqlTable("aiBulkJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  feature: mysqlEnum("feature", ["conditionReport", "modelImage", "video", "listingCopy"]).notNull(),
  prompt: text("prompt"),
  totalItems: int("totalItems").default(0).notNull(),
  processedItems: int("processedItems").default(0).notNull(),
  succeededItems: int("succeededItems").default(0).notNull(),
  failedItems: int("failedItems").default(0).notNull(),
  skippedItems: int("skippedItems").default(0).notNull(),
  summaryJson: text("summaryJson"),
  status: mysqlEnum("status", ["queued", "processing", "interrupted", "completed", "failed"]).default("queued").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("ai_bulk_jobs_user_id_idx").on(table.userId), index("ai_bulk_jobs_user_status_idx").on(table.userId, table.status)]);

export const aiBulkJobItems = mysqlTable("aiBulkJobItems", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  listingId: int("listingId").notNull(),
  usageId: int("usageId"),
  status: mysqlEnum("status", ["queued", "processing", "succeeded", "failed", "skipped"]).default("queued").notNull(),
  error: text("error"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [uniqueIndex("ai_bulk_job_items_job_listing_uq").on(table.jobId, table.listingId), index("ai_bulk_job_items_job_status_idx").on(table.jobId, table.status)]);

export const officeFiles = mysqlTable("officeFiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  fileType: mysqlEnum("fileType", ["doc", "sheet"]).notNull(),
  snapshotJson: text("snapshotJson").notNull(),
  sourceKey: varchar("sourceKey", { length: 500 }),
  sourceMimeType: varchar("sourceMimeType", { length: 160 }),
  sizeBytes: int("sizeBytes").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("office_files_user_id_idx").on(table.userId), index("office_files_user_updated_idx").on(table.userId, table.updatedAt)]);

export const deletedStorageKeys = mysqlTable("deletedStorageKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storageKey: varchar("storageKey", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("deleted_storage_keys_user_id_idx").on(table.userId), uniqueIndex("deleted_storage_keys_key_uq").on(table.storageKey)]);

export const stripeWebhookEvents = mysqlTable("stripeWebhookEvents", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 255 }).notNull(),
  sessionId: varchar("sessionId", { length: 255 }),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("stripe_webhook_event_id_uq").on(table.eventId), index("stripe_webhook_session_id_idx").on(table.sessionId)]);

export const stripeCheckoutSessions = mysqlTable("stripeCheckoutSessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 255 }).notNull(),
  userId: int("userId").notNull(),
  credits: int("credits").notNull(),
  creditsGrantedAt: timestamp("creditsGrantedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("stripe_checkout_session_id_uq").on(table.sessionId), index("stripe_checkout_user_id_idx").on(table.userId)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type StorefrontSlugHistory = typeof storefrontSlugHistory.$inferSelect;
export type UsageLedgerRow = typeof usageLedger.$inferSelect;
export type StorefrontBlock = typeof storefrontBlocks.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;
export type StripeCheckoutSession = typeof stripeCheckoutSessions.$inferSelect;
export type CsvImportJob = typeof csvImportJobs.$inferSelect;
export type CsvImportRow = typeof csvImportRows.$inferSelect;
export type AiBulkJob = typeof aiBulkJobs.$inferSelect;
export type AiBulkJobItem = typeof aiBulkJobItems.$inferSelect;
export type OfficeFile = typeof officeFiles.$inferSelect;
export type DeletedStorageKey = typeof deletedStorageKeys.$inferSelect;
