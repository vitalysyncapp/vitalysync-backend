import assert from 'node:assert/strict';
import test from 'node:test';

import { checkReadiness } from '../src/services/readiness.service.js';

test('readiness checks the database with a bounded query', async () => {
  let queryConfig;
  const ready = await checkReadiness({
    database: {
      async query(config) {
        queryConfig = config;
        return { rows: [{ '?column?': 1 }] };
      },
    },
    timeoutMs: 2500,
  });

  assert.equal(ready, true);
  assert.deepEqual(queryConfig, {
    text: 'SELECT 1',
    query_timeout: 2500,
  });
});

test('readiness reports unavailable without exposing database errors', async () => {
  const ready = await checkReadiness({
    database: {
      async query() {
        throw new Error('sensitive database detail');
      },
    },
  });

  assert.equal(ready, false);
});
