import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanTranscript, createWhisperTranscriber, hintPrompt } from "../src/voice/whisper.ts";

describe("cleanTranscript", () => {
  it("drops non-speech markers and extra whitespace", () => {
    expect(cleanTranscript(" [BLANK_AUDIO]\n Just watched Dune. (music)  ")).toBe(
      "Just watched Dune.",
    );
  });
});

describe("hintPrompt", () => {
  it("joins unique hints and stops before the length cap", () => {
    expect(hintPrompt(["Severance", "The Bear", "Severance"])).toBe("Severance, The Bear");
    expect(
      hintPrompt(Array.from({ length: 200 }, (_, i) => `Title ${i}`)).length,
    ).toBeLessThanOrEqual(600);
  });
});

const model = fileURLToPath(new URL("../data/models/ggml-base.bin", import.meta.url));
const hasWhisper = (() => {
  try {
    execFileSync("whisper-cli", ["--help"], { stdio: "ignore" });
    return existsSync(model);
  } catch {
    return false;
  }
})();

describe.skipIf(!hasWhisper)("whisper.cpp (local install)", () => {
  it("transcribes a Telegram-style OGG voice note, steered by title hints", async () => {
    const audio = await readFile(new URL("fixtures/voice-severance.oga", import.meta.url));
    const text = await createWhisperTranscriber({ model })(audio, ["Severance", "The Bear"]);

    expect(text.toLowerCase()).toContain("severance");
    expect(text).toMatch(/5|five/i);
  }, 60_000);
});
