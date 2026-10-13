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
 * Persistence: a per-workspace row in the `studio_state` table (key
 * `training`), reached through the repository layer.
 */
import { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import { retrieveForQuestion, type GroundingItem } from "../retrieval/ground";
import { loadStyleGuide, renderStyleGuide, addStyleRules } from "./style-guide";
import {
  loadGlobalInstructions,
  renderGlobalInstructions,
  detectInstructionConflict,
  updateGlobalInstruction,
  type InstructionConflict,
} from "./global-instructions";
import { loadSavedPosts, renderSavedExemplars, savePost, getSavedPost, type SavedTurn } from "./saved-posts";
import { loadLabFacts, renderLabFacts, addLabFacts } from "./lab-facts";
import { loadAudienceModel, renderAudienceModel, addAudienceNotes } from "./audience";
import { routeCorrection, looksLikeCorrection, type CorrectionProposal, type CorrectionCategory } from "./correction-router";
import { COMPANY_IDENTITY, renderProductIdentity, type Product } from "./products";

export interface TrainingDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
  /** The product this Studio session is writing for. */
  product: Product;
}

export interface TrainingCitation {
  marker: number;
  itemId: string;
  title: string;
  entityType: string;
}

export interface TrainingPost {
  id: string;
  /**
   * The topic/prompt this post was built on, e.g.
   * "draft a post for senior lab analysts about efficient workflows".
   * Either typed by the user or auto-chosen by the AI. "Redo body" reuses it.
   */
  topic: string;
  theme: string;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
  citations: TrainingCitation[];
  /** Rendered post graphic as a PNG data URL (filled in after body gen). */
  image?: string | null;
  /**
   * When a "redo body" note was a CORRECTION (not a one-off tweak), the router
   * classifies it and proposes a durable knowledge update for the user to
   * confirm. NOT yet applied (corrections are never auto-applied). Null when
   * the note wasn't a correction.
   */
  correctionProposal?: CorrectionProposal | null;
  createdAt: string;
}

/**
 * One turn in a post's CONVERSATION. A post is a chat you keep refining: the
 * timeline alternates between your prompts and the AI's outputs. This is BOTH
 * what the UI shows (so you see every prompt you gave) and the revision chain
 * fed back into each redo (so corrections compound).
 *
 * roles:
 *   "user"      — something you typed: the initial topic, a body feedback, a
 *                 media direction. `channel` says which control it came from.
 *   "assistant" — what the AI produced: a body rewrite or a new graphic.
 */
export interface PostTurn {
  /** Stable id, so the UI can target a turn (e.g. to revert to it). */
  id: string;
  role: "user" | "assistant";
  /** Which part of the post this turn concerns. */
  channel: "topic" | "body" | "media";
  /** The text: the user's instruction, or a short label of the AI output. */
  text: string;
  /** For assistant body turns, the resulting body (so reopening restores it). */
  body?: string;
  /** For assistant body turns, the body BEFORE this change (for before/after). */
  prevBody?: string;
  /** For assistant media turns, the resulting image data URL. */
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
  /** The product this training/playground state belongs to (per-product state). */
  productId: string;
  history: TrainingRecord[];
  /** The post currently open in the Playground. */
  pending: TrainingPost | null;
  /**
   * The current post's CONVERSATION timeline (prompts + outputs), newest last.
   * Shown in the UI and used as the revision chain for redos. Reset on a new
   * post; restored when a saved post is reopened.
   */
  turns: PostTurn[];
  /**
   * A one-shot preference to apply to the NEXT generated post only (chosen by
   * the user via "apply to this post only" when a feedback conflicted with a
   * global instruction). Consumed on the next generation, then cleared.
   */
  nextPostOverride: string | null;
  updatedAt: string;
}

export interface GenerateTrainingInput {
  /**
   * The explicit topic/prompt to build the post on, e.g.
   * "draft a post for senior lab analysts about efficient workflows and easier
   * handoffs". If empty, the AI auto-picks a topic (rotating through angles).
   */
  topic?: string;
  /**
   * "Redo body": reuse the CURRENT pending post's topic to rewrite the copy,
   * and keep its media. When true, `topic` is ignored in favor of the pending
   * post's topic (unless the pending post has none).
   */
  keepTopic?: boolean;
  /**
   * A one-off instruction for THIS generation only, e.g. the body-feedback from
   * the "Body" section ("make the hook punchier", "cut the last line"). Injected
   * as a post-specific override; not learned as a durable rule.
   */
  note?: string;
  /**
   * @deprecated use `topic`. Kept so older callers/tests still compile.
   */
  focus?: string;
}

export interface SubmitFeedbackInput {
  postId: string;
  theme: string;
  body: string;
  rating: number;
  feedback?: string;
}

export interface InstructionConflictChoice {
  /** The candidate rule distilled from feedback that triggered the conflict. */
  candidateRule: string;
  conflict: InstructionConflict;
}

export interface SubmitFeedbackResult {
  /** Rules that applied cleanly (no conflict) and were added to the style guide. */
  learnedRules: string[];
  history: TrainingRecord[];
  /**
   * Rules that CONTRADICT a global instruction. These are NOT applied. The UI
   * must ask the user, per conflict, to either apply it to the next post only
   * or update the global instruction. Resolved via resolveInstructionConflict.
   */
  conflicts: InstructionConflictChoice[];
}

export async function loadTraining(workspaceId: string, productId: string): Promise<TrainingState> {
  const value = await new Repositories().getStudioState<TrainingState>(workspaceId, trainingKey(productId));
  if (value && Array.isArray(value.history)) {
    return {
      workspaceId,
      productId,
      history: value.history,
      pending: value.pending ?? null,
      turns: Array.isArray(value.turns) ? value.turns : [],
      nextPostOverride: typeof value.nextPostOverride === "string" ? value.nextPostOverride : null,
      updatedAt: value.updatedAt,
    };
  }
  return { workspaceId, productId, history: [], pending: null, turns: [], nextPostOverride: null, updatedAt: new Date().toISOString() };
}

/** Per-product studio_state key for the training/playground state. */
function trainingKey(productId: string): string {
  return `training:${productId}`;
}

async function saveTraining(state: TrainingState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await new Repositories().setStudioState(state.workspaceId, trainingKey(state.productId), state);
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

/**
 * Strip inline grounding markers like "[10]" or "[2, 4]" from the FINAL copy.
 * The model is told to cite claims with [n] so we can map them to knowledge
 * items (stored separately as citations), but these brackets must never appear
 * in the published post. Also tidies the spacing/punctuation the removal leaves
 * behind (e.g. "tracking [10]," -> "tracking,").
 */
export function stripCitationMarkers(text: string): string {
  return text
    // remove [10], [2,4], [ 3 ] etc. (one or more numbers, optional spaces/commas)
    .replace(/\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
    // a leftover space before punctuation ("word ." -> "word.")
    .replace(/[ \t]+([.?!,:;])/g, "$1")
    // collapse any double spaces the removal created, within a line only
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

/** Count words in a post body (whitespace-separated tokens). For UI display. */
export function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** True if two bodies are the same once whitespace/case/punctuation are ignored. */
function normalizedEquals(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

export interface LengthIntent {
  dir: "longer" | "shorter";
  /** Target word count derived from the current length + how strong the ask is. */
  targetWords: number;
  /** A minimum change we require the result to actually move, to count as compliant. */
  minDeltaWords: number;
}

/**
 * Detect a length/detail instruction and translate it into a CONCRETE word
 * target relative to the current post. Vague asks ("a bit longer", "add more
 * detail") become real numbers so the prompt can state them and the guard can
 * verify them. Returns null when the instruction isn't about length.
 */
export function detectLengthIntent(note: string, currentWords: number): LengthIntent | null {
  const f = note.toLowerCase();

  // Explicit "to N words" wins.
  const explicit = f.match(/(\d{2,4})\s*words?/);
  if (explicit) {
    const target = parseInt(explicit[1], 10);
    if (Number.isFinite(target) && target > 0) {
      return { dir: target >= currentWords ? "longer" : "shorter", targetWords: target, minDeltaWords: Math.max(10, Math.round(Math.abs(target - currentWords) * 0.5)) };
    }
  }

  const longer = /\b(longer|more detail|more detailed|add more|expand|flesh (it|this) out|elaborate|go deeper|too short|beef (it|this) up|more depth|add context)\b/.test(f);
  const shorter = /\b(shorter|too long|too lengthy|cut (it|this) down|trim|tighten|more concise|less wordy|condense|punchier length)\b/.test(f);
  if (!longer && !shorter) return null;

  // Strength: "a bit"/"slightly" = gentle, "much"/"way"/"a lot" = strong.
  const gentle = /\b(a bit|slightly|a little|a touch|somewhat)\b/.test(f);
  const strong = /\b(much|way|a lot|significantly|considerably|far)\b/.test(f);

  if (longer) {
    const factor = strong ? 1.8 : gentle ? 1.35 : 1.55;
    const target = Math.max(currentWords + 20, Math.round(currentWords * factor));
    return { dir: "longer", targetWords: target, minDeltaWords: Math.max(15, Math.round(currentWords * 0.2)) };
  }
  const factor = strong ? 0.5 : gentle ? 0.8 : 0.65;
  const target = Math.max(25, Math.round(currentWords * factor));
  return { dir: "shorter", targetWords: target, minDeltaWords: Math.max(15, Math.round(currentWords * 0.2)) };
}

/** The first sentence/line of a body, for quoting back in a retry. */
function firstSentence(body: string): string {
  const firstLine = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const m = firstLine.match(/^.*?[.?!](\s|$)/);
  return (m ? m[0] : firstLine).trim();
}

/** True if two bodies begin with the same opening words (ignoring case/punct). */
function sameOpening(a: string, b: string, words = 6): boolean {
  const open = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, words).join(" ");
  const oa = open(a);
  const ob = open(b);
  return oa.length > 0 && oa === ob;
}

/** A rotating set of PRODUCT-NEUTRAL angles so posts aren't all the same topic.
 *  The specific subject comes from the active product's knowledge, not here. */
const ANGLES = [
  "a specific feature and the exact problem it removes",
  "a real workflow step the user performs and how it works",
  "a compliance or regulatory detail the product handles",
  "a commercial or operational capability",
  "a configuration/setup reality (templates, workflows, roles)",
  "an integration or data capability",
  "a before/after contrast of a daily frustration the product fixes",
  "a positioning point about who the product is built for",
];

// The task-specific tail. The BASE writing policy now comes from the editable
// GLOBAL INSTRUCTIONS (see ./global-instructions), rendered and prepended at
// generation time. This tail only describes the training TASK + output shape.
function trainTask(product: Product): string {
  return `TASK: Write ONE LinkedIn post for ${product.name}. This is a training round, the user will rate it and teach you their taste.
Follow the GLOBAL WRITING INSTRUCTIONS above and the LEARNED STYLE GUIDE if present. Study the RATED EXAMPLES: write MORE like the high-rated ones, and AVOID what made the low-rated ones weak.
Also return "topic": a single clear sentence describing what this post is about and who it's for, phrased as a prompt a person would write (e.g. "Faster result handoffs, aimed at senior analysts"). This is the working prompt the user will see and can edit.
OUTPUT ONLY JSON: { "topic": string, "theme": string, "body": string, "hashtags": string[], "citationMarkers": number[] }`;
}

/**
 * Build the full training system prompt: COMPANY identity + PRODUCT identity +
 * grounding (global instructions, lab facts, audience) + the task tail. An
 * optional one-shot override is appended last.
 */
function buildTrainSystem(product: Product, groundingBlocks: string[], oneShotOverride: string | null): string {
  const parts = [
    COMPANY_IDENTITY,
    renderProductIdentity(product),
    ...groundingBlocks.filter(Boolean),
    trainTask(product),
  ];
  let sys = parts.join("\n\n");
  if (oneShotOverride && oneShotOverride.trim()) {
    sys += `\n\nFOR THIS POST ONLY (a one-time instruction that overrides the global instructions where they conflict): ${oneShotOverride.trim()}`;
  }
  return sys;
}

export async function generateTrainingPost(input: GenerateTrainingInput, deps: TrainingDeps): Promise<TrainingPost> {
  const state = await loadTraining(deps.workspaceId, deps.product.id);

  // Resolve the TOPIC — the explicit prompt the post is built on.
  //  1. "Redo body": reuse the current pending post's topic (same subject, new copy).
  //  2. An explicit topic typed by the user.
  //  3. Otherwise the AI auto-picks: rotate through ANGLES, avoiding recent themes.
  const recentThemes = state.history.slice(-6).map((h) => h.theme.toLowerCase());
  const typedTopic = (input.topic ?? input.focus ?? "").trim();
  let topic: string;
  if (input.keepTopic && state.pending?.topic?.trim()) {
    topic = state.pending.topic.trim();
  } else if (typedTopic) {
    topic = typedTopic;
  } else {
    topic = ANGLES[state.history.length % ANGLES.length];
  }
  const angle = topic;

  const query = `${angle} ${deps.product.name} ${deps.product.oneLiner} features workflows capabilities positioning`;
  const items = await retrieveForQuestion(query, { ...deps, productId: deps.product.id });
  const supported = items.filter((i) => i.sources.length > 0);
  if (supported.length === 0) {
    throw new Error("No grounded knowledge to train on yet — ingest material first.");
  }
  const validMarkers = new Set(items.map((i) => i.marker));
  const knowledge = buildKnowledgeContext(items);
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId, deps.product.id));
  const globalBlock = renderGlobalInstructions(await loadGlobalInstructions(deps.workspaceId));
  const savedBlock = renderSavedExemplars(await loadSavedPosts(deps.workspaceId, deps.product.id));
  const labFactsBlock = renderLabFacts(await loadLabFacts(deps.workspaceId));
  const audienceBlock = renderAudienceModel(await loadAudienceModel(deps.workspaceId));
  // Grounding blocks framing every generation (order = priority).
  const groundingBlocks = [globalBlock, labFactsBlock, audienceBlock];

  // Consume any one-shot "apply to this post only" override, then clear it so
  // it never leaks into subsequent posts. A per-call `note` (e.g. body-section
  // feedback like "punchier hook") is also applied to just this generation.
  const storedOverride = state.nextPostOverride;
  if (storedOverride) state.nextPostOverride = null;
  const noteOverride = input.note?.trim() || null;
  const oneShotOverride = [storedOverride, noteOverride].filter(Boolean).join(" ") || null;

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

  // "Redo body" with feedback is a REVISION, not a from-scratch write. Show the
  // model the exact draft it must fix and make the instruction the primary
  // task, right next to the current copy. Writing from scratch ignores the
  // feedback because it has nothing concrete to change. We also drop the
  // rated-examples/avoid-themes noise so the fix stays targeted.
  const isRevision = Boolean(input.keepTopic && noteOverride && state.pending?.body?.trim());

  // If the revision instruction is about length/detail, turn it into a concrete
  // word target so the model has a number to hit (vague asks like "a bit longer"
  // are otherwise ignored) and the guard below can verify it.
  const currentWords = state.pending?.body ? wordCount(state.pending.body) : 0;
  const lengthIntent = isRevision && noteOverride ? detectLengthIntent(noteOverride, currentWords) : null;

  // Full revision chain for the CURRENT pending post, so corrections compound:
  // every prior body instruction stays in force while applying the newest one.
  // Reset on a new post (turns cleared below in that branch).
  const priorBodyNotes = input.keepTopic
    ? state.turns.filter((t) => t.role === "user" && t.channel === "body").map((t) => t.text)
    : [];
  const chainBlock = priorBodyNotes.length
    ? `REVISION HISTORY FOR THIS POST (apply ALL of these cumulatively, newest instruction last; earlier instructions still hold):\n` +
      priorBodyNotes.map((note, i) => `${i + 1}. You were told: "${note}"`).join("\n")
    : "";

  let user: string;
  if (isRevision) {
    const current = state.pending!.body.trim();
    const lengthClause = lengthIntent
      ? `\n\nLENGTH TARGET (required): the current post is about ${currentWords} words. Make the revision approximately ${lengthIntent.targetWords} words (${lengthIntent.dir}). ${lengthIntent.dir === "longer" ? "Add concrete, grounded detail, do not pad with filler or repeat points." : "Cut words while keeping the core point."}`
      : "";
    user =
      `${savedBlock ? savedBlock + "\n\n" : ""}${styleBlock ? styleBlock + "\n\n" : ""}` +
      `${chainBlock ? chainBlock + "\n\n" : ""}` +
      `KNOWLEDGE (cite by [n]):\n${knowledge}\n\n` +
      `CURRENT POST (revise THIS, keep the topic the same):\n${current}\n\n` +
      `NEWEST REVISION INSTRUCTION, this is the point of the task, apply it fully WITHOUT undoing the earlier instructions above:\n${noteOverride}${lengthClause}\n\n` +
      `Rewrite the post so all instructions are satisfied. Change the opening and framing as needed to obey them. Do NOT reproduce the parts any instruction told you to remove. Keep it grounded in the KNOWLEDGE. OUTPUT ONLY JSON.`;
  } else {
    user =
      `${savedBlock ? savedBlock + "\n\n" : ""}${styleBlock ? styleBlock + "\n\n" : ""}${examplesBlock}${avoidThemes}` +
      `ANGLE FOR THIS POST: ${angle}\n\n` +
      `KNOWLEDGE (cite by [n]):\n${knowledge}\n\nWrite one post now.`;
  }

  const res = await deps.provider.chat(
    [
      { role: "system", content: buildTrainSystem(deps.product, groundingBlocks, isRevision ? null : oneShotOverride) },
      { role: "user", content: user },
    ],
    { temperature: isRevision ? 0.6 : 0.75, maxTokens: 2000 },
  );

  let theme = angle;
  // The readable working topic. Keep the user's typed topic verbatim; otherwise
  // use the model's returned topic (falls back to the angle/theme below).
  let modelTopic = "";
  let body = "";
  let hashtags: string[] = [];
  let markers: number[] = [];
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
    if (typeof raw.topic === "string" && raw.topic.trim()) modelTopic = raw.topic.trim();
    body = String(raw.body ?? "").trim();
    hashtags = Array.isArray(raw.hashtags) ? (raw.hashtags as unknown[]).map(String).filter(Boolean) : [];
    markers = Array.isArray(raw.citationMarkers)
      ? (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m))
      : [];
  } catch {
    body = res.text.trim();
  }

  // Deterministic scrubs on the FINAL copy: strip inline [n] grounding markers
  // (citations are tracked separately) and remove em/en dashes. The model is
  // told both in the prompt; these guarantee it regardless of what came back.
  body = stripCitationMarkers(stripDashes(body));

  // Revision guard: detect when "redo body" ignored the instruction and retry
  // ONCE with a blunter, more concrete prompt. Failure signals:
  //   (a) the post barely changed, or it reused the opening the user reacted to
  //   (b) a length/detail instruction wasn't honored (e.g. "a bit longer" came
  //       back the same length).
  if (isRevision && state.pending?.body) {
    const openingFail = normalizedEquals(body, state.pending.body) || sameOpening(body, state.pending.body);

    let lengthFail = false;
    if (lengthIntent) {
      const nowWords = wordCount(body);
      if (lengthIntent.dir === "longer") {
        lengthFail = nowWords < currentWords + lengthIntent.minDeltaWords;
      } else {
        lengthFail = nowWords > currentWords - lengthIntent.minDeltaWords;
      }
    }

    if (openingFail || lengthFail) {
      const reasons: string[] = [];
      if (openingFail) reasons.push(`you returned essentially the same post`);
      if (lengthFail) reasons.push(`you did not change the length as asked (it is still about ${wordCount(body)} words)`);

      const hardReqs: string[] = [`- Fully apply the instruction: ${noteOverride}`];
      if (openingFail) hardReqs.push(`- Do NOT open with or reuse this: "${firstSentence(state.pending.body)}"`);
      if (lengthIntent) {
        hardReqs.push(
          lengthIntent.dir === "longer"
            ? `- Make it clearly LONGER: aim for ~${lengthIntent.targetWords} words (currently ~${currentWords}). Add concrete, grounded detail, no filler or repetition.`
            : `- Make it clearly SHORTER: aim for ~${lengthIntent.targetWords} words (currently ~${currentWords}). Cut words, keep the core point.`,
        );
      }
      hardReqs.push(`- Keep it grounded in the KNOWLEDGE and on the same topic.`);

      const retryUser =
        `${styleBlock ? styleBlock + "\n\n" : ""}KNOWLEDGE (cite by [n]):\n${knowledge}\n\n` +
        `You were asked to revise this post with the instruction: "${noteOverride}". That failed because ${reasons.join(" and ")}, which is wrong.\n\n` +
        `CURRENT POST:\n${state.pending.body.trim()}\n\n` +
        `Hard requirements:\n${hardReqs.join("\n")}\n` +
        `OUTPUT ONLY JSON.`;
      const retry = await deps.provider.chat(
        [
          { role: "system", content: buildTrainSystem(deps.product, groundingBlocks, null) },
          { role: "user", content: retryUser },
        ],
        { temperature: 0.8, maxTokens: 2000 },
      );
      try {
        const raw = parseJsonLoose(retry.text) as Record<string, unknown>;
        const retryBody = stripCitationMarkers(stripDashes(String(raw.body ?? "").trim()));
        // Accept the retry only if it actually improves on the failure.
        const retryWords = wordCount(retryBody);
        const retryOpeningOk = !normalizedEquals(retryBody, state.pending.body) && !sameOpening(retryBody, state.pending.body);
        const retryLengthOk =
          !lengthIntent ||
          (lengthIntent.dir === "longer"
            ? retryWords >= currentWords + lengthIntent.minDeltaWords
            : retryWords <= currentWords - lengthIntent.minDeltaWords);
        const better = retryBody && (openingFail ? retryOpeningOk : true) && (lengthFail ? retryLengthOk : true);
        if (better) {
          body = retryBody;
          if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
          if (Array.isArray(raw.hashtags)) hashtags = (raw.hashtags as unknown[]).map(String).filter(Boolean);
          if (Array.isArray(raw.citationMarkers)) {
            markers = (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m));
          }
        }
      } catch {
        // keep the first result if the retry is unparseable
      }
    }
  }

  const byMarker = new Map(items.map((i) => [i.marker, i]));
  const citations: TrainingCitation[] = [...new Set(markers)]
    .map((m) => byMarker.get(m))
    .filter((i): i is GroundingItem => Boolean(i))
    .map((i) => ({ marker: i.marker, itemId: i.id, title: i.title, entityType: i.entityType }));

  // On "redo body" keep the existing media so only the copy changes.
  const carriedImage = input.keepTopic ? state.pending?.image ?? null : null;

  // If this redo-body note looks like a CORRECTION (not a one-off tweak), run it
  // through the router: classify it (product / world / audience / style) and
  // propose a durable update. Propose only, the user confirms before anything
  // is written anywhere.
  let correctionProposal: CorrectionProposal | null = null;
  if (isRevision && noteOverride && state.pending?.body && looksLikeCorrection(noteOverride)) {
    correctionProposal = await routeCorrection(noteOverride, state.pending.body, deps.provider, deps.product.name);
  }

  // The working topic shown to the user: keep what they typed / the kept topic;
  // but when the AI auto-picked (a raw ANGLE), prefer the model's readable topic.
  const usedTypedTopic = Boolean(input.keepTopic || typedTopic);
  const displayTopic = usedTypedTopic ? topic : (modelTopic || theme || topic);

  const post: TrainingPost = {
    id: `t_${Date.now().toString(36)}`,
    topic: displayTopic,
    theme,
    body,
    hashtags,
    citationMarkers: markers,
    citations,
    image: carriedImage,
    correctionProposal,
    createdAt: new Date().toISOString(),
  };

  state.pending = post;
  // Maintain the post's conversation timeline (shown in the UI AND used as the
  // revision chain). A fresh post starts a new conversation; a redo-body appends
  // the user's note + the AI's new body.
  const ts = new Date().toISOString();
  const prevBody = state.pending?.body ?? "";
  if (input.keepTopic) {
    const appended: PostTurn[] = [];
    if (noteOverride) appended.push({ id: turnId(), role: "user", channel: "body", text: noteOverride, createdAt: ts });
    appended.push({ id: turnId(), role: "assistant", channel: "body", text: "Rewrote the copy", body, prevBody, createdAt: ts });
    state.turns = [...state.turns, ...appended].slice(-40);
  } else {
    // New post: start the conversation with the (readable) topic + first output.
    // Prefix auto-chosen topics so it's clear the AI picked them.
    const topicTurnText = usedTypedTopic ? displayTopic : `(AI chose) ${displayTopic}`;
    state.turns = [
      { id: turnId(), role: "user", channel: "topic", text: topicTurnText || "Auto-generated topic", createdAt: ts },
      { id: turnId(), role: "assistant", channel: "body", text: "Drafted the post", body, prevBody: "", createdAt: ts },
    ];
  }
  await saveTraining(state);
  return post;
}

let _turnSeq = 0;
function turnId(): string {
  return `tn_${Date.now().toString(36)}_${(_turnSeq++).toString(36)}`;
}

/**
 * Revert the current post's body to the output of an earlier assistant turn.
 * The preview (pending body) becomes that earlier copy, and a turn is appended
 * recording the revert so the history stays honest. Returns the new state.
 */
export async function revertToTurn(workspaceId: string, productId: string, turnId_: string): Promise<TrainingState> {
  const state = await loadTraining(workspaceId, productId);
  if (!state.pending) throw new Error("no active post");
  const target = state.turns.find((t) => t.id === turnId_ && t.role === "assistant" && t.channel === "body");
  if (!target || typeof target.body !== "string") throw new Error("cannot revert to that turn");

  const prevBody = state.pending.body;
  if (target.body === prevBody) return state; // already there

  state.pending.body = target.body;
  const ts = new Date().toISOString();
  const appended: PostTurn[] = [
    { id: turnId(), role: "user", channel: "body", text: "Reverted to an earlier version", createdAt: ts },
    { id: turnId(), role: "assistant", channel: "body", text: "Restored earlier copy", body: target.body, prevBody, createdAt: ts },
  ];
  state.turns = [...state.turns, ...appended].slice(-40);
  await saveTraining(state);
  return state;
}

/**
 * Manually edit an assistant body turn's text VERBATIM (inline edit in the
 * chat). No model call: the edited text becomes the current copy exactly as
 * typed, with only the deterministic typographic scrubs applied. The edited
 * turn's stored body is updated so the bubble reflects it.
 */
export async function editTurnBody(workspaceId: string, productId: string, turnId_: string, newBody: string): Promise<TrainingState> {
  const state = await loadTraining(workspaceId, productId);
  if (!state.pending) throw new Error("no active post");
  const target = state.turns.find((t) => t.id === turnId_ && t.role === "assistant" && t.channel === "body");
  if (!target) throw new Error("cannot edit that turn");

  const cleaned = stripCitationMarkers(stripDashes(newBody.trim()));
  if (!cleaned) return state;

  // Update the edited turn's body in place.
  target.body = cleaned;
  // The edited copy becomes the current post body.
  state.pending.body = cleaned;
  await saveTraining(state);
  return state;
}

/** Record a media redo in the post's conversation timeline. */
export async function recordMediaRevision(workspaceId: string, productId: string, note: string, image?: string | null): Promise<void> {
  const state = await loadTraining(workspaceId, productId);
  const ts = new Date().toISOString();
  const appended: PostTurn[] = [];
  if (note.trim()) appended.push({ id: turnId(), role: "user", channel: "media", text: note.trim(), createdAt: ts });
  appended.push({ id: turnId(), role: "assistant", channel: "media", text: "Regenerated the graphic", image: image ?? null, createdAt: ts });
  state.turns = [...state.turns, ...appended].slice(-40);
  await saveTraining(state);
}

export interface ConfirmCorrectionRouteInput {
  category: CorrectionCategory;
  /** The durable statement to remember (truth / rule / audience note / product fact). */
  statement: string;
  /** For "world": the misconception to avoid. */
  avoid?: string;
  /** The original user note, for provenance. */
  note?: string;
}

/**
 * Apply a confirmed correction to the STUDIO-OWNED destinations:
 *   world    → lab facts (truth + avoid)
 *   audience → audience model
 *   style    → style guide
 * The "product" category is NOT handled here — it routes into the real
 * knowledge_items graph and is orchestrated by BrainService (which owns the
 * conversation/correction machinery). Returns true if handled here.
 */
export async function applyStudioCorrection(input: ConfirmCorrectionRouteInput, deps: TrainingDeps): Promise<boolean> {
  const source = `correction (training)${input.note ? `: ${input.note}` : ""}`;
  switch (input.category) {
    case "world": {
      const additions: Array<{ statement: string; kind: "truth" | "avoid"; source: string }> = [];
      if (input.statement.trim()) additions.push({ statement: input.statement.trim(), kind: "truth", source });
      if (input.avoid?.trim()) additions.push({ statement: input.avoid.trim(), kind: "avoid", source });
      if (additions.length) await addLabFacts(deps.workspaceId, additions);
      return true;
    }
    case "audience": {
      if (input.statement.trim()) await addAudienceNotes(deps.workspaceId, [{ statement: input.statement.trim(), source }]);
      return true;
    }
    case "style": {
      if (input.statement.trim()) await addStyleRules(deps.workspaceId, deps.product.id, [{ rule: input.statement.trim(), source }]);
      return true;
    }
    default:
      return false; // "product" handled by the service; "oneoff" has nothing to do
  }
}

const DISTILL_SYSTEM = `You turn a user's rating + feedback on a LinkedIn post into DURABLE, REUSABLE writing rules for future posts about "Sampleify".
Given the post, a 1-10 rating, and optional feedback, output 0-3 concise rules that would make future posts score higher. Each rule is a general guideline (not specific to this post's topic), e.g. "Open with a concrete number before any framing", "Cut the closing CTA, end on the capability".
If the rating is high and there's no actionable lesson, return an empty list.
OUTPUT ONLY JSON: { "rules": string[] }`;

export async function submitTrainingFeedback(
  input: SubmitFeedbackInput,
  deps: TrainingDeps,
): Promise<SubmitFeedbackResult> {
  const state = await loadTraining(deps.workspaceId, deps.product.id);

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

  const learnedRules: string[] = [];
  const conflicts: InstructionConflictChoice[] = [];

  // Distill durable rules when there's signal: low score, or any written feedback.
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
        // Before adding a distilled rule to the durable style guide, check it
        // against the editable GLOBAL INSTRUCTIONS. A rule that contradicts a
        // global instruction is NOT applied silently (and does not just fight
        // the prompt). Instead it is surfaced to the user, who decides: apply
        // to the next post only, or update the global instruction.
        const gi = await loadGlobalInstructions(deps.workspaceId);
        const clean: Array<{ rule: string; source: string }> = [];
        for (const rule of rules) {
          const conflict = await detectInstructionConflict(rule, gi, deps.provider);
          if (conflict) {
            conflicts.push({ candidateRule: rule, conflict });
          } else {
            clean.push({
              rule,
              source: `training rating ${record.rating}/10${record.feedback ? `: ${record.feedback}` : ""}`,
            });
          }
        }
        if (clean.length) {
          await addStyleRules(deps.workspaceId, deps.product.id, clean);
          learnedRules.push(...clean.map((c) => c.rule));
        }
      }
    } catch {
      // non-fatal; rating is still archived
    }
  }

  return { learnedRules, history: state.history, conflicts };
}

export type ConflictResolution = "this_post_only" | "update_global";

export interface ResolveConflictInput {
  resolution: ConflictResolution;
  candidateRule: string;
  /** Required for "update_global": the global instruction to rewrite. */
  instructionId?: string;
  /**
   * The new text for the global instruction (for "update_global"). If omitted,
   * the candidate rule is appended to the existing instruction text.
   */
  newInstructionText?: string;
}

/**
 * Resolve a conflict the user was asked about.
 *  - "this_post_only": stash the candidate as a one-shot override applied to the
 *     NEXT generated post only (then auto-cleared). Globals untouched.
 *  - "update_global": rewrite the conflicting global instruction so the policy
 *     itself changes going forward. Also recorded in the durable style guide.
 */
export async function resolveInstructionConflict(
  input: ResolveConflictInput,
  deps: TrainingDeps,
): Promise<{ ok: true; applied: ConflictResolution }> {
  if (input.resolution === "this_post_only") {
    const state = await loadTraining(deps.workspaceId, deps.product.id);
    // Compose with any existing override so multiple one-shots stack for the next post.
    state.nextPostOverride = state.nextPostOverride
      ? `${state.nextPostOverride} ${input.candidateRule.trim()}`
      : input.candidateRule.trim();
    await saveTraining(state);
    return { ok: true, applied: "this_post_only" };
  }

  // update_global
  if (!input.instructionId) throw new Error("instructionId is required to update a global instruction");
  const gi = await loadGlobalInstructions(deps.workspaceId);
  const existing = gi.instructions.find((i) => i.id === input.instructionId);
  const text =
    input.newInstructionText?.trim() ||
    (existing ? `${existing.text} ${input.candidateRule.trim()}` : input.candidateRule.trim());
  await updateGlobalInstruction(deps.workspaceId, input.instructionId, { text });
  return { ok: true, applied: "update_global" };
}

export async function resetTraining(workspaceId: string, productId: string): Promise<void> {
  await saveTraining({ workspaceId, productId, history: [], pending: null, turns: [], nextPostOverride: null, updatedAt: new Date().toISOString() });
}

/** Attach a generated graphic (PNG data URL) to the current pending post. */
export async function setPendingGraphic(workspaceId: string, productId: string, postId: string, image: string): Promise<void> {
  const state = await loadTraining(workspaceId, productId);
  if (state.pending && state.pending.id === postId) {
    state.pending.image = image;
    await saveTraining(state);
  }
}

/**
 * Snapshot the CURRENT active post (body + topic + image + full conversation)
 * into saved posts. Upserts, so re-saving a refined post updates it in place.
 * Returns true if there was a post to save.
 */
export async function saveCurrentPost(workspaceId: string, productId: string, note?: string): Promise<boolean> {
  const state = await loadTraining(workspaceId, productId);
  if (!state.pending) return false;
  await savePost(workspaceId, productId, {
    body: state.pending.body,
    topic: state.pending.topic,
    theme: state.pending.theme,
    hashtags: state.pending.hashtags,
    image: state.pending.image ?? null,
    turns: state.turns as SavedTurn[],
    note,
    source: "training",
  });
  return true;
}

/**
 * Open a saved post back into the Playground as the active post, restoring its
 * whole conversation. The current active post (if any) is auto-saved first so
 * nothing is lost when switching.
 */
export async function openSavedPost(savedId: string, deps: TrainingDeps): Promise<TrainingState> {
  // Auto-save whatever is currently open, so switching never loses work.
  await saveCurrentPost(deps.workspaceId, deps.product.id);

  const saved = await getSavedPost(deps.workspaceId, deps.product.id, savedId);
  if (!saved) throw new Error("saved post not found");

  const state = await loadTraining(deps.workspaceId, deps.product.id);
  const turns: PostTurn[] = (saved.turns ?? []).map((t) => ({
    id: turnId(),
    role: t.role,
    channel: t.channel,
    text: t.text,
    body: t.body,
    prevBody: t.prevBody,
    image: t.image,
    createdAt: t.createdAt,
  }));
  // If the saved post predates conversation storage, seed a minimal timeline.
  if (turns.length === 0) {
    const ts = saved.createdAt || new Date().toISOString();
    turns.push({ id: turnId(), role: "user", channel: "topic", text: saved.topic || saved.theme || "Saved post", createdAt: ts });
    turns.push({ id: turnId(), role: "assistant", channel: "body", text: "Saved draft", body: saved.body, prevBody: "", createdAt: ts });
  }

  state.pending = {
    id: `t_${Date.now().toString(36)}`,
    topic: saved.topic ?? saved.theme ?? "",
    theme: saved.theme ?? "",
    body: saved.body,
    hashtags: saved.hashtags ?? [],
    citationMarkers: [],
    citations: [],
    image: saved.image ?? null,
    correctionProposal: null,
    createdAt: new Date().toISOString(),
  };
  state.turns = turns;
  await saveTraining(state);
  return state;
}
