import type { AddressInfo } from "node:net";
import { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebhookServer, WEBHOOK_PATH, webhookToken } from "../src/server.ts";
import { type ApiCall, BOT_INFO, recordApiCalls, textUpdate } from "./helpers/bot.ts";

const SECRET = "test_secret_token_123";

describe("webhook server", () => {
  let server: ReturnType<typeof createWebhookServer>;
  let base: string;
  let calls: ApiCall[];

  beforeEach(async () => {
    const bot = new Bot("t", { botInfo: BOT_INFO });
    bot.on("message:text", (ctx) => ctx.reply(`echo: ${ctx.message.text}`));
    calls = recordApiCalls(bot);
    server = createWebhookServer(bot, SECRET);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (body: unknown, secret?: string) =>
    fetch(`${base}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret && { "X-Telegram-Bot-Api-Secret-Token": secret }),
      },
      body: JSON.stringify(body),
    });

  it("answers health checks", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("handles updates carrying the secret token", async () => {
    const res = await post(textUpdate("hello"), SECRET);

    expect(res.status).toBe(200);
    expect(calls.find((c) => c.method === "sendMessage")?.payload.text).toBe("echo: hello");
  });

  it("rejects updates without the right secret", async () => {
    expect((await post(textUpdate("hi"))).status).toBe(401);
    expect((await post(textUpdate("hi"), "wrong")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("derives a Telegram-safe token from any secret", () => {
    expect(webhookToken("abc+/=generated==")).toMatch(/^[a-f0-9]{64}$/);
    expect(webhookToken("same")).toBe(webhookToken("same"));
  });

  it("404s anything else", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
