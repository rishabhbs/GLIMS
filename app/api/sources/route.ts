import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { IngestInput } from "@/brain/types";

export const dynamic = "force-dynamic";

/** HTTP mirror of BrainService.ingestSource (contract parity, req 11.4). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IngestInput;
    if (!body?.type) {
      return NextResponse.json({ error: "`type` is required" }, { status: 400 });
    }
    const result = await getBrainService().ingestSource(body);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
