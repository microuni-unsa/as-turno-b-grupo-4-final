import { getSession } from "@pims/cockpit/ui/lib/session.ts";
import type { AgentEvent } from "@pims/types/agent.ts";
import type { CockpitTimer, StreamSnapshot } from "@pims/types/cockpit.ts";

export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface SseClientState {
  status: ConnectionState;
  snapshot: StreamSnapshot | null;
  timers: Map<string, CockpitTimer>;
}

class CockpitSseClient {
  private status: ConnectionState = "disconnected";
  private snapshot: StreamSnapshot | null = null;
  private readonly timers = new Map<string, CockpitTimer>();
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;

  start(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (this.status === "connected" || this.status === "connecting") {
      return;
    }
    void this.connect();
  }

  stop(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController !== null) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.setStatus("disconnected");
  }

  getState(): SseClientState {
    return {
      status: this.status,
      snapshot: this.snapshot,
      timers: new Map(this.timers),
    };
  }

  private setStatus(newStatus: ConnectionState): void {
    if (this.status === newStatus) {
      return;
    }
    this.status = newStatus;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cockpit:connection-status", {
          detail: { status: newStatus },
        }),
      );
    }
  }

  private async connect(): Promise<void> {
    const session = getSession();
    if (session === null || session.access_token === "") {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("connecting");
    this.abortController = new AbortController();

    try {
      const response = await fetch("/api/stream", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "text/event-stream",
        },
        signal: this.abortController.signal,
      });

      if (!response.ok || response.body === null) {
        throw new Error(`SSE stream failed with status ${response.status}`);
      }

      this.setStatus("connected");
      this.backoffMs = 1000;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const block of parts) {
          this.processEventBlock(block);
        }
      }
    } catch {
      // Stream error or aborted
    } finally {
      if (this.status !== "disconnected") {
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(this.backoffMs, 10_000);
    this.backoffMs = Math.min(this.backoffMs * 1.5, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private processEventBlock(block: string): void {
    const lines = block.split("\n");
    let eventType = "message";
    let dataText = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataText = line.slice(5).trim();
      }
    }

    if (dataText === "") {
      return;
    }

    try {
      const parsedData = JSON.parse(dataText) as unknown;

      if (eventType === "snapshot") {
        const snapshot = parsedData as StreamSnapshot;
        this.snapshot = snapshot;
        this.timers.clear();
        for (const timer of snapshot.timers) {
          this.timers.set(timer.timer_id, timer);
        }
        window.dispatchEvent(
          new CustomEvent("cockpit:snapshot", { detail: snapshot }),
        );
      } else if (eventType === "agent") {
        const agentEvent = parsedData as AgentEvent;
        if (agentEvent.type === "scheduler:timer_tick") {
          this.timers.set(agentEvent.timer_id, {
            timer_id: agentEvent.timer_id,
            incident_code: agentEvent.incident_code,
            timer_type: agentEvent.timer_kind,
            fire_at_utc: agentEvent.fire_at_utc,
            remaining_ms: agentEvent.remaining_ms,
          });
        }
        window.dispatchEvent(
          new CustomEvent("cockpit:agent-event", { detail: agentEvent }),
        );
      }
    } catch {
      // Ignored malformed JSON
    }
  }
}

export const sseClient = new CockpitSseClient();
