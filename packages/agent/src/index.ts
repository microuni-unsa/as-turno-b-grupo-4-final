import { IndicatorEmitter } from "@pims/agent/indicators/indicator-emitter.ts";
import { TotAnalyzer } from "@pims/agent/investigation/tot-analyzer.ts";
import { CloseChecklistVerifier } from "@pims/agent/lifecycle/close-checklist.ts";
import { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { IncidentOrchestrator } from "@pims/agent/orchestrator/orchestrator.ts";
import { RoleRegistry } from "@pims/agent/orchestrator/roles.ts";
import {
  DeadlineScheduler,
  type TimerEffects,
} from "@pims/agent/orchestrator/scheduler.ts";
import { ConstitutionalReviewer } from "@pims/agent/review/constitutional-judges.ts";
import { NoticeDraftService } from "@pims/agent/review/draft-service.ts";
import { createIncidentToolHandlers } from "@pims/agent/tools/incident-tools.ts";
import { createKnowledgeToolHandlers } from "@pims/agent/tools/knowledge-tools.ts";
import { createNoticeToolHandlers } from "@pims/agent/tools/notice-tools.ts";
import {
  type ToolDependencies,
  type ToolHandler,
  ToolRegistry,
} from "@pims/agent/tools/registry.ts";
import { createRiskAuditToolHandlers } from "@pims/agent/tools/risk-audit-tools.ts";
import {
  createUnconfiguredVoicePort,
  type VoicePort,
} from "@pims/agent/voice/voice-port.ts";
import type { AgentConfig } from "@pims/config";
import { BundleSealer } from "@pims/evidence/bundle-sealer.ts";
import type { EvidenceStore } from "@pims/evidence/evidence-store.ts";
import { ForensicScanner } from "@pims/evidence/forensic-scanner.ts";
import { ExemptionEngine } from "@pims/notices/exemption-engine.ts";
import { NoticeComposer } from "@pims/notices/notice-composer.ts";
import type { PimsAdapter } from "@pims/pims-adapter";
import type { RAGService } from "@pims/rag";
import type { ToolName } from "@pims/types/agent.ts";
import { PimsClientBugError } from "@pims/types/errors.ts";
import type { ModelProvider } from "@pims/types/models.ts";

export * from "@pims/agent/indicators/indicator-emitter.ts";
export * from "@pims/agent/investigation/tot-analyzer.ts";
export * from "@pims/agent/lifecycle/awareness.ts";
export * from "@pims/agent/lifecycle/close-checklist.ts";
export * from "@pims/agent/lifecycle/dedupe.ts";
export * from "@pims/agent/lifecycle/markers.ts";
export * from "@pims/agent/llm/safe-prompt.ts";
export * from "@pims/agent/orchestrator/lifecycle.ts";
export * from "@pims/agent/orchestrator/orchestrator.ts";
export * from "@pims/agent/orchestrator/roles.ts";
export * from "@pims/agent/orchestrator/scheduler.ts";
export * from "@pims/agent/review/constitutional-judges.ts";
export * from "@pims/agent/review/draft-service.ts";
export * from "@pims/agent/tools/helpers.ts";
export * from "@pims/agent/tools/incident-tools.ts";
export * from "@pims/agent/tools/knowledge-tools.ts";
export * from "@pims/agent/tools/notice-tools.ts";
export * from "@pims/agent/tools/registry.ts";
export * from "@pims/agent/tools/risk-audit-tools.ts";
export * from "@pims/agent/voice/voice-port.ts";

export interface CreateAgentDeps {
  adapter: PimsAdapter;
  evidenceStore: EvidenceStore;
  modelProvider: ModelProvider;
  ragService: RAGService;
  config: AgentConfig;
  bundleSealer?: BundleSealer;
  forensicScanner?: ForensicScanner;
  composer?: NoticeComposer;
  exemptionEngine?: ExemptionEngine;
  voice?: VoicePort;
  clock?: () => Date;
  fetchImpl?: typeof fetch;
  page?: (alert: {
    incident_code: string;
    kind: string;
    reason: string;
  }) => void;
}

export interface CreateAgentOptions {
  runProbes?: boolean;
}

export interface Agent {
  roles: RoleRegistry;
  tools: ToolRegistry;
  scheduler: DeadlineScheduler;
  reviewer: ConstitutionalReviewer;
  totAnalyzer: TotAnalyzer;
  draftService: NoticeDraftService;
  orchestrator: IncidentOrchestrator;
  indicator: IndicatorEmitter;
  modelClient: AgentModelClient;
  closeChecklist: CloseChecklistVerifier;
}

function requireEffects(holder: {
  current: TimerEffects | null;
}): TimerEffects {
  if (holder.current === null) {
    throw new PimsClientBugError(
      "DeadlineScheduler effects used before the orchestrator was wired",
    );
  }
  return holder.current;
}

export async function createAgent(
  deps: CreateAgentDeps,
  options?: CreateAgentOptions,
): Promise<Agent> {
  const clock = deps.clock ?? (() => new Date());
  const config = deps.config;
  const evidenceStore = deps.evidenceStore;
  const adapter = deps.adapter;
  const bundleSealer = deps.bundleSealer ?? new BundleSealer(evidenceStore);
  const forensicScanner = deps.forensicScanner ?? new ForensicScanner();
  const composer = deps.composer ?? new NoticeComposer({ now: clock });
  const exemptionEngine = deps.exemptionEngine ?? new ExemptionEngine();
  const voice = deps.voice ?? createUnconfiguredVoicePort();
  const modelClient = new AgentModelClient(deps.modelProvider);

  const roles = new RoleRegistry();
  const closeChecklist = new CloseChecklistVerifier({
    evidenceStore,
    adapter,
    clock,
  });
  const indicator = new IndicatorEmitter({
    store: evidenceStore,
    config,
    clock,
    fetchImpl: deps.fetchImpl,
  });

  const page =
    deps.page ??
    ((alert: { incident_code: string; kind: string; reason: string }) => {
      console.error(
        `PAGE:${alert.kind}:${alert.incident_code}:${alert.reason}`,
      );
    });

  const effectsHolder: { current: TimerEffects | null } = { current: null };
  const scheduler = new DeadlineScheduler({
    store: evidenceStore,
    config,
    clock,
    effects: {
      authorityDeadline: async (incidentCode) =>
        requireEffects(effectsHolder).authorityDeadline(incidentCode),
      processorDeadline: async (incidentCode) =>
        requireEffects(effectsHolder).processorDeadline(incidentCode),
      subjectDeadline: async (incidentCode) =>
        requireEffects(effectsHolder).subjectDeadline(incidentCode),
      reviewDeadline: async (incidentCode) =>
        requireEffects(effectsHolder).reviewDeadline(incidentCode),
      peruAdvisory: async (incidentCode) =>
        requireEffects(effectsHolder).peruAdvisory(incidentCode),
      phaseFollowup: async (incidentCode, payload) =>
        requireEffects(effectsHolder).phaseFollowup(incidentCode, payload),
      retry: async (incidentCode, payload) =>
        requireEffects(effectsHolder).retry(incidentCode, payload),
    },
    page,
  });

  const reviewer = new ConstitutionalReviewer({
    modelClient,
    ragService: deps.ragService,
    evidenceStore,
    config,
    clock,
  });
  const totAnalyzer = new TotAnalyzer({
    modelClient,
    ragService: deps.ragService,
    config,
  });
  const draftService = new NoticeDraftService({
    modelClient,
    ragService: deps.ragService,
    composer,
    evidenceStore,
    config,
    clock,
  });

  const toolDeps: ToolDependencies = {
    adapter,
    evidenceStore,
    bundleSealer,
    forensicScanner,
    closeChecklist,
    ragService: deps.ragService,
    modelClient,
    scheduler,
    indicator,
    voice,
    config,
    clock,
    roleRegistry: roles,
  };

  const handlers: Partial<Record<ToolName, ToolHandler>> = {
    ...createIncidentToolHandlers(toolDeps),
    ...createNoticeToolHandlers(toolDeps),
    ...createRiskAuditToolHandlers(toolDeps),
    ...createKnowledgeToolHandlers(toolDeps),
  };

  const tools = new ToolRegistry(
    toolDeps,
    handlers as Record<ToolName, ToolHandler>,
  );

  const orchestrator = new IncidentOrchestrator({
    adapter,
    tools,
    evidenceStore,
    bundleSealer,
    forensicScanner,
    modelClient,
    scheduler,
    reviewer,
    draftService,
    totAnalyzer,
    composer,
    exemptionEngine,
    ragService: deps.ragService,
    closeChecklist,
    config,
    clock,
    roles,
    indicator,
    page,
  });
  effectsHolder.current = orchestrator.timerEffects;

  if (options?.runProbes !== false) {
    const nestedAction = await adapter.probeNestedArrayMutationStrategy();
    console.info(`NESTED_PROBE:${nestedAction}`);
    const nestedAudit = await adapter.probeAuditMutationStrategy();
    console.info(`NESTED_PROBE:audit:${nestedAudit}`);
  }

  return {
    roles,
    tools,
    scheduler,
    reviewer,
    totAnalyzer,
    draftService,
    orchestrator,
    indicator,
    modelClient,
    closeChecklist,
  };
}
