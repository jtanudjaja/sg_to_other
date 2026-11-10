# Singapore ⇄ Batam · Ferry Departures

A static, mobile-first departure board for the Singapore–Batam ferry routes (Sindo, Batam Fast, Majestic, Horizon).

Opens straight onto results — no form to fill in. It guesses your direction from geolocation (falling back to timezone), shows the next sailing with check-in still open, a live countdown and the check-in cutoff, and lists the rest of the day below with closed check-ins collapsed. Filters are optional and live in a sheet behind one button.

The page follows route → date and filters → results. Date and filter controls stay above the results, with the sailing count beside Filters. The selected date applies to both the hero trip and the remaining list; it is not repeated as another visible heading.

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

[DESIGN-HANDOFF.md](DESIGN-HANDOFF.md) is the brief for anyone picking this up for design work — what it does, the domain rules that constrain it, every UI state, the token system, and the decisions already made.

**Bump the `?v=` on the `<link>`/`<script>` tags in `index.html` whenever you edit an asset** — otherwise browsers keep serving the cached copy and your change won't appear.
Also bump `RELEASE` in `sw.js` whenever any cached file changes and update its `ASSETS` entries to match the queries in `index.html`.

## Behaviour notes

- **Main ports are the default:** only Batam Centre and Harbour Bay are selected. Use **Browse other ports** inside Filters for Sekupang, Gold Coast, Waterfront and Nongsapura. Terminal filters apply within the selected group, in both directions; Reset and Clear return to the main ports. The group and filters persist; older saved filters migrate to the main ports.

- **Times are departure-port local.** SG → Batam in SGT (UTC+8), Batam → SG in WIB (UTC+7), as the operators publish them. The clock, countdown and date strip all follow the selected direction. Both zones are DST-free, so offsets are fixed.
- **Check-in cutoff is 35 minutes** (`LEAD` in [app.js](app.js)). The hero and today's default count include only sailings whose cutoff is still ahead; at the cutoff itself, check-in is closed. Closed sailings remain browsable in a collapsed section, including boats that have not departed. When today's matching check-ins have all closed and no saved plan for today is awaiting departure (in either direction, regardless of filters), the board automatically selects tomorrow. A pending plan keeps today selected until departure. Tap Today to review today's closed schedule; this manual selection stays put until a direction change or local midnight. The board refreshes at each minute boundary, on returning to the page, and at local midnight.
- **Arrival times and durations are approximate** — typical crossing times from the `DUR` map in [data.js](data.js), not published arrivals.
- Direction and filter selections persist in `localStorage` under `sgbatam.v2`.
- Each sailing, including the hero trip, opens a detail sheet with share and an `.ics` calendar export (alarm set at the check-in cutoff). The whole hero card is a button with keyboard support whenever it shows a trip.
- **Planned trips:** **I’m taking this ferry** saves a dated sailing from its detail sheet; the same button becomes **Remove from my plans**, switching from solid teal to a neutral outlined style. Plans persist on this browser under `sgbatam.plans.v1`. The selected day's plans appear as separate cards above the next available sailing, including plans in the other direction or outside the current filters. Open a planned card to review or remove it. An all-plans page is deferred; there is no all-plans button or popup on the board.
- Each date allows **one Singapore departure and one Batam departure**. Choosing another sailing in the same direction replaces that day's previous choice; older saves with duplicates keep the last choice. If a plan matches the normal hero, the normal hero is hidden so that sailing appears once as a planned card. Otherwise, the hero and schedule order stay unchanged, and the planned sailing remains in the list with a check icon on the right.
- A compact planned-sailing bar appears beneath the sticky filters only after all of the selected day's planned cards have scrolled out of view behind them. It disappears as soon as a card becomes visible again. It shows the next upcoming plan (or the last departed plan), its departure-port timezone, route and countdown; tap it to open that sailing's details. Filters do not hide saved plans.
- Details and planned cards show departure → approximate crossing → arrival, with each port's timezone and the existing operator colour tag. The check-in cutoff gains a live minutes/hours countdown only on the sailing's departure-local date. Share and calendar always use that sailing's saved date and direction, independently of the board.

## Deploying

Everything is static. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes the repo root to GitHub Pages on every push to `main`.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Install and offline use

The HTTPS GitHub Pages site is installable as a standalone PWA. All manifest and service-worker paths are relative, so repository subpaths work too.

- **Chrome / Edge:** expand **Install app** near the bottom of the board and use the install button when offered, or use the browser's install menu.
- **iPhone / iPad:** open the site in Safari → Share → Add to Home Screen. Choose **Open as Web App** if shown.
- Once the first online visit finishes caching, the board, filters and planned trips work offline. An offline notice reminds you to confirm saved schedules with the operator. Planned trips remain in this browser's local storage; installation does not sync data between browsers or devices.
- Updates download as a complete release in the background. Close all tabs and installed windows for this app, then reopen it to activate a waiting update. Caches are isolated to this app's path so other GitHub Pages apps are unaffected.

## Local preview

Open [index.html](index.html) directly in a browser — no server needed.

To test installation and offline support, use `python3 -m http.server 8000` and visit `http://localhost:8000`. Service workers require HTTPS or localhost; they do not run from `file://`.

Run the board and planned-trip regression checks with `node --test tests/app.test.cjs` (Node.js required, no dependencies).
Run all checks, including PWA caching and installation behavior, with `node --test tests/*.test.cjs`.

## Data

Schedules are hard-coded in the `D` array in [data.js](data.js). Sources: Batam Fast (WEF 11 Apr 2026), Majestic (WEF 12 May 2026), Sindo and Horizon (current). Confirm with the operator before travelling.
