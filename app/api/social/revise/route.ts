import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { CalSlot } from "@/brain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      slot?: Pick<CalSlot, "id" | "date" | "theme" | "angle" | "body" | "hashtags">;
      instruction?: string;
    };
    if (!b.slot?.id || !b.instruction?.trim()) {
      return NextResponse.json({ error: "slot and instruction are required" }, { status: 400 });
    }
    const result = await getBrainService().revisePost({ slot: b.slot, instruction: b.instruction });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
