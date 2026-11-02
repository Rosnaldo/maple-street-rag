import type { Chunk, IndexableDoc, Section, ValidityWindow } from "../types.js";

export const MAX_CHUNK_CHARS = 1200;

/**
 * Turns a document's sections into chunks. Each chunk starts with a header
 * ("Title: Tool rental | Section: Deposits | Effective: 2026-01-01") so it reads
 * on its own, for the embedding, the keyword index and the model alike.
 * Atomic sections become exactly one chunk; long prose is split on line breaks
 * with one line of overlap.
 */
export function chunkDocument(doc: IndexableDoc, sections: Section[], validity?: ValidityWindow): Chunk[] {
  const { title, effective } = doc.metadata;
  const bodies = sections.flatMap((section) =>
    (section.atomic ? [section.text] : splitBySize(section.text, MAX_CHUNK_CHARS)).map((body) => ({
      heading: section.heading,
      body,
    })),
  );

  return bodies.map(({ heading, body }, index) => {
    const section = heading && heading.toLowerCase() !== title.toLowerCase() ? heading : undefined;
    return {
      id: `${doc.file}#${index + 1}`,
      file: doc.file,
      title,
      effective,
      section,
      text: `${chunkHeader(title || doc.file, section, effective)}\n${body}`,
      validity,
    };
  });
}

function chunkHeader(title: string, section: string | undefined, effective: string): string {
  return [`Title: ${title}`, section && `Section: ${section}`, effective && `Effective: ${effective}`]
    .filter(Boolean)
    .join(" | ");
}

export function splitBySize(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const lines = text.split("\n").flatMap((line) => (line.length > maxChars ? splitLongLine(line, maxChars) : [line]));
  const pieces: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const line of lines) {
    if (length + line.length + 1 > maxChars && current.length) {
      pieces.push(current.join("\n"));
      const overlap = current.at(-1)!;
      current = overlap.length < maxChars / 3 ? [overlap] : [];
      length = current.reduce((sum, l) => sum + l.length + 1, 0);
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length) pieces.push(current.join("\n"));
  return pieces;
}

// Long paragraphs are split on sentence boundaries.
function splitLongLine(line: string, maxChars: number): string[] {
  const sentences = line.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [line];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
