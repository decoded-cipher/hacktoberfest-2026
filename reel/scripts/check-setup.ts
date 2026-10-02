/** Checks that TMDB and the LLM are reachable: `pnpm check:setup [title]`. */
import { Env, loadConfig } from "../src/config.ts";
import { LlmClient } from "../src/llm/client.ts";
import { TmdbClient } from "../src/tmdb/client.ts";

const config = loadConfig(
  Env.pick({ TMDB_ACCESS_TOKEN: true, LLM_BASE_URL: true, LLM_MODEL: true, LLM_API_KEY: true }),
);
const query = process.argv[2] ?? "Severance";

const tmdb = new TmdbClient({ accessToken: config.TMDB_ACCESS_TOKEN });
const [top] = await tmdb.search(query);
if (!top) throw new Error(`TMDB returned no results for "${query}"`);
console.log(`TMDB ✓  ${top.title} (${top.year ?? "?"}) [${top.kind} #${top.tmdbId}]`);

const llm = new LlmClient({
  baseURL: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  model: config.LLM_MODEL,
});
const reply = await llm.complete([
  { role: "user", content: `In one sentence, what is "${top.title}" about? ${top.overview}` },
]);
console.log(`LLM ✓  ${config.LLM_MODEL}: ${reply}`);
