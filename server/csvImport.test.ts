import { describe, expect, it } from "vitest";
import { parseCsv, rowToListing, validateCsvRows, type CsvMapping } from "./csvImport";

const mapping: CsvMapping = { title: ["Name"], price: ["Price"], size: ["Size"], condition: ["Condition"], category: ["Category"], sku: ["SKU"], description: ["Description"], photoUrls: ["PicURL"] };

describe("CSV import workflow", () => {
  it("maps columns and splits photo URLs", () => {
    const parsed = parseCsv("Name,Price,Size,Condition,PicURL\nDenim Jacket,89.95,M,Excellent,https://a.test/a.jpg|https://a.test/b.jpg");
    const rows = validateCsvRows(parsed.rows, { ...mapping, description: [], category: [], sku: [] }, new Set());
    expect(rows[0]?.valid).toBe(true);
    expect(rowToListing(rows[0]!, { ...mapping, description: [], category: [], sku: [] })).toMatchObject({ title: "Denim Jacket", priceCents: 8995, imageUrls: ["https://a.test/a.jpg", "https://a.test/b.jpg"] });
  });

  it("marks existing and repeated SKUs as duplicates", () => {
    const parsed = parseCsv("Title,Price,Condition,SKU\nOne,10,Good,SKU-1\nTwo,20,Good,SKU-2\nThree,30,Good,SKU-2");
    const rows = validateCsvRows(parsed.rows, { ...mapping, title: ["Title"], price: ["Price"], condition: ["Condition"], sku: ["SKU"], size: [], category: [], description: [], photoUrls: [] }, new Set(["sku-1"]));
    expect(rows.filter((row) => row.duplicate)).toHaveLength(2);
    expect(rows.filter((row) => row.valid)).toHaveLength(1);
  });

  it("reports missing titles and invalid prices without saving anything", () => {
    const parsed = parseCsv("Title,Price,Condition\n,free,Good\nValid,25,Good");
    const rows = validateCsvRows(parsed.rows, { ...mapping, title: ["Title"], price: ["Price"], condition: ["Condition"], size: [], category: [], sku: [], description: [], photoUrls: [] }, new Set());
    expect(rows[0]?.errors).toEqual(["Missing title", "Invalid price"]);
    expect(rows[1]?.valid).toBe(true);
  });

  it("parses and validates a 5,000-row import-sized CSV", () => {
    const lines = ["Title,Price,Condition,SKU", ...Array.from({ length: 5_000 }, (_, index) => `Item ${index + 1},${index + 1}.50,Good,bulk-${index + 1}`)];
    const parsed = parseCsv(lines.join("\n"));
    const rows = validateCsvRows(parsed.rows, { ...mapping, title: ["Title"], price: ["Price"], condition: ["Condition"], sku: ["SKU"], size: [], category: [], description: [], photoUrls: [] }, new Set());
    expect(parsed.rows).toHaveLength(5_000);
    expect(rows.filter((row) => row.valid)).toHaveLength(5_000);
  });
});
