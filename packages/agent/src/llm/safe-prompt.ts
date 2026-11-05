import net from "node:net";
import type { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import { PII_PHONE_REGIONS } from "@pims/types/constants.ts";
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
  if (!text) {
    return text;
  }
  const presidio = client ?? globalPresidioClient;
  if (!presidio) {
    throw new PiiRedactionUnavailableError(
      "Presidio analyzer client is required for prompt redaction",
    );
  }
  const result = await presidio.redact(text);
  return result.redactedText;
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

const emailValidator = z.string().email();

export function assertPromptSafe(
  systemOrText: string,
  messages?: Message[],
): void {
  const combined = [
    systemOrText,
    ...(messages ?? []).map((message) => message.content),
  ].join("\n");

  const categories = new Set<PiiCategory>();

  // 1. Phone validation via formal libphonenumber-js
  for (const region of PII_PHONE_REGIONS) {
    try {
      for (const match of findPhoneNumbersInText(combined, region)) {
        if (match.number.isValid()) {
          categories.add("phone");
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Email, IP, URL/hostname validation via formal libs
  const words = combined.split(/[\s,;"'()<>[\]{}]+/);
  for (const word of words) {
    const clean = word.trim();
    if (!clean || clean.startsWith("[")) {
      continue;
    }

    if (clean.includes("@")) {
      if (emailValidator.safeParse(clean).success) {
        categories.add("email");
      }
    }

    if (net.isIP(clean) !== 0 && clean !== "127.0.0.1" && clean !== "0.0.0.0") {
      categories.add("ip");
    }

    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      categories.add("url");
    } else if (clean.includes(".") && !clean.endsWith(".")) {
      const parsed = parse(clean);
      if (parsed.isIp) {
        categories.add("ip");
      } else if (parsed.domain && parsed.isIcann && parsed.publicSuffix) {
        // Only trigger if valid ICANN domain with recognized public suffix
        categories.add("hostname");
      }
    }

    if (/^\d{8}$/.test(clean)) {
      categories.add("dni");
    }
    if (/^(10|15|17|20)\d{9}$/.test(clean)) {
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
    this.presidio = presidio ?? globalPresidioClient;
  }

  getPresidioClient(): PresidioClient | null {
    return this.presidio;
  }

  private async redactText(text: string): Promise<string> {
    if (!text) {
      return text;
    }
    if (this.presidio) {
      const res = await this.presidio.redact(text);
      return res.redactedText;
    }
    throw new PiiRedactionUnavailableError(
      "Presidio analyzer client is required for model calls",
    );
  }

  async chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse> {
    const redactedSystem = await this.redactText(args.system);
    const redactedMessages = await Promise.all(
      args.messages.map(async (msg) => ({
        ...msg,
        content: await this.redactText(msg.content),
      })),
    );

    assertPromptSafe(redactedSystem, redactedMessages);
    return this.inner.chat_json({
      ...args,
      system: redactedSystem,
      messages: redactedMessages,
    });
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    const redactedSystem = await this.redactText(args.system);
    const redactedPrompt = await this.redactText(args.prompt);

    assertPromptSafe(redactedSystem, [
      { role: "user", content: redactedPrompt },
    ]);
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
    for (const text of redactedTexts) {
      assertPromptSafe("", [{ role: "user", content: text }]);
    }
    return this.inner.embed({
      texts: redactedTexts,
    });
  }

  async rerank(args: RerankArgs): Promise<RerankResponse> {
    const redactedQuery = await this.redactText(args.query);
    assertPromptSafe("", [{ role: "user", content: redactedQuery }]);
    return this.inner.rerank({
      query: redactedQuery,
      passages: args.passages,
    });
  }
}
