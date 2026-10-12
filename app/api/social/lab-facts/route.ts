import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { LabFact, LabFactKind } from "@/brain/social/lab-facts";

export const dynamic = "force-dynamic";

/** GET: the real-world lab facts (truths + misconceptions to avoid). */
export async function GET() {
  try {
    const lf = await getBrainService().getLabFacts();
    return NextResponse.json(lf);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** POST: add a fact. Body: { statement, kind: "truth"|"avoid", source? }. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { statement?: string; kind?: LabFactKind; source?: string };
    if (!b.statement?.trim()) return NextResponse.json({ error: "statement is required" }, { status: 400 });
    const kind: LabFactKind = b.kind === "avoid" ? "avoid" : "truth";
    const lf = await getBrainService().addLabFacts([{ statement: b.statement.trim(), kind, source: b.source }]);
    return NextResponse.json(lf);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** PATCH: edit a fact. Body: { id, statement?, kind? }. */
export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as { id?: string } & Partial<Pick<LabFact, "statement" | "kind">>;
    if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const { id, ...patch } = b;
    const lf = await getBrainService().updateLabFact(id, patch);
    return NextResponse.json(lf);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** DELETE ?id=... : remove a fact. */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const lf = await getBrainService().removeLabFact(id);
    return NextResponse.json(lf);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
