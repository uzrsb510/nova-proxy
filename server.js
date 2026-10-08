const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "nova-secret-2026";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function defaultDB() {
  return {
    users: [],
    bots: [],
    botUsers: {},
    commands: {},
    activity: []
  };
}

function saveDB() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(db, null, 2),
    "utf8"
  );
}

function logActivity(type, text, botId = null) {
  if (!Array.isArray(db.activity)) {
    db.activity = [];
  }

  db.activity.unshift({
    id: makeId(),
    type,
    text,
    botId,
    time: Date.now()
  });

  if (db.activity.length > 300) {
    db.activity = db.activity.slice(0, 300);
  }

  saveDB();
}

function normalizeDB(data) {
  if (!data || typeof data !== "object") {
    return defaultDB();
  }

  if (!Array.isArray(data.users)) {
    data.users = [];
  }

  if (!Array.isArray(data.bots)) {
    data.bots = [];
  }

  if (!data.botUsers || typeof data.botUsers !== "object") {
    data.botUsers = {};
  }

  if (!data.commands || typeof data.commands !== "object") {
    data.commands = {};
  }

  if (!Array.isArray(data.activity)) {
    data.activity = [];
  }

  for (const bot of data.bots) {
    if (!bot.id) {
      bot.id = makeId();
    }

    if (!Array.isArray(bot.forceJoins)) {
      if (Array.isArray(bot.forceJoin)) {
        bot.forceJoins = bot.forceJoin;
      } else {
        bot.forceJoins = [];
      }
    }

    delete bot.forceJoin;

    if (
      !bot.forceJoinVerified ||
      typeof bot.forceJoinVerified !== "object" ||
      Array.isArray(bot.forceJoinVerified)
    ) {
      bot.forceJoinVerified = {};
    }

    for (const join of bot.forceJoins) {
      if (!join.id) {
        join.id = makeId();
      }
    }

    if (!data.botUsers[bot.id]) {
      data.botUsers[bot.id] = {};
    }

    if (!data.commands[bot.id]) {
      data.commands[bot.id] = {};
    }
  }

  return data;
}

let db;

try {
  if (fs.existsSync(DATA_FILE)) {
    db = normalizeDB(
      JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      )
    );
  } else {
    db = defaultDB();
    saveDB();
  }
} catch (error) {
  console.error("Database load error:", error);
  db = defaultDB();
  saveDB();
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30,
      httpOnly: true
    }
  })
);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  next();
}

function requireCreator(req, res, next) {
  if (!req.session.creator) {
    return res.redirect("/creator/login");
  }

  next();
}

function findUser(req) {
  return db.users.find(
    user =>
      String(user.id) ===
      String(req.session.userId)
  );
}

function findBot(req) {
  const id = String(
    req.query.bot ||
    req.params.id ||
    ""
  );

  return db.bots.find(
    bot =>
      String(bot.id) === id &&
      String(bot.ownerId) ===
        String(req.session.userId)
  );
}

function telegramUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegram(
  token,
  method,
  body = {}
) {
  const response = await fetch(
    telegramUrl(token, method),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Telegram پاسخ نامعتبر داد."
    );
  }

  if (!data.ok) {
    throw new Error(
      data.description ||
        "Telegram API Error"
    );
  }

  return data.result;
}

async function sendTelegramMessage(
  bot,
  chatId,
  text,
  reply_markup
) {
  const body = {
    chat_id: chatId,
    text: text
  };

  if (reply_markup) {
    body.reply_markup = reply_markup;
  }

  return telegram(
    bot.token,
    "sendMessage",
    body
  );
}

async function deleteTelegramMessage(
  bot,
  chatId,
  messageId
) {
  try {
    await telegram(
      bot.token,
      "deleteMessage",
      {
        chat_id: chatId,
        message_id: messageId
      }
    );

    return true;
  } catch {
    return false;
  }
}

/* =========================
   FORCE JOIN
========================= */

function parsePublicTelegramLink(input) {
  let value = String(input || "").trim();

  if (!value) {
    throw new Error(
      "لینک کانال یا گروه را وارد کنید."
    );
  }

  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "لینک وارد شده معتبر نیست."
    );
  }

  if (
    url.hostname !== "t.me" &&
    url.hostname !== "telegram.me"
  ) {
    throw new Error(
      "فقط لینک عمومی t.me قابل استفاده است."
    );
  }

  const username = url.pathname
    .replace(/^\/+/, "")
    .split("/")[0]
    .trim();

  if (
    !username ||
    username.startsWith("+")
  ) {
    throw new Error(
      "لینک دعوت خصوصی قابل استفاده نیست."
    );
  }

  return {
    username:
      "@" + username.replace(/^@/, ""),
    link:
      "https://t.me/" +
      username.replace(/^@/, "")
  };
}

async function checkBotAdminInChat(
  bot,
  chatUsername
) {
  const me = await telegram(
    bot.token,
    "getMe"
  );

  const member = await telegram(
    bot.token,
    "getChatMember",
    {
      chat_id: chatUsername,
      user_id: me.id
    }
  );

  return (
    member.status === "administrator" ||
    member.status === "creator"
  );
}

async function checkMembership(
  bot,
  chatUsername,
  userId
) {
  try {
    const member = await telegram(
      bot.token,
      "getChatMember",
      {
        chat_id: chatUsername,
        user_id: userId
      }
    );

    if (
      member.status === "creator" ||
      member.status === "administrator" ||
      member.status === "member"
    ) {
      return true;
    }

    if (
      member.status === "restricted" &&
      member.is_member === true
    ) {
      return true;
    }

    return false;
  } catch (error) {
    console.error(
      "Membership check:",
      error.message
    );

    return false;
  }
}

function ensureForceJoinState(bot) {
  if (!Array.isArray(bot.forceJoins)) {
    bot.forceJoins = [];
  }

  if (
    !bot.forceJoinVerified ||
    typeof bot.forceJoinVerified !== "object" ||
    Array.isArray(bot.forceJoinVerified)
  ) {
    bot.forceJoinVerified = {};
  }

  let changed = false;

  for (const join of bot.forceJoins) {
    if (!join.id) {
      join.id = makeId();
      changed = true;
    }
  }

  if (changed) {
    saveDB();
  }
}

function getVerifiedJoins(
  bot,
  userId
) {
  ensureForceJoinState(bot);

  const key = String(userId);

  if (
    !bot.forceJoinVerified[key] ||
    typeof bot.forceJoinVerified[key] !==
      "object"
  ) {
    bot.forceJoinVerified[key] = {};
  }

  return bot.forceJoinVerified[key];
}

function getUnverifiedJoins(
  bot,
  userId
) {
  const verified =
    getVerifiedJoins(
      bot,
      userId
    );

  return bot.forceJoins.filter(
    join =>
      !verified[
        String(join.id)
      ]
  );
}

function markJoinVerified(
  bot,
  userId,
  joinId
) {
  const verified =
    getVerifiedJoins(
      bot,
      userId
    );

  verified[String(joinId)] = true;
}

/*
  مهم:
  هر عضویت فقط یک بار بررسی می‌شود.
  اگر کاربر قبلاً برای همان مورد تأیید شده باشد،
  دوباره از او درخواست عضویت نمی‌شود.
*/
async function checkAllMemberships(
  bot,
  userId
) {
  ensureForceJoinState(bot);

  const unverified =
    getUnverifiedJoins(
      bot,
      userId
    );

  if (unverified.length === 0) {
    return {
      ok: true,
      missing: null
    };
  }

  for (const join of unverified) {
    const isMember =
      await checkMembership(
        bot,
        join.username,
        userId
      );

    if (!isMember) {
      return {
        ok: false,
        missing: join
      };
    }

    markJoinVerified(
      bot,
      userId,
      join.id
    );
  }

  saveDB();

  return {
    ok: true,
    missing: null
  };
}

/* =========================
   COMMANDS
========================= */

function getCommandNameFromText(text) {
  if (
    !text ||
    typeof text !== "string"
  ) {
    return null;
  }

  if (!text.startsWith("/")) {
    return null;
  }

  const first = text
    .trim()
    .split(/\s+/)[0];

  let command = first
    .substring(1)
    .split("@")[0]
    .trim();

  if (!command) {
    return null;
  }

  command = command.replace(
    /[^a-zA-Z0-9_]/g,
    ""
  );

  return command || null;
}

async function sendJoinMessage(
  bot,
  chatId
) {
  const buttons = [];

  for (const join of bot.forceJoins) {
    buttons.push([
      {
        text:
          "📢 " +
          (join.title ||
            join.username),
        url: join.link
      }
    ]);
  }

  buttons.push([
    {
      text: "✅ بررسی عضویت",
      callback_data:
        "check_join_start"
    }
  ]);

  return sendTelegramMessage(
    bot,
    chatId,
    "🔐 برای شروع ربات ابتدا باید در کانال یا گروه‌های زیر عضو شوید.\n\n📢 بعد از عضویت، روی «بررسی عضویت» بزنید.",
    {
      inline_keyboard: buttons
    }
  );
}

async function handleStart(
  bot,
  message
) {
  const userId =
    message.from.id;

  const chatId =
    message.chat.id;

  ensureForceJoinState(bot);

  /*
    عضویت اجباری فقط همین‌جا اجرا می‌شود.
    بنابراین دستورات دیگر بدون عضویت هم کار می‌کنند.
  */

  if (
    bot.forceJoins.length > 0
  ) {
    const result =
      await checkAllMemberships(
        bot,
        userId
      );

    if (!result.ok) {
      await sendJoinMessage(
        bot,
        chatId
      );

      return;
    }
  }

  await executeCommand(
    bot,
    chatId,
    "/start"
  );
}

async function handleCallback(
  bot,
  callback
) {
  const data = String(
    callback.data || ""
  );

  if (
    data !== "check_join_start"
  ) {
    return;
  }

  const userId =
    callback.from.id;

  const chatId =
    callback.message?.chat?.id;

  if (!chatId) {
    return;
  }

  try {
    const result =
      await checkAllMemberships(
        bot,
        userId
      );

    if (!result.ok) {
      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id:
            callback.id,
          text:
            "❌ شما هنوز عضو کانال یا گروه نیستید. ابتدا عضو شوید و دوباره بررسی کنید.",
          show_alert: true
        }
      );

      return;
    }

    await telegram(
      bot.token,
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,
        text:
          "✅ عضویت شما تأیید شد.",
        show_alert: false
      }
    );

    if (
      callback.message?.message_id
    ) {
      await deleteTelegramMessage(
        bot,
        chatId,
        callback.message.message_id
      );
    }

    await executeCommand(
      bot,
      chatId,
      "/start"
    );
  } catch (error) {
    console.error(
      "Callback error:",
      error
    );

    try {
      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id:
            callback.id,
          text:
            "⚠️ خطا در بررسی عضویت.",
          show_alert: true
        }
      );
    } catch {}
  }
}

/* =========================
   USERS
========================= */

function saveBotUser(
  bot,
  telegramUser
) {
  if (!telegramUser?.id) {
    return;
  }

  if (!db.botUsers[bot.id]) {
    db.botUsers[bot.id] = {};
  }

  const key =
    String(telegramUser.id);

  const old =
    db.botUsers[bot.id][key];

  const isNew = !old;

  db.botUsers[bot.id][key] = {
    id: telegramUser.id,
    first_name:
      telegramUser.first_name || "",
    last_name:
      telegramUser.last_name || "",
    username:
      telegramUser.username || "",
    language_code:
      telegramUser.language_code || "",
    updatedAt: Date.now(),
    createdAt:
      old?.createdAt ||
      Date.now()
  };

  saveDB();

  if (isNew) {
    logActivity(
      "user",
      `👤 کاربر جدید وارد ربات «${bot.name}» شد.`,
      bot.id
    );
  }
}

/* =========================
   EXECUTE COMMAND
========================= */

async function executeCommand(
  bot,
  chatId,
  text
) {
  const commandName =
    getCommandNameFromText(text);

  if (!commandName) {
    return false;
  }

  const commands =
    db.commands[bot.id] || {};

  const command =
    commands[commandName];

  if (!command) {
    return false;
  }

  const response =
    typeof command === "string"
      ? command
      : command.response || "";

  if (!response) {
    return false;
  }

  await sendTelegramMessage(
    bot,
    chatId,
    response
  );

  logActivity(
    "command",
    `⚡ دستور /${commandName} در ربات «${bot.name}» اجرا شد.`,
    bot.id
  );

  return true;
}

/* =========================
   UPDATE
========================= */

async function handleUpdate(
  bot,
  update
) {
  if (update.callback_query) {
    await handleCallback(
      bot,
      update.callback_query
    );

    return;
  }

  const message =
    update.message;

  if (!message) {
    return;
  }

  const from =
    message.from;

  const chatId =
    message.chat?.id;

  if (!from || !chatId) {
    return;
  }

  saveBotUser(
    bot,
    from
  );

  /*
    فقط /start عضویت اجباری دارد.
  */

  if (
    message.text &&
    getCommandNameFromText(
      message.text
    ) === "start"
  ) {
    await handleStart(
      bot,
      message
    );

    return;
  }

  /*
    بقیه دستورات بدون بررسی عضویت اجرا می‌شوند.
  */

  if (message.text) {
    await executeCommand(
      bot,
      chatId,
      message.text
    );
  }
}

/* =========================
   POLLING
========================= */

const pollingState =
  new Map();

async function pollBot(bot) {
  if (
    !bot ||
    !bot.token
  ) {
    return;
  }

  if (
    pollingState.get(bot.id)
      ?.running
  ) {
    return;
  }

  pollingState.set(
    bot.id,
    {
      running: true,
      offset:
        pollingState.get(
          bot.id
        )?.offset || 0
    }
  );

  const state =
    pollingState.get(bot.id);

  try {
    await telegram(
      bot.token,
      "getMe"
    );
  } catch (error) {
    console.error(
      `Bot ${bot.id} token error:`,
      error.message
    );

    state.running = false;

    setTimeout(
      () => pollBot(bot),
      10000
    );

    return;
  }

  async function loop() {
    if (!state.running) {
      return;
    }

    const currentBot =
      db.bots.find(
        b =>
          b.id === bot.id
      );

    if (!currentBot) {
      state.running = false;
      return;
    }

    try {
      const updates =
        await telegram(
          currentBot.token,
          "getUpdates",
          {
            offset:
              state.offset,
            timeout: 25,
            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      for (const update of updates) {
        if (
          update.update_id >=
          state.offset
        ) {
          state.offset =
            update.update_id + 1;
        }

        try {
          await handleUpdate(
            currentBot,
            update
          );
        } catch (error) {
          console.error(
            `Update error ${currentBot.id}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        `Polling error ${currentBot.id}:`,
        error.message
      );

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            3000
          )
      );
    }

    setTimeout(
      loop,
      500
    );
  }

  loop();
}

function startAllBots() {
  for (const bot of db.bots) {
    if (bot.token) {
      pollBot(bot);
    }
  }
}

function stopBotPolling(
  botId
) {
  const state =
    pollingState.get(
      botId
    );

  if (state) {
    state.running = false;
    pollingState.delete(
      botId
    );
  }
}

/* =========================
   THEME + MENU
========================= */

function page(
  title,
  content,
  botId = ""
) {
  const botQuery = botId
    ? `?bot=${encodeURIComponent(
        botId
      )}`
    : "";

  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${escapeHtml(
    title
  )}</title>

<style>

* {
  box-sizing: border-box;
}

:root {
  --bg: #f4f7ff;
  --text: #172033;
  --card: rgba(255,255,255,.92);
  --border: #e5e7eb;
  --input: #ffffff;
  --muted: #64748b;
}

body.dark {
  --bg: #0b1020;
  --text: #f1f5f9;
  --card: rgba(20,27,45,.94);
  --border: #263248;
  --input: #111827;
  --muted: #94a3b8;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: Tahoma, Arial, sans-serif;
  color: var(--text);
  background:
    radial-gradient(
      circle at 10% 20%,
      rgba(99,102,241,.28),
      transparent 28%
    ),
    radial-gradient(
      circle at 90% 15%,
      rgba(236,72,153,.25),
      transparent 28%
    ),
    radial-gradient(
      circle at 50% 90%,
      rgba(6,182,212,.25),
      transparent 30%
    ),
    var(--bg);
  background-attachment: fixed;
  transition: .3s;
}

a {
  text-decoration: none;
  color: inherit;
}

button,
input,
textarea,
select {
  font-family: inherit;
}

.topbar {
  height: 68px;
  background: rgba(15,23,42,.88);
  backdrop-filter: blur(15px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  position: sticky;
  top: 0;
  z-index: 1000;
  box-shadow:
    0 10px 35px rgba(0,0,0,.18);
}

.brand {
  font-weight: bold;
  font-size: 18px;
}

.menu-button {
  width: 43px;
  height: 43px;
  border: 0;
  border-radius: 12px;
  background:
    linear-gradient(
      135deg,
      #6366f1,
      #ec4899
    );
  color: white;
  font-size: 23px;
  cursor: pointer;
}

.refresh-button {
  position: fixed;
  left: 18px;
  top: 82px;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 11px;
  background:
    linear-gradient(
      135deg,
      #06b6d4,
      #3b82f6
    );
  color: white;
  font-size: 18px;
  cursor: pointer;
  z-index: 900;
  box-shadow:
    0 8px 20px rgba(0,0,0,.18);
}

.side-menu {
  position: fixed;
  right: -330px;
  top: 0;
  width: 310px;
  height: 100%;
  background:
    linear-gradient(
      180deg,
      #111827,
      #1e1b4b
    );
  color: white;
  z-index: 2000;
  padding: 80px 16px 20px;
  transition: .3s;
  overflow-y: auto;
  box-shadow:
    -10px 0 35px rgba(0,0,0,.25);
}

.side-menu.open {
  right: 0;
}

.menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.48);
  display: none;
  z-index: 1900;
}

.menu-overlay.show {
  display: block;
}

.menu-title {
  font-size: 21px;
  font-weight: bold;
  margin-bottom: 22px;
  text-align: center;
}

.menu-item {
  display: block;
  padding: 14px;
  border-radius: 13px;
  margin-bottom: 9px;
  background: rgba(255,255,255,.08);
  transition: .2s;
}

.menu-item:hover {
  background:
    linear-gradient(
      90deg,
      rgba(99,102,241,.7),
      rgba(236,72,153,.7)
    );
  transform: translateX(-4px);
}

.menu-danger {
  background: rgba(239,68,68,.2);
}

.menu-creator {
  margin-top: 18px;
  background:
    linear-gradient(
      90deg,
      #f59e0b,
      #ef4444
    );
}

.container {
  width: min(1150px, 94%);
  margin: 30px auto;
  padding-bottom: 50px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 24px;
  margin-bottom: 18px;
  box-shadow:
    0 15px 45px rgba(15,23,42,.09);
  backdrop-filter: blur(12px);
}

h1,
h2,
h3 {
  margin-top: 0;
}

p {
  line-height: 1.9;
}

input,
textarea,
select {
  width: 100%;
  padding: 13px;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin: 7px 0 15px;
  background: var(--input);
  color: var(--text);
  font-size: 15px;
  outline: none;
}

textarea {
  min-height: 140px;
  resize: vertical;
}

button,
.btn {
  border: 0;
  background:
    linear-gradient(
      135deg,
      #4f46e5,
      #7c3aed
    );
  color: white;
  padding: 12px 17px;
  border-radius: 12px;
  cursor: pointer;
  display: inline-block;
  font-family: inherit;
  font-weight: bold;
  margin: 3px;
}

.btn-green {
  background:
    linear-gradient(
      135deg,
      #059669,
      #10b981
    );
}

.btn-danger {
  background:
    linear-gradient(
      135deg,
      #dc2626,
      #f43f5e
    );
}

.btn-orange {
  background:
    linear-gradient(
      135deg,
      #f59e0b,
      #f97316
    );
}

.btn-gray {
  background: #475569;
}

.grid {
  display: grid;
  grid-template-columns:
    repeat(
      auto-fit,
      minmax(210px, 1fr)
    );
  gap: 16px;
}

.stat {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  padding: 23px;
  color: white;
  background:
    linear-gradient(
      135deg,
      #4f46e5,
      #9333ea,
      #ec4899
    );
  box-shadow:
    0 15px 30px rgba(79,70,229,.2);
  animation:
    statIn .7s ease;
}

.stat:nth-child(2) {
  background:
    linear-gradient(
      135deg,
      #0891b2,
      #2563eb
    );
}

.stat:nth-child(3) {
  background:
    linear-gradient(
      135deg,
      #059669,
      #14b8a6
    );
}

.stat:nth-child(4) {
  background:
    linear-gradient(
      135deg,
      #f97316,
      #ef4444
    );
}

.stat strong {
  display: block;
  font-size: 36px;
  margin-top: 10px;
}

@keyframes statIn {
  from {
    opacity: 0;
    transform: translateY(20px)
      scale(.95);
  }
  to {
    opacity: 1;
    transform: translateY(0)
      scale(1);
  }
}

.alert {
  background: #fff7d6;
  color: #713f12;
  border: 1px solid #facc15;
  padding: 14px;
  border-radius: 13px;
  margin-bottom: 15px;
}

body.dark .alert {
  color: #fef3c7;
  background: #422006;
}

.success {
  background: #dcfce7;
  color: #14532d;
}

.error {
  background: #fee2e2;
  color: #7f1d1d;
}

.item {
  border: 1px solid var(--border);
  background: rgba(255,255,255,.04);
  padding: 17px;
  border-radius: 15px;
  margin-bottom: 12px;
}

.timeline {
  position: relative;
  padding-right: 25px;
}

.timeline:before {
  content: "";
  position: absolute;
  right: 7px;
  top: 0;
  bottom: 0;
  width: 3px;
  background:
    linear-gradient(
      #6366f1,
      #ec4899,
      #06b6d4
    );
  border-radius: 5px;
}

.timeline-item {
  position: relative;
  margin-bottom: 14px;
  padding: 15px;
  border-radius: 15px;
  background: var(--card);
  border: 1px solid var(--border);
  animation:
    timelineIn .6s ease both;
}

.timeline-item:before {
  content: "";
  position: absolute;
  right: -25px;
  top: 20px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #6366f1;
  box-shadow:
    0 0 0 5px rgba(99,102,241,.18);
}

@keyframes timelineIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.hero {
  padding: 30px;
  border-radius: 25px;
  color: white;
  background:
    linear-gradient(
      135deg,
      #4f46e5,
      #7c3aed,
      #db2777
    );
  margin-bottom: 20px;
  box-shadow:
    0 20px 45px rgba(79,70,229,.25);
}

.hero h1 {
  font-size: 30px;
}

.badge {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(99,102,241,.14);
  color: #6366f1;
  font-size: 12px;
}

pre {
  direction: ltr;
  text-align: left;
  background: #020617;
  color: #e2e8f0;
  padding: 15px;
  border-radius: 12px;
  overflow: auto;
}

small {
  color: var(--muted);
}

@media(max-width:600px) {
  .container {
    width: 92%;
    margin-top: 22px;
  }

  .side-menu {
    width: 285px;
  }

  .brand {
    font-size: 14px;
  }
}

</style>
</head>

<body>

<div class="topbar">

  <div class="brand">
    🤖 ربات ساز کانفیگ ساز رایگان
  </div>

  <button
    class="menu-button"
    onclick="toggleMenu()">
    ☰
  </button>

</div>

<button
  class="refresh-button"
  onclick="location.reload()"
  title="بروزرسانی">
  🔄
</button>

<div
  id="menuOverlay"
  class="menu-overlay"
  onclick="toggleMenu()">
</div>

<div
  id="sideMenu"
  class="side-menu">

  <div class="menu-title">
    ☰ منوی مدیریت
  </div>

  <a
    class="menu-item"
    href="/dashboard">
    📊 داشبورد
  </a>

  <a
    class="menu-item"
    href="/bots">
    🤖 ربات‌ها
  </a>

  <a
    class="menu-item"
    href="/bots/add">
    ➕ افزودن ربات
  </a>

  ${
    botId
      ? `
      <a
        class="menu-item"
        href="/forcejoin?bot=${encodeURIComponent(
          botId
        )}">
        🔒 عضویت اجباری
      </a>

      <a
        class="menu-item"
        href="/broadcast?bot=${encodeURIComponent(
          botId
        )}">
        📢 ارسال پیام به همه کاربران
      </a>

      <a
        class="menu-item"
        href="/commands/add?bot=${encodeURIComponent(
          botId
        )}">
        ➕ افزودن دستور
      </a>

      <a
        class="menu-item"
        href="/commands?bot=${encodeURIComponent(
          botId
        )}">
        ⚡ دستورات
      </a>

      <a
        class="menu-item"
        href="/users?bot=${encodeURIComponent(
          botId
        )}">
        👥 آمار کاربران
      </a>
      `
      : ""
  }

  <a
    class="menu-item menu-danger"
    href="/logout">
    🚪 خروج
  </a>

  <a
    class="menu-item menu-creator"
    href="/creator/login">
    🔐 ورود سازنده
  </a>

</div>

<div class="container">
${content}
</div>

<script>

function toggleMenu() {
  const menu =
    document.getElementById(
      "sideMenu"
    );

  const overlay =
    document.getElementById(
      "menuOverlay"
    );

  menu.classList.toggle(
    "open"
  );

  overlay.classList.toggle(
    "show"
  );
}

(function() {
  const theme =
    localStorage.getItem(
      "nova-theme"
    );

  if (theme === "dark") {
    document.body.classList.add(
      "dark"
    );
  }
})();

</script>

</body>
</html>
`;
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  if (req.session.userId) {
    return res.redirect(
      "/dashboard"
    );
  }

  res.send(
    page(
      "ورود",
      `
      <div class="hero">
        <h1>
          🤖 ربات ساز کانفیگ ساز رایگان
        </h1>

        <p>
          ساخت و مدیریت ربات‌های تلگرام
          با یک پنل ساده و حرفه‌ای.
        </p>

        <a
          class="btn"
          href="/login">
          ورود
        </a>

        <a
          class="btn btn-green"
          href="/register">
          ثبت‌نام
        </a>
      </div>
      `
    )
  );
});

/* =========================
   REGISTER
========================= */

app.get(
  "/register",
  (req, res) => {
    res.send(
      page(
        "ثبت نام",
        `
        <div class="card">

          <h2>
            📝 ثبت نام
          </h2>

          <form
            method="post"
            action="/register">

            <label>
              نام کاربری
            </label>

            <input
              name="username"
              required>

            <label>
              رمز عبور
            </label>

            <input
              name="password"
              type="password"
              required>

            <button>
              ثبت نام
            </button>

          </form>

          <br>

          <a
            class="btn btn-gray"
            href="/login">
            ورود
          </a>

        </div>
        `
      )
    );
  }
);

app.post(
  "/register",
  (req, res) => {
    const username =
      String(
        req.body.username || ""
      ).trim();

    const password =
      String(
        req.body.password || ""
      );

    if (
      !username ||
      !password
    ) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام کاربری و رمز عبور
              الزامی است.
            </div>

            <a
              class="btn"
              href="/register">
              بازگشت
            </a>

          </div>
          `
        )
      );
    }

    const exists =
      db.users.some(
        user =>
          user.username
            .toLowerCase() ===
          username.toLowerCase()
      );

    if (exists) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              این نام کاربری قبلاً
              ثبت شده است.
            </div>

            <a
              class="btn"
              href="/register">
              بازگشت
            </a>

          </div>
          `
        )
      );
    }

    const user = {
      id: makeId(),
      username,
      password:
        hashPassword(
          password
        ),
      createdAt: Date.now()
    };

    db.users.push(user);

    saveDB();

    req.session.userId =
      user.id;

    logActivity(
      "panel",
      `👤 کاربر ${username} در پنل ثبت‌نام کرد.`
    );

    res.redirect(
      "/dashboard"
    );
  }
);

/* =========================
   LOGIN
========================= */

app.get(
  "/login",
  (req, res) => {
    res.send(
      page(
        "ورود",
        `
        <div class="card">

          <h2>
            🔑 ورود
          </h2>

          <form
            method="post"
            action="/login">

            <label>
              نام کاربری
            </label>

            <input
              name="username"
              required>

            <label>
              رمز عبور
            </label>

            <input
              name="password"
              type="password"
              required>

            <button>
              ورود
            </button>

          </form>

          <br>

          <a
            class="btn btn-green"
            href="/register">
            ثبت نام
          </a>

        </div>
        `
      )
    );
  }
);

app.post(
  "/login",
  (req, res) => {
    const username =
      String(
        req.body.username || ""
      ).trim();

    const password =
      String(
        req.body.password || ""
      );

    const user =
      db.users.find(
        item =>
          item.username
            .toLowerCase() ===
            username.toLowerCase() &&
          item.password ===
            hashPassword(
              password
            )
      );

    if (!user) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام کاربری یا رمز عبور
              اشتباه است.
            </div>

            <a
              class="btn"
              href="/login">
              بازگشت
            </a>

          </div>
          `
        )
      );
    }

    req.session.userId =
      user.id;

    logActivity(
      "panel",
      `🔑 کاربر ${user.username} وارد پنل شد.`
    );

    res.redirect(
      "/dashboard"
    );
  }
);

/* =========================
   LOGOUT
========================= */

app.get(
  "/logout",
  (req, res) => {
    req.session.destroy(
      () => {
        res.redirect("/");
      }
    );
  }
);

/* =========================
   DASHBOARD
========================= */

app.get(
  "/dashboard",
  requireLogin,
  (req, res) => {
    const user =
      findUser(req);

    const bots =
      db.bots.filter(
        bot =>
          String(
            bot.ownerId
          ) ===
          String(user.id)
      );

    const totalUsers =
      bots.reduce(
        (sum, bot) =>
          sum +
          Object.keys(
            db.botUsers[
              bot.id
            ] || {}
          ).length,
        0
      );

    const totalCommands =
      bots.reduce(
        (sum, bot) =>
          sum +
          Object.keys(
            db.commands[
              bot.id
            ] || {}
          ).length,
        0
      );

    const totalForceJoins =
      bots.reduce(
        (sum, bot) =>
          sum +
          (
            bot.forceJoins
              ?.length || 0
          ),
        0
      );

    const activities =
      db.activity
        .filter(item => {
          if (!item.botId) {
            return true;
          }

          const bot =
            bots.find(
              b =>
                b.id ===
                item.botId
            );

          return !!bot;
        })
        .slice(0, 15);

    let timeline = "";

    for (
      const activity of activities
    ) {
      timeline += `
        <div class="timeline-item">

          <div>
            ${escapeHtml(
              activity.text
            )}
          </div>

          <small>
            ${new Date(
              activity.time
            ).toLocaleString(
              "fa-IR"
            )}
          </small>

        </div>
      `;
    }

    res.send(
      page(
        "داشبورد",
        `
        <div class="hero">

          <h1>
            📊 داشبورد
          </h1>

          <p>
            سلام
            ${escapeHtml(
              user.username
            )}
            👋
          </p>

          <p>
            همه فعالیت‌های پنل و ربات‌ها
            را از اینجا مشاهده کنید.
          </p>

        </div>

        <div class="grid">

          <div class="stat">
            🤖 ربات‌ها
            <strong>
              ${bots.length}
            </strong>
          </div>

          <div class="stat">
            👥 کاربران
            <strong>
              ${totalUsers}
            </strong>
          </div>

          <div class="stat">
            ⚡ دستورات
            <strong>
              ${totalCommands}
            </strong>
          </div>

          <div class="stat">
            🔐 عضویت اجباری
            <strong>
              ${totalForceJoins}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            🎬 فعالیت‌های اخیر
          </h2>

          <div class="timeline">

            ${
              timeline ||
              `
              <div class="item">
                هنوز فعالیتی ثبت نشده است.
              </div>
              `
            }

          </div>

        </div>
        `
      )
    );
  }
);

/* =========================
   BOTS
========================= */

app.get(
  "/bots",
  requireLogin,
  (req, res) => {
    const bots =
      db.bots.filter(
        bot =>
          String(
            bot.ownerId
          ) ===
          String(
            req.session.userId
          )
      );

    let html = `
      <div class="card">

        <h1>
          🤖 ربات‌های من
        </h1>

        <a
          class="btn btn-green"
          href="/bots/add">
          ➕ افزودن ربات
        </a>

      </div>
    `;

    if (bots.length === 0) {
      html += `
        <div class="card">
          هنوز رباتی اضافه نکرده‌اید.
        </div>
      `;
    }

    for (
      const bot of bots
    ) {
      const userCount =
        Object.keys(
          db.botUsers[
            bot.id
          ] || {}
        ).length;

      html += `
        <div class="card">

          <span class="badge">
            ${escapeHtml(
              bot.username
                ? "@" +
                    bot.username
                : "ربات"
            )}
          </span>

          <h2>
            ${escapeHtml(
              bot.name ||
                "ربات بدون نام"
            )}
          </h2>

          <p>
            👥 کاربران:
            ${userCount}
          </p>

          <p>
            🔐 عضویت اجباری:
            ${
              bot.forceJoins
                ?.length || 0
            }
          </p>

          <a
            class="btn"
            href="/bots/${bot.id}">
            مدیریت ربات
          </a>

          <a
            class="btn btn-danger"
            href="/bots/delete/${bot.id}"
            onclick="return confirm('آیا از حذف ربات مطمئن هستید؟')">
            حذف
          </a>

        </div>
      `;
    }

    res.send(
      page(
        "ربات‌ها",
        html
      )
    );
  }
);

/* =========================
   ADD BOT
========================= */

app.get(
  "/bots/add",
  requireLogin,
  (req, res) => {
    res.send(
      page(
        "افزودن ربات",
        `
        <div class="card">

          <h1>
            ➕ افزودن ربات
          </h1>

          <div class="alert">
            توکن ربات را از
            BotFather دریافت کنید.
          </div>

          <form
            method="post"
            action="/bots/add">

            <label>
              نام ربات
            </label>

            <input
              name="name"
              placeholder="Nova Bot"
              required>

            <label>
              توکن ربات
            </label>

            <input
              name="token"
              placeholder="123456:ABC..."
              required>

            <button>
              افزودن ربات
            </button>

          </form>

        </div>
        `
      )
    );
  }
);

app.post(
  "/bots/add",
  requireLogin,
  async (req, res) => {
    const name =
      String(
        req.body.name || ""
      ).trim();

    const token =
      String(
        req.body.token || ""
      ).trim();

    if (!name || !token) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام و توکن الزامی است.
            </div>

            <a
              class="btn"
              href="/bots/add">
              بازگشت
            </a>

          </div>
          `
        )
      );
    }

    try {
      const me =
        await telegram(
          token,
          "getMe"
        );

      const bot = {
        id: makeId(),
        ownerId:
          req.session.userId,
        name,
        token,
        telegramId:
          me.id,
        username:
          me.username || "",
        firstName:
          me.first_name || "",
        forceJoins: [],
        forceJoinVerified: {},
        createdAt:
          Date.now()
      };

      db.bots.push(bot);

      db.botUsers[
        bot.id
      ] = {};

      db.commands[
        bot.id
      ] = {};

      saveDB();

      logActivity(
        "bot",
        `🤖 ربات «${name}» اضافه شد.`,
        bot.id
      );

      pollBot(bot);

      res.redirect(
        `/bots/${bot.id}`
      );
    } catch (error) {
      res.send(
        page(
          "خطای توکن",
          `
          <div class="card">

            <div class="alert error">
              توکن ربات معتبر نیست.
              <br><br>
              ${escapeHtml(
                error.message
              )}
            </div>

            <a
              class="btn"
              href="/bots/add">
              بازگشت
            </a>

          </div>
          `
        )
      );
    }
  }
);

/* =========================
   DELETE BOT
========================= */

app.get(
  "/bots/delete/:id",
  requireLogin,
  (req, res) => {
    const index =
      db.bots.findIndex(
        bot =>
          bot.id ===
            req.params.id &&
          String(
            bot.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (index === -1) {
      return res
        .status(404)
        .send("Bot not found");
    }

    const bot =
      db.bots[index];

    stopBotPolling(
      bot.id
    );

    db.bots.splice(
      index,
      1
    );

    delete db.botUsers[
      bot.id
    ];

    delete db.commands[
      bot.id
    ];

    saveDB();

    logActivity(
      "bot",
      `🗑️ ربات «${bot.name}» حذف شد.`
    );

    res.redirect(
      "/bots"
    );
  }
);

/* =========================
   BOT MAIN PAGE
========================= */

app.get(
  "/bots/:id",
  requireLogin,
  (req, res) => {
    const bot =
      db.bots.find(
        item =>
          item.id ===
            req.params.id &&
          String(
            item.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    ensureForceJoinState(
      bot
    );

    const commands =
      db.commands[
        bot.id
      ] || {};

    const users =
      db.botUsers[
        bot.id
      ] || {};

    res.send(
      page(
        bot.name,
        `
        <div class="hero">

          <h1>
            🤖 ${escapeHtml(
              bot.name
            )}
          </h1>

          <p>
            ${
              bot.username
                ? "@" +
                  escapeHtml(
                    bot.username
                  )
                : ""
            }
          </p>

        </div>

        <div class="grid">

          <div class="stat">
            👥 کاربران
            <strong>
              ${Object.keys(
                users
              ).length}
            </strong>
          </div>

          <div class="stat">
            ⚡ دستورات
            <strong>
              ${Object.keys(
                commands
              ).length}
            </strong>
          </div>

          <div class="stat">
            🔐 عضویت اجباری
            <strong>
              ${bot.forceJoins.length}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            مدیریت بخش‌های ربات
          </h2>

          <a
            class="btn"
            href="/commands?bot=${bot.id}">
            ⚡ دستورات
          </a>

          <a
            class="btn btn-green"
            href="/commands/add?bot=${bot.id}">
            ➕ افزودن دستور
          </a>

          <a
            class="btn btn-orange"
            href="/forcejoin?bot=${bot.id}">
            🔐 عضویت اجباری
          </a>

          <a
            class="btn"
            href="/users?bot=${bot.id}">
            👥 کاربران
          </a>

          <a
            class="btn btn-green"
            href="/broadcast?bot=${bot.id}">
            📢 ارسال به همه
          </a>

        </div>
        `
      )
    );
  }
);

/* =========================
   FORCE JOIN PAGE
========================= */

app.get(
  "/forcejoin",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    ensureForceJoinState(
      bot
    );

    let list = "";

    for (
      let i = 0;
      i <
      bot.forceJoins.length;
      i++
    ) {
      const join =
        bot.forceJoins[i];

      list += `
        <div class="item">

          <strong>
            📢 ${escapeHtml(
              join.title ||
                join.username
            )}
          </strong>

          <p>
            ${escapeHtml(
              join.username
            )}
          </p>

          <a
            class="btn btn-danger"
            href="/forcejoin/delete?bot=${bot.id}&index=${i}"
            onclick="return confirm('حذف شود؟')">
            حذف
          </a>

        </div>
      `;
    }

    res.send(
      page(
        "عضویت اجباری",
        `
        <div class="card">

          <h1>
            🔐 عضویت اجباری
          </h1>

          <div class="alert">
            این قابلیت فقط هنگام
            <strong>/start</strong>
            اجرا می‌شود.
            <br><br>
            کاربر بعد از تأیید موفق،
            برای همان مورد دوباره
            درخواست عضویت نمی‌گیرد.
          </div>

          <form
            method="post"
            action="/forcejoin/add">

            <input
              type="hidden"
              name="bot"
              value="${escapeHtml(
                bot.id
              )}">

            <label>
              لینک عمومی کانال یا گروه
            </label>

            <input
              name="link"
              placeholder="https://t.me/example"
              required>

            <button>
              ➕ افزودن
            </button>

          </form>

        </div>

        <div class="card">

          <h2>
            موارد فعال
          </h2>

          ${
            list ||
            "<p>عضویت اجباری تنظیم نشده است.</p>"
          }

        </div>
        `
      ),
      bot.id
    );
  }
);

app.post(
  "/forcejoin/add",
  requireLogin,
  async (req, res) => {
    const botId =
      String(
        req.body.bot || ""
      );

    const link =
      String(
        req.body.link || ""
      ).trim();

    const bot =
      db.bots.find(
        item =>
          item.id === botId &&
          String(
            item.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    ensureForceJoinState(
      bot
    );

    if (
      bot.forceJoins.length >=
      5
    ) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              حداکثر ۵ مورد قابل تنظیم است.
            </div>

            <a
              class="btn"
              href="/forcejoin?bot=${bot.id}">
              بازگشت
            </a>

          </div>
          `,
          bot.id
        )
      );
    }

    try {
      const parsed =
        parsePublicTelegramLink(
          link
        );

      const chat =
        await telegram(
          bot.token,
          "getChat",
          {
            chat_id:
              parsed.username
          }
        );

      if (
        ![
          "channel",
          "supergroup",
          "group"
        ].includes(
          chat.type
        )
      ) {
        throw new Error(
          "لینک باید مربوط به کانال یا گروه باشد."
        );
      }

      const isAdmin =
        await checkBotAdminInChat(
          bot,
          parsed.username
        );

      if (!isAdmin) {
        throw new Error(
          "ربات در این کانال یا گروه ادمین نیست."
        );
      }

      const exists =
        bot.forceJoins.some(
          join =>
            String(
              join.username
            ).toLowerCase() ===
            String(
              parsed.username
            ).toLowerCase()
        );

      if (exists) {
        throw new Error(
          "این کانال یا گروه قبلاً اضافه شده است."
        );
      }

      const join = {
        id: makeId(),
        username:
          parsed.username,
        link:
          parsed.link,
        title:
          chat.title ||
          parsed.username,
        type:
          chat.type,
        addedAt:
          Date.now()
      };

      bot.forceJoins.push(
        join
      );

      saveDB();

      logActivity(
        "forcejoin",
        `🔐 عضویت اجباری «${join.title}» برای ربات «${bot.name}» فعال شد.`,
        bot.id
      );

      res.redirect(
        `/forcejoin?bot=${bot.id}`
      );
    } catch (error) {
      res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              ${escapeHtml(
                error.message
              )}
            </div>

            <a
              class="btn"
              href="/forcejoin?bot=${bot.id}">
              بازگشت
            </a>

          </div>
          `,
          bot.id
        )
      );
    }
  }
);

app.get(
  "/forcejoin/delete",
  requireLogin,
  (req, res) => {
    const bot =
      db.bots.find(
        item =>
          item.id ===
            String(
              req.query.bot ||
                ""
            ) &&
          String(
            item.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    ensureForceJoinState(
      bot
    );

    const index =
      Number(
        req.query.index
      );

    if (
      !Number.isInteger(
        index
      ) ||
      index < 0 ||
      index >=
        bot.forceJoins.length
    ) {
      return res
        .status(400)
        .send(
          "Invalid index"
        );
    }

    const removed =
      bot.forceJoins[
        index
      ];

    bot.forceJoins.splice(
      index,
      1
    );

    saveDB();

    logActivity(
      "forcejoin",
      `🗑️ عضویت اجباری «${removed.title || removed.username}» حذف شد.`,
      bot.id
    );

    res.redirect(
      `/forcejoin?bot=${bot.id}`
    );
  }
);

/* =========================
   COMMANDS PAGE
========================= */

app.get(
  "/commands",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    const commands =
      db.commands[
        bot.id
      ] || {};

    let list = "";

    for (
      const name of Object.keys(
        commands
      )
    ) {
      const command =
        commands[name];

      const response =
        typeof command ===
        "string"
          ? command
          : command.response ||
            "";

      list += `
        <div class="item">

          <h3>
            ⚡ /${escapeHtml(
              name
            )}
          </h3>

          <p>
            ${escapeHtml(
              response
            )}
          </p>

          <a
            class="btn btn-danger"
            href="/commands/delete?bot=${bot.id}&command=${encodeURIComponent(name)}"
            onclick="return confirm('این دستور حذف شود؟')">
            حذف
          </a>

        </div>
      `;
    }

    res.send(
      page(
        "دستورات",
        `
        <div class="card">

          <h1>
            ⚡ دستورات
          </h1>

          <a
            class="btn btn-green"
            href="/commands/add?bot=${bot.id}">
            ➕ افزودن دستور
          </a>

        </div>

        <div class="card">

          ${
            list ||
            "<p>هنوز دستوری اضافه نشده است.</p>"
          }

        </div>
        `,
        bot.id
      )
    );
  }
);

/* =========================
   ADD COMMAND
========================= */

app.get(
  "/commands/add",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    res.send(
      page(
        "افزودن دستور",
        `
        <div class="card">

          <h1>
            ➕ افزودن دستور
          </h1>

          <form
            method="post"
            action="/commands/add">

            <input
              type="hidden"
              name="bot"
              value="${escapeHtml(
                bot.id
              )}">

            <label>
              نام دستور بدون /
            </label>

            <input
              name="command"
              placeholder="start"
              required>

            <label>
              پاسخ ربات
            </label>

            <textarea
              name="response"
              placeholder="متن پاسخ ربات..."
              required></textarea>

            <button>
              💾 ذخیره دستور
            </button>

          </form>

        </div>
        `,
        bot.id
      )
    );
  }
);

app.post(
  "/commands/add",
  requireLogin,
  (req, res) => {
    const botId =
      String(
        req.body.bot || ""
      );

    const command =
      String(
        req.body.command ||
          ""
      )
        .trim()
        .replace(
          /^\/+/,
          ""
        )
        .replace(
          /[^a-zA-Z0-9_]/g,
          ""
        );

    const response =
      String(
        req.body.response ||
          ""
      );

    const bot =
      db.bots.find(
        item =>
          item.id ===
            botId &&
          String(
            item.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    if (!command) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام دستور نامعتبر است.
            </div>

            <a
              class="btn"
              href="/commands/add?bot=${bot.id}">
              بازگشت
            </a>

          </div>
          `,
          bot.id
        )
      );
    }

    if (
      !db.commands[
        bot.id
      ]
    ) {
      db.commands[
        bot.id
      ] = {};
    }

    db.commands[
      bot.id
    ][command] = {
      response,
      createdAt:
        Date.now()
    };

    saveDB();

    logActivity(
      "command",
      `➕ دستور /${command} برای ربات «${bot.name}» اضافه شد.`,
      bot.id
    );

    res.redirect(
      `/commands?bot=${bot.id}`
    );
  }
);

/* =========================
   DELETE COMMAND
========================= */

app.get(
  "/commands/delete",
  requireLogin,
  (req, res) => {
    const botId =
      String(
        req.query.bot || ""
      );

    const command =
      String(
        req.query.command ||
          ""
      );

    const bot =
      db.bots.find(
        item =>
          item.id ===
            botId &&
          String(
            item.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    if (
      db.commands[
        bot.id
      ]
    ) {
      delete db.commands[
        bot.id
      ][command];
    }

    saveDB();

    logActivity(
      "command",
      `🗑️ دستور /${command} از ربات «${bot.name}» حذف شد.`,
      bot.id
    );

    res.redirect(
      `/commands?bot=${bot.id}`
    );
  }
);

/* =========================
   USERS / STATISTICS
========================= */

app.get(
  "/users",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    const users =
      db.botUsers[
        bot.id
      ] || {};

    const userArray =
      Object.values(users)
        .sort(
          (a, b) =>
            (b.updatedAt || 0) -
            (a.updatedAt || 0)
        );

    let list = "";

    for (
      const user of userArray
    ) {
      const fullName =
        [
          user.first_name,
          user.last_name
        ]
          .filter(Boolean)
          .join(" ") ||
        "بدون نام";

      list += `
        <div class="timeline-item">

          <strong>
            👤 ${escapeHtml(
              fullName
            )}
          </strong>

          ${
            user.username
              ? `
              <p>
                @${escapeHtml(
                  user.username
                )}
              </p>
              `
              : ""
          }

          <small>
            ID:
            ${escapeHtml(
              user.id
            )}
            <br>
            آخرین فعالیت:
            ${new Date(
              user.updatedAt
            ).toLocaleString(
              "fa-IR"
            )}
          </small>

        </div>
      `;
    }

    res.send(
      page(
        "آمار کاربران",
        `
        <div class="hero">

          <h1>
            👥 آمار کاربران
          </h1>

          <p>
            ربات:
            ${escapeHtml(
              bot.name
            )}
          </p>

        </div>

        <div class="grid">

          <div class="stat">
            👥 کل کاربران
            <strong>
              ${userArray.length}
            </strong>
          </div>

          <div class="stat">
            🟢 کاربران فعال
            <strong>
              ${userArray.filter(
                u =>
                  Date.now() -
                    (u.updatedAt ||
                      0) <
                  24 *
                    60 *
                    60 *
                    1000
              ).length}
            </strong>
          </div>

          <div class="stat">
            📅 کاربران هفته
            <strong>
              ${userArray.filter(
                u =>
                  Date.now() -
                    (u.createdAt ||
                      0) <
                  7 *
                    24 *
                    60 *
                    60 *
                    1000
              ).length}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            🎬 فید کاربران
          </h2>

          <div class="timeline">

            ${
              list ||
              "<p>هنوز کاربری وارد ربات نشده است.</p>"
            }

          </div>

        </div>
        `,
        bot.id
      )
    );
  }
);

/* =========================
   BROADCAST
   TEXT + PHOTO + VIDEO
========================= */

app.get(
  "/broadcast",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res
        .status(404)
        .send("Bot not found");
    }

    const userCount =
      Object.keys(
        db.botUsers[
          bot.id
        ] || {}
      ).length;

    res.send(
      page(
        "ارسال پیام",
        `
        <div class="card">

          <h1>
            📢 ارسال پیام به همه کاربران
          </h1>

          <div class="alert">
            تعداد دریافت‌کنندگان:
            <strong>
              ${userCount}
            </strong>
            <br><br>
            می‌توانید متن، عکس یا ویدیو
            ارسال کنید.
          </div>

          <form
            method="post"
            action="/broadcast"
            enctype="multipart/form-data">

            <input
              type="hidden"
              name="bot"
              value="${escapeHtml(
                bot.id
              )}">

            <label>
              نوع پیام
            </label>

            <select
              name="type"
              id="broadcastType"
              onchange="changeBroadcastType()">

              <option value="text">
                📝 متن
              </option>

              <option value="photo">
                🖼️ عکس
              </option>

              <option value="video">
                🎥 ویدیو
              </option>

            </select>

            <div id="textBox">

              <label>
                متن پیام
              </label>

              <textarea
                name="text"
                placeholder="متن پیام برای کاربران..."></textarea>

            </div>

            <div
              id="fileBox"
              style="display:none">

              <label>
                فایل عکس یا ویدیو
              </label>

              <input
                type="file"
                name="media"
                accept="image/*,video/*">

              <label>
                کپشن
              </label>

              <textarea
                name="caption"
                placeholder="کپشن..."></textarea>

            </div>

            <button>
              📢 ارسال به همه کاربران
            </button>

          </form>

        </div>

        <script>

        function changeBroadcastType() {

          const type =
            document.getElementById(
              "broadcastType"
            ).value;

          const textBox =
            document.getElementById(
              "textBox"
            );

          const fileBox =
            document.getElementById(
              "fileBox"
            );

          if (type === "text") {
            textBox.style.display =
              "block";

            fileBox.style.display =
              "none";
          } else {
            textBox.style.display =
              "none";

            fileBox.style.display =
              "block";
          }

        }

        </script>
        `,
        bot.id
      )
    );
  }
);

app.post(
  "/broadcast",
  requireLogin,
  upload.single("media"),
  async (req, res) => {
    const bot =
      db.bots.find(
        item =>
          item.id ===
            String(
              req.body.bot ||
                ""
            ) &&
          String(
            item.ownerId
          ) ===
            String(
              req.session.userId
            )
      );

    if (!bot) {
      if (req.file) {
        fs.unlinkSync(
          req.file.path
        );
      }

      return res
        .status(404)
        .send("Bot not found");
    }

    const type =
      String(
        req.body.type ||
          "text"
      );

    const text =
      String(
        req.body.text ||
          ""
      );

    const caption =
      String(
        req.body.caption ||
          ""
      );

    const users =
      db.botUsers[
        bot.id
      ] || {};

    const userIds =
      Object.keys(users);

    let success = 0;
    let failed = 0;

    if (
      type === "text" &&
      !text.trim()
    ) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              متن پیام را وارد کنید.
            </div>

            <a
              class="btn"
              href="/broadcast?bot=${bot.id}">
              بازگشت
            </a>

          </div>
          `,
          bot.id
        )
      );
    }

    if (
      (type === "photo" ||
        type === "video") &&
      !req.file
    ) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              فایل را انتخاب کنید.
            </div>

            <a
              class="btn"
              href="/broadcast?bot=${bot.id}">
              بازگشت
            </a>

          </div>
          `,
          bot.id
        )
      );
    }

    for (
      const userId of userIds
    ) {
      try {
        if (type === "text") {
          await telegram(
            bot.token,
            "sendMessage",
            {
              chat_id:
                userId,
              text
            }
          );
        } else {
          const fileBuffer =
            fs.readFileSync(
              req.file.path
            );

          const blob =
            new Blob(
              [
                fileBuffer
              ],
              {
                type:
                  req.file.mimetype
              }
            );

          const form =
            new FormData();

          form.append(
            "chat_id",
            userId
          );

          form.append(
            type === "photo"
              ? "photo"
              : "video",
            blob,
            req.file.originalname
          );

          if (
            caption.trim()
          ) {
            form.append(
              "caption",
              caption
            );
          }

          const response =
            await fetch(
              telegramUrl(
                bot.token,
                type ===
                  "photo"
                  ? "sendPhoto"
                  : "sendVideo"
              ),
              {
                method:
                  "POST",
                body: form
              }
            );

          const data =
            await response.json();

          if (!data.ok) {
            throw new Error(
              data.description ||
                "ارسال ناموفق"
            );
          }
        }

        success++;

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              40
            )
        );
      } catch (error) {
        failed++;

        console.error(
          "Broadcast error:",
          error.message
        );
      }
    }

    if (req.file) {
      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {}
    }

    logActivity(
      "broadcast",
      `📢 ارسال ${type === "text" ? "متن" : type === "photo" ? "عکس" : "ویدیو"} به ${success} کاربر در ربات «${bot.name}» انجام شد.`,
      bot.id
    );

    res.send(
      page(
        "نتیجه ارسال",
        `
        <div class="card">

          <h1>
            📢 نتیجه ارسال
          </h1>

          <div class="grid">

            <div class="stat">
              ✅ موفق
              <strong>
                ${success}
              </strong>
            </div>

            <div class="stat">
              ❌ ناموفق
              <strong>
                ${failed}
              </strong>
            </div>

          </div>

          <br>

          <a
            class="btn"
            href="/broadcast?bot=${bot.id}">
            بازگشت
          </a>

        </div>
        `,
        bot.id
      )
    );
  }
);

/* =========================
   SETTINGS
========================= */

app.get(
  "/settings",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    res.send(
      page(
        "تنظیمات",
        `
        <div class="card">

          <h1>
            ⚙️ تنظیمات ظاهر
          </h1>

          <p>
            انتخاب حالت صفحه:
          </p>

          <button
            onclick="setTheme('light')">
            ☀️ روشن
          </button>

          <button
            onclick="setTheme('dark')">
            🌙 تاریک
          </button>

        </div>

        <script>

        function setTheme(theme) {

          if (theme === "dark") {
            document.body.classList.add(
              "dark"
            );
          } else {
            document.body.classList.remove(
              "dark"
            );
          }

          localStorage.setItem(
            "nova-theme",
            theme
          );

        }

        </script>
        `,
        bot?.id || ""
      )
    );
  }
);

/* =========================
   CREATOR LOGIN
========================= */

app.get(
  "/creator/login",
  (req, res) => {
    res.send(
      page(
        "ورود سازنده",
        `
        <div class="card">

          <h1>
            🔐 ورود سازنده
          </h1>

          <form
            method="post"
            action="/creator/login">

            <label>
              رمز سازنده
            </label>

            <input
              name="password"
              type="password"
              placeholder="رمز سازنده"
              required>

            <button>
              🔐 ورود
            </button>

          </form>

        </div>
        `
      )
    );
  }
);

app.post(
  "/creator/login",
  (req, res) => {
    const password =
      String(
        req.body.password ||
          ""
      );

    if (
      password !==
      ADMIN_PASSWORD
    ) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              رمز سازنده اشتباه است.
            </div>

            <a
              class="btn"
              href="/creator/login">
              بازگشت
            </a>

          </div>
          `
        )
      );
    }

    req.session.creator =
      true;

    res.redirect(
      "/creator"
    );
  }
);

/* =========================
   CREATOR PANEL
========================= */

app.get(
  "/creator",
  requireCreator,
  (req, res) => {
    let bots = "";

    for (
      const bot of db.bots
    ) {
      bots += `
        <div class="item">

          <h3>
            🤖 ${escapeHtml(
              bot.name
            )}
          </h3>

          <p>
            مالک:
            ${escapeHtml(
              bot.ownerId
            )}
          </p>

          <p>
            یوزرنیم:
            ${
              bot.username
                ? "@" +
                  escapeHtml(
                    bot.username
                  )
                : "-"
            }
          </p>

          <p>
            👥 کاربران:
            ${
              Object.keys(
                db.botUsers[
                  bot.id
                ] || {}
              ).length
            }
          </p>

          <p>
            🔐 عضویت اجباری:
            ${
              bot.forceJoins
                ?.length || 0
            }
          </p>

          <p>
            ⚡ دستورات:
            ${
              Object.keys(
                db.commands[
                  bot.id
                ] || {}
              ).length
            }
          </p>

        </div>
      `;
    }

    res.send(
      page(
        "پنل سازنده",
        `
        <div class="hero">

          <h1>
            👑 پنل سازنده
          </h1>

          <p>
            مدیریت کلی سیستم
          </p>

          <a
            class="btn btn-danger"
            href="/creator/logout">
            خروج سازنده
          </a>

        </div>

        <div class="grid">

          <div class="stat">
            👤 کاربران پنل
            <strong>
              ${db.users.length}
            </strong>
          </div>

          <div class="stat">
            🤖 ربات‌ها
            <strong>
              ${db.bots.length}
            </strong>
          </div>

          <div class="stat">
            👥 کاربران ربات‌ها
            <strong>
              ${db.bots.reduce(
                (sum, bot) =>
                  sum +
                  Object.keys(
                    db.botUsers[
                      bot.id
                    ] || {}
                  ).length,
                0
              )}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            🤖 همه ربات‌ها
          </h2>

          ${
            bots ||
            "<p>رباتی وجود ندارد.</p>"
          }

        </div>
        `
      )
    );
  }
);

app.get(
  "/creator/logout",
  (req, res) => {
    req.session.creator =
      false;

    res.redirect(
      "/"
    );
  }
);

/* =========================
   HEALTH
========================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "nova-proxy",
      bots:
        db.bots.length,
      users:
        db.users.length,
      time:
        new Date().toISOString()
    });
  }
);

/* =========================
   404
========================= */

app.use(
  (req, res) => {
    res
      .status(404)
      .send(
        page(
          "404",
          `
          <div class="card">

            <h1>
              404
            </h1>

            <p>
              صفحه موردنظر پیدا نشد.
            </p>

            <a
              class="btn"
              href="/">
              صفحه اصلی
            </a>

          </div>
          `
        )
      );
  }
);

/* =========================
   ERROR
========================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Express error:",
      error
    );

    res
      .status(500)
      .send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              خطای داخلی سرور.
              <br><br>
              ${escapeHtml(
                error.message ||
                  ""
              )}
            </div>

          </div>
          `
        )
      );
  }
);

/* =========================
   START
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Nova Proxy running on port ${PORT}`
    );

    startAllBots();
  }
);
