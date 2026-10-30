import fs from "node:fs";
import path from "node:path";

export function generateDeterministicEmbedding(
  text: string,
  dim = 1024,
): number[] {
  const vec = new Float64Array(dim);
  const clean = text.toLowerCase();
  const words = clean.match(/[a-z0-9_.]+/g) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    const prev = vec[idx] ?? 0;
    vec[idx] = prev + sign * (1.0 + (w.length > 3 ? 0.5 : 0.0));
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += (vec[i] ?? 0) * (vec[i] ?? 0);
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vec[0] = 1.0;
    norm = 1.0;
  }
  const result: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = Number(((vec[i] ?? 0) / norm).toFixed(6));
  }
  return result;
}

const SPAN_AXIS_DIMS: Record<string, number> = {
  "gdpr:33": 1007,
  "gdpr:34": 1008,
  "iso:b.3.11": 1009,
  "iso:b.3.12": 1010,
  "iso:a.3.11": 1011,
  "iso:a.3.12": 1012,
  "iso:6.13.1.1": 1013,
  "iso:6.13.1.4": 1014,
  "iso:6.13.1.5": 1015,
  "iso:6.13.1.7": 1016,
  "iso:6.1.3": 1017,
  "iso:5.3": 1018,
  "iso:6.13": 1019,
  "iso:5.4": 1020,
  "iso:9.2": 1021,
  "iso:9.3.2": 1022,
  "iso:10.2": 1023,
};
const SPAN_WEIGHT = 0.7;
const HASH_WEIGHT = 0.3;

export interface ArticleRange {
  art: number;
  startLine: number;
  endLine: number;
}

let cachedArticleRanges: ArticleRange[] | undefined;

export function getGdprArticleRanges(): ArticleRange[] {
  if (cachedArticleRanges !== undefined) {
    return cachedArticleRanges;
  }
  const fixturePath = path.resolve(process.cwd(), "corpus/gdpr-full.txt");
  const lines = fs.readFileSync(fixturePath, "utf-8").split("\n");
  const bounds: Array<{ art: number; line: number }> = [];
  for (const [i, line] of lines.entries()) {
    const match = line.match(/^Article (\d+)$/);
    if (match?.[1] !== undefined) {
      bounds.push({ art: Number(match[1]), line: i + 1 });
    }
  }
  if (bounds.length === 0) {
    throw new Error(`No article boundaries found in ${fixturePath}`);
  }
  const ranges: ArticleRange[] = bounds.map((b, i) => ({
    art: b.art,
    startLine: b.line,
    endLine: (bounds[i + 1]?.line ?? lines.length + 1) - 1,
  }));
  cachedArticleRanges = ranges;
  return ranges;
}

let cachedGdprTextAxes: Map<string, string[]> | undefined;

function getGdprTextAxesSync(): Map<string, string[]> | undefined {
  return cachedGdprTextAxes;
}

export function buildGdprTextAxes(
  chunks: Array<{ doc_id: string; lines: string; text: string }>,
): Map<string, string[]> {
  if (cachedGdprTextAxes !== undefined) {
    return cachedGdprTextAxes;
  }
  const ranges = getGdprArticleRanges();
  const map = new Map<string, string[]>();
  for (const chunk of chunks) {
    if (chunk.doc_id !== "gdpr-full") {
      continue;
    }
    const dash = chunk.lines.indexOf("-");
    const first = Number(chunk.lines.slice(0, dash));
    const last = Number(chunk.lines.slice(dash + 1));
    const axes: string[] = [];
    for (const range of ranges) {
      if (range.art !== 33 && range.art !== 34) {
        continue;
      }
      if (first <= range.endLine && last >= range.startLine) {
        axes.push(`gdpr:${range.art}`);
      }
    }
    if (!map.has(chunk.text)) {
      map.set(chunk.text, axes);
    }
  }
  cachedGdprTextAxes = map;
  return map;
}

function extractMarkerAxes(text: string): string[] {
  const lower = text.toLowerCase();
  const axes = new Set<string>();
  const artMatches = lower.match(/art(?:icle)?\s*(\d+)|(\d+)\(\d+\)/g) ?? [];
  for (const m of artMatches) {
    const num = m.match(/(\d+)/)?.[1];
    if (num === "33" || num === "34") {
      axes.add(`gdpr:${num}`);
    }
  }
  const annexMatches = lower.match(/[ab]\.\d+\.\d+/g) ?? [];
  for (const m of annexMatches) {
    const key = `iso:${m}`;
    if (SPAN_AXIS_DIMS[key] !== undefined) {
      axes.add(key);
    }
  }
  const dottedMatches = lower.match(/\d+(?:\.\d+)+/g) ?? [];
  const isoSuffixes = Object.keys(SPAN_AXIS_DIMS)
    .filter((k) => k.startsWith("iso:"))
    .map((k) => k.slice("iso:".length))
    .sort((a, b) => b.length - a.length);
  for (const m of dottedMatches) {
    for (const suffix of isoSuffixes) {
      if (m === suffix || m.startsWith(`${suffix}.`)) {
        axes.add(`iso:${suffix}`);
        break;
      }
    }
  }
  return [...axes];
}

function classifyTextAxes(text: string): string[] {
  if (text.startsWith("[DOC:gdpr-full")) {
    const registry = getGdprTextAxesSync();
    if (registry === undefined) {
      throw new Error(
        "GDPR text-axis registry not built before embed mock use",
      );
    }
    return registry.get(text) ?? [];
  }
  return extractMarkerAxes(text);
}

export function generateSpanAwareEmbedding(text: string, dim = 1024): number[] {
  const hash = generateDeterministicEmbedding(text, dim);
  const axes = classifyTextAxes(text);
  if (axes.length === 0) {
    return hash;
  }
  const vec = hash.map((v) => v * HASH_WEIGHT);
  for (const axis of axes) {
    const axisDim = SPAN_AXIS_DIMS[axis];
    if (axisDim !== undefined && axisDim < dim) {
      vec[axisDim] = (vec[axisDim] ?? 0) + SPAN_WEIGHT;
    }
  }
  let norm = 0;
  for (const v of vec) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  return vec.map((v) => Number((v / norm).toFixed(6)));
}
