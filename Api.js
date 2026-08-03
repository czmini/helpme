/**
 * API.js - Solver dengan cleanup total yang aman dan stabil
 */
const express = require('express');
const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 7860;
const authToken = process.env.authToken || null;

global.browserLimit = 10;
global.timeOut = 300000;

// ============ CACHE ============
const CACHE_DIR = path.join(__dirname, "cache");
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_AUTOSAVE = process.env.CACHE_AUTOSAVE === "true";

function readCache(type, taskId) {
    const file = path.join(CACHE_DIR, type, `${taskId}.json`);
    if (!fs.existsSync(file)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (Date.now() - data.timestamp < CACHE_TTL) return data;
        return null;
    } catch {
        return null;
    }
}

function writeCache(type, taskId, value) {
    const dir = path.join(CACHE_DIR, type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${taskId}.json`);
    const data = { timestamp: Date.now(), ...value };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`cache saved: ${type}:${taskId}`);
}

function cleanCache() {
    const types = ["turnstile", "recaptcha3", "recaptcha2", "interstitial", "error"];
    const now = Date.now();
    const TTL = 60 * 60 * 1000;
    types.forEach(type => {
        const dir = path.join(CACHE_DIR, type);
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (now - data.timestamp > TTL) {
                    fs.unlinkSync(filePath);
                    console.log(`cache expired: ${filePath}`);
                }
            } catch {
                fs.unlinkSync(filePath);
            }
        });
    });
}
setInterval(cleanCache, 60 * 1000);

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ TASK STORE ============
const tasks = {};

// ============ ROUTES ============
app.get("/", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const uptime = process.uptime();
    res.json({
        message: "Welcome",
        server: {
            domain: baseUrl,
            version: "7.3.0",
            uptime: `${Math.floor(uptime)} seconds`,
            limit: global.browserLimit,
            timeout: global.timeOut,
            status: "recently running"
        },
        solvers: ["turnstile", "recaptcha2", "recaptcha3", "interstitial"]
    });
});

app.post('/solve', async (req, res) => {
    const { type, domain, siteKey, taskId, action, proxy, isInvisible } = req.body;

    // Jika taskId diberikan, ambil status task
    if (taskId) {
        const task = tasks[taskId];
        if (!task) return res.status(404).json({ status: "error", message: "Task not found" });
        if (task.status === "pending") return res.json({ status: "processing" });
        return res.json(task);
    }

    // Buat task baru
    const newTaskId = Date.now().toString(36);
    tasks[newTaskId] = { status: "pending" };
    console.log(`New task: ${newTaskId} => ${type}:${domain}`);

    // Jalankan solver secara async, dengan cleanup total di finally
    let ctx = null;
    (async () => {
        try {
            // Inisialisasi browser (dengan proxy jika ada)
            ctx = await init_browser(proxy?.server);
            const page = ctx.page;
            let result;

            // Panggil solver sesuai type
            switch (type) {
                case "turnstile":
                    result = await turnstile({ domain, siteKey, action, proxy }, page);
                    tasks[newTaskId] = { status: "done", ...result };
                    if (CACHE_AUTOSAVE) writeCache("turnstile", newTaskId, tasks[newTaskId]);
                    break;

                case "interstitial":
                    result = await interstitial({ domain, proxy }, page);
                    tasks[newTaskId] = { status: "done", ...result };
                    if (CACHE_AUTOSAVE) writeCache("interstitial", newTaskId, tasks[newTaskId]);
                    break;

                case "recaptcha2":
                    result = await recaptchaV2({ domain, siteKey, action, isInvisible, proxy }, page);
                    tasks[newTaskId] = { status: "done", ...result };
                    if (CACHE_AUTOSAVE) writeCache("recaptcha2", newTaskId, tasks[newTaskId]);
                    break;

                case "recaptcha3":
                    result = await recaptchaV3({ domain, siteKey, action, proxy }, page);
                    tasks[newTaskId] = { status: "done", ...result };
                    if (CACHE_AUTOSAVE) writeCache("recaptcha3", newTaskId, tasks[newTaskId]);
                    break;

                default:
                    tasks[newTaskId] = { status: "error", message: "Invalid type" };
            }
            console.log(`Task selesai: ${newTaskId} (${type})`);
        } catch (err) {
            tasks[newTaskId] = { status: "error", message: "totally failed" };
            console.error(`Task gagal: ${newTaskId} (${type})`, err);
            if (CACHE_AUTOSAVE) writeCache("error", newTaskId, { error: err.message });
        } finally {
            // === CLEANUP TOTAL YANG AMAN ===
            await cleanBrowser(ctx);
            console.log(`Cleanup selesai untuk task ${newTaskId}`);
        }
    })();

    // Kirim taskId ke client
    res.json({ taskId: newTaskId, status: "pending" });
});

// ============ FUNGSI BROWSER ============
/**
 * Inisialisasi browser dengan puppeteer-real-browser
 * @param {string|null} proxyServer - Proxy server (opsional)
 * @returns {Promise<{browser: Browser, page: Page, profilePath: string|null}>}
 */
async function init_browser(proxyServer = null) {
    const connectOptions = {
        headless: false,
        turnstile: true,
        connectOption: { defaultViewport: null },
        disableXvfb: false,
    };
    if (proxyServer) connectOptions.args = [`--proxy-server=${proxyServer}`];

    const { browser } = await connect(connectOptions);
    const [page] = await browser.pages();

    // Dapatkan path profile sementara (jika ada)
    let profilePath = null;
    try {
        const proc = browser.process();
        if (proc && proc.spawnargs) {
            const args = proc.spawnargs;
            const idx = args.findIndex(a => a.startsWith('--user-data-dir='));
            if (idx !== -1) {
                profilePath = args[idx].split('=')[1];
            }
        }
    } catch (_) {}

    // Setup page: about:blank dan block resource
    await page.goto('about:blank');
    await page.setRequestInterception(true);
    // Simpan listener agar bisa dihapus nanti
    const requestHandler = (req) => {
        const type = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(type)) req.abort();
        else req.continue();
    };
    page.on('request', requestHandler);
    // Simpan reference handler di ctx agar bisa di-off
    const ctx = { browser, page, profilePath, requestHandler };

    console.log(`Browser initialized${proxyServer ? ' proxy=' + proxyServer : ''}`);
    return ctx;
}

/**
 * Cleanup total setelah browser digunakan (aman, tidak agresif)
 * @param {Object} ctx - { browser, page, profilePath, requestHandler? }
 */
async function cleanBrowser(ctx) {
    if (!ctx) return;
    const { browser, page, profilePath, requestHandler } = ctx;

    // --- 1. Matikan request interception dan hapus listener ---
    if (page && !page.isClosed()) {
        try {
            await page.setRequestInterception(false);
            // Hapus listener request jika ada
            if (requestHandler) {
                page.off('request', requestHandler);
            } else {
                page.removeAllListeners('request');
            }
            // Hapus listener lain (jika ada)
            page.removeAllListeners();
        } catch (_) {}
    }

    // --- 2. Bersihkan storage (localStorage, sessionStorage, IndexedDB, CacheStorage, Cookies, Cache) ---
    if (page && !page.isClosed()) {
        try {
            await page.goto('about:blank', { waitUntil: 'load' });
            await page.evaluate(async () => {
                localStorage.clear();
                sessionStorage.clear();

                // IndexedDB
                if (typeof indexedDB.databases === 'function') {
                    const dbs = await indexedDB.databases();
                    for (const db of dbs) {
                        indexedDB.deleteDatabase(db.name);
                    }
                }

                // Cache Storage (Service Worker Cache)
                if (typeof caches !== 'undefined' && caches.keys) {
                    const keys = await caches.keys();
                    for (const key of keys) {
                        await caches.delete(key);
                    }
                }
            });

            // Cookies & browser cache via CDP
            const client = await page.target().createCDPSession();
            await client.send('Network.clearBrowserCookies');
            await client.send('Network.clearBrowserCache');
        } catch (_) {}
    }

    // --- 3. Tutup semua page ---
    if (browser) {
        try {
            const pages = await browser.pages();
            for (const p of pages) {
                try {
                    if (!p.isClosed()) await p.close();
                } catch (_) {}
            }
        } catch (_) {}
    }

    // --- 4. Tutup browser dengan timeout 5 detik ---
    if (browser) {
        try {
            await Promise.race([
                browser.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 5000))
            ]).catch(async (err) => {
                // Jika timeout atau error, bunuh proses secara paksa berdasarkan PID
                try {
                    const proc = browser.process();
                    if (proc && proc.pid) {
                        process.kill(proc.pid, 'SIGKILL');
                        console.log(`Browser process ${proc.pid} killed due to close timeout/error.`);
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }

    // --- 5. Hapus profile folder (hanya jika valid dan aman) ---
    if (profilePath) {
        try {
            // Keamanan: pastikan path mengandung 'chrome' atau 'puppeteer' dan bukan root
            if (profilePath.includes('chrome') || profilePath.includes('puppeteer')) {
                fs.rmSync(profilePath, { recursive: true, force: true });
                console.log(`Profile deleted: ${profilePath}`);
            } else {
                console.warn(`Profile path tidak aman untuk dihapus: ${profilePath}`);
            }
        } catch (_) {}
    }

    // --- 6. Panggil garbage collector jika tersedia ---
    if (global.gc) {
        try {
            global.gc();
        } catch (_) {}
    }

    console.log('✅ Cleanup total selesai.');
}

// ============ SOLVER MODULES ============
const turnstile = require('./Api/turnstile');
const interstitial = require('./Api/interstitial');
const recaptchaV2 = require('./Api/recaptcha2');
const recaptchaV3 = require('./Api/recaptcha3');

// ============ 404 HANDLER ============
app.use((req, res) => {
    res.status(404).json({ message: 'Not Found' });
    console.warn(`error: ${req.method} ${req.originalUrl}`);
});

// ============ START SERVER ============
app.listen(port, () => {
    console.log(`Server running: http://localhost:${port}`);
    console.log(`Cleanup aman aktif: setiap task dibersihkan tanpa pkill global atau rm -rf /tmp/*`);
    console.log(`Jalankan dengan "node --expose-gc Api.js" untuk GC manual.`);
});
