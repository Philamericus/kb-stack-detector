export const AI_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'anthropic-ai',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
  'Applebot-Extended',
  'meta-externalagent',
  'Bytespider',
];

export const WELL_KNOWN_FILES = ['/robots.txt', '/llms.txt', '/llms-full.txt', '/sitemap.xml'];

const looksLikeHtml = (text) => /^\s*(<!doctype html|<html|<head|<body)/i.test(text || '');

export function isRealFile(file, kind) {
  if (!file || file.status !== 200 || !file.text) return false;
  const ct = (file.contentType || '').toLowerCase();
  if (kind === 'xml') return /<(urlset|sitemapindex)\b/i.test(file.text);
  if (ct.includes('text/html') || looksLikeHtml(file.text)) return false;
  return true;
}

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of (text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (current) current.rules.push({ type: field, path: value });
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function pathMatches(rulePath, path) {
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

function verdict(rules, path) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue;
    if (!pathMatches(r.path, path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow')) best = { len, type: r.type };
  }
  return best ? best.type : 'allow';
}

export function robotsStatusFor(parsed, bot) {
  const ua = bot.toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.includes(ua));
  const wildcard = parsed.groups.filter((g) => g.agents.includes('*'));
  const groups = specific.length ? specific : wildcard;
  const source = specific.length ? 'specific' : wildcard.length ? 'wildcard' : 'none';
  if (!groups.length) return { bot, status: 'allowed', source };
  const rules = groups.flatMap((g) => g.rules);
  if (verdict(rules, '/') === 'disallow') return { bot, status: 'blocked', source };
  const partial = rules.some((r) => r.type === 'disallow' && r.path !== '');
  return { bot, status: partial ? 'partial' : 'allowed', source };
}

function collectTypes(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out);
  } else if (node && typeof node === 'object') {
    const t = node['@type'];
    for (const v of [].concat(t || [])) if (typeof v === 'string') out.add(v);
    for (const [k, v] of Object.entries(node)) if (k !== '@type' && typeof v === 'object') collectTypes(v, out);
  }
}

const ARTICLE_TYPES = ['Article', 'TechArticle', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'];

const MCP_PATTERNS = [
  /\bMCP server\b/i,
  /\bModel Context Protocol\b/i,
  /href=["'][^"']*(?:\/mcp(?:[/?#"']|$)|\.well-known\/mcp)/i,
  /<link\b[^>]*rel=["'][^"']*\bmcp\b/i,
];

export function findMcp(html, llmsText) {
  for (const re of MCP_PATTERNS) {
    const m = re.exec(html || '');
    if (m) return { found: true, evidence: `page: ${m[0].slice(0, 80)}` };
  }
  const m = /\bMCP\b[^\n]{0,60}/.exec(llmsText || '');
  if (m) return { found: true, evidence: `llms.txt: ${m[0].trim()}` };
  return { found: false, evidence: null };
}

export function analyzeAiReadiness({ files = {}, extracted, html, headers = {} }) {
  const robotsFile = files['/robots.txt'];
  const robotsPresent = isRealFile(robotsFile, 'text');
  const parsed = robotsPresent ? parseRobots(robotsFile.text) : { groups: [], sitemaps: [] };
  const robotsKnown = !!robotsFile && !robotsFile.error;

  const sitemapFile = files['/sitemap.xml'];
  const sitemapPresent = isRealFile(sitemapFile, 'xml');
  let sitemap = { present: sitemapPresent, known: !!sitemapFile && !sitemapFile.error, kind: null, count: 0, truncated: !!sitemapFile?.truncated };
  if (sitemapPresent) {
    const isIndex = /<sitemapindex\b/i.test(sitemapFile.text);
    sitemap.kind = isIndex ? 'index' : 'urlset';
    sitemap.count = (sitemapFile.text.match(/<loc>/gi) || []).length;
  }

  const llms = files['/llms.txt'];
  const llmsFull = files['/llms-full.txt'];
  const types = new Set();
  collectTypes(extracted.jsonLd, types);
  const typeList = [...types].sort();

  const og = Object.keys(extracted.meta).filter((k) => k.startsWith('og:'));

  return {
    robots: {
      present: robotsPresent,
      known: robotsKnown,
      sitemaps: parsed.sitemaps,
      bots: AI_BOTS.map((b) => (robotsPresent ? robotsStatusFor(parsed, b) : { bot: b, status: robotsKnown ? 'allowed' : 'unknown', source: 'none' })),
    },
    llmsTxt: { present: isRealFile(llms, 'text'), known: !!llms && !llms.error, advertised: headers['x-llms-txt'] || null },
    llmsFullTxt: { present: isRealFile(llmsFull, 'text'), known: !!llmsFull && !llmsFull.error },
    sitemap,
    jsonLd: {
      types: typeList,
      faq: types.has('FAQPage'),
      article: ARTICLE_TYPES.some((t) => types.has(t)),
      howTo: types.has('HowTo'),
      breadcrumb: types.has('BreadcrumbList'),
    },
    openGraph: { present: og.length > 0, keys: og },
    canonical: extracted.canonical,
    hreflang: [...new Set(extracted.hreflang.map((h) => h.lang))],
    mcp: findMcp(html, isRealFile(llms, 'text') ? llms.text : ''),
  };
}
