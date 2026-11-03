// Both functions are serialized by chrome.scripting.executeScript, so they must stay self-contained.

export async function collectPage(selectors, files, limits) {
  const { maxHtml, maxFile, timeoutMs } = limits;

  const withTimeout = (p, ms) =>
    Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

  async function readCapped(res, cap) {
    if (!res.body) return { text: '', truncated: false };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= cap) {
        truncated = true;
        reader.cancel().catch(() => {});
        break;
      }
    }
    return { text: text.slice(0, cap), truncated };
  }

  async function fetchFile(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(new URL(path, location.origin).href, {
        credentials: 'omit',
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const sameOrigin = new URL(res.url || location.origin).origin === location.origin;
      if (!sameOrigin) return { status: res.status, contentType: '', text: '', redirectedOffsite: true };
      const { text, truncated } = await readCapped(res, maxFile);
      return { status: res.status, contentType: res.headers.get('content-type') || '', text, truncated };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function headers() {
    const read = (res) => {
      const out = {};
      res.headers.forEach((v, k) => {
        out[k.toLowerCase()] = v;
      });
      return out;
    };
    try {
      const res = await withTimeout(fetch(location.href, { method: 'HEAD', cache: 'force-cache', credentials: 'omit' }), timeoutMs);
      return read(res);
    } catch {
      return {};
    }
  }

  const abs = (list) => list.filter(Boolean);
  const dom = [];
  for (const sel of selectors) {
    try {
      if (document.querySelector(sel)) dom.push(sel);
    } catch {}
  }

  const cookies = document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter(Boolean);

  const [hdrs, ...fileResults] = await Promise.all([headers(), ...files.map(fetchFile)]);

  const html = document.documentElement ? document.documentElement.outerHTML : '';
  return {
    url: location.href,
    html: html.slice(0, maxHtml),
    scripts: abs([...document.scripts].map((s) => s.src)),
    assets: abs([
      ...[...document.querySelectorAll('link[href]')].map((l) => l.href),
      ...[...document.querySelectorAll('iframe[src]')].map((f) => f.src),
    ]),
    dom,
    cookies,
    headers: hdrs,
    files: Object.fromEntries(files.map((p, i) => [p, fileResults[i]])),
  };
}

export function collectMain(names) {
  const present = [];
  for (const name of names) {
    if (name.startsWith('@')) continue;
    try {
      let obj = window;
      let ok = true;
      for (const part of name.split('.')) {
        if (obj == null || !(part in Object(obj))) {
          ok = false;
          break;
        }
        obj = obj[part];
      }
      if (ok && obj !== undefined && !(obj instanceof Element) && !(obj instanceof HTMLCollection)) present.push(name);
    } catch {}
  }

  const sample = document.querySelectorAll('body, body *');
  const limit = Math.min(sample.length, 400);
  let react = false;
  let vue = !!window.__VUE__;
  let svelte = false;
  for (let i = 0; i < limit && !(react && vue && svelte); i++) {
    const el = sample[i];
    if (!react && (el._reactRootContainer || Object.keys(el).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer')))) react = true;
    if (!vue && (el.__vue_app__ || el.__vue__ || el.__vueParentComponent)) vue = true;
    if (!svelte && Object.keys(el).some((k) => k.startsWith('__svelte'))) svelte = true;
  }
  if (react) present.push('@react');
  if (vue) present.push('@vue');
  if (svelte) present.push('@svelte');

  const hosts = new Set();
  try {
    for (const e of performance.getEntriesByType('resource')) {
      try {
        hosts.add(new URL(e.name).hostname);
      } catch {}
    }
  } catch {}

  return { jsGlobals: present, resourceHosts: [...hosts] };
}
