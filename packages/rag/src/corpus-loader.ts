import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CorpusChunk } from "@pims/types/rag.ts";
import { extractText, getDocumentProxy } from "unpdf";

export interface LoadedCorpus {
  version: string;
  chunks: CorpusChunk[];
  docHashes: Record<string, string>;
}

export class CorpusLoader {
  private readonly projectRoot: string;

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  private sha256(content: string | Buffer): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private countApproxTokens(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return Math.max(1, Math.round(words.length * 1.3));
  }

  private async readPdfText(filePath: string): Promise<string> {
    const fullPath = path.resolve(this.projectRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`PDF file not found: ${fullPath}`);
    }
    const buffer = fs.readFileSync(fullPath);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }

  private readTextFile(filePath: string): string {
    const fullPath = path.resolve(this.projectRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Text file not found: ${fullPath}`);
    }
    return fs.readFileSync(fullPath, "utf-8");
  }

  private createChunk(
    docId: string,
    chunkId: string,
    articleOrClause: string,
    lines: string,
    rawText: string,
    normative: boolean,
  ): CorpusChunk {
    const cleanText = rawText.trim();
    const header = `[DOC:${docId} | CLAUSE:${articleOrClause} | NORMATIVE:${normative}]`;
    const fullText = `${header}\n${cleanText}`;
    return {
      chunk_id: chunkId,
      doc_id: docId,
      article_or_clause: articleOrClause,
      lines,
      text: fullText,
      normative,
      header,
      token_count: this.countApproxTokens(fullText),
    };
  }

  private splitToTokenLimit(
    docId: string,
    baseChunkId: string,
    articleOrClause: string,
    startLine: number,
    content: string,
    normative: boolean,
    maxTokens: number,
  ): CorpusChunk[] {
    // Check if entire content already fits
    const approxTotal = this.countApproxTokens(content);
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    const endLine = startLine + totalLines - 1;

    if (approxTotal <= maxTokens) {
      return [
        this.createChunk(
          docId,
          baseChunkId,
          articleOrClause,
          `${startLine}-${endLine}`,
          content,
          normative,
        ),
      ];
    }

    // Flatten into lines, and if any single line is oversized, break it by spaces or commas
    const subSegments: string[] = [];
    for (const rawLine of lines) {
      if (this.countApproxTokens(rawLine) > maxTokens) {
        const tokens = rawLine.split(/(?<=[\s,])/);
        let segment: string[] = [];
        let segTokens = 0;
        for (const w of tokens) {
          const wt = this.countApproxTokens(w);
          if (segTokens + wt > maxTokens && segment.length > 0) {
            subSegments.push(segment.join(""));
            segment = [w];
            segTokens = wt;
          } else {
            segment.push(w);
            segTokens += wt;
          }
        }
        if (segment.length > 0) {
          subSegments.push(segment.join(""));
        }
      } else {
        subSegments.push(rawLine);
      }
    }

    const chunks: CorpusChunk[] = [];
    let currentSlice: string[] = [];
    let currentTokens = 0;
    let sliceStartLine = startLine;
    let partIdx = 1;

    for (let i = 0; i < subSegments.length; i++) {
      const seg = subSegments[i] ?? "";
      const segTokens = this.countApproxTokens(seg);

      if (currentTokens + segTokens > maxTokens && currentSlice.length > 0) {
        const sliceEndLine =
          sliceStartLine + Math.min(currentSlice.length, totalLines) - 1;
        chunks.push(
          this.createChunk(
            docId,
            `${baseChunkId}:part${partIdx}`,
            `${articleOrClause}-p${partIdx}`,
            `${sliceStartLine}-${sliceEndLine}`,
            currentSlice.join("\n"),
            normative,
          ),
        );
        partIdx++;

        const overlap = currentSlice.slice(-1);
        currentSlice = [...overlap, seg];
        sliceStartLine = sliceEndLine;
        currentTokens = this.countApproxTokens(currentSlice.join("\n"));
      } else {
        currentSlice.push(seg);
        currentTokens += segTokens;
      }
    }

    if (currentSlice.length > 0) {
      const sliceEndLine = startLine + totalLines - 1;
      chunks.push(
        this.createChunk(
          docId,
          partIdx === 1 ? baseChunkId : `${baseChunkId}:part${partIdx}`,
          partIdx === 1 ? articleOrClause : `${articleOrClause}-p${partIdx}`,
          `${sliceStartLine}-${sliceEndLine}`,
          currentSlice.join("\n"),
          normative,
        ),
      );
    }

    return chunks;
  }

  async loadAll(): Promise<LoadedCorpus> {
    const docHashes: Record<string, string> = {};
    const chunks: CorpusChunk[] = [];

    // 1. GDPR.txt (gdpr-full, normative: true, limit: 512 tokens)
    const gdprPath = "data/GDPR.txt";
    const gdprText = this.readTextFile(gdprPath);
    docHashes["gdpr-full"] = this.sha256(gdprText);
    chunks.push(...this.chunkGdprFull(gdprText));

    // 2. gdpr.txt (gdpr-softexpert, normative: false, limit: 1024 tokens)
    const softExpertPath = "data/gdpr.txt";
    const softExpertText = this.readTextFile(softExpertPath);
    docHashes["gdpr-softexpert"] = this.sha256(softExpertText);
    chunks.push(...this.chunkSoftExpert(softExpertText));

    // 3. ISO 27701-2025_ocr.pdf (iso27701, normative: true, limit: 512 tokens)
    const isoPath = "data/ISO 27701-2025_ocr.pdf";
    const isoText = await this.readPdfText(isoPath);
    docHashes.iso27701 = this.sha256(isoText);
    chunks.push(...this.chunkIso27701(isoText));

    // 4. Anexo 01 through Anexo 06 (normative: true, limit: 512 tokens)
    const anexos = [
      { id: "anexo-01", path: "data/Anexo_01_Diagramas_Entidad_Relacion.pdf" },
      { id: "anexo-02", path: "data/Anexo_02_Diccionario_de_Datos.pdf" },
      {
        id: "anexo-03",
        path: "data/Anexo_03_Esquema_de_la_Base_de_Datos-1.pdf",
      },
      {
        id: "anexo-04",
        path: "data/Anexo_04_Procedimientos_SQL_y_Scripts.pdf",
      },
      {
        id: "anexo-05",
        path: "data/Anexo_05_Politicas_de_Acceso_y_Seguridad.pdf",
      },
      {
        id: "anexo-06",
        path: "data/Anexo_06_Guias_de_Despliegue_y_Puesta_en_Marcha.pdf",
      },
    ];

    for (const anexo of anexos) {
      if (fs.existsSync(path.resolve(this.projectRoot, anexo.path))) {
        const text = await this.readPdfText(anexo.path);
        docHashes[anexo.id] = this.sha256(text);
        chunks.push(...this.chunkAnexo(anexo.id, text));
      }
    }

    // 5. gestitel_base_de_datos.sql (pims-schema, normative: true, limit: 512 tokens)
    const sqlPath = "data/gestitel_base_de_datos.sql";
    if (fs.existsSync(path.resolve(this.projectRoot, sqlPath))) {
      const sqlText = this.readTextFile(sqlPath);
      docHashes["pims-schema"] = this.sha256(sqlText);
      chunks.push(...this.chunkSqlSchema(sqlText));
    }

    // 6. class1.txt, class2.txt, class3.txt (normative: false, limit: 1024 tokens)
    for (const cls of ["class1", "class2", "class3"]) {
      const clsPath = `data/${cls}.txt`;
      if (fs.existsSync(path.resolve(this.projectRoot, clsPath))) {
        const clsText = this.readTextFile(clsPath);
        docHashes[cls] = this.sha256(clsText);
        chunks.push(...this.chunkLectureNotes(cls, clsText));
      }
    }

    // 7. Captured schemas in docs/incident-agent-capture/ (normative: true, limit: 512 tokens)
    const captureDir = path.resolve(
      this.projectRoot,
      "docs/incident-agent-capture",
    );
    if (fs.existsSync(captureDir)) {
      const captureFiles = fs
        .readdirSync(captureDir)
        .filter((f) => f.endsWith(".json"))
        .sort();
      let combinedCapture = "";
      for (const f of captureFiles) {
        const content = fs.readFileSync(path.join(captureDir, f), "utf-8");
        combinedCapture += `\n--- ${f} ---\n${content}`;
      }
      docHashes["pims-capture"] = this.sha256(combinedCapture);
      chunks.push(...this.chunkCapture(combinedCapture));
    }

    // 8. Specification document (spec, normative: true, limit: 512 tokens)
    const specPath = "docs/incident-agent-spec.md";
    if (fs.existsSync(path.resolve(this.projectRoot, specPath))) {
      const specText = this.readTextFile(specPath);
      docHashes.spec = this.sha256(specText);
      chunks.push(...this.chunkSpec(specText));
    }

    // Composite version hash
    const sortedHashes = Object.keys(docHashes)
      .sort()
      .map((k) => `${k}:${docHashes[k]}`)
      .join("\n");
    const version = this.sha256(sortedHashes);

    return {
      version,
      chunks,
      docHashes,
    };
  }

  private chunkGdprFull(text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    // Strict article heading match: Article <number> on its own line
    const articleIndices: Array<{ article: string; lineNum: number }> = [];
    const articleRegex = /^Article\s+(\d+)\s*$/i;

    for (let i = 0; i < totalLines; i++) {
      const line = lines[i]?.trim() ?? "";
      const match = line.match(articleRegex);
      if (match?.[1]) {
        articleIndices.push({ article: `art${match[1]}`, lineNum: i + 1 });
      }
    }

    for (let j = 0; j < articleIndices.length; j++) {
      const current = articleIndices[j];
      if (!current) continue;

      const next = articleIndices[j + 1];
      const startLine = current.lineNum;
      const endLine = next ? next.lineNum - 1 : totalLines;
      const sliceLines = lines.slice(startLine - 1, endLine);
      const content = sliceLines.join("\n");

      // Split large articles to <= 450 tokens to respect 512 token limit with header
      const subChunks = this.splitToTokenLimit(
        "gdpr-full",
        current.article,
        current.article,
        startLine,
        content,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }

  private chunkIso27701(text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    // Target key ISO clauses: B.3.11, B.3.12, 6.1.3, 10.2, A.3.11, A.3.12
    const targetClauses = [
      "B.3.11",
      "B.3.12",
      "6.1.3",
      "10.2",
      "A.3.11",
      "A.3.12",
    ];
    const foundIndices: Array<{ clause: string; lineNum: number }> = [];

    for (let i = 0; i < totalLines; i++) {
      const line = lines[i]?.trim() ?? "";
      for (const c of targetClauses) {
        if (line.startsWith(c) || line.includes(` ${c} `)) {
          foundIndices.push({ clause: c, lineNum: i + 1 });
          break;
        }
      }
    }

    foundIndices.sort((a, b) => a.lineNum - b.lineNum);

    for (let j = 0; j < foundIndices.length; j++) {
      const curr = foundIndices[j];
      if (!curr) continue;
      const next = foundIndices[j + 1];
      const start = curr.lineNum;
      const end = next
        ? Math.min(next.lineNum - 1, start + 80)
        : Math.min(totalLines, start + 80);
      const slice = lines.slice(start - 1, end).join("\n");
      const subChunks = this.splitToTokenLimit(
        "iso27701",
        curr.clause.toLowerCase(),
        curr.clause,
        start,
        slice,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    // General ISO windows
    for (let i = 0; i < totalLines; i += 60) {
      const start = i + 1;
      const end = Math.min(totalLines, i + 60);
      const slice = lines.slice(i, end).join("\n");
      const clauseTag = `iso-section-${Math.floor(i / 60) + 1}`;
      const subChunks = this.splitToTokenLimit(
        "iso27701",
        clauseTag,
        clauseTag,
        start,
        slice,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }

  private chunkAnexo(anexoId: string, text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    const step = 40;
    for (let i = 0; i < totalLines; i += step) {
      const start = i + 1;
      const end = Math.min(totalLines, i + step);
      const slice = lines.slice(i, end).join("\n");
      const chunkTag = `${anexoId}-chunk-${Math.floor(i / step) + 1}`;
      const subChunks = this.splitToTokenLimit(
        anexoId,
        chunkTag,
        anexoId,
        start,
        slice,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }

  private chunkSqlSchema(text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const statements = text.split(/;\r?\n/);
    let lineCursor = 1;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]?.trim();
      if (!stmt) continue;
      const stmtLines = stmt.split(/\r?\n/).length;

      const match = stmt.match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
      );
      const tableName = match?.[1]
        ? match[1].replace(/["']/g, "")
        : `stmt_${i + 1}`;

      const subChunks = this.splitToTokenLimit(
        "pims-schema",
        `pims-schema:${tableName}`,
        tableName,
        lineCursor,
        stmt,
        true,
        450,
      );
      chunks.push(...subChunks);
      lineCursor += stmtLines;
    }

    return chunks;
  }

  private chunkSoftExpert(text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const paragraphs = text
      .split(/\r?\n\r?\n/)
      .filter((p) => p.trim().length > 0);
    let lineCursor = 1;

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i]?.trim() ?? "";
      const pLines = p.split(/\r?\n/).length;

      const subChunks = this.splitToTokenLimit(
        "gdpr-softexpert",
        `softexpert:p${i + 1}`,
        "reference-model",
        lineCursor,
        p,
        false,
        900,
      );
      chunks.push(...subChunks);
      lineCursor += pLines;
    }

    return chunks;
  }

  private chunkLectureNotes(docId: string, text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    const step = 50;
    for (let i = 0; i < totalLines; i += step) {
      const start = i + 1;
      const end = Math.min(totalLines, i + step);
      const slice = lines.slice(i, end).join("\n");
      const subChunks = this.splitToTokenLimit(
        docId,
        `${docId}:chunk-${Math.floor(i / step) + 1}`,
        "lecture-note",
        start,
        slice,
        false,
        900,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }

  private chunkCapture(text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const sections = text.split(/\n---\s+([^\s]+)\s+---\n/);

    for (let i = 1; i < sections.length; i += 2) {
      const filename = sections[i] ?? `capture_${i}`;
      const content = sections[i + 1]?.trim() ?? "";
      const subChunks = this.splitToTokenLimit(
        "pims-capture",
        `capture:${filename}`,
        filename,
        1,
        content,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }

  private chunkSpec(text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    const sectionIndices: Array<{ header: string; lineNum: number }> = [];
    for (let i = 0; i < totalLines; i++) {
      const line = lines[i]?.trim() ?? "";
      if (/^###?\s+[\d.]+/.test(line)) {
        sectionIndices.push({ header: line, lineNum: i + 1 });
      }
    }

    for (let j = 0; j < sectionIndices.length; j++) {
      const curr = sectionIndices[j];
      if (!curr) continue;
      const next = sectionIndices[j + 1];
      const start = curr.lineNum;
      const end = next ? next.lineNum - 1 : totalLines;
      const slice = lines.slice(start - 1, end).join("\n");
      const sectionMatch = curr.header.match(/^###?\s+([\d.]+)/);
      const sectionId = sectionMatch?.[1]
        ? `sec_${sectionMatch[1]}`
        : `sec_${j + 1}`;

      const subChunks = this.splitToTokenLimit(
        "spec",
        `spec:${sectionId}`,
        sectionId,
        start,
        slice,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }
}
