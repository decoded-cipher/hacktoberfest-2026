/**
 * A synthetic viewer with a planted taste, for testing that rating models can learn one.
 * Loves two directors and sci-fi, dislikes horror, mildly prefers recent and well-reviewed titles.
 */
import type { Title } from "../src/db/schema.ts";
import type { RatedTitle } from "../src/recommend/features.ts";

const DIRECTORS = ["Ava Lin", "Ben Okoro", "Cara Diaz", "Dev Rao", "Eli Novak", "Fay Moreau"];
const LOVED = new Set(["Ava Lin", "Ben Okoro"]);
const ACTORS = ["Actor A", "Actor B", "Actor C", "Actor D", "Actor E", "Actor F", "Actor G"];
const GENRE_POOL = [
  "Drama",
  "Comedy",
  "Science Fiction",
  "Horror",
  "Thriller",
  "Romance",
  "Action",
];
const KEYWORDS = ["space", "heist", "family", "ghost", "time travel", "romance", "revenge"];

/** Deterministic PRNG so tests are stable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTitle(id: number, over: Partial<Title> = {}): Title {
  return {
    id,
    tmdbId: id,
    kind: "movie",
    title: `Title ${id}`,
    year: 2010,
    overview: "",
    posterPath: null,
    genres: [],
    runtime: 110,
    directors: [],
    cast: [],
    keywords: [],
    language: "en",
    voteAverage: 7,
    voteCount: 1000,
    popularity: 20,
    status: null,
    seasons: [],
    nextEpisodeToAir: null,
    fetchedAt: new Date(),
    ...over,
  };
}

export function syntheticRatings(n: number, seed = 1): RatedTitle[] {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;
  const out: RatedTitle[] = [];
  for (let i = 1; i <= n; i++) {
    const genres = [...new Set([pick(GENRE_POOL), pick(GENRE_POOL)])];
    const director = pick(DIRECTORS);
    const voteAverage = 5 + rand() * 3.5;
    const year = 1980 + Math.floor(rand() * 45);
    const title = makeTitle(i, {
      title: `Synthetic ${i}`,
      genres,
      directors: [director],
      cast: [pick(ACTORS), pick(ACTORS)],
      keywords: [pick(KEYWORDS)],
      year,
      voteAverage,
      voteCount: Math.floor(100 + rand() * 20000),
      popularity: 5 + rand() * 200,
      runtime: 85 + Math.floor(rand() * 80),
    });
    let r = 2.6;
    if (LOVED.has(director)) r += 1.3;
    if (genres.includes("Science Fiction")) r += 0.7;
    if (genres.includes("Horror")) r -= 1.1;
    r += 0.25 * (voteAverage - 6.75);
    r += 0.008 * (year - 2000);
    r += (rand() - 0.5) * 0.8;
    out.push({ title, rating: Math.min(5, Math.max(0.5, Math.round(r * 2) / 2)) });
  }
  return out;
}
