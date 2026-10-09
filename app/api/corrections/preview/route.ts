import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** STAGE 1 of teaching: identify affected items + propose the change. Writes nothing. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { conversationId?: string; messageId?: string; correctionText?: string };
    if (!body.conversationId || !body.correctionText?.trim()) {
      return NextResponse.json({ error: "conversationId and correctionText are required" }, { status: 400 });
    }
    const preview = await getBrainService().previewCorrection({
      conversationId: body.conversationId,
      messageId: body.messageId ?? null,
      correctionText: body.correctionText,
    });
    return NextResponse.json({ preview });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
