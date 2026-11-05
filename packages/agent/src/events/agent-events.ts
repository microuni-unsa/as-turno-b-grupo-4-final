import { EventEmitter } from "node:events";
import type { AgentEvent } from "@pims/types/agent.ts";

export type AgentEventListener = (event: AgentEvent) => void;

const AGENT_EVENT = "agent_event";

export class AgentEventEmitter {
  private readonly emitter = new EventEmitter();

  emit(event: AgentEvent): void {
    this.emitter.emit(AGENT_EVENT, event);
  }

  subscribe(listener: AgentEventListener): () => void {
    this.emitter.on(AGENT_EVENT, listener);
    return () => {
      this.emitter.off(AGENT_EVENT, listener);
    };
  }

  get listenerCount(): number {
    return this.emitter.listenerCount(AGENT_EVENT);
  }
}
