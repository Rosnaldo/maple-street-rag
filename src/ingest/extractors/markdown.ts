import matter from "gray-matter";
import type { Section } from "../../types.js";
import { MAX_ROWS_PER_TABLE_CHUNK, labelRow, tableToSections } from "./tables.js";

const HEADING = /^(#{1,6})\s+(.*)$/;
const TABLE_LINE = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}/;

/** One section per heading. Tables are rewritten as labeled rows. */
export function extractMarkdown(raw: Buffer): Section[] {
  const lines = matter(raw.toString("utf8")).content.split(/\r?\n/);
  const sections: Section[] = [];
  let heading: string | undefined;
  let body: string[] = [];

  const flush = () => {
    const text = body.join("\n").trim();
    if (text) sections.push({ heading, text });
    body = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = HEADING.exec(lines[i]);
    if (headingMatch) {
      flush();
      heading = stripEmphasis(headingMatch[2].trim());
      continue;
    }

    if (TABLE_LINE.test(lines[i])) {
      const tableLines: string[] = [];
      while (i < lines.length && TABLE_LINE.test(lines[i])) tableLines.push(lines[i++]);
      i--;
      const [header, ...rest] = tableLines.map(splitTableRow);
      const rows = rest.filter((_, index) => !TABLE_SEPARATOR.test(tableLines[index + 1]));

      if (rows.length <= MAX_ROWS_PER_TABLE_CHUNK) {
        body.push(...rows.map((row) => labelRow(header, row)));
      } else {
        flush();
        sections.push(...tableToSections(header, rows, heading));
      }
      continue;
    }

    body.push(stripEmphasis(lines[i]));
  }
  flush();
  return sections;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => stripEmphasis(cell.trim()));
}

function stripEmphasis(text: string): string {
  return text.replace(/\*\*|__/g, "");
}
