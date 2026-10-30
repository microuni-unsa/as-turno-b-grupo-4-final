import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CorpusChunk, CorpusSource } from "@pims/types/rag.ts";
import { extractText, getDocumentProxy } from "unpdf";

export interface LoadedCorpus {
  version: string;
  chunks: CorpusChunk[];
  docHashes: Record<string, string>;
}

export interface CorpusLoaderOptions {
  source?: CorpusSource;
  projectRoot?: string;
}

export class CorpusLoader {
  private readonly projectRoot: string;
  private readonly source: CorpusSource;

  constructor(options: CorpusLoaderOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.source = options.source ?? {
      type: "local",
      dirPath: "corpus",
    };
  }

  private sha256(content: string | Buffer | Uint8Array): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private countApproxTokens(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return Math.max(1, Math.round(words.length * 1.3));
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

  private async extractTextFromBuffer(
    filename: string,
    buffer: Buffer,
  ): Promise<string> {
    const ext = path.extname(filename).toLowerCase();
    if (ext === ".pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    }
    return buffer.toString("utf-8");
  }

  private chunkArticles(docId: string, text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    const articleIndices: Array<{ article: string; lineNum: number }> = [];
    const articleRegex = /^Article\s+(\d+)\s*$/i;

    for (let i = 0; i < totalLines; i++) {
      const line = lines[i]?.trim() ?? "";
      const match = line.match(articleRegex);
      if (match?.[1]) {
        articleIndices.push({ article: match[1], lineNum: i + 1 });
      }
    }

    for (let j = 0; j < articleIndices.length; j++) {
      const curr = articleIndices[j];
      if (!curr) continue;
      const next = articleIndices[j + 1];
      const start = curr.lineNum;
      const end = next ? next.lineNum - 1 : totalLines;
      const slice = lines.slice(start - 1, end).join("\n");
      const subChunks = this.splitToTokenLimit(
        docId,
        `art${curr.article}`,
        `Article ${curr.article}`,
        start,
        slice,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    return chunks;
  }

  private chunkIsoClauses(docId: string, text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    const targetClauses = [
      "B.3.11",
      "B.3.12",
      "A.3.11",
      "A.3.12",
      "6.13.1.1",
      "6.13.1.2",
      "6.13.1.3",
      "6.13.1.4",
      "6.13.1.5",
      "6.13.1.6",
      "6.13.1.7",
      "6.1.3",
      "6.1.2",
      "9.3.2",
      "9.2",
      "9.3",
      "10.2",
      "6.13",
      "5.4",
      "4.2",
      "5.2",
      "5.3",
      "5.5",
      "6.2",
      "6.3",
      "6.4",
      "6.5",
      "6.6",
      "6.7",
      "6.8",
      "6.9",
      "6.10",
      "6.11",
      "6.12",
      "7.2",
      "7.3",
      "7.4",
      "8.2",
      "8.3",
      "8.4",
      "8.5",
      "A.2",
      "A.3",
      "B.2",
      "B.3",
    ];
    const sortedTargets = [...targetClauses].sort(
      (a, b) => b.length - a.length,
    );
    const foundIndices: Array<{ clause: string; lineNum: number }> = [];

    for (let i = 0; i < totalLines; i++) {
      const line = lines[i]?.trim() ?? "";
      for (const c of sortedTargets) {
        const regex = new RegExp(
          `^(?:Clause\\s+)?${c.replace(/\\./g, "\\.")}(?:\\s|\\.|,|$)`,
          "i",
        );
        if (regex.test(line)) {
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
        ? Math.min(next.lineNum - 1, start + 120)
        : Math.min(totalLines, start + 120);
      const slice = lines.slice(start - 1, end).join("\n");
      const subChunks = this.splitToTokenLimit(
        docId,
        curr.clause.toLowerCase(),
        curr.clause,
        start,
        slice,
        true,
        450,
      );
      chunks.push(...subChunks);
    }

    // General ISO sliding windows
    for (let i = 0; i < totalLines; i += 60) {
      const start = i + 1;
      const end = Math.min(totalLines, i + 60);
      const slice = lines.slice(i, end).join("\n");
      const clauseTag = `iso-section-${Math.floor(i / 60) + 1}`;
      const subChunks = this.splitToTokenLimit(
        docId,
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

  private chunkGeneralText(docId: string, text: string): CorpusChunk[] {
    const chunks: CorpusChunk[] = [];
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;
    const windowSize = 50;

    for (let i = 0; i < totalLines; i += windowSize) {
      const start = i + 1;
      const end = Math.min(totalLines, i + windowSize);
      const slice = lines.slice(i, end).join("\n");
      const sectionTag = `sec-${Math.floor(i / windowSize) + 1}`;
      chunks.push(
        ...this.splitToTokenLimit(
          docId,
          sectionTag,
          sectionTag,
          start,
          slice,
          true,
          450,
        ),
      );
    }
    return chunks;
  }

  private determineDocId(filename: string): string {
    const upper = filename.toUpperCase();
    if (upper.includes("GDPR")) {
      return "gdpr-full";
    }
    if (upper.includes("27701") || upper.includes("ISO")) {
      return "iso27701";
    }
    return path.basename(filename, path.extname(filename)).toLowerCase();
  }

  private chunkDocument(
    docId: string,
    filename: string,
    text: string,
  ): CorpusChunk[] {
    const upper = filename.toUpperCase();
    if (upper.includes("GDPR") || text.includes("Article 1")) {
      return this.chunkArticles(docId, text);
    }
    if (
      upper.includes("27701") ||
      upper.includes("ISO") ||
      text.includes("ISO/IEC")
    ) {
      return this.chunkIsoClauses(docId, text);
    }
    return this.chunkGeneralText(docId, text);
  }

  async loadAll(): Promise<LoadedCorpus> {
    const docHashes: Record<string, string> = {};
    const chunks: CorpusChunk[] = [];

    const fileEntries: Array<{ filename: string; buffer: Buffer }> = [];

    if (this.source.type === "local") {
      const dir = path.resolve(this.projectRoot, this.source.dirPath);
      if (!fs.existsSync(dir)) {
        throw new Error(`Corpus directory not found: ${dir}`);
      }
      const files = fs.readdirSync(dir).filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return ext === ".txt" || ext === ".pdf" || ext === ".md";
      });
      files.sort();

      for (const f of files) {
        const filePath = path.join(dir, f);
        const buf = fs.readFileSync(filePath);
        fileEntries.push({ filename: f, buffer: buf });
      }
    } else {
      const s3 = new S3Client({
        region: this.source.region || process.env.AWS_REGION || "us-east-1",
        endpoint: this.source.endpoint,
        credentials:
          this.source.accessKeyId && this.source.secretAccessKey
            ? {
                accessKeyId: this.source.accessKeyId,
                secretAccessKey: this.source.secretAccessKey,
              }
            : undefined,
      });

      const listRes = await s3.send(
        new ListObjectsV2Command({
          Bucket: this.source.bucket,
          Prefix: this.source.prefix,
        }),
      );

      const contents = listRes.Contents ?? [];
      for (const obj of contents) {
        const key = obj.Key;
        if (!key) continue;
        const ext = path.extname(key).toLowerCase();
        if (ext !== ".txt" && ext !== ".pdf" && ext !== ".md") continue;

        const getRes = await s3.send(
          new GetObjectCommand({
            Bucket: this.source.bucket,
            Key: key,
          }),
        );
        const bytes = await getRes.Body?.transformToByteArray();
        if (bytes) {
          fileEntries.push({
            filename: path.basename(key),
            buffer: Buffer.from(bytes),
          });
        }
      }
    }

    for (const entry of fileEntries) {
      const docId = this.determineDocId(entry.filename);
      docHashes[docId] = this.sha256(entry.buffer);
      const text = await this.extractTextFromBuffer(
        entry.filename,
        entry.buffer,
      );
      const docChunks = this.chunkDocument(docId, entry.filename, text);
      chunks.push(...docChunks);
    }

    // Composite version hash: deterministic sha256(sorted(file hashes))
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
}
