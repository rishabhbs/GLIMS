-- ============================================================================
-- Seed: default workspace + taxonomy (entity_types, relationship_types).
-- Taxonomy is table-driven and editable — this is just the starting set.
-- ============================================================================

insert into workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Sampleify')
on conflict (id) do nothing;

insert into entity_types (key, label, description, sort_order, is_system) values
  ('feature',       'Product / Feature', 'A product capability of Sampleify',                 10, true),
  ('workflow',      'Workflow',          'An end-to-end process',                             20, true),
  ('workflow_step', 'Workflow Step',     'A step within a workflow',                          30, true),
  ('persona',       'Persona',           'A user or buyer type',                              40, true),
  ('problem',       'Problem',           'A customer pain the product addresses',             50, true),
  ('customer',      'Customer',          'A real customer or account (may be sensitive)',     60, true),
  ('metric',        'Metric / Evidence', 'A measurable value or piece of evidence',           70, true),
  ('terminology',   'Terminology',       'A domain or product term and its definition',       80, true),
  ('competitor',    'Competitor',        'A competing product',                               90, true),
  ('positioning',   'Positioning',       'A positioning or value statement',                 100, true),
  ('decision',      'Decision',          'A historical product decision and its rationale',  110, true),
  ('limitation',    'Limitation',        'A known constraint or what the product does not do',120, true)
on conflict (key) do nothing;

insert into relationship_types (key, label, description, is_directional) values
  ('part_of',      'part of',       'from is a part/sub-component of to',                 true),
  ('uses',         'uses',          'from uses/depends on to',                            true),
  ('precedes',     'precedes',      'from happens before to (sequencing)',                true),
  ('addresses',    'addresses',     'feature/workflow addresses a problem',               true),
  ('serves',       'serves',        'feature/workflow serves a persona',                  true),
  ('evidence_for', 'evidence for',  'metric/source is evidence for a claim',              true),
  ('supersedes',   'supersedes',    'from replaces an older belief (to is outdated)',     true),
  ('contradicts',  'contradicts',   'from and to make conflicting claims',                false),
  ('defines',      'defines',       'terminology defines a concept used elsewhere',       true),
  ('relates_to',   'relates to',    'generic association',                                false)
on conflict (key) do nothing;
