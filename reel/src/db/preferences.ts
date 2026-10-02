import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import type { Db } from "./client.ts";
import { type Polarity, type Preference, preferences } from "./schema.ts";

export async function addPreference(
  db: Db,
  input: {
    userId: number;
    fact: string;
    polarity: Polarity;
    genres: string[];
    expiresAt?: Date | null;
  },
): Promise<Preference> {
  const [row] = await db.insert(preferences).values(input).returning();
  if (!row) throw new Error("addPreference returned no row");
  return row;
}

/** Preferences that still apply: lasting ones, plus temporary ones that haven't expired. */
export async function activePreferences(
  db: Db,
  userId: number,
  now = new Date(),
): Promise<Preference[]> {
  return db
    .select()
    .from(preferences)
    .where(
      and(
        eq(preferences.userId, userId),
        or(isNull(preferences.expiresAt), gt(preferences.expiresAt, now)),
      ),
    )
    .orderBy(asc(preferences.createdAt), asc(preferences.id));
}

export async function deletePreference(db: Db, userId: number, id: number): Promise<boolean> {
  const rows = await db
    .delete(preferences)
    .where(and(eq(preferences.id, id), eq(preferences.userId, userId)))
    .returning();
  return rows.length > 0;
}

export async function clearPreferences(db: Db, userId: number): Promise<number> {
  const rows = await db.delete(preferences).where(eq(preferences.userId, userId)).returning();
  return rows.length;
}
