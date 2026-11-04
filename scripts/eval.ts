import "dotenv/config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { SYSTEM_PROMPT } from "../src/chat/prompt.js";
import { QUERY_REWRITE_PROMPT } from "../src/chat/queryRewrite.js";
import { checkCase, type EvalCase, type FinalReply } from "./evalChecks.js";
import { compareRuns } from "./evalCompare.js";
import { renderReport, type CaseResult, type EvalRun } from "./evalReport.js";

const BASE_URL = process.env.EVAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const CASES_FILE = process.env.EVAL_CASES ?? "cases.json";
// Each run writes the next version: eval-results.v1.json/.html, then v2, ...
const resultsFile = (version: number) => `eval-results.v${version}.json`;
const reportFile = (version: number) => `eval-results.v${version}.html`;
const compareFile = (base: number, next: number) => `compared-results.v${base}-v${next}.html`;
// Parallel conversations; each one is a few API calls, so higher values only cost rate limit headroom.
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 1);
const REQUEST_TIMEOUT_MS = 200_000; // above LLM_TIMEOUT_MS (with retries) so the server answers first

async function main(): Promise<void> {
  const { cases: allCases } = JSON.parse(await readFile(CASES_FILE, "utf8")) as { cases: EvalCase[] };
  const cases = selectCases(allCases, process.argv.slice(2));
  await ingestDocs();
  console.log(`Running ${cases.length} cases against ${BASE_URL} (concurrency ${CONCURRENCY})\n`);

  const startedAt = Date.now();
  const results = await mapWithConcurrency(cases, CONCURRENCY, async (evalCase) => {
    const result = await runCase(evalCase);
    printResult(result);
    return result;
  });

  const passed = results.filter((result) => result.pass).length;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nTotal: ${passed}/${results.length} passed (${seconds}s)`);

  const previousVersion = await latestVersion();
  const previous = previousVersion ? (JSON.parse(await readFile(resultsFile(previousVersion), "utf8")) as EvalRun) : undefined;
  const version = previousVersion + 1;

  const merged = cases.length < allCases.length ? mergeWithPrevious(allCases, results, previous) : results;
  const mergedPassed = merged.filter((result) => result.pass).length;
  if (merged !== results) console.log(`Report (with earlier results for the other cases): ${mergedPassed}/${merged.length} passed`);

  const prompts = { answer: SYSTEM_PROMPT, queryRewrite: QUERY_REWRITE_PROMPT };
  const run: EvalRun = { runAt: new Date().toISOString(), baseUrl: BASE_URL, prompts, passed: mergedPassed, total: merged.length, results: merged };
  await writeFile(resultsFile(version), JSON.stringify(run, null, 2));
  await writeFile(reportFile(version), renderReport(run));
  console.log(`Details written to ${resultsFile(version)} and ${reportFile(version)}`);

  if (!previous) return;
  console.log(`Comparing with v${previousVersion}...`);
  const comparison = await compareRuns({ label: `v${previousVersion}`, run: previous }, { label: `v${version}`, run });
  await writeFile(compareFile(previousVersion, version), comparison.html);
  console.log(`${comparison.changes} changed answer(s) written to ${compareFile(previousVersion, version)}`);
}

/** Highest N among eval-results.vN.json in the working directory; 0 when there is none. */
async function latestVersion(): Promise<number> {
  const versions = (await readdir(".")).map((file) => /^eval-results\.v(\d+)\.json$/.exec(file)?.[1]).filter(Boolean).map(Number);
  return Math.max(0, ...versions);
}

/** Case ids from the command line (npm run eval -- hours-04 returns-01); none means all cases. */
function selectCases(cases: EvalCase[], args: string[]): EvalCase[] {
  const ids = args.flatMap((arg) => arg.split(",")).filter(Boolean);
  if (!ids.length) return cases;

  const unknown = ids.filter((id) => !cases.some((evalCase) => evalCase.id === id));
  if (unknown.length) {
    console.error(`Unknown case id(s): ${unknown.join(", ")}`);
    process.exit(1);
  }
  return cases.filter((evalCase) => ids.includes(evalCase.id));
}

/**
 * A partial run replaces only its own cases in the previous version's results; the others
 * keep their last answer. Ordered as in the cases file; cases no longer in it are dropped.
 * With no earlier version the report shows only the cases run now.
 */
function mergeWithPrevious(allCases: EvalCase[], results: CaseResult[], previous: EvalRun | undefined): CaseResult[] {
  const byId = new Map([...(previous?.results ?? []), ...results].map((result) => [result.id, result]));
  return allCases.flatMap((evalCase) => byId.get(evalCase.id) ?? []);
}

/** Sends every turn of a case in one fresh session; only the last reply is checked. */
async function runCase(evalCase: EvalCase): Promise<CaseResult> {
  const sessionId = `eval-${evalCase.id}-${Date.now()}`;
  const startedAt = Date.now();
  let reply: FinalReply = { status: 0, body: {} };

  for (const [index, message] of evalCase.turns.entries()) {
    reply = await postChat({ sessionId, message, ...(evalCase.today ? { today: evalCase.today } : {}) });
    const isLastTurn = index === evalCase.turns.length - 1;
    if (!isLastTurn && reply.status !== 200) break;
  }

  const failures = checkCase(evalCase, reply);
  return {
    id: evalCase.id,
    category: evalCase.category,
    pass: failures.length === 0,
    failures,
    status: reply.status,
    outcome: reply.body.outcome,
    answer: reply.body.answer ?? reply.body.error,
    sources: reply.body.sources,
    note: evalCase.expect.note,
    durationMs: Date.now() - startedAt,
    turns: evalCase.turns,
    expect: evalCase.expect,
  };
}

async function postChat(body: Record<string, string>): Promise<FinalReply> {
  try {
    const response = await fetch(`${BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch (error) {
    return { status: 0, body: { error: (error as Error).message } };
  }
}

function printResult(result: CaseResult): void {
  const label = result.pass ? "PASS" : "FAIL";
  console.log(`${label}  ${result.id.padEnd(14)} ${result.category}`);
  for (const failure of result.failures) console.log(`        - ${failure}`);
}

/** The server starts with an empty index, so the eval asks it to read docs/ first. */
async function ingestDocs(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/ingest`, { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    console.error(`No server at ${BASE_URL}. Start it first with "npm start".`);
    process.exit(1);
  }
  const report = (await response.json()) as { chunks?: number; skipped?: unknown[]; warnings?: string[]; error?: string };
  if (!response.ok) {
    console.error(`POST /ingest failed (${response.status}): ${report.error ?? "unknown error"}`);
    process.exit(1);
  }
  console.log(`Ingested ${report.chunks} chunks (${report.skipped?.length ?? 0} files skipped)`);
  for (const warning of report.warnings ?? []) console.log(`Warning: ${warning}`);
}

/** Runs tasks with at most `limit` in flight; results keep the input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
