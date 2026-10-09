import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: current training state (history + any pending post). */
export async function GET() {
  try {
    const state = await getBrainService().getTraining();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** POST: generate the next training post. Body: { focus?: string }. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as { focus?: string };
    const post = await getBrainService().generateTrainingPost({ focus: b.focus });
    return NextResponse.json(post);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** DELETE: reset the training history. */
export async function DELETE() {
  try {
    await getBrainService().resetTraining();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
