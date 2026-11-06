import { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { handleChat } from "@pims/cockpit/chat.ts";
import type { AgentConfig } from "@pims/config";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import {
  ChatResponseSchema,
  type CockpitSession,
} from "@pims/types/cockpit.ts";
import {
  TEST_ALT_INCIDENT_CODE,
  TEST_SCHEMA,
} from "@tests/helpers/test-constants.ts";
import { describe, expect, it, vi } from "vitest";

describe("Cockpit Chat Trace and Reasoning", () => {
  it("guarantees full trace data in every ChatResponse", async () => {
    const mockSession: CockpitSession = {
      access_token: "token-123",
      expires_at_utc: "2030-01-01T00:00:00Z",
      user_id: 1,
      username: "operador1",
      schema: TEST_SCHEMA,
      native_role: "Operador",
      permissions: ["view_incident", "change_incident"],
      default_persona: "auditor",
      can_switch_persona: true,
    };

    const mockAdapter = {
      listIncidents: vi
        .fn()
        .mockImplementation(
          async (_opts?: { search?: string; status?: string }) => {
            return {
              results: [
                {
                  id: 1,
                  incident_code: TEST_ALT_INCIDENT_CODE,
                  status: "O",
                  title: "Breach test",
                  summary: "Breach test",
                  incident_type: "ransomware",
                  severity: "H",
                  impact: "H",
                  created_at: "2026-11-01T10:00:00Z",
                  updated_at: "2026-11-01T10:00:00Z",
                  detected_at: "2026-11-01T10:00:00Z",
                  incident_date: "2026-11-01T10:00:00Z",
                  detection_date: "2026-11-01T10:00:00Z",
                  resolved_date: null,
                  awareness_at: "2026-11-01T10:00:00Z",
                  closed_at: null,
                  actions_count: 1,
                  attachments_count: 0,
                },
              ],
            };
          },
        ),
      listIncidentActions: vi.fn().mockResolvedValue([]),
      listIncidentAttachments: vi.fn().mockResolvedValue([]),
    } as unknown as PimsAdapter;

    const mockStore = {
      listActiveTimers: vi.fn().mockResolvedValue([]),
      listTimers: vi.fn().mockResolvedValue([]),
      listRagRetrievals: vi.fn().mockResolvedValue([]),
      getRootCause: vi.fn().mockResolvedValue(null),
      getAgentState: vi.fn().mockResolvedValue(null),
      getDraftPack: vi.fn().mockResolvedValue(null),
    } as unknown as EvidenceStore;

    const mockModelClient = {
      chat_json: vi.fn().mockResolvedValue({
        route: "reasoning",
        model: "test-model",
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 25,
        content: {
          reply:
            "El incidente INC-001 se encuentra abierto con severidad alta.",
          citations_used: [],
          suggested_actions: ["Iniciar contención"],
          reasoning: "Revisados los plazos y estado del incidente INC-001.",
        },
      }),
    } as unknown as AgentModelClient;

    const mockConfig = {
      TEMP_REASONING: 0.1,
    } as unknown as AgentConfig;

    const presidioClient = new PresidioClient({
      baseUrl: "http://127.0.0.1:3000",
    });
    vi.spyOn(presidioClient, "analyze").mockResolvedValue([]);

    const clock = () => new Date("2026-11-05T12:00:00Z");

    const result = await handleChat(
      {
        adapter: mockAdapter,
        store: mockStore,
        modelClient: mockModelClient,
        presidioClient,
        config: mockConfig,
        clock,
      },
      mockSession,
      {
        message: "Estado de INC-001",
        persona: "auditor",
      },
    );

    // Validate using Zod ChatResponseSchema
    const validated = ChatResponseSchema.parse(result);
    expect(validated.reply).toContain("INC-001");
    expect(validated.trace).toBeDefined();

    // Verify trace properties
    const trace = validated.trace;
    expect(trace.wall_time_ms).toBeGreaterThan(0);
    expect(trace.tool_time_ms).toBeGreaterThanOrEqual(0);
    expect(trace.model_time_ms).toBeGreaterThanOrEqual(0);
    expect(trace.idle_time_ms).toBeGreaterThanOrEqual(0);
    expect(trace.tool_calls_count).toBeGreaterThan(0);

    // Verify spans
    expect(trace.spans.length).toBeGreaterThan(3);
    const turnSpan = trace.spans.find((s) => s.type === "turn");
    expect(turnSpan).toBeDefined();
    expect(turnSpan?.name).toBe("user_turn");

    const modelSpan = trace.spans.find((s) => s.type === "model");
    expect(modelSpan).toBeDefined();
    expect(modelSpan?.name).toBe("model_reasoning");

    const toolSpans = trace.spans.filter((s) => s.type === "tool");
    expect(toolSpans.length).toBeGreaterThanOrEqual(3);
    expect(toolSpans.some((s) => s.name === "list_active_incidents")).toBe(
      true,
    );
    expect(toolSpans.some((s) => s.name === "get_incident_status")).toBe(true);

    // Verify aggregates
    expect(trace.aggregates.length).toBeGreaterThanOrEqual(3);
    const listAgg = trace.aggregates.find(
      (a) => a.tool === "list_active_incidents",
    );
    expect(listAgg).toBeDefined();
    expect(listAgg?.calls).toBe(1);
    expect(listAgg?.errors).toBe(0);

    // Verify reasoning
    expect(validated.reasoning).toBe(
      "Revisados los plazos y estado del incidente INC-001.",
    );
  });

  it("calculates fallback reasoning when model omits explicit reasoning", async () => {
    const mockSession: CockpitSession = {
      access_token: "token-123",
      expires_at_utc: "2030-01-01T00:00:00Z",
      user_id: 1,
      username: "operador1",
      schema: TEST_SCHEMA,
      native_role: "Operador",
      permissions: ["view_incident"],
      default_persona: "executive",
      can_switch_persona: true,
    };

    const mockAdapter = {
      listIncidents: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as PimsAdapter;

    const mockStore = {
      listActiveTimers: vi.fn().mockResolvedValue([]),
      listTimers: vi.fn().mockResolvedValue([]),
      listRagRetrievals: vi.fn().mockResolvedValue([]),
      getRootCause: vi.fn().mockResolvedValue(null),
      getAgentState: vi.fn().mockResolvedValue(null),
      getDraftPack: vi.fn().mockResolvedValue(null),
    } as unknown as EvidenceStore;

    const mockModelClient = {
      chat_json: vi.fn().mockResolvedValue({
        route: "reasoning",
        model: "test-model",
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        latency_ms: 15,
        content: {
          reply: "No hay incidentes activos.",
          citations_used: [],
          suggested_actions: [],
        },
      }),
    } as unknown as AgentModelClient;

    const mockConfig = { TEMP_REASONING: 0.1 } as unknown as AgentConfig;
    const presidioClient = new PresidioClient({
      baseUrl: "http://127.0.0.1:3000",
    });
    vi.spyOn(presidioClient, "analyze").mockResolvedValue([]);
    const clock = () => new Date("2026-11-05T12:00:00Z");

    const result = await handleChat(
      {
        adapter: mockAdapter,
        store: mockStore,
        modelClient: mockModelClient,
        presidioClient,
        config: mockConfig,
        clock,
      },
      mockSession,
      { message: "Resumen general", persona: "executive" },
    );

    expect(result.reasoning).toBeDefined();
    expect(result.reasoning).toContain("executive");
    expect(result.trace.aggregates.length).toBeGreaterThan(0);
  });
});
