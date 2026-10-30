import type { SectionLoader } from "@pims/rag/loaders/registry.ts";
import {
  normalizeLines,
  trimBlankEdges,
} from "@pims/rag/loaders/text-utils.ts";
import type { DocumentSection } from "@pims/rag/loaders/types.ts";
import { RagIndexError } from "@pims/types/errors.ts";
import type { Heading, Root, RootContent } from "mdast";
import { remark } from "remark";

interface ValueNode {
  value?: string;
  children?: RootContent[];
}

function collectText(node: RootContent | Root | unknown): string {
  if (typeof node !== "object" || node === null) {
    return "";
  }
  const record = node as ValueNode;
  let out = typeof record.value === "string" ? record.value : "";
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      out += collectText(child);
    }
  }
  return out;
}

export function loadMarkdownSections(sourceText: string): DocumentSection[] {
  const tree: Root = remark.parse(sourceText);
  const lines = normalizeLines(sourceText);

  const headings: Array<{ node: Heading; startLine: number }> = [];
  const children = tree.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child !== undefined && child.type === "heading") {
      const position = child.position;
      if (position === undefined) {
        throw new RagIndexError(
          `Markdown heading at index ${i} has no position`,
        );
      }
      headings.push({ node: child, startLine: position.start.line });
    }
  }

  if (headings.length === 0) {
    if (sourceText.trim() === "") {
      return [];
    }
    const trimmed = trimBlankEdges(lines, 1);
    return [
      { label: "document", lines: trimmed.lines, startLine: trimmed.startLine },
    ];
  }

  const sections: DocumentSection[] = [];
  const first = headings[0];
  if (first !== undefined && first.startLine > 1) {
    const leading = lines.slice(0, first.startLine - 1);
    if (leading.join("\n").trim() !== "") {
      const trimmed = trimBlankEdges(leading, 1);
      sections.push({
        label: "preamble",
        lines: trimmed.lines,
        startLine: trimmed.startLine,
      });
    }
  }

  for (let j = 0; j < headings.length; j++) {
    const current = headings[j];
    if (current === undefined) {
      throw new RagIndexError("Markdown heading index out of bounds");
    }
    const next = headings[j + 1];
    const start = current.startLine;
    const end = next !== undefined ? next.startLine - 1 : lines.length;
    const slice = lines.slice(start - 1, end);
    const trimmed = trimBlankEdges(slice, start);
    const text = collectText(current.node);
    const label = text === "" ? `section line ${start}` : text;
    sections.push({
      label,
      lines: trimmed.lines,
      startLine: trimmed.startLine,
    });
  }

  return sections;
}

export const markdownSectionLoader: SectionLoader = {
  extensions: [".md", ".markdown"],
  loadSections: (buffer) => loadMarkdownSections(buffer.toString("utf-8")),
};
