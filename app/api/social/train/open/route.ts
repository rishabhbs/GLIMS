import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Open a saved post into the Playground as the active post, restoring its full
 * conversation. The currently-open post is auto-saved first. Body: { savedId }.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { savedId?: string; productId?: string };
    if (!b.savedId) return NextResponse.json({ error: "savedId is required" }, { status: 400 });
    const state = await getBrainService().openSavedPost(b.savedId, b.productId);
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
