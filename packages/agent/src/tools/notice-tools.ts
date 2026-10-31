import { appendEvidenceMarker } from "@pims/agent/lifecycle/markers.ts";
import { toJsonObject } from "@pims/agent/tools/helpers.ts";
import type {
  ToolDependencies,
  ToolHandler,
} from "@pims/agent/tools/registry.ts";
import {
  type PimsNotifyArgs,
  PimsNotifyArgsSchema,
} from "@pims/types/agent.ts";
import {
  NotifyNoRecipientsError,
  PimsErrorShapeUnknownError,
  PimsNotFoundError,
  ReviewApprovalInvalidError,
  ReviewApprovalMissingError,
} from "@pims/types/errors.ts";
import type { JsonValue } from "@pims/types/models.ts";
import {
  AuthorityNoticePackSchema,
  SubjectNoticePackSchema,
} from "@pims/types/notices.ts";
import type { PimsIncident, PimsIncidentHistory } from "@pims/types/pims.ts";

interface ResolvedPack {
  packType: "authority" | "subject";
  packId: string;
  payload: JsonValue;
  contentSha256: string;
  state: string;
}

function parsePackPayload(
  payload: JsonValue,
  packType: "authority" | "subject",
): string | null {
  const parsed =
    packType === "authority"
      ? AuthorityNoticePackSchema.safeParse(payload)
      : SubjectNoticePackSchema.safeParse(payload);
  return parsed.success ? parsed.data.pack_id : null;
}

function newestNotifiedRow(
  history: PimsIncidentHistory[],
): PimsIncidentHistory | null {
  let newest: PimsIncidentHistory | null = null;
  for (const row of history) {
    if (row.event_type !== "notified") {
      continue;
    }
    const snapshot = row.recipients_snapshot ?? [];
    if (snapshot.length === 0) {
      continue;
    }
    if (newest === null) {
      newest = row;
      continue;
    }
    const rowAt = new Date(row.changed_at).getTime();
    const newestAt = new Date(newest.changed_at).getTime();
    if (rowAt > newestAt || (rowAt === newestAt && row.id > newest.id)) {
      newest = row;
    }
  }
  return newest;
}

function alreadyDeliveredForPack(
  incident: PimsIncident,
  packType: "authority" | "subject",
  history: PimsIncidentHistory[],
): PimsIncidentHistory | null {
  const newest = newestNotifiedRow(history);
  if (newest === null) {
    return null;
  }
  if (packType === "authority") {
    return incident.measure_reported_authorities === "Y" ? newest : null;
  }
  const markers = (incident.evidence_refs ?? "")
    .split(";")
    .map((marker) => marker.trim());
  return markers.some((marker) => marker.startsWith("SUBJECT_NOTIFIED:"))
    ? newest
    : null;
}

export function createNoticeToolHandlers(
  deps: ToolDependencies,
): Partial<Record<string, ToolHandler>> {
  const schema = deps.config.PIMS_SCHEMA;

  return {
    pims_notify: async (ctx, rawArgs) => {
      const args = PimsNotifyArgsSchema.parse(rawArgs) as PimsNotifyArgs;
      const incident = await deps.adapter.getIncident(args.incident_id);
      const code = incident.incident_code;

      const authorityRow = await deps.evidenceStore.getDraftPack(
        code,
        "authority",
      );
      const subjectRow = await deps.evidenceStore.getDraftPack(code, "subject");

      let resolved: ResolvedPack | null = null;
      if (
        authorityRow !== null &&
        parsePackPayload(authorityRow.payload, "authority") === args.pack_id
      ) {
        resolved = {
          packType: "authority",
          packId: args.pack_id,
          payload: authorityRow.payload,
          contentSha256: authorityRow.contentSha256,
          state: authorityRow.state,
        };
      } else if (
        subjectRow !== null &&
        parsePackPayload(subjectRow.payload, "subject") === args.pack_id
      ) {
        resolved = {
          packType: "subject",
          packId: args.pack_id,
          payload: subjectRow.payload,
          contentSha256: subjectRow.contentSha256,
          state: subjectRow.state,
        };
      }

      if (resolved === null) {
        throw new PimsNotFoundError("draft_pack", args.pack_id);
      }
      const pack = resolved;

      if (pack.state !== "approved") {
        throw new ReviewApprovalMissingError(
          `Pack ${pack.packId} is in state '${pack.state}', not 'approved'`,
        );
      }

      const approval = await deps.evidenceStore.getReviewApproval(
        args.review_approval_id,
      );
      if (approval === null) {
        throw new ReviewApprovalInvalidError(
          `Unknown review approval ${args.review_approval_id}`,
        );
      }
      if (approval.consumed_at_utc !== null) {
        throw new ReviewApprovalInvalidError(
          `Review approval ${args.review_approval_id} was already consumed`,
        );
      }
      if (approval.incident_code !== code) {
        throw new ReviewApprovalInvalidError(
          `Review approval ${args.review_approval_id} belongs to ${approval.incident_code}`,
        );
      }
      if (approval.pack_type !== pack.packType) {
        throw new ReviewApprovalInvalidError(
          `Review approval ${args.review_approval_id} covers ${approval.pack_type}`,
        );
      }
      if (approval.content_sha256 !== pack.contentSha256) {
        throw new ReviewApprovalInvalidError(
          "Review approval content hash does not match the pack",
        );
      }

      const recipients = await deps.adapter.listRecipients();
      const activeRecipients = recipients.results.filter(
        (recipient) => recipient.is_active !== false,
      );
      if (activeRecipients.length === 0) {
        throw new NotifyNoRecipientsError();
      }

      const historyBefore = await deps.adapter.getIncidentHistory(
        args.incident_id,
      );
      const currentIncident = await deps.adapter.getIncident(args.incident_id);
      const alreadySent = alreadyDeliveredForPack(
        currentIncident,
        pack.packType,
        historyBefore,
      );

      if (alreadySent !== null) {
        await deps.evidenceStore.saveDraftPack(
          code,
          pack.packType,
          pack.payload,
          pack.contentSha256,
          args.review_approval_id,
          "sent",
        );
        await deps.evidenceStore.consumeReviewApproval(
          args.review_approval_id,
          pack.contentSha256,
          `pims_notify:${pack.packType}`,
        );
        if (pack.packType === "authority") {
          await deps.adapter.updateIncident(
            args.incident_id,
            { measure_reported_authorities: "Y" },
            {
              incidentCode: code,
              idempotencyKey: ctx.idempotencyKey ?? undefined,
            },
          );
        }
        return toJsonObject({
          notified_at_utc: alreadySent.changed_at,
          recipients_snapshot: alreadySent.recipients_snapshot ?? [],
          history_id: alreadySent.id,
        });
      }

      await deps.adapter.notifyIncident(args.incident_id, {
        incidentCode: code,
        idempotencyKey: ctx.idempotencyKey ?? undefined,
      });

      const historyAfter = await deps.adapter.getIncidentHistory(
        args.incident_id,
      );
      const notified = newestNotifiedRow(historyAfter);
      if (notified === null) {
        throw new PimsErrorShapeUnknownError(
          "NOTIFY_UNCONFIRMED",
          JSON.stringify(historyAfter),
        );
      }
      const snapshot = notified.recipients_snapshot ?? [];
      if (snapshot.length === 0) {
        throw new PimsErrorShapeUnknownError(
          "NOTIFY_UNCONFIRMED",
          JSON.stringify(historyAfter),
        );
      }

      await deps.evidenceStore.saveDraftPack(
        code,
        pack.packType,
        pack.payload,
        pack.contentSha256,
        args.review_approval_id,
        "sent",
      );
      await deps.evidenceStore.consumeReviewApproval(
        args.review_approval_id,
        pack.contentSha256,
        `pims_notify:${pack.packType}`,
      );

      if (pack.packType === "authority") {
        await deps.adapter.updateIncident(
          args.incident_id,
          { measure_reported_authorities: "Y" },
          {
            incidentCode: code,
            idempotencyKey: ctx.idempotencyKey ?? undefined,
          },
        );
      } else {
        const updated = await deps.adapter.getIncident(args.incident_id);
        await appendEvidenceMarker(
          deps.adapter,
          deps.evidenceStore,
          updated,
          `SUBJECT_NOTIFIED:${snapshot.length}:email`,
          schema,
        );
      }

      return toJsonObject({
        notified_at_utc: notified.changed_at,
        recipients_snapshot: snapshot,
        history_id: notified.id,
      });
    },
  };
}
