const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  "https://nova-proxy-1-7cdg.onrender.com"
).replace(/\/$/, "");

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "kowsar-panel-secret-2026-change-me";

const db = new Database("panel.db");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("trust proxy", 1);

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

/* =========================================================
   DATABASE
========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  total_volume TEXT DEFAULT 'نامحدود',
  used_volume TEXT DEFAULT '0',
  expiry TEXT DEFAULT 'نامحدود',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_configs (
  user_id INTEGER NOT NULL,
  config_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, config_id)
);

CREATE TABLE IF NOT EXISTS telegram_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER UNIQUE NOT NULL,
  token TEXT NOT NULL,
  username TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  state TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  UNIQUE(admin_id, chat_id)
);
`);

/* =========================================================
   HELPERS
========================================================= */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attr(value) {
  return esc(value);
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function panelLink(token) {
  return `${PUBLIC_URL}/u/${encodeURIComponent(token)}`;
}

function subLink(token) {
  return `${PUBLIC_URL}/sub/${encodeURIComponent(token)}`;
}

function adminRequired(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect("/");
  }

  next();
}

function currentAdmin(req) {
  return db
    .prepare("SELECT * FROM admins WHERE id = ?")
    .get(req.session.adminId);
}

function getUser(id, adminId) {
  return db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE id = ?
      AND admin_id = ?
      `
    )
    .get(id, adminId);
}

function getUserConfigs(userId, adminId) {
  return db
    .prepare(
      `
      SELECT c.*
      FROM configs c
      INNER JOIN user_configs uc
        ON uc.config_id = c.id
      INNER JOIN users u
        ON u.id = uc.user_id
      WHERE uc.user_id = ?
      AND c.admin_id = ?
      AND u.admin_id = ?
      ORDER BY c.id ASC
      `
    )
    .all(userId, adminId);
}

function getAdminConfigs(adminId) {
  return db
    .prepare(
      `
      SELECT *
      FROM configs
      WHERE admin_id = ?
      ORDER BY id DESC
      `
    )
    .all(adminId);
}

/* =========================================================
   BEAUTIFUL BLUE DESIGN
========================================================= */

function layout(title, content, logged = false) {
  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1.0,maximum-scale=1.0">

<title>${esc(title)}</title>

<style>

*{
  box-sizing:border-box;
}

html{
  scroll-behavior:smooth;
}

body{
  margin:0;
  min-height:100vh;
  color:#fff;
  font-family:
  Tahoma,
  Arial,
  sans-serif;

  background:
    radial-gradient(
      circle at 15% 15%,
      rgba(0,174,255,.35),
      transparent 32%
    ),
    radial-gradient(
      circle at 85% 30%,
      rgba(42,89,255,.30),
      transparent 35%
    ),
    linear-gradient(
      135deg,
      #020817,
      #061a38,
      #031126,
      #020713
    );

  overflow-x:hidden;
}

body:before,
body:after{
  content:"";
  position:fixed;
  width:420px;
  height:420px;
  border-radius:50%;
  filter:blur(70px);
  opacity:.35;
  z-index:-2;
  animation:float 12s infinite alternate ease-in-out;
}

body:before{
  background:#008cff;
  top:-160px;
  right:-100px;
}

body:after{
  background:#005eff;
  bottom:-180px;
  left:-100px;
  animation-delay:3s;
}

@keyframes float{
  from{
    transform:translate(0,0) scale(1);
  }
  to{
    transform:translate(80px,50px) scale(1.2);
  }
}

.bg-grid{
  position:fixed;
  inset:0;
  z-index:-1;
  opacity:.13;
  background-image:
    linear-gradient(
      rgba(0,183,255,.18) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      rgba(0,183,255,.18) 1px,
      transparent 1px
    );
  background-size:45px 45px;
  mask-image:linear-gradient(
    to bottom,
    black,
    transparent 90%
  );
}

.container{
  width:min(1180px,94%);
  margin:auto;
}

.topbar{
  margin:18px 0;
  padding:14px 17px;
  border-radius:24px;

  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.11),
      rgba(255,255,255,.035)
    );

  border:1px solid rgba(255,255,255,.12);

  backdrop-filter:blur(25px);

  box-shadow:
    0 20px 60px rgba(0,0,0,.35),
    inset 0 1px rgba(255,255,255,.12);

  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:15px;
}

.brand{
  display:flex;
  align-items:center;
  gap:12px;
  font-weight:bold;
}

.brand-icon{
  width:46px;
  height:46px;
  border-radius:16px;

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
    0 0 30px rgba(0,174,255,.45);
}

.nav{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
}

.nav a{
  padding:10px 13px;
  border-radius:13px;
  color:#d9efff;
  background:rgba(255,255,255,.055);
  border:1px solid rgba(255,255,255,.06);
  font-size:13px;
}

.nav a:hover{
  background:rgba(0,180,255,.15);
}

.hero{
  position:relative;
  overflow:hidden;

  margin-top:22px;
  padding:35px;

  border-radius:32px;

  background:
    linear-gradient(
      135deg,
      rgba(0,143,255,.22),
      rgba(0,41,100,.20)
    );

  border:1px solid rgba(70,202,255,.18);

  box-shadow:
    0 30px 90px rgba(0,0,0,.35),
    inset 0 1px rgba(255,255,255,.08);
}

.hero:after{
  content:"";
  position:absolute;
  width:250px;
  height:250px;
  border-radius:50%;
  background:rgba(0,188,255,.12);
  filter:blur(20px);
  top:-130px;
  left:-80px;
}

.hero h1{
  position:relative;
  z-index:1;
  margin:0 0 10px;
  font-size:32px;
}

.hero p{
  position:relative;
  z-index:1;
  color:#a9c9e8;
  line-height:2;
}

.grid{
  display:grid;
  grid-template-columns:
  repeat(auto-fit,minmax(220px,1fr));
  gap:17px;
  margin-top:18px;
}

.card{
  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.095),
      rgba(255,255,255,.035)
    );

  border:1px solid rgba(255,255,255,.10);

  border-radius:24px;
  padding:22px;

  backdrop-filter:blur(22px);

  box-shadow:
    0 18px 55px rgba(0,0,0,.25),
    inset 0 1px rgba(255,255,255,.07);
}

.stat{
  margin-top:9px;
  font-size:30px;
  font-weight:bold;

  background:
    linear-gradient(
      90deg,
      #fff,
      #68d9ff
    );

  -webkit-background-clip:text;
  color:transparent;
}

.muted{
  color:#91aec9;
  font-size:13px;
}

.form-card{
  max-width:760px;
  margin:25px auto;
}

label{
  display:block;
  margin:16px 0 8px;
  color:#cce9ff;
  font-size:14px;
}

input,
textarea,
select{
  width:100%;
  padding:14px 15px;
  border-radius:15px;

  border:1px solid rgba(255,255,255,.10);

  background:
    rgba(0,8,25,.65);

  color:#fff;
  outline:none;
  font-size:14px;
}

textarea{
  min-height:170px;
  resize:vertical;
  font-family:monospace;
  direction:ltr;
  text-align:left;
}

input:focus,
textarea:focus{
  border-color:#00bfff;
  box-shadow:
    0 0 0 3px rgba(0,191,255,.09),
    0 0 25px rgba(0,191,255,.10);
}

.btn,
button{
  display:inline-flex;
  justify-content:center;
  align-items:center;
  gap:7px;

  padding:12px 17px;

  border:0;
  border-radius:14px;

  color:white;
  cursor:pointer;

  font-size:13px;
  font-weight:bold;

  background:
    linear-gradient(
      135deg,
      #007cff,
      #00cfff
    );

  box-shadow:
    0 9px 25px rgba(0,146,255,.18);

  transition:.2s;
}

.btn:hover,
button:hover{
  transform:translateY(-2px);
  box-shadow:
    0 13px 30px rgba(0,174,255,.25);
}

.btn-dark{
  background:rgba(255,255,255,.07);
  box-shadow:none;
}

.btn-red{
  background:
    linear-gradient(
      135deg,
      #e92755,
      #ff4b72
    );
}

.btn-green{
  background:
    linear-gradient(
      135deg,
      #00a884,
      #00d4a0
    );
}

.actions{
  display:flex;
  flex-wrap:wrap;
  gap:9px;
  margin-top:17px;
}

.table-wrap{
  overflow-x:auto;
}

table{
  width:100%;
  border-collapse:collapse;
  min-width:700px;
}

th,
td{
  padding:14px;
  border-bottom:
    1px solid rgba(255,255,255,.07);
  text-align:right;
}

th{
  color:#70d8ff;
  font-size:12px;
}

td{
  color:#dceeff;
}

.badge{
  display:inline-block;
  padding:6px 10px;
  border-radius:50px;
  font-size:11px;
}

.on{
  color:#55efbd;
  background:rgba(0,220,160,.10);
}

.off{
  color:#ff7e9a;
  background:rgba(255,60,90,.10);
}

.config{
  margin-top:12px;
  padding:15px;

  border-radius:16px;

  background:
    rgba(0,4,15,.72);

  border:
    1px solid rgba(0,180,255,.10);

  color:#8fe1ff;

  font-family:monospace;

  line-height:1.8;

  word-break:break-all;

  direction:ltr;
  text-align:left;
}

.notice{
  padding:15px;
  border-radius:16px;

  background:
    rgba(0,160,255,.07);

  border:
    1px solid rgba(0,190,255,.13);

  color:#bdeaff;
  line-height:1.9;
}

.center{
  text-align:center;
}

.login{
  width:min(440px,94%);
  margin:75px auto;

  padding:30px;

  border-radius:30px;

  background:
    rgba(255,255,255,.07);

  border:
    1px solid rgba(255,255,255,.11);

  backdrop-filter:blur(25px);

  box-shadow:
    0 30px 90px rgba(0,0,0,.4);
}

.login .brand-icon{
  margin:auto;
}

.footer{
  text-align:center;
  padding:45px 10px 25px;
  color:#6585a5;
  font-size:12px;
}

.footer a{
  color:#54d6ff;
}

.user-title{
  font-size:28px;
}

.user-sub{
  color:#9bc3df;
  line-height:2;
}

.big-link{
  padding:18px;
  border-radius:18px;
  background:rgba(0,140,255,.09);
  border:1px solid rgba(0,190,255,.12);
  word-break:break-all;
  color:#67d8ff;
  direction:ltr;
  text-align:left;
  font-family:monospace;
}

.feature{
  display:flex;
  align-items:center;
  gap:13px;
  padding:15px;
  border-radius:17px;
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.06);
}

.feature-icon{
  width:42px;
  height:42px;
  min-width:42px;
  border-radius:14px;

  display:flex;
  align-items:center;
  justify-content:center;

  background:
    rgba(0,174,255,.12);
}

@media(max-width:650px){

  .topbar{
    flex-direction:column;
    align-items:stretch;
  }

  .nav{
    width:100%;
  }

  .nav a{
    flex:1;
    text-align:center;
  }

  .hero{
    padding:23px;
    border-radius:25px;
  }

  .hero h1{
    font-size:25px;
  }

  .card{
    padding:18px;
  }

  .actions .btn,
  .actions button{
    flex:1;
  }

}

</style>
</head>

<body>

<div class="bg-grid"></div>

<div class="container">

${
  logged
    ? `
<div class="topbar">

<div class="brand">
<div class="brand-icon">⚡</div>
<div>
<div>پنل مدیریت کوثر</div>
<div class="muted">مدیریت کاربران و کانفیگ‌ها</div>
</div>
</div>

<div class="nav">
<a href="/admin">🏠 خانه</a>
<a href="/admin/add">➕ کاربر</a>
<a href="/admin/settings">⚙️ تنظیمات</a>
<a href="/admin/telegram">🤖 ربات</a>
<a href="/logout">🚪 خروج</a>
</div>

</div>
`
    : ""
}

${content}

<div class="footer">
پنل مدیریت کوثر
<br><br>
<a href="https://t.me/ommkko" target="_blank">
⚡ قدرت گرفته از همین
</a>
</div>

</div>

</body>
</html>
`;
}

/* =========================================================
   LOGIN
========================================================= */

app.get("/", (req, res) => {

  if (req.session.adminId) {
    return res.redirect("/admin");
  }

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM admins")
    .get().c;

  if (!count) {

    return res.send(
      layout(
        "ساخت مدیر",
        `
<div class="login">

<div class="center">

<div class="brand-icon">⚡</div>

<h1>پنل مدیریت کوثر</h1>

<p class="muted">
ساخت حساب مدیر
</p>

</div>

<form method="POST" action="/create-admin">

<label>نام کاربری</label>
<input
name="username"
required
autocomplete="username"
placeholder="admin"
>

<label>رمز عبور</label>
<input
type="password"
name="password"
required
autocomplete="new-password"
placeholder="رمز عبور"
>

<br><br>

<button style="width:100%">
🚀 ساخت حساب مدیر
</button>

</form>

</div>
`
      )
    );
  }

  res.send(
    layout(
      "ورود",
      `
<div class="login">

<div class="center">

<div class="brand-icon">⚡</div>

<h1>پنل مدیریت کوثر</h1>

<p class="muted">
ورود امن به پنل مدیریت
</p>

</div>

<form method="POST" action="/login">

<label>نام کاربری</label>
<input
name="username"
required
>

<label>رمز عبور</label>
<input
type="password"
name="password"
required
>

<br><br>

<button style="width:100%">
🔐 ورود به پنل
</button>

</form>

</div>
`
    )
  );
});

app.post("/create-admin", async (req, res) => {

  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  if (!username || !password) {
    return res.send("اطلاعات کامل نیست.");
  }

  const exists = db
    .prepare(
      "SELECT id FROM admins WHERE username = ?"
    )
    .get(username);

  if (exists) {
    return res.send("این نام کاربری قبلاً ثبت شده است.");
  }

  const hash =
    await bcrypt.hash(password, 12);

  const result = db
    .prepare(
      `
      INSERT INTO admins(username,password)
      VALUES(?,?)
      `
    )
    .run(username, hash);

  req.session.adminId =
    result.lastInsertRowid;

  res.redirect("/admin");
});

app.post("/login", async (req, res) => {

  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  const admin = db
    .prepare(
      "SELECT * FROM admins WHERE username = ?"
    )
    .get(username);

  if (!admin) {
    return res.send("نام کاربری یا رمز عبور اشتباه است.");
  }

  const ok =
    await bcrypt.compare(
      password,
      admin.password
    );

  if (!ok) {
    return res.send("نام کاربری یا رمز عبور اشتباه است.");
  }

  req.session.adminId = admin.id;

  res.redirect("/admin");
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get("/admin", adminRequired, (req, res) => {

  const admin = currentAdmin(req);

  const total = db
    .prepare(
      "SELECT COUNT(*) AS c FROM users WHERE admin_id = ?"
    )
    .get(admin.id).c;

  const active = db
    .prepare(
      `
      SELECT COUNT(*) AS c
      FROM users
      WHERE admin_id = ?
      AND active = 1
      `
    )
    .get(admin.id).c;

  const configCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM configs WHERE admin_id = ?"
    )
    .get(admin.id).c;

  const bot = db
    .prepare(
      "SELECT * FROM telegram_bots WHERE admin_id = ?"
    )
    .get(admin.id);

  const users = db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE admin_id = ?
      ORDER BY id DESC
      LIMIT 20
      `
    )
    .all(admin.id);

  res.send(
    layout(
      "داشبورد",
      `
<div class="hero">

<h1>👋 سلام ${esc(admin.username)}</h1>

<p>
به داشبورد مدیریت کوثر خوش آمدید.
همه کاربران، کانفیگ‌ها و ربات تلگرام از اینجا مدیریت می‌شوند.
</p>

<div class="actions">

<a class="btn" href="/admin/add">
➕ ساخت پنل کاربر
</a>

<a class="btn btn-dark" href="/admin/settings">
⚙️ مدیریت کانفیگ
</a>

<a
class="btn btn-green"
href="https://t.me/ommkkobot"
target="_blank"
>
🆓 ساخت پنل رایگان
</a>

</div>

</div>

<div class="grid">

<div class="card">
<div class="muted">👥 کل کاربران</div>
<div class="stat">${total}</div>
</div>

<div class="card">
<div class="muted">🟢 فعال</div>
<div class="stat">${active}</div>
</div>

<div class="card">
<div class="muted">📦 کانفیگ‌ها</div>
<div class="stat">${configCount}</div>
</div>

<div class="card">
<div class="muted">🤖 ربات</div>
<div class="stat">${bot ? "🟢" : "🔴"}</div>
</div>

</div>

<div class="card" style="margin-top:20px">

<h2>👥 کاربران</h2>

<div class="table-wrap">

<table>

<tr>
<th>نام</th>
<th>حجم</th>
<th>انقضا</th>
<th>وضعیت</th>
<th></th>
</tr>

${
  users.length
    ? users.map(u => `
<tr>

<td>${esc(u.name)}</td>

<td>${esc(u.total_volume)}</td>

<td>${esc(u.expiry)}</td>

<td>
${
  u.active
    ? `<span class="badge on">فعال</span>`
    : `<span class="badge off">غیرفعال</span>`
}
</td>

<td>
<a
class="btn"
href="/admin/user/${u.id}"
>
مدیریت
</a>
</td>

</tr>
`).join("")
    : `
<tr>
<td colspan="5" class="center">
هنوز کاربری ساخته نشده است.
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
});

/* =========================================================
   ADD USER
========================================================= */

app.get("/admin/add", adminRequired, (req, res) => {

  const configs =
    getAdminConfigs(req.session.adminId);

  res.send(
    layout(
      "ساخت پنل",
      `
<div class="card form-card">

<h2>➕ ساخت پنل کاربر</h2>

<p class="muted">
برای کاربر یک پنل اختصاصی بسازید و کانفیگ‌های موردنظر را انتخاب کنید.
</p>

<form method="POST" action="/admin/add">

<label>نام کاربر</label>

<input
name="name"
required
placeholder="مثلاً علی"
>

<label>حجم</label>

<input
name="volume"
value="نامحدود"
placeholder="100GB"
>

<label>تاریخ انقضا</label>

<input
name="expiry"
value="نامحدود"
placeholder="1405/12/30"
>

<label>کانفیگ‌های این کاربر</label>

${
  configs.length
    ? configs.map(c => `
<label
style="
display:flex;
align-items:center;
gap:10px;
padding:13px;
margin-top:8px;
background:rgba(255,255,255,.04);
border-radius:14px;
"
>

<input
type="checkbox"
name="configs"
value="${c.id}"
style="width:auto"
>

<span>
${esc(c.name)}
</span>

</label>
`).join("")
    : `
<div class="notice">
⚠️ هنوز کانفیگی اضافه نکرده‌اید.
ابتدا از بخش تنظیمات کانفیگ اضافه کنید.
</div>
`
}

<br>

<button>
🚀 ساخت پنل
</button>

</form>

</div>
`
    )
  );
});

app.post("/admin/add", adminRequired, (req, res) => {

  const adminId = req.session.adminId;

  const name =
    String(req.body.name || "").trim();

  const volume =
    String(req.body.volume || "نامحدود").trim();

  const expiry =
    String(req.body.expiry || "نامحدود").trim();

  let selected = req.body.configs || [];

  if (!Array.isArray(selected)) {
    selected = [selected];
  }

  if (!name) {
    return res.send("نام کاربر الزامی است.");
  }

  const token = makeToken();

  const result = db
    .prepare(
      `
      INSERT INTO users
      (
        admin_id,
        name,
        token,
        total_volume,
        expiry
      )
      VALUES(?,?,?,?,?)
      `
    )
    .run(
      adminId,
      name,
      token,
      volume,
      expiry
    );

  const userId =
    result.lastInsertRowid;

  const insertUserConfig =
    db.prepare(
      `
      INSERT OR IGNORE INTO user_configs
      (user_id, config_id)
      VALUES(?,?)
      `
    );

  const transaction =
    db.transaction(ids => {

      for (const id of ids) {

        const config =
          db.prepare(
            `
            SELECT id
            FROM configs
            WHERE id = ?
            AND admin_id = ?
            `
          )
          .get(id, adminId);

        if (config) {
          insertUserConfig.run(
            userId,
            config.id
          );
        }
      }

    });

  transaction(selected);

  res.redirect(
    `/admin/user/${userId}`
  );
});

/* =========================================================
   USER DETAIL
========================================================= */

app.get(
  "/admin/user/:id",
  adminRequired,
  (req, res) => {

    const user =
      getUser(
        req.params.id,
        req.session.adminId
      );

    if (!user) {
      return res.status(404).send("کاربر پیدا نشد.");
    }

    const configs =
      getUserConfigs(
        user.id,
        req.session.adminId
      );

    const link =
      panelLink(user.token);

    const sub =
      subLink(user.token);

    res.send(
      layout(
        "مدیریت کاربر",
        `
<div class="hero">

<h1>👤 ${esc(user.name)}</h1>

<p>
مدیریت کامل پنل اختصاصی این کاربر
</p>

<div class="actions">

<a
class="btn"
href="${attr(link)}"
target="_blank"
>
🌐 صفحه کاربر
</a>

<a
class="btn btn-green"
href="/admin/user/${user.id}/qr"
target="_blank"
>
📱 QR Code
</a>

</div>

</div>

<div class="grid">

<div class="card">

<div class="muted">
📦 حجم
</div>

<div class="stat"
style="font-size:21px">
${esc(user.total_volume)}
</div>

</div>

<div class="card">

<div class="muted">
📅 انقضا
</div>

<div class="stat"
style="font-size:21px">
${esc(user.expiry)}
</div>

</div>

<div class="card">

<div class="muted">
وضعیت
</div>

<div class="stat"
style="font-size:21px">
${user.active ? "🟢 فعال" : "🔴 غیرفعال"}
</div>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>🔗 لینک پنل</h2>

<div class="big-link">
${esc(link)}
</div>

<div class="actions">

<button
onclick='copyText(${JSON.stringify(link)})'
>
📋 کپی لینک
</button>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>📡 لینک اشتراک</h2>

<div class="big-link">
${esc(sub)}
</div>

<div class="actions">

<a
class="btn"
href="${attr(sub)}"
target="_blank"
>
🔗 تست اشتراک
</a>

<button
onclick='copyText(${JSON.stringify(sub)})'
>
📋 کپی اشتراک
</button>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>✏️ ویرایش</h2>

<form
method="POST"
action="/admin/user/${user.id}/update"
>

<label>نام</label>

<input
name="name"
value="${attr(user.name)}"
required
>

<label>حجم</label>

<input
name="volume"
value="${attr(user.total_volume)}"
>

<label>انقضا</label>

<input
name="expiry"
value="${attr(user.expiry)}"
>

<label>
کانفیگ‌های این کاربر
</label>

${
  getAdminConfigs(req.session.adminId)
    .map(c => {

      const checked =
        configs.some(
          x => x.id === c.id
        );

      return `
<label
style="
display:flex;
align-items:center;
gap:10px;
padding:12px;
background:rgba(255,255,255,.04);
border-radius:13px;
"
>

<input
type="checkbox"
name="configs"
value="${c.id}"
${checked ? "checked" : ""}
style="width:auto"
>

<span>${esc(c.name)}</span>

</label>
`;

    }).join("")
}

<br>

<button>
💾 ذخیره تغییرات
</button>

</form>

<div class="actions">

<form
method="POST"
action="/admin/user/${user.id}/toggle"
>

<button
class="${user.active ? "btn-red" : "btn-green"}"
>
${user.active ? "🔴 غیرفعال کردن" : "🟢 فعال کردن"}
</button>

</form>

<form
method="POST"
action="/admin/user/${user.id}/delete"
onsubmit="return confirm('این کاربر حذف شود؟')"
>

<button class="btn-red">
🗑️ حذف کاربر
</button>

</form>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>📦 کانفیگ‌های فعال این کاربر</h2>

${
  configs.length
    ? configs.map(c => `
<div style="margin-top:18px">

<div>
<b>${esc(c.name)}</b>
</div>

<div class="config">
${esc(c.config)}
</div>

</div>
`).join("")
    : `
<div class="notice">
برای این کاربر هنوز کانفیگی انتخاب نشده است.
</div>
`
}

</div>

<script>

function copyText(text){

  navigator.clipboard.writeText(text)
  .then(() => {
    alert("کپی شد ✅");
  })
  .catch(() => {
    prompt("لینک:", text);
  });

}

</script>
`
      )
    );
  }
);

/* =========================================================
   UPDATE USER
========================================================= */

app.post(
  "/admin/user/:id/update",
  adminRequired,
  (req, res) => {

    const adminId =
      req.session.adminId;

    const user =
      getUser(
        req.params.id,
        adminId
      );

    if (!user) {
      return res.status(404).send("کاربر پیدا نشد.");
    }

    const name =
      String(req.body.name || "").trim();

    const volume =
      String(
        req.body.volume || "نامحدود"
      ).trim();

    const expiry =
      String(
        req.body.expiry || "نامحدود"
      ).trim();

    let selected =
      req.body.configs || [];

    if (!Array.isArray(selected)) {
      selected = [selected];
    }

    db.prepare(
      `
      UPDATE users
      SET name = ?,
          total_volume = ?,
          expiry = ?
      WHERE id = ?
      AND admin_id = ?
      `
    ).run(
      name,
      volume,
      expiry,
      user.id,
      adminId
    );

    db.prepare(
      "DELETE FROM user_configs WHERE user_id = ?"
    ).run(user.id);

    const insert =
      db.prepare(
        `
        INSERT OR IGNORE INTO user_configs
        (user_id, config_id)
        VALUES(?,?)
        `
      );

    for (const id of selected) {

      const config =
        db.prepare(
          `
          SELECT id
          FROM configs
          WHERE id = ?
          AND admin_id = ?
          `
        )
        .get(id, adminId);

      if (config) {
        insert.run(
          user.id,
          config.id
        );
      }
    }

    res.redirect(
      `/admin/user/${user.id}`
    );
  }
);

/* =========================================================
   TOGGLE
========================================================= */

app.post(
  "/admin/user/:id/toggle",
  adminRequired,
  (req, res) => {

    const user =
      getUser(
        req.params.id,
        req.session.adminId
      );

    if (!user) {
      return res.status(404).send("کاربر پیدا نشد.");
    }

    db.prepare(
      `
      UPDATE users
      SET active = ?
      WHERE id = ?
      AND admin_id = ?
      `
    ).run(
      user.active ? 0 : 1,
      user.id,
      req.session.adminId
    );

    res.redirect(
      `/admin/user/${user.id}`
    );
  }
);

/* =========================================================
   DELETE USER
========================================================= */

app.post(
  "/admin/user/:id/delete",
  adminRequired,
  (req, res) => {

    const user =
      getUser(
        req.params.id,
        req.session.adminId
      );

    if (!user) {
      return res.redirect("/admin");
    }

    db.prepare(
      "DELETE FROM user_configs WHERE user_id = ?"
    ).run(user.id);

    db.prepare(
      `
      DELETE FROM users
      WHERE id = ?
      AND admin_id = ?
      `
    ).run(
      user.id,
      req.session.adminId
    );

    res.redirect("/admin");
  }
);

/* =========================================================
   QR
========================================================= */

app.get(
  "/admin/user/:id/qr",
  adminRequired,
  async (req, res) => {

    const user =
      getUser(
        req.params.id,
        req.session.adminId
      );

    if (!user) {
      return res.status(404).send("کاربر پیدا نشد.");
    }

    const link =
      panelLink(user.token);

    const qr =
      await QRCode.toDataURL(link, {
        width:500,
        margin:2
      });

    res.send(
      layout(
        "QR Code",
        `
<div class="card center"
style="max-width:600px;margin:35px auto">

<h1>📱 QR Code</h1>

<p class="muted">
پنل ${esc(user.name)}
</p>

<div
style="
background:white;
padding:18px;
border-radius:25px;
display:inline-block;
margin:20px 0;
"
>

<img
src="${qr}"
style="
width:280px;
max-width:100%;
display:block;
"
>

</div>

<div class="big-link">
${esc(link)}
</div>

<div class="actions"
style="justify-content:center">

<button
onclick='copyText(${JSON.stringify(link)})'
>
📋 کپی لینک
</button>

<a
class="btn btn-dark"
href="/admin/user/${user.id}"
>
⬅️ بازگشت
</a>

</div>

</div>

<script>

function copyText(text){
navigator.clipboard.writeText(text)
.then(()=>alert("کپی شد ✅"))
.catch(()=>prompt("لینک:",text));
}

</script>
`
      )
    );
  }
);

/* =========================================================
   PUBLIC USER PAGE
========================================================= */

app.get("/u/:token", (req, res) => {

  const token =
    String(req.params.token);

  const user =
    db.prepare(
      `
      SELECT *
      FROM users
      WHERE token = ?
      `
    ).get(token);

  if (!user) {

    return res.status(404).send(
      layout(
        "پنل پیدا نشد",
        `
<div class="card center"
style="max-width:600px;margin:70px auto">

<div class="brand-icon"
style="margin:auto">
⚠️
</div>

<h1>پنل پیدا نشد</h1>

<p class="muted">
لینک پنل اشتباه است یا این پنل حذف شده است.
</p>

<a
class="btn"
href="https://t.me/ommkkobot"
target="_blank"
>
🆓 ساخت پنل رایگان
</a>

</div>
`
      )
    );
  }

  if (!user.active) {

    return res.status(403).send(
      layout(
        "پنل غیرفعال",
        `
<div class="card center"
style="max-width:600px;margin:70px auto">

<div class="brand-icon"
style="margin:auto">
🔒
</div>

<h1>پنل غیرفعال است</h1>

<p class="muted">
این پنل در حال حاضر توسط مدیریت غیرفعال شده است.
</p>

</div>
`
      )
    );
  }

  const configs =
    getUserConfigs(
      user.id,
      user.admin_id
    );

  const subscription =
    subLink(user.token);

  res.send(
    layout(
      "پنل اختصاصی",
      `
<div class="hero">

<div
style="
display:flex;
align-items:center;
gap:15px;
position:relative;
z-index:1;
"
>

<div class="brand-icon">
⚡
</div>

<div>

<h1 class="user-title">
پنل ${esc(user.name)}
</h1>

<div class="user-sub">
پنل اختصاصی شما با موفقیت آماده شده است.
</div>

</div>

</div>

<div class="grid">

<div class="card">

<div class="feature">

<div class="feature-icon">
📦
</div>

<div>
<div class="muted">حجم سرویس</div>
<b>${esc(user.total_volume)}</b>
</div>

</div>

</div>

<div class="card">

<div class="feature">

<div class="feature-icon">
📅
</div>

<div>
<div class="muted">تاریخ انقضا</div>
<b>${esc(user.expiry)}</b>
</div>

</div>

</div>

<div class="card">

<div class="feature">

<div class="feature-icon">
🟢
</div>

<div>
<div class="muted">وضعیت</div>
<b>فعال</b>
</div>

</div>

</div>

</div>

</div>

<div class="actions"
style="position:relative;z-index:1">

<a
class="btn"
href="${attr(subscription)}"
>
🔗 دریافت اشتراک
</a>

<a
class="btn btn-green"
href="https://t.me/ommkkobot"
target="_blank"
>
🆓 ساخت پنل رایگان
</a>

<a
class="btn btn-dark"
href="https://t.me/ommkko"
target="_blank"
>
⚡ قدرت گرفته از همین
</a>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>📡 لینک اشتراک شما</h2>

<p class="muted">
این لینک را داخل برنامه سازگار با اشتراک وارد کنید.
</p>

<div class="big-link">
${esc(subscription)}
</div>

<div class="actions">

<button
onclick='copyText(${JSON.stringify(subscription)})'
>
📋 کپی لینک اشتراک
</button>

</div>

</div>

<div class="card" style="margin-top:20px">

<h2>🔐 کانفیگ‌های شما</h2>

${
  configs.length
    ? configs.map((c, index) => `
<div
style="
margin-top:20px;
padding-top:18px;
border-top:1px solid rgba(255,255,255,.07);
"
>

<div
style="
display:flex;
align-items:center;
justify-content:space-between;
gap:10px;
"
>

<h3>
${index + 1}. ${esc(c.name)}
</h3>

<button
onclick='copyText(${JSON.stringify(c.config)})'
>
📋 کپی
</button>

</div>

<div class="config">
${esc(c.config)}
</div>

</div>
`).join("")
    : `
<div class="notice">
هنوز کانفیگی برای این پنل قرار داده نشده است.
</div>
`
}

</div>

<div
class="card"
style="
margin-top:20px;
text-align:center;
"
>

<div class="brand-icon"
style="margin:auto">
⚡
</div>

<h3>
ساخت پنل رایگان
</h3>

<p class="muted">
برای ساخت پنل رایگان روی دکمه زیر بزنید.
</p>

<a
class="btn"
href="https://t.me/ommkkobot"
target="_blank"
>
🆓 ساخت پنل رایگان
</a>

<br><br>

<a
href="https://t.me/ommkko"
target="_blank"
style="color:#59d9ff"
>
⚡ قدرت گرفته از همین
</a>

</div>

<script>

function copyText(text){

  navigator.clipboard.writeText(text)
  .then(function(){
    alert("با موفقیت کپی شد ✅");
  })
  .catch(function(){
    prompt("کپی کنید:",text);
  });

}

</script>
`
    )
  );
});

/* =========================================================
   SUBSCRIPTION
========================================================= */

app.get("/sub/:token", (req, res) => {

  const token =
    String(req.params.token);

  const user =
    db.prepare(
      `
      SELECT *
      FROM users
      WHERE token = ?
      `
    ).get(token);

  if (!user || !user.active) {
    return res.status(404).send("Not Found");
  }

  const configs =
    getUserConfigs(
      user.id,
      user.admin_id
    );

  const output =
    configs
      .map(c => c.config.trim())
      .filter(Boolean)
      .join("\n");

  res.setHeader(
    "Content-Type",
    "text/plain; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.send(output);
});

/* =========================================================
   SETTINGS / CONFIGS
========================================================= */

app.get(
  "/admin/settings",
  adminRequired,
  (req, res) => {

    const configs =
      getAdminConfigs(
        req.session.adminId
      );

    res.send(
      layout(
        "تنظیمات",
        `
<div class="hero">

<h1>⚙️ تنظیمات پنل</h1>

<p>
کانفیگ‌های اصلی را از اینجا اضافه کنید.
بعداً هنگام ساخت هر کاربر، کانفیگ موردنظر را برای همان کاربر انتخاب می‌کنید.
</p>

</div>

<div class="card form-card">

<h2>➕ افزودن کانفیگ</h2>

<form
method="POST"
action="/admin/settings/config"
>

<label>نام کانفیگ</label>

<input
name="name"
required
placeholder="مثلاً Trojan - IPv4 : 443"
>

<label>کانفیگ کامل</label>

<textarea
name="config"
required
placeholder="vless://...
trojan://...
..."
></textarea>

<br>

<button>
💾 ذخیره کانفیگ
</button>

</form>

</div>

<div class="card" style="margin-top:20px">

<h2>📦 کانفیگ‌های شما</h2>

${
  configs.length
    ? configs.map(c => `
<div class="card"
style="margin-top:15px">

<h3>
${esc(c.name)}
</h3>

<div class="config">
${esc(c.config)}
</div>

<div class="actions">

<button
onclick='copyText(${JSON.stringify(c.config)})'
>
📋 کپی
</button>

<form
method="POST"
action="/admin/settings/config/${c.id}/delete"
onsubmit="return confirm('این کانفیگ حذف شود؟')"
>

<button class="btn-red">
🗑️ حذف
</button>

</form>

</div>

</div>
`).join("")
    : `
<div class="notice">
هنوز هیچ کانفیگی اضافه نشده است.
</div>
`
}

</div>

<script>

function copyText(text){

navigator.clipboard.writeText(text)
.then(()=>alert("کپی شد ✅"))
.catch(()=>prompt("متن:",text));

}

</script>
`
      )
    );
  }
);

app.post(
  "/admin/settings/config",
  adminRequired,
  (req, res) => {

    const name =
      String(req.body.name || "").trim();

    const config =
      String(req.body.config || "").trim();

    if (!name || !config) {
      return res.send(
        "نام و کانفیگ الزامی است."
      );
    }

    db.prepare(
      `
      INSERT INTO configs
      (admin_id,name,config)
      VALUES(?,?,?)
      `
    ).run(
      req.session.adminId,
      name,
      config
    );

    res.redirect("/admin/settings");
  }
);

app.post(
  "/admin/settings/config/:id/delete",
  adminRequired,
  (req, res) => {

    db.prepare(
      `
      DELETE FROM configs
      WHERE id = ?
      AND admin_id = ?
      `
    ).run(
      req.params.id,
      req.session.adminId
    );

    res.redirect("/admin/settings");
  }
);

/* =========================================================
   TELEGRAM API
========================================================= */

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

async function tgSend(
  token,
  chatId,
  text,
  keyboard
) {

  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(
    token,
    "sendMessage",
    body
  );
}

function tgMenu() {

  return [
    [
      {
        text: "➕ ساخت پنل",
        callback_data: "add"
      },
      {
        text: "👥 کاربران",
        callback_data: "users"
      }
    ],
    [
      {
        text: "📊 آمار",
        callback_data: "stats"
      },
      {
        text: "📦 کانفیگ‌ها",
        callback_data: "configs"
      }
    ],
    [
      {
        text: "🆓 ساخت پنل رایگان",
        url: "https://t.me/ommkkobot"
      }
    ],
    [
      {
        text: "⚡ قدرت گرفته از همین",
        url: "https://t.me/ommkko"
      }
    ]
  ];
}

/* =========================================================
   TELEGRAM PAGE
========================================================= */

app.get(
  "/admin/telegram",
  adminRequired,
  (req, res) => {

    const bot =
      db.prepare(
        `
        SELECT *
        FROM telegram_bots
        WHERE admin_id = ?
        `
      )
      .get(req.session.adminId);

    res.send(
      layout(
        "اتصال ربات",
        `
<div class="hero">

<h1>🤖 اتصال ربات تلگرام</h1>

<p>
توکن ربات را وارد کنید.
بعد از اتصال، مدیریت کاربران از داخل تلگرام نیز امکان‌پذیر خواهد بود.
</p>

</div>

<div class="card form-card">

<form
method="POST"
action="/admin/telegram/connect"
>

<label>توکن ربات</label>

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

${
  bot
    ? `
<div class="notice"
style="margin-top:20px">

🟢 ربات متصل است

<br><br>

<b>
@${esc(bot.username || "ربات")}
</b>

</div>

<form
method="POST"
action="/admin/telegram/disconnect"
onsubmit="return confirm('اتصال ربات قطع شود؟')"
style="margin-top:15px"
>

<button class="btn-red">
🔴 قطع اتصال
</button>

</form>
`
    : `
<div class="notice"
style="margin-top:20px"
>
🔴 هنوز رباتی متصل نشده است.
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
   CONNECT TELEGRAM
========================================================= */

app.post(
  "/admin/telegram/connect",
  adminRequired,
  async (req, res) => {

    const token =
      String(req.body.token || "").trim();

    if (!token) {
      return res.send("توکن وارد نشده است.");
    }

    try {

      const me =
        await telegram(
          token,
          "getMe"
        );

      if (!me.ok) {
        return res.send(
          "❌ توکن ربات اشتباه است."
        );
      }

      const username =
        me.result.username || "";

      db.prepare(
        `
        INSERT INTO telegram_bots
        (admin_id,token,username)
        VALUES(?,?,?)

        ON CONFLICT(admin_id)
        DO UPDATE SET
          token=excluded.token,
          username=excluded.username
        `
      ).run(
        req.session.adminId,
        token,
        username
      );

      const webhookUrl =
        `${PUBLIC_URL}/telegram/webhook/${encodeURIComponent(token)}`;

      const hook =
        await telegram(
          token,
          "setWebhook",
          {
            url: webhookUrl,
            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      if (!hook.ok) {

        console.error(
          "Webhook error:",
          hook
        );

        return res.send(
          `
          ربات شناسایی شد اما Webhook تنظیم نشد.<br><br>
          ${esc(
            hook.description ||
            "خطای ناشناخته"
          )}
          `
        );
      }

      res.redirect("/admin/telegram");

    } catch (error) {

      console.error(error);

      res.send(
        "❌ اتصال ربات انجام نشد."
      );
    }
  }
);

/* =========================================================
   DISCONNECT TELEGRAM
========================================================= */

app.post(
  "/admin/telegram/disconnect",
  adminRequired,
  async (req, res) => {

    const bot =
      db.prepare(
        `
        SELECT *
        FROM telegram_bots
        WHERE admin_id = ?
        `
      )
      .get(req.session.adminId);

    if (bot) {

      try {
        await telegram(
          bot.token,
          "deleteWebhook"
        );
      } catch {}
    }

    db.prepare(
      `
      DELETE FROM telegram_bots
      WHERE admin_id = ?
      `
    ).run(req.session.adminId);

    db.prepare(
      `
      DELETE FROM telegram_states
      WHERE admin_id = ?
      `
    ).run(req.session.adminId);

    res.redirect("/admin/telegram");
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
        FROM telegram_bots
        WHERE token = ?
        `
      )
      .get(token);

    if (!bot) return;

    try {

      if (req.body.message) {

        await handleTelegramMessage(
          token,
          bot.admin_id,
          req.body.message
        );
      }

      if (req.body.callback_query) {

        await handleTelegramCallback(
          token,
          bot.admin_id,
          req.body.callback_query
        );
      }

    } catch (error) {

      console.error(
        "Telegram webhook:",
        error
      );
    }
  }
);

/* =========================================================
   TELEGRAM MESSAGE
========================================================= */

async function handleTelegramMessage(
  token,
  adminId,
  message
) {

  const chatId =
    message.chat.id;

  const text =
    String(message.text || "").trim();

  const state =
    db.prepare(
      `
      SELECT *
      FROM telegram_states
      WHERE admin_id = ?
      AND chat_id = ?
      `
    )
    .get(
      adminId,
      String(chatId)
    );

  if (text === "/start") {

    return tgSend(
      token,
      chatId,
      `
<b>⚡ پنل مدیریت کوثر</b>

سلام 👋

به ربات مدیریت پنل خوش آمدید.

از منوی زیر می‌توانید کاربران و پنل‌ها را مدیریت کنید.
`,
      tgMenu()
    );
  }

  if (text === "/users") {
    return tgUsers(
      token,
      adminId,
      chatId
    );
  }

  if (text === "/stats") {
    return tgStats(
      token,
      adminId,
      chatId
    );
  }

  if (text === "/add") {
    return startTgAdd(
      token,
      adminId,
      chatId
    );
  }

  if (!state) {

    return tgSend(
      token,
      chatId,
      "یک گزینه را انتخاب کنید 👇",
      tgMenu()
    );
  }

  const data =
    JSON.parse(
      state.data || "{}"
    );

  if (state.state === "name") {

    data.name = text;

    db.prepare(
      `
      UPDATE telegram_states
      SET state = ?, data = ?
      WHERE admin_id = ?
      AND chat_id = ?
      `
    ).run(
      "volume",
      JSON.stringify(data),
      adminId,
      String(chatId)
    );

    return tgSend(
      token,
      chatId,
      "📦 حجم را وارد کنید:\nمثلاً 100GB یا نامحدود"
    );
  }

  if (state.state === "volume") {

    data.volume = text;

    db.prepare(
      `
      UPDATE telegram_states
      SET state = ?, data = ?
      WHERE admin_id = ?
      AND chat_id = ?
      `
    ).run(
      "expiry",
      JSON.stringify(data),
      adminId,
      String(chatId)
    );

    return tgSend(
      token,
      chatId,
      "📅 تاریخ انقضا را وارد کنید:\nمثلاً 1405/12/30 یا نامحدود"
    );
  }

  if (state.state === "expiry") {

    data.expiry = text;

    const tokenUser =
      makeToken();

    const result =
      db.prepare(
        `
        INSERT INTO users
        (
          admin_id,
          name,
          token,
          total_volume,
          expiry
        )
        VALUES(?,?,?,?,?)
        `
      )
      .run(
        adminId,
        data.name,
        tokenUser,
        data.volume,
        data.expiry
      );

    db.prepare(
      `
      DELETE FROM telegram_states
      WHERE admin_id = ?
      AND chat_id = ?
      `
    ).run(
      adminId,
      String(chatId)
    );

    return tgSend(
      token,
      chatId,
      `
<b>✅ پنل ساخته شد</b>

👤 نام: ${esc(data.name)}
📦 حجم: ${esc(data.volume)}
📅 انقضا: ${esc(data.expiry)}

🔗 لینک پنل:
${esc(panelLink(tokenUser))}

🔗 لینک اشتراک:
${esc(subLink(tokenUser))}
`,
      [
        [
          {
            text: "🌐 ورود به پنل",
            url: panelLink(tokenUser)
          }
        ],
        [
          {
            text: "🆓 ساخت پنل رایگان",
            url: "https://t.me/ommkkobot"
          }
        ],
        [
          {
            text: "⚡ قدرت گرفته از همین",
            url: "https://t.me/ommkko"
          }
        ]
      ]
    );
  }
}

/* =========================================================
   START TELEGRAM ADD
========================================================= */

async function startTgAdd(
  token,
  adminId,
  chatId
) {

  db.prepare(
    `
    INSERT INTO telegram_states
    (admin_id,chat_id,state,data)
    VALUES(?,?,?,?)

    ON CONFLICT(admin_id,chat_id)
    DO UPDATE SET
      state=excluded.state,
      data=excluded.data
    `
  ).run(
    adminId,
    String(chatId),
    "name",
    "{}"
  );

  return tgSend(
    token,
    chatId,
    "👤 نام کاربر را وارد کنید:"
  );
}

/* =========================================================
   TELEGRAM USERS
========================================================= */

async function tgUsers(
  token,
  adminId,
  chatId
) {

  const users =
    db.prepare(
      `
      SELECT *
      FROM users
      WHERE admin_id = ?
      ORDER BY id DESC
      LIMIT 30
      `
    ).all(adminId);

  if (!users.length) {

    return tgSend(
      token,
      chatId,
      "👥 هنوز کاربری ساخته نشده است.",
      tgMenu()
    );
  }

  let text =
    "<b>👥 کاربران</b>\n\n";

  const keyboard = [];

  for (const u of users) {

    text +=
      `${u.active ? "🟢" : "🔴"} ` +
      `<b>${esc(u.name)}</b>\n` +
      `📦 ${esc(u.total_volume)}\n` +
      `📅 ${esc(u.expiry)}\n\n`;

    keyboard.push([
      {
        text: `👤 ${u.name}`,
        callback_data: `user:${u.id}`
      }
    ]);
  }

  keyboard.push([
    {
      text: "➕ ساخت پنل",
      callback_data: "add"
    }
  ]);

  return tgSend(
    token,
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   TELEGRAM USER DETAIL
========================================================= */

async function tgUser(
  token,
  adminId,
  chatId,
  userId
) {

  const user =
    getUser(
      userId,
      adminId
    );

  if (!user) {

    return tgSend(
      token,
      chatId,
      "❌ کاربر پیدا نشد."
    );
  }

  return tgSend(
    token,
    chatId,
    `
<b>👤 ${esc(user.name)}</b>

📦 حجم: ${esc(user.total_volume)}
📅 انقضا: ${esc(user.expiry)}
📌 وضعیت: ${user.active ? "🟢 فعال" : "🔴 غیرفعال"}

🔗 پنل:
${esc(panelLink(user.token))}

🔗 اشتراک:
${esc(subLink(user.token))}
`,
    [
      [
        {
          text: user.active
            ? "🔴 غیرفعال کردن"
            : "🟢 فعال کردن",
          callback_data:
            `toggle:${user.id}`
        }
      ],
      [
        {
          text: "🗑️ حذف",
          callback_data:
            `delete:${user.id}`
        }
      ],
      [
        {
          text: "🌐 ورود به پنل",
          url: panelLink(user.token)
        }
      ],
      [
        {
          text: "🆓 ساخت پنل رایگان",
          url: "https://t.me/ommkkobot"
        }
      ],
      [
        {
          text: "⚡ قدرت گرفته از همین",
          url: "https://t.me/ommkko"
        }
      ]
    ]
  );
}

/* =========================================================
   TELEGRAM STATS
========================================================= */

async function tgStats(
  token,
  adminId,
  chatId
) {

  const total =
    db.prepare(
      `
      SELECT COUNT(*) AS c
      FROM users
      WHERE admin_id = ?
      `
    ).get(adminId).c;

  const active =
    db.prepare(
      `
      SELECT COUNT(*) AS c
      FROM users
      WHERE admin_id = ?
      AND active = 1
      `
    ).get(adminId).c;

  const configs =
    db.prepare(
      `
      SELECT COUNT(*) AS c
      FROM configs
      WHERE admin_id = ?
      `
    ).get(adminId).c;

  return tgSend(
    token,
    chatId,
    `
<b>📊 آمار پنل</b>

👥 کل کاربران: ${total}
🟢 کاربران فعال: ${active}
📦 تعداد کانفیگ‌ها: ${configs}
`,
    tgMenu()
  );
}

/* =========================================================
   TELEGRAM CONFIGS
========================================================= */

async function tgConfigs(
  token,
  adminId,
  chatId
) {

  const configs =
    getAdminConfigs(adminId);

  if (!configs.length) {

    return tgSend(
      token,
      chatId,
      "📦 هنوز هیچ کانفیگی اضافه نشده است."
    );
  }

  let text =
    "<b>📦 کانفیگ‌های پنل</b>\n\n";

  for (const c of configs) {

    text +=
      `🔹 <b>${esc(c.name)}</b>\n` +
      `${esc(c.config)}\n\n`;
  }

  return tgSend(
    token,
    chatId,
    text,
    tgMenu()
  );
}

/* =========================================================
   TELEGRAM CALLBACK
========================================================= */

async function handleTelegramCallback(
  token,
  adminId,
  callback
) {

  const chatId =
    callback.message.chat.id;

  const data =
    String(callback.data || "");

  await telegram(
    token,
    "answerCallbackQuery",
    {
      callback_query_id:
        callback.id
    }
  );

  if (data === "add") {

    return startTgAdd(
      token,
      adminId,
      chatId
    );
  }

  if (data === "users") {

    return tgUsers(
      token,
      adminId,
      chatId
    );
  }

  if (data === "stats") {

    return tgStats(
      token,
      adminId,
      chatId
    );
  }

  if (data === "configs") {

    return tgConfigs(
      token,
      adminId,
      chatId
    );
  }

  if (data.startsWith("user:")) {

    const id =
      Number(data.split(":")[1]);

    return tgUser(
      token,
      adminId,
      chatId,
      id
    );
  }

  if (data.startsWith("toggle:")) {

    const id =
      Number(data.split(":")[1]);

    const user =
      getUser(id, adminId);

    if (!user) return;

    db.prepare(
      `
      UPDATE users
      SET active = ?
      WHERE id = ?
      AND admin_id = ?
      `
    ).run(
      user.active ? 0 : 1,
      id,
      adminId
    );

    return tgUser(
      token,
      adminId,
      chatId,
      id
    );
  }

  if (data.startsWith("delete:")) {

    const id =
      Number(data.split(":")[1]);

    db.prepare(
      `
      DELETE FROM user_configs
      WHERE user_id = ?
      `
    ).run(id);

    db.prepare(
      `
      DELETE FROM users
      WHERE id = ?
      AND admin_id = ?
      `
    ).run(
      id,
      adminId
    );

    return tgSend(
      token,
      chatId,
      "✅ کاربر حذف شد.",
      tgMenu()
    );
  }
}

/* =========================================================
   LOGOUT
========================================================= */

app.get("/logout", (req, res) => {

  req.session.destroy(() => {
    res.redirect("/");
  });

});

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Kowsar Panel running on port ${PORT}`
    );

    console.log(
      `Public URL: ${PUBLIC_URL}`
    );

  }
);
