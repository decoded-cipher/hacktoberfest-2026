export const welcome = (name: string | undefined) =>
  [
    `Hey${name ? ` ${name}` : ""}! I'm Reel 🎬`,
    "",
    "Tell me what you watch in plain words and I'll keep track of it, then help you pick what to watch next.",
    "",
    "Try:",
    "• finished ep 5 of severance s2",
    "• just watched oppenheimer, 9/10",
    "• add past lives to my list",
    "",
    "Send /help to see everything I can do.",
  ].join("\n");

export const help = [
  "Just tell me what you watched, in your own words. You can also:",
  "",
  "/next — what to continue watching",
  "/watchlist — things you saved for later",
  "/history — what you watched recently",
  "/undo — remove the last thing you logged",
  "/import — bring in your Letterboxd or IMDb history",
  "/help — show this message",
].join("\n");

export const whichTitle = "Which movie or show do you mean?";
export const notFound = (title: string) => `I couldn't find “${title}”. Could you check the name?`;
export const whichOne = (title: string) => `Which “${title}” do you mean?`;
export const pickExpired = "That question expired. Could you send your message again?";
export const pickNone = "Okay, nothing logged. Try adding the year, e.g. “Dune 1984”.";
export const notUnderstood =
  "I'm not sure what to do with that. Tell me what you watched, or send /help.";
export const comingSoon = "That's coming soon! For now I can track what you watch.";

export const nothingInProgress =
  "You're not in the middle of any shows. Tell me an episode you watched to start tracking one.";
export const emptyWatchlist = "Your watchlist is empty. Say “add <title> to my list” to save one.";
export const emptyHistory = "Nothing logged yet. Tell me what you watched!";
export const nothingToUndo = "There's nothing to undo.";

export const importHelp = [
  "<b>Bring your history over</b>",
  "",
  "<b>Letterboxd:</b> Settings → Data → Export your data. Send me the ZIP file.",
  "<b>IMDb:</b> Your ratings (or watchlist) → ⋯ → Export. Send me the CSV file.",
  "",
  "I'll match every title and import your ratings, what you've watched and your watchlist. Sending the same file again is safe.",
].join("\n");
export const importWrongType =
  "Send a Letterboxd export (.zip) or an IMDb export (.csv). See /import.";
export const importTooBig = "That file is over 20 MB, which is too big for me to download.";
export const importDownloadFailed = "I couldn't download that file. Please try again.";
export const importEmpty = "I didn't find any movies or shows in that file.";
