/**
 * recaptcha3.js
 */
async function recaptchaV3({ domain, siteKey, action, proxy }, page) {
    if (!domain) throw new Error("Missing domain parameter");
    if (!siteKey) throw new Error("Missing siteKey parameter");

    const timeout = 120000;

    return new Promise(async (resolve, reject) => {
        let isResolved = false;

        const cl = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                reject(new Error("Timeout Error"));
            }
        }, timeout);

        try {
            if (proxy?.username && proxy?.password) {
                await page.authenticate({
                    username: proxy.username,
                    password: proxy.password,
                });
            }

            await page.goto(domain, { waitUntil: "domcontentloaded" });

            await page.addScriptTag({ url: "https://www.google.com/recaptcha/api.js?render=" + siteKey });

            const token = await page.evaluate(async (siteKey, action) => {
                return await grecaptcha.execute(siteKey, { action: action || "login" });
            }, siteKey, action);

            isResolved = true;
            clearTimeout(cl);

            if (!token || token.length < 10) {
                reject(new Error("Failed to get token"));
            } else {
                resolve({ token: token, type: "recaptcha3" });
            }
        } catch (e) {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(cl);
                reject(e);
            }
        }
    });
}

module.exports = recaptchaV3;