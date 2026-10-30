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

export const KGNodeKindSchema = z.enum([
  "clause",
  "control",
  "article",
  "field",
  "catalog",
  "spec",
]);
export type KGNodeKind = z.infer<typeof KGNodeKindSchema>;

export const KnowledgeGraphNodeSchema = z.object({
  id: z.string(),
  kind: KGNodeKindSchema,
  label: z.string(),
  description: z.string().optional(),
});
export type KnowledgeGraphNode = z.infer<typeof KnowledgeGraphNodeSchema>;

export const KGEdgeRelationSchema = z.enum([
  "requires",
  "maps_to_field",
  "mitigates",
  "crosswalks_to",
]);
export type KGEdgeRelation = z.infer<typeof KGEdgeRelationSchema>;

export const KnowledgeGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: KGEdgeRelationSchema,
  weight: z.number().positive(),
});
export type KnowledgeGraphEdge = z.infer<typeof KnowledgeGraphEdgeSchema>;

export const KnowledgeGraphDataSchema = z.object({
  nodes: z.array(KnowledgeGraphNodeSchema),
  edges: z.array(KnowledgeGraphEdgeSchema),
});
export type KnowledgeGraphData = z.infer<typeof KnowledgeGraphDataSchema>;

export const QueryDecompositionSchema = z.object({
  sub_queries: z.array(z.string()),
  hyde_clause: z.string(),
  graph_anchors: z.array(z.string()),
});
export type QueryDecomposition = z.infer<typeof QueryDecompositionSchema>;

export const CRAGGradeSchema = z.enum([
  "supported",
  "ambiguous",
  "unsupported",
]);
export type CRAGGrade = z.infer<typeof CRAGGradeSchema>;

export const CRAGResultSchema = z.object({
  grade: CRAGGradeSchema,
  reason: z.string(),
  rewritten_query: z.string().optional(),
  passed_passages: z.array(RankedPassageSchema),
});
export type CRAGResult = z.infer<typeof CRAGResultSchema>;

export const RagQueryResultSchema = z.object({
  query: z.string(),
  passages: z.array(RankedPassageSchema),
  citations: z.array(z.string()),
  crag_grade: CRAGGradeSchema,
  decomposed: QueryDecompositionSchema,
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

export const RAGTriadScoresSchema = z.object({
  context_relevance: z.number(),
  groundedness: z.number(),
  answer_relevance: z.number(),
});
export type RAGTriadScores = z.infer<typeof RAGTriadScoresSchema>;
