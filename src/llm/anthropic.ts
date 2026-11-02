import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Config } from "../config.js";
import { createSpendGuard } from "./spendGuard.js";
import { LlmTimeoutError, LlmUnavailableError, type Llm } from "./types.js";

const SPEND_FILE = ".cache/anthropic-spend.json";

/**
 * Claude through the Anthropic API (key from ANTHROPIC_API_KEY). The Zod schema
 * is sent as a structured output format, so the reply is JSON in that shape.
 * Thinking is adaptive: the model decides per question how much to reason.
 * Every call is checked against ANTHROPIC_BUDGET_USD before it is sent.
 */
export function createAnthropic(config: Config): Llm {
  const client = new Anthropic({ timeout: config.LLM_TIMEOUT_MS, maxRetries: 2 });
  const guard = createSpendGuard(config.CHAT_MODEL, config.ANTHROPIC_BUDGET_USD, SPEND_FILE);

  return {
    async generate({ system, messages, schema, maxTokens }) {
      guard.check();
      let response;
      try {
        response = await client.messages.parse({
          model: config.CHAT_MODEL,
          max_tokens: maxTokens,
          system,
          messages,
          output_config: { format: zodOutputFormat(schema), effort: config.ANTHROPIC_EFFORT },
        });
      } catch (error) {
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new LlmTimeoutError("The language model did not respond in time");
        if (error instanceof Anthropic.APIError) throw new LlmUnavailableError(`Anthropic API error ${error.status ?? ""}: ${error.message}`);
        throw new LlmUnavailableError(`Model output did not match the schema: ${(error as Error).message}`);
      }
      guard.record(response.usage);
      if (response.stop_reason === "refusal") throw new LlmUnavailableError("The model declined to answer");
      if (response.stop_reason === "max_tokens") throw new LlmUnavailableError("Model output cut off by the token limit");
      if (!response.parsed_output) throw new LlmUnavailableError("Model output did not match the schema");
      return response.parsed_output;
    },
  };
}
