import { ChatStore } from "@pims/cockpit/ui/lib/chat-store.ts";
import type { ChatResponse } from "@pims/types/cockpit.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("ChatStore Tree Branching & Multi-Session", () => {
  let store: ChatStore;

  const mockResponse = (reply: string): ChatResponse => ({
    reply,
    persona: "auditor",
    citations: [],
    pending_decisions: [],
    tool_calls: ["list_active_incidents"],
    trace: {
      id: "trace-1",
      title: "Test Trace",
      start_iso: new Date().toISOString(),
      wall_time_ms: 120,
      model_time_ms: 80,
      tool_time_ms: 30,
      idle_time_ms: 10,
      turns_count: 1,
      requests_count: 1,
      tool_calls_count: 1,
      spans: [],
      aggregates: [],
    },
  });

  beforeEach(() => {
    store = new ChatStore();
    store.clearAll();
  });

  it("creates and manages multiple sessions", () => {
    const s1 = store.getActiveSession();
    expect(s1.title).toBe("Nueva Conversación");

    const s2 = store.createSession("Auditoría INC-002", "dpo", "INC-002");
    expect(s2.title).toBe("Auditoría INC-002");
    expect(store.getActiveSession().id).toBe(s2.id);

    const allSessions = store.getSessions();
    expect(allSessions.length).toBe(2);

    store.renameSession(s2.id, "Auditoría Modificada");
    expect(store.getActiveSession().title).toBe("Auditoría Modificada");

    store.deleteSession(s2.id);
    expect(store.getSessions().length).toBe(1);
    expect(store.getActiveSession().id).toBe(s1.id);
  });

  it("handles conversation tree branching when user edits a message", () => {
    // Turn 1: User message
    const userMsg1 = store.addUserMessage("¿Cuál es el estado de INC-001?");
    expect(userMsg1.parentId).toBeNull();

    // Turn 1: Assistant response
    const assistantMsg1 = store.addAssistantResponse(
      userMsg1.id,
      mockResponse("INC-001 está abierto."),
    );
    expect(assistantMsg1.parentId).toBe(userMsg1.id);

    // Turn 2: User follow-up
    const userMsg2 = store.addUserMessage("¿Quién es el asignado?");
    const _assistantMsg2 = store.addAssistantResponse(
      userMsg2.id,
      mockResponse("Asignado a Operador 1."),
    );

    let branch = store.getActiveBranchMessages();
    expect(branch.length).toBe(4);
    expect(branch.map((b) => b.node.text)).toEqual([
      "¿Cuál es el estado de INC-001?",
      "INC-001 está abierto.",
      "¿Quién es el asignado?",
      "Asignado a Operador 1.",
    ]);
    expect(branch[0].totalBranches).toBe(1);
    expect(branch[0].branchIndex).toBe(0);

    // Edit userMsg1 -> forks branch at root!
    const userMsg1Edited = store.editUserMessage(
      userMsg1.id,
      "¿Cuál es la severidad de INC-001?",
    );
    expect(userMsg1Edited.parentId).toBeNull();

    branch = store.getActiveBranchMessages();
    // After edit, the active branch starts at userMsg1Edited (leaf is userMsg1Edited)
    expect(branch.length).toBe(1);
    expect(branch[0].node.text).toBe("¿Cuál es la severidad de INC-001?");
    expect(branch[0].totalBranches).toBe(2);
    expect(branch[0].branchIndex).toBe(1);

    // Assistant answers the edited question
    store.addAssistantResponse(
      userMsg1Edited.id,
      mockResponse("La severidad es Alta."),
    );
    branch = store.getActiveBranchMessages();
    expect(branch.length).toBe(2);
    expect(branch[1].node.text).toBe("La severidad es Alta.");

    // Switch back to original branch at root
    store.switchBranch(userMsg1.id);
    branch = store.getActiveBranchMessages();
    expect(branch.length).toBe(4);
    expect(branch[0].node.text).toBe("¿Cuál es el estado de INC-001?");
    expect(branch[0].branchIndex).toBe(0);
    expect(branch[0].totalBranches).toBe(2);
  });

  it("handles regenerating an assistant response creating sibling branches", () => {
    const userMsg = store.addUserMessage("Plazos GDPR Art. 33");
    const resp1 = store.addAssistantResponse(
      userMsg.id,
      mockResponse("Respuesta 1: 72 horas"),
    );

    let branch = store.getActiveBranchMessages();
    expect(branch.length).toBe(2);
    expect(branch[1].branchIndex).toBe(0);
    expect(branch[1].totalBranches).toBe(1);

    // Regenerate response: add second assistant response under the same user message
    const resp2 = store.addAssistantResponse(
      userMsg.id,
      mockResponse("Respuesta 2: El plazo legal es de 72h"),
    );

    branch = store.getActiveBranchMessages();
    expect(branch.length).toBe(2);
    expect(branch[1].node.id).toBe(resp2.id);
    expect(branch[1].node.text).toBe("Respuesta 2: El plazo legal es de 72h");
    expect(branch[1].branchIndex).toBe(1);
    expect(branch[1].totalBranches).toBe(2);

    // Switch back to first response
    store.switchBranch(resp1.id);
    branch = store.getActiveBranchMessages();
    expect(branch.length).toBe(2);
    expect(branch[1].node.id).toBe(resp1.id);
    expect(branch[1].node.text).toBe("Respuesta 1: 72 horas");
    expect(branch[1].branchIndex).toBe(0);
    expect(branch[1].totalBranches).toBe(2);
  });
});
