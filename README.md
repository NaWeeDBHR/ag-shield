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

- **Zero Dependencies:** Pure Node.js standard library (`http`, `fs`, `path`, `events`). Instant start, tiny footprint, zero vulnerabilities.
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

# Flags:
#   --log, -l           Append traffic events to proxy-traffic.log
#   --no-tools          Disable tool schema simplification
#   --no-local-title    Disable mocking of session_title calls
#   --help, -h          Show help message
```

---

## 🖥️ Web Control Dashboard

Open **`http://127.0.0.1:20129/ui`** in your browser:

- **Live KPIs:** Total requests, signatures neutralized, RPM quota saved, upstream errors trapped.
- **Feature Toggles:** Real-time toggles for signature stripping, schema simplification, reasoning effort mapping, and user-agent spoofing.
- **Upstream Target:** Easily adjust target host and port without restarting.
- **Custom Text Filters:** Add custom regex or text replacement rules.
- **Live Traffic Inspector:** Real-time table showing latency, HTTP status, tool count, and an inspect drawer for payload debugging.

---

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
