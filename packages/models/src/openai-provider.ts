import type { ModelConfig } from "@pims/config";
import {
  DEFAULT_RAG_RERANK_K,
  MAX_CHAT_MAX_TOKENS,
  MODEL_ROUTE_EMBEDDINGS,
  MODEL_ROUTE_FAST,
  MODEL_ROUTE_OPENAI,
  MODEL_ROUTE_RERANKER,
  MODEL_ROUTE_VISION,
} from "@pims/types/constants.ts";
import {
  CitationFabricatedError,
  CitationInvalidError,
  ModelSchemaViolationError,
  ModelUnavailableError,
  type PimsBaseError,
} from "@pims/types/errors.ts";
import {
  type ChatJsonArgs,
  type ChatJsonResponse,
  type EmbedArgs,
  type EmbedResponse,
  type JsonObject,
  JsonObjectSchema,
  type ModelProvider,
  type RankedPassage,
  type RerankArgs,
  type RerankResponse,
  RerankResponseSchema,
  type VisionJsonArgs,
  type VisionJsonResponse,
  VisionJsonResponseSchema,
} from "@pims/types/models.ts";
import OpenAI from "openai";
import { z } from "zod";

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

const OpenAIProviderOptionsSchema = z.object({
  apiKey: z.string().min(1),
  baseURL: z.string().optional(),
  cohereApiKey: z.string().optional(),
});

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
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        "API key is missing or empty",
      );
    }
    const validation = OpenAIProviderOptionsSchema.safeParse({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      cohereApiKey: options.cohereApiKey,
    });
    if (!validation.success) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        `Invalid provider options: ${validation.error.message}`,
      );
    }
    if (!options.reasoningConfig) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        "reasoningConfig is required",
      );
    }
    if (!options.fastConfig) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        "fastConfig is required",
      );
    }
    if (!options.visionConfig) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        "visionConfig is required",
      );
    }
    if (!options.embeddingsConfig) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        "embeddingsConfig is required",
      );
    }
    if (!options.rerankerConfig) {
      throw new ModelUnavailableError(
        MODEL_ROUTE_OPENAI,
        "rerankerConfig is required",
      );
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

  private resolveEndpoint(config: ModelConfig, route: string): string {
    if (config.endpoint && config.endpoint.trim() !== "") {
      return config.endpoint.replace(/\/+$/, "");
    }
    if (this.defaultBaseURL && this.defaultBaseURL.trim() !== "") {
      return this.defaultBaseURL.replace(/\/+$/, "");
    }
    throw new ModelUnavailableError(
      route,
      "No endpoint configured: set ModelConfig.endpoint or provider baseURL",
    );
  }

  private getClient(config: ModelConfig, route: string): OpenAI {
    const baseURL = this.resolveEndpoint(config, route);
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL,
      timeout: config.timeout_ms,
      maxRetries: config.max_retries,
    });
  }

  private mapError(route: string, err: unknown): PimsBaseError {
    if (
      err instanceof ModelUnavailableError ||
      err instanceof ModelSchemaViolationError ||
      err instanceof CitationInvalidError ||
      err instanceof CitationFabricatedError
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
    const route = args.route;
    const config =
      route === MODEL_ROUTE_FAST ? this.fastConfig : this.reasoningConfig;
    if (args.max_tokens > MAX_CHAT_MAX_TOKENS) {
      throw new ModelSchemaViolationError(
        route,
        `max_tokens ${args.max_tokens} exceeds limit ${MAX_CHAT_MAX_TOKENS}`,
      );
    }
    const client = this.getClient(config, route);

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
        throw new ModelSchemaViolationError(
          route,
          "tool role requires OpenAI tool-call conversion; unsupported message role",
        );
      }),
    ];

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
        throw new ModelSchemaViolationError(
          route,
          "Response from model did not contain message content",
        );
      }

      let parsed: JsonObject;
      try {
        const rawParsed: unknown = JSON.parse(rawContent);
        const validation = JsonObjectSchema.safeParse(rawParsed);
        if (!validation.success) {
          throw new ModelSchemaViolationError(
            route,
            `Model JSON output schema invalid: ${validation.error.message}`,
          );
        }
        parsed = validation.data;
      } catch (err: unknown) {
        if (err instanceof ModelSchemaViolationError) {
          throw err;
        }
        throw new ModelSchemaViolationError(
          route,
          `Failed to parse model output as JSON: ${String(err)}`,
        );
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
      throw this.mapError(route, err);
    }
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    const route = MODEL_ROUTE_VISION;
    const config = this.visionConfig;
    if (args.max_tokens > MAX_CHAT_MAX_TOKENS) {
      throw new ModelSchemaViolationError(
        route,
        `max_tokens ${args.max_tokens} exceeds limit ${MAX_CHAT_MAX_TOKENS}`,
      );
    }
    const client = this.getClient(config, route);

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

      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new ModelSchemaViolationError(
          route,
          "Vision model returned no message content",
        );
      }
      const parsed: unknown = JSON.parse(rawContent);
      const validation = VisionJsonResponseSchema.safeParse(parsed);
      if (!validation.success) {
        throw new ModelSchemaViolationError(route, validation.error.message);
      }
      return validation.data;
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
    const route = MODEL_ROUTE_EMBEDDINGS;
    const config = this.embeddingsConfig;
    const client = this.getClient(config, route);

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
    const route = MODEL_ROUTE_RERANKER;
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
      if (
        !config.endpoint ||
        config.endpoint.trim() === "" ||
        !config.model ||
        config.model.trim() === ""
      ) {
        throw new ModelUnavailableError(
          route,
          "Cohere endpoint/model must be explicit in RERANKER_MODEL",
        );
      }
      const endpoint = config.endpoint;
      const url = `${endpoint.replace(/\/+$/, "")}/v2/rerank`;
      const body = {
        model: config.model,
        query: args.query,
        documents: args.passages.map((p) => p.text),
        top_n: Math.min(args.passages.length, DEFAULT_RAG_RERANK_K * 2),
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

    try {
      const client = this.getClient(config, route);
      const res = await client.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "Rank the passages by relevance to the query. Return strict JSON {ranked:[{chunk_id,score,rank}]}.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query: args.query,
              passages: args.passages.map((p) => ({
                chunk_id: p.chunk_id,
                text: p.text,
              })),
            }),
          },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      });

      const rawContent = res.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new ModelSchemaViolationError(
          route,
          "Reranker model returned no message content",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch (err: unknown) {
        throw new ModelSchemaViolationError(
          route,
          `Reranker model output is not valid JSON: ${String(err)}`,
        );
      }
      const validation = RerankResponseSchema.safeParse(parsed);
      if (!validation.success) {
        throw new ModelSchemaViolationError(route, validation.error.message);
      }

      const byId = new Map(args.passages.map((p) => [p.chunk_id, p]));
      const ranked: RankedPassage[] = validation.data.ranked.map((r) => {
        const passage = byId.get(r.chunk_id);
        if (!passage) {
          throw new CitationFabricatedError(r.chunk_id);
        }
        return {
          ...passage,
          score: r.score,
          rank: r.rank,
        };
      });
      return { ranked };
    } catch (err: unknown) {
      throw this.mapError(route, err);
    }
  }
}
