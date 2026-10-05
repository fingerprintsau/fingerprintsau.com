import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOidcRoutes } from "./oidcAuth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../billing";
import { getProductFeedListings, getPublicSitemapData, getPublicStorefront, markProcessingAiBulkJobsInterrupted, markProcessingCsvJobsInterrupted, refundExpiredVideoReservations } from "../db";
import { getCachedProductFeed } from "../productFeed";
import { buildRobotsTxt, buildSitemapXml } from "../publicDiscovery";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  await markProcessingCsvJobsInterrupted();
  await markProcessingAiBulkJobsInterrupted();
  await refundExpiredVideoReservations();
  const videoRefundTimer = setInterval(() => void refundExpiredVideoReservations(), 60 * 60 * 1000);
  videoRefundTimer.unref();
  const app = express();
  const server = createServer(app);
  // Stripe signature verification requires the raw request body before JSON parsing.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
    void handleStripeWebhook(req, res);
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOidcRoutes(app);
  app.get("/health", (_req, res) => res.type("text/plain").send("ok"));
  app.get("/feeds/products.xml", async (_req, res) => {
    try {
      const xml = await getCachedProductFeed(getProductFeedListings);
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(xml);
    } catch (error) {
      console.error("[Product feed] Failed to build feed", error);
      return res.status(500).type("text/plain").send("Product feed unavailable");
    }
  });
  app.get("/robots.txt", (_req, res) => res.type("text/plain").send(buildRobotsTxt()));
  app.get("/sitemap.xml", async (_req, res) => {
    try {
      return res.type("application/xml").send(buildSitemapXml(await getPublicSitemapData()));
    } catch (error) {
      console.error("[Sitemap] Failed to build sitemap", error);
      return res.status(500).type("text/plain").send("Sitemap unavailable");
    }
  });
  app.get("/:slug", async (req, res, next) => {
    const slug = String(req.params.slug || "");
    if (!slug || slug.includes(".") || slug === "api") return next();
    try {
      const storefront = await getPublicStorefront(slug);
      if (storefront?.redirectSlug && storefront.redirectSlug !== slug) return res.redirect(301, `/${storefront.redirectSlug}`);
    } catch (error) {
      console.warn("[Storefront] Legacy slug lookup failed:", error);
    }
    return next();
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
