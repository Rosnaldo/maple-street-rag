import { z } from "zod";
import type { Llm } from "../llm/types.js";
import type { RetrievedChunk } from "../types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import type { Turn } from "./sessions.js";

export const AnswerSchema = z.object({
  // Before "answer" so the model works the numbers out before it writes the reply.
  calculation: z
    .string()
    .describe("Working for any calculation: item, price from the documents, each step with its result, then the total. Empty when nothing is calculated."),
  answer: z.string().describe("The reply shown to the customer"),
  outcome: z.enum(["answer", "not_in_docs", "decline"]),
  citedChunkIds: z.array(z.string()).describe("Ids of the documents used for the answer"),
  citedDocs: z.array(z.string()).describe("File names of the documents used for the answer"),
});

export type ModelAnswer = z.infer<typeof AnswerSchema>;

/** One grounded model call: history + retrieved chunks + today's date -> structured answer. */
export async function generateAnswer(
  llm: Llm,
  { history, message, retrieved, today }: { history: Turn[]; message: string; retrieved: RetrievedChunk[]; today: string },
): Promise<ModelAnswer> {
  return llm.generate({
    system: SYSTEM_PROMPT,
    messages: [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: buildUserPrompt(message, retrieved, today) },
    ],
    schema: AnswerSchema,
    maxTokens: 8000, // includes adaptive thinking tokens
  });
}
