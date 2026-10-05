import { describe, expect, it } from "vitest";
import { assertBatchListingLimit, defaultBatchGroupSize } from "./batchUploadPolicies";

describe("batch upload plan rules", () => {
  it("defaults a free seller's multi-photo batch to one listing", () => {
    expect(defaultBatchGroupSize("free", "user", false)).toBe(12);
    expect(() => assertBatchListingLimit({ requestedListings: 1, plan: "free", role: "user", isOwner: false })).not.toThrow();
  });

  it("rejects a free seller trying to create more than the configured batch limit", () => {
    expect(() => assertBatchListingLimit({ requestedListings: 2, plan: "free", role: "user", isOwner: false, freeLimit: 1 })).toThrow(/Free-plan sellers can create up to 1 listing per batch/);
  });

  it("allows admins and paid sellers to split a batch", () => {
    expect(defaultBatchGroupSize("basic", "user", false)).toBe(1);
    expect(() => assertBatchListingLimit({ requestedListings: 12, plan: "basic", role: "user", isOwner: false, freeLimit: 1 })).not.toThrow();
    expect(() => assertBatchListingLimit({ requestedListings: 12, plan: "free", role: "admin", isOwner: false, freeLimit: 1 })).not.toThrow();
    expect(() => assertBatchListingLimit({ requestedListings: 12, plan: "free", role: "user", isOwner: true, freeLimit: 1 })).not.toThrow();
  });
});
