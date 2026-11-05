import {
  ROLE_DEFINITIONS,
  ROLE_PROMPTS,
  RoleRegistry,
  SKILL_DEFINITIONS,
} from "@pims/agent";
import {
  AGENT_ROLES,
  AGENT_SKILLS,
  AGENT_TOOL_NAMES,
  type AgentRole,
  type ToolName,
} from "@pims/types/agent.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  RoleToolDeniedError,
  RoleUnknownError,
  SkillUnknownError,
} from "@pims/types/errors.ts";
import { describe, expect, it } from "vitest";

describe("Phase 4 role registry (§5.1–§5.4)", () => {
  const registry = new RoleRegistry();

  it("defines exactly the eight roles with versioned prompts", () => {
    expect(AGENT_ROLES).toHaveLength(8);
    expect(Object.keys(ROLE_DEFINITIONS).sort()).toEqual(
      [...AGENT_ROLES].sort(),
    );

    for (const role of AGENT_ROLES) {
      const definition = registry.get(role);
      expect(definition.role).toBe(role);
      expect(definition.prompt_version).toBe("1.0");
      expect(definition.prompt_sha256).toMatch(CONSTANTS.SHA256_HEX_REGEX);
      expect(definition.system_prompt).toBe(ROLE_PROMPTS[role]);
      expect(definition.autonomy.length).toBeGreaterThan(0);
    }
  });

  it("records stable prompt hashes that change with the prompt text", () => {
    const first = new RoleRegistry().get("investigator").prompt_sha256;
    const second = new RoleRegistry().get("investigator").prompt_sha256;
    expect(first).toBe(second);

    const other = registry.get("monitor").prompt_sha256;
    expect(other).not.toBe(first);
  });

  it("fails fast on an unknown role", () => {
    expect(() => registry.get("dpo")).toThrow(RoleUnknownError);
  });

  it("enforces the allowlist and denylist per role", () => {
    registry.assertToolAllowed("investigator", "pims_add_action");
    expect(() =>
      registry.assertToolAllowed("investigator", "pims_notify"),
    ).toThrow(RoleToolDeniedError);

    registry.assertToolAllowed("orchestrator", "scheduler_arm");
    expect(() =>
      registry.assertToolAllowed("orchestrator", "pims_create_incident"),
    ).toThrow(RoleToolDeniedError);

    expect(() =>
      registry.assertToolAllowed("intake", "pims_transition_status"),
    ).toThrow(RoleToolDeniedError);

    registry.assertToolAllowed("monitor", "pims_transition_status");
    registry.assertToolAllowed("notifier", "pims_notify");
  });

  it("denies pims_login to every role", () => {
    for (const role of AGENT_ROLES) {
      expect(() => registry.assertToolAllowed(role, "pims_login")).toThrow(
        RoleToolDeniedError,
      );
    }
  });

  it("keeps allowed and denied tool sets disjoint and exhaustive", () => {
    for (const role of AGENT_ROLES) {
      const definition = registry.get(role);
      const overlap = definition.allowed_tools.filter((tool) =>
        definition.denied_tools.includes(tool),
      );
      expect(overlap).toEqual([]);
      expect(
        definition.allowed_tools.length + definition.denied_tools.length,
      ).toBe(AGENT_TOOL_NAMES.length);
    }
  });

  it("issues capability handles bound to the role prompt hash", () => {
    const handle = registry.createCapabilityHandle("triage");
    expect(handle.role).toBe("triage");
    expect(handle.promptSha256).toBe(registry.get("triage").prompt_sha256);
    expect(handle.promptSha256).toMatch(CONSTANTS.SHA256_HEX_REGEX);
  });

  it("exposes the ten skills with resolvable tool names", () => {
    const skills = registry.listSkills();
    expect(AGENT_SKILLS).toHaveLength(10);
    expect(skills).toHaveLength(10);

    const knownTools = new Set<ToolName>(AGENT_TOOL_NAMES);
    for (const skill of skills) {
      expect(skill.selector_rule.length).toBeGreaterThan(0);
      for (const tool of skill.tools) {
        expect(knownTools.has(tool)).toBe(true);
      }
    }

    expect(SKILL_DEFINITIONS["pims-notify"].tools).toContain("pims_notify");
    expect(SKILL_DEFINITIONS["gdpr-notice-drafter"].tools).toEqual([]);
  });

  it("fails fast on an unknown skill", () => {
    expect(() => registry.getSkill("voice-cloning")).toThrow(SkillUnknownError);
  });

  it("covers the role matrix for every role", () => {
    const expected: Record<AgentRole, ToolName[]> = {
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
      compliance_reviewer: [
        "pims_get_incident",
        "pims_get_history",
        "rag_query",
      ],
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
    };

    for (const role of AGENT_ROLES) {
      expect(registry.get(role).allowed_tools.sort()).toEqual(
        expected[role].sort(),
      );
    }
  });
});
