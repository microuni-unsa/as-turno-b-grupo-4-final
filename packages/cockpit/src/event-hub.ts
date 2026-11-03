import type { AgentEventEmitter } from "@pims/agent/events/agent-events.ts";
import {
  checkPendingDecisions,
  getRegulatoryTimers,
  listActiveIncidents,
} from "@pims/cockpit/chat-tools.ts";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { AgentEvent } from "@pims/types/agent.ts";
import type { CockpitSession, StreamSnapshot } from "@pims/types/cockpit.ts";

export interface CockpitHubSubscriber {
  session: CockpitSession;
  send: (id: number, event: AgentEvent) => void;
}

export function canReceiveEvent(
  session: CockpitSession,
  event: AgentEvent,
): boolean {
  if (!session.permissions.includes("view_incident")) {
    return false;
  }
  if (
    event.type === "tool:mutation" &&
    !session.permissions.includes("view_securitylog")
  ) {
    return false;
  }
  return true;
}

export class CockpitEventHub {
  private readonly subscribers = new Set<CockpitHubSubscriber>();
  private readonly unsubscribeEmitter: () => void;
  private nextId = 1;

  constructor(emitter: AgentEventEmitter) {
    this.unsubscribeEmitter = emitter.subscribe((event) => {
      this.broadcast(event);
    });
  }

  get clientCount(): number {
    return this.subscribers.size;
  }

  allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  subscribe(
    session: CockpitSession,
    send: (id: number, event: AgentEvent) => void,
  ): () => void {
    const subscriber: CockpitHubSubscriber = { session, send };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  broadcast(event: AgentEvent): void {
    for (const subscriber of this.subscribers) {
      if (!canReceiveEvent(subscriber.session, event)) {
        continue;
      }
      subscriber.send(this.allocateId(), event);
    }
  }

  close(): void {
    this.unsubscribeEmitter();
    this.subscribers.clear();
  }
}

export async function buildSnapshot(
  adapter: PimsAdapter,
  store: EvidenceStore,
  clock: () => Date,
  session: CockpitSession,
): Promise<StreamSnapshot> {
  const incidents = await listActiveIncidents(adapter);
  const timers = await getRegulatoryTimers(store, clock);
  const pendingDecisions = await checkPendingDecisions(adapter, store, session);
  return {
    incidents,
    timers,
    pending_decisions: pendingDecisions,
  };
}
