# Tech & Stack — LIMS Brain

## Stack (decided)
- **Next.js (App Router) + TypeScript** — single deployable, server actions / route handlers for backend, Vercel-native.
- **Supabase Postgres + `pgvector` + `pg_trgm`** — one DB for the relational knowledge graph, vector search, and keyword search. Do not add a separate vector service unless scale forces it.
- **Supabase Storage** — original PDFs/images; raw bytes retained forever for provenance.
- **Supabase Auth + RLS** — team access scoped by `workspace_id`.
- **Vercel AI SDK** as provider plumbing, but always behind our own `ModelProvider` interface.

## AI provider abstraction (mandatory)
The AI/model layer MUST sit behind a `ModelProvider` interface:
```ts
interface ModelProvider {
  embed(texts: string[]): Promise<{ vectors: number[][]; model: string }>;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  structuredExtract<T>(input: string, schema: JSONSchema, opts?): Promise<T>;
}
```
- Callers depend on `ModelProvider`, never on a vendor SDK directly.
- Concrete impls: OpenAI (default), Anthropic, Mock (tests). Selected via `MODEL_PROVIDER` env.
- Embedding dimension is a **schema commitment** (`vector(1536)` by default). Pin dims in config; store `embedding_model` on every embedding row so re-embedding is a controlled migration, not a surprise.

## Web research (dual-source, mandatory separation)
Live web research sits behind a single-method `WebResearchProvider` interface (`research(query)`), SEPARATE from `ModelProvider`, selected by env `WEB_RESEARCH_PROVIDER` (`gemini` | `mock`). Default concrete impl: `GeminiWebResearchProvider` using Gemini's native Google Search grounding (reuses `@ai-sdk/google` + `GOOGLE_GENERATIVE_AI_API_KEY`, server-side only; no third-party search API, no Tavily). `MockWebResearchProvider` (`isMock=true`) for offline/tests — never confuse mock output with real grounding. Capture ACTUAL source URLs/titles/excerpts from Gemini grounding metadata; never fabricate citations. Rules:
- Internal (Sampleify) knowledge and external (web) findings are ALWAYS clearly distinguished in answers: INTERNAL / EXTERNAL / INFERENCE / UNKNOWN.
- External findings NEVER auto-become confirmed product knowledge. They persist in `research_*` tables as external evidence; a human explicitly promotes a finding (creating a `url` source + `candidate` item + evidence, provenance preserved). Promotion is audited.
- Citations carry title, URL, excerpt, and publication/retrieval date where available. Prefer official/primary sources for standards/regulatory/compliance questions. Never invent clause mappings or imply Sampleify guarantees accreditation.
- Handle inaccessible pages (record error, exclude from citations), conflicting sources (surface, don't auto-resolve), and insufficient evidence (refuse) honestly.
- Human corrections still flow through preview → explicit confirm → versioned change (unchanged).

## Grounding (mandatory)
Answers are composed only from retrieved `knowledge_items` + their evidence. Grounding is enforced **in the system prompt AND verified in code** after generation: strip/flag any factual claim lacking a citation. Every grounded answer returns `citations` and a `groundingStatus` of `grounded | partial | insufficient`.

## Corrections as first-class knowledge (mandatory)
A human correction given in chat is NOT ingested as a document. It runs through two explicit stages and is NEVER auto-applied (even for straightforward edits):
- `previewCorrection`: identify the affected item(s) using the corrected message's grounding set plus retrieval over the correction text; return what will change + the proposed new understanding. Applies NOTHING.
- `confirmCorrection` (only after the user explicitly clicks "Apply correction"): create a `source` of type `note` with `extraction_method='chat_correction'` for provenance; version the affected item(s) via `knowledge_item_revisions` with `source_classification='human'`; mark superseded beliefs `outdated` + add a `supersedes` edge where sequencing/values change; record `corrections` + `knowledge_changes` + `audit_log` so message ↔ correction ↔ item ↔ revision are linked both ways; provide undo/revert.
If a correction contradicts `confirmed` knowledge, surface the conflict (`contradicts` + `conflicted`) rather than silently overwriting. Corrections are reversible via `revertChange`. Subsequent answers must use the corrected value. The ask + teach loop lives in `BrainService`, not the UI.

## Async ingestion (mandatory)
Ingestion runs as **async jobs** (DB-backed `ingestion_jobs` + worker route, cron/`after()`), never synchronously inside the upload request. This avoids serverless timeouts and makes ingestion observable/retryable. Jobs are idempotent (`content_hash` + `idempotency_key`).

## Secrets & data boundaries
- Secrets only in env / Vercel settings. Never commit keys. Keep `.env.example` updated.
- Do not transmit source content to any third party beyond the configured model provider needed for extraction/answers.
- Mark sensitive sources/items with a `sensitivity` flag; be careful echoing customer data.

## Commands / environment
- Shell: zsh on macOS. Chain with `&&`.
- Do not launch long-running dev servers via tooling; let the user run `next dev` themselves.
- Prefer `--run` (single-run) for test commands over watch mode.
