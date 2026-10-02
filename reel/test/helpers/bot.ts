import type { Bot, Context } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

export const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "Reel",
  username: "reel_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

export const USER = { id: 42, is_bot: false, first_name: "Asha" };

export interface ApiCall {
  method: string;
  // biome-ignore lint/suspicious/noExplicitAny: payloads vary per Bot API method
  payload: any;
}

/** Intercept every Bot API request so tests never hit Telegram; returns the recorded calls. */
export function recordApiCalls<C extends Context>(bot: Bot<C>): ApiCall[] {
  const calls: ApiCall[] = [];
  let messageId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const result = method.startsWith("send")
      ? { message_id: messageId++, date: 0, chat: { id: USER.id, type: "private" }, ...payload }
      : method === "getFile"
        ? { file_id: "doc1", file_unique_id: "u", file_path: "documents/upload" }
        : true;
    // biome-ignore lint/suspicious/noExplicitAny: fake Bot API response
    return { ok: true, result } as any;
  });
  return calls;
}

let updateId = 1;

export function textUpdate(text: string, from = USER): Update {
  const command = text.startsWith("/") ? text.split(" ")[0] : undefined;
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from.id, type: "private", first_name: from.first_name },
      from,
      text,
      ...(command && { entities: [{ type: "bot_command", offset: 0, length: command.length }] }),
    },
  };
}

export function callbackUpdate(data: string, messageText = "", from = USER): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: "1",
      data,
      message: {
        message_id: 999,
        date: 0,
        chat: { id: from.id, type: "private", first_name: from.first_name },
        text: messageText,
      },
    },
  };
}

/** Callback data of every inline button in a recorded call. */
export function buttonData(call: ApiCall | undefined): string[] {
  const rows: { callback_data?: string }[][] = call?.payload.reply_markup?.inline_keyboard ?? [];
  return rows.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : []));
}

export function documentUpdate(fileName: string, fileSize = 1000, from = USER): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from.id, type: "private", first_name: from.first_name },
      from,
      document: {
        file_id: "doc1",
        file_unique_id: "doc1u",
        file_name: fileName,
        file_size: fileSize,
      },
    },
  };
}
