import type { Llm } from "../llm/types.js";
import { hybridSearch, type HybridSearchDeps } from "../retrieval/search.js";
import type { ChatResponse, ChatSource, RetrievedChunk } from "../types.js";
import { generateAnswer, type ModelAnswer } from "./answer.js";
import { rewriteQuery } from "./queryRewrite.js";
import type { SessionStore } from "./sessions.js";

export interface ChatDeps {
  llm: Llm;
  sessions: SessionStore;
  search: HybridSearchDeps;
  k: number;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  today: string;
}

/** history -> standalone query -> hybrid retrieval -> grounded answer -> sources. */
export async function handleChat(deps: ChatDeps, { sessionId, message, today }: ChatRequest): Promise<ChatResponse> {
  const history = deps.sessions.getHistory(sessionId);
  const query = await rewriteQuery(deps.llm, history, message);
  const retrieved = await hybridSearch(query, deps.k, deps.search);

  const result = await generateAnswer(deps.llm, { history, message, retrieved, today });
  deps.sessions.appendExchange(sessionId, message, result.answer);

  return { answer: result.answer, outcome: result.outcome, sources: toSources(result, retrieved) };
}

/**
 * Only ids that were really retrieved count, so the model cannot invent a citation.
 * A file named in citedDocs adds its retrieved chunks; unknown file names are ignored.
 */
export function toSources(result: ModelAnswer, retrieved: RetrievedChunk[]): ChatSource[] {
  if (result.outcome === "decline") return [];
  const retrievedById = new Map(retrieved.map(({ chunk }) => [chunk.id, chunk]));
  const citedDocs = new Set(result.citedDocs);
  const docChunkIds = retrieved.filter(({ chunk }) => citedDocs.has(chunk.file)).map(({ chunk }) => chunk.id);
  const ids = [...new Set([...result.citedChunkIds, ...docChunkIds])].filter((id) => retrievedById.has(id));
  return ids.map((id) => ({ file: retrievedById.get(id)!.file, chunkId: id }));
}
