# AG-SHIELD 🛡️
### Antigravity & Agentic AI Sanitizer Proxy + Live Web Dashboard

Zero-dependency, high-performance Node.js reverse-proxy and universal agentic middleware. Sits transparently between agentic coding clients (**Hermes Agent**, **OpenClaw**, **Roo Code / Cline**, **Cursor**, **Aider**) and upstream AI gateways (**9Router**, **Antigravity**, **LiteLLM**, **New-API**, **OpenRouter**, or native **Google Gemini OpenAI-compat endpoints**).

```
                      ┌────────────────────────────────────────┐
                      │    Agentic AI Client (Hermes, Cline)   │
                      └──────────────────┬─────────────────────┘
                                         │  HTTP / SSE
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │          AG-SHIELD (:20129)                      │
                 │  - Strips agent identity & runtime fingerprints  │
                 │  - Collapses complex JSON schema `anyOf` / strict │
                 │  - Normalizes `reasoning_effort: "none"` -> "low"│
                 │  - Mocks local `session_title` (Saves RPM quota) │
                 │  - Spoofs standard OpenAI SDK User-Agent         │
                 │  - Live Web UI & SSE Traffic Inspector (/ui)     │
                 │  - Upstream Router Config + Ping Connectivity    │
                 │  - Optional System Boot Autostart (Startup)      │
                 └───────────────────────┬──────────────────────────┘
                                         │  Sanitized HTTP / SSE
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │  Upstream Gateway (:20128) / Gemini / LiteLLM    │
                 └──────────────────────────────────────────────────┘
```

---

## ⚡ Why AG-Shield?

When running modern agentic coding frameworks with aggressive tool-calling or reasoning models, upstream providers and Google Gemini OpenAI-compatibility layers frequently fail with false-positive errors:

1. **False-Positive 429 & 403 Blocks:** Upstream security layers flag agent system prompts (e.g. `Hermes Agent`, `OpenClaw`, `Cline`, host paths, environment directives) as suspicious bot traffic.
2. **Tool Schema Rejections (400 / 429):** Google Gemini OpenAI endpoints choke on nested `anyOf` with nullable parameters, `strict: true`, `$schema`, `additionalProperties`, and numeric bounds (`minItems`, `maxItems`).
3. **RPM Quota Exhaustion from Background Titles:** Clients like Cline, Roo, or OpenClaw fire background requests to summarize session titles. These waste precious Rate-Per-Minute (RPM) quota and trigger `429 RESOURCE_EXHAUSTED` or fail with `400 INVALID_ARGUMENT` when sent with `reasoning_effort: "none"`.

**AG-Shield solves all of these on the fly with zero external dependencies.**

---

## ✨ Features

- **Zero Dependencies:** Pure Node.js standard library (`http`, `https`, `fs`, `path`, `events`). Instant start, tiny footprint, zero vulnerabilities.
- **Auto-Update & Versioning:** Real-time version display in Web UI and CLI. Automatically notifies when an update is released on GitHub/npm with one-click web update and CLI command (`node index.js --update`).
- **Main Router Control Panel:** Full configuration panel in Web UI to set upstream protocol (`http`/`https`), host, port, API bearer key, and base path with presets (9Router, LiteLLM, OpenRouter, Gemini) and a real-time connectivity ping tester.
- **System Boot Autostart:** Seamless one-click background autostart toggle on OS boot (Windows VBS Startup folder, macOS LaunchAgents plist, Linux autostart desktop entry).
- **Agent Signature Neutralizer:** Automatically removes agent identity tags, environment paths, and system fingerprint headers while preserving the core task prompt.
- **Tool Schema Simplifier:** Recursively collapses `anyOf` definitions, removes `strict: true`, `$schema`, and `additionalProperties` so tool schemas comply with strict upstream parsers.
- **Reasoning Effort Fixer:** Translates unsupported `reasoning_effort: "none"` to `"low"` to avoid `400 INVALID_ARGUMENT` crashes.
- **Local Title Mocker:** Detects background title requests and returns synthetic OpenAI-compatible completion responses in `<2ms`, saving 100% of background RPM quota.
- **Sleek Web Dashboard (`/ui`):** Dark-mode glassmorphism dashboard with real-time SSE stream, KPI counters, toggle controls, and live request/response inspection drawer.
- **Runtime Persistence:** Settings toggled via Web UI persist across restarts in `ag-shield.config.json`.
- **CORS & SSE Streaming:** Full Server-Sent Events (SSE) streaming passthrough with automatic CORS headers (`Access-Control-Allow-Origin: *`).

---

## 🚀 Quick Start

### Run with NPX
```bash
npx ag-shield
```

### Or Clone & Run Locally
```bash
git clone https://github.com/NaWeeDBHR/ag-shield.git
cd ag-shield
node index.js
```

### CLI Options
```bash
# Custom listen port and upstream port
node index.js 20129 20128

# Custom upstream host & file logging
node index.js --host 192.168.1.100 --target-port 8000 --log

# Version & Self-Update CLI commands:
node index.js --version            # Show current version (v1.0.0)
node index.js --update             # Check for updates and automatically update (git/npm)

# System Autostart CLI commands:
node index.js --autostart-enable   # Register in Windows Startup / Linux systemd-user
node index.js --autostart-disable  # Remove from boot startup
node index.js --autostart-status   # Show current autostart status
sudo node index.js --install-systemd # Install & enable system-wide Linux systemd service

# Flags:
#   --log, -l              Append traffic events to proxy-traffic.log
#   --no-tools             Disable tool schema simplification
#   --no-local-title       Disable mocking of session_title calls
#   --protocol <http|https> Upstream protocol
#   --help, -h             Show help message
```

---

## 🖥️ Web Control Dashboard

Open **`http://127.0.0.1:20129/ui`** in your browser:

- **Main Upstream Router (مشخصات روتر اصلی):** Select presets (9Router, LiteLLM, OpenRouter, Google Gemini) or enter custom Host, Port, Protocol, and API Key. Includes **⚡ Test Ping** button to verify upstream health live.
- **System Boot Autostart:** Toggle silent background launch on OS startup with one click.
- **Live KPIs:** Total requests, signatures neutralized, RPM quota saved, upstream errors trapped.
- **Granular Rule Customization:** Every toggle includes an expandable `⚙️ Rules` panel:
  - **Strip Signatures:** Customize replacement intro text and edit exact regex / signature patterns to strip.
  - **Tool Schemas:** Toggle individual schema rules: `strict: true`, `$schema`, `additionalProperties`, `min/max bounds`, and `anyOf` collapsing.
  - **Reasoning Effort:** Configure source value (`none`) and target mapping (`low`, `medium`, `high`, or `remove`).
  - **Local Titles:** Customize the synthetic session title text and regex trigger keywords.
  - **User-Agent Spoofing:** Customize the User-Agent header with one-click presets (Node SDK, Python SDK, Cursor, curl).
- **Custom Text Filters:** Add custom regex or text replacement rules.
- **Live Traffic Inspector:** Real-time table showing latency, HTTP status, tool count, and an inspect drawer for payload debugging.

---


---

## 🐧 Linux Server / VPS Setup

On Linux headless servers (Ubuntu, Debian, CentOS), you can run AG-Shield as a native background `systemd` service:

### Option A: Automatic 1-Liner Systemd Installation
```bash
sudo node index.js --install-systemd
```
This automatically writes `/etc/systemd/system/ag-shield.service`, reloads systemd, and starts AG-Shield on boot.

### Option B: User-Level Service (No Root Required)
```bash
node index.js --autostart-enable
# Keep service running when SSH disconnects:
loginctl enable-linger $USER
```

### Option C: PM2
```bash
npm install -g pm2
pm2 start index.js --name ag-shield
pm2 startup
pm2 save
```

## 🔧 Client Configuration

Point your agent or SDK base URL to `http://127.0.0.1:20129/v1`:

### 1. Hermes Agent
In your `config.yaml` or environment:
```yaml
model: "gemini-2.5-pro"
provider: "custom"
api_base: "http://127.0.0.1:20129/v1"
api_key: "dummy-key-or-upstream-token"
```

### 2. OpenClaw
```json
{
  "apiBase": "http://127.0.0.1:20129/v1",
  "apiKey": "your-key",
  "model": "gemini-2.5-pro"
}
```

### 3. Roo Code / Cline (VS Code Extension)
1. Select **OpenAI Compatible** provider.
2. Base URL: `http://127.0.0.1:20129/v1`
3. API Key: any string (or your upstream key)
4. Model ID: your target model (e.g. `gemini-2.5-pro`, `gpt-4o`)

### 4. Cursor
1. Settings &rarr; Models &rarr; OpenAI API Key &rarr; Override Base URL:
2. URL: `http://127.0.0.1:20129/v1`

### 5. Aider
```bash
aider --openai-api-base http://127.0.0.1:20129/v1 --openai-api-key dummy
```

---

## 🧪 Testing

Run the included assert-based self-check suite:
```bash
npm test
```

---

## 📄 License

MIT License. Free for open source and commercial use.
