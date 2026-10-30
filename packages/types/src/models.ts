import {
  MODEL_ROUTE_FAST,
  MODEL_ROUTE_REASONING,
} from "@pims/types/constants.ts";
import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), JsonValueSchema),
    z.array(JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const MessageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  tool_call: JsonObjectSchema.optional(),
  tool_result: JsonObjectSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolSchemaDef = z.object({
  name: z.string(),
  description: z.string(),
  parameters: JsonObjectSchema,
});
export type ToolSchema = z.infer<typeof ToolSchemaDef>;

export const ChatJsonArgsSchema = z.object({
  system: z.string(),
  messages: z.array(MessageSchema),
  tools: z.array(ToolSchemaDef).optional(),
  json_schema: JsonObjectSchema.optional(),
  max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  route: z.enum([MODEL_ROUTE_FAST, MODEL_ROUTE_REASONING] as const),
});
export type ChatJsonArgs = z.infer<typeof ChatJsonArgsSchema>;

export const ChatJsonResponseSchema = z.object({
  content: JsonObjectSchema,
  citations_requested: z.boolean(),
  logprobs: z.array(z.number()).optional(),
  semantic_entropy: z.number().optional(),
  conformal_score: z.number().optional(),
});
export type ChatJsonResponse = z.infer<typeof ChatJsonResponseSchema>;

export const VisionJsonArgsSchema = z.object({
  system: z.string(),
  image_or_pdf_ref: z.string(),
  prompt: z.string(),
  json_schema: JsonObjectSchema,
  max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
});
export type VisionJsonArgs = z.infer<typeof VisionJsonArgsSchema>;

export const VisionJsonResponseSchema = z.object({
  extracted_text_redacted: z.string(),
  iocs: z.array(z.string()),
  pii_detected: z.array(z.string()),
  encryption_proof_verified: z.boolean(),
  tamper_score: z.number(),
  layout_hashes: z.array(z.string()),
});
export type VisionJsonResponse = z.infer<typeof VisionJsonResponseSchema>;

export const EmbedArgsSchema = z.object({
  texts: z.array(z.string()),
});
export type EmbedArgs = z.infer<typeof EmbedArgsSchema>;

export const EmbedResponseSchema = z.object({
  vectors: z.array(z.array(z.number())),
});
export type EmbedResponse = z.infer<typeof EmbedResponseSchema>;

export const PassageSchema = z.object({
  chunk_id: z.string(),
  doc_id: z.string(),
  article_or_clause: z.string(),
  lines: z.string(),
  text: z.string(),
  normative: z.boolean(),
  score: z.number().optional(),
});
export type Passage = z.infer<typeof PassageSchema>;

export const RankedPassageSchema = PassageSchema.extend({
  score: z.number(),
  rank: z.number().int().positive(),
});
export type RankedPassage = z.infer<typeof RankedPassageSchema>;

export const RerankArgsSchema = z.object({
  query: z.string(),
  passages: z.array(PassageSchema),
});
export type RerankArgs = z.infer<typeof RerankArgsSchema>;

export const RerankResponseSchema = z.object({
  ranked: z.array(RankedPassageSchema),
});
export type RerankResponse = z.infer<typeof RerankResponseSchema>;

export interface ModelProvider {
  chat_json(args: ChatJsonArgs): Promise<ChatJsonResponse>;
  vision_json(args: VisionJsonArgs): Promise<VisionJsonResponse>;
  embed(args: EmbedArgs): Promise<EmbedResponse>;
  rerank(args: RerankArgs): Promise<RerankResponse>;
}
