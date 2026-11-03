import type { AgentEvent } from "@pims/types/agent.ts";

export type AgentEventListener = (event: AgentEvent) => void;

export class AgentEventEmitter {
  private readonly listeners = new Set<AgentEventListener>();

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
