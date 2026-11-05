import type {
  ChatPersona,
  ChatResponse,
  ChatTrace,
} from "@pims/types/cockpit.ts";

export interface ChatMessageNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  sender: "user" | "assistant";
  text: string;
  persona?: ChatPersona;
  incidentCode?: string;
  response?: ChatResponse;
  reasoning?: string;
  trace?: ChatTrace;
  error?: boolean;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  persona: ChatPersona;
  incidentCode?: string;
  nodes: Record<string, ChatMessageNode>;
  rootNodeIds: string[];
  activeLeafId: string | null;
}

export interface ActiveMessageItem {
  node: ChatMessageNode;
  branchIndex: number;
  totalBranches: number;
  siblingIds: string[];
}

const STORAGE_KEY_V2 = "pims_cockpit_sessions_v2";
const LEGACY_STORAGE_KEY = "pims_cockpit_chat";

export class ChatStore {
  private sessions: ChatSession[] = [];
  private activeSessionId: string = "";
  private currentPersona: ChatPersona = "auditor";
  private listeners = new Set<() => void>();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined") {
      this.initDefaultSession();
      return;
    }

    try {
      const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
      if (rawV2) {
        const parsed = JSON.parse(rawV2) as {
          sessions: ChatSession[];
          activeSessionId: string;
          persona?: ChatPersona;
        };
        if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
          this.sessions = parsed.sessions;
          this.activeSessionId =
            parsed.activeSessionId || parsed.sessions[0].id;
          this.currentPersona = parsed.persona || "auditor";
          return;
        }
      }

      // Check legacy format
      const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (rawLegacy) {
        const parsedLegacy = JSON.parse(rawLegacy) as {
          messages?: Array<{
            id?: string;
            sender: "user" | "assistant";
            text: string;
            persona?: ChatPersona;
            response?: ChatResponse;
            error?: boolean;
            timestamp?: string;
          }>;
          persona?: ChatPersona;
        };

        if (
          Array.isArray(parsedLegacy.messages) &&
          parsedLegacy.messages.length > 0
        ) {
          const migratedSession = this.createSessionFromLegacy(
            parsedLegacy.messages,
            parsedLegacy.persona ?? "auditor",
          );
          this.sessions = [migratedSession];
          this.activeSessionId = migratedSession.id;
          this.currentPersona = parsedLegacy.persona ?? "auditor";
          this.saveToStorage();
          return;
        }
      }
    } catch (err) {
      console.warn(
        "Failed to load chat sessions from localStorage, initializing fresh session",
        err,
      );
    }

    this.initDefaultSession();
  }

  private initDefaultSession(): void {
    const defaultSession = this.createNewSessionObject(
      "Nueva Conversación",
      "auditor",
    );
    this.sessions = [defaultSession];
    this.activeSessionId = defaultSession.id;
    this.saveToStorage();
  }

  private createNewSessionObject(
    title: string,
    persona: ChatPersona,
    incidentCode?: string,
  ): ChatSession {
    const now = new Date().toISOString();
    return {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      createdAt: now,
      updatedAt: now,
      persona,
      incidentCode,
      nodes: {},
      rootNodeIds: [],
      activeLeafId: null,
    };
  }

  private createSessionFromLegacy(
    legacyMessages: Array<{
      id?: string;
      sender: "user" | "assistant";
      text: string;
      persona?: ChatPersona;
      response?: ChatResponse;
      error?: boolean;
      timestamp?: string;
    }>,
    persona: ChatPersona,
  ): ChatSession {
    const session = this.createNewSessionObject("Conversación previa", persona);
    let lastId: string | null = null;

    for (const msg of legacyMessages) {
      const nodeId =
        msg.id ??
        `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const node: ChatMessageNode = {
        id: nodeId,
        parentId: lastId,
        childrenIds: [],
        sender: msg.sender,
        text: msg.text,
        persona: msg.persona ?? persona,
        response: msg.response,
        reasoning: msg.response?.reasoning,
        trace: msg.response?.trace,
        error: msg.error,
        timestamp:
          msg.timestamp ??
          new Date().toLocaleTimeString("es-ES", {
            hour: "2-digit",
            minute: "2-digit",
          }),
      };

      session.nodes[nodeId] = node;
      if (lastId === null) {
        session.rootNodeIds.push(nodeId);
      } else if (session.nodes[lastId]) {
        session.nodes[lastId].childrenIds.push(nodeId);
      }
      lastId = nodeId;
    }

    session.activeLeafId = lastId;
    return session;
  }

  private saveToStorage(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        STORAGE_KEY_V2,
        JSON.stringify({
          sessions: this.sessions,
          activeSessionId: this.activeSessionId,
          persona: this.currentPersona,
        }),
      );
    } catch (err) {
      console.warn(
        "Storage quota exceeded or error saving chat sessions:",
        err,
      );
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSessions(): ChatSession[] {
    return [...this.sessions].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  getActiveSession(): ChatSession {
    let session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) {
      if (this.sessions.length === 0) {
        this.initDefaultSession();
      }
      session = this.sessions[0];
      this.activeSessionId = session.id;
    }
    return session;
  }

  setActiveSession(sessionId: string): void {
    const exists = this.sessions.some((s) => s.id === sessionId);
    if (exists && this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      const s = this.getActiveSession();
      this.currentPersona = s.persona;
      this.saveToStorage();
    }
  }

  createSession(
    title?: string,
    persona?: ChatPersona,
    incidentCode?: string,
  ): ChatSession {
    const finalTitle = title || "Nueva Consulta";
    const finalPersona = persona || this.currentPersona || "auditor";
    const session = this.createNewSessionObject(
      finalTitle,
      finalPersona,
      incidentCode,
    );
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.currentPersona = finalPersona;
    this.saveToStorage();
    return session;
  }

  deleteSession(sessionId: string): void {
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    if (this.sessions.length === 0) {
      this.initDefaultSession();
    } else if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0].id;
      this.currentPersona = this.sessions[0].persona;
    }
    this.saveToStorage();
  }

  renameSession(sessionId: string, title: string): void {
    const s = this.sessions.find((s) => s.id === sessionId);
    if (s && title.trim()) {
      s.title = title.trim();
      s.updatedAt = new Date().toISOString();
      this.saveToStorage();
    }
  }

  clearAll(): void {
    this.initDefaultSession();
  }

  getPersona(): ChatPersona {
    return this.currentPersona;
  }

  setPersona(persona: ChatPersona): void {
    this.currentPersona = persona;
    const session = this.getActiveSession();
    session.persona = persona;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
  }

  addUserMessage(
    text: string,
    incidentCode?: string,
    persona?: ChatPersona,
  ): ChatMessageNode {
    const session = this.getActiveSession();
    const nodeId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const parentId = session.activeLeafId;
    const node: ChatMessageNode = {
      id: nodeId,
      parentId,
      childrenIds: [],
      sender: "user",
      text,
      incidentCode,
      persona: persona || this.currentPersona,
      timestamp,
    };

    session.nodes[nodeId] = node;
    if (parentId === null) {
      session.rootNodeIds.push(nodeId);
    } else if (session.nodes[parentId]) {
      session.nodes[parentId].childrenIds.push(nodeId);
    }

    session.activeLeafId = nodeId;
    session.updatedAt = new Date().toISOString();

    // Auto-update session title if it's the first message
    if (
      session.rootNodeIds.length === 1 &&
      Object.keys(session.nodes).length === 1
    ) {
      session.title = text.length > 36 ? `${text.slice(0, 36)}…` : text;
    }

    this.saveToStorage();
    return node;
  }

  addAssistantResponse(
    parentUserNodeId: string,
    response: ChatResponse,
    error = false,
  ): ChatMessageNode {
    const session = this.getActiveSession();
    const nodeId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const node: ChatMessageNode = {
      id: nodeId,
      parentId: parentUserNodeId,
      childrenIds: [],
      sender: "assistant",
      text: response.reply,
      persona: response.persona,
      response,
      reasoning: response.reasoning,
      trace: response.trace,
      error,
      timestamp,
    };

    session.nodes[nodeId] = node;
    const parentNode = session.nodes[parentUserNodeId];
    if (parentNode) {
      parentNode.childrenIds.push(nodeId);
    }

    session.activeLeafId = nodeId;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
    return node;
  }

  editUserMessage(targetNodeId: string, newText: string): ChatMessageNode {
    const session = this.getActiveSession();
    const targetNode = session.nodes[targetNodeId];
    if (targetNode?.sender !== "user") {
      throw new Error(`Invalid user node ${targetNodeId}`);
    }

    const newNodeId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const newNode: ChatMessageNode = {
      id: newNodeId,
      parentId: targetNode.parentId,
      childrenIds: [],
      sender: "user",
      text: newText,
      incidentCode: targetNode.incidentCode,
      persona: targetNode.persona,
      timestamp,
    };

    session.nodes[newNodeId] = newNode;
    if (targetNode.parentId === null) {
      session.rootNodeIds.push(newNodeId);
    } else if (session.nodes[targetNode.parentId]) {
      session.nodes[targetNode.parentId].childrenIds.push(newNodeId);
    }

    session.activeLeafId = newNodeId;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
    return newNode;
  }

  switchBranch(nodeId: string): void {
    const session = this.getActiveSession();
    if (!session.nodes[nodeId]) return;

    // From this node, navigate downwards following the first/latest child until a leaf is found
    let currentId = nodeId;
    while (session.nodes[currentId]?.childrenIds.length > 0) {
      const children = session.nodes[currentId].childrenIds;
      currentId = children[children.length - 1];
    }

    session.activeLeafId = currentId;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
  }

  getActiveBranchMessages(): ActiveMessageItem[] {
    const session = this.getActiveSession();
    if (!session.activeLeafId || !session.nodes[session.activeLeafId]) {
      return [];
    }

    // Build path from activeLeafId upwards to root
    const path: ChatMessageNode[] = [];
    let current: ChatMessageNode | null = session.nodes[session.activeLeafId];
    while (current) {
      path.unshift(current);
      current = current.parentId
        ? (session.nodes[current.parentId] ?? null)
        : null;
    }

    // Compute sibling counts and branch indices
    return path.map((node) => {
      let siblings: string[] = [];
      if (node.parentId === null) {
        siblings = session.rootNodeIds;
      } else {
        const parent = session.nodes[node.parentId];
        siblings = parent ? parent.childrenIds : [node.id];
      }
      const branchIndex = siblings.indexOf(node.id);
      return {
        node,
        branchIndex: Math.max(branchIndex, 0),
        totalBranches: siblings.length > 0 ? siblings.length : 1,
        siblingIds: siblings,
      };
    });
  }

  // Backward compatibility methods for existing code
  getMessages(): Array<{
    id: string;
    sender: "user" | "assistant";
    text: string;
    persona?: ChatPersona;
    response?: ChatResponse;
    error?: boolean;
    timestamp: string;
  }> {
    return this.getActiveBranchMessages().map((item) => ({
      id: item.node.id,
      sender: item.node.sender,
      text: item.node.text,
      persona: item.node.persona,
      response: item.node.response,
      error: item.node.error,
      timestamp: item.node.timestamp,
    }));
  }

  clear(): void {
    const session = this.getActiveSession();
    session.nodes = {};
    session.rootNodeIds = [];
    session.activeLeafId = null;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
  }
}

export const chatStore = new ChatStore();
