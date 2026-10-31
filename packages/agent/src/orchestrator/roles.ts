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
import { ROLE_PROMPT_VERSION } from "@pims/types/constants.ts";
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
    "You are the incident-response orchestrator. Dispatch roles strictly per the §6 loop. Enforce transition guards (§6.2), timer arming (§6.4), and the invariants (§6.5). Never call PIMS directly except operator-console recipient management; emit tool calls only. Never invent fields, codes, or deadlines.",
  intake:
    "You extract incident facts from voice transcripts, forms, or signals into the §9.1 intake schema. Ask exactly one re-prompt per missing REQUIRED field, then apply §9.1 defaults. Never guess enums; cite the §3.5 map.",
  triage:
    "You classify incident_type/severity/impact per §9.2 using FAST_MODEL with conformal prediction calibration, citing §3.5 definitions and Recital 85-87 factors. Duplicate-check before any update.",
  investigator:
    "You run Tree-of-Thoughts neuro-symbolic root-cause analysis and minimal cut-set counterfactual control simulation per §5.2, forensically inspect and collect hashed evidence, link audit actions and risk signals per §9.4, and write R actions only with review_approval_id.",
  drafter:
    "You compose Art 33/34 packs per §10.1-10.2 from validated fields only. Every legal sentence carries a citation. Exemption claims require evidence pointers. Output is inert draft JSON.",
  compliance_reviewer:
    "You run an Adversarial Red-Team Prosecutor challenge followed by the 4-judge constitutional verification rubric (Legal Completeness, Citation NLI Entailment, Plain-Language Readability, Zero-Trust PII & Semantic Entropy Scan). Approve with id or reject with explicit reason + required fix. No silent approval.",
  notifier:
    "You execute notification via pims_notify with a reviewer-approved pack id. Verify active recipients first. Record the outcome. Never edit pack content.",
  monitor:
    "You watch timers, new attachments, and linked-object changes. Reopen on new evidence with its id. Transition P→C when the §9.6 checklist is satisfied. Emit indicator events on every transition.",
});

const ROLE_AUTONOMY: Readonly<Record<AgentRole, string>> = Object.freeze({
  orchestrator:
    "Owns loop + policy + deadlines; ONLY role that arms/cancels timers, processes console recipient changes, and orders O/P/C transitions",
  intake: "May create status=O only; MUST NOT set other statuses",
  triage:
    "May update O fields and transition O→P once triage guard passes; MUST NOT close; MUST NOT arm timers (requests orchestrator)",
  investigator:
    "Adds C/A actions, links §9.4 audit/risk records, and adds R actions ONLY when holding a valid review_approval_id",
  drafter:
    "Writes drafts to evidence-store ONLY; MUST NOT notify or mutate PIMS",
  compliance_reviewer:
    "SOLE approver of notify payloads and resolution sign-offs; veto = REVIEW_REJECTED:<judge>:<item>:<required_fix>; approval = review_approval_id (UUID, single-use per canonical content hash)",
  notifier:
    "Acts ONLY on review_approval_id or veto-window expiry (§6.3); content-frozen",
  monitor:
    "May move C→P ONLY with REOPENED:<new_evidence_id>; P→C ONLY with §9.6 close checklist satisfied",
});

export const ROLE_TOOL_MATRIX: Readonly<Record<AgentRole, ToolName[]>> =
  Object.freeze({
    orchestrator: [
      "pims_manage_recipient",
      "scheduler_arm",
      "scheduler_cancel",
      "indicator_emit",
    ],
    intake: [
      "pims_list_incidents",
      "pims_create_incident",
      "rag_query",
      "stt_transcribe",
      "tts_synthesize",
    ],
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
    compliance_reviewer: ["pims_get_incident", "pims_get_history", "rag_query"],
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
      "tts_synthesize",
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
      "Emit on systemic root cause; closed risk period queues the signal (§9.4)",
  },
  "audit-action-linker": {
    tools: ["pims_create_audit_action"],
    selector_rule:
      "Auto-link on severity H/C, impact H/V, or confirmed breach (§9.4)",
  },
  "gdpr-notice-drafter": {
    tools: [],
    selector_rule:
      "Pack schemas §10.1-10.2 via notice-composer; citation rule §6.5",
  },
  "root-cause-analyzer": {
    tools: ["pims_add_action", "rag_query"],
    selector_rule:
      "Expands TOT_BRANCH_FACTOR competing causal hypotheses with Bayesian posterior scoring; 5-whys for a single chain, fishbone for multi-factor, fault-tree for system failure; symbolic minimal cut-set counterfactual simulation",
  },
  "evidence-collector": {
    tools: ["pims_upload_attachment", "pims_get_history"],
    selector_rule:
      "VISION_MODEL forensic scan plus SHA-256 hash and upload; manifest §10.3",
  },
  "deadline-scheduler": {
    tools: ["scheduler_arm", "scheduler_cancel"],
    selector_rule: "Timer kinds §6.4; armed by the orchestrator only",
  },
  "indicator-reporter": {
    tools: ["indicator_emit"],
    selector_rule: "Event schema §10.6; every state change emits",
  },
  "voice-intake": {
    tools: ["stt_transcribe", "tts_synthesize"],
    selector_rule: "Flows §8.3-8.4; redaction §8.5",
  },
  "rag-grounded-qa": {
    tools: ["rag_query"],
    selector_rule: "Threshold and citation rules §7.4-7.5",
  },
});

function buildSkillDefinitions(): Record<SkillName, SkillDefinition> {
  const definitions = {} as Record<SkillName, SkillDefinition>;
  for (const skill of AGENT_SKILLS) {
    const spec = SKILL_SPECS[skill];
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
    const allowedSet = new Set<string>(allowed);
    const denied = AGENT_TOOL_NAMES.filter((tool) => !allowedSet.has(tool));
    const systemPrompt = ROLE_PROMPTS[role];
    definitions[role] = {
      role,
      prompt_version: ROLE_PROMPT_VERSION,
      prompt_sha256: sha256Hex(systemPrompt),
      system_prompt: systemPrompt,
      autonomy: ROLE_AUTONOMY[role],
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
    return AGENT_SKILLS.map((skill) => SKILL_DEFINITIONS[skill]);
  }

  getSkill(name: string): SkillDefinition {
    if (!(AGENT_SKILLS as readonly string[]).includes(name)) {
      throw new SkillUnknownError(name);
    }
    return SKILL_DEFINITIONS[name as SkillName];
  }
}
