import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import matter from "gray-matter";
import type { DocFormat, DocMetadata, SkippedFile, SourceDoc } from "../types.js";

const MANIFEST_FILE = "manifest.json";

const FORMATS_BY_EXTENSION: Record<string, DocFormat> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".csv": "csv",
  ".pdf": "pdf",
  ".html": "html",
  ".htm": "html",
  ".txt": "text",
};

type Manifest = Record<string, Partial<Record<keyof DocMetadata, unknown>>>;

export interface LoadResult {
  docs: SourceDoc[];
  skipped: SkippedFile[];
}

/** Reads every file in docs/ and resolves metadata: front matter first, then manifest.json. */
export async function loadDocs(docsDir: string): Promise<LoadResult> {
  const manifest = await readManifest(docsDir);
  const entries = await readdir(docsDir, { withFileTypes: true });
  const docs: SourceDoc[] = [];
  const skipped: SkippedFile[] = [];

  for (const entry of entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = entry.name;
    if (file === MANIFEST_FILE) continue;

    const format = FORMATS_BY_EXTENSION[extname(file).toLowerCase()];
    if (!format) {
      skipped.push({ file, reason: "unsupported file type" });
      continue;
    }

    const raw = await readFile(join(docsDir, file));
    const metadata =
      (format === "markdown" ? frontMatterMetadata(raw) : undefined) ?? toMetadata(manifest[file]);
    docs.push({ file, format, metadata, raw });
  }

  return { docs, skipped };
}

async function readManifest(docsDir: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(join(docsDir, MANIFEST_FILE), "utf8"));
    return (parsed?.files ?? {}) as Manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read ${MANIFEST_FILE}: ${(error as Error).message}`);
  }
}

function frontMatterMetadata(raw: Buffer): DocMetadata | undefined {
  return toMetadata(matter(raw.toString("utf8")).data);
}

/** A file only has usable metadata when it states an audience; title and date are needed to compare versions. */
function toMetadata(data: Partial<Record<keyof DocMetadata, unknown>> | undefined): DocMetadata | undefined {
  if (!data || typeof data.audience !== "string" || !data.audience.trim()) return undefined;
  return {
    title: String(data.title ?? "").trim(),
    audience: data.audience.trim().toLowerCase(),
    effective: toIsoDate(data.effective),
  };
}

// gray-matter parses unquoted YAML dates into Date objects.
function toIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return "";
}
