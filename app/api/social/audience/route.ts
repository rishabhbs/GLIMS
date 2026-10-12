import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** GET: the audience model (who the Studio writes for). */
export async function GET() {
  try {
    const am = await getBrainService().getAudienceModel();
    return NextResponse.json(am);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** POST: add an audience note. Body: { statement }. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { statement?: string };
    if (!b.statement?.trim()) return NextResponse.json({ error: "statement is required" }, { status: 400 });
    const am = await getBrainService().addAudienceNotes([b.statement.trim()]);
    return NextResponse.json(am);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** PATCH: edit a note. Body: { id, statement }. */
export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as { id?: string; statement?: string };
    if (!b.id || !b.statement?.trim()) return NextResponse.json({ error: "id and statement are required" }, { status: 400 });
    const am = await getBrainService().updateAudienceNote(b.id, b.statement.trim());
    return NextResponse.json(am);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** DELETE ?id=... : remove a note. */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const am = await getBrainService().removeAudienceNote(id);
    return NextResponse.json(am);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
