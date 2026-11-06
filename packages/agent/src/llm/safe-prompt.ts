import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import { PiiRedactionUnavailableError } from "@pims/types/errors.ts";
import type {
  ChatJsonArgs,
  ChatJsonResponse,
  EmbedArgs,
  EmbedResponse,
  Message,
  ModelProvider,
  RerankArgs,
  RerankResponse,
  VisionJsonArgs,
  VisionJsonResponse,
} from "@pims/types/models.ts";

let globalPresidioClient: PresidioClient | null = null;

export function setGlobalPresidioClient(client: PresidioClient | null): void {
  globalPresidioClient = client;
}

export function getGlobalPresidioClient(): PresidioClient | null {
  return globalPresidioClient;
}

export async function redactForPrompt(
  text: string,
  client?: PresidioClient | null,
): Promise<string> {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }
  const presidio =
    client !== undefined && client !== null ? client : globalPresidioClient;
  if (!presidio) {
    throw new PiiRedactionUnavailableError(
      "PII_REDACTION_UNAVAILABLE: Presidio analyzer client is required for prompt redaction",
    );
  }
  try {
    const result = await presidio.redact(text);
    return result.redactedText;
  } catch (err: unknown) {
    if (err instanceof PiiRedactionUnavailableError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new PiiRedactionUnavailableError(`PII_REDACTION_UNAVAILABLE: ${msg}`);
  }
}

export async function redactOptionalForPrompt(
  value: string | null | undefined,
  client?: PresidioClient | null,
): Promise<string | null> {
  if (value === null || value === undefined) {
    return null;
  }
  return redactForPrompt(value, client);
}

export interface RedactChatPayloadInput {
  system: string;
  messages: Message[];
}

export async function redactChatPayload(
  payload: RedactChatPayloadInput,
  client?: PresidioClient | null,
): Promise<{ system: string; messages: Message[] }> {
  if (!payload || typeof payload !== "object") {
    throw new PiiRedactionUnavailableError(
      "PII_REDACTION_UNAVAILABLE: Chat payload must be an object",
    );
  }
  if (typeof payload.system !== "string") {
    throw new PiiRedactionUnavailableError(
      "PII_REDACTION_UNAVAILABLE: System prompt must be a string",
    );
  }
  if (!Array.isArray(payload.messages)) {
    throw new PiiRedactionUnavailableError(
      "PII_REDACTION_UNAVAILABLE: Messages must be an array",
    );
  }

  const presidio =
    client !== undefined && client !== null ? client : globalPresidioClient;
  if (!presidio) {
    throw new PiiRedactionUnavailableError(
      "PII_REDACTION_UNAVAILABLE: Presidio analyzer client is required for chat payload redaction",
    );
  }

  try {
    const redactedSystem = await redactForPrompt(payload.system, presidio);
    const redactedMessages: Message[] = [];
    for (const msg of payload.messages) {
      if (!msg || typeof msg !== "object") {
        throw new PiiRedactionUnavailableError(
          "PII_REDACTION_UNAVAILABLE: Invalid message in chat payload",
        );
      }
      if (
        typeof msg.role !== "string" ||
        (msg.role !== "system" &&
          msg.role !== "user" &&
          msg.role !== "assistant")
      ) {
        throw new PiiRedactionUnavailableError(
          `PII_REDACTION_UNAVAILABLE: Invalid message role "${String((msg as unknown as Record<string, unknown>).role)}"`,
        );
      }
      if (typeof msg.content !== "string") {
        throw new PiiRedactionUnavailableError(
          "PII_REDACTION_UNAVAILABLE: Message content must be a string",
        );
      }
      const redactedContent = await redactForPrompt(msg.content, presidio);
      redactedMessages.push({
        role: msg.role,
        content: redactedContent,
      });
    }

    return {
      system: redactedSystem,
      messages: redactedMessages,
    };
  } catch (error: unknown) {
    if (error instanceof PiiRedactionUnavailableError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PiiRedactionUnavailableError(
      `PII_REDACTION_UNAVAILABLE: ${message}`,
    );
  }
}

export class AgentModelClient implements ModelProvider {
  private readonly inner: ModelProvider;
  private readonly presidio: PresidioClient | null;

  constructor(inner: ModelProvider, presidio?: PresidioClient | null) {
    this.inner = inner;
    this.presidio =
      presidio !== undefined && presidio !== null
        ? presidio
        : globalPresidioClient;
  }

  getPresidioClient(): PresidioClient | null {
    return this.presidio;
  }

  private async redactText(text: string): Promise<string> {
    if (!text || text.length === 0) {
      return text;
    }
    if (this.presidio !== null) {
      try {
        const res = await this.presidio.redact(text);
        return res.redactedText;
      } catch (err: unknown) {
        if (err instanceof PiiRedactionUnavailableError) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new PiiRedactionUnavailableError(
          `PII_REDACTION_UNAVAILABLE: ${msg}`,
        );
      }
    }
    throw new PiiRedactionUnavailableError(
      "PII_REDACTION_UNAVAILABLE: Presidio analyzer client is required for model calls",
    );
  }

  async chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse> {
    const redacted = await redactChatPayload(
      { system: args.system, messages: args.messages },
      this.presidio,
    );

    return this.inner.chat_json({
      ...args,
      system: redacted.system,
      messages: redacted.messages,
    });
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    const redactedSystem = await this.redactText(args.system);
    const redactedPrompt = await this.redactText(args.prompt);

    return this.inner.vision_json({
      ...args,
      system: redactedSystem,
      prompt: redactedPrompt,
    });
  }

  async embed(args: EmbedArgs): Promise<EmbedResponse> {
    const redactedTexts = await Promise.all(
      args.texts.map((text) => this.redactText(text)),
    );
    return this.inner.embed({
      texts: redactedTexts,
    });
  }

  async rerank(args: RerankArgs): Promise<RerankResponse> {
    const redactedQuery = await this.redactText(args.query);
    return this.inner.rerank({
      query: redactedQuery,
      passages: args.passages,
    });
  }
}
