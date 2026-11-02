import type { Chunk } from "../types.js";
import { Bm25Index } from "./bm25.js";

export interface ScoredId {
  id: string;
  score: number;
}

/**
 * One immutable snapshot of the index. /ingest builds a new one and swaps it in,
 * so requests in flight keep reading a consistent index.
 */
export class IndexSnapshot {
  private readonly chunksById: Map<string, Chunk>;
  private readonly bm25: Bm25Index;

  constructor(
    readonly chunks: Chunk[],
    private readonly vectors: Map<string, number[]> = new Map(),
  ) {
    this.chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    this.bm25 = new Bm25Index(chunks);
  }

  get hasVectors(): boolean {
    return this.vectors.size > 0;
  }

  getChunk(id: string): Chunk | undefined {
    return this.chunksById.get(id);
  }

  keywordSearch(query: string, limit: number): ScoredId[] {
    return this.bm25.search(query, limit);
  }

  /** Cosine similarity; vectors are unit length, so it is a dot product. */
  vectorSearch(queryVector: number[], limit: number): ScoredId[] {
    const hits: ScoredId[] = [];
    for (const [id, vector] of this.vectors) {
      let score = 0;
      for (let i = 0; i < vector.length; i++) score += vector[i] * queryVector[i];
      hits.push({ id, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export class ChunkStore {
  private snapshot = new IndexSnapshot([]);

  replace(snapshot: IndexSnapshot): void {
    this.snapshot = snapshot;
  }

  current(): IndexSnapshot {
    return this.snapshot;
  }
}
