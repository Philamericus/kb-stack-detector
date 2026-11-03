export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
const CNAME_TYPE = 5;

export function isResolvableHost(host) {
  return typeof host === 'string' && HOST_RE.test(host) && !/^\d+(\.\d+){3}$/.test(host);
}

const strip = (n) => String(n).replace(/\.$/, '').toLowerCase();

export async function resolveCnameChain(host, fetchFn = fetch, maxHops = 5) {
  if (!isResolvableHost(host)) return [];
  const chain = [];
  const seen = new Set([strip(host)]);
  let current = strip(host);
  for (let hop = 0; hop < maxHops; hop++) {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(current)}&type=CNAME`;
    const res = await fetchFn(url, { headers: { accept: 'application/dns-json' } });
    if (!res.ok) break;
    const body = await res.json();
    const map = new Map();
    for (const a of body.Answer || []) {
      if (a.type === CNAME_TYPE) map.set(strip(a.name), strip(a.data));
    }
    let advanced = false;
    while (map.has(current) && chain.length < maxHops) {
      const next = map.get(current);
      if (seen.has(next)) return chain;
      seen.add(next);
      chain.push(next);
      current = next;
      advanced = true;
    }
    if (!advanced || chain.length >= maxHops) break;
  }
  return chain;
}
