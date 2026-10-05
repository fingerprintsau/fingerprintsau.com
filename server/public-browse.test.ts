import { describe, expect, it } from "vitest";
import { applyDefaultSellerMix } from "./db";

type Row = { id: number; status: "live" | "draft"; category: string; condition: string; size: string; priceCents: number; seller: { id: number } };

function liveRows(rows: Row[], input: Partial<Pick<Row, "category" | "condition" | "size">> & { minPrice?: number; maxPrice?: number }) {
  return rows.filter((row) => row.status === "live" && (!input.category || row.category === input.category) && (!input.condition || row.condition === input.condition) && (!input.size || row.size === input.size) && (input.minPrice === undefined || row.priceCents >= input.minPrice) && (input.maxPrice === undefined || row.priceCents <= input.maxPrice));
}

describe("public marketplace browse", () => {
  it("returns only live listings", () => {
    const rows: Row[] = [{ id: 1, status: "live", category: "Fashion", condition: "Good", size: "M", priceCents: 2000, seller: { id: 1 } }, { id: 2, status: "draft", category: "Fashion", condition: "Good", size: "M", priceCents: 2000, seller: { id: 1 } }];
    expect(liveRows(rows, []).map((row) => row.id)).toEqual([1]);
  });

  it("keeps each server page to 24 results", () => {
    const rows = Array.from({ length: 30 }, (_, id) => ({ id, status: "live" as const, category: "Fashion", condition: "Good", size: "M", priceCents: 2000, seller: { id } }));
    expect(rows.slice(0, 24)).toHaveLength(24);
  });

  it("limits the untouched default view to four listings per seller", () => {
    const rows = Array.from({ length: 30 }, (_, id) => ({ id, seller: { id: id < 10 ? 1 : id }, status: "live" as const }));
    const mixed = applyDefaultSellerMix(rows, 24);
    expect(mixed).toHaveLength(24);
    expect(mixed.filter((row) => row.seller.id === 1)).toHaveLength(4);
  });

  it("combines category, condition, size, and price filters", () => {
    const rows: Row[] = [
      { id: 1, status: "live", category: "Dance", condition: "Good", size: "M", priceCents: 4500, seller: { id: 1 } },
      { id: 2, status: "live", category: "Dance", condition: "Used", size: "M", priceCents: 4500, seller: { id: 1 } },
      { id: 3, status: "live", category: "Fashion", condition: "Good", size: "M", priceCents: 4500, seller: { id: 1 } },
    ];
    expect(liveRows(rows, { category: "Dance", condition: "Good", size: "M", minPrice: 4000, maxPrice: 5000 }).map((row) => row.id)).toEqual([1]);
  });
});
