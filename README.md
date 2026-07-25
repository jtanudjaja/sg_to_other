# Singapore ⇄ Batam · Ferry Departures

A single-file static departure board for the Singapore–Batam ferry routes (Sindo, Batam Fast, Majestic, Horizon).

Filter by direction, day of week, operator, and terminal. Times are shown in departure-port local time — SG (UTC+8) outbound, WIB (UTC+7) inbound — and the clock plus the **NEXT** countdown follow the selected direction. Direction is guessed from geolocation, falling back to your timezone.

## Deploying

Everything is static: [index.html](index.html) is the whole site.

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes the repo root to GitHub Pages on every push to `main`.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Local preview

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Data

Schedules are hard-coded in the `D` array in `index.html`. Sources: Batam Fast (WEF 11 Apr 2026), Majestic (WEF 12 May 2026), Sindo and Horizon (current). Confirm with the operator before travelling.
