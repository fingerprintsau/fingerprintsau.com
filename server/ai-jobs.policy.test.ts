import { describe, expect, it } from "vitest";
import { summarizeAiBulkStatuses, videoChargeDecision } from "./aiJobs";

describe("AI charging lifecycle", () => {
  it("keeps a queued video reserved, charges when ready, and refunds failures or 24-hour timeouts", () => {
    expect(videoChargeDecision("queued", 10_000)).toBe("wait");
    expect(videoChargeDecision("ready", 10_000)).toBe("complete");
    expect(videoChargeDecision("failed", 10_000)).toBe("refund");
    expect(videoChargeDecision("queued", 24 * 60 * 60 * 1000)).toBe("refund");
  });
});

describe("AI bulk job progress", () => {
  it("counts completed items and leaves queued work resumable", () => {
    expect(summarizeAiBulkStatuses(["succeeded", "failed", "skipped", "processing", "queued"])).toEqual({
      processed: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      resumable: true,
    });
  });
});
