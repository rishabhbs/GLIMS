import { createHash } from "node:crypto";

/** Stable content hash for dedupe/idempotency. */
export function contentHash(parts: Array<string | undefined | null>): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p ?? "");
  return h.digest("hex");
}
