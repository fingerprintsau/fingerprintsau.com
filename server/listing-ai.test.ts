import { describe, expect, it } from "vitest";
import { appendListingImages, assertSelectedListingPhotos } from "./aiPolicies";
import { featurePrice } from "./routers";

describe("listing AI policies", () => {
  it("publishes the per-use prices used by listing tools", () => {
    expect(featurePrice("listingCopy", 1)).toBe(19);
    expect(featurePrice("modelImage", 1)).toBe(89);
    expect(featurePrice("conditionReport", 1)).toBe(39);
    expect(featurePrice("video", 1)).toBe(149);
    expect(featurePrice("backgroundRemoveSingle", 1)).toBe(0);
    expect(featurePrice("backgroundRemoveBatch", 1)).toBe(12);
  });

  it("keeps originals and appends generated photos to the same listing gallery", () => {
    expect(appendListingImages(["/manus-storage/listing-a"], ["/manus-storage/generated-a"])).toEqual([
      "/manus-storage/listing-a",
      "/manus-storage/generated-a",
    ]);
    expect(appendListingImages(Array.from({ length: 12 }, (_, index) => `/manus-storage/${index}`), ["/manus-storage/generated"])).toHaveLength(12);
  });

  it("rejects photos from another listing and prevents overfilled galleries", () => {
    expect(() => assertSelectedListingPhotos(["/manus-storage/a"], ["/manus-storage/not-this-listing"])).toThrow("do not belong");
    expect(() => assertSelectedListingPhotos(Array.from({ length: 12 }, (_, index) => `/manus-storage/${index}`), ["/manus-storage/0"])).toThrow("up to 12");
  });

  it("requires a listing id at the protected AI router boundary", async () => {
    const caller = (await import("./routers")).appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    await expect(caller.ai.writeListing({ listingId: 999, notes: "test" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
