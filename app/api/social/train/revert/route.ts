import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Revert the current post's body to an earlier turn's output. Body: { turnId }. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { turnId?: string; productId?: string };
    if (!b.turnId) return NextResponse.json({ error: "turnId is required" }, { status: 400 });
    const state = await getBrainService().revertToTurn(b.turnId, b.productId);
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
