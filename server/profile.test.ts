import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import { normalizeStoreSlug } from "./db";
import type { TrpcContext } from "./_core/context";

function publicContext(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function authenticatedContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "profile-user",
      email: "profile@example.com",
      name: "Profile User",
      loginMethod: "oidc",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      storeSlug: "profile-user-sample",
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("seller profile procedures", () => {
  it("protects seller profile data and photo uploads", async () => {
    const caller = appRouter.createCaller(publicContext());
    await expect(caller.profile.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
    await expect(caller.profile.checkSlug({ slug: "my-shop" })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
    await expect(caller.profile.uploadPhoto({ fileName: "avatar.jpg", contentType: "image/jpeg", data: "aGVsbG8=" })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<TRPCError>);
  });

  it("normalizes address candidates consistently", () => {
    expect(normalizeStoreSlug("  Alex's Vintage Edit  ")).toBe("alex-s-vintage-edit");
    expect(normalizeStoreSlug("!!!")).toBe("");
  });

  it("rejects invalid address formats before profile persistence", async () => {
    const caller = appRouter.createCaller(authenticatedContext());
    await expect(caller.profile.update({ displayName: "Profile User", bio: null, suburb: null, state: null, storeSlug: "Not A Slug" })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });
});
