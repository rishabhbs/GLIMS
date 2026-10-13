import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST a rating+feedback for the current training post. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      postId?: string;
      theme?: string;
      body?: string;
      rating?: number;
      feedback?: string;
      productId?: string;
    };
    if (!b.body || typeof b.rating !== "number") {
      return NextResponse.json({ error: "body and rating are required" }, { status: 400 });
    }
    const result = await getBrainService().submitTrainingFeedback({
      postId: b.postId ?? `t_${Date.now().toString(36)}`,
      theme: b.theme ?? "",
      body: b.body,
      rating: b.rating,
      feedback: b.feedback,
      productId: b.productId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
