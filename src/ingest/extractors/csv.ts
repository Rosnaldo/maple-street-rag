import { parse } from "csv-parse/sync";
import type { Section } from "../../types.js";
import { labelRow } from "./tables.js";

/**
 * One atomic section per row, so an exact lookup ("the 20V brushless drill")
 * retrieves that row alone instead of a block of look-alike neighbours.
 * Labels come from the header row, so any CSV works, not just the price list.
 */
export function extractCsv(raw: Buffer): Section[] {
  const records: string[][] = parse(raw, { skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  const [header, ...rows] = records;
  if (!header) return [];

  const columns = header.map(humanizeColumn);
  return rows.map((row) => ({
    text: labelRow(
      columns,
      row.map((value, i) => formatValue(header[i] ?? "", value)),
    ),
    atomic: true,
  }));
}

const ACRONYMS = new Set(["sku", "id", "upc"]);

/** "price_usd" -> "Price (USD)", "in_stock" -> "In stock", "sku" -> "SKU" */
function humanizeColumn(column: string): string {
  const words = column.trim().toLowerCase().replace(/[_-]+/g, " ").split(/\s+/);
  const currency = words.at(-1) === "usd" ? (words.pop(), " (USD)") : "";
  const label = words.map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word)).join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1) + currency;
}

function formatValue(column: string, value: string): string {
  const name = column.toLowerCase();
  if (/(price|usd|cost)/.test(name) && /^\d+(\.\d+)?$/.test(value)) return `$${value}`;
  if (/stock/.test(name) && /^(no|false|0)$/i.test(value)) return `${value} (out of stock)`;
  return value;
}
