# Structure & Conventions — LIMS Brain

## Layering (strict — this keeps the Brain reusable)
```
app/            → Next.js UI + route handlers. Calls BrainService ONLY.
src/
  brain/        → BrainService + domain logic — THE reusable intelligence layer
    service.ts
    ingestion/  → extract, chunk, embed, dedupe, relate, conflict-detect
    retrieval/  → hybrid search, graph expansion, grounded answering
    conversation/ → answerQuestion, previewCorrection + confirmCorrection (teaching loop), history
    curation/   → edit, merge, status, revisions, audit, revertChange
  providers/    → ModelProvider interface + openai/anthropic/mock impls
  db/           → repositories (ALL SQL lives here), supabase client, generated types
  config/       → env, embedding dims, provider selection
supabase/
  migrations/   → schema + seed taxonomy
docs/           → specs (00-overview, 01-requirements, 02-design, 03-tasks, 04-risks-and-gaps)
```

### Dependency rule (enforced by convention)
`app → src/brain → { src/db, src/providers, src/config }`
- UI never imports `src/db` or `src/providers` directly. It goes through `BrainService`.
- All SQL lives in `src/db` repositories. No raw SQL in routes or UI.
- All model calls go through `ModelProvider`. No vendor SDK calls outside `src/providers`.

## Core domain model (names are stable; see docs/02-design §3)
- `sources` → original artifacts, kept forever.
- `source_chunks` → embedded retrievable spans of raw material.
- `knowledge_items` → the product: one atomic typed claim, with status + confidence + classification + embedding.
- `evidence` → links item ↔ chunk/source with locator (provenance backbone).
- `knowledge_relationships` → typed edges that make the model a graph.
- `knowledge_item_revisions` + `audit_log` → versioning and accountability.
- `entity_types` / `relationship_types` → **table-driven taxonomy** (never a hardcoded enum; add types without migration).
- `conversations` / `messages` / `message_grounding` → the chat surface; every answer records the items+sources it used.
- `corrections` / `knowledge_changes` → chat corrections as first-class knowledge updates, linking message ↔ correction ↔ item ↔ revision (bidirectional provenance).

## Conventions
- Every knowledge item carries: `entity_type`, `status`, `source_classification` (`extracted|inferred|human`), `confidence` (0–1), and at least one evidence row if it's treated as supported.
- New extracted items default to `status = candidate`; promotion to `confirmed` is a human action and must be audited.
- Curation mutations: write a `knowledge_item_revisions` snapshot + an `audit_log` entry.
- Chat corrections run through `BrainService`, not the UI, in two explicit stages: `previewCorrection` (identify affected items + propose change + new understanding; applies NOTHING) then `confirmCorrection` (only after the user clicks "Apply correction": create `chat_correction` note source → version + edit item(s) → record `corrections` + `knowledge_changes`). Corrections are NEVER auto-applied and are reversible via `revertChange`.
- Searching for answers runs over `knowledge_items`, not raw chunks. Raw-chunk search is only a "find the original passage" fallback.
- Carry `workspace_id` on all core tables (single workspace in Phase 1, multi-tenant later).

## When adding features
1. Add/extend repository methods in `src/db`.
2. Add domain logic + expose via `BrainService` in `src/brain`.
3. Add route handler if it needs HTTP exposure (keep in-process and HTTP contracts identical).
4. Build UI in `app/` against `BrainService`.
5. Update `docs/` and relevant steering if conventions change.
