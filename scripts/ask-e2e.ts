/**
 * End-to-end test of the M3 ask + teach loop against the LIVE database, driving
 * the real BrainService code with a deterministic provider.
 *
 * Verifies: grounded answer + citations, previewCorrection writes nothing,
 * confirmCorrection versions + records provenance, and a later answer reflects
 * the corrected knowledge. Cleans up all rows it creates.
 *
 * Run: npx tsx scripts/ask-e2e.ts
 */
import { DefaultBrainService } from "../src/brain/service";
import { Repositories } from "../src/db/repositories";
import { processJob } from "../src/brain/ingestion/worker";
import { MockProvider } from "../src/providers/mock";
import type { ModelProvider, ChatMessage, StructuredSchema } from "../src/providers/types";
import { getServiceClient } from "../src/db/client";
import { contentHash } from "../src/brain/hash";

const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID!;
const EMB = process.env.BRAIN_EMBEDDING_MODEL ?? "text-embedding-3-small";

const results: Array<{ name: string; pass: boolean }> = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/** Deterministic provider: mock embeddings + scripted extraction + grounded chat
 *  that always cites the first provided item marker. */
class TestProvider extends MockProvider implements ModelProvider {
  constructor(private readonly script: Record<string, unknown[]>) {
    super(1536);
  }
  async structuredExtract<T>(input: string, schema: StructuredSchema<T>): Promise<T> {
    for (const [k, items] of Object.entries(this.script)) if (input.includes(k)) return schema.parse({ items });
    return schema.parse({ items: [] });
  }
  async chat(messages: ChatMessage[]) {
    // Grounded answerer: echo the first knowledge claim and cite [1].
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const firstClaim = sys.split("\n").find((l) => l.startsWith("[1]")) ?? "";
    const claimText = firstClaim.replace(/^\[1\][^)]*\)\s*/, "").replace(/\s*\[sources:.*$/, "");
    return { text: claimText ? `${claimText} [1]` : "No supported knowledge.", model: "test-chat" };
  }
}

const db = getServiceClient();
const repos = new Repositories();
const createdSources: string[] = [];
const createdConversations: string[] = [];
const createdItems: string[] = [];

async function ingest(provider: ModelProvider, title: string, text: string) {
  const src = await repos.insertSource({
    workspace_id: WS, type: "text", title, raw_text: text, content_hash: contentHash([title, text, String(Math.random())]),
  });
  createdSources.push(src.id);
  const job = await repos.insertIngestionJob({ workspace_id: WS, source_id: src.id, status: "queued" });
  await processJob(job.id, { repos, provider, embeddingModel: EMB });
  return src.id;
}

async function run() {
  const doc = "ALLOCTEST Sample allocation takes place after approval.";
  const provider = new TestProvider({
    ALLOCTEST: [
      {
        entity_type: "workflow_step",
        title: "ALLOCTEST allocation timing",
        claim: "Sample allocation takes place after approval.",
        source_classification: "extracted",
        confidence: 0.8,
        evidence_snippet: "Sample allocation takes place after approval.",
        attributes: {},
      },
    ],
  });

  const srcId = await ingest(provider, "ALLOC DOC", doc);
  const { data: ev } = await db.from("evidence").select("item_id").eq("source_id", srcId);
  const itemId = ev?.[0]?.item_id as string;
  createdItems.push(itemId);
  check("setup: item created from ingestion", !!itemId);

  const brain = new DefaultBrainService(repos, provider, WS);

  // 1. Ask
  const { conversationId } = await brain.createConversation("ALLOCTEST conv");
  createdConversations.push(conversationId);
  const ans1 = await brain.answerQuestion({ conversationId, question: "ALLOCTEST when does sample allocation happen?", researchMode: "never" });
  check("ask: grounded answer returned", ans1.groundingStatus === "grounded", ans1.groundingStatus);
  check("ask: answer cites a knowledge item", ans1.citations.length >= 1 && ans1.citations[0].itemIds.includes(itemId));
  check("ask: references 'after approval'", /after approval/i.test(ans1.answer), ans1.answer);

  // grounding persisted
  const { data: grounding } = await db.from("message_grounding").select("item_id").eq("message_id", ans1.messageId);
  check("ask: grounding set persisted", (grounding ?? []).some((g) => g.item_id === itemId));

  // 2. Preview correction — must change NOTHING
  const beforeClaim = (await db.from("knowledge_items").select("claim").eq("id", itemId).single()).data?.claim;
  const { data: revBefore } = await db.from("knowledge_item_revisions").select("id").eq("item_id", itemId);
  const preview = await brain.previewCorrection({
    conversationId,
    messageId: ans1.messageId,
    correctionText: "Sample allocation happens immediately after receiving; approval occurs later.",
  });
  check("preview: identifies affected item", preview.affectedItemIds.includes(itemId), preview.affectedItemIds.join(","));
  check("preview: proposes an edit with before/after", preview.proposedChanges.some((c) => c.kind === "edit" && c.currentUnderstanding && c.proposedUnderstanding));
  const afterPreviewClaim = (await db.from("knowledge_items").select("claim").eq("id", itemId).single()).data?.claim;
  const { data: revAfterPreview } = await db.from("knowledge_item_revisions").select("id").eq("item_id", itemId);
  check("preview: wrote NOTHING (claim unchanged)", afterPreviewClaim === beforeClaim);
  check("preview: wrote NOTHING (no new revision)", (revAfterPreview?.length ?? 0) === (revBefore?.length ?? 0));

  // 3. Confirm correction — explicit apply
  const confirm = await brain.confirmCorrection({
    conversationId,
    messageId: ans1.messageId,
    correctionText: preview.correctionText,
    proposedChanges: preview.proposedChanges,
  });
  check("confirm: reports changed item", confirm.changedItemIds.includes(itemId));

  const after = (await db.from("knowledge_items").select("claim,source_classification,status").eq("id", itemId).single()).data;
  check("confirm: claim updated to correction", /immediately after receiving/i.test(after!.claim), after?.claim);
  check("confirm: classification flipped to human", after?.source_classification === "human");
  const { data: revAfter } = await db.from("knowledge_item_revisions").select("id,snapshot").eq("item_id", itemId);
  check("confirm: prior value snapshotted (revision added)", (revAfter?.length ?? 0) > (revBefore?.length ?? 0));
  const { data: kchanges } = await db.from("knowledge_changes").select("*").eq("item_id", itemId);
  check("confirm: knowledge_change linked to correction", (kchanges ?? []).some((k) => k.correction_id === confirm.correctionId));
  const { data: corrSource } = await db.from("sources").select("id,extraction_method").eq("extraction_method", "chat_correction");
  corrSource?.forEach((s) => createdSources.push(s.id));
  check("confirm: chat_correction note source created (provenance)", (corrSource?.length ?? 0) >= 1);

  // 4. Future answer reflects the correction
  const ans2 = await brain.answerQuestion({ conversationId, question: "ALLOCTEST when does sample allocation happen now?", researchMode: "never" });
  check("future answer uses corrected knowledge", /immediately after receiving/i.test(ans2.answer) && !/takes place after approval/i.test(ans2.answer), ans2.answer);
}

run()
  .catch((e) => { check("e2e completed without throw", false); console.error(e); })
  .finally(async () => {
    // FK-safe cleanup: children before parents.
    for (const id of [...new Set(createdItems)]) {
      await db.from("knowledge_changes").delete().eq("item_id", id);
      await db.from("message_grounding").delete().eq("item_id", id);
      await db.from("evidence").delete().eq("item_id", id);
      await db.from("knowledge_item_revisions").delete().eq("item_id", id);
      await db.from("knowledge_relationships").delete().or(`from_item_id.eq.${id},to_item_id.eq.${id}`);
      await db.from("knowledge_items").delete().eq("id", id);
    }
    for (const id of createdConversations) {
      await db.from("corrections").delete().eq("conversation_id", id);
      await db.from("conversations").delete().eq("id", id);
    }
    for (const id of [...new Set(createdSources)]) {
      await db.from("evidence").delete().eq("source_id", id);
      await db.from("sources").delete().eq("id", id);
    }
    console.log("\ncleanup: removed ask-e2e rows");
    const failures = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failures.length}/${results.length} ask-e2e checks passed.`);
    process.exit(failures.length ? 1 : 0);
  });
