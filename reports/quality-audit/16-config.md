# Slice 16 config — Quality Audit

Audited files (line counts), date 2026-11-05:

- `packages/config/src/env-matrix.ts` — 20 lines
- `packages/config/src/env-schema.ts` — 69 lines
- `packages/config/src/index.ts` — 730 lines
- `packages/config/src/stack-def.ts` — 81 lines
- `packages/config/src/zod-microenv.ts` — 5 lines

## R1

- `packages/config/src/index.ts:124` — `if (cohere !== undefined && cohere !== "") out.cohereApiKey = cohere;` — no `else` branch; the absent/empty state leaves the optional field unset implicitly with no explicit handling comment or branch (missing `else` where state is left implicit).
- `packages/config/src/index.ts:126` — `if (base !== undefined && base !== "") out.baseURL = base;` — no `else` branch; absent/empty `OPENAI_BASE_URL` leaves `baseURL` unset implicitly (missing `else` where state is left implicit).
- `packages/config/src/index.ts:271` — `throw new Error();` — branch raises a generic unnamed `Error` as a control-flow sentinel instead of a dedicated error; the real diagnostic is manufactured later in `catch` (violates "raise a dedicated error").
- `packages/config/src/index.ts:504` — `throw new Error();` — generic unnamed `Error` used only to trigger the surrounding `catch` that throws the dedicated `ConfigError` (violates "raise a dedicated error").
- `packages/config/src/index.ts:523` — `throw new Error();` — generic sentinel error instead of a dedicated error at the point of failure (violates "raise a dedicated error").
- `packages/config/src/index.ts:526` — `throw new Error();` — generic sentinel error instead of a dedicated error at the point of failure (violates "raise a dedicated error").
- `packages/config/src/index.ts:545` — `throw new Error();` — generic sentinel error instead of a dedicated error at the point of failure (violates "raise a dedicated error").
- `packages/config/src/index.ts:548` — `throw new Error();` — generic sentinel error instead of a dedicated error at the point of failure (violates "raise a dedicated error").
- `packages/config/src/stack-def.ts:61` — `if (includePresidio) {` — no `else` branch; the `false` state (builder without presidio service, `envTemplates` without `PRESIDIO_URL`) is left implicit with no explicit branch managing the exclusion.

## R2

- `packages/config/src/env-schema.ts:8` — `z.boolean().default(defaultValue)` — `.default()` silently substitutes an absent value instead of fail-fast with a named error.
- `packages/config/src/env-schema.ts:21` — `MODEL_LOGPROBS: booleanSchema(false)` — silent default `false` hiding absent state.
- `packages/config/src/env-schema.ts:28` — `PIMS_TIMEOUT_MS: z.coerce.number().default(15000)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:29` — `PIMS_MAX_RETRIES: z.coerce.number().default(3)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:30` — `PIMS_PAGE_SIZE: z.string().default("50/100")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:31` — `IDEMPOTENCY_KEY_PREFIX: z.string().default("pims_idemp_")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:34` — `AUTO_NOTIFY: booleanSchema(false)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:35` — `PHASE_DUE_HOURS: z.coerce.number().default(24)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:36` — `REVIEW_CHALLENGE_BLOCKING: booleanSchema(true)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:37` — `WATCHER_POLL_INTERVAL_MS: z.coerce.number().default(5000)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:40` — `EVIDENCE_HASH: z.literal("sha256").default("sha256")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:41` — `EVIDENCE_KEY_ENV: z.string().default("EVIDENCE_KEY")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:44` — `WEBHOOK_INGEST_SECRET_ENV: z.string().default("WEBHOOK_INGEST_SECRET")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:46` — `LOG_PII: z.literal("false").default("false")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:49` — `DEPLOY_PORT: z.coerce.number().default(3000)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:50` — `DEPLOY_DATA_DIR: z.string().default(".evidence_blobs")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:52` — `RAG_CORPUS_DIR: z.string().default("corpus")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:53` — `RAG_TOP_K: z.coerce.number().default(8)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:54` — `RAG_RERANK_K: z.coerce.number().default(4)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:55` — `RAG_MIN_SCORE: z.coerce.number().default(0.35)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:56` — `RAG_TIMEOUT_MS: z.coerce.number().default(3000)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:60` — `PRESIDIO_URL: z.string().url().default("http://127.0.0.1:3001")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:61` — `PRESIDIO_IMAGE: z.string().default("presidio-analyzer:2.2.x-es")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:62` — `PRESIDIO_MODEL: z.string().default("es_core_news_md")` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:63` — `PRESIDIO_TIMEOUT_MS: z.coerce.number().default(1500)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:64` — `PRESIDIO_MIN_SCORE: z.coerce.number().default(0.5)` — silent default hiding absent state.
- `packages/config/src/env-schema.ts:65` — `FORM_NARRATIVE_MAX_CHARS: z.coerce.number().default(4000)` — silent default hiding absent state.
- `packages/config/src/index.ts:227` — `const env = envOverride ?? process.env;` — `??` fallback chain between two env sources instead of one explicit source or a named error.
- `packages/config/src/index.ts:239` — `const pimsBaseUrl = env.PIMS_BASE_URL ?? DEFAULT_PIMS_BASE_URL;` — `?? default` hiding absent state instead of fail-fast.
- `packages/config/src/index.ts:249` — `const pimsSchema = env.PIMS_SCHEMA ?? DEFAULT_PIMS_SCHEMA;` — `?? default` hiding absent state instead of fail-fast.
- `packages/config/src/index.ts:265-266` — `env.JURISDICTION_DEADLINES_JSON ?? '{"EU_GDPR":...}'` — `??` with an inline JSON literal default hiding absent state instead of fail-fast.
- `packages/config/src/index.ts:312-315` — `env.VISION_MODEL === undefined ? undefined : parseModelConfig(...)` — ternary silent default (`undefined`) hiding absent state for an optional model instead of an explicit named outcome.
- `packages/config/src/index.ts:327` — `const evidenceKeyEnv = env.EVIDENCE_KEY_ENV ?? "EVIDENCE_KEY";` — `?? default` hiding absent state (duplicates the `env-schema.ts:41` default).
- `packages/config/src/index.ts:362-365` — `modelLogprobsRaw === undefined ? DEFAULT_MODEL_LOGPROBS : modelLogprobsRaw === "true";` — ternary default hiding absent state.
- `packages/config/src/index.ts:367-369` — `env.PHASE_DUE_HOURS ? Number.parseInt(...) : DEFAULT_PHASE_DUE_HOURS;` — ternary/`||`-style default hiding absent state.
- `packages/config/src/index.ts:388-391` — `reviewChallengeBlockingRaw === undefined ? DEFAULT_REVIEW_CHALLENGE_BLOCKING : ...` — ternary default hiding absent state.
- `packages/config/src/index.ts:404-407` — `autoNotifyRaw === undefined ? DEFAULT_AUTO_NOTIFY : autoNotifyRaw === "true";` — ternary default hiding absent state.
- `packages/config/src/index.ts:409-410` — `let watcherPollIntervalMs = DEFAULT_WATCHER_POLL_INTERVAL_MS;` + `if (watcherPollRaw !== undefined)` — pre-seeded silent default hiding absent state.
- `packages/config/src/index.ts:422-426` — `ragCorpusDirRaw === undefined || ragCorpusDirRaw === "" ? DEFAULT_CORPUS_DIR : ragCorpusDirRaw;` — `||`-style default hiding absent/empty state.
- `packages/config/src/index.ts:428` — `const subjectNoticePolicy = env.SUBJECT_NOTICE_POLICY ?? "high_risk_only";` — `?? default` hiding absent state.
- `packages/config/src/index.ts:436-438` — `env.ATTACHMENT_MAX_MB ? Number.parseInt(...) : MAX_ATTACHMENT_SIZE_MB;` — ternary default hiding absent state.
- `packages/config/src/index.ts:452` — `const evidenceHash = env.EVIDENCE_HASH ?? "sha256";` — `?? default` hiding absent state (duplicates the `env-schema.ts:40` default).
- `packages/config/src/index.ts:460-462` — `env.PIMS_TIMEOUT_MS ? Number.parseInt(...) : DEFAULT_PIMS_TIMEOUT_MS;` — ternary default hiding absent state.
- `packages/config/src/index.ts:470-472` — `env.PIMS_MAX_RETRIES ? Number.parseInt(...) : DEFAULT_PIMS_MAX_RETRIES;` — ternary default hiding absent state.
- `packages/config/src/index.ts:558` — `const presidioUrl = env.PRESIDIO_URL ?? "http://127.0.0.1:3001";` — `?? default` hiding absent state (duplicates the `env-schema.ts:60` default).
- `packages/config/src/index.ts:568` — `const presidioImage = env.PRESIDIO_IMAGE ?? "presidio-analyzer:2.2.x-es";` — `?? default` hiding absent state (duplicates the `env-schema.ts:61` default).
- `packages/config/src/index.ts:569` — `const presidioModel = env.PRESIDIO_MODEL ?? "es_core_news_md";` — `?? default` hiding absent state (duplicates the `env-schema.ts:62` default).
- `packages/config/src/index.ts:571-572` — `let presidioTimeoutMs = 1500;` + `if (presidioTimeoutRaw !== undefined)` — pre-seeded silent default hiding absent state (duplicates the `env-schema.ts:63` default).
- `packages/config/src/index.ts:584-585` — `let presidioMinScore = 0.5;` + `if (presidioMinScoreRaw !== undefined)` — pre-seeded silent default hiding absent state (duplicates the `env-schema.ts:64` default).
- `packages/config/src/index.ts:597-598` — `let formNarrativeMaxChars = 4000;` + `if (formNarrativeMaxCharsRaw !== undefined)` — pre-seeded silent default hiding absent state (duplicates the `env-schema.ts:65` default).
- `packages/config/src/index.ts:620-621` — `env.IDEMPOTENCY_KEY_PREFIX ?? DEFAULT_IDEMPOTENCY_KEY_PREFIX` — `?? default` hiding absent state.
- `packages/config/src/index.ts:623` — `SUBJECT_NOTICE_POLICY: "high_risk_only",` — hardcoded literal silently pinned instead of deriving from the validated `subjectNoticePolicy` or failing fast.
- `packages/config/src/index.ts:624-626` — `env.HUMAN_VETO_WINDOW_MIN ? Number.parseInt(...) : 0` — ternary default hiding absent state.
- `packages/config/src/index.ts:633-635` — `env.TEMP_CLASSIFIER ? Number.parseFloat(...) : 0.0` — ternary default hiding absent state.
- `packages/config/src/index.ts:636-638` — `env.TEMP_REASONING ? Number.parseFloat(...) : 0.2` — ternary default hiding absent state.
- `packages/config/src/index.ts:639-641` — `env.MAX_REVIEW_CYCLES ? Number.parseInt(...) : 3` — ternary default hiding absent state.
- `packages/config/src/index.ts:642-644` — `env.PLAIN_LANG_MAX_WORDS ? Number.parseInt(...) : 25` — ternary default hiding absent state.
- `packages/config/src/index.ts:645-647` — `env.DEDUPE_TRIGRAM_THRESHOLD ? Number.parseFloat(...) : 0.85` — ternary default hiding absent state.
- `packages/config/src/index.ts:648-650` — `env.DEDUPE_COSINE_THRESHOLD ? Number.parseFloat(...) : 0.9` — ternary default hiding absent state.
- `packages/config/src/index.ts:651-653` — `env.SLA_PROCESSOR_H ? Number.parseInt(...) : 1` — ternary default hiding absent state.
- `packages/config/src/index.ts:654-656` — `env.SLA_SUBJECT_H ? Number.parseInt(...) : 4` — ternary default hiding absent state.
- `packages/config/src/index.ts:657` — `env.SLA_REVIEW_H ? Number.parseInt(...) : 4` — ternary default hiding absent state.
- `packages/config/src/index.ts:658-660` — `env.CORRECTIVE_DEFAULT_DUE_DAYS ? Number.parseInt(...) : 30` — ternary default hiding absent state.
- `packages/config/src/index.ts:661-663` — `env.CIRCUIT_BREAKER_FAILS ? Number.parseInt(...) : 5` — ternary default hiding absent state.
- `packages/config/src/index.ts:664-666` — `env.CIRCUIT_BREAKER_WINDOW_S ? Number.parseInt(...) : 60` — ternary default hiding absent state.
- `packages/config/src/index.ts:667-669` — `env.CIRCUIT_BREAKER_OPEN_S ? Number.parseInt(...) : 300` — ternary default hiding absent state.
- `packages/config/src/index.ts:670-672` — `env.RAG_CORPUS_PATHS ? JSON.parse(env.RAG_CORPUS_PATHS) : {}` — ternary default hiding absent state (and the present branch parses JSON with no schema validation or named error).
- `packages/config/src/index.ts:676` — `env.RAG_TOP_K ? Number.parseInt(...) : 8` — ternary default hiding absent state (duplicates the `env-schema.ts:53` default).
- `packages/config/src/index.ts:677` — `env.RAG_RERANK_K ? Number.parseInt(...) : 4` — ternary default hiding absent state (duplicates the `env-schema.ts:54` default).
- `packages/config/src/index.ts:678-680` — `env.RAG_MIN_SCORE ? Number.parseFloat(...) : 0.35` — ternary default hiding absent state (duplicates the `env-schema.ts:55` default).
- `packages/config/src/index.ts:681-683` — `env.RAG_TIMEOUT_MS ? Number.parseInt(...) : 3000` — ternary default hiding absent state (duplicates the `env-schema.ts:56` default).
- `packages/config/src/index.ts:684-686` — `env.SCHEDULER_TICK_S ? Number.parseInt(...) : 60` — ternary default hiding absent state.
- `packages/config/src/index.ts:687-689` — `env.SCHEDULER_JITTER_S ? Number.parseInt(...) : 10` — ternary default hiding absent state.
- `packages/config/src/index.ts:690-692` — `env.SCHEDULER_MAX_TIMERS ? Number.parseInt(...) : 10000` — ternary default hiding absent state.
- `packages/config/src/index.ts:693` — `EVIDENCE_HASH: "sha256",` — hardcoded literal silently pinned, ignoring any caller-supplied value with no named error.
- `packages/config/src/index.ts:701-702` — `env.WEBHOOK_INGEST_SECRET_ENV ?? "WEBHOOK_INGEST_SECRET"` — `?? default` hiding absent state (duplicates the `env-schema.ts:44` default).
- `packages/config/src/index.ts:704-706` — `env.RETENTION_NOTICE_YEARS ? Number.parseInt(...) : 6` — ternary default hiding absent state.
- `packages/config/src/index.ts:709-711` — `env.INDICATOR_SPOOL_MAX ? Number.parseInt(...) : 10000` — ternary default hiding absent state.
- `packages/config/src/index.ts:712` — `LOG_PII: false,` — hardcoded literal silently pinned, ignoring caller input with no named error (inconsistent with the strict fail-fast guard at lines 229-237, which rejects `"true"` but any other truthy/garbage value falls through to this silent `false`).
- `packages/config/src/index.ts:713` — `env.LEASE_TTL_S ? Number.parseInt(...) : 300` — ternary default hiding absent state.
- `packages/config/src/index.ts:714-716` — `env.LEASE_RENEW_S ? Number.parseInt(...) : 60` — ternary default hiding absent state.
- `packages/config/src/index.ts:717` — `env.DEPLOY_PORT ? Number.parseInt(...) : 8080` — ternary default hiding absent state (and `8080` disagrees with the `env-schema.ts:49` default of `3000` for the same key).
- `packages/config/src/index.ts:718` — `env.DEPLOY_DATA_DIR ?? "/app/data"` — `?? default` hiding absent state (and `"/app/data"` disagrees with the `env-schema.ts:50` default of `".evidence_blobs"` for the same key).
- `packages/config/src/stack-def.ts:18` — `const projectRoot = options?.projectRoot ?? process.cwd();` — `??` fallback silently substituting ambient `process.cwd()` instead of requiring an explicit root or raising a named error.
- `packages/config/src/stack-def.ts:19` — `const defaultRange = options?.defaultRange ?? DEFAULT_STACK_PORT_RANGE;` — `?? default` hiding absent state instead of fail-fast.
- `packages/config/src/stack-def.ts:20` — `const includePresidio = options?.includePresidio ?? true;` — `?? default` hiding absent state instead of fail-fast.

## R3

No violations found.

## R4

Within-slice repeats (same operational literal hardcoded 2+ times inside this slice; per the rule these must live in a shared constant/config):

- `"true"` / `"false"` string literals — `env-schema.ts:7` (`=== "true"`) and `index.ts:231,353,354,357,365,380,381,391,396,397,407` (comparisons/assignments). Same operational literals repeated across 2 files in this slice.
- `"presidio-analyzer:2.2.x-es"` — `env-schema.ts:61`, `stack-def.ts:63`, `index.ts:568`.
- `"es_core_news_md"` — `env-schema.ts:62`, `index.ts:569`.
- `"http://127.0.0.1:3001"` — `env-schema.ts:60`, `index.ts:558`.
- `1500` (presidio timeout ms) — `env-schema.ts:63`, `index.ts:572`.
- `0.5` (presidio min score) — `env-schema.ts:64`, `index.ts:585`.
- `4000` (form narrative max chars) — `env-schema.ts:65`, `index.ts:598`.
- `8` / `4` / `0.35` (RAG top-k / rerank-k / min-score) — `env-schema.ts:53,54,55`, `index.ts:676,677,678`.
- `3000` — `env-schema.ts:49` (DEPLOY_PORT), `env-schema.ts:56` (RAG_TIMEOUT_MS), `stack-def.ts:64` (container port), `stack-def.ts:68` (`Wait.forHttp("/health", 3000)`), `index.ts:683` (RAG_TIMEOUT_MS). Mixed semantics (port vs milliseconds); the timeout uses must be one shared constant.
- `"sha256"` — `env-schema.ts:40`, `index.ts:452`, `index.ts:693`.
- `"EVIDENCE_KEY"` — `env-schema.ts:41`, `index.ts:327`.
- `"WEBHOOK_INGEST_SECRET"` — `env-schema.ts:44`, `index.ts:702`.
- `"high_risk_only"` — `index.ts:428`, `index.ts:431`, `index.ts:623` (3× within one file; must be a shared constant).
- `"fallback:none"` — `index.ts:139` (error message), `index.ts:160`, `index.ts:162` (comparisons). Message text aside, the two operational comparisons at 160/162 repeat the literal.
- `"50/100"` / `{ default: 50, max: 100 }` — `env-schema.ts:30`, `index.ts:480`, `index.ts:493` (message example). The schema default and the loader default encode the same pair independently.
- `10000` — `index.ts:692` (SCHEDULER_MAX_TIMERS), `index.ts:711` (INDICATOR_SPOOL_MAX). Same magic number for two different settings; each must be a named constant.
- `60` — `index.ts:666` (CIRCUIT_BREAKER_WINDOW_S), `index.ts:686` (SCHEDULER_TICK_S), `index.ts:716` (LEASE_RENEW_S). Same magic number across settings; each must be a named constant.
- `4` — `index.ts:656` (SLA_SUBJECT_H), `index.ts:657` (SLA_REVIEW_H), `index.ts:677` (RAG_RERANK_K). Same magic number across settings; each must be a named constant.
- `"pims"` / `"pims_evidence"` — `stack-def.ts:28,29,30,37` (POSTGRES_USER/PASSWORD/DB + healthcheck command string). Repeated credential/db literals within one file; must be shared constants.
- `5432` — `stack-def.ts:26` (container port), `stack-def.ts:58` (URL template `...:5432}}...`). Same port in two places; must be a shared constant.

Cross-file-literal candidates for global synthesis (literal value + file:line each; the other file may be outside this slice):

- `"presidio-analyzer:2.2.x-es"` — `packages/config/src/env-schema.ts:61`, `packages/config/src/stack-def.ts:63`, `packages/config/src/index.ts:568`.
- `"es_core_news_md"` — `packages/config/src/env-schema.ts:62`, `packages/config/src/index.ts:569`.
- `"http://127.0.0.1:3001"` — `packages/config/src/env-schema.ts:60`, `packages/config/src/index.ts:558`.
- `"sha256"` — `packages/config/src/env-schema.ts:40`, `packages/config/src/index.ts:452`, `packages/config/src/index.ts:693`.
- `"EVIDENCE_KEY"` — `packages/config/src/env-schema.ts:41`, `packages/config/src/index.ts:327`.
- `"WEBHOOK_INGEST_SECRET"` — `packages/config/src/env-schema.ts:44`, `packages/config/src/index.ts:702`.
- `"high_risk_only"` — `packages/config/src/index.ts:428`, `packages/config/src/index.ts:431`, `packages/config/src/index.ts:623` (possible further occurrences outside this slice, e.g. policy/type definitions).
- `"true"` / `"false"` env-string literals — `packages/config/src/env-schema.ts:7`, `packages/config/src/index.ts:231,353,354,357,365,380,381,391,396,397,407` (possible further occurrences outside this slice wherever env booleans are parsed).
- `1500` — `packages/config/src/env-schema.ts:63`, `packages/config/src/index.ts:572`.
- `0.5` — `packages/config/src/env-schema.ts:64`, `packages/config/src/index.ts:585`.
- `4000` — `packages/config/src/env-schema.ts:65`, `packages/config/src/index.ts:598`.
- `3000` — `packages/config/src/env-schema.ts:49`, `packages/config/src/env-schema.ts:56`, `packages/config/src/stack-def.ts:64`, `packages/config/src/stack-def.ts:68`, `packages/config/src/index.ts:683`.
- `5432` — `packages/config/src/stack-def.ts:26`, `packages/config/src/stack-def.ts:58`.
- `"pims_evidence"` — `packages/config/src/stack-def.ts:30`, `packages/config/src/stack-def.ts:37`, `packages/config/src/stack-def.ts:58`.
- `"50/100"` + `50`/`100` — `packages/config/src/env-schema.ts:30`, `packages/config/src/index.ts:480`.
- `DEFAULT_*` constants imported in `packages/config/src/index.ts:1-14` from `@pims/types/constants.ts` are the compliant pattern (single shared source); the violations above are the literals that bypass it.

## R5

- `packages/config/src/index.ts:718` — `DEPLOY_DATA_DIR: env.DEPLOY_DATA_DIR ?? "/app/data"` — hardcoded absolute path `/app/data`; not project-root-relative, fails on any machine/layout without `/app`.
- `packages/config/src/stack-def.ts:46` — `target: "/docker-entrypoint-initdb.d/01-gestitel.sql"` — hardcoded absolute path (container-internal initdb path; still a hardcoded absolute path under a strict reading — flagged for adjudication, likely acceptable as container-image contract).
- `packages/config/src/stack-def.ts:50` — `target: "/docker-entrypoint-initdb.d/02-seed.sql"` — hardcoded absolute path (same container-internal note as line 46).

## R6

- `packages/config/src/env-schema.ts:4-9` — hand-rolled `booleanSchema` via `z.preprocess((v) => typeof v === "string" ? ... : Boolean(v), ...)` — custom coercion where the ecosystem provides `z.coerce.boolean()` (zod); the manual `Boolean(v)` fallback also coerces arbitrary truthy values instead of strict parsing.
- `packages/config/src/index.ts:136` — hand-rolled CSV parse `raw.split(",").map((s) => s.trim())` in `parseModelConfig` — custom parsing where zod provides `z.string().transform(...)` / preprocess pipelines; the hand-rolled splitter has no quoting/escaping and duplicates the object-branch validation below.
- `packages/config/src/index.ts:152-153` — hand-rolled `Number.parseInt(timeoutStr ?? "", 10)` + `Number.isNaN` number validation repeated per field — custom numeric coercion where zod provides `z.coerce.number().int()` with named issues.
- `packages/config/src/index.ts:240-247` — hand-rolled URL validation via `try { new URL(pimsBaseUrl); } catch` — custom validation where zod provides `z.string().url()` (already used in `env-schema.ts`); the same hand-rolled block is copy-pasted 3× (also lines 342-349 for `EVIDENCE_DB_URL`, 559-566 for `PRESIDIO_URL`).
- `packages/config/src/index.ts:351-365` — hand-rolled `"true"`/`"false"` string-enum boolean parsing for `MODEL_LOGPROBS` — custom parser where zod provides `z.enum(["true","false"])` + transform or `z.coerce.boolean()`; copy-pasted 3× (also lines 377-391 `REVIEW_CHALLENGE_BLOCKING`, 393-407 `AUTO_NOTIFY`).
- `packages/config/src/index.ts:367-375` — hand-rolled `Number.parseInt` + `Number.isInteger` positive-int parsing for `PHASE_DUE_HOURS` — custom numeric validation where zod provides `z.coerce.number().int().positive()`; the same hand-rolled shape repeats for every numeric env var in the file (~20 sites).
- `packages/config/src/index.ts:482-484` — hand-rolled `env.PIMS_PAGE_SIZE.split("/").map((s) => Number.parseInt(s.trim(), 10))` pair parser — custom format parsing where zod provides `z.string().regex(...).transform(...)` or `z.custom` with a single validated transform.
- `packages/config/src/index.ts:501-512` — hand-rolled `JSON.parse` + `Array.isArray` check for `ASSIGNEES` — custom JSON validation where zod provides `z.string().transform(JSON.parse).pipe(z.array(z.string()))` / `z.json()` with `safeParse` and named issues.
- `packages/config/src/index.ts:514-534` — hand-rolled `JSON.parse` + shape checks for `PIMS_EXTRA_HEADERS_JSON` — custom object validation where zod provides `z.record(z.string(), z.string())` via a JSON-string pipeline (same for `PIMS_COOKIES_JSON` at lines 536-556).
- `packages/config/src/index.ts:670-672` — bare `JSON.parse(env.RAG_CORPUS_PATHS)` with no schema validation at all — unvalidated parse where zod provides `z.record(z.string(), z.string()).parse()`; a malformed-but-JSON value propagates unchecked.
- `packages/config/src/zod-microenv.ts:1-4` — hand-rolled CJS module loading via `createRequire(import.meta.resolve(...))` to re-export zod — custom loader indirection where the native solution is a static `import { z } from "zod"` (or a direct re-export from the dependency); stringly-typed `req("zod")` is untyped and bypasses the module graph. (Possible justification: zod instance dedupe with the bundled microenv copy — needs orchestrator adjudication.)

## Summary

| Rule | Count |
| ---- | ----- |
| R1 Exhaustive Branching & Explicit State Handling | 9 |
| R2 Zero Fallbacks & Deterministic Control Flow | 91 |
| R3 No Unrequested Legacy Support | 0 |
| R4 No Repeated Cross-File Literals | 19 within-slice groups / 15 cross-file candidates |
| R5 Strict Path Discipline | 3 |
| R6 Prioritize Native & Ecosystem Solutions | 11 |
| Total | 133 (+15 cross-file candidates for synthesis) |

Notes for synthesis: the dominant R2 cluster is the systematic duplication between `env-schema.ts` defaults (27 `.default()` sites) and `index.ts:loadConfig` re-defaulting the same keys with the same values (presidio.*, RAG_*, EVIDENCE_*, WEBHOOK_*, DEPLOY_*) — two parallel default sources for identical keys, which additionally disagree on `DEPLOY_PORT` (3000 vs 8080) and `DEPLOY_DATA_DIR` (`.evidence_blobs` vs `/app/data`). `index.ts:712` (`LOG_PII: false` hardcoded in the return object) silently pins the value for any input that passes the lines 229-237 guard (e.g. `"0"`, `"no"`, garbage), contradicting the guard's fail-fast intent. R4's highest-value fix is unifying the presidio/RAG/evidence literal set (`env-schema.ts` ↔ `index.ts` ↔ `stack-def.ts`) into the existing `@pims/types/constants.ts` pattern already imported at `index.ts:1-14`.
