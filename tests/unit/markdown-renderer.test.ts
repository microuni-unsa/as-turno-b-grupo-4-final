import {
  renderMarkdown,
  renderMarkdownInline,
} from "@pims/cockpit/ui/lib/markdown.ts";
import { describe, expect, it } from "vitest";

describe("Markdown Renderer & Sanitizer Utility", () => {
  describe("renderMarkdownInline", () => {
    it("handles null, undefined, and empty string without throwing", () => {
      expect(renderMarkdownInline(null)).toBe("");
      expect(renderMarkdownInline(undefined)).toBe("");
      expect(renderMarkdownInline("")).toBe("");
      expect(renderMarkdownInline("   ")).toBe("");
    });

    it("parses bold and italic spans without wrapping in <p> tags", () => {
      const rendered = renderMarkdownInline(
        "Falta de **validación técnica** y *educación*",
      );
      expect(rendered).toContain("<strong>validación técnica</strong>");
      expect(rendered).toContain("<em>educación</em>");
      expect(rendered).not.toMatch(/^<p>/);
      expect(rendered).not.toMatch(/<\/p>$/);
    });

    it("correctly renders technical remediation with bold controls", () => {
      const input =
        "Implementar **MFA obligatoria** para todos los usuarios con control **A.8.5**";
      const rendered = renderMarkdownInline(input);
      expect(rendered).toBe(
        "Implementar <strong>MFA obligatoria</strong> para todos los usuarios con control <strong>A.8.5</strong>",
      );
    });

    it("parses inline code spans", () => {
      const rendered = renderMarkdownInline("Usar `TLS 1.2+` en tránsito");
      expect(rendered).toBe("Usar <code>TLS 1.2+</code> en tránsito");
    });

    it("neutralizes malicious scripts in inline input", () => {
      const malicious = "Texto <script>alert('xss')</script> seguro";
      const rendered = renderMarkdownInline(malicious);
      expect(rendered).not.toContain("<script>");
      expect(rendered).toContain("Texto");
      expect(rendered).toContain("seguro");
    });
  });

  describe("renderMarkdown", () => {
    it("handles null, undefined, and empty string without throwing", () => {
      expect(renderMarkdown(null)).toBe("");
      expect(renderMarkdown(undefined)).toBe("");
      expect(renderMarkdown("")).toBe("");
      expect(renderMarkdown("   ")).toBe("");
    });

    it("parses block elements including headings, paragraphs, and lists", () => {
      const markdown = `### Resumen de Incidente\n\n- Medida 1: Aislar red\n- Medida 2: Rotar credenciales`;
      const rendered = renderMarkdown(markdown);

      expect(rendered).toContain("<h3");
      expect(rendered).toContain("Resumen de Incidente</h3>");
      expect(rendered).toContain("<ul>");
      expect(rendered).toContain("<li>Medida 1: Aislar red</li>");
      expect(rendered).toContain("<li>Medida 2: Rotar credenciales</li>");
    });

    it("parses fenced code blocks", () => {
      const markdown = '```json\n{"status": "contained"}\n```';
      const rendered = renderMarkdown(markdown);

      expect(rendered).toContain("<pre><code");
      expect(rendered).toContain("contained");
    });

    it("parses blockquotes and GFM line breaks", () => {
      const markdown = "> Advertencia regulatoria Art. 33\nLínea 2 tras salto";
      const rendered = renderMarkdown(markdown);

      expect(rendered).toContain("<blockquote>");
      expect(rendered).toContain("Advertencia regulatoria Art. 33");
    });

    it("sanitizes event handler injections and script tags", () => {
      const attack =
        "Riesgo crítico <img src=x onerror=alert(1) /> y <script>evil()</script>";
      const rendered = renderMarkdown(attack);

      expect(rendered).not.toContain("<script>");
      expect(rendered).not.toContain("onerror=");
      expect(rendered).toContain("Riesgo crítico");
    });
  });
});
