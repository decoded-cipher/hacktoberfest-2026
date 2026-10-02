import type { SearchResult, TitleKind } from "./client.ts";

export interface MatchHints {
  query: string;
  year?: number | null;
  kind?: TitleKind | null;
}

export type MatchResult =
  | { status: "match"; title: SearchResult }
  | { status: "ambiguous"; candidates: SearchResult[] }
  | { status: "none" };

const AUTO_MATCH_SCORE = 0.6;
const AUTO_MATCH_MARGIN = 0.15;
const MAX_CANDIDATES = 3;

export const libraryKey = (kind: TitleKind, tmdbId: number) => `${kind}:${tmdbId}`;

/**
 * Pick the TMDB result the user most likely meant. Auto-matches only when the best
 * candidate is both strong and clearly ahead; otherwise returns a short list to ask about.
 * `library` holds keys (see `libraryKey`) of titles already in the user's history.
 */
export function matchTitle(
  hints: MatchHints,
  results: SearchResult[],
  library: ReadonlySet<string> = new Set(),
): MatchResult {
  if (results.length === 0) return { status: "none" };

  const ranked = results
    .map((r) => ({ r, score: scoreResult(hints, r, library) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (!best) return { status: "none" };

  if (
    best.score >= AUTO_MATCH_SCORE &&
    (!second || best.score - second.score >= AUTO_MATCH_MARGIN)
  ) {
    return { status: "match", title: best.r };
  }
  return { status: "ambiguous", candidates: ranked.slice(0, MAX_CANDIDATES).map((x) => x.r) };
}

export function scoreResult(
  hints: MatchHints,
  r: SearchResult,
  library: ReadonlySet<string>,
): number {
  const query = normalize(hints.query);
  const title = normalize(r.title);

  let score = 0.6 * similarity(query, title);
  if (query.length >= 3 && title.startsWith(query) && query !== title) score += 0.1;

  if (hints.kind) score += hints.kind === r.kind ? 0.1 : -0.2;

  if (hints.year && r.year) {
    const diff = Math.abs(hints.year - r.year);
    score += diff === 0 ? 0.15 : diff === 1 ? 0.05 : -0.1;
  }

  if (library.has(libraryKey(r.kind, r.tmdbId))) score += 0.2;

  score += 0.1 * Math.min(Math.log10(r.popularity + 1) / 3, 1);
  return score;
}

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
}

/** Sørensen–Dice similarity over character bigrams, in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      counts.set(bg, (counts.get(bg) ?? 0) + 1);
    }
    return counts;
  };
  const ab = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  for (const [bg, n] of ab) overlap += Math.min(n, bb.get(bg) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}
