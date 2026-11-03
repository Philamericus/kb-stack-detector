export const DEFAULT_WEIGHTS = {
  cname: 100,
  headers: 80,
  meta: 80,
  jsGlobals: 70,
  scriptSrc: 60,
  cookies: 60,
  assets: 50,
  resourceHosts: 50,
  dom: 50,
  html: 40,
  url: 30,
};

export const KEYED_TYPES = new Set(['headers', 'meta']);
export const SIGNAL_TYPES = Object.keys(DEFAULT_WEIGHTS);

export function confidenceFor(score) {
  if (score >= 100) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

const compiled = new WeakMap();

function toEntry(type, raw, key) {
  const spec = typeof raw === 'string' ? { pattern: raw } : raw;
  const source = spec.pattern ?? '';
  return {
    type,
    key,
    source,
    re: source === '' || type === 'jsGlobals' ? null : new RegExp(source, 'i'),
    selector: type === 'dom' ? source : null,
    weight: spec.weight ?? DEFAULT_WEIGHTS[type],
  };
}

export function compileTech(tech) {
  const entries = [];
  for (const [type, pats] of Object.entries(tech.patterns || {})) {
    if (!(type in DEFAULT_WEIGHTS)) throw new Error(`${tech.id}: unknown signal type "${type}"`);
    if (KEYED_TYPES.has(type)) {
      for (const [key, raw] of Object.entries(pats)) entries.push(toEntry(type, raw, key.toLowerCase()));
    } else {
      for (const raw of [].concat(pats)) {
        if (type === 'dom') {
          const spec = typeof raw === 'string' ? { pattern: raw } : raw;
          entries.push({ type, source: spec.pattern, selector: spec.pattern, re: null, weight: spec.weight ?? DEFAULT_WEIGHTS.dom });
        } else {
          entries.push(toEntry(type, raw));
        }
      }
    }
  }
  return entries;
}

function compileRules(rules) {
  let c = compiled.get(rules);
  if (!c) {
    c = rules.technologies.map((t) => ({ tech: t, entries: compileTech(t) }));
    compiled.set(rules, c);
  }
  return c;
}

function snippet(text, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

const truncate = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function firstHit(list, re) {
  for (const v of list || []) if (re.test(v)) return v;
  return null;
}

function test(entry, s) {
  const { type, re, key } = entry;
  switch (type) {
    case 'scriptSrc':
    case 'assets':
    case 'resourceHosts':
    case 'jsGlobals':
    case 'cookies': {
      const list = s[type] || [];
      if (type === 'jsGlobals') return list.includes(entry.source) ? `window.${entry.source}` : null;
      if (type === 'cookies') return list.find((v) => re.test(v)) || null;
      const hit = firstHit(list, re);
      return hit && truncate(hit);
    }
    case 'cname': {
      const chain = s.cname || [];
      const hit = firstHit(chain, re);
      return hit ? `${s.host || '?'} → ${chain.slice(0, chain.indexOf(hit) + 1).join(' → ')}` : null;
    }
    case 'headers': {
      const v = (s.headers || {})[key];
      if (v == null) return null;
      if (re && !re.test(v)) return null;
      return `${key}: ${truncate(String(v), 80)}`;
    }
    case 'meta': {
      const vals = (s.meta || {})[key];
      if (!vals || !vals.length) return null;
      const hit = re ? vals.find((v) => re.test(v)) : vals[0];
      return hit == null ? null : `<meta ${key}="${truncate(hit, 80)}">`;
    }
    case 'html': {
      const m = re.exec(s.html || '');
      return m ? snippet(s.html, m.index, m[0].length) : null;
    }
    case 'dom':
      return (s.dom || []).includes(entry.selector) ? entry.selector : null;
    case 'url':
      return s.url && re.test(s.url) ? s.url : null;
    default:
      return null;
  }
}

export function collectSelectors(rules) {
  const out = new Set();
  for (const t of rules.technologies) for (const sel of [].concat(t.patterns?.dom || [])) out.add(typeof sel === 'string' ? sel : sel.pattern);
  return [...out];
}

export function collectGlobals(rules) {
  const out = new Set();
  for (const t of rules.technologies) for (const g of [].concat(t.patterns?.jsGlobals || [])) out.add(typeof g === 'string' ? g : g.pattern);
  return [...out];
}

export function match(signals, rules) {
  const byId = new Map();
  for (const { tech, entries } of compileRules(rules)) {
    let score = 0;
    const evidence = [];
    const seen = new Set();
    for (const e of entries) {
      const hit = test(e, signals);
      if (hit && !seen.has(hit)) {
        seen.add(hit);
        score += e.weight;
        evidence.push(`${e.type}: ${hit}`);
      }
    }
    if (score > 0) {
      byId.set(tech.id, {
        id: tech.id,
        name: tech.name,
        category: tech.category,
        website: tech.website,
        score,
        confidence: confidenceFor(score),
        evidence,
      });
    }
  }

  const techById = new Map(rules.technologies.map((t) => [t.id, t]));
  for (const r of [...byId.values()]) {
    for (const impliedId of techById.get(r.id)?.implies || []) {
      const implied = techById.get(impliedId);
      if (!implied) continue;
      const existing = byId.get(impliedId);
      if (existing) {
        existing.evidence.push(`implied by ${r.name}`);
      } else {
        byId.set(impliedId, {
          id: implied.id,
          name: implied.name,
          category: implied.category,
          website: implied.website,
          score: 0,
          confidence: r.confidence === 'high' ? 'medium' : 'low',
          evidence: [`implied by ${r.name}`],
        });
      }
    }
  }

  for (const r of [...byId.values()]) {
    if (r.score <= 0) continue;
    for (const ex of techById.get(r.id)?.excludes || []) {
      const loser = byId.get(ex);
      if (loser && loser.id !== r.id) {
        byId.delete(ex);
        r.evidence.push(`overrides ${loser.name} (${loser.evidence[0]})`);
      }
    }
  }

  const order = Object.keys(rules.categories || {});
  return [...byId.values()].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.score - a.score || a.name.localeCompare(b.name),
  );
}

export function primaryPlatform(results) {
  return results.find((r) => r.category === 'kb' && r.score > 0) || null;
}
