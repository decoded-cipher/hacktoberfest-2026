import { describe, expect, it } from "vitest";
import { Env } from "../src/config.ts";

describe("Env", () => {
  it("applies local defaults", () => {
    const config = Env.parse({ TELEGRAM_BOT_TOKEN: "a", TMDB_ACCESS_TOKEN: "b" });

    expect(config.LLM_BASE_URL).toBe("http://localhost:11434/v1");
    expect(config.LLM_MODEL).toBe("qwen3:8b");
    expect(config.DATABASE_PATH).toBe("data/pglite");
  });

  it("requires the tokens", () => {
    expect(Env.safeParse({}).success).toBe(false);
  });
});
