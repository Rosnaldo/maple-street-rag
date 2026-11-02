import { buildApp } from "./app.js";
import { SessionStore } from "./chat/sessions.js";
import { loadConfig } from "./config.js";
import { ingest } from "./ingest/index.js";
import { createAnthropic } from "./llm/anthropic.js";
import { createEmbedder } from "./llm/embeddings.js";
import { createReranker } from "./retrieval/rerank.js";
import { ChunkStore } from "./retrieval/store.js";

const EMBEDDING_CACHE_FILE = ".cache/embeddings.json";

async function main(): Promise<void> {
  const config = loadConfig();

  const store = new ChunkStore();
  // Loaded before listening, so the first /chat does not pay for the model downloads.
  const embedder = await createEmbedder(config.EMBEDDING_MODEL);
  const reranker = config.RERANK_MODEL ? await createReranker(config.RERANK_MODEL) : undefined;

  const reingest = async () => {
    const { snapshot, report } = await ingest({
      docsDir: config.DOCS_DIR,
      embedder,
      embeddingCacheFile: EMBEDDING_CACHE_FILE,
    });
    store.replace(snapshot);
    return report;
  };

  const app = buildApp({
    chat: {
      llm: createAnthropic(config),
      sessions: new SessionStore(),
      k: config.RETRIEVAL_K,
      search: {
        store,
        embedder,
        weights: { vector: config.VECTOR_WEIGHT, keyword: config.KEYWORD_WEIGHT },
        reranker,
        rerankCandidates: config.RERANK_CANDIDATES,
      },
    },
    reingest,
    timeZone: config.STORE_TIMEZONE,
  });

  app.log.info({ chat: `anthropic:${config.CHAT_MODEL}`, embeddings: embedder.id, reranker: reranker?.id ?? "off" }, "Models");
  app.log.info("Index is empty: call POST /ingest to read docs/");

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
