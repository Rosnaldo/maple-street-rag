import type { FastifySchema } from "fastify";
import { z } from "zod";
import { isValidIsoDate } from "./chat/today.js";

/*
 * Request schemas validate input in the route handlers. Every schema here is
 * also converted to JSON Schema for the OpenAPI docs, so the docs can't drift
 * from what the code accepts and returns.
 */

export const ChatBody = z.object({
  sessionId: z.string().trim().min(1, "sessionId is required").max(200).describe("Conversation id; reuse it for follow-ups"),
  message: z
    .string()
    .trim()
    .min(1, "message must not be empty")
    .max(2000, "message is too long (max 2000 characters)")
    .describe("The customer's question"),
  today: z
    .string()
    .refine(isValidIsoDate, "today must be a date in YYYY-MM-DD format")
    .optional()
    .describe("Current date as YYYY-MM-DD; defaults to the store's local date"),
});

export const RetrieveQuery = z.object({
  q: z.string().trim().min(1, "q is required").describe("Search text"),
  k: z.coerce.number().int().min(1).max(50).default(5).describe("Number of chunks to return"),
});

const ChatResponse = z.object({
  answer: z.string(),
  outcome: z.enum(["answer", "not_in_docs", "decline"]),
  sources: z.array(z.object({ file: z.string(), chunkId: z.string() })),
});

const IngestResponse = z.object({
  indexed: z.array(z.string()).describe("Files that were chunked and indexed"),
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })).describe("Files left out, with the reason"),
  chunks: z.number().int(),
  warnings: z.array(z.string()).optional().describe("Present when the index was built without embeddings"),
});

const RetrieveResponse = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      chunkId: z.string(),
      file: z.string(),
      score: z.number().describe("Weighted hybrid score, 0..1"),
      vectorScore: z.number().nullable().describe("Normalized vector score, null when not a vector candidate"),
      keywordScore: z.number().nullable().describe("Normalized BM25 score, null when not a keyword candidate"),
      rerankScore: z.number().nullable().describe("Cross-encoder score (results are ordered by it), null when re-ranking is off"),
      text: z.string(),
    }),
  ),
});

function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io });
  return rest;
}

// Only the success response is documented; errors are always { error: string }.
export const routeDocs: Record<"chat" | "ingest" | "retrieve", FastifySchema> = {
  chat: {
    tags: ["chat"],
    summary: "Ask a question",
    description: "Retrieves the relevant chunks, answers only from them, and returns the sources.",
    body: jsonSchema(ChatBody, "input"),
    response: { 200: { description: "Answer with its sources", ...jsonSchema(ChatResponse) } },
  },
  ingest: {
    tags: ["ingest"],
    summary: "Re-read docs/",
    description: "Re-reads every file in docs/ and swaps in a new index without a restart.",
    response: { 200: { description: "Ingest report", ...jsonSchema(IngestResponse) } },
  },
  retrieve: {
    tags: ["debug"],
    summary: "Top chunks for a query",
    description: "Runs hybrid retrieval only (no model call) and shows each chunk's scores.",
    querystring: jsonSchema(RetrieveQuery, "input"),
    response: { 200: { description: "Ranked chunks", ...jsonSchema(RetrieveResponse) } },
  },
};
