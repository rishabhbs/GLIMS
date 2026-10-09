/**
 * Re-embed all knowledge_items (and source_chunks) with the current provider
 * (Amazon Titan v2, 1024-dim) after the 1536→1024 migration.
 * Run: node --env-file=.env.local scripts/reembed.mjs
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID;
const REGION = process.env.AWS_REGION;
const KEY = process.env.AWS_BEARER_TOKEN_BEDROCK;
const MODEL = process.env.BRAIN_EMBEDDING_MODEL;
const DIMS = Number(process.env.BRAIN_EMBEDDING_DIMENSIONS) || 1024;

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const RT = `https://bedrock-runtime.${REGION}.amazonaws.com`;

async function embed(text) {
  const res = await fetch(`${RT}/model/${encodeURIComponent(MODEL)}/invoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ inputText: text, dimensions: DIMS, normalize: true }),
  });
  if (!res.ok) throw new Error(`embed failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.embedding;
}

function toVectorLiteral(v) {
  return "[" + v.join(",") + "]";
}

async function reembedItems() {
  const { data: items, error } = await db
    .from("knowledge_items")
    .select("id,title,claim")
    .eq("workspace_id", WS);
  if (error) throw error;
  console.log(`knowledge_items to embed: ${items.length}`);
  let done = 0;
  for (const it of items) {
    const text = `${it.title}\n${it.claim}`.trim();
    const vec = await embed(text);
    const { error: upErr } = await db
      .from("knowledge_items")
      .update({ embedding: toVectorLiteral(vec), embedding_model: MODEL })
      .eq("id", it.id);
    if (upErr) throw upErr;
    done++;
    if (done % 10 === 0 || done === items.length) console.log(`  items ${done}/${items.length}`);
  }
}

async function reembedChunks() {
  const { data: chunks, error } = await db
    .from("source_chunks")
    .select("id,content")
    .eq("workspace_id", WS);
  if (error) throw error;
  console.log(`source_chunks to embed: ${chunks.length}`);
  let done = 0;
  for (const c of chunks) {
    const vec = await embed(c.content.slice(0, 6000));
    const { error: upErr } = await db
      .from("source_chunks")
      .update({ embedding: toVectorLiteral(vec), embedding_model: MODEL })
      .eq("id", c.id);
    if (upErr) throw upErr;
    done++;
    if (done % 10 === 0 || done === chunks.length) console.log(`  chunks ${done}/${chunks.length}`);
  }
}

console.log(`Re-embedding with ${MODEL} @ ${DIMS} dims (region ${REGION})`);
await reembedItems();
await reembedChunks();
console.log("DONE — all embeddings regenerated on Titan.");
process.exit(0);
