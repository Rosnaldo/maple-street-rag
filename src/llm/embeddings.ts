import { env, pipeline } from "@huggingface/transformers";
import { LlmUnavailableError } from "./types.js";

// Model files are downloaded once from Hugging Face, next to the embedding cache.
env.cacheDir = ".cache/models";

export type EmbeddingKind = "document" | "query";

export interface Embedder {
  /** Model name, used as the cache namespace. */
  id: string;
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

const BATCH_SIZE = 16;

/**
 * Embeddings computed in-process on CPU through ONNX, like the re-ranker. The
 * same embedder is used for documents and queries, so both are always in the
 * same vector space. Vectors come back unit-length, so cosine similarity is a
 * plain dot product.
 */
export async function createEmbedder(model: string): Promise<Embedder> {
  const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
  // nomic-embed-text expects task prefixes; other models ignore them harmlessly.
  const prefix = (kind: EmbeddingKind) => (model.includes("nomic") ? `search_${kind}: ` : "");

  return {
    id: model,
    async embed(texts, kind) {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        const input = texts.slice(start, start + BATCH_SIZE).map((text) => prefix(kind) + text);
        try {
          const output = await extractor(input, { pooling: "mean", normalize: true });
          vectors.push(...(output.tolist() as number[][]));
        } catch (error) {
          throw new LlmUnavailableError(`Embedding failed: ${(error as Error).message}`);
        }
      }
      return vectors;
    },
  };
}
