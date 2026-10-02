import { and, desc, eq } from "drizzle-orm";
import { libraryKey } from "../tmdb/match.ts";
import type { Db } from "./client.ts";
import {
  ratings,
  type ShowProgress,
  type ShowStatus,
  showProgress,
  type Title,
  titles,
  type WatchEvent,
  type WatchSource,
  watchEvents,
  watchlist,
} from "./schema.ts";

export interface LogWatchInput {
  userId: number;
  titleId: number;
  season?: number | null;
  episode?: number | null;
  note?: string | null;
  source: WatchSource;
  watchedAt?: Date;
}

/** Record a watch. For episodes, moves show progress forward (never backwards). */
export async function logWatch(db: Db, input: LogWatchInput): Promise<WatchEvent> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(watchEvents)
      .values({
        userId: input.userId,
        titleId: input.titleId,
        season: input.season ?? null,
        episode: input.episode ?? null,
        note: input.note ?? null,
        source: input.source,
        watchedAt: input.watchedAt,
      })
      .returning();
    if (!event) throw new Error("logWatch returned no row");

    if (input.season != null && input.episode != null) {
      const current = await getProgress(tx, input.userId, input.titleId);
      if (!current || isAfter(input.season, input.episode, current.season, current.episode)) {
        await setProgress(tx, input.userId, input.titleId, input.season, input.episode);
      }
    }
    await tx
      .delete(watchlist)
      .where(and(eq(watchlist.userId, input.userId), eq(watchlist.titleId, input.titleId)));
    return event;
  });
}

export async function setProgress(
  db: Db,
  userId: number,
  titleId: number,
  season: number,
  episode: number,
  status: ShowStatus = "watching",
): Promise<void> {
  const values = { season, episode, status, updatedAt: new Date() };
  await db
    .insert(showProgress)
    .values({ userId, titleId, ...values })
    .onConflictDoUpdate({ target: [showProgress.userId, showProgress.titleId], set: values });
}

export async function getProgress(
  db: Db,
  userId: number,
  titleId: number,
): Promise<ShowProgress | null> {
  const [row] = await db
    .select()
    .from(showProgress)
    .where(and(eq(showProgress.userId, userId), eq(showProgress.titleId, titleId)));
  return row ?? null;
}

export async function continueWatching(
  db: Db,
  userId: number,
): Promise<{ progress: ShowProgress; title: Title }[]> {
  return db
    .select({ progress: showProgress, title: titles })
    .from(showProgress)
    .innerJoin(titles, eq(titles.id, showProgress.titleId))
    .where(and(eq(showProgress.userId, userId), eq(showProgress.status, "watching")))
    .orderBy(desc(showProgress.updatedAt));
}

/** Store a 0.5–5 star rating, rounded to the nearest half star. */
export async function setRating(
  db: Db,
  userId: number,
  titleId: number,
  rating: number,
  ratedAt = new Date(),
): Promise<number> {
  const value = Math.min(5, Math.max(0.5, Math.round(rating * 2) / 2));
  await db
    .insert(ratings)
    .values({ userId, titleId, rating: value, ratedAt })
    .onConflictDoUpdate({
      target: [ratings.userId, ratings.titleId],
      set: { rating: value, ratedAt },
    });
  return value;
}

export async function getRating(db: Db, userId: number, titleId: number): Promise<number | null> {
  const [row] = await db
    .select({ rating: ratings.rating })
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.titleId, titleId)));
  return row?.rating ?? null;
}

export async function addToWatchlist(
  db: Db,
  userId: number,
  titleId: number,
  source: WatchSource,
  addedAt = new Date(),
): Promise<boolean> {
  const rows = await db
    .insert(watchlist)
    .values({ userId, titleId, source, addedAt })
    .onConflictDoNothing()
    .returning();
  return rows.length > 0;
}

export async function removeFromWatchlist(db: Db, userId: number, titleId: number): Promise<void> {
  await db
    .delete(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.titleId, titleId)));
}

export async function getWatchlist(db: Db, userId: number): Promise<Title[]> {
  const rows = await db
    .select({ title: titles })
    .from(watchlist)
    .innerJoin(titles, eq(titles.id, watchlist.titleId))
    .where(eq(watchlist.userId, userId))
    .orderBy(desc(watchlist.addedAt));
  return rows.map((r) => r.title);
}

export async function recentHistory(
  db: Db,
  userId: number,
  limit = 10,
): Promise<{ event: WatchEvent; title: Title }[]> {
  return db
    .select({ event: watchEvents, title: titles })
    .from(watchEvents)
    .innerJoin(titles, eq(titles.id, watchEvents.titleId))
    .where(eq(watchEvents.userId, userId))
    .orderBy(desc(watchEvents.watchedAt), desc(watchEvents.id))
    .limit(limit);
}

/** Delete the user's most recent watch and rewind show progress to the latest remaining episode. */
export async function undoLastWatch(
  db: Db,
  userId: number,
): Promise<{ event: WatchEvent; title: Title } | null> {
  return db.transaction(async (tx) => {
    const [last] = await recentHistory(tx, userId, 1);
    if (!last) return null;
    await tx.delete(watchEvents).where(eq(watchEvents.id, last.event.id));

    if (last.event.season != null) {
      const remaining = await tx
        .select({ season: watchEvents.season, episode: watchEvents.episode })
        .from(watchEvents)
        .where(and(eq(watchEvents.userId, userId), eq(watchEvents.titleId, last.title.id)));
      const latest = remaining
        .filter(
          (e): e is { season: number; episode: number } => e.season != null && e.episode != null,
        )
        .sort((a, b) => b.season - a.season || b.episode - a.episode)[0];
      if (latest) {
        await setProgress(tx, userId, last.title.id, latest.season, latest.episode);
      } else {
        await tx
          .delete(showProgress)
          .where(and(eq(showProgress.userId, userId), eq(showProgress.titleId, last.title.id)));
      }
    }
    return last;
  });
}

export async function hasWatched(db: Db, userId: number, titleId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: watchEvents.id })
    .from(watchEvents)
    .where(and(eq(watchEvents.userId, userId), eq(watchEvents.titleId, titleId)))
    .limit(1);
  return row != null;
}

/** Keys (see `libraryKey`) of every title the user has watched, rated or saved. */
export async function libraryKeys(db: Db, userId: number): Promise<Set<string>> {
  const keys = new Set<string>();
  const add = (rows: { kind: Title["kind"]; tmdbId: number }[]) => {
    for (const r of rows) keys.add(libraryKey(r.kind, r.tmdbId));
  };
  const cols = { kind: titles.kind, tmdbId: titles.tmdbId };
  add(
    await db
      .select(cols)
      .from(watchEvents)
      .innerJoin(titles, eq(titles.id, watchEvents.titleId))
      .where(eq(watchEvents.userId, userId)),
  );
  add(
    await db
      .select(cols)
      .from(watchlist)
      .innerJoin(titles, eq(titles.id, watchlist.titleId))
      .where(eq(watchlist.userId, userId)),
  );
  add(
    await db
      .select(cols)
      .from(ratings)
      .innerJoin(titles, eq(titles.id, ratings.titleId))
      .where(eq(ratings.userId, userId)),
  );
  return keys;
}

const isAfter = (s1: number, e1: number, s2: number, e2: number) =>
  s1 > s2 || (s1 === s2 && e1 > e2);

/** Titles the user is most likely to mention: shows in progress, recent watches, watchlist. */
export async function likelyTitles(db: Db, userId: number, limit = 40): Promise<string[]> {
  const [watching, recent, saved] = await Promise.all([
    continueWatching(db, userId),
    recentHistory(db, userId, 20),
    getWatchlist(db, userId),
  ]);
  const names = [
    ...watching.map((r) => r.title.title),
    ...recent.map((r) => r.title.title),
    ...saved.map((t) => t.title),
  ];
  return [...new Set(names)].slice(0, limit);
}
