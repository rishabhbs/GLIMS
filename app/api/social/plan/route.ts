import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      brief?: string;
      startDate?: string;
      endDate?: string;
      postsPerDay?: number;
      weekdaysOnly?: boolean;
      existing?: Array<{ theme: string; angle: string }>;
    };
    if (!b.startDate || !b.endDate) {
      return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
    }
    const result = await getBrainService().planCalendar({
      brief: b.brief ?? "",
      startDate: b.startDate,
      endDate: b.endDate,
      postsPerDay: Math.max(1, Math.min(4, Number(b.postsPerDay) || 1)),
      weekdaysOnly: Boolean(b.weekdaysOnly),
      existing: Array.isArray(b.existing) ? b.existing : [],
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
