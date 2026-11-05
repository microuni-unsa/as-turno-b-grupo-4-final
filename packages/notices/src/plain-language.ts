import {
  type PlainLanguageValidationOptions,
  PlainLanguageValidationOptionsSchema,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types";
import { CONSTANTS } from "@pims/types/constants.ts";

const NON_TERMINAL_ABBREVIATIONS = [
  "art",
  "art.",
  "inc",
  "inc.",
  "dr",
  "dr.",
  "dra",
  "dra.",
  "sr",
  "sr.",
  "sra",
  "sra.",
  "lic",
  "lic.",
  "vs",
  "vs.",
  "etc",
  "etc.",
  "e.g",
  "e.g.",
  "i.e",
  "i.e.",
  "p. ej",
  "p. ej.",
  "p.ej",
  "p.ej.",
  "n.º",
  "núm",
  "núm.",
  "ee. uu",
  "ee. uu.",
  "s.a",
  "s.a.",
  "s.l",
  "s.l.",
  "ud",
  "ud.",
  "uds",
  "uds.",
] as const;

const NUMERIC_LITERAL_PATTERN =
  "\\d{1,3}(?:[.,\\u00A0\\u202F ]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?";

const TRAILING_PUNCTUATION = /[.!?]+$/;

function endsWithNonTerminalAbbreviation(segment: string): boolean {
  const normalized = segment.toLowerCase().replace(/\s+/g, " ").trimEnd();
  return NON_TERMINAL_ABBREVIATIONS.some((abbreviation) => {
    if (!normalized.endsWith(abbreviation)) {
      return false;
    }
    const boundary = normalized.length - abbreviation.length;
    return boundary === 0 || normalized[boundary - 1] === " ";
  });
}

function findNumericLiterals(text: string): string[] {
  const pattern = new RegExp(NUMERIC_LITERAL_PATTERN, "g");
  return Array.from(text.matchAll(pattern), (match) =>
    match[0].replace(/[\u00A0\u202F]/g, " "),
  );
}

export class PlainLanguageValidator {
  constructor(
    private readonly defaultOptions?: PlainLanguageValidationOptions,
  ) {}

  validate(text: string, options?: PlainLanguageValidationOptions): void {
    PlainLanguageValidator.validate(text, {
      ...this.defaultOptions,
      ...options,
    });
  }

  static splitSentences(text: string, locale: "es" | "en" = "es"): string[] {
    const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
    const segments = Array.from(segmenter.segment(text), (part) =>
      part.segment.trim(),
    ).filter((segment) => segment.length > 0);

    const merged: string[] = [];
    for (const segment of segments) {
      const previous = merged[merged.length - 1];
      if (previous !== undefined && endsWithNonTerminalAbbreviation(previous)) {
        merged[merged.length - 1] = `${previous} ${segment}`;
        continue;
      }
      merged.push(segment);
    }

    return merged
      .map((segment) => segment.replace(TRAILING_PUNCTUATION, "").trim())
      .filter((segment) => segment.length > 0);
  }

  static countWords(sentence: string): number {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    let count = 0;
    for (const part of segmenter.segment(sentence)) {
      if (part.isWordLike) {
        count += 1;
      }
    }
    return count;
  }

  static validate(
    text: string,
    options?: PlainLanguageValidationOptions,
  ): void {
    const opts = PlainLanguageValidationOptionsSchema.parse(options ?? {});
    const maxWords = opts.maxWords ?? CONSTANTS.PLAIN_LANGUAGE_MAX_WORDS;

    if (!opts.plainLanguageWaiver) {
      const sentences = PlainLanguageValidator.splitSentences(
        text,
        opts.locale ?? "es",
      );
      for (let index = 0; index < sentences.length; index++) {
        const sentence = sentences[index];
        if (sentence === undefined || sentence.length === 0) {
          continue;
        }
        const wordCount = PlainLanguageValidator.countWords(sentence);
        if (wordCount > maxWords) {
          throw new PlainLanguageViolationError(index + 1, wordCount, maxWords);
        }
      }
    }

    const occurrences = new Map<string, number>();
    const literals = findNumericLiterals(text);
    for (let index = 0; index < literals.length; index++) {
      const value = literals[index];
      if (value === undefined) {
        continue;
      }
      const occurrence = occurrences.get(value) ?? 0;
      occurrences.set(value, occurrence + 1);
      const approved =
        opts.numericApprovals?.some(
          (approval) =>
            approval.value === value && approval.occurrence === occurrence,
        ) === true;
      if (!approved) {
        throw new SubjectCountForbiddenError(undefined, {
          value,
          occurrence,
          index,
          reason: "NUMERIC_CONTENT_UNAPPROVED",
        });
      }
    }
  }
}
