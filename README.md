# KB Stack Detector

A Chrome extension (Manifest V3) that tells you what a help center, knowledge base, support site, or docs hub is built on. Think Wappalyzer, but focused on the support and docs stack:

- **Knowledge base platform**: Zendesk Guide, Intercom Articles, Freshdesk, Freshservice, Help Scout Docs, Document360, GitBook, Mintlify, ReadMe, Docusaurus, Notion (and Super), Confluence, HubSpot KB, Salesforce Experience Cloud, ServiceNow, Helpjuice, KnowledgeOwl, HelpDocs, Archbee, Nextra, VitePress, MkDocs / Material, Read the Docs, Fern, Redocly, Stoplight, Crisp, Gorgias, Front, Groove/Helply, Zoho Desk, Bettermode, Discourse, and more.
- **AI & search**: Algolia / DocSearch, Inkeep, Kapa.ai, Mendable, Markprompt, DocsBot, Chatbase, Typesense, Elastic, Coveo, Swiftype, platform assistants, generic "Ask AI" buttons.
- **Chat & ticketing**: Intercom Messenger, Zendesk Web Widget / Messaging, Drift, Freshchat, HubSpot chat, Crisp, LiveChat, Tawk.to, Olark, Help Scout Beacon, Gorgias, Front, ticket-form links.
- **Hosting & frameworks**: Cloudflare, Vercel, Netlify, CloudFront, Fastly, Akamai, GitHub Pages, Fly.io, Render, Heroku, HubSpot CMS; Next.js, Nuxt, Gatsby, Astro, React, Vue, Svelte, Angular.
- **Analytics & feedback**: GA4, GTM, Segment, Hotjar, FullStory, Pendo, Mixpanel, Amplitude, Heap, PostHog, Plausible, Fathom, GoatCounter, Clarity, Cloudflare Web Analytics, article-rating widgets.
- **AI-readiness**: robots.txt rules per AI crawler (GPTBot, ClaudeBot, anthropic-ai, Google-Extended, PerplexityBot, CCBot, and others), llms.txt, llms-full.txt, sitemap.xml, JSON-LD types (FAQPage, Article, HowTo, BreadcrumbList), OpenGraph, canonical, hreflang, MCP server mentions.
- **Content structure** (current page, best effort): categories, sections, linked articles, languages, versioning.

Custom domains are the interesting part. `help.example.com` often hides the vendor, but its DNS CNAME usually points at `example.zendesk.com`, `*.helpscoutdocs.com`, `us.intercomhelpcenter.com`, and so on. The extension resolves the CNAME chain over DNS-over-HTTPS to catch those.

If no platform matches, the popup says **Unknown platform** and opens a **Raw clues** panel (generator meta, CNAME chain, `server` / `x-powered-by` / `via`, top third-party script hosts, header names) so you can write a rule.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the repository folder (the one with `manifest.json`).
4. Pin **KB Stack Detector** from the puzzle-piece menu, open any help center or docs site, and click the icon.

There is no build step. Chrome loads the files as they are.

Pages the extension can't scan (`chrome://`, the Chrome Web Store, local files, error pages, the PDF viewer) show a short explanation instead.

## Privacy

Nothing runs until you click the toolbar icon. There are no content scripts, no background listeners on your browsing, no storage, no history, no telemetry, and no AI calls. The only third party it contacts is Cloudflare, for the DNS lookup described below.

When you click the icon, the extension uses `activeTab` + `scripting` to inject two short collector functions into **the current tab only**, then makes these requests:

| Request | Where it goes | Why |
|---|---|---|
| `HEAD <current page URL>` (`cache: force-cache`) | The site you're on (same origin), **without cookies** | Read response headers (`server`, `x-powered-by`, `cf-ray`, `x-vercel-id`, `zendesk-service`, …). Usually served from the browser cache. |
| `GET /robots.txt`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` | The site you're on (same origin), **without cookies** | AI-readiness checks. These are the only extra page requests. Bodies are capped at 1 MB and discarded after the popup closes. |
| `GET https://cloudflare-dns.com/dns-query?name=<hostname>&type=CNAME` (up to 5 hops) | Cloudflare's public DoH resolver | Follow the CNAME chain to spot hosted platforms behind custom domains. Only hostnames are sent, never paths. |

The DNS lookup runs on every scan. Cloudflare receives the hostname of each site you scan, plus each CNAME target in its chain. That includes intranet names such as `wiki.corp.example.com`, so avoid scanning internal sites if their hostnames are sensitive. Single-label names such as `localhost` and IP addresses are skipped. Cloudflare's [resolver privacy policy](https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/) covers what it logs and for how long.

Everything else (script URLs, link/iframe URLs, meta tags, HTML markers, cookie **names**, JS global **names**, `performance` resource hostnames) is read from the already-loaded page. Cookie values and global values are never read or sent anywhere.

Permissions: `activeTab`, `scripting`, and a single host permission for `https://cloudflare-dns.com/dns-query*`.

## How detection works

1. **Collect** (`src/collectors.js`). `collectPage` runs in the extension's isolated world: page HTML, script/link/iframe URLs, matched DOM selectors, cookie names, response headers, and the well-known files. `collectMain` runs in the page's `MAIN` world and checks which JS globals exist (`zE`, `Intercom`, `docsearch`, `__NEXT_DATA__`, …), probes for React/Vue/Svelte roots, and lists resource hostnames from `performance.getEntriesByType('resource')`.
2. **Resolve** (`src/background.js`, `src/dns.js`). The service worker follows the CNAME chain via DoH.
3. **Match** (`src/matcher.js`). `match(signals, rules)` is a pure function. Each matching pattern adds its weight. A total of 100 or more is **high**, 50 or more is **medium**, and anything lower is **low**. Each result carries the evidence strings that fired.
4. **Analyze** (`src/ai-readiness.js`, `src/structure.js`). Robots parsing (longest-match, RFC 9309 style), sitemap counting, JSON-LD types, and content-structure heuristics.

The same matcher and analyzers run in Node for tests and for the CLI harness.

## Adding a rule

All rules live in one file, [`src/rules.json`](src/rules.json). A technology looks like this:

```json
{
  "id": "helpscout-docs",
  "name": "Help Scout Docs",
  "category": "kb",
  "website": "https://www.helpscout.com/knowledge-base/",
  "patterns": {
    "cname": ["\\.helpscoutdocs\\.com$"],
    "scriptSrc": [{ "pattern": "d3eto7onm69fcz\\.cloudfront\\.net/assets/javascripts/", "weight": 70 }],
    "html": [{ "pattern": "id=\"serp-dd\"", "weight": 30 }]
  },
  "implies": [],
  "excludes": []
}
```

- `category` is one of the keys in `categories` (`kb`, `ai-search`, `chat`, `hosting`, `framework`, `analytics`).
- Patterns are case-insensitive regex strings (JSON-escaped), or `{ "pattern": "…", "weight": N }` to override the default weight.
- Signal types and default weights:

| Type | Tested against | Default weight |
|---|---|---|
| `cname` | each hostname in the CNAME chain | 100 |
| `headers` | `{ "header-name": "value regex" }`, `""` = header present | 80 |
| `meta` | `{ "meta-name": "content regex" }` (`name`, `property`, `http-equiv`) | 80 |
| `jsGlobals` | **exact** global names or dotted paths, e.g. `"zE"`, `"Intercom"`. `@react`, `@vue`, `@svelte` are built-in probes | 70 |
| `scriptSrc` | each `<script src>` URL | 60 |
| `cookies` | each cookie **name** | 60 |
| `assets` | `<link href>` and `<iframe src>` URLs | 50 |
| `resourceHosts` | hostnames of loaded resources | 50 |
| `dom` | CSS selectors, checked with `querySelector` (browser only) | 50 |
| `html` | the full page HTML | 40 |
| `url` | the page URL | 30 |

- `implies` adds related technologies (Docusaurus implies React). Implied entries never become the primary platform.
- `excludes` removes another match when this one fires. Use it when two products share infrastructure (Freshservice runs on Freshdesk's CNAMEs).

Rule-writing tips:

- Use structural markers (asset hosts, attribute values, class prefixes, headers), not product names. Help centers often mention competitors in their articles.
- Prefer fewer accurate patterns over many guesses. A wrong "high" is worse than "Unknown platform".
- Check a new rule against a real site with the harness (below), then add a fixture test if it does something new.

## Development

Requires Node 22 or newer. No dependencies to install.

```sh
npm test                                      # unit tests (node --test)
npm run validate                              # manifest is MV3 and every referenced file exists
node scripts/scan.mjs https://docs.example.com/   # run the matcher against a live site
node scripts/scan.mjs --json <url>            # full report as JSON
node scripts/scan.mjs --dump /tmp/out <url>   # also save the HTML and headers for rule writing
```

`scripts/scan.mjs` fetches the page HTML and headers, does the DoH CNAME lookup, fetches the well-known files, and runs the same matcher. It can't see JS globals, cookies set by scripts, or DOM injected after load, so the extension usually finds more than the harness does (chat widgets in particular).

## Known limitations

- **Intercom Fin and Zendesk AI agents** aren't detected. Their names show up in the i18n bundles of every Intercom and Zendesk help center, whether the feature is on or not. Without runtime access to the messenger iframe there's no honest passive signal.
- **Client-rendered help centers** (some Gorgias and Notion pages) carry few markers in server HTML. The extension sees the rendered DOM and does better than the CLI.
- **Response headers** come from a cookieless `HEAD` request with `cache: force-cache`, so they may reflect a cached response or a logged-out view. Some servers answer `HEAD` differently from `GET`.
- **Content structure** counts links on the current page only. It's a quick read, not a crawl.
- **llms.txt** is checked at the site root. Docs mounted on a subpath (for example `/docs/llms.txt`) are reported when the site advertises them with an `x-llms-txt` header.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) to add or fix a rule, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

Code and rules are [MIT](LICENSE). The icon is [Streamline Color](https://github.com/webalys-hq/streamline-vectors) by Streamline, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [NOTICE](NOTICE) for details.
