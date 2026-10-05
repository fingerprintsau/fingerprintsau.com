import { describe, expect, it } from "vitest";
import { isReservedStoreSlug } from "./db";
import { assertSafePhotoUrl, normalizeCondition, rowToListing, shouldProcessCsvRow, validateCsvRows, type CsvMapping } from "./csvImport";

const mapping: CsvMapping = { title: ["Title"], price: ["Price"], size: [], condition: ["Condition"], category: [], sku: [], description: [], photoUrls: [] };

describe("requested CSV and store-address policies", () => {
  it("recognizes every reserved store address", () => {
    for (const value of ["dashboard", "listing", "listings", "api", "login", "logout", "signup", "account", "settings", "admin", "help", "support", "about", "terms", "privacy", "community", "collabs", "collab", "studio", "shop", "store", "search", "cart", "checkout", "messages", "inbox", "404", "manus-storage"]) expect(isReservedStoreSlug(value)).toBe(true);
    expect(isReservedStoreSlug("alex-edits")).toBe(false);
  });

  it("rejects local and private photo addresses", async () => {
    await expect(assertSafePhotoUrl("http://127.0.0.1/photo.jpg")).rejects.toThrow(/Private or internal/);
    await expect(assertSafePhotoUrl("http://localhost/photo.jpg")).rejects.toThrow(/Private or internal/);
    await expect(assertSafePhotoUrl("file:///etc/passwd")).rejects.toThrow(/not allowed/);
  });

  it("only reprocesses rows that have not completed or been skipped", () => {
    expect(shouldProcessCsvRow(undefined)).toBe(true);
    expect(shouldProcessCsvRow("processing")).toBe(true);
    expect(shouldProcessCsvRow("succeeded")).toBe(false);
    expect(shouldProcessCsvRow("skipped")).toBe(false);
  });

  it("marks rows without photo links as photo missing", () => {
    const rows = validateCsvRows([{ rowNumber: 2, values: { Title: "No photo", Price: "20", Condition: "Used" } }], mapping, new Set());
    expect(rowToListing(rows[0]!, mapping).photoStatus).toBe("photo_missing");
  });

  it("converts eBay condition codes to buyer-friendly words", () => {
    expect(normalizeCondition("1000")).toBe("New");
    expect(normalizeCondition("1500")).toBe("New other");
    expect(normalizeCondition("1750")).toBe("New with defects");
    expect(normalizeCondition("2000")).toBe("Refurbished");
    expect(normalizeCondition("2500")).toBe("Refurbished");
    expect(normalizeCondition("3000")).toBe("Used");
    expect(normalizeCondition("4000")).toBe("Very good");
    expect(normalizeCondition("5000")).toBe("Good");
    expect(normalizeCondition("6000")).toBe("Acceptable");
    expect(normalizeCondition("7000")).toBe("For parts or not working");
  });
});
