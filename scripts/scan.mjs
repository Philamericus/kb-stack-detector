#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze } from '../src/signals.js';
import { resolveCnameChain } from '../src/dns.js';
import { WELL_KNOWN_FILES } from '../src/ai-readiness.js';
import { hostOf } from '../src/extract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(await readFile(join(root, 'src/rules.json'), 'utf8'));

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const TIMEOUT = 15000;
const FILE_CAP = 1_000_000;

async function get(url, opts = {}) {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'user-agent': UA, accept: opts.accept || 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
  });
}

async function fetchFile(origin, path) {
  try {
    const res = await get(origin + path, { accept: '*/*' });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      text: text.slice(0, FILE_CAP),
      truncated: text.length > FILE_CAP,
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

export async function scan(target) {
  const res = await get(target);
  const html = await res.text();
  const url = res.url || target;
  const host = hostOf(url);
  const headers = Object.fromEntries(res.headers.entries());
  const cookies = (res.headers.getSetCookie?.() || []).map((c) => c.split('=')[0].trim());
  const origin = new URL(url).origin;
  const [cname, ...files] = await Promise.all([
    resolveCnameChain(host).catch(() => []),
    ...WELL_KNOWN_FILES.map((p) => fetchFile(origin, p)),
  ]);
  const raw = {
    url,
    html,
    headers,
    cookies,
    cname,
    files: Object.fromEntries(WELL_KNOWN_FILES.map((p, i) => [p, files[i]])),
  };
  return { status: res.status, raw, report: analyze(raw, rules) };
}

function summarize(target, { status, report }) {
  const p = report.platform;
  const lines = [];
  lines.push(`\n== ${target}  (HTTP ${status}, final ${report.url})`);
  lines.push(`Platform: ${p ? `${p.name} [${p.confidence}]` : 'Unknown platform'}`);
  const byCat = {};
  for (const r of report.results) (byCat[r.category] ||= []).push(r);
  for (const [cat, list] of Object.entries(byCat)) {
    lines.push(`  ${rules.categories[cat]?.name || cat}:`);
    for (const r of list) lines.push(`    - ${r.name} [${r.confidence}, ${r.score}]  ${r.evidence.slice(0, 3).join(' | ')}`);
  }
  const a = report.aiReadiness;
  const blocked = a.robots.bots.filter((b) => b.status === 'blocked').map((b) => b.bot);
  lines.push(
    `  AI: robots=${a.robots.present} llms.txt=${a.llmsTxt.present} llms-full=${a.llmsFullTxt.present} sitemap=${a.sitemap.present ? `${a.sitemap.kind}:${a.sitemap.count}` : false} jsonld=[${a.jsonLd.types.join(',')}] og=${a.openGraph.present} canonical=${!!a.canonical} mcp=${a.mcp.found} blocked=[${blocked.join(',')}]`,
  );
  const s = report.structure;
  lines.push(
    `  Structure: lang=${s.languages.htmlLang} locales=[${s.languages.locales.join(',')}] cats=${s.counts.categories} sections=${s.counts.sections} articles=${s.counts.articles} pages=${s.internalPages} versions=[${s.versioning.versions.join(',')}]${s.versioning.selector ? ' selector' : ''}`,
  );
  lines.push(`  Clues: cname=[${report.clues.cname.join(' → ')}] server=${report.clues.server} generator=${report.clues.generator.join(',')} hosts=${report.clues.scriptHosts.map((h) => h.host).join(',')}`);
  return lines.join('\n');
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const dumpIdx = args.indexOf('--dump');
const dumpDir = dumpIdx >= 0 ? args[dumpIdx + 1] : null;
const targets = args.filter((a, i) => !a.startsWith('--') && !(dumpIdx >= 0 && i === dumpIdx + 1));

if (!targets.length) {
  console.error('usage: node scripts/scan.mjs [--json] [--dump <dir>] <url> [url...]');
  process.exit(2);
}

for (const t of targets) {
  try {
    const out = await scan(t);
    if (dumpDir) {
      await mkdir(dumpDir, { recursive: true });
      const base = join(dumpDir, hostOf(out.raw.url) || 'page');
      await writeFile(base + '.html', out.raw.html);
      await writeFile(base + '.headers.json', JSON.stringify({ headers: out.raw.headers, cname: out.raw.cname }, null, 2));
    }
    if (json) {
      const { html, ...rest } = out.raw;
      console.log(JSON.stringify({ target: t, status: out.status, raw: { ...rest, files: undefined }, report: out.report }, null, 2));
    } else {
      console.log(summarize(t, out));
    }
  } catch (e) {
    console.log(`\n== ${t}\n  ERROR: ${e.message || e}`);
  }
}
