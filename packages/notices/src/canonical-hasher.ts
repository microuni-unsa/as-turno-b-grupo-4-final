import crypto from "node:crypto";

const ENVELOPE_KEYS_TO_STRIP = new Set([
  "state",
  "review_approval_id",
  "submitted_at_utc",
]);

function cleanAndSort(val: unknown): unknown {
  if (val === null || typeof val !== "object") {
    return val;
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (Array.isArray(val)) {
    return val.map((item) => cleanAndSort(item));
  }

  const record = val as Record<string, unknown>;
  const sortedKeys = Object.keys(record)
    .filter((key) => !ENVELOPE_KEYS_TO_STRIP.has(key))
    .sort();

  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const propValue = record[key];
    if (propValue !== undefined) {
      sortedObj[key] = cleanAndSort(propValue);
    }
  }

  return sortedObj;
}

export function canonicalizeJson(obj: unknown): string {
  const normalized = cleanAndSort(obj);
  return JSON.stringify(normalized) ?? "null";
}

export function hashCanonicalContent(obj: unknown): string {
  const canonicalStr = canonicalizeJson(obj);
  return crypto.createHash("sha256").update(canonicalStr, "utf8").digest("hex");
}
