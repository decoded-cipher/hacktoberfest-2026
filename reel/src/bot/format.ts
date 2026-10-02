import type { Title } from "../db/schema.ts";
import type { EpisodeRef, SearchResult } from "../tmdb/client.ts";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const pad = (n: number) => String(n).padStart(2, "0");

export const episodeCode = (season: number, episode: number) => `S${pad(season)}E${pad(episode)}`;

/** "<b>Dune</b> (2021)" */
export const titleHtml = (t: Pick<Title, "title" | "year">) =>
  `<b>${escapeHtml(t.title)}</b>${t.year ? ` (${t.year})` : ""}`;

export const candidateLabel = (r: SearchResult) =>
  `${r.title}${r.year ? ` (${r.year})` : ""} · ${r.kind === "tv" ? "TV" : "film"}`;

export function stars(rating: number): string {
  const full = Math.floor(rating);
  return `${"★".repeat(full)}${rating % 1 ? "½" : ""} ${rating}`;
}

/** "S02E06 “Chikhai Bardo” — airs Fri, 7 Feb" */
export function nextEpisodeLine(next: EpisodeRef, today: Date): string {
  const name = next.name ? ` “${escapeHtml(next.name)}”` : "";
  const code = episodeCode(next.seasonNumber, next.episodeNumber);
  if (next.airDate && new Date(next.airDate) > today) {
    return `${code}${name} — airs ${formatDate(next.airDate)}`;
  }
  return `${code}${name}`;
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
