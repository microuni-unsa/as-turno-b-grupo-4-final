import type { SectionLoader } from "@pims/rag/loaders/registry.ts";
import { normalizeLines } from "@pims/rag/loaders/text-utils.ts";
import type { DocumentSection } from "@pims/rag/loaders/types.ts";

interface Paragraph {
  lines: string[];
  start: number;
}

export function loadTextSections(
  sourceText: string,
  maxTokens: number,
  countTokens: (t: string) => number,
): DocumentSection[] {
  if (maxTokens <= 0) {
    throw new RangeError(
      `loadTextSections requires maxTokens > 0, received ${maxTokens}`,
    );
  }

  const lines = normalizeLines(sourceText);
  const paragraphs: Paragraph[] = [];
  let current: string[] = [];
  let currentStart = 0;
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push({ lines: current, start: currentStart });
        current = [];
        currentStart = 0;
      }
    } else {
      if (current.length === 0) {
        currentStart = i + 1;
      }
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push({ lines: current, start: currentStart });
  }

  if (paragraphs.length === 0) {
    return [];
  }

  const groups: Paragraph[][] = [];
  let pending: Paragraph[] = [];
  for (const para of paragraphs) {
    if (pending.length === 0) {
      pending.push(para);
    } else {
      const candidate = [...pending, para];
      const candidateText = candidate
        .map((p) => p.lines.join("\n"))
        .join("\n\n");
      if (countTokens(candidateText) > maxTokens) {
        groups.push(pending);
        pending = [para];
      } else {
        pending = candidate;
      }
    }
  }
  if (pending.length > 0) {
    groups.push(pending);
  }

  return groups.map((group, index) => {
    let startLine = 1;
    const sectionLines: string[] = [];
    let firstPara = true;
    for (const para of group) {
      if (firstPara) {
        startLine = para.start;
        firstPara = false;
      } else {
        sectionLines.push("");
      }
      for (const line of para.lines) {
        sectionLines.push(line);
      }
    }
    const section: DocumentSection = {
      label: `section ${index + 1}`,
      lines: sectionLines,
      startLine,
    };
    return section;
  });
}

export const textSectionLoader: SectionLoader = {
  extensions: [".txt", ".text"],
  loadSections: (buffer, options) =>
    loadTextSections(
      buffer.toString("utf-8"),
      options.maxTokens,
      options.countTokens,
    ),
};
