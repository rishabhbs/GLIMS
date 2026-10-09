import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** HTTP mirror of BrainService.listConversations / createConversation. */
export async function GET() {
  try {
    const conversations = await getBrainService().listConversations();
    return NextResponse.json({ conversations });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const result = await getBrainService().createConversation(body.title);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
