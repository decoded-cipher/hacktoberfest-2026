import type { TitleKind } from "../tmdb/client.ts";

/** One title from an export, normalised across Letterboxd and IMDb. */
export interface ImportItem {
  name: string;
  year: number | null;
  kind: TitleKind | null;
  imdbId: string | null;
  /** 0.5–5 stars. */
  rating: number | null;
  ratedAt: Date | null;
  watchedAt: Date | null;
  watchlist: boolean;
}

export interface ImportSummary {
  total: number;
  matched: number;
  rated: number;
  watched: number;
  watchlisted: number;
  unmatched: string[];
}
