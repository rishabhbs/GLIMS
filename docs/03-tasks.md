# LIMS Brain — Implementation Tasks (Phase 1)

Ordered so each task builds on verified prior work. Each maps back to requirements in `01-requirements.md`. Do **not** build the Social Media Engine or other downstream apps. Implementation starts only after the architecture is approved.

Legend: `[ ]` todo. Each top-level task is independently shippable/verifiable.

---

## 0. Project foundation ✅ M1
- [x] 0.1 Scaffold Next.js (App Router) + TypeScript + ESLint in the repo root. _(Req 11.1)_
- [x] 0.2 Add config module: env loading, `MODEL_PROVIDER`, embedding model + dims (default 1536), Supabase keys. Fail fast if required env missing. _(Req 11.2, 11.5)_ — `src/config/env.ts`
- [x] 0.3 Set up Supabase project wiring: client factory (server/service-role vs anon), `.env.example`. Secrets only in env. _(Req 11.1, 11.2)_ — `src/db/client.ts`

## 1. Database & taxonomy ✅ M1
- [x] 1.1 Migration for extensions (`vector`, `pg_trgm`) and all tables from design §3, incl. `conversations`, `messages`, `message_grounding`, `corrections`, `knowledge_changes`. _(Req 2, 3, 4, 5, 8, 9)_ — `supabase/migrations/0001_init.sql`
- [x] 1.2 Seed `entity_types` and `relationship_types` with the proposed taxonomy. _(Req 3.4)_ — `0004_seed.sql`
- [x] 1.3 HNSW + trigram + btree indexes (incl. messages/grounding/changes); RLS scoped by `workspace_id`; seed one workspace; hybrid-search RPCs. _(Req 3, 12)_ — `0001`, `0002_search_rpc.sql`, `0003_rls.sql`
- [x] 1.4 DB types + repository layer (all SQL lives here), incl. conversation/message/correction repos. _(Design §1 layering)_ — `src/db/database.types.ts`, `src/db/repositories.ts`

## 2. Provider interface (vendor-agnostic AI) ✅ M1
- [x] 2.1 Define `ModelProvider` interface (`embed`, `chat`, `structuredExtract`). _(Req 11.3)_ — `src/providers/types.ts`
- [x] 2.2 Implement `OpenAIProvider` and `MockProvider` (tests/offline). Select by env. _(Req 11.3)_ — `src/providers/{openai,mock,index}.ts`
- [x] 2.3 Implement `AnthropicProvider` as a second concrete impl to prove the abstraction holds. _(Req 11.3)_ — `src/providers/anthropic.ts`

## 3. BrainService skeleton (the reusable contract) ✅ M1
- [x] 3.1 Define `BrainService` interface + types (ingest, search, getItem, getItemHistory, conversations, answerQuestion, previewCorrection, confirmCorrection). _(Req 11.1, 11.2, 11.5)_ — `src/brain/{service,types}.ts`
- [x] 3.2 Implement in-process `BrainService` wiring to repositories + provider (intake, taxonomy, conversation CRUD, item reads done; retrieval/answer/correction declared, land M2/M3). _(Req 11.1)_
- [x] 3.3 Expose matching HTTP route handlers so the contract works in- and out-of-process. _(Req 11.4)_ — `app/api/{sources,conversations,taxonomy,health}/route.ts`

> **M1 verified:** `npm run typecheck`, `npm test` (3 passing), and `npm run build` all green. The six UI areas render; four API routes mirror the contract.
>
> **M2 verified (live Supabase):** `npm run typecheck` + `npm run build` green; `npm test` 10 passing. End-to-end ingestion test (`scripts/ingest-e2e.ts`, 9/9) against the real DB proves: multi-item extraction, chunk+embed, verbatim-snippet provenance with locators, conflict detection (`contradicts` + `conflicted`), dedupe (re-ingest creates 0 new items), hybrid search, and versioned human edits (prior value snapshotted, classification→human). HTTP routes (`/api/ingest`, `/api/jobs`, `/api/items`, `/api/taxonomy`) smoke-tested live with background `after()` processing.
>
> **M3 verified (live Supabase):** `npm run typecheck` + `npm run build` green; `npm test` 10 passing. The full ask + teach loop end-to-end test (`scripts/ask-e2e.ts`, 16/16) against the real DB proves: grounded answer with citations + persisted grounding set; **`previewCorrection` writes nothing** (claim unchanged, no new revision); `confirmCorrection` versions the item (prior value snapshotted), flips to `human`, creates a `chat_correction` provenance source, and links a `knowledge_change` to the correction; and **a subsequent answer uses the corrected knowledge**. HTTP routes (`/api/ask`, `/api/conversations/[id]`, `/api/corrections/preview`, `/api/corrections/confirm`) smoke-tested live incl. auto-create conversation, persistence, honest refusal when evidence absent, and explicit preview→apply. App shell reworked to a CSS-grid layout (fixed sidebar track) — navigation/header overlap fixed. `/ask` is now the real product surface.

## 4. Ingestion pipeline ✅ M2
- [x] 4.1 Source intake: store Source + Storage upload for PDF/image; compute `content_hash`; dedupe. _(Req 1.1, 1.5, 1.6, 1.9)_ — `src/db/storage.ts`, `app/api/ingest`, `service.ingestSource`
- [x] 4.2 Text/URL/note intake: readability fetch for URL, passthrough for text/note. _(Req 1.2, 1.3, 1.4)_ — `ingestion/extract-text.ts`
- [x] 4.3 Job table + worker route (cron-invokable); status transitions + retry + error capture. _(Req 1.7, 1.8)_ — `app/api/jobs`, `ingestion/worker.ts`, `after()` background processing
- [x] 4.4 Extract text per source type (PDF parse, HTML readability, OCR+vision caption). Record `extraction_method`. _(Req 1.5)_ — `extract-text.ts`
- [x] 4.5 Chunk + embed chunks → `source_chunks` with `embedding_model`. _(Design §4, Req 12.5)_ — `ingestion/chunk.ts` + worker
- [x] 4.6 Structured knowledge extraction: atomic typed items + per-item evidence snippet; forbid invented claims. _(Req 3.1, 3.5, 2.1)_ — `ingestion/schema.ts` (verbatim-snippet contract)
- [x] 4.7 Dedupe/link new candidates against existing items (vector match → attach evidence vs new). _(Req 3.2)_ — `ingestion/dedupe.ts`
- [ ] 4.8 Relationship proposal among new/nearby items → `knowledge_relationships`. _(Req 3.3)_ — partial: `contradicts` edges done; richer proposal deferred to M3/M4
- [x] 4.9 Conflict detection: contradicting claims → `contradicts` edge + `conflicted` status. _(Req 4.3)_ — `dedupe.looksContradictory` + worker

## 5. Retrieval & grounding (5.1 done in M2; rest M3)
- [x] 5.1 Hybrid search over `knowledge_items` (vector + trigram, rank fusion) with filters. _(Req 6.2, 6.3)_ — `retrieval/search.ts` (RRF)
- [x] 5.2 Graph expansion of top hits via relationships; drop archived/invalidated, flag conflicted. _(Req 8.1, 8.5)_ — `retrieval/ground.ts retrieveForQuestion` ✅ M3
- [x] 5.3 Grounded answerer: strict grounding prompt + **code-side** citation verification; `groundingStatus`. _(Req 8.1–8.5, 9)_ — `ground.ts composeGroundedAnswer` ✅ M3
- [x] 5.4 Refusal path: insufficient evidence → honest "no supported knowledge" result. _(Req 8.3, 8.4)_ — empty supported set → refusal before any model call ✅ M3

## 6. Curation services ✅ M2 (6.6 revert → M4)
- [x] 6.1 Edit item with revision snapshot + classification flip to `human`. _(Req 5.1)_ — `curation/curate.ts editItem`
- [x] 6.2 Add manual item. _(Req 5.2)_ — `addManualItem`
- [x] 6.3 Merge items (preserve all evidence + relationships). _(Req 5.3)_ — `mergeItems`
- [x] 6.4 Archive / invalidate (excluded from answers, still retrievable). _(Req 5.4)_ — `setStatus` + search exclusion
- [x] 6.5 Status change + confirm (record actor/time) + audit log on every curation action. _(Req 4.4, 5.5)_ — `setStatus` + `knowledge_changes` + `audit_log`
- [ ] 6.6 `revertChange`: undo a mistaken correction using the stored revision. _(Req 10.4)_ — M4

## 7. Conversation & teaching services (the chat loop) ✅ M3
- [x] 7.1 Conversations/messages: create/list/get; persist each user + assistant message with ordinal. _(Req 9.1, 9.3)_ — service + `converse.answerQuestion`
- [x] 7.2 `answerQuestion`: ground (via §5), persist assistant message + `message_grounding` + citations + `grounding_status`. _(Req 8.1, 8.2, 8.6)_ — `conversation/converse.ts`
- [x] 7.3 `previewCorrection` — identify affected items (grounding set + retrieval over correction text) and return the proposed change + new understanding. Applies NOTHING. _(Req 8.7, 8.8)_ — verified: preview writes nothing (e2e)
- [x] 7.4 `confirmCorrection` (explicit user confirm only) — create `chat_correction` note source for provenance. _(Req 8.9)_
- [x] 7.5 `confirmCorrection` — apply via curation: version affected items, `source_classification='human'`. _(Req 8.9, 8.10)_
- [x] 7.6 `confirmCorrection` — record `corrections` + `knowledge_changes` + `audit_log`, linking message ↔ correction ↔ item ↔ revision. _(Req 9.2, 9.4)_
- [~] 7.7 Correction conflict path: contradicting confirmed knowledge → surfaced via preview `wouldConflictWithConfirmed` flag; auto `contradicts`+`conflicted` edge on correction deferred to M4. _(Req 8.12)_
- [x] 7.8 Verify corrected knowledge is used by subsequent `answerQuestion` calls. _(Req 8.11)_ — verified in `scripts/ask-e2e.ts`
- [x] 7.9 `getItemHistory`: assemble revisions + changes + causes (ingestion/manual/correction). _(Req 9.5)_ — M2; conversation back-link via `knowledge_changes.correction_id`

## 8. UI — Knowledge (ingest) ✅ M2
- [x] 8.1 Add-knowledge forms: upload PDF/image, paste text, add URL, write note. _(Req 1.1–1.5)_ — `app/knowledge/KnowledgeClient.tsx`
- [x] 8.2 Ingestion status list (polls `ingestion_jobs`), shows resulting items. _(Req 1.7)_ — live-polling job list

## 9. UI — Explorer ✅ M2
- [x] 9.1 Browse by entity type with counts; status badges. _(Req 6.1)_ — `app/explorer/ExplorerClient.tsx`
- [x] 9.2 Hybrid search box + filters (type/status). _(Req 6.2, 6.3)_ — searches via `/api/items?q=`

## 10. UI — Knowledge Item ✅ M2 (history timeline basic; conversation link M3)
- [x] 10.1 Item view: claim, status, confidence, classification, sources/evidence, timestamps, related items. _(Req 7.1, 7.3, 2.2)_ — `app/item/[id]/ItemClient.tsx`
- [x] 10.2 Curation actions wired to §6 services (edit/status/archive/invalidate; merge/relate via API). _(Req 7.2)_
- [x] 10.3 Item history timeline: revisions + changes + cause. _(Req 9.4, 9.5)_ — conversation back-link lands with M3 chat

## 11. UI — Ask (chat: use + teach) ✅ M3
- [x] 11.1 Chat UI calling `answerQuestion`; conversation list + threads; render answer + citation chips (items + sources). _(Req 8.1, 8.2, 8.6)_ — `app/ask/AskClient.tsx`
- [x] 11.2 Render refusal + conflict-surfacing states honestly. _(Req 8.3, 8.5)_ — grounding badge (grounded/partial/insufficient) + conflict badge
- [x] 11.3 Teaching flow: "this is wrong/incomplete" affordance → correction input → calls `previewCorrection`. _(Req 8.7)_
- [x] 11.4 Show what will change + proposed new understanding; require an explicit "Apply correction" click that calls `confirmCorrection` (never auto-apply). _(Req 8.8, 8.9, 8.12)_ — before/after diff + confirmed-conflict warning
- [x] 11.5 After apply, show "updated knowledge item X" inline with a link to its history. _(Req 8.11, 9.4)_ — "Knowledge updated · view item"

## 12. UI — History
- [ ] 12.1 Browse past conversations list. _(Req 9.3)_
- [ ] 12.2 Conversation view: per-message question/answer, grounding set, corrections, resulting knowledge changes, timestamps. _(Req 9.2, 9.3, 9.4)_

## 13. UI — Admin / Ingestion ops
- [ ] 13.1 Failed/low-confidence job queue with error detail + retry + re-run extraction. _(Req 10.1, 10.3)_
- [ ] 13.2 Conflict resolution: side-by-side conflicted items + resolve (confirm/outdated/keep/edit). _(Req 10.2)_
- [ ] 13.3 Recent corrections list; inspect and revert a mistaken correction via `revertChange`. _(Req 10.4)_

## 14. Hardening & verification
- [ ] 14.1 Seed/demo script: ingest a few representative Sampleify docs end-to-end. _(DoD)_
- [ ] 14.2 Grounding tests: assert the Brain refuses when evidence absent and cites when present. _(Req 8.3, 8.4, 12)_
- [ ] 14.3 Teaching test: correct a seeded fact in chat, assert the item is versioned (prior value kept), classification=human, and a later answer uses the corrected value. _(Req 8.9–8.11)_
- [ ] 14.4 Verify `BrainService` HTTP + in-process parity with a sample consumer call. _(Req 11.4)_
- [ ] 14.5 Deploy to Vercel + Supabase; confirm env/secrets handling. _(Req 12.1, 12.2)_

---

## 15. Web research (dual-source answering) ✅ M5
- [x] 15.1 DB migration: `research_sessions`, `research_queries`, `research_findings`, `message_research`; `messages.sources_used`. _(Req 13.10)_ — `0005_research.sql` (applied live)
- [x] 15.2 Single-method `WebResearchProvider` interface + `GeminiWebResearchProvider` (native Google Search grounding) + `MockWebResearchProvider`; env `WEB_RESEARCH_PROVIDER` (`gemini`|`mock`) reusing `GOOGLE_GENERATIVE_AI_API_KEY` (server-side only). Tavily removed. _(Req 13.14, 12.7)_ — `src/providers/{web-research,gemini-research,mock-web-research}.ts`
- [x] 15.3 Research pipeline: plan queries → Gemini grounded research call → persist session + ACTUAL queries + real grounded findings (url, title, excerpt from grounding metadata). _(Req 13.10, 13.15)_ — `src/brain/research/research.ts`
- [x] 15.4 Routing: explicit force-research; auto on insufficient/partial internal grounding; heuristic for standards/current-facts/external bodies; prefer official/primary domains. Mock provider never auto-triggers (safety). _(Req 13.2–13.4, 13.7)_
- [x] 15.5 Dual-source answer composition: separate INTERNAL / EXTERNAL / INFERENCE / UNKNOWN; cite title+url+excerpt+date; code-side citation verification; distinguish direct requirement vs supports-compliance; never invent clause mappings. _(Req 13.5–13.9)_ — `src/brain/research/compose.ts`
- [x] 15.6 Persist `message_research` (external findings used) alongside `message_grounding`; `answerQuestion` accepts a research mode. _(Req 13.10)_
- [x] 15.7 Promotion: `promoteFinding` → create `url` source (`extraction_method='web_research'`) + `candidate` item + evidence, preserving provenance; audited. Never automatic. _(Req 13.11, 13.12)_
- [x] 15.8 Ask UI: research toggle, dual-source answer rendering (sections + external citation chips with url/date/primary), "web researched" badge, promote-finding action. _(Req 13.3, 13.5, 13.6, 13.12)_ — `app/ask/AskClient.tsx`
- [~] 15.9 History/Admin: `listResearchSessions` service + `/api/research` route expose sessions/queries/findings; dedicated History UI panel lands with the M4 History screen. _(Req 13.10)_
- [x] 15.10 Robustness + tests: inaccessible pages recorded + excluded; refuse when unsupported; e2e research test (`scripts/research-e2e.ts`, 13/13 live) incl. NABL/ISO-style dual-source composition + promotion. _(Req 13.15, 13.8)_

> **M5 verified (live Supabase):** `npm run typecheck` + `npm run build` green; `npm test` 10 passing; `scripts/research-e2e.ts` 13/13 and `scripts/ask-e2e.ts` 16/16 (no regression). Proves: research triggers + persists sessions/queries/findings; dual-source answer with INTERNAL/EXTERNAL/INFERENCE/UNKNOWN layers and `[K#]`/`[W#]` citations; inaccessible pages recorded + excluded from citations; `message_research` persisted; explicit promotion → `candidate` item + `url` source with preserved provenance (never auto-confirmed). Mock web provider never auto-triggers in `auto` mode (safety). **Web research uses Gemini native Google Search grounding** (reuses `GOOGLE_GENERATIVE_AI_API_KEY`; no Tavily dependency). Real source URLs/titles/excerpts captured from Gemini grounding metadata; mock output is clearly flagged `isMock`.

---

### Suggested milestones
- **M1 (plumbing):** tasks 0–3 — app, DB (incl. conversation/correction tables), provider, service skeleton.
- **M2 (knowledge in):** tasks 4, 8, 13.1 — ingestion end-to-end + Knowledge UI + ops.
- **M3 (ask + teach — the V1 core):** tasks 5, 7, 11 — retrieval/grounding, conversation+correction services, and the full chat/teaching UI. This is the primary V1 experience.
- **M4 (browse, trust & reuse):** tasks 6, 9, 10, 12, 13.2–13.3, 14 — curation, Explorer, Item+history, History UI, conflict/correction resolution, grounding+teaching tests, deploy.
- **M5 (web research — dual-source):** task 15 — `WebResearchProvider` (Gemini native Google Search grounding), research pipeline + persistence, routing, dual-source answers with distinct internal/external/inference/unknown layers, explicit promotion, research history. Builds on M3's chat.
