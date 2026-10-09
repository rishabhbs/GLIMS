/**
 * pgvector serialization helpers. The Supabase JS client sends vectors as text
 * in the pgvector literal format: "[0.1,0.2,...]".
 */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export function parseVectorLiteral(text: string | null): number[] | null {
  if (!text) return null;
  const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner === "") return [];
  return inner.split(",").map((n) => Number.parseFloat(n));
}
