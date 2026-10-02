import type { Title } from "../db/schema.ts";

export type FeatureValue = number | string | null;
export type FeatureRow = Record<string, FeatureValue>;

export interface RatedTitle {
  title: Title;
  rating: number;
}

/** Movie and TV genre names differ on TMDB; map TV's combined genres onto movie ones. */
const GENRE_ALIASES: Record<string, string[]> = {
  "Sci-Fi & Fantasy": ["Science Fiction", "Fantasy"],
  "Action & Adventure": ["Action", "Adventure"],
  "War & Politics": ["War"],
  Kids: ["Family"],
  Soap: ["Drama"],
  Reality: ["Documentary"],
  News: ["Documentary"],
  Talk: ["Comedy"],
};

export const GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Music",
  "Mystery",
  "Romance",
  "Science Fiction",
  "Thriller",
  "War",
  "Western",
] as const;

export function canonicalGenres(genres: string[]): Set<string> {
  return new Set(genres.flatMap((g) => GENRE_ALIASES[g] ?? [g]));
}

const genreColumn = (g: string) => `genre_${g.toLowerCase().replace(/\W+/g, "_")}`;

/**
 * Per-user taste signals: how the user rated other titles sharing a director, cast member,
 * keyword or genre, as deviations from their average rating.
 */
export class TasteProfile {
  readonly mean: number;
  readonly #rated: RatedTitle[];

  constructor(rated: RatedTitle[]) {
    this.#rated = rated;
    this.mean = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 3;
  }

  /**
   * Mean deviation over rated titles that share at least one value with `values`,
   * never counting the title itself (leave-one-out, so a training row can't see its own label).
   */
  affinity(
    title: Title,
    pick: (t: Title) => Iterable<string>,
    values: Iterable<string> = pick(title),
  ): { score: number; count: number } {
    const wanted = new Set(values);
    if (wanted.size === 0) return { score: 0, count: 0 };
    let sum = 0;
    let count = 0;
    for (const r of this.#rated) {
      if (r.title.id === title.id) continue;
      for (const v of pick(r.title)) {
        if (wanted.has(v)) {
          sum += r.rating - this.mean;
          count++;
          break;
        }
      }
    }
    // Shrink towards 0 when there is little evidence.
    return { score: count ? sum / (count + 2) : 0, count };
  }
}

export function featureRow(title: Title, profile: TasteProfile): FeatureRow {
  const genres = canonicalGenres(title.genres);
  const director = profile.affinity(title, (t) => t.directors);
  const cast = profile.affinity(title, (t) => t.cast);
  const keyword = profile.affinity(title, (t) => t.keywords);
  const genre = profile.affinity(title, (t) => canonicalGenres(t.genres));

  const row: FeatureRow = {
    is_tv: title.kind === "tv" ? 1 : 0,
    year: title.year,
    runtime: title.runtime,
    vote_average: title.voteCount > 0 ? title.voteAverage : null,
    log_vote_count: Math.log10(title.voteCount + 1),
    log_popularity: Math.log10(title.popularity + 1),
    language: title.language || null,
    director_affinity: director.score,
    director_seen: director.count,
    cast_affinity: cast.score,
    cast_seen: cast.count,
    keyword_affinity: keyword.score,
    genre_affinity: genre.score,
  };
  for (const g of GENRES) row[genreColumn(g)] = genres.has(g) ? 1 : 0;
  return row;
}

export const FEATURE_COLUMNS = Object.keys(
  featureRow(
    {
      id: 0,
      tmdbId: 0,
      kind: "movie",
      title: "",
      year: null,
      overview: "",
      posterPath: null,
      genres: [],
      runtime: null,
      directors: [],
      cast: [],
      keywords: [],
      language: "",
      voteAverage: 0,
      voteCount: 0,
      popularity: 0,
      status: null,
      seasons: [],
      nextEpisodeToAir: null,
      fetchedAt: new Date(0),
    },
    new TasteProfile([]),
  ),
);
