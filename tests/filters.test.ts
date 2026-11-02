// Which files may be indexed, from small fixtures in tests/fixtures/filters. Run with: npm test
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { selectIndexableDocs } from "../src/ingest/filters.js";
import { loadDocs } from "../src/ingest/loadDocs.js";

const { docs } = await loadDocs(fileURLToPath(new URL("./fixtures/filters", import.meta.url)));
const { indexable, skipped } = selectIndexableDocs(docs);

function reasonFor(file: string): string | undefined {
  return skipped.find((s) => s.file === file)?.reason;
}

describe("selectIndexableDocs", () => {
  it("indexes only the current version of public files", () => {
    assert.deepEqual(
      indexable.map((d) => d.file),
      ["hours.txt", "returns-2025.md"],
    );
  });

  it("treats a file with no metadata anywhere as internal", () => {
    const reason = "no metadata: unknown audience, treated as internal";
    assert.equal(reasonFor("notes.txt"), reason); // not in manifest.json
    assert.equal(reasonFor("draft.md"), reason); // no front matter, not in manifest.json
  });

  it("skips any audience other than public", () => {
    assert.equal(reasonFor("alarm-codes.md"), "audience: internal"); // from front matter
    assert.equal(reasonFor("staff-schedule.csv"), "audience: staff"); // from manifest.json
  });

  it("drops older public versions with the same title", () => {
    // Titles differ only in case and spacing: "Returns policy" vs "Returns  Policy".
    assert.equal(reasonFor("returns-2024.md"), "superseded by returns-2025.md (effective 2025-06-01)");
  });
});
