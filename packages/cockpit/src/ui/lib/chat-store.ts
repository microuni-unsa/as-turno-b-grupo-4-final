import type {
  ChatFormMutation,
  ChatPersona,
  ChatResponse,
  ChatTrace,
  GuidedReporting,
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
  form_mutation?: ChatFormMutation;
  formContext?: Partial<GuidedReporting>;
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
  draftSnapshot?: Partial<GuidedReporting>;
}

export interface ActiveMessageItem {
  node: ChatMessageNode;
  branchIndex: number;
  totalBranches: number;
  siblingIds: string[];
}

const STORAGE_KEY_V2 = "pims_cockpit_sessions_v2";
const DEFAULT_PERSONA: ChatPersona = "auditor";
const DEFAULT_TITLE = "Nueva Conversación";
const DEFAULT_CONSULTA_TITLE = "Nueva Consulta";
const MAX_TITLE_LENGTH = 36;

const TIME_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
});

function generateSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `sess-${crypto.randomUUID()}`;
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `msg-${crypto.randomUUID()}`;
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export class ChatStore {
  private sessions: ChatSession[] = [];
  private activeSessionId: string = "";
  private currentPersona: ChatPersona = DEFAULT_PERSONA;
  private listeners = new Set<() => void>();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined") {
      this.initDefaultSession();
      return;
    }

    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2 !== null) {
      try {
        const parsed = JSON.parse(rawV2) as {
          sessions: ChatSession[];
          activeSessionId: string;
          persona?: ChatPersona;
        };
        if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
          this.sessions = parsed.sessions;
          const found = parsed.sessions.find(
            (s) => s.id === parsed.activeSessionId,
          );
          if (found !== undefined) {
            this.activeSessionId = found.id;
          } else {
            const first = parsed.sessions[0];
            if (first !== undefined) {
              this.activeSessionId = first.id;
            } else {
              throw new Error("ChatStore: sessions array is empty");
            }
          }
          if (parsed.persona !== undefined) {
            this.currentPersona = parsed.persona;
          } else {
            this.currentPersona = DEFAULT_PERSONA;
          }
          return;
        } else {
          this.initDefaultSession();
          return;
        }
      } catch (err) {
        throw new Error(
          `ChatStore: failed to parse localStorage (${STORAGE_KEY_V2}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      this.initDefaultSession();
      return;
    }
  }

  private initDefaultSession(): void {
    const defaultSession = this.createNewSessionObject(
      DEFAULT_TITLE,
      DEFAULT_PERSONA,
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
      id: generateSessionId(),
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

  private saveToStorage(): void {
    if (typeof window === "undefined") {
      this.notify();
      return;
    }
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
      throw new Error(
        `ChatStore: failed to write to localStorage: ${err instanceof Error ? err.message : String(err)}`,
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
      const first = this.sessions[0];
      if (!first) {
        throw new Error("ChatStore: failed to initialize active session");
      }
      session = first;
      this.activeSessionId = session.id;
    }
    return session;
  }

  getActiveSessionId(): string {
    return this.getActiveSession().id;
  }

  setActiveSession(sessionId: string): void {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`ChatStore: session with id ${sessionId} not found`);
    }
    if (this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      this.currentPersona = session.persona;
      this.saveToStorage();
    }
  }

  createSession(
    title?: string,
    persona?: ChatPersona,
    incidentCode?: string,
  ): ChatSession {
    const finalTitle =
      title !== undefined && title.trim() !== ""
        ? title.trim()
        : DEFAULT_CONSULTA_TITLE;
    const finalPersona = persona !== undefined ? persona : this.currentPersona;
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
    const initialCount = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    if (this.sessions.length === initialCount) {
      throw new Error(`ChatStore: session with id ${sessionId} not found`);
    }
    if (this.sessions.length === 0) {
      this.initDefaultSession();
    } else if (this.activeSessionId === sessionId) {
      const first = this.sessions[0];
      if (first !== undefined) {
        this.activeSessionId = first.id;
        this.currentPersona = first.persona;
      } else {
        throw new Error("ChatStore: no remaining sessions found");
      }
    }
    this.saveToStorage();
  }

  renameSession(sessionId: string, title: string): void {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`ChatStore: session with id ${sessionId} not found`);
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      throw new Error("ChatStore: session title cannot be empty");
    }
    session.title = trimmedTitle;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
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
    formContext?: Partial<GuidedReporting>,
  ): ChatMessageNode {
    const session = this.getActiveSession();
    const nodeId = generateMessageId();
    const timestamp = TIME_FORMATTER.format(new Date());

    const parentId = session.activeLeafId;
    const finalPersona = persona !== undefined ? persona : this.currentPersona;
    const node: ChatMessageNode = {
      id: nodeId,
      parentId,
      childrenIds: [],
      sender: "user",
      text,
      incidentCode,
      persona: finalPersona,
      timestamp,
      formContext,
    };

    session.nodes[nodeId] = node;
    if (parentId === null) {
      session.rootNodeIds.push(nodeId);
    } else {
      const parentNode = session.nodes[parentId];
      if (parentNode !== undefined) {
        parentNode.childrenIds.push(nodeId);
      } else {
        throw new Error(
          `ChatStore: parent message node ${parentId} not found in session`,
        );
      }
    }

    session.activeLeafId = nodeId;
    session.updatedAt = new Date().toISOString();

    // Auto-update session title if it's the first message
    if (
      session.rootNodeIds.length === 1 &&
      Object.keys(session.nodes).length === 1
    ) {
      session.title =
        text.length > MAX_TITLE_LENGTH
          ? `${text.slice(0, MAX_TITLE_LENGTH)}…`
          : text;
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
    const nodeId = generateMessageId();
    const timestamp = TIME_FORMATTER.format(new Date());

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
      form_mutation: response.form_mutation,
    };

    session.nodes[nodeId] = node;
    const parentNode = session.nodes[parentUserNodeId];
    if (parentNode !== undefined) {
      parentNode.childrenIds.push(nodeId);
    } else {
      throw new Error(
        `ChatStore: parent user node ${parentUserNodeId} not found in session`,
      );
    }

    session.activeLeafId = nodeId;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
    return node;
  }

  editUserMessage(
    targetNodeId: string,
    newText: string,
    formContext?: Partial<GuidedReporting>,
  ): ChatMessageNode {
    const session = this.getActiveSession();
    const targetNode = session.nodes[targetNodeId];
    if (targetNode === undefined) {
      throw new Error(`ChatStore: target node ${targetNodeId} not found`);
    }
    if (targetNode.sender !== "user") {
      throw new Error(
        `ChatStore: invalid user node ${targetNodeId}, sender is ${targetNode.sender}`,
      );
    }

    const newNodeId = generateMessageId();
    const timestamp = TIME_FORMATTER.format(new Date());

    const resolvedFormContext =
      formContext !== undefined ? formContext : targetNode.formContext;

    const newNode: ChatMessageNode = {
      id: newNodeId,
      parentId: targetNode.parentId,
      childrenIds: [],
      sender: "user",
      text: newText,
      incidentCode: targetNode.incidentCode,
      persona: targetNode.persona,
      timestamp,
      formContext: resolvedFormContext,
    };

    session.nodes[newNodeId] = newNode;
    if (targetNode.parentId === null) {
      session.rootNodeIds.push(newNodeId);
    } else {
      const parentNode = session.nodes[targetNode.parentId];
      if (parentNode !== undefined) {
        parentNode.childrenIds.push(newNodeId);
      } else {
        throw new Error(
          `ChatStore: parent node ${targetNode.parentId} not found in session`,
        );
      }
    }

    session.activeLeafId = newNodeId;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
    return newNode;
  }

  switchBranch(nodeId: string): void {
    const session = this.getActiveSession();
    const targetNode = session.nodes[nodeId];
    if (targetNode === undefined) {
      throw new Error(
        `ChatStore: cannot switch branch, node ${nodeId} not found in session`,
      );
    }

    let currentId = nodeId;
    while (true) {
      const currentNode = session.nodes[currentId];
      if (currentNode === undefined) {
        throw new Error(
          `ChatStore: node ${currentId} not found during branch descent`,
        );
      }
      const children = currentNode.childrenIds;
      if (children.length === 0) {
        break;
      }
      const nextId = children[children.length - 1];
      if (nextId === undefined) {
        throw new Error(
          `ChatStore: child node index invalid for node ${currentId}`,
        );
      }
      currentId = nextId;
    }

    session.activeLeafId = currentId;
    session.updatedAt = new Date().toISOString();
    this.saveToStorage();
  }

  getActiveBranchMessages(): ActiveMessageItem[] {
    const session = this.getActiveSession();
    if (session.activeLeafId === null) {
      return [];
    }
    const leafNode = session.nodes[session.activeLeafId];
    if (leafNode === undefined) {
      throw new Error(
        `ChatStore: active leaf node ${session.activeLeafId} not found in session`,
      );
    }

    // Build path from activeLeafId upwards to root
    const path: ChatMessageNode[] = [];
    let current: ChatMessageNode | null = leafNode;
    while (current !== null) {
      path.unshift(current);
      if (current.parentId !== null) {
        const parentNode: ChatMessageNode | undefined =
          session.nodes[current.parentId];
        if (parentNode !== undefined) {
          current = parentNode;
        } else {
          throw new Error(
            `ChatStore: parent node ${current.parentId} not found for node ${current.id}`,
          );
        }
      } else {
        current = null;
      }
    }

    // Compute sibling counts and branch indices
    return path.map((node) => {
      let siblings: string[];
      if (node.parentId === null) {
        siblings = session.rootNodeIds;
      } else {
        const parent = session.nodes[node.parentId];
        if (parent !== undefined) {
          siblings = parent.childrenIds;
        } else {
          throw new Error(
            `ChatStore: parent node ${node.parentId} not found for sibling lookup`,
          );
        }
      }
      const branchIndex = siblings.indexOf(node.id);
      if (branchIndex === -1) {
        throw new Error(
          `ChatStore: node ${node.id} not found among its siblings`,
        );
      }
      return {
        node,
        branchIndex,
        totalBranches: siblings.length,
        siblingIds: siblings,
      };
    });
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
