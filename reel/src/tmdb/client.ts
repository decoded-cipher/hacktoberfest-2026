import { z } from "zod";

const BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export type TitleKind = "movie" | "tv";

export interface SearchResult {
  tmdbId: number;
  kind: TitleKind;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  popularity: number;
  voteAverage: number;
  voteCount: number;
}

export interface SeasonSummary {
  seasonNumber: number;
  episodeCount: number;
  airDate: string | null;
}

export interface EpisodeRef {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  airDate: string | null;
}

export interface TitleDetails extends SearchResult {
  genres: string[];
  runtime: number | null;
  directors: string[];
  cast: string[];
  keywords: string[];
  language: string;
  /** TV only. */
  status: string | null;
  seasons: SeasonSummary[];
  nextEpisodeToAir: EpisodeRef | null;
}

export interface SeasonDetails {
  seasonNumber: number;
  episodes: EpisodeRef[];
}

/** The subset of TMDB that Reel uses; lets tests swap in a fake. */
export interface TmdbApi {
  search(query: string): Promise<SearchResult[]>;
  searchMovie(query: string, year?: number): Promise<SearchResult[]>;
  findByImdbId(imdbId: string): Promise<SearchResult | null>;
  details(kind: TitleKind, tmdbId: number): Promise<TitleDetails>;
  season(tvId: number, seasonNumber: number): Promise<SeasonDetails>;
  recommendations(kind: TitleKind, tmdbId: number): Promise<SearchResult[]>;
  trending(): Promise<SearchResult[]>;
}

const SearchItem = z.object({
  id: z.number(),
  media_type: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  overview: z.string().default(""),
  poster_path: z.string().nullish(),
  popularity: z.number().default(0),
  vote_average: z.number().default(0),
  vote_count: z.number().default(0),
});
type SearchItem = z.infer<typeof SearchItem>;

const SearchResponse = z.object({ results: z.array(SearchItem) });

const FindResponse = z.object({
  movie_results: z.array(SearchItem).default([]),
  tv_results: z.array(SearchItem).default([]),
});

const Named = z.object({ name: z.string() });

const EpisodeItem = z.object({
  season_number: z.number(),
  episode_number: z.number(),
  name: z.string().default(""),
  air_date: z.string().nullish(),
});

const DetailsResponse = SearchItem.extend({
  genres: z.array(Named).default([]),
  runtime: z.number().nullish(),
  episode_run_time: z.array(z.number()).default([]),
  original_language: z.string().default(""),
  status: z.string().nullish(),
  created_by: z.array(Named).default([]),
  seasons: z
    .array(
      z.object({
        season_number: z.number(),
        episode_count: z.number().default(0),
        air_date: z.string().nullish(),
      }),
    )
    .default([]),
  next_episode_to_air: EpisodeItem.nullish(),
  credits: z
    .object({
      cast: z.array(Named).default([]),
      crew: z.array(Named.extend({ job: z.string().default("") })).default([]),
    })
    .default({ cast: [], crew: [] }),
  keywords: z
    .object({ keywords: z.array(Named).optional(), results: z.array(Named).optional() })
    .default({}),
});

const SeasonResponse = z.object({
  season_number: z.number(),
  episodes: z.array(EpisodeItem).default([]),
});

export class TmdbError extends Error {
  readonly status: number;

  constructor(status: number, path: string) {
    super(`TMDB request failed: ${status} ${path}`);
    this.status = status;
  }
}

export interface TmdbClientOptions {
  accessToken: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
}

export class TmdbClient implements TmdbApi {
  readonly #accessToken: string;
  readonly #fetch: typeof fetch;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(options: TmdbClientOptions) {
    this.#accessToken = options.accessToken;
    this.#fetch = options.fetch ?? fetch;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Search movies and TV shows by title. People are filtered out. */
  async search(query: string): Promise<SearchResult[]> {
    const data = SearchResponse.parse(
      await this.#get("/search/multi", { query, include_adult: "false" }),
    );
    return data.results.flatMap((item) =>
      item.media_type === "movie" || item.media_type === "tv"
        ? [toSearchResult(item, item.media_type)]
        : [],
    );
  }

  async searchMovie(query: string, year?: number): Promise<SearchResult[]> {
    const params: Record<string, string> = { query, include_adult: "false" };
    if (year) params.primary_release_year = String(year);
    const data = SearchResponse.parse(await this.#get("/search/movie", params));
    return data.results.map((item) => toSearchResult(item, "movie"));
  }

  async findByImdbId(imdbId: string): Promise<SearchResult | null> {
    const data = FindResponse.parse(
      await this.#get(`/find/${encodeURIComponent(imdbId)}`, { external_source: "imdb_id" }),
    );
    const [movie] = data.movie_results;
    if (movie) return toSearchResult(movie, "movie");
    const [tv] = data.tv_results;
    return tv ? toSearchResult(tv, "tv") : null;
  }

  async details(kind: TitleKind, tmdbId: number): Promise<TitleDetails> {
    const d = DetailsResponse.parse(
      await this.#get(`/${kind}/${tmdbId}`, { append_to_response: "credits,keywords" }),
    );
    const directors =
      kind === "movie"
        ? d.credits.crew.filter((c) => c.job === "Director").map((c) => c.name)
        : d.created_by.map((c) => c.name);
    const next = d.next_episode_to_air;
    return {
      ...toSearchResult(d, kind),
      genres: d.genres.map((g) => g.name),
      runtime: (kind === "movie" ? d.runtime : d.episode_run_time[0]) || null,
      directors,
      cast: d.credits.cast.slice(0, 5).map((c) => c.name),
      keywords: (d.keywords.keywords ?? d.keywords.results ?? []).map((k) => k.name),
      language: d.original_language,
      status: kind === "tv" ? (d.status ?? null) : null,
      seasons: d.seasons
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          seasonNumber: s.season_number,
          episodeCount: s.episode_count,
          airDate: s.air_date ?? null,
        })),
      nextEpisodeToAir: next ? toEpisodeRef(next) : null,
    };
  }

  async season(tvId: number, seasonNumber: number): Promise<SeasonDetails> {
    const d = SeasonResponse.parse(await this.#get(`/tv/${tvId}/season/${seasonNumber}`));
    return { seasonNumber: d.season_number, episodes: d.episodes.map(toEpisodeRef) };
  }

  async recommendations(kind: TitleKind, tmdbId: number): Promise<SearchResult[]> {
    const data = SearchResponse.parse(await this.#get(`/${kind}/${tmdbId}/recommendations`));
    return data.results.map((item) => toSearchResult(item, kind));
  }

  async trending(): Promise<SearchResult[]> {
    const data = SearchResponse.parse(await this.#get("/trending/all/week"));
    return data.results.flatMap((item) =>
      item.media_type === "movie" || item.media_type === "tv"
        ? [toSearchResult(item, item.media_type)]
        : [],
    );
  }

  async #get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const url = `${BASE_URL}${path}${query ? `?${query}` : ""}`;
    const cached = this.#cache.get(url);
    if (cached && cached.expiresAt > this.#now()) return cached.value;

    const res = await this.#fetch(url, {
      headers: { Authorization: `Bearer ${this.#accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new TmdbError(res.status, path);

    const value = await res.json();
    this.#cache.set(url, { expiresAt: this.#now() + this.#ttlMs, value });
    return value;
  }
}

function toSearchResult(item: SearchItem, kind: TitleKind): SearchResult {
  const date = item.release_date || item.first_air_date;
  return {
    tmdbId: item.id,
    kind,
    title: item.title ?? item.name ?? "",
    year: date ? Number(date.slice(0, 4)) : null,
    overview: item.overview,
    posterPath: item.poster_path ?? null,
    popularity: item.popularity,
    voteAverage: item.vote_average,
    voteCount: item.vote_count,
  };
}

function toEpisodeRef(e: z.infer<typeof EpisodeItem>): EpisodeRef {
  return {
    seasonNumber: e.season_number,
    episodeNumber: e.episode_number,
    name: e.name,
    airDate: e.air_date ?? null,
  };
}
