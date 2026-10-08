const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "data.json");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto" }
}));

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    d.users ||= [];
    d.bots ||= [];
    d.botUsers ||= {};
    d.commands ||= {};
    d.activities ||= [];
    d.forceJoinVerified ||= {};
    return d;
  } catch {
    return {
      users: [], bots: [], botUsers: {},
      commands: {}, activities: [], forceJoinVerified: {}
    };
  }
}

let db = loadDB();

function saveDB() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

const makeId = () => crypto.randomBytes(8).toString("hex");

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function logActivity(text) {
  db.activities.unshift({ text, time: new Date().toISOString() });
  db.activities = db.activities.slice(0, 200);
  saveDB();
}

async function telegram(token, method, body = {}) {
  const r = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000)
    }
  );

  const data = await r.json();

  if (!r.ok || !data.ok) {
    throw new Error(data.description || `Telegram error: ${method}`);
  }

  return data.result;
}

function requireLogin(req, res, next) {
  if (!req.session.loggedIn) return res.redirect("/login");
  next();
}

const getBot = id => db.bots.find(b => b.id === id);
const getBotByToken = token => db.bots.find(b => b.token === token);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function ensureBotData(bot) {
  if (!Array.isArray(bot.forceJoins)) bot.forceJoins = [];
  if (!db.botUsers[bot.id]) db.botUsers[bot.id] = [];
  if (!db.commands[bot.id]) db.commands[bot.id] = [];
  if (!db.forceJoinVerified[bot.id]) db.forceJoinVerified[bot.id] = {};
}

function recordUser(bot, user) {
  ensureBotData(bot);
  if (!user?.id) return;

  const list = db.botUsers[bot.id];

  const old = list.find(u => String(u.id) === String(user.id));

  if (old) {
    old.first_name = user.first_name || old.first_name || "";
    old.username = user.username || old.username || "";
  } else {
    list.push({
      id: user.id,
      first_name: user.first_name || "",
      username: user.username || "",
      addedAt: new Date().toISOString()
    });
  }

  saveDB();
}

function parseTelegramLink(value) {
  const input = String(value || "").trim();
  let username = input;

  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);

    if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"]
      .includes(url.hostname.toLowerCase())) {
      throw new Error("فقط لینک عمومی تلگرام قابل قبول است.");
    }

    username = url.pathname.split("/").filter(Boolean)[0] || "";
  }

  username = username.replace(/^@/, "");

  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
    throw new Error("نام کاربری عمومی معتبر وارد کن؛ مانند @mychannel");
  }

  return {
    username: "@" + username,
    link: "https://t.me/" + username
  };
}

async function checkBotAdmin(bot, chatId) {
  const me = await telegram(bot.token, "getMe");

  const member = await telegram(bot.token, "getChatMember", {
    chat_id: chatId,
    user_id: me.id
  });

  if (!["administrator", "creator"].includes(member.status)) {
    throw new Error("ربات باید در کانال یا گروه ادمین باشد.");
  }

  return true;
}

/* بررسی واقعی عضویت کاربر */
async function checkMembership(bot, join, userId) {
  try {
    const member = await telegram(bot.token, "getChatMember", {
      chat_id: join.chatId || join.username,
      user_id: userId
    });

    const ok =
      ["creator", "administrator", "member"].includes(member.status) ||
      (member.status === "restricted" && member.is_member === true);

    return { ok, error: null };
  } catch (error) {
    console.error(
      "FORCE JOIN:",
      join.title || join.username,
      error.message
    );

    return { ok: false, error: error.message };
  }
}

/* عضویت در تمام کانال‌ها در هر بررسی دوباره کنترل می‌شود */
async function checkAllMemberships(bot, userId) {
  ensureBotData(bot);

  const missing = [];
  const errors = [];

  for (const join of bot.forceJoins) {
    const result = await checkMembership(bot, join, userId);

    if (!result.ok) {
      missing.push(join);

      if (result.error) {
        errors.push({
          title: join.title || join.username,
          error: result.error
        });
      }
    }
  }

  return { ok: missing.length === 0, missing, errors };
}

async function sendJoinMessage(bot, chatId, missing, errors = []) {
  const keyboard = missing.map(join => [{
    text: "📢 عضویت در " + (join.title || join.username),
    url: join.link
  }]);

  keyboard.push([{
    text: "✅ بررسی عضویت",
    callback_data: "check_join_start"
  }]);

  let text =
    "🔐 برای استفاده از این ربات ابتدا در کانال‌ها یا گروه‌های زیر عضو شو:\n\n" +
    "بعد از عضویت، روی «✅ بررسی عضویت» بزن.";

  if (errors.length) {
    text +=
      "\n\n⚠️ بررسی عضویت با خطا روبه‌رو شد. " +
      "ادمین بودن ربات و دسترسی آن به کانال را بررسی کن.";
  }

  await telegram(bot.token, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function executeCommand(bot, chatId, command) {
  ensureBotData(bot);

  const normalized = String(command || "").trim().split(/\s+/)[0];
  const base = normalized.split("@")[0];

  const found = db.commands[bot.id].find(c => c.command === base);

  if (!found) {
    if (base === "/start") {
      await telegram(bot.token, "sendMessage", {
        chat_id: chatId,
        text: "✅ خوش آمدی! ربات با موفقیت فعال است."
      });
    }
    return;
  }

  if (found.type === "photo" && found.fileId) {
    return telegram(bot.token, "sendPhoto", {
      chat_id: chatId,
      photo: found.fileId,
      caption: found.response || ""
    });
  }

  if (found.type === "video" && found.fileId) {
    return telegram(bot.token, "sendVideo", {
      chat_id: chatId,
      video: found.fileId,
      caption: found.response || ""
    });
  }

  return telegram(bot.token, "sendMessage", {
    chat_id: chatId,
    text: found.response || " "
  });
}

async function handleStart(bot, message) {
  recordUser(bot, message.from);

  if (!bot.forceJoins.length) {
    return executeCommand(bot, message.chat.id, "/start");
  }

  const result = await checkAllMemberships(bot, message.from.id);

  if (!result.ok) {
    return sendJoinMessage(
      bot, message.chat.id, result.missing, result.errors
    );
  }

  return executeCommand(bot, message.chat.id, "/start");
}

async function handleCallback(bot, query) {
  if (query.data !== "check_join_start") return;

  const userId = query.from?.id;
  const chatId = query.message?.chat?.id;

  if (!userId || !chatId) {
    return telegram(bot.token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: "درخواست معتبر نیست.",
      show_alert: true
    });
  }

  try {
    const result = await checkAllMemberships(bot, userId);

    if (!result.ok) {
      await telegram(bot.token, "answerCallbackQuery", {
        callback_query_id: query.id,
        text: result.errors.length
          ? "⚠️ بررسی عضویت ناموفق بود؛ دسترسی ربات را بررسی کنید."
          : "❌ هنوز عضو همه کانال‌ها نشده‌ای.",
        show_alert: true
      });

      const keyboard = result.missing.map(join => [{
        text: "📢 عضویت در " + (join.title || join.username),
        url: join.link
      }]);

      keyboard.push([{
        text: "✅ بررسی عضویت",
        callback_data: "check_join_start"
      }]);

      await telegram(bot.token, "editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: keyboard }
      }).catch(e => console.error("EDIT:", e.message));

      return;
    }

    await telegram(bot.token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: "✅ عضویت شما تأیید شد."
    });

    await telegram(bot.token, "deleteMessage", {
      chat_id: chatId,
      message_id: query.message.message_id
    }).catch(() => {});

    return executeCommand(bot, chatId, "/start");
  } catch (error) {
    console.error("CALLBACK ERROR:", error.message);

    await telegram(bot.token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: "خطا در بررسی عضویت؛ دوباره تلاش کن.",
      show_alert: true
    }).catch(() => {});
  }
}

async function handleUpdate(bot, update) {
  if (update.callback_query) {
    return handleCallback(bot, update.callback_query);
  }

  const message = update.message;
  if (!message?.from || message.chat.type !== "private") return;

  recordUser(bot, message.from);

  const text = String(message.text || "").trim();
  if (!text.startsWith("/")) return;

  const command = text.split(/\s+/)[0];

  if (/^\/start(?:@\w+)?$/i.test(command)) {
    return handleStart(bot, message);
  }

  // تمام دستورها نیز مشمول عضویت اجباری هستند.
  if (bot.forceJoins.length) {
    const result = await checkAllMemberships(bot, message.from.id);

    if (!result.ok) {
      return sendJoinMessage(
        bot, message.chat.id, result.missing, result.errors
      );
    }
  }

  return executeCommand(bot, message.chat.id, text);
}

/* دریافت آپدیت‌های ربات */
const pollingState = new Map();

async function pollBot(bot) {
  if (pollingState.get(bot.id)?.running) return;

  const state = {
    running: true,
    offset: Number(bot.updateOffset || 0)
  };

  pollingState.set(bot.id, state);

  try {
    await telegram(bot.token, "deleteWebhook", {
      drop_pending_updates: false
    });

    console.log("Polling started:", bot.username);

    while (state.running && db.bots.some(b => b.id === bot.id)) {
      try {
        const updates = await telegram(bot.token, "getUpdates", {
          offset: state.offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"]
        });

        for (const update of updates) {
          state.offset = update.update_id + 1;
          bot.updateOffset = state.offset;

          try {
            await handleUpdate(bot, update);
          } catch (error) {
            console.error("UPDATE ERROR:", error.message);
          }
        }

        saveDB();
      } catch (error) {
        console.error("POLLING ERROR:", error.message);
        await sleep(3000);
      }
    }
  } catch (error) {
    console.error("BOT ERROR:", error.message);
  } finally {
    pollingState.delete(bot.id);
  }
}

function startBotPolling(bot) {
  pollBot(bot).catch(e => console.error("POLLING:", e.message));
}

/* قالب صفحه و منوی پنل */
function page(title, content, active = "") {
  const items = [
    ["/", "🏠 بازگشت به صفحه اصلی"],
    ["/bots", "🤖 مدیریت ربات‌ها"],
    ["/bots/add", "➕ افزودن ربات جدید"],
    ["/forcejoin", "🔐 عضویت اجباری"],
    ["/commands", "⚡ مدیریت دستورات ربات"],
    ["/commands/add", "➕ افزودن دستور جدید"],
    ["/broadcast", "📢 ارسال پیام به همه کاربران"],
    ["/users", "👥 مدیریت کاربران"],
    ["/stats", "📊 آمار ربات‌ها و کاربران"],
    ["/bot-test", "🧪 تست اتصال ربات"]
  ];

  const menu = items.map(([url, label]) =>
    `<a class="mi ${active === url ? "active" : ""}" href="${url}">${label}</a>`
  ).join("");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f2f5ff;--card:#fff;--text:#202747;--muted:#707991;--border:#e3e8f6;--p:#6557ed}
body.dark{--bg:#101426;--card:#1b2138;--text:#f1f3ff;--muted:#b4bdd6;--border:#303954;--p:#9185ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Tahoma,Arial}
header{position:sticky;top:0;z-index:5;background:linear-gradient(120deg,#6557ed,#a34df5);color:white;padding:14px;display:flex;justify-content:space-between;align-items:center}
header button{font-size:20px;margin-right:5px}
main{max-width:1200px;margin:auto;padding:20px}
.card{background:var(--card);border:1px solid var(--border);padding:18px;border-radius:16px;margin-bottom:16px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.stat{font-size:30px;font-weight:bold;margin-top:10px}
button,.btn{display:inline-block;background:var(--p);color:white;border:0;border-radius:10px;padding:11px 14px;text-decoration:none;cursor:pointer;font-family:inherit}
.danger{background:#dc3455}
input,select,textarea{display:block;width:100%;padding:12px;margin:8px 0 15px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-family:inherit}
label{font-weight:bold;font-size:14px}table{width:100%;border-collapse:collapse}td,th{text-align:right;padding:10px;border-bottom:1px solid var(--border)}
.wrap{overflow-x:auto}.overlay{display:none;position:fixed;inset:0;background:#0008;z-index:8}.overlay.show{display:block}
.side{position:fixed;z-index:9;top:0;bottom:0;right:0;width:min(330px,88vw);overflow:auto;background:var(--card);padding:18px;transform:translateX(110%);transition:.25s}
.side.show{transform:translateX(0)}.mi{display:block;color:var(--text);padding:13px 10px;border-radius:10px;text-decoration:none;margin:4px 0;font-size:14px}
.mi:hover,.mi.active{background:var(--bg);color:var(--p)}.muted{color:var(--muted);line-height:2}
@media(max-width:600px){main{padding:12px}.card{padding:14px}}
</style>
</head>
<body>
<header>
<strong>🚀 پنل مدیریت ربات</strong>
<div>
<button onclick="location.reload()">🔄</button>
<button onclick="theme()">🌓</button>
<button onclick="openMenu()">☰</button>
</div>
</header>
<div class="overlay" id="overlay" onclick="closeMenu()"></div>
<aside class="side" id="side">
<h3>☰ منوی اصلی</h3>
${menu}
<hr>
<a href="#" class="mi" onclick="event.preventDefault();location.reload()">🔄 بروزرسانی صفحه</a>
<a href="#" class="mi" onclick="event.preventDefault();theme()">🌓 تغییر حالت روشن / تاریک</a>
<p class="muted">🕒 آخرین بروزرسانی:<br>${esc(new Date().toLocaleString("fa-IR"))}</p>
<a href="/creator" class="mi">👑 ورود سازنده</a>
<a href="/logout" class="mi">🚪 خروج از حساب</a>
</aside>
<main>${content}</main>
<script>
function openMenu(){side.classList.add('show');overlay.classList.add('show')}
function closeMenu(){side.classList.remove('show');overlay.classList.remove('show')}
function theme(){document.body.classList.toggle('dark');localStorage.setItem('panel-theme',document.body.classList.contains('dark')?'dark':'light')}
if(localStorage.getItem('panel-theme')==='dark')document.body.classList.add('dark');
</script>
</body></html>`;
}

const layout = page;

/* ورود و خروج */
app.get("/login", (req, res) => {
  if (req.session.loggedIn) return res.redirect("/");

  res.send(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ورود</title><style>
body{font-family:Tahoma;background:#6557ed;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:white;color:#222;padding:25px;border-radius:16px;width:min(400px,90vw)}
input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:12px;border-radius:9px}
input{border:1px solid #ddd}button{border:0;background:#6557ed;color:white}
</style><form method="post"><h2>🚀 ورود به پنل</h2>
<label>رمز عبور</label><input type="password" name="password" required>
<button>ورود</button></form></html>`);
});

app.post("/login", (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) {
    return res.status(401).send("رمز اشتباه است. <a href='/login'>بازگشت</a>");
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).send("خطای ایجاد نشست.");
    req.session.loggedIn = true;
    res.redirect("/");
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* صفحه اصلی */
app.get("/", requireLogin, (req, res) => {
  const users = Object.values(db.botUsers).reduce((s, a) => s + a.length, 0);
  const commands = Object.values(db.commands).reduce((s, a) => s + a.length, 0);
  const joins = db.bots.reduce((s, b) => s + (b.forceJoins || []).length, 0);

  res.send(layout("صفحه اصلی", `
  <h1>🏠 بازگشت به صفحه اصلی</h1>
  <p class="muted">به پنل مدیریت خوش آمدی.</p>
  <div class="grid">
    <div class="card">🤖 تعداد ربات‌ها<div class="stat">${db.bots.length}</div></div>
    <div class="card">👥 کاربران<div class="stat">${users}</div></div>
    <div class="card">⚡ دستورات<div class="stat">${commands}</div></div>
    <div class="card">🔐 عضویت اجباری<div class="stat">${joins}</div></div>
  </div>
  <div class="card"><h3>دسترسی سریع</h3>
  <a class="btn" href="/bots">مدیریت ربات‌ها</a>
  <a class="btn" href="/forcejoin">عضویت اجباری</a>
  <a class="btn" href="/broadcast">ارسال همگانی</a></div>
  `, "/"));
});

/* افزودن و مدیریت ربات‌ها */
app.get("/bots", requireLogin, (req, res) => {
  const rows = db.bots.map(b => `<tr>
  <td>${esc(b.name)}</td><td>@${esc(b.username)}</td>
  <td>${(db.botUsers[b.id] || []).length}</td><td>
  <a class="btn" href="/bots/${b.id}">مدیریت</a>
  <form method="post" action="/bots/${b.id}/delete" style="display:inline" onsubmit="return confirm('حذف شود؟')">
  <button class="danger">حذف</button></form></td></tr>`).join("");

  res.send(layout("مدیریت ربات‌ها", `<h1>🤖 مدیریت ربات‌ها</h1>
  <div class="card"><a class="btn" href="/bots/add">➕ افزودن ربات</a></div>
  <div class="card wrap"><table><tr><th>نام</th><th>شناسه</th><th>کاربران</th><th>عملیات</th></tr>
  ${rows || "<tr><td colspan='4'>رباتی ثبت نشده است.</td></tr>"}</table></div>`, "/bots"));
});

app.get("/bots/add", requireLogin, (req, res) => {
  res.send(layout("افزودن ربات", `<h1>➕ افزودن ربات جدید</h1>
  <div class="card"><form method="post">
  <label>نام دلخواه</label><input name="name" required>
  <label>توکن ربات</label><input name="token" required>
  <button>بررسی و افزودن</button></form></div>`, "/bots/add"));
});

app.post("/bots/add", requireLogin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const token = String(req.body.token || "").trim();
    if (!name || !token) throw new Error("نام و توکن الزامی است.");
    if (getBotByToken(token)) throw new Error("این ربات قبلاً اضافه شده است.");

    const me = await telegram(token, "getMe");
    const bot = {
      id: makeId(), name, token,
      username: me.username, telegramId: me.id,
      forceJoins: [], updateOffset: 0,
      createdAt: new Date().toISOString()
    };

    db.bots.push(bot);
    ensureBotData(bot);
    saveDB();
    logActivity("ربات اضافه شد: " + name);
    startBotPolling(bot);
    res.redirect("/bots");
  } catch (e) {
    res.status(400).send(`<h2>خطا</h2><p>${esc(e.message)}</p><a href="/bots/add">بازگشت</a>`);
  }
});

app.post("/bots/:id/delete", requireLogin, (req, res) => {
  const bot = getBot(req.params.id);

  if (bot) {
    const state = pollingState.get(bot.id);
    if (state) state.running = false;

    db.bots = db.bots.filter(b => b.id !== bot.id);
    delete db.botUsers[bot.id];
    delete db.commands[bot.id];
    delete db.forceJoinVerified[bot.id];
    saveDB();
    logActivity("ربات حذف شد: " + bot.name);
  }

  res.redirect("/bots");
});

app.get("/bots/:id", requireLogin, (req, res) => {
  const b = getBot(req.params.id);
  if (!b) return res.status(404).send("ربات پیدا نشد.");

  ensureBotData(b);

  res.send(layout("مدیریت ربات", `<h1>🤖 ${esc(b.name)}</h1>
  <div class="card"><p>نام کاربری: @${esc(b.username)}</p>
  <p>کاربران: ${(db.botUsers[b.id] || []).length}</p>
  <p>کانال‌های اجباری: ${b.forceJoins.length}</p>
  <a class="btn" href="/forcejoin?bot=${b.id}">عضویت اجباری</a>
  <a class="btn" href="/commands?bot=${b.id}">دستورات</a>
  <a class="btn" href="/broadcast?bot=${b.id}">ارسال پیام</a></div>`, "/bots"));
});

/* عضویت اجباری */
app.get("/forcejoin", requireLogin, (req, res) => {
  if (!db.bots.length) {
    return res.send(layout("عضویت اجباری", `<h1>🔐 عضویت اجباری</h1>
    <div class="card">ابتدا ربات اضافه کن.</div><a class="btn" href="/bots/add">افزودن ربات</a>`, "/forcejoin"));
  }

  const bot = getBot(String(req.query.bot || "")) || db.bots[0];
  ensureBotData(bot);

  const options = db.bots.map(b =>
    `<option value="${b.id}" ${b.id === bot.id ? "selected" : ""}>${esc(b.name)} (@${esc(b.username)})</option>`
  ).join("");

  const rows = bot.forceJoins.map(j => `<tr>
    <td>${esc(j.title)}</td><td>${esc(j.username)}</td>
    <td><a target="_blank" rel="noopener" href="${esc(j.link)}">باز کردن</a></td>
    <td><form method="post" action="/forcejoin/delete">
      <input type="hidden" name="botId" value="${bot.id}">
      <input type="hidden" name="joinId" value="${j.id}">
      <button class="danger">حذف</button></form></td>
  </tr>`).join("");

  res.send(layout("عضویت اجباری", `<h1>🔐 عضویت اجباری</h1>
  <div class="card"><label>انتخاب ربات</label>
  <select onchange="location.href='/forcejoin?bot='+this.value">${options}</select>
  <p class="muted">ربات باید در تمام کانال‌ها و گروه‌های اجباری ادمین باشد.</p></div>

  <div class="card"><h3>➕ افزودن کانال یا گروه</h3>
  <form method="post" action="/forcejoin/add">
  <input type="hidden" name="botId" value="${bot.id}">
  <label>لینک عمومی یا نام کاربری</label>
  <input name="link" required placeholder="@mychannel یا https://t.me/mychannel">
  <button>بررسی دسترسی و افزودن</button></form></div>

  <div class="card wrap"><h3>📋 کانال‌ها و گروه‌ها</h3>
  <table><tr><th>عنوان</th><th>شناسه</th><th>لینک</th><th>عملیات</th></tr>
  ${rows || "<tr><td colspan='4'>موردی ثبت نشده است.</td></tr>"}</table></div>

  <div class="card"><h3>🧪 آزمایش دسترسی</h3>
  <form method="post" action="/forcejoin/test">
  <input type="hidden" name="botId" value="${bot.id}">
  <button>تست کانال‌ها</button></form></div>`, "/forcejoin"));
});

app.post("/forcejoin/add", requireLogin, async (req, res) => {
  try {
    const bot = getBot(req.body.botId);
    if (!bot) throw new Error("ربات پیدا نشد.");

    ensureBotData(bot);
    if (bot.forceJoins.length >= 5) {
      throw new Error("حداکثر ۵ کانال یا گروه قابل افزودن است.");
    }

    const parsed = parseTelegramLink(req.body.link);

    if (bot.forceJoins.some(j => j.username.toLowerCase() === parsed.username.toLowerCase())) {
      throw new Error("این کانال قبلاً اضافه شده است.");
    }

    const chat = await telegram(bot.token, "getChat", {
      chat_id: parsed.username
    });

    await checkBotAdmin(bot, chat.id);

    bot.forceJoins.push({
      id: makeId(),
      username: parsed.username,
      chatId: chat.id,
      link: parsed.link,
      title: chat.title || parsed.username,
      type: chat.type,
      addedAt: new Date().toISOString()
    });

    saveDB();
    logActivity("عضویت اجباری اضافه شد: " + (chat.title || parsed.username));
    res.redirect("/forcejoin?bot=" + bot.id);
  } catch (e) {
    res.status(400).send(`<h2>افزودن کانال ناموفق بود</h2>
    <p>${esc(e.message)}</p>
    <p>توکن، لینک عمومی و ادمین بودن ربات را بررسی کن.</p>
    <a href="/forcejoin">بازگشت</a>`);
  }
});

app.post("/forcejoin/delete", requireLogin, (req, res) => {
  const bot = getBot(req.body.botId);

  if (bot) {
    ensureBotData(bot);
    bot.forceJoins = bot.forceJoins.filter(j => j.id !== req.body.joinId);

    for (const uid of Object.keys(db.forceJoinVerified[bot.id] || {})) {
      delete db.forceJoinVerified[bot.id][uid][req.body.joinId];
    }

    saveDB();
  }

  res.redirect("/forcejoin?bot=" + encodeURIComponent(req.body.botId || ""));
});

app.post("/forcejoin/test", requireLogin, async (req, res) => {
  const bot = getBot(req.body.botId);
  if (!bot) return res.status(404).send("ربات پیدا نشد.");

  const results = [];

  for (const join of bot.forceJoins) {
    try {
      await checkBotAdmin(bot, join.chatId || join.username);
      results.push(`<li>✅ ${esc(join.title)}: دسترسی ربات درست است.</li>`);
    } catch (e) {
      results.push(`<li>❌ ${esc(join.title)}: ${esc(e.message)}</li>`);
    }
  }

  res.send(layout("تست عضویت", `<h1>🧪 نتیجه آزمایش</h1>
  <div class="card"><ul>${results.join("") || "<li>کانالی ثبت نشده است.</li>"}</ul>
  <a class="btn" href="/forcejoin?bot=${bot.id}">بازگشت</a></div>`, "/forcejoin"));
});

/* مدیریت دستورات */
app.get("/commands", requireLogin, (req, res) => {
  if (!db.bots.length) {
    return res.send(layout("دستورات", "<h1>⚡ دستورات</h1><div class='card'>ابتدا ربات اضافه کن.</div>", "/commands"));
  }

  const bot = getBot(String(req.query.bot || "")) || db.bots[0];
  ensureBotData(bot);

  const options = db.bots.map(b =>
    `<option value="${b.id}" ${b.id === bot.id ? "selected" : ""}>${esc(b.name)}</option>`
  ).join("");

  const rows = db.commands[bot.id].map(c => `<tr>
    <td>${esc(c.command)}</td><td>${esc(c.response)}</td>
    <td><form method="post" action="/commands/delete">
    <input type="hidden" name="botId" value="${bot.id}">
    <input type="hidden" name="commandId" value="${c.id}">
    <button class="danger">حذف</button></form></td></tr>`).join("");

  res.send(layout("مدیریت دستورات", `<h1>⚡ مدیریت دستورات ربات</h1>
  <div class="card"><label>ربات</label>
  <select onchange="location.href='/commands?bot='+this.value">${options}</select>
  <a class="btn" href="/commands/add?bot=${bot.id}">➕ افزودن دستور</a></div>
  <div class="card wrap"><table><tr><th>دستور</th><th>پاسخ</th><th>عملیات</th></tr>
  ${rows || "<tr><td colspan='3'>دستوری ثبت نشده است.</td></tr>"}</table></div>`, "/commands"));
});

app.get("/commands/add", requireLogin, (req, res) => {
  if (!db.bots.length) {
    return res.send(layout("افزودن دستور", "<h1>ابتدا ربات اضافه کن.</h1>", "/commands/add"));
  }

  const bot = getBot(String(req.query.bot || "")) || db.bots[0];

  const options = db.bots.map(b =>
    `<option value="${b.id}" ${b.id === bot.id ? "selected" : ""}>${esc(b.name)}</option>`
  ).join("");

  res.send(layout("افزودن دستور", `<h1>➕ افزودن دستور جدید</h1>
  <div class="card"><form method="post" action="/commands/add">
  <label>ربات</label><select name="botId">${options}</select>
  <label>نام دستور</label><input name="command" required placeholder="/start">
  <label>متن پاسخ</label><textarea name="response"></textarea>
  <button>ذخیره دستور</button></form></div>`, "/commands/add"));
});

app.post("/commands/add", requireLogin, (req, res) => {
  const bot = getBot(req.body.botId);
  if (!bot) return res.status(404).send("ربات پیدا نشد.");

  ensureBotData(bot);

  let command = String(req.body.command || "").trim();
  if (!command.startsWith("/")) command = "/" + command;
  command = command.split(/\s+/)[0];

  if (!/^\/[a-zA-Z0-9_]{1,32}$/.test(command)) {
    return res.status(400).send("نام دستور معتبر نیست.");
  }

  const existing = db.commands[bot.id].find(c => c.command === command);

  if (existing) {
    existing.response = String(req.body.response || "");
  } else {
    db.commands[bot.id].push({
      id: makeId(), command,
      response: String(req.body.response || ""),
      type: "text",
      createdAt: new Date().toISOString()
    });
  }

  saveDB();
  res.redirect("/commands?bot=" + bot.id);
});

app.post("/commands/delete", requireLogin, (req, res) => {
  const bot = getBot(req.body.botId);

  if (bot) {
    ensureBotData(bot);
    db.commands[bot.id] = db.commands[bot.id].filter(c => c.id !== req.body.commandId);
    saveDB();
  }

  res.redirect("/commands?bot=" + encodeURIComponent(req.body.botId || ""));
});

/* مدیریت کاربران */
app.get("/users", requireLogin, (req, res) => {
  const rows = [];

  for (const bot of db.bots) {
    for (const u of db.botUsers[bot.id] || []) {
      rows.push(`<tr><td>${esc(bot.name)}</td><td>${esc(u.first_name)}</td>
      <td>${esc(u.username ? "@" + u.username : "")}</td><td>${esc(u.id)}</td></tr>`);
    }
  }

  res.send(layout("مدیریت کاربران", `<h1>👥 مدیریت کاربران</h1>
  <div class="card wrap"><p>تعداد کاربران ثبت‌شده: ${rows.length}</p>
  <table><tr><th>ربات</th><th>نام</th><th>نام کاربری</th><th>شناسه</th></tr>
  ${rows.join("") || "<tr><td colspan='4'>کاربری ثبت نشده است.</td></tr>"}</table></div>`, "/users"));
});

/* آمار */
app.get("/stats", requireLogin, (req, res) => {
  const users = Object.values(db.botUsers).reduce((s, a) => s + a.length, 0);
  const commands = Object.values(db.commands).reduce((s, a) => s + a.length, 0);
  const joins = db.bots.reduce((s, b) => s + (b.forceJoins || []).length, 0);

  res.send(layout("آمار", `<h1>📊 آمار ربات‌ها و کاربران</h1>
  <div class="grid">
  <div class="card">🤖 ربات‌ها<div class="stat">${db.bots.length}</div></div>
  <div class="card">👥 کاربران<div class="stat">${users}</div></div>
  <div class="card">⚡ دستورات<div class="stat">${commands}</div></div>
  <div class="card">🔐 عضویت اجباری<div class="stat">${joins}</div></div>
  </div>`, "/stats"));
});

/* تست اتصال */
app.get("/bot-test", requireLogin, (req, res) => {
  const options = db.bots.map(b =>
    `<option value="${b.id}">${esc(b.name)} (@${esc(b.username)})</option>`
  ).join("");

  res.send(layout("تست اتصال", `<h1>🧪 تست اتصال ربات</h1>
  <div class="card"><form method="post">
  <label>انتخاب ربات</label><select name="botId" required>${options}</select>
  <button>تست اتصال</button></form></div>`, "/bot-test"));
});

app.post("/bot-test", requireLogin, async (req, res) => {
  const bot = getBot(req.body.botId);
  if (!bot) return res.status(404).send("ربات پیدا نشد.");

  try {
    const me = await telegram(bot.token, "getMe");

    res.send(layout("نتیجه تست", `<h1>🧪 نتیجه تست اتصال</h1>
    <div class="card"><p>✅ اتصال موفق است.</p>
    <p>نام: ${esc(me.first_name)}</p><p>نام کاربری: @${esc(me.username)}</p>
    <p>شناسه: ${esc(me.id)}</p><a class="btn" href="/bot-test">بازگشت</a></div>`, "/bot-test"));
  } catch (e) {
    res.status(400).send(layout("خطای اتصال", `<h1>❌ اتصال ناموفق</h1>
    <div class="card"><p>${esc(e.message)}</p><a class="btn" href="/bot-test">بازگشت</a></div>`, "/bot-test"));
  }
});

/* ارسال پیام همگانی */
app.get("/broadcast", requireLogin, (req, res) => {
  if (!db.bots.length) {
    return res.send(layout("ارسال همگانی", "<h1>ابتدا ربات اضافه کن.</h1>", "/broadcast"));
  }

  const bot = getBot(String(req.query.bot || "")) || db.bots[0];

  const options = db.bots.map(b =>
    `<option value="${b.id}" ${b.id === bot.id ? "selected" : ""}>${esc(b.name)}</option>`
  ).join("");

  res.send(layout("ارسال پیام همگانی", `<h1>📢 ارسال پیام به همه کاربران</h1>
  <div class="card"><form method="post">
  <label>ربات</label><select name="botId">${options}</select>
  <label>نوع پیام</label><select name="type">
  <option value="text">متن</option><option value="photo">عکس با توضیح</option>
  <option value="video">ویدیو با توضیح</option></select>
  <label>متن پیام یا file_id</label><textarea name="content" required></textarea>
  <button>ارسال به همه کاربران</button></form>
  <p class="muted">پیام فقط برای کاربرانی ارسال می‌شود که قبلاً به ربات پیام داده‌اند.</p></div>`, "/broadcast"));
});

app.post("/broadcast", requireLogin, async (req, res) => {
  const bot = getBot(req.body.botId);
  const type = String(req.body.type || "text");
  const content = String(req.body.content || "").trim();

  if (!bot) return res.status(404).send("ربات پیدا نشد.");
  if (!content) return res.status(400).send("محتوای پیام خالی است.");

  const users = [...(db.botUsers[bot.id] || [])];
  let sent = 0, failed = 0;

  for (const user of users) {
    try {
      if (type === "photo") {
        await telegram(bot.token, "sendPhoto", { chat_id: user.id, photo: content });
      } else if (type === "video") {
        await telegram(bot.token, "sendVideo", { chat_id: user.id, video: content });
      } else {
        await telegram(bot.token, "sendMessage", { chat_id: user.id, text: content });
      }
      sent++;
    } catch (e) {
      failed++;

      if (/bot was blocked|user is deactivated|chat not found/i.test(e.message)) {
        db.botUsers[bot.id] = db.botUsers[bot.id].filter(u => String(u.id) !== String(user.id));
      }
    }

    await sleep(40);
  }

  saveDB();

  res.send(layout("نتیجه ارسال", `<h1>📢 نتیجه ارسال همگانی</h1>
  <div class="card"><p>✅ ارسال موفق: ${sent}</p>
  <p>❌ ناموفق: ${failed}</p><p>👥 کاربران اولیه: ${users.length}</p>
  <a class="btn" href="/broadcast?bot=${bot.id}">بازگشت</a></div>`, "/broadcast"));
});

app.get("/creator", requireLogin, (req, res) => {
  res.send(layout("ورود سازنده", `<h1>👑 ورود سازنده</h1>
  <div class="card"><p>برای تغییر رمز ورود، متغیر ADMIN_PASSWORD را در تنظیمات سرویس تنظیم کن.</p>
  <p>برای ماندگاری نشست‌ها، SESSION_SECRET ثابت تنظیم کن.</p></div>`));
});

app.use((req, res) => {
  res.status(404).send(layout("صفحه پیدا نشد", `<div class="card">
  <h1>صفحه پیدا نشد</h1><a class="btn" href="/">🏠 صفحه اصلی</a></div>`));
});

app.listen(PORT, () => {
  console.log("Server listening on port " + PORT);

  for (const bot of db.bots) {
    ensureBotData(bot);
    startBotPolling(bot);
  }

  saveDB();
});
