import { resolveCnameChain, isResolvableHost } from './dns.js';

const DNS_TIMEOUT_MS = 5000;

const timedFetch = (url, opts) => fetch(url, { ...opts, credentials: 'omit', signal: AbortSignal.timeout(DNS_TIMEOUT_MS) });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'resolve-cname') return false;
  if (!isResolvableHost(msg.host)) {
    sendResponse({ chain: [] });
    return false;
  }
  resolveCnameChain(msg.host, timedFetch).then(
    (chain) => sendResponse({ chain }),
    (err) => sendResponse({ chain: [], error: String(err?.message || err) }),
  );
  return true;
});
