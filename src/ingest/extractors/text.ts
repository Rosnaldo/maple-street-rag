import type { Section } from "../../types.js";

/** Plain text has no structure to rely on: one section, split by size in chunk.ts. */
export function extractText(raw: Buffer): Section[] {
  const text = raw.toString("utf8").replace(/\r\n/g, "\n").trim();
  return text ? [{ text }] : [];
}
