import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { type ChunkWindow, chunkSections } from "@pims/rag/loaders/chunker.ts";
import { markdownSectionLoader } from "@pims/rag/loaders/markdown.ts";
import { pdfSectionLoader } from "@pims/rag/loaders/pdf.ts";
import {
  type SectionLoader,
  SectionLoaderRegistry,
} from "@pims/rag/loaders/registry.ts";
import { textSectionLoader } from "@pims/rag/loaders/text.ts";
import {
  countApproxTokens,
  slugifyStem,
} from "@pims/rag/loaders/text-utils.ts";
import { RagIndexError } from "@pims/types/errors.ts";
import type {
  ChunkingOptions,
  CorpusChunk,
  CorpusSource,
} from "@pims/types/rag.ts";
import { ChunkingOptionsSchema } from "@pims/types/rag.ts";

function createDefaultSectionLoaders(): SectionLoaderRegistry {
  const registry = new SectionLoaderRegistry();
  registry.register(markdownSectionLoader);
  registry.register(textSectionLoader);
  registry.register(pdfSectionLoader);
  return registry;
}

export interface LoadedCorpus {
  version: string;
  chunks: CorpusChunk[];
  docHashes: Record<string, string>;
}

export interface CorpusLoaderOptions extends ChunkingOptions {
  source?: CorpusSource;
  projectRoot?: string;
  sectionLoaders?: SectionLoaderRegistry;
}

export class CorpusLoader {
  private readonly projectRoot: string;
  private readonly source: CorpusSource;
  private readonly maxTokens: number;
  private readonly chunkOverlap: number;
  private readonly sectionLoaders: SectionLoaderRegistry;
  private readonly defaultNormative: boolean;
  private readonly seqByDoc: Map<string, number> = new Map();

  constructor(options: CorpusLoaderOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.source = options.source ?? {
      type: "local",
      dirPath: "corpus",
    };
    const chunking = ChunkingOptionsSchema.parse({
      maxTokens: options.maxTokens ?? 450,
      chunkOverlap: options.chunkOverlap ?? 1,
      defaultNormative: options.defaultNormative ?? true,
    });
    this.maxTokens = chunking.maxTokens ?? 450;
    this.chunkOverlap = chunking.chunkOverlap ?? 1;
    this.defaultNormative = chunking.defaultNormative ?? true;
    this.sectionLoaders =
      options.sectionLoaders ?? createDefaultSectionLoaders();
  }

  private sha256(content: string | Buffer | Uint8Array): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private determineDocId(filename: string): string {
    const base = path.basename(filename, path.extname(filename));
    return slugifyStem(base);
  }

  private assembleChunks(
    docId: string,
    windows: ChunkWindow[],
    startSeq: number,
  ): { chunks: CorpusChunk[]; nextSeq: number } {
    const chunks: CorpusChunk[] = [];
    let seq = startSeq;
    for (const window of windows) {
      const articleOrClause =
        window.windowCount > 1
          ? `${window.sectionLabel} part ${window.windowIndex + 1}`
          : window.sectionLabel;
      const header = `[DOC:${docId} | CLAUSE:${articleOrClause} | NORMATIVE:${this.defaultNormative}]`;
      const text = `${header}\n${window.body}`;
      chunks.push({
        chunk_id: `${docId}:${String(seq).padStart(4, "0")}`,
        doc_id: docId,
        article_or_clause: articleOrClause,
        lines: `${window.firstLine}-${window.lastLine}`,
        text,
        normative: this.defaultNormative,
        header,
        token_count: countApproxTokens(text),
      });
      seq++;
    }
    return { chunks, nextSeq: seq };
  }

  registerSectionLoader(loader: SectionLoader): void {
    this.sectionLoaders.register(loader);
  }

  get supportedExtensions(): string[] {
    return this.sectionLoaders.supportedExtensions;
  }

  private isSupportedFile(filename: string): boolean {
    return this.sectionLoaders.get(path.extname(filename)) !== undefined;
  }

  async loadAll(): Promise<LoadedCorpus> {
    this.seqByDoc.clear();
    const docHashes: Record<string, string> = {};
    const chunks: CorpusChunk[] = [];

    const fileEntries: Array<{ filename: string; buffer: Buffer }> = [];

    if (this.source.type === "local") {
      const dir = path.resolve(this.projectRoot, this.source.dirPath);
      if (!fs.existsSync(dir)) {
        throw new RagIndexError(`Corpus directory not found: ${dir}`);
      }
      const files = fs.readdirSync(dir).filter((f) => this.isSupportedFile(f));
      files.sort();

      for (const f of files) {
        const filePath = path.join(dir, f);
        const buf = fs.readFileSync(filePath);
        fileEntries.push({ filename: f, buffer: buf });
      }
    } else {
      const region = this.source.region ?? process.env.AWS_REGION;
      if (region === undefined || region === "") {
        throw new RagIndexError(
          `S3 corpus source for bucket "${this.source.bucket}" requires an explicit region`,
        );
      }
      const accessKeyId = this.source.accessKeyId;
      const secretAccessKey = this.source.secretAccessKey;
      if (
        (accessKeyId === undefined) !== (secretAccessKey === undefined) ||
        accessKeyId === "" ||
        secretAccessKey === ""
      ) {
        throw new RagIndexError(
          `S3 corpus source for bucket "${this.source.bucket}" requires both accessKeyId and secretAccessKey, or neither`,
        );
      }
      const s3 = new S3Client({
        region,
        endpoint: this.source.endpoint,
        credentials:
          accessKeyId !== undefined && secretAccessKey !== undefined
            ? { accessKeyId, secretAccessKey }
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
        if (key === undefined || key === "") {
          throw new RagIndexError(
            `S3 corpus source for bucket "${this.source.bucket}" returned an object without a key`,
          );
        }
        if (!this.isSupportedFile(key)) {
          continue;
        }

        const getRes = await s3.send(
          new GetObjectCommand({
            Bucket: this.source.bucket,
            Key: key,
          }),
        );
        const bytes = await getRes.Body?.transformToByteArray();
        if (bytes === undefined) {
          throw new RagIndexError(
            `S3 corpus object "${key}" in bucket "${this.source.bucket}" returned no bytes`,
          );
        }
        fileEntries.push({
          filename: path.basename(key),
          buffer: Buffer.from(bytes),
        });
      }
    }

    for (const entry of fileEntries) {
      const fileHash = this.sha256(entry.buffer);
      docHashes[entry.filename] = fileHash;
      const docId = this.determineDocId(entry.filename);
      docHashes[docId] = fileHash;

      const loader = this.sectionLoaders.get(path.extname(entry.filename));
      if (loader === undefined) {
        throw new RagIndexError(
          `Unsupported corpus extension: ${path.extname(entry.filename).toLowerCase()} for file ${entry.filename}`,
        );
      }
      const sections = await loader.loadSections(entry.buffer, {
        maxTokens: this.maxTokens,
        countTokens: countApproxTokens,
      });

      const seqStart = this.seqByDoc.get(docId) ?? 1;
      const windows = chunkSections({
        sections,
        maxTokens: this.maxTokens,
        chunkOverlap: this.chunkOverlap,
      });
      const { chunks: docChunks, nextSeq } = this.assembleChunks(
        docId,
        windows,
        seqStart,
      );
      this.seqByDoc.set(docId, nextSeq);
      chunks.push(...docChunks);
    }

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
