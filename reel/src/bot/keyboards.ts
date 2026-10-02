import { InlineKeyboard } from "grammy";
import type { SearchResult } from "../tmdb/client.ts";
import { candidateLabel } from "./format.ts";

export const ratingKeyboard = (titleId: number) =>
  new InlineKeyboard().add(
    ...[1, 2, 3, 4, 5].map((n) => InlineKeyboard.text(`${n}★`, `rate:${titleId}:${n}`)),
  );

export function candidatesKeyboard(pendingId: string, candidates: SearchResult[]) {
  const kb = new InlineKeyboard();
  candidates.forEach((c, i) => {
    kb.text(candidateLabel(c), `pick:${pendingId}:${i}`).row();
  });
  return kb.text("None of these", `pick:${pendingId}:none`);
}
