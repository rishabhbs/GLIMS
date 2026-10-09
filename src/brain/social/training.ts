/**
 * Training mode — a "tinder for posts" loop.
 *
 * The Studio generates ONE grounded post at a time. The user rates it (overall
 * 1-10) and optionally leaves feedback. Each rating teaches the Studio: strong
 * signals are distilled into durable style rules (the SAME style-memory used by
 * the calendar), and the running history of rated posts is fed back into the
 * next generation as "more like the high-rated ones, less like the low-rated
 * ones". Taste compounds across the session and persists.
 *
 * Persistence: a per-workspace JSON file under .studio (no DB migration).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import { retrieveForQuestion, type GroundingItem } from "../retrieval/ground";
import { loadStyleGuide, renderStyleGuide, addStyleRules } from "./style-guide";

export interface TrainingDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
}

export interface TrainingCitation {
  marker: number;
  itemId: string;
  title: string;
  entityType: string;
}

export interface TrainingPost {
  id: string;
  theme: string;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
  citations: TrainingCitation[];
  /** Rendered post graphic as a PNG data URL (filled in after body gen). */
  image?: string | null;
  createdAt: string;
}

/** A rated, archived training round. */
export interface TrainingRecord {
  id: string;
  theme: string;
  body: string;
  rating: number;        // 1-10
  feedback: string;      // free-form notes, may be empty
  createdAt: string;
}

export interface TrainingState {
  workspaceId: string;
  history: TrainingRecord[];
  /** The post currently awaiting a rating (not yet archived). */
  pending: TrainingPost | null;
  updatedAt: string;
}

export interface GenerateTrainingInput {
  /** Optional nudge, e.g. "focus on compliance" or "" for free choice. */
  focus?: string;
}

export interface SubmitFeedbackInput {
  postId: string;
  theme: string;
  body: string;
  rating: number;
  feedback?: string;
}

export interface SubmitFeedbackResult {
  learnedRules: string[];
  history: TrainingRecord[];
}

const DIR = path.join(process.cwd(), ".studio");

function fileFor(workspaceId: string) {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DIR, `training.${safe}.json`);
}

export async function loadTraining(workspaceId: string): Promise<TrainingState> {
  try {
    const raw = await fs.readFile(fileFor(workspaceId), "utf8");
    const parsed = JSON.parse(raw) as TrainingState;
    if (Array.isArray(parsed.history)) {
      return { workspaceId, history: parsed.history, pending: parsed.pending ?? null, updatedAt: parsed.updatedAt };
    }
  } catch {
    // none yet
  }
  return { workspaceId, history: [], pending: null, updatedAt: new Date().toISOString() };
}

async function saveTraining(state: TrainingState): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(fileFor(state.workspaceId), JSON.stringify(state, null, 2), "utf8");
}

// ── grounding helpers (shared shape with calendar) ──────────────────────────

function buildKnowledgeContext(items: GroundingItem[]): string {
  return items
    .map((it) => {
      const src = it.sources.length
        ? ` [source: ${it.sources.map((s) => s.title ?? s.type).join("; ")}]`
        : " [NO SOURCE — do not state as fact]";
      return `[${it.marker}] (${it.entityType}) ${it.claim}${src}`;
    })
    .join("\n");
}

function parseJsonLoose(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 || (last !== -1 && last < t.length - 1)) {
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
  }
  return JSON.parse(t);
}

/**
 * Remove em/en dashes, replacing with sane punctuation.
 * IMPORTANT: must NOT touch newlines — paragraph breaks (\n\n) are the whole
 * point of a scannable LinkedIn post. Only collapse spaces/tabs within a line.
 */
export function stripDashes(text: string): string {
  return text
    // em/en dash (with surrounding spaces/tabs, but not newlines) → ", "
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    // tidy punctuation the swap can create
    .replace(/,[ \t]*([.?!,:;])/g, "$1")
    // collapse runs of SPACES/TABS only (never newlines)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ,/g, ",")
    // trim trailing spaces at end of each line, keep the newlines
    .replace(/[ \t]+\n/g, "\n");
}

/** A rotating set of angles so training posts aren't all the same topic. */
const ANGLES = [
  "a specific feature and the exact problem it removes",
  "a real workflow step a lab performs and how it works",
  "a compliance/accreditation detail (NABL, ISO 17025, ULR)",
  "a commercial-side capability (inquiry, quotation, invoicing)",
  "a configuration/setup reality (sample category, templates, workflows)",
  "an instrument or inventory capability",
  "a before/after contrast of a daily lab frustration",
  "a positioning point about who Sampleify is built for",
];

const TRAIN_SYSTEM = `You write ONE LinkedIn post for "Sampleify", a LIMS, grounded ONLY in the KNOWLEDGE. This is a training round — the user will rate it and teach you their taste.
Write for a working lab owner / QA manager, not a marketing audience. Specific and concrete beats generic every time.
FORMAT LIKE A REAL LINKEDIN POST, not an essay. This is critical:
- A punchy one-line hook, then a BLANK LINE.
- Short paragraphs of 1-2 sentences each, every paragraph separated by a BLANK LINE. Never a single wall of text.
- Use literal newline characters in the "body" string (\\n between lines, \\n\\n between paragraphs). The post must have visible line breaks.
- 4-7 short blocks total for a typical post.
HARD BANS: words like streamline, robust, seamless, leverage, utilize, empower, elevate, transformative, revolutionize, game-changing, best-in-class, cutting-edge, unlock, supercharge. Shapes like "It's not X, it's Y", rhetorical-question-then-answer, "Here's the thing", starting every line the same way, forcing lists of three. Hollow CTAs ("don't miss out", "start your journey"). No em-dashes at all.
Every factual claim must be backed by a knowledge marker [n] (citationMarkers). Never invent.
Follow the LEARNED STYLE GUIDE if present. Study the RATED EXAMPLES: write MORE like the high-rated ones, and AVOID what made the low-rated ones weak.
OUTPUT ONLY JSON: { "theme": string, "body": string, "hashtags": string[], "citationMarkers": number[] }`;

export async function generateTrainingPost(input: GenerateTrainingInput, deps: TrainingDeps): Promise<TrainingPost> {
  const state = await loadTraining(deps.workspaceId);

  // Vary the angle: avoid repeating recent themes; rotate through ANGLES.
  const recentThemes = state.history.slice(-6).map((h) => h.theme.toLowerCase());
  const angle = input.focus?.trim()
    ? input.focus.trim()
    : ANGLES[state.history.length % ANGLES.length];

  const query = `${angle} Sampleify LIMS features workflows metrics compliance commercial setup`;
  const items = await retrieveForQuestion(query, deps);
  const supported = items.filter((i) => i.sources.length > 0);
  if (supported.length === 0) {
    throw new Error("No grounded knowledge to train on yet — ingest material first.");
  }
  const validMarkers = new Set(items.map((i) => i.marker));
  const knowledge = buildKnowledgeContext(items);
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId));

  // Rated examples: show the model what scored high vs low.
  const rated = state.history.slice(-8);
  const high = rated.filter((r) => r.rating >= 7);
  const low = rated.filter((r) => r.rating <= 4);
  const examplesBlock =
    (high.length
      ? `HIGH-RATED examples (write MORE like these):\n${high.map((r) => `[${r.rating}/10] ${r.body}`).join("\n---\n")}\n\n`
      : "") +
    (low.length
      ? `LOW-RATED examples (AVOID what makes these weak${low.some((r) => r.feedback) ? "; note the feedback" : ""}):\n${low
          .map((r) => `[${r.rating}/10]${r.feedback ? ` (feedback: ${r.feedback})` : ""} ${r.body}`)
          .join("\n---\n")}\n\n`
      : "");

  const avoidThemes = recentThemes.length
    ? `Do NOT repeat these recently-used themes: ${recentThemes.join("; ")}.\n`
    : "";

  const user =
    `${styleBlock ? styleBlock + "\n\n" : ""}${examplesBlock}${avoidThemes}` +
    `ANGLE FOR THIS POST: ${angle}\n\n` +
    `KNOWLEDGE (cite by [n]):\n${knowledge}\n\nWrite one post now.`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: TRAIN_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.75, maxTokens: 2000 },
  );

  let theme = angle;
  let body = "";
  let hashtags: string[] = [];
  let markers: number[] = [];
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
    body = String(raw.body ?? "").trim();
    hashtags = Array.isArray(raw.hashtags) ? (raw.hashtags as unknown[]).map(String).filter(Boolean) : [];
    markers = Array.isArray(raw.citationMarkers)
      ? (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m))
      : [];
  } catch {
    body = res.text.trim();
  }

  // Deterministic typographic scrub: no em/en dashes ever reach the screen,
  // regardless of what the model produced. Replace with grammatically sane
  // punctuation rather than just deleting.
  body = stripDashes(body);

  const byMarker = new Map(items.map((i) => [i.marker, i]));
  const citations: TrainingCitation[] = [...new Set(markers)]
    .map((m) => byMarker.get(m))
    .filter((i): i is GroundingItem => Boolean(i))
    .map((i) => ({ marker: i.marker, itemId: i.id, title: i.title, entityType: i.entityType }));

  const post: TrainingPost = {
    id: `t_${Date.now().toString(36)}`,
    theme,
    body,
    hashtags,
    citationMarkers: markers,
    citations,
    createdAt: new Date().toISOString(),
  };

  state.pending = post;
  await saveTraining(state);
  return post;
}

const DISTILL_SYSTEM = `You turn a user's rating + feedback on a LinkedIn post into DURABLE, REUSABLE writing rules for future posts about "Sampleify".
Given the post, a 1-10 rating, and optional feedback, output 0-3 concise rules that would make future posts score higher. Each rule is a general guideline (not specific to this post's topic), e.g. "Open with a concrete number before any framing", "Cut the closing CTA, end on the capability".
If the rating is high and there's no actionable lesson, return an empty list.
OUTPUT ONLY JSON: { "rules": string[] }`;

export async function submitTrainingFeedback(
  input: SubmitFeedbackInput,
  deps: TrainingDeps,
): Promise<SubmitFeedbackResult> {
  const state = await loadTraining(deps.workspaceId);

  // Archive the rated post.
  const record: TrainingRecord = {
    id: input.postId,
    theme: input.theme,
    body: input.body,
    rating: Math.max(1, Math.min(10, Math.round(input.rating))),
    feedback: input.feedback?.trim() ?? "",
    createdAt: new Date().toISOString(),
  };
  state.history.push(record);
  state.pending = null;
  if (state.history.length > 60) state.history = state.history.slice(-60);
  await saveTraining(state);

  // Distill durable rules when there's signal: low score, or any written feedback.
  const learnedRules: string[] = [];
  const hasSignal = record.rating <= 6 || record.feedback.length > 0;
  if (hasSignal) {
    const user = `POST:\n${record.body}\n\nRATING: ${record.rating}/10\nFEEDBACK: ${record.feedback || "(none given)"}\n\nDistill reusable rules.`;
    try {
      const res = await deps.provider.chat(
        [
          { role: "system", content: DISTILL_SYSTEM },
          { role: "user", content: user },
        ],
        { temperature: 0.3, maxTokens: 600 },
      );
      const raw = parseJsonLoose(res.text) as { rules?: unknown };
      const rules = Array.isArray(raw.rules) ? (raw.rules as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) : [];
      if (rules.length) {
        await addStyleRules(
          deps.workspaceId,
          rules.map((r) => ({ rule: r, source: `training rating ${record.rating}/10${record.feedback ? `: ${record.feedback}` : ""}` })),
        );
        learnedRules.push(...rules);
      }
    } catch {
      // non-fatal; rating is still archived
    }
  }

  return { learnedRules, history: state.history };
}

export async function resetTraining(workspaceId: string): Promise<void> {
  await saveTraining({ workspaceId, history: [], pending: null, updatedAt: new Date().toISOString() });
}

/** Attach a generated graphic (PNG data URL) to the current pending post. */
export async function setPendingGraphic(workspaceId: string, postId: string, image: string): Promise<void> {
  const state = await loadTraining(workspaceId);
  if (state.pending && state.pending.id === postId) {
    state.pending.image = image;
    await saveTraining(state);
  }
}
