import {
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types";

export interface PlainLanguageValidationOptions {
  allowSubjectCounts?: boolean;
  plainLanguageWaiver?: boolean;
}

export class PlainLanguageValidator {
  constructor(
    private readonly defaultOptions?: PlainLanguageValidationOptions,
  ) {}

  validate(text: string, options?: PlainLanguageValidationOptions): void {
    PlainLanguageValidator.validate(text, options ?? this.defaultOptions);
  }

  static splitSentences(text: string): string[] {
    const DOT_PLACEHOLDER = "___PIMS_DOT___";
    const protectedText = text
      .replace(
        /(?:\b(?:art|inc|dr|sra?|lic|vs|etc)\.|\b(?:e\.g|i\.e|p\.\s*ej)\.)/gi,
        (match) => match.replace(/\./g, DOT_PLACEHOLDER),
      )
      .replace(/(\d)\.(\d)/g, `$1${DOT_PLACEHOLDER}$2`);

    return protectedText
      .split(/[.!?\r\n]+/)
      .map((segment) =>
        segment.replace(new RegExp(DOT_PLACEHOLDER, "g"), ".").trim(),
      )
      .filter((segment) => segment.length > 0);
  }

  static countWords(sentence: string): number {
    const tokens = sentence.trim().split(/\s+/);
    return tokens.filter((token) => token.length > 0).length;
  }

  static validate(
    text: string,
    options?: PlainLanguageValidationOptions,
  ): void {
    const sentences = PlainLanguageValidator.splitSentences(text);

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (!sentence) {
        continue;
      }
      const wordCount = PlainLanguageValidator.countWords(sentence);
      if (wordCount > 25 && !options?.plainLanguageWaiver) {
        throw new PlainLanguageViolationError(i + 1, wordCount);
      }
    }

    if (!options?.allowSubjectCounts) {
      const forbiddenPatterns = [
        /\b\d{1,3}(?:[.,]\d{3})*\s*(?:usuarios|personas|sujetos|individuos|titulares|afectados|víctimas|registros|cuentas|users|subjects|people|records|individuals|victims|accounts)\b/i,
        /\b(?:usuarios|personas|sujetos|individuos|titulares|afectados|víctimas|registros|cuentas|users|subjects|people|records|individuals|victims|accounts)\s*(?:afectados|involucrados)?\s*[:=]?\s*\d{1,3}(?:[.,]\d{3})*\b/i,
        /(?:afectó\s+a|involucra\s+a|affecting|involving)\s*\d+/i,
      ];

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          throw new SubjectCountForbiddenError();
        }
      }
    }
  }
}
