/**
 * Shared domain types for LIMS Brain. These are the vocabulary of BrainService
 * and are UI- and DB-agnostic. (See docs/02-design.md.)
 */

export type EntityTypeKey =
  | "feature" | "workflow" | "workflow_step" | "persona" | "problem" | "customer"
  | "metric" | "terminology" | "competitor" | "positioning" | "decision" | "limitation"
  | (string & {}); // table-driven: allow custom types

export type KnowledgeStatus =
  | "candidate" | "confirmed" | "interpretation" | "outdated"
  | "conflicted" | "archived" | "invalidated" | "unknown";

export type SourceClassification = "extracted" | "inferred" | "human";

export type SourceType = "pdf" | "text" | "url" | "note" | "image" | "other";

export type GroundingStatus = "grounded" | "partial" | "insufficient";

export interface KnowledgeItem {
  id: string;
  workspaceId: string;
  entityType: EntityTypeKey;
  title: string;
  claim: string;
  body: string | null;
  status: KnowledgeStatus;
  sourceClassification: SourceClassification;
  confidence: number;
  attributes: Record<string, unknown>;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRef {
  id: string;
  sourceId: string;
  sourceTitle: string | null;
  sourceType: SourceType;
  chunkId: string | null;
  snippet: string | null;
  locator: unknown;
}

export interface RelatedItemRef {
  relationshipType: string;
  direction: "outgoing" | "incoming";
  item: Pick<KnowledgeItem, "id" | "title" | "entityType" | "status">;
  note: string | null;
}

export interface KnowledgeItemWithProvenance extends KnowledgeItem {
  evidence: EvidenceRef[];
  related: RelatedItemRef[];
}

/** A single search hit. */
export interface KnowledgeHit {
  id: string;
  entityType: EntityTypeKey;
  title: string;
  claim: string;
  status: KnowledgeStatus;
  sourceClassification: SourceClassification;
  confidence: number;
  score: number; // fused rank score
}

export interface SearchQuery {
  text: string;
  entityTypes?: EntityTypeKey[];
  statuses?: KnowledgeStatus[];
  limit?: number;
}

// ── Ingestion ───────────────────────────────────────────────────────────────
export interface IngestInput {
  type: SourceType;
  title?: string;
  text?: string;        // for text/note, or pre-extracted content
  uri?: string;         // for url
  storagePath?: string; // for pdf/image already uploaded to Storage
  sensitivity?: "normal" | "sensitive";
  extractionMethod?: string;
  addedBy?: string | null;
}

// ── Ask + teach ───────────────────────────────────────────────────────────────
export interface AskQuery {
  conversationId: string;
  question: string;
  askedBy?: string | null;
  /** 'always' = force web research; 'never' = internal only; 'auto' = routing decides. */
  researchMode?: ResearchMode;
}

export interface Citation {
  claim: string;
  itemIds: string[];
  sourceIds: string[];
}

export interface GroundedAnswer {
  messageId: string;
  conversationId: string;
  answer: string;
  groundingStatus: GroundingStatus;
  citations: Citation[];
  usedItems: Array<Pick<KnowledgeItem, "id" | "title" | "entityType" | "status">>;
  usedSources: Array<{ id: string; title: string | null; type: SourceType }>;
  conflicts: Array<{ itemIds: string[]; note: string }>;
  /** External web research used (empty when research didn't run). */
  researched: boolean;
  researchSessionId: string | null;
  webCitations: WebCitation[];
}

export interface CorrectionInput {
  conversationId: string;
  messageId?: string | null;  // the assistant message being corrected
  correctionText: string;
  correctedBy?: string | null;
}

/** A single proposed change the user must approve before anything is written. */
export interface ProposedChange {
  kind: "edit" | "create" | "outdate";
  itemId?: string;                 // for edit/outdate
  entityType?: EntityTypeKey;      // for create
  currentUnderstanding?: string;   // what the Brain believes now
  proposedUnderstanding: string;   // what it will believe after
  rationale: string;
}

/** Result of previewCorrection — NOTHING is written yet. */
export interface CorrectionPreview {
  conversationId: string;
  correctionText: string;
  affectedItemIds: string[];
  proposedChanges: ProposedChange[];
  wouldConflictWithConfirmed: boolean;
}

export interface ConfirmCorrectionInput {
  conversationId: string;
  messageId?: string | null;
  correctionText: string;
  proposedChanges: ProposedChange[];
  confirmedBy?: string | null;
}

export interface CorrectionResult {
  correctionId: string;
  changedItemIds: string[];
  knowledgeChangeIds: string[];
}

// ── Conversations / history ───────────────────────────────────────────────────
export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  groundingStatus: GroundingStatus | null;
  citations: Citation[] | null;
  createdAt: string;
}

export interface ConversationWithMessages {
  id: string;
  title: string | null;
  messages: ConversationMessage[];
}

export interface KnowledgeChangeEntry {
  id: string;
  itemId: string;
  changeType: string;
  cause: "ingestion" | "manual" | "chat_correction";
  conversationId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

// ── Listing & curation (Explorer + Item UI) ──────────────────────────────────
export interface ListItemsQuery {
  entityType?: EntityTypeKey;
  statuses?: KnowledgeStatus[];
  limit?: number;
}

export interface ItemListRow {
  id: string;
  entityType: EntityTypeKey;
  title: string;
  claim: string;
  status: KnowledgeStatus;
  sourceClassification: SourceClassification;
  confidence: number;
  updatedAt: string;
}

export interface EditItemInput {
  id: string;
  title?: string;
  claim?: string;
  body?: string | null;
  entityType?: EntityTypeKey;
  confidence?: number;
  attributes?: Record<string, unknown>;
  editedBy?: string | null;
  reason?: string;
}

export interface AddManualItemInput {
  entityType: EntityTypeKey;
  title: string;
  claim: string;
  body?: string | null;
  confidence?: number;
  sourceText?: string; // the human's own text, retained as a note source
  addedBy?: string | null;
}

export interface SetStatusInput {
  id: string;
  status: KnowledgeStatus;
  actor?: string | null;
}

export interface RelateItemsInput {
  fromItemId: string;
  toItemId: string;
  relationshipType: string;
  note?: string;
  createdBy?: string | null;
}

export interface MergeItemsInput {
  /** The item that survives. */
  keepItemId: string;
  /** The item merged into keep (its evidence/relationships move over, then archived). */
  mergeItemId: string;
  mergedBy?: string | null;
}

export interface TaxonomyType {
  key: string;
  label: string;
  description: string | null;
}

export interface JobRow {
  id: string;
  sourceId: string;
  sourceTitle: string | null;
  sourceType: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Web research (dual-source) ───────────────────────────────────────────────
export type ResearchMode = "auto" | "always" | "never";

export interface ResearchFinding {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  publishedDate: string | null;
  retrievedAt: string;
  isPrimarySource: boolean;
  accessible: boolean;
  error: string | null;
  promotedSourceId: string | null;
}

export interface ResearchSessionSummary {
  id: string;
  question: string;
  trigger: string;
  provider: string;
  createdAt: string;
  queries: string[];
  findings: ResearchFinding[];
}

/** External citation attached to a dual-source answer. */
export interface WebCitation {
  findingId: string;
  title: string | null;
  url: string;
  excerpt: string | null;
  publishedDate: string | null;
  retrievedAt: string;
  isPrimarySource: boolean;
}

export interface PromoteFindingInput {
  findingId: string;
  entityType: EntityTypeKey;
  title: string;
  claim: string;
  promotedBy?: string | null;
}

// ── Social Media Studio (Brain consumer) ─────────────────────────────────────
export type {
  StudioPost,
  StudioPlanEntry,
  StudioArtifact,
  StudioCitation,
  StudioRole,
  StudioHistoryMessage,
  StudioTurnInput,
  StudioTurnResult,
} from "./social/studio";

// ── Social calendar (calendar-first Studio) ───────────────────────────────────
export type {
  SlotStatus,
  CalSlot,
  CalCitation,
  PlanCalendarInput,
  PlanCalendarResult,
  DraftPostsInput,
  DraftPostsResult,
  RevisePostInput,
  RevisePostResult,
} from "./social/calendar";

// ── Studio style guide (learned writing preferences) ─────────────────────────
export type { StyleRule, StyleGuide } from "./social/style-guide";

// ── Persisted social calendar ─────────────────────────────────────────────────
export type { StoredCalendar } from "./social/calendar-store";

// ── Training loop ─────────────────────────────────────────────────────────────
export type {
  TrainingPost,
  TrainingRecord,
  TrainingState,
  TrainingCitation,
  GenerateTrainingInput,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from "./social/training";
