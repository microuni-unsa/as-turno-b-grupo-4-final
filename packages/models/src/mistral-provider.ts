import type { ModelConfig } from "@pims/config";
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

export interface MistralProviderOptions {
  reasoningConfig: ModelConfig;
  fastConfig: ModelConfig;
  visionConfig: ModelConfig;
  embeddingsConfig: ModelConfig;
  rerankerConfig: ModelConfig;
  apiKey: string;
  cohereApiKey?: string;
}

export class MistralModelProvider implements ModelProvider {
  private readonly reasoningConfig: ModelConfig;
  private readonly fastConfig: ModelConfig;
  private readonly visionConfig: ModelConfig;
  private readonly embeddingsConfig: ModelConfig;
  private readonly rerankerConfig: ModelConfig;
  private readonly apiKey: string;
  private readonly cohereApiKey?: string;

  constructor(options: MistralProviderOptions) {
    if (!options.apiKey || options.apiKey.trim() === "") {
      throw new ModelUnavailableError("MISTRAL", "API key is missing or empty");
    }
    this.reasoningConfig = options.reasoningConfig;
    this.fastConfig = options.fastConfig;
    this.visionConfig = options.visionConfig;
    this.embeddingsConfig = options.embeddingsConfig;
    this.rerankerConfig = options.rerankerConfig;
    this.apiKey = options.apiKey;
    this.cohereApiKey = options.cohereApiKey;
  }

  private async fetchWithRetry(
    route: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number,
    maxRetries: number,
  ): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.ok) {
          return res;
        }

        const status = res.status;
        const errText = await res.text();

        // 4xx errors other than 429 are client errors or schema issues; do not retry 400/401/403
        if (status === 401 || status === 403) {
          throw new ModelUnavailableError(
            route,
            `Authentication failed with status ${status}: ${errText}`,
          );
        }
        if (status !== 429 && status < 500) {
          throw new ModelUnavailableError(
            route,
            `Client error ${status}: ${errText}`,
          );
        }

        lastError = new Error(`HTTP ${status}: ${errText}`);
      } catch (err: unknown) {
        if (err instanceof ModelUnavailableError) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      // Wait exponential backoff before retry if attempts remain
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new ModelUnavailableError(
      route,
      `Exceeded max retries (${maxRetries}). Last error: ${lastError?.message}`,
    );
  }

  async chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse> {
    // Route determination: use fast config if temperature == 0 or max_tokens < 1000, else reasoning
    const route = args.temperature === 0 ? "FAST_MODEL" : "REASONING_MODEL";
    const config =
      route === "FAST_MODEL" ? this.fastConfig : this.reasoningConfig;
    const endpoint = config.endpoint || "https://api.mistral.ai";
    const url = `${endpoint.replace(/\/+$/, "")}/v1/chat/completions`;

    const messagesPayload: Array<{ role: string; content: string }> = [
      { role: "system", content: args.system },
      ...args.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body = {
      model: config.model,
      messages: messagesPayload,
      temperature: args.temperature,
      max_tokens: args.max_tokens,
      response_format: { type: "json_object" },
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      const res = await this.fetchWithRetry(
        route,
        url,
        headers,
        body,
        config.timeout_ms,
        config.max_retries,
      );

      const json = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string };
          logprobs?: { content?: Array<{ logprob?: number }> };
        }>;
      };

      const rawContent = json.choices?.[0]?.message?.content;
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

      // Check citations requested
      const citationsRequested = Boolean(
        parsed.citations_requested ||
          (Array.isArray(parsed.citations) && parsed.citations.length > 0),
      );

      // Extract logprobs if available
      const logprobs: number[] = [];
      const choiceLogprobs = json.choices?.[0]?.logprobs?.content;
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
    }

    throw new ModelSchemaViolationError(
      route,
      "Failed to produce valid schema conforming response after retry",
    );
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    const route = "VISION_MODEL";
    const config = this.visionConfig;
    const endpoint = config.endpoint || "https://api.mistral.ai";
    const url = `${endpoint.replace(/\/+$/, "")}/v1/chat/completions`;

    const imageUrl = args.image_or_pdf_ref.startsWith("data:")
      ? args.image_or_pdf_ref
      : `data:image/jpeg;base64,${args.image_or_pdf_ref}`;

    const body = {
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
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    const res = await this.fetchWithRetry(
      route,
      url,
      headers,
      body,
      config.timeout_ms,
      config.max_retries,
    );

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = json.choices?.[0]?.message?.content ?? "{}";

    try {
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
      throw new ModelSchemaViolationError(
        route,
        `Vision model output is not valid JSON: ${String(err)}`,
      );
    }
  }

  async embed(args: EmbedArgs): Promise<EmbedResponse> {
    const route = "EMBEDDINGS_MODEL";
    const config = this.embeddingsConfig;
    const endpoint = config.endpoint || "https://api.mistral.ai";
    const url = `${endpoint.replace(/\/+$/, "")}/v1/embeddings`;

    const body = {
      model: config.model || "mistral-embed",
      input: args.texts,
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    const res = await this.fetchWithRetry(
      route,
      url,
      headers,
      body,
      config.timeout_ms,
      config.max_retries,
    );

    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    if (!Array.isArray(json.data) || json.data.length === 0) {
      throw new ModelUnavailableError(
        route,
        "Embeddings API returned invalid data payload",
      );
    }

    const vectors = json.data.map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new ModelUnavailableError(
          route,
          "Embeddings API item is missing embedding vector",
        );
      }
      return item.embedding;
    });

    return { vectors };
  }

  async rerank(args: RerankArgs): Promise<RerankResponse> {
    const route = "RERANKER_MODEL";
    const config = this.rerankerConfig;

    if (args.passages.length === 0) {
      return { ranked: [] };
    }

    // If Cohere provider is configured and API key exists, call Cohere Rerank
    if (config.provider.toLowerCase() === "cohere" && this.cohereApiKey) {
      const endpoint = config.endpoint || "https://api.cohere.com";
      const url = `${endpoint.replace(/\/+$/, "")}/v2/rerank`;
      const body = {
        model: config.model || "rerank-v3.5",
        query: args.query,
        documents: args.passages.map((p) => p.text),
        top_n: args.passages.length,
      };

      const res = await this.fetchWithRetry(
        route,
        url,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cohereApiKey}`,
        },
        body,
        config.timeout_ms,
        config.max_retries,
      );

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
    }

    // Default Mistral LLM-Rank / Embedding similarity fallback per user configuration
    // 1. Generate query embedding
    const queryEmbRes = await this.embed({ texts: [args.query] });
    const queryVector = queryEmbRes.vectors[0];
    if (!queryVector) {
      throw new ModelUnavailableError(
        route,
        "Failed to compute query vector for reranking",
      );
    }

    // 2. Generate passage embeddings in batch
    const passageTexts = args.passages.map((p) => p.text);
    const passEmbRes = await this.embed({ texts: passageTexts });

    // 3. Compute hybrid cross-encoder relevance score (semantic cosine + keyword match)
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

    // Sort descending by score
    scoredPassages.sort((a, b) => b.score - a.score);

    const ranked: RankedPassage[] = scoredPassages.map((item, rankIdx) => ({
      ...item.passage,
      score: Number(item.score.toFixed(4)),
      rank: rankIdx + 1,
    }));

    return { ranked };
  }
}
