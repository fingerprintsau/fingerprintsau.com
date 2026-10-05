import { describe, expect, it } from "vitest";
import { isCreditEligiblePaymentStatus } from "./billing";
import { calculateUsageReservation } from "./db";

describe("metered feature policy", () => {
  it("keeps one background removal free even with no available credits", () => {
    expect(calculateUsageReservation({ units: 1, freeAllowance: 0, freeUsed: 99, creditsAvailable: 0, unitPriceCents: 12, alwaysFree: true })).toEqual({
      freeUnits: 1,
      paidUnits: 0,
      chargedCents: 0,
    });
  });

  it("still charges batch units when no credits are available", () => {
    expect(() => calculateUsageReservation({ units: 2, freeAllowance: 0, freeUsed: 0, creditsAvailable: 0, unitPriceCents: 12 })).toThrow("needs 2 credits");
  });
});

describe("Stripe credit eligibility", () => {
  it("accepts paid and 100%-off no-payment-required checkouts", () => {
    expect(isCreditEligiblePaymentStatus("paid")).toBe(true);
    expect(isCreditEligiblePaymentStatus("no_payment_required")).toBe(true);
    expect(isCreditEligiblePaymentStatus("unpaid")).toBe(false);
    expect(isCreditEligiblePaymentStatus(undefined)).toBe(false);
  });
});

// Store slugs are intentionally absent from the duplicate-update set in upsertUser;
// this preserves the value created on the account's first insert.
