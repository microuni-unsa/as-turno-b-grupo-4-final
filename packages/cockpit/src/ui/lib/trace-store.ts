import type { AgentEvent } from "@pims/types/agent.ts";
import type { ChatTrace, ChatTraceSpan } from "@pims/types/cockpit.ts";

export type AxisMode = "duration" | "turns" | "calls";

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
      if (this.traces.length > 50) {
        this.traces.pop();
      }
    }

    if (makeActive || this.activeTraceId === null) {
      this.activeTraceId = trace.id;
      this.selectedSpanId =
        trace.spans.length > 0 ? (trace.spans[0]?.id ?? null) : null;
    }

    this.notify();
  }

  getTraces(): ChatTrace[] {
    return [...this.traces];
  }

  getActiveTrace(): ChatTrace | null {
    if (!this.activeTraceId) {
      return this.traces.length > 0 ? (this.traces[0] ?? null) : null;
    }
    return this.traces.find((t) => t.id === this.activeTraceId) ?? null;
  }

  setActiveTrace(id: string): void {
    if (this.activeTraceId !== id) {
      this.activeTraceId = id;
      const t = this.getActiveTrace();
      this.selectedSpanId =
        t && t.spans.length > 0 ? (t.spans[0]?.id ?? null) : null;
      this.notify();
    }
  }

  getSelectedSpan(): ChatTraceSpan | null {
    const trace = this.getActiveTrace();
    if (!trace || !this.selectedSpanId) return null;
    return trace.spans.find((s) => s.id === this.selectedSpanId) ?? null;
  }

  setSelectedSpan(spanId: string | null): void {
    if (this.selectedSpanId !== spanId) {
      this.selectedSpanId = spanId;
      this.notify();
    }
  }

  getAxisMode(): AxisMode {
    return this.axisMode;
  }

  setAxisMode(mode: AxisMode): void {
    if (this.axisMode !== mode) {
      this.axisMode = mode;
      this.notify();
    }
  }

  isCompressIdle(): boolean {
    return this.compressIdle;
  }

  setCompressIdle(compress: boolean): void {
    if (this.compressIdle !== compress) {
      this.compressIdle = compress;
      this.notify();
    }
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.notify();
  }

  // Convert live agent events from SSE into an inspectable timeline trace
  private ingestAgentEvent(event: AgentEvent): void {
    this.liveAgentEvents.push(event);

    const now = Date.now();
    const incidentCode =
      (event as { incident_code?: string }).incident_code || "AGENT-LOOP";
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
    const spanId = `live-span-${liveTrace.spans.length + 1}-${event.type.replace(/[^a-zA-Z0-9]/g, "_")}`;

    let spanType: "turn" | "tool" | "model" | "agent" = "agent";
    let track = "Main";
    if (event.type === "tool:mutation") {
      spanType = "tool";
      track = "Tools";
      liveTrace.tool_calls_count += 1;
    } else if (event.type === "rag:retrieval") {
      spanType = "tool";
      track = "Tools";
      liveTrace.tool_calls_count += 1;
    } else if (event.type === "role:transition") {
      spanType = "agent";
      track = "Main";
    }

    const newSpan: ChatTraceSpan = {
      id: spanId,
      name: event.type,
      type: spanType,
      status: event.type === "agent:error" ? "error" : "ok",
      start_ms: relStart * 1000,
      end_ms: relStart * 1000 + 50,
      duration_ms: 50,
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
      const existing = toolMap.get(span.name) || {
        calls: 0,
        errors: 0,
        total_ms: 0,
        max_ms: 0,
      };
      existing.calls += 1;
      existing.total_ms += span.duration_ms;
      existing.max_ms = Math.max(existing.max_ms, span.duration_ms);
      toolMap.set(span.name, existing);
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
