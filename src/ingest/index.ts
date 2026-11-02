import type { Embedder } from "../llm/embeddings.js";
import { embedDocumentsCached } from "../llm/embeddingCache.js";
import { IndexSnapshot } from "../retrieval/store.js";
import type { Chunk, IndexableDoc, SkippedFile } from "../types.js";
import { chunkDocument } from "./chunk.js";
import { extractSections } from "./extractors/index.js";
import { selectIndexableDocs } from "./filters.js";
import { parseValidityWindow } from "./flyerDates.js";
import { annotateHolidays } from "./annotate/holidays.js";
import { loadDocs } from "./loadDocs.js";

export interface IngestReport {
  indexed: string[];
  skipped: SkippedFile[];
  chunks: number;
  warnings?: string[];
}

export interface IngestOptions {
  docsDir: string;
  embedder?: Embedder;
  embeddingCacheFile: string;
}

/** docs/ -> metadata -> filters -> extract -> chunk -> embed -> new index snapshot. */
export async function ingest({ docsDir, embedder, embeddingCacheFile }: IngestOptions): Promise<{
  snapshot: IndexSnapshot;
  report: IngestReport;
}> {
  const loaded = await loadDocs(docsDir);
  const { indexable, skipped: filtered } = selectIndexableDocs(loaded.docs);
  const skipped = [...loaded.skipped, ...filtered];

  const chunks: Chunk[] = [];
  const indexed: string[] = [];
  for (const doc of indexable) {
    try {
      const docChunks = await chunkFile(doc);
      if (!docChunks.length) {
        skipped.push({ file: doc.file, reason: "no extractable text" });
        continue;
      }
      chunks.push(...docChunks);
      indexed.push(doc.file);
    } catch (error) {
      skipped.push({ file: doc.file, reason: `extraction failed: ${(error as Error).message}` });
    }
  }

  const warnings: string[] = [];
  let vectors = new Map<string, number[]>();
  if (!embedder) {
    warnings.push("No embedding provider configured: retrieval is keyword-only");
  } else {
    vectors = await embedChunks(chunks, embedder, embeddingCacheFile);
  }

  return {
    snapshot: new IndexSnapshot(chunks, vectors),
    report: {
      indexed,
      skipped: skipped.sort((a, b) => a.file.localeCompare(b.file)),
      chunks: chunks.length,
      ...(warnings.length ? { warnings } : {}),
    },
  };
}

async function chunkFile(doc: IndexableDoc): Promise<Chunk[]> {
  const sections = await extractSections(doc.format, doc.raw);
  const fullText = sections.map((section) => section.text).join("\n");
  // A sale window applies to every chunk of the document, even when a flyer splits.
  const validity = parseValidityWindow(fullText, doc.metadata.effective);
  // Annotate after parsing the sale window, whose date pattern expects bare dates.
  const annotated = sections.map((section) => ({ ...section, text: annotateHolidays(section.text) }));
  return chunkDocument(doc, annotated, validity);
}

async function embedChunks(chunks: Chunk[], embedder: Embedder, cacheFile: string): Promise<Map<string, number[]>> {
  const vectors = await embedDocumentsCached(
    embedder,
    chunks.map((chunk) => chunk.text),
    cacheFile,
  );
  return new Map(chunks.map((chunk, i) => [chunk.id, vectors[i]]));
}
