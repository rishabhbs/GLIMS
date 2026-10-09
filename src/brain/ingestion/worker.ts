/**
 * Ingestion worker — runs the full staged pipeline for one job:
 *   extract text -> chunk -> embed chunks -> extract knowledge items
 *   -> dedupe/conflict -> create items + evidence (provenance) -> status.
 *
 * Idempotent-ish: re-running clears a source's chunks before re-chunking.
 * All status transitions and errors are persisted on the ingestion_jobs row.
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import type { StorageReader } from "./extract-text";
import { extractText } from "./extract-text";
import { chunkText } from "./chunk";
import { buildExtractionSchema } from "./schema";
import { decide, type Comparable } from "./dedupe";
import { toVectorLiteral, parseVectorLiteral } from "@/db/vector";
import { asJson } from "@/db/database.types";

export interface IngestionDeps {
  repos: Repositories;
  provider: ModelProvider;
  storage?: StorageReader;
  embeddingModel: string;
}

export interface ProcessResult {
  jobId: string;
  status: "completed" | "needs_review" | "failed";
  chunks: number;
  itemsCreated: number;
  duplicates: number;
  conflicts: number;
  error?: string;
}

/** Find the exact char range of a verbatim snippet within the source text. */
function locateSnippet(sourceText: string, snippet: string): { char_start: number; char_end: number } | null {
  const idx = sourceText.indexOf(snippet);
  if (idx < 0) return null;
  return { char_start: idx, char_end: idx + snippet.length };
}

export async function processJob(jobId: string, deps: IngestionDeps): Promise<ProcessResult> {
  const { repos, provider, embeddingModel } = deps;
  const job = await repos.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const source = await repos.getSource(job.source_id);
  if (!source) throw new Error(`source ${job.source_id} not found`);

  const workspaceId = job.workspace_id;
  let chunksCount = 0;
  let itemsCreated = 0;
  let duplicates = 0;
  let conflicts = 0;

  try {
    await repos.updateJob(jobId, { status: "extracting", attempts: job.attempts + 1, error: null });

    // 1. EXTRACT TEXT
    const extracted = await extractText(
      {
        type: source.type as "pdf" | "text" | "url" | "note" | "image" | "other",
        rawText: source.raw_text,
        uri: source.uri,
        storagePath: source.storage_path,
        existingMethod: source.extraction_method,
      },
      { provider, storage: deps.storage },
    );
    const sourceText = extracted.text ?? "";
    await repos.updateSource(source.id, {
      raw_text: sourceText,
      extraction_method: extracted.method,
    });

    if (sourceText.trim() === "") {
      await repos.updateJob(jobId, { status: "needs_review", error: "no text extracted" });
      return { jobId, status: "needs_review", chunks: 0, itemsCreated: 0, duplicates: 0, conflicts: 0 };
    }

    // 2. CHUNK
    const chunks = chunkText(sourceText);
    chunksCount = chunks.length;

    // 3. EMBED CHUNKS
    await repos.updateJob(jobId, { status: "embedding" });
    await repos.deleteChunksForSource(source.id);
    if (chunks.length > 0) {
      const { vectors, model } = await provider.embed(chunks.map((c) => c.content));
      const chunkRows = chunks.map((c, i) => ({
        workspace_id: workspaceId,
        source_id: source.id,
        ordinal: c.ordinal,
        content: c.content,
        locator: c.locator,
        embedding: toVectorLiteral(vectors[i]),
        embedding_model: model ?? embeddingModel,
      }));
      await repos.insertChunks(chunkRows);
    }

    // 4. EXTRACT KNOWLEDGE
    await repos.updateJob(jobId, { status: "extracting" });
    const entityTypes = await repos.listEntityTypes();
    const typeKeys = (entityTypes ?? []).map((t) => t.key);
    const schema = buildExtractionSchema(typeKeys);

    // Extract over the full text (bounded) — keeps claims coherent across chunks.
    const extraction = await provider.structuredExtract(sourceText.slice(0, 24000), schema, {
      temperature: 0,
    });
    const typeKeySet = new Set(typeKeys);

    // Embed all claims in one batch for dedupe comparison.
    const validItems = extraction.items.filter(
      (it) => typeKeySet.has(it.entity_type) && it.evidence_snippet.trim() !== "",
    );
    const claimVectors =
      validItems.length > 0 ? (await provider.embed(validItems.map((it) => it.claim))).vectors : [];

    // 5 + 6. DEDUPE/CONFLICT + CREATE WITH PROVENANCE
    let lowConfidenceOrUntyped = extraction.items.length !== validItems.length;

    for (let i = 0; i < validItems.length; i++) {
      const it = validItems[i];
      const embedding = claimVectors[i] ?? null;

      // Candidate pool of same-type items.
      const poolRaw = await repos.candidateItemsByType(workspaceId, it.entity_type);
      const pool: Comparable[] = (poolRaw ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        claim: p.claim,
        status: p.status,
        embedding: parseVectorLiteral(p.embedding as string | null),
      }));

      const decision = decide({ title: it.title, claim: it.claim, embedding }, pool);

      if (decision.kind === "duplicate") {
        // Attach new evidence to the existing item (reinforces provenance).
        duplicates++;
        await linkEvidence(repos, workspaceId, decision.itemId, source.id, it.evidence_snippet, sourceText);
        continue;
      }

      // Create the new item (always 'candidate' — human promotes to confirmed).
      const created = await repos.insertKnowledgeItem({
        workspace_id: workspaceId,
        entity_type: it.entity_type,
        title: it.title,
        claim: it.claim,
        body: it.body ?? null,
        status: decision.kind === "conflict" ? "conflicted" : "candidate",
        source_classification: it.source_classification,
        confidence: it.confidence,
        attributes: asJson(it.attributes ?? {}),
        embedding: embedding ? toVectorLiteral(embedding) : null,
        embedding_model: embeddingModel,
      });
      itemsCreated++;
      if (it.confidence < 0.4) lowConfidenceOrUntyped = true;

      // Provenance: evidence linking the new item to the source snippet.
      await linkEvidence(repos, workspaceId, created.id, source.id, it.evidence_snippet, sourceText);

      if (decision.kind === "conflict") {
        conflicts++;
        // Flag both sides and record the contradiction edge.
        await repos.setItemStatus(decision.itemId, "conflicted");
        await repos.insertRelationship({
          workspace_id: workspaceId,
          from_item_id: created.id,
          to_item_id: decision.itemId,
          relationship_type: "contradicts",
          note: `auto-detected during ingestion (sim=${decision.similarity.toFixed(2)})`,
        });
        await repos.writeAudit({
          workspace_id: workspaceId,
          action: "conflict_detected",
          target_type: "knowledge_item",
          target_id: created.id,
          detail: { conflictsWith: decision.itemId, similarity: decision.similarity },
        });
      }
    }

    const finalStatus = lowConfidenceOrUntyped || conflicts > 0 ? "needs_review" : "completed";
    await repos.updateJob(jobId, { status: finalStatus });
    await repos.writeAudit({
      workspace_id: workspaceId,
      action: "ingestion_processed",
      target_type: "source",
      target_id: source.id,
      detail: { jobId, chunks: chunksCount, itemsCreated, duplicates, conflicts, finalStatus },
    });

    return { jobId, status: finalStatus, chunks: chunksCount, itemsCreated, duplicates, conflicts };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown ingestion error";
    await repos.updateJob(jobId, { status: "failed", error: message });
    return {
      jobId,
      status: "failed",
      chunks: chunksCount,
      itemsCreated,
      duplicates,
      conflicts,
      error: message,
    };
  }
}

async function linkEvidence(
  repos: Repositories,
  workspaceId: string,
  itemId: string,
  sourceId: string,
  snippet: string,
  sourceText: string,
) {
  const locator = locateSnippet(sourceText, snippet);
  await repos.insertEvidence({
    workspace_id: workspaceId,
    item_id: itemId,
    source_id: sourceId,
    snippet,
    locator: locator ?? undefined,
  });
}
