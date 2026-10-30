import { countApproxTokens, splitWords } from "@pims/rag/loaders/text-utils.ts";
import { RagIndexError } from "@pims/types/errors.ts";
import type { DocumentSection } from "@pims/types/rag.ts";
import { DocumentSectionSchema } from "@pims/types/rag.ts";
import { z } from "zod";

export const ChunkingInputSchema = z.object({
  sections: z.array(DocumentSectionSchema),
  maxTokens: z.number().int().positive(),
  chunkOverlap: z.number().int().nonnegative(),
});
export type ChunkingInput = z.infer<typeof ChunkingInputSchema>;

export const ChunkWindowSchema = z.object({
  sectionLabel: z.string(),
  sectionIndex: z.number().int().nonnegative(),
  windowIndex: z.number().int().nonnegative(),
  windowCount: z.number().int().positive(),
  body: z.string(),
  firstLine: z.number().int(),
  lastLine: z.number().int(),
  tokenCount: z.number().int().nonnegative(),
});
export type ChunkWindow = z.infer<typeof ChunkWindowSchema>;

interface PseudoLine {
  text: string;
  lineNo: number;
}

function splitLongLine(line: string, maxTokens: number): string[] {
  const words = splitWords(line);
  const segments: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    if (current.length === 0) {
      current.push(word);
    } else {
      const candidate = `${current.join(" ")} ${word}`;
      if (countApproxTokens(candidate) > maxTokens) {
        segments.push(current.join(" "));
        current = [word];
      } else {
        current.push(word);
      }
    }
  }
  if (current.length > 0) {
    segments.push(current.join(" "));
  }
  return segments.length > 0 ? segments : [line];
}

function expandSection(
  section: DocumentSection,
  maxTokens: number,
): PseudoLine[] {
  const pseudos: PseudoLine[] = [];
  for (const [index, line] of section.lines.entries()) {
    const lineNo = section.startLine + index;
    if (countApproxTokens(line) <= maxTokens) {
      pseudos.push({ text: line, lineNo });
    } else {
      for (const segment of splitLongLine(line, maxTokens)) {
        pseudos.push({ text: segment, lineNo });
      }
    }
  }
  return pseudos;
}

function packWindows(
  pseudos: PseudoLine[],
  maxTokens: number,
  chunkOverlap: number,
): PseudoLine[][] {
  const windows: PseudoLine[][] = [];
  let start = 0;
  while (start < pseudos.length) {
    const first = pseudos[start];
    if (first === undefined) {
      break;
    }
    const window: PseudoLine[] = [first];
    let end = start + 1;
    while (end < pseudos.length) {
      const candidate = pseudos[end];
      if (candidate === undefined) {
        break;
      }
      const joined = [...window, candidate].map((p) => p.text).join("\n");
      if (countApproxTokens(joined) > maxTokens) {
        break;
      }
      window.push(candidate);
      end++;
    }
    windows.push(window);
    if (end >= pseudos.length) {
      break;
    }
    const overlap = Math.min(chunkOverlap, window.length - 1);
    start = end - overlap;
  }
  return windows;
}

export function chunkSections(input: ChunkingInput): ChunkWindow[] {
  const v = ChunkingInputSchema.safeParse(input);
  if (!v.success) {
    throw new RagIndexError(`Invalid chunkSections input: ${v.error.message}`);
  }
  const windows: ChunkWindow[] = [];
  for (const [sectionIndex, section] of input.sections.entries()) {
    const pseudos = expandSection(section, input.maxTokens);
    if (pseudos.length === 0) {
      continue;
    }
    const packed = packWindows(pseudos, input.maxTokens, input.chunkOverlap);
    for (const [windowIndex, window] of packed.entries()) {
      const firstPseudo = window[0];
      const lastPseudo = window[window.length - 1];
      if (
        window.length === 0 ||
        firstPseudo === undefined ||
        lastPseudo === undefined
      ) {
        continue;
      }
      const body = window.map((p) => p.text).join("\n");
      windows.push({
        sectionLabel: section.label,
        sectionIndex,
        windowIndex,
        windowCount: packed.length,
        body,
        firstLine: firstPseudo.lineNo,
        lastLine: lastPseudo.lineNo,
        tokenCount: countApproxTokens(body),
      });
    }
  }
  return windows;
}
