# Pass D — brands, shapes, tags and errors across the whole codebase

**Date:** 2026-10-25 · **Status:** INTEGRATED — the FULL gate of HANDOFF §4
green against its baselines (2026-10-25, the integrator's second round, §9.3),
the §5 checklist closed (§9.1 G second round), the §6.3 DOM differential and
the §6.4 dev-stack smoke showing only DEP differences (§9.4, §9.5); the
post-integration review's six findings fixed type-level, no new DEP, and the
FULL gate green again (§9.1 Fixer, §9.3 Fixer round); lands as the "Pass D"
commit. Written on `main` at `cf91b43`
(the ECS migration complete; Law 10.2 pass `fe4635a`; pass A `99a60fa`;
pass B `6b1a7a8`; constitution `2bd2354`; pass C `cf91b43`; tree clean).
Line numbers are hints on `cf91b43` and drift as packages land; every
package re-reads its sites before it edits. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md`:
`ecs-primitives.md` (Law 7.4: one `Brand` helper, smart constructors return
`Result`, the cast only in the primitive's own file), `ecs-components.md`
(Law 1 / Law 6: one name per file, `as const` dictionaries, domain-prefixed
discriminators), `ecs-systems.md` (Law 3: branded in, branded out, purity
spec), `ecs-pipelines.md`, `ecs-ports.md` (Law 9), `ecs-layering.md` (Law 8:
one home tier per exported name, no `../` in ecs-core, specs are leaves),
`angular-ui.md`, `presenters.md` (Law 10). Law 7.3 as amended by G-1(a)
(`flatten-spec.md` §2.3 T1/T2). This plan never overrides them. ·
**Sources:** `docs/architecture/HANDOFF.md` §3.3 (the "Carried forward"
list incl. the Law 7.4 branding/T1 pass, the icon manifest `kind`, the UI
residue "Left as found" unions; "Carried from pass A"; "Carried from pass C —
for pass D and the owner"), §4 (gate and baselines), §5 (operating rules);
`flips/pass-c-ui-decisions.md` §0 (D-2.12, D-3, D-7's deliberate exception,
D-11), §8 OQ-12/OQ-14, §9.6; `flatten-spec.md` §2.3; the audit's pass-D
findings (`d-findings.json`: findings 0, 2–5, 8–10, 26–28, 31, 40, 43–47,
53–62, 76, 80, 81 and the seven carried T1 items) and the full audit for
context; the eight scout inventories the workflow handed in (staff-time,
ids-staff, ids-rest, ecs-shapes, tags-unions, errors, instants-adapters),
each row re-read here against `cf91b43`. Where this plan re-rules a scout
row, §1 says so (marked **re-ruled**).

**What this is.** Passes A–C made every system pure, every presenter, store,
component, pipeline and adapter decide nothing. What is left is TYPE-LEVEL:
values that cross a type boundary still travel as raw `string`/`number`
(ids, instants, shop days, minutes, money), the staff day still does
placement math on instants and keeps a second zone engine, several
`*.data.ts` files export many names, component-shaped dictionaries still live
in systems and pipelines, ~110 UI unions are lower-case literals compared at
use sites, and some expected failures still travel as bare codes or strings.
Pass D finishes Law 7.4 (brands), Law 7.3 T1 for the staff day (OQ-14),
Law 1 (shapes), Law 1/6.2 (tags) and Law 7.5 (errors) across the whole
codebase, and lands pass C's D-11 list on the branded contracts.

**This pass ends** when the §5 checklist finds no leftover; every existing
spec passes unchanged except the type-forced edits §4.2 lists and the cases
a DEPARTURE names; the FULL gate of HANDOFF §4 is green against its
baselines; the §6.3 DOM differential shows differences only where a DEP
says so; and the §6.4 dev-stack smoke matches `cf91b43` but for the DEPs.

---

## 0. Decisions this plan takes (read first)

### D-1 — scope: five themes, one pass

1. **Brands (Law 7.4)** — no raw `number`/`string` for an id, an instant, a
   shop day, a minute or a money amount anywhere a value crosses a type
   boundary: view models (`*.vm.ts`, `*Vm` interfaces in components),
   contracts (`*.contracts.ts`, component inputs/outputs), stores (signals,
   public methods), presenters, adapters, the functions edge and the ecs-core
   system/port signatures.
2. **Wall clock for the staff day (Law 7.3 T1, OQ-14)** — every
   visit-vs-now answer, span, bucket and order runs on `LocalDate` +
   `MinuteOfDay`/`EndMinute` with `ShopNow`; `zoned-time.system.ts` is the
   ONLY zone engine.
3. **Shapes (Law 1)** — one name per `*.data.ts` (D-7); component-shaped data
   out of systems, pipelines and the ports tier, one home tier per name.
4. **Tags (Law 1 / 6.2)** — every closed set is an `as const` dictionary
   declared once and compared through its members; no boolean discriminated
   union but `Result.ok`; no `kind`/`type`/`status` field.
5. **Errors (Law 7.5)** — every error dictionary and struct union in
   `libs/ecs-core/src/errors/*.error.ts`; expected failures are
   `{ errorCode, …params }` structs; feature error state holds the struct.

Plus pass C's carried D-11 list (D-10 below).

### D-2 — behaviour is frozen; the exceptions are numbered DEPARTURES

Branding, re-homing and dictionaries are type-level: they change no runtime
value a user, a test, a URL, a stylesheet, the store or the server can
observe — no rendered word, URL, CSS hook, `data-*` value, test id, i18n
key, stored document, wire field or callable answer. **Exceptions**, each a
numbered DEP at the end of this plan with its exact before/after and the
specs changed on purpose:

- **(a) OQ-14** — moving the staff day's instant answers onto the wall clock
  changes answers ONLY inside a DST fall-back repeat hour, inside a
  spring-forward gap, across zones, or (two answers) at the millisecond-0
  instant of a minute. One DEP per affected answer, each with spec cases at
  Europe/Sofia's boundaries (spring-forward **2026-03-29** 03:00→04:00,
  fall-back **2026-10-25** 04:00→03:00; **2027-03-28** for the card leg).
- **(b) the icon manifest wire field** `kind` → `iconAsset` with
  `UI_ICON_MANIFEST_SCHEMA_VERSION` 1 → 2.
- **(c) two live rules for one value disagree** — ONE survives, by default
  the ecs-core rule (the pass-C D-12 rule).

**Internal tag values** (a dictionary whose values reach nothing in the
list above) change to SCREAMING_SNAKE (Law 1). That is not a departure: no
observer exists. A spec that asserted the old internal literal is edited on
purpose and listed in §4.2. **The proof rule:** a package changes a value's
spelling only after `grep -rn` over `libs apps tools` (`.ts`, `.html`,
`.css`, `.json`, `.mjs`, e2e included — `git grep` misses untracked files)
shows it reaches no DOM attribute, test id, i18n key, URL, storage, wire or
stored document. Otherwise the dictionary KEEPS the contract's spelling and
its JSDoc says "values: external contract (<which>)". The §6.3 differential
is the backstop.

### D-3 — one brand per concept (REUSE, NEVER COPY)

| Concept                                                                                   | Brand (home)                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An entity / reference id                                                                  | its `ids.primitive.ts` brand                             | `CustomerId` ≠ `UserId` always; a VM field holding "an appointment's id or a waitlist request's" is split by its discriminator (§2.6), never typed as a raw union string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| An instant                                                                                | `UtcEpochMs`, fields `*UtcMs`                            | T2 uses only (stamps, TTLs, elapsed-time phrases — D-6.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A shop day                                                                                | `LocalDate`                                              | `today`/`dayKey`/`todayKey`/`*Day`/`expiresOn` fields; `''` sentinels become `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A start / an exclusive end on the wall clock                                              | `MinuteOfDay` / `EndMinute`                              | as stored on `Seat`/`TimeCoordinate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A minute on a frame's anchored TRACK axis (may be 1440 or pass it)                        | **NEW `TrackMinute`** (D-5)                              | `VisitDraft`/`VisitEditorCommit` start/end, `GridEvent`/`TrackSpan`/`OpenWindow`/`GridDraft` minutes, the drag axis outputs. Never `MinuteOfDay`: 1440 would refuse earlier than `commandsFor` does today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A positive duration / a non-negative count / a signed delta                               | `DurationMinutes` / `MinuteCount` / `MinuteDelta`        | leg minutes, overrides, verdict `minutes`, gap minutes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Money                                                                                     | `PriceCents` beside a `Currency` (or the `Money` struct) | fields `*Cents`; `availableMinorUnits` → `availableCents`; the catalogue's MAJOR-unit floats go (§2.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| An e-mail                                                                                 | `Email` (`components/email.data.ts`)                     | `email?: string \| null` becomes required `email: Email \| null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| The staff draft's person key (`uid` / `guest-<label>` / `guest-<base36>-<n>` / `primary`) | **NEW `DraftPersonKey`** (D-5)                           | spelling byte-identical; `VisitDraftSystem.accountKeyOf` becomes `DraftPersonKey.accountOf`. **Why none of the existing key brands** (`ids.primitive.ts`): not `GuestId` (`:130`, "a guest seat of a party — `guest-…`" — a draft key is also a bare uid or `primary`); not `GuestKey` (`:182`, the wire guest key bounded to `[A-Za-z0-9_-]{1,64}` — `guest-<label>` carries the typed label, Cyrillic included (`guest-Мария`), which fails that charset and would be dropped server-side); not `SeatKeyText` (`:441`, `self`/`guest-…`/`companion-<uid>` and the `account:`/`guest:` person keys — a draft key is never `self`/`companion-…`/`account:…`, and a bare uid is none of those spellings). A draft key is UI draft read-state minted only inside the editor; it never reaches the wire as itself |
| A person key `account:<uid>` / `guest:<label>` / `self`                                   | `SeatKeyText` (exists)                                   | `VisitStorySystem.personKeyOf`/`seatPersonKey` answer it too (same spelling as `GuestLabelSystem.personKeyOf`, verified: `ACCOUNT_PREFIX = 'account:'`, `GUEST_PREFIX = 'guest:'`, `guest-label.system.ts:11-37` already answers `SeatKeyText`). The brand ALREADY carries two spelling families on `cf91b43` (the cart seat key and the party person key) while its JSDoc names only the first: **W0-P amends `SeatKeyText`'s JSDoc** to declare both families on purpose ("the text a party seat is told apart by — a cart seat key `self`/`guest-…`/`companion-<uid>`, or a person key `account:<uid>`/`guest:<label>`"); a separate `PersonKey` brand is OQ-17                                                                                                                                             |
| A percentage                                                                              | `number` (as `CouponValue.discountPercent`)              | not on Law 7.4's list; the ecs-core shape is reused, no new primitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A role set                                                                                | `readonly Role[]`                                        | the viewer is `{ userId: UserId; roles: readonly Role[] } \| null` (D-10.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Counts, indexes, pixel geometry, revision counters, `windowHours`, percentages            | raw `number`                                             | not coordinates/money/ids (pass-C D-2.13 pixel geometry stays raw inside gesture physics)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Opaque UI keys** — not ids of stored things                                             | `string`, named in the lint allowlist (D-13)             | the chair-row key `appointmentId#barberId` / `new-<nonce>` (`rowId`, `GridEvent.id`, `visitSheetId`), option keys (`service:variant`), test-id segments, `@for` track keys, `GridColumn.id` (a chair OR a day by `uiColumnKind`), `EditorStackPage.subjectId` (D-8.9), chip/record keys, DS option ids (`UiChoiceOption.id`, `UiMapPin.id`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### D-4 — the parse / `of` / `ofProven` policy

1. **Foreign input becomes a brand ONCE, at its edge, through the smart
   constructor** (`X.parse(raw)` / `X.of(raw)` → `Result`). The foreign
   edges in this pass and the outcome each refusal MUST reproduce (today's):

   | Edge                                                                                                      | Smart constructor                     | A refusal reads as (today's outcome)                                                                                                                                                                                                                                                                                                    |
   | --------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | staff `?day=` (`sd:1362` → `st:1076` `goToDay`), the block/visit sheets' day probe (`st:1676` `probeDay`) | `LocalDate.parse`                     | today's day, unchosen — **DEP-13** for a well-formed impossible day (`2026-02-30`), which the hand regex accepted                                                                                                                                                                                                                       |
   | staff `?barber=` (`sd:1371` → `st:1229` `applyRouteBarber`)                                               | `BarberId.parse`                      | no scope (as empty today). `parse` refuses a blank (whitespace-only, `ids.primitive.ts:22-27`) AND a `/` value: both are **DEP-14** (today `' '` and `'a/b'` are applied as a scope briefly and cleared by the stale-scope effect; after, `null` at once — pinned no-op on the final URL)                                               |
   | `/appointments?visit=` (`client-appointments.ts:318`)                                                     | `AppointmentId.parse`                 | no sheet (`''`, a blank, or an id with `/` matches no loaded visit today either — a blank value reproduces today's outcome)                                                                                                                                                                                                             |
   | `/book?repeat=` (`client-booking.ts:146`)                                                                 | `AppointmentId.parse`                 | silent fall-through (as `readVisit` → `null` today; a blank value reads no visit today either — same outcome)                                                                                                                                                                                                                           |
   | `/book?reschedule=` (`client-booking.ts:149`, `:376`)                                                     | `AppointmentId.parse`                 | `expectMove` still blocks the commit AND `refuseMove(Unavailable)` — never a bookable flow (the hazard `client-booking.ts:226-235` documents); a blank value takes the same refusal path, which is what an unreadable id does today. The store's `_moveAsked` keeps a raw-text twin only for this refusal path (§2.10)                  |
   | `/book?waitlist=` (`client-booking.ts:142`)                                                               | `WaitlistRequestId.parse`             | silent fall-through (request not found today)                                                                                                                                                                                                                                                                                           |
   | `/book?day=` (`client-booking.ts:143` → `booking-flow.store.ts:937`)                                      | `LocalDate.parse` at the edge         | TRI-STATE kept: absent → `undefined` → the request's first watched day; present-and-invalid → `null` → no day selected (`booking-flow.store.ts:966-968`)                                                                                                                                                                                |
   | typed clock text (visit editor `:1161`, block editor `:253`)                                              | **NEW `MinuteOfDay.parseClock`**      | the field keeps its value (as `null` from the local parsers today) — **DEP-22** (pinned: the unanchored editor parser accepted `10:30x`; `ui-time-field` only ever emits `HH:mm`). `parseClock` TRIMS before matching, exactly as both local parsers do (`value.trim()`, `be:254`, `ve:1162`): `' 10:30 '` is accepted before and after |
   | typed price text (`parsePriceInput`, `ve:7441`)                                                           | `PriceCents.of` on its integer output | never refuses (its output is a safe integer ≥ 0 — proved in the package)                                                                                                                                                                                                                                                                |
   | the restored booking draft (`booking-draft.data.ts:258-263`, sessionStorage)                              | `Email.parse` / `E164` guard          | the contact field restores as `null` (the app only ever writes parsed values, so no draft it wrote refuses)                                                                                                                                                                                                                             |
   | the DS map pin / choice-menu ids handed back to a feature                                                 | `X.of` (by construction)              | n/a — the feature built each option from entity ids (D-8.6)                                                                                                                                                                                                                                                                             |
   | the `requestWaitlist` callable's cart (`waitlist.wire.ts` `cartOf`; added by the second fixer round)      | `X.of` (a deliberate pre-door brand)  | n/a — the door judges the cart's ids: `WaitlistSystem.decide` checks the windows, the days and the cart's size and sequence first, then refuses a line `lineReadable` cannot read as `invalidRequest('cart')`; a `parse` at the wire would refuse ahead of those checks and refuse ids the door accepts today (`/`, a blank `seatKey`)  |

2. **By construction.** An id read off a branded entity, a key derived from
   brands, a Firestore document id an adapter just read, or a fixture
   literal is `X.of(raw)` (the id family's documented second door,
   `ids.primitive.ts:11-16`) — or, better, needs no conversion at all
   because the field it came from is already branded. Spec fixtures use
   `AppointmentId.of('appointment-1')` and the `@core/testing` helpers
   (`localDate`, `minute`, `endMinute`, `cents`, `duration`, `minuteCount`,
   `utcMs`, NEW `trackMinute`).
3. **`ofProven`** exists only on `MinuteOfDay`/`EndMinute` (and the new
   `TrackMinute`). A package may call it only where its own arithmetic holds
   the range, with a one-line comment saying why. No new `ofProven` is
   invented for `LocalDate`, `UtcEpochMs` or `PriceCents`: the values those
   VMs carry are ALREADY brands at their source (§2), so the defect
   re-branders go: `st:474` `utcMsOf`, `sd:6714` `utcEpochMsOf`,
   `ve:1217` `billCentsOf`, `ve:7364` `drawableCentsOf`, `ve:6583` the
   `stepDay` defect parse, `client-card.format.ts:36` `localDateOf`,
   `:68` `shopDayOf`'s parse, `achievements.presenter.ts:259` `cardDayOf`,
   `:265` `previousVisitOf`'s parse, `wallet.presenter.ts:1063`,
   `records.presenter.ts:513`, `loyalty.presenter.ts:326` (`dayOf` ×3),
   `day-range.ts:54` `dayOf`, `admin-rhythm.words.ts:129` `localDateOf`,
   and the two `LocalDate` parse-or-null copies: `pipelines/booking-read-set.pipeline.ts:379`
   `localDateOrNull` (an exported function with NO caller — `grep -rn
localDateOrNull libs apps`; W0-W deletes it) and its feature copy
   `booking-flow.store.ts:1313` (W1-B deletes it once `/book?day=` parses
   at the edge — D-4 row; `EARLIEST_DAY` (`:72`) is built inline as
   `LocalDate.parse('0001-01-01')` unwrapped with `defect` on refusal,
   exactly today's `?? defect(…)`).
   **Deleted, never moved** — none is replaced by a parse that can refuse
   data the app accepts today.
4. **No `as <Brand>` cast** outside the brand's own file. Today's two id
   widenings (`admin-rhythm-sheet.ts:274`/`:278` `as string`) go with their
   fields; the booking draft's `as BookingContact[…]` (`booking-draft.data.ts:258-263`) becomes the parse of row 1.
5. **Every new parse/`ofProven` site** names, in its package's §9 note, the
   input range it receives and why no value the app accepts today refuses.

### D-5 — new primitives and primitive members (W0-P, each with JSDoc and spec)

| Name                                                                          | File                                                                                                                                                           | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrackMinute`                                                                 | `minute-of-day.primitive.ts`                                                                                                                                   | `type TrackMinute = MinuteOfDay \| EndMinute \| Brand<number, 'TrackMinute'>` — "a minute on a frame's anchored axis from the shop day's midnight: a wall-clock start, a wall-clock end, or an anchored minute past the closing midnight (a late cut 23:25–00:15 is 1405–1455)". `of(raw)`: a non-negative safe integer → `Result` (no upper bound — no value accepted today refuses); `ofProven(raw)`; `plus(t, d: MinuteCount \| DurationMinutes): TrackMinute`; `span(a, b): MinuteCount` (`b − a`, clamped at 0); `toStart(t): Result<MinuteOfDay>`; `toEnd(t): Result<EndMinute>` (no text face here — formatting happens in the UI, `formatClock` below)                                                                                                                                                                                                                                                                         |
| `MinuteOfDay.parseClock(raw)`                                                 | same file                                                                                                                                                      | an EDGE smart constructor: TRIMS `raw` first (as both of today's parsers do, `be:254`, `ve:1162`), then strict `^(\d{1,2}):(\d{2})$`, hours ≤ 23, minutes ≤ 59 → `Result<MinuteOfDay, PrimitiveError>`; reuses an existing `PrimitiveErrorCode` whose `raw` field fits, else adds `PRIMITIVE_CLOCK_TEXT_INVALID` with its inert `EDGE_WIRE` row (`apps/functions/src/edge.ts`, edge totality)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MinuteDelta.between(a, b)` widened                                           | `duration-minutes.primitive.ts`                                                                                                                                | accepts `MinuteOfDay \| EndMinute` on both sides (today `MinuteOfDay` only) so `TimeCoordinate.instantAt` (D-6.5) can take an end minute; total, same arithmetic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `formatClock(t: TrackMinute, closing: ClockClosing): string` + `ClockClosing` | **`libs/ui/wall-clock/src/lib/wall-clock.ts`** (beside `formatMinute`, its home per `angular-ui.md`; added by W0-P so every wave-1 consumer builds against it) | the 24-hour `HH:MM` face — what the grid axis, the now label, the editors' and block editor's `ui-time-field` values, the waitlisted step and the landing print. `ClockClosing = { Wrap: 'WRAP', EndOfDay: 'END_OF_DAY' }` (internal, SCREAMING; a UI dictionary, homed with its one function): how 1440 (and an axis minute past it) prints — `WRAP` → `00:00` (mod 1440, the editors' and the grid's face), `END_OF_DAY` → `24:00` (the waitlisted step's and the landing's face). DEP-free: each site passes the closing it prints today. Replaces the seven hand clock faces (§1.10). Locale-worded times stay `formatMinute`/`formatWallClock`. **Not in ecs-core:** Law 5 "formatting happens in the UI"; the one HH:MM text that stays in ecs-core is `WallTime.toLocalIso`'s private `datetime-local` WIRE form (D-6.6 note), because its consumer `translate-coded-error.ts` (`type:infrastructure`) may not import `type:ui` |
| `UtcEpochMs.EPOCH`                                                            | `utc-epoch-ms.primitive.ts`                                                                                                                                    | `0` as the brand (proven); replaces `retention.system.ts:52-57`'s private `EPOCH` and seeds the client card's clock signal (`client-card.store.ts:414`, today `signal(0)` — the same value, so no pre-open answer changes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `MinuteDelta.fromDuration(d)`, `MinuteDelta.negate(d)`                        | `duration-minutes.primitive.ts`                                                                                                                                | total, no `Result` (a positive `DurationMinutes` is always a `MinuteDelta`); `otp.system.ts:121`/`:179` and `edit-appointment.pipeline.ts:422-424` use them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `DraftPersonKey`                                                              | `ids.primitive.ts`                                                                                                                                             | `Brand<string, 'DraftPersonKey'>`; `account(id: UserId)`, `guest(label: string)`, `minted(base36: string, n: number)` (`guest-<base36>-<n>`), `PLACEHOLDER` (`'primary'`), `of(raw)` (by construction), `accountOf(key): UserId \| null` (the body of `VisitDraftSystem.accountKeyOf`, `visit-draft.system.ts:313`); spellings byte-identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Tag`                                                                         | NEW `primitives/tag.data.ts`                                                                                                                                   | `type Tag<D extends Record<string, string \| number>> = D[keyof D]` + companion `Tag.values(d)` (dictionary key order), `Tag.has(d, raw): raw is Tag<D>`, `Tag.or(d, raw, fallback)`. ONE membership scan for every dictionary guard (retires `isBookingStatus`, `isLocale`, `LOCALES`, `SESSION_KINDS`, `role.data.ts`'s `listHas`/`anyIn`, `gamification`'s `oneOf`, `streak-rule`'s `isOneOf`, the impersonation-scope scan, `registration`'s guard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Rejected on purpose: a `Percent` brand (D-3), a `WindowHours` brand
(`transition-appointment.pipeline.ts:163`, OQ-6), a `ChairRowKey` brand
(D-3 opaque UI keys), a branded `LocalDate.ofProven` (none is needed).

### D-6 — OQ-14: the staff day on the wall clock; one zone engine

1. **The rule.** "Has the visit started / ended" is not on the T2 list; its
   one home is `VisitStorySystem.hasStarted(WallTime, ShopNow)` (start ≤
   now, `visit-story.system.ts:273` → `VisitListSystem.hasStarted`) and
   `hasEnded(WallEnd, ShopNow)` (`:283`). Every dashboard answer moves onto
   them (table below). No instant-based copy is homed anywhere.
2. **Which `ShopNow`.** The physical chair invariant (Law 7.2): a visit
   happens on ITS shop's wall clock.
   - **Rows, lanes, the grid and the agenda** (one shown day of the store's
     zone, as today's `toRow` reads it): `store.shopNow()` — the store's tick
     in `store.zone()`. No cross-zone change for these (today's instants are
     made in `store.zone()` too).
   - **The search pool and «Скорошни»** (pooled across shops): the shop's own
     `ShopNow`, read from ONE store member built at the store edge — NEW
     `StaffDayStore.shopNowAt: Signal<(locationId: LocationId | null) =>
ShopNow | null>` (W1-S1, §2.3): a `computed` over the store's tick
     `nowMs()` that derives `ZonedTimeSystem.shopNow(nowMs, zone)` ONCE per
     distinct zone per tick (a `ReadonlyMap<TimeZone, ShopNow>` behind the
     lookup), the zone being the catalogue shop's `timeZone`, else the
     day's `store.zone()` (today's `zoneOfShop` rule, `sd:1466`, moved into
     the store and deleted from the component). `null` only when neither
     zone is known. The component never calls `ZonedTimeSystem.shopNow`
     (D-6.6: lawful only at the store edge; the pass-C carry "the editor's
     ShopNow built inside a computed()" is not repeated). Both the search and
     «Скорошни» read the same tick; «Скорошни»'s fresh `clock.nowUtcMs()`
     read (`sd:5708`) goes (DEP-7 records the up-to-one-tick difference).
   - **Before any zone is known** (a real state: the store retries the zone
     every minute, `retryZone` `st:849/943/948`, and `browseClients` only
     awaits `ensureWindow`), today's answers are kept exactly: the search's
     `past` is `false` (today `endInstantOf` is `+∞`) because `hasEnded` is
     not asked without a `ShopNow`; the search's when label and «Скорошни»'s
     date print `''` while `store.zone()` is `null` (the `formatWallClock`
     call is gated on `store.zone()` exactly as `instantLabel` gates
     `formatInstant`, `sd:1489-1496`); «Скорошни» keeps today's INCLUSION
     for a visit whose shop has no known zone — `shopNowAt(locationId)` is
     `null` → the visit is judged by today's stamp rule `utcEpochMs <
nowMs()` (a stored instant against now: T2 stamp ordering, no zone
     needed), and by `hasStarted` with its shop's `ShopNow` otherwise. The
     order is `WallTime.compare` descending in both cases (identical to the
     instant order within one zone but the fall-back hour — DEP-7).
3. **The answers.**

   | Answer (`cf91b43`)                                                                                       | Before                                                                                                          | After                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | DEP                    |
   | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
   | row `live` (`sd:3623-3626`)                                                                              | `startMs ≤ nowMs < endMs ∧ ¬settled`                                                                            | `hasStarted(WallTime.of(localDate, startMinute)) ∧ ¬hasEnded({localDate, minute: endMinute}) ∧ ¬settled`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | DEP-1                  |
   | row `isNext` (`sd:2639`)                                                                                 | first `¬terminal ∧ startMs > nowMs`                                                                             | first `¬terminal ∧ ¬hasStarted` IN THE LANE'S EXISTING ARRAY ORDER (`visits = lane.appointments.map(toRow)`, sorted by the envelope instant `utcEpochMs` in `observeBarberDay`, `appointments.adapter.ts:21-22/:159` — NOT re-sorted by this barber's seat start: a sequential second leg whose seat starts after another party's would otherwise change `data-next` on an ordinary day)                                                                                                                                                                                | DEP-2                  |
   | row / grid visit / grid block `past` (`sd:3622`, `:2259`, `:2314`)                                       | `endMs ≤ nowMs`                                                                                                 | `hasEnded`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | DEP-3                  |
   | agenda group `past`, the now index (`sd:2721`, `:2745`)                                                  | floored minute key `< nowMs` / `≥ nowMs`                                                                        | `hasStarted(WallTime.of(day, groupMinute))` / first group with `¬hasStarted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | DEP-4                  |
   | agenda bucket key and DOM id (`sd:2709`, html `:606`/`:613`)                                             | `floor(startMs / 60000) · 60000`, `agenda-time-<ms>`                                                            | the group's `startMinutes`, `agenda-time-<startMinutes>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | DEP-5                  |
   | lane run order (`sd:2629-2631`)                                                                          | `a.startMs − b.startMs`                                                                                         | stable sort by `startMinutes` (one shop day per lane; a gap and a visit never share a start minute — a hole contains no visit's padded start)                                                                                                                                                                                                                                                                                                                                                                                                                           | DEP-3's fall-back note |
   | search `past`, outward order, when label (`sd:1540`, `:1562`, `:1600`)                                   | end instant in `store.zone()` vs `nowMs`; `whenMs` order; `formatInstant(utcEpochMs, day zone)`                 | `hasEnded` with `store.shopNowAt(locationId)` (`false` while it is `null` — today's `+∞`); `WallTime.compare` (future soonest, past newest); `store.zone() === null ? '' : formatWallClock(localDate, startMinutes, …)` (today's pre-zone `''` kept)                                                                                                                                                                                                                                                                                                                    | DEP-6                  |
   | «Скорошни» filter, order, date (`sd:5713-5716`, `:5730`)                                                 | `utcEpochMs < now` (fresh clock); `b.utcEpochMs − a.utcEpochMs`; `shortDate(utcEpochMs)` (`''` before the zone) | `hasStarted` with `store.shopNowAt(locationId)`, or today's `utcEpochMs < nowMs()` when it is `null` (D-6.2, pre-zone inclusion kept); the store tick, not a fresh read; `WallTime.compare` descending; `store.zone() === null ? '' : formatWallClock(localDate, null, …)`                                                                                                                                                                                                                                                                                              | DEP-7                  |
   | `catalogTag` span «±N мин» (`sd:3403-3428`)                                                              | `round((endMs − startMs)/60000)`                                                                                | `MinuteCount.span(startMinute, endMinute)` → `VisitDraftSystem.minutesDelta` as now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | DEP-8                  |
   | `DayRowVm.durationMinutes` (`sd:529`, `:3615`)                                                           | instants                                                                                                        | DELETED — no reader (`grep` over `.ts`/`.html`: the only site is the write)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                   |
   | `openBlock`'s seeded end (`sd:6386`)                                                                     | `minuteAfter(startMs, endMs)` (elapsed instants)                                                                | the block's own `endMinutes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | DEP-9                  |
   | lane windows, blocks, gaps, `rosterHull`, `rosterExtent`, `openWindowsOf` (`sd:2025-2060`, `:2287-2391`) | minutes read back from instants (`minuteAt`, `minuteAfter`, `minuteOfDay`)                                      | the store's `MinuteRange`/`LaneGap` minutes directly; `openWindowsOf` merges with `IntervalSetSystem` (every end ≤ 1440 by construction now — re-proved in W1-S3's note)                                                                                                                                                                                                                                                                                                                                                                                                | DEP-10                 |
   | block event id (`sd:2302`, parsed back `sd:6371-6377`; `data-event-id`)                                  | `block:<barberId>:<startMs>`                                                                                    | `block:<barberId>:<localDate>:<startMinutes>` (the DAY is in the key: the date-columned views build blocks from every visible cell, `sd:1976-2010`, and `staff-time-grid.ts:1131-1134` emits `blockPicked` for any of them). `openBlock` keeps TODAY'S answer for a block of another day: when the parsed `localDate !== store.dayKey()` it is a no-op (today the anchor lane's `startMs` never matches another day's instant, so the tap does nothing); otherwise the anchor lane's block is found by `MinuteRange.startMinutes` (`MinuteOfDay.of` on the parsed part) | DEP-11                 |
   | `whenLabel` countdown and live remaining (`sd:3096-3119`)                                                | `relativeTime(startMs, nowMs)`, `round((endMs − nowMs)/60000)` with `startMs`/`endMs` from `wallClockInstant`   | STAYS ON INSTANTS (D-6.4): `relativeTime(startUtcMs, nowUtcMs)`, `UtcEpochMs.elapsedMs`, with the chair's instants from the stored start (`TimeCoordinate.instantAt` — the FOLDED `seatStartUtcMs`, D-6.5)                                                                                                                                                                                                                                                                                                                                                              | DEP-12                 |
   | the gap id (`sd:2615`, a track key only; not rendered)                                                   | `gap-<barberId>-<startMs>`                                                                                      | `gap-<barberId>-<startMinutes>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none (not rendered)    |
   | `openGap` (`sd:5536-5547`)                                                                               | parses the gap id                                                                                               | DELETED with the grid's `gapPicked` path on this page — `eventsFor` never emits a `GAP` event (W1-S3 proves by grep)                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                   |

4. **The countdown stays on instants.** «след 40 мин» measures real elapsed
   time to the start — an elapsed-time phrase, T2 by kind (stamps and
   elapsed-time rules). Moving it to wall minutes would change the phrase by
   up to a minute of rounding EVERY day. `relativeTime(target: UtcEpochMs,
now: UtcEpochMs, …)` (`libs/infrastructure/i18n/src/lib/relative-time.ts:31`,
   its one production caller is the dashboard) takes its delta from
   `UtcEpochMs.elapsedMs`.
5. **Instants derived from the stored start — FOLDED into the one existing
   helper, not added beside it.** `TimeCoordinate.seatStartUtcMs(time, seat)`
   (`time-coordinate.data.ts:79`) already IS "stored `utcEpochMs` + the
   wall-clock distance from the envelope start" (`UtcEpochMs.plusMinutes(time.utcEpochMs,
MinuteDelta.between(time.startMinutes, seat.startMinutes))`), gated by
   G-1 to the per-seat late-cancellation judgement. W0-S generalises it ONCE:
   renamed `TimeCoordinate.instantAt(time, minute: MinuteOfDay | EndMinute)`
   (same body, `MinuteDelta.between` widened by W0-P, D-5); its one caller
   `cancellation-policy.system.ts:27` is re-pointed (`instantAt(appointment,
envelope.startMinutes)` — byte-identical answers, the spec cases of
   `time-coordinate.data.spec.ts:48-61` re-spelled); `TimeCoordinate.endUtcMs`
   (`:51`) composes it (`instantAt(time, time.endMinutes)` — equal to today's
   `utcEpochMs + durationMinutes` because a stored `endMinutes ≥ startMinutes`);
   its G-1 JSDoc is amended to name the dashboard countdown and live
   remaining as a sanctioned T2 use (an elapsed-time phrase). No
   `seatStartUtcMs` survives (no transitional name: its only caller is in
   ecs-core). No new wall-clock↔instant conversion is added anywhere; exact
   for every visit that does not straddle a DST transition (the shop is
   closed then).
6. **The one zone engine.** Deleted from `staff-day.store.ts`: `DAY_FRAMES`
   and `frameOf` (`:447-465`), `LaneSpan` (`:241`), the store's `LaneGap`
   copy (`:266`), `LaneCut` (`:466`), `utcMsOf` (`:474`), `wallTimeOf`
   (`:481`), `shopNowOf(nowMs: number)` (`:486`, re-written over
   `UtcEpochMs`), `laneDayOf`/`wallOn`/`dataDayOf`/`rangesOn` (`:503-594`),
   `instantOn` (`:596`, the hand-rolled spring-forward walk),
   `wallClockInstant` (`:626`), `intervalsOn`/`cutOf`/`gapsOn` (`:635-665`),
   `laneGaps`/`occupiedIntervals` (`:328`, `:372`) and their re-export
   (`dashboard/src/index.ts:3`; consumers: `lane-gaps.spec.ts` only), the
   `addDays`/`startOfWeek`/`localDateOf` string wrappers (`:224-295`).
   Deleted from the dashboard: `wallAt`/`minuteAt` (except the stamp reading
   below), `minuteAfter`, `minuteOfDay`, `endInstantOf`, `utcEpochMsOf`,
   `zoneOfShop` (`sd:1466` — its rule moves into the store as NEW
   `zoneAt`, which `shopNowAt` builds on, D-6.2; its two other readers, the
   editor VMs' `timeZone` at `sd:4032`/`:5435`, read `store.zoneAt(locationId)`
   — same answer).
   Deleted elsewhere: `staff-day-pill.ts:97` `localDateOfKey` (rolls over
   bad days), `ve:7336` `shopIsoOf` (§2.6), `ve:5406-5413` `photoDay`'s
   `en-CA` year reading, `client-card.format.ts:68` `shopDayOf`'s parse,
   the e2e support `shopToday`/`shopInstant` copies (W3-T). The lawful
   readings that stay: a STAMP read onto the wall clock
   (`arrivedAtUtcMs` → `arrivedMinute`, `ZonedTimeSystem.toLocal`, `sd:4110`;
   a photo's year), `ZonedTimeSystem.shopNow` at the store edge (the
   store's `shopNow` and NEW `shopNowAt`, D-6.2 — never in a component), and the
   booking time sheet's `toUtc` gap filter (pass-C D-3, `booking-time-sheet.ts:255`).
   `WallTime.toLocalIso` (W0-S) is a pure TEXT join of `localDate` and the
   minute's zero-padded `HH:MM` (the `datetime-local` wire value and the
   `DST_GAP_INVALID_TIME` param) — no zone, no instant: it is not a zone
   engine.

### D-7 — Law 1 shapes

1. **L-1, the file rule.** A `*.data.ts` exports ONE component name — its
   root type, its `as const` companion and its type-only namespace — and,
   beside it, only the `as const` dictionaries of that component's OWN
   discriminator/tag fields, each named after its field (the sanctioned
   pairing: `AccountStatus` + `AccountLifecycle`, `DiscountMethod` +
   `CouponValue`). A dictionary-only file holds ONE dictionary. A second
   component, a dictionary that types no field of the file's component, a
   stray helper type, a SCREAMING list or a free function moves out.
2. **L-2, where a moved-out piece goes.** A second component → its own file
   under its own name. A helper type used only inside its owner's file → the
   owner's namespace (`ServiceComposition.Input`). A helper type with a
   consumer outside its file → its OWN file under its own name (a type-only
   component; `components/index.ts` is `export *`, so no importer's line
   changes — zero churn by design). A SCREAMING list → a companion member
   (`Roles.STAFF`, `FeatureFlags.NAMES`, `OtpCode.DIGITS`,
   `DayHours.CLOSES_SOON_MINUTES`) or `Tag.values(d)` — `Tag.values` ONLY
   where `Object.values` order equals the list's order; a list whose order
   is observed (`AUDITED_PROFILE_FIELDS` — stored audit arrays;
   `REGISTRATION_FIELDS`; `STREAK_RULE_PARAMETER_ORDER`) stays an explicit
   companion member in today's order. A free function → a companion member,
   or a system when it is a domain rule over no component of its file
   (`isEnrollmentOpenOrUpcoming` → `ProgramsSystem`).
3. **Role.** `Role` stays the claim dictionary (values are claim and
   `firestore.rules` strings — owner-ruled exempt, flatten-spec OQ-3). A
   dictionary const cannot carry methods (`(typeof Role)[keyof typeof Role]`
   would include them), so the role-set helpers become NEW
   `components/roles.data.ts`: `type Roles = readonly Role[]` + companion
   `Roles` (`ALL`, `STAFF`, `BOOK`, `MONEY`, `ADMIN`, `SPEND` in today's
   order; `isRole`, `known`, `isStaffRole`, `isStaff`, `mayBook`,
   `seesMoney`, `isAdmin`, `seesClientSpend`, `readsClientWords`). The
   predicates KEEP their claims-tolerant `readonly string[]` parameters
   (`role.data.spec.ts:142-168` passes non-Role strings; `caller-roles.ts`
   String-coerces): no departure.
4. **Component-shaped data out of systems, pipelines and ports.** A TAG
   DICTIONARY and a discriminated union it types move to components (one
   file per dictionary, L-1). System I/O structs (`AvailabilityQuery`-style
   records, `TrackSpan`, `WallEnd`, `ParsedClientQuery`, `StreakRuleChange`)
   and the ports tier's command/snapshot shapes STAY where they are
   (`ecs-migration.md`'s lint section and flatten-spec F-8 sanction them);
   a union whose variant names a system I/O shape stays as system I/O and
   only its dictionary moves (`StreakDraftAssessment`, `PendingDiscounts`
   if `ResolvedGrant` stays a system shape). This lands pass C's carried
   "system-file dictionary family" (D-7's deliberate exception) in full.
5. **One declaration per shape.** `LoyaltyCatalog` (`ports/engagement.port.ts:142`)
   and `LoyaltyCatalogParts` (`systems/loyalty-catalog.system.ts:71`) become
   ONE generic in NEW `entities/loyalty-catalog.ts` (below both ports and
   systems), `LoyaltyCatalog = LoyaltyCatalogParts` (its defaults). The
   generic's BOUND types move with it — they are what makes it compile in
   the entities tier: `CatalogCategoryRef`, `CatalogSeriesRef`,
   `CatalogSeasonRef`, `CatalogTierRef`, `CatalogRewardRef`,
   `CatalogStreakRef`, `CatalogWindowRef`, `CatalogSubjectRef`
   (`loyalty-catalog.system.ts:44-67`; `Pick`s of entity types and the
   `BadgeSubjectSlot` component — legal there: Law 9 bans `Pick` of a
   `*Ports` type only). Their ecs-core readers (`loyalty-catalog.system.ts`,
   `standing.system.ts`) re-point to `@core/entities` in W0-L; a name with a
   consumer outside ecs-core keeps a transitional re-export (D-12.2).
   `ValidLoyaltyCatalog` (the system's OUTPUT) stays in the system file and
   imports the bounds. **File kind:** not `*.entity.ts` — the aggregate has
   no id and no slice intersection; it is an entities-tier composite with
   the `entities/collections.ts` precedent (a non-entity file in the
   entities tier, listed by the barrel), which is why it is named
   `loyalty-catalog.ts`. The pinning block in
   `entities/engagement-entities.type-spec.ts:373-384` is deleted.
   `QueryOperator` (`ports/tx.port.ts:36`) becomes `type QueryOp` beside its
   const in `entities/collections.ts`. `VisitStorySystem.PersonSubject`
   (`:53`, a second spelling of the `seatSubject` family) is folded:
   `personKeyOf` reads the stored occupant (`SeatOccupant`) as it is (zero
   inbound mapping) and answers `SeatKeyText`.
6. **No getters, no `Object.freeze`.** The object-literal `get
locationCount()` (`sd:1348`, `ve:6705`) becomes a plain number on a
   lookup rebuilt in a `computed()`; `lazy-port.ts:477`'s `Object.freeze`
   goes (the readonly port type is the guard). `VisitLookup` (a method
   interface) moves out of `visit-row.vm.ts` (Law 10.3: no function values
   in a vm) to a `visit-lookup.contracts.ts` in `shared/visits`.
7. **Pipeline-local dictionaries** move to components under domain names,
   their fields domain-prefixed (Law 6.2): the booking pipelines' read tag
   (NEW `BookingReadSnapshot`, D-8.3); `EditOutcome` → `EditCallOutcome`
   (the name `EditOutcome` is taken by `appointment-edit.system.ts:160`, one
   home tier per name), field `editCallOutcome`; `MoveOutcome` (field
   `moveOutcome`, kept); `RequestOutcome` → `WaitlistDeliveryOutcome`,
   field `waitlistDeliveryOutcome` (was `outcome`, N15); `CallEnd` →
   `BackfillCallEnd`, field `backfillCallEnd`.

### D-8 — tags

1. **Every state, discriminator and closed set** is an `as const`
   dictionary declared once, named after its field, compared through its
   members. SCREAMING_SNAKE values unless an external contract fixes the
   spelling (D-2's proof rule) — then the values are the contract's and the
   JSDoc says which contract.
2. **External-contract dictionaries keep their spellings**: `StaffView`
   (`?view=`, `localStorage 'staff.schedule.view'`, `data-view`,
   `staff.day.view.<v>`), the editor's `ShopView` (`data-view`,
   `data-segment-id`), the tip tile ids (`data-tile-id`), `VisitExitId`
   (test id `staff-visit-<id>`), the resolution word (`staff.visit.resolution.<v>`),
   tones (`data-tone`), `ClientCardRegion` (`client-failed-`/`client-retry-<region>`),
   `WalletAnchor` (test id `client-loyalty-<anchor>`), every
   `client-pages.vm.ts` id/tone printed into a test id or `data-*`,
   the `client-card.words.ts` `*Word` unions (i18n keys + test ids),
   `RhythmConfirmation` (`admin.rhythm.confirm.<v>`), `AdminRhythmSheet`
   (`data-kind`), the rhythm preview metric ids, `AgendaField` (stored
   localStorage JSON keys), `Locale` (`'bg'`/`'en'`: Transloco + stored
   `lang`), the onboarding `?phase=`/`?step=` words, the icon diagnostic
   codes (printed by `consoleUiIconReporter`, spec-pinned
   `icon-registry.service.spec.ts:227`), Firebase `HttpsError` statuses
   (`PipelineError.wireStatus`), the gRPC canonical names, `Callables`.
3. **Internal dictionaries go SCREAMING**: the booking pipelines'
   `BookingReadSnapshot` (`REPLAY`/`REFUSED`/`LOADED`/`UNCHANGED`, field
   `bookingReadSnapshot`), `LazyMethod` (`OBSERVABLE`/`PROMISE`, the
   `lazy-port.ts:105` `LazyMethodKind` renamed), `DiscardTarget`,
   `DayPicker`, `DaySurface`, `SearchField`, `VisitEditWriteOutcome`
   (D-10.1), `DiscountKind`, `DiscountCodeState`, `TimingMode`,
   `PhotoDoor`, `PageArrival`, `ProgramsTab`, `EventsTab`,
   `AppointmentsView`, `ScrollSide`, the rhythm menu choices
   (`RhythmEffectiveChoice`, `RhythmQualifierChoice`,
   `RhythmIntervalChoice`, `RhythmOnBreakChoice`), `ClientCardPage`,
   `zoned-time.system.ts`'s private `LocalFit` (values `EXACT`/`GAP`/`OVERLAP`,
   field `localFit`; never returned).
4. **No boolean discriminated union but `Result.ok`**: `lazy-port.ts:196`
   `Outcome<P>` → `Result<P, unknown>`; the icon resolver's
   `UiIconResolved | UiIconFailure` ok-flag (`icon-resolver.ts:30-48`) →
   `Result<UiIconResolved, UiIconFailure>`; `booking-draft.data.ts:46`'s
   structural ok-union → `Result`; `EditorWrite { batch; sides; stale }`
   (`sd:278`) → `VisitEditWriteOutcome` + `sidesWritten`.
5. **No `kind`/`type`/`status` field**: the icon manifest's `kind`
   (`icon-manifest.ts:43/54/61`) → `iconAsset` (`UiIconAsset { Vector:
'VECTOR', Material: 'MATERIAL', Image: 'IMAGE' }`),
   `UI_ICON_MANIFEST_SCHEMA_VERSION` 2, the `no-generic-discriminator`
   `allowIn` entry removed (`eslint.config.mjs:545-552`) — **DEP-16**.
   `AdminRhythmSheetKind`'s Angular input `kind` → `sheet` (the host
   `data-kind` attribute value unchanged).
6. **DS-fed ids.** `ui-choice-menu`/`ui-segmented-control`/`ui-choice-tiles`
   emit `string`; each feature dictionary fed by one gets a guard at the
   handler (`Tag.has(DiscountKind, id)`), never an `as X` cast (today:
   `ve:4963` `kind.id as DiscountKind`).
7. **Templates** read a dictionary through a `protected readonly` component
   field. `typecheck` does not see templates: every template edit is proven
   by `pnpm nx build web` (or the dev server's log), never by `tsc`.
8. **What stays a union** (owner calls or contracts, not converted):
   design-system input unions in `libs/ui/*` (≈90; DS input values and CSS
   hooks — UR-13 b's class); feature component INPUT unions set as static
   template attributes (`uiPlacement="proportional"`, `uiViewport`,
   `uiSize`, `StaffEventHeadSize`, `VisitListStyle`, `DayRangeFace`…) —
   their bare compares INSIDE the component switch to a contract-spelled
   dictionary only where a value is compared in TS; Intl option spellings;
   `Role`/`AuthStage` claim values (flatten-spec OQ-3); the telemetry
   `Log` level (`telemetry.port.ts:17`, "the law's signatures VERBATIM" in
   `ecs-pipelines.md` — owner call, OQ-5); `streak.system.ts:252`'s local
   numeric `StepKind` (sort ranks; SCREAMING strings would need a rank
   table — kept, internal); `apps/web/src/index.html`'s pre-paint script and
   the Node `.mjs` tools (they cannot import TS dictionaries; documented
   contract copies); test-support vocabularies in `visit-fixtures.ts` /
   `client-card.fixtures.ts` / `fake-firestore.ts` (optional, not done).
9. **`EditorStackPage.subjectId`** stays an opaque page key (D-3): every
   value is minted inside the editor from a brand; its READERS brand once at
   their one parse with `X.of` (proven by construction — the editor minted
   it): `client-card.store.ts:1522` `detailAction` (`BadgeSeriesId.of`),
   `:1606` `photoById` (`AppointmentPhotoId.of`), `achievementScopeOf`
   (`LocalDate.parse` for the `day:` key — the key is only ever minted by
   `achievementScopeKey` from a `LocalDate`, so it never refuses).
10. **`OfferChoice.id`** ("the code, or the grant id", `ve:967`) is split
    into `code: VoucherCode | null` + `grantId: CouponGrantId | null`; its
    test id keeps today's spelling (`code ?? grantId`).
11. **`pendingAction`** (`sd:2087`) is never set non-null — the signal and
    its `@if` sheet (`staff-dashboard.html:1305-1330`) are deleted
    (behaviour-neutral; W1-S3 greps `staff-pending-sheet` in specs first).

### D-9 — errors

1. **Homes.** Every error dictionary (`*ErrorCode` / `*RefusalCode`) and
   every NAMED error union lives in `libs/ecs-core/src/errors/<domain>.error.ts`
   — including the unions declared today in components
   (`ServiceTermsError`, `service-terms.data.ts:51`; `StreakPublishCall.AnsweredCode`/`AnsweredError`),
   systems (`StaffEditGuardRefusal`, `VoucherBalanceError`,
   `StreakScheduleError`, `LoyaltyCatalogError`, `MoveError`), pipelines
   (the 17 `*Error` unions — `BookAppointmentError` … `RhythmPublishRefusal`;
   Law 1: "never in a component, system or pipeline file"), features
   (`BookingFlowFailure`, `booking-flow.store.ts:65`;
   `AdminRhythmRefusal`, a re-alias, deleted) and the edge
   (`StreakPublishFailure`, `loyalty.wire.ts:84`). The errors tier names no
   component type: `BookingFlowError.InvalidTransition.from`/`event` and
   `StreakPublishError.Invalid.fields` stay `string` (their dictionaries are
   components); `reasonCode` (`booking-flow.error.ts:113`/`:139`) becomes
   `SchedulingErrorCode` (a sibling).
2. **Refusal vocabularies outside the tier** move in and become structs:
   `MoveRefusalReason` + `MoveRefusal` (`booking-flow.data.ts:38`/`:198`)
   → `errors/move.error.ts`, folded into the move domain's EXISTING code
   dictionary (one dictionary per tag family — `MoveErrorCode` already holds
   `CarriedSeatUnplaceable: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE'`):
   `MoveErrorCode` gains `CompanionsOnly: 'BOOKING_RESCHEDULE_COMPANIONS_ONLY'`,
   `Unavailable: 'BOOKING_RESCHEDULE_UNAVAILABLE'`, `CarriedOutOfReach:
'BOOKING_RESCHEDULE_CARRIED_OUT_OF_REACH'` (the domain's prefix; no
   `BOOKING_MOVE_*` family is invented). `MoveRefusal = MoveError.CompanionsOnly
| MoveError.Unavailable | MoveError.CarriedOutOfReach`, each `{ errorCode;
locationId: LocationId | null }`, a named member union of the move error
   family, with factories (`MoveRefusal.companionsOnly(locationId)` …). Three
   inert rows join the EXISTING `MOVE_WIRE` table in `edge.ts` (`:307`,
   client-only codes, the `BOOKING_FLOW_WIRE` precedent). `RedeemProblem` (a lock tag, not an
   error) and `StreakPreviewUnavailable` (a decision reason) are NOT errors:
   they stay components (doc fixed).
3. **Expected failures are structs, never bare tags/strings**:
   `rescheduleFrom` (`booking-flow.store.ts:635`) answers
   `Result<void, MoveRefusal>` (W0-B, with its readers — D-12.7);
   `saveOwnProfile` (`save-own-profile.pipeline.ts:51`) answers
   `Result<void, AccountsError.OwnProfileSave>` (W1-A in wave 1, with its
   three consumers — D-12.7); `admin-rhythm.store.ts:1332` `timed()`
   answers `RepositoryError.readFailed(null, 'timeout' | 'threw')` (as
   `client-card.store.ts:190` already does); the profile store's writes
   answer the struct; `VoucherCode.distinct` answers a repeat as NEW
   `ENGAGEMENT_VOUCHER_CODE_DUPLICATE { attempted }` (+ `ENGAGEMENT_WIRE`
   row) — **DEP-18**.
4. **Feature error state holds the STRUCT**, never `signal<string | null>`
   of a code: `client-profile.ts:164/218/219/224`, `client-onboarding.ts:217/218/320`
   and `birthErrorState`'s `'partial'` sentinel (`:235` → an
   `IdentityError` built to word byte-identically; see §2.11),
   `client-auth.ts:201`, `own-profile.ts:5` `NameRefusalCodes`,
   `avatar-refusal.ts:21`, `AuthFlowState.error` / `AuthFlowEvent.*.message`
   (`auth-flow.data.ts:97/102/182/190`), `OnboardingFlowState.error` /
   `OnboardingFlowEvent.*.message` (`onboarding-flow.data.ts:102/114/207/230`)
   — the onboarding birthday SAVE path now carries `minAge`/`maxAge`
   (**DEP-17**); `booking-services-step.ts:466` `renameRefusal` and
   `booking-contact-sheet.ts:111` `error` hold the struct and word in a
   `computed` — same words in the language they were raised in, but now
   RE-WORDED on a language switch while shown (today worded once at set
   time, `:502-504` / `:219`/`:234-236`): **DEP-23**;
   `st:2072` `_absenceError` holds a `StaffBlockFailure` struct (the
   template still tests truthiness, `staff-dashboard.html:1389`): the block
   pipelines' own error unions as they answer (today dropped for a bare
   `'failed'`, `st:2165`/`:2202`); the zone-unknown refusal (`st:2150-2151`,
   no zone for the shop nor the day) answers the EXISTING
   `CatalogError.locationZoneUnknown(locationId)`
   (`CATALOG_LOCATION_ZONE_UNKNOWN`, `catalog.error.ts:82/:287`, already
   wired in `edge.ts` — no new code); the bad-day branches (`'invalid'`
   `st:2094`, `'failed'` `st:2119`/`:2188`) are DELETED as unrepresentable
   (the day parameters are `LocalDate`); `blockTime`'s `!barberId ||
!locationId` guard is deleted when W1-S1 proves (grep, §9 note) every
   caller passes an entity-read `BarberId`/`LocationId`, else it answers the
   id's own `PrimitiveError` from `BarberId.parse`/`LocationId.parse`
   (`PRIMITIVE_ID_EMPTY`), never a new string; `st:1622` `_noteError`
   (an appointment id in an error field, no reader) is DELETED.
5. **UI words come from `errors.<errorCode>`** through `translateCodedError`
   with the struct's own params — EXCEPT the surface sentences that say
   something no `errors.<code>` line says, kept on purpose (Law 7.5 note, the
   `BookingErrorCode.CallFailed` precedent): `booking.moveRefused.*` (a panel
   with a title, a `{{reach}}` body and two CTAs; its word table keyed by
   the three `MoveErrorCode` refusal members, values byte-identical, they are the i18n segment and
   `data-reason`), `booking.contact.profileFailed`, `staff.day.blockFailed`,
   `staff.visit.photoFailed`/`photoRemoveFailed`, `staff.day.cancelNoteFailed`,
   the editor's voucher-code UI state words (`staff.visit.voucher*`), and
   the admin rhythm's `ENGAGEMENT_REPOSITORY_FAILURE` fallback for any
   `RepositoryError`. Wording any of these per code would change words.
6. **Admin rhythm** words `StreakPublishErrorCode.Stale`/`Invalid`/`TooEarly`
   and the two caller codes through NEW `errors.LOYALTY_STREAK_PUBLISH_*`
   keys in `bg.json`/`en.json` holding TODAY's words (`{{date}}`/`{{field}}`
   formatted by the presenter and spread over the struct); the two caller
   codes keep «Нямаш право за тази промяна.»; `StaffEditError.forbidden()`'s
   cross-wire and `admin.rhythm.refused.*` are deleted (no rendered change).
7. **`StreakPublishError.guard`** narrows to exactly its code list (today the
   list holds `InvalidInput`/`StoreFailed` its union lacks); the answered
   code set is spelled ONCE in `errors/streak-publish.error.ts` and read by
   the component, `loyalty.wire.ts:87` and `edge.spec.ts`.

### D-10 — pass C's carried D-11 list, landed on the branded contracts

1. **The save write plan.** `commandsFor` (`sd:4597-4870`) moves to NEW
   `StaffEditPlanSystem.commandsFor(draft, row, guestWords)` in
   `systems/staff-edit-plan.system.ts` over a branded input:
   `StaffEditDraft` (NEW `components/staff-edit-draft.data.ts` — the
   editor's commit, §2.4) and `StaffEditRowFacts` — system I/O declared in
   `staff-edit-plan.system.ts` itself (§2.12 gives its body): exactly the
   row fields `commandsFor` reads today (`row.appointmentId`, `locationId`,
   `clientLabel`, `people`, `legs`, `selfSeat`, `discounts`, `vouchers` —
   `sd:4597-4870`, re-listed by W0-S from the port), typed with ecs-core
   types only (the `StaffEditDraft` namespace's leg/person/discount/voucher
   shapes, branded). The dashboard passes its `DayRowVm` AS IS — no mapping
   (Law 3): `DayRowVm`'s fields of those names are typed with the §2.4
   editor contracts, which are structurally wider than the system's
   element types (`VisitEditorLeg` ⊇ `StaffEditRowFacts.Leg`,
   `VisitEditorClientOption` ⊇ `StaffEditRowFacts.Person`,
   `VisitEditorDiscount = StaffEditDraft.Discount`), so `DayRowVm` is
   assignable to `StaffEditRowFacts`; W1-S3 pins that with a type-level
   assertion in `staff-dashboard.spec.ts` (`expectTypeOf<DayRowVm>().toMatchTypeOf<StaffEditRowFacts>()`
   or an equivalent `satisfies` line — no runtime). It answers `Result<readonly
BookingCall.EditCommand[], PipelineError>` with byte-stable command and
   field order (the save's `shapeNeutral` compares `JSON.stringify`,
   `sd:4428-4432`). REPRICE is gated on `priceCents` (DEP-20, proved or
   pinned). The tip seat choice (`sd:4560-4565`) moves too
   (`StaffEditPlanSystem.tipSeat`). `EditorWrite` → `VisitEditWriteOutcome`
   (`STALE`/`BATCH_REFUSED`/`WRITTEN`) + `sidesWritten: boolean`. **The
   ORCHESTRATION stays in the component** (pass-C D-2.9: the awaits into
   `store.staffEdit`/`saveTeamNote`/`recordTip`, the pending/error maps, the
   receipt) — no save pipeline is invented (the store's pending maps would
   be bypassed). `createFromEditor`'s request builder (`sd:5935-6040`)
   moves beside it (`StaffEditPlanSystem.bookingRequest`) over the same
   draft.
2. **The team note's record is built ONCE**: NEW `saveTeamNote` pipeline in
   `append-team-note.pipeline.ts` beside `appendTeamNote`, sharing one
   private record builder; the store calls it (`st:1629-1647`).
3. **Prices from cents, never from labels**: legs carry `priceCents:
PriceCents | null` + `currency: Currency` from the seat and from
   `OfferingPriceSystem.termsFor`; labels are printed from them;
   `snapshotCommitOf` (`ve:1363-1374`) copies cents; `catalogueTotalLabel`
   (`ve:6536-6548`) sums cents (`PriceCents.sum`); `parsePriceInput` stays
   for TYPED text only.
4. **`email` required**: `VisitEditorClientOption.email`, `DraftClient.email`
   → `Email | null`; `client-query.ts`'s `RankableClient`/`toRankable`
   deleted in favour of ecs-core's `RankableClient`; the three `personOf`
   literals in `toRow` (`sd:3499-3530`) and the editor's fallback client
   gain `email: null` (what `toRankable` reads today).
5. **The editor's `ShopNow`** comes from the VM: `VisitEditorVm.now:
ShopNow | null` (the store's `shopNow()`); `shopNowAt` and the editor's
   `CLOCK_PORTS` "now" read go (`ve:3116`). Equal on every input: the
   dashboard's `nowMinute` is already `store.shopNow()?.currentMinute`
   (`sd:2393`) and `hasStarted`/`hasEnded` never read `ShopNow.utcEpochMs`.
6. **`actorRoles`/viewer**: `cardViewer` (`sd:1283`) → `{ userId: UserId;
roles: readonly Role[] } | null`; `cardContextOf`'s `{ uid: '', roles: [] }`
   fallback (`ve:6798`) → `null` (reads as no roles: `readsClientWords([])`
   true, `seesClientSpend([])` false — same answers).
7. **`actFromSheet`'s dismissal set** (`sd:4320`) → NEW
   `StaffVerb.didNotHappen(verb)` on the (now) `StaffVerb` companion
   (narrows out `ArrivalVerb`, delegates to `BookingLifecycle.didNotHappen`)
   — same answer for all six verbs.
8. **The booking flow's terminal rule** is ONE: `BookingFlowState.isTerminal`
   becomes a type guard (`state is BookingFlowState.Confirmed |
BookingFlowState.Waitlisted`), `BookingFlowSystem.isTerminal(step)`
   delegates to it, the store's `isOpen`/`OpenFlowState`
   (`booking-flow.store.ts:1299-1310`) go — the two rules agree on all six
   `BookingFlowStep` values (no departure).
9. **The editor's draft-id rules** (`withoutClient`, `adoptPlaceholderLegs`,
   `seedDraft`, `repeatLast`, `unserved`/`saveable`, `addCountedService`,
   `cardContextOf`) run on `SeatId`/`DraftPersonKey`; they STAY in the editor
   (UI draft read-state) except what `StaffEditPlanSystem` needs.

### D-11 — REUSE, NEVER COPY: the shared homes this pass creates or reuses

One brand per concept (D-3); one dictionary per tag family (`WalletSection`
reuses `WalletAnchor` plus `Ledger`; `RecordThemeWord` and `RecordTheme`
become one; `CardLocale` and `SupportedLang` become `Locale`;
`UiIsoWeekday` becomes `Weekday`; the theme `UiTheme` copy stays — owner
call, OQ-8); one zone engine (D-6.6); one money formatter (`formatCents`;
`catalog.presenter.ts:160` `formatPrice` and `:171` `formatPriceCents` go —
DEP-19); one relative-time module; one
timed-read helper (`timedRead` in `@creativo/shared/view-state`, used by
`admin-rhythm.store.ts:1326` and `client-card.store.ts:1931`); one
BCP-47 table (`intlLocaleOf(locale: Locale)` in `@creativo/infrastructure/i18n`,
replacing the two `'en' ? 'en-GB' : 'bg-BG'` ternaries); one
`personLabel`/`barberName` for the booking steps (three copies:
`booking-review-step.ts:705/723`, `booking-time-sheet.ts:430/440`,
`booking-confirmed-step.ts:131/140`) in a booking words module; one
24-hour clock face (`formatClock` in `@creativo/ui/wall-clock`, beside
`formatMinute` — D-5; ecs-core keeps only `MinuteOfDay.parseClock` and
`WallTime.toLocalIso`'s wire join). The `intlLocaleOf` table replaces the
two LANGUAGE ternaries only; three fixed-locale reads are NOT locale
ternaries and stay as they are (D-14): the visit editor's photo titles
`ve:5397`/`:5409`/`:5418` (`shopMoment(…, 'bg-BG', …)` — bg words in
either language today; switching them to the active locale would change
the en words, so it is not done in this frozen pass) and the dashboard's
two `'en-GB'` 24-hour faces (`sd:2100`, `sd:2347` — a fixed clock face,
not a language); one e2e
shop-zone source (`apps/web/e2e/support`: `SHOP_TIME_ZONE`, `sure`,
`shopInstant` ×2, `shopToday` ×2) reading `ZonedTimeSystem`;
`BusyKey.of` for the e2e busy-day id (`seed-firestore.ts:597/612`).

### D-12 — waves, transitional names, cross-sites

1. **Wave 0 is ecs-core alone** (primitives, components, errors, entities,
   ports, systems, pipelines, testing, their specs and type-specs), in seven
   packages with DISJOINT files. **W0-P runs FIRST** (small; every other
   wave-0 package builds on `Tag`, `TrackMinute`, `DraftPersonKey`,
   `MinuteDelta.fromDuration`), then W0-I, W0-B, W0-W, W0-S, W0-L, W0-O in
   parallel. Two declared exceptions to "ecs-core alone": W0-P adds
   `formatClock`/`ClockClosing` to `libs/ui/wall-clock` (D-5), and W0-B
   converts the `MoveRefusal` chain's feature lines (D-12.7).
   **Barrels have ONE owner — W0-P.** `components/index.ts`,
   `systems/index.ts`, `entities/index.ts` (and `primitives/index.ts`) are
   plain `export *` lists that five parallel packages would otherwise all
   edit. Because a package's own typecheck needs its new files exported
   (cross-tier imports go through the alias, Law 8.3), W0-P — running first
   and alone — appends, in ONE edit per barrel, the `export *` line for EVERY
   new ecs-core file this plan names (§2.2, §2.8, §2.12, D-5, D-7.5, the §3
   wave-0 Files lists: e.g. `staff-edit-plan.system`, `loyalty-catalog`,
   `visit-sides.data`, `rounding-mode.data`, `qualifier-comparison.data`,
   `streak-interval-source.data`, every split file) and creates each such
   file as a one-line placeholder (`export {}; // pass D placeholder — <pkg>
fills`). The parallel packages then only FILL files they own and never
   open a barrel. A package that needs an UNPLANNED new file appends its
   line with one atomic shell append (`printf '%s\n' "export * from
'./x.data';" >> …/index.ts`, never Edit/Write on a barrel) and names it
   in its §9 note. After wave 0, G sorts each barrel once and deletes any
   placeholder left unfilled together with its line. W0-P's own gate is
   typecheck + test (placeholders carry no lint obligations until G's
   wave-0 lint run, by which time they are filled).
2. **Transitional names.** A wave-0 package that moves or renames a name
   with consumers OUTSIDE its own files leaves, in the old home, a
   transitional alias marked `/** @deprecated pass D transitional — W3-T
deletes */` (a same-file delegate `export const STAFF_ROLES = Roles.STAFF`,
   or a cross-tier re-export `export { VisitFilter } from '@core/components'`),
   re-pointing every consumer in its own files at once. Layering's "one home
   tier per exported name" is red on transitional re-exports until W3-T; the
   integrator's wave-0/1/2 static checks run typecheck, lint and test (not
   layering) between waves. Wave-1 and wave-2 packages re-point the import
   lines in files they own; **W3-T** re-points the rest (the 77-file list of
   §1.11) and deletes every transitional name; §5 item 1 proves zero. The
   ONLY ecs-core edits after wave 0 are W3-T's re-points of a transitional
   name and its deletion, W3-T's parameter narrowings (D-12.7 rule (a)),
   and W1-A's identity-flow chain (D-12.7 table) — each named.
3. **Wave 1** re-points consumers inside each library, owning WHOLE brand
   chains (a VM field and everything that produces or reads it), DISJOINT
   files. Producers brand first (a brand is assignable to its base, so every
   reader keeps compiling); parameters that NARROW wait for wave 2.
4. **Wave 2** owns the chains that cross libraries (the client card's
   contracts ↔ the visit editor ↔ shared visits ↔ client appointments and
   account; the catalogue VM's money and ids ↔ landing, booking, onboarding,
   the staff dashboard; the shared formatter and DS-picker narrowing).
5. **Wave 3**: W3-T (tidy, `Locale`, `timedRead`, e2e support) and W3-G
   (lint guards), disjoint. **Wave 4**: G, the integrator.
6. **Declared cross-sites** (two packages of one wave meet at a declared
   contract; the tree compiles once both land): X-1 W1-S3 adds
   `formatZoneName`/`formatCentsFigure` to `libs/ui/wall-clock`, W1-S2
   consumes `formatCentsFigure`; X-2 the staff dashboard's three packages
   (W1-S1 store ↔ W1-S2 editor ↔ W1-S3 dashboard) meet at the §2.3–§2.5
   contracts; X-3 W1-K edits `client-card.words.spec.ts:323-326` to the
   `errors.LOYALTY_STREAK_PUBLISH_*` keys W1-R adds; X-4 W0-O adds the three
   inert `MOVE_WIRE` refusal rows and the `ENGAGEMENT_VOUCHER_CODE_DUPLICATE` row to
   `apps/functions/src/edge.ts` for codes W0-B / W0-L add (spellings fixed in
   §2.10/§2.11).
7. **Shape and signature changes with consumers outside ecs-core.** A
   transitional alias (D-12.2) bridges a MOVE or a RENAME only; a wave-0
   change to a name's SHAPE or SIGNATURE breaks its feature consumers, and
   §6.1 requires the whole tree to compile after wave 0. Rule: a wave-0
   package NEVER narrows a parameter or an input field of a name read or
   built outside ecs-core — (a) it brands RETURNS and output fields (a brand
   is assignable to its base, so readers compile) and keeps such a
   parameter/input field at its raw base with the marker `/** @deprecated
pass D transitional (narrow) — W3-T narrows to <Brand> */`, which W3-T
   narrows once every wave-1/2 caller is branded; or (b) the reshape and
   ALL its consumers land in ONE package (named below, its Files list the
   feature lines); never (c) a project red by design. The known names (a
   wave-0 package that finds another records it in its §9 note and applies
   (a)):

   | Name (today)                                                                                                                                                                                                                                                                                                     | Change                                                                                     | Consumers outside ecs-core                                                                                                                                                                                                                                                                                                          | Bridge                                                                                                                                                                                                                                                                                                   |
   | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `saveOwnProfile` (`save-own-profile.pipeline.ts:20-51`, answers `SaveOwnProfileRefusal \| null`)                                                                                                                                                                                                                 | answers `Result<void, AccountsError.OwnProfileSave>`                                       | `profile.store.ts:79` (`write(): Promise<string \| null>`), `onboarding-flow.store.ts:239-247`, `booking-contact.store.ts:16`                                                                                                                                                                                                       | (b) — the WHOLE chain moves to **W1-A in wave 1** (the pipeline + spec with its three consumers). W0-I only DECLARES `AccountsError.OwnProfileSave` in `errors/accounts.error.ts` (additive)                                                                                                             |
   | `AuthFlowState.identify/otp(error: string \| null)`, `.Identify/.Otp.error: string \| null`, `AuthFlowEvent.requestFailed/verifyFailed(…, message: string)` (`auth-flow.data.ts:62/67/97/102/142/153/182/190`)                                                                                                   | `error: AuthFailure \| null`, events carry `error: AuthFailure` (§2.11)                    | `auth-flow.store.ts:131/144/163/205` (`IdentityErrorCode.OtpWrongCode`, `messageOf(): string`), `client-auth.ts:305/312/450` + template                                                                                                                                                                                             | (b) — **W1-A in wave 1** owns the retype end to end: the (split, W0-I) `auth-flow.data.ts`/`auth-flow-event.data.ts` (+specs), the pass-through lines of `auth-flow.system.ts:47/53` (+spec), the store, the component. W0-I splits the files with shapes UNCHANGED and declares `AuthFailure` in errors |
   | `OnboardingFlowState.about/birthday(…, error)`, `OnboardingFlowEvent.registrationFailed/birthdayFailed(message)` (`onboarding-flow.data.ts:102/114/207/230`)                                                                                                                                                     | struct `OnboardingFailure` (§2.11)                                                         | `onboarding-flow.store.ts:122/143/226/233/247`, `client-onboarding.ts` + template                                                                                                                                                                                                                                                   | (b) — **W1-A in wave 1**, as above (`onboarding-flow.data.ts`/`onboarding-flow-event.data.ts` (+specs), `onboarding-flow.system.ts:118/157` (+spec)); W0-I splits shapes-unchanged and declares `OnboardingFailure` and `IdentityError.birthDatePartial()`                                               |
   | `MoveRefusalReason`, `MoveRefusal { moveRefusalReason }` (`booking-flow.data.ts:38/198`), `MoveRefusal.of(reason, loc)`                                                                                                                                                                                          | the folded `MoveErrorCode` refusals; `{ errorCode; locationId }` in `errors/move.error.ts` | `booking-flow.store.ts:24-25/602-707` (`refuseMove`, `rescheduleFrom: Result<void, MoveRefusalReason>`), `booking-words.ts:3/52-56`, `client-booking.ts:18-19/251/254/300`, `client-booking.html:148-174` (`refused.moveRefusalReason`), specs `booking-flow.store.spec.ts:24/1044-1046/1768/1778`, `booking-words.spec.ts:4/46-48` | (b) — **W0-B in wave 0** converts every listed feature line with the move (no other wave-0 package touches those files); it runs `pnpm nx build web` (template). W1-B leaves those lines alone but for imports                                                                                           |
   | `VisitDraftSystem` params (`snap`, `snapUp`, `typedStart/typedEnd(range: TrackSpan, …)`, `accountKeyOf(clientId: string)`, `walkInLabels`, `adoptPlaceholderLegs`), `TrackSpan`/`TrackEvent`/`TrackColumn` minute fields, `GridLayoutSystem.*` params (`visit-draft.system.ts:244-640`, `grid-layout.system.ts`) | `TrackMinute`/`DraftPersonKey`/`DurationMinutes`                                           | the time grid, timeline, gestures, the visit editor, the dashboard (`grep VisitDraftSystem\.\|GridLayoutSystem\.` in `libs/features`: ~60 sites)                                                                                                                                                                                    | (a) — returns branded in wave 0; parameters, and the fields of any track struct a feature BUILDS, keep `number`/`string` with the `(narrow)` marker; W3-T narrows them after W1-S1/S2/S3 land (`accountKeyOf` stays a delegate taking `string` until W3-T deletes it)                                    |
   | `nowUtcMs: number` command fields of the W0-W pipelines, `readBooking(tx, …)`                                                                                                                                                                                                                                    | `UtcEpochMs`, `ReadTx`                                                                     | `apps/functions/src/main.ts` and the wires (W1-F)                                                                                                                                                                                                                                                                                   | (a) unless W0-W proves (grep, §9 note) every caller already passes a `UtcEpochMs` from the clock port — then the narrowing lands in wave 0                                                                                                                                                               |

### D-13 — lint guards (optional, never noisy; W3-G)

1. **Raw brand fields in features and UI — REUSE L3, no new rule.**
   `tools/lint-rules/ecs-syntax.mjs` already holds the check:
   `ECS_RAW_PRIMITIVE_RESTRICTIONS` (`:179`) flags a property named
   `/(Id|Ids|UtcMs|Minutes|Cents|[lL]ocalDate|[tT]imeZone|Latitude|Longitude|[sS]eatKey|[pP]ersonKey)$/`
   typed `number`/`string`, with the `…Input` escape — today applied inside
   ecs-core only, and only to members of a `TSTypeAliasDeclaration` (feature
   VMs are mostly `interface`s). W3-G EXPORTS that selector's name pattern
   once and builds from it (no second regex): (i) the same selector widened
   to `TSInterfaceDeclaration` members as well, (ii) the name pattern
   extended with `Ms`, and the exact keys `today`/`dayKey`/`todayKey`,
   (iii) the D-3 opaque-key allowlist as a `:not([key.name=/^(rowId|subjectId|trackId|optionId|columnId|titleId|labelId|testId|[a-z]+TestId)$/])`
   clause plus the DS option ids. It is applied from the root
   `eslint.config.mjs` through a `no-restricted-syntax` files block over
   `libs/features/**/*.ts` and `libs/ui/**/*.ts` (specs, `testing/**`
   excluded) — which covers the component-declared contracts a suffix scope
   would miss (`GridEvent`, `VisitEditorLeg`, `VisitEditorPhoto`,
   `BlockEditorCommit`, `StaffDayCell`, `BarberDayLane`). `Minutes` stays in
   the pattern (it covers N-1…N-4) ONLY if the integrated tree shows zero
   hits after the allowlist (D-3 counts and pixel geometry are named
   `…Count`/`…Px`, or allowlisted by name); otherwise `Minutes` is left out
   of the features block and the reason recorded. Canary-proven under both
   ESLint base paths (the UI residue rules' method,
   `ecs-core-base-paths.spec.mjs`), with spec cases in
   `ecs-syntax.spec.mjs`. Optional: if zero hits on the integrated tree
   cannot be shown, the block is not wired and §9.6 carries it.
2. **`export function` in `*.data.ts`** banned through `ecs-syntax.mjs`'s
   `ECS_DATA_RESTRICTIONS` (+ spec case) — zero false positives once D-7's
   free functions are folded.
3. **Not added** (noisy): a bare-literal-compare rule (≈620 legitimate
   `=== 'x'` hits — `typeof`, `event.key`, Intl parts, Firebase codes);
   a "named error union outside errors" rule (must allow `EdgeError` and
   port `Result` types).

### D-14 — what STAYS (ruled, not converted)

The ports tier's data shapes (`CatalogSnapshot`, `JournalPage`,
`StoredFile`, `MediaVariant`, `QuerySpec`…, sanctioned); every system I/O
struct (240 exported from systems — `ecs-migration.md`'s ruling); `Callables`
(the deployed function names, ports-tier wire contract); the telemetry
level (OQ-5); `windowHours` (OQ-6); `ClientStatsSystem.cadenceOf` on
instants (a stored projection; T8 would change stored cadence — OQ-7);
`visit-ics.ts` `toIcsUtc` (no zone read, the RFC 5545 face; only its
fields renamed `startUtcMs`/`endUtcMs`); `observe.ts` `entityOf` (the
sanctioned zero-mapper document-id seam); `auth-session.adapter.ts`'s
emulator session (an SDK/web-storage wire body; JWT seconds); the seed CLI
`--since` ms; `ProfileEdits.birthDate` (a re-judged wire field — typed
`BirthDate`, which is assignable to its wire string); the landing's
authored location keys (`'center'`/`'mladost'` — not catalogue
`LocationId`s; typed as the landing's own `LandingLocationId` dictionary);
`ShopEventInput`/`*Input` form shapes (the sanctioned foreign-input shape
`ProgramsSystem` parses); `ZonedTimeSystem.parseIsoIn`/`toIso` (their
production callers go with §2.6; e2e support `appointment-seed-document.ts:126`
and specs still call them — retiring is OQ-4); `ui/*` generic option ids;
`appointment-photos.adapter.ts` `byTaken`'s order (the port's documented
order, now through `UtcEpochMs.compare`); the KEEP-PARKED lifecycle write
verbs, `VoucherSystem.redeem`, `IntervalSetSystem.clip` (pass C §9.6, owner
call); the visit editor's photo titles worded in `'bg-BG'` whatever the
language (`ve:5397`/`:5409`/`:5418`, `shopMoment(…, 'bg-BG', …)` — routing
them through `intlLocaleOf` would change the en words; a later pass with a
DEP may) and the dashboard's two fixed `'en-GB'` 24-hour faces (`sd:2100`,
`sd:2347`); `NameRule` (`profile-edit.system.ts:39`, `{ MinLength: 2 }` —
a system constant read by its system and spec, the `OtpLimits`/`AgeWindow`
class, not a tag dictionary).

---

## 1. The inventory (re-verified on `cf91b43`)

Abbreviations: `st` = `libs/features/staff/dashboard/src/lib/staff-day.store.ts`,
`sd` = `…/staff-dashboard/staff-dashboard.ts`, `ve` = `…/visit-editor/staff-visit-editor.ts`,
`be` = `…/block-editor/staff-block-editor.ts`, `tg` = `…/time-grid/staff-time-grid.ts`,
`tl` = `…/timeline/staff-timeline.ts`, `gg` = `…/time-grid/grid-gesture.ts`,
`cc/` = `libs/features/staff/client-card/src/lib/`, `sv/` =
`libs/features/shared/visits/src/lib/`. Row ids: **T** wall clock / zone
engine, **I** ids, **D** shop days, **N** minutes, **U** instants, **M**
money, **S** shapes, **G** tags, **E** errors, **F** formatters and
infrastructure. "Pkg" names the owning package (§3); "DEP" a departure.

### 1.1 Staff day store (`st`) — W1-S1

| Id  | Site                                                                                                                                                                                                                      | Today                                                                                                       | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | DEP     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T-1 | `st:447-465` `DAY_FRAMES`/`frameOf`                                                                                                                                                                                       | a second zone engine (two `startOfLocalDay` per day, "uniform" days)                                        | DELETED (D-6.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —       |
| T-2 | `st:596-617` `instantOn`, `:626` `wallClockInstant`, `:635-665` `intervalsOn`/`cutOf`/`gapsOn`, `:503-594` lane-day helpers                                                                                               | minute → instant (spring-forward walk), instant → minute                                                    | DELETED; lanes carry minutes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | DEP-10  |
| T-3 | `st:241` `LaneSpan`, `BarberDayLane.rostered`/`blocks` (`:731-759`), `dayGeometry` (`:1860-1890`)                                                                                                                         | `{ startMs; endMs }` instants of ranges the store HOLDS as `MinuteRange`                                    | `rostered`/`blocks: readonly MinuteRange[]` (zero inbound mapping); `StaffDayCell` gains `localDate: LocalDate`                                                                                                                                                                                                                                                                                                                                                                                                                           | DEP-10  |
| T-4 | `st:266` `LaneGap` copy, `dayCells` (`:1905-1924`)                                                                                                                                                                        | the system's gap re-expressed as instants, the cut minute replaced by the clock's ms                        | `gaps: readonly LaneGap` from `@core/systems` (`GridLayoutSystem.laneGaps(rostered, occupied, now, localDate)`), one home per name                                                                                                                                                                                                                                                                                                                                                                                                        | DEP-4/5 |
| T-5 | `st:328` `occupiedIntervals`, `:372` `laneGaps` + `dashboard/src/index.ts:3`                                                                                                                                              | instant wrappers; consumers: `lane-gaps.spec.ts` only                                                       | DELETED with the re-export; `lane-gaps.spec.ts` retired — its minute cases ported to `grid-layout.system.spec.ts` by W0-S where not already pinned (§4.1)                                                                                                                                                                                                                                                                                                                                                                                 | —       |
| U-1 | `st:862` `_nowMs = signal<number>`, `:871` `nowMs`, `:474` `utcMsOf`, `:486` `shopNowOf`                                                                                                                                  | widens the clock port's `UtcEpochMs`, re-brands with a defect                                               | `signal<UtcEpochMs>`; `utcMsOf` deleted; `shopNowOf(now: UtcEpochMs, zone)`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —       |
| D-1 | `st:894` `todayKey = computed<string>(… ?? '')`, `:897` `_dayKey`, `:902` `dayKey`, `:926` `_published.day`, `:1247` `visibleDays`, `:248` `StaffDayCell.dayKey`, `cellFor`/`barberDay`/block writers' `dayKey`           | `LocalDate` widened, `''` = "no zone yet"                                                                   | `todayKey: LocalDate \| null`, `_dayKey: LocalDate \| null`, `dayKey: LocalDate \| null`, `visibleDays: readonly LocalDate[]`; the effect at `:899-913` and every `=== ''` (`sd:2785-2787`, `:2851`) move together (two-pass hazard, §7)                                                                                                                                                                                                                                                                                                  | —       |
| D-2 | `st:224`/`:230` `addDays`/`startOfWeek(dayKey: string)`, `:295` `localDateOf`                                                                                                                                             | string wrappers whose bad key "walks nowhere"                                                               | DELETED; callers use `LocalDate.addDays`/`startOfWeek`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —       |
| D-3 | `st:1076-1084` `goToDay`, `:1676-1681` `probeDay`                                                                                                                                                                         | hand regex `/^\d{4}-\d{2}-\d{2}$/`                                                                          | `LocalDate.parse` at the route/probe edge (D-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | DEP-13  |
| I-1 | `st:1220` `_scope`, `:1223` `setScope`, `:1229` `applyRouteBarber`                                                                                                                                                        | raw `?barber=`                                                                                              | `BarberId \| null`; `BarberId.parse` at the edge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | DEP-14  |
| I-2 | `st:732` `BarberDayLane.barberId`, `:278` `laneKeyOf`, `:350-357` `BarberId.of`, `:1257`/`:1701` lane inputs                                                                                                              | raw chair ids re-branded                                                                                    | `BarberId` throughout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —       |
| I-3 | `st:1295-1374` note/photo probes, `:1407-1482` attach/adopt requests, `:1495-1521` grants probe, `:1976-2002` pending/errors maps, `:2258`/`:2288` arrival, `:2439-2599` queued edits/claims, `:2084-2200` absence writes | raw `appointmentId`/`customerId`/`barberId`/`locationId`/`operationId` strings with `.of` at each call      | branded parameters and map keys; the `.of` casts and the empty-string guards go                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —       |
| D-4 | `st:155-160` `expiresOnIn`                                                                                                                                                                                                | `LocalDate` widened to `string`                                                                             | `LocalDate \| null` → `VisitEditorGrantOption.expiresOn` → `ClientCardGrant.expiresOn` (W2-CK)                                                                                                                                                                                                                                                                                                                                                                                                                                            | —       |
| G-1 | `st:173-219` `StaffView`, `STAFF_VIEWS`, `parseView`, `DAY_SPAN`                                                                                                                                                          | lower-case union, bare compares (`sd:1938`, `:2142`, `:2230`, `:6332`, `:6359`; html `:15`, `:140`, `:436`) | contract-spelled dictionary (`StaffView.Agenda = 'agenda'` …). `parseView` stays NULLABLE: `Tag.has(StaffView, raw) ? raw : null` — `applyRouteView` (`st:1190-1210`) depends on `null` to tell silence (keep the restored device view, state it in the URL) from an unknown name (fall back to agenda); `Tag.or(StaffView, raw, StaffView.Agenda)` ONLY in `readStoredView` (`st:198`, today `?? 'agenda'`). W1-S1 pins the silence case in the store spec: no `?view=` with a stored `'week'` stays week and the URL states `view=week` | —       |
| E-1 | `st:2072` `_absenceError`                                                                                                                                                                                                 | bare `'invalid'`/`'failed'`, pipeline results dropped                                                       | `StaffBlockFailure` (D-9.4): the pipelines' structs; zone unknown → `CatalogError.locationZoneUnknown(locationId)`; the bad-day branches deleted (unrepresentable); template truthiness unchanged (`staff-dashboard.html:1389`)                                                                                                                                                                                                                                                                                                           | —       |
| E-2 | `st:1622` `_noteError`                                                                                                                                                                                                    | an appointment id in an error field; no reader                                                              | DELETED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —       |
| S-1 | `st:1629-1647` `saveTeamNote`                                                                                                                                                                                             | the note record built here and in `appendTeamNote`                                                          | calls the NEW `saveTeamNote` pipeline (D-10.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —       |

### 1.2 Staff dashboard (`sd`, `staff-dashboard.html`) — W1-S3

| Id   | Site                                                                                                                                                                                                                          | Today                                                                                         | Target                                                                                                                                                                                                            | DEP           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| T-6  | `sd:516`/`:518` `DayRowVm.startMs`/`endMs`, `toRow` `:3449-3450`                                                                                                                                                              | instants from `wallClockInstant` for past/live/next/order/`rowShape`/`whenLabel`/`catalogTag` | DROPPED; `startUtcMs`/`endUtcMs: UtcEpochMs` kept for the countdown only (D-6.4/5); `rowShape` (`:350-357`) keys on `localDate`+`startMinute`+`endMinute` (same equality)                                         | DEP-1…3, 12   |
| T-7  | `sd:3622-3626` `past`/`live`; `:2259` lane visit past; `:2314` block past                                                                                                                                                     | instant compares                                                                              | `VisitStorySystem.hasStarted`/`hasEnded` with `store.shopNow()`                                                                                                                                                   | DEP-1, DEP-3  |
| T-8  | `sd:2639` `isNext`                                                                                                                                                                                                            | `startMs > nowMs`                                                                             | `¬hasStarted`                                                                                                                                                                                                     | DEP-2         |
| T-9  | `sd:2629-2631` lane run order                                                                                                                                                                                                 | `a.startMs − b.startMs`                                                                       | stable by `startMinutes`                                                                                                                                                                                          | —             |
| T-10 | `sd:2700-2747` agenda buckets, group key, `past`, `agendaNowIndex`; `AgendaGroupVm.startMs` (`:697`), `GapRowVm.startMs` (`:710`)                                                                                             | ms buckets and compares                                                                       | `startMinutes: MinuteOfDay` buckets, `hasStarted`, key `String(startMinutes)`                                                                                                                                     | DEP-4, DEP-5  |
| T-11 | `sd:1508-1566` search `past`/order, `SearchHitVm.whenMs` (`:887`), `dayKey` (`:884`), `:1454` `endInstantOf`, `:1600` `searchWhenLabel`                                                                                       | instants in `store.zone()`, `+∞` before the zone                                              | `hasEnded` with the visit's shop `ShopNow` (null until `store.shopNow()`), `WallTime.compare` order, `whenMs` dropped, `dayKey: LocalDate`, `id: AppointmentId`, label `formatWallClock(localDate, startMinutes)` | DEP-6         |
| T-12 | `sd:5707-5733` «Скорошни», `:5775` `shortDate`                                                                                                                                                                                | `utcEpochMs < now`, instant sort, instant label                                               | `hasStarted` per shop `ShopNow`, `WallTime.compare` desc, `formatWallClock(localDate, null)`                                                                                                                      | DEP-7         |
| T-13 | `sd:3403-3428` `catalogTag`; `:529`/`:3615` `durationMinutes`                                                                                                                                                                 | span from instants; dead field                                                                | `MinuteCount.span`; field deleted                                                                                                                                                                                 | DEP-8         |
| T-14 | `sd:6371-6388` `openBlock`, `:2302` block id, `:6051` `blockEdit.blockId`                                                                                                                                                     | `block:<barber>:<startMs>`, `minuteAfter`                                                     | `block:<barber>:<startMinutes>`, the block's own minutes                                                                                                                                                          | DEP-9, 11     |
| T-15 | `sd:2025-2060` `openWindowsOf`, `:2287-2321` `blocksFor`, `:2359-2391` `rosterHull`/`rosterExtent`, `:1443-1497` `wallAt`/`minuteAt`/`minuteAfter`/`instantLabel`, `:2331` `minuteOfDay`, `:2343` `nameClock`, `:3301` `time` | instant ↔ minute round trips                                                                  | minutes from the lanes; `formatWallClock(localDate, minute)` for wall values; `formatInstant(UtcEpochMs)` only for stamps (`:3320` resolution stamp, now label)                                                   | DEP-10        |
| T-16 | `sd:3096-3122` `whenLabel`, `relativeTime` (`libs/infrastructure/i18n/src/lib/relative-time.ts:31`)                                                                                                                           | raw ms                                                                                        | `relativeTime(target: UtcEpochMs, now: UtcEpochMs)`, `UtcEpochMs.elapsedMs`; W1-S3 owns the i18n file (its only production caller)                                                                                | DEP-12        |
| T-17 | `sd:2096-2112` `zoneLabel` (fresh `Intl.DateTimeFormat` in a computed), `deviceZone`                                                                                                                                          | zone reading in a component                                                                   | `formatZoneName(utcEpochMs, zone, locale)` added to `@creativo/ui/wall-clock` (cached, X-1); `deviceZone` STAYS (device display, not shop math)                                                                   | —             |
| U-2  | `sd:1433` `nowMs` alias, `:6714` `utcEpochMsOf`, `:3559` summarize                                                                                                                                                            | raw re-branded                                                                                | `UtcEpochMs` end to end; `utcEpochMsOf` deleted                                                                                                                                                                   | —             |
| U-3  | `sd:646` `arrivedMs`, `:4109-4110` → `arrivedMinute`                                                                                                                                                                          | raw                                                                                           | `arrivedAtUtcMs: UtcEpochMs \| null`; `arrivedMinute: MinuteOfDay \| null` via `ZonedTimeSystem.toLocal` (a stamp read onto the wall clock)                                                                       | —             |
| I-4  | `sd:440-692` `DayRowVm` ids: `appointmentId`, `locationId`, `seatId` (`'' ` fallback `:3604`), `seatIds`, `ownerUserId`, `ownerCustomerId`, `email`                                                                           | widened brands                                                                                | `AppointmentId`, `LocationId`, `SeatId \| null`, `readonly SeatId[]`, `UserId \| null`, `CustomerId \| null`, `Email \| null`; `id` stays the opaque row key                                                      | —             |
| I-5  | `sd:383-394` `transitionSeatsOf`, `:4583`, `:4532`, `:4581`, `:5222-5290`, `:3744`, `:4334`, `:6633`, `:2064`, `:5105`                                                                                                        | `.of` casts on raw VM ids, `signal<string \| null>` id state                                  | casts go; id signals typed                                                                                                                                                                                        | —             |
| I-6  | `sd:1283` `cardViewer`                                                                                                                                                                                                        | `{ uid: string; roles: string[] }`; `uid` unread                                              | `{ userId: UserId; roles: readonly Role[] } \| null`                                                                                                                                                              | —             |
| I-7  | `sd:1310-1360` `clientCardCatalog` IIFE + `get locationCount()`                                                                                                                                                               | a getter on data                                                                              | a `computed()` lookup with a plain `locationCount` (lookups typed on brands; satisfies both the old and the new contract — parameters are contravariant)                                                          | —             |
| I-8  | `sd:5371-5391` `createVisit`, `:5420-5480` new VM (`appointmentId: ''`), `:5560-5590` rebook, `:5060` reseed signal                                                                                                           | raw ids, `''` sentinels                                                                       | `AppointmentId \| null` (null = creating), `BarberId`, `UserId \| null`, `bookedFrom?: AppointmentId`                                                                                                             | —             |
| I-9  | `sd:3956`/`:3965` `onVisitChairChanged`/`onCreateChairChanged`, `:3884` `visitDraftChair`, `:3951` `onVisitDayChanged`, `:3882` `visitDraftDay`, `:6594` `pickScope`, `:6579-6582` the `'all'` sentinel                       | raw                                                                                           | `BarberId`, `LocalDate`; `SCOPE_ALL` named constant (never a `BarberId`)                                                                                                                                          | —             |
| D-5  | `sd:1995` `dayNumber` slice, `:2482-2503`, `:2780-2862` week calendar/`followWeek`/`selectedWeek`, `:4155`, `:6075`, `:6307`, `:6343`, `:6549`                                                                                | string keys, `localDateOfKey`                                                                 | `LocalDate`; `LocalDate.parts(d).day`                                                                                                                                                                             | —             |
| M-1  | `sd:548` `priceCents`, `:2431-2437` `seatsPriceCents`/`seatsPrice`, `:3618`, `:4098`, `:5454`; legs `:3640-3670`                                                                                                              | `PriceCents` widened, currency dropped                                                        | `priceCents: PriceCents \| null` + `currency: Currency` on the row and on each leg                                                                                                                                | —             |
| M-2  | `sd:1866-1905` `serviceOptions` (`termsToVm` + `content.price(terms.price)`)                                                                                                                                                  | a MAJOR-unit float re-labelled                                                                | W1-S3 derives `priceCents`/`currency`/`minutes: DurationMinutes` from `OfferingPriceSystem.termsFor(findService(id), barberId)`; the LABEL line stays on `content.price` until W2-M switches it                   | DEP-19 (W2-M) |
| M-3  | `sd:4306`, `:6720-6800` `discountsOf`/`vouchersOf`/`toDiscountRequest`                                                                                                                                                        | raw minor units re-branded                                                                    | brands straight from `DiscountProvenance`/`VoucherRedemption`                                                                                                                                                     | —             |
| S-2  | `sd:4597-4870` `commandsFor`, `:4384-4572` save/write, `:5935-6040` `createFromEditor`, `:4560-4565` tip seat                                                                                                                 | the write plan in a component                                                                 | `StaffEditPlanSystem` (D-10.1); orchestration stays                                                                                                                                                               | DEP-20        |
| S-3  | `sd:278` `EditorWrite`                                                                                                                                                                                                        | three booleans                                                                                | `VisitEditWriteOutcome` + `sidesWritten`                                                                                                                                                                          | —             |
| S-4  | `sd:4319-4320` `actFromSheet` dismissal                                                                                                                                                                                       | hand-spelled set                                                                              | `StaffVerb.didNotHappen`                                                                                                                                                                                          | —             |
| G-2  | `sd:4189` `discardPending`; `:1758` `openPicker`, `:6485-6489` `presentOnly(keep)`, `:6620` `togglePicker`; `:910`/`:1546-1597` search field labels                                                                           | lower-case unions                                                                             | `DiscardTarget`, `DayPicker`, `DaySurface`, `SearchField` (SCREAMING; internal — proved by grep)                                                                                                                  | —             |
| G-3  | `sd:2087` `pendingAction`                                                                                                                                                                                                     | never set                                                                                     | DELETED with its sheet                                                                                                                                                                                            | —             |
| G-4  | `sd:5762` client section id `'recent'`                                                                                                                                                                                        | bare literal into a test id (`staff-visit-clients-recent`)                                    | `VisitEditorClientSectionId.Recent = 'recent'` (contract), declared in the editor contract                                                                                                                        | —             |

### 1.3 Visit editor (`ve`, `staff-visit-editor.html`, `client-query.ts`, `visit-editor-discount.ts`) — W1-S2

| Id   | Site                                                                                                                                                                                                                                                            | Today                                                                   | Target                                                                                                                                                         | DEP    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I-10 | `ve:378-522` `VisitEditorVm` ids (`appointmentId` `''`=creating, `clientUserId`, `clientCustomerId?`, `locationId`, `chairId` `''`), `dayKey`, `todayKey`, `nowMinute`                                                                                          | raw, `''` sentinels                                                     | §2.4 (`AppointmentId \| null`, `UserId \| null`, required `CustomerId \| null`, `LocationId \| null`, `BarberId \| null`, `LocalDate`, `now: ShopNow \| null`) | —      |
| I-11 | `ve:215-251` `VisitEditorLeg`, `:291-304` commit legs, `:793-865` `DraftLeg`/`DraftClient`/`VisitDraft`, `:1015` `LegMenu`, leg methods `:1975-6433`, `:3856-3861` `serviceCount` maps, `:7159` `addCountedService`, `:4031`/`:7208` minted seat ids            | raw seat/service/variant/barber ids, `''` barber sentinel (`:6766`)     | `SeatId` (a minted `draft-…` id is a `SeatId` by construction), `ServiceId`, `ServiceVariantId \| null`, `BarberId`                                            | —      |
| I-12 | person key: `ve:609-621` `VisitEditorClientOption.id`, `:809` `DraftClient.id`, `:229`/`:799` `clientId`, `:328` commit clients, `:1222`/`:1251`/`:4366`/`:6869`/`:5235`/`:3948`, `:4450-4454` mint, `:1283` seed placeholder                                   | one raw string, three spellings                                         | `DraftPersonKey`                                                                                                                                               | —      |
| I-13 | `ve:612-621` `email?`, `client-query.ts:29-33`/`:116` `RankableClient`/`toRankable`                                                                                                                                                                             | optional email                                                          | required `email: Email \| null`; ecs-core `RankableClient`                                                                                                     | —      |
| I-14 | `ve:581-587` `VisitEditorPhoto` (`photoId`, `takenAtUtcMs: number`, `barberId`), `:1651` `photoRemoved`, `:5139-5283`, `:5386` `shopMoment`                                                                                                                     | widened brands                                                          | `AppointmentPhotoId`, `UtcEpochMs`, `BarberId`                                                                                                                 | —      |
| I-15 | `ve:691-745` discount/voucher/grant/promo ids, `:967` `OfferChoice.id`, `:6230-7127`, `:5045` `CouponId.of`                                                                                                                                                     | raw ids, `expiresOn?: string`                                           | `CouponGrantId`, `GiftVoucherId`, `CouponId`, `LocalDate \| null`; `OfferChoice` split (D-8.10)                                                                | —      |
| I-16 | `ve:566-579` `VisitEditorServiceOption`, `:1069-1104` barber/shop options, `:1707` `chairChanged`, `:1700` `dayChanged`                                                                                                                                         | raw                                                                     | `ServiceId`/`ServiceVariantId`/`BarberId`/`LocationId`/`LocalDate`; option `id` stays an opaque key                                                            | —      |
| I-17 | `ve:1667` `uiOwnerUserId`, `:1673-1676` `uiViewer`, `:6798` viewer fallback                                                                                                                                                                                     | raw                                                                     | `UserId \| null`; viewer per D-10.6                                                                                                                            | —      |
| T-18 | `ve:3116-3140` `shopNowAt`, `:2619-2635` neighbour ended, `:2620`/`:3138` string day compares, `:5412`/`:7296` year slices, `:6583` `stepDay`                                                                                                                   | ShopNow built in a `computed()` from a fresh clock                      | `vm.now` (D-10.5); `LocalDate.compare`; `LocalDate.parts(…).year`                                                                                              | —      |
| T-19 | `ve:5406-5413` `photoDay`                                                                                                                                                                                                                                       | the photo's year read through an `en-CA` Intl formatter                 | `ZonedTimeSystem.toLocal(takenAtUtcMs, zone).localDate` + `LocalDate.parts`                                                                                    | —      |
| N-1  | `ve:828-865` `VisitDraft.startMinute`, `durationOverride`, `:231`/`:240`/`:576` minutes, `:284-295` commit start/end/minutes, `:1171-1214` converters                                                                                                           | raw track minutes, raw durations                                        | `TrackMinute`; `DurationMinutes`; the converters' defects go where the brand arrives (`VisitDraftSystem.snap`/`typedSpan` return brands)                       | —      |
| N-2  | `ve:1161-1168` `parseClock`, `:1155-1159` `clockLabel`, `:2399-2405`, `:3706-3718`                                                                                                                                                                              | feature-local parser (unanchored) and face                              | `MinuteOfDay.parseClock`, `formatClock(t, ClockClosing.Wrap)` (`@creativo/ui/wall-clock`)                                                                      | DEP-22 |
| M-4  | `ve:449` `priceCents`, `:1217` `billCentsOf`, `:707-711` `availableMinorUnits`, `:7364` `drawableCentsOf`, `:671-689` discount value, `:5526-5530` manual read, `:3827` `figureOf`, `:6024` `moneyLabel` (11 raw callers), `:5503`/`:5552`/`:5839` `MONEY_CODE` | raw money re-parsed, a per-call `Intl` builder with a hard-coded `/100` | `PriceCents` + `Currency` end to end; `availableCents`; `formatCentsFigure` (X-1); the editor formats in the bill's currency (DEP-21, identical for EUR data)  | DEP-21 |
| M-5  | `ve:1369-1371` `snapshotCommitOf` (`parsePriceInput(leg.priceLabel)`), `:6542-6546` `catalogueTotalLabel`, option→leg copies `:2258-2265`, `:2333`, `:4036`, `:7213`                                                                                            | money re-parsed from labels                                             | cents copied; `PriceCents.sum`                                                                                                                                 | DEP-20 |
| G-5  | `ve:943` `DiscountKind`, `:4961-4967` cast, switches `:5482-5740`, html `:705-910`; `:5803` `codeState`; `:2371-2392` `timingMode`; `:5256-5297` photo door; `:926` `PageArrival`                                                                               | lower-case unions                                                       | SCREAMING dictionaries + `Tag.has` guards; test ids keep their literal suffixes                                                                                | —      |
| G-6  | `ve:4769-4789` `shopView`; `:3066-3081` `resolutionKey`/`resolutionTone`; `:1061-1067`/`:3169-3241` `VisitExit.id`; `:4590-4694` tip tile ids                                                                                                                   | lower-case unions printed into `data-*`/test ids/i18n keys              | contract-spelled dictionaries (D-8.2); `resolutionTone` reuses the DS foreground tone type                                                                     | —      |
| G-7  | `ve:899-916` `editorPageWords` → `client-card.store.ts:1623` `barTitle(kind: string, …)`                                                                                                                                                                        | a cross-library API typed `string`                                      | NEW `ClientCardPage` dictionary in `client-card.contracts.ts`; the editor maps `EditorPage` → `ClientCardPage` (W2-CK)                                         | —      |
| S-5  | `ve:6685-6713` `heldCatalog` getter                                                                                                                                                                                                                             | getter on data                                                          | a `computed()` lookup                                                                                                                                          | —      |
| S-6  | `ve:6729-6805` `cardSubjectOf`/`cardContextOf`, `:7336-7346` `shopIsoOf`                                                                                                                                                                                        | an ISO string the card parses back                                      | §2.6 (W2-CK)                                                                                                                                                   | DEP-15 |

### 1.4 Time grid, timeline, block editor, day pill, gestures — W1-S1

| Id   | Site                                                                                                                                                                   | Today                                                           | Target                                                                                                                                                               | DEP |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| N-3  | `tg:66-275` `GridEvent`/`OpenWindow`/`GridWindow`/`GridDraft`, placed/drag state; `tl:112-147` bands/drag; `minute-run.ts:20-28`                                       | raw track minutes                                               | `TrackMinute` (D-5); `GridEvent.startMinute`/`endMinute`                                                                                                             | —   |
| N-4  | `tg:623` / `tl:202` `nowMinute = input<number \| null>`                                                                                                                | raw                                                             | `MinuteOfDay \| null` (from `shopNow.currentMinute`)                                                                                                                 | —   |
| N-5  | `gg:279-341` `PlacementVerdictSlice` Short arm `minutes: number` (carried T1)                                                                                          | raw floor although `DurationMinutes.of(floor).value` is at hand | `minutes: DurationMinutes`                                                                                                                                           | —   |
| N-6  | `gg:85`/`:96` `hourLabel`/`timeLabel`, `tg:631-636` now label, `be:246-250` `clockLabel`, `be:253-258` `parseClock`                                                    | hand faces/parser                                               | `formatClock(…, ClockClosing.Wrap)` (`@creativo/ui/wall-clock`), `MinuteOfDay.parseClock`                                                                            | —   |
| G-8  | `tg:424` `Placement`, `:669` `uiColumnKind`, `:728` `uiViewport`, `:1423`/`tl:424` `readoutTone`, `:1252-1268`/`tl:860-869` offscreen, `gg:190`/`:228` axis            | lower-case unions                                               | inputs and `data-*` hooks stay contract unions (D-8.8); `readoutTone` → ONE shared type (the DS foreground tone); offscreen/axis → file-local SCREAMING dictionaries | —   |
| I-18 | `tg:576-810` `GridColumn.id`, `allDay` record, outputs `eventPicked`/`gapPicked`/`blockPicked`/`dayPicked`/`allDayPicked`, `uiEditableEventId`; `tl:198`/`:830`/`:996` | heterogeneous opaque keys                                       | STAY opaque `string` (D-3); `dayPicked` output → `LocalDate`                                                                                                         | —   |
| I-19 | `be:118-193` `BlockEditorLane`/`Vm`/`Range`/`Commit`/`Draft` (`blockId`, `barberIds`, `dayKey`, `todayKey`, `nowMinute`), `:261` `dayOf`, `:428-449`, `:800`/`:1004`   | raw                                                             | `BarberId`, `ScheduleExceptionId \| null`, `LocalDate`, `now: ShopNow \| null`; `dayOf` deleted                                                                      | —   |
| G-9  | `be:501-510` `page = signal<'repeat' \| null>`                                                                                                                         | a one-variant tag                                               | `repeatPageOpen: boolean` (OQ-9 of the UI residue plan: one-variant tags are deleted)                                                                                | —   |
| D-6  | `day-pill/staff-day-pill.ts:97-100` `localDateOfKey`, `:32` formatters, `:175-205` inputs/outputs                                                                      | a rolling-over parser, raw keys                                 | deleted; `LocalDate` in and out (the DS `uiToday` accepts `LocalDate` — assignable to its `UiDayKey` today)                                                          | —   |
| G-10 | `agenda-fields.ts:62-75` `AgendaFieldId`                                                                                                                               | lower-case union, stored as localStorage JSON keys              | contract-spelled `AgendaField`                                                                                                                                       | —   |
| N-7  | block editor weekday rule (`UiIsoWeekday`)                                                                                                                             | `number[]`                                                      | `Weekday[]` (W2-U narrows the picker)                                                                                                                                | —   |

### 1.5 Client card (`cc/`) — W1-K (internal) and W2-CK (contracts)

| Id   | Site                                                                                                                                                                                                                                                                                                                                                                                                                                 | Today                                                                                                                                                                                        | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pkg                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| U-4  | `client-card.store.ts:414` `_nowMs = signal(0)`, `:1674` `readNow(): number`, `:549` `visitNow` re-parse, `:504-509` `today`/`paused`, `:410` `customerId`                                                                                                                                                                                                                                                                           | raw now, raw day, re-parses                                                                                                                                                                  | `signal<UtcEpochMs>(UtcEpochMs.EPOCH)`, `readNow(): UtcEpochMs`, a store `shopNow: ShopNow \| null` handed to presenters, `today: LocalDate \| null`, `customerId: CustomerId \| null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | W1-K                                         |
| U-5  | `client-card.presenter.ts:101-114` `pauseOf`, `:143`/`:161`/`:234`/`:304` inputs, `:369-408` photo VMs, `:587-604` `isInChairToday`; `glance.presenter.ts:179`, `:269`, `:299`                                                                                                                                                                                                                                                       | raw `nowMs` re-parsed with dead `!ok` branches                                                                                                                                               | `ShopNow` / `UtcEpochMs` inputs; `pauseOf` → `{ until: LocalDate \| null }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | W1-K                                         |
| D-7  | `client-card.format.ts:36-117` (`localDateOf`, `shopDayOf`, day formatters), `achievements.presenter.ts:259-270`, `wallet.presenter.ts:296-299`/`:1063`, `records.presenter.ts:347`/`:513`, `loyalty.presenter.ts:326`, `glance.presenter.ts:357`/`:600`/`:618`, `client-card.presenter.ts:120`; every presenter `today: string` input and day-valued VM field (wallet `sinceDay`, rhythm `day`/`nextDue`, `DetailLevelVm.earnedOn`) | five defect copies, soft parses                                                                                                                                                              | `LocalDate` everywhere; copies deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | W1-K                                         |
| U-6  | `client-pages.vm.ts:272` `previousVisitAtMs`                                                                                                                                                                                                                                                                                                                                                                                         | raw                                                                                                                                                                                          | `previousVisitUtcMs: UtcEpochMs \| null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | W1-K                                         |
| I-20 | `client-pages.vm.ts` ids (`:148`, `:174`, `:224-234`, `:241`, `:266-268` maps, `:293`, `:331`, `:617`, `:642`, `:729`, `:756`, `:880`, `:1042`, `:1065-1067`)                                                                                                                                                                                                                                                                        | raw entity ids                                                                                                                                                                               | their brands; chip/record keys stay opaque                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | W1-K                                         |
| I-21 | `client-card.store.ts:1687-2351` loaders `uid: string`, three `UserId.parse` (`:1724`, `:1807`, `:2096`)                                                                                                                                                                                                                                                                                                                             | raw, re-parsed                                                                                                                                                                               | `UserId`; parses go (the subject's `userId` is produced by `accountOf`, which already parses)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | W2-CK                                        |
| I-22 | `client-card.store.ts:1198-1220` `visitBarbers` (ids AND days in one `Map<string,…>`), `:659-672` `visitTitles`, `:1177` `visitNames`                                                                                                                                                                                                                                                                                                | mixed key spaces                                                                                                                                                                             | `ReadonlyMap<AppointmentId, string>` and `ReadonlyMap<LocalDate, string>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | W1-K                                         |
| I-23 | `history.presenter.ts:130-145`, `client-card.presenter.ts:327-329`/`:349-363`, `medal-detail.presenter.ts:205-212`/`:252`/`:959`, store `:204` `photoCounts`                                                                                                                                                                                                                                                                         | raw subject ids                                                                                                                                                                              | `UserId`, `CustomerId \| null`, `AppointmentId \| null`, `ReadonlyMap<AppointmentId, number>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | W2-CK                                        |
| I-24 | `client-card.contracts.ts:19-204` `ClientCardSubject`, `ClientCardLeg`, `ClientCardContext`, `ClientCardGrant`, `ClientCardCatalog`, `AchievementScope`; presenters' re-brands (`client-card.presenter.ts:211-217`, `:296`; `glance.presenter.ts:450`; `medal-detail.presenter.ts:923`; store `:750`; `achievements.presenter.ts:334-1597`; `medals.presenter.ts:823`; `loyalty.presenter.ts:339`; `wallet.presenter.ts:533`)        | raw contract ids, re-branded inconsistently                                                                                                                                                  | §2.6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | W2-CK                                        |
| G-11 | `client-card.contracts.ts:216` `ClientCardRegion`, `:174` `WalletAnchor` (+ `client-loyalty.ts:51` `WalletSection`), `client-pages.vm.ts:84`…`:1034` id/tone unions, `client-card.words.ts:61-126` `*Word` unions                                                                                                                                                                                                                    | lower-case unions, bare compares (`visits-page.presenter.ts:173-176`, `records.presenter.ts:293`/`:493`, `client-loyalty.ts:243-253`, `achievement-detail.html:331`, `client-card.html:239`) | contract-spelled dictionaries; `WalletSection` reuses `WalletAnchor`; `RecordThemeWord` = `RecordTheme`; word switches switch on the SCREAMING source tag. The `WalletAnchor` (`:173`) and `ClientCardRegion` (`:215`) DECLARATION blocks of `client-card.contracts.ts` (~`:170-220`, values contract-spelled) are **W1-K's in wave 1** — the one exception to "contracts are W2-CK's", safe because W2-CK edits the file only in wave 2 — together with their bare compares (`client-card.ts:237-240`, `:51-54` `GlanceModule = Exclude<ClientCardRegion, …>` re-spelled with the members, `client-card.store.ts:1567`, `client-loyalty.ts:243-253`) | W1-K (W2-CK for `WalletAnchor`'s editor end) |
| G-12 | `achievements.presenter.ts:184-215` `achievementScopeKey`/`Of`                                                                                                                                                                                                                                                                                                                                                                       | a string key with a hand regex for the day                                                                                                                                                   | keeps the key (D-8.9); the day half parses through `LocalDate.parse` (proven by construction)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | W1-K                                         |
| E-3  | `client-card.store.ts:1930-1958` `timed`                                                                                                                                                                                                                                                                                                                                                                                             | a near-copy of the rhythm store's                                                                                                                                                            | `timedRead` (W3-T)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W3-T                                         |
| G-13 | `client-card.format.ts:25-28` `CardLocale`/`cardLocaleOf`                                                                                                                                                                                                                                                                                                                                                                            | a copy of `Locale`                                                                                                                                                                           | `Locale` + `Tag.or` (W3-T)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | W3-T                                         |

### 1.6 Shared visits, client appointments, client account — W2-CK

| Id   | Site                                                                                                                                          | Today                                           | Target                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| I-25 | `sv/visit-row.vm.ts:146` `VisitRowVm.id` (carried T1), `visit-row.presenter.ts:294` widening, `:631`                                          | an appointment id OR a waitlist request id, raw | split by `visitRowEntry`: the Visit arm `AppointmentId`, the Waitlist arm `WaitlistRequestId`; `openRow` emits `AppointmentId` for a visit |
| I-26 | `sv/visit-card/visit-card.vm.ts:57` `VisitCardVm.id`                                                                                          | same                                            | split by `visitCardSlot`; `client-account.ts:413` `openUpcoming(id: AppointmentId)` (URL `?visit=` spelling unchanged)                     |
| I-27 | `sv/visit-row.vm.ts:138`, `visit-row.presenter.ts:113` photo ids, `visit-card.ts:137` `openPhoto`                                             | raw                                             | `AppointmentPhotoId`                                                                                                                       |
| I-28 | `visit-row.presenter.ts:129-139` `VisitRowOptions` (carried T1), `visit-card.vm.ts:133-139`, `:715-725` `userIdOf`/`namedRecordOf`            | raw subject ids re-branded                      | `UserId \| null`, required `CustomerId \| null`, `AppointmentId \| null`; the re-branders go                                               |
| I-29 | `sv/visit-row.vm.ts:228-247` `VisitLookup` (+ `client-card.contracts.ts:71` `ClientCardCatalog`), `rhythm-rule.words.ts:69` `nameOf`          | raw lookups; a method interface in a vm         | moved to `sv/visit-lookup.contracts.ts`, keyed by `ServiceId`/`BarberId`/`LocationId`; `nameOf(id: ServiceId \| ServiceCategoryId)`        |
| D-8  | `visit-row.presenter.ts:164`/`:570`, `visit-card.vm.ts:173`, `day-range.ts:32-59`                                                             | `today: string` re-parsed; `dayOf` defect       | `LocalDate`; `dayOf` deleted; years via `LocalDate.parts`                                                                                  |
| I-30 | `visit-card.presenter.ts:98-107` `nameOf(barberIds[0] ?? '')`                                                                                 | `''` stands for an id                           | `BarberId`, guarded read                                                                                                                   |
| I-31 | `client-appointments.ts:318-325` `?visit=`, `:495`, `:857` `showVisit`, `visit.vm.ts:22`, `:149`/`:1078` `VisitDayVm.dayKey` (`data-day-key`) | raw                                             | `AppointmentId.parse` at the edge (D-4); `AppointmentId`; `LocalDate` (attribute spelling unchanged)                                       |
| U-7  | `libs/features/client/appointments/src/lib/visit-ics.ts:21-22`                                                                                | `startMs`/`endMs` (already `UtcEpochMs`)        | renamed `startUtcMs`/`endUtcMs` (Law 5 naming); the RFC 5545 face STAYS (D-14)                                                             |
| G-14 | `client-appointments.ts:115` `AppointmentsView`, `:749-764` `grow(side)`                                                                      | lower-case unions                               | `AppointmentsView`, `ScrollSide` (SCREAMING, internal)                                                                                     |

### 1.7 Catalogue, landing, booking, onboarding — W2-M (money/ids), W1-B (booking internal)

| Id   | Site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Today                                                              | Target                                                                                                                                                                                                                                                                                                  | Pkg  | DEP    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| M-6  | `libs/features/shared/catalog/src/lib/content/catalog.vm.ts:42-46`/`:99`/`:104-110`, `catalog.presenter.ts:56` `toMajor`, `:65`, `:121-123`, `:160` `formatPrice`, `:171` `formatPriceCents`, `:175`, `:200`, `:237`, `catalog-wording.service.ts:33-60`                                                                                                                                                                                                                                                                                                                                | MAJOR-unit floats; a second money formatter hard-coding `'EUR'`    | `priceCents: PriceCents` + `currency: Currency`, `minutes: DurationMinutes`, ranges as `OfferingRange`; one `price(money)` → `formatCents`                                                                                                                                                              | W2-M | DEP-19 |
| I-32 | `catalog.vm.ts:24-85` VM ids (`BarberVm.id`, `barberId`, `byVariant`, variant/service ids, `includes`), `catalog-content.service.ts:173`/`:203`/`:242`; the landing's `shared/catalog-navigation.service.ts:37-43` (`barber = signal<string \| null>`, `barberId`, `openBarber(barberId: string)`)                                                                                                                                                                                                                                                                                      | raw ids (and `mediaRefOf(id: string)`)                             | `BarberId`, `ServiceVariantId`, `ServiceId`, `MediaRefId \| null`; the navigation service's signal `BarberId \| null`, `openBarber(barberId: BarberId)` (producers: `team-showcase.component.ts:151-153` from its `BarberItem.id`, `home.page.html:70` from the sheet's `barberSelected` `BarberVm.id`) | W2-M | —      |
| M-7  | consumers: `service-detail-sheet.component.ts:59-260` (+ html `:274`/`:366`), `service-row.component.ts:205`, `service-card.component.ts:75`, landing `landing-content.service.ts:78-102`, `team-showcase.component.ts:34`/html `:196`, `service-tile.component.ts:91`, `testing/landing-catalog.ts:95`, `testing/test-catalog.providers.ts:99-138`, booking `booking-services-step.ts:223-922`, `bag-sheet/booking-bag-sheet.ts:95-477`, `booking-review-step.ts:705-715`, onboarding `client-onboarding.ts:296`/`:301` (raw-id twins of `:609`), `sd:1316-1321`/`:1866-1902` (labels) | major floats, raw ids, redundant `.parse` of ids the feature built | brands; twins collapsed; redundant parses go (`booking-services-step.ts:660-674`, `bag-sheet:337/347/477`)                                                                                                                                                                                              | W2-M | DEP-19 |
| U-8  | `booking-time-sheet.ts:70`/`:78` `startMs`, `:414` `instantAt`, `:282` key; html `:65` `data-start` (read by `apps/web/e2e/booking-core.spec.ts:121`)                                                                                                                                                                                                                                                                                                                                                                                                                                   | `UtcEpochMs` widened                                               | `startUtcMs: UtcEpochMs` (value and DOM spelling unchanged)                                                                                                                                                                                                                                             | W1-B | —      |
| N-8  | `booking-wall-clock.ts:31-37` `formatBookingTime(minute: number)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | raw (every caller passes brands)                                   | `MinuteOfDay \| EndMinute` (W2-U narrows with `formatWallClock`)                                                                                                                                                                                                                                        | W2-U | —      |
| I-33 | `client-booking.ts:139-149`/`:167-260`/`:357-425`, `booking-flow.store.ts:600`/`:616`/`:749`/`:937`/`:1313`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | route ids/days raw, parsed late                                    | parsed once at the edge (D-4 table); `restoreFromWaitlist(day: LocalDate \| null \| undefined)`                                                                                                                                                                                                         | W1-B | —      |
| I-34 | `booking-review-step.ts:705`/`:723`, `booking-time-sheet.ts:430`/`:440`, `booking-confirmed-step.ts:131`/`:140`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | three copies of `personLabel`/`barberName`                         | ONE booking words helper over `SeatKeyText`/`BarberId`                                                                                                                                                                                                                                                  | W1-B | —      |
| N-9  | `waitlisted-step/booking-waitlisted-step.ts:94` `clockFace`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | hand face (1440 → `24:00`)                                         | `formatClock(…, ClockClosing.EndOfDay)` (`@creativo/ui/wall-clock`)                                                                                                                                                                                                                                     | W1-B | —      |
| D-9  | `schedule-step/availability-month.ts:52`/`:60` `key: string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `CapacityMonthId` widened                                          | `CapacityMonthId`                                                                                                                                                                                                                                                                                       | W1-B | —      |
| I-35 | `location-step/booking-location-step.ts:176` `selectPin(pinId: string)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | DS pin id                                                          | DS stays generic; `LocationId.of` at the handler (built from catalogue locations)                                                                                                                                                                                                                       | W1-B | —      |
| E-4  | `booking-flow.store.ts:602-707` `rescheduleFrom`/`refuseMove`, `client-booking.ts:251`/`:300`, `booking-words.ts:52-56`, `client-booking.html:148-174`                                                                                                                                                                                                                                                                                                                                                                                                                                  | bare `MoveRefusalReason` tags                                      | the `MoveRefusal` struct; the word table keyed by the `MoveErrorCode` refusal members, values byte-identical — converted END TO END by **W0-B** in wave 0 (D-12.7: the reshape and its feature consumers land together); W1-B leaves these lines alone but for imports                                  | W0-B | —      |
| E-5  | `booking-flow.store.ts:65` `BookingFlowFailure`, `review-step/booking-error-message.ts:8-69`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | a feature-declared error union                                     | `BookingFlowError.Failure` (errors tier)                                                                                                                                                                                                                                                                | W1-B | —      |
| E-6  | `booking-services-step.ts:466` `renameRefusal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | translated words in state                                          | the struct, worded in a `computed`                                                                                                                                                                                                                                                                      | W1-B | DEP-23 |
| S-7  | `booking-flow.store.ts:282-283`/`:883`/`:1257`/`:1299-1310` `isOpen`/`OpenFlowState`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | a third spelling of the terminal rule                              | `BookingFlowState.isTerminal` guard (D-10.8)                                                                                                                                                                                                                                                            | W1-B | —      |

### 1.8 Auth, profile, onboarding, account-state, shell identity — W1-A

| Id   | Site                                                                                                                           | Today                                                   | Target                                                                                                    | DEP    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| E-7  | `client-profile.ts:164/218/219/224`, `:349-420` `translateError`; `profile.store.ts:63-115` writes → `Promise<string \| null>` | code signals; params erased                             | struct signals and struct answers; `translateCodedError(transloco, error)`                                | —      |
| E-8  | `own-profile.ts:5-31` `NameRefusalCodes`                                                                                       | codes                                                   | `AccountsError.FirstNameTooShort \| null` / `LastNameTooShort \| null`                                    | —      |
| E-9  | `shell/identity/avatar-refusal.ts:21`                                                                                          | `string`                                                | the struct                                                                                                | —      |
| E-10 | `client-onboarding.ts:217/218/235/320`, `:449-575`, `:705-745`; `onboarding-flow.store.ts:120-143`, `:223-249`, `:277-285`     | codes; `'partial'` sentinel; birthday save loses params | structs on the state and the events; `'partial'` → an `IdentityError` (§2.11)                             | DEP-17 |
| E-11 | `client-auth.ts:201`, `:274-347`; `auth-flow.store.ts:130-206` `messageOf`                                                     | codes; the server-code rule spelled twice               | structs; ONE "server code, else `IDENTITY_CALL_FAILED`" helper shared with onboarding                     | —      |
| E-12 | `contact-sheet/booking-contact-sheet.ts:111`, `:201-240`; `booking-contact.store.ts:16-58`                                     | translated words; a boolean profile failure             | the struct; `writeProfileName` answers `Result`; `booking.contact.profileFailed` stays                    | DEP-23 |
| D-10 | `client-profile.ts:182-195`/`:376-383`, `profile.store.ts:68`                                                                  | `BirthDate` widened, re-parsed to format                | `saveBirthDate(birthDate: BirthDate)`; `ProfileEdits.birthDate` typed `BirthDate` (wire string unchanged) | —      |

### 1.9 Admin rhythm, admin programs, marketing, shell — W1-R (W3-T for `Locale`)

| Id   | Site                                                                                                                                                                                                           | Today                                                     | Target                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-11 | `admin-rhythm/admin-rhythm.words.ts:60-885` (`AdminRhythmContext.today`, `localDateOf` defect, day helpers, `effectiveReading`), `admin-rhythm.ts:282`/`:430-455`/`:790`/`:920`, `admin-rhythm-sheet.ts:213`   | raw days (every producer passes `LocalDate`)              | `LocalDate`; `localDateOf` deleted                                                                                                                                                                                        |
| D-12 | `admin-rhythm.preview.ts:62-121` (`rhythmPreviewOf` re-parse; `sampleRhythmFacts`/`sampleRhythmRun` — spec-only delegates)                                                                                     | raw days                                                  | `today: LocalDate`; the two spec-only delegates DELETED, their cases restated on `StreakPreviewSystem` (pass-C D-9 named them frozen; their only importers are specs — W1-R re-proves)                                    |
| D-13 | `admin-rhythm.store.ts:786` `setEffectiveFrom(raw: string)`, `admin-rhythm-sheet.ts:387` `pickDay`                                                                                                             | parse at the store of a month-picker day                  | `LocalDate` (the picker emits days it built — W2-U types it); the store spec's `it.each(['', 'утре', '2026-13-40', '28.09.2026'])` (`admin-rhythm.store.spec.ts:1252`) becomes unrepresentable: retired on purpose (§4.2) |
| I-36 | `admin-rhythm-sheet.ts:90-102`/`:255-296` (`as string` ×2, `ServiceId.of`), `admin-rhythm.store.ts:464`/`:797`, `admin-rhythm.ts:610-628`                                                                      | widening casts                                            | `ServiceId`/`ServiceCategoryId`; `ReadonlyMap<ServiceId \| ServiceCategoryId, string>`                                                                                                                                    |
| E-13 | `admin-rhythm.ts:780-923` `wordRefusal`/`told`, `admin-rhythm.words.ts:968-981`, `admin-rhythm.store.ts:195` alias, `:1325-1348` `timed`                                                                       | feature keys; a borrowed code; bare `'timeout'`/`'threw'` | D-9.6; `RepositoryError.readFailed`; alias deleted                                                                                                                                                                        |
| G-15 | `admin-rhythm.ts:128` `Confirmation`, alert ids; `admin-rhythm-sheet.ts:66`/`:147`/`:152` `AdminRhythmSheetKind` (`data-kind`); `admin-rhythm.words.ts:227-338`/`:702-756` menu choices and preview metric ids | lower-case unions                                         | `RhythmConfirmation` (contract), `AdminRhythmSheet` (contract; input `kind` → `sheet`), the choice dictionaries (SCREAMING, internal), `RhythmPreviewMetric` (contract — test ids)                                        |
| G-16 | `admin-programs.store.ts:25` `ProgramsTab`; `marketing-events.ts:35` `EventsTab`; `marketing-courses.ts` (`isEnrollmentOpenOrUpcoming`, `ENROLLMENT_STATUSES`)                                                 | lower-case unions; a free function                        | SCREAMING dictionaries; `ProgramsSystem.isEnrollmentOpenOrUpcoming`, `Tag.values(EnrollmentStatus)`                                                                                                                       |
| N-10 | `admin-programs.ts:60-73` `datetimeLocalOf`                                                                                                                                                                    | hand `YYYY-MM-DDTHH:mm` (a native-input contract)         | `WallTime.toLocalIso` (NEW, W0-S), shared with `translate-coded-error.ts:14-38`                                                                                                                                           |
| N-11 | landing `locations.component.ts:121` `clockOf`, `:580-586` `wallAt().minute` (dead)                                                                                                                            | hand face; dead field                                     | `formatClock(…, ClockClosing.EndOfDay)` (`@creativo/ui/wall-clock`); `minute` dropped (W1-U owns the file)                                                                                                                |

### 1.10 ecs-core — shapes, dictionaries, errors (wave 0)

| Id   | Site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Target (D-7/D-8/D-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pkg  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| S-10 | `components/role.data.ts:24-168` (6 lists, 9 free functions)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | NEW `roles.data.ts` (`Roles`); transitional delegates in `role.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | W0-I |
| S-11 | `registration.data.ts:34-52` (`REGISTRATION_FIELDS`, `isRegistrationField`, `RegistrationFields`)                                                                                                                                                                                                                                                                                                                                                                                                              | `Registration.FIELDS` (explicit, today's order), `Registration.isField`; `RegistrationFields` → own file `registration-fields.data.ts` (18 consumers keep their lines)                                                                                                                                                                                                                                                                                                                                                                                                                          | W0-I |
| S-12 | `auth-strategy.data.ts:15-273` (3 components, stray policies/input)                                                                                                                                                                                                                                                                                                                                                                                                                                            | `auth-provider.data.ts`, `auth-deployment.data.ts`; `OtpPolicy`/`LinkPolicy`/`AuthStrategyInput` → `AuthStrategy` namespace (only `otp.system.ts` reads `OtpPolicy` — same package)                                                                                                                                                                                                                                                                                                                                                                                                             | W0-I |
| S-13 | `auth-flow.data.ts:121`, `onboarding-flow.data.ts:130`, `identifier.data.ts:39-47`, `impersonation-status.data.ts:35`, `impersonation-scope.data.ts:32`, `session-kind.data.ts:20`, `otp-code.data.ts:10`, `phone-number.data.ts:8`, `account-status.data.ts:30`, `feature-flags.data.ts:30` (+ `tools/flags/feature-flags.manifest.spec.mjs`), `audit-context.data.ts:68-342`                                                                                                                                 | `auth-flow-event.data.ts`, `onboarding-flow-event.data.ts`, `parsed-identifier.data.ts`, `end-reason-fields.data.ts`, `ImpersonationLifecycle.parseScope`, `Tag.values(SessionKind)`, `OtpCode.DIGITS`, `e164.data.ts`, `AccountLifecycle.BLOCK_REASONS`, `FeatureFlags.NAMES`, `audit-target-ref.data.ts`, `AuditContext.ACTIONS`, the six action subsets → own files (consumers in other wave-0 packages keep their lines)                                                                                                                                                                    | W0-I |
| S-14 | `systems/session-access.system.ts:30-91`, `guest-guard.system.ts:13`, `onboarding-flow.system.ts:30`/`:254` (cast), `profile-completion.system.ts:15`, `audit.system.ts:107`/`:158-168`                                                                                                                                                                                                                                                                                                                        | `session-readiness.data.ts`, `route-gate.data.ts`, `access-target.data.ts`, `access-verdict.data.ts`, `access-decision.data.ts`, `settled-verdict.data.ts`, `personalize-step.data.ts` (`PersonalizeStep.ALL` + `Tag`-backed guard; the cast goes), `profile-completion-key.data.ts`, `profile-auth-type.data.ts`; `AUDITED_PROFILE_FIELDS` an explicit `RegistrationField[]` in TODAY's order (stored audit arrays)                                                                                                                                                                            | W0-I |
| E-20 | `pipelines/save-own-profile.pipeline.ts:8-51`; `verify-otp`/`request-otp`/`complete-registration`/`update-profile`/`redeem-invitation`/`start-impersonation`/`end-impersonation` `*Error` unions; `audit-context.data.ts:175-321` raw `cancellationReason`/`transitionReason`/`profileFields`                                                                                                                                                                                                                  | `AccountsError.OwnProfileSave` + `Result`; unions → `identity.error.ts`/`accounts.error.ts`/`governance.error.ts` (transitional re-exports); audit tags typed `CancellationReason`/`RegistrationField` (stored values unchanged)                                                                                                                                                                                                                                                                                                                                                                | W0-I |
| E-21 | `AuthFlowState.error`, `AuthFlowEvent.RequestFailed/VerifyFailed.message`, `OnboardingFlowState.error`, `OnboardingFlowEvent.RegistrationFailed/BirthdayFailed.message`                                                                                                                                                                                                                                                                                                                                        | struct-typed (`AuthFailure`, `OnboardingFailure` unions named in `identity.error.ts`); field names unchanged where they are not discriminators (`error`), `message` → `error`                                                                                                                                                                                                                                                                                                                                                                                                                   | W0-I |
| S-15 | `booking-flow.data.ts:38-257`, `cart-line.data.ts:40-160`, `party.data.ts:47`, `booking-draft.data.ts:46`/`:258-263`, `service-terms.data.ts:42-181`, `barber-offering.data.ts:17-43`, `service-composition.data.ts:37`, `placement-policy.data.ts:112`, `booking-policy.data.ts:57`, `media-ref.data.ts:34`, `program-input.data.ts:16-39`, `opening-hours.data.ts:37`/`:57`, `roster-window.data.ts:45`, `schedule-version.data.ts:25`, `recurrence-rule.data.ts:79-201`, `catalog-status.data.ts` (3 dicts) | splits per L-1/L-2 (§2.2); `BookingFlowState.isTerminal` guard; `BookingDraft` idOf → `Result`, contact parse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | W0-B |
| S-16 | `systems/booking-flow.system.ts:36-70`, `booking-cart.system.ts:147`, `service-conflict.system.ts:17-29`, `move.system.ts:63`/`:527-534`, `waitlist.system.ts:332`                                                                                                                                                                                                                                                                                                                                             | `booking-flow-event.data.ts`, `prefill-companions.data.ts`, `service-selectability.data.ts`; `MoveError` → `move.error.ts`; `refusalOf` builds `MoveRefusal`; `WaitlistIdBasis` named                                                                                                                                                                                                                                                                                                                                                                                                           | W0-B |
| E-22 | `MoveRefusalReason`/`MoveRefusal`; `ServiceTermsError`; `booking-flow.error.ts:113`/`:139`                                                                                                                                                                                                                                                                                                                                                                                                                     | D-9.2; `CatalogError.Terms`; `SchedulingErrorCode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | W0-B |
| G-20 | `pipelines/book-appointment.pipeline.ts:153-373`, `edit-appointment.pipeline.ts:209-936`, `reschedule-appointment.pipeline.ts:162-607` (`snapshot`, `EditOutcome`, `MoveOutcome`), `book-appointment.pipeline.ts:276` (`Parameters<…TxPorts['commit']…>`), `transition-appointment.pipeline.ts:150` (`ShopNow['utcEpochMs']`), `edit-appointment.pipeline.ts:422-424`                                                                                                                                          | NEW `booking-read-snapshot.data.ts`, `edit-call-outcome.data.ts`, `move-outcome.data.ts`; `ReadTx`; `UtcEpochMs`; `MinuteDelta.fromDuration`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W0-W |
| E-23 | the booking/staff-edit/media pipeline `*Error` unions; `appointment-edit.system.ts:73` `StaffEditGuardRefusal`, `:170` `LedgerVerdict`                                                                                                                                                                                                                                                                                                                                                                         | `booking.error.ts`/`staff-edit.error.ts`/`media.error.ts`; `ledger-verdict.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | W0-W |
| S-17 | `systems/visit-list.system.ts:10-37`, `visit-story.system.ts:35`/`:53`/`:288-301`, `billing.system.ts:67-191`, `client-query.system.ts:8`, `grid-layout.system.ts:28`/`:108-124`, `visit-draft.system.ts:27`/`:66-72`/`:232-289`/`:313`, `interval-set.system.ts:15`, `seat.data.ts:28-188`, `seat-outcome.data.ts:77`, `seat-id-pair.data.ts:79`, `staff-verb.data.ts`, `time-coordinate.data.ts:51`, `wall-time.data.ts`                                                                                     | the visit family (`visit-grain`, `visit-row-outcome`, `visit-filter`, `visit-perspective`, `cancelled-side`), `bill-pending`, `tip-preset`, `client-query-shape`, `grid-event`, `repeat-preset`, `normalized-ranges` (the cast moves to its own file with `normalize`), `seat-occupant`, `cancellation-reason-set`, `stood-seat-pairs`, `arrival-verb`, `mark-arrival-action`; `StaffVerb` companion (`didNotHappen`); `TimeCoordinate.instantAt`; `WallTime.toLocalIso`; `PersonSubject` folded; person keys → `SeatKeyText`; `DraftPersonKey`/`TrackMinute` in the draft and track signatures | W0-S |
| S-18 | NEW `staff-edit-plan.system.ts`, `staff-edit-draft.data.ts`, `visit-edit-write-outcome.data.ts`; `pipelines/append-team-note.pipeline.ts` (`saveTeamNote`)                                                                                                                                                                                                                                                                                                                                                     | D-10.1/D-10.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | W0-S |
| S-19 | `gamification.data.ts:127-319`, `streak-rule.data.ts:32-623`, `streak-state.data.ts:50-141`, `tier-state.data.ts:25-80`, `standing.data.ts:19-59`, `journal-effect.data.ts:47-320`, `journal-source.data.ts:38`, `grant-lifecycle.data.ts:28-117`, `badge-level.data.ts:49-72`, `enrollment-status.data.ts:17-24`, `medal-outlook.data.ts` (9 dicts), `pass-state`, `streak-outlook`, `client-history`, `coupon-occasion`, `reward-redemption.data.ts` (doc)                                                   | splits per L-1/L-2 (§2.2); `Gamification` predicates → `MetricRef`'s companion (transitional `Gamification` alias for `medal-detail.presenter.ts`, `season.entity.ts` re-pointed in package)                                                                                                                                                                                                                                                                                                                                                                                                    | W0-L |
| S-20 | `systems/streak-preview.system.ts:33-75`, `streak-publish.system.ts:56-64`, `streak.system.ts:68`/`:152-168`, `streak-rule.system.ts:106`, `loyalty-catalog.system.ts:60-112`, `voucher.system.ts:61`, `coupon-grant.system.ts` (`GrantTerms`), `standing.system.ts` (`ClosestLevel`), `programs.system.ts`; `ports/engagement.port.ts:62-70`/`:142`; NEW `entities/loyalty-catalog.ts` (with the eight `Catalog*Ref` bounds, D-7.5); `entities/coupon.entity.ts` (`OfferedCoupon`); `testing/port-doubles.ts` | `streak-standing`/`streak-preview-outcome`/`streak-preview-unavailable`/`streak-standing-counts`/`streak-preview` files; `draft-assessment.data.ts` (the union stays as system I/O); `streak-track-mark.data.ts`; errors to `engagement.error.ts`; one `LoyaltyCatalog`; `DiscountSystem.isOffered` (the coupon offer rule once — adapter, double, store); `ProgramsSystem.isEnrollmentOpenOrUpcoming`; double sorts via `UtcEpochMs.compare`                                                                                                                                                   | W0-L |
| E-24 | `voucher-code.data.ts:79-98`, `streak-publish-call.data.ts:34-275`, `errors/streak-publish.error.ts:100` guard, `pipelines/rhythm-publish.pipeline.ts:64`, `publish-streak-definition.pipeline.ts:146`                                                                                                                                                                                                                                                                                                         | DEP-18; the answered set once; guard fixed; unions homed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W0-L |
| S-21 | `systems/client-stats.system.ts:153-299`, `policy-recompute-job.system.ts:66-82`, `backfill-plan.system.ts:55-78`, `trigger-attempt.system.ts:19`, `paging.system.ts:5-34`, `zoned-time.system.ts:156` (`LocalFit`), `retention.system.ts:52-57`, `client-stats.data.ts:42-332`, `write-op.data.ts:32-39`, `policy-recompute-outcome.data.ts` (3 dicts), `pipelines/run-backfill.pipeline.ts:160`, `match-waitlist.pipeline.ts:128-137`, `ports/tx.port.ts:36`, `entities/collections.ts`                      | `subject-visit-outcome`, `cancellation-attribution`, `stats-write-decision` (+ plan), `policy-pass-verdict` (+ judgement), `backfill-phase`, `backfill-start` (+ request), `attempt-outcome`, `page-step` (with `Page`/`PageStepResult`/`PageKey`), `backfill-call-end`, `waitlist-delivery-outcome`; `LocalFit` SCREAMING; `UtcEpochMs.EPOCH`; client-stats splits (`precise-instant.data.ts` — NOT the primitives' `precise-instant.primitive.ts`, which holds `EpochSeconds`/`SubsecondNanos`; name checked), `DocPath`/`DocBody` own files; `type QueryOp`                                  | W0-O |

### 1.11 Infrastructure, the functions edge, UI libs, e2e support

| Id   | Site                                                                                                                                                                                                                                                                                                                                                                                                                                              | Target                                                                                                                                                                                                                                                                                                                            | Pkg  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| F-1  | `libs/infrastructure/firebase-app/src/lib/lazy-port.ts:105` `LazyMethodKind`, `:158-186`, `:196` `Outcome`, `:340-349`, `:431`, `:467-472`, `:477` freeze; `apps/web/src/app/app.config.ts` (67 literal sites); `lazy-port.spec.ts` (8), `lazy-port.forms.spec.ts` (7)                                                                                                                                                                            | `LazyMethod` dictionary (exported from the lib's index); `Result<P, unknown>`; no freeze                                                                                                                                                                                                                                          | W1-F |
| F-2  | `libs/infrastructure/firestore/src/lib/appointments.adapter.ts:21-28` `byStart`, `idOf`                                                                                                                                                                                                                                                                                                                                                           | `UtcEpochMs.compare` in place (no order change); `idOf: AppointmentId` — not moved to a system (no departure)                                                                                                                                                                                                                     | W1-F |
| F-3  | `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts:46-47`/`:122`/`:176-213`                                                                                                                                                                                                                                                                                                                                                       | `UtcEpochMs.compare`; the count map keyed by `AppointmentId`                                                                                                                                                                                                                                                                      | W1-F |
| F-4  | `libs/infrastructure/firestore/src/lib/coupons-vouchers.adapter.ts:72-87`                                                                                                                                                                                                                                                                                                                                                                         | `DiscountSystem.isOffered`; answers `OfferedCoupon[]`                                                                                                                                                                                                                                                                             | W1-F |
| F-5  | `apps/functions/src/edge.ts:771-890` `WorkBudget.startedMs`                                                                                                                                                                                                                                                                                                                                                                                       | `startedAtUtcMs: UtcEpochMs` (`limitMs` stays, N5); `main.ts:70`/`:329`; `edge.spec.ts:1180`                                                                                                                                                                                                                                      | W1-F |
| F-6  | `apps/functions/src/wire/triggers.wire.ts:125-151` `preciseInstantOf`, `:131` `throw new Error`; `main.ts:204-209`                                                                                                                                                                                                                                                                                                                                | a `PreciseInstant` companion member (W0-O); `defect()`                                                                                                                                                                                                                                                                            | W1-F |
| F-7  | `apps/functions/src/adapters/firestore-ports.ts:50` (`ReturnType<typeof …>` ×14)                                                                                                                                                                                                                                                                                                                                                                  | the named bundles' intersection                                                                                                                                                                                                                                                                                                   | W1-F |
| F-8  | `apps/functions/src/lib/booking/caller-roles.ts:67-94`, `adapters/firestore-jobs.adapter.ts:85`, `wire/booking.wire.ts:1024` (+ every wire file importing a moved error union), `wire/loyalty.wire.ts:84-125`                                                                                                                                                                                                                                     | `Roles.*`; `@core/errors` imports; the answered set read once                                                                                                                                                                                                                                                                     | W1-F |
| F-9  | `libs/features/shared/catalog/src/lib/content/media-url-cache.ts:173` `ReturnType<MediaResolvePorts['resolveMedia']>`                                                                                                                                                                                                                                                                                                                             | `ReturnType<ResolveMedia>` (W2-M owns the file)                                                                                                                                                                                                                                                                                   | W2-M |
| F-10 | `libs/ui/icons/src/lib/manifest/icon-manifest.ts:29-402`, `registry/icon-resolver.ts:16-124`, `registry/icon-registry.service.ts:45-299`, `icon-vocabulary.ts:636`/`:726`, `material/material.ts:31`, `logo/logo.ts:43`; `eslint.config.mjs:545-552`; `tools/lint-rules/no-generic-discriminator.mjs`(+spec); `docs/architecture/firestore-runbook.md` §4.9 gates 4/5a; `libs/ui/icons/README.md`; `docs/design-research/icon-registry-design.md` | DEP-16; `Result`; parsers answer `Result<T, UiIconIssue>` (flat `{ iconIssue, detail }`, the detail text byte-identical); the source's error a `{ detail }` struct; diagnostic codes keep kebab values (contract)                                                                                                                 | W1-U |
| F-11 | `libs/infrastructure/i18n/src/lib/translate-coded-error.ts:12-38`                                                                                                                                                                                                                                                                                                                                                                                 | `TimeErrorCode.DstGap`; `WallTime.toLocalIso`                                                                                                                                                                                                                                                                                     | W1-U |
| F-12 | `libs/ui/wall-clock/src/lib/wall-clock.ts:80-196` (`civilMs`, `formatWallClock`, `wallClockParts`, `formatWallClockParts`, `formatMinute`, `formatInstant`, `formatCents`)                                                                                                                                                                                                                                                                        | narrowed to the brands (`MinuteOfDay \| EndMinute \| null`, `UtcEpochMs`, `PriceCents`, `Currency`); `civilMs` module-private; spec `:55`, `:81-100` (`'JPY'` is no `Currency` — re-expressed or dropped on purpose), `:219`                                                                                                      | W2-U |
| F-13 | `libs/ui/controls/src/lib/month-picker/month-picker.ts:32-230` `UiDayKey`, `weekday-picker/weekday-picker.ts:14`/`:90`; `apps/showcase/src/app/pages/controls/menu/menu.page.ts`/`.html:153`/`:246`; `month-picker.spec.ts`, `date-badge.spec.ts`                                                                                                                                                                                                 | `UiDayKey = LocalDate`, `LocalDate.compare`; `Weekday`; showcase literals branded                                                                                                                                                                                                                                                 | W2-U |
| F-14 | `apps/web/e2e/support/appointment-seed-document.ts:55-90`, `seed-firestore.ts:150-179`/`:591-620`, `booking-days.ts:5-22`, `client-card-glance.spec.ts:53`, `booking-core.spec.ts:169`/`:298-305`                                                                                                                                                                                                                                                 | one support module: `SHOP_TIME_ZONE` via `ZonedTimeSystem.checkZone`, `shopToday` via `ZonedTimeSystem.shopNow`, `BusyKey.of` — same answers                                                                                                                                                                                      | W3-T |
| F-15 | `libs/features/shared/shell/src/lib/language.service.ts`, `prefs/locale-theme-toggle.component.ts:86`, `menu/site-menu.component.ts:196`, `libs/infrastructure/i18n/src/lib/provide-i18n.ts:5-9`, `apps/web/src/app/shell/app-chrome.service.ts:49`/`:68`/`:77`, `cc/client-card.format.ts:25`, `admin-rhythm-sheet.ts:270`, `admin-rhythm.ts:623`, `client-onboarding.ts:618/624/650`                                                            | `Locale` + `Tag.has`/`Tag.or`; `intlLocaleOf` replaces the two language ternaries (`site-menu.component.ts:196`, `client-onboarding.ts:650`); `app-chrome` uses `UI_THEMES`/`UI_DENSITIES` guards. NOT converted (fixed locales, D-14): `ve:5397`/`:5409`/`:5418` `'bg-BG'` photo titles, `sd:2100`/`:2347` `'en-GB'` clock faces | W3-T |
| F-16 | `libs/features/admin/loyalty/src/lib/admin-rhythm.store.ts:1326`, `cc/client-card.store.ts:1931`                                                                                                                                                                                                                                                                                                                                                  | `timedRead` in `libs/shared/view-state` (+ spec)                                                                                                                                                                                                                                                                                  | W3-T |

**The 77 transitional-import files** (computed on `cf91b43` by a scratch
scan of `import { … } from '@core/systems' | '@core/pipelines'` for every
name §2 moves — re-run it before W3-T): `apps/functions` (auth-claims
adapter, edge(.spec), project-client-stats integration spec, booking/
governance/identity/invitation wires, ops and triggers wire specs);
`apps/web/src/app/guards/{access,active,anon,home,roles}.guard.ts`
(`access.ts`); admin loyalty (preview(+spec), store(+spec), words(+spec));
client account, appointments, auth, booking (store, services step),
onboarding (component, flow store); shell `session-identity.service.spec.ts`;
shared visits (rhythm-closed-mark words(+spec), testing fixtures,
visit-card presenter/spec/vm, visit-filter-menu spec, visit-filter,
visit-list spec, visit-row presenter(+spec)/vm(+spec)/spec, visit-sections,
visits-browser spec); client card (achievement-detail, store(+spec),
words, client-history(+spec), pages vm spec, glance, history, medal-detail
spec, visits-page presenter(+spec), wallet presenter, vm fixtures); staff
dashboard (block-repeat(+spec), block editor, dashboard, tag-words(+spec),
time grid(+spec), timeline spec, client-query spec, visit editor(+spec));
infrastructure firestore (appointments, client-stats, loyalty adapters);
i18n (`visit-list-words(+spec)`). Each wave-1/2 package re-points the ones
it owns; W3-T the rest.

---

## 2. Contracts (wave 0 builds the ecs-core half; waves 1–2 build against them)

A field rename happens only where Law 5/6 naming requires it (a `*UtcMs`,
`*Cents` suffix, a domain-prefixed discriminator) and is listed here.
Everything else keeps its NAME and changes only its TYPE.

### 2.1 Primitives (W0-P)

```ts
// minute-of-day.primitive.ts
export type TrackMinute = MinuteOfDay | EndMinute | Brand<number, 'TrackMinute'>;
MinuteOfDay.parseClock(raw: string): Result<MinuteOfDay, PrimitiveError>;   // trims, then strict ^(\d{1,2}):(\d{2})$
TrackMinute.of(raw: number): Result<TrackMinute, PrimitiveError>;    // non-negative safe integer
TrackMinute.ofProven(raw: number): TrackMinute;                      // defect otherwise
TrackMinute.plus(t: TrackMinute, d: MinuteCount | DurationMinutes): TrackMinute;
TrackMinute.span(from: TrackMinute, to: TrackMinute): MinuteCount;   // max(0, to − from)
TrackMinute.toStart(t: TrackMinute): Result<MinuteOfDay, PrimitiveError>;
TrackMinute.toEnd(t: TrackMinute): Result<EndMinute, PrimitiveError>;
// libs/ui/wall-clock/src/lib/wall-clock.ts (W0-P adds it beside formatMinute — formatting is the UI's, Law 5)
export const ClockClosing = { Wrap: 'WRAP', EndOfDay: 'END_OF_DAY' } as const;
export type ClockClosing = (typeof ClockClosing)[keyof typeof ClockClosing];
export function formatClock(t: TrackMinute, closing: ClockClosing): string;   // 'HH:MM'
// WRAP: (t mod 1440) as HH:MM — the editors (`ve:1155` wraps %1440), the block editor (`be:246` %24h), the grid (`gg:85/96`, `tg:631`)
// END_OF_DAY: 1440 → '24:00', else HH:MM — the waitlisted step (`booking-waitlisted-step.ts:94`), the landing (`locations.component.ts:121`)
// utc-epoch-ms.primitive.ts
UtcEpochMs.EPOCH: UtcEpochMs;                                         // 0
// duration-minutes.primitive.ts
MinuteDelta.fromDuration(d: DurationMinutes): MinuteDelta;
MinuteDelta.negate(d: MinuteDelta): MinuteDelta;
MinuteDelta.between(a: MinuteOfDay | EndMinute, b: MinuteOfDay | EndMinute): MinuteDelta;   // widened (was MinuteOfDay only)
// ids.primitive.ts
export type DraftPersonKey = Brand<string, 'DraftPersonKey'>;
DraftPersonKey.PLACEHOLDER: DraftPersonKey;                           // 'primary'
DraftPersonKey.account(id: UserId): DraftPersonKey;                   // the uid, as is
DraftPersonKey.guest(label: string): DraftPersonKey;                  // 'guest-<label>' (sd:3505)
DraftPersonKey.minted(base36: string, n: number): DraftPersonKey;     // 'guest-<base36>-<n>' (ve:4454)
DraftPersonKey.of(raw: string): DraftPersonKey;                       // by construction
DraftPersonKey.accountOf(key: DraftPersonKey): UserId | null;         // = VisitDraftSystem.accountKeyOf's body
// tag.data.ts (NEW)
export type Tag<D extends Readonly<Record<string, string | number>>> = D[keyof D];
Tag.values<D>(d: D): readonly Tag<D>[];
Tag.has<D>(d: D, raw: unknown): raw is Tag<D>;
Tag.or<D>(d: D, raw: unknown, fallback: Tag<D>): Tag<D>;
```

`@core/testing` gains `trackMinute(raw)` (beside `minute`/`endMinute`) and
`draftPersonKey(raw)`. Transitional: `isBookingStatus` and
`LOCALES`/`isLocale` stay as `@deprecated` delegates of `Tag` until W3-T.

### 2.2 Component splits (wave 0) — new files, names kept

Every new file gets its `components/index.ts` (or `entities/index.ts`,
`systems/index.ts`) `export *` line — written by **W0-P** with a placeholder
file, never by the package that fills it (D-12.1); the barrel-contents check
of `verify-tools:layering` must list it. Value edges between split siblings use `./sibling` and prefer
`import type` (a value cycle fails layering).

| Old file → new files (name kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pkg  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `role.data.ts` → + `roles.data.ts` (`Roles`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | W0-I |
| `registration.data.ts` → + `registration-fields.data.ts` (`RegistrationFields`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | W0-I |
| `auth-strategy.data.ts` → + `auth-provider.data.ts` (`AuthProvider`, `AuthProviderKind`, `OAuthProvider`), `auth-deployment.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | W0-I |
| `auth-flow.data.ts` → + `auth-flow-event.data.ts`; `onboarding-flow.data.ts` → + `onboarding-flow-event.data.ts`; `identifier.data.ts` → + `parsed-identifier.data.ts` (`ReadPhone` into its namespace if internal, else own file); `impersonation-status.data.ts` → + `end-reason-fields.data.ts`; `phone-number.data.ts` → + `e164.data.ts`; `audit-context.data.ts` → + `audit-target-ref.data.ts`, + `placement-action`/`transition-action`/`arrival-action`/`tip-action`/`staff-edit-action`/`profile-action.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W0-I |
| `booking-flow.data.ts` → + `shop-reach.data.ts`, `schedule-selection.data.ts`, `seat-assignment.data.ts`, `booking-confirmation.data.ts`, `waitlisted-summary.data.ts`; `MoveRefusal*` OUT to errors; `cart-line.data.ts` keeps `CartLine` (its own name) → + `seat-key.data.ts` (`SeatKey`, `SeatKeyRole`), `booking-cart.data.ts`, `cart-seat-lines.data.ts`; `party.data.ts` → + `party-member.data.ts`; `service-terms.data.ts` → + `service-variant.data.ts`, `service-terms-input.data.ts` (`ServiceTermsInput` — landing test catalogue reads it), `ServiceVariantInput` → `ServiceVariant.Input`; `barber-offering.data.ts` → + `variant-terms.data.ts` (seed reads it), inputs → namespace; `placement-policy.data.ts` → + `staff-terms-override.data.ts`; `opening-hours.data.ts` → + `shop-opening.data.ts` (if `ShopOpening`/`OpeningState` type no `DayHours` field), `day-hours-input.data.ts`, `DayHours.CLOSES_SOON_MINUTES`; `roster-window.data.ts` → + `shop-day-hours.data.ts`; `schedule-version.data.ts` → + `shift-segment.data.ts`; `recurrence-rule.data.ts` → + `recurrence-pattern.data.ts`, `recurrence-end-rule.data.ts`; `program-input.data.ts` → + `position-input`/`course-input`/`shop-event-input.data.ts`; `catalog-status.data.ts` → one file per dictionary | W0-B |
| `seat.data.ts` → + `seat-occupant.data.ts` (`SeatSubject`, `SubjectRelationship`, `SeatOccupant`, `AccountRef`, `AccountOccupant` — own files where consumed outside), `chair-geometry`/`seat-catalog-terms`/`seat-core`/`account-seat.data.ts`; `seat-outcome.data.ts` → + `cancellation-reason-set.data.ts`; `seat-id-pair.data.ts` → + `stood-seat-pairs.data.ts`; `staff-verb.data.ts` → `arrival-verb.data.ts`, `mark-arrival-action.data.ts`, `staff-verb.data.ts` (type + companion)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | W0-S |
| `gamification.data.ts` → + `metric-ref.data.ts`, `award-summary.data.ts`, `badge-subject-slot.data.ts`, `season-window.data.ts`; `streak-rule.data.ts` → + `streak-rule-input`/`scheduled-streak-rule`/`streak-head-rule.data.ts`, lists → `StreakRule.EXCUSES`/`SHOP_EXCUSES`/`PARAMETER_ORDER`, `isStreakExcuse` → `StreakRule.isExcuse`; `streak-state.data.ts` → + `streak-phase-state.data.ts`, `streak-period-reason`/`streak-period-fact`/`streak-period-terms.data.ts`; `tier-state.data.ts` → root `TierState`, + `tier-override.data.ts`, `tier-standing.data.ts`; `standing.data.ts` → + `family-scope-filter.data.ts` (`ClosestLevel` → `standing.system.ts`); `journal-effect.data.ts` → + `journal-feed`/`reward-ref-fields`/`grant-ref-fields`/`public-label`/`label-param.data.ts`; `journal-source.data.ts` `RuleRef` → own file (sibling reader); `grant-lifecycle.data.ts` → + `grant-capacity-terms`/`grant-expiry-terms.data.ts`, `GrantTerms` → `GrantLifecycle.Terms`; `badge-level.data.ts` → + `earned-level`/`series-standing.data.ts`; `medal-outlook`, `pass-state`, `streak-outlook`, `client-history`, `coupon-occasion` → one file per dictionary                                                                                                                  | W0-L |
| `money.data.ts` → + `rounding-mode.data.ts` (`RoundingMode` types only `Money.scale`'s `mode` PARAMETER, `:146`/`:190`, not a `Money` field — L-1; readers `foundation-dictionaries.type-spec.ts` (home comment) and `money.data.spec.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W0-O |
| `streak-qualifier.data.ts` → + `qualifier-comparison.data.ts` (`QualifierComparison` is only `StreakQualifierRule.compare`'s answer, `:136`; reader `streak-rule.system.ts:7/152`); its private `STREAK_QUALIFIERS = Object.values(StreakQualifier)` hand list (`:35`, read `:126`) → `Tag.values(StreakQualifier)` (same order: key order). `streak-interval.data.ts` → + `streak-interval-source.data.ts` (`StreakIntervalSource` types `StreakIntervalRule.Period.source`, a namespace helper `:288`, and is read by `streak-state.data.ts:7/128/152`, `streak.system.ts:443`, `streak-rule.system.ts:93`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | W0-L |
| `client-stats.data.ts` → + `precise-instant.data.ts`, `last-visit`/`next-visit`/`pause-suggestion`/`client-money-stats`/`policy-pass`/`policy-pass-stamp.data.ts`, `live-policy-line`/`visit-fact`/`visit-leg`/`client-stats-key`/`client-stats-meta.data.ts`; `write-op.data.ts` → + `doc-path.data.ts`, `doc-body.data.ts`; `policy-recompute-outcome.data.ts` → one file per dictionary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W0-O |

The `*-dictionaries.type-spec.ts` headers and their per-line home comments
(`// systems/…` → `// components/…`) are updated by the package that moves
the name; `tools/lint-rules/dictionary-fields.spec.mjs` reads every pair
line — the lines stay intact.

### 2.3 Staff day store (W1-S1, read by W1-S3 and W1-S2)

```ts
interface BarberDayLane {           // st:731-759
  readonly barberId: BarberId;      // was string
  readonly rostered: readonly MinuteRange[];   // was LaneSpan[]
  readonly blocks: readonly MinuteRange[];     // was LaneSpan[]
  readonly gaps: readonly LaneGap[];           // @core/systems GridLayoutSystem's (startMinutes, endMinutes, minutes: MinuteCount, sellable)
  // … appointments, failed: unchanged
}
interface StaffDayCell { readonly dayKey: LocalDate; readonly lanes: readonly BarberDayLane[] }
StaffDayStore.nowUtcMs: Signal<UtcEpochMs>;             // was nowMs: number (renamed by G for §5 item 2(c); the fresh read is the private readNow())
StaffDayStore.shopNow: Signal<ShopNow | null>;          // unchanged
StaffDayStore.zoneAt: Signal<(locationId: LocationId | null) => TimeZone | null>;     // NEW: today's sd:1466 zoneOfShop rule (the catalogue shop's timeZone, else store.zone()), moved into the store
StaffDayStore.shopNowAt: Signal<(locationId: LocationId | null) => ShopNow | null>;   // NEW (D-6.2): one ShopNow per zone per tick over zoneAt; null when neither zone is known
StaffDayStore.todayKey: Signal<LocalDate | null>;       // was string with ''
StaffDayStore.dayKey: Signal<LocalDate | null>;         // was string
StaffDayStore.visibleDays: Signal<readonly LocalDate[]>;
StaffDayStore.goToDay(day: LocalDate | null): void;     // the ROUTE edge parses: applyRouteDay(raw: string | null)
StaffDayStore.applyRouteDay(raw: string | null): void;  // LocalDate.parse; refusal → today, unchosen (DEP-13)
StaffDayStore.applyRouteBarber(raw: string | null): void; // BarberId.parse; refusal → null scope (DEP-14)
StaffDayStore.scope: Signal<BarberId | null>;
StaffDayStore.setScope(id: BarberId | null): void;
StaffDayStore.probeDay(raw: string | null): void;       // LocalDate.parse (same rule)
StaffDayStore.view: Signal<StaffView>;                  // the contract-spelled dictionary
StaffDayStore.absenceError: Signal<StaffBlockFailure | null>;   // named in errors/scheduling.error.ts: the block pipelines' error unions as they answer | CatalogError.LocationZoneUnknown (zone unknown, st:2150) | PrimitiveError (only if blockTime's empty-id guard survives, D-9.4)
StaffDayStore.saveTeamNote(id: AppointmentId, text: string | null): Promise<boolean>;  // through the NEW pipeline
// every per-visit API takes AppointmentId / CustomerId / BarberId / LocationId / OperationId
```

Deleted public names: `LaneSpan`, the store's `LaneGap`, `laneGaps`,
`occupiedIntervals`, `wallClockInstant`, `addDays`, `startOfWeek`,
`noteError`. `parseView` stays exported and nullable (G-1).

### 2.4 Visit editor contracts (declared in `ve`, built by W1-S3 and the editor)

```ts
interface VisitEditorVm {
  readonly appointmentId: AppointmentId | null;  // null = creating (every '' rule becomes a null rule: isNew, cardContextOf, lastWorkedVisit, reseed, the draft key, rebook truthiness)
  readonly rowId: string;                        // opaque row key (unchanged)
  readonly clientUserId: UserId | null;
  readonly clientCustomerId: CustomerId | null;  // REQUIRED (was optional)
  readonly locationId: LocationId | null;
  readonly chairId: BarberId | null;             // was '' fallback
  readonly dayKey: LocalDate;                    // still the STORE's shown day (sd:4073) — branding does not "fix" it
  readonly now: ShopNow | null;                  // replaces nowMinute + todayKey (todayKey = now?.localDate ?? null)
  readonly arrivedMinute: MinuteOfDay | null;
  readonly startMinute: TrackMinute;  readonly endMinute: TrackMinute;
  readonly priceCents: PriceCents | null;  readonly currency: Currency;
  readonly photos: readonly VisitEditorPhoto[];
  readonly neighbours: readonly { startMinute: TrackMinute; endMinute: TrackMinute; … }[];
  // … other fields unchanged
}
interface VisitEditorFrameDay { readonly nowMinute: MinuteOfDay | null; … }   // the grid input
interface VisitEditorLeg {
  readonly seatId: SeatId; readonly serviceId: ServiceId; readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId | null;          // was '' sentinel
  readonly clientId?: DraftPersonKey;
  readonly minutes: DurationMinutes; readonly catalogMinutes: DurationMinutes;
  readonly priceCents: PriceCents | null; readonly currency: Currency;   // NEW — the label is printed from it
  readonly priceLabel: string | null;                                   // display only, never parsed back
}
type VisitEditorCommit = StaffEditDraft;        // @core/components (§2.12)
interface VisitEditorClientOption { readonly id: DraftPersonKey; readonly email: Email | null; … }   // email REQUIRED
interface VisitEditorPhoto { readonly photoId: AppointmentPhotoId; readonly takenAtUtcMs: UtcEpochMs; readonly barberId: BarberId; … }
interface VisitEditorVoucher { readonly voucherId: GiftVoucherId; readonly code: VoucherCode; readonly availableCents: PriceCents }   // renamed from availableMinorUnits
type VisitEditorDiscount = StaffEditDraft.Discount;   // DiscountProvenance & CouponValue & { label; grantId: CouponGrantId | null; code: VoucherCode | null; exclusive } — the pass-C D-11 reshape
interface VisitEditorGrantOption { readonly grantId: CouponGrantId; readonly couponId: CouponId; readonly expiresOn: LocalDate | null; … }
interface VisitEditorPromoOption { readonly code: VoucherCode; readonly couponId: CouponId; … }
interface VisitEditorServiceOption { readonly id: string /* opaque option key */; readonly serviceId: ServiceId; readonly variantId: ServiceVariantId | null; readonly minutes: DurationMinutes; readonly priceCents: PriceCents | null; readonly currency: Currency; … }
interface VisitEditorBarberOption { readonly id: BarberId; … }  interface VisitEditorShopOption { readonly id: LocationId; … }
// inputs/outputs
uiOwnerUserId: input<UserId | null>;  uiViewer: input<ClientCardViewer | null>;   // { userId: UserId; roles: readonly Role[] }
photoRemoved: output<AppointmentPhotoId>;  chairChanged: output<BarberId>;  dayChanged: output<LocalDate>;  peerPicked: output<string>;
interface BlockEditorVm { readonly blockId: ScheduleExceptionId | null; readonly barberIds: readonly BarberId[]; readonly dayKey: LocalDate; readonly now: ShopNow | null; … }
interface BlockEditorCommit { readonly barberIds: readonly BarberId[]; readonly dayKey: LocalDate; readonly days: readonly LocalDate[]; … }
```

Producers (W1-S3): `visitEditorVm` (`sd:4000-4130`), the create VM
(`:5420-5480`), `toEditorPhoto` (`:5105-5120`), `discountsOf`/`vouchersOf`
(`:6720-6745`), `blockEditorVm` (`:6073-6110`), `cardViewer`. Consumers
(W1-S2, W1-S1 for the block editor): every reader listed in §1.3/§1.4.

### 2.5 Dashboard VMs and grid inputs (W1-S3 ↔ W1-S1)

```ts
interface DayRowVm {
  readonly id: string;  /* row key */  readonly appointmentId: AppointmentId; readonly locationId: LocationId;
  readonly seatId: SeatId | null; readonly seatIds: readonly SeatId[];
  readonly ownerUserId: UserId | null; readonly ownerCustomerId: CustomerId | null; readonly email: Email | null;
  readonly localDate: LocalDate; readonly startMinute: MinuteOfDay; readonly endMinute: EndMinute;
  readonly startUtcMs: UtcEpochMs; readonly endUtcMs: UtcEpochMs;   // the countdown only (D-6.4/5); startMs/endMs/durationMinutes DELETED
  readonly arrivedAtUtcMs: UtcEpochMs | null;                       // was arrivedMs
  readonly priceCents: PriceCents | null; readonly currency: Currency;
  readonly legs: readonly { …; priceCents: PriceCents | null; currency: Currency }[];
  // past, live, isNext, terminal … unchanged booleans
}
interface AgendaGroupVm { readonly key: string /* String(startMinutes) */; readonly startMinutes: MinuteOfDay; readonly past: boolean; … }
interface GapRowVm { readonly id: string; readonly startMinutes: MinuteOfDay; readonly minutes: MinuteCount; … }
interface SearchHitVm { readonly id: AppointmentId; readonly dayKey: LocalDate; /* whenMs DELETED */ … }
GridEvent { startMinute: TrackMinute; endMinute: TrackMinute; … }  OpenWindow/GridWindow/GridDraft minutes: TrackMinute
StaffTimeGrid.nowMinute / StaffTimeline.nowMinute: input<MinuteOfDay | null>
StaffTimeGrid.dayPicked: output<LocalDate>
PlacementVerdictSlice Short arm { minutes: DurationMinutes }
```

### 2.6 Client card ↔ editor ↔ shared visits (W2-CK)

```ts
interface ClientCardSubject { readonly id: DraftPersonKey; readonly userId: UserId | null; … }
interface ClientCardContext {
  readonly appointmentId: AppointmentId | null; readonly locationId: LocationId | null;
  readonly viewer: ClientCardViewer | null;            // null reads as no roles (same answers)
  readonly start: { readonly localDate: LocalDate; readonly startMinutes: MinuteOfDay | null } | null;   // REPLACES every leg's startsAtIso
  readonly legs: readonly ClientCardLeg[];
  readonly catalog: ClientCardCatalog; …
}
interface ClientCardLeg { readonly serviceId: ServiceId; readonly variantId: ServiceVariantId | null; readonly barberId: BarberId | null; readonly minutes: DurationMinutes }   // startsAtIso DELETED
interface ClientCardGrant { readonly grantId: CouponGrantId; readonly expiresOn: LocalDate | null; … }
interface ClientCardCatalog extends VisitLookup {     // sv/visit-lookup.contracts.ts
  serviceCategory(serviceId: ServiceId): { id: ServiceCategoryId; name: string } | null;
  barberIds?(): readonly BarberId[]; readonly locationCount: number;   /* a plain number, no getter */ …
}
interface VisitLookup { serviceName(id: ServiceId): …; barberName(id: BarberId): …; barberAvatarSrc(id: BarberId): …; locationName(id: LocationId): …; locationTimeZone?(id: LocationId): …; readonly locationCount: number }
type AchievementScope = { categoryId: BadgeCategoryId } | { seasonId: SeasonId } | { archive: true } | { day: LocalDate };   // field names unchanged; types branded
ClientCardStore.barTitle(page: ClientCardPage, subjectId: string | null): string;
type VisitRowVm = VisitRowVm.Visit | VisitRowVm.Waitlist;   // id: AppointmentId on Visit, WaitlistRequestId on Waitlist (discriminated by visitRowEntry, the field that exists)
type VisitCardVm = … ;  // id branded by visitCardSlot the same way
interface VisitRowOptions { readonly subjectUserId: UserId | null; readonly subjectCustomerId: CustomerId | null; readonly currentAppointmentId: AppointmentId | null; … }
interface WaitlistRowOptions { readonly today: LocalDate; … }
dayRange(from: LocalDate, until: LocalDate, today: LocalDate | null, …): …
```

The card derives an instant only where it needs one, from `context.start`
with `ZonedTimeSystem.toUtc` — a refusal (a gap minute, `startMinutes`
null) is SKIPPED exactly as today's `''`/`parseIsoIn` failure is skipped,
except where DEP-15 says the answer changes (the card now reads the wall
clock directly: `ClientGlanceSystem.isInChairToday` already takes
`WallTime[]`, so `isInChairToday` and the achievements `draftVisitOf`
read `WallTime` and never convert). `startMinutes` is `MinuteOfDay | null`
because the draft's track start may be 1440 (`TrackMinute.toStart`
refuses → `null`, today's `''`). `shopIsoOf` (`ve:7336`) is deleted;
`ZonedTimeSystem.parseIsoIn`/`toIso` keep their e2e/spec callers (OQ-4).

### 2.7 Catalogue VM money and ids (W2-M)

```ts
interface ServiceTermsVm { readonly priceCents: PriceCents; readonly currency: Currency; readonly minutes: DurationMinutes }   // was { price: number (MAJOR units); minutes: number }
ServiceVm.priceFromCents: PriceCents;  cardPrice.cheapestCents: PriceCents;  minutesRange: OfferingRange<DurationMinutes>;
BarberVm.id: BarberId;  ServiceOfferingVm.barberId: BarberId;  ServiceVariantVm.id: ServiceVariantId;  ServiceSourceVm.id: ServiceId;  includes: readonly ServiceId[];
CatalogWording.price(money: Money): string;   // formatCents(amountCents, currency, locale) — price(major)/priceCents/formatPrice/formatPriceCents/toMajor DELETED
CatalogContentService.findService(id: ServiceId); coverUrl(id: ServiceId);
```

The landing's authored shelf (`testing/landing-catalog.ts`) keeps a raw
"authored" input type of its own and builds the branded VM through the
providers (`test-catalog.providers.ts`), so its 16 literals stay literals;
its `t(price, minutes)` major-unit prices become cents values (`14.5` →
`1450`) — a fixture VALUE edit forced by the type (§4.2), no rendered
change for EUR.

### 2.8 New component dictionaries and their values

Moved (values unchanged): the visit family (`VisitGrain`, `VisitRowOutcome`,
`VisitFilter`, `VisitPerspective`), `CancelledSide`, `BillPending`,
`TipPreset`, `LedgerVerdict`, `ProfileAuthType`, `BackfillPhase`,
`BackfillStart`, `PrefillCompanions`, `ClientQueryShape`,
`SubjectVisitOutcome`, `CancellationAttribution`, `StatsWriteDecision`,
`GridEvent`, `SettledVerdict`, `PageStep`, `PolicyPassVerdict`,
`ProfileCompletionKey`, `Selectability`, `StreakStanding`,
`StreakPreviewOutcome`, `StreakPreviewUnavailable`, `DraftAssessment`,
`StreakTrackMarkKind`, `AttemptOutcome`, `RepeatPreset`,
`SessionReadiness`, `RouteGate`, `AccessTarget`, `AccessVerdict`,
`BookingFlowEventKind`, `MoveOutcome`. Renamed on moving:
`EditOutcome` → `EditCallOutcome` (field `editCallOutcome`),
`RequestOutcome` → `WaitlistDeliveryOutcome` (field `waitlistDeliveryOutcome`),
`CallEnd` → `BackfillCallEnd` (field `backfillCallEnd`). NEW:

| Dictionary                  | Values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Field                                      | Home                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------- |
| `BookingReadSnapshot`       | `REPLAY`, `REFUSED`, `LOADED`, `UNCHANGED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `bookingReadSnapshot`                      | `components/booking-read-snapshot.data.ts`            |
| `VisitEditWriteOutcome`     | `STALE`, `BATCH_REFUSED`, `WRITTEN`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `visitEditWriteOutcome` (+ `sidesWritten`) | `components/visit-edit-write-outcome.data.ts`         |
| `ClockClosing`              | `WRAP`, `END_OF_DAY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | parameter                                  | `libs/ui/wall-clock` (D-5/D-11; as built — §9.1 W0-P) |
| `UiIconAsset`               | `VECTOR`, `MATERIAL`, `IMAGE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `iconAsset`                                | `libs/ui/icons` (DEP-16)                              |
| `LazyMethod`                | `OBSERVABLE`, `PROMISE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | binding value                              | `libs/infrastructure/firebase-app`                    |
| `StaffView`                 | `agenda`, `day`, `three-day`, `week` (contract)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `view`                                     | `st`                                                  |
| UI internal (SCREAMING)     | `DiscardTarget` `VISIT`/`CREATE`; `DayPicker` `VIEW`/`SCOPE`; `DaySurface` `DATE`/`PICKER`/`ROW`; `SearchField` `CLIENT`/`SERVICE`/`PHONE`/`EMAIL`/`NOTE`; `DiscountKind` `PROMO`/`COUPON`/`PERCENT`/`AMOUNT`; `DiscountCodeState` `IDLE`/`CHECKING`/`UNKNOWN`/`ALREADY`/`NOTHING_LEFT` (∪ `VoucherRefusal`; no value collision); `TimingMode` `DURATION`/`END`; `PhotoDoor` `CAMERA`/`UPLOAD`/`SYSTEM`; `PageArrival` `CONTAINER`/`SECTION`; `ProgramsTab`; `EventsTab`; `AppointmentsView`; `ScrollSide`; the rhythm choice dictionaries; `ClientCardPage`; `LocalFit` | as named                                   | the owning feature file (one per family)              |
| UI contract (spelling kept) | `ShopView` `map`/`list`; `TipTile` `none`/`other` + `TIP_AMOUNT_PREFIX = 'amt:'`; `VisitExitId` `reinstate`/`no-show`/`rebook`/`cancel`/`cancel-block`; `ResolutionWord` `cancelledByStaff`/`cancelledByClient`/`noShow`; `ClientCardRegion`; `WalletAnchor`; the `client-pages.vm.ts` id/tone families; `RhythmConfirmation`; `AdminRhythmSheet`; `RhythmPreviewMetric`; `AgendaField`; `VisitEditorClientSectionId` `recent`; `OnboardingPhase` `personalize`; `HttpsStatus` (errors tier, the Firebase spellings, `wireStatus: HttpsStatus \| null`)                  | as named                                   | as named                                              |

### 2.9 Errors moved or added (wave 0)

| Name                                                                                                                                                                 | New home                         | Shape change                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MoveRefusalReason` → three members of the EXISTING `MoveErrorCode` (`BOOKING_RESCHEDULE_COMPANIONS_ONLY` / `_UNAVAILABLE` / `_CARRIED_OUT_OF_REACH`), `MoveRefusal` | `errors/move.error.ts`           | `{ errorCode; locationId: LocationId \| null }` (was `moveRefusalReason`); a member union of the move error family                                                                                                                                                                                                                                                        |
| `MoveError`                                                                                                                                                          | `errors/move.error.ts`           | none                                                                                                                                                                                                                                                                                                                                                                      |
| `ServiceTermsError` → `CatalogError.Terms`                                                                                                                           | `errors/catalog.error.ts`        | none                                                                                                                                                                                                                                                                                                                                                                      |
| `BookingFlowFailure` → `BookingFlowError.Failure`; `reasonCode: SchedulingErrorCode`                                                                                 | `errors/booking-flow.error.ts`   | type narrowing only                                                                                                                                                                                                                                                                                                                                                       |
| `BookAppointmentError`, `RescheduleAppointmentError`, `CancelAppointmentError`, `TransitionAppointmentError`, `MarkArrivalError`, `RecordSeatTipError`               | `errors/booking.error.ts`        | none                                                                                                                                                                                                                                                                                                                                                                      |
| `EditAppointmentError`, `StaffEditGuardRefusal`                                                                                                                      | `errors/staff-edit.error.ts`     | none                                                                                                                                                                                                                                                                                                                                                                      |
| `AttachVisitPhotoError`                                                                                                                                              | `errors/media.error.ts`          | none                                                                                                                                                                                                                                                                                                                                                                      |
| `VerifyOtpError`, `RequestOtpError`, `CompleteRegistrationError`, `AuthFailure`, `OnboardingFailure`                                                                 | `errors/identity.error.ts`       | new names for the flow states' unions                                                                                                                                                                                                                                                                                                                                     |
| `UpdateProfileError`, `AccountsError.OwnProfileSave`                                                                                                                 | `errors/accounts.error.ts`       | declared by W0-I; `saveOwnProfile` answers `Result` from W1-A (wave 1, D-12.7)                                                                                                                                                                                                                                                                                            |
| `RedeemInvitationError`, `StartImpersonationError`, `EndImpersonationError`                                                                                          | `errors/governance.error.ts`     | none                                                                                                                                                                                                                                                                                                                                                                      |
| `VoucherBalanceError`, `StreakScheduleError`, `LoyaltyCatalogError`, `ENGAGEMENT_VOUCHER_CODE_DUPLICATE`                                                             | `errors/engagement.error.ts`     | + one code (DEP-18)                                                                                                                                                                                                                                                                                                                                                       |
| `PublishStreakDefinitionError`, `RhythmPublishRefusal`, `StreakPublishAnsweredCode`, `StreakPublishError.Answered`, `StreakPublishError.Failure`, the answered list  | `errors/streak-publish.error.ts` | the guard narrows to its own list                                                                                                                                                                                                                                                                                                                                         |
| `StaffBlockFailure` (the store's absence error)                                                                                                                      | `errors/scheduling.error.ts`     | a named union: the block pipelines' (`writeScheduleBlocks`, `clearScheduleBlock`) error unions as they answer, `CatalogError.LocationZoneUnknown` for the zone-unknown refusal (existing code, `catalog.error.ts:82`), and `PrimitiveError` only if the empty-id guard survives (D-9.4). No day refusal: the bad-day branches are deleted as unrepresentable. No new code |
| `HttpsStatus`                                                                                                                                                        | `errors/pipeline.error.ts`       | `wireStatus: HttpsStatus \| null`, parsed once in `bareStatus` (`:329`)                                                                                                                                                                                                                                                                                                   |

Every new `*ErrorCode`/`*RefusalCode` dictionary gets its `EDGE_DICTIONARIES`
entry and an `EDGE_WIRE` row per code in `apps/functions/src/edge.ts`
(W0-O, X-4; three inert client-only rows in the existing `MOVE_WIRE` table for the folded `MoveErrorCode` refusals, the
`BOOKING_FLOW_WIRE` precedent) — `edge.spec.ts`'s totality scan stays green.

### 2.10 Booking edges (W1-B)

`client-booking.ts` parses `?repeat`/`?reschedule`/`?waitlist`/`?day` once
(D-4 table) and hands brands on: `landRepeat(id: AppointmentId)`,
`landReschedule(id: AppointmentId)`, `landWaitlistDeepLink(id:
WaitlistRequestId)`, `restoreFromWaitlist(request, day: LocalDate | null |
undefined, …)`. `?reschedule=` refused → `store.expectMove(raw)` is still
called with the raw text (the commit stays blocked on `_moveAsked !== null`)
and `refuseMove(MoveRefusal.unavailable(null))` — the store keeps
`_moveAsked: string | null` as the one raw-text twin, documented as the
refusal path's latch. `rescheduleFrom(): Result<void, MoveRefusal>` and
`refuseMove(refusal: MoveRefusal)` are already in place from W0-B (D-12.7);
W1-B's edge calls build the struct with the factories
(`MoveRefusal.unavailable(null)`).

### 2.11 Identity errors and the flow states (W0-I declares the unions; W1-A retypes the flow states end to end in wave 1 — D-12.7)

W0-I (wave 0) splits the flow files with their shapes UNCHANGED and adds,
additively, `AuthFailure`, `OnboardingFailure`, `AccountsError.OwnProfileSave`
and `IdentityError.birthDatePartial()` to the errors tier. W1-A (wave 1)
retypes the states/events below, the two systems' pass-through lines
(`auth-flow.system.ts:47/53`, `onboarding-flow.system.ts:118/157`),
`saveOwnProfile`'s answer, and every consumer, in one package.

```ts
AuthFlowState.Identify.error / Otp.error: AuthFailure | null;   // IdentityError | PipelineError
AuthFlowEvent.RequestFailed / VerifyFailed: { …; error: AuthFailure; blocked: boolean };   // message → error
OnboardingFlowState.About.error / Birthday.error: OnboardingFailure | null;   // IdentityError | AccountsError.OwnProfileSave | PipelineError
OnboardingFlowEvent.RegistrationFailed / BirthdayFailed: { …; error: OnboardingFailure };
```

The worded line keeps today's rule: a `PipelineError` words as
`{ errorCode: serverErrorCode ?? IDENTITY_CALL_FAILED }` (ONE helper,
`wordFlowFailure`, shared by auth and onboarding — no `serverParams`
change, so no departure). The onboarding `'partial'` birthday state becomes
`IdentityError.birthDatePartial()` — a NEW param-free factory over the
existing `IDENTITY_BIRTH_DATE_INVALID` code (its catalogue line has the
`{{attempted}}` placeholder; the factory sets `attempted: ''`, which is
exactly what today's param-less struct prints — W1-A pins the bg/en words
byte-identical in `client-onboarding.spec.ts`, else it is a DEP).

### 2.12 The staff edit plan (W0-S; wired by W1-S3, built by W1-S2)

```ts
// components/staff-edit-draft.data.ts — the editor's commit, field names kept.
// EVERY property REQUIRED, absent is `null` (ecs-syntax.mjs DATA_OPTIONAL_GUARD,
// `TSPropertySignature[optional=true]` is banned in components/entities/systems/ports).
// Imports only primitives, errors and sibling components (Law 8): VisitSides moves to
// components (below).
export type StaffEditDraft = {
  readonly revision: number | null;                  // was `revision?: number | null`
  readonly dayKey: LocalDate;
  readonly startMinute: TrackMinute; readonly endMinute: TrackMinute;
  readonly locationId: LocationId | null;
  readonly legs: readonly StaffEditDraft.Leg[];   // { seatId: SeatId; serviceId: ServiceId; variantId: ServiceVariantId | null; minutes: DurationMinutes; priceCents: PriceCents | null; currency: Currency; typedPriceCents: PriceCents | null /* was `priceCents?: number | null` */; barberId: BarberId; clientId: DraftPersonKey }
  readonly note: string | null;
  readonly discounts: readonly StaffEditDraft.Discount[];
  readonly vouchers: readonly StaffEditDraft.Voucher[];   // { voucherId: GiftVoucherId; code: VoucherCode; availableCents: PriceCents }
  readonly tipCents: PriceCents | null;
  readonly drawn: VisitSides | null;                 // was `drawn?: VisitSides`
  readonly clients: readonly { id: DraftPersonKey; label: string; phone: string | null }[];
};
// components/visit-sides.data.ts (NEW, W0-S) — `VisitSides` moved from systems/visit-sides.system.ts:4
// (a component may not import the systems tier); `DrawnSides`/`SideWrites` move with it only if the
// draft or StaffEditPlanSystem names them (W0-S records which). visit-sides.system.ts keeps a
// `@deprecated pass D transitional` type re-export for its feature importers
// (staff-day.store.ts, staff-visit-editor.ts, staff-dashboard.ts) until W3-T.
// systems/staff-edit-plan.system.ts — system I/O, every property required
export type StaffEditRowFacts = {                    // exactly the row fields commandsFor/tipSeat read today (D-10.1)
  readonly appointmentId: AppointmentId;
  readonly locationId: LocationId;
  readonly clientLabel: string;                      // a display word the row already carries (the walk-in/contact label)
  readonly selfSeat: boolean;
  readonly people: readonly StaffEditRowFacts.Person[];   // the fields of VisitEditorClientOption it reads (id: DraftPersonKey, label, phone, …) — W0-S lists them from the port
  readonly legs: readonly StaffEditRowFacts.Leg[];        // the fields of VisitEditorLeg it reads (seatId: SeatId, barberId: BarberId | null, priceCents, currency, …)
  readonly discounts: readonly StaffEditDraft.Discount[];
  readonly vouchers: readonly StaffEditDraft.Voucher[];
};
// DayRowVm (sd) is assignable to StaffEditRowFacts as is — passed unmapped (Law 3), pinned type-level by W1-S3.
// Where a field the system reads is OPTIONAL on the §2.4 editor contract (e.g. VisitEditorLeg.clientId?),
// the editor contract makes it required `| null` in W1-S2 (its producers in W1-S3 set it), so the
// assignment holds without an optional property in the system type.
StaffEditPlanSystem.commandsFor(draft: StaffEditDraft, row: StaffEditRowFacts | null, words: { walkIn: string; guestLabels: … }): Result<readonly BookingCall.EditCommand[], PipelineError>;
StaffEditPlanSystem.tipSeat(row: StaffEditRowFacts | null, draft: StaffEditDraft): SeatId | null;
StaffEditPlanSystem.bookingRequest(draft: StaffEditDraft, create: …, words: …): Result<BookingCall.BookRequest, PipelineError> | null;
```

`typedPriceCents` is today's `priceCents?` ("a price typed on the ladder");
`priceCents` is the leg's price (seat or catalogue) that today travels as
`priceLabel`. The REPRICE gate compares `priceCents` (today: labels) —
DEP-20. `commandsFor` keeps today's refusals: `TrackMinute.toStart(start)`
refused → `refusedAt('startMinutes')`; `toEnd(end)` refused →
`refusedAt('atMinutes')`; an unparseable day can no longer occur (the type
is `LocalDate`; today's `Result.ok([])` branch for it is unreachable and
goes). Command order and object key order are byte-identical (`JSON.stringify`
`shapeNeutral`); W0-S ports the dashboard spec's save/undo/REPRICE cases as
system cases with identical command arrays.

**Required fields — forced edits (listed in §4.2).** Every producer of a
commit sets the three formerly-optional fields explicitly, reproducing
today's absent answers: `revision: null` where it was omitted, `drawn:
null` where omitted, a leg's `typedPriceCents: null` where `priceCents` was
omitted. Every READ of them keeps its answer: W0-S (system) and W1-S2/W1-S3
grep each `revision`/`drawn`/`priceCents` read of a commit (`=== undefined`,
`!== undefined`, `?? `, `in`, truthiness) and re-express it on `null` so
that `undefined`-before and `null`-after give the same branch (§9 note
lists each); producers: the editor's commit builder and `snapshotCommitOf`
(`ve:1363-1374`, W1-S2), the dashboard's create/undo commits (W1-S3); spec
fixtures building commits: `staff-dashboard.spec.ts`,
`staff-visit-editor.spec.ts`, `staff-edit-plan.system.spec.ts`.

### 2.13 Shared formatter narrowing (W2-U)

```ts
formatWallClock(localDate: LocalDate, minute: MinuteOfDay | EndMinute | null, …)   // was MinuteOfDay | number | null
wallClockParts / formatWallClockParts: same minute type
formatMinute(minute: MinuteOfDay | EndMinute, …)
formatInstant(utcEpochMs: UtcEpochMs, timeZone: TimeZone, …)
formatCents(amountCents: PriceCents, currency: Currency, …)
formatBookingTime(localDate: LocalDate, minute: MinuteOfDay | EndMinute, locale)
// added in wave 1 by W1-S3 (X-1): formatZoneName(utcEpochMs: UtcEpochMs, timeZone: TimeZone, locale): string; formatCentsFigure(cents: PriceCents, currency: Currency, locale): string
UiDayKey = LocalDate; UiMonthPicker uiSelected/uiToday/uiMarked/uiMin/uiPicked: LocalDate
UiWeekdayPicker uiSelected: readonly Weekday[]; uiSelectedChange: Weekday[]
```

---

## 3. Packages

Every package: re-read each site before editing (lines drift); never
`git commit`/`push`/`stash`/`checkout`/`reset`/`worktree add`; undo by the
inverse edit; `rm -rf dist/out-tsc` before any run-many typecheck and pass
`--skip-nx-cache`; `grep -r` (not `git grep`) for every rename and "no
caller" proof; never run the runbook grep gates, emulators, the dev server
or `seed:dev` (G only); never `pnpm install`/`nx reset`. Run your projects'
`typecheck`, `lint`, `test` (and `pnpm nx build web` when you touched a
template). Record in your §9 note: each parse/`ofProven` site with its
proven range (D-4.5), each spec edited and why (§4.2 class), each DEP's
spec cases. Specs change only where a type change forces it or a DEP says
so; every expectation otherwise byte-identical.

### W0-P — primitives and test helpers · wave 0 (FIRST, alone)

**Files:** `libs/ecs-core/src/primitives/minute-of-day.primitive.ts`(+spec),
`utc-epoch-ms.primitive.ts`(+spec), `duration-minutes.primitive.ts`(+spec),
`ids.primitive.ts`(+spec, `ids.type-spec.ts`), NEW `tag.data.ts`(+spec),
`booking-status.data.ts`(+spec), `locale.data.ts`(+spec),
`primitive.error.ts`(+spec) only if a new code is unavoidable,
`primitives/index.ts`, `libs/ecs-core/src/testing/test-support.ts`(+spec),
`apps/functions/src/edge.ts` (one inert row, only with a new
`PrimitiveErrorCode`); `libs/ui/wall-clock/src/lib/wall-clock.ts`(+spec)
for the `formatClock`/`ClockClosing` ADDITION only (and its `index.ts` if
it lists names); **the wave-0 barrels** `components/index.ts`,
`systems/index.ts`, `entities/index.ts` and every NEW wave-0 ecs-core file
as a one-line placeholder (D-12.1).
**Brief:** add §2.1 exactly (JSDoc on each: unit, range, why). `TrackMinute.of`
accepts every non-negative safe integer (no upper bound — prove in the spec
that 0, 1440, 1455, 2880 pass and −1, 1.5, NaN refuse). `formatClock` cases
(in `wall-clock.spec.ts`): 0 → `00:00`, 545 → `09:05`, 1439 → `23:59`,
1440 WRAP → `00:00`, 1440 END_OF_DAY → `24:00`, 1455 WRAP → `00:15`, and
byte-equality with each of the seven hand faces it replaces on 0…1455.
`parseClock` cases: `9:05`, `09:05`, `23:59`, `' 10:30 '` (trimmed) ok;
`24:00`, `10:30:00`, `10:30x`, `''`, `7`, `ab:cd` refused. `MinuteDelta.between`
widened (an `EndMinute` case, 1440). `SeatKeyText`'s JSDoc amended to name
both spelling families (D-3). The barrels: one edit per barrel appending
the `export *` line of every planned new file, each created as a
placeholder; list them in your §9 note so each filling package can find
its own. `DraftPersonKey` spellings pinned against `VisitDraftSystem`'s
constants (`'primary'`, `'guest-'`) and `accountOf` ported case for case from
`visit-draft.system.spec.ts`'s `accountKeyOf` block. `Tag.values` order =
key order. Turn `isBookingStatus`/`isLocale`/`LOCALES` into `@deprecated`
delegates of `Tag` (W3-T deletes). Purity specs for every function.

### W0-I — identity, accounts, governance, roles, audit · wave 0

**Files:** `libs/ecs-core/src/components/` `role.data.ts`(+spec,
`role.rules-parity.spec.ts`), NEW `roles.data.ts`(+spec),
`registration.data.ts`(+spec), NEW `registration-fields.data.ts`,
`auth-strategy.data.ts`(+spec), NEW `auth-provider.data.ts`,
`auth-deployment.data.ts`, `auth-flow.data.ts`(+spec), NEW
`auth-flow-event.data.ts`, `onboarding-flow.data.ts`(+spec), NEW
`onboarding-flow-event.data.ts`, `identifier.data.ts`(+spec), NEW
`parsed-identifier.data.ts`, `impersonation-status.data.ts`(+spec), NEW
`end-reason-fields.data.ts`, `impersonation-scope.data.ts`(+spec),
`session-kind.data.ts`(+spec), `otp-code.data.ts`, `phone-number.data.ts`(+spec),
NEW `e164.data.ts`, `account-status.data.ts`(+spec), `feature-flags.data.ts`(+spec),
`audit-context.data.ts`(+spec), NEW `audit-target-ref.data.ts`, NEW
`placement-action`/`transition-action`/`arrival-action`/`tip-action`/`staff-edit-action`/`profile-action.data.ts`,
NEW `session-readiness`/`route-gate`/`access-target`/`access-verdict`/`access-decision`/`settled-verdict`/`personalize-step`/`profile-completion-key`/`profile-auth-type.data.ts`,
`actor.data.ts`, `auth-claims.data.ts`, `principal.data.ts` (Roles re-points),
`identity-dictionaries.type-spec.ts` (barrel lines are W0-P's);
`systems/` `session-access.system.ts`(+spec), `guest-guard.system.ts`(+spec),
`onboarding-flow.system.ts`(+spec), `auth-flow.system.ts`(+spec),
`profile-completion.system.ts`(+spec), `audit.system.ts`(+spec),
`profile-edit.system.ts`, `impersonation.system.ts`(+spec), `otp.system.ts`(+spec),
`registration.system.ts`(+spec), `age.system.ts` (if a factory is read);
`errors/identity.error.ts`(+spec), `accounts.error.ts`(+spec),
`governance.error.ts`(+spec); `pipelines/` (import/type re-points only for
`save-own-profile` — its reshape is W1-A's, D-12.7), `verify-otp`, `request-otp`, `complete-registration`, `register-user`,
`update-profile`, `redeem-invitation`, `start-impersonation`,
`end-impersonation`, `ensure-session-ready` (+ their specs);
`ports/auth.port.ts`; `testing/identity.fixtures.ts`;
`tools/flags/feature-flags.manifest.spec.mjs`.
**Brief:** S-10…S-14, E-20, E-21 (§1.10, §2.2, §2.9, §2.11). `Roles`
per D-7.3 (claims-tolerant parameters kept; `role.rules-parity.spec.ts`
reads `Roles.*` lists — byte-identical arrays). `AUDITED_PROFILE_FIELDS`
an explicit list in today's order (stored audit arrays). Move the pipeline
error unions with transitional re-exports. DECLARE (additively)
`AccountsError.OwnProfileSave`, `AuthFailure`, `OnboardingFailure` and
`IdentityError.birthDatePartial()`; split the flow files with their shapes
UNCHANGED — `saveOwnProfile`'s answer and the flow states'/events' error
fields are retyped by W1-A in wave 1 together with their consumers
(D-12.7: no feature file of yours, no project red after wave 0). Any other
shape change you find with a consumer outside ecs-core follows D-12.7 rule
(a).
Transitional delegates for every moved list/function with a consumer
outside your files (W3-T deletes).

### W0-B — booking flow, cart, catalogue terms, scheduling components · wave 0

**Files:** `components/` `booking-flow.data.ts`(+spec), NEW
`shop-reach`/`schedule-selection`/`seat-assignment`/`booking-confirmation`/`waitlisted-summary.data.ts`,
`cart-line.data.ts`(+spec), NEW `seat-key`/`booking-cart`/`cart-seat-lines.data.ts`,
`party.data.ts`(+spec), NEW `party-member.data.ts`, `booking-draft.data.ts`(+spec, type-spec),
`service-terms.data.ts`(+spec), NEW `service-variant`/`service-terms-input.data.ts`,
`barber-offering.data.ts`(+spec), NEW `variant-terms.data.ts`,
`service-composition.data.ts`, `placement-policy.data.ts`(+spec), NEW
`staff-terms-override.data.ts`, `booking-policy.data.ts`(+spec),
`media-ref.data.ts`(+spec), `program-input.data.ts`, NEW
`position-input`/`course-input`/`shop-event-input.data.ts`,
`opening-hours.data.ts`(+spec), NEW `shop-opening`/`day-hours-input.data.ts`,
`roster-window.data.ts`(+spec), NEW `shop-day-hours.data.ts`,
`schedule-version.data.ts`(+spec), NEW `shift-segment.data.ts`,
`recurrence-rule.data.ts`(+spec), NEW `recurrence-pattern`/`recurrence-end-rule.data.ts`,
`catalog-status.data.ts` (split), NEW `booking-flow-event`/`prefill-companions`/`service-selectability.data.ts`,
`booking-flow-dictionaries.type-spec.ts`, `booking-core-dictionaries.type-spec.ts`
(barrel lines are W0-P's); `systems/booking-flow.system.ts`(+spec),
`booking-cart.system.ts`(+spec), `service-conflict.system.ts`(+spec),
`move.system.ts`(+spec), `waitlist.system.ts`(+spec), `roster.system.ts`
(`CLOSES_SOON_MINUTES`), `programs.system.ts` is NOT yours (W0-L);
`errors/move.error.ts`(+spec), `booking-flow.error.ts`(+spec),
`catalog.error.ts`(+spec); `pipelines/request-waitlist.pipeline.ts`(+spec),
`pipelines/program-content.pipeline.ts`; `testing/booking-flow.fixtures.ts`,
`testing/programs.fixtures.ts`; **the `MoveRefusal` chain's feature lines
(D-12.7 (b), E-4):** `libs/features/client/booking/src/lib/booking-flow.store.ts`
(`:24-25`, `:602-707` only — `_moveRefusal`, `refuseMove`, `rescheduleFrom`),
`booking-words.ts` (`:3`, `:52-56`), `client-booking/client-booking.ts`
(`:18-19`, `:251`, `:254`, `:300`), `client-booking/client-booking.html`
(`:148-174`), `booking-flow.store.spec.ts` (`:24`, `:1044-1046`, `:1768`,
`:1778`), `booking-words.spec.ts` (`:4`, `:46-48`).
**Brief:** S-15, S-16, E-22, E-4. `MoveRefusalReason` folds into the existing
`MoveErrorCode` (three members, `BOOKING_RESCHEDULE_*`, D-9.2) and
`MoveRefusal` moves to `errors/move.error.ts` as the struct union (§2.9);
`MoveSystem.refusalOf` builds it. Because the reshape breaks its feature
readers, you convert them in the same package (listed above): `refuseMove`
takes the struct, `rescheduleFrom` answers `Result<void, MoveRefusal>`,
the `booking-words.ts` table is keyed by the three `MoveErrorCode`
members with byte-identical values (`companions_only`/`unavailable`/
`carried_out_of_reach` — the i18n segment and `data-reason`), the
template reads `refused.errorCode`; no transitional `MoveRefusalReason`
survives. Run `pnpm nx build web` (template) and the `client-booking`
project's typecheck/lint/test. W1-B leaves these lines alone but for
imports. `BookingFlowState.isTerminal` becomes the type guard,
`BookingFlowSystem.isTerminal` delegates (prove the six steps agree in the
spec). `BookingDraft`'s restore parses the contact through the brands'
constructors (refusal → `null`) and `idOf` takes a `Result` parser — prove
with the existing draft fixtures that every app-written draft restores
byte-identically. The persisted draft's FIELD NAMES do not change
(`creativo.booking-draft/v2`). `WaitlistIdBasis` named once.

### W0-W — the booking write side · wave 0

**Files:** `pipelines/book-appointment`, `edit-appointment`,
`reschedule-appointment`, `cancel-appointment`, `transition-appointment`,
`mark-arrival`, `record-seat-tip`, `attach-visit-photo` `.pipeline.ts`
(+ specs), `pipelines/booking-read-set.pipeline.ts` (type only, and the
DELETION of its dead `localDateOrNull` export, `:379` — prove no caller with
`grep -rn localDateOrNull libs apps`: the feature copy at
`booking-flow.store.ts:1313` is a separate function W1-B deletes);
NEW `components/booking-read-snapshot`/`edit-call-outcome`/`move-outcome`/`ledger-verdict.data.ts`;
`systems/appointment-edit.system.ts`(+spec), `systems/appointment-lifecycle.system.ts`
(the `TransitionAction` reference only if renamed — it is not: own file);
`errors/booking.error.ts`(+spec), `staff-edit.error.ts`(+spec),
`media.error.ts`(+spec); `components/appointment-dictionaries.type-spec.ts`.
**Brief:** G-20, E-23. One `BookingReadSnapshot` dictionary for the three
pipelines' read tag (field `bookingReadSnapshot`, every literal site
replaced — 33 type/value sites + 7 compares); `EditCallOutcome`,
`MoveOutcome` homed; `readBooking(tx: ReadTx, …)`; `nowUtcMs: UtcEpochMs`
(D-12.7: narrowed in wave 0 only if every outside caller already passes a
`UtcEpochMs`, else the `(narrow)` marker);
`MinuteDelta.fromDuration`. Error unions homed with transitional
re-exports. No behaviour change: every pipeline spec green unchanged but
import lines.

### W0-S — staff: visit list/story/draft, grid, query, billing, seats, the edit plan · wave 0

**Files:** `systems/visit-list.system.ts`(+spec), `visit-story.system.ts`(+spec),
`visit-draft.system.ts`(+spec), `grid-layout.system.ts`(+spec — gains the
ported `lane-gaps.spec.ts` minute cases), `client-query.system.ts`(+spec),
`interval-set.system.ts`(+spec), `billing.system.ts`(+spec),
`visit-sides.system.ts`(+spec — `VisitSides` moves out, a transitional
type re-export left), `cancellation-policy.system.ts`(+spec — the one
`seatStartUtcMs` caller, `:27`, re-pointed to `instantAt`), NEW
`staff-edit-plan.system.ts`(+spec, the file W0-P placeholdered — the
`systems/index.ts` line is W0-P's); `components/` NEW `visit-sides.data.ts`, NEW
`visit-grain`/`visit-row-outcome`/`visit-filter`/`visit-perspective`/`cancelled-side`/`bill-pending`/`tip-preset`/`client-query-shape`/`grid-event`/`repeat-preset`/`normalized-ranges`/`staff-edit-draft`/`visit-edit-write-outcome.data.ts`,
`seat.data.ts`(+spec), NEW `seat-occupant`/`chair-geometry`/`seat-catalog-terms`/`seat-core`/`account-seat.data.ts`,
`seat-outcome.data.ts`(+spec), NEW `cancellation-reason-set.data.ts`,
`seat-id-pair.data.ts`(+spec), NEW `stood-seat-pairs.data.ts`,
`staff-verb.data.ts`(+spec), NEW `arrival-verb`/`mark-arrival-action.data.ts`,
`time-coordinate.data.ts`(+spec), `wall-time.data.ts`(+spec),
`edit-command.data.ts` (types), `staff-ui-dictionaries.type-spec.ts`
(barrel lines are W0-P's); `pipelines/append-team-note.pipeline.ts`(+spec);
`testing/appointment.fixtures.ts`.
**Brief:** S-17, S-18, D-10.1/.2/.7. Move the family dictionaries (values
unchanged). `PersonSubject` folded; `personKeyOf`/`seatPersonKey` answer
`SeatKeyText`. `VisitDraftSystem`: `DraftPersonKey` replaces the string
person key (`accountKeyOf` a transitional delegate of `DraftPersonKey.accountOf`),
`snap`/`snapUp`/`span` answer `TrackMinute`/`DurationMinutes`,
`DraftLegClient<K>`/`WalkInLabel<K>` instantiated with `DraftPersonKey`.
`GridLayoutSystem`'s `TrackSpan`/`TrackEvent`/`TrackColumn` minutes →
`TrackMinute` (they stay system I/O) — in wave 0 only for a struct no
feature BUILDS; a struct a feature builds (W0-S greps `libs/features` for
object literals passed as one) keeps `number` fields with the `(narrow)`
marker, and W3-T narrows it after W1-S1/S2/S3 (D-12.7 (a)). `NormalizedRanges` moves to its own
component file with the normalising sort/merge (the cast lives there).
`TimeCoordinate.seatStartUtcMs` FOLDED into `TimeCoordinate.instantAt(time,
minute: MinuteOfDay | EndMinute)` (D-6.5: rename once, same body;
`cancellation-policy.system.ts` re-pointed; `endUtcMs` composes it; G-1
JSDoc amended; `time-coordinate.data.spec.ts:48-61` re-spelled with
identical expectations, plus an `EndMinute` case and the two Sofia
straddles documented) and `WallTime.toLocalIso` added (a text join, no
zone). `VisitSides` → `components/visit-sides.data.ts` (§2.12).
`StaffEditDraft` with EVERY property required (`revision`, `drawn`, a
leg's `typedPriceCents` → `| null`, §2.12); `StaffEditRowFacts` declared
in the system file with ecs-core types only. Signature changes of
`VisitDraftSystem`/`GridLayoutSystem` follow D-12.7 rule (a): returns
branded, parameters (and the fields of a track struct a feature builds)
keep their raw base with the `(narrow)` marker for W3-T.
`StaffEditPlanSystem` (§2.12) — a line-for-line port of
`commandsFor`/the tip seat/`createFromEditor`'s request over branded
inputs; its spec ports every dashboard spec case of the save, undo, REPRICE,
serial placement, subject choice and ladder pins with byte-identical command
arrays (`toEqual` + `JSON.stringify` equality). `saveTeamNote` pipeline with
the one record builder. `StaffVerb.didNotHappen` (all six verbs pinned).

### W0-L — loyalty, engagement, rhythm, programs · wave 0

**Files:** `components/gamification.data.ts`(+spec), NEW
`metric-ref`/`award-summary`/`badge-subject-slot`/`season-window.data.ts`,
`streak-rule.data.ts`(+spec), NEW `streak-rule-input`/`scheduled-streak-rule`/`streak-head-rule.data.ts`,
`streak-state.data.ts`(+spec), NEW `streak-phase-state`/`streak-period-reason`/`streak-period-fact`/`streak-period-terms.data.ts`,
`tier-state.data.ts`(+spec), NEW `tier-override`/`tier-standing.data.ts`,
`standing.data.ts`(+spec), NEW `family-scope-filter.data.ts`,
`journal-effect.data.ts`(+spec), NEW `journal-feed`/`reward-ref-fields`/`grant-ref-fields`/`public-label`/`label-param.data.ts`,
`journal-source.data.ts`(+spec), NEW `rule-ref.data.ts`,
`grant-lifecycle.data.ts`(+spec), NEW `grant-capacity-terms`/`grant-expiry-terms.data.ts`,
`badge-level.data.ts`(+spec), NEW `earned-level`/`series-standing.data.ts`,
`enrollment-status.data.ts`(+spec), `medal-outlook`/`pass-state`/`streak-outlook`/`client-history`/`coupon-occasion.data.ts` (split),
`voucher-code.data.ts`(+spec), `reward-redemption.data.ts`,
`streak-publish-call.data.ts`(+spec), NEW `streak-standing`/`streak-preview-outcome`/`streak-preview-unavailable`/`streak-standing-counts`/`streak-preview`/`draft-assessment`/`streak-track-mark.data.ts`,
`reward-grant.data.ts`, `notification-payload.data.ts` (re-points),
`streak-qualifier.data.ts`(+spec), NEW `qualifier-comparison.data.ts`,
`streak-interval.data.ts`(+spec), NEW `streak-interval-source.data.ts`,
`loyalty-dictionaries.type-spec.ts`, `medal-outlook.type-spec.ts` (barrel
lines are W0-P's); `entities/` NEW `loyalty-catalog.ts` (not `.entity.ts`,
D-7.5), `coupon.entity.ts`, `season.entity.ts`, `streak-definition.entity.ts`,
`badge-progress.entity.ts`, `engagement-entities.type-spec.ts`;
`systems/` `streak-preview`, `streak-publish`,
`streak`, `streak-rule`, `loyalty-catalog`, `voucher`, `coupon-grant`,
`standing`, `badge`, `achievements`, `season`, `tier`, `discount`,
`programs`, `ledger`, `rhythm-draft`, `loyalty-pass` `.system.ts` (+ specs);
`ports/engagement.port.ts`; `errors/engagement.error.ts`(+spec),
`streak-publish.error.ts`(+spec); `pipelines/rhythm-publish`,
`publish-streak-definition`, `load-held-grants` `.pipeline.ts` (+ specs);
`testing/loyalty.fixtures.ts`(+spec), `testing/port-doubles.ts`(+spec).
**Brief:** S-19, S-20, E-24. One `LoyaltyCatalog` in `entities/loyalty-catalog.ts`
WITH its bound types (`CatalogCategoryRef` … `CatalogSubjectRef`, eight,
D-7.5) and `LoyaltyCatalogParts`; `ValidLoyaltyCatalog` stays in the system;
`standing.system.ts` and `loyalty-catalog.system.ts` re-point to
`@core/entities`; transitional re-exports only for names with consumers
outside ecs-core (`LoyaltyCatalog` is read by the client card, the
firestore adapter and `loyalty-catalog-memo.ts`); the pin block deleted.
`QualifierComparison` and `StreakIntervalSource` to their own files (§2.2);
`STREAK_QUALIFIERS` → `Tag.values(StreakQualifier)`. `DiscountSystem.isOffered(coupon): coupon is OfferedCoupon` — the
double (`port-doubles.ts:497-502`) uses it and sorts with
`UtcEpochMs.compare` (`:277-279`, `:374`, `:554`, `:596`, `:619`, `:776`).
`ENGAGEMENT_VOUCHER_CODE_DUPLICATE` (DEP-18; X-4 row by W0-O). The answered
streak-publish set spelled once; the guard narrowed. Transitional aliases
for every moved name with feature consumers (`Gamification`,
`isStreakExcuse`, `STREAK_EXCUSES`, `STREAK_SHOP_EXCUSES`,
`isEnrollmentOpenOrUpcoming`, `ENROLLMENT_STATUSES`, `RhythmPublishRefusal`,
the streak-preview names).

### W0-O — operations, stats, paging, time, the edge rows · wave 0

**Files:** `systems/client-stats.system.ts`(+spec), `policy-recompute-job.system.ts`(+spec),
`backfill-plan.system.ts`(+spec), `trigger-attempt.system.ts`(+spec),
`paging.system.ts`(+spec), `zoned-time.system.ts`(+spec), `retention.system.ts`(+spec),
`records.system.ts`, `streak-preview` is NOT yours (W0-L);
`components/client-stats.data.ts`(+spec), NEW `precise-instant`/`last-visit`/`next-visit`/`pause-suggestion`/`client-money-stats`/`policy-pass`/`policy-pass-stamp`/`live-policy-line`/`visit-fact`/`visit-leg`/`client-stats-key`/`client-stats-meta.data.ts`,
`write-op.data.ts`, NEW `doc-path`/`doc-body.data.ts`, `policy-recompute-outcome.data.ts`
(split), NEW `subject-visit-outcome`/`cancellation-attribution`/`stats-write-decision`/`policy-pass-verdict`/`backfill-phase`/`backfill-start`/`attempt-outcome`/`page-step`/`backfill-call-end`/`waitlist-delivery-outcome.data.ts`,
`stats-ops-dictionaries.type-spec.ts`, `money.data.ts`(+spec), NEW
`rounding-mode.data.ts`, `foundation-dictionaries.type-spec.ts` (the
`RoundingMode` home comment) (barrel lines are W0-P's);
`entities/collections.ts`, `entities/client-stats.entity.ts`,
`client-money-stats.entity.ts`; `ports/tx.port.ts`;
`pipelines/run-backfill`, `match-waitlist`, `project-client-stats`,
`continue-policy-recompute`, `sweep-policy-recompute`,
`start-policy-recompute`, `rebuild-busy`, `rebuild-capacity` (type
re-points) `.pipeline.ts` (+ specs); `errors/pipeline.error.ts`(+spec)
(`HttpsStatus`); `testing/test-support.ts` is W0-P's — not yours;
`apps/functions/src/edge.ts` (+ `edge.spec.ts`) for the X-4 rows only.
**Brief:** S-21. Dictionaries homed (values unchanged); `RoundingMode` to
its own file (§2.2, values unchanged); `LocalFit`
SCREAMING (private); `UtcEpochMs.EPOCH` in retention; `PreciseInstant`
gains the whole-second + nanos member `triggers.wire.ts` needs; `QueryOp`
one name; `HttpsStatus` contract dictionary; the X-4 `EDGE_WIRE` rows for
the three folded `MoveErrorCode` refusals (inert, client-only, in the existing `MOVE_WIRE`) and `ENGAGEMENT_VOUCHER_CODE_DUPLICATE`
(spellings §2.9).

### W1-S1 — staff day store, time grid, timeline, block editor, day pill · wave 1

**Files:** `libs/features/staff/dashboard/src/` `index.ts`,
`lib/staff-day.store.ts`, `lib/lane-gaps.spec.ts` (DELETED),
`lib/lane-geometry.spec.ts`, `lib/agenda-fields.ts`(+spec),
`lib/time-grid/*` (`staff-time-grid.ts`/`.html`/spec, `grid-gesture.ts`/spec,
`minute-run.ts`), `lib/timeline/*`, `lib/block-editor/*`
(`staff-block-editor.ts`/`.html`/spec, `block-repeat.ts`/spec),
`lib/day-pill/*`, `lib/row-verb.ts`, `lib/tag-words.ts`(+spec), the
store's spec if present.
**Brief:** §1.1, §1.4, §2.3, §2.5's grid half. Delete the second zone engine
(D-6.6); lanes carry `MinuteRange`/`LaneGap`. `todayKey`/`dayKey`
`LocalDate | null` with the effect and every `''` check moved together
(read `feedback_effects_never_write_what_they_read` in memory: untracked
store calls, never navigate in the first activation). `applyRouteDay` /
`applyRouteBarber` / `probeDay` parse once (DEP-13/14 spec cases, `?barber=%20`
beside `?barber=a/b`). Branded per-visit APIs. `StaffView` contract
dictionary; `parseView` stays nullable (`Tag.has`), `Tag.or` only in
`readStoredView`; pin the silence case (G-1, in a new `staff-day.store.spec.ts` or the dashboard spec). NEW `zoneAt` and `shopNowAt` (§2.3,
D-6.2: one `ShopNow` per zone per tick, the catalogue shop's zone else the
day's, `zoneOfShop`'s rule moved into the store) — W1-S3 reads it.
`absenceError` holds `StaffBlockFailure` (zone unknown →
`CatalogError.locationZoneUnknown`; the bad-day branches deleted; the
empty-id guard per D-9.4; template truthiness kept); `noteError` deleted;
`saveTeamNote` calls the pipeline. Grid/timeline/gesture minutes
`TrackMinute`; `nowMinute` `MinuteOfDay | null`; the hand faces/parsers →
`formatClock` (`@creativo/ui/wall-clock`, W0-P) / `MinuteOfDay.parseClock`;
`PlacementVerdictSlice.minutes: DurationMinutes`; `readoutTone` one shared
type; offscreen/axis/`page` dictionaries; `AgendaField` contract
dictionary; day pill `LocalDate` in and out (`localDateOfKey` deleted);
block editor branded (`now: ShopNow | null`), weekdays `Weekday[]`. X-2
contracts §2.3–§2.5. The `staff-time-grid.spec.ts` (87+87) /
`staff-timeline.spec.ts` (13) fixtures take `trackMinute()`.

### W1-S2 — the visit editor · wave 1

**Files:** `libs/features/staff/dashboard/src/lib/visit-editor/*`
(`staff-visit-editor.ts`/`.html`/spec, `visit-editor-discount.ts`,
`client-query.ts`(+spec), and any sibling file there),
`lib/swipe-to-delete/*` only if a type forces it.
**Brief:** §1.3, §2.4 (the editor declares the contracts; W1-S3 produces
them). `vm.now` replaces `shopNowAt` (prove equality: D-10.5). `null`
replaces every `''` sentinel (reproduce each `''` answer — §7 R-3).
`DraftPersonKey`, `SeatId`/`ServiceId`/`ServiceVariantId`/`BarberId`,
`TrackMinute`, `DurationMinutes`, `PriceCents`+`Currency` end to end;
`billCentsOf`/`drawableCentsOf`/converters' defects deleted; legs carry
`priceCents`; `snapshotCommitOf` copies cents; `catalogueTotalLabel` sums
cents; `moneyLabel(cents: PriceCents)` — prove each of its 11 callers holds
an integer ≥ 0 at its edge (slider, amount field, `read.minor`) before the
`''` path goes, else keep the parse at that edge; `figureOf` →
`formatCentsFigure` (X-1); the editor formats with the bill's currency
(DEP-21). Required `email`; ecs-core `RankableClient`. Photo/discount/
voucher/grant/promo ids branded; `OfferChoice` split; `availableCents`.
`MinuteOfDay.parseClock` and `formatClock` (`@creativo/ui/wall-clock`).
`photoDay` through `ZonedTimeSystem`; the three `'bg-BG'` photo-title reads
(`ve:5397`/`:5409`/`:5418`) stay literally `'bg-BG'` (D-14). The commit
builders set `revision`/`drawn`/`typedPriceCents` explicitly (`null` where
omitted today) and every read of them keeps its branch (§2.12);
`VisitEditorLeg.clientId` becomes required `DraftPersonKey | null` if
`StaffEditRowFacts.Leg` reads it.
The `heldCatalog` getter → a `computed()` (contravariant lookups). Tag
dictionaries G-5/G-6 with `Tag.has` guards (test-id suffixes literal);
`resolutionTone` the DS tone type. Leave `cardContextOf`/`cardSubjectOf`/
`shopIsoOf` to W2-CK (do not touch them beyond what compiles).

### W1-S3 — the staff dashboard · wave 1

**Files:** `libs/features/staff/dashboard/src/lib/staff-dashboard/*`
(`staff-dashboard.ts`/`.html`/spec; the CSS untouched),
`libs/infrastructure/i18n/src/lib/relative-time.ts`(+spec),
`libs/ui/wall-clock/src/lib/wall-clock.ts`(+spec) for the two ADDITIONS
only (`formatZoneName`, `formatCentsFigure`, X-1).
**Brief:** §1.2, §2.4/§2.5's producer half, D-6 entire, D-10.1/.4/.6/.7.
Rows, lanes, agenda, search and «Скорошни» on the wall clock (DEP-1…9,
11, 12 spec cases — §4.3); `isNext` keeps the lane's array order (D-6.3);
the search and «Скорошни» read `store.shopNowAt(locationId)` (never
`ZonedTimeSystem.shopNow` in the component; `zoneOfShop` deleted, its rule
is the store's), the fresh `clock.nowUtcMs()` read in `browseClients`
goes, the pre-zone answers are kept (labels `''` while `store.zone()` is
`null`, «Скорошни»'s stamp-rule inclusion for a shop with no zone — D-6.2);
the countdown on instants via `TimeCoordinate.instantAt` (the folded
`seatStartUtcMs`); every instant ↔ minute helper deleted; block id
re-keyed `block:<barberId>:<localDate>:<startMinutes>` with `openBlock` a
no-op for another day (DEP-11); `openGap` and the grid's gap path on this page deleted (prove
unreachable); `pendingAction` deleted; `durationMinutes` deleted. Branded
`DayRowVm` and every id signal. `cardViewer` per D-10.6. The
`clientCardCatalog` getter → `computed()`. `commandsFor`/tip seat/
`createFromEditor` request → `StaffEditPlanSystem` (orchestration stays;
`row` passed as is — pin `DayRowVm` assignable to `StaffEditRowFacts`
type-level; the create/undo commits set `revision`/`drawn`/
`typedPriceCents` explicitly, §2.12);
`EditorWrite` → `VisitEditWriteOutcome`; `actFromSheet` →
`StaffVerb.didNotHappen`. `serviceOptions` derive cents from
`OfferingPriceSystem.termsFor` (label line unchanged until W2-M). Internal
dictionaries G-2/G-4. `relativeTime` on `UtcEpochMs`.

### W1-K — the client card (internal chains) · wave 1

**Files:** `libs/features/staff/client-card/src/lib/` `client-card.store.ts`(+spec),
`client-card.presenter.ts`(+spec), `glance.presenter.ts`(+spec),
`achievements.presenter.ts`(+spec), `medals.presenter.ts`(+spec),
`medal-detail.presenter.ts`(+spec), `wallet.presenter.ts`(+spec),
`records.presenter.ts`(+spec), `loyalty.presenter.ts`(+spec),
`ledger.presenter.ts`(+spec), `visits-page.presenter.ts`(+spec),
`history.presenter.ts`(+spec), `client-card.format.ts`(+spec),
`client-card.words.ts`(+spec), `client-pages.vm.ts`(+spec), the page
components under `client-card/`, `client-loyalty/`, `client-records/`,
`client-achievements/`, `achievement-category/`, `achievement-detail/`,
`client-history/`, `client-ledger/`, `loyalty-glance/`, `activity-list/`,
`wallet-holdings/`, `medals-glance/`, `rhythm-card/`, `record-card/`,
`birthday-card/`, `achievement-chips/` (`.ts`/`.html`/spec as forced),
`libs/features/staff/client-card/src/testing/*` (`client-card.fixtures.ts`,
`client-pages.vm-fixtures.ts`, `achievements-pages.rig.ts`).
`client-card.contracts.ts` ONLY its `WalletAnchor` (`:173`) and
`ClientCardRegion` (`:215`) declaration blocks (~`:170-220`, G-11 — the one
exception, safe because W2-CK edits the file only in wave 2).
NOT yours: the rest of `client-card.contracts.ts` and the contract-reading
lines of the store/presenters that W2-CK lists (I-21, I-23, I-24, G-7).
**Brief:** U-4…U-6, D-7, I-20, I-22, G-11 (the card-internal half),
G-12. The store hands presenters `ShopNow`/`LocalDate`/`UtcEpochMs`; every
defect copy deleted (D-4.3); mixed-key maps split; vm ids branded; tag
dictionaries with contract values — `WalletAnchor`/`ClientCardRegion`
declared as contract-spelled dictionaries in the contracts file and every
bare compare of them re-spelled (`client-card.ts:237-240`, `:51-54`
`GlanceModule`, `client-card.store.ts:1567`, `client-loyalty.ts:243-253`);
`WalletSection` reuses `WalletAnchor`;
`RecordThemeWord` = `RecordTheme`; word switches on SCREAMING source tags.
X-3: `client-card.words.spec.ts:323-326` re-pointed at the
`errors.LOYALTY_STREAK_PUBLISH_*` keys.

### W1-B — the client booking flow (internal) · wave 1

**Files:** `libs/features/client/booking/src/lib/` `booking-flow.store.ts`(+spec),
`client-booking/*` (`client-booking.ts`/`.html`/spec, `carried-reach.ts`),
`booking-words.ts`(+spec), NEW `booking-people.words.ts`(+spec) (the one
`personLabel`/`barberName`), `review-step/*` (`booking-review-step.ts`,
`booking-error-message.ts`, specs), `schedule-step/*`
(`booking-schedule-step.ts`, `availability-month.ts`,
`time-sheet/booking-time-sheet.ts`/`.html`/spec), `confirmed-step/*`,
`waitlisted-step/*`, `location-step/*`, `services-step/booking-services-step.ts`
ONLY for `renameRefusal` (E-6; W2-M owns its catalogue lines in wave 2),
`booking-wall-clock.ts`(+spec) callers only (W2-U narrows the signature).
NOT yours: `contact-sheet/*` (W1-A), `bag-sheet/*` (W2-M).
**Brief:** §1.7's W1-B rows, §2.10. Route edge parses (D-4 table — a spec
case per refusal reproducing today's outcome, `?reschedule=` included);
the `MoveRefusal` chain is ALREADY converted by W0-B (D-12.7) — leave
those lines alone but for imports; `BookingFlowError.Failure`; `isOpen`
deleted; time sheet `startUtcMs` (DOM value unchanged); one people-words
helper; `formatClock(…, ClockClosing.EndOfDay)` (`@creativo/ui/wall-clock`);
`CapacityMonthId`; `LocationId.of` at the pin; the feature
`localDateOrNull` (`booking-flow.store.ts:1313`) deleted once `?day=`
parses at the edge, `EARLIEST_DAY` (`:72`) built inline with
`LocalDate.parse` + `defect` (D-4.3); `renameRefusal` holds the struct
and words it in a `computed` — DEP-23 spec case (shown, language
switched → the new language's line).

### W1-A — auth, profile, onboarding, account-state, shell identity, the contact sheet · wave 1

**Files:** `libs/features/client/auth/src/lib/` (`auth-flow.store.ts`(+spec),
`client-auth/*`); `libs/features/client/profile/src/lib/` (`profile.store.ts`(+spec),
`client-profile/*`); `libs/features/client/onboarding/src/lib/`
(`onboarding-flow.store.ts`(+spec), `client-onboarding/*`);
`libs/features/client/account-state/src/lib/own-profile.ts`(+spec);
`libs/features/shared/shell/src/lib/identity/avatar-refusal.ts`(+spec),
`identity/session-identity.service.ts` (Roles re-points only);
`libs/features/client/booking/src/lib/contact-sheet/*`
(`booking-contact-sheet.ts`/`.html`/spec, `booking-contact.store.ts`(+spec));
NEW `libs/features/client/auth/src/lib/word-flow-failure.ts` (+spec) or
the shared home W1-A picks for the one server-code helper (state it);
**the identity-flow chain's ecs-core files (D-12.7 (b), a declared wave-1
exception to D-12.2):** `libs/ecs-core/src/components/auth-flow.data.ts`,
`auth-flow-event.data.ts`, `onboarding-flow.data.ts`,
`onboarding-flow-event.data.ts` (as W0-I split them; +specs,
`identity-dictionaries.type-spec.ts` only if a pinned shape changes),
`systems/auth-flow.system.ts`/`onboarding-flow.system.ts` (the
pass-through lines `:47/53`, `:118/157`; +specs),
`pipelines/save-own-profile.pipeline.ts`(+spec).
**Brief:** §1.8, §2.11. Retype the flow states/events to the error
structs W0-I declared and `saveOwnProfile` to `Result<void,
AccountsError.OwnProfileSave>` (its spec: the same refusals, now structs),
and every consumer in the same package: `profile.store.ts:79`,
`onboarding-flow.store.ts:122-247`, `booking-contact.store.ts:16`,
`auth-flow.store.ts:131/144/163/205`, the components and templates.
Struct state everywhere; the birthday save carries the struct (DEP-17 spec
cases in bg and en); `'partial'` → `IdentityError.birthDatePartial()` with
byte-identical words; one server-code helper for auth and onboarding; the
contact sheet holds the struct and words it in a `computed` (DEP-23 spec
case: the line re-words on a language switch),
`booking.contact.profileFailed` kept; `BirthDate` typed through. Run the
ecs-core project's typecheck/lint/test too.
Leave onboarding's catalogue twins (W2-M) and its locale lines (W3-T).

### W1-R — admin rhythm, admin programs, marketing events and courses · wave 1

**Files:** `libs/features/admin/loyalty/src/lib/` `admin-rhythm.store.ts`(+spec),
`admin-rhythm.preview.ts`(+spec), `admin-rhythm/*` (`admin-rhythm.ts`/`.html`/spec,
`admin-rhythm.words.ts`(+spec)), `admin-rhythm-sheet/*`;
`libs/features/admin/programs/src/lib/` (`admin-programs.store.ts`,
`admin-programs/*`); `libs/features/marketing/events/src/lib/marketing-events/*`;
`libs/features/marketing/courses/src/lib/marketing-courses/*`;
`libs/infrastructure/i18n/src/assets/i18n/bg.json`, `en.json` (the
`errors.LOYALTY_STREAK_PUBLISH_*` keys added, `admin.rhythm.refused.*`
removed; nothing else).
**Brief:** §1.9. `LocalDate` days (defect deleted); spec-only preview
delegates deleted and restated on `StreakPreviewSystem` (re-prove no
production importer); `setEffectiveFrom(day: LocalDate)` (the store spec's
raw-string `it.each` retired on purpose); `ServiceId`/`ServiceCategoryId`
maps; D-9.6 errors with today's words (bg and en spec-pinned);
`RepositoryError.readFailed` in `timed` (W3-T shares it); the tag
dictionaries G-15/G-16; `datetimeLocalOf` → `WallTime.toLocalIso`;
`isEnrollmentOpenOrUpcoming` → `ProgramsSystem`.

### W1-F — the functions edge and the infrastructure adapters · wave 1

**Files:** `apps/functions/src/` `edge.ts`(+spec — not the X-4 rows,
which W0-O added), `main.ts`(+spec), `wire/*.wire.ts`(+specs),
`lib/booking/caller-roles.ts`(+spec), `adapters/firestore-ports.ts`,
`adapters/firestore-jobs.adapter.ts`, `adapters/auth-claims.adapter.ts`,
`integration/*.integration.spec.ts` (import lines);
`libs/infrastructure/firebase-app/src/lib/lazy-port.ts`(+ `lazy-port.spec.ts`,
`lazy-port.forms.spec.ts`), its `index.ts`; `apps/web/src/app/app.config.ts`;
`libs/infrastructure/firestore/src/lib/appointments.adapter.ts`,
`coupons-vouchers.adapter.ts`(+spec), `client-stats.adapter.ts`,
`loyalty.adapter.ts` (import lines); `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts`.
**Brief:** F-1…F-8. `LazyMethod` + `Result` + no freeze (67 binding sites);
adapters' sorts through `UtcEpochMs.compare`; the coupon rule via
`DiscountSystem.isOffered`; `WorkBudget.startedAtUtcMs`; `defect()` for the
module-init throws; the named-bundle intersection; `Roles.*`; every wire
import re-pointed to `@core/errors`.

### W1-U — the icon registry, `translate-coded-error`, the landing's locations · wave 1

**Files:** `libs/ui/icons/**` (manifest, resolver, registry service,
vocabulary, material, logo + specs, README); `eslint.config.mjs` (the
`allowIn` entry and its comment only); `tools/lint-rules/no-generic-discriminator.mjs`(+spec);
`docs/architecture/firestore-runbook.md` §4.9 gates 4 and 5a (text only —
G runs the gates); `docs/design-research/icon-registry-design.md`;
`libs/infrastructure/i18n/src/lib/translate-coded-error.ts`(+spec);
`libs/features/marketing/landing/src/lib/pages/home/locations/locations.component.ts`(+spec).
**Brief:** F-10 (DEP-16: `iconAsset`, schema 2, `Result`, issue structs,
kebab diagnostic codes kept — §4.3 spec list), F-11, N-11 (the landing's
`clockOf` → `formatClock(…, ClockClosing.EndOfDay)` from
`@creativo/ui/wall-clock`, W0-P). Re-prove `pnpm
icons:check` and `pnpm icons:glyphs` unchanged output.

### W2-CK — client card contracts ↔ visit editor ↔ shared visits ↔ appointments/account · wave 2

**Files:** `libs/features/staff/client-card/src/lib/client-card.contracts.ts`(+spec)
— except its `WalletAnchor`/`ClientCardRegion` declarations, which W1-K
converted in wave 1 (G-11; read them as they are),
the contract-reading lines in `client-card.store.ts`, `client-card.presenter.ts`,
`glance.presenter.ts`, `achievements.presenter.ts`, `medals.presenter.ts`,
`medal-detail.presenter.ts`, `history.presenter.ts`, `loyalty.presenter.ts`,
`wallet.presenter.ts`, `records.presenter.ts`, `visits-page.presenter.ts`
(+ their specs and the testing fixtures as forced);
`libs/features/staff/dashboard/src/lib/visit-editor/staff-visit-editor.ts`
(`cardSubjectOf`, `cardContextOf`, `shopIsoOf`, `editorPageWords` →
`ClientCardPage` map, `WalletAnchor` test-id map, `visitsRows`/`lastWorkedVisit`)
(+ spec as forced); `libs/features/shared/visits/src/**` (vm, presenters,
visit-card, visit-list, visits-browser, day-range, visit-sections,
rhythm-rule words, NEW `visit-lookup.contracts.ts`, `testing/visit-fixtures.ts`,
specs); `libs/features/client/appointments/src/lib/**` (`client-appointments.ts`/`.html`/spec,
`visit.vm.ts`, `visit-ics.ts`(+spec)); `libs/features/client/account/src/lib/client-account/*`.
**Brief:** §1.5's W2-CK rows, §1.6, §2.6. The leg's wall clock (DEP-15
spec cases on 2027-03-28 03:30 and 2026-10-25 03:30); `VisitRowVm`/
`VisitCardVm` split by their discriminators; `VisitLookup` to a contracts
file; `today: LocalDate` and `dayRange` narrowed; `?visit=` parse;
`ClientCardPage`; the card store's three `UserId.parse` go. Re-point the
§1.11 import lines in every file you own.

### W2-M — the catalogue's money and ids · wave 2

**Files:** `libs/features/shared/catalog/src/lib/**` (`content/catalog.vm.ts`,
`catalog.presenter.ts`(+spec), `catalog-wording.service.ts`(+spec),
`catalog-content.service.ts`(+spec), `media-url-cache.ts`(+spec),
`service-sheet/*`, `service-row/*`, `service-card/*`);
`libs/features/marketing/landing/src/**` except `locations.component.ts`
(`content/landing-content.service.ts`(+spec), `landing-content.ts`,
`shared/catalog-navigation.service.ts`(+spec) — the landing's, the only file
of that name (`find libs -name 'catalog-navigation.service*'`),
`pages/home/home.page.html`/`.ts` (the `openBarber($event.id)` producer),
`team-showcase/*`, `sections/services/service-tile.component.ts`,
`testing/landing-catalog.ts`, `testing/test-catalog.providers.ts`);
`libs/features/client/booking/src/lib/services-step/*` (catalogue lines),
`bag-sheet/*`, `review-step/booking-review-step.ts` (`barberName` typing
only if W1-B left a raw param); `libs/features/client/onboarding/src/lib/client-onboarding/*`
(the id twins and the catalogue VM reads); `staff-dashboard.ts` lines
`:1316-1321`, `:1866-1905` (labels through `price(money)`).
**Brief:** M-6, I-32, M-7, F-9, §2.7. DEP-19: `formatCents` with the
stored currency (identical for EUR: prove bg and en bytes for `content.locale()`
vs `formatCents`'s locale on a 2800-cent and a 1450-cent price — if the
locale strings differ, keep the catalogue's locale argument); the landing's
authored shelf stays literal through its own input type; redundant id
parses go; the twins collapse; the landing's `CatalogNavigationService`
barber signal is `BarberId | null` and `openBarber(barberId: BarberId)`
(I-32), its producers (`team-showcase`'s `BarberItem.id`, the home page's
`barberSelected` `BarberVm.id`) branded in the same package.

### W2-U — narrowing the shared formatters and the DS pickers · wave 2

**Files:** `libs/ui/wall-clock/src/lib/wall-clock.ts`(+spec);
`libs/features/client/booking/src/lib/booking-wall-clock.ts`(+spec);
`libs/ui/controls/src/lib/month-picker/*`, `weekday-picker/*`;
`libs/ui/patterns/src/lib/date-badge/date-badge.spec.ts`;
`apps/showcase/src/app/pages/controls/menu/menu.page.ts`/`.html`.
**Brief:** F-12, F-13, N-8, §2.13. Every raw production caller was branded
in wave 1 — a residual raw caller is a wave-1 miss: report it to G rather
than widening back. The `wall-clock.spec.ts` `'JPY'`/`'USD'` cases are
re-expressed with `Currency.parse` where the currency is a known one and the
unknown-currency case dropped on purpose (listed in §4.2).

### W3-T — tidy: transitional names, import re-points, `Locale`, `timedRead`, e2e support · wave 3

**Files:** every file still importing a transitional name (the §1.11 scan
re-run after wave 2 — list them in your note before editing); every
transitional alias in ecs-core (delete); every ecs-core declaration marked
`pass D transitional (narrow)` (`grep -rn "transitional (narrow)" libs`,
e.g. `visit-draft.system.ts`, `grid-layout.system.ts` — narrow); `libs/shared/view-state/src/lib/timed-read.ts`(+spec)
and its index; `admin-rhythm.store.ts`/`client-card.store.ts` (`timed` →
`timedRead`); the `Locale` sites of F-15 (`provide-i18n.ts` + index,
`language.service.ts`, `locale-theme-toggle.component.ts`,
`site-menu.component.ts`, `app-chrome.service.ts`, `client-card.format.ts`,
`admin-rhythm-sheet.ts`, `admin-rhythm.ts`, `client-onboarding.ts`) and
NEW `intlLocaleOf`; `apps/web/e2e/support/*` and the two e2e specs of F-14.
**Brief:** delete every `@deprecated pass D transitional` name; zero left
(§5 item 1); narrow every ecs-core parameter/field marked `pass D
transitional (narrow)` (D-12.7 (a) — the `VisitDraftSystem`/`GridLayoutSystem`
parameters and any track struct a feature builds) to its brand once the
grep shows every caller branded (a residual raw caller is a wave-1/2 miss:
report it to G rather than widening back); `verify-tools:layering` green
(one home tier per name).
`Locale` + `Tag` replace `CardLocale`, `SupportedLang`, `isSupportedLang`
and the `'en'` checks; one BCP-47 table. `timedRead(read, budgetMs,
timers)` keeps both stores' semantics (the timer set, the throw path).
e2e support: one zone source through `ZonedTimeSystem`, `BusyKey.of` — same
values (G runs e2e).

### W3-G — lint guards · wave 3

**Files:** `tools/lint-rules/ecs-syntax.mjs`(+spec) (the exported L3 name
pattern, the widened selector, the `export function` ban),
`eslint.config.mjs` (one `no-restricted-syntax` files block over
`libs/features/**` and `libs/ui/**`, wiring only),
`tools/lint-rules/ecs-core-base-paths.spec.mjs` (the canary cases). No new
rule file (D-13.1 reuses L3).
**Brief:** D-13 — reuse `ECS_RAW_PRIMITIVE_RESTRICTIONS`' pattern (widened
to interface members, `Ms`/`today`/`dayKey`/`todayKey` added, the D-3
allowlist as a `:not(...)` clause, `Minutes` only if zero hits);
canary-proven under both ESLint base paths; zero hits on the integrated
tree or not wired; the `export function` ban in `*.data.ts`.

### G — integrator · wave 4

After wave 0, before its gate: sort each wave-0 barrel once and delete
any unfilled placeholder with its line (D-12.1). After each wave: `rm -rf
dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache`, `lint`,
`test` (layering only after W3-T). After wave 3:
§5, the FULL gate (§6.2), §6.3, §6.4, §9.

---

## 4. Specs

### 4.1 New and extended specs (wave 0)

- **Primitives (W0-P):** `TrackMinute` (constructor range, `plus`, `span`,
  `toStart`/`toEnd` at 0/1439/1440/1455), `MinuteOfDay.parseClock`
  (trimmed input accepted; round trip `parseClock(formatClock(m, WRAP)) ===
m` for every minute 0…1439, asserted in `wall-clock.spec.ts` where both
  are importable), `formatClock` both closings (`wall-clock.spec.ts`),
  `UtcEpochMs.EPOCH`, `MinuteDelta.fromDuration`/`negate`, the widened
  `MinuteDelta.between` (an `EndMinute` operand),
  `DraftPersonKey` (every constructor's spelling, `accountOf` ported from
  `accountKeyOf`'s cases), `Tag` (`values` order, `has` on members/non-members/
  non-strings, `or`). Purity (same input → same output, inputs unchanged).
- **Components:** each split file keeps its spec cases (moved with the
  name); `Roles` (the parity spec reads the same arrays from `Roles.*`),
  `BookingFlowState.isTerminal` (guard narrows; agrees with
  `BookingFlowSystem.isTerminal` on all six steps), `StaffVerb.didNotHappen`
  (six verbs), `TimeCoordinate.instantAt` (the folded `seatStartUtcMs`:
  its four cases re-spelled with identical expectations; an `EndMinute`
  operand; `endUtcMs` unchanged on every existing case; Sofia 2026-03-29
  and 2026-10-25 straddles documented), `StaffEditDraft` (every property
  required — a type-spec line rejects an omitted `revision`/`drawn`/
  `typedPriceCents`), `WallTime.toLocalIso`, `NormalizedRanges.normalize` (the
  interval-set cases move with it), `BookingDraft` restore (every existing
  draft fixture byte-identical; a corrupted contact restores `null`).
- **Errors:** `MoveRefusal` factories, `ENGAGEMENT_VOUCHER_CODE_DUPLICATE`
  (DEP-18), `StreakPublishError.guard` (the two codes outside its union are
  no longer narrowed), `IdentityError.birthDatePartial`, `HttpsStatus`.
- **Systems:** `StaffEditPlanSystem` — every save/undo/REPRICE/serial
  placement/subject/ladder/discount/voucher case of `staff-dashboard.spec.ts`
  ported with byte-identical command arrays and `JSON.stringify` equality,
  plus the two refusals (`startMinutes`/`atMinutes`) at a track start of
  1440 and an end of 1445; `tipSeat`; `bookingRequest`.
  `GridLayoutSystem.laneGaps` gains `lane-gaps.spec.ts`'s minute cases not
  already pinned (split at now, the elapsed hole kept, the cross-day case
  restated on minutes). `DiscountSystem.isOffered`.
  `ProgramsSystem.isEnrollmentOpenOrUpcoming` (moved cases).
  `VisitStorySystem.seatPersonKey` answers `SeatKeyText` (cases unchanged).
- **Pipelines:** `saveTeamNote` (the record built by the shared builder:
  `{ id, text: storedNote(text), authorUserId, writtenAtUtcMs }`, key order
  unchanged); `saveOwnProfile` (the same refusals as structs).

### 4.2 Existing specs — UNCHANGED except these classes (each listed in the package's §9 note)

1. **Import/wiring lines** (moved names, `@core/errors` re-points).
2. **Type-forced fixture edits** — a literal that no longer fits its field's
   type gets its brand constructor and nothing else (and a commit fixture
   that omitted `revision`/`drawn`/a leg's `priceCents` gains the explicit
   `null` of the now-required field, §2.12 — `staff-dashboard.spec.ts`,
   `staff-visit-editor.spec.ts`; the time-coordinate spec's
   `seatStartUtcMs(visit, { startMinutes })` calls re-spelled
   `instantAt(visit, minute)`): `staff-time-grid.spec.ts`
   (87 `startMinute` + 87 `endMinute` → `trackMinute()`),
   `staff-timeline.spec.ts` (13), `grid-gesture.spec.ts` (Short slice),
   `staff-visit-editor.spec.ts` (the `visit()` base `:317-400`, ~17
   `appointmentId`, 14 `seatId`, 5 `clientUserId`, 32 client options gaining
   `email: null` where absent, `nowMinute`/`todayKey` → `now`, `priceCents`,
   `availableMinorUnits` → `availableCents`, `takenAtUtcMs`, `arrivedMinute`,
   leg `minutes`, the `uiViewer` input `:7154`), `staff-dashboard.spec.ts`
   (37 `appointmentId`, 24 `seatId`, 13 `dayKey`, 7 `clientUserId`, the
   `uiViewer` expectation `:6686` → `{ userId, roles }`, the `whenLabel`
   fixture `{live,startMs,endMs}` `:1666-1690` → `startUtcMs`/`endUtcMs`,
   the commandsFor/rowShape `later = {…row, startMs: …}` tests `:5568-5629`,
   `:5700-5730` → minute fields, `'block:niko:0'` `:7380` and any id built
   from a block → `block:<barber>:<localDate>:<startMinutes>` per DEP-11),
   `staff-block-editor.spec.ts`, `block-repeat.spec.ts`,
   `staff-day-pill.spec.ts`, `lane-geometry.spec.ts`, `client-query.spec.ts`,
   the client card's `testing/client-card.fixtures.ts` (21 raw ids; `sofiaIso`
   `:193-198` and its three legs → `context.start`), `client-pages.vm-fixtures.ts`,
   `achievements-pages.rig.ts`, every client-card presenter spec passing a
   raw `today`/`nowMs`, `shared/visits` `testing/visit-fixtures.ts`,
   `visit-row.presenter.spec.ts` (waitlist `today`, `currentAppointmentId`),
   `visit-card.presenter.spec.ts:602`, `visit-row.spec.ts:456/624`,
   `day-range.spec.ts`, `landing-catalog.ts:95` (major → cents VALUES),
   `test-catalog.providers.ts:99-138`, `service-detail-sheet.component.spec.ts:69-282`,
   `service-row.component.spec.ts:36-40`, `wall-clock.spec.ts:55/81-100/219`,
   `booking-wall-clock.spec.ts:18-21`, `month-picker.spec.ts`,
   `date-badge.spec.ts`, `booking-flow.store.spec.ts:1044-1046/1768/1778`
   (`result.error` → the struct), `booking-flow.data.spec.ts:61-80`,
   `booking-flow-dictionaries.type-spec.ts`, `move.system.spec.ts:1218-1232`,
   `booking-words.spec.ts:46-48`, the auth/onboarding flow data/system/store
   specs (`error: string` → struct), `save-own-profile.pipeline.spec.ts`,
   `profile.store.spec.ts`, `client-profile.spec.ts`, `client-onboarding.spec.ts`,
   `client-auth.spec.ts`, `admin-rhythm.store.spec.ts` (`'timeout'`/`'threw'`
   → the struct), `admin-rhythm.preview.spec.ts`, `admin-rhythm.words.spec.ts`,
   `edge.spec.ts:1180` (`startedAtUtcMs`), `lazy-port.spec.ts`/`lazy-port.forms.spec.ts`
   (`LazyMethod` values; the forms spec's expected literal types),
   `tools/flags/feature-flags.manifest.spec.mjs`.
3. **Internal-literal edits** (D-2: no observer): `staff-dashboard.spec.ts:5831`
   `discardPending` `'visit'` → `DiscardTarget.Visit`; `client-card.store.spec.ts`
   `barTitle` words → `ClientCardPage` members; any spec driving
   `togglePicker`/`openPhotoDoor`/`setTimingMode`/`discountKindPicked` with
   a literal.
4. **Unrepresentable on purpose** (the raw input can no longer be typed):
   `admin-rhythm.store.spec.ts:1252` `it.each(['', 'утре', '2026-13-40',
'28.09.2026'])` (the picker can no longer hand a non-day — the refusal is
   now the route/picker edge's, pinned there), `admin-rhythm.preview.spec.ts:637-641`
   (`'someday'`), `wall-clock.spec.ts`'s unknown-currency `'JPY'` case.
5. **Deleted with their subject**: `lane-gaps.spec.ts` (cases ported, §4.1),
   the spec cases of `sampleRhythmFacts`/`sampleRhythmRun` (restated on
   `StreakPreviewSystem`), `day-availability.spec.ts` /
   `rhythm-service-groups.spec.ts` alias cases if W3-T finds them covered
   (pass C §9.6 carried — fold or delete, never lose a case).

### 4.3 Spec cases by DEPARTURE (the complete list; clocks pinned, never the wall clock)

All Sofia cases use a memory clock (`pinnedNowUtcMs`/the dashboard spec's
clock double) at an exact instant with an offset in the ISO
(`utcMs('2026-10-25T03:10:00+02:00')` = the SECOND 03:10).

| DEP               | Spec file                                                                                                                                              | Cases (before → after asserted)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEP-1             | `staff-dashboard.spec.ts`                                                                                                                              | visit 03:00–03:30 on 2026-10-25 at `03:10+02:00` → `data-live` set; at `03:10+03:00` (first pass) live as before; an ordinary-day live case unchanged                                                                                                                                                                                                                                                                                                               |
| DEP-2             | `staff-dashboard.spec.ts`                                                                                                                              | visit 03:45 at `03:10+02:00` → `data-next` on it; and an ORDINARY-day pin that the lane order is kept: party A (envelope 10:00, this barber's seat 11:00 — a sequential second leg) and party B (seat 10:30) at 10:15 → `data-next` on A, before and after                                                                                                                                                                                                          |
| DEP-3             | `staff-dashboard.spec.ts`                                                                                                                              | visit 03:00–03:30 at `03:40+02:00` second pass: `data-past` set (end 210 ≤ 220); at `03:10+02:00`: `data-past` NOT set (was set — ended in the first pass); a block 03:00–03:30 the same                                                                                                                                                                                                                                                                            |
| DEP-4             | `staff-dashboard.spec.ts`                                                                                                                              | the fixture's 09:00 group at the pinned `09:00:00.000` clock: `data-past` now SET and the now line after it (edited on purpose); a `09:00:30` clock: identical before/after (production parity)                                                                                                                                                                                                                                                                     |
| DEP-5             | `staff-dashboard.spec.ts`                                                                                                                              | the agenda heading id `agenda-time-540` and its `aria-labelledby`                                                                                                                                                                                                                                                                                                                                                                                                   |
| DEP-6             | `staff-dashboard.spec.ts`                                                                                                                              | search hits at a second shop in another zone (fixture location with `timeZone: 'Europe/London'`): order by wall clock, `past` by that shop's clock, the when label from the visit's own day/minute; PRE-ZONE pin (store zone `null`, no catalogue zone): `past` false and the when label `''`, before and after                                                                                                                                                     |
| DEP-7             | `staff-dashboard.spec.ts`                                                                                                                              | «Скорошни»: a 03:40 visit at `03:10+02:00` on 2026-10-25 excluded; a visit at a London shop ordered/labelled by its own wall clock; a visit starting exactly at the pinned ms-0 instant now INCLUDED; a visit starting between the store's last tick and a later fresh clock (tick `09:59:30`, clock `10:00:10`, start 10:00) → excluded until the next tick (was included); PRE-ZONE pin: no zone known → past visits listed as today (stamp rule) with `''` dates |
| DEP-8             | `staff-dashboard.spec.ts`                                                                                                                              | 2026-03-29 visit 02:30–04:30 booked for 120 → no tag (was «−60 мин»); 2026-10-25 visit 03:30–04:30 booked for 60 → no tag (was «+60 мин»)                                                                                                                                                                                                                                                                                                                           |
| DEP-9             | `staff-dashboard.spec.ts`                                                                                                                              | block 02:00–05:00 opened on 2026-10-25 → sheet end 05:00 (was 06:00); on 2026-03-29 → 05:00 (was 04:00)                                                                                                                                                                                                                                                                                                                                                             |
| DEP-10            | `staff-dashboard.spec.ts`, `lane-geometry.spec.ts`                                                                                                     | a roster window from 03:30 on 2026-03-29 drawn and labelled 03:30 (was 04:00); `rosterHull`/`rosterExtent` follow                                                                                                                                                                                                                                                                                                                                                   |
| DEP-11            | `staff-time-grid.spec.ts`, `staff-dashboard.spec.ts`                                                                                                   | block event ids `block:<barber>:<localDate>:<startMinutes>`; `openBlock` finds the anchor day's block by minutes; WEEK view: a tap on a block of a NON-anchor day, where the anchor day has a block for the same barber at the same minute, opens nothing (as today)                                                                                                                                                                                                |
| DEP-12            | `staff-dashboard.spec.ts`                                                                                                                              | `whenLabel` on an ordinary day unchanged (same phrase); a chair at a London shop: the phrase from the stored instant                                                                                                                                                                                                                                                                                                                                                |
| DEP-13            | `staff-day.store.spec.ts` (or the dashboard spec)                                                                                                      | `?day=2026-02-30` and `?day=2026-13-01` → today, unchosen, `day` published `null`; `?day=2026-10-25` unchanged                                                                                                                                                                                                                                                                                                                                                      |
| DEP-14            | same                                                                                                                                                   | `?barber=a/b` and `?barber=%20` (blank) → scope `null` at once; final URL as today                                                                                                                                                                                                                                                                                                                                                                                  |
| G-1 (pin, no DEP) | `staff-day.store.spec.ts` (new — none exists on `cf91b43`) or `staff-dashboard.spec.ts`                                                                | silence: no `?view=` with a stored `'week'` → the view stays week and the URL states `view=week` (localStorage unchanged); `?view=month` → agenda, URL corrected                                                                                                                                                                                                                                                                                                    |
| DEP-15            | `client-card.presenter.spec.ts`, `achievements.presenter.spec.ts`, `medal-detail.presenter.spec.ts`                                                    | draft start 2027-03-28 03:30 (gap) on today, visit open → `isInChairToday` true and the draft legs count (were dropped); 2026-10-25 03:30 → unchanged; card zone known, editor zone null → legs count (were dropped)                                                                                                                                                                                                                                                |
| DEP-16            | `icon-manifest.spec.ts`, `icon-resolver.spec.ts`, `icon-registry.service.spec.ts`, `icon.spec.ts`, `logo.spec.ts`, `no-generic-discriminator.spec.mjs` | a v1 `kind` document rejected whole (`schemaVersion 1 is not supported (this build reads 2)`); a v2 `iconAsset` document parses; the console line `'[ui-icon] source-failed (source): offline'` unchanged                                                                                                                                                                                                                                                           |
| DEP-17            | `onboarding-flow.store.spec.ts`, `client-onboarding.spec.ts`                                                                                           | a save re-judged too old across midnight: bg and en lines print `120` (was the empty `{{maxAge}}`); too young prints `16`                                                                                                                                                                                                                                                                                                                                           |
| DEP-18            | `voucher-code.data.spec.ts`                                                                                                                            | a repeated code → `ENGAGEMENT_VOUCHER_CODE_DUPLICATE { attempted }`; the wire's `voucherCodesOf` still `null` (booking wire spec unchanged)                                                                                                                                                                                                                                                                                                                         |
| DEP-19            | `service-row`/`service-detail-sheet` specs, `catalog.presenter.spec.ts`                                                                                | EUR prices byte-identical in bg and en; a service fixture in `BGN` prints «лв.» (was «€»)                                                                                                                                                                                                                                                                                                                                                                           |
| DEP-20            | `staff-edit-plan.system.spec.ts`                                                                                                                       | the ported REPRICE cases identical; if W0-S finds a pair of cents with equal labels (or a label that does not parse back), that pair as its own case                                                                                                                                                                                                                                                                                                                |
| DEP-21            | `staff-visit-editor.spec.ts`                                                                                                                           | EUR bill words identical; a `BGN` seat's bill words follow the seat                                                                                                                                                                                                                                                                                                                                                                                                 |
| DEP-22            | `minute-of-day.primitive.spec.ts`                                                                                                                      | `10:30x` and `10:30:00` refused (the editor's old parser accepted them; unreachable through `ui-time-field`); `' 10:30 '` ACCEPTED (both old parsers trimmed — unchanged)                                                                                                                                                                                                                                                                                           |
| DEP-23            | `booking-services-step.spec.ts`, `booking-contact-sheet.spec.ts`                                                                                       | a rename refusal / a contact-save refusal shown in bg, then the language switched to en → the en line prints (was: the bg line stayed until the next set); the line in the raising language is byte-identical                                                                                                                                                                                                                                                       |

---

## 5. Leftover checklist (G, after wave 3; `grep -rn` over `libs apps tools`, specs excluded unless named)

```bash
# 1. Transitional names — expect 0:
grep -rn "pass D transitional" libs apps tools
# 2. Raw brand fields in VMs/contracts/stores/presenters — every hit reviewed (allowlist D-3/D-13 only); W3-G's lint is the gate:
grep -rnE "(Id|Ids)\??: (readonly )?string(\[\])?|(UtcMs|Ms)\??: number|Cents\??: number|(today|dayKey|todayKey|localDate)\??: string" libs/features libs/ui --include='*.vm.ts' --include='*.contracts.ts' --include='*.store.ts' --include='*.presenter.ts'
grep -rnE "(Minute|Minutes)\??: number" libs/features --include='*.ts' | grep -v spec      # every hit: pixel geometry (D-2.13) or a counted figure, reviewed
grep -rnE "\bstartMs\b|\bendMs\b|\bnowMs\b|\bwhenMs\b|\barrivedMs\b" libs/features --include='*.ts' | grep -v spec   # expect 0 (stamps are *UtcMs)
# 3. Casts to a brand outside its own file — expect 0 (the primitive/data file's own casts excluded; specs excluded;
#    an index read `xs[i] as Brand` is EXCLUDED on purpose: it strips the `undefined` that noUncheckedIndexedAccess
#    adds — a narrowing, not a widening; ~59 such sites on cf91b43, e.g. capacity.system.ts:177, standing.system.ts:654):
grep -rnE " as (AppointmentId|BarberId|LocationId|ServiceId|UserId|CustomerId|SeatId|LocalDate|MinuteOfDay|EndMinute|TrackMinute|UtcEpochMs|PriceCents|Currency|DurationMinutes|Email|E164|DraftPersonKey)\b" libs apps | grep -v '\.primitive\.ts\|/primitives/\|e164.data.ts\|email.data.ts' | grep -v spec | grep -vE '\]\s+as '
grep -rn "as string" libs/features --include='*.ts' | grep -v spec                        # every hit reviewed (no id widening)
# 4. Defect re-branders and second zone engines — expect 0:
grep -rnE "utcMsOf|utcEpochMsOf|billCentsOf|drawableCentsOf|localDateOfKey|wallClockInstant|DAY_FRAMES|instantOn|shopIsoOf|cardDayOf|function dayOf|function localDateOf|localDateOrNull|seatStartUtcMs|zoneOfShop|toMajor|formatPrice\b|formatPriceCents" libs apps
grep -rn "ZonedTimeSystem.shopNow" libs/features/staff/dashboard --include='*.ts' | grep -v 'spec\|staff-day\.store\.ts'    # expect 0: the staff day's ShopNow is derived at its store edge only (D-6.6); the other features' sites (client card, appointments, booking, account) are outside this pass's OQ-14 scope — listed in §9.6 if any reads as a decision
grep -rnE "new Intl\.DateTimeFormat|Intl\.DateTimeFormat\(" libs/features apps/web/src apps/web/e2e | grep -v spec    # every hit: wording through @creativo/ui/wall-clock or a device read (deviceZone) — reviewed
grep -rnE "new Date\(|Date\.now\(|Date\.UTC\(" libs apps/web/src apps/functions/src | grep -v spec    # every hit already allowed by no-ambient-clock (adapters, the clock port) — reviewed
# 5. Bare literals compared at use sites in the converted families — expect 0:
grep -rnE "=== '(agenda|day|three-day|week|visit|create|view|scope|map|list|duration|end|camera|upload|system|positions|courses|events|upcoming|past|calendar|stricter|switchOff|switchOn|discard|observable|promise|idle|checking|unknown|already|nothingLeft|promo|coupon|percent|amount)'" libs/features apps/web/src libs/infrastructure --include='*.ts' --include='*.html'
grep -rnE "snapshot: '|snapshot === '|\.loaded\b|kind: '(vector|material|image)'" libs
# 6. Error state as codes — expect 0:
grep -rnE "signal<string \| null>" libs/features --include='*.ts' | grep -iE "error|refus"
grep -rnE "Result\.err\('(timeout|threw|[a-z]+)'\)" libs apps
# 7. Dictionaries / error unions outside their homes — expect 0:
grep -rnE "^export const [A-Z][A-Za-z]+ = \{$" libs/ecs-core/src/systems libs/ecs-core/src/pipelines libs/ecs-core/src/ports | grep -vE "System = \{|AgeWindow|OtpLimits|NameRule|Callables"   # NameRule: a system constant (D-14), not a tag dictionary
grep -rnE "^export type [A-Za-z]+(Error|Refusal|Failure) =" libs/ecs-core/src --include='*.ts' | grep -v '/errors/\|primitive.error'
grep -rnE "^export function " libs/ecs-core/src/components libs/ecs-core/src/primitives --include='*.data.ts'
# 8. Getters / freeze on data — expect 0:
grep -rnE "^\s+get [a-zA-Z]+\(\)" libs/features libs/ecs-core --include='*.ts' | grep -v '\.component\.ts\|spec'   # review: Angular class getters are legal (the Angular row)
grep -rn "Object.freeze" libs apps --include='*.ts' | grep -v 'spec\|testing\|deep-freeze'
# 9. One name per data file — for each *.data.ts: the exported names are one component + its own field dictionaries (D-7 L-1); the scan of §0 D-7 re-run, every multi-name file reviewed.
# 10. Every new system/companion function has a caller and a spec (TrackMinute.*, MinuteOfDay.parseClock, formatClock (@creativo/ui/wall-clock), DraftPersonKey.*, Tag.*, TimeCoordinate.instantAt (and no seatStartUtcMs left), StaffDayStore.shopNowAt, WallTime.toLocalIso, StaffEditPlanSystem.*, StaffVerb.didNotHappen, DiscountSystem.isOffered, ProgramsSystem.isEnrollmentOpenOrUpcoming, saveTeamNote).
# 11. Layering, no Pick/Omit of a *Ports type, no ../ in ecs-core, no class outside Angular — the lint and layering gates.
```

---

## 6. Integration and gates

### 6.1 Order

1. **Wave 0:** W0-P alone; then W0-I, W0-B, W0-W, W0-S, W0-L, W0-O in
   parallel (X-4 declared). G sorts the barrels and drops unfilled
   placeholders (D-12.1), then: typecheck (fresh `dist/out-tsc`), lint, test
   on the wave-0 tree — the WHOLE tree compiles, no project red by design:
   moves and renames are bridged by transitional names (D-12.2), shape and
   signature changes by D-12.7 (raw-base parameters marked `(narrow)`, or the
   reshape landing with all its consumers — W0-B's `MoveRefusal` chain in
   wave 0, W1-A's identity-flow chain in wave 1). Plus `pnpm nx build web`
   (W0-B touched a template).
2. **Wave 1:** W1-S1, W1-S2, W1-S3, W1-K, W1-B, W1-A, W1-R, W1-F, W1-U in
   parallel (X-1…X-3 declared). G: typecheck, lint, test, `pnpm nx build
web` (templates).
3. **Wave 2:** W2-CK, W2-M, W2-U in parallel. G: the same.
4. **Wave 3:** W3-T, W3-G in parallel. G: `verify-tools:layering` must be
   green now.
5. **Wave 4 (G):** §5, the FULL gate, §6.3, §6.4, §9.

### 6.2 The gate (HANDOFF §4, unchanged)

```bash
pnpm nx sync:check
pnpm nx run verify-tools:layering --skip-nx-cache
rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache
pnpm nx run-many -t lint
pnpm nx run-many -t test --parallel=3          # re-run staff-dashboard / staff-client-card / marketing-landing alone on timeout
pnpm nx test ecs-core --coverage               # statements stay ≥ 98.00 %
pnpm nx typecheck seed-tools
pnpm nx build web && pnpm run verify:bundle    # initial ≈ 600 kB; growth beyond ~+3 kB gets a reason in §9
pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
# runbook §4.0, §4.2–§4.5, §4.7, §4.8, §4.9 grep gates — never while a typecheck/lint/test runs;
# §4.9 gates 4/5a re-worded by W1-U for DEP-16; retired spellings stay banned in spec/seed parameter names
# ONE AT A TIME:
pnpm run verify:p0
pnpm run test:emulator                         # 65 + 253
pnpm run e2e:web                               # exactly the 19 baseline failures, 41 passed
```

Baselines: typecheck of `patterns` only (`section-header.spec.ts`
`findLast`); `gauge.spec.ts` (4), `visit-pills.spec.ts` (1),
`visits-page.presenter.spec.ts` "strikes an hour that did not happen" (1);
e2e 19 (6 `*-screenshots`, `landing.spec.ts:121`, 12
`client-card-glance.spec.ts` runs of `:343`/`:686` failing at
`:384`/`:765`); `appointments.spec.ts:152` and the landing-screenshots hero
may flake under load — re-run alone:
`START_LOGGING_EMULATOR=true pnpm exec firebase emulators:exec --only firestore,auth,functions,storage --project demo-creativo-test "pnpm nx e2e web -- e2e/<spec> --repeat-each=3"`.
Test count: 11,922 (pass-C tree) + the new cases − the deleted (`lane-gaps.spec.ts`,
the rhythm delegates', the unrepresentable `it.each` rows — each counted in
§9); a drop without a §4.2 reason is a lost case.

### 6.3 DOM differential (G)

Against `git archive cf91b43 | tar -x -C <scratch>/base` (no worktree, no
checkout), for every touched project (`staff-dashboard`,
`staff-client-card`, `shared-visits`, `shared-catalog`, `shared-shell`,
`client-booking`, `client-appointments`, `client-account`,
`client-profile`, `client-onboarding`, `client-auth`,
`client-account-state`, `admin-loyalty`, `admin-programs`,
`marketing-landing`, `marketing-events`, `marketing-courses`, `ui-icons`,
`ui-controls`, `ui-wall-clock`), pass C's method (§6.3 there, "as run"):

1. A scratch Vitest WRAPPER config per side and project (scratchpad only)
   imports the project's `vite.config.mts`, appends a capture setup file
   that records `fixture.nativeElement.outerHTML` after each
   `detectChanges()` and `whenStable()`, keyed by test name (last wins),
   and relaxes `server.fs`; verify on one known spec that the capture is
   non-empty.
2. Run each project's specs on both trees (`pnpm exec vitest run --config
<scratch>/<side>-<project>.vite.mts`; the base copy borrows
   `node_modules` by symlink; install nothing).
3. Normalise (`_ngcontent-*`, `_nghost-*`, `ng-reflect-*`, generated ids,
   comment anchors, `ui-confetti__particle`) and diff by `file > test name`.
   Specs whose FIXTURE literals changed type only (§4.2.2) render the same
   values — they must diff clean.
4. Differences allowed ONLY in the §4.3 tests and in DEP-only new tests:
   DEP-1/2/3's `data-live`/`data-next`/`data-past`, DEP-4's agenda
   `data-past` and now-line position at the pinned ms-0 clock, DEP-5's
   `agenda-time-<minutes>` ids, DEP-6/7's hit and «Скорошни» rows, DEP-8's
   tag, DEP-9's sheet end, DEP-10's boundary minutes, DEP-11's
   `data-event-id`, DEP-15's card counts, DEP-17's birthday line, DEP-19's
   non-EUR price, DEP-21's non-EUR bill. Anything else is a regression —
   find the code, never the spec.

### 6.4 Dev-stack smoke (G, against a HEAD copy of `cf91b43`)

Emulators up, `pnpm run seed:dev`, the integrated tree and the `cf91b43`
copy served on the same emulators; staff sign-in by custom token for
`dev-staff-ivan` + `window.__e2eSignIn`; record each screen's DOM signature
(text + `data-*` of the region) in bg and en; diff.

1. **Staff day grid and timeline:** lanes (incl. an off chair), the week
   and three-day views, closed shading, live/next cards, hatched past
   blocks and visits, the day summary and tips line, the drag verdicts
   (short / overlap / outside) on the grid and the timeline, the now line,
   `?day=`/`?view=`/`?barber=` round trips (and a hand-edited `?day=2026-02-30`
   → today, DEP-13).
2. **The agenda:** groups, gap cards (sellable vs elapsed), the now line,
   «Свободно» toggle, the countdown phrases («след 40 мин»).
3. **Search:** a name, a phone (digits), past vs coming order, opening a hit.
4. **The visit editor and its sheets:** verbs, the frame, discounts
   (cards, typed code states, manual percent/amount), vouchers, tip tiles,
   add service (prices and the catalogue total), photos (this year / last
   year title), the client page («Скорошни», search, «Нов клиент»), the shop
   row, the time fields (typed start/end, duration vs end), save receipt and
   «Отмени», create a visit, rebook, the block sheet (repeat page, weekdays).
5. **The booking flow incl. the time sheet:** services and the bag
   (prices), times (`data-start` values identical), review, confirmed and
   waitlisted steps (clock faces), a reschedule link and a broken one
   (`?reschedule=bad/id` → refused, never bookable).
6. **The client card pages:** glance, wallet, loyalty, achievements and
   their categories/details, history paging, records, ledger, photos; the
   in-chair state from the editor.
7. **Client appointments and account:** list and calendar (`data-day-key`),
   the sheet, `?visit=`, `.ics` download bytes; `/account` cards; profile
   and onboarding errors (the birthday line); the OTP screen.
8. **Admin rhythm and programs:** save looser/stricter/switch, the
   too-early and stale answers (same words), the preview, the effective-day
   picker; programs tabs; events tabs.
9. **The landing:** locations (status line, week table, clock faces), the
   services shelf and team prices.

Every signature identical but the DEP rows and the now-label minute.

---

## 7. Risks

- **R-1 — external contracts carrying today's spellings** (D-2/D-8.2): URL
  values (`?day`, `?view`, `?barber`, `?visit`, `?repeat`, `?reschedule`,
  `?waitlist`, `?phase`, `?step`), `data-start` (an instant in ms, read by
  `booking-core.spec.ts:121` — branding is value-neutral; never switch it to
  minutes), `data-day-key`, `data-row-id` (read by
  `client-card-glance.spec.ts:220`), `data-view`, `data-placement`,
  `data-tile-id`, `data-segment-id`, `data-kind`, `data-reason`,
  `data-appointment-id`, the person-key test ids
  (`staff-visit-client-row-<key>` etc. with `primary`/`guest-…`), seat test
  ids (`draft-…`), `staff-visit-peer-<rowKey>`, `staff-visit-service-<option>`,
  `staff-visit-clients-recent`, the localStorage values
  (`staff.schedule.view`, `staff-agenda-fields`, `ui-theme`,
  `creativo.emulator-session`, the booking draft `creativo.booking-draft/v2`
  with its field names), the `.ics` UID and file name, i18n key segments.
  The person key is also the label the server tells guests apart by — its
  spelling is load-bearing.
- **R-2 — template blind spot.** `typecheck` does not see templates; every
  dictionary exposed to a template and every renamed VM field a template
  reads is proven by `pnpm nx build web`.
- **R-3 — `''` sentinels → `null`.** Each consumer's `''` answer must be
  reproduced: `VisitEditorVm.appointmentId` (`isNew` `ve:6390`,
  `cardContextOf` `:6797`, `lastWorkedVisit` `:7290`, reseed `:1584`, the
  draft key `:1868`, `newVm` `sd:5432`, rebook truthiness `sd:5581`, the
  reseed signal `sd:5060`, `uiEditableEventId` html `:1694`), `chairId`
  (`sd:4112`, `ve:7204`), `leg.barberId` (`ve:6766`), `todayKey`
  (`x < ''` is false; `''.slice(0,4)` never equals a year; `Number('')` is
  0), `dayKey` before the zone (the pill read `0000-01-01` through
  `localDateOfKey('')` — with `null` the pill must render what it rendered:
  W1-S1 pins the pre-zone pill), `seatId` (`sd:3604`), viewer `uid`
  (`ve:6798`), `createFromEditor`'s `if (!locationId) return` (`sd:5948`).
- **R-4 — the two-pass effect hazard** (`st:899-913` with the week guards
  `sd:2782`/`:2849`): the `''` → `null` move happens in one edit; memory
  rule "effects never write what they read".
- **R-5 — track minutes are not `MinuteOfDay`.** A draft start may be 1440
  (`VisitDraftSystem.snap`); a commit end may pass 1440 (`commandsFor`
  refuses it with `refusedAt`). Branding them `MinuteOfDay` would refuse
  earlier — hence `TrackMinute` (no upper bound). `ClientCardContext.start.startMinutes`
  is `MinuteOfDay | null` through `TrackMinute.toStart` (1440 → `null`, as
  today's `''`).
- **R-6 — `commandsFor`'s byte-stability.** It runs three times per save and
  the undo compares `JSON.stringify` shapes; any reordering of commands or
  object keys changes the fast path. The system port is line-for-line; its
  spec asserts stringified equality.
- **R-7 — moving dictionaries between tiers** changes many import lines
  (VisitPerspective alone: 35 files); transitional re-exports keep the tree
  compiling and turn layering red until W3-T — G must not run layering as a
  wave gate before wave 3.
- **R-8 — value cycles from splits.** Splitting `cart-line`, `party`,
  `booking-flow`, `seat`, `seat-outcome`, `phone-number` creates sibling
  value edges; layering fails a runtime cycle. Prefer `import type`.
- **R-9 — a precise-instant name clash.** `components/precise-instant.data.ts`
  (the component) vs `primitives/precise-instant.primitive.ts` (the
  `EpochSeconds`/`SubsecondNanos` brands): different names and tiers —
  checked; the barrels must not export one name twice.
- **R-10 — the runbook grep gates** forbid retired document spellings even
  in seed and spec parameter names (`hours:`, `bookedAt`…): rewritten specs
  (the DST cases, the ported lane cases) must not reintroduce them. Only G
  runs the gates.
- **R-11 — heavy specs under `--parallel=3`** (`staff-dashboard`,
  `staff-client-card`, `marketing-landing`) can time out; re-run alone
  before calling a regression.
- **R-12 — `moneyLabel`'s `''` path** (`ve:6024`) for a fractional or
  unsafe number: dropping it needs each of its 11 raw callers proven
  integral ≥ 0 at its edge (W1-S2); otherwise the parse stays at that edge.
- **R-13 — the catalogue locale strings** (`'bg'`/`'en'` vs `'bg-BG'`/`'en-GB'`
  inside `formatCents`): DEP-19 must not smuggle a byte change for EUR —
  W2-M proves both locales print identically or keeps the catalogue's locale.

---

## 8. Open questions (owner) — with the default this plan applies

- **OQ-1** — `TrackMinute` as a brand (a union with `MinuteOfDay`/`EndMinute`)
  vs a documented raw exception for the frames' anchored axis. Default: the
  brand (Law 7.4 names coordinates; ~200 fixture edits accepted).
- **OQ-2** — a stray helper type consumed outside its file becomes its own
  type-only file under its own name (L-2), rather than a namespace member
  every consumer re-spells. Default: own file (zero churn).
- **OQ-3** — the pooled answers (search, «Скорошни») judge each visit on its
  OWN shop's clock (the physical chair invariant); rows/lanes/agenda on the
  day's zone. Default: applied (DEP-6/7 name the cross-zone change).
- **OQ-4** — `ZonedTimeSystem.parseIsoIn`/`toIso` lose their last production
  callers; e2e support and specs still use them. Default: kept; retire with
  the e2e seed in a later pass.
- **OQ-5** — the telemetry `Log` level (`'info'|'warn'|'error'`) as a
  dictionary (values kept). Default: unchanged (`ecs-pipelines.md` quotes the
  signature verbatim — the rules file is the owner's).
- **OQ-6** — a `WindowHours` brand for the cancellation window. Default: raw
  (not a coordinate/amount/id).
- **OQ-7** — `ClientStatsSystem.cadenceOf` averages instant gaps (T8 would use
  `LocalDate` days and change the stored cadence by up to 1/24 day per DST
  gap). Default: unchanged.
- **OQ-8** — the shell's `UiTheme` copy of `libs/ui/tokens` (the boundary
  forbids tokens in features). Default: the documented copy stays; app-chrome
  uses the tokens' guards.
- **OQ-9** — the editor save's ORCHESTRATION stays in the component (pass-C
  D-2.9); only its decisions move to `StaffEditPlanSystem`. Default: applied.
- **OQ-10** — `LoyaltyCatalog` homed in entities (below ports and systems),
  in a non-entity file `entities/loyalty-catalog.ts` (the `collections.ts`
  precedent) together with its eight `Catalog*Ref` bound types and
  `LoyaltyCatalogParts`. Default: applied.
- **OQ-11** — the icon diagnostic codes keep their kebab spellings (a
  printed console contract). Default: kept (no DEP).
- **OQ-12** — the pipelines' `*Error` unions move to errors (Law 1's text:
  "never in a pipeline file"). Default: moved.
- **OQ-13** — the role predicates stay claims-tolerant (`readonly string[]`).
  Default: kept (no DEP).
- **OQ-14** — `E164` stays a component brand with its by-construction `of`
  (13 callers) in its own file. Default: unchanged.
- **OQ-15 (DEP-21)** — the editor's bill words follow the seat currency
  instead of the constant `MONEY_CODE`. Default: the ecs-core rule (identical
  for every EUR visit).
- **OQ-16 (DEP-19)** — the catalogue prices in the stored service currency
  instead of a hard-coded EUR. Default: the ecs-core rule (identical for
  EUR).
- **OQ-17** — `SeatKeyText` carries two spelling families (the cart seat key
  and the party person key `account:`/`guest:`), which `GuestLabelSystem`
  already relies on; this pass DOCUMENTS both in its JSDoc rather than
  splitting a `PersonKey` brand (which would retype `GuestLabelSystem`,
  `VisitStorySystem` and the server's party check). Default: documented,
  not split.
- **OQ-18 (DEP-23)** — the two error lines worded once at set time
  (booking rename refusal, contact-sheet save refusal) re-word on a
  language switch like every other error surface. Default: the reactive
  rule (Law 7.5).
- **OQ-19** — the visit editor's photo titles are worded in `'bg-BG'`
  whatever the language (`ve:5397`/`:5409`/`:5418`). Default: kept (frozen
  pass; routing them through `intlLocaleOf` would change the en words — a
  later pass with a DEP).

---

## 9. Ledger (filled by the integrator)

### 9.1 Per package (files touched, parse/`ofProven` sites with ranges, specs edited with their §4.2 class)

#### W0-P — primitives and test helpers (wave 0)

**Files touched.** `primitives/minute-of-day.primitive.ts` (+spec: `MinuteOfDay.parseClock`; NEW `TrackMinute` type + companion `of`/`ofProven`/`plus`/`span`/`toStart`/`toEnd`), `duration-minutes.primitive.ts` (+spec: `MinuteDelta.between` widened to `MinuteOfDay | EndMinute` on both sides, NEW `fromDuration`/`negate`), `utc-epoch-ms.primitive.ts` (+spec: NEW `UtcEpochMs.EPOCH`), `ids.primitive.ts` (+spec, `ids.type-spec.ts`: NEW `DraftPersonKey` with `PLACEHOLDER`/`account`/`guest`/`minted`/`of`/`accountOf`; `SeatKeyText`'s JSDoc now declares both spelling families, D-3), NEW `tag.data.ts` (+spec: `Tag<D>`, `Tag.values`/`has`/`or`), `booking-status.data.ts` / `locale.data.ts` (+specs: `isBookingStatus`, `LOCALES`, `isLocale` are now `@deprecated pass D transitional` delegates of `Tag` — same answers; W3-T deletes), `primitives/index.ts` (`tag.data`), `testing/test-support.ts` (+spec: NEW `trackMinute(raw)`, `draftPersonKey(raw)`), `libs/ui/wall-clock/src/lib/wall-clock.ts` (+spec: NEW `formatClock(t, closing)` + `ClockClosing { Wrap: 'WRAP', EndOfDay: 'END_OF_DAY' }`; `index.ts` is `export *`, unchanged). NOT touched: `primitive.error.ts` and `apps/functions/src/edge.ts` — `parseClock` reuses `PRIMITIVE_MINUTE_OUT_OF_RANGE` (its `raw` is `string | number`; words «Невалидна стойност.» / "Invalid value."), so no new code and no edge row.

**`ClockClosing` home.** `libs/ui/wall-clock` (D-5, D-11, the W0-P brief); §2.8's table row that names `primitives/minute-of-day.primitive.ts` as its home is superseded. `END_OF_DAY` prints the hours UNWRAPPED (1440 → `24:00`, 1455 → `24:15`) — byte-identical to both END_OF_DAY hand faces on every minute (neither caller hands a minute past 1440 today); `WRAP` prints `t mod 1440`.

**parse / `ofProven` sites.** No production call site is added by W0-P (the constructors are consumed by wave 1). `TrackMinute.span` brands its clamped difference through `MinuteCount.of` + `defect` (two non-negative safe integers: the difference never refuses) instead of a cross-file cast.

**Specs edited (§4.2 class).** Existing expectations unchanged; every edit is an ADDED case: the new members' cases and purity cases (§4.1); DEP-22's pins in `minute-of-day.primitive.spec.ts` (`10:30x`, `10:30:00` refused; `' 10:30 '` accepted); `ids.primitive.spec.ts` ports `visit-draft.system.spec.ts`'s `accountKeyOf` block case for case onto `DraftPersonKey.accountOf`, pins `PLACEHOLDER`/`guest-` to `VisitDraftSystem.PLACEHOLDER_CLIENT_ID`/`GUEST_KEY_PREFIX` and agrees with `accountKeyOf` on every ported key (W3-T re-points those two pin lines when the system's constants retire); `wall-clock.spec.ts` byte-compares `formatClock` with the seven hand faces (copied verbatim as references: `ve` `clockLabel`, `be` `clockLabel`, `gg` `timeLabel`, `tg` now label → `WRAP` on 0…1455; `gg` `hourLabel` → `WRAP` on every whole hour 0…1440; the waitlisted step's `clockFace`, the landing's `clockOf` → `END_OF_DAY` on 0…1455) and round-trips `parseClock(formatClock(m, WRAP)) === m` on 0…1439.

**DEP-22 note for W1-S1/G.** The block editor's old parser (`be:253`) was strict on SHAPE but not on minutes: `9:75` read as `MinuteOfDay.of(615)` (10:15) and `0:99` as 99. `parseClock` refuses minutes > 59 (§2.1). Unreachable through `ui-time-field` (step 300, `HH:mm` only) — pinned as refused in `minute-of-day.primitive.spec.ts`; DEP-22's text should name it beside `10:30x`.

**The wave-0 barrels and placeholders (D-12.1).** One `export *` line per planned new file appended (atomically, per line, skipping a line already present) to `components/index.ts`, `systems/index.ts`, `entities/index.ts`; each file created as `export {}; // pass D placeholder — <pkg> fills` with an exclusive create (never over an existing file). The wave-0 packages ran IN PARALLEL with W0-P (not after it): W0-W had already created and listed `booking-read-snapshot`/`edit-call-outcome`/`move-outcome`/`ledger-verdict.data` (left as found), and W0-I created `roles.data.ts` itself (W0-P added only its barrel line). The "one file per dictionary" splits the plan names without file names are placeholdered under each dictionary's own kebab name (the dictionary whose name equals the old file stays there): `catalog-status` → `service-status`/`barber-status`/`location-status`; `medal-outlook` → its nine dictionaries; `pass-state` → `pass-figure`; `streak-outlook` → `streak-capsule`; `client-history` → `history-note`/`tenure-state`; `coupon-occasion` → `coupon-status`; `policy-recompute-outcome` → `policy-start-outcome`/`policy-step-outcome`/`policy-sweep-outcome`. Conditional splits the plan names only "if consumed outside" (`ReadPhone`, the `seat.data.ts` occupant names) got none — a package that needs one appends its own line. G deletes every placeholder left unfilled, with its line.

- W0-I components: `roles` (created by W0-I), `registration-fields`, `auth-provider`, `auth-deployment`, `auth-flow-event`, `onboarding-flow-event`, `parsed-identifier`, `end-reason-fields`, `e164`, `audit-target-ref`, `placement-action`, `transition-action`, `arrival-action`, `tip-action`, `staff-edit-action`, `profile-action`, `session-readiness`, `route-gate`, `access-target`, `access-verdict`, `access-decision`, `settled-verdict`, `personalize-step`, `profile-completion-key`, `profile-auth-type` (`.data.ts`)
- W0-B components: `shop-reach`, `schedule-selection`, `seat-assignment`, `booking-confirmation`, `waitlisted-summary`, `seat-key`, `booking-cart`, `cart-seat-lines`, `party-member`, `service-variant`, `service-terms-input`, `variant-terms`, `staff-terms-override`, `position-input`, `course-input`, `shop-event-input`, `shop-opening` (conditional, §2.2), `day-hours-input`, `shop-day-hours`, `shift-segment`, `recurrence-pattern`, `recurrence-end-rule`, `service-status`, `barber-status`, `location-status`, `booking-flow-event`, `prefill-companions`, `service-selectability` (`.data.ts`)
- W0-W components (existed, W0-W's own lines): `booking-read-snapshot`, `edit-call-outcome`, `move-outcome`, `ledger-verdict` (`.data.ts`)
- W0-S systems: `staff-edit-plan.system`; components: `visit-sides`, `visit-grain`, `visit-row-outcome`, `visit-filter`, `visit-perspective`, `cancelled-side`, `bill-pending`, `tip-preset`, `client-query-shape`, `grid-event`, `repeat-preset`, `normalized-ranges`, `staff-edit-draft`, `visit-edit-write-outcome`, `seat-occupant`, `chair-geometry`, `seat-catalog-terms`, `seat-core`, `account-seat`, `cancellation-reason-set`, `stood-seat-pairs`, `arrival-verb`, `mark-arrival-action` (`.data.ts`)
- W0-L entities: `loyalty-catalog` (`.ts`); components: `metric-ref`, `award-summary`, `badge-subject-slot`, `season-window`, `streak-rule-input`, `scheduled-streak-rule`, `streak-head-rule`, `streak-phase-state`, `streak-period-reason`, `streak-period-fact`, `streak-period-terms`, `tier-override`, `tier-standing`, `family-scope-filter`, `journal-feed`, `reward-ref-fields`, `grant-ref-fields`, `public-label`, `label-param`, `rule-ref`, `grant-capacity-terms`, `grant-expiry-terms`, `earned-level`, `series-standing`, `medal-caption`, `medal-ring-state`, `medal-meter`, `medal-detail-state`, `medal-progress-card`, `ladder-rung`, `medal-cue`, `scope-section`, `season-track-state`, `pass-figure`, `streak-capsule`, `history-note`, `tenure-state`, `coupon-status`, `streak-standing`, `streak-preview-outcome`, `streak-preview-unavailable`, `streak-standing-counts`, `streak-preview`, `draft-assessment`, `streak-track-mark`, `qualifier-comparison`, `streak-interval-source` (`.data.ts`)
- W0-O components: `precise-instant`, `last-visit`, `next-visit`, `pause-suggestion`, `client-money-stats`, `policy-pass`, `policy-pass-stamp`, `live-policy-line`, `visit-fact`, `visit-leg`, `client-stats-key`, `client-stats-meta`, `doc-path`, `doc-body`, `policy-start-outcome`, `policy-step-outcome`, `policy-sweep-outcome`, `subject-visit-outcome`, `cancellation-attribution`, `stats-write-decision`, `policy-pass-verdict`, `backfill-phase`, `backfill-start`, `attempt-outcome`, `page-step`, `backfill-call-end`, `waitlist-delivery-outcome`, `rounding-mode` (`.data.ts`)

**Gate (W0-P's own files).** ecs-core typecheck (`tsc --build --force`, the scoped equivalent of a clean `dist/out-tsc`, used because the parallel packages share that folder): no error in a W0-P file — the reds are the parallel packages' in-flight files (gamification, identity, visit-story); `ui-wall-clock` typecheck needs ecs-core's emitted declarations, so it was proven from source with a scratch `noEmit` config (no error in a W0-P file); tests: `src/primitives` + `test-support.spec.ts` 259/259, `ui-wall-clock` 28/28; lint: ecs-core 0 errors (no warning in a W0-P file), `ui-wall-clock` clean; `verify-tools:layering` (a)–(d) ok, (e) 27 violations — every one a parallel package's transitional re-export (D-12.2), none a W0-P name or placeholder.

#### W0-I — identity, accounts, governance, roles, audit (wave 0)

**What moved.** NEW `roles.data.ts` (`type Roles = readonly Role[]`; companion `ALL`, `STAFF`, `BOOK`, `MONEY`, `ADMIN`, `SPEND` byte-identical in today's order, plus `isRole`, `known`, `isStaffRole`, `isStaff`, `mayBook`, `seesMoney`, `isAdmin`, `seesClientSpend`, `readsClientWords` — claims-tolerant `readonly string[]` parameters kept, OQ-13); `role.data.ts` holds the `Role` dictionary only. `isRole`/`known` go through `Tag.has`; the grant lists keep one private loop. Lists folded into companions: `Registration.FIELDS` (today's order) + `isField`, `AccountLifecycle.BLOCK_REASONS`, `FeatureFlags.NAMES`, `AuditContext.ACTIONS`, `OtpCode.DIGITS`, `ImpersonationLifecycle.parseScope` — accepted values unchanged. `AuthStrategy.OtpPolicy`/`LinkPolicy`/`Input` and `ParsedIdentifier.ReadPhone` into their namespaces. `AUDITED_PROFILE_FIELDS` an explicit `RegistrationField[]` in today's order (stored audit arrays keep their order); `AuditSystem.changedProfileFields` answers `readonly RegistrationField[]`. Audit fields narrowed with proof: `AuditContext.cancelled`/`transition` and `Cancelled.cancellationReason`/`Transition.transitionReason` are `CancellationReason` (every caller passes a branded value or the member literal `'CLIENT_CHANGED_PLANS'`). Stays as system I/O: `LatchedVerdict`, `PrincipalTag`, `REFRESH_BACKOFF_MS`, `ProfileCompletion`, `ProfileCompletionItem`. Declared for W1-A (D-12.7): `IdentityError.birthDatePartial()` (`IDENTITY_BIRTH_DATE_INVALID`, `attempted: ''`), `AuthFailure`, `OnboardingFailure`, `AccountsError.OwnProfileSave`. Transitional delegates (deleted by W3-T): `USER_ROLES`…`readsClientWords` in `roles.data.ts` (in `role.data.ts` they would have formed a runtime cycle), `RegistrationFields`, `E164`, `ImpersonationEndReason` same-tier re-exports, `parseImpersonationScope`, `SESSION_KINDS`, `OTP_CODE_DIGITS`, `FLAG_NAMES`, `PERSONALIZE_STEPS`.

**parse / `ofProven`.** None added. No DEP; every dictionary value, list order and stored spelling unchanged.

**Specs (§4.2).** Class 1 (imports, expectations byte-identical): `role`, `role.rules-parity`, `registration`, `registration.system`, `auth-strategy`, `auth-flow`, `onboarding-flow`, `identifier`, `impersonation-status`, `impersonation-scope`, `impersonation.system`, `session-kind`, `phone-number`, `account-status`, `feature-flags`, `audit-context`, `session-access.system`, `guest-guard.system`, `onboarding-flow.system`, `profile-completion.system`, `tools/flags/feature-flags.manifest.spec.mjs`. Class 2: `audit-context.data.spec.ts` `cancelled('schedule_conflict')` → `cancelled(CancellationReason.ClientChangedPlans)` (the parameter is `CancellationReason` now; expectation `'CLIENT_CHANGED_PLANS'`). New cases: `identity.error.spec` (`birthDatePartial`), `accounts.error.spec` (`OwnProfileSave`). The `(narrow)` parameters (`AuditContext.profile`'s fields, `ProfileChange.fields`, `planOwnProfileEdit`'s fields) were narrowed to `RegistrationField` by W3-T with their fixtures (§4.2 class 2).

#### W0-B — booking flow, cart, catalogue terms, scheduling components (wave 0)

**What moved.** The catalogue status trio into `service-`/`barber-`/`location-status.data.ts`; `cart-line` → `booking-cart` + `seat-key` + `cart-seat-lines`; `party-member`, `service-variant`, `shift-segment`, `stood-seat-pairs`, `shop-day-hours`, `day-hours-input`, `recurrence-pattern`/`-end-rule`, the program input structs (`position-`/`course-`/`shop-event-input.data.ts`), `booking-flow-event`, `prefill-companions`, `service-selectability` and the other §2.2 splits, names kept. `MoveRefusalReason` folded into `MoveErrorCode` (D-9.2: `MoveRefusal.unavailable/companionsOnly/carriedOutOfReach`, `{ errorCode, locationId }`), with the three inert client-only `MOVE_WIRE` rows (X-4, landed by W0-O). New companion members with callers and specs: `BookingFlowState.isTerminalStep(step)` — the ONE terminal rule (pass C's two spellings; `BookingFlowState.isTerminal` is the type guard over it and `BookingFlowSystem.isTerminal` delegates; the spec proves all six steps agree with the old spine rule) — and `RecurrenceEndRule.of(end)`. `BookingFlowError.reasonCode` narrowed to `SchedulingErrorCode` (both builders pass scheduling codes). Not changed on purpose (shape freeze): `ServiceSelectability.Blocked.by` keeps its unprefixed name (consumers read it).

**parse sites.** `BookingDraft.read` restores `contactEmail` through `Email.parse` (refusal → `null`) and `contactPhone` through `E164.of` (OQ-14: no smart constructor). Range: the draft's e-mail is only ever `BookingContact.create`'s `Email.parse` output or `users.email`, itself written only through `Email.parse`; `Email.parse` returns a canonical address unchanged, so no app-written draft restores differently (spec: a byte-identical present contact; a corrupted e-mail restores as `null`). No `ofProven`.

**Specs.** Class 1 re-points; cases relocated with the splits (`cart-line.data.spec.ts` 24 → `booking-cart` 21 + `seat-key` 3; `catalog-status` 3 → 1 + 1 + 1; `schedule-version` 19 → 10 + `shift-segment` 9; `service-terms` 17 → 10 + `service-variant` 7; `seat-id-pair` 7 → 4 + `stood-seat-pairs` 3; `booking-flow.data` 8 → 7, its `MoveRefusalReason` case → `move.error.spec.ts`; `party.data` 26 → 25 + `party-member.data.spec.ts`; `placement-policy` 6 → 4 + the terms-override file; `roster-window` 2 → 1 + `shop-day-hours`). New: the `isTerminalStep` agreement case, `RecurrenceEndRule.of`, `BookingDraft` restore cases.

#### W0-W — the booking write side (wave 0)

**What moved.** NEW `booking-read-snapshot.data.ts` (`BookingReadSnapshot` `REPLAY`/`REFUSED`/`LOADED`/`UNCHANGED`, field `bookingReadSnapshot`, D-8.3), `edit-call-outcome.data.ts` (`EditCallOutcome`, field `editCallOutcome`; the name `EditOutcome` is the edit system's), `move-outcome.data.ts`, `ledger-verdict.data.ts`; the seven booking error unions homed in `errors/booking.error.ts` (OQ-12; W1-F re-pointed `booking.wire.ts`). `MinuteDelta.fromDuration` replaces `MinuteDelta.of(d)` + defect (same value for every positive duration). Transition's `ShopNow['utcEpochMs']` spelled `UtcEpochMs`. No pipeline had a `nowUtcMs: number` command field (each reads `ports.nowUtcMs()`).

**parse / `ofProven`.** None. No DEP: `bookingReadSnapshot`/`editCallOutcome` are internal to the transaction; no runtime value, wire answer or stored field changes.

**Specs.** Class 1 import lines (`appointment-edit.system.spec.ts`) and the dictionary type-spec additions.

#### W0-S — staff: visit list/story/draft, grid, query, billing, seats, the edit plan (wave 0)

**What moved.** The "system-file dictionary family" to components (pass C's D-7 exception landed): `VisitSides`, `VisitGrain`, `VisitRowOutcome`, `VisitFilter`, `VisitPerspective`, `CancelledSide`, `BillPending`, `TipPreset`, `ClientQueryShape`, `GridEvent`, `RepeatPreset`, `NormalizedRanges` (+ `normalize`, O(n), canonical sweep outputs returned as they are), `ArrivalVerb`, `MarkArrivalAction`; `seat.data.ts` split (`seat-occupant`, `account-occupant`, `account-seat`, `seat-core`, `seat-catalog-terms`, `chair-geometry`), `cancellation-reason.data.ts` (the dictionary both `seat-outcome` and `cancellation-reason-set` read). NEW `StaffEditPlanSystem` (§2.12: `commandsFor`, `tipSeat`, `bookingRequest`, `snapshotCommitOf` — pass C's D-11 write plan) and `staff-edit-draft`/`visit-edit-write-outcome` components (`STALE` / `BATCH_REFUSED` / `WRITTEN` + `sidesWritten`, D-10.1). `TimeCoordinate.instantAt(time, minute)` folds `seatStartUtcMs` (D-6.5; W3-T re-pointed `tools/seed/loyalty.mjs` and `seed-data.spec.mjs`). `VisitStorySystem.PersonSubject` folded (`personKeyOf` reads the stored occupant).

**DEP-20 (REPRICE on cents).** `formatCents` is injective per currency and locale, so EUR answers are unchanged; two cases change: (a) a BGN/USD seat in Bulgarian — the old undo snapshot re-priced it at 100× through `parsePriceInput(label)`; copying cents re-prices at the stored cents (pinned: `staff-edit-plan.system.spec.ts` «re-adds a BGN seat at its stored cents»); (b) a language switch between seeding and saving with an unchanged typed price — the old gate sent a no-op `REPRICE`, the new sends none.

**parse / `ofProven`.** `VisitDraftSystem.snap`/`snapUp` → `TrackMinute.ofProven`: the input is a `MinuteOfDay` in [0,1440); rounding/ceiling to the 5-minute grain stays in [0,1440] — never throws. `TimeCoordinate.endUtcMs` composes `instantAt` and no longer clamps an inverted envelope (end < start) to the start — `AppointmentIndexSystem` never stores one, so no stored visit's answer changes.

**Specs.** Class 1 imports; class 2 (`seatStartUtcMs` → `instantAt`, the `PersonSubject` fold); `normalized-ranges.data.spec.ts` pins `IntervalSetSystem.normalize === NormalizedRanges.normalize` (the property cases stay in `interval-set.system.spec.ts` with their fast-check helpers); `lane-gaps.spec.ts`'s six cases were already in `grid-layout.system.spec.ts` (`laneGaps`). The `StaffEditPlanSystem` spec is new (incl. purity).

#### W0-L — loyalty, engagement, rhythm, programs (wave 0)

**What moved.** ONE `LoyaltyCatalog` generic in `entities/loyalty-catalog.ts` with its bound types (D-7.5); the `Gamification` predicates to `MetricRef`/`AwardSummary`/`SeasonWindow` companions; `medal-outlook` (nine dictionaries), `pass-state` → `pass-figure`, `streak-outlook` → `streak-capsule`, `client-history` → `history-note`/`tenure-state`, `coupon-occasion` → `coupon-status`, the streak preview family (`StreakPreview*`, `DraftAssessment`, `StreakTrackMark*`, `QualifierComparison`, `StreakIntervalSource`) to components. NEW `DiscountSystem.isOffered` (enabled and carrying a code — the adapter and the memory double share it; W1-F wired the adapter, W3-T narrowed `ListOpenCoupons` to `OfferedCoupon[]`), `ProgramsSystem.isEnrollmentOpenOrUpcoming`, `StreakPublishError.ANSWERED_CODES`/`isAnswered`/`Failure`, `StreakRule.EXCUSES`/`SHOP_EXCUSES`.

**DEP-18.** `VoucherCode.distinct` answers a repeated code `ENGAGEMENT_VOUCHER_CODE_DUPLICATE { attempted }` (new code, factory, union member); its one caller (`booking.wire` `voucherCodesOf`) collapses every refusal to `null` — callable, wire and UI unchanged; `ENGAGEMENT_WIRE` is uniform (invalid-argument). Specs: `voucher-code.data.spec.ts` (the repeat case), `engagement.error.spec.ts` (new factory case). Also on purpose (plan §4.1): `StreakPublishError.guard` narrows to exactly its seven codes (no longer `INVALID_INPUT`/`STORE_FAILED`, which the web never builds — the adapter maps thrown faults to `RepositoryError`); spec: `streak-publish.error.spec.ts` guard block.

**parse / `ofProven`.** None.

**Specs.** Class 1 re-points across the loyalty data/system/pipeline specs; new cases for `isOffered`, `isEnrollmentOpenOrUpcoming` (moved into `programs.system.spec`), `ANSWERED_CODES`/`isAnswered`, and the transitional delegates (deleted again by W3-T, class 5).

#### W0-O — operations, stats, paging, time, the edge rows (wave 0)

**What moved.** `client-stats.data.ts` split (`precise-instant`, `last-visit`, `next-visit`, `pause-suggestion`, `client-money-stats`, `policy-pass`, `policy-pass-stamp`, `live-policy-line`, `client-stats-key`/`-meta`, `doc-path`/`-body`), the policy recompute trio, `subject-visit-outcome` (+ `SubjectVisitOutcomeState`), `cancellation-attribution`, `stats-write-decision` (`ClientStatsWritePlan.unchanged/write`), `policy-pass-verdict` (`PolicyPassJudgement.superseded/judge`), `backfill-phase`, `backfill-start` (`BackfillStartRequest.resume/top/after`), `attempt-outcome`, `page-step` (`PageStepResult.page/tied`), `backfill-call-end` (`CallEnd` → `BackfillCallEnd`, field `backfillCallEnd`), `waitlist-delivery-outcome` (`RequestOutcome` → `WaitlistDeliveryOutcome`, field `waitlistDeliveryOutcome`), `rounding-mode` — moved unions built through new companion factories with identical key order. `HttpsStatus` homed in `errors/pipeline.error.ts` (all 17 Firebase statuses; `edge.ts` imports it, W1-F). `PreciseInstant.LATEST`/`fromWholeSecond` (W1-F deleted `triggers.wire.ts`'s throwing IIFE). `UtcEpochMs.EPOCH` replaces retention's private EPOCH. `zoned-time`'s private `LocalFit` → `EXACT`/`GAP`/`OVERLAP`, field `localFit` (module-private, never returned or stored). X-4: the three `MOVE_WIRE` rows.

**HttpsStatus parse (no DEP).** `PipelineError.wireStatus` is `HttpsStatus | null`, parsed once in `bareStatus`. The web SDK's `FunctionsError.code` is typed `functions/${FunctionsErrorCodeCore}` (`@firebase/functions` 0.13.5: the same 17), so every status the app receives parses to itself; only an out-of-vocabulary status (never sent) now reads `null` (`errorCode` stays `PIPELINE_UNKNOWN`; `streak-publish.adapter` `failureOf` would answer `unusable` for it). Pinned in `pipeline.error.spec.ts`.

**parse / `ofProven`.** `PreciseInstant.LATEST` from `EpochSeconds.of(MAX_SAFE_INTEGER)` + `SubsecondNanos.of(999_999_999)` (both in range; `defect` never reached). No other site.

**Specs.** Class 1 import lines (`money.data.spec`, backfill/trigger/paging system specs, the run-backfill/continue/project-client-stats/sweep pipeline specs); `client-stats.data.spec.ts` 12 → 1 with its cases moved byte-identical into `precise-instant` (12 → incl. purity), `client-money-stats`, `policy-pass`, `policy-pass-stamp`; new `PreciseInstant` and `HttpsStatus` cases.

#### W1-S1 — staff day store, time grid, timeline, block editor, day pill (wave 1)

**What changed.** The store derives ShopNow at its edge only (`zoneAt`, `shopNow`, `shopNowAt(locationId)`, one `ShopNow` per zone per tick); `DAY_FRAMES`, the spring-forward walk and the feature-local clock parsers are gone (one zone engine, D-6). `StaffDayCell.dayKey: LocalDate`; `blockTime`/`blockSeries`/`clearBlock` take a REQUIRED `day: LocalDate` and branded ids (the D-9.4 empty-id guard deleted — the only caller passes catalogue entity ids). `absenceError` holds the struct (`CATALOG_LOCATION_ZONE_UNKNOWN` with `locationId`, or the block pipelines' answers) — named `StaffBlockFailure` in `errors/scheduling.error.ts` by the integrator. `OffscreenEdge` keeps `'before'`/`'after'` (the `data-edge` CSS hook, D-2); `ScrollAxis {X, Y}` internal SCREAMING; `Placement`/`GridViewport` contract spellings; `readoutTone` is `UiForegroundStyle`. `BlockEditorVm.blockId` stays a D-3 opaque grid key (`block:…`/`day:<chair>`).

**DEPs.** DEP-10 (lane/window/gap boundary minutes in a spring-forward gap), DEP-13 (`?day=` real days only), DEP-14 (`?barber=` with `/` or blank → `null` at once), DEP-22 (strict clock text). Two small departures inside DEP-13/14's text: a PRESENT but refused `?day=`/`?barber=` clears that field in the published record so the fall-back is written and the address bar corrected (old: the stale-scope effect cleared it once barbers loaded; differs only when the catalogue has no barbers); an empty `?day=`/`?barber=` is still silence. Quirk kept: `?view=<unknown>` on a never-stated record does not rewrite the URL.

**parse / `ofProven` (D-4.5).** `LocalDate.parse` via `dayOfRoute` (route day, probe day) — the app only writes LocalDates; `BarberId.parse` on `?barber=` — a catalogue chair id is non-blank without `/`; `StaffTimeGrid.pickDay` `LocalDate.parse(column.id)` — date columns are built from shown LocalDates; `MinuteOfDay.parseClock` (DEP-22; `ui-time-field` emits `HH:mm` only); `BarberId.of` on block-editor menu options built from catalogue ids. `trackMinuteOf` (`TrackMinute.ofProven`, one door in `minute-run.ts`): extent bounds and hour labels (whole hours ≥ 0), the gesture moves (`snapTo` integer, clamps ≥ 0, `pxPerMinute` > 0 finite), block-editor seeds and typed spans (clamped ≥ 0), lane roster and neighbour minutes. `formatClock(…, ClockClosing.Wrap)` replaces four hand faces — byte-equal on every non-negative integer.

**Specs.** Class 1: `GridEvent`/`RepeatPreset`/`ClientQueryShape` re-points (grid, timeline, `block-repeat`, `tag-words`). Class 2: `trackMinute()` on 138 + 4 grid and 14 timeline minute literals; block-editor fixtures (`BarberId.of`, `localDate`; `todayKey` + `nowMinute: 600` → a `ShopNow` at 10:00 on the same day — the frame's day is today, so equivalent); day-pill `localDate()` wraps. Class 3: `grid-gesture.spec.ts` `'y'` → `ScrollAxis.Y`. Class 5: `lane-gaps.spec.ts` deleted (cases in `grid-layout.system.spec.ts`). New: `staff-day.store.spec.ts` (DEP-13, DEP-14, the G-1 silence pin, `zoneAt`/`shopNowAt`, the absence struct, DEP-10), `lane-geometry.spec.ts` DEP-10 case, `agenda-fields.spec.ts` (contract spellings and order), the day pill's pre-zone pin.

#### W1-S2 — the visit editor (wave 1)

**What changed.** Contracts per §2.4: `appointmentId`/`chairId`/`locationId` nullable brands; `clientCustomerId` required; `currency` new (DEP-21 — `MONEY_CODE` deleted, bill words follow the seats' currency); `now: ShopNow | null` replaces `nowMinute`/`todayKey`; frame and roster minutes `TrackMinute`; `VisitEditorLeg.barberId: BarberId` (non-null: every producer reads a seat's `BarberId`; only the draft's own leg is chairless); `VisitEditorCommit = StaffEditDraft`; grant/promo/code values are `CouponValue`; `VisitEditorClientSectionId { Recent: 'recent' }` (the section id itself stays an opaque string, D-3). The old `''` chair sentinel became `null`; the unreachable consequences (production always names the chair and binds the roster): `chairChanged` does not emit for a chairless draft; a chairless leg makes `saveable` false (the server refused `''` anyway); the roster-less fallback menu writes `vm.chairId` instead of the chair's name as an id (option key and test id keep the name); a null-id barber row's menu cannot open; `goToday` (no template caller) does nothing before the zone is known; the roster-less held catalogue is a `computed` with a plain `locationCount`. DEP-20-class: `catalogueTotalLabel` sums `PriceCents.sum`; the undo snapshot sends each leg's stored cents; variant/add/repeat copy cents and currency with the label. Kept as found (R-5, owner call): `seedDraft` still turns a VM start of 1440 into a defect (a walk-in create opened at 23:56–23:59 starts at 1440 — as on `cf91b43`).

**parse / `ofProven`.** `MinuteOfDay.parseClock` (DEP-22); `MinuteOfDay.ofProven(start % 1440)` ([0,1439]); `TrackMinute.ofProven` on the start/end bounds (`max(0,…)`/`min(1439,…)` of whole track minutes) and the 0/1440 frame constants; `PriceCents.of` on `parsePriceInput`'s safe integer ≥ 0, the amount field (whole minor units clamped to [0, bill]), the ruler (multiples of 50 in [0,max]) and a whole step count of the bill; `SeatId.of` on minted `draft-…` ids; `DraftPersonKey.of` on page subject ids the sheet minted; `VoucherCode.of(pending)` on the code the owner answered a stored coupon for. Deleted re-branders: `durationOf`, `startMinuteOf`, `endMinuteOf`, `billCentsOf`, `drawableCentsOf`, the `stepDay` defect parse, `shopNowAt`.

**Specs (class 2).** The `visit()` base (brands; `now: nowOn('2026-08-25', 600)` as the eve — "today with no clock" is inexpressible and the eve keeps every answer; currency; `clientCustomerId: null`; legs with cents), the catalogue/leg/client-option fixtures, `appointmentId ''` → `null` (7), `nowMinute` → `now` (8), the coupon-value/provenance/voucher shapes, two commit expectations in the `StaffEditDraft` shape, Georgi's party, `uiViewer {userId, roles}`. `client-query.spec.ts` re-point (class 1). New: the DEP-21 case (EUR «28,00 €», BGN «28,00 лв.»).

#### W1-S3 — the staff dashboard (wave 1)

**What changed.** OQ-14 on the wall clock: DEP-1…DEP-12 (live, next, past, the agenda's past groups and now line, the group key, search, «Скорошни», the catalogue tag, the block sheet's end, boundary minutes, the block event id, the countdown). The editor/block VMs take `now: store.shopNow()`; `clientCardCatalog` is a `computed` with a plain `locationCount` (D-7.6); the create VM's currency is `Currency.EUR` (the shop's one currency; nothing is priced yet). The write plan and save/undo use case come from `StaffEditPlanSystem` (pass C D-11). The pending-action sheet (its `pendingAction` signal was never set — unreachable) is deleted; its two i18n keys (`staff.day.fab.waitlist`, `staff.day.notBuiltYet`) were removed from both catalogues by the integrator. Kept as found: `rowError(entry.id)` receives the ROW key `appointmentId#barberId`, which the store's appointment-keyed map never holds — production prints no row error before or after (§9.6).

**parse / `ofProven`.** Module constants `MinuteOfDay.ofProven(0)`, `EndMinute.ofProven(1440)`, `MinuteOfDay.ofProven(720)`, `EndMinute.ofProven(780)`; `LocalDate.parse(columnId)` in `openAllDay`/`openAllDayEntry` (date column ids are built from `cell.dayKey`); `BarberId.of` on chip keys, chair column ids and scope option ids (built from `BarberId`s); `SeatId.of` on the minted `draft-…` id; `MinuteOfDay.of(Number(…))` on `openBlock`'s minute segment (built from `interval.startMinutes`; a refusal is the same no-op as today's failed match); `DurationMinutes.of(MinuteCount.span(…))` in `catalogTag` (a zero span hits the same defect as before). Guards that cannot be reached today: early returns on a null `appointmentId`/`chairId`/`dayKey` (each replaces an old `''` possible only before the zone was known, or never).

**Specs.** Class 2: the leg/person fixtures, `whenLabel` (`startUtcMs`/`endUtcMs`), minute fields, the viewer, the grant value, `email: null`, `revision`/`locationId`/`drawn: null` on five commit literals, the reprice legs. Class 3: `discardPending('visit')` → `DiscardTarget.Visit`, `togglePicker('scope')` → `DayPicker.Scope`. Added: the type pin `DayRowVm` → `StaffEditRowFacts`, a DEP-1…DEP-12 block at the Sofia changeovers and in London, two harness hooks (`searchPool`, `seededExceptions`). DEP-4: no existing spec pinned the 09:00 group at millisecond 0 differently — covered by a new case, no expectation edited.

#### W1-K — the client card, internal chains (wave 1)

**What changed.** Presenter and store internals branded (`ClientPhotoVm`, `RewardReadyVm.grantId: CouponGrantId`, `MedalVm.seriesId: BadgeSeriesId | SeasonId` — an archived season without a track carries the season's id; a tap opens a family only where `opens` is `null`); `achievementScopeOf` (G-12) refuses an impossible `day:2026-02-30` the old regex accepted (no key the card mints can hit it — `achievementScopeKey` builds keys from a `LocalDate`; not a departure). Kept as DS inputs/test-id text (D-8.8): `WalletActionVm.prominence`, `DetailHowVm.ratio/columns`, badge tones, medal sizes, streak period marks, the `ng-template` test-id segments. `DetailLevelVm.earnedOn` stays a string (a formatted label). X-3 with W1-R: `client-card.words.spec.ts` expects `errors.LOYALTY_STREAK_PUBLISH_*` (5) and no `admin.rhythm.refused.*` (4) — key list 157 → 158.

**parse / `ofProven`.** None new; `cardDayOf` kept as the one transitional parse of the contract's raw day strings until W2-CK branded them (now deleted).

**Specs.** Class 2 brand constructors; X-3's key list (coupled to the catalogue change).

#### W1-B — the client booking flow, internal (wave 1)

**parse sites (D-4.5).** `client-booking.ts` `linkDay`: `LocalDate.parse` on raw `?day=` — a refusal gives `null`, exactly today's outcome (the store's `localDateOrNull` ran the same parse); absent still `undefined`. `WaitlistRequestId.parse` on `?waitlist=` — refuses only blank or `/`-bearing text, which matched no stored request either (only the owner's read is no longer sent for it). `AppointmentId.parse` on `?repeat=`/`?reschedule=` — the same parse `readVisit` ran, at the edge; a `?reschedule=` refusal calls `refuseMove(MoveRefusal.unavailable(null))` synchronously instead of one microtask later. `LocationId.of(pinId)` (pins built from catalogue shop ids). `EARLIEST_DAY` unchanged. No `ofProven`.

**DEP-23 (services-step half).** `renameRefusal` holds the struct and re-words on a language switch (`booking-services-step.spec.ts`).

**Specs.** Class 2: `restoreFromWaitlist` "no day" `null` → `undefined` (3) and the string day → `localDate(…)`. New cases: `client-booking.spec.ts` (the edge refusals), `booking-flow.store.spec.ts` (null day), `booking-services-step.spec.ts` (DEP-23), `booking-people.words.spec.ts`. The integrator re-pointed the services step to `BOOKER_SEAT`/`bookerLabelOf` (REUSE; same words).

#### W1-A — auth, profile, onboarding, account-state, shell identity, the contact sheet (wave 1)

**What changed.** Expected failures are `Result`s with struct refusals end to end: `saveOwnProfile` → `Result<void, AccountsError.OwnProfileSave>` (`SaveOwnProfileRefusal` deleted); the profile store's `saveName`/`saveBirthDate(BirthDate)`/`uploadPhoto`/`removePhoto`, the onboarding store's `uploadAvatar`, `BookingContactStore.writeProfileName`; `avatarUploadRefusal` returns the struct; `NameRefusals` holds the structs. The flow states and events carry the struct (`OnboardingFlowEvent.birthdayFailed` — DEP-17). ONE server-code helper `wordFlowFailure` in `@creativo/infrastructure/i18n` (no new project edge): a `PipelineError` words as `serverErrorCode ?? IDENTITY_CALL_FAILED` without params, any other refusal as itself. The integrator folded `IdentityError.IdentifierMissing` into `OnboardingFailure` and named the web's repeated `AccountsError.OwnProfileSave | IdentityError.IdentifierMissing` as `OwnProfileWriteFailure` (`identity.error.ts`) — types only.

**DEPs.** DEP-17 (`onboarding-flow.store.spec`: too old → `BirthDateTooOld(121, 120)`, too young → `BirthDateTooYoung(15, 16)`; `client-onboarding.spec` bg+en across a forward UTC midnight prints 120, set back prints 16). DEP-23 contact-sheet half (`booking-contact-sheet.spec`: a refused contact and a failed profile write raised in bg re-word in en; the bg line byte-identical to the catalogue). §2.11's `{{attempted}}` placeholder does not exist in either catalogue, so `birthDatePartial()` words byte-identically (pinned).

**parse / `ofProven`.** None.

**Specs.** Class 2 (the struct retype, `toBe(code)` → `toEqual(struct)`/`Result`): `auth-flow.data`, `onboarding-flow.data`, `auth-flow.system`, `onboarding-flow.system`, `save-own-profile.pipeline`, `auth-flow.store`, `onboarding-flow.store`, `profile.store` (one title «answers null» → «answers ok»), `own-profile` (→ `nameRefusalsOf`), `avatar-refusal`. Class 1: the `PersonalizeStep.ALL`/`OtpCode.DIGITS`/`Roles.*` re-points. Harness: `client-onboarding.spec`'s `CLOCK_PORTS` reads a closure reset to the same pinned instant (so DEP-17 can turn the UTC day). `booking-contact.store.ts` has no own spec (covered through the contact sheet's).

#### W1-R — admin rhythm, admin programs, marketing events and courses (wave 1)

**What changed.** The rhythm's refusal words come from `errors.LOYALTY_STREAK_PUBLISH_*` (struct state, `translateCodedError`; `admin.rhythm.refused.*` removed from both catalogues — same words in bg and en, pinned); the menu ids reuse the domain dictionaries (`StreakQualifier`, `StreakInterval`, `StreakOnBreak`, `RhythmEffectiveChoice`) instead of copies — internal values (the menu only tracks and emits option ids; every test id is a separate literal); `onBreakKey` is a contract words table; new dictionaries `RhythmSheet` (`data-kind` contract; not `AdminRhythmSheet`, which is the component class), `RhythmConfirmation` (`admin.rhythm.confirm.<v>`), `RhythmAlertAnswer`, `RhythmPreviewMetric` (test-id contract), `ProgramsTab`, `EventsTab` (internal). Deleted: `localDateOf`, `datetimeLocalOf`, `sampleRhythmFacts`/`sampleRhythmRun` (spec-only; the cases restated on `StreakPreviewSystem.sampleFacts`/`sampleRun`), the `AdminRhythmRefusal` alias. `timed` answers `RepositoryError.readFailed(null, 'timeout' | 'threw')` (W3-T's `timedRead`).

**parse sites.** `admin-rhythm-sheet.ts` `pickDay` → `LocalDate.parse` of the month cell's key (the store's old parse moved to the picker's edge). Since W2-U typed `UiMonthPicker.uiPicked` as `output<LocalDate>`, the integrator dropped that re-parse (`pickDay(day: LocalDate)`).

**Specs.** `admin-rhythm.store.spec.ts`: class 1, class 2 (`setEffectiveFrom(day(…))` ×9, `ServiceId.of` map keys), class 4 (the «takes «%s» for no day» `it.each` retired). `admin-rhythm.preview.spec.ts`: class 1, 2, 5 (the sample cases restated on the system), 4 (`'someday'`). `admin-rhythm.words.spec.ts`: class 1, 2, 3 (menu ids against dictionary members), `invalidNotice` → `refusedFields`, plus the `errors.LOYALTY_STREAK_PUBLISH_*` describe. `admin-rhythm-sheet.spec.ts`: class 1 (`RhythmSheet`, `setInput('sheet', …)`); W1-R's picker-edge `it.each` of non-days was retired again by the integrator (class 4: `uiPicked` is `output<LocalDate>`).

#### W1-F — the functions edge and the infrastructure adapters (wave 1)

**What changed.** F-1: `LazyMethod {Observable: 'OBSERVABLE', Promise: 'PROMISE'}` replaces `LazyMethodKind` (internal: only `lazy-port.ts`, its specs and `app.config.ts`); `Outcome<P>` → `Result<P, unknown>`; `Object.freeze` gone, `isLazyPort` (a module `WeakSet` of built proxies) keeps the wiring specs' intent. F-2/F-3: `UtcEpochMs.compare` sorts (only the sign is read — identical stable order), `AppointmentId` keys. F-4: `DiscountSystem.isOffered` in `listOpenCoupons` (same rows: the query already filtered `ENABLED`). F-5: `WorkBudget.startedAtUtcMs: UtcEpochMs`. F-6: `PreciseInstant.LATEST`/`fromWholeSecond` (equal values; the throwing IIFE deleted); `main.ts`'s clock refusal through `defect()` (only on a broken host clock). F-7: `FirestorePorts = TxPorts &` the 20 named bundles. F-8: `Roles.known/mayBook/isAdmin`; every wire error union from `@core/errors`; `loyalty.wire` on `StreakPublishError.Failure`/`isAnswered` and `StreakRule.EXCUSES`; `governance.wire` on `ImpersonationLifecycle.parseScope`; `booking.wire` `Tag.has(BookingStatus | CancellationReason, …)` (both `as CancellationReason` casts gone — same answers). No parse/`ofProven` site, no DEP.

**Specs.** Class 1: `edge.spec` (`AttemptOutcome`), `triggers.wire.spec`, `ops.wire.spec`, `project-client-stats.integration.spec`, `caller-roles.spec` (`Roles.ALL`/`ADMIN`). Class 2: `edge.spec.ts` `startedMs` → `startedAtUtcMs`; `LazyMethod` members in `lazy-port.spec` (8) and `lazy-port.forms.spec` (7). Forced by F-1 with the intent kept: `Object.isFrozen(days)` → `isLazyPort(days)` (`lazy-port.forms.spec`), and — landed by the integrator — `apps/web/src/app/app.config.spec.ts` `Object.isFrozen(port)` → `isLazyPort(port)`. `edge.spec.ts`'s `ANSWERED` reads `StreakPublishError.ANSWERED_CODES` (D-9.7, same six codes). One case added (`lazy-port.spec`: a plain record, told apart by `isLazyPort`).

#### W1-U — the icon registry, `translate-coded-error`, the landing's locations (wave 1)

**What changed.** DEP-16: manifest schema 2, `iconAsset: 'MATERIAL' | …` replaces `kind` (a v1 document is rejected whole: «schemaVersion 1 is not supported (this build reads 2)»); the `no-generic-discriminator` `allowIn` entry and its fixture gone; the resolver answers `Result<UiIconResolved, UiIconFailure>`; `UiIconAsset` → `UiIconArtwork`, `UiIconManifestIssue` → `UiIconIssue` (`code` → `iconIssue`; no consumer outside `libs/ui/icons`). Kept as unions (D-8.8): the SVG presentation values, `UiLogoScheme`, `UiIconScale`, the logo's `data-scheme` `'any'`. The landing's locations print through `formatClock` (N-11). The integrator re-worded runbook §4.9 gate 5b (the manifest carries no generic discriminator) and `tools/icons/load-ts.mjs`'s header.

**parse sites.** `translate-coded-error.ts`: `LocalDate.parse` + `MinuteOfDay.of` on a DST-gap struct's wire `localDate`/`minute` (foreign input; a refusal prints the struct's raw text as before).

**Specs.** DEP-16: `icon-manifest`, `icon-resolver`, `icon-registry.service`, `icon`, `logo`, `no-generic-discriminator` (a v1 document rejected; a v2 document parses; the console line unchanged; an old `kind` entry inside a v2 document dropped as `entry-rejected`). Class 1: `icon-vocabulary.spec.ts`.

#### W2-CK — client card contracts ↔ visit editor ↔ shared visits ↔ appointments/account (wave 2)

**What changed.** The card contracts branded (I-21…I-28: subject/viewer ids, `AchievementScope.day: LocalDate`, `ClientCardGrant.expiresOn: LocalDate`, the catalogue lookups by brand); `VisitRowVm`/`VisitCardVm` split by discriminator (features lint forbids namespaces, so `AppointmentRowVm`/`WaitlistRowVm` over `VisitRowFields`, `AppointmentCardVm`/`WaitlistCardVm`); `VisitLookup` → `visit-lookup.contracts.ts` (Law 10.3); `ClientCardPage` dictionary (the editor maps its page kinds through `editorCardPages`); `cardDayOf`/`shopIsoOf` deleted. `AppointmentsView` keeps `'list'`/`'calendar'` (host `data-view` + `:host([data-view='calendar'])`, D-2); `ScrollSide` internal SCREAMING; `DayRangeFace`, `VisitListStyle`, `StaffEventHeadSize`, `VisitCardHeaderProminence` keep their input spellings (D-8.8). Behaviour-preserving deviation: `subjectCustomerId` stays OPTIONAL on the row/card options (`undefined` is `subjectRecordOf`'s "read the record off the seat" path; owner call in §9.6). `visit-list` `openRow` emits only for a visit row (no list holds a waitlist row — unreachable).

**DEP-15.** `isInChairToday` and the draft's start minute read the wall-clock start: a gap start (2027-03-28 03:30) is now in the chair / an early start; the fall-back repeat (2026-10-25 03:30) is unchanged; a start without a zone of its own now counts. `medal-detail`'s counted draft still needs an instant (`AchievementsSystem.countedDraft` takes ms), derived with `ZonedTimeSystem.toUtc` on the card's zone, so a gap start stays skipped there (pinned unchanged). Specs: `client-card.presenter.spec`, `achievements.presenter.spec`, `medal-detail.presenter.spec`.

**parse sites.** `ServiceId.parse` of a rhythm rule's id in the card's `nameOf` (a category id names no service — the catalogue answers `null` as before); `BadgeCategoryId.of` on chip keys minted from catalogue category ids (`CHIP_ALL`/`CHIP_SEASONS` excluded).

**Specs.** Class 2 brand constructors across the client-card lib (`achievement-category`, `achievement-tile`, `client-card`, `client-loyalty`, `client-history`) and the dashboard spec's catalogue lookups (`:6764-6773`, landed by the integrator); class 4: `store.barTitle('discount', null)` retired — `barTitle` takes a `ClientCardPage` and `'discount'` is no card page (the editor maps only its card pages). The 68-test `<h3>` whitespace differential this package's template reflow caused is restored byte-identical by the integrator (`<!-- prettier-ignore -->` on four headings).

#### W2-M — the catalogue's money and ids (wave 2)

**What changed.** Catalogue VM prices are `PriceCents` beside a `Currency` (`ServiceTermsVm`, bundle saving, performer terms); `CatalogWording.price(money: Money)` → `formatCents` in the stored currency (DEP-19); `BarberVm.id: BarberId`, `ServiceVm.id: ServiceId`, variant ids branded. Parses removed (all on catalogue-built ids that never refused): services step `ServiceId`/`ServiceVariantId`/`BarberId.parse` ×5, bag sheet ×3, the dashboard's `ServiceVariantId.of`. By-construction brands added: `BarberId.of('ivan' | 'niko' | 'stefan')` in the team showcase. Integrator follow-ups: the dashboard's two redundant `BarberId.of(vm.id)` dropped, `BlockEditorBarberOption.id: BarberId`, the review step's private `money()` now `CatalogWording.price`, the variant icon union → `VariantIcon` (internal `LENGTH`/`SKIN`, never printed).

**DEP-19.** A non-EUR stored currency prints its own symbol (the sheet's «from» price, the bundle saving, card tags, performer prices, the landing tile and price list, the booking option lines, the dashboard's service-option labels); EUR byte-identical in bg and en. Specs: the detail sheet's DEP-19 cases, the new catalog-wording/presenter specs; every other edit class 2 (the dashboard spec's `price(major)` helper → a `Money`, landed by the integrator).

#### W2-U — narrowing the shared formatters and the DS pickers (wave 2)

**What changed.** `@creativo/ui/wall-clock`: `formatWallClock`/`wallClockParts`/`formatWallClockParts` take `MinuteOfDay | EndMinute | null`, `formatMinute` `MinuteOfDay | EndMinute`, `formatInstant` `UtcEpochMs`, `formatCents`/`moneyFormat` `PriceCents, Currency`, `formatBookingTime` `MinuteOfDay | EndMinute`; `civilMs` module-private. `ui-month-picker`: `uiSelected: LocalDate | null` (null = the old `''`, identical output), `uiToday`/`uiMin: LocalDate | null`, `uiMarked: readonly LocalDate[]`, `uiPicked: output<LocalDate>`, the browsed month held as its 1st; `UiDayKey = LocalDate` stays as an alias. `UiIsoWeekday` deleted (no consumer); `ui-weekday-picker` takes `readonly Weekday[]` (`ISO_WEEK` spelled with `Weekday.Mon…Sun`; test ids and aria values identical). The day pill now hands `uiDayKey()` straight through (integrator: the `''` sentinel and the redundant `LocalDate.parse` gone); the showcase month-picker page builds its days with `LocalDate.fromEpochDay`.

**parse / `ofProven`.** None added; removed: `firstOfMonth`'s and `relativeDay`'s `LocalDate.parse`, the menu page's `dayPill` parse.

**Specs.** Class 2: `wall-clock.spec` (`Date.UTC` → `utcMs(…)`, the same instant; `cents()` + `Currency.EUR`; USD via `Currency.parse`), `booking-wall-clock.spec`, `month-picker.spec` (branded host signals; one ADDED case for the null selection), `weekday-picker.spec` (`[Weekday.Mon, Weekday.Wed]`, values 1 and 3 unchanged). Class 4: the JPY case dropped (`Currency.parse('JPY')` refuses — unrepresentable). All expectations byte-identical.

#### W3-T — tidy (wave 3)

**What changed.** Every transitional name re-pointed and deleted (§5 item 1 = 0); `TrackSpan` narrowed (and with it `BlockEditorLane {barberId: BarberId; neighbour/roster minutes: TrackMinute}`, `BlockEditorVm.startMinute/endMinute: TrackMinute` — every producer already passed brands); the `(narrow)` parameters narrowed; `Locale` sites through `Tag`; `ListOpenCoupons` → `OfferedCoupon[]`; `timedRead(read, budgetMs, timers, failures)` in `@creativo/shared/view-state` (one parameter more than planned: the `type:util` lib may not import `Result`/`RepositoryError`, so each store hands its own failure structs; each failure is now one shared `Result` instead of a fresh one per call — equal values); the e2e support's ONE shop clock (`apps/web/e2e/support/shop-clock.ts`: `SHOP_ZONE`, `SHOP_TIME_ZONE` via `checkZone`, `shopInstant`, `shopDayOf`, `shopToday` — the app's zone engine); `readBarberBusyDay`/`readScheduleException` take `(BarberId, LocalDate)` and build ids with `BusyKey.of`. Integrator follow-ups: `appointments.spec.ts`'s `shopMonthKey()` reads `shopToday()` (its third `Intl` zone read gone) and `e2e-appointment-seed.spec.ts` imports `SHOP_ZONE` from `shop-clock.ts` (the re-export deleted); the store's dead `coupon.code === null` branch dropped (the port answers `OfferedCoupon[]`).

**Specs.** Class 1: the moved-name re-points. Class 2: `visit-draft.system.spec.ts`, `grid-layout.system.spec.ts` (helpers + 3 literals), `staff-block-editor.spec.ts`, `audit-context.data.spec.ts`, `audit.system.spec.ts`, `audit-profile-change.pipeline.spec.ts`, `update-profile.pipeline.spec.ts` (`RegistrationField`). Class 4: `grid-layout.system.spec.ts`'s property bodies' negative generated track ends (now `Math.max(0, start + length)`, which still yields empty and inverted spans). Class 5: `visit-draft.system.spec.ts` «whose a person key is» (already ported case for case to `ids.primitive.spec.ts`), the delegate-equals-home cases; `booking-status.data.spec.ts`/`locale.data.spec.ts` restated case for case on `Tag.has`/`values`/`or`. No DEP.

#### W3-G — lint guards (wave 3)

**What changed.** D-13.1: `uiRawPrimitiveBlock` (`tools/lint-rules/ecs-syntax.mjs`) — L3 widened to interface members in `libs/features/**` and `libs/ui/**` production files: a member named as an id, an instant (`*UtcMs`/`*Ms`), money, a shop day (`today`/`dayKey`/`todayKey`), a zone or a seat/person key is its brand; escapes `…Input`, `…Words`, function members and the D-3 opaque keys (`UI_OPAQUE_KEY_NAMES`, incl. `blockId` and the DOM `pointerId`). D-13.2: no `export function` in a data-shaped file (`*.data.ts`, `*.entity.ts`, `*.error.ts`, `*.primitive.ts` — the spec's entity == data invariant), zero hits in all four kinds. Both base paths proven in `ecs-core-base-paths.spec.mjs`. `libs/ui/icons/eslint.config.mjs` turns `no-restricted-syntax` off on its non-suffix files (the registry boundary), so the guard is off there too (zero hits measured; owner/plan call, §9.6). Integrator follow-ups: `*Minutes` back in the guard (its one hit, `GridEvent.surplusMinutes`, is a `MinuteCount` now — the spec case flips on purpose: «catches a raw `*Minutes` member»), `uiRawPrimitiveBlock` re-exported from `tools/lint-rules/index.mjs` and imported through it.

**Specs.** `ecs-syntax.spec.mjs` (+ the new guard's cases), `ecs-core-base-paths.spec.mjs` (both bases, a canary).

#### G — integrator, first round (wave 4)

**What G found.** Waves 0–3 had all landed when G ran (2026-10-25, 05:00); the
other wave-0…3 packages' §9 notes are NOT in this file (only W0-P wrote
one here) — G records below what the integrated tree itself proves. Tree
against `cf91b43`: 789 status entries — 578 modified, 7 deleted, 204 new
(`git status --porcelain --untracked-files=all`): `libs/ecs-core` 481,
`staff/client-card` 49, `staff/dashboard` 34, `shared/visits` 32,
`client/booking` 29, `apps/functions` 21, `ui/icons` 15, `infrastructure/i18n`
14, `apps/web` 14, `shared/catalog` 13, `admin/loyalty` 11, the rest ≤ 8 each.

**Files touched by G.** The wave-0 barrels only (D-12.1): the four unfilled
placeholders deleted with their `components/index.ts` lines —
`components/catalog-status.data.ts` (W0-B moved its three dictionaries to
`service-`/`barber-`/`location-status.data.ts`), `client-history.data.ts`
(W0-L: `history-note`/`tenure-state`), `medal-outlook.data.ts` (W0-L: its nine
dictionaries), `policy-recompute-outcome.data.ts` (W0-O:
`policy-start`/`policy-step`/`policy-sweep-outcome`); no file or spec named
them by path (`grep -r`). Then `components/index.ts` (291 lines),
`entities/index.ts` (45), `primitives/index.ts` (28) and `systems/index.ts`
(87) each sorted once (`LC_ALL=C sort -u`; C and locale order agree on all
four; no duplicate line). The sort also moves the four lines pass C had left
at the end of `components/index.ts` (`shop-coverage`, `seat-arrangement`,
`client-move`, `grid-placement`) and `catalog.system`/`retention.system` in
`systems/index.ts`. `pipelines/index.ts` is not a wave-0 barrel and was left
as found. Every remaining barrel line resolves to a file that exports
something, and every non-spec file of the seven tiers is listed in its barrel.

**Deleted specs and where their cases went** (`git show cf91b43:<spec>`
counts against the new files): `cart-line.data.spec.ts` 24 cases →
`booking-cart.data.spec.ts` 21 + `seat-key.data.spec.ts` 3;
`catalog-status.data.spec.ts` 3 → the three `*-status.data.spec.ts` 1 + 1 + 1;
`lane-gaps.spec.ts` 6 → ported (§4.1). Spec files whose `it` count dropped,
each a relocation into a split file's new spec or a §4.2 class-4/5 row:
`client-stats.data.spec.ts` 12 → 1 (`precise-instant` 12, `client-money-stats`,
`policy-pass`, `policy-pass-stamp` 1 each), `schedule-version.data.spec.ts`
19 → 10 (`shift-segment` 9), `service-terms.data.spec.ts` 17 → 10
(`service-variant` 7), `seat-id-pair.data.spec.ts` 7 → 4 (`stood-seat-pairs`
3), `seat-outcome.data.spec.ts` 19 → 16, `placement-policy.data.spec.ts` 6 → 4,
`booking-flow.data.spec.ts` 8 → 7, `party.data.spec.ts` 26 → 25,
`roster-window.data.spec.ts` 2 → 1, `enrollment-status.data.spec.ts` 2 → 1
(`ProgramsSystem.isEnrollmentOpenOrUpcoming`), `visit-draft.system.spec.ts`
53 → 51 (`accountKeyOf` → `ids.primitive.spec.ts`, W0-P),
`admin-rhythm.store.spec.ts` 118 → 117 and `admin-rhythm.preview.spec.ts`
33 → 32 (§4.2 class 4). No project's test count dropped (per-project
comparison with the pass-C gate log, §9.3).

**parse / `ofProven` sites the tree adds** (production, `git diff -U0` + the
new files). `ofProven` — 16 call sites, each beside a comment naming its
range: `visit-draft.system.ts` (6: snapped / clamped track minutes ≥ 0),
`staff-visit-editor.ts` (5: `TRACK_DAY_START`/`END` 0/1440, the start's
`startMinute % 1440`, the typed-field bounds clamped to `[0, 1439]`),
`staff-dashboard.ts` (4: the constants 0, 1440, 720, 780),
`time-grid/minute-run.ts` (1: `trackMinuteOf`, the frames' one door — 20
callers, every one a snapped/clamped or stored minute ≥ 0). `parse` at an
edge — 21 sites: the route edges (`staff-day.store.ts` `?day=` DEP-13 and
`?barber=` DEP-14; `client-appointments.ts` `?visit=`; `client-booking.ts`
`?day=`, `?waitlist=`, `?repeat=`, `?reschedule=`), typed clock text
(`MinuteOfDay.parseClock` ×3, DEP-22), opaque UI keys minted from a brand
(`GridColumn.id` ×4 in `staff-dashboard.ts`/`staff-time-grid.ts`;
`achievementScopeOf`'s `day:` key; D-8.9), the booking store's
`EARLIEST_DAY` constant, `translate-coded-error.ts`'s wire date, the
client-card catalogue's `nameOf` (`ServiceId.parse` of a rule id that may be
a category's), and two re-parses of a value the DS picker already hands back
as `LocalDate` (`admin-rhythm-sheet.ts:414`, `staff-day-pill.ts:213` — open,
see the §5 record).

**§5 checklist, G's run** (`grep -rn`, untracked files included; specs
excluded unless named):

1. Transitional names — 0.
2. (a) raw brand fields in `*.vm.ts`/`*.contracts.ts`/`*.store.ts`/
   `*.presenter.ts` — 22 hits, reviewed: 6 `testId` (D-3 allowlist), 7 the
   «днес» WORD `today` of `VisitWords`/`whenShort/Long/Heard` (a string of
   copy, not a day), 5 D-8.9 page-key readers (`detailAction(seriesId)`,
   `photoById(photoId)`, `barTitle(…, subjectId)`, `seriesById(…, seriesId)`,
   `medalDetailVm(seriesId)` — each brands once with `X.of`), and 4 widened
   parameters — `medals.presenter.ts:637` `closeTiles` (its
   `seasonTrackId` is a raw `string` or `null`, re-branded through
   `BadgeSeriesId.of` from a `BadgeSeriesId | SeasonId`),
   `achievements.presenter.ts:1450`
   `categorySections(categoryId: string)` (fed a `BadgeCategoryId`),
   `wallet.presenter.ts:850` `stepOf(tierId: string | null)` (fed `TierId`),
   and `seriesById` also fed already-branded ids — open (minor). (b) raw
   `Minute(s)` — 19: 16 gesture/pixel physics (`pxPerMinute`, the grids'
   private `moveTo`/`resize*To` and `ghostBlocks`/`…` helpers, D-2.13),
   `staff-dashboard.ts:3215` `span(totalMinutes)` (a duration worded), the
   client-card fixture, and `GridEvent.surplusMinutes?: number | null`
   (`staff-time-grid.ts:133`, a non-negative count → `MinuteCount`; open).
   (c) `*Ms` names — 21 production hits, all `nowMs`/`_nowMs` typed
   `UtcEpochMs` (`StaffDayStore.nowMs` is the §2.3 contract's own name; the
   client card's presenter inputs and store) — types branded, names kept;
   the item's "expect 0" disagrees with §2.3 (carried, §9.6).
3. Brand casts outside their own files — 0; `as string` — 2, neither an id
   widening (`toSignal`'s `initialValue`, a `noUncheckedIndexedAccess` char
   read).
4. Defect re-branders / second zone engines — 0 real: `dayOfRoute`
   (`staff-day.store.ts`, the DEP-13 edge parse), `dayOfBirth`
   (`age.system.ts`), the wire/adapter edge parsers `booking.wire.ts` `dayOf`
   and `firestore-ttl.adapter.ts` `localDateOf` (foreign input, one parse
   each), a parameter named `seatStartUtcMs` in
   `ClientStatsPolicy.isLateCancellation` (T2, a lifecycle comparison) and
   comments/spec titles naming retired functions. `ZonedTimeSystem.shopNow`
   in the dashboard outside its store — 0. `Intl.DateTimeFormat` in features
   — 1, the dashboard's `deviceZone` (a device read). `new Date`/`Date.now`
   — 3 production sites, all clock adapters / the composition root
   (allowed by `no-ambient-clock`).
5. Bare literals compared — 0 in production (5 spec hits; `staff-day-pill.ts:80`
   compares an `Intl.formatToParts` part `type`, an external vocabulary).
   `snapshot`/`.loaded`/manifest `kind` — 0 (the 3 `.loaded` hits are
   Angular signals of `ui-section-header`'s spec and `ui-ambient-video`).
6. Error state as codes — 0; bare `Result.err('…')` — 0 outside specs.
7. Dictionaries outside their homes — 0; error unions outside errors — 0
   (`VoucherRefusal`/`MediaRefusal` are primitives' base tags; `TrackedError`
   is test support; `TrackError` a port function type; `AttemptFailure` a
   system I/O struct judging a foreign gRPC failure); `export function` in a
   `*.data.ts` — 0.
8. Getters / `Object.freeze` on data — 0.
9. One name per data file — 72 multi-name files reviewed: all but these are
   one component plus its own field dictionaries (L-1). Open:
   `gamification.data.ts` holds FOUR dictionaries and no component
   (`BadgeCategoryKind`, `BadgeEmblem`, `SeasonKind`, `SeasonPhase` — L-1: a
   dictionary-only file holds one); dictionaries that type no field of their
   file's component: `RedeemProblem` (`reward-redemption.data.ts`, beside
   `RedemptionRecord`; §1.10 S-19 ruled a doc fix only),
   `JournalVisibility` (`journal-effect.data.ts`, types the journal ENTRY's
   field), `StreakTransition`/`StreakRuleDirection`/`StreakPublishConsent`
   (`streak-rule.data.ts`, fields of the definition version and the
   publish answer).
10. New functions with a caller and a spec — all but `MinuteDelta.negate`
    (spec only, no production caller; open). `TrackMinute.of` has no
    production caller but is the primitive's Law 7.4 smart constructor (the
    `trackMinute()` test helper uses it).
11. Layering green (884 files, 3,927 edges); lint green (no
    `no-sliced-ports`/class/`../` finding).

#### G — integrator, second round (wave 4)

**Every open item of the first round is closed** (the tree then: 820 status
entries — 591 modified, 9 deleted, 220 new). Files G touched, by item:

- `nx sync` — `libs/features/marketing/landing/tsconfig.lib.json` and
  `libs/features/shared/catalog/tsconfig.lib.json` gain the
  `libs/ui/wall-clock` reference (the root `tsconfig.json` is unchanged).
- The day pill (`staff-day-pill.ts`) hands `uiDayKey()` straight to
  `ui-month-picker` (`LocalDate | null`; `null` draws exactly what `''`
  drew — `month-picker.spec.ts` pins it) and `pick(day: LocalDate)` emits
  the picked day as it is (the redundant `LocalDate.parse` gone; the spec's
  untyped `pick('2026-09-12')` call is unchanged and still passes).
- `admin-rhythm-sheet.ts` `pickDay(day: LocalDate)` (the re-parse gone);
  `admin-rhythm-sheet.spec.ts`'s non-day `it.each` (4 rows, added by W1-R)
  retired — §4.2 class 4 (`uiPicked` is `output<LocalDate>`), with the three
  imports only it used.
- `staff-dashboard.spec.ts` — the two type-forced edits (§4.2 class 2): the
  `price(major)` helper builds a `Money` (`cents(major * 100)`, EUR; majors
  20/35/42, labels byte-identical), and the catalogue lookups take
  `BarberId.of`/`ServiceId.of`/`LocationId.of`.
- `app.config.spec.ts` — `Object.isFrozen(port)` → `isLazyPort(port)`
  (forced by F-1, intent kept: no eager adapter took the proxy's place).
- Errors: `OnboardingFailure` folds in `IdentityError.IdentifierMissing`
  (W1-A's exact change — the inline `| IdentityError.IdentifierMissing` in
  the flow state, the event, `wordFlowFailure` and the onboarding screen
  dropped); NEW `OwnProfileWriteFailure` (`identity.error.ts`: the web's
  own-profile write — `AccountsError.OwnProfileSave | IdentifierMissing`,
  spelled inline nine times before, D-9.1); NEW `StaffBlockFailure`
  (`scheduling.error.ts`, plan §2.3/§2.9 — the store's `absenceError`).
  Types only.
- L-1: `gamification.data.ts` (four dictionaries, no component) split into
  `badge-category-kind`, `badge-emblem`, `season-kind`, `season-phase`
  (`.data.ts`; the file deleted, its spec renamed
  `loyalty-vocabularies.spec.ts`, cases byte-identical); the dictionaries
  that typed no field of their file's component moved to their own files —
  `JournalVisibility`, `StreakTransition`, `StreakRuleDirection`,
  `StreakPublishConsent`, `StreakRuleParameter`, `RedeemProblem` — and
  `page-step.data.ts`'s `Page`/`PageKey` (helper types with readers outside
  the file, L-2) into `page.data.ts`/`page-key.data.ts`. `export *` barrel:
  no importer outside ecs-core changes; sibling imports and the type-specs'
  home comments re-pointed (five stale home comments in
  `appointment-dictionaries.type-spec.ts` and two in
  `staff-ui-dictionaries.type-spec.ts` corrected on the way); specs class 1.
- `MinuteDelta.negate` (W0-P, no production caller) deleted with its two
  pass-D case lines.
- Client-card widened parameters: `closeTiles(seasonTrackId: BadgeSeriesId
| null)` — fed the running season's `trackSeriesId` exactly when its card
  exists (`seasonOf` draws the TRACK family, so its medal's id IS that
  `trackSeriesId`; the `BadgeSeriesId.of` re-brand gone);
  `categorySections(categoryId: BadgeCategoryId)`;
  `wallet.presenter`'s `stepOf(tierId: TierId | null)`; `landsOn` returns
  `LocalDate | null` (`landsOnDay` folded into it; the contracts spec's
  return-type pin `string | null` → `LocalDate | null`, class 2).
  `seriesById(data, seriesId: string)` stays the D-8.9 door: its callers
  hand it page keys and the medal VM's `BadgeSeriesId | SeasonId`.
  (Superseded by the second fixer round, §9.1: `seriesById` and
  `medalDetailVm` take a `BadgeSeriesId`; the page keys brand at their
  readers; a drawn medal is read through `familyOfMedal`.)
- `GridEvent.surplusMinutes?: MinuteCount | null`, built by NEW
  `MinuteCount.fromDelta` (`max(0, d)`, never `-0`; JSDoc, spec + purity) —
  equal to the old `Math.max(0, delta ?? 0)` on every input; and W3-G's guard
  takes `*Minutes` back (`UI_RAW_BRAND_FIELD_SUFFIXES` is L3's whole list
  plus `Ms`; its spec case flips on purpose: «catches a raw `*Minutes`
  member»); `uiRawPrimitiveBlock` re-exported from `tools/lint-rules/index.mjs`.
- The 68-test `<h3>` whitespace differential restored byte-identical:
  `<!-- prettier-ignore -->` keeps the four reflowed headings on one line
  (`client-card.html` Visits/Loyalty/Photos, `client-loyalty.html` Ledger;
  Angular drops template comments).
- §5 item 2(c): `StaffDayStore.nowMs` → `nowUtcMs` (the store's private
  fresh clock read, which held that name, is `readNow()`), the dashboard
  alias, the client card store's `_nowMs` and the presenters' `nowMs` inputs
  → `nowUtcMs` (names only; `glance.presenter.spec.ts` 2 and
  `client-card.presenter.spec.ts` 3 input literals renamed, class 2).
- Tags (theme 4, carried "Left as found"): the onboarding deep link's words —
  NEW `OnboardingPhase` / `OnboardingStepHint`
  (`shared/shell/src/lib/identity/onboarding-link.ts`, URL contract
  spellings `personalize`/`services`/`birthday`/`avatar`) used by the
  menu, the account checklist, the onboarding screen and
  `SessionIdentityService.nextOpenStep`; the catalogue's variant icon union
  → `VariantIcon` (internal `LENGTH`/`SKIN`, mapped to registry keys, never
  printed; the landing fixture's three literals re-pointed).
- REUSE, NEVER COPY: `loadedLanguage(transloco)` (NEW,
  `@creativo/infrastructure/i18n`, + spec) replaces eight identical
  `langChanges$ → selectTranslation` streams (two of them new in pass D);
  the services step reads `BOOKER_SEAT`/`bookerLabelOf`
  (`booking-people.words.ts`) instead of its own copies; the review step's
  `money()` is `CatalogWording.price`; the dashboard's two redundant
  `BarberId.of(vm.id)` dropped; `BlockEditorBarberOption.id: BarberId`; the
  editor's `uiViewer` is `ClientCardViewer | null`; the rhythm store reads
  its branded names map directly; the staff store's promo list maps
  `OfferedCoupon`s (its dead `code === null` branch gone).
- e2e support: `appointments.spec.ts`'s `shopMonthKey()` reads
  `shopToday()` (its own `Intl` zone read gone); `e2e-appointment-seed.spec.ts`
  imports `SHOP_ZONE` from `shop-clock.ts` (the re-export deleted).
- Dead i18n keys of the deleted (never-set) pending-action sheet removed
  from both catalogues (`staff.day.fab.waitlist`, `staff.day.notBuiltYet`;
  the escapes of every other line kept byte for byte).
- Docs and comments: the runbook's `FLIPPED4` names the three program-input
  files and §4.9 gate 5b reads «the icon manifest carries no generic
  discriminator»; `tools/icons/load-ts.mjs`'s header; a comment that spelled
  the retired word `enabled` in `coupons-vouchers.adapter.ts` (runbook §4.2
  «coupons' enabled» FAILED on it, now `ok`); `ClientStatsPolicy.isLateCancellation`'s
  parameter `seatStartUtcMs` → `startUtcMs`; `ZonedTimeSystem.toIso`'s and
  `TimeCoordinate.instantAt`'s JSDoc; the plan's §2.3 (`nowUtcMs`), §2.8
  (`ClockClosing`'s home) and DEP-22 (`9:75`) rows.

**parse / `ofProven` sites G adds:** none. Removed: the day pill's and the
rhythm sheet's re-parses of a value the picker already hands over as a
`LocalDate`.

**§5 checklist, second run** (`grep -rn` over `libs apps tools`, untracked
files included; specs excluded unless named):

1. Transitional names — 0.
2. (a) 18 hits, all reviewed: 6 `testId` (D-3), 7 the «днес» WORD `today`
   (`VisitWords` and the presenter's wording parameters), 3 D-8.9 page-key
   readers in `client-card.store.ts` (`detailAction`, `photoById`,
   `barTitle`), `seriesById`'s and `medalDetailVm`'s `seriesId` (the door
   above; 15 after the second fixer round — `detailAction`, `seriesById`
   and `medalDetailVm` take a `BadgeSeriesId`, §9.1). (b) `Minute(s): number` — 17 production hits, all pixel/gesture
   physics (`pxPerMinute`, the grids' private `moveTo`/`resize*To` and run
   helpers' parameters, D-2.13) and `span(totalMinutes)` (a duration
   worded); the client-card fixture's raw input type is test support.
   (c) `*Ms` names — 0 in production (11 hits in two test-support files'
   raw fixture parameters).
3. Brand casts — 0; `as string` — 2, neither an id widening.
4. Defect re-branders / second zone engines — 0 real (the four edge parsers
   and `dayOfBirth` as in round one; two spec titles name the retired
   `seatStartUtcMs`); `ZonedTimeSystem.shopNow` outside the store — 0;
   `Intl.DateTimeFormat` in features — 1 (`deviceZone`); `new Date`/`Date.now`
   — 3 clock adapters / the composition root.
5. Bare literals compared — 0 in production (spec hits only, and the day
   pill's `Intl` part `type`); `snapshot`/`.loaded`/manifest `kind` — 0.
6. Error state as codes — 0.
7. Dictionaries / error unions outside their homes — 0 (as round one).
8. Getters / `Object.freeze` on data — 0.
9. One name per data file — 70 multi-name files, every one a component plus
   the dictionaries of its own fields (L-1); none left open.
10. New functions with a caller and a spec — all (`MinuteDelta.negate`
    gone; `MinuteCount.fromDelta`, `loadedLanguage` new with both).
11. Layering green (895 files, 3,972 edges); lint green.

#### Fixer — the post-integration review's six findings (2026-10-25)

A review of the integrated tree confirmed six findings; the fixer applied
each (the corrected fix where the review gave one). **No runtime value, word,
URL, CSS hook, test id, stored document or callable answer changes — no new
DEP.** Files touched, by finding:

1. **Law 7.4 at the client card ↔ editor boundary (major).** The outputs
   that re-emit a branded grant id stop widening it: `client-card.ts`
   `openReward`/`removeReward`, `client-loyalty.ts` the same,
   `wallet-holdings.ts` `removeReward`, `birthday-card.ts`
   `useGift`/`removeGift` are `output<CouponGrantId>()` (every emit site
   already hands `reward.data.grantId`, `gift.grantId`, `ticket.grantId` or
   the narrowed `action.grantId` — all `CouponGrantId`). The editor's
   handlers take the brands: `openReward`, `removeReward`, `rewardTicket`
   (`grantId: CouponGrantId`) and `addCountedService(serviceId: ServiceId)`.
   Spec: `staff-visit-editor.spec.ts`'s `GEORGI_GRANT.grantId` →
   `CouponGrantId.of('grant-georgi-punch')` (§4.2 class 2 — the fixture is
   emitted through the now-typed `openReward` output; the value is the same
   string) and its import (class 1).
2. **ONE membership scan (`Tag.has`).** NEW
   `CallAnswer.tag(answer, name, dictionary)` (`call-answer.data.ts`, JSDoc + a spec case in
   `call-answers.data.spec.ts`: exact match only, no case folding, no
   trimming, non-strings refused) reads a whole-dictionary field through
   `Tag.has`; the decoders use it — `BookingCall` `toBookingStatus`
   (`BOOKING_STATUSES` deleted), `BackfillCall` (`JOB_NAMES` deleted),
   `GovernanceCall` (`END_REASONS` deleted), `IdentityCall` `sessionKind`
   (`Tag.values(SessionKind)` dropped), `StreakPublishCall`'s direction
   (`DIRECTIONS` deleted). `CallAnswer.oneOf` stays for the one SUBSET list
   (`StreakPublishError.ANSWERED_CODES`), its JSDoc saying so.
   `PipelineError.isPipelineError` (`PIPELINE_CODES` deleted),
   `RepositoryError.guard` (`REPOSITORY_CODES` deleted; the file now imports
   `Tag` from `@core/primitives` — the one new layering edge),
   `RecurrenceRule`'s monthly week check (`WEEKS_OF_MONTH` deleted) and the
   functions wire's `isStoreFailure` (`STORE_FAILURES`, the whole
   dictionary, deleted) read `Tag.has`. The same copy in
   `apps/functions/src/wire/loyalty.wire.ts` — `wordOf(values, raw)`, a
   `find` over `Tag.values` lists — takes the dictionary and delegates to
   `Tag.has` (`TRANSITIONS`, `QUALIFIERS`, `INTERVALS`, `ON_BREAKS` deleted;
   the excuses read `StreakExcuse`, not `StreakRule.EXCUSES`). Every answer
   is unchanged: each deleted list was exactly `Object.values` of its
   dictionary, and `===` equals `includes`' SameValueZero on string/integer
   members.
3. **Discount summary compares the discriminator.** `discountSummary` reads
   `line.discountSource !== DiscountSource.Manual` where it compared the
   line's icon name to `'promo.coupon'` (the glyph is `promo.coupon` exactly
   when the source is not `MANUAL`, so every input answers the same).
4. **Staff-day member signatures.** `BarberId` for `blockName`,
   `barberNameOf`, `barberAvatarOf` (`staff-dashboard.ts`) and `chosen`,
   `removeBarber`, `laneOf` (`staff-block-editor.ts`); `staff-time-grid.ts`
   `rosterStartMinute = input<TrackMinute | null>(null)` (fed a
   `TrackMinute`, a `MinuteOfDay | null` and the block editor's frame);
   the block editor's `frameRosterStart` is `computed<TrackMinute>`:
   `trackMinuteOf(Math.min(...starts))` else `DAY_START`
   (`trackMinuteOf(0)`, the file's own zero). **`ofProven` site added:**
   `trackMinuteOf` (`TrackMinute.ofProven`) on the least of the chosen
   lanes' roster starts — each already a `TrackMinute` (non-negative,
   whole), so their minimum is one; it cannot refuse a value the frame
   takes today, and `0` → `DAY_START` is the same `0`.
5. **One `HttpsStatus`.** The functions edge's own 11-member copy is
   deleted; `edge.ts` and `edge.spec.ts` import `HttpsStatus` from
   `@core/errors` (spec: class 1). The Firebase link stays a compile-time
   check, `S` declared as `HttpsStatus` that `satisfies` a readonly record
   of `FunctionsErrorCode` (the server SDK's `FunctionsErrorCode` is the same
   17 spellings). `EDGE_WIRE`'s rows keep every status; the spec's
   "every row's status is an `HttpsStatus`" holds unchanged. Not taken (the
   review's optional rider, older untouched code): `trigger-attempt.system.ts`'s
   `GRPC_CODE_NAMES`/`TRANSIENT_CODES` and `subscribe-with-retry.ts`'s
   `RETRYABLE_CODES` name gRPC / Firestore SDK codes — another external
   vocabulary that shares the spellings — and stay as they are (§9.6).
6. **`DraftPersonKey.parse`** (`ids.primitive.ts`, JSDoc): exactly the
   three spellings the sheet mints — `primary`, `guest-<rest>` with a
   non-empty rest (a typed label as is, Cyrillic, spaces or `/` included),
   or a uid `UserId.parse` accepts — else `UserId.parse`'s refusal
   (`PRIMITIVE_ID_EMPTY` / `PRIMITIVE_ID_HAS_SLASH`) named for
   `DraftPersonKey`. Spec (`ids.primitive.spec.ts`): two new cases (each
   accepted spelling round-trips byte-identically and equals its builder's
   key; blank, whitespace and `users/u-1` refused with the exact struct);
   the id family's `it.each` now covers `DraftPersonKey` too (it has both
   doors), so its `of` identity row is a third new case. `setLegClient`
   keeps `DraftPersonKey.of` — the plan's edge table sanctions `X.of` for a
   DS choice-menu id the feature minted from its own keys
   (`legClientOptions`), and a parse there could only add a refusal no
   minted option triggers.

Spec cases: ecs-core +4 (5,802 → 5,806: `CallAnswer.tag` 1, `DraftPersonKey`
parse 2, the id family's `it.each` row 1); every other project's count
unchanged. Spec edits: `staff-visit-editor.spec.ts` (class 2 + its import),
`edge.spec.ts` (class 1), the two new-case files above.

#### Fixer, second round — the review's eight findings (2026-10-25)

A second review of the fixed tree confirmed eight findings (two of them the
same `LandingLocationId` site); the fixer applied each, the corrected fix
where the review gave one. **No runtime value, word, URL, CSS hook, test id,
stored document or callable answer changes — no new DEP.** By finding:

1. **The waitlist callable's cart (`apps/functions/src/wire/waitlist.wire.ts`
   `cartOf`).** The review's option (1), behaviour-preserving: a NEW D-4.1
   row records `cartOf` as a deliberate pre-door brand (`X.of`), and its
   comment now says why — judging a cart's ids is the door's question,
   answered in the door's own order (`WaitlistSystem.decide` checks the
   windows, the days and the cart's size and sequence first, then refuses a
   line `lineReadable` cannot read as `invalidRequest('cart')`); a `parse`
   at the wire would refuse ahead of those checks and refuse ids the door
   accepts today (an id holding `/`, a blank `seatKey` or `locationId`).
   Option (2) would have needed a DEP. Not taken: moving the cart into
   `WaitlistCall.Input` as raw strings (an ecs-core reshape of the call
   component and the door, beyond a minor finding).
2. **`seriesById` / `medalDetailVm` take a `BadgeSeriesId`**
   (`achievements.presenter.ts`, `medal-detail.presenter.ts`). The page
   keys brand ONCE at their readers with `BadgeSeriesId.of` (D-8.9):
   `achievement-detail.ts`'s `seriesId` input (one brand for both
   `medalDetailVm` and `detailAction`), `staff-visit-editor.ts`
   `detailAction`'s `page.subjectId`, and `barTitle`'s `AchievementDetail`
   branch; `ClientCardStore.detailAction(seriesId: BadgeSeriesId)`. A drawn
   medal (`MedalVm.seriesId: BadgeSeriesId | SeasonId`) is read through NEW
   `familyOfMedal(data, medal)` — the catalogue's family whose id EQUALS the
   medal's, so a season's id is never re-branded as a family's and finds
   none — at `trackInRing`, `medalScopeVm`'s `tileInRing` and its
   `earnedAmong` list (`medals.presenter.ts`), `neighboursOf`
   (`medal-detail.presenter.ts`) and `medalsGlanceVm`
   (`glance.presenter.ts`). It is today's lookup exactly (the same first
   match on the same string, `LoyaltyCatalogSystem.series`'s `find`), so
   even a season id that equals a family id answers as before; a narrowing
   on `opens` or on `season.trackSeriesId` would have changed that corner
   (catalogue ids are unique per collection only), so it was not taken.
   `soonSeriesIds` returns `readonly BadgeSeriesId[]` (the system's own
   type, no longer widened); `closeTiles`' ids were already branded. The
   identity re-branders of `archivedSeasons` go:
   `new Set(data.progress.keys())` / `new Set(data.seasonProgress.keys())`.
   `BadgeSeriesId` is a type-only import in `achievements.presenter.ts` now.
3. **`StatusFactTone`** (`visit-row.vm.ts`): `{ Neutral: 'neutral',
Warning: 'warning' }`, its values the `data-tone` CSS-hook contract
   (D-8.2) — the Status fact's `tone` field, emitted as members by
   `visit-row.presenter.ts`, compared through a `protected readonly
StatusFactTone` in `visit-row-words.ts`/`.html` (`fact.tone ===
StatusFactTone.Warning`; the `'warning'`/`'secondary'` it picks are
   `uiForegroundStyle` DS input values). Not taken (the optional rider):
   the tile's `'upcoming' | 'past' | 'hollow'` and the amount's
   `'primary' | 'secondary'` — both are DS input values (`UiDateTileTone`,
   the foreground styles) the presenter already fills from a words table or
   one ternary (§9.6).
4. **`LandingLocationId`** (`landing-location-zone.ts`) is the as-const
   dictionary `{ Center: 'center', Mladost: 'mladost' }`, its values the
   `LOCATIONS` entry ids and the `landing.location.<id>.*` i18n key segment
   (an external content contract, kept; deliberately not catalogue
   `LocationId`s, D-14); `locations.component.ts` imports it as a value and
   uses the members at its four sites. `LOCATIONS`' own `id` stays a plain
   string (typing it would make `landing-content.ts` import the zone file,
   which imports `LOCATIONS` — a cycle).
5. **`roles.data.ts`** ends at `} as const;` — the stale «Transitional
   names (pass D, D-12.2)» comment block is deleted (no export followed it).
6. **The onboarding phone field holds the struct**
   (`client-onboarding.ts`): `phoneErrorState = signal<PhoneError | null>`
   — set to `PhoneSystem.parse`'s refusal on blur, to
   `PhoneError.invalid('', PhoneInvalidReason.Invalid)` by the submit
   backstop (the component keeps no draft text; `attempted` is never
   printed), cleared by the reward-early effect. `phoneError()` words it by
   its own `errorCode` in an exhaustive switch, adding the `example` param
   only at wording time: `PHONE_INVALID` → `errors.PHONE_INVALID.<reason>`
   with the struct's own fields; `PHONE_COUNTRY_UNSUPPORTED` → the
   `invalid-country` line through `PhoneError.invalid(attempted,
InvalidCountry)` (the review's literal spread would have looked up
   `errors.PHONE_COUNTRY_UNSUPPORTED.invalid-country`, a key that does not
   exist — a changed word; `PhoneSystem.parse` never answers this code
   anyway, its unsupported country is `PHONE_INVALID`/`invalid-country`).
   Every `PHONE_INVALID.<reason>` line interpolates `{{example}}` only, so
   the extra `attempted`/`reason` params change no word.
7. **`eslint.config.mjs`'s `uiRawPrimitiveBlock` comment** says `*Minutes`
   is included (a time of day is `MinuteOfDay`/`EndMinute`/`TrackMinute`,
   a length `DurationMinutes`/`MinuteCount`), as `UI_RAW_BRAND_FIELD_SUFFIXES`
   enforces; selectors unchanged.

Spec cases: +2 — `achievements.presenter.spec.ts` «familyOfMedal finds the
family a family's medal names, and none for a season's own medal» (the
fixture's trackless `event-2026-beard-week`), and
`client-onboarding.spec.ts` «a default country the phone metadata lacks ›
words the held refusal by its own reason on blur — the invalid-country
line» (a `ZZ` default country; it pins today's words: the old code showed
the same `PHONE_INVALID.invalid-country`). Spec edits, class 2 (the
argument type forces the literal's form, the same strings):
`client-card.store.spec.ts` (`detailAction(BadgeSeriesId.of('…'))` ×7 +
its import), `medal-detail.presenter.spec.ts` (`medalDetailVm` through
`BadgeSeriesId.of` in `georgiPage`/`martinPage` and the «catalogue lacks»
case); class 1: `client-onboarding.spec.ts`'s `CountryIso2` import now a
value import.

### 9.2 Spec edits beyond §4.2/§4.3 (expected: none)

G edited no spec. Spec diff against `cf91b43`: 218 modified spec/type-spec
files (+5,775 / −3,058 lines), 36 new spec files (180 `it` cases at source
level), 3 deleted (`cart-line.data.spec.ts`, `catalog-status.data.spec.ts`,
`lane-gaps.spec.ts`, cases relocated — §9.1 G). Every DEP of §4.3 is named
in at least one spec (`grep -rhoE "DEP-[0-9]+"`: DEP-1…DEP-23 all present).
The case-by-case proof that each remaining edit is a §4.2 class or a §4.3
case needs the packages' own §9 notes (not in this file) and is the
integrator's step. Three spec edits are still MISSING (type-forced by wave
2–3 narrowings, open — §9.3): `staff-dashboard.spec.ts:2414-2415`
(`CatalogWording.price` takes `Money` now — class 2) and `:6764-6773`
(the card catalogue's lookups take `BarberId`/`ServiceId`/`LocationId` —
class 2); `admin-rhythm-sheet.spec.ts:520-535` (the picker's `uiPicked` is
`output<LocalDate>` — the `it.each` of non-days is class 4, unrepresentable,
like `admin-rhythm.store.spec.ts:1252`'s).

**Second round (G).** The three missing type-forced edits are made
(§9.1 G second round), and the case-by-case proof is done against the
packages' own notes (now §9.1): `git diff cf91b43` over every spec and
type-spec — 224 tracked spec files modified or deleted (+5,797 / −3,301),
38 new spec files, 4 deleted (`cart-line.data.spec.ts`,
`catalog-status.data.spec.ts`, `lane-gaps.spec.ts`, and
`gamification.data.spec.ts` → renamed `loyalty-vocabularies.spec.ts`,
byte-identical cases). A scripted sweep paired every diff hunk's removed
assertion lines with its added lines and listed each hunk where a removed
assertion's literal (a string or number in `toBe`/`toEqual`/… or a bare
expected-value line) does not reappear in the added lines: **30 files**, every
hunk classified —
class 1/relocation (the cases moved byte-identical into a split file's new
spec: `client-stats`, `opening-hours`, `party`, `placement-policy`,
`roster-window`, `schedule-version`, `seat-id-pair`, `seat-outcome`,
`service-terms`, `staff-verb` → `arrival-verb`/`mark-arrival-action`,
`booking-flow` → `move.error`, `visit-draft` `accountKeyOf` →
`ids.primitive`); class 2 (a type change forces the literal's form: the
identity flow's struct retype in `auth-flow.data`/`onboarding-flow.data`/
`auth-flow.system`/`onboarding-flow.system`, `audit-context.data`'s
`CancellationReason`, `landing-content.service`'s `price(Money)`,
`client-card.contracts`'s `landsOn` pin, `wall-clock`'s `Currency`);
class 3 (an internal literal now a dictionary member: `grid-gesture`'s
`ScrollAxis.Y`, the dashboard's `DayPicker.Scope`/`DiscardTarget.Visit`,
`admin-rhythm.words`' menu ids, `client-card.store`'s `ClientCardPage`
members); class 4 (unrepresentable: the rhythm store's and sheet's non-day
`it.each`, the preview's `'someday'`, `wall-clock`'s JPY,
`client-card.store`'s `barTitle('discount', null)` — `barTitle` takes a
`ClientCardPage`, and the editor maps only its card pages through
`editorCardPages`); class 5 (deleted with their subject: the rhythm sample
delegates, `visit-draft`'s «whose a person key is»); DEP cases
(`icon-manifest`/`icon-resolver` — DEP-16; `client-card.words`' key list
157 → 158 — the X-3 catalogue change: four `admin.rhythm.refused.*` keys
out, five `errors.LOYALTY_STREAK_PUBLISH_*` in, same words); and three
assertions retargeted on purpose with their intent kept
(`app.config.spec`/`lazy-port.forms.spec` `isFrozen` → `isLazyPort`, F-1;
`edge.spec`'s `ANSWERED` read from `StreakPublishError.ANSWERED_CODES`,
D-9.7; `ecs-syntax.spec.mjs`'s «*Minutes» case flipped with the guard).
Every other modified hunk carries its assertion literals over unchanged
(brand constructors and dictionary members wrapped around the same values).
**Nothing beyond §4.2/§4.3 is left unexplained.**

**Fixer rounds.** The first fixer round's spec edits are listed in §9.1
Fixer (`staff-visit-editor.spec.ts` class 2, `edge.spec.ts` class 1, two
new-case files); the second round's in §9.1 Fixer, second round
(`client-card.store.spec.ts` and `medal-detail.presenter.spec.ts` class 2,
`client-onboarding.spec.ts` class 1 + one new case,
`achievements.presenter.spec.ts` one new case). Every literal is carried
over unchanged; nothing beyond §4.2/§4.3 is left unexplained.

### 9.3 Gate record (§6.2 numbers against HANDOFF §4's pass-C reference)

G's run on the integrated tree (2026-10-25, before the open items below are
fixed; every run `--skip-nx-cache`, `--skipSync` while sync is red):

| Step                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass-C reference                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `nx sync:check`                                             | **RED** — `libs/features/marketing/landing/tsconfig.lib.json` and `libs/features/shared/catalog/tsconfig.lib.json` miss the reference to `libs/ui/wall-clock/tsconfig.lib.json` (both now import `@creativo/ui/wall-clock`); `pnpm nx sync` fixes it (the root `tsconfig.json` lines in the message are listed only because a change exists — its references stay `[]`, no project `tsconfig.json` is composite)                                                                                                                                                                                                                                                                                     | up to date                             |
| `verify-tools:layering`                                     | green — 884 files, 3,927 import edges; (a)–(e) ok                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 703 / 3,305                            |
| `run-many -t typecheck` (fresh `dist/out-tsc`)              | 39 projects; red: `patterns` (baseline), **`staff-dashboard`** (8 errors, all in `staff-dashboard.spec.ts`: `:2415` `number` → `Money`; `:6764-6773` raw strings → `BarberId`/`ServiceId`/`LocationId`), **`admin-loyalty`** (1, `admin-rhythm-sheet.spec.ts:529`)                                                                                                                                                                                                                                                                                                                                                                                                                                   | `patterns` only                        |
| `run-many -t lint`                                          | 43 projects, 0 errors; 239 warnings — none on a line pass D wrote in substance (4 sit on moved or re-wrapped pre-existing code: the icon manifest's parser split out of `icon-manifest.ts`, `achievements.presenter.ts:1399/1405`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 43, 0 errors                           |
| `run-many -t test --parallel=3`                             | 41 of 42 runs; **12,186 passed**, 7 failed = the 6 baseline reds + **`staff-dashboard.spec.ts` "quotes each chair the terms the server will charge"** (the `price(major)` call above, failing at run time); **`web:test` not run** — its Angular build fails (below); pass C's 18 web cases uncounted. No project's count dropped: ecs-core 5,666 → 5,801, staff-dashboard 498 → 535, client-booking 290 → 307, i18n 75 → 91, lint-rules 290 → 315, ui-wall-clock 20 → 33, shared-catalog 56 → 69, client-onboarding 34 → 42, admin-loyalty 259 → 262, view-state 12 → 17, functions 916 → 920, icons 63 → 65, staff-client-card 977 → 980, controls 237 → 238, firebase-app 81 → 82, the rest equal | 42 runs, 11,922 + 6                    |
| `test ecs-core --coverage`                                  | 314 files, 5,801 tests, **98.26 %** statements (13,937 / 14,183)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 98.22 % (≥ 98.00)                      |
| `typecheck seed-tools`                                      | green (inside the run-many)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | green                                  |
| `build web`                                                 | **RED** — `staff-day-pill.ts:146` `[uiSelected]="selectedKey()"`: `'' \| LocalDate` is not `LocalDate \| null` (W2-U narrowed `UiMonthPicker.uiSelected`; the pill still hands the old `''` "none")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 600.15 kB                              |
| `verify:bundle`                                             | not run (build red)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ≈ 600 kB                               |
| `build functions` + `check-functions-deps`                  | green — 4 runtime dependencies as recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | same                                   |
| runbook grep gates, `verify:p0`, `test:emulator`, `e2e:web` | not run by G (package rule: the integrator runs them, one at a time)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 28/22/17/6/24/27/25; 65 + 253; 41 + 19 |

**Second round (G, 2026-10-25) — the FULL gate, one command at a time,
every run `--skip-nx-cache`:**

| Step                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                   | Pass-C reference                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `nx sync:check`                                        | up to date (after `nx sync`)                                                                                                                                                                                                                                                                                                                                                                                             | up to date                                |
| `verify-tools:layering`                                | green — 895 files, 3,972 import edges; (a)–(e) ok                                                                                                                                                                                                                                                                                                                                                                        | 703 / 3,305                               |
| `rm -rf dist/out-tsc` + `run-many -t typecheck`        | 39 projects; red only `patterns` (baseline)                                                                                                                                                                                                                                                                                                                                                                              | `patterns` only                           |
| `run-many -t lint`                                     | 43 projects, 0 errors, 239 warnings                                                                                                                                                                                                                                                                                                                                                                                      | 43, 0 errors                              |
| `run-many -t test --parallel=3`                        | 43 test targets; **12,283 passed** + exactly the 6 baseline reds (`gauge.spec.ts` 4, `visit-pills.spec.ts` 1, «strikes an hour that did not happen» 1); `web:test` 18 (pass C's 18). Against round one: ecs-core 5,801 → 5,802 (+ `MinuteCount.fromDelta`), i18n 91 → 93 (+ `loadedLanguage`), admin-loyalty 262 → 258 (the sheet's 4 class-4 rows; against pass C's 259: −9 retired rows, +8 new cases), the rest equal | 11,922 + 6                                |
| `test ecs-core --coverage`                             | 314 files, 5,802 tests, **98.27 %** statements (13,938 / 14,183), 99.15 % lines                                                                                                                                                                                                                                                                                                                                          | 98.22 % (≥ 98.00; the task's floor 97.85) |
| `typecheck seed-tools`                                 | green                                                                                                                                                                                                                                                                                                                                                                                                                    | green                                     |
| `test lint-rules`                                      | 13 files, 315 tests                                                                                                                                                                                                                                                                                                                                                                                                      | 290                                       |
| `lint:styles`                                          | green                                                                                                                                                                                                                                                                                                                                                                                                                    | green                                     |
| `build web` + `verify:bundle`                          | green; initial **574.76 kB** (156.93 kB transfer), firestore/storage/libphonenumber-js not initial; the `gauge.css` budget warning is `cf91b43`'s own                                                                                                                                                                                                                                                                    | 600.15 kB                                 |
| `build functions` + `check-functions-deps`             | green — the four runtime dependencies                                                                                                                                                                                                                                                                                                                                                                                    | same                                      |
| runbook §4.2 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 | **28 / 22 / 17 / 6 / 24 / 27 / 25 `ok`, 0 FAIL, 0 ERROR** (first run §4.2 27 + 1 FAIL: «coupons' enabled» on a new adapter comment, reworded); the same counts with `git grep --untracked`, so the 220 new files are gated too                                                                                                                                                                                           | 28/22/17/6/24/27/25                       |
| `verify:p0`                                            | (a)–(f) pass                                                                                                                                                                                                                                                                                                                                                                                                             | (a)–(f)                                   |
| `test:emulator`                                        | 65 + 253                                                                                                                                                                                                                                                                                                                                                                                                                 | 65 + 253                                  |
| `e2e:web`                                              | 41 passed + exactly the 19 baseline failures (6 `*-screenshots`, `landing.spec.ts:121`, the glance's 12 runs of `:336`/`:679` failing at `:377`/`:758` — `cf91b43`'s `:343`/`:686` at `:384`/`:765`, the spec seven import lines shorter since W3-T's `shop-clock.ts`, the same assertions)                                                                                                                              | 41 + 19                                   |

**The initial bundle's −25.39 kB**, per file against a `cf91b43` build with
`--stats-json` (`d-diff/base`): only `libs/ecs-core` moved (118.38 →
89.18 kB). The L-1 splits let the initial closure import small dictionary
files instead of whole multi-name files — out: `engagement.error.ts`
(10.9 kB), `streak-rule.data.ts` (7.9), `cart-line.data.ts` (4.3),
`streak-interval.data.ts` (3.4), `booking-policy.data.ts` (3.1),
`streak-qualifier.data.ts` (2.5), `seat-outcome.data.ts` (2.4),
`booking-lifecycle.data.ts` (2.1), part of `booking-flow`/`identifier`/
`role.data.ts`; in: `booking-cart.data.ts` (3.5), `schedule-selection`
(1.2), `parsed-identifier` (1.0), `roles` (0.9), `seat-key`,
`minute-of-day.primitive.ts` (+0.8, `parseClock`), `pipeline.error.ts`
(+0.6, `HttpsStatus`), `streak-rule-direction.data.ts` (0.12 — what the
publish answer actually names), … Every framework and SDK input is equal
to the byte (path normalisation aside).

**Fixer round (2026-10-25, after the review's six findings, §9.1 Fixer) —
the FULL gate again, one command at a time, every run `--skip-nx-cache`:**

| Step                                                   | Result                                                                                                                                                                                                                            | Second round              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `nx sync:check`                                        | up to date                                                                                                                                                                                                                        | up to date                |
| `verify-tools:layering`                                | green — 895 files, **3,973** import edges (+1: `repository.error.ts` → `@core/primitives` for `Tag`); (a)–(e) ok                                                                                                                  | 895 / 3,972               |
| `rm -rf dist/out-tsc` + `run-many -t typecheck`        | 39 projects; red only `patterns` (baseline, `findLast`)                                                                                                                                                                           | `patterns` only           |
| `run-many -t lint`                                     | 43 projects, 0 errors, 239 warnings                                                                                                                                                                                               | 43, 0 errors, 239         |
| `run-many -t test --parallel=3`                        | 43 test targets; **12,287 passed** (42 Vitest runs 12,208 + `verify-tools` 79 node tests) + exactly the 6 baseline reds; ecs-core 5,802 → **5,806** (§9.1 Fixer: +4), every other project equal; `web:test` 18                    | 12,283 + 6                |
| `test ecs-core --coverage`                             | 314 files, 5,806 tests, **98.27 %** statements (13,937 / 14,182), 99.16 % lines                                                                                                                                                   | 98.27 % (13,938 / 14,183) |
| `typecheck seed-tools`                                 | green                                                                                                                                                                                                                             | green                     |
| `test lint-rules`                                      | 13 files, 315 tests (inside the run-many)                                                                                                                                                                                         | 315                       |
| `lint:styles`                                          | green                                                                                                                                                                                                                             | green                     |
| `build web` + `verify:bundle`                          | green; initial **574.83 kB** (156.91 kB transfer; `libs/ecs-core` 89.18 → 89.28 kB: `CallAnswer.tag`, `Tag` in the repository guard); firestore/storage/libphonenumber-js not initial; `gauge.css` budget warning `cf91b43`'s own | 574.76 kB                 |
| `build functions` + `check-functions-deps`             | green — the four runtime dependencies                                                                                                                                                                                             | same                      |
| runbook §4.2 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 | **28 / 22 / 17 / 6 / 24 / 27 / 25 `ok`, 0 FAIL, 0 ERROR** (the blocks extracted fresh from the runbook, `git grep --untracked`)                                                                                                   | 28/22/17/6/24/27/25       |
| `verify:p0`                                            | (a)–(f) pass                                                                                                                                                                                                                      | (a)–(f)                   |
| `test:emulator`                                        | 65 + 253                                                                                                                                                                                                                          | 65 + 253                  |
| `e2e:web`                                              | 41 passed + exactly the 19 baseline failures (6 `*-screenshots`, `landing.spec.ts:121`, the glance's 12 runs of `:336`/`:679` failing at `:377`/`:758`)                                                                           | 41 + 19                   |

**Fixer, second round (2026-10-25, after the review's eight findings,
§9.1 Fixer, second round) — the FULL gate again, one command at a time,
every run `--skip-nx-cache`:**

| Step                                                   | Result                                                                                                                                                                                                       | First fixer round   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `nx sync:check`                                        | up to date                                                                                                                                                                                                   | up to date          |
| `verify-tools:layering`                                | green — 895 files, 3,973 import edges; (a)–(e) ok                                                                                                                                                            | 895 / 3,973         |
| `rm -rf dist/out-tsc` + `run-many -t typecheck`        | 39 projects; red only `patterns` (baseline, `findLast`)                                                                                                                                                      | `patterns` only     |
| `run-many -t lint`                                     | 43 projects, 0 errors, 239 warnings                                                                                                                                                                          | 43, 0 errors, 239   |
| `run-many -t test --parallel=3`                        | 43 test targets; **12,289 passed** (42 Vitest runs 12,210 + `verify-tools` 79 node tests) + exactly the 6 baseline reds; `staff-client-card` +1 and `client-onboarding` +1 (§9.1), every other project equal | 12,287 + 6          |
| `test ecs-core --coverage`                             | 314 files, 5,806 tests, **98.27 %** statements (13,937 / 14,182), 99.15 % lines (12,090 / 12,193)                                                                                                            | 98.27 %             |
| `typecheck seed-tools`                                 | green                                                                                                                                                                                                        | green               |
| `test lint-rules`                                      | 13 files, 315 tests (inside the run-many)                                                                                                                                                                    | 315                 |
| `lint:styles`                                          | green                                                                                                                                                                                                        | green               |
| `build web` + `verify:bundle`                          | green; initial **574.83 kB** (156.97 kB transfer); firestore/storage/libphonenumber-js not initial; `gauge.css` budget warning `cf91b43`'s own                                                               | 574.83 kB           |
| `build functions` + `check-functions-deps`             | green — the four runtime dependencies                                                                                                                                                                        | same                |
| runbook §4.2 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 | **28 / 22 / 17 / 6 / 24 / 27 / 25 `ok`, 0 FAIL, 0 ERROR** (the blocks extracted fresh from the runbook, `git grep --untracked`)                                                                              | 28/22/17/6/24/27/25 |
| `verify:p0`                                            | (a)–(f) pass                                                                                                                                                                                                 | (a)–(f)             |
| `test:emulator`                                        | 65 + 253                                                                                                                                                                                                     | 65 + 253            |
| `e2e:web`                                              | 41 passed + exactly the 19 baseline failures (6 `*-screenshots`, `landing.spec.ts:121`, the glance's 12 runs of `:336`/`:679` failing at `:377`/`:758`)                                                      | 41 + 19             |

§5 checklist after the round: item 1 — 0; item 2(a) — 15 reviewed hits (18
before: `detailAction`, `seriesById` and `medalDetailVm` now take a
`BadgeSeriesId`; left: 6 `testId`, 7 the «днес» word `today`, the
`photoById`/`barTitle` page-key readers); 2(b) 17 production hits (+ the
client-card fixture); 2(c) 0 in production; items 3, 5 and 6 as the second
run recorded.

### 9.4 DOM differential record (§6.3)

Run by G on `git archive cf91b43` under the scratchpad's `d-diff/base`
(`node_modules` symlinked, nothing installed), every §6.3 project, pass C's
wrapper-config method (`d-diff/dom/run-all.sh`, capture after each
`detectChanges()` and `whenStable()`, last value per test wins). Both sides
ran: base 20 projects (red only where the baseline is: `visit-pills`, `visits-page.presenter`), the
integrated tree the same plus the dashboard's one type-forced failure
(above). 94 capture files, 1,474 tests compared; 0 tests only on the base
side; 45 only on the new side (the DEP and new-behaviour tests: dashboard
22, booking 10, onboarding 6, admin-loyalty 4, catalogue 2, controls 1).
Normalised as pass C, plus `svc-unknown-<n>` (a fixture id counter that
shifts with every test added before it). 82 tests differ:

- **7 — DEP-4** (dashboard): the agenda's 09:00 group at the pinned
  `09:00:00.000` clock gains `data-past` and the now anchor moves after it;
  each test is byte-identical once those two attributes are stripped.
- **3 — the row-error line** (dashboard: "writes neither the note nor the tip
  when the batch is refused as stale", "does not reload on any other
  refusal", "reloads the visit and says so in one line"): the base drew
  `staff-row-error` only because those specs stub `store.errorFor` for EVERY
  key; `rowError` receives the ROW key (`appointmentId#barberId`), which the
  store's appointment-keyed map never holds, so production printed nothing
  before and prints nothing now (the new body scans `store.errors()` by text
  and no longer calls the stub). Production-identical; the never-matching
  key is a defect carried as found (§9.6). Clean with DEP-4 once stripped.
- **2 — the block editor's now label** ("follows the frame: a start stepped
  to Thursday…", "steps its day like the visit sheet…"): the isolated spec
  hands a STATIC VM, so the base kept today's now label and `data-today` on
  the stepped-to day; in production the base host recomputed
  `nowMinute: frameDay === todayKey ? … : null` from the editor's
  `dayChanged` mirror (`blockDraftDay`), which is exactly the new
  `frameNowMinute` (`now.localDate === draft().dayKey`). Production-identical;
  a harness artifact.
- **2 — `ui-progress-ring` "clamping"** (fast-check property tests: the last
  capture is a random sample; the component is untouched by pass D).
- **68 — whitespace only, NOT a DEP** (client-card 57 in `client-card.spec.ts`
  and `client-loyalty.spec.ts`, visit editor 11): 126 `<h3 uiTitle>` text
  nodes gained one space at each end («Посещения» now prints with a space
  before and after it) because
  Prettier wrapped the heading once its id became
  `headingId(ClientCardRegion.X)`; Angular keeps one space at each end of an
  interpolated text node (the achievements heading already printed that way
  at `cf91b43`). Render- and accessible-name-identical; byte-identity is
  restorable by keeping each interpolation on its `<h3>` line (open).

No other difference: with the whitespace edges ignored the residue is
exactly the 7 + 3 + 2 + 2 above.

**Second round (G, after every fix):** the integrated side re-captured for
all 20 projects (the `cf91b43` side's captures are the first round's — its
tree is unchanged); compared STRICTLY (no whitespace-edge normalisation) and
with it: 94 capture files, **1,470 tests** compared (round one's 1,474 − the
sheet's 4 retired rows), 0 only on the base side, 41 only on the new side
(the DEP and new-behaviour tests: dashboard 22, booking 10, onboarding 6,
catalogue 2, controls 1). **13 differ, 0 of them whitespace-only** (the 68
`<h3>` text nodes are byte-identical again):

- 7 — DEP-4 (clean once `data-past`/`data-now-anchor` are stripped);
- 3 — DEP-4 plus the row-error stub (clean once both are stripped; the
  never-matching row key, §9.6);
- 2 — the block editor's now label in its isolated spec (the static-VM
  harness artifact explained in round one; production-identical);
- 1 — `ui-progress-ring` «clamping» (a fast-check property: the last capture
  is a random sample; the component is untouched by pass D).

Nothing else differs. Every difference is a declared DEP or the round-one
artifacts.

### 9.5 Smoke record (§6.4)

Not run by G's first round (the build was red until the day-pill fix).
**Run by the second round, after the emulator journeys (2026-10-25,
06:34–07:40 EET):** `pnpm run dev` (the four emulators, `seed:dev`, the web
on :4200) served the integrated tree, and the `git archive cf91b43` copy
(`d-diff/base`, `node_modules` symlinked) was served on :4300
(`nx run web:serve:development`) against the same emulators and seed. Pass
C's Playwright harness, adapted (`d-smoke/smoke.mjs`, `smoke2.mjs`), drove
both sides read-only with custom tokens minted as the e2e harness mints
them (`window.__e2eSignIn`: `dev-client-1` as client, `dev-staff-ivan` as
barber + admin) and wrote a DOM signature per screen (every element, every
attribute but Angular's generated ones, ids, inline styles and URLs, and all
text) in bg, then en.

- **Round 1 — today (Sunday 2026-10-25, the shop closed), 13 screens per
  language, 26 signatures per side:** the landing's `main`, `/book`'s
  services step, `/account`, `/account/appointments`, the staff day /
  three-day / week views, the search sheet (a name «Георги»; a phone's digits
  «0888»), `?view=day&day=2026-02-30`, the create sheet, the block sheet and
  `/admin/loyalty/rhythm`. **14 byte-identical; 10 differ only by the clock
  between the two runs** (the now-label minute and `data-near-now`, the
  create sheet's drafted start); **2 by DEP-13** — `cf91b43` keeps
  `?day=2026-02-30` (an empty canvas, a blank pill), the integrated tree
  answers today and rewrites the URL to `/staff/schedule?view=day`.
- **Round 2 — the next open day (`&day=2026-10-26`), 53 screens per
  language, 106 signatures per side:** the four views, the agenda, the visit
  sheet of all nine chairs (verbs, the resolution head, the frame and its
  neighbours, the money rows), the search, the refused day, the create and
  block sheets, and for Георги and Мартин the client card, wallet, ledger,
  medals, records, eight medal details, the running season and one of its
  families, the history page and its filter menu, plus the admin rhythm.
  **102 byte-identical; 2 differ by the create sheet's drafted start (the
  clock), 2 by DEP-13.**

Console sets match (the same 26 media 404s per language on both sides;
«Transition was skipped» 42/41 against 40/40 — navigation timing). Not
smoked: the landing's and `/book`'s service detail sheet (the tile press
never opened `catalog-sheet` in this headless run on EITHER side — the same
on `cf91b43`, so the harness, not pass D; the sheet's DEP-19 rendering is
pinned by `service-detail-sheet.component.spec.ts` in the §6.3
differential), writes of any kind (a save, a block, a booking), the booking
flow past the services step, onboarding and the OTP screen, and the DST
boundary DEPs (DEP-1…DEP-12, DEP-15, DEP-17 — no seeded visit sits in a
changeover hour; each is spec-pinned at its boundary, §4.3). The dev stack
and the :4300 server were stopped afterwards; the emulators keep no data,
so the seed state is the committed seed's and every port is free.

### 9.6 Carried forward (to HANDOFF §3.3)

- §8's open questions with their defaults as applied: OQ-1 `TrackMinute` a
  brand; OQ-2 stray helper types in their own files; OQ-3 pooled answers on
  each visit's own shop clock (DEP-6/7); OQ-4 `parseIsoIn`/`toIso` kept for
  e2e support and specs; OQ-5 the telemetry level unchanged; OQ-6
  `windowHours` raw; OQ-7 `cadenceOf` on instants; OQ-8 the shell's `UiTheme`
  copy; OQ-9 the editor save's orchestration in the component; OQ-10
  `LoyaltyCatalog` in `entities/loyalty-catalog.ts`; OQ-11 the icon
  diagnostic codes' kebab spellings; OQ-12 the pipelines' error unions
  moved; OQ-13 claims-tolerant role predicates; OQ-14 `E164` a component
  brand; OQ-15/16 bills and catalogue prices in the stored currency (DEP-21,
  DEP-19); OQ-17 `SeatKeyText`'s two spelling families documented, not
  split; OQ-18 the reactive error lines (DEP-23); OQ-19 the photo titles in
  `'bg-BG'`.
- The KEEP-PARKED lifecycle write verbs, `VoucherSystem.redeem`,
  `IntervalSetSystem.clip` (pass C §9.6, owner call).
- The dashboard's row-error line never matches (`rowError` gets the row key
  `appointmentId#barberId`; the store keys errors by appointment id) —
  production prints no row error before or after pass D; a defect for a
  later pass with a DEP.
- The first round's open items are CLOSED by the second (§9.1 G second
  round). Still for the owner or a later pass: `seedDraft` turns a VM start
  of 1440 into a defect (a walk-in create opened at 23:56–23:59, as on
  `cf91b43`; R-5); `VisitRowOptions`/`VisitCardOptions.subjectCustomerId`
  stays optional (`undefined` = read the record off the seat; making it
  required is a spec change); `libs/ui/icons/eslint.config.mjs` turns
  `no-restricted-syntax` off on its non-suffix files, so W3-G's raw-brand
  guard is off there too (zero hits measured); `AchievementsSystem.firstStart`
  and `ZonedTimeSystem.parseIsoIn`/`toIso` have spec/e2e callers only (OQ-4
  kept them); `rhythmPreviewReadsFacts` is a spec-only delegate; the
  remaining avatar-upload unions are spelled per surface
  (`AccountsError | UploadAvatarUploadFailed | IdentifierMissing` — the
  profile page's check answers the whole `AccountsError`);
  `client-profile.ts` reads the stored `BirthDate` through `LocalDate.parse`
  (no `BirthDate` → `LocalDate` member; identical for every stored value
  `firestore.rules` admits); `UiDayKey` survives as an alias of `LocalDate`;
  two spec titles name the retired `seatStartUtcMs`, and
  `session-identity.service.spec.ts`/`role.rules-parity.spec.ts` titles the
  retired role-list constants (test names, left as they are).
- From the fixer round (§9.1 Fixer): `trigger-attempt.system.ts`'s
  `GRPC_CODE_NAMES`/`TRANSIENT_CODES` and `subscribe-with-retry.ts`'s
  `RETRYABLE_CODES` keep their own spellings of the gRPC / Firestore SDK
  codes (an external vocabulary that shares `HttpsStatus`'s strings; older
  code pass D did not touch) — naming them through `HttpsStatus` members is
  optional; `setLegClient` keeps `DraftPersonKey.of` (edge-table row:
  a DS choice-menu id minted from the feature's own keys).
- From the second fixer round (§9.1 Fixer, second round): the waitlist
  callable's cart keeps its pre-door `X.of` brands (D-4.1 row) — moving the
  cart into `WaitlistCall.Input` as raw strings parsed inside the door is
  the cleaner home, an ecs-core reshape for a later pass; `familyOfMedal`
  keeps today's lookup of a drawn medal's id among the families (a season
  without a track family whose id equals a family's id would still draw
  that family's ring — catalogue ids are unique per collection only; making
  the archive tile carry its family id, or validating ids across
  collections, is a behaviour change for the owner); the visit row's tile
  tone and amount emphasis stay DS-input-valued unions.

---

## DEPARTURES

Each is a D-2 exception: (a) OQ-14, (b) the icon manifest, or (c) two live
rules for one value. "Sofia" = Europe/Sofia; spring-forward 2026-03-29
(03:00 EET → 04:00 EEST, 03:00–03:59 does not exist), fall-back 2026-10-25
(04:00 EEST → 03:00 EET, 03:00–03:59 happens twice; ingestion stores the
EARLIER offset).

**DEP-1 — a row "in the chair now" (`sd:3623-3626`).** (a). _Before:_
`startMs ≤ nowMs < endMs ∧ ¬settled`, instants from `wallClockInstant` in
`store.zone()`. _After:_ `hasStarted ∧ ¬hasEnded ∧ ¬settled` on the wall
clock with `store.shopNow()`. _Changes only:_ inside the fall-back repeat
hour — a visit stored 03:00–03:30 on 2026-10-25, at the SECOND 03:10
(01:10Z): before NOT live (its end instant 00:30Z has passed), after LIVE
(190 < 210), `data-live` set. No spring-forward difference (no "now" falls
in a gap minute); no cross-zone difference (rows and `ShopNow` share the
day's zone). _Specs:_ §4.3.

**DEP-2 — the chair's next visit (`sd:2639`).** (a). _Before:_ first
`¬terminal ∧ startMs > nowMs` in the lane's array order. _After:_ first
`¬terminal ∧ ¬hasStarted` in the SAME array order (the lane's
`appointments`, sorted by the envelope instant in `observeBarberDay` — not
re-sorted by this barber's seat start, so an ordinary day with a
sequential second leg keeps today's choice). _Changes only:_ fall-back
hour — a 03:45 visit at the second 03:10: before started (not next), after
not started → `data-next`.

**DEP-3 — past (rows `sd:3622`, grid visits `:2259`, grid blocks `:2314`).**
(a). _Before:_ `endMs ≤ nowMs`. _After:_ `hasEnded`. _Changes only:_ an hour
that ended in the first pass "un-ends" in the second (a 03:00–03:30 visit at
the second 03:10: `data-past` and the receded card turn off; at the second
03:40 they are on again). Blocks: the same once they read `MinuteRange`. The
lane run's order (T-9) is unchanged within one zone (the earlier-offset
instant is monotone in wall time).

**DEP-4 — the agenda's past groups and its now line (`sd:2721`, `:2745`).**
(a) + a millisecond edge. _Before:_ the group's floored minute key `<
nowMs` (past), first key `≥ nowMs` (now index). _After:_ `hasStarted` on the
group's minute / first group not started. _Changes:_ (1) the fall-back hour,
as DEP-3; (2) when `nowMs` falls EXACTLY on a minute's millisecond 0: the
group starting that minute was not past and is past now; the now line moves
after it. Production's minute tick reads arbitrary milliseconds (`st:942`),
so the two agree on every other instant; the dashboard spec's clock is
exactly `2026-08-05T09:00:00.000` with a 09:00 group — those expectations
are edited on purpose (§4.3). Chosen over a strict `<` because strict would
differ from production for 59.999 s of every minute.

**DEP-5 — the agenda group's key (`sd:2709`, `staff-dashboard.html:606/613`).**
(a). _Before:_ `String(floor(startMs/60000)·60000)` → DOM id
`agenda-time-1785909600000` (09:00 on the spec's 2026-08-05) and its `aria-labelledby`. _After:_
`String(startMinutes)` → `agenda-time-540`. An internal id-ref pair (no spec
or e2e reads it); bucketing is unchanged within one shop day.

**DEP-6 — search: past, order, when label (`sd:1540`, `:1562`, `:1600`).**
(a). _Before:_ past = the visit's end instant computed in the ANCHOR day's
zone vs `nowMs` (`+∞` before the zone); order by `utcEpochMs`; the label =
`utcEpochMs` formatted in the day's zone (`''` while the day's zone is
unknown). _After:_ `hasEnded` with the visit's OWN shop's `ShopNow`
(`store.shopNowAt(locationId)`; not past while it is `null`, as today's
`+∞`); `WallTime.compare` (future soonest, past newest); the label from the
visit's own `localDate`+`startMinutes`, still `''` while `store.zone()` is
`null` (gated exactly as `instantLabel` is). _Changes only:_ the fall-back hour, and a
pooled visit at a shop in ANOTHER zone (whose past, place in the order and
printed time now follow its own clock — today they follow the anchor day's
zone, a latent bug). The order is identical within one zone.

**DEP-7 — «Скорошни» (`sd:5713-5716`, `:5730`).** (a) + a millisecond edge.
_Before:_ `utcEpochMs < now` (a fresh `clock.nowUtcMs()` read at browse
time), newest first by instant, the date from `utcEpochMs` in the day's
zone (`''` before it is known). _After:_ `hasStarted` (start ≤ now) with
the visit's own shop `ShopNow` from `store.shopNowAt(locationId)` — the
store's minute TICK, not a fresh read; for a visit whose shop has no known
zone (`shopNowAt` `null`, before any zone is known) today's stamp rule
`utcEpochMs < nowMs()` decides, so the pre-zone list is kept;
`WallTime.compare` descending; the date from `localDate`, `''` while
`store.zone()` is `null`. _Changes only:_ the fall-back hour (a 03:40 visit
at the second 03:10 is excluded), another zone's shop, a visit starting at
EXACTLY the tick's instant (now included), and a visit that started
between the store's last tick and the moment «Скорошни» opens (at most one
tick, < 60 s: before included by the fresh read, after excluded until the
next tick — the search and «Скорошни» now answer from one tick).

**DEP-8 — the catalogue tag «±N мин» (`sd:3413-3416`).** (a). _Before:_ span
`round((endMs − startMs)/60000)`. _After:_ `MinuteCount.span(startMinute,
endMinute)`. Sofia 2026-03-29, visit 02:30–04:30 booked for 120: before 60
(«−60 мин»), after 120 (no tag). Sofia 2026-10-25, visit 03:30–04:30 booked
for 60: before 120 («+60 мин»), after 60 (no tag). `DayRowVm.durationMinutes`
changes the same way but has no reader — deleted, not a departure.

**DEP-9 — the block sheet's seeded end (`sd:6386`).** (a), a bug fix.
_Before:_ `minuteAfter(start, end)` = start minute + elapsed instants.
_After:_ the block's own `endMinutes`. A block 02:00–05:00: on 2026-10-25
before 06:00 (360), after 05:00 (300); on 2026-03-29 before 04:00 (240),
after 05:00.

**DEP-10 — lane boundary minutes in a spring-forward gap (lanes, `openWindowsOf`,
`rosterHull`, `rosterExtent`, block minutes, gap labels and minutes).** (a).
_Before:_ a window, block or gap boundary inside the gap was drawn and
labelled at the gap END (`instantOn`'s walk, read back by `minuteAt`): a
window from 03:30 on 2026-03-29 started at 04:00. A window straddling the
fall-back hour read its end 60 minutes late through `minuteAfter`. _After:_
the stored minutes (03:30; the window's own end). Every other day:
identical (rangesOn/intervalsOn round-tripped the same minutes).

**DEP-11 — the block event id (`sd:2302`, `staff-time-grid.html:207`
`data-event-id`).** (a). _Before:_ `block:<barberId>:<startMs>`, parsed back
with `Number(…)` and found by `startMs` among the ANCHOR day's lanes
(`store.lanes()`, `st:1931-1935`) — a block of another day in the
three-day/week views (built from every visible cell, `sd:1976-2010`) never
matched, so its tap did nothing. _After:_ `block:<barberId>:<localDate>:<startMinutes>`
(the instant carried the day; the minute alone would not). `openBlock`:
`localDate !== store.dayKey()` → no-op (today's answer kept); else the
anchor lane's block found by `MinuteRange.startMinutes` (`MinuteOfDay.of`
on the parsed part). Without the day in the key, a non-anchor-day tap
would open — and let the sheet edit or delete — the anchor day's block at
the same barber and minute; the spec pins that it does not. The only
change is the id's spelling (`data-event-id`); no e2e reads it; spec ids
`'block:ivan:1'`/`'block:niko:0'` are opaque strings (unchanged unless a
spec builds the id from a block).

**DEP-12 — the countdown and the live remaining (`sd:3096-3119`).** (a).
_Before:_ instants from `wallClockInstant(localDate, minute, store.zone())`.
_After:_ the chair's instants from the stored start
(`TimeCoordinate.instantAt` — the folded `seatStartUtcMs`, D-6.5:
`utcEpochMs` + the chair's minute offset), the
phrase on `UtcEpochMs`. _Changes only:_ a chair whose start or end lies
across a DST transition from the envelope's start (the shop is closed then),
and a visit at a shop of another zone (today's instants used the wrong
zone). Ordinary days: the same phrase to the minute.

**DEP-13 — `?day=` / the day probe accept only calendar days (`st:1076-1084`,
`:1676-1681`).** (c): the hand regex vs `LocalDate.parse`; ecs-core's
survives. _Before:_ `?day=2026-02-30` passed the regex: `dayKey
'2026-02-30'`, chosen, published back, an empty canvas (no geometry), the
pill rolled over to 2 March, `shiftDay` a no-op. _After:_ refused → today,
unchosen, `day` published `null` (the URL rewritten). `?day=2026-13-01` the
same. Well-formed real days: unchanged.

**DEP-14 — `?barber=` with a `/` or blank (`st:1229`).** (c), pinned no-op.
`BarberId.parse` refuses both a whitespace-only value and one containing
`/` (`ids.primitive.ts:22-33`). _Before:_ scope `'a/b'` (or `' '` for
`?barber=%20`) briefly, cleared by the stale-scope effect once barbers
load. _After:_ `null` at once. The final URL is the same. (An empty
`?barber=` was already `null` — unchanged.)

**DEP-15 — the client card reads the draft's wall-clock start (`ve:6759`,
`:7336`; `client-card.presenter.ts:587-604`; `achievements.presenter.ts:463`).**
(c): the editor's ISO round trip vs the card's own wall-clock rule
(`ClientGlanceSystem.isInChairToday` takes `WallTime[]`). _Before:_ a
drafted start inside the gap (Sofia 2027-03-28 03:30) made `shopIsoOf` `''`,
`parseIsoIn` failed, every leg dropped: not in the chair, no
service/barber/early-bird counted for the medals; likewise when the editor's
zone was null but the card's known. _After:_ the `WallTime` start is used:
in the chair when the day is today and the visit open, the legs count. The
fall-back repeat (2026-10-25 03:30) reads the same minute both ways —
unchanged.

**DEP-16 — the icon manifest's discriminator (`icon-manifest.ts:43/54/61`,
schema 1 → 2).** (b). _Before:_ `{ schemaVersion: 1, icons: { k: { kind:
'material', glyph } } }` accepted. _After:_ rejected whole («schemaVersion 1
is not supported (this build reads 2)»); `{ schemaVersion: 2, icons: { k: {
iconAsset: 'MATERIAL', glyph } } }` parses. No live document exists (the
remote source is deliberately not wired, `app.config.ts:610`; the bundled
vocabulary and `material.ts` are rebuilt in the same change): nothing a user
sees changes. The `no-generic-discriminator` `allowIn` entry and its spec
fixture go; runbook §4.9 gates 4/5a re-worded; README and the design doc
describe v2.

**DEP-17 — the onboarding birthday save keeps its parameters (pass A carry).**
(c): the step's struct vs the flow state's bare code. _Before:_ a save
re-judged across a UTC midnight that refuses an age the blur check passed
printed `errors.IDENTITY_BIRTH_DATE_TOO_OLD`/`_TOO_YOUNG` with an empty
`{{maxAge}}`/`{{minAge}}`. _After:_ the struct rides
`OnboardingFlowEvent.birthdayFailed`; the line prints `120`/`16`.

**DEP-18 — `VoucherCode.distinct` names a repeat (`voucher-code.data.ts:86`).**
(c), function answer only. _Before:_ `ENGAGEMENT_VOUCHER_CODE_INVALID`.
_After:_ `ENGAGEMENT_VOUCHER_CODE_DUPLICATE { attempted }`. Its one caller
(`booking.wire.ts` `voucherCodesOf`) collapses any refusal to `null`: the
callable, the wire and the UI are unchanged. New `ENGAGEMENT_WIRE` row.

**DEP-19 — catalogue prices in the stored currency (`catalog.presenter.ts:160`).**
(c): `formatPrice(major)` hard-codes `'EUR'`; `formatCents` reads the
service's `currency`. _Before/after:_ byte-identical for every EUR service
(«28,00 €») — the only data today; a `BGN`/`USD`/`GBP` service would print
its own symbol after. The VM's price VALUES change from major units to
cents (not rendered; fixtures §4.2).

**DEP-20 — REPRICE gated on cents (`sd:4797-4806` → `StaffEditPlanSystem`).**
(c), expected pinned no-op. _Before:_ a typed price reprices when
`leg.priceLabel !== before.priceLabel` (and the undo snapshot re-parses its
label with `parsePriceInput`). _After:_ when `priceCents !==
before.priceCents`. Identical while `formatCents` is injective per currency
and `parsePriceInput(formatCents(c)) === c` — W0-S proves both over the
shop's currencies and both locales; any pair that breaks it becomes its own
spec case here.

**DEP-21 — the editor's bill words follow the bill's currency (`ve:5503`,
`:5552`, `:5839`, `:6024`).** (c): the constant `MONEY_CODE` vs the seats'
currency (the dashboard and `BillingSystem` read the seats'). Identical for
every EUR visit; a non-EUR seat's bill words follow the seat after.

**DEP-22 — one strict clock parser (`ve:1161`, `be:253` →
`MinuteOfDay.parseClock`).** (c), unreachable. _Before:_ the visit editor's
unanchored regex accepted `10:30:00` and `10:30x`; the block editor's was
strict on shape but not on minutes (`9:75` read as 10:15, `0:99` as 99).
_After:_ both strict (minutes > 59 refused). Both old parsers TRIMMED their input and
`parseClock` trims too, so `' 10:30 '` is accepted before and after (not
a change). `ui-time-field` (step 300) only ever emits `HH:mm`, so no
reachable input changes.

**DEP-23 — two refusal lines re-word on a language switch
(`booking-services-step.ts:466/502-504` `renameRefusal`,
`booking-contact-sheet.ts:111/219/234-236` `error`).** (c): two live rules
for one value — these two surfaces word an error ONCE at set time and keep
the words in a `signal<string | null>`, while every other error surface
holds the code or struct and words it reactively (`translateCodedError` in
a template/`computed`). The reactive rule survives (Law 7.5: state holds
the struct, so its params survive). _Before:_ a refusal shown in bg stays in
bg after the user switches to en, until the next set. _After:_ the line
re-words to en at once. In the language it was raised in, the words are
byte-identical (same `errors.<code>` line with the same params; the contact
sheet's `booking.contact.profileFailed` fallback kept). _Specs:_ §4.3.
