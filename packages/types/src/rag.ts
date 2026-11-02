import {
  DEFAULT_CHUNK_MAX_TOKENS,
  DEFAULT_CHUNK_OVERLAP,
} from "@pims/types/constants.ts";
import { RankedPassageSchema } from "@pims/types/models.ts";
import { z } from "zod";

export const CorpusChunkSchema = z.object({
  chunk_id: z.string(),
  doc_id: z.string(),
  article_or_clause: z.string(),
  lines: z.string(),
  text: z.string(),
  normative: z.boolean(),
  header: z.string(),
  token_count: z.number().int().nonnegative(),
});
export type CorpusChunk = z.infer<typeof CorpusChunkSchema>;

export const DocumentMetadataSchema = z.object({
  doc_id: z.string().optional(),
  title: z.string().optional(),
  normative: z.boolean().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const ChunkingOptionsSchema = z.object({
  maxTokens: z.number().int().positive().default(DEFAULT_CHUNK_MAX_TOKENS),
  chunkOverlap: z.number().int().nonnegative().default(DEFAULT_CHUNK_OVERLAP),
  defaultNormative: z.boolean().default(true),
});
export type ChunkingOptions = z.infer<typeof ChunkingOptionsSchema>;

export const LocalCorpusSourceSchema = z.object({
  type: z.literal("local"),
  dirPath: z.string(),
});
export type LocalCorpusSource = z.infer<typeof LocalCorpusSourceSchema>;

export const S3CorpusSourceSchema = z.object({
  type: z.literal("s3"),
  bucket: z.string(),
  prefix: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
});
export type S3CorpusSource = z.infer<typeof S3CorpusSourceSchema>;

export const CorpusSourceSchema = z.discriminatedUnion("type", [
  LocalCorpusSourceSchema,
  S3CorpusSourceSchema,
]);
export type CorpusSource = z.infer<typeof CorpusSourceSchema>;

export const RagQueryResultSchema = z.object({
  query: z.string(),
  passages: z.array(RankedPassageSchema),
  citations: z.array(z.string()),
  corpus_version: z.string(),
});
export type RagQueryResult = z.infer<typeof RagQueryResultSchema>;

export const EvalQueryDefSchema = z.object({
  qid: z.string(),
  query: z.string(),
  normative_only: z.boolean(),
  expected_doc_id: z.string(),
  expected_citation_substr: z.string().optional(),
  expected_answer_substrs: z.array(z.string()),
  min_score: z.number(),
});
export type EvalQueryDef = z.infer<typeof EvalQueryDefSchema>;

export const LoadedCorpusSchema = z.object({
  version: z.string(),
  chunks: z.array(CorpusChunkSchema),
  docHashes: z.record(z.string(), z.string()),
});
export type LoadedCorpus = z.infer<typeof LoadedCorpusSchema>;

export const DocumentSectionSchema = z.object({
  label: z.string(),
  lines: z.array(z.string()),
  startLine: z.number().int(),
});
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
