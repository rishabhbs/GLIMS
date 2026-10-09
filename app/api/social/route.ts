import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { StudioArtifact, StudioHistoryMessage } from "@/brain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Social Media Studio turn. Stateless on the server: the client carries the
 * conversation history + current working artifact, and gets back the Studio's
 * reply, any clarifying questions, and the (possibly updated) artifact.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      history?: StudioHistoryMessage[];
      currentArtifact?: StudioArtifact | null;
    };
    if (!body.message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const result = await getBrainService().studioTurn({
      message: body.message,
      history: Array.isArray(body.history) ? body.history : [],
      currentArtifact: body.currentArtifact ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
