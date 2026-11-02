const K1 = 1.2;
const B = 0.75;

const STOP_WORDS = new Set(
  "a an and any anything are as at be by can do does for from got has have how i in is it its me my of on or our so something that the this to was we what when where which who will with you your".split(" "),
);

/**
 * Lowercases, keeps tokens like "20v", "2x4" and "dr-20b" whole (and also indexes
 * their parts), drops stop words and strips plural endings ("sundays" -> "sunday").
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+(?:[-.'][a-z0-9]+)*/g) ?? [];
  const tokens: string[] = [];
  for (const word of words) {
    const variants = word.includes("-") ? [word, ...word.split("-")] : [word];
    for (const variant of variants) {
      const token = stem(variant.replace(/'s$/, ""));
      if (token && !STOP_WORDS.has(token)) tokens.push(token);
    }
  }
  return tokens;
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !/\d/.test(word)) return word.slice(0, -1);
  return word;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

/** Okapi BM25 over plain text. Needs no embeddings: only term counts and lengths. */
export class Bm25Index {
  private readonly termCounts = new Map<string, Map<string, number>>(); // id -> term -> count
  private readonly lengths = new Map<string, number>();
  private readonly documentFrequency = new Map<string, number>();
  private averageLength = 0;

  constructor(documents: { id: string; text: string }[]) {
    for (const { id, text } of documents) {
      const counts = new Map<string, number>();
      const tokens = tokenize(text);
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
      for (const term of counts.keys()) this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      this.termCounts.set(id, counts);
      this.lengths.set(id, tokens.length);
    }
    const totalLength = [...this.lengths.values()].reduce((sum, length) => sum + length, 0);
    this.averageLength = this.lengths.size ? totalLength / this.lengths.size : 0;
  }

  search(query: string, limit: number): Bm25Hit[] {
    const queryTerms = [...new Set(tokenize(query))];
    const hits: Bm25Hit[] = [];

    for (const [id, counts] of this.termCounts) {
      const lengthRatio = this.lengths.get(id)! / (this.averageLength || 1);
      let score = 0;
      for (const term of queryTerms) {
        const frequency = counts.get(term);
        if (!frequency) continue;
        score += this.idf(term) * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * lengthRatio)));
      }
      if (score > 0) hits.push({ id, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private idf(term: string): number {
    const n = this.termCounts.size;
    const df = this.documentFrequency.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }
}
