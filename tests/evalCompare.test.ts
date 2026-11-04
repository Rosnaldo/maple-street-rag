// Comparing two eval runs: which cases changed and the word diff of their answers. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWords, findChanges } from "../scripts/evalCompare.js";
import type { CaseResult } from "../scripts/evalReport.js";

function result(id: string, answer: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return { id, category: "test", pass: true, failures: [], status: 200, outcome: "answer", answer, durationMs: 1, turns: ["q"], expect: {}, ...overrides };
}

describe("findChanges", () => {
  it("keeps only cases whose answer, outcome or pass/fail changed", () => {
    const base = [result("same", "We close at 6 PM."), result("spaces", "We  close\nat 6 PM."), result("text", "Yes."), result("outcome", "No."), result("pass", "Ok.")];
    const next = [
      result("same", "We close at 6 PM."),
      result("spaces", "We close at 6 PM."),
      result("text", "Yes, we do."),
      result("outcome", "No.", { outcome: "decline" }),
      result("pass", "Ok.", { pass: false }),
    ];
    assert.deepEqual(findChanges(base, next).map((change) => change.id), ["text", "outcome", "pass"]);
  });

  it("includes cases that are only in one run", () => {
    const changes = findChanges([result("old", "a")], [result("new", "b")]);
    assert.deepEqual(changes.map(({ id, base, next }) => [id, Boolean(base), Boolean(next)]), [["new", false, true], ["old", true, false]]);
  });
});

describe("diffWords", () => {
  it("marks removed and added words and joins back into both texts", () => {
    const parts = diffWords("The rental is $40 per day.", "The rental is $45 per day plus deposit.");
    const text = (kinds: string[]) => parts.filter((part) => kinds.includes(part.kind)).map((part) => part.text).join("");
    assert.equal(text(["same", "removed"]), "The rental is $40 per day.");
    assert.equal(text(["same", "added"]), "The rental is $45 per day plus deposit.");
    assert.deepEqual(parts.filter((part) => part.kind === "removed").map((part) => part.text.trim()), ["$40", "day."]);
  });
});
