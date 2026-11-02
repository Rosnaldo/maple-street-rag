import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DOCS_DIR: z.string().default("docs"),
  CHAT_MODEL: z.string().trim().min(1).default("claude-haiku-5-5"),
  // How hard the model thinks before answering (adaptive thinking).
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  // Calls stop once the estimated spend reaches this (see llm/spendGuard.ts).
  ANTHROPIC_BUDGET_USD: z.coerce.number().positive().default(5),
  EMBEDDING_MODEL: z.string().trim().min(1).default("nomic-ai/nomic-embed-text-v1.5"),
  RETRIEVAL_K: z.coerce.number().int().positive().default(5),
  // Cross-encoder that re-orders the hybrid candidates; empty disables re-ranking.
  RERANK_MODEL: z.string().trim().default("Xenova/ms-marco-MiniLM-L-6-v2"),
  RERANK_CANDIDATES: z.coerce.number().int().positive().default(20),
  VECTOR_WEIGHT: z.coerce.number().min(0).default(0.6),
  KEYWORD_WEIGHT: z.coerce.number().min(0).default(0.4),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  STORE_TIMEZONE: z.string().default("America/New_York"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
