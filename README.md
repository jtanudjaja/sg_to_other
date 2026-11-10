# Singapore ⇄ Batam · Ferry Departures

A static, mobile-first departure board for the Singapore–Batam ferry routes (Sindo, Batam Fast, Majestic, Horizon).

Opens straight onto results — no form to fill in. It guesses your direction from geolocation (falling back to timezone), shows the next departure with a live countdown and the check-in cutoff, and lists the rest of the day below with past sailings collapsed. Filters are optional and live in a sheet behind one button.

## Files

| File | Purpose |
| --- | --- |
| [index.html](index.html) | Markup only |
| [styles.css](styles.css) | All styling, light + dark |
| [data.js](data.js) | Schedules, operators, terminals, crossing durations |
| [app.js](app.js) | State, filtering, rendering, sheets |
| [manifest.webmanifest](manifest.webmanifest) | App identity, standalone launch and home-screen icons |
| [pwa.js](pwa.js) / [sw.js](sw.js) | Install controls, offline notice and cached app releases |
| [icons/](icons/) | Ferry icon source, install icons and Apple touch icon |

**Bump the `?v=` on the `<link>`/`<script>` tags in `index.html` whenever you edit an asset** — otherwise browsers keep serving the cached copy and your change won't appear.
Also bump `RELEASE` in `sw.js` whenever any cached file changes and update its `ASSETS` entries to match the queries in `index.html`.

## Behaviour notes

- **Main ports are the default:** only Batam Centre and Harbour Bay are selected. Use **Browse other ports** inside Filters for Sekupang, Gold Coast, Waterfront and Nongsapura. Terminal filters apply within the selected group, in both directions; Reset and Clear return to the main ports. The group and filters persist; older saved filters migrate to the main ports.

- **Times are departure-port local.** SG → Batam in SGT (UTC+8), Batam → SG in WIB (UTC+7), as the operators publish them. The clock, countdown and date strip all follow the selected direction. Both zones are DST-free, so offsets are fixed.
- **Check-in cutoff is 35 minutes** (`LEAD` in [app.js](app.js)). If it has already passed for the next boat, the board says so and points at the first sailing you can still make.
- **Arrival times and durations are approximate** — typical crossing times from the `DUR` map in [data.js](data.js), not published arrivals.
- Direction and filter selections persist in `localStorage` under `sgbatam.v2`.
- Each sailing opens a detail sheet with share and an `.ics` calendar export (alarm set at the check-in cutoff).

## Deploying

Everything is static. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes the repo root to GitHub Pages on every push to `main`.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Install and offline use

The HTTPS GitHub Pages site is installable as a standalone PWA. All manifest and service-worker paths are relative, so repository subpaths work too.

- **Chrome / Edge:** expand **Install app** near the bottom of the board and use the install button when offered, or use the browser's install menu.
- **iPhone / iPad:** open the site in Safari → Share → Add to Home Screen. Choose **Open as Web App** if shown.
- Once the first online visit finishes caching, the board and filters work offline. An offline notice reminds you to confirm saved schedules with the operator.
- Updates download as a complete release in the background. Close all tabs and installed windows for this app, then reopen it to activate a waiting update. Caches are isolated to this app's path so other GitHub Pages apps are unaffected.

## Local preview

Open [index.html](index.html) directly in a browser — no server needed.

To test installation and offline support, use `python3 -m http.server 8000` and visit `http://localhost:8000`. Service workers require HTTPS or localhost; they do not run from `file://`.

Run the PWA checks with `node --test tests/pwa.test.cjs` (Node.js required, no dependencies).

## Data

Schedules are hard-coded in the `D` array in [data.js](data.js). Sources: Batam Fast (WEF 11 Apr 2026), Majestic (WEF 12 May 2026), Sindo and Horizon (current). Confirm with the operator before travelling.
