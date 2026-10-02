import type { Preference, Title } from "../db/schema.ts";
import { canonicalGenres } from "./features.ts";
import type { SuggestFilters } from "./recommender.ts";

const LIKED_GENRE_BOOST = 0.3;
const LIKED_PERSON_BOOST = 0.4;
const DISLIKED_PERSON_PENALTY = 0.8;

/**
 * Disliked genres become hard filters, unless this request explicitly asks for that genre
 * ("I hate horror" shouldn't block "suggest a horror movie").
 */
export function withPreferences(filters: SuggestFilters, prefs: Preference[]): SuggestFilters {
  const asked = new Set((filters.genres ?? []).map((g) => g.toLowerCase()));
  const disliked = prefs
    .filter((p) => p.polarity === "dislike")
    .flatMap((p) => p.genres)
    .filter((g) => !asked.has(g.toLowerCase()));
  return { ...filters, avoidGenres: [...new Set([...(filters.avoidGenres ?? []), ...disliked])] };
}

/** Nudge a predicted rating up or down for stated likes and dislikes. */
export function preferenceAdjustment(title: Title, prefs: Preference[]): number {
  const genres = new Set([...canonicalGenres(title.genres)].map((g) => g.toLowerCase()));
  const people = [...title.directors, ...title.cast].map((p) => p.toLowerCase());
  let delta = 0;
  for (const p of prefs) {
    const fact = p.fact.toLowerCase();
    const mentionsPerson = people.some((name) => fact.includes(name));
    if (p.polarity === "like") {
      if (p.genres.some((g) => genres.has(g.toLowerCase()))) delta += LIKED_GENRE_BOOST;
      if (mentionsPerson) delta += LIKED_PERSON_BOOST;
    } else if (mentionsPerson) {
      delta -= DISLIKED_PERSON_PENALTY;
    }
  }
  return delta;
}
