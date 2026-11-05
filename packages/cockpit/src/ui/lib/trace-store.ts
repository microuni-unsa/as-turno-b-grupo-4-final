import type { AgentEvent } from "@pims/types/agent.ts";
import type { ChatTrace, ChatTraceSpan } from "@pims/types/cockpit.ts";

export type AxisMode = "duration" | "turns" | "calls";

const MAX_TRACES = 50;
const SPAN_DURATION_MS = 50;

export class TraceStore {
  private traces: ChatTrace[] = [];
  private activeTraceId: string | null = null;
  private selectedSpanId: string | null = null;
  private axisMode: AxisMode = "duration";
  private compressIdle = true;
  private searchQuery = "";
  private listeners = new Set<() => void>();

  // Live Agent Event accumulator
  private liveAgentEvents: AgentEvent[] = [];
  private liveAgentStartTime: number = Date.now();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("cockpit:agent-event", ((
        e: CustomEvent<AgentEvent>,
      ) => {
        this.ingestAgentEvent(e.detail);
      }) as EventListener);
    } else {
      // Non-browser / SSR environment: listener registration skipped
    }
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

  addTrace(trace: ChatTrace, makeActive = true): void {
    const existingIndex = this.traces.findIndex((t) => t.id === trace.id);
    if (existingIndex >= 0) {
      this.traces[existingIndex] = trace;
    } else {
      this.traces.unshift(trace);
      if (this.traces.length > MAX_TRACES) {
        this.traces.pop();
      }
    }

    if (makeActive || this.activeTraceId === null) {
      this.activeTraceId = trace.id;
      const firstSpan = trace.spans.length > 0 ? trace.spans[0] : undefined;
      this.selectedSpanId = firstSpan !== undefined ? firstSpan.id : null;
    } else {
      // Retain existing active trace and selection
    }

    this.notify();
  }

  getTraces(): ChatTrace[] {
    return [...this.traces];
  }

  getActiveTrace(): ChatTrace | null {
    if (this.activeTraceId === null) {
      if (this.traces.length > 0) {
        const first = this.traces[0];
        return first !== undefined ? first : null;
      }
      return null;
    }
    const found = this.traces.find((t) => t.id === this.activeTraceId);
    return found !== undefined ? found : null;
  }

  setActiveTrace(id: string): void {
    const targetTrace = this.traces.find((t) => t.id === id);
    if (targetTrace === undefined) {
      throw new Error(`TraceStore: trace with id ${id} not found`);
    }

    if (this.activeTraceId !== id) {
      this.activeTraceId = id;
      if (targetTrace.spans.length > 0) {
        const firstSpan = targetTrace.spans[0];
        this.selectedSpanId = firstSpan !== undefined ? firstSpan.id : null;
      } else {
        this.selectedSpanId = null;
      }
      this.notify();
    } else {
      // Already active trace
    }
  }

  getSelectedSpan(): ChatTraceSpan | null {
    const trace = this.getActiveTrace();
    if (trace === null || this.selectedSpanId === null) {
      return null;
    }
    const found = trace.spans.find((s) => s.id === this.selectedSpanId);
    return found !== undefined ? found : null;
  }

  setSelectedSpan(spanId: string | null): void {
    if (spanId !== null) {
      const activeTrace = this.getActiveTrace();
      if (activeTrace === null) {
        throw new Error(
          "TraceStore: cannot select span without an active trace",
        );
      }
      const spanExists = activeTrace.spans.some((s) => s.id === spanId);
      if (!spanExists) {
        throw new Error(
          `TraceStore: span with id ${spanId} not found in active trace`,
        );
      }
    }

    if (this.selectedSpanId !== spanId) {
      this.selectedSpanId = spanId;
      this.notify();
    } else {
      // Already selected span
    }
  }

  getAxisMode(): AxisMode {
    return this.axisMode;
  }

  setAxisMode(mode: AxisMode): void {
    if (mode !== "duration" && mode !== "turns" && mode !== "calls") {
      throw new Error(`TraceStore: invalid axis mode: ${mode}`);
    }
    if (this.axisMode !== mode) {
      this.axisMode = mode;
      this.notify();
    } else {
      // No change
    }
  }

  isCompressIdle(): boolean {
    return this.compressIdle;
  }

  setCompressIdle(compress: boolean): void {
    if (this.compressIdle !== compress) {
      this.compressIdle = compress;
      this.notify();
    } else {
      // No change
    }
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  setSearchQuery(query: string): void {
    if (this.searchQuery !== query) {
      this.searchQuery = query;
      this.notify();
    } else {
      // No change
    }
  }

  // Convert live agent events from SSE into an inspectable timeline trace
  private ingestAgentEvent(event: AgentEvent): void {
    this.liveAgentEvents.push(event);

    const now = Date.now();
    let incidentCode = "AGENT-LOOP";
    if (
      "incident_code" in event &&
      typeof event.incident_code === "string" &&
      event.incident_code.trim() !== ""
    ) {
      incidentCode = event.incident_code;
    }
    const traceId = `live-agent-${incidentCode}`;

    let liveTrace = this.traces.find((t) => t.id === traceId);
    if (!liveTrace) {
      liveTrace = {
        id: traceId,
        title: `Agente Autónomo [${incidentCode}]`,
        start_iso: new Date(this.liveAgentStartTime).toISOString(),
        wall_time_ms: 0,
        model_time_ms: 0,
        tool_time_ms: 0,
        idle_time_ms: 0,
        turns_count: 1,
        requests_count: 1,
        tool_calls_count: 0,
        spans: [],
        aggregates: [],
      };
      this.traces.unshift(liveTrace);
    }

    const relStart = Number(
      ((now - this.liveAgentStartTime) / 1000).toFixed(2),
    );
    const sanitizedType = event.type.replace(/[^a-zA-Z0-9]/g, "_");
    const spanId = `live-span-${liveTrace.spans.length + 1}-${sanitizedType}`;

    let spanType: "turn" | "tool" | "model" | "agent";
    let track: string;
    if (event.type === "tool:mutation" || event.type === "rag:retrieval") {
      spanType = "tool";
      track = "Tools";
      liveTrace.tool_calls_count += 1;
    } else if (event.type === "role:transition") {
      spanType = "agent";
      track = "Main";
    } else if (event.type === "scheduler:timer_tick") {
      spanType = "turn";
      track = "Timers";
    } else if (event.type === "agent:error") {
      spanType = "agent";
      track = "Errors";
    } else {
      spanType = "agent";
      track = "Main";
    }

    const newSpan: ChatTraceSpan = {
      id: spanId,
      name: event.type,
      type: spanType,
      status: event.type === "agent:error" ? "error" : "ok",
      start_ms: relStart * 1000,
      end_ms: relStart * 1000 + SPAN_DURATION_MS,
      duration_ms: SPAN_DURATION_MS,
      relative_start_ms: relStart * 1000,
      args: event as unknown as Record<string, unknown>,
      result: `Event: ${event.type}`,
      track,
    };

    liveTrace.spans.push(newSpan);
    liveTrace.wall_time_ms = Number(now - this.liveAgentStartTime);

    // Recompute aggregates
    const toolMap = new Map<
      string,
      { calls: number; errors: number; total_ms: number; max_ms: number }
    >();
    for (const span of liveTrace.spans.filter((s) => s.type === "tool")) {
      const existing = toolMap.get(span.name);
      if (existing !== undefined) {
        existing.calls += 1;
        existing.total_ms += span.duration_ms;
        existing.max_ms = Math.max(existing.max_ms, span.duration_ms);
        if (span.status === "error") {
          existing.errors += 1;
        }
      } else {
        toolMap.set(span.name, {
          calls: 1,
          errors: span.status === "error" ? 1 : 0,
          total_ms: span.duration_ms,
          max_ms: span.duration_ms,
        });
      }
    }

    liveTrace.aggregates = Array.from(toolMap.entries()).map(
      ([tool, stats]) => ({
        tool,
        calls: stats.calls,
        errors: stats.errors,
        total_ms: stats.total_ms,
        avg_ms: Number((stats.total_ms / stats.calls).toFixed(2)),
        max_ms: stats.max_ms,
      }),
    );

    this.notify();
  }
}

export const traceStore = new TraceStore();
