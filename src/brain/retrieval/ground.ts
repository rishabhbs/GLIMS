/**
 * Grounded answering (obligation 9: never invent).
 *
 * Pipeline: hybrid search over knowledge_items -> graph expansion via
 * relationships -> drop archived/invalidated, flag conflicted -> build a strict
 * grounding context -> provider.chat with grounding rules -> code-side citation
 * verification -> GroundedAnswer with groundingStatus + citations.
 *
 * Answers are composed ONLY from retrieved items. If the supported set is empty,
 * we refuse honestly instead of calling the model.
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import type { Citation, GroundingStatus, KnowledgeStatus, SourceType } from "../types";
import { hybridSearch } from "./search";

export interface GroundingItem {
  id: string;
  entityType: string;
  title: string;
  claim: string;
  status: string;
  sourceClassification: string;
  confidence: number;
  sources: Array<{ id: string; title: string | null; type: string; snippet: string | null }>;
  marker: number; // 1-based citation marker shown to the model
}

export interface GroundedComposition {
  answer: string;
  groundingStatus: GroundingStatus;
  citations: Citation[];
  usedItems: Array<{ id: string; title: string; entityType: string; status: KnowledgeStatus }>;
  usedSources: Array<{ id: string; title: string | null; type: SourceType }>;
  conflicts: Array<{ itemIds: string[]; note: string }>;
  groundingItems: GroundingItem[];
}

const EXCLUDED = new Set(["archived", "invalidated"]);

export async function retrieveForQuestion(
  question: string,
  deps: { repos: Repositories; provider: ModelProvider; workspaceId: string },
): Promise<GroundingItem[]> {
  // 1. Hybrid search
  const hits = await hybridSearch({ text: question, limit: 12 }, deps);
  const seedIds = hits.map((h) => h.id);

  // 2. Graph expansion — pull directly-related items
  const rels = await deps.repos.getRelationshipsForItems(seedIds);
  const expandedIds = new Set(seedIds);
  for (const r of rels ?? []) {
    expandedIds.add(r.from_item_id);
    expandedIds.add(r.to_item_id);
  }

  // 3. Hydrate full items; drop excluded statuses
  const items = await deps.repos.getItemsByIds([...expandedIds]);
  const kept = (items ?? []).filter((i) => !EXCLUDED.has(i.status));
  if (kept.length === 0) return [];

  // 4. Attach evidence/sources for citations
  const evidence = await deps.repos.getEvidenceForItems(kept.map((i) => i.id));
  const byItem = new Map<string, GroundingItem["sources"]>();
  for (const e of evidence ?? []) {
    const src = (e as unknown as { sources: { id: string; title: string | null; type: string } | null }).sources;
    const arr = byItem.get(e.item_id) ?? [];
    arr.push({ id: e.source_id, title: src?.title ?? null, type: src?.type ?? "other", snippet: e.snippet });
    byItem.set(e.item_id, arr);
  }

  // Order: seeds first (by hit rank), then expanded.
  const rank = new Map(seedIds.map((id, i) => [id, i]));
  const ordered = kept.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));

  return ordered.map((i, idx) => ({
    id: i.id,
    entityType: i.entity_type,
    title: i.title,
    claim: i.claim,
    status: i.status,
    sourceClassification: i.source_classification,
    confidence: i.confidence,
    sources: byItem.get(i.id) ?? [],
    marker: idx + 1,
  }));
}

function buildContext(items: GroundingItem[]): string {
  return items
    .map((it) => {
      const src = it.sources.length
        ? ` [sources: ${it.sources.map((s) => s.title ?? s.type).join("; ")}]`
        : " [no source — treat as unsupported]";
      const flag = it.status === "conflicted" ? " (CONFLICTED)" : it.status === "candidate" ? " (unreviewed)" : "";
      return `[${it.marker}] (${it.entityType}${flag}) ${it.claim}${src}`;
    })
    .join("\n");
}

/** Extract [n] markers the model actually cited. */
function parseMarkers(text: string): number[] {
  const found = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(Number.parseInt(m[1], 10));
  return [...found];
}

export async function composeGroundedAnswer(
  question: string,
  items: GroundingItem[],
  provider: ModelProvider,
): Promise<GroundedComposition> {
  // Items that can actually support a factual claim.
  const supported = items.filter(
    (i) => i.sources.length > 0 && !["interpretation"].includes(i.status),
  );

  const conflicts = findConflicts(items);

  if (supported.length === 0) {
    return {
      answer:
        "The Brain doesn't have supported knowledge to answer that yet. Try ingesting relevant material under Knowledge, or add the fact directly.",
      groundingStatus: "insufficient",
      citations: [],
      usedItems: [],
      usedSources: [],
      conflicts,
      groundingItems: items,
    };
  }

  const context = buildContext(items);
  const system =
    "You are LIMS Brain, answering questions about the product 'Sampleify' using ONLY the knowledge items provided.\n" +
    "Rules:\n" +
    "- Use ONLY the numbered knowledge items below. Do NOT add facts from outside this list.\n" +
    "- Cite the item number(s) in square brackets, e.g. [1], after each factual statement.\n" +
    "- Never invent capabilities, metrics, customer results, or numbers.\n" +
    "- If the items do not cover the question, say so plainly.\n" +
    "- If items are marked CONFLICTED, surface the disagreement rather than picking a side.\n" +
    "- Be concise and direct.\n\n" +
    "Knowledge items:\n" +
    context;

  const result = await provider.chat(
    [
      { role: "system", content: system },
      { role: "user", content: question },
    ],
    { temperature: 0.1 },
  );

  const citedMarkers = parseMarkers(result.text);
  const markerToItem = new Map(items.map((i) => [i.marker, i]));
  const citedItems = citedMarkers.map((m) => markerToItem.get(m)).filter(Boolean) as GroundingItem[];

  // Code-side verification: if the model asserted content but cited nothing
  // supportable, downgrade grounding status.
  const supportedCited = citedItems.filter((i) => i.sources.length > 0);
  let groundingStatus: GroundingStatus;
  if (supportedCited.length > 0 && supportedCited.length === citedItems.length) groundingStatus = "grounded";
  else if (supportedCited.length > 0) groundingStatus = "partial";
  else groundingStatus = "insufficient";

  const citations: Citation[] = supportedCited.map((i) => ({
    claim: i.claim,
    itemIds: [i.id],
    sourceIds: i.sources.map((s) => s.id),
  }));

  const usedItems = citedItems.map((i) => ({
    id: i.id,
    title: i.title,
    entityType: i.entityType,
    status: i.status as KnowledgeStatus,
  }));
  const usedSources = dedupeSources(citedItems.flatMap((i) => i.sources));

  return {
    answer: result.text,
    groundingStatus,
    citations,
    usedItems,
    usedSources,
    conflicts,
    groundingItems: items,
  };
}

function findConflicts(items: GroundingItem[]): Array<{ itemIds: string[]; note: string }> {
  const conflicted = items.filter((i) => i.status === "conflicted");
  if (conflicted.length === 0) return [];
  return [
    {
      itemIds: conflicted.map((i) => i.id),
      note: "The Brain holds conflicting knowledge on this topic; resolve it in Admin.",
    },
  ];
}

function dedupeSources(sources: GroundingItem["sources"]) {
  const map = new Map<string, { id: string; title: string | null; type: SourceType }>();
  for (const s of sources) map.set(s.id, { id: s.id, title: s.title, type: s.type as SourceType });
  return [...map.values()];
}
