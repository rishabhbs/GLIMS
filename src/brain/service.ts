/**
 * BrainService — the reusable intelligence contract.
 *
 * This is THE seam that makes LIMS Brain reusable: UI and (future) consumer
 * apps depend only on this interface, in-process or over HTTP, with identical
 * semantics. (See docs/02-design.md §6.6 and .kiro/steering/*.)
 *
 * Status (M3): the full contract is implemented. Ingestion processing (M2),
 * hybrid retrieval + grounded answering (M3), the two-stage correction loop
 * (previewCorrection -> confirmCorrection, never auto-applied), conversation
 * persistence, and curation all run behind this single contract — in-process
 * and over HTTP with identical semantics.
 */
import type {
  AddManualItemInput,
  AskQuery,
  ConfirmCorrectionInput,
  ConversationSummary,
  ConversationWithMessages,
  CorrectionInput,
  CorrectionPreview,
  CorrectionResult,
  EditItemInput,
  GroundedAnswer,
  IngestInput,
  ItemListRow,
  JobRow,
  KnowledgeChangeEntry,
  KnowledgeHit,
  KnowledgeItemWithProvenance,
  ListItemsQuery,
  MergeItemsInput,
  PromoteFindingInput,
  RelateItemsInput,
  ResearchSessionSummary,
  SearchQuery,
  SetStatusInput,
  TaxonomyType,
} from "./types";
import { Repositories } from "@/db/repositories";
import { getModelProvider, getWebResearchProvider, type ModelProvider } from "@/providers";
import type { WebResearchProvider } from "@/providers/web-research";
import { getServerConfig } from "@/config/env";
import { contentHash } from "./hash";
import { processJob } from "./ingestion/worker";
import { supabaseStorageReader } from "@/db/storage";
import { hybridSearch } from "./retrieval/search";
import { addManualItem, editItem, mergeItems, relateItems, setStatus } from "./curation/curate";
import { answerQuestion, confirmCorrection, previewCorrection, promoteFinding } from "./conversation/converse";
import { studioTurn, type StudioTurnInput, type StudioTurnResult } from "./social/studio";
import {
  planCalendar,
  draftPosts,
  revisePost,
  type PlanCalendarInput,
  type PlanCalendarResult,
  type DraftPostsInput,
  type DraftPostsResult,
  type RevisePostInput,
  type RevisePostResult,
} from "./social/calendar";
import {
  loadStyleGuide,
  removeStyleRule,
  addStyleRules,
  type StyleGuide,
} from "./social/style-guide";
import {
  loadCalendar,
  saveCalendar,
  clearCalendar,
  type StoredCalendar,
} from "./social/calendar-store";
import type { CalSlot, CalCitation } from "./social/calendar";
import {
  generateTrainingPost,
  submitTrainingFeedback,
  resolveInstructionConflict,
  loadTraining,
  resetTraining,
  type GenerateTrainingInput,
  type TrainingPost,
  type SubmitFeedbackInput,
  type SubmitFeedbackResult,
  type ResolveConflictInput,
  type TrainingState,
} from "./social/training";
import { resolveCalendarConflict, type ResolveCalendarConflictInput } from "./social/calendar";
import { generateGraphic, type GenerateGraphicInput, type GraphicResult } from "./social/graphic";
import { setPendingGraphic } from "./social/training";
import {
  loadGlobalInstructions,
  addGlobalInstruction,
  updateGlobalInstruction,
  removeGlobalInstruction,
  resetGlobalInstructions,
  type GlobalInstructions,
  type GlobalInstruction,
  type InstructionCategory,
} from "./social/global-instructions";
import {
  loadSavedPosts,
  savePost,
  updateSavedPostNote,
  removeSavedPost,
  type SavedPosts,
  type SavePostInput,
} from "./social/saved-posts";
import { applyStudioCorrection, recordMediaRevision, saveCurrentPost, openSavedPost, revertToTurn, type ConfirmCorrectionRouteInput } from "./social/training";
import { loadAudienceModel, addAudienceNotes, updateAudienceNote, removeAudienceNote, type AudienceModel } from "./social/audience";
import {
  loadLabFacts,
  addLabFacts,
  updateLabFact,
  removeLabFact,
  type LabFacts,
  type LabFact,
  type AddLabFactInput,
} from "./social/lab-facts";

export interface BrainService {
  // knowledge in
  ingestSource(input: IngestInput): Promise<{ sourceId: string; jobId: string; duplicate: boolean }>;
  processJob(jobId: string): Promise<{ status: string; itemsCreated: number; conflicts: number }>;
  runPendingJobs(max?: number): Promise<Array<{ jobId: string; status: string }>>;
  listJobs(): Promise<JobRow[]>;
  // knowledge out
  searchKnowledge(q: SearchQuery): Promise<KnowledgeHit[]>;
  listItems(q: ListItemsQuery): Promise<ItemListRow[]>;
  getItem(id: string): Promise<KnowledgeItemWithProvenance | null>;
  getItemHistory(id: string): Promise<KnowledgeChangeEntry[]>;
  getTaxonomyCounts(): Promise<Array<{ key: string; label: string; count: number }>>;
  listTaxonomy(): Promise<TaxonomyType[]>;
  // curation (human editing is first-class)
  editItem(input: EditItemInput): Promise<void>;
  addManualItem(input: AddManualItemInput): Promise<{ id: string }>;
  setItemStatus(input: SetStatusInput): Promise<void>;
  relateItems(input: RelateItemsInput): Promise<void>;
  mergeItems(input: MergeItemsInput): Promise<void>;
  // conversational ask + teach
  createConversation(title?: string, createdBy?: string | null): Promise<{ conversationId: string }>;
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<ConversationWithMessages | null>;
  answerQuestion(q: AskQuery): Promise<GroundedAnswer>;
  previewCorrection(input: CorrectionInput): Promise<CorrectionPreview>;
  confirmCorrection(input: ConfirmCorrectionInput): Promise<CorrectionResult>;
  // web research
  promoteFinding(input: PromoteFindingInput): Promise<{ sourceId: string; itemId: string }>;
  listResearchSessions(): Promise<ResearchSessionSummary[]>;
  // social media studio (grounded content generation; a Brain consumer)
  studioTurn(input: StudioTurnInput): Promise<StudioTurnResult>;
  // social calendar operations (calendar-first Studio)
  planCalendar(input: PlanCalendarInput): Promise<PlanCalendarResult>;
  draftPosts(input: DraftPostsInput): Promise<DraftPostsResult>;
  revisePost(input: RevisePostInput): Promise<RevisePostResult>;
  // learned style guide (persistent writing preferences)
  getStyleGuide(): Promise<StyleGuide>;
  addStyleRule(rule: string): Promise<StyleGuide>;
  removeStyleRule(ruleId: string): Promise<StyleGuide>;
  // persisted calendar (survives reloads)
  getCalendar(): Promise<StoredCalendar>;
  saveCalendar(data: { slots: CalSlot[]; citations: CalCitation[]; brief: string }): Promise<StoredCalendar>;
  clearCalendar(): Promise<void>;
  // training loop (rate one post at a time; teaches the style memory)
  getTraining(): Promise<TrainingState>;
  generateTrainingPost(input: GenerateTrainingInput): Promise<TrainingPost>;
  submitTrainingFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult>;
  resolveInstructionConflict(input: ResolveConflictInput): Promise<{ ok: true; applied: ResolveConflictInput["resolution"] }>;
  resetTraining(): Promise<void>;
  // calendar revise-time conflict resolution
  resolveCalendarConflict(input: ResolveCalendarConflictInput): Promise<{ ok: true; applied: ResolveCalendarConflictInput["resolution"] }>;
  // editable global writing instructions (the base policy, as data)
  getGlobalInstructions(): Promise<GlobalInstructions>;
  addGlobalInstruction(input: { title: string; text: string; category?: InstructionCategory }): Promise<GlobalInstructions>;
  updateGlobalInstruction(id: string, patch: Partial<Pick<GlobalInstruction, "title" | "text" | "category" | "enabled">>): Promise<GlobalInstructions>;
  removeGlobalInstruction(id: string): Promise<GlobalInstructions>;
  resetGlobalInstructions(): Promise<GlobalInstructions>;
  // saved posts — the user's curated gold standard (verified exemplars)
  getSavedPosts(): Promise<SavedPosts>;
  savePost(input: SavePostInput): Promise<SavedPosts>;
  savePlaygroundPost(note?: string): Promise<{ ok: boolean }>;
  updateSavedPostNote(id: string, note: string): Promise<SavedPosts>;
  removeSavedPost(id: string): Promise<SavedPosts>;
  // real-world lab facts — the Studio's world model (prevents factual fabrication)
  getLabFacts(): Promise<LabFacts>;
  addLabFacts(additions: AddLabFactInput[]): Promise<LabFacts>;
  updateLabFact(id: string, patch: Partial<Pick<LabFact, "statement" | "kind">>): Promise<LabFacts>;
  removeLabFact(id: string): Promise<LabFacts>;
  // audience model — who the Studio writes for (corrects persona assumptions)
  getAudienceModel(): Promise<AudienceModel>;
  addAudienceNotes(statements: string[]): Promise<AudienceModel>;
  updateAudienceNote(id: string, statement: string): Promise<AudienceModel>;
  removeAudienceNote(id: string): Promise<AudienceModel>;
  // unified correction router: route a confirmed correction to the right memory
  confirmStudioCorrection(input: ConfirmCorrectionRouteInput): Promise<{ routedTo: string }>;
  // reopen a saved post into the Playground with its full conversation
  openSavedPost(savedId: string): Promise<TrainingState>;
  // revert the current post's body to an earlier turn's output
  revertToTurn(turnId: string): Promise<TrainingState>;
  // AI-authored post graphic (non-templated SVG)
  generateGraphic(input: GenerateGraphicInput & { postId?: string; record?: boolean }): Promise<GraphicResult>;
}

export class DefaultBrainService implements BrainService {
  private readonly workspaceId: string;

  constructor(
    private readonly repos: Repositories = new Repositories(),
    private readonly provider: ModelProvider = getModelProvider(),
    workspaceId?: string,
    private readonly web: WebResearchProvider = getWebResearchProvider(),
  ) {
    this.workspaceId = workspaceId ?? getServerConfig().defaultWorkspaceId;
  }

  // ── knowledge in ───────────────────────────────────────────────────────────
  async ingestSource(input: IngestInput): Promise<{ sourceId: string; jobId: string; duplicate: boolean }> {
    const hash = contentHash([input.type, input.title, input.text, input.uri, input.storagePath]);

    const existing = await this.repos.findSourceByHash(this.workspaceId, hash);
    if (existing) {
      return { sourceId: existing.id, jobId: "", duplicate: true };
    }

    const source = await this.repos.insertSource({
      workspace_id: this.workspaceId,
      type: input.type,
      title: input.title ?? null,
      uri: input.uri ?? null,
      storage_path: input.storagePath ?? null,
      raw_text: input.text ?? null,
      content_hash: hash,
      sensitivity: input.sensitivity ?? "normal",
      extraction_method: input.extractionMethod ?? null,
      added_by: input.addedBy ?? null,
    });

    const job = await this.repos.insertIngestionJob({
      workspace_id: this.workspaceId,
      source_id: source.id,
      status: "queued",
      idempotency_key: hash,
    });

    await this.repos.writeAudit({
      workspace_id: this.workspaceId,
      action: "source_ingested",
      target_type: "source",
      target_id: source.id,
      detail: { type: input.type, jobId: job.id },
    });

    return { sourceId: source.id, jobId: job.id, duplicate: false };
  }

  async processJob(jobId: string): Promise<{ status: string; itemsCreated: number; conflicts: number }> {
    const res = await processJob(jobId, {
      repos: this.repos,
      provider: this.provider,
      storage: supabaseStorageReader,
      embeddingModel: getServerConfig().model.embeddingModel,
    });
    return { status: res.status, itemsCreated: res.itemsCreated, conflicts: res.conflicts };
  }

  async runPendingJobs(max = 5): Promise<Array<{ jobId: string; status: string }>> {
    const jobs = await this.repos.getQueuedJobs(this.workspaceId, max);
    const out: Array<{ jobId: string; status: string }> = [];
    for (const j of jobs ?? []) {
      const res = await this.processJob(j.id);
      out.push({ jobId: j.id, status: res.status });
    }
    return out;
  }

  async listJobs(): Promise<JobRow[]> {
    const rows = await this.repos.listJobsWithSources(this.workspaceId);
    return (rows ?? []).map((r) => {
      const src = (r as unknown as { sources: { id: string; title: string | null; type: string } | null }).sources;
      return {
        id: r.id,
        sourceId: r.source_id,
        sourceTitle: src?.title ?? null,
        sourceType: src?.type ?? "other",
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  // ── knowledge out ───────────────────────────────────────────────────────────
  async searchKnowledge(q: SearchQuery): Promise<KnowledgeHit[]> {
    return hybridSearch(q, { repos: this.repos, provider: this.provider, workspaceId: this.workspaceId });
  }

  async listItems(q: ListItemsQuery): Promise<ItemListRow[]> {
    const rows = await this.repos.listItems({
      workspaceId: this.workspaceId,
      entityType: q.entityType,
      statuses: q.statuses,
      limit: q.limit,
    });
    return (rows ?? []).map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      title: r.title,
      claim: r.claim,
      status: r.status as ItemListRow["status"],
      sourceClassification: r.source_classification as ItemListRow["sourceClassification"],
      confidence: r.confidence,
      updatedAt: r.updated_at,
    }));
  }

  async listTaxonomy(): Promise<TaxonomyType[]> {
    const types = await this.repos.listEntityTypes();
    return (types ?? []).map((t) => ({ key: t.key, label: t.label, description: t.description }));
  }

  async getItem(id: string): Promise<KnowledgeItemWithProvenance | null> {
    const row = await this.repos.getItem(id);
    if (!row) return null;

    const [evidenceRows, relRows] = await Promise.all([
      this.repos.getEvidenceForItem(id),
      this.repos.getRelationshipsForItem(id),
    ]);

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      entityType: row.entity_type,
      title: row.title,
      claim: row.claim,
      body: row.body,
      status: row.status as KnowledgeItemWithProvenance["status"],
      sourceClassification: row.source_classification as KnowledgeItemWithProvenance["sourceClassification"],
      confidence: row.confidence,
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
      supersededBy: row.superseded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      evidence: (evidenceRows ?? []).map((e) => {
        const src = (e as unknown as { sources: { id: string; title: string | null; type: string } | null }).sources;
        return {
          id: e.id,
          sourceId: e.source_id,
          sourceTitle: src?.title ?? null,
          sourceType: (src?.type ?? "other") as KnowledgeItemWithProvenance["evidence"][number]["sourceType"],
          chunkId: e.chunk_id,
          snippet: e.snippet,
          locator: e.locator,
        };
      }),
      related: await this.hydrateRelated(id, relRows ?? []),
    };
  }

  private async hydrateRelated(
    id: string,
    relRows: Array<{ relationship_type: string; from_item_id: string; to_item_id: string; note: string | null }>,
  ): Promise<KnowledgeItemWithProvenance["related"]> {
    const otherIds = relRows.map((r) => (r.from_item_id === id ? r.to_item_id : r.from_item_id));
    const details = await this.repos.getRelatedItemsDetail(otherIds);
    const byId = new Map((details ?? []).map((d) => [d.id, d]));
    return relRows.map((r) => {
      const otherId = r.from_item_id === id ? r.to_item_id : r.from_item_id;
      const d = byId.get(otherId);
      return {
        relationshipType: r.relationship_type,
        direction: r.from_item_id === id ? ("outgoing" as const) : ("incoming" as const),
        item: {
          id: otherId,
          title: d?.title ?? "(unknown)",
          entityType: d?.entity_type ?? "",
          status: (d?.status ?? "candidate") as KnowledgeItemWithProvenance["status"],
        },
        note: r.note,
      };
    });
  }

  async getItemHistory(id: string): Promise<KnowledgeChangeEntry[]> {
    const changes = await this.repos.getKnowledgeChanges(id);
    return (changes ?? []).map((c) => {
      const corr = (c as unknown as { corrections: { conversation_id: string } | null }).corrections;
      const cause: KnowledgeChangeEntry["cause"] = c.correction_id
        ? "chat_correction"
        : c.created_by
          ? "manual"
          : "ingestion";
      return {
        id: c.id,
        itemId: c.item_id,
        changeType: c.change_type,
        cause,
        conversationId: corr?.conversation_id ?? null,
        before: c.before,
        after: c.after,
        createdAt: c.created_at,
      };
    });
  }

  // ── curation (human editing first-class) ────────────────────────────────────
  private curationDeps() {
    return {
      repos: this.repos,
      provider: this.provider,
      workspaceId: this.workspaceId,
      embeddingModel: getServerConfig().model.embeddingModel,
    };
  }

  async editItem(input: EditItemInput): Promise<void> {
    await editItem(input, this.curationDeps());
  }

  async addManualItem(input: AddManualItemInput): Promise<{ id: string }> {
    const item = await addManualItem(input, this.curationDeps());
    return { id: item.id };
  }

  async setItemStatus(input: SetStatusInput): Promise<void> {
    await setStatus(input, this.curationDeps());
  }

  async relateItems(input: RelateItemsInput): Promise<void> {
    await relateItems(input, this.curationDeps());
  }

  async mergeItems(input: MergeItemsInput): Promise<void> {
    await mergeItems(input, this.curationDeps());
  }

  async getTaxonomyCounts(): Promise<Array<{ key: string; label: string; count: number }>> {
    const [types, counts] = await Promise.all([
      this.repos.listEntityTypes(),
      this.repos.countItemsByType(this.workspaceId),
    ]);
    return (types ?? []).map((t) => ({ key: t.key, label: t.label, count: counts.get(t.key) ?? 0 }));
  }

  // ── conversations ───────────────────────────────────────────────────────────
  async createConversation(title?: string, createdBy?: string | null): Promise<{ conversationId: string }> {
    const conv = await this.repos.createConversation(this.workspaceId, title ?? null, createdBy ?? null);
    return { conversationId: conv.id };
  }

  async listConversations(): Promise<ConversationSummary[]> {
    const rows = await this.repos.listConversations(this.workspaceId);
    return Promise.all(
      (rows ?? []).map(async (c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        messageCount: await this.repos.countMessages(c.id),
      })),
    );
  }

  async getConversation(id: string): Promise<ConversationWithMessages | null> {
    const conv = await this.repos.getConversation(id);
    if (!conv) return null;
    const messages = await this.repos.getMessages(id);
    return {
      id: conv.id,
      title: conv.title,
      messages: (messages ?? []).map((m) => ({
        id: m.id,
        role: m.role as ConversationWithMessages["messages"][number]["role"],
        content: m.content,
        groundingStatus: (m.grounding_status ?? null) as ConversationWithMessages["messages"][number]["groundingStatus"],
        citations: (m.citations ?? null) as ConversationWithMessages["messages"][number]["citations"],
        createdAt: m.created_at,
      })),
    };
  }

  // ── ask + teach ───────────────────────────────────────────────────────────
  private converseDeps() {
    return {
      repos: this.repos,
      provider: this.provider,
      workspaceId: this.workspaceId,
      embeddingModel: getServerConfig().model.embeddingModel,
      web: this.web,
    };
  }

  async answerQuestion(q: AskQuery): Promise<GroundedAnswer> {
    return answerQuestion(q, this.converseDeps());
  }

  // ── social media studio ───────────────────────────────────────────────────
  private socialDeps() {
    return { repos: this.repos, provider: this.provider, workspaceId: this.workspaceId };
  }

  async studioTurn(input: StudioTurnInput): Promise<StudioTurnResult> {
    return studioTurn(input, this.socialDeps());
  }

  async planCalendar(input: PlanCalendarInput): Promise<PlanCalendarResult> {
    return planCalendar(input, this.socialDeps());
  }

  async draftPosts(input: DraftPostsInput): Promise<DraftPostsResult> {
    return draftPosts(input, this.socialDeps());
  }

  async revisePost(input: RevisePostInput): Promise<RevisePostResult> {
    return revisePost(input, this.socialDeps());
  }

  async resolveCalendarConflict(input: ResolveCalendarConflictInput) {
    return resolveCalendarConflict(input, this.socialDeps());
  }

  async getGlobalInstructions(): Promise<GlobalInstructions> {
    return loadGlobalInstructions(this.workspaceId);
  }

  async addGlobalInstruction(input: { title: string; text: string; category?: InstructionCategory }): Promise<GlobalInstructions> {
    return addGlobalInstruction(this.workspaceId, input);
  }

  async updateGlobalInstruction(
    id: string,
    patch: Partial<Pick<GlobalInstruction, "title" | "text" | "category" | "enabled">>,
  ): Promise<GlobalInstructions> {
    return updateGlobalInstruction(this.workspaceId, id, patch);
  }

  async removeGlobalInstruction(id: string): Promise<GlobalInstructions> {
    return removeGlobalInstruction(this.workspaceId, id);
  }

  async resetGlobalInstructions(): Promise<GlobalInstructions> {
    return resetGlobalInstructions(this.workspaceId);
  }

  async getSavedPosts(): Promise<SavedPosts> {
    return loadSavedPosts(this.workspaceId);
  }

  async savePost(input: SavePostInput): Promise<SavedPosts> {
    return savePost(this.workspaceId, input);
  }

  /** Save the post currently open in the Playground, with its full conversation. */
  async savePlaygroundPost(note?: string): Promise<{ ok: boolean }> {
    const ok = await saveCurrentPost(this.workspaceId, note);
    return { ok };
  }

  async updateSavedPostNote(id: string, note: string): Promise<SavedPosts> {
    return updateSavedPostNote(this.workspaceId, id, note);
  }

  async removeSavedPost(id: string): Promise<SavedPosts> {
    return removeSavedPost(this.workspaceId, id);
  }

  async getLabFacts(): Promise<LabFacts> {
    return loadLabFacts(this.workspaceId);
  }

  async addLabFacts(additions: AddLabFactInput[]): Promise<LabFacts> {
    return addLabFacts(this.workspaceId, additions);
  }

  async updateLabFact(id: string, patch: Partial<Pick<LabFact, "statement" | "kind">>): Promise<LabFacts> {
    return updateLabFact(this.workspaceId, id, patch);
  }

  async removeLabFact(id: string): Promise<LabFacts> {
    return removeLabFact(this.workspaceId, id);
  }

  async getAudienceModel(): Promise<AudienceModel> {
    return loadAudienceModel(this.workspaceId);
  }

  async addAudienceNotes(statements: string[]): Promise<AudienceModel> {
    return addAudienceNotes(this.workspaceId, statements.map((s) => ({ statement: s, source: "manual" })));
  }

  async updateAudienceNote(id: string, statement: string): Promise<AudienceModel> {
    return updateAudienceNote(this.workspaceId, id, statement);
  }

  async removeAudienceNote(id: string): Promise<AudienceModel> {
    return removeAudienceNote(this.workspaceId, id);
  }

  /**
   * Route a confirmed correction to the right memory. Studio-owned categories
   * (world/audience/style) are applied directly. The "product" category routes
   * into the REAL knowledge_items graph via the first-class correction path
   * (versioned, audited), reusing a persistent "Studio corrections" conversation.
   */
  async confirmStudioCorrection(input: ConfirmCorrectionRouteInput): Promise<{ routedTo: string }> {
    if (input.category === "product") {
      const conversationId = await this.ensureStudioCorrectionConversation();
      const preview = await this.previewCorrection({
        conversationId,
        correctionText: input.statement,
      });
      await this.confirmCorrection({
        conversationId,
        correctionText: input.statement,
        proposedChanges: preview.proposedChanges,
        confirmedBy: "studio",
      });
      return { routedTo: "Product knowledge graph" };
    }
    await applyStudioCorrection(input, this.socialDeps());
    const label =
      input.category === "world" ? "Real-world lab facts" : input.category === "audience" ? "Audience understanding" : "Style guide";
    return { routedTo: label };
  }

  /** Find or create the persistent conversation used to log Studio corrections. */
  private async ensureStudioCorrectionConversation(): Promise<string> {
    const existing = await this.repos.getStudioState<{ conversationId: string }>(this.workspaceId, "studio_correction_conversation");
    if (existing?.conversationId) {
      const conv = await this.repos.getConversation(existing.conversationId);
      if (conv) return existing.conversationId;
    }
    const conv = await this.repos.createConversation(this.workspaceId, "Studio corrections", "studio");
    await this.repos.setStudioState(this.workspaceId, "studio_correction_conversation", { conversationId: conv.id });
    return conv.id;
  }

  async openSavedPost(savedId: string): Promise<TrainingState> {
    return openSavedPost(savedId, this.socialDeps());
  }

  async revertToTurn(turnId: string): Promise<TrainingState> {
    return revertToTurn(this.workspaceId, turnId);
  }

  async getStyleGuide(): Promise<StyleGuide> {
    return loadStyleGuide(this.workspaceId);
  }

  async addStyleRule(rule: string): Promise<StyleGuide> {
    return addStyleRules(this.workspaceId, [{ rule, source: "manual" }]);
  }

  async removeStyleRule(ruleId: string): Promise<StyleGuide> {
    return removeStyleRule(this.workspaceId, ruleId);
  }

  async getCalendar(): Promise<StoredCalendar> {
    return loadCalendar(this.workspaceId);
  }

  async saveCalendar(data: { slots: CalSlot[]; citations: CalCitation[]; brief: string }): Promise<StoredCalendar> {
    return saveCalendar(this.workspaceId, data);
  }

  async clearCalendar(): Promise<void> {
    return clearCalendar(this.workspaceId);
  }

  async getTraining(): Promise<TrainingState> {
    return loadTraining(this.workspaceId);
  }

  async generateTrainingPost(input: GenerateTrainingInput): Promise<TrainingPost> {
    return generateTrainingPost(input, this.socialDeps());
  }

  async submitTrainingFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
    return submitTrainingFeedback(input, this.socialDeps());
  }

  async resolveInstructionConflict(input: ResolveConflictInput) {
    return resolveInstructionConflict(input, this.socialDeps());
  }

  async resetTraining(): Promise<void> {
    return resetTraining(this.workspaceId);
  }

  async generateGraphic(input: GenerateGraphicInput & { postId?: string; record?: boolean }): Promise<GraphicResult> {
    const result = await generateGraphic(input, this.provider);
    if (input.postId) {
      try {
        await setPendingGraphic(this.workspaceId, input.postId, result.png);
        // Record a media turn in the post's conversation (direction + image),
        // but not for the initial auto-graphic (record === false).
        if (input.record !== false) {
          await recordMediaRevision(this.workspaceId, input.direction ?? "", result.png);
        }
      } catch {
        // non-fatal; the client still has the image
      }
    }
    return result;
  }

  // ── web research ────────────────────────────────────────────────────────────
  async promoteFinding(input: PromoteFindingInput): Promise<{ sourceId: string; itemId: string }> {
    return promoteFinding(input, this.converseDeps());
  }

  async listResearchSessions(): Promise<ResearchSessionSummary[]> {
    const sessions = await this.repos.listResearchSessions(this.workspaceId);
    return Promise.all(
      (sessions ?? []).map(async (s) => {
        const [queries, findings] = await Promise.all([
          this.repos.getResearchQueries(s.id),
          this.repos.getResearchFindings(s.id),
        ]);
        return {
          id: s.id,
          question: s.question,
          trigger: s.trigger,
          provider: s.provider,
          createdAt: s.created_at,
          queries: (queries ?? []).map((q) => q.query),
          findings: (findings ?? []).map((f) => ({
            id: f.id,
            url: f.url,
            title: f.title,
            excerpt: f.excerpt,
            publishedDate: f.published_date,
            retrievedAt: f.retrieved_at,
            isPrimarySource: f.is_primary_source,
            accessible: f.accessible,
            error: f.error,
            promotedSourceId: f.promoted_source_id,
          })),
        };
      }),
    );
  }

  async previewCorrection(input: CorrectionInput): Promise<CorrectionPreview> {
    return previewCorrection(input, this.converseDeps());
  }

  async confirmCorrection(input: ConfirmCorrectionInput): Promise<CorrectionResult> {
    return confirmCorrection(input, this.converseDeps());
  }
}

/** Default in-process instance factory. */
export function getBrainService(): BrainService {
  return new DefaultBrainService();
}
