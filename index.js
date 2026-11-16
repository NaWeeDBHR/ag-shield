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
const CONFIG_FILE = path.join(__dirname, 'ag-shield.config.json');
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

  // 2. Tool Schema Simplifier
  simplifyToolSchemas: true,
  noTools: false,

  // 3. Reasoning Effort Stripper (routes to default control bucket instead of exhausted medium bucket)
  fixReasoningEffort: true,
  reasoningEffortSource: 'any',
  reasoningEffortTarget: 'remove',

  // 4. Local Title Mocker
  mockLocalTitles: true,

  // 5. User-Agent Spoofing
  spoofUserAgent: true,
  customUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',

  // 6. Custom text replacements
  customReplacements: []
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.customUserAgent && parsed.customUserAgent.startsWith('OpenAI/NodeJS')) {
        parsed.customUserAgent = DEFAULT_CONFIG.customUserAgent;
      }
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

// Load saved config FIRST so CLI flags & env vars override it properly
loadConfig();

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

let trayProcess = null;

function startWindowsTray(port) {
  if (process.platform !== 'win32') return;
  const trayScript = path.join(__dirname, 'tray.ps1');
  if (!fs.existsSync(trayScript)) return;

  try {
    const { spawn } = require('child_process');
    trayProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', trayScript,
      '-NodePid', process.pid.toString(),
      '-Port', port.toString()
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    trayProcess.unref();
  } catch (_) {}
}

function stopWindowsTray() {
  if (trayProcess) {
    try { trayProcess.kill(); } catch (_) {}
    trayProcess = null;
  }
}

process.on('exit', stopWindowsTray);
process.on('SIGINT', () => { stopWindowsTray(); process.exit(0); });
process.on('SIGTERM', () => { stopWindowsTray(); process.exit(0); });

function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execSync(
        `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      const pids = out.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(p => p > 4 && p !== process.pid);
      for (const pid of pids) {
        try { process.kill(pid); } catch (_) {}
      }
      return pids;
    } else {
      const out = require('child_process').execSync(`lsof -ti :${port}`, { encoding: 'utf8', timeout: 5000 }).trim();
      const pids = out.split(/\s+/).map(s => parseInt(s.trim(), 10)).filter(p => p > 0 && p !== process.pid);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
      }
      return pids;
    }
  } catch (_) {
    return [];
  }
}

function formatUptime(seconds) {
  if (!seconds || seconds < 60) return `${seconds || 0}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

function printCliStatus(port) {
  const req = http.get({
    hostname: '127.0.0.1',
    port: port,
    path: '/api/status',
    timeout: 2500
  }, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const info = JSON.parse(data);
        const cfg = info.config || {};
        const stats = info.stats || {};
        const auto = info.autostart || {};
        const uptimeStr = formatUptime(stats.uptime);

        console.log(`
┌────────────────────────────────────────────────────────┐
│  AG-SHIELD Status: [RUNNING]                           │
├────────────────────────────────────────────────────────┤
│  Version:    v${info.version || '1.0.0'}
│  Proxy URL:  http://127.0.0.1:${cfg.listenPort || port}/v1
│  Dashboard:  http://127.0.0.1:${cfg.listenPort || port}/ui
│  Upstream:   ${cfg.targetProtocol || 'http'}://${cfg.targetHost || '127.0.0.1'}:${cfg.targetPort || 20128}
│  Uptime:     ${uptimeStr}
│  Autostart:  ${auto.enabled ? 'ENABLED' : 'DISABLED'} (${auto.platform || process.platform})
├────────────────────────────────────────────────────────┤
│  Traffic Stats:                                        │
│    • Total Requests:       ${stats.totalRequests || 0}
│    • Signatures Stripped:  ${stats.sanitizedCount || 0}
│    • Title Quota Saved:    ${stats.savedTitleCalls || 0}
│    • Upstream Errors:      ${stats.errorCount || 0}
└────────────────────────────────────────────────────────┘`);
        process.exit(0);
      } catch (err) {
        console.error('[AG-SHIELD] Failed to parse status response:', err.message);
        process.exit(1);
      }
    });
  });

  req.on('error', () => {
    const auto = getAutostartInfo();
    console.log(`
┌────────────────────────────────────────────────────────┐
│  AG-SHIELD Status: [STOPPED]                           │
├────────────────────────────────────────────────────────┤
│  Service is not running on port ${port}.               │
│  Autostart: ${auto.enabled ? 'ENABLED' : 'DISABLED'} (${auto.platform})
│                                                        │
│  To start:                                             │
│    Windows: cscript //NoLogo "${auto.path}"            │
│    Linux:   sudo systemctl start ag-shield             │
│    Foreground: ag-shield                               │
└────────────────────────────────────────────────────────┘`);
    process.exit(1);
  });

  req.on('timeout', () => {
    req.destroy();
    console.log(`[AG-SHIELD] Timeout connecting to port ${port}. Service might be frozen.`);
    process.exit(1);
  });
}

// CLI args parsing (overrides loaded config)
const args = process.argv.slice(2);
let fileLogging = false;
let argvPortSet = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === 'stop' || arg === '--stop') {
    const port = config.listenPort || 20129;
    const killed = killProcessOnPort(port);
    if (killed.length > 0) {
      console.log(`[AG-SHIELD] Stopped running process(es) on port ${port}: PID ${killed.join(', ')}`);
    } else {
      console.log(`[AG-SHIELD] No running process found on port ${port}.`);
    }
    process.exit(0);
  } else if (arg === 'restart' || arg === '--restart') {
    const port = config.listenPort || 20129;
    const killed = killProcessOnPort(port);
    if (killed.length > 0) {
      console.log(`[AG-SHIELD] Stopped previous process(es): PID ${killed.join(', ')}`);
    }
    console.log(`[AG-SHIELD] Starting AG-Shield on port ${port}...`);
  } else if (arg === 'status' || arg === '--status') {
    const port = config.listenPort || 20129;
    printCliStatus(port);
    return;
  } else if (arg === '--version' || arg === '-v') {
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
        console.log(`[AG-SHIELD] Update successful:\n${res.output}`);
      } else {
        console.error(`[AG-SHIELD] Update failed: ${res.error || ''}\nRun manually: ${info.updateCommand}`);
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
  --log, -l             Write full traffic debug log to hermes-traffic.log
  --no-tools            Strip tools array completely (debug mode)
  --no-tray             Disable Windows system tray icon
  --no-local-title      Disable mocking of session_title calls
  --host <host>         Set target upstream host (default: 127.0.0.1)
  --port <port>         Set listen port (default: 20129)
  --target-port <p>     Set target upstream port (default: 20128)
  --protocol <http|https> Set upstream protocol (default: http)
  --autostart-enable    Enable auto-start on system boot
  --autostart-disable   Disable auto-start on system boot
  --autostart-status    Check auto-start configuration status
  --install-systemd     Install systemd system service on Linux (/etc/systemd/system)
  status, --status      Show live service status, uptime, proxy URL, and stats
  stop, --stop          Stop any running AG-Shield instance occupying the port
  restart, --restart    Restart the service (kills previous process and starts)
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
    setAutostart(false);
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
    config.noTools = true;
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
    if (!argvPortSet) {
      config.listenPort = parseInt(arg, 10);
      argvPortSet = true;
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
if (process.env.ENABLE_LOG === 'true') fileLogging = true;

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
}

function getStats() {
  return {
    ...stats,
    uptime: Math.floor((Date.now() - stats.startTime) / 1000)
  };
}

// --- Sanitization Engine ---
const LOG_FILE = path.join(__dirname, 'hermes-traffic.log');

function writeLog(text) {
  if (!fileLogging) return;
  try {
    fs.appendFileSync(LOG_FILE, text + '\n', 'utf8');
  } catch (_) {}
}

function cleanTextSignature(text, customReplacements = []) {
  if (typeof text !== 'string') return text;
  let res = text
    // 1. Confirmed Antigravity false-429 trigger sentences (#5697, #5701, #5703, Hermes v0.23.0)
    .replace(/solve coding tasks\.\s*Be concise, practical, and tool-aware\./gi,
      'work on their coding tasks. Keep responses concise and practical, and use the available tools when they help.')
    .replace(/You are pair programming with a user to solve coding tasks\./gi,
      'You pair program with the user on coding tasks.')
    .replace(/When the user asks you to build, run, or verify something, the deliverable is a working artifact backed by real tool output/gi,
      'If the user asks you to build, run or check something, deliver a working result based on actual tool output')
    .replace(/Reporting a blocker honestly is always better than inventing a result\./gi,
      'It is always better to report a blocker honestly than to make up a result.')
    // #3358 / #2964: "Hermes Agent" + "Nous Research" together trigger 429; split at comma
    .replace(/You are Hermes Agent, an intelligent AI assistant created by Nous Research./gi,
      'You are Hermes Agent. You are an intelligent AI assistant created by Nous Research.')
    // #5703: additional Hermes sentence triggers
    .replace(/Be direct./gi, 'Get straight to the point.')
    .replace(/is your authoritative reference/gi, 'is your reference guide')
    .replace(/# Google model operational directives/gi, '# Model operational directives')

    // 2. Specific URLs and multi-word Hermes phrases (must run BEFORE single-word 'hermes' replacement)
    .replace(/https?:\/\/hermes-agent\.nousresearch\.com\/docs/gi, 'the official documentation')
    .replace(/nousresearch\.com/gi, 'docs.local')
    .replace(/For help with Hermes Agent itself/gi, 'For help with the assistant itself')
        .replace(/Hermes delivers their message/gi, 'the runtime delivers their message')
        .replace(/You are chatting inside the Hermes desktop app, a graphical chat surface\\./gi,
      'You are chatting inside a graphical desktop chat surface.')
    .replace(/Act as an effective and practical assistant\. Your primary goal is to help the user by answering questions, writing and debugging code, analyzing information, creating content, and executing tasks using the available tools\./gi,
      'You are a helpful coding and technical assistant. Assist the user with questions, code, analysis, and tasks using available tools.')

    // 3. Structural headers and markers
    .replace(/# Finishing the job/gi, '# Task completion')
    .replace(/# Parallel tool calls/gi, '# Concurrent tool usage')
    .replace(/## Mid-turn user steering/gi, '## Mid-turn user guidance')
    .replace(/\[OUT-OF-BAND USER MESSAGE[^\]]*\]/gi, '[USER UPDATE]')
    .replace(/\[\/OUT-OF-BAND USER MESSAGE\]/gi, '[/USER UPDATE]')
    .replace(/<available_skills>/gi, '<available_guides>')
    .replace(/<\/available_skills>/gi, '</available_guides>')
    .replace(/Before replying, scan the skills below\./gi, 'Before replying, review the available guides below.')
    .replace(/Skills come first:/gi, 'Guides come first:')
    .replace(/## Skills/gi, '## Guides')
    .replace(/═{10,}\s*MEMORY \(your personal notes\)[^═]*═{10,}/gi, '--- CONTEXT NOTES ---')
    .replace(/═{10,}\s*USER PROFILE \(who the user is\)[^═]*═{10,}/gi, '--- USER CONTEXT ---')

    // 4. Structural runtime headers (must run before generic 'hermes' catch-all)
    .replace(/# Hermes runtime environment/gi, '# Runtime environment')
    .replace(/<!-- End Hermes runtime environment -->/gi, '<!-- End runtime environment -->')

    // 5. Env vars, paths, and identifiers
    .replace(/HERMES_KANBAN_/gi, 'AGENT_KANBAN_')
    .replace(/HERMES_TENANT/gi, 'AGENT_TENANT')
    .replace(/hermes-agent/gi, 'agent-guide')
    .replace(/hermes_tools/gi, 'agent_tools')
    .replace(/data-hermes-send/gi, 'data-agent-send')
    .replace(/window\.hermes\.send/gi, 'window.agent.send')
    .replace(/never via Hermes bot/gi, 'never via the assistant bot')
    .replace(/\bHermes\b/gi, 'the agent')

    // 6. Generic catch-all (last, after all specific patterns)
    .replace(/hermes/gi, 'agent')

    // 7. OpenClaw & Gateway signatures
    .replace(/You are a personal assistant running inside OpenClaw\./gi, 'You are a personal assistant.')
    .replace(/\bantigravity\b/gi, 'upstream-service')
    .replace(/\b9router\b/gi, 'local-gateway')
    .replace(/انتی گراویتی/g, 'سرویس بالادستی')
    .replace(/VALIDATION_REQUIRED/g, 'AUTH_CHECK');

  const replacements = Array.isArray(customReplacements) && customReplacements.length > 0
    ? customReplacements
    : (Array.isArray(config.customReplacements) ? config.customReplacements : []);

  for (const rule of replacements) {
    if (rule && rule.find) {
      try {
        if (rule.isRegex) {
          res = res.replace(new RegExp(rule.find, 'g'), rule.replace || '');
        } else {
          res = res.split(rule.find).join(rule.replace || '');
        }
      } catch (_) {}
    }
  }

  return res;
}

function simplifySchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const copy = Array.isArray(schema) ? [...schema] : { ...schema };

  delete copy.$schema;
  delete copy.strict;
  delete copy.additionalProperties;
  delete copy.minItems;
  delete copy.maxItems;
  delete copy.minimum;
  delete copy.maximum;

  if (copy.anyOf) {
    delete copy.anyOf;
    if (!copy.type) copy.type = 'string';
  }

  if (copy.properties && typeof copy.properties === 'object') {
    const newProps = {};
    for (const [k, v] of Object.entries(copy.properties)) {
      newProps[k] = simplifySchema(v);
    }
    copy.properties = newProps;
  }

  if (copy.items) {
    copy.items = simplifySchema(copy.items);
  }

  return copy;
}

function isTitleGenerationRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return false;
  if (Array.isArray(body.tools) && body.tools.length > 0) return false;
  const sysMsg = body.messages.find(m => m.role === 'system');
  if (sysMsg && typeof sysMsg.content === 'string' && sysMsg.content.startsWith('You name chat sessions.')) {
    return true;
  }
  const maxTokens = body.max_tokens || body.max_completion_tokens;
  const lastMsg = body.messages[body.messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user') return false;
  const content = typeof lastMsg?.content === 'string'
    ? lastMsg.content
    : Array.isArray(lastMsg?.content) ? lastMsg.content.map(c => c.text || '').join(' ') : '';

  if (body.messages.length <= 4 && /(?:session\s*title|chat\s*title|title\s+for\s+this|generate\s+(?:a\s+)?(?:short\s+)?title|create\s+(?:a\s+)?(?:3-5\s+word\s+)?title)/i.test(content)) {
    return true;
  }
  if (maxTokens && maxTokens <= 25 && /title/i.test(content)) return true;
  return false;
}

function generateMockTitleResponse(titleOrBody, model = 'default') {
  let title = 'New Chat';
  let targetModel = model;

  if (typeof titleOrBody === 'string') {
    title = titleOrBody;
  } else if (titleOrBody && typeof titleOrBody === 'object') {
    if (titleOrBody.model) targetModel = titleOrBody.model;
    if (Array.isArray(titleOrBody.messages)) {
      const uMsg = titleOrBody.messages.find(m => m.role === 'user');
      if (uMsg && typeof uMsg.content === 'string') {
        title = uMsg.content.trim().split('\n')[0].slice(0, 35) || 'New Chat';
      }
    }
  }

  return {
    id: 'chatcmpl-local-title',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: targetModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ title })
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

function sanitizePayload(rawBody, headers = {}, options = config) {
  let modifiedHeaders = { ...headers };
  let modifiedBody = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  let isTitleRequest = false;
  let userTextForTitle = 'New Chat';
  let changed = false;
  const changes = [];

  const shouldSpoofUA = options.spoofUserAgent !== false;
  if (shouldSpoofUA) {
    modifiedHeaders['user-agent'] = options.customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    delete modifiedHeaders['x-title'];
    delete modifiedHeaders['http-referer'];
    delete modifiedHeaders['x-hermes-version'];
    delete modifiedHeaders['x-client-name'];
  }

  const noTools = options.noTools || false;

  try {
    const json = JSON.parse(modifiedBody);

    // Strip or map reasoning_effort based on config target
        if (options.fixReasoningEffort !== false && json.reasoning_effort !== undefined) {
          const source = options.reasoningEffortSource || 'any';
          const target = options.reasoningEffortTarget || 'remove';
          const shouldAct = source === 'any' || json.reasoning_effort === source;
          if (shouldAct) {
            if (target === 'remove') {
              delete json.reasoning_effort;
              changes.push('Removed reasoning_effort');
            } else {
              json.reasoning_effort = target;
              changed = true;
              changes.push(`Mapped reasoning_effort to ${target}`);
            }
            if (target === 'remove') changed = true;
          }
        }

    if (Array.isArray(json.messages)) {
      if (options.mockLocalTitles !== false && isTitleGenerationRequest(json)) {
        isTitleRequest = true;
        const sysMsg = json.messages.find(m => m.role === 'system');
        if (sysMsg && typeof sysMsg.content === 'string' && sysMsg.content.startsWith('You name chat sessions.')) {
          const uMsg = json.messages.find(m => m.role === 'user');
          if (uMsg && typeof uMsg.content === 'string') {
            userTextForTitle = uMsg.content.trim().split('\n')[0].slice(0, 35) || 'New Chat';
          }
        } else {
          const lastMsg = json.messages[json.messages.length - 1];
          const lastContent = typeof lastMsg?.content === 'string'
            ? lastMsg.content
            : Array.isArray(lastMsg?.content) ? lastMsg.content.map(c => c.text || '').join(' ') : '';
          userTextForTitle = lastContent.trim().split('\n')[0].slice(0, 35) || 'New Chat';
        }
      }

      if (options.stripSignatures !== false) {
        json.messages = json.messages.map(m => {
          if (m.role === 'system' || m.role === 'developer' || m.role === 'user') {
            if (typeof m.content === 'string') {
              const cleaned = cleanTextSignature(m.content, options.customReplacements);
              if (cleaned !== m.content) {
                m.content = cleaned;
                changed = true;
                changes.push(`Sanitized ${m.role} message`);
              }
            } else if (Array.isArray(m.content)) {
              m.content = m.content.map(part => {
                if (part && typeof part.text === 'string') {
                  const cleaned = cleanTextSignature(part.text, options.customReplacements);
                  if (cleaned !== part.text) {
                    part.text = cleaned;
                    changed = true;
                    changes.push(`Sanitized multipart ${m.role} message`);
                  }
                }
                return part;
              });
            }
          }
          return m;
        });
      }
    }

    if (options.stripSignatures !== false && typeof json.system === 'string') {
      const cleaned = cleanTextSignature(json.system, options.customReplacements);
      if (cleaned !== json.system) {
        json.system = cleaned;
        changed = true;
        changes.push('Sanitized top-level system prompt');
      }
    }

    // Native Gemini systemInstruction field support
    if (options.stripSignatures !== false && json.systemInstruction) {
      if (typeof json.systemInstruction === 'string') {
        const cleaned = cleanTextSignature(json.systemInstruction, options.customReplacements);
        if (cleaned !== json.systemInstruction) {
          json.systemInstruction = cleaned;
          changed = true;
          changes.push('Sanitized systemInstruction string');
        }
      } else if (Array.isArray(json.systemInstruction.parts)) {
        json.systemInstruction.parts = json.systemInstruction.parts.map(part => {
          if (part && typeof part.text === 'string') {
            const cleaned = cleanTextSignature(part.text, options.customReplacements);
            if (cleaned !== part.text) {
              part.text = cleaned;
              changed = true;
              changes.push('Sanitized systemInstruction part');
            }
          }
          return part;
        });
      }
    }

    // Handle tools array
    if (noTools) {
      if (json.tools) {
        delete json.tools;
        delete json.tool_choice;
        changed = true;
        changes.push('Removed tools and tool_choice');
      }
    } else if (options.simplifyToolSchemas !== false && Array.isArray(json.tools)) {
      delete json.strict;
      json.tools = json.tools.map(t => {
        delete t.strict;
        if (t.function) {
          delete t.function.strict;
          if (options.stripSignatures !== false && typeof t.function.description === 'string') {
            t.function.description = cleanTextSignature(t.function.description, options.customReplacements);
          }
          if (t.function.parameters) {
            t.function.parameters = simplifySchema(t.function.parameters);
            changed = true;
          }
        }
        return t;
      });
      changes.push('Simplified tool schemas');
    }

    if (json.strict !== undefined) {
      delete json.strict;
      changed = true;
    }

    if (changed) {
      stats.sanitizedCount++;
    }

    modifiedBody = JSON.stringify(json);
  } catch (_) {
    // Non-JSON payload
  }

  modifiedHeaders['content-length'] = Buffer.byteLength(modifiedBody);
  return { modifiedBody, modifiedHeaders, isTitleRequest, userTextForTitle, changed, changes };
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

// --- HTTP Request Handler ---
const server = http.createServer((req, res) => {
  setCorsHeaders(res);
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
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
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const {
      modifiedBody,
      modifiedHeaders,
      isTitleRequest,
      userTextForTitle,
      changed,
      changes
    } = sanitizePayload(rawBody, req.headers, config);

    let model = 'N/A';
    let toolCount = 0;
    let isStream = false;
    try {
      const parsed = JSON.parse(modifiedBody);
      model = parsed.model || 'N/A';
      toolCount = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
      isStream = Boolean(parsed.stream);
    } catch (_) {}

    if (isTitleRequest) {
      stats.savedTitleCalls++;
      if (isStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const chunk = {
          id: 'chatcmpl-local-title',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            delta: { content: JSON.stringify({ title: userTextForTitle }) },
            finish_reason: null
          }]
        };
        const doneChunk = {
          id: 'chatcmpl-local-title',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(doneChunk)}\n\ndata: [DONE]\n\n`);
        res.end();
      } else {
        const mockResponse = generateMockTitleResponse(userTextForTitle, model);
        const fakeTitleResp = JSON.stringify(mockResponse);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Content-Length': Buffer.byteLength(fakeTitleResp)
        });
        res.end(fakeTitleResp);
      }
      console.log(`[${new Date().toISOString()}] ⚡ Handled session title locally ("${userTextForTitle}")`);
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
        snippet: `Handled session title locally ("${userTextForTitle}")`,
        details: { titleMock: true, model }
      });
      return;
    }

    const timestamp = new Date().toISOString();
    if (req.url.includes('/chat/completions') || req.url.includes('/messages')) {
      writeLog('\n' + '='.repeat(90));
      writeLog(`[${timestamp}] >>> REQUEST: ${req.method} ${req.url} ${config.noTools ? '[NO-TOOLS]' : '[SIMPLIFIED-TOOLS]'}`);
      try {
        const parsed = JSON.parse(modifiedBody);
        console.log(`[${timestamp}] >>> ${req.method} ${req.url} | model=${parsed.model} | stream=${!!parsed.stream} | tools=${parsed.tools?.length ?? 0}`);
        writeLog(JSON.stringify(parsed, null, 2));
      } catch {
        writeLog(modifiedBody);
      }
    }

    // Forward to Upstream
    const isHttps = config.targetProtocol === 'https' || config.targetPort === 443;
    const transport = isHttps ? https : http;
    const targetHost = config.targetHost || '127.0.0.1';
    const targetPort = config.targetPort || 20128;
    const hostHeader = (targetPort === 80 || targetPort === 443)
      ? targetHost
      : `${targetHost}:${targetPort}`;

    const proxyHeaders = { ...modifiedHeaders };
    proxyHeaders['host'] = hostHeader;

    delete proxyHeaders['connection'];
    delete proxyHeaders['transfer-encoding'];
    delete proxyHeaders['origin'];
    delete proxyHeaders['referer'];

    if (config.targetApiKey && config.targetApiKey.trim().length > 0) {
      proxyHeaders['authorization'] = `Bearer ${config.targetApiKey.trim()}`;
    }

    let forwardPath = req.url;
    if (config.targetBasePath) {
      const base = config.targetBasePath.replace(/\/+$/, '');
      forwardPath = base + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }

    // Forward to Upstream with retry on 429 quota exhaustion
    const isChatEndpoint = req.url.includes('/chat/completions') || req.url.includes('/messages');

    const forwardRequest = (attempt = 1) => new Promise((resolve, reject) => {
      const proxyReq = transport.request({
        hostname: targetHost,
        port: targetPort,
        path: forwardPath,
        method: req.method,
        headers: proxyHeaders
      }, (proxyRes) => {
        const respHeaders = { ...proxyRes.headers };
        respHeaders['access-control-allow-origin'] = '*';
        const status = proxyRes.statusCode;

        // Retry on 429 quota exhaustion (upstream says "reset after Xs")
        if (status === 429 && attempt < 3 && isChatEndpoint) {
          let respChunks = [];
          proxyRes.on('data', chunk => respChunks.push(chunk));
          proxyRes.on('end', () => {
            const fullResp = Buffer.concat(respChunks).toString('utf8');
            let waitMs = 2000 * attempt;
            try {
              const m = fullResp.match(/reset after (\d+)s/);
              if (m) waitMs = parseInt(m[1]) * 1000;
            } catch (_) {}
            console.log(`[AG-Shield] 429 quota exhausted, retry ${attempt}/3 after ${waitMs}ms`);
            setTimeout(() => forwardRequest(attempt + 1).then(resolve, reject), waitMs);
          });
          return;
        }

        res.writeHead(status, respHeaders);

        let respChunks = [];
        proxyRes.on('data', chunk => {
          respChunks.push(chunk);
          res.write(chunk);
        });

        proxyRes.on('end', () => {
          res.end();
          const latencyMs = Date.now() - startTime;
          const fullResp = Buffer.concat(respChunks).toString('utf8');

          if (isChatEndpoint) {
            const endTs = new Date().toISOString();
            if (status >= 400) {
              console.log(`[${endTs}] ❌ STATUS ${status}: ${fullResp.slice(0, 300)}`);
            } else {
              console.log(`[${endTs}] ✅ STATUS ${status} OK (${fullResp.length} bytes)`);
            }
            writeLog(`\n--- RESPONSE FROM 9ROUTER (STATUS ${status}) ---`);
            writeLog(fullResp);
          }

          let errorReason = '';
          if (status >= 400) {
            stats.errorCount++;
            try {
              const errObj = JSON.parse(fullResp);
              errorReason = (errObj.error && errObj.error.message) || errObj.message || errObj.error || '';
            } catch (_) {
              errorReason = fullResp.slice(0, 120).trim();
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
            sanitized: changed,
            snippet: errorReason
              ? `${status} upstream: ${errorReason}`
              : `Proxied to ${config.targetProtocol || 'http'}://${targetHost}:${targetPort}`,
            details: { changes, model, status, errorReason, responsePreview: fullResp.slice(0, 300) }
          });
          resolve();
        });
      });

      proxyReq.on('error', (err) => {
        stats.errorCount++;
        const latencyMs = Date.now() - startTime;
        const errorMsg = `AG-Shield: Upstream target unreachable at ${config.targetProtocol || 'http'}://${targetHost}:${targetPort} (${err.code || err.message})`;

        console.error('❌ Cannot reach 9Router:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ error: { message: errorMsg, code: 'UPSTREAM_UNAVAILABLE' } }));
        }

        logTraffic({
          id: Date.now(),
          timestamp: new Date().toISOString(),
          method: req.method,
          path: req.url,
          model,
          toolCount,
          status: 502,
          latencyMs,
          sanitized: changed,
          snippet: errorMsg,
          details: { error: err.message, code: err.code }
        });
        reject(err);
      });

      if (modifiedBody) {
        proxyReq.write(modifiedBody);
      }
      proxyReq.end();
    });

    forwardRequest(1).catch(() => {});
  });
});

// Start Server
if (require.main === module) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[AG-SHIELD] ERROR: Port ${config.listenPort} is already in use!`);
      console.error(`Another instance (or background service) is occupying port ${config.listenPort}.`);
      console.error(`To stop it and free the port, run:`);
      console.error(`  ag-shield stop   (or node index.js stop)\n`);
      process.exit(1);
    } else {
      console.error('[AG-SHIELD] Server error:', err.message);
      process.exit(1);
    }
  });

  server.listen(config.listenPort, '0.0.0.0', () => {
    if (fileLogging) {
      try {
        fs.writeFileSync(LOG_FILE, `=== Log started at ${new Date().toISOString()} ===\n`, 'utf8');
      } catch (_) {}
    }
    if (!args.includes('--no-tray') && process.platform === 'win32') {
      startWindowsTray(config.listenPort);
    }
    const autoInfo = getAutostartInfo();
    console.log(`
🛡️  AG-SHIELD (Antigravity & Agentic AI Sanitizer Proxy)
-------------------------------------------------------
📡 Proxy Endpoint:    http://127.0.0.1:${config.listenPort}/v1
🎯 Target Gateway:    ${config.targetProtocol || 'http'}://${config.targetHost}:${config.targetPort}
🖥️  Web Control Panel: http://127.0.0.1:${config.listenPort}/ui
🚀 System Autostart:  ${autoInfo.enabled ? 'ACTIVE (' + autoInfo.path + ')' : 'OFF'}
📝 File Logging:      ${fileLogging ? 'ENABLED (' + LOG_FILE + ')' : 'OFF (use --log to enable)'}
-------------------------------------------------------
`);
  });
}

// Export for testing
module.exports = {
  server,
  startWindowsTray,
  killProcessOnPort,
  stopWindowsTray,
  config,
  PKG_VERSION,
  updateState,
  isNewerVersion,
  checkRemoteVersion,
  runSelfUpdate,
  stats,
  cleanTextSignature,
  simplifySchema,
  sanitizeText: (text, custom) => ({ text: cleanTextSignature(text, custom), changed: text !== cleanTextSignature(text, custom) }),
  cleanJsonSchema: simplifySchema,
  isTitleGenerationRequest,
  generateMockTitleResponse,
  sanitizePayload,
  getAutostartInfo,
  setAutostart,
  DEFAULT_CONFIG,
  writeLog,
  LOG_FILE
};