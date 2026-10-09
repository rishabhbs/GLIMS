/**
 * Human curation operations. Every mutation that changes an item's belief
 * writes a revision snapshot (prior value), a knowledge_changes row, and an
 * audit_log entry. This keeps human editing first-class and fully reversible.
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import type {
  AddManualItemInput,
  EditItemInput,
  MergeItemsInput,
  RelateItemsInput,
  SetStatusInput,
} from "../types";
import { contentHash } from "../hash";
import { toVectorLiteral } from "@/db/vector";
import { asJson } from "@/db/database.types";

export interface CurationDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
  embeddingModel: string;
}

export async function editItem(input: EditItemInput, deps: CurationDeps) {
  const { repos, workspaceId } = deps;
  const current = await repos.getItem(input.id);
  if (!current) throw new Error(`item ${input.id} not found`);

  // Snapshot prior value.
  const revision = await repos.insertRevision({
    item_id: input.id,
    snapshot: asJson(current),
    changed_by: input.editedBy ?? null,
    change_reason: input.reason ?? "manual edit",
  });

  // Re-embed if the claim changed.
  const claimChanged = input.claim !== undefined && input.claim !== current.claim;
  let embedding: string | undefined;
  if (claimChanged) {
    const { vectors } = await deps.provider.embed([input.claim!]);
    embedding = toVectorLiteral(vectors[0]);
  }

  const updated = await repos.updateKnowledgeItem(input.id, {
    title: input.title ?? current.title,
    claim: input.claim ?? current.claim,
    body: input.body === undefined ? current.body : input.body,
    entity_type: input.entityType ?? current.entity_type,
    confidence: input.confidence ?? current.confidence,
    attributes: asJson(input.attributes ?? current.attributes),
    source_classification: "human", // a human touched it
    ...(embedding ? { embedding, embedding_model: deps.embeddingModel } : {}),
  });

  await repos.insertKnowledgeChange({
    workspace_id: workspaceId,
    item_id: input.id,
    revision_id: revision.id,
    change_type: "edited",
    before: asJson(current),
    after: asJson(updated),
    created_by: input.editedBy ?? null,
  });

  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.editedBy ?? null,
    action: "edit",
    target_type: "knowledge_item",
    target_id: input.id,
    detail: { reason: input.reason ?? null },
  });

  return updated;
}

export async function addManualItem(input: AddManualItemInput, deps: CurationDeps) {
  const { repos, workspaceId } = deps;

  // Retain the human's own text as a note source for provenance.
  let sourceId: string | null = null;
  if (input.sourceText && input.sourceText.trim() !== "") {
    const hash = contentHash(["note", input.title, input.sourceText, String(Date.now())]);
    const src = await repos.insertSource({
      workspace_id: workspaceId,
      type: "note",
      title: input.title,
      raw_text: input.sourceText,
      content_hash: hash,
      extraction_method: "manual",
      added_by: input.addedBy ?? null,
    });
    sourceId = src.id;
  }

  const { vectors } = await deps.provider.embed([input.claim]);
  const item = await repos.insertKnowledgeItem({
    workspace_id: workspaceId,
    entity_type: input.entityType,
    title: input.title,
    claim: input.claim,
    body: input.body ?? null,
    status: "confirmed", // a human asserted it
    source_classification: "human",
    confidence: input.confidence ?? 0.9,
    embedding: toVectorLiteral(vectors[0]),
    embedding_model: deps.embeddingModel,
  });

  if (sourceId) {
    await repos.insertEvidence({
      workspace_id: workspaceId,
      item_id: item.id,
      source_id: sourceId,
      snippet: input.sourceText ?? null,
    });
  }

  await repos.insertKnowledgeChange({
    workspace_id: workspaceId,
    item_id: item.id,
    change_type: "created",
    after: asJson(item),
    created_by: input.addedBy ?? null,
  });
  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.addedBy ?? null,
    action: "add_manual_item",
    target_type: "knowledge_item",
    target_id: item.id,
    detail: {},
  });

  return item;
}

export async function setStatus(input: SetStatusInput, deps: CurationDeps) {
  const { repos, workspaceId } = deps;
  const current = await repos.getItem(input.id);
  if (!current) throw new Error(`item ${input.id} not found`);

  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "confirmed") {
    patch.confirmed_by = input.actor ?? null;
    patch.confirmed_at = new Date().toISOString();
  }
  const updated = await repos.updateKnowledgeItem(input.id, patch);

  await repos.insertKnowledgeChange({
    workspace_id: workspaceId,
    item_id: input.id,
    change_type: "status_changed",
    before: asJson({ status: current.status }),
    after: asJson({ status: input.status }),
    created_by: input.actor ?? null,
  });
  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.actor ?? null,
    action: "status_change",
    target_type: "knowledge_item",
    target_id: input.id,
    detail: { from: current.status, to: input.status },
  });
  return updated;
}

export async function relateItems(input: RelateItemsInput, deps: CurationDeps) {
  const { repos, workspaceId } = deps;
  const rel = await repos.insertRelationship({
    workspace_id: workspaceId,
    from_item_id: input.fromItemId,
    to_item_id: input.toItemId,
    relationship_type: input.relationshipType,
    note: input.note ?? null,
    created_by: input.createdBy ?? null,
  });
  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.createdBy ?? null,
    action: "relate",
    target_type: "knowledge_item",
    target_id: input.fromItemId,
    detail: { to: input.toItemId, type: input.relationshipType },
  });
  return rel;
}

export async function mergeItems(input: MergeItemsInput, deps: CurationDeps) {
  const { repos, workspaceId } = deps;
  const keep = await repos.getItem(input.keepItemId);
  const merge = await repos.getItem(input.mergeItemId);
  if (!keep || !merge) throw new Error("both items must exist to merge");

  // Snapshot the item being merged away.
  await repos.insertRevision({
    item_id: input.mergeItemId,
    snapshot: asJson(merge),
    changed_by: input.mergedBy ?? null,
    change_reason: `merged into ${input.keepItemId}`,
  });

  // Move provenance + relationships onto the surviving item.
  await repos.reassignEvidence(input.mergeItemId, input.keepItemId);
  await repos.reassignRelationships(input.mergeItemId, input.keepItemId);

  // Archive the merged item and point it at the survivor.
  await repos.updateKnowledgeItem(input.mergeItemId, {
    status: "archived",
    superseded_by: input.keepItemId,
  });

  await repos.insertKnowledgeChange({
    workspace_id: workspaceId,
    item_id: input.keepItemId,
    change_type: "edited",
    before: asJson({ note: `merged ${input.mergeItemId}` }),
    after: asJson({ mergedFrom: input.mergeItemId }),
    created_by: input.mergedBy ?? null,
  });
  await repos.writeAudit({
    workspace_id: workspaceId,
    actor: input.mergedBy ?? null,
    action: "merge",
    target_type: "knowledge_item",
    target_id: input.keepItemId,
    detail: { mergedFrom: input.mergeItemId },
  });

  return repos.getItem(input.keepItemId);
}
