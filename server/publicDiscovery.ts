import { ENV } from "./_core/env";

const LEGAL_PATHS = [
  "/terms",
  "/seller-agreement",
  "/privacy",
  "/refunds",
  "/prohibited-items",
  "/community-guidelines",
  "/promotions-terms",
  "/cookies",
  "/contact",
  "/about",
] as const;

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildRobotsTxt() {
  return [`User-agent: *`, `Allow: /`, `Disallow: /dashboard`, `Disallow: /api`, `Sitemap: ${ENV.publicSiteUrl}/sitemap.xml`, ""].join("\n");
}

export function buildSitemapXml(data: { listingIds: number[]; storefrontSlugs: string[] }) {
  const urls = ["/", ...LEGAL_PATHS, ...data.storefrontSlugs.map((slug) => `/${slug}`), ...data.listingIds.map((id) => `/listing/${id}`)];
  const body = urls.map((path) => `  <url><loc>${escapeXml(`${ENV.publicSiteUrl}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
