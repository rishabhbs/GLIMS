/**
 * Web research pipeline. Separate from internal retrieval; produces EXTERNAL
 * evidence (research_findings) that never auto-enters the knowledge graph.
 *
 * plan queries -> search -> rank/dedupe -> extract top pages -> excerpt ->
 * persist session/queries/findings -> return findings for dual-source answering.
 */
import type { Repositories } from "@/db/repositories";
import type { WebResearchProvider } from "@/providers/web-research";
import type { ResearchFinding } from "../types";

export interface ResearchDeps {
  repos: Repositories;
  web: WebResearchProvider;
  workspaceId: string;
}

/** Official/primary-source domains to prefer for standards/regulatory questions. */
const PRIMARY_DOMAINS = [
  "nabl-india.org", "iso.org", "iec.ch", "nabl.qci.org.in", "iaf.nu", "ilac.org",
  "fda.gov", "cdsco.gov.in", "who.int", "clsi.org",
];

const STANDARDS_HINTS = /\b(nabl|iso\/?iec|iso |iec |17025|15189|clause|accreditation|regulation|regulatory|compliance|standard|requirement)\b/i;
const CURRENT_HINTS = /\b(latest|current|today|recent|now|2025|2026|news|release|version)\b/i;

export function looksLikeStandardsQuestion(q: string): boolean {
  return STANDARDS_HINTS.test(q);
}

export function needsCurrentFacts(q: string): boolean {
  return CURRENT_HINTS.test(q);
}

/** Decide whether to research in 'auto' mode. */
export function shouldAutoResearch(question: string, internalGrounding: "grounded" | "partial" | "insufficient"): boolean {
  if (internalGrounding !== "grounded") return true;
  if (looksLikeStandardsQuestion(question)) return true;
  if (needsCurrentFacts(question)) return true;
  return false;
}

function isPrimary(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return PRIMARY_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

/** Build search queries. For standards questions, bias toward official docs. */
export function planQueries(question: string): Array<{ query: string; includeDomains?: string[] }> {
  const queries: Array<{ query: string; includeDomains?: string[] }> = [{ query: question }];
  if (looksLikeStandardsQuestion(question)) {
    queries.push({ query: question, includeDomains: PRIMARY_DOMAINS });
  }
  return queries;
}

export interface ResearchResult {
  sessionId: string;
  findings: ResearchFinding[];
  /** The model's synthesized grounded answer (context for dual-source composition). */
  synthesizedAnswer: string;
  isMock: boolean;
}

export async function runResearch(
  input: { question: string; conversationId?: string | null; messageId?: string | null; trigger: "explicit" | "auto_insufficient" | "auto_heuristic" },
  deps: ResearchDeps,
): Promise<ResearchResult> {
  const { repos, web, workspaceId } = deps;

  const session = await repos.insertResearchSession({
    workspace_id: workspaceId,
    conversation_id: input.conversationId ?? null,
    message_id: input.messageId ?? null,
    question: input.question,
    trigger: input.trigger,
    provider: web.name,
  });

  // One grounded research call per planned query. Gemini performs search +
  // synthesis + citation and returns real grounding metadata. We persist the
  // actual queries it ran and the real sources it grounded on.
  const plans = planQueries(input.question);
  const findings: ResearchFinding[] = [];
  const seenUrls = new Set<string>();
  const synthParts: string[] = [];

  for (const plan of plans) {
    let output;
    try {
      output = await web.research(plan.query, { includeDomains: plan.includeDomains });
    } catch (e) {
      // Record the failed research attempt as a query with an error finding.
      const q = await repos.insertResearchQuery({ session_id: session.id, query: plan.query, include_domains: plan.includeDomains ?? null });
      await repos.insertResearchFinding({
        workspace_id: workspaceId, session_id: session.id, query_id: q.id,
        url: "about:error", title: "Research call failed", excerpt: null, raw_text: null,
        published_date: null, retrieved_at: new Date().toISOString(),
        is_primary_source: false, accessible: false,
        error: e instanceof Error ? e.message : "research failed",
      });
      continue;
    }

    synthParts.push(output.answer);

    // Persist the ACTUAL queries the model ran (grounding metadata), falling
    // back to the planned query if the provider didn't report any.
    const ranQueries = output.queries.length ? output.queries : [plan.query];
    const queryRows = await Promise.all(
      ranQueries.map((qText) =>
        repos.insertResearchQuery({ session_id: session.id, query: qText, include_domains: plan.includeDomains ?? null }),
      ),
    );
    const queryId = queryRows[0]?.id ?? null;

    for (const src of output.sources) {
      if (seenUrls.has(src.url)) continue;
      seenUrls.add(src.url);
      const row = await repos.insertResearchFinding({
        workspace_id: workspaceId,
        session_id: session.id,
        query_id: queryId,
        url: src.url,
        title: src.title,
        excerpt: src.excerpt, // real grounded excerpt (may be null)
        raw_text: null,
        published_date: null,
        retrieved_at: new Date().toISOString(),
        is_primary_source: isPrimary(src.url),
        accessible: true,
        error: null,
      });
      findings.push(toFinding(row));
    }
  }

  return {
    sessionId: session.id,
    findings,
    synthesizedAnswer: synthParts.join("\n\n"),
    isMock: web.isMock,
  };
}

function toFinding(row: {
  id: string; url: string; title: string | null; excerpt: string | null;
  published_date: string | null; retrieved_at: string; is_primary_source: boolean;
  accessible: boolean; error: string | null; promoted_source_id: string | null;
}): ResearchFinding {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    publishedDate: row.published_date,
    retrievedAt: row.retrieved_at,
    isPrimarySource: row.is_primary_source,
    accessible: row.accessible,
    error: row.error,
    promotedSourceId: row.promoted_source_id,
  };
}
