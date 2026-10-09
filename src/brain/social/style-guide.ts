/**
 * Studio style guide — persistent, learned writing preferences.
 *
 * Every time the user revises a post, the Studio distills a reusable style RULE
 * from their instruction (e.g. "lead with the problem, not the product") and
 * stores it here. The guide is then injected into every future draft and
 * revision so the Studio remembers what the user likes/dislikes — the style you
 * dialed in on one post carries to all posts.
 *
 * Persistence: a per-workspace row in the `studio_state` table (key
 * `style_guide`), reached through the repository layer. Durable across
 * restarts and serverless invocations (the previous local JSON file
 * approach fails on read-only serverless filesystems).
 */
import { Repositories } from "@/db/repositories";

export interface StyleRule {
  id: string;
  /** The reusable, generalized guidance (not the raw instruction). */
  rule: string;
  /** The original instruction that produced it, for provenance. */
  source: string;
  createdAt: string;
}

export interface StyleGuide {
  workspaceId: string;
  rules: StyleRule[];
  updatedAt: string;
}

export async function loadStyleGuide(workspaceId: string): Promise<StyleGuide> {
  const value = await new Repositories().getStudioState<StyleGuide>(workspaceId, "style_guide");
  if (value && Array.isArray(value.rules)) {
    return { workspaceId, rules: value.rules, updatedAt: value.updatedAt };
  }
  return { workspaceId, rules: [], updatedAt: new Date().toISOString() };
}

export async function saveStyleGuide(guide: StyleGuide): Promise<void> {
  guide.updatedAt = new Date().toISOString();
  await new Repositories().setStudioState(guide.workspaceId, "style_guide", guide);
}

/** Add rules, de-duplicating against near-identical existing ones. */
export async function addStyleRules(
  workspaceId: string,
  additions: Array<{ rule: string; source: string }>,
): Promise<StyleGuide> {
  const guide = await loadStyleGuide(workspaceId);
  const existing = new Set(guide.rules.map((r) => normalize(r.rule)));
  for (const a of additions) {
    const rule = a.rule.trim();
    if (!rule || existing.has(normalize(rule))) continue;
    existing.add(normalize(rule));
    guide.rules.push({
      id: `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      rule,
      source: a.source,
      createdAt: new Date().toISOString(),
    });
  }
  // Keep the guide focused — cap at the most recent 40 rules.
  if (guide.rules.length > 40) guide.rules = guide.rules.slice(-40);
  await saveStyleGuide(guide);
  return guide;
}

export async function removeStyleRule(workspaceId: string, ruleId: string): Promise<StyleGuide> {
  const guide = await loadStyleGuide(workspaceId);
  guide.rules = guide.rules.filter((r) => r.id !== ruleId);
  await saveStyleGuide(guide);
  return guide;
}

/** Render the guide as a prompt block for drafting/revision. Empty string if none. */
export function renderStyleGuide(guide: StyleGuide): string {
  if (!guide.rules.length) return "";
  const lines = guide.rules.map((r) => `- ${r.rule}`).join("\n");
  return `LEARNED STYLE GUIDE — the user has taught these preferences; follow ALL of them:\n${lines}`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

