/**
 * Dual-source answer composition. Combines INTERNAL knowledge items and
 * EXTERNAL web findings into a single answer that explicitly separates four
 * layers (brief §2): what internal sources establish, what external sources
 * establish, what the Brain infers, and what remains unknown/unverified.
 *
 * Every factual sentence must cite an internal item [K#] or external finding
 * [W#]. Code-side verification maps markers back to real sources; the grounding
 * status is downgraded if claims are uncited. Never invents clause mappings;
 * refuses when neither pool supports an answer.
 */
import type { ModelProvider } from "@/providers";
import type { GroundingItem } from "../retrieval/ground";
import type { Citation, GroundingStatus, ResearchFinding, WebCitation } from "../types";

export interface DualSourceComposition {
  answer: string;
  groundingStatus: GroundingStatus;
  citations: Citation[]; // internal
  webCitations: WebCitation[]; // external
  usedItems: Array<{ id: string; title: string; entityType: string; status: string }>;
  usedSources: Array<{ id: string; title: string | null; type: string }>;
  conflicts: Array<{ itemIds: string[]; note: string }>;
}

function internalContext(items: GroundingItem[]): string {
  if (items.length === 0) return "(none)";
  return items
    .map((it, i) => {
      const flag = it.status === "conflicted" ? " (CONFLICTED)" : "";
      const supported = it.sources.length ? "" : " (no source — unsupported)";
      return `[K${i + 1}] (${it.entityType}${flag}) ${it.claim}${supported}`;
    })
    .join("\n");
}

function externalContext(findings: ResearchFinding[]): string {
  const accessible = findings.filter((f) => f.accessible);
  if (accessible.length === 0) return "(none)";
  return accessible
    .map((f, i) => {
      const primary = f.isPrimarySource ? " [PRIMARY/OFFICIAL]" : "";
      const date = f.publishedDate ? ` (published ${f.publishedDate})` : "";
      return `[W${i + 1}]${primary} ${f.title ?? f.url}${date}: ${f.excerpt ?? ""} — ${f.url}`;
    })
    .join("\n");
}

const SYSTEM = (internal: string, external: string) =>
  "You are LIMS Brain answering a question about the product 'Sampleify' using TWO labelled evidence pools.\n" +
  "Compose an answer with these clearly separated sections, omitting any that are empty:\n" +
  "  **From Sampleify (internal):** facts established by internal items, each citing [K#].\n" +
  "  **From external sources:** facts established by web findings, each citing [W#].\n" +
  "  **Inference:** reasoning that combines the above. Label it clearly as inference; cite the sources it builds on.\n" +
  "  **Unknown / unverified:** what the evidence does NOT establish.\n" +
  "Rules:\n" +
  "- Use ONLY the provided evidence. Never invent capabilities, metrics, standard clauses, requirement wording, or customer results.\n" +
  "- Cite [K#] for internal and [W#] for external after each factual statement.\n" +
  "- For standards/regulatory questions, prefer PRIMARY/OFFICIAL sources and quote exact requirement wording only if present in a finding.\n" +
  "- Distinguish a DIRECT requirement from a feature that merely SUPPORTS compliance. Never imply that using Sampleify guarantees accreditation or compliance.\n" +
  "- If sources conflict, surface the disagreement. If evidence is insufficient, say so plainly in the Unknown section.\n\n" +
  "INTERNAL evidence:\n" + internal + "\n\nEXTERNAL evidence:\n" + external;

function parseMarkers(text: string, prefix: "K" | "W"): number[] {
  const found = new Set<number>();
  const re = new RegExp(`\\[${prefix}(\\d+)\\]`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(Number.parseInt(m[1], 10));
  return [...found];
}

export async function composeDualSource(
  question: string,
  items: GroundingItem[],
  findings: ResearchFinding[],
  provider: ModelProvider,
): Promise<DualSourceComposition> {
  const supportedInternal = items.filter((i) => i.sources.length > 0 && i.status !== "interpretation");
  const accessibleExternal = findings.filter((f) => f.accessible);

  const conflicts = items.filter((i) => i.status === "conflicted").length
    ? [{ itemIds: items.filter((i) => i.status === "conflicted").map((i) => i.id), note: "Conflicting internal knowledge; resolve in Admin." }]
    : [];

  if (supportedInternal.length === 0 && accessibleExternal.length === 0) {
    return {
      answer:
        "The Brain has no supported internal knowledge and web research returned no accessible sources for this question. I can't answer it reliably yet.",
      groundingStatus: "insufficient",
      citations: [],
      webCitations: [],
      usedItems: [],
      usedSources: [],
      conflicts,
    };
  }

  const result = await provider.chat(
    [
      { role: "system", content: SYSTEM(internalContext(items), externalContext(accessibleExternal)) },
      { role: "user", content: question },
    ],
    { temperature: 0.1, maxTokens: 900 },
  );

  const kMarkers = parseMarkers(result.text, "K");
  const wMarkers = parseMarkers(result.text, "W");

  const citedItems = kMarkers.map((n) => items[n - 1]).filter(Boolean) as GroundingItem[];
  const citedFindings = wMarkers.map((n) => accessibleExternal[n - 1]).filter(Boolean) as ResearchFinding[];

  const supportedCitedInternal = citedItems.filter((i) => i.sources.length > 0);
  const totalCited = citedItems.length + citedFindings.length;
  const supportedCited = supportedCitedInternal.length + citedFindings.length;

  let groundingStatus: GroundingStatus;
  if (totalCited > 0 && supportedCited === totalCited) groundingStatus = "grounded";
  else if (supportedCited > 0) groundingStatus = "partial";
  else groundingStatus = "insufficient";

  const citations: Citation[] = supportedCitedInternal.map((i) => ({
    claim: i.claim,
    itemIds: [i.id],
    sourceIds: i.sources.map((s) => s.id),
  }));

  const webCitations: WebCitation[] = citedFindings.map((f) => ({
    findingId: f.id,
    title: f.title,
    url: f.url,
    excerpt: f.excerpt,
    publishedDate: f.publishedDate,
    retrievedAt: f.retrievedAt,
    isPrimarySource: f.isPrimarySource,
  }));

  const usedItems = citedItems.map((i) => ({ id: i.id, title: i.title, entityType: i.entityType, status: i.status }));
  const usedSources = dedupe(citedItems.flatMap((i) => i.sources.map((s) => ({ id: s.id, title: s.title, type: s.type }))));

  return { answer: result.text, groundingStatus, citations, webCitations, usedItems, usedSources, conflicts };
}

function dedupe(sources: Array<{ id: string; title: string | null; type: string }>) {
  const map = new Map<string, { id: string; title: string | null; type: string }>();
  for (const s of sources) map.set(s.id, s);
  return [...map.values()];
}
