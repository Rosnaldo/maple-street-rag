import { extractText } from "unpdf";
import type { Section } from "../../types.js";

// "3. Contractor pricing": a short numbered line without a closing period.
const NUMBERED_HEADING = /^\d{1,2}\.\s+[A-Z][^.]{0,80}$/;

/**
 * Splits on numbered section headings. The PDF's discount table comes out as one
 * line per row ("Paint, 5 or more gallons on one order 10%"), which keeps each
 * condition next to its discount, so it stays inside its section as plain text.
 */
export async function extractPdf(raw: Buffer): Promise<Section[]> {
  const { text } = await extractText(new Uint8Array(raw), { mergePages: true });
  const sections: Section[] = [];
  let heading: string | undefined;
  let body: string[] = [];

  const flush = () => {
    const sectionText = body.join("\n").trim();
    if (sectionText) sections.push({ heading, text: sectionText });
    body = [];
  };

  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (NUMBERED_HEADING.test(line)) {
      flush();
      heading = line;
    } else if (line) {
      body.push(line);
    }
  }
  flush();
  return sections;
}
