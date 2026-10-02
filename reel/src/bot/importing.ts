import { Composer } from "grammy";
import { ImportFormatError, readUpload } from "../importers/parse.ts";
import { importItems } from "../importers/run.ts";
import type { ImportSummary } from "../importers/types.ts";
import type { BotContext } from "./context.ts";
import { escapeHtml } from "./format.ts";
import * as messages from "./messages.ts";

const MAX_BYTES = 20 * 1024 * 1024; // Bot API download limit
const PROGRESS_EVERY_MS = 3000;

export const importing = new Composer<BotContext>();

importing.command("import", (ctx) => ctx.reply(messages.importHelp, { parse_mode: "HTML" }));

importing.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const name = doc.file_name ?? "";
  if (!/\.(zip|csv)$/i.test(name)) return ctx.reply(messages.importWrongType);
  if ((doc.file_size ?? 0) > MAX_BYTES) return ctx.reply(messages.importTooBig);

  const file = await ctx.getFile();
  if (!file.file_path) return ctx.reply(messages.importDownloadFailed);
  const bytes = await ctx.services.download(file.file_path);

  let items: ReturnType<typeof readUpload>;
  try {
    items = readUpload(name, bytes);
  } catch (err) {
    if (err instanceof ImportFormatError) return ctx.reply(err.message);
    throw err;
  }
  if (items.length === 0) return ctx.reply(messages.importEmpty);

  const status = await ctx.reply(`📥 Importing ${items.length} titles…`);
  const edit = (text: string, html = false) =>
    ctx.api
      .editMessageText(status.chat.id, status.message_id, text, html ? { parse_mode: "HTML" } : {})
      .catch(() => {});

  let lastUpdate = Date.now();
  const summary = await importItems(ctx.services, ctx.user.id, items, async (done, total) => {
    if (done < total && Date.now() - lastUpdate > PROGRESS_EVERY_MS) {
      lastUpdate = Date.now();
      await edit(`📥 Importing… ${done}/${total}`);
    }
  });
  await edit(summaryText(summary), true);
});

export function summaryText(s: ImportSummary): string {
  const lines = [
    `✅ <b>Import done</b> — matched ${s.matched} of ${s.total}`,
    "",
    `⭐ ${s.rated} ratings`,
    `🎬 ${s.watched} watched`,
    `📌 ${s.watchlisted} added to your watchlist`,
  ];
  if (s.unmatched.length > 0) {
    const shown = s.unmatched.slice(0, 10).map((u) => `• ${escapeHtml(u)}`);
    const more = s.unmatched.length > 10 ? `\n…and ${s.unmatched.length - 10} more` : "";
    lines.push("", `Couldn't match ${s.unmatched.length}:`, ...shown);
    if (more) lines.push(more.trim());
  }
  return lines.join("\n");
}
