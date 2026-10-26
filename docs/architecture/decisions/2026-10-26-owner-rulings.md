# Owner rulings — 2026-10-26 (pass F, owner-delegated)

> **Status: BUILT (2026-10-26).** Every ruling below is built and
> integrated; the FULL gate of `HANDOFF.md` §4 ran green with no standing
> reds — for OR-1 … OR-56 on the pass-F tree, for OR-57 … OR-59 (ruled and
> built after it, on `2f75cb21`) on their own change. What landed per ruling, and the departures the build took, are in
> the ledger before the implementation plan.

> **Authority.** The owner delegated every open decision on 2026-10-26:
> _"make decisions by how you would do it — FAANG grade decisions, performant
> and creative"_. This record is the chief architect's ruling on every open
> question in `HANDOFF.md` §3.3 (the carried lists, including "Carried from
> pass E") and §6, and in the plans' open-question sections:
> `pass-e-leftovers.md` §7, `pass-c-ui-decisions.md` §8,
> `pass-d-brands-shapes.md` §8, `edge-hardening.md` §7,
> `law-10-decision-extraction.md` §8, `flip-4-programs.md` §10 and
> `docs/security/csp-baseline.md`. Grounded on `main` at `1322b782`.
> CLAUDE.md Laws 1–10 bind every ruling. Where a ruling departs from an
> earlier plan, the departure is numbered **DEP-F*n***.
>
> **How the rulings were made.** Eight research clusters scored each
> question's real options on seven criteria, each from 1 to 5:
> **C** correctness and data integrity · **S** security and privacy ·
> **P** performance and cost · **T** one source of truth · **U** UX quality
> (taste rulings, never silently hide data) · **M** simplicity and
> maintainability (YAGNI; parked code that closes a REAL gap is wired, the
> rest is deleted) · **R** reversibility and rollout risk.
> Score rows below are listed in that order, as `C/S/P/T/U/M/R`. Before
> ruling, the chief architect re-read the evidence for every ruling that
> changes behaviour or deletes code, and settled the conflicts between
> clusters (§0). **Rule of the round:** anything that closes a live
> correctness, security or revenue gap is built now, whatever its size.

---

## 0. Conflicts between clusters, and how they were settled

| Conflict                                                                                                                                                                                                                                 | Ruling                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden staff rows: the staff cluster (`BarberDayRead.unreadableCount` + failed lanes), the edge cluster (`StaffDayRead.droppedCount`, «опреснете») and the copy cluster (`staff.day.hidden`, «записът е повреден») each proposed a shape | **OR-2** adopts the staff cluster's design, which is the only one that also renders the failed lane (never rendered today). The port type is `BarberDayRead { appointments; unreadableCount }`. The words use «посещение», the noun of the neighbouring `staff.day.visitCount`, and avoid two things: the formal «опреснете», and the claim «повреден», which is false in the realistic version-skew case. |
| `REPOSITORY_*` words: staff cluster (g) vs copy cluster                                                                                                                                                                                  | **OR-54** adopts the copy cluster's five-code version, in the «ти» voice. It supersedes the staff cluster's formal wording.                                                                                                                                                                                                                                                                                |
| Coupon grants: the loyalty cluster (burn at save, restore on removal or cancel, terms kept on `USED`) vs the parked-code cluster (`burn` plus "accept BURNED by the same appointment", delete `loadCouponGrant`)                         | **OR-13** adopts the loyalty cluster's design, because the bill delta needs no "same appointment" exception. `loadCouponGrant` is **reshaped** to `LoadCouponGrants(ids)`, not deleted: a burned grant must still show on its saved visit's card.                                                                                                                                                          |
| Notifications: a dedicated `/account/notifications` page with a batch receipt (loyalty cluster) vs an «Известия» group on `/account` with a per-row stamp (parked-code cluster)                                                          | **OR-19** adopts the dedicated page with one batched receipt per visit, and the one-shot rules. The menu row already promises that page.                                                                                                                                                                                                                                                                   |
| OTP refusal copy, written formally («Вече ви изпратихме…»)                                                                                                                                                                               | Reworded in «ти» by **OR-51** (one voice).                                                                                                                                                                                                                                                                                                                                                                 |
| Order of the voice pass vs new keys                                                                                                                                                                                                      | Every new key in this record is already written in the «ти» voice. The voice pass (**OR-51**) runs last so its spec re-pins don't collide with the feature packages.                                                                                                                                                                                                                                       |
| Admin programs page: the new labels proposed as catalogue keys on a page that hard-codes English                                                                                                                                         | **OR-37** moves the page's literals into `admin.programs.*` (bg + en) in the same package, so the page doesn't become half-translated.                                                                                                                                                                                                                                                                     |

---

## Part A — Staff day and visit editor

### OR-1 — A walk-in visit is seeded where it fits inside the shop day

**Question.** A new visit opened at 23:56–23:59 is seeded at 24:00, which the grid can't draw. What rule should the seed follow?

**Context.** `VisitDraftSystem.snapUp` (`libs/ecs-core/src/systems/visit-draft.system.ts:225-236`, re-read) rounds 1436–1439 up to `1440`. `nowSnapped()` (`staff-dashboard.ts:5422-5425`) feeds `openCreate`. The default span is 30 minutes (`:5354-5358`). A start of 1440 has no height in the 0–1440 grid window (`staff-visit-editor.ts:2740-2750`). The wider defect starts at 23:31: from then on the seeded end crosses midnight and the server refuses it. So any ＋ pressed after 23:30 seeds a visit that can't be saved as seeded. The spec pins 1440/1470 (`staff-dashboard.spec.ts:6270-6289`).

| Option                                                                      | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------- | ----------------- |
| A. Status quo: start at the next tick, even 24:00                           | 2/5/5/4/1/5/5     |
| **B. `start = min(snapUp(now), floorToGrain(1440 − span))`, one pure rule** | **5/5/5/5/4/5/5** |
| C. Clamp to 23:55 and shrink the span (pins a duration override)            | 4/5/5/3/3/3/5     |
| D. Roll over to tomorrow's roster start (needs async data)                  | 4/5/3/3/4/2/4     |

**Decision: B.** Add `VisitDraftSystem.walkInStart(now: MinuteOfDay, span: DurationMinutes): MinuteOfDay` and delete `snapUp`, whose only caller is its spec.

**Rationale.** It keeps the owner's "next tick" ruling until 23:25. After that it guarantees that what is drawn is what the server accepts. It is integer-only and allocates nothing. «Утре» is one tap away once OR-3 makes the create sheet follow its draft.

**Consequences.** `createVisit.startMinute` becomes `MinuteOfDay`. Rebook is unchanged.

**DEP-F1.** From 23:26 on, the ＋ seeds the latest half hour that fits (23:30–24:00). Spec `staff-dashboard.spec.ts:6270` is re-pinned to 1410/1440.

**Size** S. **Copy** none.

### OR-2 — Unreadable visits and failed chairs are shown on the staff day

**Question.** When the staff lists drop malformed documents (edge OQ-7), should the staff day say so, and where?

**Context.** `keepAdmitted` (`libs/infrastructure/firestore/src/lib/observe.ts:212-250`) drops bad rows and tells only the device console. If every row is dropped it answers `REPOSITORY_MALFORMED`, which the store turns into `failed: true` with `appointments: []` (`staff-day.store.ts:1587`, re-read). **No template reads `failed`.** The only `failed` in `staff-dashboard.html` is a write row at `:879`, re-read. `staff.day.laneFailed` exists in both catalogs and is used nowhere. So today:

- a failed chair draws as an empty rostered day whose gaps look sellable;
- an unrostered failed chair is listed as off.

That contradicts edge-hardening D-3's promise. The harm: a client walks in for a booking nobody can see.

| Option                                                                                                            | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Console only                                                                                                   | 2/4/5/3/1/5/5     |
| **B. `unreadableCount` on the barber-day answer; render failed lanes; one all-day health row per affected chair** | **5/5/5/5/5/4/5** |
| C. A generic `ListAnswer<E>` with a dropped count on every list                                                   | 5/5/5/5/5/2/4     |
| D. A side-channel health signal fed from the log port                                                             | 3/4/5/2/3/3/4     |

**Decision: B.**

- Ports: `BarberDayRead = { readonly appointments: readonly Appointment[]; readonly unreadableCount: number }`, and `ObserveBarberDay` answers `Result<BarberDayRead, RepositoryError>`. It is a named type, with no `Pick` (Law 9).
- `observe.ts`: split out `admitCounted` (it keeps the same-array identity when the read is clean). `keepAdmitted` wraps it, so search and history are unchanged.
- Store: a failed lane has `holes: []` and is excluded from both `offToday` and `resting`.
- Presenter: the Law-10 `day-health.presenter.ts` and `.vm.ts` word one non-interactive `role="status"` row per chair inside the existing all-day strip (`.agenda-card--allday`). The disc holds an error glyph (the accent law: colour is the shape, the words are ink).

**Rationale.** On a schedule, a missing booking is the most plausible lie, so it must never be silent. The count is computed in the loop that already makes the decision: one integer, no read. C is YAGNI. It stays a mechanical follow-up for search and history if they ever need it.

**DEP-F2.**

- A failed chair no longer draws gap cards and is no longer listed as off; it shows a health row. This makes edge-hardening D-3 true.
- A partial drop now shows a count.
- The dead `staff.day.laneFailed` key is wired.
- Edge OQ-7's default ("out of scope") is reversed.

**Size** M.

**Copy (bg / en).**

- `staff.day.unreadable.one`: «{{count}} посещение не може да се покаже» / "{{count}} visit can't be shown"
- `staff.day.unreadable.other`: «{{count}} посещения не могат да се покажат» / "{{count}} visits can't be shown"
- `staff.day.unreadableHint` (the row's meta): «Презареди страницата» / "Reload the page"
- `staff.day.laneFailedBadge` (the failed chair's meta, beside `offBadge`): «Не се зареди» / "Didn't load"
- The existing `staff.day.laneFailed` («Този график не се зареди — презареди страницата.» / "This schedule didn't load — reload the page.") becomes the failed row's accessible sentence.

### OR-3 — The frame verdict judges the day the frame draws

**Question.** After a re-date, the editor's verdict still reads the SEEDED day (pass C OQ-9). Should it read the drawn day?

**Context.**

- `frameVerdict` reads `vm.neighbours` and `readableShiftOf(vm)` (`staff-visit-editor.ts:2928-2945`, re-read).
- The picture and the screen-reader sentence read `frameDay()`. The dashboard redraws that for the drafted day and chair (`visitFrameDay`).
- The create sheet binds neither `[uiFrameDay]` nor `(dayChanged)`. In `staff-dashboard.html`, only the visit sheet (`:1204/:1216`) and the block sheet (`:1353`) bind them, re-read.
- Result: the line under the frame warns about a booking that isn't drawn and misses the real clash. The visual and the audible narration disagree.

| Option                                                                                                           | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep reading the seeded day                                                                                   | 2/5/5/2/2/4/5     |
| **B. The verdict reads `frameDay()`; the create sheet follows its drafted day and chair through the same probe** | **5/5/4/5/5/4/5** |
| C. Silence the verdict after any re-date                                                                         | 3/5/5/3/2/4/5     |

**Decision: B.**

- Generalise `visitFrameDay` into `frameDayFor(subject, draftDay, draftChair)` and use it for both sheets.
- Add `createDraftDay`, `createDraftChair` and `onCreateDayChanged` (which calls `store.probeDay`). Release the probe in `closeCreateSheet`.
- The neighbours rule stays `BusySystem.chairOccupants`.
- Fix the stale OQ-9 comment (`:2825-2832`).

**Rationale.** One input is drawn, narrated and judged. The server's overlap rule stays the authority. While the probe is pending, the verdict is silent, never wrong.

**DEP-F3.** The verdict speaks about the drawn day and chair. The create sheet's frame follows its draft; before, it always drew the anchor day.

**Size** M. **Copy** none.

### OR-4 — The visit editor's save is a pipeline

**Question.** Should the save orchestration (batch, then note, then tip, the stale guard, the undo shape) stay in the dashboard component (pass D OQ-9)?

**Context.**

- `saveFromEditor` and `writeFromEditor` (`staff-dashboard.ts:4514-4720`) sequence the round-5 invariant: the batch goes first and alone decides; sides land only after it.
- `JSON.stringify` equality of command arrays (`:4558-4562`) is sensitive to key order.
- Only the 8k-line TestBed specs pin the order.
- The store already calls `@core/pipelines` web pipelines (`saveTeamNote`, `appendTeamNote`).

| Option                                                                                                                                               | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep it in the component                                                                                                                          | 3/5/5/3/4/2/5     |
| B. Move it as-is into the store                                                                                                                      | 4/5/5/4/4/3/4     |
| **C. A pure `StaffEditPlanSystem.savePlan`, plus a `saveVisitEdit` pipeline over `VisitEditWritePorts`, called by the store for both save and undo** | **5/5/5/5/4/4/4** |
| D. A server-atomic save that folds the note and the tip into `staffEdit`                                                                             | 5/5/4/5/5/3/2     |

**Decision: C.**

- New `libs/ecs-core/src/ports/visit-edit.port.ts`: `SendStaffEdit`, `SaveTeamNoteText` and `SendSeatTip`, grouped as `StaffEditSendPorts`, `TeamNoteSavePorts` and `SeatTipSendPorts`, with `VisitEditWritePorts` as their `&`.
- `BookingCall.sameCommands` (a structural equality) replaces the stringify comparison.
- The `EditorWrite` outcome tag moves to a data file.
- The component keeps only the UI reactions: the saved mark, the toast, the undo offer and the stale reload.

**Rationale.** Law 4 / 8.4: the ordering invariant becomes provable by a fast pure pipeline spec with fake ports. D is the north star, but it is L and crosses decided boundaries, so it is deferred (§deferred).

**Consequences.** The existing dashboard save and undo specs are the characterisation net and **must stay green unchanged**.

**DEP** none intended. A difference can arise only on key order, where the old comparison was the wrong one.

**Size** M.

### OR-5 — Photo moments and money follow the active language

**Question.** The photo titles are hard-coded `'bg-BG'` (pass D OQ-19). Should they follow the active language?

**Context.**

- `photoWhen`, `photoDay` and `photoTime` pass `'bg-BG'` (`staff-visit-editor.ts:5647/:5670/:5679`, re-read).
- The language-to-Intl table is `intlLocaleOf` (bg→bg-BG, en→en-GB).
- The visit card already words photo days through the shared visits presenter.
- The editor's money labels pass the raw `'en'`, which formats as en-US.

| Option                                                                             | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------------------- | ----------------- |
| A. Keep `'bg-BG'`                                                                  | 2/5/5/2/2/5/5     |
| B. Inline `intlLocaleOf`                                                           | 5/5/5/4/4/5/5     |
| **C. B, plus a shared `photoMomentOf` presenter in `libs/features/shared/visits`** | **5/5/5/5/5/4/5** |

**Decision: C,** and route the editor's `formatCents` / `formatCentsFigure` locale through `intlLocaleOf` in the same package.

- Add `photoMomentOf(takenAtUtcMs, timeZone, now, locale) → { when, day, time }` in a new `photo-moment.presenter.ts` and `.vm.ts`. It reuses `yearIfElsewhere` (R59).
- Delete the editor's own copy of the year rule (`:5662-5668`).

**DEP-F4.** In the English UI, photo titles read en-GB («4 Sept, 16:21») and money reads en-GB. The Bulgarian UI is unchanged.

**Size** S. **Copy** none (Intl).

### OR-6 — Guest placeholders take the lowest free number

**Question.** What number does a new guest's placeholder get (pass C OQ-6)?

**Context.** `Party.labelNumberAfter` (highest id + 2, `party.data.ts:138-162`) drifts from the labels on screen. A trace gives Гост 1, Гост 2, Гост 4. Its only production caller is `booking-services-step.ts`, re-checked. The visit prefill (`booking-cart.system.ts`) and the staff walk-ins (`VisitDraftSystem.walkInLabels`) already use the lowest free number.

| Option                                                                                        | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------- | ----------------- |
| A. Highest id + 2                                                                             | 3/5/5/2/3/4/5     |
| B. A monotonic counter                                                                        | 4/5/5/3/2/4/5     |
| **C. The lowest free number, `firstUnusedLabel(taken, label, 1)`; delete `labelNumberAfter`** | **5/5/5/5/4/5/5** |
| D. One past the highest label on screen                                                       | 5/5/5/4/5/3/5     |

**Decision: C.** It is one rule on all three surfaces, the Finder convention.

**DEP-F5.** After the first guest is removed, the next guest added is «Гост 1».

**Size** S. **Copy** none (existing `booking.party.guest`).

---

## Part B — Booking and client

### OR-7 — The client time sheet frames the whole party, and 4a §11.4 (a) is confirmed

**Question.** Should the sheet offer only times the server accepts for every seat (carried companions, later sequential seats)? And should the 4a time-sheet re-pin be confirmed?

**Context.**

- Riders are already fitted by `AvailabilitySystem.ridersFit`.
- The sheet frames only the envelope start (`booking-time-sheet.ts:261`, `instantAt`).
- The reschedule pipeline frames the whole party with `ZonedTimeSystem.frameShopDay` and refuses `DST_GAP_INVALID_TIME`.
- The "never offers a gap minute" claim lives only in a comment.

| Option                                                                                                                                                      | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Leave it                                                                                                                                                 | 4/5/5/2/3/5/5     |
| **B. A pure `MoveSystem.partyStarts`; the sheet frames every start with `frameShopDay` (memoised per minute); `data-start` = the party's envelope instant** | **5/5/4/5/5/4/5** |
| C. Zone-aware `dayOptions` inside the system                                                                                                                | 5/5/4/4/5/3/4     |
| D. A dry-run callable before Confirm                                                                                                                        | 5/4/2/5/3/2/3     |

**Decision: B,** and **confirm 4a §11.4 (a)** (option C there). The selection mapper stays a pure wall-clock mapping. The new pure `timedOptionsOf` spec pins "a start the zone erases is not offered" for the envelope, a sequential seat and a carried companion. `instantAt` and the stale "flexible sheet" JSDoc are deleted.

**DEP-F6.** On a companion-first move, `data-start` carries the party's earliest instant, which is the stored `utcEpochMs`.

**Size** S. **Copy** none.

### OR-8 — "Upcoming" is judged on each visit's own shop wall clock

**Question.** `/account`'s «Предстоящ час» and the menu badge can show a CONFIRMED visit that has already started (pass C OQ-4). How should that be fixed?

**Context.**

- `client-account.ts:258-269`, re-read, takes `soonestFirstByStart(list)[0]` with no time bound.
- No cron settles visits.
- `/account/appointments` already files the same visit as history through `VisitListSystem.isHistory`.
- `ShopZoneService.zoneOf` is not memoised.

| Option                                                                                                                | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Leave it                                                                                                           | 2/5/5/2/2/5/5     |
| B. Filter by instant                                                                                                  | 4/5/5/2/4/5/5     |
| **C. `VisitListSystem.nextUpcoming` / `countUpcoming` over `isHistory`, with a per-shop `nowOf` from memoised zones** | **5/5/4/5/5/4/5** |
| D. Bound the query and/or a settle sweep                                                                              | 4/5/5/3/4/3/3     |

**Decision: C.**

- Use a linear scan with no sort allocation. A visit whose shop zone is unknown is skipped.
- `ShopZoneService.zoneOf` memoises per `LocationId` and drops failures so they retry.
- The menu badge and the appointments page use the same per-visit `nowOf`.
- An automatic settle sweep is a product decision and is **not** taken (§deferred).

**DEP-F7.** A live visit that has begun on its shop's clock is no longer shown or counted as upcoming. With nothing else upcoming, the existing empty state shows.

**Size** M. **Copy** none.

### OR-9 — The OTP resend window is server-owned at 60 s, and a throttled resend becomes a countdown

**Question.** The client enables resend at 30 s while the server throttles for 60 s (pass C OQ-5). Which value is the source of truth?

**Context.**

- `RESEND_COOLDOWN_SECONDS = 30` (`auth-flow.store.ts:22`, re-read).
- `OtpLimits.ResendWindowMinutes: 1` (`otp.system.ts:39-47`, re-read).
- Every tap between 30 and 59 s is refused with a dead-end error.
- An early resend also makes the late first email's code fail as wrong.

| Option                                                                                                                           | C/S/P/T/U/M/R     |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Leave it                                                                                                                      | 3/5/5/1/1/4/5     |
| B. Server to 30 s                                                                                                                | 4/3/4/2/3/4/4     |
| C. Client imports the server constant                                                                                            | 5/5/5/4/4/5/5     |
| **D. C, plus the refusal carries `retryAfterSeconds` from `OtpSystem.retryAfterSeconds`; the store turns it into the countdown** | **5/5/5/5/5/4/5** |

**Decision: D, at 60 s.**

- `OtpLimits.ResendWindowSeconds: 60`.
- `IdentityError.OtpRateLimited = { errorCode; retryAfterSeconds }`.
- Delete `RESEND_COOLDOWN_SECONDS`.
- Amend `auth-flow-design.md` (:73, :136, :305) from 30 s to 60 s.

**DEP-F8.** The countdown goes from 30 s to 60 s, and a throttled resend restarts the countdown instead of showing an error.

**Size** M.

**Copy.** `errors.IDENTITY_OTP_RATE_LIMITED`: «Вече ти изпратихме код. Нов можеш да поискаш след {{seconds}} сек.» / "We already sent you a code. You can ask for a new one in {{seconds}} s."

### OR-10 — The OTP escalation point lives in `OtpLimits`

**Question.** Should the template's literal `sendCount() >= 3` (`client-auth.html:399`, re-read) move into a system (pass C OQ-13)?

| Option                                                                                             | C/S/P/T/U/M/R     |
| -------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep the literal                                                                                | 5/5/5/2/4/4/5     |
| **B. `OtpLimits.EscalateAfterSends: 3` + `OtpSystem.escalates`; the store's `escalated` computed** | **5/5/5/5/4/5/5** |
| C. Put the count inside the state machine                                                          | 5/5/5/5/4/2/3     |
| D. A server-driven flag                                                                            | 5/5/4/5/5/2/3     |

**Decision: B,** keeping 3. Law 10.2: a threshold is a decision. **DEP** none. **Size** S.

### OR-11 — `PlacementPolicy.staffWalkIn` is deleted; D18's conflicting-services half is superseded

**Question.** Apply D18 to the live staff paths, or delete the uncalled preset (pass C OQ-3)?

**Context.**

- `staffWalkIn` is used only in specs (`placement-policy.data.ts:41-75`, re-grepped).
- Both live staff paths use `staffPlacement()`.
- The staff editor has no client-side conflict pre-check, so applying D18 would break barbers' saves without warning.

| Option                                                 | C/S/P/T/U/M/R     |
| ------------------------------------------------------ | ----------------- |
| A. Keep it parked                                      | 5/5/5/2/5/2/5     |
| B. Apply D18                                           | 4/5/5/4/2/3/3     |
| **C. Delete `staffWalkIn` and the spec-only `equals`** | **5/5/5/5/5/5/5** |
| D. Acknowledgeable conflicts                           | 5/5/5/4/3/2/4     |

**Decision: C.** The catalogue's conflicts guard client self-booking. The shop's own book trusts the barber.

**DEP-F9 (recorded departure from §9 D18).** Staff placement allows conflicting services everywhere. This is the live behaviour since flip 1, so nobody sees a change.

**Size** S.

### OR-12 — An availability refusal carries no busy body

**Question.** Should `BOOKING_SLOT_UNAVAILABLE` ship the public `barberBusy` day in its details (ecs-migration :565, flip-1 §10 Q3)?

| Option                                                                         | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------ | ----------------- |
| A. Ship it                                                                     | 4/3/3/2/4/2/4     |
| **B. Decline: details stay the flat scalar struct; the live listeners redraw** | **5/5/5/5/4/5/5** |
| C. A server "next free starts" hint                                            | 4/4/3/2/5/2/4     |

**Decision: B,** closed. An error carries scalars and brands only (Law 7.5) and is never a data channel. An edge spec pins `BOOKING_SLOT_UNAVAILABLE`'s details as exactly `{errorCode, barberId, localDate, startMinutes, seatIndex}`. **Size** S.

---

## Part C — Loyalty, coupons, vouchers, notifications

### OR-13 — Coupon grants are burned at save and restored on removal or cancel (built now)

**Question.** Is a grant burned when a visit uses it? (Flip-1 F1-2 "no grant write"; pass E §7.1 item 5.)

**Context: a live revenue leak.**

- `CouponGrantSystem.burn`, `restore` and `transitionWrite` have no production caller (re-grepped).
- `edit-appointment.pipeline.ts:151`, re-read, says "No grant write (F1-2)".
- The grant stays `ACTIVE`, so `listUsableCouponGrants` offers it again: a single-use «Безплатно подстригване» works on every visit.
- The edit transaction already `getAll`s both the batch's grants and the stored bill's grants.
- Vouchers already follow the model: drawn on save, given back on cancel.
- `GrantLifecycle.used` drops the terms (`grant-lifecycle.data.ts:36-42`, re-read), so `restore` needs an `issued` argument that nobody holds.

| Option                                                                                                        | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. Burn on save and restore on removal or cancel, inside the existing transaction (the voucher semantics)** | **5/5/5/5/4/4/4** |
| B. Burn on completion, with a reserved marker                                                                 | 4/4/4/3/4/2/3     |
| C. Hide named grants with a query                                                                             | 2/2/2/2/3/3/5     |
| D. Delete the verbs and leave the leak                                                                        | 1/2/5/3/2/5/5     |

**Decision: A.**

1. `GrantLifecycle.Used` keeps the issue terms (`{ grantStatus: USED; usedAtUtcMs; usedNote } & Terms`). `restore(grant)` needs no `issued`. Update the entity type-spec.
2. `CouponGrantSystem.settleBill(before, after, grants, appointmentId, nowUtcMs): Result<readonly WriteOp[], …>` is one linear pass:
   - a grant line that is new on the bill is burned (`usedNote 'appointment:<id>'`);
   - a line that left the bill is restored (a refusal is skipped, never failing a save);
   - a kept line writes nothing.
3. `CouponGrantSystem.releasePlan(discounts, grants)` drops the grant lines and restores the grants on cancel.
4. **One predicate**, `BillingSystem.releasesHoldings(transition)`, is read by the voucher restore and the grant restore alike. **Cancel AND no-show release** (orchestrator override, 2026-10-26, below): value the client holds — a coupon grant or a gift-voucher balance — is consumed only by a visit that happened; a reopen of a cancelled or no-showed visit does not re-burn (the barber re-adds it).
5. Delete `expire`, `revoke`, `termsOf`, `isActive` (if it has no reader), `CouponGrantNotExpiring` and `CouponGrantReasonEmpty`. Keep the `EXPIRED` / `REVOKED` variants as stored vocabulary.
6. Pipelines and reads:
   - `decideEdit` adds `settleBill`'s writes;
   - `booking-read-set` gains `readDiscountGrants`, one `getAll`, made only when the bill has grant lines;
   - `cancel-appointment` and the cancel branch of `transition-appointment` merge `releasePlan`;
   - reopening a cancelled visit doesn't re-burn (the barber re-adds the reward, the same rule as vouchers).
7. `LoadCouponGrant` is reshaped into `LoadCouponGrants(ids)` (a batched get). `load-held-grants` returns usable grants ∪ the open visit's saved bill grants (any status), so a burned grant still shows on its visit's card.
8. `settleDiscounts` refuses an unusable or foreign grant as `invalidCommand('grant')`.

**Rationale.** It closes the leak with zero new reads on the hot path. The transaction makes a double spend impossible.

**Consequences.**

- No rules change and no index change.
- The seed has no `USED` grants, so there is no backfill.

**DEP-F10.**

- Departs from F1-2 ("no grant write") and from the design doc's "burn on completion" (`staff-visit-editor-design.md:6584`); the end state at completion is the same.
- ~~Flagged product default: a no-show keeps the grant burned, like the voucher draw.~~ **Overridden by the orchestrator (2026-10-26, delegated owner authority): a no-show RELEASES the grant and the voucher draw.** A reward or a voucher balance is value the client earned or bought; a no-show penalty belongs to the shop's cancellation / no-show policy (an explicit, visible rule), never to a silent forfeit of loyalty value — that is support load and broken trust for no business gain. One rule for both holdings in `releasesHoldings`; DEP-F10b: a no-showed visit gives its grant back to the wallet and its voucher draw back to the balance.

**Size** L (built now: revenue gap).

**Copy.** `errors.BOOKING_STAFF_EDIT_INVALID_COMMAND.grant`: «Тази награда вече не важи — използвана е или е изтекла.» / "This reward no longer applies — it's been used or has expired."

### OR-14 — `VoucherSystem.issue` and `redeem` are deleted

**Context.** Neither has a production caller (re-grepped). `redeem` duplicates `refusal` + `settle` (two copies of the balance rule). No issuer exists: the rules deny writes and there is no callable. The future issuers (Q14 points redemption, payments) need a different signature.

| Option                                          | C/S/P/T/U/M/R     |
| ----------------------------------------------- | ----------------- |
| **A. Delete `issue`, `IssueVoucher`, `redeem`** | **5/5/5/5/4/5/5** |
| B. Build admin issuing now                      | 4/3/4/4/3/2/3     |
| C. Keep them parked                             | 5/5/5/3/4/2/5     |

**Decision: A.**

- Port the uncovered `redeem` cases onto `settle` / `refusal` (insufficient balance, currency mismatch, not redeemable, the property test).
- Fix the doc comment at `engagement.error.ts:276`.
- Delete `GiftVoucherValueInvalid` only if nothing else reads it.

Voucher issuing returns with Q14 or with payments. **DEP** none (closes KEEP-PARKED). **Size** S.

### OR-15 — Reward tickets and held rewards are keyed by coupon id

**Question.** Law 10.2 OQ-4: should the keys be display words or a coupon id?

**Context.**

- `groupKey` is built from display words (`loyalty.presenter.ts:333`, re-read).
- `pointsReachBeyondHeld` compares `reward.name[locale]` with the held coupon names (`reward.system.ts:301-318`, re-read). `Coupon.name` is one string, so in **en a held reward is never excluded** (a live bug), and two different coupons with the same name merge into one ticket.
- `grantCouponId` and the grant's `couponId` already exist end to end.

| Option                                                                             | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------------------- | ----------------- |
| **A. Group by `couponId` + `CouponValue.same`; exclude by `reward.grantCouponId`** | **5/5/5/5/5/4/5** |
| B. Store a `rewardId` on the grant                                                 | 5/5/5/4/5/3/3     |
| C. Keep the word keys                                                              | 2/5/5/2/2/5/5     |

**Decision: A.**

- `GrantTicketRef = { grantId; couponId; value; expiresOn }`.
- `pointsReachBeyondHeld(rewards, heldCouponIds, balance, today)`: the `locale` parameter is removed.
- `ClientCardGrant` gains `couponId` and `value`.
- Add `CouponValue.same`.

**DEP-F11.** A bug fix: in en, held rewards are excluded from «enough for», and different coupons that share a name show as separate tickets.

**Size** M. **Copy** none.

### OR-16 — `couponOccasion` is required

**Context.** It is optional on `ClientCardGrant` (`client-card.contracts.ts:72`). Every producer sets it, and the entity field is required.

| Option                                                                                          | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------- | ----------------- |
| **A. Required `CouponOccasion \| null` (contract, `VisitEditorGrantOption`, `OccasionTagged`)** | **5/5/5/5/5/5/5** |
| B. Keep it optional                                                                             | 4/5/4/3/5/3/5     |

**Decision: A,** shipped with OR-15 (same contract). It keeps one hidden class and removes the `?? null` and `Partial` fallbacks. **DEP** none. **Size** S.

### OR-17 — The glance shows voucher money in every currency

**Context.** `ClientGlanceSystem.holdings` sums only the first currency and silently drops the rest (`client-glance.system.ts:183-203`). The glance is the only place it shows voucher money.

| Option                                                                                                                                    | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. `VoucherSystem.spendableSums(vouchers, today): readonly Money[]`; the glance prints each sum; the wallet's `heldTotal` composes it** | **5/5/5/5/5/4/5** |
| B. The glance refuses mixed currencies                                                                                                    | 3/5/5/4/2/5/5     |
| C. Keep the first currency only                                                                                                           | 2/5/5/3/2/5/5     |

**Decision: A.**

- `GlanceHoldings.vouchers: readonly Money[]`.
- The glance joins the sums with « · ».
- The wallet keeps "no total across currencies": `heldTotal` is non-null only for one currency and at least 2 vouchers.

**DEP-F12.** The glance shows every currency, closing OQ-5 against the "keep both" default. **Size** S. **Copy** none.

### OR-18 — Ties break by UTF-16 code units everywhere

**Context.** The wallet uses `localeCompare` on opaque ids (`wallet.presenter.ts:306`), which is device-locale dependent. `upcomingSoonestFirst` breaks ties by input order.

| Option                                                                                                 | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------ | ----------------- |
| **A. Code-unit id tie-breaks; drop `VoucherIdOrder`; `upcomingSoonestFirst` uses `byStart \|\| byId`** | **5/5/5/5/4/5/5** |
| B. Keep the current orders                                                                             | 3/5/3/2/4/3/5     |

**Decision: A.** It closes Law-10 OQ-7. **DEP-F13:** only exact ties reorder. **Size** S.

### OR-19 — A notification inbox at `/account/notifications`, with a one-shot read receipt

**Question.** Is there an inbox that marks notifications read (the parked `markNotificationRead`, `NotificationSystem.markRead` / `readBeforeSent`)?

**Context: a live gap.**

- The waitlist step promises a notification (bg.json:445).
- The matcher writes `WAITLIST_MATCH`, and `/book` accepts its deep link.
- The menu row routes to `/account` (`site-menu.component.html:82/:403`, re-read). There is no inbox, nothing stamps a notification read, and the accent unread badge only grows.
- The rules let the owner update only `readAtUtcMs` (`firestore.rules:224-225`, re-read).

| Option                                                                                                                            | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. A dedicated page; one shared stream for badge and page; one batched receipt per visit, clamped to `sentAt`; one-shot rules** | **5/5/5/5/5/4/4** |
| B. Mark read on tap                                                                                                               | 5/5/4/5/3/4/4     |
| C. Delete the badge and the read stamp                                                                                            | 2/5/5/4/1/5/4     |

**Decision: A.**

ecs-core:

- `NotificationSystem.unreadIds(list)` and `receiptAt(unread, nowUtcMs)` (= max of now and the newest unread `sentAtUtcMs`, through `UtcEpochMs.compare`).
- Delete `markRead`, `readBeforeSent` and `NotificationReadBeforeSent`.
- `MarkNotificationsRead(userId, ids, readAtUtcMs)` replaces `MarkNotificationRead` in `InboxPorts`. The adapter writes one `writeBatch` of root `readAtUtcMs` updates (at most 50).

Rules:

- `allow update: if isOwner(uid) && affectedKeys().hasOnly(['readAtUtcMs']) && resource.data.readAtUtcMs == null && request.resource.data.readAtUtcMs is int && request.resource.data.readAtUtcMs >= resource.data.sentAtUtcMs`.

Web:

- A root `InboxStore` (`observeInbox` + `shareReplay(1)`) feeds both the menu badge and the page, so there is one listener.
- The page lives in a new lib, `libs/features/client/notifications`, at route `account/notifications` (guarded like `/account`). It uses a `ui-sheet-headline` title and `ui-list-group` rows.
- `inbox.presenter.ts` + `.vm.ts` use an exhaustive switch on `notificationTopic`. A `WAITLIST_MATCH` row deep-links to `/book?waitlist={id}&day={localDate}`; appointment topics link to `/account/appointments`.
- On entry, the page snapshots the unread ids (for the dots, drawn as accent discs), then makes one receipt call. This is an automatic action, not a «mark all read» button (quiet chrome).

**DEP-F14.**

- The read stamp becomes one-shot and can never predate the message; `readBeforeSent` is replaced by a clamp at construction time.
- The menu row routes to `/account/notifications`.
- Reverses the KEEP-PARKED status of the read stamp.

**Size** M.

**Copy (bg / en).**

- Page title: the existing `landing.menu.notifications` («Известия» / "Notifications").
- `notifications.empty`: «Няма известия» / "No notifications".
- `notifications.topic.WAITLIST_MATCH.title`: «Освободи се час» / "A time opened up"; `.detail`: «{{day}} · {{time}}»; `.label` (the accessible name): «Освободи се час: {{day}}, {{time}}. Запиши се» / "A time opened up: {{day}}, {{time}}. Book it".
- `APPOINTMENT_REMINDER`: «Напомняне за часа ти» / "Reminder: your visit".
- `APPOINTMENT_CHANGED`: «Часът ти е променен» / "Your visit has changed".
- `REWARD_GRANTED`: «Имаш нова награда» / "You've got a new reward".
- `ANNOUNCEMENT`: its own `LocalizedText`.
- Any other dictionary member gets words in the same short pattern, in the same commit (the switch is exhaustive).
- **Addendum (fixer round, 2026-10-26, worded under OR-55):** `notifications.unread`: «Ново» / "New" — the unread word a screen reader hears first in an unread row's description (`aria-describedby`, beside the age: «Ново, преди 2 ч»). The accent dot is a shape with no words, and the row's `.label` replaces everything the row holds, so without it the unread state and the age reached no screen reader (WCAG 1.3.1). The `.label` stays exactly as worded above.

---

## Part D — Dead and parked code

### OR-20 — The seven lifecycle write wrappers are deleted

**Context.** `confirm`, `complete`, `markNoShow`, `cancel`, `reopenNoShow`, `reopenSettled` and `markSeatOutcome` (`appointment-lifecycle.system.ts:615-781`) have no production caller. Three of them return a bare `Appointment` with no audit fact and no `WriteOp`: a second door around `transition`.

| Option                                                                     | C/S/P/T/U/M/R     |
| -------------------------------------------------------------------------- | ----------------- |
| **A. Delete them; re-target their specs to `transition` with a `ShopNow`** | **5/5/5/5/4/5/5** |
| B. Keep them parked                                                        | 4/4/5/2/4/2/5     |
| C. Make them the public API                                                | 4/4/5/3/4/2/3     |

**Decision: A.** `transition` (plus `cancelByClient`) is the one public write surface. Keep the spec case counts. A case that relied on `today = null` becomes "a reopen on another shop day is refused". `billing.system.spec.ts:189/:281` uses `transition(...).appointment`.

**DEP-F15** reverses pass C D-3 KEEP-PARKED. **Size** M.

### OR-21 — `IntervalSetSystem.clip` is deleted

It is `intersect(xs, [bound])` under a second name, with no caller (re-grepped). Scores: A delete **5/5/5/5/5/5/5** vs B keep 5/5/5/3/5/3/5. **Decision:** delete it, and fold its spec cases into `intersect`. **DEP-F16** reverses pass C KEEP-PARKED. **Size** S.

### OR-22 — The catalogue edge guards: `parseWeek` is live and gets a midnight fix; the dead members go

**Context.**

- `DayHours.parseWeek` is **live**: the landing runs both weeks through it at module load (`locations.component.ts:129-133`, re-read).
- It checks the close with `MinuteOfDay.of` (`opening-hours.data.ts:111`, re-read), which rejects 1440, so a shop open until midnight can't be written down.
- `ServiceComposition.parse`, `CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES` and `LocationInvalidTimezone` have no producer.
- No admin location writer exists, and the rules deny location writes.

| Option                                                                                                     | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. Keep `parseWeek`, close with `EndMinute.of`; delete `parse` and the two dead codes; no admin writer** | **5/5/5/5/5/5/5** |
| B. Delete the whole family                                                                                 | 4/5/5/4/4/5/5     |
| C. Build an admin location writer                                                                          | 5/4/4/5/4/2/3     |

**Decision: A.** Flip-4 OQ-11 becomes the preflight's P1 check (OR-35).

**DEP-F17.** `parseWeek` is ruled live, not parked, and a 24:00 close is accepted. **Size** S.

### OR-23 — `SetDayWindows`, `FlexibleWhen.withWindows` and the `DayWindows` writers are deleted

**Context.** None is ever dispatched or called (re-grepped). The owner ruled on 2026-08-01 that the client watches one whole day. The stored `windows` field and its readers stay.

| Option                                                   | C/S/P/T/U/M/R     |
| -------------------------------------------------------- | ----------------- |
| **A. Delete the write verbs and keep the stored schema** | **5/5/5/5/5/5/5** |
| B. Build a window sheet                                  | 5/5/4/4/3/3/4     |
| C. Remove windows from the stored model                  | 4/5/5/5/5/4/2     |

**Decision: A.** **DEP** none (closes the pass B flag). **Size** S.

### OR-24 — The impersonation web scaffolding is removed, `/admin` redirects, and a read-as contract is written down

**Context.**

- `impersonation-banner.ts` has an empty template and is mounted on every page.
- `/admin` lazy-loads a page that says «AdminImpersonation works!» (re-read): a live visible defect.
- The server callables write an inert, audited ledger. Nothing consumes a session (no token, no rule), so no "act as" capability exists.

| Option                                                                                                                                      | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Status quo                                                                                                                               | 3/4/5/3/1/2/5     |
| **B. Delete the banner and the `admin/impersonation` lib; `/admin` → `/admin/loyalty/rhythm`; keep the server ledger; record the contract** | **5/5/5/4/5/4/5** |
| C. Delete impersonation end to end                                                                                                          | 5/5/5/5/5/5/3     |
| D. Build read-as now                                                                                                                        | 4/3/4/4/4/2/2     |

**Decision: B.**

**The contract for any future read-as**, written into HANDOFF §6. All of it ships in ONE change:

- a custom token of at most 15 minutes with claims `{imp, impBy, impScope}`;
- a banner that reads those claims from the ID token (no Firestore read);
- rules that deny every write under `imp` with `READ_ONLY` scope;
- `Actor.impersonator` audit rows.

**Genuine product decision flagged.** If the owner says impersonation will never ship, take C (reversible through git).

**DEP-F18.** The slot is dropped, and `/admin` redirects. **Size** S.

**Copy.** None ships now. Future banner: «Действаш като {{name}} · Край» / "Acting as {{name}} · End".

### OR-25 — The customers client write grant is closed

**Context.** `allow create, update: if worksTheBook()` has no field validation (`firestore.rules:354`, re-read), and there is no web writer. Any staff session could set `userId` to another account's uid and expose the record to it (`:353`): a cross-person data exposure.

| Option                                                                 | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------- | ----------------- |
| **A. `allow create, update: if false`; the server is the only writer** | **5/5/5/5/5/5/5** |
| B. Keep the grant and validate fields                                  | 4/3/5/2/5/2/4     |
| C. Status quo                                                          | 3/2/5/3/5/3/5     |

**Decision: A,** with rules integration cases (receptionist, admin and client are each denied create and update; reads are unchanged). Walk-in records come from the server (OR-26).

**DEP-F19** closes pass B flag (b). **Size** S. **Security fix.**

### OR-26 — «Нов клиент» creates a server-authoritative walk-in client record (built now)

**Question.** How does «Нов клиент» create a client, and should `CustomerOrigin.StaffWalkIn` be wired?

**Context: live silent data loss.**

- «Нов клиент» creates no record.
- `StaffEditDraft.Client` has no email (`staff-edit-draft.data.ts:118-122`, re-read).
- Edits send `guestSubject(label)` only.
- Creates send `draft.clients[0]`'s phone, with `email: null` (`staff-edit-plan.system.ts:541-556`, re-read).

So the phone and e-mail the barber typed vanish. A walk-in never comes back in staff search, and has no history and no card.

| Option                                                                                                                   | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **A. A server-created `customers/{CustomerId.forWalkIn(...)}` record, deterministic id, with a `WALK_IN` seat occupant** | **5/5/5/5/5/3/4** |
| B. Contact per seat on the appointment, no record                                                                        | 4/4/5/3/3/4/4     |
| C. Label-only walk-ins (hide the fields)                                                                                 | 3/5/5/4/1/5/5     |
| D. Status quo                                                                                                            | 2/4/5/3/1/3/5     |

**Decision: A.**

The record:

- `CustomerId.forWalkIn(contactKey, hash)` = `cus_` + a hash of `'walkin/v1:'` + the E.164 phone, or else the lowercased e-mail.
- A name-only walk-in stays `ANONYMOUS`, because a name key would mint duplicates.

ecs-core:

- `SeatSubject.WalkIn = { seatSubject: 'WALK_IN'; subjectCustomerId; guestLabel }`.
- The Guest `AddedSubject` gains `contact { phone: E164 | null; email: Email | null }`, parsed once at the callable edge.
- `CustomerRecordSystem.walkInCreates` creates when absent, with `userId: null`, `STAFF_WALK_IN` and search keys from `SearchFieldsSystem`.
- The book and edit pipelines add the walk-in ids to the existing phase-one `getAll` (`readCustomers`, live now) and append the creates.
- `StaffEditDraft.Client.email: string | null`, and `StaffEditPlanSystem` sends a contact for every drafted guest.

Search:

- A customers search adapter (`searchPrefixes` array-contains, with a limit) merges with the accounts results through `ClientQuerySystem`'s ranking. Rows from a walk-in record show «Без профил».
- The composite index is declared in `firestore.indexes.json` in the same change, and is deployed before the web.

**Rationale.**

- Losing what the barber typed is the worst kind of form failure.
- The deterministic id gives dedupe and idempotency with no query: a retried save can't duplicate, and the same phone gives the same record.
- `CustomerId` and `UserId` stay distinct (Law 7.4).
- Records stay server-written, which OR-25 enforces.

**Consequences.** Every `SeatSubject` switch must handle `WALK_IN` (the compiler checks it). Old `ANONYMOUS` seats stay valid.

**DEP-F20 (schema).** A new `SeatSubject` variant, `WALK_IN`, which flatten-spec §5.5 anticipated. Adopting the record at registration is deferred.

**Built (fixer round, security review): the hash is KEYED.** `CustomerId.forWalkIn(contactKey, keyedHash)` takes the `KeyedHash` of `WalkInKeyPorts` — HMAC-SHA-256 under the server's Secret Manager secret `WALKIN_ID_KEY`, bound to `commitBooking` and `staffEditAppointment` only — never the plain `Hash`. The id sits on every visit that seats the walk-in, where the visit's owning client can read it, and an unkeyed SHA-256 of a Bulgarian mobile number brute-forces back in seconds (a few tens of millions of candidates). Under one key the id is as deterministic as before, so the dedupe and the retry idempotency hold; `forUser` stays on the plain hash (a uid is not contact data). The owner creates the secret before the first functions deploy (runbook step 4); the emulator reads a fixed TEST value from the build's `.secret.local`, which `firebase.json` never deploys.

**Size** L (built now: data loss).

**Copy.** `staff.client.noAccount`: «Без профил» / "No account". The form labels are reused.

### OR-27 — The lead-time sampler stays ungated

**Context.** The supposed gate doesn't exist in code (`main.ts:670-675`). The data can't be backfilled, has a 400-day TTL, and costs about one write per barber per day. Four documents still claim a gate.

| Option                                  | C/S/P/T/U/M/R     |
| --------------------------------------- | ----------------- |
| **A. Keep it ungated and fix the docs** | **5/5/5/5/5/5/5** |
| B. Implement the gate, default off      | 4/5/5/4/3/4/4     |
| C. Delete the sampler                   | 3/5/5/4/2/5/1     |

**Decision: A.** Fix the `scheduling.port.ts:331-336` JSDoc and runbook :133, and add superseded notes at ecs-migration :424 and :517.

**DEP-F21** supersedes the ecs-migration "gated off" plan. **Size** S.

### OR-28 — Triage of the remaining parked items (pass E §7.3)

| Option                      | C/S/P/T/U/M/R     |
| --------------------------- | ----------------- |
| **A. Triage each item**     | **5/5/5/5/5/4/4** |
| B. Keep everything parked   | 3/4/5/2/2/2/5     |
| C. Delete everything parked | 3/4/5/4/2/5/4     |

**Decision: A.**

- **Wired:** the grant verbs (OR-13), the read receipt (OR-19), `readCustomers` (OR-26), and `loadCouponGrant`, reshaped (OR-13).
- **Deleted:** `VoucherSystem.issue` / `redeem` (OR-14), `CouponGrantSystem.expire` / `revoke` / `termsOf` (OR-13), `loadWaitlistRequest` (port, functions adapter and double; no caller, re-grepped), and `EngagementErrorCode.BadgeCategoryOrderNegative` (no producer, re-grepped).
- **Kept, no action:**
  - `parseIsoIn` (the e2e seed uses it; see OR-43) and `GridLayoutSystem.closedRuns` (live consumers);
  - `ShopDayFrame` and the historical docs;
  - `CancellationAttribution.Shop` and the `StreakTrackMarkKind` members (closed vocabularies);
  - the test polyfills, the stylelint override, the showcase snapshots, the visit-row tone unions and the `TRANSIENT_CODES` spelling;
  - `setLegClient`, the spec titles, the «Запази» offline limit, the SiteFooter / ui-lang items and R-1;
  - `metric.ts` (one formatter per animation run, measured).

**DEP-F22** reverses the KEEP-PARKED status of the listed items. **Size** S for this triage (the wiring is sized in its own ORs).

---

## Part E — Security and operations

### OR-29 — Firebase Hosting serves a strict hash-based CSP and a full security header set

**Context.** `firebase.json` has no `headers` block (re-read: only `predeploy` and `public`). `csp-baseline.md` is the stale Phase-0 record (SSR nonces, Google Fonts). Measured at `1322b782`:

- The built `index.html` has two static inline scripts: the pre-paint theme script and Beasties' media swap.
- There is no nonce.
- There are zero `innerHTML` / `bypassSecurityTrust` / `eval` sinks.
- The origins are Firestore, Auth, Storage, the default-region callables and OpenFreeMap.

| Option                                                                                                                                    | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. A static hash CSP with exact host allowlists, plus HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP, XFO and cache headers** | **5/4/5/4/5/4/5** |
| B. Angular `autoCsp` (experimental)                                                                                                       | 4/4/3/3/5/3/4     |
| C. Per-request nonces through a function                                                                                                  | 4/5/2/4/4/1/3     |
| D. No headers                                                                                                                             | 3/1/4/3/5/5/5     |

**Decision: A.** On `**`:

`Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-<theme>' 'sha256-<beasties>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://firebasestorage.googleapis.com; font-src 'self'; media-src 'self'; connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com https://us-central1-<PROJECT_ID>.cloudfunctions.net https://tiles.openfreemap.org; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`

About the hashes:

- The two hashes are **computed by the gate** (OR-31), never typed by hand.
- Measured values at `1322b782`: theme `sha256-SoSGhLyDOR6S9joKx8MYwWpYCgO7Xq97FpXNpYMBpxI=`, Beasties `sha256-LMY6wYoFV9I4wWzxaq1N/dTpl4iurQktw706UCHK3vM=`.
- `<PROJECT_ID>` is the literal of the `.firebaserc` default. OR-35 P5/P6 refuse a mismatch or the placeholder.

The other headers:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`. No `preload` until the apex domain is fixed.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`.
- `Cross-Origin-Opener-Policy: same-origin`.
- `X-Frame-Options: DENY`.

Caching:

- Hashed `**/*.@(js|css)`: `public, max-age=31536000, immutable`.
- `index.html`, extensionless routes, `ngsw.json`, `ngsw-worker.js`, `safety-worker.js` and `manifest.webmanifest`: `no-cache`.
- Unhashed media: `max-age=86400`.

**Rationale.** A real XSS barrier on scripts at zero runtime cost. Exact hosts, never `*.cloudfunctions.net`. The cache split keeps the service-worker update channel healthy.

**Consequences.** `csp-baseline.md` is rewritten from scratch.

**DEP-F23 (doc).** No nonces, no Google Fonts, style `'unsafe-inline'`.

**Size** M. **Security gap closed before the first deploy.**

### OR-30 — Enforce at launch; Trusted Types as Report-Only; violations go through the in-app sink

| Option                                                                                                                                                                                                                           | C/S/P/T/U/M/R     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. Enforce the main policy, proven by the smoke; `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'; trusted-types angular angular#bundler`; a `securitypolicyviolation` listener feeds the OR-34 sink** | **5/5/5/5/5/4/5** |
| B. Report-Only for weeks, with a public report endpoint                                                                                                                                                                          | 4/3/4/3/5/2/5     |
| C. Enforce with no proof                                                                                                                                                                                                         | 3/4/5/4/2/5/4     |

**Decision: A.** No production users means nothing for a learning period to protect.

- The listener is registered in `apps/web/src/main.ts` before bootstrap. It drops extension sources and buffers into the reporter.
- Enforcing Trusted Types is a follow-up (§deferred). One creative path: replace MapLibre's attribution control (its only `innerHTML`) with a DS footnote.
- **Built (fixer round):** the listener also drops the measured MapLibre baseline — a report-only `require-trusted-types-for` violation whose sample is one of the three of `MAPLIBRE_REPORT_ONLY_SINKS` (`@creativo/infrastructure/firebase-app/csp-baseline`, the one list the OR-31 smoke tolerates them by). Every map render trips them; reported, they would spend the callable's shared throttle on every landing and `/book` visit and keep the `client_issue_count` alert lit. An enforced violation, and every other report-only one, is still reported.

**DEP** none. **Size** S.

### OR-31 — `verify:csp` proves the real artifact before a deploy

| Option                                                                                                                                                                        | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A. A static hash gate in CI, plus a hosting-emulator Playwright smoke (desktop + Pixel 7) on a generated config that differs from production only by the emulator origins** | **5/5/5/5/5/3/5** |
| B. Dev-server headers                                                                                                                                                         | 2/3/5/2/4/4/5     |
| C. A manual staging pass                                                                                                                                                      | 3/3/5/3/4/4/2     |

**Decision: A.**

- `tools/verify/csp/check-csp.mjs` does three things:
  - recomputes every inline script hash;
  - requires `script-src` to list exactly those hashes;
  - refuses `'unsafe-eval'`, script wildcards, a nonce and a missing header.
- `tools/verify/csp/emulator-config.mjs` writes an untracked superset config. The set difference is asserted.
- `apps/web/playwright.csp.config.mts` + `apps/web/e2e/csp/csp-smoke.spec.ts` walk a route table as guest, client, staff and admin. The run fails on any violation of either disposition and on any missing header.
- Add a `csp-smoke` build configuration (production minus the environment replacement and minus the service worker).
- CI runs the static gate. The FULL gate (HANDOFF §4) gains `verify:csp`.
- Check `firebase --help` for the exact global config flag before writing the script.

**DEP** none. **Size** M.

### OR-32 — Firebase Auth uses `initializeAuth` with no popup/redirect resolver

**Context.** The provider calls `getAuth` (`firebase-app.provider.ts:72`, re-read). On mobile and Safari, `getAuth` proactively loads `apis.google.com` and an auth iframe, though the app signs in only with custom tokens.

| Option                                                                                                                         | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **A. `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })`** | **5/5/5/5/5/5/5** |
| B. Keep `getAuth` and allow Google's hosts                                                                                     | 4/2/2/3/5/4/5     |

**Decision: A.** It removes a third-party script and iframe from every phone load and shrinks the auth chunk. The provider spec asserts there is no resolver, and `verify:bundle` records the delta.

**DEP** none. **Size** S.

### OR-33 — The read guard is a required parameter; the unguarded value is fenced into test support

**Context.**

- `UNGUARDED` is the default parameter of the shared web reads (`observe.ts:284/:315`, re-read) and of four web adapters.
- `StoredDocumentSystem.unguarded` is the default in three functions adapters.
- The production roots pass the real guard. The next new composition site would silently read unguarded.

| Option                                                                                                                                  | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep the default                                                                                                                     | 4/3/5/3/5/4/5     |
| B. Guarded default; fill in every partial fixture                                                                                       | 5/4/5/4/5/2/4     |
| **C. No default; `UNGUARDED` / `unguarded` move to test support behind a lint ban; integration specs and the seed pass the REAL guard** | **5/5/5/5/5/4/5** |

**Decision: C.**

- `StoredDocumentSystem.unguarded` moves to `@core/testing`. The web `UNGUARDED` moves to the firestore lib's testing entry.
- The root ESLint config bans both names outside `**/*.spec.ts`, `**/testing/**` and `**/test-support/**`. Add a runbook §4 grep gate.
- The seed (`tools/seed-dev-catalog.mjs:682`) passes `guardOf` through `load-domain.mjs`.

**DEP-F24** reverses edge-hardening DEP-11:

- a bare adapter no longer type-checks;
- the seed and the integration specs read through the guard;
- a malformed seeded body refuses the seed run, which is intended.

**Size** M.

### OR-34 — A first-party client issue sink: the `reportClientIssues` callable into Cloud Logging

**Context.** Data-layer logs and uncaught errors end at Angular's default `console.error`; no custom `ErrorHandler` exists. The backend already uses structured Cloud Logging and Error Reporting (§9 D11(a)).

| Option                                                                         | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------ | ----------------- |
| A. Console only                                                                | 3/5/5/4/2/5/5     |
| B. A Sentry SDK                                                                | 4/3/3/2/4/3/3     |
| **C. A first-party callable with closed, allowlisted, scrubbed issue structs** | **5/5/5/5/4/4/5** |
| D. An `onRequest` beacon endpoint                                              | 4/3/5/3/4/3/5     |

**Decision: C.**

ecs-core:

- `components/client-issue.data.ts`: `ClientIssue` and the `ClientIssueKind` dictionary (`DATA_DOCUMENT_DROPPED`, `DATA_DOCUMENT_REFUSED`, `CHUNK_LOAD_FAILED`, `UNCAUGHT_ERROR`, `UNHANDLED_REJECTION`, `CSP_VIOLATION`).
- `errors/client-issue.error.ts` (`CLIENT_ISSUE_BATCH_REFUSED`, with a reason tag).
- `systems/client-issue.system.ts`: `scrub`, `fingerprint`, `admitBatch` (length caps, `collection/id` path shapes).
- `pipelines/report-client-issues.pipeline.ts`: one log line per issue, typed `ReportedErrorEvent` for the error kinds.

Functions:

- `onCall({ maxInstances: 2, concurrency: 80, memory: '256MiB', timeoutSeconds: 10 })` with a per-instance token bucket.
- At most 10 issues and 4 KB per call.

Web:

- A `ReportingErrorHandler` (keeps the console output, classifies, never reports itself).
- A reporter adapter (dedupe, at most 20 per page session, batches of 10 or 3 s, flush on `visibilitychange: hidden`, a lazy `httpsCallable`).
- The route PATTERN, not the URL.

Ops: a logs metric `client_issue_count` by kind, alerting above 100 per 5 minutes.

**Privacy by shape:** no uid, only a role and an authed flag. Messages are scrubbed of e-mails, digit runs of 4 or more and long tokens, and capped at 160 characters.

**DEP-F25.** The web gains a custom `ErrorHandler`, and scrubbed structs leave the device. Owner note: a privacy-policy line ("diagnostic data under legitimate interest, 30-day Cloud Logging retention, no personal identifiers") is the owner's to publish.

**Size** M.

### OR-35 — The production preflight is a fail-closed predeploy; `loc-center` stays the default id

| Option                                                                                                                         | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| A. The manual curl in the runbook                                                                                              | 3/4/5/2/4/4/5     |
| **B. A read-only `pnpm run preflight` reusing the domain through `load-domain`, wired as the hosting and functions predeploy** | **5/5/5/5/5/4/5** |
| C. The default zone from an env flag                                                                                           | 3/4/5/1/4/3/4     |

**Decision: B.** `tools/verify/preflight/preflight.mjs` prints a PASS/FAIL table:

| Check | What it proves                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------- |
| P1    | `locations/<TenantConfig.DEFAULT.defaultLocationId>` exists and `TimeZone.parse` accepts its zone |
| P2    | all seven `purgeAt` TTLs are ACTIVE                                                               |
| P3    | every declared composite is READY; extra project indexes are listed as INFO (prune candidates)    |
| P4    | the built bundle has no `REPLACE_ME` and names the projectId                                      |
| P5    | CSP `connect-src` names the project's functions host                                              |
| P6    | no emulator env vars, and no placeholder or `demo-*` project                                      |
| P7    | every `@emulatorOnly` export is used only behind `onEmulator()` — functions scope (2026-10-26)    |

- `CREATIVO_SKIP_PREFLIGHT=1` is the loud escape hatch.
- **P7 (orchestrator addition, 2026-10-26).** The functions still wire the
  console OTP sender, which logs every sign-in code and delivers none — the
  launch blocker of `docs/production-deploy.md` §1. Its adapter, the
  fixed-code OTP crypto and its code carry an `@emulatorOnly` JSDoc tag. P7
  builds an in-memory TypeScript program over the files of
  `apps/functions/src` that `tsconfig.app.json` builds, follows every use of
  a tagged export through renamed imports, re-exports and namespaces back to
  its declaration (so a rename keeps the anchor; two rounds of adversarial
  review beat a name-based first draft, then a lazy barrel load and a tag
  that drifted off its export), and fails the functions predeploy on any use
  outside `onEmulator() ? … : …` or `if (onEmulator())` — the shape the OTP
  crypto already has — or inside another tagged declaration. A run-time
  `import()`/`require()` of a module exporting one is judged at the load, a
  non-literal one fails, and a tag anywhere but on an exported top-level
  `const` or `function` fails. The provider change keeps the console sender for the emulator
  behind that gate, and P7 then passes with no edit to the preflight.
- Runbook §2.3 and §3 replace the manual steps with the preflight and keep the gcloud lines as a fallback.

**Genuine product decision, safest reversible default.** The production default id stays `loc-center`. Ids are opaque, and changing it later is one constant plus one document, which the preflight then checks. This closes flatten-spec OQ-2 and flip-4 OQ-11.

**DEP-F26.** Deploys refuse to run until the preflight passes. **Size** M.

### OR-36 — Deleted indexes #1/#3/#9 and the re-keyed `wl_` ids: moot for a first deploy, rule recorded

**Context.** No hosted project has ever existed (`.firebaserc` names the placeholder).

| Option                                           | C/S/P/T/U/M/R     |
| ------------------------------------------------ | ----------------- |
| **A. Close as moot and record the general rule** | **5/5/5/5/5/5/5** |
| B. Bespoke staging plus a migration script       | 4/5/4/3/5/2/4     |
| C. Leave it open                                 | 4/5/5/3/5/5/5     |

**Decision: A.** Runbook §3 step 6 prunes deleted composites on a project deployed from a tree older than `6b1a7a81` (P3 lists them). A hosted project holding old `waitlistRequests` is wiped (§5: no backfill). **DEP** none. **Size** S.

---

## Part F — Programs (flip 4)

### OR-37 — The event's location becomes a shop picker; the admin page goes through the catalogs

**Context.**

- The field is free text (`admin-programs.html:268-275`), checked only by `LocationId.parse`. Nothing checks that the shop exists.
- The label hard-codes «Starts at (Europe/Sofia)» (`:259`, re-read), which goes against Law 7.2.
- The page has only 2 `t()` calls (re-counted); everything else is English literals.
- `CATALOG_PORTS.observeLocations` and `ui-choice-menu` already exist.
- The copy says events happen "at Creativo".

| Option                                                                                                                                                                                  | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Free text                                                                                                                                                                            | 2/2/5/2/1/4/5     |
| **B. A `ui-choice-menu` over the active shops + «Без конкретен салон» (null); existence checked by the system and by rules `exists()`; `/events` shows the shop at multi-shop tenants** | **5/5/4/5/5/4/4** |
| C. B + outside-venue fields                                                                                                                                                             | 4/4/4/4/4/2/4     |
| D. A tagged venue union                                                                                                                                                                 | 4/4/4/4/4/1/3     |

**Decision: B.**

- An edited event whose stored shop is hidden or deleted keeps that id as an extra option, labelled hidden or deleted.
- The row is hidden when the tenant has one shop.
- Add `ProgramsSystem.eventShop(event, shops)`, a linear scan.
- `/events` gets a Law-10 `marketing-events.presenter.ts` + `.vm.ts`. The lookup is built once per emission. If the shops read fails, rows show the date alone and are never hidden.
- **The admin programs page's remaining literals move to `admin.programs.*` (bg + en) in the same package,** so the page isn't left half-translated.
- Rules: `validEvent` adds `(d.locationId == null || exists(/databases/$(database)/documents/locations/$(d.locationId)))`. Deploy the rules before the web.

**DEP-F27.** Takes back flip-4 F4-2's exclusions (the picker, the zone label). Extends pass E DEP-7. Adds a visible shop on `/events` at multi-shop tenants.

**Size** M.

**Copy (bg / en).**

- `admin.programs.event.shop`: «Салон» / "Shop"
- `admin.programs.event.shopNone`: «Без конкретен салон» / "No specific shop"
- `admin.programs.event.startsAt`: «Начало — по часа на салона» / "Starts — shop's local time"
- `admin.programs.shopHidden`: «{{name}} (скрит)» / "{{name}} (hidden)"
- `admin.programs.shopMissing`: «Изтрит салон» / "Deleted shop"
- The `/events` line: «пн, 5.10, 19:00 · Център».

### OR-38 — An event naming no existing shop is refused

**Context.** `ProgramsSystem.zoneOf` plus the pipeline's second read silently fall back to the default shop's zone (`programs.system.ts:317-327`, `program-content.pipeline.ts:146-152`).

| Option                                                                                                                         | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| A. Keep the fallback                                                                                                           | 2/3/3/3/2/3/5     |
| **B. Refuse with `ENGAGEMENT_SHOP_EVENT_LOCATION_UNKNOWN { locationId }`; null → the default shop; exactly one location read** | **5/5/5/4/4/5/4** |
| C. Strip the id                                                                                                                | 3/3/3/3/1/3/4     |

**Decision: B,** in the same commit as the picker.

- Add the edge row `FailedPrecondition`.
- `submitEvent` prints `errors.<errorCode>`, with the generic line as fallback.

**DEP-F28.** Retires half of F4-1 (c). Three pinned specs change on purpose.

**Size** S.

**Copy.** «Този салон вече не съществува. Избери друг.» / "That shop no longer exists. Pick another."

### OR-39 — The public programs lists keep no read guard

The rules' `validPosition`, `validCourse` and `validEvent` shape checks (pass E DEP-7) are the guard, and no Admin SDK writer of programs exists.

| Option                  | C/S/P/T/U/M/R     |
| ----------------------- | ----------------- |
| **A. Keep it dropped**  | **4/4/5/5/4/5/5** |
| B. A per-document guard | 5/4/3/3/4/2/4     |
| C. A per-list guard     | 3/4/3/3/1/3/4     |

**Decision: A.** Revisit only if an Admin SDK writer appears, which then joins the guarded set (OR-33). **Size** none.

### OR-40 — Flip-4 OQ-4, OQ-6, OQ-8 and OQ-9 are closed

| Question | Ruling                                                                                           | Evidence                                         |
| -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| OQ-4     | Already applied; legacy libs deleted                                                             | `libs/domain` and `libs/application` don't exist |
| OQ-6     | Already applied; `CLOCK_PORTS` / `ID_PORTS` only                                                 | `ID_GENERATOR` has no hits                       |
| OQ-8     | Keep the shared cached `formatWallClock`; the OR-37 presenter calls it once per row per emission | `marketing-events.ts:145-152`                    |
| OQ-9     | The `datetime-local` value stays strictly `YYYY-MM-DDTHH:mm`                                     | one producer, which never emits seconds          |

Scores: close **5/5/5/5/5/5/5** for each. **Size** none (docs).

### OR-41 — The dev seed creates programs through `ProgramsSystem`

| Option                                    | C/S/P/T/U/M/R     |
| ----------------------------------------- | ----------------- |
| A. No seed                                | 4/5/5/4/2/5/5     |
| **B. A small set built as engine output** | **5/5/5/5/5/4/5** |
| C. Hand-written JSON                      | 3/5/5/2/5/3/5     |

**Decision: B.**

- 2 positions (one open, one closed), 3 courses (open, upcoming, closed) and 2 events (shop today +14 days and −30 days).
- Fixed ids: `pos-barber`, `crs-fundamentals`, `evt-open-studio`, … .
- `tools/seed/fixtures/programs.fixtures.ts`, `tools/seed/programs.mjs`, and `programs.spec.mjs` (the bodies pass the system and match the rules key sets).

**DEP-F29** reverses flip-4 Q5 ("no seed"). **Size** M.

**Copy.** Fixture titles: «Бръснар — пълно работно време» / "Barber — full time"; «Основи на бръснарството» / "Barbering fundamentals"; «Ден на отворените врати» / "Open studio day". Descriptions are written in the catalogue's «ти» voice.

### OR-42 — A position's shop scope is editable and never wiped

**Context.** An edit always sends `locationIds: []` (`admin-programs.ts:284-296`), which is pinned by spec :356. That is a latent data-loss trap. The `LocationScopeSystem.serves` semantics already exist.

| Option                                                                                                                  | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep the wipe                                                                                                        | 2/4/5/3/2/4/5     |
| B. Carry the scope forward with no UI                                                                                   | 4/4/5/4/3/5/5     |
| **C. Shop chips prefilled from the stored scope (none = every shop); `/careers` names the shops at multi-shop tenants** | **5/4/5/5/5/4/4** |
| D. Delete `locationIds`                                                                                                 | 4/4/5/4/3/4/3     |

**Decision: C.**

- Add `ProgramsSystem.positionShops(position, shops)`.
- `/careers` gets a `marketing-careers.presenter.ts` + `.vm.ts`.
- The chip row is hidden with one shop. Stored ids that aren't listed show as hidden or deleted chips.

**DEP-F30** retires the F4-8 wipe quirk and adds a visible label on `/careers`. **Size** M.

**Copy.** `admin.programs.position.shops`: «Салони» / "Shops"; `admin.programs.position.shopsAll`: «Всеки салон» / "Any shop".

---

## Part G — Brands and rules carried from pass C and pass D

### OR-43 — Applied defaults affirmed, and entries closed by later passes

Every row below scored **5** on T, the one-truth criterion. None changes behaviour, and none needs work beyond the docs package (W3-DOCS).

| Item                         | Ruling                                                                                                                                       | Why                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Pass C OQ-1 (DEP-1)          | Keep: «Отказан от клиента/салона» = the side the reason puts it on                                                                           | the card, the sheet and the statistics share one rule                |
| Pass C OQ-2 (DEP-2)          | Keep `BusySystem.chairOccupants` everywhere                                                                                                  | the client warns about exactly what the server refuses               |
| Pass C OQ-7 (DEP-4)          | Keep: "off all day" = empty roster                                                                                                           | the only rule whose write the server accepts                         |
| Pass C OQ-8 (DEP-5)          | Keep: booker identity in «Скорошни»                                                                                                          | a companion never wears the booker's name (privacy)                  |
| Pass C OQ-10                 | Keep the booking flow's orchestration in its store                                                                                           | signal transactions; the decisions are already systems               |
| Pass C OQ-12, OQ-14          | Closed (pass D D-10, DEP-1…6)                                                                                                                | landed                                                               |
| Pass D OQ-1                  | Keep the `TrackMinute` brand                                                                                                                 | Law 7.4                                                              |
| Pass D OQ-2                  | Keep helper types in type-only files                                                                                                         | one home per name                                                    |
| Pass D OQ-3 (DEP-6/7)        | Keep each visit on its own shop clock. **Recorded rule:** the day a tenant has shops in two zones, pooled cross-zone order uses `utcEpochMs` | Law 7.2                                                              |
| Pass D OQ-4                  | Keep `ZonedTimeSystem.parseIsoIn`                                                                                                            | the one ISO ingestion door with the DST rules (the e2e seed uses it) |
| Pass D OQ-5                  | Keep the `Log` level literals                                                                                                                | third-party sink vocabulary                                          |
| Pass D OQ-10                 | Keep `entities/loyalty-catalog.ts`                                                                                                           | its lowest lawful tier                                               |
| Pass D OQ-11                 | Keep the kebab icon diagnostics                                                                                                              | a DS console contract, not a domain code                             |
| Pass D OQ-12                 | Keep the pipeline error unions in `@core/errors`                                                                                             | the law, enforced by lint                                            |
| Pass D OQ-13                 | Keep the claims-tolerant, fail-closed role predicates                                                                                        | security holds by construction                                       |
| Pass D OQ-15/16              | Keep stored-currency formatting                                                                                                              | the data names its currency                                          |
| Pass D OQ-18                 | Keep reactive error re-wording                                                                                                               | consistency                                                          |
| Edge OQ-1, OQ-2              | Closed by pass E (E-1, E-2)                                                                                                                  | landed                                                               |
| Edge OQ-5                    | Reuse `REPOSITORY_MALFORMED`; no new code (words per OR-54)                                                                                  | one meaning, one code                                                |
| Law-10 OQ-1…OQ-3, OQ-6, OQ-8 | Their applied defaults stand                                                                                                                 | no gap found                                                         |

### OR-44 — Reserved document ids are refused by the id primitive itself

**Context.**

- `isReadableId` (`booking-read-set.pipeline.ts:126`) is opt-in at 9 sites in 4 pipelines (re-grepped).
- `idCompanion.parse` accepts `'.'`, `'..'` and `'__x__'`, so a forgetful edge builds a reference the SDK rejects, and the caller sees INTERNAL instead of a refusal.

| Option                                                                                                            | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep it in the pipelines                                                                                       | 3/3/5/2/4/4/5     |
| **B. Fold the check into `idCompanion.parse` / `is` / `isSpan` (`PRIMITIVE_ID_RESERVED`); delete `isReadableId`** | **5/5/5/5/5/5/4** |
| C. A separate primitive helper                                                                                    | 4/4/5/3/4/4/5     |

**Decision: B.**

- The checks: length 1 `.`, length 2 `..`, and length ≥ 4 wrapped in `__…__`. Length-gated, with no allocation.
- `distinctReadable` uses `XId.is`.

**DEP-F31.** A book or reschedule naming a reserved location id now gets the parse refusal (invalid request) instead of not found. **Size** M. **Copy** none (the existing invalid-request line).

### OR-45 — An `HourCount` primitive for the cancellation window

**Context.** `cancellationWindowHours: number` is re-validated at several sites. `SeatOutcome.cancelled` silently turns an invalid stamp into null (`seat-outcome.data.ts:93-96`).

| Option                                                                                                      | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep it raw                                                                                              | 4/5/5/3/5/4/5     |
| **B. An `HourCount` brand (`of`, `is`; whole hours, 0 to the `UtcEpochMs` span) + `UtcEpochMs.minusHours`** | **5/5/5/5/5/4/5** |
| C. A component-level brand                                                                                  | 5/5/5/4/5/4/5     |

**Decision: B.**

- `PRIMITIVE_HOUR_COUNT_OUT_OF_RANGE`.
- Retype `BookingPolicy`, `SeatOutcome.cancelled`, the policy-recompute job, the transition, cancel and recompute pipelines, and the stored seat guard.
- The silent-null branch is deleted.
- Add a `hourCount(n)` test fixture.

**DEP** none (stored values are unchanged). **Size** M.

### OR-46 — Cadence is measured in shop calendar days, with one gap rule for the card and the rhythm

**Context.**

- `cadenceOf` sums `UtcEpochMs.elapsedMs` (`client-stats.system.ts`, re-read: line ~490). Time of day and DST leak into a "~4 weeks" figure.
- `StreakSystem` uses `LocalDate` day gaps, skips same-day gaps, and claims in a comment to use "the cadenceOf rule".
- flatten-spec T8: multi-day spans are `LocalDate` arithmetic.

| Option                                                                                 | C/S/P/T/U/M/R     |
| -------------------------------------------------------------------------------------- | ----------------- |
| A. Keep instant gaps                                                                   | 3/5/5/2/4/4/5     |
| **B. `LocalDate.daysBetween` gaps, skip same-day gaps, one shared `Cadence.meanDays`** | **5/5/5/5/5/5/4** |
| C. B without sharing the helper                                                        | 5/5/5/3/5/4/4     |

**Decision: B.** A new `components/cadence.data.ts`. The projection recomputes naturally, with no backfill.

**DEP-F32.** `avgCadenceDays` becomes a mean of calendar-day gaps excluding same-day pairs. «на ~N седмици» changes only at rounding boundaries.

**Size** S.

### OR-47 — One theme writer, which saves only on an explicit choice

**Context.**

- `apps/web/src/app/shell/app-chrome.service.ts:31-37` (re-read) saves the resolved theme to storage on its first effect run. The first visit freezes the system light/dark setting forever: a live gap.
- A second writer, the shell's `ThemeService`, keeps its own copy of `UiTheme` and its own default.

| Option                                                                                                                                              | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep both writers                                                                                                                                | 3/5/5/1/3/2/5     |
| **B. One `ThemeService` in a `type:ui` lib, importing the tokens contract; `set()` saves; boot never saves; AppChromeService loses its theme half** | **5/5/5/5/5/5/4** |
| C. Let features import tokens                                                                                                                       | 5/5/5/4/5/4/4     |

**Decision: B.**

- `readInitial` reads the stamped `data-theme` attribute.
- A `matchMedia` listener follows the system while nothing is stored.
- The shell barrel re-exports the service, so the ~6 import sites are unchanged.

**DEP-F33.** A visitor who never toggled follows the system setting live. **Size** M.

### OR-48 — `E164.parse` for foreign phones

**Context.** `E164.of` is an unchecked cast. Two sites cast unproven input: the booking draft rehydrated from browser storage, and the landing's `phoneHref`.

| Option                                                                                                    | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep `of` only                                                                                         | 3/4/5/4/5/5/5     |
| **B. `E164.parse` (shape `^\+[1-9]\d{6,14}$`, no libphonenumber) + `is`; parse at the two foreign sites** | **5/5/5/5/5/5/5** |
| C. B + move it to primitives                                                                              | 5/5/5/5/5/3/4     |

**Decision: B.**

- `PRIMITIVE_PHONE_NOT_E164`.
- `of`'s JSDoc says "proven values only".

**DEP-F34.** A tampered draft phone rehydrates as null, and the review step asks again. **Size** S. **Copy** none.

### OR-49 — A `PersonKey` brand with one constructor module

**Context.**

- Two independent spellers declare their own prefixes (`guest-label.system.ts:30-39` and `visit-story.system.ts:38`).
- visit-story's JSDoc claims they spell keys identically, which is false for self (`self` vs `account:<uid>`).

| Option                                                                                                                                                           | C/S/P/T/U/M/R     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Keep it documented                                                                                                                                            | 3/5/5/2/5/4/5     |
| **B. `PersonKey` (`self()`, `account(uid)`, `guest(label)`, `equals`) in primitives; both systems, `StandingSeatPair.personKey` and the dashboard's set retype** | **5/5/5/5/5/4/5** |
| C. B + unify the self spelling                                                                                                                                   | 5/5/5/5/5/3/3     |

**Decision: B.**

- Spellings stay byte-identical, pinned by spec.
- A type-spec shows `SeatKeyText` is not assignable to `PersonKey`.
- Fix the false JSDoc.

**DEP** none. **Size** M.

---

## Part H — Copy

### OR-50 — The E-18 booking and staff refusal words are edited before they ship

**Context.**

- The four `*_INVALID_INPUT` lines say «Заявката не е валидна.», which is jargon and gives the user nothing to do.
- The FORBIDDEN lines say «Само служители…» to people who are mostly staff with stale claims.
- `BOOKING_STAFF_EDIT_FORBIDDEN` says something else, so one refusal has two lines.
- SLOT_TAKEN uses «час» in two senses in one sentence.

| Option                                                                                                                        | C/S/P/T/U/M/R     |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A. Accept them as shipped                                                                                                     | 4/4/5/3/2/5/5     |
| **B. Edit the clumsy lines; delete the four `*_INVALID_INPUT` keys (the surface's generic line answers); one FORBIDDEN line** | **5/5/5/5/5/5/5** |
| C. A family fallback in `wordPipelineError`                                                                                   | 5/5/5/5/5/3/4     |

**Decision: B.**

**DEP-F35** overrides pass E DEP-8's "no existing string changes" for `BOOKING_TRANSITION_FORBIDDEN`, `BOOKING_TRANSITION_INVALID_INPUT` and `BOOKING_STAFF_EDIT_FORBIDDEN`.

**Size** S.

**Copy (bg / en).**

- Deleted: `BOOKING_{CANCEL,ARRIVED,TIP,TRANSITION}_INVALID_INPUT`. They fall back to `BOOKING_CALL_FAILED`.
- FORBIDDEN (`BOOKING_{COMMIT,ARRIVED,TIP,TRANSITION,STAFF_EDIT}_FORBIDDEN` and `LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN`): «Нямаш права за това. Влез отново или питай администратора.» / "You don't have access to this. Sign in again or ask an admin."
- `BOOKING_TRANSITION_REOPEN_WINDOW_CLOSED`: «Приключен час може да се върне в работа само в същия ден.» / "A settled appointment can only be reopened on its own day."
- `BOOKING_TRANSITION_SLOT_TAKEN`: «Това време междувременно е заето — часът не може да се възстанови.» / "That time was taken in the meantime — the appointment can't be reinstated."
- `BOOKING_ARRIVED_NOT_ALLOWED`: «Часът е приключен — пристигането не може да се променя.» / "This appointment is settled — its arrival can't be changed."
- `BOOKING_TIP_NOT_FOUND`: «Този час вече не съществува или човекът не е в него.» / "That appointment no longer exists, or the person is no longer on it."
- Kept: `BOOKING_CANCEL_NOT_CANCELLABLE`, every `*_UNAUTHENTICATED`, every other `*_NOT_FOUND`.

### OR-51 — One voice («ти»), one word for barber («бръснар»), one retry phrase («Опитай пак»)

**Context.**

- About 75 bg strings are formal (`auth.*`, `onboarding.*`, the account completion and profile, the `IDENTITY_*` / `ACCOUNTS_*` / `ENGAGEMENT_*` / `REPOSITORY_*` errors, the recurrence errors).
- Everything else is «ти», and the two voices meet on one screen («Избери…» beside «Завършете…» in the account-dashboard baseline).
- «барбър/барбер» appears 6 times against 35 for «бръснар».
- Four retry phrasings coexist.

| Option                                                                | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------- | ----------------- |
| A. Keep the voice split by domain                                     | 4/5/5/2/2/4/5     |
| **B. «ти» everywhere, no «моля» / "please"; «бръснар»; «Опитай пак»** | **5/5/5/5/5/5/5** |
| C. «вие» everywhere                                                   | 5/5/5/5/3/3/5     |

**Decision: B.** One bg copy commit (en only loses "please").

- The legal line becomes «Продължавайки, приемаш Общите условия и Политиката за поверителност.»
- The landing role titles become «Главен бръснар», «Топ бръснар» and «Старши бръснар».

**Genuine product call** (there is no explicit voice ruling). This is the low-risk, reversible default; copy only.

**DEP** none of the laws. It reverses pass E's "voice by neighbour". **Size** M.

**Copy (bg / en).**

- `IDENTITY_CLAIMS_PROMOTION_FAILURE`: «Не успяхме да завършим регистрацията. Опитай пак.» / "We couldn't finish signing you up. Try again."
- `IDENTITY_REGISTRATION_USER_NOT_FOUND`: «Не намерихме профила ти. Влез отново.» / "We couldn't find your profile. Sign in again."
- `account.completion.title`: «Завърши профила си».
- `IDENTITY_OTP_WRONG_CODE`: «Този код не е верен — провери го и опитай пак.»
- The repository-failure family: «Нещо се обърка от наша страна. Опитай пак.» / "Something went wrong on our end. Try again."
- `BOOKING_CALL_FAILED`: «Нещо се обърка. Опитай пак.» / "Something went wrong. Try again."
- `account.tiles.book.subtitle`: «Избери бръснар, услуга и час».

### OR-52 — The rhythm page's refusals are worded, and its switch is exhaustive

**Context.** `RECOMPUTE_NEEDS_ENGINE` and `PREVIEW_STALE` have no words. `wordRefusal`'s `default` returns null (`admin-rhythm.ts:969`), so such a save fails silently. `CALLER_UNAUTHENTICATED` has the wrong words.

| Option                                                  | C/S/P/T/U/M/R     |
| ------------------------------------------------------- | ----------------- |
| A. No words                                             | 3/5/5/4/2/5/5     |
| **B. Word both codes; exhaustive switch, no `default`** | **5/5/5/5/5/5/5** |
| C. Everything goes to the generic line                  | 4/5/5/4/3/5/5     |

**Decision: B.** **DEP-F36** reverses pass E §8.2. **Size** S.

**Copy (bg / en).**

- `LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE`: «Досегашните ритми засега само се запазват.» / "For now, existing runs can only be kept."
- `_PREVIEW_STALE`: «Прегледът вече не е актуален. Запази отново.» / "The preview is out of date. Save again."
- `_CALLER_UNAUTHENTICATED`: «Влез отново, за да продължиш.» / "Sign in again to continue."

### OR-53 — The programs status words are translated

**Context.** bg.json holds English `"open"` / `"closed"` / `"upcoming"` (re-read). They print on the public `/careers` and `/courses` badges.

| Option                                       | C/S/P/T/U/M/R     |
| -------------------------------------------- | ----------------- |
| A. Keep the raw words                        | 5/5/5/4/1/5/5     |
| **B. Sentence case, agreeing with the noun** | **5/5/5/5/5/5/5** |

**Decision: B.** **DEP-F37** reverses the F4-7 default. **Size** S.

**Copy (bg / en).**

- `programs.status.position.OPEN`: «Отворена» / "Open"; `.CLOSED`: «Затворена» / "Closed".
- `programs.status.enrollment.OPEN`: «Отворен» / "Open"; `.UPCOMING`: «Предстоящ» / "Upcoming"; `.CLOSED`: «Затворен» / "Closed".

### OR-54 — `REPOSITORY_*` words state what each code means (supersedes the staff cluster's (g))

**Context.** All five codes say "couldn't save — please try again". `MALFORMED` is permanent, so "try again" is false advice.

| Option                             | C/S/P/T/U/M/R     |
| ---------------------------------- | ----------------- |
| A. Unchanged                       | 3/5/5/3/2/5/5     |
| **B. Word each code; no new code** | **5/5/5/5/5/5/5** |
| C. A new read code                 | 5/5/5/3/4/3/4     |

**Decision: B.** **DEP-F38** reverses edge OQ-4's default. **Size** S.

**Copy (bg / en).**

- `REPOSITORY_READ_FAILED`: «Не успяхме да заредим това. Опитай пак.» / "We couldn't load that. Try again."
- `REPOSITORY_WRITE_FAILED` and `_ALREADY_EXISTS`: «Не успяхме да запазим това. Опитай пак.» / "We couldn't save that. Try again."
- `REPOSITORY_UNAVAILABLE`: «Няма връзка в момента. Опитай пак след малко.» / "Can't connect right now. Try again in a moment."
- `REPOSITORY_MALFORMED`: «Този запис е повреден и не може да се използва.» / "This record is damaged and can't be used."

### OR-55 — Rules for every new refusal's copy

| Option                                | C/S/P/T/U/M/R     |
| ------------------------------------- | ----------------- |
| A. Each cluster writes its own lines  | 4/5/5/2/3/4/5     |
| **B. Fixed rules, checked in review** | **5/5/5/5/5/5/5** |

**Decision: B.** Every new `errors.<CODE>`:

- uses «ти» and sentence case;
- is at most two short sentences: first what happened, then the action;
- avoids «моля», «грешка» and «невалиден» when a plain word exists;
- offers «Опитай пак.» only when a retry can succeed;
- never promises that someone is looking into it;
- uses the staff vocabulary on staff surfaces;
- drops "please" in en;
- lands in bg and en in the same commit;
- uses `<CODE>.<reason>` for reasons.

A code no web surface can reach gets no words. The rules are recorded as a comment at the top of `word-pipeline-error.spec.ts`. **Size** S.

### OR-56 — The six regenerated baselines are accepted, and their two defects are fixed

**Context.** The six PNGs faithfully record revision 3, the accent law and the date-picker style. Three things in them are worth changing:

- (a) mixed voice, which OR-51 fixes;
- (b) an upcoming row's tile reads «сб / 1» for 1 June 2030, so the month and year appear nowhere, breaking the presenter's own "the caption says what the section does not" rule;
- (c) a filter row with a single chip «Предстоящи» repeats the group label, printing one fact twice.

| Option                                                    | C/S/P/T/U/M/R     |
| --------------------------------------------------------- | ----------------- |
| **A. Accept now; each fix regenerates its own baselines** | **5/5/5/5/4/5/5** |
| B. Hold the baselines                                     | 5/5/5/4/4/3/3     |
| C. Restore the old PNGs                                   | 2/5/5/2/2/4/5     |

**Decision: A.** Decides client-card-revision-3 §7.7 rule 2. Fixes (b) and (c) are **built now**: they are small live UX defects.

- **(b)** A system decides the grain of upcoming rows. The tile caption names the month, and the year outside the current year per R59 through the existing `yearIfElsewhere`. The fact line carries the weekday, with at most two «·».
- **(c)** A system answers "show the chip row" only when there are 2 or more chips.

Both regenerate `appointments-list-populated-{light,dark}` after viewing them.

**Size** S–M.

**Copy.** Fact line: «{{barber}} · {{weekday}}, {{time}}», e.g. «Иван Колев · сб, 10:00» / "Ivan Kolev · Sat, 10:00".

**DEP-F39 (integrator, at landing).** The upcoming tile names the month and never the year. The DS date tile is a 44 pt square whose caption is one line: «юни 2030 г.» measures 65 px and printed «юни 20…», half a fact. A booking lies within the booking horizon, so its month is unambiguous, and the row's accessible name keeps the year (R59). `VisitListSystem.tileGrain` answers `{ namesMonth }` alone, and the presenter clock's `withYear` went with it.

---

> **OR-57 – OR-59 — pass E's last open items (N-5, N-2, N-1).** The record
> above left them open (`HANDOFF.md` §6, `pass-e-leftovers.md` §7.2). The
> chief architect recommended each answer and the owner approved all three
> on 2026-10-26 (_"yes do those three"_); grounded on `main` at `2f75cb21`.

### OR-57 — Every reopen is refused while a live visit holds the chair it would take back (pass E N-5)

**Context.** A visit that leaves the book — cancelled, no-show, completed — frees its barbers' time once `rebuildBusy` runs, and a booking, the waitlist or a staff move may take it. Only a party reinstatement of a CANCELLED visit read the live appointments on its busy keys (#7, `isReinstatement` → `takenSince`); a `NO_SHOW → CONFIRMED` or a same-day `COMPLETED → CONFIRMED` reopen was admitted over whoever booked the chair since — a double booking. DEP-5 (pass E) made a reopen hold its chair at once; it refused nothing new.

| Option                                                                               | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------------------ | ----------------- |
| **A. Refuse every reopen whose returning seat collides — the answer a booking gets** | **5/5/5/5/4/5/5** |
| B. Let the shop knowingly overlap (a warning, then a second confirm)                 | 3/5/5/3/4/2/4     |
| C. Keep checking the cancelled party alone                                           | 2/5/5/3/2/5/5     |

**Decision: A.** `AppointmentLifecycleSystem.mayEndLive` (a move to a live status of a visit that is not live) replaces `isReinstatement` as the read predicate: such a move reads the #7 collisions and its busy days, as DEP-5's restore already did. `seatTakenSince` (replacing `takenSince`) asks of the visit AFTER the move: the first open seat it puts back that an open seat of a live visit on the same barber and day overlaps. A hit refuses `SCHEDULING_APPOINTMENT_REOPEN_SLOT_TAKEN` — the status the visit left, and that seat's barber, day, minute and index (before, a `BOOKING_SLOT_UNAVAILABLE` naming the first seat whatever collided) — and writes nothing; the callable answers it as `BOOKING_TRANSITION_SLOT_TAKEN` with the REAL `fromBookingStatus` (the edge had hard-coded `CANCELLED`, true only for the one reopen checked before). A seat the move leaves resolved holds no chair and is never compared. The overlap is the seats' own minutes, as the reinstatement always compared (`Seat.collidesWith`): a booking's padded chair time and turnaround are not re-applied to a visit that held this chair before. A system spec sweeps every visit state × target × party-or-seat × day and proves `mayEndLive` covers every move the decision ends live (exactly four: the three reopens, and a no-show's on the next day). Option B's overlap is the gap itself; a shop that truly wants two clients at once moves one of them first. **Size** S.

### OR-58 — No client writes a coupon, the admin included (pass E N-2)

**Context.** `coupons` allowed `write: if isAdmin()`, but no screen saves a coupon: the dev seed (`tools/seed/promotions.mjs`) and the e2e support write through the Admin SDK, which the rules never see, and the functions only read. A dated rules case (2026-09-29) pinned an admin's save. D28 (2026-10-10) had kept "a rules-guarded admin write until an admin surface lands, then a pipeline".

| Option                                                                   | C/S/P/T/U/M/R     |
| ------------------------------------------------------------------------ | ----------------- |
| **A. `allow write: if false`; a coupon editor ships with its own write** | **5/5/5/5/5/5/5** |
| B. Keep the admin grant until an editor exists (D28's interim clause)    | 4/3/5/4/5/4/5     |

**Decision: A** — least privilege: a grant with no writer is attack surface only. It amends D28's interim clause; D28's end state (an admin surface writes through a pipeline) stands. The dated case is replaced by one that reads the coupon as stored and refuses every write to every role, `admin` and `sysadmin` included. Reverting is one rules line. **Size** XS.

### OR-59 — `subjectCustomerId` stays optional; its absence is a contract value (pass E N-1)

**Context.** `VisitRowOptions` / `VisitCardOptions.subjectCustomerId` cannot be required: the client's own list holds the account, not the record, and relies on `VisitStorySystem.subjectRecordOf`'s absent path (read the record off the account's own seat).

| Option                                                                | C/S/P/T/U/M/R     |
| --------------------------------------------------------------------- | ----------------- |
| **A. Keep it optional; document the three answers as one contract**   | **5/5/5/5/5/5/5** |
| B. An explicit `CustomerId \| null \| 'FROM_SEAT'` value              | 5/5/5/5/5/3/4     |
| C. Require it; the client list resolves the record first (a new read) | 5/5/3/4/5/3/3     |

**Decision: A.** No behaviour change: a `CustomerId` is the record the host resolved (the staff card), `null` a guest (the appointment's story), absent the seat's own link (the client's list). The two option types, `subjectRecordOf` and the client list's call site say so; `visit-story.system.spec.ts` already pins all three. B spells the same contract with a sentinel every caller must learn. **Size** XS.

---

## Deferred (L-size work that deserves its own design; none closes a live gap)

1. **Server-atomic visit save**, with the note and the tip folded into the `staffEdit` transaction. It is the north star after OR-4, but it crosses the after-the-cut tip and transactional-note boundaries.
2. **Adopting the walk-in record at registration** (`completeRegistration` sets `userId` on a same-phone walk-in record, behind `client.merge`). It needs a merge-policy design; OR-26 leaves the record linkable.
3. **Enforcing Trusted Types**, plus the DS map attribution footnote. It waits for the OR-30 Report-Only list.
4. **App Check** on `reportClientIssues` and the callables. It needs a reCAPTCHA host admitted under the CSP, and an enrolment design.
5. **A nightly sweep that settles stale CONFIRMED visits.** This is a product decision (auto-closing visits the barber never closed). OR-8 fixes the display without it.
6. **Voucher issuing and selling.** It returns with the Q14 points-redemption callable, or with payments.
7. **Impersonation read-as.** The contract is recorded in OR-24.
8. **An admin location writer**, outside venues for events, and `ui-date-field` / `ui-time-field` on the programs admin. YAGNI: no reported need.
9. **The generic `ListAnswer<E>` dropped count for search and history.** It is a mechanical extension of OR-2 when a need appears.
10. **HSTS `preload`**, once the apex domain is fixed (near-irreversible).

---

## Ledger — what landed (BUILT, 2026-10-26)

OR-1 … OR-56 are built on the pass-F tree, in the four waves of the
implementation plan below, and integrated by one integrator round that ran
the FULL gate of `HANDOFF.md` §4 (`verify:csp` included) green with no
standing reds (`HANDOFF.md` §4, the pass-F reference numbers). OR-57 …
OR-59 were ruled and built afterwards, on `2f75cb21`, outside the four
waves; the FULL gate ran green on that change. Where a
package's build departed from the letter of a ruling, the departure is listed
under its ruling and again in `HANDOFF.md` §3.3 (pass F).

| Ruling | What landed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OR-1   | `VisitDraftSystem.walkInStart(now, span)`; `snapUp` deleted; the dashboard's `nowSnapped` seeds through it; the late-evening case re-pinned to 1410/1440 (DEP-F1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OR-2   | `BarberDayRead { appointments; unreadableCount }` (`scheduling.port.ts`); `admitCounted` in `observe.ts` (`keepAdmitted` wraps it); the store's failed lane (`holes: []`, out of `offToday` / `resting`); `day-health.presenter.ts` + `.vm.ts`, one `role="status"` row per chair in the all-day strip; the copy keys wired (DEP-F2). The disc's glyph is the registry's `running_with_errors` (`staff.dayHealth`): Material `error` is not in the pinned glyph set, and adding it means re-fetching the set (`pnpm icons:glyphs`), left for a deliberate icon pass. The row's meta is `staff.day.unreadableHint`, as the ruling words it, and a partial read's count sits under the chair's name, so the count DEP-F2 asks for stays on screen; the `role="status"` card nests inside a plain list item, the way the off row nests its button, so the strip stays a list (fixer round).                     |
| OR-3   | The verdict reads `frameDay()`; `frameDayFor(subject, draftDay, draftChair)` serves both sheets; the create sheet follows its draft (`createDraftDay`, `createDraftChair`, `onCreateDayChanged`, the probe released on close) (DEP-F3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| OR-4   | `ports/visit-edit.port.ts` (`StaffEditSendPorts`, `TeamNoteSavePorts`, `SeatTipSendPorts`, `VisitEditWritePorts`); `StaffEditPlanSystem.savePlan`; `BookingCall.sameCommands`; `pipelines/save-visit-edit.pipeline.ts` with call-order specs; `VisitEditWrite` in `components/visit-edit-write.data.ts` (the outcome dictionary keeps its own one-name file, pass D D-7); the store's `saveVisit` calls the pipeline for save and undo; the dashboard save and undo specs unchanged. A note-only save still sends the batch first (the chair-wide MOVE / RESIZE_END ride along, as the characterisation net pins).                                                                                                                                                                                                                                                                                           |
| OR-5   | `photo-moment.presenter.ts` + `.vm.ts` in `libs/features/shared/visits` (`photoMomentOf`, over `yearIfElsewhere`); the editor's own year rule deleted; the editor's money through `intlLocaleOf` (DEP-F4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| OR-6   | `Party.labelNumberAfter` deleted; the services step adds a guest through `unusedGuestLabel` from 1 (DEP-F5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| OR-7   | `MoveSystem.partyStarts`; the time sheet frames every party start with `frameShopDay` (memoised per party start set) and offers only times every seat survives; `timedOptionsOf` spec; `instantAt` deleted (DEP-F6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| OR-8   | `VisitListSystem.nextUpcoming` / `countUpcoming` (linear, no sort allocation); `ShopZoneService` memoises per `LocationId` and drops failures (`zonesOf`); `/account`'s card, the menu badge and `/account/appointments` judge each visit on its own shop's clock (DEP-F7), through ONE fold beside `ShopZoneService` (`distinctLocationIds`, `sameLocationIds`, `nowOfZones` in `shop-clocks.ts`); a visit whose shop zone is unknown is skipped on the card as on the badge — the card draws the soonest visit at a shop that answered, and shows the failed state only when nothing is next and a zone failed (a skipped visit makes "nothing to come" untrue); `nextUpcoming` breaks an exact tie by code-unit id (OR-18), the first row `upcomingSoonestFirst` draws; the callerless `soonestFirstByStart` deleted.                                                                                     |
| OR-9   | `OtpLimits.ResendWindowSeconds: 60`; `IdentityError.otpRateLimited(retryAfterSeconds)`; `IDENTITY_OTP_RATE_LIMITED: ['retryAfterSeconds']` in `WIRE_PARAM_ALLOWLIST`; the store restarts the countdown from the refusal's seconds; `RESEND_COOLDOWN_SECONDS` deleted; the copy's `{{seconds}}` is filled from `retryAfterSeconds` by `translateCodedError` and `wordFlowFailure`; `auth-flow-design.md` at 60 s (DEP-F8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| OR-10  | `OtpLimits.EscalateAfterSends: 3`, `OtpSystem.escalates`, the store's `escalated` computed; the template literal gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OR-11  | `PlacementPolicy.staffWalkIn` and the spec-only `equals` deleted (DEP-F9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| OR-12  | `BOOKING_SLOT_UNAVAILABLE: [barberId, localDate, startMinutes, seatIndex]` in the allowlist; the edge spec pins the details as exactly that struct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| OR-13  | `GrantLifecycle.Used` keeps its terms; `CouponGrantSystem.settleBill`, `releasePlan`, `offered`; `BillingSystem.releasesHoldings(before, after)` — cancel AND no-show (the orchestrator's override, DEP-F10b) — read by the voucher and the grant restore on the staff and the server paths; `decideEdit` adds `settleBill`'s writes; `readDiscountGrants` (one `getAll`, only with grant lines); `LoadCouponGrants(ids)` (batched `documentId() in`); `load-held-grants` offers usable ∪ the saved bill's grants; `settleDiscounts` refuses an unusable or foreign grant as `invalidCommand('grant')`; `expire`, `revoke`, `termsOf`, `CouponGrantSystem.isActive`, `CouponGrantNotExpiring`, `CouponGrantReasonEmpty` and `AppointmentLifecycleSystem.endsCancelled` deleted; the emulator double-spend spec (`coupon-grant-burn.integration.spec.ts`); the seed's USED grants keep their terms (DEP-F10). |
| OR-14  | `VoucherSystem.issue`, `IssueVoucher`, `redeem` and `GiftVoucherValueInvalid` deleted; the uncovered cases ported onto `settle` / `refusal`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| OR-15  | `GrantTicketRef { grantId; couponId; value; expiresOn }`; `CouponValue.same`; `RewardSystem.pointsReachBeyondHeld(rewards, heldCouponIds, balance, today)`; `ClientCardGrant.couponId` / `value`; the client card's glance reads held coupon ids (DEP-F11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| OR-16  | `couponOccasion: CouponOccasion \| null` required on the contract, `VisitEditorGrantOption` and `OccasionTagged`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| OR-17  | `VoucherSystem.spendableSums`; `GlanceHoldings.vouchers: readonly Money[]`, joined with « · »; the wallet's `heldTotal` composes it (DEP-F12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| OR-18  | Code-unit id tie-breaks; `VoucherIdOrder` deleted; `upcomingSoonestFirst` breaks ties `byStart \|\| byId` (DEP-F13), and `VisitListSystem.nextUpcoming` (OR-8) by the same code-unit id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| OR-19  | `NotificationSystem.unreadIds` / `receiptAt`; `markRead`, `readBeforeSent`, `NotificationReadBeforeSent` deleted; `MarkNotificationsRead` (one `writeBatch`, at most 50); the one-shot rules; the root `InboxStore`; `libs/features/client/notifications` at `account/notifications` (`inbox.presenter.ts` + `.vm.ts`, exhaustive topic switch, the waitlist deep link); the menu row routes there; the booking-core e2e journey (DEP-F14). Each row is described (`aria-describedby`) by its age and, unread, «Ново» — the copy addendum above (fixer round).                                                                                                                                                                                                                                                                                                                                               |
| OR-20  | The seven lifecycle wrappers deleted; their specs re-targeted to `transition` (DEP-F15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| OR-21  | `IntervalSetSystem.clip` deleted, its cases folded into `intersect` (DEP-F16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| OR-22  | `DayHours.parseWeek` closes with `EndMinute.of` (24:00 accepted); `ServiceComposition.parse`, `CATALOG_SERVICE_EMPTY_BUNDLE_INCLUDES` and `LocationInvalidTimezone` deleted (DEP-F17).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OR-23  | `SetDayWindows`, `FlexibleWhen.withWindows` and the `DayWindows` writers deleted; the stored `windows` field and its readers kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OR-24  | `impersonation-banner.ts` and `libs/features/admin/impersonation` deleted; `/admin` redirects to `/admin/loyalty/rhythm`; the read-as contract in `HANDOFF.md` §6 (DEP-F18).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| OR-25  | `customers`: `allow create, update: if false`, with rules cases for receptionist, admin and client (DEP-F19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| OR-26  | `CustomerId.forWalkIn`; `SeatSubject.WalkIn`; the guest `AddedSubject.contact` parsed at the edge; `CustomerRecordSystem.walkInCreates` in the book and edit pipelines' phase-one read; `StaffEditDraft.Client.email`; `customerSearchPorts` + the `customers (searchPrefixes CONTAINS, searchName ASC)` composite; `CUSTOMER_SEARCH_PORTS` wired; the staff client search merges accounts and records (`client-search.ts`), walk-in rows marked «Без профил»; `staff-walk-in.spec.ts` e2e (DEP-F20). A second ACCOUNT holder who rides a create as a guest sends no contact (integrator, so no account mints a second, walk-in record). The walk-in id is keyed — HMAC-SHA-256 under the `WALKIN_ID_KEY` secret (`WalkInKeyPorts`), see "Built" under the ruling (fixer round).                                                                                                                             |
| OR-27  | The sampler stays ungated; `scheduling.port.ts`, the runbook and ecs-migration corrected (DEP-F21).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| OR-28  | The triage applied: `loadWaitlistRequest` (port, adapter, double), `BadgeCategoryOrderNegative` deleted; the wired and kept items as listed (DEP-F22).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OR-29  | `firebase.json` `headers`: the hash CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP, XFO and the cache split; `docs/security/csp-baseline.md` rewritten (DEP-F23).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OR-30  | Enforced CSP; Trusted Types Report-Only; the `securitypolicyviolation` listener in `apps/web/src/main.ts` feeding the issue reporter, which drops extension sources and the measured MapLibre baseline (fixer round).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| OR-31  | `tools/verify/csp/check-csp.mjs` and `emulator-config.mjs`; `playwright.csp.config.mts` + `e2e/csp/csp-smoke.spec.ts`; the `csp-smoke` build configuration; `pnpm run verify:csp` in the FULL gate and the static gate in CI; the smoke ignored by the ordinary `e2e:web` project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OR-32  | `initializeAuth` with three persistences and no resolver; the provider spec asserts it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| OR-33  | No default guard on the functions adapters and the commit plan; `unguarded` / `UNGUARDED` moved to the testing entries behind a lint ban and the runbook §4.10 gate; the seed and the integration specs read through the real registry (DEP-F24). One departure: the web's shared reads keep the default `AS_STORED`, which reads only the collections no guard covers and raises a defect on the guarded ones, so a forgotten guard fails loudly instead of reading unguarded.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OR-34  | `ClientIssue` / `ClientIssueKind`, `ClientIssueError`, `ClientIssueSystem` (`scrub`, `fingerprint`, `admitBatch`, `pack`, `logLine`), `reportClientIssues` pipeline; the `reportClientIssues` callable (token bucket, 2 instances, 10 issues / 4 KB); the console telemetry writes a client error line as one whole ERROR entry, so Error Reporting groups by the client's frame; the web's `ReportingErrorHandler` and reporter adapter (DEP-F25). The ops half (the `client_issue_count` metric and its alert) and the privacy-policy line are the owner's, listed in the runbook.                                                                                                                                                                                                                                                                                                                         |
| OR-35  | `tools/verify/preflight/preflight.mjs` (P1–P6; P7 added 2026-10-26) with its spec, wired as the hosting and functions predeploy; `CREATIVO_SKIP_PREFLIGHT=1`; runbook §2.3 / §3 rewritten; `tools/verify` retagged `type:tooling` (DEP-F26).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| OR-36  | Closed as moot; the prune rule in runbook §3 step 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| OR-37  | The event's shop picker (`ui-choice-menu`, «Без конкретен салон»), hidden with one shop; `ProgramsSystem.eventShop`; `marketing-events.presenter.ts` + `.vm.ts`; the admin page's literals moved to `admin.programs.*`; the rules' `exists()` (DEP-F27). A shop's name comes from ONE wording helper, `shop-name.format.ts` (`@creativo/features/shared/catalog`: `shopNameOf`, `namedShopsOf`), read by both programs presenters and the admin page (fixer round).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| OR-38  | `ENGAGEMENT_SHOP_EVENT_LOCATION_UNKNOWN`, exactly one location read, the edge row `FailedPrecondition`, the refusal worded on submit (DEP-F28).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OR-39  | Kept as ruled; no code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| OR-40  | Closed; docs only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OR-41  | `tools/seed/fixtures/programs.fixtures.ts`, `tools/seed/programs.mjs` + spec; `seed:dev` writes them in full mode (DEP-F29).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| OR-42  | `ProgramsSystem.positionShops`; the shop chips prefilled from the stored scope; `marketing-careers.presenter.ts` + `.vm.ts`, its shops named through the shared `namedShopsOf` (DEP-F30).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| OR-43  | Affirmed; docs only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| OR-44  | `idCompanion.parse` / `is` / `isSpan` refuse reserved ids (`PRIMITIVE_ID_RESERVED`); `isReadableId` deleted; the functions catalog adapter reads through `ServiceId.is` / `LocationId.is`; book and reschedule answer an unparseable shop id as `BOOKING_INVALID_INPUT` on `locationId`, unread (DEP-F31).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| OR-45  | `HourCount` + `UtcEpochMs.minusHours`; the policy, seat outcome, recompute job, transition, cancel and recompute pipelines retyped; the silent-null branch deleted; the `hourCount(n)` fixture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OR-46  | `components/cadence.data.ts` (`Cadence.meanDays`), shared by the card's cadence and the rhythm (DEP-F32).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| OR-47  | `libs/ui/theme` (`ThemeService`, `type:ui`), saving only on `set()`, following the system while nothing is stored; `AppChromeService` lost its theme half; the shell re-exports the service (DEP-F33).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OR-48  | `E164.parse` / `is` (`PRIMITIVE_PHONE_NOT_E164`); the booking draft and the landing's `phoneHref` parse (DEP-F34).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OR-49  | `PersonKey` (`self`, `account`, `guest`, `equals`); both spellers, `StandingSeatPair.personKey` and the dashboard's set retyped; spellings pinned byte for byte.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OR-50  | The E-18 lines edited, the four `*_INVALID_INPUT` keys deleted, one FORBIDDEN line (DEP-F35).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| OR-51  | One voice («ти»), «бръснар», «Опитай пак»; the four voice baselines regenerated after review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| OR-52  | Both rhythm refusals worded; `wordRefusal`'s switch exhaustive (DEP-F36).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| OR-53  | The programs status words in sentence case, agreeing with the noun; unit and e2e specs re-pinned (DEP-F37).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| OR-54  | Each `REPOSITORY_*` code worded for what it means (DEP-F38).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| OR-55  | The rules recorded at the top of `word-pipeline-error.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OR-56  | (b) `VisitListSystem.tileGrain` and the client fact line «{{barber}} · {{weekday}}, {{time}}»; (c) `VisitListSystem.showsPills` (two sections or more). The upcoming tile names the MONTH only — integrator's departure (DEP-F39): the 44 pt DS tile cannot hold «юни 2030 г.» (65 px measured) and printed «юни 20…»; a booking lies within the horizon, so its month is unambiguous, and the row's accessible name keeps the year (R59). On the shop's today the client fact line says «днес» / "today" in place of the weekday («Иван · днес, 11:00», `whenShort`), as the row's accessible name and the staff lines do — integrator's note beside DEP-F39, pinned in bg and en by `visit-row.presenter.spec.ts`. The `appointments-list-populated-{light,dark}` baselines regenerated after review.                                                                                                      |
| OR-57  | `AppointmentLifecycleSystem.mayEndLive` replaces `isReinstatement`, `seatTakenSince` replaces `takenSince`; `transition-appointment.pipeline.ts` reads the #7 collisions and the busy days for every move that may end the visit live and refuses `SchedulingError.appointmentReopenSlotTaken` (the status left, the colliding seat); `booking.wire.ts` answers it `BOOKING_TRANSITION_SLOT_TAKEN` with the real `fromBookingStatus`, `edge.ts` files the new code `failed-precondition`; system spec: the predicates, the seat-level answer, the coverage sweep; pipeline spec: the no-show and same-day completed refusals, the named seat, a seat left resolved.                                                                                                                                                                                                                                          |
| OR-58  | `firestore.rules` `coupons`: `allow write: if false`; the dated admin-save case replaced by a read case and an every-role write refusal (`firestore.rules.integration.spec.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OR-59  | The three-answer contract on `VisitRowOptions.subjectCustomerId`, `VisitCardOptions.subjectCustomerId`, `VisitStorySystem.subjectRecordOf` and the client list's call site; no behaviour change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## Implementation plan

Within a wave, file ownership is **disjoint**. Waves run in order. A file may be owned again in a later wave. The integrator runs the full gate (HANDOFF §4, plus `verify:csp` from wave 1 on) at every wave boundary, and lands one commit per package.

**Shared files have one owner per wave:**

- the ecs-core tier barrels, `@core/testing` doubles and every `*.port.ts` file: W0-CONTRACTS;
- `bg.json` / `en.json`: W0-COPY, then W1-PROGRAMS (`admin.programs.*` only), then W3-VOICE;
- `firestore.rules`: W1-RULES;
- `app.config.ts`, `app.routes.ts` and `tsconfig.base.json`: W1-PLATFORM, then W2-WALKIN-UI (`app.config.ts` only);
- `HANDOFF.md` and the plan docs: W3-DOCS only.

### Wave 0 — ecs-core contracts, systems, and the catalog keys

- **W0-CONTRACTS** (OR-2, 4, 13, 19, 26, 27, 28, 34):
  - `BarberDayRead` and `ObserveBarberDay` in `scheduling.port.ts`; delete `loadWaitlistRequest`; fix the lead-time JSDoc.
  - `LoadCouponGrants` in `engagement.port.ts`.
  - `MarkNotificationsRead` in `notifications.port.ts`.
  - `ClientIssuePorts` in `telemetry.port.ts`.
  - The customers search port beside the staff client book's account search.
  - A new `visit-edit.port.ts`.
  - Update `port-doubles.ts`.
  - Add the new barrel exports: `HourCount`, `PersonKey`, `Cadence`, `ClientIssue`, `ClientIssueKind`, `ClientIssueError`, `ClientIssueSystem`, `VisitEditWriteOutcome`, `saveVisitEdit`, `reportClientIssues`.
  - Remove the exports of deleted names (`isReadableId`, `MarkNotificationRead`, `IssueVoucher`, `VoucherIdOrder`).
- **W0-BRANDS** (OR-44, 45, 46, 48, 49): the primitives, `E164.parse`, `HourCount` retyping through policy, seat outcome, the recompute job and the transition/cancel/recompute pipelines, `isReadableId` removal at its 9 sites, `PersonKey` in the systems and the dashboard set, and the calendar-day cadence. Specs: primitive boundary and purity specs, type-specs, a tampered-draft case, and cadence DST and same-day cases.
- **W0-ENGAGEMENT** (OR-13 systems, 14, 15, 16, 17, 18 vouchers, 19 system, 28 badge code, 37/38/42 `ProgramsSystem`):
  - `settleBill`, `releasePlan`, the kept-terms `Used`, `releasesHoldings`, and `invalidCommand('grant')`;
  - the voucher deletions, `spendableSums` and the code-unit tie;
  - coupon-id keys and `CouponValue.same`;
  - `unreadIds` / `receiptAt`;
  - `ProgramsSystem.zoneOf` refusal, `eventShop`, `positionShops`;
  - `ENGAGEMENT_SHOP_EVENT_LOCATION_UNKNOWN`.
    Every system gets a purity spec.
- **W0-SCHED** (OR-1, 6, 7, 8, 11, 18 visits, 21, 22, 23): `walkInStart`, `partyStarts`, `nextUpcoming` / `countUpcoming` / the tie, the `staffWalkIn` deletion, the `clip` deletion, the midnight close and dead catalog codes, the `SetDayWindows` family deletion, and the `labelNumberAfter` deletion.
- **W0-IDENTITY** (OR-9, 10): `OtpLimits` (`ResendWindowSeconds: 60`, `EscalateAfterSends: 3`), `retryAfterSeconds`, `escalates`, `OtpRateLimited.retryAfterSeconds`, and the request-otp pipeline spec.
- **W0-VISITEDIT** (OR-4): `StaffEditPlanSystem.savePlan`, `BookingCall.sameCommands`, the `save-visit-edit.pipeline.ts` call-order specs, and the outcome data file.
- **W0-ISSUES** (OR-34): the ecs-core client-issue data, error, system and pipeline, with scrub specs.
- **W0-COPY** (OR-2, 9, 13, 19, 26, 37, 42, 50, 52, 53, 54, 55): every new and edited key in the «ти» voice, the i18n specs, and `admin-rhythm.ts`'s exhaustive switch.

### Wave 1 — pipelines, features, rules and platform

- **W1-GRANT** (OR-13): the edit, cancel, transition and read-set pipelines; `load-held-grants`; the batched adapter; the emulator double-spend integration spec.
- **W1-STAFF-DAY** (OR-1, 2, 3 dashboard half, 13 bill ids): the dashboard, the store, the day-health presenter, the `admitCounted` path in `observe.ts`, and the adapter.
- **W1-EDITOR** (OR-3 editor half, 5, 15, 16, 17, 18): the editor, the shared `photo-moment` presenter, the client-card contract and its presenters.
- **W1-BOOKING** (OR-6, 7).
- **W1-ACCOUNT** (OR-8): the card, the appointments store, the zone memo.
- **W1-AUTH** (OR-9, 10 web).
- **W1-INBOX** (OR-19 web, OR-8 badge).
- **W1-RULES** (OR-19, 25, 37).
- **W1-PROGRAMS** (OR-37, 38 UI, 41, 42, 53 e2e).
- **W1-PLATFORM** (OR-24, 29–32, 34 web, the lazy wiring for OR-13 and OR-19).
- **W1-FUNCTIONS** (OR-9 edge, 12 spec, 28 adapter, 34 callable, 38 edge row).
- **W1-DEAD** (OR-20).

### Wave 2

- **W2-WALKIN-CORE** (OR-26 server and data).
- **W2-WALKIN-UI** (OR-26 editor and search).
- **W2-SAVE** (OR-4 wiring).
- **W2-THEME** (OR-47).
- **W2-OPS** (OR-27 runbook, 35, 36).
- **W2-VISIT-ROW** (OR-56 b, c).

### Wave 3

- **W3-GUARDS** (OR-33).
- **W3-VOICE** (OR-51, plus the baselines for the voice change).
- **W3-DOCS** (closes every question in HANDOFF and the plans, records every DEP-F, and adds pointers in ecs-migration, flip-1 §10 and flip-4 §10).
