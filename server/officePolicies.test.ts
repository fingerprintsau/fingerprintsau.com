import { describe, expect, it } from "vitest";
import { officeOwnershipMatches, officeUsageFits, shouldQueueDeletedStorageKey, validateOfficeUpload } from "./officePolicies";

describe("office file policies", () => {
  it("validates docx and xlsx package contents, and rejects invalid CSV bytes", () => {
    expect(() => validateOfficeUpload("docx", new TextEncoder().encode("PK\u0003\u0004 word/document.xml"))).not.toThrow();
    expect(() => validateOfficeUpload("xlsx", new TextEncoder().encode("PK\u0003\u0004 xl/workbook.xml"))).not.toThrow();
    expect(() => validateOfficeUpload("docx", new TextEncoder().encode("PK but no document entry"))).toThrow(/missing word\/document.xml/);
    expect(() => validateOfficeUpload("xlsx", new TextEncoder().encode("not a zip"))).toThrow(/valid ZIP/);
    expect(() => validateOfficeUpload("csv", new Uint8Array([0x61, 0x00, 0x62]))).toThrow(/null bytes/);
    expect(() => validateOfficeUpload("csv", new Uint8Array([0xff, 0xfe]))).toThrow(/UTF-8/);
    expect(() => validateOfficeUpload("csv", new TextEncoder().encode("title,price\nJacket,20\n"))).not.toThrow();
  });

  it("blocks the 100 MB and 200-file limits", () => {
    expect(officeUsageFits({ fileCount: 199, usedBytes: 99 * 1024 * 1024, addingFiles: 1, addingBytes: 1024 * 1024 }).ok).toBe(true);
    expect(officeUsageFits({ fileCount: 200, usedBytes: 0, addingFiles: 1, addingBytes: 0 }).fileCountOk).toBe(false);
    expect(officeUsageFits({ fileCount: 1, usedBytes: 100 * 1024 * 1024, addingFiles: 0, addingBytes: 1 }).bytesOk).toBe(false);
  });

  it("does not allow one seller to read or delete another seller's file", () => {
    const otherSellerFile = { userId: 22 };
    expect(officeOwnershipMatches(otherSellerFile, 11)).toBe(false);
    expect(officeOwnershipMatches(otherSellerFile, 22)).toBe(true);
    expect(officeOwnershipMatches(null, 11)).toBe(false);
  });

  it("queues a storage key when object deletion is unavailable", () => {
    expect(shouldQueueDeletedStorageKey("users/11/office/file.docx", false)).toBe(true);
    expect(shouldQueueDeletedStorageKey("users/11/office/file.docx", true)).toBe(false);
    expect(shouldQueueDeletedStorageKey(null, false)).toBe(false);
  });
});
