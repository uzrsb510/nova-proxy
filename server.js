const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "mmkk1122";

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DB = {
  users: [],
  bots: [],
  botUsers: {},
  commands: {},
  forceJoins: {},
  forceJoinVerified: {},
  activities: []
};

let db;

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function saveDB() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("SAVE DB ERROR:", err.message);
  }
}

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );
    } else {
      db = JSON.parse(
        JSON.stringify(DEFAULT_DB)
      );
    }
  } catch (err) {
    console.error("LOAD DB ERROR:", err.message);

    db = JSON.parse(
      JSON.stringify(DEFAULT_DB)
    );
  }

  for (const key of Object.keys(DEFAULT_DB)) {
    if (db[key] === undefined) {
      db[key] = JSON.parse(
        JSON.stringify(DEFAULT_DB[key])
      );
    }
  }

  if (!Array.isArray(db.users))
    db.users = [];

  if (!Array.isArray(db.bots))
    db.bots = [];

  if (!db.botUsers)
    db.botUsers = {};

  if (!db.commands)
    db.commands = {};

  if (!db.forceJoins)
    db.forceJoins = {};

  if (!db.forceJoinVerified)
    db.forceJoinVerified = {};

  if (!Array.isArray(db.activities))
    db.activities = [];

  for (const bot of db.bots) {

    if (!Array.isArray(bot.forceJoins)) {
      bot.forceJoins = [];
    }

    if (!db.botUsers[bot.id]) {
      db.botUsers[bot.id] = {};
    }

    if (!db.commands[bot.id]) {
      db.commands[bot.id] = {};
    }

    if (!db.forceJoinVerified[bot.id]) {
      db.forceJoinVerified[bot.id] = {};
    }

    /*
     * سازگاری با نسخه قدیمی
     */
    for (const join of bot.forceJoins) {

      if (!join.id) {
        join.id = makeId();
      }

      /*
       * در نسخه جدید chatId حتماً باید وجود داشته باشد.
       * اگر نسخه قدیمی chatId نداشت،
       * هنگام بررسی از username استفاده می‌کنیم.
       */
      if (!join.chatId) {
        join.chatId = null;
      }
    }
  }

  saveDB();
}

loadDB();

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function addActivity(
  type,
  title,
  details = "",
  meta = {}
) {
  db.activities.unshift({
    id: makeId(),
    type,
    title,
    details,
    meta,
    createdAt: Date.now()
  });

  db.activities =
    db.activities.slice(0, 300);

  saveDB();
}

/* =====================================================
   TELEGRAM API
===================================================== */

function telegramUrl(token, method) {
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
  const response = await fetch(
    telegramUrl(token, method),
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "پاسخ نامعتبر از تلگرام"
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

/*
 * خیلی مهم:
 * اگر قبلاً Webhook برای ربات تنظیم شده باشد،
 * getUpdates کار نمی‌کند.
 */
async function prepareBotPolling(bot) {
  try {
    await telegram(
      bot.token,
      "deleteWebhook",
      {
        drop_pending_updates: false
      }
    );

    console.log(
      "Webhook removed:",
      bot.username || bot.name
    );

  } catch (err) {

    console.error(
      "DELETE WEBHOOK ERROR:",
      bot.username || bot.name,
      err.message
    );
  }
}

/* =====================================================
   SESSION
===================================================== */

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(express.json());

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "nova-proxy-secret",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      maxAge:
        1000 * 60 * 60 * 24 * 7
    }
  })
);

/* =====================================================
   AUTH
===================================================== */

function requireLogin(req, res, next) {

  if (!req.session.userId) {
    return res.redirect("/login");
  }

  next();
}

function requireCreator(req, res, next) {

  if (!req.session.creator) {
    return res.redirect(
      "/creator/login"
    );
  }

  next();
}

function getUserBots(req) {

  return db.bots.filter(
    bot =>
      bot.ownerId ===
      req.session.userId
  );
}

function getBotForUser(req, id) {

  return db.bots.find(
    bot =>
      bot.id === id &&
      bot.ownerId ===
      req.session.userId
  );
}

/* =====================================================
   HTML PAGE
===================================================== */

function page(
  title,
  content,
  options = {}
) {

  const loggedIn =
    !!options.loggedIn;

  const creator =
    !!options.creator;

  return `
<!DOCTYPE html>

<html lang="fa" dir="rtl">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0"
>

<title>
${esc(title)} - Nova Proxy
</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: Tahoma, Arial, sans-serif;
  color: #172033;

  background:
    radial-gradient(
      circle at top right,
      #8b5cf655,
      transparent 30%
    ),

    radial-gradient(
      circle at bottom left,
      #00c2ff44,
      transparent 30%
    ),

    linear-gradient(
      135deg,
      #eef2ff,
      #ffffff
    );
}

body.dark {

  color: #f5f7ff;

  background:
    radial-gradient(
      circle at top right,
      #7c3aed55,
      transparent 30%
    ),

    radial-gradient(
      circle at bottom left,
      #0891b255,
      transparent 30%
    ),

    #0f1524;
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

  position: fixed;

  top: 0;
  right: 0;
  left: 0;

  height: 68px;

  z-index: 900;

  display: flex;
  align-items: center;

  padding: 0 75px;

  background:
    rgba(255,255,255,.75);

  backdrop-filter:
    blur(18px);

  border-bottom:
    1px solid #ffffff66;
}

body.dark .topbar {
  background:
    rgba(15,21,36,.8);
}

.top-title {

  font-weight: 900;
  font-size: 18px;
}

.container {

  width:
    min(
      1180px,
      calc(100% - 28px)
    );

  margin: auto;

  padding-top: 95px;
  padding-bottom: 40px;
}

.card {

  background:
    rgba(255,255,255,.78);

  backdrop-filter:
    blur(18px);

  border-radius: 24px;

  padding: 22px;

  margin-bottom: 18px;

  box-shadow:
    0 15px 45px
    rgba(35,45,80,.1);
}

body.dark .card {

  background:
    rgba(25,31,48,.85);

  box-shadow:
    0 15px 45px
    rgba(0,0,0,.3);
}

h1 {
  margin-top: 0;
  font-size: 28px;
}

h2 {
  margin-top: 0;
}

.muted {
  opacity: .65;
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

  border-radius: 22px;

  background:
    linear-gradient(
      135deg,
      #7657ff22,
      #00bfff22
    );
}

.stat-number {

  margin-top: 8px;

  font-size: 32px;

  font-weight: 900;
}

.btn {

  display: inline-flex;

  align-items: center;
  justify-content: center;

  gap: 6px;

  min-height: 45px;

  padding:
    10px 17px;

  border: 0;

  border-radius: 14px;

  cursor: pointer;

  color: white;

  font-weight: 800;

  background:
    linear-gradient(
      135deg,
      #7657ff,
      #00a8ff
    );
}

.btn-danger {

  background:
    linear-gradient(
      135deg,
      #ff416c,
      #ff7043
    );
}

.btn-secondary {

  color: #172033;

  background:
    #e8edf7;
}

body.dark .btn-secondary {

  color: white;

  background:
    #293247;
}

.btn-success {

  background:
    linear-gradient(
      135deg,
      #00b894,
      #00cec9
    );
}

.form-group {
  margin-bottom: 16px;
}

label {

  display: block;

  margin-bottom: 8px;

  font-weight: 800;
}

input,
textarea,
select {

  width: 100%;

  padding: 13px;

  border-radius: 14px;

  border:
    1px solid #d8deea;

  outline: none;

  background: white;

  color: #172033;
}

body.dark input,
body.dark textarea,
body.dark select {

  background: #171e2d;

  color: white;

  border-color: #30394e;
}

textarea {

  min-height: 150px;

  resize: vertical;
}

.form-actions {

  display: flex;

  flex-wrap: wrap;

  gap: 10px;
}

.item-row {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 12px;

  flex-wrap: wrap;
}

.list-item {

  padding: 17px;

  border-radius: 18px;

  margin-bottom: 10px;

  background:
    #ffffff80;
}

body.dark .list-item {
  background:
    #ffffff08;
}

.alert {

  padding: 14px;

  border-radius: 15px;

  margin-bottom: 15px;

  font-weight: 700;
}

.alert-error {

  background: #ffe1e8;

  color: #a40025;
}

.alert-success {

  background: #dcfff1;

  color: #007453;
}

body.dark .alert-error {

  background: #461e2b;

  color: #ffb9c6;
}

body.dark .alert-success {

  background: #123b31;

  color: #a5ffe1;
}

.empty {

  text-align: center;

  padding: 35px 15px;

  opacity: .6;
}

.timeline-item {

  position: relative;

  padding:
    0 25px 22px 0;

  border-right:
    2px solid #d8deed;
}

body.dark .timeline-item {

  border-color:
    #30394e;
}

.timeline-item::before {

  content: "";

  position: absolute;

  right: -7px;

  top: 3px;

  width: 12px;
  height: 12px;

  border-radius: 50%;

  background:
    linear-gradient(
      135deg,
      #7657ff,
      #00a8ff
    );
}

.timeline-title {

  font-weight: 900;
}

.timeline-date {

  font-size: 12px;

  opacity: .55;

  margin-top: 5px;
}

.icon-btn {

  position: fixed;

  z-index: 1200;

  width: 42px;
  height: 42px;

  border: 0;

  border-radius: 14px;

  cursor: pointer;

  background: white;

  box-shadow:
    0 7px 25px #00000015;

  font-size: 20px;
}

body.dark .icon-btn {

  background:
    #20283a;

  color: white;
}

.menu-toggle {

  top: 13px;
  right: 15px;
}

.refresh-btn {

  top: 13px;
  left: 15px;
}

.theme-btn {

  top: 13px;
  left: 66px;
}

.side-menu {

  position: fixed;

  top: 0;

  right: -340px;

  width: 310px;

  height: 100vh;

  z-index: 1100;

  padding:
    80px 15px 20px;

  overflow-y: auto;

  background:
    rgba(255,255,255,.97);

  box-shadow:
    -20px 0 60px #00000025;

  transition: .3s;
}

body.dark .side-menu {

  background:
    #121827;
}

.side-menu.open {
  right: 0;
}

.side-title {

  font-size: 24px;

  font-weight: 900;

  padding:
    10px 14px 20px;
}

.side-menu a {

  display: block;

  padding: 14px;

  border-radius: 14px;

  margin: 5px 0;

  font-weight: 800;
}

.side-menu a:hover {

  background:
    #7657ff18;
}

.side-menu .logout {

  color: #e52f58;
}

.menu-bottom {

  margin-top: 25px;

  padding-top: 15px;

  border-top:
    1px solid #00000012;
}

body.dark .menu-bottom {

  border-color:
    #ffffff12;
}

.menu-bottom button {

  width: 100%;

  display: block;

  padding: 14px;

  border: 0;

  border-radius: 14px;

  margin: 6px 0;

  text-align: right;

  font-weight: 800;

  cursor: pointer;

  background:
    transparent;

  color: inherit;
}

.menu-bottom button:hover {

  background:
    #7657ff18;
}

.menu-overlay {

  display: none;

  position: fixed;

  inset: 0;

  z-index: 1000;

  background:
    #00000055;
}

.menu-overlay.show {
  display: block;
}

.auth {

  width:
    min(
      460px,
      calc(100% - 25px)
    );

  margin: 100px auto;
}

.center {
  text-align: center;
}

.badge {

  display: inline-block;

  padding:
    5px 10px;

  border-radius: 20px;

  font-size: 12px;

  font-weight: 800;

  background:
    #e7eaff;

  color:
    #5948ca;
}

body.dark .badge {

  background:
    #302c58;

  color:
    #ddd5ff;
}

table {

  width: 100%;

  border-collapse:
    collapse;
}

th,
td {

  padding: 12px;

  border-bottom:
    1px solid #8890a025;

  text-align: right;
}

.force-test {

  margin-top: 15px;

  padding: 14px;

  border-radius: 15px;

  background:
    linear-gradient(
      135deg,
      #7657ff12,
      #00a8ff12
    );
}

@media(max-width:600px) {

  .container {

    width:
      calc(100% - 16px);
  }

  .card {

    padding: 17px;

    border-radius: 19px;
  }

  h1 {

    font-size: 23px;
  }

  .side-menu {

    width: 285px;
  }
}

</style>

</head>

<body>

${
  loggedIn || creator
    ? `

<div class="topbar">

  <div class="top-title">
    ${esc(title)}
  </div>

</div>

<button
  class="icon-btn refresh-btn"
  title="بروزرسانی"
  onclick="location.reload()"
>
⟳
</button>

<button
  class="icon-btn theme-btn"
  title="تغییر ظاهر"
  onclick="toggleTheme()"
>
☾
</button>

<button
  class="icon-btn menu-toggle"
  title="منو"
  onclick="toggleMenu()"
>
☰
</button>

<div
  id="menuOverlay"
  class="menu-overlay"
  onclick="toggleMenu()"
></div>

<aside
  id="sideMenu"
  class="side-menu"
>

<div class="side-title">
🚀 Nova Proxy
</div>

${
  loggedIn
    ? `

<a href="/dashboard">
📊 داشبورد
</a>

<a href="/bots">
🤖 ربات ها
</a>

<a href="/bots/add">
➕ افزودن ربات
</a>

<a href="/forcejoin">
🔐 عضویت اجباری
</a>

<a href="/broadcast">
📢 ارسال پیام به همه کاربران
</a>

<a href="/commands/add">
➕ افزودن دستور
</a>

<a href="/commands">
⚡ دستورات
</a>

<a href="/users">
👥 آمار کاربران
</a>

<a
  class="logout"
  href="/logout"
>
🚪 خروج
</a>

<div class="menu-bottom">

<button
  type="button"
  onclick="toggleTheme();toggleMenu();"
>
🌓 تغییر حالت روشن / تاریک
</button>

<button
  type="button"
  onclick="location.reload()"
>
🔄 بروزرسانی
</button>

<a href="/creator/login">
👑 ورود سازنده
</a>

</div>

`
    : `

<a href="/creator">
👑 پنل سازنده
</a>

<a
  class="logout"
  href="/creator/logout"
>
🚪 خروج سازنده
</a>

`
}

</aside>
`
    : ""
}

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

  if (!menu || !overlay)
    return;

  menu.classList.toggle("open");

  overlay.classList.toggle("show");
}

function toggleTheme() {

  document.body.classList.toggle(
    "dark"
  );

  localStorage.setItem(
    "nova-theme",
    document.body.classList.contains(
      "dark"
    )
      ? "dark"
      : "light"
  );
}

if (
  localStorage.getItem(
    "nova-theme"
  ) === "dark"
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

/* =====================================================
   LOGIN
===================================================== */

app.get("/login", (req, res) => {

  res.send(
    page(
      "ورود",
      `
<div class="auth">

<div class="card">

<h1>
🔐 ورود
</h1>

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<form
  method="POST"
  action="/login"
>

<div class="form-group">

<label>
نام کاربری
</label>

<input
  name="username"
  required
>

</div>

<div class="form-group">

<label>
رمز عبور
</label>

<input
  type="password"
  name="password"
  required
>

</div>

<button
  class="btn"
  type="submit"
>
ورود
</button>

</form>

<p>
حساب ندارید؟
<a href="/register">
ثبت نام
</a>
</p>

</div>

</div>
`
    )
  );
});

app.post("/login", (req, res) => {

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
      u =>
        String(u.username)
          .toLowerCase() ===
        username.toLowerCase() &&
        u.password === password
    );

  if (!user) {

    return res.redirect(
      "/login?error=" +
      encodeURIComponent(
        "نام کاربری یا رمز عبور اشتباه است."
      )
    );
  }

  req.session.userId =
    user.id;

  addActivity(
    "login",
    "ورود کاربر",
    username
  );

  res.redirect(
    "/dashboard"
  );
});

/* =====================================================
   REGISTER
===================================================== */

app.get("/register", (req, res) => {

  res.send(
    page(
      "ثبت نام",
      `
<div class="auth">

<div class="card">

<h1>
📝 ثبت نام
</h1>

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<form
  method="POST"
  action="/register"
>

<div class="form-group">

<label>
نام کاربری
</label>

<input
  name="username"
  required
>

</div>

<div class="form-group">

<label>
رمز عبور
</label>

<input
  type="password"
  name="password"
  required
>

</div>

<button
  class="btn"
  type="submit"
>
ثبت نام
</button>

</form>

<p>
قبلاً ثبت نام کرده‌اید؟
<a href="/login">
ورود
</a>
</p>

</div>

</div>
`
    )
  );
});

app.post("/register", (req, res) => {

  const username =
    String(
      req.body.username || ""
    ).trim();

  const password =
    String(
      req.body.password || ""
    );

  if (!username || !password) {

    return res.redirect(
      "/register?error=" +
      encodeURIComponent(
        "اطلاعات را کامل وارد کنید."
      )
    );
  }

  if (
    db.users.some(
      u =>
        String(u.username)
          .toLowerCase() ===
        username.toLowerCase()
    )
  ) {

    return res.redirect(
      "/register?error=" +
      encodeURIComponent(
        "این نام کاربری قبلاً وجود دارد."
      )
    );
  }

  const user = {

    id: makeId(),

    username,

    password,

    createdAt:
      Date.now()
  };

  db.users.push(user);

  saveDB();

  req.session.userId =
    user.id;

  addActivity(
    "register",
    "ثبت نام کاربر جدید",
    username
  );

  res.redirect(
    "/dashboard"
  );
});

/* =====================================================
   LOGOUT
===================================================== */

app.get("/logout", (req, res) => {

  req.session.destroy(() => {

    res.redirect(
      "/login"
    );

  });

});

/* =====================================================
   DASHBOARD
===================================================== */

function totalBotUsers() {

  const ids =
    new Set();

  for (
    const bot of db.bots
  ) {

    for (
      const id of Object.keys(
        db.botUsers[
          bot.id
        ] || {}
      )
    ) {

      ids.add(id);

    }
  }

  return ids.size;
}

app.get(
  "/dashboard",
  requireLogin,
  (req, res) => {

    const bots =
      getUserBots(req);

    const botIds =
      new Set(
        bots.map(
          b => b.id
        )
      );

    const commands =
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

    const force =
      bots.reduce(
        (sum, bot) =>
          sum +
          (
            Array.isArray(
              bot.forceJoins
            )
              ? bot.forceJoins.length
              : 0
          ),
        0
      );

    const activities =
      db.activities
        .filter(
          a =>
            !a.meta?.botId ||
            botIds.has(
              a.meta.botId
            )
        )
        .slice(0, 15);

    res.send(
      page(
        "داشبورد",
        `
<h1>
📊 داشبورد
</h1>

<div class="grid">

<div class="stat">
🤖 ربات ها
<div class="stat-number">
${bots.length}
</div>
</div>

<div class="stat">
👥 کاربران تلگرام
<div class="stat-number">
${totalBotUsers()}
</div>
</div>

<div class="stat">
⚡ دستورات
<div class="stat-number">
${commands}
</div>
</div>

<div class="stat">
🔐 عضویت اجباری
<div class="stat-number">
${force}
</div>
</div>

</div>

<div class="card">

<h2>
🎬 فعالیت‌های اخیر
</h2>

${
  activities.length
    ? activities
        .map(
          a => `
<div class="timeline-item">

<div class="timeline-title">
${esc(a.title)}
</div>

<div>
${esc(a.details)}
</div>

<div class="timeline-date">
${new Date(
  a.createdAt
).toLocaleString("fa-IR")}
</div>

</div>
`
        )
        .join("")
    : `
<div class="empty">
هنوز فعالیتی ثبت نشده است.
</div>
`
}

</div>
`
      )
    );
  }
);

/* =====================================================
   BOTS
===================================================== */

app.get(
  "/bots",
  requireLogin,
  (req, res) => {

    const bots =
      getUserBots(req);

    res.send(
      page(
        "ربات ها",
        `
<div class="item-row">

<div>

<h1>
🤖 ربات ها
</h1>

<p class="muted">
مدیریت ربات‌های شما
</p>

</div>

<a
  class="btn"
  href="/bots/add"
>
➕ افزودن ربات
</a>

</div>

<div class="card">

${
  bots.length
    ? bots
        .map(
          bot => `
<div class="list-item">

<div class="item-row">

<div>

<strong>
🤖 ${esc(bot.name)}
</strong>

<div class="muted">
@${esc(bot.username)}
</div>

</div>

<div class="form-actions">

<a
  class="btn"
  href="/bots/${encodeURIComponent(
    bot.id
  )}"
>
مدیریت
</a>

<a
  class="btn btn-danger"
  href="/bots/delete?id=${encodeURIComponent(
    bot.id
  )}"
  onclick="
    return confirm(
      'این ربات حذف شود؟'
    )
  "
>
حذف
</a>

</div>

</div>

</div>
`
        )
        .join("")
    : `
<div class="empty">
هنوز رباتی اضافه نکرده‌اید.
</div>
`
}

</div>
`
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
<h1>
➕ افزودن ربات
</h1>

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<div class="card">

<form
  method="POST"
  action="/bots/add"
>

<div class="form-group">

<label>
نام ربات
</label>

<input
  name="name"
  placeholder="Nova Bot"
  required
>

</div>

<div class="form-group">

<label>
توکن ربات
</label>

<input
  name="token"
  placeholder="123456:ABC..."
  required
>

</div>

<button
  class="btn"
  type="submit"
>
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
        req.body.name || ""
      ).trim();

    const token =
      String(
        req.body.token || ""
      ).trim();

    if (!name || !token) {

      return res.redirect(
        "/bots/add?error=" +
        encodeURIComponent(
          "نام و توکن را وارد کنید."
        )
      );
    }

    try {

      const me =
        await telegram(
          token,
          "getMe"
        );

      const exists =
        db.bots.some(
          b =>
            b.token === token &&
            b.ownerId ===
            req.session.userId
        );

      if (exists) {

        return res.redirect(
          "/bots/add?error=" +
          encodeURIComponent(
            "این ربات قبلاً اضافه شده است."
          )
        );
      }

      const bot = {

        id: makeId(),

        ownerId:
          req.session.userId,

        name,

        token,

        username:
          me.username || "",

        telegramId:
          me.id,

        createdAt:
          Date.now(),

        forceJoins: []
      };

      db.bots.push(bot);

      db.botUsers[
        bot.id
      ] = {};

      db.commands[
        bot.id
      ] = {};

      db.forceJoinVerified[
        bot.id
      ] = {};

      saveDB();

      addActivity(
        "bot_add",
        "ربات جدید اضافه شد",
        `@${me.username || name}`,
        {
          botId: bot.id
        }
      );

      startBotPolling(bot);

      res.redirect("/bots");

    } catch (err) {

      res.redirect(
        "/bots/add?error=" +
        encodeURIComponent(
          "توکن نامعتبر است: " +
          err.message
        )
      );
    }
  }
);

app.get(
  "/bots/delete",
  requireLogin,
  (req, res) => {

    const id =
      String(
        req.query.id || ""
      );

    const index =
      db.bots.findIndex(
        bot =>
          bot.id === id &&
          bot.ownerId ===
          req.session.userId
      );

    if (index === -1) {
      return res.redirect(
        "/bots"
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

    delete db.forceJoinVerified[
      bot.id
    ];

    saveDB();

    addActivity(
      "bot_delete",
      "ربات حذف شد",
      bot.name
    );

    res.redirect(
      "/bots"
    );
  }
);

app.get(
  "/bots/:id",
  requireLogin,
  (req, res) => {

    const bot =
      getBotForUser(
        req,
        req.params.id
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    ensureForceJoinState(
      bot
    );

    const commands =
      Object.keys(
        db.commands[
          bot.id
        ] || {}
      ).length;

    const users =
      Object.keys(
        db.botUsers[
          bot.id
        ] || {}
      ).length;

    const force =
      bot.forceJoins.length;

    res.send(
      page(
        bot.name,
        `
<h1>
🤖 ${esc(bot.name)}
</h1>

<div class="grid">

<div class="stat">
👥 کاربران
<div class="stat-number">
${users}
</div>
</div>

<div class="stat">
⚡ دستورات
<div class="stat-number">
${commands}
</div>
</div>

<div class="stat">
🔐 عضویت اجباری
<div class="stat-number">
${force}
</div>
</div>

</div>

<div class="card">

<h2>
مدیریت ربات
</h2>

<div class="form-actions">

<a
  class="btn"
  href="/forcejoin?bot=${encodeURIComponent(
    bot.id
  )}"
>
🔐 عضویت اجباری
</a>

<a
  class="btn"
  href="/commands?bot=${encodeURIComponent(
    bot.id
  )}"
>
⚡ دستورات
</a>

<a
  class="btn"
  href="/broadcast?bot=${encodeURIComponent(
    bot.id
  )}"
>
📢 ارسال پیام
</a>

<a
  class="btn"
  href="/users?bot=${encodeURIComponent(
    bot.id
  )}"
>
👥 کاربران
</a>

</div>

</div>
`
      )
    );
  }
);

/* =====================================================
   BOT PICKER
===================================================== */

function botPickerPage(
  req,
  title,
  pathName
) {

  const bots =
    getUserBots(req);

  return page(
    title,
    `
<h1>
${esc(title)}
</h1>

<div class="card">

${
  bots.length
    ? bots
        .map(
          bot => `
<div class="list-item">

<div class="item-row">

<div>

<strong>
🤖 ${esc(bot.name)}
</strong>

<div class="muted">
@${esc(bot.username)}
</div>

</div>

<a
  class="btn"
  href="${pathName}?bot=${encodeURIComponent(
    bot.id
  )}"
>
انتخاب
</a>

</div>

</div>
`
        )
        .join("")
    : `
<div class="empty">
ابتدا یک ربات اضافه کنید.
</div>
`
}

</div>
`
  );
}

/* =====================================================
   FORCE JOIN CORE
===================================================== */

function ensureForceJoinState(bot) {

  if (!Array.isArray(
    bot.forceJoins
  )) {
    bot.forceJoins = [];
  }

  if (!db.forceJoinVerified[
    bot.id
  ]) {
    db.forceJoinVerified[
      bot.id
    ] = {};
  }

  let changed = false;

  for (
    const join of bot.forceJoins
  ) {

    if (!join.id) {
      join.id = makeId();
      changed = true;
    }

    if (
      join.chatId === undefined
    ) {
      join.chatId = null;
      changed = true;
    }

  }

  if (changed) {
    saveDB();
  }
}

/*
 * وضعیت تأیید هر کاربر
 */
function getVerified(
  bot,
  userId
) {

  ensureForceJoinState(
    bot
  );

  const key =
    String(userId);

  if (
    !db.forceJoinVerified[
      bot.id
    ][key]
  ) {

    db.forceJoinVerified[
      bot.id
    ][key] = {};

    saveDB();
  }

  return db.forceJoinVerified[
    bot.id
  ][key];
}

/*
 * ثبت تأیید
 */
function markVerified(
  bot,
  userId,
  joinId
) {

  const verified =
    getVerified(
      bot,
      userId
    );

  verified[
    String(joinId)
  ] = true;

  saveDB();
}

/*
 * بررسی واقعی عضویت با Telegram API
 *
 * اینجا chatId عددی واقعی استفاده می‌شود.
 */
async function checkMembership(
  bot,
  join,
  userId
) {

  const chatId =
    join.chatId ||
    join.username;

  if (!chatId) {

    console.error(
      "FORCE JOIN HAS NO CHAT ID:",
      join
    );

    return false;
  }

  try {

    const member =
      await telegram(
        bot.token,
        "getChatMember",
        {
          chat_id:
            chatId,

          user_id:
            Number(userId)
        }
      );

    console.log(
      "MEMBERSHIP CHECK:",
      bot.username,
      chatId,
      userId,
      member.status,
      member.is_member
    );

    if (
      member.status ===
      "creator"
    ) {
      return true;
    }

    if (
      member.status ===
      "administrator"
    ) {
      return true;
    }

    if (
      member.status ===
      "member"
    ) {
      return true;
    }

    if (
      member.status ===
      "restricted" &&
      member.is_member === true
    ) {
      return true;
    }

    return false;

  } catch (err) {

    console.error(
      "GET CHAT MEMBER ERROR:",
      {
        bot:
          bot.username ||
          bot.name,

        chatId,

        userId,

        error:
          err.message
      }
    );

    return false;
  }
}

/*
 * بررسی همه موارد
 */
async function checkAllMemberships(
  bot,
  userId
) {

  ensureForceJoinState(
    bot
  );

  const verified =
    getVerified(
      bot,
      userId
    );

  const missing = [];

  for (
    const join of bot.forceJoins
  ) {

    /*
     * اگر قبلاً تأیید شده،
     * دوباره بررسی نمی‌شود.
     */
    if (
      verified[
        String(join.id)
      ] === true
    ) {
      continue;
    }

    const member =
      await checkMembership(
        bot,
        join,
        userId
      );

    if (member) {

      markVerified(
        bot,
        userId,
        join.id
      );

    } else {

      missing.push(
        join
      );
    }
  }

  return {
    ok:
      missing.length === 0,

    missing
  };
}

/* =====================================================
   TELEGRAM LINK
===================================================== */

function parseTelegramLink(
  value
) {

  let input =
    String(value || "")
      .trim();

  if (!input) {
    throw new Error(
      "لینک را وارد کنید."
    );
  }

  if (
    !/^https?:\/\//i.test(
      input
    )
  ) {
    input =
      "https://" +
      input;
  }

  let url;

  try {

    url =
      new URL(input);

  } catch {

    throw new Error(
      "لینک تلگرام معتبر نیست."
    );
  }

  const host =
    url.hostname.toLowerCase();

  if (
    host !== "t.me" &&
    host !== "www.t.me" &&
    host !== "telegram.me" &&
    host !== "www.telegram.me"
  ) {

    throw new Error(
      "فقط لینک عمومی t.me قابل استفاده است."
    );
  }

  const parts =
    url.pathname
      .split("/")
      .filter(Boolean);

  if (!parts.length) {

    throw new Error(
      "آیدی کانال یا گروه پیدا نشد."
    );
  }

  const username =
    parts[0];

  if (
    username.startsWith("+") ||
    username.startsWith(
      "joinchat"
    )
  ) {

    throw new Error(
      "لینک دعوت خصوصی پشتیبانی نمی‌شود. لینک عمومی t.me استفاده کنید."
    );
  }

  if (
    !/^[A-Za-z0-9_]{5,}$/.test(
      username
    )
  ) {

    throw new Error(
      "آیدی عمومی معتبر نیست."
    );
  }

  return {

    username:
      "@" + username,

    link:
      "https://t.me/" +
      username
  };
}

/*
 * بررسی ادمین بودن ربات
 */
async function checkBotAdmin(
  bot,
  chatId
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
          chatId,

        user_id:
          me.id
      }
    );

  console.log(
    "BOT ADMIN CHECK:",
    bot.username,
    chatId,
    member.status
  );

  if (
    member.status !==
    "administrator" &&
    member.status !==
    "creator"
  ) {

    throw new Error(
      "ربات در این کانال یا گروه ادمین نیست. ابتدا ربات را ادمین کنید."
    );
  }
}

/* =====================================================
   FORCE JOIN PAGE
===================================================== */

app.get(
  "/forcejoin",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    if (!botId) {

      return res.send(
        botPickerPage(
          req,
          "🔐 عضویت اجباری",
          "/forcejoin"
        )
      );
    }

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    ensureForceJoinState(
      bot
    );

    res.send(
      page(
        "عضویت اجباری",
        `
<h1>
🔐 عضویت اجباری
</h1>

<div class="card">

<h2>
🤖 ${esc(bot.name)}
</h2>

<p>
عضویت اجباری فقط روی دستور
<b>/start</b>
اجرا می‌شود.
</p>

<p class="muted">
کاربر ابتدا باید عضو موارد تعیین‌شده شود و سپس روی «بررسی عضویت» بزند.
</p>

<a
  class="btn"
  href="/forcejoin/add?bot=${encodeURIComponent(
    bot.id
  )}"
>
➕ افزودن کانال یا گروه
</a>

</div>

<div class="card">

<h2>
📢 کانال‌ها و گروه‌ها
</h2>

${
  bot.forceJoins.length
    ? bot.forceJoins
        .map(
          join => `
<div class="list-item">

<div class="item-row">

<div>

<strong>
📢 ${esc(join.title)}
</strong>

<div class="muted">
${esc(join.username)}
</div>

<div class="muted">
شناسه:
${esc(join.chatId || "نسخه قدیمی")}
</div>

</div>

<a
  class="btn btn-danger"
  href="/forcejoin/delete?bot=${encodeURIComponent(
    bot.id
  )}&join=${encodeURIComponent(
    join.id
  )}"
  onclick="
    return confirm(
      'این مورد حذف شود؟'
    )
  "
>
حذف
</a>

</div>

</div>
`
        )
        .join("")
    : `
<div class="empty">
هنوز عضویت اجباری اضافه نشده است.
</div>
`
}

</div>

<div class="card">

<h2>
⚠️ نکته مهم
</h2>

<p>
ربات باید در هر کانال یا گروه اجباری <b>ادمین</b> باشد.
</p>

<p>
برای عملکرد صحیح، لینک باید عمومی باشد؛ مثل:
</p>

<code>
https://t.me/example
</code>

</div>
`
      )
    );
  }
);

/* =====================================================
   ADD FORCE JOIN
===================================================== */

app.get(
  "/forcejoin/add",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    res.send(
      page(
        "افزودن عضویت اجباری",
        `
<h1>
➕ افزودن عضویت اجباری
</h1>

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<div class="card">

<p>
ربات باید در کانال یا گروه
<b>ادمین</b>
باشد.
</p>

<p class="muted">
مثال:
</p>

<p>
<b>
https://t.me/example
</b>
</p>

<form
  method="POST"
  action="/forcejoin/add"
>

<input
  type="hidden"
  name="botId"
  value="${esc(bot.id)}"
>

<div class="form-group">

<label>
لینک کانال یا گروه
</label>

<input
  name="link"
  placeholder="https://t.me/example"
  required
>

</div>

<button
  class="btn"
  type="submit"
>
➕ بررسی و افزودن
</button>

</form>

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
      String(
        req.body.botId || ""
      );

    const link =
      String(
        req.body.link || ""
      ).trim();

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    ensureForceJoinState(
      bot
    );

    if (
      bot.forceJoins.length >= 5
    ) {

      return res.redirect(
        `/forcejoin/add?bot=${encodeURIComponent(
          bot.id
        )}&error=` +
        encodeURIComponent(
          "حداکثر ۵ مورد قابل اضافه کردن است."
        )
      );
    }

    try {

      const parsed =
        parseTelegramLink(
          link
        );

      if (
        bot.forceJoins.some(
          j =>
            String(
              j.username || ""
            ).toLowerCase() ===
            parsed.username.toLowerCase()
        )
      ) {

        throw new Error(
          "این کانال یا گروه قبلاً اضافه شده است."
        );
      }

      /*
       * اول کانال را از تلگرام می‌گیریم.
       */
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
        chat.type !==
        "channel" &&
        chat.type !==
        "supergroup" &&
        chat.type !==
        "group"
      ) {

        throw new Error(
          "این مورد کانال یا گروه نیست."
        );
      }

      /*
       * بسیار مهم:
       * شناسه عددی واقعی Chat ذخیره می‌شود.
       */
      const realChatId =
        chat.id;

      /*
       * بررسی ادمین بودن ربات
       */
      await checkBotAdmin(
        bot,
        realChatId
      );

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

        /*
         * کلید اصلی برای بررسی عضویت
         */
        chatId:
          realChatId,

        addedAt:
          Date.now()
      };

      bot.forceJoins.push(
        join
      );

      saveDB();

      addActivity(
        "force_add",
        "عضویت اجباری اضافه شد",
        join.title,
        {
          botId:
            bot.id
        }
      );

      res.redirect(
        `/forcejoin?bot=${encodeURIComponent(
          bot.id
        )}`
      );

    } catch (err) {

      console.error(
        "FORCE JOIN ADD ERROR:",
        err.message
      );

      res.redirect(
        `/forcejoin/add?bot=${encodeURIComponent(
          bot.id
        )}&error=` +
        encodeURIComponent(
          err.message
        )
      );
    }
  }
);

/* =====================================================
   DELETE FORCE JOIN
===================================================== */

app.get(
  "/forcejoin/delete",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    const joinId =
      String(
        req.query.join || ""
      );

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {
      return res.redirect(
        "/forcejoin"
      );
    }

    const index =
      bot.forceJoins.findIndex(
        j =>
          String(j.id) ===
          joinId
      );

    if (index === -1) {

      return res.redirect(
        `/forcejoin?bot=${encodeURIComponent(
          bot.id
        )}`
      );
    }

    const join =
      bot.forceJoins[index];

    bot.forceJoins.splice(
      index,
      1
    );

    for (
      const userId of Object.keys(
        db.forceJoinVerified[
          bot.id
        ] || {}
      )
    ) {

      if (
        db.forceJoinVerified[
          bot.id
        ][userId]
      ) {

        delete db
          .forceJoinVerified[
            bot.id
          ][userId][joinId];
      }
    }

    saveDB();

    addActivity(
      "force_delete",
      "عضویت اجباری حذف شد",
      join.title,
      {
        botId:
          bot.id
      }
    );

    res.redirect(
      `/forcejoin?bot=${encodeURIComponent(
        bot.id
      )}`
    );
  }
);

/* =====================================================
   FORCE JOIN MESSAGE
===================================================== */

async function sendJoinMessage(
  bot,
  chatId,
  missing
) {

  if (
    !missing ||
    !missing.length
  ) {
    return;
  }

  const keyboard = [];

  for (
    const join of missing
  ) {

    keyboard.push([
      {
        text:
          `📢 عضویت در ${join.title}`,

        url:
          join.link
      }
    ]);
  }

  keyboard.push([
    {
      text:
        "✅ بررسی عضویت",

      callback_data:
        "check_join_start"
    }
  ]);

  return telegram(
    bot.token,
    "sendMessage",
    {
      chat_id:
        chatId,

      text:
        "🔐 برای استفاده از ربات ابتدا باید عضو موارد زیر شوید.\n\n" +
        "1️⃣ روی دکمه‌های عضویت بزنید.\n" +
        "2️⃣ عضو کانال یا گروه شوید.\n" +
        "3️⃣ سپس روی «✅ بررسی عضویت» بزنید.",

      reply_markup: {
        inline_keyboard:
          keyboard
      }
    }
  );
}

/* =====================================================
   COMMAND SYSTEM
===================================================== */

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
      .split(/\s+/)[0];

  let command =
    first
      .substring(1)
      .split("@")[0]
      .trim();

  if (!command) {
    return null;
  }

  command =
    command.replace(
      /[^a-zA-Z0-9_]/g,
      ""
    );

  return command || null;
}

async function executeCommand(
  bot,
  chatId,
  text
) {

  const command =
    getCommandNameFromText(
      text
    );

  if (!command) {
    return false;
  }

  const commands =
    db.commands[
      bot.id
    ] || {};

  const item =
    commands[command];

  if (!item) {

    console.log(
      "COMMAND NOT FOUND:",
      bot.username,
      command
    );

    return false;
  }

  await telegram(
    bot.token,
    "sendMessage",
    {
      chat_id:
        chatId,

      text:
        item.response
    }
  );

  return true;
}

/* =====================================================
   COMMANDS PAGE
===================================================== */

app.get(
  "/commands",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    if (!botId) {

      return res.send(
        botPickerPage(
          req,
          "⚡ دستورات",
          "/commands"
        )
      );
    }

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    const commands =
      db.commands[
        bot.id
      ] || {};

    res.send(
      page(
        "دستورات",
        `
<div class="item-row">

<h1>
⚡ دستورات
</h1>

<a
  class="btn"
  href="/commands/add?bot=${encodeURIComponent(
    bot.id
  )}"
>
➕ افزودن دستور
</a>

</div>

<div class="card">

${
  Object.keys(commands)
    .length
    ? Object.entries(
        commands
      )
        .map(
          ([command, item]) => `
<div class="list-item">

<div class="item-row">

<div>

<strong>
/${esc(command)}
</strong>

<div class="muted">
${esc(item.response)}
</div>

</div>

<a
  class="btn btn-danger"
  href="/commands/delete?bot=${encodeURIComponent(
    bot.id
  )}&command=${encodeURIComponent(
    command
  )}"
>
حذف
</a>

</div>

</div>
`
        )
        .join("")
    : `
<div class="empty">
هنوز دستوری وجود ندارد.
</div>
`
}

</div>
`
      )
    );
  }
);

/* =====================================================
   ADD COMMAND
===================================================== */

app.get(
  "/commands/add",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    if (!botId) {

      return res.send(
        botPickerPage(
          req,
          "➕ افزودن دستور",
          "/commands/add"
        )
      );
    }

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    res.send(
      page(
        "افزودن دستور",
        `
<h1>
➕ افزودن دستور
</h1>

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<div class="card">

<form
  method="POST"
  action="/commands/add"
>

<input
  type="hidden"
  name="botId"
  value="${esc(bot.id)}"
>

<div class="form-group">

<label>
نام دستور
</label>

<input
  name="command"
  placeholder="start"
  required
>

</div>

<div class="form-group">

<label>
پاسخ
</label>

<textarea
  name="response"
  required
></textarea>

</div>

<button
  class="btn"
  type="submit"
>
💾 ذخیره
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
      String(
        req.body.botId || ""
      );

    let command =
      String(
        req.body.command || ""
      ).trim();

    const response =
      String(
        req.body.response || ""
      );

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    command =
      command
        .replace(
          /^\//,
          ""
        )
        .split("@")[0]
        .replace(
          /[^a-zA-Z0-9_]/g,
          ""
        );

    if (
      !command ||
      !response
    ) {

      return res.redirect(
        `/commands/add?bot=${encodeURIComponent(
          bot.id
        )}&error=` +
        encodeURIComponent(
          "نام و پاسخ را وارد کنید."
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
      "command_add",
      "دستور اضافه شد",
      "/" + command,
      {
        botId:
          bot.id
      }
    );

    res.redirect(
      `/commands?bot=${encodeURIComponent(
        bot.id
      )}`
    );
  }
);

/* =====================================================
   DELETE COMMAND
===================================================== */

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
        req.query.command || ""
      );

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res.redirect(
        "/commands"
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

      saveDB();
    }

    addActivity(
      "command_delete",
      "دستور حذف شد",
      "/" + command,
      {
        botId:
          bot.id
      }
    );

    res.redirect(
      `/commands?bot=${encodeURIComponent(
        bot.id
      )}`
    );
  }
);

/* =====================================================
   USERS
===================================================== */

app.get(
  "/users",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    if (!botId) {

      return res.send(
        botPickerPage(
          req,
          "👥 آمار کاربران",
          "/users"
        )
      );
    }

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    const users =
      Object.values(
        db.botUsers[
          bot.id
        ] || {}
      );

    res.send(
      page(
        "آمار کاربران",
        `
<h1>
👥 کاربران
</h1>

<div class="card">

<h2>
${users.length}
کاربر
</h2>

${
  users.length
    ? `
<div style="overflow:auto">

<table>

<tr>
<th>نام</th>
<th>آیدی</th>
<th>یوزرنیم</th>
</tr>

${users
  .map(
    user => `
<tr>

<td>
${esc(
  `${user.first_name || ""} ${
    user.last_name || ""
  }`
)}
</td>

<td>
${esc(user.id)}
</td>

<td>
${
  user.username
    ? "@" +
      esc(
        user.username
      )
    : "-"
}
</td>

</tr>
`
  )
  .join("")}

</table>

</div>
`
    : `
<div class="empty">
هنوز کاربری ثبت نشده است.
</div>
`
}

</div>
`
      )
    );
  }
);

/* =====================================================
   BROADCAST
===================================================== */

app.get(
  "/broadcast",
  requireLogin,
  (req, res) => {

    const botId =
      String(
        req.query.bot || ""
      );

    if (!botId) {

      return res.send(
        botPickerPage(
          req,
          "📢 ارسال پیام به همه کاربران",
          "/broadcast"
        )
      );
    }

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
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
        "ارسال پیام",
        `
<h1>
📢 ارسال پیام به همه کاربران
</h1>

<div class="card">

<p>
ربات:
<b>
${esc(bot.name)}
</b>
</p>

<p>
تعداد کاربران:
<b>
${count}
</b>
</p>

${
  req.query.result
    ? `
<div class="alert alert-success">
${esc(req.query.result)}
</div>
`
    : ""
}

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<form
  method="POST"
  action="/broadcast"
>

<input
  type="hidden"
  name="botId"
  value="${esc(bot.id)}"
>

<div class="form-group">

<label>
نوع پیام
</label>

<select
  name="type"
  id="type"
  onchange="changeType()"
>

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

</div>

<div class="form-group">

<label>
متن / کپشن
</label>

<textarea
  name="text"
></textarea>

</div>

<div
  id="media"
  class="form-group"
  style="display:none"
>

<label>
لینک فایل یا Telegram file_id
</label>

<input
  name="media"
>

</div>

<button
  class="btn"
  type="submit"
>
📢 ارسال به همه
</button>

</form>

</div>

<script>

function changeType() {

  const type =
    document.getElementById(
      "type"
    ).value;

  document.getElementById(
    "media"
  ).style.display =
    type === "text"
      ? "none"
      : "block";
}

</script>
`
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
        req.body.botId || ""
      );

    const type =
      String(
        req.body.type || "text"
      );

    const text =
      String(
        req.body.text || ""
      );

    const media =
      String(
        req.body.media || ""
      ).trim();

    const bot =
      getBotForUser(
        req,
        botId
      );

    if (!bot) {

      return res
        .status(404)
        .send(
          "ربات پیدا نشد."
        );
    }

    if (
      type !== "text" &&
      !media
    ) {

      return res.redirect(
        `/broadcast?bot=${encodeURIComponent(
          bot.id
        )}&error=` +
        encodeURIComponent(
          "فایل را وارد کنید."
        )
      );
    }

    if (
      type === "text" &&
      !text
    ) {

      return res.redirect(
        `/broadcast?bot=${encodeURIComponent(
          bot.id
        )}&error=` +
        encodeURIComponent(
          "متن را وارد کنید."
        )
      );
    }

    const users =
      Object.values(
        db.botUsers[
          bot.id
        ] || {}
      );

    let sent = 0;
    let failed = 0;

    for (
      const user of users
    ) {

      try {

        if (
          type === "text"
        ) {

          await telegram(
            bot.token,
            "sendMessage",
            {
              chat_id:
                user.id,

              text
            }
          );

        } else if (
          type === "photo"
        ) {

          await telegram(
            bot.token,
            "sendPhoto",
            {
              chat_id:
                user.id,

              photo:
                media,

              caption:
                text
            }
          );

        } else {

          await telegram(
            bot.token,
            "sendVideo",
            {
              chat_id:
                user.id,

              video:
                media,

              caption:
                text
            }
          );
        }

        sent++;

      } catch {

        failed++;

      }

      await sleep(80);
    }

    addActivity(
      "broadcast",
      "ارسال همگانی",
      `موفق: ${sent} | ناموفق: ${failed}`,
      {
        botId:
          bot.id
      }
    );

    res.redirect(
      `/broadcast?bot=${encodeURIComponent(
        bot.id
      )}&result=` +
      encodeURIComponent(
        `ارسال تمام شد | موفق: ${sent} | ناموفق: ${failed}`
      )
    );
  }
);

/* =====================================================
   SAVE TELEGRAM USER
===================================================== */

function saveBotUser(
  bot,
  telegramUser
) {

  if (!telegramUser?.id)
    return;

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
}

/* =====================================================
   START + FORCE JOIN
===================================================== */

async function handleStart(
  bot,
  message
) {

  const userId =
    message.from.id;

  const chatId =
    message.chat.id;

  console.log(
    "START RECEIVED:",
    bot.username,
    userId
  );

  ensureForceJoinState(
    bot
  );

  /*
   * هیچ شرط عضویتی وجود ندارد
   */
  if (
    bot.forceJoins.length === 0
  ) {

    console.log(
      "NO FORCE JOIN:",
      bot.username
    );

    await executeCommand(
      bot,
      chatId,
      "/start"
    );

    return;
  }

  /*
   * بررسی عضویت
   */
  const result =
    await checkAllMemberships(
      bot,
      userId
    );

  console.log(
    "FORCE JOIN RESULT:",
    bot.username,
    {
      ok:
        result.ok,

      missing:
        result.missing.map(
          x =>
            x.username
        )
    }
  );

  /*
   * هنوز عضو نشده
   */
  if (!result.ok) {

    try {

      await sendJoinMessage(
        bot,
        chatId,
        result.missing
      );

    } catch (err) {

      console.error(
        "SEND FORCE JOIN ERROR:",
        err.message
      );

      /*
       * خطای واضح برای کاربر
       */
      try {

        await telegram(
          bot.token,
          "sendMessage",
          {
            chat_id:
              chatId,

            text:
              "⚠️ خطا در بررسی عضویت اجباری.\n\n" +
              "لطفاً چند لحظه بعد دوباره /start را بزنید."
          }
        );

      } catch {}
    }

    return;
  }

  /*
   * همه تأیید شده‌اند
   */
  await executeCommand(
    bot,
    chatId,
    "/start"
  );
}

/* =====================================================
   CALLBACK
===================================================== */

async function handleCallback(
  bot,
  query
) {

  if (
    query.data !==
    "check_join_start"
  ) {
    return;
  }

  const userId =
    query.from?.id;

  const chatId =
    query.message?.chat?.id;

  if (
    !userId ||
    !chatId
  ) {
    return;
  }

  try {

    const result =
      await checkAllMemberships(
        bot,
        userId
      );

    /*
     * هنوز ناقص
     */
    if (!result.ok) {

      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id:
            query.id,

          text:
            "❌ هنوز عضویت کامل نشده است.",

          show_alert:
            true
        }
      );

      /*
       * دکمه‌ها را فقط با موارد
       * باقی‌مانده به‌روزرسانی می‌کنیم.
       */
      if (
        query.message?.message_id
      ) {

        try {

          const keyboard =
            [];

          for (
            const join of
            result.missing
          ) {

            keyboard.push([
              {
                text:
                  `📢 عضویت در ${join.title}`,

                url:
                  join.link
              }
            ]);
          }

          keyboard.push([
            {
              text:
                "✅ بررسی عضویت",

              callback_data:
                "check_join_start"
            }
          ]);

          await telegram(
            bot.token,
            "editMessageReplyMarkup",
            {
              chat_id:
                chatId,

              message_id:
                query.message
                  .message_id,

              reply_markup: {
                inline_keyboard:
                  keyboard
              }
            }
          );

        } catch {}
      }

      return;
    }

    /*
     * تأیید موفق
     */
    await telegram(
      bot.token,
      "answerCallbackQuery",
      {
        callback_query_id:
          query.id,

        text:
          "✅ عضویت شما تأیید شد."
      }
    );

    /*
     * حذف پیام عضویت
     */
    if (
      query.message?.message_id
    ) {

      try {

        await telegram(
          bot.token,
          "deleteMessage",
          {
            chat_id:
              chatId,

            message_id:
              query.message
                .message_id
          }
        );

      } catch (err) {

        console.error(
          "DELETE JOIN MESSAGE:",
          err.message
        );
      }
    }

    /*
     * اجرای خودکار /start
     */
    await executeCommand(
      bot,
      chatId,
      "/start"
    );

  } catch (err) {

    console.error(
      "CALLBACK ERROR:",
      err.message
    );

    try {

      await telegram(
        bot.token,
        "answerCallbackQuery",
        {
          callback_query_id:
            query.id,

          text:
            "⚠️ خطایی هنگام بررسی عضویت رخ داد.",

          show_alert:
            true
        }
      );

    } catch {}
  }
}

/* =====================================================
   UPDATE HANDLER
===================================================== */

async function handleUpdate(
  bot,
  update
) {

  /*
   * Callback
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

  if (
    !message ||
    !message.from ||
    !message.chat
  ) {
    return;
  }

  saveBotUser(
    bot,
    message.from
  );

  /*
   * فقط /start مشمول عضویت اجباری است.
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
   * سایر دستورات آزاد هستند.
   */
  if (
    message.text
  ) {

    await executeCommand(
      bot,
      message.chat.id,
      message.text
    );
  }
}

/* =====================================================
   POLLING
===================================================== */

const pollingState =
  new Map();

async function pollBot(
  bot
) {

  if (
    pollingState.get(
      bot.id
    )?.running
  ) {
    return;
  }

  await prepareBotPolling(
    bot
  );

  const state = {

    running:
      true,

    offset:
      0
  };

  pollingState.set(
    bot.id,
    state
  );

  console.log(
    "Polling started:",
    bot.username ||
    bot.name
  );

  /*
   * اگر getUpdates خطای Conflict بدهد،
   * چند ثانیه صبر می‌کنیم.
   */
  while (true) {

    const current =
      pollingState.get(
        bot.id
      );

    if (
      !current?.running
    ) {
      break;
    }

    if (
      !db.bots.some(
        b =>
          b.id ===
          bot.id
      )
    ) {
      break;
    }

    try {

      const updates =
        await telegram(
          bot.token,
          "getUpdates",
          {
            offset:
              state.offset,

            timeout:
              25,

            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      for (
        const update of
        updates
      ) {

        state.offset =
          update.update_id + 1;

        try {

          await handleUpdate(
            bot,
            update
          );

        } catch (err) {

          console.error(
            "UPDATE ERROR:",
            err.message
          );
        }
      }

    } catch (err) {

      console.error(
        "POLLING ERROR:",
        bot.username ||
        bot.name,
        err.message
      );

      /*
       * اگر Conflict باشد،
       * Webhook را دوباره حذف می‌کنیم.
       */
      if (
        String(
          err.message
        ).includes(
          "Conflict"
        )
      ) {

        await prepareBotPolling(
          bot
        );
      }

      await sleep(3000);
    }
  }

  pollingState.delete(
    bot.id
  );
}

function startBotPolling(
  bot
) {

  pollBot(bot).catch(
    err => {

      console.error(
        "BOT POLLING FATAL:",
        bot.username ||
        bot.name,
        err.message
      );

    }
  );
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
  }

  pollingState.delete(
    botId
  );
}

/* =====================================================
   CREATOR
===================================================== */

app.get(
  "/creator/login",
  (req, res) => {

    res.send(
      page(
        "ورود سازنده",
        `
<div class="auth">

<div class="card">

<h1>
👑 ورود سازنده
</h1>

${
  req.query.error
    ? `
<div class="alert alert-error">
${esc(req.query.error)}
</div>
`
    : ""
}

<form
  method="POST"
  action="/creator/login"
>

<div class="form-group">

<label>
رمز سازنده
</label>

<input
  type="password"
  name="password"
  required
>

</div>

<button
  class="btn"
  type="submit"
>
👑 ورود
</button>

</form>

</div>

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

      return res.redirect(
        "/creator/login?error=" +
        encodeURIComponent(
          "رمز اشتباه است."
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

app.get(
  "/creator",
  requireCreator,
  (req, res) => {

    res.send(
      page(
        "پنل سازنده",
        `
<h1>
👑 پنل سازنده
</h1>

<div class="grid">

<div class="stat">
👥 کاربران
<div class="stat-number">
${db.users.length}
</div>
</div>

<div class="stat">
🤖 ربات‌ها
<div class="stat-number">
${db.bots.length}
</div>
</div>

<div class="stat">
👤 کاربران تلگرام
<div class="stat-number">
${totalBotUsers()}
</div>
</div>

<div class="stat">
🎬 فعالیت‌ها
<div class="stat-number">
${db.activities.length}
</div>
</div>

</div>

<div class="card">

<h2>
🤖 ربات‌ها
</h2>

${
  db.bots.length
    ? db.bots
        .map(
          bot => `
<div class="list-item">

<div class="item-row">

<div>

<strong>
${esc(bot.name)}
</strong>

<div class="muted">
@${esc(bot.username)}
</div>

</div>

<span class="badge">
${esc(bot.ownerId)}
</span>

</div>

</div>
`
        )
        .join("")
    : `
<div class="empty">
رباتی وجود ندارد.
</div>
`
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
      "/creator/login"
    );
  }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      bots:
        db.bots.length,

      users:
        db.users.length,

      time:
        new Date().toISOString()
    });
  }
);

/* =====================================================
   404
===================================================== */

app.use(
  (req, res) => {

    res.status(404).send(
      page(
        "404",
        `
<div class="card center">

<h1>
404
</h1>

<p>
صفحه پیدا نشد.
</p>

<a
  class="btn"
  href="/dashboard"
>
بازگشت
</a>

</div>
`,
        {
          loggedIn:
            !!req.session.userId,

          creator:
            !!req.session.creator
        }
      )
    );
  }
);

/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  async () => {

    console.log(
      "Nova Proxy running on port",
      PORT
    );

    console.log(
      "Bots:",
      db.bots.length
    );

    /*
     * تمام ربات‌های ذخیره‌شده
     * دوباره آماده Polling می‌شوند.
     */
    for (
      const bot of db.bots
    ) {

      ensureForceJoinState(
        bot
      );

      startBotPolling(
        bot
      );
    }
  }
);
