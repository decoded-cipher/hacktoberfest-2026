/**
 * Compares rating models with k-fold cross-validation on one user's ratings.
 *
 *   pnpm eval:recommender --synthetic          # planted-taste synthetic viewer (no setup)
 *   pnpm eval:recommender --user <telegramId>  # a real user from the bot's database
 *
 * TabPFN is included when PRIORLABS_API_KEY is set. For each fold, taste features are
 * built from the training ratings only, so held-out ratings never leak into features.
 * Results are written to evals/results/recommender-<source>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { openDb } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import { ratedTitles } from "../src/db/suggestions.ts";
import { featureRow, type RatedTitle, TasteProfile } from "../src/recommend/features.ts";
import {
  KnnModel,
  type RatingModel,
  RidgeModel,
  TmdbScoreModel,
  UserMeanModel,
} from "../src/recommend/models.ts";
import { TabPfnModel } from "../src/recommend/tabpfn.ts";
import { rng, syntheticRatings } from "./synthetic.ts";

const { values: args } = parseArgs({
  options: {
    synthetic: { type: "boolean", default: false },
    user: { type: "string" },
    folds: { type: "string", default: "5" },
    size: { type: "string", default: "300" },
  },
});

const LIKED = 4;

async function loadRatings(): Promise<{ source: string; rated: RatedTitle[] }> {
  if (args.synthetic || !args.user) {
    return { source: "synthetic", rated: syntheticRatings(Number(args.size)) };
  }
  const { db, close } = await openDb(
    process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? "data/pglite",
  );
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, Number(args.user)));
  if (!user) throw new Error(`No user with Telegram id ${args.user}`);
  const rated = await ratedTitles(db, user.id);
  await close();
  return { source: `user-${args.user}`, rated };
}

const models: RatingModel[] = [
  new UserMeanModel(),
  new TmdbScoreModel(),
  new KnnModel(),
  new RidgeModel(),
];
if (process.env.PRIORLABS_API_KEY) {
  models.push(
    new TabPfnModel({
      apiKey: process.env.PRIORLABS_API_KEY,
      modelPath: process.env.TABPFN_MODEL_PATH,
    }),
  );
}

const { source, rated } = await loadRatings();
const k = Number(args.folds);
if (rated.length < k * 4) throw new Error(`Need at least ${k * 4} ratings, found ${rated.length}`);

// Shuffle deterministically, then split into k folds.
const rand = rng(42);
const shuffled = rated
  .map((r) => ({ r, key: rand() }))
  .sort((a, b) => a.key - b.key)
  .map((x) => x.r);
const folds = Array.from({ length: k }, (_, i) => shuffled.filter((_, j) => j % k === i));

interface Totals {
  truth: number[];
  pred: number[];
  precisionAt10: number[];
  ms: number;
}
const totals = new Map<string, Totals>(
  models.map((m) => [m.name, { truth: [], pred: [], precisionAt10: [], ms: 0 }]),
);

for (const [i, testFold] of folds.entries()) {
  const trainFold = folds.filter((_, j) => j !== i).flat();
  const profile = new TasteProfile(trainFold);
  const train = trainFold.map((r) => featureRow(r.title, profile));
  const y = trainFold.map((r) => r.rating);
  const test = testFold.map((r) => featureRow(r.title, profile));
  const truth = testFold.map((r) => r.rating);

  for (const model of models) {
    const t = totals.get(model.name);
    if (!t) continue;
    const start = performance.now();
    const pred = await model.fitPredict(train, y, test);
    t.ms += performance.now() - start;
    t.truth.push(...truth);
    t.pred.push(...pred);
    const top = pred
      .map((p, idx) => ({ p, liked: (truth[idx] ?? 0) >= LIKED }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 10);
    t.precisionAt10.push(top.filter((x) => x.liked).length / top.length);
  }
  process.stdout.write(`fold ${i + 1}/${k} done\n`);
}

const results = [...totals].map(([name, t]) => ({
  model: name,
  mae: mean(t.truth.map((v, i) => Math.abs(v - (t.pred[i] ?? 0)))),
  rmse: Math.sqrt(mean(t.truth.map((v, i) => (v - (t.pred[i] ?? 0)) ** 2))),
  spearman: spearman(t.truth, t.pred),
  precisionAt10: mean(t.precisionAt10),
  msPerFold: t.ms / k,
}));

const baseline = results.find((r) => r.model === "user mean")?.mae ?? 1;
console.log(`\n${source}: ${rated.length} ratings, ${k}-fold CV\n`);
console.log("model                  MAE    vs mean   RMSE   Spearman  P@10   ms/fold");
for (const r of results) {
  const gain = `${(((baseline - r.mae) / baseline) * 100).toFixed(0)}%`;
  console.log(
    `${r.model.padEnd(22)} ${r.mae.toFixed(3)}  ${gain.padStart(6)}   ${r.rmse.toFixed(3)}  ${r.spearman.toFixed(3).padStart(7)}   ${r.precisionAt10.toFixed(2)}   ${Math.round(r.msPerFold)}`,
  );
}

const outDir = new URL("results/", import.meta.url);
await mkdir(outDir, { recursive: true });
const file = new URL(`recommender-${source}.json`, outDir);
await writeFile(
  file,
  `${JSON.stringify({ source, ratings: rated.length, folds: k, results }, null, 2)}\n`,
);
console.log(`\nSaved ${fileURLToPath(file)}`);

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.v === order[i]?.v) j++;
    for (let m = i; m <= j; m++) r[order[m]?.i ?? 0] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = (ra[i] ?? 0) - ma;
    const y = (rb[i] ?? 0) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
