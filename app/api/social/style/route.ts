import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const guide = await getBrainService().getStyleGuide();
    return NextResponse.json(guide);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { rule?: string };
    if (!b.rule?.trim()) return NextResponse.json({ error: "rule is required" }, { status: 400 });
    const guide = await getBrainService().addStyleRule(b.rule.trim());
    return NextResponse.json(guide);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const guide = await getBrainService().removeStyleRule(id);
    return NextResponse.json(guide);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
