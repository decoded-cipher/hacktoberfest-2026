import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { type Bot, type Context, webhookCallback } from "grammy";

export const WEBHOOK_PATH = "/telegram";

/**
 * HTTP server for webhook mode: Telegram POSTs updates to /telegram (checked against the
 * secret token Telegram echoes in a header), and /healthz answers the host's health checks.
 */
export function createWebhookServer<C extends Context>(bot: Bot<C>, secretToken: string): Server {
  const handleUpdate = webhookCallback(bot, "http", { secretToken });
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (req.method === "POST" && path === WEBHOOK_PATH) {
      handleUpdate(req, res).catch((err) => {
        console.error("Webhook handling failed:", err);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
}

/** Telegram only accepts [A-Za-z0-9_-] secret tokens; derive one from any configured secret. */
export function webhookToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
