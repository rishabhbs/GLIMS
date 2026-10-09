import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";
import type { KnowledgeStatus } from "@/brain/types";

export const dynamic = "force-dynamic";

/** List or search knowledge items. ?q= triggers hybrid search; otherwise list. */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brain = getBrainService();
    const q = searchParams.get("q")?.trim();
    const entityType = searchParams.get("type") ?? undefined;
    const statuses = searchParams.getAll("status") as KnowledgeStatus[];

    if (q) {
      const hits = await brain.searchKnowledge({
        text: q,
        entityTypes: entityType ? [entityType] : undefined,
        statuses: statuses.length ? statuses : undefined,
      });
      return NextResponse.json({ mode: "search", results: hits });
    }
    const items = await brain.listItems({
      entityType,
      statuses: statuses.length ? statuses : undefined,
    });
    return NextResponse.json({ mode: "list", results: items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** Add a manual knowledge item (human-authored, first-class). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.entityType || !body?.title || !body?.claim) {
      return NextResponse.json({ error: "entityType, title, claim are required" }, { status: 400 });
    }
    const result = await getBrainService().addManualItem(body);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
