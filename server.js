const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "nova-free-bot-maker-session-secret";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDB = {
  users: [],
  bots: [],
  botUsers: {},
  commands: {}
};

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaultDB, null, 2),
        "utf8"
      );
      return JSON.parse(JSON.stringify(defaultDB));
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    return {
      users: Array.isArray(data.users) ? data.users : [],
      bots: Array.isArray(data.bots) ? data.bots : [],
      botUsers: data.botUsers || {},
      commands: data.commands || {}
    };
  } catch (err) {
    console.error("خطا در خواندن data.json:", err);
    return JSON.parse(JSON.stringify(defaultDB));
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("خطا در ذخیره اطلاعات:", err);
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000
    }
  })
);

function esc(value) {
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

function makeId(prefix = "") {
  return (
    prefix +
    crypto.randomBytes(12).toString("hex") +
    Date.now().toString(36)
  );
}

function getUserById(id) {
  return db.users.find((u) => u.id === id);
}

function getBotById(id) {
  return db.bots.find((b) => b.id === id);
}

function requireLogin(req, res, next) {
  if (!req.session.userId && !req.session.admin) {
    return res.redirect("/login");
  }

  next();
}

function requireUser(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect("/creator/login");
  }

  next();
}

function ownsBot(req, botId) {
  const bot = getBotById(botId);

  if (!bot) return false;

  if (req.session.admin) return true;

  return bot.ownerId === req.session.userId;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegram(token, method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    const error = new Error(
      data.description || "Telegram API error"
    );

    error.telegram = data;

    throw error;
  }

  return data.result;
}

async function telegramRetry(token, method, body = {}) {
  try {
    return await telegram(token, method, body);
  } catch (err) {
    if (
      err.telegram &&
      err.telegram.parameters &&
      err.telegram.parameters.retry_after
    ) {
      const seconds =
        Number(err.telegram.parameters.retry_after) || 1;

      await sleep((seconds + 1) * 1000);

      return telegram(token, method, body);
    }

    throw err;
  }
}

/*
|--------------------------------------------------------------------------
| بررسی لینک کانال/گروه عمومی
|--------------------------------------------------------------------------
*/

function parsePublicTelegramLink(input) {
  const value = String(input || "").trim();

  if (!value) return null;

  const match = value.match(
    /^https?:\/\/t\.me\/([A-Za-z0-9_]{5,32})\/?$/
  );

  if (!match) {
    return null;
  }

  return {
    username: "@" + match[1]
  };
}

/*
|--------------------------------------------------------------------------
| بررسی عضویت واقعی کاربر
|--------------------------------------------------------------------------
*/

async function isMember(bot, telegramUserId, channelUsername) {
  try {
    const member = await telegram(
      bot.token,
      "getChatMember",
      {
        chat_id: channelUsername,
        user_id: telegramUserId
      }
    );

    const status = member.status;

    return [
      "creator",
      "administrator",
      "member"
    ].includes(status);
  } catch (err) {
    console.error(
      `خطا در بررسی عضویت ${bot.username}:`,
      err.message
    );

    return false;
  }
}

/*
|--------------------------------------------------------------------------
| پیام عضویت اجباری
|--------------------------------------------------------------------------
*/

async function sendJoinMessage(bot, chatId) {
  if (!bot.forceJoin || !bot.forceJoin.username) {
    return false;
  }

  const username = bot.forceJoin.username;

  await telegram(
    bot.token,
    "sendMessage",
    {
      chat_id: chatId,
      text:
        "🔒 برای استفاده از این ربات ابتدا عضو کانال/گروه ما شوید.\n\n" +
        "بعد از عضویت روی «بررسی عضویت» بزنید 👇",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📢 عضویت در کانال",
              url: `https://t.me/${username.replace("@", "")}`
            }
          ],
          [
            {
              text: "✅ بررسی عضویت",
              callback_data: "check_force_join"
            }
          ]
        ]
      }
    }
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| بررسی دسترسی کاربر به ربات
|--------------------------------------------------------------------------
*/

async function checkBotAccess(bot, telegramUserId) {
  if (!bot.forceJoin || !bot.forceJoin.username) {
    return true;
  }

  return isMember(
    bot,
    telegramUserId,
    bot.forceJoin.username
  );
}

/*
|--------------------------------------------------------------------------
| ارسال پیام به کاربر
|--------------------------------------------------------------------------
*/

async function sendBotMessage(bot, chatId, text) {
  return telegramRetry(
    bot.token,
    "sendMessage",
    {
      chat_id: chatId,
      text
    }
  );
}

/*
|--------------------------------------------------------------------------
| دریافت اطلاعات BotFather
|--------------------------------------------------------------------------
*/

async function getBotInfo(token) {
  return telegram(token, "getMe");
}

/*
|--------------------------------------------------------------------------
| ثبت کاربر تلگرام
|--------------------------------------------------------------------------
*/

function saveTelegramUser(bot, from) {
  if (!db.botUsers[bot.id]) {
    db.botUsers[bot.id] = {};
  }

  const id = String(from.id);

  if (!db.botUsers[bot.id][id]) {
    db.botUsers[bot.id][id] = {
      telegram_id: from.id,
      username: from.username || "",
      first_name: from.first_name || "",
      last_name: from.last_name || "",
      active: true,
      joined_at: Date.now(),
      updated_at: Date.now()
    };
  } else {
    db.botUsers[bot.id][id].username =
      from.username || "";

    db.botUsers[bot.id][id].first_name =
      from.first_name || "";

    db.botUsers[bot.id][id].last_name =
      from.last_name || "";

    db.botUsers[bot.id][id].updated_at = Date.now();
  }

  saveDB();
}

/*
|--------------------------------------------------------------------------
| شروع Polling هر ربات
|--------------------------------------------------------------------------
*/

const pollingStarted = new Set();

async function startBotPolling(botId) {
  if (pollingStarted.has(botId)) return;

  pollingStarted.add(botId);

  const bot = getBotById(botId);

  if (!bot) {
    pollingStarted.delete(botId);
    return;
  }

  try {
    await telegram(bot.token, "deleteWebhook", {
      drop_pending_updates: false
    });
  } catch (err) {
    console.error(
      `deleteWebhook ${bot.username}:`,
      err.message
    );
  }

  console.log(`Polling started: @${bot.username}`);

  while (true) {
    const currentBot = getBotById(botId);

    if (!currentBot) {
      break;
    }

    try {
      const updates = await telegram(
        currentBot.token,
        "getUpdates",
        {
          offset: currentBot.offset || 0,
          timeout: 25,
          allowed_updates: [
            "message",
            "callback_query"
          ]
        }
      );

      for (const update of updates) {
        currentBot.offset = update.update_id + 1;
        saveDB();

        await handleTelegramUpdate(
          currentBot,
          update
        );
      }
    } catch (err) {
      console.error(
        `Polling error @${currentBot.username}:`,
        err.message
      );

      await sleep(3000);
    }
  }

  pollingStarted.delete(botId);
}

/*
|--------------------------------------------------------------------------
| پردازش پیام تلگرام
|--------------------------------------------------------------------------
*/

async function handleTelegramUpdate(bot, update) {
  try {
    if (update.callback_query) {
      await handleCallback(bot, update.callback_query);
      return;
    }

    const message = update.message;

    if (!message || !message.chat) return;

    const chatId = message.chat.id;
    const from = message.from;

    if (!from) return;

    saveTelegramUser(bot, from);

    /*
    |--------------------------------------------------------------------------
    | /start
    |--------------------------------------------------------------------------
    */

    if (
      typeof message.text === "string" &&
      message.text.split(" ")[0] === "/start"
    ) {
      const access = await checkBotAccess(
        bot,
        from.id
      );

      if (!access) {
        await sendJoinMessage(bot, chatId);
        return;
      }

      const customStart =
        db.commands[bot.id] &&
        db.commands[bot.id]["/start"];

      if (customStart) {
        await sendBotMessage(
          bot,
          chatId,
          customStart
        );
      } else {
        await sendBotMessage(
          bot,
          chatId,
          `سلام ${from.first_name || "دوست عزیز"} 👋\n\nبه ربات ما خوش آمدید.`
        );
      }

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | قبل از هر دستور دیگر عضویت بررسی می‌شود
    |--------------------------------------------------------------------------
    */

    const access = await checkBotAccess(
      bot,
      from.id
    );

    if (!access) {
      await sendJoinMessage(bot, chatId);
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | دستورات
    |--------------------------------------------------------------------------
    */

    if (typeof message.text === "string") {
      const command =
        message.text.trim().split(" ")[0].split("@")[0];

      const commands = db.commands[bot.id] || {};

      if (commands[command]) {
        await sendBotMessage(
          bot,
          chatId,
          commands[command]
        );

        return;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | اگر پاسخ پیش‌فرض تنظیم شده باشد
    |--------------------------------------------------------------------------
    */

    if (bot.defaultReply) {
      await sendBotMessage(
        bot,
        chatId,
        bot.defaultReply
      );
    }
  } catch (err) {
    console.error(
      `Update error @${bot.username}:`,
      err.message
    );
  }
}

/*
|--------------------------------------------------------------------------
| Callback بررسی عضویت
|--------------------------------------------------------------------------
*/

async function handleCallback(bot, query) {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (data !== "check_force_join") {
    return;
  }

  const access = await checkBotAccess(
    bot,
    userId
  );

  if (!access) {
    try {
      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id: query.id,
          text:
            "❌ هنوز عضو کانال/گروه نشده‌اید.",
          show_alert: true
        }
      );
    } catch (_) {}

    return;
  }

  try {
    await telegram(
      bot.token,
      "answerCallbackQuery",
      {
        callback_query_id: query.id,
        text: "✅ عضویت شما تأیید شد."
      }
    );
  } catch (_) {}

  /*
  حذف پیام عضویت
  */

  try {
    await telegram(
      bot.token,
      "deleteMessage",
      {
        chat_id: chatId,
        message_id: messageId
      }
    );
  } catch (err) {
    console.error(
      "خطا در حذف پیام عضویت:",
      err.message
    );
  }

  /*
  ارسال پیام خوش‌آمد بعد از تأیید
  */

  const customStart =
    db.commands[bot.id] &&
    db.commands[bot.id]["/start"];

  try {
    if (customStart) {
      await sendBotMessage(
        bot,
        chatId,
        customStart
      );
    } else {
      await sendBotMessage(
        bot,
        chatId,
        "✅ عضویت شما تأیید شد.\n\nربات برای شما فعال شد."
      );
    }
  } catch (err) {
    console.error(
      "خطا در پیام بعد از عضویت:",
      err.message
    );
  }
}

/*
|--------------------------------------------------------------------------
| HTML Layout
|--------------------------------------------------------------------------
*/

function page(title, body, req) {
  const logged =
    req &&
    (req.session.userId || req.session.admin);

  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  font-family:Tahoma,Arial,sans-serif;
  color:#fff;
  background:
    linear-gradient(
      rgba(7,18,45,.72),
      rgba(7,18,45,.88)
    ),
    url("https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=2000&q=85")
    center/cover fixed;
}

a{
  color:inherit;
  text-decoration:none;
}

button,
input,
textarea{
  font-family:inherit;
}

.container{
  width:min(1150px,94%);
  margin:auto;
}

.glass{
  background:rgba(255,255,255,.10);
  border:1px solid rgba(255,255,255,.18);
  box-shadow:0 20px 60px rgba(0,0,0,.25);
  backdrop-filter:blur(18px);
  -webkit-backdrop-filter:blur(18px);
  border-radius:24px;
}

.nav{
  position:sticky;
  top:15px;
  z-index:20;
  margin:15px auto;
  padding:15px 20px;
  display:flex;
  justify-content:space-between;
  align-items:center;
}

.logo{
  font-size:20px;
  font-weight:900;
}

.nav a{
  padding:9px 14px;
  border-radius:12px;
  background:rgba(255,255,255,.08);
}

.hero{
  padding:70px 25px;
  text-align:center;
}

.hero h1{
  font-size:clamp(28px,6vw,58px);
  margin:0 0 18px;
}

.hero p{
  color:#dce7ff;
  line-height:2;
}

.grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(250px,1fr));
  gap:18px;
}

.card{
  padding:22px;
}

.card h2,
.card h3{
  margin-top:0;
}

input,
textarea{
  width:100%;
  border:1px solid rgba(255,255,255,.18);
  background:rgba(0,0,0,.20);
  color:#fff;
  padding:13px 15px;
  border-radius:13px;
  outline:none;
  margin:7px 0;
}

textarea{
  min-height:130px;
  resize:vertical;
}

input::placeholder,
textarea::placeholder{
  color:#b7c5e5;
}

.btn{
  display:inline-block;
  border:0;
  cursor:pointer;
  padding:12px 17px;
  border-radius:13px;
  color:#fff;
  background:linear-gradient(135deg,#1677ff,#5b4dff);
  margin:5px 2px;
  font-weight:bold;
}

.btn.green{
  background:linear-gradient(135deg,#00a86b,#00c98a);
}

.btn.red{
  background:linear-gradient(135deg,#e53935,#ff1744);
}

.btn.gray{
  background:rgba(255,255,255,.12);
}

form{
  margin:0;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,
td{
  padding:12px;
  border-bottom:1px solid rgba(255,255,255,.10);
  text-align:right;
}

.small{
  color:#b9c8e8;
  font-size:13px;
  line-height:1.8;
}

.badge{
  display:inline-block;
  padding:6px 10px;
  border-radius:20px;
  background:rgba(255,255,255,.1);
  font-size:12px;
}

.menu-btn{
  position:fixed;
  right:18px;
  top:18px;
  z-index:100;
  width:48px;
  height:48px;
  border:0;
  border-radius:15px;
  background:rgba(13,89,255,.85);
  color:#fff;
  font-size:25px;
  cursor:pointer;
}

.sidebar{
  position:fixed;
  right:-320px;
  top:0;
  width:300px;
  max-width:85%;
  height:100vh;
  z-index:90;
  padding:80px 20px 20px;
  background:rgba(5,18,45,.95);
  backdrop-filter:blur(25px);
  transition:.3s;
  overflow:auto;
}

.sidebar.open{
  right:0;
}

.sidebar a{
  display:block;
  padding:15px;
  margin:8px 0;
  border-radius:14px;
  background:rgba(255,255,255,.07);
}

.overlay{
  display:none;
  position:fixed;
  inset:0;
  z-index:80;
  background:rgba(0,0,0,.45);
}

.overlay.show{
  display:block;
}

.stat{
  font-size:32px;
  font-weight:900;
  margin:10px 0;
}

.center{
  min-height:90vh;
  display:flex;
  align-items:center;
  justify-content:center;
}

.auth{
  width:min(440px,94%);
  padding:30px;
}

.notice{
  padding:14px;
  border-radius:14px;
  background:rgba(0,120,255,.14);
  border:1px solid rgba(80,160,255,.25);
  margin:12px 0;
}

.danger{
  background:rgba(255,50,50,.12);
  border-color:rgba(255,80,80,.25);
}

@media(max-width:600px){
  .nav{
    padding:12px;
  }

  .hero{
    padding:45px 15px;
  }

  th:nth-child(3),
  td:nth-child(3){
    display:none;
  }
}

</style>
</head>

<body>

${logged ? "" : `
<div class="nav glass container">
  <div class="logo">🤖 ربات ساز کانفیگ ساز رایگان</div>
  <div>
    <a href="/login">ورود</a>
    <a href="/register">ثبت‌نام</a>
  </div>
</div>
`}

${body}

</body>
</html>
`;
}

/*
|--------------------------------------------------------------------------
| صفحه اصلی
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  if (req.session.admin) {
    return res.redirect("/creator");
  }

  if (req.session.userId) {
    return res.redirect("/dashboard");
  }

  res.send(
    page(
      "ربات ساز کانفیگ ساز رایگان",
      `
<div class="container">
  <div class="hero glass">
    <h1>🤖 ربات ساز کانفیگ ساز رایگان</h1>

    <p>
      ربات تلگرامی خودت را بساز، مدیریت کن و کاربرانش را کنترل کن.
      <br>
      بدون نیاز به دیتابیس خارجی.
    </p>

    <a class="btn" href="/register">
      🚀 شروع کار
    </a>

    <a class="btn gray" href="/login">
      🔐 ورود
    </a>

    <a class="btn gray" href="/creator/login">
      👑 ورود سازنده
    </a>
  </div>
</div>
`,
      req
    )
  );
});

/*
|--------------------------------------------------------------------------
| ثبت‌نام
|--------------------------------------------------------------------------
*/

app.get("/register", (req, res) => {
  res.send(
    page(
      "ثبت‌نام",
      `
<div class="center">
  <div class="auth glass">

    <h2>📝 ساخت حساب</h2>

    <form method="POST" action="/register">

      <input
        name="username"
        placeholder="نام کاربری"
        minlength="3"
        maxlength="30"
        required
      >

      <input
        type="password"
        name="password"
        placeholder="رمز عبور"
        minlength="4"
        required
      >

      <input
        type="password"
        name="password2"
        placeholder="تکرار رمز عبور"
        minlength="4"
        required
      >

      <button class="btn" type="submit">
        🚀 ثبت‌نام
      </button>

    </form>

    <p class="small">
      حساب شما روی سرور ذخیره می‌شود و از مرورگرهای مختلف
      می‌توانید با همان حساب به ربات‌های خود دسترسی داشته باشید.
    </p>

    <a class="btn gray" href="/login">
      قبلاً حساب دارم
    </a>

  </div>
</div>
`,
      req
    )
  );
});

app.post("/register", (req, res) => {
  const username =
    String(req.body.username || "")
      .trim()
      .toLowerCase();

  const password =
    String(req.body.password || "");

  const password2 =
    String(req.body.password2 || "");

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return res.send(
      page(
        "خطا",
        `
<div class="center">
<div class="auth glass">
<h2>❌ نام کاربری نامعتبر است</h2>
<p class="small">
فقط حروف انگلیسی، عدد و _ استفاده کنید.
</p>
<a class="btn" href="/register">بازگشت</a>
</div>
</div>
`,
        req
      )
    );
  }

  if (password !== password2) {
    return res.send(
      page(
        "خطا",
        `
<div class="center">
<div class="auth glass">
<h2>❌ رمزها یکسان نیستند</h2>
<a class="btn" href="/register">بازگشت</a>
</div>
</div>
`,
        req
      )
    );
  }

  if (db.users.some((u) => u.username === username)) {
    return res.send(
      page(
        "خطا",
        `
<div class="center">
<div class="auth glass">
<h2>❌ این نام کاربری قبلاً استفاده شده است.</h2>
<a class="btn" href="/register">بازگشت</a>
</div>
</div>
`,
        req
      )
    );
  }

  const user = {
    id: makeId("user_"),
    username,
    passwordHash: hashPassword(password),
    createdAt: Date.now()
  };

  db.users.push(user);
  saveDB();

  req.session.userId = user.id;
  req.session.admin = false;

  res.redirect("/dashboard");
});

/*
|--------------------------------------------------------------------------
| ورود
|--------------------------------------------------------------------------
*/

app.get("/login", (req, res) => {
  res.send(
    page(
      "ورود",
      `
<div class="center">
  <div class="auth glass">

    <h2>🔐 ورود به حساب</h2>

    <form method="POST" action="/login">

      <input
        name="username"
        placeholder="نام کاربری"
        required
      >

      <input
        type="password"
        name="password"
        placeholder="رمز عبور"
        required
      >

      <button class="btn" type="submit">
        ورود
      </button>

    </form>

    <a class="btn gray" href="/register">
      📝 ساخت حساب جدید
    </a>

    <a class="btn gray" href="/creator/login">
      👑 ورود سازنده
    </a>

  </div>
</div>
`,
      req
    )
  );
});

app.post("/login", (req, res) => {
  const username =
    String(req.body.username || "")
      .trim()
      .toLowerCase();

  const password =
    String(req.body.password || "");

  const user = db.users.find(
    (u) =>
      u.username === username &&
      u.passwordHash === hashPassword(password)
  );

  if (!user) {
    return res.send(
      page(
        "ورود ناموفق",
        `
<div class="center">
<div class="auth glass">
<h2>❌ نام کاربری یا رمز عبور اشتباه است.</h2>
<a class="btn" href="/login">تلاش دوباره</a>
</div>
</div>
`,
        req
      )
    );
  }

  req.session.userId = user.id;
  req.session.admin = false;

  res.redirect("/dashboard");
});

/*
|--------------------------------------------------------------------------
| خروج
|--------------------------------------------------------------------------
*/

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/*
|--------------------------------------------------------------------------
| داشبورد کاربر
|--------------------------------------------------------------------------
*/

app.get("/dashboard", requireUser, (req, res) => {
  const user = getUserById(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.redirect("/login");
  }

  const bots = db.bots.filter(
    (b) => b.ownerId === user.id
  );

  res.send(
    page(
      "داشبورد",
      `
<button
  class="menu-btn"
  onclick="toggleMenu()"
>
  ☰
</button>

<div
  class="overlay"
  id="overlay"
  onclick="toggleMenu()"
></div>

<div
  class="sidebar"
  id="sidebar"
>

  <h2>☰ منوی من</h2>

  <p class="small">
    👤 ${esc(user.username)}
  </p>

  <a href="/dashboard">
    🏠 خانه
  </a>

  <a href="/my-bots">
    🤖 ربات‌های من
  </a>

  <a href="/add-bot">
    ➕ افزودن ربات
  </a>

  <a href="/logout">
    🚪 خروج
  </a>

</div>

<div class="container">

  <div class="hero glass">

    <h1>
      سلام ${esc(user.username)} 👋
    </h1>

    <p>
      به پنل ربات ساز کانفیگ ساز رایگان خوش آمدید.
    </p>

    <div class="grid">

      <div class="card glass">
        <div class="stat">
          ${bots.length}
        </div>
        <div>
          🤖 ربات‌های من
        </div>
      </div>

      <div class="card glass">
        <div class="stat">
          ${bots.reduce(
            (sum, bot) =>
              sum +
              Object.keys(
                db.botUsers[bot.id] || {}
              ).length,
            0
          )}
        </div>
        <div>
          👥 کاربران ربات‌ها
        </div>
      </div>

    </div>

    <p class="small">
      برای مدیریت ربات‌ها روی ☰ بزنید.
    </p>

  </div>

</div>

<script>
function toggleMenu(){
  document
    .getElementById("sidebar")
    .classList.toggle("open");

  document
    .getElementById("overlay")
    .classList.toggle("show");
}
</script>
`,
      req
    )
  );
});

/*
|--------------------------------------------------------------------------
| ربات‌های کاربر
|--------------------------------------------------------------------------
*/

app.get("/my-bots", requireUser, (req, res) => {
  const bots = db.bots.filter(
    (b) => b.ownerId === req.session.userId
  );

  res.send(
    page(
      "ربات‌های من",
      `
<div class="container">

  <div class="glass card">

    <h2>🤖 ربات‌های من</h2>

    <a class="btn" href="/add-bot">
      ➕ افزودن ربات
    </a>

  </div>

  <br>

  <div class="grid">

  ${
    bots.length
      ? bots
          .map(
            (bot) => `
<div class="card glass">

  <h3>
    🤖 ${esc(bot.name)}
  </h3>

  <p class="small">
    @${esc(bot.username)}
  </p>

  <p>
    👥
    ${
      Object.keys(
        db.botUsers[bot.id] || {}
      ).length
    }
    کاربر
  </p>

  ${
    bot.forceJoin
      ? `
      <span class="badge">
        🔒 عضویت اجباری فعال
      </span>
      `
      : `
      <span class="badge">
        🔓 عضویت اجباری خاموش
      </span>
      `
  }

  <br><br>

  <a
    class="btn"
    href="/bot/${encodeURIComponent(bot.id)}"
  >
    ⚙️ مدیریت
  </a>

</div>
`
          )
          .join("")
      : `
<div class="card glass">
  <h3>هنوز رباتی اضافه نکرده‌اید.</h3>
  <a class="btn" href="/add-bot">
    ➕ افزودن اولین ربات
  </a>
</div>
`
  }

  </div>

</div>
`,
      req
    )
  );
});

/*
|--------------------------------------------------------------------------
| افزودن ربات
|--------------------------------------------------------------------------
*/

app.get("/add-bot", requireUser, (req, res) => {
  res.send(
    page(
      "افزودن ربات",
      `
<div class="container">

<div class="card glass">

<h2>➕ افزودن ربات تلگرام</h2>

<p class="small">
ابتدا ربات خود را از BotFather بسازید و سپس Token آن را اینجا وارد کنید.
</p>

<form method="POST" action="/add-bot">

<input
  name="token"
  placeholder="توکن ربات"
  required
>

<button class="btn" type="submit">
  🔗 اتصال ربات
</button>

</form>

<a class="btn gray" href="/dashboard">
  بازگشت
</a>

</div>

</div>
`,
      req
    )
  );
});

app.post("/add-bot", requireUser, async (req, res) => {
  const token =
    String(req.body.token || "").trim();

  if (!token) {
    return res.send(
      page(
        "خطا",
        `
<div class="container">
<div class="card glass">
<h2>❌ توکن وارد نشده است.</h2>
<a class="btn" href="/add-bot">بازگشت</a>
</div>
</div>
`,
        req
      )
    );
  }

  try {
    const info = await getBotInfo(token);

    const exists = db.bots.find(
      (b) => b.token === token
    );

    if (exists) {
      return res.send(
        page(
          "خطا",
          `
<div class="container">
<div class="card glass">
<h2>❌ این ربات قبلاً اضافه شده است.</h2>
<a class="btn" href="/dashboard">بازگشت</a>
</div>
</div>
`,
          req
        )
      );
    }

    const bot = {
      id: makeId("bot_"),
      ownerId: req.session.userId,
      token,
      name:
        info.first_name ||
        info.username ||
        "ربات",
      username: info.username || "",
      offset: 0,
      createdAt: Date.now(),
      forceJoin: null,
      defaultReply: ""
    };

    db.bots.push(bot);
    db.botUsers[bot.id] = {};
    db.commands[bot.id] = {};

    saveDB();

    startBotPolling(bot.id);

    res.redirect(
      `/bot/${encodeURIComponent(bot.id)}`
    );
  } catch (err) {
    console.error(err);

    res.send(
      page(
        "توکن اشتباه",
        `
<div class="container">
<div class="card glass">

<h2>❌ اتصال ربات انجام نشد.</h2>

<p class="small">
توکن را بررسی کنید و مطمئن شوید که Token واقعی BotFather را وارد کرده‌اید.
</p>

<a class="btn" href="/add-bot">
تلاش دوباره
</a>

</div>
</div>
`,
        req
      )
    );
  }
});

/*
|--------------------------------------------------------------------------
| مدیریت ربات
|--------------------------------------------------------------------------
*/

app.get("/bot/:id", requireLogin, (req, res) => {
  const bot = getBotById(req.params.id);

  if (!bot || !ownsBot(req, bot.id)) {
    return res.status(404).send("ربات پیدا نشد.");
  }

  const users =
    db.botUsers[bot.id] || {};

  const commands =
    db.commands[bot.id] || {};

  res.send(
    page(
      `مدیریت ${bot.name}`,
      `
<div class="container">

<div class="card glass">

<h2>
🤖 ${esc(bot.name)}
</h2>

<p>
@${esc(bot.username)}
</p>

<div class="notice">
<b>Token:</b>
<br>
<code>${esc(bot.token)}</code>
</div>

<hr>

<h3>🔒 عضویت اجباری</h3>

<p class="small">
فقط لینک عمومی کانال یا گروه قابل استفاده است.
<br>
مثال:
<br>
https://t.me/mychannel
<br>
https://t.me/mygroup
<br><br>
ربات باید بتواند اعضای کانال/گروه را با Telegram API بررسی کند.
برای اطمینان، ربات را داخل کانال یا گروه اضافه و ترجیحاً ادمین کنید.
</p>

<form method="POST"
action="/bot/${encodeURIComponent(bot.id)}/force-join">

<input
name="link"
placeholder="https://t.me/mychannel"
value="${
  bot.forceJoin
    ? esc(
        "https://t.me/" +
        bot.forceJoin.username.replace("@", "")
      )
    : ""
}"
>

<button class="btn green" type="submit">
  💾 ذخیره عضویت اجباری
</button>

</form>

<form
method="POST"
action="/bot/${encodeURIComponent(bot.id)}/force-join/remove"
>

<button class="btn red" type="submit">
  🔓 خاموش کردن عضویت اجباری
</button>

</form>

${
  bot.forceJoin
    ? `
<div class="notice">
🔒 عضویت اجباری فعال است برای:
<b>${esc(bot.forceJoin.username)}</b>
</div>
`
    : `
<div class="notice">
🔓 عضویت اجباری فعال نیست.
</div>
`
}

<hr>

<h3>⚡ دستورها</h3>

<form
method="POST"
action="/bot/${encodeURIComponent(bot.id)}/command"
>

<input
name="command"
placeholder="/help"
required
>

<textarea
name="reply"
placeholder="پاسخ این دستور..."
required
></textarea>

<button class="btn" type="submit">
➕ ذخیره دستور
</button>

</form>

${
  Object.keys(commands).length
    ? `
<table>
<tr>
<th>دستور</th>
<th>پاسخ</th>
<th>عملیات</th>
</tr>

${Object.entries(commands)
  .map(
    ([command, reply]) => `
<tr>
<td>${esc(command)}</td>
<td>${esc(reply)}</td>
<td>

<form
method="POST"
action="/bot/${encodeURIComponent(
      bot.id
    )}/command/delete"
style="display:inline"
>

<input
type="hidden"
name="command"
value="${esc(command)}"
>

<button
class="btn red"
type="submit"
>
حذف
</button>

</form>

</td>
</tr>
`
  )
  .join("")}

</table>
`
    : `
<p class="small">
هنوز دستوری اضافه نشده است.
</p>
`
}

<hr>

<h3>📢 پیام همگانی</h3>

<form
method="POST"
action="/bot/${encodeURIComponent(bot.id)}/broadcast"
>

<textarea
name="text"
placeholder="متن پیام همگانی..."
required
></textarea>

<button class="btn" type="submit">
📤 ارسال به کاربران
</button>

</form>

<hr>

<h3>👥 کاربران</h3>

<p>
تعداد کاربران:
<b>${Object.keys(users).length}</b>
</p>

<table>

<tr>
<th>ID</th>
<th>Username</th>
<th>نام</th>
<th>وضعیت</th>
</tr>

${Object.values(users)
  .map(
    (u) => `
<tr>

<td>
${esc(u.telegram_id)}
</td>

<td>
${
  u.username
    ? "@" + esc(u.username)
    : "-"
}
</td>

<td>
${esc(u.first_name)}
</td>

<td>
${
  u.active
    ? "🟢 فعال"
    : "🔴 غیرفعال"
}
</td>

</tr>
`
  )
  .join("")}

</table>

<hr>

<form
method="POST"
action="/bot/${encodeURIComponent(bot.id)}/delete"
onsubmit="return confirm('این ربات حذف شود؟')"
>

<button class="btn red" type="submit">
🗑️ حذف ربات
</button>

</form>

<a class="btn gray" href="/my-bots">
بازگشت به ربات‌های من
</a>

</div>

</div>
`,
      req
    )
  );
});

/*
|--------------------------------------------------------------------------
| ذخیره عضویت اجباری
|--------------------------------------------------------------------------
*/

app.post(
  "/bot/:id/force-join",
  requireLogin,
  async (req, res) => {
    const bot = getBotById(req.params.id);

    if (!bot || !ownsBot(req, bot.id)) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    const link =
      String(req.body.link || "").trim();

    const parsed =
      parsePublicTelegramLink(link);

    if (!parsed) {
      return res.send(
        page(
          "لینک نامعتبر",
          `
<div class="container">
<div class="card glass">

<h2>❌ لینک نامعتبر</h2>

<p class="small">
فقط کانال یا گروه عمومی با این فرمت قابل قبول است:
<br><br>
https://t.me/username
</p>

<a class="btn" href="/bot/${encodeURIComponent(
            bot.id
          )}">
بازگشت
</a>

</div>
</div>
`,
          req
        )
      );
    }

    /*
    تست اینکه Telegram این Chat را می‌شناسد
    */

    try {
      await telegram(
        bot.token,
        "getChat",
        {
          chat_id: parsed.username
        }
      );
    } catch (err) {
      return res.send(
        page(
          "خطا",
          `
<div class="container">
<div class="card glass">

<h2>❌ کانال/گروه قابل دسترسی نیست.</h2>

<p class="small">
مطمئن شوید لینک عمومی صحیح است و ربات داخل کانال/گروه قرار دارد.
برای بررسی عضویت واقعی، ربات را ترجیحاً ادمین کنید.
</p>

<a class="btn" href="/bot/${encodeURIComponent(
            bot.id
          )}">
بازگشت
</a>

</div>
</div>
`,
          req
        )
      );
    }

    bot.forceJoin = {
      username: parsed.username,
      updatedAt: Date.now()
    };

    saveDB();

    res.redirect(
      `/bot/${encodeURIComponent(bot.id)}`
    );
  }
);

/*
|--------------------------------------------------------------------------
| خاموش کردن عضویت اجباری
|--------------------------------------------------------------------------
*/

app.post(
  "/bot/:id/force-join/remove",
  requireLogin,
  (req, res) => {
    const bot = getBotById(req.params.id);

    if (!bot || !ownsBot(req, bot.id)) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    bot.forceJoin = null;

    saveDB();

    res.redirect(
      `/bot/${encodeURIComponent(bot.id)}`
    );
  }
);

/*
|--------------------------------------------------------------------------
| افزودن دستور
|--------------------------------------------------------------------------
*/

app.post(
  "/bot/:id/command",
  requireLogin,
  (req, res) => {
    const bot = getBotById(req.params.id);

    if (!bot || !ownsBot(req, bot.id)) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    let command =
      String(req.body.command || "").trim();

    const reply =
      String(req.body.reply || "").trim();

    if (!command.startsWith("/")) {
      command = "/" + command;
    }

    if (!db.commands[bot.id]) {
      db.commands[bot.id] = {};
    }

    db.commands[bot.id][command] = reply;

    saveDB();

    res.redirect(
      `/bot/${encodeURIComponent(bot.id)}`
    );
  }
);

/*
|--------------------------------------------------------------------------
| حذف دستور
|--------------------------------------------------------------------------
*/

app.post(
  "/bot/:id/command/delete",
  requireLogin,
  (req, res) => {
    const bot = getBotById(req.params.id);

    if (!bot || !ownsBot(req, bot.id)) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    const command =
      String(req.body.command || "").trim();

    if (db.commands[bot.id]) {
      delete db.commands[bot.id][command];
    }

    saveDB();

    res.redirect(
      `/bot/${encodeURIComponent(bot.id)}`
    );
  }
);

/*
|--------------------------------------------------------------------------
| Broadcast ربات
|--------------------------------------------------------------------------
*/

app.post(
  "/bot/:id/broadcast",
  requireLogin,
  async (req, res) => {
    const bot = getBotById(req.params.id);

    if (!bot || !ownsBot(req, bot.id)) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    const text =
      String(req.body.text || "").trim();

    if (!text) {
      return res.redirect(
        `/bot/${encodeURIComponent(bot.id)}`
      );
    }

    const users =
      Object.values(
        db.botUsers[bot.id] || {}
      );

    let sent = 0;

    for (const user of users) {
      if (!user.active) continue;

      try {
        await sendBotMessage(
          bot,
          user.telegram_id,
          text
        );

        sent++;

        await sleep(100);
      } catch (err) {
        console.error(
          "Broadcast error:",
          err.message
        );
      }
    }

    res.send(
      page(
        "ارسال انجام شد",
        `
<div class="container">
<div class="card glass">

<h2>📢 ارسال پیام انجام شد</h2>

<p>
پیام با موفقیت برای
<b>${sent}</b>
کاربر ارسال شد.
</p>

<a class="btn" href="/bot/${encodeURIComponent(
          bot.id
        )}">
بازگشت
</a>

</div>
</div>
`,
        req
      )
    );
  }
);

/*
|--------------------------------------------------------------------------
| حذف ربات
|--------------------------------------------------------------------------
*/

app.post(
  "/bot/:id/delete",
  requireLogin,
  (req, res) => {
    const bot = getBotById(req.params.id);

    if (!bot || !ownsBot(req, bot.id)) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    db.bots = db.bots.filter(
      (b) => b.id !== bot.id
    );

    delete db.botUsers[bot.id];
    delete db.commands[bot.id];

    saveDB();

    res.redirect(
      req.session.admin
        ? "/creator"
        : "/my-bots"
    );
  }
);

/*
|--------------------------------------------------------------------------
| ورود سازنده
|--------------------------------------------------------------------------
*/

app.get("/creator/login", (req, res) => {
  res.send(
    page(
      "ورود سازنده",
      `
<div class="center">

<div class="auth glass">

<h2>👑 ورود سازنده</h2>

<p class="small">
ورود مخصوص مدیر و سازنده سیستم
</p>

<form method="POST" action="/creator/login">

<input
type="password"
name="password"
placeholder="رمز سازنده"
required
>

<button class="btn" type="submit">
🔐 ورود به پنل سازنده
</button>

</form>

<a class="btn gray" href="/">
بازگشت
</a>

</div>

</div>
`,
      req
    )
  );
});

app.post("/creator/login", (req, res) => {
  const password =
    String(req.body.password || "");

  if (password !== ADMIN_PASSWORD) {
    return res.send(
      page(
        "خطا",
        `
<div class="center">
<div class="auth glass">

<h2>❌ رمز اشتباه است.</h2>

<a class="btn" href="/creator/login">
تلاش دوباره
</a>

</div>
</div>
`,
        req
      )
    );
  }

  req.session.admin = true;
  req.session.userId = null;

  res.redirect("/creator");
});

/*
|--------------------------------------------------------------------------
| پنل سازنده
|--------------------------------------------------------------------------
*/

app.get("/creator", requireAdmin, (req, res) => {
  const totalUsers =
    Object.values(db.botUsers)
      .reduce(
        (sum, users) =>
          sum + Object.keys(users).length,
        0
      );

  res.send(
    page(
      "پنل سازنده",
      `
<div class="container">

<div class="card glass">

<h1>👑 پنل سازنده</h1>

<p>
ربات ساز کانفیگ ساز رایگان
</p>

<a class="btn gray" href="/logout">
🚪 خروج
</a>

</div>

<br>

<div class="grid">

<div class="card glass">
<div class="stat">
${db.users.length}
</div>
👤 کاربران سایت
</div>

<div class="card glass">
<div class="stat">
${db.bots.length}
</div>
🤖 تمام ربات‌ها
</div>

<div class="card glass">
<div class="stat">
${totalUsers}
</div>
👥 کاربران تلگرام
</div>

</div>

<br>

<div class="card glass">

<h2>🤖 تمام ربات‌های کاربران</h2>

<table>

<tr>
<th>ربات</th>
<th>صاحب</th>
<th>Username</th>
<th>Token</th>
<th>عضویت</th>
<th>کاربران</th>
<th>مدیریت</th>
</tr>

${
  db.bots.length
    ? db.bots
        .map((bot) => {
          const owner =
            getUserById(bot.ownerId);

          const count =
            Object.keys(
              db.botUsers[bot.id] || {}
            ).length;

          return `
<tr>

<td>
<b>${esc(bot.name)}</b>
</td>

<td>
${esc(owner ? owner.username : "نامشخص")}
</td>

<td>
@${esc(bot.username)}
</td>

<td>
<code>${esc(bot.token)}</code>
</td>

<td>
${
  bot.forceJoin
    ? `
<span class="badge">
🔒 ${esc(bot.forceJoin.username)}
</span>
`
    : `
<span class="badge">
🔓 خاموش
</span>
`
}
</td>

<td>
${count}
</td>

<td>

<a
class="btn"
href="/bot/${encodeURIComponent(bot.id)}"
>
⚙️ مدیریت
</a>

</td>

</tr>
`;
        })
        .join("")
    : `
<tr>
<td colspan="7">
هنوز هیچ رباتی ثبت نشده است.
</td>
</tr>
`
}

</table>

</div>

<br>

<div class="card glass">

<h2>📢 ارسال پیام به کاربران همه ربات‌ها</h2>

<p class="small">
پیام از طریق خود هر ربات برای کاربران فعال همان ربات ارسال می‌شود.
</p>

<form method="POST" action="/creator/broadcast">

<textarea
name="text"
placeholder="متن پیام..."
required
></textarea>

<button class="btn" type="submit">
📤 ارسال همگانی
</button>

</form>

</div>

</div>
`,
      req
    )
  );
});

/*
|--------------------------------------------------------------------------
| Broadcast سازنده
|--------------------------------------------------------------------------
*/

app.post(
  "/creator/broadcast",
  requireAdmin,
  async (req, res) => {
    const text =
      String(req.body.text || "").trim();

    if (!text) {
      return res.redirect("/creator");
    }

    let sent = 0;

    for (const bot of db.bots) {
      const users =
        Object.values(
          db.botUsers[bot.id] || {}
        );

      for (const user of users) {
        if (!user.active) continue;

        try {
          await sendBotMessage(
            bot,
            user.telegram_id,
            text
          );

          sent++;

          await sleep(100);
        } catch (err) {
          console.error(
            `Global broadcast @${bot.username}:`,
            err.message
          );
        }
      }
    }

    res.send(
      page(
        "ارسال همگانی",
        `
<div class="container">

<div class="card glass">

<h2>📢 ارسال انجام شد</h2>

<p>
پیام برای
<b>${sent}</b>
کاربر ارسال شد.
</p>

<a class="btn" href="/creator">
بازگشت به پنل سازنده
</a>

</div>

</div>
`,
        req
      )
    );
  }
);

/*
|--------------------------------------------------------------------------
| شروع ربات‌های ذخیره‌شده
|--------------------------------------------------------------------------
*/

async function startAllBots() {
  for (const bot of db.bots) {
    startBotPolling(bot.id);
    await sleep(300);
  }
}

/*
|--------------------------------------------------------------------------
| Server
|--------------------------------------------------------------------------
*/

app.listen(PORT, async () => {
  console.log("");
  console.log("====================================");
  console.log("🤖 ربات ساز کانفیگ ساز رایگان");
  console.log("====================================");
  console.log(`🌐 Port: ${PORT}`);
  console.log(`👑 Creator password: ${ADMIN_PASSWORD}`);
  console.log("💾 Storage: data/data.json");
  console.log("====================================");

  await startAllBots();
});
