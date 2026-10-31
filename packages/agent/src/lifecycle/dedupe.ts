import type { DedupeDecision } from "@pims/types/agent.ts";
import { DEDUPE_MAX_CANDIDATES } from "@pims/types/constants.ts";
import type { DedupeIndexRecord } from "@pims/types/evidence.ts";
import type { PimsIncident } from "@pims/types/pims.ts";

type LiveDedupeCandidate = PimsIncident & { embedding_vector?: number[] };

export interface DedupeDecisionInput {
  title: string;
  incident_date: string;
  system_or_url: string;
  embedding: number[];
  live: PimsIncident[];
  index: DedupeIndexRecord[];
  trigramThreshold: number;
  cosineThreshold: number;
}

interface ScoredMatch {
  trigram: number;
  cosine: number;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (value.length === 0) {
    return counts;
  }
  if (value.length < 3) {
    counts.set(value, 1);
    return counts;
  }
  for (let start = 0; start + 3 <= value.length; start += 1) {
    const trigram = value.slice(start, start + 3);
    counts.set(trigram, (counts.get(trigram) ?? 0) + 1);
  }
  return counts;
}

export function trigramSimilarity(a: string, b: string): number {
  const countsA = trigramCounts(a);
  const countsB = trigramCounts(b);
  if (countsA.size === 0 && countsB.size === 0) {
    return 1;
  }
  let intersection = 0;
  let union = 0;
  for (const [trigram, countA] of countsA) {
    const countB = countsB.get(trigram) ?? 0;
    intersection += Math.min(countA, countB);
    union += Math.max(countA, countB);
  }
  for (const [trigram, countB] of countsB) {
    if (!countsA.has(trigram)) {
      union += countB;
    }
  }
  if (union === 0) {
    return 1;
  }
  return intersection / union;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index] ?? 0;
    const valueB = b[index] ?? 0;
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.min(1, Math.max(0, similarity));
}

export function findDedupeDecision(input: DedupeDecisionInput): DedupeDecision {
  const normalizedTitle = normalizeTitle(input.title);
  const normalizedSystem = normalizeTitle(input.system_or_url);
  const targetEmbedding = input.embedding;

  let bestTrigram = 0;
  let bestCosine = 0;
  const noteBest = (scored: ScoredMatch): void => {
    bestTrigram = Math.max(bestTrigram, scored.trigram);
    bestCosine = Math.max(bestCosine, scored.cosine);
  };

  const liveScored: Array<ScoredMatch & { incident: PimsIncident }> = [];
  const embeddingByCode = new Map<string, number[]>();
  for (const record of input.index) {
    embeddingByCode.set(record.incident_code, record.embedding_vector);
  }

  for (const incident of input.live) {
    const trigram = trigramSimilarity(
      normalizedTitle,
      normalizeTitle(incident.title),
    );
    const candidate = incident as LiveDedupeCandidate;
    const vector =
      candidate.embedding_vector ??
      embeddingByCode.get(incident.incident_code) ??
      [];
    if (vector.length === 0) {
      continue;
    }
    const cosine = cosineSimilarity(targetEmbedding, vector);
    noteBest({ trigram, cosine });
    if (
      incident.incident_date === input.incident_date &&
      normalizeTitle(
        incident.compromised_system ?? incident.affected_url ?? "",
      ) === normalizedSystem &&
      trigram >= input.trigramThreshold &&
      cosine >= input.cosineThreshold
    ) {
      liveScored.push({ trigram, cosine, incident });
    }
  }

  liveScored.sort((left, right) => right.trigram - left.trigram);
  const liveCandidates = liveScored.slice(0, DEDUPE_MAX_CANDIDATES);

  const liveMatch = liveCandidates[0];
  if (liveMatch !== undefined) {
    return {
      action: "update",
      incident_code: liveMatch.incident.incident_code,
      incident_id: liveMatch.incident.id,
      trigram_similarity: liveMatch.trigram,
      cosine_similarity: liveMatch.cosine,
      is_deleted: false,
    };
  }

  const indexMatches: Array<ScoredMatch & { record: DedupeIndexRecord }> = [];
  for (const record of input.index) {
    const trigram = trigramSimilarity(normalizedTitle, record.title_normalized);
    const cosine = cosineSimilarity(targetEmbedding, record.embedding_vector);
    noteBest({ trigram, cosine });
    if (
      record.incident_date === input.incident_date &&
      record.system_or_url === normalizedSystem &&
      trigram >= input.trigramThreshold &&
      cosine >= input.cosineThreshold
    ) {
      indexMatches.push({ trigram, cosine, record });
    }
  }

  indexMatches.sort((left, right) => right.trigram - left.trigram);
  const restoreMatch = indexMatches.find(
    (match) => match.record.is_deleted === true,
  );
  if (restoreMatch !== undefined) {
    return {
      action: "restore",
      incident_code: restoreMatch.record.incident_code,
      incident_id: restoreMatch.record.pims_incident_id,
      trigram_similarity: restoreMatch.trigram,
      cosine_similarity: restoreMatch.cosine,
      is_deleted: true,
    };
  }

  return {
    action: "create",
    incident_code: null,
    incident_id: null,
    trigram_similarity: bestTrigram,
    cosine_similarity: bestCosine,
    is_deleted: false,
  };
}
