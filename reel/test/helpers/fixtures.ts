import { strToU8, zipSync } from "fflate";
import type { TitleDetails } from "../../src/tmdb/client.ts";

export function details(
  over: Partial<TitleDetails> & Pick<TitleDetails, "tmdbId" | "title">,
): TitleDetails {
  return {
    kind: "movie",
    year: 2020,
    overview: "",
    posterPath: null,
    popularity: 50,
    voteAverage: 7.5,
    voteCount: 1000,
    genres: ["Drama"],
    runtime: 120,
    directors: [],
    cast: [],
    keywords: [],
    language: "en",
    status: null,
    seasons: [],
    nextEpisodeToAir: null,
    ...over,
  };
}

export const SEVERANCE = details({
  tmdbId: 95396,
  title: "Severance",
  kind: "tv",
  year: 2022,
  popularity: 120,
  genres: ["Drama", "Mystery", "Sci-Fi & Fantasy"],
  runtime: 50,
  directors: ["Dan Erickson"],
  status: "Returning Series",
  seasons: [
    { seasonNumber: 1, episodeCount: 9, airDate: "2022-02-17" },
    { seasonNumber: 2, episodeCount: 10, airDate: "2025-01-17" },
  ],
});

export const DUNE_2 = details({
  tmdbId: 693134,
  title: "Dune: Part Two",
  year: 2024,
  popularity: 300,
  genres: ["Science Fiction", "Adventure"],
  runtime: 167,
  directors: ["Denis Villeneuve"],
});

export const ARRIVAL = details({
  tmdbId: 329865,
  title: "Arrival",
  year: 2016,
  genres: ["Drama", "Science Fiction"],
  runtime: 116,
  directors: ["Denis Villeneuve"],
});

/** A small Letterboxd export: 2 rated films, 1 unknown film, 1 watchlist entry. */
export const letterboxdZip = () =>
  zipSync({
    "ratings.csv": strToU8(
      "Date,Name,Year,Letterboxd URI,Rating\n" +
        "2024-03-10,Dune: Part Two,2024,https://boxd.it/a,4.5\n" +
        '2023-01-05,"Arrival",2016,https://boxd.it/b,5\n',
    ),
    "watched.csv": strToU8(
      "Date,Name,Year,Letterboxd URI\n" +
        "2024-03-10,Dune: Part Two,2024,https://boxd.it/a\n" +
        "2023-01-05,Arrival,2016,https://boxd.it/b\n" +
        "2022-06-01,Some Obscure Film,1971,https://boxd.it/c\n",
    ),
    "diary.csv": strToU8(
      "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n" +
        "2024-03-11,Dune: Part Two,2024,https://boxd.it/a,4.5,,,2024-03-09\n",
    ),
    "watchlist.csv": strToU8(
      "Date,Name,Year,Letterboxd URI\n2024-05-01,Past Lives,2023,https://boxd.it/d\n",
    ),
    "lists/favourites.csv": strToU8("ignored"),
  });
