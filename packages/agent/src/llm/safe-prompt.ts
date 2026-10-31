import { extractIocs, extractPii } from "@pims/evidence/forensic-patterns.ts";
import { PII_PHONE_REGIONS } from "@pims/types/constants.ts";
import { PromptPiiBlockedError } from "@pims/types/errors.ts";
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

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DNI_PATTERN = /(?<!\d)\d{8}(?!\d)/g;
const RUC_PATTERN = /(?<!\d)(?:10|15|17|20)\d{9}(?!\d)/g;
const REDACTION_TOKEN_PATTERN =
  /^\[(?:REPORTANTE|CONTACTO|ID|SISTEMA|DESCRIPCION)\]$/;
const HEX_DIGEST_PATTERN = /^[0-9a-fA-F]{32,64}$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const REDACTION_TOKENS = {
  contact: "[CONTACTO]",
  id: "[ID]",
  system: "[SISTEMA]",
} as const;

export type PiiCategory = "email" | "phone" | "dni" | "ruc" | "ip" | "hostname";

interface PiiHit {
  category: PiiCategory;
  value: string;
}

function collectMatches(pattern: RegExp, text: string): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

function collectHits(text: string): PiiHit[] {
  const hits: PiiHit[] = [];

  for (const value of collectMatches(EMAIL_PATTERN, text)) {
    hits.push({ category: "email", value });
  }

  for (const region of PII_PHONE_REGIONS) {
    for (const match of findPhoneNumbersInText(text, region)) {
      if (match.number.isValid()) {
        hits.push({ category: "phone", value: match.number.number });
      }
    }
  }

  for (const value of collectMatches(RUC_PATTERN, text)) {
    hits.push({ category: "ruc", value });
  }

  for (const value of collectMatches(DNI_PATTERN, text)) {
    hits.push({ category: "dni", value });
  }

  for (const value of extractIocs(text)) {
    if (HEX_DIGEST_PATTERN.test(value)) {
      continue;
    }
    const isIp = value.includes(":") || IPV4_PATTERN.test(value);
    hits.push({ category: isIp ? "ip" : "hostname", value });
  }

  for (const value of extractPii(text)) {
    if (REDACTION_TOKEN_PATTERN.test(value)) {
      continue;
    }
    const alreadyCovered = hits.some((hit) => hit.value === value);
    if (!alreadyCovered) {
      hits.push({ category: "email", value });
    }
  }

  return hits;
}

function tokenFor(category: PiiCategory): string {
  if (category === "email" || category === "phone") {
    return REDACTION_TOKENS.contact;
  }
  if (category === "dni" || category === "ruc") {
    return REDACTION_TOKENS.id;
  }
  return REDACTION_TOKENS.system;
}

export function redactForPrompt(text: string): string {
  const hits = collectHits(text).sort(
    (a, b) => b.value.length - a.value.length,
  );

  let redacted = text;
  for (const hit of hits) {
    redacted = redacted.split(hit.value).join(tokenFor(hit.category));
  }
  return redacted;
}

export function assertPromptSafe(system: string, messages: Message[]): void {
  const combined = [system, ...messages.map((message) => message.content)].join(
    "\n",
  );

  const categories = new Set<PiiCategory>();
  for (const hit of collectHits(combined)) {
    categories.add(hit.category);
  }

  if (categories.size > 0) {
    throw new PromptPiiBlockedError(Array.from(categories).sort());
  }
}

export class AgentModelClient implements ModelProvider {
  private readonly inner: ModelProvider;

  constructor(inner: ModelProvider) {
    this.inner = inner;
  }

  async chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse> {
    assertPromptSafe(args.system, args.messages);
    return this.inner.chat_json(args);
  }

  async vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse> {
    assertPromptSafe(args.system, [{ role: "user", content: args.prompt }]);
    return this.inner.vision_json(args);
  }

  async embed(args: EmbedArgs): Promise<EmbedResponse> {
    return this.inner.embed({
      texts: args.texts.map((text) => redactForPrompt(text)),
    });
  }

  async rerank(args: RerankArgs): Promise<RerankResponse> {
    return this.inner.rerank({
      query: redactForPrompt(args.query),
      passages: args.passages,
    });
  }
}
