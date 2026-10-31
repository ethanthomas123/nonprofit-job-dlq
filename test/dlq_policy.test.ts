import assert from "node:assert/strict";
import test from "node:test";
import { decideDeadLetter, reviewRequestSchema } from "../src/nonprofit_dlq_service.ts";

test("holds donor receipts even after a correction", () => {
  const input = reviewRequestSchema.parse({
    jobType: "donor_receipt",
    queue: "donor-receipts",
    failureCount: 3,
    correctionApplied: true,
    reviewId: "d2021d4f-48d7-4ce0-a05d-35ae31f3148f",
  });

  assert.deepEqual(decideDeadLetter(input), {
    action: "manual_review",
    reason: "Receipt delivery stays held until a person verifies the donor record.",
  });
});

test("redrives a corrected volunteer reminder", () => {
  const input = reviewRequestSchema.parse({
    jobType: "volunteer_reminder",
    queue: "volunteer-reminders",
    failureCount: 2,
    correctionApplied: true,
    reviewId: "6157fe19-60c5-4dbc-ae60-a3d23f2a82be",
  });

  assert.equal(decideDeadLetter(input).action, "redrive");
});
