import { AutoModelForSequenceClassification, AutoTokenizer, env } from "@huggingface/transformers";

// Model files are downloaded once from Hugging Face, next to the embedding cache.
env.cacheDir = ".cache/models";

export interface Reranker {
  id: string;
  /** One relevance score per text (higher = more relevant); only the order matters. */
  score(query: string, texts: string[]): Promise<number[]>;
}

/**
 * Cross-encoder re-ranker: reads the query and each chunk together, which ranks
 * more precisely than comparing two separate embeddings. It is too slow for the
 * whole index, so it only re-orders the hybrid search candidates. Runs on CPU
 * through ONNX, like the embeddings.
 */
export async function createReranker(model: string): Promise<Reranker> {
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const classifier = await AutoModelForSequenceClassification.from_pretrained(model, { dtype: "q8" });

  return {
    id: model,
    async score(query, texts) {
      if (!texts.length) return [];
      const inputs = tokenizer(new Array(texts.length).fill(query), { text_pair: texts, padding: true, truncation: true });
      const { logits } = await classifier(inputs);
      return (logits.tolist() as number[][]).map(([score]) => score);
    },
  };
}
