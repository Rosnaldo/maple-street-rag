import { z } from "zod";
import type { Llm } from "../llm/types.js";
import type { Turn } from "./sessions.js";

const RewriteSchema = z.object({
  query: z.string().describe("The customer's latest message rewritten as a standalone search query"),
});

const SYSTEM = `You turn the latest message in a hardware store chat into a standalone search query.
Resolve pronouns and references ("it", "that one", "and the pressure washer?") using the conversation, and fix obvious typos.
Keep the customer's intent and wording otherwise; do not answer the question or add facts.
If the latest message is unrelated to the earlier conversation, return it unchanged.`;

/**
 * Follow-ups like "How much is the deposit on it?" retrieve the wrong chunks on
 * their own, so they are rewritten with the conversation first. First messages
 * skip the extra model call.
 */
export async function rewriteQuery(llm: Llm, history: Turn[], message: string): Promise<string> {
  if (!history.length) return message;

  const conversation = history.map((turn) => `${turn.role === "user" ? "Customer" : "Assistant"}: ${turn.content}`);
  const { query } = await llm.generate({
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `<conversation>\n${conversation.join("\n")}\n</conversation>\n\nLatest message: ${message}`,
      },
    ],
    schema: RewriteSchema,
    maxTokens: 2000, // includes adaptive thinking tokens
  });
  return query.trim() || message;
}
