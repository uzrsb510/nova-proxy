const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "kowsar-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

const PORT = process.env.PORT || 10000;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "mmkk1122";

const CREATOR_PASSWORD = "mmkk1122";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL تنظیم نشده است.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// =====================================================
// DATABASE
// =====================================================

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bots (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      offset BIGINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(bot_id, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS commands (
      id SERIAL PRIMARY KEY,
      bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      answer TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(bot_id, command)
    );
  `);

  console.log("Database ready.");
}


// =====================================================
// TELEGRAM API
// =====================================================

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

  return await response.json();
}


// =====================================================
// HTML
// =====================================================

function page(title, content, user = true) {
  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<title>${title}</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  font-family:Tahoma,Arial,sans-serif;
  color:white;

  background:
    linear-gradient(
      rgba(3,15,35,.82),
      rgba(4,25,55,.88)
    ),
    url("https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=2000&q=90");

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
    radial-gradient(circle at 20% 20%,rgba(0,180,255,.18),transparent 30%),
    radial-gradient(circle at 80% 70%,rgba(0,100,255,.20),transparent 35%);
}

.container{
  width:min(1150px,94%);
  margin:auto;
  position:relative;
  z-index:2;
}

.nav{
  margin-top:20px;
  padding:16px 20px;
  border:1px solid rgba(255,255,255,.15);
  border-radius:22px;
  background:rgba(10,25,50,.55);
  backdrop-filter:blur(20px);
  box-shadow:0 15px 50px rgba(0,0,0,.25);

  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
}

.logo{
  font-size:22px;
  font-weight:bold;
}

.logo span{
  color:#36b9ff;
}

.navlinks{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}

a{
  text-decoration:none;
}

.btn{
  display:inline-block;
  border:0;
  padding:11px 17px;
  border-radius:13px;
  color:white;
  cursor:pointer;
  font-size:14px;
  font-family:inherit;
  background:linear-gradient(135deg,#0789ff,#0061ff);
  box-shadow:0 8px 25px rgba(0,110,255,.25);
}

.btn:hover{
  transform:translateY(-1px);
  filter:brightness(1.08);
}

.btn.gray{
  background:rgba(255,255,255,.10);
}

.btn.red{
  background:linear-gradient(135deg,#ff4141,#c50000);
}

.btn.green{
  background:linear-gradient(135deg,#00c878,#009b5e);
}

.btn.orange{
  background:linear-gradient(135deg,#ffae00,#ff6900);
}

.hero{
  margin-top:35px;
  padding:35px;
  border-radius:30px;
  background:rgba(7,24,50,.60);
  border:1px solid rgba(255,255,255,.13);
  backdrop-filter:blur(20px);
  box-shadow:0 20px 70px rgba(0,0,0,.3);
}

.hero h1{
  margin:0 0 10px;
  font-size:35px;
}

.hero p{
  color:#b9d0e9;
}

.grid{
  margin-top:20px;
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
  gap:18px;
}

.card{
  padding:23px;
  border-radius:23px;
  background:rgba(7,24,50,.65);
  border:1px solid rgba(255,255,255,.12);
  backdrop-filter:blur(18px);
  box-shadow:0 12px 45px rgba(0,0,0,.22);
}

.card h3{
  margin-top:0;
}

.number{
  font-size:35px;
  font-weight:bold;
  color:#37baff;
}

.form{
  margin-top:20px;
  padding:25px;
  border-radius:24px;
  background:rgba(7,24,50,.65);
  border:1px solid rgba(255,255,255,.12);
}

input,textarea,select{
  width:100%;
  padding:14px;
  margin:7px 0 14px;
  border-radius:13px;
  border:1px solid rgba(255,255,255,.14);
  background:rgba(0,0,0,.25);
  color:white;
  outline:none;
  font-family:inherit;
}

textarea{
  min-height:150px;
  resize:vertical;
}

input:focus,textarea:focus{
  border-color:#219fff;
}

label{
  color:#bdd2e8;
  font-size:14px;
}

.tablewrap{
  overflow-x:auto;
  margin-top:20px;
}

table{
  width:100%;
  border-collapse:collapse;
  background:rgba(0,0,0,.12);
  border-radius:15px;
  overflow:hidden;
}

th,td{
  padding:14px;
  text-align:right;
  border-bottom:1px solid rgba(255,255,255,.08);
  white-space:nowrap;
}

th{
  color:#6ecbff;
}

.status{
  display:inline-block;
  padding:6px 10px;
  border-radius:20px;
  font-size:12px;
}

.on{
  background:rgba(0,210,120,.16);
  color:#48e8a1;
}

.off{
  background:rgba(255,50,50,.15);
  color:#ff7777;
}

.actions{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
}

.alert{
  margin-top:15px;
  padding:14px;
  border-radius:14px;
  background:rgba(0,150,255,.12);
  border:1px solid rgba(0,160,255,.2);
  color:#bfe7ff;
}

.danger{
  background:rgba(255,50,50,.10);
  border-color:rgba(255,50,50,.2);
}

.login{
  width:min(450px,92%);
  margin:80px auto;
}

.login .hero{
  text-align:center;
}

.small{
  color:#9db4ca;
  font-size:13px;
}

.token{
  max-width:400px;
  overflow:hidden;
  text-overflow:ellipsis;
  direction:ltr;
  display:inline-block;
}

footer{
  text-align:center;
  padding:35px;
  color:#7890a8;
}

</style>
</head>

<body>

<div class="container">

${user ? `
<div class="nav">

<div class="logo">
🤖 <span>پنل مدیریت کوثر</span>
</div>

<div class="navlinks">

<a class="btn gray" href="/dashboard">🏠 داشبورد</a>
<a class="btn gray" href="/bots">🤖 ربات‌ها</a>
<a class="btn gray" href="/broadcast">📢 ارسال پیام</a>
<a class="btn orange" href="/creator">👑 سازنده</a>
<a class="btn red" href="/logout">خروج</a>

</div>

</div>
` : ""}

${content}

<footer>
پنل مدیریت ربات‌های تلگرام • Kowsar
</footer>

</div>

</body>
</html>
`;
}


// =====================================================
// AUTH
// =====================================================

function auth(req, res, next) {

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


// =====================================================
// LOGIN
// =====================================================

app.get("/", (req, res) => {

  if (req.session.admin) {
    return res.redirect("/dashboard");
  }

  res.send(
    page(
      "ورود مدیریت",
      `
      <div class="login">

        <div class="hero">

          <div style="font-size:60px">🤖</div>

          <h1>پنل مدیریت کوثر</h1>

          <p>
          مدیریت چندین ربات تلگرام در یک پنل
          </p>

          <form method="POST" action="/login">

            <label>رمز عبور مدیریت</label>

            <input
              type="password"
              name="password"
              placeholder="رمز عبور"
              required
            >

            <button class="btn" style="width:100%">
              🔐 ورود به پنل
            </button>

          </form>

          <br>

          <a href="/creator-login" class="btn orange">
            👑 ورود سازنده
          </a>

        </div>

      </div>
      `,
      false
    )
  );
});


app.post("/login", (req, res) => {

  if (req.body.password !== ADMIN_PASSWORD) {

    return res.send(
      page(
        "خطا",
        `
        <div class="login">
          <div class="hero">
            <h2>❌ رمز اشتباه است</h2>
            <br>
            <a class="btn" href="/">بازگشت</a>
          </div>
        </div>
        `,
        false
      )
    );
  }

  req.session.admin = true;

  res.redirect("/dashboard");
});


// =====================================================
// DASHBOARD
// =====================================================

app.get("/dashboard", auth, async (req, res) => {

  const bots = await pool.query(
    `SELECT COUNT(*)::int AS count FROM bots`
  );

  const users = await pool.query(
    `SELECT COUNT(*)::int AS count FROM users`
  );

  const activeUsers = await pool.query(
    `SELECT COUNT(*)::int AS count FROM users WHERE active=true`
  );

  const commands = await pool.query(
    `SELECT COUNT(*)::int AS count FROM commands`
  );

  res.send(
    page(
      "داشبورد",
      `
      <div class="hero">

        <h1>👋 خوش آمدید</h1>

        <p>
        مرکز کنترل ربات‌های تلگرام شما
        </p>

        <div class="grid">

          <div class="card">
            <h3>🤖 ربات‌ها</h3>
            <div class="number">${bots.rows[0].count}</div>
          </div>

          <div class="card">
            <h3>👥 کاربران</h3>
            <div class="number">${users.rows[0].count}</div>
          </div>

          <div class="card">
            <h3>🟢 کاربران فعال</h3>
            <div class="number">${activeUsers.rows[0].count}</div>
          </div>

          <div class="card">
            <h3>💬 دستورات</h3>
            <div class="number">${commands.rows[0].count}</div>
          </div>

        </div>

      </div>
      `
    )
  );
});


// =====================================================
// BOTS LIST
// =====================================================

app.get("/bots", auth, async (req, res) => {

  const result = await pool.query(`
    SELECT
      b.*,
      COUNT(u.id)::int AS users
    FROM bots b
    LEFT JOIN users u ON u.bot_id=b.id
    GROUP BY b.id
    ORDER BY b.id DESC
  `);

  let rows = "";

  for (const bot of result.rows) {

    rows += `
    <tr>

      <td>${bot.id}</td>

      <td>
        <b>@${bot.username || "unknown"}</b>
        <br>
        <span class="small">${bot.first_name || ""}</span>
      </td>

      <td>${bot.users}</td>

      <td>
        ${
          bot.active
            ? `<span class="status on">🟢 فعال</span>`
            : `<span class="status off">🔴 غیرفعال</span>`
        }
      </td>

      <td>

        <div class="actions">

          <a
            class="btn"
            href="/bot/${bot.id}"
          >
            ⚙️ مدیریت
          </a>

          <form
            method="POST"
            action="/bots/${bot.id}/toggle"
            style="display:inline"
          >
            <button class="btn orange">
              ${bot.active ? "⏸ توقف" : "▶️ فعال"}
            </button>
          </form>

          <form
            method="POST"
            action="/bots/${bot.id}/delete"
            style="display:inline"
            onsubmit="return confirm('این ربات و تمام کاربران و دستورات آن حذف شوند؟')"
          >
            <button class="btn red">
              🗑 حذف
            </button>
          </form>

        </div>

      </td>

    </tr>
    `;
  }

  res.send(
    page(
      "ربات‌ها",
      `
      <div class="hero">

        <h1>🤖 ربات‌های من</h1>

        <p>
        می‌توانی چندین ربات را همزمان مدیریت کنی.
        </p>

        <a class="btn green" href="/bots/add">
          ➕ افزودن ربات جدید
        </a>

      </div>

      <div class="card tablewrap">

        <table>

          <thead>
            <tr>
              <th>#</th>
              <th>ربات</th>
              <th>کاربران</th>
              <th>وضعیت</th>
              <th>مدیریت</th>
            </tr>
          </thead>

          <tbody>
            ${rows || `
              <tr>
                <td colspan="5" style="text-align:center">
                  هنوز رباتی اضافه نشده است.
                </td>
              </tr>
            `}
          </tbody>

        </table>

      </div>
      `
    )
  );
});


// =====================================================
// ADD BOT
// =====================================================

app.get("/bots/add", auth, (req, res) => {

  res.send(
    page(
      "افزودن ربات",
      `
      <div class="hero">

        <h1>➕ افزودن ربات</h1>

        <p>
        توکن را از BotFather کپی و اینجا وارد کن.
        </p>

        <form class="form" method="POST" action="/bots/add">

          <label>توکن ربات</label>

          <input
            name="token"
            placeholder="123456789:AA..."
            required
            dir="ltr"
          >

          <button class="btn green">
            🔗 اتصال واقعی به تلگرام
          </button>

        </form>

        <div class="alert">
          💡 بعد از اتصال، ربات به صورت خودکار شروع به دریافت پیام‌ها می‌کند.
          هر کاربری که /start بزند در دیتابیس ذخیره خواهد شد.
        </div>

      </div>
      `
    )
  );
});


app.post("/bots/add", auth, async (req, res) => {

  const token = String(req.body.token || "").trim();

  if (!token) {
    return res.redirect("/bots/add");
  }

  try {

    const me = await telegram(token, "getMe");

    if (!me.ok) {

      return res.send(
        page(
          "خطا",
          `
          <div class="hero">
            <h2>❌ توکن ربات صحیح نیست</h2>
            <p>${me.description || "Telegram API error"}</p>
            <a class="btn" href="/bots/add">بازگشت</a>
          </div>
          `
        )
      );
    }

    const existing = await pool.query(
      `SELECT id FROM bots WHERE token=$1`,
      [token]
    );

    if (existing.rows.length) {

      return res.send(
        page(
          "ربات موجود است",
          `
          <div class="hero">
            <h2>⚠️ این ربات قبلاً اضافه شده است.</h2>
            <br>
            <a class="btn" href="/bots">بازگشت</a>
          </div>
          `
        )
      );
    }

    await pool.query(
      `
      INSERT INTO bots
      (token,username,first_name,active,offset)
      VALUES($1,$2,$3,true,0)
      `,
      [
        token,
        me.result.username || "",
        me.result.first_name || ""
      ]
    );

    res.redirect("/bots");

  } catch (error) {

    console.error(error);

    res.send(
      page(
        "خطا",
        `
        <div class="hero">
          <h2>❌ اتصال انجام نشد</h2>
          <p>${error.message}</p>
          <a class="btn" href="/bots/add">بازگشت</a>
        </div>
        `
      )
    );
  }
});


// =====================================================
// TOGGLE BOT
// =====================================================

app.post("/bots/:id/toggle", auth, async (req, res) => {

  await pool.query(
    `
    UPDATE bots
    SET active=NOT active
    WHERE id=$1
    `,
    [req.params.id]
  );

  res.redirect("/bots");
});


// =====================================================
// DELETE BOT
// =====================================================

app.post("/bots/:id/delete", auth, async (req, res) => {

  const result = await pool.query(
    `SELECT token FROM bots WHERE id=$1`,
    [req.params.id]
  );

  if (result.rows.length) {

    const token = result.rows[0].token;

    try {
      await telegram(token, "deleteWebhook", {
        drop_pending_updates: true
      });
    } catch (e) {
      console.log("deleteWebhook error:", e.message);
    }
  }

  await pool.query(
    `DELETE FROM bots WHERE id=$1`,
    [req.params.id]
  );

  res.redirect("/bots");
});


// =====================================================
// BOT MANAGEMENT
// =====================================================

app.get("/bot/:id", auth, async (req, res) => {

  const botResult = await pool.query(
    `SELECT * FROM bots WHERE id=$1`,
    [req.params.id]
  );

  if (!botResult.rows.length) {
    return res.redirect("/bots");
  }

  const bot = botResult.rows[0];

  const users = await pool.query(
    `
    SELECT *
    FROM users
    WHERE bot_id=$1
    ORDER BY id DESC
    `,
    [bot.id]
  );

  const commands = await pool.query(
    `
    SELECT *
    FROM commands
    WHERE bot_id=$1
    ORDER BY id DESC
    `,
    [bot.id]
  );

  let userRows = "";

  for (const user of users.rows) {

    userRows += `
    <tr>

      <td>${user.telegram_id}</td>

      <td>
        ${user.first_name || ""}
        ${user.last_name || ""}
      </td>

      <td>
        ${user.username ? "@" + user.username : "-"}
      </td>

      <td>
        ${
          user.active
            ? `<span class="status on">فعال</span>`
            : `<span class="status off">غیرفعال</span>`
        }
      </td>

      <td>

        <form
          method="POST"
          action="/user/${user.id}/toggle"
        >
          <input
            type="hidden"
            name="bot_id"
            value="${bot.id}"
          >

          <button class="btn ${user.active ? "orange" : "green"}">
            ${user.active ? "⏸ غیرفعال" : "▶️ فعال"}
          </button>

        </form>

      </td>

    </tr>
    `;
  }


  let commandRows = "";

  for (const command of commands.rows) {

    commandRows += `
    <tr>

      <td dir="ltr">
        /${command.command}
      </td>

      <td>
        ${escapeHtml(command.answer)}
      </td>

      <td>

        <form
          method="POST"
          action="/commands/${command.id}/delete"
          onsubmit="return confirm('حذف شود؟')"
        >

          <input
            type="hidden"
            name="bot_id"
            value="${bot.id}"
          >

          <button class="btn red">
            🗑 حذف
          </button>

        </form>

      </td>

    </tr>
    `;
  }


  res.send(
    page(
      "مدیریت ربات",
      `
      <div class="hero">

        <h1>
          🤖 @${bot.username || "unknown"}
        </h1>

        <p>
          ${bot.first_name || ""}
        </p>

        ${
          bot.active
            ? `<span class="status on">🟢 ربات فعال است</span>`
            : `<span class="status off">🔴 ربات غیرفعال است</span>`
        }

        <div class="grid">

          <div class="card">
            <h3>👥 کاربران</h3>
            <div class="number">${users.rows.length}</div>
          </div>

          <div class="card">
            <h3>💬 دستورات</h3>
            <div class="number">${commands.rows.length}</div>
          </div>

        </div>

      </div>


      <div class="form">

        <h2>💬 افزودن دستور</h2>

        <form method="POST" action="/commands/add">

          <input
            type="hidden"
            name="bot_id"
            value="${bot.id}"
          >

          <label>نام دستور</label>

          <input
            name="command"
            placeholder="help"
            required
            dir="ltr"
          >

          <label>جواب دستور</label>

          <textarea
            name="answer"
            placeholder="متن پاسخی که ربات ارسال کند..."
            required
          ></textarea>

          <button class="btn green">
            ➕ ذخیره دستور
          </button>

        </form>

      </div>


      <div class="card">

        <h2>💬 دستورات این ربات</h2>

        <div class="tablewrap">

          <table>

            <tr>
              <th>دستور</th>
              <th>پاسخ</th>
              <th>عملیات</th>
            </tr>

            ${commandRows || `
              <tr>
                <td colspan="3" style="text-align:center">
                  هنوز دستوری اضافه نشده است.
                </td>
              </tr>
            `}

          </table>

        </div>

      </div>


      <div class="card">

        <h2>👥 کاربران ذخیره‌شده</h2>

        <div class="tablewrap">

          <table>

            <tr>
              <th>Telegram ID</th>
              <th>نام</th>
              <th>Username</th>
              <th>وضعیت</th>
              <th>عملیات</th>
            </tr>

            ${userRows || `
              <tr>
                <td colspan="5" style="text-align:center">
                  هنوز کاربری ثبت نشده است.
                </td>
              </tr>
            `}

          </table>

        </div>

      </div>
      `
    )
  );
});


// =====================================================
// USER TOGGLE
// =====================================================

app.post("/user/:id/toggle", auth, async (req, res) => {

  await pool.query(
    `
    UPDATE users
    SET active=NOT active,
        updated_at=NOW()
    WHERE id=$1
    `,
    [req.params.id]
  );

  res.redirect("/bot/" + req.body.bot_id);
});


// =====================================================
// COMMAND ADD
// =====================================================

app.post("/commands/add", auth, async (req, res) => {

  const botId = Number(req.body.bot_id);

  let command = String(req.body.command || "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase();

  const answer = String(req.body.answer || "").trim();

  if (!command || !answer) {
    return res.redirect("/bot/" + botId);
  }

  await pool.query(
    `
    INSERT INTO commands
    (bot_id,command,answer)
    VALUES($1,$2,$3)
    ON CONFLICT(bot_id,command)
    DO UPDATE SET
      answer=EXCLUDED.answer,
      active=true
    `,
    [botId, command, answer]
  );

  res.redirect("/bot/" + botId);
});


// =====================================================
// COMMAND DELETE
// =====================================================

app.post("/commands/:id/delete", auth, async (req, res) => {

  await pool.query(
    `DELETE FROM commands WHERE id=$1`,
    [req.params.id]
  );

  res.redirect("/bot/" + req.body.bot_id);
});


// =====================================================
// BROADCAST
// =====================================================

app.get("/broadcast", auth, async (req, res) => {

  const bots = await pool.query(
    `
    SELECT *
    FROM bots
    ORDER BY id DESC
    `
  );

  let options = "";

  for (const bot of bots.rows) {

    options += `
      <option value="${bot.id}">
        @${bot.username || "unknown"}
      </option>
    `;
  }

  res.send(
    page(
      "ارسال پیام",
      `
      <div class="hero">

        <h1>📢 ارسال پیام به کاربران</h1>

        <p>
        پیام واقعاً از طریق Telegram Bot API ارسال می‌شود.
        </p>

      </div>

      <div class="form">

        <form method="POST" action="/broadcast">

          <label>انتخاب ربات</label>

          <select name="bot_id" required>

            <option value="">
              انتخاب ربات
            </option>

            ${options}

          </select>

          <label>متن پیام</label>

          <textarea
            name="message"
            placeholder="پیام خود را بنویسید..."
            required
          ></textarea>

          <label>
            ارسال فقط به کاربران فعال
          </label>

          <select name="only_active">

            <option value="true">
              بله
            </option>

            <option value="false">
              خیر
            </option>

          </select>

          <button class="btn green">
            📤 ارسال واقعی به کاربران
          </button>

        </form>

      </div>
      `
    )
  );
});


app.post("/broadcast", auth, async (req, res) => {

  const botId = Number(req.body.bot_id);

  const message = String(req.body.message || "");

  const onlyActive = req.body.only_active === "true";

  const botResult = await pool.query(
    `SELECT * FROM bots WHERE id=$1`,
    [botId]
  );

  if (!botResult.rows.length) {
    return res.redirect("/broadcast");
  }

  const bot = botResult.rows[0];

  let query = `
    SELECT *
    FROM users
    WHERE bot_id=$1
  `;

  if (onlyActive) {
    query += ` AND active=true`;
  }

  query += ` ORDER BY id ASC`;

  const users = await pool.query(query, [botId]);

  let success = 0;
  let failed = 0;

  for (const user of users.rows) {

    try {

      const result = await telegram(
        bot.token,
        "sendMessage",
        {
          chat_id: String(user.telegram_id),
          text: message
        }
      );

      if (result.ok) {
        success++;
      } else {
        failed++;

        // اگر کاربر ربات را Block کرده باشد
        if (
          result.error_code === 403 ||
          String(result.description || "")
            .toLowerCase()
            .includes("blocked")
        ) {
          await pool.query(
            `
            UPDATE users
            SET active=false
            WHERE id=$1
            `,
            [user.id]
          );
        }
      }

    } catch (error) {

      failed++;

      console.error(
        "Broadcast error:",
        user.telegram_id,
        error.message
      );
    }

    // کمی فاصله برای جلوگیری از فشار زیاد روی API
    await sleep(50);
  }

  res.send(
    page(
      "نتیجه ارسال",
      `
      <div class="hero">

        <h1>📊 نتیجه ارسال</h1>

        <div class="grid">

          <div class="card">
            <h3>🟢 موفق</h3>
            <div class="number">${success}</div>
          </div>

          <div class="card">
            <h3>🔴 ناموفق</h3>
            <div class="number">${failed}</div>
          </div>

          <div class="card">
            <h3>👥 کل</h3>
            <div class="number">${users.rows.length}</div>
          </div>

        </div>

        <br>

        <a class="btn" href="/broadcast">
          بازگشت
        </a>

      </div>
      `
    )
  );
});


// =====================================================
// TELEGRAM POLLING
// =====================================================

const runningBots = new Set();

async function startBotPolling(botId) {

  if (runningBots.has(botId)) {
    return;
  }

  runningBots.add(botId);

  console.log("Starting polling for bot:", botId);

  while (true) {

    try {

      const botResult = await pool.query(
        `SELECT * FROM bots WHERE id=$1`,
        [botId]
      );

      if (!botResult.rows.length) {
        runningBots.delete(botId);
        return;
      }

      const bot = botResult.rows[0];

      if (!bot.active) {
        await sleep(5000);
        continue;
      }

      const result = await telegram(
        bot.token,
        "getUpdates",
        {
          offset: Number(bot.offset || 0),
          timeout: 25,
          allowed_updates: ["message"]
        }
      );

      if (!result.ok) {

        console.error(
          `Bot ${botId}:`,
          result.description
        );

        await sleep(5000);
        continue;
      }

      for (const update of result.result) {

        await processUpdate(bot, update);

        await pool.query(
          `
          UPDATE bots
          SET offset=$1
          WHERE id=$2
          `,
          [
            update.update_id + 1,
            botId
          ]
        );
      }

    } catch (error) {

      console.error(
        `Polling error bot ${botId}:`,
        error.message
      );

      await sleep(5000);
    }
  }
}


// =====================================================
// PROCESS TELEGRAM MESSAGE
// =====================================================

async function processUpdate(bot, update) {

  if (!update.message) {
    return;
  }

  const message = update.message;

  if (!message.from || !message.chat) {
    return;
  }

  const telegramId = message.from.id;

  // =========================================
  // SAVE USER AUTOMATICALLY
  // =========================================

  await pool.query(
    `
    INSERT INTO users
    (
      bot_id,
      telegram_id,
      username,
      first_name,
      last_name,
      active,
      updated_at
    )
    VALUES($1,$2,$3,$4,$5,true,NOW())

    ON CONFLICT(bot_id,telegram_id)

    DO UPDATE SET
      username=EXCLUDED.username,
      first_name=EXCLUDED.first_name,
      last_name=EXCLUDED.last_name,
      updated_at=NOW()
    `,
    [
      bot.id,
      telegramId,
      message.from.username || "",
      message.from.first_name || "",
      message.from.last_name || ""
    ]
  );

  const text = String(message.text || "").trim();

  if (!text) {
    return;
  }

  // =========================================
  // CHECK USER ACTIVE
  // =========================================

  const userResult = await pool.query(
    `
    SELECT active
    FROM users
    WHERE bot_id=$1
    AND telegram_id=$2
    `,
    [
      bot.id,
      telegramId
    ]
  );

  if (
    userResult.rows.length &&
    !userResult.rows[0].active
  ) {

    await telegram(
      bot.token,
      "sendMessage",
      {
        chat_id: String(telegramId),
        text:
          "🔴 دسترسی شما در حال حاضر غیرفعال است."
      }
    );

    return;
  }

  // =========================================
  // /START
  // =========================================

  if (
    text === "/start" ||
    text.startsWith("/start ")
  ) {

    await telegram(
      bot.token,
      "sendMessage",
      {
        chat_id: String(telegramId),
        text:
          "سلام 👋\n\n" +
          "به ربات خوش آمدید.\n" +
          "شما با موفقیت ثبت شدید. ✅"
      }
    );

    return;
  }

  // =========================================
  // COMMAND
  // =========================================

  if (text.startsWith("/")) {

    const command = text
      .split(/\s+/)[0]
      .split("@")[0]
      .replace(/^\/+/, "")
      .toLowerCase();

    const commandResult = await pool.query(
      `
      SELECT answer
      FROM commands
      WHERE bot_id=$1
      AND command=$2
      AND active=true
      LIMIT 1
      `,
      [
        bot.id,
        command
      ]
    );

    if (commandResult.rows.length) {

      await telegram(
        bot.token,
        "sendMessage",
        {
          chat_id: String(telegramId),
          text: commandResult.rows[0].answer
        }
      );
    }
  }
}


// =====================================================
// START ALL ACTIVE BOTS
// =====================================================

async function startAllBots() {

  const result = await pool.query(
    `
    SELECT id
    FROM bots
    WHERE active=true
    ORDER BY id
    `
  );

  for (const bot of result.rows) {

    startBotPolling(bot.id);

    await sleep(300);
  }
}


// =====================================================
// CREATOR LOGIN
// =====================================================

app.get("/creator-login", (req, res) => {

  res.send(
    page(
      "ورود سازنده",
      `
      <div class="login">

        <div class="hero">

          <div style="font-size:60px">👑</div>

          <h1>ورود سازنده</h1>

          <p>
          بخش مدیریت اصلی ربات‌ها
          </p>

          <form method="POST" action="/creator-login">

            <input
              type="password"
              name="password"
              placeholder="رمز سازنده"
              required
            >

            <button class="btn orange" style="width:100%">
              👑 ورود سازنده
            </button>

          </form>

        </div>

      </div>
      `,
      false
    )
  );
});


app.post("/creator-login", (req, res) => {

  if (req.body.password !== CREATOR_PASSWORD) {

    return res.send(
      page(
        "خطا",
        `
        <div class="login">
          <div class="hero">
            <h2>❌ رمز اشتباه است</h2>
            <a class="btn" href="/creator-login">
              بازگشت
            </a>
          </div>
        </div>
        `,
        false
      )
    );
  }

  req.session.creator = true;

  res.redirect("/creator");
});


// =====================================================
// CREATOR PANEL
// =====================================================

app.get("/creator", creatorAuth, async (req, res) => {

  const bots = await pool.query(
    `
    SELECT
      b.*,
      COUNT(u.id)::int AS users
    FROM bots b
    LEFT JOIN users u ON u.bot_id=b.id
    GROUP BY b.id
    ORDER BY b.id DESC
    `
  );

  let cards = "";

  for (const bot of bots.rows) {

    cards += `
    <div class="card">

      <h2>
        🤖 @${bot.username || "unknown"}
      </h2>

      <p>
        ${bot.first_name || ""}
      </p>

      <p>
        👥 کاربران:
        <b>${bot.users}</b>
      </p>

      <p>
        🔑 Token:
      </p>

      <div
        style="
          padding:12px;
          background:rgba(0,0,0,.3);
          border-radius:12px;
          direction:ltr;
          word-break:break-all;
        "
      >
        ${escapeHtml(bot.token)}
      </div>

      <br>

      <form
        method="POST"
        action="/creator/bot/${bot.id}/toggle"
      >

        <button class="btn ${bot.active ? "orange" : "green"}">
          ${bot.active ? "⏸ غیرفعال کردن" : "▶️ فعال کردن"}
        </button>

      </form>

    </div>
    `;
  }

  res.send(
    page(
      "پنل سازنده",
      `
      <div class="hero">

        <h1>👑 پنل سازنده</h1>

        <p>
        تمام ربات‌های ثبت‌شده در سیستم
        </p>

      </div>

      <div class="grid">

        ${cards || `
          <div class="card">
            هنوز رباتی ثبت نشده است.
          </div>
        `}

      </div>
      `
    )
  );
});


app.post(
  "/creator/bot/:id/toggle",
  creatorAuth,
  async (req, res) => {

    await pool.query(
      `
      UPDATE bots
      SET active=NOT active
      WHERE id=$1
      `,
      [req.params.id]
    );

    res.redirect("/creator");
  }
);


// =====================================================
// LOGOUT
// =====================================================

app.get("/logout", (req, res) => {

  req.session.destroy(() => {
    res.redirect("/");
  });
});


// =====================================================
// HELPERS
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// =====================================================
// START SERVER
// =====================================================

async function startServer() {

  try {

    await initDB();

    app.listen(PORT, () => {

      console.log(
        `Kowsar panel running on port ${PORT}`
      );

    });

    await startAllBots();

  } catch (error) {

    console.error(
      "SERVER START ERROR:",
      error
    );

    process.exit(1);
  }
}

startServer();
