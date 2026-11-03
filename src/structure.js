const LOCALE_CODES = new Set(
  'ar bg bn ca cs da de el en es et fa fi fr he hi hr hu id it ja ko lt lv ms nb nl no pl pt ro ru sk sl sr sv th tr uk ur vi zh'.split(' '),
);

const LOCALE_SEG = /^([a-z]{2})(?:[-_]([a-z]{2,4}))?$/i;

const PLATFORM_LINKS = {
  'zendesk-guide': {
    categories: /\/hc\/(?:[\w-]+\/)?categories\/(\d+)/,
    sections: /\/hc\/(?:[\w-]+\/)?sections\/(\d+)/,
    articles: /\/hc\/(?:[\w-]+\/)?articles\/(\d+)/,
  },
  'intercom-articles': {
    categories: /\/collections\/(\d+)/,
    articles: /\/articles\/(\d+)/,
  },
  freshdesk: {
    categories: /\/support\/solutions\/(\d+)(?![\w/])/,
    sections: /\/solutions\/folders\/(\d+)/,
    articles: /\/solutions\/articles\/(\d+)/,
  },
  freshservice: {
    categories: /\/support\/solutions\/(\d+)(?![\w/])/,
    sections: /\/solutions\/folders\/(\d+)/,
    articles: /\/solutions\/articles\/(\d+)/,
  },
  'helpscout-docs': {
    categories: /\/(?:category|collection)\/(\d+)/,
    articles: /\/article\/(\d+)/,
  },
  'hubspot-kb': {
    articles: /\/knowledge\/[^/?#]+\/[^/?#]+/,
  },
  helpjuice: {
    categories: /\/categories\/(\d+)/,
  },
  document360: {
    categories: /\/docs\/(?:[a-z]{2}\/)?category\/([^/?#]+)/,
    articles: /\/docs\/(?:[a-z]{2}\/)?([^/?#]+)$/,
  },
};

const GENERIC_LINKS = {
  categories: /\/(?:categor(?:y|ies)|collections?)\/([^/?#]+)/,
  sections: /\/sections?\/([^/?#]+)/,
  articles: /\/(?:articles?|kb)\/([^/?#]+)/,
};

const SWITCHER_RE = /(language[-_]?(?:selector|switcher|picker|menu|dropdown)|locale[-_]?(?:selector|switcher|picker|menu|dropdown)|lang[-_]?switch)/i;
const VERSION_UI_RE = /(version[-_]?(?:selector|switcher|picker|dropdown|menu)|docsVersionDropdown|VersionPicker|rm-VersionDropdown)/i;
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|woff2?|ttf|mp4)$/i;

function distinct(urls, re) {
  const ids = new Set();
  for (const u of urls) {
    const m = re.exec(u.pathname);
    if (m) ids.add(m[1] ?? m[0]);
  }
  return ids.size;
}

export function analyzeStructure({ url, html = '', extracted, platformId, headers = {} }) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }
  const internal = [];
  for (const a of extracted.anchors) {
    try {
      const u = new URL(a);
      if (u.origin === origin && !ASSET_RE.test(u.pathname)) internal.push(u);
    } catch {}
  }

  const patterns = { ...GENERIC_LINKS, ...(PLATFORM_LINKS[platformId] || {}) };
  const counts = {};
  for (const k of ['categories', 'sections', 'articles']) {
    const n = distinct(internal, patterns[k]);
    counts[k] = n || null;
  }
  const internalPages = new Set(internal.map((u) => u.pathname.replace(/\/$/, '') || '/')).size;

  const locales = new Set();
  for (const h of extracted.hreflang) if (h.lang.toLowerCase() !== 'x-default') locales.add(h.lang.toLowerCase());
  for (const u of internal) {
    const segs = u.pathname.split('/').filter(Boolean);
    const seg = segs[0] === 'hc' ? segs[1] : segs[0];
    const m = seg && LOCALE_SEG.exec(seg);
    if (m && LOCALE_CODES.has(m[1].toLowerCase()) && (segs.length > 1 || segs[0] === 'hc')) locales.add(seg.toLowerCase());
  }
  const switcher = SWITCHER_RE.exec(html);

  const versions = new Set();
  for (const u of internal) {
    const m = /\/v(\d+(?:\.\d+){0,2})(?=\/|$)/i.exec(u.pathname);
    if (m) versions.add('v' + m[1]);
  }
  const docusaurusVersion = /docs-version-([\w.-]+)/.exec(html);
  if (docusaurusVersion) versions.add(docusaurusVersion[1]);
  if (headers['x-rtd-version']) versions.add(headers['x-rtd-version']);
  const versionUi = VERSION_UI_RE.exec(html);

  return {
    languages: {
      htmlLang: extracted.htmlLang,
      locales: [...locales].sort(),
      switcher: switcher ? switcher[0] : null,
    },
    counts,
    internalPages,
    versioning: {
      detected: versions.size > 1 || !!versionUi || !!headers['x-rtd-version'],
      versions: [...versions].sort(),
      selector: versionUi ? versionUi[0] : null,
    },
  };
}
