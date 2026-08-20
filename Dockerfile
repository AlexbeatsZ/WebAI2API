FROM node:22-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

# 1. 安装系统依赖
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libgbm1 \
    libdbus-glib-1-2 \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. 安装服务依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/ ./scripts/
COPY patches/ ./patches/
RUN npm install -g pnpm@10.34.5 && pnpm install --frozen-lockfile

# 3. 复制源码、构建控制台并初始化 Camoufox
COPY . .
RUN pnpm --dir webui install --frozen-lockfile && pnpm --dir webui build
RUN npm run init

EXPOSE 3000

# 每个浏览器配置自行管理 Xvfb/VNC，不启动共享桌面。
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
