import { describe, expect, it } from "vitest";
import { buildProductFeed, eligibleProduct, type ProductFeedRow } from "./productFeed";

function row(overrides: Partial<ProductFeedRow> = {}): ProductFeedRow {
  return { id: 42, status: "live", title: "New jacket", description: "A <b>great</b> jacket & coat", priceCents: 4500, condition: "New", category: "Fashion", size: "M", imageUrls: ["/manus-storage/jacket.jpg"], showInCatalog: true, ...overrides };
}

describe("product feed", () => {
  it("includes only live-feed eligible rows", () => {
    expect(eligibleProduct(row())).toBe(true);
    expect(eligibleProduct(row({ showInCatalog: false }))).toBe(false);
    expect(eligibleProduct(row({ imageUrls: [] }))).toBe(false);
    expect(eligibleProduct(row({ priceCents: 0 }))).toBe(false);
  });

  it("honours seller opt-out and formats price and condition", () => {
    const xml = buildProductFeed([row(), row({ id: 43, showInCatalog: false }), row({ id: 44, condition: "Good" })], "https://fingerprintsau.com");
    expect(xml).toContain("<g:id>42</g:id>");
    expect(xml).toContain("<g:price>45.00 AUD</g:price>");
    expect(xml).toContain("<g:condition>new</g:condition>");
    expect(xml).toContain("<g:condition>used</g:condition>");
    expect(xml).toContain("<g:image_link>https://fingerprintsau.com/manus-storage/jacket.jpg</g:image_link>");
    expect(xml).not.toContain("<g:id>43</g:id>");
  });

  it("escapes XML text and strips description markup", () => {
    const xml = buildProductFeed([row({ title: 'A & "special" <piece>', description: "<p>Bold & bright</p>", category: "<piece>" })], "https://fingerprintsau.com");
    expect(xml).toContain("A &amp; &quot;special&quot;");
    expect(xml).toContain("&lt;piece&gt;");
    expect(xml).toContain("Bold &amp; bright");
    expect(xml).not.toContain("<p>");
  });
});
