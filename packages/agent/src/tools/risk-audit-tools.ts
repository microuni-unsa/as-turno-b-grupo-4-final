import { appendEvidenceMarker } from "@pims/agent/lifecycle/markers.ts";
import { assetIdsForSystem, toJsonObject } from "@pims/agent/tools/helpers.ts";
import type {
  ToolDependencies,
  ToolHandler,
} from "@pims/agent/tools/registry.ts";
import {
  type PimsCreateAuditActionArgs,
  PimsCreateAuditActionArgsSchema,
  type PimsEmitRiskSignalArgs,
  PimsEmitRiskSignalArgsSchema,
  type PimsSearchRisksArgs,
  PimsSearchRisksArgsSchema,
} from "@pims/types/agent.ts";
import {
  AuditLinkDuplicateError,
  AuditLinkFailedError,
  PimsNotFoundError,
  PimsUnknownCodeError,
  PimsValidationError,
  RiskSignalNoAssetError,
} from "@pims/types/errors.ts";
import type { RiskSignalPayload } from "@pims/types/evidence.ts";
import type {
  PimsAudit,
  PimsAuditActionPlan,
  PimsAuditFinding,
  RiskEvalStatus,
} from "@pims/types/pims.ts";

const CORRECTIVE_FINDING_PREFIX = "10.2 corrective action for ";

function readRiskStatus(value: string | undefined): RiskEvalStatus | undefined {
  if (value === undefined) {
    return "O";
  }
  if (value === "B" || value === "O" || value === "T" || value === "C") {
    return value;
  }
  throw new PimsValidationError(
    "status",
    `Unknown risk evaluation status: ${value}`,
  );
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function normalizeFindingActions(
  finding: PimsAuditFinding,
  fallbackDueDate: string,
): Array<{
  action_plan?: string;
  description?: string;
  responsible: string;
  due_date: string;
  status: "O" | "P" | "C";
  progress?: number;
}> {
  return (finding.actions ?? []).map((action: PimsAuditActionPlan) => ({
    action_plan: action.action_plan ?? action.description ?? "",
    responsible: action.responsible ?? "UNASSIGNED",
    due_date: action.due_date ?? fallbackDueDate,
    status: action.status,
    progress: action.progress ?? 0,
  }));
}

export function createRiskAuditToolHandlers(
  deps: ToolDependencies,
): Partial<Record<string, ToolHandler>> {
  const schema = deps.config.PIMS_SCHEMA;

  return {
    pims_search_risks: async (_ctx, rawArgs) => {
      const args = PimsSearchRisksArgsSchema.parse(
        rawArgs,
      ) as PimsSearchRisksArgs;
      const page = await deps.adapter.listRiskEvaluations();
      let results = page.results;

      if (args.search !== undefined) {
        const needle = args.search.toLowerCase();
        results = results.filter((risk) => {
          const haystack = `${risk.name} ${risk.code} ${risk.risk_code ?? ""}`;
          return haystack.toLowerCase().includes(needle);
        });
      }
      if (args.status !== undefined) {
        results = results.filter((risk) => risk.status === args.status);
      }
      if (args.page_size !== undefined) {
        results = results.slice(0, args.page_size);
      }

      return toJsonObject({
        count: results.length,
        next: null,
        previous: null,
        results,
      });
    },

    pims_emit_risk_signal: async (ctx, rawArgs) => {
      const args = PimsEmitRiskSignalArgsSchema.parse(
        rawArgs,
      ) as PimsEmitRiskSignalArgs;
      if (ctx.incidentId === null) {
        throw new PimsValidationError("incident_id", "REQUIRED");
      }
      const incident = await deps.adapter.getIncident(ctx.incidentId);
      const code = incident.incident_code;

      const catalogs = await deps.adapter.getRiskCatalogs();
      const period = catalogs.current_period;
      if (period === undefined) {
        throw new PimsValidationError("current_period", "RISK_PERIOD_MISSING");
      }

      const basePayload: RiskSignalPayload = {
        description: args.description,
        controlled_probability: args.controlled_probability,
        controlled_impact: args.controlled_impact,
        asset_ids: args.asset_ids ?? [],
        threat_code: args.threat_code ?? null,
        vulnerability_code: args.vulnerability_code ?? null,
        risk_owner: args.risk_owner ?? null,
        response_strategy: args.response_strategy ?? null,
        reason: "RISK_PERIOD_CLOSED",
        asset_pending: false,
      };

      const periodClosed =
        period.status === "C" ||
        period.is_active === false ||
        period.is_locked === true;
      if (periodClosed) {
        await deps.evidenceStore.enqueueRiskSignal(code, basePayload);
        return toJsonObject({
          queued: true,
          period_name: period.name,
          queued_at_utc: ctx.now.toISOString(),
          reason: "RISK_PERIOD_CLOSED",
        });
      }

      let assetIds = args.asset_ids ?? [];
      if (assetIds.length === 0) {
        assetIds = await assetIdsForSystem(
          deps.adapter,
          incident.compromised_system,
        );
        if (assetIds.length === 0) {
          await deps.evidenceStore.enqueueRiskSignal(code, {
            ...basePayload,
            reason: "RISK_SIGNAL_NO_ASSET",
            asset_pending: true,
          });
          throw new RiskSignalNoAssetError();
        }
      }

      if (
        args.threat_code !== undefined &&
        !catalogs.threats.some((threat) => threat.code === args.threat_code)
      ) {
        throw new PimsUnknownCodeError("threat_code", args.threat_code);
      }
      if (
        args.vulnerability_code !== undefined &&
        !catalogs.vulnerabilities.some(
          (vulnerability) => vulnerability.code === args.vulnerability_code,
        )
      ) {
        throw new PimsUnknownCodeError(
          "vulnerability_code",
          args.vulnerability_code,
        );
      }

      const dimension = catalogs.active_matrix?.dimension;
      if (dimension === undefined) {
        throw new PimsValidationError(
          "active_matrix",
          "MATRIX_DIMENSION_MISSING",
        );
      }
      if (
        args.controlled_probability < 1 ||
        args.controlled_probability > dimension
      ) {
        throw new PimsValidationError("controlled_probability");
      }
      if (args.controlled_impact < 1 || args.controlled_impact > dimension) {
        throw new PimsValidationError("controlled_impact");
      }

      const created = await deps.adapter.createRiskEvaluation(
        {
          description: args.description,
          controlled_probability: args.controlled_probability,
          controlled_impact: args.controlled_impact,
          assets: assetIds.map((assetId) => ({ asset: assetId })),
          threat_code: args.threat_code,
          vulnerability_code: args.vulnerability_code,
          threat: args.threat,
          vulnerability: args.vulnerability,
          risk_owner: args.risk_owner,
          response_strategy: args.response_strategy,
          status: readRiskStatus(args.status),
        },
        {
          incidentCode: code,
          idempotencyKey: ctx.idempotencyKey ?? undefined,
        },
      );

      const after = await deps.adapter.listRiskEvaluations();
      const row = after.results.find((risk) => risk.id === created.id);
      if (row === undefined) {
        throw new PimsNotFoundError("PimsRiskEvaluation", created.id);
      }

      return toJsonObject({
        risk_id: row.id,
        risk_code: row.risk_code ?? row.code,
        period_name: period.name,
      });
    },

    pims_create_audit_action: async (ctx, rawArgs) => {
      const args = PimsCreateAuditActionArgsSchema.parse(
        rawArgs,
      ) as PimsCreateAuditActionArgs;
      if (ctx.incidentId === null) {
        throw new PimsValidationError("incident_id", "REQUIRED");
      }
      const incident = await deps.adapter.getIncident(ctx.incidentId);
      const code = incident.incident_code;
      const overrides = {
        incidentCode: code,
        idempotencyKey: ctx.idempotencyKey ?? undefined,
      };

      const dueDate =
        args.due_date ??
        addDays(
          incident.detection_date ?? incident.incident_date,
          deps.config.CORRECTIVE_DEFAULT_DUE_DAYS,
        );
      const responsible = args.responsible ?? "UNASSIGNED";
      const prefix = `${CORRECTIVE_FINDING_PREFIX}${code}`;

      const audits = await deps.adapter.listAudits();
      let audit: PimsAudit | null = null;
      if (args.audit_id !== undefined) {
        const found = audits.results.find(
          (candidate) => candidate.id === args.audit_id,
        );
        if (found === undefined) {
          throw new AuditLinkFailedError("audit_not_found");
        }
        audit = found;
      } else {
        const open = audits.results
          .filter(
            (candidate) => candidate.status === "P" || candidate.status === "R",
          )
          .sort((a, b) => b.id - a.id);
        audit = open[0] ?? null;
      }

      if (audit === null) {
        audit = await deps.adapter.createAudit(
          {
            audit_type: "I",
            name: `Auto: incident ${code} corrective actions`,
            status: "P",
          },
          overrides,
        );
      }
      const auditId = audit.id;

      const findings = audit.findings ?? [];
      const prefixed = findings.filter((finding) =>
        finding.description.startsWith(prefix),
      );
      if (prefixed.length > 1) {
        throw new AuditLinkDuplicateError();
      }

      let targetFinding: PimsAuditFinding | null = prefixed[0] ?? null;
      if (args.finding_id !== undefined) {
        const byId = findings.find((finding) => finding.id === args.finding_id);
        if (byId === undefined) {
          throw new AuditLinkFailedError("finding_not_found");
        }
        targetFinding = byId;
      }

      const newAction = {
        action_plan: args.action_plan,
        responsible,
        due_date: dueDate,
        status: args.status,
        progress: 0,
      };

      const nextFindings: Array<{
        classification: "N" | "O" | "M";
        description: string;
        evidence: string | null;
        actions: Array<{
          action_plan?: string;
          description?: string;
          responsible: string;
          due_date: string;
          status: "O" | "P" | "C";
          progress?: number;
        }>;
      }> = findings.map((finding) => {
        const isTarget =
          targetFinding !== null && finding.id === targetFinding.id;
        return {
          classification: finding.classification,
          description: finding.description,
          evidence: finding.evidence ?? null,
          actions: isTarget
            ? [...normalizeFindingActions(finding, dueDate), newAction]
            : normalizeFindingActions(finding, dueDate),
        };
      });

      if (targetFinding === null) {
        nextFindings.push({
          classification: args.classification,
          description:
            args.finding_description ?? `${prefix}: root cause pending`,
          evidence: `[source_requirement_code=${args.source_requirement_code}]`,
          actions: [newAction],
        });
      }

      await deps.adapter.updateAudit(
        auditId,
        { findings: nextFindings },
        overrides,
      );

      const afterAudits = await deps.adapter.listAudits();
      const afterAudit = afterAudits.results.find(
        (candidate) => candidate.id === auditId,
      );
      if (afterAudit === undefined) {
        throw new AuditLinkFailedError("post_write_missing");
      }
      const writtenFindings = afterAudit.findings ?? [];
      const writtenFindingIndex = writtenFindings.findIndex((finding) =>
        finding.description.startsWith(prefix),
      );
      const writtenFinding = writtenFindings[writtenFindingIndex];
      if (writtenFinding === undefined || writtenFindingIndex < 0) {
        throw new AuditLinkFailedError("post_write_missing");
      }
      const writtenActions = writtenFinding.actions ?? [];
      const writtenActionIndex = writtenActions.findIndex(
        (action) => action.action_plan === args.action_plan,
      );
      const writtenAction = writtenActions[writtenActionIndex];
      if (writtenAction === undefined || writtenActionIndex < 0) {
        throw new AuditLinkFailedError("post_write_missing");
      }

      const findingId = writtenFinding.id ?? writtenFindingIndex;
      const actionPlanId = writtenAction.id ?? writtenActionIndex;

      await appendEvidenceMarker(
        deps.adapter,
        deps.evidenceStore,
        incident,
        `AUDIT_LINK:${auditId}:${findingId}:${actionPlanId}`,
        schema,
      );

      await deps.indicator.emit({
        event: "corrective_linked",
        incident_code: code,
        at_utc: ctx.now.toISOString(),
        actor_role: ctx.role,
        attrs: {
          reason: `AUDIT_LINK:${auditId}:${findingId}:${actionPlanId}`,
        },
      });

      return toJsonObject({
        audit_id: auditId,
        audit_code: afterAudit.audit_code ?? afterAudit.code,
        finding_id: findingId,
        action_plan_id: actionPlanId,
      });
    },
  };
}
