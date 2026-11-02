import type { DocFormat, Section } from "../../types.js";
import { extractCsv } from "./csv.js";
import { extractHtml } from "./html.js";
import { extractMarkdown } from "./markdown.js";
import { extractPdf } from "./pdf.js";
import { extractText } from "./text.js";

const EXTRACTORS: Record<DocFormat, (raw: Buffer) => Section[] | Promise<Section[]>> = {
  markdown: extractMarkdown,
  csv: extractCsv,
  pdf: extractPdf,
  html: extractHtml,
  text: extractText,
};

export async function extractSections(format: DocFormat, raw: Buffer): Promise<Section[]> {
  return EXTRACTORS[format](raw);
}
