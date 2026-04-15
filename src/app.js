const express = require('express');
const { Counter, Registry, collectDefaultMetrics } = require('prom-client');

const PRIMARY_URL = 'https://jsonplaceholder.typicode.com/todos';
const FALLBACK_URL = 'https://dummyjson.com/todos';

function isFailureInjected(value) {
  if (value == null) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }

  return response.json();
}

function normalizeTodos(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.todos)) {
    return payload.todos;
  }

  return [];
}

function createApp({ fetchImpl = fetch, logger = console } = {}) {
  const app = express();
  const registry = new Registry();

  collectDefaultMetrics({ register: registry });

  const fallbackTriggerCounter = new Counter({
    name: 'fallback_trigger_total',
    help: 'Number of times the fallback API was used',
    registers: [registry]
  });

  app.get('/todos', async (req, res) => {
    try {
      if (isFailureInjected(req.query.failPrimary)) {
        throw new Error('Primary API failure intentionally injected via failPrimary query param');
      }

      const primaryPayload = await fetchJson(fetchImpl, PRIMARY_URL);

      return res.json({
        source: 'primary',
        todos: normalizeTodos(primaryPayload)
      });
    } catch (primaryError) {
      fallbackTriggerCounter.inc();

      logger.error(
        JSON.stringify({
          event: 'fallback_triggered',
          timestamp: new Date().toISOString(),
          route: '/todos',
          primaryUrl: PRIMARY_URL,
          fallbackUrl: FALLBACK_URL,
          reason: primaryError.message
        })
      );

      try {
        const fallbackPayload = await fetchJson(fetchImpl, FALLBACK_URL);

        return res.json({
          source: 'fallback',
          todos: normalizeTodos(fallbackPayload)
        });
      } catch (fallbackError) {
        return res.status(502).json({
          error: 'Both primary and fallback providers failed',
          details: {
            primary: primaryError.message,
            fallback: fallbackError.message
          }
        });
      }
    }
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.locals.metrics = { registry, fallbackTriggerCounter };

  return app;
}

module.exports = {
  createApp,
  isFailureInjected,
  PRIMARY_URL,
  FALLBACK_URL
};
