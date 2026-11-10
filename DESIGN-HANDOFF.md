# Singapore ⇄ Batam Ferry Board — design handoff

A one-page, mobile-first departure board for the Singapore–Batam ferry crossing. Static site, no backend, no accounts, no booking. Live at the repo's GitHub Pages URL.

---

## 1. The job it does

Someone standing at (or heading to) a ferry terminal wants one answer: **"when is the next boat, and can I still make it?"** Everything else — the full day's timetable, other operators, other terminals — is secondary browsing.

The design consequence: **the page opens directly onto results, with their controls visible first.** Direction is guessed, today is assumed, all operators and main Batam ports are on by default. The order is route → date and filters → results. Customers can see the chosen date, Filters button and sailing count before the featured sailing. There is no search form or "find sailings" step; changing any selection updates the hero and list together.

**Do not** introduce a step between page load and seeing real departures.

### Primary users
- Day-trippers and weekend travellers (SG → Batam), often at HarbourFront or Tanah Merah
- Indonesian commuters and returning travellers (Batam → SG)
- Both are usually **on a phone, in a hurry, possibly on bad terminal wifi or roaming data**

---

## 2. Non-negotiable domain rules

These shape the UI and must survive any redesign.

### Two timezones, one hour apart
Singapore is UTC+8, Batam (WIB) is UTC+7. Neither observes DST, so the offset is always exactly one hour.

- **All times shown are departure-port local time**, exactly as operators publish them.
- SG → Batam is displayed in SGT; Batam → SG in WIB.
- The header clock, the countdown, and the date strip **all follow the selected direction**. Switching direction re-anchors "today" to the other zone.
- **Consequence a designer will trip on:** a 60-minute crossing to Batam departing 12:00 arrives at 12:00 on the destination clock. This looks like a bug and has already confused people once. It is correct. A compact caption labels the departure/arrival timezones, with the hour-offset explanation in “How to read this board”.

### Check-in closes 35 minutes before departure
Single source of truth: `LEAD` in `app.js`. Drives the hero's check-in line, the detail sheet row, and the calendar alarm. If this number changes, it changes everywhere from that one constant.

A boat can be *departing in 20 minutes* and still be **uncatchable**. The hero selects the first sailing whose check-in cutoff is still ahead, skipping closed check-ins even if the boat has not sailed. At the cutoff itself, check-in is closed. Today's default count and list use the same rule; closed sailings remain browsable in a collapsed section. When all check-ins have closed today, the hero says so and shows tomorrow's first matching sailing and cutoff.

### Approximate data, honestly labelled
- **Crossing durations and arrival times are estimates** from a hardcoded route table, not published arrivals. They are always prefixed `~` or labelled "approx".
- Schedules are hand-transcribed and dated (Batam Fast WEF 11 Apr 2026, Majestic WEF 12 May 2026, Sindo and Horizon current).
- Weekend timetables also apply on public holidays — but **the app has no holiday calendar**, so this is stated in the notes rather than reflected in the data.
- The page must keep telling users to confirm with the operator. This is unofficial.

### Interlining
Sindo and Batam Fast sometimes sell **the same physical boat**. Those rows carry a `⇄ shared` flag so people don't count one sailing as two options.

---

## 3. What's on screen

Single scrolling page, max content width 680px, centred on desktop.

```
┌─ HEADER (dark, scrolls away) ─────────────┐
│  "Ferry departures"        11:40:31 SGT   │
│  ┌───────────────────────────────────┐    │
│  │ FROM Singapore  (⇄)     TO Batam  │    │  ← whole bar is one tap target
│  └───────────────────────────────────┘    │
│  [Singapore · from your timezone] Re-detect│
└───────────────────────────────────────────┘
┌─ STICKY DATE + FILTER CONTROLS ────────────┐
│ [TODAY Tue][TOMORROW Wed][THU 12][FRI 13]…│  ← 14 days, horizontal scroll
│ [☰ Filters (2)] [Clear]  67 check-in open │
└───────────────────────────────────────────┘
  Today · 10 Nov                             ← shared results heading
┌─ HERO CARD ───────────────────────────────┐
│ NEXT AVAILABLE SAILING      Today · SGT   │
│ 12:20        [in 40 min]                  │
│ HarbourFront → Batam Centre               │
│ ● Majestic   ~60 min · arrives 12:20 WIB  │
│ ─────────────────────────────────────     │
│ Check-in closes 11:45 — in 5 min from now │
└───────────────────────────────────────────┘
  caption: departures in SGT · arrivals in WIB
  [↑ Show 40 sailings with check-in closed]
  LATER TODAY ─────────────────────
  ┌──────────────────────────────────────┐
  │ 12:20    ● Majestic  ~60m            │
  │ arr 12:20  HarbourFront → Batam Centre  ›│
  └──────────────────────────────────────┘
  … 66 more rows …
  [Operators & colours ▾] [How to read this board ▾] [Before you travel ▾]
```

Plus: a floating **Jump to now** pill (bottom-right, today only, appears once the hero scrolls off), a **filter sheet**, and a **sailing detail sheet**.

---

## 4. Components

| Component | Notes |
|---|---|
| **Route bar** | The entire bar is one button — tap anywhere to reverse direction. Not two separate pickers; there are only two endpoints, so a swap is the only meaningful action. |
| **Detection pill** | Shows how direction was decided: geolocation → timezone → "Singapore · default". Once the user taps the route bar it reads "Set manually" and detection stops overriding them. `Re-detect` re-enables it. |
| **Hero card** | The answer. Next sailing with check-in open, live departure countdown, route, operator, approximate crossing and arrival, and the check-in line. The whole trip card opens the same detail sheet as a list row, with a “View details ›” cue and native keyboard support. Empty and check-in-closed-for-today messages are not buttons. Has distinct copy for: check-in open / first departure of a future day / check-in closed for today (with tomorrow's first matching sailing). |
| **Date strip** | 14 days from today, horizontally scrollable. `Today` / `Tomorrow` are named; the rest show weekday + date. Month abbreviation appears once the strip crosses into a new month. Weekend labels tint warn-orange. |
| **Filter bar** | Above all results, below the date strip. One `Filters` button with a badge counting how many options are switched **off** (badge hidden at zero), a `Clear` button that appears only when something is filtered, and the live sailing count. |
| **Results heading** | The selected date introduces both the hero and the remaining list. |
| **Sailing row** | Two columns on a shared baseline grid: time column (departure + `arr`) and detail column (operator tag + duration + flags, then origin → **destination**). Whole row is a button opening the detail sheet. |
| **Section dividers** | `CHECK-IN CLOSED`, `NOW · 12:04`, `LATER TODAY` / `REST OF THE DAY`. The `NOW` divider carries the `HIDE CLOSED` control — it's the closed/open check-in boundary and it's where expanding scrolls you to. |
| **Filter sheet** | Bottom sheet on mobile, centred modal ≥640px. Operator chips (with colour dots), then departing terminal, then arriving terminal — **the departing group always sorts first** and the labels flip with direction. |
| **Detail sheet** | Operator, check-in close (with relative time), departs, approximate arrival with timezone, crossing, days operated, interline note. Actions: **Share** (native share, clipboard fallback) and **Add to calendar** (`.ics` download with an alarm at the check-in cutoff). |

---

## 5. Every state to design for

**Board**
1. Today, closed check-ins collapsed — *default*. The count includes only sailings with check-in open.
2. Today, closed check-ins expanded — every closed row is labelled; departed rows are also dimmed with struck-through times. The count includes all sailings while expanded.
3. Future date — hero reads "First departure", divider reads "Rest of the day", no past section
4. Only one sailing matches that day — hero shows it, board reads *"That's the last sailing of the day."*
5. No sailings match — empty state naming the cause: *"You have 3 operators and 6 terminals switched off."* with a Reset button
6. No sailings on the route at all that day — same empty state, different copy, no Reset

**Hero**
7. Check-in open — neutral, *"Check-in closes 11:45 — in 5 min from now"*
8. Check-in closes within 10 minutes — countdown badge turns warn-orange
9. Check-in closes — hero immediately advances to the next sailing with check-in open, even if the earlier boat has not sailed
10. All today's check-ins closed — *"Check-in closed for today"*, points at tomorrow's first matching sailing and cutoff

**Global:** light + dark (both must be designed), reduced-motion, and detection states (detecting / from location / from timezone / default / set manually).

---

## 6. Data

| | |
|---|---|
| Operators | Sindo, Batam Fast, Majestic, Horizon — each has a fixed brand colour |
| Singapore terminals | HarbourFront, Tanah Merah |
| Batam terminals | Batam Centre, Harbour Bay, Sekupang, Gold Coast, Waterfront, Nongsapura |
| Departures | ~217 across the week (46 schedule entries expanded by day-of-week) |
| Day patterns | Daily, Sat/Sun, Fri–Sun, Thu–Sun, Sat–Mon, Sun only, Mon/Sat/Sun |
| Crossing times | 45–90 min depending on terminal pair |
| Persistence | `localStorage` key `sgbatam.v2` — direction, manual-override flag, operator and terminal selections |

**There is no data for:** fares, seat availability, real-time delays or cancellations, vessel names, booking links, public holidays, or immigration queue times. Don't design UI that implies any of these exist.

---

## 7. Visual system

All colour lives in CSS custom properties at the top of `styles.css`, with a full dark-mode override block. Change tokens, not component rules.

**Light:** page `#EEF3F4`, surface `#FFFFFF`, ink `#12242A`, primary "sea" `#0B5A61`, accent `#12B0BA`, warn `#B4570F`, header "deep" `#0E343A`.
**Dark:** page `#0B1416`, surface `#131F22`, ink `#E7F1F2`, sea `#2A9AA3`, accent `#3FD0D9`.

**Operator colours** (light / dark):
Sindo `#1D6FB8` / `#7FBCF0` · Batam Fast `#C2403B` / `#F0968F` · Majestic `#17714E` / `#5FD3A2` · Horizon `#94570D` / `#EDB56B`

**Type:** system sans for UI; system monospace for every clock time, countdown and date number, with tabular figures so digits don't jitter as the countdown ticks. No webfonts — deliberate, for load speed on terminal wifi.

**Geometry:** 14px page gutter, 12–18px radii, 44px minimum tap target (`--tap`), respects `env(safe-area-inset-*)`.

**Breakpoints:** `640px` — filter/detail sheets become centred modals, type steps up. `740px` — floating pill aligns to the content column. That's it; the layout is single-column everywhere.

### Accessibility floor — please keep
- Every filled chip's text runs through `--on-fill`, which flips to dark ink in dark mode. All four operator tags measure **5.1–6.0:1** in light and **8.1–9.8:1** in dark. An earlier version had Horizon at 3.5:1 and dark-mode tags near 2.4:1.
- Body and secondary text stay above 4.5:1. `--muted` is only ~4.0:1 on white — it's fine for large or decorative text, **not** for row content.
- 44px minimum targets, visible `:focus-visible` rings, `aria-pressed` on filter chips, `role="tablist"` on the date strip, sheets are `role="dialog"` with focus handling and Escape-to-close, `prefers-reduced-motion` honoured.

---

## 8. Decisions already made (and why)

Reversing these is fine, but know what they cost:

- **Hero excludes its own sailing from the list.** It used to appear in both, immediately adjacent — pure duplication.
- **Closed check-ins collapse by default**, including boats that have not sailed, with a labelled section and a two-way toggle on the NOW divider.
- **One Filters button**, not one per category.
- **Arrival stays in the row** (`arr 12:20`) despite the same-clock-time confusion; the caption carries the explanation. A denser row that dropped it was tried and rejected as harder to scan.
- **Rows are roomy (72px), not compact.** Density was tried and reverted.
- **The origin terminal is de-emphasised, the destination bold** — origin repeats on nearly every row.
- **Count reflects what's on screen** ("67 still to go" while past are hidden), not the day's total.
- **No webfonts, no framework, no build step, no network calls at runtime.**

---

## 9. Worth designing next

Open, not decided:
- Public-holiday awareness — weekend timetables apply, but there's no holiday data
- Fares and operator booking links
- Offline / installable (PWA) — plausible given the audience and terminal wifi
- Bahasa Indonesia localisation — half the users are travelling the other way
- Whether interlined (`⇄ shared`) sailings should merge into one row rather than show twice
- Desktop above 680px is currently just a centred phone layout; a two-column or table view is unexplored

---

## 10. Technical constraints

Four files, no build: `index.html` (markup only), `styles.css`, `data.js` (schedules), `app.js` (logic). Opens straight from the filesystem; deploys by pushing to `main`.

**Asset URLs are versioned (`?v=15`) — bump on every CSS/JS change** or browsers serve stale files. This has already caused confusion twice.

Everything renders client-side from the hardcoded `D` array in `data.js`; there are no API calls, so the page works on a flaky connection once loaded.
