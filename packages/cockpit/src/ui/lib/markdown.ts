import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

function sanitizeHtml(html: string): string {
  if (typeof window !== "undefined") {
    const purifier =
      typeof DOMPurify.sanitize === "function"
        ? DOMPurify
        : typeof DOMPurify === "function"
          ? (DOMPurify as unknown as (win: Window) => typeof DOMPurify)(window)
          : null;
    if (purifier && typeof purifier.sanitize === "function") {
      return purifier.sanitize(html);
    }
  }
  // Baseline sanitization for SSR / headless execution
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * Parses full Markdown blocks (paragraphs, headers, lists, code blocks, tables)
 * and sanitizes the output HTML against XSS.
 */
export function renderMarkdown(content: string | null | undefined): string {
  if (content === null || content === undefined) {
    return "";
  }
  const str = String(content);
  if (str.trim().length === 0) {
    return "";
  }
  const rawHtml = marked.parse(str, { async: false }) as string;
  return sanitizeHtml(rawHtml);
}

/**
 * Parses inline Markdown spans (**bold**, *italic*, `code`, [link](url))
 * without wrapping in `<p>` tags, and sanitizes output against XSS.
 * Ideal for single-line labels or items embedded in tight metadata cards.
 */
export function renderMarkdownInline(
  content: string | null | undefined,
): string {
  if (content === null || content === undefined) {
    return "";
  }
  const str = String(content);
  if (str.trim().length === 0) {
    return "";
  }
  const rawHtml = marked.parseInline(str, { async: false }) as string;
  return sanitizeHtml(rawHtml);
}
