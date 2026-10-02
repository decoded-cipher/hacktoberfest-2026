import { and, eq } from "drizzle-orm";
import type { TitleDetails, TitleKind } from "../tmdb/client.ts";
import type { Db } from "./client.ts";
import { type Title, titles } from "./schema.ts";

/** Insert or refresh a title's cached TMDB metadata. */
export async function upsertTitle(db: Db, d: TitleDetails): Promise<Title> {
  const values = {
    tmdbId: d.tmdbId,
    kind: d.kind,
    title: d.title,
    year: d.year,
    overview: d.overview,
    posterPath: d.posterPath,
    genres: d.genres,
    runtime: d.runtime,
    directors: d.directors,
    cast: d.cast,
    keywords: d.keywords,
    language: d.language,
    voteAverage: d.voteAverage,
    voteCount: d.voteCount,
    popularity: d.popularity,
    status: d.status,
    seasons: d.seasons,
    nextEpisodeToAir: d.nextEpisodeToAir,
    fetchedAt: new Date(),
  };
  const [row] = await db
    .insert(titles)
    .values(values)
    .onConflictDoUpdate({ target: [titles.tmdbId, titles.kind], set: values })
    .returning();
  if (!row) throw new Error("upsertTitle returned no row");
  return row;
}

export async function findTitle(db: Db, kind: TitleKind, tmdbId: number): Promise<Title | null> {
  const [row] = await db
    .select()
    .from(titles)
    .where(and(eq(titles.kind, kind), eq(titles.tmdbId, tmdbId)));
  return row ?? null;
}

export async function findTitleById(db: Db, id: number): Promise<Title | null> {
  const [row] = await db.select().from(titles).where(eq(titles.id, id));
  return row ?? null;
}
