import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.ts";
import { type Db, openDb } from "../src/db/client.ts";
import { preferences } from "../src/db/schema.ts";
import { OTHER, type ParsedMessage } from "../src/nlu/schema.ts";
import {
  type ApiCall,
  BOT_INFO,
  buttonData,
  callbackUpdate,
  recordApiCalls,
  textUpdate,
  USER,
} from "./helpers/bot.ts";
import { FakeTmdb } from "./helpers/fake-tmdb.ts";
import { SEVERANCE } from "./helpers/fixtures.ts";

const PARSES: Record<string, Partial<ParsedMessage>> = {
  "i can't stand horror": {
    intent: "set_preference",
    sentiment: "disliked",
    note: "can't stand horror",
    avoid_genres: ["Horror"],
  },
  "watching with mum tonight": {
    intent: "set_preference",
    note: "watching with mum",
    genres: ["Family"],
    avoid_genres: ["Horror"],
    temporary: true,
  },
  "sev s1e2": { intent: "log_watch", title: "Severance", kind: "tv", season: 1, episode: 2 },
};

const voiceUpdate = () => ({
  update_id: 9000,
  message: {
    message_id: 9000,
    date: 0,
    chat: { id: USER.id, type: "private" as const, first_name: USER.first_name },
    from: USER,
    voice: { file_id: "v1", file_unique_id: "v1u", duration: 3 },
  },
});

describe("bot memory and voice", () => {
  let db: Db;
  let close: () => Promise<void>;
  let calls: ApiCall[];
  let transcribed: { hints: string[] }[];
  const makeBot = (withVoice: boolean) => {
    const bot = createBot(
      "t",
      {
        db,
        tmdb: new FakeTmdb([SEVERANCE]),
        parse: async (text) => ({ ...OTHER, ...PARSES[text] }),
        download: async () => new Uint8Array([1, 2, 3]),
        now: () => new Date("2026-01-01T18:00:00Z"),
        ...(withVoice && {
          transcribe: async (_audio: Uint8Array, hints: string[] = []) => {
            transcribed.push({ hints });
            return "sev s1e2";
          },
        }),
      },
      { botInfo: BOT_INFO },
    );
    calls = recordApiCalls(bot);
    return bot;
  };
  const texts = () =>
    calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string);

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    transcribed = [];
  });

  afterEach(() => close());

  it("remembers a dislike and lists it in /memory", async () => {
    const bot = makeBot(false);
    await bot.handleUpdate(textUpdate("i can't stand horror"));
    expect(texts().at(-1)).toContain("I'll remember: “can't stand horror”");

    await bot.handleUpdate(textUpdate("/memory"));
    const list = calls.at(-1);
    expect(list?.payload.text).toContain("👎 can't stand horror");
    expect(buttonData(list)).toContain("mem:clear");
  });

  it("stores temporary context as a like and a dislike that expire", async () => {
    const bot = makeBot(false);
    await bot.handleUpdate(textUpdate("watching with mum tonight"));

    expect(texts().at(-1)).toContain("for the next 12 hours");
    const rows = await db.select().from(preferences);
    expect(rows.map((r) => r.polarity).sort()).toEqual(["dislike", "like"]);
    expect(rows.every((r) => r.expiresAt?.toISOString() === "2026-01-02T06:00:00.000Z")).toBe(true);
  });

  it("forgets a preference from its button", async () => {
    const bot = makeBot(false);
    await bot.handleUpdate(textUpdate("i can't stand horror"));
    await bot.handleUpdate(textUpdate("/memory"));
    const forget = buttonData(calls.at(-1)).find((d) => d.startsWith("mem:del:")) ?? "";

    await bot.handleUpdate(callbackUpdate(forget));
    expect(await db.select().from(preferences)).toHaveLength(0);
    expect(calls.at(-1)?.payload.text).toContain("don't remember any preferences");
  });

  it("transcribes voice notes and handles them like text, with library hints", async () => {
    const bot = makeBot(true);
    await bot.handleUpdate(textUpdate("sev s1e2"));
    await bot.handleUpdate(voiceUpdate());

    expect(texts()).toContain("🎙 “sev s1e2”");
    expect(texts().at(-1)).toContain("S01E02");
    expect(transcribed[0]?.hints).toEqual(["Severance"]);
  });

  it("explains when voice isn't set up", async () => {
    const bot = makeBot(false);
    await bot.handleUpdate(voiceUpdate());
    expect(texts().at(-1)).toContain("Voice notes aren't set up");
  });
});
