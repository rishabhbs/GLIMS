# LIMS Brain — Risks, Gaps & Decisions Needed

This is step 1 of the brief: investigate the requirements and surface what's ambiguous or risky **before** building. Items marked **[DECISION]** need your input; I've proposed a default for each so Phase 1 isn't blocked.

## A. Scope & product risks

1. **The anti-"chat with docs" requirement is the central risk.**
   Most RAG systems are exactly the thing you don't want: retrieve chunks, stuff them in a prompt, answer. The differentiator here is the **curated knowledge graph** sitting between raw chunks and answers. That graph is more expensive to build and the main source of long-term value. Design reflects this: extraction produces typed `knowledge_items` with relationships, not just embedded chunks. Chunks exist only as evidence behind items.

2. **Extraction quality is the make-or-break factor.** If extraction is noisy, the Explorer fills with low-value or duplicate items and trust collapses. Mitigation: every extracted item lands in a **review queue** by default (status `candidate`), confidence is explicit, and merge/dedupe is a first-class operation. The Brain never silently promotes an inference to a confirmed fact.

3. **Hallucination in answers directly violates obligation 9.** Mitigation: answers are composed only from retrieved `knowledge_items` + their `sources`; the grounding layer returns an explicit "insufficient supported evidence" result the UI must render honestly. Factual sentences carry citations or they don't ship.

## B. Decisions needed

4. **[DECISION] Single-tenant now, multi-tenant later?**
   Default: build single-product (Sampleify) and single-workspace now, but include a `workspace_id`/`product_id` column on core tables from day one so multi-product/multi-tenant is a migration, not a rewrite. Low cost, high optionality.

5. **[DECISION] Who are the users / is there auth in Phase 1?**
   Default: Supabase Auth with a single internal team (email allowlist). All content is team-visible. Row-Level Security scoped by `workspace_id`. If you want zero-auth local-only for the very first spike, say so and I'll gate auth behind an env flag.

6. **[DECISION] Model provider + embedding model for Phase 1.**
   Default: provider interface abstracts chat + embeddings; concrete default is OpenAI (`gpt`-class for extraction/answers, `text-embedding-3-small`, 1536 dims) with Anthropic as a drop-in alternate. Embedding **dimension is a schema commitment** (the `vector(1536)` column) — changing models later means a re-embedding migration, so we pin dims in config and store `embedding_model` on each embedding row to allow controlled migration.

7. **[DECISION] URL ingestion depth.** Default: fetch the single URL's main readable content (no crawl/recursion) in Phase 1. Crawling is a later enhancement.

8. **[DECISION] Image/screenshot handling.** Default: store the image, run OCR + a vision model caption to produce text, then treat that text as a normal source with `extraction_method = 'vision'` recorded so its lower reliability is visible. Full diagram understanding is out of scope for Phase 1.

9. **[DECISION] Taxonomy flexibility.** The brief says propose, don't hardcode blindly. Default: a seeded-but-editable `entity_type` taxonomy (table-driven, not an enum), so you can add/rename types without a migration. Proposed seed taxonomy is in `02-design.md`.

## C. Technical risks

10. **Embedding dimension lock-in** — handled via config + per-row `embedding_model` (see item 6).

11. **Extraction cost/latency** — large PDFs produce many chunks and many model calls. Mitigation: ingestion is an async job pipeline with explicit status, chunk-level batching, and idempotency keys so re-runs don't duplicate.

12. **Conflicting knowledge is a feature, not a bug.** Two sources can disagree (e.g. TAT "24h" vs "48h"). The model represents conflict explicitly via `knowledge_relationships` of type `contradicts` and a derived `conflicted` status, surfaced in Admin for human resolution rather than auto-picking a winner.

12b. **Correction targeting is a new risk.** When a user corrects an answer in chat, the Brain must figure out *which* existing item(s) the correction affects. If it targets the wrong item, it corrupts knowledge. Mitigations: start from the answer's recorded grounding set (we know exactly which items produced the answer), then retrieve over the correction text; and **show the proposed change set before applying** (auto-apply only for low-risk edits; always confirm when a `confirmed` item would be contradicted). Every correction is versioned and reversible via `revertChange`, so a mis-targeted correction is recoverable.

12c. **[DECIDED] Corrections are never auto-applied.** Every correction — even a straightforward edit — must be explicitly confirmed by the user before any new knowledge version is created. Flow: identify affected item(s) → show what will change + the proposed new understanding → user clicks "Apply correction" → only then create the new version, preserving the previous version and full provenance → provide undo/revert. No silent edits under any circumstances.

13. **Vercel execution limits** — long extraction can exceed serverless function timeouts. Mitigation: ingestion runs as background jobs (queue + worker route / Supabase cron / `after()`), not inside the request that uploads the file. Phase 1 can use a simple DB-backed job table + a worker route invoked by cron; this is called out in design so we don't paint ourselves into a synchronous corner.

14. **PII / confidential customer data** — customer results and metrics may be sensitive. Mitigation: sources and items carry a `sensitivity` flag; nothing is sent to external model providers beyond what ingestion requires, and that boundary is documented. No telemetry of source content to third parties.

## D. Explicitly out of scope for Phase 1

- Social Media Engine and any other downstream app UI.
- Website crawling / scheduled re-ingestion of URLs.
- Fine-grained role permissions beyond team membership.
- Automated conflict resolution (humans resolve; system only detects).
- Real-time collaborative editing of knowledge items.

## E. Definition of done for Phase 1

- A hostable Next.js app with six UI areas (Knowledge, Explorer, Item, **Ask/chat**, **History**, Admin) functional against real Supabase/Postgres + Storage.
- Ingestion of PDF, text/doc, URL, note, and image produces reviewable `knowledge_items` with sources and confidence.
- Explorer can browse/search the taxonomy; Knowledge Item view supports edit/correct/merge/archive/invalidate and shows an item history timeline.
- **Ask is a full in-app chat: grounded, cited answers, and a working teaching loop** — correcting an answer creates a versioned, provenance-tracked knowledge change that later answers reflect.
- **Conversations, messages, grounding sets, corrections, and resulting knowledge changes are persisted and inspectable in History**, with bidirectional links between conversations and affected items.
- Ask returns grounded answers with citations and refuses when evidence is insufficient.
- Admin surfaces failed ingestions, detected conflicts, and recent corrections (with revert).
- A documented internal `BrainService` API (including `answerQuestion` + `applyCorrection`) that a future app could call to both query and teach the Brain.

---

## F. Web research (added for dual-source expansion)

15. **Web research provider — Gemini native Google Search grounding** (replaced Tavily). Rationale: fewer moving parts and lower operational complexity — no separate search/extraction vendor, one credential, and the hosted app calls Gemini directly (works independently of any local Kiro session/CLI). Gemini searches the live web, synthesizes, and returns real grounding metadata (source URLs/titles + grounded excerpts), which we capture verbatim — never fabricated.
    - **Cost:** standard Gemini API usage on `GOOGLE_GENERATIVE_AI_API_KEY`; search grounding has its own request cost per Google's pricing. No separate search-API bill.
    - **Key:** reuses `GOOGLE_GENERATIVE_AI_API_KEY`, server-side only. Set `WEB_RESEARCH_PROVIDER=gemini` (+ optional `BRAIN_RESEARCH_MODEL`). Use `mock` offline. **Tavily and `TAVILY_API_KEY` are removed.**
    - **Swappable:** the single-method `WebResearchProvider` interface still lets another grounded-search provider drop in later; the mock/real split is the only abstraction kept.

16. **[DECIDED] External findings never auto-promote.** Research findings persist as external evidence and are excluded from the internal knowledge graph until a human explicitly promotes them. Promotion creates a `url` source + a `candidate` knowledge item with preserved provenance (URL, excerpt, dates). This protects obligation 9 and keeps the product brain curated.

17. **Hallucinated clause mappings are the key new risk** (NABL/ISO example). Mitigation: standards/regulatory questions prefer primary domains; the answer must cite the exact requirement source and distinguish a *direct requirement* from *supports compliance*; code-side citation verification drops uncited factual claims; and the system explicitly refuses when evidence is insufficient. The Brain never implies that using Sampleify guarantees accreditation.

18. **Cost/latency of research.** Mitigation: research runs only when needed (routing) or explicitly requested; results + extracted content are persisted per session so repeat questions can reuse them; extraction is bounded to top-ranked pages.

19. **Inaccessible / conflicting pages.** Inaccessible pages are recorded with their error and excluded from citations. Conflicting external sources are surfaced in the answer rather than silently resolved (consistent with the internal conflict policy).

20. **Data boundary.** When research runs, the question/queries are sent to Gemini (which performs the Google Search), i.e. the same provider family as the model layer. This is documented (req 12.4) and only happens when research is triggered.
