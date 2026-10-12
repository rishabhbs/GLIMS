/**
 * Saved posts — the user's curated GOLD STANDARD.
 *
 * In Training the user generates and rates posts. When they love one, they can
 * SAVE it here. Unlike the training history (capped, resettable, transient),
 * saved posts are a durable, hand-picked collection: the examples the user has
 * explicitly blessed as "this is the bar".
 *
 * These are the STRONGEST style signal in the system. They are injected into
 * every future generation (training + calendar drafting) as verified
 * exemplars, ranked above the transient high-rated examples. The user manages
 * them in the "Saved" sidebar section.
 *
 * Persistence: a per-workspace row in `studio_state` (key `saved_posts`).
 */
import { Repositories } from "@/db/repositories";

/** A saved turn — mirrors PostTurn in training, kept local to avoid a cycle. */
export interface SavedTurn {
  id?: string;
  role: "user" | "assistant";
  channel: "topic" | "body" | "media";
  text: string;
  body?: string;
  prevBody?: string;
  image?: string | null;
  createdAt: string;
}

export interface SavedPost {
  id: string;
  /** The post body exactly as saved (the gold-standard text). */
  body: string;
  /** The topic the post was built on (restored when reopened). */
  topic?: string;
  /** Optional theme/angle label carried over from the source post. */
  theme: string;
  hashtags: string[];
  /** The post graphic (restored when reopened). */
  image?: string | null;
  /** The full conversation timeline, so reopening restores the whole history. */
  turns?: SavedTurn[];
  /** Optional user note on WHY this is a standard (e.g. "perfect hook + length"). */
  note: string;
  /** Where it came from, for provenance. */
  source: "training" | "calendar" | "manual";
  createdAt: string;
}

export interface SavedPosts {
  workspaceId: string;
  posts: SavedPost[];
  updatedAt: string;
}

const KEY = "saved_posts";

function now(): string {
  return new Date().toISOString();
}

function normalizeBody(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function loadSavedPosts(workspaceId: string): Promise<SavedPosts> {
  const value = await new Repositories().getStudioState<SavedPosts>(workspaceId, KEY);
  if (value && Array.isArray(value.posts)) {
    return { workspaceId, posts: value.posts, updatedAt: value.updatedAt };
  }
  return { workspaceId, posts: [], updatedAt: now() };
}

async function save(sp: SavedPosts): Promise<void> {
  sp.updatedAt = now();
  await new Repositories().setStudioState(sp.workspaceId, KEY, sp);
}

export interface SavePostInput {
  body: string;
  topic?: string;
  theme?: string;
  hashtags?: string[];
  image?: string | null;
  turns?: SavedTurn[];
  note?: string;
  source?: SavedPost["source"];
}

/**
 * Save a post as a gold standard, storing its whole conversation so it can be
 * reopened in the Playground. Upserts on body: re-saving a refined version of
 * an already-saved post updates it in place (keeps its id + note).
 */
export async function savePost(workspaceId: string, input: SavePostInput): Promise<SavedPosts> {
  const sp = await loadSavedPosts(workspaceId);
  const body = input.body.trim();
  if (!body) return sp;
  const key = normalizeBody(body);
  const existing = sp.posts.find((p) => normalizeBody(p.body) === key);
  if (existing) {
    // Refresh the stored snapshot (topic/image/turns may have advanced).
    existing.topic = input.topic ?? existing.topic;
    existing.theme = (input.theme ?? existing.theme ?? "").trim();
    existing.hashtags = input.hashtags ?? existing.hashtags;
    existing.image = input.image ?? existing.image ?? null;
    existing.turns = input.turns ?? existing.turns;
    if (input.note !== undefined) existing.note = input.note.trim();
    await save(sp);
    return sp;
  }
  sp.posts.unshift({
    id: `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    body,
    topic: input.topic ?? "",
    theme: (input.theme ?? "").trim(),
    hashtags: input.hashtags ?? [],
    image: input.image ?? null,
    turns: input.turns ?? [],
    note: (input.note ?? "").trim(),
    source: input.source ?? "training",
    createdAt: now(),
  });
  await save(sp);
  return sp;
}

/** Fetch a single saved post by id. */
export async function getSavedPost(workspaceId: string, id: string): Promise<SavedPost | null> {
  const sp = await loadSavedPosts(workspaceId);
  return sp.posts.find((p) => p.id === id) ?? null;
}

/** Update the note on a saved post. */
export async function updateSavedPostNote(workspaceId: string, id: string, note: string): Promise<SavedPosts> {
  const sp = await loadSavedPosts(workspaceId);
  const post = sp.posts.find((p) => p.id === id);
  if (post) {
    post.note = note.trim();
    await save(sp);
  }
  return sp;
}

export async function removeSavedPost(workspaceId: string, id: string): Promise<SavedPosts> {
  const sp = await loadSavedPosts(workspaceId);
  sp.posts = sp.posts.filter((p) => p.id !== id);
  await save(sp);
  return sp;
}

/** True if a body is already saved (so the UI can show a filled "saved" state). */
export async function isSaved(workspaceId: string, body: string): Promise<boolean> {
  const sp = await loadSavedPosts(workspaceId);
  const key = normalizeBody(body);
  return sp.posts.some((p) => normalizeBody(p.body) === key);
}

/**
 * Render saved posts as a GOLD-STANDARD exemplar block for generation prompts.
 * These are the user's verified bar and should be imitated most strongly. We
 * cap the count and length so the prompt stays focused.
 */
export function renderSavedExemplars(sp: SavedPosts, max = 4): string {
  if (!sp.posts.length) return "";
  const chosen = sp.posts.slice(0, max);
  const block = chosen
    .map((p, i) => {
      const why = p.note ? ` (why it's a standard: ${p.note})` : "";
      return `GOLD STANDARD ${i + 1}${why}:\n${p.body}`;
    })
    .join("\n---\n");
  return `VERIFIED GOLD-STANDARD POSTS, the user explicitly saved these as the bar. Match their voice, structure, length, and rhythm MORE closely than anything else:\n${block}`;
}
