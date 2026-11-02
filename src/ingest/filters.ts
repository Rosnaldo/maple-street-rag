import type { IndexableDoc, SkippedFile, SourceDoc } from "../types.js";

export interface FilterResult {
  indexable: IndexableDoc[];
  skipped: SkippedFile[];
}

/**
 * Decides which files may be indexed. Anything rejected here is never chunked,
 * embedded or sent to the model, so this is the hard guarantee against leaks.
 *
 * 1. No metadata anywhere -> unknown audience -> treated as internal.
 * 2. Audience other than "public" -> skipped.
 * 3. Several public files with the same title -> only the latest effective date is kept;
 *    older versions are dropped so the model can never quote a replaced policy.
 */
export function selectIndexableDocs(docs: SourceDoc[]): FilterResult {
  const skipped: SkippedFile[] = [];
  const publicDocs: IndexableDoc[] = [];

  for (const doc of docs) {
    if (!doc.metadata) {
      skipped.push({ file: doc.file, reason: "no metadata: unknown audience, treated as internal" });
    } else if (doc.metadata.audience !== "public") {
      skipped.push({ file: doc.file, reason: `audience: ${doc.metadata.audience}` });
    } else {
      publicDocs.push(doc as IndexableDoc);
    }
  }

  const { current, superseded } = dropSupersededVersions(publicDocs);
  return { indexable: current, skipped: [...skipped, ...superseded] };
}

function dropSupersededVersions(docs: IndexableDoc[]): { current: IndexableDoc[]; superseded: SkippedFile[] } {
  const latestByTitle = new Map<string, IndexableDoc>();
  for (const doc of docs) {
    const key = titleKey(doc);
    const latest = latestByTitle.get(key);
    if (!latest || doc.metadata.effective > latest.metadata.effective) latestByTitle.set(key, doc);
  }

  const current: IndexableDoc[] = [];
  const superseded: SkippedFile[] = [];
  for (const doc of docs) {
    const latest = latestByTitle.get(titleKey(doc))!;
    // Same title and same date: neither is newer, so both stay.
    if (doc.metadata.effective < latest.metadata.effective) {
      superseded.push({
        file: doc.file,
        reason: `superseded by ${latest.file} (effective ${latest.metadata.effective})`,
      });
    } else {
      current.push(doc);
    }
  }
  return { current, superseded };
}

// Files without a title cannot be compared, so each gets its own group.
function titleKey(doc: IndexableDoc): string {
  return doc.metadata.title ? doc.metadata.title.toLowerCase().replace(/\s+/g, " ") : `file:${doc.file}`;
}
