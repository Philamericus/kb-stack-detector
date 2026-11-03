# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Please keep security problems out of public issues.

## Threat model

KB Stack Detector runs on every page a user chooses to scan, so it treats all page content as hostile.

**In scope**

- A malicious page that runs script in the popup or the service worker.
- A malicious page that spoofs collector results to break the popup. The `MAIN` world collector shares its environment with the page, so its output is untrusted.
- A rule or page that hangs the popup through a slow regex.
- Data leaving the browser beyond what the README's Privacy section lists.

**Out of scope**

- A page that fakes signals to get a wrong detection. Results are hints, and a site controls its own markup.
- Someone who already controls the user's browser or extension files.
- Scanning sites the user has no right to access. The extension only reads what the browser already loaded, plus the requests listed in the README.

## Defenses

- **On-click only.** There are no content scripts and no background listeners on browsing. `activeTab` limits access to the current tab, for the current click.
- **Narrow permissions.** `activeTab`, `scripting`, and one host permission for Cloudflare's DNS endpoint. A test fails if this list grows.
- **No remote code.** All code and rules ship in the package. There is no build step and there are no dependencies.
- **Safe rendering.** The popup builds its DOM with `textContent` and attributes, and never uses `innerHTML`. Links come only from the bundled rules.
- **No cookies sent.** Every request the extension makes omits credentials. A test covers this for the page requests.
- **No cookie values.** The collector keeps cookie names and drops the values.
- **Message checks.** The service worker accepts messages only from this extension and validates hostnames before any lookup.
- **Size limits.** Page HTML and fetched files are capped, and requests time out.
- **Nothing stored.** Results live in the popup and disappear when it closes.

## Known data flow

Each scan sends the current hostname and its CNAME targets to Cloudflare's public DNS resolver, including intranet hostnames. The README's Privacy section has the details.
