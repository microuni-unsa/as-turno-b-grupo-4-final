export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatJsonArgs {
  system: string;
  messages: Message[];
  tools?: ToolSchema[];
  json_schema?: Record<string, unknown>;
  max_tokens: number;
  temperature: number;
}

export interface ChatJsonResponse {
  content: Record<string, unknown>;
  citations_requested: boolean;
  logprobs?: number[];
  semantic_entropy?: number;
  conformal_score?: number;
}

export interface VisionJsonArgs {
  system: string;
  image_or_pdf_ref: string;
  prompt: string;
  json_schema: Record<string, unknown>;
  max_tokens: number;
  temperature: number;
}

export interface VisionJsonResponse {
  extracted_text_redacted: string;
  iocs: string[];
  pii_detected: string[];
  encryption_proof_verified: boolean;
  tamper_score: number;
  layout_hashes: string[];
}

export interface EmbedArgs {
  texts: string[];
}

export interface EmbedResponse {
  vectors: number[][];
}

export interface Passage {
  chunk_id: string;
  doc_id: string;
  article_or_clause: string;
  lines: string;
  text: string;
  normative: boolean;
  score?: number;
}

export interface RankedPassage extends Passage {
  score: number;
  rank: number;
}

export interface RerankArgs {
  query: string;
  passages: Passage[];
}

export interface RerankResponse {
  ranked: RankedPassage[];
}

export interface ModelProvider {
  chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse>;
  vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse>;
  embed(args: EmbedArgs): Promise<EmbedResponse>;
  rerank(args: RerankArgs): Promise<RerankResponse>;
}
