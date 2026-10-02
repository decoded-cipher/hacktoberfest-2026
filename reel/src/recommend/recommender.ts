import type { Db } from "../db/client.ts";
import { getWatchlist } from "../db/library.ts";
import { activePreferences } from "../db/preferences.ts";
import type { Title } from "../db/schema.ts";
import { excludedTitleIds, ratedTitles, recordSuggestion } from "../db/suggestions.ts";
import type { Tracker } from "../services/tracker.ts";
import type { TitleKind, TmdbApi } from "../tmdb/client.ts";
import { libraryKey } from "../tmdb/match.ts";
import { explain } from "./explain.ts";
import { canonicalGenres, featureRow, type RatedTitle, TasteProfile } from "./features.ts";
import type { RatingModel } from "./models.ts";
import { preferenceAdjustment, withPreferences } from "./preferences.ts";

export const MIN_RATINGS = 5;
const SEEDS = 3;
const PER_SEED = 10;
const TRENDING = 10;
const FETCH_CONCURRENCY = 8;

export interface SuggestFilters {
  kind?: TitleKind | null;
  maxRuntime?: number | null;
  genres?: string[];
  avoidGenres?: string[];
}

export interface Suggestion {
  id: number;
  title: Title;
  predicted: number;
  reason: string;
}

export interface SuggestResult {
  suggestions: Suggestion[];
  model: string;
  ratingsUsed: number;
  coldStart: boolean;
}

interface Candidate {
  title: Title;
  source: string | null;
}

export class Recommender {
  readonly #db: Db;
  readonly #tmdb: TmdbApi;
  readonly #tracker: Tracker;
  readonly #model: RatingModel;
  readonly #fallback: RatingModel;
  readonly #now: () => Date;

  constructor(deps: {
    db: Db;
    tmdb: TmdbApi;
    tracker: Tracker;
    model: RatingModel;
    fallback: RatingModel;
    now?: () => Date;
  }) {
    this.#now = deps.now ?? (() => new Date());
    this.#db = deps.db;
    this.#tmdb = deps.tmdb;
    this.#tracker = deps.tracker;
    this.#model = deps.model;
    this.#fallback = deps.fallback;
  }

  async suggest(userId: number, filters: SuggestFilters = {}, limit = 3): Promise<SuggestResult> {
    const [rated, prefs] = await Promise.all([
      ratedTitles(this.#db, userId),
      activePreferences(this.#db, userId, this.#now()),
    ]);
    const effective = withPreferences(filters, prefs);
    const candidates = (await this.#candidates(userId, rated)).filter((c) =>
      matchesFilters(c.title, effective),
    );
    if (candidates.length === 0) {
      return {
        suggestions: [],
        model: this.#model.name,
        ratingsUsed: rated.length,
        coldStart: false,
      };
    }

    const coldStart = rated.length < MIN_RATINGS;
    const { scores, model } = coldStart
      ? { scores: candidates.map((c) => popularityScore(c.title)), model: "TMDB popularity" }
      : await this.#predict(
          rated,
          candidates.map((c) => c.title),
        );

    const ranked = candidates
      .map((c, i) => ({
        ...c,
        predicted: Math.min(
          5,
          Math.max(0.5, (scores[i] ?? 0) + preferenceAdjustment(c.title, prefs)),
        ),
      }))
      .sort((a, b) => b.predicted - a.predicted || b.title.popularity - a.title.popularity)
      .slice(0, limit);

    const suggestions: Suggestion[] = [];
    for (const c of ranked) {
      const row = await recordSuggestion(this.#db, {
        userId,
        titleId: c.title.id,
        predicted: c.predicted,
        model,
      });
      suggestions.push({
        id: row.id,
        title: c.title,
        predicted: c.predicted,
        reason: explain(c.title, rated, c.source),
      });
    }
    return { suggestions, model, ratingsUsed: rated.length, coldStart };
  }

  /** Predicted ratings for titles, falling back to the local model if the main one fails. */
  async #predict(
    rated: RatedTitle[],
    titles: Title[],
  ): Promise<{ scores: number[]; model: string }> {
    const profile = new TasteProfile(rated);
    const train = rated.map((r) => featureRow(r.title, profile));
    const y = rated.map((r) => r.rating);
    const test = titles.map((t) => featureRow(t, profile));
    try {
      return { scores: await this.#model.fitPredict(train, y, test), model: this.#model.name };
    } catch (err) {
      console.warn(`${this.#model.name} failed, using ${this.#fallback.name}:`, err);
      return {
        scores: await this.#fallback.fitPredict(train, y, test),
        model: this.#fallback.name,
      };
    }
  }

  /** Watchlist + TMDB recommendations seeded by top-rated titles + trending, minus anything seen. */
  async #candidates(userId: number, rated: RatedTitle[]): Promise<Candidate[]> {
    const excluded = await excludedTitleIds(this.#db, userId);
    const seen = new Set<string>();
    const out: Candidate[] = [];
    const add = (title: Title, source: string | null) => {
      const key = libraryKey(title.kind, title.tmdbId);
      if (excluded.has(title.id) || seen.has(key)) return;
      seen.add(key);
      out.push({ title, source });
    };

    for (const t of await getWatchlist(this.#db, userId)) add(t, "from your watchlist");

    const seeds = rated.filter((r) => r.rating >= 4).slice(0, SEEDS);
    const refs = [
      ...(
        await Promise.all(
          seeds.map(async (s) =>
            (
              await this.#tmdb.recommendations(s.title.kind, s.title.tmdbId).catch(() => [])
            )
              .slice(0, PER_SEED)
              .map((r) => ({ ref: r, source: `because you liked ${s.title.title}` })),
          ),
        )
      ).flat(),
      ...(await this.#tmdb.trending().catch(() => []))
        .slice(0, TRENDING)
        .map((r) => ({ ref: r, source: "trending this week" })),
    ];

    const titles = await mapLimit(refs, FETCH_CONCURRENCY, async ({ ref, source }) => {
      const title = await this.#tracker.ensureTitle(ref.kind, ref.tmdbId).catch(() => null);
      return title ? { title, source } : null;
    });
    for (const t of titles) if (t) add(t.title, t.source);
    return out;
  }
}

export function matchesFilters(title: Title, f: SuggestFilters): boolean {
  if (f.kind && title.kind !== f.kind) return false;
  if (f.maxRuntime && title.runtime && title.runtime > f.maxRuntime) return false;
  const genres = canonicalGenres(title.genres);
  const lower = new Set([...genres].map((g) => g.toLowerCase()));
  if (f.genres?.length && !f.genres.some((g) => lower.has(g.toLowerCase()))) return false;
  if (f.avoidGenres?.some((g) => lower.has(g.toLowerCase()))) return false;
  return true;
}

/** Cold-start ranking: TMDB score weighted by how many people voted, mapped onto 0.5–5. */
function popularityScore(t: Title): number {
  const confidence = Math.min(1, Math.log10(t.voteCount + 1) / 4);
  return Math.max(0.5, (t.voteAverage / 2) * confidence);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
