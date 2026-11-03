import { collectPage, collectMain } from '../src/collectors.js';
import { collectGlobals, collectSelectors } from '../src/matcher.js';
import { analyze, MAX_HTML } from '../src/signals.js';
import { WELL_KNOWN_FILES } from '../src/ai-readiness.js';

const LIMITS = { maxHtml: MAX_HTML, maxFile: 1_000_000, timeoutMs: 6000 };
const BLOCKED_HOSTS = [/^chromewebstore\.google\.com$/, /^chrome\.google\.com$/, /^microsoftedge\.microsoft\.com$/];
const EVIDENCE_PRIORITY = ['cname', 'headers', 'meta', 'jsGlobals', 'scriptSrc'];

const app = document.getElementById('app');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const pill = (confidence) => h('span', { class: `pill ${confidence}`, text: confidence });

function showState(icon, title, sub) {
  app.replaceChildren(
    h('div', { class: 'state' }, h('div', { class: 'state-icon', 'aria-hidden': 'true', text: icon }), h('p', { class: 'state-title', text: title }), sub && h('p', { class: 'state-sub', text: sub })),
  );
}

function setStep(text) {
  const el = document.getElementById('loading-step');
  if (el) el.textContent = text;
}

function injectable(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !BLOCKED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

function bestEvidence(result) {
  for (const type of EVIDENCE_PRIORITY) {
    const hit = result.evidence.find((e) => e.startsWith(type + ':'));
    if (hit) return hit;
  }
  return result.evidence[0];
}

function techItem(r) {
  return h(
    'details',
    { class: 'tech' },
    h('summary', {}, h('span', { class: 'name', text: r.name, title: r.name }), pill(r.confidence)),
    h(
      'ul',
      { class: 'evidence' },
      r.evidence.map((e) => h('li', { text: e })),
      r.website && h('li', { class: 'site' }, h('a', { href: r.website, target: '_blank', rel: 'noopener noreferrer', text: new URL(r.website).hostname })),
    ),
  );
}

function hero(report) {
  const p = report.platform;
  const otherKb = report.results.filter((r) => r.category === 'kb' && r !== p);
  return h(
    'header',
    { class: 'hero' },
    h('p', { class: 'host', title: report.url, text: report.host }),
    h('p', { class: 'platform-label', text: 'Knowledge base platform' }),
    p
      ? h('p', { class: 'platform' }, h('span', { text: p.name }), pill(p.confidence))
      : h('p', { class: 'platform unknown', text: 'Unknown platform' }),
    p
      ? h('p', { class: 'why', text: bestEvidence(p) })
      : h('p', { class: 'why', text: 'No rule matched. Raw clues below can help you write one.' }),
    otherKb.length > 0 && h('p', { class: 'also', text: `Also: ${otherKb.map((r) => r.name).join(', ')}` }),
  );
}

function layerSection(title, list) {
  return h(
    'section',
    {},
    h('h2', {}, title, list.length > 0 && h('span', { class: 'count', text: String(list.length) })),
    list.length ? list.map(techItem) : h('p', { class: 'none', text: 'None detected' }),
  );
}

function check(state, label, detail) {
  const glyph = { yes: '✓', no: '✗', maybe: '?' }[state];
  return [
    h('span', { class: `mark ${state}`, text: glyph, 'aria-label': state === 'yes' ? 'yes' : state === 'no' ? 'no' : 'unknown' }),
    h('span', { text: label }),
    h('span', { class: 'check-detail', text: detail || '', title: detail || '' }),
  ];
}

const tri = (known, present) => (!known ? 'maybe' : present ? 'yes' : 'no');

function aiSection(a) {
  const ld = a.jsonLd;
  const declared = a.robots.sitemaps.map((u) => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  });
  const sitemapDetail = a.sitemap.present
    ? `${a.sitemap.kind === 'index' ? 'index, ' : ''}${a.sitemap.count}${a.sitemap.truncated ? '+' : ''} ${a.sitemap.kind === 'index' ? 'sitemaps' : 'URLs'}`
    : declared.length
      ? `robots.txt declares ${declared[0]}${declared.length > 1 ? ` +${declared.length - 1}` : ''}`
      : '';
  const otherTypes = ld.types.filter((t) => !['FAQPage', 'HowTo', 'BreadcrumbList'].includes(t));
  const botStatus = {
    allowed: ['yes', '✓'],
    blocked: ['no', '✗'],
    partial: ['partial', '◐'],
    unknown: ['maybe', '?'],
  };
  return h(
    'section',
    {},
    h('h2', { text: 'AI-readiness' }),
    h(
      'div',
      { class: 'checks' },
      check(tri(a.robots.known, a.robots.present), 'robots.txt'),
      check(tri(a.llmsTxt.known || !!a.llmsTxt.advertised, a.llmsTxt.present || !!a.llmsTxt.advertised), 'llms.txt', !a.llmsTxt.present && a.llmsTxt.advertised ? `advertised at ${a.llmsTxt.advertised}` : ''),
      check(tri(a.llmsFullTxt.known, a.llmsFullTxt.present), 'llms-full.txt'),
      check(!a.sitemap.present && a.robots.sitemaps.length ? 'maybe' : tri(a.sitemap.known, a.sitemap.present), 'sitemap.xml', sitemapDetail),
      check(ld.types.length ? 'yes' : 'no', 'JSON-LD', otherTypes.length ? otherTypes.join(', ') : ''),
      check(ld.faq ? 'yes' : 'no', 'FAQPage schema'),
      check(ld.article ? 'yes' : 'no', 'Article schema'),
      check(ld.howTo ? 'yes' : 'no', 'HowTo schema'),
      check(ld.breadcrumb ? 'yes' : 'no', 'BreadcrumbList schema'),
      check(a.openGraph.present ? 'yes' : 'no', 'OpenGraph tags', a.openGraph.present ? `${a.openGraph.keys.length} tags` : ''),
      check(a.canonical ? 'yes' : 'no', 'Canonical URL', a.canonical ? new URL(a.canonical).pathname : ''),
      check(a.hreflang.length ? 'yes' : 'no', 'hreflang', a.hreflang.length ? `${a.hreflang.length} locales` : ''),
      check(a.mcp.found ? 'yes' : 'maybe', 'MCP server mentioned', a.mcp.found ? a.mcp.evidence : 'none seen'),
    ),
    h(
      'p',
      { class: 'subhead' },
      h('span', { text: a.robots.present ? 'AI crawlers in robots.txt' : a.robots.known ? 'AI crawlers (no robots.txt, allowed by default)' : 'AI crawlers (robots.txt unreachable)' }),
      h('span', { class: 'legend', text: '✓ allowed  ◐ partial  ✗ blocked' }),
    ),
    h(
      'div',
      { class: 'bots' },
      a.robots.bots.map((b) => {
        const [cls, glyph] = botStatus[b.status];
        return h(
          'div',
          { class: 'bot', title: `${b.bot}: ${b.status}${b.source === 'specific' ? ' (named rule)' : b.source === 'wildcard' ? ' (via User-agent: *)' : ''}` },
          h('span', { class: `mark ${cls}`, text: glyph }),
          h('span', { class: 'bot-name', text: b.bot }),
          b.source === 'specific' && h('span', { class: 'src', text: 'named' }),
        );
      }),
    ),
  );
}

function kv(rows) {
  return h(
    'dl',
    { class: 'kv' },
    rows.filter(Boolean).map(([k, v, mono]) => [h('dt', { text: k }), h('dd', { class: mono ? 'mono' : null }, v == null || v === '' ? h('span', { class: 'muted', text: '—' }) : String(v))]),
  );
}

function structureSection(s) {
  const langs = [s.languages.htmlLang && `html lang=${s.languages.htmlLang}`, s.languages.locales.length && `${s.languages.locales.length} locales: ${s.languages.locales.slice(0, 8).join(', ')}${s.languages.locales.length > 8 ? '…' : ''}`, s.languages.switcher && 'switcher present']
    .filter(Boolean)
    .join(' · ');
  const versioning = s.versioning.detected ? [s.versioning.versions.join(', '), s.versioning.selector && 'selector present'].filter(Boolean).join(' · ') || 'yes' : 'none seen';
  return h(
    'section',
    {},
    h('h2', {}, 'Content structure', h('span', { class: 'count', text: 'this page' })),
    kv([
      ['Languages', langs],
      ['Categories', s.counts.categories],
      ['Sections', s.counts.sections],
      ['Articles linked', s.counts.articles],
      ['Internal pages', s.internalPages],
      ['Versioning', versioning],
    ]),
  );
}

function cluesSection(c, open) {
  return h(
    'section',
    {},
    h(
      'details',
      { class: 'clues', open },
      h('summary', {}, h('h2', { text: 'Raw clues' })),
      kv([
        ['Generator', c.generator.join(', '), true],
        ['CNAME chain', c.cname.length ? c.cname.join(' → ') : 'none (A/AAAA record)', true],
        ['Server', c.server, true],
        ['X-Powered-By', c.poweredBy, true],
        ['Via', c.via, true],
        ['Script hosts', c.scriptHosts.map((s) => `${s.host} (${s.count})`).join(', '), true],
        ['Headers seen', c.headerNames.join(', '), true],
      ]),
    ),
  );
}

function render(report, rules) {
  const byCat = {};
  for (const r of report.results) (byCat[r.category] ||= []).push(r);
  const sections = Object.entries(rules.categories)
    .filter(([id]) => id !== 'kb')
    .map(([id, cat]) => layerSection(cat.name, byCat[id] || []));
  const parts = [
    hero(report),
    report.partial.length > 0 && h('p', { class: 'notice', text: `Partial scan: ${report.partial.join('; ')}` }),
    ...sections,
    aiSection(report.aiReadiness),
    structureSection(report.structure),
    cluesSection(report.clues, !report.platform),
    h('footer', {}, h('span', { text: 'Passive scan. Nothing stored.' }), h('button', { type: 'button', onclick: () => run(), text: 'Rescan' })),
  ];
  app.replaceChildren(...parts.filter(Boolean));
}

async function run() {
  app.replaceChildren(
    h('div', { class: 'state loading', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'state-title', text: 'Scanning page…' }), h('p', { class: 'state-sub', id: 'loading-step', text: 'Reading markup, headers, and DNS' })),
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !injectable(tab.url)) {
    showState('⊘', "Can't scan this page", 'Browser, extension, store, and local file pages are off-limits to extensions. Open a website and try again.');
    return;
  }

  const rules = await (await fetch(chrome.runtime.getURL('src/rules.json'))).json();
  const host = new URL(tab.url).hostname;
  const target = { tabId: tab.id };

  setStep('Reading page, robots.txt, llms.txt, sitemap.xml…');
  const [page, main, dns] = await Promise.allSettled([
    chrome.scripting.executeScript({ target, func: collectPage, args: [collectSelectors(rules), WELL_KNOWN_FILES, LIMITS] }),
    chrome.scripting.executeScript({ target, world: 'MAIN', func: collectMain, args: [collectGlobals(rules)] }),
    chrome.runtime.sendMessage({ type: 'resolve-cname', host }),
  ]);

  const pageData = page.status === 'fulfilled' ? page.value?.[0]?.result : null;
  if (!pageData) {
    const reason = page.status === 'rejected' ? String(page.reason?.message || page.reason) : 'no result';
    showState('⊘', "Can't read this page", `Chrome blocked script access (${reason}). PDFs, error pages, and some protected sites can't be scanned.`);
    return;
  }

  const partial = [];
  const mainData = main.status === 'fulfilled' ? main.value?.[0]?.result : null;
  if (!mainData) partial.push('JS globals unavailable');
  const chain = dns.status === 'fulfilled' ? dns.value?.chain || [] : [];
  if (dns.status === 'rejected' || dns.value?.error) partial.push('DNS lookup failed');

  setStep('Matching rules…');
  const report = analyze(
    {
      ...pageData,
      jsGlobals: mainData?.jsGlobals || [],
      resourceHosts: mainData?.resourceHosts || [],
      cname: chain,
      partial,
    },
    rules,
  );
  render(report, rules);
}

run().catch((err) => showState('!', 'Scan failed', String(err?.message || err)));
