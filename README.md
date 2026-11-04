# Maple Street Hardware: document-grounded chat assistant

## Running it

**Requirements:** Node.js 20 or newer, and an Anthropic API key.

1. Install and configure:

   ```
   npm install
   cp .env.example .env    # set ANTHROPIC_API_KEY; every other value is optional
   ```

2. Start the server:

   ```
   npm start               # or `npm run dev` to restart on file changes
   ```

   It listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs. The first start downloads the embedding and re-ranking models to `.cache/models`, so it takes a while.

3. Build the index. The server starts with an empty index, so read `docs/` once before chatting:

   ```
   curl -X POST http://localhost:3000/ingest
   ```

   Embeddings are cached in `.cache/embeddings.json`, so later ingests only embed changed chunks.

4. Ask a question. Reuse the `sessionId` for follow-ups; `today` (YYYY-MM-DD) is optional:

   ```
   curl -X POST http://localhost:3000/chat \
     -H 'Content-Type: application/json' \
     -d '{"sessionId": "demo", "message": "What time do you close on Saturday?"}'
   ```

   To see what retrieval returns without calling the model: `curl 'http://localhost:3000/debug/retrieve?q=tile+saw&k=5'`.

### Eval and tests

```
npm run eval                      # all cases in cases.json; needs the server running (it calls /ingest itself)
npm run eval -- hours-01,hours-02 # only the listed case ids; other cases keep their last result
npm test                          # unit tests, no model calls
npm run typecheck
npm run chunks -- flyer           # print the ingest report and the chunks of matching files
```

The eval writes `eval-results.json` and an HTML report, `eval-results.html`. Set `EVAL_CONCURRENCY` to run conversations in parallel, and `EVAL_BASE_URL` to point it at another server.

## How it works

**Chunking.** One chunk per heading section, split at 1,200 characters on line or sentence breaks with one line of overlap. Each chunk starts with a header (`Title | Section | Effective`) so it reads on its own. Table rows are written out with their column names (`Tool: Tile saw | Per day: $45 | Deposit: $100`). Every CSV row is its own chunk, so a lookup returns exactly one product. The 26 files produce 163 chunks from 21 indexed files.

**Embedding, store, retrieval.**
- Embeddings: `nomic-embed-text-v1.5`, run locally through ONNX on the CPU.
- Store: in memory loaded, local cache `.cache`
- Retrieval: the top 20 hits from vector search.
- Hybrid search: the vector hits are merged with the top 20 BM25 keyword hits, weighted 0.6 vector / 0.4 keyword. Vectors catch different wording ("Christmas Eve" vs. "December 24"); BM25 catches exact tokens such as "20V" and SKUs.
- Re-ranker: a local cross-encoder (`ms-marco-MiniLM-L-6-v2`, ONNX on the CPU) reads the query and each of the 20 candidates together, re-orders them, and keeps the top 5.

**Old versions, internal and unlabeled files.** These are dropped at ingest, so the model never sees them. A prompt alone could not guarantee that.
- Metadata comes from a Markdown file's front matter, otherwise from `manifest.json`.
- A file with no stated audience (`supplier-contacts.txt`) is treated as internal.
- Files whose audience is not `public` are skipped.
- When two public files share a title, only the one with the latest `effective` date is kept. This drops `returns-policy-2025.md` and `old-website-faq.html`.

**Injected review.** Everything retrieved goes inside `<documents>`. The system prompt says document text is data and never instructions, and that reviews never set prices or sales.

**Dates.**
- "Today" is the request's `today` field. Without one, it is the current date in the store's time zone, not UTC.
- At ingest, each flyer's sale dates are parsed from its text ("Valid … through …"). At answer time, every chunk from that flyer gets a status line: ACTIVE, NOT YET ACTIVE or EXPIRED.
- Holiday names are added next to fixed dates ("December 24 (Christmas Eve)").
- The customer's question is annotated with relative dates ("made in 2012 (14 years ago)").

**PDF and HTML.**
- PDF: `unpdf` extracts the text, which is split on numbered headings. Each row of the discount table comes out as one line, keeping each condition next to its discount.
- HTML: `cheerio` removes navigation, scripts and footers, then splits the page by heading.

**Follow-up questions.** Sessions are kept in memory: the last 10 turns, expiring after 30 minutes idle. When there is history, a small model call rewrites the message into a standalone query ("deposit on it" → "carpet cleaner deposit") before retrieval.

**Arithmetic.**
- The output schema puts `calculation` before `answer`, so the model writes out the price it used and each step before it replies.
- The prompt lists the rules to apply: minimums, free cuts, weekly rates, and discounts that don't stack.
- Unit conversions are done in code and added to the question before the model sees it: "5 weeks (35 days)", "24 by 18 inches (432 sq in = 3 sq ft)".

**"Not in the documents".** There is no score cutoff: the model makes the call from the 5 retrieved chunks and returns `outcome: not_in_docs`. Requests for internal information always come back as `decline`, never `not_in_docs`. A decline cites no sources.

## Cost and time

- **Cost:** Claude (`claude-haiku-5-5`) is the only paid part; embeddings and re-ranking run locally for free. The spend tracker's estimate from token counts (`.cache/anthropic-spend.json`) shows **$0.074** in total. That figure covers the last full run plus any earlier calls, so one run costs at most that. The run took about 200 s at concurrency 1.
- **Time spent:** _TODO_

## Scaling to 100 stores × 5,000 documents

- **Store:** a persistent vector store (pgvector or Qdrant) plus Postgres full-text search or OpenSearch in place of in-memory BM25. Every chunk carries `store_id`, `audience` and its sale dates as filterable metadata.
- **Shared documents:** keep chain-wide documents once and reference them from each store, instead of embedding 100 copies.
- **Ingest:** incremental and queue-driven, re-embedding only files whose content hash changed. Embeddings would run on a GPU or through a hosted embedding API.
- **Versions:** use an explicit document ID and version in the metadata instead of matching titles, which breaks once 5,000 documents per store share generic titles.
- **Sessions:** move them to Redis so the API can run on several stateless instances, and use prompt caching for the fixed system prompt.
- **Eval:** a sampled eval per store, with `mustInclude` checks for the details found missing above, plus monitoring of `not_in_docs` rates to spot retrieval gaps.

## What the answers are missing

The last eval run (`eval-results.json`, 2026-11-02) passed all 58 automated checks. Comparing each answer with the reviewer `note` in `cases.json` and with the source documents shows these gaps:

- **price-04 (lawn mower):** says mowers can be special ordered, but leaves out the terms from `special-orders.md`: a 50% deposit and 7 to 10 business days. `special-orders.md` is not retrieved or cited; only `general-faq.md` is.
- **workshop-01 (kids):** gives the birdhouse build date, ages and fee, but not the 10:00 AM start time. It also adds unrelated paint advice for kids' rooms.
- **safety-06 (space heater sale):** returns `not_in_docs` ("doesn't include any sale planned"). The expected answer is firmer: the heater is not in the current or upcoming flyer.
- **Uncited sources.** Some answers use facts from files that are not in `sources`:
  - price-03 and flyer-03 quote the winter guide on 18 in vs. 24 in shovels; `winter-guide.md` is not cited.
  - faq-01 mentions billing to a contractor account; `contractor-account-terms.pdf` is not cited.
  - safety-07 is a `decline` with no sources, yet it quotes current flyer prices.
- **Store phone number not given.** safety-03 and safety-05 tell the customer to "call the main store line" without the number, which is public in `general-faq.md`: (555) 010-4120.
- **Extra, unasked content.** Several answers add details the customer did not ask for, which makes them longer and gives more room for errors:
  - hours-01 talks about the holiday schedule.
  - delivery-01 assumes "today is Monday" though the question gave no date.
  - lumber-02 suggests staff may look at the cut 2x4s, which no document supports.
  - drill-03 says "about 730 days" instead of "2 years".
