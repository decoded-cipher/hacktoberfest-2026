import { and, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { notifications } from "./schema.ts";

/** Claim a notification key for a user. Returns false if it was already sent. */
export async function claimNotification(db: Db, userId: number, key: string): Promise<boolean> {
  const rows = await db
    .insert(notifications)
    .values({ userId, key })
    .onConflictDoNothing()
    .returning();
  return rows.length > 0;
}

/** Undo a claim when sending failed, so the next run retries it. */
export async function releaseNotification(db: Db, userId: number, key: string): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.key, key)));
}
