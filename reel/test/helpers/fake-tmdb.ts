import type {
  SearchResult,
  SeasonDetails,
  TitleDetails,
  TitleKind,
  TmdbApi,
} from "../../src/tmdb/client.ts";
import { normalize } from "../../src/tmdb/match.ts";

/** In-memory TMDB: search matches on normalized substrings, details come from the given fixtures. */
export class FakeTmdb implements TmdbApi {
  readonly titles: TitleDetails[];
  readonly seasons = new Map<string, SeasonDetails>();
  recommendationsFor = new Map<string, SearchResult[]>();
  trendingTitles: SearchResult[] = [];
  calls: string[] = [];

  constructor(titles: TitleDetails[]) {
    this.titles = titles;
  }

  async search(query: string): Promise<SearchResult[]> {
    this.calls.push(`search:${query}`);
    const q = normalize(query);
    return this.titles.filter((t) => normalize(t.title).includes(q)).map(toResult);
  }

  async searchMovie(query: string, year?: number): Promise<SearchResult[]> {
    return (await this.search(query)).filter(
      (t) => t.kind === "movie" && (!year || t.year === year),
    );
  }

  async findByImdbId(): Promise<SearchResult | null> {
    return null;
  }

  async details(kind: TitleKind, tmdbId: number): Promise<TitleDetails> {
    this.calls.push(`details:${kind}:${tmdbId}`);
    const found = this.titles.find((t) => t.kind === kind && t.tmdbId === tmdbId);
    if (!found) throw new Error(`No fixture for ${kind} ${tmdbId}`);
    return found;
  }

  async season(tvId: number, seasonNumber: number): Promise<SeasonDetails> {
    const found = this.seasons.get(`${tvId}:${seasonNumber}`);
    if (found) return found;
    const show = this.titles.find((t) => t.kind === "tv" && t.tmdbId === tvId);
    const count = show?.seasons.find((s) => s.seasonNumber === seasonNumber)?.episodeCount ?? 0;
    return {
      seasonNumber,
      episodes: Array.from({ length: count }, (_, i) => ({
        seasonNumber,
        episodeNumber: i + 1,
        name: `Episode ${i + 1}`,
        airDate: "2020-01-01",
      })),
    };
  }

  async recommendations(kind: TitleKind, tmdbId: number): Promise<SearchResult[]> {
    return this.recommendationsFor.get(`${kind}:${tmdbId}`) ?? [];
  }

  async trending(): Promise<SearchResult[]> {
    return this.trendingTitles;
  }
}

export function toResult(d: TitleDetails): SearchResult {
  const { tmdbId, kind, title, year, overview, posterPath, popularity, voteAverage, voteCount } = d;
  return { tmdbId, kind, title, year, overview, posterPath, popularity, voteAverage, voteCount };
}
