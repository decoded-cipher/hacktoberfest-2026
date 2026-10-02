import { describe, expect, it } from "vitest";
import { stripThinking } from "../src/llm/client.ts";

describe("stripThinking", () => {
  it("removes think blocks", () => {
    expect(stripThinking("<think>\nhmm, let me see\n</think>\n\nIt's a show.")).toBe(
      "It's a show.",
    );
  });

  it("leaves plain text alone", () => {
    expect(stripThinking("  It's a show. ")).toBe("It's a show.");
  });
});
