import type { PresidioRecognizerResult } from "@pims/types/cockpit.ts";
import { CONSTANTS } from "@pims/types/constants.ts";

export function filterAuthenticPiiSpans(
  text: string,
  rawSpans: readonly PresidioRecognizerResult[],
): PresidioRecognizerResult[] {
  return rawSpans.filter((span) => {
    if (
      !(CONSTANTS.PII_ENTITIES as readonly string[]).includes(
        span.entity_type,
      ) ||
      span.score < CONSTANTS.PRESIDIO_MIN_SCORE
    ) {
      return false;
    }

    // False positive guard: Check if span is embedded in an alphanumeric word/hash/UUID (technical token)
    const charBefore = span.start > 0 ? (text[span.start - 1] ?? "") : "";
    const charAfter = span.end < text.length ? (text[span.end] ?? "") : "";
    if (
      (charBefore !== "" && /[a-zA-Z0-9]/.test(charBefore)) ||
      (charAfter !== "" && /[a-zA-Z0-9]/.test(charAfter))
    ) {
      return false;
    }

    // Check if span is strictly inside a hex hash (16 to 64 chars)
    const hexHashRegex = /\b[0-9a-fA-F]{16,64}\b/g;
    let match: RegExpExecArray | null = hexHashRegex.exec(text);
    while (match !== null) {
      if (
        span.start >= match.index &&
        span.end <= match.index + match[0].length
      ) {
        return false;
      }
      match = hexHashRegex.exec(text);
    }

    // Check if span is strictly inside a UUID
    const uuidRegex =
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
    let uuidMatch: RegExpExecArray | null = uuidRegex.exec(text);
    while (uuidMatch !== null) {
      if (
        span.start >= uuidMatch.index &&
        span.end <= uuidMatch.index + uuidMatch[0].length
      ) {
        return false;
      }
      uuidMatch = uuidRegex.exec(text);
    }

    // False positive guard: Known non-PII terms misclassified as PERSON
    if (span.entity_type === "PERSON") {
      const lower = text.slice(span.start, span.end).trim().toLowerCase();
      if (
        (CONSTANTS.PII_EXCLUDED_PERSON_TERMS as readonly string[]).includes(
          lower,
        )
      ) {
        return false;
      }
    }

    return true;
  });
}
