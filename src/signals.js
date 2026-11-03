import { extractFromHtml, hostOf } from './extract.js';
import { match, primaryPlatform } from './matcher.js';
import { analyzeAiReadiness } from './ai-readiness.js';
import { analyzeStructure } from './structure.js';

export const MAX_HTML = 3_000_000;

const uniq = (a) => [...new Set(a.filter(Boolean))];

export function buildSignals(raw) {
  const url = raw.url;
  const host = hostOf(url);
  const html = (raw.html || '').slice(0, MAX_HTML);
  const extracted = extractFromHtml(html, url);
  const scriptSrc = uniq([...(raw.scripts || []), ...extracted.scriptSrc]);
  const assets = uniq([...(raw.assets || []), ...extracted.assets]);
  const assetHosts = [...scriptSrc, ...assets].map(hostOf);
  const headers = {};
  for (const [k, v] of Object.entries(raw.headers || {})) headers[k.toLowerCase()] = v;
  return {
    signals: {
      url,
      host,
      html,
      scriptSrc,
      assets,
      meta: extracted.meta,
      headers,
      cookies: uniq(raw.cookies || []),
      jsGlobals: uniq(raw.jsGlobals || []),
      resourceHosts: uniq([...(raw.resourceHosts || []), ...assetHosts]),
      cname: raw.cname || [],
      dom: raw.dom || [],
    },
    extracted,
  };
}

function rawClues(signals) {
  const counts = new Map();
  const site = signals.host?.split('.').slice(-2).join('.');
  for (const u of signals.scriptSrc) {
    const h = hostOf(u);
    if (!h || h === signals.host || h.endsWith('.' + site) || h === site) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  const pick = (k) => signals.headers[k] || null;
  return {
    generator: signals.meta.generator || [],
    cname: signals.cname,
    server: pick('server'),
    poweredBy: pick('x-powered-by'),
    via: pick('via'),
    scriptHosts: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([h, n]) => ({ host: h, count: n })),
    headerNames: Object.keys(signals.headers).sort(),
  };
}

export function analyze(raw, rules) {
  const { signals, extracted } = buildSignals(raw);
  const results = match(signals, rules);
  const platform = primaryPlatform(results);
  return {
    host: signals.host,
    url: signals.url,
    results,
    platform,
    aiReadiness: analyzeAiReadiness({ files: raw.files || {}, extracted, html: signals.html, headers: signals.headers }),
    structure: analyzeStructure({ url: signals.url, html: signals.html, extracted, platformId: platform?.id, headers: signals.headers }),
    clues: rawClues(signals),
    partial: raw.partial || [],
  };
}
