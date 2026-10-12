import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { GlobalInstruction, InstructionCategory } from "@/brain/social/global-instructions";

export const dynamic = "force-dynamic";

/** GET: the editable global writing instructions (base policy). */
export async function GET() {
  try {
    const gi = await getBrainService().getGlobalInstructions();
    return NextResponse.json(gi);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** POST: add a new instruction, OR reset to defaults ({ reset: true }). */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      reset?: boolean;
      title?: string;
      text?: string;
      category?: InstructionCategory;
    };
    if (b.reset) {
      const gi = await getBrainService().resetGlobalInstructions();
      return NextResponse.json(gi);
    }
    if (!b.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });
    const gi = await getBrainService().addGlobalInstruction({
      title: b.title ?? "Untitled rule",
      text: b.text.trim(),
      category: b.category,
    });
    return NextResponse.json(gi);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** PATCH: edit an instruction (title/text/category/enabled). Body: { id, ...patch }. */
export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      id?: string;
    } & Partial<Pick<GlobalInstruction, "title" | "text" | "category" | "enabled">>;
    if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const { id, ...patch } = b;
    const gi = await getBrainService().updateGlobalInstruction(id, patch);
    return NextResponse.json(gi);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** DELETE ?id=... : remove an instruction (locked guardrails cannot be deleted). */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const gi = await getBrainService().removeGlobalInstruction(id);
    return NextResponse.json(gi);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
