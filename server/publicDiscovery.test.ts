import { describe, expect, it } from "vitest";
import { buildRobotsTxt, buildSitemapXml } from "./publicDiscovery";

describe("public discovery files", () => {
  it("blocks only dashboard and API routes in robots.txt", () => {
    const robots = buildRobotsTxt();
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /dashboard");
    expect(robots).toContain("Disallow: /api");
    expect(robots).toContain("Sitemap: https://fingerprintsau.com/sitemap.xml");
  });

  it("includes legal, live listing, and storefront URLs in the sitemap", () => {
    const sitemap = buildSitemapXml({ listingIds: [7], storefrontSlugs: ["the-edit"] });
    expect(sitemap).toContain("https://fingerprintsau.com/");
    expect(sitemap).toContain("https://fingerprintsau.com/privacy");
    expect(sitemap).toContain("https://fingerprintsau.com/listing/7");
    expect(sitemap).toContain("https://fingerprintsau.com/the-edit");
  });
});
