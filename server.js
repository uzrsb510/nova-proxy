const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "nova-panel-secret-2026";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultDB() {
  return {
    users: [],
    bots: [],
    botUsers: {},
    commands: {}
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const db = defaultDB();
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
      return db;
    }

    const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    db.users ||= [];
    db.bots ||= [];
    db.botUsers ||= {};
    db.commands ||= {};

    return db;
  } catch (e) {
    console.error("خطا در خواندن دیتابیس:", e);
    return defaultDB();
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("خطا در ذخیره دیتابیس:", e);
  }
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function getUser(id) {
  return db.users.find(x => x.id === id);
}

function getBot(id) {
  return db.bots.find(x => x.id === id);
}

function ownedBot(req, id) {
  const bot = getBot(id);

  if (!bot) return null;

  if (req.session.isAdmin) return bot;

  if (bot.ownerId !== req.session.userId) return null;

  return bot;
}

function requireLogin(req, res, next) {
  if (req.session.userId || req.session.isAdmin) {
    return next();
  }

  res.redirect("/login");
}

function requireUser(req, res, next) {
  if (req.session.userId) return next();
  res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect("/creator/login");
}

app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

app.use(express.json({
  limit: "10mb"
}));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   TELEGRAM
========================================================= */

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
    throw new Error(data.description || "Telegram API error");
  }

  return data.result;
}

async function getBotInfo(token) {
  return telegram(token, "getMe");
}

async function sendTelegramMessage(token, chatId, text) {
  return telegram(token, "sendMessage", {
    chat_id: chatId,
    text: text
  });
}

/* =========================================================
   PUBLIC TELEGRAM LINK
========================================================= */

function parsePublicTelegramLink(input) {
  let value = String(input || "").trim();

  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }

  const match = value.match(
    /^https?:\/\/t\.me\/([A-Za-z0-9_]{5,32})\/?$/
  );

  if (!match) return null;

  return {
    username: "@" + match[1]
  };
}

/* =========================================================
   FORCE JOIN
========================================================= */

async function checkMembership(bot, chatUsername, userId) {
  try {
    const member = await telegram(
      bot.token,
      "getChatMember",
      {
        chat_id: chatUsername,
        user_id: userId
      }
    );

    const status = member.status;

    if (
      status === "creator" ||
      status === "administrator" ||
      status === "member"
    ) {
      return true;
    }

    if (
      status === "restricted" &&
      member.is_member === true
    ) {
      return true;
    }

    return false;
  } catch (e) {
    console.log(
      `Membership check failed for ${bot.username}:`,
      e.message
    );

    return false;
  }
}

async function sendJoinMessage(bot, chatId) {
  if (!bot.forceJoin) return;

  try {
    const msg = await telegram(
      bot.token,
      "sendMessage",
      {
        chat_id: chatId,
        text:
          "🔒 برای استفاده از این ربات ابتدا باید در کانال/گروه زیر عضو شوید.\n\n" +
          "بعد از عضویت روی دکمه «بررسی عضویت» بزنید.",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 عضویت در کانال",
                url:
                  "https://t.me/" +
                  bot.forceJoin.username.replace("@", "")
              }
            ],
            [
              {
                text: "✅ بررسی عضویت",
                callback_data: "check_join"
              }
            ]
          ]
        }
      }
    );

    return msg;
  } catch (e) {
    console.log("خطا در ارسال عضویت اجباری:", e.message);
  }
}

/* =========================================================
   COMMANDS
========================================================= */

function getCommands(botId) {
  if (!db.commands[botId]) {
    db.commands[botId] = [];
  }

  return db.commands[botId];
}

async function executeCommand(bot, chatId, text) {
  const commands = getCommands(bot.id);

  const commandText = String(text || "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();

  if (!commandText.startsWith("/")) {
    return false;
  }

  const commandName = commandText
    .split("@")[0]
    .replace("/", "");

  const found = commands.find(
    x => x.name.toLowerCase() === commandName
  );

  if (!found) return false;

  await sendTelegramMessage(
    bot.token,
    chatId,
    found.reply
  );

  return true;
}

/* =========================================================
   TELEGRAM USERS
========================================================= */

function saveTelegramUser(bot, message) {
  if (!message || !message.from) return;

  const userId = String(message.from.id);

  if (!db.botUsers[bot.id]) {
    db.botUsers[bot.id] = [];
  }

  const list = db.botUsers[bot.id];

  let user = list.find(
    x => String(x.id) === userId
  );

  if (!user) {
    user = {
      id: message.from.id,
      firstName: message.from.first_name || "",
      lastName: message.from.last_name || "",
      username: message.from.username || "",
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    list.push(user);
  } else {
    user.firstName = message.from.first_name || "";
    user.lastName = message.from.last_name || "";
    user.username = message.from.username || "";
    user.lastSeen = new Date().toISOString();
  }

  saveDB();
}

/* =========================================================
   TELEGRAM POLLING
========================================================= */

async function handleUpdate(bot, update) {
  if (update.callback_query) {
    await handleCallback(bot, update.callback_query);
    return;
  }

  if (!update.message) return;

  const message = update.message;
  const chatId = message.chat.id;

  saveTelegramUser(bot, message);

  if (bot.forceJoin && message.from) {
    const member = await checkMembership(
      bot,
      bot.forceJoin.username,
      message.from.id
    );

    if (!member) {
      await sendJoinMessage(bot, chatId);
      return;
    }
  }

  const text = message.text || "";

  if (text === "/start") {
    await sendTelegramMessage(
      bot.token,
      chatId,
      bot.defaultReply ||
        `سلام 👋\n\nبه ربات ${bot.name || bot.username} خوش آمدید.`
    );
    return;
  }

  const commandHandled = await executeCommand(
    bot,
    chatId,
    text
  );

  if (commandHandled) return;

  if (bot.defaultReply && text) {
    await sendTelegramMessage(
      bot.token,
      chatId,
      bot.defaultReply
    );
  }
}

async function handleCallback(bot, query) {
  if (query.data !== "check_join") return;

  const userId = query.from.id;
  const chatId = query.message.chat.id;

  if (!bot.forceJoin) {
    return;
  }

  const member = await checkMembership(
    bot,
    bot.forceJoin.username,
    userId
  );

  if (!member) {
    await telegram(
      bot.token,
      "answerCallbackQuery",
      {
        callback_query_id: query.id,
        text: "❌ هنوز عضو نشده‌اید.",
        show_alert: true
      }
    );

    return;
  }

  await telegram(
    bot.token,
    "answerCallbackQuery",
    {
      callback_query_id: query.id,
      text: "✅ عضویت شما تأیید شد."
    }
  );

  try {
    await telegram(
      bot.token,
      "deleteMessage",
      {
        chat_id: chatId,
        message_id: query.message.message_id
      }
    );
  } catch {}

  await sendTelegramMessage(
    bot.token,
    chatId,
    bot.defaultReply ||
      `سلام 👋\n\nبه ربات ${bot.name || bot.username} خوش آمدید.`
  );
}

async function startBotPolling(bot) {
  console.log(
    `Polling started: @${bot.username || bot.name}`
  );

  let offset = bot.offset || 0;

  while (true) {
    try {
      const updates = await telegram(
        bot.token,
        "getUpdates",
        {
          offset,
          timeout: 25,
          allowed_updates: [
            "message",
            "callback_query"
          ]
        }
      );

      for (const update of updates) {
        offset = update.update_id + 1;

        bot.offset = offset;
        saveDB();

        try {
          await handleUpdate(bot, update);
        } catch (e) {
          console.log(
            "Update error:",
            e.message
          );
        }
      }
    } catch (e) {
      console.log(
        `Polling error @${bot.username}:`,
        e.message
      );

      await new Promise(
        resolve => setTimeout(resolve, 5000)
      );
    }
  }
}

/* =========================================================
   HTML
========================================================= */

function page(title, content, req, options = {}) {
  const loggedIn =
    !!req.session.userId ||
    !!req.session.isAdmin;

  const username =
    req.session.isAdmin
      ? "سازنده"
      : getUser(req.session.userId)?.username || "کاربر";

  const hideMenu = options.hideMenu === true;

  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<title>${esc(title)}</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  font-family:
    Tahoma,
    Arial,
    sans-serif;

  color:#172033;

  min-height:100vh;

  background:
    linear-gradient(
      135deg,
      rgba(37,99,235,.92),
      rgba(124,58,237,.90)
    ),
    url("https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=2000&q=80");

  background-size:cover;
  background-position:center;
  background-attachment:fixed;
}

button,
input,
textarea{
  font-family:inherit;
}

a{
  text-decoration:none;
}

.layout{
  min-height:100vh;
  display:flex;
}

/* SIDEBAR */

.sidebar{
  width:280px;
  background:
    rgba(9,18,45,.95);

  color:#fff;

  position:fixed;
  right:0;
  top:0;
  bottom:0;

  padding:22px 16px;

  z-index:1000;

  overflow-y:auto;

  box-shadow:
    -10px 0 40px rgba(0,0,0,.25);

  transition:.25s;
}

.logo{
  padding:10px 8px 24px;
  border-bottom:1px solid rgba(255,255,255,.1);
  margin-bottom:18px;
}

.logo h2{
  margin:0;
  font-size:20px;
}

.logo p{
  color:#94a3b8;
  font-size:12px;
  margin:8px 0 0;
}

.menu-title{
  color:#64748b;
  font-size:11px;
  margin:18px 8px 8px;
}

.menu a{
  display:flex;
  align-items:center;
  gap:12px;

  color:#dbeafe;

  padding:13px 14px;

  border-radius:13px;

  margin:5px 0;

  transition:.2s;
}

.menu a:hover{
  background:
    linear-gradient(
      90deg,
      rgba(37,99,235,.9),
      rgba(124,58,237,.8)
    );

  color:#fff;

  transform:translateX(-3px);
}

.menu a.active{
  background:
    linear-gradient(
      90deg,
      #2563eb,
      #7c3aed
    );

  color:#fff;
}

.menu .logout{
  color:#fca5a5;
}

.main{
  flex:1;
  margin-right:280px;
  min-width:0;
}

.topbar{
  height:76px;

  background:rgba(255,255,255,.94);

  backdrop-filter:blur(20px);

  display:flex;
  align-items:center;
  justify-content:space-between;

  padding:0 28px;

  box-shadow:
    0 4px 25px rgba(0,0,0,.08);

  position:sticky;
  top:0;
  z-index:500;
}

.top-title{
  font-size:19px;
  font-weight:bold;
}

.profile{
  display:flex;
  align-items:center;
  gap:10px;
}

.avatar{
  width:40px;
  height:40px;

  display:flex;
  align-items:center;
  justify-content:center;

  border-radius:50%;

  background:
    linear-gradient(135deg,#2563eb,#7c3aed);

  color:white;
  font-weight:bold;
}

.hamburger{
  display:none;

  border:0;

  width:43px;
  height:43px;

  border-radius:12px;

  background:#eff6ff;

  font-size:22px;

  cursor:pointer;
}

.container{
  max-width:1250px;
  margin:auto;
  padding:30px 22px 50px;
}

/* CARDS */

.card{
  background:
    rgba(255,255,255,.96);

  border-radius:22px;

  padding:24px;

  margin-bottom:20px;

  box-shadow:
    0 15px 45px rgba(15,23,42,.16);
}

.card h2,
.card h3{
  margin-top:0;
}

.stats{
  display:grid;

  grid-template-columns:
    repeat(2,minmax(0,1fr));

  gap:18px;

  margin-bottom:22px;
}

.stat{
  background:
    linear-gradient(
      135deg,
      #eff6ff,
      #f5f3ff
    );

  border:1px solid #e0e7ff;

  border-radius:20px;

  padding:24px;
}

.stat .icon{
  font-size:30px;
}

.stat .number{
  font-size:32px;
  font-weight:bold;
  margin-top:10px;
}

.stat .label{
  color:#64748b;
  margin-top:5px;
}

/* BUTTONS */

.btn{
  display:inline-flex;

  align-items:center;
  justify-content:center;

  gap:8px;

  min-height:45px;

  padding:10px 18px;

  border:0;

  border-radius:12px;

  cursor:pointer;

  font-size:14px;

  font-weight:bold;

  transition:.2s;

  white-space:nowrap;
}

.btn:hover{
  transform:translateY(-2px);
  filter:brightness(1.04);
}

.btn-primary{
  background:#2563eb;
  color:#fff;
}

.btn-purple{
  background:#7c3aed;
  color:#fff;
}

.btn-success{
  background:#059669;
  color:#fff;
}

.btn-warning{
  background:#f59e0b;
  color:#fff;
}

.btn-danger{
  background:#dc2626;
  color:#fff;
}

.btn-dark{
  background:#172033;
  color:#fff;
}

.btn-light{
  background:#eaf2ff;
  color:#1d4ed8;
}

.action-grid{
  display:grid;

  grid-template-columns:
    repeat(2,minmax(0,1fr));

  gap:14px;
}

.action-card{
  display:block;

  background:#fff;

  border:1px solid #e5e7eb;

  border-radius:18px;

  padding:20px;

  color:#172033;

  transition:.2s;
}

.action-card:hover{
  transform:translateY(-3px);

  border-color:#93c5fd;

  box-shadow:
    0 10px 30px rgba(37,99,235,.12);
}

.action-icon{
  font-size:28px;
  margin-bottom:10px;
}

.action-card strong{
  display:block;
  margin-bottom:6px;
}

.action-card span{
  color:#64748b;
  font-size:13px;
}

/* FORMS */

.form-group{
  margin-bottom:17px;
}

.form-group label{
  display:block;
  margin-bottom:8px;
  font-weight:bold;
}

input,
textarea,
select{
  width:100%;

  border:1px solid #dbe3ef;

  border-radius:13px;

  padding:13px 14px;

  outline:none;

  background:#fff;

  font-size:14px;

  transition:.2s;
}

input:focus,
textarea:focus,
select:focus{
  border-color:#2563eb;

  box-shadow:
    0 0 0 4px rgba(37,99,235,.1);
}

textarea{
  min-height:140px;
  resize:vertical;
}

.form-actions{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

/* BOT CARDS */

.bot-grid{
  display:grid;

  grid-template-columns:
    repeat(2,minmax(0,1fr));

  gap:18px;
}

.bot-card{
  background:#fff;

  border-radius:20px;

  padding:20px;

  box-shadow:
    0 10px 30px rgba(15,23,42,.12);

  border:1px solid #e5e7eb;
}

.bot-head{
  display:flex;

  justify-content:space-between;

  gap:12px;

  align-items:flex-start;

  margin-bottom:18px;
}

.bot-name{
  font-size:18px;
  font-weight:bold;
}

.bot-username{
  color:#64748b;
  margin-top:5px;
  direction:ltr;
  text-align:right;
}

.badge{
  display:inline-flex;

  padding:6px 10px;

  border-radius:999px;

  font-size:11px;

  font-weight:bold;
}

.badge-green{
  background:#dcfce7;
  color:#166534;
}

.badge-red{
  background:#fee2e2;
  color:#991b1b;
}

.bot-actions{
  display:grid;

  grid-template-columns:
    repeat(2,minmax(0,1fr));

  gap:9px;
}

.bot-actions .btn{
  width:100%;
}

.token-box{
  background:#0f172a;

  color:#93c5fd;

  border-radius:12px;

  padding:12px;

  direction:ltr;

  text-align:left;

  word-break:break-all;

  font-size:11px;

  margin:12px 0;
}

/* TABLE */

.table-wrap{
  overflow-x:auto;
}

table{
  width:100%;
  border-collapse:collapse;
  min-width:650px;
}

th,
td{
  padding:13px;

  border-bottom:1px solid #e5e7eb;

  text-align:right;
}

th{
  background:#f8fafc;
}

/* ALERT */

.alert{
  padding:14px 16px;

  border-radius:13px;

  margin-bottom:18px;

  font-size:14px;
}

.alert-success{
  background:#dcfce7;
  color:#166534;
}

.alert-error{
  background:#fee2e2;
  color:#991b1b;
}

.alert-info{
  background:#dbeafe;
  color:#1e40af;
}

/* LOGIN */

.auth-page{
  min-height:100vh;

  display:flex;

  align-items:center;
  justify-content:center;

  padding:20px;
}

.auth-box{
  width:100%;
  max-width:440px;

  background:
    rgba(255,255,255,.97);

  border-radius:26px;

  padding:30px;

  box-shadow:
    0 25px 80px rgba(0,0,0,.25);
}

.auth-logo{
  text-align:center;
  margin-bottom:25px;
}

.auth-logo .big{
  font-size:50px;
}

.auth-logo h1{
  margin:8px 0;
}

.auth-logo p{
  color:#64748b;
}

/* MOBILE */

@media(max-width:900px){

  .sidebar{
    transform:translateX(100%);
  }

  .sidebar.open{
    transform:translateX(0);
  }

  .main{
    margin-right:0;
  }

  .hamburger{
    display:block;
  }

  .topbar{
    padding:0 15px;
  }

  .container{
    padding:20px 14px 40px;
  }

  .stats,
  .bot-grid,
  .action-grid{
    grid-template-columns:1fr;
  }

  .bot-actions{
    grid-template-columns:1fr;
  }
}

.overlay{
  display:none;

  position:fixed;

  inset:0;

  background:rgba(0,0,0,.45);

  z-index:900;
}

.overlay.show{
  display:block;
}

.small{
  font-size:12px;
  color:#64748b;
}

.empty{
  text-align:center;
  padding:40px 20px;
  color:#64748b;
}

</style>
</head>

<body>

${loggedIn && !hideMenu ? `

<div class="overlay" id="overlay"></div>

<aside class="sidebar" id="sidebar">

  <div class="logo">
    <h2>🤖 ربات ساز</h2>
    <p>ربات ساز کانفیگ ساز رایگان</p>
  </div>

  <div class="menu">

    <div class="menu-title">اصلی</div>

    <a href="/dashboard">
      🏠
      <span>داشبورد</span>
    </a>

    <a href="/my-bots">
      🤖
      <span>ربات‌های من</span>
    </a>

    <a href="/add-bot">
      ➕
      <span>افزودن ربات</span>
    </a>

    <div class="menu-title">مدیریت</div>

    <a href="/commands">
      📝
      <span>افزودن دستور</span>
    </a>

    <a href="/commands/manage">
      📋
      <span>مدیریت دستورها</span>
    </a>

    <a href="/users">
      👥
      <span>کاربران</span>
    </a>

    <a href="/broadcast">
      📢
      <span>ارسال پیام به همه کاربران</span>
    </a>

    <a href="/force-join">
      🔒
      <span>عضویت اجباری</span>
    </a>

    <div class="menu-title">حساب</div>

    <a href="/account">
      👤
      <span>حساب کاربری</span>
    </a>

    <a href="/logout" class="logout">
      🚪
      <span>خروج</span>
    </a>

  </div>

</aside>

` : ""}

<div class="${loggedIn && !hideMenu ? "main" : ""}">

${
  loggedIn && !hideMenu
    ? `
<header class="topbar">

  <button
    class="hamburger"
    type="button"
    onclick="toggleMenu()"
  >
    ☰
  </button>

  <div class="top-title">
    ${esc(title)}
  </div>

  <div class="profile">
    <div>
      <strong>${esc(username)}</strong>
    </div>

    <div class="avatar">
      ${req.session.isAdmin ? "👑" : "👤"}
    </div>
  </div>

</header>
`
    : ""
}

<main class="${
    loggedIn && !hideMenu
      ? "container"
      : ""
  }">

${content}

</main>

</div>

<script>

function toggleMenu(){

  const sidebar =
    document.getElementById("sidebar");

  const overlay =
    document.getElementById("overlay");

  if(!sidebar) return;

  sidebar.classList.toggle("open");

  if(overlay){
    overlay.classList.toggle("show");
  }
}

const overlay =
  document.getElementById("overlay");

if(overlay){
  overlay.addEventListener("click", toggleMenu);
}

function confirmDelete(text){

  return confirm(
    text || "آیا مطمئن هستید؟"
  );
}

</script>

</body>
</html>
`;
}

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

  if (req.session.isAdmin) {
    return res.redirect("/creator");
  }

  if (req.session.userId) {
    return res.redirect("/dashboard");
  }

  res.send(
    page(
      "ربات ساز",
      `
      <div class="auth-page">

        <div class="auth-box">

          <div class="auth-logo">
            <div class="big">🤖</div>

            <h1>ربات ساز کانفیگ ساز رایگان</h1>

            <p>
              ساخت و مدیریت ربات تلگرام
            </p>
          </div>

          <div class="action-grid">

            <a class="action-card" href="/login">
              <div class="action-icon">🔐</div>
              <strong>ورود کاربران</strong>
              <span>
                ورود به حساب و مدیریت ربات‌ها
              </span>
            </a>

            <a class="action-card" href="/register">
              <div class="action-icon">📝</div>
              <strong>ثبت نام</strong>
              <span>
                ساخت حساب کاربری جدید
              </span>
            </a>

            <a class="action-card" href="/creator/login">
              <div class="action-icon">👑</div>
              <strong>ورود سازنده</strong>
              <span>
                ورود به پنل مدیریت سازنده
              </span>
            </a>

          </div>

        </div>

      </div>
      `,
      req,
      { hideMenu: true }
    )
  );
});

/* =========================================================
   REGISTER
========================================================= */

app.get("/register", (req, res) => {

  res.send(
    page(
      "ثبت نام",
      `
      <div class="auth-page">

        <div class="auth-box">

          <div class="auth-logo">
            <div class="big">📝</div>
            <h1>ثبت نام</h1>
            <p>حساب کاربری خود را بسازید</p>
          </div>

          ${
            req.query.error
              ? `
              <div class="alert alert-error">
                ${esc(req.query.error)}
              </div>
              `
              : ""
          }

          <form method="POST" action="/register">

            <div class="form-group">
              <label>نام کاربری</label>

              <input
                name="username"
                required
                minlength="3"
                maxlength="32"
                autocomplete="username"
                placeholder="نام کاربری"
              >
            </div>

            <div class="form-group">
              <label>رمز عبور</label>

              <input
                type="password"
                name="password"
                required
                minlength="4"
                autocomplete="new-password"
                placeholder="رمز عبور"
              >
            </div>

            <button class="btn btn-primary" type="submit">
              📝 ساخت حساب
            </button>

          </form>

          <br>

          <a href="/login" class="btn btn-light">
            🔐 ورود
          </a>

        </div>

      </div>
      `,
      req,
      { hideMenu: true }
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

  if (
    username.length < 3 ||
    password.length < 4
  ) {
    return res.redirect(
      "/register?error=" +
      encodeURIComponent(
        "نام کاربری یا رمز عبور نامعتبر است."
      )
    );
  }

  if (
    db.users.some(
      x => x.username === username
    )
  ) {
    return res.redirect(
      "/register?error=" +
      encodeURIComponent(
        "این نام کاربری قبلاً ثبت شده است."
      )
    );
  }

  db.users.push({
    id: makeId(),
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  });

  saveDB();

  res.redirect("/login?success=حساب شما ساخته شد.");
});

/* =========================================================
   LOGIN
========================================================= */

app.get("/login", (req, res) => {

  res.send(
    page(
      "ورود",
      `
      <div class="auth-page">

        <div class="auth-box">

          <div class="auth-logo">
            <div class="big">🔐</div>

            <h1>ورود به حساب</h1>

            <p>
              مدیریت ربات‌های شما
            </p>
          </div>

          ${
            req.query.error
              ? `
              <div class="alert alert-error">
                ${esc(req.query.error)}
              </div>
              `
              : ""
          }

          ${
            req.query.success
              ? `
              <div class="alert alert-success">
                ${esc(req.query.success)}
              </div>
              `
              : ""
          }

          <form method="POST" action="/login">

            <div class="form-group">
              <label>نام کاربری</label>

              <input
                name="username"
                required
                autocomplete="username"
              >
            </div>

            <div class="form-group">
              <label>رمز عبور</label>

              <input
                type="password"
                name="password"
                required
                autocomplete="current-password"
              >
            </div>

            <button
              class="btn btn-primary"
              type="submit"
            >
              🚀 ورود
            </button>

          </form>

          <br>

          <a
            href="/register"
            class="btn btn-light"
          >
            📝 ثبت نام
          </a>

          <a
            href="/creator/login"
            class="btn btn-purple"
          >
            👑 ورود سازنده
          </a>

        </div>

      </div>
      `,
      req,
      { hideMenu: true }
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
    x => x.username === username
  );

  if (
    !user ||
    user.passwordHash !== hashPassword(password)
  ) {
    return res.redirect(
      "/login?error=" +
      encodeURIComponent(
        "نام کاربری یا رمز عبور اشتباه است."
      )
    );
  }

  req.session.userId = user.id;
  req.session.isAdmin = false;

  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {

  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  "/dashboard",
  requireUser,
  (req, res) => {

    const myBots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    const usersCount =
      myBots.reduce(
        (total, bot) =>
          total +
          (db.botUsers[bot.id]?.length || 0),
        0
      );

    res.send(
      page(
        "داشبورد",
        `
        <div class="stats">

          <div class="stat">
            <div class="icon">👥</div>
            <div class="number">
              ${usersCount}
            </div>
            <div class="label">
              کاربران ربات‌ها
            </div>
          </div>

          <div class="stat">
            <div class="icon">🤖</div>
            <div class="number">
              ${myBots.length}
            </div>
            <div class="label">
              ربات‌های من
            </div>
          </div>

        </div>

        <div class="card">

          <h2>
            ➕ افزودن دستور
          </h2>

          <p class="small">
            برای ساخت دستور جدید وارد بخش افزودن دستور شوید.
            دستورها در صفحه داشبورد نمایش داده نمی‌شوند.
          </p>

          <a
            href="/commands"
            class="btn btn-primary"
          >
            📝 افزودن دستور
          </a>

        </div>
        `,
        req
      )
    );
  }
);

/* =========================================================
   MY BOTS
========================================================= */

app.get(
  "/my-bots",
  requireUser,
  (req, res) => {

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    res.send(
      page(
        "ربات‌های من",
        `
        <div class="card">

          <h2>🤖 ربات‌های من</h2>

          <p class="small">
            فقط ربات‌های متعلق به حساب شما در این بخش نمایش داده می‌شوند.
          </p>

        </div>

        ${
          bots.length
            ? `
            <div class="bot-grid">

              ${bots.map(bot => {

                const userCount =
                  db.botUsers[bot.id]?.length || 0;

                return `
                <div class="bot-card">

                  <div class="bot-head">

                    <div>
                      <div class="bot-name">
                        ${esc(bot.name)}
                      </div>

                      <div class="bot-username">
                        @${esc(bot.username || "")}
                      </div>
                    </div>

                    <span class="badge ${
                      bot.forceJoin
                        ? "badge-green"
                        : "badge-red"
                    }">
                      ${
                        bot.forceJoin
                          ? "عضویت فعال"
                          : "عضویت خاموش"
                      }
                    </span>

                  </div>

                  <div class="small">
                    👥 کاربران: ${userCount}
                  </div>

                  <div class="bot-actions" style="margin-top:16px">

                    <a
                      href="/bot/${bot.id}"
                      class="btn btn-primary"
                    >
                      ⚙️ مدیریت
                    </a>

                    <a
                      href="/bot/${bot.id}/users"
                      class="btn btn-light"
                    >
                      👥 کاربران
                    </a>

                    <a
                      href="/bot/${bot.id}/broadcast"
                      class="btn btn-purple"
                    >
                      📢 ارسال پیام
                    </a>

                    <a
                      href="/bot/${bot.id}/force-join"
                      class="btn btn-warning"
                    >
                      🔒 عضویت اجباری
                    </a>

                    <form
                      method="POST"
                      action="/bot/${bot.id}/delete"
                      onsubmit="return confirmDelete('این ربات حذف شود؟')"
                    >
                      <button
                        class="btn btn-danger"
                        type="submit"
                        style="width:100%"
                      >
                        🗑️ حذف
                      </button>
                    </form>

                  </div>

                </div>
                `;

              }).join("")}

            </div>
            `
            : `
            <div class="card empty">

              <div style="font-size:45px">
                🤖
              </div>

              <h3>
                هنوز رباتی اضافه نکرده‌اید
              </h3>

              <a
                href="/add-bot"
                class="btn btn-primary"
              >
                ➕ افزودن ربات
              </a>

            </div>
            `
        }
        `,
        req
      )
    );
  }
);

/* =========================================================
   ADD BOT
========================================================= */

app.get(
  "/add-bot",
  requireUser,
  (req, res) => {

    res.send(
      page(
        "افزودن ربات",
        `
        <div class="card">

          <h2>➕ افزودن ربات تلگرام</h2>

          <p class="small">
            توکن ربات را از BotFather دریافت کنید و در کادر زیر قرار دهید.
          </p>

          ${
            req.query.error
              ? `
              <div class="alert alert-error">
                ${esc(req.query.error)}
              </div>
              `
              : ""
          }

          <form method="POST" action="/add-bot">

            <div class="form-group">

              <label>
                نام دلخواه ربات
              </label>

              <input
                name="name"
                required
                placeholder="مثلاً ربات نترا"
              >

            </div>

            <div class="form-group">

              <label>
                توکن ربات
              </label>

              <input
                name="token"
                required
                dir="ltr"
                placeholder="123456789:ABC..."
              >

            </div>

            <div class="form-actions">

              <button
                class="btn btn-primary"
                type="submit"
              >
                🤖 افزودن ربات
              </button>

              <a
                href="/my-bots"
                class="btn btn-light"
              >
                بازگشت
              </a>

            </div>

          </form>

        </div>
        `,
        req
      )
    );
  }
);

app.post(
  "/add-bot",
  requireUser,
  async (req, res) => {

    const name =
      String(req.body.name || "").trim();

    const token =
      String(req.body.token || "").trim();

    if (!name || !token) {
      return res.redirect(
        "/add-bot?error=" +
        encodeURIComponent(
          "نام و توکن الزامی است."
        )
      );
    }

    try {

      const info =
        await getBotInfo(token);

      if (
        db.bots.some(
          x => x.token === token
        )
      ) {
        return res.redirect(
          "/add-bot?error=" +
          encodeURIComponent(
            "این ربات قبلاً در سیستم ثبت شده است."
          )
        );
      }

      const bot = {
        id: makeId(),
        ownerId: req.session.userId,
        token,
        name,
        username: info.username,
        offset: 0,
        createdAt: new Date().toISOString(),
        forceJoin: null,
        defaultReply:
          `سلام 👋\n\nبه ربات ${name} خوش آمدید.`
      };

      db.bots.push(bot);
      db.botUsers[bot.id] = [];
      db.commands[bot.id] = [];

      saveDB();

      startBotPolling(bot);

      res.redirect("/my-bots");

    } catch (e) {

      res.redirect(
        "/add-bot?error=" +
        encodeURIComponent(
          "توکن ربات صحیح نیست یا تلگرام در دسترس نیست."
        )
      );
    }
  }
);

/* =========================================================
   BOT MANAGEMENT
========================================================= */

app.get(
  "/bot/:id",
  requireLogin,
  (req, res) => {

    const bot =
      ownedBot(req, req.params.id);

    if (!bot) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    const owner =
      getUser(bot.ownerId);

    const userCount =
      db.botUsers[bot.id]?.length || 0;

    res.send(
      page(
        "مدیریت ربات",
        `
        <div class="card">

          <div class="bot-head">

            <div>

              <h2>
                🤖 ${esc(bot.name)}
              </h2>

              <div class="bot-username">
                @${esc(bot.username)}
              </div>

            </div>

            <span class="badge ${
              bot.forceJoin
                ? "badge-green"
                : "badge-red"
            }">
              ${
                bot.forceJoin
                  ? "عضویت فعال"
                  : "عضویت خاموش"
              }
            </span>

          </div>

          ${
            req.session.isAdmin
              ? `
              <div class="alert alert-info">
                👑 صاحب ربات:
                ${esc(owner?.username || "نامشخص")}
              </div>

              <div class="token-box">
                ${esc(bot.token)}
              </div>
              `
              : ""
          }

          <div class="stats">

            <div class="stat">
              <div class="icon">👥</div>
              <div class="number">${userCount}</div>
              <div class="label">
                کاربران
              </div>
            </div>

            <div class="stat">
              <div class="icon">📝</div>
              <div class="number">
                ${getCommands(bot.id).length}
              </div>
              <div class="label">
                دستورها
              </div>
            </div>

          </div>

          <div class="action-grid">

            <a
              href="/bot/${bot.id}/users"
              class="action-card"
            >
              <div class="action-icon">👥</div>
              <strong>کاربران ربات</strong>
              <span>
                مشاهده کاربران ربات
              </span>
            </a>

            <a
              href="/bot/${bot.id}/broadcast"
              class="action-card"
            >
              <div class="action-icon">📢</div>
              <strong>ارسال پیام</strong>
              <span>
                ارسال پیام به کاربران همین ربات
              </span>
            </a>

            <a
              href="/bot/${bot.id}/force-join"
              class="action-card"
            >
              <div class="action-icon">🔒</div>
              <strong>عضویت اجباری</strong>
              <span>
                تنظیم کانال یا گروه
              </span>
            </a>

            <a
              href="/commands?bot=${bot.id}"
              class="action-card"
            >
              <div class="action-icon">📝</div>
              <strong>افزودن دستور</strong>
              <span>
                ساخت دستور برای این ربات
              </span>
            </a>

          </div>

        </div>
        `,
        req
      )
    );
  }
);

/* =========================================================
   COMMANDS - ADD
========================================================= */

app.get(
  "/commands",
  requireUser,
  (req, res) => {

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    res.send(
      page(
        "افزودن دستور",
        `
        <div class="card">

          <h2>📝 افزودن دستور</h2>

          <p class="small">
            دستور بعد از ذخیره در بخش «مدیریت دستورها» قابل مشاهده است.
          </p>

          ${
            req.query.error
              ? `
              <div class="alert alert-error">
                ${esc(req.query.error)}
              </div>
              `
              : ""
          }

          ${
            req.query.success
              ? `
              <div class="alert alert-success">
                ${esc(req.query.success)}
              </div>
              `
              : ""
          }

          ${
            bots.length
              ? `
              <form method="POST" action="/commands">

                <div class="form-group">

                  <label>
                    انتخاب ربات
                  </label>

                  <select name="botId" required>

                    <option value="">
                      انتخاب کنید
                    </option>

                    ${bots.map(bot => `
                      <option
                        value="${bot.id}"
                        ${
                          req.query.bot === bot.id
                            ? "selected"
                            : ""
                        }
                      >
                        ${esc(bot.name)}
                        (@${esc(bot.username)})
                      </option>
                    `).join("")}

                  </select>

                </div>

                <div class="form-group">

                  <label>
                    نام دستور
                  </label>

                  <input
                    name="command"
                    required
                    placeholder="مثلاً panel"
                  >

                  <div class="small">
                    بدون / وارد کنید.
                  </div>

                </div>

                <div class="form-group">

                  <label>
                    پاسخ دستور
                  </label>

                  <textarea
                    name="reply"
                    required
                    placeholder="متنی که بعد از اجرای دستور ارسال شود..."
                  ></textarea>

                </div>

                <button
                  class="btn btn-primary"
                  type="submit"
                >
                  💾 ذخیره دستور
                </button>

              </form>
              `
              : `
              <div class="empty">
                ابتدا یک ربات اضافه کنید.
                <br><br>
                <a
                  href="/add-bot"
                  class="btn btn-primary"
                >
                  ➕ افزودن ربات
                </a>
              </div>
              `
          }

        </div>
        `,
        req
      )
    );
  }
);

app.post(
  "/commands",
  requireUser,
  (req, res) => {

    const botId =
      String(req.body.botId || "");

    let command =
      String(req.body.command || "")
        .trim()
        .replace(/^\/+/, "")
        .toLowerCase();

    const reply =
      String(req.body.reply || "").trim();

    const bot = db.bots.find(
      x =>
        x.id === botId &&
        x.ownerId === req.session.userId
    );

    if (!bot) {
      return res.redirect(
        "/commands?error=" +
        encodeURIComponent(
          "ربات انتخاب‌شده متعلق به شما نیست."
        )
      );
    }

    if (!command || !reply) {
      return res.redirect(
        "/commands?error=" +
        encodeURIComponent(
          "نام دستور و پاسخ الزامی است."
        )
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(command)) {
      return res.redirect(
        "/commands?error=" +
        encodeURIComponent(
          "نام دستور فقط می‌تواند شامل حروف انگلیسی، عدد و _ باشد."
        )
      );
    }

    const commands =
      getCommands(botId);

    if (
      commands.some(
        x =>
          x.name.toLowerCase() ===
          command.toLowerCase()
      )
    ) {
      return res.redirect(
        "/commands?error=" +
        encodeURIComponent(
          "این دستور قبلاً وجود دارد."
        )
      );
    }

    commands.push({
      id: makeId(),
      name: command,
      reply,
      createdAt: new Date().toISOString()
    });

    saveDB();

    res.redirect(
      "/commands?success=" +
      encodeURIComponent(
        "دستور با موفقیت ذخیره شد."
      )
    );
  }
);

/* =========================================================
   COMMAND MANAGEMENT
========================================================= */

app.get(
  "/commands/manage",
  requireUser,
  (req, res) => {

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    res.send(
      page(
        "مدیریت دستورها",
        `
        <div class="card">

          <h2>📋 مدیریت دستورها</h2>

          <p class="small">
            دستورهای ذخیره‌شده ربات‌های شما در اینجا نمایش داده می‌شوند.
          </p>

        </div>

        ${
          bots.map(bot => {

            const commands =
              getCommands(bot.id);

            return `
            <div class="card">

              <h3>
                🤖 ${esc(bot.name)}
              </h3>

              ${
                commands.length
                  ? `
                  <div class="table-wrap">

                    <table>

                      <thead>
                        <tr>
                          <th>دستور</th>
                          <th>پاسخ</th>
                          <th>عملیات</th>
                        </tr>
                      </thead>

                      <tbody>

                        ${commands.map(cmd => `
                          <tr>

                            <td dir="ltr">
                              /${esc(cmd.name)}
                            </td>

                            <td>
                              ${esc(cmd.reply)}
                            </td>

                            <td>

                              <form
                                method="POST"
                                action="/commands/delete"
                                onsubmit="return confirmDelete('این دستور حذف شود؟')"
                              >

                                <input
                                  type="hidden"
                                  name="botId"
                                  value="${bot.id}"
                                >

                                <input
                                  type="hidden"
                                  name="commandId"
                                  value="${cmd.id}"
                                >

                                <button
                                  class="btn btn-danger"
                                  type="submit"
                                >
                                  🗑️ حذف
                                </button>

                              </form>

                            </td>

                          </tr>
                        `).join("")}

                      </tbody>

                    </table>

                  </div>
                  `
                  : `
                  <div class="empty">
                    هنوز دستوری برای این ربات ساخته نشده است.
                  </div>
                  `
              }

            </div>
            `;

          }).join("")
        }

        ${
          !bots.length
            ? `
            <div class="card empty">
              هنوز رباتی ندارید.
            </div>
            `
            : ""
        }
        `,
        req
      )
    );
  }
);

app.post(
  "/commands/delete",
  requireUser,
  (req, res) => {

    const bot =
      db.bots.find(
        x =>
          x.id === req.body.botId &&
          x.ownerId === req.session.userId
      );

    if (!bot) {
      return res.status(403).send("دسترسی غیرمجاز");
    }

    const commands =
      getCommands(bot.id);

    db.commands[bot.id] =
      commands.filter(
        x => x.id !== req.body.commandId
      );

    saveDB();

    res.redirect("/commands/manage");
  }
);

/* =========================================================
   USERS
========================================================= */

app.get(
  "/users",
  requireUser,
  (req, res) => {

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    const allUsers = [];

    for (const bot of bots) {

      const users =
        db.botUsers[bot.id] || [];

      for (const user of users) {

        allUsers.push({
          ...user,
          botName: bot.name
        });

      }
    }

    res.send(
      page(
        "کاربران",
        `
        <div class="card">

          <h2>👥 کاربران</h2>

          <p class="small">
            کاربران ربات‌های خودتان در این بخش نمایش داده می‌شوند.
          </p>

          <div class="stats">

            <div class="stat">
              <div class="icon">👥</div>
              <div class="number">
                ${allUsers.length}
              </div>
              <div class="label">
                مجموع کاربران
              </div>
            </div>

            <div class="stat">
              <div class="icon">🤖</div>
              <div class="number">
                ${bots.length}
              </div>
              <div class="label">
                ربات‌ها
              </div>
            </div>

          </div>

        </div>

        <div class="card">

          ${
            allUsers.length
              ? `
              <div class="table-wrap">

                <table>

                  <thead>
                    <tr>
                      <th>نام</th>
                      <th>آیدی</th>
                      <th>یوزرنیم</th>
                      <th>ربات</th>
                    </tr>
                  </thead>

                  <tbody>

                    ${allUsers.map(user => `
                      <tr>

                        <td>
                          ${esc(
                            `${user.firstName || ""} ${user.lastName || ""}`
                          )}
                        </td>

                        <td dir="ltr">
                          ${esc(user.id)}
                        </td>

                        <td dir="ltr">
                          ${
                            user.username
                              ? "@" + esc(user.username)
                              : "-"
                          }
                        </td>

                        <td>
                          ${esc(user.botName)}
                        </td>

                      </tr>
                    `).join("")}

                  </tbody>

                </table>

              </div>
              `
              : `
              <div class="empty">
                هنوز کاربری وجود ندارد.
              </div>
              `
          }

        </div>
        `,
        req
      )
    );
  }
);

/* =========================================================
   GLOBAL BROADCAST
========================================================= */

app.get(
  "/broadcast",
  requireUser,
  (req, res) => {

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    res.send(
      page(
        "ارسال پیام به همه کاربران",
        `
        <div class="card">

          <h2>📢 ارسال پیام به همه کاربران</h2>

          <p class="small">
            پیام برای کاربران ربات‌های شما ارسال می‌شود.
          </p>

          ${
            req.query.success
              ? `
              <div class="alert alert-success">
                ${esc(req.query.success)}
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

          ${
            bots.length
              ? `
              <form
                method="POST"
                action="/broadcast"
              >

                <div class="form-group">

                  <label>
                    متن پیام
                  </label>

                  <textarea
                    name="text"
                    required
                    placeholder="پیام خود را بنویسید..."
                  ></textarea>

                </div>

                <button
                  class="btn btn-purple"
                  type="submit"
                >
                  📤 ارسال به همه کاربران
                </button>

              </form>
              `
              : `
              <div class="empty">
                ابتدا یک ربات اضافه کنید.
              </div>
              `
          }

        </div>
        `,
        req
      )
    );
  }
);

app.post(
  "/broadcast",
  requireUser,
  async (req, res) => {

    const text =
      String(req.body.text || "").trim();

    if (!text) {
      return res.redirect(
        "/broadcast?error=" +
        encodeURIComponent(
          "متن پیام خالی است."
        )
      );
    }

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    let success = 0;
    let failed = 0;

    for (const bot of bots) {

      const users =
        db.botUsers[bot.id] || [];

      for (const user of users) {

        try {

          await sendTelegramMessage(
            bot.token,
            user.id,
            text
          );

          success++;

        } catch {

          failed++;
        }

        await new Promise(
          resolve => setTimeout(resolve, 60)
        );
      }
    }

    res.redirect(
      "/broadcast?success=" +
      encodeURIComponent(
        `ارسال انجام شد. موفق: ${success} | ناموفق: ${failed}`
      )
    );
  }
);

/* =========================================================
   FORCE JOIN
========================================================= */

app.get(
  "/force-join",
  requireUser,
  (req, res) => {

    const bots =
      db.bots.filter(
        x => x.ownerId === req.session.userId
      );

    res.send(
      page(
        "عضویت اجباری",
        `
        <div class="card">

          <h2>🔒 عضویت اجباری</h2>

          <p class="small">
            برای هر ربات می‌توانید یک کانال یا گروه عمومی تعیین کنید.
          </p>

        </div>

        ${
          bots.map(bot => `
          <div class="card">

            <h3>
              🤖 ${esc(bot.name)}
            </h3>

            ${
              bot.forceJoin
                ? `
                <div class="alert alert-success">
                  فعال:
                  ${esc(bot.forceJoin.username)}
                </div>
                `
                : `
                <div class="alert alert-info">
                  عضویت اجباری برای این ربات فعال نیست.
                </div>
                `
            }

            <form
              method="POST"
              action="/bot/${bot.id}/force-join"
            >

              <div class="form-group">

                <label>
                  لینک عمومی کانال یا گروه
                </label>

                <input
                  name="link"
                  placeholder="https://t.me/example"
                  value="${
                    bot.forceJoin
                      ? esc(bot.forceJoin.link || "")
                      : ""
                  }"
                >

              </div>

              <div class="form-actions">

                <button
                  class="btn btn-warning"
                  type="submit"
                >
                  🔒 فعال کردن
                </button>

                ${
                  bot.forceJoin
                    ? `
                    <form
                      method="POST"
                      action="/bot/${bot.id}/force-join/remove"
                    >
                      <button
                        class="btn btn-danger"
                        type="submit"
                      >
                        ❌ غیرفعال کردن
                      </button>
                    </form>
                    `
                    : ""
                }

              </div>

            </form>

          </div>
        `).join("")
        }
        `,
        req
      )
    );
  }
);

app.get(
  "/bot/:id/force-join",
  requireUser,
  (req, res) => {
    res.redirect("/force-join");
  }
);

app.post(
  "/bot/:id/force-join",
  requireUser,
  async (req, res) => {

    const bot =
      getBot(req.params.id);

    if (
      !bot ||
      bot.ownerId !== req.session.userId
    ) {
      return res.status(403).send("دسترسی غیرمجاز");
    }

    const parsed =
      parsePublicTelegramLink(req.body.link);

    if (!parsed) {
      return res.status(400).send(
        page(
          "خطا",
          `
          <div class="card">

            <div class="alert alert-error">
              لینک معتبر عمومی تلگرام وارد کنید.
              <br><br>
              مثال:
              https://t.me/example
            </div>

            <a
              href="/force-join"
              class="btn btn-primary"
            >
              بازگشت
            </a>

          </div>
          `,
          req
        )
      );
    }

    try {

      const chat =
        await telegram(
          bot.token,
          "getChat",
          {
            chat_id: parsed.username
          }
        );

      if (
        !["channel", "supergroup", "group"]
          .includes(chat.type)
      ) {
        throw new Error(
          "این لینک مربوط به کانال یا گروه نیست."
        );
      }

      bot.forceJoin = {
        username: parsed.username,
        link:
          "https://t.me/" +
          parsed.username.replace("@", ""),
        title: chat.title || "",
        type: chat.type,
        updatedAt: new Date().toISOString()
      };

      saveDB();

      res.redirect("/force-join");

    } catch (e) {

      res.status(400).send(
        page(
          "خطای عضویت اجباری",
          `
          <div class="card">

            <div class="alert alert-error">
              نتوانستم کانال یا گروه را بررسی کنم.
              <br><br>
              مطمئن شوید:
              <br>
              1. لینک عمومی است.
              <br>
              2. ربات داخل کانال/گروه قرار دارد.
              <br>
              3. ربات دسترسی لازم را دارد.
            </div>

            <a
              href="/force-join"
              class="btn btn-primary"
            >
              بازگشت
            </a>

          </div>
          `,
          req
        )
      );
    }
  }
);

app.post(
  "/bot/:id/force-join/remove",
  requireUser,
  (req, res) => {

    const bot =
      getBot(req.params.id);

    if (
      !bot ||
      bot.ownerId !== req.session.userId
    ) {
      return res.status(403).send("دسترسی غیرمجاز");
    }

    bot.forceJoin = null;

    saveDB();

    res.redirect("/force-join");
  }
);

/* =========================================================
   BOT USERS
========================================================= */

app.get(
  "/bot/:id/users",
  requireLogin,
  (req, res) => {

    const bot =
      ownedBot(req, req.params.id);

    if (!bot) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    const users =
      db.botUsers[bot.id] || [];

    res.send(
      page(
        `کاربران ${bot.name}`,
        `
        <div class="card">

          <h2>
            👥 کاربران ${esc(bot.name)}
          </h2>

          <p class="small">
            تعداد کاربران:
            ${users.length}
          </p>

        </div>

        <div class="card">

          ${
            users.length
              ? `
              <div class="table-wrap">

                <table>

                  <thead>
                    <tr>
                      <th>نام</th>
                      <th>آیدی</th>
                      <th>یوزرنیم</th>
                      <th>آخرین فعالیت</th>
                    </tr>
                  </thead>

                  <tbody>

                    ${users.map(user => `
                      <tr>

                        <td>
                          ${esc(
                            `${user.firstName || ""} ${user.lastName || ""}`
                          )}
                        </td>

                        <td dir="ltr">
                          ${esc(user.id)}
                        </td>

                        <td dir="ltr">
                          ${
                            user.username
                              ? "@" + esc(user.username)
                              : "-"
                          }
                        </td>

                        <td>
                          ${esc(user.lastSeen || "-")}
                        </td>

                      </tr>
                    `).join("")}

                  </tbody>

                </table>

              </div>
              `
              : `
              <div class="empty">
                هنوز کاربری برای این ربات ثبت نشده است.
              </div>
              `
          }

        </div>
        `,
        req
      )
    );
  }
);

/* =========================================================
   BOT BROADCAST
========================================================= */

app.get(
  "/bot/:id/broadcast",
  requireLogin,
  (req, res) => {

    const bot =
      ownedBot(req, req.params.id);

    if (!bot) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    res.send(
      page(
        "ارسال پیام ربات",
        `
        <div class="card">

          <h2>
            📢 ارسال پیام
          </h2>

          <p>
            ربات:
            <strong>
              ${esc(bot.name)}
            </strong>
          </p>

          ${
            req.query.success
              ? `
              <div class="alert alert-success">
                ${esc(req.query.success)}
              </div>
              `
              : ""
          }

          <form
            method="POST"
            action="/bot/${bot.id}/broadcast"
          >

            <div class="form-group">

              <label>
                پیام
              </label>

              <textarea
                name="text"
                required
                placeholder="پیام خود را بنویسید..."
              ></textarea>

            </div>

            <button
              class="btn btn-purple"
              type="submit"
            >
              📤 ارسال به کاربران
            </button>

          </form>

        </div>
        `,
        req
      )
    );
  }
);

app.post(
  "/bot/:id/broadcast",
  requireLogin,
  async (req, res) => {

    const bot =
      ownedBot(req, req.params.id);

    if (!bot) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    const text =
      String(req.body.text || "").trim();

    const users =
      db.botUsers[bot.id] || [];

    let success = 0;
    let failed = 0;

    for (const user of users) {

      try {

        await sendTelegramMessage(
          bot.token,
          user.id,
          text
        );

        success++;

      } catch {

        failed++;
      }

      await new Promise(
        resolve => setTimeout(resolve, 60)
      );
    }

    res.redirect(
      `/bot/${bot.id}/broadcast?success=` +
      encodeURIComponent(
        `موفق: ${success} | ناموفق: ${failed}`
      )
    );
  }
);

/* =========================================================
   DELETE BOT
========================================================= */

app.post(
  "/bot/:id/delete",
  requireLogin,
  (req, res) => {

    const bot =
      getBot(req.params.id);

    if (!bot) {
      return res.status(404).send("ربات پیدا نشد.");
    }

    if (
      !req.session.isAdmin &&
      bot.ownerId !== req.session.userId
    ) {
      return res.status(403).send("دسترسی غیرمجاز");
    }

    db.bots =
      db.bots.filter(
        x => x.id !== bot.id
      );

    delete db.botUsers[bot.id];
    delete db.commands[bot.id];

    saveDB();

    if (req.session.isAdmin) {
      return res.redirect("/creator");
    }

    res.redirect("/my-bots");
  }
);

/* =========================================================
   ACCOUNT
========================================================= */

app.get(
  "/account",
  requireUser,
  (req, res) => {

    const user =
      getUser(req.session.userId);

    const botCount =
      db.bots.filter(
        x => x.ownerId === user.id
      ).length;

    res.send(
      page(
        "حساب کاربری",
        `
        <div class="card">

          <h2>👤 حساب کاربری</h2>

          <div class="form-group">
            <label>نام کاربری</label>

            <input
              value="${esc(user.username)}"
              disabled
            >
          </div>

          <div class="form-group">
            <label>تعداد ربات‌ها</label>

            <input
              value="${botCount}"
              disabled
            >
          </div>

          <div class="form-group">
            <label>تاریخ ساخت حساب</label>

            <input
              value="${esc(user.createdAt)}"
              disabled
            >
          </div>

        </div>
        `,
        req
      )
    );
  }
);

/* =========================================================
   CREATOR LOGIN
========================================================= */

app.get(
  "/creator/login",
  (req, res) => {

    res.send(
      page(
        "ورود سازنده",
        `
        <div class="auth-page">

          <div class="auth-box">

            <div class="auth-logo">

              <div class="big">
                👑
              </div>

              <h1>
                ورود سازنده
              </h1>

              <p>
                پنل مدیریت اصلی
              </p>

            </div>

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
                  autocomplete="current-password"
                  placeholder="رمز سازنده"
                >

              </div>

              <button
                class="btn btn-purple"
                type="submit"
              >
                👑 ورود به پنل سازنده
              </button>

            </form>

            <br>

            <a
              href="/"
              class="btn btn-light"
            >
              بازگشت
            </a>

          </div>

        </div>
        `,
        req,
        { hideMenu: true }
      )
    );
  }
);

app.post(
  "/creator/login",
  (req, res) => {

    const password =
      String(req.body.password || "");

    if (password !== ADMIN_PASSWORD) {

      return res.redirect(
        "/creator/login?error=" +
        encodeURIComponent(
          "رمز سازنده اشتباه است."
        )
      );
    }

    req.session.isAdmin = true;
    req.session.userId = null;

    res.redirect("/creator");
  }
);

/* =========================================================
   CREATOR PANEL
========================================================= */

app.get(
  "/creator",
  requireAdmin,
  (req, res) => {

    const totalUsers =
      db.users.length;

    const totalBots =
      db.bots.length;

    const telegramUsers =
      Object.values(db.botUsers)
        .reduce(
          (sum, users) =>
            sum + users.length,
          0
        );

    res.send(
      page(
        "پنل سازنده",
        `
        <div class="stats">

          <div class="stat">
            <div class="icon">👤</div>
            <div class="number">
              ${totalUsers}
            </div>
            <div class="label">
              حساب‌های سایت
            </div>
          </div>

          <div class="stat">
            <div class="icon">🤖</div>
            <div class="number">
              ${totalBots}
            </div>
            <div class="label">
              همه ربات‌ها
            </div>
          </div>

          <div class="stat">
            <div class="icon">👥</div>
            <div class="number">
              ${telegramUsers}
            </div>
            <div class="label">
              کاربران تلگرام
            </div>
          </div>

        </div>

        <div class="card">

          <h2>
            📢 ارسال پیام سراسری
          </h2>

          <p class="small">
            پیام به کاربران تمام ربات‌های ثبت‌شده ارسال می‌شود.
          </p>

          <form
            method="POST"
            action="/creator/broadcast"
          >

            <div class="form-group">

              <textarea
                name="text"
                required
                placeholder="پیام سازنده..."
              ></textarea>

            </div>

            <button
              class="btn btn-purple"
              type="submit"
            >
              📤 ارسال به همه کاربران
            </button>

          </form>

        </div>

        <div class="card">

          <h2>
            🤖 همه ربات‌ها
          </h2>

          ${
            db.bots.length
              ? `
              <div class="bot-grid">

                ${db.bots.map(bot => {

                  const owner =
                    getUser(bot.ownerId);

                  const users =
                    db.botUsers[bot.id]?.length || 0;

                  return `
                  <div class="bot-card">

                    <div class="bot-head">

                      <div>

                        <div class="bot-name">
                          ${esc(bot.name)}
                        </div>

                        <div class="bot-username">
                          @${esc(bot.username)}
                        </div>

                      </div>

                    </div>

                    <p class="small">
                      👤 صاحب:
                      <strong>
                        ${esc(
                          owner?.username ||
                          "نامشخص"
                        )}
                      </strong>
                    </p>

                    <p class="small">
                      👥 کاربران:
                      ${users}
                    </p>

                    <div class="token-box">
                      ${esc(bot.token)}
                    </div>

                    <div class="bot-actions">

                      <a
                        href="/bot/${bot.id}"
                        class="btn btn-primary"
                      >
                        ⚙️ مدیریت
                      </a>

                      <form
                        method="POST"
                        action="/bot/${bot.id}/delete"
                        onsubmit="return confirmDelete('این ربات حذف شود؟')"
                      >

                        <button
                          class="btn btn-danger"
                          type="submit"
                          style="width:100%"
                        >
                          🗑️ حذف
                        </button>

                      </form>

                    </div>

                  </div>
                  `;

                }).join("")}

              </div>
              `
              : `
              <div class="empty">
                هنوز رباتی ثبت نشده است.
              </div>
              `
          }

        </div>

        <div class="card">

          <h2>
            👤 کاربران سایت
          </h2>

          ${
            db.users.length
              ? `
              <div class="table-wrap">

                <table>

                  <thead>
                    <tr>
                      <th>نام کاربری</th>
                      <th>تعداد ربات</th>
                      <th>تاریخ ثبت</th>
                    </tr>
                  </thead>

                  <tbody>

                    ${db.users.map(user => {

                      const count =
                        db.bots.filter(
                          x =>
                            x.ownerId === user.id
                        ).length;

                      return `
                      <tr>

                        <td>
                          ${esc(user.username)}
                        </td>

                        <td>
                          ${count}
                        </td>

                        <td>
                          ${esc(user.createdAt)}
                        </td>

                      </tr>
                      `;

                    }).join("")}

                  </tbody>

                </table>

              </div>
              `
              : `
              <div class="empty">
                کاربری وجود ندارد.
              </div>
              `
          }

        </div>
        `,
        req
      )
    );
  }
);

/* =========================================================
   CREATOR BROADCAST
========================================================= */

app.post(
  "/creator/broadcast",
  requireAdmin,
  async (req, res) => {

    const text =
      String(req.body.text || "").trim();

    if (!text) {
      return res.redirect("/creator");
    }

    let success = 0;
    let failed = 0;

    for (const bot of db.bots) {

      const users =
        db.botUsers[bot.id] || [];

      for (const user of users) {

        try {

          await sendTelegramMessage(
            bot.token,
            user.id,
            text
          );

          success++;

        } catch {

          failed++;
        }

        await new Promise(
          resolve => setTimeout(resolve, 60)
        );
      }
    }

    console.log(
      `Global broadcast: success=${success}, failed=${failed}`
    );

    res.redirect("/creator");
  }
);

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

  console.log(
    "ربات ساز کانفیگ ساز رایگان فعال شد."
  );

  console.log(
    `تعداد ربات‌ها: ${db.bots.length}`
  );

  for (const bot of db.bots) {
    startBotPolling(bot);
  }

});
