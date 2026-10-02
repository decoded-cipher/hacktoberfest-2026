import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

/** Any Postgres-backed Drizzle database: PGlite locally, node-postgres in production. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Open the database and apply pending migrations.
 * - `postgres://…` / `postgresql://…`: a real Postgres server (e.g. Render Postgres)
 * - `memory://`: a throwaway in-memory PGlite database
 * - anything else: a PGlite data directory on disk
 */
export async function openDb(target: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (/^postgres(ql)?:\/\//.test(target)) {
    const pool = new pg.Pool({ connectionString: target, max: 5 });
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db, close: () => pool.end() };
  }

  if (!target.startsWith("memory://")) await mkdir(target, { recursive: true });
  const client = new PGlite(target);
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => client.close() };
}
