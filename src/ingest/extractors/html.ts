import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Section } from "../../types.js";
import { tableToSections } from "./tables.js";

const NON_CONTENT = "script, style, noscript, nav, header, footer, iframe, svg, form, template";
const CONTENT_BLOCKS = "h1, h2, h3, h4, p, li, table, blockquote, pre";
const BLOCK_PARENTS = "p, li, table, blockquote, pre";

/** Strips navigation, footers and scripts, then makes one section per heading. */
export function extractHtml(raw: Buffer): Section[] {
  const $ = cheerio.load(raw.toString("utf8"));
  $(NON_CONTENT).remove();

  const sections: Section[] = [];
  let heading: string | undefined;
  let body: string[] = [];

  const flush = () => {
    const text = body.join("\n").trim();
    if (text) sections.push({ heading, text });
    body = [];
  };

  const blocks = $("body").find(CONTENT_BLOCKS).filter((_, el) => $(el).parents(BLOCK_PARENTS).length === 0);
  blocks.each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (/^h\d$/.test(tag)) {
      flush();
      heading = cleanText($(el).text());
    } else if (tag === "table") {
      const [first, ...rest] = tableToSections(...readTable($, el), heading);
      if (first) body.push(first.text);
      if (rest.length) {
        flush();
        sections.push(...rest);
      }
    } else {
      const text = cleanText($(el).text());
      if (text) body.push(tag === "li" ? `- ${text}` : text);
    }
  });
  flush();
  return sections;
}

function readTable($: cheerio.CheerioAPI, table: Element): [string[], string[][]] {
  const rows = $(table)
    .find("tr")
    .toArray()
    .map((tr) => $(tr).find("th, td").toArray().map((cell) => cleanText($(cell).text())));
  const [columns = [], ...body] = rows;
  return [columns, body];
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
