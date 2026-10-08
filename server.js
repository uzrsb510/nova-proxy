const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  "https://nova-proxy-1-7cdg.onrender.com"
).replace(/\/$/, "");

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "kowsar-panel-session-2026";

const CREATOR_PASSWORD = "mmkk1122";

const db = new Database("kowsar.db");

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
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   DATABASE
========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  admin_password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  username TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  telegram_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bot_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  command TEXT NOT NULL,
  answer TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bot_id, command)
);
`);

/* =========================================================
   DEFAULT PASSWORD
========================================================= */

const setting =
  db.prepare(
    "SELECT * FROM settings WHERE id = 1"
  ).get();

if (!setting) {
  db.prepare(
    `
    INSERT INTO settings(id, admin_password)
    VALUES(1, ?)
    `
  ).run(
    crypto
      .createHash("sha256")
      .update("mmkk1122")
      .digest("hex")
  );
}

/* =========================================================
   HELPERS
========================================================= */

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function adminAuth(req, res, next) {
  if (!req.session.admin) {
    return res.redirect("/");
  }

  next();
}

function creatorAuth(req, res, next) {
  if (!req.session.creator) {
    return res.redirect("/creator-login");
  }

  next();
}

async function telegram(token, method, data = {}) {

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  return response.json();
}

async function sendMessage(
  token,
  chatId,
  text
) {

  return telegram(
    token,
    "sendMessage",
    {
      chat_id: chatId,
      text: text,
      parse_mode: "HTML"
    }
  );
}

function botWebhook(token) {

  return (
    PUBLIC_URL +
    "/telegram/webhook/" +
    encodeURIComponent(token)
  );
}

/* =========================================================
   DESIGN
========================================================= */

function page(title, content) {

  return `
<!DOCTYPE html>

<html lang="fa" dir="rtl">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>${esc(title)}</title>

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

  background:

  linear-gradient(
    rgba(1,10,27,.78),
    rgba(1,15,38,.90)
  ),

  url("https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=1800&q=85");

  background-size:cover;

  background-position:center;

  background-attachment:fixed;

}

body:before{

  content:"";

  position:fixed;

  inset:0;

  pointer-events:none;

  background:

  radial-gradient(
    circle at 20% 20%,
    rgba(0,174,255,.25),
    transparent 30%
  ),

  radial-gradient(
    circle at 80% 70%,
    rgba(0,86,255,.22),
    transparent 30%
  );

}

.container{

  width:min(1150px,94%);

  margin:auto;

  padding:20px 0 50px;

}

.nav{

  display:flex;

  justify-content:space-between;

  align-items:center;

  gap:15px;

  padding:15px 18px;

  border-radius:24px;

  background:
  rgba(4,20,45,.65);

  border:
  1px solid rgba(255,255,255,.12);

  backdrop-filter:blur(20px);

  box-shadow:
  0 20px 60px rgba(0,0,0,.35);

}

.logo{

  display:flex;

  align-items:center;

  gap:10px;

  font-weight:bold;

}

.logo-icon{

  width:45px;

  height:45px;

  border-radius:15px;

  display:flex;

  align-items:center;

  justify-content:center;

  background:
  linear-gradient(
    135deg,
    #008cff,
    #00d9ff
  );

  box-shadow:
  0 0 30px
  rgba(0,180,255,.45);

}

.hero{

  margin-top:25px;

  padding:35px;

  border-radius:32px;

  background:
  linear-gradient(
    135deg,
    rgba(0,119,255,.25),
    rgba(1,20,50,.50)
  );

  border:
  1px solid
  rgba(100,210,255,.16);

  backdrop-filter:blur(20px);

  box-shadow:
  0 30px 80px
  rgba(0,0,0,.35);

}

.hero h1{

  margin-top:0;

  font-size:32px;

}

.muted{

  color:#9bbbd8;

}

.grid{

  display:grid;

  grid-template-columns:
  repeat(auto-fit,minmax(210px,1fr));

  gap:18px;

  margin-top:20px;

}

.card{

  padding:22px;

  border-radius:24px;

  background:
  rgba(4,20,43,.67);

  border:
  1px solid
  rgba(255,255,255,.10);

  backdrop-filter:blur(20px);

  box-shadow:
  0 20px 60px
  rgba(0,0,0,.28);

}

.number{

  font-size:32px;

  font-weight:bold;

  margin-top:10px;

  color:#55d8ff;

}

.form{

  max-width:650px;

  margin:35px auto;

}

label{

  display:block;

  margin:16px 0 8px;

  color:#cceaff;

}

input,
textarea{

  width:100%;

  padding:15px;

  border-radius:15px;

  border:
  1px solid
  rgba(255,255,255,.10);

  background:
  rgba(0,8,25,.70);

  color:white;

  outline:none;

  font-size:14px;

}

textarea{

  min-height:160px;

  resize:vertical;

}

button,
.btn{

  display:inline-flex;

  align-items:center;

  justify-content:center;

  gap:7px;

  padding:12px 17px;

  border:0;

  border-radius:14px;

  color:white;

  background:
  linear-gradient(
    135deg,
    #007cff,
    #00cfff
  );

  cursor:pointer;

  text-decoration:none;

  font-weight:bold;

}

button:hover,
.btn:hover{

  transform:translateY(-2px);

}

.red{

  background:
  linear-gradient(
    135deg,
    #e52d54,
    #ff5277
  );

}

.green{

  background:
  linear-gradient(
    135deg,
    #00a982,
    #00d7a3
  );

}

.dark{

  background:
  rgba(255,255,255,.08);

}

.actions{

  display:flex;

  flex-wrap:wrap;

  gap:9px;

  margin-top:18px;

}

.table{

  overflow-x:auto;

}

table{

  width:100%;

  min-width:700px;

  border-collapse:collapse;

}

th,
td{

  padding:14px;

  border-bottom:
  1px solid
  rgba(255,255,255,.07);

  text-align:right;

}

th{

  color:#58d9ff;

}

.badge{

  display:inline-block;

  padding:6px 11px;

  border-radius:50px;

  font-size:11px;

}

.on{

  background:rgba(0,220,160,.12);

  color:#5ff2c3;

}

.off{

  background:rgba(255,50,80,.12);

  color:#ff7c98;

}

.login{

  width:min(430px,94%);

  margin:70px auto;

  padding:30px;

  border-radius:30px;

  background:
  rgba(3,17,40,.75);

  border:
  1px solid
  rgba(255,255,255,.12);

  backdrop-filter:blur(25px);

  box-shadow:
  0 30px 90px
  rgba(0,0,0,.45);

}

.center{

  text-align:center;

}

.token{

  direction:ltr;

  text-align:left;

  word-break:break-all;

  padding:13px;

  border-radius:14px;

  background:
  rgba(0,0,0,.35);

  color:#6bdcff;

  font-family:monospace;

}

.command{

  margin-top:14px;

  padding:17px;

  border-radius:18px;

  background:
  rgba(255,255,255,.045);

  border:
  1px solid
  rgba(255,255,255,.06);

}

@media(max-width:650px){

  .nav{

    flex-direction:column;

  }

  .hero{

    padding:24px;

  }

  .hero h1{

    font-size:25px;

  }

  .actions .btn,
  .actions button{

    flex:1;

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

/* =========================================================
   LOGIN
========================================================= */

app.get("/", (req, res) => {

  if (req.session.admin) {
    return res.redirect("/dashboard");
  }

  res.send(
    page(
      "ورود مدیر",
      `
<div class="login">

<div class="center">

<div class="logo-icon" style="margin:auto">
⚡
</div>

<h1>
پنل مدیریت کوثر
</h1>

<p class="muted">
ورود به مدیریت ربات‌ها
</p>

</div>

<form method="POST" action="/login">

<label>
رمز عبور مدیر
</label>

<input
type="password"
name="password"
required
placeholder="رمز عبور"
/>

<br><br>

<button style="width:100%">
🔐 ورود
</button>

</form>

<div class="center" style="margin-top:20px">

<a
class="btn dark"
href="/creator-login"
>
👑 ورود سازنده
</a>

</div>

</div>
`
    )
  );
});

/* =========================================================
   LOGIN POST
========================================================= */

app.post("/login", (req, res) => {

  const password =
    String(req.body.password || "");

  const setting =
    db.prepare(
      "SELECT * FROM settings WHERE id=1"
    ).get();

  if (
    hashPassword(password) !==
    setting.admin_password
  ) {

    return res.send(
      page(
        "خطا",
        `
<div class="login center">

<h2>❌ رمز اشتباه است</h2>

<a class="btn" href="/">
بازگشت
</a>

</div>
`
      )
    );
  }

  req.session.admin = true;

  res.redirect("/dashboard");
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  "/dashboard",
  adminAuth,
  (req, res) => {

    const bots =
      db.prepare(
        "SELECT COUNT(*) c FROM bots"
      ).get().c;

    const users =
      db.prepare(
        "SELECT COUNT(*) c FROM users"
      ).get().c;

    const active =
      db.prepare(
        `
        SELECT COUNT(*) c
        FROM users
        WHERE active=1
        `
      ).get().c;

    const commands =
      db.prepare(
        "SELECT COUNT(*) c FROM commands"
      ).get().c;

    const botList =
      db.prepare(
        `
        SELECT *
        FROM bots
        ORDER BY id DESC
        `
      ).all();

    res.send(
      page(
        "داشبورد",
        `
<div class="nav">

<div class="logo">

<div class="logo-icon">
⚡
</div>

<div>
پنل مدیریت کوثر
<br>
<span class="muted">
مدیریت ربات‌های تلگرام
</span>
</div>

</div>

<a
class="btn dark"
href="/logout"
>
🚪 خروج
</a>

</div>

<div class="hero">

<h1>
🤖 مدیریت ربات‌های تلگرام
</h1>

<p class="muted">
از اینجا ربات، کاربران، دستورها و ارسال پیام را مدیریت کنید.
</p>

<div class="actions">

<a class="btn" href="/bots">
🤖 ربات‌ها
</a>

<a class="btn" href="/broadcast">
📢 ارسال پیام
</a>

<a class="btn" href="/commands">
💬 دستورها
</a>

</div>

</div>

<div class="grid">

<div class="card">

<div class="muted">
🤖 ربات‌ها
</div>

<div class="number">
${bots}
</div>

</div>

<div class="card">

<div class="muted">
👥 کاربران
</div>

<div class="number">
${users}
</div>

</div>

<div class="card">

<div class="muted">
🟢 کاربران فعال
</div>

<div class="number">
${active}
</div>

</div>

<div class="card">

<div class="muted">
💬 دستورها
</div>

<div class="number">
${commands}
</div>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>
🤖 ربات‌های ثبت‌شده
</h2>

<div class="table">

<table>

<tr>
<th>ربات</th>
<th>وضعیت</th>
<th>کاربران</th>
<th>مدیریت</th>
</tr>

${
  botList.length
    ? botList.map(bot => {

      const count =
        db.prepare(
          `
          SELECT COUNT(*) c
          FROM users
          WHERE bot_id=?
          `
        ).get(bot.id).c;

      return `
<tr>

<td>
@${esc(bot.username || "بدون نام")}
</td>

<td>
${
  bot.active
    ? `<span class="badge on">فعال</span>`
    : `<span class="badge off">غیرفعال</span>`
}
</td>

<td>
${count}
</td>

<td>
<a
class="btn"
href="/bot/${bot.id}"
>
مدیریت
</a>
</td>

</tr>
`;

    }).join("")
    : `
<tr>
<td colspan="4" class="center">
هنوز رباتی اضافه نشده است.
</td>
</tr>
`
}

</table>

</div>

</div>
`
      )
    );
  }
);

/* =========================================================
   BOTS
========================================================= */

app.get(
  "/bots",
  adminAuth,
  (req, res) => {

    const bots =
      db.prepare(
        `
        SELECT *
        FROM bots
        ORDER BY id DESC
        `
      ).all();

    res.send(
      page(
        "ربات‌ها",
        `
<div class="hero">

<h1>
🤖 ربات‌های تلگرام
</h1>

<p class="muted">
توکن ربات را اضافه کنید تا کاربران آن به صورت خودکار ذخیره شوند.
</p>

</div>

<div class="card form">

<h2>
➕ افزودن ربات
</h2>

<form
method="POST"
action="/bots/add"
>

<label>
توکن ربات
</label>

<input
name="token"
required
placeholder="123456789:AA..."
>

<br>

<button>
🔗 اتصال ربات
</button>

</form>

</div>

<div class="grid">

${
  bots.map(bot => `

<div class="card">

<h3>
🤖 @${esc(bot.username || "ربات")}
</h3>

<p class="muted">
وضعیت:
${
  bot.active
    ? "🟢 فعال"
    : "🔴 غیرفعال"
}
</p>

<div class="actions">

<a
class="btn"
href="/bot/${bot.id}"
>
مدیریت
</a>

<form
method="POST"
action="/bots/${bot.id}/toggle"
>

<button class="${
  bot.active ? "red" : "green"
}">
${
  bot.active
    ? "غیرفعال کردن"
    : "فعال کردن"
}
</button>

</form>

</div>

</div>

`).join("")
}

</div>
`
      )
    );
  }
);

/* =========================================================
   ADD BOT
========================================================= */

app.post(
  "/bots/add",
  adminAuth,
  async (req, res) => {

    const token =
      String(req.body.token || "").trim();

    if (!token) {
      return res.send("توکن وارد نشده است.");
    }

    try {

      const result =
        await telegram(
          token,
          "getMe"
        );

      if (!result.ok) {

        return res.send(
          page(
            "خطا",
            `
<div class="login center">

<h2>
❌ توکن ربات صحیح نیست
</h2>

<p class="muted">
${esc(result.description || "")}
</p>

<a
class="btn"
href="/bots"
>
بازگشت
</a>

</div>
`
          )
        );
      }

      const username =
        result.result.username || "";

      const exists =
        db.prepare(
          `
          SELECT id
          FROM bots
          WHERE token=?
          `
        ).get(token);

      if (exists) {
        return res.send(
          "این ربات قبلاً اضافه شده است."
        );
      }

      const bot =
        db.prepare(
          `
          INSERT INTO bots(token,username)
          VALUES(?,?)
          `
        ).run(
          token,
          username
        );

      const webhook =
        await telegram(
          token,
          "setWebhook",
          {
            url: botWebhook(token),
            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      if (!webhook.ok) {

        console.error(
          webhook
        );
      }

      res.redirect(
        `/bot/${bot.lastInsertRowid}`
      );

    } catch (error) {

      console.error(error);

      res.send(
        "اتصال به تلگرام انجام نشد."
      );
    }
  }
);

/* =========================================================
   BOT PAGE
========================================================= */

app.get(
  "/bot/:id",
  adminAuth,
  (req, res) => {

    const bot =
      db.prepare(
        `
        SELECT *
        FROM bots
        WHERE id=?
        `
      ).get(req.params.id);

    if (!bot) {
      return res.status(404).send(
        "ربات پیدا نشد."
      );
    }

    const users =
      db.prepare(
        `
        SELECT *
        FROM users
        WHERE bot_id=?
        ORDER BY id DESC
        LIMIT 100
        `
      ).all(bot.id);

    res.send(
      page(
        "مدیریت ربات",
        `
<div class="hero">

<h1>
🤖 @${esc(bot.username)}
</h1>

<p class="muted">
مدیریت کاربران این ربات
</p>

<div class="actions">

<a
class="btn"
href="/broadcast?bot=${bot.id}"
>
📢 ارسال پیام
</a>

<a
class="btn"
href="/commands?bot=${bot.id}"
>
💬 دستورها
</a>

</div>

</div>

<div class="grid">

<div class="card">

<div class="muted">
👥 کل کاربران
</div>

<div class="number">
${users.length}
</div>

</div>

<div class="card">

<div class="muted">
🟢 فعال
</div>

<div class="number">
${
  users.filter(
    u => u.active
  ).length
}
</div>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>
👥 کاربران
</h2>

<div class="table">

<table>

<tr>

<th>نام</th>

<th>آیدی</th>

<th>نام کاربری</th>

<th>وضعیت</th>

<th>عملیات</th>

</tr>

${
  users.length
    ? users.map(user => `

<tr>

<td>
${esc(user.first_name || "-")}
</td>

<td>
${esc(user.telegram_id)}
</td>

<td>
${
  user.username
    ? "@" + esc(user.username)
    : "-"
}
</td>

<td>

${
  user.active
    ? `<span class="badge on">فعال</span>`
    : `<span class="badge off">غیرفعال</span>`
}

</td>

<td>

<form
method="POST"
action="/user/${user.id}/toggle"
>

<button class="${
  user.active
    ? "red"
    : "green"
}">

${
  user.active
    ? "🔴 غیرفعال"
    : "🟢 فعال"
}

</button>

</form>

</td>

</tr>

`).join("")
    : `
<tr>

<td
colspan="5"
class="center"
>
هنوز کاربری با /start وارد نشده است.
</td>

</tr>
`
}

</table>

</div>

</div>
`
      )
    );
  }
);

/* =========================================================
   TOGGLE USER
========================================================= */

app.post(
  "/user/:id/toggle",
  adminAuth,
  (req, res) => {

    const user =
      db.prepare(
        `
        SELECT *
        FROM users
        WHERE id=?
        `
      ).get(req.params.id);

    if (!user) {
      return res.redirect("/dashboard");
    }

    db.prepare(
      `
      UPDATE users
      SET active=?
      WHERE id=?
      `
    ).run(
      user.active ? 0 : 1,
      user.id
    );

    res.redirect(
      `/bot/${user.bot_id}`
    );
  }
);

/* =========================================================
   COMMANDS
========================================================= */

app.get(
  "/commands",
  adminAuth,
  (req, res) => {

    const selectedBot =
      Number(req.query.bot || 0);

    const bots =
      db.prepare(
        `
        SELECT *
        FROM bots
        ORDER BY id DESC
        `
      ).all();

    const commands =
      selectedBot
        ? db.prepare(
            `
            SELECT *
            FROM commands
            WHERE bot_id=?
            ORDER BY id DESC
            `
          ).all(selectedBot)
        : [];

    res.send(
      page(
        "دستورها",
        `
<div class="hero">

<h1>
💬 دستور و جواب
</h1>

<p class="muted">
برای هر ربات یک دستور و پاسخ مخصوص آن تعیین کنید.
</p>

</div>

<div class="card form">

<form
method="POST"
action="/commands/add"
>

<label>
انتخاب ربات
</label>

<select
name="bot_id"
required
style="
width:100%;
padding:14px;
border-radius:14px;
background:#06152c;
color:white;
"
>

<option value="">
انتخاب کنید
</option>

${
  bots.map(bot => `
<option
value="${bot.id}"
${selectedBot === bot.id ? "selected" : ""}
>
@${esc(bot.username || "ربات")}
</option>
`).join("")
}

</select>

<label>
دستور
</label>

<input
name="command"
required
placeholder="مثلاً info"
/>

<label>
جواب دستور
</label>

<textarea
name="answer"
required
placeholder="متن پاسخی که ربات باید ارسال کند..."
></textarea>

<br>

<button>
➕ افزودن دستور
</button>

</form>

</div>

<div class="card">

<h2>
📋 دستورهای ثبت‌شده
</h2>

${
  commands.length
    ? commands.map(c => `
<div class="command">

<h3>
/${esc(c.command)}
</h3>

<p>
${esc(c.answer)}
</p>

<form
method="POST"
action="/commands/${c.id}/delete"
>

<button class="red">
🗑️ حذف
</button>

</form>

</div>
`).join("")
    : `
<div class="muted">
ابتدا یک ربات را انتخاب کنید.
</div>
`
}

</div>
`
      )
    );
  }
);

/* =========================================================
   ADD COMMAND
========================================================= */

app.post(
  "/commands/add",
  adminAuth,
  (req, res) => {

    const botId =
      Number(req.body.bot_id);

    let command =
      String(
        req.body.command || ""
      ).trim();

    const answer =
      String(
        req.body.answer || ""
      ).trim();

    command =
      command.replace(
        /^\//,
        ""
      );

    command =
      command.replace(
        /[^a-zA-Z0-9_]/g,
        ""
      );

    if (!botId || !command || !answer) {
      return res.send(
        "اطلاعات دستور کامل نیست."
      );
    }

    db.prepare(
      `
      INSERT INTO commands
      (bot_id,command,answer)
      VALUES(?,?,?)

      ON CONFLICT(bot_id,command)
      DO UPDATE SET
        answer=excluded.answer,
        active=1
      `
    ).run(
      botId,
      command,
      answer
    );

    res.redirect(
      `/commands?bot=${botId}`
    );
  }
);

/* =========================================================
   DELETE COMMAND
========================================================= */

app.post(
  "/commands/:id/delete",
  adminAuth,
  (req, res) => {

    const command =
      db.prepare(
        `
        SELECT *
        FROM commands
        WHERE id=?
        `
      ).get(req.params.id);

    if (!command) {
      return res.redirect("/commands");
    }

    db.prepare(
      `
      DELETE FROM commands
      WHERE id=?
      `
    ).run(command.id);

    res.redirect(
      `/commands?bot=${command.bot_id}`
    );
  }
);

/* =========================================================
   BROADCAST
========================================================= */

app.get(
  "/broadcast",
  adminAuth,
  (req, res) => {

    const bots =
      db.prepare(
        `
        SELECT *
        FROM bots
        ORDER BY id DESC
        `
      ).all();

    const botId =
      Number(req.query.bot || 0);

    res.send(
      page(
        "ارسال پیام",
        `
<div class="hero">

<h1>
📢 ارسال پیام به کاربران
</h1>

<p class="muted">
پیام را برای کاربران یک ربات ارسال کنید.
</p>

</div>

<div class="card form">

<form
method="POST"
action="/broadcast"
>

<label>
انتخاب ربات
</label>

<select
name="bot_id"
required
style="
width:100%;
padding:14px;
border-radius:14px;
background:#06152c;
color:white;
"
>

<option value="">
انتخاب ربات
</option>

${
  bots.map(bot => `
<option
value="${bot.id}"
${botId === bot.id ? "selected" : ""}
>
@${esc(bot.username || "ربات")}
</option>
`).join("")
}

</select>

<label>
متن پیام
</label>

<textarea
name="message"
required
placeholder="پیام خود را بنویسید..."
></textarea>

<label>

نوع ارسال

</label>

<select
name="target"
style="
width:100%;
padding:14px;
border-radius:14px;
background:#06152c;
color:white;
"
>

<option value="active">
فقط کاربران فعال
</option>

<option value="all">
همه کاربران
</option>

</select>

<br>

<button>
📢 ارسال پیام
</button>

</form>

</div>
`
      )
    );
  }
);

/* =========================================================
   BROADCAST POST
========================================================= */

app.post(
  "/broadcast",
  adminAuth,
  async (req, res) => {

    const botId =
      Number(req.body.bot_id);

    const message =
      String(
        req.body.message || ""
      ).trim();

    const target =
      String(
        req.body.target || "active"
      );

    const bot =
      db.prepare(
        `
        SELECT *
        FROM bots
        WHERE id=?
        `
      ).get(botId);

    if (!bot) {
      return res.send(
        "ربات پیدا نشد."
      );
    }

    const users =
      db.prepare(
        `
        SELECT *
        FROM users
        WHERE bot_id=?
        ${target === "active"
          ? "AND active=1"
          : ""}
        `
      ).all(botId);

    let sent = 0;

    for (const user of users) {

      try {

        const result =
          await sendMessage(
            bot.token,
            user.telegram_id,
            message
          );

        if (result.ok) {
          sent++;
        }

      } catch (error) {

        console.error(error);

      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            60
          )
      );
    }

    res.send(
      page(
        "نتیجه ارسال",
        `
<div class="login center">

<div class="logo-icon"
style="margin:auto">
📢
</div>

<h2>
ارسال انجام شد
</h2>

<p class="muted">
پیام برای
<b>${sent}</b>
نفر ارسال شد.
</p>

<a
class="btn"
href="/dashboard"
>
بازگشت به داشبورد
</a>

</div>
`
      )
    );
  }
);

/* =========================================================
   TELEGRAM WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook/:token",
  async (req, res) => {

    res.sendStatus(200);

    const token =
      req.params.token;

    const bot =
      db.prepare(
        `
        SELECT *
        FROM bots
        WHERE token=?
        AND active=1
        `
      ).get(token);

    if (!bot) {
      return;
    }

    try {

      const message =
        req.body.message;

      if (!message) {
        return;
      }

      const chat =
        message.chat;

      const telegramId =
        String(chat.id);

      const username =
        message.from?.username || "";

      const firstName =
        message.from?.first_name || "";

      /*
         ذخیره خودکار کاربر
      */

      db.prepare(
        `
        INSERT INTO users
        (
          bot_id,
          telegram_id,
          username,
          first_name
        )
        VALUES(?,?,?,?)

        ON CONFLICT(bot_id,telegram_id)
        DO UPDATE SET
          username=excluded.username,
          first_name=excluded.first_name
        `
      ).run(
        bot.id,
        telegramId,
        username,
        firstName
      );

      const text =
        String(
          message.text || ""
        ).trim();

      if (!text) {
        return;
      }

      /*
         /start
      */

      if (
        text === "/start" ||
        text.startsWith("/start ")
      ) {

        if (!message.from) {
          return;
        }

        return sendMessage(
          token,
          chat.id,
          `
<b>👋 سلام ${esc(firstName || "دوست عزیز")}</b>

به ربات خوش آمدید 🌟

اطلاعات شما با موفقیت ثبت شد.

برای مشاهده امکانات از دستورهای ربات استفاده کنید.
`
        );
      }

      /*
         بررسی فعال بودن کاربر
      */

      const user =
        db.prepare(
          `
          SELECT *
          FROM users
          WHERE bot_id=?
          AND telegram_id=?
          `
        ).get(
          bot.id,
          telegramId
        );

      if (!user || !user.active) {

        return sendMessage(
          token,
          chat.id,
          "🔴 دسترسی شما در حال حاضر غیرفعال است."
        );
      }

      /*
         حذف /
      */

      let command =
        text.split(/\s+/)[0];

      if (command.startsWith("/")) {

        command =
          command
            .slice(1)
            .split("@")[0]
            .toLowerCase();

        const cmd =
          db.prepare(
            `
            SELECT *
            FROM commands
            WHERE bot_id=?
            AND command=?
            AND active=1
            `
          ).get(
            bot.id,
            command
          );

        if (cmd) {

          return sendMessage(
            token,
            chat.id,
            cmd.answer
          );
        }
      }

    } catch (error) {

      console.error(
        "Webhook error:",
        error
      );
    }
  }
);

/* =========================================================
   CREATOR LOGIN
========================================================= */

app.get(
  "/creator-login",
  (req, res) => {

    res.send(
      page(
        "ورود سازنده",
        `
<div class="login">

<div class="center">

<div class="logo-icon"
style="margin:auto">
👑
</div>

<h1>
ورود سازنده
</h1>

<p class="muted">
دسترسی ویژه سازنده سیستم
</p>

</div>

<form
method="POST"
action="/creator-login"
>

<label>
رمز سازنده
</label>

<input
type="password"
name="password"
required
placeholder="رمز سازنده"
/>

<br><br>

<button style="width:100%">
👑 ورود سازنده
</button>

</form>

</div>
`
      )
    );
  }
);

/* =========================================================
   CREATOR LOGIN POST
========================================================= */

app.post(
  "/creator-login",
  (req, res) => {

    const password =
      String(
        req.body.password || ""
      );

    if (
      password !==
      CREATOR_PASSWORD
    ) {

      return res.send(
        page(
          "خطا",
          `
<div class="login center">

<h2>
❌ رمز سازنده اشتباه است
</h2>

<a
class="btn"
href="/creator-login"
>
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

/* =========================================================
   CREATOR PANEL
========================================================= */

app.get(
  "/creator",
  creatorAuth,
  (req, res) => {

    const bots =
      db.prepare(
        `
        SELECT *
        FROM bots
        ORDER BY id DESC
        `
      ).all();

    res.send(
      page(
        "پنل سازنده",
        `
<div class="hero">

<h1>
👑 پنل سازنده
</h1>

<p class="muted">
تمام ربات‌های ثبت‌شده در سیستم از این قسمت قابل مشاهده هستند.
</p>

</div>

<div class="grid">

<div class="card">

<div class="muted">
🤖 تعداد ربات‌ها
</div>

<div class="number">
${bots.length}
</div>

</div>

<div class="card">

<div class="muted">
👥 کل کاربران
</div>

<div class="number">
${
  db.prepare(
    "SELECT COUNT(*) c FROM users"
  ).get().c
}
</div>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>
🔐 توکن‌های ربات‌ها
</h2>

<p class="muted">
این قسمت فقط برای سازنده قابل مشاهده است.
</p>

${
  bots.length
    ? bots.map(bot => `

<div class="command">

<h3>
🤖 @${esc(bot.username || "بدون نام")}
</h3>

<div class="token">
${esc(bot.token)}
</div>

<div class="actions">

<form
method="POST"
action="/creator/bot/${bot.id}/toggle"
>

<button class="${
  bot.active
    ? "red"
    : "green"
}">
${
  bot.active
    ? "🔴 غیرفعال کردن ربات"
    : "🟢 فعال کردن ربات"
}
</button>

</form>

</div>

</div>

`).join("")
    : `
<div class="muted">
هنوز رباتی ثبت نشده است.
</div>
`
}

</div>
`
      )
    );
  }
);

/* =========================================================
   CREATOR TOGGLE BOT
========================================================= */

app.post(
  "/creator/bot/:id/toggle",
  creatorAuth,
  (req, res) => {

    const bot =
      db.prepare(
        `
        SELECT *
        FROM bots
        WHERE id=?
        `
      ).get(req.params.id);

    if (bot) {

      db.prepare(
        `
        UPDATE bots
        SET active=?
        WHERE id=?
        `
      ).run(
        bot.active ? 0 : 1,
        bot.id
      );
    }

    res.redirect("/creator");
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.get(
  "/logout",
  (req, res) => {

    req.session.destroy(() => {
      res.redirect("/");
    });

  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "Kowsar Telegram Manager running on port " +
      PORT
    );

    console.log(
      "Public URL: " +
      PUBLIC_URL
    );

  }
);
