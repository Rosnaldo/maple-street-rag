export interface CaseExpectation {
  outcome?: "answer" | "not_in_docs" | "decline";
  mustInclude?: string[][];
  mustNotInclude?: string[];
  mustCite?: string[];
  mustNotCite?: string[];
  note?: string;
}

export interface EvalCase {
  id: string;
  category: string;
  today?: string;
  turns: string[];
  expect: CaseExpectation;
}

/** What the server returned for the last turn of a case. */
export interface FinalReply {
  status: number;
  body: { answer?: string; outcome?: string; sources?: { file: string; chunkId: string }[]; error?: string };
}

/**
 * Applies the rules from the top of cases.json to the last reply and returns
 * the list of failures (empty = pass). All string checks are case-insensitive.
 */
export function checkCase(evalCase: EvalCase, reply: FinalReply): string[] {
  const lastTurn = evalCase.turns.at(-1) ?? "";
  if (!lastTurn.trim()) {
    // Bad input: a clear 400 (or a polite 200 reply) passes; a crash does not.
    return reply.status === 400 || reply.status === 200 ? [] : [`expected 400 for empty message, got ${reply.status}`];
  }
  if (reply.status !== 200) return [`HTTP ${reply.status}: ${reply.body.error ?? "no error message"}`];

  const { expect } = evalCase;
  const answer = (reply.body.answer ?? "").toLowerCase();
  const citedFiles = new Set((reply.body.sources ?? []).map((source) => source.file));
  const failures: string[] = [];

  if (expect.outcome && reply.body.outcome !== expect.outcome) {
    failures.push(`outcome "${reply.body.outcome}", expected "${expect.outcome}"`);
  }
  for (const group of expect.mustInclude ?? []) {
    if (!group.some((text) => answer.includes(text.toLowerCase()))) failures.push(`missing one of ${JSON.stringify(group)}`);
  }
  for (const text of expect.mustNotInclude ?? []) {
    if (answer.includes(text.toLowerCase())) failures.push(`contains forbidden "${text}"`);
  }
  if (expect.mustCite?.length && !expect.mustCite.some((file) => citedFiles.has(file))) {
    failures.push(`cites none of ${JSON.stringify(expect.mustCite)}`);
  }
  for (const file of expect.mustNotCite ?? []) {
    if (citedFiles.has(file)) failures.push(`cites forbidden ${file}`);
  }
  return failures;
}
