import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID;
const REGION = process.env.AWS_REGION, KEY = process.env.AWS_BEARER_TOKEN_BEDROCK;
const MODEL = process.env.BRAIN_EMBEDDING_MODEL, DIMS = Number(process.env.BRAIN_EMBEDDING_DIMENSIONS) || 1024;
const RT = `https://bedrock-runtime.${REGION}.amazonaws.com`;

async function embed(text) {
  const res = await fetch(`${RT}/model/${encodeURIComponent(MODEL)}/invoke`, {
    method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ inputText: text, dimensions: DIMS, normalize: true }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0,120)}`);
  return (await res.json()).embedding;
}
const vec = (v) => "[" + v.join(",") + "]";

async function run(table, textOf) {
  const { data } = await db.from(table).select("*").eq("workspace_id", WS).is("embedding", null);
  console.log(`${table}: ${data.length} to embed`);
  let n = 0;
  for (const row of data) {
    const v = await embed(textOf(row));
    await db.from(table).update({ embedding: vec(v), embedding_model: MODEL }).eq("id", row.id);
    if (++n % 20 === 0 || n === data.length) console.log(`  ${n}/${data.length}`);
  }
}
console.log(`Re-embedding @ ${DIMS}d (${MODEL})`);
await run("knowledge_items", (r) => `${r.title}\n${r.claim}`);
await run("source_chunks", (r) => (r.content || "").slice(0, 6000));
console.log("DONE");
process.exit(0);
