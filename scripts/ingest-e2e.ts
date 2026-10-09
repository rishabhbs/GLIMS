/**
 * End-to-end ingestion test against the LIVE database, driving the REAL worker
 * pipeline and curation code. Uses a deterministic test provider (real embeddings
 * via the mock projection + scripted knowledge extraction) so results are stable.
 *
 * Run: npx tsx scripts/ingest-e2e.ts
 */
import { Repositories } from "../src/db/repositories";
import { processJob } from "../src/brain/ingestion/worker";
import { hybridSearch } from "../src/brain/retrieval/search";
import { editItem } from "../src/brain/curation/curate";
import { MockProvider } from "../src/providers/mock";
import type { ModelProvider, StructuredSchema } from "../src/providers/types";
import { getServiceClient } from "../src/db/client";
import { contentHash } from "../src/brain/hash";

const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID!;
const EMB_MODEL = process.env.BRAIN_EMBEDDING_MODEL ?? "text-embedding-3-small";

const results: Array<{ name: string; pass: boolean }> = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/** Deterministic provider: real (mock) embeddings + scripted extraction keyed by text. */
class TestProvider extends MockProvider implements ModelProvider {
  constructor(private readonly script: Record<string, unknown[]>) {
    super(1536);
  }
  async structuredExtract<T>(input: string, schema: StructuredSchema<T>): Promise<T> {
    for (const [key, items] of Object.entries(this.script)) {
      if (input.includes(key)) return schema.parse({ items });
    }
    return schema.parse({ items: [] });
  }
}

const repos = new Repositories();
const db = getServiceClient();
const createdSources: string[] = [];
const createdItems: string[] = [];

async function ingest(provider: ModelProvider, title: string, text: string) {
  const hash = contentHash(["text", title, text, String(Math.random())]);
  const src = await repos.insertSource({
    workspace_id: WS, type: "text", title, raw_text: text, content_hash: hash,
  });
  createdSources.push(src.id);
  const job = await repos.insertIngestionJob({ workspace_id: WS, source_id: src.id, status: "queued" });
  const res = await processJob(job.id, { repos, provider, embeddingModel: EMB_MODEL });
  return { sourceId: src.id, res };
}

async function run() {
  const docA = "Sampleify supports barcode-based sample receiving. Sample allocation takes place after approval.";
  const docB = "Sample allocation does not take place after approval; it happens immediately after receiving.";

  const provider = new TestProvider({
    [docA]: [
      { entity_type: "feature", title: "Barcode sample receiving", claim: "Sampleify supports barcode-based sample receiving.", source_classification: "extracted", confidence: 0.8, evidence_snippet: "Sampleify supports barcode-based sample receiving.", attributes: {} },
      { entity_type: "workflow_step", title: "Sample allocation timing", claim: "Sample allocation takes place after approval.", source_classification: "extracted", confidence: 0.7, evidence_snippet: "Sample allocation takes place after approval.", attributes: {} },
    ],
    [docB]: [
      { entity_type: "workflow_step", title: "Sample allocation timing", claim: "Sample allocation does not take place after approval; it happens immediately after receiving.", source_classification: "extracted", confidence: 0.8, evidence_snippet: "Sample allocation does not take place after approval; it happens immediately after receiving.", attributes: {} },
    ],
  });

  // 1. Ingest DOC A
  const a = await ingest(provider, "E2E DOC A", docA);
  const { data: itemsA } = await db.from("knowledge_items").select("id,claim").in("id",
    (await db.from("evidence").select("item_id").eq("source_id", a.sourceId)).data!.map((e) => e.item_id));
  itemsA?.forEach((i) => createdItems.push(i.id));
  check("DOC A: produced >=2 items", (itemsA?.length ?? 0) >= 2, `${itemsA?.length} items`);
  check("DOC A: chunks + evidence created", a.res.chunks >= 1 && a.res.itemsCreated >= 2, `chunks=${a.res.chunks}, items=${a.res.itemsCreated}`);

  const { data: evA } = await db.from("evidence").select("snippet,locator").eq("source_id", a.sourceId);
  const hasLocator = (evA ?? []).some((e) => e.locator && typeof e.locator === "object");
  check("DOC A: evidence has verbatim snippet + locator (provenance)", (evA?.length ?? 0) >= 2 && hasLocator, `${evA?.length} evidence rows`);

  // 2. Ingest DOC B -> conflict
  const b = await ingest(provider, "E2E DOC B", docB);
  const { data: evB } = await db.from("evidence").select("item_id").eq("source_id", b.sourceId);
  evB?.forEach((e) => createdItems.push(e.item_id));
  const { data: conflictEdges } = await db
    .from("knowledge_relationships").select("*").eq("relationship_type", "contradicts")
    .in("from_item_id", (evB ?? []).map((e) => e.item_id));
  check("conflict: contradicts edge created on DOC B item", (conflictEdges?.length ?? 0) >= 1, `${conflictEdges?.length ?? 0} edge(s)`);
  const { data: conflictedItems } = await db.from("knowledge_items").select("id,status")
    .in("id", [...(conflictEdges ?? []).map((c) => c.from_item_id), ...(conflictEdges ?? []).map((c) => c.to_item_id)]);
  check("conflict: both items flagged 'conflicted'", (conflictedItems ?? []).every((i) => i.status === "conflicted"), (conflictedItems ?? []).map((i) => i.status).join(","));

  // 3. Dedupe: re-ingest DOC A -> allocation claim duplicates, barcode duplicates => 0 or fewer new
  const a2 = await ingest(provider, "E2E DOC A copy", docA);
  const { data: evA2 } = await db.from("evidence").select("item_id").eq("source_id", a2.sourceId);
  evA2?.forEach((e) => createdItems.push(e.item_id));
  check("dedupe: re-ingest creates no new items (attaches evidence)", a2.res.itemsCreated === 0, `new items=${a2.res.itemsCreated}, duplicates=${a2.res.duplicates}`);

  // 4. Hybrid search finds the barcode feature
  const hits = await hybridSearch({ text: "barcode sample receiving" }, { repos, provider, workspaceId: WS });
  check("hybrid search: finds relevant item", hits.length >= 1 && hits.some((h) => /barcode/i.test(h.title)), `${hits.length} hits`);

  // 5. Human edit is versioned + flips classification to human
  const barcode = itemsA?.find((i) => /barcode/i.test(i.claim));
  if (barcode) {
    await editItem({ id: barcode.id, claim: "Sampleify supports barcode and QR-code sample receiving.", editedBy: null, reason: "e2e edit" }, { repos, provider, workspaceId: WS, embeddingModel: EMB_MODEL });
    const { data: edited } = await db.from("knowledge_items").select("claim,source_classification").eq("id", barcode.id).single();
    const { data: revs } = await db.from("knowledge_item_revisions").select("id").eq("item_id", barcode.id);
    check("edit: claim updated + classification=human", edited?.source_classification === "human" && /QR-code/.test(edited!.claim), edited?.source_classification);
    check("edit: prior value snapshotted in revisions", (revs?.length ?? 0) >= 1, `${revs?.length} revision(s)`);
  }
}

run()
  .catch((e) => { check("e2e completed without throw", false); console.error(e); })
  .finally(async () => {
    const uniq = [...new Set(createdItems)];
    for (const id of uniq) await db.from("knowledge_items").delete().eq("id", id);
    for (const id of createdSources) await db.from("sources").delete().eq("id", id);
    console.log("\ncleanup: removed e2e rows");
    const failures = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failures.length}/${results.length} e2e checks passed.`);
    process.exit(failures.length ? 1 : 0);
  });
