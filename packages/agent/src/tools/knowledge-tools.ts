import { toJsonObject } from "@pims/agent/tools/helpers.ts";
import type {
  ToolDependencies,
  ToolHandler,
} from "@pims/agent/tools/registry.ts";
import { extractPii } from "@pims/evidence/forensic-patterns.ts";
import {
  type IndicatorEmitArgs,
  IndicatorEmitArgsSchema,
  type RagQueryArgs,
  RagQueryArgsSchema,
  type SchedulerArmArgs,
  SchedulerArmArgsSchema,
  type SchedulerCancelArgs,
  SchedulerCancelArgsSchema,
  type SttTranscribeArgs,
  SttTranscribeArgsSchema,
  SttTranscribeResultSchema,
  type TtsSynthesizeArgs,
  TtsSynthesizeArgsSchema,
  TtsSynthesizeResultSchema,
} from "@pims/types/agent.ts";
import { PII_PHONE_REGIONS } from "@pims/types/constants.ts";
import {
  RagNoEvidenceError,
  SchedulerPastDueError,
  TtsPiiLeakBlockedError,
} from "@pims/types/errors.ts";
import { findPhoneNumbersInText } from "libphonenumber-js";

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DNI_PATTERN = /(?<!\d)\d{8}(?!\d)/g;
const RUC_PATTERN = /(?<!\d)(?:10|15|17|20)\d{9}(?!\d)/g;

function detectTtsPii(text: string): string[] {
  const found = new Set<string>(extractPii(text));

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    found.add(match[0]);
  }
  for (const match of text.matchAll(RUC_PATTERN)) {
    found.add(match[0]);
  }
  for (const match of text.matchAll(DNI_PATTERN)) {
    found.add(match[0]);
  }
  for (const region of PII_PHONE_REGIONS) {
    for (const match of findPhoneNumbersInText(text, region)) {
      if (match.number.isValid()) {
        found.add(match.number.number);
      }
    }
  }

  return Array.from(found);
}

export function createKnowledgeToolHandlers(
  deps: ToolDependencies,
): Partial<Record<string, ToolHandler>> {
  return {
    rag_query: async (_ctx, rawArgs) => {
      const args = RagQueryArgsSchema.parse(rawArgs) as RagQueryArgs;
      const result = await deps.ragService.query(args.query, {
        normative_only: args.normative_only,
      });

      const minScore = args.min_score ?? deps.config.RAG_MIN_SCORE;
      const topK = args.top_k ?? deps.config.RAG_TOP_K;
      const passages = result.passages
        .filter((passage) => passage.score >= minScore)
        .slice(0, topK);

      if (passages.length === 0) {
        throw new RagNoEvidenceError(
          `No passage met min_score ${minScore} for query: ${args.query}`,
        );
      }

      return toJsonObject({
        query: result.query,
        passages,
        citations: result.citations,
        crag_grade: result.crag_grade,
        eval: result.crag_grade === "supported",
      });
    },

    stt_transcribe: async (_ctx, rawArgs) => {
      const args = SttTranscribeArgsSchema.parse(rawArgs) as SttTranscribeArgs;
      const result = await deps.voice.transcribe({
        audio_ref: args.audio_ref,
        lang: args.lang,
      });
      return toJsonObject(SttTranscribeResultSchema.parse(result));
    },

    tts_synthesize: async (_ctx, rawArgs) => {
      const args = TtsSynthesizeArgsSchema.parse(rawArgs) as TtsSynthesizeArgs;
      const leaks = detectTtsPii(args.text);
      if (leaks.length > 0) {
        throw new TtsPiiLeakBlockedError(
          "TTS text still contains PII patterns; apply the §8.5 redaction map first",
          { patterns: leaks.length },
        );
      }
      const result = await deps.voice.synthesize({
        text: args.text,
        voice: args.voice,
        lang: args.lang,
      });
      return toJsonObject(TtsSynthesizeResultSchema.parse(result));
    },

    scheduler_arm: async (_ctx, rawArgs) => {
      const args = SchedulerArmArgsSchema.parse(rawArgs) as SchedulerArmArgs;
      try {
        const result = await deps.scheduler.arm(args);
        return toJsonObject({ timer_id: result.timer_id });
      } catch (error: unknown) {
        if (error instanceof SchedulerPastDueError) {
          console.warn(`TIMER_FIRED_LATE:${error.timerId}`);
          return toJsonObject({ timer_id: error.timerId });
        }
        throw error;
      }
    },

    scheduler_cancel: async (_ctx, rawArgs) => {
      const args = SchedulerCancelArgsSchema.parse(
        rawArgs,
      ) as SchedulerCancelArgs;
      await deps.scheduler.cancel(args.timer_id, args.reason);
      return toJsonObject({ cancelled: true });
    },

    indicator_emit: async (_ctx, rawArgs) => {
      const args = IndicatorEmitArgsSchema.parse(rawArgs) as IndicatorEmitArgs;
      const result = await deps.indicator.emit(args.event);
      return toJsonObject(result);
    },
  };
}
