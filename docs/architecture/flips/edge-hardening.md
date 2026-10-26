# Edge hardening — read-time guards, trigger retry, the transactional team note

**Date:** 2026-10-25 · **Status:** INTEGRATED 2026-10-25 — the three
packages merged, the FULL gate of HANDOFF §4 green against its baselines
(runbook §4.2–§4.9 PASS, `verify:p0`, `test:emulator` 65 + 253, `e2e:web`
41 + the 19), the offline append observed on the emulator; the
integration record is §8; the review's six findings fixed and the FULL gate
re-run green the same day (§8.6). Written as the PLAN on `main` at
`36bbac9` (pass D integrated; tree clean); revised the same day against 13
review gaps (12 applied, 1 partly rejected — §7 R-1). Line numbers are hints on `36bbac9`; every
package re-reads its sites before it edits. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md` — `ecs-primitives.md`
(Law 7.4: smart constructors, the cast only in the primitive's own file),
`ecs-components.md` (Law 1: guards live on the companion), `ecs-systems.md`
(Law 3: pure, purity spec), `ecs-pipelines.md` (Law 4: the transaction IS the
sandwich), `ecs-ports.md` (Law 9: bundles, no `Pick`/`Omit`),
`ecs-layering.md` (Law 8), `firestore-layout.md` (Law 5: zero mapping),
`angular-ui.md`. This plan never overrides them. ·
**Sources:** the before/after architecture comparison (three edge
regressions, owner: "fix them"); `git show c1db661:` of the pre-migration
adapters (`appointment-repository.adapter.ts`, `client-history-reader.adapter.ts`,
`availability-reader.adapter.ts`); `docs/architecture/firestore-runbook.md`
§1.1 (the reader matrix rows `appointments`, `customers`, `barberBusy`);
`flips/flip-1-booking-core.md` F1-2 (`retry: true` deferred); HANDOFF §3.3
("trigger `retry: true` deferred to their own commits"); the audit
remediation's retry allowlist (memory: `subscribeWithRetry` retries only
`unavailable`/`internal`/`resource-exhausted`/`deadline-exceeded`/`aborted`;
its server twin `TriggerAttemptSystem` `TRANSIENT_CODES`).

**What this is.** Three regressions at the I/O edge the ECS migration left:

1. **Read-time validation.** Before the migration 83 `reconstitute()`
   mappers refused a malformed stored document (`MalformedField`). Today the
   adapters read `{ id, ...snap.data() } as Entity` with no check, so a
   malformed, legacy or hand-edited document enters as a typed entity and
   fails deep inside a system (a `TypeError` in a snapshot callback, a
   `NaN` minute in a collision scan, a write plan built on garbage).
2. **Trigger retry.** The three projection triggers
   (`rebuildBusyOnAppointmentChange`, `rebuildCapacityOnBusyChange`,
   `matchWaitlistOnBusyChange`) run without `retry: true` (flip 1 F1-2), so
   one contended or unavailable backend moment leaves `barberBusy` /
   `capacity` stale or a freed day unannounced until the next write.
3. **The team-note append.** `appendTeamNote` reads the note once off the
   live port (`firstValueFrom`) and writes through `saveAppointmentNote` — a
   read-modify-write outside a transaction that loses a concurrent edit, and
   offline (cached or uncached) can write over the server's copy.

**This pass ends** when the three packages of §3 are integrated, every
existing spec passes unchanged except the edits §4 names as forced, the
FULL gate of HANDOFF §4 is green against its baselines (§6), and the
behaviour changes are exactly the DEPARTURES of §5.

---

## 0. Decisions (read first)

### D-1 — the guard's home and shape

**Layering (Laws 1, 2, 3, 8).** Guards live on the companions, entities hold
no logic, so the composition per stored archetype is a SYSTEM:

| Tier       | What it gets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| primitives | a NON-ALLOCATING `is(raw: unknown): raw is X` door beside each smart constructor the guards need (`LocalDate`, `MinuteOfDay`, `EndMinute`, `UtcEpochMs`, `DurationMinutes`, `MinuteCount`, `PriceCents`, `Currency`, every id via `idCompanion`, `BusyKey`), each EQUIVALENT to its constructor's `ok` over the constructor's own input domain and `false` for every other type (spec-proved, §4.1); `LocalDate.isAt(text, start)` (a day at an offset, no slice); `UtcEpochMs.MAX` (the existing module-private `MAX_UTC_EPOCH_MS`, exported — the history page's numeric bound, D-3); `StoredFields` (`stored-fields.data.ts`: the type of a body as read + `isRecord`; since the review (§8.6) also `isArrayOf`, `isRecordArray`, `isTextOrNull`, `isCount` — the ONE home of the stored-shape checks the companions and the system compose); `Tag.has` rewritten to a non-allocating `for…in` scan (same answers) |
| components | `fieldFault(raw: StoredFields): string \| null` on the companions of the slices a stored archetype is made of — `MinuteRange` (both minutes AND `startMinutes < endMinutes`), `TimeCoordinate` (composes `MinuteRange.fieldFault`), `BookingLifecycle`, `BookingContact`, `StoodSeatPairs`, `ServiceTerms`, `SeatOccupant`, `SeatOutcome`, `Seat` (composes the three seat slices and checks `SeatCore`'s own fields), `MinuteBlock` (composes `MinuteRange.fieldFault`, then `blockKind`): the NAME of the first own field the slice refuses, `null` when every field is well-formed. No check is written twice: a slice with a companion is checked through it (Law 1). No allocation on the happy path                                                                                                                                                                                                             |
| systems    | NEW `stored-document.system.ts` — `StoredDocumentSystem`: `appointment`, `customer`, `busyDay` (`(doc: StoredDocument) => Result<Entity, RepositoryError>`), their zero-allocation `*Fault` halves, the collection registry `guardOf` / `unguarded`, and `salvage` — what a trigger may still read off a REFUSED appointment side (D-3); since the review (§8.6) also `admit` (THE guard dispatch every read site shares, web and functions), `appointmentSide` and `salvageSides` (a trigger's two sides, guarded, and what the refused ones leave)                                                                                                                                                                                                                                                                                                                                                                  |
| errors     | nothing new — see D-2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Shape.** `StoredDocumentSystem.appointment(doc)` runs the field checks in a
fixed order and answers `Result.ok(doc)` — THE SAME OBJECT, typed as the
entity (zero mapping, Law 5: validate, then the entity; no copy, no field
renamed, defaulted or dropped) — or `Result.err(RepositoryError.malformed(
'<collection>/<id>', '<field>'))` naming the first offending field. The only
allocations are the `Result` wrapper per document and, on a refusal only,
the path/field strings (`seats[1].startMinutes`). Every check is a typeof
test, an integer/range test, a `Tag.has` scan or a non-allocating `is` door;
arrays are walked with indexed `for` loops (Law 3 hot-loop rule). Staff-day
listeners read a few dozen documents per snapshot: cost is linear, constant
per field.

**What each guard checks — and why (what systems rely on).** The principle
is the appointment entity's own doc comment: _the seats are the truth; the
query mirrors are recomputed by every write plan, so a corrupt mirror can
change which queries find a visit, never what it says._ The guard checks
what the document SAYS and what systems iterate; it leaves the repairable
mirrors to the backfill that repairs them.

`appointments/{id}` (`StoredDocumentSystem.appointment`):

| Field(s)                                                                                          | Check                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                              | `AppointmentId.is`                                                                                                                                                           | every system keys on it                                                                                                                                                                                                                                                                                                                               |
| `locationId`                                                                                      | `LocationId.is`                                                                                                                                                              | `readShopZone` reads the zone off it (Law 7.2)                                                                                                                                                                                                                                                                                                        |
| `localDate`, `startMinutes`, `endMinutes`, `utcEpochMs`                                           | `TimeCoordinate.fieldFault`: `LocalDate.is`, `MinuteRange.fieldFault` (`MinuteOfDay.is`, `EndMinute.is`, `startMinutes < endMinutes` — reason `endMinutes`), `UtcEpochMs.is` | every collision, packing, grid and index read (Law 7.3)                                                                                                                                                                                                                                                                                               |
| `bookingStatus` + its variant stamp (`pendingAtUtcMs` … `cancelledAtUtcMs`), `cancellationReason` | `BookingLifecycle.fieldFault`: `Tag.has(BookingStatus)`, the variant's stamp `UtcEpochMs.is`, a CANCELLED `cancellationReason` a string                                      | systems narrow on the discriminator (Law 6.2); `enteredAtUtcMs` reads the stamp                                                                                                                                                                                                                                                                       |
| `busyKeys`, `barberIds`                                                                           | arrays; every element `BusyKey.is` / `BarberId.is`                                                                                                                           | `BusySystem.affectedKeys` and lane membership ITERATE them (a non-array throws in a trigger)                                                                                                                                                                                                                                                          |
| `subjectUserIds`, `subjectCustomerIds`                                                            | ABSENT, `null`, or an array; every element `UserId.is` / `CustomerId.is`                                                                                                     | the projection dispatch ITERATES `subjectCustomerIds` (`ClientStatsSystem.affectedSubjects` reads `.length`); absent / `null` stays admitted for the backfill's legacy rows (`project-client-stats.integration.spec.ts:501`), and every reader of the subjects goes through `StoredDocumentSystem.salvage`, which reads absent / `null` as `[]` (D-3) |
| `seats`                                                                                           | an array; every element a record (`StoredFields.isRecord`) and `Seat.fieldFault` clean (below)                                                                               | the seats are the truth                                                                                                                                                                                                                                                                                                                               |
| `discounts`, `voucherRedemptions`, `appliedOperations`                                            | arrays whose elements are records                                                                                                                                            | iterated by the bill and the ledger replay                                                                                                                                                                                                                                                                                                            |
| `stoodSeatPairsRevision`, `stoodSeatPairs`                                                        | `StoodSeatPairs.fieldFault`: the revision a non-negative safe integer or `null`; the pairs an array of records                                                               | `StoodSeatPairs.liveAt` compares the revision with `revision` and hands the pairs out                                                                                                                                                                                                                                                                 |
| `revision`                                                                                        | a non-negative safe integer                                                                                                                                                  | the optimistic-concurrency counter of staff edits                                                                                                                                                                                                                                                                                                     |
| `bookedFromAppointmentId`                                                                         | `AppointmentId.is` or `null`                                                                                                                                                 | the rebooking edge                                                                                                                                                                                                                                                                                                                                    |
| `bookedAtUtcMs`, `arrivedAtUtcMs`                                                                 | `UtcEpochMs.is` or `null`                                                                                                                                                    | lead-time / lateness statistics (T2)                                                                                                                                                                                                                                                                                                                  |
| `contactName`, `contactPhone`, `contactEmail`, `contactNote`                                      | `BookingContact.fieldFault`: a string or `null` each                                                                                                                         | read by presenters and the call sheet                                                                                                                                                                                                                                                                                                                 |

A seat (`Seat.fieldFault`, reason `seats[i].<field>`): `seatId`
(`SeatId.is`), `serviceId` (`ServiceId.is`), `variantId`
(`ServiceVariantId.is` or `null`), `barberId` (`BarberId.is`), `startMinutes`
(`MinuteOfDay.is`), `tipCents` (`PriceCents.is` or `null`); `ServiceTerms`:
`priceCents` (`PriceCents.is`), `currency` (`Currency.is`),
`durationMinutes` (`DurationMinutes.is`), `setupMinutes` / `cleanupMinutes`
(`MinuteCount.is`); `SeatOccupant`: `seatSubject` (`Tag.has(SeatSubject)`)
and, for an ACCOUNT, `subjectUserId` (`UserId.is`) and `subjectCustomerId`
(`CustomerId.is`); `SeatOutcome`: `attendanceState`
(`Tag.has(AttendanceState)`) and its variant's stamp (`UtcEpochMs.is`).

**The rule for which fields are checked** (one rule, applied to every
archetype): a field is checked when a system ITERATES it, NARROWS on it or
COMPUTES on it; a field only a query or a display reads is not. The subject
mirrors are iterated, so they are checked — but in their repairable form
(absent / `null` admitted, garbage refused), because
`BackfillPlanSystem.mirrorRowOf` reads a missing subject list as `null` and
`SUBJECT_MIRROR` stamps it (`project-client-stats.integration.spec.ts:501`
deletes both lists and expects the backfill to restore them — a guard that
refused those rows would make the repair impossible). The system's JSDoc
names this as the ONE place an admitted document may differ from its type
(`readonly CustomerId[]`), and why no reader trusts the type there.

**Deliberately NOT checked** (each named in the system's JSDoc):
`ownerUserId`, `ownerCustomerId`, `placement`, `inferredPlacement` — query
keys and the backfill's repair targets, read by no decision. Also unchecked: display-only fields
(`barberPreference`, `catalogPriceCents`, `catalogDurationMinutes`,
`guestLabel`, `subjectRelationship`, `cancelledBy`, `cancellationWindowHours`,
the contact's E.164 / e-mail SHAPE) and the elements of `discounts`,
`voucherRedemptions`, `appliedOperations`, `stoodSeatPairs` beyond "a
record". The guard is light by design; a field joins the table when a
system starts to rely on it.

`customers/{id}` (`StoredDocumentSystem.customer`): `id` (`CustomerId.is`),
`userId` (`UserId.is` or `null` — D29: the explicit link), `displayName`
(string), `phone`, `email` (string or `null`), `createdAtUtcMs`
(`UtcEpochMs.is`), `customerOrigin` (`Tag.has(CustomerOrigin)`). NOT checked:
`searchName`, `searchPrefixes` — search mirrors only the index #8 query
reads (no system decides on a stored customer's; `ProfileEditSystem`
compares a `User`'s, not a `Customer`'s), so by the rule above they stay out.

`barberBusy/{id}` (`StoredDocumentSystem.busyDay`): `id` (`BusyKey.is` — the
id IS the key), `barberId` (`BarberId.is`), `localDate` (`LocalDate.is`),
`utcEpochMs` (`UtcEpochMs.is`), `blocks` (an array; each element a record
and `MinuteBlock.fieldFault` clean: `MinuteRange.fieldFault` —
`startMinutes` `MinuteOfDay.is`, `endMinutes` `EndMinute.is`,
`startMinutes < endMinutes` — then `blockKind` `Tag.has(BlockKind)`; reason
`blocks[i].<field>`). A busy day feeds the collision math directly, so its
blocks are checked whole.

**Salvage** (`StoredDocumentSystem.salvage(doc: StoredDocument):
StoredSalvage`, RETRY's decoders are its only callers): what a trigger may
still read off an appointment side — `busyKeys` when it is an array of
`BusyKey.is` values, `subjectCustomerIds` when it is an array of
`CustomerId.is` values, `locationId` when `LocationId.is`; otherwise the
shared empty array / `null`. It answers the document's OWN arrays (no copy)
and is used on admitted sides too, for the subjects (absent / `null` → `[]`).

**The registry.** `StoredDocumentSystem.guardOf(collection: string):
StoredGuard | null` answers the guard of `Collections.Appointments`,
`Collections.Customers`, `Collections.BarberBusy` and `null` for every other
collection (read as stored, as today); `StoredDocumentSystem.unguarded` is
the registry that answers `null` for all. An adapter that reads by PATH (the
transaction's read half, the web's shared reads) dispatches on the path's
collection — top-level only (`path.length === 2` / a one-segment collection);
a subcollection is never guarded.

**As integrated (§8.2).** `Seat.fieldFault` carries one check the table
above does not list: the sold service ends by the closing midnight (F-6 —
`startMinutes + durationMinutes ≤ 1440`, reason `durationMinutes`), a
cross-slice invariant (`SeatCore` × `ServiceTerms`) that `Seat.endMinutes`
otherwise refuses as a thrown defect deep in a system. `idCompanion` also
gained `isSpan(text, start, end)` — the allocation-free id check
`BusyKey.is` uses for its barber half.

**As fixed after the review (§8.6).** Each numeric brand's range has ONE
home: its `is` door, which `of` (and `ofProven`) answer through — the
`-0` fold of `UtcEpochMs.of`, `PriceCents.of` and `MinuteCount.of` kept.
The stored-shape predicates (`isTextOrNull`, `isCount`, `isRecordArray`,
`isArrayOf`) live once, on `StoredFields`.

### D-2 — the error: `REPOSITORY_MALFORMED`, reused (DEP-10)

`RepositoryErrorCode.Malformed` (`'REPOSITORY_MALFORMED'`) already exists in
`errors/repository.error.ts` with exactly this meaning — "A document was read
but is not the entity's shape" — and `RepositoryError.malformed(path,
reason)` already carries the two fields the brief asks for: `path`
(`appointments/a1`) and `reason` (the offending field, `seats[1].startMinutes`;
the type's own doc already says "a missing field name"). It is wired end to
end: the edge maps it to `internal` (`edge.ts` `REPOSITORY_WIRE`), the i18n
catalogues word it (`errors.REPOSITORY_MALFORMED`, the same words every
`REPOSITORY_*` code shares), the web-storage draft and the streak publish
adapter already answer it. A second code (`REPOSITORY_DOCUMENT_MALFORMED`)
would split one meaning in two and force edits to the dictionary pin of
`repository.error.spec.ts`, the edge table and both catalogues for no
behavioural gain. **Ruled: reuse it.** `repository.error.ts` gains only a
JSDoc line naming `StoredDocumentSystem` as its read-time producer. (If the
owner wants the separate code anyway, it is a mechanical follow-up: dictionary
member + factory + spec pin + `REPOSITORY_WIRE` row + two catalogue keys.)

`TriggerAttemptSystem` judges a `REPOSITORY_MALFORMED` refusal by the fixed
canonical code `'data-loss'` (gRPC 15, "unrecoverable data loss or
corruption"), never by its `reason` (a field name) — PERMANENT, so a
retrying trigger logs it and never redelivers it (D-5).

### D-3 — the read rules: single, list, transaction, walk

| Read kind                                                                                                         | On a malformed document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **single** — one document by id, once or live; a `limit 1` lookup that answers one entity (`loadCustomerForUser`) | answers `Result.err(REPOSITORY_MALFORMED)` naming path + field; a live single stream EMITS that error and keeps listening (a corrected document emits `ok` again). Web: also reported once per document per port call (D-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **list / stream** — a query answering many (once or live)                                                         | the malformed document is DROPPED from the answer and REPORTED (D-4), once per document per port call; the rest of the list answers as today. **Systemic rule:** when the WHOLE answer drops at least one row and KEEPS NONE, the list answers `Result.err(REPOSITORY_MALFORMED)` naming the first dropped path and field — an answer read in parts is judged whole (the staff search's two halves are admitted together, so a half whose every row is malformed drops beside the other half's visits; the paged history is judged on its FIRST page, and a later page that drops every row answers an empty page with its cursor, so the older visits still load — corrected after the review, §8.6) — so a bulk drift or a version skew (an old cached web chunk whose dictionary lacks a member newer functions write) shows the screen's read-failure state, never an empty day that reads as a free one or a search that finds nobody. A paged list cuts its page on the rows AS READ, then drops from the page; its first page ranges `utcEpochMs <= UtcEpochMs.MAX` like every later page (Firestore range filters are type-bounded, so a non-numeric `utcEpochMs` never enters the read and can never become the cursor; a `NaN` IS a number to Firestore that sorts below every other, so it can only trail a history, is dropped there, and — as the cursor of a full page — answers `nextBeforeUtcMs: null`, since the store refuses a range below `NaN` and nothing well-formed is older; corrected at integration, §8.2). **Strict list — `observeUpcoming` only:** one malformed upcoming booking makes the stream emit `Result.err(REPOSITORY_MALFORMED)` (c1db661's posture, kept: "a booking you cannot see is a booking you cannot cancel") |
| **transaction** — every `ReadTx` read (`get`, `getAll`, `query`) inside `CommitPlan`                              | the WHOLE commit answers `Result.err(REPOSITORY_MALFORMED)`; `decide` never runs, nothing is written. Mechanism: the read half answers `null` for that document (excludes it from a query) so the pipeline's read callback can finish without touching it, records the FIRST refusal, and `firestoreCommitPlan` checks the record after `read` and before `decide`. No throw crosses a boundary; contention re-runs start with a clean record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **cursor walk** — the backfill's `pageAppointments` (`orderBy(documentId())`)                                     | the whole page answers `Result.err(REPOSITORY_MALFORMED)`: the walk stops AT the document and the operator's call names it. Dropping would shorten the page and `BackfillPlanSystem.pageWalk` reads `ids.length < pageSize` as "exhausted" — the walk would end early and silently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **trigger read** — a side of a write event (`before` / `after`)                                                   | each side is guarded SEPARATELY. A refused side is logged at once (`'malformed document refused'`, `{ path, field }`, through the decoder's `onRefused`) and contributes only its `StoredDocumentSystem.salvage` (busy keys, subject ids, location id); the other side drives as usual. The refusal is the answer (`Result.err(REPOSITORY_MALFORMED)`, permanent, `data-loss`, one attempt line) ONLY when the sides together yield no usable busy key / no subject — decided past the edge since the review (§8.6): the decoders guard and forward (`StoredDocumentSystem.appointmentSide`, `salvageSides`), `rebuildBusy` answers the command's `refusal` when its one `affectedKeys` is empty, and `ClientStatsSystem.dispatchSubjects` owns the dispatch's rule. So repairing or deleting a malformed appointment still frees its old day and re-projects its clients — the malformed document never freezes its own repair. Safe because the work is re-read: `rebuildBusy` recomputes each day from the live appointments its transaction reads, and the projection re-reads each client's history in its transaction, so a side is only ever used to PICK keys and subjects, never as data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

No decision is ever made on a malformed document: singles and transactions
refuse, lists decide only on the documents that passed, triggers only pick
WHICH projections to recompute from a refused side (the recompute reads the
store, guarded).

**Against `c1db661`.** The old mappers' LIST posture
(`git show c1db661:libs/infrastructure/firestore/src/lib/appointment-repository.adapter.ts`):
`observeBarberDay` ("one unparseable doc must not blank the whole day"),
`observeHistoryFor`, `searchWindow` and the client-history reader
(`parsed()`) DROPPED a malformed document silently; `observeUpcomingFor`
ERRORED the whole stream ("a booking you cannot see is a booking you cannot
cancel"); the availability reader dropped malformed busy SPANS one by one and
kept the day; `findById` answered the mapper's failure. **The new list rule
matches c1db661 list for list:** the staff lists drop (`observeBarberDay`,
`observeHistory`, `searchAppointmentWindow`, the paged history) and
`observeUpcoming` errors the whole stream, exactly as before — c1db661's
`searchWindow` looped over BOTH halves' rows together and dropped every
unparseable one ("one unparseable document must not empty a search"), and
since the review (§8.6) the new search admits its two halves together too,
and the history refuses only on its first page. It adds two
things the mappers lacked — a report (console-only on the web, D-4) and the
systemic rule (all rows dropped → `err`, where c1db661 would have answered
an empty, normal-looking list). It departs in ONE place, deliberately
(DEP-2): a busy day is a SINGLE document now — refused whole, fail-closed,
where the old reader dropped a corrupt span and so OFFERED the time under it.

### D-4 — the reporting channel

- **Functions — logged AT THE POINT OF REFUSAL.** The places that already
  log failures do NOT carry the path: `callableEdge` (`edge.ts:841-868`)
  throws `toHttpsError(result.error)` and logs nothing (the wire projection
  drops `path` / `reason`), and the attempt line (`attemptLineFields`,
  `edge.ts:925`) carries only `fn, eventId, outcome, errorCode, ageMs`. So
  every functions read site that refuses logs the refusal itself, ONCE:
  `log('error', 'malformed document refused', { path, field })` (`field` =
  the error's `reason`). Mechanism: `firestoreCommitPlan`,
  `firestoreSchedulePorts` and `firestoreJobPorts` take the root's `Log` as
  a construction parameter beside the guard (default a no-op);
  `firestorePorts(db, primitives, telemetry)` already receives telemetry and
  passes `telemetry.log`. The commit logs the RECORDED refusal once, after
  `read` and before it answers the `err` (not per contention attempt's
  read). The trigger decoders log a refused side through their `onRefused`
  parameter, which `main.ts` binds to `root.edge.log` (D-3). The attempt
  line still follows (`data-loss`, PERMANENT) for the event; the pipelines'
  own failed-item lines (`barberBusy rebuild failed`, `waitlist match
failed`) are unchanged. The telemetry log port
  (`console-telemetry.adapter.ts`) is the sink in every case — Cloud
  Logging, where an operator can search the path.
- **Web.** The only reporting channel the web data layer already uses is
  Angular's `ErrorHandler` (`lazy-port.ts`: `errorHandler.handleError(
lazyPortLoadError(…))`, a plain named `Error`, reported once per failure).
  The guarded web reads report through the ecs-core `LogPorts` bundle (the
  same port the functions use), implemented over that `ErrorHandler` by a
  new adapter `errorHandlerLogPorts(handler: ErrorHandler): LogPorts`
  (`libs/infrastructure/firebase-app/src/lib/error-handler-log.adapter.ts`):
  each `log(level, msg, fields)` becomes ONE `handler.handleError(error)` of
  a plain `Error` named `DATA_LOG_ERROR` (`'DataLog'`), message `msg`, `cause`
  the `fields` record. The guarded reads log `'error'`,
  `'malformed document dropped'` (lists) / `'malformed document refused'`
  (singles), fields `{ path, field }`, once per document path per port call
  (a `Set` in the call's closure, so a live list re-emitting the same bad
  document does not report on every snapshot).
- **What the web report is, and is not.** No custom `ErrorHandler` is
  provided anywhere (`grep -rn ErrorHandler apps/web/src libs` finds only
  `lazy-port.ts`), so Angular's default `handleError` calls
  `console.error`: the report reaches ONLY the console of the device that
  loaded the page — a staff device for the staff lists, the client's own
  browser for `observeUpcoming`. It reaches neither the shop nor any
  telemetry, and the plan claims nothing more for it. That is why no rule
  of D-3 relies on the report to make a hidden document visible: the strict
  upcoming list and the systemic rule surface failures in the UI itself
  (the screen's read-failure state), and the one-bad-of-many drop on a
  staff list stays an accepted, console-reported loss of that one row
  (c1db661 dropped it silently). A real sink (an `ErrorHandler` forwarding
  `DataLog` errors to telemetry) and a worded "1 visit could not be shown"
  are follow-ups (OQ-6, OQ-7); `errorHandlerLogPorts` is the seam both
  plug into.

### D-5 — the retry: the allowlist, extended, and the transient/decisive split

**The allowlist** (audit remediation, 2026-08-02) is the closed set of
failures a re-run may heal. On the web it is `subscribe-with-retry.ts`
`RETRYABLE_CODES` (a live re-listen); on the server its twin is
`TriggerAttemptSystem` `TRANSIENT_CODES` — `aborted`, `unavailable`,
`deadline-exceeded`, `resource-exhausted` ("the failures worth a
redelivery"), applied by exactly one function, `edge.ts` `retryingTrigger`,
which rethrows a TRANSIENT verdict and returns on every other. The deployed
half of the allowlist is the `retry` flag per export, pinned as a literal in
`main.spec.ts` `ENDPOINTS` ("a changed … retry flag … fails here").

**Extended, not bypassed:**

1. `main.ts`: the three triggers declare `retry: true` and run through
   `retryingTrigger` (their own `fn` names) — the same tail the four
   retrying triggers already use; no handler rethrows on its own.
2. `main.spec.ts` `ENDPOINTS`: the three rows flip to `written(…, true)`.
3. `TriggerAttemptSystem.judgedCode`: a `REPOSITORY_MALFORMED` refusal is
   judged `'data-loss'` (D-2) — PERMANENT by the allowlist, whatever field
   its `reason` names. `TRANSIENT_CODES` is NOT widened: `internal` stays out
   on the server (the web re-listen keeps it; a trigger retrying an
   `internal` for the whole retry window is the infinite billed loop the
   audit closed).

**Idempotent by construction** — each handler recomputes its projection from
its source, so a redelivery re-runs everything and lands on the same state:

| Trigger                          | Transient (rejects → redelivered)                                                                                                                                                                                       | Decisive (logged ONE attempt line → resolves)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Why a rerun is a no-op                                                                                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rebuildBusyOnAppointmentChange` | the zone read's refusal with a transient `reason`; ANY day's commit rejection with a transient code (`aborted` after the SDK's own retries, `unavailable`, …) — the days after it are still attempted, then the verdict | an event whose sides yield no usable key at all (decode, D-3 — a refused side that still names its `busyKeys` DRIVES the rebuild); a day whose transaction read a malformed appointment (`REPOSITORY_MALFORMED` → `data-loss`); a zone that cannot be read for good (`not-found`, a missing location). A refused side with no salvageable `locationId` and no other side reads the DEFAULT location's zone (`readShopZone(null)`, F-4) and still frees its day — ruled at integration, §8.2                                                 | `BusySystem.rebuild` RECOMPUTES a day from every live appointment on it (normalized geometry, never subtracted); the body and its `purgeAt` (`RetentionSystem`, from `localDate`) are deterministic, so a second run writes the identical document (or the same delete) |
| `rebuildCapacityOnBusyChange`    | the zone / policy read's transient refusal; the barber's transaction rejecting with a transient code                                                                                                                    | a malformed busy day in the barber's range (the transaction refuses, D-3); a non-key doc id (decodes to nothing, as today)                                                                                                                                                                                                                                                                                                                                                                                                                  | `CapacitySystem.applyPlan` REPLACES the month's entries (full sorted `Set`, never merge) from the busy/exception geometry read in the same transaction                                                                                                                  |
| `matchWaitlistOnBusyChange`      | the zone / policy / open-requests / day-snapshot read's transient refusal; ANY request whose settle rejected or refused with a transient code (`TriggerAttemptSystem.decisiveFailure` over the per-request failures)    | a request's permanent refusal. A malformed busy day in the day snapshot (`loadBusyDay`, single → refused `REPOSITORY_MALFORMED`) is NOT an attempt failure: only THAT barber is skipped (fail-closed per barber — none of their time is offered), the refusal is logged at the adapter (D-4) and by the pipeline (`'waitlist barber skipped'`, `{ key, error }`), and the other barbers are matched (DEP-13). Any other `loadBusyDay` refusal still answers the pipeline's `Result.err` (judged by its reason, so `unavailable` redelivers) | a match is ONE transaction that re-reads the request and requires it `OPEN`, under the deterministic notification id (`ALREADY_EXISTS` on a replay); a request notified by the first delivery is `MATCHED`, so the rerun never reads it                                 |

A decisive failure is LOGGED (the attempt line: `fn`, `eventId`,
`outcome: 'PERMANENT'`, `errorCode`, `ageMs`; the refusal's path and field
in the `'malformed document refused'` line logged where it was refused,
D-4) and SWALLOWED — Cloud Functions does not retry it for the retry window.

**Pipeline consequences** (the established pattern of
`ClientStatsProjection`): `rebuildBusy` and `matchWaitlist` keep going past
an item's failure, collect `failures: readonly unknown[]`, and answer
`attemptFailure: TriggerAttemptSystem.decisiveFailure(failures)` beside their
result; the wire turns any such answer into an `AttemptReport`
(`projectionReport`, widened to every `{ attemptFailure }` answer).
`rebuildCapacity` needs no change: its Day path is one barber, and its
refusal (`Result.err`, judged by `reason`) or rejection (judged by code)
already reaches `retryingTrigger` through `failOnRefusal`; its rerun is
proved by a new spec case only (§4.2). `rebuildBusy`'s command gains the
refused sides' salvage (`salvagedKeys`, `salvagedLocationId`, §2.4) and —
since the review (§8.6) — the first side `refusal`:
`BusySystem.affectedKeys(before, after, salvagedKeys)` unions them, the
pipeline answers `Result.err(refusal)` when that one computation is empty,
and the zone is read off `(after ?? before)?.locationId ??
salvagedLocationId`.
`matchWaitlist`'s `loadDay` skips a barber whose busy day answers
`REPOSITORY_MALFORMED` instead of returning the refusal (DEP-13).

### D-6 — the transactional note port, its adapter, the one record builder

- **Port** (`ports/notes-photos.port.ts`), joining `AppointmentNotePorts`
  (the bundle `APPOINTMENT_NOTE_PORTS` binds, Law 9.1):

  ```ts
  export type UpdateAppointmentNote = (
    appointmentId: AppointmentId,
    decide: (stored: AppointmentNote | null) => AppointmentNote | null,
  ) => Promise<Result<AppointmentNote | null, RepositoryError>>;
  ```

  The transaction IS the sandwich (Law 4): read `appointmentNotes/{id}`,
  hand it to the PURE `decide`, `Set` its answer — in ONE `runTransaction`.
  `decide` answering `null` writes nothing (the append never deletes);
  contention re-runs read → decide; the answer is the note written, or
  `null` when nothing was. Any failure — offline, contention exhausted, a
  rule denial — is `RepositoryError.writeFailed(path, reason)`, nothing
  written.

- **Adapter** (`libs/infrastructure/firestore/src/lib/appointment-notes.adapter.ts`
  `updateAppointmentNote`), the precedent being `scheduleExceptionPorts`'
  transaction in `scheduling.adapter.ts`: `runTransaction(db, async (tx) => …)`
  — `tx.get(ref)`, `entityOf` (or `null`), `decide`, `defect` on an id that
  is not the ref's, `tx.set(ref, body)`; `catch` → `writeFailed(ref.path,
cause)`. **Offline — the guarantee, and what is not yet known.** The web
  SDK's transactions read from the server, never the persistent cache, and
  write only at commit, so an unreachable server can never produce an
  overwrite: whatever the transaction rejects with, nothing is written and
  the adapter answers `REPOSITORY_WRITE_FAILED` carrying the rejection's
  code as `reason`. The SDK's transaction runner treats non-permanent codes (`unavailable`
  included) as retryable and backs off over up to 5 attempts, so the adapter
  maps ANY rejection (no code is special-cased) and the specs assert the
  mapping, not a code. **Observed (integrator, §6.3 step 8, §8.4):** with
  the server unreachable (the client dialled the emulator through a TCP
  proxy that was cut) on a note the client never read, the append answered
  `REPOSITORY_WRITE_FAILED` with reason `unavailable` after **7.2 s**,
  `decide` never ran, the server's copy was unchanged after reconnecting
  (and 5 s more), and the same client then appended once. `disableNetwork`
  turned out NOT to reach a transaction — it stops the listen and write
  streams only; the transaction's RPCs went to the server and the append
  landed normally (16 ms) — so it is no offline simulation for this path,
  and the probe cut the connection instead. UX: the append runs AFTER the
  cancellation landed and nothing waits on it — no busy state, no blocked
  control (`staff-dashboard.ts:5253-5262`: `cancelNoteFiled` set first, the
  toast raised on `false`) — so a late answer only delays the
  `staff.day.cancelNoteFailed` toast ("the cancellation itself stands"); no
  timeout is added (the runner's attempts are already bounded). The store
  already maps any failure to `false`.

- **Pipeline** (`append-team-note.pipeline.ts` `appendTeamNote`): a blank
  line → `ok(null)`, no read, no write (unchanged); otherwise the instant is
  read ONCE from the injected clock (`ports.nowUtcMs()`) and
  `ports.updateAppointmentNote(id, (stored) => …)` decides with
  `VisitSidesSystem.appendedNote(stored?.text ?? null, cmd.line)` and the
  ONE record builder `noteRecord(id, text, cmd.authorUserId, writtenAtUtcMs)`.
  No `firstValueFrom`, no `observeAppointmentNote`, no `saveAppointmentNote`
  in the append. `saveTeamNote` (the sheet's «Запази», a deliberate
  whole-note write of the user's draft) is unchanged and keeps
  `saveAppointmentNote`.

- **The one record builder.** Pass D already closed pass C's "team note
  record built twice" (D-10.2: `noteRecord`, module-private in
  `append-team-note.pipeline.ts`, used by both pipelines; HANDOFF:1161). This
  pass keeps it the ONLY place a note record is built — the append's
  `decide` calls it — and pins it with the existing key-order spec. Stamps
  are exactly the save path's: the author from the command (the store's
  session, `currentUserId()`), the instant from the injected clock.

- **Store / dashboard.** `StaffDayStore.appendTeamNote` keeps its signature
  and `boolean` answer (JSDoc updated: one transaction; offline refuses);
  the dashboard's UX is untouched — the words are appended once per sheet
  (`cancelNoteFiled`), a failed save raises `staff.day.cancelNoteFailed`.

### D-7 — wiring: guards at the composition roots (DEP-11)

Every guarded adapter takes its guard as a construction parameter whose
DEFAULT is the unguarded registry, and the two composition roots — the only
production construction sites — pass the real one:

- functions: `firestoreCommitPlan(db, guardOf, log)`,
  `firestoreSchedulePorts(db, guardOf, log)`, `firestoreJobPorts(db,
guardOf, log)`; `firestore-ports.ts` `firestorePorts` passes
  `StoredDocumentSystem.guardOf` and `telemetry.log` to all three (D-4).
- web: `appointmentReadPorts(db, guard)`, `customerPorts(db, guard)`,
  `schedulingReadPorts(db, guard)` with `guard: ReadGuard = UNGUARDED`;
  `app.config.ts` passes `m.firestore.guardedReads(errorHandlerLogPorts(
inj.get(ErrorHandler)))` (built inside the lazy scope, so `@core/systems`
  stays off the initial chunk).

Why a default at all: the adapters' existing specs seed PARTIAL bodies for
mechanics tests (`firestore-tx.adapter.spec.ts:37` seeds
`appointments/a1: { ownerUserId: 'u1' }`; `appointments.adapter.spec.ts`
`visit()` seeds only the query keys; the integration specs build
`firestoreCommitPlan(db)` by hand) — "every existing spec passes unchanged"
holds only if a bare factory reads as today. The roots are pinned by new
wiring specs and by the §6.2 grep gates, so no production read is unguarded.
The emulator journeys (`verify:p0`, `test:emulator`'s pipeline runs through
`main.ts`, `e2e:web` through `app.config.ts`) read the seeded documents
THROUGH the guards — the real-data proof.

---

## 1. Every read site of `appointments`, `customers`, `barberBusy`

Kinds: **S** single, **L** list once, **LS** live list, **SS** live single,
**T** transaction, **W** cursor walk, **E** trigger side. "After" is the
behaviour on a malformed document once the packages land (D-3).

### 1.1 Web (`libs/infrastructure/firestore/src/lib/*`) — package GUARD

| Site (`36bbac9`)                                                                                                                 | Collection   | Kind       | Reached by                                                           | After                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `observe.ts:38` `entityOf`, `:70` `observeDoc`, `:86` `observeQuery`, `:100` `readDoc`, `:113` `readQuery`                       | (all)        | helpers    | every `(db) => bundle` adapter                                       | gain `guard: ReadGuard = UNGUARDED`; dispatch on the read's collection (`guard.guardOf`); single → err + report; list → drop + report                                                                                                                                                                                                                                                                                                                                                                                          |
| `appointments.adapter.ts:149` `observeAppointment`                                                                               | appointments | SS         | booking-flow store, client-booking                                   | emits `err(REPOSITORY_MALFORMED)`, keeps listening, reports                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `appointments.adapter.ts:158-166` `observeBarberDay`                                                                             | appointments | LS         | staff-day                                                            | drops + reports, then sorts the rest — one bad visit never blanks the day; every visit of a snapshot malformed → emits `err` (systemic rule), the day shows its read failure, never a free day                                                                                                                                                                                                                                                                                                                                 |
| `appointments.adapter.ts:169-178` `observeUpcoming`                                                                              | appointments | LS         | appointments store, client-account, site menu                        | STRICT: one malformed booking → emits `err(REPOSITORY_MALFORMED)`, keeps listening, reports — c1db661's posture kept                                                                                                                                                                                                                                                                                                                                                                                                           |
| `appointments.adapter.ts:181-190` `observeHistory`                                                                               | appointments | LS         | appointments store                                                   | drops + reports; all dropped → `err`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `appointments.adapter.ts:72-116` `pageOf` (`:83` `newestFirst`, `:97` same instant, `:101` older) via `:199` `pageClientHistory` | appointments | L (paged)  | client-card                                                          | the first page gains `where('utcEpochMs', '<=', UtcEpochMs.MAX)` (later pages already range — a non-numeric `utcEpochMs` sorts before the numbers in `desc` and would become the cursor); the three queries read UNGUARDED (raw rows); `PagingSystem` cuts the page and the cursor on the rows as read; the page's rows (`step.rows` / `whole.rows`) then dropped + reported — a page may be short, the history never ends early; a FIRST page whose rows ALL drop → `err`, a later one → an empty page with its cursor (§8.6) |
| `appointments.adapter.ts:119-146` `windowOf` via `:217` `searchAppointmentWindow`                                                | appointments | L ×2       | staff-day search, add-client «Скорошни»                              | both halves read raw and admitted ONCE, together: a malformed row drops + reports, the answer is the rest, as today; only a window that read rows and kept none → `err` (systemic rule on the whole answer — corrected from "per half" after the review, §8.6)                                                                                                                                                                                                                                                                 |
| `customers.adapter.ts:22-32` `loadCustomerForUser` (`userId ==`, `limit 1`)                                                      | customers    | S (lookup) | client-card                                                          | the query reads UNGUARDED; the one row goes through the SINGLE rule (`admitted`): err + report — never read as "no record yet"                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scheduling.adapter.ts:31` `observeBusyDay`                                                                                      | barberBusy   | SS         | staff-day, booking `day-availability.ts` (schedule step, time sheet) | emits `err(REPOSITORY_MALFORMED)` — the grid shows that barber-day's read failure (fail-closed), keeps listening, reports                                                                                                                                                                                                                                                                                                                                                                                                      |

No other web read touches the three collections (runbook §1.1 `wa` column;
`appointment-photos.adapter.ts` reads `appointmentPhotos`, the notes adapter
`appointmentNotes`).

### 1.2 Functions (`apps/functions/src/**`) — packages GUARD and RETRY

| Site (`36bbac9`)                                                                         | Collection(s)                            | Kind | Reached by                                                                                                                                                                                                                                                                                                | After                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapters/firestore-tx.adapter.ts:95-98` `firestoreReadTx.get`                           | all three (by path)                      | T    | `booking-read-set.pipeline.ts:160` `readAppointment` (book replay probe, reschedule, edit, cancel, transition, mark-arrival, record-seat-tip); `run-backfill.pipeline.ts:283` `stampMirrors`                                                                                                              | the commit answers `err(REPOSITORY_MALFORMED)`; `decide` never runs; GUARD                                                                                                                                                                                                                                                                                                                    |
| `adapters/firestore-tx.adapter.ts:99-107` `firestoreReadTx.getAll`                       | all three (by path, mixed)               | T    | `booking-read-set.pipeline.ts:175` (phase one: appointment + customers), `:222` (phase two: `barberBusy` keys, absent included); `customer-records.pipeline.ts:65`; `complete-registration.pipeline.ts:188` (`users` + `customers`)                                                                       | same; the `users` paths stay unguarded; GUARD                                                                                                                                                                                                                                                                                                                                                 |
| `adapters/firestore-tx.adapter.ts:108-111` `firestoreReadTx.query`                       | appointments, barberBusy (by collection) | T    | `rebuild-busy.pipeline.ts:86` (`liveOnBusyDay`, #7); `transition-appointment.pipeline.ts:118` (reinstatement collision query); `project-client-stats.pipeline.ts:145` (`clientHistory`, also run by `continue-policy-recompute` and `run-backfill`); `rebuild-capacity.pipeline.ts:153` (busy range, #13) | same (the whole commit refuses — a rebuild never frees time it cannot read, a stats projection never counts half a history); GUARD                                                                                                                                                                                                                                                            |
| `adapters/firestore-schedules.adapter.ts:59-60` `loadBusyDay` (`loadOne`)                | barberBusy                               | S    | `match-waitlist.pipeline.ts:203` (`loadDay`, outside any transaction)                                                                                                                                                                                                                                     | `err(REPOSITORY_MALFORMED)`, logged at the adapter (D-4); GUARD → the match's `loadDay` skips THAT barber (fail-closed per barber), logs it, matches the rest (RETRY, DEP-13)                                                                                                                                                                                                                 |
| `adapters/firestore-jobs.adapter.ts:63-79` `pageAppointments`                            | appointments                             | W    | `run-backfill.pipeline.ts:368` `appointmentsPage`                                                                                                                                                                                                                                                         | the page answers `err(REPOSITORY_MALFORMED)` naming the document — the backfill call FAILS at it (its audit row `FAILED`), the walk never skips or ends early; GUARD                                                                                                                                                                                                                          |
| `wire/triggers.wire.ts:105-111` `entityOf` → `:147-157` `decodeRebuildBusyEvent`         | appointments                             | E    | `main.ts:545` `rebuildBusyOnAppointmentChange`                                                                                                                                                                                                                                                            | the decoder answers `Result<RebuildBusyCommand, RepositoryError>`; each side guarded separately — a refused side is logged (`onRefused`) and contributes its salvaged `busyKeys` / `locationId`; `err` (permanent) only when no key is usable; RETRY (guard call named in §3)                                                                                                                 |
| `wire/triggers.wire.ts:105-111` `entityOf` → `:213-234` `decodeDispatchProjectionsEvent` | appointments                             | E    | `main.ts:648` `dispatchClientProjections` (already retrying)                                                                                                                                                                                                                                              | the decoder answers `Result<ProjectClientStatsCommand, RepositoryError>`; each side guarded separately; subjects read through `salvage` on every side (absent / `null` mirror → `[]`); a refused side skips the `statsInputChanged` test (it cannot be compared — the recompute is idempotent) and contributes its salvaged subjects; `err` (permanent) only when no subject is usable; RETRY |
| `wire/triggers.wire.ts:175` `decodeCapacityEvent`, `:201` `decodeMatchWaitlistEvent`     | barberBusy                               | —    | `rebuildCapacityOnBusyChange`, `matchWaitlistOnBusyChange`                                                                                                                                                                                                                                                | read the doc ID only (`BusyKey.parse`), no body — unchanged                                                                                                                                                                                                                                                                                                                                   |

No functions read of `customers` happens outside a transaction (the account
contact snapshot reads `users`, `firestore-accounts.adapter.ts`). The
integration specs and the seed construct these adapters by hand
(`firestoreCommitPlan(db)`) and stay unguarded (D-7). One integration spec
calls a decoder directly and is FORCED by its new `Result` answer:
`project-client-stats.integration.spec.ts:382-391` (`replayTrigger`) —
RETRY unwraps it (§3.2).

---

## 2. Contracts

### 2.1 ecs-core — primitives (GUARD)

```ts
// primitives/stored-fields.data.ts (NEW) — re-exported by primitives/index.ts
/** A document body as read — field names to unknown values; nothing checked yet. */
export type StoredFields = Readonly<Record<string, unknown>>;
export const StoredFields = {
  /** A non-null, non-array object — what a seat, a block or a body must be. */
  isRecord(raw: unknown): raw is StoredFields;
} as const;

// each beside its smart constructor; non-allocating; over the constructor's
// own input domain (strings for parse(raw: string), numbers for of/parse of
// a number) `X.is(raw)` ⇔ the constructor accepts `raw` unchanged; for every
// other type `X.is(raw) === false` (never call a string constructor with a
// non-string — `idCompanion.parse` runs `raw.trim()`, it would throw)
LocalDate.is(raw: unknown): raw is LocalDate;
LocalDate.isAt(text: string, start: number): boolean; // `text[start, start+10)` is a real day
MinuteOfDay.is(raw: unknown): raw is MinuteOfDay;
EndMinute.is(raw: unknown): raw is EndMinute;
UtcEpochMs.is(raw: unknown): raw is UtcEpochMs;
UtcEpochMs.MAX: UtcEpochMs;                              // the existing MAX_UTC_EPOCH_MS, exported (D-3 paging bound)
DurationMinutes.is(raw: unknown): raw is DurationMinutes;
MinuteCount.is(raw: unknown): raw is MinuteCount;
PriceCents.is(raw: unknown): raw is PriceCents;          // ≥ 0 safe integer (`of`, not `signed`)
Currency.is(raw: unknown): raw is Currency;              // one of the KNOWN codes AS STORED (no trim/upper-case)
BusyKey.is(raw: unknown): raw is BusyKey;                // `<barberId>__<LocalDate>`, last `__`, via `isAt`
// idCompanion(brand) gains — so every plain id (and CustomerId's spread) has it:
is(raw: unknown): raw is Brand<string, B>;               // a string, not blank, no `/`; no `trim()` allocation
// Tag.has — same signature and answers, a `for…in` scan (no `Object.values` array)
```

### 2.2 ecs-core — components (GUARD)

```ts
// each: the first own field of the slice that is not well-formed, else null
MinuteRange.fieldFault(raw: StoredFields): string | null;    // start, end, then start < end (reason 'endMinutes')
TimeCoordinate.fieldFault(raw: StoredFields): string | null; // localDate, MinuteRange.fieldFault, utcEpochMs
BookingLifecycle.fieldFault(raw: StoredFields): string | null;
BookingContact.fieldFault(raw: StoredFields): string | null;
StoodSeatPairs.fieldFault(raw: StoredFields): string | null; // revision (≥ 0 safe integer | null), pairs (array of records)
ServiceTerms.fieldFault(raw: StoredFields): string | null;
SeatOccupant.fieldFault(raw: StoredFields): string | null;
SeatOutcome.fieldFault(raw: StoredFields): string | null;
Seat.fieldFault(raw: StoredFields): string | null;           // SeatCore's fields, then the three seat slices
MinuteBlock.fieldFault(raw: StoredFields): string | null;    // MinuteRange.fieldFault, then blockKind
```

### 2.3 ecs-core — systems (GUARD; RETRY edits `trigger-attempt.system.ts`)

```ts
// systems/stored-document.system.ts (NEW) — re-exported by systems/index.ts
/** A stored document as read: its id beside its body. */
export type StoredDocument = StoredFields & { readonly id: string };
/** One stored archetype's guard — the document itself, or the refusal naming its path and field. */
export type StoredGuard = (doc: StoredDocument) => Result<StoredDocument, RepositoryError>;
/** Which guard a collection's documents pass — `null`: read as stored. */
export type StoredGuardOf = (collection: string) => StoredGuard | null;
/** What a trigger may still read off an appointment side (D-1 Salvage) — the doc's own arrays or the shared empties. */
export type StoredSalvage = {
  readonly busyKeys: readonly BusyKey[];
  readonly subjectCustomerIds: readonly CustomerId[];
  readonly locationId: LocationId | null;
};

export const StoredDocumentSystem = {
  appointment(doc: StoredDocument): Result<Appointment, RepositoryError>;
  customer(doc: StoredDocument): Result<Customer, RepositoryError>;
  busyDay(doc: StoredDocument): Result<BarberBusyDay, RepositoryError>;
  appointmentFault(doc: StoredDocument): string | null;  // zero-allocation halves
  customerFault(doc: StoredDocument): string | null;
  busyDayFault(doc: StoredDocument): string | null;
  guardOf: StoredGuardOf;    // appointments / customers / barberBusy → guard; else null
  unguarded: StoredGuardOf;  // null for every collection — the adapters' default
  salvage(doc: StoredDocument): StoredSalvage; // no allocation beyond the answer record
} as const;

// trigger-attempt.system.ts (RETRY) — judgedCode, module-private:
//   a RepositoryError whose errorCode is RepositoryErrorCode.Malformed → 'data-loss'
//   (exported as TriggerAttemptSystem.DATA_LOSS_CODE for the specs)
```

### 2.4 ecs-core — ports and pipelines

```ts
// ports/notes-photos.port.ts (NOTE)
export type UpdateAppointmentNote = (
  appointmentId: AppointmentId,
  decide: (stored: AppointmentNote | null) => AppointmentNote | null,
) => Promise<Result<AppointmentNote | null, RepositoryError>>;
export type AppointmentNotePorts = {
  readonly observeAppointmentNote: ObserveAppointmentNote;
  readonly saveAppointmentNote: SaveAppointmentNote;
  readonly updateAppointmentNote: UpdateAppointmentNote; // NEW
};

// ports/tx.port.ts (GUARD) — JSDoc only: a read of a malformed document of a
// guarded collection makes the commit answer REPOSITORY_MALFORMED, decide unrun.

// pipelines/append-team-note.pipeline.ts (NOTE) — signatures unchanged:
export type TeamNotePorts = AppointmentNotePorts & ClockPorts;
export const appendTeamNote: (ports: TeamNotePorts) =>
  (cmd: AppendTeamNoteCommand) => Promise<Result<AppointmentNote | null, RepositoryError>>;
export const saveTeamNote: … // unchanged

// pipelines/rebuild-busy.pipeline.ts (RETRY)
export type RebuildBusyCommand = {
  readonly before: Appointment | null;   // an ADMITTED side, or null (absent or refused)
  readonly after: Appointment | null;
  /** The refused sides' salvaged busy keys (D-3) — `[]` when no side was refused. */
  readonly salvagedKeys: readonly BusyKey[];
  /** A refused side's salvaged location — the zone's source when no side was admitted. */
  readonly salvagedLocationId: LocationId | null;
  /** Since the review (§8.6): the first refused side's refusal — the answer when no day is left. */
  readonly refusal: RepositoryError | null;
};
// systems/busy.system.ts (RETRY) — a third, defaulted parameter; existing callers unchanged:
//   affectedKeys(before, after, salvaged: readonly BusyKey[] = []): readonly BusyKey[]
export type RebuildBusyAnswer = {
  readonly rebuiltKeys: readonly BusyKey[];
  /** Every day's failure, in key order — a refusal or a rejection. */
  readonly failures: readonly unknown[];
  /** The attempt's verdict over them (`TriggerAttemptSystem.decisiveFailure`); `null` when none. */
  readonly attemptFailure: AttemptFailure | null;
};
// pipelines/match-waitlist.pipeline.ts (RETRY)
export type MatchWaitlistAnswer = {
  readonly notifiedRequestIds: readonly WaitlistRequestId[];
  readonly expiredRequestIds: readonly WaitlistRequestId[];
  readonly failures: readonly unknown[];             // NEW — per request
  readonly attemptFailure: AttemptFailure | null;    // NEW
};
```

### 2.5 Adapters and wiring

```ts
// apps/functions/src/adapters/firestore-tx.adapter.ts (GUARD)
export const firestoreReadTx = (
  db: Firestore,
  tx: Transaction,
  guardOf: StoredGuardOf = StoredDocumentSystem.unguarded,
  onRefused: (error: RepositoryError) => void = () => undefined,
): ReadTx;
export const firestoreCommitPlan = (
  db: Firestore,
  guardOf: StoredGuardOf = StoredDocumentSystem.unguarded,
  log: Log = () => undefined,     // logs the recorded refusal once: 'malformed document refused', { path, field } (D-4)
): CommitPlan;
// apps/functions/src/adapters/firestore-schedules.adapter.ts (GUARD)
export const firestoreSchedulePorts = (db: Firestore, guardOf: StoredGuardOf = StoredDocumentSystem.unguarded,
  log: Log = () => undefined): BarberListPorts & ShopDayReadPorts;
// apps/functions/src/adapters/firestore-jobs.adapter.ts (GUARD)
export const firestoreJobPorts = (db: Firestore, guardOf: StoredGuardOf = StoredDocumentSystem.unguarded,
  log: Log = () => undefined): BackfillJobPorts & CallerRolesPorts;
// apps/functions/src/adapters/firestore-ports.ts (GUARD): passes StoredDocumentSystem.guardOf and telemetry.log to the three.

// libs/infrastructure/firestore/src/lib/observe.ts (GUARD)
export type ReadGuard = { readonly guardOf: StoredGuardOf; readonly log: Log };
export const UNGUARDED: ReadGuard;                       // { guardOf: unguarded, log: () => undefined }
export function guardedReads(ports: LogPorts): ReadGuard; // { guardOf: StoredDocumentSystem.guardOf, log: ports.log }
export function admitted<E>(doc: StoredDocument | null, collection: string, guard: ReadGuard): Result<E | null, RepositoryError>;
/** How a list answers a malformed row — the ONLY source of these strings (adapter-local dictionary). */
export const ListAdmission = { DropMalformed: 'DROP_MALFORMED', RefuseMalformed: 'REFUSE_MALFORMED' } as const;
/** DROP: drop + report each bad row, `err` (first refusal) when rows were read and NONE kept (systemic rule);
 *  REFUSE: `err` on the first bad row (observeUpcoming). Admitted rows are the same objects. */
export function keepAdmitted<E>(docs: readonly StoredDocument[], collection: string, guard: ReadGuard,
  reported: Set<string>, admission?: ListAdmission): Result<readonly E[], RepositoryError>;
export function observeDoc<E>(ref: DocumentReference, guard?: ReadGuard): Observable<Result<E | null, RepositoryError>>;
export function observeQuery<E>(query: Query, path: string, guard?: ReadGuard, admission?: ListAdmission): Observable<Result<readonly E[], RepositoryError>>;
export async function readDoc<E>(ref: DocumentReference, guard?: ReadGuard): Promise<Result<E | null, RepositoryError>>;
export async function readQuery<E>(query: Query, path: string, guard?: ReadGuard): Promise<Result<readonly E[], RepositoryError>>;
// (a live single answers through `live<Result<E | null, RepositoryError>>(…)` flattened with `map`,
//  so a refusal is an emitted VALUE and `subscribeWithRetry` keeps the listener)
// firestore.adapters.ts re-exports `guardedReads` (the lazy half).

export const appointmentReadPorts = (db: Firestore, guard: ReadGuard = UNGUARDED): AppointmentReadPorts;
export const customerPorts = (db: Firestore, guard: ReadGuard = UNGUARDED): CustomerPorts;
export const schedulingReadPorts = (db: Firestore, guard: ReadGuard = UNGUARDED): SchedulingReadPorts;
// appointment-notes.adapter.ts (NOTE): appointmentNotePorts(db) gains updateAppointmentNote.

// libs/infrastructure/firebase-app/src/lib/error-handler-log.adapter.ts (NEW, GUARD)
export const DATA_LOG_ERROR = 'DataLog';
export function errorHandlerLogPorts(handler: ErrorHandler): LogPorts;

// apps/functions/src/wire/triggers.wire.ts (RETRY)
// onRefused: called once per refused side (main.ts binds it to root.edge.log 'malformed document refused')
export function decodeRebuildBusyEvent(event: …, onRefused?: (error: RepositoryError) => void): Result<RebuildBusyCommand, RepositoryError>;
export function decodeDispatchProjectionsEvent(event: …, onRefused?: (error: RepositoryError) => void): Result<ProjectClientStatsCommand, RepositoryError>;
export function projectionReport(
  result: Result<{ readonly attemptFailure: AttemptFailure | null }, RepositoryError>,
): AttemptReport;  // widened from ClientStatsProjection; body unchanged
```

---

## 3. Packages — disjoint file ownership

Three packages run in parallel against `36bbac9`. A file belongs to exactly
one package; where another package needs an edit in it, the owner makes it
(named under "edits for others"). Contracts of §2 are the interface between
them: write against the signatures, the integrator compiles the union.

### 3.1 GUARD — ecs-core guards + every read site (web + functions, not triggers)

**Files (exact):**

- `libs/ecs-core/src/primitives/stored-fields.data.ts` (NEW), `stored-fields.data.spec.ts` (NEW), `index.ts`
- `libs/ecs-core/src/primitives/tag.data.ts` (+ `tag.data.spec.ts` new cases)
- `libs/ecs-core/src/primitives/local-date.primitive.ts`, `minute-of-day.primitive.ts`, `utc-epoch-ms.primitive.ts`, `duration-minutes.primitive.ts`, `price-cents.primitive.ts`, `currency.primitive.ts`, `ids.primitive.ts`, `busy-key.primitive.ts` (+ each `*.primitive.spec.ts`: new cases)
- `libs/ecs-core/src/components/minute-range.data.ts`, `time-coordinate.data.ts`, `booking-lifecycle.data.ts`, `booking-contact.data.ts`, `stood-seat-pairs.data.ts`, `service-terms.data.ts`, `seat-occupant.data.ts`, `seat-outcome.data.ts`, `seat.data.ts`, `minute-block.data.ts` (+ their `*.data.spec.ts`: new cases; `seat-occupant.data.spec.ts` NEW if absent)
- `libs/ecs-core/src/systems/stored-document.system.ts` (NEW), `stored-document.system.spec.ts` (NEW), `index.ts`
- `libs/ecs-core/src/testing/identity.fixtures.ts` (NEW `customerFixture(overrides: Partial<Customer> = {}): Customer` — `@core/testing` has no `Customer` builder today, only the id helper `customerOf`; the barrel's `export *` already re-exports the file) + `identity.fixtures.spec.ts` (one new case: the fixture passes `StoredDocumentSystem.customer`)
- `libs/ecs-core/src/errors/repository.error.ts` (JSDoc only), `libs/ecs-core/src/ports/tx.port.ts` (JSDoc only)
- `apps/functions/src/adapters/firestore-tx.adapter.ts` (+ `firestore-tx.adapter.spec.ts` new cases)
- `apps/functions/src/adapters/firestore-schedules.adapter.ts` (+ spec), `firestore-jobs.adapter.ts` (+ spec), `firestore-ports.ts` (+ `firestore-ports.spec.ts` new case)
- `libs/infrastructure/firestore/src/lib/observe.ts` (+ `observe.spec.ts`), `appointments.adapter.ts` (+ spec), `customers.adapter.ts` (+ spec), `scheduling.adapter.ts` (+ spec), `firestore.adapters.ts`
- `libs/infrastructure/firebase-app/src/lib/error-handler-log.adapter.ts` (NEW), `error-handler-log.adapter.spec.ts` (NEW), `libs/infrastructure/firebase-app/src/index.ts`
- `apps/web/src/app/app.config.ts`
- `tools/seed/seed-data.spec.mjs` (one new case)

**Brief.**

1. **Primitives.** Add the non-allocating `is` doors of §2.1 beside each
   smart constructor — no `Result`, no string slicing (`LocalDate.isAt` reads
   digits with the file's `digitAt` and checks the month and the day of
   month against the proleptic Gregorian leap rule), no `trim()` (scan for a
   non-whitespace code unit, `indexOf('/')`). The `as` cast stays in each
   primitive's own file (the predicate's return type is the narrowing; no
   cast is needed). `Currency.is` accepts only a KNOWN code exactly as stored.
   `UtcEpochMs.MAX` exports the file's existing `MAX_UTC_EPOCH_MS` as a brand
   (the cast stays in the file).
   Rewrite `Tag.has` as `for (const key in d) if (d[key] === raw) return true`
   (same answers; `as const` literals have no inherited enumerable keys).
   `StoredFields` in its own `*.data.ts` (type + companion with `isRecord`).
2. **Components.** Add `fieldFault` per §2.2 to each companion, checks per
   D-1's tables, in field-declaration order, returning the FIELD NAME (a
   string literal — no allocation) or `null`. Composition, never a second
   copy of a check (Law 1): `MinuteRange.fieldFault` owns the minute pair
   and `start < end`; `TimeCoordinate.fieldFault` and `MinuteBlock.fieldFault`
   call it; `StoodSeatPairs.fieldFault` owns its two fields; `Seat.fieldFault`
   checks `SeatCore`'s fields itself and then calls `ServiceTerms.fieldFault`,
   `SeatOccupant.fieldFault`, `SeatOutcome.fieldFault`. `BookingLifecycle`
   and `SeatOutcome` narrow on their discriminator with `===` against the
   dictionary members, then check the variant's stamp. Siblings import each
   other with `./` (Law 8); no companion imports a system.
3. **System.** `stored-document.system.ts` per §2.3 and D-1: the `*Fault`
   halves walk the root fields in a fixed order (appointment: `id`,
   `locationId`, `TimeCoordinate.fieldFault`, `BookingLifecycle.fieldFault`,
   `busyKeys`, `barberIds`, `subjectUserIds`, `subjectCustomerIds` (absent /
   `null` / array of ids), `seats` (index-built reason `seats[i].<field>`
   only on failure), the three record arrays, `StoodSeatPairs.fieldFault`,
   `revision`, `bookedFromAppointmentId`, the two stamps,
   `BookingContact.fieldFault`; customer: no search mirrors); `salvage` per
   D-1 (the doc's own arrays when every element passes, else one
   module-level empty-array constant, never mutated); the Result halves wrap them:
   `fault === null ? Result.ok(doc as unknown as Appointment) :
Result.err(RepositoryError.malformed(`${Collections.Appointments}/${doc.id}`, fault))`.
   The JSDoc states the field rule (iterated / narrowed / computed on →
   checked), lists the unchecked fields and why, and names the subject
   mirrors as the one admitted-may-differ-from-type field (D-1). `guardOf` is a
   `switch` on the collection name over `Collections` (entities tier — allowed
   for systems). Pure: no I/O, no clock, no mutation.
4. **Functions transaction.** `firestoreReadTx(db, tx, guardOf, onRefused)`:
   after building `{ id, ...data }`, look up `guardOf(path[0])` when
   `path.length === 2` (`spec.collection.length === 1` for a query); a
   refusal calls `onRefused(error)` and answers `null` (`get`/`getAll`
   position kept) or leaves the row out (`query`). `firestoreCommitPlan(db,
guardOf, log)`: per attempt `let refused: RepositoryError | null = null`, the
   read half built with `(e) => { refused ??= e; }`, and after `await
read(…)`: `if (refused !== null) { log('error', 'malformed document
refused', { path: refused.path, field: refused.reason }); return
Result.err(refused); }` — before `decide`, before any write; one line per
   commit, never per document read. The file's header JSDoc gains the rule.
5. **Functions singles and the walk.** `firestoreSchedulePorts(db, guardOf,
log)`: `loadOne` runs `guardOf(collection)` on a present document —
   refusal → logged once (D-4) → `Result.err`. `firestoreJobPorts(db,
guardOf, log)`: `pageAppointments` runs the appointment guard over every
   row; the FIRST refusal is logged and answers the page's `Result.err` (D-3
   walk rule; JSDoc says why). `firestore-ports.ts`: pass
   `StoredDocumentSystem.guardOf` and `telemetry.log` to
   `firestoreCommitPlan`, `firestoreSchedulePorts`, `firestoreJobPorts`
   (JSDoc: the only production construction site, so no Firestore read of
   the three collections is unguarded or unlogged).
6. **Web shared reads.** `observe.ts` per §2.5: `ReadGuard`, `UNGUARDED`,
   `guardedReads`, `admitted` (single rule: refusal → report `'malformed
document refused'` once → `Result.err`), `ListAdmission`, `keepAdmitted`
   (DROP: drop → report `'malformed document dropped'` once per path in
   `reported`, and `err` with the first refusal when `docs.length > 0` and
   none is kept — the systemic rule; REFUSE: report and `err` on the first
   bad row; the answer is a `Result`); the list helpers take
   `admission = ListAdmission.DropMalformed`; the
   four helpers take `guard = UNGUARDED`, dispatch on the collection (the
   doc ref's path minus its last segment; a query's `path` argument), and a
   live single flattens `live<Result<E | null, RepositoryError>>` with `map`.
   The module JSDoc's "no field is … dropped here" paragraph is rewritten to
   the guard rule (zero mapping kept: an admitted document is the same object).
7. **Web adapters.** `appointmentReadPorts(db, guard)`: pass `guard` to every
   `observeDoc`/`observeQuery`/`readQuery` EXCEPT the three queries of
   `pageOf`, which read unguarded and run `keepAdmitted` over the page's rows
   after `PagingSystem` cut them (one `reported` set per `pageClientHistory`
   call). `observeUpcoming` passes `ListAdmission.RefuseMalformed` (c1db661's
   posture); every other list the default. `pageOf`'s first page adds
   `where('utcEpochMs', '<=', UtcEpochMs.MAX)` (`beforeUtcMs === null`; the
   later pages' `<` bound unchanged), so Firestore's numbers-only range
   filter keeps a non-numeric / `NaN` `utcEpochMs` out of the read and the
   cursor is always an instant (such a row was never orderable — it cannot
   be reported, the JSDoc says so); a fractional or negative numeric one
   orders as a number, cuts correctly and is then dropped by the guard. `customerPorts(db, guard)`: the `limit 1` query unguarded, the row
   through `admitted`. `schedulingReadPorts(db, guard)`: `observeBusyDay`
   gets `guard` (the other five members unchanged). `firestore.adapters.ts`:
   `export { guardedReads, type ReadGuard } from './observe';`.
8. **Web report channel.** `error-handler-log.adapter.ts` per D-4 / §2.5
   (one `handleError` per `log` call, a plain `Error` named `DATA_LOG_ERROR`,
   `cause: { ...fields }`); export it from the firebase-app index (type-only
   import of `LogPorts`, so the eager chunk gains no ecs-core runtime).
9. **Wiring.** `app.config.ts`: the `SCHEDULING_READ_PORTS`,
   `APPOINTMENT_READ_PORTS` and `CUSTOMER_PORTS` factories pass
   `m.firestore.guardedReads(errorHandlerLogPorts(inj.get(ErrorHandler)))`
   as the second argument (`ErrorHandler` from `@angular/core`).
10. **Seed proof.** `tools/seed/seed-data.spec.mjs`: one case — every seeded
    appointment, customer and busy-day entity passes its
    `StoredDocumentSystem` guard (`Result.ok`, same object).

**Edits for others (GUARD makes them in its files):**

- `app.config.ts`, for NOTE: the `APPOINTMENT_NOTE_PORTS` binding's `methods`
  gains `updateAppointmentNote: LazyMethod.Promise` (the lazy-port type
  refuses the binding without it once NOTE's port lands).

**Must not:** add an error code; touch triggers, `main.ts`, the trigger
pipelines, `busy.system.ts`, the notes files; change any existing spec's
assertion (new cases only — a partial-body fixture keeps reading as today
through the default) EXCEPT the one FORCED pin of §4.1
(`appointments.adapter.spec.ts:208`, the first page's constraints gain the
`utcEpochMs <=` bound).

### 3.2 RETRY — trigger options, the allowlist and its checks, decisive/transient handling

**Files (exact):**

- `apps/functions/src/main.ts`, `apps/functions/src/main.spec.ts`
- `apps/functions/src/wire/triggers.wire.ts`, `apps/functions/src/wire/triggers.wire.spec.ts`
- `libs/ecs-core/src/systems/trigger-attempt.system.ts`, `trigger-attempt.system.spec.ts`
- `libs/ecs-core/src/pipelines/rebuild-busy.pipeline.ts`, `rebuild-busy.pipeline.spec.ts`
- `libs/ecs-core/src/pipelines/match-waitlist.pipeline.ts`, `match-waitlist.pipeline.spec.ts`
- `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.spec.ts` (SPEC ONLY — one rerun case; the pipeline untouched)
- `libs/ecs-core/src/systems/busy.system.ts` (`affectedKeys`'s defaulted third parameter only), `busy.system.spec.ts` (new cases)
- `apps/functions/src/integration/match-waitlist.integration.spec.ts` (the answer-shape assertion at `:205` only)
- `apps/functions/src/integration/project-client-stats.integration.spec.ts` (`replayTrigger`, `:382-391` only — FORCED: the decoder answers a `Result`; `expect(command.ok).toBe(true)`, then `project(command.value)` behind an `if (command.ok)` narrowing)

**Brief.**

1. **The verdict.** `TriggerAttemptSystem`: `judgedCode` judges a
   `RepositoryError` with `errorCode === RepositoryErrorCode.Malformed` by
   `DATA_LOSS_CODE = 'data-loss'` (exported member), every other refusal by
   its `reason` as today, a throw by its own code as today. `TRANSIENT_CODES`
   unchanged (D-5.3). JSDoc: the allowlist, its web twin, the malformed rule.
2. **`rebuildBusy`.** Keep going past a failed day: a commit rejection
   (`catch`) and a commit refusal (`!committed.ok`) are each logged
   (`'barberBusy rebuild failed'`, `{ key, error }`, as today) and pushed to
   `failures`; the day is not in `rebuiltKeys`. Answer `{ rebuiltKeys,
failures, attemptFailure: TriggerAttemptSystem.decisiveFailure(failures)
}`. The zone read's refusal stays the pipeline's `Result.err` (nothing
   rebuilt). `RebuildBusyCommand` gains `salvagedKeys` and
   `salvagedLocationId` (§2.4): keys = `BusySystem.affectedKeys(cmd.before,
cmd.after, cmd.salvagedKeys)`; the zone's location = `(cmd.after ??
cmd.before)?.locationId ?? cmd.salvagedLocationId` (`null` → the zone
   read's existing refusal). `busy.system.ts`: `affectedKeys` gains the
   defaulted third parameter `salvaged: readonly BusyKey[] = []`, unioned
   into the same distinct, sorted scan (existing callers and specs
   unchanged). Header JSDoc: idempotent recompute, why a redelivery is safe,
   why a refused side's keys are safe to rebuild (the transaction re-reads
   the day).
3. **`matchWaitlist`.** Both loops (`settle` per request; `retireLapsed`'s
   `expire`) push each request's rejection or refusal to `failures` (still
   logged `'waitlist match failed'` as today) and the answer gains
   `failures` and `attemptFailure` (`decisiveFailure`). `loadDay`
   (`:203-212`): a barber whose busy day answers `REPOSITORY_MALFORMED` is
   SKIPPED — logged `'waitlist barber skipped'` (`{ key, error }`), none of
   their time offered, the other barbers matched (fail-closed per barber,
   DEP-13); any other refusal of `loadBusyDay` still returns it. Every other
   path (zone, policy, open requests) keeps answering its `Result.err`; the
   early returns answer `failures: [], attemptFailure: null`.
4. **The wire.** `triggers.wire.ts`: `entityOf` becomes the guarded
   `storedSide(snapshot, id, guard: (doc: StoredDocument) => Result<E,
RepositoryError>): Result<E | null, RepositoryError>` — **the GUARD rule
   at the trigger read (D-3), side by side:** `decodeRebuildBusyEvent(event,
onRefused = () => undefined)` and `decodeDispatchProjectionsEvent(event,
onRefused = …)` run `StoredDocumentSystem.appointment` on each present
   side SEPARATELY. An admitted side is the entity; a refused side calls
   `onRefused(error)` once, becomes `null`, and contributes
   `StoredDocumentSystem.salvage(raw)`. Busy: `salvagedKeys` = the refused
   sides' salvaged `busyKeys` (concatenated; the system dedups),
   `salvagedLocationId` = the first refused side's salvaged `locationId`;
   answer `Result.err(first refusal)` only when a side was refused AND
   `BusySystem.affectedKeys(before, after, salvagedKeys)` is empty. (As
   fixed after the review, §8.6: these combination rules moved past the
   edge — `StoredDocumentSystem.appointmentSide` / `salvageSides` guard and
   merge, `rebuildBusy` answers the command's `refusal` over its one
   `affectedKeys`, and `ClientStatsSystem.dispatchSubjects` owns the
   dispatch rule below; the decoders only guard, report and forward.)
   Dispatch: subjects are read through `salvage` on EVERY present side
   (admitted or refused — an admitted legacy side may hold an absent / `null`
   mirror, D-1); when no side was refused, as today (`statsInputChanged`
   first); when a side was refused the change test is skipped (a refused
   side cannot be compared; the recompute is idempotent) and `customerIds` =
   `affectedSubjects` over both sides' subjects; `Result.err(first refusal)`
   only when that set is empty. (The `PolicyRecomputeJob` side of
   `decodePolicyStepEvent` keeps the unguarded read.) `projectionReport` widens its parameter to `Result<{ readonly
attemptFailure: AttemptFailure | null }, RepositoryError>` (body
   unchanged). Header JSDoc: which triggers retry and how a decoder refuses.
5. **`main.ts`.** The three exports become `onDocumentWritten({ document:
…, retry: true }, retryingTrigger({ fn: '<export name>', timeoutSeconds:
null }, root.edge, async (event) => …))`:
   - every decoder call passes `onRefused: (e) => root.edge.log('error',
'malformed document refused', { path: e.path, field: e.reason })` (D-4).
   - `rebuildBusyOnAppointmentChange`: `const cmd = decodeRebuildBusyEvent(event, onRefused);
const answer = cmd.ok ? await rebuildBusy(root.ports())(cmd.value) : cmd;
settleAttempt(fn, event, projectionReport(answer), root.edge);`
   - `rebuildCapacityOnBusyChange`: `rebuildCapacityFrom(CapacitySource.BusyDay,
event.params)` inside `retryingTrigger` (its `failOnRefusal` throw is
     judged there); the four other capacity triggers and the sweep unchanged.
   - `matchWaitlistOnBusyChange`: `cmd === null` returns; else
     `settleAttempt(fn, event, projectionReport(await matchWaitlist(root.ports())(cmd)), root.edge)`.
   - `dispatchClientProjections` (already retrying): a decoder refusal goes
     to `settleAttempt` as `projectionReport(cmd)`; otherwise as today.
     The composition-root JSDoc's "the options … are the ones the legacy
     definitions declared" gains the three flips (edge-hardening D-5).
6. **`main.spec.ts`.** `ENDPOINTS`: the three rows `written(…, true)`. The
   seam answers of `rebuildBusy` and `matchWaitlist` gain `failures: [],
attemptFailure: null` (their handlers now read the verdict). The case
   "fails a non-retrying trigger on a store failure, and lets a retrying one
   …" keeps its intent with `rebuildCapacityOnRosterChange` as the
   non-retrying example. New cases per §4.2.

**Edits for others:** none. RETRY depends on GUARD's
`StoredDocumentSystem.appointment` / `salvage` / `StoredDocument` /
`StoredSalvage` (§2.3) — write against
the contract; it compiles at integration.

**Must not:** widen `TRANSIENT_CODES`; rethrow outside `retryingTrigger`;
touch `rebuild-capacity.pipeline.ts` (its spec gains a case, nothing else),
the four other capacity triggers, the sweeps, `edge.ts`; change
`busy.system.ts` beyond `affectedKeys`'s defaulted parameter.

### 3.3 NOTE — the notes port, the web adapter, the pipeline, the store

**Files (exact):**

- `libs/ecs-core/src/ports/notes-photos.port.ts`
- `libs/ecs-core/src/pipelines/append-team-note.pipeline.ts`, `append-team-note.pipeline.spec.ts`
- `libs/infrastructure/firestore/src/lib/appointment-notes.adapter.ts`, `appointment-notes.adapter.spec.ts` (NEW)
- `libs/infrastructure/firestore/src/testing/fake-firestore.ts`
- `libs/features/staff/dashboard/src/lib/staff-day.store.ts`, `staff-day.store.spec.ts`
- `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts`

**Brief.**

1. **Port.** `UpdateAppointmentNote` per §2.4, JSDoc: the transaction is the
   sandwich, `decide` is pure and may run more than once, `null` writes
   nothing, every failure (offline included) is `RepositoryError`, nothing
   written. Join it to `AppointmentNotePorts`.
2. **Adapter.** `updateAppointmentNote` per D-6 over `runTransaction`
   (imports `runTransaction` and `entityOf`, `writeFailed` from
   `./observe`); the module JSDoc gains the append's transaction and the
   offline answer.
3. **Pipeline.** `appendTeamNote` per D-6 (no `rxjs` import left);
   `noteRecord` stays the one module-private builder; the JSDoc's numbered
   steps become: blank → `ok(null)`; the instant read once; one
   transaction deciding with `VisitSidesSystem.appendedNote` + `noteRecord`;
   the answer is the note written, or the transaction's failure — offline it
   refuses, never overwrites. `saveTeamNote` untouched.
4. **Fake.** `fake-firestore.ts` `runTransaction` becomes optimistic like
   the SDK: it records the path and a per-path write VERSION of every
   `transaction.get`, and at commit re-runs `update` (fresh reads, pending
   writes discarded) when a read path's version moved, up to 5 attempts,
   then rejects `{ code: 'aborted' }`. `FakeFirestore` keeps a `Map<string,
number>` of versions bumped by `set`/`delete`/`commit`. One attempt with
   no interleaved write behaves exactly as today (the scheduling specs stay
   green).
5. **Store.** `StaffDayStore.appendTeamNote`: code unchanged; JSDoc says one
   transaction, a concurrent edit is appended below, offline refuses (the
   sheet says so).
6. **Specs** per §4.3 — the dashboard's cancel-note cases are REWIRED onto
   `updateAppointmentNote` with their intent and assertions kept (the words
   appended once, `timeline` order, the failure notice); the stubs that
   provide `APPOINTMENT_NOTE_PORTS` gain the new member.

**Edits for others:** GUARD adds `updateAppointmentNote: LazyMethod.Promise`
to the `APPOINTMENT_NOTE_PORTS` binding in `app.config.ts` (§3.1).

**Must not:** change `saveTeamNote`, `observeAppointmentNote`,
`saveAppointmentNote`, the store's public signature or the dashboard
component; guard `appointmentNotes` bodies (OQ-2).

---

## 4. Specs per package

New cases only, except the forced edits named. Every system spec carries the
purity contract (`deepFreeze`, same input → same output, inputs untouched).

### 4.1 GUARD

- **Primitive doors** (each `*.primitive.spec.ts`): `X.is(raw) ===
constructor(raw).ok` over a table drawn from the constructor's OWN input
  domain (strings for a `parse(raw: string)`: valid, blank, padded, `/`,
  off-by-one; numbers for a numeric constructor: valid, boundary,
  off-by-one, `NaN`, `±Infinity`, `-0`, fractional); and, for every other
  type (`null`, `undefined`, a number for a string door, a string for a
  number door, `{}`, `[]`), `X.is(raw) === false` asserted directly — a
  string constructor is never called with a non-string (it would throw);
  `LocalDate.is` / `isAt` against `parse` on every day of a leap and a common
  year plus `2026-02-30`, `2026-13-01`, `2026-9-28`, full ISO stamps;
  `Currency.is(' eur ')` is `false` while `parse` accepts it (stored form
  only); the id `is` on `''`, `'  '`, `'a/b'`, a non-string; `BusyKey.is`
  equals `BusyKey.parse(x) !== null`.
- **`Tag.has`**: the existing cases unchanged; a case that the scan reads
  members only (an object with an inherited enumerable key is not used — the
  dictionaries are literals).
- **`StoredFields.isRecord`**: records yes; `null`, arrays, strings, numbers no.
- **Component `fieldFault`** (each `*.data.spec.ts`): the fixture slice →
  `null`; each field broken in turn → that field's name; a variant's stamp
  missing → the stamp's name; purity. `minute-range.data.spec.ts`: equal or
  inverted minutes → `'endMinutes'`; `time-coordinate` / `minute-block`: an
  inverted range answers what `MinuteRange.fieldFault` answers (composed, not
  re-checked); `stood-seat-pairs.data.spec.ts`: `StoodSeatPairs.NONE` →
  `null`, a negative / fractional revision → `'stoodSeatPairsRevision'`, a
  non-array or a non-record element → `'stoodSeatPairs'`.
- **`stored-document.system.spec.ts`**: `appointmentFixture()`,
  `customerFixture()` (NEW in `identity.fixtures.ts`, this package) and
  `barberBusyDayFixture()` (from `@core/testing`) →
  `ok` with `value` BE (`toBe`) the input object; one case per checked field
  of D-1's tables → `err({ errorCode: 'REPOSITORY_MALFORMED', path:
'appointments/<id>', reason: '<field>' })`, seat/block reasons with their
  index; the subject mirrors deleted or `null` → still `ok` (the backfill's
  legacy rows), a subject mirror that is a string or holds a `''` / number
  element → `err` naming it; the unchecked fields deleted (`ownerUserId`,
  `ownerCustomerId`, `placement`, `inferredPlacement`, a customer's
  `searchName` / `searchPrefixes`) → still `ok`; `salvage`: a well-formed
  doc → its own `busyKeys` / `subjectCustomerIds` arrays (`toBe`) and its
  `locationId`; a refused doc with a good `busyKeys` and a broken `seats` →
  the keys; a non-array or a bad element → `[]`; absent / `null` subjects →
  `[]`; `guardOf`
  answers a guard for the three collections and `null` for `users`,
  `appointmentNotes`, `barberBusy/x/sub`; `unguarded` answers `null`;
  purity; an allocation proxy — the `*Fault` halves answer `null` on 1,000
  fixtures without building a string (assert via a frozen input and the
  `null` answer; no wall-clock thresholds).
- **`firestore-tx.adapter.spec.ts`** (guarded commit built with
  `StoredDocumentSystem.guardOf` and a recording `log`): a malformed
  `appointments/a1` read with `get` → the commit answers
  `REPOSITORY_MALFORMED` (path, field), `decide` never called, nothing
  written, and ONE `'malformed document refused'` line `{ path, field }`; the same through `getAll` (the other
  positions irrelevant) and `query`; the FIRST refusal wins; a malformed
  `users/u1` (unguarded) reads as today; a well-formed appointment reads as
  `{ id, ...body }` — the same object `decide` receives; contention re-run
  starts clean (a malformed read on attempt 1 that a concurrent repair fixes
  before attempt 2 → the decision runs). The existing cases unchanged
  (default unguarded).
- **`firestore-schedules.adapter.spec.ts`** (guarded): a malformed busy day
  → `err` + one log line; a valid one → `ok` as today.
  **`firestore-jobs.adapter.spec.ts`** (guarded): a page with a malformed row
  → `err` naming it + one log line; a clean page as today.
- **`firestore-ports.spec.ts`**: the assembled `commit` refuses a malformed
  appointment, `loadBusyDay` a malformed busy day, `pageAppointments` a
  malformed page — the root passes the guard — and each refusal reaches the
  telemetry `log` with `{ path, field }` (the root passes `telemetry.log`).
- **`observe.spec.ts`**: `admitted` → `ok(doc)` same object / `err` +
  one report; `keepAdmitted` drops and reports each path once across two
  calls with the same set; **systemic rule:** every row malformed → `err`
  naming the first path and field, one of many malformed → a drop (`ok` with
  the rest), an EMPTY read → `ok([])` (nothing dropped, nothing refused);
  `RefuseMalformed` → `err` on one bad row among good ones; a live guarded
  single emits `err` then `ok` after the document is fixed (listener kept); a
  live guarded list drops the bad row on every snapshot, reports it once.
- **`appointments.adapter.spec.ts`** (with `guardedReads(recording log)` and
  full fixtures): `observeBarberDay` with one malformed visit answers the
  others, sorted, and logs `{ path, field }` once over two snapshots; a
  barber day whose every visit is malformed emits `err` (never an empty
  day); `observeHistory` drops like the day; `observeUpcoming` with one
  malformed booking among good ones emits `err(REPOSITORY_MALFORMED)`
  (strict) and reports it; `observeAppointment` emits `err`;
  `pageClientHistory` with a malformed row on page one: the page holds the
  others, `nextBeforeUtcMs` is the cursor the RAW rows give (the history
  continues), the bad row reported; **a row with `utcEpochMs: 'x'`** (and
  one with `NaN`) on page one: page one holds the numeric rows, page two
  continues below the cursor and the history reaches the oldest visit;
  `searchAppointmentWindow` drops it from its half. FORCED: the pin at
  `:208` gains `'utcEpochMs <= 253402300799999'` (the first page's numeric
  bound) between the `array-contains` and the `orderBy` constraint — the
  intent (one read, those constraints, `limit 11`) kept. **`customers.adapter.spec.ts`**: the `limit 1` row malformed →
  `err`, never `ok(null)`. **`scheduling.adapter.spec.ts`**:
  `observeBusyDay` malformed → `err`, then `ok` after a fix.
- **`error-handler-log.adapter.spec.ts`**: one `log` → one `handleError`
  with a plain `Error` named `'DataLog'`, the message, `cause` equal to the
  fields; never throws.
- **`tools/seed/seed-data.spec.mjs`**: every seeded appointment / customer /
  busy day passes its guard.

### 4.2 RETRY

- **`trigger-attempt.system.spec.ts`**: a `RepositoryError.malformed(path,
'aborted')` is judged `data-loss`, PERMANENT (the reason never decides);
  `decisiveFailure([malformed, unavailableRefusal])` is the transient one;
  every existing case unchanged; purity.
- **`rebuild-busy.pipeline.spec.ts`**: day 1's commit rejects `aborted`,
  day 2 commits → `rebuiltKeys` = day 2, `attemptFailure` TRANSIENT, the
  failure logged; day 1 refused `REPOSITORY_MALFORMED` → `attemptFailure`
  PERMANENT (`data-loss`); **rerun idempotence:** the same command run twice
  over `memoryTxPorts` writes the identical plan and leaves the identical
  store (the `barberBusy` body and the delete of an emptied day); the
  existing `toEqual` answers gain `failures: [], attemptFailure: null`
  (FORCED); the existing commands gain `salvagedKeys: [], salvagedLocationId:
null` (FORCED by the type); the existing "a failed day … goes on to the
  edge" case becomes "is logged, the next day still rebuilt, the verdict
  answered" (FORCED, DEP-5); **salvage:** `before: null, after: null,
salvagedKeys: [K], salvagedLocationId: L` rebuilds K (the deleted
  malformed visit frees its day) with the zone of L.
- **`busy.system.spec.ts`**: `affectedKeys(before, after, salvaged)` unions
  the salvaged keys, distinct and sorted; the two-argument calls unchanged;
  purity.
- **`rebuild-capacity.pipeline.spec.ts`** (spec only): **rerun
  idempotence** — the same Day command run twice over the in-memory tx ports
  produces identical plans and an identical `capacity/{YYYY-MM}` document.
- **`match-waitlist.pipeline.spec.ts`**: request A's commit rejects
  `unavailable`, request B notified → `notifiedRequestIds: [B]`,
  `attemptFailure` TRANSIENT; a permanent refusal → PERMANENT; **rerun:** the
  second delivery over the same store notifies nobody new (B is `MATCHED`;
  A, retried, is notified once); the existing `toEqual` answers gain the two
  fields (FORCED); **per-barber skip:** barber 1's busy day refused
  `REPOSITORY_MALFORMED`, barber 2's well-formed → a request only barber 1
  could serve is not notified, one only barber 2 can serve is, the skip is
  logged, `attemptFailure` `null`; barber 1's day refused `unavailable` →
  the pipeline's `Result.err` as today.
- **`match-waitlist.integration.spec.ts:205`**: the answer gains the two
  fields (FORCED).
- **`project-client-stats.integration.spec.ts:382-391`** (`replayTrigger`):
  the decoder's answer is unwrapped — `expect(command.ok).toBe(true)`, then
  `project(command.value)` (FORCED by the `Result` type; under
  `test:emulator`, named in the hand-back's integration-case note).
- **`triggers.wire.spec.ts`**: `decodeRebuildBusyEvent` /
  `decodeDispatchProjectionsEvent` on the fixture sides → `ok(command)` (the
  existing expectations wrapped in `ok`, and the busy command's two salvage
  fields `[]` / `null`, FORCED by the return type); per side, with a
  recording `onRefused`: **malformed before** (`seats[0].startMinutes:
'ten'`, `busyKeys` intact) + well-formed after on another day → `ok`
  with the after entity, `before: null`, `salvagedKeys` = the before's keys
  (so both days rebuild), `onRefused` called once with `appointments/<id>`,
  `seats[0].startMinutes`; **malformed before + absent after** (a deletion)
  → `ok`, `salvagedKeys` = the old day, `salvagedLocationId` = its location;
  **malformed after + well-formed before** → `ok`, the before's keys plus
  the after's salvage; **a malformed side whose `busyKeys` is garbage, the
  other absent** → `err(REPOSITORY_MALFORMED)`; dispatch: malformed before +
  well-formed after → `ok` with both sides' subjects (no change test), a
  legacy after with `subjectCustomerIds` deleted → `ok` (read as `[]`, no
  `TypeError`), both sides refused with no salvageable subject → `err`;
  `projectionReport` over a `RebuildBusyAnswer` and a `MatchWaitlistAnswer`.
- **`main.spec.ts`**: `ENDPOINTS` rows (FORCED); seam answers (FORCED); per
  trigger — a transient refusal (`readFailed(…, 'unavailable')`) REJECTS and
  logs one attempt line `{ fn: '<export>', outcome: 'TRANSIENT' }`; a
  malformed refusal RESOLVES and logs `{ outcome: 'PERMANENT', errorCode:
'data-loss' }`; an answer with `attemptFailure` transient rejects, permanent
  resolves; `rebuildBusyOnAppointmentChange` with a malformed `after` side
  whose `busyKeys` is garbage and no `before` resolves, logs ONE `'malformed
document refused'` line `{ path, field }` plus the PERMANENT attempt line,
  and never runs the pipeline; with a malformed `before` and a well-formed
  `after` it runs the pipeline over the after's AND the before's keys and
  logs the refusal line; `dispatchClientProjections` the same pair.

### 4.3 NOTE

- **`append-team-note.pipeline.spec.ts`** (FORCED rewrite of the append
  cases onto an in-memory `updateAppointmentNote` double — each intent kept):
  files the words trimmed, stamped with the author and the clock; appends
  below a stored note; blank words read and write nothing (`decide` never
  called); **a concurrent edit:** the double calls `decide` with stored note
  A, then (contention) with the fresher A′ a concurrent writer left — the
  written text is `appendedNote(A′, line)`, never `appendedNote(A, line)`,
  so the concurrent words survive; **offline:**
  the double answers `writeFailed(path, 'unavailable')` without calling
  `decide` → the pipeline answers it, nothing written; `decide` is pure (same
  stored → same note; the stored note untouched, `deepFreeze`); the clock is
  read once per append, before the transaction; the key-order case pins
  `noteRecord` for both pipelines; the `saveTeamNote` cases unchanged.
- **`appointment-notes.adapter.spec.ts`** (NEW, `FakeFirestore`): no note →
  `decide(null)`, the record `Set` minus its id; a stored note → `decide`
  gets `{ id, ...body }`; `decide` → `null` writes nothing, answers
  `ok(null)`; **a concurrent edit** (the first `decide` call writes the
  document through `fake.set` — the fake's version moves — the transaction
  re-runs and the second `decide` sees the concurrent text; the stored result
  holds both); **offline** (`fake.failWith({ code: 'unavailable' })`) →
  `err(REPOSITORY_WRITE_FAILED, reason 'unavailable')`, the document
  unchanged, and a rejection with another code (`deadline-exceeded`) maps
  the same way (no code is special-cased, D-6); contention exhausted → `err(…, 'aborted')`; an id that is not
  the ref's is a defect.
- **`fake-firestore.ts`** behaviour is proved through the adapter spec above
  and the unchanged scheduling transaction specs.
- **`staff-day.store.spec.ts`**: the `satisfies AppointmentNotePorts` stub
  gains `updateAppointmentNote` (FORCED); a case: `appendTeamNote` answers
  `false` when the port answers `writeFailed(…, 'unavailable')`.
- **`staff-dashboard.spec.ts`**: `wireNotes()` stubs `updateAppointmentNote`
  (calls `decide` over the stored text, pushes `'note'` to `timeline` and the
  written note to `saved`) — FORCED rewiring; "writes over nothing it could
  not read" becomes "an append that cannot reach the server saves nothing and
  says so" (`saved` empty, `staff.day.cancelNoteFailed`); the once-per-sheet
  and timeline cases keep their assertions; the `:827` provider gains the
  member.

---

## 5. DEPARTURES (behaviour that changes)

- **DEP-1 — malformed documents refused on single and transactional reads.**
  A malformed `appointments` / `customers` / `barberBusy` document now
  answers `REPOSITORY_MALFORMED` (path + field) where it used to enter as a
  typed entity: every callable whose transaction reads it (book, reschedule,
  edit, cancel, transition, arrival, tip, registration) refuses with its
  store-failure answer and writes nothing; a web single (`observeAppointment`,
  `observeBusyDay`, `loadCustomerForUser`) emits the error (the booking grid
  shows that barber-day as unreadable — fail-closed).
- **DEP-2 — malformed documents dropped from staff lists, and reported to
  the device console.** `observeBarberDay`, `observeHistory`,
  `pageClientHistory`, `searchAppointmentWindow` answer the well-formed rest;
  each drop is ONE `ErrorHandler` report, which today reaches only the
  console of that device (no custom `ErrorHandler`, D-4) — not the shop, not
  telemetry. When the WHOLE answer drops rows and keeps none it answers
  `REPOSITORY_MALFORMED` (the systemic rule) — the screen shows its read
  failure, never an empty day; the search's two halves are judged together
  and the history on its first page (a later all-malformed page answers an
  empty page with its cursor — §8.6). `observeUpcoming` errors the whole stream on
  one malformed booking. Against `c1db661`: the same drop / error split list
  for list, plus the report and the systemic rule; the one departure is that
  a busy day is refused whole instead of losing a span.
- **DEP-3 — the backfill stops at a malformed appointment.** `runBackfill`'s
  page answers `REPOSITORY_MALFORMED` naming the document (the call FAILS);
  today it would crash or decide on it. Legacy rows lacking the subject
  mirrors or a placement still pass (unchecked by design) and are repaired.
- **DEP-4 — a malformed trigger side is logged and salvaged, never
  trusted.** `rebuildBusyOnAppointmentChange` and `dispatchClientProjections`
  log the refused side (`'malformed document refused'`, `{ path, field }`)
  and drive the event from the other side plus the refused side's salvaged
  busy keys / subjects / location — so repairing or deleting a malformed
  appointment still frees its old day and re-projects its clients. Only an
  event that yields no usable key / subject at all logs a PERMANENT attempt
  line and does nothing (today: a `TypeError` deep in a system, or a
  projection built on garbage). A malformed side never skips the projection
  dispatch's change test silently: it forces the (idempotent) recompute.
- **DEP-5 — transient trigger failures are now retried.** The three triggers
  deploy `retry: true`: a transient failure (allowlist: `aborted`,
  `unavailable`, `deadline-exceeded`, `resource-exhausted`) rejects and Cloud
  Functions redelivers the event (for the platform's retry window); a
  decisive one is logged and swallowed. `rebuildBusy` no longer stops at the
  first failed day (it rebuilds the rest, then answers the verdict);
  `matchWaitlist`'s per-request transient failures now earn a redelivery
  (today: logged only, the day never re-announced).
- **DEP-6 — answer shapes.** `RebuildBusyAnswer` and `MatchWaitlistAnswer`
  gain `failures` and `attemptFailure`; the trigger decoders answer a
  `Result`.
- **DEP-7 — a malformed refusal is judged `data-loss`.** Its attempt line's
  `errorCode` reads `data-loss` (today a refusal with a field-name reason
  would read as that name, judged permanent anyway — same outcome, a
  truthful code).
- **DEP-8 — an offline append refuses.** `appendTeamNote` with the server
  unreachable answers `REPOSITORY_WRITE_FAILED` (reason: the SDK's rejection
  code — observed `unavailable`, after 7.2 s of the SDK's bounded retries,
  D-6) and writes nothing; the sheet raises `staff.day.cancelNoteFailed` ("the cancellation
  itself stands"). Today it could append to a cached copy and queue a write
  over the server's note. A concurrent edit is appended below, never lost.
- **DEP-9 — the append's stamp is read before the transaction** (the
  instant the append was asked), where today it was read after the note's
  read — the same instant to the millisecond in practice; contention re-runs
  keep the one stamp.
- **DEP-10 — `REPOSITORY_MALFORMED` reused, not a new code** (D-2) — a
  departure from the brief's wording, same contract (path + offending field).
- **DEP-11 — the guards are wired at the composition roots**, the adapters
  defaulting to unguarded (D-7) so the existing mechanics specs read their
  partial fixtures as today; the roots are pinned by specs and §6.2.
- **DEP-12 — `Tag.has` no longer allocates** (same answers).
- **DEP-13 — waitlist matching skips only the barber whose busy day is
  malformed.** Today a malformed busy day enters unchecked; under the
  guard, `loadDay`'s existing `if (!busy.ok) return busy` would refuse the
  whole day — every barber — at the first refused busy day. Instead that
  barber is skipped — none of their time offered (fail-closed per barber),
  the skip logged — and every other barber's free time is still matched.
  Other `loadBusyDay` refusals (`unavailable`, …) still fail the attempt and
  redeliver.
- **DEP-14 — the client history's first page ranges `utcEpochMs <=
UtcEpochMs.MAX`.** Valid histories read the same rows; a document whose
  `utcEpochMs` is not a number is no longer read by the paged history at all
  (Firestore's range filters are type-bounded), so it can never become the
  cursor and end the history early; a `NaN` one sorts below every instant,
  is dropped where it trails the history, and as a page's cursor answers
  `nextBeforeUtcMs: null` (the store refuses a range below `NaN`; §8.2). One existing spec pin
  (`appointments.adapter.spec.ts:208`) is FORCED.
- **DEP-15 — the subject mirrors are checked in their repairable form.** A
  `subjectUserIds` / `subjectCustomerIds` that is neither absent, `null` nor
  an array of ids refuses its appointment (the projection dispatch iterates
  it); absent / `null` still passes for the backfill. A customer's search
  mirrors are not checked (no decision reads them).

---

## 6. Gates

### 6.1 Per package (each before handing back; never the runbook gates, never an emulator journey)

```bash
rm -rf dist/out-tsc
pnpm nx run-many -t typecheck --skip-nx-cache     # baseline: only 'patterns' (section-header.spec.ts findLast)
pnpm nx run-many -t test --skip-nx-cache          # baseline: exactly 6 reds (gauge 4, visit-pills 1, visits-page.presenter 1)
pnpm nx run-many -t lint --skip-nx-cache
pnpm nx run verify-tools:layering
```

A package may scope its runs to the owning projects' `test` targets while
iterating (find the project names with `pnpm nx show projects`; never guess
a flag — `--help` first); the run-many above is the hand-back check. Before the other
packages land, a cross-package reference (RETRY → `StoredDocumentSystem`,
GUARD → `updateAppointmentNote` in `app.config.ts`; RETRY →
`StoredDocumentSystem.salvage` / `StoredSalvage`) is the only allowed
typecheck red, named in the hand-back.

### 6.2 Grep gates (integrator)

```bash
# the roots pass the guards (D-7) and the telemetry log (D-4)
grep -n "StoredDocumentSystem.guardOf" apps/functions/src/adapters/firestore-ports.ts   # 3 hits
grep -c "telemetry.log" apps/functions/src/adapters/firestore-ports.ts                    # ≥ 3
grep -c "logRefusal(root.edge.log" apps/functions/src/main.ts                             # 1 (the decoders' onRefused, through the one phrase — §8.6)
grep -c "guardedReads(" apps/web/src/app/app.config.ts                                   # 3
# the append reads nothing outside its transaction
grep -n "firstValueFrom\|observeAppointmentNote\|saveAppointmentNote" libs/ecs-core/src/pipelines/append-team-note.pipeline.ts   # only saveTeamNote's saveAppointmentNote
# retry flags: 4 before + 3
grep -c "retry: true" apps/functions/src/main.ts                                          # 7
# no handler rethrows outside retryingTrigger; the allowlist not widened
git grep -n "TRANSIENT_CODES" libs/ecs-core/src/systems/trigger-attempt.system.ts         # the four codes unchanged
# no new error code
git grep -n "DOCUMENT_MALFORMED" -- libs apps                                             # empty
# new files are untracked: use grep -r, not git grep, for them
grep -rn "export const StoredDocumentSystem" libs/ecs-core/src/systems/
```

### 6.3 FULL gate (integrator, after the three packages land; HANDOFF §4)

1. `rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache`
   — only `patterns`.
2. `pnpm nx run-many -t test --skip-nx-cache` — exactly the 6 baseline reds.
3. `pnpm nx run-many -t lint --skip-nx-cache`; `pnpm nx run verify-tools:layering`.
4. `pnpm nx build web`; `pnpm nx build functions` (the initial-bundle check:
   `@core/systems` must stay out of the eager chunk — `guardedReads` is
   reached only through `m.firestore`).
5. The runbook grep gates §4.2–§4.9 (`firestore-runbook.md`) — alone, never
   beside a typecheck/lint/test run (they write a transient canary file;
   parameter names may not spell a retired document key).
6. Emulator journeys, ONE AT A TIME: `verify:p0` (all proved — it reads the
   seeded book through the guarded `main.ts` ports); `test:emulator` —
   65 + 253 (plus any integration case a package added, named in the
   hand-back); `e2e:web` — 41 passed + exactly the 19 known failures (6
   `*-screenshots`, `landing.spec.ts:121`, 12 `client-card-glance` runs of
   `:336`/`:679` failing at `:377`/`:758`); the flaky trio
   (`auth-onboarding.spec.ts:106`, `appointments.spec.ts:152`,
   landing-screenshots hero) re-run alone with `--repeat-each=3` via
   `START_LOGGING_EMULATOR=true pnpm exec firebase emulators:exec --only
firestore,auth,functions,storage --project demo-creativo-test "pnpm nx
e2e web -- e2e/<spec> --repeat-each=3"`. A NEW red in a staff-day /
   booking / account journey means a seeded document fails a guard: fix the
   seed (or the guard's table, with a reason), never weaken the rule.
7. Docs (integrator): HANDOFF §2 row + §3.3 — strike "trigger `retry:
true` deferred", record DEP-1…DEP-15 and the open questions; runbook §1.1
   rows untouched unless a gate requires it.
8. **The offline note append, observed once** (integrator, alone, after the
   journeys — it shares the emulator ports): against the Firestore emulator,
   a throwaway script in the scratchpad (never committed) signs in with the
   seeded staff account per the project's preview recipe, calls the web
   adapter's `updateAppointmentNote` with the network disabled
   (`disableNetwork(db)`) on a note the client never read (uncached), and
   records in D-6 and DEP-8: the rejection's code, the delay until it
   arrives, and that the stored note is unchanged after `enableNetwork`. If
   the code is not `unavailable` or the delay exceeds ~10 s, record it and
   raise it as an open question — the guarantee (no overwrite) does not
   depend on either.

---

## 7. Open questions (proceed on the stated default)

> **All seven CLOSED.** OQ-1 and OQ-2 with pass E (E-1, E-2); the other
> five by the owner rulings of 2026-10-26
> (`docs/architecture/decisions/2026-10-26-owner-rulings.md`) — the ruling
> follows each question, the default above it kept as the plan wrote it.
> Two of this plan's choices are reversed with them: DEP-11 / D-7 (the
> unguarded default, OR-33 / DEP-F24) and OQ-7's "out of scope" (OR-2 /
> DEP-F2), which makes D-3's promise true.

- **OQ-1** — the other four capacity triggers (`…OnExceptionChange`,
  `…OnRosterChange`, `…OnLocationChange`, `…OnSettingsChange`) share
  `rebuildCapacity` and are as idempotent; the brief names only the busy one.
  Default: unchanged (no `retry`), a one-line follow-up when the owner wants
  them. **CLOSED by pass E (E-1 / DEP-1):** all four retry through
  `retryingTrigger`.
- **OQ-2** — `appointmentNotes` bodies are not guarded; the append's
  `decide` reads `stored.text`. Default: out of scope (not one of the three
  collections); a `StoredDocumentSystem.appointmentNote` is the follow-up.
  **CLOSED by pass E (E-2 / DEP-2):** guarded at read.
- **OQ-3** — adapters default to unguarded (DEP-11). Alternative: guarded
  by default and the partial-body fixtures of the mechanics specs completed.
  Default: as planned (keeps every existing spec unchanged). **CLOSED —
  OR-33 (DEP-F24):** no default at all — the guard is a required
  parameter; `StoredDocumentSystem.unguarded` moves to `@core/testing` and
  the web `UNGUARDED` to the firestore lib's testing entry, both banned by
  lint outside specs and test support; the integration specs and the seed
  read through the real guard, so a malformed seeded body refuses the seed
  run.
- **OQ-4** — `REPOSITORY_MALFORMED`'s words ("We couldn't save that…") are
  shared by every `REPOSITORY_*` code and read oddly for a read. Default:
  unchanged (copy is the owner's). **CLOSED — OR-54 (DEP-F38):** each code
  is worded for what it means — `REPOSITORY_MALFORMED`: «Този запис е
  повреден и не може да се използва.» / "This record is damaged and can't
  be used." (no "try again": the damage is permanent).
- **OQ-5** — a separate `REPOSITORY_DOCUMENT_MALFORMED` code (DEP-10).
  Default: reuse; mechanical follow-up if wanted. **CLOSED — OR-43:** reuse
  `REPOSITORY_MALFORMED`, no new code — one meaning, one code.
- **OQ-6** — the web report reaches only the device console (D-4). A real
  sink — an `ErrorHandler` provided in `app.config.ts` that forwards
  `DATA_LOG_ERROR` errors to a telemetry endpoint — would let the shop's
  operator see a dropped staff-list row. Default: out of scope (no web
  telemetry service exists to forward to); `errorHandlerLogPorts` is the seam.
  **CLOSED — OR-34 (DEP-F25):** a first-party sink — a `ReportingErrorHandler`
  (the console output kept) and a batching reporter feed the
  `reportClientIssues` callable, which writes closed, allowlisted, scrubbed
  `ClientIssue` structs into Cloud Logging (`DATA_DOCUMENT_DROPPED` /
  `DATA_DOCUMENT_REFUSED` among the kinds); no uid leaves the device.
- **OQ-7** — a worded "1 visit could not be shown" on the staff day for a
  one-of-many drop (the list answer would carry a dropped count the store
  words). Default: out of scope (feature + presenter work in the dashboard,
  owned by no package here); the systemic rule already prevents the
  dangerous case, an empty day that reads as free. **CLOSED — OR-2
  (DEP-F2):** `ObserveBarberDay` answers
  `BarberDayRead { appointments; unreadableCount }` (`admitCounted` in
  `observe.ts`), a failed chair is
  drawn as failed — no gap cards, never listed as off — and the all-day
  strip carries one `role="status"` health row per affected chair («N
  посещение не може да се покаже» / "N visit can't be shown").

**Review gaps, revision 2026-10-25.** Applied: the web report's reach
(D-3/D-4/DEP-2, posture (a) for `observeUpcoming` + the systemic rule), the
systemic rule, per-side trigger guards with salvage, refusal logging at the
point of refusal, the forced `project-client-stats.integration.spec.ts`
unwrap, the capacity rerun spec, the paging cursor on a non-numeric
`utcEpochMs`, the one field rule (subject mirrors checked, customer search
mirrors not), `customerFixture`, `MinuteRange` / `StoodSeatPairs`
companions composed, the primitive-door spec domain, the per-barber
waitlist skip (DEP-13). **R-1 (partly rejected):** the offline-timing gap
is real — the claim is now unproved-until-observed (D-6, §6.3 step 8) —
but its fix "the dashboard shows its busy state for the whole wait (add a
bounded timeout)" does not apply: the append runs after the cancellation
landed and no control waits on it (`staff-dashboard.ts:5253-5262`), so a
late answer only delays the failure toast; the SDK's transaction attempts
are already bounded, so no timeout is added. NOTE runs no emulator (hard
rule: journeys are the integrator's), so the observation moved to the
integrator.

---

## 8. Ledger (filled by the integrator, 2026-10-25)

### 8.1 Per package

- **GUARD** — every file of §3.1 landed, nothing outside it. Additions
  beyond §2.1/§2.5, all inside its files and KEPT (§8.2): `idCompanion`'s
  `isSpan(text, start, end)` (the allocation-free id check `BusyKey.is`
  uses for its barber half); `admitted` takes an optional fourth `reported`
  set (a live single reports once per path per port call) and
  `keepAdmitted`'s `reported` is `Set<string> | null` (`null`: report every
  refusal, for one-shot reads); `firestore-tx.adapter.ts` exports
  `MALFORMED_DOCUMENT_REFUSED`, `logRefusal` and `admitStored`, which the
  schedules and jobs adapters reuse so the log line is spelled once.
  Existing-spec edits: only the FORCED pin of §4.1
  (`appointments.adapter.spec.ts`, the first page's `utcEpochMs <=` bound).
  `tools/seed/seed-data.spec.mjs`: every seeded appointment, customer and
  busy day passes its guard. The `app.config.ts` edit for NOTE
  (`updateAppointmentNote: LazyMethod.Promise`) landed.
- **RETRY** — every file of §3.2 landed. Departures flagged: a refused side
  with no salvageable `locationId` (but salvaged keys) rebuilds on the
  default location's zone (`readShopZone(null)`, F-4) instead of refusing —
  KEPT (§8.2); `rebuildBusy` now also logs a commit REFUSAL as `'barberBusy
rebuild failed'` `{ key, error }` (before, only a rejection was logged);
  `matchWaitlist` still logs a thrown error as `String(error)` but pushes
  the raw thrown value to `failures`, so its code is judged. FORCED
  integration edits: `match-waitlist.integration.spec.ts:205-215` (the
  answer's two new fields) and `project-client-stats.integration.spec.ts`
  `replayTrigger` (the decoder's `Result` unwrapped); no integration case
  added (the count stays 65 + 253).
- **NOTE** — every file of §3.3 landed. Departure flagged: a decision that
  names another visit throws a defect OUT of `updateAppointmentNote`,
  raised after the transaction with nothing written, rather than being
  caught as `writeFailed` (the `scheduling.adapter.ts` precedent) — KEPT
  (§8.2). Left as planned: `staff-dashboard.spec.ts` still reads
  `AppointmentNotePorts['observeAppointmentNote']` (an indexed access, not
  a `Pick`/`Omit`); `appointmentNotes` bodies unguarded (OQ-2). The offline
  observation (§6.3 step 8) was the integrator's (§8.4).

### 8.2 The open issues, resolved

1. **`Seat.fieldFault`'s F-6 end check** (`startMinutes + durationMinutes >
1440` → `durationMinutes`) — KEPT, recorded in D-1: without it a
   malformed seat passes the guard and `Seat.endMinutes` / `Seat.range`
   throw `defect('a seat ends past its shop day (F-6)')` inside a system —
   exactly the "fails deep inside a system" case the guard exists for. No
   seeded or e2e document trips it (seed spec, `verify:p0`, `e2e:web`).
2. **GUARD's API additions** (`isSpan`, the `reported` arguments, the
   shared `admitStored` / `logRefusal`) — KEPT (§8.1).
3. **The `NaN` cursor** — the plan's wording was wrong (D-3, DEP-14, §4.1):
   a `NaN` `utcEpochMs` is a number to Firestore, matches `<= MAX` and sorts
   below every other number. Corrected in D-3 and DEP-14, and the optional
   hardening DONE: `appointments.adapter.ts` `pageOf` answers
   `nextBeforeUtcMs: null` when the raw cursor is `NaN` (`resumable`) — the
   store refuses `where('utcEpochMs', '<', NaN)` and nothing well-formed is
   older. `fake-firestore.ts` now orders `NaN` like the store (below every
   number, equal to itself), so the fake matches it in a range; the
   existing non-numeric case holds unchanged and a new case proves the
   `NaN` cursor (`pageClientHistory ends the history at a NaN cursor`).
4. **The web report reaches only the device console** — recorded (D-4,
   DEP-2, HANDOFF); the sink and the worded count stay OQ-6 / OQ-7.
5. **Integration specs and the seed construct the functions adapters
   unguarded** (D-7, DEP-11) — by design; the real-data proof ran: the
   journeys read the seeded documents through `main.ts` and `app.config.ts`
   and no `'malformed document'` line appeared. `test:emulator` DID turn up
   one malformed fixture (§8.3, item 6) — a fixture, not a seeded document.
6. **Doc edits** — HANDOFF §2 row, §3.3 "Edge hardening" (DEP-1…DEP-15,
   the rulings, the carried list), §4 reference numbers; D-1 notes the F-6
   check and `isSpan`.
7. **RETRY's F-4 departure** — KEPT. Refusing would leave the deleted (or
   repaired) malformed visit's day blocked until the next write on it,
   which is what salvage exists to prevent; the zone only stamps the busy
   day's first instant (its `purgeAt` comes from `localDate`), and every
   location is in one zone today. D-5's table amended.
8. **RETRY's DEP-5 detail** (a commit refusal now logged; the raw thrown
   value judged) — recorded (§8.1, HANDOFF).
9. **The two forced integration edits** — covered by `test:emulator`
   (65 + 253 green after §8.3 item 6).
10. **The `c1db661` list question** — answered in D-3: the old mappers
    dropped a malformed visit from `observeBarberDay`, `observeHistoryFor`,
    `searchWindow` and the history reader and errored `observeUpcomingFor`
    (verified with `git show c1db661:…/appointment-repository.adapter.ts`:
    `if (result.isFailure()) continue;` on the history, the same lenient
    posture on the day and the search, `onError(result.error)` on the
    upcoming); the new rule matches list for list, adds the report and the
    systemic rule, and departs only for the busy day (one document, refused
    whole).
11. **A retrying trigger's transient rethrow under the functions emulator
    is not redelivered** (`tools/seed/settle.mjs`) — recorded as carried;
    no settle run in this pass listed one.
12. **NOTE's `app.config.ts` line** — present (GUARD made it); web
    typecheck green.
13. **The offline append, observed** — §8.4.
14. **NOTE's defect-after-the-transaction** — KEPT: Law 7.5 reserves
    `throw` for programmer defects, and a defect mapped to `writeFailed`
    would read as an expected store failure (a toast) and hide the bug.
15. **`staff-dashboard.spec.ts:5322`'s indexed access** — left (not a
    `Pick`/`Omit`; `creativo/no-sliced-ports` and the runbook gates pass).

### 8.3 The integrator's edits

1. `libs/infrastructure/firestore/src/lib/appointments.adapter.ts` —
   `resumable` (§8.2 item 3), `pageOf`'s JSDoc corrected;
   `appointments.adapter.spec.ts` +1 case.
2. `libs/infrastructure/firestore/src/testing/fake-firestore.ts` — `compare`
   orders `NaN` below every number, as the store does.
3. `libs/infrastructure/firestore/src/lib/observe.ts` — `keepAdmitted`
   walks with `for…of` and a counter (the index sink lint warned on; no
   allocation added); `apps/functions/src/adapters/firestore-tx.adapter.ts`
   — `getAll` reads `paths.at(i)`; `stored-document.system.spec.ts` — the
   variant table as pairs and the 1,000-document loops as `for…of` (same
   assertions). Lint back at 239 warnings (it was 245 on the merged tree).
4. `apps/functions/src/wire/triggers.wire.ts` and `apps/functions/src/main.ts`
   — the exported `OnRefused` alias failed runbook §4.2–§4.4 "Law 9 no port
   function type outside ports": made module-private; the decoders'
   parameter is spelled inline (as §2.5's contract wrote it) and `main.ts`'s
   `logRefusedSide` is typed `(error: RepositoryError): void`.
5. Docs: this ledger, D-1/D-3/D-5/D-6/DEP-8/DEP-14 corrections, HANDOFF.
6. `apps/functions/src/integration/project-client-stats.integration.spec.ts`
   — `visit()` built its fixtures as `{ ...draft, ...queryKeys(draft) }`,
   overriding `startMinutes` (11:00 on the shop clock) but keeping the
   fixture default `endMinutes` (10:30), so `startMinutes >= endMinutes`:
   the guard refused every fixture at the trigger decode and two cases went
   red. The builder now returns `AppointmentIndexSystem.withQueryKeys(draft)`
   — every mirror from the seats, the envelope included, exactly what a
   write plan stores (the helper's own comment: "as the commit writes
   one"). No assertion changed.

### 8.4 Gate record (HANDOFF §4, one command at a time)

| Step                                                           | Result                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm nx sync:check`                                           | up to date                                                                                                                                                                                                                                 |
| `verify-tools:layering --skip-nx-cache`                        | OK — 900 files, 3,998 import edges; 2,489 files scanned                                                                                                                                                                                    |
| `rm -rf dist/out-tsc && run-many -t typecheck --skip-nx-cache` | 39 projects, only `patterns` (baseline)                                                                                                                                                                                                    |
| `run-many -t lint`                                             | 43 projects, 0 errors, 239 warnings (as before)                                                                                                                                                                                            |
| `run-many -t test --parallel=3 --skip-nx-cache`                | 43 targets, 12,589 passed (12,510 vitest + `verify-tools` 79) + exactly the 6 baseline reds                                                                                                                                                |
| `nx test ecs-core --coverage`                                  | 317 files, 6,028 tests, 98.33 % statements (14,193/14,433), 99.16 % lines                                                                                                                                                                  |
| `nx typecheck seed-tools`; `nx test lint-rules`                | green; 13 files, 315 tests                                                                                                                                                                                                                 |
| `nx build web` + `verify:bundle`                               | initial 576.24 kB (156.90 kB transfer; +1.41 kB — the primitives' `is` doors beside their constructors, `errorHandlerLogPorts`); firestore/storage/libphonenumber-js lazy; `StoredDocumentSystem` and the guards in no initial chunk       |
| `nx build functions` + `check-functions-deps.mjs`              | green; the four runtime dependencies                                                                                                                                                                                                       |
| runbook §4.2–§4.9 (§4.0 preamble, alone)                       | 28 / 22 / 17 / 6 / 24 / 27 / 25 `ok`, 0 FAIL (first run: §4.2–§4.4 one FAIL each — §8.3 item 4)                                                                                                                                            |
| plan §6.2 greps                                                | 3 `guardOf`; 4 `telemetry.log`; 1 `'malformed document refused'` in `main.ts`; 3 `guardedReads(`; the append names only `saveTeamNote`'s `saveAppointmentNote`; 7 `retry: true`; `TRANSIENT_CODES` the four codes; no `DOCUMENT_MALFORMED` |
| `verify:p0`                                                    | (a)–(f) all proved                                                                                                                                                                                                                         |
| `test:emulator`                                                | 65 + 253 (first run 63 + 2 red — §8.3 item 6)                                                                                                                                                                                              |
| `e2e:web`                                                      | 41 passed + exactly the 19 baseline failures (6 `*-screenshots`, `landing.spec.ts:121`, the glance's 12 at `:377`/`:758`); the flaky trio passed in the run                                                                                |
| §6.3 step 8, the offline append                                | see below                                                                                                                                                                                                                                  |

**The offline append, observed** (a throwaway vitest probe run once on the
Firestore emulator, `firebase emulators:exec --only firestore`, after the
journeys; kept in the session scratchpad, never committed). A staff client
(`mockUserToken` with `roles: ['barber']`) dialled the emulator through a
TCP proxy the probe could cut; `appointmentNotes/a-unreachable` was seeded
with a colleague's words and never read by that client. With the proxy cut,
`appointmentNotePorts(db).updateAppointmentNote` answered
`{ ok: false, error: { errorCode: 'REPOSITORY_WRITE_FAILED', path:
'appointmentNotes/a-unreachable', reason: 'unavailable' } }` after
**7,206 ms**; `decide` was called **0** times. After the proxy reopened and
5 s more, the server's copy was the colleague's words, unchanged; the same
client's next append landed once, below them. A second client with
`disableNetwork(db)` appended normally in 16 ms (`decide` once, the note
written): `disableNetwork` stops the listen and write streams, not a
transaction's RPCs — no overwrite either way (the transaction read the
server's copy), but not an offline simulation. The code is `unavailable`
and the delay under ~10 s, so no open question is raised (§6.3 step 8).

### 8.5 Carried forward (to HANDOFF §3.3)

- `appointmentNotes` bodies unguarded; the append's `decide` reads
  `stored.text` as stored (OQ-2).
- The four other capacity triggers keep no `retry` (OQ-1).
- The web report's sink and a worded "N visits could not be shown" (OQ-6,
  OQ-7); `REPOSITORY_MALFORMED`'s shared words (OQ-4); a separate read code
  (OQ-5); guarded-by-default adapters (OQ-3).
- The sheet's «Запази» (`saveTeamNote`, a deliberate whole-note write of
  the draft) keeps its offline limit — only the append is transactional.
- Under the functions emulator a retrying trigger's transient rethrow is not
  redelivered (`tools/seed/settle.mjs` reports it, not refuses), so a seed
  or settle run may list the three newly retrying functions.
- The integration specs and the seed build the functions adapters unguarded
  by design (D-7).

### 8.6 The review's six findings, fixed (the fixer, 2026-10-25)

A review of the integrated tree confirmed six findings (one major, five
minor); each is fixed as its verdict corrected it, with specs.

1. **Major — one bad visit blanked a search or stranded a history**
   (`appointments.adapter.ts`). `windowOf` read its two halves each
   through the LIST rule, so a half that read rows and kept none refused
   the WHOLE search (the evening's only upcoming visit malformed → no
   search pool, no «Скорошни», though twenty valid past visits were read);
   `admitPage` applied the systemic refusal to every page, so a later page
   of only malformed rows ended the history in an error and stranded every
   older visit. c1db661's `searchWindow` looped over both halves' rows
   together and dropped every unparseable one. **Fix:** the two halves are
   read RAW and admitted ONCE, as the one answer they make (the systemic
   rule judges the whole window); the history is judged on its FIRST page
   only — a later page answers through the new `ListAdmission.DropOnly`
   (drop and report, never refuse): an empty page with its cursor (the
   older visits still load) or, on the last page, an empty page with no
   cursor. The client card's `fetchMore` already appends an empty page and
   keeps paging on a cursor. Specs: the malformed only-upcoming visit beside
   valid past ones answers the past ones and reports the drop; a window of
   only malformed rows still refuses (an empty one answers `ok([])`); a
   last page of one malformed row ends the history without an error; a
   middle page of only malformed rows keeps the cursor and the oldest visit
   loads; `observe.spec.ts` pins `DropOnly`. **The c1db661 list question,
   re-answered:** with this fix the new list rule matches c1db661 for the
   search and the history too (drop, answer the rest); it adds the report
   and refuses only a WHOLE answer that kept nothing.
2. **The guard dispatch written four times.** NEW
   `StoredDocumentSystem.admit(guardOf, collection, doc)` — `null`
   collection (a subcollection) or no registered guard reads as stored,
   else the guard's verdict — is the one home of the rule. The functions
   helper `admitStored` (`firestore-tx.adapter.ts`) now answers
   `Result<E, RepositoryError>` and logs a refusal through `logRefusal`;
   `firestore-schedules.adapter.ts` `loadOne` and
   `firestore-jobs.adapter.ts` `pageAppointments` call it (§8.1's "the
   schedules and jobs adapters reuse it" is now true); the transaction's
   read halves use its module-private `null` form (`admittedOrNull`,
   recording the refusal for the commit); the web `admitted` calls
   `StoredDocumentSystem.admit` too. `keepAdmitted` keeps its own registry
   lookup once per list, for the clean read's zero-allocation answer (the
   same array).
3. **`main.ts` spelled the refusal line again.** `logRefusedSide` is
   `logRefusal(root.edge.log, error)` — one phrase, one helper.
4. **The trigger decoders decided at the edge.** NEW
   `StoredDocumentSystem.appointmentSide(stored)` (absent / admitted /
   refused, the shared `AppointmentSide` type moved out of the wire) and
   `StoredDocumentSystem.salvageSides(before, after)` (the first refusal,
   the refused sides' busy keys, the first location — the salvage merge).
   `decodeRebuildBusyEvent` now guards, reports and forwards a plain
   `RebuildBusyCommand` carrying `refusal`; `rebuildBusy` answers
   `Result.err(refusal)` when its ONE `BusySystem.affectedKeys` is empty
   (computed once, not twice). NEW `ClientStatsSystem.dispatchSubjects(
before, after)` owns "a refused side skips the change test, the refusal
   only when nobody is named"; `decodeDispatchProjectionsEvent` forwards
   its answer (its `Result` shape unchanged, so `main.ts` and the client-
   stats integration replay are untouched). Specs: the decoder cases
   assert the forwarded command (`refusal` included); `rebuild-busy`
   +2 (the refusal answered, nothing read or written, only when no day is
   left; never while a day is); `dispatchSubjects` +6 (incl. purity);
   `main.spec.ts`'s "no day" case now proves the forward (the seam's
   `rebuildBusy` scripted to its refusal) and still the one refusal line
   and the PERMANENT attempt line.
5. **Stored-shape checks written twice.** `StoredFields` gains
   `isArrayOf`, `isRecordArray`, `isTextOrNull`, `isCount`;
   `BookingContact.fieldFault`, `StoodSeatPairs.fieldFault` and
   `StoredDocumentSystem` call them and their local copies are deleted.
6. **Each numeric brand's range written twice.** `MinuteOfDay.of` /
   `ofProven`, `EndMinute.of` / `ofProven`, `UtcEpochMs.of`,
   `PriceCents.of`, `DurationMinutes.of` and `MinuteCount.of` answer
   through their own `is` (the `-0` folds kept); the is-vs-of specs pass
   unchanged.

**Gate record (HANDOFF §4, one command at a time, after the fixes):**

| Step                                                           | Result                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nx sync:check`                                           | up to date                                                                                                                                                                                                                                                                                                 |
| `verify-tools:layering --skip-nx-cache`                        | OK — 900 files, 4,001 import edges (+3: `client-stats.system.ts` → `./stored-document.system` and `@core/errors`, its spec → `./stored-document.system`); 2,489 files scanned                                                                                                                              |
| `rm -rf dist/out-tsc && run-many -t typecheck --skip-nx-cache` | 39 projects, only `patterns` (baseline)                                                                                                                                                                                                                                                                    |
| `run-many -t lint`                                             | 43 projects, 0 errors, 239 warnings (unchanged)                                                                                                                                                                                                                                                            |
| `run-many -t test --parallel=3 --skip-nx-cache`                | **12,615 passed** (12,536 vitest + `verify-tools` 79; +26 cases: ecs-core +20, firestore +5, functions +1) + exactly the 6 baseline reds                                                                                                                                                                   |
| `nx test ecs-core --coverage`                                  | 317 files, **6,048 tests, 98.33 %** statements (14,207/14,447), 99.16 % lines                                                                                                                                                                                                                              |
| `nx typecheck seed-tools`; `nx test lint-rules`                | green; 13 files, 315 tests                                                                                                                                                                                                                                                                                 |
| `nx build web` + `verify:bundle`                               | initial **576.09 kB** (156.91 kB transfer; −0.15 kB: the brands' `of` through `is`); firestore/storage/libphonenumber-js lazy; the guards (`DROP_ONLY`, the drop line) only in a lazy chunk                                                                                                                |
| `nx build functions` + `check-functions-deps.mjs`              | green; the four runtime dependencies                                                                                                                                                                                                                                                                       |
| runbook §4.2–§4.9 (§4.0 preamble, alone)                       | 28 / 22 / 17 / 6 / 24 / 27 / 25 `ok`, 0 FAIL                                                                                                                                                                                                                                                               |
| plan §6.2 greps                                                | 3 `guardOf`; 4 `telemetry.log`; 1 `logRefusal(root.edge.log` in `main.ts`; 3 `guardedReads(`; the append names only `saveTeamNote`'s `saveAppointmentNote`; 7 `retry: true`; `TRANSIENT_CODES` the four codes; no `DOCUMENT_MALFORMED`                                                                     |
| `verify:p0`                                                    | (a)–(f) all proved; no `'malformed document'` line                                                                                                                                                                                                                                                         |
| `test:emulator`                                                | 65 + 253; no `'malformed document'` line                                                                                                                                                                                                                                                                   |
| `e2e:web`                                                      | 40 passed + the 19 baseline failures (6 `*-screenshots`, `landing.spec.ts:121`, the glance's 12 at `:377`/`:758`) + the known load flake `appointments.spec.ts:151` (the cancel test — HANDOFF's `:152` flake; alone with `--repeat-each=3`: 12/12 passed, so 41 + the 19); no `'malformed document'` line |

After the gate, `prettier --write` was run on the touched files (they were
prettier-clean at `36bbac9`) and the owning projects re-checked —
`ecs-core`, `functions`, `firestore`: typecheck (clean `dist/out-tsc`),
lint (0 errors, warnings unchanged) and test (6,048 / 955 / 288) green.
