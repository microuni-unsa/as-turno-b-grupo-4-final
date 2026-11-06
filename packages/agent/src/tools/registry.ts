import crypto from "node:crypto";
import type { IndicatorEmitter } from "@pims/agent/indicators/indicator-emitter.ts";
import type { CloseChecklistVerifier } from "@pims/agent/lifecycle/close-checklist.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import type {
  CapabilityExecutor,
  RoleCapabilityHandle,
  RoleRegistry,
} from "@pims/agent/orchestrator/roles.ts";
import type { DeadlineScheduler } from "@pims/agent/orchestrator/scheduler.ts";
import { idempotencyKey, redactArgs } from "@pims/agent/tools/helpers.ts";
import type { AgentConfig } from "@pims/config";
import type { BundleSealer } from "@pims/evidence/bundle-sealer.ts";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import {
  AGENT_TOOL_NAMES,
  type AgentRole,
  PimsIncidentUpdateStrictSchema,
  type PimsLoginResult,
  TOOL_ARG_SCHEMAS,
  TOOL_RESULT_SCHEMAS,
  type ToolName,
} from "@pims/types/agent.ts";
import { canonicalizeJson } from "@pims/types/canonical.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  RoleToolDeniedError,
  ToolArgsInvalidError,
  ToolResultInvalidError,
  ToolUnknownError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";

export interface ToolDependencies {
  adapter: PimsAdapter;
  evidenceStore: EvidenceStore;
  bundleSealer: BundleSealer;
  closeChecklist: CloseChecklistVerifier;
  ragService: RAGService;
  modelClient: AgentModelClient;
  scheduler: DeadlineScheduler;
  indicator: IndicatorEmitter;
  config: AgentConfig;
  clock: () => Date;
  roleRegistry: RoleRegistry;
  idempotencyKeyFactory?: (incidentCode: string, operation: string) => string;
}

export interface ToolCallContext {
  incidentId?: number | null;
  incidentCode?: string | null;
  operatorJwtSub?: string | null;
}

export interface ToolExecutionContext {
  role: AgentRole;
  incidentId: number | null;
  incidentCode: string | null;
  idempotencyKey: string | null;
  operatorJwtSub: string | null;
  now: Date;
}

export type ToolHandler = (
  ctx: ToolExecutionContext,
  args: JsonObject,
) => Promise<JsonObject>;

const UPDATE_SCHEMA_KEYS: readonly string[] = Object.keys(
  PimsIncidentUpdateStrictSchema.shape,
);

const TRIAGE_DENIED_UPDATE_KEYS: ReadonlySet<string> = new Set([
  "status",
  "actions",
  "resolved_date",
  "measure_updated_registry",
  "measure_new_security",
  "measure_improved_policies",
  "measure_considered_resolved",
  "measure_reported_authorities",
  "is_deleted",
  "deleted_at",
]);

export const TRIAGE_UPDATE_KEYS: readonly string[] = UPDATE_SCHEMA_KEYS.filter(
  (key) => !TRIAGE_DENIED_UPDATE_KEYS.has(key),
);

export const ROLE_PATCH_POLICIES: Readonly<
  Record<AgentRole, Partial<Record<ToolName, readonly string[]>>>
> = Object.freeze({
  orchestrator: {},
  intake: {},
  triage: { pims_update_incident: TRIAGE_UPDATE_KEYS },
  investigator: {
    pims_update_incident: [
      "security_measures_adopted",
      "measure_new_security",
      "measure_improved_policies",
      "measure_updated_registry",
      "compromised_system",
      "affected_url",
      "num_affected_subjects",
      "affected_data_types",
      "evidence_refs",
      "assigned_to",
    ],
  },
  drafter: {},
  notifier: { pims_update_incident: ["measure_reported_authorities"] },
  monitor: {
    pims_update_incident: [
      "resolved_date",
      "measure_considered_resolved",
      "measure_updated_registry",
      "measure_new_security",
      "measure_improved_policies",
      "measure_reported_authorities",
      "evidence_refs",
    ],
  },
});

export const ROLE_TRANSITION_TARGETS: Readonly<
  Partial<Record<AgentRole, readonly string[]>>
> = Object.freeze({
  triage: ["P"],
  monitor: ["C", "P"],
});

function isToolName(value: string): value is ToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}

function firstIssueField(error: {
  issues: Array<{ path: Array<string | number> }>;
}): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "root";
  }
  return issue.path.length === 0 ? "root" : issue.path.join(".");
}

export class ToolRegistry {
  private readonly deps: ToolDependencies;
  private readonly handlers: Readonly<Record<ToolName, ToolHandler>>;

  constructor(
    deps: ToolDependencies,
    handlers: Readonly<Record<ToolName, ToolHandler>>,
  ) {
    this.deps = deps;
    this.handlers = handlers;

    const executor: CapabilityExecutor = (handle, tool, args) =>
      this.execute(handle, tool, args);
    deps.roleRegistry.attachExecutor(executor);
  }

  async bootstrapSession(): Promise<PimsLoginResult> {
    const login = await this.deps.adapter.login();
    const expiresAt = new Date(
      this.deps.clock().getTime() + CONSTANTS.PIMS_ACCESS_TOKEN_TTL_S * 1000,
    );
    return {
      access_expires_at_utc: expiresAt.toISOString(),
      schema: this.deps.config.PIMS_SCHEMA,
      user_id: login.user.id,
    };
  }

  async execute(
    handle: RoleCapabilityHandle,
    tool: string,
    args: JsonObject,
    context?: ToolCallContext,
  ): Promise<JsonObject> {
    if (!isToolName(tool)) {
      throw new ToolUnknownError(tool);
    }
    const toolName: ToolName = tool;

    const definition = this.deps.roleRegistry.get(handle.role);
    if (definition.prompt_sha256 !== handle.promptSha256) {
      throw new RoleToolDeniedError(handle.role, toolName);
    }

    this.deps.roleRegistry.assertToolAllowed(handle.role, toolName);

    if (toolName === "pims_login") {
      throw new RoleToolDeniedError(handle.role, toolName);
    }

    const parsedArgs = TOOL_ARG_SCHEMAS[toolName].safeParse(args);
    if (!parsedArgs.success) {
      throw new ToolArgsInvalidError(
        toolName,
        firstIssueField(parsedArgs.error),
      );
    }
    const normalizedArgs = parsedArgs.data as JsonObject;

    this.applyPatchPolicy(handle.role, toolName, normalizedArgs);

    const handler = this.handlers[toolName];
    if (handler === undefined) {
      throw new ToolUnknownError(toolName);
    }

    let incidentCode: string | null = null;
    if (
      context !== undefined &&
      context.incidentCode !== undefined &&
      context.incidentCode !== null
    ) {
      incidentCode = context.incidentCode;
    }
    let incidentId: number | null = null;
    if (
      context !== undefined &&
      context.incidentId !== undefined &&
      context.incidentId !== null
    ) {
      incidentId = context.incidentId;
    }
    let operatorJwtSub: string | null = null;
    if (
      context !== undefined &&
      context.operatorJwtSub !== undefined &&
      context.operatorJwtSub !== null
    ) {
      operatorJwtSub = context.operatorJwtSub;
    }

    const effectiveIncidentCode =
      incidentCode !== null ? incidentCode : "global";

    const ctx: ToolExecutionContext = {
      role: handle.role,
      incidentId,
      incidentCode,
      idempotencyKey: null,
      operatorJwtSub,
      now: this.deps.clock(),
    };

    if (this.deps.idempotencyKeyFactory !== undefined) {
      ctx.idempotencyKey = this.deps.idempotencyKeyFactory(
        effectiveIncidentCode,
        toolName,
      );
    } else {
      ctx.idempotencyKey = idempotencyKey(
        this.deps.config,
        effectiveIncidentCode,
        toolName,
      );
    }

    const rawResult = await handler(ctx, normalizedArgs);

    const parsedResult = TOOL_RESULT_SCHEMAS[toolName].safeParse(rawResult);
    if (!parsedResult.success) {
      throw new ToolResultInvalidError(toolName, {
        issues: parsedResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const result = parsedResult.data as JsonObject;

    const resultRef = `${toolName}:${effectiveIncidentCode}:${crypto
      .createHash("sha256")
      .update(canonicalizeJson(result), "utf8")
      .digest("hex")
      .slice(0, 16)}`;

    await this.deps.evidenceStore.appendToolLedger({
      incident_code: effectiveIncidentCode,
      at_utc: ctx.now.toISOString(),
      role: handle.role,
      tool: toolName,
      args_redacted: redactArgs(normalizedArgs),
      result_ref: resultRef,
      idempotency_key: ctx.idempotencyKey,
    });

    return result;
  }

  private applyPatchPolicy(
    role: AgentRole,
    tool: ToolName,
    args: JsonObject,
  ): void {
    if (tool !== "pims_update_incident") {
      return;
    }
    const allowed = ROLE_PATCH_POLICIES[role][tool];
    if (allowed === undefined) {
      throw new RoleToolDeniedError(role, tool);
    }
    const patch = args.patch;
    if (patch === undefined || patch === null) {
      throw new ToolArgsInvalidError(tool, "patch");
    }
    const allowedSet = new Set<string>(allowed);
    for (const key of Object.keys(patch)) {
      if (!allowedSet.has(key)) {
        throw new ToolArgsInvalidError(tool, `forbidden_field:${key}`);
      }
    }
  }
}

export function assertKnownToolName(value: string): ToolName {
  if (!isToolName(value)) {
    throw new ToolUnknownError(value);
  }
  return value;
}
