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

  it("names the flagged sentence in PII rejections so redrafts can rephrase it", async () => {
    const { adapter, agent, authorityCitation } = harness;
    const intake = await agent.orchestrator.intake(
      intakeFixture({ title: "PII feedback fixture" }),
    );
    const incident = await adapter.getIncident(intake.incident.id);
    const body =
      "Su cuenta fue bloqueada por seguridad. Recibirá nuevas instrucciones por el canal oficial. Revise su bandeja con atención.";
    const flaggedStart = body.indexOf("Recibirá");

    const analyzeSpy = vi
      .spyOn(agent.presidioClient, "analyze")
      .mockResolvedValueOnce([
        {
          entity_type: "PERSON",
          start: flaggedStart,
          end: flaggedStart + "Recibirá".length,
          score: 0.85,
        },
      ]);

    const result = await agent.reviewer.review(
      {
        incident_code: incident.incident_code,
        pack_type: "subject",
        content_sha256: "b2".repeat(32),
        body_text: body,
        citations: [authorityCitation],
        numeric_approvals: [],
        plain_language_waiver: null,
        checklist: null,
      },
      incident,
    );

    expect(result.approved).toBe(false);
    expect(result.rejection?.item).toBe("pii_leakage");
    expect(result.rejection?.required_fix).toContain("sentence 2 (PERSON)");
    expect(result.rejection?.required_fix).toContain(
      "Recibirá nuevas instrucciones",
    );

    analyzeSpy.mockRestore();
  });
});
