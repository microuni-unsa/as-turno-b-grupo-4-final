import { toJsonObject } from "@pims/agent/tools/helpers.ts";
import type {
  ToolDependencies,
  ToolHandler,
} from "@pims/agent/tools/registry.ts";
import {
  type IndicatorEmitArgs,
  IndicatorEmitArgsSchema,
  type RagQueryArgs,
  RagQueryArgsSchema,
  type SchedulerArmArgs,
  SchedulerArmArgsSchema,
  type SchedulerCancelArgs,
  SchedulerCancelArgsSchema,
} from "@pims/types/agent.ts";
import {
  RagNoEvidenceError,
  SchedulerPastDueError,
} from "@pims/types/errors.ts";

export function createKnowledgeToolHandlers(
  deps: ToolDependencies,
): Partial<Record<string, ToolHandler>> {
  return {
    rag_query: async (ctx, rawArgs) => {
      const args = RagQueryArgsSchema.parse(rawArgs) as RagQueryArgs;
      const result = await deps.ragService.query(args.query, {
        normative_only: args.normative_only,
        incident_code:
          ctx.incidentCode !== null && ctx.incidentCode !== undefined
            ? ctx.incidentCode
            : undefined,
        prefer_doc_ids: args.prefer_doc_ids,
      });

      const minScore =
        args.min_score !== undefined
          ? args.min_score
          : deps.config.RAG_MIN_SCORE;
      const topK =
        args.top_k !== undefined ? args.top_k : deps.config.RAG_TOP_K;
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
        eval: passages.length > 0,
      });
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
