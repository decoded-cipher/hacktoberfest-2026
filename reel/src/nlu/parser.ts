import type { LlmClient } from "../llm/client.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { OTHER, ParsedMessage } from "./schema.ts";

export type ParseMessage = (text: string) => Promise<ParsedMessage>;

/** Build a parser backed by an LLM. Falls back to `other` if the model fails twice. */
export function createParser(llm: LlmClient): ParseMessage {
  return async (text) => {
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: text },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return normalizeParsed(await llm.completeJson(messages, ParsedMessage, "parsed_message"));
      } catch (err) {
        console.warn(`Parse attempt ${attempt + 1} failed for ${JSON.stringify(text)}:`, err);
      }
    }
    return OTHER;
  };
}

/** Fix values the model sometimes gets slightly wrong. */
export function normalizeParsed(p: ParsedMessage): ParsedMessage {
  const title = p.title?.trim() || null;
  const positive = (n: number | null) => (n != null && n > 0 ? n : null);
  let rating = p.rating;
  if (rating != null && rating > 5 && rating <= 10) rating /= 2;
  if (rating != null && (rating < 0.5 || rating > 5)) rating = null;
  return {
    ...p,
    title,
    season: positive(p.season),
    episode: positive(p.episode),
    year: p.year != null && p.year >= 1870 && p.year <= 2100 ? p.year : null,
    kind: p.kind ?? (p.season != null || p.episode != null ? "tv" : null),
    rating,
    note: p.note?.trim() || null,
  };
}
