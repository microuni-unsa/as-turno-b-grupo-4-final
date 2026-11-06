import crypto from "node:crypto";
import {
  AGENT_ROLES,
  AGENT_SKILLS,
  AGENT_TOOL_NAMES,
  type AgentRole,
  type RoleDefinition,
  type SkillDefinition,
  type SkillName,
  type ToolName,
} from "@pims/types/agent.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  PimsClientBugError,
  RoleToolDeniedError,
  RoleUnknownError,
  SkillUnknownError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";

export interface RoleCapabilityHandle {
  role: AgentRole;
  promptSha256: string;
  call(tool: ToolName, args: JsonObject): Promise<JsonObject>;
}

export type CapabilityExecutor = (
  handle: RoleCapabilityHandle,
  tool: ToolName,
  args: JsonObject,
) => Promise<JsonObject>;

export const ROLE_PROMPTS: Readonly<Record<AgentRole, string>> = Object.freeze({
  orchestrator:
    "You are the incident-response orchestrator. Dispatch roles strictly per the incident lifecycle loop. Enforce transition guards, timer arming, and lifecycle invariants. Never call PIMS directly except operator-console recipient management; emit tool calls only. Never invent fields, codes, or deadlines.",
  intake:
    "You extract incident facts from forms or external signals into the intake schema. Ask exactly one re-prompt per missing REQUIRED field, then apply standard intake defaults. Never guess enums; cite the incident field map.",
  triage:
    "You classify incident_type/severity/impact using FAST_MODEL with conformal prediction calibration, citing incident taxonomy definitions and GDPR risk factors. Duplicate-check before any update.",
  investigator:
    "You run root-cause analysis, forensically inspect and collect hashed evidence, link audit actions and risk signals, and write R actions only with review_approval_id.",
  drafter:
    "You compose Art 33/34 packs from validated fields only. Every legal sentence carries a citation. Exemption claims require evidence pointers. Output is inert draft JSON.",
  notifier:
    "You execute notification via pims_notify with a human-approved pack id. Verify active recipients first. Record the outcome. Never edit pack content.",
  monitor:
    "You watch timers, new attachments, and linked-object changes. Reopen on new evidence with its id. Transition P→C when the close checklist is satisfied. Emit indicator events on every transition.",
});

const ROLE_AUTONOMY: Readonly<Record<AgentRole, string>> = Object.freeze({
  orchestrator:
    "Owns loop + policy + deadlines; ONLY role that arms/cancels timers, processes console recipient changes, and orders O/P/C transitions",
  intake: "May create status=O only; MUST NOT set other statuses",
  triage:
    "May update O fields and transition O→P once triage guard passes; MUST NOT close; MUST NOT arm timers (requests orchestrator)",
  investigator:
    "Adds C/A actions, links audit/risk records, and adds R actions ONLY when holding a valid review_approval_id",
  drafter:
    "Writes drafts to evidence-store ONLY; MUST NOT notify or mutate PIMS",
  notifier:
    "Acts ONLY on review_approval_id or veto-window expiry; content-frozen",
  monitor:
    "May move C→P ONLY with REOPENED:<new_evidence_id>; P→C ONLY with close checklist satisfied",
});

export const ROLE_TOOL_MATRIX: Readonly<Record<AgentRole, ToolName[]>> =
  Object.freeze({
    orchestrator: [
      "pims_manage_recipient",
      "scheduler_arm",
      "scheduler_cancel",
      "indicator_emit",
    ],
    intake: ["pims_list_incidents", "pims_create_incident", "rag_query"],
    triage: [
      "pims_get_incident",
      "pims_list_incidents",
      "pims_update_incident",
      "pims_transition_status",
      "rag_query",
    ],
    investigator: [
      "pims_get_incident",
      "pims_list_incidents",
      "pims_update_incident",
      "pims_add_action",
      "pims_upload_attachment",
      "pims_get_history",
      "pims_search_risks",
      "pims_emit_risk_signal",
      "pims_create_audit_action",
      "rag_query",
    ],
    drafter: ["pims_get_incident", "pims_get_history", "rag_query"],
    notifier: [
      "pims_notify",
      "pims_list_recipients",
      "pims_get_history",
      "pims_update_incident",
    ],
    monitor: [
      "pims_get_incident",
      "pims_get_history",
      "pims_list_incidents",
      "pims_update_incident",
      "pims_transition_status",
      "indicator_emit",
    ],
  });

interface SkillSpec {
  tools: ToolName[];
  selector_rule: string;
}

const SKILL_SPECS: Readonly<Record<SkillName, SkillSpec>> = Object.freeze({
  "pims-incident-crud": {
    tools: [
      "pims_create_incident",
      "pims_get_incident",
      "pims_list_incidents",
      "pims_update_incident",
      "pims_transition_status",
    ],
    selector_rule: "Core incident read/write/transition surface",
  },
  "pims-notify": {
    tools: ["pims_notify", "pims_list_recipients", "pims_manage_recipient"],
    selector_rule:
      "Precondition: at least one active recipient, else NOTIFY_NO_RECIPIENTS",
  },
  "risk-linker": {
    tools: ["pims_search_risks", "pims_emit_risk_signal"],
    selector_rule:
      "Emit on systemic root cause; closed risk period queues the signal",
  },
  "audit-action-linker": {
    tools: ["pims_create_audit_action"],
    selector_rule: "Auto-link on severity H/C, impact H/V, or confirmed breach",
  },
  "gdpr-notice-drafter": {
    tools: [],
    selector_rule:
      "Draft authority and subject notice packs via notice-composer; citation rule enforced",
  },
  "root-cause-analyzer": {
    tools: ["pims_add_action", "rag_query"],
    selector_rule:
      "Single-prompt root-cause analysis; 5-whys for a single chain, fishbone for multi-factor, fault-tree for system failure",
  },
  "evidence-collector": {
    tools: ["pims_upload_attachment", "pims_get_history"],
    selector_rule:
      "Collect, hash, and stage file attachments with SHA-256 integrity verification and upload; verify manifest",
  },
  "deadline-scheduler": {
    tools: ["scheduler_arm", "scheduler_cancel"],
    selector_rule: "Timer countdown scheduling; armed by the orchestrator only",
  },
  "indicator-reporter": {
    tools: ["indicator_emit"],
    selector_rule: "Standard indicator events; every state change emits",
  },
  "rag-grounded-qa": {
    tools: ["rag_query"],
    selector_rule:
      "Grounded normative question-answering with threshold and citation verification",
  },
});

function buildSkillDefinitions(): Record<SkillName, SkillDefinition> {
  const definitions = {} as Record<SkillName, SkillDefinition>;
  for (const skill of AGENT_SKILLS) {
    const spec = SKILL_SPECS[skill];
    if (spec === undefined) {
      throw new SkillUnknownError(skill);
    }
    definitions[skill] = {
      skill,
      tools: [...spec.tools],
      selector_rule: spec.selector_rule,
    };
  }
  return definitions;
}

export const SKILL_DEFINITIONS: Readonly<Record<SkillName, SkillDefinition>> =
  Object.freeze(buildSkillDefinitions());

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function buildRoleDefinitions(): Record<AgentRole, RoleDefinition> {
  const definitions = {} as Record<AgentRole, RoleDefinition>;
  for (const role of AGENT_ROLES) {
    const allowed = ROLE_TOOL_MATRIX[role];
    if (allowed === undefined) {
      throw new RoleUnknownError(role);
    }
    const allowedSet = new Set<string>(allowed);
    const denied = AGENT_TOOL_NAMES.filter((tool) => !allowedSet.has(tool));
    const systemPrompt = ROLE_PROMPTS[role];
    if (systemPrompt === undefined) {
      throw new RoleUnknownError(role);
    }
    const autonomy = ROLE_AUTONOMY[role];
    if (autonomy === undefined) {
      throw new RoleUnknownError(role);
    }
    definitions[role] = {
      role,
      prompt_version: CONSTANTS.ROLE_PROMPT_VERSION,
      prompt_sha256: sha256Hex(systemPrompt),
      system_prompt: systemPrompt,
      autonomy,
      allowed_tools: [...allowed],
      denied_tools: [...denied],
    };
  }
  return definitions;
}

export const ROLE_DEFINITIONS: Readonly<Record<AgentRole, RoleDefinition>> =
  Object.freeze(buildRoleDefinitions());

export class RoleRegistry {
  private readonly definitions: Readonly<Record<AgentRole, RoleDefinition>>;
  private executor: CapabilityExecutor | null = null;

  constructor(
    definitions: Readonly<Record<AgentRole, RoleDefinition>> = ROLE_DEFINITIONS,
  ) {
    this.definitions = definitions;
  }

  attachExecutor(executor: CapabilityExecutor): void {
    this.executor = executor;
  }

  get(role: string): RoleDefinition {
    if (!(AGENT_ROLES as readonly string[]).includes(role)) {
      throw new RoleUnknownError(role);
    }
    const definition = this.definitions[role as AgentRole];
    if (definition === undefined) {
      throw new RoleUnknownError(role);
    }
    return definition;
  }

  assertToolAllowed(role: AgentRole, tool: ToolName): void {
    const definition = this.get(role);
    if (
      !definition.allowed_tools.includes(tool) ||
      definition.denied_tools.includes(tool)
    ) {
      throw new RoleToolDeniedError(role, tool);
    }
  }

  createCapabilityHandle(role: AgentRole): RoleCapabilityHandle {
    const definition = this.get(role);
    const handle: RoleCapabilityHandle = {
      role,
      promptSha256: definition.prompt_sha256,
      call: (tool: ToolName, args: JsonObject): Promise<JsonObject> => {
        if (this.executor === null) {
          throw new PimsClientBugError(
            "Capability handle used before ToolRegistry attached its executor",
          );
        }
        return this.executor(handle, tool, args);
      },
    };
    return handle;
  }

  listSkills(): readonly SkillDefinition[] {
    return Object.values(SKILL_DEFINITIONS);
  }

  getSkill(name: string): SkillDefinition {
    const definition = (
      SKILL_DEFINITIONS as Record<string, SkillDefinition | undefined>
    )[name];
    if (definition === undefined) {
      throw new SkillUnknownError(name);
    }
    return definition;
  }
}
