import { describe, expect, it } from "vitest";
import { cosine, looksContradictory, decide } from "./dedupe";
import { chunkText } from "./chunk";

describe("cosine", () => {
  it("is 1 for identical vectors and ~0 for orthogonal", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });
});

describe("looksContradictory", () => {
  it("flags same-subject negation mismatch", () => {
    expect(
      looksContradictory(
        "Sample allocation takes place after approval.",
        "Sample allocation does not take place after approval.",
        0.8,
      ),
    ).toBe(true);
  });

  it("does not flag unrelated claims", () => {
    expect(
      looksContradictory("Sampleify supports barcode receiving.", "Average turnaround time is 48 hours.", 0.2),
    ).toBe(false);
  });
});

describe("decide", () => {
  const emb = (x: number) => [x, 1 - x, 0];
  it("returns duplicate for near-identical embeddings", () => {
    const d = decide(
      { title: "A", claim: "x", embedding: [1, 0, 0] },
      [{ id: "e1", title: "A", claim: "x", status: "candidate", embedding: [1, 0, 0] }],
    );
    expect(d.kind).toBe("duplicate");
  });

  it("returns new when nothing is similar", () => {
    const d = decide(
      { title: "A", claim: "barcode receiving", embedding: emb(1) },
      [{ id: "e1", title: "B", claim: "turnaround time", status: "candidate", embedding: emb(0) }],
    );
    expect(d.kind).toBe("new");
  });
});

describe("chunkText", () => {
  it("returns empty for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("produces chunks with ascending ordinals and valid locators", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some content.`).join("\n\n");
    const chunks = chunkText(text, { targetChars: 200, overlapChars: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.ordinal).toBe(i);
      expect(c.locator.char_end).toBeGreaterThanOrEqual(c.locator.char_start);
      expect(c.content.length).toBeGreaterThan(0);
    });
  });
});
