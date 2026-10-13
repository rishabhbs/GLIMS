/**
 * Social calendar — the content-operation surface of the Brain consumer.
 *
 * Unlike the old single chat-turn model, this exposes three focused, grounded
 * operations the calendar UI calls directly:
 *   - planCalendar : fill dated slots with {date, theme, angle} across a range
 *   - draftPosts   : write full LinkedIn copy for specific slots
 *   - revisePost   : rewrite ONE post's body given a free-form instruction
 *
 * All generation is grounded in retrieved Sampleify knowledge (never invent).
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import { retrieveForQuestion, type GroundingItem } from "../retrieval/ground";
import { loadStyleGuide, addStyleRules, renderStyleGuide } from "./style-guide";
import { stripDashes, stripCitationMarkers } from "./training";
import {
  loadGlobalInstructions,
  renderGlobalInstructions,
  detectInstructionConflict,
  updateGlobalInstruction,
  type InstructionConflict,
} from "./global-instructions";
import { loadSavedPosts, renderSavedExemplars } from "./saved-posts";
import { loadLabFacts, renderLabFacts } from "./lab-facts";
import { loadAudienceModel, renderAudienceModel } from "./audience";
import { COMPANY_IDENTITY, renderProductIdentity, type Product } from "./products";

export interface CalendarDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
  /** The product this calendar session writes for. */
  product: Product;
}

export type SlotStatus = "idea" | "drafting" | "drafted" | "edited" | "ready";

export interface CalSlot {
  id: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Which post of the day, 1-based (supports multiple per day). */
  index: number;
  theme: string;
  angle: string;
  status: SlotStatus;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
}

export interface CalCitation {
  marker: number;
  itemId: string;
  title: string;
  entityType: string;
}

export interface PlanCalendarInput {
  /** Natural-language brief, e.g. "educational, broad lab audience, confident". */
  brief: string;
  startDate: string;       // ISO YYYY-MM-DD
  endDate: string;         // ISO YYYY-MM-DD
  postsPerDay: number;     // e.g. 1 or 2
  weekdaysOnly: boolean;
  /** Themes/angles already in the calendar (any date) — avoid repeating them. */
  existing?: Array<{ theme: string; angle: string }>;
}

export interface PlanCalendarResult {
  slots: CalSlot[];
  citations: CalCitation[];
  insufficient: boolean;
  note: string;
}

export interface DraftPostsInput {
  /** The slots to draft (date + index + theme/angle). Bodies are (re)written. */
  slots: Array<Pick<CalSlot, "id" | "date" | "index" | "theme" | "angle">>;
  brief: string;
  /** Target length hint. */
  length: "short" | "standard";
  /** Bodies of posts ALREADY written elsewhere in the calendar — must not be duplicated. */
  existingBodies?: string[];
}

export interface DraftPostsResult {
  drafts: Array<Pick<CalSlot, "id" | "body" | "hashtags" | "citationMarkers">>;
  citations: CalCitation[];
  insufficient: boolean;
  /** Non-fatal notes, e.g. a draft that came back near-duplicate and was redrafted. */
  dedupeNotes: string[];
}

export interface RevisePostInput {
  slot: Pick<CalSlot, "id" | "date" | "theme" | "angle" | "body" | "hashtags">;
  instruction: string;
}

export interface RevisePostResult {
  id: string;
  body: string;
  hashtags: string[];
  citationMarkers: number[];
  citations: CalCitation[];
  /** A durable style rule learned from this revision, if any (applied to all future posts). */
  learnedRule: string | null;
  /**
   * Set when the distilled style rule CONTRADICTS a global instruction. The
   * rule is NOT applied; the UI must ask the user whether to keep it to this
   * post only (the revision already reflects it) or update the global
   * instruction. Resolved via resolveCalendarConflict.
   */
  conflict: InstructionConflict | null;
  /** The distilled candidate rule, echoed back so the UI can resolve the conflict. */
  candidateRule: string | null;
}

// ── grounding helpers ─────────────────────────────────────────────────────

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

async function retrieve(query: string, deps: CalendarDeps) {
  const items = await retrieveForQuestion(
    `${query} ${deps.product.name} ${deps.product.oneLiner} features workflows capabilities positioning`,
    { ...deps, productId: deps.product.id },
  );
  const supported = items.filter((i) => i.sources.length > 0);
  return { items, supported };
}

function toCitations(items: GroundingItem[], markers: number[]): CalCitation[] {
  const byMarker = new Map(items.map((i) => [i.marker, i]));
  const chosen = markers.length ? markers : items.slice(0, 8).map((i) => i.marker);
  return [...new Set(chosen)]
    .map((m) => byMarker.get(m))
    .filter((i): i is GroundingItem => Boolean(i))
    .map((i) => ({ marker: i.marker, itemId: i.id, title: i.title, entityType: i.entityType }));
}

/** Tolerant JSON parse with truncation recovery (model output may be noisy). */
function parseJsonLoose(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 || (last !== -1 && last < t.length - 1)) {
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return JSON.parse(repairTruncatedJson(t));
  }
}

function repairTruncatedJson(input: string): string {
  let s = input;
  const quotes = (s.match(/(?<!\\)"/g) ?? []).length;
  if (quotes % 2 !== 0) s += '"';
  s = s.replace(/,\s*$/, "");
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr;
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  while (stack.length) s += stack.pop() === "{" ? "}" : "]";
  return s;
}

// ── date helpers ────────────────────────────────────────────────────────────

/** Format a Date as a local YYYY-MM-DD (avoids UTC day-shift from toISOString). */
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eachDate(startISO: string, endISO: string, weekdaysOnly: boolean): string[] {
  const out: string[] = [];
  const d = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  while (d <= end) {
    const dow = d.getDay(); // 0 Sun .. 6 Sat
    if (!weekdaysOnly || (dow >= 1 && dow <= 5)) out.push(fmtLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ── de-duplication ──────────────────────────────────────────────────────────

/** Bag of content-word bigrams, for Jaccard overlap between two posts. */
function shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const out = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) out.add(words[i] + " " + words[i + 1]);
  return out;
}

/** Jaccard similarity of two texts' bigram sets (0..1). */
function textSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Highest similarity of `text` against any post in `against`. */
function maxSimilarity(text: string, against: string[]): number {
  let max = 0;
  for (const other of against) max = Math.max(max, textSimilarity(text, other));
  return max;
}

const DUP_THRESHOLD = 0.3; // bigram-Jaccard above this ≈ "same thing, different words"

// NOTE: The human-voice / anti-slop policy that used to live here as the
// hardcoded `VOICE_RULES` literal is now EDITABLE GLOBAL INSTRUCTIONS (see
// ./global-instructions). It is rendered and prepended to every system prompt
// below. The deterministic slop-scrub patterns remain as a code backstop.

// Patterns that signal AI slop; used for a post-generation scrub.
const SLOP_WORDS = /\b(delve|utiliz(e|ing)|leverag(e|ing)|robust|streamlin|harness|foster|enhanc|underscore|pivotal|crucial|intricate|testament|groundbreaking|transformative|innovativ|comprehensive|seamless|revolutioniz|game.?chang|best.?in.?class|industry.?leading|cutting.?edge|supercharge|unlock your|empower|elevate your)\b/i;
const SLOP_PHRASES = /(here'?s the (thing|kicker|catch|deal)|imagine a world|let'?s (dive|unpack|explore|break this down)|it'?s worth noting|don'?t miss out|start your journey|take the next step|take your lab to the next level|end-to-end solution|boost efficiency|streamline your)/i;
const NEG_PARALLELISM = /\bit'?s not [^.?!]{1,40}[,.] it'?s\b/i;

function slopHits(text: string): string[] {
  const hits: string[] = [];
  const w = text.match(SLOP_WORDS);
  if (w) hits.push(`banned word "${w[0]}"`);
  const p = text.match(SLOP_PHRASES);
  if (p) hits.push(`banned phrase "${p[0]}"`);
  if (NEG_PARALLELISM.test(text)) hits.push(`"it's not X, it's Y" construction`);
  const emDashes = (text.match(/—/g) ?? []).length;
  if (emDashes > 2) hits.push(`${emDashes} em-dashes (max 2)`);
  return hits;
}

// ── operations ────────────────────────────────────────────────────────────

// Task tails. The base writing policy comes from the editable GLOBAL
// INSTRUCTIONS, prepended at each call site via `sys()`.
const PLAN_TASK = `TASK: Plan a LinkedIn content calendar for the product named above.
You are given a set of DATE SLOTS and grounded KNOWLEDGE items. Assign each slot a focused theme + angle drawn from the knowledge.
RULES:
- Base every theme/angle on the KNOWLEDGE items (real features, workflows, metrics, customers, positioning). Do not invent.
- Build a COHESIVE PLAN, not a random pile: sequence themes so the month tells a progression (e.g. problem then capability then proof then how-it-works then outcomes). Group related ideas into a sensible narrative arc across the weeks.
- Each slot must be DISTINCT. Never assign two slots the same theme or the same angle. Spread coverage across features, workflows, metrics, customer proof, positioning, and limitations.
- If an ALREADY COVERED list is provided, do NOT reuse those themes/angles, pick genuinely new territory.
- Keep "theme" to 2-5 words and "angle" to one short sentence (the hook idea). Do NOT write full post copy here.
OUTPUT: ONLY JSON (no prose, no fences): { "slots": [ { "id": string, "theme": string, "angle": string } ] }
Return one object per provided slot id, preserving the ids.`;

/**
 * Prepend the editable global writing policy (and real-world lab facts, which
 * are grounding) to a task tail to form a system prompt.
 */
function sys(product: Product, globalBlock: string, task: string, factsBlock = ""): string {
  return [COMPANY_IDENTITY, renderProductIdentity(product), globalBlock, factsBlock, task]
    .filter(Boolean)
    .join("\n\n");
}

export async function planCalendar(input: PlanCalendarInput, deps: CalendarDeps): Promise<PlanCalendarResult> {
  const dates = eachDate(input.startDate, input.endDate, input.weekdaysOnly);
  const slots: CalSlot[] = [];
  for (const date of dates) {
    for (let i = 1; i <= Math.max(1, input.postsPerDay); i++) {
      slots.push({
        id: `${date}#${i}`,
        date,
        index: i,
        theme: "",
        angle: "",
        status: "idea",
        body: "",
        hashtags: [],
        citationMarkers: [],
      });
    }
  }

  const { items, supported } = await retrieve(input.brief, deps);
  if (supported.length === 0) {
    return { slots, citations: [], insufficient: true, note: "No supported knowledge to plan from — ingest material first." };
  }

  const knowledge = buildKnowledgeContext(items);
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId, deps.product.id));
  const globalBlock = renderGlobalInstructions(await loadGlobalInstructions(deps.workspaceId));
  const slotList = slots.map((s) => ({ id: s.id, date: s.date, index: s.index }));
  const coveredBlock = (input.existing ?? []).length
    ? `ALREADY COVERED — do NOT reuse these themes/angles:\n${(input.existing ?? [])
        .map((e) => `- ${e.theme}: ${e.angle}`)
        .join("\n")}\n\n`
    : "";
  const user = `BRIEF: ${input.brief}\n\n${styleBlock ? styleBlock + "\n\n" : ""}${coveredBlock}KNOWLEDGE:\n${knowledge}\n\nSLOTS (assign a theme+angle to each id):\n${JSON.stringify(slotList)}`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: sys(deps.product, globalBlock, PLAN_TASK) },
      { role: "user", content: user },
    ],
    { temperature: 0.5, maxTokens: 16000 },
  );

  try {
    const raw = parseJsonLoose(res.text) as { slots?: Array<Record<string, unknown>> };
    const byId = new Map((raw.slots ?? []).map((r) => [String(r.id), r]));
    for (const s of slots) {
      const r = byId.get(s.id);
      if (r) {
        s.theme = String(r.theme ?? "").slice(0, 80);
        s.angle = String(r.angle ?? "");
      }
    }
  } catch {
    // Leave slots as empty ideas if parsing fails; the grid still renders.
  }

  return {
    slots,
    citations: toCitations(items, []),
    insufficient: false,
    note: `${slots.length} slots planned across ${dates.length} days.`,
  };
}

const DRAFT_TASK = `TASK: Write ready-to-publish LinkedIn posts for the product named above, following the GLOBAL WRITING INSTRUCTIONS above.
RULES:
- Every factual claim MUST be backed by a knowledge item; list those marker numbers in "citationMarkers".
- Each post must be DISTINCT from the others in this batch AND from any ALREADY PUBLISHED posts provided. Do not reuse the same hook, opening line, framing, or metric-as-lead. The product is the same, so overlap in facts is fine, but every post says something new from a different angle. No "same thing, different words".
- Provide 3-5 relevant "hashtags" (without the # is fine).
- Honor the requested length: "short" ~ 350-600 chars, "standard" ~ 700-1100 chars.
OUTPUT: ONLY JSON (no prose, no fences): { "drafts": [ { "id": string, "body": string, "hashtags": string[], "citationMarkers": number[] } ] }
Return one draft per provided slot id, preserving ids.`;

export async function draftPosts(input: DraftPostsInput, deps: CalendarDeps): Promise<DraftPostsResult> {
  const topicQuery = `${input.brief} ${input.slots.map((s) => `${s.theme} ${s.angle}`).join(" ")}`;
  const { items, supported } = await retrieve(topicQuery, deps);
  if (supported.length === 0) {
    return { drafts: [], citations: [], insufficient: true, dedupeNotes: [] };
  }
  const validMarkers = new Set(items.map((i) => i.marker));
  const knowledge = buildKnowledgeContext(items);
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId, deps.product.id));
  const globalBlock = renderGlobalInstructions(await loadGlobalInstructions(deps.workspaceId));
  const savedBlock = renderSavedExemplars(await loadSavedPosts(deps.workspaceId, deps.product.id));
  const labFactsBlock = renderLabFacts(await loadLabFacts(deps.workspaceId));
  const audienceBlock = renderAudienceModel(await loadAudienceModel(deps.workspaceId));
  const draftSystem = sys(deps.product, globalBlock, DRAFT_TASK, [labFactsBlock, audienceBlock].filter(Boolean).join("\n\n"));
  const slotList = input.slots.map((s) => ({ id: s.id, date: s.date, theme: s.theme, angle: s.angle }));
  const existingBodies = input.existingBodies ?? [];
  const publishedBlock = existingBodies.length
    ? `ALREADY PUBLISHED posts (do NOT duplicate their hooks, framing, or wording — be genuinely different):\n${existingBodies
        .map((b, i) => `--- published ${i + 1} ---\n${b}`)
        .join("\n")}\n\n`
    : "";
  const user = `BRIEF: ${input.brief}\nLENGTH: ${input.length}\n\n${savedBlock ? savedBlock + "\n\n" : ""}${styleBlock ? styleBlock + "\n\n" : ""}${publishedBlock}KNOWLEDGE (cite by [n] marker number):\n${knowledge}\n\nWRITE A POST FOR EACH SLOT:\n${JSON.stringify(slotList)}`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: draftSystem },
      { role: "user", content: user },
    ],
    { temperature: 0.6, maxTokens: 16000 },
  );

  const drafts = parseDrafts(res.text, validMarkers);

  // ── scrub + de-dup pass ──
  // (1) rewrite any post that trips an AI-slop pattern, (2) redraft any post too
  // similar to an existing or sibling post.
  const dedupeNotes: string[] = [];
  const corpus = [...existingBodies]; // grows as we accept each draft
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (!d.body) continue;
    const slot = input.slots.find((s) => s.id === d.id);

    // (1) Anti-slop scrub.
    const hits = slopHits(d.body);
    if (hits.length) {
      const fixed = await rewriteNoSlop(d.body, hits, slot, knowledge, styleBlock, draftSystem, input.length, validMarkers, deps);
      if (fixed && slopHits(fixed.body).length < hits.length) {
        drafts[i] = fixed;
        dedupeNotes.push(`Rewrote ${d.id} to remove AI-slop (${hits.join(", ")}).`);
      }
    }

    // (2) De-dup against corpus.
    let sim = maxSimilarity(drafts[i].body, corpus);
    if (sim > DUP_THRESHOLD) {
      const redraft = await redraftDistinct(drafts[i].body, slot, knowledge, styleBlock, draftSystem, corpus, input.length, validMarkers, deps);
      if (redraft && maxSimilarity(redraft.body, corpus) < sim) {
        drafts[i] = redraft;
        dedupeNotes.push(`Redrafted ${d.id} — original was too similar to an existing post.`);
        sim = maxSimilarity(redraft.body, corpus);
      } else {
        dedupeNotes.push(`${d.id} still overlaps an existing post; review manually.`);
      }
    }
    corpus.push(drafts[i].body);
  }

  const used = new Set<number>();
  for (const d of drafts) for (const m of d.citationMarkers) used.add(m);
  return {
    drafts: drafts.filter((d) => d.id && d.body),
    citations: toCitations(items, [...used]),
    insufficient: false,
    dedupeNotes,
  };
}

function parseDrafts(text: string, validMarkers: Set<number>): DraftPostsResult["drafts"] {
  const drafts: DraftPostsResult["drafts"] = [];
  try {
    const raw = parseJsonLoose(text) as { drafts?: Array<Record<string, unknown>> };
    for (const r of raw.drafts ?? []) {
      const markers = Array.isArray(r.citationMarkers)
        ? (r.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m))
        : [];
      drafts.push({
        id: String(r.id ?? ""),
        body: stripCitationMarkers(stripDashes(String(r.body ?? "").trim())),
        hashtags: Array.isArray(r.hashtags) ? (r.hashtags as unknown[]).map(String).filter(Boolean) : [],
        citationMarkers: markers,
      });
    }
  } catch {
    // return whatever parsed
  }
  return drafts;
}

/** Rewrite a single post to strip AI-slop patterns while keeping it grounded. */
async function rewriteNoSlop(
  current: string,
  hits: string[],
  slot: Pick<CalSlot, "id" | "date" | "theme" | "angle"> | undefined,
  knowledge: string,
  styleBlock: string,
  draftSystem: string,
  length: "short" | "standard",
  validMarkers: Set<number>,
  deps: CalendarDeps,
): Promise<DraftPostsResult["drafts"][number] | null> {
  const user =
    `${styleBlock ? styleBlock + "\n\n" : ""}KNOWLEDGE (cite by [n]):\n${knowledge}\n\n` +
    `This draft reads like generic AI marketing. Problems detected: ${hits.join("; ")}.\n\n` +
    `DRAFT:\n${current}\n\n` +
    `Rewrite it so a working lab owner would actually want to read it: specific, concrete, a little blunt, no hype or marketing clichés. Keep the same facts (grounded in the knowledge), same rough length (${length}). Lead with a real, concrete detail. ` +
    `OUTPUT ONLY JSON: { "body": string, "hashtags": string[], "citationMarkers": number[] }`;
  const res = await deps.provider.chat(
    [
      { role: "system", content: draftSystem },
      { role: "user", content: user },
    ],
    { temperature: 0.7, maxTokens: 2000 },
  );
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    const body = stripCitationMarkers(stripDashes(String(raw.body ?? "").trim()));
    if (!body) return null;
    const markers = Array.isArray(raw.citationMarkers)
      ? (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m))
      : [];
    return {
      id: slot?.id ?? "",
      body,
      hashtags: Array.isArray(raw.hashtags) ? (raw.hashtags as unknown[]).map(String).filter(Boolean) : [],
      citationMarkers: markers,
    };
  } catch {
    return null;
  }
}

/** Redraft a single post to be genuinely distinct from the corpus. */
async function redraftDistinct(
  current: string,
  slot: Pick<CalSlot, "id" | "date" | "theme" | "angle"> | undefined,
  knowledge: string,
  styleBlock: string,
  draftSystem: string,
  corpus: string[],
  length: "short" | "standard",
  validMarkers: Set<number>,
  deps: CalendarDeps,
): Promise<DraftPostsResult["drafts"][number] | null> {
  const user =
    `${styleBlock ? styleBlock + "\n\n" : ""}KNOWLEDGE (cite by [n]):\n${knowledge}\n\n` +
    `These posts ALREADY EXIST — your new post must NOT overlap their hook, framing, or wording:\n${corpus
      .map((b, i) => `--- ${i + 1} ---\n${b}`)
      .join("\n")}\n\n` +
    `This draft was too similar to the above:\n${current}\n\n` +
    `Rewrite a post for theme "${slot?.theme ?? ""}" (angle: ${slot?.angle ?? ""}), LENGTH ${length}, taking a genuinely different angle/hook. ` +
    `OUTPUT ONLY JSON: { "body": string, "hashtags": string[], "citationMarkers": number[] }`;
  const res = await deps.provider.chat(
    [
      { role: "system", content: draftSystem },
      { role: "user", content: user },
    ],
    { temperature: 0.8, maxTokens: 2000 },
  );
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    const markers = Array.isArray(raw.citationMarkers)
      ? (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m))
      : [];
    const body = stripCitationMarkers(stripDashes(String(raw.body ?? "").trim()));
    if (!body) return null;
    return {
      id: slot?.id ?? "",
      body,
      hashtags: Array.isArray(raw.hashtags) ? (raw.hashtags as unknown[]).map(String).filter(Boolean) : [],
      citationMarkers: markers,
    };
  } catch {
    return null;
  }
}

const REVISE_TASK = `TASK: Revise ONE LinkedIn post for the product named above per the user's instruction, following the GLOBAL WRITING INSTRUCTIONS above. You also LEARN the user's durable style preference from their instruction.
RULES:
- Apply the instruction precisely; change only what's asked, keep the rest.
- Follow the LEARNED STYLE GUIDE if present (the user already taught these).
- Every factual claim MUST stay backed by a knowledge marker (citationMarkers).
- Also distill the instruction into a GENERAL, REUSABLE style rule that should apply to ALL future posts (not just this one). Phrase it as a durable guideline, e.g. "Lead with the problem before naming the product", "Avoid exclamation points", "End with a soft, non-pushy CTA". If the instruction was purely a one-off content fix with no reusable style lesson, return an empty "styleRule".
OUTPUT: ONLY JSON (no prose, no fences): { "body": string, "hashtags": string[], "citationMarkers": number[], "styleRule": string }`;

export async function revisePost(input: RevisePostInput, deps: CalendarDeps): Promise<RevisePostResult> {
  const { items } = await retrieve(`${input.slot.theme} ${input.slot.angle} ${input.instruction}`, deps);
  const validMarkers = new Set(items.map((i) => i.marker));
  const knowledge = buildKnowledgeContext(items);
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId, deps.product.id));
  const globalBlock = renderGlobalInstructions(await loadGlobalInstructions(deps.workspaceId));
  const labFactsBlock = renderLabFacts(await loadLabFacts(deps.workspaceId));
  const audienceBlock = renderAudienceModel(await loadAudienceModel(deps.workspaceId));
  const groundingBlock = [labFactsBlock, audienceBlock].filter(Boolean).join("\n\n");
  const user = `${styleBlock ? styleBlock + "\n\n" : ""}KNOWLEDGE (cite by [n]):\n${knowledge}\n\nCURRENT POST:\n${input.slot.body}\n\nCURRENT HASHTAGS: ${input.slot.hashtags.join(", ")}\n\nINSTRUCTION:\n${input.instruction}`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: sys(deps.product, globalBlock, REVISE_TASK, groundingBlock) },
      { role: "user", content: user },
    ],
    { temperature: 0.6, maxTokens: 4000 },
  );

  let body = input.slot.body;
  let hashtags = input.slot.hashtags;
  let markers: number[] = [];
  let styleRule = "";
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    if (typeof raw.body === "string" && raw.body.trim()) body = stripCitationMarkers(stripDashes(raw.body.trim()));
    if (Array.isArray(raw.hashtags)) hashtags = (raw.hashtags as unknown[]).map(String).filter(Boolean);
    if (Array.isArray(raw.citationMarkers)) {
      markers = (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m));
    }
    if (typeof raw.styleRule === "string") styleRule = raw.styleRule.trim();
  } catch {
    // keep original on parse failure
  }

  // LEARN: before persisting the distilled rule to the durable style guide,
  // check it against the editable GLOBAL INSTRUCTIONS. If it contradicts one,
  // we do NOT apply it silently. The revised body already reflects the one-off
  // instruction (that's fine, it's this post), but the DURABLE rule is held
  // back and surfaced so the user chooses: keep it to this post only, or update
  // the global instruction.
  let learnedRule: string | null = null;
  let conflict: InstructionConflict | null = null;
  let candidateRule: string | null = null;
  if (styleRule) {
    const gi = await loadGlobalInstructions(deps.workspaceId);
    conflict = await detectInstructionConflict(styleRule, gi, deps.provider);
    if (conflict) {
      candidateRule = styleRule; // not applied; await user's decision
    } else {
      await addStyleRules(deps.workspaceId, deps.product.id, [{ rule: styleRule, source: input.instruction }]);
      learnedRule = styleRule;
    }
  }

  return {
    id: input.slot.id,
    body,
    hashtags,
    citationMarkers: markers,
    citations: toCitations(items, markers),
    learnedRule,
    conflict,
    candidateRule,
  };
}

export type CalendarConflictResolution = "this_post_only" | "update_global";

export interface ResolveCalendarConflictInput {
  resolution: CalendarConflictResolution;
  candidateRule: string;
  instruction: string;
  /** Required for "update_global": the global instruction to rewrite. */
  instructionId?: string;
  /** New text for the global instruction. If omitted, the candidate is appended. */
  newInstructionText?: string;
}

/**
 * Resolve a revise-time conflict.
 *  - "this_post_only": do nothing durable. The revised body already reflects
 *     the instruction for this one post; we simply don't learn a global rule.
 *  - "update_global": rewrite the conflicting global instruction (and record
 *     the rule in the style guide for provenance).
 */
export async function resolveCalendarConflict(
  input: ResolveCalendarConflictInput,
  deps: CalendarDeps,
): Promise<{ ok: true; applied: CalendarConflictResolution }> {
  if (input.resolution === "this_post_only") {
    return { ok: true, applied: "this_post_only" };
  }
  if (!input.instructionId) throw new Error("instructionId is required to update a global instruction");
  const gi = await loadGlobalInstructions(deps.workspaceId);
  const existing = gi.instructions.find((i) => i.id === input.instructionId);
  const text =
    input.newInstructionText?.trim() ||
    (existing ? `${existing.text} ${input.candidateRule.trim()}` : input.candidateRule.trim());
  await updateGlobalInstruction(deps.workspaceId, input.instructionId, { text });
  await addStyleRules(deps.workspaceId, deps.product.id, [{ rule: input.candidateRule, source: input.instruction }]);
  return { ok: true, applied: "update_global" };
}
