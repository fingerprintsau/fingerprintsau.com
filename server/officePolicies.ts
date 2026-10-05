export const OFFICE_STORAGE_CAP_BYTES = 100 * 1024 * 1024;
export const OFFICE_FILE_CAP = 200;

export type OfficeUploadType = "docx" | "xlsx" | "csv";

function hasZipEntry(bytes: Uint8Array, entryName: string) {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.includes(entryName);
}

export function validateOfficeUpload(type: OfficeUploadType, bytes: Uint8Array) {
  if (!bytes.length) throw new Error("The uploaded file is empty.");
  if (type === "csv") {
    if (bytes.includes(0)) throw new Error("This CSV contains null bytes and is not valid UTF-8 text.");
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("This CSV is not valid UTF-8 text."); }
    return true;
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`This .${type} file is not a valid ZIP package.`);
  const required = type === "docx" ? "word/document.xml" : "xl/workbook.xml";
  if (!hasZipEntry(bytes, required)) throw new Error(`This .${type} file is missing ${required}.`);
  return true;
}

export function officeUsageFits(input: { fileCount: number; usedBytes: number; addingBytes?: number; addingFiles?: number }) {
  const fileCount = input.fileCount + (input.addingFiles ?? 0);
  const usedBytes = input.usedBytes + (input.addingBytes ?? 0);
  return { fileCount, usedBytes, fileCountOk: fileCount <= OFFICE_FILE_CAP, bytesOk: usedBytes <= OFFICE_STORAGE_CAP_BYTES, ok: fileCount <= OFFICE_FILE_CAP && usedBytes <= OFFICE_STORAGE_CAP_BYTES };
}

export function officeOwnershipMatches(file: { userId: number } | null | undefined, userId: number) {
  return Boolean(file && file.userId === userId);
}

export function shouldQueueDeletedStorageKey(storageKey: string | null | undefined, storageDeleteSucceeded: boolean) {
  return Boolean(storageKey && !storageDeleteSucceeded);
}

export function formatOfficeUsage(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB of 100 MB used`;
}
