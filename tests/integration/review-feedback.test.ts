import type { JsonObject } from "@pims/types/models.ts";
import {
  type IntegrationHarness,
  intakeFixture,
  startIntegrationHarness,
} from "@tests/helpers/integration-harness.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("Review feedback redraft loop", { timeout: 240_000 }, () => {
  let harness: IntegrationHarness;
  let subjectChallengeCalls = 0;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      autoNotify: false,
      chatHandler: (args): JsonObject | null => {
        const firstMessage = args.messages[0];
        const prompt =
          firstMessage !== undefined && typeof firstMessage.content === "string"
            ? firstMessage.content
            : "";
        const isSubjectChallenge =
          args.system.includes("You review") &&
          prompt.includes('"pack_type":"subject"');
        if (!isSubjectChallenge) {
          return null;
        }
        subjectChallengeCalls += 1;
        if (subjectChallengeCalls === 1) {
          return {
            challenges: [
              {
                target: "body_plain",
                challenge:
                  "The body never names which personal data categories were exposed.",
                severity: "high",
                evidence_required:
                  "Name each affected-data category from the incident in body_plain.",
              },
            ],
          };
        }
        return null;
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (harness) {
      await harness.stop();
    } else {
      expect(harness).toBeUndefined();
    }
  });

  it("redrafts with reviewer feedback after a rejection instead of re-reviewing identical bytes", async () => {
    const { agent } = harness;
    const intake = await agent.orchestrator.intake(intakeFixture());

    const subjectSpy = vi.spyOn(agent.draftService, "draftSubject");
    const authoritySpy = vi.spyOn(agent.draftService, "draftAuthority");

    const result = await agent.orchestrator.draftAndReview(intake.incident.id, {
      phaseDueAtUtc: new Date(
        harness.now.getTime() + 24 * 3_600_000,
      ).toISOString(),
    });

    expect(subjectChallengeCalls).toBe(2);
    expect(result.subject_pack_id).not.toBeNull();
    expect(result.subject_approval_id).not.toBeNull();
    expect(authoritySpy).toHaveBeenCalledTimes(1);
    expect(subjectSpy).toHaveBeenCalledTimes(2);
    expect(subjectSpy.mock.calls[0]?.[4]).toBeUndefined();
    const redraftFeedback = subjectSpy.mock.calls[1]?.[4];
    expect(typeof redraftFeedback).toBe("string");
    expect(redraftFeedback).toContain("body_plain");
    expect(redraftFeedback).toContain(
      "never names which personal data categories",
    );

    subjectSpy.mockRestore();
    authoritySpy.mockRestore();
  });
});
