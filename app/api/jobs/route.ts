import { NextRequest, NextResponse } from "next/server";
import { getBrainService } from "@/brain/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** List ingestion jobs with source info (Knowledge UI status list). */
export async function GET() {
  try {
    const jobs = await getBrainService().listJobs();
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}

/** Worker trigger: process pending jobs. Suitable for a cron hit. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { jobId?: string; max?: number };
    const brain = getBrainService();
    if (body.jobId) {
      const res = await brain.processJob(body.jobId);
      return NextResponse.json({ processed: [{ jobId: body.jobId, ...res }] });
    }
    const processed = await brain.runPendingJobs(body.max ?? 5);
    return NextResponse.json({ processed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
