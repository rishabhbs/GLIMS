import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Save the post currently open in the Playground as a gold standard, storing
 * its full conversation so it can be reopened and refined later.
 * Body: { note?: string }.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as { note?: string };
    const result = await getBrainService().savePlaygroundPost(b.note);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
