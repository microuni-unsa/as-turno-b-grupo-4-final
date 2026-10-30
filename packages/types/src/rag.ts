import type { RankedPassage } from "@pims/types/models.ts";

export interface CorpusChunk {
  chunk_id: string;
  doc_id: string;
  article_or_clause: string;
  lines: string;
  text: string;
  normative: boolean;
  header: string;
  token_count: number;
}

export type KGNodeKind =
  | "clause"
  | "control"
  | "article"
  | "field"
  | "catalog"
  | "spec";

export interface KnowledgeGraphNode {
  id: string;
  kind: KGNodeKind;
  label: string;
  description?: string;
}

export type KGEdgeRelation =
  | "requires"
  | "maps_to_field"
  | "mitigates"
  | "crosswalks_to";

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relation: KGEdgeRelation;
  weight: number;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface QueryDecomposition {
  sub_queries: string[];
  hyde_clause: string;
  graph_anchors: string[];
}

export type CRAGGrade = "supported" | "ambiguous" | "unsupported";

export interface CRAGResult {
  grade: CRAGGrade;
  reason: string;
  rewritten_query?: string;
  passed_passages: RankedPassage[];
}

export interface RagQueryResult {
  query: string;
  passages: RankedPassage[];
  citations: string[];
  crag_grade: CRAGGrade;
  decomposed: QueryDecomposition;
  corpus_version: string;
}

export interface EvalQueryDef {
  qid: string;
  query: string;
  normative_only: boolean;
  expected_doc_id: string;
  expected_citation_substr: string;
  expected_answer_substrs: string[];
  min_score: number;
}

export interface RAGTriadScores {
  context_relevance: number;
  groundedness: number;
  answer_relevance: number;
}
