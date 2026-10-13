import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";

/** GET: the saved gold-standard posts for the active product. ?product=<id> */
export async function GET(req: NextRequest) {
  try {
    const productId = new URL(req.url).searchParams.get("product") ?? undefined;
    const sp = await getBrainService().getSavedPosts(productId);
    return NextResponse.json(sp);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** POST: save a post. Body: { body, theme?, hashtags?, note?, source?, productId? }. */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as {
      body?: string;
      theme?: string;
      hashtags?: string[];
      note?: string;
      source?: "training" | "calendar" | "manual";
      productId?: string;
    };
    if (!b.body?.trim()) return NextResponse.json({ error: "body is required" }, { status: 400 });
    const sp = await getBrainService().savePost({
      body: b.body.trim(),
      theme: b.theme,
      hashtags: b.hashtags,
      note: b.note,
      source: b.source,
      productId: b.productId,
    });
    return NextResponse.json(sp);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** PATCH: update a saved post's note. Body: { id, note, productId? }. */
export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as { id?: string; note?: string; productId?: string };
    if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const sp = await getBrainService().updateSavedPostNote(b.id, b.note ?? "", b.productId);
    return NextResponse.json(sp);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** DELETE ?id=...&product=... : remove a saved post. */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const productId = searchParams.get("product") ?? undefined;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const sp = await getBrainService().removeSavedPost(id, productId);
    return NextResponse.json(sp);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
