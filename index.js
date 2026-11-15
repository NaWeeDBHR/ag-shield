#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const PKG_VERSION = (() => {
  try { return require('./package.json').version; } catch (_) { return '1.0.0'; }
})();

let updateState = {
  currentVersion: PKG_VERSION,
  latestVersion: PKG_VERSION,
  updateAvailable: false,
  updateCommand: 'git pull origin main || npm install -g ag-shield@latest',
  lastChecked: 0
};

function isNewerVersion(latest, current) {
  const l = String(latest).split('.').map(n => parseInt(n, 10) || 0);
  const c = String(current).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const li = l[i] || 0;
    const ci = c[i] || 0;
    if (li > ci) return true;
    if (li < ci) return false;
  }
  return false;
}

function checkRemoteVersion(force = false) {
  const now = Date.now();
  if (!force && (now - updateState.lastChecked) < 3600000) {
    return Promise.resolve(updateState);
  }
  return new Promise((resolve) => {
    https.get('https://raw.githubusercontent.com/NaWeeDBHR/ag-shield/main/package.json', {
      headers: { 'User-Agent': 'ag-shield-update-check' },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          if (pkg.version) {
            updateState.latestVersion = pkg.version;
            updateState.updateAvailable = isNewerVersion(pkg.version, PKG_VERSION);
            updateState.lastChecked = now;
          }
        } catch (_) {}
        resolve(updateState);
      });
    }).on('error', () => resolve(updateState));
  });
}

function runSelfUpdate() {
  const isGit = fs.existsSync(path.join(__dirname, '.git'));
  if (isGit) {
    try {
      const out = require('child_process').execSync('git pull origin main', {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 25000
      });
      return { ok: true, method: 'git', output: out.trim() };
    } catch (err) {
      return { ok: false, method: 'git', error: err.message, command: 'git pull origin main' };
    }
  } else {
    try {
      const out = require('child_process').execSync('npm install -g ag-shield@latest', {
        encoding: 'utf8',
        timeout: 30000
      });
      return { ok: true, method: 'npm', output: out.trim() };
    } catch (err) {
      return {
        ok: false,
        method: 'manual',
        command: 'npm install -g ag-shield@latest',
        error: err.message
      };
    }
  }
}

// --- Configuration & Persistence ---
const CONFIG_FILE = path.join(process.cwd(), 'ag-shield.config.json');
const UI_FILE = path.join(__dirname, 'ui.html');

const DEFAULT_CONFIG = {
  listenPort: 20129,
  targetProtocol: 'http',
  targetHost: '127.0.0.1',
  targetPort: 20128,
  targetApiKey: '',
  targetBasePath: '',

  // 1. Signature Neutralizer
  stripSignatures: true,
  signaturePatterns: [
    "(?:You are\\s+)?(?:Hermes Agent|hermes-agent|Nous Research Hermes|Nous Research)",
    "(?:You are\\s+)?(?:OpenClaw|openclaw)",
    "(?:You are\\s+)?(?:Roo Code|Roo-Cline|Cline|Aider|Cursor Agent)",
    "https?:\\/\\/(?:docs\\.nousresearch\\.com|github\\.com\\/nousresearch|github\\.com\\/cline|github\\.com\\/openclaw)[^\\s)\"]*",
    "#\\s*Runtime environment[\\s\\S]*?(?:<!--\\s*End runtime environment\\s*-->|(?=\\n#[A-Za-z0-9_\\s]+|\\n\\n[A-Z]|$))",
    "User home directory:\\s*[^\\n]+",
    "Current working directory:\\s*[^\\n]+",
    "Scratch directory:\\s*[^\\n]+",
    "#\\s*Operational directives",
    "#\\s*Tool-use enforcement"
  ],
  signatureReplacementText: "You are a helpful AI assistant.",

  // 2. Tool Schema Simplifier
  simplifyToolSchemas: true,
  stripStrict: true,
  stripSchemaUrl: true,
  stripAdditionalProperties: true,
  stripValidationBounds: true,
  collapseAnyOf: true,

  // 3. Reasoning Effort Fixer
  fixReasoningEffort: true,
  reasoningEffortSource: 'none',
  reasoningEffortTarget: 'low',

  // 4. Local Title Mocker
  mockLocalTitles: true,
  mockTitleText: 'New Session',
  mockTitleKeywords: 'session\\s*title|chat\\s*title|title\\s+for\\s+this|generate\\s+(?:a\\s+)?(?:short\\s+)?title|summarize\\s+into\\s+(?:a\\s+)?(?:short\\s+)?title|create\\s+(?:a\\s+)?(?:3-5\\s+word\\s+)?title',

  // 5. User-Agent Spoofing
  spoofUserAgent: true,
  customUserAgent: 'OpenAI/NodeJS/4.0.0 (Windows NT 10.0; Win64; x64)',

  // 6. Custom text replacements
  customReplacements: []
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      config = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      saveConfig();
    }
  } catch (err) {
    console.error('[AG-SHIELD] Error reading config file, using defaults:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('[AG-SHIELD] Failed to persist config:', err.message);
  }
}

// --- Autostart System Boot Manager ---
function getAutostartInfo() {
  const platform = process.platform;
  const scriptPath = path.resolve(__dirname, 'index.js');
  const workDir = path.dirname(scriptPath);
  const nodeBin = process.execPath;
  const user = process.env.USER || process.env.USERNAME || 'root';

  const systemdSnippet = `[Unit]
Description=AG-Shield (Antigravity & Agentic AI Sanitizer Proxy)
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${workDir}
ExecStart=${nodeBin} "${scriptPath}"
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    const startupDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const vbsPath = path.join(startupDir, 'ag-shield.vbs');
    return { platform, type: 'windows-startup', path: vbsPath, enabled: fs.existsSync(vbsPath), scriptPath, workDir, systemdSnippet };
  } else if (platform === 'darwin') {
    const plistPath = path.join(process.env.HOME || '', 'Library', 'LaunchAgents', 'com.ag-shield.plist');
    return { platform, type: 'launchd', path: plistPath, enabled: fs.existsSync(plistPath), scriptPath, workDir, systemdSnippet };
  } else {
    // Linux
    const home = process.env.HOME || '';
    const systemdUserDir = path.join(home, '.config', 'systemd', 'user');
    const systemdUserService = path.join(systemdUserDir, 'ag-shield.service');
    const autoDir = path.join(home, '.config', 'autostart');
    const desktopPath = path.join(autoDir, 'ag-shield.desktop');
    const isService = fs.existsSync(systemdUserService);
    const isDesktop = fs.existsSync(desktopPath);

    return {
      platform,
      type: isService ? 'systemd-user' : (isDesktop ? 'desktop-autostart' : 'systemd-user'),
      path: isService ? systemdUserService : desktopPath,
      systemdUserService,
      desktopPath,
      enabled: isService || isDesktop,
      scriptPath,
      workDir,
      systemdSnippet
    };
  }
}

function setAutostart(enable) {
  const info = getAutostartInfo();
  try {
    if (!enable) {
      if (info.platform === 'linux') {
        if (info.systemdUserService && fs.existsSync(info.systemdUserService)) {
          try { require('child_process').execSync('systemctl --user disable ag-shield --now', { stdio: 'ignore' }); } catch (_) {}
          try { fs.unlinkSync(info.systemdUserService); } catch (_) {}
          try { require('child_process').execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch (_) {}
        }
        if (info.desktopPath && fs.existsSync(info.desktopPath)) {
          try { fs.unlinkSync(info.desktopPath); } catch (_) {}
        }
        return { success: true, enabled: false, path: info.path };
      }

      if (fs.existsSync(info.path)) {
        fs.unlinkSync(info.path);
      }
      return { success: true, enabled: false, path: info.path };
    }

    const dir = path.dirname(info.path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (info.platform === 'win32') {
      const vbsContent = [
        'Set WshShell = CreateObject("WScript.Shell")',
        `WshShell.CurrentDirectory = "${info.workDir}"`,
        `WshShell.Run "node """ & "${info.scriptPath}" & """", 0, False`,
        ''
      ].join('\r\n');
      fs.writeFileSync(info.path, vbsContent, 'utf8');
    } else if (info.platform === 'darwin') {
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ag-shield</string>
  <key>ProgramArguments</key>
  <array>
    <string>node</string>
    <string>${info.scriptPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${info.workDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>`;
      fs.writeFileSync(info.path, plist, 'utf8');
    } else {
      // Linux: enable both systemd user service and desktop entry
      const home = process.env.HOME || '';
      const systemdUserDir = path.join(home, '.config', 'systemd', 'user');
      const servicePath = path.join(systemdUserDir, 'ag-shield.service');
      const autoDir = path.join(home, '.config', 'autostart');
      const desktopPath = path.join(autoDir, 'ag-shield.desktop');

      if (!fs.existsSync(systemdUserDir)) fs.mkdirSync(systemdUserDir, { recursive: true });
      const userUnit = `[Unit]
Description=AG-Shield (Antigravity & Agentic AI Sanitizer Proxy)
After=network.target

[Service]
Type=simple
WorkingDirectory=${info.workDir}
ExecStart=${process.execPath} "${info.scriptPath}"
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
      fs.writeFileSync(servicePath, userUnit, 'utf8');

      if (!fs.existsSync(autoDir)) fs.mkdirSync(autoDir, { recursive: true });
      const desktop = `[Desktop Entry]
Type=Application
Name=AG-Shield
Comment=Antigravity & Agentic AI Sanitizer Proxy
Exec=${process.execPath} "${info.scriptPath}"
Path=${info.workDir}
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
`;
      fs.writeFileSync(desktopPath, desktop, 'utf8');

      try {
        require('child_process').execSync('systemctl --user daemon-reload && systemctl --user enable ag-shield', { stdio: 'ignore' });
      } catch (_) {}

      return { success: true, enabled: true, path: servicePath };
    }

    return { success: true, enabled: true, path: info.path };
  } catch (err) {
    return { success: false, error: err.message, path: info.path };
  }
}

// CLI args parsing
const args = process.argv.slice(2);
let fileLogging = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--version' || arg === '-v') {
    console.log(`ag-shield v${PKG_VERSION}`);
    process.exit(0);
  } else if (arg === '--update') {
    console.log(`[AG-SHIELD] Checking for updates (current: v${PKG_VERSION})...`);
    checkRemoteVersion(true).then((info) => {
      if (!info.updateAvailable) {
        console.log(`[AG-SHIELD] Already on latest version (v${PKG_VERSION}).`);
        process.exit(0);
      }
      console.log(`[AG-SHIELD] New version available: v${info.latestVersion}! Updating...`);
      const res = runSelfUpdate();
      if (res.ok) {
        console.log(`[AG-SHIELD] Update successful:
${res.output}`);
      } else {
        console.error(`[AG-SHIELD] Update failed: ${res.error || ''}
Run manually: ${info.updateCommand}`);
      }
      process.exit(res.ok ? 0 : 1);
    });
    return;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
AG-SHIELD - Antigravity & Agentic AI Sanitizer Proxy

Usage:
  ag-shield [port] [targetPort] [flags]

Flags:
  --log, -l             Append traffic events to proxy-traffic.log
  --no-tools            Disable tool schema simplification
  --no-local-title      Disable mocking of session_title calls
  --host <host>         Set target upstream host (default: 127.0.0.1)
  --port <port>         Set listen port (default: 20129)
  --target-port <p>     Set target upstream port (default: 20128)
  --protocol <http|https> Set upstream protocol (default: http)
  --autostart-enable    Enable auto-start on system boot
  --autostart-disable   Disable auto-start on system boot
  --autostart-status    Check auto-start configuration status
  --install-systemd     Install systemd system service on Linux (/etc/systemd/system)
  --version, -v         Show version number
  --update              Check and install latest update from GitHub/npm
  --help, -h            Show this help message

Web Dashboard:
  http://127.0.0.1:20129/ui
`);
    process.exit(0);
  } else if (arg === '--autostart-enable') {
    const res = setAutostart(true);
    console.log(`[AG-SHIELD] Autostart on boot enabled at: ${res.path}`);
    process.exit(0);
  } else if (arg === '--autostart-disable') {
    const res = setAutostart(false);
    console.log(`[AG-SHIELD] Autostart on boot disabled.`);
    process.exit(0);
  } else if (arg === '--autostart-status') {
    const info = getAutostartInfo();
    console.log(`[AG-SHIELD] Autostart (${info.platform} / ${info.type}): ${info.enabled ? 'ENABLED' : 'DISABLED'} -> ${info.path}`);
    process.exit(0);
  } else if (arg === '--install-systemd') {
    const info = getAutostartInfo();
    const targetFile = '/etc/systemd/system/ag-shield.service';
    try {
      fs.writeFileSync(targetFile, info.systemdSnippet, 'utf8');
      require('child_process').execSync('systemctl daemon-reload && systemctl enable --now ag-shield');
      console.log(`[AG-SHIELD] Successfully installed systemd service to ${targetFile} and started.`);
    } catch (err) {
      console.log(`
[AG-SHIELD] To install systemd service on Linux, run:

sudo tee ${targetFile} << 'EOF'
${info.systemdSnippet.trim()}
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now ag-shield
`);
    }
    process.exit(0);
  } else if (arg === '--log' || arg === '-l') {
    fileLogging = true;
  } else if (arg === '--no-tools') {
    config.simplifyToolSchemas = false;
  } else if (arg === '--no-local-title') {
    config.mockLocalTitles = false;
  } else if (arg === '--port' && args[i + 1]) {
    config.listenPort = parseInt(args[++i], 10);
  } else if (arg === '--host' && args[i + 1]) {
    config.targetHost = args[++i];
  } else if (arg === '--target-port' && args[i + 1]) {
    config.targetPort = parseInt(args[++i], 10);
  } else if (arg === '--protocol' && args[i + 1]) {
    config.targetProtocol = args[++i].toLowerCase();
  } else if (!isNaN(parseInt(arg, 10))) {
    if (!config._argvPortSet) {
      config.listenPort = parseInt(arg, 10);
      config._argvPortSet = true;
    } else {
      config.targetPort = parseInt(arg, 10);
    }
  }
}

// Env overrides
if (process.env.PORT) config.listenPort = parseInt(process.env.PORT, 10);
if (process.env.TARGET_HOST) config.targetHost = process.env.TARGET_HOST;
if (process.env.TARGET_PORT) config.targetPort = parseInt(process.env.TARGET_PORT, 10);
if (process.env.TARGET_PROTOCOL) config.targetProtocol = process.env.TARGET_PROTOCOL;
if (process.env.TARGET_API_KEY) config.targetApiKey = process.env.TARGET_API_KEY;

delete config._argvPortSet;
loadConfig();

// --- Live Stats & Ring-Buffer ---
const stats = {
  totalRequests: 0,
  sanitizedCount: 0,
  savedTitleCalls: 0,
  errorCount: 0,
  startTime: Date.now()
};

const MAX_LOGS = 50;
const trafficLogs = [];
const eventBus = new EventEmitter();
const sseClients = new Set();

function broadcastSSE(type, data) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// Keep-alive heartbeat every 10s to prevent connection dropouts
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(': keepalive\n\n'); } catch (_) { sseClients.delete(client); }
  }
}, 10000);

function logTraffic(entry) {
  trafficLogs.unshift(entry);
  if (trafficLogs.length > MAX_LOGS) trafficLogs.pop();

  broadcastSSE('log', entry);
  broadcastSSE('stats', getStats());

  if (fileLogging) {
    const line = `[${entry.timestamp}] ${entry.method} ${entry.path} - ${entry.status} (${entry.latencyMs}ms) - Model: ${entry.model || 'N/A'}\n`;
    fs.appendFile('proxy-traffic.log', line, () => {});
  }
}

function getStats() {
  return {
    ...stats,
    uptime: Math.floor((Date.now() - stats.startTime) / 1000)
  };
}

// --- Sanitization Engine ---

function sanitizeText(text, customReplacements = []) {
  if (typeof text !== 'string') return { text, changed: false };
  let original = text;
  let modified = text;

  if (config.stripSignatures) {
    const patterns = Array.isArray(config.signaturePatterns) && config.signaturePatterns.length > 0
      ? config.signaturePatterns
      : DEFAULT_CONFIG.signaturePatterns;

    const replacementIntro = config.signatureReplacementText !== undefined
      ? config.signatureReplacementText
      : 'You are a helpful AI assistant.';

    for (const pat of patterns) {
      try {
        const re = typeof pat === 'string' ? new RegExp(pat, 'gi') : pat;
        modified = modified.replace(re, (match) => {
          if (/^You are\s+/i.test(match)) {
            return replacementIntro;
          }
          return '';
        });
      } catch (_) {}
    }
  }

  const replacements = Array.isArray(customReplacements) && customReplacements.length > 0
    ? customReplacements
    : (Array.isArray(config.customReplacements) ? config.customReplacements : []);

  for (const rule of replacements) {
    if (rule && rule.find) {
      try {
        if (rule.isRegex) {
          const re = new RegExp(rule.find, 'g');
          modified = modified.replace(re, rule.replace || '');
        } else {
          modified = modified.split(rule.find).join(rule.replace || '');
        }
      } catch (_) {}
    }
  }

  return { text: modified, changed: modified !== original };
}

function cleanJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanJsonSchema);

  const clone = { ...schema };

  if (config.collapseAnyOf !== false) {
    const candidates = clone.anyOf || clone.oneOf || clone.allOf;
    if (Array.isArray(candidates) && candidates.length > 0) {
      delete clone.anyOf;
      delete clone.oneOf;
      delete clone.allOf;

      const primary = candidates.find(c => c && c.type && c.type !== 'null') || candidates[0];
      if (primary && typeof primary === 'object') {
        const cleanedPrimary = cleanJsonSchema(primary);
        Object.assign(clone, cleanedPrimary);
      }
    }
  }

  if (config.stripSchemaUrl !== false) delete clone.$schema;
  if (config.stripAdditionalProperties !== false) delete clone.additionalProperties;
  if (config.stripStrict !== false) delete clone.strict;
  if (config.stripValidationBounds !== false) {
    delete clone.minItems;
    delete clone.maxItems;
    delete clone.minimum;
    delete clone.maximum;
    delete clone.minLength;
    delete clone.maxLength;
  }

  if (clone.properties && typeof clone.properties === 'object') {
    const cleanedProps = {};
    for (const [key, prop] of Object.entries(clone.properties)) {
      cleanedProps[key] = cleanJsonSchema(prop);
    }
    clone.properties = cleanedProps;
  }

  if (clone.items) {
    clone.items = cleanJsonSchema(clone.items);
  }

  return clone;
}

function isTitleGenerationRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return false;
  const maxTokens = body.max_tokens || body.max_completion_tokens;
  const lastMsg = body.messages[body.messages.length - 1];
  const content = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : Array.isArray(lastMsg.content)
      ? lastMsg.content.map(c => c.text || '').join(' ')
      : '';

  let titleRegex = /(?:session\s*title|chat\s*title|title\s+for\s+this|generate\s+(?:a\s+)?(?:short\s+)?title|summarize\s+into\s+(?:a\s+)?(?:short\s+)?title|create\s+(?:a\s+)?(?:3-5\s+word\s+)?title)/i;
  if (config.mockTitleKeywords) {
    try {
      titleRegex = new RegExp(config.mockTitleKeywords, 'i');
    } catch (_) {}
  }

  if (titleRegex.test(content)) return true;
  if (maxTokens && maxTokens <= 25 && /title/i.test(content)) return true;
  return false;
}

function generateMockTitleResponse(body) {
  const titleContent = config.mockTitleText || 'New Session';
  return {
    id: `chatcmpl-mock-title-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'ag-shield-local',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: titleContent
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 2,
      total_tokens: 17
    }
  };
}

function sanitizePayload(body) {
  let changed = false;
  const changes = [];

  const srcEffort = config.reasoningEffortSource || 'none';
  const tgtEffort = config.reasoningEffortTarget || 'low';

  if (config.fixReasoningEffort && body.reasoning_effort === srcEffort) {
    if (tgtEffort === 'remove') {
      delete body.reasoning_effort;
      changed = true;
      changes.push(`Removed reasoning_effort: "${srcEffort}"`);
    } else {
      body.reasoning_effort = tgtEffort;
      changed = true;
      changes.push(`Mapped reasoning_effort: "${srcEffort}" -> "${tgtEffort}"`);
    }
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        const { text, changed: textChanged } = sanitizeText(msg.content, config.customReplacements);
        if (textChanged) {
          msg.content = text;
          changed = true;
          changes.push(`Sanitized message role=${msg.role}`);
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part.text === 'string') {
            const { text, changed: textChanged } = sanitizeText(part.text, config.customReplacements);
            if (textChanged) {
              part.text = text;
              changed = true;
              changes.push(`Sanitized multipart message role=${msg.role}`);
            }
          }
        }
      }
    }
  }

  if (typeof body.system === 'string') {
    const { text, changed: textChanged } = sanitizeText(body.system, config.customReplacements);
    if (textChanged) {
      body.system = text;
      changed = true;
      changes.push('Sanitized top-level system prompt');
    }
  }

  if (config.simplifyToolSchemas && Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (tool.function) {
        if (config.stripStrict !== false && tool.function.strict !== undefined) {
          delete tool.function.strict;
          changed = true;
          changes.push(`Removed strict flag from tool ${tool.function.name}`);
        }
        if (tool.function.parameters) {
          tool.function.parameters = cleanJsonSchema(tool.function.parameters);
          changed = true;
          changes.push(`Cleaned schema for tool ${tool.function.name}`);
        }
      }
    }
  }

  if (config.stripStrict !== false && body.strict !== undefined) {
    delete body.strict;
    changed = true;
    changes.push('Removed top-level strict flag');
  }

  return { body, changed, changes };
}

// --- HTTP Request Handler ---
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  // 1. Control UI & API Routes
  if (pathname === '/ui' || pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    try {
      const html = fs.readFileSync(UI_FILE, 'utf8');
      return res.end(html);
    } catch (e) {
      return res.end('<h1>AG-Shield UI file missing</h1>');
    }
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({
      version: PKG_VERSION,
      updates: updateState,
      config,
      stats: getStats(),
      autostart: getAutostartInfo(),
      logs: trafficLogs
    }));
  }

  if (pathname === '/api/check-update' && (req.method === 'GET' || req.method === 'POST')) {
    checkRemoteVersion(true).then((info) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(info));
    });
    return;
  }

  if (pathname === '/api/update' && req.method === 'POST') {
    const result = runSelfUpdate();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify(result));
  }

  if (pathname === '/api/autostart' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify(getAutostartInfo()));
  }

  if (pathname === '/api/autostart' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(bodyData || '{}');
        const enable = payload.enabled === true;
        const result = setAutostart(enable);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/test-upstream' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      let targetP = config.targetProtocol || 'http';
      let targetH = config.targetHost || '127.0.0.1';
      let targetPt = config.targetPort || 20128;
      let targetKey = config.targetApiKey || '';

      try {
        const parsed = JSON.parse(bodyData || '{}');
        if (parsed.targetProtocol) targetP = parsed.targetProtocol;
        if (parsed.targetHost) targetH = parsed.targetHost;
        if (parsed.targetPort) targetPt = parseInt(parsed.targetPort, 10);
        if (parsed.targetApiKey !== undefined) targetKey = parsed.targetApiKey;
      } catch (_) {}

      const isHttps = targetP === 'https' || targetPt === 443;
      const clientLib = isHttps ? https : http;
      const tStart = Date.now();

      const headers = {
        'User-Agent': 'AG-Shield-Tester/1.0',
        'Host': `${targetH}:${targetPt}`
      };
      if (targetKey) {
        headers['Authorization'] = `Bearer ${targetKey}`;
      }

      const testReq = clientLib.request({
        hostname: targetH,
        port: targetPt,
        path: '/v1/models',
        method: 'GET',
        headers,
        timeout: 4000
      }, (testRes) => {
        let respData = '';
        testRes.on('data', c => { respData += c; });
        testRes.on('end', () => {
          const lat = Date.now() - tStart;
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            ok: testRes.statusCode < 500,
            status: testRes.statusCode,
            latencyMs: lat,
            message: `Upstream responded with HTTP ${testRes.statusCode} (${lat}ms)`
          }));
        });
      });

      testReq.on('timeout', () => {
        testReq.destroy();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          ok: false,
          status: 408,
          message: 'Connection timed out (4s)'
        }));
      });

      testReq.on('error', (err) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          ok: false,
          status: 502,
          message: `Connection failed: ${err.code || err.message}`
        }));
      });

      testReq.end();
    });
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      try {
        const patch = JSON.parse(bodyData);
        for (const [k, v] of Object.entries(patch)) {
          if (k in DEFAULT_CONFIG) {
            config[k] = v;
          }
        }
        saveConfig();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify({ success: true, config }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/clear-logs' && req.method === 'POST') {
    trafficLogs.length = 0;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({ success: true }));
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'stats', data: getStats() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 2. Reverse Proxy Request
  stats.totalRequests++;
  const startTime = Date.now();
  let chunks = [];

  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    let finalBody = rawBody;
    let model = 'N/A';
    let toolCount = 0;
    let sanitized = false;
    let changes = [];
    let isMockTitle = false;

    // Check if JSON body
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json') && rawBody.length > 0) {
      try {
        let json = JSON.parse(rawBody.toString('utf8'));
        model = json.model || 'N/A';
        toolCount = Array.isArray(json.tools) ? json.tools.length : 0;

        // Check if session_title mock needed
        if (config.mockLocalTitles && isTitleGenerationRequest(json)) {
          isMockTitle = true;
          stats.savedTitleCalls++;
          const mockResponse = generateMockTitleResponse(json);
          const respBuf = Buffer.from(JSON.stringify(mockResponse));

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': respBuf.length
          });
          res.end(respBuf);

          logTraffic({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.url,
            model,
            toolCount,
            status: '200 (LOCAL)',
            latencyMs: Date.now() - startTime,
            sanitized: true,
            snippet: 'Synthetic local session title response returned to save RPM quota',
            details: { titleMock: true, model }
          });
          return;
        }

        // Apply Sanitization
        const result = sanitizePayload(json);
        if (result.changed) {
          sanitized = true;
          stats.sanitizedCount++;
          changes = result.changes;
          finalBody = Buffer.from(JSON.stringify(result.body));
        }
      } catch (err) {
        console.warn('[AG-SHIELD] Could not parse request body as JSON:', err.message);
      }
    }

    // Forward to Upstream
    const isHttps = config.targetProtocol === 'https' || config.targetPort === 443;
    const transport = isHttps ? https : http;

    const proxyHeaders = { ...req.headers };
    delete proxyHeaders['host'];
    delete proxyHeaders['transfer-encoding'];
    proxyHeaders['host'] = (config.targetPort === 80 || config.targetPort === 443)
      ? config.targetHost
      : `${config.targetHost}:${config.targetPort}`;

    // Inject upstream target API key if configured
    if (config.targetApiKey && config.targetApiKey.trim().length > 0) {
      proxyHeaders['authorization'] = `Bearer ${config.targetApiKey.trim()}`;
    }

    if (config.spoofUserAgent) {
      proxyHeaders['user-agent'] = config.customUserAgent || 'OpenAI/NodeJS/4.0.0 (Windows NT 10.0; Win64; x64)';
      delete proxyHeaders['x-hermes-version'];
      delete proxyHeaders['x-client-name'];
    }

    if (finalBody.length > 0) {
      proxyHeaders['content-length'] = Buffer.byteLength(finalBody);
    } else {
      delete proxyHeaders['content-length'];
    }

    let forwardPath = req.url;
    if (config.targetBasePath) {
      const base = config.targetBasePath.replace(/\/+$/, '');
      forwardPath = base + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }

    const proxyReq = transport.request({
      hostname: config.targetHost,
      port: config.targetPort,
      path: forwardPath,
      method: req.method,
      headers: proxyHeaders
    }, (proxyRes) => {
      const respHeaders = { ...proxyRes.headers };
      respHeaders['access-control-allow-origin'] = '*';
      res.writeHead(proxyRes.statusCode, respHeaders);

      let errSnippet = '';
      proxyRes.on('data', chunk => {
        res.write(chunk);
        if (proxyRes.statusCode >= 400 && errSnippet.length < 512) {
          errSnippet += chunk.toString('utf8');
        }
      });
      proxyRes.on('end', () => {
        res.end();
        const latencyMs = Date.now() - startTime;
        const status = proxyRes.statusCode;

        let errorReason = '';
        if (status >= 400) {
          stats.errorCount++;
          try {
            const errObj = JSON.parse(errSnippet);
            errorReason = (errObj.error && errObj.error.message) || errObj.message || errObj.error || '';
          } catch (_) {
            errorReason = errSnippet.slice(0, 120).trim();
          }
        }

        logTraffic({
          id: Date.now(),
          timestamp: new Date().toISOString(),
          method: req.method,
          path: req.url,
          model,
          toolCount,
          status,
          latencyMs,
          sanitized,
          snippet: errorReason
            ? `${status} upstream: ${errorReason}`
            : `Proxied to ${config.targetProtocol || 'http'}://${config.targetHost}:${config.targetPort}`,
          details: { changes, model, status, errorReason, responsePreview: errSnippet.slice(0, 300) }
        });
      });
    });

    proxyReq.on('error', (err) => {
      stats.errorCount++;
      const latencyMs = Date.now() - startTime;
      const errorMsg = `AG-Shield: Upstream target unreachable at ${config.targetProtocol || 'http'}://${config.targetHost}:${config.targetPort} (${err.code || err.message})`;

      const errPayload = JSON.stringify({
        error: {
          message: errorMsg,
          code: 'UPSTREAM_UNAVAILABLE'
        }
      });

      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(errPayload);

      logTraffic({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.url,
        model,
        toolCount,
        status: 502,
        latencyMs,
        sanitized,
        snippet: errorMsg,
        details: { error: err.message, code: err.code }
      });
    });

    if (finalBody.length > 0) {
      proxyReq.write(finalBody);
    }
    proxyReq.end();
  });
});

// Start Server
if (require.main === module) {
  server.listen(config.listenPort, '0.0.0.0', () => {
    const autoInfo = getAutostartInfo();
    console.log(`
🛡️  AG-SHIELD (Antigravity & Agentic AI Sanitizer Proxy)
-------------------------------------------------------
📡 Proxy Endpoint:    http://127.0.0.1:${config.listenPort}/v1
🎯 Target Gateway:    ${config.targetProtocol || 'http'}://${config.targetHost}:${config.targetPort}
🖥️  Web Control Panel: http://127.0.0.1:${config.listenPort}/ui
🚀 System Autostart:  ${autoInfo.enabled ? 'ACTIVE (' + autoInfo.path + ')' : 'OFF'}
-------------------------------------------------------
`);
  });
}

// Export for testing
module.exports = {
  server,
  config,
  PKG_VERSION,
  updateState,
  isNewerVersion,
  checkRemoteVersion,
  runSelfUpdate,
  stats,
  sanitizeText,
  cleanJsonSchema,
  isTitleGenerationRequest,
  generateMockTitleResponse,
  sanitizePayload,
  getAutostartInfo,
  setAutostart,
  DEFAULT_CONFIG
};
