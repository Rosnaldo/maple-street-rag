import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LlmUnavailableError } from "./types.js";

// USD per million tokens, for prompts up to 100K tokens (the app sends a few thousand).
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export interface SpendGuard {
  /** Throws once the estimated spend has reached the budget. */
  check(): void;
  record(usage: { input_tokens: number; output_tokens: number }): void;
}

/**
 * Estimated API spend, kept in a file so it survives restarts and adds up across
 * eval runs. It is an estimate from token counts: the spend limit set in the
 * Claude Console is the hard cap. Delete the file to start counting from zero.
 */
export function createSpendGuard(model: string, budgetUsd: number, file: string): SpendGuard {
  const price = PRICES[model];
  if (!price) throw new Error(`No price known for ${model}: add it to PRICES in src/llm/spendGuard.ts`);
  let spentUsd = readSpent(file);

  return {
    check() {
      if (spentUsd >= budgetUsd) {
        throw new LlmUnavailableError(`Spend limit reached: about $${spentUsd.toFixed(4)} of $${budgetUsd} used (ANTHROPIC_BUDGET_USD, ${file})`);
      }
    },
    record(usage) {
      spentUsd += (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1e6;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ spentUsd }));
    },
  };
}

function readSpent(file: string): number {
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { spentUsd: number }).spentUsd;
  } catch {
    return 0;
  }
}
