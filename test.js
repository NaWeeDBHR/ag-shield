'use strict';

const assert = require('assert');
const http = require('http');
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
  setAutostart
} = require('./index');

console.log('Running AG-Shield self-check suite...');

// 1. Test Signature Sanitization
{
  const input = 'You are Hermes Agent. Follow rules at https://docs.nousresearch.com.\n# Runtime environment\nHost: Windows 10\nUser home directory: C:\\Users\\test\n<!-- End runtime environment -->\nAct as effective assistant.';
  const { text, changed } = sanitizeText(input);
  assert.strictEqual(changed, true, 'Sanitization should detect changes');
  assert.ok(!text.includes('Hermes Agent'), 'Should strip Hermes Agent');
  assert.ok(!text.includes('docs.nousresearch.com'), 'Should strip docs url');
  assert.ok(!text.includes('Runtime environment'), 'Should strip runtime block');
  assert.ok(text.includes('You are a helpful AI assistant.'), 'Should inject neutral assistant intro');
  console.log('  [PASS] Signature sanitization');
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
  console.log('  [PASS] Tool schema simplification and anyOf collapse');
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
  console.log('  [PASS] Title request detection & mock response generation');
}

// 4. Test Autostart Helper
{
  const info = getAutostartInfo();
  assert.ok(info.platform, 'Autostart should detect platform');
  assert.ok(info.path, 'Autostart should detect startup path');
  console.log(`  [PASS] Autostart detector (platform: ${info.platform}, path: ${info.path})`);
}

// 5. Test Server HTTP Endpoints
const TEST_PORT = 29998;

function makeRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      ...options
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

server.listen(TEST_PORT, '127.0.0.1', async () => {
  try {
    // Test GET /ui
    const uiRes = await makeRequest('/ui');
    assert.strictEqual(uiRes.status, 200, '/ui should return 200');
    assert.ok(uiRes.body.includes('AG-SHIELD'), '/ui body should include AG-SHIELD brand');
    assert.ok(uiRes.body.includes('Main Upstream Router'), '/ui body should include Main Upstream Router panel');

    // Test GET /api/status
    const statusRes = await makeRequest('/api/status');
    assert.strictEqual(statusRes.status, 200, '/api/status should return 200');
    const statusData = JSON.parse(statusRes.body);
    assert.ok(statusData.config, 'Status should contain config');
    assert.ok(statusData.stats, 'Status should contain stats');
    assert.ok(statusData.autostart, 'Status should contain autostart info');

    // Test GET /api/autostart
    const autoRes = await makeRequest('/api/autostart');
    assert.strictEqual(autoRes.status, 200, '/api/autostart should return 200');
    const autoData = JSON.parse(autoRes.body);
    assert.ok(autoData.platform, 'Autostart API should return platform');

    // Test POST /api/config with router parameters
    const configRes = await makeRequest('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      stripSignatures: true,
      targetProtocol: 'https',
      targetHost: 'api.openai.com',
      targetPort: 443,
      targetApiKey: 'test-key-123',
      targetBasePath: '/v1'
    });
    assert.strictEqual(configRes.status, 200, '/api/config should return 200');
    const configData = JSON.parse(configRes.body);
    assert.strictEqual(configData.success, true, 'Config update success should be true');
    assert.strictEqual(configData.config.targetHost, 'api.openai.com');
    assert.strictEqual(configData.config.targetProtocol, 'https');

    // Reset config back to local defaults for downstream tests
    await makeRequest('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 20128,
      targetApiKey: '',
      targetBasePath: ''
    });

    // Test Mock Local Title endpoint handling
    const titleHttpRes = await makeRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Generate a short session title for this chat' }]
    });
    assert.strictEqual(titleHttpRes.status, 200, 'Mock title HTTP request should return 200');
    const titleData = JSON.parse(titleHttpRes.body);
    assert.strictEqual(titleData.choices[0].message.content, 'New Session', 'Should return synthetic session title');

    console.log('  [PASS] HTTP endpoints (/ui, /api/status, /api/autostart, /api/config, local title mock)');
    console.log('\nAll AG-Shield self-check tests PASSED successfully!');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('Test failed:', err);
    server.close(() => process.exit(1));
  }
});
