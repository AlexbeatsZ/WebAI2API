# WebAI2API

简体中文 | [English](README_EN.md)

WebAI2API 通过独立浏览器连接操作已登录的 AI 网站，并提供 OpenAI 兼容的聊天接口。文本、图片与视频是模型能力，不需要为相同网站配置不同的“生成模式”。

## 工作方式

- 浏览器连接：一套登录目录、指纹、代理和独立浏览器进程。
- 网站：连接中要使用的网页服务，例如 Gemini、AI Studio 或 ChatGPT。
- 并发页：同一连接中可同时工作的独立页面；每页一次只处理一个请求。
- 强隔离：使用不同连接隔离账号、代理、浏览器故障和实时桌面。

调度器只把请求分配给兼容且空闲的页面。页面连续失败会被恢复或隔离；重启单个连接不会中断其他连接。

## Docker

```yaml
services:
  webai-2api:
    image: ghcr.io/alexbeatsz/webai2api:4.0.0
    container_name: webai-2api
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    shm_size: 2gb
    init: true
```

```bash
docker compose up -d
```

首次启动会把 `config.example.yaml` 复制为 `data/config.yaml`。打开 `http://localhost:3000`，在“实时浏览器”中分别完成各连接所需的登录、条款或验证。

## 配置

```yaml
version: 4
runtime:
  scheduling: least_loaded
  queueBuffer: 2
  requestTimeoutMs: 120000
  maxRetries: 2
  imageLimit: 5

browserProfiles:
  - id: google-main
    name: Google
    userDataDir: camoufoxUserData_Meta
    proxy:
      enabled: true
      type: http
      host: host.docker.internal
      port: 7897
    sites:
      - id: gemini-web
        pages: 2
      - id: ai-studio
        pages: 2
```

两个浏览器连接不能共享同一个 `userDataDir`。修改连接或浏览器设置后需重启服务；移除连接不会删除登录目录。

### 固定 ChatGPT Project + MCP

为 AI Decision 这类 Project 工作流启用深会话模式：

```yaml
backend:
  adapter:
    chatgpt_text:
      projectUrl: https://chatgpt.com/g/g-p-example/project
      mcpAppName: AI Decision
      requireMcpApp: true
      conversationRolloverMode: run_count # run_count | fixed_time | manual
      maxRunsPerChat: 80
      timezone: Asia/Shanghai
      logicalDayStartsAtHour: 4
```

此模式每个浏览器连接只允许一个 ChatGPT 并发页。它从 OpenClaw 标记的 `Conversation info` 提取稳定消息 ID，在固定 Project 内复用并恢复 Active Chat，并为每条消息选择 MCP App。网页最终回复只作为观察返回；面向用户的内容必须由 MCP Decision 产生的 Delivery Effect 投递。

手动换会话使用 `POST /admin/runtime/profiles/:profile/chatgpt/conversation/roll`；`GET /admin/runtime/profiles/:profile/chatgpt/conversation` 返回脱敏状态。

### 从 v3 迁移

v4 不会隐式读取 `instances`/`workers`。先预览，再写入一个新文件：

```bash
npm run migrate-config -- --input data/config.yaml --output data/config.v4.yaml --dry-run
npm run migrate-config -- --input data/config.yaml --output data/config.v4.yaml --write
```

迁移器不会覆盖目标文件，也不会移动、合并或删除浏览器登录目录。

## API

`GET /v1/models` 返回当前连接可用的规范模型 ID、输入输出能力、推理能力和可用状态。模型 ID 始终包含网站命名空间，例如：

- `gemini-web/gemini-3.1-pro`
- `ai-studio/gemini-3.1-pro`

v4 请求必须明确提供这里返回的模型 ID：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "ai-studio/gemini-3.1-pro",
    "messages": [
      {"role": "system", "content": "回答要准确、简洁。"},
      {"role": "user", "content": "解释量子隧穿。"}
    ],
    "stream": true
  }'
```

图片输入使用 OpenAI 的 `image_url` 内容块和 Base64 Data URL。完整消息角色、顺序与历史会被保留；AI Studio 会把 system 消息写入 System Instructions。

### 健康与检修

- `GET /health`：无需认证的脱敏就绪状态，适合容器健康检查。
- `GET /admin/diagnostics`：运行时、队列、网站缓存和连接状态快照，不包含 Cookie、凭据或消息正文。
- `GET /admin/runtime/profiles/:profile/sites/:site/check`：在指定连接内检查网页与模型发现状态，不发送模型请求。
- `POST /admin/runtime/profiles/:profile/sites/:site/probe`：在指定连接和网站的页面槽上执行真实探测。请求体为 `{"model":"规范模型 ID","prompt":"可选文本","timeoutMs":60000}`，不会转移到其他连接。
- `POST /admin/sites/:site/models/refresh` 与 `POST /admin/runtime/profiles/:profile/restart`：刷新网页模型和单独重启连接。
- `GET /admin/runtime/profiles/:profile/chatgpt/conversation` 与对应的 `POST .../roll`：读取 Active Chat 状态或请求手动换会话。

除 `/health` 外，以上管理接口使用与主 API 相同的访问令牌。诊断快照可以从控制台的“诊断”抽屉下载。

## 本地开发

需要 Node.js 22、pnpm、Camoufox，以及 Linux 上的 Xvfb/x11vnc。

```bash
pnpm install
pnpm --dir webui install
npm run init
npm test
pnpm --dir webui build
npm start
```

浏览器连接的 VNC 只监听容器内部回环地址，并通过管理端的连接专属 WebSocket 转发。若 `server.auth` 留空，API 和管理端均不验证身份；只应在可信网络使用。

## License

[MIT](LICENSE)
