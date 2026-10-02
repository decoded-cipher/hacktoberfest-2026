import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.ts";

export type Db = PgliteDatabase<typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Open the database and apply pending migrations. Pass "memory://" for a throwaway in-memory database. */
export async function openDb(dataDir: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!dataDir.startsWith("memory://")) await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => client.close() };
}
