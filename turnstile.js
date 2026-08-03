async function turnstile({ domain, siteKey, action, proxy }, page) {
  if (!domain) throw new Error("Missing domain parameter");
  if (!siteKey) throw new Error("Missing siteKey parameter");

  const timeout = global.timeOut || 60000; // default 60 detik

  return new Promise(async (resolve, reject) => {
    let isResolved = false;
    const cl = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        reject(new Error("Timeout Error"));
      }
    }, timeout);

    try {
      // Proxy authentication jika diperlukan
      if (proxy?.username && proxy?.password) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password,
        });
      }

      // HTML halaman dengan widget Turnstile - menggunakan class .cf-turnstile
      const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <body>
          <div class="cf-turnstile"></div>
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback" defer></script>
          <script>
            window.onloadTurnstileCallback = function () {
              turnstile.render('.cf-turnstile', {
                sitekey: '${siteKey}',
                action: '${action || ""}'
              });
            };
          </script>
        </body>
        </html>
      `;

      // Intercept request untuk menyuntikkan HTML
      await page.setRequestInterception(true);
      page.removeAllListeners("request");
      page.on("request", async (request) => {
        if ([domain, domain + "/"].includes(request.url()) && request.resourceType() === "document") {
          await request.respond({
            status: 200,
            contentType: "text/html",
            body: htmlContent,
          });
        } else {
          await request.continue();
        }
      });

      await page.goto(domain, { waitUntil: "domcontentloaded" });

      // === TUNGGU SAMPAI TOKEN TERISI (panjang > 10) ===
      const tokenHandle = await page.waitForFunction(
        (minLength = 10) => {
          const el = document.querySelector(
            '.cf-turnstile input[name="cf-turnstile-response"]'
          );
          // Kembalikan nilai jika ada dan panjang >= minLength, else false
          return el && el.value && el.value.length >= minLength ? el.value : false;
        },
        { timeout, polling: 200 },
        10 // argumen minLength
      );

      const token = await tokenHandle.jsonValue();

      isResolved = true;
      clearTimeout(cl);

      if (!token || token.length < 10) {
        reject(new Error("Failed to get token"));
      } else {
        resolve({ token, type: 'turnstile' });
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

module.exports = turnstile;