import type { ModelConfig } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import { ModelSchemaViolationError, ModelUnavailableError } from "@pims/types";
import {
  TEST_GPT_4O,
  TEST_GPT_4O_MINI,
  TEST_OPENAI_BASE_URL,
  TEST_TEXT_EMBEDDING_3_SMALL,
} from "@tests/helpers/test-constants.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("OpenAIModelProvider (§4.3 Unit Suite)", () => {
  const dummyModelConfig: ModelConfig = {
    model: TEST_GPT_4O,
    endpoint: TEST_OPENAI_BASE_URL,
    apiKey: "dummy-openai-key",
    timeout_ms: 5000,
    max_retries: 2,
  };

  const dummyVisionConfig: ModelConfig = {
    model: TEST_GPT_4O,
    endpoint: TEST_OPENAI_BASE_URL,
    apiKey: "dummy-openai-key",
    timeout_ms: 5000,
    max_retries: 2,
  };

  const dummyEmbedConfig: ModelConfig = {
    model: TEST_TEXT_EMBEDDING_3_SMALL,
    endpoint: TEST_OPENAI_BASE_URL,
    apiKey: "dummy-openai-key",
    timeout_ms: 5000,
    max_retries: 2,
  };

  const dummyRerankConfig: ModelConfig = {
    model: TEST_GPT_4O_MINI,
    endpoint: TEST_OPENAI_BASE_URL,
    apiKey: "dummy-openai-key",
    timeout_ms: 5000,
    max_retries: 2,
  };

  let provider: OpenAIModelProvider;

  beforeEach(() => {
    provider = new OpenAIModelProvider({
      reasoningConfig: dummyModelConfig,
      fastConfig: { ...dummyModelConfig, model: TEST_GPT_4O_MINI },
      visionConfig: dummyVisionConfig,
      embeddingsConfig: dummyEmbedConfig,
      rerankerConfig: dummyRerankConfig,
      defaultApiKey: "dummy-openai-key",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws ModelUnavailableError if API key is missing or empty", async () => {
    const noKeyProvider = new OpenAIModelProvider({
      reasoningConfig: { ...dummyModelConfig, apiKey: "" },
      fastConfig: { ...dummyModelConfig, apiKey: "" },
      visionConfig: dummyVisionConfig,
      embeddingsConfig: dummyEmbedConfig,
      rerankerConfig: dummyRerankConfig,
    });
    await expect(
      noKeyProvider.chat_json({
        route: "FAST_MODEL",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
        temperature: 0,
      }),
    ).rejects.toThrow(ModelUnavailableError);
  });

  it("dispatches requests to each model's independent endpoint and API key", async () => {
    const customEmbedConfig: ModelConfig = {
      model: "mistral-embed",
      endpoint: "https://api.mistral.ai/v1",
      apiKey: "mistral-specific-key-123",
      timeout_ms: 5000,
      max_retries: 0,
    };
    const multiProvider = new OpenAIModelProvider({
      reasoningConfig: dummyModelConfig,
      fastConfig: dummyModelConfig,
      visionConfig: dummyVisionConfig,
      embeddingsConfig: customEmbedConfig,
      rerankerConfig: dummyRerankConfig,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await multiProvider.embed({ texts: ["hello world"] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchSpy.mock.calls[0] as unknown as [
      string | URL | Request,
      RequestInit | undefined,
    ];
    const urlString =
      requestUrl instanceof Request ? requestUrl.url : String(requestUrl);
    expect(urlString).toContain("api.mistral.ai");
    const headers = new Headers(
      requestInit?.headers ??
        (requestUrl instanceof Request ? requestUrl.headers : undefined),
    );
    expect(headers.get("authorization")).toBe(
      "Bearer mistral-specific-key-123",
    );
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
      route: "FAST_MODEL",
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

  it("chat_json throws ModelSchemaViolationError on malformed JSON without retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
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
        route: "FAST_MODEL",
        system: "System prompt",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
        temperature: 0.0,
      }),
    ).rejects.toThrow(ModelSchemaViolationError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ranked: [
                    {
                      chunk_id: "p2",
                      doc_id: "doc2",
                      article_or_clause: "art2",
                      lines: "11-20",
                      text: "Passage close",
                      normative: true,
                      score: 0.9,
                      rank: 1,
                    },
                    {
                      chunk_id: "p1",
                      doc_id: "doc1",
                      article_or_clause: "art1",
                      lines: "1-10",
                      text: "Passage orthogonal",
                      normative: true,
                      score: 0.3,
                      rank: 2,
                    },
                  ],
                }),
              },
            },
          ],
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
    expect(res.ranked[0]?.chunk_id).toBe("p2");
    expect(res.ranked[0]?.rank).toBe(1);
    expect(res.ranked[1]?.chunk_id).toBe("p1");
    expect(res.ranked[1]?.rank).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("chat_json computes semantic entropy from top_logprobs and requests them", async () => {
    const uniform = Math.log(0.5);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ status: "OK" }) },
              logprobs: {
                content: [
                  {
                    logprob: uniform,
                    top_logprobs: [
                      { token: "A", logprob: uniform },
                      { token: "B", logprob: uniform },
                    ],
                  },
                  {
                    logprob: uniform,
                    top_logprobs: [
                      { token: "C", logprob: uniform },
                      { token: "D", logprob: uniform },
                    ],
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await provider.chat_json({
      route: "REASONING_MODEL",
      system: "System prompt",
      messages: [{ role: "user", content: "Classify" }],
      max_tokens: 200,
      temperature: 0.0,
    });

    expect(res.semantic_entropy).toBeCloseTo(1, 6);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      logprobs?: boolean;
      top_logprobs?: number;
    };
    expect(body.logprobs).toBe(true);
    expect(body.top_logprobs).toBe(5);
  });

  it("chat_json omits semantic_entropy when the endpoint returns no top_logprobs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ status: "OK" }) },
              logprobs: { content: [{ logprob: -0.1 }] },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await provider.chat_json({
      route: "REASONING_MODEL",
      system: "System prompt",
      messages: [{ role: "user", content: "Classify" }],
      max_tokens: 200,
      temperature: 0.0,
    });

    expect(res.semantic_entropy).toBeUndefined();
  });

  it("handles HTTP 500 with retry and throws ModelUnavailableError on exhaustion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );

    await expect(provider.embed({ texts: ["test"] })).rejects.toThrow(
      ModelUnavailableError,
    );
  });
});
