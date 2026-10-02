/**
 * Scores the message parser against hand-labelled cases.
 *
 *   pnpm eval:parser                      # uses LLM_* from .env (default: local qwen3:8b)
 *   pnpm eval:parser --model qwen3:1.7b   # compare another model
 *
 * Only fields present in a case's `expect` are checked (title compared after normalising).
 * Results are written to evals/results/parser-<model>.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LlmClient } from "../src/llm/client.ts";
import { createParser } from "../src/nlu/parser.ts";
import type { ParsedMessage } from "../src/nlu/schema.ts";
import { normalize } from "../src/tmdb/match.ts";

interface Case {
  text: string;
  expect: Partial<ParsedMessage>;
}

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: process.env.LLM_MODEL ?? "qwen3:8b" },
    "base-url": {
      type: "string",
      default: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
    },
    "api-key": { type: "string", default: process.env.LLM_API_KEY ?? "ollama" },
    prompt: { type: "string", default: process.env.LLM_PROMPT ?? "full" },
    cases: {
      type: "string",
      default: fileURLToPath(new URL("data/parser-cases.jsonl", import.meta.url)),
    },
  },
});

const FIELDS = [
  "intent",
  "title",
  "kind",
  "season",
  "episode",
  "finished_series",
  "rating",
] as const;

const cases: Case[] = (await readFile(args.cases, "utf8"))
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const parse = createParser(
  new LlmClient({ baseURL: args["base-url"], apiKey: args["api-key"], model: args.model }),
  args.prompt === "compact" ? "compact" : "full",
);

// Warm up so model loading time doesn't count against the first case.
await parse("hi");

const fieldHits = Object.fromEntries(FIELDS.map((f) => [f, { hit: 0, total: 0 }]));
const latencies: number[] = [];
const failures: { text: string; field: string; expected: unknown; got: unknown }[] = [];
let exact = 0;

for (const c of cases) {
  const start = performance.now();
  const got = await parse(c.text);
  latencies.push(performance.now() - start);

  let allOk = true;
  for (const field of FIELDS) {
    if (!(field in c.expect)) continue;
    const expected = c.expect[field];
    const actual = got[field];
    const ok =
      field === "title"
        ? normalize(String(expected ?? "")) === normalize(String(actual ?? ""))
        : expected === actual;
    const stat = fieldHits[field];
    if (stat) {
      stat.total++;
      if (ok) stat.hit++;
    }
    if (!ok) {
      allOk = false;
      failures.push({ text: c.text, field, expected, got: actual });
    }
  }
  if (allOk) exact++;
}

latencies.sort((a, b) => a - b);
const pct = (p: number) => Math.round(latencies[Math.floor((latencies.length - 1) * p)] ?? 0);
const result = {
  model: args.model,
  prompt: args.prompt,
  cases: cases.length,
  exactMatch: exact / cases.length,
  fields: Object.fromEntries(
    Object.entries(fieldHits).map(([f, s]) => [f, s.total ? s.hit / s.total : null]),
  ),
  latencyMs: { p50: pct(0.5), p95: pct(0.95) },
  failures,
};

const fmt = (x: number | null) => (x == null ? "  -  " : `${(x * 100).toFixed(1)}%`);
console.log(`\nModel: ${result.model}  (${result.cases} cases)\n`);
console.log(`exact match   ${fmt(result.exactMatch)}`);
for (const [f, v] of Object.entries(result.fields)) console.log(`${f.padEnd(14)}${fmt(v)}`);
console.log(`latency p50   ${result.latencyMs.p50} ms`);
console.log(`latency p95   ${result.latencyMs.p95} ms`);
if (failures.length) {
  console.log("\nMisses:");
  for (const f of failures) {
    console.log(
      `  ${JSON.stringify(f.text)}  ${f.field}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.got)}`,
    );
  }
}

const outDir = new URL("results/", import.meta.url);
await mkdir(outDir, { recursive: true });
const suffix = args.prompt === "compact" ? "-compact" : "";
const file = new URL(`parser-${args.model.replace(/[^\w.-]+/g, "_")}${suffix}.json`, outDir);
await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nSaved ${fileURLToPath(file)}`);
