import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { EpisodeRef, SeasonSummary, TitleKind } from "../tmdb/client.ts";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  firstName: text("first_name"),
  timezone: text().notNull().default("UTC"),
  createdAt: createdAt(),
});

/** Cached TMDB metadata; TMDB ids are only unique per kind. */
export const titles = pgTable(
  "titles",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    tmdbId: integer("tmdb_id").notNull(),
    kind: text().$type<TitleKind>().notNull(),
    title: text().notNull(),
    year: integer(),
    overview: text().notNull().default(""),
    posterPath: text("poster_path"),
    genres: text().array().notNull().default([]),
    runtime: integer(),
    directors: text().array().notNull().default([]),
    cast: text().array().notNull().default([]),
    keywords: text().array().notNull().default([]),
    language: text().notNull().default(""),
    voteAverage: real("vote_average").notNull().default(0),
    voteCount: integer("vote_count").notNull().default(0),
    popularity: real().notNull().default(0),
    status: text(),
    seasons: jsonb().$type<SeasonSummary[]>().notNull().default([]),
    nextEpisodeToAir: jsonb("next_episode_to_air").$type<EpisodeRef | null>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tmdbId, t.kind)],
);

/** One rating per user and title, on a 0.5–5 star scale. */
export const ratings = pgTable(
  "ratings",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id),
    rating: real().notNull(),
    ratedAt: timestamp("rated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.titleId] })],
);

export type WatchSource = "chat" | "button" | "import" | "voice";

/** Every time something was watched: a movie, or a show up to a given episode. */
export const watchEvents = pgTable(
  "watch_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id),
    season: integer(),
    episode: integer(),
    note: text(),
    source: text().$type<WatchSource>().notNull(),
    watchedAt: timestamp("watched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.watchedAt)],
);

export type ShowStatus = "watching" | "paused" | "finished" | "dropped";

export const showProgress = pgTable(
  "show_progress",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id),
    season: integer().notNull(),
    episode: integer().notNull(),
    status: text().$type<ShowStatus>().notNull().default("watching"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.titleId] })],
);

export const watchlist = pgTable(
  "watchlist",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id),
    source: text().$type<WatchSource>().notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.titleId] })],
);

export type User = typeof users.$inferSelect;
export type Title = typeof titles.$inferSelect;
export type WatchEvent = typeof watchEvents.$inferSelect;
export type ShowProgress = typeof showProgress.$inferSelect;
