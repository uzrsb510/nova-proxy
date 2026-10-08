const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mmkk1122";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000
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
        console.error("خطا در خواندن دیتابیس:", error.message);
    }

    return {
        bots: [],
        users: {},
        commands: {},
        messages: {}
    };
}

let db = loadDB();

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
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
        }, res => {
            let response = "";

            res.on("data", chunk => response += chunk);

            res.on("end", () => {
                try {
                    const result = JSON.parse(response);

                    if (result.ok) {
                        resolve(result.result);
                    } else {
                        reject(new Error(result.description || "Telegram API error"));
                    }
                } catch {
                    reject(new Error("پاسخ نامعتبر از تلگرام"));
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("اتصال به تلگرام زمان‌بر شد")));
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

function findBot(id) {
    return db.bots.find(bot => bot.id === id);
}

function escapeAttribute(value = "") {
    return escapeHTML(value);
}

function page(title, content, active = "") {
    const menu = [
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

    const sidebar = menu.map(item => `
        <a class="${active === item[0] ? "active" : ""}"
           href="${item[0]}">${item[1]}</a>
    `).join("");

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Tahoma,Arial;background:#f2f5fa;color:#202938}
header{background:#111827;color:white;padding:18px 24px;font-size:20px}
.layout{display:flex;min-height:calc(100vh - 60px)}
aside{width:265px;background:#172033;padding:15px;flex-shrink:0}
aside a{display:block;color:#dbe5f5;text-decoration:none;padding:13px 12px;
border-radius:9px;margin:4px 0;font-size:13px}
aside a:hover,aside a.active{background:#2563eb;color:white}
main{padding:25px;width:100%;min-width:0}
h2{margin-top:0}
.card{background:white;padding:20px;border-radius:13px;margin-bottom:18px;
box-shadow:0 3px 12px #00000008;overflow-x:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px}
.stat{font-size:27px;font-weight:bold;color:#2563eb;margin-top:12px}
input,select,textarea{width:100%;padding:12px;margin:7px 0 15px;
border:1px solid #d6dce7;border-radius:8px;font-family:inherit}
textarea{min-height:100px;resize:vertical}
button,.btn{display:inline-block;background:#2563eb;color:white;border:0;
padding:11px 16px;border-radius:8px;cursor:pointer;text-decoration:none;
font-family:inherit;font-size:13px;margin:3px}
.danger{background:#dc2626}.green{background:#059669}.gray{background:#64748b}
table{border-collapse:collapse;width:100%;min-width:550px}
th,td{text-align:right;padding:12px;border-bottom:1px solid #e7ebf2;font-size:13px}
th{background:#f8fafc}
.notice{padding:12px;border-radius:8px;background:#e8f4ff;margin-bottom:15px}
small{color:#64748b}
@media(max-width:800px){
.layout{display:block}aside{width:100%}main{padding:13px}
aside a{display:inline-block;padding:10px}
}
</style>
</head>
<body>
<header>پنل مدیریت ربات‌های تلگرام</header>
<div class="layout">
<aside>${sidebar}</aside>
<main>
<h2>${escapeHTML(title)}</h2>
${content}
</main>
</div>
</body>
</html>`;
}

function notice(message) {
    return `<div class="notice">${escapeHTML(message)}</div>`;
}

function botSelect(selected = "") {
    return db.bots.map(bot => `
        <option value="${escapeAttribute(bot.id)}"
        ${bot.id === selected ? "selected" : ""}>
        ${escapeHTML(bot.name)}
        </option>
    `).join("");
}

function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// صفحه ورود
app.get("/login", (req, res) => {
    if (req.session.loggedIn) return res.redirect("/");

    res.send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ورود به پنل</title>
<style>
body{font-family:Tahoma;background:#eef2f8;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0}
form{background:white;padding:30px;border-radius:15px;width:90%;max-width:380px}
input,button{width:100%;padding:13px;margin-top:12px;box-sizing:border-box;
border-radius:8px;border:1px solid #ddd;font-family:inherit}
button{background:#2563eb;color:white;border:0;cursor:pointer}
</style></head><body>
<form method="post" action="/login">
<h2>ورود مدیر</h2>
<p>برای ورود، رمز عبور را وارد کنید.</p>
<input type="password" name="password" placeholder="رمز عبور" required>
<button>ورود به پنل</button>
</form></body></html>`);
});

app.post("/login", (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).send("رمز عبور اشتباه است. <a href='/login'>تلاش مجدد</a>");
    }

    req.session.loggedIn = true;
    res.redirect("/");
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

// صفحه اصلی
app.get("/", requireLogin, (req, res) => {
    const totalUsers = Object.values(db.users)
        .reduce((sum, users) => sum + Object.keys(users).length, 0);

    const content = `
    <div class="grid">
        <div class="card">🤖 تعداد ربات‌ها<div class="stat">${db.bots.length}</div></div>
        <div class="card">👥 تعداد کاربران<div class="stat">${totalUsers}</div></div>
        <div class="card">⚡ تعداد دستورات<div class="stat">${
            Object.values(db.commands).reduce((n, commands) => n + commands.length, 0)
        }</div></div>
    </div>
    <div class="card">
        <h3>به پنل مدیریت خوش آمدید</h3>
        <p>از منوی کناری برای مدیریت ربات‌ها، دستورات و کاربران استفاده کنید.</p>
        <small>تاریخ بروزرسانی: ${new Date().toLocaleString("fa-IR")}</small>
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
                <input type="hidden" name="id" value="${escapeAttribute(bot.id)}">
                <button class="danger" onclick="return confirm('ربات حذف شود؟')">حذف</button>
            </form>
            <form method="post" action="/bots/restart" style="display:inline">
                <input type="hidden" name="id" value="${escapeAttribute(bot.id)}">
                <button class="green">راه‌اندازی مجدد</button>
            </form>
        </td>
    </tr>`).join("");

    const content = `
    <div class="card">
        <a class="btn" href="/bots/add">➕ افزودن ربات</a>
        <table><thead><tr><th>نام</th><th>نام کاربری</th><th>وضعیت</th><th>عملیات</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='4'>هنوز رباتی اضافه نشده است.</td></tr>"}</tbody>
        </table>
    </div>`;

    res.send(page("🤖 مدیریت ربات‌ها", content, "/bots"));
});

// افزودن ربات
app.get("/bots/add", requireLogin, (req, res) => {
    const content = `
    <div class="card">
    <form method="post" action="/bots/add">
        <label>نام دلخواه ربات</label>
        <input name="name" required placeholder="مثلاً ربات پشتیبانی">
        <label>توکن ربات از BotFather</label>
        <input name="token" required placeholder="توکن ربات">
        <button>➕ افزودن و اتصال ربات</button>
    </form>
    </div>`;

    res.send(page("➕ افزودن ربات جدید", content, "/bots/add"));
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
            id: createId(),
            name,
            token,
            username: info.username || "",
            telegramId: info.id,
            running: false,
            offset: 0
        };

        db.bots.push(bot);
        db.users[bot.id] ||= {};
        db.commands[bot.id] ||= [];
        db.messages[bot.id] ||= [];
        saveDB();

        startBotPolling(bot);
        res.redirect("/bots");
    } catch (error) {
        res.status(400).send(
            `اتصال ربات ناموفق بود: ${escapeHTML(error.message)} <a href="/bots/add">بازگشت</a>`
        );
    }
});

app.post("/bots/delete", requireLogin, (req, res) => {
    const bot = findBot(req.body.id);
    if (!bot) return res.redirect("/bots");

    bot.running = false;
    bot.stopRequested = true;

    db.bots = db.bots.filter(item => item.id !== bot.id);
    delete db.users[bot.id];
    delete db.commands[bot.id];
    delete db.messages[bot.id];

    saveDB();
    res.redirect("/bots");
});

app.post("/bots/restart", requireLogin, (req, res) => {
    const bot = findBot(req.body.id);

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
        }, 500);
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
        <td>
        <form method="post" action="/commands/delete">
            <input type="hidden" name="bot" value="${escapeAttribute(selected)}">
            <input type="hidden" name="index" value="${index}">
            <button class="danger">حذف</button>
        </form>
        </td>
    </tr>`).join("");

    const content = `
    <div class="card">
    <form method="get" action="/commands">
        <label>انتخاب ربات</label>
        <select name="bot">${botSelect(selected)}</select>
        <button>نمایش دستورات</button>
    </form>
    <a class="btn" href="/commands/add">➕ افزودن دستور</a>
    <table><thead><tr><th>دستور</th><th>پاسخ</th><th>عملیات</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='3'>دستوری ثبت نشده است.</td></tr>"}</tbody></table>
    </div>`;

    res.send(page("⚡ مدیریت دستورات ربات", content, "/commands"));
});

app.get("/commands/add", requireLogin, (req, res) => {
    const content = `
    <div class="card">
    <form method="post" action="/commands/add">
        <label>ربات</label>
        <select name="bot" required>${botSelect()}</select>
        <label>نام دستور</label>
        <input name="command" required placeholder="/help">
        <label>متن پاسخ</label>
        <textarea name="response" required placeholder="متن پاسخ ربات"></textarea>
        <button>ذخیره دستور</button>
    </form></div>`;

    res.send(page("➕ افزودن دستور جدید", content, "/commands/add"));
});

app.post("/commands/add", requireLogin, (req, res) => {
    const bot = findBot(String(req.body.bot || ""));
    let command = String(req.body.command || "").trim();
    const response = String(req.body.response || "").trim();

    if (!bot || !command || !response) {
        return res.status(400).send("اطلاعات کامل نیست.");
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

// مدیریت کاربران
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

    const content = `
    <div class="card">
    <form method="get" action="/users">
        <label>انتخاب ربات</label>
        <select name="bot">${botSelect(selected)}</select>
        <button>نمایش کاربران</button>
    </form>
    <table><thead><tr><th>شناسه</th><th>نام</th><th>نام کاربری</th><th>آخرین فعالیت</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='4'>کاربری ثبت نشده است.</td></tr>"}</tbody></table>
    </div>`;

    res.send(page("👥 مدیریت کاربران", content, "/users"));
});

// ارسال پیام همگانی
app.get("/broadcast", requireLogin, (req, res) => {
    const content = `
    <div class="card">
    <form method="post" action="/broadcast">
        <label>انتخاب ربات</label>
        <select name="bot" required>${botSelect()}</select>
        <label>متن پیام</label>
        <textarea name="text" required placeholder="متن پیام همگانی"></textarea>
        <button class="green">📢 ارسال به کاربران</button>
    </form>
    <small>ارسال به کاربران ثبت‌شده برای همان ربات انجام می‌شود.</small>
    </div>`;

    res.send(page("📢 ارسال پیام همگانی", content, "/broadcast"));
});

app.post("/broadcast", requireLogin, async (req, res) => {
    const bot = findBot(String(req.body.bot || ""));
    const message = String(req.body.text || "").trim();

    if (!bot || !message) {
        return res.status(400).send("ربات و متن پیام را انتخاب کنید.");
    }

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

        await new Promise(resolve => setTimeout(resolve, 40));
    }

    const content = `
    <div class="card">
    <h3>نتیجه ارسال</h3>
    <p>✅ ارسال موفق: ${success}</p>
    <p>❌ ارسال ناموفق: ${failed}</p>
    <a class="btn" href="/broadcast">بازگشت</a>
    </div>`;

    res.send(page("نتیجه ارسال پیام", content, "/broadcast"));
});

// آمار
app.get("/stats", requireLogin, (req, res) => {
    const rows = db.bots.map(bot => {
        const users = Object.keys(db.users[bot.id] || {}).length;
        const commands = (db.commands[bot.id] || []).length;

        return `<tr>
            <td>${escapeHTML(bot.name)}</td>
            <td>${users}</td>
            <td>${commands}</td>
            <td>${bot.running ? "فعال" : "متوقف"}</td>
        </tr>`;
    }).join("");

    res.send(page("📊 آمار ربات‌ها و کاربران", `
    <div class="card">
    <table><thead><tr><th>ربات</th><th>کاربران</th><th>دستورات</th><th>وضعیت</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='4'>رباتی وجود ندارد.</td></tr>"}</tbody></table>
    </div>`, "/stats"));
});

// تست اتصال ربات
app.get("/test", requireLogin, (req, res) => {
    const content = `
    <div class="card">
    <form method="post" action="/test">
        <label>انتخاب ربات</label>
        <select name="bot" required>${botSelect()}</select>
        <button>🧪 بررسی اتصال</button>
    </form></div>`;

    res.send(page("🧪 تست اتصال ربات", content, "/test"));
});

app.post("/test", requireLogin, async (req, res) => {
    const bot = findBot(String(req.body.bot || ""));
    let result;

    if (!bot) {
        result = "ربات انتخاب‌شده پیدا نشد.";
    } else {
        try {
            const info = await telegramRequest(bot.token, "getMe");
            result = `اتصال موفق است. نام: ${info.first_name} | شناسه: ${info.id}`;
        } catch (error) {
            result = "خطای اتصال: " + error.message;
        }
    }

    res.send(page("نتیجه تست اتصال", `
    <div class="card">${escapeHTML(result)}<br>
    <a class="btn" href="/test">بازگشت</a></div>`, "/test"));
});

// ورود سازنده
app.get("/creator", requireLogin, (req, res) => {
    res.send(page("👑 ورود سازنده", `
    <div class="card">
    <h3>اطلاعات سازنده پنل</h3>
    <p>این بخش برای افزودن اطلاعات سازنده و راه‌های ارتباطی آماده است.</p>
    </div>`, "/creator"));
});

app.get("/refresh", requireLogin, (req, res) => {
    res.redirect("/");
});

// پردازش پیام‌های تلگرام
const polling = new Set();

async function handleUpdate(bot, update) {
    if (update.message) {
        const message = update.message;
        const chat = message.chat;

        if (!chat || chat.type !== "private" || !message.from) return;

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

        // پشتیبانی از دستورهایی مانند /start@MyBot
        const command = text.split(/\s+/)[0].replace(/@[\w_]+$/, "").toLowerCase();

        if (command === "/start") {
            const customStart = (db.commands[bot.id] || [])
                .find(item => item.command.toLowerCase() === "/start");

            await sendMessage(
                bot.token,
                chat.id,
                customStart ? customStart.response : "سلام! 👋\nبه ربات خوش آمدید."
            );

            return;
        }

        const found = (db.commands[bot.id] || [])
            .find(item => item.command.toLowerCase() === command);

        if (found) {
            await sendMessage(bot.token, chat.id, found.response);
        }
    }

    if (update.callback_query) {
        const query = update.callback_query;

        try {
            await telegramRequest(bot.token, "answerCallbackQuery", {
                callback_query_id: query.id
            });
        } catch {}
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
                        console.error("خطا در پردازش پیام:", error.message);
                    }
                }
            } catch (error) {
                console.error(`خطای ربات ${bot.name}:`, error.message);
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

// راه‌اندازی ربات‌های ذخیره‌شده پس از اجرای سرور
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);

    for (const bot of db.bots) {
        bot.stopRequested = false;
        startBotPolling(bot);
    }
});
