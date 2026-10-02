import type { Db } from "../db/client.ts";
import { getProgress, libraryKeys, logWatch, setProgress } from "../db/library.ts";
import type { Title, WatchSource } from "../db/schema.ts";
import { findTitle, upsertTitle } from "../db/titles.ts";
import type { EpisodeRef, TitleKind, TmdbApi } from "../tmdb/client.ts";
import { type MatchHints, type MatchResult, matchTitle } from "../tmdb/match.ts";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface WatchRequest {
  season: number | null;
  episode: number | null;
  finishedSeries: boolean;
  note: string | null;
}

export type WatchOutcome =
  | { type: "movie"; title: Title }
  | {
      type: "tv";
      title: Title;
      season: number;
      episode: number;
      wholeSeason: boolean;
      finishedSeries: boolean;
      next: EpisodeRef | null;
    }
  | { type: "unknown_season"; title: Title; season: number };

export class Tracker {
  readonly #db: Db;
  readonly #tmdb: TmdbApi;
  readonly #now: () => Date;

  constructor(deps: { db: Db; tmdb: TmdbApi; now?: () => Date }) {
    this.#db = deps.db;
    this.#tmdb = deps.tmdb;
    this.#now = deps.now ?? (() => new Date());
  }

  /** Find the TMDB title a user means, favouring titles already in their library. */
  async resolve(userId: number, hints: MatchHints): Promise<MatchResult> {
    const [results, library] = await Promise.all([
      this.#tmdb.search(hints.query),
      libraryKeys(this.#db, userId),
    ]);
    return matchTitle(hints, results, library);
  }

  /** Get a title from the local cache, fetching fresh details from TMDB when missing or stale. */
  async ensureTitle(kind: TitleKind, tmdbId: number): Promise<Title> {
    const cached = await findTitle(this.#db, kind, tmdbId);
    if (cached && this.#now().getTime() - cached.fetchedAt.getTime() < STALE_AFTER_MS)
      return cached;
    return upsertTitle(this.#db, await this.#tmdb.details(kind, tmdbId));
  }

  /** Re-fetch a title from TMDB regardless of cache age (e.g. to pick up new episodes). */
  async refreshTitle(title: Title): Promise<Title> {
    return upsertTitle(this.#db, await this.#tmdb.details(title.kind, title.tmdbId));
  }

  async logWatch(
    userId: number,
    title: Title,
    req: WatchRequest,
    source: WatchSource,
  ): Promise<WatchOutcome> {
    if (title.kind === "movie") {
      await logWatch(this.#db, { userId, titleId: title.id, note: req.note, source });
      return { type: "movie", title };
    }

    const target = await this.#episodeToLog(userId, title, req);
    if (!target) return { type: "unknown_season", title, season: req.season ?? 0 };

    await logWatch(this.#db, {
      userId,
      titleId: title.id,
      season: target.season,
      episode: target.episode,
      note: req.note,
      source,
    });
    const next = await this.nextEpisode(title, target.season, target.episode);
    if (req.finishedSeries || (!next && title.status && title.status !== "Returning Series")) {
      await setProgress(this.#db, userId, title.id, target.season, target.episode, "finished");
    }
    return {
      type: "tv",
      title,
      ...target,
      wholeSeason: req.season != null && req.episode == null,
      finishedSeries: req.finishedSeries,
      next,
    };
  }

  /** The episode after S{season}E{episode}, or null when there is none listed yet. */
  async nextEpisode(title: Title, season: number, episode: number): Promise<EpisodeRef | null> {
    const current = title.seasons.find((s) => s.seasonNumber === season);
    const candidate =
      current && episode < current.episodeCount
        ? { season, episode: episode + 1 }
        : title.seasons.some((s) => s.seasonNumber === season + 1 && s.episodeCount > 0)
          ? { season: season + 1, episode: 1 }
          : null;
    if (!candidate) return null;

    const details = await this.#tmdb.season(title.tmdbId, candidate.season).catch(() => null);
    return (
      details?.episodes.find((e) => e.episodeNumber === candidate.episode) ?? {
        seasonNumber: candidate.season,
        episodeNumber: candidate.episode,
        name: "",
        airDate: null,
      }
    );
  }

  async #episodeToLog(
    userId: number,
    title: Title,
    req: WatchRequest,
  ): Promise<{ season: number; episode: number } | null> {
    if (req.season != null && req.episode != null)
      return { season: req.season, episode: req.episode };

    if (req.episode != null) {
      // "watched ep 3" with no season: stay in the season they're on.
      const progress = await getProgress(this.#db, userId, title.id);
      return { season: progress?.season ?? 1, episode: req.episode };
    }

    if (req.season != null) {
      const season = title.seasons.find((s) => s.seasonNumber === req.season);
      return season ? { season: season.seasonNumber, episode: season.episodeCount } : null;
    }

    if (req.finishedSeries) {
      const aired = title.seasons.filter((s) => s.episodeCount > 0 && s.airDate);
      const last = aired.at(-1);
      if (!last) return null;
      const upcoming = title.nextEpisodeToAir;
      // A season that is still airing lists future episodes; stop before the next unaired one.
      if (upcoming && upcoming.seasonNumber === last.seasonNumber) {
        return upcoming.episodeNumber > 1
          ? { season: last.seasonNumber, episode: upcoming.episodeNumber - 1 }
          : this.#lastEpisodeBefore(title, last.seasonNumber);
      }
      return { season: last.seasonNumber, episode: last.episodeCount };
    }

    // No season or episode given: assume they watched the next one.
    const progress = await getProgress(this.#db, userId, title.id);
    if (!progress) return { season: 1, episode: 1 };
    const next = await this.nextEpisode(title, progress.season, progress.episode);
    return next
      ? { season: next.seasonNumber, episode: next.episodeNumber }
      : { season: progress.season, episode: progress.episode };
  }

  #lastEpisodeBefore(title: Title, season: number): { season: number; episode: number } | null {
    const prev = title.seasons.filter((s) => s.seasonNumber < season && s.episodeCount > 0).at(-1);
    return prev ? { season: prev.seasonNumber, episode: prev.episodeCount } : null;
  }
}
