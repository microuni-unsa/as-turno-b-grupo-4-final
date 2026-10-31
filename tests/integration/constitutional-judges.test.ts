import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentModelClient,
  ConstitutionalReviewer,
  JUDGE_NLI_SYSTEM,
  PROSECUTOR_SYSTEM,
} from "@pims/agent";
import type { AgentConfig } from "@pims/config";
import { EvidenceStore } from "@pims/evidence";
import { OpenAIModelProvider } from "@pims/models";
import { NormativeKnowledgeGraph, RAGService, RagIndexer } from "@pims/rag";
import type {
  CitationEntailment,
  CloseChecklistItem,
  ProsecutorChallenge,
  ReviewContext,
} from "@pims/types/agent.ts";
import {
  CLOSE_CHECKLIST_ITEMS,
  ReviewContextSchema,
} from "@pims/types/agent.ts";
import {
  ReviewApprovalInvalidError,
  ReviewApprovalReusedError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import { PimsIncidentSchema } from "@pims/types/pims.ts";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { generateDeterministicEmbedding } from "@tests/helpers/span-geometry.ts";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const CITATION = "gdpr-full:art34:1-10";

const PASS_BODY =
  "Le informamos sobre un incidente de seguridad. " +
  "Sus datos personales pueden haberse visto afectados. " +
  "Hemos adoptado medidas para reducir el riesgo.";

const LONG_SENTENCE_BODY =
  "Este aviso explica con mucho detalle lo que ocurrió durante el " +
  "incidente de seguridad que afectó a los sistemas internos de la " +
  "organización y describe también todas las medidas que hemos adoptado " +
  "para proteger sus datos personales y evitar que vuelva a ocurrir en " +
  "el futuro.";

const NUMERIC_BODY = "El incidente afectó a 500 personas.";

const PII_BODY = "Escriba a dpo@example.test para más información.";

const KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function incidentFixture(incidentCode: string) {
  return PimsIncidentSchema.parse({
    id: 1,
    incident_code: incidentCode,
    created_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
    is_deleted: false,
    involves_personal_data: true,
    incident_date: "2026-10-01",
    detection_date: "2026-10-01",
    detection_time: "10:00:00",
    incident_type: "DL",
    status: "P",
    severity: "H",
    impact: "H",
    title: "Acceso no autorizado al portal",
    description: "Acceso indebido a datos de admisión.",
    dpo_contact_name: "Ana Torres",
    dpo_contact_email: "ana.torres@example.test",
    affected_data_types: ["id_doc", "email"],
    security_measures_adopted: [],
    affected_cid: ["C"],
  });
}

function buildContext(overrides: {
  incident_code: string;
  pack_type: "authority" | "subject" | "resolution";
  body_text?: string;
  citations?: string[];
  semantic_entropy?: number | null;
  checklist?: CloseChecklistItem[] | null;
  content_sha256?: string;
}): ReviewContext {
  return ReviewContextSchema.parse({
    incident_code: overrides.incident_code,
    pack_type: overrides.pack_type,
    content_sha256: overrides.content_sha256 ?? "a".repeat(64),
    body_text: overrides.body_text ?? PASS_BODY,
    citations: overrides.citations ?? [CITATION],
    semantic_entropy:
      overrides.semantic_entropy === undefined
        ? 0.2
        : overrides.semantic_entropy,
    numeric_approvals: [],
    plain_language_waiver: null,
    checklist: overrides.checklist ?? null,
  });
}

describe("Constitutional review (§6.3 integration)", {
  timeout: 240_000,
}, () => {
  let container: StartedPostgreSqlContainer;
  let sql: postgres.Sql;
  let store: EvidenceStore;
  let reviewer: ConstitutionalReviewer;
  let storageDir: string;

  let prosecutorChallenges: ProsecutorChallenge[] = [];
  let nliEntailment: CitationEntailment[] = [];

  const clock = (): Date => new Date("2026-10-31T00:00:00.000Z");

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    sql = postgres(container.getConnectionUri());
    storageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "constitutional-judges-"),
    );

    store = new EvidenceStore({
      connectionUri: container.getConnectionUri(),
      keyHex: KEY_HEX,
      baseStorageDir: storageDir,
    });
    await store.init();

    const modelConfig = {
      provider: "openai",
      model: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      auth_env: "OPENAI_API_KEY",
      timeout_ms: 20000,
      max_retries: 3,
      fallback: "none" as const,
    };

    const provider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: "gpt-4o-mini" },
      visionConfig: modelConfig,
      embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
      rerankerConfig: { ...modelConfig, model: "gpt-4o-mini" },
      apiKey: "constitutional-judges-test-key",
      baseURL: "https://api.openai.com/v1",
    });

    vi.spyOn(provider, "embed").mockImplementation(async ({ texts }) => ({
      vectors: texts.map((text) => generateDeterministicEmbedding(text)),
    }));

    vi.spyOn(provider, "chat_json").mockImplementation(async (args) => {
      if (args.system === PROSECUTOR_SYSTEM) {
        const content: JsonObject = { challenges: prosecutorChallenges };
        return { content, citations_requested: false };
      }
      if (args.system === JUDGE_NLI_SYSTEM) {
        const content: JsonObject = { entailment: nliEntailment };
        return { content, citations_requested: false };
      }
      throw new Error(`Unexpected system prompt routed to chat_json`);
    });

    const indexer = new RagIndexer({ modelProvider: provider, pgClient: sql });
    await indexer.indexCorpus(
      [
        {
          chunk_id: "art34",
          doc_id: "gdpr-full",
          article_or_clause: "art34",
          lines: "1-10",
          normative: true,
          header: "Article 34 Communication to the data subject",
          token_count: 42,
          text:
            "When a personal data breach is likely to result in a high risk " +
            "to the rights and freedoms of natural persons, the controller " +
            "shall communicate the personal data breach to the data subject " +
            "without undue delay in clear and plain language.",
        },
      ],
      "test-corpus-v1",
    );

    const ragService = new RAGService({
      modelProvider: provider,
      indexer,
      knowledgeGraph: new NormativeKnowledgeGraph(),
      config: {
        RAG_TOP_K: 8,
        RAG_RERANK_K: 6,
        RAG_MIN_SCORE: 0.35,
        RAG_TIMEOUT_MS: 30000,
      } as unknown as AgentConfig,
    });

    const config = {
      TEMP_REASONING: 0.2,
      NLI_ENTAILMENT_MIN: 0.85,
      PLAIN_LANG_MAX_WORDS: 25,
      MAX_SEMANTIC_ENTROPY: 0.65,
      MAX_REVIEW_CYCLES: 3,
    } as unknown as AgentConfig;

    reviewer = new ConstitutionalReviewer({
      modelClient: new AgentModelClient(provider),
      ragService,
      evidenceStore: store,
      config,
      clock,
    });
  });

  afterAll(async () => {
    if (store) {
      await store.close();
    }
    await sql.end();
    await container.stop();
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  function route(
    challenges: ProsecutorChallenge[],
    entailment: CitationEntailment[],
  ): void {
    prosecutorChallenges = challenges;
    nliEntailment = entailment;
  }

  function passingNli(citation: string): CitationEntailment[] {
    return [{ citation, score: 0.95, entailed: true, unsupported_claims: [] }];
  }

  async function seedAuthorityPack(
    incidentCode: string,
    contentSha256: string,
  ): Promise<void> {
    await store.saveDraftPack(
      incidentCode,
      "authority",
      { pack_type: "authority", marker: incidentCode },
      contentSha256,
      null,
      "draft",
    );
  }

  it("approves when every judge passes and mints a single-use approval", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-01";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(true);
    expect(result.rejection).toBeNull();
    expect(result.judges).toHaveLength(4);
    expect(result.judges.every((judge) => judge.passed)).toBe(true);
    expect(result.approval_id).not.toBeNull();
    const approvalId = result.approval_id;
    if (approvalId === null) {
      throw new Error("expected an approval id");
    }

    const approval = await store.getReviewApproval(approvalId);
    expect(approval).not.toBeNull();
    expect(approval?.consumed_at_utc).toBeNull();
    expect(approval?.pack_type).toBe("authority");
    expect(approval?.content_sha256).toBe(ctx.content_sha256);

    const consumed = await store.consumeReviewApproval(
      approvalId,
      ctx.content_sha256,
      "test",
    );
    expect(consumed.consumed_by).toBe("test");

    await expect(
      store.consumeReviewApproval(approvalId, ctx.content_sha256, "test"),
    ).rejects.toBeInstanceOf(ReviewApprovalReusedError);
  });

  it("rejects when the prosecutor raises a high-severity challenge", async () => {
    route(
      [
        {
          target: "item_c_consequences",
          challenge: "Consequences are asserted without evidence.",
          severity: "high",
          evidence_required: "Risk assessment for the affected processing.",
        },
      ],
      passingNli(CITATION),
    );
    const incidentCode = "INC-CJ-02";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
    });

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.approval_id).toBeNull();
    expect(result.rejection?.judge).toBe("prosecutor");
    expect(result.rejection?.required_fix).toBe(
      "Consequences are asserted without evidence.",
    );
  });

  it("fails judge 1 when an authority body is empty", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-03";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
      body_text: "",
    });

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("legal_completeness");
    expect(result.rejection?.required_fix).toBe("body_text");
  });

  it("fails judge 1 when the resolution checklist omits bundle_sealed", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-04";
    const checklist = CLOSE_CHECKLIST_ITEMS.filter(
      (item) => item !== "bundle_sealed",
    );
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "resolution",
      body_text: PASS_BODY,
      checklist: checklist as CloseChecklistItem[],
    });

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("legal_completeness");
    expect(result.rejection?.required_fix).toBe("bundle_sealed");
  });

  it("fails judge 2 when the NLI score is below the minimum", async () => {
    route(
      [],
      [
        {
          citation: CITATION,
          score: 0.5,
          entailed: true,
          unsupported_claims: [],
        },
      ],
    );
    const incidentCode = "INC-CJ-05";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("citation_nli");
    expect(result.rejection?.required_fix).toBe(CITATION);
  });

  it("fails judge 2 when the NLI response omits a citation", async () => {
    route([], []);
    const incidentCode = "INC-CJ-06";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("citation_nli");
    expect(result.rejection?.required_fix).toBe(CITATION);
  });

  it("fails judge 3 for a sentence longer than the plain-language limit", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-07";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
      body_text: LONG_SENTENCE_BODY,
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("plain_language");
    expect(result.rejection?.required_fix).toBe("PLAIN_LANGUAGE_VIOLATION");
  });

  it("fails judge 3 for an unapproved subject count", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-08";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
      body_text: NUMERIC_BODY,
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("plain_language");
    expect(result.rejection?.required_fix).toBe("SUBJECT_COUNT_FORBIDDEN");
  });

  it("fails judge 4 when the body leaks an email address", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-09";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
      body_text: PII_BODY,
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("pii_semantic_entropy");
    expect(result.rejection?.required_fix).toBe("pii:email");
  });

  it("fails judge 4 closed when semantic entropy is unavailable", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-10";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
      semantic_entropy: null,
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("pii_semantic_entropy");
    expect(result.rejection?.required_fix).toBe("semantic_entropy_missing");
  });

  it("fails judge 4 when semantic entropy exceeds the ceiling", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-11";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
      semantic_entropy: 0.9,
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));

    expect(result.approved).toBe(false);
    expect(result.rejection?.judge).toBe("pii_semantic_entropy");
    expect(result.rejection?.required_fix).toBe("semantic_entropy_high");
  });

  it("rejects consumption of an approval with a mismatched content hash", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-12";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "authority",
    });
    await seedAuthorityPack(incidentCode, ctx.content_sha256);

    const result = await reviewer.review(ctx, incidentFixture(incidentCode));
    expect(result.approved).toBe(true);
    const approvalId = result.approval_id;
    if (approvalId === null) {
      throw new Error("expected an approval id");
    }

    await expect(
      store.consumeReviewApproval(approvalId, "0".repeat(64), "test"),
    ).rejects.toBeInstanceOf(ReviewApprovalInvalidError);
  });

  it("reviewResolution approves a non-empty body without saving a draft pack", async () => {
    route([], passingNli(CITATION));
    const incidentCode = "INC-CJ-13";
    const ctx = buildContext({
      incident_code: incidentCode,
      pack_type: "resolution",
      body_text: PASS_BODY,
      checklist: [...CLOSE_CHECKLIST_ITEMS] as CloseChecklistItem[],
      content_sha256: "b".repeat(64),
    });

    const result = await reviewer.reviewResolution(
      ctx,
      incidentFixture(incidentCode),
    );

    expect(result.approved).toBe(true);
    expect(result.rejection).toBeNull();
    expect(result.judges).toHaveLength(4);
    expect(result.judges.map((judge) => judge.judge)).toEqual([
      "legal_completeness",
      "citation_nli",
      "plain_language",
      "pii_semantic_entropy",
    ]);
    expect(result.approval_id).not.toBeNull();
    expect(await store.getDraftPack(incidentCode, "authority")).toBeNull();
  });
});
