import { lookup } from "node:dns/promises";
import { storageGetSignedUrl, storagePut } from "./storage";
import { createCsvImportJob, getCsvImportJob, getCsvImportRowStatus, getExistingListingSkus, importCsvListingRow, insertCsvDraftBatch, markCsvImportRowSkipped, updateCsvImportJob } from "./db";

export const CSV_MAX_ROWS = 10_000;
export const CSV_PREVIEW_ROWS = 20;
export const CSV_FIELDS = ["title", "price", "size", "condition", "category", "sku", "description", "photoUrls"] as const;
export type CsvField = typeof CSV_FIELDS[number];
export type CsvMapping = Record<CsvField, string[]>;
export type CsvRow = { rowNumber: number; values: Record<string, string>; errors: string[]; duplicate: boolean; valid: boolean };

const EBAY_CONDITIONS: Record<string, string> = { "1000": "New", "1500": "New other", "1750": "New with defects", "2000": "Refurbished", "2500": "Refurbished", "3000": "Used", "4000": "Very good", "5000": "Good", "6000": "Acceptable", "7000": "For parts or not working" };
export function normalizeCondition(value: string) { const trimmed = value.trim(); return EBAY_CONDITIONS[trimmed] ?? trimmed; }
export function shouldProcessCsvRow(status: string | undefined) { return status !== "succeeded" && status !== "skipped"; }
function clean(value: string | undefined) { return (value ?? "").trim(); }

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
    if (rows.length > CSV_MAX_ROWS + 1) throw new Error(`CSV cannot exceed ${CSV_MAX_ROWS.toLocaleString()} rows.`);
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() ?? []).map((header, index) => clean(header) || `Column ${index + 1}`);
  const data = rows.filter((values) => values.some((value) => clean(value))).map((values, index) => ({ rowNumber: index + 2, values: Object.fromEntries(headers.map((header, column) => [header, clean(values[column])])) }));
  if (!headers.length) throw new Error("CSV must include a header row.");
  if (data.length > CSV_MAX_ROWS) throw new Error(`CSV cannot exceed ${CSV_MAX_ROWS.toLocaleString()} data rows.`);
  return { headers, rows: data };
}

export function emptyMapping(): CsvMapping { return { title: [], price: [], size: [], condition: [], category: [], sku: [], description: [], photoUrls: [] }; }
export function normalizeMapping(input: Partial<CsvMapping>, headers: string[]): CsvMapping { const allowed = new Set(headers); const result = emptyMapping(); for (const field of CSV_FIELDS) result[field] = (input[field] ?? []).filter((header) => allowed.has(header)); return result; }
function valueFor(row: Record<string, string>, headers: string[]) { return headers.map((header) => clean(row[header])).filter(Boolean).join(" "); }
function photoValueFor(row: Record<string, string>, headers: string[]) { return headers.flatMap((header) => clean(row[header]).split(/[|;]/).map(clean)).filter(Boolean).slice(0, 12); }

export function validateCsvRows(rows: Array<{ rowNumber: number; values: Record<string, string> }>, mapping: CsvMapping, existingSkus: Set<string>) {
  const seen = new Set<string>();
  return rows.map(({ rowNumber, values }): CsvRow => {
    const title = valueFor(values, mapping.title); const priceText = valueFor(values, mapping.price).replace(/[$,\s]/g, ""); const price = Number(priceText); const condition = valueFor(values, mapping.condition); const sku = valueFor(values, mapping.sku); const errors: string[] = [];
    if (!title) errors.push("Missing title"); if (!priceText || !Number.isFinite(price) || price < 0) errors.push("Invalid price"); if (!condition) errors.push("Missing condition");
    const duplicate = Boolean(sku && (existingSkus.has(sku.toLowerCase()) || seen.has(sku.toLowerCase()))); if (duplicate) errors.push("Duplicate SKU"); if (sku) seen.add(sku.toLowerCase());
    return { rowNumber, values, errors, duplicate, valid: errors.length === 0 };
  });
}

export function rowToListing(row: CsvRow, mapping: CsvMapping) {
  const photoUrls = photoValueFor(row.values, mapping.photoUrls);
  return { title: valueFor(row.values, mapping.title), description: valueFor(row.values, mapping.description) || null, priceCents: Math.round(Number(valueFor(row.values, mapping.price).replace(/[$,\s]/g, "")) * 100), size: valueFor(row.values, mapping.size) || null, condition: normalizeCondition(valueFor(row.values, mapping.condition)), category: valueFor(row.values, mapping.category) || null, sku: valueFor(row.values, mapping.sku) || null, imageUrls: photoUrls, photoStatus: photoUrls.length ? "ok" as const : "photo_missing" as const };
}

export function isPrivateIp(address: string) {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "0.0.0.0" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff")) return true;
  const mapped = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  const parts = mapped.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a >= 224);
}

export async function assertSafePhotoUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname) throw new Error("Photo URL is not allowed.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal" || host === "169.254.169.254") throw new Error("Private or internal photo address is not allowed.");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Private or internal photo address is not allowed.");
  return url;
}

async function readPhotoBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0); if (declared > 20 * 1024 * 1024) throw new Error("Photo exceeds the 20MB limit.");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Photo response has no body.");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("Photo exceeds the 20MB limit."); } chunks.push(next.value); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function fetchSafePhoto(rawUrl: string) {
  let current = rawUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const url = await assertSafePhotoUrl(current);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { accept: "image/*" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get("location"); if (!location) throw new Error("Photo redirect has no destination."); current = new URL(location, url).toString(); continue; }
      if (!response.ok) throw new Error(`Photo download failed (${response.status}).`);
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? ""; if (!contentType.startsWith("image/")) throw new Error("Linked file is not an image.");
      return { body: await readPhotoBody(response), contentType };
    } finally { clearTimeout(timer); }
  }
  throw new Error("Photo has too many redirects.");
}

async function copyOnePhoto(userId: number, sourceUrl: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const downloaded = await fetchSafePhoto(sourceUrl); const extension = downloaded.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg"; const stored = await storagePut(`users/${userId}/listings/imports/${Date.now()}-${crypto.randomUUID()}.${extension}`, downloaded.body, downloaded.contentType); return stored.url; }
    catch (error) { lastError = error; }
  }
  console.warn("[CSV import] Photo unavailable", sourceUrl, lastError instanceof Error ? lastError.message : lastError);
  return null;
}

async function copyLinkedPhotos(userId: number, urls: string[]) {
  if (!urls.length) return { urls: [] as string[], photoStatus: "photo_missing" as const };
  const copied: string[] = []; let next = 0;
  const worker = async () => { while (next < urls.length) { const index = next++; const url = await copyOnePhoto(userId, urls[index]!); if (url) copied[index] = url; } };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, () => worker()));
  const ordered = copied.filter(Boolean);
  return { urls: ordered, photoStatus: ordered.length === urls.length ? "ok" as const : "photo_missing" as const };
}

export function csvErrorText(rows: CsvRow[]) { const headers = ["Row", "Error", "Original data"]; const escape = (value: string) => `"${value.replace(/"/g, '""')}"`; return [headers.join(","), ...rows.filter((row) => !row.valid).map((row) => [row.rowNumber, row.errors.join("; "), Object.values(row.values).join(" | ")].map((value) => escape(String(value))).join(","))].join("\n"); }

export async function startCsvImport(input: { userId: number; fileName: string; csvText: string; mapping: CsvMapping }) { const stored = await storagePut(`users/${input.userId}/imports/${Date.now()}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}`, input.csvText, "text/csv"); const parsed = parseCsv(input.csvText); const job = await createCsvImportJob({ userId: input.userId, fileKey: stored.key, fileName: input.fileName, mapping: input.mapping, totalRows: parsed.rows.length }); if (!job) throw new Error("Could not create the import job."); void processCsvImport(job.id, input.userId).catch((error) => console.error("[CSV import] Background job failed", error)); return job; }

export async function processCsvImport(jobId: number, userId: number) {
  const job = await getCsvImportJob(userId, jobId); if (!job || ["completed", "failed"].includes(job.status)) return;
  await updateCsvImportJob(userId, jobId, { status: "processing" });
  try {
    const csvUrl = await storageGetSignedUrl(job.fileKey); const response = await fetch(csvUrl); if (!response.ok) throw new Error("Stored CSV could not be read.");
    const parsed = parseCsv(await response.text()); const mapping = JSON.parse(job.mappingJson) as CsvMapping; const existingSkus = await getExistingListingSkus(userId); const validated = validateCsvRows(parsed.rows, mapping, existingSkus);
    let imported = 0; let skipped = 0; let failed = 0; let processed = 0;
    for (const row of validated) {
      const prior = await getCsvImportRowStatus(jobId, row.rowNumber); if (!shouldProcessCsvRow(prior?.status)) { processed += 1; if (prior?.status === "succeeded") imported += 1; else skipped += 1; continue; }
      if (row.duplicate) { await markCsvImportRowSkipped(jobId, row.rowNumber); skipped += 1; processed += 1; }
      else if (!row.valid) { failed += 1; processed += 1; }
      else {
        try { const listing = rowToListing(row, mapping); const photos = await copyLinkedPhotos(userId, listing.imageUrls); const result = await importCsvListingRow(userId, jobId, row.rowNumber, { ...listing, imageUrls: photos.urls, photoStatus: photos.photoStatus }); if (result.status === "succeeded") imported += 1; else skipped += 1; processed += 1; }
        catch (error) { failed += 1; processed += 1; console.error("[CSV import] Row failed", row.rowNumber, error); }
      }
      await updateCsvImportJob(userId, jobId, { processedRows: processed, importedRows: imported, skippedRows: skipped, failedRows: failed });
    }
    await updateCsvImportJob(userId, jobId, { status: "completed", processedRows: validated.length, importedRows: imported, skippedRows: skipped, failedRows: failed, errorRows: validated.filter((row) => !row.valid) });
  } catch (error) { await updateCsvImportJob(userId, jobId, { status: "failed" }); throw error; }
}
