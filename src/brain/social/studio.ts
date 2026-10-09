/**
 * Social Media Studio — an iterative, grounded content-generation loop.
 *
 * The Studio is a CONSUMER of the Brain (see .kiro/steering/product.md): it
 * composes LinkedIn posts/content plans ONLY from retrieved Sampleify knowledge
 * items, never inventing capabilities, metrics, or customer results.
 *
 * One method drives the whole loop: `studioTurn`. Given the running conversation
 * and the user's latest message (plus the current working artifact, if any), the
 * model either:
 *   - asks clarifying questions (how many posts, cadence, audience, tone…), or
 *   - produces/updates a structured artifact (a content plan and/or ready-to-post
 *     LinkedIn copy).
 *
 * The structured artifact is what the UI renders as editable cards. Refinement
 * ("I don't like this body / make post 2 punchier") is just another turn that
 * carries the current artifact back in.
 */
import type { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";
import { retrieveForQuestion, type GroundingItem } from "../retrieval/ground";

export interface StudioDeps {
  repos: Repositories;
  provider: ModelProvider;
  workspaceId: string;
}

export interface StudioPost {
  /** Stable id so edits/comments target a specific post across turns. */
  id: string;
  /** Short internal label, e.g. "Mon — Automizer feature". */
  label: string;
  /** Scheduling hint the model proposes (free-form, e.g. "Week 1 · Mon"). */
  slot: string | null;
  /** The ready-to-post LinkedIn copy, verbatim. */
  body: string;
  /** Suggested hashtags (without the body), UI appends if the user wants. */
  hashtags: string[];
  /** Which grounding item markers back the factual claims in this post. */
  citationMarkers: number[];
}

export interface StudioPlanEntry {
  slot: string;        // e.g. "Week 1 · Mon"
  theme: string;       // what the post is about
  angle: string;       // the hook/angle
}

export interface StudioArtifact {
  kind: "plan" | "posts" | "plan_and_posts" | "none";
  /** Human title for the artifact, e.g. "October Content Plan". */
  title: string | null;
  plan: StudioPlanEntry[];
  posts: StudioPost[];
}

export interface StudioCitation {
  marker: number;
  itemId: string;
  title: string;
  entityType: string;
}

export type StudioRole = "user" | "assistant";

export interface StudioHistoryMessage {
  role: StudioRole;
  content: string;
}

export interface StudioTurnInput {
  /** Prior turns (user + assistant replies) for context. */
  history: StudioHistoryMessage[];
  /** The user's latest message. */
  message: string;
  /** The artifact currently on screen, if the user is refining it. */
  currentArtifact?: StudioArtifact | null;
}

export interface StudioTurnResult {
  /** Conversational reply shown above the artifact. */
  reply: string;
  /** Clarifying questions the user should answer before generation. */
  questions: string[];
  /** The working artifact (may be unchanged, updated, or empty). */
  artifact: StudioArtifact;
  /** Items the artifact is grounded in. */
  citations: StudioCitation[];
  /** True when the artifact couldn't be grounded (no supported knowledge). */
  insufficient: boolean;
}

const EMPTY_ARTIFACT: StudioArtifact = { kind: "none", title: null, plan: [], posts: [] };

/** Build the numbered grounding context the model may cite from. */
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

/** A retrieval query that pulls a broad, representative slice of the product. */
function retrievalQueryFor(input: StudioTurnInput): string {
  // Combine the latest message with any plan themes so retrieval covers the
  // topics the user is steering toward.
  const planThemes = (input.currentArtifact?.plan ?? []).map((p) => `${p.theme} ${p.angle}`).join(" ");
  const base = `${input.message} ${planThemes}`.trim();
  // Seed with product-wide terms so an opening "make me a plan" still retrieves.
  return `${base} Sampleify LIMS features workflows metrics customers positioning benefits`;
}

const SYSTEM_PROMPT = `You are the Social Media Studio for "Sampleify", a LIMS (laboratory information management system).
You help a marketer plan and write LinkedIn posts about Sampleify, working in an iterative loop.

ABSOLUTE RULES:
- Use ONLY the numbered KNOWLEDGE items provided. NEVER invent capabilities, metrics, customer results, numbers, or claims not present there.
- Every factual claim in a post MUST be backed by one or more knowledge item markers; put those marker numbers in the post's "citationMarkers".
- If the knowledge is insufficient to write grounded posts, say so in "reply", set artifact.kind to "none", and ask what to ingest.
- Marketing voice is allowed (hooks, framing, calls to action), but the underlying FACTS must come from the knowledge items.

HOW TO BEHAVE:
- If the user's request lacks the detail you need (how many posts, cadence/per day, which weeks, audience, tone, length), ask concise clarifying "questions" and DO NOT generate yet (artifact.kind "none" or keep the current artifact unchanged).
- Once you have enough detail, produce the artifact:
  - A content PLAN is a list of {slot, theme, angle}. The plan may span the whole requested period (e.g. a month).
  - POSTS are ready-to-publish LinkedIn copy in "body" (write it exactly as it should appear, including line breaks), plus "hashtags" and "citationMarkers".
- IMPORTANT — generate in sensible batches. Do NOT write full post bodies for an entire month in one response. Write the full posts ONLY for the specific window the user asked to draft (e.g. "this week"). For the rest of the plan, leave them as plan entries and tell the user in "reply" that you can draft the next batch on request. Aim for at most ~10 full posts per response so the output is complete and never truncated.
- When the user refines ("I don't like post 2's body", "make it punchier", "use shorter sentences"), MODIFY the current artifact in place: keep each post's "id" stable, only change what was asked, and return the FULL updated artifact.
- Keep LinkedIn posts realistic: a strong first-line hook, scannable short paragraphs, no more than ~1300 characters unless asked.

OUTPUT: Respond with ONLY a JSON object (no prose, no markdown, no code fences) of this exact shape:
{
  "reply": string,                         // short conversational message to the user
  "questions": string[],                   // clarifying questions, [] when none
  "artifact": {
    "kind": "plan" | "posts" | "plan_and_posts" | "none",
    "title": string | null,
    "plan": [ { "slot": string, "theme": string, "angle": string } ],
    "posts": [ { "id": string, "label": string, "slot": string | null, "body": string, "hashtags": string[], "citationMarkers": number[] } ]
  }
}
When updating existing posts, reuse their given "id". When creating new posts, invent a short unique "id" like "p1", "p2".`;

interface RawTurn {
  reply?: unknown;
  questions?: unknown;
  artifact?: {
    kind?: unknown;
    title?: unknown;
    plan?: unknown;
    posts?: unknown;
  };
}

function coerceArtifact(raw: RawTurn["artifact"], validMarkers: Set<number>): StudioArtifact {
  if (!raw || typeof raw !== "object") return { ...EMPTY_ARTIFACT };
  const kind = ["plan", "posts", "plan_and_posts", "none"].includes(String(raw.kind))
    ? (raw.kind as StudioArtifact["kind"])
    : "none";
  const title = typeof raw.title === "string" ? raw.title : null;

  const plan: StudioPlanEntry[] = Array.isArray(raw.plan)
    ? raw.plan
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => ({
          slot: String((p as Record<string, unknown>).slot ?? ""),
          theme: String((p as Record<string, unknown>).theme ?? ""),
          angle: String((p as Record<string, unknown>).angle ?? ""),
        }))
    : [];

  const posts: StudioPost[] = Array.isArray(raw.posts)
    ? raw.posts
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p, i) => {
          const rec = p as Record<string, unknown>;
          const markers = Array.isArray(rec.citationMarkers)
            ? (rec.citationMarkers as unknown[])
                .map((m) => Number(m))
                .filter((m) => Number.isFinite(m) && validMarkers.has(m))
            : [];
          return {
            id: typeof rec.id === "string" && rec.id.trim() ? rec.id : `p${i + 1}`,
            label: String(rec.label ?? `Post ${i + 1}`),
            slot: rec.slot == null ? null : String(rec.slot),
            body: String(rec.body ?? ""),
            hashtags: Array.isArray(rec.hashtags)
              ? (rec.hashtags as unknown[]).map((h) => String(h)).filter(Boolean)
              : [],
            citationMarkers: markers,
          };
        })
        .filter((p) => p.body.trim() !== "")
    : [];

  return { kind, title, plan, posts };
}

export async function studioTurn(input: StudioTurnInput, deps: StudioDeps): Promise<StudioTurnResult> {
  // 1. Retrieve grounded knowledge for this turn.
  const items = await retrieveForQuestion(retrievalQueryFor(input), deps);
  const supported = items.filter((i) => i.sources.length > 0);

  // 2. No supported knowledge → refuse to fabricate (never invent).
  if (supported.length === 0) {
    return {
      reply:
        "I don't have supported Sampleify knowledge to ground posts on yet. Ingest product material under Knowledge first, then come back and I'll write grounded posts.",
      questions: [],
      artifact: { ...EMPTY_ARTIFACT },
      citations: [],
      insufficient: true,
    };
  }

  const validMarkers = new Set(items.map((i) => i.marker));
  const knowledge = buildKnowledgeContext(items);

  // 3. Compose the chat: system rules, knowledge, prior turns, current artifact, new message.
  const contextBlocks: string[] = [`KNOWLEDGE (cite by [n]):\n${knowledge}`];
  if (input.currentArtifact && input.currentArtifact.kind !== "none") {
    contextBlocks.push(`CURRENT ARTIFACT (modify this in place when refining):\n${JSON.stringify(input.currentArtifact)}`);
  }

  const historyText = input.history
    .map((h) => `${h.role === "user" ? "USER" : "STUDIO"}: ${h.content}`)
    .join("\n");
  if (historyText.trim()) contextBlocks.push(`CONVERSATION SO FAR:\n${historyText}`);

  const userContent = `${contextBlocks.join("\n\n")}\n\nUSER'S LATEST MESSAGE:\n${input.message}`;

  const result = await deps.provider.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    // Plans + multiple full posts produce large JSON; give ample room so the
    // response isn't truncated mid-object (which breaks parsing).
    { temperature: 0.6, maxTokens: 16000 },
  );

  // 4. Parse the structured response (tolerant to fences/noise).
  let raw: RawTurn;
  try {
    raw = parseJsonLoose(result.text) as RawTurn;
  } catch {
    // Last-resort fallback: parsing failed even after truncation repair. Never
    // dump raw JSON into the chat — keep the current artifact and ask the user
    // to narrow the request (usually the model tried to generate too much).
    return {
      reply:
        "That request produced more content than I could format in one go. Try asking for a smaller batch — e.g. just this week's posts — and I'll generate them cleanly.",
      questions: [],
      artifact: input.currentArtifact ?? { ...EMPTY_ARTIFACT },
      citations: toCitations(items, []),
      insufficient: false,
    };
  }

  const artifact = coerceArtifact(raw.artifact, validMarkers);
  const reply = typeof raw.reply === "string" ? raw.reply : "";
  const questions = Array.isArray(raw.questions)
    ? (raw.questions as unknown[]).map((q) => String(q)).filter(Boolean)
    : [];

  // 5. Collect the markers actually used by the artifact for citation display.
  const usedMarkers = new Set<number>();
  for (const p of artifact.posts) for (const m of p.citationMarkers) usedMarkers.add(m);

  return {
    reply: reply || (questions.length ? "A few questions before I generate:" : "Here's what I put together."),
    questions,
    artifact,
    citations: toCitations(items, [...usedMarkers]),
    insufficient: false,
  };
}

function toCitations(items: GroundingItem[], markers: number[]): StudioCitation[] {
  const byMarker = new Map(items.map((i) => [i.marker, i]));
  const chosen = markers.length ? markers : items.slice(0, 8).map((i) => i.marker);
  return chosen
    .map((m) => byMarker.get(m))
    .filter((i): i is GroundingItem => Boolean(i))
    .map((i) => ({ marker: i.marker, itemId: i.id, title: i.title, entityType: i.entityType }));
}

/**
 * Parse JSON from the model, tolerating code fences, surrounding prose, and
 * (as a last resort) truncation. If the response was cut off mid-structure, we
 * recover the largest valid JSON by closing open strings/brackets — so complete
 * posts still render as cards instead of dumping raw JSON into the chat.
 */
function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
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

/**
 * Best-effort repair of JSON truncated mid-structure: close an open string,
 * drop a dangling comma/partial token, and close unbalanced brackets in order.
 * Preserves every complete item before the cutoff.
 */
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
  while (stack.length) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}
