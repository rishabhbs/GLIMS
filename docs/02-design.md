# LIMS Brain — Design

Covers brief steps 2–7: information architecture & knowledge model, database schema, ingestion pipeline, source traceability & conflict handling, AI retrieval/grounding, and UI structure.

---

## 1. Architecture at a glance

```
                         ┌───────────────────────────────────────────────┐
                         │                  Next.js app                   │
                         │  (App Router, TypeScript, Server Components)    │
                         │                                                 │
   Browser  ───────────►│  UI: Knowledge · Explorer · Item · Ask · Admin  │
                         │                     │                           │
                         │        Route Handlers / Server Actions          │
                         └───────────────────────┬─────────────────────────┘
                                                 │  calls (in-process)
                                      ┌──────────▼───────────┐
                                      │     BrainService      │  ◄── the reusable
                                      │  (domain/service layer)│      intelligence API
                                      └──┬─────┬──────┬────────┘      (future apps call this)
                                         │     │      │
             ┌───────────────────────────┘     │      └─────────────────────────┐
             ▼                                  ▼                                ▼
   ┌──────────────────┐             ┌────────────────────┐           ┌────────────────────┐
   │ Ingestion engine │             │  Retrieval/Grounding│           │   Knowledge store   │
   │ (jobs: extract,  │             │  (hybrid search +   │           │  (repositories over │
   │  embed, dedupe)  │             │  relationship expand│           │   Postgres/pgvector)│
   └───────┬──────────┘             │  + grounded answer) │           └─────────┬──────────┘
           │                        └──────────┬──────────┘                     │
           ▼                                   ▼                                ▼
   ┌───────────────────────────────────────────────────────────────────────────────────┐
   │                         AI Provider Interface (ModelProvider)                        │
   │        chat() · structuredExtract() · embed()   ← swappable: OpenAI/Anthropic/…      │
   └───────────────────────────────────────────────────────────────────────────────────┘
           │                                                                     │
           ▼                                                                     ▼
   ┌──────────────────┐                                            ┌────────────────────────┐
   │  Supabase Storage│  original files (PDF, images)              │  Supabase Postgres      │
   │                  │                                            │  + pgvector + pg_trgm   │
   └──────────────────┘                                            └────────────────────────┘
```

### Layering rule (the important one)

- **UI** never touches the database or model provider directly. It calls **`BrainService`**.
- **`BrainService`** is the stable, UI-agnostic contract. Future apps (Social Media Engine etc.) call the *same* service, either in-process or over HTTP. This is what makes the Brain a reusable layer rather than an app feature.
- **Repositories** own all SQL. **ModelProvider** owns all model calls. Swapping Postgres details or model vendors touches only those layers.

### Why this stack (decisions, with rationale)

- **Next.js + TypeScript (App Router)** — one deployable for UI + API, server actions/route handlers for the backend, Vercel-native. Matches the brief.
- **Supabase Postgres + pgvector + pg_trgm** — one database for relational knowledge model *and* vector search *and* keyword search. For a knowledge layer that's a feature (not a standalone vector product), this is the current recommended default; it avoids running a separate vector service and lets us JOIN embeddings to the typed knowledge graph in a single query. (Confirmed against current guidance.)
- **Supabase Storage** — original PDFs/images; keep raw bytes forever for provenance.
- **Supabase Auth + RLS** — team access, scoped by `workspace_id`.
- **AI SDK as the provider plumbing, wrapped by our own `ModelProvider` interface** — the AI SDK already abstracts vendors, but we add a thin interface of our own so the Brain is not even coupled to the AI SDK. Callers depend on `ModelProvider`, not on any SDK.
- **DB-backed job queue + worker route (cron-invoked)** for ingestion — avoids serverless timeouts and makes ingestion observable and retryable without adding infra in Phase 1.

---

## 2. Information architecture & knowledge model

### 2.1 The core idea

Raw material flows **down** into evidence; meaning flows **up** into a typed graph:

```
Source  ──►  SourceChunk  ──►  Evidence  ──►  KnowledgeItem  ──►  KnowledgeRelationship
(file/url/   (text spans    (link: which    (one atomic        (typed edges between
 note/image)  + embeddings)   chunk supports   claim, typed,      items: uses, part_of,
                              which item)      with status +      evidence_for,
                                               confidence)        contradicts, …)
```

- A **Source** is an original artifact (PDF, URL, note, image) with raw bytes/text kept forever.
- A **SourceChunk** is a retrievable span of a source with an embedding — the unit of semantic search over *raw* material.
- A **KnowledgeItem** is the product: one atomic, typed claim ("Sampleify supports barcode-based sample receiving"). It also carries its own embedding for item-level search.
- **Evidence** connects an item to the specific chunk(s)/locators that support it — this is the provenance backbone (obligation 2).
- **KnowledgeRelationship** is a typed edge making the model a graph, not a list (obligation 3 / the anti-"chat with docs" requirement).

### 2.1b A correction is a source too

A human correction given in chat is **not** ingested as another document. It is a first-class authoring event that both (a) creates a lightweight `source` of type `note` with `extraction_method = 'chat_correction'` so the correction's exact wording is retained as provenance, and (b) directly edits the affected `knowledge_item`(s) via the versioning/audit machinery. The chat message, the correction source, the item revision, and the conversation all link together so the Brain can always answer "why do I now believe this, and who told me?"

```
Conversation ──► Message (question + answer)
                   │ grounded_on            └─► records which items/sources it used
                   ▼
                 Correction ──► creates Source(note, chat_correction)
                   │           └─► edits KnowledgeItem (new revision, source_classification=human)
                   ▼
                 KnowledgeChange  (links message ↔ affected item ↔ revision)
```

### 2.2 Proposed taxonomy (seeded, editable — not a hardcoded enum)

Entity types live in an `entity_types` table so you can add/rename without a migration.

| Type key | Meaning | Example |
|----------|---------|---------|
| `feature` | A product capability of Sampleify | "Barcode sample receiving" |
| `workflow` | An end-to-end process | "Sample lifecycle: receiving → allocation → testing → approval → reporting" |
| `workflow_step` | A step within a workflow | "Sample allocation" |
| `persona` | A user/buyer type | "Commercial laboratory owner" |
| `problem` | A customer pain the product addresses | "No visibility into turnaround time" |
| `customer` | A real customer/account | (sensitive) |
| `metric` | A measurable value / evidence | "Average TAT reduced to 24h" |
| `terminology` | A domain/product term + definition | "TAT = Turnaround Time" |
| `competitor` | A competing product | |
| `positioning` | A positioning/value statement | "Sampleify is the fastest path from sample to report" |
| `decision` | A historical product decision + rationale | "Chose per-sample barcoding over per-batch in 2024" |
| `limitation` | A known constraint / what it does *not* do | "No HL7 integration yet" |

Relationship types (also table-driven, `relationship_types`): `part_of`, `uses`, `precedes`, `addresses` (feature→problem), `serves` (feature→persona), `evidence_for` (metric→claim), `relates_to`, `supersedes`, `contradicts`, `defines` (terminology).

### 2.3 Status & confidence model

- `status`: `candidate` (freshly extracted, unreviewed) · `confirmed` (human-verified) · `interpretation` (model inference, not stated in a source) · `outdated` · `conflicted` · `archived` · `invalidated` · `unknown`.
- `source_classification`: `extracted` · `inferred` · `human`.
- `confidence`: float 0–1, set by extraction and overridable by humans.

A fact is only treated as **supported** for answering when `status ∈ {confirmed, candidate}` **and** `source_classification ∈ {extracted, human}` **and** it has at least one evidence row. Inferences can be shown but are labeled and never presented as fact.

---

## 3. Database schema

Postgres with extensions `vector` (pgvector) and `pg_trgm`. All core tables carry `workspace_id` for future multi-tenancy. Embedding dimension pinned to **1536** (configurable per deployment; see risks doc item 6).

```sql
-- Extensions
create extension if not exists vector;
create extension if not exists pg_trgm;

-- Tenancy / scoping
create table workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  created_at    timestamptz not null default now()
);

-- Editable taxonomy (NOT an enum)
create table entity_types (
  key           text primary key,          -- 'feature', 'workflow', ...
  label         text not null,
  description   text,
  sort_order    int not null default 0,
  is_system     boolean not null default false
);

create table relationship_types (
  key           text primary key,          -- 'uses', 'addresses', 'contradicts', ...
  label         text not null,
  description   text,
  is_directional boolean not null default true
);

-- SOURCES: original artifacts, kept forever
create table sources (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  type            text not null check (type in ('pdf','text','url','note','image','other')),
  title           text,
  uri             text,                       -- original URL for url sources
  storage_path    text,                       -- Supabase Storage path for files/images
  raw_text        text,                       -- extracted/normalized text
  content_hash    text not null,              -- for dedupe (idempotency)
  sensitivity     text not null default 'normal' check (sensitivity in ('normal','sensitive')),
  extraction_method text,                     -- 'pdf_parse','html_readability','vision','manual'
  added_by        uuid,                       -- auth user
  created_at      timestamptz not null default now(),
  unique (workspace_id, content_hash)
);

-- INGESTION JOBS: async, observable, retryable
create table ingestion_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  source_id       uuid not null references sources(id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued','extracting','embedding','extracted',
                                      'needs_review','failed','completed')),
  attempts        int not null default 0,
  error           text,
  idempotency_key text,                       -- prevents duplicate work on retry
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- SOURCE CHUNKS: retrievable spans of raw material, embedded
create table source_chunks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  source_id       uuid not null references sources(id) on delete cascade,
  ordinal         int not null,               -- order within source
  content         text not null,
  locator         jsonb,                       -- {page, section, char_start, char_end, ...}
  embedding       vector(1536),
  embedding_model text,                        -- which model produced the vector
  created_at      timestamptz not null default now()
);

-- KNOWLEDGE ITEMS: the product — one atomic typed claim
create table knowledge_items (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces(id),
  entity_type          text not null references entity_types(key),
  title                text not null,          -- short label
  claim                text not null,          -- the belief, one sentence/paragraph
  body                 text,                   -- optional elaboration
  status               text not null default 'candidate'
                         check (status in ('candidate','confirmed','interpretation',
                                           'outdated','conflicted','archived',
                                           'invalidated','unknown')),
  source_classification text not null default 'extracted'
                         check (source_classification in ('extracted','inferred','human')),
  confidence           real not null default 0.5 check (confidence between 0 and 1),
  attributes           jsonb not null default '{}',   -- type-specific fields (e.g. metric value/unit)
  embedding            vector(1536),
  embedding_model      text,
  superseded_by        uuid references knowledge_items(id),
  created_by           uuid,
  confirmed_by         uuid,
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- EVIDENCE: provenance backbone — which chunk supports which item
create table evidence (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  item_id         uuid not null references knowledge_items(id) on delete cascade,
  source_id       uuid not null references sources(id),
  chunk_id        uuid references source_chunks(id),
  snippet         text,                         -- the exact supporting text
  locator         jsonb,
  created_at      timestamptz not null default now()
);

-- RELATIONSHIPS: typed edges -> this is what makes it a graph
create table knowledge_relationships (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id),
  from_item_id      uuid not null references knowledge_items(id) on delete cascade,
  to_item_id        uuid not null references knowledge_items(id) on delete cascade,
  relationship_type text not null references relationship_types(key),
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  unique (from_item_id, to_item_id, relationship_type)
);

-- VERSIONING: keep prior values of an item (obligation 5 / req 5.1)
create table knowledge_item_revisions (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references knowledge_items(id) on delete cascade,
  snapshot        jsonb not null,               -- full prior item state
  changed_by      uuid,
  change_reason   text,
  created_at      timestamptz not null default now()
);

-- AUDIT: who did what (status changes, merges, archives…)
create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  actor           uuid,
  action          text not null,                -- 'status_change','merge','archive','edit','chat_correction',...
  target_type     text not null,                -- 'knowledge_item','source','conversation',...
  target_id       uuid,
  detail          jsonb,
  created_at      timestamptz not null default now()
);

-- CONVERSATIONS: the chat is a first-class product surface (ask + teach)
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  title           text,                         -- auto-derived from first question, editable
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- MESSAGES: every question/answer, fully traceable
create table messages (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id),
  conversation_id    uuid not null references conversations(id) on delete cascade,
  ordinal            int not null,              -- order within conversation
  role               text not null check (role in ('user','assistant','system')),
  content            text not null,             -- question or answer text
  grounding_status   text check (grounding_status in ('grounded','partial','insufficient')),
  citations          jsonb,                     -- [{claim, itemIds[], sourceIds[]}] for assistant msgs
  created_by         uuid,
  created_at         timestamptz not null default now()
);

-- MESSAGE GROUNDING SET: which items/sources an assistant answer actually used
create table message_grounding (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  message_id      uuid not null references messages(id) on delete cascade,
  item_id         uuid references knowledge_items(id),
  source_id       uuid references sources(id),
  rank            int,                           -- retrieval rank, for inspection
  created_at      timestamptz not null default now()
);

-- CORRECTIONS: a human correction given in chat — first-class knowledge update
create table corrections (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id),
  conversation_id    uuid not null references conversations(id),
  message_id         uuid references messages(id),       -- the message being corrected
  correction_text    text not null,                      -- the user's exact correction wording
  correction_source_id uuid references sources(id),      -- note source created for provenance
  status             text not null default 'applied'
                       check (status in ('proposed','applied','rejected','reverted')),
  created_by         uuid,
  created_at         timestamptz not null default now()
);

-- KNOWLEDGE CHANGES: the audit trail connecting a correction/message to the items it changed
create table knowledge_changes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  correction_id   uuid references corrections(id) on delete set null,
  message_id      uuid references messages(id),
  item_id         uuid not null references knowledge_items(id) on delete cascade,
  revision_id     uuid references knowledge_item_revisions(id),  -- prior-value snapshot
  change_type     text not null check (change_type in ('created','edited','outdated','superseded','relationship_added','status_changed')),
  before          jsonb,
  after           jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

-- Indexes
create index on source_chunks using hnsw (embedding vector_cosine_ops);
create index on knowledge_items using hnsw (embedding vector_cosine_ops);
create index on knowledge_items using gin (title gin_trgm_ops);
create index on knowledge_items using gin (claim gin_trgm_ops);
create index on knowledge_items (workspace_id, entity_type, status);
create index on evidence (item_id);
create index on knowledge_relationships (from_item_id);
create index on knowledge_relationships (to_item_id);
create index on messages (conversation_id, ordinal);
create index on message_grounding (message_id);
create index on message_grounding (item_id);
create index on knowledge_changes (item_id);
create index on knowledge_changes (correction_id);
create index on corrections (conversation_id);
```

RLS: every table filtered by `workspace_id = `the member's workspace. Phase 1 uses a single workspace.

---

## 4. Ingestion pipeline

Ingestion is **asynchronous and staged**. The upload request only stores the source and enqueues a job; the heavy work runs in a worker so it never hits serverless timeouts.

```
Upload/submit ──► store Source (+ Storage) ──► create ingestion_job (queued)
                                                      │
          (cron / after() triggers worker route)      ▼
                                             ┌───────────────────┐
                                             │  Worker: process   │
                                             └───────┬───────────┘
   1. EXTRACT TEXT        (pdf parse / html readability / OCR+vision / passthrough)
   2. CHUNK              (semantic/overlap chunking → source_chunks)
   3. EMBED CHUNKS       (ModelProvider.embed → vector + embedding_model)
   4. EXTRACT KNOWLEDGE  (ModelProvider.structuredExtract → atomic typed claims + evidence spans)
   5. DEDUPE/LINK        (vector match vs existing items → candidate merge or new item)
   6. RELATE             (model proposes relationships among new+nearby items)
   7. STATUS             (all new items = candidate; low-confidence/untyped → needs_review)
         │
         ▼
   job = completed | needs_review | failed  (errors recorded, source preserved)
```

Key properties:
- **Idempotent** via `content_hash` (source) and `idempotency_key` (job). Re-ingesting identical content does nothing unless forced.
- **Structured extraction** uses the provider's structured-output capability with a strict schema so the model returns typed items + the exact supporting snippet per item (that snippet becomes the evidence). The extraction prompt forbids inventing claims not present in the text and requires each item to quote its support.
- **Dedupe before create**: new candidate items are embedded and compared to existing items of the same type; high similarity routes to a *merge suggestion* rather than a silent new row.
- Humans review `candidate`/`needs_review` items in Explorer/Admin and promote to `confirmed`.

---

## 5. Source traceability & conflicting knowledge

### Traceability (obligation 2 & 8)
- Every `knowledge_item` reaches its origin via `evidence → source_chunk → source`, with `locator` (page/section/char range or URL) stored at both chunk and evidence level.
- Human edits never delete evidence; they create a `knowledge_item_revisions` snapshot and (if the human rewrote the claim) mark that revision `human`. The original extracted evidence stays attached.
- Ask answers attach, per factual claim, the `item_id`s used and their sources — the UI renders these as citations.

### Conflicting knowledge (obligation 4)
- During dedupe/relate, if a new claim semantically matches an existing one but **asserts a different value** (detected by the extraction/compare step, e.g. different metric value or negation), the Brain creates a `contradicts` relationship and sets both items to `conflicted`.
- `conflicted` items are **excluded from confident answers** and **surfaced in Admin** side-by-side.
- Resolution is always human: confirm one, mark the other `outdated` with `supersedes`, keep both as context, or edit. The system never auto-picks.
- `outdated` items are retained and linked via `supersedes` so history is preserved (obligation 4: outdated info is represented, not deleted).

---

## 6. AI retrieval & grounding architecture

### 6.1 Provider interface (vendor-agnostic)

```ts
interface ModelProvider {
  embed(texts: string[]): Promise<{ vectors: number[][]; model: string }>;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  structuredExtract<T>(input: string, schema: JSONSchema, opts?): Promise<T>;
}
```
- Concrete `OpenAIProvider`, `AnthropicProvider` (and a `MockProvider` for tests) implement this. The rest of the system depends only on `ModelProvider`, selected by env (`MODEL_PROVIDER`). Embedding model + dims come from config.

**A separate `WebResearchProvider`** abstracts live web search + page extraction (distinct from `ModelProvider`). See §9.

### 6.2 Retrieval (hybrid + graph expansion)

```
question ──► embed ──► (A) vector search over knowledge_items
                        (B) keyword search (pg_trgm) over knowledge_items
                        └─► reciprocal-rank fusion ──► top-K items
                                   │
                                   ▼
                        graph expansion: pull directly-related items
                        (uses / addresses / evidence_for / contradicts)
                                   │
                                   ▼
                        filter: drop archived/invalidated;
                        keep conflicted but flag it
                                   │
                                   ▼
                        attach evidence (snippets + sources) to each item
```

Searching **knowledge_items** (not raw chunks) is what makes this a knowledge system rather than doc-chat. Raw `source_chunks` search is available as a fallback for "find the original passage," but answers are composed from curated items.

### 6.3 Grounded answering (obligation 9 — never invent)

```
retrieved items (+evidence) ──► build grounded context
                               ├─ if supported-evidence set is empty/weak:
                               │     return { answer: "No supported knowledge", citations: [] }
                               └─ else: ModelProvider.chat(system: strict grounding rules,
                                                            context: items+evidence,
                                                            question)
                                        ──► answer with inline citation markers
                                        ──► post-check: every factual sentence maps to an item id;
                                            drop/flag any claim without a citation
```

Grounding rules enforced in the system prompt **and** verified in code post-generation:
- Use only the provided knowledge items; do not add external facts.
- Every capability/metric/customer/number must cite an item id.
- If evidence is insufficient, say so plainly.
- If items conflict, present the conflict, don't resolve it.

The return shape always includes `citations: {claim, itemIds, sourceIds}[]` and `groundingStatus: 'grounded' | 'partial' | 'insufficient'`, so any consumer (UI today, Social Media Engine tomorrow) can enforce grounding on its side too.

### 6.4 The conversational teaching loop (ask + correct)

The in-app chat is the primary way a human both **uses** and **teaches** the Brain in V1. It is a real product workflow backed by `BrainService` — not something done through a Kiro conversation. Two paths run through the same conversation:

**Ask path**
```
user question ──► BrainService.answerQuestion(conversationId, question)
   1. retrieve + ground (as §6.2–6.3)
   2. persist a user message + an assistant message
   3. persist message_grounding (every item/source used) + citations + grounding_status
   4. return GroundedAnswer with messageId  ◄── the message is now itself traceable
```

**Correct path (teaching)** — triggered when the user says an answer is wrong/incomplete and provides the right information:
```
user correction ──► BrainService.applyCorrection(conversationId, { messageId, correctionText })
   1. IDENTIFY affected items:
        start from the corrected message's grounding set, then run retrieval over the
        correction text to find any other items it touches.
   2. PROPOSE the change set (which items get edited / added / outdated) + the proposed new
        understanding — surfaced to the user in chat. NOTHING is applied yet. Corrections are
        NEVER auto-applied; the user must explicitly click "Apply correction". `applyCorrection`
        therefore has two stages: previewCorrection (steps 1–2) and confirmCorrection (steps 3–6).
   3. CREATE a Source(note, extraction_method='chat_correction') capturing the exact wording
        → the correction has provenance like any other knowledge.
   4. APPLY via the curation layer:
        - edit the affected item(s): write knowledge_item_revisions snapshot (prior value),
          set source_classification='human', update claim/body/attributes.
        - if the correction supersedes an older belief: mark old item 'outdated' + add
          'supersedes' relationship to the new/updated item.
        - attach evidence rows pointing at the correction source.
   5. RECORD: a corrections row, knowledge_changes rows (before/after + revision link),
        and audit_log entries — linking message ↔ correction ↔ item ↔ revision both ways.
   6. CONFLICT: if the correction contradicts existing confirmed knowledge, create a
        'contradicts' edge + 'conflicted' status and surface it (per §5) rather than
        silently overwriting — the human input is still recorded.
```

Worked example (from the brief):
- Existing item: *"Sample allocation takes place after approval."* (status `confirmed`).
- User corrects in chat: *"Sample allocation happens immediately after sample receiving; approval occurs later."*
- Brain identifies that item from the answer's grounding set, snapshots its prior value into `knowledge_item_revisions`, updates the claim, sets `source_classification='human'`, creates a `chat_correction` note source, writes a `corrections` row + `knowledge_changes` row linking the message to the revision, and (because sequencing changed) may add/adjust `precedes` relationships among the workflow steps.
- Future `answerQuestion` calls now retrieve the corrected claim; the item's history shows the prior belief, the correction text, who made it, and when.

Because this loop lives in `BrainService`, a future consumer could teach the Brain through the same contract — but no consumer app is built in this phase.

### 6.5 Conversation history & reconstructing understanding

- Every message retains: question/answer, `grounding_status`, `citations`, and a `message_grounding` set (items + sources used).
- Every correction retains its exact text, the note source created, and `knowledge_changes` rows tying it to item revisions.
- A knowledge item's **history view** is assembled from `knowledge_item_revisions` + `knowledge_changes` + `audit_log`: each entry shows what changed, the cause (ingestion / manual edit / chat correction), the originating conversation+message if any, and when. This is how a user reconstructs *why the Brain currently believes what it believes*.
- Provenance is bidirectional: an item links back to the conversation that changed it; a conversation links forward to the knowledge changes it caused.

### 6.6 `BrainService` — the reusable contract

```ts
interface BrainService {
  // knowledge in
  ingestSource(input: IngestInput): Promise<{ sourceId: string; jobId: string }>;
  // knowledge out
  searchKnowledge(q: SearchQuery): Promise<KnowledgeHit[]>;         // hybrid + filters
  getItem(id: string): Promise<KnowledgeItemWithProvenance>;
  getItemHistory(id: string): Promise<KnowledgeChangeEntry[]>;      // revisions + changes + causes
  // conversational ask + teach (V1 primary surface)
  createConversation(input): Promise<{ conversationId: string }>;
  listConversations(q): Promise<ConversationSummary[]>;
  getConversation(id): Promise<ConversationWithMessages>;           // messages + grounding + changes
  answerQuestion(q: AskQuery): Promise<GroundedAnswer>;             // persists messages+grounding; obligation 9 enforced
  previewCorrection(input: CorrectionInput): Promise<CorrectionPreview>;  // identify + propose; applies NOTHING
  confirmCorrection(input: ConfirmCorrectionInput): Promise<CorrectionResult>; // only after explicit user confirm
  // curation
  upsertItem / mergeItems / setStatus / relateItems / addManualItem / revertChange
}
```
- `answerQuestion` takes a `conversationId` and persists both messages + the grounding set.
- The teaching entry point is two-stage: `previewCorrection` (identify + propose, applies nothing) then `confirmCorrection` (only after the user explicitly clicks "Apply correction"). Corrections are never auto-applied.
- `revertChange` undoes a mistaken correction using the stored revision (supports Admin req 10.4).
- Same contract in-process and over HTTP (route handlers wrap the service). A future app can `import { BrainService }` in a monorepo or call the HTTP API — identical semantics. This is the single most important seam for the long-term vision: *the Social Media Engine never re-derives product knowledge; it asks the Brain and gets grounded items back.*

Example a future consumer would make (illustrative, not built now):
`answerQuestion({ intent: 'content_ideas', topic: 'sample turnaround time', audience: 'commercial laboratory owner', groundedOnly: true })` → returns only items with supporting evidence + citations; the consumer composes posts from that.

---

## 7. UI structure

Next.js App Router. Five areas, all talking to `BrainService` via server actions / route handlers.

```
/                     → redirect to /ask (chat is the primary V1 surface)
/knowledge            → Add knowledge (upload PDF/image, paste text, add URL, write note)
                        + live ingestion status list (jobs)
/explorer             → Browse by entity type (tabs/sections w/ counts) + hybrid search
                        + filters (type, status, source, confidence)
/item/[id]            → Knowledge Item view: claim, status, confidence, classification,
                        sources/evidence, timestamps/actors, related items, edit/curate actions,
                        + HISTORY timeline (revisions, changes, originating conversation)
/ask                  → Full chat experience: grounded Q&A with citation chips, PLUS the
   /ask/[conversationId]  teaching loop — flag an answer wrong/incomplete, type the correction,
                        review the proposed knowledge change, apply it. Shows per-message
                        grounding + "this changed knowledge item X" affordances.
/history              → Browse past conversations; open any conversation/message to see its
   /history/[id]        question, answer, grounding set, corrections, and resulting knowledge
                        changes with timestamps.
/admin                → Failed/low-confidence ingestion queue + conflict resolution UI
                        + re-run extraction / retry job + recent corrections (inspect/revert)
```

Component/data conventions:
- Server Components fetch via `BrainService`; mutations are server actions that also write `audit_log`/revisions/`knowledge_changes`.
- The chat is a real product workflow: asking persists messages + grounding; correcting runs `applyCorrection` and shows the resulting change inline, with a link to the affected item's history.
- Citations render as chips; clicking opens the `/item/[id]` or the source locator.
- Status is always visible as a colored badge (`confirmed`, `candidate`, `conflicted`, …) so trust level is never hidden.
- Ingestion status streams/polls the `ingestion_jobs` table.
- Item view and conversation view cross-link (bidirectional provenance): an item shows which conversations changed it; a conversation shows which items it changed.

---

## 8. Repo structure (proposed)

```
GLIMS/
  docs/                         ← these specs
  .kiro/steering/               ← persistent conventions
  app/                          ← Next.js routes (knowledge, explorer, item, ask, admin, api/*)
  src/
    brain/                      ← BrainService + domain logic (THE reusable layer)
      service.ts
      ingestion/                ← extract, chunk, embed, dedupe, relate
      retrieval/                ← hybrid search, graph expansion, grounding
      conversation/             ← answerQuestion, applyCorrection (teaching loop), history
      curation/                 ← merge, status, revisions, audit, revertChange
    providers/                  ← ModelProvider interface + openai/anthropic/mock impls
    db/                         ← repositories (all SQL), supabase client, types
    config/                     ← env, embedding dims, provider selection
  supabase/
    migrations/                 ← schema + seed taxonomy
```

The dependency arrow is strict: `app → src/brain → {src/db, src/providers}`. Nothing in `app` imports `src/db` or `src/providers` directly. This is enforced by convention (steering) and keeps the Brain reusable.

---

## 9. Web research (dual-source answering)

LIMS Brain is no longer a closed system. It has **two knowledge sources**:

- **Internal Brain** — ingested Sampleify material, verified product knowledge, evidence, and human corrections (everything in `knowledge_items` + `sources`).
- **External research** — live web search + page extraction, performed on demand through a `WebResearchProvider`.

The hard rules are unchanged and now span both: never invent facts, cite everything, keep provenance, and prefer "insufficient evidence" over fabrication. External findings are clearly separated from internal product knowledge and **never auto-promoted** into the Brain.

### 9.1 `WebResearchProvider` (separate from `ModelProvider`)

Web research uses **Gemini's native Google Search grounding** — no third-party search API. Gemini performs search + synthesis + citation in one call and returns real grounding metadata, so the interface is a single `research()` method (not a Tavily-style `search()`+`extract()` split):

```ts
interface WebResearchProvider {
  readonly name: string;
  readonly isMock: boolean;                               // true distinguishes mock from real
  research(query: string, opts?: { includeDomains?: string[]; days?: number }): Promise<WebResearchOutput>;
}

interface WebResearchOutput {
  answer: string;                 // model's synthesized grounded answer
  queries: string[];              // ACTUAL search queries Gemini ran (grounding metadata)
  sources: ResearchSource[];      // real grounded sources
  isMock: boolean;
}
interface ResearchSource { url: string; title: string | null; excerpt: string | null; }
```

- Concrete `GeminiWebResearchProvider` (default) + `MockWebResearchProvider` (offline/tests, `isMock=true`). Selected by env `WEB_RESEARCH_PROVIDER` (`gemini` | `mock`).
- **Chosen approach: Gemini native Google Search grounding** (reuses `@ai-sdk/google` + `GOOGLE_GENERATIVE_AI_API_KEY`; set `useSearchGrounding: true`). Fewer moving parts: no separate search/extract vendor, one credential, and the hosted app calls Gemini directly (independent of any local Kiro session/CLI).
  - **Real citations only:** source URLs, titles, and grounded excerpts are read verbatim from `providerMetadata.google.groundingMetadata` (`groundingChunks[].web.{uri,title}` + `groundingSupports[].segment.text`) and the SDK `sources` array. We never fabricate citations or excerpts; if grounding returns no sources, we report none.
  - **URL context:** when the model/version supports it, `url_context` can be combined with search grounding to inspect specific pages; grounding metadata still carries the real URLs.
  - **Cost/key:** billed as normal Gemini usage on `GOOGLE_GENERATIVE_AI_API_KEY` (server-side only). No `TAVILY_API_KEY` and no Tavily dependency.
  - The interface is kept only for the useful mock/real split; it is not over-abstracted.

### 9.2 Routing: when to research

```
question ──► internal retrieve+ground (as §6)
   │
   ├─ explicit "Research the web" toggle on? ───────────────► always research
   ├─ internal groundingStatus = insufficient/partial? ────► research
   ├─ question needs current facts / external standards?  ──► research
   │     (heuristic: mentions standards/regulations/clauses, "latest/current/today",
   │      competitors, or named external bodies e.g. NABL, ISO, IEC)
   └─ otherwise ─────────────────────────────────────────► internal only
```

The user can **always force** research via a toggle. For standards/regulatory/compliance questions, routing prefers **official/primary domains** (via `include_domains` and prompt instruction).

### 9.3 Research pipeline

```
plan queries (model) ──► WebResearchProvider.search ──► rank + dedupe results
   ──► extract top pages (WebResearchProvider.extract) ──► per-page: pull supporting excerpts
   ──► persist research_session + research_queries + research_findings (URL, title, excerpt,
       published/retrieved dates, raw text) ──► return findings as external evidence
```

- Inaccessible pages (`ok=false`) are recorded with their error and excluded from citations.
- All findings persist so the answer is reproducible and inspectable.

### 9.4 Dual-source answer composition

The answer is assembled from **two labelled evidence pools** and explicitly separates four layers (brief §2):

```
INTERNAL (Sampleify)   external (web)        INFERENCE            unknown
established by           established by        Brain's reasoning    not supported by
knowledge_items +        research_findings     over both pools      either pool → say so
their evidence           (title/url/excerpt/
                         date)
```

- The grounding prompt requires the model to attribute every factual sentence to either an internal item `[Kn]` or an external finding `[Wn]`, to mark reasoning as **Inference**, and to list what remains **Unknown/unverified**.
- Citations carry: source title, URL (for web), excerpt, and publication/retrieval date where available. Internal citations link to `/item/[id]`; external link out to the URL.
- Code-side verification maps every marker back to a real item/finding; unmapped claims are flagged and the grounding status downgraded.

**NABL example flow** (brief §3): retrieve the internal feature + its evidence → research official NABL / ISO/IEC 17025 docs (prefer primary domains) → identify clause/edition/wording where available → explain how the feature relates → distinguish a *direct requirement* from a feature that merely *supports compliance* → cite both the requirement source (web) and the capability evidence (internal). Never assert a clause mapping that the sources don't support; never imply using Sampleify guarantees accreditation.

### 9.5 Promotion: research → Brain (explicit, never automatic)

- Research findings live in their own tables and are **external** by default. They never become `confirmed` product knowledge on their own.
- The user can **promote** a finding into the Brain: this creates a `source` (type `url`) with the finding's URL + retrieved content and `extraction_method='web_research'`, then creates a `knowledge_item` (status `candidate`, `source_classification='extracted'`) with evidence linking to that source. Provenance (original URL, excerpt, dates) is preserved.
- Promotion is a curation action — audited like any other.
- Human **corrections** to answers still flow through the existing preview → explicit confirm → versioned change path (unchanged).

### 9.6 Schema additions

```sql
create table research_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  question text not null,
  trigger text not null check (trigger in ('explicit','auto_insufficient','auto_heuristic')),
  provider text not null,
  created_at timestamptz not null default now()
);

create table research_queries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references research_sessions(id) on delete cascade,
  query text not null,
  include_domains text[],
  created_at timestamptz not null default now()
);

create table research_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  session_id uuid not null references research_sessions(id) on delete cascade,
  query_id uuid references research_queries(id) on delete set null,
  url text not null,
  title text,
  excerpt text,            -- supporting excerpt used for the answer
  raw_text text,           -- extracted page content (nullable if inaccessible)
  published_date text,     -- as reported by the source, if any
  retrieved_at timestamptz not null default now(),
  is_primary_source boolean not null default false,  -- official/primary heuristic
  accessible boolean not null default true,
  error text,
  promoted_source_id uuid references sources(id),     -- set when promoted into the Brain
  created_at timestamptz not null default now()
);

-- link which research findings an answer used (parallels message_grounding for internal items)
create table message_research (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  message_id uuid not null references messages(id) on delete cascade,
  finding_id uuid not null references research_findings(id) on delete cascade,
  rank int,
  created_at timestamptz not null default now()
);
```

Messages gain a `sources_used jsonb` summary (internal vs external counts) and `grounding_status` already covers refusal. A message now records BOTH `message_grounding` (internal) and `message_research` (external) so the full answer is reproducible and inspectable in History.
