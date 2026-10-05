import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "./_core/env";
import { eligibleLivePhotoCount, isLaunchBonusActive, shouldCheckLaunchBonusAfterStatusChange, shouldGrantLaunchBonus } from "./launchBonus";

const originalEndsAt = ENV.launchBonusEndsAt;

afterEach(() => {
  ENV.launchBonusEndsAt = originalEndsAt;
});

describe("Founding Seller launch bonus", () => {
  it("grants exactly once when two live listings have photos", () => {
    const input = { active: true, eligibleListings: 2, role: "user", isOwner: false };
    expect(shouldGrantLaunchBonus({ ...input, alreadyGranted: false })).toBe(true);
    expect(shouldGrantLaunchBonus({ ...input, alreadyGranted: true })).toBe(false);
  });

  it("stays off when the setting is empty and after the end date", () => {
    ENV.launchBonusEndsAt = "";
    expect(isLaunchBonusActive()).toBe(false);
    ENV.launchBonusEndsAt = "2000-01-01T00:00:00.000Z";
    expect(isLaunchBonusActive()).toBe(false);
  });

  it("does not count live listings without photos", () => {
    expect(eligibleLivePhotoCount([
      { status: "live", imageUrls: "[]" },
      { status: "live", imageUrls: null },
      { status: "draft", imageUrls: '["/manus-storage/draft.jpg"]' },
      { status: "live", imageUrls: '["/manus-storage/live.jpg"]' },
    ])).toBe(1);
    expect(shouldGrantLaunchBonus({ active: true, alreadyGranted: false, eligibleListings: 1, role: "user", isOwner: false })).toBe(false);
  });

  it("checks after single and bulk live status changes only", () => {
    expect(shouldCheckLaunchBonusAfterStatusChange("live")).toBe(true);
    expect(shouldCheckLaunchBonusAfterStatusChange("draft")).toBe(false);
    expect(shouldCheckLaunchBonusAfterStatusChange("review")).toBe(false);
  });

  it("excludes admin and owner accounts", () => {
    const base = { active: true, alreadyGranted: false, eligibleListings: 2 };
    expect(shouldGrantLaunchBonus({ ...base, role: "admin", isOwner: false })).toBe(false);
    expect(shouldGrantLaunchBonus({ ...base, role: "user", isOwner: true })).toBe(false);
  });
});
