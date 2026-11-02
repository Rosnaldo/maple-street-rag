export interface DocMetadata {
  title: string;
  audience: string;
  effective: string; // YYYY-MM-DD
}

export type DocFormat = "markdown" | "csv" | "pdf" | "html" | "text";

/** A file from docs/ with its metadata resolved (undefined = no metadata anywhere). */
export interface SourceDoc {
  file: string;
  format: DocFormat;
  metadata?: DocMetadata;
  raw: Buffer;
}

export interface IndexableDoc extends SourceDoc {
  metadata: DocMetadata;
}

export interface SkippedFile {
  file: string;
  reason: string;
}

/**
 * A piece of extracted text. `atomic` sections (a CSV row, a group of table rows)
 * become exactly one chunk and are never split or merged.
 */
export interface Section {
  heading?: string;
  text: string;
  atomic?: boolean;
}

export interface ValidityWindow {
  validFrom: string; // YYYY-MM-DD, inclusive
  validTo: string; // YYYY-MM-DD, inclusive
}

export interface Chunk {
  id: string; // "rental-tools.md#2"
  file: string;
  title: string;
  effective: string;
  section?: string;
  text: string; // header + body: what is embedded, keyword-indexed and shown to the model
  validity?: ValidityWindow;
}

export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
  vectorScore?: number; // normalized 0..1, undefined when not a vector candidate
  keywordScore?: number; // normalized 0..1, undefined when not a keyword candidate
  rerankScore?: number; // cross-encoder logit, undefined when re-ranking is off
}

export type Outcome = "answer" | "not_in_docs" | "decline";

export interface ChatSource {
  file: string;
  chunkId: string;
}

export interface ChatResponse {
  answer: string;
  outcome: Outcome;
  sources: ChatSource[];
}
