const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = "mmkk1122";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {
  bots: [],
  users: {},
  commands: {}
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }

    db.bots = Array.isArray(db.bots) ? db.bots : [];
    db.users = db.users || {};
    db.commands = db.commands || {};
  } catch (e) {
    console.log("خطا در خواندن اطلاعات:", e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2),
      "utf8"
    );
  } catch (e) {
    console.log("خطا در ذخیره اطلاعات:", e.message);
  }
}

loadData();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "nova-secret-mmkk1122",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function requireLogin(req, res, next) {
  if (!req.session.loggedIn) {
    return res.redirect("/login");
  }

  next();
}

function getUsers(botId) {
  if (!db.users[botId]) {
    db.users[botId] = {};
  }

  return db.users[botId];
}

function getCommands(botId) {
  if (!db.commands[botId]) {
    db.commands[botId] = {};
  }

  return db.commands[botId];
}

async function telegram(method, token, params = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data.result;
}

function wait(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function checkToken(token) {
  return await telegram("getMe", token);
}

/* =========================
   صفحه اصلی قالب
========================= */

function layout(title, content) {
  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>${escapeHtml(title)}</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  font-family:
    Tahoma,
    Arial,
    sans-serif;

  color:white;

  background-image:
    linear-gradient(
      rgba(20,45,75,.42),
      rgba(4,18,38,.72)
    ),
    url("https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=2400&q=90");

  background-size:cover;
  background-position:center;
  background-attachment:fixed;
}

body::before{
  content:"";
  position:fixed;
  inset:0;
  background:
    radial-gradient(
      circle at 75% 15%,
      rgba(255,215,120,.22),
      transparent 25%
    );
  pointer-events:none;
}

.container{
  position:relative;
  z-index:2;
  width:min(1200px,94%);
  margin:auto;
  padding:25px 0 60px;
}

.header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:15px;
  margin-bottom:22px;
}

.logo{
  font-size:25px;
  font-weight:bold;
}

.logo span{
  color:#5fc7ff;
}

.card{
  background:rgba(8,25,50,.72);
  border:1px solid rgba(255,255,255,.14);
  border-radius:24px;
  padding:22px;
  margin-bottom:20px;
  box-shadow:
    0 20px 60px rgba(0,0,0,.32);
  backdrop-filter:blur(16px);
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(auto-fit,minmax(220px,1fr));
  gap:15px;
}

.stat{
  padding:22px;
  border-radius:20px;
  background:
    linear-gradient(
      135deg,
      rgba(66,174,255,.20),
      rgba(255,255,255,.04)
    );
  border:1px solid rgba(255,255,255,.12);
}

.stat-title{
  color:#c8d7e8;
}

.stat-number{
  margin-top:8px;
  font-size:34px;
  font-weight:bold;
  color:#62caff;
}

input,
textarea{
  width:100%;
  padding:14px;
  margin:7px 0 14px;

  color:white;
  background:rgba(0,0,0,.25);

  border:1px solid rgba(255,255,255,.16);
  border-radius:14px;

  outline:none;
  font-family:inherit;
}

textarea{
  min-height:130px;
  resize:vertical;
}

input::placeholder,
textarea::placeholder{
  color:#9eb0c5;
}

button,
.btn{
  display:inline-block;
  padding:12px 18px;
  margin:4px;

  border:0;
  border-radius:13px;

  color:white;
  background:#1398ed;

  font-weight:bold;
  text-decoration:none;
  cursor:pointer;
}

button:hover,
.btn:hover{
  background:#087dcc;
}

.green{
  background:#11a678;
}

.red{
  background:#d63c52;
}

.gray{
  background:#46576b;
}

.orange{
  background:#df9b29;
}

.bot{
  padding:20px;
  margin-bottom:15px;

  border-radius:20px;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.11);
}

.bot-title{
  font-size:21px;
  font-weight:bold;
}

.muted{
  color:#aebed0;
}

.token{
  margin-top:12px;
  padding:12px;

  direction:ltr;
  text-align:left;

  word-break:break-all;

  color:#bce5ff;
  background:rgba(0,0,0,.28);

  border-radius:12px;
  font-family:monospace;
}

.badge{
  display:inline-block;
  padding:5px 10px;
  border-radius:30px;

  color:#59e5b2;
  background:rgba(0,190,130,.15);

  font-size:12px;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,
td{
  padding:12px 8px;
  border-bottom:
    1px solid rgba(255,255,255,.10);
  text-align:right;
}

.login{
  max-width:430px;
  margin:90px auto;
}

.center{
  text-align:center;
}

hr{
  border:0;
  border-top:
    1px solid rgba(255,255,255,.10);
  margin:22px 0;
}

.small{
  font-size:12px;
}

.notice{
  padding:15px;
  border-radius:15px;
  margin-bottom:18px;

  background:rgba(255,190,50,.10);
  border:1px solid rgba(255,190,50,.18);

  color:#ffe2a1;
}

@media(max-width:650px){

  .container{
    width:94%;
    padding-top:15px;
  }

  .header{
    align-items:flex-start;
  }

  .logo{
    font-size:20px;
  }

  .card{
    padding:16px;
  }

  button,
  .btn{
    width:100%;
    margin:4px 0;
  }

  .token{
    font-size:12px;
  }

  table{
    font-size:12px;
  }
}

</style>

</head>

<body>

<div class="container">

${content}

</div>

</body>
</html>
`;
}

/* =========================
   Login
========================= */

app.get("/login", (req, res) => {

  if (req.session.loggedIn) {
    return res.redirect("/");
  }

  res.send(
    layout(
      "ورود سازنده",
      `

      <div class="card login">

        <div class="center">

          <div style="font-size:65px">
            👑
          </div>

          <h1>
            پنل سازنده
          </h1>

          <p class="muted">
            مدیریت تمام ربات‌های تلگرام
          </p>

        </div>

        <form method="POST" action="/login">

          <label>
            رمز ورود سازنده
          </label>

          <input
            type="password"
            name="password"
            placeholder="رمز عبور"
            required
          >

          <button type="submit">
            🔐 ورود
          </button>

        </form>

      </div>

      `
    )
  );
});

app.post("/login", (req, res) => {

  if (
    String(req.body.password || "") ===
    ADMIN_PASSWORD
  ) {

    req.session.loggedIn = true;

    return res.redirect("/");
  }

  res.send(
    layout(
      "خطا",
      `
      <div class="card login center">

        <h2>
          ❌ رمز اشتباه است
        </h2>

        <a class="btn" href="/login">
          دوباره تلاش کن
        </a>

      </div>
      `
    )
  );
});

app.get("/logout", (req, res) => {

  req.session.destroy(() => {
    res.redirect("/login");
  });

});

/* =========================
   Dashboard
========================= */

app.get("/", requireLogin, (req, res) => {

  let totalUsers = 0;

  for (const botId of Object.keys(db.users)) {
    totalUsers +=
      Object.keys(db.users[botId]).length;
  }

  let html = `

  <div class="header">

    <div class="logo">
      🤖 <span>نوا</span> مدیریت ربات‌ها
    </div>

    <a class="btn gray" href="/logout">
      خروج
    </a>

  </div>

  <div class="grid">

    <div class="stat">

      <div class="stat-title">
        🤖 تعداد ربات‌ها
      </div>

      <div class="stat-number">
        ${db.bots.length}
      </div>

    </div>

    <div class="stat">

      <div class="stat-title">
        👥 کل کاربران
      </div>

      <div class="stat-number">
        ${totalUsers}
      </div>

    </div>

  </div>

  <br>

  <div class="card">

    <h2>
      📢 ارسال پیام به تمام ربات‌ها
    </h2>

    <div class="notice">

      این پیام برای کاربران فعال تمام ربات‌های ثبت‌شده
      ارسال می‌شود.

    </div>

    <form method="POST" action="/broadcast-all">

      <textarea
        name="text"
        placeholder="پیامی که می‌خواهید برای کاربران تمام ربات‌ها ارسال شود..."
        required
      ></textarea>

      <button class="orange" type="submit">
        📢 ارسال به همه ربات‌ها
      </button>

    </form>

  </div>

  <div class="card">

    <h2>
      ➕ ساخت ربات جدید
    </h2>

    <p class="muted">
      توکن ربات را از BotFather وارد کنید.
    </p>

    <form method="POST" action="/bots/add">

      <input
        type="text"
        name="token"
        placeholder="توکن ربات تلگرام"
        required
      >

      <button type="submit">
        ➕ افزودن ربات
      </button>

    </form>

  </div>

  <div class="card">

    <h2>
      🤖 همه ربات‌ها
    </h2>

  `;

  if (db.bots.length === 0) {

    html += `
      <p class="muted">
        هنوز رباتی اضافه نشده است.
      </p>
    `;

  } else {

    for (const bot of db.bots) {

      const users =
        Object.values(getUsers(bot.id));

      const activeUsers =
        users.filter(u => u.active).length;

      html += `

      <div class="bot">

        <div class="bot-title">
          🤖 ${escapeHtml(bot.name)}
        </div>

        <p class="muted">
          @${escapeHtml(bot.username)}
        </p>

        <span class="badge">
          فعال
        </span>

        <p>
          👥 کاربران:
          <b>${users.length}</b>
          <br>
          🟢 کاربران فعال:
          <b>${activeUsers}</b>
        </p>

        <div>
          🔑 توکن ربات:
        </div>

        <div class="token">
          ${escapeHtml(bot.token)}
        </div>

        <br>

        <a
          class="btn"
          href="/bot/${bot.id}"
        >
          ⚙️ مدیریت ربات
        </a>

        <form
          method="POST"
          action="/bots/delete"
          style="display:inline"
          onsubmit="return confirm('این ربات حذف شود؟')"
        >

          <input
            type="hidden"
            name="id"
            value="${escapeHtml(bot.id)}"
          >

          <button class="red">
            🗑 حذف
          </button>

        </form>

      </div>

      `;
    }
  }

  html += `</div>`;

  res.send(
    layout(
      "پنل سازنده",
      html
    )
  );
});

/* =========================
   Add Bot
========================= */

app.post(
  "/bots/add",
  requireLogin,
  async (req, res) => {

    const token =
      String(req.body.token || "").trim();

    if (!token) {
      return res.redirect("/");
    }

    try {

      const info =
        await checkToken(token);

      if (
        db.bots.some(
          bot => bot.token === token
        )
      ) {

        return res.send(
          layout(
            "خطا",
            `
            <div class="card center">

              <h2>
                ⚠️ این ربات قبلاً اضافه شده است.
              </h2>

              <a class="btn" href="/">
                بازگشت
              </a>

            </div>
            `
          )
        );
      }

      const bot = {

        id:
          Date.now().toString() +
          Math.random()
            .toString(36)
            .slice(2, 9),

        token,

        name:
          info.first_name ||
          info.username ||
          "ربات",

        username:
          info.username || "",

        offset: 0,

        created_at:
          Date.now()

      };

      db.bots.push(bot);

      db.users[bot.id] = {};
      db.commands[bot.id] = {};

      saveData();

      startBot(bot);

      res.redirect("/");

    } catch (e) {

      res.send(
        layout(
          "خطا",
          `
          <div class="card">

            <h2>
              ❌ توکن ربات اشتباه است
            </h2>

            <p class="muted">
              ${escapeHtml(e.message)}
            </p>

            <a class="btn" href="/">
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
   Delete Bot
========================= */

app.post(
  "/bots/delete",
  requireLogin,
  (req, res) => {

    const id =
      String(req.body.id || "");

    db.bots =
      db.bots.filter(
        bot => bot.id !== id
      );

    delete db.users[id];
    delete db.commands[id];

    saveData();

    res.redirect("/");
  }
);

/* =========================
   Bot Page
========================= */

app.get(
  "/bot/:id",
  requireLogin,
  (req, res) => {

    const bot =
      db.bots.find(
        b => b.id === req.params.id
      );

    if (!bot) {
      return res.redirect("/");
    }

    const users =
      Object.values(
        getUsers(bot.id)
      );

    const commands =
      getCommands(bot.id);

    let html = `

    <div class="header">

      <div class="logo">
        🤖 ${escapeHtml(bot.name)}
      </div>

      <a class="btn gray" href="/">
        ← بازگشت
      </a>

    </div>

    <div class="card">

      <h2>
        🔑 توکن ربات
      </h2>

      <div class="token">
        ${escapeHtml(bot.token)}
      </div>

    </div>

    <div class="card">

      <h2>
        📢 ارسال پیام
      </h2>

      <form
        method="POST"
        action="/bot/${bot.id}/broadcast"
      >

        <textarea
          name="text"
          placeholder="پیام..."
          required
        ></textarea>

        <button type="submit">
          📢 ارسال واقعی به کاربران
        </button>

      </form>

    </div>

    <div class="card">

      <h2>
        ⚡ ساخت دستور
      </h2>

      <form
        method="POST"
        action="/bot/${bot.id}/command"
      >

        <input
          name="command"
          placeholder="/help"
          required
        >

        <textarea
          name="reply"
          placeholder="پاسخ ربات..."
          required
        ></textarea>

        <button type="submit">
          ➕ ذخیره دستور
        </button>

      </form>

      <hr>

      <h3>
        دستورات موجود
      </h3>

    `;

    const commandNames =
      Object.keys(commands);

    if (commandNames.length === 0) {

      html += `
        <p class="muted">
          دستوری وجود ندارد.
        </p>
      `;

    } else {

      for (const command of commandNames) {

        html += `

        <div class="bot">

          <b>
            ${escapeHtml(command)}
          </b>

          <p class="muted">
            ${escapeHtml(commands[command])}
          </p>

          <form
            method="POST"
            action="/bot/${bot.id}/command/delete"
          >

            <input
              type="hidden"
              name="command"
              value="${escapeHtml(command)}"
            >

            <button class="red">
              🗑 حذف دستور
            </button>

          </form>

        </div>

        `;
      }
    }

    html += `

    </div>

    <div class="card">

      <h2>
        👥 کاربران
      </h2>

      <p>
        تعداد:
        <b>${users.length}</b>
      </p>

    `;

    if (users.length === 0) {

      html += `
        <p class="muted">
          هنوز کاربری با این ربات /start نزده است.
        </p>
      `;

    } else {

      html += `

      <div style="overflow:auto">

      <table>

        <tr>
          <th>کاربر</th>
          <th>شناسه</th>
          <th>وضعیت</th>
          <th>عملیات</th>
        </tr>

      `;

      for (const user of users) {

        html += `

        <tr>

          <td>
            ${escapeHtml(
              user.first_name ||
              user.username ||
              "بدون نام"
            )}
          </td>

          <td>
            ${escapeHtml(user.telegram_id)}
          </td>

          <td>
            ${
              user.active
                ? "🟢 فعال"
                : "🔴 غیرفعال"
            }
          </td>

          <td>

            <form
              method="POST"
              action="/bot/${bot.id}/user/toggle"
            >

              <input
                type="hidden"
                name="telegram_id"
                value="${escapeHtml(user.telegram_id)}"
              >

              <button class="gray">
                ${
                  user.active
                    ? "غیرفعال"
                    : "فعال"
                }
              </button>

            </form>

          </td>

        </tr>

        `;
      }

      html += `
      </table>
      </div>
      `;
    }

    html += `</div>`;

    res.send(
      layout(
        escapeHtml(bot.name),
        html
      )
    );
  }
);

/* =========================
   Command
========================= */

app.post(
  "/bot/:id/command",
  requireLogin,
  (req, res) => {

    const bot =
      db.bots.find(
        b => b.id === req.params.id
      );

    if (!bot) {
      return res.redirect("/");
    }

    let command =
      String(
        req.body.command || ""
      ).trim();

    const reply =
      String(
        req.body.reply || ""
      ).trim();

    if (!command.startsWith("/")) {
      command = "/" + command;
    }

    command =
      command
        .split(/\s+/)[0]
        .split("@")[0]
        .toLowerCase();

    if (!reply) {
      return res.redirect(
        `/bot/${bot.id}`
      );
    }

    getCommands(bot.id)[command] =
      reply;

    saveData();

    res.redirect(
      `/bot/${bot.id}`
    );
  }
);

/* =========================
   Delete Command
========================= */

app.post(
  "/bot/:id/command/delete",
  requireLogin,
  (req, res) => {

    delete getCommands(
      req.params.id
    )[
      String(req.body.command || "")
    ];

    saveData();

    res.redirect(
      `/bot/${req.params.id}`
    );
  }
);

/* =========================
   Toggle User
========================= */

app.post(
  "/bot/:id/user/toggle",
  requireLogin,
  (req, res) => {

    const users =
      getUsers(req.params.id);

    const id =
      String(req.body.telegram_id);

    if (users[id]) {
      users[id].active =
        !users[id].active;
    }

    saveData();

    res.redirect(
      `/bot/${req.params.id}`
    );
  }
);

/* =========================
   Broadcast One Bot
========================= */

app.post(
  "/bot/:id/broadcast",
  requireLogin,
  async (req, res) => {

    const bot =
      db.bots.find(
        b => b.id === req.params.id
      );

    if (!bot) {
      return res.redirect("/");
    }

    const text =
      String(
        req.body.text || ""
      ).trim();

    const users =
      Object.values(
        getUsers(bot.id)
      );

    let success = 0;
    let failed = 0;

    for (const user of users) {

      if (!user.active) {
        continue;
      }

      try {

        await telegram(
          "sendMessage",
          bot.token,
          {
            chat_id:
              user.telegram_id,
            text
          }
        );

        success++;

      } catch (e) {

        failed++;

        if (
          e.message.includes(
            "bot was blocked"
          ) ||
          e.message.includes(
            "user is deactivated"
          ) ||
          e.message.includes(
            "chat not found"
          )
        ) {
          user.active = false;
        }
      }

      await wait(80);
    }

    saveData();

    res.send(
      layout(
        "نتیجه ارسال",
        `

        <div class="card center">

          <div style="font-size:60px">
            📢
          </div>

          <h2>
            ارسال تمام شد
          </h2>

          <p>
            ✅ موفق:
            <b>${success}</b>
          </p>

          <p>
            ❌ ناموفق:
            <b>${failed}</b>
          </p>

          <a
            class="btn"
            href="/bot/${bot.id}"
          >
            ← بازگشت
          </a>

        </div>

        `
      )
    );
  }
);

/* =========================
   Broadcast ALL Bots
========================= */

app.post(
  "/broadcast-all",
  requireLogin,
  async (req, res) => {

    const text =
      String(
        req.body.text || ""
      ).trim();

    if (!text) {
      return res.redirect("/");
    }

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalUsers = 0;

    for (const bot of db.bots) {

      const users =
        Object.values(
          getUsers(bot.id)
        );

      for (const user of users) {

        if (!user.active) {
          continue;
        }

        totalUsers++;

        try {

          await telegram(
            "sendMessage",
            bot.token,
            {
              chat_id:
                user.telegram_id,
              text
            }
          );

          totalSuccess++;

        } catch (e) {

          totalFailed++;

          if (
            e.message.includes(
              "bot was blocked"
            ) ||
            e.message.includes(
              "user is deactivated"
            ) ||
            e.message.includes(
              "chat not found"
            )
          ) {

            user.active = false;
          }
        }

        await wait(80);
      }
    }

    saveData();

    res.send(
      layout(
        "نتیجه ارسال همگانی",
        `

        <div class="card center">

          <div style="font-size:70px">
            📢
          </div>

          <h1>
            ارسال پیام تمام شد
          </h1>

          <p>
            🤖 تعداد ربات‌ها:
            <b>${db.bots.length}</b>
          </p>

          <p>
            👥 کاربران فعال:
            <b>${totalUsers}</b>
          </p>

          <p>
            ✅ ارسال موفق:
            <b>${totalSuccess}</b>
          </p>

          <p>
            ❌ ارسال ناموفق:
            <b>${totalFailed}</b>
          </p>

          <a
            class="btn"
            href="/"
          >
            ← بازگشت به پنل
          </a>

        </div>

        `
      )
    );
  }
);

/* =========================
   Telegram Polling
========================= */

const runningBots = {};

async function startBot(bot) {

  if (runningBots[bot.id]) {
    return;
  }

  runningBots[bot.id] = true;

  try {

    await telegram(
      "deleteWebhook",
      bot.token,
      {
        drop_pending_updates: false
      }
    );

  } catch (e) {

    console.log(
      "Webhook:",
      e.message
    );
  }

  let offset =
    Number(bot.offset || 0);

  console.log(
    `Polling شروع شد: @${bot.username}`
  );

  while (
    db.bots.some(
      b => b.id === bot.id
    )
  ) {

    try {

      const updates =
        await telegram(
          "getUpdates",
          bot.token,
          {
            offset,
            timeout: 30,
            allowed_updates: [
              "message"
            ]
          }
        );

      for (const update of updates) {

        offset =
          update.update_id + 1;

        bot.offset = offset;

        await processUpdate(
          bot,
          update
        );

        saveData();
      }

    } catch (e) {

      console.log(
        `خطای ربات @${bot.username}:`,
        e.message
      );

      await wait(5000);
    }
  }

  delete runningBots[bot.id];
}

async function processUpdate(
  bot,
  update
) {

  if (!update.message) {
    return;
  }

  const message =
    update.message;

  const chat =
    message.chat;

  if (!chat || !chat.id) {
    return;
  }

  const users =
    getUsers(bot.id);

  users[String(chat.id)] = {

    telegram_id:
      chat.id,

    username:
      chat.username || "",

    first_name:
      chat.first_name || "",

    last_name:
      chat.last_name || "",

    active: true,

    updated_at:
      Date.now()
  };

  const text =
    String(
      message.text || ""
    );

  if (!text.startsWith("/")) {
    return;
  }

  const command =
    text
      .split(/\s+/)[0]
      .split("@")[0]
      .toLowerCase();

  const commands =
    getCommands(bot.id);

  if (commands[command]) {

    try {

      await telegram(
        "sendMessage",
        bot.token,
        {
          chat_id: chat.id,
          text:
            commands[command]
        }
      );

    } catch (e) {

      console.log(
        "خطای پاسخ دستور:",
        e.message
      );
    }

    return;
  }

  if (command === "/start") {

    try {

      await telegram(
        "sendMessage",
        bot.token,
        {
          chat_id: chat.id,
          text:
            "سلام 👋\n\n" +
            "به ربات خوش آمدید.\n" +
            "شما با موفقیت ثبت شدید. ✅"
        }
      );

    } catch (e) {

      console.log(
        "خطای /start:",
        e.message
      );
    }
  }
}

function startAllBots() {

  for (const bot of db.bots) {
    startBot(bot);
  }
}

/* =========================
   Start Server
========================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

    startAllBots();
  }
);
