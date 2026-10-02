import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.ts";
import { type Db, openDb } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import { type ApiCall, BOT_INFO, recordApiCalls, textUpdate, USER } from "./helpers/bot.ts";

describe("bot", () => {
  let db: Db;
  let close: () => Promise<void>;
  let calls: ApiCall[];
  let bot: ReturnType<typeof createBot>;

  beforeEach(async () => {
    ({ db, close } = await openDb("memory://"));
    bot = createBot("test-token", { db }, { botInfo: BOT_INFO });
    calls = recordApiCalls(bot);
  });

  afterEach(() => close());

  it("/start registers the user and greets them by name", async () => {
    await bot.handleUpdate(textUpdate("/start"));

    const [row] = await db.select().from(users).where(eq(users.telegramId, USER.id));
    expect(row?.firstName).toBe("Asha");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(calls[0]?.payload.text).toContain("Hey Asha!");
  });

  it("/start twice keeps a single user row", async () => {
    await bot.handleUpdate(textUpdate("/start"));
    await bot.handleUpdate(textUpdate("/start"));

    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("/help lists commands", async () => {
    await bot.handleUpdate(textUpdate("/help"));

    expect(calls[0]?.payload.text).toContain("/start");
  });
});
