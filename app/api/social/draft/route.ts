import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { CalSlot } from "@/brain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      slots?: Array<Pick<CalSlot, "id" | "date" | "index" | "theme" | "angle">>;
      brief?: string;
      length?: "short" | "standard";
      existingBodies?: string[];
    };
    if (!Array.isArray(b.slots) || b.slots.length === 0) {
      return NextResponse.json({ error: "slots are required" }, { status: 400 });
    }
    const result = await getBrainService().draftPosts({
      slots: b.slots,
      brief: b.brief ?? "",
      length: b.length === "standard" ? "standard" : "short",
      existingBodies: Array.isArray(b.existingBodies) ? b.existingBodies : [],
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
