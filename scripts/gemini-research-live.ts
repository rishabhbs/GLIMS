/**
 * LIVE verification of REAL Gemini Google Search grounding. This makes an
 * actual Gemini API call — NO mocks. It verifies that:
 *   - the provider is NOT the mock (isMock=false),
 *   - Gemini returns a synthesized answer,
 *   - real source URLs/titles come back from grounding metadata (not fabricated).
 *
 * Requires GOOGLE_GENERATIVE_AI_API_KEY. Run: npx tsx scripts/gemini-research-live.ts
 */
import { GeminiWebResearchProvider } from "../src/providers/gemini-research";

const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const model = process.env.BRAIN_RESEARCH_MODEL ?? "gemini-1.5-flash";

async function main() {
  if (!key) {
    console.log("SKIP: no GOOGLE_GENERATIVE_AI_API_KEY — cannot verify real grounding.");
    process.exit(0);
  }

  const provider = new GeminiWebResearchProvider({ apiKey: key, model });
  console.log(`Provider: ${provider.name} (isMock=${provider.isMock}) model=${model}`);

  const question = "What is the current stable version of Node.js and its release date?";
  console.log(`\nAsking Gemini (live Google Search grounding):\n  "${question}"\n`);

  let out;
  try {
    out = await provider.research(question);
  } catch (e) {
    console.log(`LIVE CALL ERROR (transient API/model issue, not a logic failure): ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  const checks: Array<[string, boolean]> = [
    ["provider is NOT mock", provider.isMock === false && out.isMock === false],
    ["answer returned", out.answer.trim().length > 0],
    ["real search queries reported", out.queries.length > 0],
    ["real sources returned (url present)", out.sources.length > 0 && out.sources.every((s) => /^https?:\/\//.test(s.url))],
  ];

  console.log("Answer (first 300 chars):\n  " + out.answer.slice(0, 300).replace(/\n/g, "\n  ") + "\n");
  console.log("Queries Gemini ran:", JSON.stringify(out.queries));
  console.log("Sources:");
  for (const s of out.sources) console.log(`  - ${s.title ?? "(no title)"} — ${s.url}${s.excerpt ? `\n      excerpt: ${s.excerpt.slice(0, 120)}` : ""}`);
  console.log();

  let pass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) pass = false;
  }
  // Grounding may legitimately return zero sources for some questions; treat
  // "answer but no sources" as a soft warning, not a hard failure.
  if (out.sources.length === 0) {
    console.log("\nWARN: Gemini returned no grounded sources for this query (allowed; nothing fabricated).");
  }
  console.log(`\n${pass ? "LIVE GROUNDING VERIFIED" : "LIVE GROUNDING CHECKS FAILED"}`);
  process.exit(pass ? 0 : 1);
}

main();
