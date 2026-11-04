import type { ChatPersona, ChatResponse } from "@pims/types/cockpit.ts";

export interface ChatMessageRecord {
  id: string;
  sender: "user" | "assistant";
  text: string;
  persona?: ChatPersona;
  response?: ChatResponse;
  error?: boolean;
  timestamp: string;
}

class ChatStore {
  private messages: ChatMessageRecord[] = [];
  private currentPersona: ChatPersona = "auditor";

  getMessages(): ChatMessageRecord[] {
    return [...this.messages];
  }

  addMessage(
    msg: Omit<ChatMessageRecord, "id" | "timestamp">,
  ): ChatMessageRecord {
    const record: ChatMessageRecord = {
      ...msg,
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    this.messages.push(record);
    return record;
  }

  clear(): void {
    this.messages = [];
  }

  getPersona(): ChatPersona {
    return this.currentPersona;
  }

  setPersona(persona: ChatPersona): void {
    this.currentPersona = persona;
  }
}

export const chatStore = new ChatStore();
