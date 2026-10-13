import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: current training state for the active product. ?product=<id> */
export async function GET(req: NextRequest) {
  try {
    const productId = new URL(req.url).searchParams.get("product") ?? undefined;
    const state = await getBrainService().getTraining(productId);
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/**
 * POST: generate the next training post for the active product.
 * Body: { topic?; keepTopic?; note?; focus? (legacy); productId? }.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      topic?: string;
      keepTopic?: boolean;
      note?: string;
      focus?: string;
      productId?: string;
    };
    const post = await getBrainService().generateTrainingPost({
      topic: b.topic,
      keepTopic: b.keepTopic,
      note: b.note,
      focus: b.focus,
      productId: b.productId,
    });
    return NextResponse.json(post);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** DELETE: reset the active product's training history. ?product=<id> */
export async function DELETE(req: NextRequest) {
  try {
    const productId = new URL(req.url).searchParams.get("product") ?? undefined;
    await getBrainService().resetTraining(productId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
