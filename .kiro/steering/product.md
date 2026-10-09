# Product — LIMS Brain

LIMS Brain is a persistent, evolving **product knowledge system** for Sampleify (our LIMS product). It understands Sampleify at the depth of a long-tenured senior PM: capabilities, workflows, personas, problems, implementation detail, positioning, terminology, evidence/metrics, limitations, and historical decisions.

## What it is NOT
It is **not** a "chat with my documents" app. Documents are raw input. The product is a **structured, de-duplicated, relationship-aware knowledge model** (a typed graph) that grows and self-corrects as new material arrives. If a change makes the system behave like per-document Q&A, it's wrong.

## V1 primary surface: a chat you can teach
The main way to use and test the Brain in V1 is a **full in-app chat** (real product workflow, not a Kiro conversation). The user asks questions, gets grounded cited answers, and corrects wrong/incomplete answers inline. A chat correction is a **first-class knowledge update** — it versions the affected item (prior value preserved), sets `source_classification='human'`, records provenance (a `chat_correction` note source + `corrections`/`knowledge_changes` rows linking message ↔ item ↔ revision), and future answers use the corrected value. Never treat a correction as just another ingested document. Every conversation, message, grounding set, correction, and resulting knowledge change is persisted and inspectable so the user can reconstruct *why the Brain believes what it believes*. Provenance between conversations and items is bidirectional.

## The hard rules (never violate)
1. **Never invent** product capabilities, metrics, customer results, or any factual claim. Prefer "the Brain has no supported evidence" over fabrication.
2. **Everything is traceable** — every knowledge item links to the source(s) and exact location it came from.
3. **Status is always explicit** — confirmed / candidate / interpretation / outdated / conflicted / archived / invalidated / unknown. Never silently promote an inference to a fact.
4. **Conflicts are detected, not auto-resolved** — humans resolve conflicting knowledge.
5. **Humans are in control** — users can edit, correct, add, merge, archive, invalidate; all such actions are versioned/audited.

## LIMS Brain is the reusable intelligence layer
Future applications are **consumers** of the Brain, not forks of it. They call `BrainService` to get grounded knowledge with citations. Planned future consumers (DO NOT build until explicitly asked):
- Social Media Engine
- Sales/marketing assistant
- Product documentation assistant
- Demo assistant

Any design decision should preserve the Brain's reusability: keep knowledge, grounding, and provenance in `BrainService`; keep apps thin.

## Phase
Phase 1 builds the foundation and five UI areas (Knowledge, Explorer, Item, Ask, Admin). Downstream apps are out of scope until requested.

Full specs live in `docs/` (`00-overview`, `01-requirements`, `02-design`, `03-tasks`, `04-risks-and-gaps`).
