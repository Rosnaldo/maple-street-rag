import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { createAnthropic } from "../src/llm/anthropic.js";
import type { Llm } from "../src/llm/types.js";
import { escapeHtml, STYLES, type CaseResult, type EvalRun } from "./evalReport.js";

export interface LabeledRun {
  label: string; // "v1"
  run: EvalRun;
}

/** A case whose reply changed between two runs; base or next is missing when only one run has the case. */
export interface CaseChange {
  id: string;
  base?: CaseResult;
  next?: CaseResult;
}

/** What the comparison says about the changes: an overall note and, when analysed, one per case. */
export interface ChangeNote {
  summary: string;
  byCase: Map<string, string>;
}

export interface DiffPart {
  kind: "same" | "added" | "removed";
  text: string;
}

const ANALYSIS_TIMEOUT_MS = 300_000; // one call with every changed case, longer than a chat answer

/** Compares two runs and renders only the cases whose answer, outcome or pass/fail changed. */
export async function compareRuns(base: LabeledRun, next: LabeledRun, llm?: Llm): Promise<{ html: string; changes: number }> {
  const changes = findChanges(base.run.results, next.run.results);
  const note = await explainChanges(base, next, changes, llm);
  return { html: renderComparison(base, next, changes, note), changes: changes.length };
}

/** Whitespace differences do not count; cases in only one run always do. Ordered as in the next run. */
export function findChanges(base: CaseResult[], next: CaseResult[]): CaseChange[] {
  const baseById = new Map(base.map((result) => [result.id, result]));
  const nextIds = new Set(next.map((result) => result.id));
  const changed = next.flatMap((result) => {
    const previous = baseById.get(result.id);
    return !previous || replyChanged(previous, result) ? [{ id: result.id, base: previous, next: result }] : [];
  });
  const removed = base.filter((result) => !nextIds.has(result.id)).map((result) => ({ id: result.id, base: result }));
  return [...changed, ...removed];
}

function replyChanged(a: CaseResult, b: CaseResult): boolean {
  return normalize(a.answer) !== normalize(b.answer) || a.outcome !== b.outcome || a.pass !== b.pass;
}

function normalize(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Word-level diff (longest common subsequence); whitespace is kept so the parts join back into each text. */
export function diffWords(before: string, after: string): DiffPart[] {
  return diffTokens(tokenize(before), tokenize(after));
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

function diffTokens(before: string[], after: string[]): DiffPart[] {
  const lcs = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      push("same", before[i]);
      i++;
      j++;
    } else if (j < after.length && (i === before.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      push("added", after[j++]);
    } else {
      push("removed", before[i++]);
    }
  }
  return parts;
}

const AnalysisSchema = z.object({
  summary: z.string().describe("Overall note: which prompt changes explain which kinds of answer changes, and which changes look unrelated to the prompt"),
  cases: z.array(
    z.object({
      id: z.string().describe("Case id exactly as given"),
      explanation: z.string().describe("Why this answer changed, naming the prompt change responsible, or why it is likely unrelated to the prompt"),
    }),
  ),
});

const ANALYSIS_SYSTEM = `You help a developer understand how changing the prompts of a retrieval-augmented chat assistant (a hardware store's website assistant) changed its answers in an evaluation run.
You get the prompts of the earlier run and of the later run, then every eval case whose final answer, outcome or pass/fail changed, with both answers.
For each case, explain why the answer changed: point to the specific prompt change (quote the added or removed wording) that most plausibly caused it and how. If the change is only wording with no link to a prompt change, say it is most likely normal variation between model runs. Retrieval, code and document changes are not recorded, so when a change cannot come from the prompts (for example different source documents), say it may come from those.
Note whether a change made the answer better or worse against the case's expectation (pass/fail and the reviewer note).
Be specific and concise. Write plain text, no markdown.`;

async function explainChanges(base: LabeledRun, next: LabeledRun, changes: CaseChange[], llm?: Llm): Promise<ChangeNote> {
  const byCase = new Map<string, string>();
  const missing = [base, next].filter(({ run }) => !run.prompts).map(({ label }) => label);
  if (missing.length) {
    return { summary: `${missing.join(" and ")} did not record its prompts, so the changes cannot be linked to a prompt difference.`, byCase };
  }
  if (samePrompts(base.run, next.run)) {
    return {
      summary:
        "The prompts are the same in both runs, so these differences do not come from a prompt change. Model output varies between runs, and retrieval, code or document changes are not recorded in the results.",
      byCase,
    };
  }
  if (!changes.length) return { summary: "The prompts changed, but no answer did.", byCase };

  try {
    const config = loadConfig();
    const model = llm ?? createAnthropic({ ...config, LLM_TIMEOUT_MS: Math.max(config.LLM_TIMEOUT_MS, ANALYSIS_TIMEOUT_MS) });
    const analysis = await model.generate({
      system: ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: buildAnalysisPrompt(base, next, changes) }],
      schema: AnalysisSchema,
      maxTokens: 32_000, // includes adaptive thinking tokens
    });
    for (const { id, explanation } of analysis.cases) byCase.set(id, explanation);
    return { summary: analysis.summary, byCase };
  } catch (error) {
    return { summary: `The changes could not be analysed with the model (${(error as Error).message}). The prompt differences are shown below.`, byCase };
  }
}

function samePrompts(a: EvalRun, b: EvalRun): boolean {
  return a.prompts?.answer === b.prompts?.answer && a.prompts?.queryRewrite === b.prompts?.queryRewrite;
}

function buildAnalysisPrompt(base: LabeledRun, next: LabeledRun, changes: CaseChange[]): string {
  const prompts = (run: LabeledRun) => `<prompts run="${run.label}">
<answer_system_prompt>
${run.run.prompts?.answer}
</answer_system_prompt>
<query_rewrite_system_prompt>
${run.run.prompts?.queryRewrite}
</query_rewrite_system_prompt>
</prompts>`;
  const reply = (label: string, result?: CaseResult) =>
    result
      ? `<reply run="${label}" outcome="${result.outcome ?? ""}" result="${result.pass ? "pass" : "fail"}" sources="${citedFiles(result).join(", ")}">
${result.failures.length ? `Failed checks: ${result.failures.join("; ")}\n` : ""}${result.answer ?? ""}
</reply>`
      : `<reply run="${label}">(case not in this run)</reply>`;
  const cases = changes.map(({ id, base: before, next: after }) => {
    const result = (after ?? before)!;
    return `<case id="${id}" category="${result.category}">
${result.turns.map((turn, index) => `Customer turn ${index + 1}: ${turn}`).join("\n")}
${result.expect.note ? `Reviewer note: ${result.expect.note}\n` : ""}${reply(base.label, before)}
${reply(next.label, after)}
</case>`;
  });
  return `${prompts(base)}\n\n${prompts(next)}\n\n<changed_cases>\n${cases.join("\n\n")}\n</changed_cases>`;
}

function citedFiles(result: CaseResult): string[] {
  return [...new Set((result.sources ?? []).map((source) => source.file))];
}

function renderComparison(base: LabeledRun, next: LabeledRun, changes: CaseChange[], note: ChangeNote): string {
  const title = `Compared results ${base.label}–${next.label}`;
  const runMeta = ({ label, run }: LabeledRun) =>
    `<div class="run"><strong>${escapeHtml(label)}</strong> <span>${run.passed}/${run.total} passed</span>
      <span class="meta">${escapeHtml(new Date(run.runAt).toLocaleString())}</span></div>`;
  const changeList = changes.length
    ? changes.map((change) => renderChange(change, base.label, next.label, note.byCase.get(change.id))).join("")
    : `<p class="empty">No answer changed.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}${COMPARE_STYLES}</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Only the cases whose answer, outcome or pass/fail changed (${changes.length} of ${next.run.results.length}).</p>
  </header>

  <section class="summary runs">${runMeta(base)}${runMeta(next)}</section>

  <section>
    <h2>Note</h2>
    <div class="note">${paragraphs(note.summary)}</div>
  </section>

  <section>
    <h2>Prompt changes</h2>
    ${renderPromptDiff("Answer system prompt", base.run.prompts?.answer, next.run.prompts?.answer)}
    ${renderPromptDiff("Query rewrite prompt", base.run.prompts?.queryRewrite, next.run.prompts?.queryRewrite)}
  </section>

  <section>
    <h2>Changed answers</h2>
    ${changeList}
  </section>
</main>
</body>
</html>
`;
}

function renderPromptDiff(name: string, before: string | undefined, after: string | undefined): string {
  if (before === undefined || after === undefined) return `<h3>${name}</h3><p class="empty">Not recorded in both runs.</p>`;
  if (before === after) return `<h3>${name}</h3><p class="empty">Unchanged.</p>`;
  const html = diffWords(before, after)
    .map(({ kind, text }) => (kind === "same" ? escapeHtml(text) : kind === "added" ? `<ins>${escapeHtml(text)}</ins>` : `<del>${escapeHtml(text)}</del>`))
    .join("");
  return `<h3>${name}</h3><pre class="prompt">${html}</pre>`;
}

function renderChange({ id, base, next }: CaseChange, baseLabel: string, nextLabel: string, explanation?: string): string {
  const result = (next ?? base)!;
  const turns = result.turns
    .map((turn, index) => `<li><span class="turn-label">Turn ${index + 1}</span>${escapeHtml(turn) || "<em>(empty)</em>"}</li>`)
    .join("");
  const parts = diffWords(base?.answer ?? "", next?.answer ?? "");
  const status = (r?: CaseResult) => (r ? `<span class="badge ${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</span>` : `<span class="badge">—</span>`);

  return `
  <details class="case change" open>
    <summary>
      <span class="case-id">${escapeHtml(id)}</span>
      <span class="category">${escapeHtml(result.category)}</span>
      ${status(base)}<span class="arrow">→</span>${status(next)}
    </summary>
    <div class="case-body">
      <h3>Conversation</h3>
      <ol class="turns">${turns}</ol>
      ${result.expect.note ? `<h3>Reviewer note</h3><p class="reviewer">${escapeHtml(result.expect.note)}</p>` : ""}
      ${explanation ? `<h3>Why it changed</h3><div class="note">${paragraphs(explanation)}</div>` : ""}
      <div class="sides">
        ${renderSide(baseLabel, base, parts, "removed")}
        ${renderSide(nextLabel, next, parts, "added")}
      </div>
    </div>
  </details>`;
}

/** One run's answer, highlighting the words only it has (removed for the earlier run, added for the later one). */
function renderSide(label: string, result: CaseResult | undefined, parts: DiffPart[], own: "added" | "removed"): string {
  if (!result) return `<div class="side"><h3>${escapeHtml(label)}</h3><p class="empty">Case not in this run.</p></div>`;
  const tag = own === "added" ? "ins" : "del";
  const answer = parts
    .filter(({ kind }) => kind === "same" || kind === own)
    .map(({ kind, text }) => (kind === "same" ? escapeHtml(text) : `<${tag}>${escapeHtml(text)}</${tag}>`))
    .join("");
  const failures = result.failures.length
    ? `<ul class="failures">${result.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul>`
    : "";
  const sources = citedFiles(result).map((file) => `<code>${escapeHtml(file)}</code>`).join(" ") || "<em>none</em>";

  return `<div class="side">
    <h3>${escapeHtml(label)} <span class="tag">HTTP ${result.status}${result.outcome ? ` · ${escapeHtml(result.outcome)}` : ""}</span></h3>
    <pre class="answer">${answer || "<em>(no answer)</em>"}</pre>
    ${failures}
    <p class="sources">${sources}</p>
  </div>`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
    .join("");
}

const COMPARE_STYLES = `
:root { --ins-bg: #d6f0df; --del-bg: #f8d7d3; }
@media (prefers-color-scheme: dark) { :root { --ins-bg: #1f4a31; --del-bg: #5a2621; } }
.runs { display: flex; gap: 32px; flex-wrap: wrap; }
.run strong { font-size: 20px; margin-right: 8px; }
.run .meta { display: block; }
.note { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 4px 14px; }
.case-body .note { background: var(--code-bg); border: 0; }
.empty, .reviewer { color: var(--muted); margin: 0; }
pre.prompt { font-family: inherit; font-size: 14px; }
ins { background: var(--ins-bg); text-decoration: none; border-radius: 3px; }
del { background: var(--del-bg); border-radius: 3px; }
.change { border-left: 4px solid var(--muted); }
.change .badge { color: var(--muted); background: var(--code-bg); }
.change .badge.pass { color: var(--pass); background: var(--pass-bg); }
.change .badge.fail { color: var(--fail); background: var(--fail-bg); }
.arrow { color: var(--muted); margin: 0 -6px; }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 700px) { .sides { grid-template-columns: 1fr; } }
.side .failures { margin-top: 8px; }
.side .sources { margin-top: 6px; }
`;
