const base = {
  scriptSrc: [],
  assets: [],
  meta: {},
  headers: {},
  cookies: [],
  jsGlobals: [],
  resourceHosts: [],
  cname: [],
  dom: [],
  html: '',
};

export const signal = (over) => ({ ...base, ...over });

export const zendeskCustomDomain = signal({
  url: 'https://support.example.com/hc/en-us',
  host: 'support.example.com',
  cname: ['example.zendesk.com'],
  headers: { 'zendesk-service': 'help-center', 'cf-ray': '8a1b2c3d4e5f-TLV', server: 'cloudflare' },
  scriptSrc: ['https://static.zdassets.com/hc/assets/hc_enduser-abc.js', 'https://static.zdassets.com/ekr/snippet.js?key=1'],
  jsGlobals: ['HelpCenter', 'zE'],
  html: '<html><body><div class="powered-by-zendesk"></div><a href="/hc/en-us/requests/new">Submit a request</a></body></html>',
});

export const cnameOnly = signal({
  url: 'https://help.example.org/',
  host: 'help.example.org',
  cname: ['example.zendesk.com'],
});

export const docusaurus = signal({
  url: 'https://docs.example.dev/',
  host: 'docs.example.dev',
  meta: { generator: ['Docusaurus v3.5.2'] },
  html: '<div id="__docusaurus"><button class="DocSearch DocSearch-Button"></button></div>',
  resourceHosts: ['abc123-dsn.algolia.net'],
  headers: { 'x-nf-request-id': '01ABC', server: 'Netlify' },
});

export const freshserviceOnFreshdeskInfra = signal({
  url: 'https://acme.freshservice.com/support/home',
  host: 'acme.freshservice.com',
  cname: ['elb4.freshdesk.com'],
});

export const unknownSite = signal({
  url: 'https://kb.example.net/',
  host: 'kb.example.net',
  meta: { generator: ['HomegrownCMS 2.1'] },
  headers: { server: 'nginx', 'x-powered-by': 'Express' },
  scriptSrc: ['https://cdn.thirdparty.io/widget.js', 'https://cdn.thirdparty.io/other.js', 'https://kb.example.net/app.js'],
});

export const contentMentionsCompetitors = signal({
  url: 'https://blog.example.com/',
  host: 'blog.example.com',
  html: '<p>We compared Zendesk, Intercom, Freshdesk, GitBook and Docusaurus for our help center.</p>',
});
