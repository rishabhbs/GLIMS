/**
 * Persistent social calendar — stores the user's working calendar (slots +
 * drafted posts + citations) so it survives reloads and server restarts.
 *
 * Durable store: a per-workspace row in the `studio_state` table (key
 * `calendar`), reached through the repository layer (same approach as the
 * style guide). This is what makes "see the content already loaded in the
 * Studio" work, and it survives serverless invocations where a local JSON
 * file would not.
 */
import { Repositories } from "@/db/repositories";
import type { CalSlot, CalCitation } from "./calendar";

export interface StoredCalendar {
  workspaceId: string;
  slots: CalSlot[];
  citations: CalCitation[];
  brief: string;
  updatedAt: string;
}

export async function loadCalendar(workspaceId: string): Promise<StoredCalendar> {
  const value = await new Repositories().getStudioState<StoredCalendar>(workspaceId, "calendar");
  if (value && Array.isArray(value.slots)) {
    return {
      workspaceId,
      slots: value.slots,
      citations: Array.isArray(value.citations) ? value.citations : [],
      brief: typeof value.brief === "string" ? value.brief : "",
      updatedAt: value.updatedAt ?? new Date().toISOString(),
    };
  }
  return { workspaceId, slots: [], citations: [], brief: "", updatedAt: new Date().toISOString() };
}

export async function saveCalendar(
  workspaceId: string,
  data: { slots: CalSlot[]; citations: CalCitation[]; brief: string },
): Promise<StoredCalendar> {
  const stored: StoredCalendar = {
    workspaceId,
    slots: data.slots,
    citations: data.citations,
    brief: data.brief,
    updatedAt: new Date().toISOString(),
  };
  await new Repositories().setStudioState(workspaceId, "calendar", stored);
  return stored;
}

export async function clearCalendar(workspaceId: string): Promise<void> {
  await new Repositories().deleteStudioState(workspaceId, "calendar");
}
