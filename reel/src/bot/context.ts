import type { Context } from "grammy";
import type { Db } from "../db/client.ts";
import type { User } from "../db/schema.ts";
import type { ParseMessage } from "../nlu/parser.ts";
import type { ParsedMessage } from "../nlu/schema.ts";
import type { Tracker } from "../services/tracker.ts";
import type { SearchResult, TmdbApi } from "../tmdb/client.ts";
import type { PendingStore } from "./pending.ts";

export interface BotDeps {
  db: Db;
  tmdb: TmdbApi;
  parse: ParseMessage;
  /** Download a Telegram file by its file_path. Defaults to the Bot API file endpoint. */
  download?: (filePath: string) => Promise<Uint8Array>;
  now?: () => Date;
}

export interface PendingPick {
  userId: number;
  parsed: ParsedMessage;
  candidates: SearchResult[];
}

export interface Services {
  db: Db;
  tmdb: TmdbApi;
  parse: ParseMessage;
  tracker: Tracker;
  picks: PendingStore<PendingPick>;
  download: (filePath: string) => Promise<Uint8Array>;
  now: () => Date;
}

/** Every handler gets the registered user and shared services. */
export type BotContext = Context & { user: User; services: Services };
