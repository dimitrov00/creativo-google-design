# Stage 5 — Initial Zoom Out: `docs/designs/staff-analytics.md`

- **Reviewer:** egm-zoom-out (fresh context), standard `zoom-out-standard.md`, full file (1–809)
- **Date:** 2026-11-07
- **Verdict:** Revise — 0 blockers, 8 majors, 8 nits.

The goal and its motivation are clear and argued; the core shape (no projection, one pure fold
on the server, one discount allocation, one time breakdown) is the right simple one and follows
the brainstorm's converged v1 and Laws 3/4/5/7. The problems are at the edges: several pieces
re-invent what the codebase already has (a second callable, a linking callable, a late-cancel
rule, moving code out of `GridLayoutSystem`), two v1 figures cost much more than stated or show
nothing at the default periods (shop reference, first-visit return), and the role sets drift from
the existing `Roles` vocabulary.

## Blocker

None.

## Major

### M1. The shop reference turns every barber request into a whole-shop request

- **Where:** lines 253, 274–278, 316, 325–326, 386, 508–510.
- **Evidence:** the reference averages "the other barbers of the tenant", computed on the server,
  so a barber's report reads every colleague's appointments, rosters and departures — the
  admin's ~10,000-read set, not ~700. At 10 barbers opening daily that is ~3M reads a month, not
  ~0.5M, and the barber's latency becomes the shop's. It answers no question in The Problem; the
  brainstorm's zoom-out lens put it under "cut until evidence"; with a three-colleague floor most
  2–6 chair shops never see it.
- **Recommendation:** move it to v1.1 (drops the floor logic, the field and its specs), or
  restate the barber cost row as a shop fold and recompute the monthly total and latency.

### M2. Build `ChairTimeSystem` on `GridLayoutSystem`, don't move code out of it; "open time" breaks the sellable rule

- **Where:** lines 242–243, 262–267, 357–358, 598–614, 759–763.
- **Evidence:** items 11/40 leave `GridLayoutSystem` members that only forward to the new system
  — what `creativo/no-identity-mapper` reports. They also touch the schedule's minute-tick path
  for no gain; item 41 would run a full `dayBreakdown` on that tick. The day summary already sums
  whole holes ≥ 20 minutes (`GridLayoutSystem.totalMinutes`), so unsold + open equals it by
  construction if Analytics uses the same holes. And "open = the part from now on of every hole ≥
  20 minutes" counts tails with under 20 minutes left, which `sellableAt` marks unsellable (owner
  ruling 2026-11-05).
- **Recommendation:** `ChairTimeSystem` imports its sibling `GridLayoutSystem` and calls
  `occupiedIntervals`, `holes`, `sellableAt` as they are; drop items 11, 40, 41; keep the
  dashboard on `totalMinutes` and let the agreement spec prove equality; define open time as the
  future part of holes still `sellable`, the rest counts as unsold.

### M3. `staffAnalyticsRows` re-reads and re-folds everything

- **Where:** lines 195–197, 279, 318, 583–587, 632, 668, 696.
- **Evidence:** each drill-down tap costs the full report's reads again (~700 / ~10,000) and adds
  a command, decoder, port member, adapter path, log event and export, while the rows already
  exist inside the report's fold.
- **Recommendation:** return the rows with the report (day rows always, ≤31; visit rows for a
  barber, ~300 small rows) and filter them on the client with a pure `rows` function; for the
  shop scope drill down per barber, or add an optional `figure` to the one callable.

### M4. Linking should extend `setRoles`, not add `linkBarberAccount`

- **Where:** lines 292–310, 387, 594, 672–677, 693–694, 738–739.
- **Evidence:** `set-roles.pipeline.ts` is already admin-only (`Roles.ASSIGN`), one transaction
  reading caller and target, writes `profileEditedAtUtcMs` and one audit row, and the client card
  already calls it. A separate callable leaves a gap: removing the barber role via `setRoles`
  leaves `linkedBarberId` behind. The doc also lets the sysadmin link (line 387), but
  `Roles.ASSIGN` deliberately excludes the vendor's support role (`roles.data.ts:96-104`).
- **Recommendation:** add `linkedBarberId` to `RolesCall` (required when granting barber, cleared
  when removing it), add the "already linked" check to `RoleAssignmentSystem.decide`, put the
  picker where roles are set. Drops a callable, a pipeline, `StaffLinkSystem`,
  `planBarberLinked`, two error codes and the link sheet.

### M5. The role gates invent a new set and give the sysadmin shop money silently

- **Where:** lines 330, 384–388, 693–694, 748.
- **Evidence:** "barber, admin or sysadmin" is not a set in `roles.data.ts`, which keeps one home
  per role set and a test syncing it with the rules. `Roles.SPEND` (`[Admin]`) keeps client money
  from the sysadmin on purpose; the design gives the sysadmin every barber's and the shop's
  takings without saying so. `Roles.MONEY` says "never a barber" (it is about spending the shop's
  money), which a reader will see as a contradiction with barbers seeing their takings.
- **Recommendation:** name one set (e.g. `Roles.ANALYTICS`) in `roles.data.ts`, used by route,
  wire and menu; record an explicit sysadmin decision in the ADR; add a sentence that seeing
  billed takings is not `MONEY`.

### M6. Late cancellations get a second definition

- **Where:** line 250.
- **Evidence:** the catalogue counts `cancelledBy = CLIENT` inside `cancellationWindowHours`. The
  client card's rule differs three ways: blame also from the reason
  (`ClientStatsSystem.clientCaused`), a seat with no stored window judged by current policy
  (`ClientStatsPolicy.isLateCancellation`), and `bookedAtUtcMs: null` rows excluded. Two meanings
  of "late cancel" is what G5 exists to prevent.
- **Recommendation:** reuse `clientCaused` and `isLateCancellation`; add the policy read to the
  read plan and cost table.

### M7. First-visit return is empty at the default periods and its reads are uncounted

- **Where:** lines 252, 577, 636–638, 652.
- **Evidence:** a cohort counts only after 60 days, so "this month" and "last month" are always
  empty; it needs visits up to 60 days after the period plus `clientStats` reads, neither in the
  read plan nor the cost table.
- **Recommendation:** defer to v1.1, or make it one fixed figure independent of the period
  ("clients first seen 60–90 days ago: n of m came back") with its reads costed.

### M8. "The parts always sum" is under-defined

- **Where:** lines 237–245, 255–258, 283, 607–610.
- **Evidence:** worked and no-show are summed per seat while holes come from merged occupied
  time; staff may place overlapping seats, so per-seat sums can exceed merged time. A seat
  crossing a block has no rule for the overlap. `occupiedIntervals` skips only fully cancelled
  appointments (a cancelled seat in a live party still occupies), while the catalogue says
  "every non-cancelled seat". The identity names "open-today" though Open is defined over 7
  days.
- **Recommendation:** define every part on the merged timeline with a stated precedence (e.g.
  block > worked > no-show > not closed > booked ahead); pick one cancelled-seat rule and make
  `GridLayoutSystem` follow it; restate the per-day identity in the catalogue's names.

## Nit

- **N1. Stale text.** Q1, Q2 and Q5 are answered in the body; the diagram still says
  `barbers (names, accountUserId)`; Alternative E says "the callable reads the barber document".
- **N2. Simplify the cache.** One entry per scope; a version in the key OR an ignore-older check,
  not both; clear it on sign-out (a shared shop device would keep the admin's shop report).
- **N3. Reuse date helpers.** `LocalDate.startOfWeek` / `startOfMonth` exist
  (`local-date.primitive.ts:252,262`).
- **N4. Legacy handling vs greenfield.** BGN conversion, the `inferredPlacement` fallback (which
  `appointment.entity.ts:54` says is "never promoted") and Q4 handle legacy data the repo says it
  does not have. Drop them or state what legacy data exists.
- **N5. Precision on the client card.** The allocation change alters stored
  `clientStats/*/restricted/money`; note the re-seed or `CLIENT_STATS` backfill. The agreement
  spec proves a shared allocation, not two matching visible numbers; say so in G5.
- **N6. Missing file.** "Roster windows before carve-outs" needs the uncarved form, private today
  (`CARVE_NONE`, `roster.system.ts:174`); add the `RosterSystem` change.
- **N7. Multi-location.** Q6 is open while the read plan already assumes the tenant; state v1's
  answer (shop = tenant) or scope reads by `locationId`.
- **N8. Uncounted reads.** The open-hours card always reads the next 7 days of appointments and
  departures; add them to the read plan and cost table.

## Author's note (Elephant)

Spot-checked: `Roles.SPEND = [Admin]`, `Roles.ASSIGN = [Admin]`, `Roles.MONEY` excludes the
barber, and `LocalDate.startOfWeek/startOfMonth` exist — the cited facts hold. M2, M3 and M4 are
simplifications that remove code from the plan; M1 and M7 move two figures to v1.1; M5, M6 and
M8 are definition gaps that the catalogue has to close before Stage 9.
