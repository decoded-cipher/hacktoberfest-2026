import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.ts";
import { type Db, openDb } from "../src/db/client.ts";
import { OTHER } from "../src/nlu/schema.ts";
import {
  type ApiCall,
  BOT_INFO,
  documentUpdate,
  recordApiCalls,
  textUpdate,
} from "./helpers/bot.ts";
import { FakeTmdb } from "./helpers/fake-tmdb.ts";
import { ARRIVAL, DUNE_2, details, letterboxdZip } from "./helpers/fixtures.ts";

describe("bot import", () => {
  let db: Db;
  let close: () => Promise<void>;
  let calls: ApiCall[];
  let bot: ReturnType<typeof createBot>;
  let upload: Uint8Array;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    const tmdb = new FakeTmdb([
      DUNE_2,
      ARRIVAL,
      details({ tmdbId: 666277, title: "Past Lives", year: 2023 }),
    ]);
    upload = letterboxdZip();
    bot = createBot(
      "t",
      { db, tmdb, parse: async () => OTHER, download: async () => upload },
      { botInfo: BOT_INFO },
    );
    calls = recordApiCalls(bot);
  });

  afterEach(() => close());

  it("imports an uploaded Letterboxd ZIP and reports a summary", async () => {
    await bot.handleUpdate(documentUpdate("letterboxd.zip"));

    const final = calls.filter((c) => c.method === "editMessageText").at(-1);
    expect(final?.payload.text).toContain("matched 3 of 4");
    expect(final?.payload.text).toContain("Some Obscure Film (1971)");
  });

  it("rejects unsupported files", async () => {
    await bot.handleUpdate(documentUpdate("photo.png"));
    expect(calls.at(-1)?.payload.text).toContain(".zip");
  });

  it("rejects files over the download limit", async () => {
    await bot.handleUpdate(documentUpdate("big.zip", 30 * 1024 * 1024));
    expect(calls.at(-1)?.payload.text).toContain("too big");
  });

  it("/import explains how to export", async () => {
    await bot.handleUpdate(textUpdate("/import"));
    expect(calls.at(-1)?.payload.text).toContain("Letterboxd");
  });
});
