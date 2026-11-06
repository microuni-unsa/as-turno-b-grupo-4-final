import {
  AgentEventEmitter,
  createAgent,
  IncidentWatcherDaemon,
} from "@pims/agent";
import { createCockpitApp } from "@pims/cockpit/app.ts";
import { SessionRegistry } from "@pims/cockpit/auth.ts";
import { REGULATORY_TIMER_TYPES } from "@pims/cockpit/chat-tools.ts";
import { CockpitEventHub } from "@pims/cockpit/event-hub.ts";
import { loadConfig } from "@pims/config";
import { EvidenceStore } from "@pims/evidence";
import { OpenAIModelProvider } from "@pims/models";
import { PimsAdapter } from "@pims/pims-adapter";
import { CorpusLoader, RAGService, RagIndexer } from "@pims/rag";
import { TimerKindSchema } from "@pims/types/agent.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import { ConfigError } from "@pims/types/errors.ts";

const TIMER_TICK_INTERVAL_MS = CONSTANTS.MS_PER_SECOND;
const SHUTDOWN_DRAIN_MS = 30 * CONSTANTS.MS_PER_SECOND;

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== "production" &&
    (process.env.PIMS_PASSWORD === undefined ||
      process.env.OPENAI_API_KEY === undefined)
  ) {
    const { initAppEnv } = await import("@pims/config");
    await initAppEnv("dev");
  }

  const config = loadConfig();
  const keyHex = process.env[config.EVIDENCE_KEY_ENV];
  if (keyHex === undefined || keyHex.trim() === "") {
    throw new ConfigError(
      `EVIDENCE_KEY_ENV (${config.EVIDENCE_KEY_ENV}) is missing or empty`,
      `CONFIG_MISSING:${config.EVIDENCE_KEY_ENV}`,
    );
  }

  const events = new AgentEventEmitter();
  const hub = new CockpitEventHub(events);

  const adapter = new PimsAdapter({
    baseUrl: config.PIMS_BASE_URL,
    schema: config.PIMS_SCHEMA,
    timeoutMs: config.PIMS_TIMEOUT_MS,
    maxRetries: config.PIMS_MAX_RETRIES,
    idempotencyKeyPrefix: config.IDEMPOTENCY_KEY_PREFIX,
    username: config.PIMS_USERNAME,
    password: config.PIMS_PASSWORD,
    extraHeaders:
      typeof config.PIMS_EXTRA_HEADERS_JSON === "string" &&
      config.PIMS_EXTRA_HEADERS_JSON.trim().length > 0
        ? JSON.parse(config.PIMS_EXTRA_HEADERS_JSON)
        : undefined,
    cookies:
      typeof config.PIMS_COOKIES_JSON === "string" &&
      config.PIMS_COOKIES_JSON.trim().length > 0
        ? JSON.parse(config.PIMS_COOKIES_JSON)
        : undefined,
    onMutation: (record) => {
      events.emit({ type: "tool:mutation", ...record });
    },
  });

  const store = new EvidenceStore({
    connectionUri: config.EVIDENCE_DB_URL,
    keyHex,
    baseStorageDir: config.DEPLOY_DATA_DIR,
  });
  await store.init();

  if (config.VISION_MODEL === undefined) {
    throw new ConfigError(
      "VISION_MODEL is required for the cockpit deployment",
      "CONFIG_MISSING:VISION_MODEL",
    );
  }
  const modelProvider = new OpenAIModelProvider({
    reasoningConfig: config.REASONING_MODEL,
    fastConfig: config.FAST_MODEL,
    visionConfig: config.VISION_MODEL,
    embeddingsConfig: config.EMBEDDINGS_MODEL,
    rerankerConfig: config.RERANKER_MODEL,
    requestLogprobs: config.MODEL_LOGPROBS,
  });

  const loader = new CorpusLoader({
    projectRoot: process.cwd(),
    source: { type: "local", dirPath: config.RAG_CORPUS_DIR },
  });
  const corpus = await loader.loadAll();
  const indexer = new RagIndexer({
    modelProvider,
    pgClient: store.sql,
  });
  await indexer.indexCorpus(corpus.chunks, corpus.version);

  const ragService = new RAGService({
    modelProvider,
    indexer,
    config,
    onRetrieval: async (record) => {
      await store.saveRagRetrieval(record);
      events.emit({ type: "rag:retrieval", ...record });
    },
  });

  const agent = await createAgent(
    {
      adapter,
      evidenceStore: store,
      modelProvider,
      ragService,
      config,
      events,
    },
    { runProbes: false },
  );

  const watcher = new IncidentWatcherDaemon({
    adapter,
    orchestrator: agent.orchestrator,
    evidenceStore: store,
    events,
    config,
    page: (alert) => {
      console.error(
        `${CONSTANTS.PAGE_ALERT_PREFIX}${alert.kind}:${alert.incident_code}:${alert.reason}`,
      );
      events.emit({
        type: "agent:error",
        at_utc: new Date().toISOString(),
        incident_code: alert.incident_code,
        code: `PAGE_${alert.kind}`,
        message: alert.reason,
      });
    },
  });

  const sessions = new SessionRegistry();
  const app = createCockpitApp({
    config,
    adapter,
    store,
    agent,
    ragService,
    events,
    sessions,
    hub,
  });

  const server = Bun.serve({
    port: config.DEPLOY_PORT,
    idleTimeout: CONSTANTS.SERVER_IDLE_TIMEOUT_S,
    fetch: app.fetch,
  });

  watcher.start();

  const schedulerTicker = setInterval(() => {
    void agent.orchestrator.tick().catch((error: unknown) => {
      console.error("SCHEDULER_TICK_FAILED", error);
    });
  }, config.SCHEDULER_TICK_S * CONSTANTS.MS_PER_SECOND);

  const ticker = setInterval(() => {
    if (hub.clientCount === 0) {
      return;
    }
    void (async () => {
      // Unfired only: the countdown lists live timers, and the UI pushes
      // unknown timer_ids on tick — emitting fired rows would resurrect
      // 00:00:00 Vencido cards every second.
      const timers = await store.listActiveTimers(undefined, false);
      const now = Date.now();
      for (const timer of timers) {
        // T_RETRY/VETO_WINDOW ticks would re-inject internal rows into the
        // countdown (the UI pushes unknown timer_ids); emit regulatory only.
        if (REGULATORY_TIMER_TYPES[timer.timer_type] !== true) {
          continue;
        }
        const fireAt = new Date(timer.fire_at_utc).getTime();
        events.emit({
          type: "scheduler:timer_tick",
          at_utc: new Date(now).toISOString(),
          incident_code: timer.incident_code,
          timer_id: timer.timer_id,
          timer_kind: TimerKindSchema.parse(timer.timer_type),
          fire_at_utc: timer.fire_at_utc,
          remaining_ms: fireAt - now,
          state: fireAt <= now ? "due" : "armed",
        });
      }
    })().catch((error: unknown) => {
      console.error("TIMER_TICK_FAILED", error);
    });
  }, TIMER_TICK_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`SHUTDOWN:${signal}`);
    watcher.stop();
    clearInterval(schedulerTicker);
    clearInterval(ticker);
    const drain = new Promise<void>((resolve) => {
      setTimeout(resolve, SHUTDOWN_DRAIN_MS);
    });
    await Promise.race([
      (async () => {
        await server.stop();
        hub.close();
        await store.close();
      })(),
      drain,
    ]);
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  console.log(`COCKPIT_LISTENING:${server.port}`);
}

main().catch((error: unknown) => {
  console.error("COCKPIT_STARTUP_FAILED", error);
  process.exit(1);
});
