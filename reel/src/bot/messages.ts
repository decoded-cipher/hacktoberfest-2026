export const welcome = (name: string | undefined) =>
  [
    `Hey${name ? ` ${name}` : ""}! I'm Reel 🎬`,
    "",
    "Tell me what you watch in plain words and I'll keep track of it, then help you pick what to watch next.",
    "",
    "Send /help to see everything I can do.",
  ].join("\n");

export const help = [
  "Here's what I can do:",
  "",
  "/start — say hello",
  "/help — show this message",
].join("\n");
