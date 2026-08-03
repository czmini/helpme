FROM python:3.9-slim

ENV DEBIAN_FRONTEND=noninteractive

# ==========================================================
# System
# ==========================================================

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        wget \
        unzip \
        xvfb \
        dumb-init \
        ca-certificates \
        gnupg \
        fonts-liberation \
        fonts-noto-color-emoji \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
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
        libxshmfence1 && \
    rm -rf /var/lib/apt/lists/*

# ==========================================================
# Google Chrome
# ==========================================================

RUN mkdir -p /etc/apt/keyrings && \
    wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/keyrings/google.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

# ==========================================================
# NodeJS
# ==========================================================

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest && \
    npm cache clean --force

# ==========================================================
# Environment
# ==========================================================

ENV DISPLAY=:99
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_BIN=/usr/bin/google-chrome
ENV CHROME_PATH=/usr/bin/google-chrome
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# ==========================================================
# Copy Files
# ==========================================================

COPY requirements.txt .
COPY Api.zip .

# ==========================================================
# Extract Api
# ==========================================================

RUN unzip Api.zip && \
    rm Api.zip

# ==========================================================
# Python
# ==========================================================

RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# ==========================================================
# Node
# ==========================================================

WORKDIR /app/Api

RUN npm install --omit=dev

RUN npm install \
    generic-pool \
    p-queue@7 \
    jimp \
    tesseract.js \
    playwright

WORKDIR /app

# ==========================================================
# Startup Script
# ==========================================================

RUN cat > /start.sh <<'EOF'
#!/bin/bash
set -e

echo "=================================="
echo " Starting Container"
echo "=================================="

cleanup() {
    echo ""
    echo "Stopping..."

    kill ${APP_PID:-0} 2>/dev/null || true
    kill ${API_PID:-0} 2>/dev/null || true

    pkill -f Api.js || true
    pkill -f app.py || true

    exit 0
}

trap cleanup SIGINT SIGTERM

export DISPLAY=:99

if ! pgrep -x Xvfb >/dev/null; then
    rm -f /tmp/.X99-lock
    rm -rf /tmp/.X11-unix/X99

    echo "Starting Xvfb..."

    Xvfb :99 \
        -screen 0 1366x768x24 \
        -ac \
        +extension RANDR >/tmp/xvfb.log 2>&1 &

    sleep 2
else
    echo "Xvfb already running."
fi

echo "Starting Api.js..."

cd /app/Api

node --expose-gc --no-deprecation Api.js &
API_PID=$!

echo "Waiting API..."

for i in $(seq 1 120); do
    if curl -fs http://127.0.0.1:8080 >/dev/null 2>&1; then
        echo "API Ready"
        break
    fi

    echo "Waiting... $i/120"
    sleep 1
done

curl -fs http://127.0.0.1:8080 >/dev/null



cd /app



echo "API PID : $API_PID"


wait -n $API_PID 

cleanup

EOF

RUN chmod +x /start.sh

# ==========================================================
# Health Check
# ==========================================================

HEALTHCHECK \
--interval=30s \
--timeout=10s \
--start-period=30s \
--retries=5 \
CMD curl -fs http://127.0.0.1:8080 || exit 1

EXPOSE 8080

ENTRYPOINT ["dumb-init","--"]

CMD ["/start.sh"]