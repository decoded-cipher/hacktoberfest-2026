# Reel

A Telegram bot that tracks the movies and series you watch and suggests what to watch next, learning your taste from your own ratings.

Every piece of AI in it is open: an open-weight language model (via Ollama) reads your messages, a tabular foundation model ([TabPFN](https://priorlabs.ai)) learns your taste, and [whisper.cpp](https://github.com/ggml-org/whisper.cpp) transcribes voice notes locally.

## What it does

**Track by just talking**

> **You:** ep5 sev s2 mid tbh
> **Reel:** ✅ Severance — S02E05 · ⏭ Next up: S02E06 “Attila”

- Understands slang, nicknames, typos and Hinglish: *"kal raat dune 2 dekhi, 9/10"*, *"2x05 of breaking bad"*, *"finished the bear"*
- Asks when a title is ambiguous ("Which *Dune*?") instead of guessing
- Tracks series progress: `/next` shows what to continue, and you get a ping when a new episode drops
- Voice notes work too, transcribed on-device
- `/import` your Letterboxd or IMDb history, `/watchlist`, `/history`, `/undo`

**Suggestions that know you**

- `/suggest` or just *"something light under 2 hours, no romance"*
- Ranked by a model trained on *your* ratings, each pick with a reason: *"directed by Denis Villeneuve, like Arrival (you gave it ★5)"*
- Remembers what you tell it — *"I can't stand horror"*, *"watching with my mum tonight"* (that one expires) — see and edit it with `/memory`
- Friday-evening picks and a Sunday recap of your week

## How it works

```
Telegram ─► grammY bot ─► message parser ──► open-weight LLM (Ollama, OpenAI-compatible API)
                │          (zod-validated JSON)
                ├─► TMDB (titles, seasons, recommendations) + title matcher
                ├─► recommender: taste features ─► TabPFN (Prior Labs API) │ local ridge fallback
                ├─► whisper.cpp for voice notes
                └─► Postgres via Drizzle (PGlite locally, Render Postgres in production)
cron jobs ─► new-episode alerts · Friday picks · weekly recap
```

- **Parser** (`src/nlu`): turns a message into one typed action. The default prompt has rules and examples; a model fine-tuned with Tinker ([training/](training/)) only needs a one-line prompt.
- **Recommender** (`src/recommend`): builds per-title features (genres, year, runtime, TMDB score, and *affinities*: how you rated other titles by the same directors, cast and keywords, computed leave-one-out so a title never sees its own rating), predicts your rating for candidates from your watchlist, TMDB recommendations and trending, then applies your stated preferences.

## Results

Run them yourself with `pnpm eval:parser` and `pnpm eval:recommender`; results are saved in [evals/results/](evals/results/).

**Message parsing** — 43 hand-labelled messages, local Ollama on an M4 Pro:

| Model | Prompt | Exact match | p50 latency |
|---|---|---|---|
| qwen3:8b | full | 83.7% | 2.4 s |
| qwen3:1.7b | full | 79.1% | 0.9 s |
| qwen3:8b | compact | 55.8% | 2.1 s |

The fine-tuning setup in [training/](training/) targets the compact prompt on a small model.

**Rating prediction** — 5-fold cross-validation on a synthetic viewer with a planted taste (`--synthetic`); run with `--user <telegram id>` on real ratings, and set `PRIORLABS_API_KEY` to add TabPFN to the table:

| Model | MAE | vs. user mean | Spearman |
|---|---|---|---|
| User mean | 0.762 | — | −0.10 |
| TMDB score | 0.758 | 1% | 0.16 |
| k-nearest neighbours | 0.429 | 44% | 0.83 |
| Ridge regression | 0.246 | 68% | 0.95 |

## Run it locally

Requirements: Node 24+, pnpm, [Ollama](https://ollama.com). Optional: whisper.cpp + ffmpeg for voice notes.

```sh
pnpm install
ollama pull qwen3:8b
cp .env.example .env   # then fill in the tokens
```

- `TELEGRAM_BOT_TOKEN`: message [@BotFather](https://t.me/BotFather), send `/newbot`
- `TMDB_ACCESS_TOKEN`: the "API Read Access Token" from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
- Optional `PRIORLABS_API_KEY` for TabPFN, `WHISPER_MODEL_PATH` for voice (see `.env.example`)

```sh
pnpm check:setup   # TMDB and the model are reachable
pnpm start         # long polling, no public URL needed
```

## Deploy to Render

The repo's [`render.yaml`](../render.yaml) Blueprint creates everything: the bot (webhook mode, health-checked), Ollama serving the model on Render's private network, three cron jobs and a Postgres database.

1. Render dashboard → **New → Blueprint** → pick this repository.
2. Enter `TELEGRAM_BOT_TOKEN`, `TMDB_ACCESS_TOKEN` and (optionally) `PRIORLABS_API_KEY` when prompted.

The webhook secret is generated for you, migrations run on startup, and the bot registers its own webhook.

## Development

```sh
pnpm dev                 # restart on file changes
pnpm test                # set TEST_DATABASE_URL to also test against real Postgres
pnpm typecheck
pnpm lint                # pnpm format to auto-fix
pnpm db:generate         # after changing src/db/schema.ts
pnpm job <episodes|picks|recap>
```

---

This product uses the TMDB API but is not endorsed or certified by TMDB.
