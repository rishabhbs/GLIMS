/**
 * End-to-end web research test against the LIVE DB, driving the real
 * BrainService with a deterministic model provider + the MOCK web research
 * provider (isMock=true, NO real web access). Verifies the research WORKFLOW:
 * routing triggers research, session/queries/findings persist with real
 * url+excerpt, dual-source answer with external citations, message_research
 * persists, and promotion creates a candidate item + url source with preserved
 * provenance. Cleans up.
 *
 * NOTE: This uses MOCKS — it does NOT verify real Google Search grounding.
 * Real Gemini grounding is verified separately by scripts/gemini-research-live.ts.
 *
 * Run: npx tsx scripts/research-e2e.ts
 */
import { DefaultBrainService } from "../src/brain/service";
import { Repositories } from "../src/db/repositories";
import { MockProvider } from "../src/providers/mock";
import { MockWebResearchProvider } from "../src/providers/mock-web-research";
import type { ModelProvider, ChatMessage } from "../src/providers/types";
import { getServiceClient } from "../src/db/client";
import { contentHash } from "../src/brain/hash";

const WS = process.env.BRAIN_DEFAULT_WORKSPACE_ID!;
const results: Array<{ name: string; pass: boolean }> = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/** Model provider that writes a dual-source answer citing [K1] and [W1]. */
class DualProvider extends MockProvider implements ModelProvider {
  async chat(messages: ChatMessage[]) {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const hasK = /\[K1\]/.test(sys);
    const hasW = /\[W1\]/.test(sys);
    let text = "";
    if (hasK) text += "**From Sampleify (internal):** Sampleify records sample receipt with barcodes [K1].\n";
    if (hasW) text += "**From external sources:** ISO/IEC 17025 clause 7.4 covers handling of test items [W1].\n";
    text += "**Inference:** The receiving feature supports the handling requirement; it does not by itself constitute compliance.\n";
    text += "**Unknown / unverified:** Exact edition wording beyond the excerpt is not established.";
    return { text, model: "dual-mock" };
  }
}

const db = getServiceClient();
const repos = new Repositories();
// MOCK web research (isMock=true) — deterministic, NO real web access.
const web = new MockWebResearchProvider({
  answer: "ISO/IEC 17025:2017 clause 7.4 addresses handling of test items including receipt, handling, and storage.",
  queries: ["ISO IEC 17025 clause sample receiving"],
  sources: [
    {
      url: "https://www.iso.org/standard/66912.html",
      title: "ISO/IEC 17025:2017 — General requirements",
      excerpt: "Clause 7.4 Handling of test items: procedure for transportation, receipt, handling, protection, storage of test items.",
    },
  ],
});

const createdItems: string[] = [];
const createdSources: string[] = [];
const createdConversations: string[] = [];

async function run() {
  const provider = new DualProvider(1536);

  // Seed one internal feature item (confirmed, with evidence) so [K1] exists.
  const src = await repos.insertSource({ workspace_id: WS, type: "note", title: "RSRCH seed", raw_text: "Barcode receiving.", content_hash: contentHash(["seed", String(Math.random())]) });
  createdSources.push(src.id);
  const { vectors } = await provider.embed(["Sampleify records sample receipt using barcodes."]);
  const item = await repos.insertKnowledgeItem({
    workspace_id: WS, entity_type: "feature", title: "RSRCH Barcode receiving",
    claim: "Sampleify records sample receipt using barcodes.", status: "confirmed",
    source_classification: "extracted", confidence: 0.9,
    embedding: "[" + vectors[0].join(",") + "]", embedding_model: "seed",
  });
  createdItems.push(item.id);
  await repos.insertEvidence({ workspace_id: WS, item_id: item.id, source_id: src.id, snippet: "Barcode receiving." });

  const brain = new DefaultBrainService(repos, provider, WS, web);
  const { conversationId } = await brain.createConversation("RSRCH conv");
  createdConversations.push(conversationId);

  // Force research (NABL-style question).
  const ans = await brain.answerQuestion({
    conversationId,
    question: "RSRCH which NABL / ISO IEC 17025 clause does barcode sample receiving address?",
    researchMode: "always",
  });

  check("research ran", ans.researched && !!ans.researchSessionId, String(ans.researched));
  check("answer separates internal + external", /From Sampleify/i.test(ans.answer) && /external sources/i.test(ans.answer));
  check("answer has Inference + Unknown layers", /Inference/i.test(ans.answer) && /Unknown/i.test(ans.answer));
  check("internal citation present", ans.citations.some((c) => c.itemIds.includes(item.id)));
  check("external citation present with url", ans.webCitations.some((w) => /iso\.org/.test(w.url)));
  check("primary source flagged", ans.webCitations.some((w) => w.isPrimarySource));

  // Persistence checks.
  const { data: sessions } = await db.from("research_sessions").select("*").eq("id", ans.researchSessionId!);
  check("research_session persisted (provider=mock recorded)", (sessions?.length ?? 0) === 1 && sessions![0].provider === "mock");
  const { data: findings } = await db.from("research_findings").select("*").eq("session_id", ans.researchSessionId!);
  check("research_findings persisted with real url + excerpt", (findings?.length ?? 0) >= 1 && (findings ?? []).some((f) => /iso\.org/.test(f.url) && f.excerpt));
  const { data: queries } = await db.from("research_queries").select("query").eq("session_id", ans.researchSessionId!);
  check("actual queries persisted", (queries?.length ?? 0) >= 1);
  const { data: mr } = await db.from("message_research").select("*").eq("message_id", ans.messageId);
  check("message_research persisted", (mr?.length ?? 0) >= 1);

  // Promote a finding -> candidate item + url source, provenance preserved.
  const accessibleFinding = (findings ?? []).find((f) => f.accessible)!;
  const promo = await brain.promoteFinding({
    findingId: accessibleFinding.id,
    entityType: "limitation",
    title: "ISO 17025 clause 7.4 handling",
    claim: "ISO/IEC 17025:2017 clause 7.4 covers handling of test items.",
  });
  createdItems.push(promo.itemId);
  createdSources.push(promo.sourceId);
  const { data: promoted } = await db.from("knowledge_items").select("status,source_classification").eq("id", promo.itemId).single();
  check("promoted item is candidate (not auto-confirmed)", promoted?.status === "candidate");
  const { data: promoSrc } = await db.from("sources").select("type,uri,extraction_method").eq("id", promo.sourceId).single();
  check("promotion created url source with web_research provenance", promoSrc?.type === "url" && promoSrc?.extraction_method === "web_research" && /iso\.org/.test(promoSrc?.uri ?? ""));
  const { data: refind } = await db.from("research_findings").select("promoted_source_id").eq("id", accessibleFinding.id).single();
  check("finding marked promoted", refind?.promoted_source_id === promo.sourceId);
}

run()
  .catch((e) => { check("e2e completed without throw", false); console.error(e); })
  .finally(async () => {
    // Conversations first (cascades messages + message_grounding + message_research),
    // and their research sessions (cascades queries + findings).
    for (const id of createdConversations) {
      const { data: sess } = await db.from("research_sessions").select("id").eq("conversation_id", id);
      for (const s of sess ?? []) await db.from("research_sessions").delete().eq("id", s.id);
      await db.from("conversations").delete().eq("id", id);
    }
    // Then items (grounding/research already gone) and their provenance.
    for (const id of [...new Set(createdItems)]) {
      await db.from("message_grounding").delete().eq("item_id", id);
      await db.from("knowledge_changes").delete().eq("item_id", id);
      await db.from("evidence").delete().eq("item_id", id);
      await db.from("knowledge_item_revisions").delete().eq("item_id", id);
      await db.from("knowledge_items").delete().eq("id", id);
    }
    for (const id of [...new Set(createdSources)]) await db.from("sources").delete().eq("id", id);
    console.log("\ncleanup: removed research-e2e rows");
    const failures = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failures.length}/${results.length} research-e2e checks passed.`);
    process.exit(failures.length ? 1 : 0);
  });
