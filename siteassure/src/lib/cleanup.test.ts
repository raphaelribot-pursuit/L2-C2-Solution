import { describe, it, expect } from "vitest";
import { cleanText, cleanSegments } from "./cleanup";

describe("cleanText", () => {
  it("strips fillers, dedupes stutters, fixes I + caps + terminal punctuation", () => {
    expect(cleanText("um the the crew uh installed guardrails you know")).toBe(
      "The crew installed guardrails."
    );
  });
  it("keeps construction units like mm intact", () => {
    expect(cleanText("gap was 10 mm wide")).toBe("Gap was 10 mm wide.");
  });
  it("capitalizes standalone i", () => {
    expect(cleanText("i checked the scaffold")).toBe("I checked the scaffold.");
  });
  it("empty in, empty out", () => {
    expect(cleanText("   ")).toBe("");
  });
});

describe("cleanSegments", () => {
  it("paragraph-breaks on a long speech gap", () => {
    const out = cleanSegments(
      [
        { startMs: 0, endMs: 1000, text: "we set up the lift" },
        { startMs: 5000, endMs: 6000, text: "then the roofers started" },
      ],
      1500
    );
    expect(out).toBe("We set up the lift.\n\nThen the roofers started.");
  });
});
