import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getBrainService } from "@/brain/service";
import { uploadSourceFile } from "@/db/storage";
import type { IngestInput, SourceType } from "@/brain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Unified ingestion intake. Accepts either JSON (text/url/note) or multipart
 * form-data (pdf/image upload). Creates a source + queued job, then kicks off
 * processing in the background via after().
 */
export async function POST(req: NextRequest) {
  try {
    const brain = getBrainService();
    const contentType = req.headers.get("content-type") ?? "";

    let input: IngestInput;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      const type = (form.get("type") as string) as SourceType;
      const title = (form.get("title") as string) || file?.name || "Uploaded file";
      const productId = (form.get("productId") as string) || null;
      if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

      const bytes = new Uint8Array(await file.arrayBuffer());
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${Date.now()}-${safeName}`;
      await uploadSourceFile(path, bytes, file.type || "application/octet-stream");

      input = { type: type || "pdf", title, storagePath: path, productId };
    } else {
      const body = (await req.json()) as IngestInput;
      if (!body?.type) return NextResponse.json({ error: "`type` is required" }, { status: 400 });
      input = body;
    }

    const result = await brain.ingestSource(input);

    // Process the job in the background (not blocking the response), unless it was a dup.
    if (!result.duplicate && result.jobId) {
      after(async () => {
        try {
          await brain.processJob(result.jobId);
        } catch {
          // errors are persisted on the job row by the worker
        }
      });
    }

    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
