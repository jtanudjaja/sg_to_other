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

**Bump the `?v=` on the `<link>`/`<script>` tags in `index.html` whenever you edit an asset** — otherwise browsers keep serving the cached copy and your change won't appear.

## Behaviour notes

- **Times are departure-port local.** SG → Batam in SGT (UTC+8), Batam → SG in WIB (UTC+7), as the operators publish them. The clock, countdown and date strip all follow the selected direction. Both zones are DST-free, so offsets are fixed.
- **Check-in cutoff is 35 minutes** (`LEAD` in [app.js](app.js)). If it has already passed for the next boat, the board says so and points at the first sailing you can still make.
- **Arrival times and durations are approximate** — typical crossing times from the `DUR` map in [data.js](data.js), not published arrivals.
- Direction and filter selections persist in `localStorage` under `sgbatam.v2`.
- Each sailing opens a detail sheet with share and an `.ics` calendar export (alarm set at the check-in cutoff).

## Deploying

Everything is static. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes the repo root to GitHub Pages on every push to `main`.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Local preview

Open [index.html](index.html) directly in a browser — no server needed.

## Data

Schedules are hard-coded in the `D` array in [data.js](data.js). Sources: Batam Fast (WEF 11 Apr 2026), Majestic (WEF 12 May 2026), Sindo and Horizon (current). Confirm with the operator before travelling.
