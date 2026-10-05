import { ENV } from "./_core/env";

export const LAUNCH_BONUS_CODE = "founding_seller";
export const LAUNCH_BONUS_REQUIRED_LISTINGS = 2;

export function launchBonusCredits() {
  return Number.isFinite(ENV.launchBonusCredits) && ENV.launchBonusCredits > 0 ? Math.floor(ENV.launchBonusCredits) : 100;
}

export function isLaunchBonusActive(now = Date.now()) {
  if (!ENV.launchBonusEndsAt.trim()) return false;
  const endsAt = Date.parse(ENV.launchBonusEndsAt);
  return Number.isFinite(endsAt) && now < endsAt;
}

export function eligibleLivePhotoCount(listings: Array<{ status: string; imageUrls: string | null }>) {
  return listings.filter((listing) => {
    if (listing.status !== "live" || !listing.imageUrls) return false;
    try {
      const photos = JSON.parse(listing.imageUrls);
      return Array.isArray(photos) && photos.some((photo) => typeof photo === "string" && photo.length > 0);
    } catch {
      return false;
    }
  }).length;
}

export function shouldGrantLaunchBonus(input: { active: boolean; alreadyGranted: boolean; eligibleListings: number; role: string; isOwner: boolean }) {
  return input.active && !input.alreadyGranted && input.eligibleListings >= LAUNCH_BONUS_REQUIRED_LISTINGS && input.role !== "admin" && !input.isOwner;
}

export function shouldCheckLaunchBonusAfterStatusChange(status: string) {
  return status === "live";
}
