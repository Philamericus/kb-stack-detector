import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPage } from '../src/collectors.js';

test('collectPage never sends cookies and reads only cookie names', async () => {
  const calls = [];
  const origin = 'https://docs.example.com';
  globalThis.location = new URL(`${origin}/start`);
  globalThis.document = {
    cookie: 'session=secret-value; theme=dark',
    scripts: [],
    documentElement: { outerHTML: '<html></html>' },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(opts.method === 'HEAD' ? null : 'ok');
  };
  try {
    const out = await collectPage([], ['/robots.txt', '/llms.txt'], { maxHtml: 1000, maxFile: 1000, timeoutMs: 1000 });
    assert.equal(calls.length, 3);
    for (const { url, opts } of calls) assert.equal(opts.credentials, 'omit', `${url} must omit credentials`);
    assert.deepEqual(out.cookies, ['session', 'theme']);
    assert.ok(!JSON.stringify(out).includes('secret-value'));
  } finally {
    delete globalThis.location;
    delete globalThis.document;
    delete globalThis.fetch;
  }
});
