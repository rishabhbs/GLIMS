// Live verification of the applied schema: tables, extensions, indexes, RLS,
// seed data, and search RPCs. Read-only (plus RPC calls). Reports pass/fail.
import pg from "pg";

const url = process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// 1. Tables
const expectedTables = [
  "workspaces", "entity_types", "relationship_types", "sources", "ingestion_jobs",
  "source_chunks", "knowledge_items", "evidence", "knowledge_relationships",
  "knowledge_item_revisions", "audit_log", "conversations", "messages",
  "message_grounding", "corrections", "knowledge_changes",
];
const { rows: tbl } = await client.query(
  `select table_name from information_schema.tables where table_schema='public'`,
);
const tableSet = new Set(tbl.map((r) => r.table_name));
const missing = expectedTables.filter((t) => !tableSet.has(t));
check("schema: all 16 tables present", missing.length === 0, missing.length ? `missing: ${missing}` : `${expectedTables.length} tables`);

// 2. Extensions
const { rows: ext } = await client.query(`select extname from pg_extension`);
const extSet = new Set(ext.map((r) => r.extname));
check("extension: vector (pgvector)", extSet.has("vector"));
check("extension: pg_trgm", extSet.has("pg_trgm"));

// 3. Embedding column dimension = 1536
const { rows: dim } = await client.query(`
  select a.atttypmod as mod
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  where c.relname='knowledge_items' and a.attname='embedding'`);
check("schema: knowledge_items.embedding is vector(1536)", dim[0]?.mod === 1536, `atttypmod=${dim[0]?.mod}`);

// 4. Indexes (spot-check the important ones)
const { rows: idx } = await client.query(
  `select indexname from pg_indexes where schemaname='public'`,
);
const idxSet = new Set(idx.map((r) => r.indexname));
for (const want of [
  "idx_knowledge_items_embedding", "idx_source_chunks_embedding",
  "idx_knowledge_items_claim_trgm", "idx_knowledge_items_scope",
  "idx_messages_conversation", "idx_changes_item",
]) {
  check(`index: ${want}`, idxSet.has(want));
}

// 5. HNSW index method on embedding
const { rows: hnsw } = await client.query(`
  select am.amname from pg_index i
  join pg_class ic on ic.oid=i.indexrelid
  join pg_am am on am.oid=ic.relam
  where ic.relname='idx_knowledge_items_embedding'`);
check("index: knowledge_items embedding uses hnsw", hnsw[0]?.amname === "hnsw", `method=${hnsw[0]?.amname}`);

// 6. RLS enabled on all tables
const { rows: rls } = await client.query(`
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'`);
const rlsOff = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
check("RLS: enabled on all public tables", rlsOff.length === 0, rlsOff.length ? `off: ${rlsOff}` : "all enabled");

// 7. RLS policies exist
const { rows: pol } = await client.query(`select tablename, policyname from pg_policies where schemaname='public'`);
check("RLS: policies present", pol.length > 0, `${pol.length} policies`);

// 8. Seed: workspace
const { rows: ws } = await client.query(`select id, name from workspaces`);
check("seed: Sampleify workspace", ws.some((r) => r.name === "Sampleify"), `${ws.length} workspace(s)`);

// 9. Seed: taxonomy
const { rows: et } = await client.query(`select count(*)::int c from entity_types`);
const { rows: rt } = await client.query(`select count(*)::int c from relationship_types`);
check("seed: entity_types (12)", et[0].c === 12, `${et[0].c}`);
check("seed: relationship_types (10)", rt[0].c === 10, `${rt[0].c}`);

// 10. RPCs exist
const { rows: fns } = await client.query(
  `select proname from pg_proc where proname in ('match_knowledge_items','keyword_knowledge_items')`,
);
const fnSet = new Set(fns.map((r) => r.proname));
check("rpc: match_knowledge_items exists", fnSet.has("match_knowledge_items"));
check("rpc: keyword_knowledge_items exists", fnSet.has("keyword_knowledge_items"));

await client.end();

const failures = results.filter((r) => !r.pass);
console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
process.exit(failures.length ? 1 : 0);
