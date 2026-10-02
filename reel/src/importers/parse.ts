import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import type { ImportItem } from "./types.ts";

type Row = Record<string, string>;

export class ImportFormatError extends Error {}

/** Read an uploaded Letterboxd ZIP/CSV or IMDb CSV into import items. */
export function readUpload(fileName: string, bytes: Uint8Array): ImportItem[] {
  if (fileName.toLowerCase().endsWith(".zip")) {
    const files: Record<string, string> = {};
    for (const [path, data] of Object.entries(unzipSync(bytes))) {
      // Only top-level CSVs; Letterboxd nests lists and likes in folders.
      if (!path.includes("/") && path.endsWith(".csv"))
        files[path] = new TextDecoder().decode(data);
    }
    if (!files["ratings.csv"] && !files["watched.csv"] && !files["watchlist.csv"]) {
      throw new ImportFormatError("That ZIP doesn't look like a Letterboxd export.");
    }
    return parseLetterboxd(files);
  }
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseCsvUpload(fileName, new TextDecoder().decode(bytes));
  }
  throw new ImportFormatError("Send a Letterboxd export (.zip) or an IMDb ratings/watchlist .csv.");
}

function parseCsvUpload(fileName: string, text: string): ImportItem[] {
  const rows = readCsv(text);
  const headers = new Set(Object.keys(rows[0] ?? {}));
  if (headers.has("Const")) return parseImdb(rows);
  if (headers.has("Letterboxd URI")) {
    const file = headers.has("Watched Date")
      ? "diary.csv"
      : headers.has("Rating")
        ? "ratings.csv"
        : fileName.toLowerCase().includes("watchlist")
          ? "watchlist.csv"
          : "watched.csv";
    return parseLetterboxd({ [file]: text });
  }
  throw new ImportFormatError("I don't recognise that CSV. Send a Letterboxd or IMDb export.");
}

export function readCsv(text: string): Row[] {
  return parse(text.replace(/^﻿/, ""), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Row[];
}

/**
 * Letterboxd export files (all films): ratings.csv, watched.csv, diary.csv, watchlist.csv.
 * Merged into one item per film.
 */
export function parseLetterboxd(files: Record<string, string>): ImportItem[] {
  const items = new Map<string, ImportItem>();
  const item = (row: Row): ImportItem | null => {
    const name = row.Name?.trim();
    if (!name) return null;
    const year = toYear(row.Year);
    const key = `${name.toLowerCase()}|${year ?? ""}`;
    let found = items.get(key);
    if (!found) {
      found = {
        name,
        year,
        kind: "movie",
        imdbId: null,
        rating: null,
        ratedAt: null,
        watchedAt: null,
        watchlist: false,
      };
      items.set(key, found);
    }
    return found;
  };

  for (const row of rowsOf(files["watchlist.csv"])) {
    const it = item(row);
    if (it) it.watchlist = true;
  }
  for (const row of rowsOf(files["watched.csv"])) {
    const it = item(row);
    if (it) it.watchedAt = latest(it.watchedAt, toDate(row.Date));
  }
  for (const row of rowsOf(files["diary.csv"])) {
    const it = item(row);
    if (it) it.watchedAt = latest(it.watchedAt, toDate(row["Watched Date"] || row.Date));
  }
  for (const row of rowsOf(files["ratings.csv"])) {
    const it = item(row);
    const rating = Number(row.Rating);
    if (it && rating > 0) {
      it.rating = rating;
      it.ratedAt = toDate(row.Date);
      it.watchedAt ??= it.ratedAt;
    }
  }
  for (const it of items.values()) if (it.watchedAt) it.watchlist = false;
  return [...items.values()];
}

const IMDB_KINDS: Record<string, "movie" | "tv"> = {
  Movie: "movie",
  "TV Movie": "movie",
  Video: "movie",
  "TV Series": "tv",
  "TV Mini Series": "tv",
};

/** IMDb ratings export (has "Your Rating") or watchlist export (no rating). Episodes are skipped. */
export function parseImdb(rows: Row[]): ImportItem[] {
  return rows.flatMap((row) => {
    const kind = IMDB_KINDS[row["Title Type"] ?? ""];
    const imdbId = row.Const?.trim();
    if (!kind || !imdbId) return [];
    const yourRating = Number(row["Your Rating"]);
    const rated = yourRating > 0;
    const ratedAt = rated ? toDate(row["Date Rated"]) : null;
    return [
      {
        name: row.Title ?? imdbId,
        year: toYear(row.Year),
        kind,
        imdbId,
        rating: rated ? yourRating / 2 : null,
        ratedAt,
        watchedAt: rated && kind === "movie" ? ratedAt : null,
        watchlist: !rated,
      },
    ];
  });
}

const rowsOf = (text: string | undefined) => (text ? readCsv(text) : []);

function toYear(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 1800 ? n : null;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
