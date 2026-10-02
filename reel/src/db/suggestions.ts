import { and, desc, eq } from "drizzle-orm";
import type { RatedTitle } from "../recommend/features.ts";
import type { Db } from "./client.ts";
import {
  ratings,
  type Suggestion,
  type SuggestionOutcome,
  suggestions,
  titles,
  watchEvents,
} from "./schema.ts";

export async function ratedTitles(db: Db, userId: number): Promise<RatedTitle[]> {
  return db
    .select({ title: titles, rating: ratings.rating })
    .from(ratings)
    .innerJoin(titles, eq(titles.id, ratings.titleId))
    .where(eq(ratings.userId, userId))
    .orderBy(desc(ratings.rating), desc(ratings.ratedAt));
}

/** Title ids the user has already watched, rated or turned down; never suggest these. */
export async function excludedTitleIds(db: Db, userId: number): Promise<Set<number>> {
  const [watched, rated, dismissed] = await Promise.all([
    db
      .selectDistinct({ id: watchEvents.titleId })
      .from(watchEvents)
      .where(eq(watchEvents.userId, userId)),
    db.select({ id: ratings.titleId }).from(ratings).where(eq(ratings.userId, userId)),
    db
      .select({ id: suggestions.titleId })
      .from(suggestions)
      .where(and(eq(suggestions.userId, userId), eq(suggestions.outcome, "dismissed"))),
  ]);
  return new Set([...watched, ...rated, ...dismissed].map((r) => r.id));
}

export async function recordSuggestion(
  db: Db,
  input: { userId: number; titleId: number; predicted: number; model: string },
): Promise<Suggestion> {
  const [row] = await db.insert(suggestions).values(input).returning();
  if (!row) throw new Error("recordSuggestion returned no row");
  return row;
}

export async function getSuggestion(
  db: Db,
  userId: number,
  id: number,
): Promise<Suggestion | null> {
  const [row] = await db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.id, id), eq(suggestions.userId, userId)));
  return row ?? null;
}

export async function setSuggestionOutcome(
  db: Db,
  id: number,
  outcome: SuggestionOutcome,
): Promise<void> {
  await db.update(suggestions).set({ outcome }).where(eq(suggestions.id, id));
}
