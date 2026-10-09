import { NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** HTTP mirror of BrainService.getTaxonomyCounts (contract parity, req 11.4). */
export async function GET() {
  try {
    const taxonomy = await getBrainService().getTaxonomyCounts();
    return NextResponse.json({ taxonomy });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
