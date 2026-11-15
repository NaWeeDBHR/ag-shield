# AG-SHIELD 🛡️
> **Universal Sanitizer Proxy & Quota Shield for Antigravity (9Router) & Hermes Agent**
> 
> *Available in [English](#english) and [فارسی](#فارسی)*

---

<a name="english"></a>
## 🇬🇧 English Documentation

### Overview
**AG-Shield** is a zero-dependency, high-performance reverse proxy engineered specifically to sit between **Hermes Agent** and **9Router** running the **Antigravity (Google Gemini)** provider.

When executing real-world agentic tasks, Hermes Agent dispatches extensive system prompts, tool schemas, reasoning parameters, and background requests. Upstream Antigravity endpoints frequently reject these with false-positive **`429 Too Many Requests`**, **`403 Forbidden`**, or **`400 Invalid Argument`** blocks.

**AG-Shield intercepts, sanitizes, and normalizes payloads in real time (`<1ms` latency)**, enabling Hermes Agent to run against 9Router without hitting blocks or wasting rate limits.

---

### Architecture

```
┌────────────────────────────────────────────────────────┐
│               Hermes Agent (:default)                  │
│       (Tool-calls, Prompts, SSE Streaming)             │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / SSE (Port 20129)
                           ▼
┌────────────────────────────────────────────────────────┐
│                   AG-SHIELD PROXY                      │
│                                                        │
│  1. Prompt Neutralizer: Masks Hermes/agent signatures  │
│  2. Schema Simplifier:  Collapses anyOf, drops strict  │
│  3. Reasoning Fixer:    reasoning_effort "none"->"low" │
│  4. Title Mocker:       Serves local titles (JSON/SSE) │
│  5. Header Spoofer:     Clean browser/SDK User-Agent   │
│  6. Live Dashboard:     SSE Inspector & Controls (/ui) │
└──────────────────────────┬─────────────────────────────┘
                           │ Cleaned HTTP / SSE
                           ▼
┌────────────────────────────────────────────────────────┐
│               9Router Gateway (:20128)                 │
│              Antigravity / Gemini Cloud                │
└────────────────────────────────────────────────────────┘
```

---

### ⚡ The Problem: Why Hermes Agent Breaks on 9Router Antigravity

1. **System Prompt Fingerprinting (403 / 429 Blocks):**
   Hermes Agent embeds framework signatures, documentation URLs (`nousresearch.com`), environment paths, and execution directives in `system` and `developer` messages. Antigravity filters detect these fingerprints as automated bot/agent scripts and block the account or trigger rate limits.

2. **Complex Tool Schemas Crashing Gemini (400 / 429 Errors):**
   Hermes provides dozens of native tools (`read_file`, `patch`, `terminal`, etc.) using advanced JSON Schema features: nested `anyOf` with nullable types, `strict: true`, `$schema`, `additionalProperties: false`, and bounds (`minItems`, `maxItems`). Google Gemini OpenAI-compatibility layers choke on these schemas and throw validation rejections.

3. **Unsupported Reasoning Parameters (400 INVALID_ARGUMENT):**
   Certain agent prompts pass `reasoning_effort: "none"`. Upstream Gemini/Antigravity endpoints reject this value, aborting the turn.

4. **Background Quota Exhaustion & Title Loops:**
   Background session-title generation consumes valuable Request-Per-Minute (RPM) quota. If intercepted incorrectly or returned as raw JSON during an SSE streaming request, the agent gets stuck in retry loops and crashes.

---

### 🛡️ How AG-Shield Solves It

- **Agent Signature Neutralizer:** Automatically sanitizes framework references (`Hermes Agent`, documentation links, bot operational headers) inside system messages into neutral assistant text, keeping the prompt intact while bypassing Antigravity filters.
- **Recursive Tool Schema Simplifier:** Strips `strict`, `$schema`, `additionalProperties`, bounds, and collapses nested `anyOf` schemas into clean, Gemini-compliant parameter definitions.
- **Reasoning Effort Normalization:** Safely converts `reasoning_effort: "none"` to `"low"` (or user-defined target), preventing 400 crashes.
- **Stream-Aware Local Title Mocker:** Accurately detects title generation requests (ignoring tool calls and active multi-turn conversations) and answers locally in `<2ms` with full JSON and SSE (`stream: true`) compatibility.
- **User-Agent & Header Spoofing:** Removes leak headers (`x-title`, `x-client-name`, `http-referer`) and applies a standard browser/SDK User-Agent.
- **Zero External Dependencies:** Built entirely with Node.js standard libraries (`http`, `https`, `fs`, `path`). No `node_modules` required for core proxy functionality.
- **Windows System Tray & Linux Daemon:** Built-in Windows tray menu (PowerShell-backed) and native Linux systemd service generator (`--install-systemd`).

---

### 🚀 Quick Start

#### 1. Clone & Start
```bash
git clone https://github.com/NaWeeDBHR/ag-shield.git
cd ag-shield
node index.js
```
*Proxy runs on `http://127.0.0.1:20129` and forwards to 9Router on `http://127.0.0.1:20128`.*

#### 2. CLI Control
```bash
node index.js status      # View live uptime, proxy target, and metrics
node index.js restart     # Gracefully kill previous instance and restart
node index.js stop        # Stop proxy instance on port 20129
npm test                  # Run assert test suite
```

#### 3. Connect Hermes Agent
Configure your Hermes Agent provider or model config to point to AG-Shield:
```yaml
model: "gemini-3.8-flash-n"       # Or gemini-2.5-pro / target model
provider: "custom"
api_base: "http://127.0.0.1:20129/v1"
api_key: "dummy-key-or-token"
```

#### 4. Web Dashboard
Open **`http://127.0.0.1:20129/ui`** in your browser for real-time traffic inspection, latency tracking, upstream router ping test, and rule customization.

---
---

<a name="فارسی"></a>
## 🇮🇷 مستندات فارسی

### معرفی و هدف پروژه
پروژه **AG-Shield** (مخفف Antigravity Shield) یک پروکسی معکوس (Reverse Proxy) بسیار سریع، سبک و بدون وابستگی جانبی (Zero-Dependency) بر پایه Node.js است که به عنوان لایه محافظ میان **Hermes Agent** و روتر هوش مصنوعی **9Router** (به‌ویژه پرووایدر **Antigravity / Gemini**) عمل می‌کند.

هنگام استفاده از فریم‌ورک‌های عامل‌محور مانند Hermes Agent با سرویس Antigravity در 9Router، خطاهای مداوم **`429 Too Many Requests`**، **`403 Forbidden`** و **`400 Invalid Argument`** رخ می‌دهد. 

**وظیفه AG-Shield این است که بسته‌های ارسالی هرمس را در زمان واقعی (زیر ۱ میلی‌ثانیه) بررسی، فیلتر و استاندارد کند تا ارتباط پایدار و بدون وقفه تضمین شود.**

---

### ⚡ چرا ایجنت هرمس (Hermes Agent) روی Antigravity در 9Router متوقف می‌شود؟

1. **حساسیت و مسدودسازی امضای فریم‌ورک (ردپای ایجنت):**
   سیستم پرامپت Hermes Agent حاوی اطلاعات محیط اجرا، مسیرهای فایل، عبارت‌های شناسه (`Hermes Agent`, `nousresearch.com`) و دستورات سختگیرانه عملکردی است. فیلترهای امنیتی Google / Antigravity این پیام‌ها را به عنوان اسکریپت یا ربات غیرمجاز شناسایی کرده و اکانت را با خطای ۴۰۳ یا ۴۲۹ مسدود می‌کنند.

2. **خطای ساختار ابزارها (Tool Schema Rejection):**
   هرمس ایجنت برای کار با محیط (ترمینال، فایل، وب و...) ده‌ها ابزار مختلف را با اسکیماهای پیچیده JSON (شامل `anyOf`, `strict: true`, `additionalProperties` و محدوده‌های عددی) ارسال می‌کند. لایه OpenAI-compatible جمینای در آنتی‌گراویتی قادر به پارس این ساختارهای تودرتو نیست و درخواست را رد می‌کند.

3. **خطای پارامتر استدلال (`reasoning_effort: "none"`):**
   ارسال این پارامتر توسط ایجنت باعث رد شدن درخواست با خطای `400 INVALID_ARGUMENT` در اندپوینت‌های سازگار با جمینای می‌شود.

4. **هدررفت سهمیه با درخواست‌های تایتل (RPM Quota Drain):**
   کلاینت‌ها یا کارهای پس‌زمینه برای خلاصه کردن عنوان چت درخواست‌های مکرر می‌ستند که سهمیه دقیقه (RPM) را می‌سوزاند. هایجک اشتباه این درخواست‌ها در جریان استریم (SSE) باعث بروز لوپ تکرار و کرش ایجنت می‌شد.

---

### 🛡️ وظایف و قابلیت‌های AG-Shield

- **خنثی‌سازی هوشمند امضای هرمس (Signature Neutralizer):**
  بدون دستکاری دستور کاربر، پیام‌های سیستمی و هدرهای معرف را پالایش کرده و متنی خنثی و بدون ردپا جایگزین می‌کند تا توسط آنتی‌گراویتی مسدود نشود.
- **ساده‌سازی خودکار اسکیمای ابزارها (Schema Simplifier):**
  تمام کلیدهای مشکل‌ساز مانند `strict`, `$schema`, `additionalProperties` و ساختارهای تو در توی `anyOf` را به انواع استاندارد و قابل فهم برای جمینای تبدیل می‌کند.
- **اصلاح پارامتر استدلال (Reasoning Effort Fixer):**
  مقادیر نامعتبر مانند `none` را خودکار به `low` تبدیل می‌کند تا خطای ۴۰۰ برطرف شود.
- **تولید محلی عنوان چت (Mock Local Title):**
  درخواست‌های مربوط به نام‌گذاری چت را با دقت شناسایی کرده و بدون مصرف سهمیه اکانت و در کمتر از ۲ میلی‌ثانیه با پشتیبانی کامل از JSON و SSE Stream پاسخ می‌دهد.
- **جعل هویت مرورگر (User-Agent Spoofing):**
  هدرهای شناسایی هرمس را پاک کرده و هدر استاندارد مرورگر را قرار می‌دهد.
- **بدون نیاز به پکیج‌های اضافی (Zero Dependencies):**
  تنها با کتابخانه‌های داخلی Node.js کار می‌کند و برای اجرا نیازی به `npm install` ندارد.
- **داشبورد وب و ترای ویندوز:**
  دارای آیکون اختصاصی System Tray در ویندوز (کنار ساعت) و داشبورد زنده وب در آدرس `/ui` با قابلیت تست پینگ روتر اصلی، گزارش لحظه‌ای درخواست‌ها و تغییر تنظیمات.

---

### 🚀 نحوه راه‌اندازی و استفاده

#### ۱. اجرای AG-Shield
```bash
git clone https://github.com/NaWeeDBHR/ag-shield.git
cd ag-shield
node index.js
```
*سرویس به‌طور پیش‌فرض روی پورت `20129` بالا می‌آید و ترافیک سالم‌سازی‌شده را به 9Router روی پورت `20128` می‌فرستد.*

#### ۲. تنظیم Hermes Agent
در تنظیمات هرمس (فایل `config.yaml` یا متغیرهای محیطی)، آدرس بیس پرووایدر را روی پورت AG-Shield قرار دهید:
```yaml
model: "gemini-3.8-flash-n"
provider: "custom"
api_base: "http://127.0.0.1:20129/v1"
api_key: "dummy-key"
```

#### ۳. دستورات مدیریت خط فرمان (CLI)
```bash
node index.js status      # نمایش وضعیت آنلاین بودن، پورت و آمار
node index.js restart     # متوقف‌سازی پروسس قبلی و راه‌اندازی مجدد
node index.js stop        # توقف پروکسی
npm test                  # اجرای تست‌های اعتبارسنجی
```

#### ۴. داشبورد مدیریتی وب
در مرورگر خود آدرس زیر را باز کنید:
```
http://127.0.0.1:20129/ui
```
از این بخش می‌توانید تنظیمات روتر بالادستی (Upstream)، کلیدهای اختصاصی، تست اتصال زنده (Test Ping) و لاگ‌های ورودی و خروجی را مشاهده نمایید.

---

### 📄 لایسنس
توسعه داده شده تحت مجوز MIT. رایگان برای استفاده تجاری و متن‌باز.
