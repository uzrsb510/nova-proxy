const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "mmkk1122";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "nova-proxy-secret-2026";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(
  DATA_DIR,
  "data.json"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function makeId() {
  return crypto
    .randomBytes(12)
    .toString("hex");
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

function normalizeDB(data) {
  if (!data || typeof data !== "object") {
    data = defaultDB();
  }

  if (!Array.isArray(data.users)) {
    data.users = [];
  }

  if (!Array.isArray(data.bots)) {
    data.bots = [];
  }

  if (
    !data.botUsers ||
    typeof data.botUsers !== "object"
  ) {
    data.botUsers = {};
  }

  if (
    !data.commands ||
    typeof data.commands !== "object"
  ) {
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
      bot.forceJoins = [];
    }

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
        fs.readFileSync(
          DATA_FILE,
          "utf8"
        )
      )
    );
  } else {
    db = defaultDB();

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        db,
        null,
        2
      ),
      "utf8"
    );
  }
} catch (error) {
  console.error(
    "Database error:",
    error
  );

  db = defaultDB();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      db,
      null,
      2
    ),
    "utf8"
  );
}

function saveDB() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      db,
      null,
      2
    ),
    "utf8"
  );
}

function addActivity(
  type,
  text,
  botId = null
) {
  db.activity.unshift({
    id: makeId(),
    type,
    text,
    botId,
    createdAt: Date.now()
  });

  if (db.activity.length > 500) {
    db.activity =
      db.activity.slice(0, 500);
  }

  saveDB();
}

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge:
        1000 *
        60 *
        60 *
        24 *
        30,
      httpOnly: true
    }
  })
);

/* =========================
   HELPERS
========================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function requireLogin(
  req,
  res,
  next
) {
  if (!req.session.userId) {
    return res.redirect(
      "/login"
    );
  }

  next();
}

function requireCreator(
  req,
  res,
  next
) {
  if (!req.session.creator) {
    return res.redirect(
      "/creator/login"
    );
  }

  next();
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

/* =========================
   TELEGRAM API
========================= */

function telegramUrl(
  token,
  method
) {
  return (
    `https://api.telegram.org/bot` +
    `${token}/${method}`
  );
}

async function telegram(
  token,
  method,
  body = {}
) {
  const response =
    await fetch(
      telegramUrl(
        token,
        method
      ),
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(
          body
        )
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      "پاسخ Telegram نامعتبر بود."
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
  replyMarkup = null
) {
  const body = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup =
      replyMarkup;
  }

  return telegram(
    bot.token,
    "sendMessage",
    body
  );
}

async function sendTelegramPhoto(
  bot,
  chatId,
  photo,
  caption = ""
) {
  const body = {
    chat_id: chatId,
    photo
  };

  if (caption) {
    body.caption =
      caption;
  }

  return telegram(
    bot.token,
    "sendPhoto",
    body
  );
}

async function sendTelegramVideo(
  bot,
  chatId,
  video,
  caption = ""
) {
  const body = {
    chat_id: chatId,
    video
  };

  if (caption) {
    body.caption =
      caption;
  }

  return telegram(
    bot.token,
    "sendVideo",
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
        message_id:
          messageId
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

function ensureForceJoinState(
  bot
) {
  if (
    !Array.isArray(
      bot.forceJoins
    )
  ) {
    bot.forceJoins = [];
  }

  if (
    !bot.forceJoinVerified ||
    typeof bot.forceJoinVerified !==
      "object" ||
    Array.isArray(
      bot.forceJoinVerified
    )
  ) {
    bot.forceJoinVerified = {};
  }

  let changed = false;

  for (
    const join of bot.forceJoins
  ) {
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

  const key =
    String(userId);

  if (
    !bot.forceJoinVerified[
      key
    ]
  ) {
    bot.forceJoinVerified[
      key
    ] = {};
  }

  return bot.forceJoinVerified[
    key
  ];
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

  verified[
    String(joinId)
  ] = true;
}

async function checkMembership(
  bot,
  username,
  userId
) {
  try {
    const member =
      await telegram(
        bot.token,
        "getChatMember",
        {
          chat_id:
            username,
          user_id:
            userId
        }
      );

    if (
      member.status ===
        "creator" ||
      member.status ===
        "administrator" ||
      member.status ===
        "member"
    ) {
      return true;
    }

    if (
      member.status ===
        "restricted" &&
      member.is_member ===
        true
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

async function checkAllMemberships(
  bot,
  userId
) {
  ensureForceJoinState(
    bot
  );

  const unverified =
    getUnverifiedJoins(
      bot,
      userId
    );

  /*
    اگر همه موارد قبلاً تأیید شده‌اند
    دیگر Telegram را برای آنها بررسی نمی‌کنیم.
  */
  if (
    unverified.length === 0
  ) {
    return {
      ok: true
    };
  }

  let changed = false;

  for (
    const join of unverified
  ) {
    const isMember =
      await checkMembership(
        bot,
        join.username,
        userId
      );

    if (!isMember) {
      if (changed) {
        saveDB();
      }

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

    changed = true;
  }

  if (changed) {
    saveDB();
  }

  return {
    ok: true
  };
}

function parsePublicTelegramLink(
  input
) {
  let value =
    String(
      input || ""
    ).trim();

  if (!value) {
    throw new Error(
      "لینک را وارد کنید."
    );
  }

  if (
    !/^https?:\/\//i.test(
      value
    )
  ) {
    value =
      "https://" +
      value;
  }

  let url;

  try {
    url =
      new URL(value);
  } catch {
    throw new Error(
      "لینک معتبر نیست."
    );
  }

  if (
    url.hostname !==
      "t.me" &&
    url.hostname !==
      "telegram.me"
  ) {
    throw new Error(
      "فقط لینک عمومی t.me قابل استفاده است."
    );
  }

  const username =
    url.pathname
      .replace(
        /^\/+/,
        ""
      )
      .split("/")[0]
      .trim();

  if (
    !username ||
    username.startsWith(
      "+"
    )
  ) {
    throw new Error(
      "لینک دعوت خصوصی قابل استفاده نیست."
    );
  }

  const clean =
    username.replace(
      /^@/,
      ""
    );

  return {
    username:
      "@" + clean,
    link:
      "https://t.me/" +
      clean
  };
}

async function checkBotAdminInChat(
  bot,
  chatUsername
) {
  const me =
    await telegram(
      bot.token,
      "getMe"
    );

  const member =
    await telegram(
      bot.token,
      "getChatMember",
      {
        chat_id:
          chatUsername,
        user_id:
          me.id
      }
    );

  return (
    member.status ===
      "administrator" ||
    member.status ===
      "creator"
  );
}

async function sendJoinMessage(
  bot,
  chatId
) {
  const buttons = [];

  for (
    const join of bot.forceJoins
  ) {
    buttons.push([
      {
        text:
          "📢 " +
          (
            join.title ||
            join.username
          ),
        url:
          join.link
      }
    ]);
  }

  buttons.push([
    {
      text:
        "✅ بررسی عضویت",
      callback_data:
        "check_join_start"
    }
  ]);

  await sendTelegramMessage(
    bot,
    chatId,
    "🔐 عضویت اجباری\n\n" +
      "برای استفاده از ربات ابتدا باید در کانال یا گروه زیر عضو شوید.\n\n" +
      "ابتدا عضو شوید و سپس روی «بررسی عضویت» بزنید.",
    {
      inline_keyboard:
        buttons
    }
  );
}

/* =========================
   COMMAND
========================= */

function getCommandNameFromText(
  text
) {
  if (
    !text ||
    typeof text !==
      "string"
  ) {
    return null;
  }

  if (
    !text.startsWith("/")
  ) {
    return null;
  }

  const first =
    text
      .trim()
      .split(
        /\s+/
      )[0];

  let command =
    first
      .substring(1)
      .split("@")[0]
      .trim();

  command =
    command.replace(
      /[^a-zA-Z0-9_]/g,
      ""
    );

  return (
    command || null
  );
}

async function executeCommand(
  bot,
  chatId,
  text
) {
  const commandName =
    getCommandNameFromText(
      text
    );

  if (!commandName) {
    return false;
  }

  const commands =
    db.commands[
      bot.id
    ] || {};

  const command =
    commands[
      commandName
    ];

  if (!command) {
    return false;
  }

  const response =
    typeof command ===
    "string"
      ? command
      : command.response ||
        "";

  if (!response) {
    return false;
  }

  await sendTelegramMessage(
    bot,
    chatId,
    response
  );

  addActivity(
    "command",
    `دستور /${commandName} اجرا شد.`,
    bot.id
  );

  return true;
}

/* =========================
   START
========================= */

async function handleStart(
  bot,
  message
) {
  const userId =
    message.from.id;

  const chatId =
    message.chat.id;

  ensureForceJoinState(
    bot
  );

  /*
    اگر هیچ عضویت اجباری وجود ندارد:
    مستقیم /start اجرا شود.
  */
  if (
    !bot.forceJoins ||
    bot.forceJoins.length ===
      0
  ) {
    await executeCommand(
      bot,
      chatId,
      "/start"
    );

    return;
  }

  /*
    بررسی واقعی عضویت کاربر.
  */
  const result =
    await checkAllMemberships(
      bot,
      userId
    );

  /*
    اگر عضو نیست:
    فقط پیام عضویت نمایش داده شود
    و /start اجرا نشود.
  */
  if (!result.ok) {
    await sendJoinMessage(
      bot,
      chatId
    );

    return;
  }

  /*
    عضویت تأیید شده:
    اجرای خودکار /start
  */
  await executeCommand(
    bot,
    chatId,
    "/start"
  );
}

/* =========================
   CALLBACK
========================= */

async function handleCallback(
  bot,
  callback
) {
  const data =
    String(
      callback.data || ""
    );

  if (
    data !==
    "check_join_start"
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
    /*
      دوباره عضویت واقعی بررسی می‌شود.
    */
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
            "❌ شما هنوز عضو کانال یا گروه نیستید.",

          show_alert:
            true
        }
      );

      return;
    }

    /*
      تأیید موفق
    */
    await telegram(
      bot.token,
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,

        text:
          "✅ عضویت شما تأیید شد.",

        show_alert:
          false
      }
    );

    /*
      حذف پیام عضویت
    */
    if (
      callback.message
        ?.message_id
    ) {
      await deleteTelegramMessage(
        bot,
        chatId,
        callback.message
          .message_id
      );
    }

    /*
      اجرای خودکار /start
    */
    await executeCommand(
      bot,
      chatId,
      "/start"
    );

  } catch (error) {
    console.error(
      "Force Join Callback:",
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

          show_alert:
            true
        }
      );
    } catch {}
  }
}

/* =========================
   UPDATE
========================= */

function saveBotUser(
  bot,
  telegramUser
) {
  if (
    !telegramUser ||
    !telegramUser.id
  ) {
    return;
  }

  if (
    !db.botUsers[
      bot.id
    ]
  ) {
    db.botUsers[
      bot.id
    ] = {};
  }

  const key =
    String(
      telegramUser.id
    );

  const old =
    db.botUsers[
      bot.id
    ][key];

  const isNew =
    !old;

  db.botUsers[
    bot.id
  ][key] = {
    id:
      telegramUser.id,

    first_name:
      telegramUser.first_name ||
      "",

    last_name:
      telegramUser.last_name ||
      "",

    username:
      telegramUser.username ||
      "",

    language_code:
      telegramUser.language_code ||
      "",

    createdAt:
      old?.createdAt ||
      Date.now(),

    updatedAt:
      Date.now()
  };

  saveDB();

  if (isNew) {
    addActivity(
      "user",
      `کاربر جدید ${telegramUser.id} وارد ربات شد.`,
      bot.id
    );
  }
}

async function handleUpdate(
  bot,
  update
) {
  /*
    Callback مربوط به
    بررسی عضویت
  */
  if (
    update.callback_query
  ) {
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

  if (!message.from) {
    return;
  }

  if (!message.chat) {
    return;
  }

  saveBotUser(
    bot,
    message.from
  );

  const commandName =
    getCommandNameFromText(
      message.text
    );

  /*
    بسیار مهم:
    عضویت اجباری فقط روی /start
    اجرا می‌شود.
  */
  if (
    commandName === "start"
  ) {
    await handleStart(
      bot,
      message
    );

    return;
  }

  /*
    دستورات دیگر بدون
    بررسی عضویت اجرا می‌شوند.
  */
  if (message.text) {
    await executeCommand(
      bot,
      message.chat.id,
      message.text
    );
  }
}

/* =========================
   POLLING
========================= */

const pollingState =
  new Map();

async function pollBot(
  bot
) {
  if (!bot?.token) {
    return;
  }

  if (
    pollingState.get(
      bot.id
    )?.running
  ) {
    return;
  }

  const old =
    pollingState.get(
      bot.id
    );

  const state = {
    running: true,
    offset:
      old?.offset || 0
  };

  pollingState.set(
    bot.id,
    state
  );

  try {
    await telegram(
      bot.token,
      "getMe"
    );
  } catch (error) {
    console.error(
      `Bot ${bot.id}:`,
      error.message
    );

    state.running =
      false;

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
          b.id ===
          bot.id
      );

    if (!currentBot) {
      state.running =
        false;

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

      for (
        const update of updates
      ) {
        state.offset =
          update.update_id +
          1;

        try {
          await handleUpdate(
            currentBot,
            update
          );
        } catch (error) {
          console.error(
            "Update error:",
            error
          );
        }
      }
    } catch (error) {
      console.error(
        "Polling error:",
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
      300
    );
  }

  loop();
}

function startAllBots() {
  for (
    const bot of db.bots
  ) {
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
    state.running =
      false;

    pollingState.delete(
      botId
    );
  }
}

/* =========================
   UI
========================= */

function page(
  req,
  title,
  content,
  botId = ""
) {
  const loggedIn =
    !!req.session.userId;

  const botQuery =
    botId
      ? `?bot=${encodeURIComponent(
          botId
        )}`
      : "";

  const selectedMenu =
    botId
      ? `
        <div class="menu-title">
          ⚙️ مدیریت ربات
        </div>

        <a
          class="menu-item"
          href="/forcejoin${botQuery}">
          🔐 عضویت اجباری
        </a>

        <a
          class="menu-item"
          href="/broadcast${botQuery}">
          📢 ارسال پیام به همه کاربران
        </a>

        <a
          class="menu-item"
          href="/commands/add${botQuery}">
          ➕ افزودن دستور
        </a>

        <a
          class="menu-item"
          href="/commands${botQuery}">
          ⚡ دستورات
        </a>

        <a
          class="menu-item"
          href="/users${botQuery}">
          👥 آمار کاربران
        </a>
      `
      : `
        <div class="menu-disabled">
          🔐 عضویت اجباری
        </div>

        <div class="menu-disabled">
          📢 ارسال پیام به همه کاربران
        </div>

        <div class="menu-disabled">
          ➕ افزودن دستور
        </div>

        <div class="menu-disabled">
          ⚡ دستورات
        </div>

        <div class="menu-disabled">
          👥 آمار کاربران
        </div>
      `;

  return `
<!DOCTYPE html>

<html
  lang="fa"
  dir="rtl"
>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0"
>

<title>
${escapeHtml(title)}
</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;

  font-family:
    Tahoma,
    Arial,
    sans-serif;

  color: #172033;

  background:
    radial-gradient(
      circle at 10% 20%,
      rgba(255,0,128,.35),
      transparent 30%
    ),
    radial-gradient(
      circle at 90% 10%,
      rgba(0,200,255,.35),
      transparent 30%
    ),
    radial-gradient(
      circle at 50% 90%,
      rgba(100,50,255,.35),
      transparent 35%
    ),
    linear-gradient(
      135deg,
      #6d28d9,
      #2563eb,
      #0891b2,
      #db2777
    );

  background-attachment: fixed;
}

body.dark {
  color: #f8fafc;

  background:
    radial-gradient(
      circle at 20% 20%,
      rgba(99,102,241,.25),
      transparent 30%
    ),
    radial-gradient(
      circle at 80% 80%,
      rgba(236,72,153,.2),
      transparent 30%
    ),
    #050816;
}

a {
  text-decoration: none;
  color: inherit;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 1000;

  height: 70px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 0 18px;

  color: white;

  background:
    rgba(15,23,42,.88);

  backdrop-filter:
    blur(15px);
}

.brand {
  font-size: 17px;
  font-weight: bold;
}

.icon-btn {
  width: 42px;
  height: 42px;

  border: 0;
  border-radius: 12px;

  color: white;

  background:
    rgba(255,255,255,.12);

  cursor: pointer;

  font-size: 20px;
}

.left-buttons {
  display: flex;
  gap: 8px;
}

.side-menu {
  position: fixed;

  top: 0;
  right: -330px;

  width: 310px;
  max-width: 88vw;

  height: 100vh;

  z-index: 3000;

  padding: 85px 15px 20px;

  overflow-y: auto;

  color: white;

  background:
    linear-gradient(
      160deg,
      #111827,
      #1e1b4b,
      #312e81
    );

  transition:
    right .25s ease;

  box-shadow:
    -15px 0 40px
    rgba(0,0,0,.35);
}

.side-menu.open {
  right: 0;
}

.overlay {
  position: fixed;

  inset: 0;

  z-index: 2500;

  display: none;

  background:
    rgba(0,0,0,.55);
}

.overlay.show {
  display: block;
}

.menu-title {
  padding: 15px;
  margin-bottom: 9px;

  border-radius: 14px;

  background:
    linear-gradient(
      135deg,
      #7c3aed,
      #db2777
    );

  font-weight: bold;
}

.menu-item,
.menu-disabled {
  display: block;

  padding: 14px;

  margin: 7px 0;

  border-radius: 13px;

  background:
    rgba(255,255,255,.08);
}

.menu-item:hover {
  background:
    rgba(255,255,255,.18);
}

.menu-disabled {
  opacity: .45;
}

.container {
  width:
    min(1150px, 94%);

  margin:
    28px auto 60px;
}

.card {
  padding: 23px;

  margin-bottom: 20px;

  border-radius: 22px;

  background:
    rgba(255,255,255,.88);

  box-shadow:
    0 15px 45px
    rgba(15,23,42,.16);

  backdrop-filter:
    blur(15px);
}

body.dark .card {
  background:
    rgba(17,24,39,.9);
}

.hero {
  color: white;

  background:
    linear-gradient(
      135deg,
      rgba(124,58,237,.95),
      rgba(219,39,119,.95)
    );
}

.grid {
  display: grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(210px,1fr)
    );

  gap: 16px;
}

.stat {
  padding: 22px;

  border-radius: 18px;

  color: white;

  background:
    linear-gradient(
      135deg,
      #2563eb,
      #7c3aed
    );

  box-shadow:
    0 12px 30px
    rgba(37,99,235,.22);
}

.stat:nth-child(2) {
  background:
    linear-gradient(
      135deg,
      #db2777,
      #9333ea
    );
}

.stat:nth-child(3) {
  background:
    linear-gradient(
      135deg,
      #059669,
      #0891b2
    );
}

.stat:nth-child(4) {
  background:
    linear-gradient(
      135deg,
      #ea580c,
      #eab308
    );
}

.stat strong {
  display: block;

  margin-top: 9px;

  font-size: 34px;
}

input,
textarea,
select {
  width: 100%;

  padding: 13px 15px;

  margin:
    7px 0 15px;

  border:
    1px solid #d8deea;

  border-radius: 13px;

  font-size: 15px;

  background: white;
}

textarea {
  min-height: 150px;
  resize: vertical;
}

button,
.btn {
  display: inline-flex;

  align-items: center;
  justify-content: center;

  gap: 7px;

  padding:
    12px 17px;

  border: 0;

  border-radius: 12px;

  color: white;

  cursor: pointer;

  background:
    linear-gradient(
      135deg,
      #2563eb,
      #7c3aed
    );
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
      #ea580c,
      #f59e0b
    );
}

.btn-gray {
  background:
    linear-gradient(
      135deg,
      #475569,
      #334155
    );
}

.item {
  padding: 17px;

  margin-bottom: 12px;

  border-radius: 15px;

  background:
    rgba(100,116,139,.08);
}

.alert {
  padding: 15px;

  margin-bottom: 15px;

  border-radius: 13px;

  color: #713f12;

  background: #fff7d6;
}

.alert.error {
  color: #991b1b;
  background: #fee2e2;
}

.alert.success {
  color: #166534;
  background: #dcfce7;
}

.activity {
  display: flex;
  gap: 12px;

  padding: 14px 0;

  border-bottom:
    1px solid
    rgba(100,116,139,.15);
}

.activity-icon {
  width: 42px;
  height: 42px;

  flex-shrink: 0;

  display: flex;

  align-items: center;
  justify-content: center;

  border-radius: 12px;

  color: white;

  background:
    linear-gradient(
      135deg,
      #6366f1,
      #ec4899
    );
}

.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.badge {
  display: inline-block;

  padding: 6px 10px;

  border-radius: 999px;

  color: #3730a3;

  background: #e0e7ff;
}

@media(max-width:600px) {

  .brand {
    font-size: 13px;
  }

  .container {
    width: 92%;
  }

  .card {
    padding: 18px;
  }

}

</style>

</head>

<body>

<header class="topbar">

  <button
    class="icon-btn"
    onclick="openMenu()">
    ☰
  </button>

  <div class="brand">
    🤖 ربات ساز کانفیگ ساز رایگان
  </div>

  <div class="left-buttons">

    <button
      class="icon-btn"
      onclick="toggleDark()">
      🌓
    </button>

    <button
      class="icon-btn"
      onclick="location.reload()">
      ↻
    </button>

  </div>

</header>

<div
  id="overlay"
  class="overlay"
  onclick="closeMenu()">
</div>

<aside
  id="sideMenu"
  class="side-menu">

  <div class="menu-title">
    🤖 منوی مدیریت
  </div>

  <a
    class="menu-item"
    href="/dashboard">
    📊 داشبورد
  </a>

  <a
    class="menu-item"
    href="/bots">
    🤖 ربات ها
  </a>

  <a
    class="menu-item"
    href="/bots/add">
    ➕ افزودن ربات
  </a>

  ${selectedMenu}

  <div
    style="
      height:1px;
      background:rgba(255,255,255,.12);
      margin:15px 0;
    ">
  </div>

  <a
    class="menu-item"
    href="/creator/login">
    👑 ورود سازنده
  </a>

  ${
    loggedIn
      ? `
        <a
          class="menu-item"
          href="/logout">
          🚪 خروج
        </a>
      `
      : ""
  }

</aside>

<div class="container">

${content}

</div>

<script>

function openMenu() {
  document
    .getElementById("sideMenu")
    .classList.add("open");

  document
    .getElementById("overlay")
    .classList.add("show");
}

function closeMenu() {
  document
    .getElementById("sideMenu")
    .classList.remove("open");

  document
    .getElementById("overlay")
    .classList.remove("show");
}

function toggleDark() {
  document.body.classList.toggle(
    "dark"
  );

  localStorage.setItem(
    "novaDark",
    document.body.classList.contains(
      "dark"
    )
      ? "1"
      : "0"
  );
}

if (
  localStorage.getItem(
    "novaDark"
  ) === "1"
) {
  document.body.classList.add(
    "dark"
  );
}

</script>

</body>

</html>
`;
}

/* =========================
   HOME
========================= */

app.get(
  "/",
  (req, res) => {
    if (
      req.session.userId
    ) {
      return res.redirect(
        "/dashboard"
      );
    }

    res.send(
      page(
        req,
        "ربات ساز",
        `
        <div class="card hero">

          <h1>
            🤖 ربات ساز کانفیگ ساز رایگان
          </h1>

          <p>
            ساخت و مدیریت ربات تلگرام
          </p>

          <div class="row">

            <a
              class="btn"
              href="/login">
              🔐 ورود
            </a>

            <a
              class="btn btn-green"
              href="/register">
              📝 ثبت نام
            </a>

            <a
              class="btn btn-orange"
              href="/creator/login">
              👑 ورود سازنده
            </a>

          </div>

        </div>
        `
      )
    );
  }
);

/* =========================
   REGISTER
========================= */

app.get(
  "/register",
  (req, res) => {
    res.send(
      page(
        req,
        "ثبت نام",
        `
        <div class="card">

          <h1>
            📝 ثبت نام
          </h1>

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
        req.body.username ||
          ""
      ).trim();

    const password =
      String(
        req.body.password ||
          ""
      );

    if (
      !username ||
      !password
    ) {
      return res.send(
        page(
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام کاربری و رمز عبور الزامی است.
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
          user.username.toLowerCase() ===
          username.toLowerCase()
      );

    if (exists) {
      return res.send(
        page(
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              این نام کاربری قبلاً وجود دارد.
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
      createdAt:
        Date.now()
    };

    db.users.push(user);

    saveDB();

    req.session.userId =
      user.id;

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
        req,
        "ورود",
        `
        <div class="card">

          <h1>
            🔐 ورود
          </h1>

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
        req.body.username ||
          ""
      ).trim();

    const password =
      String(
        req.body.password ||
          ""
      );

    const user =
      db.users.find(
        item =>
          item.username.toLowerCase() ===
            username.toLowerCase() &&
          item.password ===
            hashPassword(
              password
            )
      );

    if (!user) {
      return res.send(
        page(
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام کاربری یا رمز عبور اشتباه است.
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

    res.redirect(
      "/dashboard"
    );
  }
);

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

    let totalUsers = 0;

    for (
      const bot of bots
    ) {
      totalUsers +=
        Object.keys(
          db.botUsers[
            bot.id
          ] || {}
        ).length;
    }

    const activities =
      db.activity
        .filter(item => {
          if (!item.botId) {
            return true;
          }

          return bots.some(
            bot =>
              bot.id ===
              item.botId
          );
        })
        .slice(0, 15);

    let activityHtml =
      "";

    for (
      const item of activities
    ) {
      let icon = "📌";

      if (
        item.type === "user"
      ) {
        icon = "👤";
      }

      if (
        item.type === "command"
      ) {
        icon = "⚡";
      }

      if (
        item.type === "join"
      ) {
        icon = "🔐";
      }

      if (
        item.type === "broadcast"
      ) {
        icon = "📢";
      }

      activityHtml += `
        <div class="activity">

          <div class="activity-icon">
            ${icon}
          </div>

          <div>

            <strong>
              ${escapeHtml(
                item.text
              )}
            </strong>

            <br>

            <small>
              ${new Date(
                item.createdAt
              ).toLocaleString(
                "fa-IR"
              )}
            </small>

          </div>

        </div>
      `;
    }

    const commandCount =
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

    const forceJoinCount =
      bots.reduce(
        (sum, bot) =>
          sum +
          (
            bot.forceJoins
              ?.length || 0
          ),
        0
      );

    res.send(
      page(
        req,
        "داشبورد",
        `
        <div class="card hero">

          <h1>
            📊 داشبورد
          </h1>

          <p>
            مدیریت کامل ربات‌های شما
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
              ${commandCount}
            </strong>
          </div>

          <div class="stat">
            🔐 عضویت اجباری
            <strong>
              ${forceJoinCount}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            🎬 فعالیت‌های اخیر
          </h2>

          ${
            activityHtml ||
            "<p>هنوز فعالیتی ثبت نشده است.</p>"
          }

        </div>

        <div class="card">

          <div class="row">

            <a
              class="btn btn-green"
              href="/bots/add">
              ➕ افزودن ربات
            </a>

            <a
              class="btn"
              href="/bots">
              🤖 ربات‌ها
            </a>

            <button
              class="btn btn-gray"
              onclick="location.reload()">
              ↻ بروزرسانی
            </button>

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
      <div class="card hero">

        <h1>
          🤖 ربات‌ها
        </h1>

        <a
          class="btn btn-green"
          href="/bots/add">
          ➕ افزودن ربات
        </a>

      </div>
    `;

    if (
      bots.length ===
      0
    ) {
      html += `
        <div class="card">

          <p>
            هنوز رباتی اضافه نکرده‌اید.
          </p>

          <a
            class="btn btn-green"
            href="/bots/add">
            ➕ افزودن ربات
          </a>

        </div>
      `;
    }

    for (
      const bot of bots
    ) {
      const users =
        Object.keys(
          db.botUsers[
            bot.id
          ] || {}
        ).length;

      html += `
        <div class="card">

          <h2>
            🤖 ${escapeHtml(
              bot.name
            )}
          </h2>

          <p>
            @${
              escapeHtml(
                bot.username ||
                  ""
              )
            }
          </p>

          <div class="grid">

            <div class="stat">
              👥 کاربران
              <strong>
                ${users}
              </strong>
            </div>

            <div class="stat">
              ⚡ دستورات
              <strong>
                ${
                  Object.keys(
                    db.commands[
                      bot.id
                    ] || {}
                  ).length
                }
              </strong>
            </div>

            <div class="stat">
              🔐 عضویت
              <strong>
                ${
                  bot.forceJoins
                    ?.length || 0
                }
              </strong>
            </div>

          </div>

          <br>

          <div class="row">

            <a
              class="btn"
              href="/bots/${bot.id}">
              ⚙️ مدیریت
            </a>

            <a
              class="btn btn-green"
              href="/forcejoin?bot=${bot.id}">
              🔐 عضویت اجباری
            </a>

            <a
              class="btn btn-orange"
              href="/broadcast?bot=${bot.id}">
              📢 ارسال پیام
            </a>

            <a
              class="btn btn-danger"
              href="/bots/delete/${bot.id}"
              onclick="return confirm('آیا از حذف این ربات مطمئن هستید؟')">
              🗑 حذف
            </a>

          </div>

        </div>
      `;
    }

    res.send(
      page(
        req,
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
        req,
        "افزودن ربات",
        `
        <div class="card hero">

          <h1>
            ➕ افزودن ربات
          </h1>

          <p>
            توکن را از BotFather دریافت کنید.
          </p>

        </div>

        <div class="card">

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
              placeholder="123456789:ABC..."
              required>

            <button>
              ➕ افزودن ربات
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
        req.body.name ||
          ""
      ).trim();

    const token =
      String(
        req.body.token ||
          ""
      ).trim();

    if (
      !name ||
      !token
    ) {
      return res.send(
        page(
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام و توکن الزامی است.
            </div>

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
          me.username ||
          "",

        firstName:
          me.first_name ||
          "",

        forceJoins: [],

        forceJoinVerified: {},

        createdAt:
          Date.now()
      };

      db.bots.push(
        bot
      );

      db.botUsers[
        bot.id
      ] = {};

      db.commands[
        bot.id
      ] = {};

      saveDB();

      addActivity(
        "bot",
        `ربات ${name} اضافه شد.`,
        bot.id
      );

      pollBot(bot);

      res.redirect(
        `/bots/${bot.id}`
      );

    } catch (error) {
      res.send(
        page(
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">

              ❌ توکن ربات معتبر نیست.

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
   BOT MANAGEMENT
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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
    }

    const users =
      Object.keys(
        db.botUsers[
          bot.id
        ] || {}
      ).length;

    const commands =
      Object.keys(
        db.commands[
          bot.id
        ] || {}
      ).length;

    const joins =
      bot.forceJoins
        ?.length || 0;

    res.send(
      page(
        req,
        bot.name,
        `
        <div class="card hero">

          <h1>
            🤖 ${escapeHtml(
              bot.name
            )}
          </h1>

          <p>
            @${escapeHtml(
              bot.username
            )}
          </p>

        </div>

        <div class="grid">

          <div class="stat">
            👥 کاربران
            <strong>
              ${users}
            </strong>
          </div>

          <div class="stat">
            ⚡ دستورات
            <strong>
              ${commands}
            </strong>
          </div>

          <div class="stat">
            🔐 عضویت
            <strong>
              ${joins}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            ⚙️ مدیریت
          </h2>

          <div class="row">

            <a
              class="btn btn-green"
              href="/forcejoin?bot=${bot.id}">
              🔐 عضویت اجباری
            </a>

            <a
              class="btn btn-orange"
              href="/broadcast?bot=${bot.id}">
              📢 ارسال پیام به همه کاربران
            </a>

            <a
              class="btn"
              href="/commands/add?bot=${bot.id}">
              ➕ افزودن دستور
            </a>

            <a
              class="btn"
              href="/commands?bot=${bot.id}">
              ⚡ دستورات
            </a>

            <a
              class="btn"
              href="/users?bot=${bot.id}">
              👥 آمار کاربران
            </a>

          </div>

        </div>
        `,
        bot.id
      )
    );
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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
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

    addActivity(
      "bot",
      `ربات ${bot.name} حذف شد.`
    );

    res.redirect(
      "/bots"
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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
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

          <h3>
            📢 ${escapeHtml(
              join.title ||
                join.username
            )}
          </h3>

          <p>
            ${escapeHtml(
              join.username
            )}
          </p>

          <span class="badge">
            ${escapeHtml(
              join.type ||
                "channel"
            )}
          </span>

          <br><br>

          <a
            class="btn btn-danger"
            href="/forcejoin/delete?bot=${bot.id}&index=${i}"
            onclick="return confirm('این مورد حذف شود؟')">
            🗑 حذف
          </a>

        </div>
      `;
    }

    res.send(
      page(
        req,
        "عضویت اجباری",
        `
        <div class="card hero">

          <h1>
            🔐 عضویت اجباری
          </h1>

          <p>
            فقط هنگام اجرای /start بررسی می‌شود.
          </p>

        </div>

        <div class="card">

          <div class="alert">

            ⚠️ ربات باید در کانال یا گروه
            ادمین باشد.

            <br><br>

            مثال:
            https://t.me/example

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
              لینک کانال یا گروه
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
            کانال‌ها و گروه‌های فعال
          </h2>

          ${
            list ||
            "<p>عضویت اجباری فعال نیست.</p>"
          }

        </div>
        `,
        bot.id
      )
    );
  }
);

/* =========================
   ADD FORCE JOIN
========================= */

app.post(
  "/forcejoin/add",
  requireLogin,
  async (req, res) => {
    const botId =
      String(
        req.body.bot ||
          ""
      );

    const link =
      String(
        req.body.link ||
          ""
      ).trim();

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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
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
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              حداکثر ۵ مورد قابل اضافه کردن است.
            </div>

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

      bot.forceJoins.push({
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
      });

      saveDB();

      addActivity(
        "join",
        `عضویت اجباری ${chat.title || parsed.username} اضافه شد.`,
        bot.id
      );

      res.redirect(
        `/forcejoin?bot=${bot.id}`
      );

    } catch (error) {
      res.send(
        page(
          req,
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

/* =========================
   DELETE FORCE JOIN
========================= */

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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
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
      return res.status(
        400
      ).send(
        "Invalid index"
      );
    }

    bot.forceJoins.splice(
      index,
      1
    );

    saveDB();

    res.redirect(
      `/forcejoin?bot=${bot.id}`
    );
  }
);

/* =========================
   COMMANDS
========================= */

app.get(
  "/commands",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res.status(
        404
      ).send(
        "Bot not found"
      );
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
            href="/commands/delete?bot=${bot.id}&command=${encodeURIComponent(
              name
            )}"
            onclick="return confirm('این دستور حذف شود؟')">
            🗑 حذف
          </a>

        </div>
      `;
    }

    res.send(
      page(
        req,
        "دستورات",
        `
        <div class="card hero">

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
            "<p>هنوز دستوری ثبت نشده است.</p>"
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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
    }

    res.send(
      page(
        req,
        "افزودن دستور",
        `
        <div class="card hero">

          <h1>
            ➕ افزودن دستور
          </h1>

        </div>

        <div class="card">

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
              placeholder="سلام 👋"
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
        req.body.bot ||
          ""
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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
    }

    if (!command) {
      return res.send(
        page(
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              نام دستور نامعتبر است.
            </div>

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

    addActivity(
      "command",
      `دستور /${command} اضافه شد.`,
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
        req.query.bot ||
          ""
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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
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

    res.redirect(
      `/commands?bot=${bot.id}`
    );
  }
);

/* =========================
   USERS
========================= */

app.get(
  "/users",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res.status(
        404
      ).send(
        "Bot not found"
      );
    }

    const users =
      db.botUsers[
        bot.id
      ] || {};

    let list = "";

    for (
      const key of Object.keys(
        users
      )
    ) {
      const user =
        users[key];

      const name =
        [
          user.first_name,
          user.last_name
        ]
          .filter(Boolean)
          .join(" ") ||
        "بدون نام";

      list += `
        <div class="item">

          <h3>
            👤 ${escapeHtml(
              name
            )}
          </h3>

          <p>
            Telegram ID:
            ${escapeHtml(
              user.id
            )}
          </p>

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
        req,
        "آمار کاربران",
        `
        <div class="card hero">

          <h1>
            👥 آمار کاربران
          </h1>

          <p>
            ${escapeHtml(
              bot.name
            )}
          </p>

        </div>

        <div class="grid">

          <div class="stat">
            👥 کل کاربران
            <strong>
              ${Object.keys(
                users
              ).length}
            </strong>
          </div>

        </div>

        <div class="card">

          ${
            list ||
            "<p>هنوز کاربری وارد ربات نشده است.</p>"
          }

        </div>
        `,
        bot.id
      )
    );
  }
);

/* =========================
   BROADCAST
========================= */

app.get(
  "/broadcast",
  requireLogin,
  (req, res) => {
    const bot =
      findBot(req);

    if (!bot) {
      return res.status(
        404
      ).send(
        "Bot not found"
      );
    }

    const count =
      Object.keys(
        db.botUsers[
          bot.id
        ] || {}
      ).length;

    res.send(
      page(
        req,
        "ارسال پیام",
        `
        <div class="card hero">

          <h1>
            📢 ارسال پیام به همه کاربران
          </h1>

          <p>
            تعداد کاربران:
            ${count}
          </p>

        </div>

        <div class="card">

          <div class="alert">

            برای عکس و ویدیو می‌توانید
            لینک مستقیم فایل یا
            file_id تلگرام وارد کنید.

          </div>

          <form
            method="post"
            action="/broadcast">

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
              onchange="toggleMedia(this.value)">

              <option value="text">
                📝 متن
              </option>

              <option value="photo">
                🖼 عکس
              </option>

              <option value="video">
                🎬 ویدیو
              </option>

            </select>

            <div
              id="mediaBox"
              style="display:none">

              <label>
                لینک فایل یا file_id
              </label>

              <input
                name="media"
                placeholder="https://example.com/file">

            </div>

            <label>
              متن پیام / کپشن
            </label>

            <textarea
              name="text"
              placeholder="پیام شما..."></textarea>

            <button
              class="btn-orange">
              📢 ارسال به همه کاربران
            </button>

          </form>

        </div>

        <script>

        function toggleMedia(type) {

          document.getElementById(
            "mediaBox"
          ).style.display =
            type === "text"
              ? "none"
              : "block";

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
  async (req, res) => {
    const botId =
      String(
        req.body.bot ||
          ""
      );

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

    const media =
      String(
        req.body.media ||
          ""
      ).trim();

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
      return res.status(
        404
      ).send(
        "Bot not found"
      );
    }

    const users =
      db.botUsers[
        bot.id
      ] || {};

    const ids =
      Object.keys(users);

    let success = 0;
    let failed = 0;

    for (
      const chatId of ids
    ) {
      try {
        if (
          type === "photo"
        ) {
          if (!media) {
            throw new Error(
              "لینک عکس خالی است."
            );
          }

          await sendTelegramPhoto(
            bot,
            chatId,
            media,
            text
          );

        } else if (
          type === "video"
        ) {
          if (!media) {
            throw new Error(
              "لینک ویدیو خالی است."
            );
          }

          await sendTelegramVideo(
            bot,
            chatId,
            media,
            text
          );

        } else {
          if (!text) {
            throw new Error(
              "متن خالی است."
            );
          }

          await sendTelegramMessage(
            bot,
            chatId,
            text
          );
        }

        success++;

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              60
            )
        );

      } catch {
        failed++;
      }
    }

    addActivity(
      "broadcast",
      `ارسال همگانی: ${success} موفق و ${failed} ناموفق.`,
      bot.id
    );

    res.send(
      page(
        req,
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
   CREATOR LOGIN
========================= */

app.get(
  "/creator/login",
  (req, res) => {
    res.send(
      page(
        req,
        "ورود سازنده",
        `
        <div class="card hero">

          <h1>
            👑 ورود سازنده
          </h1>

          <p>
            ورود به پنل اصلی سازنده
          </p>

        </div>

        <div class="card">

          <form
            method="post"
            action="/creator/login">

            <label>
              رمز سازنده
            </label>

            <input
              name="password"
              type="password"
              required>

            <button>
              👑 ورود سازنده
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
          req,
          "خطا",
          `
          <div class="card">

            <div class="alert error">
              ❌ رمز سازنده اشتباه است.
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
   CREATOR
========================= */

app.get(
  "/creator",
  requireCreator,
  (req, res) => {
    let totalBotUsers = 0;

    for (
      const bot of db.bots
    ) {
      totalBotUsers +=
        Object.keys(
          db.botUsers[
            bot.id
          ] || {}
        ).length;
    }

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
            @${escapeHtml(
              bot.username ||
                ""
            )}
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

        </div>
      `;
    }

    res.send(
      page(
        req,
        "پنل سازنده",
        `
        <div class="card hero">

          <h1>
            👑 پنل سازنده
          </h1>

          <a
            class="btn btn-danger"
            href="/creator/logout">
            🚪 خروج سازنده
          </a>

        </div>

        <div class="grid">

          <div class="stat">
            👤 حساب‌ها
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
            👥 کاربران
            <strong>
              ${totalBotUsers}
            </strong>
          </div>

          <div class="stat">
            📌 فعالیت‌ها
            <strong>
              ${db.activity.length}
            </strong>
          </div>

        </div>

        <div class="card">

          <h2>
            🤖 ربات‌ها
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

    res.redirect("/");
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
    res.status(404).send(
      page(
        req,
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
            href="/dashboard">
            📊 داشبورد
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

    res.status(500).send(
      `
      <div
        style="
          direction:rtl;
          font-family:Tahoma;
          padding:40px;
        "
      >

        <h1>
          خطای داخلی سرور
        </h1>

        <p>
          ${escapeHtml(
            error.message
          )}
        </p>

      </div>
      `
    );
  }
);

/* =========================
   START SERVER
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
