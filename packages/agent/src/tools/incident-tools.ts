import crypto from "node:crypto";
import { appendEvidenceMarker } from "@pims/agent/lifecycle/markers.ts";
import { assertPostHistory, toJsonObject } from "@pims/agent/tools/helpers.ts";
import {
  ROLE_TRANSITION_TARGETS,
  type ToolDependencies,
  type ToolHandler,
} from "@pims/agent/tools/registry.ts";
import {
  type PimsAddActionArgs,
  PimsAddActionArgsSchema,
  type PimsCreateIncidentArgs,
  PimsCreateIncidentArgsSchema,
  type PimsGetHistoryArgs,
  PimsGetHistoryArgsSchema,
  type PimsGetIncidentArgs,
  PimsGetIncidentArgsSchema,
  type PimsListIncidentsArgs,
  PimsListIncidentsArgsSchema,
  type PimsListRecipientsArgs,
  PimsListRecipientsArgsSchema,
  type PimsManageRecipientArgs,
  PimsManageRecipientArgsSchema,
  type PimsTransitionStatusArgs,
  PimsTransitionStatusArgsSchema,
  type PimsUpdateIncidentArgs,
  PimsUpdateIncidentArgsSchema,
  type PimsUploadAttachmentArgs,
  PimsUploadAttachmentArgsSchema,
} from "@pims/types/agent.ts";
import {
  ActionSequenceViolationError,
  AttachmentHashMismatchError,
  CloseChecklistFailedError,
  PimsClientBugError,
  PimsNotFoundError,
  PimsValidationError,
  ReviewApprovalMissingError,
  ReviewApprovalReusedError,
  TransitionForbiddenError,
} from "@pims/types/errors.ts";
import type { PimsIncidentAction } from "@pims/types/pims.ts";
import { z } from "zod";

const REOPEN_REASON_PATTERN = /^REOPENED:[A-Za-z0-9:_-]+$/;
const UNASSIGNED_RESPONSIBLE = "UNASSIGNED";

const ReopenBaselineSchema = z.object({
  action_count: z.number().int().nonnegative(),
});

function isAllowedTransition(from: string, to: string): boolean {
  return (
    (from === "O" && to === "P") ||
    (from === "P" && to === "C") ||
    (from === "C" && to === "P")
  );
}

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function createIncidentToolHandlers(
  deps: ToolDependencies,
): Partial<Record<string, ToolHandler>> {
  const schema = deps.config.PIMS_SCHEMA;

  return {
    pims_list_incidents: async (_ctx, rawArgs) => {
      const args = PimsListIncidentsArgsSchema.parse(
        rawArgs,
      ) as PimsListIncidentsArgs;
      const page = await deps.adapter.listIncidents({
        search: args.search,
        status: args.status,
        severity: args.severity,
        incident_type: args.incident_type,
        page: args.page,
        page_size: args.page_size,
      });
      return toJsonObject(page);
    },

    pims_get_incident: async (_ctx, rawArgs) => {
      const args = PimsGetIncidentArgsSchema.parse(
        rawArgs,
      ) as PimsGetIncidentArgs;
      return toJsonObject(await deps.adapter.getIncident(args.id));
    },

    pims_create_incident: async (ctx, rawArgs) => {
      const args = PimsCreateIncidentArgsSchema.parse(
        rawArgs,
      ) as PimsCreateIncidentArgs;
      const incident = await deps.adapter.createIncident(
        {
          title: args.title,
          description: args.description ?? null,
          involves_personal_data: args.involves_personal_data,
          incident_date: args.incident_date,
          incident_time: args.incident_time ?? null,
          detection_date: args.detection_date ?? null,
          detection_time: args.detection_time ?? null,
          incident_type: args.incident_type,
          status: args.status,
          severity: args.severity ?? null,
          impact: args.impact ?? null,
          affected_data_types: args.affected_data_types,
          security_measures_adopted: args.security_measures_adopted,
          affected_cid: args.affected_cid,
          incident_code: args.incident_code,
          rep_document_number: args.rep_document_number ?? null,
          rep_document_expiry: args.rep_document_expiry ?? null,
          rep_first_name: args.rep_first_name ?? null,
          rep_last_name_p: args.rep_last_name_p ?? null,
          rep_last_name_m: args.rep_last_name_m ?? null,
          rep_position: args.rep_position ?? null,
          rep_phone: args.rep_phone ?? null,
          rep_email: args.rep_email ?? null,
          entity_type: args.entity_type ?? null,
          entity_ruc: args.entity_ruc ?? null,
          entity_name: args.entity_name ?? null,
          entity_phone: args.entity_phone ?? null,
          entity_extension: args.entity_extension ?? null,
          entity_department: args.entity_department ?? null,
          entity_province: args.entity_province ?? null,
          entity_district: args.entity_district ?? null,
          reported_by: args.reported_by ?? null,
          assigned_to: args.assigned_to ?? null,
          affected_treatment: args.affected_treatment ?? null,
          dpo_contact_name: args.dpo_contact_name ?? null,
          dpo_contact_email: args.dpo_contact_email ?? null,
          dpo_contact_phone: args.dpo_contact_phone ?? null,
          num_affected_subjects: args.num_affected_subjects ?? null,
          compromised_system: args.compromised_system ?? null,
          affected_url: args.affected_url ?? null,
          evidence_refs: args.evidence_refs ?? null,
          measure_updated_registry: args.measure_updated_registry ?? null,
          measure_new_security: args.measure_new_security ?? null,
          measure_improved_policies: args.measure_improved_policies ?? null,
          measure_considered_resolved: args.measure_considered_resolved ?? null,
          measure_reported_authorities:
            args.measure_reported_authorities ?? null,
          resolved_date: args.resolved_date ?? null,
        },
        {
          incidentCode: args.incident_code ?? null,
          idempotencyKey: ctx.idempotencyKey ?? undefined,
        },
      );
      return toJsonObject({
        id: incident.id,
        incident_code: incident.incident_code,
        incident,
      });
    },

    pims_update_incident: async (ctx, rawArgs) => {
      const args = PimsUpdateIncidentArgsSchema.parse(
        rawArgs,
      ) as PimsUpdateIncidentArgs;
      const incident = await deps.adapter.updateIncident(args.id, args.patch, {
        incidentCode: ctx.incidentCode ?? null,
        idempotencyKey: ctx.idempotencyKey ?? undefined,
      });
      return toJsonObject(incident);
    },

    pims_transition_status: async (ctx, rawArgs) => {
      const args = PimsTransitionStatusArgsSchema.parse(
        rawArgs,
      ) as PimsTransitionStatusArgs;
      const incident = await deps.adapter.getIncident(args.id);
      const from = incident.status;
      const to = args.to;

      const permittedTargets = ROLE_TRANSITION_TARGETS[ctx.role];
      if (permittedTargets === undefined || !permittedTargets.includes(to)) {
        throw new TransitionForbiddenError(from, to);
      }
      if (!isAllowedTransition(from, to)) {
        throw new TransitionForbiddenError(from, to);
      }

      if (from === "O" && to === "P") {
        const classificationComplete =
          incident.severity !== null &&
          incident.severity !== undefined &&
          incident.impact !== null &&
          incident.impact !== undefined;
        const timers = await deps.evidenceStore.listActiveTimers(
          incident.incident_code,
        );
        if (!classificationComplete || timers.length < 1) {
          throw new TransitionForbiddenError(from, to);
        }
      }

      if (from === "P" && to === "C") {
        const checklist = await deps.closeChecklist.verify(incident);
        const failed = checklist.items.find((item) => !item.passed);
        if (failed !== undefined) {
          throw new CloseChecklistFailedError(failed.item);
        }
      }

      if (from === "C" && to === "P") {
        if (!REOPEN_REASON_PATTERN.test(args.reason)) {
          throw new TransitionForbiddenError(from, to);
        }
        const evidenceId = args.reason.slice("REOPENED:".length);
        const attachmentMatch = (incident.attachments ?? []).some(
          (attachment) => String(attachment.id) === evidenceId,
        );
        const markerMatch = (incident.evidence_refs ?? "")
          .split(";")
          .map((marker) => marker.trim())
          .includes(`REOPENED:${evidenceId}`);
        if (!attachmentMatch && !markerMatch) {
          throw new TransitionForbiddenError(from, to);
        }
      }

      const updated = await deps.adapter.updateIncident(
        args.id,
        { status: to },
        {
          incidentCode: incident.incident_code,
          idempotencyKey: ctx.idempotencyKey ?? undefined,
        },
      );
      return toJsonObject(updated);
    },

    pims_add_action: async (ctx, rawArgs) => {
      const args = PimsAddActionArgsSchema.parse(rawArgs) as PimsAddActionArgs;
      const incident = await deps.adapter.getIncident(args.incident_id);
      const code = incident.incident_code;
      const actions = incident.actions ?? [];

      const baselineRaw = await deps.evidenceStore.getAgentState(
        `REOPEN_BASELINE:${code}`,
      );
      const baseline = ReopenBaselineSchema.safeParse(baselineRaw);
      const epochActions = baseline.success
        ? actions.slice(baseline.data.action_count)
        : actions;

      const hasAnalysis = epochActions.some(
        (action) => action.action_type === "A",
      );
      const hasResolution = epochActions.some(
        (action) => action.action_type === "R",
      );

      if (args.action_type === "C" && (hasAnalysis || hasResolution)) {
        throw new ActionSequenceViolationError(
          `Containment action for ${code} cannot follow A/R actions in the current epoch`,
        );
      }
      if (args.action_type === "A" && hasResolution) {
        throw new ActionSequenceViolationError(
          `Analysis action for ${code} cannot follow an R action in the current epoch`,
        );
      }

      let approvalSha256: string | null = null;
      if (args.action_type === "R") {
        if (!hasAnalysis || hasResolution) {
          throw new ActionSequenceViolationError(
            `Resolution action for ${code} requires at least one A action and no prior R in the current epoch`,
          );
        }
        if (args.review_approval_id === undefined) {
          throw new ReviewApprovalMissingError(
            `Resolution action for ${code} requires review_approval_id`,
          );
        }
        const approval = await deps.evidenceStore.getReviewApproval(
          args.review_approval_id,
        );
        if (approval === null) {
          throw new ReviewApprovalMissingError(
            `Unknown review approval ${args.review_approval_id}`,
          );
        }
        if (approval.consumed_at_utc !== null) {
          throw new ReviewApprovalReusedError(
            `Review approval ${args.review_approval_id} was already consumed`,
          );
        }
        if (approval.pack_type !== "resolution") {
          throw new ReviewApprovalMissingError(
            `Review approval ${args.review_approval_id} does not cover a resolution`,
          );
        }
        if (approval.incident_code !== code) {
          throw new ReviewApprovalMissingError(
            `Review approval ${args.review_approval_id} belongs to ${approval.incident_code}`,
          );
        }
        approvalSha256 = approval.content_sha256;
      }

      const action: PimsIncidentAction = {
        action_type: args.action_type,
        responsible: args.responsible ?? UNASSIGNED_RESPONSIBLE,
        action_date: args.action_date ?? todayUtc(ctx.now),
        description: args.description,
        evidence: args.evidence ?? null,
      };

      let updated = await deps.adapter.appendIncidentAction(
        args.incident_id,
        action,
        {
          incidentCode: code,
          idempotencyKey: ctx.idempotencyKey ?? undefined,
        },
      );
      await assertPostHistory(deps.adapter, args.incident_id, "updated");

      if (args.review_approval_id !== undefined && approvalSha256 !== null) {
        await deps.evidenceStore.consumeReviewApproval(
          args.review_approval_id,
          approvalSha256,
          "pims_add_action",
        );
      }

      if (args.responsible === undefined) {
        updated = await appendEvidenceMarker(
          deps.adapter,
          deps.evidenceStore,
          updated,
          `${UNASSIGNED_RESPONSIBLE}:${code}`,
          schema,
        );
      }

      const updatedActions = updated.actions ?? [];
      const lastAction = updatedActions[updatedActions.length - 1];
      if (lastAction === undefined) {
        throw new PimsClientBugError(
          `Incident ${code} returned no actions after append`,
        );
      }

      return toJsonObject({ action: lastAction, incident: updated });
    },

    pims_upload_attachment: async (ctx, rawArgs) => {
      const args = PimsUploadAttachmentArgsSchema.parse(
        rawArgs,
      ) as PimsUploadAttachmentArgs;
      const incident = await deps.adapter.getIncident(args.incident_id);
      const code = incident.incident_code;

      const bytes = await deps.evidenceStore.getStagedAttachmentBytes(
        schema,
        code,
        args.file_name,
      );
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== args.bytes_ref.toLowerCase()) {
        throw new AttachmentHashMismatchError();
      }

      deps.forensicScanner.validateAttachment(args.file_name, bytes.length);

      const uploaded = await deps.adapter.uploadIncidentAttachment(
        args.incident_id,
        bytes,
        args.file_name,
        {
          incidentCode: code,
          idempotencyKey: ctx.idempotencyKey ?? undefined,
        },
      );
      const attachment = uploaded.find(
        (candidate) => candidate.file_name === args.file_name,
      );
      if (attachment === undefined) {
        throw new PimsNotFoundError("IncidentAttachment", args.file_name);
      }

      const downloaded = await deps.adapter.downloadAttachment(
        attachment.file,
        { incidentCode: code },
      );
      deps.forensicScanner.verifyPostUploadHash(sha256, downloaded);

      await deps.evidenceStore.markStagedAttachmentUploaded(
        code,
        args.file_name,
        sha256,
        attachment.id,
      );

      const staged = await deps.evidenceStore.listStagedAttachments(code);
      const stagedRow = staged.find(
        (candidate) =>
          candidate.file_name === args.file_name && candidate.sha256 === sha256,
      );

      return toJsonObject({
        attachment_id: attachment.id,
        file: attachment.file,
        file_name: args.file_name,
        uploaded_at: attachment.uploaded_at ?? ctx.now.toISOString(),
        sha256,
        forensic_scan: stagedRow?.forensic_scan ?? null,
      });
    },

    pims_list_recipients: async (_ctx, rawArgs) => {
      const args = PimsListRecipientsArgsSchema.parse(
        rawArgs,
      ) as PimsListRecipientsArgs;
      const page = await deps.adapter.listRecipients();
      const results = args.active_only
        ? page.results.filter((recipient) => recipient.is_active !== false)
        : page.results;
      return toJsonObject(results);
    },

    pims_manage_recipient: async (_ctx, rawArgs) => {
      const args = PimsManageRecipientArgsSchema.parse(
        rawArgs,
      ) as PimsManageRecipientArgs;
      if (args.operator_jwt_sub.trim().length === 0) {
        throw new PimsValidationError("operator_jwt_sub", "REQUIRED");
      }

      if (args.op === "create") {
        const created = await deps.adapter.createRecipient(
          {
            email: args.email,
            label: args.label,
            is_active: args.is_active ?? true,
          },
          { idempotencyKey: _ctx.idempotencyKey ?? undefined },
        );
        return toJsonObject({
          id: created.id,
          email: created.email,
          is_active: created.is_active,
          op: "create",
        });
      }

      const page = await deps.adapter.listRecipients();
      const existing = page.results.find(
        (recipient) => recipient.id === args.id,
      );
      if (existing === undefined) {
        throw new PimsNotFoundError("IncidentRecipient", args.id);
      }
      await deps.adapter.deleteRecipient(args.id, {
        idempotencyKey: _ctx.idempotencyKey ?? undefined,
      });
      return toJsonObject({
        id: existing.id,
        email: existing.email,
        is_active: existing.is_active,
        op: "delete",
      });
    },

    pims_get_history: async (_ctx, rawArgs) => {
      const args = PimsGetHistoryArgsSchema.parse(
        rawArgs,
      ) as PimsGetHistoryArgs;
      const history = await deps.adapter.getIncidentHistory(args.incident_id);
      return toJsonObject(history);
    },
  };
}
