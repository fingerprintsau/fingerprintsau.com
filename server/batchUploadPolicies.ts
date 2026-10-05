export const FREE_BATCH_MAX_LISTINGS = 1;
export const BATCH_DEFAULT_PHOTOS_PER_LISTING = 12;

export type SellerPlan = "free" | "basic" | "plus" | "pro" | "ultra";

export function canSplitBatch(plan: SellerPlan, role: "user" | "admin", isOwner: boolean) {
  return role === "admin" || isOwner || plan !== "free";
}

export function assertBatchListingLimit(input: {
  requestedListings: number;
  plan: SellerPlan;
  role: "user" | "admin";
  isOwner: boolean;
  freeLimit?: number;
}) {
  const limit = input.freeLimit ?? FREE_BATCH_MAX_LISTINGS;
  if (!Number.isInteger(input.requestedListings) || input.requestedListings < 1) {
    throw new Error("A batch must contain at least one listing.");
  }
  if (!canSplitBatch(input.plan, input.role, input.isOwner) && input.requestedListings > limit) {
    throw new Error(`Free-plan sellers can create up to ${limit} listing per batch. Create many listings at once on a paid plan — coming soon.`);
  }
}

export function defaultBatchGroupSize(plan: SellerPlan, role: "user" | "admin", isOwner: boolean) {
  return canSplitBatch(plan, role, isOwner) ? 1 : BATCH_DEFAULT_PHOTOS_PER_LISTING;
}
