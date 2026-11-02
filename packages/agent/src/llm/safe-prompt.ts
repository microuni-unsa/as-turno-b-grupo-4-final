import net from "node:net";
import { extractIocs, extractPii } from "@pims/evidence/forensic-patterns.ts";
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

const REDACTION_TOKEN_PATTERN =
  /^\[(?:REPORTANTE|CONTACTO|ID|SISTEMA|DESCRIPCION)\]$/;

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

function collectHits(text: string): PiiHit[] {
  const hits: PiiHit[] = [];

  for (const value of extractIocs(text)) {
    if (/^[0-9a-fA-F]{32,64}$/.test(value)) {
      continue;
    }
    const isIp = net.isIP(value) !== 0;
    hits.push({ category: isIp ? "ip" : "hostname", value });
  }

  for (const value of extractPii(text)) {
    if (REDACTION_TOKEN_PATTERN.test(value)) {
      continue;
    }
    let category: PiiCategory = "email";
    if (value.includes("@")) {
      category = "email";
    } else if (value.startsWith("+")) {
      category = "phone";
    } else if (/^[XYZxyz\d]/.test(value)) {
      category = "dni";
    }
    hits.push({ category, value });
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

export function redactOptionalForPrompt(
  value: string | null | undefined,
): string | null {
  return value === null || value === undefined ? null : redactForPrompt(value);
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
