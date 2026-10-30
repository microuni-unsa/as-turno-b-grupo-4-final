import type { ModelConfig } from "@pims/config";
import { MistralModelProvider } from "@pims/models";
import { ModelSchemaViolationError, ModelUnavailableError } from "@pims/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("MistralModelProvider (§4.3 Unit Suite)", () => {
  const dummyModelConfig: ModelConfig = {
    provider: "mistral",
    model: "mistral-large-latest",
    endpoint: "https://api.mistral.ai",
    auth_env: "MISTRAL_API_KEY",
    timeout_ms: 5000,
    max_retries: 2,
    fallback: "none",
  };

  const dummyVisionConfig: ModelConfig = {
    provider: "mistral",
    model: "pixtral-12b-2409",
    endpoint: "https://api.mistral.ai",
    auth_env: "MISTRAL_API_KEY",
    timeout_ms: 5000,
    max_retries: 2,
    fallback: "none",
  };

  const dummyEmbedConfig: ModelConfig = {
    provider: "mistral",
    model: "mistral-embed",
    endpoint: "https://api.mistral.ai",
    auth_env: "MISTRAL_API_KEY",
    timeout_ms: 5000,
    max_retries: 2,
    fallback: "none",
  };

  const dummyRerankConfig: ModelConfig = {
    provider: "mistral",
    model: "mistral-small-latest",
    endpoint: "https://api.mistral.ai",
    auth_env: "MISTRAL_API_KEY",
    timeout_ms: 5000,
    max_retries: 2,
    fallback: "none",
  };

  let provider: MistralModelProvider;

  beforeEach(() => {
    provider = new MistralModelProvider({
      reasoningConfig: dummyModelConfig,
      fastConfig: { ...dummyModelConfig, model: "mistral-small-latest" },
      visionConfig: dummyVisionConfig,
      embeddingsConfig: dummyEmbedConfig,
      rerankerConfig: dummyRerankConfig,
      apiKey: "dummy-mistral-key",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws ModelUnavailableError if API key is missing or empty", () => {
    expect(
      () =>
        new MistralModelProvider({
          reasoningConfig: dummyModelConfig,
          fastConfig: dummyModelConfig,
          visionConfig: dummyVisionConfig,
          embeddingsConfig: dummyEmbedConfig,
          rerankerConfig: dummyRerankConfig,
          apiKey: "",
        }),
    ).toThrowError(ModelUnavailableError);
  });

  it("chat_json succeeds and extracts valid JSON payload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "OK",
                  verdict: "contained",
                  citations: ["gdpr-full:art33:1-10"],
                }),
              },
              logprobs: {
                content: [{ logprob: -0.15 }, { logprob: -0.05 }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await provider.chat_json({
      system: "You are a privacy expert",
      messages: [{ role: "user", content: "Is this a breach?" }],
      max_tokens: 500,
      temperature: 0.2,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.content).toEqual({
      status: "OK",
      verdict: "contained",
      citations: ["gdpr-full:art33:1-10"],
    });
    expect(res.citations_requested).toBe(true);
    expect(res.logprobs).toEqual([-0.15, -0.05]);
  });

  it("chat_json retries on malformed JSON and throws ModelSchemaViolationError on repeated failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "NOT_VALID_JSON" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      provider.chat_json({
        system: "System prompt",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
        temperature: 0.0,
      }),
    ).rejects.toThrowError(ModelSchemaViolationError);
  });

  it("embed succeeds with batch float vectors", async () => {
    const mockVec1 = [0.1, 0.2, 0.3];
    const mockVec2 = [0.4, 0.5, 0.6];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ embedding: mockVec1 }, { embedding: mockVec2 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await provider.embed({ texts: ["text one", "text two"] });
    expect(res.vectors).toHaveLength(2);
    expect(res.vectors[0]).toEqual(mockVec1);
    expect(res.vectors[1]).toEqual(mockVec2);
  });

  it("vision_json parses multimodal forensics response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  extracted_text_redacted: "Report text",
                  iocs: ["192.168.1.1"],
                  pii_detected: ["email@domain.com"],
                  encryption_proof_verified: true,
                  tamper_score: 0.05,
                  layout_hashes: ["abc123hash"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await provider.vision_json({
      system: "Forensic auditor",
      image_or_pdf_ref: "base64datahere",
      prompt: "Analyze tamper signatures",
      json_schema: {},
      max_tokens: 500,
      temperature: 0.0,
    });

    expect(res.extracted_text_redacted).toBe("Report text");
    expect(res.iocs).toEqual(["192.168.1.1"]);
    expect(res.encryption_proof_verified).toBe(true);
    expect(res.tamper_score).toBe(0.05);
  });

  it("rerank orders passages descending by similarity", async () => {
    // Mock embed calls for query and candidate passages
    vi.spyOn(globalThis, "fetch")
      // Query embedding
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 0, 0] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      // Passage embeddings: p1 has [0, 1, 0], p2 has [0.9, 0.1, 0]
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0, 1, 0] }, { embedding: [0.9, 0.1, 0] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const passages = [
      {
        chunk_id: "p1",
        doc_id: "doc1",
        article_or_clause: "art1",
        lines: "1-10",
        text: "Passage orthogonal",
        normative: true,
      },
      {
        chunk_id: "p2",
        doc_id: "doc2",
        article_or_clause: "art2",
        lines: "11-20",
        text: "Passage close",
        normative: true,
      },
    ];

    const res = await provider.rerank({ query: "target", passages });
    expect(res.ranked).toHaveLength(2);
    expect(res.ranked[0]?.chunk_id).toBe("p2"); // higher cosine similarity
    expect(res.ranked[0]?.rank).toBe(1);
    expect(res.ranked[1]?.chunk_id).toBe("p1");
    expect(res.ranked[1]?.rank).toBe(2);
  });

  it("handles HTTP 500 with retry and throws ModelUnavailableError on exhaustion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );

    await expect(provider.embed({ texts: ["test"] })).rejects.toThrowError(
      ModelUnavailableError,
    );
  });
});
