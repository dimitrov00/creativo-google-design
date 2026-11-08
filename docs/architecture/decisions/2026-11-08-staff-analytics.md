# Staff analytics — computed on demand, a private account link, one catalogue of figures (2026-11-08)

> **Status: BUILT (PRs A, the link, B, C, D).** The design is
> [`docs/designs/staff-analytics.md`](../../designs/staff-analytics.md); its
> research and review reports are in
> [`docs/design-research/staff-analytics/`](../../design-research/staff-analytics/),
> and the review's code-level findings were closed PR by PR in
> [`implementation_checklist.md`](../../design-research/staff-analytics/review/implementation_checklist.md).
> This file records what was decided and why. Where the build differs from
> the design, the design was corrected to match.

## Decisions

| #   | Question                                        | Decision                                                                                                                                                                                                      |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Are figures stored?                             | No. One callable, `staffAnalytics`, computes a report for one scope and one period from the appointments, rosters and departures on every request. Nothing is written. The per-day figure set is the upgrade. |
| D2  | Where does "which barber is this account" live? | On the user record (`linkedBarberId`), with a private lock under the barber record (`barbers/{id}/restricted/link`). `setRoles` writes both in one transaction.                                               |
| D3  | What counts as rebooked?                        | A follow-up booked from the visit by the end of the next shop day, compared on shop dates. Not a 24-hour comparison of two stored instants.                                                                   |
| D4  | Who sees whose figures?                         | A barber sees their own record, the admin sees the shop and every barber. This is a product rule, not a security boundary: the appointments stay readable to every role that works the book.                  |
| D5  | Does the client card change?                    | No. It keeps its own per-visit rounding of the discount. It agrees with analytics' per-seat split to within one cent per worked seat.                                                                         |
| D6  | What may the device keep?                       | Figures and day rows, keyed by uid, scope and period. Never seat rows, which carry client names.                                                                                                              |
| D7  | What of the earlier statistics design (§4)?     | Kept, replaced and dropped item by item (below).                                                                                                                                                              |

## D1 — Computed on demand

The report is `StaffAnalyticsSystem.report` over `ChairTimeSystem.dayBreakdown`
(the partition of every rostered minute) and `MoneyAllocationSystem.seatNets`
(the bill's discount split over its seats). The pipeline reads the caller's
user record, the scope's visits by `busyKeys` (30 keys a query), the previous
period's visits for the hero, the next 7 days for the open-hours card, the
follow-ups, the rosters, the departures, the locations and the policy. It
derives each shop's `ShopNow` once and logs `AnalyticsReported` (counts and
minutes, never money).

Why not store figures:

- **Law 5 allows a derived value only for a privacy boundary, a read fan-out
  or a conflict set.** None applies. A barber-month is about 1,000 reads and a
  shop-month about 11,500; at the modelled opens that is about 3M reads a
  month for 10 barbers, about $2.
- **A stored monthly projection costs more.** Rebuilding it on every write
  reads the whole month: about 18M reads a month at 4,000 visit writes, six
  times the on-demand cost (design, Alternative A).
- **Several figures depend on the clock.** Unsold, open, unmarked and booked
  ahead change as time passes without any write, so a projection rebuilt on
  writes is wrong within the hour.
- **Counters are banned** for any displayed figure (the earlier design's
  §4.3): a duplicate or lost trigger leaves a number with no source to
  recompute from.

**The upgrade path** is the per-day stored figure set,
`barberId__localDate` (design, Alternative C): one small document per
barber-day, rebuilt by a trigger, with a TTL. A year view reads at most 366 of
them. **Its trigger** is either of:

- the shop-month callable's p95 exceeds its 4 s budget for a week
  (`AnalyticsReported.durationMs`, in Cloud Logging); or
- the year view, same-period-last-year or custom ranges are built (v1.2).

Until then a week or a month is computed whole on each open.

## D2 — The account link, its lock and `setRoles`

`barbers/*` is publicly readable, so an account id stored there would publish
every staff uid. The link is a flat slice of the user record,
`StaffLink = { linkedBarberId: BarberId | null }`, readable by its owner and
the roles that work the book and written only by audited callables. A lock
document, `barbers/{barberId}/restricted/link = { linkedUserId }`, is read
and written in the same `setRoles` transaction as the user's field, so two
accounts can never hold one barber record. `firestore.rules` names the lock
(`match /restricted/link`) and allows nothing: it is callable-only.

There is no token claim for the link: claims are minted only at sign-in, so a
link made later would wait for the next sign-in, and the callable reads the
user record anyway for the stored roles.

`setRoles` carries the link (`RolesCall.barberLinkChange`: `KEEP`, `SET` or
`CLEAR`; an absent wire field reads as `KEEP`). The decision table, in
`RoleAssignmentSystem.linkOf`:

| Roles                           | Link                               | Outcome                                          | Writes                                  | Audit row        | Sessions                                                |
| ------------------------------- | ---------------------------------- | ------------------------------------------------ | --------------------------------------- | ---------------- | ------------------------------------------------------- |
| unchanged                       | unchanged                          | nothing to do                                    | none                                    | none             | revoked (S-L-15: a retry finishes a revoke that failed) |
| unchanged                       | set or changed                     | link changed                                     | user field, new lock, old lock released | one, link fields | revoked (S-L-15: `setRoles` revokes after every call)   |
| unchanged                       | cleared (barber kept)              | link changed (barber, not linked)                | user field, lock released               | one              | revoked (S-L-15)                                        |
| barber added                    | set                                | roles and link changed                           | roles, user field, lock                 | one              | revoked                                                 |
| barber added                    | absent or null                     | refused `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`  | none                                    | none             | —                                                       |
| barber added or kept            | a record that does not exist       | refused `GOVERNANCE_ROLES_BARBER_UNKNOWN`        | none                                    | none             | —                                                       |
| no barber role after the change | set                                | refused `GOVERNANCE_ROLES_LINK_WITHOUT_BARBER`   | none                                    | none             | —                                                       |
| barber removed                  | any                                | roles changed, link cleared                      | roles, user field, lock released        | one              | revoked                                                 |
| other roles changed             | unchanged                          | roles changed                                    | roles                                   | one              | revoked                                                 |
| any                             | a record locked to another account | refused `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED` | none                                    | none             | —                                                       |

The rules around it:

- An admin cannot change their own link: the roles guard refuses every
  self-target, which its last-admin rule relies on. An admin who also cuts
  hair finds their own record first in the scope picker as «Аз».
- An account holding the barber role with no link is "barber, not linked"
  (CUJ 6) until an admin links it, and sees that state on the screen.
- A retired barber record keeps its link, and its history stays reportable.
- Blocking an account does not clear the link; removing the barber role does.
- Erasure never meets a link: it refuses staff accounts, and a linked account
  holds the barber role.

## D3 — Rebooking on shop dates

A visit A counts in the rebooking base once its window has ended (A's shop
date + 1 day is before today), when it has at least one `WORKED` seat of the
barber's. It is rebooked when a follow-up F has
`F.bookedFromAppointmentId = A.id`, F's booking shop date is at most A's shop
date + 1 day, and F is not `CANCELLED` at report time.

The pipeline converts each follow-up's `bookedAtUtcMs` to its shop's date
once, at its boundary (`ZonedTimeSystem.toLocal`), as Law 7 allows for
ingestion. The rule then compares `LocalDate`s only.

Why not Square's "within 24 hours of the visit ending": it compares two
stored instants, and comparing stored instants is allowed only for the
elapsed-time rules on Law 7's closed list (flatten-spec §2.3 T2), which does
not include it. Adding it would widen the list for one figure. "Same shop
day" (Boulevard) misses a client who books from home that evening after a
late visit; "any later visit" (Fresha) measures retention, not rebooking.

## D4 — Visibility is a product rule

The visibility table (nine rows, `StaffAnalyticsSystem.scopeOf`, pinned in
`staff-analytics.pipeline.spec.ts`) is judged on the caller's **stored**
roles, block and link, after the barber records are read: a blocked account
sees nothing; an admin sees the shop or any known record (an admin who also
cuts hair is judged as admin and opens on the shop); a linked barber sees
their own record; a barber with no link is `ANALYTICS_BARBER_NOT_LINKED`;
every other role, the sysadmin included, is `ANALYTICS_FORBIDDEN`.

It is a rule about this screen, not a security boundary around money. The
visit sheet shows the bill to every role that works the book by design, and
the appointments stay readable to all of them. Making money a boundary would
change every read port, the billing system, the visit editor and the client
card (design, Alternative F). It is revisited only if pay arrives (v2).

## D5 — The client card keeps its own rounding

`ClientStatsSystem.money` rounds a client's share of a visit's discount once
per visit; `MoneyAllocationSystem.seatNets` splits it per seat by largest
remainder, so the nets sum to the bill exactly. A visit with n worked seats of
one client may differ by up to n cents. The client card and its stored
projection are unchanged; `moneyOf` moves onto the shared split the next time
the client card changes.

The bound is proven, not assumed:

- a fast-check property in `money-allocation.system.spec.ts`; and
- the G5 agreement spec, `staff-analytics.agreement.spec.ts`, over one
  fixture month (`@core/testing` `analytics.fixtures.ts`): every client's
  card spend against their seats' nets, a client with three worked seats on
  one visit and a leva visit included. The three-seat client differs by one
  cent; every other client by none.

The same spec proves G5's other two agreements: for every one of the
fixture's 90 barber-days, the schedule's day-summary free minutes (the
dashboard's chain, reproduced in ecs-core and run through `StaffDayStore`
itself in the dashboard library's spec of the same name) equal the report's
unsold + open; and every drill-down's rows add up to the figure it opens
from, for every `AnalyticsFigure`.

## D6 — The device cache holds no client names

The screen paints the cached report first, then always asks for a fresh one.
The cache is `localStorage` behind `AnalyticsCachePorts`, one entry per
(uid, scope, period), at most 6, under
`creativo.analytics/<definitionVersion>/<uid>/<scope>/<period>`. It holds the
figures and the day rows only: seat rows carry client names, so they stay in
memory and a drill-down on a cached report says they come with the update.
The cache is cleared on sign-out, on an account switch
(`SessionIdentityService`) and on a refusal; a quota error is ignored. A
raised `definitionVersion` invalidates every entry.

There is no reuse window ("skip the call if the cache is under 5 minutes
old"): it would compare stored instants outside Law 7's T2 list.

## D7 — The earlier statistics design (§4 of `availability-and-statistics-design.md`)

| §4 item                                                      | Fate     | Why                                                                                                           |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| Blocks count in capacity; breaks and closed days do not      | Kept     | Fill = (worked + no-show + unmarked) ÷ (rostered − break); a block is a choice that consumes sellable time    |
| No `FieldValue.increment` for a displayed figure (§4.3)      | Kept     | Recompute is idempotent; a counter drifts with no source                                                      |
| No-show and cancellation rates, per seat (§4.2, §4.5)        | Kept     | `Seat.outcome` made them computable; no-shows rate per seat from a base of 20                                 |
| Rebooking from `bookedFromAppointmentId` (§4.2)              | Kept     | Captured at booking; the window is D3's                                                                       |
| Holds are not occupancy (§4.6)                               | Kept     | No hold enters the partition                                                                                  |
| Storage tiers: day totals in the write, period rollups       | Replaced | Computed on demand (D1); the per-day figure set is the upgrade                                                |
| Sealing past days (§4.4)                                     | Replaced | Not in v1: figures are recomputed, so a late edit restates them; sealing comes with pay (v2)                  |
| The reason taxonomy and `{capacity, productive, paid}`       | Dropped  | D16(b) stores only a departure's effect (`CLOSED` / `BLOCKED`); sick leave is health data (Art. 9)            |
| Buffers as their own part; chair-time utilisation            | Dropped  | Setup and cleanup sit inside the seat's chair time; no v1 decision needs them apart                           |
| `DayEvent` lists for cancellations and reschedules (§4.4)    | Dropped  | A cancelled seat keeps its outcome and its busy keys, so late cancellations are read from the visits          |
| RevPAH, effective hourly rate, average ticket, fragmentation | Dropped  | v1 shows takings per hour of service per service and short gaps; the rest waits for a decision it would serve |
| BigQuery export (Tier 3)                                     | Dropped  | Not needed; CSV export is v2                                                                                  |

## What was built

| PR             | Branch                     | What                                                                                                                                              |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (#39)        | `feat/analytics-core`      | The refusals, `ChairTimeSystem`, `MoneyAllocationSystem`, the report types, `StaffAnalyticsSystem` and the visibility table                       |
| the link (#40) | `feat/barber-account-link` | `StaffLink`, the lock, `setRoles`' link outcome and audit fields, the client card's barber picker, the rules and seed                             |
| B (#41)        | `feat/analytics-server`    | The ports, the `staffAnalytics` pipeline, the bounded Firestore adapter, the callable and its wire                                                |
| C              | `feat/analytics-screen`    | The «Анализи» route, menu row, presenter, device cache, drill-downs and the schedule's `?free=1`                                                  |
| D              | `feat/analytics-wrap-up`   | The G5 agreement specs and their fixture month, the e2e `staff-analytics.spec.ts`, this record, the design's corrections and the closed checklist |

## Rollout and rollback

Deploy `firestore.rules`, `firestore.indexes.json` (the two `fieldOverrides`
of the link) and the functions first, then the web app. Between the two, an
older client card that grants the barber role without a link is refused
`GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`; grant the role after the web deploy.
Rollback removes the route and the menu row. `staffAnalytics` stays deployed
but uncalled, and `setRoles` keeps requiring and writing the link and its
lock; device caches are ignored.
