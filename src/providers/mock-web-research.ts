/**
 * MockWebResearchProvider — deterministic, OFFLINE research for tests and local
 * dev without a Gemini key. It performs NO real web access. Its output is
 * clearly flagged `isMock: true` so callers/UI/history never mistake mock
 * results for real Google Search grounding.
 */
import type {
  WebResearchOptions,
  WebResearchOutput,
  WebResearchProvider,
} from "./web-research";

export class MockWebResearchProvider implements WebResearchProvider {
  readonly name = "mock";
  readonly isMock = true;

  constructor(private readonly script?: Partial<WebResearchOutput>) {}

  async research(query: string, _opts: WebResearchOptions = {}): Promise<WebResearchOutput> {
    if (this.script) {
      return {
        answer: this.script.answer ?? `[MOCK research] ${query}`,
        queries: this.script.queries ?? [query],
        sources: this.script.sources ?? [],
        isMock: true,
      };
    }
    // Default deterministic result referencing an official-looking domain.
    return {
      answer:
        "[MOCK research — not real web data] ISO/IEC 17025 clause 7.4 addresses handling of test items including receipt, handling, and storage.",
      queries: [query],
      sources: [
        {
          url: "https://www.iso.org/standard/66912.html",
          title: "ISO/IEC 17025:2017 — General requirements (MOCK)",
          excerpt: "Clause 7.4 covers handling of test items.",
        },
      ],
      isMock: true,
    };
  }
}
