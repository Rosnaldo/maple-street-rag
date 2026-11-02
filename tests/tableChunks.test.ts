// Table extraction for each format, from small fixtures in tests/fixtures. Run with: npm test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { extractCsv } from "../src/ingest/extractors/csv.js";
import { extractHtml } from "../src/ingest/extractors/html.js";
import { extractMarkdown } from "../src/ingest/extractors/markdown.js";

function fixture(name: string): Promise<Buffer> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url));
}

const RATE_ROWS = ["Tool: Tile saw | Per day: $45 | Deposit: $100", "Tool: Carpet cleaner | Per day: $35 | Deposit: $50"];

describe("table extraction", () => {
  it("markdown: labels each table row under its heading", async () => {
    const sections = extractMarkdown(await fixture("rates.md"));
    assert.deepEqual(sections, [{ heading: "Rates", text: RATE_ROWS.join("\n") }]);
  });

  it("html: labels each table row under its heading", async () => {
    const sections = extractHtml(await fixture("rates.html"));
    assert.deepEqual(sections, [{ heading: "Rates", text: RATE_ROWS.join("\n") }]);
  });

  it("csv: makes one atomic section per row", async () => {
    const sections = extractCsv(await fixture("prices.csv"));
    assert.deepEqual(sections, [
      { text: "SKU: DR-18V | Name: Cordless Drill 18V | Price (USD): $89.99 | In stock: yes", atomic: true },
      { text: "SKU: HM-16 | Name: Claw Hammer 16oz | Price (USD): $14 | In stock: no (out of stock)", atomic: true },
    ]);
  });
});
