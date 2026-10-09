import { notFound } from "next/navigation";
import { getBrainService } from "@/brain/service";
import { ItemClient } from "./ItemClient";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brain = getBrainService();
  const item = await brain.getItem(id);
  if (!item) notFound();
  const history = await brain.getItemHistory(id);
  return <ItemClient item={item} history={history} />;
}
