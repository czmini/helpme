/**
 * INTERSTITIAL
 */
async function interstitial({ domain, proxy }, page) {
    return new Promise(async (resolve, reject) => {
        if (!domain) return reject(new Error("Missing domain parameter"));

        const startTime = Date.now();
        let isResolved = false;
        let userAgent = null;

        const cl = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve({
                    cf_clearance: null,
                    cookies: null,
                    user_agent: userAgent,
                    type: 'interstitial'
                });
            }
        }, 20000);

        try {
            if (proxy?.username && proxy?.password) {
                await page.authenticate({
                    username: proxy.username,
                    password: proxy.password,
                });
            }

            page.removeAllListeners("request");
            page.removeAllListeners("response");
            await page.setRequestInterception(true);

            page.on("request", async (req) => {
                try {
                    await req.continue();
                } catch (_) {}
            });

            page.on("response", async (res) => {
                try {
                    const url = res.url();
                    if (url.includes("/cdn-cgi/challenge-platform/")) {
                        const headers = res.headers();
                        if (headers["set-cookie"]) {
                            const cookies = headers["set-cookie"];
                            const match = cookies.match(/cf_clearance=([^;]+)/);
                            if (match) {
                                const cf_clearance = match[1];
                                const userAgent = (await res.request().headers())["user-agent"];

                                if (!isResolved) {
                                    isResolved = true;
                                    clearTimeout(cl);
                                    resolve({
                                        cf_clearance,
                                        cookies,          // seluruh cookie string
                                        user_agent: userAgent,
                                        type: 'interstitial'
                                    });
                                }
                            }
                        }
                    }
                } catch (_) {}
            });

            await page.goto(domain, { waitUntil: "domcontentloaded" });
            userAgent = await page.evaluate(() => navigator.userAgent);
        } catch (err) {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(cl);
                reject(err);
            }
        }
    });
}

module.exports = interstitial;