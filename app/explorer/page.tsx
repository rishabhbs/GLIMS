import { getBrainService } from "@/brain/service";
import { ExplorerClient } from "./ExplorerClient";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  let taxonomy: Array<{ key: string; label: string; count: number }> = [];
  let error: string | null = null;
  try {
    taxonomy = await getBrainService().getTaxonomyCounts();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load taxonomy";
  }

  if (error) {
    return (
      <div>
        <h1>Knowledge Explorer</h1>
        <div className="notice">
          Could not reach the database: {error}. Check <code>.env.local</code> and migrations.
        </div>
      </div>
    );
  }

  return <ExplorerClient taxonomy={taxonomy} />;
}
