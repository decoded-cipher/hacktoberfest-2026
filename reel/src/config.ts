import { z } from "zod";

export const Env = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TMDB_ACCESS_TOKEN: z.string().min(1),
  LLM_BASE_URL: z.url().default("http://localhost:11434/v1"),
  LLM_MODEL: z.string().default("qwen3:8b"),
  LLM_API_KEY: z.string().default("ollama"),
  /** "compact" only for a model fine-tuned on Reel's parsing task (see training/). */
  LLM_PROMPT: z.enum(["full", "compact"]).default("full"),
  /** Local PGlite data directory, used when DATABASE_URL is not set. */
  DATABASE_PATH: z.string().default("data/pglite"),
  /** Postgres connection string (set automatically on Render). */
  DATABASE_URL: z.string().optional(),
  PRIORLABS_API_KEY: z.string().optional(),
  TABPFN_MODEL_PATH: z.string().default("v3.5_default"),
  WHISPER_MODEL_PATH: z.string().optional(),
  WHISPER_CLI: z.string().default("whisper-cli"),
  WHISPER_LANGUAGE: z.string().default("auto"),
});

export type Config = z.infer<typeof Env>;

/** Parse environment variables with the given schema, exiting with a readable error on failure. */
export function loadConfig(): Config;
export function loadConfig<S extends z.ZodType>(schema: S, env?: NodeJS.ProcessEnv): z.infer<S>;
export function loadConfig(schema: z.ZodType = Env, env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    console.error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}
