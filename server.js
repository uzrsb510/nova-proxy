const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database("panel.db");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    total_volume TEXT DEFAULT 'نامحدود',
    used_volume TEXT DEFAULT '0 GB',
    expiry TEXT DEFAULT '',
    subscription_link TEXT DEFAULT '',
    configs TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    username TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

try {
    db.exec(`ALTER TABLE users ADD COLUMN configs TEXT DEFAULT ''`);
} catch (e) {}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || "kosar-panel-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24
    }
}));

function escapeHtml(str = "") {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttr(str = "") {
    return escapeHtml(str);
}

function getBaseUrl(req) {
    return `${req.protocol}://${req.get("host")}`;
}

function splitConfigs(text = "") {
    return String(text)
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);
}

function generateToken() {
    return crypto.randomBytes(18).toString("hex");
}

function page(title, content) {
    return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | پنل مدیریت کوثر</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: Tahoma, Arial, sans-serif;
    background:
        radial-gradient(circle at top right,#172554,transparent 35%),
        radial-gradient(circle at bottom left,#312e81,transparent 30%),
        #070b16;
    color: #fff;
    min-height: 100vh;
}

.container {
    width: min(1100px,94%);
    margin: 25px auto;
}

.header {
    background: rgba(15,23,42,.88);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 24px;
    padding: 22px;
    margin-bottom: 18px;
    box-shadow: 0 20px 50px rgba(0,0,0,.3);
}

.header h1 {
    margin: 0 0 8px;
    font-size: 25px;
}

.header p {
    margin: 0;
    color: #aeb9d0;
}

.card {
    background: rgba(15,23,42,.88);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 22px;
    padding: 20px;
    margin-bottom: 18px;
    box-shadow: 0 15px 40px rgba(0,0,0,.25);
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit,minmax(180px,1fr));
    gap: 14px;
}

.stat {
    padding: 20px;
    border-radius: 18px;
    background: rgba(255,255,255,.05);
}

.stat b {
    display: block;
    font-size: 27px;
    margin-top: 8px;
}

input,
textarea,
select {
    width: 100%;
    padding: 13px;
    margin: 7px 0 14px;
    border-radius: 13px;
    border: 1px solid #334155;
    background: #0b1220;
    color: white;
    outline: none;
}

textarea {
    min-height: 150px;
    resize: vertical;
    direction: ltr;
    text-align: left;
}

button,
.btn {
    display: inline-block;
    border: 0;
    border-radius: 12px;
    padding: 11px 16px;
    color: white;
    background: #2563eb;
    cursor: pointer;
    text-decoration: none;
    margin: 3px;
}

button:hover,
.btn:hover {
    opacity: .85;
}

.red {
    background: #dc2626;
}

.green {
    background: #16a34a;
}

.gray {
    background: #475569;
}

.purple {
    background: #7c3aed;
}

.user {
    padding: 18px;
    border-radius: 18px;
    background: rgba(255,255,255,.045);
    margin-bottom: 12px;
}

.user h3 {
    margin-top: 0;
}

.status {
    display: inline-block;
    padding: 5px 10px;
    border-radius: 20px;
    font-size: 12px;
}

.active {
    background: #14532d;
    color: #86efac;
}

.inactive {
    background: #7f1d1d;
    color: #fecaca;
}

.config {
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 10px;
    margin: 8px 0;
    word-break: break-all;
    direction: ltr;
    text-align: left;
}

.small {
    color: #94a3b8;
    font-size: 13px;
}

.nav {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    margin-bottom: 18px;
}

.copy {
    background: #0891b2;
}

.danger {
    color: #fecaca;
}

@media(max-width:600px) {
    .container {
        width: 96%;
        margin: 12px auto;
    }

    .header h1 {
        font-size: 21px;
    }

    .card {
        padding: 15px;
    }

    button,
    .btn {
        width: 100%;
        margin: 4px 0;
    }
}
</style>

<script>
function copyText(text) {
    navigator.clipboard.writeText(text);
    alert("کپی شد ✅");
}

function copyInput(id) {
    const el = document.getElementById(id);
    navigator.clipboard.writeText(el.value);
    alert("کپی شد ✅");
}

function confirmDelete() {
    return confirm("آیا از حذف این کاربر مطمئن هستید؟");
}
</script>
</head>

<body>
<div class="container">

<div class="header">
    <h1>🛡️ پنل مدیریت کوثر</h1>
    <p>مدیریت کاربران، کانفیگ‌ها و ربات تلگرام</p>
</div>

${content}

</div>
</body>
</html>
`;
}

/* =========================
   صفحه اصلی
========================= */

app.get("/", (req, res) => {
    if (req.session.adminId) {
        return res.redirect("/admin");
    }

    res.send(page("ورود", `
    <div class="card">
        <h2>🔐 ورود به پنل</h2>

        <form method="POST" action="/login">
            <input name="username" placeholder="نام کاربری" required>
            <input name="password" type="password" placeholder="رمز عبور" required>

            <button type="submit">ورود به پنل</button>
        </form>

        <a class="btn gray" href="/create-admin">
            ساخت مدیر جدید
        </a>
    </div>
    `));
});

/* =========================
   ساخت مدیر
========================= */

app.get("/create-admin", (req, res) => {
    res.send(page("ساخت مدیر", `
    <div class="card">
        <h2>👤 ساخت مدیر</h2>

        <form method="POST" action="/create-admin">
            <input name="username" placeholder="نام کاربری" required>
            <input name="password" type="password" placeholder="رمز عبور" required>

            <button type="submit">ساخت حساب</button>
        </form>
    </div>
    `));
});

app.post("/create-admin", (req, res) => {
    const { username, password } = req.body;

    try {
        const hash = bcrypt.hashSync(password, 10);

        db.prepare(`
            INSERT INTO admins(username,password)
            VALUES(?,?)
        `).run(username, hash);

        res.redirect("/");
    } catch {
        res.send("این نام کاربری قبلاً استفاده شده است.");
    }
});

/* =========================
   ورود
========================= */

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    const admin = db.prepare(`
        SELECT * FROM admins WHERE username = ?
    `).get(username);

    if (!admin || !bcrypt.compareSync(password, admin.password)) {
        return res.send("نام کاربری یا رمز عبور اشتباه است.");
    }

    req.session.adminId = admin.id;

    res.redirect("/admin");
});

/* =========================
   محافظ پنل
========================= */

function auth(req, res, next) {
    if (!req.session.adminId) {
        return res.redirect("/");
    }

    next();
}

/* =========================
   داشبورد
========================= */

app.get("/admin", auth, (req, res) => {

    const adminId = req.session.adminId;

    const total = db.prepare(`
        SELECT COUNT(*) AS c
        FROM users
        WHERE admin_id = ?
    `).get(adminId).c;

    const active = db.prepare(`
        SELECT COUNT(*) AS c
        FROM users
        WHERE admin_id = ? AND active = 1
    `).get(adminId).c;

    const inactive = total - active;

    const bot = db.prepare(`
        SELECT *
        FROM telegram_bots
        WHERE admin_id = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(adminId);

    const users = db.prepare(`
        SELECT *
        FROM users
        WHERE admin_id = ?
        ORDER BY id DESC
    `).all(adminId);

    let usersHtml = "";

    for (const user of users) {

        const configs = splitConfigs(user.configs);

        usersHtml += `
        <div class="user">

            <h3>👤 ${escapeHtml(user.name)}</h3>

            <span class="status ${user.active ? "active" : "inactive"}">
                ${user.active ? "🟢 فعال" : "🔴 غیرفعال"}
            </span>

            <p>📦 حجم: ${escapeHtml(user.total_volume)}</p>
            <p>📅 انقضا: ${escapeHtml(user.expiry || "نامحدود")}</p>
            <p>📡 تعداد کانفیگ: ${configs.length}</p>

            <input
                id="sub_${user.id}"
                value="${escapeAttr(user.subscription_link)}"
                readonly
            >

            <button class="copy"
                onclick="copyInput('sub_${user.id}')">
                🔗 کپی لینک اشتراک
            </button>

            <a class="btn" href="/admin/user/${user.id}">
                ⚙️ مدیریت کاربر
            </a>

        </div>
        `;
    }

    if (!usersHtml) {
        usersHtml = `
        <div class="card">
            هنوز کاربری ساخته نشده است.
        </div>
        `;
    }

    res.send(page("داشبورد", `

    <div class="nav">
        <a class="btn" href="/admin">🏠 داشبورد</a>
        <a class="btn green" href="/admin/add">➕ افزودن کاربر</a>
        <a class="btn purple" href="/admin/telegram">🤖 ربات تلگرام</a>
        <a class="btn red" href="/logout">خروج</a>
    </div>

    <div class="grid">

        <div class="stat">
            👥 کاربران
            <b>${total}</b>
        </div>

        <div class="stat">
            🟢 فعال
            <b>${active}</b>
        </div>

        <div class="stat">
            🔴 غیرفعال
            <b>${inactive}</b>
        </div>

    </div>

    <div class="card">
        <h2>👥 کاربران</h2>

        <input
            id="search"
            placeholder="🔎 جستجوی کاربر..."
            oninput="searchUsers()"
        >

        <div id="users">
            ${usersHtml}
        </div>
    </div>

    <script>
    function searchUsers() {
        const value =
            document.getElementById("search").value.toLowerCase();

        document.querySelectorAll(".user").forEach(el => {
            el.style.display =
                el.innerText.toLowerCase().includes(value)
                ? "block"
                : "none";
        });
    }
    </script>

    `));
});

/* =========================
   افزودن کاربر
========================= */

app.get("/admin/add", auth, (req, res) => {

    res.send(page("افزودن کاربر", `

    <div class="nav">
        <a class="btn gray" href="/admin">⬅️ برگشت</a>
    </div>

    <div class="card">

        <h2>➕ ساخت کاربر جدید</h2>

        <form method="POST" action="/admin/add">

            <label>👤 نام کاربر</label>
            <input
                name="name"
                placeholder="مثلاً علی"
                required
            >

            <label>📦 حجم</label>
            <input
                name="total_volume"
                value="نامحدود"
                placeholder="مثلاً 100 GB"
            >

            <label>📅 تاریخ انقضا</label>
            <input
                name="expiry"
                placeholder="مثلاً 2026-12-31"
            >

            <label>📡 کانفیگ‌ها</label>

            <textarea
                name="configs"
                placeholder="هر کانفیگ را در یک خط قرار دهید

vless://...
trojan://...
vless://..."
            ></textarea>

            <button class="green" type="submit">
                ✅ ساخت کاربر
            </button>

        </form>

    </div>

    `));
});

app.post("/admin/add", auth, (req, res) => {

    const {
        name,
        total_volume,
        expiry,
        configs
    } = req.body;

    const token = generateToken();

    const subscription =
        `${getBaseUrl(req)}/sub/${token}`;

    db.prepare(`
        INSERT INTO users
        (
            admin_id,
            name,
            token,
            total_volume,
            expiry,
            subscription_link,
            configs
        )
        VALUES(?,?,?,?,?,?,?)
    `).run(
        req.session.adminId,
        name,
        token,
        total_volume || "نامحدود",
        expiry || "",
        subscription,
        configs || ""
    );

    res.redirect("/admin");
});

/* =========================
   مدیریت کاربر
========================= */

app.get("/admin/user/:id", auth, (req, res) => {

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE id = ?
        AND admin_id = ?
    `).get(
        req.params.id,
        req.session.adminId
    );

    if (!user) {
        return res.send("کاربر پیدا نشد.");
    }

    const configs = splitConfigs(user.configs);

    let configHtml = "";

    configs.forEach((config, index) => {
        configHtml += `
        <div class="config">
            <b>کانفیگ ${index + 1}</b>

            <br><br>

            ${escapeHtml(config)}

            <br>

            <button
                class="copy"
                onclick='copyText(${JSON.stringify(config)})'>
                📋 کپی
            </button>
        </div>
        `;
    });

    if (!configHtml) {
        configHtml = `<p class="small">کانفیگی ثبت نشده است.</p>`;
    }

    res.send(page("مدیریت کاربر", `

    <div class="nav">
        <a class="btn gray" href="/admin">⬅️ برگشت</a>
    </div>

    <div class="card">

        <h2>👤 ${escapeHtml(user.name)}</h2>

        <span class="status ${user.active ? "active" : "inactive"}">
            ${user.active ? "🟢 فعال" : "🔴 غیرفعال"}
        </span>

        <form method="POST"
              action="/admin/user/${user.id}/update">

            <label>نام</label>
            <input
                name="name"
                value="${escapeAttr(user.name)}"
                required
            >

            <label>حجم</label>
            <input
                name="total_volume"
                value="${escapeAttr(user.total_volume)}"
            >

            <label>تاریخ انقضا</label>
            <input
                name="expiry"
                value="${escapeAttr(user.expiry)}"
            >

            <label>کانفیگ‌ها</label>

            <textarea name="configs">${escapeHtml(user.configs)}</textarea>

            <button class="green">
                💾 ذخیره تغییرات
            </button>

        </form>

        <hr>

        <h3>🔗 لینک اشتراک</h3>

        <input
            id="sub"
            value="${escapeAttr(user.subscription_link)}"
            readonly
        >

        <button
            class="copy"
            onclick="copyInput('sub')">
            📋 کپی لینک
        </button>

        <a
            class="btn purple"
            href="/admin/user/${user.id}/qr"
            target="_blank">
            📱 QR Code
        </a>

    </div>

    <div class="card">

        <h2>📡 کانفیگ‌های کاربر</h2>

        ${configHtml}

    </div>

    <div class="card">

        <form method="POST"
              action="/admin/user/${user.id}/toggle">

            <button class="${user.active ? "red" : "green"}">
                ${user.active ? "🔴 غیرفعال کردن" : "🟢 فعال کردن"}
            </button>

        </form>

        <form method="POST"
              action="/admin/user/${user.id}/delete"
              onsubmit="return confirmDelete()">

            <button class="red">
                🗑 حذف کاربر
            </button>

        </form>

    </div>

    `));
});

app.post("/admin/user/:id/update", auth, (req, res) => {

    const {
        name,
        total_volume,
        expiry,
        configs
    } = req.body;

    db.prepare(`
        UPDATE users
        SET
            name = ?,
            total_volume = ?,
            expiry = ?,
            configs = ?
        WHERE id = ?
        AND admin_id = ?
    `).run(
        name,
        total_volume,
        expiry,
        configs || "",
        req.params.id,
        req.session.adminId
    );

    res.redirect(`/admin/user/${req.params.id}`);
});

app.post("/admin/user/:id/toggle", auth, (req, res) => {

    db.prepare(`
        UPDATE users
        SET active = CASE
            WHEN active = 1 THEN 0
            ELSE 1
        END
        WHERE id = ?
        AND admin_id = ?
    `).run(
        req.params.id,
        req.session.adminId
    );

    res.redirect(`/admin/user/${req.params.id}`);
});

app.post("/admin/user/:id/delete", auth, (req, res) => {

    db.prepare(`
        DELETE FROM users
        WHERE id = ?
        AND admin_id = ?
    `).run(
        req.params.id,
        req.session.adminId
    );

    res.redirect("/admin");
});

/* =========================
   QR
========================= */

app.get("/admin/user/:id/qr", auth, async (req, res) => {

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE id = ?
        AND admin_id = ?
    `).get(
        req.params.id,
        req.session.adminId
    );

    if (!user) {
        return res.send("کاربر پیدا نشد.");
    }

    const qr = await QRCode.toDataURL(
        user.subscription_link
    );

    res.send(page("QR Code", `

    <div class="card" style="text-align:center">

        <h2>📱 QR Code</h2>

        <img
            src="${qr}"
            style="max-width:100%;background:white;padding:15px;border-radius:20px"
        >

        <p>${escapeHtml(user.name)}</p>

        <a class="btn" href="/admin/user/${user.id}">
            ⬅️ برگشت
        </a>

    </div>

    `));
});

/* =========================
   صفحه عمومی کاربر
========================= */

app.get("/u/:token", (req, res) => {

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE token = ?
    `).get(req.params.token);

    if (!user || !user.active) {
        return res.send("این پنل فعال نیست.");
    }

    const configs = splitConfigs(user.configs);

    let configHtml = "";

    configs.forEach((config, index) => {

        configHtml += `
        <div class="config">

            <b>📡 کانفیگ ${index + 1}</b>

            <br><br>

            ${escapeHtml(config)}

            <br>

            <button
                class="copy"
                onclick='copyText(${JSON.stringify(config)})'>
                📋 کپی کانفیگ
            </button>

        </div>
        `;
    });

    res.send(page("پنل کاربر", `

    <div class="card">

        <h2>🚀 پنل شخصی</h2>

        <h3>👤 ${escapeHtml(user.name)}</h3>

        <p>📦 حجم: ${escapeHtml(user.total_volume)}</p>

        <p>📅 انقضا:
            ${escapeHtml(user.expiry || "نامحدود")}
        </p>

        <h3>🔗 لینک اشتراک</h3>

        <input
            id="sub"
            value="${escapeAttr(user.subscription_link)}"
            readonly
        >

        <button
            class="copy"
            onclick="copyInput('sub')">
            📋 کپی لینک اشتراک
        </button>

    </div>

    <div class="card">

        <h2>📡 کانفیگ‌ها</h2>

        ${configHtml || "<p>کانفیگی موجود نیست.</p>"}

    </div>

    `));
});

/* =========================
   Subscription
========================= */

app.get("/sub/:token", (req, res) => {

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE token = ?
        AND active = 1
    `).get(req.params.token);

    if (!user) {
        return res.status(404).send("Subscription not found");
    }

    const configs = splitConfigs(user.configs);

    res.setHeader(
        "Content-Type",
        "text/plain; charset=utf-8"
    );

    res.send(configs.join("\n"));
});

/* =====================================================
   اتصال ربات تلگرام
===================================================== */

app.get("/admin/telegram", auth, async (req, res) => {

    const bot = db.prepare(`
        SELECT *
        FROM telegram_bots
        WHERE admin_id = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(req.session.adminId);

    res.send(page("ربات تلگرام", `

    <div class="nav">
        <a class="btn gray" href="/admin">⬅️ برگشت</a>
    </div>

    <div class="card">

        <h2>🤖 اتصال ربات تلگرام</h2>

        <p class="small">
            توکن BotFather را وارد کنید.
        </p>

        <form method="POST" action="/admin/telegram/connect">

            <input
                name="token"
                type="password"
                placeholder="توکن ربات تلگرام"
                required
            >

            <button class="green">
                🔗 اتصال ربات
            </button>

        </form>

        ${
            bot
            ? `
            <hr>

            <p>
                وضعیت:
                <span class="status active">
                    🟢 متصل
                </span>
            </p>

            <p>
                ربات:
                @${escapeHtml(bot.username)}
            </p>

            <form method="POST"
                  action="/admin/telegram/disconnect">

                <button class="red">
                    🔌 قطع اتصال
                </button>

            </form>
            `
            : `
            <p class="small">
                هنوز رباتی متصل نشده است.
            </p>
            `
        }

    </div>

    <div class="card">

        <h3>📋 امکانات ربات</h3>

        <p>👤 افزودن کاربر</p>
        <p>📋 لیست کاربران</p>
        <p>🔎 جستجوی کاربر</p>
        <p>✏️ ویرایش کاربر</p>
        <p>🗑 حذف کاربر</p>
        <p>📡 مدیریت کانفیگ‌ها</p>
        <p>🔗 لینک اشتراک</p>
        <p>📊 آمار کاربران</p>

    </div>

    `));
});

app.post("/admin/telegram/connect", auth, async (req, res) => {

    const token = String(req.body.token || "").trim();

    if (!token) {
        return res.send("توکن وارد نشده است.");
    }

    try {

        const response = await fetch(
            `https://api.telegram.org/bot${token}/getMe`
        );

        const data = await response.json();

        if (!data.ok) {
            return res.send("❌ توکن ربات اشتباه است.");
        }

        db.prepare(`
            DELETE FROM telegram_bots
            WHERE admin_id = ?
        `).run(req.session.adminId);

        db.prepare(`
            INSERT INTO telegram_bots
            (
                admin_id,
                token,
                username,
                active
            )
            VALUES(?,?,?,1)
        `).run(
            req.session.adminId,
            token,
            data.result.username || ""
        );

        res.redirect("/admin/telegram");

    } catch (error) {

        res.send(
            "خطا در اتصال به تلگرام: " +
            escapeHtml(error.message)
        );
    }
});

app.post("/admin/telegram/disconnect", auth, (req, res) => {

    db.prepare(`
        DELETE FROM telegram_bots
        WHERE admin_id = ?
    `).run(req.session.adminId);

    res.redirect("/admin/telegram");
});

/* =====================================================
   Telegram API
===================================================== */

async function telegramRequest(token, method, body) {

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

    return response.json();
}

async function sendTelegram(token, chatId, text, keyboard = null) {

    const body = {
        chat_id: chatId,
        text
    };

    if (keyboard) {
        body.reply_markup = {
            inline_keyboard: keyboard
        };
    }

    return telegramRequest(
        token,
        "sendMessage",
        body
    );
}

/* =====================================================
   Telegram Webhook
===================================================== */

app.post("/telegram/webhook/:token", async (req, res) => {

    res.send("OK");

    const token = req.params.token;
    const update = req.body;

    try {

        if (!update.message) {
            return;
        }

        const message = update.message;
        const chatId = message.chat.id;
        const text = message.text || "";

        const bot = db.prepare(`
            SELECT *
            FROM telegram_bots
            WHERE token = ?
            AND active = 1
        `).get(token);

        if (!bot) {
            return;
        }

        /* ======================
           START
        ====================== */

        if (text === "/start") {

            await sendTelegram(
                token,
                chatId,
                "🤖 پنل مدیریت کوثر\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
                [
                    [
                        {
                            text: "➕ افزودن کاربر",
                            callback_data: "add_user"
                        }
                    ],
                    [
                        {
                            text: "👥 لیست کاربران",
                            callback_data: "users"
                        },
                        {
                            text: "📊 آمار",
                            callback_data: "stats"
                        }
                    ]
                ]
            );

            return;
        }

        /* ======================
           ADD USER
        ====================== */

        if (text === "/add") {

            await sendTelegram(
                token,
                chatId,
                "👤 نام کاربر را ارسال کنید:\n\nمثال:\nعلی"
            );

            return;
        }

        /*
         اگر متن /add نبود ولی کاربر در حالت
         افزودن است، در نسخه بعدی state
         مرحله‌به‌مرحله مدیریت می‌شود.
        */

        if (text === "/users") {

            const users = db.prepare(`
                SELECT *
                FROM users
                WHERE admin_id = ?
                ORDER BY id DESC
                LIMIT 30
            `).all(bot.admin_id);

            if (!users.length) {

                await sendTelegram(
                    token,
                    chatId,
                    "📭 هنوز کاربری وجود ندارد."
                );

                return;
            }

            let output = "👥 لیست کاربران:\n\n";

            users.forEach((u, i) => {

                output +=
                    `${i + 1}. ${u.name} ` +
                    `${u.active ? "🟢" : "🔴"}\n`;

            });

            await sendTelegram(
                token,
                chatId,
                output
            );

            return;
        }

        if (text === "/stats") {

            const total = db.prepare(`
                SELECT COUNT(*) AS c
                FROM users
                WHERE admin_id = ?
            `).get(bot.admin_id).c;

            const active = db.prepare(`
                SELECT COUNT(*) AS c
                FROM users
                WHERE admin_id = ?
                AND active = 1
            `).get(bot.admin_id).c;

            await sendTelegram(
                token,
                chatId,
                `📊 آمار پنل\n\n` +
                `👥 کل کاربران: ${total}\n` +
                `🟢 فعال: ${active}\n` +
                `🔴 غیرفعال: ${total - active}`
            );

            return;
        }

    } catch (error) {

        console.error(
            "Telegram error:",
            error.message
        );
    }
});

/* =====================================================
   Webhook Connect
===================================================== */

async function setupWebhook(token, req) {

    const webhookUrl =
        `${getBaseUrl(req)}/telegram/webhook/${token}`;

    return telegramRequest(
        token,
        "setWebhook",
        {
            url: webhookUrl
        }
    );
}

/* =====================================================
   بعد از اتصال ربات Webhook
===================================================== */

app.post("/admin/telegram/connect", auth, async (req, res) => {

    const token = String(req.body.token || "").trim();

    if (!token) {
        return res.send("توکن وارد نشده است.");
    }

    try {

        const response = await fetch(
            `https://api.telegram.org/bot${token}/getMe`
        );

        const data = await response.json();

        if (!data.ok) {
            return res.send("❌ توکن ربات اشتباه است.");
        }

        db.prepare(`
            DELETE FROM telegram_bots
            WHERE admin_id = ?
        `).run(req.session.adminId);

        db.prepare(`
            INSERT INTO telegram_bots
            (
                admin_id,
                token,
                username,
                active
            )
            VALUES(?,?,?,1)
        `).run(
            req.session.adminId,
            token,
            data.result.username || ""
        );

        await setupWebhook(token, req);

        res.redirect("/admin/telegram");

    } catch (error) {

        res.send(
            "❌ خطا: " +
            escapeHtml(error.message)
        );
    }
});

/* =========================
   خروج
========================= */

app.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/");
    });

});

/* =========================
   اجرا
========================= */

app.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Kosar Panel running on port ${PORT}`
    );

});
