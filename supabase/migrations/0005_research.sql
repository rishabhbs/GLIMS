-- ============================================================================
-- Web research (dual-source answering). See docs/02-design.md §9.
-- External findings persist here as external evidence; they do NOT enter the
-- internal knowledge graph until a human explicitly promotes them.
-- ============================================================================

create table if not exists research_sessions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),
  conversation_id uuid references conversations(id) on delete set null,
  message_id      uuid references messages(id) on delete set null,
  question        text not null,
  trigger         text not null check (trigger in ('explicit','auto_insufficient','auto_heuristic')),
  provider        text not null,
  created_at      timestamptz not null default now()
);

create table if not exists research_queries (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references research_sessions(id) on delete cascade,
  query           text not null,
  include_domains text[],
  created_at      timestamptz not null default now()
);

create table if not exists research_findings (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id),
  session_id         uuid not null references research_sessions(id) on delete cascade,
  query_id           uuid references research_queries(id) on delete set null,
  url                text not null,
  title              text,
  excerpt            text,
  raw_text           text,
  published_date     text,
  retrieved_at       timestamptz not null default now(),
  is_primary_source  boolean not null default false,
  accessible         boolean not null default true,
  error              text,
  promoted_source_id uuid references sources(id),
  created_at         timestamptz not null default now()
);

create table if not exists message_research (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  message_id   uuid not null references messages(id) on delete cascade,
  finding_id   uuid not null references research_findings(id) on delete cascade,
  rank         int,
  created_at   timestamptz not null default now()
);

alter table messages add column if not exists sources_used jsonb;

create index if not exists idx_research_sessions_conv on research_sessions (conversation_id);
create index if not exists idx_research_queries_session on research_queries (session_id);
create index if not exists idx_research_findings_session on research_findings (session_id);
create index if not exists idx_message_research_message on message_research (message_id);

-- RLS: enable + authenticated-read (writes are server-side via service role).
do $$
declare t text;
begin
  foreach t in array array['research_sessions','research_queries','research_findings','message_research']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_auth_read', t);
    execute format('create policy %I on %I for select to authenticated using (true);', t || '_auth_read', t);
  end loop;
end$$;
