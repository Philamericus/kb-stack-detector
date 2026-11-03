import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRobots, robotsStatusFor, isRealFile, analyzeAiReadiness, findMcp } from '../src/ai-readiness.js';
import { extractFromHtml } from '../src/extract.js';
import { analyzeStructure } from '../src/structure.js';
import { analyze } from '../src/signals.js';
import { resolveCnameChain, isResolvableHost } from '../src/dns.js';

const rules = JSON.parse(readFileSync(new URL('../src/rules.json', import.meta.url), 'utf8'));

const ROBOTS = `
User-agent: *
Disallow: /admin
Allow: /

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Allow: /
Disallow: /private/

User-agent: Google-Extended
Disallow:

Sitemap: https://example.com/sitemap.xml
`;

test('robots.txt: per-bot verdicts and grouping', () => {
  const p = parseRobots(ROBOTS);
  assert.deepEqual(p.sitemaps, ['https://example.com/sitemap.xml']);
  assert.deepEqual(robotsStatusFor(p, 'GPTBot'), { bot: 'GPTBot', status: 'blocked', source: 'specific' });
  assert.equal(robotsStatusFor(p, 'CCBot').status, 'blocked');
  assert.equal(robotsStatusFor(p, 'ClaudeBot').status, 'partial');
  assert.equal(robotsStatusFor(p, 'Google-Extended').status, 'allowed');
  assert.deepEqual(robotsStatusFor(p, 'PerplexityBot'), { bot: 'PerplexityBot', status: 'partial', source: 'wildcard' });
});

test('robots.txt: wildcard full block and allow override', () => {
  assert.equal(robotsStatusFor(parseRobots('User-agent: *\nDisallow: /'), 'ClaudeBot').status, 'blocked');
  assert.equal(robotsStatusFor(parseRobots('User-agent: *\nDisallow: /\nAllow: /$'), 'ClaudeBot').status, 'partial');
  assert.equal(robotsStatusFor(parseRobots(''), 'ClaudeBot').status, 'allowed');
});

test('SPA fallbacks are not mistaken for real files', () => {
  assert.equal(isRealFile({ status: 200, contentType: 'text/html', text: '<!doctype html><html>' }, 'text'), false);
  assert.equal(isRealFile({ status: 200, contentType: 'text/plain', text: '# Project\n> summary' }, 'text'), true);
  assert.equal(isRealFile({ status: 404, text: 'nope' }, 'text'), false);
  assert.equal(isRealFile({ status: 200, text: '<!doctype html>' }, 'xml'), false);
  assert.equal(isRealFile({ status: 200, text: '<?xml version="1.0"?><urlset><url><loc>a</loc></url></urlset>' }, 'xml'), true);
});

test('extractFromHtml pulls scripts, meta, json-ld, hreflang, canonical, lang', () => {
  const html = `<!doctype html><html lang="en-US"><head>
    <meta name="generator" content="Docusaurus v3.5.2">
    <meta property="og:title" content="Hi">
    <link rel="canonical" href="/docs/intro">
    <link rel="alternate" hreflang="fr" href="/fr/docs/intro">
    <link rel="stylesheet" href="https://cdn.example.com/a.css?x=1&amp;y=2">
    <script src="/assets/main.js"></script>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"FAQPage"},{"@type":["TechArticle"]}]}</script>
  </head><body><a href="/docs/a">A</a><a href="https://other.example/x">X</a></body></html>`;
  const x = extractFromHtml(html, 'https://docs.example.com/docs/');
  assert.deepEqual(x.scriptSrc, ['https://docs.example.com/assets/main.js']);
  assert.ok(x.assets.includes('https://cdn.example.com/a.css?x=1&y=2'));
  assert.deepEqual(x.meta.generator, ['Docusaurus v3.5.2']);
  assert.equal(x.canonical, 'https://docs.example.com/docs/intro');
  assert.deepEqual(x.hreflang, [{ lang: 'fr', href: 'https://docs.example.com/fr/docs/intro' }]);
  assert.equal(x.htmlLang, 'en-US');
  assert.equal(x.anchors.length, 2);

  const ai = analyzeAiReadiness({ files: {}, extracted: x, html });
  assert.equal(ai.jsonLd.faq, true);
  assert.equal(ai.jsonLd.article, true);
  assert.equal(ai.openGraph.present, true);
  assert.equal(ai.robots.known, false);
  assert.ok(ai.robots.bots.every((b) => b.status === 'unknown'));
});

test('MCP detection from page and llms.txt', () => {
  assert.equal(findMcp('<a href="https://docs.example.com/mcp">Connect</a>', '').found, true);
  assert.equal(findMcp('', '- [Docs MCP](https://x/mcp): connect your agent').found, true);
  assert.equal(findMcp('<p>nothing here</p>', '').found, false);
});

test('structure: Zendesk-aware counts and locales', () => {
  const links = [
    '/hc/en-us/categories/1-A',
    '/hc/en-us/categories/2-B',
    '/hc/en-us/sections/10-X',
    '/hc/en-us/articles/100-a',
    '/hc/en-us/articles/101-b',
    '/hc/en-us/articles/101-b',
    '/hc/de',
    '/hc/fr',
  ];
  const html = `<html lang="en-US"><body>${links.map((l) => `<a href="${l}">x</a>`).join('')}<div class="language-selector"></div></body></html>`;
  const extracted = extractFromHtml(html, 'https://support.example.com/hc/en-us');
  const s = analyzeStructure({ url: 'https://support.example.com/hc/en-us', html, extracted, platformId: 'zendesk-guide' });
  assert.equal(s.counts.categories, 2);
  assert.equal(s.counts.sections, 1);
  assert.equal(s.counts.articles, 2);
  assert.deepEqual(s.languages.locales, ['de', 'en-us', 'fr']);
  assert.ok(s.languages.switcher);
});

test('structure: versioning from paths', () => {
  const html = '<a href="/v1/docs/a">1</a><a href="/v2/docs/a">2</a><a href="/v2.1/docs/a">3</a>';
  const s = analyzeStructure({ url: 'https://api.example.com/', html, extracted: extractFromHtml(html, 'https://api.example.com/') });
  assert.equal(s.versioning.detected, true);
  assert.deepEqual(s.versioning.versions, ['v1', 'v2', 'v2.1']);
});

test('analyze() end to end on raw collector output', () => {
  const report = analyze(
    {
      url: 'https://help.example.com/hc/en-us',
      html: '<html lang="en"><head><script src="https://static.zdassets.com/hc/assets/x.js"></script></head><body></body></html>',
      headers: { Server: 'cloudflare', 'CF-RAY': 'abc' },
      cname: ['example.zendesk.com'],
      files: { '/robots.txt': { status: 200, contentType: 'text/plain', text: 'User-agent: GPTBot\nDisallow: /' } },
    },
    rules,
  );
  assert.equal(report.platform.id, 'zendesk-guide');
  assert.equal(report.aiReadiness.robots.bots.find((b) => b.bot === 'GPTBot').status, 'blocked');
  assert.deepEqual(report.clues.cname, ['example.zendesk.com']);
  assert.equal(report.clues.server, 'cloudflare');
});

test('DoH CNAME chain follows hops, stops on loops, rejects bad hosts', async () => {
  const zone = { 'a.example.com': 'b.example.net.', 'b.example.net': 'c.cdn.example.org.', 'loop.example': 'loop2.example.', 'loop2.example': 'loop.example.' };
  const calls = [];
  const fakeFetch = async (url) => {
    const name = new URL(url).searchParams.get('name');
    calls.push(name);
    const target = zone[name];
    return { ok: true, json: async () => ({ Answer: target ? [{ name: name + '.', type: 5, data: target }] : [] }) };
  };
  assert.deepEqual(await resolveCnameChain('a.example.com', fakeFetch), ['b.example.net', 'c.cdn.example.org']);
  assert.ok(calls.every((n) => !n.endsWith('.')));
  assert.deepEqual(await resolveCnameChain('loop.example', fakeFetch), ['loop2.example']);
  assert.equal(isResolvableHost('localhost'), false);
  assert.equal(isResolvableHost('10.0.0.1'), false);
  assert.equal(isResolvableHost('help.example.com'), true);
  assert.deepEqual(await resolveCnameChain('bad host', fakeFetch), []);
});
