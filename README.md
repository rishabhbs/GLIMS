# LIMS Brain

A persistent, evolving **product knowledge system** for Sampleify. Not a "chat with my documents" app — it builds a structured, de-duplicated, relationship-aware knowledge graph with provenance and confidence, and lets you **teach it through chat**.

Full specs live in [`docs/`](./docs): overview, requirements, design, tasks, risks. Durable conventions live in [`.kiro/steering/`](./.kiro/steering).

## Status: Phase 1 — Milestone M1 (foundation)

M1 delivers the skeleton the rest is built on:

- Next.js (App Router) + TypeScript scaffold with the six UI areas stubbed (Ask, Knowledge, Explorer, History, Admin).
- Supabase/Postgres schema (`supabase/migrations/`): knowledge graph + conversations + corrections + versioning/audit, `pgvector` + `pg_trgm`, hybrid-search RPCs, RLS, and a seeded editable taxonomy.
- Vendor-agnostic `ModelProvider` interface with OpenAI, Anthropic, and Mock implementations, selected by env.
- The reusable `BrainService` contract — the seam future apps call. Intake, taxonomy, conversation CRUD, and item reads are implemented; retrieval, grounded answering, and the correction loop are declared and land in M2/M3 behind the same contract.
- HTTP route handlers mirroring the contract (in-process and HTTP parity).

The core V1 loop (ingest → ask → grounded cited answers → correct in chat → explicitly apply → reflected in future answers → inspect history) is targeted for M2–M3. Corrections are **never auto-applied** — the user must explicitly confirm.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + model provider keys
# apply supabase/migrations/*.sql to your Supabase/Postgres database
npm run dev
```

Without env configured, set `MODEL_PROVIDER=mock` to run offline. Pages that need the DB will show a clear configuration notice until Supabase is wired up.

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript, no emit
- `npm run test` — Vitest
- `npm run lint` — ESLint

## Architecture (one rule to remember)

`app → src/brain (BrainService) → { src/db repositories, src/providers }`.
UI never touches the DB or a model vendor directly. All SQL lives in `src/db`; all model calls go through `ModelProvider`. This is what keeps the Brain reusable by future applications.
