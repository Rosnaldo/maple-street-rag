import type { Embedder } from "../llm/embeddings.js";
import type { RetrievedChunk } from "../types.js";
import type { Reranker } from "./rerank.js";
import type { ChunkStore, ScoredId } from "./store.js";

export const CANDIDATES_PER_RETRIEVER = 20;

export interface SearchWeights {
  vector: number;
  keyword: number;
}

export interface HybridSearchDeps {
  store: ChunkStore;
  embedder?: Embedder;
  weights: SearchWeights;
  /** When set, the top `rerankCandidates` hybrid hits are re-ordered by it before keeping k. */
  reranker?: Reranker;
  rerankCandidates?: number;
}

/**
 * Hybrid retrieval: vector search catches different wording ("Christmas Eve" vs
 * "December 24"), BM25 catches exact tokens (SKUs, "20V", product names).
 * Each list is min-max normalized to 0..1, then combined as a weighted sum.
 * An index built without an embedder is searched by keyword only; if the
 * embedder fails, the error propagates. With a reranker, a wider candidate list
 * is re-ordered by the cross-encoder, so k can stay small (shorter prompts).
 */
export async function hybridSearch(query: string, k: number, deps: HybridSearchDeps): Promise<RetrievedChunk[]> {
  const snapshot = deps.store.current();
  const keywordHits = keywordCandidates(query, deps);
  const vectorHits = await vectorCandidates(query, deps);

  const weights = vectorHits.length ? deps.weights : { vector: 0, keyword: 1 };
  const candidates = fuseWeighted(vectorHits, keywordHits, weights)
    .slice(0, deps.reranker ? Math.max(k, deps.rerankCandidates ?? CANDIDATES_PER_RETRIEVER) : k)
    .flatMap(({ id, score, vectorScore, keywordScore }): RetrievedChunk[] => {
      const chunk = snapshot.getChunk(id);
      return chunk ? [{ chunk, score, vectorScore, keywordScore }] : [];
    });
  if (!deps.reranker) return candidates;

  const rerankScores = await deps.reranker.score(
    query,
    candidates.map(({ chunk }) => chunk.text),
  );
  return candidates
    .map((hit, i) => ({ ...hit, rerankScore: rerankScores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, k);
}

function keywordCandidates(query: string, deps: HybridSearchDeps): ScoredId[] {
  return deps.store.current().keywordSearch(query, CANDIDATES_PER_RETRIEVER);
}

async function vectorCandidates(query: string, deps: HybridSearchDeps): Promise<ScoredId[]> {
  const snapshot = deps.store.current();
  if (!deps.embedder || !snapshot.hasVectors) return [];
  const [queryVector] = await deps.embedder.embed([query], "query");
  return snapshot.vectorSearch(queryVector, CANDIDATES_PER_RETRIEVER);
}

export interface FusedHit {
  id: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

/**
 * Cosine scores (~0..1) and BM25 scores (unbounded) are on different scales, so
 * each list is rescaled to 0..1 before the weighted sum. A chunk missing from a
 * list contributes 0 for that retriever. Cosine scores bunch together, so they
 * are min-max spread; BM25 already has a real zero (no matching term), so it is
 * only divided by the best score: with min-max, the last of two keyword hits
 * would count the same as no match at all.
 */
export function fuseWeighted(vectorHits: ScoredId[], keywordHits: ScoredId[], weights: SearchWeights): FusedHit[] {
  const vectorScores = minMaxNormalize(vectorHits);
  const keywordScores = maxNormalize(keywordHits);
  const totalWeight = weights.vector + weights.keyword || 1;

  const ids = new Set([...vectorScores.keys(), ...keywordScores.keys()]);
  return [...ids]
    .map((id) => {
      const vectorScore = vectorScores.get(id);
      const keywordScore = keywordScores.get(id);
      const score = (weights.vector * (vectorScore ?? 0) + weights.keyword * (keywordScore ?? 0)) / totalWeight;
      return { id, score, vectorScore, keywordScore };
    })
    .sort((a, b) => b.score - a.score);
}

/** Rescales scores to 0..1 (best = 1). If all scores are equal, every hit gets 1. */
export function minMaxNormalize(hits: ScoredId[]): Map<string, number> {
  if (!hits.length) return new Map();
  const scores = hits.map((hit) => hit.score);
  const min = Math.min(...scores);
  const range = Math.max(...scores) - min;
  return new Map(hits.map((hit) => [hit.id, range === 0 ? 1 : (hit.score - min) / range]));
}

/** Divides positive scores by the best one (best = 1, a zero score stays 0). */
export function maxNormalize(hits: ScoredId[]): Map<string, number> {
  const max = Math.max(0, ...hits.map((hit) => hit.score));
  return new Map(hits.map((hit) => [hit.id, max === 0 ? 0 : hit.score / max]));
}
