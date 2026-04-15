import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, PRIMARY_URL, FALLBACK_URL } from '../src/app';

function makeResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

async function startApp(app: ReturnType<typeof createApp>) {
  return await new Promise<{ server: ReturnType<typeof app.listen>; baseUrl: string }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const typedAddress = address as { port: number };

      resolve({
        server,
        baseUrl: `http://127.0.0.1:${typedAddress.port}`
      });
    });

    server.on('error', (error) => {
      reject(error);
    });
  });
}

test('uses fallback and increments metric when failPrimary is injected', async () => {
  const fetchCalls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    const normalizedUrl = String(url);
    fetchCalls.push(normalizedUrl);

    if (normalizedUrl === FALLBACK_URL) {
      return makeResponse({ todos: [{ id: 101, todo: 'fallback todo' }] });
    }

    return makeResponse({ error: 'primary failed' }, 500);
  };

  const logs: string[] = [];
  const logger = {
    error: (message: string) => logs.push(message)
  };

  const app = createApp({ fetchImpl, logger });
  const { server, baseUrl } = await startApp(app);

  try {
    const response = await fetch(`${baseUrl}/todos?failPrimary=true`);
    const body = (await response.json()) as { source: string; todos: unknown[] };

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
  const fetchImpl: typeof fetch = async (url) => {
    const normalizedUrl = String(url);

    if (normalizedUrl === PRIMARY_URL) {
      return makeResponse([{ id: 1, title: 'primary todo' }]);
    }

    return makeResponse({ error: 'unexpected fallback call' }, 500);
  };

  const app = createApp({ fetchImpl });
  const { server, baseUrl } = await startApp(app);

  try {
    const response = await fetch(`${baseUrl}/todos`);
    const body = (await response.json()) as { source: string; todos: unknown[] };

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
