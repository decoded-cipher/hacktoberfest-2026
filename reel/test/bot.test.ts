import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.ts";
import { type Db, openDb } from "../src/db/client.ts";
import { getProgress, getRating, getWatchlist } from "../src/db/library.ts";
import { users, watchEvents } from "../src/db/schema.ts";
import { findTitle } from "../src/db/titles.ts";
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
import { DUNE_2, details, SEVERANCE } from "./helpers/fixtures.ts";

const DUNE_2021 = details({ tmdbId: 438631, title: "Dune", year: 2021, popularity: 150 });
const DUNE_1984 = details({ tmdbId: 841, title: "Dune", year: 1984, popularity: 40 });

/** Parser stub: each test message maps to a canned parse result. */
const PARSES: Record<string, Partial<ParsedMessage>> = {
  "watched dune 2": { intent: "log_watch", title: "Dune: Part Two", kind: "movie" },
  "dune 2, 9/10": { intent: "log_watch", title: "Dune: Part Two", kind: "movie", rating: 4.5 },
  "watched dune": { intent: "log_watch", title: "Dune" },
  "sev s2e5": { intent: "log_watch", title: "Severance", kind: "tv", season: 2, episode: 5 },
  "watched severance": { intent: "log_watch", title: "Severance", kind: "tv" },
  "severance season 1": { intent: "log_watch", title: "Severance", kind: "tv", season: 1 },
  "where am i in severance": { intent: "progress", title: "Severance" },
  "add dune 2 to my list": { intent: "add_watchlist", title: "Dune: Part Two" },
  "watched zzz": { intent: "log_watch", title: "Zzz Nonexistent" },
  "rate dune 2": { intent: "rate", title: "Dune: Part Two" },
};

describe("bot", () => {
  let db: Db;
  let close: () => Promise<void>;
  let calls: ApiCall[];
  let bot: ReturnType<typeof createBot>;

  const send = async (text: string) => {
    calls.length = 0;
    await bot.handleUpdate(textUpdate(text));
    return calls.filter((c) => c.method === "sendMessage");
  };
  const press = async (data: string, messageText = "") => {
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(data, messageText));
    return calls;
  };
  const userId = async () =>
    (await db.select().from(users).where(eq(users.telegramId, USER.id)))[0]?.id ?? -1;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    const tmdb = new FakeTmdb([SEVERANCE, DUNE_2, DUNE_2021, DUNE_1984]);
    const parse = async (text: string) => ({ ...OTHER, ...PARSES[text] });
    bot = createBot(
      "test-token",
      { db, tmdb, parse, now: () => new Date("2026-01-01") },
      { botInfo: BOT_INFO },
    );
    calls = recordApiCalls(bot);
  });

  afterEach(() => close());

  it("/start registers the user and greets them by name", async () => {
    const [reply] = await send("/start");

    const [row] = await db.select().from(users).where(eq(users.telegramId, USER.id));
    expect(row?.firstName).toBe("Asha");
    expect(reply?.payload.text).toContain("Hey Asha!");
  });

  it("/help lists commands", async () => {
    const [reply] = await send("/help");
    expect(reply?.payload.text).toContain("/next");
  });

  it("logs a movie and offers rating buttons", async () => {
    const [reply] = await send("watched dune 2");

    expect(reply?.payload.text).toContain("✅ Logged <b>Dune: Part Two</b> (2024)");
    expect(buttonData(reply)).toHaveLength(5);
    expect(await db.select().from(watchEvents)).toHaveLength(1);
  });

  it("saves a rating from the buttons", async () => {
    const [reply] = await send("watched dune 2");
    const fourStars = buttonData(reply)[3] ?? "";

    const result = await press(fourStars, "✅ Logged Dune: Part Two (2024)");

    const title = await findTitle(db, "movie", DUNE_2.tmdbId);
    expect(await getRating(db, await userId(), title?.id ?? -1)).toBe(4);
    expect(result.find((c) => c.method === "editMessageText")?.payload.text).toContain("★★★★ 4");
  });

  it("uses an explicit rating instead of asking", async () => {
    const [reply] = await send("dune 2, 9/10");

    expect(reply?.payload.text).toContain("★★★★½ 4.5");
    expect(buttonData(reply)).toHaveLength(0);
  });

  it("logs an episode and shows the next one", async () => {
    const [reply] = await send("sev s2e5");

    expect(reply?.payload.text).toContain("S02E05");
    expect(reply?.payload.text).toContain("Next up: S02E06 “Episode 6”");
  });

  it("logs the next episode when none is given", async () => {
    await send("sev s2e5");
    const [reply] = await send("watched severance");

    expect(reply?.payload.text).toContain("S02E06");
  });

  it("logs a whole season and asks for a rating", async () => {
    const [reply] = await send("severance season 1");

    expect(reply?.payload.text).toContain("season 1 done");
    expect(reply?.payload.text).toContain("Next up: S02E01");
    expect(buttonData(reply)).toHaveLength(5);
  });

  it("asks which title when ambiguous, then logs the pick", async () => {
    const [question] = await send("watched dune");
    expect(question?.payload.text).toContain("Which “Dune”");
    const options = buttonData(question);
    expect(options).toHaveLength(4); // up to 3 candidates + "None of these"

    const labels = question?.payload.reply_markup.inline_keyboard
      .flat()
      .map((b: { text: string }) => b.text);
    const pick1984 = options[labels.findIndex((l: string) => l.includes("1984"))] ?? "";
    const result = await press(pick1984);

    expect(result.find((c) => c.method === "sendMessage")?.payload.text).toContain(
      "<b>Dune</b> (1984)",
    );
  });

  it("handles 'none of these'", async () => {
    const [question] = await send("watched dune");
    const none = buttonData(question).at(-1) ?? "";

    const result = await press(none);
    expect(result.find((c) => c.method === "editMessageText")?.payload.text).toContain(
      "nothing logged",
    );
  });

  it("reports titles it cannot find", async () => {
    const [reply] = await send("watched zzz");
    expect(reply?.payload.text).toContain("couldn't find");
  });

  it("answers progress questions", async () => {
    await send("sev s2e5");
    const [reply] = await send("where am i in severance");

    expect(reply?.payload.text).toContain("You're at S02E05");
    expect(reply?.payload.text).toContain("Next up: S02E06");
  });

  it("adds to the watchlist and lists it", async () => {
    const [added] = await send("add dune 2 to my list");
    expect(added?.payload.text).toContain("📌 Added");
    expect(await getWatchlist(db, await userId())).toHaveLength(1);

    const [list] = await send("/watchlist");
    expect(list?.payload.text).toContain("Dune: Part Two");
  });

  it("/next lists shows in progress", async () => {
    await send("sev s2e5");
    const [reply] = await send("/next");

    expect(reply?.payload.text).toContain("Severance");
    expect(reply?.payload.text).toContain("next S02E06");
  });

  it("/undo removes the last watch", async () => {
    await send("sev s2e5");
    await send("watched severance");
    const [reply] = await send("/undo");

    expect(reply?.payload.text).toContain("Removed");
    const title = await findTitle(db, "tv", SEVERANCE.tmdbId);
    expect(await getProgress(db, await userId(), title?.id ?? -1)).toMatchObject({ episode: 5 });
  });

  it("asks for a rating when none is given", async () => {
    const [reply] = await send("rate dune 2");
    expect(buttonData(reply)).toHaveLength(5);
  });

  it("falls back gracefully on messages it doesn't understand", async () => {
    const [reply] = await send("hello there");
    expect(reply?.payload.text).toContain("not sure");
  });
});
