# Contributing

Most contributions are detection rules: a new platform, or a fix for a wrong result. The format and signal types are in the README, under [Adding a rule](README.md#adding-a-rule).

## Add or fix a rule

1. Edit [`src/rules.json`](src/rules.json).
2. Check the rule against a real site:

   ```sh
   node scripts/scan.mjs https://docs.example.com/
   ```

3. Load the extension unpacked and scan the same site if the rule uses `jsGlobals`, `dom`, or `resourceHosts`. The CLI can't see those.
4. Run the checks:

   ```sh
   npm test
   npm run validate
   ```

5. In your pull request, name a public site that shows the rule firing.

## Rule requirements

- **Write patterns from your own observation.** Look at the site's HTML, headers, and vendor docs. Please don't copy patterns from Wappalyzer or other fingerprint lists, because their licenses may not be compatible with MIT.
- **Use structural markers.** Prefer asset hosts, attributes, and headers over product names, because help centers often mention competitors.
- **Keep regexes fast.** Patterns run against up to a full page of HTML in the popup. Avoid nested quantifiers such as `(a+)+` and long unanchored `.*` runs.
- **Keep fixtures generic.** Use `example.com` hostnames, with no customer data or real user content.

## Code changes

Keep the extension free of dependencies, build steps, and new permissions. A change that adds a permission, a network request, or stored data needs a README Privacy update and a clear reason in the pull request.

## Security problems

Please report these privately, as described in [SECURITY.md](SECURITY.md).
