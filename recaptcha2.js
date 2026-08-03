/**
 * API_RECAPTCHA2
 */
async function recaptchaV2({ domain, siteKey, action = "submit", isInvisible = false, proxy }, page) {
    if (!domain) throw new Error("Missing domain parameter");
    if (!siteKey) throw new Error("Missing siteKey parameter");

    const timeout = global.timeOut;

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

            const htmlContent = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>reCAPTCHA v2 Solver</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 0;
                            padding: 20px;
                            background: #f5f5f5;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            min-height: 100vh;
                        }
                        .container {
                            background: white;
                            padding: 30px;
                            border-radius: 10px;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            text-align: center;
                        }
                        .status {
                            margin-top: 20px;
                            padding: 10px;
                            border-radius: 5px;
                            background: #f8f9fa;
                        }
                        button {
                            background: #007bff;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            margin: 10px;
                        }
                        button:hover { background: #0056b3; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2>reCAPTCHA v2 Solver</h2>
                        <p>SiteKey: ${siteKey}</p>
                        <div id="recaptcha-container">
                            <div class="g-recaptcha"
                                 data-sitekey="${siteKey}"
                                 data-callback="recaptchaCallback"
                                 data-expired-callback="recaptchaExpired"
                                 data-error-callback="recaptchaError"
                                 data-size="${isInvisible ? 'invisible' : 'normal'}"
                                 data-theme="light"></div>
                        </div>
                        ${isInvisible ? '<button onclick="executeInvisible()">Execute reCAPTCHA</button>' : ''}
                        <button onclick="checkToken()">Check Token</button>
                        <div class="status" id="status">Waiting for reCAPTCHA...</div>
                    </div>

                    <script>
                        window.recaptchaToken = null;
                        window.recaptchaSolved = false;

                        window.recaptchaCallback = function(token) {
                            console.log('reCAPTCHA token received:', token);
                            window.recaptchaToken = token;
                            window.recaptchaSolved = true;

                            document.getElementById('status').innerHTML =
                                '✅ reCAPTCHA Solved! Token: ' + token.substring(0, 20) + '...';
                            document.getElementById('status').style.background = '#d4edda';
                            document.getElementById('status').style.color = '#155724';

                            var input = document.createElement('input');
                            input.type = 'hidden';
                            input.name = 'g-recaptcha-response';
                            input.value = token;
                            input.id = 'recaptcha-token-input';
                            document.body.appendChild(input);

                            localStorage.setItem('recaptcha_token', token);
                        };

                        window.recaptchaExpired = function() {
                            console.log('reCAPTCHA expired');
                            window.recaptchaToken = null;
                            window.recaptchaSolved = false;
                            document.getElementById('status').innerHTML = '❌ reCAPTCHA Expired - Refreshing...';
                            document.getElementById('status').style.background = '#fff3cd';
                            document.getElementById('status').style.color = '#856404';

                            var existing = document.getElementById('recaptcha-token-input');
                            if (existing) existing.remove();

                            setTimeout(() => { if (window.grecaptcha) grecaptcha.reset(); }, 1000);
                        };

                        window.recaptchaError = function() {
                            console.log('reCAPTCHA error');
                            document.getElementById('status').innerHTML = '❌ reCAPTCHA Error';
                            document.getElementById('status').style.background = '#f8d7da';
                            document.getElementById('status').style.color = '#721c24';
                        };

                        window.executeInvisible = function() {
                            if (window.grecaptcha) grecaptcha.execute();
                        };

                        window.checkToken = function() {
                            const token = window.recaptchaToken ||
                                          document.getElementById('recaptcha-token-input')?.value;
                            document.getElementById('status').innerHTML = token
                                ? 'Token: ' + token
                                : 'No token yet';
                        };

                        window.onload = function() {
                            setTimeout(function() {
                                if (${isInvisible} && window.grecaptcha) {
                                    grecaptcha.execute();
                                }
                                if (!${isInvisible}) {
                                    var iframe = document.querySelector('iframe[src*="recaptcha"]');
                                    if (iframe) {
                                        console.log('Attempting to interact with reCAPTCHA');
                                        var rect = iframe.getBoundingClientRect();
                                        var clickEvent = new MouseEvent('click', {
                                            view: window, bubbles: true, cancelable: true,
                                            clientX: rect.left + rect.width / 2,
                                            clientY: rect.top + rect.height / 2
                                        });
                                        iframe.dispatchEvent(clickEvent);
                                    }
                                }
                            }, 2000);
                        };
                    </script>

                    <script src="https://www.google.com/recaptcha/api.js" async defer></script>
                </body>
                </html>
            `;

            await page.setRequestInterception(true);
            page.removeAllListeners("request");
            page.on("request", async (req) => {
                const url = req.url();
                if ([domain, domain + "/"].includes(url) && req.resourceType() === "document") {
                    await req.respond({ status: 200, contentType: "text/html", body: htmlContent });
                } else if (["image", "stylesheet", "font"].includes(req.resourceType())) {
                    await req.abort();
                } else {
                    await req.continue();
                }
            });

            await page.goto(domain, { waitUntil: "domcontentloaded", timeout });
            await page.waitForSelector('.g-recaptcha', { timeout: 10000 });

            const tokenHandle = await page.waitForFunction(() => {
                const input = document.querySelector('#recaptcha-token-input');
                if (input?.value?.length > 10) return input.value;
                const stored = localStorage.getItem('recaptcha_token');
                if (stored?.length > 10) return stored;
                if (window.recaptchaToken?.length > 10) return window.recaptchaToken;
                return null;
            }, { timeout, polling: 100 });

            const tokenValue = await tokenHandle.jsonValue();

            isResolved = true;
            clearTimeout(cl);

            if (!tokenValue || tokenValue.length < 10) {
                reject(new Error("Failed to get valid reCAPTCHA token"));
            } else {
                resolve({ token: tokenValue, type: 'recaptcha_v2' });
            }
        } catch (error) {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(cl);
                try {
                    const fallbackToken = await page.evaluate(() => {
                        const input = document.querySelector('#recaptcha-token-input');
                        return input ? input.value : null;
                    });
                    if (fallbackToken?.length > 10) {
                        resolve({ token: fallbackToken, type: 'recaptcha_v2' });
                        return;
                    }
                } catch {}
                reject(new Error(`reCAPTCHA solving failed: ${error.message}`));
            }
        }
    });
}

module.exports = recaptchaV2;