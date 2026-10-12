/**
 * Global instructions — the Studio's base writing policy, as EDITABLE DATA.
 *
 * Historically these lived as hardcoded system-prompt string literals
 * (TRAIN_SYSTEM / DRAFT_SYSTEM / REVISE_SYSTEM / PLAN_SYSTEM / VOICE_RULES).
 * That made them invisible and uneditable, and meant every learned/distilled
 * preference had to silently FIGHT them. This module makes the base policy a
 * first-class, workspace-scoped, user-editable list of rules.
 *
 * Two layers of instruction now exist, both as data:
 *   1. GLOBAL INSTRUCTIONS (this module) — the durable base policy applied to
 *      every post. Visible + editable in Admin.
 *   2. LEARNED STYLE GUIDE (./style-guide) — preferences distilled from the
 *      user's feedback over time.
 *
 * When a distilled preference would CONTRADICT a global instruction, the system
 * does not silently apply it or silently fight it. It detects the conflict and
 * asks the user whether to apply it to this post only, or to update the global
 * instruction (see detectInstructionConflict + the conversation layer).
 *
 * Persistence: a per-workspace row in `studio_state` (key `global_instructions`).
 */
import { Repositories } from "@/db/repositories";
import type { ModelProvider } from "@/providers";

export type InstructionCategory = "identity" | "grounding" | "voice" | "format" | "structure";

export interface GlobalInstruction {
  id: string;
  /** Short human label shown in Admin, e.g. "Post length & paragraph shape". */
  title: string;
  /** The actual instruction text injected into the prompt. */
  text: string;
  category: InstructionCategory;
  /** Disabled rules are kept (for history) but not injected into prompts. */
  enabled: boolean;
  /**
   * Grounding/identity rules are the Brain's non-negotiable guardrails ("never
   * invent", "cite everything"). They can be edited but are flagged so the UI
   * can warn before weakening them, and conflict-resolution never offers to
   * silently drop them.
   */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalInstructions {
  workspaceId: string;
  instructions: GlobalInstruction[];
  updatedAt: string;
}

const KEY = "global_instructions";

function now(): string {
  return new Date().toISOString();
}

function mkId(): string {
  return `gi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The seed policy. This is the SAME content that used to be hardcoded in the
 * prompt literals, broken into named, categorized, editable rules. Seeding on
 * first load means behavior is identical on day one, but now everything is
 * visible and editable.
 */
function seedInstructions(): Omit<GlobalInstruction, "id" | "createdAt" | "updatedAt">[] {
  return [
    {
      title: "Subject & audience",
      category: "identity",
      enabled: true,
      locked: false,
      text: `Every post is about "Sampleify", a LIMS (lab information management system). Write for a working lab owner / QA manager, not a marketing audience. Sound like one practitioner talking to another: concrete, a little blunt, no hype.`,
    },
    {
      title: "Grounding — never invent",
      category: "grounding",
      enabled: true,
      locked: true,
      text: `Compose ONLY from the provided KNOWLEDGE items. Never invent capabilities, metrics, customer results, or any factual claim. Every factual claim MUST be backed by a knowledge marker [n] listed in citationMarkers. Prefer saying less over stating something unsupported.`,
    },
    {
      title: "Specific beats generic",
      category: "voice",
      enabled: true,
      locked: false,
      text: `Specific beats general, every time. If a line could appear on any competitor's page, rewrite it from a concrete, real detail (a named workflow stage, an actual setting, a real step a lab does). High-entropy, not smooth filler.`,
    },
    {
      title: "Banned words",
      category: "voice",
      enabled: true,
      locked: false,
      text: `Never use: delve, utilize, leverage, robust, streamline, harness, foster, enhance, underscore, pivotal, crucial, intricate, testament, groundbreaking, transformative, innovative, comprehensive, seamless, revolutionize, game-changing, unlock, empower, elevate, supercharge, best-in-class, industry-leading, cutting-edge.`,
    },
    {
      title: "Banned sentence shapes",
      category: "voice",
      enabled: true,
      locked: false,
      text: `Never use these shapes: "It's not X, it's Y" (negative parallelism); "Not X. Not Y. Just Z."; rhetorical question-then-answer ("The result? Devastating."); repeating the same sentence opener; forcing everything into threes; "-ing" tails implying significance ("...reflecting broader trends"); fake ranges ("from X to Y" where they aren't a scale).`,
    },
    {
      title: "Banned openers, fluff & CTA clichés",
      category: "voice",
      enabled: true,
      locked: false,
      text: `Never open/transition with "Here's the thing", "Here's the kicker", "Here's what most people miss", "Imagine a world where", "Let's dive in", "Let's unpack", "It's worth noting", "Importantly". No marketing fluff ("streamline your workflow", "boost efficiency", "end-to-end solution", "take your lab to the next level", vague "trusted by thousands"). No CTA clichés ("Don't miss out", "Start your journey", "Take the next step"). If you close, make it plain and specific, or skip the CTA.`,
    },
    {
      title: "No em-dashes",
      category: "voice",
      enabled: true,
      locked: false,
      text: `Do not use em-dashes or en-dashes at all. Use commas, periods, or parentheses instead.`,
    },
    {
      title: "Post length & paragraph shape",
      category: "format",
      enabled: true,
      locked: false,
      text: `Format like a real LinkedIn post, not an essay: a punchy one-line hook, then a BLANK LINE, then short paragraphs of 1-2 sentences each, every paragraph separated by a BLANK LINE. 3-7 short blocks for a typical post. Use literal newline characters in the "body" string (\\n between lines, \\n\\n between paragraphs). Never a single wall of text, and don't write entirely in one-sentence paragraphs or start every line with a bold label.`,
    },
  ];
}

export async function loadGlobalInstructions(workspaceId: string): Promise<GlobalInstructions> {
  const value = await new Repositories().getStudioState<GlobalInstructions>(workspaceId, KEY);
  if (value && Array.isArray(value.instructions) && value.instructions.length) {
    return { workspaceId, instructions: value.instructions, updatedAt: value.updatedAt };
  }
  // First access: seed from the base policy and persist so it's editable.
  const seeded: GlobalInstructions = {
    workspaceId,
    instructions: seedInstructions().map((s) => ({ ...s, id: mkId(), createdAt: now(), updatedAt: now() })),
    updatedAt: now(),
  };
  await new Repositories().setStudioState(workspaceId, KEY, seeded);
  return seeded;
}

export async function saveGlobalInstructions(gi: GlobalInstructions): Promise<void> {
  gi.updatedAt = now();
  await new Repositories().setStudioState(gi.workspaceId, KEY, gi);
}

export async function addGlobalInstruction(
  workspaceId: string,
  input: { title: string; text: string; category?: InstructionCategory },
): Promise<GlobalInstructions> {
  const gi = await loadGlobalInstructions(workspaceId);
  gi.instructions.push({
    id: mkId(),
    title: input.title.trim() || "Untitled rule",
    text: input.text.trim(),
    category: input.category ?? "voice",
    enabled: true,
    locked: false,
    createdAt: now(),
    updatedAt: now(),
  });
  await saveGlobalInstructions(gi);
  return gi;
}

export async function updateGlobalInstruction(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<GlobalInstruction, "title" | "text" | "category" | "enabled">>,
): Promise<GlobalInstructions> {
  const gi = await loadGlobalInstructions(workspaceId);
  const inst = gi.instructions.find((i) => i.id === id);
  if (!inst) throw new Error(`global instruction not found: ${id}`);
  if (typeof patch.title === "string") inst.title = patch.title.trim() || inst.title;
  if (typeof patch.text === "string") inst.text = patch.text.trim();
  if (typeof patch.category === "string") inst.category = patch.category;
  if (typeof patch.enabled === "boolean") inst.enabled = patch.enabled;
  inst.updatedAt = now();
  await saveGlobalInstructions(gi);
  return gi;
}

export async function removeGlobalInstruction(workspaceId: string, id: string): Promise<GlobalInstructions> {
  const gi = await loadGlobalInstructions(workspaceId);
  const inst = gi.instructions.find((i) => i.id === id);
  if (inst?.locked) throw new Error("cannot delete a locked guardrail instruction; disable it instead");
  gi.instructions = gi.instructions.filter((i) => i.id !== id);
  await saveGlobalInstructions(gi);
  return gi;
}

/** Reset to the seeded base policy (Admin "restore defaults"). */
export async function resetGlobalInstructions(workspaceId: string): Promise<GlobalInstructions> {
  const seeded: GlobalInstructions = {
    workspaceId,
    instructions: seedInstructions().map((s) => ({ ...s, id: mkId(), createdAt: now(), updatedAt: now() })),
    updatedAt: now(),
  };
  await saveGlobalInstructions(seeded);
  return seeded;
}

/**
 * Render the enabled global instructions as the base system prompt. This
 * REPLACES the old hardcoded prompt literals: every generation path builds its
 * system prompt from here plus a task-specific tail.
 */
export function renderGlobalInstructions(gi: GlobalInstructions): string {
  const active = gi.instructions.filter((i) => i.enabled);
  if (!active.length) return "";
  const lines = active.map((i) => `- (${i.category}) ${i.text}`).join("\n");
  return `GLOBAL WRITING INSTRUCTIONS — these are the base policy for every post; follow ALL of them:\n${lines}`;
}

// ── conflict detection ──────────────────────────────────────────────────────

export interface InstructionConflict {
  /** The global instruction the candidate preference contradicts. */
  instructionId: string;
  instructionTitle: string;
  instructionText: string;
  /** One-line, plain-language explanation of the contradiction. */
  explanation: string;
}

const CONFLICT_SYSTEM = `You decide whether a NEW writing preference (distilled from a user's feedback) CONTRADICTS any existing GLOBAL INSTRUCTION for writing LinkedIn posts.
A contradiction means following the new preference would require violating or materially weakening a specific global instruction (e.g. the global says "3-7 paragraphs" and the preference says "keep it to one short paragraph"; or the global bans a word the preference now wants).
A preference that merely ADDS detail, or is unrelated, or is already compatible, is NOT a conflict.
Pick AT MOST ONE global instruction — the single one most directly contradicted. If none is contradicted, return conflict=false.
OUTPUT ONLY JSON: { "conflict": boolean, "instructionId": string|null, "explanation": string }
"explanation" is one short plain sentence a non-technical user would understand. "instructionId" must be one of the provided ids or null.`;

/**
 * Ask the model whether `candidateRule` contradicts any enabled global
 * instruction. Returns the single most-contradicted instruction, or null.
 * Locked guardrail instructions are never offered as "update global" targets,
 * but a candidate that fights them still surfaces (so the user sees why it was
 * rejected) — handled by the caller.
 */
export async function detectInstructionConflict(
  candidateRule: string,
  gi: GlobalInstructions,
  provider: ModelProvider,
): Promise<InstructionConflict | null> {
  const active = gi.instructions.filter((i) => i.enabled);
  if (!active.length || !candidateRule.trim()) return null;

  const list = active.map((i) => `id=${i.id} | ${i.title}: ${i.text}`).join("\n");
  const user = `GLOBAL INSTRUCTIONS:\n${list}\n\nNEW PREFERENCE (from user feedback):\n"${candidateRule.trim()}"\n\nDoes it contradict one of the global instructions?`;

  let raw: { conflict?: unknown; instructionId?: unknown; explanation?: unknown };
  try {
    const res = await provider.chat(
      [
        { role: "system", content: CONFLICT_SYSTEM },
        { role: "user", content: user },
      ],
      { temperature: 0, maxTokens: 300 },
    );
    let t = res.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
    raw = JSON.parse(t);
  } catch {
    return null; // fail open: no detected conflict, behave as before
  }

  if (raw.conflict !== true) return null;
  const id = typeof raw.instructionId === "string" ? raw.instructionId : null;
  const inst = active.find((i) => i.id === id);
  if (!inst) return null;
  return {
    instructionId: inst.id,
    instructionTitle: inst.title,
    instructionText: inst.text,
    explanation: typeof raw.explanation === "string" ? raw.explanation.trim() : "This preference conflicts with a global instruction.",
  };
}
