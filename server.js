const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";
const SESSION_SECRET =
    process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    name: "admin_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "data.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

            return {
                bots: Array.isArray(data.bots) ? data.bots : [],
                users: data.users || {},
                commands: data.commands || {},
                messages: data.messages || {}
            };
        }
    } catch (error) {
        console.error("Database error:", error.message);
    }

    return { bots: [], users: {}, commands: {}, messages: {} };
}

let db = loadDB();

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[ch]);
}

function id() {
    return crypto.randomBytes(8).toString("hex");
}

function findBot(botId) {
    return db.bots.find(bot => bot.id === botId);
}

function telegramRequest(token, method, data = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);

        const req = https.request({
            hostname: "api.telegram.org",
            path: `/bot${token}/${method}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            },
            timeout: 20000
        }, response => {
            let result = "";

            response.on("data", chunk => result += chunk);
            response.on("end", () => {
                try {
                    const parsed = JSON.parse(result);

                    if (parsed.ok) resolve(parsed.result);
                    else reject(new Error(parsed.description || "Telegram error"));
                } catch {
                    reject(new Error("Invalid Telegram response"));
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("Telegram timeout")));
        req.write(body);
        req.end();
    });
}

function sendMessage(token, chatId, text, extra = {}) {
    return telegramRequest(token, "sendMessage", {
        chat_id: chatId,
        text,
        ...extra
    });
}

function requireLogin(req, res, next) {
    if (!req.session.loggedIn) {
        return res.redirect("/login");
    }
    next();
}

function botOptions(selected = "") {
    return db.bots.map(bot => `
        <option value="${escapeHTML(bot.id)}"
        ${bot.id === selected ? "selected" : ""}>
        ${escapeHTML(bot.name)}
        </option>
    `).join("");
}

function page(title, content, active = "") {
    const links = [
        ["/", "🏠 بازگشت به صفحه اصلی"],
        ["/bots", "🤖 مدیریت ربات‌ها"],
        ["/bots/add", "➕ افزودن ربات جدید"],
        ["/commands", "⚡ مدیریت دستورات ربات"],
        ["/commands/add", "➕ افزودن دستور جدید"],
        ["/broadcast", "📢 ارسال پیام به همه کاربران"],
        ["/users", "👥 مدیریت کاربران"],
        ["/stats", "📊 آمار ربات‌ها و کاربران"],
        ["/test", "🧪 تست اتصال ربات"],
        ["/refresh", "🔄 بروزرسانی صفحه"],
        ["/creator", "👑 ورود سازنده"],
        ["/logout", "🚪 خروج از حساب"]
    ];

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f1f5f9;color:#1e293b;font-family:Tahoma,Arial}
header{background:#111827;color:white;padding:20px;font-size:20px}
.layout{display:flex;min-height:calc(100vh - 60px)}
aside{width:260px;background:#172033;padding:14px;flex-shrink:0}
aside a{display:block;text-decoration:none;color:#dbeafe;padding:13px 10px;
margin:4px 0;border-radius:9px;font-size:13px}
aside a:hover,aside a.active{background:#2563eb;color:white}
main{padding:24px;width:100%;min-width:0}
.card{background:white;padding:20px;border-radius:13px;margin-bottom:18px;
box-shadow:0 3px 12px #00000008;overflow-x:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.stat{font-size:27px;font-weight:bold;color:#2563eb;margin-top:12px}
input,select,textarea{width:100%;padding:12px;margin:7px 0 15px;
border:1px solid #d1d5db;border-radius:8px;font-family:inherit}
textarea{min-height:100px}
button,.btn{display:inline-block;border:0;background:#2563eb;color:white;
padding:11px 15px;border-radius:8px;cursor:pointer;text-decoration:none;
font-family:inherit;font-size:13px;margin:3px}
.danger{background:#dc2626}.green{background:#059669}.gray{background:#64748b}
table{border-collapse:collapse;width:100%;min-width:500px}
th,td{text-align:right;padding:12px;border-bottom:1px solid #e5e7eb;font-size:13px}
th{background:#f8fafc}
small{color:#64748b}
@media(max-width:800px){.layout{display:block}aside{width:100%}
aside a{display:inline-block;padding:10px}main{padding:12px}}
</style>
</head>
<body>
<header>پنل مدیریت ربات‌های تلگرام</header>
<div class="layout">
<aside>${links.map(link => `
<a class="${active === link[0] ? "active" : ""}"
href="${link[0]}">${link[1]}</a>`).join("")}</aside>
<main><h2>${escapeHTML(title)}</h2>${content}</main>
</div>
</body>
</html>`;
}

// ورود مدیر
app.get("/login", (req, res) => {
    if (req.session.loggedIn) return res.redirect("/");

    res.send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ورود به پنل</title>
<style>
body{font-family:Tahoma;background:#eef2f8;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0}
form{background:white;padding:30px;border-radius:15px;width:90%;max-width:380px}
input,button{width:100%;padding:13px;margin-top:12px;box-sizing:border-box;
border-radius:8px;border:1px solid #ddd;font-family:inherit}
button{background:#2563eb;color:white;border:0;cursor:pointer}
</style></head>
<body><form method="post" action="/login">
<h2>ورود به پنل مدیریت</h2>
<p>رمز عبور مدیر را وارد کنید.</p>
<input type="password" name="password" placeholder="رمز عبور" required autofocus>
<button type="submit">ورود</button>
</form></body></html>`);
});

app.post("/login", (req, res, next) => {
    const supplied = String(req.body.password || "");

    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(ADMIN_PASSWORD);

    const valid =
        suppliedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);

    if (!valid) {
        return res.status(401).send(
            "رمز عبور اشتباه است. <a href='/login'>تلاش دوباره</a>"
        );
    }

    // ایجاد نشست جدید پس از ورود موفق
    req.session.regenerate(error => {
        if (error) return next(error);

        req.session.loggedIn = true;
        req.session.loginTime = Date.now();

        req.session.save(error => {
            if (error) return next(error);
            res.redirect("/");
        });
    });
});

// خروج از حساب
app.get("/logout", (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);

        res.clearCookie("admin_session");
        res.redirect("/login");
    });
});

// صفحه اصلی
app.get("/", requireLogin, (req, res) => {
    const totalUsers = Object.values(db.users)
        .reduce((total, users) => total + Object.keys(users).length, 0);

    const totalCommands = Object.values(db.commands)
        .reduce((total, commands) => total + commands.length, 0);

    const content = `
    <div class="grid">
        <div class="card">🤖 تعداد ربات‌ها<div class="stat">${db.bots.length}</div></div>
        <div class="card">👥 تعداد کاربران<div class="stat">${totalUsers}</div></div>
        <div class="card">⚡ تعداد دستورات<div class="stat">${totalCommands}</div></div>
    </div>
    <div class="card">
        <h3>خوش آمدید 👋</h3>
        <p>برای مدیریت ربات‌ها از منوی کناری استفاده کنید.</p>
        <small>آخرین بروزرسانی صفحه: ${new Date().toLocaleString("fa-IR")}</small>
    </div>`;

    res.send(page("🏠 صفحه اصلی", content, "/"));
});

// فهرست ربات‌ها
app.get("/bots", requireLogin, (req, res) => {
    const rows = db.bots.map(bot => `
    <tr>
        <td>${escapeHTML(bot.name)}</td>
        <td>${escapeHTML(bot.username || "نامشخص")}</td>
        <td>${bot.running ? "🟢 فعال" : "⚪ متوقف"}</td>
        <td>
            <form method="post" action="/bots/delete" style="display:inline">
                <input type="hidden" name="id" value="${escapeHTML(bot.id)}">
                <button class="danger" onclick="return confirm('حذف شود؟')">حذف</button>
            </form>
            <form method="post" action="/bots/restart" style="display:inline">
                <input type="hidden" name="id" value="${escapeHTML(bot.id)}">
                <button class="green">راه‌اندازی مجدد</button>
            </form>
        </td>
    </tr>`).join("");

    res.send(page("🤖 مدیریت ربات‌ها", `
    <div class="card">
    <a class="btn" href="/bots/add">➕ افزودن ربات</a>
    <table><thead><tr><th>نام</th><th>نام کاربری</th><th>وضعیت</th><th>عملیات</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='4'>هنوز رباتی اضافه نشده است.</td></tr>"}</tbody>
    </table></div>`, "/bots"));
});

// افزودن ربات
app.get("/bots/add", requireLogin, (req, res) => {
    res.send(page("➕ افزودن ربات جدید", `
    <div class="card"><form method="post" action="/bots/add">
    <label>نام ربات</label><input name="name" required>
    <label>توکن BotFather</label><input name="token" required>
    <button>افزودن ربات</button>
    </form></div>`, "/bots/add"));
});

app.post("/bots/add", requireLogin, async (req, res) => {
    const name = String(req.body.name || "").trim();
    const token = String(req.body.token || "").trim();

    if (!name || !token) return res.status(400).send("نام و توکن الزامی است.");

    if (db.bots.some(bot => bot.token === token)) {
        return res.status(400).send("این ربات قبلاً اضافه شده است.");
    }

    try {
        const info = await telegramRequest(token, "getMe");

        const bot = {
            id: id(),
            name,
            token,
            username: info.username || "",
            offset: 0,
            running: false,
            stopRequested: false
        };

        db.bots.push(bot);
        db.users[bot.id] = {};
        db.commands[bot.id] = [];
        db.messages[bot.id] = [];
        saveDB();

        startBotPolling(bot);
        res.redirect("/bots");
    } catch (error) {
        res.status(400).send(
            `اتصال ناموفق: ${escapeHTML(error.message)} <a href="/bots/add">بازگشت</a>`
        );
    }
});

app.post("/bots/delete", requireLogin, (req, res) => {
    const bot = findBot(String(req.body.id || ""));
    if (!bot) return res.redirect("/bots");

    bot.stopRequested = true;
    bot.running = false;

    db.bots = db.bots.filter(item => item.id !== bot.id);
    delete db.users[bot.id];
    delete db.commands[bot.id];
    delete db.messages[bot.id];

    saveDB();
    res.redirect("/bots");
});

app.post("/bots/restart", requireLogin, (req, res) => {
    const bot = findBot(String(req.body.id || ""));

    if (bot) {
        bot.stopRequested = true;
        bot.running = false;
        saveDB();

        setTimeout(() => {
            const current = findBot(bot.id);
            if (current) {
                current.stopRequested = false;
                startBotPolling(current);
            }
        }, 1000);
    }

    res.redirect("/bots");
});

// مدیریت دستورات
app.get("/commands", requireLogin, (req, res) => {
    const selected = String(req.query.bot || db.bots[0]?.id || "");
    const commands = db.commands[selected] || [];

    const rows = commands.map((command, index) => `
    <tr>
        <td>${escapeHTML(command.command)}</td>
        <td>${escapeHTML(command.response)}</td>
        <td><form method="post" action="/commands/delete">
            <input type="hidden" name="bot" value="${escapeHTML(selected)}">
            <input type="hidden" name="index" value="${index}">
            <button class="danger">حذف</button>
        </form></td>
    </tr>`).join("");

    res.send(page("⚡ مدیریت دستورات ربات", `
    <div class="card">
    <form method="get" action="/commands">
    <label>انتخاب ربات</label>
    <select name="bot">${botOptions(selected)}</select>
    <button>نمایش دستورات</button>
    </form>
    <a class="btn" href="/commands/add">➕ افزودن دستور</a>
    <table><thead><tr><th>دستور</th><th>پاسخ</th><th>عملیات</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='3'>دستوری ثبت نشده است.</td></tr>"}</tbody></table>
    </div>`, "/commands"));
});

app.get("/commands/add", requireLogin, (req, res) => {
    res.send(page("➕ افزودن دستور جدید", `
    <div class="card"><form method="post" action="/commands/add">
    <label>ربات</label><select name="bot" required>${botOptions()}</select>
    <label>نام دستور</label><input name="command" placeholder="/help" required>
    <label>متن پاسخ</label><textarea name="response" required></textarea>
    <button>ذخیره دستور</button>
    </form></div>`, "/commands/add"));
});

app.post("/commands/add", requireLogin, (req, res) => {
    const bot = findBot(String(req.body.bot || ""));
    let command = String(req.body.command || "").trim();
    const response = String(req.body.response || "").trim();

    if (!bot || !command || !response) {
        return res.status(400).send("تمام فیلدها را تکمیل کنید.");
    }

    if (!command.startsWith("/")) command = "/" + command;
    command = command.split(/\s+/)[0];

    db.commands[bot.id] ||= [];
    db.commands[bot.id].push({ command, response });
    saveDB();

    res.redirect("/commands?bot=" + encodeURIComponent(bot.id));
});

app.post("/commands/delete", requireLogin, (req, res) => {
    const botId = String(req.body.bot || "");
    const index = Number(req.body.index);

    if (db.commands[botId] && Number.isInteger(index)) {
        db.commands[botId].splice(index, 1);
        saveDB();
    }

    res.redirect("/commands?bot=" + encodeURIComponent(botId));
});

// کاربران
app.get("/users", requireLogin, (req, res) => {
    const selected = String(req.query.bot || db.bots[0]?.id || "");
    const users = Object.values(db.users[selected] || {});

    const rows = users.map(user => `
    <tr>
        <td>${escapeHTML(user.id)}</td>
        <td>${escapeHTML(user.first_name || "")}</td>
        <td>${escapeHTML(user.username ? "@" + user.username : "ندارد")}</td>
        <td>${escapeHTML(user.last_seen || "")}</td>
    </tr>`).join("");

    res.send(page("👥 مدیریت کاربران", `
    <div class="card">
    <form method="get" action="/users">
    <label>انتخاب ربات</label><select name="bot">${botOptions(selected)}</select>
    <button>نمایش کاربران</button>
    </form>
    <table><thead><tr><th>شناسه</th><th>نام</th><th>نام کاربری</th><th>آخرین فعالیت</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='4'>کاربری ثبت نشده است.</td></tr>"}</tbody></table>
    </div>`, "/users"));
});

// ارسال پیام همگانی
app.get("/broadcast", requireLogin, (req, res) => {
    res.send(page("📢 ارسال پیام به همه کاربران", `
    <div class="card"><form method="post" action="/broadcast">
    <label>ربات</label><select name="bot" required>${botOptions()}</select>
    <label>متن پیام</label><textarea name="text" required></textarea>
    <button class="green">ارسال پیام همگانی</button>
    </form></div>`, "/broadcast"));
});

app.post("/broadcast", requireLogin, async (req, res) => {
    const bot = findBot(String(req.body.bot || ""));
    const message = String(req.body.text || "").trim();

    if (!bot || !message) return res.status(400).send("اطلاعات ناقص است.");

    let success = 0;
    let failed = 0;
    const users = Object.values(db.users[bot.id] || {});

    for (const user of users) {
        try {
            await sendMessage(bot.token, user.id, message);
            success++;
        } catch {
            failed++;
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    res.send(page("نتیجه ارسال", `
    <div class="card">
    <p>✅ ارسال موفق: ${success}</p>
    <p>❌ ارسال ناموفق: ${failed}</p>
    <a class="btn" href="/broadcast">بازگشت</a>
    </div>`, "/broadcast"));
});

// آمار
app.get("/stats", requireLogin, (req, res) => {
    const rows = db.bots.map(bot => `
    <tr>
        <td>${escapeHTML(bot.name)}</td>
        <td>${Object.keys(db.users[bot.id] || {}).length}</td>
        <td>${(db.commands[bot.id] || []).length}</td>
        <td>${bot.running ? "فعال" : "متوقف"}</td>
    </tr>`).join("");

    res.send(page("📊 آمار ربات‌ها و کاربران", `
    <div class="card"><table>
    <thead><tr><th>ربات</th><th>کاربران</th><th>دستورات</th><th>وضعیت</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='4'>رباتی اضافه نشده است.</td></tr>"}</tbody>
    </table></div>`, "/stats"));
});

// تست اتصال
app.get("/test", requireLogin, (req, res) => {
    res.send(page("🧪 تست اتصال ربات", `
    <div class="card"><form method="post" action="/test">
    <label>انتخاب ربات</label><select name="bot" required>${botOptions()}</select>
    <button>بررسی اتصال</button>
    </form></div>`, "/test"));
});

app.post("/test", requireLogin, async (req, res) => {
    const bot = findBot(String(req.body.bot || ""));
    let result = "ربات پیدا نشد.";

    if (bot) {
        try {
            const info = await telegramRequest(bot.token, "getMe");
            result = `اتصال موفق است؛ نام ربات: ${info.first_name}، شناسه: ${info.id}`;
        } catch (error) {
            result = "اتصال ناموفق: " + error.message;
        }
    }

    res.send(page("نتیجه تست اتصال", `
    <div class="card">${escapeHTML(result)}<br>
    <a class="btn" href="/test">بازگشت</a></div>`, "/test"));
});

// بخش سازنده
app.get("/creator", requireLogin, (req, res) => {
    res.send(page("👑 ورود سازنده", `
    <div class="card">
    <h3>بخش سازنده</h3>
    <p>این بخش برای اطلاعات سازنده پنل آماده است.</p>
    </div>`, "/creator"));
});

app.get("/refresh", requireLogin, (req, res) => {
    res.redirect("/");
});

// پردازش پیام‌های ربات
const polling = new Set();

async function handleUpdate(bot, update) {
    if (!update.message) {
        if (update.callback_query) {
            try {
                await telegramRequest(bot.token, "answerCallbackQuery", {
                    callback_query_id: update.callback_query.id
                });
            } catch {}
        }
        return;
    }

    const message = update.message;
    if (!message.chat || message.chat.type !== "private" || !message.from) return;

    const userId = String(message.from.id);

    db.users[bot.id] ||= {};
    db.users[bot.id][userId] = {
        id: userId,
        first_name: message.from.first_name || "",
        username: message.from.username || "",
        last_seen: new Date().toISOString()
    };
    saveDB();

    const text = String(message.text || "").trim();
    if (!text.startsWith("/")) return;

    const command = text.split(/\s+/)[0]
        .replace(/@[\w_]+$/, "")
        .toLowerCase();

    const found = (db.commands[bot.id] || [])
        .find(item => item.command.toLowerCase() === command);

    if (found) {
        await sendMessage(bot.token, message.chat.id, found.response);
    } else if (command === "/start") {
        await sendMessage(bot.token, message.chat.id, "سلام! 👋\nبه ربات خوش آمدید.");
    }
}

async function startBotPolling(bot) {
    if (!bot || polling.has(bot.id)) return;

    polling.add(bot.id);
    bot.running = true;
    bot.stopRequested = false;
    saveDB();

    try {
        await telegramRequest(bot.token, "deleteWebhook", {
            drop_pending_updates: false
        });

        while (!bot.stopRequested && findBot(bot.id)) {
            try {
                const updates = await telegramRequest(bot.token, "getUpdates", {
                    offset: bot.offset || 0,
                    timeout: 25,
                    allowed_updates: ["message", "callback_query"]
                });

                for (const update of updates) {
                    bot.offset = update.update_id + 1;
                    saveDB();

                    try {
                        await handleUpdate(bot, update);
                    } catch (error) {
                        console.error("خطای پردازش پیام:", error.message);
                    }
                }
            } catch (error) {
                console.error("خطای دریافت پیام:", error.message);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    } catch (error) {
        console.error("خطای راه‌اندازی ربات:", error.message);
    } finally {
        polling.delete(bot.id);
        bot.running = false;
        saveDB();
    }
}

app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).send("خطای داخلی سرور رخ داد.");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);

    for (const bot of db.bots) {
        bot.stopRequested = false;
        startBotPolling(bot);
    }
});
