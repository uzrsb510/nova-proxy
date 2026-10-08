const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";
const SESSION_SECRET = process.env.SESSION_SECRET || "nova-secret-2026";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function defaultDB() {
  return {
    users: [],
    bots: [],
    botUsers: {},
    commands: {}
  };
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function normalizeDB(data) {
  if (!data || typeof data !== "object") {
    return defaultDB();
  }

  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.bots)) data.bots = [];
  if (!data.botUsers || typeof data.botUsers !== "object") {
    data.botUsers = {};
  }
  if (!data.commands || typeof data.commands !== "object") {
    data.commands = {};
  }

  for (const bot of data.bots) {
    if (!bot.id) bot.id = makeId();

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
      JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
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
    user => user.id === req.session.userId
  );
}

function findBot(req) {
  const id = String(req.query.bot || req.params.id || "");

  return db.bots.find(
    bot =>
      String(bot.id) === id &&
      String(bot.ownerId) === String(req.session.userId)
  );
}

function telegramUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegram(token, method, body = {}) {
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
    throw new Error("Telegram پاسخ نامعتبر داد.");
  }

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API Error"
    );
  }

  return data.result;
}

async function sendTelegramMessage(
  bot,
  chatId,
  text,
  reply_markup = undefined
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

function parsePublicTelegramLink(input) {
  let value = String(input || "").trim();

  if (!value) {
    throw new Error("لینک کانال یا گروه را وارد کنید.");
  }

  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("لینک وارد شده معتبر نیست.");
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

  if (!username || username.startsWith("+")) {
    throw new Error(
      "لینک دعوت خصوصی قابل استفاده نیست. لینک عمومی کانال یا گروه را وارد کنید."
    );
  }

  return {
    username: "@" + username.replace(/^@/, ""),
    link: "https://t.me/" + username.replace(/^@/, "")
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
      `Membership check failed for ${chatUsername}:`,
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

  return changed;
}

function getVerifiedJoins(bot, userId) {
  ensureForceJoinState(bot);

  const key = String(userId);

  if (
    !bot.forceJoinVerified[key] ||
    typeof bot.forceJoinVerified[key] !== "object"
  ) {
    bot.forceJoinVerified[key] = {};
  }

  return bot.forceJoinVerified[key];
}

function getUnverifiedJoins(bot, userId) {
  ensureForceJoinState(bot);

  const verified = getVerifiedJoins(
    bot,
    userId
  );

  return bot.forceJoins.filter(
    join => !verified[String(join.id)]
  );
}

function markJoinVerified(
  bot,
  userId,
  joinId
) {
  const verified = getVerifiedJoins(
    bot,
    userId
  );

  verified[String(joinId)] = true;
}

async function checkAllMemberships(
  bot,
  userId
) {
  ensureForceJoinState(bot);

  const unverified = getUnverifiedJoins(
    bot,
    userId
  );

  if (unverified.length === 0) {
    return {
      ok: true,
      missing: null
    };
  }

  let changed = false;

  for (const join of unverified) {
    const isMember = await checkMembership(
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
    ok: true,
    missing: null
  };
}

function getCommandNameFromText(text) {
  if (!text || typeof text !== "string") {
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

  command = command
    .replace(/[^a-zA-Z0-9_]/g, "");

  return command || null;
}

async function sendJoinMessage(
  bot,
  chatId,
  originalText = null
) {
  const buttons = [];

  for (const join of bot.forceJoins) {
    buttons.push([
      {
        text: `📢 ${join.title || join.username}`,
        url: join.link
      }
    ]);
  }

  const commandName =
    getCommandNameFromText(originalText);

  const callbackData = commandName
    ? `check_join:${commandName}`
    : "check_join";

  buttons.push([
    {
      text: "✅ بررسی عضویت",
      callback_data: callbackData
    }
  ]);

  return sendTelegramMessage(
    bot,
    chatId,
    "🔒 برای استفاده از ربات ابتدا باید در موارد زیر عضو شوید:\n\nبعد از عضویت روی «✅ بررسی عضویت» بزنید.",
    {
      inline_keyboard: buttons
    }
  );
}

async function handleCallback(
  bot,
  callback
) {
  const data = String(
    callback.data || ""
  );

  if (!data.startsWith("check_join")) {
    return;
  }

  const userId = callback.from.id;
  const chatId =
    callback.message?.chat?.id;

  if (!chatId) {
    return;
  }

  let commandName = null;

  if (data.startsWith("check_join:")) {
    commandName = data
      .substring("check_join:".length)
      .replace(/[^a-zA-Z0-9_]/g, "")
      .slice(0, 32);

    if (!commandName) {
      commandName = null;
    }
  }

  try {
    const result =
      await checkAllMemberships(
        bot,
        userId
      );

    if (result.ok) {
      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id: callback.id,
          text: "✅ عضویت شما تأیید شد.",
          show_alert: false
        }
      );

      if (callback.message?.message_id) {
        await deleteTelegramMessage(
          bot,
          chatId,
          callback.message.message_id
        );
      }

      if (commandName) {
        await executeCommand(
          bot,
          chatId,
          "/" + commandName
        );
      }
    } else {
      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id: callback.id,
          text: "❌ هنوز در همه موارد عضو نشده‌اید.",
          show_alert: true
        }
      );
    }
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
          callback_query_id: callback.id,
          text: "⚠️ خطا در بررسی عضویت.",
          show_alert: true
        }
      );
    } catch {}
  }
}

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

  const key = String(
    telegramUser.id
  );

  const old =
    db.botUsers[bot.id][key];

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
      old?.createdAt || Date.now()
  };

  saveDB();
}

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

  return true;
}

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

  ensureForceJoinState(bot);

  if (bot.forceJoins.length > 0) {
    const result =
      await checkAllMemberships(
        bot,
        from.id
      );

    if (!result.ok) {
      try {
        await sendJoinMessage(
          bot,
          chatId,
          message.text || null
        );
      } catch (error) {
        console.error(
          "Send join message error:",
          error.message
        );
      }

      return;
    }
  }

  if (message.text) {
    await executeCommand(
      bot,
      chatId,
      message.text
    );
  }
}

const pollingState = new Map();

async function pollBot(bot) {
  if (!bot || !bot.token) {
    return;
  }

  if (
    pollingState.get(bot.id)?.running
  ) {
    return;
  }

  pollingState.set(bot.id, {
    running: true,
    offset:
      pollingState.get(bot.id)?.offset || 0
  });

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
        b => b.id === bot.id
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
            offset: state.offset,
            timeout: 25,
            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      for (const update of updates) {
        if (update.update_id >= state.offset) {
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
            `Update error for bot ${currentBot.id}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        `Polling error for bot ${currentBot.id}:`,
        error.message
      );

      await new Promise(
        resolve =>
          setTimeout(resolve, 3000)
      );
    }

    setTimeout(loop, 500);
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

function stopBotPolling(botId) {
  const state =
    pollingState.get(botId);

  if (state) {
    state.running = false;
    pollingState.delete(botId);
  }
}

function page(
  title,
  content
) {
  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Tahoma, Arial, sans-serif;
  background: #f4f7fb;
  color: #172033;
}

a {
  color: inherit;
  text-decoration: none;
}

.container {
  width: min(1100px, 94%);
  margin: 30px auto;
}

.nav {
  background: #111827;
  color: white;
  padding: 15px 20px;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.nav .links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.nav a {
  background: #1f2937;
  padding: 9px 13px;
  border-radius: 9px;
}

.card {
  background: white;
  border-radius: 16px;
  padding: 22px;
  margin-bottom: 18px;
  box-shadow: 0 5px 25px rgba(0,0,0,.06);
}

h1,
h2,
h3 {
  margin-top: 0;
}

input,
textarea,
select {
  width: 100%;
  padding: 12px;
  border: 1px solid #d6dce5;
  border-radius: 10px;
  margin: 7px 0 14px;
  font-family: inherit;
  font-size: 15px;
}

textarea {
  min-height: 130px;
  resize: vertical;
}

button,
.btn {
  border: 0;
  background: #2563eb;
  color: white;
  padding: 11px 16px;
  border-radius: 10px;
  cursor: pointer;
  display: inline-block;
  font-family: inherit;
}

.btn-danger {
  background: #dc2626;
}

.btn-green {
  background: #059669;
}

.btn-gray {
  background: #4b5563;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 15px;
}

.stat {
  background: #eef4ff;
  border-radius: 14px;
  padding: 20px;
}

.stat strong {
  display: block;
  font-size: 30px;
  margin-top: 7px;
}

.alert {
  background: #fff4d6;
  border: 1px solid #f2d27b;
  padding: 13px;
  border-radius: 10px;
  margin-bottom: 15px;
}

.success {
  background: #dcfce7;
  border-color: #86efac;
}

.error {
  background: #fee2e2;
  border-color: #fca5a5;
}

.item {
  border: 1px solid #e5e7eb;
  padding: 16px;
  border-radius: 13px;
  margin-bottom: 12px;
}

small {
  color: #6b7280;
}

pre {
  direction: ltr;
  text-align: left;
  background: #111827;
  color: #fff;
  padding: 15px;
  border-radius: 12px;
  overflow: auto;
}
</style>
</head>

<body>

<div class="nav">
  <strong>ربات ساز کانفیگ ساز رایگان</strong>

  <div class="links">
    <a href="/">خانه</a>
    <a href="/bots">ربات‌ها</a>
    <a href="/creator">سازنده</a>
    <a href="/logout">خروج</a>
  </div>
</div>

<div class="container">
${content}
</div>

</body>
</html>
`;
}

app.get("/", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/dashboard");
  }

  res.send(
    page(
      "ربات ساز",
      `
      <div class="card">
        <h1>ربات ساز کانفیگ ساز رایگان</h1>
        <p>
          ساخت و مدیریت ربات تلگرام
        </p>

        <a class="btn" href="/login">
          ورود
        </a>

        <a class="btn btn-green" href="/register">
          ثبت‌نام
        </a>
      </div>
      `
    )
  );
});

app.get("/register", (req, res) => {
  res.send(
    page(
      "ثبت نام",
      `
      <div class="card">
        <h2>ثبت نام</h2>

        <form method="post" action="/register">
          <label>نام کاربری</label>
          <input name="username" required>

          <label>رمز عبور</label>
          <input name="password" type="password" required>

          <button>
            ثبت نام
          </button>
        </form>

        <br>

        <a class="btn btn-gray" href="/login">
          ورود
        </a>
      </div>
      `
    )
  );
});

app.post("/register", (req, res) => {
  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  if (!username || !password) {
    return res.send(
      page(
        "خطا",
        `
        <div class="card">
          <div class="alert error">
            نام کاربری و رمز عبور الزامی است.
          </div>
          <a class="btn" href="/register">
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
        "خطا",
        `
        <div class="card">
          <div class="alert error">
            این نام کاربری قبلاً ثبت شده است.
          </div>
          <a class="btn" href="/register">
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
    password: hashPassword(password),
    createdAt: Date.now()
  };

  db.users.push(user);
  saveDB();

  req.session.userId = user.id;

  res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
  res.send(
    page(
      "ورود",
      `
      <div class="card">
        <h2>ورود</h2>

        <form method="post" action="/login">
          <label>نام کاربری</label>
          <input name="username" required>

          <label>رمز عبور</label>
          <input name="password" type="password" required>

          <button>
            ورود
          </button>
        </form>

        <br>

        <a class="btn btn-green" href="/register">
          ثبت نام
        </a>
      </div>
      `
    )
  );
});

app.post("/login", (req, res) => {
  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  const user =
    db.users.find(
      item =>
        item.username.toLowerCase() ===
          username.toLowerCase() &&
        item.password ===
          hashPassword(password)
    );

  if (!user) {
    return res.send(
      page(
        "خطا",
        `
        <div class="card">
          <div class="alert error">
            نام کاربری یا رمز عبور اشتباه است.
          </div>

          <a class="btn" href="/login">
            بازگشت
          </a>
        </div>
        `
      )
    );
  }

  req.session.userId = user.id;

  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get(
  "/dashboard",
  requireLogin,
  (req, res) => {
    const user = findUser(req);

    const bots =
      db.bots.filter(
        bot =>
          String(bot.ownerId) ===
          String(user.id)
      );

    res.send(
      page(
        "داشبورد",
        `
        <div class="card">
          <h1>سلام ${escapeHtml(
            user.username
          )} 👋</h1>

          <p>
            به پنل مدیریت ربات‌های خود خوش آمدید.
          </p>

          <a class="btn" href="/bots">
            مدیریت ربات‌ها
          </a>

          <a class="btn btn-green" href="/bots/add">
            افزودن ربات
          </a>
        </div>

        <div class="grid">
          <div class="stat">
            تعداد ربات‌ها
            <strong>${bots.length}</strong>
          </div>

          <div class="stat">
            تعداد کاربران
            <strong>
              ${bots.reduce(
                (sum, bot) =>
                  sum +
                  Object.keys(
                    db.botUsers[bot.id] || {}
                  ).length,
                0
              )}
            </strong>
          </div>
        </div>
        `
      )
    );
  }
);

app.get(
  "/bots",
  requireLogin,
  (req, res) => {
    const bots =
      db.bots.filter(
        bot =>
          String(bot.ownerId) ===
          String(req.session.userId)
      );

    let html = `
      <div class="card">
        <h1>ربات‌های من</h1>

        <a class="btn btn-green" href="/bots/add">
          + افزودن ربات
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

    for (const bot of bots) {
      const userCount =
        Object.keys(
          db.botUsers[bot.id] || {}
        ).length;

      html += `
        <div class="card">
          <h2>
            ${escapeHtml(
              bot.name || "ربات بدون نام"
            )}
          </h2>

          <p>
            کاربران: ${userCount}
          </p>

          <p>
            عضویت اجباری:
            ${
              bot.forceJoins?.length || 0
            }
          </p>

          <a class="btn" href="/bots/${bot.id}">
            مدیریت
          </a>

          <a class="btn btn-danger"
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

app.get(
  "/bots/add",
  requireLogin,
  (req, res) => {
    res.send(
      page(
        "افزودن ربات",
        `
        <div class="card">
          <h1>افزودن ربات</h1>

          <div class="alert">
            توکن ربات را از BotFather دریافت کنید.
          </div>

          <form method="post" action="/bots/add">

            <label>نام ربات</label>
            <input
              name="name"
              placeholder="مثلاً Nova Bot"
              required
            >

            <label>توکن ربات</label>
            <input
              name="token"
              placeholder="123456:ABC..."
              required
            >

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
      String(req.body.name || "").trim();

    const token =
      String(req.body.token || "").trim();

    if (!name || !token) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">
            <div class="alert error">
              نام و توکن الزامی است.
            </div>

            <a class="btn" href="/bots/add">
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
        ownerId: req.session.userId,
        name,
        token,
        telegramId: me.id,
        username:
          me.username || "",
        firstName:
          me.first_name || "",
        forceJoins: [],
        forceJoinVerified: {},
        createdAt: Date.now()
      };

      db.bots.push(bot);
      db.botUsers[bot.id] = {};
      db.commands[bot.id] = {};

      saveDB();

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
              توکن ربات معتبر نیست یا اتصال به تلگرام انجام نشد.
              <br><br>
              ${escapeHtml(
                error.message
              )}
            </div>

            <a class="btn" href="/bots/add">
              بازگشت
            </a>
          </div>
          `
        )
      );
    }
  }
);

app.get(
  "/bots/delete/:id",
  requireLogin,
  (req, res) => {
    const index =
      db.bots.findIndex(
        bot =>
          bot.id === req.params.id &&
          String(bot.ownerId) ===
            String(req.session.userId)
      );

    if (index === -1) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    const bot =
      db.bots[index];

    stopBotPolling(bot.id);

    db.bots.splice(index, 1);

    delete db.botUsers[bot.id];
    delete db.commands[bot.id];

    saveDB();

    res.redirect("/bots");
  }
);

app.get(
  "/bots/:id",
  requireLogin,
  (req, res) => {
    const bot =
      db.bots.find(
        item =>
          item.id === req.params.id &&
          String(item.ownerId) ===
            String(req.session.userId)
      );

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    ensureForceJoinState(bot);

    const commands =
      db.commands[bot.id] || {};

    const users =
      db.botUsers[bot.id] || {};

    let commandList = "";

    for (const name of Object.keys(
      commands
    )) {
      const command =
        commands[name];

      const response =
        typeof command === "string"
          ? command
          : command.response || "";

      commandList += `
        <div class="item">
          <strong>/${escapeHtml(
            name
          )}</strong>

          <p>
            ${escapeHtml(response)}
          </p>

          <a
            class="btn btn-danger"
            href="/commands/delete?bot=${bot.id}&command=${encodeURIComponent(name)}"
            onclick="return confirm('حذف شود؟')">
            حذف
          </a>
        </div>
      `;
    }

    let joinList = "";

    for (
      let i = 0;
      i < bot.forceJoins.length;
      i++
    ) {
      const join =
        bot.forceJoins[i];

      joinList += `
        <div class="item">
          <strong>
            ${escapeHtml(
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
            onclick="return confirm('این مورد حذف شود؟')">
            حذف
          </a>
        </div>
      `;
    }

    res.send(
      page(
        bot.name,
        `
        <div class="card">
          <h1>
            ${escapeHtml(
              bot.name
            )}
          </h1>

          <p>
            @${escapeHtml(
              bot.username
            )}
          </p>

          <div class="grid">
            <div class="stat">
              کاربران
              <strong>
                ${Object.keys(users).length}
              </strong>
            </div>

            <div class="stat">
              دستورات
              <strong>
                ${Object.keys(commands).length}
              </strong>
            </div>

            <div class="stat">
              عضویت اجباری
              <strong>
                ${bot.forceJoins.length}
              </strong>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>دستورات</h2>

          <a
            class="btn btn-green"
            href="/commands/add?bot=${bot.id}">
            + افزودن دستور
          </a>

          <br><br>

          ${
            commandList ||
            "<p>دستوری ثبت نشده است.</p>"
          }
        </div>

        <div class="card">
          <h2>عضویت اجباری</h2>

          <div class="alert">
            ربات باید در کانال یا گروه موردنظر
            <strong>ادمین</strong> باشد.
            <br>
            فقط لینک عمومی مثل
            <strong>https://t.me/channel</strong>
            قابل استفاده است.
          </div>

          <a
            class="btn btn-green"
            href="/forcejoin?bot=${bot.id}">
            مدیریت عضویت اجباری
          </a>

          <br><br>

          ${
            joinList ||
            "<p>عضویت اجباری تنظیم نشده است.</p>"
          }
        </div>

        <div class="card">
          <h2>کاربران</h2>

          <p>
            تعداد کاربران:
            ${Object.keys(users).length}
          </p>

          <a
            class="btn"
            href="/users?bot=${bot.id}">
            مشاهده کاربران
          </a>
        </div>
        `
      )
    );
  }
);

app.get(
  "/forcejoin",
  requireLogin,
  (req, res) => {
    const bot = findBot(req);

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    ensureForceJoinState(bot);

    let list = "";

    for (
      let i = 0;
      i < bot.forceJoins.length;
      i++
    ) {
      const join =
        bot.forceJoins[i];

      list += `
        <div class="item">
          <strong>
            ${escapeHtml(
              join.title ||
                join.username
            )}
          </strong>

          <br>

          <small>
            ${escapeHtml(
              join.username
            )}
          </small>

          <br><br>

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
          <h1>عضویت اجباری</h1>

          <div class="alert">
            حداکثر ۵ کانال یا گروه می‌توانید تنظیم کنید.
            <br>
            ربات باید در هرکدام ادمین باشد.
          </div>

          <form method="post" action="/forcejoin/add">

            <input
              type="hidden"
              name="bot"
              value="${escapeHtml(bot.id)}"
            >

            <label>
              لینک عمومی کانال یا گروه
            </label>

            <input
              name="link"
              placeholder="https://t.me/example"
              required
            >

            <button>
              افزودن
            </button>
          </form>
        </div>

        <div class="card">
          <h2>موارد فعال</h2>

          ${
            list ||
            "<p>موردی تنظیم نشده است.</p>"
          }
        </div>

        <div class="card">
          <a
            class="btn btn-gray"
            href="/bots/${bot.id}">
            بازگشت
          </a>
        </div>
        `
      )
    );
  }
);

app.post(
  "/forcejoin/add",
  requireLogin,
  async (req, res) => {
    const botId =
      String(req.body.bot || "");

    const link =
      String(req.body.link || "").trim();

    const bot =
      db.bots.find(
        item =>
          item.id === botId &&
          String(item.ownerId) ===
            String(req.session.userId)
      );

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    ensureForceJoinState(bot);

    if (bot.forceJoins.length >= 5) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card">
            <div class="alert error">
              حداکثر ۵ مورد قابل تنظیم است.
            </div>

            <a class="btn"
               href="/forcejoin?bot=${bot.id}">
              بازگشت
            </a>
          </div>
          `
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
        ].includes(chat.type)
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

      const alreadyExists =
        bot.forceJoins.some(
          join =>
            String(join.username).toLowerCase() ===
            String(parsed.username).toLowerCase()
        );

      if (alreadyExists) {
        throw new Error(
          "این کانال یا گروه قبلاً اضافه شده است."
        );
      }

      bot.forceJoins.push({
        id: makeId(),
        username: parsed.username,
        link: parsed.link,
        title:
          chat.title ||
          parsed.username,
        type: chat.type,
        addedAt: Date.now()
      });

      saveDB();

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
          `
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
            String(req.query.bot || "") &&
          String(item.ownerId) ===
            String(req.session.userId)
      );

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    ensureForceJoinState(bot);

    const index =
      Number(req.query.index);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= bot.forceJoins.length
    ) {
      return res.status(400).send(
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

app.get(
  "/commands/add",
  requireLogin,
  (req, res) => {
    const bot = findBot(req);

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    res.send(
      page(
        "افزودن دستور",
        `
        <div class="card">
          <h1>افزودن دستور</h1>

          <form method="post" action="/commands/add">

            <input
              type="hidden"
              name="bot"
              value="${escapeHtml(bot.id)}"
            >

            <label>
              نام دستور بدون /
            </label>

            <input
              name="command"
              placeholder="start"
              required
            >

            <label>
              پاسخ ربات
            </label>

            <textarea
              name="response"
              placeholder="متن پاسخ..."
              required
            ></textarea>

            <button>
              ذخیره دستور
            </button>
          </form>
        </div>
        `
      )
    );
  }
);

app.post(
  "/commands/add",
  requireLogin,
  (req, res) => {
    const botId =
      String(req.body.bot || "");

    const command =
      String(
        req.body.command || ""
      )
        .trim()
        .replace(/^\/+/, "")
        .replace(/[^a-zA-Z0-9_]/g, "");

    const response =
      String(
        req.body.response || ""
      );

    const bot =
      db.bots.find(
        item =>
          item.id === botId &&
          String(item.ownerId) ===
            String(req.session.userId)
      );

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
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
            <a class="btn"
               href="/commands/add?bot=${bot.id}">
              بازگشت
            </a>
          </div>
          `
        )
      );
    }

    if (!db.commands[bot.id]) {
      db.commands[bot.id] = {};
    }

    db.commands[bot.id][command] = {
      response,
      createdAt: Date.now()
    };

    saveDB();

    res.redirect(
      `/bots/${bot.id}`
    );
  }
);

app.get(
  "/commands/delete",
  requireLogin,
  (req, res) => {
    const botId =
      String(req.query.bot || "");

    const command =
      String(
        req.query.command || ""
      );

    const bot =
      db.bots.find(
        item =>
          item.id === botId &&
          String(item.ownerId) ===
            String(req.session.userId)
      );

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    if (db.commands[bot.id]) {
      delete db.commands[bot.id][command];
    }

    saveDB();

    res.redirect(
      `/bots/${bot.id}`
    );
  }
);

app.get(
  "/users",
  requireLogin,
  (req, res) => {
    const bot = findBot(req);

    if (!bot) {
      return res.status(404).send(
        "Bot not found"
      );
    }

    const users =
      db.botUsers[bot.id] || {};

    let list = "";

    for (const key of Object.keys(users)) {
      const user =
        users[key];

      list += `
        <div class="item">
          <strong>
            ${escapeHtml(
              [
                user.first_name,
                user.last_name
              ]
                .filter(Boolean)
                .join(" ") ||
                "بدون نام"
            )}
          </strong>

          <p>
            ID:
            ${escapeHtml(
              user.id
            )}
          </p>

          ${
            user.username
              ? `<p>@${escapeHtml(
                  user.username
                )}</p>`
              : ""
          }
        </div>
      `;
    }

    res.send(
      page(
        "کاربران",
        `
        <div class="card">
          <h1>
            کاربران ${escapeHtml(
              bot.name
            )}
          </h1>

          <p>
            تعداد:
            ${Object.keys(users).length}
          </p>
        </div>

        <div class="card">
          ${
            list ||
            "<p>هنوز کاربری وجود ندارد.</p>"
          }
        </div>
        `
      )
    );
  }
);

app.get(
  "/creator/login",
  (req, res) => {
    res.send(
      page(
        "ورود سازنده",
        `
        <div class="card">
          <h1>پنل سازنده</h1>

          <form method="post" action="/creator/login">

            <label>
              رمز سازنده
            </label>

            <input
              name="password"
              type="password"
              required
            >

            <button>
              ورود
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
        req.body.password || ""
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

            <a class="btn"
               href="/creator/login">
              بازگشت
            </a>
          </div>
          `
        )
      );
    }

    req.session.creator = true;

    res.redirect("/creator");
  }
);

app.get(
  "/creator",
  requireCreator,
  (req, res) => {
    let bots = "";

    for (const bot of db.bots) {
      bots += `
        <div class="item">
          <h3>
            ${escapeHtml(
              bot.name
            )}
          </h3>

          <p>
            مالک:
            ${escapeHtml(
              String(bot.ownerId)
            )}
          </p>

          <p>
            یوزرنیم:
            @${escapeHtml(
              bot.username
            )}
          </p>

          <p>
            Token:
          </p>

          <pre>${escapeHtml(
            bot.token
          )}</pre>

          <p>
            کاربران:
            ${
              Object.keys(
                db.botUsers[bot.id] || {}
              ).length
            }
          </p>

          <p>
            عضویت اجباری:
            ${
              bot.forceJoins?.length || 0
            }
          </p>
        </div>
      `;
    }

    res.send(
      page(
        "پنل سازنده",
        `
        <div class="card">
          <h1>پنل سازنده</h1>

          <div class="grid">
            <div class="stat">
              کاربران
              <strong>
                ${db.users.length}
              </strong>
            </div>

            <div class="stat">
              ربات‌ها
              <strong>
                ${db.bots.length}
              </strong>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>تمام ربات‌ها</h2>

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
    req.session.creator = false;
    res.redirect("/");
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "nova-proxy",
      bots: db.bots.length,
      time: new Date().toISOString()
    });
  }
);

app.use(
  (req, res) => {
    res.status(404).send(
      page(
        "404",
        `
        <div class="card">
          <h1>404</h1>
          <p>
            صفحه موردنظر پیدا نشد.
          </p>

          <a class="btn"
             href="/">
            صفحه اصلی
          </a>
        </div>
        `
      )
    );
  }
);

app.use(
  (error, req, res, next) => {
    console.error(
      "Express error:",
      error
    );

    res.status(500).send(
      page(
        "خطا",
        `
        <div class="card">
          <div class="alert error">
            خطای داخلی سرور.
          </div>
        </div>
        `
      )
    );
  }
);

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
