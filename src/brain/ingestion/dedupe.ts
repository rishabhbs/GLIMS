/**
 * Dedupe + conflict detection for newly-extracted items.
 *
 * Given a new candidate (with embedding) and existing same-type items, decide:
 *  - 'duplicate'  : near-identical claim -> attach new evidence to existing item.
 *  - 'conflict'   : same subject, contradictory claim -> link + flag conflicted.
 *  - 'new'        : distinct enough -> create a new item.
 *
 * Similarity uses cosine over embeddings. Contradiction uses a conservative
 * lexical heuristic (shared subject tokens + a negation/divergence signal). The
 * engine never auto-merges confirmed items; conflicts are flagged for humans.
 */

export interface Comparable {
  id: string;
  title: string;
  claim: string;
  status: string;
  embedding: number[] | null;
}

export type DedupeDecision =
  | { kind: "duplicate"; itemId: string; similarity: number }
  | { kind: "conflict"; itemId: string; similarity: number }
  | { kind: "new" };

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "for", "and", "or", "is", "are",
  "be", "after", "before", "then", "with", "by", "it", "this", "that", "as", "happens",
  "occurs", "takes", "place", "later", "immediately",
]);

function contentTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

const NEGATIONS = ["not", "no", "never", "without", "cannot", "doesn't", "does not", "isn't"];

function hasNegation(s: string): boolean {
  const l = s.toLowerCase();
  return NEGATIONS.some((n) => l.includes(n));
}

/**
 * Heuristic contradiction: the two claims talk about the same subject (high
 * token overlap) but one negates and the other doesn't, OR they share subject
 * tokens yet their embeddings are only moderately similar (divergent assertion).
 */
export function looksContradictory(a: string, b: string, similarity: number): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const overlap = shared / Math.max(1, Math.min(ta.size, tb.size));
  if (overlap < 0.5) return false; // not the same subject
  const negDiff = hasNegation(a) !== hasNegation(b);
  // Same subject + negation mismatch -> contradiction.
  if (negDiff) return true;
  // Same subject, highly overlapping, but embeddings diverge -> likely different assertion.
  return overlap >= 0.7 && similarity < 0.9;
}

export interface DedupeThresholds {
  duplicate: number; // >= -> duplicate
  conflictFloor: number; // conflict candidates must be at least this similar (same topic)
}

export function decide(
  candidate: { title: string; claim: string; embedding: number[] | null },
  existing: Comparable[],
  thresholds: DedupeThresholds = { duplicate: 0.95, conflictFloor: 0.6 },
): DedupeDecision {
  if (!candidate.embedding) return { kind: "new" };

  let best: { item: Comparable; sim: number } | null = null;
  for (const e of existing) {
    if (!e.embedding) continue;
    const sim = cosine(candidate.embedding, e.embedding);
    if (!best || sim > best.sim) best = { item: e, sim };
  }
  if (!best) return { kind: "new" };

  if (best.sim >= thresholds.duplicate) {
    return { kind: "duplicate", itemId: best.item.id, similarity: best.sim };
  }

  // Look across reasonably-similar items for a contradiction.
  for (const e of existing) {
    if (!e.embedding) continue;
    const sim = cosine(candidate.embedding, e.embedding);
    if (sim >= thresholds.conflictFloor && looksContradictory(candidate.claim, e.claim, sim)) {
      return { kind: "conflict", itemId: e.id, similarity: sim };
    }
  }

  return { kind: "new" };
}
