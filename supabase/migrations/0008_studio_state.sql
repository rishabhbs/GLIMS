-- ============================================================================
-- Studio state. Per-workspace key/value JSON for the social Studio
-- (style guide, calendar, training). Replaces local .studio/*.json files,
-- which fail on read-only serverless filesystems. One row per (workspace, key).
-- ============================================================================
create table if not exists studio_state (
  workspace_id uuid not null references workspaces(id),
  key          text not null,
  value        jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, key)
);

-- RLS: enable + authenticated-read (writes are server-side via service role).
do $$
declare t text;
begin
  foreach t in array array['studio_state']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_auth_read', t);
    execute format('create policy %I on %I for select to authenticated using (true);', t || '_auth_read', t);
  end loop;
end$$;
