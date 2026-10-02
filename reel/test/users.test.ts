import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client.ts";
import { upsertUser } from "../src/db/users.ts";

describe("upsertUser", () => {
  it("keeps the stored name when Telegram sends none", async () => {
    const { db, close } = await openDb("memory://");
    await upsertUser(db, { telegramId: 1, firstName: "Asha" });
    const again = await upsertUser(db, { telegramId: 1 });

    expect(again.firstName).toBe("Asha");
    await close();
  });
});
