import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.ts";
import { type Db, openDb } from "../src/db/client.ts";
import { getWatchlist, setRating } from "../src/db/library.ts";
import { suggestions, users, watchEvents } from "../src/db/schema.ts";
import { upsertTitle } from "../src/db/titles.ts";
import { upsertUser } from "../src/db/users.ts";
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
import { FakeTmdb, toResult } from "./helpers/fake-tmdb.ts";
import { details } from "./helpers/fixtures.ts";

const RATED = Array.from({ length: 6 }, (_, i) =>
  details({ tmdbId: i + 1, title: `Rated ${i + 1}`, genres: i < 3 ? ["Comedy"] : ["Horror"] }),
);
const COMEDY = details({
  tmdbId: 50,
  title: "New Comedy",
  genres: ["Comedy"],
  posterPath: "/c.jpg",
});
const HORROR = details({ tmdbId: 51, title: "New Horror", genres: ["Horror"] });

const PARSES: Record<string, Partial<ParsedMessage>> = {
  "what should i watch": { intent: "suggest" },
  "something funny": { intent: "suggest", genres: ["Comedy"] },
};

describe("bot suggestions", () => {
  let db: Db;
  let close: () => Promise<void>;
  let calls: ApiCall[];
  let bot: ReturnType<typeof createBot>;

  const send = async (text: string) => {
    calls.length = 0;
    await bot.handleUpdate(textUpdate(text));
    return calls.filter((c) => c.method === "sendMessage" || c.method === "sendPhoto");
  };
  const press = async (data: string) => {
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(data));
    return calls;
  };
  const cards = (sent: ApiCall[]) =>
    sent.filter((c) => buttonData(c).some((d) => d.startsWith("sg:")));

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    const tmdb = new FakeTmdb([...RATED, COMEDY, HORROR]);
    tmdb.trendingTitles = [toResult(COMEDY), toResult(HORROR)];
    bot = createBot(
      "t",
      { db, tmdb, parse: async (text) => ({ ...OTHER, ...PARSES[text] }) },
      { botInfo: BOT_INFO },
    );
    calls = recordApiCalls(bot);

    const userId = (await upsertUser(db, { telegramId: USER.id, firstName: "Asha" })).id;
    for (const [i, d] of RATED.entries()) {
      await setRating(db, userId, (await upsertTitle(db, d)).id, i < 3 ? 5 : 1);
    }
  });

  afterEach(() => close());

  it("sends ranked cards with a poster when available", async () => {
    const sent = await send("what should i watch");

    expect(sent[0]?.payload.text).toContain("from your 6 ratings");
    const shown = cards(sent);
    expect(shown).toHaveLength(2);
    expect(shown[0]?.method).toBe("sendPhoto");
    expect(shown[0]?.payload.caption).toContain("New Comedy");
    expect(shown[0]?.payload.caption).toContain("Predicted for you");
  });

  it("/suggest with words applies filters", async () => {
    const sent = await send("/suggest something funny");
    const captions = cards(sent).map((c) => c.payload.caption ?? c.payload.text);
    expect(captions).toHaveLength(1);
    expect(captions[0]).toContain("New Comedy");
  });

  it("'Not for me' stops the title being suggested again", async () => {
    const [card] = cards(await send("what should i watch"));
    const dismiss = buttonData(card).find((d) => d.startsWith("sg:x:")) ?? "";

    const result = await press(dismiss);
    expect(result.find((c) => c.method === "answerCallbackQuery")?.payload.text).toContain(
      "won't suggest",
    );
    const again = cards(await send("what should i watch")).map(
      (c) => c.payload.caption ?? c.payload.text,
    );
    expect(again.join()).not.toContain("New Comedy");
  });

  it("'Save' adds to the watchlist", async () => {
    const [card] = cards(await send("what should i watch"));
    await press(buttonData(card).find((d) => d.startsWith("sg:s:")) ?? "");

    const [user] = await db.select().from(users).where(eq(users.telegramId, USER.id));
    expect((await getWatchlist(db, user?.id ?? -1)).map((t) => t.title)).toEqual(["New Comedy"]);
    expect((await db.select().from(suggestions)).find((s) => s.outcome === "saved")).toBeDefined();
  });

  it("'Watched' logs it and asks for a rating", async () => {
    const [card] = cards(await send("what should i watch"));
    const result = await press(buttonData(card).find((d) => d.startsWith("sg:w:")) ?? "");

    const reply = result.find((c) => c.method === "sendMessage");
    expect(reply?.payload.text).toContain("✅ Logged");
    expect(buttonData(reply).every((d) => d.startsWith("rate:"))).toBe(true);
    expect(await db.select().from(watchEvents)).toHaveLength(1);
  });

  it("explains cold start to new users", async () => {
    await db.delete(users);
    const sent = await send("what should i watch");
    expect(sent[0]?.payload.text).toContain("rate at least 5");
  });
});
