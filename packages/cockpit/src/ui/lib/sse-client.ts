import {
  EVENT_SESSION_EXPIRED,
  getSession,
  notifySessionExpired,
} from "@pims/cockpit/ui/lib/session.ts";
import type { AgentEvent } from "@pims/types/agent.ts";
import type { CockpitTimer, StreamSnapshot } from "@pims/types/cockpit.ts";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "failed";

export interface SseBackoffOptions {
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
}

export const DEFAULT_SSE_BACKOFF: SseBackoffOptions = {
  initialDelayMs: 1000,
  multiplier: 1.5,
  maxDelayMs: 10_000,
};

export const SSE_STREAM_PATH = "/api/stream";
export const SSE_EVENT_CONNECTION_STATUS = "cockpit:connection-status";
export const SSE_EVENT_SNAPSHOT = "cockpit:snapshot";
export const SSE_EVENT_AGENT = "cockpit:agent-event";
export const SSE_EVENT_PARSE_ERROR = "cockpit:sse-parse-error";
export const REASON_STREAM_UNAUTHORIZED = "STREAM_UNAUTHORIZED";

export interface SseClientState {
  status: ConnectionState;
  snapshot: StreamSnapshot | null;
  timers: Map<string, CockpitTimer>;
}

export class CockpitSseClient {
  private status: ConnectionState = "closed";
  private snapshot: StreamSnapshot | null = null;
  private readonly timers = new Map<string, CockpitTimer>();
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDelayMs: number;
  private readonly backoffOptions: SseBackoffOptions;
  private authRevoked = false;

  constructor(backoff: SseBackoffOptions = DEFAULT_SSE_BACKOFF) {
    this.backoffOptions = backoff;
    this.currentDelayMs = backoff.initialDelayMs;

    if (typeof window !== "undefined") {
      window.addEventListener(EVENT_SESSION_EXPIRED, () => {
        this.authRevoked = true;
        this.stop();
      });
    } else {
      // Non-browser / SSR environment: session-expired listener registration skipped
    }
  }

  start(): void {
    if (typeof window === "undefined") {
      return;
    }
    this.authRevoked = false;
    if (this.status === "connected" || this.status === "connecting") {
      return;
    }
    if (this.status === "reconnecting") {
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
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
    this.currentDelayMs = this.backoffOptions.initialDelayMs;
    this.setStatus("closed");
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
        new CustomEvent(SSE_EVENT_CONNECTION_STATUS, {
          detail: { status: newStatus },
        }),
      );
    } else {
      // Non-browser environment: event dispatch skipped
    }
  }

  private async connect(): Promise<void> {
    if (this.authRevoked) {
      this.setStatus("closed");
      return;
    }

    const session = getSession();
    if (session === null || session.access_token.trim() === "") {
      this.setStatus("closed");
      return;
    }

    this.setStatus("connecting");
    this.abortController = new AbortController();

    try {
      const response = await fetch(SSE_STREAM_PATH, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "text/event-stream",
        },
        signal: this.abortController.signal,
      });

      if (response.status === 401) {
        this.authRevoked = true;
        this.setStatus("closed");
        notifySessionExpired(REASON_STREAM_UNAUTHORIZED);
        return;
      }

      if (!response.ok) {
        this.setStatus("failed");
        throw new Error(
          `SSE stream request failed with HTTP ${response.status}`,
        );
      }
      if (response.body === null) {
        this.setStatus("failed");
        throw new Error("SSE stream response body is null");
      }

      this.setStatus("connected");
      this.currentDelayMs = this.backoffOptions.initialDelayMs;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          this.setStatus("closed");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        const lastPart = parts.pop();
        if (lastPart !== undefined) {
          buffer = lastPart;
        } else {
          buffer = "";
        }

        for (const block of parts) {
          this.processEventBlock(block);
        }
      }
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      if (errorObj.name === "AbortError") {
        this.setStatus("closed");
      } else {
        this.setStatus("failed");
        if (!this.authRevoked) {
          this.scheduleReconnect();
        }
      }
    } finally {
      if (
        !this.authRevoked &&
        this.status !== "closed" &&
        this.status !== "reconnecting"
      ) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.authRevoked || this.reconnectTimer !== null) {
      return;
    }
    this.setStatus("reconnecting");
    const delay = Math.min(this.currentDelayMs, this.backoffOptions.maxDelayMs);
    this.currentDelayMs = Math.min(
      Math.round(this.currentDelayMs * this.backoffOptions.multiplier),
      this.backoffOptions.maxDelayMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private processEventBlock(block: string): void {
    const lines = block.split("\n");
    let eventType: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      } else if (line.startsWith(":") || line.trim() === "") {
      } else {
        // Ignore unhandled SSE metadata line
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    const dataText = dataLines.join("\n");
    const resolvedEventType =
      eventType !== null && eventType !== "" ? eventType : "message";

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(dataText) as unknown;
    } catch (parseErr) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SSE_EVENT_PARSE_ERROR, {
            detail: {
              error:
                parseErr instanceof Error ? parseErr.message : String(parseErr),
              raw: dataText,
            },
          }),
        );
      }
      return;
    }

    if (resolvedEventType === "snapshot") {
      const snapshot = parsedData as StreamSnapshot;
      this.snapshot = snapshot;
      this.timers.clear();
      for (const timer of snapshot.timers) {
        this.timers.set(timer.timer_id, timer);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SSE_EVENT_SNAPSHOT, { detail: snapshot }),
        );
      }
    } else if (resolvedEventType === "agent") {
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
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SSE_EVENT_AGENT, { detail: agentEvent }),
        );
      }
    }
  }
}

export const sseClient = new CockpitSseClient();
