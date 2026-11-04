import type { AgentEvent } from "@pims/types/agent.ts";

const MAX_BUFFER_SIZE = 100;

class EventStore {
  private events: AgentEvent[] = [];

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("cockpit:agent-event", ((
        e: CustomEvent<AgentEvent>,
      ) => {
        this.addEvent(e.detail);
      }) as EventListener);
    }
  }

  addEvent(event: AgentEvent): void {
    this.events.unshift(event);
    if (this.events.length > MAX_BUFFER_SIZE) {
      this.events.pop();
    }
  }

  getEvents(): AgentEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export const eventStore = new EventStore();
