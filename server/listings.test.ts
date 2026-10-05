import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function publicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function authenticatedContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "sample-user",
      email: "sample@example.com",
      name: "Sample User",
      loginMethod: "oidc",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      storeSlug: "sample-user-sample",
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("listings procedures", () => {
  it("requires a logged-in seller for inventory data", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.listings.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
    await expect(caller.listings.listPage({ page: 1, pageSize: 50 })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
    await expect(caller.listings.facets()).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
    await expect(caller.listings.metrics()).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
  });

  it("requires a logged-in seller before accepting listing uploads", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.listings.uploadImage({ fileName: "jacket.jpg", contentType: "image/jpeg", data: "aGVsbG8=" })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
  });

  it("keeps listing creation input bounded", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.listings.create({ title: "", priceCents: -1, condition: "", status: "draft", imageUrls: [] })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
  });

  it("rejects background-removal URLs outside Fingerprints storage", async () => {
    const caller = appRouter.createCaller(authenticatedContext());
    await expect(caller.ai.removeBackground({ imageUrls: ["https://example.com/source.png"] })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("caps listing galleries at twelve storage-backed photos", async () => {
    const caller = appRouter.createCaller(authenticatedContext());
    const images = Array.from({ length: 13 }, (_, index) => `/manus-storage/users/1/listings/photo-${index}.jpg`);
    await expect(caller.listings.update({ id: 1, imageUrls: images })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
    await expect(caller.listings.update({ id: 1, imageUrls: ["https://example.com/source.png"] })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("validates public storefront slugs before querying", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.storefront.public({ slug: "Not A Slug" })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("allows public live catalog and detail procedures without authentication", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.storefront.home()).resolves.toBeDefined();
    await expect(caller.storefront.listing({ id: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("keeps inventory pages capped at fifty rows", async () => {
    const caller = appRouter.createCaller(authenticatedContext());
    await expect(caller.listings.listPage({ page: 1, pageSize: 51 })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("validates bulk status actions before touching the database", async () => {
    const caller = appRouter.createCaller(authenticatedContext());
    await expect(caller.listings.bulkStatus({ ids: [1], status: "published" as "live" })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });
});
