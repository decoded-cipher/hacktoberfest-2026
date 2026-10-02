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

const SearchItem = z.object({
  id: z.number(),
  media_type: z.string(),
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

const SearchResponse = z.object({ results: z.array(SearchItem) });

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

export class TmdbClient {
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
    return data.results.flatMap((item) => {
      if (item.media_type !== "movie" && item.media_type !== "tv") return [];
      const date = item.release_date || item.first_air_date;
      return [
        {
          tmdbId: item.id,
          kind: item.media_type,
          title: item.title ?? item.name ?? "",
          year: date ? Number(date.slice(0, 4)) : null,
          overview: item.overview,
          posterPath: item.poster_path ?? null,
          popularity: item.popularity,
          voteAverage: item.vote_average,
          voteCount: item.vote_count,
        },
      ];
    });
  }

  async #get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
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
