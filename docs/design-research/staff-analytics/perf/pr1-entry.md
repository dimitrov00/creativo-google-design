# PR 1 — the schedule's way into «Анализи», measured

- **Design:** `docs/designs/staff-analytics-v2.md`, plan item 14 and the open question
  «`RouteReuseStrategy` for the schedule?».
- **Date:** 2026-11-08 · **Branch:** `feat/analytics-v2-entry`
- **Script:** `./pr1-entry.mjs` (Playwright + CDP tracing; the command is in its header).

## Setup

- The optimised build (`web:build:csp-smoke` — production minus the environment
  replacement and the service worker) served by the Hosting emulator on `127.0.0.1:5050`,
  the Auth, Firestore, Functions and Storage emulators behind it, the dev seed loaded.
- Chromium, 390 × 844 viewport at 3×, CPU throttled **4×** through CDP after the schedule
  is on screen and idle (so the analytics chunk's idle prefetch has run).
- Signed in as `dev-staff-ivan` (barber + admin), on `/staff/schedule?view=agenda&barber=ivan`
  for today.
- **Forward:** `performance.now()` at the chart button's click → the first paint that holds
  `analytics-title`. **Back:** `history.back()` → the schedule's day label and chart button
  present again. Each window also lists the longest main-thread tasks (`RunTask`) the trace
  recorded and counts the Firestore requests (`:8080`) issued on Back.
- Three runs: one cold (first visit to the analytics page in the session), two warm (the
  page was opened once before, so its report is cached).

## Before the reuse strategy (the entry alone)

| run  | forward tap → title | longest tasks (ms) | Back → schedule | longest tasks (ms) | Firestore requests on Back |
| ---- | ------------------- | ------------------ | --------------- | ------------------ | -------------------------- |
| cold | 116 ms              | 32, 24, 11, 10, 5  | 103 ms          | **57**, 7, 6, 6, 4 | 5                          |
| warm | 154 ms              | 32, 27, 19, 19, 18 | 121 ms          | **64**, 11, 8, 8   | 6                          |
| warm | 121 ms              | 25, 19, 14, 12, 9  | 95 ms           | **52**, 9, 7, 6, 6 | 8                          |

Back re-mounted the schedule: one 52–64 ms task at 4× (three to four frames on a
mid-range phone) and five to eight Firestore requests for the day the user had just left.
That is the design's trigger for the one-route detach/attach strategy.

## After the reuse strategy (`apps/web/src/app/schedule-reuse.strategy.ts`)

| run  | forward tap → title | longest tasks (ms) | Back → schedule | longest tasks (ms) | Firestore requests on Back |
| ---- | ------------------- | ------------------ | --------------- | ------------------ | -------------------------- |
| cold | 140 ms              | 42, 28, 14, 12, 8  | 81 ms           | 42, 7, 4, 4, 1     | **0**                      |
| warm | 150 ms              | 55, 23, 21, 20, 18 | 67 ms           | 41, 6, 5, 4, 3     | **0**                      |
| warm | 102 ms              | 28, 21, 18, 17, 13 | 80 ms           | 44, 9, 4, 1, 1     | **0**                      |

Back now re-attaches the parked tree: no reads at all, 67–81 ms to interactive, and the
longest task is the router's own transition work (41–44 ms at 4×, ≈ 10 ms unthrottled)
rather than the schedule's construction. The forward path is unchanged within run-to-run
noise (the 55 ms task appeared in one of six forward windows, before and after alike).

## Decisions

1. **`RouteReuseStrategy` — added.** Back's re-mount dropped frames by the design's rule
   (a task over 16.7 ms at 4×), so `ScheduleReuseStrategy` parks the `staff/schedule`
   component tree on leaving and re-attaches it on return — one detached handle, keyed on
   the route path alone; every other route keeps the default. The parked tree is destroyed
   the moment the signed-in account changes (sign-out, another staff member on the same
   phone), so it never serves the next principal. Spec:
   `apps/web/src/app/schedule-reuse.strategy.spec.ts`.
2. **The morph — not kept; the root cross-fade stays.** The forward transition already
   carries main-thread tasks over 16.7 ms at 4× (the analytics page's first render, 25–42 ms)
   without any shared element, so a `view-transition-name` pair between the chart button and
   the headline cannot meet the design's condition and was not built. The house cross-fade
   (`::view-transition-old/new(root)` in `apps/web/src/styles.css`) is the transition.
3. **Prefetch.** The analytics chunk is fetched on idle from the schedule
   (`prefetchAnalytics()` in `libs/features/staff/dashboard/src/lib/staff-dashboard/analytics-entry.ts`,
   a dynamic import on `requestIdleCallback`), so the cold tap pays no chunk download; the
   cold and warm forward figures differ only by the report's cache.

## Caveats

- The emulators answer in single-digit milliseconds; production Firestore and the callable
  add network latency to the report's arrival, not to the first frame these windows measure.
- The trace's frame events carry no durations in this Chromium build, so "a dropped frame"
  is read from main-thread task length (a task longer than 16.7 ms blocks at least one
  frame), the stricter reading.
- Measured on an M-series Mac at 4× throttle; a phone test is the design's later gate.
