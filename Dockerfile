# ==========================================================
# BASE IMAGE
# ==========================================================

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production

# Chrome / Browser
ENV DISPLAY=:99
ENV CHROME_BIN=/usr/bin/google-chrome
ENV CHROME_PATH=/usr/bin/google-chrome
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app


# ==========================================================
# SYSTEM DEPENDENCIES
# ==========================================================

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        unzip \
        gnupg \
        xvfb \
        dumb-init \
        procps \
        fonts-liberation \
        fonts-noto-color-emoji \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libu2f-udev \
        libvulkan1 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
    && rm -rf /var/lib/apt/lists/*


# ==========================================================
# GOOGLE CHROME
# ==========================================================

RUN mkdir -p /etc/apt/keyrings && \
    wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /etc/apt/keyrings/google.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*


# ==========================================================
# NODE.JS 20
# ==========================================================

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g npm@10 && \
    npm cache clean --force && \
    rm -rf /var/lib/apt/lists/*


# ==========================================================
# CHECK VERSIONS
# ==========================================================

RUN python --version && \
    pip --version && \
    node --version && \
    npm --version && \
    google-chrome --version


# ==========================================================
# PYTHON REQUIREMENTS
# ==========================================================

COPY requirements.txt /app/requirements.txt

RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r /app/requirements.txt


# ==========================================================
# COPY API
# ==========================================================

COPY Api.zip /app/Api.zip


# ==========================================================
# EXTRACT API
# ==========================================================

RUN unzip -q /app/Api.zip -d /app/ && \
    rm -f /app/Api.zip


# ==========================================================
# FIND / NORMALIZE API DIRECTORY
# ==========================================================

RUN if [ ! -f /app/Api/Api.js ]; then \
        echo "ERROR: /app/Api/Api.js tidak ditemukan"; \
        echo "Isi /app:"; \
        find /app -maxdepth 3 -type f | sort; \
        exit 1; \
    fi


# ==========================================================
# NODE DEPENDENCIES
# ==========================================================

WORKDIR /app/Api

RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --omit=dev; \
    fi


# ==========================================================
# ADDITIONAL NODE MODULES
# ==========================================================

RUN npm install --omit=dev \
        generic-pool \
        p-queue@7 \
        jimp \
        tesseract.js \
        playwright


# ==========================================================
# VERIFY NODE MODULES
# ==========================================================

RUN node -e "require('generic-pool'); console.log('generic-pool OK')" && \
    node -e "require('p-queue'); console.log('p-queue OK')" && \
    node -e "require('jimp'); console.log('jimp OK')" && \
    node -e "require('tesseract.js'); console.log('tesseract.js OK')" && \
    node -e "require('playwright'); console.log('playwright OK')"


# ==========================================================
# VERIFY CHROME
# ==========================================================

RUN google-chrome \
        --headless \
        --no-sandbox \
        --disable-dev-shm-usage \
        --disable-gpu \
        --dump-dom \
        https://example.com \
        >/tmp/chrome-test.html 2>/tmp/chrome-test.log \
    || (cat /tmp/chrome-test.log && exit 1)

RUN grep -qi "Example Domain" /tmp/chrome-test.html || \
    (echo "Chrome test gagal"; cat /tmp/chrome-test.html; exit 1)


# ==========================================================
# BACK TO APP
# ==========================================================

WORKDIR /app


# ==========================================================
# STARTUP SCRIPT
# ==========================================================

RUN cat > /start.sh <<'EOF'
#!/bin/bash

set -u

echo "=============================================="
echo " Container Starting"
echo "=============================================="

APP_PID=0
API_PID=0
XVFB_PID=0

cleanup() {
    echo ""
    echo "=============================================="
    echo " Stopping Container"
    echo "=============================================="

    if [ "$APP_PID" -ne 0 ] 2>/dev/null; then
        kill "$APP_PID" 2>/dev/null || true
    fi

    if [ "$API_PID" -ne 0 ] 2>/dev/null; then
        kill "$API_PID" 2>/dev/null || true
    fi

    if [ "$XVFB_PID" -ne 0 ] 2>/dev/null; then
        kill "$XVFB_PID" 2>/dev/null || true
    fi

    pkill -f "Api.js" 2>/dev/null || true
    pkill -f "Xvfb :99" 2>/dev/null || true

    echo "Container stopped."
}

trap cleanup SIGINT SIGTERM EXIT


# ==========================================================
# ENVIRONMENT
# ==========================================================

export DISPLAY=:99
export CHROME_BIN=/usr/bin/google-chrome
export CHROME_PATH=/usr/bin/google-chrome
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome


echo ""
echo "Python:"
python --version

echo ""
echo "Node:"
node --version

echo ""
echo "Chrome:"
google-chrome --version

echo ""
echo "DISPLAY=$DISPLAY"
echo "CHROME_BIN=$CHROME_BIN"


# ==========================================================
# CLEAN OLD X SERVER
# ==========================================================

rm -f /tmp/.X99-lock
rm -rf /tmp/.X11-unix/X99


# ==========================================================
# START XVFB
# ==========================================================

echo ""
echo "Starting Xvfb..."

Xvfb :99 \
    -screen 0 1366x768x24 \
    -ac \
    -nolisten tcp \
    +extension RANDR \
    >/tmp/xvfb.log 2>&1 &

XVFB_PID=$!

sleep 2

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "ERROR: Xvfb gagal start"
    cat /tmp/xvfb.log || true
    exit 1
fi

echo "Xvfb started. PID=$XVFB_PID"


# ==========================================================
# START API
# ==========================================================

echo ""
echo "=============================================="
echo " Starting Api.js"
echo "=============================================="

cd /app/Api

node --expose-gc --no-deprecation Api.js \
    >/tmp/api.log 2>&1 &

API_PID=$!

echo "API PID: $API_PID"


# ==========================================================
# WAIT API
# ==========================================================

echo ""
echo "Waiting for API on port 8080..."

API_READY=0

for i in $(seq 1 120); do

    if ! kill -0 "$API_PID" 2>/dev/null; then
        echo ""
        echo "ERROR: Api.js berhenti sebelum ready."
        echo "========== API LOG =========="
        cat /tmp/api.log || true
        echo "============================="
        exit 1
    fi

    if curl -fsS \
        --max-time 3 \
        http://127.0.0.1:8080 \
        >/dev/null 2>&1; then

        API_READY=1
        echo "API Ready!"
        break
    fi

    echo "Waiting... $i/120"
    sleep 1
done


# ==========================================================
# API TIMEOUT
# ==========================================================

if [ "$API_READY" -ne 1 ]; then

    echo ""
    echo "ERROR: API tidak ready setelah 120 detik."

    echo ""
    echo "========== API LOG =========="
    cat /tmp/api.log || true
    echo "============================="

    echo ""
    echo "========== XVFB LOG =========="
    cat /tmp/xvfb.log || true
    echo "=============================="

    exit 1
fi


# ==========================================================
# FINAL STATUS
# ==========================================================

echo ""
echo "=============================================="
echo " API STATUS"
echo "=============================================="

echo "API PID   : $API_PID"
echo "Xvfb PID  : $XVFB_PID"
echo "API       : http://127.0.0.1:8080"
echo "Chrome    : $CHROME_BIN"
echo "Display   : $DISPLAY"

echo ""
echo "API is running."
echo "Container is ready."
echo "=============================================="


# ==========================================================
# KEEP CONTAINER ALIVE
# ==========================================================

while true; do

    if ! kill -0 "$API_PID" 2>/dev/null; then
        echo ""
        echo "ERROR: Api.js berhenti."

        echo ""
        echo "========== API LOG =========="
        cat /tmp/api.log || true
        echo "============================="

        exit 1
    fi

    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo ""
        echo "ERROR: Xvfb berhenti."

        echo ""
        echo "========== XVFB LOG =========="
        cat /tmp/xvfb.log || true
        echo "=============================="

        exit 1
    fi

    sleep 10

done

EOF


# ==========================================================
# PERMISSIONS
# ==========================================================

RUN chmod +x /start.sh


# ==========================================================
# HEALTH CHECK
# ==========================================================

HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --start-period=60s \
    --retries=5 \
    CMD curl -fsS --max-time 5 http://127.0.0.1:8080 || exit 1


# ==========================================================
# PORT
# ==========================================================

EXPOSE 8080


# ==========================================================
# INIT
# ==========================================================

ENTRYPOINT ["dumb-init", "--"]


# ==========================================================
# START
# ==========================================================

CMD ["/start.sh"]