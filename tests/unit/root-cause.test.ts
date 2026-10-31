import { AgentModelClient, TotAnalyzer } from "@pims/agent";
import type { AgentConfig } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import { NormativeKnowledgeGraph, RAGService, RagIndexer } from "@pims/rag";
import {
  ModelSchemaViolationError,
  RootCauseAmbiguousError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import { PimsIncidentSchema } from "@pims/types/pims.ts";
import type { CorpusChunk } from "@pims/types/rag.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CITATION = "gdpr-full:art33:1-10";

const CHUNKS: CorpusChunk[] = [
  {
    chunk_id: "art33",
    doc_id: "gdpr-full",
    article_or_clause: "art33",
    lines: "1-10",
    text: "The controller shall notify the supervisory authority without undue delay.",
    normative: true,
    header: "[DOC:gdpr-full | CLAUSE:art33 | NORMATIVE:true]",
    token_count: 20,
  },
];

const CONFIG = {
  TOT_BRANCH_FACTOR: 3,
  TEMP_REASONING: 0.2,
  TEMP_CLASSIFIER: 0,
} as unknown as AgentConfig;

function incidentFixture(): PimsIncident {
  return PimsIncidentSchema.parse({
    id: 1,
    incident_code: "INC-001",
    created_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
    is_deleted: false,
    involves_personal_data: true,
    incident_date: "2026-10-01",
    incident_type: "DL",
    status: "P",
    severity: "H",
    impact: "H",
    title: "DL breach dry-walk",
    description: "Exfiltration of admissions records.",
    affected_data_types: ["id_doc", "email"],
    security_measures_adopted: ["encrypt_rest"],
    affected_cid: ["C"],
    assigned_to: "analyst",
  });
}

interface HypothesisSpec {
  id: string;
  prior: number;
  likelihood: number;
  causes: string[];
}

function basePayload(overrides: {
  method: "5-whys" | "fishbone" | "fault-tree";
  hypotheses: HypothesisSpec[];
  five_whys?: JsonObject | null;
  fishbone?: JsonObject | null;
  fault_tree?: JsonObject | null;
  counterfactual_mapping: JsonObject[];
}): JsonObject {
  return {
    method: overrides.method,
    hypotheses: overrides.hypotheses.map((spec) => ({
      id: spec.id,
      claim: `claim ${spec.id}`,
      prior: spec.prior,
      likelihood: spec.likelihood,
      evidence_refs: ["file:log.txt:deadbeef"],
      ioc_refs: [],
      causes: spec.causes.map((cause) => ({
        cause,
        control_codes: ["encrypt_rest"],
      })),
    })),
    five_whys: overrides.five_whys ?? null,
    fishbone: overrides.fishbone ?? null,
    fault_tree: overrides.fault_tree ?? null,
    systemic: false,
    remediation: "Rotate credentials and enforce least privilege.",
    counterfactual_mapping: overrides.counterfactual_mapping,
    citations: [CITATION],
  };
}

function whys(level5Evidence: string | null): JsonObject {
  return {
    levels: [1, 2, 3, 4, 5].map((level) => ({
      level,
      claim: `why level ${level}`,
      evidence_ref: level === 5 ? level5Evidence : "file:log.txt:deadbeef",
    })),
  };
}

describe("Phase 4 Tree-of-Thoughts root-cause analyzer (§9.3)", () => {
  let provider: OpenAIModelProvider;
  let analyzer: TotAnalyzer;

  beforeEach(async () => {
    const modelConfig = {
      provider: "openai",
      model: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      auth_env: "OPENAI_API_KEY",
      timeout_ms: 20000,
      max_retries: 0,
      fallback: "none" as const,
    };
    provider = new OpenAIModelProvider({
      reasoningConfig: modelConfig,
      fastConfig: { ...modelConfig, model: "gpt-4o-mini" },
      visionConfig: modelConfig,
      embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
      rerankerConfig: { ...modelConfig, model: "gpt-4o-mini" },
      apiKey: "root-cause-unit-key",
      baseURL: "https://api.openai.com/v1",
    });

    const indexer = new RagIndexer({ modelProvider: provider });
    await indexer.indexCorpus(CHUNKS, "v1");
    const ragService = new RAGService({
      modelProvider: provider,
      indexer,
      knowledgeGraph: new NormativeKnowledgeGraph(),
      config: {
        RAG_TOP_K: 8,
        RAG_RERANK_K: 4,
        RAG_MIN_SCORE: 0.35,
        RAG_TIMEOUT_MS: 5000,
      } as unknown as AgentConfig,
    });

    analyzer = new TotAnalyzer({
      modelClient: new AgentModelClient(provider),
      ragService,
      config: CONFIG,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockChat(payload: JsonObject): void {
    vi.spyOn(provider, "chat_json").mockResolvedValue({
      content: payload,
      citations_requested: false,
      semantic_entropy: 0.2,
    });
  }

  it("accepts a five-whys analysis with exactly five levels", async () => {
    mockChat(
      basePayload({
        method: "5-whys",
        hypotheses: [
          { id: "h1", prior: 0.5, likelihood: 1, causes: ["root cause one"] },
          { id: "h2", prior: 0.3, likelihood: 1, causes: ["root cause two"] },
          { id: "h3", prior: 0.2, likelihood: 1, causes: ["root cause three"] },
        ],
        five_whys: whys("file:log.txt:deadbeef"),
        counterfactual_mapping: [
          {
            control_code: "encrypt_rest",
            basic_event_ids: ["root cause one"],
            rationale: "Encryption breaks the cut set.",
          },
        ],
      }),
    );

    const analysis = await analyzer.analyze({
      incident: incidentFixture(),
      history: [],
      actions: [],
      evidence: [],
      adoptedMeasures: ["encrypt_rest"],
      annexAControls: [],
      ragCitations: [CITATION],
    });

    expect(analysis.method).toBe("5-whys");
    expect(analysis.five_whys?.levels).toHaveLength(5);
    expect(analysis.root_cause_unproven).toBe(false);
    expect(analysis.selected_hypothesis_id).toBe("h1");
    expect(analysis.tot_posterior).toBeCloseTo(0.5, 6);
    expect(analysis.counterfactuals).toHaveLength(1);
    expect(analysis.counterfactuals[0]?.blocks_cut_set).toBe(true);
    expect(analysis.counterfactuals[0]?.residual_probability_delta).toBeCloseTo(
      -0.5,
      6,
    );
  });

  it("flags an unevidenced level 5 as root cause unproven", async () => {
    mockChat(
      basePayload({
        method: "5-whys",
        hypotheses: [
          { id: "h1", prior: 0.6, likelihood: 1, causes: ["root cause one"] },
          { id: "h2", prior: 0.3, likelihood: 1, causes: ["root cause two"] },
          { id: "h3", prior: 0.1, likelihood: 1, causes: ["root cause three"] },
        ],
        five_whys: whys(null),
        counterfactual_mapping: [],
      }),
    );

    const analysis = await analyzer.analyze({
      incident: incidentFixture(),
      history: [],
      actions: [],
      evidence: [],
      adoptedMeasures: ["encrypt_rest"],
      annexAControls: [],
      ragCitations: [CITATION],
    });

    expect(analysis.root_cause_unproven).toBe(true);
  });

  it("rejects a five-whys chain with four levels", async () => {
    const fourLevels = {
      levels: [1, 2, 3, 4].map((level) => ({
        level,
        claim: `why level ${level}`,
        evidence_ref: "file:log.txt:deadbeef",
      })),
    };
    mockChat(
      basePayload({
        method: "5-whys",
        hypotheses: [
          { id: "h1", prior: 0.6, likelihood: 1, causes: ["a"] },
          { id: "h2", prior: 0.3, likelihood: 1, causes: ["b"] },
          { id: "h3", prior: 0.1, likelihood: 1, causes: ["c"] },
        ],
        five_whys: fourLevels,
        counterfactual_mapping: [],
      }),
    );

    await expect(
      analyzer.analyze({
        incident: incidentFixture(),
        history: [],
        actions: [],
        evidence: [],
        adoptedMeasures: [],
        annexAControls: [],
        ragCitations: [CITATION],
      }),
    ).rejects.toThrow(ModelSchemaViolationError);
  });

  it("rejects a fishbone missing one of the six bones", async () => {
    mockChat(
      basePayload({
        method: "fishbone",
        hypotheses: [
          { id: "h1", prior: 0.6, likelihood: 1, causes: ["a"] },
          { id: "h2", prior: 0.3, likelihood: 1, causes: ["b"] },
          { id: "h3", prior: 0.1, likelihood: 1, causes: ["c"] },
        ],
        fishbone: {
          bones: {
            People: [
              { cause: "no training", evidence_ref: null, control_codes: [] },
            ],
            Process: [
              { cause: "no review", evidence_ref: null, control_codes: [] },
            ],
            Technology: [
              { cause: "no mfa", evidence_ref: null, control_codes: [] },
            ],
            Data: [
              {
                cause: "no classification",
                evidence_ref: null,
                control_codes: [],
              },
            ],
            Suppliers: [
              { cause: "no sla", evidence_ref: null, control_codes: [] },
            ],
          },
        },
        counterfactual_mapping: [],
      }),
    );

    await expect(
      analyzer.analyze({
        incident: incidentFixture(),
        history: [],
        actions: [],
        evidence: [],
        adoptedMeasures: [],
        annexAControls: [],
        ragCitations: [CITATION],
      }),
    ).rejects.toThrow(ModelSchemaViolationError);
  });

  it("computes minimal cut sets and counterfactual deltas for a fault tree", async () => {
    mockChat(
      basePayload({
        method: "fault-tree",
        hypotheses: [
          { id: "h1", prior: 0.5, likelihood: 1, causes: ["B1", "B2"] },
          { id: "h2", prior: 0.3, likelihood: 1, causes: ["B3"] },
          { id: "h3", prior: 0.2, likelihood: 1, causes: ["B1"] },
        ],
        fault_tree: {
          top_event: "G1",
          gates: [
            { gate_id: "G1", op: "OR", inputs: ["G2", "B3"] },
            { gate_id: "G2", op: "AND", inputs: ["B1", "B2"] },
          ],
          basic_events: [
            {
              event_id: "B1",
              description: "stale key",
              evidence_ref: null,
              control_codes: [],
            },
            {
              event_id: "B2",
              description: "open bucket",
              evidence_ref: null,
              control_codes: [],
            },
            {
              event_id: "B3",
              description: "no monitoring",
              evidence_ref: null,
              control_codes: [],
            },
          ],
        },
        counterfactual_mapping: [
          {
            control_code: "A.8.24",
            basic_event_ids: ["B1"],
            rationale: "Rotation removes B1 only.",
          },
          {
            control_code: "A.5.17",
            basic_event_ids: ["B1", "B3"],
            rationale: "Rotation plus monitoring breaks both cut sets.",
          },
          {
            control_code: "A.8.16",
            basic_event_ids: ["B1", "B2"],
            rationale: "Covers the AND gate only.",
          },
        ],
      }),
    );

    const analysis = await analyzer.analyze({
      incident: incidentFixture(),
      history: [],
      actions: [],
      evidence: [],
      adoptedMeasures: ["encrypt_rest"],
      annexAControls: [
        { code: "A.8.24", name: "Use of cryptography" },
        { code: "A.5.17", name: "Authentication information" },
        { code: "A.8.16", name: "Monitoring activities" },
      ],
      ragCitations: [CITATION],
    });

    expect(analysis.method).toBe("fault-tree");
    expect(analysis.tot_posterior).toBeCloseTo(0.5, 6);
    expect(
      analysis.posteriors.reduce((sum, row) => sum + row.posterior, 0),
    ).toBeCloseTo(1, 6);

    const byCode = new Map(
      analysis.counterfactuals.map((entry) => [entry.control_code, entry]),
    );
    expect(byCode.get("A.8.24")?.blocks_cut_set).toBe(false);
    expect(byCode.get("A.5.17")?.blocks_cut_set).toBe(true);
    expect(byCode.get("A.8.16")?.blocks_cut_set).toBe(false);
    expect(byCode.get("A.5.17")?.residual_probability_delta).toBeCloseTo(
      -0.333333,
      6,
    );
    expect(analysis.counterfactuals.map((entry) => entry.control_code)).toEqual(
      ["A.5.17", "A.8.16", "A.8.24"],
    );
  });

  it("rejects a counterfactual control code absent from the catalogs", async () => {
    mockChat(
      basePayload({
        method: "5-whys",
        hypotheses: [
          { id: "h1", prior: 0.6, likelihood: 1, causes: ["root cause one"] },
          { id: "h2", prior: 0.3, likelihood: 1, causes: ["root cause two"] },
          { id: "h3", prior: 0.1, likelihood: 1, causes: ["root cause three"] },
        ],
        five_whys: whys("file:log.txt:deadbeef"),
        counterfactual_mapping: [
          {
            control_code: "A.99.99",
            basic_event_ids: ["root cause one"],
            rationale: "Unknown control.",
          },
        ],
      }),
    );

    await expect(
      analyzer.analyze({
        incident: incidentFixture(),
        history: [],
        actions: [],
        evidence: [],
        adoptedMeasures: ["encrypt_rest"],
        annexAControls: [],
        ragCitations: [CITATION],
      }),
    ).rejects.toThrow(ModelSchemaViolationError);
  });

  it("rejects a posterior tie between the two leading hypotheses", async () => {
    mockChat(
      basePayload({
        method: "5-whys",
        hypotheses: [
          { id: "h1", prior: 0.5, likelihood: 1, causes: ["a"] },
          { id: "h2", prior: 0.5, likelihood: 1, causes: ["b"] },
          { id: "h3", prior: 0, likelihood: 1, causes: ["c"] },
        ],
        five_whys: whys("file:log.txt:deadbeef"),
        counterfactual_mapping: [],
      }),
    );

    await expect(
      analyzer.analyze({
        incident: incidentFixture(),
        history: [],
        actions: [],
        evidence: [],
        adoptedMeasures: [],
        annexAControls: [],
        ragCitations: [CITATION],
      }),
    ).rejects.toThrow(RootCauseAmbiguousError);
  });
});
