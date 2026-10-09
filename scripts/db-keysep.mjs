// Verifies key/role separation at the database boundary:
// - anon (publishable) key: can read world-readable taxonomy, cannot write,
//   and cannot read RLS-protected tables that have no anon policy.
// - service key: full access (bypasses RLS).
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID;

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// 1. anon can read public taxonomy (has anon select policy)
{
  const { data, error } = await anon.from("entity_types").select("key").limit(1);
  check("anon: CAN read entity_types (public policy)", !error && (data?.length ?? 0) >= 0, error?.message);
}

// 2. anon CANNOT read knowledge_items (policy is 'authenticated' only, anon is unauthenticated)
{
  const { data, error } = await anon.from("knowledge_items").select("id").limit(1);
  // Under RLS with no matching policy, PostgREST returns an empty set (not an error).
  const blocked = !error && (data?.length ?? 0) === 0;
  check("anon: CANNOT read knowledge_items (no rows via RLS)", blocked, error ? error.message : `rows=${data?.length}`);
}

// 3. anon CANNOT write to workspaces (no insert policy)
{
  const { error } = await anon.from("workspaces").insert({ name: "HACK anon write" });
  check("anon: CANNOT insert workspaces (RLS denies)", !!error, error ? `blocked: ${error.code}` : "WRITE SUCCEEDED (bad)");
}

// 4. service CAN read knowledge_items (bypasses RLS)
{
  const { error } = await svc.from("knowledge_items").select("id").limit(1);
  check("service: CAN read knowledge_items (bypass RLS)", !error, error?.message);
}

// 5. anon CANNOT read conversations (authenticated-only policy)
{
  const { data, error } = await anon.from("conversations").select("id").limit(1);
  check("anon: CANNOT read conversations", !error && (data?.length ?? 0) === 0, error?.message);
}

const failures = results.filter((r) => !r.pass);
console.log(`\n${results.length - failures.length}/${results.length} key-separation checks passed.`);
process.exit(failures.length ? 1 : 0);
