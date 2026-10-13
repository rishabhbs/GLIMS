/**
 * Correction router — ONE mechanism for all corrections, not N stores.
 *
 * When the user corrects a generated post ("results never sit in email",
 * "Sampleify doesn't actually do X", "in small labs everyone tests"), a single
 * model call CLASSIFIES the correction and proposes a durable knowledge update.
 * The user confirms, and the correction is ROUTED to the right memory:
 *
 *   - "product"  → the real knowledge_items graph (first-class correction:
 *                  versioned, audited, source_classification='human'). This is
 *                  Brain knowledge every consumer sees, per steering.
 *   - "world"    → lab facts (how real labs work; prevents fabrication).
 *   - "audience" → the audience model (who we write for; corrects persona
 *                  assumptions like "senior analysts never run tests").
 *   - "style"    → the learned style guide (voice/format preference).
 *   - "oneoff"   → nothing durable; applies to this post only.
 *
 * The mechanism is uniform; only the destination differs. Adding a new category
 * later means teaching the classifier + adding a route, not bolting another
 * ad-hoc card onto the UI.
 */
import type { ModelProvider } from "@/providers";

export type CorrectionCategory = "product" | "world" | "audience" | "style" | "oneoff";

export interface CorrectionProposal {
  category: CorrectionCategory;
  /**
   * The durable statement to remember, phrased generally (not about this one
   * post). For product: the corrected product fact. For world: the real-world
   * truth. For audience: the corrected audience understanding. For style: the
   * reusable rule. Empty for "oneoff".
   */
  statement: string;
  /**
   * For "world" corrections, the misconception to explicitly avoid (optional,
   * mirrors lab-facts' truth/avoid pair). Empty otherwise.
   */
  avoid: string;
  /** One-line, plain explanation of what will be remembered and where. */
  summary: string;
  /** Where this will be routed, in human terms (for the confirm card). */
  destinationLabel: string;
}

function routerSystem(productName: string): string {
  return `You classify a user's CORRECTION of an AI-generated LinkedIn post about "${productName}", and extract the durable knowledge to remember.
The AI wrote something the user is correcting. Decide which ONE category the correction is, and extract a general, reusable statement.

Categories:
- "product": a fact about the ${productName} PRODUCT itself the AI got wrong or assumed (what it does / doesn't do, how a feature works, a metric). Belongs in the product knowledge base.
- "world": a fact about how the REAL WORLD / the industry works in general that the AI got wrong (e.g. "results never sit in email; they are entered manually or pulled from instruments"). Not about the product, and true regardless of which product we write for.
- "audience": a wrong assumption about WHO we write for or what they do (e.g. "senior analysts never run tests" is false because in small labs everyone does everything). Corrects persona/audience understanding.
- "style": a voice/format/tone preference (e.g. "no story narration, state facts"). Not a fact at all.
- "oneoff": a change that only applies to THIS post with no reusable lesson (e.g. "cut the last line", "shorter hook").

Rules:
- Pick the single best category.
- "statement" must be general and reusable, phrased as a standalone truth/rule, NOT about this specific post. For "oneoff", set it to "".
- For "world", also fill "avoid" with the false assumption to never make again; otherwise "avoid" = "".
- Do not invent product capabilities. If a product correction only says what is FALSE without a clear replacement truth, still capture the correction as the statement (e.g. "${productName} does not do X").

OUTPUT ONLY JSON: { "category": "product|world|audience|style|oneoff", "statement": string, "avoid": string, "summary": string }`;
}

const DEST_LABEL: Record<CorrectionCategory, string> = {
  product: "Product knowledge (the Brain's real knowledge graph)",
  world: "Real-world facts",
  audience: "Audience understanding",
  style: "Style guide",
  oneoff: "This post only",
};

/**
 * Classify + extract a correction. Returns null if the note isn't a correction
 * at all (plain tweak with nothing to classify) or on model/parse failure.
 */
export async function routeCorrection(
  note: string,
  offendingBody: string,
  provider: ModelProvider,
  productName: string,
): Promise<CorrectionProposal | null> {
  if (!note.trim()) return null;
  const user = `POST THE AI WROTE:\n${offendingBody}\n\nUSER CORRECTION:\n${note}\n\nClassify and extract.`;
  try {
    const res = await provider.chat(
      [
        { role: "system", content: routerSystem(productName) },
        { role: "user", content: user },
      ],
      { temperature: 0.2, maxTokens: 400 },
    );
    let t = res.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
    const raw = JSON.parse(t) as {
      category?: unknown;
      statement?: unknown;
      avoid?: unknown;
      summary?: unknown;
    };
    const category = (["product", "world", "audience", "style", "oneoff"] as const).includes(raw.category as CorrectionCategory)
      ? (raw.category as CorrectionCategory)
      : null;
    if (!category) return null;
    const statement = typeof raw.statement === "string" ? raw.statement.trim() : "";
    const avoid = typeof raw.avoid === "string" ? raw.avoid.trim() : "";
    const summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : "Recorded a correction.";
    // "oneoff" with nothing durable: no proposal to confirm.
    if (category === "oneoff") return null;
    // Non-oneoff but empty statement: nothing to remember.
    if (!statement && !avoid) return null;
    return { category, statement, avoid, summary, destinationLabel: DEST_LABEL[category] };
  } catch {
    return null;
  }
}

/**
 * Heuristic pre-filter: does a note look like a CORRECTION worth routing (vs a
 * pure stylistic tweak like "punchier hook")? Keeps us from spending a model
 * call on every redo. The router still has final say on category.
 */
export function looksLikeCorrection(note: string): boolean {
  const f = note.toLowerCase();
  return /\b(incorrect|wrong|not true|untrue|false|never|doesn'?t|does not|don'?t|do not|isn'?t|aren'?t|that'?s not|not how|not accurate|inaccurate|misconception|assumption|assume|in reality|actually|factually|in fact|not every|not all|some labs|small labs|big labs|only big|only small)\b/.test(f);
}
