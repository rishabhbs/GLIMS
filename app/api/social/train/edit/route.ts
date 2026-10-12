import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Inline-edit an assistant body turn verbatim (no model call). The edited text
 * becomes the current post body. Body: { turnId, body }.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { turnId?: string; body?: string };
    if (!b.turnId || typeof b.body !== "string") {
      return NextResponse.json({ error: "turnId and body are required" }, { status: 400 });
    }
    const state = await getBrainService().editTurnBody(b.turnId, b.body);
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
