import { NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** List research sessions with their queries + findings (inspectable history). */
export async function GET() {
  try {
    const sessions = await getBrainService().listResearchSessions();
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
