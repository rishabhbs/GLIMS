# LIMS Brain — Requirements

Format: each requirement has a user story and acceptance criteria written in EARS style (WHEN / IF … THEN the system SHALL …). "The Brain" = the backend knowledge services. Phase 1 scope only.

---

## 1. Knowledge ingestion

**Story:** As a product knowledge owner, I want to add material from many source types so the Brain can learn from everything I have, not just one format.

1.1 WHEN a user uploads a PDF, THEN the Brain SHALL store the original file in object storage, create a `source` record referencing it, and enqueue an ingestion job.

1.2 WHEN a user submits raw text or a pasted document, THEN the Brain SHALL persist it as a `source` of type `text` and enqueue ingestion.

1.3 WHEN a user submits a URL, THEN the Brain SHALL fetch the main readable content of that single page, store both the URL and the extracted content, and enqueue ingestion.

1.4 WHEN a user adds a note, THEN the Brain SHALL store it as a `source` of type `note` authored by that user.

1.5 WHEN a user uploads an image/screenshot, THEN the Brain SHALL store the image, run OCR and a vision caption to produce text, record `extraction_method = 'vision'`, and enqueue ingestion.

1.6 IF an uploaded file exceeds configured size/type limits, THEN the Brain SHALL reject it before storage and return a clear error.

1.7 WHILE an ingestion job runs, the Brain SHALL expose its status as one of `queued`, `extracting`, `embedding`, `extracted`, `needs_review`, `failed`, or `completed`.

1.8 IF an ingestion job fails, THEN the Brain SHALL record the error, mark the source `failed`, and surface it in Admin without losing the original source.

1.9 WHEN the same source content is ingested twice (same content hash), THEN the Brain SHALL detect the duplicate and SHALL NOT create duplicate sources or re-run extraction unless forced.

---

## 2. Source traceability & provenance

**Story:** As a user, I need to trust answers, so every fact must trace back to where it came from.

2.1 WHEN the Brain extracts a knowledge item, THEN it SHALL link that item to at least one `evidence` record pointing to the exact source chunk/location it came from.

2.2 WHEN a user views any knowledge item, THEN the Brain SHALL display all contributing sources with enough locator detail to find the original (page/section/char range or URL).

2.3 The Brain SHALL retain the original source content for the life of the item, even after the item is edited by a human.

2.4 WHEN an answer in Ask asserts a factual claim, THEN the Brain SHALL attach citations to the underlying knowledge items/sources for that claim.

---

## 3. Knowledge extraction & modeling

**Story:** As a user, I want a structured product model, not isolated documents, so related concepts connect.

3.1 WHEN ingestion processes a source, THEN the Brain SHALL produce **atomic knowledge items** (one claim per item) typed against the taxonomy, not whole-document blobs.

3.2 WHEN two items describe the same real-world thing, THEN the Brain SHALL be able to detect candidate duplicates and offer a merge (never auto-merge confirmed items without review).

3.3 WHEN items are related (e.g. a workflow step uses a feature; a metric is evidence for a claim), THEN the Brain SHALL store a typed `knowledge_relationship` between them.

3.4 The Brain SHALL support, at minimum, these entity types, and SHALL store them table-driven so types can be added/renamed without a schema migration: Product/Feature, Workflow, Workflow Step, Persona, Problem, Customer, Metric/Evidence, Terminology, Competitor, Positioning, Decision, Limitation, Source.

3.5 WHEN extraction cannot confidently type or support a claim, THEN the Brain SHALL store it as a `candidate` with low confidence rather than discarding it.

---

## 4. Knowledge status & confidence

**Story:** As a user, I must distinguish what's confirmed from what's guessed, stale, or disputed.

4.1 Every knowledge item SHALL carry a `status` from: `candidate`, `confirmed`, `interpretation`, `outdated`, `conflicted`, `archived`, `invalidated`, `unknown`.

4.2 Every knowledge item SHALL carry a `confidence` score (0–1) and a `source_classification` of `extracted` (from source), `inferred` (model interpretation), or `human` (entered/edited by a person).

4.3 WHEN two confirmed items contradict each other, THEN the Brain SHALL create a `contradicts` relationship and set both items' status to `conflicted`, and SHALL NOT auto-resolve.

4.4 WHEN a human marks an item `confirmed`, THEN the Brain SHALL record who confirmed it and when.

4.5 IF a newer source supersedes an older claim, THEN a human SHALL be able to mark the older item `outdated` with a link to the superseding item.

---

## 5. Human curation

**Story:** As the knowledge owner, I need full editorial control over what the Brain believes.

5.1 WHEN a user edits an item's content, THEN the Brain SHALL version the change (keep prior value) and set `source_classification = 'human'` for that revision.

5.2 A user SHALL be able to add a knowledge item manually, with their own text as the source.

5.3 A user SHALL be able to merge two items into one, preserving all evidence/sources and relationships from both.

5.4 A user SHALL be able to archive or invalidate an item; archived/invalidated items SHALL be excluded from Ask answers by default but remain retrievable.

5.5 WHEN a user changes an item's status, THEN the Brain SHALL log the actor, timestamp, and prior status in an audit trail.

---

## 6. Knowledge Explorer

**Story:** As a user, I want to browse and search what the Brain knows across the taxonomy.

6.1 WHEN a user opens the Explorer, THEN the Brain SHALL present knowledge grouped by entity type with counts.

6.2 WHEN a user searches, THEN the Brain SHALL perform hybrid search (keyword + semantic) over items and return ranked results.

6.3 WHEN a user filters by status, type, source, or confidence, THEN the Explorer SHALL honor those filters.

6.4 WHEN a user selects an item, THEN the Brain SHALL open the Knowledge Item view.

---

## 7. Knowledge Item view

**Story:** As a user, for each item I want to see belief, confidence, provenance, relationships, and edit it.

7.1 The item view SHALL show: the claim, status, confidence, source_classification, all sources/evidence, created/updated timestamps and actors, and related items.

7.2 The item view SHALL allow edit, status change, merge, archive, invalidate, and adding a relationship — honoring section 5 rules.

7.3 WHEN related items exist, THEN the view SHALL let the user navigate to them.

---

## 8. Brain / Ask — the conversational teaching loop

**Story:** As a user, the chat is my primary way to use *and teach* the Brain. I ask questions, get grounded cited answers, and when something is wrong or incomplete I correct it right there — and that correction becomes a persistent, versioned knowledge change that future answers reflect. This is a real in-app product workflow, not something done through a Kiro conversation.

### 8A. Grounded answering
8.1 WHEN a user asks a question, THEN the Brain SHALL retrieve relevant knowledge items (hybrid search + relationship expansion) and compose an answer **only** from retrieved, non-archived, non-invalidated knowledge.

8.2 WHEN the answer contains factual claims, THEN each claim SHALL carry citations to the knowledge items/sources that support it, and the chat SHALL render those citations as inspectable references.

8.3 IF retrieval yields insufficient supported evidence, THEN the Brain SHALL say it does not have supported knowledge rather than fabricate an answer.

8.4 The Brain SHALL NOT invent product capabilities, metrics, customer results, or other factual claims under any circumstances (obligation 9).

8.5 WHEN conflicting knowledge is relevant, THEN the answer SHALL surface the conflict rather than silently choosing one side.

8.6 WHEN the Brain produces an answer, THEN it SHALL record which knowledge items and sources it used to produce that answer (the answer's grounding set), so the message is itself traceable.

### 8B. Correcting the Brain from chat
8.7 WHEN a user indicates an answer is wrong or incomplete and supplies a correction in chat, THEN the Brain SHALL treat that correction as a **first-class knowledge update**, not as a new document to ingest.

8.8 WHEN processing a correction, THEN the Brain SHALL identify which existing knowledge item(s) the correction affects (using the answer's grounding set + retrieval) and SHALL present (a) what will change and (b) the proposed new understanding — and SHALL NOT create any new knowledge version until the user explicitly confirms. Corrections SHALL NEVER be auto-applied, even for straightforward edits.

8.9 WHEN, and only when, the user explicitly confirms ("Apply correction"), THEN the Brain SHALL version the affected item(s) (preserve the prior value), set `source_classification = 'human'` on the new revision, record that the change originated from the user via a chat correction, timestamp it, and provide an undo/revert action.

8.10 WHEN a correction supersedes an older belief, THEN the Brain SHALL mark the old value appropriately (e.g. `outdated` with a `supersedes` link, or an in-place versioned edit) so the previous understanding is preserved, never silently discarded.

8.11 WHEN a correction has been applied, THEN subsequent answers SHALL use the corrected knowledge, and the Brain SHALL be able to show that an answer changed because of a specific correction.

8.12 IF a user's correction conflicts with existing confirmed knowledge, THEN the Brain SHALL surface the conflict (per section 4) rather than silently overwriting, while still recording the human input.

---

## 9. Conversations & history (first-class, traceable)

**Story:** As a user, I need every interaction persisted so I can inspect how the Brain arrived at its current understanding.

9.1 The Brain SHALL persist every conversation and every message within it.

9.2 For each message exchange, the Brain SHALL retain: the question, the answer, the sources/evidence used (grounding set), any correction the user provided, the knowledge items affected, the resulting knowledge changes, and timestamps.

9.3 A user SHALL be able to browse past conversations and open any message to see its grounding set and any knowledge changes it caused.

9.4 WHEN a knowledge change originated from a chat correction, THEN the item's history SHALL link back to the originating conversation/message, and the conversation SHALL link forward to the resulting knowledge change (bidirectional provenance).

9.5 The Brain SHALL present a timeline/history for a knowledge item showing each revision, who/what caused it (ingestion, manual edit, or chat correction), and when — so a user can reconstruct why the Brain believes what it currently believes.

9.6 Conversation and correction history SHALL be retained and auditable (not deleted) for the life of the workspace.

---

## 10. Admin / Ingestion ops

**Story:** As an operator, I need to see and fix what went wrong.

10.1 WHEN ingestion jobs fail or produce low-confidence output, THEN Admin SHALL list them with error detail and allow retry.

10.2 WHEN items are `conflicted`, THEN Admin SHALL present the conflicting items side by side and let a human resolve (confirm one, mark other outdated, keep both, or edit).

10.3 Admin SHALL let a user re-run extraction for a source.

10.4 Admin SHALL list recent chat corrections and let an operator inspect or (if a correction was mistaken) revert the knowledge change it caused, using the versioned history.

---

## 11. Reusable Brain API (foundation for future apps)

**Story:** As a future application (e.g. Social Media Engine), I want to request grounded knowledge from the Brain through a stable interface.

11.1 The Brain SHALL expose an internal service interface (`BrainService`) with operations to: ingest a source, search knowledge, get an item with provenance, answer a grounded question, manage conversations, and apply a correction — independent of any UI.

11.2 WHEN a consumer requests grounded knowledge, THEN the Brain SHALL return knowledge items **with** their evidence/citations and confidence, so the consumer can respect grounding itself.

11.3 The AI/model layer SHALL sit behind a provider interface so the model vendor can change without touching callers.

11.4 The `BrainService` SHALL be callable both in-process (future apps in the same deployment) and over HTTP (separate deployments), with the same contract.

11.5 The conversational answer + correction loop SHALL be implemented in `BrainService` (not in the UI), so any future consumer can both ask and teach the Brain through the same contract.

---

## 12. Non-functional

12.1 The system SHALL be deployable to Vercel with Supabase (Postgres + Storage + Auth).
12.2 Secrets (model keys, DB creds) SHALL only live in environment variables / Vercel project settings, never in the repo.
12.3 All destructive curation actions SHALL be reversible or audited (versioning + audit trail).
12.4 Source content SHALL NOT be transmitted to third parties beyond the configured model provider required for extraction/answers, and the configured web research provider when research is performed.
12.5 The embedding dimension SHALL be fixed per deployment and each embedding row SHALL record its `embedding_model` to permit controlled re-embedding.
12.6 Conversations, messages, grounding sets, corrections, and the knowledge changes they cause SHALL be persisted durably and remain traceable for the life of the workspace.
12.7 Web research credentials (search/extraction API keys) SHALL be server-side only, never exposed to the browser.

---

## 13. Web research (dual-source answering)

**Story:** As a user, I want the Brain to research the live web when a question needs outside, current, or missing information — while keeping internal product knowledge and external findings clearly distinct and fully traceable.

### 13A. Two sources & routing
13.1 The Brain SHALL have two knowledge sources: **internal** (ingested Sampleify knowledge/evidence/corrections) and **external** (live web search + page extraction).
13.2 The Brain SHALL use internal knowledge when sufficient and SHALL research the web when a question needs outside information, current facts, or information missing from the Brain.
13.3 A user SHALL be able to explicitly request web research for any question (a force-research control).
13.4 WHEN internal grounding is insufficient or partial, THEN the Brain SHALL be able to automatically trigger web research.

### 13B. Dual-source answers with clear distinctions
13.5 For every answer that uses research, the Brain SHALL distinguish: (a) what INTERNAL Sampleify sources establish, (b) what EXTERNAL sources establish, (c) what the Brain INFERS from those sources, and (d) what remains UNKNOWN or unverified.
13.6 Each factual claim SHALL carry clickable citations with source title, URL (for web), relevant excerpt, and publication/retrieval date where available.
13.7 WHEN answering standards/regulatory/compliance questions, THEN the Brain SHALL prefer official and primary sources.
13.8 The Brain SHALL NOT invent a clause mapping, standard requirement, or imply that using Sampleify guarantees accreditation/compliance. IF evidence is insufficient, THEN it SHALL say so.
13.9 WHEN relating a product feature to an external requirement, THEN the Brain SHALL distinguish a direct requirement from a feature that merely supports compliance, and SHALL cite both the requirement source and the capability evidence.

### 13C. Traceability & promotion
13.10 The Brain SHALL persist research sessions, queries, URLs, retrieved evidence, timestamps, and the answers that used them; this history SHALL be inspectable in the app.
13.11 External information SHALL NOT automatically become confirmed Sampleify product knowledge.
13.12 A user SHALL be able to review research findings and explicitly promote useful findings into the Brain, preserving their original sources and provenance (URL, excerpt, dates).
13.13 Human corrections to answers SHALL continue to use the existing preview → explicit confirmation → versioned knowledge change workflow.

### 13D. Provider & robustness
13.14 Web search + page extraction SHALL sit behind a `WebResearchProvider` abstraction, separate from `ModelProvider`, selectable by env.
13.15 The Brain SHALL handle inaccessible pages, conflicting sources, and insufficient evidence honestly (record errors, surface conflicts, refuse when unsupported).
