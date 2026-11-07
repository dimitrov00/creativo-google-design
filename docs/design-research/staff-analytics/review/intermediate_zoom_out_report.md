# Stage 8 — Intermediate Zoom Out: `docs/designs/staff-analytics.md`

- **Reviewer:** egm-zoom-out (fresh context), standard `zoom-out-standard.md`, full file (1–973),
  read against the Stage 5 report and the Stage 6–7 reports
- **Date:** 2026-11-07
- **Verdict:** Revise — 0 blockers, 5 majors, 9 nits.

Since Stage 5 the core got simpler and holds: one callable, rows inside the report, the link
through `setRoles`, `ChairTimeSystem` on top of `GridLayoutSystem`, shop reference and
first-visit return in v1.1. The three critic rounds then fixed edge cases by **adding** pieces —
a ten-part partition drawn almost whole on the phone, a second meaning of "open", a comparison
span computed for every figure but shown for one, a self-link exception in the role guard, a lock
document, and a rewrite of the client card's stored money. Each is locally right; together they
move the screen away from the brief's "few slices, defined, openable" and add work outside the
feature.

## Stage 5 findings

| #                                                | Status                            | Note                                                                                                                                               |
| ------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 shop reference                                | resolved                          | v1.1; the stale plan still lists it                                                                                                                |
| M2 build on `GridLayoutSystem`; open vs sellable | half resolved                     | structure fixed; partition **open** still counts future tails of holes no longer sellable, while **bookable open hours** uses `sellable` → Major B |
| M3 rows callable                                 | resolved                          | rows ride in the report                                                                                                                            |
| M4 link via `setRoles`                           | resolved, then grew               | lock document, link-only commit, admin self-link → Major D, Nit 1                                                                                  |
| M5 role sets                                     | resolved                          | `ANALYTICS_SELF`/`ANALYTICS_SHOP`, sysadmin excluded                                                                                               |
| M6 late cancellations                            | resolved                          | reuses `clientCaused` + `isLateCancellation`                                                                                                       |
| M7 first-visit return                            | resolved                          | v1.1, fixed figure                                                                                                                                 |
| M8 partition sum                                 | resolved as data, worse on screen | precedence stated; the bar draws 7 parts + 2 "still ahead" + 2 lines → Major A                                                                     |
| N1 stale text                                    | resolved                          |                                                                                                                                                    |
| N2 simplify cache                                | worse                             | 6 entries, 5-minute reuse, in-memory seat rows, shop exception, delete on refusal → Nit 4                                                          |
| N3 date helpers                                  | resolved                          |                                                                                                                                                    |
| N4 legacy handling                               | resolved                          |                                                                                                                                                    |
| N5 client card precision                         | resolved                          | raises the scope question in Major E                                                                                                               |
| N6 uncarved roster windows                       | resolved; simpler option exists   | → Nit 2                                                                                                                                            |
| N7 multi-location                                | resolved                          |                                                                                                                                                    |
| N8 7-day reads                                   | resolved                          |                                                                                                                                                    |

## Blocker

None.

## Major

### A. The time bar is back to the long list the brainstorm cut

- **Where:** L318–346, 120–123, 200–204, 461–465.
- **Evidence:** up to 11 labelled quantities for a barber reading between clients (CUJ 1); the
  brief and the brainstorm's converged v1 set at most four slices plus footnotes; "held" is a rare
  case with its own segment.
- **Recommendation:** keep the ten parts in `ChairTimeSystem` and the day rows; draw five
  segments (worked, no-show, unmarked, blocked, unsold) plus one "other" (held + short gaps) that
  opens to its parts in the day drill-down. Catalogue "time bar" row only; no system change.

### B. "Open" has two definitions

- **Where:** L331–335 vs L347; L131–133.
- **Evidence:** partition open = future part of any hole ≥ 20 min; bookable open hours = only
  holes still `sellable`. A hole 14:00–14:30 at 14:15: "still ahead: open" 15 min, the card 0.
- **Recommendation:** count a hole's future tail with under 20 minutes left as **unsold** (it can
  no longer be sold). Partition open then equals bookable open hours by construction; unsold +
  open is still the whole hole, so G5 holds.

### C. The comparison span is computed for every figure but shown for one

- **Where:** L365–371, 388–392, 353, 440–441, 461–463.
- **Evidence:** only the hero has a change chip; the report computes every figure's comparison,
  rebooked carries a comparison exclusion, the reads double departures and follow-ups for unshown
  figures; "counted up to the current minute" on a past day needs a fake `ShopNow`, and is
  undefined for takings (start or end of a seat?).
- **Recommendation:** compare the hero only — Σ takings of `WORKED` seats over the compared days;
  cut-off: a counterpart seat counts when it ends at or before the current minute. Drop the
  comparison from rebooked, time parts and the cost rows (only the prior period's visits are read).

### D. The admin self-link weakens a guarded rule and nothing reads it

- **Where:** L418–421 vs L296–297.
- **Evidence:** `RoleAssignmentSystem.decide` refuses a self-target first and its last-admin
  invariant relies on it (`role-assignment.system.ts:93-100, 132-134`); `offerOf` hides the roles
  block on one's own card (`:169`). An admin already gets the shop and every barber record;
  nothing reads an admin's `linkedBarberId`.
- **Recommendation:** drop the exception; the owner who cuts hair picks their barber record in the
  scope picker. Add a default "my chair" later with its guard change and spec.

### E. Rewiring the client card's stored money is scope creep

- **Where:** L381–387, 131–133, 505–506, 533, 667–670.
- **Evidence:** `moneyOf` already splits pro rata (`client-stats.system.ts:796-806`); the only
  difference is per-visit rounding (≤ 1 cent per visit). Matching it costs an edit, a projection
  version bump, a backfill, a risk row and a rollback caveat, for an agreement no screen shows.
- **Recommendation:** ship `MoneyAllocationSystem` for analytics only; restate G5's money half as
  "lifetime spend and the seat nets agree to within a cent per visit", pinned by the agreement
  spec; move `moneyOf` onto the shared split when the client card next changes.

## Nit

1. **The lock document may exceed v1's need** (L409–411, 426, 538): money is not a boundary; the
   lock guards a two-admin race in a 2–6 barber shop and does not catch the likelier error (the
   wrong record). Say why the race matters, or use a uniqueness check inside `setRoles` plus the
   link shown on the client card.
2. **Reuse `RosterSystem`'s exports** (L343, 375–376): `normalize(offeredWindows ∪
offeredCarveOuts ∪ offeredBreaks)` is the uncarved offered rostered time, shop filter included;
   no new export of `CARVE_NONE`. Confirm with a spec case.
3. **Schedule text contradicts itself** (L499–504): "code unchanged" then `?free=1`. State the
   one schedule change (`schedule-status-filter.ts` and the route).
4. **Cache rules inconsistent** (L488–492, 451, 539): the shop scope is not cached for its money,
   yet the admin's per-barber reports (the same money) are. Either the admin caches nothing, or
   every scope is cached keyed by uid and cleared on sign-out.
5. **Staging before measurement** (L493–495): the precedent staged sheets after measuring
   80–140 ms tasks; make the move to `libs/ui/layout` and the staging conditional on missing the
   16.7 ms budget (the dashboard library also has uncommitted changes).
6. **Too many writers named** (L406–408): only the creators (stub, complete-registration, seed),
   `setRoles` and erasure touch `linkedBarberId`; not `updateProfile`.
7. **Shop scope refetches on barber switch** (L258–259, 128–129, 466–469): show the barber's
   figures from the shop report at once and fetch only for seat rows; model it as a bounded
   per-barber array (Law 6: no dynamic map keys).
8. **The states table is broken Markdown** (L471–484): rows after
   `ANALYTICS_PERIOD_OUT_OF_RANGE` fall out of the table.
9. **Note for the plan** (L321–327, 377–380): `occupiedIntervals` returns merged ranges without
   seat identity; the worked > no-show > … order needs a per-seat sweep over `Seat.chairTime`,
   with `occupiedIntervals` used only for the holes.

## Author's note (Elephant)

The reviewer's point holds: rounds 1–3 answered each edge case by adding a mechanism. Majors B–E
and Nits 1, 2, 4, 6, 7 remove pieces; A changes only what the screen draws. Nit 8 is a formatting
defect from the round 3 splice (a table inside a list item). Applying these before Stage 9 gives
the plan rewrite a smaller target.

## Resolution (2026-11-07)

Applied before Stage 9: Majors A–E as recommended; Nits 2–9 as recommended. Nit 1 (the lock)
kept, with its reason now stated in the spec (two admins linking at once would show one barber's
figures to two accounts; one document read and write per role change).
