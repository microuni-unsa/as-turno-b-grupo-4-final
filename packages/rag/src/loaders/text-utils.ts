import { RagIndexError } from "@pims/types/errors.ts";

function isAsciiWhitespace(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20
  );
}

export function normalizeLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

export function countApproxTokens(text: string): number {
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isAsciiWhitespace(code)) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  return Math.max(1, Math.round(words * 1.3));
}

export function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isAsciiWhitespace(code)) {
      if (current !== "") {
        words.push(current);
        current = "";
      }
    } else {
      current += text.charAt(i);
    }
  }
  if (current !== "") {
    words.push(current);
  }
  return words;
}

export function slugifyStem(stem: string): string {
  const lower = stem.toLowerCase();
  let out = "";
  let lastWasDash = false;
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    const isDash = code === 0x2d;
    const isLowerAlpha = code >= 0x61 && code <= 0x7a;
    const isDigit = code >= 0x30 && code <= 0x39;
    const isUnderscore = code === 0x5f;
    if (isDash) {
      if (!lastWasDash) {
        out += "-";
        lastWasDash = true;
      }
    } else if (isLowerAlpha || isDigit || isUnderscore) {
      out += lower.charAt(i);
      lastWasDash = false;
    } else if (!lastWasDash) {
      out += "-";
      lastWasDash = true;
    }
  }
  let start = 0;
  let end = out.length;
  while (start < end && out.charCodeAt(start) === 0x2d) {
    start++;
  }
  while (end > start && out.charCodeAt(end - 1) === 0x2d) {
    end--;
  }
  const trimmed = out.slice(start, end);
  if (trimmed === "") {
    throw new RagIndexError("slugifyStem produced empty doc_id");
  }
  return trimmed;
}

export interface TrimmedSectionLines {
  lines: string[];
  startLine: number;
}
export function trimBlankEdges(
  lines: string[],
  startLine: number,
): TrimmedSectionLines {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") {
    start++;
  }
  while (end > start && (lines[end - 1] ?? "").trim() === "") {
    end--;
  }
  return { lines: lines.slice(start, end), startLine: startLine + start };
}
