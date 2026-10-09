import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ask a grounded question within a conversation. Persists messages + grounding. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      conversationId?: string;
      question?: string;
      researchMode?: "auto" | "always" | "never";
    };
    if (!body.question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
    const brain = getBrainService();
    let conversationId = body.conversationId;
    if (!conversationId) {
      conversationId = (await brain.createConversation()).conversationId;
    }
    const answer = await brain.answerQuestion({
      conversationId,
      question: body.question,
      researchMode: body.researchMode ?? "auto",
    });
    return NextResponse.json(answer);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
