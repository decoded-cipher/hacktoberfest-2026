import type { Db } from "../db/client.ts";
import { addToWatchlist, hasWatched, logWatch, setRating } from "../db/library.ts";
import type { Tracker } from "../services/tracker.ts";
import type { SearchResult, TmdbApi } from "../tmdb/client.ts";
import { matchTitle } from "../tmdb/match.ts";
import type { ImportItem, ImportSummary } from "./types.ts";

const CONCURRENCY = 6;

export interface ImportDeps {
  db: Db;
  tmdb: TmdbApi;
  tracker: Tracker;
}

/** Match each item on TMDB and store its rating, watch and watchlist state. Safe to re-run. */
export async function importItems(
  deps: ImportDeps,
  userId: number,
  items: ImportItem[],
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    total: items.length,
    matched: 0,
    rated: 0,
    watched: 0,
    watchlisted: 0,
    unmatched: [],
  };
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (!item) break;
      try {
        await importOne(deps, userId, item, summary);
      } catch (err) {
        console.warn(`Import failed for ${item.name}:`, err);
        summary.unmatched.push(label(item));
      }
      done++;
      await onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return summary;
}

async function importOne(deps: ImportDeps, userId: number, item: ImportItem, s: ImportSummary) {
  const found = await findOnTmdb(deps.tmdb, item);
  if (!found) {
    s.unmatched.push(label(item));
    return;
  }
  s.matched++;
  const title = await deps.tracker.ensureTitle(found.kind, found.tmdbId);

  if (item.rating != null) {
    await setRating(deps.db, userId, title.id, item.rating, item.ratedAt ?? undefined);
    s.rated++;
  }
  if (item.watchedAt && title.kind === "movie" && !(await hasWatched(deps.db, userId, title.id))) {
    await logWatch(deps.db, {
      userId,
      titleId: title.id,
      source: "import",
      watchedAt: item.watchedAt,
    });
    s.watched++;
  }
  if (item.watchlist && !(await hasWatched(deps.db, userId, title.id))) {
    if (await addToWatchlist(deps.db, userId, title.id, "import")) s.watchlisted++;
  }
}

async function findOnTmdb(tmdb: TmdbApi, item: ImportItem): Promise<SearchResult | null> {
  if (item.imdbId) {
    const found = await tmdb.findByImdbId(item.imdbId);
    if (found) return found;
  }
  const results =
    item.kind === "movie"
      ? await tmdb.searchMovie(item.name, item.year ?? undefined)
      : await tmdb.search(item.name);
  const match = matchTitle({ query: item.name, year: item.year, kind: item.kind }, results);
  // Exports name titles exactly, so the best candidate is safe even when the matcher would ask.
  if (match.status === "match") return match.title;
  if (match.status === "ambiguous") return match.candidates[0] ?? null;
  return null;
}

const label = (item: ImportItem) => `${item.name}${item.year ? ` (${item.year})` : ""}`;
