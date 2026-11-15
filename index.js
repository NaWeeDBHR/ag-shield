#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// --- Configuration & Persistence ---
const CONFIG_FILE = path.join(process.cwd(), 'ag-shield.config.json');
const UI_FILE = path.join(__dirname, 'ui.html');

const DEFAULT_CONFIG = {
  listenPort: 20129,
  targetHost: '127.0.0.1',
  targetPort: 20128,
  stripSignatures: true,
  simplifyToolSchemas: true,
  fixReasoningEffort: true,
  mockLocalTitles: true,
  spoofUserAgent: true,
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

// CLI args parsing
const args = process.argv.slice(2);
let fileLogging = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(`
AG-SHIELD - Antigravity & Agentic AI Sanitizer Proxy

Usage:
  ag-shield [port] [targetPort] [flags]

Flags:
  --log, -l           Append traffic events to proxy-traffic.log
  --no-tools          Disable tool schema simplification
  --no-local-title    Disable mocking of session_title calls
  --host <host>       Set target upstream host (default: 127.0.0.1)
  --port <port>       Set listen port (default: 20129)
  --target-port <p>   Set target upstream port (default: 20128)
  --help, -h          Show this help message

Web Dashboard:
  http://127.0.0.1:20129/ui
`);
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

function logTraffic(entry) {
  trafficLogs.unshift(entry);
  if (trafficLogs.length > MAX_LOGS) trafficLogs.pop();

  // Push to SSE clients
  const payload = `data: ${JSON.stringify({ type: 'log', data: entry })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }

  // Broadcast stats
  const statsPayload = `data: ${JSON.stringify({ type: 'stats', data: getStats() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(statsPayload);
    } catch (_) {
      sseClients.delete(client);
    }
  }

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

// Patterns for agent fingerprinting
const AGENT_SIGNATURE_PATTERNS = [
  // Names & explicit roles
  /(?:You are\s+)?(?:Hermes Agent|hermes-agent|Nous Research Hermes|Nous Research)/gi,
  /(?:You are\s+)?(?:OpenClaw|openclaw)/gi,
  /(?:You are\s+)?(?:Roo Code|Roo-Cline|Cline|Aider|Cursor Agent)/gi,
  // Docs & repos
  /https?:\/\/(?:docs\.nousresearch\.com|github\.com\/nousresearch|github\.com\/cline|github\.com\/openclaw)[^\s)"]*/gi,
  // Runtime environment marker blocks
  /#\s*Runtime environment[\s\S]*?(?:<!--\s*End runtime environment\s*-->|(?=\n#[A-Za-z0-9_\s]+|\n\n[A-Z]|$))/gi,
  /User home directory:\s*[^\n]+/gi,
  /Current working directory:\s*[^\n]+/gi,
  /Scratch directory:\s*[^\n]+/gi,
  // Operational directives headers that trigger fingerprinting
  /#\s*Operational directives/gi,
  /#\s*Tool-use enforcement/gi
];

function sanitizeText(text, customReplacements = []) {
  if (typeof text !== 'string') return { text, changed: false };
  let original = text;
  let modified = text;

  // Built-in signature stripping
  if (config.stripSignatures) {
    for (const pattern of AGENT_SIGNATURE_PATTERNS) {
      modified = modified.replace(pattern, (match) => {
        // If it was a "You are <Agent>" intro, keep a neutral system intro
        if (/^You are\s+/i.test(match)) {
          return 'You are a helpful AI assistant.';
        }
        return '';
      });
    }
  }

  // Custom user-defined replacements
  if (Array.isArray(customReplacements)) {
    for (const rule of customReplacements) {
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
  }

  return { text: modified, changed: modified !== original };
}

// Recursive schema cleaner: collapse anyOf, strip unsupported JSON schema properties
function cleanJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanJsonSchema);

  const clone = { ...schema };

  // Collapse anyOf / oneOf / allOf
  const candidates = clone.anyOf || clone.oneOf || clone.allOf;
  if (Array.isArray(candidates) && candidates.length > 0) {
    delete clone.anyOf;
    delete clone.oneOf;
    delete clone.allOf;

    // Pick primary non-null candidate
    const primary = candidates.find(c => c && c.type && c.type !== 'null') || candidates[0];
    if (primary && typeof primary === 'object') {
      const cleanedPrimary = cleanJsonSchema(primary);
      Object.assign(clone, cleanedPrimary);
    }
  }

  // Strip keys that cause 400/429 on Gemini / OpenAI compatibility endpoints
  delete clone.$schema;
  delete clone.additionalProperties;
  delete clone.strict;
  delete clone.minItems;
  delete clone.maxItems;
  delete clone.minimum;
  delete clone.maximum;
  delete clone.minLength;
  delete clone.maxLength;

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

// Title prompt detector to save RPM
function isTitleGenerationRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return false;
  // If explicitly requested title or short title generator
  const maxTokens = body.max_tokens || body.max_completion_tokens;
  const lastMsg = body.messages[body.messages.length - 1];
  const content = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : Array.isArray(lastMsg.content)
      ? lastMsg.content.map(c => c.text || '').join(' ')
      : '';

  const titleRegex = /(?:session\s*title|chat\s*title|title\s+for\s+this|generate\s+(?:a\s+)?(?:short\s+)?title|summarize\s+into\s+(?:a\s+)?(?:short\s+)?title|create\s+(?:a\s+)?(?:3-5\s+word\s+)?title)/i;

  if (titleRegex.test(content)) return true;
  if (maxTokens && maxTokens <= 25 && /title/i.test(content)) return true;
  return false;
}

function generateMockTitleResponse(body) {
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
          content: 'New Session'
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

// Sanitize the full OpenAI / Chat payload
function sanitizePayload(body) {
  let changed = false;
  const changes = [];

  // 1. Fix reasoning_effort: "none" -> "low"
  if (config.fixReasoningEffort && body.reasoning_effort === 'none') {
    body.reasoning_effort = 'low';
    changed = true;
    changes.push('Mapped reasoning_effort: "none" -> "low"');
  }

  // 2. Strip signatures from messages
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

  // 3. Top-level system string (Anthropic or Gemini compat)
  if (typeof body.system === 'string') {
    const { text, changed: textChanged } = sanitizeText(body.system, config.customReplacements);
    if (textChanged) {
      body.system = text;
      changed = true;
      changes.push('Sanitized top-level system prompt');
    }
  }

  // 4. Simplify tool schemas
  if (config.simplifyToolSchemas && Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (tool.function) {
        if (tool.function.strict !== undefined) {
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

  if (body.strict !== undefined) {
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
      config,
      stats: getStats(),
      logs: trafficLogs
    }));
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
        // Fall back to original body if JSON parse fails
        console.warn('[AG-SHIELD] Could not parse request body as JSON:', err.message);
      }
    }

    // Forward to Upstream
    const proxyHeaders = { ...req.headers };
    delete proxyHeaders['host'];
    proxyHeaders['host'] = `${config.targetHost}:${config.targetPort}`;

    if (config.spoofUserAgent) {
      proxyHeaders['user-agent'] = 'OpenAI/NodeJS/4.0.0 (Windows NT 10.0; Win64; x64)';
      delete proxyHeaders['x-hermes-version'];
      delete proxyHeaders['x-client-name'];
    }

    if (finalBody.length > 0) {
      proxyHeaders['content-length'] = Buffer.byteLength(finalBody);
    } else {
      delete proxyHeaders['content-length'];
    }

    const proxyReq = http.request({
      hostname: config.targetHost,
      port: config.targetPort,
      path: req.url,
      method: req.method,
      headers: proxyHeaders
    }, (proxyRes) => {
      // Copy upstream headers & inject CORS
      const respHeaders = { ...proxyRes.headers };
      respHeaders['access-control-allow-origin'] = '*';
      res.writeHead(proxyRes.statusCode, respHeaders);

      // Stream response chunks
      proxyRes.on('data', chunk => res.write(chunk));
      proxyRes.on('end', () => {
        res.end();
        const latencyMs = Date.now() - startTime;
        const status = proxyRes.statusCode;

        if (status >= 400) {
          stats.errorCount++;
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
          snippet: `Proxied to ${config.targetHost}:${config.targetPort}`,
          details: { changes, model, status }
        });
      });
    });

    proxyReq.on('error', (err) => {
      stats.errorCount++;
      const latencyMs = Date.now() - startTime;
      const errorMsg = `AG-Shield: Upstream target unreachable at ${config.targetHost}:${config.targetPort} (${err.code || err.message})`;

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
    console.log(`
🛡️  AG-SHIELD (Antigravity & Agentic AI Sanitizer Proxy)
-------------------------------------------------------
📡 Proxy Endpoint:    http://127.0.0.1:${config.listenPort}/v1
🎯 Target Gateway:    http://${config.targetHost}:${config.targetPort}
🖥️  Web Control Panel: http://127.0.0.1:${config.listenPort}/ui
-------------------------------------------------------
`);
  });
}

// Export for testing
module.exports = {
  server,
  config,
  stats,
  sanitizeText,
  cleanJsonSchema,
  isTitleGenerationRequest,
  generateMockTitleResponse,
  sanitizePayload,
  DEFAULT_CONFIG
};
