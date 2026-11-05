import {
  type PresidioRecognizerResult,
  PresidioRecognizerResultSchema,
} from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";
import { PiiRedactionUnavailableError } from "@pims/types/errors.ts";
import { z } from "zod";

export interface PresidioClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  minScore?: number;
}

export const ENTITY_TOKEN_MAP: Record<string, string> = {
  PERSON: "[REPORTANTE]",
  EMAIL_ADDRESS: "[CONTACTO]",
  PHONE_NUMBER: "[CONTACTO]",
  ES_NIF: "[ID]",
  ES_NIE: "[ID]",
  PE_DNI: "[ID]",
  PE_RUC: "[ID]",
  ES_PASSPORT: "[ID]",
  URL: "[SISTEMA]",
  IP_ADDRESS: "[SISTEMA]",
  LOCATION: "[SISTEMA]",
};

export function tokenForEntity(entityType: string): string {
  const token = ENTITY_TOKEN_MAP[entityType];
  if (token !== undefined) {
    return token;
  }
  return "[DESCRIPCION]";
}

export class PresidioClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly minScore: number;

  constructor(options: PresidioClientOptions) {
    if (!options.baseUrl || options.baseUrl.trim().length === 0) {
      throw new Error("Presidio baseUrl is required and cannot be empty");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs =
      options.timeoutMs !== undefined
        ? options.timeoutMs
        : CONSTANTS.PRESIDIO_TIMEOUT_MS;
    this.minScore =
      options.minScore !== undefined
        ? options.minScore
        : CONSTANTS.PRESIDIO_MIN_SCORE;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 2000)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async analyze(text: string): Promise<PresidioRecognizerResult[]> {
    if (!text || text.trim() === "") {
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          language: "es",
          score_threshold: this.minScore,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Presidio analyze returned HTTP ${response.status}: ${errorText}`,
        );
      }

      const raw = await response.json();
      const parsed = z.array(PresidioRecognizerResultSchema).safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Presidio response schema validation failed: ${parsed.error.message}`,
        );
      }

      return parsed.data.filter((span) => span.score >= this.minScore);
    } catch (error) {
      if (error instanceof PiiRedactionUnavailableError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Presidio request failed";
      throw new PiiRedactionUnavailableError(
        `PII_REDACTION_UNAVAILABLE: ${message}`,
      );
    }
  }

  async redact(
    text: string,
  ): Promise<{ redactedText: string; spans: PresidioRecognizerResult[] }> {
    if (!text) {
      return { redactedText: text, spans: [] };
    }

    const spans = await this.analyze(text);
    if (spans.length === 0) {
      return { redactedText: text, spans: [] };
    }

    // Spec §11.3: longest-span-first over exact analyzer offsets
    const sorted = [...spans].sort((a, b) => {
      const lenDiff = b.end - b.start - (a.end - a.start);
      if (lenDiff !== 0) {
        return lenDiff;
      }
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.start - b.start;
    });

    // Select non-overlapping spans greedily based on longest span
    const selected: PresidioRecognizerResult[] = [];
    for (const span of sorted) {
      const overlaps = selected.some(
        (existing) =>
          Math.max(span.start, existing.start) <
          Math.min(span.end, existing.end),
      );
      if (!overlaps) {
        selected.push(span);
      }
    }

    // Sort by start descending to replace from right to left preserving offsets
    selected.sort((a, b) => b.start - a.start);

    let redacted = text;
    for (const span of selected) {
      const replacement = tokenForEntity(span.entity_type);
      redacted =
        redacted.slice(0, span.start) + replacement + redacted.slice(span.end);
    }

    return { redactedText: redacted, spans: selected };
  }
}
