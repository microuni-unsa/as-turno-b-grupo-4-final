import type { ModelConfig } from "@pims/config";
import { CONSTANTS } from "@pims/types/constants.ts";
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
  type VisionJsonArgs,
  type VisionJsonResponse,
  VisionJsonResponseSchema,
} from "@pims/types/models.ts";
import OpenAI from "openai";
import { z } from "zod";

export interface OpenAIProviderOptions {
  reasoningConfig: ModelConfig;
  fastConfig: ModelConfig;
  visionConfig?: ModelConfig;
  embeddingsConfig: ModelConfig;
  rerankerConfig: ModelConfig;
  defaultApiKey?: string;
  defaultBaseURL?: string;
  apiKey?: string;
  baseURL?: string;
  requestLogprobs?: boolean;
}

const TOP_LOGPROBS = 5;

const CODE_FENCE_PATTERN = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;

function contentToText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const part of raw) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (typeof part !== "object" || part === null || Array.isArray(part)) {
        throw new ModelSchemaViolationError(
          "OPENAI",
          `Model content part has unsupported shape: ${JSON.stringify(part).slice(0, 200)}`,
        );
      }
      const record = part as Record<string, unknown>;
      // Reasoning models interleave thinking traces with the answer; only
      // text parts carry the JSON payload.
      if (record.type === "thinking" || record.type === "reasoning") {
        continue;
      }
      if (typeof record.text === "string") {
        parts.push(record.text);
        continue;
      }
      throw new ModelSchemaViolationError(
        "OPENAI",
        `Model content part has unsupported shape: ${JSON.stringify(part).slice(0, 200)}`,
      );
    }
    return parts.join("");
  }
  throw new ModelSchemaViolationError(
    "OPENAI",
    `Model content is not text: ${typeof raw}`,
  );
}

function unwrapCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = CODE_FENCE_PATTERN.exec(trimmed);
  if (match?.[1] !== undefined) {
    return match[1].trim();
  }
  return trimmed;
}

const RerankModelResponseSchema = z.object({
  ranked: z.array(
    z.object({
      chunk_id: z.string(),
      score: z.number(),
      rank: z.number().int().positive(),
    }),
  ),
});

export function computeTopLogprobEntropy(
  positions: Array<Array<{ logprob: number }>>,
): number | null {
  let total = 0;
  let counted = 0;

  for (const position of positions) {
    if (position.length === 0) {
      continue;
    }
    const normalizer = Math.log2(position.length);
    if (!(normalizer > 0)) {
      continue;
    }
    let entropy = 0;
    let mass = 0;
    for (const item of position) {
      if (typeof item.logprob !== "number" || !Number.isFinite(item.logprob)) {
        continue;
      }
      const probability = Math.exp(item.logprob);
      if (!Number.isFinite(probability) || probability <= 0) {
        continue;
      }
      mass += probability;
      entropy -= probability * Math.log2(probability);
    }
    if (!(mass > 0)) {
      continue;
    }
    total += entropy / normalizer;
    counted += 1;
  }

  if (counted === 0) {
    return null;
  }

  const mean = total / counted;
  if (!Number.isFinite(mean)) {
    return null;
  }
  return Math.min(1, Math.max(0, mean));
}

export class OpenAIModelProvider implements ModelProvider {
  private readonly reasoningConfig: ModelConfig;
  private readonly fastConfig: ModelConfig;
  private readonly visionConfig?: ModelConfig;
  private readonly embeddingsConfig: ModelConfig;
  private readonly rerankerConfig: ModelConfig;
  private readonly defaultApiKey?: string;
  private readonly defaultBaseURL?: string;
  private readonly requestLogprobs: boolean;

  constructor(options: OpenAIProviderOptions) {
    if (!options.reasoningConfig) {
      throw new ModelUnavailableError(
        CONSTANTS.MODEL_ROUTE_OPENAI,
        "reasoningConfig is required",
      );
    }
    if (!options.fastConfig) {
      throw new ModelUnavailableError(
        CONSTANTS.MODEL_ROUTE_OPENAI,
        "fastConfig is required",
      );
    }
    if (!options.embeddingsConfig) {
      throw new ModelUnavailableError(
        CONSTANTS.MODEL_ROUTE_OPENAI,
        "embeddingsConfig is required",
      );
    }
    if (!options.rerankerConfig) {
      throw new ModelUnavailableError(
        CONSTANTS.MODEL_ROUTE_OPENAI,
        "rerankerConfig is required",
      );
    }
    this.reasoningConfig = options.reasoningConfig;
    this.fastConfig = options.fastConfig;
    this.visionConfig = options.visionConfig;
    this.embeddingsConfig = options.embeddingsConfig;
    this.rerankerConfig = options.rerankerConfig;
    this.defaultApiKey = options.defaultApiKey ?? options.apiKey;
    this.defaultBaseURL = options.defaultBaseURL ?? options.baseURL;
    this.requestLogprobs =
      options.requestLogprobs !== undefined
        ? options.requestLogprobs
        : CONSTANTS.DEFAULT_MODEL_LOGPROBS;
  }

  private getClient(config: ModelConfig, route: string): OpenAI {
    const apiKey = config.apiKey || this.defaultApiKey;
    if (!apiKey || apiKey.trim() === "") {
      throw new ModelUnavailableError(route, "API key is missing or empty");
    }
    const endpoint = config.endpoint || this.defaultBaseURL;
    if (!endpoint || endpoint.trim() === "") {
      throw new ModelUnavailableError(
        route,
        "No endpoint configured: set ModelConfig.endpoint or defaultBaseURL",
      );
    }
    const baseURL = endpoint.replace(/\/+$/, "");
    return new OpenAI({
      apiKey,
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
      route === CONSTANTS.MODEL_ROUTE_FAST
        ? this.fastConfig
        : this.reasoningConfig;
    if (args.max_tokens > CONSTANTS.MAX_CHAT_MAX_TOKENS) {
      throw new ModelSchemaViolationError(
        route,
        `max_tokens ${args.max_tokens} exceeds limit ${CONSTANTS.MAX_CHAT_MAX_TOKENS}`,
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
      const systemWithSchema =
        args.json_schema === undefined
          ? args.system
          : `${args.system}\nReturn one JSON object that matches this JSON Schema exactly and includes every required key: ${JSON.stringify(args.json_schema)}`;
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: systemWithSchema },
          ...messages.slice(1),
        ],
        temperature: args.temperature,
        max_tokens: args.max_tokens,
        response_format: { type: "json_object" },
        ...(this.requestLogprobs
          ? { logprobs: true, top_logprobs: TOP_LOGPROBS }
          : {}),
      });

      const rawContent: unknown = response.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new ModelSchemaViolationError(
          route,
          "Response from model did not contain message content",
        );
      }

      let parsed: JsonObject;
      try {
        const rawParsed: unknown = JSON.parse(
          unwrapCodeFence(contentToText(rawContent)),
        );
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
      const topLogprobPositions: Array<Array<{ logprob: number }>> = [];
      if (Array.isArray(choiceLogprobs)) {
        for (const item of choiceLogprobs) {
          if (typeof item.logprob === "number") {
            logprobs.push(item.logprob);
          }
          const tops = item.top_logprobs;
          if (!Array.isArray(tops)) {
            continue;
          }
          const position: Array<{ logprob: number }> = [];
          for (const candidate of tops) {
            if (typeof candidate.logprob === "number") {
              position.push({ logprob: candidate.logprob });
            }
          }
          topLogprobPositions.push(position);
        }
      }

      const semanticEntropy = computeTopLogprobEntropy(topLogprobPositions);

      return {
        content: parsed,
        citations_requested: citationsRequested,
        logprobs: logprobs.length > 0 ? logprobs : undefined,
        ...(semanticEntropy === null
          ? {}
          : { semantic_entropy: semanticEntropy }),
      };
    } catch (err: unknown) {
      throw this.mapError(route, err);
    }
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    const route = CONSTANTS.MODEL_ROUTE_VISION;
    const config = this.visionConfig;
    if (!config) {
      throw new ModelUnavailableError(route, "visionConfig is not configured");
    }
    if (args.max_tokens > CONSTANTS.MAX_CHAT_MAX_TOKENS) {
      throw new ModelSchemaViolationError(
        route,
        `max_tokens ${args.max_tokens} exceeds limit ${CONSTANTS.MAX_CHAT_MAX_TOKENS}`,
      );
    }
    const client = this.getClient(config, route);

    let imageUrl: string;
    if (args.image_or_pdf_ref.startsWith("data:")) {
      imageUrl = args.image_or_pdf_ref;
    } else if (
      args.image_or_pdf_ref.startsWith("http://") ||
      args.image_or_pdf_ref.startsWith("https://")
    ) {
      imageUrl = args.image_or_pdf_ref;
    } else {
      const trimmed = args.image_or_pdf_ref.trim();
      const isBase64 =
        trimmed.length > 0 && /^[A-Za-z0-9+/=_-]+$/.test(trimmed);
      if (!isBase64) {
        throw new ModelUnavailableError(
          route,
          "Invalid image_or_pdf_ref: must be a data URI, HTTP(S) URI, or valid base64 string",
        );
      }
      imageUrl = `data:image/jpeg;base64,${trimmed}`;
    }

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

      const rawContent: unknown = response.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new ModelSchemaViolationError(
          route,
          "Vision model returned no message content",
        );
      }
      const parsed: unknown = JSON.parse(
        unwrapCodeFence(contentToText(rawContent)),
      );
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
    const route = CONSTANTS.MODEL_ROUTE_EMBEDDINGS;
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
    const route = CONSTANTS.MODEL_ROUTE_RERANKER;
    const config = this.rerankerConfig;

    if (args.passages.length === 0) {
      return { ranked: [] };
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

      const rawContent: unknown = res.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new ModelSchemaViolationError(
          route,
          "Reranker model returned no message content",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(unwrapCodeFence(contentToText(rawContent)));
      } catch (err: unknown) {
        throw new ModelSchemaViolationError(
          route,
          `Reranker model output is not valid JSON: ${String(err)}`,
        );
      }
      const validation = RerankModelResponseSchema.safeParse(parsed);
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
