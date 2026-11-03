import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { match, primaryPlatform, confidenceFor, compileTech, collectGlobals, collectSelectors, SIGNAL_TYPES } from '../src/matcher.js';
import * as fx from './fixtures/signals.js';

const rules = JSON.parse(readFileSync(new URL('../src/rules.json', import.meta.url), 'utf8'));
const ids = (results) => results.map((r) => r.id);
const byId = (results, id) => results.find((r) => r.id === id);

test('confidence thresholds', () => {
  assert.equal(confidenceFor(150), 'high');
  assert.equal(confidenceFor(100), 'high');
  assert.equal(confidenceFor(60), 'medium');
  assert.equal(confidenceFor(40), 'low');
});

test('zendesk on a custom domain: platform, widget, ticket form, hosting', () => {
  const r = match(fx.zendeskCustomDomain, rules);
  const p = primaryPlatform(r);
  assert.equal(p.id, 'zendesk-guide');
  assert.equal(p.confidence, 'high');
  assert.ok(p.evidence.some((e) => e.startsWith('cname: support.example.com → example.zendesk.com')));
  assert.ok(p.evidence.some((e) => e === 'headers: zendesk-service: help-center'));
  assert.ok(p.evidence.some((e) => e === 'jsGlobals: window.HelpCenter'));
  for (const id of ['zendesk-widget', 'ticket-form', 'cloudflare']) assert.ok(ids(r).includes(id), id);
});

test('CNAME alone is enough for a high-confidence platform', () => {
  const p = primaryPlatform(match(fx.cnameOnly, rules));
  assert.equal(p.id, 'zendesk-guide');
  assert.equal(p.confidence, 'high');
});

test('docusaurus implies react and docsearch implies algolia', () => {
  const r = match(fx.docusaurus, rules);
  assert.equal(primaryPlatform(r).id, 'docusaurus');
  assert.ok(byId(r, 'react').evidence.includes('implied by Docusaurus'));
  const algolia = byId(r, 'algolia');
  assert.ok(algolia.evidence.some((e) => e.startsWith('resourceHosts:')));
  assert.ok(algolia.evidence.includes('implied by Algolia DocSearch'));
  assert.ok(ids(r).includes('netlify'));
});

test('implied-only results never become the primary platform', () => {
  const r = match(fx.signal({ url: 'https://x.example/', host: 'x.example', html: '<div class="hs_cos_wrapper"></div><div class="hs-kb-home-list"></div>' }), rules);
  assert.equal(primaryPlatform(r).id, 'hubspot-kb');
  assert.equal(byId(r, 'hubspot-cms').score, 30);
});

test('excludes: Freshservice overrides Freshdesk when both match', () => {
  const r = match(fx.freshserviceOnFreshdeskInfra, rules);
  assert.equal(primaryPlatform(r).id, 'freshservice');
  assert.ok(!ids(r).includes('freshdesk'));
  assert.ok(byId(r, 'freshservice').evidence.some((e) => e.startsWith('overrides Freshdesk')));
});

test('unknown site yields no platform', () => {
  assert.equal(primaryPlatform(match(fx.unknownSite, rules)), null);
});

test('prose mentioning vendors does not trigger platform rules', () => {
  const r = match(fx.contentMentionsCompetitors, rules);
  assert.equal(r.filter((x) => x.category === 'kb').length, 0);
});

test('duplicate hits on the same value score once', () => {
  const s = fx.signal({ url: 'https://x.example/', host: 'x.example', scriptSrc: ['https://cdn.jsdelivr.net/npm/algoliasearch@4/dist/algoliasearch-lite.umd.js'] });
  const a = byId(match(s, rules), 'algolia');
  assert.equal(a.evidence.length, 1);
  assert.equal(a.score, 60);
});

test('headers, meta, and cookies match by key with optional value regex', () => {
  const s = fx.signal({
    url: 'https://x.example/',
    host: 'x.example',
    headers: { server: 'GitHub.com' },
    meta: { generator: ['mkdocs-1.6.1, mkdocs-material-9.5.0'] },
    cookies: ['_hjSessionUser_123', '_ga'],
  });
  const r = match(s, rules);
  assert.ok(ids(r).includes('github-pages'));
  assert.equal(primaryPlatform(r).id, 'mkdocs-material');
  assert.ok(ids(r).includes('mkdocs'));
  assert.ok(ids(r).includes('hotjar'));
  assert.ok(ids(r).includes('google-analytics'));
});

test('jsGlobals match exact names only', () => {
  const r = match(fx.signal({ url: 'https://x.example/', host: 'x.example', jsGlobals: ['Intercomish'] }), rules);
  assert.ok(!ids(r).includes('intercom-messenger'));
  const r2 = match(fx.signal({ url: 'https://x.example/', host: 'x.example', jsGlobals: ['Intercom'], dom: ['#intercom-container'] }), rules);
  assert.equal(byId(r2, 'intercom-messenger').confidence, 'high');
});

test('results are sorted by category order then score', () => {
  const r = match(fx.zendeskCustomDomain, rules);
  const order = Object.keys(rules.categories);
  for (let i = 1; i < r.length; i++) assert.ok(order.indexOf(r[i - 1].category) <= order.indexOf(r[i].category));
});

test('the matcher is pure: same input, same output, input untouched', () => {
  const input = structuredClone(fx.zendeskCustomDomain);
  const a = match(input, rules);
  const b = match(input, rules);
  assert.deepEqual(a, b);
  assert.deepEqual(input, fx.zendeskCustomDomain);
});

test('rules file: unique ids, known categories and signal types, valid regexes and selectors', () => {
  const seen = new Set();
  for (const t of rules.technologies) {
    assert.ok(t.id && t.name && t.category, `incomplete tech ${JSON.stringify(t).slice(0, 60)}`);
    assert.ok(!seen.has(t.id), `duplicate id ${t.id}`);
    seen.add(t.id);
    assert.ok(t.category in rules.categories, `${t.id}: unknown category ${t.category}`);
    for (const type of Object.keys(t.patterns)) assert.ok(SIGNAL_TYPES.includes(type), `${t.id}: bad type ${type}`);
    assert.doesNotThrow(() => compileTech(t), `${t.id}: invalid regex`);
    if (t.website) assert.doesNotThrow(() => new URL(t.website), `${t.id}: bad website`);
  }
  for (const t of rules.technologies) {
    for (const ref of [...(t.implies || []), ...(t.excludes || [])]) assert.ok(seen.has(ref), `${t.id}: unknown ref ${ref}`);
  }
  for (const g of collectGlobals(rules)) assert.match(g, /^@?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/, `bad global ${g}`);
  assert.ok(collectSelectors(rules).length > 0);
});
