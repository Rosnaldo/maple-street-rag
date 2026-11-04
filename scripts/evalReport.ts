import type { CaseExpectation, FinalReply } from "./evalChecks.js";

export interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  failures: string[];
  status: number;
  outcome?: string;
  answer?: string;
  sources?: FinalReply["body"]["sources"];
  note?: string;
  durationMs: number;
  turns: string[];
  expect: CaseExpectation;
}

export interface EvalRun {
  runAt: string;
  baseUrl: string;
  /** Prompts in the code at run time, to compare runs after prompt changes. */
  prompts?: { answer: string; queryRewrite: string };
  passed: number;
  total: number;
  results: CaseResult[];
}

/** Renders a run as one self-contained HTML page (no external assets). */
export function renderReport(run: EvalRun): string {
  const percent = run.total ? Math.round((run.passed / run.total) * 100) : 0;
  const totalSeconds = (run.results.reduce((sum, result) => sum + result.durationMs, 0) / 1000).toFixed(1);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval Report</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <header>
    <h1>Eval report</h1>
    <p class="meta">${escapeHtml(new Date(run.runAt).toLocaleString())} · ${escapeHtml(run.baseUrl)} · ${totalSeconds}s</p>
  </header>

  <section class="summary">
    <div class="score ${run.passed === run.total ? "all-pass" : ""}">
      <strong>${run.passed}/${run.total}</strong>
      <span>passed (${percent}%)</span>
    </div>
    <div class="bar" role="img" aria-label="${percent}% passed"><div style="width:${percent}%"></div></div>
  </section>

  <section>
    <h2>By category</h2>
    <table class="categories">
      <thead><tr><th>Category</th><th>Passed</th><th></th></tr></thead>
      <tbody>${renderCategoryRows(run.results)}</tbody>
    </table>
  </section>

  <section>
    <div class="cases-head">
      <h2>Cases</h2>
      <label><input type="checkbox" id="only-failures"> Show failures only</label>
    </div>
    <div id="cases">${run.results.map(renderCase).join("")}</div>
  </section>
</main>
<script>
  document.getElementById("only-failures").addEventListener("change", (event) => {
    document.getElementById("cases").classList.toggle("only-failures", event.target.checked);
  });
</script>
</body>
</html>
`;
}

function renderCategoryRows(results: CaseResult[]): string {
  const byCategory = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byCategory.get(result.category) ?? { passed: 0, total: 0 };
    entry.total++;
    if (result.pass) entry.passed++;
    byCategory.set(result.category, entry);
  }
  return [...byCategory.entries()]
    .sort(([, a], [, b]) => a.passed / a.total - b.passed / b.total)
    .map(([category, { passed, total }]) => {
      const percent = Math.round((passed / total) * 100);
      return `<tr><td>${escapeHtml(category)}</td><td class="num">${passed}/${total}</td>
        <td class="bar-cell"><div class="bar small"><div style="width:${percent}%"></div></div></td></tr>`;
    })
    .join("");
}

function renderCase(result: CaseResult): string {
  const turns = result.turns
    .map((turn, index) => `<li><span class="turn-label">Turn ${index + 1}</span>${escapeHtml(turn) || "<em>(empty)</em>"}</li>`)
    .join("");
  const failures = result.failures.length
    ? `<ul class="failures">${result.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul>`
    : "";
  const sources = result.sources?.length
    ? [...new Set(result.sources.map((source) => source.file))].map((file) => `<code>${escapeHtml(file)}</code>`).join(" ")
    : "<em>none</em>";

  return `
  <details class="case ${result.pass ? "pass" : "fail"}"${result.pass ? "" : " open"}>
    <summary>
      <span class="badge">${result.pass ? "PASS" : "FAIL"}</span>
      <span class="case-id">${escapeHtml(result.id)}</span>
      <span class="category">${escapeHtml(result.category)}</span>
      <span class="duration">${(result.durationMs / 1000).toFixed(1)}s</span>
    </summary>
    <div class="case-body">
      ${failures}
      <h3>Conversation</h3>
      <ol class="turns">${turns}</ol>
      <h3>Answer <span class="tag">HTTP ${result.status}${result.outcome ? ` · ${escapeHtml(result.outcome)}` : ""}</span></h3>
      <pre class="answer">${escapeHtml(result.answer ?? "") || "<em>(no answer)</em>"}</pre>
      <h3>Sources</h3>
      <p class="sources">${sources}</p>
      <h3>Expected</h3>
      <pre class="expect">${escapeHtml(JSON.stringify(result.expect, null, 2))}</pre>
    </div>
  </details>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const STYLES = `
:root {
  --bg: #f7f7f5; --surface: #fff; --text: #1d1d1b; --muted: #6b6b66; --border: #e3e3de;
  --pass: #1f7a4d; --pass-bg: #e3f3ea; --fail: #b3261e; --fail-bg: #fbe7e5; --code-bg: #f0f0ec;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --surface: #1f1f1d; --text: #ececea; --muted: #9a9a94; --border: #33332f;
    --pass: #5cc48d; --pass-bg: #1d3328; --fail: #f08a80; --fail-bg: #3a1f1c; --code-bg: #2a2a27;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { margin: 0; font-size: 28px; }
h2 { font-size: 18px; margin: 32px 0 12px; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.meta { color: var(--muted); margin: 4px 0 0; }
.summary { margin-top: 24px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
.score strong { font-size: 36px; color: var(--fail); margin-right: 8px; }
.score.all-pass strong { color: var(--pass); }
.score span { color: var(--muted); }
.bar { height: 10px; background: var(--fail-bg); border-radius: 5px; overflow: hidden; margin-top: 12px; }
.bar > div { height: 100%; background: var(--pass); }
.bar.small { height: 8px; margin: 0; min-width: 80px; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar-cell { width: 40%; }
.cases-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cases-head label { color: var(--muted); cursor: pointer; }
.only-failures .case.pass { display: none; }
.case { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; }
.case.fail { border-left: 4px solid var(--fail); }
.case.pass { border-left: 4px solid var(--pass); }
summary { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; flex-wrap: wrap; }
.badge { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
.pass .badge { color: var(--pass); background: var(--pass-bg); }
.fail .badge { color: var(--fail); background: var(--fail-bg); }
.case-id { font-family: ui-monospace, monospace; font-weight: 600; }
.category { color: var(--muted); flex: 1; }
.duration { color: var(--muted); font-variant-numeric: tabular-nums; }
.case-body { padding: 0 14px 14px; border-top: 1px solid var(--border); }
.failures { background: var(--fail-bg); color: var(--fail); border-radius: 6px; padding: 10px 10px 10px 28px; margin: 14px 0 0; }
.turns { margin: 0; padding-left: 0; list-style: none; }
.turns li { margin-bottom: 4px; }
.turn-label { color: var(--muted); font-size: 12px; margin-right: 8px; }
pre { background: var(--code-bg); border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; margin: 0; font: 13px/1.5 ui-monospace, monospace; }
pre.answer { font-family: inherit; font-size: 14px; }
code { background: var(--code-bg); border-radius: 4px; padding: 1px 6px; font-size: 13px; }
.sources { margin: 0; line-height: 2; }
.tag { text-transform: none; letter-spacing: 0; font-weight: 400; }
`;
