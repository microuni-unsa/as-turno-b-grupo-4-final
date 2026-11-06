import net from "node:net";
import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  PiiRedactionUnavailableError,
  PromptPiiBlockedError,
} from "@pims/types/errors.ts";
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
import { findPhoneNumbersInText } from "libphonenumber-js";
import { parse } from "tldts";
import { z } from "zod";

export const REDACTION_TOKENS = {
  reporter: "[REPORTANTE]",
  contact: "[CONTACTO]",
  id: "[ID]",
  system: "[SISTEMA]",
  description: "[DESCRIPCION]",
} as const;

export type PiiCategory =
  | "email"
  | "phone"
  | "dni"
  | "ruc"
  | "ip"
  | "hostname"
  | "url";

const DNI_REGEX = /^\d{8}$/;
const RUC_REGEX = /^(?:10|15|17|20)\d{9}$/;
const WORD_SPLIT_REGEX = /[\s,;"'()<>[\]{}]+/;
const HTTP_PREFIX = "http://";
const HTTPS_PREFIX = "https://";
const LOOPBACK_IPV4_1 = "127.0.0.1";
const LOOPBACK_IPV4_2 = "0.0.0.0";

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

const emailValidator = z.string().email();

export function assertPromptSafe(
  systemOrText: string,
  messages?: Message[],
): void {
  const parts: string[] = [systemOrText];
  if (messages !== undefined && messages !== null) {
    for (const message of messages) {
      if (typeof message.content === "string") {
        parts.push(message.content);
      }
    }
  }
  const combined = parts.join("\n");

  const categories = new Set<PiiCategory>();

  // 1. Phone validation via formal libphonenumber-js
  for (const region of CONSTANTS.PII_PHONE_REGIONS) {
    try {
      for (const match of findPhoneNumbersInText(combined, region)) {
        const prevChar =
          match.startsAt > 0 ? combined.charCodeAt(match.startsAt - 1) : 0;
        const isInsideToken =
          prevChar === 58 /* ':' */ ||
          (prevChar >= 48 && prevChar <= 57) ||
          (prevChar >= 65 && prevChar <= 90) ||
          (prevChar >= 97 && prevChar <= 122);
        if (!isInsideToken && match.number.isValid()) {
          categories.add("phone");
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Email, IP, URL/hostname validation via formal libs
  const words = combined.split(WORD_SPLIT_REGEX);
  for (const word of words) {
    const clean = word.trim();
    if (clean.length === 0 || clean.charCodeAt(0) === 91 /* '[' */) {
      continue;
    }

    if (clean.indexOf("@") !== -1) {
      if (emailValidator.safeParse(clean).success) {
        categories.add("email");
      }
    }

    if (
      net.isIP(clean) !== 0 &&
      clean !== LOOPBACK_IPV4_1 &&
      clean !== LOOPBACK_IPV4_2
    ) {
      categories.add("ip");
    }

    if (clean.startsWith(HTTP_PREFIX) || clean.startsWith(HTTPS_PREFIX)) {
      categories.add("url");
    } else if (clean.indexOf(".") !== -1 && !clean.endsWith(".")) {
      const parsed = parse(clean);
      if (parsed.isIp) {
        categories.add("ip");
      } else if (parsed.domain && parsed.isIcann && parsed.publicSuffix) {
        // Only trigger if valid ICANN domain with recognized public suffix
        categories.add("hostname");
      }
    }

    if (DNI_REGEX.test(clean)) {
      categories.add("dni");
    }
    if (RUC_REGEX.test(clean)) {
      categories.add("ruc");
    }
  }

  if (categories.size > 0) {
    throw new PromptPiiBlockedError(Array.from(categories).sort());
  }
}

export class AgentModelClient implements ModelProvider {
  private readonly inner: ModelProvider;
  private readonly presidio: PresidioClient | null;

  static assertPromptSafe(systemOrText: string, messages?: Message[]): void {
    assertPromptSafe(systemOrText, messages);
  }

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
