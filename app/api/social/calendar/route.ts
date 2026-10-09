import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { CalSlot, CalCitation } from "@/brain/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cal = await getBrainService().getCalendar();
    return NextResponse.json(cal);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const b = (await req.json()) as { slots?: CalSlot[]; citations?: CalCitation[]; brief?: string };
    const cal = await getBrainService().saveCalendar({
      slots: Array.isArray(b.slots) ? b.slots : [],
      citations: Array.isArray(b.citations) ? b.citations : [],
      brief: typeof b.brief === "string" ? b.brief : "",
    });
    return NextResponse.json(cal);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await getBrainService().clearCalendar();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
