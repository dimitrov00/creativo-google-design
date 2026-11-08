# PR 4b — the year read, measured

- **Design:** `docs/designs/staff-analytics-v2.md`, plan item 82; the budgets in Non-Functional
  Requirements (callable p95 ≤ 1.5 s for a barber on any span, ≤ 4 s for the shop; `DAY` ≤ 1 s)
  and the Alternative O decision (a month document if the shop-year misses its budget).
- **Date:** 2026-11-09 · **Branch:** `feat/analytics-v2-read`
- **Scripts:** `dist/start-recompute.mjs` (a full-reach pass through the job document),
  `dist/perf-year.mjs` (ten opens per case; the `staffAnalytics` round trip timed from the
  request event to `requestfinished`).

## Setup

- The dev server (`pnpm run dev`) against the emulators with the dev seed: **3 barbers**, the
  seed's visits; `analytics.storedDays` on (the development map).
- A full-reach recompute first: 1,122 keys checked, 1,037 day documents written, 0 failed,
  12 steps, **24.1 s** wall time in the functions emulator (the e2e's run of the same pass:
  1,114 written).
- Signed in as `dev-staff-ivan` (barber + admin); each open a fresh navigation (the device
  cache paints first, the callable is asked on every open — the measured call).

## Results (emulator, 3 barbers)

| Case                       | runs | min    | median | p95        | max    |
| -------------------------- | ---- | ------ | ------ | ---------- | ------ |
| shop-year (`YEAR`, shop)   | 10   | 106 ms | 120 ms | **213 ms** | 213 ms |
| barber-year (`YEAR`, one)  | 10   | 50 ms  | 60 ms  | **68 ms**  | 68 ms  |
| shop-month (`MONTH`, shop) | 10   | 39 ms  | 71 ms  | **166 ms** | 166 ms |

The shop-year reads ≈ 3 × 313 day documents (the year so far) plus the live days' visits and the
7 ahead days; the barber-year ≈ 313 documents. Both sit an order of magnitude under their
budgets on the emulator.

## Reading the numbers against production

- The emulator answers in single-digit milliseconds per document; production Firestore adds
  network latency per query round trip, not per document (one range query per scope). The
  design's 10-barber shop-year is ~3,650 documents — ≈ 3× this seed's read, so ≈ 0.6–0.8 s is
  the straight extrapolation, well inside 4 s.
- The answer stays ≤ ~100 kB: the year's `reportDayRows` are per barber-month (12 × barbers),
  not per day.

## Decision

**Alternative O (a month document) is not needed.** The shop-year and the barber-year meet their
budgets with room; the next measurement is after the production deploy, on the real shop
(`docs/production-deploy.md`, the day documents' rollout bullet). If the production shop-year
p95 crosses 4 s, Alternative O is the recorded next step, as the design says.
