/**
 * Generates supervised fine-tuning data for Reel's message parser.
 *
 *   pnpm train:dataset            # writes training/data/train.jsonl
 *
 * Each example is a chat in the Tinker cookbook format: the compact system prompt, a
 * realistic user message (slang, typos, nicknames, Hinglish, many episode/rating formats)
 * and the exact JSON the parser should return. Sentences from the eval set are excluded.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { rng } from "../evals/synthetic.ts";
import { COMPACT_PROMPT } from "../src/nlu/prompt.ts";
import { OTHER, ParsedMessage } from "../src/nlu/schema.ts";
import { type BankTitle, TITLES } from "./titles.ts";

const { values: args } = parseArgs({
  options: {
    train: { type: "string", default: "2400" },
    seed: { type: "string", default: "7" },
  },
});

type Example = { text: string; label: ParsedMessage };
type Rand = () => number;

const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const chance = (rand: Rand, p: number) => rand() < p;
const label = (over: Partial<ParsedMessage>): ParsedMessage =>
  ParsedMessage.parse({ ...OTHER, ...over });

/** How the user refers to a title: usually its name, sometimes a nickname, lowercase or not. */
function mention(rand: Rand, t: BankTitle): string {
  if (t.aliases?.length && chance(rand, 0.35)) return pick(rand, t.aliases);
  const plain = t.title.replace(/[:]/g, "").replace(/ō/g, "o").replace(/é/g, "e");
  return chance(rand, 0.75) ? plain.toLowerCase() : t.title;
}

const COMMENTS: { text: string; sentiment: ParsedMessage["sentiment"]; tvOnly?: boolean }[] = [
  { text: "loved it", sentiment: "loved" },
  { text: "so good", sentiment: "loved" },
  { text: "what an episode", sentiment: "loved", tvOnly: true },
  { text: "mast tha", sentiment: "loved" },
  { text: "pretty good", sentiment: "liked" },
  { text: "enjoyed it", sentiment: "liked" },
  { text: "not bad", sentiment: "liked" },
  { text: "mid tbh", sentiment: "mixed" },
  { text: "meh", sentiment: "mixed" },
  { text: "it was ok", sentiment: "mixed" },
  { text: "kinda boring", sentiment: "disliked" },
  { text: "bakwas", sentiment: "disliked" },
  { text: "didn't like it", sentiment: "disliked" },
];

function comment(rand: Rand): {
  suffix: string;
  sentiment: ParsedMessage["sentiment"];
  note: string | null;
} {
  if (!chance(rand, 0.35)) return { suffix: "", sentiment: null, note: null };
  const c = pick(rand, COMMENTS);
  return {
    suffix: `${pick(rand, [", ", " ", ". ", " - "])}${c.text}`,
    sentiment: c.sentiment,
    note: c.text,
  };
}

/** A rating in one of many written formats, with its 0.5–5 star value. */
function rating(rand: Rand): { text: string; stars: number } {
  const stars = pick(rand, [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  const tens = stars * 2;
  const whole = Number.isInteger(stars);
  const formats = [
    `${tens}/10`,
    `${tens} out of 10`,
    ...(whole
      ? [`${stars}/5`, `${stars} stars`, `${"★".repeat(stars)}`]
      : [`${stars} stars`, `${"★".repeat(Math.floor(stars))}½`]),
  ];
  return { text: pick(rand, formats), stars };
}

function episodeRef(
  rand: Rand,
  season: number,
  episode: number,
): { text: string; season: number | null; episode: number } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const range = episode > 2 && chance(rand, 0.1);
  if (range) return { text: `eps ${episode - 2}-${episode} of season ${season}`, season, episode };
  if (chance(rand, 0.1)) return { text: `ep ${episode}`, season: null, episode };
  const text = pick(rand, [
    `s${season}e${episode}`,
    `S${pad(season)}E${pad(episode)}`,
    `${season}x${pad(episode)}`,
    `ep ${episode} of season ${season}`,
    `season ${season} episode ${episode}`,
    `s${season} ep${episode}`,
    `s${season} e${episode}`,
    `episode ${episode} season ${season}`,
  ]);
  return { text, season, episode };
}

const GENRE_WORDS: Record<string, string> = {
  Horror: "horror",
  Comedy: "comedies",
  Romance: "romcoms",
  Documentary: "documentaries",
  Animation: "animated stuff",
  "Science Fiction": "sci-fi",
  Thriller: "thrillers",
  Action: "action movies",
  Crime: "crime shows",
  Fantasy: "fantasy",
  Family: "family films",
  Mystery: "mysteries",
  War: "war films",
  Musical: "musicals",
};

const GENERATORS: { weight: number; make: (rand: Rand) => Example }[] = [
  // An episode
  {
    weight: 22,
    make(rand) {
      const t = pick(
        rand,
        TITLES.filter((x) => x.kind === "tv"),
      );
      const ep = episodeRef(rand, 1 + Math.floor(rand() * 5), 1 + Math.floor(rand() * 10));
      const c = comment(rand, "tv");
      const r = chance(rand, 0.15) ? rating(rand) : null;
      const name = mention(rand, t);
      const verb = pick(rand, [
        "just finished",
        "watched",
        "finished",
        "done with",
        "saw",
        "caught",
        "just did",
        "just watched",
      ]);
      const body = pick(rand, [
        `${verb} ${ep.text} of ${name}`,
        `${name} ${ep.text} done`,
        `${ep.text} ${name}${pick(rand, ["", " done", " watched"])}`,
        `${verb} ${name} ${ep.text}`,
        `${name} ka ${ep.text} dekha`,
      ]);
      return {
        text: `${body}${c.suffix}${r ? ` ${r.text}` : ""}`,
        label: label({
          intent: "log_watch",
          title: t.title,
          kind: "tv",
          season: ep.season,
          episode: ep.episode,
          sentiment: c.sentiment,
          note: c.note,
          rating: r?.stars ?? null,
        }),
      };
    },
  },
  // A whole season
  {
    weight: 6,
    make(rand) {
      const t = pick(
        rand,
        TITLES.filter((x) => x.kind === "tv"),
      );
      const season = 1 + Math.floor(rand() * 5);
      const ordinal = ["first", "second", "third", "fourth", "fifth"][season - 1];
      const name = mention(rand, t);
      const text = pick(rand, [
        `binged all of ${name} season ${season}`,
        `finished season ${season} of ${name}`,
        `${name} s${season} done`,
        `watched the whole ${ordinal} season of ${name}`,
        `${name} season ${season} complete`,
      ]);
      return { text, label: label({ intent: "log_watch", title: t.title, kind: "tv", season }) };
    },
  },
  // A whole show
  {
    weight: 5,
    make(rand) {
      const t = pick(
        rand,
        TITLES.filter((x) => x.kind === "tv"),
      );
      const name = mention(rand, t);
      const text = pick(rand, [
        `finished ${name}`,
        `finally completed ${name}`,
        `done with all of ${name}`,
        `${name} khatam kiya`,
        `just wrapped up ${name}, what a show`,
        `finished the whole of ${name}`,
      ]);
      return {
        text,
        label: label({ intent: "log_watch", title: t.title, kind: "tv", finished_series: true }),
      };
    },
  },
  // Next episode, no numbers
  {
    weight: 4,
    make(rand) {
      const t = pick(
        rand,
        TITLES.filter((x) => x.kind === "tv"),
      );
      const name = mention(rand, t);
      const text = pick(rand, [
        `watched another ep of ${name}`,
        `watched the new episode of ${name}`,
        `${name} ka next episode dekha`,
        `one more ${name} episode down`,
      ]);
      return { text, label: label({ intent: "log_watch", title: t.title, kind: "tv" }) };
    },
  },
  // A movie
  {
    weight: 16,
    make(rand) {
      const t = pick(
        rand,
        TITLES.filter((x) => x.kind === "movie"),
      );
      const name = mention(rand, t);
      const c = comment(rand, "movie");
      const r = chance(rand, 0.35) ? rating(rand) : null;
      const body = pick(rand, [
        `watched ${name}`,
        `just saw ${name}`,
        `finally saw ${name}`,
        `rewatched ${name}`,
        `${name} rewatch`,
        `${name} again lol`,
        `kal raat ${name} dekhi`,
        `saw ${name} in theatres`,
        `watched ${name} last night`,
        `${name} with friends tonight was fun`,
      ]);
      return {
        text: `${body}${c.suffix}${r ? `${pick(rand, [", ", " ", ". still a ", ", easily "])}${r.text}` : ""}`,
        label: label({
          intent: "log_watch",
          title: t.title,
          kind: "movie",
          sentiment: c.sentiment,
          note: c.note,
          rating: r?.stars ?? null,
        }),
      };
    },
  },
  // A rating without a watch
  {
    weight: 10,
    make(rand) {
      const t = pick(rand, TITLES);
      const name = mention(rand, t);
      if (chance(rand, 0.25)) {
        const c = pick(
          rand,
          COMMENTS.filter((x) => !x.tvOnly),
        );
        return {
          text: `${name} was ${c.text}`,
          label: label({ intent: "rate", title: t.title, sentiment: c.sentiment, note: c.text }),
        };
      }
      const r = rating(rand);
      const text = pick(rand, [
        `${name} was a ${r.text}`,
        `i'd give ${name} a ${r.text}`,
        `${name} is easily ${r.text}`,
        `rating ${name} ${r.text}`,
        `${name}: ${r.text}`,
        `${name} deserves ${r.text}`,
        `rate ${name} ${r.text}`,
      ]);
      return { text, label: label({ intent: "rate", title: t.title, rating: r.stars }) };
    },
  },
  // Watchlist
  {
    weight: 10,
    make(rand) {
      const t = pick(rand, TITLES);
      const name = mention(rand, t);
      const text = pick(rand, [
        `add ${name} to my list`,
        `add ${name} to watchlist`,
        `save ${name} for later`,
        `remind me to watch ${name}`,
        `put ${name} on my list pls`,
        `${name} watchlist mein daal do`,
        `want to watch ${name} sometime`,
        `need to check out ${name}`,
      ]);
      return { text, label: label({ intent: "add_watchlist", title: t.title }) };
    },
  },
  // Progress
  {
    weight: 7,
    make(rand) {
      const t = pick(
        rand,
        TITLES.filter((x) => x.kind === "tv"),
      );
      const name = mention(rand, t);
      const text = pick(rand, [
        `where am i in ${name}`,
        `what episode am i on in ${name}?`,
        `which ep of ${name} was i on`,
        `${name} progress?`,
        `how far am i in ${name}`,
        `${name} mein kaunsa episode tha`,
      ]);
      return { text, label: label({ intent: "progress", title: t.title, kind: "tv" }) };
    },
  },
  // Suggestions, with optional filters
  {
    weight: 14,
    make(rand) {
      const options: [string, Partial<ParsedMessage>][] = [
        ["what should i watch", {}],
        ["recommend something", {}],
        ["kuch accha batao dekhne ko", {}],
        ["need something for tonight", {}],
        ["suggest a movie", { kind: "movie" }],
        ["a series to binge", { kind: "tv" }],
        ["any good shows to start?", { kind: "tv" }],
        ["something light and funny", { genres: ["Comedy"] }],
        ["a feel good movie please", { kind: "movie", genres: ["Comedy", "Family"] }],
        ["suggest a thriller under 2 hours", { genres: ["Thriller"], max_runtime: 120 }],
        ["something short, under 90 minutes", { max_runtime: 90 }],
        ["anything but horror", { avoid_genres: ["Horror"] }],
        ["a mind bending sci-fi movie", { kind: "movie", genres: ["Science Fiction", "Mystery"] }],
        ["something scary for tonight", { genres: ["Horror"] }],
        ["a good documentary?", { genres: ["Documentary"] }],
        [
          "animated movie for the kids, no more than 100 mins",
          { kind: "movie", genres: ["Animation", "Family"], max_runtime: 100 },
        ],
        [
          "a crime show but no romance",
          { kind: "tv", genres: ["Crime"], avoid_genres: ["Romance"] },
        ],
      ];
      const [core, over] = pick(rand, options);
      const prefix = pick(rand, [
        "",
        "",
        "hey ",
        "can you suggest ",
        "pls ",
        "yo ",
        "help me pick: ",
      ]);
      const suffix = pick(rand, ["", "", "?", " pls", " tonight", " for the weekend", " 🙏"]);
      return { text: `${prefix}${core}${suffix}`, label: label({ intent: "suggest", ...over }) };
    },
  },
  // Preferences
  {
    weight: 10,
    make(rand) {
      const genre = pick(
        rand,
        Object.keys(GENRE_WORDS).filter((g) => g !== "Musical"),
      );
      const word = GENRE_WORDS[genre] ?? genre.toLowerCase();
      const person = pick(rand, [
        "florence pugh",
        "denis villeneuve",
        "christopher nolan",
        "zendaya",
        "shah rukh khan",
        "greta gerwig",
        "a24",
      ]);
      const options: [string, Partial<ParsedMessage>][] = [
        [`i hate ${word}`, { sentiment: "disliked", note: `hate ${word}`, avoid_genres: [genre] }],
        [
          `can't stand ${word}`,
          { sentiment: "disliked", note: `can't stand ${word}`, avoid_genres: [genre] },
        ],
        [
          `not really into ${word}`,
          { sentiment: "disliked", note: `not into ${word}`, avoid_genres: [genre] },
        ],
        [`big fan of ${word}`, { sentiment: "loved", note: `big fan of ${word}`, genres: [genre] }],
        [`i love ${word}`, { sentiment: "loved", note: `love ${word}`, genres: [genre] }],
        [
          `anything with ${person} is a yes`,
          { sentiment: "loved", note: `anything with ${person}` },
        ],
        [`not a fan of ${person}`, { sentiment: "disliked", note: `not a fan of ${person}` }],
        [
          "watching with my mum tonight so keep it clean",
          {
            note: "watching with mum, keep it clean",
            genres: ["Family"],
            avoid_genres: ["Horror"],
            temporary: true,
          },
        ],
        [
          `my sister is over tonight, she likes ${word}`,
          { note: `sister over, likes ${word}`, genres: [genre], temporary: true },
        ],
        [
          `date night today, nothing ${genre === "Horror" ? "too gory" : "scary"}`,
          {
            note: "date night, nothing scary",
            genres: ["Romance"],
            avoid_genres: ["Horror"],
            temporary: true,
          },
        ],
      ];
      const [text, over] = pick(rand, options);
      return { text, label: label({ intent: "set_preference", ...over }) };
    },
  },
  // Chit-chat
  {
    weight: 6,
    make(rand) {
      const text = pick(rand, [
        "hi",
        "hello!",
        "thanks",
        "thank you!",
        "lol",
        "ok",
        "cool cool",
        "good morning",
        "what can you do?",
        "how do i use this",
        "👍",
        "nice",
        "haha",
      ]);
      return { text, label: OTHER };
    },
  },
];

/** Light, label-preserving noise: typos outside titles, dropped punctuation, emoji. */
function noisy(rand: Rand, ex: Example): Example {
  let text = ex.text;
  if (chance(rand, 0.25)) text = text.replace(/[,.!?]/g, "");
  if (chance(rand, 0.1)) text = `${text} ${pick(rand, ["😭", "🔥", "🙌", "!!", "omg"])}`;
  if (chance(rand, 0.08)) {
    // swap two adjacent letters in a filler word, never in the title
    const words = text.split(" ");
    const i = Math.floor(rand() * words.length);
    const w = words[i] ?? "";
    const titleWords = (ex.label.title ?? "").toLowerCase();
    if (w.length > 3 && !titleWords.includes(w.toLowerCase())) {
      const j = 1 + Math.floor(rand() * (w.length - 2));
      words[i] = w.slice(0, j) + (w[j + 1] ?? "") + (w[j] ?? "") + w.slice(j + 2);
      text = words.join(" ");
    }
  }
  return { ...ex, text };
}

const MAX_COPIES = 4;

function pickWeighted(rand: Rand, total: number) {
  let r = rand() * total;
  for (const g of GENERATORS) {
    r -= g.weight;
    if (r < 0) return g;
  }
  return GENERATORS[0];
}

function generate(n: number, seed: number, exclude: Set<string>): Example[] {
  const rand = rng(seed);
  const total = GENERATORS.reduce((s, g) => s + g.weight, 0);
  const seen = new Map<string, number>();
  const out: Example[] = [];
  let attempts = 0;
  while (out.length < n && attempts++ < n * 50) {
    const gen = pickWeighted(rand, total);
    if (!gen) break;
    const ex = noisy(rand, gen.make(rand));
    const key = ex.text.trim().toLowerCase();
    // Short messages repeat in real life; allow a few copies, but never an eval sentence.
    const copies = seen.get(key) ?? 0;
    if (copies >= MAX_COPIES || exclude.has(key)) continue;
    seen.set(key, copies + 1);
    out.push({ ...ex, text: ex.text.trim() });
  }
  return out;
}

const toJsonl = (examples: Example[]) =>
  `${examples
    .map((ex) =>
      JSON.stringify({
        messages: [
          { role: "system", content: COMPACT_PROMPT },
          { role: "user", content: ex.text },
          { role: "assistant", content: JSON.stringify(ex.label) },
        ],
      }),
    )
    .join("\n")}\n`;

const evalTexts = new Set(
  (await readFile(new URL("../evals/data/parser-cases.jsonl", import.meta.url), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { text: string }).text.trim().toLowerCase()),
);

const seed = Number(args.seed);
const train = generate(Number(args.train), seed, evalTexts);

const outDir = new URL("data/", import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(new URL("train.jsonl", outDir), toJsonl(train));

const byIntent = (examples: Example[]) =>
  Object.entries(
    examples.reduce<Record<string, number>>((acc, e) => {
      acc[e.label.intent] = (acc[e.label.intent] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
console.log(`train: ${train.length} (${byIntent(train)})`);
console.log(`written to ${fileURLToPath(outDir)}`);
