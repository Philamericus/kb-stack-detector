import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from '../scripts/validate-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('manifest is valid MV3 and every referenced file exists', () => {
  const { errors, files } = validate(root);
  assert.deepEqual(errors, []);
  for (const f of ['popup/popup.html', 'popup/popup.js', 'popup/popup.css', 'src/background.js', 'src/matcher.js', 'src/collectors.js', 'icons/icon128.png']) {
    assert.ok(files.includes(f), `expected ${f} to be reachable`);
  }
});

test('permissions are minimal and click-only', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'scripting']);
  assert.deepEqual(m.host_permissions, ['https://cloudflare-dns.com/dns-query*']);
  assert.equal(m.content_scripts, undefined);
  assert.equal(m.background.type, 'module');
});

test('icons are real PNGs of the declared size', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const [size, path] of Object.entries(m.icons)) {
    const buf = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.equal(buf.readUInt32BE(16), Number(size));
    assert.equal(buf.readUInt32BE(20), Number(size));
  }
});
