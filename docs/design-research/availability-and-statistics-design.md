# Availability & Statistics — Unified Design

**Status:** architecture ruling, supersedes the Phase-3 sketch in `docs/design-research/booking-flow-architecture.md:101-108`
**Author:** lead architect, folding five research reports
**Date:** 2026-07-29

---

## 1. The one-paragraph shape

Every barber has one document per calendar day. That document holds two things and only two things: **the working windows they were rostered for that day** (frozen, materialised from an immutable effective-dated schedule version), and **the intervals of that day that are already spoken for** (busy). Nothing in it knows what a haircut costs or how long one takes. To find bookable times you read the day documents of the eligible barbers, subtract busy from working, and slide the duration you actually need — resolved _now_, per barber, via `Service.termsFor(barberId, variantId)` — across the gaps that are left. To answer "why was Ivan busy on 14 July", you read the staff-only sibling of the same document, where each busy interval carries a typed reason, a frozen `{capacity, productive, paid}` classification and its attributed revenue. **The same artefact answers "when can I book?" and "how utilised is Ivan?" — that is the whole design.** Because the document stores _facts_ (windows, intervals) and never a _computation_ (a slot list), changing a service's duration cannot stale it and changing a barber's hours only requires re-materialising a bounded window of future days. It is written inside the booking transaction, by the Admin SDK, and never by a browser.

---

## 2. The central decision

### 2.1 The choice: **free/busy intervals as the truth, materialised as per-(barber, day) fact documents. No materialised slot lists, anywhere, ever.**

Three candidate models were on the table:

|                        | A. Query `appointments` live | B. Materialised **slot** grid        | **C. Materialised free/busy intervals** |
| ---------------------- | ---------------------------- | ------------------------------------ | --------------------------------------- |
| Day read (3 barbers)   | ~20 docs + a composite index | 3 × 48 = 144 docs                    | **3 docs, by ID, no index**             |
| Month markers          | ~600 docs                    | ~4,300 docs                          | **1 doc**                               |
| Hours change (30d)     | free                         | rewrites ~8,640 docs                 | **rewrites ~90 docs**                   |
| Duration change        | free                         | **invalidates everything, silently** | **free**                                |
| Anonymous `/book` read | **impossible** (see 2.2)     | possible                             | **possible**                            |
| Per-barber statistics  | not expressible (see 2.3)    | impossible (reasons discarded)       | **a pure fold**                         |

### 2.2 Why not A (derive on read from `appointments`) — it is _unimplementable_, not merely slow

Firestore rules cannot redact fields. A rule that grants read on `appointments/{id}` grants **the whole document**, and `toPersistence` writes `seats[].subject.userId` and `seats[].subject.label` — where `SeatLabel` is literally `'Walk-in 14:30'` (verified at `libs/domain/scheduling/src/lib/seat.ts:36`). `/book` is deliberately unguarded (ruling #3), so an anonymous visitor must be able to compute a slot grid. Any rule permissive enough to let them do that publishes every client's identity and booking time to the internet.

This is a forcing function, not a preference. **A separate, PII-free projection is mandatory.** Everything else about the projection's shape is then merely a good idea.

> **RULING against `failure-modes`.** That report argues "availability is DERIVED; do not create a busy-blocks collection mirroring appointments" (R5.1). Its concern — orphans, drift, partial writes — is legitimate and is addressed head-on in §6.5. But it did not weigh the anonymous-read constraint, and derive-on-read cannot satisfy it. The projection is therefore adopted **with the property `failure-modes` actually demands preserved**: the projection has _no independent truth_. `Appointment` remains the truth for service time, `ScheduleException` for absence time, `StaffScheduleVersion` for windows. Every writer of the projection is a **convergent recompute from those sources**, never a delta. A projection with no independent existence cannot drift; it can only lag, and lag is detected by `detectProjectionDrift` and repaired by `rebuildBarberDays`.

### 2.3 Why not B (materialised slots) — force (a), durations change

A bookable _start_ is a function of duration. A free window 09:00–10:30 admits starts at 09:00…10:00 for a 30-minute service but only up to 09:45 for a 45-minute one. And in this codebase duration is not a property of a service: `Service.termsFor(barberId, variantId)` resolves down two axes with total fallback (verified, `libs/domain/catalog/src/lib/service.ts:368-374`), and the seed proves the axis is live — Ivan's classic cut is 35/50 min, Niko's 30/45, Stefan's flat 45 (`tools/seed-dev-catalog.mjs:233-237`).

So a correct materialisation key is `barberId × day × serviceId × variantId`. For 3 barbers × 60 days × 8 services × ~2 variants that is ~2,880 regenerated documents **per catalog edit**, and the failure mode when you get it wrong is silent: after a 30→45 change the stored 09:30 start is still _a_ start, just no longer one that fits. The grid offers a slot that fails at commit.

**Intervals are duration-agnostic.** That single property is exactly what makes them immune to force (a). Combined with the already-correct decision that `Seat.terms` is a commit-time snapshot, the past and the future are cleanly decoupled: history is what the snapshot says, the future is what the current catalog says, and neither can rewrite the other.

> **Corollary, stated so nobody builds it later:** do **not** add temporal versioning to the catalog for statistics. The seat snapshot _is_ the historical record. The catalog stays current-only.

### 2.4 Why intervals survive force (b), schedules change

Intervals alone do not solve this — a schedule change genuinely does invalidate future windows. Two mechanisms do:

1. **The truth is an append-only, effective-dated version series.** `StaffScheduleHistory` holds `StaffScheduleVersion { seq, effectiveFrom, effectiveTo, pattern }`, non-overlapping, exactly one in force per day. Editing "from next Monday" closes the current version at Sunday and appends a new one. **A past version is never mutated.** So "what were Ivan's hours in March" is answerable forever, and every historical utilisation denominator is stable by construction.
2. **A schedule change triggers a bounded convergent re-materialisation** of the affected _future_ days only (`onScheduleWritten`). Since the projection is derived and the recompute is total, extending hours regenerates windows just as correctly as shrinking them deletes them — the failure mode that kills invalidation-only cache strategies does not arise.

Days already materialised in the past are never touched, because their in-force version is immutable. That is the whole answer to "editing hours silently rewrites every past utilisation figure" (`statistics` calls this the single highest-impact hazard; it is).

> **RULING, synthesising `statistics` vs `engine-patterns`/`failure-modes`.** `statistics` wants windows _frozen_ onto each day doc; `engine-patterns` and `failure-modes` want _effective-dated immutable versions_ and derivation. These solve the same problem twice. Adopt **both, with a division of authority**: the version series is the truth (author-time), the day doc's `windows` are a materialised projection of the version in force. Because past versions are immutable, re-materialising a past day is _idempotent_ — which gives `statistics` its frozen denominator and `firestore-ops` its convergent recompute, with no contradiction. Retroactive amendment is refused by `StaffScheduleHistory.amend` (§3.6).

### 2.5 What happens to the owner's previous "day availability per barber"

**The container is kept and promoted to the spine of the design. The contents are replaced.**

The owner's instinct — _one thing per barber per day_ — is correct and is the single most load-bearing decision here. It is what makes per-barber statistics a document read instead of a query, what gives write isolation (two barbers never contend, two days never contend), and what makes "is Ivan free at 14:00" a doc-ID `get` with no index.

What changes is what lives inside it:

| Owner's original                                     | This design                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| a list of **bookable start times**                   | **working windows + busy intervals**                                        |
| keyed on `(barber, day)` and implicitly one location | keyed on `(barber, day)`, `locationId` carried **per window and per block** |
| duration baked in                                    | duration resolved at read time from the live catalog                        |
| stale on any catalog edit                            | immune to catalog edits                                                     |
| "unavailable" with no reason                         | every busy interval carries a typed reason (staff-only projection)          |

> **RULING against `firestore-ops` on the key.** It proposed `availabilityDays/{locationId}__{barberId}__{date}`. Rejected: `Barber.locationIds` permits several, so a barber working two shops in one day gets two documents, neither aware of the other, and a booking at shop A does not block them at shop B. **A barber is one person; the key is `(barberId, day)`.** `locationId` rides on each window and each block. `statistics` is right on this one.

> **RULING against `engine-patterns` on the key.** It proposed `locations/{id}/busy/{dayKey}` — one doc per _location_-day — arguing a 3-barber month view costs 90 reads instead of 30. Rejected on two grounds: (a) it locks every barber at a location behind one document inside the booking transaction, which serialises all bookings at a shop; (b) the month-view read cost is solved properly by `locationMonths/{loc}__{YYYY-MM}`, which is **1 read for the whole month**, better than either per-day option.

### 2.6 Every disagreement between the five reports, resolved

| #   | Disagreement                                                                                                       | Ruling                                                                                                                                                                   | Why                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Projection or derive-on-read (`firestore-ops`/`statistics`/`repo-audit` vs `failure-modes`)                        | **Projection**                                                                                                                                                           | Rules cannot redact fields; anonymous `/book` cannot read `appointments`. `failure-modes`' anti-drift property is preserved via convergent recompute + rebuild + drift detector.                                         |
| 2   | Projection written by **trigger** (`repo-audit`) or **inside the commit transaction** (`firestore-ops`)            | **Transaction is authoritative; trigger is a reconciler**                                                                                                                | Firestore v2 triggers are at-least-once and _explicitly unordered_. A trigger-maintained projection has a read-your-writes hole a second booker falls through. No amount of trigger idempotency closes it.               |
| 3   | Doc key: `(loc, barber, day)` vs `(barber, day)` vs `(loc, day)`                                                   | **`(barber, day)`**                                                                                                                                                      | See 2.5.                                                                                                                                                                                                                 |
| 4   | Public doc: geometry-only (`statistics`) vs geometry + minute scalars (`firestore-ops`)                            | **Geometry + scalars that are _derivable from the geometry_**                                                                                                            | `busyMinutes` leaks nothing beyond a public `busy` array. Anything **not** derivable from geometry (reason, ids, revenue, counts) is banned.                                                                             |
| 5   | Reason taxonomy: 7 (`repo-audit`) / 8+origin+outcome (`statistics`) / 9 (`failure-modes`) / 11 (`engine-patterns`) | **`statistics`' 8 arms, walk-in demoted to `origin`, no-show to `outcome`**                                                                                              | A `walk_in` arm would fork every "productive time" sum for a thing that occupies time identically. A `no_show` arm would have to re-carry every field of `service` and lose the client linkage the no-show report needs. |
| 6   | Policy clamps as **persisted** virtual busy intervals (`engine-patterns`)                                          | **Engine-internal only, never persisted**                                                                                                                                | The elegance is real — one primitive, one loop — so keep it _inside_ `solveDay`. But persisting a "too soon" interval would make yesterday's ledger un-recomputable and pollute utilisation.                             |
| 7   | Buffer semantics: sum vs max                                                                                       | **Pad each persisted busy interval by `turnaround` on both sides; never pad the candidate. Zero turnaround between two seats of the _same_ party served by one barber.** | `engine-patterns` is right and the second half is the important half: uniform padding silently kills sequential party arrangements, the headline case of ruling #1.                                                      |
| 8   | `Seat.slot` stored vs derived                                                                                      | **Derived from `(start, terms)`**                                                                                                                                        | `failure-modes` R1.1. A seat currently states its duration twice with nothing reconciling them. Derive, and the disagreement becomes unrepresentable.                                                                    |
| 9   | Processing gaps / `capacity > 1`                                                                                   | **Occupancy is a list, defaulting to one full-duration block. Barber capacity stays exactly 1.**                                                                         | `engine-patterns`. `capacity: 2` would also permit two overlapping haircuts. Adopt the _shape_ now (the invariant change is cheap today, expensive under a live schedule step), defer the data.                          |
| 10  | Holds: now (`engine-patterns`, `failure-modes`) or measure first (`firestore-ops`)                                 | **Shape decided now, shipped in Phase 7**                                                                                                                                | The day-doc shape must reserve room for holds or adding them later is a migration. But they are not on the critical path to a working booking.                                                                           |
| 11  | Month rollup inside or outside the transaction                                                                     | **Outside**, single-field-path merge                                                                                                                                     | Inside, every booking at a location serialises behind one document. This is the single most likely future regression; §6.3 pins it with a comment and a test.                                                            |
| 12  | Slot cache                                                                                                         | **None in Phase 3.** If ever added: keyed on `availabilityVersion`, advisory only, behind the transactional re-check.                                                    | `engine-patterns`. Stale entries must be _unreadable_, not require correct invalidation across five writers.                                                                                                             |

---

## 3. Domain model

Layering constraints that bind (verified in `eslint.config.mjs`): `type:domain` may depend only on `type:domain`; `luxon` may be imported **only** from `libs/domain/kernel/**`; `firebase/*` only from `libs/infrastructure/**` or `apps/functions/**`. Therefore **the entire engine lives in `libs/domain/scheduling`, is pure, takes `nowMs: number` as an explicit argument (never a `Clock`), and runs byte-identically in the browser and in the Cloud Functions CJS bundle.** That last property is what makes the server-side re-check _the same code_ as the client grid.

### 3.1 Kernel: the six missing time operations

`libs/domain/kernel/src/lib/zoned-date-time.ts` — additions. Every one is a one-line Luxon delegation, preserving the swap-the-library boundary.

```ts
/** How to resolve a wall-clock time that a DST transition made non-existent or ambiguous. */
export type DstResolution =
  | 'reject' // default everywhere in scheduling
  | 'shiftForward' // gap → the instant one offset later (Luxon's silent default, now opt-in)
  | 'earlier' // ambiguous → the first occurrence (pre-transition offset)
  | 'later'; // ambiguous → the second occurrence

export interface ZonedDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export class ZonedDateTime {
  /**
   * Build from wall-clock parts. DST is an EXPLICIT, TESTED decision here —
   * see §7 rows 3-4. Verified against Europe/Sofia 2026-03-29 / 2026-10-25.
   */
  static fromParts(
    parts: ZonedDateTimeParts,
    zone: string,
    resolution?: DstResolution, // default 'reject'
  ): Result<
    ZonedDateTime,
    InvalidDateTimeError | NonexistentLocalTimeError | AmbiguousLocalTimeError
  >;

  static fromMillis(
    ms: number,
    zone: string,
  ): Result<ZonedDateTime, InvalidTimeZoneError>;
  static min(a: ZonedDateTime, ...rest: ZonedDateTime[]): ZonedDateTime;
  static max(a: ZonedDateTime, ...rest: ZonedDateTime[]): ZonedDateTime;

  /** Local midnight in THIS instant's zone. The grid origin — never the epoch. */
  startOfDay(): ZonedDateTime;
  /** Local midnight of the NEXT calendar day (EXCLUSIVE bound; the Sofia spring day is 23h). */
  startOfNextDay(): ZonedDateTime;
  /** Same calendar day, given wall clock. The ONLY way to turn "monday 09:00" into an instant. */
  atTime(
    hour: number,
    minute: number,
    resolution?: DstResolution,
  ): Result<ZonedDateTime, DateTimeResolutionError>;

  toMillis(): number;
  minutesUntil(other: ZonedDateTime): number; // exact elapsed, from instants
  equals(other: ZonedDateTime): boolean;
  toISODate(): string; // 'YYYY-MM-DD' — TimeSlot.calendarDayKey delegates here
}
```

**The DST detection algorithm, verified this session against Luxon + Europe/Sofia:**

```ts
const dt = DateTime.fromObject(parts, { zone });
// GAP: Luxon silently relocates a non-existent local time and leaves isValid true.
const isGap =
  dt.hour !== parts.hour || dt.minute !== parts.minute || dt.day !== parts.day;
// AMBIGUOUS: the same wall clock one hour later is the SECOND occurrence.
const shifted = dt.plus({ hours: 1 });
const isAmbiguous =
  !isGap && shifted.hour === dt.hour && shifted.minute === dt.minute;
```

Empirically confirmed:

| input (Europe/Sofia) | Luxon result  | `isGap`  | `isAmbiguous`                     |
| -------------------- | ------------- | -------- | --------------------------------- |
| `2026-03-29 03:30`   | `04:30+03:00` | **true** | false                             |
| `2026-10-25 03:30`   | `03:30+03:00` | false    | **true** (second = `03:30+02:00`) |
| `2026-07-29 03:30`   | `03:30+03:00` | false    | false                             |

Also confirmed: the Sofia spring day is **23 hours**, the autumn day **25**; `plus({days:1})` preserves wall clock (calendar arithmetic) while `plus({minutes:n})` is exact elapsed. Those two are _not_ interchangeable and each has exactly one correct use — iterating a day range, and advancing within a service duration.

`libs/domain/kernel/src/lib/zoned-date-time.errors.ts` gains `NonexistentLocalTimeError`, `AmbiguousLocalTimeError`, `DateTimeResolutionError` (the union).

### 3.2 Interval algebra — the only shape the engine computes on

`libs/domain/scheduling/src/lib/interval.ts` — **epoch-millisecond half-open intervals.** Convert once at the boundary, do all algebra on integers, convert back once. This removes DST from the inner loop entirely.

```ts
export interface Interval { readonly startMs: number; readonly endMs: number; }

export const Interval = {
  of(startMs: number, endMs: number): Interval | null,        // null when empty/inverted
  fromSlot(slot: TimeSlot): Interval,
  toSlot(i: Interval, zone: string): Result<TimeSlot, TimeSlotError>,
  lengthMinutes(i: Interval): number,
  overlaps(a: Interval, b: Interval): boolean,                // a.startMs < b.endMs && b.startMs < a.endMs
  abuts(a: Interval, b: Interval): boolean,                   // a.endMs === b.startMs
  contains(outer: Interval, inner: Interval): boolean,
  pad(i: Interval, beforeMin: number, afterMin: number): Interval,
  clampTo(i: Interval, bounds: Interval): Interval | null,
} as const;

/** INVARIANT: sorted ascending by startMs, pairwise disjoint, no empty members, merged on touch. */
export type IntervalSet = readonly Interval[];

export const IntervalSet = {
  /** Drop empty, sort by (startMs, endMs), fold merging when next.startMs <= acc.endMs.
   *  The `<=` is load-bearing: for half-open intervals [9,10) and [10,11) are ADJACENT
   *  with zero free time between, so they are one interval. */
  normalize(xs: readonly Interval[]): IntervalSet,

  /** Two-cursor sweep. The OUTER index advances only past FULLY consumed busy
   *  intervals, because one busy interval can span several free windows
   *  (a whole-day time-off block over a split shift). Linear after the sort. */
  subtract(free: IntervalSet, busy: IntervalSet): IntervalSet,

  intersect(a: IntervalSet, b: IntervalSet): IntervalSet,
  union(a: IntervalSet, b: IntervalSet): IntervalSet,
  totalMinutes(xs: IntervalSet): number,
  longestMinutes(xs: IntervalSet): number,
  /** Clip every member to a day boundary — the ONE helper every per-day statistic goes through. */
  clipToDay(xs: IntervalSet, dayBounds: Interval): IntervalSet,
} as const;
```

`libs/domain/scheduling/src/lib/time-slot.ts` — additions, kept to exactly what the engine provably needs:

```ts
export class TimeSlot {
  /** Total: `minutes` is a positive integer by `ServiceTerms` invariant. */
  static fromDuration(start: ZonedDateTime, minutes: number): TimeSlot;
  durationMinutes(): number;
  abuts(other: TimeSlot): boolean;
  toInterval(): Interval;
  // create() now REJECTS a non-existent local time — see §7 row 3.
}
```

### 3.3 Calendar day and local time of day

`libs/domain/scheduling/src/lib/calendar-day.ts`

```ts
/** 'YYYY-MM-DD' in a named zone. Replaces ad-hoc day strings everywhere. */
export class CalendarDay {
  static create(key: string): Result<CalendarDay, InvalidCalendarDayError>;
  static from(instant: ZonedDateTime): CalendarDay;
  readonly key: string;
  weekday(): Weekday; // ISO 1..7, matches ZonedDateTime.weekday
  plusDays(n: number): CalendarDay;
  isBefore(other: CalendarDay): boolean;
  equals(other: CalendarDay): boolean;
  /** Local midnight → next local midnight in `zone`. 23h or 25h on DST days. */
  bounds(zone: string): Result<Interval, DateTimeResolutionError>;
}
```

`libs/domain/scheduling/src/lib/local-time-of-day.ts` — the `HH:mm` regex + lexical compare lifted out of the dying `WorkingHours`, plus `'24:00'` as an explicit end-of-day sentinel.

```ts
export class LocalTimeOfDay {
  static create(raw: string): Result<LocalTimeOfDay, InvalidTimeOfDayError>; // /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/
  readonly value: string;
  minutesFromMidnight(): number;
  isBefore(other: LocalTimeOfDay): boolean;
  /** Materialise against a calendar day. `'24:00'` resolves to the next day's midnight. */
  on(
    day: CalendarDay,
    zone: string,
    resolution?: DstResolution,
  ): Result<ZonedDateTime, DateTimeResolutionError>;
}
```

> **RULING: no overnight windows.** `to < from` is rejected. A shop open 22:00–02:00 is two windows on two days (`22:00→24:00`, then `00:00→02:00`). This keeps the algebra simple and matches the day-doc partition, which has to happen anyway.

### 3.4 Weekly pattern — replaces `WorkingHours`

**`libs/domain/scheduling/src/lib/working-hours.{ts,errors.ts,spec.ts}` is DELETED**, along with its two barrel exports. It is dead code (grep confirms only its own spec references it), it permits exactly one window per weekday so a lunch break is unrepresentable, it holds no date and no zone, and it is attached to no aggregate. The byte-identical twin in `libs/domain/models` **stays** — it is load-bearing for the legacy `Staff` aggregate.

`libs/domain/scheduling/src/lib/weekly-pattern.ts`

```ts
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO, Monday = 1

export interface DayWindowProps {
  readonly from: string;
  readonly to: string;
  readonly locationId: string;
}

export class DayWindow {
  readonly from: LocalTimeOfDay;
  readonly to: LocalTimeOfDay;
  readonly locationId: LocationId; // per-window: a barber may work two shops in one day
}

/**
 * INVARIANTS (enforced by `create`, per weekday):
 *   - every window has from < to
 *   - windows are sorted ascending by `from`
 *   - windows do NOT overlap (they may abut — that is one continuous shift)
 * A weekday absent from the map means "not rostered", which is NOT the same
 * as "rostered and took the day off" — see §4.2.
 */
export class WeeklyPattern {
  static create(
    entries: Partial<Record<Weekday, readonly DayWindowProps[]>>,
  ): Result<WeeklyPattern, WeeklyPatternError[]>;
  windowsFor(weekday: Weekday): readonly DayWindow[];
  toEntries(): Readonly<Partial<Record<Weekday, readonly DayWindowProps[]>>>;
}
```

### 3.5 Roster window and the day's geometry

`libs/domain/scheduling/src/lib/roster-window.ts`

```ts
export interface RosterWindow {
  readonly interval: Interval; // materialised instants, location-clamped
  readonly locationId: LocationId;
}
```

### 3.6 Effective-dated schedule

`libs/domain/scheduling/src/lib/staff-schedule.ts`

```ts
export class StaffScheduleVersion {
  readonly barberId: BarberId;
  /** Monotonic per barber. NEVER derived from array length — blueprint §7.7. */
  readonly seq: number;
  readonly effectiveFrom: CalendarDay;
  readonly effectiveTo: CalendarDay | null; // EXCLUSIVE; null = open-ended
  readonly pattern: WeeklyPattern;
  readonly authoredAtMs: number;
  readonly authoredBy: UserId | null;

  static create(
    props: StaffScheduleVersionProps,
  ): Result<StaffScheduleVersion, StaffScheduleError[]>;
  coversDay(day: CalendarDay): boolean;
}

/**
 * INVARIANTS: all versions share one `barberId`; sorted ascending by
 * `effectiveFrom`; pairwise non-overlapping; `nextSeq` strictly greater than
 * every existing `seq`. Gaps between versions are LEGAL and mean "not employed".
 *
 * PAST VERSIONS ARE IMMUTABLE BY CONSTRUCTION. `amend` refuses an
 * `effectiveFrom` at or before `today` — a correction to the past is a
 * `ScheduleException`, which is day-scoped, dated, and audited.
 */
export class StaffScheduleHistory {
  static create(props: {
    barberId: string;
    versions: readonly StaffScheduleVersion[];
    nextSeq: number;
  }): Result<StaffScheduleHistory, StaffScheduleError[]>;

  inForceOn(day: CalendarDay): StaffScheduleVersion | null;

  amend(props: {
    from: CalendarDay;
    pattern: WeeklyPattern;
    today: CalendarDay;
    authoredBy: UserId | null;
    nowMs: number;
  }): Result<
    StaffScheduleHistory,
    RetroactiveScheduleAmendmentError | StaffScheduleError[]
  >;

  readonly nextSeq: number;
}
```

`libs/domain/scheduling/src/lib/schedule-exception.ts`

```ts
export type ExceptionScope =
  | { readonly kind: 'location'; readonly locationId: LocationId }
  | { readonly kind: 'barber'; readonly barberId: BarberId }
  | {
      readonly kind: 'barber_at_location';
      readonly barberId: BarberId;
      readonly locationId: LocationId;
    };

export type ExceptionSpan =
  | { readonly kind: 'all_day' }
  | {
      readonly kind: 'span';
      readonly from: LocalTimeOfDay;
      readonly to: LocalTimeOfDay;
    };

/**
 * TWO effects only, and the distinction is the whole point:
 *   - `replace_windows` changes the ROSTER (capacity). A location holiday is
 *     `replace_windows: []` at `location` scope. A late start is one window.
 *   - `occupy` creates an OCCUPANCY BLOCK inside the roster. Ivan is still
 *     rostered 09:00-18:00 and took the day off — two different facts from
 *     "Ivan was never rostered Tuesday", and the owner will want both.
 */
export type ScheduleExceptionEffect =
  | {
      readonly kind: 'replace_windows';
      readonly windows: readonly DayWindowProps[];
    }
  | {
      readonly kind: 'occupy';
      readonly span: ExceptionSpan;
      readonly reason: AbsenceReason;
    };

export class ScheduleException {
  readonly id: ScheduleExceptionId;
  readonly day: CalendarDay;
  readonly scope: ExceptionScope;
  readonly effect: ScheduleExceptionEffect;
  readonly createdAtMs: number;
  readonly createdBy: UserId | null;
  static create(props): Result<ScheduleException, ScheduleExceptionError[]>;
}
```

**Resolution order for one (barber, day)** — total, testable, encoded once in `buildDayWindows`:

1. `StaffScheduleHistory.inForceOn(day).pattern.windowsFor(day.weekday())` → candidate windows.
2. A `barber` or `barber_at_location` scoped `replace_windows` **replaces** them (at that location, for the scoped form).
3. Each window is **intersected** with the location's own hours for that day (`Location.hours` + `location`-scoped `replace_windows`). A barber cannot work while the shop is shut.
4. Windows materialise to instants via `LocalTimeOfDay.on(day, location.timezone, 'reject')`.
5. `occupy` exceptions become `OccupancyBlock`s; `all_day` spans the union of the resulting windows.

> **RULING (open question #2's default, pre-committed):** step 3 is **intersect**, not override and not must-be-contained. A barber's roster is a claim on their own time; the shop's hours are a hard bound. Intersecting is the only rule that is total (never fails) and never produces a bookable slot while the door is locked.

### 3.7 Occupancy — reason, classification, block

`libs/domain/scheduling/src/lib/occupancy-reason.ts`

```ts
export type BookingOrigin = 'online' | 'staff' | 'walk_in';
export type ServiceOutcome = 'scheduled' | 'worked' | 'no_show';

export type AbsenceReason =
  | { readonly kind: 'break'; readonly paid: boolean }
  | { readonly kind: 'time_off'; readonly absenceId: ScheduleExceptionId }
  | {
      readonly kind: 'sick';
      readonly absenceId: ScheduleExceptionId;
      readonly paid: boolean;
    }
  | {
      readonly kind: 'training';
      readonly absenceId: ScheduleExceptionId;
      readonly topic: string | null;
    }
  | {
      readonly kind: 'travel';
      readonly absenceId: ScheduleExceptionId;
      readonly toLocationId: LocationId;
    }
  | {
      readonly kind: 'admin';
      readonly absenceId: ScheduleExceptionId;
      readonly note: string;
    };

export type OccupancyReason =
  | {
      readonly kind: 'service';
      readonly appointmentId: AppointmentId;
      readonly seatId: SeatId;
      readonly serviceId: ServiceId;
      readonly variantId: ServiceVariantId | null;
      readonly origin: BookingOrigin; // walk-in is an ORIGIN, not a reason
      readonly outcome: ServiceOutcome; // no-show is an OUTCOME, not a reason
    }
  | {
      readonly kind: 'buffer';
      readonly ofAppointmentId: AppointmentId;
      readonly ofSeatId: SeatId;
    }
  | AbsenceReason;
```

Deliberately **not** arms: `closed`/`outside hours` (the complement of `windows` — storing it re-partitions the day on every roster edit), `idle` (also the complement — derive, never store), `cancelled` (a cancellation _removes_ a block and appends an _event_, §4.4), `hold` (holds are not occupancy — nobody is working — and live in their own array, §4.6), and the policy clamps (engine-internal only).

`libs/domain/scheduling/src/lib/occupancy-class.ts`

```ts
export interface OccupancyClass {
  /** In the utilisation DENOMINATOR — was this time sellable? */
  readonly capacity: 'scheduled' | 'excluded';
  /** In the NUMERATOR — revenue-generating client work? */
  readonly productive: boolean;
  /** Is the shop paying for it — the LABOUR COST denominator? */
  readonly paid: boolean;
}

/** Bump when the TABLE changes. Blocks store the version they were classified under. */
export const OCCUPANCY_POLICY_VERSION = 1;

export function classifyOccupancy(reason: OccupancyReason): OccupancyClass;
```

`libs/domain/scheduling/src/lib/occupancy-block.ts`

```ts
export class OccupancyBlock {
  /** DETERMINISTIC — this IS the idempotency key. Re-processing a duplicate
   *  trigger writes the same block over the same id: set semantics, not append.
   *    'svc:{appointmentId}:{seatId}[:{n}]'   (n = occupancy sub-block index)
   *    'buf:{appointmentId}:{seatId}'
   *    'exc:{exceptionId}[:{n}]'              (n = window index for all_day) */
  readonly id: string;
  readonly interval: Interval;
  readonly locationId: LocationId | null; // null for barber-scoped absences
  readonly reason: OccupancyReason;
  /** FROZEN at write time — `Seat.terms` snapshotting, applied to policy. */
  readonly klass: OccupancyClass;
  readonly policyVersion: number;
  readonly revenueMinorUnits: number; // 0 for everything non-service
  readonly currencyCode: string; // 'EUR'

  static of(props: OccupancyBlockProps): OccupancyBlock; // total assembler, like Seat.of
  minutes(): number; // from the INSTANTS, never local clock math
}
```

### 3.8 The `BarberDay` aggregate

`libs/domain/scheduling/src/lib/barber-day.ts` — **the spine.** One aggregate, one `totals()` fold, one `toPublicProjection()`, used by the live booking transaction, the reconciling trigger, the rebuild script and the statistics reader. _Backfill that reimplements the materialiser is backfill that produces different numbers, and you find out months later._

```ts
export class BarberDay {
  readonly barberId: BarberId;
  readonly day: CalendarDay;
  readonly zone: string;
  readonly dayBounds: Interval; // local midnight → next local midnight (23h/25h aware)
  readonly windows: readonly RosterWindow[];
  readonly blocks: readonly OccupancyBlock[];
  readonly holds: readonly SlotHold[];
  readonly events: readonly DayEvent[];
  readonly version: number;
  readonly sealedAtMs: number | null;

  /** THE materialiser. Pure. Sources in, projection out. */
  static materialise(props: {
    barberId: BarberId;
    day: CalendarDay;
    zone: string;
    schedule: StaffScheduleHistory;
    locationHours: ReadonlyMap<string, LocationDayHours>; // keyed by LocationId.value
    exceptions: readonly ScheduleException[];
    seats: readonly BookedSeatFact[]; // from Appointment, per seat
    policy: BookingPolicy;
    version: number;
  }): Result<BarberDay, BarberDayError[]>;

  static reconstitute(
    props: ReconstituteBarberDayProps,
  ): Result<BarberDay, BarberDayError[]>;

  /** Idempotent upsert keyed on `block.id`. REFUSES a block outside every
   *  window, and refuses a same-barber overlap against a scheduled-capacity
   *  block — both would produce negative idle minutes and >100% utilisation. */
  place(block: OccupancyBlock): Result<BarberDay, BarberDayError>;
  remove(blockId: string): BarberDay;

  hold(h: SlotHold): Result<BarberDay, SlotAlreadyHeldError | BarberDayError>;
  releaseHold(holdId: HoldId): BarberDay;
  dropExpiredHolds(nowMs: number): BarberDay;

  /** THE AVAILABILITY HALF. `excluding` lets a reschedule ignore its own seats. */
  busySet(opts: {
    nowMs: number;
    policy: BookingPolicy;
    excluding?: AppointmentId;
  }): IntervalSet;
  freeSet(opts: {
    nowMs: number;
    policy: BookingPolicy;
    locationId: LocationId;
    excluding?: AppointmentId;
  }): IntervalSet;

  /** THE STATISTICS HALF. Pure fold, no I/O. */
  totals(): BarberDayTotals;

  /** The PII-stripped shadow. Pure function — testable without Firestore. */
  toPublicProjection(nowMs: number): BarberDayPublic;
}
```

**Buffer rule, encoded here and nowhere else:** `busySet` pads every _persisted_ block whose reason is `service` by `policy.turnaroundMinutes` on **both** sides. It never pads the candidate. Padding that spills outside a working window has no effect after subtraction — which correctly means the first cut of the day needs no setup before opening. The backtracker, when it places seat B after seat A **for the same barber inside one option**, applies **zero** turnaround; full padding applies only against the persisted set.

### 3.9 Booking policy

`libs/domain/scheduling/src/lib/booking-policy.ts`

```ts
export type SlotAlignment = 'grid' | 'grid_plus_edges';

export class BookingPolicy {
  readonly stepMinutes: number; // 15
  readonly alignment: SlotAlignment; // 'grid_plus_edges'
  readonly minimumNoticeMinutes: number; // 120
  readonly horizonDays: number; // 60
  readonly turnaroundMinutes: number; // 0
  readonly maxPartySize: number; // 5  ← absorbs MAX_PARTY_SIZE
  readonly holdTtlMinutes: number; // 10
  readonly lateCancelThresholdMinutes: number; // 240
  readonly maxOptionsPerDay: number; // 40 — caps the backtracker's output, not its search
  static create(
    props: BookingPolicyProps,
  ): Result<BookingPolicy, BookingPolicyError[]>;
  static readonly DEFAULT: BookingPolicy;
}
```

Defaults defended: 15 minutes matches real barbershop granularity (30 is too coarse for a 20-minute beard trim, 5 floods the grid). `grid_plus_edges` always emits each free interval's own start as a candidate in addition to the grid — costs nothing, trivially explainable, and recovers exactly the odd-shaped gaps that cancellations create. Turnaround 0 because the sweep-down is usually already inside the service duration; make the shop opt in rather than discover their day silently shrank. 120 minutes' notice keeps same-day walk-ups bookable, which is most of a barbershop's volume. 60 days suits a see-you-in-two-months regular while keeping schedule drift irrelevant.

> **Slot step stays orthogonal to duration.** Setting step = duration is the classic mistake: a 45-minute service then becomes bookable only at :00 and :45, silently losing the 09:15 start that fits.

### 3.10 The engine

`libs/domain/scheduling/src/lib/availability.ts` — pure, total, deterministic.

```ts
export interface AvailabilityLine {
  readonly lineId: CartLineId;
  readonly seatKey: SeatKey;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly pref: BarberPref;
}

export interface BarberCandidate {
  readonly barberId: BarberId;
  readonly sortOrder: number; // from Barber, for a total tiebreak
  readonly free: IntervalSet; // location-clamped, busy-subtracted
  /** lineId.value → resolved terms. ABSENT means this barber does not perform
   *  that service — the STRICT resolution, never `termsFor`'s silent base fallback. */
  readonly termsByLine: ReadonlyMap<string, ServiceTerms>;
}

export interface AvailabilityQuery {
  readonly locationId: LocationId;
  readonly day: CalendarDay;
  readonly zone: string;
  readonly dayBounds: Interval;
  readonly lines: readonly AvailabilityLine[];
  readonly candidates: readonly BarberCandidate[];
  readonly policy: BookingPolicy;
  readonly nowMs: number;
}

export interface SeatAssignment {
  readonly lineId: CartLineId;
  readonly seatKey: SeatKey;
  readonly barberId: BarberId;
  readonly terms: ServiceTerms;
  readonly interval: Interval;
}

export type Arrangement = 'single' | 'parallel' | 'sequential' | 'mixed';

export interface AvailabilityOption {
  readonly anchorStartMs: number;
  readonly envelope: Interval;
  readonly assignments: readonly SeatAssignment[];
  readonly arrangement: Arrangement;
  /** Canonical: sorted `${lineId}|${barberId}|${startMs}` tuples joined. Dedup + stable UI key. */
  readonly key: string;
}

export type UnavailableReason =
  | 'location_closed' // the shop is shut that day
  | 'no_rostered_barber' // shop open, nobody rostered
  | 'no_eligible_barber' // rostered, but none performs the requested service(s) here
  | 'fully_booked'
  | 'party_cannot_be_seated' // each line fits alone, no combination fits together
  | 'too_soon' // whole day inside the notice window
  | 'beyond_horizon';

/** A typed empty reason, not an empty array — the UI CANNOT forget to explain. */
export type DayAvailability =
  | {
      readonly kind: 'options';
      readonly options: readonly AvailabilityOption[];
    }
  | { readonly kind: 'none'; readonly reason: UnavailableReason };

// ── the pipeline, each stage independently testable ──────────────────────
export function buildDayWindows(
  input: BuildDayWindowsInput,
): Result<readonly RosterWindow[], DateTimeResolutionError>;
export function policyClamps(
  policy: BookingPolicy,
  nowMs: number,
  dayBounds: Interval,
): IntervalSet;
export function candidateStarts(
  free: IntervalSet,
  durationMinutes: number,
  policy: BookingPolicy,
  originMs: number,
): readonly number[];
export function solveDay(query: AvailabilityQuery): DayAvailability;
export function rankOptions(
  options: readonly AvailabilityOption[],
): readonly AvailabilityOption[];
/** Month markers: the SAME engine with an at-least-one-option early exit, so the
 *  month calendar and the day grid can never disagree. */
export function hasAnyOption(query: AvailabilityQuery): boolean;
```

**Policy clamps are virtual busy intervals — inside the engine only.** `policyClamps` returns `[dayStart, max(nowMs + notice, dayStart))` and `[startOfDay(today) + horizonDays, dayEnd)`. They are subtracted exactly like any other busy interval. This collapses the policy layer into one primitive with one algorithm and one test suite, instead of a chain of ad-hoc filters where ordering bugs hide. **Nothing virtual is ever persisted.**

**Candidate starts must be anchored to LOCAL MIDNIGHT, not the epoch:**

```ts
alignUp(t, step, origin) = origin + Math.ceil((t - origin) / step) * step;
```

then step while `start + duration <= free.endMs`. Epoch alignment happens to survive Sofia's whole-hour offsets and breaks for any half-hour-offset zone or any step not dividing 60. Local-midnight anchoring makes "09:00 is always offered" true by construction.

### 3.11 The multi-seat assignment algorithm

This is **interval scheduling with variable-cost edges**, not bipartite matching. Hungarian/Hopcroft-Karp assume fixed resource consumption per edge and one resource per agent; here duration _depends on the chosen barber_ via `termsFor`, and ruling #1 makes the sequential arrangement (one barber, two seats, back to back) first-class. That is b-matching with time, which matching algorithms cannot express.

**Deterministic anchored backtracking:**

```
1. ANCHORS. Union the candidate starts across all eligible barbers for all lines.
   Sort ascending, dedup. Each distinct start is an ANCHOR — the party's earliest
   possible beginning. Iterate anchors ascending.

2. LINE ORDER (most-constrained-first / MRV, and STABLE):
     a. specific BarberPref before `any`
     b. longer resolved duration first (max over eligible barbers)
     c. CartLineId ascending  ← total order, never "first found"

3. DFS per anchor:
     for each line in the order above:
       barbers = pref.kind === 'specific'
                   ? [that barber]
                   : eligible barbers sorted by (sortOrder, barberId.value)
       for each barber:
         if (!candidate.termsByLine.has(lineId)) continue     // STRICT eligibility
         remaining = candidate.free MINUS intervals already placed for THIS barber
                     in THIS partial option (zero turnaround between own-party seats)
         for each start in candidateStarts(remaining, terms.durationMinutes, policy, anchorStartMs)
             where start >= anchorStartMs, ascending:
           place; recurse; on failure, unplace and continue
     on full assignment → emit an AvailabilityOption

4. CANONICALIZE. key = assignments sorted by lineId, mapped to
   `${lineId}|${barberId}|${startMs}`, joined by ';'. Dedup on key.

5. RANK (a separate, separately-tested pure function — "which arrangement do we
   show" must be changeable without touching the search):
     envelope duration ASC, then anchorStartMs ASC, then key ASC.
   Truncate to policy.maxOptionsPerDay.
```

At 5 seats × 10 barbers × ~40 starts/day this is trivially fast, and the anchor prunes hard: once the party's start is fixed, every seat must begin at or after it.

**Determinism rules — non-negotiable, and enforced by one test:**

- No `Math.random`, ever. `nowMs` is an explicit argument, never a `Clock`.
- **Never iterate a `Set`, `Map` or plain object whose ordering came from a Firestore read.** Re-sort by an explicit key on entry to the engine. (`BarberCandidate.termsByLine` is a `Map` used only for _lookup_, never iteration.)
- Every tiebreak chain terminates in an **id**, never in first-found.
- **The single most valuable test in the engine:** shuffle every input collection (candidates, lines, free intervals, blocks) and assert **byte-identical** output. Non-determinism here manifests as options flapping between identical reads and a jittering slot grid — nearly impossible to reproduce from a bug report.

### 3.12 Catalog changes

`libs/domain/catalog/src/lib/service.ts`:

```ts
/** STRICT resolution for the SCHEDULING path. `termsFor` stays total for the
 *  catalog's "from …" copy; scheduling must never silently book a barber who
 *  does not perform the service at the generic base duration. */
resolveTermsFor(barberId: BarberId, variantId: ServiceVariantId | null)
  : Result<ServiceTerms, BarberDoesNotPerformServiceError | UnknownVariantError>;
```

`libs/domain/catalog/src/lib/service-terms.ts`:

```ts
/** Sub-intervals of the seat during which the BARBER is occupied.
 *  Default: one block `{ offsetMinutes: 0, durationMinutes: <total> }`.
 *  Non-default expresses colour processing — the client is in the chair for
 *  90 minutes, the barber is free for the middle 40. Square ships exactly this
 *  as "processing time". Barber capacity stays exactly 1: `capacity: 2` would
 *  also permit two overlapping haircuts, which is a double-booking. */
export interface OccupancyBlockSpec { readonly offsetMinutes: number; readonly durationMinutes: number; }

export class ServiceTerms {
  readonly occupancy: readonly OccupancyBlockSpec[];   // INVARIANT: non-empty, sorted, within [0, durationMinutes]
  static create(price: Money, durationMinutes: number, occupancy?: readonly OccupancyBlockSpec[]): Result<ServiceTerms, ...>;
}
```

---

## 4. The statistics model

### 4.1 The reason taxonomy, classified

**Persist `{capacity, productive, paid}` DENORMALISED and frozen onto every block.** This is `Seat.terms` snapshotting applied to policy: when the owner decides next year that unpaid breaks should count toward capacity, last July's utilisation must not silently change. `classifyOccupancy` is the _write-time policy_; the stored triple is the _frozen answer_. Reports read the frozen triple and are reproducible forever.

| reason                             | capacity      | productive | paid             | billable/revenue     | ruling                                                                                                                                                                        |
| ---------------------------------- | ------------- | ---------- | ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service` · `outcome: 'worked'`    | scheduled     | **yes**    | yes              | **yes** (seat price) | the numerator                                                                                                                                                                 |
| `service` · `outcome: 'scheduled'` | scheduled     | **yes**    | yes              | yes (forecast)       | future work counts as booked                                                                                                                                                  |
| `service` · `outcome: 'no_show'`   | **scheduled** | no         | yes              | policy (deposit)     | **the entire point of the taxonomy** — separates "nobody booked" (marketing) from "somebody booked and didn't come" (deposits/reminders). Both look like idle time otherwise. |
| `buffer`                           | scheduled     | no         | yes              | no                   | the cost of the turnaround policy, made visible                                                                                                                               |
| `admin`                            | **scheduled** | no         | yes              | no                   | a manager blocking two hours is a CHOICE that consumes sellable time. Excluding it lets the shop hide bad scheduling behind a block.                                          |
| `break` · `paid: true`             | scheduled     | no         | yes              | no                   |                                                                                                                                                                               |
| `break` · `paid: false`            | **excluded**  | no         | no               | no                   |                                                                                                                                                                               |
| `training`                         | **excluded**  | no         | yes              | no                   | never sellable; no scheduler could have filled it. Punishing a barber for a shop decision is wrong. Stays visible in `excludedMinutes.training`.                              |
| `travel`                           | **excluded**  | no         | yes              | no                   | same                                                                                                                                                                          |
| `time_off`                         | excluded      | no         | no               | no                   |                                                                                                                                                                               |
| `sick`                             | excluded      | no         | per `paid` field | no                   |                                                                                                                                                                               |

`origin: 'online' | 'staff' | 'walk_in'` is an attribute of the `service` arm, **not a reason**: a walk-in occupies time and produces revenue identically to an online booking; the only difference is how it arrived. A separate arm would fork every "productive time" sum. Same argument for `outcome`.

### 4.2 The metrics, with exact formulas

`libs/domain/scheduling/src/lib/barber-day-totals.ts`

```ts
export interface BarberDayTotals {
  readonly rosteredMinutes: number; // Σ windows
  readonly scheduledMinutes: number; // rostered − Σ(blocks where capacity==='excluded')   ← THE DENOMINATOR
  readonly productiveMinutes: number; // Σ(blocks where productive)
  readonly bufferMinutes: number;
  readonly noShowMinutes: number;
  readonly adminBlockedMinutes: number;
  readonly excludedMinutes: Readonly<
    Record<'break_unpaid' | 'time_off' | 'sick' | 'training' | 'travel', number>
  >;
  readonly idleMinutes: number; // scheduled − Σ(blocks where capacity==='scheduled')
  readonly idleGapCount: number;
  readonly longestIdleGapMinutes: number;
  readonly sellableGapCount: number; // gaps >= shortest sellable service
  readonly serviceCount: number; // SEATS, not appointments
  readonly noShowCount: number;
  readonly cancelledCount: number;
  readonly lateCancelledCount: number;
  readonly appointmentCount: number; // distinct appointments touched
  readonly knownClientCount: number; // distinct account subjects
  readonly anonymousSeatCount: number; // NEVER folded into the above — see §4.7
  readonly revenueMinorUnits: number;
  readonly currencyCode: string;
}
```

| metric                                  | formula                                                          | benchmark                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Utilisation**                         | `productiveMinutes / scheduledMinutes`                           | 70–85% healthy; 65–75% premium; <60% red flag                                                                                                       |
| **Chair-time utilisation**              | `(productiveMinutes + bufferMinutes) / scheduledMinutes`         | report **both** — the gap is the turnaround policy's cost                                                                                           |
| **Committed-but-unsellable**            | `rosteredMinutes − scheduledMinutes`, broken down by reason      | this IS the owner's "busy from services or else" question                                                                                           |
| **RevPAH** (revenue per available hour) | `revenue / (scheduledMinutes/60)`                                | the real capacity KPI — moves on price _and_ fill                                                                                                   |
| **Effective hourly rate**               | `revenue / (productiveMinutes/60)`                               | `RevPAH / this === utilisation`                                                                                                                     |
| **No-show rate**                        | `noShowCount / (serviceCount + noShowCount)`                     | ~3% typical, target <6%                                                                                                                             |
| **Cancellation rate**                   | `cancelledCount / (serviceCount + noShowCount + cancelledCount)` | ~8%; split out `lateCancelledCount`                                                                                                                 |
| **Shop average ticket**                 | `revenue / appointmentCount`                                     | a party of 3 is ONE ticket                                                                                                                          |
| **Per-barber avg service value**        | `barber revenue / serviceCount`                                  | per SEAT — label differently in the UI or it will be misread                                                                                        |
| **Fragmentation ratio**                 | `(idleMinutes − Σ gaps ≥ shortest sellable) / idleMinutes`       | 60% utilisation as one 3-hour hole is a _demand_ problem; as eight 20-minute slivers it is a _scheduling_ problem, fixable by `stepMinutes`/buffers |

**Three metrics need write-time capture and are unrecoverable otherwise. Add the fields in Phase 3.5, not later.**

- **Rebooking rate** (`bookedFromAppointmentId` on the appointment at create time) — 30-40% average, 50%+ good, 65%+ elite. No retroactive fix.
- **Booking lead time** (`bookedAtMs`) — `Appointment` today has **no temporal metadata at all**.
- **First-available lead time** — forward-looking, destroyed the moment someone books. Snapshotted daily by `sampleBarberLeadTime` into `barberLeadTimeSamples/{barberId}__{day}`. There is no query that recovers yesterday's value.

### 4.3 Where numbers are stored — three tiers, no fourth

**Tier 1 — day.** `totals` is a **pure fold over `blocks` + `windows`, recomputed in the same write** as any block mutation. Zero extra reads, zero latency, zero eventual consistency, no trigger. The day rollup is free.

**Tier 2 — period.** `barberPeriodStats/{barberId}__{2026-07}` and `__{2026-W31}`, plus `shopPeriodStats/{locationId}__{2026-07}`. A scheduled function reads the ≤31 day ledgers and **folds them from scratch**. The rollup stores `sourceVersions: Record<'YYYY-MM-DD', number>` and skips when unchanged. Cadence: every 15 min for the current period, nightly over the trailing 14 days, weekly over the trailing 90.

**Tier 3 — none.** Do not build a warehouse. If year-over-year cohort analysis is ever needed, stream day docs to BigQuery via the Firestore extension.

> **BAN: `FieldValue.increment` for anything a statistics page displays.** An appointment can be edited, rescheduled, cancelled, un-cancelled, seat-reassigned or corrected. Each is a delta that must be applied exactly once, in order, to a counter you cannot audit. One duplicate trigger, one crashed batch, one manual data fix, and the number is permanently wrong with **no source to re-derive from and no way to detect the drift**. Recompute is idempotent by definition; that is why duplicate and out-of-order trigger delivery is a total non-issue in this design and why there is no processed-event-id table.

### 4.4 Rollups under cancellation and edit

A cancellation must **remove** the block (the time genuinely returns to sellable — the availability half depends on it) but must **not vanish** from the record (the statistics half depends on counting it). Two lists is the only way to satisfy both.

```ts
export type DayEvent =
  | {
      kind: 'cancelled';
      appointmentId;
      seatId;
      atMs;
      leadTimeMinutes;
      by: 'client' | 'staff';
      forfeitedMinutes: number;
      forfeitedRevenueMinorUnits: number;
    }
  | {
      kind: 'rescheduled';
      appointmentId;
      seatId;
      atMs;
      fromStartMs: number;
      toStartMs: number;
    }
  | { kind: 'no_show'; appointmentId; seatId; atMs };
```

`leadTimeMinutes` on the event is what makes a late-cancellation policy measurable without polluting interval geometry.

**Cancel-then-rebook into the same slot** is the trap: the old block must be _removed_ (its deterministic id `svc:{apptId}:{seatId}` differs from the new appointment's, so ids do not collide) and the event appended. A dedicated test covers it.

**Sealing.** `sealedAtMs` is set on day ledgers older than 7 days by the nightly job. A write to a sealed day is **refused** by the aggregate and routed to an explicit, audited adjustment. Without this, a late edit to a three-month-old appointment silently restates a month the owner already used for payroll.

### 4.5 The `Seat.outcome` change — the no-show rate is uncomputable without it

`Appointment.markNoShow()` and `complete()` are party-level (`appointment.ts:247-253`), and `AppointmentStatus` is a root-level 5-arm union. For a party of three where one guest doesn't turn up there is **no representable state**: mark the appointment `no_show` and you erase two completed services and their revenue; mark it `completed` and the no-show is invisible.

Every other per-person fact (subject, service, variant, barber, terms, slot) already lives on `Seat` under the owner's own 2026-07-29 ruling. Outcome is the one that was left behind.

```ts
// libs/domain/scheduling/src/lib/seat-outcome.ts
export type SeatOutcome =
  | { readonly kind: 'scheduled' }
  | { readonly kind: 'worked'; readonly atMs: number }
  | { readonly kind: 'no_show'; readonly atMs: number }
  | {
      readonly kind: 'cancelled';
      readonly atMs: number;
      readonly by: 'client' | 'staff';
      readonly reason: CancellationReason;
    };

/** A CLOSED union. Prose cannot be aggregated. */
export type CancellationReason =
  | { readonly kind: 'client_changed_plans' }
  | { readonly kind: 'client_unwell' }
  | { readonly kind: 'staff_barber_absence' }
  | { readonly kind: 'staff_shop_closure' }
  | { readonly kind: 'no_show_converted' }
  | { readonly kind: 'other'; readonly note: string };
```

`Appointment.status` becomes a **derived summary** of its seats' outcomes, not the truth. The lifecycle graph in `appointment-status.ts` stays, but `complete()`/`markNoShow()` are replaced by `markSeatOutcome(seatId, outcome)` which recomputes the root status.

### 4.6 Holds are not occupancy

A hold consumes sellable time transiently but nobody is working. It lives in its own array, **never in `blocks`**, and therefore **never enters `totals`**. An abandoned hold is a funnel metric, not an occupancy metric.

```ts
export interface SlotHold {
  readonly id: HoldId;
  readonly interval: Interval;
  readonly locationId: LocationId;
  readonly expiresAtMs: number;
  readonly sessionKey: string; // opaque; NOT a userId
}
```

The public projection carries hold intervals with an `x: <expiresAtMs>` field. That reveals only "someone is booking this right now" — no PII, and genuinely good UX. It is the **one and only** exception to reason-free. Readers filter `x <= nowMs`; every write to the day doc drops expired holds (convergent); `sweepExpiredHolds` runs every 5 minutes.

### 4.7 The privacy boundary

**The public document may contain EXACTLY:** `schemaVersion`, `barberId`, `day`, `zone`, `dayStartMs`, `windows[]` (`{s, e, loc}`), `busy[]` (`{s, e, x?}`), `longestFreeMs`, `dayStatus`, `version`, `updatedAt`.

**It may NOT contain, and each is a specific leak:**

| forbidden                  | why                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `userId`                   | direct PII                                                                                                                        |
| `SeatLabel`                | it is literally `'Walk-in 14:30'` — a timestamp-shaped handle attached to a person                                                |
| `serviceId` / `variantId`  | `services` are `allow read: if true`, so a serviceId + an exact duration fingerprints what one identifiable person is having done |
| `appointmentId` / `seatId` | a stable joinable cross-request identifier even if `appointments` denies read                                                     |
| `reason`                   | **`sick` is special-category health data under GDPR Art. 9.** This is an EU product. Non-negotiable.                              |
| revenue, counts, `totals`  | trivially scraped into a competitor's revenue estimate                                                                            |

**Merging adjacent busy intervals is load-bearing, not cosmetic.** Unmerged, two back-to-back appointments appear as two intervals and a scraper can count how many clients each barber served. Merging collapses that. A lone gap between two blocks still reveals two appointments — unavoidable and harmless, since it carries no identity.

Cap the public horizon at `policy.horizonDays` so the whole book cannot be scraped in one pass.

> **The guarantee lives in the WRITER, not in the rules.** The rules only say "this document is public". One field added later for debugging silently publishes the booking history. This is pinned by (a) a rules-unit test asserting the exact allowed key set, (b) a schema assertion in `toPublicProjection`, and (c) a comment directly above the writer, not only in the rules file.

---

## 5. Application layer

All new ports at `libs/application/booking/src/lib/ports/`, following the existing `interface` + `InjectionToken` idiom.

```ts
// availability-reader.port.ts
export interface AvailabilityReader {
  /** Live day docs for the barbers eligible at this location. ≤ N doc-ID reads. */
  observeDay(
    locationId: LocationId,
    barberIds: readonly BarberId[],
    day: CalendarDay,
  ): Observable<Result<readonly BarberDay[], RepositoryError>>;
  /** ONE doc read. Markers are a HINT — the day doc is truth, the commit is the arbiter. */
  readMonth(
    locationId: LocationId,
    month: string,
  ): Promise<Result<LocationMonthMarkers, RepositoryError>>;
}
export const AVAILABILITY_READER = new InjectionToken<AvailabilityReader>(
  'AVAILABILITY_READER',
);

// staff-schedule-reader.port.ts   → STAFF_SCHEDULE_READER
export interface StaffScheduleReader {
  readHistory(
    barberId: BarberId,
  ): Promise<Result<StaffScheduleHistory | null, RepositoryError>>;
  readExceptions(
    range: { from: CalendarDay; to: CalendarDay },
    scope: ExceptionScope,
  ): Promise<Result<readonly ScheduleException[], RepositoryError>>;
}

// booking-policy-reader.port.ts   → BOOKING_POLICY_READER
export interface BookingPolicyReader {
  read(locationId: LocationId): Promise<Result<BookingPolicy, RepositoryError>>;
}

// booking-commit.port.ts          → BOOKING_COMMIT
export interface BookingCommitIntent {
  readonly locationId: LocationId;
  readonly seats: readonly {
    readonly subject: SeatSubject;
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly barberId: BarberId;
    readonly startMs: number;
    /** ADVISORY quote only. The server re-resolves and returns QuoteChanged on a mismatch. */
    readonly quotedTerms: ServiceTerms;
  }[];
  readonly idempotencyKey: string;
  readonly holdId: HoldId | null;
  readonly origin: BookingOrigin;
  readonly bookedFromAppointmentId: AppointmentId | null;
}
export interface BookingCommit {
  commit(
    intent: BookingCommitIntent,
  ): Promise<Result<BookingCommitted, BookingCommitError>>;
  hold(req: HoldRequest): Promise<Result<HoldGranted, BookingCommitError>>;
  release(holdId: HoldId): Promise<Result<void, BookingCommitError>>;
  cancel(
    appointmentId: AppointmentId,
    seatIds: readonly SeatId[] | 'all',
    reason: CancellationReason,
  ): Promise<Result<void, BookingCommitError>>;
}

// barber-statistics-reader.port.ts → BARBER_STATISTICS_READER  (staff surfaces only)
export interface BarberStatisticsReader {
  readDay(
    barberId: BarberId,
    day: CalendarDay,
  ): Promise<Result<BarberDayLedger | null, RepositoryError>>;
  readPeriod(
    barberId: BarberId,
    period: string,
  ): Promise<Result<BarberPeriodStats | null, RepositoryError>>;
  readShopPeriod(
    locationId: LocationId,
    period: string,
  ): Promise<Result<ShopPeriodStats | null, RepositoryError>>;
}
```

**`AppointmentRepository.save()` is DELETED from the port.** With the method gone, no future feature can accidentally reintroduce a client-side appointment write — the rule change and the type system then agree, which makes the security fix _structural_ rather than conventional.

Use cases at `libs/application/booking/src/lib/use-cases/`:

```ts
export class GetDayAvailabilityUseCase {
  constructor(availability, catalog, policies, clock);
  execute(input: {
    locationId;
    day: CalendarDay;
    lines: readonly AvailabilityLine[];
  }): Observable<Result<DayAvailability, GetAvailabilityError>>;
  // Resolves eligible barbers via Service.isPerformedBy + servesLocation + Barber location scope,
  // builds `termsByLine` via Service.resolveTermsFor (STRICT), then calls solveDay.
}

export class GetMonthAvailabilityUseCase {
  // ONE month-doc read for markers; falls back to `hasAnyOption` over day docs
  // when the party is non-trivial, so month and day can never disagree.
}

/** REPLACES CreateBookingUseCase's write path. Sends an INTENT; the server builds the aggregate. */
export class CommitBookingUseCase {
  execute(
    input: CommitBookingInput,
  ): Promise<Result<BookingCommitted, CommitBookingError>>;
}

export class HoldSlotUseCase {
  /* … */
}
export class MarkSeatOutcomeUseCase {
  /* staff */
}
export class AmendStaffScheduleUseCase {
  /* staff — wraps StaffScheduleHistory.amend */
}
export class RecordScheduleExceptionUseCase {
  /* staff */
}
export class GetBarberUtilisationUseCase {
  /* staff */
}
```

---

## 6. Infrastructure

### 6.1 Collections

Register every path in `libs/infrastructure/firestore/src/lib/firestore-paths.ts` — `Collections.*` entry plus a `*Collection(db)` / `*DocRef(db, id)` pair. Never inline.

| path                                      | read       | write          | purpose                            |
| ----------------------------------------- | ---------- | -------------- | ---------------------------------- |
| `barberDays/{barberId}__{YYYY-MM-DD}`     | **public** | Admin SDK only | the conflict oracle + the day grid |
| `barberDays/{…}/private/ledger`           | staff      | Admin SDK only | reasons, revenue, totals, events   |
| `locationMonths/{locationId}__{YYYY-MM}`  | **public** | Admin SDK only | month markers (a HINT)             |
| `staffSchedules/{barberId}`               | staff      | Admin SDK only | version series + `nextSeq`         |
| `scheduleExceptions/{exceptionId}`        | staff      | Admin SDK only | absences, roster overrides         |
| `barberPeriodStats/{barberId}__{period}`  | staff      | Admin SDK only | week/month rollups                 |
| `shopPeriodStats/{locationId}__{period}`  | staff      | Admin SDK only |                                    |
| `barberLeadTimeSamples/{barberId}__{day}` | staff      | Admin SDK only | forward-looking snapshot           |
| `bookingCommits/{idempotencyKey}`         | closed     | Admin SDK only | idempotency, TTL 30d               |

**Public day doc:**

```jsonc
// barberDays/ivan__2026-07-31
{
  "schemaVersion": 1,
  "barberId": "ivan",
  "day": "2026-07-31",
  "zone": "Europe/Sofia",
  "dayStartMs": 1785448800000, // local midnight — the grid origin, no tz lib needed client-side
  "windows": [{ "s": 1785481200000, "e": 1785513600000, "loc": "loc-center" }],
  "busy": [
    { "s": 1785484800000, "e": 1785486900000 },
    { "s": 1785490200000, "e": 1785492000000, "x": 1785484000000 },
  ], // x = hold expiry
  "longestFreeMs": 7200000,
  "dayStatus": "working", // 'working' | 'off' | 'fully_booked'
  "version": 41,
  "updatedAt": "<serverTimestamp>",
}
```

**Private ledger** (same id, subcollection — _a subcollection is not covered by its parent's rule_, which is what makes the split expressible):

```jsonc
// barberDays/ivan__2026-07-31/private/ledger
{
  "schemaVersion": 1,
  "barberId": "ivan",
  "day": "2026-07-31",
  "zone": "Europe/Sofia",
  "windows": [/* BYTE-IDENTICAL to public — asserted in a test */],
  "blocks": [
    {
      "id": "svc:appt-1:seat-1",
      "s": 1785484800000,
      "e": 1785486900000,
      "minutes": 35,
      "loc": "loc-center",
      "reason": {
        "kind": "service",
        "appointmentId": "appt-1",
        "seatId": "seat-1",
        "serviceId": "svc-classic",
        "variantId": "var-short",
        "origin": "online",
        "outcome": "scheduled",
      },
      "capacity": "scheduled",
      "productive": true,
      "paid": true,
      "policyVersion": 1,
      "revenueMinorUnits": 2800,
      "currencyCode": "EUR",
    },
  ],
  "holds": [],
  "events": [],
  "totals": {/* BarberDayTotals */},
  "version": 41,
  "sealedAtMs": null,
  "updatedAt": "<serverTimestamp>",
}
```

Sizes: a busy day is ~15 appointments + ~5 blocks ≈ 20 intervals ≈ 1.5 KB public, ~6 KB private. The 1 MiB ceiling is ~15,000 intervals. Not within two orders of magnitude.

**Month markers** — `days` is a **map keyed by date** so the writer merges a single field path:

```jsonc
// locationMonths/loc-center__2026-07
{
  "locationId": "loc-center",
  "month": "2026-07",
  "zone": "Europe/Sofia",
  "days": {
    "2026-07-31": {
      "open": 3,
      "longestFreeMs": 5400000,
      "earliestFreeMs": 1785484800000,
    },
  },
  "updatedAt": "<serverTimestamp>",
}
```

**`staffSchedules/{barberId}`** — one doc holding the whole version array (a barber has ~10 versions in a lifetime) plus `nextSeq`. **`nextSeq` is never derived from array length** (blueprint §7.7 — the id-resurrection bug).

### 6.2 Rules

```javascript
// ── availability projection (PII-FREE BY CONSTRUCTION, public read) ──────
// Rules CANNOT redact fields: a rule that lets you read a document lets you
// read ALL of it. These docs are what an anonymous /book visitor reads, so
// they must contain nothing identifying a client and nothing about WHY a
// barber is busy — `sick` is special-category health data (GDPR Art. 9).
// Reasons live in the `private/ledger` subcollection below, staff-only.
// Allowed keys, EXHAUSTIVELY: schemaVersion, barberId, day, zone, dayStartMs,
// windows, busy, longestFreeMs, dayStatus, version, updatedAt.
// Pinned by firestore.rules.integration.spec.ts — do not add a field here
// without adding it there first.
match /barberDays/{dayId} {
  allow read: if true;
  allow write: if false;              // Admin SDK only

  match /private/{docId} {
    allow read: if isStaff();
    allow write: if false;
  }
}

match /locationMonths/{monthId} { allow read: if true;      allow write: if false; }

// Employment/health data. Never public.
match /staffSchedules/{barberId}        { allow read: if isStaff(); allow write: if false; }
match /scheduleExceptions/{exceptionId} { allow read: if isStaff(); allow write: if false; }
match /barberPeriodStats/{statId}       { allow read: if isStaff(); allow write: if false; }
match /shopPeriodStats/{statId}         { allow read: if isStaff(); allow write: if false; }
match /barberLeadTimeSamples/{sampleId} { allow read: if isStaff(); allow write: if false; }
match /bookingCommits/{key}             { allow read, write: if false; }

// ── appointments: CLOSED to every client write ──────────────────────────
match /appointments/{appointmentId} {
  allow read: if isStaff()
    || (isSignedIn() && resource.data.ownerUserId == request.auth.uid);

  // A rule cannot re-check availability (it sees ONE document, and get() is
  // capped at 10 accesses), and it cannot stop a browser naming its own
  // seats[].terms.priceMinorUnits. Every mutation — client booking, staff
  // booking, cancel, reschedule, outcome — goes through a callable that
  // transacts against barberDays.
  allow create, update, delete: if false;
}

// Archive-only, so a historical id always resolves to something.
match /barbers/{barberId}   { allow delete: if false; }
match /services/{serviceId} { allow delete: if false; }
match /locations/{id}       { allow delete: if false; }
```

This also **deletes** the `affectedKeys().hasOnly(['status'])` client-cancel rule, which was one server-written field away from breaking permanently (`seed-firestore.ts:35-48` documents having already been bitten by exactly this class of bug).

**Rules-unit tests** in `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`, which today has **zero** appointment coverage:

1. unauthenticated CAN read `barberDays/{id}`
2. unauthenticated CANNOT read `barberDays/{id}/private/ledger`
3. unauthenticated CANNOT read `appointments/{id}`
4. signed-in non-owner CANNOT read another user's appointment
5. signed-in user CANNOT create an appointment
6. staff CAN read `barberPeriodStats`, a client CANNOT
7. **a seeded public day doc's key set is exactly the allowed list** ← the schema pin

### 6.3 Indexes

The **read path needs none of these** — day and month docs are fetched by document ID, which costs no index. These serve the rebuild function and staff day-sheets.

```jsonc
{ "collectionGroup": "appointments", "fields": [
    {"fieldPath":"locationId","order":"ASCENDING"},
    {"fieldPath":"barberIds","arrayConfig":"CONTAINS"},
    {"fieldPath":"startMs","order":"ASCENDING"}] },
{ "collectionGroup": "appointments", "fields": [
    {"fieldPath":"locationId","order":"ASCENDING"},{"fieldPath":"startMs","order":"ASCENDING"}] },
{ "collectionGroup": "appointments", "fields": [
    {"fieldPath":"ownerUserId","order":"ASCENDING"},{"fieldPath":"startMs","order":"ASCENDING"}] },
    // ↑ REPLACES the timeSlot.startIso index — see §7 row 5
{ "collectionGroup": "scheduleExceptions", "fields": [
    {"fieldPath":"scope.barberId","order":"ASCENDING"},{"fieldPath":"day","order":"ASCENDING"}] },
{ "collectionGroup": "scheduleExceptions", "fields": [
    {"fieldPath":"scope.locationId","order":"ASCENDING"},{"fieldPath":"day","order":"ASCENDING"}] },

"fieldOverrides": [
  { "collectionGroup":"appointments",   "fieldPath":"seats",   "indexes":[] },
  { "collectionGroup":"barberDays",     "fieldPath":"busy",    "indexes":[] },
  { "collectionGroup":"barberDays",     "fieldPath":"windows", "indexes":[] },
  { "collectionGroup":"locationMonths", "fieldPath":"days",    "indexes":[] }
]
```

Exempting `seats` matters materially: it is an array of maps, so Firestore indexes every field of every element — ~60 useless entries per 5-seat write, none of which any query can use. It is effectively a one-way door (re-enabling means a full reindex), and it is the right call: `seats` is a denormalised snapshot.

For period-stat ranges, exploit the doc-ID shape instead of an index: `where(documentId(),'>=','ivan__2026-07-01').where(documentId(),'<=','ivan__2026-07-31')` is a pure key-range scan. **This is what makes the owner's "really easy to keep statistics" property literally true — zero index maintenance.**

**TTL policies cannot be declared in `firestore.indexes.json`.** They must go in the deploy runbook or Terraform or they will be forgotten: `bookingCommits.expireAt`, and the existing `otps.expiresAt` which today accumulates forever.

### 6.4 Cloud Functions

`apps/functions/src/main.ts` — the export **is** the registration.

```ts
import { setGlobalOptions } from 'firebase-functions/v2';
// Bulgarian-first product with a European Firestore; everything currently
// deploys to us-central1 (no region option anywhere), which is a transatlantic
// hop per call AND a data-residency question under GDPR. Changing the region
// on a DEPLOYED function requires delete-and-recreate, so do it before launch.
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

export {
  requestOtpChallenge,
  verifyOtpChallenge,
  completeRegistration,
} from './lib/otp';
export { commitBooking } from './lib/booking/commit-booking'; // { minInstances: 1 }
export { holdSlot, releaseHold } from './lib/booking/hold-slot';
export {
  cancelBooking,
  rescheduleBooking,
  markSeatOutcome,
} from './lib/booking';
export { onAppointmentWritten } from './lib/availability/on-appointment-written';
export { onScheduleWritten } from './lib/availability/on-schedule-written';
export { onLocationWritten } from './lib/availability/on-location-written';
export { rebuildBarberDays } from './lib/availability/rebuild'; // admin callable
export { extendAvailabilityHorizon } from './lib/availability/extend-horizon'; // nightly
export { sweepExpiredHolds } from './lib/availability/sweep-holds'; // */5 min
export { detectProjectionDrift } from './lib/availability/detect-drift'; // nightly
export { rollUpBarberPeriods } from './lib/stats/roll-up-periods'; // */15 min
export { sampleBarberLeadTime } from './lib/stats/sample-lead-time'; // daily 09:00
```

`apps/functions/tsconfig.app.json` currently references only five libs; **`domain/scheduling` and `domain/catalog` must be added** via `pnpm nx sync`. Expect the same class of surprise the blueprint records from the last sync (eight hidden type errors unmasked). Do **not** import `@creativo/application/booking` — its ports import `InjectionToken` from `@angular/core`, and with `bundle: false` + `generatePackageJson` that makes Angular a runtime dependency of the deployed CJS. Duplicate the small intent type instead.

**`commitBooking` — the transaction, precisely:**

```ts
return db.runTransaction(async (t) => {
  // ── READS (all reads precede all writes; conditional follow-up reads are
  //    legal, since only WRITES are ordered after reads) ──
  const commitRef = db.doc(`bookingCommits/${intent.idempotencyKey}`);
  const prior = await t.get(commitRef);
  if (prior.exists) return { appointmentId: prior.get('appointmentId'), replayed: true };

  const keys = distinct(intent.seats.map(s => `${s.barberId}__${dayKeyOf(s.startMs)}`));
  const [days, ledgers] = await Promise.all([
    t.getAll(...keys.map(k => db.doc(`barberDays/${k}`))),
    t.getAll(...keys.map(k => db.doc(`barberDays/${k}/private/ledger`))),
  ]);
  const missing = keys.filter(k => !exists(k));
  if (missing.length) { /* read staffSchedules + locations + exceptions, materialise inline */ }

  // ── SERVER-AUTHORITATIVE RESOLUTION ──
  // The client never names a price or a duration. Load services/{id}, resolve
  // Service.resolveTermsFor(barberId, variantId) STRICTLY, derive each seat's
  // end from the resolved durationMinutes.
  const resolved = resolveTermsServerSide(intent, services);
  if (differsFrom(intent.quotedTerms)) throw quoteChanged(old, next);   // never silently accept either

  // ── CONFLICT CONDITION (epoch ms, never string compare) ──
  for (const seat of resolved.seats) {
    const day = ledgerFor(seat);
    if (!day.windows.some(w => w.s <= seat.startMs && seat.endMs <= w.e))
      throw unavailable('outside_working_hours', seat, day);
    const hit = day.busySet({ nowMs, policy }).find(b => Interval.overlaps(b, seat.interval));
    if (hit && !ownedByThisHold(hit, intent.holdId)) throw unavailable('slot_taken', seat, day);
  }

  // ── DOMAIN (the SAME aggregate the client uses) ──
  const appointment = Appointment.create({ id, locationId, seats, now, bookedAtMs, origin, ... });

  // ── WRITES ──
  t.set(db.doc(`appointments/${id}`), toPersistence(appointment));
  for (const k of keys) { t.set(dayRef(k), publicProjection(k)); t.set(ledgerRef(k), ledgerDoc(k)); }
  t.set(commitRef, { appointmentId: id, expireAt: in30Days, at: FieldValue.serverTimestamp() });
  // locationMonths is DELIBERATELY NOT written here — see below.
  return { appointmentId: id, replayed: false };
}, { maxAttempts: 5 });
```

`unavailable()` throws `new HttpsError('aborted', 'slot_taken', { code, seatKey, barberId, requestedStartMs, day: { version, busy, windows, longestFreeMs } })` — **returning the freshly-read day doc in the error payload**, so the UI re-renders the schedule step with genuine alternatives at zero extra round trips.

### 6.5 Transaction vs trigger — the defence

**The projection is written INSIDE the booking transaction.** Cloud Functions v2 Firestore triggers are Eventarc-backed: delivery is **at-least-once** and Google's own docs state **ordering is not guaranteed**. If the projection were trigger-written there would be a window — hundreds of ms typically, seconds under cold start or retry — between the appointment landing and the projection reflecting it. A second booker transacting in that window reads a stale projection, sees the slot free, and double-books. **No amount of trigger idempotency closes that window; it is a read-your-writes problem, not a duplicate-delivery problem.**

**The trigger still exists, as a convergent reconciler**, because it owns the paths the callable does not: `completed`/`no_show` transitions hours later, staff console edits, manual repairs, and any callable bug. Its handler **never applies deltas** (`arrayUnion`, `increment`); it recomputes the affected `(barber, day)` from sources — query appointments in the day window, union exceptions, resolve the in-force schedule version, intersect with location hours — and rewrites both docs in an inner transaction. **Convergence IS the idempotency mechanism**: replaying twice or out of order yields byte-identical output. `sourceMaxEventTime` on the doc skips older events purely as an optimisation, never as the correctness mechanism. `{ retry: true, maxInstances: 5 }` so a bulk edit cannot stampede concurrent recomputes onto one doc.

> **Guard this with a comment and a test that runs the trigger handler twice and asserts byte-identical output.** The moment someone "optimises" it into a delta, duplicate delivery double-counts and out-of-order delivery corrupts — and the symptom is a slot that _looks_ booked but isn't, invisible until a customer complains.

**`locationMonths` is written OUTSIDE the transaction**, by the trigger, with a non-transactional `set({ merge: true })` on the single field path `FieldPath('days', '2026-07-31')`. Distinct days never collide; it is last-writer-wins per field; staleness is harmless because markers are a hint.

> **This is the single most important contention decision in the design, and the single most likely future regression, because the reason is subtle and non-local.** Pull `locationMonths` into the transaction "for consistency" and every booking at a location serialises behind one document — the Admin SDK locks pessimistically, so a busy Saturday becomes a queue of `ABORTED` retries. A comment above the writer says exactly this.

Sharding the day doc is the **wrong** mitigation: the conflict predicate needs the entire interval set for one `(barber, day)` read atomically, so splitting across shards means reading them all anyway. `(barber, day)` is already maximally fine-grained — two barbers never contend, two days never contend. The residual flash-crowd risk on one popular Saturday is handled by holds (moving the race from commit-time to selection-time) plus bounded client retry with jitter on `ABORTED`.

### 6.6 Cost

Modelled shop — 3 barbers, 2 locations, 40 appointments/day, 500 browsing sessions/day:

- **Reads** ≈ 500 × (1 month doc + ~9 day docs across ~3 day views) + ~200 listener pushes ≈ **5,200/day** (free tier: 50,000).
- **Writes** ≈ 40 × (1 appointment + ~1.2 day + ~1.2 ledger + 1 commit key) + ~40 month merges + ~40 reconciles ≈ **300/day** (free tier: 20,000).

Derive-on-read at the same traffic would be ~330,000 reads/day. **At one shop the choice is decided by privacy and correctness, not price**; at 100 shops it is a ~65× cost gap. The real recurring line item either way is Cloud Functions: `minInstances: 1` on `commitBooking` is ~$5–10/mo and buys away a cold start on the last step of the wizard.

---

## 7. Robustness table

| #   | Failure                                                                                                                                                                                                    | Sev           | How the design handles it                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Double-booking.** Two clients book Ivan at 14:00; both succeed. Live today: `CreateBookingUseCase` does a bare `setDoc` with no cross-appointment read, and rules permit any signed-in client to create. | **Critical**  | **Unrepresentable.** `allow create,update,delete: if false` on `appointments`; `save()` deleted from the port; the only writer is `commitBooking`, which re-evaluates the overlap predicate against day docs read _inside_ the transaction. |
| 2   | **Client names its own price/duration.** A 40 € cut booked for 0,01 €.                                                                                                                                     | **Critical**  | **Unrepresentable.** The intent carries no price. The server loads `services/{id}` and resolves `Service.resolveTermsFor` itself; the client's quote is advisory and a mismatch returns a typed `QuoteChanged` with old and new.            |
| 3   | **DST gap.** `2026-03-29T03:30` Europe/Sofia is silently relocated to 04:30 with `isValid: true` (verified).                                                                                               | High          | **Unrepresentable.** `ZonedDateTime.fromParts`/`atTime` default to `resolution: 'reject'` and return `NonexistentLocalTimeError`; `TimeSlot.create` rejects too. The engine never emits a gap start.                                        |
| 4   | **DST ambiguity.** `2026-10-25T03:30` resolves silently to the first of two occurrences; the second hour of capacity is unreachable (verified).                                                            | Medium-High   | **Detected + explicit.** `AmbiguousLocalTimeError` unless `'earlier'`/`'later'` is passed. The engine enumerates both occurrences because it works on **instants**, so the 25-hour day yields its extra hour.                               |
| 5   | **Sort inversion.** `orderBy('timeSlot.startIso')` is chronologically wrong across offsets — verified: `'…03:15+02:00' < '…03:30+03:00'` lexically, but the instants are 01:15Z vs 00:30Z.                 | High          | **Unrepresentable.** `startMs`/`endMs` epoch integers are the **only** query/sort/range key. The `timeSlot.startIso` index is replaced. Both derived by one serializer.                                                                     |
| 6   | **Seat states its duration twice.** `terms.durationMinutes` and `slot` are independent; a seat can bill 45 min and occupy 15.                                                                              | Critical      | **Unrepresentable.** `SeatProps.slot` → `SeatProps.start`; `slot` becomes a derived getter over `TimeSlot.fromDuration(start, terms.durationMinutes)`. One duration.                                                                        |
| 7   | **Editing hours rewrites history.** Denominators for every past Tuesday change silently.                                                                                                                   | Critical      | **Unrepresentable.** `StaffScheduleHistory.amend` refuses `effectiveFrom <= today`; past versions immutable; past day ledgers sealed after 7 days and refused thereafter.                                                                   |
| 8   | **A lunch break becomes a fake appointment**, polluting the ledger with `reason: 'appointment'` and destroying the exact statistic asked for.                                                              | High          | **Unrepresentable.** `WeeklyPattern` is a list of windows per weekday. `break` is a first-class reason.                                                                                                                                     |
| 9   | **Party no-show is unrecordable.** One of three guests doesn't turn up; `markNoShow()` erases two completed services, `complete()` erases the no-show.                                                     | High          | **Unrepresentable.** `SeatOutcome` per seat; `Appointment.status` derived from seats.                                                                                                                                                       |
| 10  | **Duplicate booking on retry.** Timeout + retry creates a second appointment and blocks the time twice.                                                                                                    | High          | **Unrepresentable.** `idempotencyKey` minted once on entering `review`, carried in `BookingDraft`, read as the **first** operation in the transaction; a replay returns the existing appointment as success.                                |
| 11  | **Double-tap on Confirm.**                                                                                                                                                                                 | Medium        | **Unrepresentable.** `BookingFlowState` gains a `submitting` arm carrying the key; the button's disabled state derives from the machine, not a template flag.                                                                               |
| 12  | **Duplicate/out-of-order trigger delivery** double-counts or corrupts.                                                                                                                                     | High          | **Unrepresentable.** Deterministic block ids (`svc:{apptId}:{seatId}`) give set semantics; every writer is a convergent recompute; `FieldValue.increment` is banned for displayed statistics.                                               |
| 13  | **Cancelled time keeps blocking.** Silent lost revenue, no error.                                                                                                                                          | High          | **Unrepresentable.** Cancelling _removes_ the block and appends a `cancelled` **event**. `busySet` reads `blocks`, which no longer contains it.                                                                                             |
| 14  | **Buffers kill sequential parties.** Uniform padding makes a father-and-son chain with one barber fail to appear on a busy day.                                                                            | Medium-High   | **Unrepresentable.** Zero turnaround between two seats of the same party for the same barber inside one option; full padding only against the _persisted_ set. Pinned by a test asserting the resulting gap.                                |
| 15  | **Sum-vs-max buffer semantics silently doubles the gap.**                                                                                                                                                  | Medium        | **By construction.** Pad each persisted busy interval on both sides; never pad the candidate. One rule, one place, one test.                                                                                                                |
| 16  | **Non-determinism** from iterating Firestore-derived `Set`/`Map`/objects → jittering slot grid, unreproducible bug reports.                                                                                | High          | **Detected, aggressively.** Every tiebreak terminates in an id; the shuffle-all-inputs property test asserts byte-identical output.                                                                                                         |
| 17  | **Employee health data leaks.** `reason: 'sick'` on a world-readable doc (GDPR Art. 9).                                                                                                                    | Critical      | **Unrepresentable.** Reasons live only in the `private/ledger` subcollection, which is not covered by the parent's rule. Pinned by a rules-unit test asserting the public doc's exact key set.                                              |
| 18  | **Client identity leaks** via `SeatLabel` (`'Walk-in 14:30'`) or a `serviceId` fingerprint.                                                                                                                | Critical      | **Unrepresentable.** The public doc carries geometry only, with adjacent busy intervals **merged** so a scraper cannot even count clients served.                                                                                           |
| 19  | **Month rollup pulled into the transaction** serialises every booking at a location.                                                                                                                       | High (latent) | **Detected.** Written outside, single-field-path merge, with a comment and a test. This is flagged as the design's most likely future regression.                                                                                           |
| 20  | **One malformed appointment blanks the whole dashboard, forever** — `toDomain` failure calls `onError` and returns, and `subscribeWithRetry` retries the poison doc indefinitely.                          | Medium-High   | **Degrades one row.** Skip-and-report: emit what parsed, surface malformed ids to monitoring. A data-quality problem must never take out a view.                                                                                            |
| 21  | **Barber double-booked across two shops** on the same day.                                                                                                                                                 | High          | **Unrepresentable.** The day doc keys on `(barberId, day)` — one person, one document — with `locationId` per window and per block.                                                                                                         |
| 22  | **Silent wrong duration** because `Service.termsFor` is total and returns base terms for a barber who does not perform the service.                                                                        | High          | **Unrepresentable on the scheduling path.** `resolveTermsFor` returns a `Result`; `termsByLine` simply omits ineligible barbers. `termsFor` stays total for catalog display only.                                                           |
| 23  | **Projection drift** between the transaction writer and the reconciling trigger.                                                                                                                           | Medium        | **Detected + repairable.** Both are convergent recomputes over the same sources, so they agree; `detectProjectionDrift` runs nightly and `rebuildBarberDays` repairs.                                                                       |
| 24  | **Missing day doc at the horizon edge** reads as "unavailable" after a few silent failures of the nightly job.                                                                                             | Medium        | **Detected + self-healing.** The commit transaction materialises a missing day **inline** from schedule + location (2 extra reads on the cold path); the scheduled job alerts on failure.                                                   |
| 25  | **Blocks outside windows / windows shrunk under blocks** → negative idle, utilisation >100%.                                                                                                               | Medium        | **Refused, not clamped.** `BarberDay.place` and the roster-change path return a `Result` failure. Clamping would make the corruption invisible and permanent.                                                                               |

---

## 8. What changes in the code that already exists

**Deleted:**

- `libs/domain/scheduling/src/lib/working-hours.ts`, `.errors.ts`, `.spec.ts` + 2 barrel exports in `libs/domain/scheduling/src/index.ts`. (The `libs/domain/models` twin **stays** — it is live via the legacy `Staff` aggregate.)
- `AppointmentRepository.save()` in `libs/application/booking/src/lib/ports/appointment-repository.port.ts`, and `FirestoreAppointmentRepository.save()` in the adapter.
- The client-cancel branch in `firestore.rules` (`affectedKeys().hasOnly(['status'])`).

**Domain surgery:**

- `libs/domain/kernel/src/lib/zoned-date-time.ts` + `.errors.ts` — the six additions and the DST resolution policy.
- `libs/domain/scheduling/src/lib/seat.ts` — `SeatProps.slot` → `start`; `slot` derived; add `outcome: SeatOutcome`, `occupancy()`, and a `display: SeatDisplaySnapshot` freezing localized service name, variant name and barber name at commit (the same argument that already justified snapshotting terms — without it, archiving a service makes past receipts unlabelable).
- `libs/domain/scheduling/src/lib/seat.ts` — `collidesWith` restated on **occupancy** intervals, not whole slots. Behaviour is identical until occupancy data exists; changing a core aggregate invariant is cheap today and expensive under a live schedule step.
- `libs/domain/scheduling/src/lib/appointment.ts` — `validateSeats` uses the occupancy predicate; add `bookedAtMs`, `origin`, `bookedFromAppointmentId`, `createdBy`; `complete()`/`markNoShow()` → `markSeatOutcome(seatId, outcome)`; root `status` derived; `timeSlot` envelope uses the new `ZonedDateTime.min/max` instead of the hand-rolled `reduce`.
- `libs/domain/scheduling/src/lib/time-slot.ts` — `create` rejects non-existent local times; add `fromDuration`, `durationMinutes`, `abuts`, `toInterval`; `calendarDayKey` delegates to `ZonedDateTime.toISODate` (deleting the local `pad2`).
- `libs/domain/scheduling/src/lib/appointment-status.ts` — becomes a derivation of seat outcomes; `cancelled`'s free-text `reason: string` → the closed `CancellationReason` union.
- `libs/domain/catalog/src/lib/service.ts` — add `resolveTermsFor` (strict).
- `libs/domain/catalog/src/lib/service-terms.ts` — add `occupancy`.
- `libs/domain/catalog/src/lib/barber.ts` — add `bookableFrom: CalendarDay | null` (a barber joining next month). `status` is used to filter **availability** and explicitly **not** statistics, so a departed barber's contribution never vanishes.

**Application:**

- `libs/application/booking/src/lib/flow/booking-flow.ts` — `ScheduleSelection` widens to `{ locationId, assignments: readonly SeatAssignment[], quotedAtMs, holdId }`; `MAX_PARTY_SIZE` moves into `BookingPolicy`; add the `submitting` state arm. Doing this as **one named-type widening** (not sibling fields) means the review step, the draft serializer, the persist path and the commit mapper all break at compile time in one pass — which is what you want.
- `libs/application/booking/src/lib/ports/booking-draft.ts` — `timeSlot: TimeSlotProps | null` → `assignments: readonly SeatAssignmentProps[]` + `idempotencyKey: string | null`, keeping the JSON-round-trip property.
- `libs/application/booking/src/lib/use-cases/create-booking.use-case.ts` — becomes `CommitBookingUseCase` sending an intent.
- `libs/application/booking/src/lib/use-cases/observe-upcoming.use-case.ts` + the adapter — add a lower `startMs` bound (today it reads a user's **entire** appointment history on every dashboard mount).

**Features / UI:**

- `libs/features/client/booking/src/lib/booking-flow.store.ts` — draft serialisation of assignments; `submitting`; idempotency key lifecycle; **keep** the existing refusal to restore past `services` — persisted assignments are advisory until re-validated.
- The schedule step component (Phase 3 target) — renders `DayAvailability`, including the typed `UnavailableReason`. Availability is fetched as a **snapshot with a freshness marker**, not a live `onSnapshot` — rows vanishing mid-scroll cause mis-taps, which on mobile means booking the wrong time. Commit-time re-validation is the correctness guarantee.
- `libs/features/client/appointments/src/lib/appointment-groups.ts`, `calendar-month.ts`, `client-appointments.html`, `client-account.ts` — currently render only `timeSlot.start` (the envelope). For a sequential party the envelope is honest as a block but says nothing about who is served when; add per-seat time + barber rows.

**Infrastructure:**

- `libs/infrastructure/firestore/src/lib/firestore-paths.ts` — 9 new collections + ref helpers.
- `libs/infrastructure/firestore/src/lib/appointment-repository.adapter.ts` — `toPersistence` emits `startMs`/`endMs` mirrors and per-seat `startMs`; `save` removed; `observeUpcomingFor` bounded and switched to skip-and-report.
- New: `availability-reader.adapter.ts`, `staff-schedule-reader.adapter.ts`, `booking-policy-reader.adapter.ts`, `booking-commit.adapter.ts` (Callable, mirroring `CallableOtpClient`), `barber-statistics-reader.adapter.ts`.
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`.
- `apps/web/src/app/app.config.ts` — five new providers.
- `apps/functions/tsconfig.app.json` — add `domain/scheduling` + `domain/catalog` references via `pnpm nx sync`.

**Seed / E2E — must be fixed in the same pass:**

- `apps/web/e2e/support/seed-firestore.ts:103-133` writes the **pre-Phase-2** appointment shape (root `barberId`, seats missing `barberId`/`terms`/`slot`). `buildSeats` calls `BarberId.create(undefined)` → `raw.trim()` → a **TypeError**, not a `Result` failure, which escapes into Firestore's `onSnapshot` dispatcher. Six call sites across four specs.
- `tools/seed-dev-catalog.mjs` grows from ~456 to ~750 lines: per-barber schedules with at least one **split shift**; a barber whose hours exceed the location's (proves clamping — `loc-center` closes 20:00 Mon–Thu, `loc-mladost` is closed Mon **and** Sun); four exception kinds plus a recurring break; an **effective-dated change** (Niko's hours change from a future date) so historical stability is provable; a **parallel** two-seat party and a **sequential** one; an appointment whose seats differ in duration so the envelope is strictly wider than the longest seat; appointments spanning **2026-03-29** and **2026-10-25**; a fully-booked day; a cancelled and a no-show. Also set a non-empty `locationIds` on at least one service — today every service is `[]`, so the service↔location filter has **no** negative case.

---

## 9. Phased build plan

Each phase is independently shippable and testable. Sizes assume one experienced engineer.

| Phase                            | Scope                                                                                                                                                                                                                                                                                                   | Key files                                                                                                                                                                      | Size    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **3.0 Time kernel**              | `ZonedDateTime` ×6 additions, `DstResolution`, DST errors, `TimeSlot` hardening + `fromDuration`/`abuts`/`toInterval`, `startMs`/`endMs` mirrors in the appointment adapter, index swap                                                                                                                 | `zoned-date-time.{ts,errors.ts,spec.ts}`, `time-slot.{ts,errors.ts,spec.ts}`, `appointment-repository.adapter.ts`, `firestore.indexes.json`                                    | 4–5 d   |
| **3.1 Interval algebra**         | `Interval`, `IntervalSet` (normalize/subtract/intersect/union/pad/clipToDay), `CalendarDay`, `LocalTimeOfDay`. Property-tested, no I/O.                                                                                                                                                                 | `interval.ts`, `calendar-day.ts`, `local-time-of-day.ts` + specs                                                                                                               | 3 d     |
| **3.2 Schedule model**           | Delete `working-hours.*`; `WeeklyPattern`, `DayWindow`, `RosterWindow`, `StaffScheduleVersion`, `StaffScheduleHistory`, `ScheduleException`, `buildDayWindows`                                                                                                                                          | `weekly-pattern.ts`, `roster-window.ts`, `staff-schedule.ts`, `schedule-exception.ts` + specs                                                                                  | 5–6 d   |
| **3.3 Occupancy + BarberDay**    | `OccupancyReason`, `OccupancyClass` + `classifyOccupancy`, `OccupancyBlock`, `SeatOutcome`, `DayEvent`, `BarberDay` aggregate incl. `materialise`/`place`/`totals`/`toPublicProjection`, `BarberDayTotals`                                                                                              | `occupancy-*.ts`, `seat-outcome.ts`, `barber-day.ts`, `barber-day-totals.ts` + specs                                                                                           | 6–7 d   |
| **3.4 The engine**               | `BookingPolicy`, `policyClamps`, `candidateStarts`, `solveDay` (backtracker), `rankOptions`, `hasAnyOption`, `DayAvailability`/`UnavailableReason`. **Determinism property test.** DST fixtures on 2026-03-29 / 2026-10-25.                                                                             | `booking-policy.ts`, `availability.ts` + specs                                                                                                                                 | 7–9 d   |
| **3.5 Aggregate surgery**        | `Seat` start+derived slot + outcome + display snapshot; `Appointment` occupancy invariant, commit metadata, derived status; `Service.resolveTermsFor`; `ServiceTerms.occupancy`                                                                                                                         | `seat.ts`, `appointment.ts`, `appointment-status.ts`, `service.ts`, `service-terms.ts`                                                                                         | 4–5 d   |
| **4.0 Firestore projection**     | Paths, 9 collections, rules + **rules-unit tests** (incl. the key-set pin), indexes + field overrides, reader adapters                                                                                                                                                                                  | `firestore-paths.ts`, `availability-reader.adapter.ts`, `staff-schedule-reader.adapter.ts`, `firestore.rules`, `firestore.indexes.json`, `firestore.rules.integration.spec.ts` | 5–6 d   |
| **4.1 Cloud Functions**          | `setGlobalOptions` region; `commitBooking` transaction; `cancelBooking`/`rescheduleBooking`/`markSeatOutcome`; `onAppointmentWritten` reconciler; `onScheduleWritten`/`onLocationWritten`; `rebuildBarberDays`; `extendAvailabilityHorizon`; `detectProjectionDrift`; tsconfig references via `nx sync` | `apps/functions/src/lib/booking/*`, `apps/functions/src/lib/availability/*`, `main.ts`, `tsconfig.app.json`                                                                    | 10–12 d |
| **4.2 Client rewiring**          | Ports + providers; `ScheduleSelection` widening; `BookingDraft`; store; `submitting`; idempotency; `save()` removal; `observeUpcomingFor` bound + skip-and-report                                                                                                                                       | `booking-flow.ts`, `booking-draft.ts`, `booking-flow.store.ts`, `booking-commit.adapter.ts`, `app.config.ts`                                                                   | 5–6 d   |
| **5 Authoring + seed**           | Staff schedule editor (or a `tools/` script — open question #1), exception recording, seed rewrite, E2E seed fix                                                                                                                                                                                        | `tools/seed-dev-catalog.mjs`, `apps/web/e2e/support/seed-firestore.ts`, staff feature lib                                                                                      | 5–7 d   |
| **6 Statistics surface**         | `computeUtilisation`, `rollUpBarberPeriods`, `sampleBarberLeadTime`, sealing job, staff dashboard                                                                                                                                                                                                       | `barber-utilisation.ts`, `apps/functions/src/lib/stats/*`, staff feature lib                                                                                                   | 5–6 d   |
| **7 Holds + waitlist**           | `SlotHold`, `holdSlot`/`releaseHold`, `sweepExpiredHolds`, hold-aware UI, waitlist fork                                                                                                                                                                                                                 | `slot-hold.ts`, `apps/functions/src/lib/booking/hold-slot.ts`                                                                                                                  | 4–5 d   |
| **8 (optional) Processing gaps** | Populate `ServiceTerms.occupancy`, catalog authoring UI                                                                                                                                                                                                                                                 | `service-terms.ts`, catalog admin                                                                                                                                              | 3–4 d   |

Phases 3.0–3.5 are pure domain and ship behind no flag — they are testable with `nx test` and no emulator. Phase 4.0 onward needs `firebase emulators:exec` (already wired as the root `test:emulator` script).

---

## 9a. OWNER RULINGS — 2026-07-29

These four are settled and override the recommendations in §10 where they differ.

### R1. Bookable window vs. valid placement — two different questions

The owner's words: _"barber to be possible to track his bookings and even to be
possible to make ones outside of working hours, but that won't actually change
shop working hours — so barber should not override them, but should be possible
for himself to add appointments outside ad-hoc."_

This splits a distinction §10 Q1 collapsed:

|                                                      | rule                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Bookable window** (public `/book`, anonymous read) | `shop hours ∩ barber roster` — **intersect**. A client can never be offered a time the shop is shut.             |
| **Valid placement** (staff-initiated commit)         | **unbounded**. Staff may place an appointment anywhere, including outside rostered hours and outside shop hours. |

A barber never changes the shop's hours. `Location.hours` stays the public
bound; a barber working late is a fact about that barber's day, not a change to
the shop.

**Consequence for `BarberDay`:** the aggregate must ACCEPT blocks outside
`windows` — the research listed "blocks placed outside the frozen windows" as a
corruption to refuse, and for roster-derived blocks it still is, but a
staff-placed appointment outside hours is now a legitimate, expected state.
It is marked `outsideWindow: true` at placement.

**Consequence for utilisation** (or the percentage exceeds 100%):

```
overtimeMinutes   = Σ(productive blocks outside windows)
scheduledMinutes  = rosteredMinutes − excludedMinutes + overtimeMinutes
utilisation       = productiveMinutes / scheduledMinutes        // stays ≤ 100%
```

`overtimeMinutes` is reported as its own line — "Ivan worked 40 minutes beyond
his roster" is exactly the kind of thing this model exists to surface.

### R2. Utilisation denominator

**IN** (sellable time that went unsold): `service` (all outcomes, including
**no-show**), `buffer`, **`admin`** blocks.
**OUT** (never sellable): unpaid `break`, `time_off`, `sick`, `training`,
`travel`.

Unchanged from the §4.1 table; confirmed by the owner.

### R3. Buffers — per barber AND per service

The owner asked the right question first: _"if it's for buffers, one barber
would set bigger duration for the entire service execution, no?"_ — and for the
availability grid alone that is exactly right, `duration + pad` and
`duration' = duration + pad` are indistinguishable. Buffers earn their place
only because of what else reads the number:

1. `durationMinutes` is half of `ServiceTerms` and is rendered next to the
   price. Padding it makes the UI quote 45 min for a 35-minute haircut.
2. Padding it makes cleanup count as **productive** time, so utilisation
   inflates and R2's `bufferMinutes` line becomes uncomputable — the exact
   statistic the owner asked for.
3. Turnaround is a fact about a _barber_; baked into duration it must be
   re-authored across every service × variant that barber offers.
4. Ruling #1's same-barber back-to-back party cannot be expressed at all when
   the pad is _inside_ the duration.

**The model:**

```
Barber.turnaroundMinutes                     // baseline reset, default 0
ServiceTerms.setupMinutes / cleanupMinutes   // default 0
```

`ServiceTerms` is already resolved per (barber, variant), so per-service padding
inherits both axes for free — "Ivan's colour needs 15 min cleanup" needs no new
dimension.

**Each is applied in exactly ONE place** — corrected 2026-07-29 after building
it, when a 45-minute service was rejected from a 45-minute gap:

| pad                         | where it is applied                                 | why there                                                                                                                                      |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **barber turnaround**       | by padding each persisted BUSY interval, both sides | a padded busy block already stops a new booking ending too close to it _and_ starting too soon after it — one operation covers both directions |
| **service setup / cleanup** | by extending the CANDIDATE's occupied span          | it is part of this booking's own footprint, so it must be reserved when the booking is made                                                    |

The first draft did both — `padAfter = max(turnaround, cleanup)` on the
candidate _plus_ padded busy intervals — which charges one turnaround's worth
of separation twice. `availableOptions` therefore has **no `turnaroundMinutes`
input at all**: `BarberDayAvailability.busy` must arrive pre-padded, which makes
the double-count unrepresentable rather than merely tested-against.

The same-party rule falls out for free. Each pick tracks two spans: the `slot`
the client bought and the `occupied` span (slot + that line's own setup and
cleanup). Collision and subtraction use `occupied`, so a colour's cleanup still
separates two seats of one party while the barber's turnaround — living only in
`busy` — cannot. A father and son with one barber abut exactly.

### R4. Schedule authoring

`tools/seed-schedules.mjs` now; staff editor as its own phase. The engine is not
blocked on a screen.

---

## 9b. DECISIONS TAKEN DURING THE BUILD — 2026-07-30

Four things the design did not pin down, each found by exercising the real
thing against seeded data.

### B1. A shop that publishes `closed` is not a shop with no hours

`ShopDayHours` documented `null` as "publishes none", but `buildDayWindows`
treated `null` and `{intervals: []}` identically. A shop closed on Sunday
materialises to the empty set, so every barber's Sunday roster stood
unclamped and Sunday was publicly bookable. The distinction is now carried by
PRESENCE: `null` imposes no bound, `{intervals: []}` intersects to nothing.
`shopDayHours(day, locationId, weeklyHours)` in `roster-window.ts` is the one
place `Location.hours` becomes that value — shared by the browser grid and
the server's commit-time re-check, so the two cannot disagree about Monday.

### B2. Terms depend on the barber, so the engine must too

The catalog prices per (barber, variant) and the engine took ONE
`durationMinutes` per line. With an `any` preference that is wrong in both
directions: the maximum hides the faster barber's short gaps, the minimum
books the slower one into a slot they cannot finish. `AvailabilityLine` now
carries `termsByBarber` (keyed by `BarberId.value`) with the flat fields as
the catalog default, and the search resolves terms per candidate barber.
Line ORDERING still uses the default duration — the order must not depend on
which barber a branch happens to be trying.

### B3. `ServiceTerms.setupMinutes` / `cleanupMinutes` — as ruled in R3

Implemented on `ServiceTerms`, defaulting to 0, with `occupiedMinutes()` =
setup + duration + cleanup. Because terms are already resolved per (barber,
variant), padding inherits BOTH axes for free — "Ivan's colour needs 15
minutes of cleanup" needed no new structure. The pads stay OUTSIDE the sold
duration: the client is quoted and charged for the service, `bufferMinutes`
stays computable, and two seats of one party can still share a chair
back-to-back.

### B4. The grid needs breadth, not depth — `availableStarts`

`availableOptions` is capped (200) so a wide-open day cannot explode. With a
party of two and three barbers that cap is spent before noon, so the slot
grid showed a morning-only shop: the afternoon was never enumerated.
Post-filtering to distinct starts cannot fix it — the options were never
generated. `availableStarts` deduplicates DURING the search, keeping one
arrangement per envelope start, so the same budget buys the whole day.

Two refinements the seeded data forced:

- The kept arrangement is the TIGHTEST for that start (smallest envelope,
  ties on barber ids), not the first reached. The first walk offered "you at
  09:00, your son at 10:55" when 09:00 + 09:30 back-to-back existed.
- Deduping removed the option cap's incidental brake on the search, so there
  is now an explicit node budget (200k placements). A pathological query
  degrades to a shorter list rather than a frozen tab.

### B5. Design-system additions this step needed

- `UiForegroundStyle` gained `tertiary` (≙ SwiftUI's third hierarchical
  rung) with `--sys-color-tertiary-label` in both themes. A day with nothing
  free and a supporting caption are not the same weight.
- `UiDateBadge` gained an `unavailable` state. It describes the day; the
  consumer still disables its own button.
- On the booking grid, **bookability outranks month membership**: a padding
  day that can be booked renders `plain`, not `outside`. On the 30th the
  padding row is most of what a client can actually book, and rendering
  bookable and unbookable days in the same grey left the one question the
  grid exists to answer unanswered.

---

## 9c. THE WRITE PATH — 2026-07-30

### The client cannot create an appointment. At all.

`firestore.rules` allows `create` on `appointments` only to staff, and
`FirestoreAppointmentRepository.save()` refuses outright. The one door is the
`commitBooking` callable, and it re-derives everything that decides whether a
booking is legal or what it costs:

| The client sends                | The server derives                                         |
| ------------------------------- | ---------------------------------------------------------- |
| service, variant, barber, start | terms via `Service.termsFor(barber, variant)`              |
| —                               | the owner, from the verified auth token                    |
| —                               | windows via `buildDayWindows` + the shop's published hours |
| —                               | conflicts, re-checked per person                           |
| —                               | collisions, against the busy set read in the transaction   |

A client that could name its own price would book a 40 € fade for nothing; one
that could name its own duration would book over the next appointment; one that
could name its own owner would book in someone else's name. None of the three
is expressible in the request shape.

### How the race resolves

`FirestoreBookingStore.commit` reads the shop, the services, the rosters and
each `barberBusy/{barber}__{day}` INSIDE one transaction, then writes the
appointment and the merged busy document. Two clients confirming 14:00 with
Ivan read the same busy doc, and Firestore lets exactly one commit. The loser
retries, re-reads a busy set that now contains the winner, and `decideBooking`
returns `slot_unavailable` — the review step steps back to a freshly computed
grid with the day intact.

Absent busy documents are read too: an empty read still enters the conflict
set, so racing for a barber's FIRST booking of the day still serialises.

### Two bugs the first draft had, both caught before they shipped

- The busy merge read from instance state that was never populated, so a write
  would have DROPPED every other booking in that document. The read base is now
  carried per attempt (`LoadedAttempt`), never on the store — a transaction can
  retry, and two invocations of a warm instance overlap.
- The location check was a hand-rolled `locationIds.some(...)`, which reads the
  catalog's "empty ⇒ every location" as "nowhere" and refused every service the
  shop never bothered to scope. `Service.servesLocation` already existed.

### Verified against the emulators, not just in unit tests

A real appointment written with server-resolved terms (15,50 € / 45 min from
Niko's offering, never from the payload); the owner bound to the token; the
same slot refused a second time with `slot_unavailable`; unauthenticated
refused; Sunday, a lunch break, a 10-minute turnaround, the 120-minute lead
time, a forged variant and a missing required variant all refused; a party of
two committed both back-to-back with one barber and in parallel across two.

---

## 9d. MULTI-LOCATION ROSTERS — 2026-07-30 (owner correction)

### What was wrong

`StaffScheduleHistory` carried ONE `locationId`, and so did every version. A
barber was therefore a permanent fixture of a single chair: they could not
cover Center on Monday and Mladost on Tuesday, and certainly not both in one
day. That is not how a two-shop business works — it is the ordinary case.

The tell was already in the code: `RosterWindow` carried `locationId` per
window with a comment saying "a barber may work two shops in one day". The
window type anticipated it; the pattern had no way to say it.

### The fix: the location rides on the SHIFT

`ShiftSegment = { range: LocalTimeRange, locationId: LocationId }`, and
`WeeklyPattern` holds segments per weekday instead of bare ranges. The version
and the history drop `locationId` entirely; ask the pattern
(`locations()`, `worksAt()`) where a barber works.

That is also the granularity utilisation needs: each shop's capacity is its own
number, and a segment is the smallest thing attributable to one shop.

| Concern                 | Where it lands                                                |
| ----------------------- | ------------------------------------------------------------- |
| Two places at once      | `WeeklyPattern.create` rejects overlapping segments           |
| Travel between shops    | `minTransferMinutes` refuses a segment pair too close to work |
| Shop hours              | each segment clipped to ITS OWN shop's published hours        |
| Booking at one shop     | `windowsAt(windows, locationId)` narrows the pool             |
| A barber busy elsewhere | busy stays location-AGNOSTIC, so it blocks everywhere         |

**Travel is refused, not trimmed.** Center until 13:00 and Mladost from 13:00
is not a shift, it is a teleport. Silently trimming the second segment would
shrink the grid for a reason nobody can see; refusing the pattern puts the
mistake where a human can fix it. The same shape at ONE shop stays a legal
split shift, because nobody travels.

**Who works where is the ROSTER's answer, not the catalog's.** The schedule
step now passes every active barber and lets the windows decide. Pre-filtering
on `Barber.locationIds` looked like a cheap optimisation and was a drift
hazard: a barber whose roster covers Mladost but whose editorial list had not
caught up would silently vanish from that shop's grid.

### Availability is partitioned by shop, and the engine never learns about places

`optionsForDay` groups each barber's windows by location and runs the engine
once per shop, tagging every option with the shop it happens at. Handing the
backtracker a mixed pool would let it seat a father at Center and his son at
Mladost at the same time — geometrically valid, physically absurd, and
unrepresentable anyway, since an `Appointment` holds one `locationId`. Running
N times instead of teaching the engine about places leaves the hard,
property-tested part untouched.

This is also what makes "any shop" possible: `locationId` is now nullable all
the way down, and a null keeps every rostered window a candidate.

### Verified against the emulators

Niko's seeded Wednesday is Center 09:00–13:00 then Mladost 15:00–19:00:

| Attempt               | Result                                             |
| --------------------- | -------------------------------------------------- |
| 10:00 @ Center        | committed                                          |
| 10:00 @ Mladost       | `slot_unavailable` — he is at Center               |
| 16:00 @ Mladost       | committed                                          |
| 16:00 @ Center        | `slot_unavailable` — he is at Mladost              |
| 14:00 @ Mladost       | `slot_unavailable` — before that shift             |
| Ivan Friday @ Mladost | committed                                          |
| Ivan Friday @ Center  | `barber_not_rostered` — no Center segment that day |

The last two rows are the distinction worth keeping: "not at this shop today
at all" and "at this shop, but not then" are different facts, and only the
second is worth re-picking a time over.

In the browser, the Center grid for that Wednesday opens at 09:00 while the
Mladost grid holds exactly 15:00–18:15 — the afternoon shift, clipped by the
shop's 19:00 close and the service's own length.

---

## 9e. WHERE BECOMES STEP ONE — 2026-07-30

### The order

`location → guests → services → schedule → review`. Location leads because it
changes everything after it: which barbers exist, which services are offered,
which hours apply. Asking it on the WHEN screen — where it started — meant the
grid had to be rebuilt the moment it was answered.

### It is optional, and "Any shop" is how

`locationId` is nullable the whole way down: the flow state, the reader port,
the use-case, the engine partitioning. `null` is a CHOICE, not an unanswered
question, so `next` from step one has no precondition and cannot fail.

Offered as a first-class **row** — _Any shop · wherever is soonest_ — rather
than a "Skip" link. A row names what will happen; "Skip" only names what you are
avoiding, and makes an ordinary answer feel like a shortcut. It is also the
better answer more often than it looks: with barbers whose weeks span both
shops, not filtering genuinely widens the offer.

The consequence is carried through: under "any shop" every time chip names its
shop (two shops can be free at the same minute, and they are different
appointments), the selection is keyed by shop AND start, and review names the
shop it committed to.

### The presentation: map behind, list on a detented sheet

Apple's pattern for "which of these places" — Maps, Find My, the Store — is a
full-bleed map with the list on a sheet that drags between detents. There is
deliberately **no map/list segmented control**: they are not modes, they are the
same question at two zoom levels, and the sheet's height is how the user says
which one they are thinking with. A segmented control would make them pick a
tool before answering.

Two DS pieces came out of this:

- **`ui-detent-sheet`** — ≙ `.presentationDetents([.medium, .large])` with
  `.presentationBackgroundInteraction(.enabled)`. Non-modal (no scrim, no focus
  trap, background stays live), drag with velocity-aware settling, a real
  `<button>` handle for tap and arrow keys, and the iOS scroll hand-off where
  dragging down from a content area already at the top moves the sheet.
  Distinct from `ui-sheet`, which is modal and right for anything that
  interrupts.
- **`ui-map`** — ≙ SwiftUI's `Map` with `Marker`s. Extracted from the landing's
  locations section with all of its hard-won knowledge intact: the UMD
  `.default` import, MapLibre's attribution that mounts expanded, stacking
  containment for the cooperative-gesture veil, off-screen edge indicators, and
  why pin transforms must never be transitioned.

### The action bar stays where it always is

The first pass put the step's CTA inside the sheet's header, because the
sheet's box extends below the fold and anything after the list is unreachable
until it is dragged all the way up. That solved reachability and broke rhythm:
four steps pinned their primary action to the bottom edge and the fifth put it
somewhere else.

`ui-page-action-bar` gained `uiAnchor="pane"` instead — same bar, same slot
contract, same thumb-zone geometry, anchored to a positioned box rather than
sticking to a scrolling column (this screen does not scroll, so `sticky` has
nothing to stick to). It rides ABOVE the sheet, so the action is reachable at
every detent, which is what the header placement was for in the first place.

Two details that fall out of it: the `small` peek is dropped from this step's
detents (a 20% sheet would be almost entirely behind the bar — a detent that
shows nothing wastes a drag), and the bar's dissolve ramp is keyed to
`--ui-action-bar-scrim`, which the step points at the sheet's surface. Left at
the page background it faded list rows into a colour that is not underneath
them, which reads as a smudge rather than as content passing under a control.

### Six corrections from using it on a phone

1. **The grabber sat in the wrong place** — centred in its 44px button rather
   than 5pt off the sheet's top edge, which is where `ui-sheet-header` puts it.
   The owner read that instantly as "this isn't our sheet component". Now
   identical metrics: 36×5pt, `foreground 28%`, absolutely positioned at the
   top; the button box still carries the 44px target.
2. **The list scrolled only at the tallest detent**, so a third shop simply
   could not be reached without finding the handle. It scrolls at every detent
   now, and below the tallest one a drag ANYWHERE in the sheet raises it — the
   gesture a user reaches for when they try to scroll a half-height sheet is
   "make this bigger", so that is what it does.
3. **The leading glyph hung above the name.** `uiAlignment="leading"` is right
   for a stacked label, but the glyph is one line tall against a two-line
   block, so it floated. Centred, like the menu rows.
4. **"Any shop" left the camera where it was.** Clearing the selection now
   pulls back to frame every pin: "any of them" is a statement about the whole
   set, so the map shows the whole set. Selecting one still flies in.
5. **The action bar hid the last row** on a short screen — fixed by 2 above
   plus the bar's own dissolve ramp.
6. **The toolbar was a solid strip** slicing the top off the map. It uses the
   new `scrim` background, overlaying the map with the same quintic dissolve
   the action bar uses, pointing down instead of up.

### Three more from a real thumb

- **Dragging over the shop rows did nothing.** The handler refused any gesture
  starting on a control so that a row tap stayed a row tap — but the rows ARE
  buttons, so the sheet only moved from the gaps between them. What separates a
  tap from a drag is DISTANCE, not target: gestures are now tracked from
  `pointerdown` anywhere and claimed past an 8px threshold, with the click a
  claimed drag would deliver swallowed by a capture listener. That suppression
  disarms on the next `pointerdown` — armed indefinitely, it ate a legitimate
  tap seconds later.
- **The camera "sometimes" did not follow the choice.** Four causes, found one
  at a time. A selection made before the style loaded was overridden by the
  first pin sync's framing — the selection effect now depends on readiness and
  the sync defers to an existing selection. At the tallest detent the inset ate
  70% of the viewport, so a fit into the remaining sliver threw the pins
  off-screen and LEFT them there, since the camera keeps that state when the
  sheet comes back down; the inset is capped at half the map. The sheet's
  coverage was applied TWICE — as the transform's persistent padding and again
  as `bottom` on every `fitBounds` — and removing the per-call padding instead
  went the other way, because `fitBounds` computes from `options.padding` alone
  and never consults the transform. It is stated exactly once now, per camera
  call: asymmetric `padding` on `fitBounds`, a vertical `offset` on `flyTo`.
  Finally the fit ignored the toolbar overlaying the TOP, landing a pin at
  y=52 under a 52px bar — hence `uiTopInsetPx`.

  Verified across thirteen consecutive switches: "any shop" frames both pins
  every time, a specific shop frames exactly one, no exceptions.

- **A selected pin was indistinguishable from an unselected one.** The fill was
  `--sys-color-foreground`, which is near-black on a dark basemap beside a
  black-bordered neighbour — and near-white on a light one, equally confusing.
  Selected pins are ACCENT now (head, tail and glyph), which is also the tint
  the selected ROW carries, so the map and the list visibly agree.
- **The map wanted two fingers.** `cooperativeGestures` protects a scrolling
  page from an embedded map swallowing its scroll. Here the map IS the screen,
  so it was a tax on the main interaction; `ui-map` takes
  `uiCooperativeGestures` and this step passes `false`.

### Four bugs the browser found, none of which unit tests would have

1. **The pane collapsed to zero.** The shell's column is `min-height: 100svh` —
   a minimum, not a definite height — so a percentage height on a descendant
   resolves against `auto`. The host measured 762px while the pane inside it
   measured 0. Fixed by positioning the pane absolutely against a relative host.
2. **The canvas container was `position: relative`, not `absolute`.**
   `maplibre-gl.css` is imported UNLAYERED, and unlayered author CSS beats every
   layered rule regardless of specificity, so `.maplibregl-map { position:
relative }` won over the `@layer sys-components` rule. The fix lives in
   `map.css`'s unlayered block, the same precedent the glyph rules already set.
3. **Markers were placed only at construction.** A live catalog arrives after
   the map is built, so the first render was an empty world map. Markers now
   follow the pin set, and the camera frames it the first time it is non-empty —
   never again, so a later change cannot yank the camera from someone who panned.
4. **The pins were framed behind the sheet.** A full-bleed map under a sheet
   politely centres its subject in the covered half. `uiBottomInsetFraction`
   feeds MapLibre's camera padding, and the fraction comes from the sheet's own
   exported detent table so the two cannot drift.

---

## 10. Open questions for the owner

Ranked by how much the answer changes the design. Each has a **recommended default you can approve by saying "yes"**.

**1. How do a barber's hours relate to the shop's opening hours — intersect, override, or must-be-contained?**
Changes `buildDayWindows`, the authoring UI, and whether a roster edit can fail.
→ **Recommended: INTERSECT.** The barber's roster is a claim on their own time; the shop's hours are a hard bound. Only intersection is total (never fails) and never offers a slot while the door is locked. A barber rostered past closing simply gets clipped, with no error.

**2. Who authors barber schedules in v1?**
No admin write surface, no `tools/` script and no collection exist today. Determines whether Phase 5 is a script or an app, and whether the feature is testable outside the emulator.
→ **Recommended: a `tools/seed-schedules.mjs` script + seed data now, a staff editor in Phase 5.** Ship the engine against seeded schedules; do not block the engine on a UI.

**3. May the public availability document expose merged busy intervals at all?**
The alternative is publishing only a per-slot boolean (leaks less, costs a duration assumption — which is exactly what we ruled out) or only `dayStatus` (leaks nothing, makes the grid unbuildable anonymously).
→ **Recommended: yes, merged intervals.** Merging prevents counting clients served; the residual leak is booking density, which a walk-in learns by looking through the window. **Reasons and identifiers stay staff-only, unconditionally.**

**4. Does a no-show still block the time, and does it count against utilisation?**
Changes the classification table and `busySet`.
→ **Recommended: it blocks the time (the barber genuinely stood idle in a slot nobody else could take) and stays IN the capacity denominator, non-productive.** That is precisely what separates "nobody booked" from "somebody booked and didn't come" — a marketing problem vs a deposits problem. Both look like idle time in a naive model.

**5. Is an `admin` block (manager reserves two hours) inside or outside the utilisation denominator?**
→ **Recommended: INSIDE (capacity `scheduled`).** It is a choice that consumed sellable time, and utilisation should show what it cost. Excluding it lets bad scheduling hide behind a block.

**6. Do we ship slot holds in Phase 7, or never?**
The day-doc shape reserves room either way; the question is whether we build the callables and the sweeper.
→ **Recommended: yes, Phase 7, 10-minute TTL, released on explicit abandonment.** With an unguarded `/book`, users who sign in mid-flow are the most likely to hit `slot_taken`, so the failure currently lands hardest on the highest-intent users.

**7. Do colour/processing gaps exist in this shop's service list?**
If never, `ServiceTerms.occupancy` is dead weight (though the invariant restatement is still worth doing).
→ **Recommended: adopt the shape now, leave the data empty.** Restating the double-booking invariant on occupancy costs one indirection today and is disproportionately expensive once a live schedule step depends on the whole-slot version.

**8. Buffers: per-barber turnaround, per-service setup/cleanup, or both?**
`StaffSchedule` assumes per-barber; cleanup after a colour is per-service.
→ **Recommended: per-barber turnaround is the primitive (default 0); per-service setup/cleanup is an opt-in baked into the busy interval's own `padBefore`/`padAfter` at write time**, so the projection stays self-describing and the engine needs no catalog lookup.

**9. How long before a past day is sealed against edits?**
Too short and a legitimate late correction is refused; too long and a report the owner already used for payroll silently restates.
→ **Recommended: 7 days**, with later corrections routed through an explicit, audited adjustment that appears as its own `DayEvent`.

**10. Booking policy numbers: step 15 min, minimum notice 120 min, horizon 60 days, turnaround 0, max party 5.**
Each is a constant, not a design change — but notice and horizon are the two the shop will feel daily.
→ **Recommended: as listed.** 120 minutes keeps same-day walk-ups bookable (most of a barbershop's volume) while giving the shop time to see the phone; when a day falls entirely inside the notice window the calendar renders **"call the shop"**, never a blank.

**11. Should a barber deactivation (`BarberStatus: 'inactive'`) hide them from historical statistics?**
→ **Recommended: no.** Availability filters on `status`; statistics never does. A departed barber's contribution must not vanish from last quarter. This also means `barbers` becomes archive-only (`allow delete: if false`).

**12. What is a bundle service's duration?**
`ServiceComposition` supports `{kind:'bundle', includes}`, but `durationRange` folds only the bundle's own matrix, never its parts — so a bundle occupies whatever `baseTerms` says, unrelated to what it contains.
→ **Recommended: bundle terms are authoritative, validated at catalog-edit time against the sum of the parts' minimums.** Expanding a bundle into multiple seats at booking time is the alternative and is a much larger change to the cart.
