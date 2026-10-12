-- ============================================================================
-- Switch embedding dimension 1536 → 1024 (Amazon Titan Text Embeddings v2).
--
-- Why: moving fully off Google. Bedrock Titan v2 outputs 1024-dim vectors, which
-- are not comparable to the previous 1536-dim Gemini vectors, so existing
-- embeddings are cleared (set NULL) and must be re-embedded. Keyword search is
-- unaffected. Idempotent: safe to re-run (drops/recreates by name, guarded alters).
-- ============================================================================

-- 1. Drop vector indexes (type change requires removing dependent indexes).
drop index if exists idx_source_chunks_embedding;
drop index if exists idx_knowledge_items_embedding;

-- 2. One-time switch to vector(1024). Only null embeddings when the column is
--    STILL the old 1536 dim — otherwise this is a no-op, so re-running the
--    migration never wipes current (already-1024) embeddings.
do $$
declare dim int;
begin
  select atttypmod into dim from pg_attribute
    where attrelid = 'knowledge_items'::regclass and attname = 'embedding';
  -- pgvector stores dimension in atttypmod directly (e.g. 1536 or 1024).
  if dim is distinct from 1024 then
    update source_chunks   set embedding = null where embedding is not null;
    update knowledge_items set embedding = null where embedding is not null;
    alter table source_chunks   alter column embedding type vector(1024);
    alter table knowledge_items alter column embedding type vector(1024);
  end if;
end $$;

-- 3. Recreate the HNSW cosine indexes at the new dimension.
create index if not exists idx_source_chunks_embedding
  on source_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists idx_knowledge_items_embedding
  on knowledge_items using hnsw (embedding vector_cosine_ops);

-- 4. Recreate the semantic match RPC with the new vector dimension.
create or replace function match_knowledge_items(
  p_workspace_id uuid,
  p_query_embedding vector(1024),
  p_match_count int default 20,
  p_exclude_statuses text[] default array['archived','invalidated']
)
returns table (
  id uuid,
  entity_type text,
  title text,
  claim text,
  status text,
  source_classification text,
  confidence real,
  similarity real
)
language sql stable
as $$
  select
    ki.id,
    ki.entity_type,
    ki.title,
    ki.claim,
    ki.status,
    ki.source_classification,
    ki.confidence,
    (1 - (ki.embedding <=> p_query_embedding))::real as similarity
  from knowledge_items ki
  where ki.workspace_id = p_workspace_id
    and ki.embedding is not null
    and not (ki.status = any(p_exclude_statuses))
  order by ki.embedding <=> p_query_embedding
  limit p_match_count;
$$;
