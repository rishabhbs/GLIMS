import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Resolve a training feedback conflict with a global instruction.
 * Body: {
 *   resolution: "this_post_only" | "update_global",
 *   candidateRule: string,
 *   instructionId?: string,       // required for update_global
 *   newInstructionText?: string,  // optional override text for update_global
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      resolution?: "this_post_only" | "update_global";
      candidateRule?: string;
      instructionId?: string;
      newInstructionText?: string;
    };
    if (b.resolution !== "this_post_only" && b.resolution !== "update_global") {
      return NextResponse.json({ error: "resolution must be this_post_only or update_global" }, { status: 400 });
    }
    if (!b.candidateRule) {
      return NextResponse.json({ error: "candidateRule is required" }, { status: 400 });
    }
    const result = await getBrainService().resolveInstructionConflict({
      resolution: b.resolution,
      candidateRule: b.candidateRule,
      instructionId: b.instructionId,
      newInstructionText: b.newInstructionText,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
