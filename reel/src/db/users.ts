import type { Db } from "./client.ts";
import { type User, users } from "./schema.ts";

export async function upsertUser(
  db: Db,
  input: { telegramId: number; firstName?: string },
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ telegramId: input.telegramId, firstName: input.firstName })
    .onConflictDoUpdate({ target: users.telegramId, set: { firstName: input.firstName } })
    .returning();
  if (!user) throw new Error("upsertUser returned no row");
  return user;
}
