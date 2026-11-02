import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Embedder } from "./embeddings.js";

/**
 * Embeds documents through a disk cache keyed by model + content hash, so
 * /ingest only pays for chunks that are new or changed.
 */
export async function embedDocumentsCached(embedder: Embedder, texts: string[], cacheFile: string): Promise<number[][]> {
  const cache = await readCache(cacheFile);
  const keys = texts.map((text) => `${embedder.id}:${createHash("sha256").update(text).digest("hex")}`);

  const missing = [...new Set(keys.filter((key) => !cache[key]))];
  if (missing.length) {
    const textByKey = new Map(keys.map((key, i) => [key, texts[i]]));
    const vectors = await embedder.embed(missing.map((key) => textByKey.get(key)!), "document");
    missing.forEach((key, i) => (cache[key] = vectors[i]));
    await writeCache(cacheFile, cache);
  }
  return keys.map((key) => cache[key]);
}

async function readCache(file: string): Promise<Record<string, number[]>> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {}; // missing or corrupt cache: rebuild it
  }
}

async function writeCache(file: string, cache: Record<string, number[]>): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cache));
}
