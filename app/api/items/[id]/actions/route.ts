import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { KnowledgeStatus } from "@/brain/types";

export const dynamic = "force-dynamic";

/**
 * Curation actions on an item: status change, archive, invalidate, relate, merge.
 * Body: { action: 'status'|'archive'|'invalidate'|'relate'|'merge', ... }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const brain = getBrainService();

    switch (body.action) {
      case "status":
        await brain.setItemStatus({ id, status: body.status as KnowledgeStatus, actor: body.actor });
        break;
      case "archive":
        await brain.setItemStatus({ id, status: "archived", actor: body.actor });
        break;
      case "invalidate":
        await brain.setItemStatus({ id, status: "invalidated", actor: body.actor });
        break;
      case "relate":
        await brain.relateItems({
          fromItemId: id,
          toItemId: body.toItemId,
          relationshipType: body.relationshipType,
          note: body.note,
          createdBy: body.actor,
        });
        break;
      case "merge":
        await brain.mergeItems({ keepItemId: id, mergeItemId: body.mergeItemId, mergedBy: body.actor });
        break;
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
