import type { ModelConfig } from "@pims/config";
import { DEFAULT_OPENAI_BASE_URL } from "@pims/types/constants.ts";
import {
  CitationInvalidError,
  ModelSchemaViolationError,
  ModelUnavailableError,
} from "@pims/types/errors.ts";
import type {
  ChatJsonArgs,
  ChatJsonResponse,
  EmbedArgs,
  EmbedResponse,
  ModelProvider,
  RankedPassage,
  RerankArgs,
  RerankResponse,
  VisionJsonArgs,
  VisionJsonResponse,
} from "@pims/types/models.ts";
import OpenAI from "openai";

export interface OpenAIProviderOptions {
  reasoningConfig: ModelConfig;
  fastConfig: ModelConfig;
  visionConfig: ModelConfig;
  embeddingsConfig: ModelConfig;
  rerankerConfig: ModelConfig;
  apiKey: string;
  baseURL?: string;
  cohereApiKey?: string;
}

export class OpenAIModelProvider implements ModelProvider {
  private readonly reasoningConfig: ModelConfig;
  private readonly fastConfig: ModelConfig;
  private readonly visionConfig: ModelConfig;
  private readonly embeddingsConfig: ModelConfig;
  private readonly rerankerConfig: ModelConfig;
  private readonly apiKey: string;
  private readonly defaultBaseURL?: string;
  private readonly cohereApiKey?: string;

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey || options.apiKey.trim() === "") {
      throw new ModelUnavailableError("OPENAI", "API key is missing or empty");
    }
    this.reasoningConfig = options.reasoningConfig;
    this.fastConfig = options.fastConfig;
    this.visionConfig = options.visionConfig;
    this.embeddingsConfig = options.embeddingsConfig;
    this.rerankerConfig = options.rerankerConfig;
    this.apiKey = options.apiKey;
    this.defaultBaseURL = options.baseURL;
    this.cohereApiKey = options.cohereApiKey;
  }

  private resolveEndpoint(config: ModelConfig): string {
    if (config.endpoint && config.endpoint.trim() !== "") {
      return config.endpoint.replace(/\/+$/, "");
    }
    if (this.defaultBaseURL && this.defaultBaseURL.trim() !== "") {
      return this.defaultBaseURL.replace(/\/+$/, "");
    }
    return DEFAULT_OPENAI_BASE_URL;
  }

  private getClient(config: ModelConfig): OpenAI {
    const baseURL = this.resolveEndpoint(config);
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL,
      timeout: config.timeout_ms,
      maxRetries: config.max_retries,
    });
  }

  private mapError(route: string, err: unknown): Error {
    if (
      err instanceof ModelUnavailableError ||
      err instanceof ModelSchemaViolationError ||
      err instanceof CitationInvalidError
    ) {
      return err;
    }

    if (err instanceof OpenAI.APIError) {
      if (err.status === 401 || err.status === 403) {
        return new ModelUnavailableError(
          route,
          `Authentication failed with status ${err.status}: ${err.message}`,
        );
      }
      if (
        err.status &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        return new ModelUnavailableError(
          route,
          `Client error ${err.status}: ${err.message}`,
        );
      }
      return new ModelUnavailableError(
        route,
        `OpenAI API error (${err.status}): ${err.message}`,
      );
    }

    const msg = err instanceof Error ? err.message : String(err);
    return new ModelUnavailableError(route, `Model call failed: ${msg}`);
  }

  async chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse> {
    const route = args.temperature === 0 ? "FAST_MODEL" : "REASONING_MODEL";
    const config =
      route === "FAST_MODEL" ? this.fastConfig : this.reasoningConfig;
    const client = this.getClient(config);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: args.system },
      ...args.messages.map((m) => {
        if (
          m.role === "system" ||
          m.role === "user" ||
          m.role === "assistant"
        ) {
          return { role: m.role, content: m.content };
        }
        return {
          role: "assistant" as const,
          content: m.content,
        };
      }),
    ];

    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        const response = await client.chat.completions.create({
          model: config.model,
          messages,
          temperature: args.temperature,
          max_tokens: args.max_tokens,
          response_format: { type: "json_object" },
        });

        const rawContent = response.choices?.[0]?.message?.content;
        if (!rawContent) {
          if (attempts >= 2) {
            throw new ModelSchemaViolationError(
              route,
              "Response from model did not contain message content",
            );
          }
          continue;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawContent) as Record<string, unknown>;
        } catch (err: unknown) {
          if (attempts >= 2) {
            throw new ModelSchemaViolationError(
              route,
              `Failed to parse model output as JSON: ${String(err)}`,
            );
          }
          continue;
        }

        const citationsRequested = Boolean(
          parsed.citations_requested ||
            (Array.isArray(parsed.citations) && parsed.citations.length > 0),
        );

        const logprobs: number[] = [];
        const choiceLogprobs = response.choices?.[0]?.logprobs?.content;
        if (Array.isArray(choiceLogprobs)) {
          for (const item of choiceLogprobs) {
            if (typeof item.logprob === "number") {
              logprobs.push(item.logprob);
            }
          }
        }

        return {
          content: parsed,
          citations_requested: citationsRequested,
          logprobs: logprobs.length > 0 ? logprobs : undefined,
        };
      } catch (err: unknown) {
        if (attempts >= 2 || err instanceof ModelSchemaViolationError) {
          throw this.mapError(route, err);
        }
      }
    }

    throw new ModelSchemaViolationError(
      route,
      "Failed to produce valid schema conforming response after retry",
    );
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    const route = "VISION_MODEL";
    const config = this.visionConfig;
    const client = this.getClient(config);

    const imageUrl = args.image_or_pdf_ref.startsWith("data:")
      ? args.image_or_pdf_ref
      : `data:image/jpeg;base64,${args.image_or_pdf_ref}`;

    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: args.system },
          {
            role: "user",
            content: [
              { type: "text", text: args.prompt },
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        temperature: args.temperature,
        max_tokens: args.max_tokens,
        response_format: { type: "json_object" },
      });

      const rawContent = response.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(rawContent) as Partial<VisionJsonResponse>;

      return {
        extracted_text_redacted: parsed.extracted_text_redacted ?? "",
        iocs: Array.isArray(parsed.iocs) ? parsed.iocs : [],
        pii_detected: Array.isArray(parsed.pii_detected)
          ? parsed.pii_detected
          : [],
        encryption_proof_verified: Boolean(parsed.encryption_proof_verified),
        tamper_score:
          typeof parsed.tamper_score === "number" ? parsed.tamper_score : 0,
        layout_hashes: Array.isArray(parsed.layout_hashes)
          ? parsed.layout_hashes
          : [],
      };
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        throw new ModelSchemaViolationError(
          route,
          `Vision model output is not valid JSON: ${err.message}`,
        );
      }
      throw this.mapError(route, err);
    }
  }

  async embed(args: EmbedArgs): Promise<EmbedResponse> {
    const route = "EMBEDDINGS_MODEL";
    const config = this.embeddingsConfig;
    const client = this.getClient(config);

    try {
      const response = await client.embeddings.create({
        model: config.model,
        input: args.texts,
      });

      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new ModelUnavailableError(
          route,
          "Embeddings API returned invalid data payload",
        );
      }

      const vectors = response.data.map((item) => {
        if (!Array.isArray(item.embedding)) {
          throw new ModelUnavailableError(
            route,
            "Embeddings API item is missing embedding vector",
          );
        }
        return item.embedding;
      });

      return { vectors };
    } catch (err: unknown) {
      throw this.mapError(route, err);
    }
  }

  async rerank(args: RerankArgs): Promise<RerankResponse> {
    const route = "RERANKER_MODEL";
    const config = this.rerankerConfig;

    if (args.passages.length === 0) {
      return { ranked: [] };
    }

    if (config.provider.toLowerCase() === "cohere") {
      if (!this.cohereApiKey || this.cohereApiKey.trim() === "") {
        throw new ModelUnavailableError(
          route,
          "Cohere API key is missing but provider is configured as cohere",
        );
      }
      const endpoint =
        config.endpoint && config.endpoint.trim() !== ""
          ? config.endpoint
          : "https://api.cohere.com";
      const url = `${endpoint.replace(/\/+$/, "")}/v2/rerank`;
      const body = {
        model: config.model || "rerank-v3.5",
        query: args.query,
        documents: args.passages.map((p) => p.text),
        top_n: args.passages.length,
      };

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.cohereApiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeout_ms),
        });

        if (!res.ok) {
          throw new ModelUnavailableError(
            route,
            `Cohere rerank failed with status ${res.status}: ${await res.text()}`,
          );
        }

        const json = (await res.json()) as {
          results?: Array<{ index: number; relevance_score: number }>;
        };

        if (!Array.isArray(json.results)) {
          throw new ModelUnavailableError(
            route,
            "Cohere rerank response missing results array",
          );
        }

        const ranked: RankedPassage[] = json.results.map((r, rankIdx) => {
          const passage = args.passages[r.index];
          if (!passage) {
            throw new CitationInvalidError(
              `Invalid passage index in rerank response: ${r.index}`,
            );
          }
          return {
            ...passage,
            score: r.relevance_score,
            rank: rankIdx + 1,
          };
        });

        return { ranked };
      } catch (err: unknown) {
        throw this.mapError(route, err);
      }
    }

    // Bi-encoder vector similarity + lexical scoring via embed()
    const queryEmbRes = await this.embed({ texts: [args.query] });
    const queryVector = queryEmbRes.vectors[0];
    if (!queryVector) {
      throw new ModelUnavailableError(
        route,
        "Failed to compute query vector for reranking",
      );
    }

    const passageTexts = args.passages.map((p) => p.text);
    const passEmbRes = await this.embed({ texts: passageTexts });

    const queryTerms = args.query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    const scoredPassages = args.passages.map((passage, idx) => {
      const pVec = passEmbRes.vectors[idx];
      let cosSim = 0;
      if (pVec) {
        let dot = 0;
        let normQ = 0;
        let normP = 0;
        for (let i = 0; i < queryVector.length; i++) {
          const qVal = queryVector[i] ?? 0;
          const pVal = pVec[i] ?? 0;
          dot += qVal * pVal;
          normQ += qVal * qVal;
          normP += pVal * pVal;
        }
        const denom = Math.sqrt(normQ) * Math.sqrt(normP);
        cosSim = denom > 0 ? Math.max(0, Math.min(1, dot / denom)) : 0;
      }

      let matchCount = 0;
      const lowerText = passage.text.toLowerCase();
      for (const t of queryTerms) {
        if (lowerText.includes(t)) {
          matchCount++;
        }
      }
      const matchRatio =
        queryTerms.length > 0 ? matchCount / queryTerms.length : 0;

      const score = Math.max(0, Math.min(1, 0.65 * cosSim + 0.35 * matchRatio));
      return { passage, score };
    });

    scoredPassages.sort((a, b) => b.score - a.score);

    const ranked: RankedPassage[] = scoredPassages.map((item, rankIdx) => ({
      ...item.passage,
      score: Number(item.score.toFixed(4)),
      rank: rankIdx + 1,
    }));

    return { ranked };
  }
}
