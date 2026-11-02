import type { z } from "zod";

export class LlmTimeoutError extends Error {}
export class LlmUnavailableError extends Error {}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest<T extends z.ZodType> {
  system: string;
  messages: LlmMessage[];
  schema: T;
  maxTokens: number;
}

/** A chat model that returns JSON validated against a Zod schema. */
export interface Llm {
  generate<T extends z.ZodType>(request: LlmRequest<T>): Promise<z.infer<T>>;
}
