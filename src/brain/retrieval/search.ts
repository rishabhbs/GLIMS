/**
 * Hybrid search over knowledge_items: vector similarity + trigram keyword,
 * fused with Reciprocal Rank Fusion (RRF). Searches ITEMS, not raw chunks —
 * this is a knowledge system, not doc-chat.
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import type { KnowledgeHit, SearchQuery } from "../types";
import { getServiceClient } from "@/db/client";
import { toVectorLiteral } from "@/db/vector";

const RRF_K = 60;

type RpcRow = {
  id: string;
  entity_type: string;
  title: string;
  claim: string;
  status: string;
  source_classification: string;
  confidence: number;
  similarity: number;
};

export async function hybridSearch(
  q: SearchQuery,
  deps: { repos: Repositories; provider: ModelProvider; workspaceId: string },
): Promise<KnowledgeHit[]> {
  const limit = q.limit ?? 25;
  const db = getServiceClient();
  const text = q.text.trim();

  const excludeStatuses = ["archived", "invalidated"];

  // Vector arm
  let vectorRows: RpcRow[] = [];
  if (text !== "") {
    const { vectors } = await deps.provider.embed([text]);
    const { data, error } = await db.rpc("match_knowledge_items", {
      p_workspace_id: deps.workspaceId,
      p_query_embedding: toVectorLiteral(vectors[0]),
      p_match_count: limit * 2,
      p_exclude_statuses: excludeStatuses,
    });
    if (error) throw error;
    vectorRows = (data ?? []) as RpcRow[];
  }

  // Keyword arm
  let keywordRows: RpcRow[] = [];
  if (text !== "") {
    const { data, error } = await db.rpc("keyword_knowledge_items", {
      p_workspace_id: deps.workspaceId,
      p_query: text,
      p_match_count: limit * 2,
      p_exclude_statuses: excludeStatuses,
    });
    if (error) throw error;
    keywordRows = (data ?? []) as RpcRow[];
  }

  // RRF fuse
  const scores = new Map<string, { row: RpcRow; score: number }>();
  const addArm = (rows: RpcRow[]) => {
    rows.forEach((row, rank) => {
      const prev = scores.get(row.id);
      const inc = 1 / (RRF_K + rank + 1);
      if (prev) prev.score += inc;
      else scores.set(row.id, { row, score: inc });
    });
  };
  addArm(vectorRows);
  addArm(keywordRows);

  let hits: KnowledgeHit[] = [...scores.values()]
    .map(({ row, score }) => ({
      id: row.id,
      entityType: row.entity_type,
      title: row.title,
      claim: row.claim,
      status: row.status as KnowledgeHit["status"],
      sourceClassification: row.source_classification as KnowledgeHit["sourceClassification"],
      confidence: row.confidence,
      score,
    }))
    .sort((a, b) => b.score - a.score);

  // Post-filters
  if (q.entityTypes?.length) hits = hits.filter((h) => q.entityTypes!.includes(h.entityType));
  if (q.statuses?.length) hits = hits.filter((h) => q.statuses!.includes(h.status));

  return hits.slice(0, limit);
}
