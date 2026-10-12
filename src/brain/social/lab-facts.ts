/**
 * Lab facts — the Studio's model of how REAL laboratories actually work.
 *
 * The generator is grounded in ingested Sampleify product knowledge, but it can
 * still invent plausible-sounding "pain points" about lab life that are simply
 * false (e.g. "results sit in someone's email"). This store is the fourth
 * knowledge layer: ground-truth about the real world, curated by the user, used
 * to stop factual fabrication.
 *
 * Two kinds of entries:
 *   - "truth":  something true about real labs the Studio must respect, e.g.
 *               "Results are entered manually or fetched directly from instruments."
 *   - "avoid":  a misconception the Studio must never state, e.g.
 *               "Results do NOT sit in email; email is not part of the results path."
 *
 * A user "fact correction" (body feedback like "results never sit in email,
 * incorrect assumption") is a first-class knowledge update: it fixes the post
 * AND, after the user confirms, is distilled into entries here so future posts
 * never repeat the mistake. Consistent with the product rule that corrections
 * are never auto-applied.
 *
 * Persistence: a per-workspace row in `studio_state` (key `lab_facts`).
 */
import { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";

export type LabFactKind = "truth" | "avoid";

export interface LabFact {
  id: string;
  /** The fact, phrased as a standalone statement. */
  statement: string;
  kind: LabFactKind;
  /** Where it came from (e.g. "fact correction: ...", or "manual"). */
  source: string;
  createdAt: string;
}

export interface LabFacts {
  workspaceId: string;
  facts: LabFact[];
  updatedAt: string;
}

const KEY = "lab_facts";

function now(): string {
  return new Date().toISOString();
}

function mkId(): string {
  return `lf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export async function loadLabFacts(workspaceId: string): Promise<LabFacts> {
  const value = await new Repositories().getStudioState<LabFacts>(workspaceId, KEY);
  if (value && Array.isArray(value.facts)) {
    return { workspaceId, facts: value.facts, updatedAt: value.updatedAt };
  }
  return { workspaceId, facts: [], updatedAt: now() };
}

async function save(lf: LabFacts): Promise<void> {
  lf.updatedAt = now();
  await new Repositories().setStudioState(lf.workspaceId, KEY, lf);
}

export interface AddLabFactInput {
  statement: string;
  kind: LabFactKind;
  source?: string;
}

/** Add one or more facts, de-duplicating on normalized statement. */
export async function addLabFacts(workspaceId: string, additions: AddLabFactInput[]): Promise<LabFacts> {
  const lf = await loadLabFacts(workspaceId);
  const existing = new Set(lf.facts.map((f) => normalize(f.statement)));
  for (const a of additions) {
    const statement = a.statement.trim();
    if (!statement || existing.has(normalize(statement))) continue;
    existing.add(normalize(statement));
    lf.facts.unshift({
      id: mkId(),
      statement,
      kind: a.kind,
      source: (a.source ?? "manual").trim(),
      createdAt: now(),
    });
  }
  await save(lf);
  return lf;
}

export async function updateLabFact(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<LabFact, "statement" | "kind">>,
): Promise<LabFacts> {
  const lf = await loadLabFacts(workspaceId);
  const fact = lf.facts.find((f) => f.id === id);
  if (fact) {
    if (typeof patch.statement === "string" && patch.statement.trim()) fact.statement = patch.statement.trim();
    if (patch.kind) fact.kind = patch.kind;
    await save(lf);
  }
  return lf;
}

export async function removeLabFact(workspaceId: string, id: string): Promise<LabFacts> {
  const lf = await loadLabFacts(workspaceId);
  lf.facts = lf.facts.filter((f) => f.id !== id);
  await save(lf);
  return lf;
}

/**
 * Render the lab facts as a hard grounding block for generation prompts. Truths
 * are things to respect; "avoid" entries are misconceptions never to state.
 * Empty string when there are no facts.
 */
export function renderLabFacts(lf: LabFacts): string {
  if (!lf.facts.length) return "";
  const truths = lf.facts.filter((f) => f.kind === "truth");
  const avoid = lf.facts.filter((f) => f.kind === "avoid");
  const parts: string[] = [];
  if (truths.length) {
    parts.push(
      `REAL-WORLD LAB FACTS (ground truth about how actual labs work, never contradict these):\n` +
        truths.map((f) => `- ${f.statement}`).join("\n"),
    );
  }
  if (avoid.length) {
    parts.push(
      `FALSE ASSUMPTIONS TO NEVER MAKE (these are wrong about real labs, do not state or imply them):\n` +
        avoid.map((f) => `- ${f.statement}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

// ── distilling a user correction into facts ─────────────────────────────────

export interface FactCorrectionProposal {
  /** The corrected ground truth to remember (kind "truth"). */
  truth: string;
  /** The misconception to avoid (kind "avoid"). */
  avoid: string;
  /** One-line summary of what changed, shown to the user before confirming. */
  summary: string;
}

const DISTILL_FACT_SYSTEM = `You convert a user's FACTUAL correction about how real laboratories work into durable knowledge for a content generator.
The generator wrote a post that assumed something false about real lab life. The user corrected it. Extract:
- "avoid": the false assumption to never make again, phrased as a clear statement (e.g. "Test results sit in analysts' email inboxes").
- "truth": the real-world correction to remember, phrased as a clear standalone statement (e.g. "Results are entered manually into the system or fetched directly from instruments; email is not part of the results path").
- "summary": one short plain sentence describing the correction.
Keep statements general (about labs in general, not this one post). Do not include product/marketing claims. If the user's note is not actually a factual correction, set both "truth" and "avoid" to empty strings.
OUTPUT ONLY JSON: { "truth": string, "avoid": string, "summary": string }`;

/**
 * Turn a user's correction note (optionally with the offending post for context)
 * into a proposed pair of facts. Applies NOTHING — the caller confirms first.
 */
export async function proposeFactCorrection(
  note: string,
  offendingBody: string,
  provider: ModelProvider,
): Promise<FactCorrectionProposal | null> {
  const user = `OFFENDING POST (contained a false assumption):\n${offendingBody}\n\nUSER CORRECTION:\n${note}\n\nExtract the fact to avoid and the real truth.`;
  try {
    const res = await provider.chat(
      [
        { role: "system", content: DISTILL_FACT_SYSTEM },
        { role: "user", content: user },
      ],
      { temperature: 0.2, maxTokens: 400 },
    );
    let t = res.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
    const raw = JSON.parse(t) as { truth?: unknown; avoid?: unknown; summary?: unknown };
    const truth = typeof raw.truth === "string" ? raw.truth.trim() : "";
    const avoid = typeof raw.avoid === "string" ? raw.avoid.trim() : "";
    if (!truth && !avoid) return null;
    return {
      truth,
      avoid,
      summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : "Recorded a real-world lab fact.",
    };
  } catch {
    return null;
  }
}

/**
 * Heuristic: does a body-feedback note look like a FACTUAL correction (vs a
 * stylistic one)? Used to decide whether to offer the fact-correction flow.
 */
export function looksLikeFactCorrection(note: string): boolean {
  const f = note.toLowerCase();
  return /\b(incorrect|wrong|not true|untrue|false|never|doesn'?t|does not|don'?t|do not|isn'?t|aren'?t|that'?s not how|not accurate|inaccurate|misconception|assumption|in reality|actually|factually)\b/.test(f);
}
