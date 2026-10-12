import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { CorrectionCategory } from "@/brain/social/correction-router";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Confirm a routed correction. The router classified the correction during
 * "redo body"; here the user has approved it, so it is written to the right
 * memory (product graph / lab facts / audience model / style guide).
 * Body: { category, statement, avoid?, note? }.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      category?: CorrectionCategory;
      statement?: string;
      avoid?: string;
      note?: string;
    };
    const valid: CorrectionCategory[] = ["product", "world", "audience", "style"];
    if (!b.category || !valid.includes(b.category)) {
      return NextResponse.json({ error: "a valid category is required" }, { status: 400 });
    }
    if (!b.statement?.trim() && !b.avoid?.trim()) {
      return NextResponse.json({ error: "statement or avoid is required" }, { status: 400 });
    }
    const result = await getBrainService().confirmStudioCorrection({
      category: b.category,
      statement: b.statement ?? "",
      avoid: b.avoid,
      note: b.note,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
