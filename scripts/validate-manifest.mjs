#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PERMISSIONS = ['webRequest', 'webRequestBlocking', 'tabs', 'history', 'cookies', 'storage', '<all_urls>'];

function moduleImports(file) {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => resolve(dirname(file), m[1]));
}

function htmlRefs(file) {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:src|href)\s*=\s*["']([^"':]+)["']/g)].map((m) => resolve(dirname(file), m[1]));
}

export function validate(root) {
  const errors = [];
  const checked = new Set();
  const manifestPath = join(root, 'manifest.json');
  let m;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { errors: [`manifest.json is not valid JSON: ${e.message}`], files: [] };
  }

  if (m.manifest_version !== 3) errors.push('manifest_version must be 3');
  for (const key of ['name', 'version', 'description']) if (!m[key]) errors.push(`missing "${key}"`);
  if (m.version && !/^\d+(\.\d+){0,3}$/.test(m.version)) errors.push(`invalid version "${m.version}"`);
  if (m.description && m.description.length > 132) errors.push('description exceeds 132 characters');
  if (m.background?.scripts || m.background?.page) errors.push('MV3 requires background.service_worker');
  if (m.browser_action || m.page_action) errors.push('MV3 uses "action", not browser_action/page_action');
  if (m.content_scripts) errors.push('content_scripts present: the extension must only run on click');
  for (const p of [...(m.permissions || []), ...(m.host_permissions || [])]) {
    if (FORBIDDEN_PERMISSIONS.includes(p)) errors.push(`forbidden permission "${p}"`);
  }
  for (const hp of m.host_permissions || []) {
    if (!hp.startsWith('https://cloudflare-dns.com/')) errors.push(`unexpected host permission "${hp}"`);
  }

  const queue = [];
  const add = (p) => queue.push(resolve(root, p));
  Object.values(m.icons || {}).forEach(add);
  Object.values(m.action?.default_icon || {}).forEach(add);
  if (m.action?.default_popup) add(m.action.default_popup);
  if (m.background?.service_worker) add(m.background.service_worker);

  while (queue.length) {
    const f = queue.shift();
    if (checked.has(f)) continue;
    checked.add(f);
    if (!existsSync(f)) {
      errors.push(`missing file: ${relative(root, f)}`);
      continue;
    }
    if (f.endsWith('.html')) queue.push(...htmlRefs(f));
    if (f.endsWith('.js') || f.endsWith('.mjs')) queue.push(...moduleImports(f));
  }

  const popupJs = join(root, 'popup/popup.js');
  if (existsSync(popupJs) && readFileSync(popupJs, 'utf8').includes("'src/rules.json'")) {
    if (!existsSync(join(root, 'src/rules.json'))) errors.push('missing file: src/rules.json');
    else checked.add(join(root, 'src/rules.json'));
  }

  return { errors, files: [...checked].map((f) => relative(root, f)).sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { errors, files } = validate(root);
  console.log(`checked ${files.length} referenced files`);
  if (errors.length) {
    for (const e of errors) console.error('  ✗ ' + e);
    process.exit(1);
  }
  console.log('manifest OK (MV3, all referenced files present)');
}
