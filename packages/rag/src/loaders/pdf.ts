import type { SectionLoader } from "@pims/rag/loaders/registry.ts";
import {
  normalizeLines,
  trimBlankEdges,
} from "@pims/rag/loaders/text-utils.ts";
import type { DocumentSection } from "@pims/rag/loaders/types.ts";
import { extractText, getDocumentProxy } from "unpdf";

export function loadPdfSections(pages: string[]): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let runningGlobal = 0;
  for (const [p, page] of pages.entries()) {
    if (page.trim() === "") {
      continue;
    }
    const pageLines = normalizeLines(page);
    const trimmed = trimBlankEdges(pageLines, runningGlobal + 1);
    if (trimmed.lines.length === 0) {
      continue;
    }
    sections.push({
      label: `page ${p + 1}`,
      lines: trimmed.lines,
      startLine: trimmed.startLine,
    });
    runningGlobal += trimmed.lines.length;
  }
  return sections;
}

export const pdfSectionLoader: SectionLoader = {
  extensions: [".pdf"],
  loadSections: async (buffer) => {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf);
    return loadPdfSections(text);
  },
};
