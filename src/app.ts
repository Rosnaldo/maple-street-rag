import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import type { z } from "zod";
import { ChatBody, RetrieveQuery, routeDocs } from "./apiSchemas.js";
import { handleChat, type ChatDeps } from "./chat/chatService.js";
import { resolveToday } from "./chat/today.js";
import { renderDocsPage } from "./docsPage.js";
import type { IngestReport } from "./ingest/index.js";
import { LlmTimeoutError, LlmUnavailableError } from "./llm/types.js";
import { hybridSearch } from "./retrieval/search.js";

const DOCS_TITLE = "Maple Street Hardware assistant";

export interface AppDeps {
  chat: ChatDeps;
  reingest: () => Promise<IngestReport>;
  timeZone: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // Route schemas are documentation only: Zod validates in the handlers (clear
  // error messages), and responses are sent as returned, without schema filtering.
  app.setValidatorCompiler(() => () => true);
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: DOCS_TITLE, description: "Answers customer questions only from the store's documents.", version: "1.0.0" },
    },
  });

  // Registered after swagger so every route is picked up by the docs.
  app.register(async (api) => registerRoutes(api, deps));

  app.get("/docs", { schema: { hide: true } }, async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderDocsPage(app.swagger(), DOCS_TITLE)),
  );

  app.setErrorHandler((error, request, reply) => {
    // Model errors from any route (chat, embeddings during ingest or search).
    if (error instanceof LlmTimeoutError) return reply.code(504).send({ error: error.message });
    if (error instanceof LlmUnavailableError) {
      request.log.error(error);
      return reply.code(502).send({ error: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (error as Error).message }); // e.g. malformed JSON
    request.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  return app;
}

function registerRoutes(api: FastifyInstance, deps: AppDeps): void {
  api.post("/chat", { schema: routeDocs.chat }, async (request, reply) => {
    const body = ChatBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error) });

    // Without documents every answer would be "not in the docs", so refuse clearly instead.
    if (!deps.chat.search.store.current().chunks.length) {
      return reply.code(503).send({ error: "No documents indexed yet: call POST /ingest first" });
    }

    const { sessionId, message, today } = body.data;
    return handleChat(deps.chat, { sessionId, message, today: resolveToday(today, deps.timeZone) });
  });

  api.post("/ingest", { schema: routeDocs.ingest }, async () => deps.reingest());

  api.get("/debug/retrieve", { schema: routeDocs.retrieve }, async (request, reply) => {
    const query = RetrieveQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: firstIssue(query.error) });

    const results = await hybridSearch(query.data.q, query.data.k, deps.chat.search);
    return {
      query: query.data.q,
      results: results.map(({ chunk, score, vectorScore, keywordScore, rerankScore }) => ({
        chunkId: chunk.id,
        file: chunk.file,
        score: round(score),
        vectorScore: vectorScore === undefined ? null : round(vectorScore),
        keywordScore: keywordScore === undefined ? null : round(keywordScore),
        rerankScore: rerankScore === undefined ? null : round(rerankScore),
        text: chunk.text,
      })),
    };
  });
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  return issue.code === "invalid_type" ? `${issue.path.join(".") || "body"} is missing or invalid` : issue.message;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
