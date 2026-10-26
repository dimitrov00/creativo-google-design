# Pass E — the leftovers

**Date:** 2026-10-25 · **Status:** INTEGRATED (ledger §8; the FULL gate green, no standing reds) — PLAN written on `main` at `6d64f69f`
(the edge hardening integrated; tree clean). Line numbers are hints on
`6d64f69f`; every package re-reads its sites before it edits. ·
**Owner's word:** "proceed with leftovers". ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md` (`ecs-primitives.md`,
`ecs-components.md`, `ecs-systems.md`, `ecs-pipelines.md`, `ecs-ports.md`,
`ecs-layering.md`, `firestore-layout.md`, `presenters.md`, `angular-ui.md`).
This plan never overrides them. ·
**Sources:** `docs/architecture/HANDOFF.md` §3.3 (the carried lists "Carried
forward", "Carried from pass A/B/C/D", "Fixed after pass D", "Carried from
the edge hardening"), §4 (the gate and the standing red baseline), §6 (open
questions); `flips/pass-c-ui-decisions.md` §8 / §9.6;
`flips/pass-d-brands-shapes.md` §8 / §9.6; `flips/edge-hardening.md` §7 /
§8.5; `flips/flip-1-booking-core.md` F1-2, §10; `flips/flip-4-programs.md`
F4-2, F4-7, §10; the triage of this pass (61 items: DO / OWNER / PARKED /
ALREADY-DONE).

**What this is.** Pass E closes every carried item that is ENGINEERING — no
product decision, no new copy beyond words for codes that have none, no new
dependency — and turns the standing red baseline green by fixing each red
at its root cause. Owner decisions are listed (§7), never decided.

**Behaviour is frozen** except each fix's declared DEPARTURE (§5, `DEP-n`,
with before/after and the specs changed on purpose).

**This pass ends** when the packages of §3 are integrated, every existing
spec passes unchanged except the edits §4 names as forced, the FULL gate of
HANDOFF §4 is green against the NEW baseline (§6.3: no standing reds), and
the behaviour changes are exactly the DEPARTURES of §5.

---

## 0. Rulings (read first)

Each DO item: the fix, its home, why.

### E-1 — `retry: true` on the four other capacity triggers (RETRY)

- **Fix.** `rebuildCapacityOnExceptionChange`, `…OnRosterChange`,
  `…OnLocationChange`, `…OnSettingsChange` declare `{ document: <path>,
retry: true }` and run through `retryingTrigger({ fn: <own name>,
timeoutSeconds: null }, root.edge, handler)` — exactly the shape of
  `rebuildCapacityOnBusyChange` (`main.ts:599-607`). The handler stays
  `rebuildCapacityFrom(<source>, event.params)`.
- **Home.** `apps/functions/src/main.ts` (composition root) and its
  `main.spec.ts` literal table.
- **Why safe.** The same transient/decisive split as edge-hardening D-5:
  `retryingTrigger` rethrows only an allowlisted TRANSIENT verdict
  (`TriggerAttemptSystem` `TRANSIENT_CODES` = `aborted`, `unavailable`,
  `deadline-exceeded`, `resource-exhausted`) and logs-and-returns every
  other. The allowlist is NOT widened (`trigger-attempt.system.ts` is not
  touched). Every path goes through `rebuildCapacity`, whose
  `rebuildBarber` REPLACES the month's entries in one transaction (full
  sorted `Set`, never merge), so a redelivery lands on the same document.
- **Residual, frozen on purpose (R-1).** The Location / Settings triggers
  decode to `CapacityTrigger.Sweep`, whose loop LOGS a barber's failure and
  continues (`rebuild-capacity.pipeline.ts:296-317`) — so for those two the
  retry covers the zone, policy and roster-list reads, not a single barber's
  commit (which the 03:00 sweep heals, as today). Changing the sweep to
  surface per-barber failures would also change `sweepCapacityDaily`; not
  this pass.

### E-2 — a read-time guard for `appointmentNotes` (GUARD)

- **Fix.** `StoredDocumentSystem.appointmentNote(doc)` (+ its zero-allocation
  `appointmentNoteFault(doc)`), registered in `guardOf` for
  `Collections.AppointmentNotes`. The checks, in order: `id` is an
  `AppointmentId` (`AppointmentId.is`), `text` is a non-empty string after
  trim (the entity's stored invariant: "the stored `text` is trimmed and
  non-empty"), `authorUserId` is `null` or `UserId.is`, `writtenAtUtcMs` is
  `UtcEpochMs.is`. Answer: THE SAME OBJECT typed `AppointmentNote`, or
  `RepositoryError.malformed('appointmentNotes/<id>', '<field>')`.
- **Adapter.** `appointmentNotePorts(db, guard: ReadGuard = UNGUARDED)`:
  `observeAppointmentNote` passes `guard` to `observeDoc` (the SINGLE rule:
  a malformed note emits the refusal, the listener stays);
  `updateAppointmentNote` admits the transaction's snapshot through
  `StoredDocumentSystem.admit(guard.guardOf, Collections.AppointmentNotes,
doc)`; a refused note ends the transaction WITHOUT calling `decide` and
  WITHOUT writing, and the port answers that refusal (`Result.err`,
  `REPOSITORY_MALFORMED`) — reported once through `guard.log` under the
  shared `'malformed document refused'` line. The misfiled-id defect path is
  unchanged.
- **Wiring.** `apps/web/src/app/app.config.ts:438` passes
  `m.firestore.guardedReads(errorHandlerLogPorts(inj.get(ErrorHandler)))`,
  as the three guarded adapters do (`:344`, `:366`, `:475`).
- **Port doc.** `UpdateAppointmentNote`'s JSDoc
  (`ports/notes-photos.port.ts:80-100`) adds the malformed refusal to its
  failure set; the type is unchanged (`RepositoryError` already).
- **Why.** Edge-hardening OQ-2's planned follow-up; the append's `decide`
  read `stored.text` as stored.

### E-3 — TTL policies and the `purgeAt` exemptions DECLARED (TTL)

- **Fix.** `firestore.indexes.json` `fieldOverrides` gains seven entries,
  one per TTL group: `{ "collectionGroup": "<group>", "fieldPath":
"purgeAt", "ttl": true, "indexes": [] }` for `otps`, `notifications`,
  `waitlistRequests`, `barberBusy`, `capacity`, `impersonationSessions`,
  `barberLeadTimeSamples`. `ttl: true` is the firebase-tools field-override
  flag (verified in `node_modules/firebase-tools/lib/firestore/api.js:288-344`,
  firebase-tools 15.31.0); `indexes: []` exempts the single-field index
  (no query filters or orders on `purgeAt` — re-prove with `git grep -n
"purgeAt" -- 'libs/**/*.ts' 'apps/**/*.ts' 'tools/**'` before landing).
- **Runbook.** `firestore-runbook.md` §2.2 becomes "declared in
  `firestore.indexes.json`, deployed by `firebase deploy --only
firestore:indexes`" (the seven `gcloud … ttls update` commands go; one
  fallback line may keep the `gcloud` form for a project the CLI cannot
  reach); §2.3's ACTIVE check stays (it is the release gate); §2.4's last
  bullet (the `purgeAt` index "is the owner's call") is rewritten to state
  the exemption is declared; §3 step 3 becomes "TTL is deployed with step 1;
  pass §2.3"; §1's `appointmentNotes` row (if listed) notes the guard (E-2).
- **Why.** Pass B owner flag (d) "TTL declarations untouched (a later
  pass)" and flip-1 §10 Q5; the task names both the policies and the
  exemptions. The runbook's earlier "owner's call" wording on the exemption
  is listed for the owner's awareness (§7.2 N-3).

### E-4 — the waitlist cart parsed inside its door (WAITLIST)

- **Fix.** `WaitlistCall.Input.cart` becomes a RAW twin
  `WaitlistCall.CartInput` (`{ cartSeats: readonly { seatKey: string;
lines: readonly { lineId: string; serviceId: string; variantId: string |
null; barberId: string | null; locationId: string | null }[] }[];
cartNextSequence: number }`), declared in the namespace of
  `waitlist-call.data.ts`. A typed `BookingCart` is assignable to it (a
  brand is a subtype of `string`), so "a typed `WaitlistCall` is one" stays
  true.
- **The one pre-door brand moves into ecs-core.** NEW
  `WaitlistSystem.cartAsSent(raw: WaitlistCall.CartInput): BookingCart` —
  each id branded AS SENT with the unchecked `X.of` (never `parse`), exactly
  what `waitlist.wire.ts` `cartOf` does today, so the door keeps judging the
  ids in its own order (`decide` step 7, `lineReadable`). `decide(ask,
door)` reads `ask.cart` raw for steps 6–7 and stores
  `cartAsSent(ask.cart)` on the body. `requestWaitlist` computes `const cart
= WaitlistSystem.cartAsSent(cmd.ask.cart)` ONCE and hands it to
  `withinReadBounds`, `cartServiceIds` and `PartyAdmissionSystem.admitCart`.
- **Wire.** `cartOf` in `apps/functions/src/wire/waitlist.wire.ts` extracts
  raw strings only (`text`, `textOrNull`, `Number(…)`), no brand imports;
  its comment says the brand is the door's.
- **Behaviour frozen.** Same refusals in the same order (an id holding `/`,
  a blank `seatKey` or `locationId` accepted as today; a blank `lineId`
  refused `invalidRequest('cart')`); same stored body; same request id.

### E-5 — the raw-brand guard on `libs/ui/icons` (UI)

- **Fix.** `libs/ui/icons/eslint.config.mjs:34` stops switching
  `no-restricted-syntax` OFF; instead the registry block re-declares it with
  the raw-brand (W3-G / `uiRawPrimitiveBlock`) and L7 cast selectors ONLY —
  the icon-syntax selectors stay off there (the registry boundary). The
  selector arrays come from `tools/lint-rules/index.mjs`; if the raw-brand
  list is not exported by name, export it there (one name, no copy).
- **Why.** Pass D §9.6: turning the rule off also turned W3-G off; zero hits
  were measured, so no code churn is expected — any hit is fixed by its
  brand, never by a disable comment.

### E-6 — spec-only survivors (CORE, SURVIVORS)

- **`AchievementsSystem.firstStart`** (`achievements.system.ts:376`) —
  deleted with its spec block (`achievements.system.spec.ts:1018-1051`).
  Re-prove zero callers (`git grep -n "firstStart" -- '*.ts' '*.mjs'`; the
  `availability.system.ts:227` local and `tools/seed/appointments.mjs`
  `firstStartMs` are unrelated names).
- **`ZonedTimeSystem.toIso`** (`zoned-time.system.ts:640`) — deleted, its
  JSDoc mention at `:29` removed. Its spec callers re-point to a NEW
  test-support helper `wallIso(utcEpochMs, timeZone): string` in
  `libs/ecs-core/src/testing/test-support.ts` (exported through
  `@core/testing`): the same spelling (`YYYY-MM-DDTHH:mm:ss.SSS±HH:MM`,
  milliseconds always, `+00:00` for zero) built from
  `Intl.DateTimeFormat(…).formatToParts(utcEpochMs)` over a NUMBER (no
  `Date`) — superseded by the review's fixer (§8.7): it is built on
  `ZonedTimeSystem.toLocal`, the one zone engine. The private `isoAt` helper of `zoned-time.system.ts` (`:389`,
  used only by `toIso`) goes with it; `describeWallClock` / `pad2` stay
  only if another member still calls them (grep). No e2e or tool calls
  `toIso` (re-prove: `git grep -n "toIso" -- apps/web/e2e tools`).
- **Every `toIso` site on `6d64f69f`, and its fate** (`git grep -n toIso
-- '*.ts' '*.mjs'`):

  | Site                                                                                                                                                                                                                                                                                                                          | Fate                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `apps/web/src/testing/e2e-appointment-seed.spec.ts:172`, `:209`                                                                                                                                                                                                                                                               | re-point → `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `program-content.pipeline.spec.ts:409`                                                                                                                                                                                                                                                                                        | re-point → `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `policy-recompute-job.system.spec.ts:497` (`label`)                                                                                                                                                                                                                                                                           | re-point → `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `zoned-time.system.spec.ts:23` (file JSDoc lists `toIso`)                                                                                                                                                                                                                                                                     | comment: drop `toIso` from the list                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | `zoned-time.system.spec.ts:127-129` (the `±HH:MM` offset helper + its JSDoc)                                                                                                                                                                                                                                                  | re-point → `wallIso(…).slice(-6)`; JSDoc says `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                          |
  | `zoned-time.system.spec.ts:756` (the `toLocal` case's last expectation)                                                                                                                                                                                                                                                       | re-point → `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `zoned-time.system.spec.ts:773-823` describe 'toIso — an instant on the zone’s clock, with its offset' — **5 cases**: Sofia summer/winter; the repeated hour's two offsets; Kolkata / UTC `+00:00` / São Paulo / the negative epoch; the `parseOffsetIso` round-trip; 'a zone the runtime does not know is a defect' (`:821`) | **deleted**; the first four cases restated in `test-support.spec.ts` against `wallIso` (same literals; the round-trip through `ZonedTimeSystem.parseOffsetIso` — a spec may import `@core/systems`). The defect case is restated as "an unknown zone throws" (`toThrow()` with no `/defect/` pattern — the helper lets `Intl`'s `RangeError` through); the SYSTEM's unknown-zone defect path stays covered by `zoned-time.system.spec.ts:201-210` and `:484-485` |
  | `zoned-time.system.spec.ts:1085` (fall-back first 03:30)                                                                                                                                                                                                                                                                      | re-point → `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `zoned-time.system.spec.ts:1188` (Lord Howe repeated half hour)                                                                                                                                                                                                                                                               | re-point → `wallIso`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `zoned-time.system.spec.ts:1445-1486` describe 'ZonedTimeSystem.toIso — byte-identical to the legacy ZonedDateTime.toISO()' — **2 cases**: the four legacy literals; the 300-run property (spelling vs `toLocal`, round-trip through `parseOffsetIso`)                                                                        | **deleted**; both restated in `test-support.spec.ts` against `wallIso` (same literals, same property and `numRuns`)                                                                                                                                                                                                                                                                                                                                              |
  | `zoned-time.system.spec.ts:1605` (the ingestion purity run's `iso:` entry)                                                                                                                                                                                                                                                    | the `iso` entry is removed from the run (its subject is gone; `wallIso` is not a system); the purity case stays — no count change                                                                                                                                                                                                                                                                                                                                |

  Net: `zoned-time.system.spec.ts` −7 cases; `test-support.spec.ts` +7
  (or more); recorded in §8.1.

- **`ZonedTimeSystem.parseIsoIn`** — KEPT (`apps/web/e2e/support/appointment-seed-document.ts:99`
  calls it: the e2e exemption).
- **`rhythmPreviewReadsFacts`** (`admin-rhythm.preview.ts:48`, its JSDoc
  `:25`) — deleted with `admin-rhythm.preview.spec.ts:412-423`; the cases
  are restated in `streak-preview.system.spec.ts:611`. Before deleting,
  map each case to its restatement; a case with none is folded into
  `streak-preview.system.spec.ts` first.

### E-7 — one avatar-upload error union (CORE)

- **Fix.** In `libs/ecs-core/src/errors/accounts.error.ts`:
  `AccountsError.AvatarRefusal = UploadAvatarNotAnImage | UploadAvatarTooLarge
| UploadAvatarUploadFailed` (namespace, declared once), and top-level
  `export type AvatarUploadError = AccountsError.AvatarRefusal |
IdentityError.IdentifierMissing;` beside the existing `UpdateProfileError`
  precedent (`import type { IdentityError } from './identity.error'` — a
  sibling, `./`). `avatarUploadRefusal` answers `AccountsError.AvatarRefusal`;
  `onboarding-flow.store.ts:280` answers `Result<void, AvatarUploadError>`;
  the surface signals and `translateError` parameters spell
  `AccountsError | AvatarUploadError | null` (profile adds its own
  `AccountsError.OwnProfileSave | AccountsError.RemoveAvatarRemoveFailed`).
  Each site's value set is re-read first: the union may only NAME what a
  site already accepts. Type-only; `verify-tools:layering`'s one-home rule
  holds (`AvatarUploadError` is a new name — grep it first).
- **Sites.** `avatar-refusal.ts:23`, `profile.store.ts:111`,
  `client-profile.ts:171, :373`, `onboarding-flow.store.ts:280`,
  `client-onboarding.ts:323, :462`.

### E-8 — `BirthDate.toLocalDate` (CORE)

- **Fix.** `BirthDate.toLocalDate(birthDate: BirthDate): LocalDate | null`
  in `birth-date.data.ts` — implemented through `LocalDate.parse` (the cast
  stays in the primitive's own file, Law 7.4), `null` when the stored
  string is no calendar day. `client-profile.ts:199` reads
  `BirthDate.toLocalDate(birthDate)` instead of `LocalDate.parse(birthDate)`;
  the label's two branches are unchanged. Spec: purity + every boundary
  (`1990-02-29` → `null`, `2000-02-29` → the day, a regex-valid
  `2026-13-01` → `null`).

### E-9 — `UiDayKey` deleted (UI)

`libs/ui/controls/src/lib/month-picker/month-picker.ts:37`
`export type UiDayKey = LocalDate;` and its uses (`:116-249`) become
`LocalDate`; the alias goes. Re-prove no consumer (`git grep -n UiDayKey`).

### E-10 — two feature specs on moved names (SURVIVORS)

`libs/features/client/booking/src/lib/schedule-step/day-availability.spec.ts`
(spec-local `const capacityByDay = CapacitySystem.freeMinutesByDay;` and the
`dayOptions` / `releaseOn` / `sameDayDocsKey` / `observeDayDocs` cases) and
`libs/features/admin/loyalty/src/lib/admin-rhythm/rhythm-service-groups.spec.ts`
(`const rhythmServiceGroupsOf = CatalogSystem.byCategory;`) — their subject
files are gone. Each `it` is mapped to its successor in
`shop-day.pipeline.spec.ts`, `capacity.system.spec.ts`,
`catalog.system.spec.ts` (or wherever `git grep` finds the subject's spec);
a case with no successor is FOLDED into that spec (same inputs, same
expectation, against the live name), then the feature spec is deleted. The
mapping table goes into the ledger (§8).

### E-11 — the staff dashboard spec's local `HeldGrant` (UI)

`staff-dashboard.spec.ts:505` `interface HeldGrant { … }` is deleted; the
spec imports `type HeldGrant` from `@core/systems`
(`coupon-grant.system.ts:47`). Spec-only.

### E-12 — per-call `Intl.NumberFormat` in wording helpers (INTL)

- **Fix.** `@creativo/ui/wall-clock` gains two cached helpers (per locale,
  module `Map`, the `formatCentsFigure` pattern): `formatMinutesRange(min:
DurationMinutes, max: DurationMinutes, locale): string` — byte-identical
  to `catalog.presenter.ts` `formatDurationRange` (the `unit: 'minute',
unitDisplay: 'narrow'` formatter, `formatRange` feature-detected, the
  `useGrouping: false` fallback) — and `formatCount(value: number, locale):
string` (the default `Intl.NumberFormat(locale)`).
  `catalog.presenter.ts:156-175` `formatDurationRange` delegates (or its one
  caller `catalog-wording.service.ts:46` is re-pointed and the function
  deleted); `admin-rhythm.words.ts:194` and `client-card.format.ts:126`
  call `formatCount`.
- **Why.** Law 10.1 / `presenters.md`: "never a formatter built per row";
  pass C §9.6 (finding 75). Words byte-identical — each spec pins bg and en.
  `libs/ui/patterns/src/lib/metric/metric.ts:271` is a DS component, out of
  scope (recorded, §7.3).

### E-13 — `familyOfMedal` by a typed id (CARD, DEP-4)

- **Defect.** `achievements.presenter.ts:350-357` finds the family whose id
  EQUALS `medal.seriesId`; on an archived season's own medal `seriesId` is a
  `SeasonId`, so a season whose id equals a family's id draws that family's
  ring.
- **Fix.** `MedalVm` (`client-pages.vm.ts:210-218`) gains
  `readonly familyId: BadgeSeriesId | null` — the family drawn, `null` on a
  season's own medal. Producers: `medalVm` (`achievements.presenter.ts:917`,
  `familyId: series.id`), the season tile (`:1573`, `familyId: null`), the
  level medals of `medal-detail.presenter.ts:858` (`familyId` of its face).
  `familyOfMedal(data, medal)` answers `medal.familyId === null ? null :
seriesById(data, medal.familyId)` — a typed lookup, no string equality
  across brands. `seriesId` stays (keys, test ids).
- **Callers unchanged in shape:** `glance.presenter.ts:805`,
  `medals.presenter.ts:779, :832, :864`, `medal-detail.presenter.ts:942`.
- **Test support.** `src/testing/client-pages.vm-fixtures.ts` builds full
  `MedalVm` literals (`medalOf()` `:126-145`, the `satisfies Record<string,
MedalVm>` table ending `:277`): `medalOf` defaults `familyId` to
  `BadgeSeriesId.of(seriesId)` (a family's medal — what today's lookup
  answers for every fixture naming a family), and a season fixture passes
  `familyId: null` through `overrides`. Before landing, re-grep the
  package's tree for every literal spelling `seriesId:`
  (`grep -rn "seriesId:" libs/features/staff/client-card/src`) — the
  presenter specs, `achievement-detail.spec.ts`, any component spec
  (medals-glance, achievement-tile, `client-pages.vm.spec`) that builds a
  `MedalVm` by hand.
- **Owner visibility.** Pass D §9.6 handed this change to the owner ("a
  behaviour change for the owner"); pass E does it because this pass's task
  names it as a DO — §7.2 N-4.

### E-14 — flip 1's "reopen busy write": prove, fix only if real (REOPEN)

- **What is known.** `transitionAppointment` writes no `barberBusy` on any
  edge (F1-2, `transition-appointment.pipeline.ts:71-72`). The graph lets
  the shop reopen THREE non-live statuses to `CONFIRMED`: `CANCELLED`,
  `NO_SHOW`, and `COMPLETED` (`:54`; the settled two on the visit's own day
  only). The busy projection keeps only LIVE visits —
  `BusySystem.rebuild` / `chairOccupants` skip `!BookingLifecycle.isLive`
  (`busy.system.ts:216, :254`; `isLive` = PENDING or CONFIRMED,
  `booking-lifecycle.data.ts:188-195`) — so a cancelled, no-show AND a
  completed visit all lose their blocks once the trigger runs, and all three
  reopens share the same window. The reopen's OWN collision check (#7,
  `readCollisions` over `busyKeys`) runs only for
  `AppointmentLifecycleSystem.isReinstatement` — a PARTY reopen of a
  `CANCELLED` visit (`appointment-lifecycle.system.ts:1064-1072`); a
  `NO_SHOW` or `COMPLETED` reopen checks nothing against appointments booked
  into the freed chair (a separate, pre-existing gap — §7.2 N-5, not this
  item). `rebuildBusyOnAppointmentChange` (retry: true since the edge
  hardening) recomputes the day from every live appointment, so the
  projection is right ONCE THE TRIGGER RAN.
- **What may be real.** `bookAppointment` / `rescheduleAppointment` /
  `editAppointment` check collisions against the BUSY DOCUMENTS
  (`readPlacementSet`, `booking-read-set.pipeline.ts:202-238`) and merge
  onto the bodies they read (`busyMergeWrites`). In the window between the
  reopen's commit and the trigger, the busy day does not hold the reopened
  visit, so a booking in that window may be admitted over it.
- **Proof (spec, no emulator).** In `transition-appointment.pipeline.spec.ts`
  over ONE `memoryStore` (`@core/testing`), ONE case per reopen edge
  (`it.each` over `CANCELLED`, `NO_SHOW`, `COMPLETED`): seed a confirmed
  visit with its busy day, move it to the non-live status
  (`transitionAppointment` → CANCELLED / NO_SHOW / COMPLETED, on the visit's
  own day for the settled two) and run `rebuildBusy` (the day frees), reopen
  it (→ CONFIRMED) WITHOUT running `rebuildBusy`, then `bookAppointment` a
  seat overlapping the reopened one. (a) If the booking is REFUSED
  `BOOKING_SLOT_UNAVAILABLE` on every edge, the item is NOT real: keep the
  spec as the proof, record "not real" in the ledger, no code change.
  (b) If it is ADMITTED on any edge, the item is REAL: the fix is the
  reopen's plan merging its blocks onto the busy bodies it reads in the same
  transaction, exactly as `bookAppointment` does (`readPlacementSet` for the
  reopened seats' keys + `busyMergeWrites`), only for a transition whose
  appointment ENDS live from a non-live status —
  `!BookingLifecycle.isLive(before) && BookingLifecycle.isLive(after)` (the
  projection's own predicate, so the merge covers exactly what the trigger
  would restore; NOT `didNotHappen`, which leaves `COMPLETED` out); the
  proof spec then asserts the refusal on all three edges, and the plan spec
  asserts the extra `Set` ops for each. DEP-5 applies only under (b).
  Idempotent with the trigger: `BusySystem.rebuild` recomputes the same
  blocks. The missing #7 collision check on a `NO_SHOW` / `COMPLETED`
  reopen is NOT added here (it would change which reopens are refused —
  §7.2 N-5).
- **Scope note.** The planner expects (b) (the booking read set holds no
  appointment query); the package proves it either way.

### E-15 — programs rules tightened (RULES, DEP-7)

`firestore.rules:487-499` — `positions`, `courses`, `events` keep
`allow read: if true;` and replace `allow write: if isCatalogManager();`
with `allow create, update: if isCatalogManager() && valid<Kind>(request.resource.data);`
and `allow delete: if false;` (no client deletes one: `programs.adapter.ts`
writes `setDoc` only). The shape checks mirror the entities
(`position.entity.ts`, `course.entity.ts`, `event.entity.ts`) and what
`ProgramsSystem` admits (read it: integer vs number, ranges) — §2.6.
The live writer (`programs.adapter.ts` `saveBody`, a full-document
`setDoc` of the entity minus `id`) must pass: proven by the integration
spec writing the entity bodies the pipeline builds, AND by the existing
adapter emulator spec `libs/infrastructure/firestore/src/lib/programs.adapter.integration.spec.ts`
(`:112-113` a `content_manager` context; `:205-240` saves a position, a
course and an event — the `positionOf` / `courseOf` / `eventOn` fixture
bodies of `@core/testing` — through the rules and reads them back). That
file is the live-writer proof and must pass UNCHANGED; a shape check that
refuses it is a wrong rule, never a spec edit. Note the rules spec's own
`'lets a content_manager write %s'` case (`firestore.rules.integration.spec.ts:686-699`)
writes a `{ title }`-only body — under the shape check it must write a
valid entity body (built from the programs fixtures), which is DEP-7's
forced spec edit.

### E-16 — client write grants no code uses → deny (RULES, DEP-6)

`serviceCategories`, `services`, `barbers`, `locations`
(`firestore.rules:383-400`, `isCatalogManager`), `barberSchedules`
(`:411-417`, `mayEditRoster`) and `settings` (`:581-583`, `isAdmin`) become
`allow write: if false;` with comments saying the Admin SDK (seed, e2e
support, functions) is the only writer. Proof of "no live writer": no web
adapter writes them (`catalog.adapter.ts` reads; `scheduling.adapter.ts:53`
observes `barberSchedules`, `:71` reads `settings/bookingPolicy`); the seed
and e2e write through `firebase-admin`. KEPT: `scheduleExceptions`
(`mayEditRoster`; live writer `scheduling.adapter.ts:99-132`). The helper
functions stay (still used, and `role.rules-parity.spec.ts` reads them).
`coupons` (`:508-510`) is NOT tightened: its admin save is pinned by a
dated rules case (`firestore.rules.integration.spec.ts:1850-1922`,
2026-09-29) — listed for the owner (§7.2 N-2).

### E-17 — programs status words into the catalogs (I18N)

`program-status-words.ts` is deleted; its words move into
`bg.json` / `en.json` UNCHANGED — `programs.status.position.OPEN = "open"`,
`.CLOSED = "closed"`, `programs.status.enrollment.OPEN = "open"`,
`.UPCOMING = "upcoming"`, `.CLOSED = "closed"`, the SAME lowercase English
words in both catalogues (translating them is the owner's, flip-4 §10 Q2).
`admin-programs.ts:98-99`, `marketing-careers.ts:121`,
`marketing-courses.ts:150` read them through transloco (a key built from
the SCREAMING tag: `programs.status.position.<tag>`). Byte-identical on
screen.

### E-18 — words for UI-reachable error codes with none (I18N, DEP-8)

- **Reachability rule.** A code gets words when a web surface's translate
  path can receive it: (1) `translateCodedError` (`errors.<code>`, falls
  back to the RAW code on screen — a visible defect today) on a struct a
  web store, pipeline or system answers; (2) `wordPipelineError` on a
  callable refusal the edge ANSWERS (not `S.Internal` in `edge.ts`'s
  table: those reach the web as a bare INTERNAL) — today that falls back to
  the surface's generic key, so words here make the copy specific; (3) a
  `*.reason` one level down (`errors.<code>.<reason>`) only where the
  surface already reads one. Server-internal, programmer-defect and
  `S.Internal` codes get NO words. The scan's non-codes (context values
  `WIDTH`, `HEIGHT`, `LAT`, `LNG`, `UNPARSABLE`, `OUT_OF_RANGE`) are
  excluded.
- **Voice.** The catalogues' existing voice: short, plain, the way
  neighbouring `errors.*` keys read (bg informal «ти», sentence case, one
  sentence, a full stop; en the same register). Interpolate only params the
  wire allowlist (`pipeline.error.ts` `SERVER_PARAMS`) or the surface
  supplies. NEVER change an existing string.
- **Output.** Every added key, bg and en, listed in the ledger for the
  owner's copy review (§8, table "E-18 words").

### E-19 — the standing red baseline (UI, CARD, E2E)

| Red                                                                                                            | Root cause (found by this plan unless marked)                                                                                                                                                                                                                                                                                                                                                             | Wrong side · fix                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck `patterns` — `section-header.spec.ts:589` `.findLast(…)`                                             | `Array.prototype.findLast` is ES2023; the workspace lib is `["es2022", "dom"]` (`tsconfig.base.json:5` — not `libs/ui/patterns/tsconfig.json` as the triage said). Nothing else in the repo needs ES2023                                                                                                                                                                                                  | **Spec.** Rewrite the `valueOf` helper with a reverse `for` scan (same answer: the LAST declaration of a property). Raising the base lib would change every project's type surface for one spec helper                                                                                                                                 |
| `gauge.spec.ts` × 3 (`steps`: `:490`, `:542`, `:594`)                                                          | `.ui-gauge__node`'s `textContent` is `' III'` / `' '`: the template (`gauge.ts:213-221`) puts the `@if (node.check) { <ui-icon …/> }` block and `{{ node.numeral ?? '' }}` on separate lines, so a collapsed whitespace text node leads the numeral. Rendering is unaffected (whitespace at the start of the node's line collapses). Born red: code and spec landed together in `98adfb3f` (2026-10-07)   | **Spec.** Compare `textContent?.trim()` (the design is the numeral; the whitespace is the formatter's)                                                                                                                                                                                                                                 |
| `gauge.spec.ts:1163` (stylesheet)                                                                              | the spec pins `max( calc(…), var(--sys-space-tight) )` with inner spaces; `gauge.css:59-62` (formatted by prettier) reads `max(calc(…), var(--sys-space-tight))`. Same commit `98adfb3f`                                                                                                                                                                                                                  | **Spec.** Compare whitespace-normalised declaration text (collapse runs, strip spaces after `(` and before `)`), or pin the formatted string                                                                                                                                                                                           |
| `visit-pills.spec.ts:313`                                                                                      | same formatter pinning: expected `calc( var(--control-size-small) + 2 * var(--sys-space-tight) )`, the stylesheet (prettier) reads `calc(var(…) + 2 * var(…))`. Born red in `c1db6611` (2026-10-07)                                                                                                                                                                                                       | **Spec.** As above                                                                                                                                                                                                                                                                                                                     |
| `visits-page.presenter.spec.ts:226-241` "strikes an hour that did not happen"                                  | the shared row presenter words a staff-cancelled row as TWO lines — the cancelled word, then the barber held against the ellipsis (`visit-row.presenter.spec.ts:344-347`, `'Отказан от салона'`, `'Иван'`) — the client card's revision-3 design, `c1db6611`; the visits-page spec, written in the same commit, pinned the joined `'Отказан от салона · Нико'`                                            | **Spec.** `lines: [{ text: 'Отказан от салона' }, { text: 'Нико' }]`; the struck tile and trailing fact unchanged. Cite `c1db6611` and the shared spec                                                                                                                                                                                 |
| e2e `landing.spec.ts:121` (MapLibre lazy load)                                                                 | NOT root-caused here (needs an e2e run). Leads: the dev server (`playwright.config.mts:57` `pnpm nx run web:serve`) pre-bundles with `maplibre-gl` EXCLUDED (`apps/web/project.json:77`); the request regex `/maplibre-gl/i`; the `@defer (on viewport)` anchor `#locations`; `MapLibreLoader.load()` in `libs/ui/controls/src/lib/map/maplibre-loader.ts` (the CSS fetched as text)                      | **E2E** finds which assertion fails (the "0 before scroll" or the "> 0 after") and fixes the code if the lazy load regressed (a static import pulling `maplibre-gl` into the initial graph), or the test if its URL pattern / trigger is out of date — citing the commit                                                               |
| e2e `client-card-glance.spec.ts` :336 × 6 failing at `:377` (`client-quick-same` `data-prominence="accent"`)   | NOT root-caused here. The attribute exists (`quick-actions.ts:157`), so the disc is ABSENT: the «Повтори» action is not in `overview().actions` for the seeded Georgi (`client-card.html:233-262`; unit `client-card.spec.ts:401,991` pin its absence when nothing qualifies). Check what qualifies the Same action (last completed visit legs from `clientStats`, the seed's day/time vs the shop clock) | **E2E**: fix the seed if it no longer produces a qualifying last visit, or the code if eligibility regressed (cite the pass/commit)                                                                                                                                                                                                    |
| e2e `client-card-glance.spec.ts` :679 × 6 failing at `:758` (the birthday gift's «Премахни» → `ready` + focus) | NOT root-caused here. Leads: `data-gift` returns to `ready` but the focus is lost when the ARTICLE becomes a BUTTON again (an element swap under `@if`), or the remove does not reach `ready`                                                                                                                                                                                                             | **E2E**: fix the focus restoration in the card (the a11y contract the spec pins) or the test if the design moved (cite)                                                                                                                                                                                                                |
| e2e 6 × `*-screenshots.spec.ts`                                                                                | NOT root-caused here; baselines date from `c1db6611` (2026-10-07) and `738b5292` (2026-07-22)                                                                                                                                                                                                                                                                                                             | **E2E**: Read the baseline PNG and the actual PNG (`test-results/**`) of each; regenerate ONLY when the difference is an intended design change — cite the ruling or commit (e.g. the accent law `98adfb3f`, revision 3 `c1db6611`, the date-picker style 2026-10-06) — otherwise REPORT it as a regression with the two images' paths |

---

## 1. The DO inventory (file:line on `6d64f69f`)

| #   | Item                                      | Sites                                                                                                                                                                                                                                                                      | Package   |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | retry on four capacity triggers (E-1)     | `apps/functions/src/main.ts:609-629`; `main.spec.ts:187-193` (ENDPOINTS), `:157-160` (header), `:948-953` (`RETRIED`); `wire/triggers.wire.ts:65-74` (comment); `main.ts:178-183` (comment)                                                                                | RETRY     |
| 2   | `appointmentNotes` guard (E-2)            | `libs/ecs-core/src/systems/stored-document.system.ts:321-355` (`guardOf`); `libs/infrastructure/firestore/src/lib/appointment-notes.adapter.ts:34-90`; `apps/web/src/app/app.config.ts:436-445`; `libs/ecs-core/src/ports/notes-photos.port.ts:80-100`                     | GUARD     |
| 3   | TTL + `purgeAt` exemptions (E-3)          | `firestore.indexes.json` `fieldOverrides` (append); `docs/architecture/firestore-runbook.md:135-174` (§2.2–§2.4), `:196` (§3 step 3)                                                                                                                                       | TTL       |
| 4   | waitlist cart raw in its door (E-4)       | `libs/ecs-core/src/components/waitlist-call.data.ts:18, :46-49`; `libs/ecs-core/src/systems/waitlist.system.ts:250-340`; `libs/ecs-core/src/pipelines/request-waitlist.pipeline.ts:84-175`; `apps/functions/src/wire/waitlist.wire.ts:81-110`                              | WAITLIST  |
| 5   | icons raw-brand guard (E-5)               | `libs/ui/icons/eslint.config.mjs:24-36`; `tools/lint-rules/index.mjs` (export, if needed)                                                                                                                                                                                  | UI        |
| 6   | `firstStart` (E-6)                        | `libs/ecs-core/src/systems/achievements.system.ts:376`; `achievements.system.spec.ts:1018-1051`                                                                                                                                                                            | CORE      |
| 7   | `toIso` (E-6)                             | `libs/ecs-core/src/systems/zoned-time.system.ts:29, :632-644`; spec callers listed in E-6                                                                                                                                                                                  | CORE      |
| 8   | `rhythmPreviewReadsFacts` (E-6)           | `libs/features/admin/loyalty/src/lib/admin-rhythm.preview.ts:25, :48`; `admin-rhythm.preview.spec.ts:43, :412-423`                                                                                                                                                         | SURVIVORS |
| 9   | avatar union (E-7)                        | `libs/ecs-core/src/errors/accounts.error.ts`; sites in E-7                                                                                                                                                                                                                 | CORE      |
| 10  | `BirthDate.toLocalDate` (E-8)             | `libs/ecs-core/src/components/birth-date.data.ts`; `libs/features/client/profile/src/lib/client-profile/client-profile.ts:199`                                                                                                                                             | CORE      |
| 11  | `UiDayKey` (E-9)                          | `libs/ui/controls/src/lib/month-picker/month-picker.ts:37, :116-249`                                                                                                                                                                                                       | UI        |
| 12  | two alias specs (E-10)                    | `libs/features/client/booking/src/lib/schedule-step/day-availability.spec.ts`; `libs/features/admin/loyalty/src/lib/admin-rhythm/rhythm-service-groups.spec.ts`                                                                                                            | SURVIVORS |
| 13  | `HeldGrant` (E-11)                        | `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts:504-508`                                                                                                                                                                                    | UI        |
| 14  | per-call `Intl.NumberFormat` (E-12)       | `libs/features/shared/catalog/src/lib/content/catalog.presenter.ts:156-175`; `libs/features/admin/loyalty/src/lib/admin-rhythm/admin-rhythm.words.ts:194`; `libs/features/staff/client-card/src/lib/client-card.format.ts:126`; `libs/ui/wall-clock/src/lib/wall-clock.ts` | INTL      |
| 15  | `familyOfMedal` (E-13)                    | `libs/features/staff/client-card/src/lib/achievements.presenter.ts:343-357, :917, :1573`; `client-pages.vm.ts:210-218`; `medal-detail.presenter.ts:858, :942`; `glance.presenter.ts:805`; `medals.presenter.ts:779, :832, :864`                                            | CARD      |
| 16  | reopen busy (E-14)                        | `libs/ecs-core/src/pipelines/transition-appointment.pipeline.ts:55-77, :111-125, :190-230`; `transition-appointment.pipeline.spec.ts:356-405`                                                                                                                              | REOPEN    |
| 17  | programs rules (E-15)                     | `firestore.rules:484-499`; `firestore.rules.integration.spec.ts:656-700`; live-writer proof (unchanged) `programs.adapter.integration.spec.ts:112-113, :205-240`                                                                                                           | RULES     |
| 18  | unused write grants (E-16)                | `firestore.rules:379-417, :572-583`; `firestore.rules.integration.spec.ts:801-824`; `catalog.adapter.integration.spec.ts:140` (title)                                                                                                                                      | RULES     |
| 19  | programs status words (E-17)              | `libs/infrastructure/i18n/src/lib/program-status-words.ts`; `libs/infrastructure/i18n/src/index.ts:2`; `admin-programs.ts:30-31, :98-99` (+ `.html`); `marketing-careers.ts:1, :121`; `marketing-courses.ts:1, :150`                                                       | I18N      |
| 20  | error words (E-18)                        | `libs/infrastructure/i18n/src/assets/i18n/{bg,en}.json` `errors`                                                                                                                                                                                                           | I18N      |
| 21  | DST end-to-end word case                  | `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts` (new case)                                                                                                                                                                                                  | I18N      |
| 22  | swipe `@HostListener`s → host metadata    | `libs/features/staff/dashboard/src/lib/swipe-to-delete/swipe-to-delete.directive.ts:5, :37, :74, :88, :110-111`                                                                                                                                                            | UI        |
| 23  | showcase `::ng-deep`                      | `apps/showcase/src/app/pages/controls/phone-field/phone-field.page.css:18`; `apps/showcase/src/app/shared/demo.ts`                                                                                                                                                         | UI        |
| 24  | visit-row spec's `{ kind }` fixture words | `libs/features/shared/visits/src/lib/visit-row.presenter.spec.ts:174-199` and the 24 `{ kind: '…' }` call sites                                                                                                                                                            | UI        |
| 25  | typecheck red (E-19)                      | `libs/ui/patterns/src/lib/section-header/section-header.spec.ts:588-589`                                                                                                                                                                                                   | UI        |
| 26  | gauge reds (E-19)                         | `libs/ui/patterns/src/lib/gauge/gauge.spec.ts:490, :542, :594, :1163`                                                                                                                                                                                                      | UI        |
| 27  | visit-pills red (E-19)                    | `libs/features/shared/visits/src/lib/visits-browser/visit-pills.spec.ts:313-315`                                                                                                                                                                                           | UI        |
| 28  | visits-page red (E-19)                    | `libs/features/staff/client-card/src/lib/visits-page.presenter.spec.ts:226-241`                                                                                                                                                                                            | CARD      |
| 29  | e2e reds (E-19) + programs journey        | `apps/web/e2e/landing.spec.ts:121-146`; `client-card-glance.spec.ts:336-380, :679-765`; `*-screenshots.spec.ts` + `*-snapshots/*.png`; NEW `apps/web/e2e/programs.spec.ts`                                                                                                 | E2E       |

---

## 2. Contracts

### 2.1 Functions (RETRY)

```ts
const REBUILD_CAPACITY_ON_EXCEPTION_FN = 'rebuildCapacityOnExceptionChange';
const REBUILD_CAPACITY_ON_ROSTER_FN = 'rebuildCapacityOnRosterChange';
const REBUILD_CAPACITY_ON_LOCATION_FN = 'rebuildCapacityOnLocationChange';
const REBUILD_CAPACITY_ON_SETTINGS_FN = 'rebuildCapacityOnSettingsChange';

export const rebuildCapacityOnExceptionChange = onDocumentWritten(
  { document: EXCEPTION_DOC, retry: true },
  retryingTrigger(
    { fn: REBUILD_CAPACITY_ON_EXCEPTION_FN, timeoutSeconds: null },
    root.edge,
    (event: DocumentWriteEvent<{ readonly docId: string }>) =>
      rebuildCapacityFrom(CapacitySource.Exception, event.params),
  ),
);
// …Roster (params { barberId }), Location and Settings (no params) the same.
```

`main.spec.ts`: the four `ENDPOINTS` rows → `written('<path>', true)`; the
D-5 describe's `RETRIED` table gains the four rows (pipeline
`rebuildCapacity`), so "a transient failure is rethrown, a decisive one
logged once and dropped" is proven for each.

### 2.2 ecs-core (GUARD)

```ts
// stored-document.system.ts
function appointmentNoteFault(doc: StoredDocument): string | null; // 'id' | 'text' | 'authorUserId' | 'writtenAtUtcMs' | null
function appointmentNote(
  doc: StoredDocument,
): Result<AppointmentNote, RepositoryError>;
// guardOf: case Collections.AppointmentNotes: return appointmentNote;
```

Adapter: `appointmentNotePorts(db: Firestore, guard: ReadGuard = UNGUARDED): AppointmentNotePorts`.

### 2.3 ecs-core (WAITLIST)

```ts
export namespace WaitlistCall {
  export type Input = {
    readonly locationId: string | null;
    readonly days: readonly DayInput[];
    readonly cart: CartInput;
  };
  export type CartInput = {
    readonly cartSeats: readonly CartSeatInput[];
    readonly cartNextSequence: number;
  };
  export type CartSeatInput = {
    readonly seatKey: string;
    readonly lines: readonly CartLineInput[];
  };
  export type CartLineInput = {
    readonly lineId: string;
    readonly serviceId: string;
    readonly variantId: string | null;
    readonly barberId: string | null;
    readonly locationId: string | null;
  };
}
// WaitlistSystem
cartAsSent(raw: WaitlistCall.CartInput): BookingCart; // X.of per id, never parse — the door judges
```

`lineReadable` takes `WaitlistCall.CartLineInput` (a `CartLine` is one).
`withinReadBounds(cart: WaitlistCall.CartInput, maxPartySize)` (counts
only).

### 2.4 ecs-core (CORE)

```ts
// testing/test-support.ts (exported by @core/testing)
export function wallIso(utcEpochMs: UtcEpochMs, timeZone: TimeZone): string;
// components/birth-date.data.ts
toLocalDate(birthDate: BirthDate): LocalDate | null;
// errors/accounts.error.ts
export namespace AccountsError { export type AvatarRefusal = UploadAvatarNotAnImage | UploadAvatarTooLarge | UploadAvatarUploadFailed; }
export type AvatarUploadError = AccountsError.AvatarRefusal | IdentityError.IdentifierMissing;
```

### 2.5 Indexes (TTL)

```json
{ "collectionGroup": "otps", "fieldPath": "purgeAt", "ttl": true, "indexes": [] },
{ "collectionGroup": "notifications", "fieldPath": "purgeAt", "ttl": true, "indexes": [] },
{ "collectionGroup": "waitlistRequests", "fieldPath": "purgeAt", "ttl": true, "indexes": [] },
{ "collectionGroup": "barberBusy", "fieldPath": "purgeAt", "ttl": true, "indexes": [] },
{ "collectionGroup": "capacity", "fieldPath": "purgeAt", "ttl": true, "indexes": [] },
{ "collectionGroup": "impersonationSessions", "fieldPath": "purgeAt", "ttl": true, "indexes": [] },
{ "collectionGroup": "barberLeadTimeSamples", "fieldPath": "purgeAt", "ttl": true, "indexes": [] }
```

Validated with `pnpm exec firebase deploy --only firestore:indexes --dry-run
--project demo-creativo-test` if the CLI accepts a dry run offline;
otherwise `node -e` JSON parse + the firebase-tools validator call
(`require('firebase-tools/lib/firestore/api')` is NOT run against a project).
Never a real deploy.

### 2.6 Rules (RULES)

```
function isLocalizedText(v) {
  return v is map && v.keys().hasOnly(['bg', 'en']) && v.keys().hasAll(['bg', 'en'])
    && v.bg is string && v.en is string;
}
function isLocalizedTextOrNull(v) { return v == null || isLocalizedText(v); }
function isTextOrNull(v) { return v == null || v is string; }

function validPosition(d) {
  return d.keys().hasOnly(['title', 'summary', 'locationIds', 'positionStatus', 'applyUrl', 'sortOrder'])
    && d.keys().hasAll(['title', 'summary', 'locationIds', 'positionStatus', 'applyUrl', 'sortOrder'])
    && isLocalizedText(d.title) && isLocalizedText(d.summary)
    && d.locationIds is list
    && d.positionStatus in ['OPEN', 'CLOSED']
    && isTextOrNull(d.applyUrl) && d.sortOrder is number;
}
function validCourse(d) { /* title, description, enrollmentStatus in ['OPEN','UPCOMING','CLOSED'], startsLabel (LocalizedText|null), applyUrl, sortOrder */ }
function validEvent(d) {
  /* utcEpochMs is int; title, description; localDate is string && matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
     startMinutes is int && 0 <= startMinutes < 1440; locationId (string|null); applyUrl; sortOrder */
}
match /positions/{positionId} {
  allow read: if true;
  allow create, update: if isCatalogManager() && validPosition(request.resource.data);
  allow delete: if false;
}
```

The exact key lists, numeric types and ranges are read off the entities and
`ProgramsSystem` (the system validates on the way in); the rule may be
LOOSER than the system, never stricter. Unused grants (E-16):
`allow write: if false;`.

### 2.7 i18n (I18N)

`programs.status.position.{OPEN,CLOSED}` and
`programs.status.enrollment.{OPEN,UPCOMING,CLOSED}` in both catalogues
(values `open` / `closed` / `upcoming`). New `errors.<CODE>` leaves per
E-18. `catalogue-parity.spec.ts` stays green (both languages, SCREAMING
codes under `errors.`).

### 2.8 Wall clock (INTL)

```ts
export function formatMinutesRange(
  min: DurationMinutes,
  max: DurationMinutes,
  locale: string,
): string;
export function formatCount(value: number, locale: string): string;
```

Cached per locale (module `Map`s); exported from `libs/ui/wall-clock/src/index.ts`.

---

## 3. Packages — waves and DISJOINT file ownership

Rules for every package: re-read each site before editing; NEVER git commit,
push, stash, checkout, reset or worktree-add; undo your own edit by the
inverse edit; `git grep` misses untracked files (use `grep -r` for new
files); never `pnpm install/add/remove`, never `nx reset`; never run the
runbook grep gates; never run an emulator journey unless the package is
marked `runsEmulators`; per-package typecheck is PROJECT-scoped
(`pnpm nx run <project>:typecheck --skip-nx-cache`) — `run-many -t
typecheck` (with `rm -rf dist/out-tsc` first) is the integrator's, because
wave-0 packages run side by side. A file not in a package's list is not
its to edit: a forced edit elsewhere is reported to the integrator.

### Wave 0 (twelve packages, side by side)

#### RETRY — the four capacity triggers retry

- **Files:** `apps/functions/src/main.ts`, `apps/functions/src/main.spec.ts`,
  `apps/functions/src/wire/triggers.wire.ts` (comment only).
- **Brief:** E-1 / §2.1. Add the four `fn` constants beside
  `REBUILD_CAPACITY_ON_BUSY_FN`; wrap the four exports exactly like
  `rebuildCapacityOnBusyChange`; update the root's JSDoc (`main.ts:178-183`:
  "three retry flags flipped by edge-hardening D-5" → seven, naming pass E)
  and `triggers.wire.ts`'s "Which triggers retry" paragraph. In
  `main.spec.ts` flip the four `ENDPOINTS` rows to `true`, update the
  header comment, add the four rows to `RETRIED`. Do NOT touch
  `trigger-attempt.system.ts` or `edge.ts`. Gate: `pnpm nx test functions`,
  `pnpm nx run functions:typecheck --skip-nx-cache`, `pnpm nx lint functions`.

#### GUARD — the note guard

- **Files:** `libs/ecs-core/src/systems/stored-document.system.ts`,
  `libs/ecs-core/src/systems/stored-document.system.spec.ts`,
  `libs/ecs-core/src/ports/notes-photos.port.ts` (JSDoc only),
  `libs/infrastructure/firestore/src/lib/appointment-notes.adapter.ts`,
  `libs/infrastructure/firestore/src/lib/appointment-notes.adapter.spec.ts`,
  `apps/web/src/app/app.config.ts`,
  `libs/ecs-core/src/pipelines/append-team-note.pipeline.spec.ts` (only if a
  case pins the port's failure set).
- **Brief:** E-2 / §2.2. The guard follows the existing three (fixed check
  order, allocation-free fault, same object on admit). Register it in
  `guardOf` and update the system's and registry's JSDoc ("the four main
  stored archetypes"). Adapter: the `guard` parameter defaulting to
  `UNGUARDED` (DEP-11 of the edge hardening — unguarded by default);
  `observeDoc(ref, guard)`; inside `runTransaction`, admit before `decide`;
  a refusal returns from the transaction callback without `tx.set` and the
  port answers it (`report` through `guard.log` once). Wire the guard at
  `app.config.ts:438`. Specs: purity + each field's refusal + the same
  object on admit (system); adapter — observe emits the refusal and stays
  subscribed; update with a malformed stored note calls no `decide`,
  writes nothing, answers `REPOSITORY_MALFORMED`; unguarded keeps today's
  behaviour. Gate: `pnpm nx test ecs-core`, `pnpm nx test firestore`, the two projects'
  typecheck, `pnpm nx test web`.

#### TTL — declared policies

- **Files:** `firestore.indexes.json`, `docs/architecture/firestore-runbook.md`.
- **Brief:** E-3 / §2.5. Append the seven overrides (keep the file's
  existing order and style); re-prove no `purgeAt` query; rewrite runbook
  §2.2, §2.3's lead-in, §2.4's last bullet and §3 step 3 as E-3 says (keep
  §2.1's table and §2.3's ACTIVE check and console check; the release gate
  stays). If §1's matrix has an `appointmentNotes` row, note "guarded at read
  (pass E, E-2)". Validate the JSON (§2.5). No other file.

#### WAITLIST — the cart parsed in its door

- **Files:** `libs/ecs-core/src/components/waitlist-call.data.ts`,
  `libs/ecs-core/src/systems/waitlist.system.ts`,
  `libs/ecs-core/src/systems/waitlist.system.spec.ts`,
  `libs/ecs-core/src/pipelines/request-waitlist.pipeline.ts`,
  `libs/ecs-core/src/pipelines/request-waitlist.pipeline.spec.ts`,
  `apps/functions/src/wire/waitlist.wire.ts`,
  `apps/functions/src/wire/waitlist.wire.spec.ts`.
- **Brief:** E-4 / §2.3. Behaviour frozen: before editing, add (or
  identify) spec cases pinning today's door order on the raw-cart edge
  cases — an id holding `/`, a blank `seatKey`, a blank `locationId`, a
  blank `lineId` (`invalidRequest('cart')`), a non-integer
  `cartNextSequence`, a cart past the read bound — and keep them green
  through the reshape. `cartAsSent` gets a purity case and an "every id as
  sent, nothing parsed" case. The wire spec proves the decoded command
  carries raw strings. Gate: `pnpm nx test ecs-core`,
  `pnpm nx test functions`, `pnpm nx run ecs-core:typecheck
--skip-nx-cache`, `pnpm nx run functions:typecheck --skip-nx-cache`,
  `pnpm nx lint ecs-core`, `pnpm nx lint functions`.

#### CORE — survivors, the avatar union, the birth date

- **Files:** `libs/ecs-core/src/systems/achievements.system.ts`,
  `libs/ecs-core/src/systems/achievements.system.spec.ts`,
  `libs/ecs-core/src/systems/zoned-time.system.ts`,
  `libs/ecs-core/src/systems/zoned-time.system.spec.ts`,
  `libs/ecs-core/src/testing/test-support.ts`,
  `libs/ecs-core/src/testing/test-support.spec.ts`,
  `libs/ecs-core/src/testing/index.ts` (only if the helper needs an export
  line), `libs/ecs-core/src/pipelines/program-content.pipeline.spec.ts`,
  `libs/ecs-core/src/systems/policy-recompute-job.system.spec.ts`,
  `apps/web/src/testing/e2e-appointment-seed.spec.ts`,
  `libs/ecs-core/src/components/birth-date.data.ts`,
  `libs/ecs-core/src/components/birth-date.data.spec.ts`,
  `libs/ecs-core/src/errors/accounts.error.ts`,
  `libs/ecs-core/src/errors/accounts.error.spec.ts`,
  `libs/features/shared/shell/src/lib/identity/avatar-refusal.ts`,
  `libs/features/client/profile/src/lib/profile.store.ts`,
  `libs/features/client/profile/src/lib/client-profile/client-profile.ts`,
  `libs/features/client/onboarding/src/lib/onboarding-flow.store.ts`,
  `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.ts`.
- **Brief:** E-6 (`firstStart`, `toIso`), E-7, E-8 / §2.4. `wallIso` is
  test support (Law 7.1: no `Date` — `formatToParts(number)`); follow
  E-6's site table exactly: the two `toIso` describes of the zoned-time
  spec (`:773-823`, 5 cases; `:1445-1486`, 2 cases) are deleted and
  restated in `test-support.spec.ts` (Sofia summer and winter, the repeated
  hour, Kolkata, UTC `+00:00`, São Paulo, the negative epoch, the
  `parseOffsetIso` round-trip, the four legacy literals, the property, an
  unknown zone throwing); the single sites (`:127-129`, `:756`, `:1085`,
  `:1188`) re-point to `wallIso`; the purity run's `iso:` entry (`:1605`)
  goes; the comments `:23` / `:127` are reworded; `isoAt` is deleted.
  Hand back the per-file case counts (deleted / added). Re-prove every zero-caller claim
  with `git grep` + `grep -r` before deleting. The avatar union only NAMES
  what each site accepts today (no widening, no narrowing). Gate: ecs-core
  test + `--coverage` (statements must not drop below 98.33 %), the
  touched projects' tests and typechecks (`client-profile`,
  `client-onboarding`, `shared-shell`, `web`), `pnpm nx run
verify-tools:layering --skip-nx-cache` (one home per name).

#### REOPEN — prove the busy window

- **Files:** `libs/ecs-core/src/pipelines/transition-appointment.pipeline.ts`,
  `libs/ecs-core/src/pipelines/transition-appointment.pipeline.spec.ts`.
- **Brief:** E-14. Write the proof spec FIRST over one `memoryStore`
  (`memoryTxPorts`, the booking fixtures of `@core/testing`), one case per
  reopen edge — `CANCELLED`, `NO_SHOW` and `COMPLETED` → `CONFIRMED`.
  Outcome (a) (refused on all three): keep the spec, no code change, ledger
  says "not real". Outcome (b) (admitted on any): add the busy merge to the
  reopen's plan (read the reopened seats' busy days inside the transaction
  through `readPlacementSet`, merge with `busyMergeWrites`, only when
  `!BookingLifecycle.isLive(before) && BookingLifecycle.isLive(after)` on
  the appointment), update the pipeline's JSDoc ("No busy write — F1-2" →
  the merge, pass E), and the plan spec's exact `WriteOp[]` for each of the
  three edges; every other transition's plan unchanged. Do NOT add a
  collision check to the `NO_SHOW` / `COMPLETED` reopen (§7.2 N-5). Gate:
  `pnpm nx test ecs-core`, typecheck, lint, layering.

#### RULES — programs shape checks, unused grants denied

- **Files:** `firestore.rules`,
  `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`,
  `libs/infrastructure/firestore/src/lib/catalog.adapter.integration.spec.ts`
  (the TITLE of `:140` only — 'denies writes through the rules (public
  read, catalogue-manager write only)' becomes false after E-16; rename to
  '… (public read, no client write)'; body unchanged),
  `libs/infrastructure/firestore/src/lib/programs.adapter.integration.spec.ts`
  (READ-ONLY reference: it must pass unchanged — listed so no other package
  touches it; any edit to it is a reported failure of the rule, not a fix).
- **Brief:** E-15, E-16 / §2.6. Programs: valid entity bodies (built with
  the programs fixtures / `ProgramsSystem`) succeed for a catalogue manager;
  each malformed shape (an extra key, a missing key, a wrong status tag, a
  `title` without `en`, a `startMinutes` of 1440, a string `sortOrder`)
  fails; a delete fails; a client write fails. The existing
  `'lets a content_manager write %s'` case (`:686-699`) writes a valid
  entity body instead of `{ title }` (DEP-7). Before writing a check, read
  the bodies `programs.adapter.integration.spec.ts:205-240` saves (the
  fixtures of `@core/testing` `programs.fixtures.ts`) — every one must pass
  the rule. Unused grants: the `settings` block (`:801-824`) keeps BOTH
  existing cases unchanged ('lets an anonymous visitor read the booking
  policy', 'refuses a non-admin write to settings' — there is no
  admin-success case to flip); its describe is renamed `'settings — public
read, no client write'` and gains a NEW case 'refuses an admin's write to
  settings'; new cases: an admin / a catalogue manager / a roster editor
  writing `serviceCategories`, `services`, `barbers`, `locations`,
  `barberSchedules` all FAIL; reads unchanged. KEEP `scheduleExceptions`
  and `coupons` as they are. Keep `role.rules-parity.spec.ts` green
  (`pnpm nx test ecs-core -- role.rules`).
  **This package does NOT run `test:emulator`** (emulator journeys belong
  to the integrator and E2E only); the package runs `pnpm nx run
firestore:typecheck --skip-nx-cache` and the lint. `runsEmulators:
false`. **The integrator runs `pnpm run test:emulator` ALONE right after
  RULES is integrated** (before any other wave-0 emulator run and before
  wave 1 starts — E2E's programs journey depends on these rules); a red in
  `firestore.rules.integration.spec.ts`, `programs.adapter.integration.spec.ts`
  or `catalog.adapter.integration.spec.ts` goes back to RULES as a fixer
  round before E2E is launched.

#### I18N — status words, error words, the DST case

- **Files:** `libs/infrastructure/i18n/src/assets/i18n/bg.json`,
  `libs/infrastructure/i18n/src/assets/i18n/en.json`,
  `libs/infrastructure/i18n/src/lib/program-status-words.ts` (delete),
  `libs/infrastructure/i18n/src/index.ts`,
  `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts`,
  `libs/infrastructure/i18n/src/lib/translate-coded-error.spec.ts` (only if
  a case uses a code that now has words as its "unknown" example),
  `libs/features/admin/programs/src/lib/admin-programs/admin-programs.ts`,
  `…/admin-programs.html`, `…/admin-programs.spec.ts`,
  `libs/features/marketing/careers/src/lib/marketing-careers/marketing-careers.ts`,
  `…/marketing-careers.html`, `…/marketing-careers.spec.ts`,
  `libs/features/marketing/courses/src/lib/marketing-courses/marketing-courses.ts`,
  `…/marketing-courses.html`, `…/marketing-courses.spec.ts`.
- **Brief:** E-17, E-18, the DST case. Status words: byte-identical on
  screen; the three surfaces' specs pin the printed words unchanged (and
  read the real catalogue through their existing transloco test setup).
  Error words: write the reachability scan as a scratchpad script (not
  committed) over `libs/ecs-core/src/errors/*.error.ts` +
  `primitives/primitive.error.ts`, `apps/functions/src/edge.ts`'s table
  (`S.Internal` rows excluded) and the web's translate call sites; for each
  code decide reachable / not with a one-line reason; add words only for
  reachable ones; never change an existing string. Record the full table
  (code · path (1)/(2)/(3) · bg · en, and the not-reachable codes with
  their reason) in your hand-back for the ledger. A spec elsewhere that
  pinned the old fallback of a code you word (the generic copy or the raw
  code) is a FORCED edit: report it with its path (do not edit files outside
  your list). DST case: one `word-pipeline-error.spec.ts` case taking a
  callable refusal with `DST_GAP_INVALID_TIME` and its allowlisted details
  through `PipelineError` (the same decoding `pipeline.error.spec.ts:546`
  uses) to `wordPipelineError` with the REAL bg and en catalogues and the
  surface's `wallClock` extra param, asserting the full sentence. Gate:
  `pnpm nx test i18n`, the three features'
  tests, typechecks, lints; `catalogue-parity.spec.ts` green.

#### CARD — the medal family by id, the visits-page red

- **Files:** `libs/features/staff/client-card/src/lib/achievements.presenter.ts`,
  `…/achievements.presenter.spec.ts`, `…/client-pages.vm.ts`,
  `…/glance.presenter.ts`, `…/medals.presenter.ts`,
  `…/medal-detail.presenter.ts`, `…/glance.presenter.spec.ts`,
  `…/medals.presenter.spec.ts`, `…/medal-detail.presenter.spec.ts`,
  `…/visits-page.presenter.spec.ts`,
  `libs/features/staff/client-card/src/testing/client-pages.vm-fixtures.ts`
  (`medalOf` and the `MedalVm` table — forced by the required field),
  `libs/features/staff/client-card/src/testing/client-card.fixtures.ts`
  (only if a fixture builds a `MedalVm` literal), and any other spec under
  `libs/features/staff/client-card/src/**` that builds a `MedalVm` literal
  (found by `grep -rn "seriesId:"` — e.g. `…/ledger.presenter.spec.ts`,
  `…/achievement-detail/achievement-detail.spec.ts`; each named in the
  hand-back).
- **Brief:** E-13 (DEP-4) and the visits-page red (E-19). The DEP spec: a
  catalogue with a trackless season whose id equals a family's id — before
  (documented in the case's comment) the season tile drew the family's
  ring; after, `familyOfMedal` answers `null` for it, and the family's own
  medal still finds its family. Every `MedalVm` literal gains `familyId`
  (`medalOf` defaults it to `BadgeSeriesId.of(seriesId)`; season fixtures
  pass `null`).
  The visits-page case expects the two lines (cite `c1db6611` and
  `visit-row.presenter.spec.ts:344-347` in a comment). Gate:
  `pnpm nx test staff-client-card` (alone — heavy),
  `pnpm nx run staff-client-card:typecheck --skip-nx-cache`,
  `pnpm nx lint staff-client-card`.

#### UI — the design-system and spec tidy, four reds

- **Files:** `libs/ui/patterns/src/lib/section-header/section-header.spec.ts`,
  `libs/ui/patterns/src/lib/gauge/gauge.spec.ts`,
  `libs/features/shared/visits/src/lib/visits-browser/visit-pills.spec.ts`,
  `libs/features/shared/visits/src/lib/visit-row.presenter.spec.ts`,
  `libs/ui/controls/src/lib/month-picker/month-picker.ts`,
  `libs/ui/controls/src/lib/month-picker/month-picker.spec.ts`,
  `libs/ui/icons/eslint.config.mjs`, `tools/lint-rules/index.mjs` (export
  only, if needed), `tools/lint-rules/ecs-core-base-paths.spec.mjs` (only
  if it enumerates the icons block),
  `libs/features/staff/dashboard/src/lib/swipe-to-delete/swipe-to-delete.directive.ts`,
  `…/swipe-to-delete.directive.spec.ts`,
  `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts`,
  `apps/showcase/src/app/pages/controls/phone-field/phone-field.page.css`,
  `apps/showcase/src/app/pages/controls/phone-field/phone-field.page.html`,
  `apps/showcase/src/app/pages/controls/phone-field/phone-field.page.ts`,
  `apps/showcase/src/app/shared/demo.ts`.
- **Brief:** E-5, E-9, E-11, items 22–24, and the four reds of E-19
  (section-header, gauge × 4, visit-pills). Reds: the spec side, as the E-19
  table says, each with a comment citing the commit (`98adfb3f`,
  `c1db6611`). A shared whitespace-normalising helper, if two specs need
  one, is spec-local in each (never a production export). Swipe directive:
  `host: { '(pointerdown)': 'onPointerDown($event)', … }` merged into the
  existing `host` block, behaviour identical (its spec green unchanged).
  Showcase: replace `:host ::ng-deep .sc-demo__canvas` with the demo
  shell's own input or attribute (`demo.ts` styles its canvas from it, e.g.
  `data-canvas-overflow="visible"`), the phone-field page sets it; the
  rendered page identical (check in the showcase dev server or its
  Playwright run if one exists — never refresh showcase snapshots). Visit-row
  spec: the fixture parameter becomes `{ readonly bookingStatus:
VisitStatusSpec; readonly cancellationReason?: string }` (or the
  dictionary tags), every call site renamed, expectations unchanged. Icons
  lint: E-5; run `pnpm nx lint icons` and fix any hit by
  its brand. Gate: `pnpm nx run patterns:typecheck --skip-nx-cache` (must be
  GREEN — the standing typecheck red closes here), `pnpm nx test patterns`,
  `pnpm nx test shared-visits`, `pnpm nx test controls`,
  `pnpm nx test staff-dashboard` (alone — heavy),
  `pnpm nx run lint-rules:test`, lints of every touched project,
  `pnpm nx build showcase`.

#### INTL — cached number formatters

- **Files:** `libs/ui/wall-clock/src/lib/wall-clock.ts`,
  `libs/ui/wall-clock/src/lib/wall-clock.spec.ts`,
  `libs/ui/wall-clock/src/index.ts`,
  `libs/features/shared/catalog/src/lib/content/catalog.presenter.ts`,
  `libs/features/shared/catalog/src/lib/content/catalog.presenter.spec.ts`,
  `libs/features/shared/catalog/src/lib/content/catalog-wording.service.ts`,
  `libs/features/admin/loyalty/src/lib/admin-rhythm/admin-rhythm.words.ts`,
  `libs/features/admin/loyalty/src/lib/admin-rhythm/admin-rhythm.words.spec.ts`,
  `libs/features/staff/client-card/src/lib/client-card.format.ts`,
  `libs/features/staff/client-card/src/lib/client-card.format.spec.ts`.
- **Brief:** E-12 / §2.8. Pin the CURRENT words in bg and en first (one
  case per helper: a single value, a range, an equal min/max, a 4-digit
  count with the locale's grouping), then move; the pins stay green.
  `formatRange` feature-detection stays. Gate: the four projects' tests,
  typechecks, lints; `presenter-purity` clean.

#### SURVIVORS — the alias specs and the preview delegate

- **Files:** `libs/features/client/booking/src/lib/schedule-step/day-availability.spec.ts`
  (delete), `libs/features/admin/loyalty/src/lib/admin-rhythm/rhythm-service-groups.spec.ts`
  (delete), `libs/features/admin/loyalty/src/lib/admin-rhythm.preview.ts`,
  `libs/features/admin/loyalty/src/lib/admin-rhythm.preview.spec.ts`,
  `libs/ecs-core/src/pipelines/shop-day.pipeline.spec.ts`,
  `libs/ecs-core/src/systems/capacity.system.spec.ts`,
  `libs/ecs-core/src/systems/catalog.system.spec.ts`,
  `libs/ecs-core/src/systems/streak-preview.system.spec.ts` (fold targets —
  edit only to add a missing case).
- **Brief:** E-6 (`rhythmPreviewReadsFacts`), E-10. For each `it` of the
  two feature specs and of the preview delegate's block, name its successor
  case (file:line) or fold it. Hand back the mapping table. Gate: ecs-core,
  `client-booking`, `admin-loyalty` tests; typechecks; lints; the case
  count must not drop by more than the cases proven duplicated.

### Wave 1 (one package, after wave 0 is integrated)

#### E2E — the e2e reds, the screenshots, the programs journey

- **runsEmulators: true** — the ONLY package that runs `e2e:web`, ONE AT A
  TIME, never beside another emulator run. Rerun a single spec with
  `START_LOGGING_EMULATOR=true pnpm exec firebase emulators:exec --only
firestore,auth,functions,storage --project demo-creativo-test "pnpm nx e2e
web -- e2e/<spec> --repeat-each=3"`.
- **Files:** `apps/web/e2e/**` (specs, support, `*-snapshots/*.png`), NEW
  `apps/web/e2e/programs.spec.ts`, and — wave 1 runs alone — any file a
  root-cause CODE fix needs (each such file and why recorded in the
  hand-back; a code fix that changes behaviour takes the next free DEP
  number, DEP-9 onward).
- **Brief:** E-19's e2e rows, in this order: (1) `landing.spec.ts:121` —
  run alone, find the failing assertion, root-cause (E-19 leads), fix the
  wrong side, cite. (2) `client-card-glance.spec.ts` `:336` / `:679` — run
  one theme alone, read the DOM at the failure (trace / screenshot), find
  why `client-quick-same` is absent and why the focus is lost after
  «Премахни»; fix the wrong side, cite. (3) The six screenshots — for EACH:
  `Read` the baseline PNG and the actual PNG (and the diff), decide whether
  the difference is an intended design change and name the ruling or commit
  (memory/HANDOFF rulings: the accent law `98adfb3f` 2026-10-06/07,
  revision 3 `c1db6611`, the date-picker style 2026-10-06, the control-fill
  translucency, …); regenerate THAT snapshot only then (`--update-snapshots`
  scoped to the one spec); otherwise do NOT regenerate — report it as a
  regression with both image paths. The landing hero is flaky under load:
  judge it on a solo `--repeat-each=3`. (4) The programs journey: an admin
  (or content manager) signed in through the e2e support creates a position,
  a course and an event through `/admin` programs (the browser write under
  the TIGHTENED rules — the journey proves RULES' shapes admit the live
  writer), then the public pages show them: `/careers` (the position, with
  its status word `open`) and `/courses` (the course, with its status word
  `open` or `upcoming`); `/events` shows the event's title and its date —
  NO status word (`event.entity.ts` has no status field) — both themes if
  the suite's convention is per theme, axe where neighbouring specs check
  it. Before asserting, check whether the PARKED `SiteFooterComponent`
  dev-mode assertion on `/careers`, `/courses`, `/events` (§7.3; the suite
  runs `web:serve`, dev mode) surfaces in the journey (console errors, the
  dev overlay, a failed render); if it does, REPORT it as the journey's
  blocker with the evidence — never weaken the journey (no console-error
  filter, no skipped page) to get past it. (5) The
  full `pnpm run e2e:web` once at the end: expect 0 failures beyond what
  (3) reported; the three known flakes judged solo. Hand back: per red, the
  root cause, the side fixed, the citation; per screenshot, the decision
  and the image paths; the new pass count.

---

## 4. Specs per package (what is added, what is changed ON PURPOSE)

| Package   | Added                                                                                                                                        | Changed on purpose (forced)                                                                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RETRY     | `RETRIED` rows × 4 (transient rethrown, decisive dropped)                                                                                    | `main.spec.ts` ENDPOINTS × 4 `false` → `true` (DEP-1)                                                                                                                                                                                                  |
| GUARD     | `appointmentNote` purity, per-field refusals, same object; adapter observe-refusal and update-refusal cases                                  | none (existing cases run unguarded, the default)                                                                                                                                                                                                       |
| TTL       | none (config)                                                                                                                                | none                                                                                                                                                                                                                                                   |
| WAITLIST  | door-order pins on raw edge cases (if missing); `cartAsSent` purity / as-sent; wire raw-strings case                                         | fixtures typed `WaitlistCall.Input` keep compiling (raw strings accepted)                                                                                                                                                                              |
| CORE      | `wallIso` spec (≥ 7 cases: toIso's literals, the round-trip, the property, unknown zone throws); `BirthDate.toLocalDate` purity + boundaries | `achievements.system.spec.ts:1018-1051` deleted; `zoned-time.system.spec.ts:773-823` (5) and `:1445-1486` (2) deleted, `:127-129`/`:756`/`:1085`/`:1188` → `wallIso`, `:1605` `iso:` entry removed; four spec callers in three other files re-pointed  |
| REOPEN    | the reopen-then-book window proof × 3 edges (`CANCELLED`, `NO_SHOW`, `COMPLETED` → `CONFIRMED`)                                              | under (b) only: the reopen plan's `WriteOp[]` gains the busy `Set`s on each of the three edges (DEP-5)                                                                                                                                                 |
| RULES     | programs shape cases; unused-grant denial cases (incl. a NEW 'refuses an admin's write to settings')                                         | `settings` describe renamed, its two cases unchanged (DEP-6); `catalog.adapter.integration.spec.ts:140` title only (DEP-6); the content-manager programs write case uses valid entity bodies (DEP-7); `programs.adapter.integration.spec.ts` unchanged |
| I18N      | DST end-to-end case; status-word catalogue reads                                                                                             | any spec pinning the generic or raw fallback of a newly worded code (reported, DEP-8)                                                                                                                                                                  |
| CARD      | the season-id-equals-family-id case (DEP-4)                                                                                                  | `MedalVm` literals gain `familyId` (incl. `src/testing/client-pages.vm-fixtures.ts` `medalOf` + its table); `visits-page.presenter.spec.ts:232` two lines (red fixed)                                                                                  |
| UI        | none required                                                                                                                                | `section-header.spec.ts` helper; `gauge.spec.ts` × 4 and `visit-pills.spec.ts` whitespace (reds fixed); `visit-row.presenter.spec.ts` fixture parameter renamed; `staff-dashboard.spec.ts` `HeldGrant` import                                          |
| INTL      | words pins (bg/en) before the move                                                                                                           | none                                                                                                                                                                                                                                                   |
| SURVIVORS | folded cases with no successor                                                                                                               | two feature specs and one preview block deleted (mapping table in the ledger)                                                                                                                                                                          |
| E2E       | `programs.spec.ts`                                                                                                                           | per root cause; snapshots only per §3 E2E (3)                                                                                                                                                                                                          |

---

## 5. DEPARTURES

- **DEP-1 (RETRY) — the four capacity triggers redeliver a transient
  failure.** Before: `rebuildCapacityOnExceptionChange`, `…OnRosterChange`,
  `…OnLocationChange`, `…OnSettingsChange` deployed without `retry`; a
  transient failure (`aborted`, `unavailable`, `deadline-exceeded`,
  `resource-exhausted`) was dropped and `capacity` stayed stale until the
  next write or the 03:00 sweep, and nothing logged an attempt line. After:
  `retry: true`; a transient failure is rethrown and redelivered, every
  failure logs ONE attempt line (`'trigger attempt failed'`), a decisive one
  is dropped. Specs: `main.spec.ts` ENDPOINTS × 4, `RETRIED` × 4.
- **DEP-2 (GUARD) — a malformed `appointmentNotes` document is refused.**
  Before: the note was read as stored (`entityOf`) — the sheet printed
  whatever `text` held and the append joined `stored.text` as stored (a
  non-string `text` joined as `"undefined"` / threw inside the
  transaction). After (guarded, as wired at `app.config.ts`): the live read
  emits `REPOSITORY_MALFORMED` (path, field), reported once; the append
  refuses `REPOSITORY_MALFORMED` and writes nothing. Unguarded construction
  (specs, any other root) is unchanged. Specs: the new adapter and system
  cases.
- **DEP-3 (TTL) — TTL and the `purgeAt` exemptions are deploy
  configuration.** Before: seven manual `gcloud … ttls update` steps;
  `purgeAt` kept its default single-field index. After: `firebase deploy
--only firestore:indexes` creates the seven TTL policies and drops the
  `purgeAt` single-field indexes (no query uses them). No app behaviour
  changes; the runbook's deploy step changes. Specs: none.
- **DEP-4 (CARD) — a season's own medal never draws a family.** Before:
  `familyOfMedal` matched by string, so an archived trackless season whose
  id equalled a family's id drew that family's ring, standing and detail
  hooks. After: `MedalVm.familyId` is `null` on a season's own medal and
  `familyOfMedal` answers `null`. Every other medal unchanged. Specs: the
  new `achievements.presenter.spec.ts` case; `MedalVm` literals.
- **DEP-5 (REOPEN, only under outcome (b)) — a reinstated visit holds its
  chair in `barberBusy` at once.** Before: reopening a `CANCELLED`,
  `NO_SHOW` or `COMPLETED` visit to `CONFIRMED` wrote no busy day, so until
  `rebuildBusyOnAppointmentChange` ran a booking could be admitted over it.
  After: when the appointment goes from non-live to live
  (`!isLive(before) && isLive(after)`), the reopen's transaction merges the
  visit's blocks onto the busy days it reads (as a booking does); the
  trigger's recompute lands on the same document. Which reopens are refused
  is unchanged (the #7 check still runs only for a party reinstatement of
  a cancelled visit — §7.2 N-5). Specs: the three proof cases (now
  refusals) and the reopen plan's `WriteOp[]` for each edge.
  **Read set (fixer, after review):** the busy days and their exceptions
  are read only for a move from a non-live visit TO a live status
  (`!isLive(appointment) && isLive({ bookingStatus: cmd.to })` — a party or
  a seat reopen); every other move reads exactly what it read on
  `6d64f69f` and keeps its own answer. The reopen itself now shares
  `bookAppointment`'s malformed-busy guard (edge-hardening D-3): a
  `barberBusy` day under the visit's keys that fails its read-time guard
  refuses the reopen with `REPOSITORY_MALFORMED` and writes nothing, where
  on `6d64f69f` the reopen committed and the trigger rewrote the day.
  Specs: + `'a move from a %s visit to a status that is not live reads no
busy day, so it keeps its own answer'` × 3 (red with the read on every
  non-live root, green with the guard).
- **DEP-6 (RULES) — no client writes the catalogue, the rosters or the
  settings.** Before: a catalogue manager could write `serviceCategories`,
  `services`, `barbers`, `locations`; a roster editor `barberSchedules`; an
  admin `settings` — from a browser, though no app code did. After: `allow
write: if false` (the Admin SDK still writes). Specs: new denial cases
  (an admin's `settings` write; catalogue / roster writes by each granted
  role); the `settings` describe renamed ('public read, no client write'),
  its two existing cases unchanged; `catalog.adapter.integration.spec.ts:140`'s
  title renamed (body unchanged).
- **DEP-7 (RULES) — programs writes are shape-checked; deletes refused.**
  Before: any body, any delete by a catalogue manager. After: a create or
  update must be the entity body (key allowlist, types, tags, ranges); a
  delete is refused (none exists in the app). Specs: the programs block
  (the `'lets a content_manager write %s'` case writes a valid entity body;
  new malformed-shape and delete denials); `programs.adapter.integration.spec.ts`
  passes UNCHANGED (the live writer's proof).
- **DEP-8 (I18N) — UI-reachable codes show their own words.** Before: a code
  with no `errors.<code>` leaf printed the RAW code (`translateCodedError`)
  or the surface's generic copy (`wordPipelineError`). After: the words of
  the ledger's "E-18 words" table. No existing string changes. Specs: any
  forced fallback pin (reported by I18N) and the new keys' parity.
- **DEP-9 (E2E, code outside `apps/web/e2e/**`) — «Премахни» on a
  birthday grant hands the focus to the birthday gift.** Before: after
  «Премахни» on a birthday grant, `StaffVisitEditor.removeReward`
  refocused the glance's `client-reward-ready` ticket, which is absent
  while the birthday band carries the gift, so the focus fell to the body.
  After: the focus goes to `[data-testid="client-birthday-gift"]`, or to the
  ticket when the band is not drawn; every other grant unchanged. Specs: the
  new `staff-visit-editor.spec.ts` case (red without the fix, green with
  it); `client-card-glance.spec.ts`' birthday test (`:707`) now green.
  Origin: `c1db6611` (where both `rewardTicket` and the birthday card came
  in). A spec-only or snapshot-only fix is no DEP.

Frozen (no DEP): E-4 (waitlist reshape), E-5, E-6, E-7, E-8, E-9, E-10,
E-11, E-12, E-17 (status words byte-identical), items 21–24, and the
spec-side red fixes.

---

## 6. Gates

### 6.1 Per package (before handing back)

The package's own project tests, project-scoped typecheck
(`--skip-nx-cache`) and lint, as each brief lists. Never the runbook grep
gates; never an emulator journey (E2E excepted); never `run-many -t
typecheck`.

### 6.2 Grep gates (integrator)

```bash
# E-1: seven retrying projection triggers in main.ts
grep -c 'retry: true' apps/functions/src/main.ts            # before + 4
git diff 6d64f69f -- libs/ecs-core/src/systems/trigger-attempt.system.ts   # empty: allowlist not widened
# E-2
grep -n 'AppointmentNotes' libs/ecs-core/src/systems/stored-document.system.ts
grep -n 'appointmentNotePorts(' apps/web/src/app/app.config.ts   # passes guardedReads
# E-3
grep -c '"ttl": true' firestore.indexes.json               # 7
grep -n 'gcloud firestore fields ttls update' docs/architecture/firestore-runbook.md  # 0 or the one fallback line
# E-4
grep -n 'SeatKeyText\|ServiceId\.of\|CartLineId' apps/functions/src/wire/waitlist.wire.ts   # 0
# E-6 (availability.system.ts keeps an unrelated local `firstStart(gapStart, notBefore, step)`)
git grep -n 'AchievementsSystem.firstStart\|firstStart(starts' -- 'libs/ecs-core/**'   # 0
git grep -n 'toIso' -- '*.ts' '*.mjs'                       # 0
git grep -n 'rhythmPreviewReadsFacts' -- '*.ts'             # 0
# E-9 / E-11
git grep -n 'UiDayKey' -- '*.ts'                            # 0
grep -n 'interface HeldGrant' libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts   # 0
# E-12
git grep -n 'new Intl.NumberFormat' -- 'libs/features/**/*.ts' ':!*.spec.ts'   # 0
# E-13
grep -n 'family.id === medal' libs/features/staff/client-card/src/lib/achievements.presenter.ts  # 0
# E-17
ls libs/infrastructure/i18n/src/lib/program-status-words.ts   # absent
# item 22 / 23
grep -n 'HostListener' libs/features/staff/dashboard/src/lib/swipe-to-delete/swipe-to-delete.directive.ts   # 0
grep -n 'ng-deep' apps/showcase/src/app/pages/controls/phone-field/phone-field.page.css                    # 0
# new files are untracked: grep -r, not git grep. The helper §2.4 names `wallIso`
# landed as `offsetIso` (integrator, §8.1 CORE): `wallIso` is a retired wire word that
# runbook §4.7's '4a · legacy wire' gate forbids in libs/ecs-core/src.
grep -rn 'offsetIso' libs/ecs-core/src/testing apps/web/src/testing
git grep -n 'wallIso' -- '*.ts' '*.mjs'                     # 0
```

### 6.3 FULL gate (integrator, after wave 0, again after wave 1; HANDOFF §4)

HANDOFF §4's command list, in order, one command at a time;
`rm -rf dist/out-tsc` before `run-many -t typecheck --skip-nx-cache`; the
runbook §4.0 preamble, §4.2–§4.5, §4.7, §4.8, §4.9 grep gates (they write a
transient canary file — never while a typecheck, lint or test runs);
`verify:p0`, `test:emulator`, `e2e:web` ONE AT A TIME (wave 0: the
integrator runs `test:emulator` ALONE right after RULES is integrated and before wave 1 is launched — a red there is a RULES fixer round; wave 1: E2E runs `e2e:web`
during its build, the integrator re-runs it at the end).

**The NEW baseline expected after pass E:**

- **typecheck:** every project green — `patterns` no longer red.
- **unit tests:** 0 failures — the 6 standing reds gone (gauge 4,
  visit-pills 1, visits-page 1); the pass count = 12,615 + 6 (the former
  reds) + the added cases − the deleted cases (CORE's `firstStart` block
  and the 7 `toIso` cases of `zoned-time.system.spec.ts` — offset by the
  ≥ 7 `wallIso` cases of `test-support.spec.ts` — and SURVIVORS' mapping
  table) — every drop explained in §8.1.
- **ecs-core coverage:** statements ≥ 98.33 %.
- **test:emulator:** 65 + (253 + the RULES cases added − 0), all green.
- **e2e:web:** 41 + 19 + the programs journey's runs passed, **0
  failures** — unless E2E REPORTED a screenshot as a regression (then that
  one stays red and is listed in §8 for the owner); the flakes
  (`auth-onboarding.spec.ts:106`, `appointments.spec.ts:152`, the landing
  hero) judged on a solo `--repeat-each=3`.
- **layering:** files/edges change by the added/removed files only.
- **build web:** initial bundle within ±1 kB of 576.09 kB (INTL adds two
  tiny cached helpers; no new dependency).
- HANDOFF §4's "Pre-existing red" paragraph is rewritten by the integrator
  to "none".

---

## 7. OWNER items, PARKED, ALREADY-DONE

### 7.1 OWNER (verbatim from the triage, with their source — never decided here)

> **All 26 RULED 2026-10-26** by the owner rulings
> (`docs/architecture/decisions/2026-10-26-owner-rulings.md`, OR-1 … OR-56,
> DEP-F1 … DEP-F38); the ruling follows each item. Nothing here was decided
> by pass E.

1. Location picker for the event's free-text location (flip 4) — HANDOFF §3.3 'Carried forward'; flip-4 F4-2, §10 Q1. — **CLOSED: OR-37 / DEP-F27, OR-38 / DEP-F28.**
2. customers create/update grant for worksTheBook and CustomerOrigin.StaffWalkIn kept with no web writer (the walk-in client-record path) — HANDOFF §3.3 pass B owner flag (b); flip-1 §10 Q7. — **CLOSED: OR-25 / DEP-F19, OR-26 / DEP-F20.**
3. Client time sheet cannot see where a carried companion lands, so such a reschedule is refused by the server — HANDOFF §3.3 'Carried from pass A'. — **CLOSED: OR-7 / DEP-F6.**
4. KEEP-PARKED lifecycle write verbs (AppointmentLifecycleSystem.confirm/complete/markNoShow/cancel/reopenNoShow/reopenSettled/markSeatOutcome), VoucherSystem.redeem, IntervalSetSystem.clip — delete? — HANDOFF §3.3 'Carried from pass B/C/D'; pass-c §9.6; pass-d §9.6. — **CLOSED: deleted — OR-20 / DEP-F15, OR-14, OR-21 / DEP-F16.**
5. Grant burn/restore and voucher issuing (features behind the parked code) — HANDOFF §6 flip-1 OQs; flip-1 §10 Q2. — **CLOSED: OR-13 / DEP-F10 / DEP-F10b (a no-show releases too — the orchestrator's override); OR-14 (voucher issuing deferred, `issue` deleted).**
6. leadTimeSampling gate on sampleBarberLeadTimeDaily; the public busy body in an availability refusal's details — HANDOFF §3.3 'flip 1's other deferred behaviours'; flip-1 §10 Q3. — **CLOSED: OR-27 / DEP-F21 (ungated), OR-12 (declined).**
7. Catalogue edge-guard family (DayHours.parseWeek/DayHoursInput, ServiceComposition.parse, openDay, CATALOG_LOCATION_INVALID_HOURS_*/_TIME_OF_DAY, reserved CatalogErrorCode.LocationInvalidTimezone) — delete or wire to an admin location writer — HANDOFF §3.3 'Carried from pass B' (KEEP-PARKED); §6. — **CLOSED: OR-22 / DEP-F17.**
8. BookingFlowEventKind.SetDayWindows + FlexibleWhen.withWindows (never dispatched) — keep for the per-day window sheet or delete both — HANDOFF §3.3 'Carried from pass B'; §6. — **CLOSED: OR-23.**
9. Pass B owner flag (e): apps/web/src/app/shell/impersonation-banner.ts empty slot — keep or drop — HANDOFF §3.3 pass B owner flags; §6. — **CLOSED: OR-24 / DEP-F18.**
10. Pass B owner flag (f): deploy order of the three deleted composite indexes, and the waitlist request id reseed (every wl_ id changes) — HANDOFF §3.3 pass B owner flags; §6. — **CLOSED: OR-36.**
11. CSP headers block of firebase.json (csp-baseline.md) — HANDOFF §3.3 pass B 'Smaller follow-ups'. — **CLOSED: OR-29 / DEP-F23, OR-30, OR-31.**
12. Law 10.2 OQ-4: keys built from display words (the reward ticket's group key, the glance's held rewards by NAME → coupon id / RewardId on the card contracts) — HANDOFF §3.3 'Carried forward'; §6 decision-extraction OQs. — **CLOSED: OR-15 / DEP-F11.**
13. Law 10.2 OQ-5: should the glance's voucher sum refuse mixed currencies like the wallet's total — HANDOFF §3.3 'Carried forward'; §6. — **CLOSED: OR-17 / DEP-F12.**
14. Law 10.2 OQ-7: the wallet's localeCompare and the glance's input-order ties vs the visit list's code-unit/id tie-breaks — HANDOFF §3.3 'Carried forward'; §6. — **CLOSED: OR-18 / DEP-F13.**
15. CouponGrantSystem's Partial<{ couponOccasion }> constraint — tighten once ClientCardGrant.couponOccasion is required — HANDOFF §3.3 'Carried forward'. — **CLOSED: OR-16.**
16. Owner confirmation of the 4a plan's §11.4 (a) time-sheet re-pin — HANDOFF §3.3 'Carried forward'. — **CLOSED: OR-7 (confirmed).**
17. Opened at 23:56–23:59 the new visit's frame starts at 24:00 (not drawn by the grid) — start it at 23:55 instead? — HANDOFF §3.3 'Fixed after pass D' (Carried, owner, UX). — **CLOSED: OR-1 / DEP-F1.**
18. Pass C OQ-1…OQ-14 (OQ-1 cancel side by reason; OQ-2 isLive; OQ-3 staffWalkIn vs D18; OQ-4 /account's next visit past start; OQ-5 OTP cooldown 30 s vs 60 s; OQ-6 guest label number; OQ-7 off all day; OQ-8 recent visit's client; OQ-9 seeded-day verdict; OQ-10 flow store orchestration; OQ-11 isReadableId tier; OQ-13 OTP escalation sendCount ≥ 3) — HANDOFF §3.3 'Carried from pass C'; pass-c §8. — **CLOSED: OR-43 (OQ-1, 2, 7, 8, 10, 12, 14), OR-11 / DEP-F9, OR-8 / DEP-F7, OR-9 / DEP-F8, OR-6 / DEP-F5, OR-3 / DEP-F3, OR-44 / DEP-F31, OR-10 — pass-c §8.**
19. Pass D OQ-1…OQ-19 (TrackMinute brand, stray helper files, pooled answers on own shop clock, parseIsoIn/toIso kept, telemetry Log level, windowHours raw, cadenceOf on instants, UiTheme copy, editor save orchestration, LoyaltyCatalog home, icon kebab codes, pipeline error unions, claims-tolerant roles, E164 component brand, stored currency for bills/catalogue, SeatKeyText families, reactive error lines, photo titles in 'bg-BG') — HANDOFF §3.3 'Carried from pass D'; pass-d §8, §9.6. _(Note: pass E deletes `toIso` under the task's spec-only-survivor rule — E-6 — and KEEPS `parseIsoIn` (an e2e calls it); OQ-4's default is otherwise untouched.)_ — **CLOSED: OR-43 (OQ-1–5, 10–13, 15/16, 18), OR-45, OR-46 / DEP-F32, OR-47 / DEP-F33, OR-4, OR-48 / DEP-F34, OR-49, OR-5 / DEP-F4 — pass-d §8.**
20. Web report's sink (an ErrorHandler forwarding DATA_LOG_ERROR to telemetry) — HANDOFF §3.3 'Carried from the edge hardening' (OQ-6); edge-hardening §7. — **CLOSED: OR-34 / DEP-F25.**
21. Worded 'N visits could not be shown' on the staff day — HANDOFF §3.3 edge hardening (OQ-7). — **CLOSED: OR-2 / DEP-F2.**
22. REPOSITORY_MALFORMED's words shared with every REPOSITORY_* code (read oddly for a read) — HANDOFF §3.3 edge hardening (OQ-4). — **CLOSED: OR-54 / DEP-F38.**
23. A separate REPOSITORY_DOCUMENT_MALFORMED read code — HANDOFF §3.3 edge hardening (OQ-5). — **CLOSED: OR-43 (reuse `REPOSITORY_MALFORMED`).**
24. Guarded-by-default adapters (vs unguarded default, DEP-11) — HANDOFF §3.3 edge hardening (OQ-3). — **CLOSED: OR-33 / DEP-F24.**
25. Flip-4 OQ-11 / HANDOFF §6: confirm the production default location id and that its document holds a valid timeZone before the flip-4 web deploys — HANDOFF §6; flip-4 §10 Q11. — **CLOSED: OR-35 / DEP-F26.**
26. Flip-4 OQs 1, 3–6, 8–10 (event location fallback, read-side validation, legacy libs, seed programs, clock/id bundles, event formatter, start form, positions locationIds wipe-on-edit) — flip-4-programs.md §10. — **CLOSED: OR-37 / OR-38 (Q1), OR-39 (Q3), OR-40 (Q4, Q6, Q8, Q9), OR-41 / DEP-F29 (Q5), OR-42 / DEP-F30 (Q10) — flip-4 §10.**

### 7.2 New for the owner, found by this plan (REPORTED, not done)

> **After the owner rulings (2026-10-26):** the record did not rule N-1,
> N-2 or N-5; the owner approved the chief architect's answers later the
> same day and they are BUILT — N-5 as OR-57 (every reopen refused while a
> live visit holds the chair; `isReinstatement` / `takenSince` became
> `mayEndLive` / `seatTakenSince`), N-2 as OR-58 (`coupons` written by no
> client), N-1 as OR-59 (optional, its absence a contract value). N-3 and
> N-4 record changes this pass made (each reverted by one edit, as below);
> no ruling touches them.

- **N-1 — `subjectCustomerId` required on `VisitRowOptions` /
  `VisitCardOptions`: NOT every producer has it.** The client's appointments
  page (`client-appointments.ts:457-466`) passes `subjectUserId: owner` and
  NO `subjectCustomerId`, relying on the ABSENT path of
  `VisitStorySystem.subjectRecordOf` (`visit-story.system.ts:557-574`:
  `undefined` → read off the account seat; `null` → no record). Making the
  field required would force that producer to pick `null` (a behaviour
  change: its story would lose the seat's record) or resolve the record
  first (a new read). Per the triage's rule ("if any producer lacks it,
  report that instead"), left as is. Options for the owner: keep optional;
  or make it `CustomerId | null | 'FROM_SEAT'`-style explicit (a contract
  change).
- **N-2 — `coupons` write grant (`isAdmin`) has no client writer, but a
  dated rules case pins an admin's save** (`firestore.rules.integration.spec.ts:1850-1922`,
  "coupons — an admin's save keeps what the coupon is given for
  (2026-09-29)"). The triage flagged it as outside HANDOFF's named list;
  pass E keeps it. Deny it (and drop that block) only on the owner's word.
- **N-3 — the `purgeAt` single-field index exemption.** Runbook §2.4 said
  it "is the owner's call, not a step of this runbook"; the pass E task
  names it as a DO, so E-3 declares it. Recorded for the owner's
  awareness; reverting is one JSON line per group.
- **N-4 — E-13 / DEP-4 was handed to the owner by pass D.**
  `pass-d-brands-shapes.md` §9.6 kept `familyOfMedal`'s by-string lookup
  and called "making the archive tile carry its family id … a behaviour
  change for the owner". Pass E makes that change (`MedalVm.familyId`, a
  season's own medal draws no family) because this pass's task names the
  by-string lookup as a correctness defect to fix as a DEP. Recorded so the
  owner sees it as N-3 is seen; reverting means dropping `familyId` and
  restoring the string match in `familyOfMedal`.
- **N-5 — a `NO_SHOW` or `COMPLETED` reopen checks no collision.**
  `AppointmentLifecycleSystem.isReinstatement`
  (`appointment-lifecycle.system.ts:1064-1072`) gates the #7 collision
  query (`transition-appointment.pipeline.ts` `readCollisions`) on a PARTY
  reopen of a `CANCELLED` visit only. A `NO_SHOW → CONFIRMED` or a same-day
  `COMPLETED → CONFIRMED` reopen — whose chair the busy projection freed
  once the trigger ran — is admitted without looking at appointments booked
  into that chair since, so it can double-book (a seat-level reopen of a
  cancelled party is not checked either). Found while verifying E-14;
  pre-existing, NOT fixed here: widening the check changes which shop
  corrections are refused (a behaviour and UX call — refuse, or allow the
  shop to knowingly overlap). DEP-5 (if outcome (b)) only restores the
  busy blocks; it does not refuse anything new.

### 7.3 PARKED (from the triage; nothing to do)

> **TRIAGED 2026-10-26 — owner ruling OR-28 (DEP-F22).** Wired: the grant
> verbs (OR-13), the read receipt (OR-19), `readCustomers` (OR-26),
> `loadCouponGrant` reshaped to `loadCouponGrants` (OR-13). Deleted:
> `VoucherSystem.issue` / `redeem` (OR-14), `CouponGrantSystem.expire` /
> `revoke` / `termsOf` (OR-13), `loadWaitlistRequest` (port, functions
> adapter and double) and `EngagementErrorCode.BadgeCategoryOrderNegative`.
> Kept, no action: every other item below — except the last clause of the
> «Запази» item, which OR-33 (DEP-F24) reverses: the integration specs and
> the seed read through the real guard.

- `ZonedTimeSystem.parseIsoIn` — KEPT (e2e support calls it).
- `GridLayoutSystem.closedRuns` on `MinuteRun` (no host feeds past-midnight ends).
- `ShopDayFrame` stays in `booking-read-set.pipeline.ts` (deliberate).
- `ecs-migration.md` / `flip-1-booking-core.md` describing #22's earlier shape (historical records).
- Flip-1 parked ports and grant verbs; `NotificationSystem` read stamp; `VoucherSystem.issue` (owner features).
- `EngagementErrorCode.BadgeCategoryOrderNegative`; `CancellationAttribution.Shop`, `StreakTrackMarkKind.Kept/Repaired/Missed`.
- matchMedia and ResizeObserver test polyfills (live consumers).
- The stylelint override for `libs/ui/**` and `libs/features/**` (a DS styling pass; taste risk).
- Showcase Playwright snapshots refresh (only if a run fails, after viewing).
- The visit row's DS-input-valued tile tone and amount emphasis unions.
- `TRANSIENT_CODES` / `RETRYABLE_CODES` spelled through `HttpsStatus` (optional; never widened).
- `setLegClient` keeping `DraftPersonKey.of`.
- Spec titles naming retired names.
- The sheet «Запази» offline limit; the functions emulator not redelivering a transient rethrow (`settle.mjs` will now list up to seven retrying names); integration specs and seed building adapters unguarded.
- `SiteFooterComponent` dev-mode assertion on `/careers`, `/courses`, `/events`; a stored `ui-lang = 'en'` not restored (pre-existing; re-check against `index.html:24`'s pre-paint script before any work).
- R-1 (E-1): the capacity sweep's per-barber failure handling.
- `libs/ui/patterns/src/lib/metric/metric.ts:271` per-call `Intl.NumberFormat` (a DS component, outside E-12's wording-helper scope).

### 7.4 ALREADY-DONE (from the triage; verified, nothing to do)

- `actFromSheet`'s dismissal set = `BookingLifecycle.didNotHappen` (`staff-dashboard.ts:4452` → `StaffVerb.didNotHappen`, `staff-verb.data.ts:20-23`).
- System-file dictionary family → components (pass D W0-S).
- The team note's record built twice (pass D `noteRecord`).
- Dedicated duplicate-voucher-code error (pass D DEP-18).
- The booking flow's terminal rule spelled once (pass D).
- The editor's `ShopNow` from the store (pass D D-6.2).
- Instant-based visit-vs-now answers (pass D DEP-1…DEP-6).
- Pass C D-11 list (pass D D-10).
- `scheduleExceptions` write grant — kept, live writer.
- Onboarding birthday bare code; `appendTeamNote` offline overwrite.
- Pass B owner flag (a) (CLAUDE.md/AGENTS.md corrections).
- e2e support's shop clock, raw `priceCents`, `toRankable` (pass D).
- Law 10.2 OQ-1/2/3/6/8.
- Agenda row error line; the late-evening ＋ crash (`36bbac98`).
- Flatten-spec / Phase 4b / UI residue OQs, F6, flip-2 §10.15, Analog 2.8.
- Flip-3 `redeemInvitation` and the invitations rules tightening.

---

## 8. Ledger (the integrator fills it)

**Integrated 2026-10-25** — twelve wave-0 packages and E2E (wave 1), then
the integrator. Integrator edits beyond the packages (each forced or
reported by a package; none changes a DEPARTURE's text — DEP-9 was
declared from E2E's reserved slot, and DEP-5's read set narrowed by the
fixer after review, both in §5):

- **Nx sync** (reported by I18N, UI, INTL, SURVIVORS): the stale
  `infrastructure/i18n` project reference removed from the `tsconfig.lib.json`
  of `admin-programs`, `marketing-careers` and `marketing-courses` (their
  import went with E-17); `nx sync:check` clean.
- **Root `eslint.config.mjs`** (UI, blocking for E-5): re-exports
  `UI_RAW_PRIMITIVE_RESTRICTIONS`, exports `PRODUCTION_TS_IGNORES`, and the
  comment above `uiRawPrimitiveBlock` says icons restates the guard —
  `libs/ui/icons/eslint.config.mjs` reaches them through `#eslint-config`
  (three `../` to `tools/lint-rules` are banned, Law 8.3).
- **`offsetIso`** (RULES flagged the conflict): CORE's test helper `wallIso`
  is renamed `offsetIso` in its six files — `wallIso` is a retired wire word
  in runbook §4.7's `WIRE4A`, whose scope includes `libs/ecs-core/src`;
  renaming keeps the gate whole (no exclusion, no word dropped).
- **DEP-9** (E2E, code outside `apps/web/e2e/**`): applied in
  `staff-visit-editor.ts` with the new unit case in
  `staff-visit-editor.spec.ts` (proved red without the fix, green with it).
- **`AppointmentLifecycleSystem.endsLive(before, after)`** (REOPEN's optional
  tidy): the reopen's end-live predicate moved from the pipeline into the
  system beside its twin `endsCancelled` (pass C: pipelines decide nothing);
  +1 spec case and the purity run's entry. Same predicate, no behaviour
  change.
- **The showcase month-picker page** (UI: `nx build showcase` red since pass
  D, `4ae873a0`, raw strings into `LocalDate` inputs): `october(day)` brands
  the page's days through `LocalDate.fromEpochDay` as the menu page does;
  `[uiMin]="min"`. Renders the same; the showcase builds again.
- **One restated case** (SURVIVORS' optional): `booking-cart.system.spec.ts`
  'keeps out what is taken — unpadded with no turnaround, touching starts and
  ends allowed', the deleted feature case one to one (+1).
- **Doc-only:** `observe.ts`' header and `firestore-tx.adapter.ts`' JSDoc
  name `appointmentNotes` among the guarded collections (GUARD);
  `visit-list-words.ts`' precedent comment (I18N); runbook §1.1 —
  `appointmentNotes` writers (`updateAppointmentNote`, TTL), `barberBusy`
  readers/writers and `scheduleExceptions` readers (the transition, REOPEN),
  the programs row's rules note; §4.4's flip-4 rules check rewritten to count
  the shape-checked create/update and the refused delete (RULES — the gate
  keeps its 17 `ok`); §4.4's status note on the words table (I18N).

### 8.1 Per package

| Package   | Files changed                                                                                                                                                                                                                                                                                                                                                                            | Specs added / changed / deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Gate                                                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RETRY     | `apps/functions/src/main.ts`, `main.spec.ts`, `wire/triggers.wire.ts` (comment)                                                                                                                                                                                                                                                                                                          | +4 `RETRIED` rows (transient rethrown, decisive logged once and dropped, per trigger); ENDPOINTS × 4 `false` → `true` (DEP-1); **forced, not listed in §4:** the case 'fails a non-retrying trigger on a store failure …' moved from `rebuildCapacityOnRosterChange` (retrying since E-1) to `sweepCapacityDaily`, which keeps the non-retrying half of its intent                                                                                                                                                                                                                                                | functions test, typecheck, lint green                                                                                                                                                                                     | DEP-1. R-1 frozen (see §8.6): for the Location / Settings triggers the retry covers the sweep's zone, policy and roster-list reads, not one barber's commit, which is still logged ('capacity sweep failed for barber') and left to the 03:00 `sweepCapacityDaily`. `trigger-attempt.system.ts` untouched (allowlist not widened)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GUARD     | `stored-document.system.ts` (+ spec), `notes-photos.port.ts` (JSDoc), `appointment-notes.adapter.ts` (+ spec), `app.config.ts`                                                                                                                                                                                                                                                           | `stored-document.system.spec.ts` +7 (purity, per-field refusals, same object); **changed on purpose (DEP-2):** 'answers a guard for the four collections, null for every other' (was 'three') — `AppointmentNotes` moved from the null list to `toBe(StoredDocumentSystem.appointmentNote)`, `AppointmentPhotos` and `'appointmentNotes/x/sub'` added to the null list; every other case unchanged. `appointment-notes.adapter.spec.ts` +7 (observe emits the refusal and stays; update calls no `decide`, writes nothing, answers `REPOSITORY_MALFORMED`; unguarded unchanged; a re-run reading a repaired note) | ecs-core, firestore, web tests + typechecks green                                                                                                                                                                         | DEP-2. `append-team-note.pipeline.spec.ts` unchanged: no case pins the port's failure set, 'refuses offline' already shows any `Result.err` passes through, and the pipeline's JSDoc point 4 covers it. **Behaviour note:** when the store re-runs a transaction and the re-run reads a repaired note, the call succeeds, but the first attempt's refusal was already reported once through the guard's log; a refused attempt still commits its empty write set, so the SDK's read-version check applies as before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| TTL       | `firestore.indexes.json` (seven `purgeAt` overrides, `ttl: true`, `indexes: []`), `firestore-runbook.md` (§1.1 `appointmentNotes`, §2.2–§2.4, §3 step 3)                                                                                                                                                                                                                                 | none (config)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | offline firebase-tools `validateSpec` + JSON parse + prettier; layering                                                                                                                                                   | DEP-3. Closes pass B owner flag (d) and flip-1 §10 Q5. **Not provable offline:** that Firestore accepts `ttlConfig` and `indexConfig` in the one unmasked PATCH firebase-tools sends (`api.js` `patchField`, the CLI's documented `ttl` path) — the first real `firestore:indexes` deploy, then §2.3's ACTIVE gate, is the proof; the NEEDS_REPAIR remedy (`--disable-ttl` then `--enable-ttl`) is gcloud's flags, not run. `git grep -n purgeAt` re-proved: no query filters or orders on it. N-3 for the owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| WAITLIST  | `waitlist-call.data.ts`, `waitlist.system.ts` (+ spec), `request-waitlist.pipeline.ts` (+ spec), `waitlist.wire.ts` (+ spec)                                                                                                                                                                                                                                                             | +34 unit cases (ecs-core +33: `waitlist.system.spec` +23, `request-waitlist.pipeline.spec` +10; functions +1: `waitlist.wire.spec`); none deleted; changed on purpose: two `waitlist.wire.spec.ts` expectations hold the raw decoded cart (no line `seatKey`)                                                                                                                                                                                                                                                                                                                                                     | ecs-core, functions tests, typechecks, lints green                                                                                                                                                                        | Frozen (no DEP). `cartAsSent` puts the seat's key on every line — exactly what the wire's `cartOf` did — so on the only production path the stored body, the refusals and their order and the request id are unchanged; a hand-built malformed typed cart whose line `seatKey` differs from its seat's (no producer in the repo; `BookingCart`'s own guard requires them equal) now stores the seat's key (pinned: 'names every line by its seat's key — the line's own key is not read'). `decide` calls `cartAsSent` a second time for the body, as E-4 specifies (one small allocation per accepted request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CORE      | `achievements.system.ts` (+ spec), `zoned-time.system.ts` (+ spec), `test-support.ts` (+ spec), `program-content.pipeline.spec.ts`, `policy-recompute-job.system.spec.ts`, `e2e-appointment-seed.spec.ts`, `birth-date.data.ts` (+ spec), `accounts.error.ts` (+ spec), `avatar-refusal.ts`, `profile.store.ts`, `client-profile.ts`, `onboarding-flow.store.ts`, `client-onboarding.ts` | `zoned-time` −7 (118 → 111 runs); `test-support` +7 (34 → 41, the helper's cases); `achievements` −6 (50 → 44, the `firstStart` block); `birth-date` +4 (14 → 18); `accounts` +1 (5 → 6)                                                                                                                                                                                                                                                                                                                                                                                                                          | ecs-core test + coverage, touched projects' tests and typechecks, layering green (every gate with `NX_DAEMON=false` — the daemon's vitest plugin worker crashed twice under the parallel packages)                        | Frozen. `toIso`, `isoAt` and `firstStart` deleted; `parseIsoIn` kept (e2e). The helper landed as `offsetIso` (integrator rename, above). §6.2's `firstStart(` gate corrected: `availability.system.ts:227/:668` hold an unrelated local `firstStart(gapStart, notBefore, step)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| REOPEN    | `transition-appointment.pipeline.ts` (+ spec)                                                                                                                                                                                                                                                                                                                                            | +9 (3 window proofs, 3 per-edge `WriteOp[]` plan cases, merge-onto-read-body, zoneless shop, live-move-unchanged), then +3 by the fixer (a non-reopening move from each settled status reads no busy day); 0 changed, 0 deleted                                                                                                                                                                                                                                                                                                                                                                                   | ecs-core test, typecheck, lint, layering green                                                                                                                                                                            | **Outcome (b), REAL — DEP-5 applies.** Integrator: the end-live predicate is `AppointmentLifecycleSystem.endsLive` (+1 system case). **Read set (narrowed by the fixer after review):** only a move from a non-live root TO a live status (a party or a seat reopen) reads that visit's busy days and exceptions inside the transaction — a reopen the system then refuses (a settled reopen on another day) included, and a malformed busy day there refuses it with `REPOSITORY_MALFORMED` (the edge-hardening D-3 guard `bookAppointment` already had); every other move (`COMPLETED → NO_SHOW`, a live-before move) reads exactly what it read on `6d64f69f` and keeps its own answer (pinned, +3 cases). **Frozen on purpose:** a `NO_SHOW` reopen at a shop whose zone cannot be read still lands and writes NO busy day (a busy day's `utcEpochMs` is the zone's first instant, Law 7.2; `rebuildBusy` cannot stamp one either); the settled two are already refused without a shop clock. N-5 unchanged                                                                                                      |
| RULES     | `firestore.rules`, `firestore.rules.integration.spec.ts`, `catalog.adapter.integration.spec.ts` (title only)                                                                                                                                                                                                                                                                             | +48 emulator runs; changed on purpose: the content_manager programs write case (DEP-7, title kept), the `settings` describe renamed (DEP-6, its two cases byte-unchanged), the catalog spec's `:140` title (DEP-6); deleted none; `programs.adapter.integration.spec.ts` unchanged                                                                                                                                                                                                                                                                                                                                | firestore typecheck, lint; `test:emulator` 65 + 301 green (integrator, §8.5)                                                                                                                                              | DEP-6, DEP-7. `coupons` (`isAdmin`) untouched — pinned by the dated 2026-09-29 rules case (N-2); after E-16 `isCatalogManager()` is used only by the programs blocks. Runbook §4.4's rules count rewritten by the integrator (it counted the removed `allow write` line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I18N      | `bg.json`, `en.json`, `program-status-words.ts` (deleted), `i18n/src/index.ts`, `word-pipeline-error.spec.ts`, the three programs features (`.ts`, `.html`, spec)                                                                                                                                                                                                                        | +2 `word-pipeline-error.spec.ts` (the E-18 table, the DST end-to-end chain); `admin-programs.spec` +2, `marketing-careers.spec` +1, `marketing-courses.spec` +1 (status words through the real catalogue)                                                                                                                                                                                                                                                                                                                                                                                                         | i18n, the three features' tests, typechecks, lints; `catalogue-parity.spec.ts` green                                                                                                                                      | DEP-8: 19 codes worded (§8.2). Two departures from the plan, kept by the integrator for the owner's review: **IDENTITY_CLAIMS_PROMOTION_FAILURE is worded** though `S.Internal` — `edge.ts` `toHttpsError` sends `new HttpsError('internal', code, details)`, the callable client hands `error.details` to `PipelineError.fromWire` and `wordFlowFailure` translates `serverErrorCode` with the raw code as its fallback, so the onboarding printed the raw code (the identity flows' other internal codes are worded for the same reason; revert = drop the key from both catalogues and its `E18_WORDS` row); **voice by neighbour** — the `BOOKING_*` words are informal like the `BOOKING_TRANSITION_*` / `BOOKING_STAFF_EDIT_*` lines (mostly their exact sentences), the two `IDENTITY_*` words formal «вие» / "please …" like every `IDENTITY_*` and `ACCOUNTS_*` line (switchable to «ти»). Not done (optional): `translate-coded-error.spec.ts`' `AUTH_FLOW_ERROR_CODES` (a historical successor list) does not list the two newly worded identity codes — they are pinned in `word-pipeline-error.spec.ts` |
| CARD      | `achievements.presenter.ts` (+ spec), `client-pages.vm.ts`, `medal-detail.presenter.ts` (+ spec), `medals.presenter.spec.ts`, `visits-page.presenter.spec.ts`, `src/testing/client-pages.vm-fixtures.ts`                                                                                                                                                                                 | +1 achievements (the season-id-equals-family-id case, DEP-4), +1 medals; `MedalVm` literals gain `familyId`; `visits-page.presenter.spec.ts` 'strikes an hour that did not happen' expects the two lines (red fixed — `c1db6611`, `visit-row.presenter.spec.ts:344-347`)                                                                                                                                                                                                                                                                                                                                          | staff-client-card test (alone), typecheck, lint green                                                                                                                                                                     | DEP-4 — pass D §9.6 handed it to the owner; pass E does it because its task names it (N-4; revert = drop `MedalVm.familyId`, restore the string match). `newestFaceLevel` compares `familyId` instead of `seriesId` (inside the file, outside E-13's list, no behaviour change: the lead tile is always a family tile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UI        | `section-header.spec.ts`, `gauge.spec.ts`, `visit-pills.spec.ts`, `visit-row.presenter.spec.ts`, `month-picker.ts`, `libs/ui/icons/eslint.config.mjs`, `tools/lint-rules/index.mjs` (export), `ecs-core-base-paths.spec.mjs`, `swipe-to-delete.directive.ts`, `staff-dashboard.spec.ts`, showcase `phone-field.page.{css,html}`, `demo.ts`                                               | no case added or deleted; changed: `section-header.spec.ts` helper (reverse scan, the typecheck red), `gauge.spec.ts` × 4 and `visit-pills.spec.ts` (whitespace — the reds), `visit-row.presenter.spec.ts` fixture parameter, `staff-dashboard.spec.ts` `HeldGrant` import; `ecs-core-base-paths.spec.mjs` +4 runs (icons under both bases)                                                                                                                                                                                                                                                                       | patterns typecheck GREEN, patterns / shared-visits / controls / staff-dashboard tests, `lint-rules:test` (with the integrator's root edit), lints; `nx build showcase` green after the integrator's month-picker page fix | Frozen. **E-19 citations:** the gauge × 4 and visit-pills reds were born red in their own commits (`98adfb3f`, `c1db6611`, both 2026-10-07; the CSS has no later commit) — the specs pinned prettier's wrapped `max( … )` / `calc( … )` while the stylesheets hold the one-line form, and the gauge template's line breaks put a leading whitespace text node in `.ui-gauge__node`; the spec side was wrong each time, expectations unchanged. **Lint widening:** E-5 also puts L7 (no cast to `UserId`/`CustomerId`) on icons specs and test setup, as everywhere else; 0 hits. Raw-brand hits on icons production code: 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| INTL      | `wall-clock.ts` (+ spec), `catalog.presenter.ts`, `catalog-wording.service.ts`, `admin-rhythm.words.ts` (+ spec), `client-card.format.ts` (+ spec)                                                                                                                                                                                                                                       | +7 `wall-clock.spec`, +1 `admin-rhythm.words.spec`, +2 `client-card.format.spec` (bg/en pins written before the move)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the four projects' tests, typechecks, lints; `presenter-purity` clean                                                                                                                                                     | Frozen. `formatDurationRange` deleted from `shared-catalog`'s public API (no importer; a historical table in `law-10-decision-extraction.md:119` still names it). `wall-clock/src/index.ts` needed no edit. Out of E-12's scope, carried: per-call `Intl.ListFormat` at `admin-rhythm.words.ts:1010`, `rhythm-rule.words.ts:151`, `staff-block-editor.ts:952` (`visit-row.presenter.ts:756` keeps its own cache)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SURVIVORS | `day-availability.spec.ts` (deleted), `rhythm-service-groups.spec.ts` (deleted), `admin-rhythm.preview.ts` (+ spec), the fold targets' header comments                                                                                                                                                                                                                                   | 2 specs deleted, 1 block deleted, 0 folds; runs: `client-booking` −28, `admin-loyalty` −3, ecs-core ±0 (+1 by the integrator's one-to-one restatement)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ecs-core, client-booking, admin-loyalty tests, typechecks, lints                                                                                                                                                          | Mapping §8.3. Under load `booking-return-url.spec.ts`' property case timed out once (11.9 s), green on the rerun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| E2E       | `landing.spec.ts`, `client-card-glance.spec.ts`, `support/appointment-seed-document.ts`, `support/seed-firestore.ts`, `support/shop-clock.ts`, the six `*-snapshots/*.png`, NEW `programs.spec.ts`                                                                                                                                                                                       | +1 `programs.spec.ts` run; the glance tests now at `:364` (barber) and `:707` (birthday)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | e2e:web 61 passed, 0 failed (integrator, §8.5)                                                                                                                                                                            | DEP-9 (applied by the integrator). §8.4 per red and per screenshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 8.2 E-18 words (for the owner's copy review)

> **Reviewed 2026-10-26 — owner rulings OR-50 (DEP-F35), OR-51, OR-52
> (DEP-F36), OR-54 (DEP-F38).** The clumsy lines are edited before they
> ship (the four `*_INVALID_INPUT` keys deleted — the surface's generic line
> answers —, one FORBIDDEN line, the SLOT_TAKEN and reopen-window lines
> reworded), every line moves to the one «ти» voice, both rhythm refusals
> get words, and each `REPOSITORY_*` code is worded for what it means. The
> table below is the words as pass E shipped them.

Path (2): a callable refusal the edge answers, worded by `wordPipelineError`
(before: the surface's generic copy — the appointments page's cancel and the
staff day's callables print `BOOKING_CALL_FAILED`); the two `IDENTITY_*` rows
reach the onboarding registration's `wordFlowFailure`, which printed the RAW
code before.

| Code                                      | Path                                                                        | bg                                                               | en                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `BOOKING_CANCEL_NOT_CANCELLABLE`          | (2) cancel                                                                  | Този час вече не може да се откаже.                              | This appointment can no longer be cancelled.                               |
| `BOOKING_CANCEL_UNAUTHENTICATED`          | (2) cancel                                                                  | Влез отново, за да продължиш.                                    | Sign in again to continue.                                                 |
| `BOOKING_CANCEL_INVALID_INPUT`            | (2) cancel                                                                  | Заявката не е валидна.                                           | That request is not valid.                                                 |
| `BOOKING_CANCEL_NOT_FOUND`                | (2) cancel                                                                  | Този час вече не съществува.                                     | That appointment no longer exists.                                         |
| `BOOKING_STAFF_EDIT_UNAUTHENTICATED`      | (2) staff day                                                               | Влез отново, за да продължиш.                                    | Sign in again to continue.                                                 |
| `BOOKING_COMMIT_FORBIDDEN`                | (2) staff day                                                               | Само служители могат да правят това.                             | Only staff can do that.                                                    |
| `BOOKING_TRANSITION_REOPEN_WINDOW_CLOSED` | (2) staff day                                                               | Приключен час може да се отвори отново само в същия ден.         | A settled appointment can only be reopened on its own day.                 |
| `BOOKING_TRANSITION_SLOT_TAKEN`           | (2) staff day                                                               | Този час междувременно е зает, затова не може да се възстанови.  | That time was taken in the meantime, so the appointment can't be restored. |
| `BOOKING_ARRIVED_UNAUTHENTICATED`         | (2) staff day                                                               | Влез отново, за да продължиш.                                    | Sign in again to continue.                                                 |
| `BOOKING_ARRIVED_FORBIDDEN`               | (2) staff day                                                               | Само служители могат да правят това.                             | Only staff can do that.                                                    |
| `BOOKING_ARRIVED_INVALID_INPUT`           | (2) staff day                                                               | Заявката не е валидна.                                           | That request is not valid.                                                 |
| `BOOKING_ARRIVED_NOT_FOUND`               | (2) staff day                                                               | Този час вече не съществува.                                     | That appointment no longer exists.                                         |
| `BOOKING_ARRIVED_NOT_ALLOWED`             | (2) staff day                                                               | Пристигането на приключен час не може да се променя.             | A settled appointment's arrival can't be changed.                          |
| `BOOKING_TIP_UNAUTHENTICATED`             | (2) staff day                                                               | Влез отново, за да продължиш.                                    | Sign in again to continue.                                                 |
| `BOOKING_TIP_FORBIDDEN`                   | (2) staff day                                                               | Само служители могат да правят това.                             | Only staff can do that.                                                    |
| `BOOKING_TIP_INVALID_INPUT`               | (2) staff day                                                               | Заявката не е валидна.                                           | That request is not valid.                                                 |
| `BOOKING_TIP_NOT_FOUND`                   | (2) staff day                                                               | Този час или това място вече не съществува.                      | That appointment or seat no longer exists.                                 |
| `IDENTITY_CLAIMS_PROMOTION_FAILURE`       | (2)/(1) onboarding — `S.Internal` but sent with its details (see §8.1 I18N) | Не успяхме да завършим регистрацията ви — моля, опитайте отново. | We couldn't finish your registration — please try again.                   |
| `IDENTITY_REGISTRATION_USER_NOT_FOUND`    | (2) onboarding                                                              | Не открихме профила ви — моля, влезте отново.                    | We couldn't find your profile — please sign in again.                      |

Not reachable (no words), with reason: server-internal and programmer-defect
codes and every other `S.Internal` row of `edge.ts` (the web receives a bare
`INTERNAL` and its surface's generic copy); `IDENTITY_OTP_ACCOUNT_CONFLICT`
(mapped to `TOKEN_MINTING` at the wire); the scan's context values (`WIDTH`,
`HEIGHT`, `LAT`, `LNG`, `UNPARSABLE`, `OUT_OF_RANGE` — not codes);
`LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE` and
`LOYALTY_STREAK_PUBLISH_PREVIEW_STALE` (answered refusals the admin rhythm
page deliberately words as nothing — `admin-rhythm.ts` `wordRefusal`/`told`
answer `null`; wording them is a product call, recorded for the owner). No
existing string changed (24 keys added per catalogue: the 19 codes and the
five `programs.status.*` words of E-17).

### 8.3 SURVIVORS mapping

| Deleted case                                                                                                                                                                | Successor (file:line) or folded                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `day-availability.spec.ts` 'offers every step of a rostered barber's free day, from the day's first minute'                                                                 | `booking-cart.system.spec.ts:2211` (same title)                                                                                                                                        |
| … 'floors today at now plus the lead time — never a start that is already too soon'                                                                                         | `booking-cart.system.spec.ts:2319` 'floors today at now plus the lead time'                                                                                                            |
| … 'keeps out what is taken'                                                                                                                                                 | `booking-cart.system.spec.ts:2232` (restated one to one by the integrator; also covered by `:2218` with `capacity.system.spec.ts:132`)                                                 |
| … 'pads what is taken by the barber's turnaround — the one rule the commit checks'                                                                                          | `booking-cart.system.spec.ts:2218` 'keeps out what is taken, padded by the turnaround'                                                                                                 |
| … 'hands a moved visit's own chairs back before anything is placed', 'hands back nothing a chair of another day holds'                                                      | `booking-cart.system.spec.ts:2243` 'hands a moved visit's own chairs back on its own day only'                                                                                         |
| … 'offers nothing on a day the exception closes, and nothing without a roster'; 'clamps every segment to its shop's hours, and offers nothing at a shop that is not listed' | `booking-cart.system.spec.ts:2258` 'offers nothing on a day the exception closes, without a roster, or at no listed shop'; `capacity.system.spec.ts:141` (clamped to the shop's hours) |
| … 'offers a MOVE its own shop, listed or not — still clamped to that shop's hours'                                                                                          | `booking-cart.system.spec.ts:2279` and `:2291` (the unlisted named shop; the listed shop replaced by the move's copy)                                                                  |
| … 'names each option's own shop under "any shop", and narrows to the chosen one'; 'builds each barber's day only from a roster at an offered shop'                          | `booking-cart.system.spec.ts:2302` 'narrows to the chosen shop — a barber with no window there is not on the day'; the located-option property `:1640`                                 |
| … 'runs no shop that does not offer the service'                                                                                                                            | `booking-cart.system.spec.ts:1011` describe `optionsForDay` (`:1071` the shop that does not offer the service) and `shopsServingParty` `:515`–`:550`                                   |
| … `releaseOn` × 3                                                                                                                                                           | `move.system.spec.ts:1177` describe 'MoveSystem.releaseOn' (the same three titles)                                                                                                     |
| … `sameDayDocsKey` × 6 runs (two equal keys, every field apart (`it.each`), a pool in either order, a shop read only for a move, `null` only to `null`)                     | `booking-cart.system.spec.ts:2139` describe `dayDocsKey / sameDayDocsKey` (`:2147`, `:2168`, `:2202`)                                                                                  |
| … `observeDayDocs` × 3                                                                                                                                                      | `shop-day.pipeline.spec.ts:79`, `:93`, `:104` (same titles)                                                                                                                            |
| … 'sums the free minutes of the barbers asked about, at the one shop asked about'                                                                                           | `capacity.system.spec.ts:450` (same title)                                                                                                                                             |
| … 'reads each month of the run once'                                                                                                                                        | `lead-time.system.spec.ts:132` (`LeadTimeSystem.monthKeysBetween`)                                                                                                                     |
| … 'collects the months' entries, a month never rebuilt holding none'                                                                                                        | `shop-day.pipeline.spec.ts:139` (same title)                                                                                                                                           |
| `rhythm-service-groups.spec.ts` 'groups services under their category, both sorted by sortOrder'                                                                            | `catalog.system.spec.ts:67` describe `CatalogSystem.byCategory` (its first case, same fixture data)                                                                                    |
| `admin-rhythm.preview.spec.ts` describe `rhythmPreviewReadsFacts` × 2 (+ the run the block's purity added)                                                                  | `streak-preview.system.spec.ts:667` describe `StreakPreviewSystem.readsFacts` (the same two titles) and its purity run `:906`                                                          |

### 8.4 E2E — per red, per screenshot

| Red / snapshot                                                                                          | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Side fixed                                                                                                                                              | Citation                                                                                                                                     | Images read                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landing.spec.ts:121` MapLibre lazy load                                                                | the test identified a MapLibre download by a URL matching `/maplibre-gl/i`; since the dev server stopped prebundling `maplibre-gl` (`apps/web/project.json` `prebundle.exclude`, for the loader's `loader: 'text'` stylesheet), the library and its CSS ship in hashed lazy chunks no URL names, so the "> 0 after scroll" poll never saw one. The lazy load itself is intact                                                                                                                                                         | **test** — a download is known by what it carries (a script/stylesheet body naming `maplibre-gl/dist/maplibre-gl.{js,css}`), a package URL still counts | `c1db6611` (2026-10-07)                                                                                                                      | —                                                                                                                                                                                                               |
| `client-card-glance.spec.ts` barber test (`:336` → `:364`) × 6, failing at `:377` (`client-quick-same`) | the seeded last visit was the same beard trim today's visit holds; «Повтори» is offered only while the visit on screen does not already hold the last visit's services (`ClientGlanceSystem.repeatOffer` / `sameLegs`, revision 3) — the journey failed at the disc from the day it was written. Two more seed faults surfaced behind it: a fixed 21:00 "today" visit had started whenever the suite ran after nine in the evening, and the photo seeded on the featured last visit rides its card as thumbs, never the «Снимки» grid | **test** (seed) — the last visit a classic cut (`DEV_CLASSIC_CUT`), today's start `stillAheadToday()`, the photo on the older visit                     | `c1db6611` (revision 3 §3 rows H1 / I1)                                                                                                      | —                                                                                                                                                                                                               |
| `client-card-glance.spec.ts` birthday test (`:679` → `:707`) × 6, failing at `:758` → `:786`            | `StaffVisitEditor.removeReward` refocused the glance's `client-reward-ready` ticket, which is absent when a birthday grant stands as the birthday band's gift; the focus fell to the body                                                                                                                                                                                                                                                                                                                                             | **code** — DEP-9 (`staff-visit-editor.ts`: the list `[data-testid="client-birthday-gift"], <ticket>` for a birthday grant) + a unit case                | born in `c1db6611` (where both `rewardTicket` and the birthday card came in); the editor's own JSDoc says the offered ticket keeps the focus | —                                                                                                                                                                                                               |
| `account-dashboard-populated-{light,dark}`                                                              | the upcoming card's date carries the year outside the current one («сб, 1.06.2030 г. · 10:00», R59) and the status pill's word is ink, no longer the brown `#98471c` (the accent law)                                                                                                                                                                                                                                                                                                                                                 | **baseline regenerated**                                                                                                                                | `c1db6611` (R59, the shared visit card), `98adfb3f` (accent law)                                                                             | old `git show 6d64f69f:apps/web/e2e/account-dashboard-screenshots.spec.ts-snapshots/account-dashboard-populated-light-chromium-darwin.png` (and `-dark`) vs the tree's; read by E2E and again by the integrator |
| `appointments-list-populated-{light,dark}`                                                              | revision 3's row: sentence-case section head (no uppercase eyebrow), lowercase weekday tile in ink, mono fact line, the barber's face trailing                                                                                                                                                                                                                                                                                                                                                                                        | **baseline regenerated**                                                                                                                                | `c1db6611` (revision 3 rows; `lib-staff-event-head` mono fact lines)                                                                         | the same pair, read by E2E and the integrator                                                                                                                                                                   |
| `appointments-calendar-{light,dark}`                                                                    | today an orange bold number (was the brown accent-label), lighter day weights, the month head under the top fade                                                                                                                                                                                                                                                                                                                                                                                                                      | **baseline regenerated**                                                                                                                                | the date-picker style ruling 2026-10-06 / `98adfb3f`, revision 3                                                                             | the same pair, read by E2E and the integrator                                                                                                                                                                   |

**Owner flag — CLOSED 2026-10-26 (owner ruling OR-56): the six baselines are
accepted, which decides `client-card-revision-3.md` §7.7 rule 2; the two
defects they show (an upcoming tile with no month or year, a filter row of
one chip) are fixed, each regenerating its own baselines after both images
are viewed.** The flag as raised: `client-card-revision-3.md` §7.7 rule 2 says the screenshot
baselines are regenerated only after the owner accepts review 2; no record of
that acceptance is in the repo. The six new baselines pin the design as built
in `c1db6611` + `98adfb3f` + R59, which every pass since kept. To revert, restore
the six PNGs from `6d64f69f` (`git show 6d64f69f:<path> > <path>`) — they go red
again.

**Residual (recorded, not fixed):** `stillAheadToday()` caps today's visit
at 23:25 (a 30-minute chair visit must end before midnight), so a glance run
started after about 23:15 shop time cannot seed an hour still to come today
and the barber test fails at `history-upcoming` (before the fix the window
was 21:00–24:00); pinning the page clock or seeding tomorrow's agenda changes
what the journey proves. `apps/web/e2e/**` is typechecked by no Nx target
(`web:typecheck` covers `src`); a `web:typecheck-e2e` target is a follow-up.

### 8.5 Gate record (HANDOFF §4, one command at a time)

The integrator's FULL gate on the integrated tree (2026-10-25), one command
at a time, after the open issues above were resolved:

1. `pnpm nx sync:check` — up to date (after the three stale i18n
   references went).
2. `pnpm nx run verify-tools:layering --skip-nx-cache` — OK, **900 files
   and 4,006 import edges** (4,001 before: the new imports of the reopen,
   the guard and the waitlist door), 2,487 files scanned.
3. `rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache`
   — **39 projects, all green** (`patterns` no longer red).
4. `pnpm nx run-many -t lint` — 43 projects, **0 errors**, 236 warnings (a
   per-project count, re-run with `--skip-nx-cache`: the same; the edge
   hardening recorded 239 — a per-file comparison against `6d64f69f` found no
   modified or deleted file whose warnings changed).
5. `pnpm nx run-many -t test --parallel=3 --skip-nx-cache` — 43 targets,
   **12,718 passed, 0 failed** (12,639 vitest + `verify-tools` 79; before:
   12,615 passed + the 6 reds). ecs-core 6,048 → 6,115, functions 955 → 964,
   `lint-rules` 315 → 319, `client-booking` −28, `admin-loyalty` −3 (+1 INTL),
   `staff-dashboard` +1 (DEP-9), the six former reds now passing.
6. `pnpm nx test ecs-core --coverage` — 317 files, 6,115 tests,
   **98.34 % statements** (14,236/14,476; ≥ 98.33 % and ≥ 97.85 % hold),
   99.17 % lines.
7. `pnpm nx typecheck seed-tools` — green.
8. `pnpm nx test lint-rules` — 13 files, **319 tests** (+4: icons under both
   base paths).
9. `pnpm run lint:styles` — green.
10. `pnpm nx build web && pnpm run verify:bundle` — initial **576.13 kB**
    (156.88 kB transfer; +0.04 kB, within ±1 kB); `firebase/firestore`,
    `firebase/storage` and `libphonenumber-js` not in the initial chunk.
    (The `gauge.css` 10 kB component-style budget warning predates the pass —
    `gauge.css` is unchanged.)
11. `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs`
    — the four runtime dependencies, none forbidden.
12. Runbook grep gates under bash (§4.0 preamble, then each section in its
    own shell): §4.2 **28** `ok`, §4.3 **22**, §4.4 **17** (its rules count
    rewritten for E-15, same count), §4.5 **6**, §4.7 **24**, §4.8 **27**,
    §4.9 **25** — 0 FAIL, 0 ERROR, the canary removed. The plan's §6.2 greps
    as corrected: all at their expected counts (`retry: true` 7 → 11, `"ttl":
true` 7, one `gcloud` fallback line, the rest 0).
13. `pnpm run verify:p0` — (a)–(f) pass; no `'malformed document'` line.
14. `pnpm run test:emulator` — **65 + 301**, all green (253 + RULES' 48).
15. `pnpm run e2e:web` — **61 passed, 0 failed, 0 flaky** in 2.8 min (41 + the 19 former baseline failures + the programs journey; the glance's 12 runs at `:364` / `:707` green, the six screenshots green on their new baselines, `landing.spec.ts:128` green); no `'malformed document'` line in any journey's functions log.

Also run: `pnpm nx build showcase` green (red since pass D before the
integrator's month-picker page fix); `staff-visit-editor.spec.ts`' DEP-9
case red with the fix taken out, green with it.

### 8.6 Carried forward (to HANDOFF §3.3)

- **R-1 (RETRY, frozen):** for `rebuildCapacityOnLocationChange` and
  `rebuildCapacityOnSettingsChange` the retry covers the sweep's zone, policy
  and roster-list reads, not one barber's commit — still logged ('capacity
  sweep failed for barber') and healed by the 03:00 `sweepCapacityDaily`;
  surfacing per-barber failures would change `sweepCapacityDaily` too.
- **The glance seed's late window** (E2E): a run after ~23:15 shop time
  fails the barber test (above).
- **No typecheck of `apps/web/e2e/**`** (E2E): a `web:typecheck-e2e` target.
- **Per-call `Intl.ListFormat`** (INTL): three sites (above), a cached
  `formatList` in `@creativo/ui/wall-clock`.
- **`translate-coded-error.spec.ts`' `AUTH_FLOW_ERROR_CODES`** does not list
  the two newly worded identity codes (I18N; optional, they are pinned in
  `word-pipeline-error.spec.ts`).
- **OWNER (§7 — every §7.1 item and the three new ones below RULED
  2026-10-26 by the owner rulings: OR-56 the baselines, OR-51 the identity
  words and voice, OR-52 / DEP-F36 the rhythm refusals; N-1, N-2 and N-5
  ruled and built later the same day as OR-59, OR-58 and OR-57 — HANDOFF
  §6):** every §7.1 item verbatim, and §7.2 N-1…N-5 — among them N-5, a
  `NO_SHOW` / same-day `COMPLETED` reopen that checked no collision against
  appointments booked into the freed chair (DEP-5 only restored the busy
  blocks; since OR-57 every reopen is refused while the chair is taken). New for the owner from this pass: the six baselines' review-2 gate
  (§8.4), the IDENTITY_CLAIMS_PROMOTION_FAILURE words and the identity lines'
  formal voice (§8.1 I18N), and whether `LOYALTY_STREAK_PUBLISH_*`'s two
  refusals should get words (§8.2).
- **PARKED (§7.3 — triaged 2026-10-26 by OR-28 / DEP-F22).**

### 8.7 The review's fixer (five findings, 2026-10-25)

- **DEP-5's read set (two findings, one fix).** The reopen's busy read ran
  for EVERY move of a non-live visit: a refused or non-reviving move paid
  2 × keys extra reads, and a malformed `barberBusy` day turned its own
  answer into `REPOSITORY_MALFORMED` (edge-hardening D-3 — undeclared). The
  read now runs only when `!BookingLifecycle.isLive(appointment) &&
BookingLifecycle.isLive({ bookingStatus: cmd.to })` (a party or a seat
  reopen; no other move can end live — `TRANSITIONS` gives `COMPLETED` and
  `CANCELLED` no outgoing edge and `NO_SHOW` only `CONFIRMED`). DEP-5 (§5)
  and the §8.1 REOPEN note record it, and that the reopen now shares
  `bookAppointment`'s malformed-busy guard. Spec: +3 cases (`COMPLETED →
NO_SHOW`, `CANCELLED → NO_SHOW`, `NO_SHOW → COMPLETED` read no busy day or
  exception) — red with the old read, green with the guard.
- **DEP-9 declared (§5)** with its before/after, specs and origin
  `c1db6611`; §8's top note corrected.
- **`offsetIso` on the one zone engine.** The helper built its own
  `Intl.DateTimeFormat` per call and its own `% 24` — zone math outside
  `zoned-time.system.ts` (ecs-systems.md). It now reads the wall day and
  minute from `ZonedTimeSystem.toLocal`, the second and millisecond from the
  instant (whole-minute offsets since 1972), and the offset as that wall
  clock read as UTC minus the instant. Its 7 restated cases and the
  round-trip property pass unchanged (`test-support.spec.ts`, 41 runs).
- **HANDOFF §2's summary** no longer says "baseline reds only" for `main`
  after pass E; the `fe4635a` sentence names what it still uniquely carries
  (the dev-stack smoke).

The FULL gate re-run after the fixes — recorded in §8.8.

### 8.8 Gate record after the review's fixes (one command at a time)

1. `pnpm nx sync:check` — up to date.
2. `pnpm nx run verify-tools:layering --skip-nx-cache` — OK, 900 files and
   4,006 import edges, 2,487 files scanned (unchanged).
3. `rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache`
   — 39 projects, all green.
4. `pnpm nx run-many -t lint` — 43 projects, 0 errors (the one warning in a
   touched file, `transition-appointment.pipeline.spec.ts:84` `_id`, is on
   `6d64f69f` too).
5. `pnpm nx run-many -t test --parallel=3 --skip-nx-cache` — 43 targets,
   **12,721 passed, 0 failed** (12,642 vitest + `verify-tools` 79; ecs-core
   6,115 → 6,118, the three new DEP-5 read-set cases).
6. `pnpm nx test ecs-core --coverage` — 317 files, 6,118 tests, **98.34 %
   statements** (14,236/14,476), 99.17 % lines. (A first run read 98.33 %,
   14,235: one statement of `client-stats.system.ts:492` is reached only by
   some of a property test's random draws — a run-to-run variance, not this
   fix; ≥ 97.85 % holds either way.)
7. `pnpm nx typecheck seed-tools` — green.
8. `pnpm nx test lint-rules` — 13 files, 319 tests.
9. `pnpm run lint:styles` — green.
10. `pnpm nx build web && pnpm run verify:bundle` — initial **576.13 kB**
    (156.88 kB transfer, unchanged); the three forbidden packages absent from
    the initial chunk (the `gauge.css` budget warning predates the pass).
11. `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs`
    — the four runtime dependencies, none forbidden.
12. Runbook grep gates under bash (§4.0 preamble + each section alone):
    §4.2 28, §4.3 22, §4.4 17, §4.5 6, §4.7 24, §4.8 27, §4.9 25 `ok` — 0
    FAIL, 0 ERROR, the canary removed; no reference count changed.
13. `pnpm run verify:p0` — (a)–(f) pass; no `'malformed document'` line.
14. `pnpm run test:emulator` — **65 + 301**, all green.
15. `pnpm run e2e:web` — **61 passed, 0 failed, 0 flaky** in 2.5 min; no
    `'malformed document'` line.

No red: nothing new, nothing standing.
