/**
 * Repositories — the ONLY place SQL/data access lives.
 * (See .kiro/steering/structure.md.) BrainService composes these.
 *
 * M1 provides the repositories the skeleton needs: workspace/taxonomy reads,
 * source + job creation, conversation/message writes, and knowledge-item reads.
 * Deeper write paths (chunk/embedding, extraction) land with the ingestion
 * engine in M2.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getServiceClient } from "./client";

type DB = SupabaseClient<Database>;

export class Repositories {
  constructor(private readonly db: DB = getServiceClient()) {}

  // ── Taxonomy ────────────────────────────────────────────────────────────
  async listEntityTypes() {
    const { data, error } = await this.db
      .from("entity_types")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data;
  }

  async listRelationshipTypes() {
    const { data, error } = await this.db.from("relationship_types").select("*");
    if (error) throw error;
    return data;
  }

  // ── Sources & jobs ────────────────────────────────────────────────────────
  async findSourceByHash(workspaceId: string, contentHash: string) {
    const { data, error } = await this.db
      .from("sources")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("content_hash", contentHash)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async insertSource(row: Database["public"]["Tables"]["sources"]["Insert"]) {
    const { data, error } = await this.db.from("sources").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertIngestionJob(row: Database["public"]["Tables"]["ingestion_jobs"]["Insert"]) {
    const { data, error } = await this.db.from("ingestion_jobs").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async listIngestionJobs(workspaceId: string, limit = 50) {
    const { data, error } = await this.db
      .from("ingestion_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  // ── Knowledge items ───────────────────────────────────────────────────────
  async getItem(id: string) {
    const { data, error } = await this.db.from("knowledge_items").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getEvidenceForItem(itemId: string) {
    const { data, error } = await this.db
      .from("evidence")
      .select("*, sources(id,title,type)")
      .eq("item_id", itemId);
    if (error) throw error;
    return data;
  }

  async getRelationshipsForItem(itemId: string) {
    const { data, error } = await this.db
      .from("knowledge_relationships")
      .select("*")
      .or(`from_item_id.eq.${itemId},to_item_id.eq.${itemId}`);
    if (error) throw error;
    return data;
  }

  async countItemsByType(workspaceId: string) {
    const { data, error } = await this.db
      .from("knowledge_items")
      .select("entity_type")
      .eq("workspace_id", workspaceId);
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const row of data ?? []) counts.set(row.entity_type, (counts.get(row.entity_type) ?? 0) + 1);
    return counts;
  }

  // ── Conversations & messages ────────────────────────────────────────────
  async createConversation(workspaceId: string, title: string | null, createdBy: string | null) {
    const { data, error } = await this.db
      .from("conversations")
      .insert({ workspace_id: workspaceId, title, created_by: createdBy })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async listConversations(workspaceId: string, limit = 50) {
    const { data, error } = await this.db
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async getConversation(id: string) {
    const { data, error } = await this.db.from("conversations").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getMessages(conversationId: string) {
    const { data, error } = await this.db
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("ordinal", { ascending: true });
    if (error) throw error;
    return data;
  }

  async nextMessageOrdinal(conversationId: string) {
    const { data, error } = await this.db
      .from("messages")
      .select("ordinal")
      .eq("conversation_id", conversationId)
      .order("ordinal", { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data?.[0]?.ordinal ?? -1) + 1;
  }

  async insertMessage(row: Database["public"]["Tables"]["messages"]["Insert"]) {
    const { data, error } = await this.db.from("messages").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertGrounding(rows: Database["public"]["Tables"]["message_grounding"]["Insert"][]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("message_grounding").insert(rows);
    if (error) throw error;
  }

  async touchConversation(id: string) {
    const { error } = await this.db
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  async writeAudit(row: Database["public"]["Tables"]["audit_log"]["Insert"]) {
    const { error } = await this.db.from("audit_log").insert(row);
    if (error) throw error;
  }

  // ── Ingestion: jobs ─────────────────────────────────────────────────────
  async getJob(id: string) {
    const { data, error } = await this.db.from("ingestion_jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getQueuedJobs(workspaceId: string, limit = 5) {
    const { data, error } = await this.db
      .from("ingestion_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async updateJob(id: string, patch: Database["public"]["Tables"]["ingestion_jobs"]["Update"]) {
    const { error } = await this.db
      .from("ingestion_jobs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async getSource(id: string) {
    const { data, error } = await this.db.from("sources").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async updateSource(id: string, patch: Database["public"]["Tables"]["sources"]["Update"]) {
    const { error } = await this.db.from("sources").update(patch).eq("id", id);
    if (error) throw error;
  }

  // ── Ingestion: chunks ─────────────────────────────────────────────────────
  async deleteChunksForSource(sourceId: string) {
    const { error } = await this.db.from("source_chunks").delete().eq("source_id", sourceId);
    if (error) throw error;
  }

  async insertChunks(rows: Database["public"]["Tables"]["source_chunks"]["Insert"][]) {
    if (rows.length === 0) return [];
    const { data, error } = await this.db.from("source_chunks").insert(rows).select("id, ordinal");
    if (error) throw error;
    return data;
  }

  // ── Knowledge items (writes) ──────────────────────────────────────────────
  async insertKnowledgeItem(row: Database["public"]["Tables"]["knowledge_items"]["Insert"]) {
    const { data, error } = await this.db.from("knowledge_items").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async updateKnowledgeItem(id: string, patch: Database["public"]["Tables"]["knowledge_items"]["Update"]) {
    const { data, error } = await this.db
      .from("knowledge_items")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async listItems(params: {
    workspaceId: string;
    entityType?: string;
    statuses?: string[];
    limit?: number;
  }) {
    let q = this.db
      .from("knowledge_items")
      .select("id,entity_type,title,claim,status,source_classification,confidence,updated_at")
      .eq("workspace_id", params.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(params.limit ?? 100);
    if (params.entityType) q = q.eq("entity_type", params.entityType);
    if (params.statuses && params.statuses.length) q = q.in("status", params.statuses);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async insertEvidence(row: Database["public"]["Tables"]["evidence"]["Insert"]) {
    const { data, error } = await this.db.from("evidence").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertRelationship(row: Database["public"]["Tables"]["knowledge_relationships"]["Insert"]) {
    const { data, error } = await this.db
      .from("knowledge_relationships")
      .upsert(row, { onConflict: "from_item_id,to_item_id,relationship_type", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async insertRevision(row: Database["public"]["Tables"]["knowledge_item_revisions"]["Insert"]) {
    const { data, error } = await this.db.from("knowledge_item_revisions").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertKnowledgeChange(row: Database["public"]["Tables"]["knowledge_changes"]["Insert"]) {
    const { data, error } = await this.db.from("knowledge_changes").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  /**
   * Candidate items of the same entity type for dedupe/conflict comparison.
   * Scoped to a product when provided so one product's knowledge is never
   * deduped into another's (each product is its own knowledge base).
   */
  async candidateItemsByType(
    workspaceId: string,
    entityType: string,
    productId?: string | null,
    limit = 200,
  ) {
    let q = this.db
      .from("knowledge_items")
      .select("id,title,claim,status,confidence,embedding")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", entityType)
      .not("status", "in", "(archived,invalidated)");
    if (productId) q = q.eq("product_id", productId);
    const { data, error } = await q.limit(limit);
    if (error) throw error;
    return data;
  }

  async setItemStatus(id: string, status: string) {
    const { error } = await this.db
      .from("knowledge_items")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  // ── Jobs with source info (Knowledge UI status list) ──────────────────────
  async listJobsWithSources(workspaceId: string, limit = 50) {
    const { data, error } = await this.db
      .from("ingestion_jobs")
      .select("*, sources(id,title,type)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  // ── Merge: move evidence + relationships between items ────────────────────
  async reassignEvidence(fromItemId: string, toItemId: string) {
    const { error } = await this.db.from("evidence").update({ item_id: toItemId }).eq("item_id", fromItemId);
    if (error) throw error;
  }

  async reassignRelationships(fromItemId: string, toItemId: string) {
    const { error: e1 } = await this.db
      .from("knowledge_relationships")
      .update({ from_item_id: toItemId })
      .eq("from_item_id", fromItemId);
    if (e1) throw e1;
    const { error: e2 } = await this.db
      .from("knowledge_relationships")
      .update({ to_item_id: toItemId })
      .eq("to_item_id", fromItemId);
    if (e2) throw e2;
  }

  // ── Item history (revisions + changes) ────────────────────────────────────
  async getRevisions(itemId: string) {
    const { data, error } = await this.db
      .from("knowledge_item_revisions")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async getKnowledgeChanges(itemId: string) {
    const { data, error } = await this.db
      .from("knowledge_changes")
      .select("*, corrections(conversation_id)")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async getRelatedItemsDetail(ids: string[]) {
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from("knowledge_items")
      .select("id,title,entity_type,status")
      .in("id", ids);
    if (error) throw error;
    return data;
  }

  // ── Retrieval / grounding support ─────────────────────────────────────────
  async getItemsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from("knowledge_items")
      .select("id,product_id,entity_type,title,claim,body,status,source_classification,confidence")
      .in("id", ids);
    if (error) throw error;
    return data;
  }

  async getRelationshipsForItems(ids: string[]) {
    if (ids.length === 0) return [];
    const orFrom = ids.map((id) => `from_item_id.eq.${id}`).join(",");
    const orTo = ids.map((id) => `to_item_id.eq.${id}`).join(",");
    const { data, error } = await this.db
      .from("knowledge_relationships")
      .select("*")
      .or([orFrom, orTo].join(","));
    if (error) throw error;
    return data;
  }

  /** Evidence (with source info) for a set of items — for citations. */
  async getEvidenceForItems(ids: string[]) {
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from("evidence")
      .select("item_id,source_id,snippet,sources(id,title,type)")
      .in("item_id", ids);
    if (error) throw error;
    return data;
  }

  // ── Conversation message count ────────────────────────────────────────────
  async countMessages(conversationId: string) {
    const { count, error } = await this.db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (error) throw error;
    return count ?? 0;
  }

  async updateConversationTitle(id: string, title: string) {
    const { error } = await this.db.from("conversations").update({ title }).eq("id", id);
    if (error) throw error;
  }

  // ── Corrections ────────────────────────────────────────────────────────────
  async insertCorrection(row: Database["public"]["Tables"]["corrections"]["Insert"]) {
    const { data, error } = await this.db.from("corrections").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async updateCorrection(id: string, patch: Database["public"]["Tables"]["corrections"]["Update"]) {
    const { error } = await this.db.from("corrections").update(patch).eq("id", id);
    if (error) throw error;
  }

  async getMessage(id: string) {
    const { data, error } = await this.db.from("messages").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getGroundingForMessage(messageId: string) {
    const { data, error } = await this.db
      .from("message_grounding")
      .select("item_id,source_id,rank")
      .eq("message_id", messageId);
    if (error) throw error;
    return data;
  }

  // ── Web research ────────────────────────────────────────────────────────────
  async insertResearchSession(row: Database["public"]["Tables"]["research_sessions"]["Insert"]) {
    const { data, error } = await this.db.from("research_sessions").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertResearchQuery(row: Database["public"]["Tables"]["research_queries"]["Insert"]) {
    const { data, error } = await this.db.from("research_queries").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertResearchFinding(row: Database["public"]["Tables"]["research_findings"]["Insert"]) {
    const { data, error } = await this.db.from("research_findings").insert(row).select("*").single();
    if (error) throw error;
    return data;
  }

  async insertMessageResearch(rows: Database["public"]["Tables"]["message_research"]["Insert"][]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("message_research").insert(rows);
    if (error) throw error;
  }

  async getFinding(id: string) {
    const { data, error } = await this.db.from("research_findings").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async setFindingPromotedSource(findingId: string, sourceId: string) {
    const { error } = await this.db
      .from("research_findings")
      .update({ promoted_source_id: sourceId })
      .eq("id", findingId);
    if (error) throw error;
  }

  async listResearchSessions(workspaceId: string, limit = 50) {
    const { data, error } = await this.db
      .from("research_sessions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async getResearchQueries(sessionId: string) {
    const { data, error } = await this.db
      .from("research_queries")
      .select("query")
      .eq("session_id", sessionId);
    if (error) throw error;
    return data;
  }

  async getResearchFindings(sessionId: string) {
    const { data, error } = await this.db
      .from("research_findings")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  async getResearchForMessage(messageId: string) {
    const { data, error } = await this.db
      .from("message_research")
      .select("finding_id,rank,research_findings(*)")
      .eq("message_id", messageId);
    if (error) throw error;
    return data;
  }

  // ── Studio state ──────────────────────────────────────────────────────────
  async getStudioState<T>(workspaceId: string, key: string): Promise<T | null> {
    const { data, error } = await this.db
      .from("studio_state")
      .select("value")
      .eq("workspace_id", workspaceId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return (data?.value as T) ?? null;
  }

  async setStudioState(workspaceId: string, key: string, value: unknown): Promise<void> {
    const { error } = await this.db.from("studio_state").upsert(
      {
        workspace_id: workspaceId,
        key,
        value: value as Database["public"]["Tables"]["studio_state"]["Insert"]["value"],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,key" },
    );
    if (error) throw error;
  }

  async deleteStudioState(workspaceId: string, key: string): Promise<void> {
    const { error } = await this.db
      .from("studio_state")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("key", key);
    if (error) throw error;
  }

  // ── Products ────────────────────────────────────────────────────────────
  async listProducts(workspaceId: string) {
    const { data, error } = await this.db
      .from("products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async getProduct(id: string) {
    const { data, error } = await this.db.from("products").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getProductBySlug(workspaceId: string, slug: string) {
    const { data, error } = await this.db
      .from("products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
