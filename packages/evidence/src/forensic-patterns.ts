import crypto from "node:crypto";
import net from "node:net";
import { AttachmentRejectedError } from "@pims/types/errors.ts";
import { parse as parseDomain } from "tldts";

const ACCEPTED_HASH_LENGTHS: ReadonlySet<number> = new Set([32, 40, 64]);

export function sha256HexBytes(data: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function isDelimiter(code: number): boolean {
  return (
    code <= 32 ||
    code === 34 || // "
    code === 39 || // '
    code === 40 || // (
    code === 41 || // )
    code === 44 || // ,
    code === 59 || // ;
    code === 60 || // <
    code === 62 || // >
    code === 91 || // [
    code === 92 || // \
    code === 93 || // ]
    code === 123 || // {
    code === 124 || // |
    code === 125 // }
  );
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isDelimiter(code)) {
      if (start !== -1) {
        tokens.push(text.slice(start, i));
        start = -1;
      }
    } else {
      if (start === -1) {
        start = i;
      }
    }
  }
  if (start !== -1) {
    tokens.push(text.slice(start));
  }
  return tokens;
}

function isHex(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57; // 0-9
    const isLower = code >= 97 && code <= 102; // a-f
    const isUpper = code >= 65 && code <= 70; // A-F
    if (!isDigit && !isLower && !isUpper) {
      return false;
    }
  }
  return true;
}

function trimPunctuation(str: string): string {
  let start = 0;
  let end = str.length;
  while (
    start < end &&
    (str.charCodeAt(start) === 46 || str.charCodeAt(start) === 58)
  ) {
    start++;
  }
  while (
    end > start &&
    (str.charCodeAt(end - 1) === 46 || str.charCodeAt(end - 1) === 58)
  ) {
    end--;
  }
  return str.slice(start, end);
}

export function extractIocs(text: string): string[] {
  const found = new Set<string>();
  const tokens = tokenize(text);

  for (const rawToken of tokens) {
    const clean = trimPunctuation(rawToken);
    if (clean.length === 0) {
      continue;
    }

    if (net.isIP(clean) !== 0) {
      found.add(clean);
      continue;
    }

    if (ACCEPTED_HASH_LENGTHS.has(clean.length) && isHex(clean)) {
      found.add(clean.toLowerCase());
      continue;
    }

    if (!clean.includes("@") && clean.includes(".")) {
      const parsed = parseDomain(clean, {
        allowPrivateDomains: true,
        detectSpecialUse: true,
        validateHostname: true,
      });
      if (
        parsed.hostname !== null &&
        parsed.isIp === false &&
        (parsed.isIcann === true ||
          parsed.isPrivate === true ||
          parsed.isSpecialUse === true)
      ) {
        found.add(parsed.hostname);
      }
    }
  }

  return Array.from(found);
}

export function decodeUtf8(data: Buffer): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new AttachmentRejectedError("invalid_utf8");
    }
    throw error;
  }
  if (decoded.includes("\u0000")) {
    throw new AttachmentRejectedError("binary_txt");
  }
  return decoded;
}
