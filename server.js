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
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      db = JSON.parse(raw);

      db.bots = Array.isArray(db.bots) ? db.bots : [];
      db.users = db.users || {};
      db.commands = db.commands || {};
    }
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
    secret: process.env.SESSION_SECRET || "nova-proxy-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

function escapeHtml(text) {
  return String(text || "")
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

async function telegram(method, params = {}) {
  const token = params.token;

  if (!token) {
    throw new Error("توکن ربات وارد نشده است.");
  }

  const body = { ...params };
  delete body.token;

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
    throw new Error(data.description || "Telegram API Error");
  }

  return data.result;
}

async function getBotInfo(token) {
  return await telegram("getMe", {
    token
  });
}

function botUsers(botId) {
  if (!db.users[botId]) {
    db.users[botId] = {};
  }

  return db.users[botId];
}

function botCommands(botId) {
  if (!db.commands[botId]) {
    db.commands[botId] = {};
  }

  return db.commands[botId];
}

async function sendToUser(token, chatId, text) {
  return await telegram("sendMessage", {
    token,
    chat_id: chatId,
    text
  });
}

async function processUpdate(bot, update) {
  if (!update.message) return;

  const message = update.message;
  const chat = message.chat;

  if (!chat || !chat.id) return;

  const users = botUsers(bot.id);

  users[String(chat.id)] = {
    telegram_id: chat.id,
    username: chat.username || "",
    first_name: chat.first_name || "",
    last_name: chat.last_name || "",
    active: true,
    updated_at: Date.now()
  };

  saveData();

  const text = message.text || "";

  if (!text.startsWith("/")) {
    return;
  }

  const command = text
    .split(/\s+/)[0]
    .split("@")[0]
    .toLowerCase();

  const commands = botCommands(bot.id);

  if (commands[command]) {
    try {
      await sendToUser(
        bot.token,
        chat.id,
        commands[command]
      );
    } catch (e) {
      console.log("خطا در ارسال پاسخ:", e.message);
    }

    return;
  }

  if (command === "/start") {
    try {
      await sendToUser(
        bot.token,
        chat.id,
        "سلام 👋\n\nبه ربات خوش آمدید.\nشما با موفقیت ثبت شدید. ✅"
      );
    } catch (e) {
      console.log("خطا در /start:", e.message);
    }
  }
}

const polling = {};

async function startBot(bot) {
  if (!bot || !bot.token) return;

  if (polling[bot.id]) {
    return;
  }

  polling[bot.id] = true;

  try {
    await telegram("deleteWebhook", {
      token: bot.token,
      drop_pending_updates: false
    });
  } catch (e) {
    console.log(
      `Webhook ${bot.name}:`,
      e.message
    );
  }

  let offset = bot.offset || 0;

  console.log(`Polling شروع شد: ${bot.name}`);

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        token: bot.token,
        offset,
        timeout: 30,
        allowed_updates: ["message"]
      });

      for (const update of updates) {
        offset = update.update_id + 1;

        bot.offset = offset;
        saveData();

        try {
          await processUpdate(bot, update);
        } catch (e) {
          console.log(
            `خطای پردازش ${bot.name}:`,
            e.message
          );
        }
      }
    } catch (e) {
      console.log(
        `خطای polling ${bot.name}:`,
        e.message
      );

      await new Promise(resolve =>
        setTimeout(resolve, 5000)
      );
    }
  }
}

function startAllBots() {
  for (const bot of db.bots) {
    startBot(bot);
  }
}

function page(title, content) {
  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${escapeHtml(title)}</title>

<style>

*{
box-sizing:border-box;
}

body{
margin:0;
font-family:Tahoma,Arial,sans-serif;
background:
linear-gradient(
rgba(4,20,45,.72),
rgba(2,12,30,.88)
),
url("https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=2000&q=80")
center/cover fixed;
color:#fff;
min-height:100vh;
}

body:before{
content:"";
position:fixed;
inset:0;
background:rgba(0,30,70,.15);
backdrop-filter:blur(2px);
pointer-events:none;
}

.container{
position:relative;
z-index:2;
max-width:1150px;
margin:auto;
padding:25px 15px 50px;
}

.top{
display:flex;
justify-content:space-between;
align-items:center;
gap:15px;
margin-bottom:25px;
}

.logo{
font-size:25px;
font-weight:bold;
}

.logo span{
color:#55b7ff;
}

.card{
background:rgba(8,29,58,.78);
border:1px solid rgba(255,255,255,.12);
border-radius:22px;
padding:22px;
margin-bottom:20px;
box-shadow:0 15px 50px rgba(0,0,0,.3);
backdrop-filter:blur(15px);
}

h1,h2,h3{
margin-top:0;
}

.grid{
display:grid;
grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
gap:16px;
}

.stat{
padding:22px;
border-radius:18px;
background:rgba(25,100,180,.2);
border:1px solid rgba(100,190,255,.18);
}

.stat-number{
font-size:32px;
font-weight:bold;
color:#63c5ff;
margin-top:8px;
}

input,textarea,select{
width:100%;
padding:14px;
border-radius:13px;
border:1px solid rgba(255,255,255,.15);
background:rgba(0,0,0,.25);
color:#fff;
outline:none;
margin:7px 0 14px;
font-family:inherit;
}

textarea{
min-height:130px;
resize:vertical;
}

input::placeholder,
textarea::placeholder{
color:#aebdce;
}

button,.btn{
display:inline-block;
border:0;
border-radius:13px;
padding:12px 18px;
background:#1597ee;
color:white;
font-weight:bold;
cursor:pointer;
text-decoration:none;
margin:4px;
}

button:hover,.btn:hover{
background:#087dce;
}

.danger{
background:#d83c52;
}

.danger:hover{
background:#b9253c;
}

.success{
background:#159b72;
}

.gray{
background:#46566b;
}

.bot{
border:1px solid rgba(255,255,255,.12);
border-radius:18px;
padding:18px;
margin-bottom:15px;
background:rgba(255,255,255,.035);
}

.bot-title{
font-size:20px;
font-weight:bold;
margin-bottom:8px;
}

.muted{
color:#aebdce;
font-size:13px;
}

.badge{
display:inline-block;
padding:5px 10px;
border-radius:30px;
background:rgba(0,180,120,.15);
color:#55e0ae;
font-size:12px;
}

.badge.off{
background:rgba(220,50,70,.15);
color:#ff7182;
}

table{
width:100%;
border-collapse:collapse;
margin-top:15px;
}

th,td{
padding:12px 8px;
border-bottom:1px solid rgba(255,255,255,.1);
text-align:right;
}

.login{
max-width:430px;
margin:90px auto;
}

.center{
text-align:center;
}

.small{
font-size:12px;
color:#9eb0c5;
}

hr{
border:0;
border-top:1px solid rgba(255,255,255,.1);
margin:20px 0;
}

@media(max-width:600px){

.container{
padding:15px 10px 40px;
}

.top{
align-items:flex-start;
}

.logo{
font-size:20px;
}

.card{
padding:16px;
border-radius:18px;
}

button,.btn{
width:100%;
margin:4px 0;
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

/* LOGIN */

app.get("/login", (req, res) => {

  if (req.session.loggedIn) {
    return res.redirect("/");
  }

  res.send(
    page(
      "ورود مدیریت",
      `
      <div class="card login">

        <div class="center">

          <div style="font-size:55px">🤖</div>

          <h1>پنل مدیریت ربات‌ها</h1>

          <p class="muted">
          ورود مدیر اصلی
          </p>

        </div>

        <form method="POST" action="/login">

          <label>رمز عبور</label>

          <input
            type="password"
            name="password"
            placeholder="رمز عبور را وارد کنید"
            required
          >

          <button type="submit">
          🔐 ورود به پنل
          </button>

        </form>

      </div>
      `
    )
  );
});

app.post("/login", (req, res) => {

  if (req.body.password === ADMIN_PASSWORD) {

    req.session.loggedIn = true;

    return res.redirect("/");
  }

  res.send(
    page(
      "خطا",
      `
      <div class="card login center">

        <h2>❌ رمز عبور اشتباه است</h2>

        <a class="btn" href="/login">
        بازگشت
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

/* DASHBOARD */

app.get("/", requireLogin, (req, res) => {

  let totalUsers = 0;

  for (const botId of Object.keys(db.users)) {
    totalUsers += Object.keys(db.users[botId]).length;
  }

  const activeBots = db.bots.length;

  res.send(
    page(
      "مدیریت ربات‌های تلگرام",
      `

      <div class="top">

        <div class="logo">
        🤖 <span>نوا</span> پنل مدیریت
        </div>

        <a class="btn gray" href="/logout">
        خروج
        </a>

      </div>

      <div class="grid">

        <div class="stat">

          <div>🤖 تعداد ربات‌ها</div>

          <div class="stat-number">
          ${activeBots}
          </div>

        </div>

        <div class="stat">

          <div>👥 کل کاربران</div>

          <div class="stat-number">
          ${totalUsers}
          </div>

        </div>

      </div>

      <br>

      <div class="card">

        <h2>➕ افزودن ربات جدید</h2>

        <p class="muted">
        توکن ربات را از BotFather دریافت و اینجا وارد کنید.
        </p>

        <form method="POST" action="/bots/add">

          <label>توکن ربات</label>

          <input
            type="text"
            name="token"
            placeholder="123456789:AA..."
            required
          >

          <button type="submit">
          ➕ افزودن ربات
          </button>

        </form>

      </div>

      <div class="card">

        <h2>🤖 ربات‌های شما</h2>

        ${
          db.bots.length === 0
            ? `
            <p class="muted">
            هنوز هیچ رباتی اضافه نشده است.
            </p>
            `
            : db.bots
                .map(bot => {

                  const users = botUsers(bot.id);

                  const count = Object.keys(users).length;

                  const commands =
                    Object.keys(
                      botCommands(bot.id)
                    ).length;

                  return `

                  <div class="bot">

                    <div class="bot-title">
                    🤖 ${escapeHtml(bot.name)}
                    </div>

                    <div class="muted">
                    @${escapeHtml(bot.username || "")}
                    </div>

                    <br>

                    <span class="badge">
                    فعال
                    </span>

                    <p>
                    👥 کاربران:
                    <b>${count}</b>
                    <br>
                    ⚡ دستورات:
                    <b>${commands}</b>
                    </p>

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
                      onsubmit="return confirm('این ربات و اطلاعات کاربرانش حذف شود؟')"
                    >

                      <input
                        type="hidden"
                        name="id"
                        value="${escapeHtml(bot.id)}"
                      >

                      <button
                        class="danger"
                        type="submit"
                      >
                      🗑 حذف ربات
                      </button>

                    </form>

                  </div>

                  `;

                })
                .join("")
        }

      </div>

      `
    )
  );
});

/* ADD BOT */

app.post("/bots/add", requireLogin, async (req, res) => {

  const token = String(req.body.token || "").trim();

  if (!token) {
    return res.redirect("/");
  }

  try {

    const info = await getBotInfo(token);

    const exists = db.bots.find(
      b => b.token === token
    );

    if (exists) {
      return res.send(
        page(
          "خطا",
          `
          <div class="card center">

          <h2>⚠️ این ربات قبلاً اضافه شده است.</h2>

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
          .slice(2, 8),

      token,

      name:
        info.first_name ||
        info.username ||
        "ربات",

      username:
        info.username || "",

      offset: 0,

      created_at: Date.now()

    };

    db.bots.push(bot);

    db.users[bot.id] = {};
    db.commands[bot.id] = {};

    saveData();

    startBot(bot);

    res.redirect("/");

  } catch (e) {

    res.send(
      page(
        "خطا",
        `
        <div class="card">

        <h2>❌ توکن ربات معتبر نیست</h2>

        <p>
        خطای تلگرام:
        </p>

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

});

/* DELETE BOT */

app.post("/bots/delete", requireLogin, (req, res) => {

  const id = String(req.body.id);

  db.bots = db.bots.filter(
    bot => bot.id !== id
  );

  delete db.users[id];
  delete db.commands[id];

  saveData();

  delete polling[id];

  res.redirect("/");

});

/* BOT PAGE */

app.get("/bot/:id", requireLogin, (req, res) => {

  const bot = db.bots.find(
    b => b.id === req.params.id
  );

  if (!bot) {
    return res.redirect("/");
  }

  const users = botUsers(bot.id);

  const commands = botCommands(bot.id);

  const userList = Object.values(users);

  res.send(
    page(
      `مدیریت ${bot.name}`,
      `

      <div class="top">

        <div class="logo">
        🤖 ${escapeHtml(bot.name)}
        </div>

        <a class="btn gray" href="/">
        ← بازگشت
        </a>

      </div>

      <div class="card">

        <h2>
        👤 اطلاعات ربات
        </h2>

        <p>
        نام:
        <b>${escapeHtml(bot.name)}</b>
        </p>

        <p>
        نام کاربری:
        <b>@${escapeHtml(bot.username)}</b>
        </p>

        <p>
        تعداد کاربران:
        <b>${userList.length}</b>
        </p>

      </div>

      <div class="card">

        <h2>📢 ارسال پیام همگانی</h2>

        <form method="POST" action="/bot/${bot.id}/broadcast">

          <textarea
            name="text"
            placeholder="متن پیام را بنویسید..."
            required
          ></textarea>

          <button type="submit">
          📢 ارسال برای همه کاربران
          </button>

        </form>

      </div>

      <div class="card">

        <h2>⚡ ساخت دستور جدید</h2>

        <p class="muted">
        مثال: دستور <b>/help</b> بساز و برای آن پاسخ تعیین کن.
        </p>

        <form method="POST" action="/bot/${bot.id}/command">

          <label>دستور</label>

          <input
            name="command"
            placeholder="/help"
            required
          >

          <label>پاسخ دستور</label>

          <textarea
            name="reply"
            placeholder="متن پاسخی که ربات ارسال می‌کند..."
            required
          ></textarea>

          <button type="submit">
          ➕ ذخیره دستور
          </button>

        </form>

        <hr>

        <h3>دستورات فعلی</h3>

        ${
          Object.keys(commands).length === 0
            ? `<p class="muted">هنوز دستوری ساخته نشده.</p>`
            : Object.keys(commands)
                .map(cmd => `

                  <div class="bot">

                    <b>
                    ${escapeHtml(cmd)}
                    </b>

                    <p class="muted">
                    ${escapeHtml(commands[cmd])}
                    </p>

                    <form
                      method="POST"
                      action="/bot/${bot.id}/command/delete"
                    >

                      <input
                        type="hidden"
                        name="command"
                        value="${escapeHtml(cmd)}"
                      >

                      <button class="danger">
                      🗑 حذف
                      </button>

                    </form>

                  </div>

                `)
                .join("")
        }

      </div>

      <div class="card">

        <h2>👥 کاربران ربات</h2>

        ${
          userList.length === 0
            ? `
            <p class="muted">
            هنوز کاربری ثبت نشده است.
            </p>
            `
            : `

            <div style="overflow:auto">

            <table>

            <tr>
              <th>کاربر</th>
              <th>شناسه</th>
              <th>وضعیت</th>
              <th>عملیات</th>
            </tr>

            ${userList
              .map(user => `

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
                    ? `
                    <span class="badge">
                    فعال
                    </span>
                    `
                    : `
                    <span class="badge off">
                    غیرفعال
                    </span>
                    `
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
                        ? "غیرفعال کردن"
                        : "فعال کردن"
                    }
                    </button>

                  </form>

                </td>

              </tr>

              `)
              .join("")}

            </table>

            </div>

            `
        }

      </div>

      `
    )
  );
});

/* ADD COMMAND */

app.post(
  "/bot/:id/command",
  requireLogin,
  (req, res) => {

    const bot = db.bots.find(
      b => b.id === req.params.id
    );

    if (!bot) {
      return res.redirect("/");
    }

    let command = String(
      req.body.command || ""
    ).trim();

    const reply = String(
      req.body.reply || ""
    ).trim();

    if (!command.startsWith("/")) {
      command = "/" + command;
    }

    command = command
      .split(/\s+/)[0]
      .split("@")[0]
      .toLowerCase();

    if (!reply) {
      return res.redirect(
        `/bot/${bot.id}`
      );
    }

    botCommands(bot.id)[command] = reply;

    saveData();

    res.redirect(
      `/bot/${bot.id}`
    );
  }
);

/* DELETE COMMAND */

app.post(
  "/bot/:id/command/delete",
  requireLogin,
  (req, res) => {

    const command =
      String(req.body.command || "");

    delete botCommands(
      req.params.id
    )[command];

    saveData();

    res.redirect(
      `/bot/${req.params.id}`
    );
  }
);

/* TOGGLE USER */

app.post(
  "/bot/:id/user/toggle",
  requireLogin,
  (req, res) => {

    const telegramId =
      String(req.body.telegram_id);

    const users =
      botUsers(req.params.id);

    if (users[telegramId]) {

      users[telegramId].active =
        !users[telegramId].active;

    }

    saveData();

    res.redirect(
      `/bot/${req.params.id}`
    );
  }
);

/* BROADCAST */

app.post(
  "/bot/:id/broadcast",
  requireLogin,
  async (req, res) => {

    const bot = db.bots.find(
      b => b.id === req.params.id
    );

    if (!bot) {
      return res.redirect("/");
    }

    const text =
      String(req.body.text || "").trim();

    if (!text) {
      return res.redirect(
        `/bot/${bot.id}`
      );
    }

    const users =
      Object.values(
        botUsers(bot.id)
      );

    let success = 0;
    let failed = 0;

    for (const user of users) {

      if (!user.active) {
        continue;
      }

      try {

        await sendToUser(
          bot.token,
          user.telegram_id,
          text
        );

        success++;

      } catch (e) {

        failed++;

        if (
          e.message.includes("bot was blocked") ||
          e.message.includes("user is deactivated") ||
          e.message.includes("chat not found")
        ) {

          user.active = false;

        }

      }

      await new Promise(
        resolve =>
          setTimeout(resolve, 80)
      );

    }

    saveData();

    res.send(
      page(
        "نتیجه ارسال",
        `

        <div class="card center">

          <div style="font-size:60px">
          📢
          </div>

          <h2>
          ارسال پیام تمام شد
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
          ← بازگشت به ربات
          </a>

        </div>

        `
      )
    );

  }
);

/* START */

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

  startAllBots();

});
