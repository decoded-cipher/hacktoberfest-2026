import { describe, expect, it } from "vitest";
import { extractJson } from "../src/llm/client.ts";
import { normalizeParsed } from "../src/nlu/parser.ts";
import { OTHER } from "../src/nlu/schema.ts";

describe("normalizeParsed", () => {
  it("converts 10-point ratings and drops impossible ones", () => {
    expect(normalizeParsed({ ...OTHER, rating: 8 }).rating).toBe(4);
    expect(normalizeParsed({ ...OTHER, rating: 0 }).rating).toBeNull();
    expect(normalizeParsed({ ...OTHER, rating: 42 }).rating).toBeNull();
  });

  it("infers tv when an episode is given", () => {
    expect(normalizeParsed({ ...OTHER, season: 1, episode: 2 }).kind).toBe("tv");
  });

  it("drops zero episodes, odd years and blank strings", () => {
    const p = normalizeParsed({ ...OTHER, title: "  ", episode: 0, year: 3, note: " " });
    expect(p).toMatchObject({ title: null, episode: null, year: null, note: null });
  });
});

describe("extractJson", () => {
  it("strips code fences and chatter", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
