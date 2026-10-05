import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("product.catalog", () => {
  it("exposes the free-use policy, priced add-ons, and credit packs", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const catalog = await caller.product.catalog();

    expect(catalog.pricing.modelImage.firstTwoFree).toBe(true);
    expect(catalog.pricing.listingCopy.firstTwoFree).toBe(true);
    expect(catalog.pricing.conditionReport.firstTwoFree).toBe(true);
    expect(catalog.pricing.modelImage.priceCents).toBe(89);
    expect(catalog.pricing.listingCopy.priceCents).toBe(19);
    expect(catalog.pricing.conditionReport.priceCents).toBe(39);
    expect(catalog.pricing.video.priceCents).toBe(149);
    expect(catalog.pricing.backgroundRemove.priceCents).toBe(0);
    expect(catalog.pricing.backgroundRemoveBatch.priceCents).toBe(12);
    expect(catalog.creditPacks).toHaveLength(3);
    expect(catalog.creditPacks.map((pack) => pack.credits)).toEqual([10, 30, 80]);
  });

  it("contains no provider names or configuration details", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const catalog = await caller.product.catalog();
    const serialized = JSON.stringify(catalog).toLowerCase();
    for (const providerName of ["manus", "nano banana", "higgsfield", "clipdrop", "gemini", "configured", "provider"]) {
      expect(serialized).not.toContain(providerName);
    }
  });
});
