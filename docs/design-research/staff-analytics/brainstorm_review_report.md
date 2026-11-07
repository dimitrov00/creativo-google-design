# Staff analytics — brainstorm review report

- **Target:** `docs/design-research/staff-analytics/hypothesis.md` (lines 1-165, read in full)
- **Mode:** BRAINSTORM, 2026-11-07
- **Lenses applied by every reviewer:** (1) Contrarian / YAGNI, (2) Cost and quota, (3) UX,
  (4) Migration and correctness, (5) Observability, (6) Long-term maintenance, plus each
  reviewer's own persona.
- Line references `hyp:N` point to the hypothesis. Code paths are relative to the repository
  root. The synthesizer spot-checked the most-cited claims in code
  (`grid-layout.system.ts:28,275,286`, `firestore.rules:63,297`,
  `firestore.indexes.json:447-448`); all held.

## Reviewer status

| Reviewer                       | Role title                            | Status    | Raw count              |
| ------------------------------ | ------------------------------------- | --------- | ---------------------- |
| `egm-design`                   | Skeptical Architect Brainstormer      | completed | 17                     |
| `egm-codebase-details`         | Codebase Grounding Brainstormer       | completed | 2 B / 13 M / 8 N       |
| `egm-zoom-out`                 | Simplicity & Scope Brainstormer       | completed | 11 + cut list          |
| `egm-comprehension`            | UX & Comprehension Brainstormer       | completed | 3 B / 11 M / 5 N       |
| `egm-implementation-readiness` | Implementation Readiness Brainstormer | completed | 6 B / 12 M / 2 O / 5 N |
| `egm-structural`               | Document Structure Brainstormer       | completed | 4 B / 8 M / 2 L / 5 N  |

After deduplication: **10 Blockers, 18 Majors, 11 Nits.**

## Verdict

The problem statement (hyp:9-19) and the decision list (hyp:69-81) are sound and worth
building. The concept is not yet a design input, for three reasons:

1. **The storage sketch is upside down.** Rebuilding a whole month from source on every write
   costs 10-100 times more reads than folding on demand at the stated scale. It also stores
   figures that depend on the clock.
2. **The privacy model claims a boundary the data does not have.** Every barber and
   receptionist can already read every appointment, with prices and tips. No rule can tie a
   signed-in user to a `BarberId`.
3. **The core figures are undefined, or cannot be computed from what is stored.** This covers
   free time, fill, takings, rebooking and retention. The app already holds three different
   definitions of "free time", and the hypothesis adds a fourth.

Each of these can be fixed. The fixes are listed below, followed by a cut-down v1 that every
reviewer converged on.

---

## Blockers

### B1. No link from a signed-in user to a `BarberId`, so "a barber reads only their own" cannot be written as a rule

- **Lens:** Migration & correctness, rules (design, codebase-details, implementation-readiness)
- **Evidence:**
  - The visibility claim: hyp:50, hyp:150-151.
  - `firestore.rules:63-70` states that self-or-manager "is not expressible yet: `Barber`
    deliberately carries no `userId`".
  - `libs/ecs-core/src/entities/barber.entity.ts:13-27` has no user link.
  - The token holds only `tenantId`, `authStage` and `roles`
    (`libs/ecs-core/src/components/auth-claims.data.ts:44-48`).
  - The Monday digest (hyp:110-111) has no barber account to deliver to either.
- **Recommendation:**
  - Make the Barber↔User link a v1 prerequisite. Use either a `barberId` custom claim set by
    `setRoles` (`apps/functions/src/main.ts:1234`) or `barbers/{id}.accountUserId: UserId | null`.
    The claim avoids a `get()` on every rule check.
  - Specify:
    - who sets the link;
    - what a barber with no account sees;
    - how a user who is both admin and barber resolves.
  - Ship the rules unit test first.
  - Narrow `mayEditRoster()` in the same change, as its own comment asks.
  - Without the link, v1 ships admin-only.

### B2. The role split is presentation only: source appointments already show money to every barber and receptionist

- **Lens:** UX visibility model, privacy (all six reviewers)
- **Evidence:**
  - `firestore.rules:297` gives `allow read: if worksTheBook()` on `/appointments`.
    `worksTheBook()` covers barber, receptionist, admin and sysadmin (`firestore.rules:54-56`).
  - Seats carry `priceCents` and `tipCents` (`libs/ecs-core/src/components/seat.data.ts:99-101`,
    `seat-core.data.ts:30`).
  - The rules say the shared schedule needs this access on purpose (`firestore.rules:346-348`).
  - The drill-down (hyp:106-107) has to read these same documents.
  - The result: "receptionist does not see revenue" and "barber does not see colleagues"
    (hyp:50-51) are UI conventions, not security properties.
- **Recommendation:**
  - Ask the owner to rule, in an ADR, on one of two options:
    - **(a)** Accept v1 privacy as a presentation boundary among trusted staff, and say so in
      the doc.
    - **(b)** Scope appointment reads, or split seat money off the visit. This changes the
      shared staff schedule and is a separate, larger decision.
  - Either way, store any derived money in a `restricted/money` sibling document gated to
    `hasAnyRole(['admin'])` plus the owning barber. This copies the `clientStats` precedent
    (`firestore.rules:446-458`, `entities/collections.ts:106,121-122`). Rules cannot hide a
    single field.

### B3. The free-time taxonomy needs block reasons and paid flags that are never stored

- **Lens:** Migration & correctness (codebase-details, implementation-readiness, design,
  structural, comprehension)
- **Evidence:**
  - The taxonomy: hyp:87-89 ("paid breaks" count as blocked; unpaid breaks, days off and sick
    are excluded).
  - `ScheduleExceptionSystem.publicEffect` folds the reasons into effects when it saves
    (`libs/ecs-core/src/systems/schedule-exception.system.ts:154-170`):
    - CLOSED, TIME_OFF, SICK, TRAINING and TRAVEL all become `CLOSED`;
    - BREAK and ADMIN both become `BLOCKED`.
  - `breakPaid` and `sickPaid` exist only in the editor's memory
    (`components/exception-detail.data.ts:4-9`). This follows D16(b).
  - Roster breaks have no paid flag (`components/roster-break.data.ts:14-18`).
  - `RosterSystem.buildDayWindows` subtracts blocks from the windows
    (`systems/roster.system.ts:553-557`), so blocks leave the denominator. The hypothesis
    (hyp:87) and §4.1 say a block consumes sellable time.
- **Recommendation:**
  - Define v1 on what is stored:
    - **rostered** = windows with nothing carved out (export the module-private `CARVE_NONE`
      form, `roster.system.ts:174,256-259`);
    - **blocked** = `BLOCKED` ranges (`buildDayCarveOuts`, `:577-584`);
    - **excluded** = roster breaks, `dayBreakRanges` and `CLOSED` days.
  - Drop "paid vs unpaid break" from v1.
  - A reason or paid store needs an owner ruling that amends D16(b). It must be a staff-only
    sibling (sick time is GDPR Art. 9 data) and cannot be backfilled.

### B4. The time categories do not add up to the day

- **Lens:** UX, Migration & correctness (comprehension, structural, implementation-readiness,
  design, codebase-details)
- **Evidence:**
  - hyp:90 defines Free = rostered − worked − blocked − excluded:
    - no-show time is never subtracted, although hyp:97 says it is shown apart;
    - future booked visits are never subtracted, because "worked" means visits that happened
      (hyp:86);
    - excluded is subtracted twice if the rostered windows already omit breaks.
  - Padding:
    - hyp:86 counts padding as worked, while §4.1 and §4.2 (design doc lines 826 and 871) keep
      it separate;
    - capacity uses unpadded busy time plus turnaround (`systems/capacity.system.ts:31-41`);
    - the agenda uses padded `chairTime` (`systems/grid-layout.system.ts:216-241`).
  - Cancelled seats: `occupiedIntervals` skips only appointments whose overall status is
    cancelled (`grid-layout.system.ts:233`). A cancelled seat inside a live party still counts
    as occupying the chair.
  - Visits outside the windows are allowed (`roster.system.ts:536-541`), so free time can go
    negative.
  - A past `SCHEDULED` seat that was never closed belongs to no category.
- **Recommendation:**
  - State one partition with one denominator, Capacity = rostered − excluded, made of:
    - Worked (past, padding inside or a separate slice — decide which);
    - Booked (future);
    - No-show;
    - Unresolved (past, still `SCHEDULED`);
    - Blocked;
    - Unsold (past, bookable length);
    - Open (future, bookable length);
    - Slivers.
  - Report worked time outside the roster as a separate `overtimeMinutes`.
  - Free time never goes below zero.
  - A system spec asserts that the slices sum to capacity.
  - Show the partition as one stacked bar.

### B5. Free time already has three definitions in code, and the hypothesis adds a fourth

- **Lens:** Long-term maintenance, trust (zoom-out, design, codebase-details,
  implementation-readiness, comprehension, structural)
- **Evidence:**
  - Schedule holes drop anything under a fixed `SHORTEST_SELLABLE_MINUTES = 20`
    (`grid-layout.system.ts:28,275`). `sellable` is a single flag per hole, not a minute split
    (`:276-286`).
  - The day summary sums those holes (`staff-dashboard.ts:1751-1761`; that file has
    uncommitted changes).
  - The `capacity/{YYYY-MM}` projection holds free minutes after turnaround padding, with
    slivers included and no floor (`capacity.system.ts:126-132,184-189`). It is publicly
    readable (`firestore.rules:617-623`).
  - The hypothesis uses "the shortest service" as the floor (hyp:93-95).
  - The hypothesis itself names "totals disagree between screens" as the thing that breaks
    trust (hyp:130; `competitor-research.md:571-576`).
- **Recommendation:**
  - One pure `StaffDayFiguresSystem` (name to be chosen) owns the hole and sliver
    classification. It reuses `GridLayoutSystem.holes()` and `IntervalSetSystem`, not
    `sellableAt`.
  - The day summary, the week strip, Analytics and the drill-down all call it.
  - A spec asserts that they agree.
  - State whether `capacity` (the booking calendar) converges on the same rule or differs on
    purpose, and why.
  - Simplest v1, from zoom-out: Unsold = exactly the schedule's holes, with "gaps under 20 min
    not counted" said on screen; slivers deferred.

### B6. The monthly rebuild-from-source projection costs more than it saves, so it fails Law 5's read-fan-out reason

- **Lens:** Cost & quota (zoom-out, design, implementation-readiness, codebase-details)
- **Evidence:**
  - The sketch rebuilds the barber month and the location month on every appointment, block
    and roster write (hyp:146-149).
  - Indexes:
    - `barberIds` has its indexes switched off (`firestore.indexes.json:447-448`);
    - the only barber key is per day, `busyKeys` array-contains (`:64-75`);
    - `array-contains-any` accepts at most 30 values, so a 31-day month does not fit in one
      query.
  - Arithmetic at the stated scale (10 barbers × 15 visits/day), with figures independently
    close across four reviewers:

    | Item                                                                                      | Volume                                                                            |
    | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
    | Appointment writes                                                                        | ~600-750 a day                                                                    |
    | 3-year history                                                                            | ~140-164k appointments                                                            |
    | Barber-month rebuild                                                                      | ~400-450 reads per write → ~9M reads/month                                        |
    | Location month from appointments                                                          | ~3,900-4,500 reads per write → ~~88-170M reads/month (~~$30-100/month per tenant) |
    | On-demand reads instead (barber month + comparison ≈ 790 reads; admin shop month ≈ 7,800) | ~0.7-2M reads/month (< $1)                                                        |

  - Writes far outnumber opens, so a write-time projection loses.
  - Note: hyp:147's "~250 appointments" understates hyp:116's own 8-15 visits a day (~390 a
    month).
- **Recommendation:** pick one of three options and record it, with the arithmetic, as the
  Law 5 justification in a storage ADR.
  - **(a) Preferred for v1** (zoom-out, implementation-readiness): no projection. One callable
    reads, folds server-side with the pure system and returns a few KB.
    - It suits barber and admin scopes alike.
    - It enforces scope on the server, which partly answers B2.
    - It logs one line per call, which serves the success measures (M13).
    - Add a projection only when a year view is wanted.
  - **(b) If a projection is kept** (design): day grain,
    `staffAnalyticsDays/{barberId}__{localDate}`, keyed like `barberBusy`.
    - Rebuild from that day's ~15 appointments, decoding the before ∪ after busy keys as
      `rebuildBusyOnAppointmentChange` does (`main.ts:914-932`).
    - Months fold at most 31 day documents.
    - The location view is a read-time fold of at most 10 barber months.
    - Cost: ~60 reads per write, ~1M/month.
  - **(c) Hybrid** (implementation-readiness): the current month is live; closed months are
    projected and sealed after a grace period; late edits are picked up by a nightly sweep;
    the shop document is folded from barber documents, never from appointments.
  - In every option, add a change filter such as `statsInputChanged`
    (`client-stats.system.ts:1216-1273`) so that writes which do not affect the figures
    trigger nothing.
  - Write the per-open read budget into the doc.

### B7. Figures that depend on the clock cannot live in a projection rebuilt only on writes

- **Lens:** Migration & correctness (implementation-readiness, design, codebase-details)
- **Evidence:**
  - Unsold (past) vs open (future) (hyp:90-93), "open hours next 7 days" and "clients due
    back" (hyp:135-136) all change as time passes, with no write.
  - `sellableAt` splits on `now.currentMinute` (`grid-layout.system.ts:265-290`).
  - The capacity entity deliberately avoids wall-clock fields so its rebuilds stay
    deterministic (`entities/capacity-month.entity.ts:13-15`).
  - `clientStats` needed a projection clock for the same reason
    (`pipelines/project-client-stats.pipeline.ts:216-219`).
- **Recommendation:**
  - Store only geometry that does not depend on the clock: rostered, worked, blocked, no-show
    and hole minutes bucketed by length.
  - Split past from future at read time in a system that takes `ShopNow`:
    - days before today are past;
    - days after today are future;
    - today is split live.
  - Serve forward open time from the existing `capacity/{YYYY-MM}` or live `barberBusy`, not
    from a new projection.

### B8. "Takings" per barber is undefined and is not "what clients paid"

- **Lens:** Migration & correctness, reconciliation (all six reviewers)
- **Evidence:**
  - hyp:61-62 says "what clients paid … after discounts, before vouchers are netted".
  - No payment record is stored (`.claude/rules/ecs-components.md`: "No payment data is stored
    yet").
  - Discounts sit on the whole bill: `discounts[]` is on the appointment
    (`entities/appointment.entity.ts:62`), and `BillingSystem.totalOf` discounts the party
    subtotal (`systems/billing.system.ts:329-337`). No per-seat split exists, so a party
    served by two barbers has no rule for whose takings shrink.
  - `subtotalOf` sums every seat whatever its attendance (`billing.system.ts:303-326`).
  - A private pro-rata already exists in `moneyOf`
    (`systems/client-stats.system.ts:804-805`). It rounds each seat on its own, so the seats
    do not sum to the bill.
  - A private BGN→EUR helper exists, `inEuroCents` (`:677-681`).
  - The correctness gate (hyp:158) compares against cash and card records the app does not
    hold. Counting vouchers at full value means takings differ from cash and card by design.
- **Recommendation:**
  - Define takings in one exported pure system:
    - Σ `priceCents` of `WORKED` seats for the barber;
    - bill-level discounts allocated pro rata, with largest-remainder rounding, deterministic
      by `seatId`;
    - no-show and cancelled seats contribute 0;
    - BGN converted at the fixed 1.95583 rate.
  - Move `moneyOf`'s allocation and `inEuroCents` into that system, and use it from
    `ClientStatsSystem.money` too, so the client card and Analytics agree to the cent.
  - Word the figure "billed for completed visits" (BG: «Оборот»), not "paid".
  - Restate the gate as cash + card + voucher redemptions, compared by hand, and expect gaps
    from comps and unrecorded walk-ins.

### B9. There is no metric catalogue: fill, rebooking, retention, growth, demand and the hero figure are undefined

- **Lens:** Long-term maintenance (definition drift), UX (structural, comprehension,
  implementation-readiness)
- **Evidence:**
  - "Fill" (hyp:50,51,76) vs "utilisation" (hyp:25,131): §4.2 has two formulas (design doc
    lines 870-871), and the competitor research found four (`competitor-research.md:560-564`).
  - Rebooking (hyp:50) has three industry definitions (`competitor-research.md:565-570`).
  - "Growing" (hyp:73) and "demand" (hyp:74) are undefined. There is no hero figure per role
    (hyp:103).
  - The small-sample base "for example 20 visits" (hyp:120) does not say whether a visit means
    a seat or an appointment.
  - hyp:131 promises that "every figure must state its definition", and the doc does not yet
    keep that promise.
- **Recommendation:**
  - Add a versioned Metric Catalogue table, one row per figure, with these columns:
    - id;
    - plain-language definition;
    - formula over named fields;
    - base and unit (seat or appointment, minutes);
    - period semantics (shop zone, ISO week);
    - roles that see it;
    - the decision it drives;
    - small-sample rule;
    - drill-down target;
    - source fields, and whether they are captured today;
    - `definitionVersion`.
  - Name the hero figure per role:
    - barber: takings with tips as a second line;
    - receptionist: open hours over the next 7 days;
    - admin: shop takings.
  - Proposed definitions from the reviewers:
    - **Fill** = (Worked + Booked) ÷ Capacity, no-shows excluded, the same formula for past and
      future.
    - **Rebooking** = WORKED seats of known clients whose next appointment carries
      `bookedFromAppointmentId` = this visit ("booked before leaving").
    - **Retention** = clients new to the shop, from cohorts at least 60 days old. Younger
      cohorts show «още е рано».

### B10. The document mixes decisions, delegated picks, assumptions and hypotheses, and silently drops parts of §4

- **Lens:** Long-term maintenance, structure (structural, comprehension)
- **Evidence:**
  - hyp:4-5 promises a reason for each pick, but only §1-§2 (hyp:55-67) give one.
  - §6 "Expect" (hyp:116) is an assumption; §7 (hyp:132-140) holds hypotheses to test.
  - There is no Open Questions, Alternatives, Risks or phasing section, although
    `feature-spec-standard.md:13-24` makes alternatives and risks mandatory.
  - hyp:27-28 implies all of §4 is kept, yet:
    - the frozen `{capacity, productive, paid}` triple (§4.1 line 819) is gone;
    - training and travel exclusions (lines 830-831) are gone;
    - the padding split is changed;
    - §4.3's scheduled fold with `sourceVersions` (line 891) is replaced by a trigger fold;
    - §4.4 sealing (lines 928-929) is dropped.
  - hyp:39 cites §4.3 for rebuild by trigger, but §4.3 prescribes a scheduled fold.
  - The decision-to-figure rule (hyp:81) is not applied, leaving orphans in both directions:
    - tips, slivers, rebooking, the digest, CSV, week-strip hints and the shop average have no
      decision;
    - "overdue regulars" (hyp:72), "demand × hour" (hyp:74) and "growing" (hyp:73) have no
      figure;
    - "where bookings come from" (hyp:77-78) names no action.
- **Recommendation:**
  - Split the doc into sections: Owner-ruled / Delegated (reason + reversible?) / Assumptions
    (check) / Hypotheses (test) / Open questions.
  - Add a Decision → Figure → Surface → Role traceability matrix. Every orphan gets a decision
    or is cut.
  - Add a §4 supersession table (Kept / Changed / Dropped / N/A after ECS) as an ADR that
    amends `availability-and-statistics-design.md`, with a pointer from that file.

---

## Major

### M1. The "unnamed" shop figure reveals a colleague's exact figure in a 2-3 chair shop

- **Lens:** UX visibility, privacy (all six reviewers; comprehension rated it Blocker)
- **Evidence:**
  - hyp:50 shows barbers the shop average; hyp:55-56 says it is there to avoid friction;
    hyp:116 expects 2-10 barbers.
  - With 2 barbers, mine + average gives the colleague's figure exactly.
  - The drill-down rule (hyp:106) would open colleagues' visits.
  - Reading the per-location projection (hyp:146) would expose shop revenue.
- **Recommendation:**
  - A system shows the figure only when at least 3 other barbers had capacity in the period;
    otherwise a designed empty state.
  - Define it as "the others, excluding me, weighted by capacity minutes", and state whether
    it covers the location or the tenant.
  - Exempt it from the drill-down rule in writing.
  - Serve it from its own money-free document.
  - Zoom-out's alternative: cut it from v1, since it feeds no decision.

### M2. Past figures change silently, and nothing seals a month

- **Lens:** Migration & correctness (structural, design, codebase-details,
  implementation-readiness)
- **Evidence:** "recomputed from source" (hyp:148), combined with CSV for the accountant and
  payroll (hyp:112). Sources of silent change:
  - Any book role may write `scheduleExceptions` for any date, past dates included
    (`firestore.rules:608-614`). A barber can turn last week's unsold hours into blocked time
    after the fact. Roster callables refuse past days (`roster-week.system.ts:244-256`), so
    blocks are the exception.
  - `openingHours` has no version history (`entities/shop-location.entity.ts:33`) but clips
    windows (`roster.system.ts:551-552`). An hours edit restates every past month.
  - A late cancel with `cancellationWindowHours: null` is judged by the current policy
    (`components/seat-outcome.data.ts:40-44`), so a policy edit restates history.
  - §4.4 sealing is dropped (design doc 928-929), against the competitor finding "show late
    adjustments separately" (`competitor-research.md:501-502`).
- **Recommendation:**
  - v1 accepts restatement, but:
    - freeze each closed day's rostered, blocked and excluded geometry, so hours edits cannot
      rewrite it;
    - add a past-date guard on exception writes, or route them through an audited callable;
    - show «коригирано след …» lines.
  - Before v2 pay, adopt sealing with adjustment lines, and make CSV a snapshot carrying
    `exportedAtUtcMs` and `definitionVersion`.
  - Mirror the clientStats policy recompute pass (`main.ts:1084-1134`) for late-cancel counts.

### M3. Which writes invalidate which periods, and rebuild concurrency, are unspecified

- **Lens:** Migration & correctness, cost (implementation-readiness, design, codebase-details)
- **Evidence:**
  - hyp:148 says only "trigger on appointment, block and roster writes".
  - Location hours and settings writes are missing from that list.
  - An appointment is one shop day (`seat.data.ts:77-78`), so a reschedule touches at most two
    months.
  - Rosters are versioned (`components/schedule-version.data.ts:8-38`).
  - Ordering of overlapping rebuilds: clientStats reads and decides inside `ports.commit`
    (`project-client-stats.pipeline.ts:254-285`). A month-sized transaction would lock
    ~400-4,500 appointments and contend with `commitBooking`.
- **Recommendation:** write an invalidation table.
  - Appointment → (before ∪ after `barberIds`) × (before ∪ after month) × that seat's location.
  - Exception → one barber-day.
  - Roster → the version diff, past only (future figures are live, per B7).
  - Hours → none for frozen days.
  - Policy → months holding null-window cancellations.
  - Retention → month M stays dirty for 60 days.
  - Rebuild at day grain inside a small read-and-decide transaction, or read outside it and
    use a guarded `set` comparing `sourceDigest` (as `CapacitySystem.monthUnchanged` does).

### M4. If a projection is kept: its schema, the Law 5 TTL rule and multi-location splitting are unspecified

- **Lens:** Long-term maintenance, laws (implementation-readiness, design, codebase-details)
- **Evidence:**
  - hyp:146-151 gives no collection, id, fields or TTL position.
  - Law 5 bans `Record<ServiceId,…>` and `Record<DayKey,…>`, and says a projection is one "a
    TTL expires" (CLAUDE.md:145-152). That conflicts with 3-year history (hyp:119).
  - Today's TTLs: `barberBusy` 30 days, `capacity` 40 days, lead-time samples 400 days
    (`systems/retention.system.ts:30-39`), so history cannot be rebuilt from them.
  - A barber's day can span two shops (`roster.system.ts:546-551`).
  - Roles cover the whole tenant, with no per-location scoping (`auth-claims.data.ts:44-48`).
- **Recommendation:**
  - Get an owner ruling: analytics documents carry no TTL (a stated Law 5 exception), or they
    are rebuilt on read when missing.
  - Rebuild only from `appointments`, versioned `barberSchedules` and `scheduleExceptions`.
  - Shape, if kept:
    - `{period}__{locationId}__{barberId}` with flat totals;
    - bounded arrays (`days[]` ≤ 31, `services[]` sorted by `serviceId`, `weekHour[168]`) with
      `fieldOverrides indexes: []`, as `capacity.entries` does
      (`firestore.indexes.json:476-478`);
    - a `restricted/money` sibling.
  - Split rostered time by window `locationId` and visits by `appointment.locationId`. A spec
    asserts the sum over locations equals the barber total.

### M5. Nothing detects or traces a wrong number

- **Lens:** Observability (all six reviewers)
- **Evidence:**
  - The storage sketch has no reconciliation, no version stamp and no backfill.
  - The figure would read the projection while the drill-down reads the source, so users see
    a mismatch first.
  - Plumbing that exists: `retryingTrigger`/`settleAttempt` (`main.ts:915-932`), the
    `triggerFailures` dead letter (`collections.ts:94-99`), `BackfillJob` with only
    SUBJECT_MIRROR and CLIENT_STATS (`backfill-job-name.data.ts:10-15`), `sweepCapacityDaily`
    (`main.ts:1004-1008`), and `LogEvent` (`log-event.data.ts:32-33`).
- **Recommendation:**
  - Each stored figure set carries:
    - `definitionVersion`;
    - `sourceDigest`, a deterministic hash over (appointment id, revision), exception and
      roster-version ids, with no wall-clock stamp;
    - `sourceCount`;
    - `sliverThresholdMinutes`.
  - A `STAFF_ANALYTICS` `BackfillJobName` performs the first build and re-runs on every version
    bump. Re-running it is also the repair and rollback path.
  - A nightly sweep re-folds the trailing ~35 days, or a random sample of barber-months,
    logging a field diff on any mismatch.
  - Add `LogEvent` entries for rebuild failed / skipped / contended.
  - The drill-down re-folds its rows with the same system and asserts the result equals the
    shown figure. On a mismatch it shows «преизчислява се».
  - The admin gets "explain this figure": source documents plus definition version.
  - Invariant spec: day summary = analytics day = Σ drill-down = CSV row total, to the cent.
  - With option B6(a), most of this collapses to the invariant spec plus a log line.

### M6. Cut v1 to the decisions (YAGNI)

- **Lens:** Contrarian / YAGNI (zoom-out, design, structural)
- **Evidence:** hyp:81 says a figure that feeds no decision is out, yet:
  - custom periods and year view (hyp:102) are the most expensive to compute;
  - same-period-last-year (hyp:73,119) is empty for 12 months (hyp:117-118);
  - the digest's push has no infrastructure (no FCM or `PushManager` in `apps/` or `libs/`);
  - plain-language findings (hyp:138) need weeks of weekday × hour history;
  - the receptionist's two questions (hyp:79) are already answered by schedule holes,
    `capacity` and the waitlist (`firestore.rules:651-655`);
  - no CSV writer exists, and payroll is out of scope (hyp:163).
  - "Fuller than Fresha" (hyp:18) invites a breadth race against 50 reports
    (`competitor-research.md:27-31`), while the research's own gaps are depth: phone-first,
    period change, definitions, drill-down (`:544-579`).
- **Recommendation:** adopt the cut list in the appendix. Reword hyp:18 to "answers the
  barber's three questions at a glance on the phone and the owner's six decisions, every
  figure defined and openable".

### M7. Change against the previous period misleads while a period is still in progress

- **Lens:** UX (comprehension, zoom-out)
- **Evidence:** hyp:103, hyp:73 and hyp:119.
  - On 7 November, month-to-date always looks like a fall against the whole of October.
  - A week of leave reads as "−60%".
  - "72% → 68%" is ambiguous: −4 points or −5.6%.
  - "Up" is bad for unsold time.
- **Recommendation:**
  - Compare like with like, labelled: «спрямо 1-7 окт.».
  - Show rate changes in percentage points («п.п.»).
  - Set the good/bad colour per metric.
  - Offer a takings-per-capacity-hour line, so roster changes do not read as performance.
  - Show no badge when either base is below the small-sample floor.

### M8. The drill-down has no index, and time figures have no visits behind them

- **Lens:** Cost, UX (implementation-readiness, comprehension, zoom-out, design)
- **Evidence:**
  - "Every figure drills down to the visits" (hyp:106-107, hyp:134).
  - `barberIds` indexes are off (`firestore.indexes.json:447-448`); there is no
    `{locationId, localDate}` composite; `seats` is unindexed (`:431-434`).
  - Unsold, open, sliver and blocked time, and the shop figure, have no visits.
- **Recommendation:**
  - Specify each query:
    - barber month = `barberIds array-contains` + `localDate` range: remove the override and
      add the composite;
    - or two `busyKeys array-contains-any` queries of 30 keys or fewer, needing no new index
      (`libs/infrastructure/firestore/src/lib/appointments.adapter.ts:289-292`);
    - shop month = `locationId ==` + `localDate` range, with its composite.
  - Declare the indexes in the same change.
  - Service and no-show drill-downs filter the same page set inside the system that produced
    the figure.
  - Time figures open to days, then to gaps or blocks, each with a fill action.
  - Reuse `libs/features/shared/visits` (`visit-list`, `visits-browser`).

### M9. Small-sample honesty needs a base and floor per metric, decided in a system

- **Lens:** UX, maintenance (comprehension, implementation-readiness, design)
- **Evidence:**
  - hyp:120-121 gives "for example 20 visits" and "2 of 9".
  - At 8-15 visits a day, a weekly no-show rate passes 20 visits while resting on 2 events.
  - Under Law 10.2 the threshold is a decision, so it cannot sit in a presenter.
- **Recommendation:**
  - `SampleSystem.rateOrCount(numerator, base, minBase)` returns a tag. Bases:
    - no-show: worked + no-show seats;
    - cancellation: plus cancelled seats;
    - rebooking: worked seats of known clients;
    - retention: the matured cohort;
    - fill: at least 8 rostered hours;
    - per-service rate: that service's seats.
  - Consider a floor on the event count as well.
  - Always name the noun: «2 от 9 нови клиенти се върнаха».
  - Apply the rule to change badges and the shop figure.

### M10. Distinct and cohort metrics do not add up across months, and overdue regulars needs a disabled index

- **Lens:** Migration & correctness, cost (implementation-readiness, zoom-out, comprehension)
- **Evidence:**
  - "Week and year views fold the month and day figures" (hyp:149) does not hold for distinct
    clients, 60-day retention (hyp:77) or overdue regulars (hyp:72).
  - "First visit" is a whole-history property of `clientStats`.
  - The `lastVisitBarberIds` index is off (`firestore.indexes.json:866-869`).
  - Per-barber monthly new-client counts usually fall below the floor.
- **Recommendation:**
  - List which metrics are additive (minutes, counts, cents) and which are not.
  - Read retention and overdue from `clientStats` rather than re-deriving them.
  - v1: rebooking share per barber, plus first-visit return shop-wide as counts.
  - Overdue regulars in v1.1, with a deliberate index decision.

### M11. "Shortest service", walk-in origin and "demand" are not in the data

- **Lens:** Migration & correctness (codebase-details, implementation-readiness, zoom-out,
  comprehension)
- **Evidence:**
  - No per-barber shortest duration exists; only the 20-minute constant does
    (`grid-layout.system.ts:22-28`). Barber has no offerings (`barber.entity.ts:7-8`).
  - `placement` is SELF, STAFF or null (`components/placement-kind.data.ts:2-7`;
    `appointment.entity.ts:52-55`).
  - `WALK_IN` is a seat subject meaning "no account", not an arrival channel
    (`seat-occupant.data.ts:9-21`).
  - Lost demand (searches that found nothing) is not recorded, so hyp:74's "demand" is really
    booked fill.
- **Recommendation:**
  - Either define the threshold as the shortest online-bookable offering of that barber at
    that location, derived by a system and frozen into the figure, or keep the shop constant.
    Decide which.
  - Report origin as online / staff / unknown.
  - Add a walk-in origin tag at commit time only if the owner wants it; it cannot be
    reconstructed later.
  - Rename "demand × hour" to "fill by weekday" for v1.

### M12. The free-time taxonomy is too much for a phone glance, and the vocabulary is overloaded

- **Lens:** UX (comprehension, zoom-out)
- **Evidence:**
  - Eight categories (hyp:85-98) for a barber with 1-5 minutes between clients.
  - "Chair", "barber" and "shop" are used as one unit (hyp:35,50,51,76,146), which breaks for
    a barber working at two shops.
  - Terms such as departures, seat, rhythm, padding, late cancellation and "category" are
    undefined.
- **Recommendation:**
  - Show at most four slices: Работа · Неявили се · Блокирано · Свободно. Slivers become a
    sub-line; excluded time becomes a footnote.
  - Offer week (the default) and month only.
  - The unit is the barber, split by location.
  - Add a glossary with the Bulgarian label and a one-line definition for each term.

### M13. Two of the four success measures cannot be measured

- **Lens:** Observability (zoom-out, structural)
- **Evidence:**
  - There is no product analytics: no `logEvent` or `firebase/analytics` in `apps/web` or
    `libs/infrastructure`. "Opens weekly" (hyp:155) is therefore unmeasurable.
  - The digest open rate (hyp:157) depends on a surface that is cut.
  - "Unsold hours trending down" (hyp:156) is confounded by roster changes and seasonality.
  - The gate at hyp:158 has no tolerance.
- **Recommendation:**
  - Log one structured line per analytics call (uid, role, scope, period), which is free with
    B6(a).
  - Replace hyp:156 with "share of capacity left unsold".
  - Drop hyp:157.
  - Give hyp:158 an explicit tolerance and a list of expected gap causes.

### M14. The weekly digest has no scheduler zone, delivery channel or opt-out

- **Lens:** Cost, UX (implementation-readiness, codebase-details, comprehension, design)
- **Evidence:**
  - hyp:110-111.
  - Crons use the static `CRON_TIME_ZONE = 'Europe/Sofia'` (`apps/functions/src/lib/cron-zone.ts:1-11`).
  - There is no push infrastructure. Only a TTL'd `users/{uid}/notifications` exists
    (`collections.ts:104-105`).
  - The "three sentences" are not named, and a Monday that is a day off is not handled.
- **Recommendation:** defer the digest to v1.1, or ship it in-app only:
  - one `onSchedule` on Monday 08:00 in `CRON_TIME_ZONE`;
  - idempotent id `{uid}__digest__{isoWeek}`;
  - a system-computed body, worded on the client;
  - an opt-out field;
  - sent on the barber's first rostered day;
  - money-free for receptionists.
  - Push waits for v2.

### M15. CSV export is unspecified and carries client personal data

- **Lens:** Cost, privacy (implementation-readiness, comprehension, zoom-out)
- **Evidence:** hyp:112. A precedent exists in the `exportClientData` callable
  (`main.ts:1253`). Three years is ~140k rows.
- **Recommendation:** defer CSV to v2 with pay (zoom-out). If kept, use an admin-only callable
  with:
  - the same fold, so it reconciles by construction;
  - cents plus a decimal string;
  - pseudonymous client ids unless names are asked for;
  - an `auditLog` row per export;
  - a page cursor;
  - `definitionVersion` in the header.

### M16. The receptionist's scope contradicts itself and duplicates the existing `capacity` projection

- **Lens:** UX visibility, YAGNI (comprehension, codebase-details, zoom-out)
- **Evidence:**
  - hyp:51 gives "fill per chair" and "no-shows", yet forbids per-barber comparisons.
  - hyp:51 says "coming days"; hyp:79 says "today and tomorrow".
  - `capacity/{YYYY-MM}` already holds `freeMinutes` per barber-day
    (`components/capacity-entry.data.ts:8-25`).
  - Receptionists see every shop, because roles are tenant-wide.
- **Recommendation:**
  - The receptionist gets forward open time per chair, from `capacity` or the B5 system.
  - Past fill and no-shows are shown shop-level only.
  - Name the waitlist source (`waitlistRequests` by `waitlistStatus` + `localDates`,
    `firestore.indexes.json:166-178`).
  - Zoom-out's alternative: no receptionist analytics screen in v1.

### M17. Legacy and imported history has no roster, no marker and possibly BGN amounts

- **Lens:** Migration & correctness (design, codebase-details, comprehension,
  implementation-readiness)
- **Evidence:**
  - `versionFor` returns null before the first roster version (`roster.system.ts:263-264`),
    so legacy visits have no capacity.
  - There is no legacy-import marker anywhere.
  - `Currency` admits BGN (`primitives/currency.primitive.ts:7`).
  - `bookedAtUtcMs: null` rows are already excluded from lead-time figures
    (`appointment.entity.ts:91-96`).
- **Recommendation:**
  - Legacy months show money and counts only, with a designed "no roster recorded" state.
    Never show 0% or infinite fill.
  - Tag imported rows at import.
  - Convert BGN at 1.95583 in the shared helper (B8).
  - Say how null-stamp rows count toward small-sample bases.

### M18. v2 pay needs dated pay rules and sealed periods, and the v1 grain should not block it

- **Lens:** Long-term maintenance (design, structural)
- **Evidence:** hyp:64-67 gives no shape for the pay rule.
- **Recommendation:**
  - Pay rules carry effective dates, following the `ScheduleVersion` pattern
    (`barber-schedule.entity.ts:14-23`). The admin writes them; the barber reads their own
    (needs B1).
  - Earnings are a read-time pure system over figures that already carry takings per
    `serviceId` (a bounded array), with tips separate.
  - Pay periods seal, and late edits become adjustment lines.
  - v2 is gated on the hyp:158 reconciliation passing.
  - Choose the v1 grain now so that v2 needs no backfill.

---

## Nits

- **N1. `sysadmin` would see money.** `isAdmin()` covers admin and sysadmin
  (`firestore.rules:80-82`), while hyp:53 says sysadmin sees nothing. Gate money with
  `hasAnyRole(['admin'])`, as `restricted/money` does (`firestore.rules:456`).
  _(design; Migration & correctness)_
- **N2. Time zones and DST.** Build each location's `ShopNow` from its own zone; clientStats
  uses the default location's zone (`project-client-stats.pipeline.ts:89-93`). Use ISO Monday
  weeks in the shop zone. Keep late-cancel and lead-time math on `UtcEpochMs` (Law 7 T2).
  _(design, structural; Maintenance)_
- **N3. `tipCents: null` means "not recorded", not zero** (`seat-core.data.ts:16-18`). Show
  "tips not recorded on N visits". Tips are per seat, so reuse `BillingSystem.tipsOf`
  (`billing.system.ts:362-373`). _(codebase-details; Correctness)_
- **N4. Reuse the existing late-cancel judgement.** The outcome tag is `WORKED`, not
  "attended", and late cancellation uses the stored window or the current policy
  (`seat-outcome.data.ts:39-44`). Reuse `ClientStatsSystem`'s late-cancel logic and define
  "late" in the catalogue. _(codebase-details, comprehension)_
- **N5. hyp:35-36 rests on uncommitted work.** "Agenda now lists both" depends on uncommitted
  changes to `staff-dashboard.ts` (git status `M`). Also, `GridLayoutSystem` drops holes under
  20 minutes, so it does not show slivers today. _(codebase-details, implementation-readiness)_
- **N6. Volume estimate.** hyp:147's "~250 appointments" contradicts hyp:116's 8-15 visits a
  day (~390 a month); state the upper bound. _(zoom-out; Cost)_
- **N7. Retention window.** 60 days (hyp:77) differs from the ~90-day industry benchmark
  (`competitor-research.md:600`); justify the choice or align with 90. _(structural)_
- **N8. Lead-time samples expire.** They are TTL'd at 400 days (`collections.ts:38-39`), so
  any year-on-year lead-time figure loses its history. _(implementation-readiness)_
- **N9. "Worked" is booked length.** No finish time is recorded; say so in the info text.
  _(comprehension)_
- **N10. GDPR erasure.** State what happens to aggregates and the drill-down when a client is
  erased, and how a stale offline PWA display is labelled. _(structural)_
- **N11. Heading style.** "Storage sketch (to be tested by the review)" (hyp:142) is the only
  H2 with a status qualifier; move status into a per-section line. _(structural)_

---

## Where reviewers diverged

- **Storage.**
  - Zoom-out: no projection; an on-demand callable.
  - Design: a day-grain projection keyed `barberId__localDate`.
  - Implementation-readiness: current month live, closed months projected and sealed.
  - All three reject the month-from-source-per-write sketch. The synthesizer recommends
    B6(a) for v1, keeping B6(b) as the upgrade path when a year view is wanted.
- **Shop average.** Comprehension rated it a Blocker, zoom-out would cut it, and the rest
  rated it Major with a ≥3-others floor.
- **Receptionist surface.** Zoom-out would cut it; the others would keep it narrowed to forward
  open time.
- **CSV.** Design would keep it in v1; zoom-out and implementation-readiness would defer it to
  v2 with pay.

## Appendix A — converged v1 cut list

**Ship (barber and admin, one screen, week | month):**

1. **Hero:** takings to date vs the same elapsed span of the previous period. Tips are a
   separate line. Uses the B8 allocation.
2. **Time bar** (four slices): worked, no-show, blocked, unsold. Unsold equals the schedule's
   holes (B5); excluded time is a footnote.
3. **Open hours in the next 7 days**, from `capacity` or a live fold, with one tap to the
   emptiest day.
4. **By service:** count, takings, takings per worked hour.
5. **Rebooking share;** no-show and late-cancel shown as counts until the base is met.
6. **Admin:** the same figures per barber and shop-wide, fill by weekday, origin split
   (online / staff / unknown), and first-visit return shop-wide as counts.
7. **Drill-down** to visits (`shared/visits`) and to days for time figures.
8. **Plumbing:** one pure fold system, one callable, a log line per call, and the invariant
   spec.

**Defer (v1.1):** overdue regulars (needs an index decision), weekday × hour grid, the in-app
Monday card, the receptionist forward-open-time card, slivers with a per-barber threshold.

**Defer (v2, with pay):** CSV export, sealing, dated pay rules.

**Cut until evidence:** custom periods, year view, same-period-last-year, push,
plain-language findings, week-strip hints, the unnamed shop average (or keep it with the M1
floor), monthly per-barber and per-location projections, and the "fuller than Fresha" goal.

## Appendix B — next documents, in order

1. **Data-readiness audit.** Each figure: stored, in memory only, or absent. Covers B3, B8,
   M11 and M17.
2. **Owner ADRs:**
   - privacy boundary (B2) and the Barber↔User link (B1);
   - the D16(b) amendment, if a paid/reason store is wanted (B3);
   - the Law 5 TTL exception or rebuild-on-read (M4);
   - the §4 supersession table (B10).
3. **Metric Catalogue v1** with the traceability matrix (B9, B10, M9).
4. **Storage ADR:** alternatives, cost table, invalidation table, observability fields (B6,
   B7, M3, M5).
5. **Shared time-breakdown system spec** (B4, B5).
6. **Surface specs per role:** hero, cards, drill-down queries and indexes, empty and
   small-sample states (M7, M8, M12).
7. **Instrumentation and success-measure spec** (M13).
8. **v2 pay rule** (M18), gated on the reconciliation passing.
