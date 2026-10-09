/**
 * Conversation + teaching loop. The chat is both how a human USES the Brain
 * (answerQuestion) and how they TEACH it (previewCorrection -> confirmCorrection).
 *
 * Corrections are NEVER auto-applied. previewCorrection identifies affected
 * items and proposes a change set but writes nothing. confirmCorrection runs
 * only after the user explicitly approves, and then versions + records with
 * full provenance (see .kiro/steering/tech.md).
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import type {
  AskQuery,
  ConfirmCorrectionInput,
  CorrectionInput,
  CorrectionPreview,
  CorrectionResult,
  GroundedAnswer,
  ProposedChange,
  PromoteFindingInput,
} from "../types";
import { composeGroundedAnswer, retrieveForQuestion } from "../retrieval/ground";
import { composeDualSource } from "../research/compose";
import { runResearch, shouldAutoResearch } from "../research/research";
import { editItem } from "../curation/curate";
import { contentHash } from "../hash";
import { asJson } from "@/db/database.types";
import { toVectorLiteral } from "@/db/vector";
import type { WebResearchProvider } from "@/providers/web-research";

export interface ConverseDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
  embeddingModel: string;
  /** Optional — present enables web research. */
  web?: WebResearchProvider;
}

export async function answerQuestion(q: AskQuery, deps: ConverseDeps): Promise<GroundedAnswer> {
  const { repos, provider, workspaceId, web } = deps;
  const researchMode = q.researchMode ?? "auto";

  // Persist the user message.
  const userOrdinal = await repos.nextMessageOrdinal(q.conversationId);
  await repos.insertMessage({
    workspace_id: workspaceId,
    conversation_id: q.conversationId,
    ordinal: userOrdinal,
    role: "user",
    content: q.question,
    created_by: q.askedBy ?? null,
  });

  // 1. Internal retrieval + grounding (always runs).
  const items = await retrieveForQuestion(q.question, { repos, provider, workspaceId });
  const internalComp = await composeGroundedAnswer(q.question, items, provider);

  // 2. Decide whether to research the web.
  //    The mock provider never AUTO-triggers (it's for tests/dev); it only runs
  //    when research is explicitly forced. A real provider auto-triggers per routing.
  let doResearch = false;
  let trigger: "explicit" | "auto_insufficient" | "auto_heuristic" = "auto_heuristic";
  if (web && researchMode !== "never") {
    if (researchMode === "always") {
      doResearch = true;
      trigger = "explicit";
    } else if (web.name !== "mock" && shouldAutoResearch(q.question, internalComp.groundingStatus)) {
      doResearch = true;
      trigger = internalComp.groundingStatus !== "grounded" ? "auto_insufficient" : "auto_heuristic";
    }
  }

  // 3. Research (if triggered) + dual-source composition; else internal-only.
  let answerText = internalComp.answer;
  let groundingStatus = internalComp.groundingStatus;
  let citations = internalComp.citations;
  let usedItems = internalComp.usedItems;
  let usedSources = internalComp.usedSources;
  let conflicts = internalComp.conflicts;
  let webCitations: GroundedAnswer["webCitations"] = [];
  let researchSessionId: string | null = null;
  let researched = false;

  if (doResearch && web) {
    const research = await runResearch(
      { question: q.question, conversationId: q.conversationId, trigger },
      { repos, web, workspaceId },
    );
    researchSessionId = research.sessionId;
    researched = true;

    const dual = await composeDualSource(q.question, items, research.findings, provider);
    answerText = dual.answer;
    groundingStatus = dual.groundingStatus;
    citations = dual.citations;
    usedItems = dual.usedItems.map((i) => ({ ...i, status: i.status as (typeof usedItems)[number]["status"] }));
    usedSources = dual.usedSources.map((s) => ({ ...s, type: s.type as (typeof usedSources)[number]["type"] }));
    conflicts = dual.conflicts;
    webCitations = dual.webCitations;
  }

  // 4. Persist the assistant message.
  const asstMsg = await repos.insertMessage({
    workspace_id: workspaceId,
    conversation_id: q.conversationId,
    ordinal: userOrdinal + 1,
    role: "assistant",
    content: answerText,
    grounding_status: groundingStatus,
    citations: asJson(citations),
    sources_used: asJson({ internal: usedItems.length, external: webCitations.length, researched }),
  });

  // 5. Persist internal grounding set.
  const groundingRows: Array<{
    workspace_id: string; message_id: string; item_id: string | null; source_id: string | null; rank: number;
  }> = usedItems.map((it, i) => ({
    workspace_id: workspaceId, message_id: asstMsg.id, item_id: it.id, source_id: null, rank: i + 1,
  }));
  for (const s of usedSources) {
    groundingRows.push({ workspace_id: workspaceId, message_id: asstMsg.id, item_id: null, source_id: s.id, rank: 0 });
  }
  await repos.insertGrounding(groundingRows);

  // 6. Persist external research set.
  if (webCitations.length > 0) {
    await repos.insertMessageResearch(
      webCitations.map((w, i) => ({
        workspace_id: workspaceId,
        message_id: asstMsg.id,
        finding_id: w.findingId,
        rank: i + 1,
      })),
    );
  }

  if (userOrdinal === 0) {
    await repos.updateConversationTitle(q.conversationId, q.question.slice(0, 80));
  }
  await repos.touchConversation(q.conversationId);

  return {
    messageId: asstMsg.id,
    conversationId: q.conversationId,
    answer: answerText,
    groundingStatus,
    citations,
    usedItems,
    usedSources,
    conflicts,
    researched,
    researchSessionId,
    webCitations,
  };
}

/**
 * STAGE 1 of teaching: identify affected items and propose the change. Writes
 * NOTHING. The affected set starts from the corrected message's grounding set,
 * then adds retrieval over the correction text.
 */
export async function previewCorrection(input: CorrectionInput, deps: ConverseDeps): Promise<CorrectionPreview> {
  const { repos, provider, workspaceId } = deps;

  const candidateIds = new Set<string>();

  // From the corrected message's grounding set.
  if (input.messageId) {
    const grounding = await repos.getGroundingForMessage(input.messageId);
    for (const g of grounding ?? []) if (g.item_id) candidateIds.add(g.item_id);
  }

  // From retrieval over the correction text.
  const retrieved = await retrieveForQuestion(input.correctionText, { repos, provider, workspaceId });
  for (const r of retrieved.slice(0, 5)) candidateIds.add(r.id);

  const items = await repos.getItemsByIds([...candidateIds]);

  // Ask the model which existing item(s) this correction changes, and how.
  const proposedChanges = await proposeChanges(input.correctionText, items ?? [], provider);

  const affectedItemIds = proposedChanges
    .filter((c) => c.kind !== "create" && c.itemId)
    .map((c) => c.itemId!) as string[];

  const wouldConflictWithConfirmed = (items ?? []).some(
    (i) => affectedItemIds.includes(i.id) && i.status === "confirmed",
  );

  return {
    conversationId: input.conversationId,
    correctionText: input.correctionText,
    affectedItemIds,
    proposedChanges,
    wouldConflictWithConfirmed,
  };
}

const PROPOSE_STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "for", "and", "or", "is", "are", "be",
  "after", "before", "then", "with", "by", "it", "this", "that", "as", "not", "no", "now",
  "happens", "occurs", "takes", "place", "later", "immediately", "does",
]);

function subjectTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !PROPOSE_STOP.has(t)));
}

/** Pick the item whose claim shares the most content tokens with the correction. */
function bestMatch<T extends { claim: string }>(correctionText: string, items: T[]): { item: T; overlap: number } | null {
  const ct = subjectTokens(correctionText);
  let best: { item: T; overlap: number } | null = null;
  for (const it of items) {
    const shared = [...subjectTokens(it.claim)].filter((t) => ct.has(t)).length;
    if (!best || shared > best.overlap) best = { item: it, overlap: shared };
  }
  return best;
}

async function proposeChanges(
  correctionText: string,
  items: Array<{ id: string; title: string; claim: string; entity_type: string }>,
  _provider: ModelProvider,
): Promise<ProposedChange[]> {
  const match = bestMatch(correctionText, items);

  // No existing item shares meaningful subject tokens — propose creating new knowledge.
  if (!match || match.overlap === 0) {
    return [
      {
        kind: "create",
        proposedUnderstanding: correctionText,
        rationale: "No existing knowledge item clearly matched this correction; it would be added as new knowledge.",
      },
    ];
  }

  // Deterministic, transparent proposal: the best-matching item gets edited to
  // the corrected understanding, versioned. The human reviews before applying.
  return [
    {
      kind: "edit",
      itemId: match.item.id,
      currentUnderstanding: match.item.claim,
      proposedUnderstanding: correctionText,
      rationale: `This correction most closely matches "${match.item.title}" (shared subject terms). Its claim will be updated and versioned; the prior value is preserved.`,
    },
  ];
}

/**
 * STAGE 2 of teaching: APPLY the approved changes. Runs only after the user
 * explicitly confirmed. Creates a chat_correction note source, versions the
 * affected item(s), and records corrections + knowledge_changes + audit, linking
 * message <-> correction <-> item <-> revision.
 */
export async function confirmCorrection(input: ConfirmCorrectionInput, deps: ConverseDeps): Promise<CorrectionResult> {
  const { repos, provider, workspaceId } = deps;

  // 1. Provenance: retain the correction's exact wording as a note source.
  const hash = contentHash(["note", "chat_correction", input.correctionText, String(Date.now())]);
  const correctionSource = await repos.insertSource({
    workspace_id: workspaceId,
    type: "note",
    title: "Chat correction",
    raw_text: input.correctionText,
    content_hash: hash,
    extraction_method: "chat_correction",
    added_by: input.confirmedBy ?? null,
  });

  // 2. Record the correction row.
  const correction = await repos.insertCorrection({
    workspace_id: workspaceId,
    conversation_id: input.conversationId,
    message_id: input.messageId ?? null,
    correction_text: input.correctionText,
    correction_source_id: correctionSource.id,
    status: "applied",
    created_by: input.confirmedBy ?? null,
  });

  const changedItemIds: string[] = [];
  const knowledgeChangeIds: string[] = [];

  for (const change of input.proposedChanges) {
    if (change.kind === "create") {
      const { vectors } = await provider.embed([change.proposedUnderstanding]);
      const created = await repos.insertKnowledgeItem({
        workspace_id: workspaceId,
        entity_type: change.entityType ?? "feature",
        title: change.proposedUnderstanding.slice(0, 60),
        claim: change.proposedUnderstanding,
        status: "confirmed",
        source_classification: "human",
        confidence: 0.9,
        embedding: toVectorLiteral(vectors[0]),
        embedding_model: deps.embeddingModel,
      });
      await repos.insertEvidence({
        workspace_id: workspaceId,
        item_id: created.id,
        source_id: correctionSource.id,
        snippet: input.correctionText,
      });
      const kc = await repos.insertKnowledgeChange({
        workspace_id: workspaceId,
        correction_id: correction.id,
        message_id: input.messageId ?? null,
        item_id: created.id,
        change_type: "created",
        after: asJson(created),
        created_by: input.confirmedBy ?? null,
      });
      changedItemIds.push(created.id);
      knowledgeChangeIds.push(kc.id);
      continue;
    }

    if (!change.itemId) continue;
    const before = await repos.getItem(change.itemId);
    if (!before) continue;

    // Version + edit the item (editItem snapshots prior value + flips to human).
    const updated = await editItem(
      {
        id: change.itemId,
        claim: change.proposedUnderstanding,
        editedBy: input.confirmedBy ?? null,
        reason: "chat correction",
      },
      deps,
    );
    // Confirm the corrected belief and mark it human-sourced.
    await repos.setItemStatus(change.itemId, "confirmed");

    // Attach the correction source as evidence (provenance for the human input).
    await repos.insertEvidence({
      workspace_id: workspaceId,
      item_id: change.itemId,
      source_id: correctionSource.id,
      snippet: input.correctionText,
    });

    const kc = await repos.insertKnowledgeChange({
      workspace_id: workspaceId,
      correction_id: correction.id,
      message_id: input.messageId ?? null,
      item_id: change.itemId,
      change_type: "edited",
      before: asJson(before),
      after: asJson(updated),
      created_by: input.confirmedBy ?? null,
    });
    changedItemIds.push(change.itemId);
    knowledgeChangeIds.push(kc.id);
  }

  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.confirmedBy ?? null,
    action: "chat_correction",
    target_type: "conversation",
    target_id: input.conversationId,
    detail: asJson({ correctionId: correction.id, changedItemIds }),
  });

  return { correctionId: correction.id, changedItemIds, knowledgeChangeIds };
}

/**
 * Promote a web research finding into the Brain — EXPLICIT, never automatic.
 * Creates a `url` source (extraction_method='web_research') from the finding,
 * then a `candidate` knowledge item with evidence, preserving provenance
 * (URL, excerpt, dates). Audited like any curation action.
 */
export async function promoteFinding(
  input: PromoteFindingInput,
  deps: ConverseDeps,
): Promise<{ sourceId: string; itemId: string }> {
  const { repos, provider, workspaceId } = deps;
  const finding = await repos.getFinding(input.findingId);
  if (!finding) throw new Error(`finding ${input.findingId} not found`);

  // Create a url source retaining the original provenance.
  const hash = contentHash(["url", finding.url, finding.excerpt, finding.retrieved_at]);
  let source = await repos.findSourceByHash(workspaceId, hash);
  if (!source) {
    source = await repos.insertSource({
      workspace_id: workspaceId,
      type: "url",
      title: finding.title ?? finding.url,
      uri: finding.url,
      raw_text: finding.raw_text ?? finding.excerpt ?? null,
      content_hash: hash,
      extraction_method: "web_research",
      added_by: input.promotedBy ?? null,
    });
  }

  // Create a candidate item (external findings enter as candidates for review).
  const { vectors } = await provider.embed([input.claim]);
  const item = await repos.insertKnowledgeItem({
    workspace_id: workspaceId,
    entity_type: input.entityType,
    title: input.title,
    claim: input.claim,
    status: "candidate",
    source_classification: "extracted",
    confidence: 0.6,
    embedding: toVectorLiteral(vectors[0]),
    embedding_model: deps.embeddingModel,
  });

  await repos.insertEvidence({
    workspace_id: workspaceId,
    item_id: item.id,
    source_id: source.id,
    snippet: finding.excerpt,
    locator: asJson({ url: finding.url, published_date: finding.published_date, retrieved_at: finding.retrieved_at }),
  });

  await repos.setFindingPromotedSource(input.findingId, source.id);

  await repos.insertKnowledgeChange({
    workspace_id: workspaceId,
    item_id: item.id,
    change_type: "created",
    after: asJson(item),
    created_by: input.promotedBy ?? null,
  });
  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.promotedBy ?? null,
    action: "promote_research_finding",
    target_type: "knowledge_item",
    target_id: item.id,
    detail: asJson({ findingId: input.findingId, url: finding.url }),
  });

  return { sourceId: source.id, itemId: item.id };
}
