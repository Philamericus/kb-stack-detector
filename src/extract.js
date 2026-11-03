const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseAttrs(tag) {
  const attrs = {};
  const inner = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  for (const m of inner.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function resolve(u, base) {
  if (!u) return null;
  try {
    return new URL(u.trim(), base).href;
  } catch {
    return null;
  }
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
}

export function extractFromHtml(html, baseUrl) {
  const out = {
    scriptSrc: [],
    assets: [],
    meta: {},
    jsonLd: [],
    hreflang: [],
    canonical: null,
    htmlLang: null,
    anchors: [],
  };
  if (!html) return out;

  for (const t of tags(html, 'script')) {
    const a = parseAttrs(t);
    const u = resolve(a.src, baseUrl);
    if (u) out.scriptSrc.push(u);
  }

  for (const t of tags(html, 'link')) {
    const a = parseAttrs(t);
    const u = resolve(a.href, baseUrl);
    if (!u) continue;
    out.assets.push(u);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    if (rel.includes('canonical') && !out.canonical) out.canonical = u;
    if (rel.includes('alternate') && a.hreflang) out.hreflang.push({ lang: a.hreflang, href: u });
  }

  for (const t of tags(html, 'iframe')) {
    const u = resolve(parseAttrs(t).src, baseUrl);
    if (u) out.assets.push(u);
  }

  for (const t of tags(html, 'meta')) {
    const a = parseAttrs(t);
    const key = (a.name || a.property || a['http-equiv'] || a.itemprop || '').toLowerCase();
    if (!key || a.content == null) continue;
    (out.meta[key] ||= []).push(a.content);
  }

  const ldRe = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldRe)) {
    try {
      out.jsonLd.push(JSON.parse(m[1].trim()));
    } catch {
      out.jsonLd.push({ '@invalid': true });
    }
  }

  const htmlTag = html.match(/<html\b[^>]*>/i);
  if (htmlTag) out.htmlLang = parseAttrs(htmlTag[0]).lang || null;

  const seen = new Set();
  for (const t of tags(html, 'a')) {
    const u = resolve(parseAttrs(t).href, baseUrl);
    if (u && !seen.has(u)) {
      seen.add(u);
      out.anchors.push(u);
    }
  }

  out.scriptSrc = [...new Set(out.scriptSrc)];
  out.assets = [...new Set(out.assets)];
  return out;
}

export function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}
