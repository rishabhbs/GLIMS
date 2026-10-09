import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** Get a conversation with its messages. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const conversation = await getBrainService().getConversation(id);
    if (!conversation) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
