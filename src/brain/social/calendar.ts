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
import { stripDashes } from "./training";

export interface CalendarDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
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
    `${query} Sampleify LIMS features workflows metrics customers positioning benefits`,
    deps,
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

// ── anti-slop voice rules (shared by draft + revise) ────────────────────────
// A human lab owner must want to read this. Specific beats generic, every time.
const VOICE_RULES = `WRITE LIKE A HUMAN A LAB OWNER WOULD ACTUALLY READ. Avoid generic AI "slop". Non-negotiable:
- Specific beats general. If a line could appear on any competitor's page, rewrite it from a concrete, real detail (a named workflow stage, an actual setting, a real step a lab does). High-entropy, not smooth filler.
- BANNED sentence shapes: "It's not X, it's Y" (negative parallelism); "Not X. Not Y. Just Z."; rhetorical question-then-answer ("The result? Devastating."); repeating the same sentence opener; forcing everything into threes; "-ing" tails that imply significance ("...reflecting broader trends"); fake ranges ("from X to Y" where they aren't a scale).
- BANNED words: delve, utilize, leverage, robust, streamline, harness, foster, enhance, underscore, pivotal, crucial, intricate, testament, groundbreaking, transformative, innovative, comprehensive, seamless, revolutionize, game-changing, unlock, empower, elevate, supercharge, best-in-class, industry-leading, cutting-edge.
- BANNED openers/transitions: "Here's the thing", "Here's the kicker", "Here's what most people miss", "Imagine a world where", "Let's dive in", "Let's unpack", "It's worth noting", "Importantly".
- BANNED marketing fluff: "streamline your workflow", "boost efficiency", "end-to-end solution", "take your lab to the next level", "transform your operations", vague social proof like "trusted by thousands". Name the real number or the real capability, or say nothing.
- BANNED CTA clichés: "Don't miss out", "Start your journey", "Take the next step", "Experience the difference". If you close, make it plain and specific (or skip the CTA).
- Max 2 em-dashes in a post. Don't start every line with a bold label. Don't write entirely in one-sentence paragraphs.
- Sound like one practitioner talking to another: concrete, a little blunt, no hype. The facts still come ONLY from the knowledge items.`;

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

const PLAN_SYSTEM = `You plan a LinkedIn content calendar for "Sampleify", a LIMS (lab information management system).
You are given a set of DATE SLOTS and grounded KNOWLEDGE items. Assign each slot a focused theme + angle drawn from the knowledge.
RULES:
- Base every theme/angle on the KNOWLEDGE items (real features, workflows, metrics, customers, positioning). Do not invent.
- Build a COHESIVE PLAN, not a random pile: sequence themes so the month tells a progression (e.g. problem → capability → proof → how-it-works → outcomes). Group related ideas into a sensible narrative arc across the weeks.
- Each slot must be DISTINCT. Never assign two slots the same theme or the same angle. Spread coverage across features, workflows, metrics, customer proof, positioning, and limitations.
- If an ALREADY COVERED list is provided, do NOT reuse those themes/angles — pick genuinely new territory.
- Keep "theme" to 2-5 words and "angle" to one short sentence (the hook idea). Do NOT write full post copy here.
OUTPUT: ONLY JSON (no prose, no fences): { "slots": [ { "id": string, "theme": string, "angle": string } ] }
Return one object per provided slot id, preserving the ids.`;

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
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId));
  const slotList = slots.map((s) => ({ id: s.id, date: s.date, index: s.index }));
  const coveredBlock = (input.existing ?? []).length
    ? `ALREADY COVERED — do NOT reuse these themes/angles:\n${(input.existing ?? [])
        .map((e) => `- ${e.theme}: ${e.angle}`)
        .join("\n")}\n\n`
    : "";
  const user = `BRIEF: ${input.brief}\n\n${styleBlock ? styleBlock + "\n\n" : ""}${coveredBlock}KNOWLEDGE:\n${knowledge}\n\nSLOTS (assign a theme+angle to each id):\n${JSON.stringify(slotList)}`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: PLAN_SYSTEM },
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

const DRAFT_SYSTEM = `You write ready-to-publish LinkedIn posts for "Sampleify", a LIMS, grounded ONLY in the provided KNOWLEDGE.

${VOICE_RULES}

RULES:
- Every factual claim MUST be backed by a knowledge item; list those marker numbers in "citationMarkers". Never invent capabilities, metrics, or customer results.
- FORMAT LIKE A REAL LINKEDIN POST: a one-line hook, then a blank line, then short 1-2 sentence paragraphs each separated by a BLANK LINE. Use literal \\n\\n between paragraphs in the "body" string. Never return a single wall of text.
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
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId));
  const slotList = input.slots.map((s) => ({ id: s.id, date: s.date, theme: s.theme, angle: s.angle }));
  const existingBodies = input.existingBodies ?? [];
  const publishedBlock = existingBodies.length
    ? `ALREADY PUBLISHED posts (do NOT duplicate their hooks, framing, or wording — be genuinely different):\n${existingBodies
        .map((b, i) => `--- published ${i + 1} ---\n${b}`)
        .join("\n")}\n\n`
    : "";
  const user = `BRIEF: ${input.brief}\nLENGTH: ${input.length}\n\n${styleBlock ? styleBlock + "\n\n" : ""}${publishedBlock}KNOWLEDGE (cite by [n] marker number):\n${knowledge}\n\nWRITE A POST FOR EACH SLOT:\n${JSON.stringify(slotList)}`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: DRAFT_SYSTEM },
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
      const fixed = await rewriteNoSlop(d.body, hits, slot, knowledge, styleBlock, input.length, validMarkers, deps);
      if (fixed && slopHits(fixed.body).length < hits.length) {
        drafts[i] = fixed;
        dedupeNotes.push(`Rewrote ${d.id} to remove AI-slop (${hits.join(", ")}).`);
      }
    }

    // (2) De-dup against corpus.
    let sim = maxSimilarity(drafts[i].body, corpus);
    if (sim > DUP_THRESHOLD) {
      const redraft = await redraftDistinct(drafts[i].body, slot, knowledge, styleBlock, corpus, input.length, validMarkers, deps);
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
        body: stripDashes(String(r.body ?? "").trim()),
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
      { role: "system", content: DRAFT_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.7, maxTokens: 2000 },
  );
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    const body = String(raw.body ?? "").trim();
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
      { role: "system", content: DRAFT_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.8, maxTokens: 2000 },
  );
  try {
    const raw = parseJsonLoose(res.text) as Record<string, unknown>;
    const markers = Array.isArray(raw.citationMarkers)
      ? (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m))
      : [];
    const body = String(raw.body ?? "").trim();
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

const REVISE_SYSTEM = `You revise ONE LinkedIn post for "Sampleify" (a LIMS) per the user's instruction, keeping it grounded ONLY in the KNOWLEDGE. You also LEARN the user's durable style preference from their instruction.

${VOICE_RULES}

RULES:
- Apply the instruction precisely; change only what's asked, keep the rest.
- Follow the LEARNED STYLE GUIDE if present (the user already taught these).
- Every factual claim MUST stay backed by a knowledge marker (citationMarkers). Never invent.
- Keep it publishable LinkedIn copy with line breaks.
- Also distill the instruction into a GENERAL, REUSABLE style rule that should apply to ALL future posts (not just this one). Phrase it as a durable guideline, e.g. "Lead with the problem before naming the product", "Avoid exclamation points", "End with a soft, non-pushy CTA". If the instruction was purely a one-off content fix with no reusable style lesson, return an empty "styleRule".
OUTPUT: ONLY JSON (no prose, no fences): { "body": string, "hashtags": string[], "citationMarkers": number[], "styleRule": string }`;

export async function revisePost(input: RevisePostInput, deps: CalendarDeps): Promise<RevisePostResult> {
  const { items } = await retrieve(`${input.slot.theme} ${input.slot.angle} ${input.instruction}`, deps);
  const validMarkers = new Set(items.map((i) => i.marker));
  const knowledge = buildKnowledgeContext(items);
  const styleBlock = renderStyleGuide(await loadStyleGuide(deps.workspaceId));
  const user = `${styleBlock ? styleBlock + "\n\n" : ""}KNOWLEDGE (cite by [n]):\n${knowledge}\n\nCURRENT POST:\n${input.slot.body}\n\nCURRENT HASHTAGS: ${input.slot.hashtags.join(", ")}\n\nINSTRUCTION:\n${input.instruction}`;

  const res = await deps.provider.chat(
    [
      { role: "system", content: REVISE_SYSTEM },
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
    if (typeof raw.body === "string" && raw.body.trim()) body = stripDashes(raw.body.trim());
    if (Array.isArray(raw.hashtags)) hashtags = (raw.hashtags as unknown[]).map(String).filter(Boolean);
    if (Array.isArray(raw.citationMarkers)) {
      markers = (raw.citationMarkers as unknown[]).map(Number).filter((m) => Number.isFinite(m) && validMarkers.has(m));
    }
    if (typeof raw.styleRule === "string") styleRule = raw.styleRule.trim();
  } catch {
    // keep original on parse failure
  }

  // LEARN: persist the distilled rule so it applies to all future posts.
  let learnedRule: string | null = null;
  if (styleRule) {
    await addStyleRules(deps.workspaceId, [{ rule: styleRule, source: input.instruction }]);
    learnedRule = styleRule;
  }

  return { id: input.slot.id, body, hashtags, citationMarkers: markers, citations: toCitations(items, markers), learnedRule };
}
