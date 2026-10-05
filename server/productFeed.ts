import { ENV } from "./_core/env";

export type ProductFeedRow = {
  id: number;
  status: "live" | "draft" | "review";
  title: string;
  description: string | null;
  priceCents: number;
  condition: string;
  category: string | null;
  size: string | null;
  color?: string | null;
  brand?: string | null;
  gtin?: string | null;
  imageUrls: string[];
  showInCatalog: boolean;
};

const GOOGLE_NAMESPACE = "http://base.google.com/ns/1.0";
let cachedFeed: { xml: string; expiresAt: number } | null = null;

export function stripHtml(value: string | null | undefined) {
  return (value ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

function tag(name: string, value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "" : `<g:${name}>${xmlEscape(String(value))}</g:${name}>`;
}

function productBrand(row: ProductFeedRow) {
  return row.brand?.trim() || null;
}

export function eligibleProduct(row: ProductFeedRow) {
  return row.status === "live" && row.showInCatalog && row.imageUrls.length > 0 && row.priceCents > 0;
}

export function buildProductFeed(rows: ProductFeedRow[], siteUrl = ENV.publicSiteUrl) {
  const items = rows.filter(eligibleProduct).map((row) => {
    const brand = productBrand(row);
    const description = truncate(stripHtml(row.description), 5000);
    const condition = row.condition.trim().toLowerCase() === "new" ? "new" : "used";
    const photos = row.imageUrls.slice(0, 11).map((photo) => photo.startsWith("http") ? photo : `${siteUrl}${photo.startsWith("/") ? photo : `/${photo}`}`);
    return `<item>${tag("id", row.id)}${tag("title", truncate(stripHtml(row.title), 150))}${tag("description", description)}${tag("link", `${siteUrl}/listing/${row.id}`)}${tag("image_link", photos[0])}${photos.slice(1).map((photo) => tag("additional_image_link", photo)).join("")}${tag("availability", "in_stock")}${tag("price", `${(row.priceCents / 100).toFixed(2)} AUD`)}${tag("condition", condition)}${tag("brand", brand)}${tag("identifier_exists", brand || row.gtin ? "yes" : "no")}${tag("product_type", row.category)}${tag("size", row.size)}${tag("color", row.color)}</item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="${GOOGLE_NAMESPACE}"><channel><title>Fingerprints products</title><link>${xmlEscape(siteUrl)}</link><description>Live products from Fingerprints</description>${items}</channel></rss>`;
}

export async function getCachedProductFeed(loadRows: () => Promise<ProductFeedRow[]>) {
  const now = Date.now();
  if (cachedFeed && cachedFeed.expiresAt > now) return cachedFeed.xml;
  const xml = buildProductFeed(await loadRows());
  cachedFeed = { xml, expiresAt: now + 60 * 60 * 1000 };
  return xml;
}

export function clearProductFeedCache() {
  cachedFeed = null;
}
