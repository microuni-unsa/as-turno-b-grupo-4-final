import net from "node:net";
import { PII_PHONE_REGIONS } from "@pims/types/constants.ts";
import { AttachmentRejectedError } from "@pims/types/errors.ts";
import { findPhoneNumbersInText } from "libphonenumber-js";
import { parse as parseDomain } from "tldts";
import { z } from "zod";

const IPV4_CANDIDATE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_CANDIDATE = /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/;
const DOMAIN_CANDIDATE =
  /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/;
const EMAIL_CANDIDATE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const DNI_NIE_CANDIDATE = /\b(?:[XYZxyz]\d{7}|\d{8})[A-Za-z]\b/;
const HASH_CANDIDATE = /\b[a-fA-F0-9]{32,64}\b/;
const PII_TOKEN_CANDIDATE =
  /\[(?:REPORTANTE|CONTACTO|ID|SISTEMA|DESCRIPCION)\]/;

const SPANISH_ID_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const ACCEPTED_HASH_LENGTHS: ReadonlySet<number> = new Set([32, 40, 64]);
const NIE_PREFIX_DIGITS: Record<string, string> = { X: "0", Y: "1", Z: "2" };
const EMAIL_SCHEMA = z.string().email();

function collectAll(pattern: RegExp, text: string): RegExpExecArray[] {
  return Array.from(text.matchAll(new RegExp(pattern.source, "g")));
}

function isValidSpanishId(value: string): boolean {
  const normalized = value.toUpperCase();
  const dniMatch = /^(\d{8})([A-Z])$/.exec(normalized);
  const nieMatch = /^([XYZ])(\d{7})([A-Z])$/.exec(normalized);

  let number: string;
  let letter: string;
  if (dniMatch?.[1] !== undefined && dniMatch[2] !== undefined) {
    number = dniMatch[1];
    letter = dniMatch[2];
  } else if (
    nieMatch?.[1] !== undefined &&
    nieMatch[2] !== undefined &&
    nieMatch[3] !== undefined
  ) {
    const prefix = NIE_PREFIX_DIGITS[nieMatch[1]];
    if (prefix === undefined) {
      return false;
    }
    number = `${prefix}${nieMatch[2]}`;
    letter = nieMatch[3];
  } else {
    return false;
  }

  const expected = SPANISH_ID_LETTERS[Number(number) % 23];
  return expected === letter;
}

function isInsideSpan(index: number, spans: RegExpExecArray[]): boolean {
  return spans.some(
    (span) => index >= span.index && index < span.index + span[0].length,
  );
}

export function extractIocs(text: string): string[] {
  const found = new Set<string>();

  for (const pattern of [IPV4_CANDIDATE, IPV6_CANDIDATE]) {
    for (const match of collectAll(pattern, text)) {
      if (net.isIP(match[0]) !== 0) {
        found.add(match[0]);
      }
    }
  }

  const emailSpans = collectAll(EMAIL_CANDIDATE, text);
  for (const match of collectAll(DOMAIN_CANDIDATE, text)) {
    const index = match.index;
    if (text[index - 1] === "@" || isInsideSpan(index, emailSpans)) {
      continue;
    }
    const parsed = parseDomain(match[0], {
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

  for (const match of collectAll(HASH_CANDIDATE, text)) {
    const candidate = match[0];
    if (
      ACCEPTED_HASH_LENGTHS.has(candidate.length) &&
      Buffer.from(candidate, "hex").length === candidate.length / 2
    ) {
      found.add(candidate.toLowerCase());
    }
  }

  return Array.from(found);
}

export function extractPii(text: string): string[] {
  const found = new Set<string>();

  for (const match of collectAll(EMAIL_CANDIDATE, text)) {
    if (EMAIL_SCHEMA.safeParse(match[0]).success) {
      found.add(match[0]);
    }
  }

  for (const match of collectAll(DNI_NIE_CANDIDATE, text)) {
    if (isValidSpanishId(match[0])) {
      found.add(match[0].toUpperCase());
    }
  }

  const ipSpans = [
    ...collectAll(IPV4_CANDIDATE, text),
    ...collectAll(IPV6_CANDIDATE, text),
  ].filter((span) => net.isIP(span[0]) !== 0);

  for (const region of PII_PHONE_REGIONS) {
    for (const match of findPhoneNumbersInText(text, region)) {
      const overlapsIp = ipSpans.some(
        (span) =>
          match.startsAt < span.index + span[0].length &&
          span.index < match.endsAt,
      );
      if (!overlapsIp && match.number.isValid()) {
        found.add(match.number.number);
      }
    }
  }

  for (const match of collectAll(PII_TOKEN_CANDIDATE, text)) {
    found.add(match[0]);
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
