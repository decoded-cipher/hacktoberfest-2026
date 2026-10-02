import { z } from "zod";

export const INTENTS = [
  "log_watch",
  "rate",
  "add_watchlist",
  "progress",
  "suggest",
  "set_preference",
  "other",
] as const;

export type Intent = (typeof INTENTS)[number];

/**
 * Flat on purpose: small models fill one object with nullable fields far more reliably
 * than a discriminated union.
 */
export const ParsedMessage = z.object({
  intent: z.enum(INTENTS),
  title: z.string().nullable().describe("Full official title, abbreviations expanded"),
  year: z.number().int().nullable(),
  kind: z.enum(["movie", "tv"]).nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable().describe("Last episode watched if a range was given"),
  finished_series: z.boolean().describe("True only if they finished the whole show"),
  rating: z.number().nullable().describe("Explicit rating converted to a 0.5–5 star scale"),
  sentiment: z.enum(["loved", "liked", "mixed", "disliked"]).nullable(),
  note: z.string().nullable().describe("Their own short comment, if any"),
});

export type ParsedMessage = z.infer<typeof ParsedMessage>;

export const OTHER: ParsedMessage = {
  intent: "other",
  title: null,
  year: null,
  kind: null,
  season: null,
  episode: null,
  finished_series: false,
  rating: null,
  sentiment: null,
  note: null,
};
