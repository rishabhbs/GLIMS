-- ============================================================================
-- Products — multi-product dimension within one workspace.
--
-- GLIMS is a social-media intern for Deepak Cybit (the company), writing for
-- ANY of its products. Knowledge, positioning, audience and voice are scoped
-- per product. The single workspace stays reserved for real multi-tenancy.
--
-- Adds a `products` table, a nullable `product_id` on `sources` and
-- `knowledge_items`, backfills existing rows to Sampleify, and seeds the three
-- current products. Safe to re-run.
-- ============================================================================

create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id),
  slug          text not null,
  name          text not null,
  -- one-line description used in prompts ("<name> is <one_liner>").
  one_liner     text not null default '',
  -- longer positioning / who-it's-for, injected as the product identity block.
  positioning   text not null default '',
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, slug)
);

alter table sources          add column if not exists product_id uuid references products(id);
alter table knowledge_items  add column if not exists product_id uuid references products(id);

create index if not exists idx_sources_product on sources (product_id);
create index if not exists idx_items_product on knowledge_items (product_id);

-- Rename the seed workspace to the company (it was "Sampleify").
update workspaces
  set name = 'Deepak Cybit'
  where id = '00000000-0000-0000-0000-000000000001' and name = 'Sampleify';

-- Seed the three products (stable ids so stores/backfill can reference them).
insert into products (id, workspace_id, slug, name, one_liner, positioning, sort_order) values
  (
    '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-000000000001',
    'sampleify',
    'Sampleify',
    'a LIMS (laboratory information management system)',
    'Sampleify is a LIMS for testing and QC labs. It runs the sample lifecycle — registration, test workflows, result entry (manual or pulled from instruments), approval, and reporting — plus the commercial side (inquiry, quotation, invoicing) and compliance (NABL, ISO/IEC 17025, ULR). Written for working lab owners and QA managers, not a marketing audience.',
    10
  ),
  (
    '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-000000000001',
    'complihub',
    'CompliHub',
    'a QHSE and compliance management platform',
    'CompliHub runs quality, environmental and occupational health & safety management systems together as one system of record with one audit trail, so evidence is a by-product of doing the work rather than a scramble before an audit. 60 licensable modules (audits & CAPA, controlled documents, permit-to-work, management of change, HAZOP, incidents, occupational health, statutory & pollution-control registers, GMP/batch records, IATF automotive core tools). Mapped clause by clause to ISO 9001/14001/45001, IATF 16949, Factories Act, 21 CFR Part 11 and more. Honest, blunt voice: it states plainly what it does NOT do (e.g. it is not a LIMS). Written for plant QHSE and compliance leaders.',
    20
  ),
  (
    '00000000-0000-0000-0000-0000000000a3',
    '00000000-0000-0000-0000-000000000001',
    'athena',
    'Athena',
    'an idea-to-plant R&D and product-development platform',
    'Athena is the only idea-to-plant platform: one connected data model spanning idea intake, lab R&D and ELN, stage-gate governance, scale-up and batch execution, tech transfer, and plant/quality handoff — where competitors stitch ELN/LIMS, NPD stage-gate, engineering PLM and process PLM together. The same record created at idea intake is the one the lab writes to, the approval engine gates, and the plant reads from. No-code configuration that mirrors your existing process. Written for R&D-to-production leaders in chemicals, petrochemicals, pharma, FMCG, textiles, construction and metals.',
    30
  )
on conflict (workspace_id, slug) do update
  set name = excluded.name,
      one_liner = excluded.one_liner,
      positioning = excluded.positioning,
      sort_order = excluded.sort_order;

-- Backfill: every pre-existing source/item was about Sampleify.
update sources
  set product_id = '00000000-0000-0000-0000-0000000000a1'
  where product_id is null;
update knowledge_items
  set product_id = '00000000-0000-0000-0000-0000000000a1'
  where product_id is null;

-- RLS for products: enable + authenticated-read (writes server-side).
do $$
begin
  execute 'alter table products enable row level security';
  execute 'drop policy if exists products_auth_read on products';
  execute 'create policy products_auth_read on products for select to authenticated using (true)';
end$$;
