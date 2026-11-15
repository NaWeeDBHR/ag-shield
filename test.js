'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  server,
  config,
  stats,
  sanitizeText,
  cleanJsonSchema,
  isTitleGenerationRequest,
  generateMockTitleResponse,
  sanitizePayload,
  getAutostartInfo,
  setAutostart,
  DEFAULT_CONFIG
} = require('./index');

// Ensure pristine defaults regardless of on-disk config from earlier runs
for (const key of Object.keys(config)) delete config[key];
Object.assign(config, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));

console.log('Running AG-Shield comprehensive test suite...');

// 1. Test Signature Sanitization
{
  const input = 'You are Hermes Agent. Follow rules at https://docs.nousresearch.com.\n# Runtime environment\nHost: Windows 10\nUser home directory: C:\\Users\\test\n<!-- End runtime environment -->\nAct as effective assistant.';
  const { text, changed } = sanitizeText(input);
  assert.strictEqual(changed, true, 'Sanitization should detect changes');
  assert.ok(!text.includes('Hermes Agent'), 'Should strip Hermes Agent');
  assert.ok(!text.includes('docs.nousresearch.com'), 'Should strip docs url');
  assert.ok(!text.includes('Runtime environment'), 'Should strip runtime block');
  assert.ok(text.includes('You are a helpful AI assistant.'), 'Should inject neutral assistant intro');
  console.log('  [PASS] 1. Signature sanitization');
}

// 2. Test JSON Schema Simplification & anyOf collapsing
{
  const complexSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    strict: true,
    additionalProperties: false,
    type: 'object',
    properties: {
      userId: {
        anyOf: [
          { type: 'string', description: 'User identifier' },
          { type: 'null' }
        ]
      },
      tags: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'string',
          minLength: 2
        }
      }
    }
  };

  const cleaned = cleanJsonSchema(complexSchema);
  assert.strictEqual(cleaned.$schema, undefined, 'Should delete $schema');
  assert.strictEqual(cleaned.strict, undefined, 'Should delete strict');
  assert.strictEqual(cleaned.additionalProperties, undefined, 'Should delete additionalProperties');
  assert.strictEqual(cleaned.properties.userId.anyOf, undefined, 'Should collapse anyOf');
  assert.strictEqual(cleaned.properties.userId.type, 'string', 'Should collapse to string type');
  assert.strictEqual(cleaned.properties.tags.minItems, undefined, 'Should delete minItems');
  assert.strictEqual(cleaned.properties.tags.maxItems, undefined, 'Should delete maxItems');
  assert.strictEqual(cleaned.properties.tags.items.minLength, undefined, 'Should delete minLength');
  console.log('  [PASS] 2. Tool schema simplification and anyOf collapse');
}

// 3. Test Title Generation Detection & Mock Response
{
  const titleReq = {
    model: 'gemini-2.5-pro',
    messages: [
      { role: 'user', content: 'Generate a 3-5 word title for this conversation' }
    ]
  };
  assert.strictEqual(isTitleGenerationRequest(titleReq), true, 'Should detect title generation request');

  const normalReq = {
    model: 'gemini-2.5-pro',
    messages: [
      { role: 'user', content: 'Explain quantum computing in simple terms' }
    ]
  };
  assert.strictEqual(isTitleGenerationRequest(normalReq), false, 'Should not detect normal prompt as title');

  const mock = generateMockTitleResponse(titleReq);
  assert.strictEqual(mock.object, 'chat.completion', 'Should return valid chat completion object');
  assert.strictEqual(mock.choices[0].message.role, 'assistant', 'Should return assistant role');
  assert.ok(mock.choices[0].message.content.length > 0, 'Should return non-empty title');
  console.log('  [PASS] 3. Title request detection & mock response generation');
}

// 4. Test Autostart System Detector
{
  const info = getAutostartInfo();
  assert.ok(info.platform, 'Autostart should detect platform');
  assert.ok(info.path, 'Autostart should detect startup path');
  assert.ok(info.systemdSnippet, 'Autostart should generate systemd template');
  console.log(`  [PASS] 4. Autostart detector (${info.platform} / ${info.type})`);
}

// 5. Test Server HTTP Endpoints & Live Upstream Proxying
const PROXY_PORT = 29998;
const UPSTREAM_PORT = 29997;

let upstreamReceivedRequest = null;
let upstreamReceivedBody = null;

// Mock Upstream Gateway
const upstreamServer = http.createServer((req, res) => {
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    upstreamReceivedRequest = req;
    if (chunks.length > 0) {
      try {
        upstreamReceivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {}
    }

    if (req.url === '/v1/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('data: {"chunk": 1}\n\n');
      setTimeout(() => {
        res.write('data: {"chunk": 2}\n\n');
        res.end('data: [DONE]\n\n');
      }, 30);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-mock-upstream',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Upstream response OK' } }]
    }));
  });
});

function makeRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: PROXY_PORT,
      path,
      ...options
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runServerTests() {
  await new Promise(r => upstreamServer.listen(UPSTREAM_PORT, '127.0.0.1', r));

  // Configure proxy to point to our mock upstream
  config.targetPort = UPSTREAM_PORT;
  config.targetHost = '127.0.0.1';
  config.targetProtocol = 'http';
  config.targetApiKey = 'test-token-xyz';

  await new Promise(r => server.listen(PROXY_PORT, '127.0.0.1', r));

  try {
    // A. UI Route
    const uiRes = await makeRequest('/ui');
    assert.strictEqual(uiRes.status, 200, '/ui should return 200');
    assert.ok(uiRes.body.includes('AG-SHIELD'), '/ui body should include AG-SHIELD brand');

    // B. Status Route
    const statusRes = await makeRequest('/api/status');
    assert.strictEqual(statusRes.status, 200, '/api/status should return 200');
    const statusData = JSON.parse(statusRes.body);
    assert.ok(statusData.config, 'Status should contain config');
    assert.ok(statusData.stats, 'Status should contain stats');
    assert.ok(statusData.autostart, 'Status should contain autostart');

    // C. Autostart Route
    const autoRes = await makeRequest('/api/autostart');
    assert.strictEqual(autoRes.status, 200, '/api/autostart should return 200');

    // D. Local Title Intercept
    const titleRes = await makeRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Create a 3-5 word title for this chat' }]
    });
    assert.strictEqual(titleRes.status, 200);
    const titleData = JSON.parse(titleRes.body);
    assert.strictEqual(titleData.choices[0].message.content, 'New Session');

    // E. Upstream Sanitized Proxying
    upstreamReceivedRequest = null;
    const proxyRes = await makeRequest('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Hermes-Agent-v1.0',
        'x-client-name': 'OpenClaw'
      }
    }, {
      model: 'gemini-2.5-pro',
      reasoning_effort: 'none',
      strict: true,
      messages: [
        { role: 'system', content: 'You are Hermes Agent. Follow rules at https://docs.nousresearch.com.\n# Runtime environment\nHost: Win10\n<!-- End runtime environment -->' },
        { role: 'user', content: 'Hello AI' }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { city: { type: 'string' } }
          }
        }
      }]
    });

    assert.strictEqual(proxyRes.status, 200, 'Proxied response should return 200');
    assert.ok(upstreamReceivedRequest, 'Upstream should have received request');
    assert.strictEqual(upstreamReceivedRequest.headers['authorization'], 'Bearer test-token-xyz', 'Bearer header injected');
    assert.strictEqual(upstreamReceivedRequest.headers['user-agent'], 'OpenAI/NodeJS/4.0.0 (Windows NT 10.0; Win64; x64)', 'User-Agent spoofed');
    assert.strictEqual(upstreamReceivedRequest.headers['x-client-name'], undefined, 'Agent header stripped');
    assert.strictEqual(upstreamReceivedBody.reasoning_effort, 'low', 'reasoning_effort fixed');
    assert.strictEqual(upstreamReceivedBody.strict, undefined, 'strict stripped');
    assert.ok(!upstreamReceivedBody.messages[0].content.includes('Hermes Agent'), 'Signature stripped');
    assert.strictEqual(upstreamReceivedBody.tools[0].function.strict, undefined, 'Tool strict stripped');

    // F. Streaming SSE passthrough
    const streamRes = await makeRequest('/v1/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { stream: true });
    assert.strictEqual(streamRes.status, 200);
    assert.ok(streamRes.body.includes('data: {"chunk": 1}'), 'Stream chunk 1 received');
    assert.ok(streamRes.body.includes('data: [DONE]'), 'Stream [DONE] received');

        // G. Granular Behavior Customization via /api/config
    const customConfigRes = await makeRequest('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      reasoningEffortSource: 'none',
      reasoningEffortTarget: 'medium',
      mockTitleText: 'Dynamic Test Title',
      customUserAgent: 'TestCustomAgent/3.0',
      signatureReplacementText: 'I am a customized bot.'
    });
    assert.strictEqual(customConfigRes.status, 200);

    // Verify title text customization
    const titleCustomRes = await makeRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Generate a short session title' }]
    });
    const titleCustomData = JSON.parse(titleCustomRes.body);
    assert.strictEqual(titleCustomData.choices[0].message.content, 'Dynamic Test Title', 'Mock title should use customized text');

    // Verify reasoning_effort mapped to medium and custom user-agent
    upstreamReceivedRequest = null;
    await makeRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'gemini-2.5-pro',
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: 'You are Hermes Agent. Do things.' },
        { role: 'user', content: 'Hi' }
      ]
    });
    assert.strictEqual(upstreamReceivedBody.reasoning_effort, 'medium', 'Should map reasoning_effort to medium');
    assert.strictEqual(upstreamReceivedRequest.headers['user-agent'], 'TestCustomAgent/3.0', 'Should use custom User-Agent');
    assert.ok(upstreamReceivedBody.messages[0].content.includes('I am a customized bot.'), 'Should use custom replacement text');

    // Verify reasoning_effort removal option
    await makeRequest('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      reasoningEffortTarget: 'remove'
    });
    await makeRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'gemini-2.5-pro',
      reasoning_effort: 'none',
      messages: [{ role: 'user', content: 'Test remove' }]
    });
    assert.strictEqual(upstreamReceivedBody.reasoning_effort, undefined, 'Should delete reasoning_effort field when target=remove');

    console.log('  [PASS] 6. Granular Rule Behavior Customization (/api/config live updates)');

    console.log('  [PASS] 5. Full Server API & Upstream Reverse-Proxy Integration');
    console.log('\n========================================');
    console.log('  ALL AG-SHIELD TESTS PASSED (100% OK)');
    console.log('========================================\n');

    await new Promise(r => upstreamServer.close(r));
    await new Promise(r => server.close(r));
    const cfgFile = path.join(process.cwd(), 'ag-shield.config.json');
    if (fs.existsSync(cfgFile)) {
      try { fs.unlinkSync(cfgFile); } catch (_) {}
    }
    process.exit(0);
  } catch (err) {
    console.error('Test suite failed:', err);
    try { upstreamServer.close(); } catch (_) {}
    try { server.close(); } catch (_) {}
    process.exit(1);
  }
}

runServerTests();
