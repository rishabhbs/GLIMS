-- ============================================================================
-- Row-Level Security. Phase 1 is single-workspace and all data access goes
-- through the server-side service-role client (which bypasses RLS). We still
-- enable RLS so that if/when the browser anon client reads directly, it is
-- scoped. Phase 1 policy: authenticated users may read within any workspace
-- they belong to; writes happen server-side via service role.
--
-- A real membership table arrives with multi-tenancy; for now we enable RLS
-- and add permissive-read policies for authenticated users. Service role is
-- unaffected by these policies.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','entity_types','relationship_types','sources','ingestion_jobs',
    'source_chunks','knowledge_items','evidence','knowledge_relationships',
    'knowledge_item_revisions','audit_log','conversations','messages',
    'message_grounding','corrections','knowledge_changes'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end$$;

-- Authenticated read access (Phase 1 single team). Taxonomy tables are world-readable.
-- Idempotent: drop-then-create so the migration set can be re-run safely.
do $$
declare t text;
begin
  foreach t in array array[
    'sources','ingestion_jobs','source_chunks','knowledge_items','evidence',
    'knowledge_relationships','knowledge_item_revisions','audit_log',
    'conversations','messages','message_grounding','corrections','knowledge_changes',
    'workspaces'
  ]
  loop
    execute format('drop policy if exists %I on %I;', t || '_auth_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true);',
      t || '_auth_read', t
    );
  end loop;

  foreach t in array array['entity_types','relationship_types']
  loop
    execute format('drop policy if exists %I on %I;', t || '_public_read', t);
    execute format(
      'create policy %I on %I for select to anon, authenticated using (true);',
      t || '_public_read', t
    );
  end loop;
end$$;
