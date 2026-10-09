import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock";
import { parseVectorLiteral, toVectorLiteral } from "@/db/vector";

describe("MockProvider", () => {
  it("produces deterministic, correctly-sized, normalized embeddings", async () => {
    const p = new MockProvider(1536);
    const { vectors, model } = await p.embed(["sample receiving", "sample receiving"]);
    expect(model).toBe("mock-embedding");
    expect(vectors[0]).toHaveLength(1536);
    // deterministic: same text -> same vector
    expect(vectors[0]).toEqual(vectors[1]);
    // normalized: L2 norm ~ 1
    const norm = Math.sqrt(vectors[0].reduce((a, b) => a + b * b, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("gives more similar vectors to more similar text", async () => {
    const p = new MockProvider(256);
    const [a, b, c] = (await p.embed([
      "sample allocation happens after receiving",
      "sample allocation occurs after receiving",
      "the weather is sunny today",
    ])).vectors;
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });
});

describe("vector literal round-trip", () => {
  it("serializes and parses pgvector literals", () => {
    const v = [0.1, 0.2, -0.3];
    expect(parseVectorLiteral(toVectorLiteral(v))).toEqual(v);
    expect(parseVectorLiteral(null)).toBeNull();
  });
});
