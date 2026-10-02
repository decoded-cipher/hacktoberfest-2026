/**
 * Run one scheduled job and exit — meant for cron (e.g. Render cron jobs):
 *
 *   node src/jobs/run.ts episodes   # daily: new-episode alerts
 *   node src/jobs/run.ts picks      # Fridays: weekend suggestions
 *   node src/jobs/run.ts recap      # Sundays: weekly recap
 */
import { Api } from "grammy";
import { buildDeps } from "../app.ts";
import { loadConfig } from "../config.ts";
import { RidgeModel } from "../recommend/models.ts";
import { Recommender } from "../recommend/recommender.ts";
import { Tracker } from "../services/tracker.ts";
import { fridayPicks, type JobDeps, newEpisodeAlerts, weeklyRecap } from "./jobs.ts";

const JOBS = { episodes: newEpisodeAlerts, picks: fridayPicks, recap: weeklyRecap } as const;

const name = process.argv[2];
if (!name || !(name in JOBS)) {
  console.error(`Usage: node src/jobs/run.ts <${Object.keys(JOBS).join("|")}>`);
  process.exit(1);
}

const config = loadConfig();
const { deps, close } = await buildDeps(config);
const now = () => new Date();
const tracker = new Tracker({ db: deps.db, tmdb: deps.tmdb, now });
const fallback = new RidgeModel();
const jobDeps: JobDeps = {
  db: deps.db,
  api: new Api(config.TELEGRAM_BOT_TOKEN),
  tracker,
  recommender: new Recommender({
    db: deps.db,
    tmdb: deps.tmdb,
    tracker,
    model: deps.ratingModel ?? fallback,
    fallback,
    now,
  }),
  now,
};

try {
  const report = await JOBS[name as keyof typeof JOBS](jobDeps);
  console.log(`${name}: sent ${report.sent}, skipped ${report.skipped}, failed ${report.failed}`);
} finally {
  await close();
}
