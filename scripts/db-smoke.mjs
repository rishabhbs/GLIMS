// Functional smoke tests through the Supabase JS client (service role) — the
// same path the app uses (PostgREST + RPCs). Creates test rows, exercises
// reads/writes/RPCs/provenance joins, then cleans up everything it created.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID;
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const created = { sources: [], items: [], conversations: [], messages: [] };
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
function vec(fill) {
  return "[" + Array.from({ length: 1536 }, (_, i) => (i === 0 ? fill : 0)).join(",") + "]";
}

try {
  // 1. Workspace read
  const { data: ws, error: wsErr } = await db.from("workspaces").select("*").eq("id", WS).single();
  check("workspace: read seeded Sampleify", !wsErr && ws?.name === "Sampleify", wsErr?.message);

  // 2. Taxonomy read
  const { data: ets, error: etErr } = await db.from("entity_types").select("*").order("sort_order");
  check("taxonomy: entity_types query returns 12 ordered", !etErr && ets?.length === 12, etErr?.message);

  // 3. Source create + read
  const { data: src, error: srcErr } = await db
    .from("sources")
    .insert({ workspace_id: WS, type: "note", title: "SMOKE source", content_hash: "smoke-" + Date.now(), raw_text: "Sample allocation happens after sample receiving." })
    .select("*").single();
  if (src) created.sources.push(src.id);
  check("source: create + read", !srcErr && !!src?.id, srcErr?.message);

  // 4. Knowledge item create (with embedding) + provenance read
  const { data: item, error: itErr } = await db
    .from("knowledge_items")
    .insert({ workspace_id: WS, entity_type: "workflow_step", title: "Sample allocation", claim: "Sample allocation happens after sample receiving.", status: "confirmed", source_classification: "extracted", confidence: 0.9, embedding: vec(1), embedding_model: "smoke" })
    .select("*").single();
  if (item) created.items.push(item.id);
  check("knowledge_item: create with vector(1536)", !itErr && !!item?.id, itErr?.message);

  // evidence linking item -> source (provenance backbone)
  const { error: evErr } = await db.from("evidence").insert({ workspace_id: WS, item_id: item.id, source_id: src.id, snippet: "Sample allocation happens after sample receiving." });
  check("provenance: evidence insert (item↔source)", !evErr, evErr?.message);

  const { data: prov, error: provErr } = await db
    .from("evidence").select("*, sources(id,title,type)").eq("item_id", item.id);
  const provOk = !provErr && prov?.length === 1 && prov[0].sources?.title === "SMOKE source";
  check("provenance: evidence join returns source", provOk, provErr?.message);

  // 5. Vector search RPC
  const { data: vmatch, error: vErr } = await db.rpc("match_knowledge_items", {
    p_workspace_id: WS, p_query_embedding: vec(1), p_match_count: 5,
  });
  const vFound = !vErr && Array.isArray(vmatch) && vmatch.some((m) => m.id === item.id);
  check("vector search: match_knowledge_items finds item", vFound, vErr?.message);

  // 6. Keyword search RPC (pg_trgm)
  const { data: kmatch, error: kErr } = await db.rpc("keyword_knowledge_items", {
    p_workspace_id: WS, p_query: "sample allocation", p_match_count: 5,
  });
  const kFound = !kErr && Array.isArray(kmatch) && kmatch.some((m) => m.id === item.id);
  check("keyword search: keyword_knowledge_items finds item", kFound, kErr?.message);

  // 7. Conversation + message persistence (grounding)
  const { data: conv, error: convErr } = await db
    .from("conversations").insert({ workspace_id: WS, title: "SMOKE conversation" }).select("*").single();
  if (conv) created.conversations.push(conv.id);
  check("conversation: create", !convErr && !!conv?.id, convErr?.message);

  const { data: umsg, error: umErr } = await db
    .from("messages").insert({ workspace_id: WS, conversation_id: conv.id, ordinal: 0, role: "user", content: "When does allocation happen?" }).select("*").single();
  const { data: amsg, error: amErr } = await db
    .from("messages").insert({ workspace_id: WS, conversation_id: conv.id, ordinal: 1, role: "assistant", content: "After receiving.", grounding_status: "grounded", citations: [{ claim: "After receiving.", itemIds: [item.id], sourceIds: [src.id] }] }).select("*").single();
  check("message: user + assistant persisted", !umErr && !amErr && !!amsg?.id, umErr?.message || amErr?.message);

  const { error: gErr } = await db.from("message_grounding").insert({ workspace_id: WS, message_id: amsg.id, item_id: item.id, source_id: src.id, rank: 1 });
  check("grounding: message_grounding insert", !gErr, gErr?.message);

  const { data: msgs } = await db.from("messages").select("*").eq("conversation_id", conv.id).order("ordinal");
  check("conversation: read back ordered messages", msgs?.length === 2 && msgs[0].ordinal === 0, "");
} catch (e) {
  check("smoke run completed without throw", false, e.message);
} finally {
  // Cleanup (children first via FK cascade on conversations/messages; explicit for items/sources)
  for (const id of created.conversations) await db.from("conversations").delete().eq("id", id);
  for (const id of created.items) await db.from("knowledge_items").delete().eq("id", id);
  for (const id of created.sources) await db.from("sources").delete().eq("id", id);
  console.log("\ncleanup: removed smoke test rows");
}

const failures = results.filter((r) => !r.pass);
console.log(`\n${results.length - failures.length}/${results.length} smoke checks passed.`);
process.exit(failures.length ? 1 : 0);
