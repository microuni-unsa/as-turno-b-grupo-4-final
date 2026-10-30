import { countApproxTokens, splitWords } from "@pims/rag/loaders/text-utils.ts";
import type { DocumentSection } from "@pims/rag/loaders/types.ts";

export interface ChunkingInput {
  sections: DocumentSection[];
  maxTokens: number;
  chunkOverlap: number;
}

export interface ChunkWindow {
  sectionLabel: string;
  sectionIndex: number;
  windowIndex: number;
  windowCount: number;
  body: string;
  firstLine: number;
  lastLine: number;
  tokenCount: number;
}

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
  if (input.maxTokens <= 0) {
    throw new RangeError(
      `chunkSections requires maxTokens > 0, received ${input.maxTokens}`,
    );
  }
  if (input.chunkOverlap < 0) {
    throw new RangeError(
      `chunkSections requires chunkOverlap >= 0, received ${input.chunkOverlap}`,
    );
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
