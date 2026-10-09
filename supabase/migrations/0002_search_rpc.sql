-- ============================================================================
-- Hybrid search building blocks for knowledge_items.
-- Vector similarity (pgvector) + trigram keyword similarity (pg_trgm).
-- The brain/retrieval layer fuses these ranks in application code (RRF).
-- ============================================================================

-- Semantic match over knowledge items by embedding.
create or replace function match_knowledge_items(
  p_workspace_id uuid,
  p_query_embedding vector(1536),
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

-- Keyword match over knowledge items by trigram similarity on title+claim.
create or replace function keyword_knowledge_items(
  p_workspace_id uuid,
  p_query text,
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
    greatest(
      similarity(ki.title, p_query),
      similarity(ki.claim, p_query)
    )::real as similarity
  from knowledge_items ki
  where ki.workspace_id = p_workspace_id
    and not (ki.status = any(p_exclude_statuses))
    and (ki.title % p_query or ki.claim % p_query)
  order by similarity desc
  limit p_match_count;
$$;
