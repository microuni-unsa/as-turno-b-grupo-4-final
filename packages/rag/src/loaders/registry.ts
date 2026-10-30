import type { DocumentSection } from "@pims/rag/loaders/types.ts";
import { RagIndexError } from "@pims/types/errors.ts";

export interface SectionLoader {
  readonly extensions: string[];
  loadSections(
    buffer: Buffer,
    options: { maxTokens: number; countTokens: (text: string) => number },
  ): Promise<DocumentSection[]> | DocumentSection[];
}

export class SectionLoaderRegistry {
  private readonly byExtension = new Map<string, SectionLoader>();

  register(loader: SectionLoader): void {
    if (loader.extensions.length === 0) {
      throw new RagIndexError(
        "Section loader must declare at least one extension",
      );
    }
    for (const raw of loader.extensions) {
      const ext = raw.toLowerCase();
      const existing = this.byExtension.get(ext);
      if (existing !== undefined) {
        throw new RagIndexError(
          `Section loader for extension "${ext}" is already registered`,
        );
      }
      this.byExtension.set(ext, loader);
    }
  }

  get(extension: string): SectionLoader | undefined {
    return this.byExtension.get(extension.toLowerCase());
  }

  get supportedExtensions(): string[] {
    return [...this.byExtension.keys()].sort();
  }
}
