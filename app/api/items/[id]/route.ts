import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** Get an item with provenance + related items. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const item = await getBrainService().getItem(id);
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    const history = await getBrainService().getItemHistory(id);
    return NextResponse.json({ item, history });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** Edit item (versioned, audited; flips source_classification to human). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    await getBrainService().editItem({ id, ...body });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
