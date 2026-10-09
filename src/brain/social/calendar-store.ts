/**
 * Persistent social calendar — stores the user's working calendar (slots +
 * drafted posts + citations) so it survives reloads and server restarts.
 *
 * Lightweight durable store: a JSON file under the workspace, keyed by
 * workspace_id (same approach as the style guide). Can be promoted to a DB
 * table later for multi-user. This is what makes "see the content already
 * loaded in the Studio" work.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CalSlot, CalCitation } from "./calendar";

export interface StoredCalendar {
  workspaceId: string;
  slots: CalSlot[];
  citations: CalCitation[];
  brief: string;
  updatedAt: string;
}

const DIR = path.join(process.cwd(), ".studio");

function fileFor(workspaceId: string) {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DIR, `calendar.${safe}.json`);
}

export async function loadCalendar(workspaceId: string): Promise<StoredCalendar> {
  try {
    const raw = await fs.readFile(fileFor(workspaceId), "utf8");
    const parsed = JSON.parse(raw) as StoredCalendar;
    if (Array.isArray(parsed.slots)) {
      return {
        workspaceId,
        slots: parsed.slots,
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        brief: typeof parsed.brief === "string" ? parsed.brief : "",
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    // no calendar yet
  }
  return { workspaceId, slots: [], citations: [], brief: "", updatedAt: new Date().toISOString() };
}

export async function saveCalendar(
  workspaceId: string,
  data: { slots: CalSlot[]; citations: CalCitation[]; brief: string },
): Promise<StoredCalendar> {
  await fs.mkdir(DIR, { recursive: true });
  const stored: StoredCalendar = {
    workspaceId,
    slots: data.slots,
    citations: data.citations,
    brief: data.brief,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(fileFor(workspaceId), JSON.stringify(stored, null, 2), "utf8");
  return stored;
}

export async function clearCalendar(workspaceId: string): Promise<void> {
  try {
    await fs.unlink(fileFor(workspaceId));
  } catch {
    // already gone
  }
}
