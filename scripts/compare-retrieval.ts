// Hybrid search alone vs hybrid + cross-encoder re-ranking, without calling the chat model.
//   npm run compare -- "How much is the tile saw per day?"   one query, top k side by side
//   npm run compare                                          every cases.json case with mustCite: hit rate @k
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { ingest } from "../src/ingest/index.js";
import { createEmbedder } from "../src/llm/embeddings.js";
import { createReranker } from "../src/retrieval/rerank.js";
import { hybridSearch, type HybridSearchDeps } from "../src/retrieval/search.js";
import { ChunkStore } from "../src/retrieval/store.js";
import type { RetrievedChunk } from "../src/types.js";

interface EvalCase {
  id: string;
  turns: string[];
  expect: { mustCite?: string[] };
}

const config = loadConfig();
const k = config.RETRIEVAL_K;
const embedder = await createEmbedder(config.EMBEDDING_MODEL);
const store = new ChunkStore();
store.replace((await ingest({ docsDir: config.DOCS_DIR, embedder, embeddingCacheFile: ".cache/embeddings.json" })).snapshot);

const hybrid: HybridSearchDeps = { store, embedder, weights: { vector: config.VECTOR_WEIGHT, keyword: config.KEYWORD_WEIGHT } };
const reranked: HybridSearchDeps = {
  ...hybrid,
  reranker: await createReranker(config.RERANK_MODEL || "Xenova/ms-marco-MiniLM-L-6-v2"),
  rerankCandidates: config.RERANK_CANDIDATES,
};

const query = process.argv[2];
if (query) await compareOne(query);
else await compareCases();

async function compareOne(query: string): Promise<void> {
  const semantic = await hybridSearch(query, k, hybrid);
  const rerankedResults = await hybridSearch(query, k, reranked);

  console.log(`Query: ${query}\n`);
  printResults(`Hybrid search only (top ${k})`, semantic);
  printResults(`With re-ranking (top ${k} of ${config.RERANK_CANDIDATES})`, rerankedResults);

  const before = new Set(semantic.map(({ chunk }) => chunk.id));
  const changed = rerankedResults.filter(({ chunk }) => !before.has(chunk.id)).length;
  console.log(changed ? `> Re-ranking changed ${changed} of ${k} results.` : "> Same chunks: re-ranking agreed with hybrid search.");
}

function printResults(title: string, results: RetrievedChunk[]): void {
  console.log(`=== ${title} ===`);
  results.forEach(({ chunk, score, rerankScore }, i) => {
    const scores = `hybrid ${score.toFixed(3)}${rerankScore === undefined ? "" : `, rerank ${rerankScore.toFixed(2)}`}`;
    console.log(`  ${i + 1}. ${chunk.id} (${scores})\n     ${chunk.text.replace(/\s+/g, " ").slice(0, 100)}...`);
  });
  console.log();
}

/**
 * A case counts as a hit when one of its mustCite files is among the k chunks
 * the model would see. Only the last turn is searched, so follow-ups that need
 * the query rewrite are left out.
 */
async function compareCases(): Promise<void> {
  const { cases } = JSON.parse(await readFile("cases.json", "utf8")) as { cases: EvalCase[] };
  const checked = cases.filter((c) => c.turns.length === 1 && c.expect.mustCite?.length);
  const totals = { hybrid: { hits: 0, ms: 0 }, reranked: { hits: 0, ms: 0 } };

  for (const evalCase of checked) {
    const marks: string[] = [];
    for (const [name, deps] of [["hybrid", hybrid], ["reranked", reranked]] as const) {
      const startedAt = Date.now();
      const results = await hybridSearch(evalCase.turns[0], k, deps);
      totals[name].ms += Date.now() - startedAt;
      const hit = results.some(({ chunk }) => evalCase.expect.mustCite!.includes(chunk.file));
      if (hit) totals[name].hits++;
      marks.push(hit ? "ok  " : "MISS");
    }
    console.log(`${marks.join("  ")}  ${evalCase.id}`);
  }

  console.log(`\n${checked.length} single-turn cases with mustCite, k = ${k}`);
  for (const [name, { hits, ms }] of Object.entries(totals)) {
    console.log(`  ${name.padEnd(9)} ${hits}/${checked.length} hits, ${Math.round(ms / checked.length)} ms per query`);
  }
}
