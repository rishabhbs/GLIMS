/**
 * Audience model — who the Studio writes for, and corrections to persona
 * assumptions.
 *
 * The generator can make wrong assumptions about the audience (e.g. "senior
 * analysts never run tests" — false in small labs where everyone does
 * everything). These corrections aren't product facts or world facts; they're
 * about WHO we're writing for. This store captures them and injects them into
 * generation so posts don't mischaracterize the reader.
 *
 * Persistence: a per-workspace row in `studio_state` (key `audience_model`).
 */
import { Repositories } from "@/db/repositories";

export interface AudienceNote {
  id: string;
  /** A standalone statement about the audience, e.g. "In small labs, senior analysts also run tests themselves." */
  statement: string;
  source: string;
  createdAt: string;
}

export interface AudienceModel {
  workspaceId: string;
  notes: AudienceNote[];
  updatedAt: string;
}

const KEY = "audience_model";

function now(): string {
  return new Date().toISOString();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export async function loadAudienceModel(workspaceId: string): Promise<AudienceModel> {
  const value = await new Repositories().getStudioState<AudienceModel>(workspaceId, KEY);
  if (value && Array.isArray(value.notes)) {
    return { workspaceId, notes: value.notes, updatedAt: value.updatedAt };
  }
  return { workspaceId, notes: [], updatedAt: now() };
}

async function save(am: AudienceModel): Promise<void> {
  am.updatedAt = now();
  await new Repositories().setStudioState(am.workspaceId, KEY, am);
}

export async function addAudienceNotes(
  workspaceId: string,
  additions: Array<{ statement: string; source?: string }>,
): Promise<AudienceModel> {
  const am = await loadAudienceModel(workspaceId);
  const existing = new Set(am.notes.map((n) => normalize(n.statement)));
  for (const a of additions) {
    const statement = a.statement.trim();
    if (!statement || existing.has(normalize(statement))) continue;
    existing.add(normalize(statement));
    am.notes.unshift({
      id: `au_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      statement,
      source: (a.source ?? "manual").trim(),
      createdAt: now(),
    });
  }
  await save(am);
  return am;
}

export async function updateAudienceNote(workspaceId: string, id: string, statement: string): Promise<AudienceModel> {
  const am = await loadAudienceModel(workspaceId);
  const note = am.notes.find((n) => n.id === id);
  if (note && statement.trim()) {
    note.statement = statement.trim();
    await save(am);
  }
  return am;
}

export async function removeAudienceNote(workspaceId: string, id: string): Promise<AudienceModel> {
  const am = await loadAudienceModel(workspaceId);
  am.notes = am.notes.filter((n) => n.id !== id);
  await save(am);
  return am;
}

/** Render the audience model as a grounding block for generation prompts. */
export function renderAudienceModel(am: AudienceModel): string {
  if (!am.notes.length) return "";
  return (
    `AUDIENCE UNDERSTANDING (who you are writing for, respect these, do not contradict them):\n` +
    am.notes.map((n) => `- ${n.statement}`).join("\n")
  );
}
