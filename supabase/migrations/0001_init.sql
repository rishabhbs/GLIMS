-- ============================================================================
-- LIMS Brain — initial schema (Phase 1 / M1)
-- Postgres + pgvector + pg_trgm. Embedding dimension pinned to 1536.
-- See docs/02-design.md §3 for the model and rationale.
-- ============================================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ── Tenancy ────────────────────────────────────────────────────────────────
create table if not exists workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  created_at    timestamptz not null default now()
);

-- ── Editable taxonomy (NOT enums) ───────────────────────────────────────────
create table if not exists entity_types (
  key            text primary key,
  label          text not null,
  description    text,
  sort_order     int not null default 0,
  is_system      boolean not null default false
);

create table if not exists relationship_types (
  key            text primary key,
  label          text not null,
  description    text,
  is_directional boolean not null default true
);

-- ── Sources: original artifacts, kept forever ──────────────────────────────
create table if not exists sources (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id),
  type              text not null check (type in ('pdf','text','url','note','image','other')),
  title             text,
  uri               text,
  storage_path      text,
  raw_text          text,
  content_hash      text not null,
  sensitivity       text not null default 'normal' check (sensitivity in ('normal','sensitive')),
  extraction_method text,
  added_by          uuid,
  created_at        timestamptz not null default now(),
  unique (workspace_id, content_hash)
);

-- ── Ingestion jobs: async, observable, retryable ───────────────────────────
create table if not exists ingestion_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  source_id       uuid not null references sources(id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued','extracting','embedding','extracted',
                                      'needs_review','failed','completed')),
  attempts        int not null default 0,
  error           text,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Source chunks: embedded retrievable spans of raw material ───────────────
create table if not exists source_chunks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  source_id       uuid not null references sources(id) on delete cascade,
  ordinal         int not null,
  content         text not null,
  locator         jsonb,
  embedding       vector(1536),
  embedding_model text,
  created_at      timestamptz not null default now()
);

-- ── Knowledge items: the product — one atomic typed claim ───────────────────
create table if not exists knowledge_items (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id),
  entity_type           text not null references entity_types(key),
  title                 text not null,
  claim                 text not null,
  body                  text,
  status                text not null default 'candidate'
                          check (status in ('candidate','confirmed','interpretation',
                                            'outdated','conflicted','archived',
                                            'invalidated','unknown')),
  source_classification text not null default 'extracted'
                          check (source_classification in ('extracted','inferred','human')),
  confidence            real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  attributes            jsonb not null default '{}'::jsonb,
  embedding             vector(1536),
  embedding_model       text,
  superseded_by         uuid references knowledge_items(id),
  created_by            uuid,
  confirmed_by          uuid,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── Evidence: provenance backbone ───────────────────────────────────────────
create table if not exists evidence (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  item_id         uuid not null references knowledge_items(id) on delete cascade,
  source_id       uuid not null references sources(id),
  chunk_id        uuid references source_chunks(id),
  snippet         text,
  locator         jsonb,
  created_at      timestamptz not null default now()
);

-- ── Relationships: typed edges -> graph ─────────────────────────────────────
create table if not exists knowledge_relationships (
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

-- ── Versioning + audit ──────────────────────────────────────────────────────
create table if not exists knowledge_item_revisions (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references knowledge_items(id) on delete cascade,
  snapshot        jsonb not null,
  changed_by      uuid,
  change_reason   text,
  created_at      timestamptz not null default now()
);

create table if not exists audit_log (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  actor           uuid,
  action          text not null,
  target_type     text not null,
  target_id       uuid,
  detail          jsonb,
  created_at      timestamptz not null default now()
);

-- ── Conversations: the chat is a first-class surface (ask + teach) ──────────
create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  title           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  ordinal          int not null,
  role             text not null check (role in ('user','assistant','system')),
  content          text not null,
  grounding_status text check (grounding_status in ('grounded','partial','insufficient')),
  citations        jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create table if not exists message_grounding (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  message_id      uuid not null references messages(id) on delete cascade,
  item_id         uuid references knowledge_items(id),
  source_id       uuid references sources(id),
  rank            int,
  created_at      timestamptz not null default now()
);

-- ── Corrections: chat corrections as first-class knowledge updates ──────────
create table if not exists corrections (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces(id),
  conversation_id      uuid not null references conversations(id),
  message_id           uuid references messages(id),
  correction_text      text not null,
  correction_source_id uuid references sources(id),
  status               text not null default 'proposed'
                         check (status in ('proposed','applied','rejected','reverted')),
  created_by           uuid,
  created_at           timestamptz not null default now()
);

create table if not exists knowledge_changes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  correction_id   uuid references corrections(id) on delete set null,
  message_id      uuid references messages(id),
  item_id         uuid not null references knowledge_items(id) on delete cascade,
  revision_id     uuid references knowledge_item_revisions(id),
  change_type     text not null
                    check (change_type in ('created','edited','outdated','superseded',
                                           'relationship_added','status_changed','reverted')),
  before          jsonb,
  after           jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_source_chunks_embedding
  on source_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists idx_knowledge_items_embedding
  on knowledge_items using hnsw (embedding vector_cosine_ops);
create index if not exists idx_knowledge_items_title_trgm
  on knowledge_items using gin (title gin_trgm_ops);
create index if not exists idx_knowledge_items_claim_trgm
  on knowledge_items using gin (claim gin_trgm_ops);
create index if not exists idx_knowledge_items_scope
  on knowledge_items (workspace_id, entity_type, status);
create index if not exists idx_evidence_item on evidence (item_id);
create index if not exists idx_rel_from on knowledge_relationships (from_item_id);
create index if not exists idx_rel_to on knowledge_relationships (to_item_id);
create index if not exists idx_messages_conversation on messages (conversation_id, ordinal);
create index if not exists idx_grounding_message on message_grounding (message_id);
create index if not exists idx_grounding_item on message_grounding (item_id);
create index if not exists idx_changes_item on knowledge_changes (item_id);
create index if not exists idx_changes_correction on knowledge_changes (correction_id);
create index if not exists idx_corrections_conversation on corrections (conversation_id);
