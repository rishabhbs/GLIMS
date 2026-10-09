import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** Promote a web research finding into the Brain (explicit, never automatic). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      findingId?: string;
      entityType?: string;
      title?: string;
      claim?: string;
    };
    if (!body.findingId || !body.entityType || !body.title?.trim() || !body.claim?.trim()) {
      return NextResponse.json(
        { error: "findingId, entityType, title and claim are required" },
        { status: 400 },
      );
    }
    const result = await getBrainService().promoteFinding({
      findingId: body.findingId,
      entityType: body.entityType,
      title: body.title,
      claim: body.claim,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
