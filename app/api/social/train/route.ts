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

/**
 * POST: generate the next training post.
 * Body: { topic?: string; keepTopic?: boolean; focus?: string (legacy) }.
 *  - topic: the explicit prompt the post is built on (blank = AI picks).
 *  - keepTopic: "redo body" — reuse the pending post's topic, keep its media.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      topic?: string;
      keepTopic?: boolean;
      note?: string;
      focus?: string;
    };
    const post = await getBrainService().generateTrainingPost({
      topic: b.topic,
      keepTopic: b.keepTopic,
      note: b.note,
      focus: b.focus,
    });
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
