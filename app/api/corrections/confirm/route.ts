import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { ProposedChange } from "@/brain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** STAGE 2 of teaching: apply the APPROVED changes. Only called after explicit confirm. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      conversationId?: string;
      messageId?: string;
      correctionText?: string;
      proposedChanges?: ProposedChange[];
    };
    if (!body.conversationId || !body.correctionText?.trim() || !Array.isArray(body.proposedChanges)) {
      return NextResponse.json(
        { error: "conversationId, correctionText and proposedChanges are required" },
        { status: 400 },
      );
    }
    const result = await getBrainService().confirmCorrection({
      conversationId: body.conversationId,
      messageId: body.messageId ?? null,
      correctionText: body.correctionText,
      proposedChanges: body.proposedChanges,
    });
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
