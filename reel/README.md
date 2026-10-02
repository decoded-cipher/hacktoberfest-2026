# Reel

A Telegram bot that tracks the movies and series you watch and suggests what to watch next, learning your taste from your own ratings.

Built on open-source AI: an open-weight model running locally through [Ollama](https://ollama.com), and [TabPFN](https://priorlabs.ai) for taste prediction.

## Setup

Requirements: Node 24+, pnpm, Ollama.

```sh
pnpm install
ollama pull qwen3:8b
cp .env.example .env   # then fill in the tokens
```

- `TELEGRAM_BOT_TOKEN`: message [@BotFather](https://t.me/BotFather), send `/newbot`
- `TMDB_ACCESS_TOKEN`: the "API Read Access Token" from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

Check that TMDB and the model are reachable, then start the bot:

```sh
pnpm check:setup
pnpm start
```

## Development

```sh
pnpm dev          # restart on file changes
pnpm test
pnpm typecheck
pnpm lint         # pnpm format to auto-fix
pnpm db:generate  # after changing src/db/schema.ts
```

Migrations are applied automatically on startup.

---

This product uses the TMDB API but is not endorsed or certified by TMDB.
