import type { Section } from "../../types.js";

/** Tables up to this many rows stay inside their section; bigger ones are split into row groups. */
export const MAX_ROWS_PER_TABLE_CHUNK = 15;

/**
 * Turns one table row into self-describing text, e.g.
 * "Tool: Tile saw | Per day: $45 | Deposit: $100".
 * Every value carries its column name so the row makes sense on its own.
 */
export function labelRow(columns: string[], values: string[]): string {
  return values
    .map((value, i) => [columns[i]?.trim() || `Column ${i + 1}`, value.trim()] as const)
    .filter(([, value]) => value !== "")
    .map(([column, value]) => `${column}: ${value}`)
    .join(" | ");
}

/**
 * Small tables become one block of labeled lines (kept with their section so rows
 * can be compared and stay next to the rules around them). Large tables become
 * atomic sections of at most MAX_ROWS_PER_TABLE_CHUNK rows, each repeating the labels.
 */
export function tableToSections(columns: string[], rows: string[][], heading?: string): Section[] {
  const lines = rows.map((row) => labelRow(columns, row));
  if (lines.length <= MAX_ROWS_PER_TABLE_CHUNK) return [{ heading, text: lines.join("\n") }];

  const sections: Section[] = [];
  for (let start = 0; start < lines.length; start += MAX_ROWS_PER_TABLE_CHUNK) {
    sections.push({ heading, text: lines.slice(start, start + MAX_ROWS_PER_TABLE_CHUNK).join("\n"), atomic: true });
  }
  return sections;
}
