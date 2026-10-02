import type { Title } from "../db/schema.ts";
import { canonicalGenres, type RatedTitle } from "./features.ts";

const LIKED = 4;

/**
 * One short, human reason for a suggestion, grounded in titles the user rated highly:
 * a shared director beats shared cast beats overlapping keywords/genres.
 */
export function explain(candidate: Title, rated: RatedTitle[], source: string | null): string {
  const liked = rated.filter((r) => r.rating >= LIKED);
  const stars = (r: RatedTitle) => `★${r.rating}`;

  for (const r of liked) {
    const shared = candidate.directors.find((d) => r.title.directors.includes(d));
    if (shared) {
      const verb = candidate.kind === "tv" ? "created by" : "directed by";
      return `${verb} ${shared}, like ${r.title.title} (you gave it ${stars(r)})`;
    }
  }
  for (const r of liked) {
    const shared = candidate.cast.find((c) => r.title.cast.includes(c));
    if (shared) return `stars ${shared}, like ${r.title.title} (${stars(r)})`;
  }

  const best = liked
    .map((r) => ({ r, score: overlap(candidate, r.title) }))
    .filter((x) => x.score > 0.25)
    .sort((a, b) => b.score - a.score)[0];
  if (best) return `similar to ${best.r.title.title}, which you gave ${stars(best.r)}`;

  if (source) return source;
  const genres = [...canonicalGenres(candidate.genres)].slice(0, 2).join(" & ").toLowerCase();
  return genres ? `a well-reviewed ${genres} pick` : "well reviewed on TMDB";
}

function overlap(a: Title, b: Title): number {
  const jaccard = (x: Set<string>, y: Set<string>) => {
    const union = new Set([...x, ...y]).size;
    return union ? [...x].filter((v) => y.has(v)).length / union : 0;
  };
  return (
    0.6 * jaccard(new Set(a.keywords), new Set(b.keywords)) +
    0.4 * jaccard(canonicalGenres(a.genres), canonicalGenres(b.genres))
  );
}
