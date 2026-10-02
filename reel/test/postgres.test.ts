/**
 * Runs the database layer against a real Postgres server (the production driver).
 * Set TEST_DATABASE_URL to enable, e.g. postgres://postgres:postgres@localhost:5432/reel_test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, openDb } from "../src/db/client.ts";
import { getProgress, logWatch, setRating, undoLastWatch } from "../src/db/library.ts";
import { activePreferences, addPreference } from "../src/db/preferences.ts";
import { ratedTitles } from "../src/db/suggestions.ts";
import { upsertTitle } from "../src/db/titles.ts";
import { upsertUser } from "../src/db/users.ts";
import { SEVERANCE } from "./helpers/fixtures.ts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres (node-postgres driver)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await openDb(url ?? ""));
  });

  afterAll(() => close());

  it("migrates and round-trips arrays, jsonb and transactions", async () => {
    const telegramId = Date.now();
    const user = await upsertUser(db, { telegramId, firstName: "Pg" });
    const show = await upsertTitle(db, SEVERANCE);
    expect(show.genres).toEqual(SEVERANCE.genres);
    expect(show.seasons).toEqual(SEVERANCE.seasons);

    await logWatch(db, {
      userId: user.id,
      titleId: show.id,
      season: 1,
      episode: 1,
      source: "chat",
    });
    await logWatch(db, {
      userId: user.id,
      titleId: show.id,
      season: 1,
      episode: 2,
      source: "chat",
    });
    await undoLastWatch(db, user.id);
    expect(await getProgress(db, user.id, show.id)).toMatchObject({ season: 1, episode: 1 });

    await setRating(db, user.id, show.id, 4.5);
    expect((await ratedTitles(db, user.id))[0]?.rating).toBe(4.5);

    await addPreference(db, {
      userId: user.id,
      fact: "no horror",
      polarity: "dislike",
      genres: ["Horror"],
    });
    expect((await activePreferences(db, user.id))[0]?.genres).toEqual(["Horror"]);
  });
});
