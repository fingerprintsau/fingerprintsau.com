import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { getPublicListing } from "../db";

const SITE_ORIGIN = process.env.CANONICAL_ORIGIN || "https://www.fingerprintsau.com";

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}

async function decoratePublicHead(template: string, requestUrl: string) {
  const pathname = requestUrl.split("?")[0];
  const match = pathname.match(/^\/listing\/(\d+)$/);
  const listing = match ? await getPublicListing(Number(match[1])) : null;
  const sellerName = listing?.seller.displayName || listing?.seller.name || "Independent seller";
  const title = listing ? `${listing.title} — ${sellerName} | Fingerprints` : match ? "Piece not found — Fingerprints" : "Fingerprints — Independent wardrobes, your way";
  const description = listing?.description || (listing ? `Discover ${listing.title} from ${sellerName} on Fingerprints.` : match ? "This Fingerprints piece is no longer live." : "Discover live pieces from independent sellers on Fingerprints.");
  const image = listing?.imageUrls[0] ? (listing.imageUrls[0].startsWith("http") ? listing.imageUrls[0] : `${SITE_ORIGIN}${listing.imageUrls[0]}`) : "";
  const canonical = `${SITE_ORIGIN}${pathname === "/" ? "/" : pathname}`;
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const headTags = [
    `<meta name="description" content="${escapedDescription}" />`,
    `<meta property="og:title" content="${escapedTitle}" />`,
    `<meta property="og:description" content="${escapedDescription}" />`,
    `<meta property="og:type" content="${listing || match ? "article" : "website"}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="fingerprintsau.com" />`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    `<meta name="twitter:description" content="${escapedDescription}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : "",
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
  ].filter(Boolean).join("\n    ");
  return template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapedTitle}</title>`).replace(/<meta name="description"[^>]*\/>/, headTags);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      template = await decoratePublicHead(template, url);
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist
  app.use("*", async (req, res) => {
    const template = await fs.promises.readFile(path.resolve(distPath, "index.html"), "utf-8");
    res.type("html").send(await decoratePublicHead(template, req.originalUrl));
  });
}
