const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, PRIMARY_URL, FALLBACK_URL } = require('../src/app');

function makeResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

test('uses fallback and increments metric when failPrimary is injected', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);

    if (url === FALLBACK_URL) {
      return makeResponse({ todos: [{ id: 101, todo: 'fallback todo' }] });
    }

    return makeResponse([], 500);
  };

  const logs = [];
  const logger = {
    error: (message) => logs.push(message)
  };

  const app = createApp({ fetchImpl, logger });
  const { server, baseUrl } = await startApp(app);

  try {
    const response = await fetch(`${baseUrl}/todos?failPrimary=true`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.source, 'fallback');
    assert.equal(body.todos.length, 1);
    assert.deepEqual(fetchCalls, [FALLBACK_URL]);
    assert.equal(logs.length, 1);

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    const metricsText = await metricsResponse.text();

    assert.match(metricsText, /fallback_trigger_total 1/);
  } finally {
    server.close();
  }
});

test('serves primary data and leaves fallback counter at zero', async () => {
  const fetchImpl = async (url) => {
    if (url === PRIMARY_URL) {
      return makeResponse([{ id: 1, title: 'primary todo' }]);
    }

    return makeResponse([], 500);
  };

  const app = createApp({ fetchImpl });
  const { server, baseUrl } = await startApp(app);

  try {
    const response = await fetch(`${baseUrl}/todos`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.source, 'primary');
    assert.equal(body.todos.length, 1);

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    const metricsText = await metricsResponse.text();

    assert.match(metricsText, /fallback_trigger_total 0/);
  } finally {
    server.close();
  }
});
