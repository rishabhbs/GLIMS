import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Generate an AI-authored SVG graphic for a post body. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { body?: string; theme?: string; direction?: string; postId?: string; record?: boolean };
    if (!b.body?.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }
    const result = await getBrainService().generateGraphic({
      body: b.body,
      theme: b.theme,
      direction: b.direction,
      postId: b.postId,
      // record === false for the auto-graphic that fires on a fresh post, so it
      // doesn't add a redundant media turn to the conversation.
      record: b.record,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
