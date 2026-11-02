// Prints the ingest report and the chunks of every file (or files matching an argument): npm run chunks -- flyer
import { ingest } from "../src/ingest/index.js";

const { snapshot, report } = await ingest({ docsDir: "docs", embeddingCacheFile: ".cache/embeddings.json" });
console.log(JSON.stringify(report, null, 2));
const filter = process.argv[2];
for (const chunk of snapshot.chunks.filter((c) => !filter || c.file.includes(filter))) {
  console.log(`\n--- ${chunk.id}${chunk.validity ? ` ${JSON.stringify(chunk.validity)}` : ""}\n${chunk.text}`);
}
