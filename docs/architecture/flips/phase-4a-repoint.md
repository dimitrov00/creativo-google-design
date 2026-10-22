# Phase 4a — re-point every legacy consumer onto ecs-core

**Date:** 2026-10-22 · **Status:** INTEGRATED 2026-10-22 — P0–P8, the P9
sweep and the integration (§8.1 items 8–10) on `e9d1ca4`; the full gate of
HANDOFF §4 green (baseline reds only), the 4a end condition met, the §8
step 4 smoke run; §11 holds every case. Written as a PLAN on `e9d1ca4`
(flips 1–4 integrated, Phase 3b complete, the tree clean), the contract the
parallel packages built against. ·
**Law:** `CLAUDE.md` Laws 1–9 and the eight `.claude/rules/*.md`
(`ecs-ports.md` is Law 9's template). This plan never overrides them. ·
**Sources:** `docs/architecture/HANDOFF.md` (§3.2 every flip's carried-forward
notes, §3.3, §4 gate and baselines, §5 operating rules, §6 owner rulings
F6 and flip-2 §10.15); `docs/architecture/ecs-migration.md` §4.2, §5.1–5.3,
§6 Phase 4 (re-points (a)–(i), the rules tightenings, the end-of-3b
assertion); the four flip plans' §0 "out of this flip" rows (F1-2, F1-3,
F2-2, F2-3, F2-4, F2-5, F2-13, §10.12, §10.13, §10.15; F3-2, F3-3, F3-12;
F4-2, F4-9); `docs/architecture/flatten-spec.md` §2.3 T1–T9, §4.3, OQ-2,
OQ-3; `docs/architecture/firestore-runbook.md` §1.1, §2.1, §3, §4.0–§4.6.
Every file below was located by `git grep` on `e9d1ca4`. Line anchors are
left out on purpose, because they drift.

**Law 9 in this plan, once.** Every port this half adds or consumes is a
member of a focused bundle record declared in
`libs/ecs-core/src/ports/*.port.ts`. Every web `InjectionToken` and every
adapter factory is typed against exactly one bundle; an adapter serving
several returns their `&`, never a local alias. Pipelines' `XPorts` are
intersections of named bundles and nothing else. No `Pick`/`Omit` of a
`*Ports` type appears anywhere in this plan or in the code it produces
(`creativo/no-sliced-ports`, §6's Law 9 gate). The bundle map is §3.4.

**What 4a is.** Phase 4 runs in two halves. **4a (this plan)** re-points
every remaining consumer of `@creativo/application/*` and
`@creativo/domain/*` outside those libraries (apps, features,
infrastructure, ui, tools, specs, fixtures) onto ecs-core, flips the
callable wire, lands the three rules tightenings each with its server
callable and (where one exists) its web switch, and closes the law
leftovers the flips carried forward. **4a ends** when nothing outside
`libs/application/**` and `libs/domain/**` imports them, with the full gate
green, so that **4b** (deleting `libs/application/*`, `libs/domain/*`,
their aliases, Nx projects, `.nxignore` lines, `luxon`/`@types/luxon`/
`dinero.js`, the docs rewrite, the lint widening) is a pure deletion.

Greenfield: no dual shape, no backfill, no fallback reader, no shim
between an old and a new wire. The emulator is wiped and reseeded
(`pnpm run seed:dev`; `e2e:web` reseeds itself). Specs never read the wall
clock's date or time of day: every clock is pinned with `@core/testing`.

---

## 0. Decisions this plan takes (read first)

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 4A-1  | **What "frozen" means** (F1-1 … F4-1, unchanged). Every outcome a person sees, or a request leaves with, equals today's — the screens, their copy (byte for byte, in `bg` and `en`), their states, their URLs (`?step=`, `?redirect=`, `?reschedule=`, `?waitlist=`), their DOM test ids and `data-state` attributes, the documents every write stores (apart from §0's planned changes), the audit rows, the TTL stamps and the telemetry lines. Any other change is a **departure**: it is listed in 4A-2's departures block with its reason AND pinned by a spec (§11.4). The planned Phase 4 product changes of 4A-3 are not departures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fidelity; the task's BEHAVIOUR rule.                                                                                  |
| 4A-2  | **Departures (each pinned, §11.4) — the minimum the laws force.** **(a)** A wall-clock start that falls inside the spring-forward gap, sent to `commitBooking`, `rescheduleAppointment` or `staffEditAppointment` (`MOVE`, `RESIZE`, `ADD_SEAT`), is refused `DST_GAP_INVALID_TIME` by the pipeline (the ingestion boundary, Law 7.3). Today the web turns the grid's wall clock into an ISO-with-offset with Luxon, which silently moves a gap time forward an hour. No screen offers such a time (every grid is built from opening hours on the wall clock, and no shop opens across 03:00 on the last Sunday of March), so the departure is reachable only by a hand-made payload. A fall-back repeat resolves to the EARLIER offset in both, so no departure there (the flip-4 F4-1 (a) precedent). **(b)** A Firebase ID token whose `stage` claim is `active` but which carries no `tenantId` or an empty `roles` reads as an `ONBOARDING` principal (`Principal.fromClaims`), where the legacy `principalFrom` read it `active`. This app never mints such a token (`RegistrationSystem.claimsFor` always writes both); only test helpers did, and §4 P3/P1 make them mint through `AuthClaims.toToken` with the seed's tenant. Pinned by `principal.data.spec.ts` (exists) and the auth-session adapter spec (new). **(c)** The retrying triggers' attempt line (`legacyAttemptLine` `{ fn, eventId, outcome, code, ageMs }`, `edge.ts`) speaks the flipped vocabulary: `outcome` is the SCREAMING `AttemptOutcome`, and `code` gives way to `errorCode` with the ecs-core code. It is operator telemetry, not a user surface; it moves "with the rest of the wire" (runbook §4.6, the ledger's note). Pinned by `edge.spec.ts`. **(d)** `dist/apps/functions/package.json` keeps `rxjs` (see 4A-15): the blueprint's end-of-3b assertion "no `rxjs`" is met for `@angular/*`, `luxon` and (in 4b) `dinero.js`, not for `rxjs`, until the owner rules on §10.1. **(e)** A boundary with no location in scope (the waitlist ask under "any shop", the client-stats projection, the streak publish's shop day, the backfill, the lead-time sample; on the web the site menu, the client card, the admin rhythm, the loyalty catalogue day, the appointments page, the staff day while its catalogue names no shop) reads the default location's `timeZone` (F-4, 4A-11) instead of a constant: when that one read fails, or the default location is absent (a deploy precondition since flip 4), the boundary answers ITS EXISTING store-failure outcome (`REPOSITORY_*` on the server; the surface's own failed/unavailable state on the web) — an outcome today's constant could not produce. Pinned by `resolve-shop-zone.pipeline.spec.ts` and one case per re-typed server pipeline. **(f)** The site menu's «График» date subtitle renders once the session's default zone has resolved (one cached location read per session, started at shell mount); before that the subtitle line is absent. Pinned by `site-menu.component.spec.ts`. **(g)** For a signed-in phone session, the menu portrait's identifier line (`SessionIdentityService.identifierLabel` — also its primary line when there is no name) reads the raw E.164 (`+359885550100`) until the lazily loaded phone formatter lands (F6: `libphonenumber-js` stays out of the initial chunk), then today's grouped international form; if the chunk fails to load (offline, a deploy that rotated the hashes) the failure is handled, the line keeps the raw E.164 and the next sign-in asks again — today it rendered grouped at once. Pinned by `session-identity.service.spec.ts`. (The lazy loader's failure keeps its telemetry: a plain `Error` whose `name` is set to `'LazyPortLoadError'` with today's message, so no departure, 4A-14.) Nothing else departs: every other difference is a planned change (4A-3) or an internal reshape with an equal outcome. | Law 7.3 (a); Law 7.4/one Principal rule (b); the wire flip (c); §10.1 (d); Law 7.2 / F-4 (e, f); owner ruling F6 (g). |
| 4A-3  | **The planned Phase 4 product changes this half lands** (blueprint §6 Phase 4, HANDOFF §3.3/§6, the flip plans' deferrals): **(1) The callable wire flip** (4A-4): every callable answers and accepts the ecs-core vocabulary — refusals are the flat ecs-core error structs (`details.errorCode`, SCREAMING, domain-prefixed, flat scalar context; `LegacyWireCode`, `LEGACY_WIRE_CODE`, `WIRE_FIELD_NAME`, the ISO rendering of instant params and `WIRE_ZONE`'s rendering role are deleted), requests and answers are the flat ecs-core call components of §3.2 (SCREAMING discriminators, branded primitives, wall-clock `localDate` + `*Minutes` for every placement, `*UtcMs` for stamps, `*Cents` for money), and the web reads `errors.<errorCode>` through ONE `callableClient` (§3.4) with ONE error classification (`PipelineError.fromWire`, §3.1). The four duck-typed web gateways (booking, waitlist, OTP, streak publish) are deleted. **(2) `users/{uid}` client `allow update: if false`** (the owner allowlist removed whole, which subsumes flip-2 §10.12's `firstName` test) WITH its web switch: the profile page, onboarding's personalize save and the booking contact sheet's «save to profile» call `updateProfile` through the gateway; `ProfilePorts.writeOwnProfile`, its adapter member and its double are deleted. Every failure of that call that is not an edit refusal (`ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` / `_VALIDATION_FAILED`) — a bare `INTERNAL` store failure (no `errorCode`), a transport failure (no `serverErrorCode`), an expired session (`ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED`), `UNAVAILABLE`/`UNKNOWN` — words as today's ONE key `accounts.update_profile.repository_failure` (`PROFILE_WRITE_FAILED`, kept), exactly the copy today's rule denial or transaction failure shows (§3.9). **(3) Owner ruling flip-2 §10.15:** `updateProfile` writes the profile-change audit row itself, inside its transaction, credited to the caller (`Actor.user(callerUserId)`), and stamps the user's new root field `profileEditedAtUtcMs`; the `auditProfileChanges` trigger skips the event in which that stamp changed (§3.5). **(4) `impersonationSessions` write → `false`** with the `startImpersonation` / `endImpersonation` callables (§3.6) writing the flat `ImpersonationSession` body, `purgeAt` stamped by the functions TTL adapter (`expiresAtUtcMs` + 30 d at start, `endedAtUtcMs` + 30 d at end, runbook §2.1). There is no web writer to switch (the admin impersonation page and the banner are empty stubs; `IMPERSONATION_READ_PORTS` has no injection site), so the "web switch" is vacuous: the callables ship server-only and the rules spec proves the direct write is denied. **(5) Invitations closed** (F3-2): `invitations` client `create`/`update` and `…/redemptions` `create` → `false`, with the `redeemInvitation` callable writing ONE `CommitPlan` (Create `invitations/{id}/redemptions/{refereeUserId}` + Update `redemptionCount`). No web surface exists (`referrals.invitations` is off in every environment; flip 3 deleted the dead adapter), so it too ships server-only. `createInvitation` is NOT built (F3-2): after the close, no client creates an invitation, which matches today's reality (none does). **(6) F6 phone re-point:** the phone field lazily imports `PhoneSystem` from `@core/systems` — through a component-local named re-export (`import('./phone-field.lazy')`), never a dynamic import of the `@core/systems` namespace, which the eager graph already holds (§9 R10) — and never `@creativo/domain/kernel`; the owner accepts the larger lazy chunk; `libphonenumber-js` stays out of the initial chunk (`verify:bundle`; if it cannot, the owner rules, §10.3).                                                                                                                                                          | The task's planned changes; blueprint §6 Phase 4.                                                                     |
| 4A-4  | **The wire flip, both directions, one commit with its web half** (Risk: a deployed web/functions pair must agree — §8 deploy order). **In:** each callable's request is the call component of §3.2, sent typed by the web (`callableClient`), decoded by the server from `unknown` with the components' smart constructors (`XId.parse`, `LocalDate.parse`, `MinuteOfDay.of`, the dictionaries' guards). Renames are value-level only, by rule: `kind` → the domain-prefixed SCREAMING discriminator the matching ecs-core dictionary already names (`requestedSubjectRole: 'SELF' \| 'GUEST'`, `editCommand: 'MOVE' \| …`, `discountSource`, `discountMethod`, `resizeEdge`, `identifierChannel`, `streakTransition`, `backfillJobName`); `startIso`/`atIso` → `localDate` + `startMinutes`/`atMinutes` (placement, wall clock — the pipeline converts once with the location's zone); `amountMinorUnits`/`priceMinorUnits` → `amountCents`/`priceCents` (`PriceCents`); `dayKey` → `localDate`; `from`/`to` `'HH:mm'` → `startMinutes`/`endMinutes`; lowercase status/reason words → the SCREAMING `BookingStatus`/`CancellationReason` values; an optional key → present with `null`. **Out (success):** the call component's answer type (§3.2): ids as their brands, `sessionKind: 'NEW' \| 'RETURNING'`, `streakPublishOutcome: 'PUBLISHED' \| 'WITHDRAWN' \| 'REFUSED'`, `runStartedAtUtcMs` (no ISO), `backfillJobName` SCREAMING, `devCode: string \| null`; the web decodes every answer through its call component's answer decoder (§3.2, §3.10) — never a cast. **Out (refusal):** `HttpsError(status, errorCode, details)` where `details` is the ecs-core error struct **projected to its code's allowlist**: each `EDGE_WIRE` row keeps today's `wireParams` field list, renamed to the struct's own field names (the `rawAs`/`wallIso`/`csv` RENDERING is dropped, the LIST is kept), plus `errorCode` (and `refusal`/`field` where the row names them today); an aggregate carries `errors: readonly <projected struct>[]`. A struct field not on the list never leaves — `detail`, `reason` (`BOOKING_INVALID_INPUT`), `violations` (`*_INVARIANT_VIOLATED`), `path`/`reason` (`RepositoryError`, the cause in the log only), person keys, deadlines a row does not name — exactly today's "only listed fields ever leave" (edge.ts `WireParam`); `edge.spec.ts` pins it per code. Status from `EDGE_WIRE`'s `httpsStatus` (kept one for one — the web's retry, unauthenticated and blocked paths read it). The streak publish's ANSWERED refusals (`STREAK_PUBLISH_WIRE`) stay answers: `{ streakPublishOutcome: 'REFUSED', …the projected StreakPublishError struct with flat field names, `earliest: LocalDate \| null` and the attempted day }`; `CALLER_NOT_ADMIN` stays answered and `CALLER_UNAUTHENTICATED` thrown, as today; `LEGACY_FIELD_OF` (server) and `FIELD_OF_LOCATOR` (web) are deleted together. Every refusal a decoder or a callable-specific refusal function raised as a `LegacyWireCode` gets an ecs-core code in ITS DOMAIN's primitives dictionary (an existing one where one means the same — `edge.spec.ts`' "no wire code by two rules" becomes "no meaning by two codes" — else a new member of that domain's dictionary, §3.1), and an `errors.<CODE>` key whose text is today's dotted key's text verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Blueprint §4.2/§6 Phase 4; flip plans F1-3, F2-3, F3-3; runbook §4.6 `WIRE_FILES`.                                    |
| 4A-5  | **One error classification, one wording rule.** The web's `callableClient` adapter is logic-free: it catches `FunctionsError` and answers `PipelineError.fromWire(error.code, error.details)` (§3.1), a pure primitives function whose table is today's four adapter tables (`booking-gateway.adapter.ts` `toFailureCode`, `waitlist-gateway.adapter.ts`, `otp-client.adapter.ts`, `streak-publish-gateway.adapter.ts`) re-keyed one for one on the SCREAMING codes and pinned row by row (§5.3). Its special cases stay: `BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE` with refusal `barber_unavailable` → `PIPELINE_SLOT_UNAVAILABLE`; `BOOKING_STAFF_EDIT_OVERLAPS` → `PIPELINE_SLOT_UNAVAILABLE` (the «Запази въпреки застъпването» override offer); `BOOKING_CANCEL_POLICY_UNAVAILABLE` and the commit's store failure → `PIPELINE_UNAVAILABLE`. Wording: `wordPipelineError(error, translate, fallbackCode, extraParams?)` in `libs/infrastructure/i18n` (§3.9) — the successor of the legacy `wordError`: it tries `<serverErrorCode>.<refusal \| field>`, `<serverErrorCode>`, then `fallbackCode` (each surface passes today's own generic key so the generic copy stays its own), interpolating `serverParams` merged with the surface's `extraParams` (the words a surface derives from the struct's SCREAMING values — the transition refusal's `from`/`to`, the booking reach's `reach`). The OTP "blocked" branch reads the wire STATUS, not a code: `PipelineError.isBlocked(error)` = `wireStatus === 'permission-denied'` whatever the `errorCode` (today's `userBlocked` rule). `translateFunctionsError` loses its last reader. `translateDomainError`'s `{ code }` branch keeps exactly the readers of the dotted keys that have no SCREAMING successor yet (§8.1 item 9 (g)): `admin-rhythm.ts` (three) and `client-account.ts` (`repository_failure`), `client-onboarding.ts`'s `phoneError` (`identity.phone.<reason>`), and the `translateError(code)` of `client-auth.ts`, `client-profile.ts` and `client-onboarding.ts`, whose signals carry ecs-core codes beside `unknown`, `identifier_missing` and the `accounts.*` constants. Every reader whose code IS an ecs-core code passes the flat struct (`admin-rhythm.ts`'s forbidden toast → `StaffEditError.forbidden()`, the same words as the dotted `booking.staffEdit.forbidden`; the onboarding partial birthday → `{ errorCode: IdentityErrorCode.BirthDateInvalid }`). 4b adds the (g) successors, re-points those readers to the `errorCode` arm, then deletes the branch with the dotted keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reuse, never copy; 4A-1.                                                                                              |
| 4A-6  | **Law 7.5: every error dictionary in primitives.** `CancellationRefusalCode` + `CancellationRefusal` (`cancellation-policy.system.ts`), `MoveErrorCode` + `CarriedSeatRefusal` + `MoveCarriedSeatUnplaceable` (`move.system.ts`) and `StaffEditErrorCode` + its structs (`appointment-edit.system.ts`; `StaffEditOverlaps` from `edit-appointment.pipeline.ts`) move to `libs/ecs-core/src/primitives/{cancellation,move,staff-edit}-errors.data.ts`. Context fields become scalars (the F2-4 precedent): `CancellationRefusal`'s `bookingStatus: BookingStatus` → `bookingStatus: string` (the SCREAMING value), `StaffEditOverlaps.edge: ResizeEdge \| null` → `resizeEdge: string \| null`; branded primitives stay brands. The companions move WITH their structs and take scalars only: `StaffEditError.beforeArrival(localDate, finishMinutes, arrivalLocalDate: LocalDate, arrivalMinutes: MinuteOfDay)` (its caller in `appointment-edit.system.ts` spreads its `WallTime`; primitives import nothing). Two system-tier UNIONS stay in systems because they name a system's API, not an error: `StaffEditGuardRefusal` (`AppointmentEditSystem.guard`) and `MoveError` (`MoveSystem`) — each a union of primitives structs, no own member. `MoveRefusal` (`components/booking-flow.data.ts`, `{ moveRefusalReason; locationId }`) is the booking shell's view state (no `errorCode`), stays a component and is not a Law 7.5 dictionary (§6 gate 3 is narrowed accordingly). The discriminator dictionaries the call components type with leave the systems tier too (Law 8: components import primitives only): `EditCommand` + `ResizeEdge` (`appointment-edit.system.ts`) → `components/edit-command.data.ts`, `RequestedSubjectRole` (`guest-label.system.ts`) → `components/booking-call.data.ts` beside `BookingCall.Subject` (§3.2). Every importer re-points (`@core/primitives` / `@core/components`), which `verify-tools:layering`'s "one home tier per name" proves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Law 7.5; `ecs-layering.md`; HANDOFF §3.2 flip 2.                                                                      |
| 4A-7  | **Law 9 bundles for the web's remaining wiring** (§3.4, §3.8). `AuthPorts` splits into `AuthSessionPorts` (`observePrincipal`, `refreshToken`, `signOut`, `currentIdentifier`, `currentDisplayName`) & `OtpChallengePorts` (`requestOtpChallenge`, `verifyOtpChallenge`, `completeRegistration`), `AuthPorts` kept as their `&`. `StoragePorts` splits into `BookingDraftPorts` (now typed on the new `BookingDraft`, 4A-9) & `KeyValuePorts`. `GatewayPorts.callableClient` becomes typed by name through the `CallableWire` map, each answer decoded by its call component's decoder. New: `TimerPorts` (`delay`). No tenant-zone token: the zone comes from a location (4A-11), through the existing `LOCATION_LOAD_PORTS` & `DEFAULT_LOCATION_PORTS`. One token per bundle: `AUTH_SESSION_PORTS`, `OTP_CHALLENGE_PORTS`, `AUTH_DEPLOYMENT_PORTS`, `GATEWAY_PORTS`, `BOOKING_DRAFT_PORTS`, `KEY_VALUE_PORTS`, `FLAGS_PORTS` (+ `provideFlags`), `AVATAR_PORTS`, `MEDIA_RESOLVE_PORTS` (`resolveMedia(ref: MediaRef)`), `TIMER_PORTS`. `STREAK_PUBLISH_PORTS` keeps its bundle (`StreakPublishGatewayPorts`), its adapter now composed over the gateway. Every legacy token goes: `AUTH_GATEWAY`, `OTP_CLIENT`, `AUTH_DEPLOYMENT`, `BOOKING_GATEWAY`, `WAITLIST_GATEWAY`, `BOOKING_DRAFT_STORE`, `KEY_VALUE_STORE`, `CLOCK`, `ID_GENERATOR`, `FEATURE_FLAGS`, `AVATAR_UPLOADER`, `MEDIA_READER`, `REWARD_PROGRESS_READER`, `CONTACT_CHANGE_PORT`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Law 9; `ecs-ports.md`.                                                                                                |
| 4A-8  | **Use cases become pipelines or direct port calls.** Browser pipelines in `@core/pipelines` for the use cases that hold a rule: `ensureSessionReady` (the refresh loop over `SessionAccessSystem.readiness` + `REFRESH_BACKOFF_MS`, `AuthSessionPorts & TimerPorts`), `registerUser` (`RegistrationSystem.missingField` before `completeRegistration`, `OtpChallengePorts & AuthDeploymentPorts`), `uploadAvatar` (`AvatarSystem.check` — image type and the 5 MiB limit, moved out of the Storage adapter — then `AvatarPorts.uploadAvatar`). The pass-through use cases (`SignOutUseCase`, `RemoveAvatarUseCase`, `RequestOtpUseCase`, `VerifyOtpUseCase`) become direct port calls. Server pipelines (§3.6): `startImpersonation`, `endImpersonation`, `redeemInvitation`; `updateProfile` gains the audit row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Law 4; blueprint §6 Phase 4 "the `new XxxUseCase` sites".                                                             |
| 4A-9  | **The booking draft is one FLAT ecs-core component** (`components/booking-draft.data.ts`, Law 6): `BookingDraft = BookingFlowState & BookingContact & BookingDraft.Origin`, one name per file (the variants in its one type-only namespace). Every 1-to-1 field sits at the root. The contact is the `BookingContact` slice itself at the root (its fields are already prefixed — `contactName`, `contactPhone`, `contactEmail`, `contactNote`; no contact = `BookingContact.NONE`), never a wrapper. Where the draft came from is a union of flat variants on the domain-prefixed discriminator `bookingDraftOrigin` (dictionary `BookingDraftOrigin`: `FRESH` \| `BOOKED_FROM` \| `RESCHEDULE`), never null-presence: `BOOKED_FROM` carries `bookedFromAppointmentId`, `bookedFromOwnerUserId`; `RESCHEDULE` carries `rescheduleAppointmentId`, `rescheduleOwnerUserId`, `rescheduleLocalDate` and the two true 1-to-N arrays `rescheduleRiders: readonly MoveRider[]` and `rescheduleRelease: readonly ChairTime[]` (minutes on `rescheduleLocalDate`, never `startMs`/`endMs`). `MoveRider` (`move.system.ts`) and `ChairTime` (`availability.system.ts`) are plain data a component must name, so P0 moves them down to `components/move-rider.data.ts` and `components/chair-time.data.ts` (Law 8: components never import systems), each with a companion holding its `is` guard (today's store `isRider`/`isChairTime` rules), and re-points the systems and their importers. The day is `draftLocalDate: LocalDate \| null` (not `draftDayKey`). A type-spec proves the slices `Disjoint`, the 1-to-1 fields `NoNested`, and that every `bookingDraftOrigin` variant narrows. The zone is not stored (Law 7.2: the location's). `BookingDraftStorageKey` stays `'creativo.booking-draft/v2'`; a draft under the old key is never read (greenfield). The store keeps today's handling of an unreadable draft (starts fresh), pinned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Law 6/7; the scout's gap "draft extras have no home".                                                                 |
| 4A-10 | **Lowercase contracts the user or the e2e suite sees stay lowercase, through words tables** (the F4-7 precedent). `?step=` values, onboarding's personalize step slugs, `data-state` / `data-testid` attributes, the `appointments.status.<word>` and `staff.day.cancelReasonCode.<word>` i18n keys, the profile-completion item keys (`account.completion.items.<key>`, `account-completion-<key>`) and the transition refusal's interpolated `from`/`to` words keep today's lowercase spelling; each SCREAMING dictionary maps through ONE `satisfies Record<Dictionary, string>` table — ONE table per dictionary, never one per feature. A table two features read lives in `libs/infrastructure/i18n` beside `program-status-words.ts` (the flip-4 precedent): P0 adds `bookingStatusWords` (`BookingStatus` → `pending`, …) and `cancellationReasonWords` (`CancellationReason` → the `staff.day.cancelReasonCode.<word>` segments), and P5/P6 delete their local `STATUS_KEY`, `WIRE_STATUS` and `REASON_KEY` copies. A table only one feature reads (the `?step=` slugs, onboarding's personalize slugs, the completion item keys) stays in that feature. Never a bare lowercase literal compared at a use site (Law 1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 4A-1; e2e and deep links.                                                                                             |
| 4A-11 | **The zone lives on the location only — no tenant zone constant, web or server** (Law 7.2; flatten-spec F-4, locked: `TenantConfig.zone` → `defaultLocationId`, "the legacy constant `TENANT_ZONE` … deleted in Phase 4"). Every non-spec `'Europe/Sofia'` in `libs/features/**`, `apps/web/src/**` and `libs/infrastructure/**` (app.config's `LOYALTY_SHOP_ZONE`, `APPOINTMENTS_ZONE`, `STAFF_ZONE`, the client card's seven, the admin rhythm's two, the visit editor's, the site menu's, the booking shell's and schedule step's last fallback) goes, and so does every web or server tenant-zone binding. The rule, ONE copy: **a location in scope → that location's `timeZone`** (the `ShopLocation` the feature already holds — the staff day's shop, an appointment's `locationId` through the catalogue, the visit editor's location — or `LOCATION_LOAD_PORTS.loadLocation(locationId)`); **no location in scope → F-4**: `DEFAULT_LOCATION_PORTS.defaultLocationId` → `loadLocation` → `.timeZone`. P0 builds it once as the browser-and-server pipeline `resolveShopZone(ports: LocationLoadPorts & DefaultLocationPorts) => (locationId: LocationId \| null) => Promise<Result<TimeZone, RepositoryError \| CatalogError.LocationZoneUnknown>>` (named → default fallback, the rule `ProgramsSystem.zoneOf` holds today, lifted to ONE home `ShopZoneSystem.zoneOf(named, fallback): TimeZone \| null` that `ProgramsSystem.zoneOf` wraps with its unchanged `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN`), and the web reads it through ONE root Angular service `ShopZoneService` (`libs/infrastructure/firebase-app/src/lib/shop-zone.service.ts`, P0): `defaultZone(): Signal<TimeZone \| null>` (resolved once per session, cached) and `zoneOf(locationId)`. The booking shell's `shopZone()` and the schedule step's `zone` keep "location → first listed shop → …" with the last link `ShopZoneService.defaultZone()` (the time systems read it, so it is NOT a display fallback). Only the confirmed / review / waitlisted steps' `timeSlot.start.zoneName ?? …` / `day.zone ?? …` fallbacks are display-only: they format the wall clock (`formatWallClock` / `formatMinute`), which is zone-free. **Server:** `TENANT_ZONE`, `WIRE_ZONE` and the `TenantZonePorts` bundle are deleted; the pipelines that read `tenantTimeZone` today (`project-client-stats`, `publish-streak-definition`, `run-backfill`) and every command an edge decoder stamps with `WIRE_ZONE` today (`waitlist.wire.ts`'s `requestWaitlist` — the ask's location, else the default; every `timeZone: WIRE_ZONE` of `triggers.wire.ts`: `decodeRebuildBusyEvent` — the appointment's `locationId`; the capacity day / roster / sweep triggers, the waitlist match and the lead-time run — the default) lose their `timeZone` field: their pipelines (`request-waitlist`, `rebuild-busy`, `rebuild-capacity`, `match-waitlist`, `sample-lead-time`) take `LocationLoadPorts & DefaultLocationPorts` and call `resolveShopZone` in their impure read, so the edge decodes and decides nothing about zones. The ONE survivor is the deploy-time cron TRIGGER option (`onSchedule({ timeZone })`, a static string Cloud Scheduler needs before any document exists, OQ-2 still open): it becomes `CRON_TIME_ZONE` in `apps/functions/src/lib/cron-zone.ts`, read by `main.ts`'s three schedules only (§6 gate 5 allows exactly that file). Kept, with reasons in the gate: `landing-content.ts` (each marketing location's own `timezone`, a location attribute) and `visit-ecs.shim.ts` (the shim's retirement is later, 4A-13). Departures (e) and (f) of 4A-2.                                                                                                                                                                                                                                                                                             | Law 7.2; reuse.                                                                                                       |
| 4A-12 | **`ClientOperationId` and `GuestKey` become primitives** (`ids.primitive.ts`): `ClientOperationId.parse` = `/^[A-Za-z0-9_-]{16,64}$/` (commit/move `attemptId`, staff-edit `operationId`, streak publish `requestId`), `GuestKey.parse` = `/^[A-Za-z0-9_-]{1,64}$/`, each a `Result` smart constructor plus an `is` guard, carrying the cases of `libs/application/booking/.../booking-gateway.port.spec.ts`. The web mints them with `ID_PORTS.nextId` (UUID text passes), never `Date.now()`/`Math.random()`. Behaviour per call site is kept exactly (a failing `guestKey` drops to `null`, a failing `operationId` is refused, a failing `attemptId` drops to `null`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 4a end condition (functions → application/booking); Law 7.4.                                                          |
| 4A-13 | **Out of 4a** (each 4b or later, recorded so nobody builds it): deleting `libs/application/*`, `libs/domain/*`, their `tsconfig.base.json` aliases, Nx projects and `.nxignore` lines; `luxon`, `@types/luxon`, `dinero.js` and the `money.data.spec.ts` dinero cross-check; the dotted i18n keys (§8.1 item 9 (g): 4b adds their SCREAMING successors and re-points their readers first), then `translateDomainError`'s `{ code }` branch (its last readers are exactly those of the (g) keys, 4A-5) and `translateFunctionsError` (readerless after 4a); the root-widened adapter/port/token lint and the `type:application` depConstraints; the docs rewrite (`module-boundaries.md`, `domain-model.md`, the superseded banner, CLAUDE/AGENTS "until Phase 4" clauses, ecs-core provenance comments, `firestore.rules` comments naming `@creativo/domain/accounts`); the broad sweep of feature view-model `kind`/`state`/`status` unions (≈77 tags) — 4a flattens EXACTLY these, named in their package briefs: the bag sheet's `select.kind` (P4), `appointmentsViewState` (P5), the visit editor's discount `kind: 'fixed_amount' \| …` → `discountMethod` with its VM/form money fields → `priceCents`/`amountCents` (P6), `mediaFetchState` (P3), `AchievementScope.kind` → `achievementScope`, `admin-rhythm.store`'s `Slice.status` → `rhythmLoadState: 'LOADING' \| 'READY' \| 'FAILED'` and `client-card.store`'s `Slice.status` (incl. the ledger page) → `cardLoadState` (P7); every other union stays, INCLUDING those in files a package rewrites (deferred by file to this pass, listed in §8.1 by the integrator from the §6 grep `-nE "(kind\|status\|state): '"` over `libs/features`); the UI-only wall-clock and random reads (gesture frames — `grid-gesture.ts`; menu/sheet open stamps; draft seat ids, guest ids and nonces — `nonce: Date.now()`, `Date.now().toString(36)`; the media cache's retry jitter; photo file names) — they stay `Date.now()`/`Math.random()` until this pass moves them to `CLOCK_PORTS`/`ID_PORTS` (§6 gate 2 allowlists exactly these shapes); `visit-ecs.shim.ts` and the frozen visit view models; the admin programs view-state `kind` unions; programs rules tightenings (D9(b)); `createInvitation` and a referral → loyalty credit; a role-grant feature; flip-1's deferred behaviours (grant burn/restore, reopen busy write, trigger `retry: true`, leadTimeSampling gate, public busy body, D29 walk-in seat); the flip-1 ports with no caller (`markNotificationRead`, `loadWaitlistRequest`, `loadCouponGrant`, `readCustomers`, `CouponGrantSystem.transitionWrite` — they wait for grant burn/restore); `StaffDayStore` rows as a tick-free `computed`, the landing open/closed refinement; the pre-existing footer assertion and `ui-lang` restore defects; the cron zone home (OQ-2); `rxjs` out of the functions dist (§10.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Scope; blueprint §6 Phase 4 deletions belong to 4b.                                                                   |
| 4A-14 | **Dead members and dead files that die with the re-point** (§7): `OtpStorePorts.loadOtp` and `AuthAdminPorts.setClaims` (no caller; no role grant in Phase 4; the impersonation callables use neither) leave their bundles, adapters and doubles; the dormant reward-progress reader (+2 specs), `firestore-paths.ts`, the contact-change adapter (+spec, D12(b), no successor), `SystemClock`, `CryptoIdGenerator`, the four gateway adapters, `FirebaseAuthGateway`, `CallableOtpClient`, `SessionStorageDraftStore`/`LocalStorageKeyValueStore` classes (→ factories), `FirebaseStorageAvatarUploader`/`StorageMediaReader` classes (→ factories), and with the last class row the class form of `provideLazyPort` ("the last flip deletes the class form") — and with it the remaining non-Angular classes of `lazy-port.ts`: `LoadedScope` and `LazyAdapterScope` become closure factories (`lazyAdapterScope(name, load)` returning a plain record; `app.config.ts`' `firebaseData` is built by it), and `LazyPortLoadError extends Error` dies: `onLoadError` receives the scalars `(scopeName: string, cause: unknown)`, and the ErrorHandler report (an unrecoverable load failure — the defect path, Law 7.5) is a plain `new Error(<today's message>, { cause })` whose `name` is set to `'LazyPortLoadError'`, so the console line is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Deletion rule: no injection site / no caller → dead.                                                                  |
| 4A-15 | **The functions dependency baseline is re-recorded IN 4a**, in the commit that removes the last `apps/functions` → legacy import: `tools/verify/p0/functions-deps.mjs` asserts equality, so leaving it to 4b would leave the gate red. Expected after 4a: `dinero.js`, `firebase-admin`, `firebase-functions`, `libphonenumber-js`, `rxjs` (measured at integration; `@angular/compiler`, `@angular/core`, `luxon` gone). `rxjs` stays because Nx's `createPackageJson` scans transitive projects with `{projectRoot}/**/*` — ecs-core's ports name `Observable` (9 files, `import type`), its test support and `ensureSessionReady` use it at runtime — and `dinero.js` stays until 4b deletes `money.data.spec.ts`' cross-check (4b re-records again).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Gate integrity; HANDOFF §3.3 (the re-record moves to 4a).                                                             |
| 4A-16 | **The profile-edit audit marker** (fixes 4A-3 (3)). `User` gains the root field `profileEditedAtUtcMs: UtcEpochMs \| null` (a lifecycle stamp, `*UtcMs`, Law 7.3 T2), `null` on the provisioned stub and on registration. `updateProfile`'s ONE transaction writes the profile fields AND `profileEditedAtUtcMs = nowUtcMs` AND the audit row (`WriteOp.create` of `auditLog/{hash(basis)}`, basis `AuditSystem.changeKey.ownProfileEdit(callerUserId, nowUtcMs)`, row `Actor.user(callerUserId)`, `AuditContext.profile(PROFILE_UPDATED, changedFields)`, `recordedAtUtcMs = nowUtcMs`) — only when an audited field changed (`AuditSystem.changedProfileFields`, reused); an unchanged edit writes nothing, as today. The trigger's `decodeProfileChangeEvent` only DECODES (no rule at the edge): `ProfileChange` gains the two raw stamps as flat fields, `beforeProfileEditedAtUtcMs` and `afterProfileEditedAtUtcMs` (`UtcEpochMs \| null`; an absent side or an absent key reads `null`), beside its existing `beforeExists`/`afterExists`; the pure rule lives in `AuditSystem.planProfileChange`: the event was already audited by the callable iff `beforeExists && afterExists && afterProfileEditedAtUtcMs !== null && beforeProfileEditedAtUtcMs !== afterProfileEditedAtUtcMs` — then it plans nothing; the callable only ever writes an instant, so a reset to `null` (a whole-body Admin `set` — the dev seed's `registeredAccountBody`, the e2e `seedUser` — over an account the callable already stamped) is never the callable's and is audited as today. A CREATION (`beforeExists` false: verifyOtp's stub, registration, the seed) is never skipped, so its `PROFILE_CREATED` row stays exactly as today; a deletion is never skipped; an admin edit (block, marker unchanged) is audited as today. `audit.system.spec.ts` pins the five cases (changed marker → nothing; unchanged → row; reset to `null` with a changed audited field → ONE `PROFILE_UPDATED` row credited to the writer; created → ONE `PROFILE_CREATED`; deleted → its row), `triggers.wire.spec.ts` pins the decoding (absent side/key → `null`). Every other users write (verifyOtp's stub, completeRegistration's body, account blocks, the seed) leaves the marker untouched and is audited by the trigger exactly as today. The marker works on the emulator too (whose events carry `authtype unknown`), so `verify:p0` (e) can prove ONE row, `USER`-credited.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner ruling flip-2 §10.15; Law 5 (store what systems compute on).                                                    |

---

## 1. The closure

### 1.1 Legacy importers (re-derived on `e9d1ca4`)

```bash
git grep -lE "@creativo/(application|domain)/" -- ':!libs/application/**' ':!libs/domain/**' ':!docs/**'
```

returns **128 files**: 125 of code (apps/functions 7, apps/web 9 incl. one
e2e helper, apps/showcase 1, libs/features 79, libs/infrastructure 21,
libs/ui 5, tools/flags 1 — specs, fixtures and test rigs included) and
three text mentions (`firestore.rules` comments, `libs/features/admin/loyalty/README.md`,
`tsconfig.base.json`'s aliases — the last is 4b's). §2 lists every one
with what it imports. Beside the TS project references
(`apps/{web,showcase,functions}/tsconfig.app.json`, `pnpm nx sync`), the
grep with `libs/(domain|application)/` finds only `.nxignore`, the
lint messages, `CLAUDE.md`/`AGENTS.md` and provenance comments — all 4b.

**Consumers of a legacy SHAPE that import no legacy name** (they read
`AccountStateService.principal()`'s legacy `kind`/`uid`, a legacy
`Result`'s `isSuccess()`, a legacy token's answer, or mint legacy claims)
— in the closure too, each owned by a package:

| File                                                                                                                                                                                                                                                                                                                 | Reads                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/web/src/app/guards/active.guard.ts`, `anon.guard.ts`                                                                                                                                                                                                                                                           | `principal.kind` from `session.ts`                                                           |
| `apps/web/src/environments/environment.ts` (P2)                                                                                                                                                                                                                                                                      | a comment naming `provideFeatureFlags` → `provideFlags`                                      |
| `libs/features/shared/catalog/src/lib/content/{catalog-content.service,media-url-cache}.ts`, `libs/features/shared/shell/src/lib/identity/session-identity.service.ts` (+ specs) (P0)                                                                                                                                | `MEDIA_READER`/`AUTH_GATEWAY` injection — the shared services P4–P7 compile and test against |
| `libs/features/client/account/src/lib/client-account/client-account.ts` (+ `.html`)                                                                                                                                                                                                                                  | `principal.kind`, `principal.uid.value`; `REWARD_PROGRESS_READER` in a comment               |
| `libs/features/client/booking/src/lib/client-booking/client-booking.ts`                                                                                                                                                                                                                                              | `principal.kind`, `principal.uid.value` (×4)                                                 |
| `libs/features/client/account-state/src/lib/own-profile.ts`                                                                                                                                                                                                                                                          | `ProfilePorts.writeOwnProfile`, `PROFILE_WRITE_FAILED`                                       |
| `libs/infrastructure/firestore/src/lib/observe.ts`, `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts`                                                                                                                                                                                              | `subscribeWithRetry`'s legacy `Result` (`isSuccess()`, `.error.cause`)                       |
| `libs/infrastructure/firestore/src/lib/subscribe-with-retry.spec.ts`                                                                                                                                                                                                                                                 | legacy `isSuccess()`                                                                         |
| `libs/infrastructure/firebase-auth/src/lib/auth-gateway.adapter.spec.ts`                                                                                                                                                                                                                                             | legacy principal shapes                                                                      |
| `libs/infrastructure/storage/src/lib/avatar-uploader.adapter.spec.ts`, `libs/infrastructure/clock/src/lib/{system-clock,crypto-id-generator}.adapter.spec.ts`, `libs/infrastructure/web-storage/src/lib/local-storage-key-value-store.adapter.spec.ts`                                                               | the class adapters' legacy answers                                                           |
| `libs/infrastructure/firestore/src/lib/accounts.adapter.ts` (+ `.spec.ts`, `.integration.spec.ts`)                                                                                                                                                                                                                   | `writeOwnProfile` (dies, 4A-3 (2))                                                           |
| `libs/infrastructure/firestore/src/lib/streak-publish-gateway.adapter.ts` (+ spec)                                                                                                                                                                                                                                   | the frozen publish wire                                                                      |
| `libs/infrastructure/firebase-app/src/lib/lazy-port.ts` (+ `lazy-port.spec.ts`, `lazy-port.forms.spec.ts`)                                                                                                                                                                                                           | the class form                                                                               |
| `libs/infrastructure/firestore/src/lib/{firestore.adapters,firestore.lazy}.ts`, `libs/infrastructure/firestore/src/index.ts`, `libs/infrastructure/storage/src/index.ts`, `libs/infrastructure/clock/src/index.ts`, `libs/infrastructure/web-storage/src/index.ts`, `libs/infrastructure/firebase-auth/src/index.ts` | barrel lines of deleted/renamed adapters                                                     |
| `libs/features/staff/client-card/src/lib/{client-card.presenter,client-pages.vm,glance.presenter,records.presenter,client-card.format}.ts`                                                                                                                                                                           | `'Europe/Sofia'`, `AVATAR_UPLOADER`/`CLOCK` in contracts                                     |
| `libs/features/staff/client-card/src/lib/client-card.contracts.ts`, `client-achievements/achievements-page-state.ts`                                                                                                                                                                                                 | `AchievementScope.kind`                                                                      |
| `libs/features/admin/loyalty/src/lib/admin-rhythm.preview.ts`                                                                                                                                                                                                                                                        | `'Europe/Sofia'`                                                                             |
| `libs/features/shared/shell/src/lib/menu/site-menu.component.ts`                                                                                                                                                                                                                                                     | `'Europe/Sofia'` (already an importer)                                                       |
| `libs/features/client/profile/src/lib/client-profile/client-profile.html`, `contact-sheet/booking-contact-sheet.ts`                                                                                                                                                                                                  | the contact-change comments (D12(b) rewording)                                               |
| `apps/web/e2e/landing.spec.ts`, `apps/web/e2e/app-shell.spec.ts`, `tools/verify/p0/verify-p0.mjs`                                                                                                                                                                                                                    | mint `stage: 'active'` claims with no `tenantId` (4A-2 (b))                                  |
| `apps/functions/src/wire/{identity,waitlist,ops,triggers}.wire.ts` (+ specs), `edge.ts`, `edge.spec.ts`, `main.ts`, `main.spec.ts`                                                                                                                                                                                   | the frozen wire                                                                              |
| `tools/verify/p0/callable-answer.mjs` (+ spec)                                                                                                                                                                                                                                                                       | the frozen wire answers                                                                      |
| `libs/ecs-core/src/testing/fixtures/loyalty/vouchers.json`, `loyalty.fixtures.ts`, `tools/seed/promotions.mjs` (+ spec), `tools/seed/fixtures/promotions.fixtures.ts`, `tools/seed/fixtures/README.md`                                                                                                               | the nested legacy voucher shape (HANDOFF §3.2 flip 3)                                        |

### 1.2 Rules, TTL, indexes

| Rules line (today)                                                                                                                                                                                  | Successor (4a)                                                                                                                                   | Proved by                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match /users/{uid}` `allow update: if isOwner(uid) && … affectedKeys().hasOnly([...5 keys]) && ownerProfileValuesValid(...)` (+ the `ownerProfileValuesValid` function, if no other rule calls it) | `allow update: if false;` — the comment says every users write is the Admin SDK's (`verifyOtp`, `completeRegistration`, `updateProfile`, blocks) | `firestore.rules.integration.spec.ts`: an owner `firstName` update is DENIED (the old allow cases become deny cases or die with a `dead:` reason)                                      |
| `match /impersonationSessions/{sessionId}` `allow read, write: if isAdmin();`                                                                                                                       | `allow read: if isAdmin(); allow write: if false;`                                                                                               | rules spec: an admin `create`/`update` is denied; the unchanged read proved both ways — an admin read ALLOWED, a client read DENIED (no case exists today)                             |
| `match /invitations/{id}` `allow create: if isSignedIn() && …`, `allow update: if isSignedIn() && affectedKeys().hasOnly(['redemptionCount']) && …`                                                 | `allow create, update: if false;` (`get`/`list` unchanged)                                                                                       | rules spec: a signed-in create and a `+1` update are denied; the unchanged reads proved beside them — a signed-in client `get` ALLOWED, a client `list` DENIED, a staff `list` ALLOWED |
| `match /invitations/{id}/redemptions/{refereeUserId}` `allow create: if isOwner(refereeUserId) && …`                                                                                                | `allow create: if false;` (`get`/`list` unchanged)                                                                                               | rules spec: the referee's own create is denied; a signed-in `get` ALLOWED, a client `list` DENIED                                                                                      |

- **TTL:** `impersonationSessions` gains its writer, so the functions TTL
  adapter (`apps/functions/src/adapters/firestore-ttl.adapter.ts`
  `purgeAtFor`) gets the `Collections.ImpersonationSessions` case:
  `(endedAtUtcMs ?? expiresAtUtcMs) + 30 d` (runbook §2.1's row, which
  then names the callables as the writer). The TTL adapter stamps only
  `Set`/`Create` ops (`firestore-tx.adapter.ts` `applyPlan`: `Update`
  calls `applyUpdate` with no `withPurgeAt`), so `endImpersonation` writes
  the WHOLE ended body with ONE `WriteOp.set` (the transaction read the
  session; `ImpersonationSystem.endByAdmin` returns the whole ENDED
  session, whose variant fields a set replaces), never a
  `WriteOp.transition` — the re-stamp to `endedAtUtcMs + 30 d` then
  happens on the existing path. Pinned by `end-impersonation.pipeline.spec.ts`
  (the plan holds one `Set` of the ENDED body) and an
  `impersonation.integration.spec.ts` case (emulator: `purgeAt` after end
  = `endedAtUtcMs + 30 d`). No other TTL change.
- **Indexes:** none added or re-keyed. `impersonationSessions` index #9
  (`adminUserId, impersonationStatus`) already serves the reader; the
  callables read by id. `redeemInvitation` reads by id. `users` gains a
  never-queried root scalar (`profileEditedAtUtcMs`): single-field
  indexing of a scalar is harmless, no override.
- **Deploy order** (runbook §3, amended by P9 for 4a): the wire flip has
  no dual shape, so functions and hosting deploy together
  (`firebase deploy --only functions,hosting`), THEN the rules (the
  tightenings close the old direct-write paths only once the web that
  used them is gone). No index deploy. The flip-4 precondition (the
  default location's `timeZone`) still stands.

### 1.3 What else rides in this closure

- `apps/functions/src/lib/booking/tenant-zone.ts` `TENANT_ZONE`, `edge.ts`'s
  `WIRE_ZONE` and the `TenantZonePorts` bundle (`scheduling.port.ts`,
  `main.ts`' `tenantTimeZone` binding, the doubles) are deleted (4A-11,
  F-4). Every pipeline or command that read the tenant zone resolves its
  location's zone (or the default location's) through `resolveShopZone`
  in its impure read. The deploy-time cron option survives alone as
  `CRON_TIME_ZONE` (`apps/functions/src/lib/cron-zone.ts`, OQ-2). The
  integration specs that bind `WIRE_ZONE` today
  (`publish-streak-definition.integration.spec.ts`,
  `project-client-stats.integration.spec.ts`) bind the seeded default
  location instead (P1).
- `apps/functions/src/wire/booking.wire.ts`'s private `rolesOf`/`actorOf`
  and `lib/booking/caller-roles.ts`' `callerRoles`/`callerActor` fold into
  ONE helper (reuse, never copy) that keeps each call site's current input
  (§9 R6): `callerRoles` String-coerces claim entries, `actorOf` passes the
  raw array to `Actor.forCaller` — the fold keeps both readings behind two
  named functions in one file, each pinned.

---

## 2. The importer matrix

### 2.1 Name → ecs-core target (applies to every row of §2.2)

| Legacy name(s)                                                                                                                                                                                                                        | Target                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Result`, `ok`, `fail`, `isSuccess()`, `isFailure()`, `.value`/`.error` (kernel/application re-exports)                                                                                                                               | `@core/primitives` `Result`, `Result.ok`, `Result.err`, `.ok` narrowing                                                                                                                                                                                                                                                                                                                                        |
| `RepositoryError` (class, `.cause`)                                                                                                                                                                                                   | `@core/primitives` `RepositoryError.readFailed/writeFailed/malformed/unavailable`                                                                                                                                                                                                                                                                                                                              |
| `ZonedDateTime` (any re-export), `CalendarDay`, `Interval`, `TimeSlot`                                                                                                                                                                | `LocalDate` + `MinuteOfDay`/`EndMinute` (`@core/primitives`), `ScheduleSelection`/`SeatAssignment` (`@core/components`), `UtcEpochMs` only for stamps; specs: `@core/testing` `utcMs`, `localDate`, `minute`, `pinnedNowUtcMs`, `steppingNowUtcMs`, `FIXTURE_NOW_UTC_MS`, `FIXTURE_TIME_ZONE`; display: `formatWallClock`/`formatMinute`/`formatWeekdayLabels` (`libs/features/shared/visits` `wall-clock.ts`) |
| `CLOCK` / `ClockPort.now(zone)`                                                                                                                                                                                                       | `CLOCK_PORTS.nowUtcMs()` + `ZonedTimeSystem.shopNow(now, zone)`, the zone per 4A-11 (the location's; else `ShopZoneService.defaultZone()`)                                                                                                                                                                                                                                                                     |
| `ID_GENERATOR.next()`                                                                                                                                                                                                                 | `ID_PORTS.nextId()`                                                                                                                                                                                                                                                                                                                                                                                            |
| `FEATURE_FLAGS.isEnabled('a.b')`, `provideFeatureFlags(raw)`, `FEATURE_FLAG_KEYS`, `FeatureFlagKey`, `FeatureFlags.create`                                                                                                            | `FLAGS_PORTS.flagOn(FlagName.AB)`, `provideFlags(raw)` (§3.8), `FLAG_NAMES`, `FlagName`, `FeatureFlags.parse` (`@core/components`)                                                                                                                                                                                                                                                                             |
| `KEY_VALUE_STORE`                                                                                                                                                                                                                     | `KEY_VALUE_PORTS` (`kvGet`/`kvSet`/`kvRemove`)                                                                                                                                                                                                                                                                                                                                                                 |
| `BOOKING_DRAFT_STORE`, `BookingDraft*`, `BOOKING_FLOW_STEPS`                                                                                                                                                                          | `BOOKING_DRAFT_PORTS`, `BookingDraft` (§3.2), `BookingFlowStep`/`BookingFlowState.SPINE`                                                                                                                                                                                                                                                                                                                       |
| `AUTH_GATEWAY`, `AuthGateway`, `SignOutUseCase`                                                                                                                                                                                       | `AUTH_SESSION_PORTS` (`observePrincipal`, `refreshToken`, `signOut`, `currentIdentifier`, `currentDisplayName`)                                                                                                                                                                                                                                                                                                |
| `OTP_CLIENT`, `OtpClient`, `OtpClientError`, `RequestOtpUseCase`, `VerifyOtpUseCase`, `RegisterUserUseCase`, `MissingRegistrationFieldError`                                                                                          | `OTP_CHALLENGE_PORTS` + `PipelineError`; `registerUser` pipeline (§3.6)                                                                                                                                                                                                                                                                                                                                        |
| `EnsureSessionReadyUseCase`                                                                                                                                                                                                           | `ensureSessionReady` pipeline over `AUTH_SESSION_PORTS & TIMER_PORTS`                                                                                                                                                                                                                                                                                                                                          |
| `AUTH_DEPLOYMENT`, `DEFAULT_AUTH_DEPLOYMENT`, `AuthDeployment`, `createAuthStrategy`, `identifierKindForStrategy`, `authStrategyRequires`                                                                                             | `AUTH_DEPLOYMENT_PORTS.authDeployment` (= `AuthDeployment.DEFAULT`), `AuthStrategy.parse/identifierKind/requires` (`@core/components`)                                                                                                                                                                                                                                                                         |
| `Principal` (`kind: 'anonymous'\|'onboarding'\|'active'`, `uid.value`), `ANONYMOUS_PRINCIPAL`, `PrincipalId`, `activePrincipal`, `onboardingPrincipal`, `principalFrom`, `principalHasRole`, `roleFromPrimitive`, `isActivePrincipal` | `@core/components` `Principal` (`principalKind`: `ANONYMOUS\|ONBOARDING\|CLIENT\|STAFF`, `userId: UserId`), `Principal.anonymous/fromClaims/isActive/hasRole/hasAnyRole`; specs: `@core/testing` `principalFixture` (§3.7)                                                                                                                                                                                     |
| `Role`, `UserRole`, `STAFF_ROLES`, `MONEY_ROLES`, `USER_ROLES`, `worksTheBook`                                                                                                                                                        | `@core/components` `Role`, `STAFF_ROLES`, `MONEY_ROLES`, `USER_ROLES`, `ADMIN_ROLES` (new, §3.2), `mayBook`                                                                                                                                                                                                                                                                                                    |
| `classify`, `Settled`, `latchSettledPrincipal`                                                                                                                                                                                        | `GuestGuardSystem.classify/latch`, `SettledVerdict` (`@core/systems`)                                                                                                                                                                                                                                                                                                                                          |
| `Identifier`, `createIdentifier`, `reconstituteIdentifier`, `identifierEquals`, `phoneIdentifier`, `identifierChannelKey`                                                                                                             | `ParsedIdentifier.parse/phone/email/equals/channelKey` (`@core/components`)                                                                                                                                                                                                                                                                                                                                    |
| `OtpCode`, `OtpChallengeId`, `SessionKind` (lowercase), `RegistrationField`, `Partial<Record<RegistrationField, string>>`                                                                                                             | `OtpCode` (brand), `OtpId`, `SessionKind.New/Returning`, `RegistrationField`, `RegistrationFields` (`@core/components`/`@core/primitives`)                                                                                                                                                                                                                                                                     |
| `AuthFlowState/Event`, `advanceAuthFlow`, `AUTH_FLOW_INITIAL_STATE`                                                                                                                                                                   | `AuthFlowState/Event` (`authFlowStep`), `AuthFlowSystem.initial/next`                                                                                                                                                                                                                                                                                                                                          |
| `OnboardingFlowState/Event`, `ONBOARDING_FLOW_INITIAL_STATE`, `advance/backOnboardingFlowWithinPlan`, `onboardingPlanPosition`, `PERSONALIZE_STEPS`, `PersonalizeStep`                                                                | `OnboardingFlowState.initial`, `OnboardingFlowSystem.next/nextWithinPlan/backWithinPlan/planPosition`, `PERSONALIZE_STEPS`/`PersonalizeStep` (`@core/systems`) + a slug words table (4A-10)                                                                                                                                                                                                                    |
| `RedirectPath`                                                                                                                                                                                                                        | `RedirectPath` primitive (§3.1)                                                                                                                                                                                                                                                                                                                                                                                |
| `PhoneNumber`, `CountryIso2`, `toCountryIso2`, `examplePhoneNumber`, `formatPhoneDraft`, `countryCallingCode`, `listPhoneCountries`, `PhoneDraft`, `PhoneNumberInvalidReason`                                                         | `PhoneSystem.parse/parseCountry/countryOf/example/formatDraft/countryCallingCode/listPhoneCountries/formatInternational`, `PhoneDraft`, `PhoneCountry` (`@core/systems`, **lazily imported** wherever the eager chunk must not carry it — F6), `CountryIso2`/`PhoneNumber`/`E164` (`@core/components`), `PhoneInvalidReason` (`@core/primitives`)                                                              |
| `AVATAR_UPLOADER`, `AvatarUploader`, `AvatarRef`, `AvatarUploadError`, `UploadAvatarUseCase`, `RemoveAvatarUseCase`, `MAX_AVATAR_BYTES`                                                                                               | `AVATAR_PORTS` (`AvatarPorts`, `StoredFile`), `MediaError`, `uploadAvatar` pipeline, `AvatarSystem.MAX_BYTES` (§3.5)                                                                                                                                                                                                                                                                                           |
| `MEDIA_READER`, `MediaReader`, `MediaRef` (class), `MediaVariant`, `MediaUnavailableError`, `MediaReadError`                                                                                                                          | `MEDIA_RESOLVE_PORTS` (`resolveMedia(ref: MediaRef)`), `MediaVariant` (`@core/ports`), `MediaRef` (flat, `@core/components`), `MediaError`                                                                                                                                                                                                                                                                     |
| `profileCompletion`                                                                                                                                                                                                                   | `ProfileCompletionSystem.completion` + a key words table (4A-10)                                                                                                                                                                                                                                                                                                                                               |
| `BOOKING_GATEWAY`, `WAITLIST_GATEWAY`, `BookingGateway*`, `WaitlistGateway*`, every `…Request`/`CommittedBooking`/`StaffEdited…`/`StaffEditCommand`/`StaffDiscountRequest`/`CommitBookingSeatRequest`                                 | `GATEWAY_PORTS.callableClient(Callables.X)` typed by `CallableWire` (§3.4); payloads/answers are the call components `BookingCall`, `WaitlistCall` (§3.2)                                                                                                                                                                                                                                                      |
| `BookingGatewayError`, `WaitlistGatewayError`, `DomainError`, `wordError`                                                                                                                                                             | `PipelineError` (+ `fromWire`), `wordPipelineError` (§3.9)                                                                                                                                                                                                                                                                                                                                                     |
| `shopReachKey`                                                                                                                                                                                                                        | `ShopReach.forCallHref` (`@core/components`)                                                                                                                                                                                                                                                                                                                                                                   |
| `BarberId`, `ServiceId`, `ServiceVariantId`, `LocationId`, `CartLineId`, `GuestId`, `UserId` (`.create`, `.value`)                                                                                                                    | the `@core/primitives` brands (`.parse`; the value IS the string)                                                                                                                                                                                                                                                                                                                                              |
| `SeatKey` (class), `seatKeyValue`                                                                                                                                                                                                     | `SeatKey` + `SeatKey.text` (`SeatKeyText`)                                                                                                                                                                                                                                                                                                                                                                     |
| `BarberPref`, `BookingParty`, `BookingCart`, `CartLine`, `NewCartLine`, `FlexibleWhen`, `DayWindows`, `ScheduleSelection`, `SeatAssignment`, `BookingConfirmation`, `WaitlistedSummary`, `ReconstituteBookingCartProps`               | same-named `@core/components` plain data (`Party`/`PartyMember` for the party) + `BookingCartSystem`                                                                                                                                                                                                                                                                                                           |
| `BookingFlowState/Step/Event`, `advanceBookingFlow`, `initialBookingFlowState`, `BookingFlowError`                                                                                                                                    | `BookingFlowState` (`bookingFlowStep`), `BookingFlowState.initial/SPINE`, `BookingFlowSystem.next`, `BookingFlowError` (`@core/primitives`)                                                                                                                                                                                                                                                                    |
| `MAX_PARTY_SIZE`, `MAX_FLEXIBLE_DAYS`, `MAX_BOOKING_NOTE_LENGTH`                                                                                                                                                                      | `BookingPolicy` limits (`maxPartySize`, `maxFlexibleDays`), `BookingContact.MAX_NOTE_LENGTH`                                                                                                                                                                                                                                                                                                                   |
| `BookingContact` (class), `BookingContactProps`                                                                                                                                                                                       | `BookingContact` (`@core/components`, `create(raw, parsePhone)`)                                                                                                                                                                                                                                                                                                                                               |
| `RecurrenceRule/Series/End/Pattern/Frequency`, `MonthlyDay`, `Weekday`, `WEEKDAYS`, `isoOf`, `weekdayFromIso`                                                                                                                         | `RecurrenceRule`, `RecurrencePattern`, `RecurrenceEndRule`, `RecurrenceFrequency`, `RecurrenceEnd`, `MonthlyAnchor`, `WeekOfMonth` (`@core/components`), `Weekday` (ISO 1–7, `@core/primitives`), `RecurrenceSystem`                                                                                                                                                                                           |
| `AppointmentStatusKind`, `CancellationReasonKind`, `OFFERED_CANCELLATION_REASONS`                                                                                                                                                     | `BookingStatus`, `CancellationReason`, `SeatOutcome.OFFERED_REASONS` + words tables                                                                                                                                                                                                                                                                                                                            |
| `isClientOperationId`, `isGuestKey`                                                                                                                                                                                                   | `ClientOperationId`, `GuestKey` (§3.1)                                                                                                                                                                                                                                                                                                                                                                         |
| `Actor`, `actorForCaller` (governance)                                                                                                                                                                                                | `Actor`, `Actor.forCaller` (`@core/components`)                                                                                                                                                                                                                                                                                                                                                                |
| `IdGenerator`, `ClockPort` (infrastructure classes)                                                                                                                                                                                   | deleted with `CryptoIdGenerator`/`SystemClock`; `browserIdPorts`/`browserClockPorts` exist                                                                                                                                                                                                                                                                                                                     |
| `REWARD_PROGRESS_READER`, `RewardProgress*`, `RewardProgramId`, `CONTACT_CHANGE_PORT`, `ContactChange*`, `ConfirmationCode`                                                                                                           | deleted, no successor (4A-14)                                                                                                                                                                                                                                                                                                                                                                                  |

### 2.2 Files, by owning package (imports as `lib: names`)

**P1 — functions, server pipelines, rules, P0 tools**

| File                                                      | Imports today                                                                                         | Target / note                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/functions/src/adapters/flags.adapter.spec.ts`       | domain/governance: `FEATURE_FLAG_KEYS`, `FeatureFlagKey`                                              | the two-vocabulary pin dies; re-pin `Object.keys(FLAG_PARAMS)` == `FLAG_NAMES`                                                                               |
| `apps/functions/src/lib/booking/caller-roles.ts` (+ spec) | domain/accounts: `UserId`, `worksTheBook`, `USER_ROLES`; domain/governance: `Actor`, `actorForCaller` | `UserId.parse`, `mayBook`, `Actor.forCaller`, `ADMIN_ROLES`; fold with `booking.wire.ts`' `rolesOf`/`actorOf` (§1.3); spec cases on `actorRole`/`actorRoles` |
| `apps/functions/src/lib/flags.ts` (+ spec)                | domain/governance: `FeatureFlagKey`, `FEATURE_FLAG_KEYS`                                              | `Record<FlagName, BooleanParam>` with computed keys, `flagOn(key: FlagName)`                                                                                 |
| `apps/functions/src/wire/booking.wire.ts`                 | application/booking: `isClientOperationId`, `isGuestKey`                                              | `ClientOperationId`, `GuestKey`; the whole decoder/encoder set flips (4A-4)                                                                                  |
| `apps/functions/src/wire/loyalty.wire.ts`                 | application/booking: `isClientOperationId`                                                            | `ClientOperationId`; `decodeStreakCaller` → `Actor.forCaller(uid, callerRoles(verified))` directly                                                           |
| `firestore.rules`                                         | comment mentions                                                                                      | the three tightenings (§1.2); the comments naming `@creativo/domain/accounts` are 4b's                                                                       |
| `tools/flags/feature-flags.manifest.spec.mjs`             | domain/governance: `FEATURE_FLAG_KEYS`, `FeatureFlags`                                                | `FLAG_NAMES`, `FeatureFlags.parse` (`.ok`, `.error[].errorCode`); drop a case `feature-flags.data.spec.ts` already proves, with a `dead:` line               |

**P2 — web infrastructure and the composition root**

| File                                                                                                       | Imports today                                                                                                                                                                                                                                                                                                                                                                                              | Target / note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/app.config.ts`                                                                           | kernel `fail`; identity `AUTH_DEPLOYMENT`, `AUTH_GATEWAY`, `DEFAULT_AUTH_DEPLOYMENT`, `OTP_CLIENT`; booking `BOOKING_DRAFT_STORE`, `BOOKING_GATEWAY`, `WAITLIST_GATEWAY`; catalog `MEDIA_READER`; engagement `REWARD_PROGRESS_READER`; accounts `CONTACT_CHANGE_PORT`, `AVATAR_UPLOADER`, `AvatarUploadError`; shared `CLOCK`, `ID_GENERATOR`, `KEY_VALUE_STORE`, `RepositoryError`, `provideFeatureFlags` | factory rows for every §3.8 token; lazy factory rows for `AVATAR_PORTS`/`MEDIA_RESOLVE_PORTS` with `onLoadError` → `Result.err(MediaError.transient(path))`; `dataUnavailable` → `RepositoryError.unavailable()`; `PROFILE_PORTS` row drops `writeOwnProfile`; `LOYALTY_SHOP_ZONE` goes: the catalogue's day becomes the async pipeline `shopToday` (`@core/pipelines`, over `CLOCK_PORTS` + `readShopZone(null)`, default location, 4A-11; §11.6), bound inside the lazy firebase-data scope so `@core/systems`/`@core/pipelines` stay off the eager graph (§9 R10); `firebaseData` → `lazyAdapterScope(…)` (4A-14) |
| `libs/infrastructure/clock/src/lib/crypto-id-generator.adapter.ts`, `system-clock.adapter.ts` (+ specs)    | shared `IdGenerator`, `ClockPort`; kernel `ZonedDateTime`, `InvalidTimeZoneError`, `Result`                                                                                                                                                                                                                                                                                                                | deleted (4A-14)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `libs/infrastructure/firebase-auth/src/lib/auth-gateway.adapter.ts` (+ spec)                               | kernel `Result/fail/ok`; identity `AuthGateway`, `AuthGatewayError`, `ANONYMOUS_PRINCIPAL`, `AuthClaims`, `Identifier`, `Principal`, `PrincipalId`, `parseAuthClaims`, `principalFrom`, `reconstituteIdentifier`                                                                                                                                                                                           | `authSessionPorts(auth): AuthSessionPorts` closure factory (§3.10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `libs/infrastructure/firebase-auth/src/lib/otp-client.adapter.ts` (+ spec)                                 | kernel `Result`, `PhoneNumber`; identity `OtpChallengeId`, `OtpClient`, `OtpClientError`, `Identifier`, `OtpCode`, `RegistrationField`, `SessionKind`, `identifierChannelKey`, `phoneIdentifier`                                                                                                                                                                                                           | `otpChallengePorts(auth, gateway): OtpChallengePorts` over `callableClient` (`devCode` stash, `signInWithCustomToken` kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/infrastructure/firestore/src/lib/booking-gateway.adapter.ts` (+ spec), `waitlist-gateway.adapter.ts` | kernel; booking gateway DTOs                                                                                                                                                                                                                                                                                                                                                                               | deleted; their table moves to `PipelineError.fromWire` (P0), their spec cases to `pipeline-errors.data.spec.ts` / `callable-client.adapter.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `libs/infrastructure/firestore/src/lib/contact-change.adapter.ts` (+ spec)                                 | accounts contact-change names                                                                                                                                                                                                                                                                                                                                                                              | deleted (D12(b))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `libs/infrastructure/firestore/src/lib/firestore-paths.ts`                                                 | accounts `UserId`; engagement `RewardProgramId`                                                                                                                                                                                                                                                                                                                                                            | deleted with the reward reader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `libs/infrastructure/firestore/src/lib/reward-progress-reader.adapter.ts` (+ spec, + integration spec)     | kernel, engagement, shared                                                                                                                                                                                                                                                                                                                                                                                 | deleted (dormant)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `libs/infrastructure/firestore/src/lib/subscribe-with-retry.ts`                                            | kernel `Result`, shared `RepositoryError`                                                                                                                                                                                                                                                                                                                                                                  | flat `Result<T, RepositoryError>` with an `onError(cause) → RepositoryError` parameter; reuses `retryDelayMs`/`DATA_RETRY_DELAYS_MS` (`firebase-app/retry-schedule.ts`) instead of its own table; `observe.ts`, `appointment-photos.adapter.ts` stop re-mapping                                                                                                                                                                                                                                                                                                                                                      |
| `libs/infrastructure/storage/src/lib/avatar-uploader.adapter.ts` (+ spec)                                  | kernel; accounts `AvatarRef`, `AvatarUploader`, `AvatarUploadError`                                                                                                                                                                                                                                                                                                                                        | `avatarPorts(storage): AvatarPorts` closure; the guard leaves (P0's `AvatarSystem`); `mediaErrorOf` lifted from `appointment-photos.adapter.ts` into one shared module beside `storageErrorCode`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `libs/infrastructure/storage/src/lib/media-reader.adapter.ts` (+ spec)                                     | kernel; catalog `MediaRef`, `MediaReadError`, `MediaReader`, `MediaUnavailableError`, `MediaUnavailableReason`, `MediaVariant`; shared `RepositoryError`                                                                                                                                                                                                                                                   | `mediaResolvePorts(storage): MediaResolvePorts` closure answering `MediaError.notFound/forbidden/transient`; width per §3.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/infrastructure/web-storage/src/lib/local-storage-key-value-store.adapter.ts` (+ spec)                | kernel; shared `KeyValueStore`, `KeyValueStoreError`                                                                                                                                                                                                                                                                                                                                                       | `localStorageKeyValuePorts(): KeyValuePorts` (keeps `localStorage`, not session)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `libs/infrastructure/web-storage/src/lib/session-storage-draft-store.adapter.ts` (+ spec)                  | kernel; booking `BOOKING_FLOW_STEPS`, `BookingDraft*`                                                                                                                                                                                                                                                                                                                                                      | `sessionStorageBookingDraftPorts(): BookingDraftPorts` over `BookingDraft.is`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**P3 — session, identity and shell UI** (`apps/web/src/app/**` but
`app.config.ts`; `apps/web/e2e/support/sign-in.ts`, `landing.spec.ts`,
`app-shell.spec.ts`; `libs/features/client/{auth,onboarding,profile,account}/**`;
`libs/features/shared/{shell,catalog}/**`; `libs/features/marketing/**`)

| File                                                                                                                                                                                                  | Imports today                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/e2e/support/sign-in.ts`                                                                                                                                                                     | domain/accounts: `UserRole` → `Role`; mint via `AuthClaims.toToken` with the seed tenant                                                                                                                                                                                                         |
| `apps/web/src/app/app.routes.ts`                                                                                                                                                                      | domain/accounts: `STAFF_ROLES` → `@core/components` `STAFF_ROLES`, `ADMIN_ROLES`, `Role.*` constants                                                                                                                                                                                             |
| `apps/web/src/app/app.spec.ts`                                                                                                                                                                        | identity `AUTH_GATEWAY`; kernel `ok`; identity `ANONYMOUS_PRINCIPAL`                                                                                                                                                                                                                             |
| `apps/web/src/app/guards/home.guard.ts` (+ spec), `roles.guard.ts`, `session.ts` (+ `active.guard.ts`, `anon.guard.ts`)                                                                               | identity `AUTH_GATEWAY`, `EnsureSessionReadyUseCase`, `ANONYMOUS_PRINCIPAL`, `Principal`, `PrincipalId`, `principalHasRole`, `roleFromPrimitive` → `ensureSessionReady` pipeline, `SessionAccessSystem.decide`, `rolesGuard(...roles: readonly Role[])`                                          |
| `apps/web/src/app/shell/session-expiry.service.ts`                                                                                                                                                    | identity `AUTH_GATEWAY`                                                                                                                                                                                                                                                                          |
| `libs/features/client/auth/src/lib/auth-flow.store.ts` (+ spec)                                                                                                                                       | identity `AUTH_DEPLOYMENT`, `AUTH_FLOW_INITIAL_STATE`, `AuthFlowEvent`, `AuthFlowState`, `Identifier`, `OTP_CLIENT`, `OtpChallengeId`, `RequestOtpUseCase`, `SessionKind`, `VerifyOtpUseCase`, `advanceAuthFlow`, `identifierEquals`, `createIdentifier`, `ok`                                   |
| `libs/features/client/auth/src/lib/client-auth/client-auth.ts` (+ spec)                                                                                                                               | identity `AUTH_DEPLOYMENT`, `AUTH_GATEWAY`, `RedirectPath`, `Settled`, `classify`, `identifierKindForStrategy`, `latchSettledPrincipal`, `OtpCode`, `createIdentifier`, `ANONYMOUS_PRINCIPAL`, `AuthDeployment`, `DEFAULT_AUTH_DEPLOYMENT`, `OTP_CLIENT`, `OtpClientError`, `createAuthStrategy` |
| `libs/features/client/onboarding/src/lib/onboarding-flow.store.ts` (+ spec)                                                                                                                           | identity (21 names incl. `RegisterUserUseCase`, `EnsureSessionReadyUseCase`, `SignOutUseCase`, the flow machine), accounts `AVATAR_UPLOADER`, `UploadAvatarUseCase`, shared `CLOCK`, catalog `ServiceId`                                                                                         |
| `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.ts` (+ spec)                                                                                                             | accounts `MAX_AVATAR_BYTES`; identity `CountryIso2`, `PhoneNumber`, `PhoneNumberInvalidReason`, `RedirectPath`, `RegistrationField`, `authStrategyRequires`, `examplePhoneNumber`, `identifierKindForStrategy`; shared `CLOCK`; spec: media/avatar/auth doubles                                  |
| `libs/features/client/profile/src/lib/profile.store.ts` (+ spec)                                                                                                                                      | accounts `AVATAR_UPLOADER`, `MAX_AVATAR_BYTES`, `RemoveAvatarUseCase`, `UploadAvatarUseCase`; shared `CLOCK` — and the users switch (4A-3 (2))                                                                                                                                                   |
| `libs/features/client/profile/src/lib/client-profile/client-profile.ts` (+ spec, `.html` comment)                                                                                                     | accounts `profileCompletion`; shared `CLOCK`                                                                                                                                                                                                                                                     |
| `libs/features/client/account/src/lib/client-account/client-account.spec.ts` (+ `client-account.ts`)                                                                                                  | accounts `AVATAR_UPLOADER`, `AvatarUploader`; identity `AUTH_GATEWAY`, `PrincipalId`, `Result`, `activePrincipal`, `ok`, `roleFromPrimitive`                                                                                                                                                     |
| `libs/features/shared/shell/src/lib/footer/site-footer.component.ts`, `header/site-header.component.spec.ts`, `identity/session-identity.service.ts` (+ spec), `menu/site-menu.component.ts` (+ spec) | identity `AUTH_GATEWAY`, `SignOutUseCase`, `Role`, principal builders; accounts `AVATAR_UPLOADER`, `AvatarRef`, `AvatarUploadError`, `UserRole`, `profileCompletion`, `STAFF_ROLES`                                                                                                              |
| `libs/features/shared/catalog/src/lib/content/catalog-content.service.ts` (+ spec), `media-url-cache.ts` (+ spec)                                                                                     | catalog `MEDIA_READER`, `MediaRef`, `MediaReader`, `MediaVariant`, `MediaUnavailableError`, `MediaReadError`; identity `AUTH_GATEWAY`, `Principal`, builders; shared `RepositoryError`                                                                                                           |
| `libs/features/marketing/{careers,courses,events}/src/lib/marketing-*/marketing-*.spec.ts`                                                                                                            | accounts `AVATAR_UPLOADER`; identity `AUTH_GATEWAY`, `ok`                                                                                                                                                                                                                                        |
| `libs/features/marketing/landing/src/lib/test-catalog.providers.ts`, `content/landing-content.service.spec.ts`                                                                                        | catalog `MEDIA_READER`, `MediaRef`, `MediaReader`, `MediaVariant`, `MediaUnavailableError`, `MediaReadError`, `ok`, `fail`, `Result`; shared `RepositoryError`                                                                                                                                   |

**P4 — the booking flow** (`libs/features/client/booking/**`)

| File                                                            | Imports today                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking-flow.store.ts` (+ spec)                                | booking (≈40 names: the class flow machine, `BookingDraft*`, `BookingCart`, `SeatKey`, `ScheduleSelection`, gateways, `CalendarDay`, `MAX_*`), catalog `LocationId`, `ServiceVariantId`, `BarberId`, `ServiceId`, shared `CLOCK` |
| `booking-return-url.ts` (+ spec)                                | identity `RedirectPath`                                                                                                                                                                                                          |
| `bag-sheet/booking-bag-sheet.ts`                                | booking `BarberPref`, `CartLine`, `CartLineId`; catalog `BarberId`, `ServiceVariantId`                                                                                                                                           |
| `client-booking/client-booking.spec.ts` (+ `client-booking.ts`) | identity (principal builders, `AUTH_GATEWAY`), accounts `AVATAR_UPLOADER`, booking (gateways, `TimeSlot`, `ZonedDateTime`, `MAX_PARTY_SIZE`, `Result`, `ok`), catalog `BarberId`, `LocationId`, `MEDIA_READER`, shared `CLOCK`   |
| `confirmed-step/booking-confirmed-step.ts`                      | catalog `BarberId` (+ `new Date(ms)` formatting)                                                                                                                                                                                 |
| `contact-sheet/booking-contact-sheet.ts` (+ spec)               | booking `BookingContact`, `BookingContactProps`, `MAX_BOOKING_NOTE_LENGTH`; shared `CLOCK`; identity `CountryIso2`, `PhoneNumber` — and the users switch (4A-3 (2))                                                              |
| `review-step/booking-error-message.ts` (+ spec)                 | booking `DomainError`, `shopReachKey`, `wordError`, `BookingGatewayError`                                                                                                                                                        |
| `review-step/booking-review-step.ts` (+ spec)                   | identity `PhoneNumber`, `AUTH_DEPLOYMENT`; booking `BookingContactProps`, `MAX_BOOKING_NOTE_LENGTH` (+ spec's doubles)                                                                                                           |
| `review-step/rider-placement.ts` (+ spec)                       | booking `ScheduleSelection` (+ spec's `TimeSlot`, `ZonedDateTime`, ids)                                                                                                                                                          |
| `schedule-step/availability-month.ts`                           | booking `CalendarDay`                                                                                                                                                                                                            |
| `schedule-step/booking-schedule-step.ts` (+ spec)               | booking `CalendarDay`, `ScheduleSelection`, `ZonedDateTime`; shared `CLOCK`                                                                                                                                                      |
| `schedule-step/time-sheet/booking-time-sheet.ts` (+ spec)       | booking `CalendarDay`, `ScheduleSelection`, `SeatAssignment`, `TimeSlot`, `ZonedDateTime`, `CartLineId`; catalog `BarberId`, `LocationId`; shared `CLOCK`                                                                        |
| `seat-scope-vm.ts`                                              | booking `SeatKey`                                                                                                                                                                                                                |
| `services-step/booking-services-step.ts` (+ spec)               | booking `BarberPref`, `CartLineId`, `SeatKey`, `seatKeyValue`; catalog `BarberId`, `ServiceId`, `ServiceVariantId`, `MEDIA_READER`                                                                                               |
| `waitlisted-step/booking-waitlisted-step.ts`                    | booking `DayWindows`                                                                                                                                                                                                             |

**P5 — client appointments** (`libs/features/client/appointments/**`)

| File                                                  | Imports today                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appointments.store.ts` (+ spec)                      | shared `CLOCK`; accounts `ZonedDateTime`; booking `BOOKING_GATEWAY`, `BookingGatewayError`, `fail`, `ok`                                                                                                      |
| `calendar-month.ts` (+ spec)                          | accounts `ZonedDateTime`; booking `Result` — the Phase-2 shim is deleted; the page reads `CalendarGridSystem.monthGrid` cells (`LocalDate`) directly                                                          |
| `client-appointments/client-appointments.ts` (+ spec) | accounts `ZonedDateTime`; booking `wordError`, gateway names; identity principal builders; shared `CLOCK`; catalog `MEDIA_READER` — the spec's `ZonedDateTime.now(…)` (wall-clock reads) become pinned clocks |

**P6 — the staff day** (`libs/features/staff/dashboard/**`)

| File                                          | Imports today                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `block-editor/block-repeat.ts` (+ spec)       | booking `CalendarDay`, `MonthlyDay`, `RecurrenceEnd/Frequency/Pattern/Rule/Series`, `WEEKDAYS`, `Weekday` — the legacy↔ecs bridge half is deleted; the preset helpers stay as thin calls over `RecurrenceSystem`                                                                                                                                                                                         |
| `block-editor/staff-block-editor.ts`          | booking `CalendarDay`, `DomainError`, `MonthlyDay`, `RecurrenceFrequency/Rule/Series`, `Weekday`, `isoOf`, `weekdayFromIso` — weekday labels through `formatWeekdayLabels`                                                                                                                                                                                                                               |
| `lane-gaps.spec.ts`                           | booking `Interval` → plain `LaneSpan` literals                                                                                                                                                                                                                                                                                                                                                           |
| `staff-dashboard/staff-dashboard.ts` (+ spec) | identity `AUTH_GATEWAY`, `MONEY_ROLES`, `principalHasRole`, `roleFromPrimitive`, `AUTH_DEPLOYMENT`, `countryCallingCode`; booking `BookingGatewayError`, `StaffDiscountRequest`, `AppointmentStatusKind`, `CancellationReasonKind`, `OFFERED_CANCELLATION_REASONS`, `StaffEditCommand`, `CommitBookingSeatRequest`, `wordError`; accounts `AVATAR_UPLOADER` (+ spec: gateway, clock, ids, media doubles) |
| `staff-day.store.ts`                          | booking gateway DTOs; identity `AUTH_GATEWAY`; shared `CLOCK`, `ID_GENERATOR`                                                                                                                                                                                                                                                                                                                            |
| `visit-editor/staff-visit-editor.ts` (+ spec) | identity `AUTH_DEPLOYMENT`, `countryCallingCode`, `formatPhoneDraft`, `CountryIso2`; shared `FEATURE_FLAGS` (+ spec: avatar, clock, flags)                                                                                                                                                                                                                                                               |

**P7 — client card and admin loyalty** (`libs/features/staff/client-card/**`,
`libs/features/admin/loyalty/**`, the voucher fixtures of §1.1)

| File                                                                                                                                                      | Imports today                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff/client-card/src/lib/client-card.store.ts` (+ spec)                                                                                                 | accounts `AVATAR_UPLOADER`; shared `CLOCK`, `FEATURE_FLAGS` (+ the `Date.now()` fallback)                                                                                                     |
| `staff/client-card/src/lib/achievements.presenter.ts`, `medal-detail.presenter.ts`                                                                        | booking `ZonedDateTime` (`startsAtIso` parsing)                                                                                                                                               |
| `staff/client-card/src/lib/client-ledger/client-ledger.spec.ts`                                                                                           | accounts `ZonedDateTime`; shared `CLOCK`, `provideFeatureFlags`                                                                                                                               |
| `staff/client-card/src/testing/achievements-pages.rig.ts`, `client-card.fixtures.ts`                                                                      | accounts `AVATAR_UPLOADER`, `AvatarUploader`, `AvatarRef`, `ZonedDateTime`; booking `Result`, `ok`; shared `CLOCK`, `provideFeatureFlags` — `InMemoryAvatars` (a class) → `memoryAvatarPorts` |
| `admin/loyalty/src/lib/admin-rhythm.store.ts` (+ spec), `admin-rhythm/admin-rhythm.spec.ts`, `admin-rhythm-sheet/admin-rhythm-sheet.spec.ts`, `README.md` | shared `CLOCK`, `FEATURE_FLAGS`, `ID_GENERATOR`, `provideFeatureFlags`; booking `ZonedDateTime`                                                                                               |

**P8 — design system, showcase, bundle guard**

| File                                                                                    | Imports today                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/ui/controls/src/lib/phone-field/phone-field.ts` (+ spec)                          | kernel `CountryIso2`, `PhoneDraft`, lazy `import('@creativo/domain/kernel')` → lazy `import('./phone-field.lazy')` re-exporting `PhoneSystem` from `@core/systems` (F6, R10) |
| `libs/ui/icons/src/lib/registry/icon-registry.service.ts` (+ spec), `logo/logo.spec.ts` | kernel `Result`, `ok`, `fail` → `@core/primitives`                                                                                                                           |
| `apps/showcase/src/app/pages/controls/phone-field/phone-field.page.ts`                  | kernel `CountryIso2`, `toCountryIso2` → `CountryIso2`, `PhoneSystem.parseCountry`                                                                                            |

---

## 3. Contracts (wave 0 — P0 builds them; every other package compiles against them)

### 3.1 Primitives (`libs/ecs-core/src/primitives/`)

- **Moved dictionaries** (4A-6): `cancellation-errors.data.ts`
  (`CancellationRefusalCode`, `CancellationRefusal` with
  `bookingStatus: string` on `NOT_CANCELLABLE`, `windowHours: number` +
  `deadlineUtcMs: UtcEpochMs` on `WINDOW_CLOSED`), `move-errors.data.ts`
  (`MoveErrorCode`, `CarriedSeatRefusal`, `MoveCarriedSeatUnplaceable`
  `{ errorCode, refusal, seatIds: readonly SeatId[] }`),
  `staff-edit-errors.data.ts` (`StaffEditErrorCode`, every struct —
  `StaffEditInvalidCommand`, `StaffEditForbidden`, `StaffEditStale`,
  `StaffEditBeforeArrival`, `StaffEditOverlaps` `{ errorCode, barberId,
localDate, startMinutes, resizeEdge: string | null }` — the union
  `StaffEditError` and its companion `StaffEditError` with scalar
  parameters only: `beforeArrival(localDate: LocalDate, finishMinutes:
EndMinute, arrivalLocalDate: LocalDate, arrivalMinutes: MinuteOfDay)`,
  the system caller spreading its `WallTime`). Values unchanged. Stay in
  systems, as unions of primitives structs naming a system's API:
  `StaffEditGuardRefusal`, `MoveError`. `MoveRefusal` /
  `MoveRefusalReason` stay components (view state, no `errorCode`).
- **The legacy codes' successors, each in ITS DOMAIN's dictionary** (no
  transport-named catch-all): one code per `LegacyWireCode` a decoder or a
  callable refusal function still raises that no ecs-core dictionary
  already means, added to the primitives dictionary of its domain with a
  flat struct and a companion factory. Mechanical spelling: the dotted
  code in SCREAMING. Booking → `BookingErrorCode` (`booking-errors.data.ts`:
  `BOOKING_COMMIT_FORBIDDEN`, `BOOKING_TRANSITION_NOT_ALLOWED`
  `{ fromBookingStatus: string; toBookingStatus: string }`,
  `BOOKING_ARRIVED_*`, `BOOKING_TIP_*`, …), the cancel's →
  `CancellationRefusalCode` beside its siblings
  (`BOOKING_CANCEL_NOT_FOUND`); ops → `RunBackfillRefusalCode`
  (`OPS_BACKFILL_UNAUTHENTICATED`); loyalty → `StreakPublishErrorCode`
  (`LOYALTY_STREAK_PUBLISH_*`); identity → `IdentityErrorCode` /
  `CompleteRegistrationRefusalCode`; waitlist → `CancelWaitlistRefusalCode`
  / `WaitlistErrorCode`. Where the reverse of `LEGACY_WIRE_CODE` already
  pairs a legacy code with an ecs-core code (`otp_locked_out` ↔
  `IDENTITY_OTP_LOCKED_OUT`, the waitlist's `CancelWaitlistRefusalCode`,
  `RunBackfillRefusalCode`, `CompleteRegistrationRefusalCode`), that code
  is used, never a second. The seven dead rows (`OtpValidationFailed`,
  `OtpDestinationEmpty`, `InvalidOtpMaxAttempts`, `EmptyId`,
  `InvalidDateTime`, `AccountsIdEmpty`, `InvalidTimeZone`) get none. P0
  ships the full successor table as ONE ledger spec
  (`primitives/legacy-wire-successors.spec.ts`: every live legacy dotted
  code, as a string literal, → its SCREAMING successor and the
  dictionary that holds it, total; no `callable-errors.data.ts` exists).
- **Governance / engagement additions:** `GovernanceErrorCode.ImpersonationUnauthenticated`
  (`'GOVERNANCE_IMPERSONATION_UNAUTHENTICATED'`), `ImpersonationForbidden`
  (`'GOVERNANCE_IMPERSONATION_FORBIDDEN'`, caller not admin — today's rule
  is `isAdmin()`; the system's staff gate stays as the second check);
  `EngagementErrorCode.InvitationNotFound`
  (`'ENGAGEMENT_INVITATION_NOT_FOUND'`, `{ invitationId }`),
  `InvitationAlreadyRedeemed` (`'ENGAGEMENT_INVITATION_ALREADY_REDEEMED'`,
  `{ invitationId }`), `InvitationUnauthenticated`
  (`'ENGAGEMENT_INVITATION_UNAUTHENTICATED'`). Branded ids, factories in
  the companions.
- **`PipelineError`** (`pipeline-errors.data.ts`) gains
  `wireStatus: string | null` (the `HttpsError` status the call failed
  with, `null` off the wire — a scalar) and `serverParams: WireParams`
  (`Readonly<Record<string, string | number | boolean | null>>`, `{}` when
  none — the projected struct's allowlisted scalar context, 4A-4, for
  interpolation only, never branched on; its key set per code is exactly
  the code's `EDGE_WIRE` allowlist and is pinned per code in
  `pipeline-errors.data.spec.ts`). The open-keyed record inside a
  primitives struct is a Law 7.5 question this plan puts to the owner
  (§10.6, default: keep it, bounded and pinned) rather than an unrecorded
  concession. And **`PipelineError.fromWire(status: string, details:
unknown): PipelineError`** — the ONE classification (4A-5):
  `serverErrorCode = details.errorCode ?? details.errors[0].errorCode ??
null`, `refusal`, `field` read off that struct, `serverParams` its other
  allowlisted scalar fields, `wireStatus = status`;
  `errorCode` from the status (`unauthenticated` → `UNAUTHENTICATED`;
  `invalid-argument`/`failed-precondition`/`not-found`/`permission-denied`/
  `already-exists`/`out-of-range` → `INVALID_REQUEST`;
  `unavailable`/`internal`/`deadline-exceeded`/`resource-exhausted` →
  `UNAVAILABLE`; else `UNKNOWN`) overridden by the per-code rows of
  today's adapters (slot taken, catalog changed, the 4A-5 special cases),
  re-keyed one for one. `PipelineError.isBlocked(error)` names the OTP
  request/verify "blocked" reading, on the wire STATUS as today
  (`functions/permission-denied` → `userBlocked`, whatever the code):
  `error.wireStatus === 'permission-denied'`. Pinned in
  `pipeline-errors.data.spec.ts`: a bare `permission-denied` with no
  `details` → `true`; `IDENTITY_OTP_LOCKED_OUT` (`resource-exhausted`, NOT
  blocked today) → `false`. (Not named `isLockedOut`, which would read as
  that code.)
- **Catalog addition:** `CatalogErrorCode.LocationZoneUnknown`
  (`'CATALOG_LOCATION_ZONE_UNKNOWN'`, `{ locationId }`) — `resolveShopZone`'s
  refusal when neither the named nor the default location exists (4A-11).
- **`ids.primitive.ts`:** `ClientOperationId`, `GuestKey` (4A-12).
- **`redirect-path.primitive.ts`** (new): `RedirectPath =
Brand<string, 'RedirectPath'>`; `RedirectPath.parse(raw): Result<…,
PrimitiveError>` (trim; must start with `/`; refuse `//`, `/\`, and a
  `scheme:` prefix — the legacy class's regex verbatim, its spec cases
  ported); `RedirectPath.root()`; `RedirectPath.parseOrRoot(raw)`;
  `RedirectPath.authDestination(p)` (`/` → `/account`). New
  `PrimitiveErrorCode.RedirectPathUnsafe`.
- **`repository-errors.data.ts`:** unchanged; its five codes get i18n keys
  (§3.11).

### 3.2 Components (`libs/ecs-core/src/components/`)

- **Call components** — the wire (4A-4). Each file follows the
  `streak-publish-call.data.ts` precedent: the root type is the family's
  primary request, the type-only namespace holds the other requests and
  the answers, the companion holds pure builders (`BookingCall.seat(…)`,
  `BookingCall.editMove(…)`) the web stores call instead of hand-building
  literals. Typed (branded) on the web side; the server decodes `unknown`.
  - `booking-call.data.ts` — `BookingCall` = commit `{ locationId:
LocationId; localDate: LocalDate; seats: readonly BookingCall.Seat[];
attemptId: ClientOperationId; contact: BookingContact.Input | null;
bookedFromAppointmentId: AppointmentId | null; onBehalfOfUserId:
UserId | null }`; **ONE seat shape**, `Seat { lineId: CartLineId;
serviceId: ServiceId; variantId: ServiceVariantId | null; barberId:
BarberId; barberPreference: BarberPreference | null; startMinutes:
MinuteOfDay; subject: BookingCall.Subject }`, and **ONE subject shape**,
    declared once: `Subject` = `{ requestedSubjectRole: 'SELF' }` |
    `{ requestedSubjectRole: 'GUEST'; label: string; guestKey: GuestKey |
null }` | `{ requestedSubjectRole: 'COMPANION'; companionUserId: UserId }`
    (the cart only ever builds SELF/GUEST; COMPANION is a staff edit's or a
    carried seat's, refused on a client cart as today). Its dictionary
    `RequestedSubjectRole` (`SELF`/`GUEST`/`COMPANION`) MOVES here from
    `guest-label.system.ts` (Law 8). The server's raw twin for its
    `unknown`-decoding step is declared ONCE beside it
    (`BookingCall.SeatInput` / `BookingCall.SubjectInput`, the L3 `…Input`
    escape: raw strings, `startMinutes: number | null`). Every other seat
    and subject shape retires into these, each importer re-pointed in the
    same change: `CommitSeatRequest` + `CommitSubject` + `CommitSubjectRole`
    (`booking-cart.system.ts` — the web cart builds `BookingCall.Seat`),
    `RequestedSeatInput` (`booking-decision.system.ts` →
    `BookingCall.SeatInput`), `MoveCartSeatInput` + `MoveSubjectRole`
    (`move.system.ts` — `MoveSystem` takes `BookingCall.Seat`;
    `MoveSubjectRole` dies for `RequestedSubjectRole`, same values),
    `RequestedSubjectInput` (`guest-label.system.ts` →
    `BookingCall.SubjectInput`), and the pipelines' `BookSeatRequest` and
    `RescheduleSeatRequest` (P1 deletes them: the commit and the reschedule
    take `BookingCall.Seat`/`SeatInput` on wall-clock `startMinutes`, no
    `startUtcMs`, no `moveSubjectRole`). `Reschedule { appointmentId;
locationId; localDate; seats: readonly BookingCall.Seat[]; attemptId:
ClientOperationId | null }`; `Cancel {
appointmentId; reason: string }`; `Transition { appointmentId;
toBookingStatus: BookingStatus; cancellationReason: CancellationReason
| null; note: string | null; seatId: SeatId | null }`; `Arrival {
appointmentId }`; `Tip { appointmentId; seatId; amountCents:
PriceCents | null }`; `StaffEdit { appointmentId; commands: readonly
BookingCall.EditCommand[]; acknowledgedOverlap: boolean;
expectedVersion: number | null; operationId: ClientOperationId | null
}`; `EditCommand` = today's server `EditCommandInput` (re-homed here
    from `edit-appointment.pipeline.ts`; P1 deletes the pipeline's copy)
    with wall-clock placement: `MOVE { localDate; startMinutes; seatIds |
null }`, `RESIZE { resizeEdge; localDate; atMinutes: EndMinute;
seatIds | null }`, `ADD_SEAT { …; localDate; startMinutes;
durationMinutes; addedSubject }`, the rest as today; the pipeline's
    `StaffDiscountRequest` and `AddedSeatSubject` re-home as
    `BookingCall.StaffDiscount` and `BookingCall.AddedSubject`, and
    `BookSeatRequest` as `BookingCall.Seat` (above). The `editCommand`
    and `resizeEdge` dictionaries (`EditCommand`, `ResizeEdge`, today in
    `appointment-edit.system.ts`) MOVE to `components/edit-command.data.ts`
    (Law 8: a component cannot type with a systems-tier dictionary); P0
    re-points `AppointmentEditSystem`, `GuestLabelSystem`,
    `BookingDecisionSystem`, `BookingCartSystem`, `MoveSystem`,
    `WaitlistSystem` and every importer (ecs-core, `apps/functions/src/wire/*`,
    `booking-flow.store.ts`, the type-specs, `tools/lint-rules/ecs-syntax.spec.mjs`
    — import lines and type names only) in the same change.
    Every re-homed type is a NAMESPACE member, so
    no top-level name exists twice while P1's copies still stand
    (`verify-tools:layering`' "one home per exported name" stays green
    in wave 0). Answers: `Committed { appointmentId }`, `Rescheduled {
appointmentId }`, `Cancelled { appointmentId }`, `Transitioned {
appointmentId; toBookingStatus }`, `Arrived { appointmentId;
alreadyArrived }`, `Cleared { appointmentId; alreadyClear }`,
    `TipRecorded { appointmentId; seatId; unchanged }`, `StaffEdited {
appointmentId; revision }`. A request that today may hold ONE command
    or an array always holds an array.
  - **Answer decoders (every call component):** each companion holds
    `decodeX(raw: unknown): Result<X, PipelineError>` for each of its
    answers, through the primitives' smart constructors
    (`BookingCall.decodeCommitted` with `AppointmentId.parse`,
    `IdentityCall.decodeVerifyOtpAnswer`, …) — the only way a callable's
    answer becomes branded data on the web (Law 7.4). A failing decode →
    `PipelineError.bare(UNKNOWN)`, today's "a 200 with nothing usable in
    it" (`booking-gateway.adapter.ts`: an empty or missing `appointmentId`
    is a failure). `callables.ts` (ports) holds the ONE runtime table
    `CALLABLE_ANSWER_DECODERS: { [N in CallableName]: (raw: unknown) =>
Result<CallableWire[N]['answer'], PipelineError> }`, total over
    `CallableName`.
  - `waitlist-call.data.ts` — `WaitlistCall` IS the re-homed
    `WaitlistAskInput` (`waitlist.system.ts`, P0 deletes it there and
    re-points `WaitlistSystem`): `{ locationId: LocationId | null; days:
readonly DayWindows[]; cart: BookingCart }` (the existing `DayWindows`
    component, never an inline re-declaration); its raw twin
    `WaitlistCall.Input` replaces `WaitlistAskInput`/`WaitlistAskDayInput`
    for the server's decoding step; `Cancel { requestId }`; `Requested {
requestId }`, `Cancelled { requestId }`.
  - `identity-call.data.ts` — `IdentityCall` = request OTP `{
identifierChannel; identifier: string }`; `RequestOtpAnswer {
challengeId: OtpId; devCode: string | null }`; `VerifyOtp {
challengeId; code: OtpCode }`; `VerifyOtpAnswer { sessionKind;
customToken }`; `CompleteRegistration { identifierChannel;
identifier; fields: RegistrationFields }`; `CompleteRegistrationAnswer
{ customToken }`; `UpdateProfile` = `ProfileEdits`;
    `UpdateProfileAnswer { changed }`.
  - `profile-edits.data.ts` — `ProfileEdits` MOVES here whole from
    `profile-edit.system.ts` (P0 re-points `ProfileEditSystem`,
    `update-profile.pipeline.ts`' import line, `own-profile.ts` and the
    specs in the same change; it keeps its raw `birthDate: string | null`,
    taking the `…Input` suffix only if L3 refuses it), with the companion
    `ProfileEdits.keep()` (every field `null`, the specs' `KEEP`).
  - `streak-publish-call.data.ts` — reused as the wire (`StreakPublishCall`,
    `.Withdraw`, `.Receipt`, the withdraw receipt); the answer gains
    `streakPublishOutcome: 'PUBLISHED' | 'WITHDRAWN' | 'REFUSED'` from a
    dictionary (`StreakPublishOutcome`). `REFUSED` carries today's ANSWERED
    refusals (`STREAK_PUBLISH_WIRE`) as the projected `StreakPublishError`
    struct with flat field names (no legacy nested locators),
    `earliest: LocalDate | null` and the attempted day — the web rebuilds
    `StreakPublishError.tooEarly(asked.day ?? earliest, earliest)` from it
    as today. `CALLER_NOT_ADMIN` stays answered; `CALLER_UNAUTHENTICATED`
    stays thrown. `LEGACY_FIELD_OF` (`loyalty.wire.ts`) and
    `FIELD_OF_LOCATOR` (`streak-publish-gateway.adapter.ts`) die
    together. Pinned round trip: `loyalty.wire.spec.ts` (encode) and the
    `streakPublishPorts` adapter spec (decode → the same struct, field
    highlighting and the too-early day).
  - `backfill-call.data.ts` — `BackfillCall` = `{ backfillJobName; cursor
| null; … }` as `run-backfill.pipeline.ts` reads it; `Page` = the
    pipeline's `BackfillPageResult` re-homed (P1 deletes the pipeline's
    copy and imports `BackfillCall.Page`), with `runStartedAtUtcMs` (no
    ISO).
  - `governance-call.data.ts` — `GovernanceCall` = start `{ targetUserId:
UserId; impersonationScope; reason: string; expiresAtUtcMs }`;
    `End { sessionId: ImpersonationSessionId }` (the server adds the
    caller, §3.6); `Started { sessionId }`;
    `Ended { sessionId; impersonationEndReason }`.
  - `invitation-call.data.ts` — `InvitationCall` = `{ invitationId }`;
    `Redeemed { invitationId; redemptionCount }`.
- **`booking-draft.data.ts`** (new, 4A-9): ONE name — `BookingDraft =
BookingFlowState & BookingContact & BookingDraft.Origin` plus
  `draftLocalDate: LocalDate | null` at the root; the `BookingDraftOrigin`
  dictionary (`FRESH` | `BOOKED_FROM` | `RESCHEDULE`, field
  `bookingDraftOrigin`) and the variants `BookingDraft.Fresh`,
  `.BookedFrom` (`bookedFromAppointmentId`, `bookedFromOwnerUserId`),
  `.Reschedule` (`rescheduleAppointmentId`, `rescheduleOwnerUserId`,
  `rescheduleLocalDate`, `rescheduleRiders: readonly MoveRider[]`,
  `rescheduleRelease: readonly ChairTime[]`) declared once in the
  type-only namespace — no second top-level type, no wrapper object, no
  null-presence tag. Companion: `BookingDraft.is(raw): raw is
BookingDraft` (the restore guard, today's `heldSource`/`heldMove`
  rules moved off the store over `MoveRider.is`/`ChairTime.is`, a failing
  held move → the `FRESH` origin as today's `null`), `BookingDraft.fresh(state,
contact, localDate)`, `.bookedFrom(…)`, `.reschedule(…)`.
  `booking-draft.type-spec.ts` proves `Disjoint` slices, `NoNested` 1-to-1
  fields and narrowing on `bookingDraftOrigin`. `MoveRider` and
  `ChairTime` move to `components/{move-rider,chair-time}.data.ts` (4A-9).
- **`role.data.ts`:** `ADMIN_ROLES = [Role.Admin, Role.Sysadmin]` (ONE
  home; `session-identity.service.ts`, `app.routes.ts` and
  `caller-roles.ts`' copies re-point).
- **`ProfileCompletion` keys** stay `NAME | PHONE | BIRTHDAY | PHOTO`; the
  shell maps them through a words table (4A-10).

### 3.3 Entities

- `user.entity.ts`: `UserMeta` gains `profileEditedAtUtcMs: UtcEpochMs |
null` (4A-16); the type-spec proves it disjoint; every ecs-core
  construction site (`RegistrationSystem.provision/register`, the
  `@core/testing` user fixtures, the memory double) writes `null` / keeps
  the stored value. No other entity changes.

### 3.4 Ports (`libs/ecs-core/src/ports/`) — the bundle map

| Bundle                                                                                  | File                             | Members                                                                                                                                                                                                                                                                                                                                                                                                                                                | Token / adapter                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthSessionPorts`                                                                      | `auth.port.ts`                   | `observePrincipal`, `refreshToken`, `signOut`, `currentIdentifier: () => ParsedIdentifier \| null` (the channel rides, phone wins — today's), `currentDisplayName`                                                                                                                                                                                                                                                                                     | `AUTH_SESSION_PORTS` / `authSessionPorts(auth)` (eager)                                                                                                                                    |
| `OtpChallengePorts`                                                                     | `auth.port.ts`                   | `requestOtpChallenge(identifier: ParsedIdentifier)`, `verifyOtpChallenge(challengeId, code)`, `completeRegistration(identifier: ParsedIdentifier, fields: RegistrationFields)`                                                                                                                                                                                                                                                                         | `OTP_CHALLENGE_PORTS` / `otpChallengePorts(auth, gateway)`                                                                                                                                 |
| `AuthPorts`                                                                             | `auth.port.ts`                   | `AuthSessionPorts & OtpChallengePorts` (kept, no consumer slices it)                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                                                          |
| `AuthDeploymentPorts`                                                                   | `identity.port.ts` (exists)      | `authDeployment`                                                                                                                                                                                                                                                                                                                                                                                                                                       | `AUTH_DEPLOYMENT_PORTS` / `useValue: { authDeployment: AuthDeployment.DEFAULT }`                                                                                                           |
| `GatewayPorts`                                                                          | `scheduling.port.ts` (exists)    | `callableClient: CallableClient` with `CallableClient = <N extends CallableName>(name: N) => Callable<CallableWire[N]['input'], CallableWire[N]['answer']>`                                                                                                                                                                                                                                                                                            | `GATEWAY_PORTS` / `callableClientPorts(functions)` (`libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts`)                                                                 |
| `CallableWire` (type map, not a bundle) + `CALLABLE_ANSWER_DECODERS` (its runtime twin) | `callables.ts`                   | `{ [Callables.CommitBooking]: { input: BookingCall; answer: BookingCall.Committed }; … }` — total over `CallableName`; the decoder table maps each name to its call component's answer decoder (§3.2); `Callables` gains `StartImpersonation`, `EndImpersonation`, `RedeemInvitation`                                                                                                                                                                  | the server's decoders/encoders type against it too                                                                                                                                         |
| `BookingDraftPorts`                                                                     | `storage.port.ts`                | `loadBookingDraft(): Result<BookingDraft \| null, RepositoryError>`, `saveBookingDraft(draft: BookingDraft)`, `clearBookingDraft`                                                                                                                                                                                                                                                                                                                      | `BOOKING_DRAFT_PORTS` / `sessionStorageBookingDraftPorts()`                                                                                                                                |
| `KeyValuePorts`                                                                         | `storage.port.ts`                | `kvGet`, `kvSet`, `kvRemove` (doc says `localStorage`)                                                                                                                                                                                                                                                                                                                                                                                                 | `KEY_VALUE_PORTS` / `localStorageKeyValuePorts()`                                                                                                                                          |
| `StoragePorts`                                                                          | `storage.port.ts`                | `BookingDraftPorts & KeyValuePorts`                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                          |
| `AvatarPorts`                                                                           | `media.port.ts` (exists)         | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                              | `AVATAR_PORTS` / lazy `avatarPorts(storage)`                                                                                                                                               |
| `MediaResolvePorts`                                                                     | `media.port.ts` (exists)         | `resolveMedia(ref: MediaRef)` — a named component, never loose scalars (`ecs-ports.md`); the adapter reads `ref.mediaPath` and answers `[{ width: ref.mediaWidth, url }]` as today's reader did; the content service passes the `MediaRef` its `MediaRef.parse` guard produced (R9) straight through. `ResolveMedia`'s path-only doc comment is reworded (no other caller exists)                                                                      | `MEDIA_RESOLVE_PORTS` / lazy `mediaResolvePorts(storage)`                                                                                                                                  |
| `FlagsPorts`                                                                            | `flags.port.ts` (exists)         | `flagOn`                                                                                                                                                                                                                                                                                                                                                                                                                                               | `FLAGS_PORTS` / `provideFlags(raw)`                                                                                                                                                        |
| `TimerPorts` (new)                                                                      | `tx.port.ts` beside `ClockPorts` | `delay(ms: number): Promise<void>`                                                                                                                                                                                                                                                                                                                                                                                                                     | `TIMER_PORTS` / `browserTimerPorts()` (`browser-runtime.adapter.ts`)                                                                                                                       |
| `TenantZonePorts`                                                                       | `scheduling.port.ts` (exists)    | DELETED (4A-11, F-4) by P1 in wave 1, once its server readers are re-typed (the one ports-tier line P1 edits, after P0 merged — like the `pipelines/index.ts` appends), with its `main.ts` binding and its `@core/testing` uses (`streak-publish-gateway.double.ts`); its readers take `LocationLoadPorts & DefaultLocationPorts` (`catalog.port.ts`, exist) through `resolveShopZone`; `ecs-ports.md`'s `tenantTimeZone` example is 4b's docs rewrite | — (web: `LOCATION_LOAD_PORTS`, `DEFAULT_LOCATION_PORTS`, exist; functions: a `locationLoadPorts(db)` member over `locations/{id}` and `defaultLocationId` from `TenantConfig.DEFAULT`, P1) |
| `ProfilePorts`                                                                          | `accounts.port.ts`               | `writeOwnProfile` REMOVED                                                                                                                                                                                                                                                                                                                                                                                                                              | `PROFILE_PORTS` (row edited)                                                                                                                                                               |
| `OtpStorePorts`, `AuthAdminPorts`                                                       | `identity.port.ts`               | `loadOtp`, `setClaims` REMOVED (4A-14)                                                                                                                                                                                                                                                                                                                                                                                                                 | functions adapters + doubles                                                                                                                                                               |
| `ImpersonationWritePorts`? — none                                                       |                                  | the server pipelines write through `CommitPorts` (`WriteOp`s), like every server pipeline                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                          |

`StreakPublishGatewayPorts` keeps its two members; its adapter becomes
`streakPublishPorts(gateway: GatewayPorts)` composed over the typed client
(P2).

### 3.5 Systems

- The three dictionaries leave (4A-6); the systems import them from
  `@core/primitives`.
- `AuditSystem`: `changeKey.ownProfileEdit(ownerUserId, editedAtUtcMs)`;
  `planOwnProfileEdit(ownerUserId, fields, nowUtcMs): AuditRowPlan |
null` (`Actor.user(owner)`, `PROFILE_UPDATED`, `null` when `fields` is
  empty); `ProfileChange` gains the raw flat stamps
  `beforeProfileEditedAtUtcMs` / `afterProfileEditedAtUtcMs`
  (`UtcEpochMs | null`), and `planProfileChange` returns `null` exactly
  when `beforeExists && afterExists && after… !== null && before… !==
after…` — the rule in the system, the decoder only decodes (4A-16; five
  spec cases).
- `ShopZoneSystem` (new `shop-zone.system.ts`): `zoneOf(named:
ShopLocation | null, fallback: ShopLocation | null): TimeZone | null` —
  the ONE home of the named → default rule `ProgramsSystem.zoneOf` holds
  today; `ProgramsSystem.zoneOf` wraps it with its unchanged
  `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` (its spec cases stay green).
- `EditCommand`/`ResizeEdge` (→ `components/edit-command.data.ts`),
  `RequestedSubjectRole` (→ `components/booking-call.data.ts`),
  `MoveRider` (→ `components/move-rider.data.ts`), `ChairTime`
  (→ `components/chair-time.data.ts`) leave the systems tier; the retired
  seat/subject/waitlist input types of §3.2 are deleted from
  `booking-cart`, `booking-decision`, `move`, `guest-label` and
  `waitlist` systems, which take the call components instead.
- `AvatarSystem` (new `avatar.system.ts`): `MAX_BYTES = 5 * 1024 * 1024`;
  `check({ contentType: string; sizeBytes: number }): Result<void,
AccountsError>` → `uploadAvatarNotAnImage()` unless `image/*`,
  `uploadAvatarTooLarge(MAX_BYTES)` above the limit — the adapter's and
  `UploadAvatarUseCase`'s rule, in that order, cases ported.
- `ProfileEditSystem` imports `ProfileEdits` from `@core/components` (it
  no longer declares it).

### 3.6 Pipelines (`libs/ecs-core/src/pipelines/`)

**Browser (P0):**

- `ensure-session-ready.pipeline.ts` — `ensureSessionReady(ports:
AuthSessionPorts & TimerPorts) => (): Promise<Result<Principal,
PipelineError>>`: the legacy use case's loop verbatim (first principal,
  `readiness(principal, refreshes)`, `delay`, `refreshToken`, re-read),
  its spec cases ported with a scripted principal stream.
- `register-user.pipeline.ts` — `registerUser(ports: OtpChallengePorts &
AuthDeploymentPorts) => (identifier, fields): Promise<Result<void,
PipelineError | IdentityError.RegistrationFieldMissing>>`:
  `RegistrationSystem.missingField(strategy, fields)` first (the legacy
  `MissingRegistrationFieldError` → `IDENTITY_REGISTRATION_FIELD_MISSING`
  with the field), then `completeRegistration`.
- `upload-avatar.pipeline.ts` — `uploadAvatar(ports: AvatarPorts) =>
(userId, image: Blob): Promise<Result<StoredFile, AccountsError |
MediaError>>`: `AvatarSystem.check` then `uploadAvatar`.
- `resolve-shop-zone.pipeline.ts` (browser AND server, 4A-11) —
  `resolveShopZone(ports: LocationLoadPorts & DefaultLocationPorts) =>
(locationId: LocationId | null): Promise<Result<TimeZone,
RepositoryError | CatalogError.LocationZoneUnknown>>`: load the named
  location (when one is given), else / when absent the default one
  (`ports.defaultLocationId`), then `ShopZoneSystem.zoneOf`; a read
  failure → its `RepositoryError` (4A-2 (e)). Spec: named found, named
  absent → default, `null` → default, both absent → `LOCATION_ZONE_UNKNOWN`,
  read failure → the repository error.

**Server (P1 — the contracts are fixed here, the files are P1's):**

- `book-appointment`, `reschedule-appointment`, `edit-appointment`:
  commands = the call component `&` server-derived fields (`ownerUserId`,
  `staffPlacement`, `actor`, `actorRoles`); per-seat/`MOVE`/`RESIZE`/
  `ADD_SEAT` placement arrives as `localDate` + minutes, and the
  pipeline, having loaded the location, computes `utcEpochMs` ONCE with
  `ZonedTimeSystem.toUtc` (gap → `DST_GAP_INVALID_TIME`, 4A-2 (a)). Every
  other decision is unchanged and their specs keep their cases (fixtures
  move from `startUtcMs` to wall-clock coordinates of the same instant).
- `project-client-stats`, `publish-streak-definition`, `run-backfill`,
  `request-waitlist`, `rebuild-busy`, `rebuild-capacity`, `match-waitlist`,
  `sample-lead-time`: `TenantZonePorts` / the command's `timeZone` field
  → `LocationLoadPorts & DefaultLocationPorts` and `resolveShopZone` in
  the impure read (4A-11); a resolve failure → the pipeline's existing
  store-failure outcome (4A-2 (e)). Their specs keep every case on the
  fixture default location (`FIXTURE_TIME_ZONE`) and add the failure case.
- `update-profile.pipeline.ts` — `UpdateProfilePorts = CommitPorts &
ClockPorts & HashPorts & TelemetryPorts`; the decide adds
  `profileEditedAtUtcMs` and the audit `WriteOp.create` (4A-16).
- `start-impersonation.pipeline.ts` — `(ports: CommitPorts & ClockPorts &
IdPorts & TelemetryPorts) => (cmd: GovernanceCall & { adminUserId;
adminRoles }) => Result<GovernanceCall.Started, readonly GovernanceError[]
| RepositoryError>`: caller not admin → `ImpersonationForbidden`;
  `ImpersonationSystem.start` with `id = nextId()`, `startedAtUtcMs =
nowUtcMs()`; ONE `WriteOp.create`. The legacy use case's spec cases
  are ported.
- `end-impersonation.pipeline.ts` — `(ports: CommitPorts & ClockPorts &
TelemetryPorts) => (cmd: GovernanceCall.End & { adminUserId: UserId |
null; adminRoles: readonly Role[] })`, the SAME caller shape as start:
  no caller → `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, caller roles not
  intersecting `ADMIN_ROLES` → `GOVERNANCE_IMPERSONATION_FORBIDDEN` —
  both BEFORE any read (today only `isAdmin()` may write the collection;
  `ImpersonationSystem.endByAdmin` checks neither roles nor ownership, so
  without this any signed-in caller holding a session id could end an
  admin's session). Then read by id in the transaction; absent →
  `EndImpersonationNotFound`; `ImpersonationSystem.endByAdmin(session,
adminUserId, now)`; ONE `WriteOp.set` of the whole ENDED body (so the
  TTL adapter re-stamps `purgeAt`, §1.2), never `WriteOp.transition`.
  Spec pins: unauthenticated, non-admin (both with zero reads), not
  found, admin end, expired end.
- `redeem-invitation.pipeline.ts` — `(ports: CommitPorts & ClockPorts &
TelemetryPorts) => (cmd: InvitationCall & { refereeUserId })`: reads the
  invitation and the redemption doc in ONE transaction; absent →
  `InvitationNotFound`; present → `InvitationAlreadyRedeemed` (today's
  "existence alone prevents double redemption"); `ReferralSystem.redeem`
  (self → `InvitationSelfRedemption`); ONE `CommitPlan`: `Create`
  `invitations/{id}/redemptions/{referee}` `{ redeemedAtUtcMs }` +
  `Update` `{ redemptionCount }`.

### 3.7 Test support (`@core/testing`, P0)

`memoryAuthSessionPorts({ principals$?, refresh?, signOut? })` (a
`BehaviorSubject` of `Principal`, scriptable answers),
`memoryOtpChallengePorts(script)`, `memoryBookingDraftPorts()`,
`memoryKeyValuePorts()`, `scriptedGatewayPorts(script: Partial<{ [N in
CallableName]: (input) => Result<answer, PipelineError> }>)` (records
every call), `memoryAvatarPorts()`, `memoryMediaResolvePorts(script)`
(forbidden / not-found / transient per path), `memoryFlagsPorts(on?:
readonly FlagName[])`, `immediateTimerPorts()` (records delays),
`principalFixture.{anonymous, onboarding(userId), client(userId),
staff(userId, roles)}` (tenant from the fixture tenant). `port-doubles.ts`
drops `writeOwnProfile`, `loadOtp`, `setClaims`; its user fixtures carry
`profileEditedAtUtcMs: null`. Each double has its spec cases in
`port-doubles.spec.ts`. Every double is a closure, never a class.

### 3.8 Web tokens and providers (`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`, P0)

The ten tokens of 4A-7, each `InjectionToken<TheBundle>` (no tenant-zone
token, 4A-11). Plus, in the same lib (P0): `provideFlags(raw: unknown)`
(`flags.provider.ts` + spec) — parses with `FeatureFlags.parse` and THROWS
at boot on failure (today's `provideFeatureFlags` contract: the app
refuses to boot on a bad manifest), providing `FLAGS_PORTS`; the
`FLAGS_PORTS` token has an all-off `factory` default (today's
`FEATURE_FLAGS` default for tests and secondary roots). And
`ShopZoneService` (`shop-zone.service.ts` + spec, root-provided):
`defaultZone(): Signal<TimeZone | null>` — `resolveShopZone(null)` over
the existing `LOCATION_LOAD_PORTS` & `DEFAULT_LOCATION_PORTS`, started
once on first read, cached for the session; `zoneOf(locationId):
Promise<Result<TimeZone, …>>` (4A-11). Feature specs bind the two
location tokens with `@core/testing`'s existing `memoryLocationLoadPorts`
and a fixture `defaultLocationId` whose location carries
`FIXTURE_TIME_ZONE`.

### 3.9 Web shared helpers (P0)

- `libs/infrastructure/i18n`: `wordPipelineError(error: PipelineError,
translate: (code, params) => string, fallbackCode: string, extraParams?:
Readonly<Record<string, string>>): string` (4A-5; `extraParams` merged
  over `serverParams` — the surface's derived words, e.g. the staff day's
  transition `from`/`to` from `bookingStatusWords`), spec'd against
  today's `wordError` cases (ported from `booking-gateway.port.spec.ts`),
  the two consuming surfaces' copy and the exact bg/en transition
  sentence. Beside `program-status-words.ts`: `bookingStatusWords`
  (`satisfies Record<BookingStatus, string>`) and
  `cancellationReasonWords` (`satisfies Record<CancellationReason,
string>`) — ONE table per dictionary (4A-10), spec'd total.
- `libs/features/shared/visits/src/lib/wall-clock.ts`:
  `formatWeekdayLabels(locale): readonly string[]` (Monday first, short),
  a cached `Intl.DateTimeFormat` over civil UTC — the successor of
  `ZonedDateTime.weekdayLabels` and of `staff-block-editor.ts`' and the
  booking steps' private copies; spec pins `bg` and `en` against today's
  output.
- `libs/features/client/account-state/**` (P0 owns it: the contract every
  identity reader compiles against): `AccountStateService.principal():
Signal<Principal>` (ecs), `roles()` via `Principal.isActive`,
  `userId(): UserId | null` (no `UserId.parse` round trip);
  `age-day.ts` total over `CLOCK_PORTS` (its `null` branch dies: callers'
  refuse-honestly cases get `dead:` lines); `own-profile.ts`
  `saveOwnProfile(gateway: GatewayPorts, edits)` over
  `Callables.UpdateProfile` returning today's code-or-null: `null` on
  success; the `serverErrorCode` for `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` /
  `_VALIDATION_FAILED` (their `errors.` keys exist); EVERY other failure —
  `serverErrorCode` `null` (the edge's bare `INTERNAL` store failure, a
  transport/offline failure), `REPOSITORY_*`,
  `ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED` (no `errors.` key),
  `PIPELINE_UNAVAILABLE`/`PIPELINE_UNKNOWN` — → `PROFILE_WRITE_FAILED`
  (`accounts.update_profile.repository_failure`, kept), today's one copy
  for a denied or failed write (4A-3 (2)). Each branch pinned over
  `scriptedGatewayPorts`. `nameRefusalCodes` unchanged.

### 3.10 The web adapters' contracts (P2 builds them)

- `callableClientPorts(functions): GatewayPorts` — `httpsCallable(name)`,
  then `CALLABLE_ANSWER_DECODERS[name](data)` (a table lookup — the
  decoding rules live in the call components, §3.2; a failing decode →
  `PipelineError.bare(UNKNOWN)`, today's "nothing usable in a 200") or
  `Result.err(PipelineError.fromWire(code, details))`; a
  non-`FunctionsError` → `PipelineError.bare(UNKNOWN)`. No other logic,
  never a cast of `data` to a branded answer. `callable-client.adapter.spec.ts`
  carries `booking-gateway.adapter.spec.ts`' "nothing usable" cases (empty
  / missing `appointmentId`, §11).
- `authSessionPorts(auth): AuthSessionPorts` — a closure keeping the
  class's mutable state (`endedOnPurpose`, the single-flight revive);
  `Principal.fromClaims({ userId, claims: AuthClaims.fromToken(raw) })`;
  the emulator revive stores and re-mints the token claims through
  `AuthClaims.toToken` (never the struct, whose key is `authStage`, §9 R2).
- `otpChallengePorts(auth, gateway)` — dials the three identity callables
  through `gateway.callableClient`; keeps `window.__e2eLastOtpCode` and
  `signInWithCustomToken`.
- `streakPublishPorts(gateway)`, `sessionStorageBookingDraftPorts()`,
  `localStorageKeyValuePorts()`, `avatarPorts(storage)`,
  `mediaResolvePorts(storage)` (`resolveMedia(ref: MediaRef)`; not-found
  and unauthorized → permanent, else transient, via the ONE lifted
  `mediaErrorOf`).
- `lazyAdapterScope(name, load)` — the closure successor of
  `LazyAdapterScope`/`LoadedScope` (4A-14); `onLoadError(scopeName,
cause)`; the ErrorHandler report a plain `Error` named
  `'LazyPortLoadError'` with today's message and `{ cause }`.

### 3.11 i18n (`libs/infrastructure/i18n/src/assets/i18n/{en,bg}.json`, P0 alone)

For every `errorCode` the flipped wire can answer, and every `PIPELINE_*`
code, an `errors.<CODE>` key (and `errors.<CODE>.<refusal|field>` where a
dotted key has refusal/field children), whose text is today's dotted
key's text VERBATIM (the pairing comes from `LEGACY_WIRE_CODE`, the
`legacy-wire-successors.spec.ts` ledger and the adapters' fallbacks); the five
`errors.REPOSITORY_*` keys copy `accounts.update_profile.repository_failure`'s
text (the profile surfaces keep reading `PROFILE_WRITE_FAILED` itself,
§3.9). `CATALOG_LOCATION_ZONE_UNKNOWN` gets no key: its `EDGE_WIRE` row is
the store-failure row (`internal`, nothing leaves), and on the web each
surface shows its own failed state (4A-2 (e)). Nothing renamed, nothing deleted (4b deletes the dotted keys);
`catalogue-parity.spec.ts` stays green. No other package edits these two
files (a package that finds a missing key reports it to the integrator).

---

## 4. Packages

Waves: **wave 0 = P0 alone** (the vocabulary). **Wave 1 = P1 … P8 in
parallel**, disjoint ownership. **Wave 2 = P9** (the sweep that needs
every importer gone: `nx sync`, the gate, the docs of record). A package
edits only the files it owns; when a wave-1 package needs a contract
change it asks the integrator, never edits P0's files. The two
sanctioned exceptions, each sequential after P0 merged: P1 appends its
pipelines' export lines to `pipelines/index.ts`, and P1 deletes
`TenantZonePorts` from `scheduling.port.ts` (+ its `@core/testing` uses
and the prose naming it in `identity.port.ts`) once its readers are
re-typed (§3.4).

### P0 — ecs-core vocabulary, web contracts, shared helpers · wave 0

**Owns:** `libs/ecs-core/src/{primitives,components,entities,ports,systems,testing}/**`
(except P7's voucher fixtures and P1's server pipeline files), the four
new pipelines (`ensure-session-ready`, `register-user`, `upload-avatar`,
`resolve-shop-zone`, + specs) + `pipelines/index.ts`,
`libs/infrastructure/firebase-app/src/lib/{ports.tokens,flags.provider,shop-zone.service}.ts`
(+ specs), `libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts`
AND its spec (the `TimerPorts` browser adapter; P0 also ports the three
cases of `system-clock.adapter.spec.ts` (2) and
`crypto-id-generator.adapter.spec.ts` (1) into it, or records them
`dead:`, so P2 only deletes), `libs/infrastructure/i18n/**`,
`libs/features/shared/visits/src/lib/wall-clock.ts` (+ spec),
`libs/features/client/account-state/**`, and the SHARED SERVICES every
wave-1 feature compiles and tests against —
`libs/features/shared/catalog/src/lib/content/{catalog-content.service,media-url-cache}.ts`
and `libs/features/shared/shell/src/lib/identity/session-identity.service.ts`
(+ their specs): their injection contracts (`MEDIA_RESOLVE_PORTS`,
`AUTH_SESSION_PORTS`, ecs `Principal`), constructor/`inject` lines,
public signal types and `MediaUrlCache` as a closure factory with its
`mediaFetchState` dictionary (P3's brief rules for the cache, carried out
here). P3 keeps those libraries' components, templates and every other
file; where a changed service signature breaks a consumer line inside
`shared-shell`/`shared-catalog` (`site-header.component.ts`,
`site-menu.component.ts` reading the identity service), P0 fixes exactly
those lines (mechanical, like the import lines), so both libraries
typecheck in wave 0. Every other consumer (P3's client/marketing files,
P4–P7) compiles against the new API in wave 1.
**Brief:** build §3.1–§3.9 and §3.11 exactly. Move the three dictionaries
and fix every importer's import line (mechanical: ecs-core pipelines and
specs, `apps/functions/src/edge.ts`, `booking.wire.ts`, their specs — the
import lines only). Move `EditCommand`/`ResizeEdge`, `RequestedSubjectRole`,
`MoveRider`, `ChairTime` to components and retire the duplicate seat,
subject and waitlist input types of systems into `BookingCall`/
`WaitlistCall` (§3.2, §3.5), re-pointing every importer (ecs-core,
`apps/functions/src/wire/*`, `booking-flow.store.ts`, the type-specs,
`tools/lint-rules/ecs-syntax.spec.mjs` — import lines and type names
only). Lift `ProgramsSystem.zoneOf`'s rule to `ShopZoneSystem.zoneOf` and
build `resolveShopZone` + `ShopZoneService` (4A-11). Add
`bookingStatusWords`/`cancellationReasonWords` to i18n (4A-10). Add
`profileEditedAtUtcMs` to `User` and every
ecs-core construction site. Declare the re-homed wire types as
NAMESPACE members of the call components (`BookingCall.EditCommand`,
`.StaffDiscount`, `.AddedSubject`, `.Seat`; `BackfillCall.Page`) and the
answer decoders + `CALLABLE_ANSWER_DECODERS`; the
pipelines keep their own top-level
declarations until P1 deletes them (the one sanctioned wave-0→1
overlap, gone at integration — §6 proves one home). Move `ProfileEdits`
whole to `components/profile-edits.data.ts` (§3.2), re-pointing
`accounts.adapter.spec.ts`/`.integration.spec.ts`' type import with it.
Add the export lines of the four new pipelines to
`pipelines/index.ts`; P1 appends its three in wave 1 (sequential, never
parallel, edits of one file).
Split `AuthPorts`/`StoragePorts`, type `CallableClient`, add `TimerPorts`,
drop `writeOwnProfile`/`loadOtp`/`setClaims` from the bundles AND their
functions adapters' return objects and doubles (`apps/functions/src/adapters/{firestore-otps,auth-claims}.adapter.ts`

- specs, `firestore-ports.spec.ts` — the member lines only) and the web
  `accounts.adapter.ts` member + its spec cases (`dead:` with 4A-3 (2)).
  The systems that name a refused WIRE field (`AppointmentEditSystem`'s
  `invalid('startIso' | 'atIso' | …)`, `BookingDecisionSystem`'s
  `invalidInput('priceMinorUnits')`) name the flipped field instead
  (`startMinutes`, `atMinutes`, `priceCents`, …; no `errors.*.<field>` key
  exists for the old names, so no copy changes), and the comments that
  describe the retired ISO rendering (`booking-errors.data.ts`,
  `appointment-edit.system.ts`, `booking-decision.system.ts`,
  `zoned-time.system.ts`) are reworded; `staff-intent.system.spec.ts`'
  fixtures move to the `BookingCall.EditCommand` shape (the basis is a hash
  of the command as sent, so its pinned values are re-recorded, §11).
  Port the legacy specs whose rules move here (§5.3). Leave ecs-core,
  functions and `seed-tools` typecheck green: every typed `User` literal
  outside ecs-core gets `profileEditedAtUtcMs: null` (the users lines
  only) — `tools/seed/fixtures/users.fixtures.ts`,
  `apps/web/e2e/support/seed-firestore.ts`,
  `apps/functions/src/integration/verify-otp.integration.spec.ts`,
  `libs/infrastructure/firestore/src/lib/accounts.adapter.integration.spec.ts`,
  `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`.
  `provideFlags` lives in `libs/infrastructure/firebase-app/src/lib/flags.provider.ts`
  (+ spec); P0 adds its and the tokens' lines to the lib's `index.ts`, P2
  appends its adapters' lines in wave 1.
  **Done when:** `pnpm nx run-many -t typecheck -p ecs-core functions
seed-tools client-account-state i18n firebase-app clock shared-visits
shared-catalog shared-shell --skip-nx-cache`, `pnpm nx run-many -t test
-p ecs-core client-account-state i18n firebase-app clock shared-visits
shared-catalog shared-shell` (incl. `catalogue-parity.spec.ts` green with
  the new `errors.*` keys), `pnpm nx run-many -t lint -p ecs-core
client-account-state i18n firebase-app clock shared-visits shared-catalog
shared-shell`, `verify-tools:layering --skip-nx-cache` green — so every
  wave-1 package starts from typechecked, tested web contracts.

### P1 — the server half of the wire flip, the callables, the rules · wave 1

**Owns:** `apps/functions/**` except `apps/functions/tsconfig.app.json`
(P9), `libs/ecs-core/src/pipelines/{book-appointment,reschedule-appointment,edit-appointment,update-profile,audit-profile-change,run-backfill,request-otp,verify-otp,complete-registration,request-waitlist,cancel-waitlist,publish-streak-definition,transition-appointment,cancel-appointment,mark-arrival,record-seat-tip,project-client-stats,rebuild-busy,rebuild-capacity,match-waitlist,sample-lead-time,continue-policy-recompute}.pipeline.ts`
(+ specs) and the three new server pipelines (+ specs), the
`TenantZonePorts` deletion lines (§4 intro),
`firestore.rules`, `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`,
`tools/verify/p0/**` (incl. `functions-deps.baseline.json`),
`tools/flags/**`, `docs/architecture/firestore-runbook.md` §2.1/§3 rows.
**Brief:** (1) Re-point the seven legacy importers (§2.2 P1). (2) Flip
every decoder and encoder to the call components (4A-4); type
`callableEdge` instances by `CallableWire`; delete `LegacyWireCode`,
`LEGACY_WIRE_CODE`, `LEGACY_WIRE_CODE_BY_CODE`, `WIRE_FIELD_NAME`,
`withWireCodes`, the `wallIso`/`wireFieldParam`/ISO param rendering,
`WIRE_ZONE` (4A-4, §1.3); `toHttpsError` answers `HttpsError(status,
errorCode, <the struct projected to its row's allowlist>)` — each
`EDGE_WIRE` row keeps its field list under the struct's own names, and
`edge.spec.ts` gains one case per code proving `detail`, `reason`,
`path`, `violations` (and every unlisted field) never leave; the streak
publish's ANSWERED refusals become `streakPublishOutcome: 'REFUSED'`
answers (§3.2), `LEGACY_FIELD_OF` deleted; each `LegacyWireCode` raise →
its §3.1 successor in its domain dictionary.
(3) Reshape the placement commands to wall clock (§3.6) and delete the
pipelines' duplicate input types in favour of the components
(`BookSeatRequest`, `RescheduleSeatRequest`, `EditCommandInput`,
`StaffDiscountRequest`, `AddedSeatSubject`, `BackfillPageResult`).
(3b) Zones (4A-11): delete `TENANT_ZONE`, `WIRE_ZONE`, every
`timeZone: WIRE_ZONE` of `triggers.wire.ts`/`waitlist.wire.ts` and the
`tenantTimeZone` binding; re-type the eight pipelines of §3.6 to
`LocationLoadPorts & DefaultLocationPorts` + `resolveShopZone`; add the
functions `locationLoadPorts` member (over the existing
`firestore-catalog.adapter.ts`) and `defaultLocationId` from
`TenantConfig.DEFAULT` to the root ports; `CRON_TIME_ZONE` in
`lib/cron-zone.ts` for the three `onSchedule` options only; delete
`TenantZonePorts` (§4 intro); the integration specs that bound `WIRE_ZONE`
(`publish-streak-definition.integration.spec.ts:38,155`,
`project-client-stats.integration.spec.ts`, `loyalty.wire.spec.ts`,
`triggers.wire.spec.ts`, `edge.spec.ts`' `WIRE_ZONE` pin → `dead:` 4A-11)
bind the seeded default location. (4) Build
`startImpersonation`, `endImpersonation` (caller-authorized like start,
ONE `WriteOp.set`, §3.6), `redeemInvitation` (+ edge rows,
`main.ts` wiring, the `impersonationSessions` TTL case), `updateProfile`'s
audit row and the trigger's skip (4A-16: the decoder carries the two raw
stamps; `AuditSystem` decides). (5) The three rules
tightenings + their rules-spec cases, each deny beside the allow/deny
pair that proves the unchanged reads (§1.2). (6) `verify-p0.mjs`:
payloads and answers on the flipped wire; (e) proves the callable-only
path — the owner's direct write is DENIED, `updateProfile` writes ONE
row, `actorRole: 'USER'` credited to the caller (the marker makes it
emulator-provable); minted test claims carry the tenant (4A-2 (b));
`callable-answer.mjs` reads the flipped answers. (7) Attempt lines
(4A-2 (c)). (8) `pnpm nx build functions --skip-nx-cache` then `node
tools/verify/p0/check-functions-deps.mjs --record`; the commit message
says why (4A-15). **Done when:** `typecheck/test/lint functions` and
`ecs-core`, `pnpm nx build functions`, the deps check, and — integrator
only — `test:emulator` and `verify:p0`.

### P2 — web infrastructure and `app.config.ts` · wave 1

**Owns:** `libs/infrastructure/{clock,firebase-auth,firestore,storage,web-storage,firebase-app}/**`
except `ports.tokens.ts`, `flags.provider.ts`, `shop-zone.service.ts`,
`browser-runtime.adapter.ts` (+ their specs, P0), the rules spec (P1),
and `accounts.adapter*` member lines P0 removed;
`apps/web/src/app/app.config.ts`; `apps/web/src/environments/**` (the
`provideFeatureFlags` comment → `provideFlags`).
**Brief:** build §3.10; delete §7's infrastructure files; convert every
remaining class adapter row to a factory row and delete the class form
of `provideLazyPort` (`Picker`, the per-`Type` injector map, its spec
cases → `dead:` "class form retired, 4A-14"), AND the remaining classes
of `lazy-port.ts`: `LoadedScope`/`LazyAdapterScope` → the closure
`lazyAdapterScope(name, load)`, `LazyPortLoadError` → `onLoadError(scopeName,
cause)` + a plain `Error` named `'LazyPortLoadError'` for the
ErrorHandler (4A-14; `lazy-port.spec.ts`/`lazy-port.forms.spec.ts` keep
their scope cases on the closure, the ErrorHandler line pinned
unchanged); `subscribeWithRetry` and its two callers on the flat
`Result`; bind every §3.8 token (auth and the gateway eager;
avatar/media lazy). No zone constant: `LOYALTY_SHOP_ZONE` goes and
the catalogue's day (`shopToday`, `@core/pipelines`, §11.6) resolves the
default location's zone with `readShopZone(null)` inside the lazy data scope (4A-11; keeps
`@core/systems`/`@core/pipelines` off the eager graph, §9 R10 — P2
confirms with the integrator's `verify:bundle` that `app.config.ts`
reaches neither statically). The clock lib's two class specs are DELETED
only (P0 ported their cases). Each new adapter has a spec; the deleted
adapters' cases land per §11.
**Done when:** `typecheck/test/lint` of the infrastructure projects and
`web`'s typecheck of `app.config.ts`.

### P3 — session, identity, profile, shell, catalog and marketing UI · wave 1

**Owns:** `apps/web/src/app/**` (but `app.config.ts`),
`apps/web/e2e/support/sign-in.ts`, `apps/web/e2e/landing.spec.ts`,
`apps/web/e2e/app-shell.spec.ts`, `libs/features/client/{auth,onboarding,profile,account}/**`,
`libs/features/shared/{shell,catalog}/**` except P0's three service
files (+ specs) and the consumer lines P0 fixed in wave 0,
`libs/features/marketing/**`.
**Brief:** §2.2 P3 rows. Guards on `ensureSessionReady` +
`SessionAccessSystem.decide`; `rolesGuard(...roles: readonly Role[])`
with `Role.*`/`ADMIN_ROLES`. Auth flow on `AuthFlowSystem`, OTP through
`OTP_CHALLENGE_PORTS`, the "blocked" branch on
`PipelineError.isBlocked` (the wire status, as today). Onboarding on `OnboardingFlowSystem` with
the slug words table; `registerUser`, `uploadAvatar` pipelines;
`RedirectPath`. Profile store: `uploadAvatar` pipeline,
`AVATAR_PORTS.removeAvatar`, the users switch (`saveOwnProfile` over the
gateway — P0's helper). Shell: `Principal.isActive/hasAnyRole`,
`AUTH_SESSION_PORTS.signOut` directly, `ProfileCompletionSystem` + key
words table, the site menu's date on `ShopZoneService.defaultZone()`
(4A-11; the subtitle absent until it resolves, 4A-2 (f), pinned in
`site-menu.component.spec.ts`). Catalog: the content service and
`MediaUrlCache` arrive re-pointed from P0 (`MEDIA_RESOLVE_PORTS` with the
parsed `MediaRef`, the `MediaRef.parse` guard kept — §9 R9;
`mediaFetchState`; the retry policy `MEDIA_FORBIDDEN` → per-viewer retry,
`MediaError.isPermanent` → unavailable, `MEDIA_TRANSIENT` → backoff,
exactly as today); P3 re-points the catalog lib's remaining files and
every P3 consumer of the shared services. The client-account and contact-change
comments reworded (D12(b)). e2e helpers mint through `AuthClaims.toToken`
with the seed tenant. Every spec stubs through `@core/testing` doubles.
**Done when:** typecheck/test/lint of the owned projects; `pnpm nx build
web` compiles the owned templates.

### P4 — the booking flow · wave 1 (the long pole)

**Owns:** `libs/features/client/booking/**`.
**Brief:** re-type `BookingFlowStore` to `BookingFlowState` +
`BookingFlowSystem`/`BookingCartSystem`/`MoveSystem`/`GuestLabelSystem`;
delete every legacy↔ecs mapper (`toPartyData`, `toPartyProps`,
`toCartData`, `toCartProps`, `toWhenData`, `toSeatAssignment`,
`LEGACY_BARBER_PREF`, `STEP_OF`, `toLocationKey`, `draftSource`,
`draftMove`, `heldSource`, `heldMove`, `moveRiderOf`, `cartRiderOf`,
`isRider`, `isChairTime` → `BookingDraft.is`); the draft through
`BOOKING_DRAFT_PORTS`; commit/reschedule/waitlist through the gateway
with `BookingCall`/`WaitlistCall` builders on wall-clock placement;
`attemptId` from `ID_PORTS` (`ClientOperationId.parse`); limits from
`BookingPolicy`; the contact sheet on `BookingContact.create(raw,
parsePhone)` with `PhoneSystem` lazily imported (F6) through its own
`*.lazy.ts` named re-export, never the namespace (§9 R10), and the users
switch; steps format the wall clock (`formatWallClock`/`formatMinute`/
`formatWeekdayLabels`) — no `new Date()`/`Date.now()` wall-clock read,
no `getFullYear()` (this year from `ShopNow`); the confirmed / review /
waitlisted steps' display fallbacks (`timeSlot.start.zoneName ?? …`,
`day.zone ?? …`) go (wall-clock formatting is zone-free); the two zone
chains the time systems read — `client-booking.ts`' `shopZone()` and
`booking-schedule-step.ts`' `zone` — keep "location → first listed shop"
and end on `ShopZoneService.defaultZone()` instead of `'Europe/Sofia'`
(4A-11); `availability-month.ts` on `LocalDate` +
`CalendarGridSystem` cells; errors through `wordPipelineError` +
`ShopReach.forCallHref`, the carried-seat branch on
`MoveErrorCode.CarriedSeatUnplaceable` + `CarriedSeatRefusal`; `?step=`
and every `data-*` attribute lowercase through ONE words table (4A-10);
the bag sheet's `select.kind` → a domain-prefixed SCREAMING field (its
`data-testid` spelling kept). The draft on the FLAT `BookingDraft` (4A-9:
contact at the root, `bookingDraftOrigin` variants, `draftLocalDate`);
the cart builds `BookingCall.Seat` (no `CommitSeatRequest`). Principals
from `AccountStateService` via `Principal.isActive`/`.userId`.
**Done when:** typecheck/test/lint `client-booking`; `pnpm nx build web`.

### P5 — client appointments · wave 1

**Owns:** `libs/features/client/appointments/**`.
**Brief:** `CLOCK_PORTS` + the zone per 4A-11 — "today" and the
focused month on `ShopZoneService.defaultZone()`, each appointment's day
already on its own `localDate` (`APPOINTMENTS_ZONE` goes;
the store's `throw new Error` on a failed clock dies — the read is total);
focused month as `LocalDate` (`startOfMonth`/`addMonths`); delete the
`calendar-month.ts` shim (the template reads `CalendarCell`); cancel
through the gateway (`BookingCall.Cancel`); the window-closed branch on
`CancellationRefusalCode.WindowClosed`; wording via `wordPipelineError`;
weekday labels via `formatWeekdayLabels`; the view state's `kind` →
`appointmentsViewState` SCREAMING (DOM spelling kept); status words from
the shared `bookingStatusWords` (i18n), the local `STATUS_KEY` deleted
(4A-10); the spec's
`ZonedDateTime.now(…)` cases pinned (`pinnedNowUtcMs`).
`groupAppointmentsByDay` → `VisitListSystem.sections` only if the
sections are byte-equal (else left, §10.4).
**Done when:** typecheck/test/lint `client-appointments`.

### P6 — the staff day · wave 1

**Owns:** `libs/features/staff/dashboard/**`.
**Brief:** gateway calls with `BookingCall.*` builders (wall-clock
`MOVE`/`RESIZE`/`ADD_SEAT`, `amountCents`/`priceCents`, SCREAMING
statuses/reasons); `StaffIntentSystem.intentBasis` over the new command
(operation ids move — pinned spec values re-recorded with a line in §11);
errors on `PipelineError`: the overlap offer on
`StaffEditErrorCode.Overlaps`, the stale reload on
`StaffEditErrorCode.Stale`, `sidesMovedError` a flat
`{ errorCode: BOOKING_STAFF_EDIT_STALE }` wrapped by
`PipelineError.of`; `AppointmentStatusKind` bridges (`WIRE_STATUS`,
`BOOKING_STATUS_OF`) deleted — icons, tones, verbs keyed on
`BookingStatus`, i18n through words tables (4A-10), the transition
refusal's `from`/`to` words: `wordPipelineError(…, extraParams: { from:
bookingStatusWords[serverParams.fromBookingStatus], to:
bookingStatusWords[serverParams.toBookingStatus] })`, the exact bg/en
sentence pinned in `staff-dashboard.spec.ts`; `WIRE_STATUS` and
`REASON_KEY` deleted for the shared `bookingStatusWords` /
`cancellationReasonWords` (4A-10); cancel sheet on
`CancellationReason` + `SeatOutcome.OFFERED_REASONS`; `mayReprice` = `Principal.hasAnyRole(p, MONEY_ROLES)`;
`PhoneSystem.countryCallingCode`/`formatDraft` (null branches; lazily
through a `*.lazy.ts` named re-export where today's import is lazy, §9
R10);
`FLAGS_PORTS`; `CLOCK_PORTS`/`ID_PORTS` and the zone of the shop in
scope (4A-11: the staff day's `ShopLocation`, the visit editor's
location; `STAFF_ZONE` and the editor's `SHOP_ZONE` go; the
`0`/`'1970-01-01'` clock-failure answers die). The private zone engines
of `staff-dashboard.ts` are DELETED, not re-sourced (Law 7: zone math
lives only in `zoned-time.system.ts`; reuse, never copy): `shopInstantIso`
and `shopWallClockUtc` (the two-pass DST guess, `new Date(guess).toISOString()`
— the wall-clock wire needs no ISO), `shopMinuteOfDay`, `shopMinuteAfter`,
`shopClock` — stored `localDate` + `*Minutes` are read directly, an
instant goes through `ZonedTimeSystem.toLocal`, display through
`formatWallClock`/`formatMinute`. `browseClients`' `const now =
Date.now()` (compared with `utcEpochMs`) reads `CLOCK_PORTS.nowUtcMs()`.
The visit editor's VM and form money fields `priceMinorUnits` /
`amountMinorUnits` → `priceCents` / `amountCents` and its discount
`kind: 'fixed_amount' | …` → `discountMethod` SCREAMING (the
`DiscountMethod` dictionary the wire uses; DOM spelling kept) — 4A-13's
one named view-model rename here, which §6 gate 4 enforces; block editor on `RecurrenceRule`/`RecurrenceSystem`/
`LocalDate`/ISO `Weekday`, errors `errors.<SchedulingErrorCode>`,
weekday labels via `formatWeekdayLabels`; `lane-gaps.spec.ts` literals.
**Done when:** typecheck/test/lint `staff-dashboard` (baseline typecheck
reds of this project may stay; none added).

### P7 — client card, admin loyalty, voucher fixtures · wave 1

**Owns:** `libs/features/staff/client-card/**`, `libs/features/admin/loyalty/**`,
`libs/ecs-core/src/testing/fixtures/loyalty/vouchers.json`,
`libs/ecs-core/src/testing/loyalty.fixtures.ts`, `tools/seed/promotions.mjs`
(+ spec), `tools/seed/fixtures/promotions.fixtures.ts`,
`tools/seed/fixtures/README.md`.
**Brief:** the store on `AVATAR_PORTS`, `CLOCK_PORTS` (required; the
`Date.now()` fallback dies), `FLAGS_PORTS`, the zone per 4A-11 (no
location in scope: `ShopZoneService.defaultZone()`; the seven
`'Europe/Sofia'` sites take the zone from the store, the card's existing
loading state covering the resolve); presenters read
`startsAtIso` through `ZonedTimeSystem.parseIsoIn` +
`ZonedTimeSystem.toLocal` (no Luxon); `InMemoryAvatars` → a closure
satisfying `AvatarPorts` (or `memoryAvatarPorts`); `at(iso)` → `utcMs`
with the same instants and ISO text (`ZonedTimeSystem.toIso`, same
offset form); `AchievementScope.kind` → `achievementScope` SCREAMING
(contracts, page state, fixtures, presenters); `client-card.store`'s
`Slice.status` (and the ledger page's) → `cardLoadState: 'LOADING' |
'READY' | 'FAILED'` (4A-13's named list). Admin rhythm on
`CLOCK_PORTS`/`ID_PORTS` (required; `crypto.randomUUID`/`Date.now`
fallbacks die)/`FLAGS_PORTS`/`ShopZoneService.defaultZone()` (the store's
and `admin-rhythm.preview.ts`' zone literals go); `Slice.status` →
`rhythmLoadState: 'LOADING' | 'READY' | 'FAILED'`; README re-pointed.
Vouchers: `vouchers.json` in the flat `GiftVoucher` shape, the card's
local voucher fixture type and the seed's by-POSITION reader deleted.
**Done when:** typecheck/test/lint `staff-client-card`, `admin-loyalty`,
`seed-tools`; the §6 gate's voucher line.

### P8 — design system, showcase, bundle guard · wave 1

**Owns:** `libs/ui/controls/src/lib/phone-field/**`, `libs/ui/icons/**`,
`apps/showcase/**` except `apps/showcase/tsconfig.app.json` (P9),
`tools/verify/bundle/**`.
**Brief:** phone field: lazy `PhoneSystem` (F6) through a component-local
module `phone-field.lazy.ts` (`export { PhoneSystem } from '@core/systems'`)
loaded with `import('./phone-field.lazy')` — a named re-export, never a
dynamic import of the `@core/systems` NAMESPACE, which (with the barrel
already static in `main`) would keep every `export *` alive and put
`phone.system.ts` + `libphonenumber-js` in the initial chunk (§9 R10);
type-only `CountryIso2` (`@core/components`) and `PhoneDraft`
(`@core/systems`, `import type`); the per-locale `CountryNaming`
(`Intl.DisplayNames` + `Intl.Collator`) built and cached per locale in
the component file (the kernel's memo lived inside the kernel); `null`
for the legacy `undefined`s. If Nx's "static imports of lazy-loaded
libraries" boundary check fires on ecs-core, record the exact rule hit to
the integrator (§9 R10) — do not disable it. Icons on `@core/primitives`
`Result`. Showcase on `CountryIso2.of` / `PhoneSystem.parseCountry`.
`check-initial-bundle.mjs` adds `libphonenumber-js` to
`FORBIDDEN_IN_INITIAL`; the bundle spec's synthetic
`libs/domain/kernel/src/lib/result.ts` input becomes an ecs-core path.
**Done when:** typecheck/test/lint of `ui-controls`, `ui-icons`,
`showcase`; `pnpm run verify:bundle` against a web build that ALREADY
contains P2's, P3's, P4's and P6's changes (the eager graph and every
lazy phone importer) — run by the integrator after those merge; red →
§9 R10's contingency, never a relaxed `FORBIDDEN_IN_INITIAL`.

### P9 — the sweep · wave 2 (the integrator, or one agent under it)

**Owns:** `apps/{web,showcase,functions}/tsconfig.app.json`,
`libs/**/tsconfig.{lib,spec}.json` references (via `pnpm nx sync`),
`docs/architecture/HANDOFF.md`, this plan's §8.1/§11,
`docs/architecture/firestore-runbook.md` §4 (a §4.7 "Phase 4a" block = §6,
`WIRE_FILES` emptied, §4.6's rows marked retired).
**Brief:** run `pnpm nx sync` (the 27 referencing tsconfigs — the three
apps' `tsconfig.app.json` AND 24 library `tsconfig.lib.json`/`.spec.json`
whose `"path": "../../../application/…"` references have no `libs/`
segment); run §6 until PASS (dry-running each gate against a known-bad
line first, §6); run the full gate (§8); write the integration record,
incl. 4A-13's by-file list of the deferred view-model unions.

---

## 5. Specs

### 5.1 Deleted (their cases land per §11)

`booking-gateway.adapter.spec.ts` → `pipeline-errors.data.spec.ts`
(`fromWire` rows) and `callable-client.adapter.spec.ts`;
`contact-change.adapter.spec.ts` (all `dead:` D12(b));
`reward-progress-reader.adapter.spec.ts` and
`.integration.spec.ts` (all `dead:` dormant, 4A-14);
`system-clock.adapter.spec.ts` (2), `crypto-id-generator.adapter.spec.ts` (1)
(→ `browser-runtime.adapter.spec.ts` by P0 in wave 0, or `dead:`; P2
only deletes);
`calendar-month.spec.ts` (→ `CalendarGridSystem` spec cases already
covering it, else re-targeted to the page); the class-form cases of
`lazy-port.spec.ts`/`lazy-port.forms.spec.ts` (`dead:` 4A-14); the
`LegacyWireCode` cases of `edge.spec.ts` (→ `legacy-wire-successors.spec.ts`
or `dead:` for the seven unreferenced rows) and its `WIRE_ZONE` pin
(`dead:` 4A-11). Dropped CASES of surviving specs, each with its
reason: `apps/functions/src/adapters/flags.adapter.spec.ts` — the
two-vocabulary pin (`FEATURE_FLAG_KEYS` ↔ `FLAG_PARAMS`) → `dead:` "one
flag vocabulary, `FLAG_NAMES`" (re-pinned as `Object.keys(FLAG_PARAMS)`
== `FLAG_NAMES`); `tools/flags/feature-flags.manifest.spec.mjs` — the case
`feature-flags.data.spec.ts` already proves → `dead:` with that
successor's case name; `firestore-otps.adapter.spec.ts`' `loadOtp` cases,
`auth-claims.adapter.spec.ts`' `setClaims` cases,
`firestore-ports.spec.ts`' `'loadOtp'` member line, `main.spec.ts`'
`'setClaims'` member line, `port-doubles.spec.ts`' `loadOtp`/`setClaims`
cases → `dead:` 4A-14 (no caller), and its `writeOwnProfile` double case →
`dead:` 4A-3 (2); `booking-gateway.adapter.spec.ts`' "nothing usable in a
200" cases → `callable-client.adapter.spec.ts` (answer decoders).

### 5.2 Re-targeted (same intent, new subject)

`otp-client.adapter.spec.ts`, `auth-gateway.adapter.spec.ts`,
`streak-publish-gateway.adapter.spec.ts`,
`session-storage-draft-store.adapter.spec.ts`,
`local-storage-key-value-store.adapter.spec.ts`,
`avatar-uploader.adapter.spec.ts`, `media-reader.adapter.spec.ts`,
`subscribe-with-retry.spec.ts`, `accounts.adapter.spec.ts`/
`.integration.spec.ts` (the `writeOwnProfile` cases → `update-profile.pipeline.spec.ts`
or `dead:` with 4A-3 (2)), `booking-error-message.spec.ts`,
`booking-return-url.spec.ts`, `block-repeat.spec.ts`, `lane-gaps.spec.ts`,
every `*.wire.spec.ts`, `edge.spec.ts`, `main.spec.ts`,
`triggers.wire.spec.ts`, `callable-answer.spec.mjs`, every feature spec
of §2.2 (their doubles move to `@core/testing`, their cases stay), the
rules spec's users/impersonation/invitations cases (allow → deny, plus
the unchanged-read pairs of §1.2). Named, because they sit outside the
feature specs and lose or re-record cases (each with before/after
counts in §11.2): `apps/functions/src/adapters/flags.adapter.spec.ts`,
`apps/functions/src/lib/flags.spec.ts` (`Record<FlagName, …>`),
`apps/functions/src/lib/booking/caller-roles.spec.ts` (the fold, §1.3),
`firestore-otps.adapter.spec.ts`, `auth-claims.adapter.spec.ts`,
`firestore-ports.spec.ts`, `main.spec.ts`,
`libs/ecs-core/src/testing/port-doubles.spec.ts`,
`staff-intent.system.spec.ts` (pinned operation ids re-recorded, R8),
`tools/flags/feature-flags.manifest.spec.mjs`,
`apps/functions/src/integration/publish-streak-definition.integration.spec.ts`
and `project-client-stats.integration.spec.ts` (`WIRE_ZONE` → the seeded
default location, P1), `loyalty.wire.spec.ts` (the `REFUSED` answer),
`libs/ui/icons/src/lib/registry/icon-registry.service.spec.ts`,
`libs/ui/icons/src/lib/logo/logo.spec.ts`,
`libs/ui/controls/src/lib/phone-field/phone-field.spec.ts` (`null` for
the legacy `undefined`s), `lazy-port.spec.ts`/`lazy-port.forms.spec.ts`
(scope cases on the closure), `site-menu.component.spec.ts` (4A-2 (f)),
`session-identity.service.spec.ts` (4A-2 (g)),
`audit.system.spec.ts` and the eight re-typed server pipelines' specs
(zone resolve, 4A-2 (e)).

### 5.3 New (incl. the 4b pre-ledger: cases of legacy specs whose rule moves now)

| New spec                                                                                               | Carries the cases of (legacy, deleted in 4b)                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primitives/ids.primitive.spec.ts` (`ClientOperationId`, `GuestKey`)                                   | `libs/application/booking/.../booking-gateway.port.spec.ts` (guards)                                                                                             |
| `primitives/redirect-path.primitive.spec.ts`                                                           | the legacy `RedirectPath` spec (`libs/application/identity` / `libs/domain/identity`)                                                                            |
| `primitives/pipeline-errors.data.spec.ts` (`fromWire`, `isBlocked`, `serverParams` key set per code)   | `booking-gateway.adapter.spec.ts`, `waitlist-gateway` and `otp-client.adapter.spec.ts` failure rows                                                              |
| `primitives/legacy-wire-successors.spec.ts` (the ledger over the domain dictionaries)                  | `edge.spec.ts` `LegacyWireCode` rows (live ones)                                                                                                                 |
| `primitives/{cancellation,move,staff-edit}-errors.data.spec.ts`                                        | the systems' dictionary cases (moved)                                                                                                                            |
| `systems/avatar.system.spec.ts`                                                                        | `UploadAvatarUseCase` spec + the Storage adapter's guard cases                                                                                                   |
| `systems/audit.system.spec.ts` (+ cases)                                                               | — (4A-16: own-edit row; skip on a changed marker; NO skip on creation, deletion, unchanged marker, a reset to `null`)                                            |
| `systems/shop-zone.system.spec.ts`, `pipelines/resolve-shop-zone.pipeline.spec.ts`                     | `ProgramsSystem.zoneOf`'s cases (kept there too, now over the lifted rule) + 4A-2 (e)                                                                            |
| `components/{edit-command,move-rider,chair-time}.data.spec.ts`, `booking-draft.type-spec.ts`           | the moved dictionaries' / guards' cases; `Disjoint`/`NoNested`/narrowing (4A-9)                                                                                  |
| `libs/infrastructure/i18n/.../booking-status-words.spec.ts`                                            | total over `BookingStatus` / `CancellationReason` (the deleted `STATUS_KEY`/`WIRE_STATUS`/`REASON_KEY` pins)                                                     |
| `libs/infrastructure/firebase-app/.../shop-zone.service.spec.ts`                                       | — (one read per session, cached; failure → `null`)                                                                                                               |
| `pipelines/ensure-session-ready.pipeline.spec.ts`                                                      | `EnsureSessionReadyUseCase` spec                                                                                                                                 |
| `pipelines/register-user.pipeline.spec.ts`                                                             | `RegisterUserUseCase` spec                                                                                                                                       |
| `pipelines/upload-avatar.pipeline.spec.ts`                                                             | `UploadAvatarUseCase` spec                                                                                                                                       |
| `pipelines/start-impersonation.pipeline.spec.ts`, `end-impersonation.pipeline.spec.ts`                 | `libs/application/governance` start/end-impersonation use-case specs (+ end: unauthenticated and non-admin refused with zero reads; ONE `Set` of the ENDED body) |
| `pipelines/redeem-invitation.pipeline.spec.ts`                                                         | — (F3-12's dead invitation cases get a living home)                                                                                                              |
| `pipelines/update-profile.pipeline.spec.ts` (+ cases)                                                  | — (audit row in the transaction, marker, unchanged → nothing)                                                                                                    |
| `components/booking-draft.data.spec.ts`                                                                | the store's `heldSource`/`heldMove`/`isChairTime` cases                                                                                                          |
| `components/*-call.data.spec.ts`                                                                       | the builders and the answer decoders (`AppointmentId.parse` failures → `UNKNOWN`); the wire round-trip with the server decoders lives in `*.wire.spec.ts`        |
| `libs/infrastructure/i18n/.../word-pipeline-error.spec.ts`                                             | `wordError` cases (`booking-gateway.port.spec.ts`)                                                                                                               |
| `wall-clock.spec.ts` (+ `formatWeekdayLabels`)                                                         | `ZonedDateTime.weekdayLabels` cases                                                                                                                              |
| `callable-client.adapter.spec.ts`, `auth-session.adapter.spec.ts` (incl. 4A-2 (b))                     | —                                                                                                                                                                |
| `firestore.rules.integration.spec.ts` (+ the deny cases and the unchanged-read allow/deny pairs, §1.2) | —                                                                                                                                                                |
| `impersonation.integration.spec.ts` (functions, emulator)                                              | — (`purgeAt` = `endedAtUtcMs + 30 d` after end, §1.2)                                                                                                            |
| 4A-2 departure pins                                                                                    | §11.4                                                                                                                                                            |

### 5.4 The case ledger (§11)

Every deleted spec file: each `it(...)` with its successor spec and case
name, or `dead:` with a reason from §0. Every re-targeted spec: case
count before/after; a case it could not keep listed with its reason.
The 4b pre-ledger column (§5.3) is filled too, so 4b's deletion ledger
can cite 4a's successors. Counts are by `grep -c "^\s*it("` at the
`describe`/`it` boundary, never by slicing to the next `it(` (memory:
scripted-edit guardrails).

---

## 6. The grep gate (run after §4.0's preamble of the runbook)

> **Run runbook §4.7, not this block.** The P9 dry run (§8.1 item 2) found
> three defects here — a `gate()` blind to untracked files, a grep error
> read as `ok`, and an `adapter: \(` alternative that can never match under
> `-w`. Runbook §4.7 is this gate with the three fixed, on §4.0's `gate`.
> The block below stays as the plan wrote it.

```bash
cd "$(git rev-parse --show-toplevel)" || exit 1
FAILED=0
gate() { local name="$1"; shift; if git grep -n "$@" >/dev/null; then echo "FAIL $name"; git grep -n "$@" | head -20; FAILED=1; else echo "ok   $name"; fi; }
# NO `\b` anywhere: git 2.45's ERE on macOS never matches it, so a `\b` gate always says ok.
# Word ends are `-w`, or an explicit class `([^A-Za-z0-9_]|$)`; whitespace is `[[:space:]]`.

LEGACY=(':!libs/application/**' ':!libs/domain/**' ':!docs/**' ':!tsconfig.base.json'
        ':!.nxignore' ':!CLAUDE.md' ':!AGENTS.md')
# 1. No legacy import or lazy import anywhere else (code, specs, fixtures, tools, mjs, md).
gate '4a · legacy aliases' -E "@creativo/(application|domain)/" -- "${LEGACY[@]}" \
  ':!firestore.rules'                       # its comments are 4b's docs rewrite (4A-13)
# Library tsconfigs reference the legacy libs RELATIVELY with no `libs/` segment
# ("../../../application/shared/tsconfig.lib.json") — 27 files on e9d1ca4, 3 of them apps.
gate '4a · legacy project references' -E '"path": "(\.\./)+(libs/)?(application|domain)/[a-z-]+/tsconfig' -- \
  'apps/**/tsconfig*.json' 'libs/**/tsconfig*.json' ':!libs/application/**' ':!libs/domain/**'
# 2. No date classes / Luxon / dinero outside the legacy libs (the dinero cross-check is 4b's).
gate '4a · luxon/dinero' -E "from '(luxon|dinero\.js)'" -- "${LEGACY[@]}" \
  ':!libs/ecs-core/src/components/money.data.spec.ts'
gate '4a · ZonedDateTime/CalendarDay/TimeSlot' -wE "ZonedDateTime|CalendarDay|TimeSlot" -- \
  'apps/**/*.ts' 'libs/features/**' 'libs/infrastructure/**' 'libs/ui/**' 'tools/**' \
  ':!**/*.md'
# Stores read time and ids through CLOCK_PORTS / ID_PORTS only (their prose included).
gate '4a · wall clock in stores' -E "Date\.now\(\)|Math\.random\(\)|crypto\.randomUUID\(" -- \
  'libs/features/**/*.store.ts'
# The files P4–P7 rewrite: no device-clock read (`new Date()` with no argument, `Date.now()`)
# outside comments, except 4A-13's named UI-only shapes (nonces, draft/guest ids, photo file
# names; grid-gesture.ts's animation frames). `new Date(ms)` for Intl formatting is not a read.
gate '4a · wall clock in rewritten features' -E -e 'new Date\(\)|Date\.now\(\)' \
  --and --not -e '^[[:space:]]*(\*|//)' \
  --and --not -e 'nonce: Date\.now\(\)|Date\.now\(\)\.toString\(36\)|photo-\$\{Date\.now\(\)\}' -- \
  'libs/features/staff/dashboard/src/**/*.ts' 'libs/features/staff/client-card/src/**/*.ts' \
  'libs/features/admin/loyalty/src/**/*.ts' 'libs/features/client/booking/src/**/*.ts' \
  'libs/features/client/appointments/src/**/*.ts' ':!**/*.spec.ts' ':!**/testing/**' \
  ':!libs/features/staff/dashboard/src/lib/time-grid/grid-gesture.ts'
# The staff day's private zone engines are deleted, not re-sourced (P6, Law 7).
gate '4a · private zone engines' -wE "shopInstantIso|shopWallClockUtc|shopMinuteOfDay|shopMinuteAfter|shopClock" -- \
  libs/features
gate '4a · attempt ids' -E "attemptId: crypto\.randomUUID|attempt_\\$\{Date\.now" -- 'libs/features/**/*.ts'
# 3. Every error dictionary in primitives (Law 7.5). `MoveRefusal`/`MoveRefusalReason`
# (components, the shell's view state, no errorCode) are not dictionaries of this law; the
# system-tier unions `StaffEditGuardRefusal` and `MoveError` stay by name (4A-6).
gate '4a · dictionaries outside primitives' -E "export const [A-Za-z]*(ErrorCode|RefusalCode) = \{" -- \
  'libs/ecs-core/src' ':!libs/ecs-core/src/primitives/**'
gate '4a · moved error structs outside primitives' -wE "export (const|type) (CarriedSeatRefusal|CancellationRefusal|MoveCarriedSeatUnplaceable|StaffEditError|StaffEditInvalidCommand|StaffEditForbidden|StaffEditStale|StaffEditBeforeArrival|StaffEditOverlaps)" -- \
  'libs/ecs-core/src' ':!libs/ecs-core/src/primitives/**'
# 4. The retired wire and legacy tokens.
# `dayKey` is NOT here: it is a stored capacity-entry field and a DOM attribute; the waitlist
# wire's `dayKey` is covered by the waitlist wire spec. The frozen visit view models
# (libs/features/shared/visits) keep their `startIso` fixtures until the shim pass (4A-13).
# The visit editor's VM money fields ARE renamed in 4a (P6), so the editor is NOT excluded.
gate '4a · legacy wire' -wE "LegacyWireCode|LEGACY_WIRE_CODE|LEGACY_WIRE_CODE_BY_CODE|WIRE_FIELD_NAME|WIRE_ZONE|LEGACY_FIELD_OF|FIELD_OF_LOCATOR|wallIso|serverCode|startIso|atIso|endIso|arrivedAtIso|amountMinorUnits|priceMinorUnits|wordError" -- \
  apps/functions/src libs/infrastructure libs/features tools/verify libs/ecs-core/src \
  ':!libs/features/shared/visits/**'
gate '4a · legacy tokens' -wE "AUTH_GATEWAY|OTP_CLIENT|AUTH_DEPLOYMENT|BOOKING_GATEWAY|WAITLIST_GATEWAY|BOOKING_DRAFT_STORE|KEY_VALUE_STORE|ID_GENERATOR|FEATURE_FLAGS|AVATAR_UPLOADER|MEDIA_READER|REWARD_PROGRESS_READER|CONTACT_CHANGE_PORT|provideFeatureFlags|writeOwnProfile|loadOtp|setClaims" -- \
  apps libs/features libs/infrastructure libs/ui libs/ecs-core/src tools ':!**/*.md'
# `CLOCK` alone is a prose word ("THE WALL CLOCK"): gate only its token uses.
gate '4a · legacy CLOCK token' -E "(inject\(|provide: |\{ |, )CLOCK([^A-Za-z0-9_]|$)" -- \
  apps libs/features libs/infrastructure libs/ui tools ':!**/*.md' ':!**/*.css'
gate '4a · legacy principal' -E "kind === 'active'|kind !== 'active'|kind === 'anonymous'|\.uid\.value|roleFromPrimitive|principalHasRole" -- \
  apps libs/features libs/infrastructure
gate '4a · class form' -wE "adapter: \(|LazyAdapterHost|SystemClock|CryptoIdGenerator|FirebaseAuthGateway|CallableOtpClient|CallableBookingGateway|CallableWaitlistGateway|SessionStorageDraftStore|LocalStorageKeyValueStore|FirebaseStorageAvatarUploader|StorageMediaReader|InMemoryAvatars" -- \
  apps libs/infrastructure libs/features
# No class outside Angular, no Error subclass (4A-14). tools/verify's own script classes are out of scope.
gate '4a · non-Angular classes' -E "class (LoadedScope|LazyAdapterScope|LazyPortLoadError)|extends Error" -- \
  apps libs/infrastructure libs/features ':!**/*.md'
# 5. The zone lives on the location only (4A-11, F-4): no zone literal, no tenant-zone name.
gate '4a · zone literals' -F "'Europe/Sofia'" -- 'libs/features/**/*.ts' 'libs/infrastructure/**/*.ts' \
  'apps/web/src/**/*.ts' 'apps/functions/src/**/*.ts' \
  ':!**/*.spec.ts' ':!**/testing/**' \
  ':!libs/features/marketing/landing/src/lib/content/landing-content.ts' \
  ':!libs/features/shared/visits/src/lib/visit-ecs.shim.ts' \
  ':!apps/functions/src/lib/cron-zone.ts'    # the deploy-time cron option, OQ-2
# Product code and its specs; the seed tools' and e2e helpers' own local constants (they build
# the seeded locations) and the shim (4A-13) are out of scope.
gate '4a · tenant zone names' -wE "TENANT_ZONE|TENANT_ZONE_PORTS|TenantZonePorts|tenantTimeZone|WIRE_ZONE|LOYALTY_SHOP_ZONE|APPOINTMENTS_ZONE|STAFF_ZONE" -- \
  apps/functions/src apps/web/src libs/ecs-core/src libs/features libs/infrastructure \
  ':!**/*.md' ':!libs/features/shared/visits/src/lib/visit-ecs.shim.ts'
# 6. Law 9. The lint rule's own doc and spec strings name `Pick<SchedulingPorts, …>` on purpose.
gate '4a · no sliced ports' -E "(Pick|Omit)<[A-Za-z]*Ports([^A-Za-z0-9_]|$)" -- apps libs tools \
  ':!tools/lint-rules/no-sliced-ports.mjs' ':!tools/lint-rules/no-sliced-ports.spec.mjs'
gate '4a · one home for the moved types' -wE "export (type|const) (EditCommandInput|StaffDiscountRequest|AddedSeatSubject|BookSeatRequest|RescheduleSeatRequest|RequestedSubjectInput|RequestedSeatInput|CommitSeatRequest|CommitSubject|CommitSubjectRole|MoveCartSeatInput|MoveSubjectRole|WaitlistAskInput|WaitlistAskDayInput|ProfileEdits|BackfillPageResult|EditCommand|ResizeEdge|RequestedSubjectRole|MoveRider|ChairTime)" -- \
  libs/ecs-core/src/pipelines libs/ecs-core/src/systems
# 7. The nested voucher fixture is gone.
gate '4a · nested vouchers' -wE "balanceMinorUnits|currencyCode|issuedAt" -- libs/ecs-core/src/testing tools/seed
[ "$FAILED" = 0 ] && echo 'phase-4a gate: PASS' || echo 'phase-4a gate: FAIL'
```

**Before freezing (P9):** dry-run EVERY gate against a known-bad line so
each is proved able to FAIL (`git grep --no-index -n <the gate's
arguments> -- <scratch file>` on a scratch file holding e.g.
`{ provide: CLOCK, useValue: c }`, `Pick<SchedulingPorts, 'x'>`,
`export const StaffEditErrorCode = {`, `export type ProfileEdits =`,
`const now = Date.now();`, `class LoadedScope<M> {`, `'Europe/Sofia'`,
`"path": "../../../application/shared/tsconfig.lib.json"`). The plan's
reviser ran this dry run on `e9d1ca4` for the rewritten gates; every one
matched its bad line, and `MoveRefusal` matched none.

Plus, unchanged and still PASS: runbook §4.2, §4.3, §4.4 and §4.5 (§4.5
with the preamble's `STORE`, and now ALSO with §4.4's widened `STORE`,
since the vouchers are flat) — with `WIRE_FILES` emptied, so the
wire-spelling and money-name gates run over the former wire files too;
`pnpm nx run verify-tools:layering --skip-nx-cache`;
`pnpm nx graph --file=…` shows no edge from any non-legacy project into
`libs/application/*` or `libs/domain/*`.

---

## 7. Deletions (files that die with the re-point; the libraries are 4b's)

- `libs/infrastructure/clock/src/lib/{system-clock,crypto-id-generator}.adapter.ts` (+ specs)
- `libs/infrastructure/firebase-auth/src/lib/{auth-gateway,otp-client}.adapter.ts` (→ new factory files; specs re-targeted)
- `libs/infrastructure/firestore/src/lib/{booking-gateway,waitlist-gateway,contact-change,reward-progress-reader}.adapter.ts`
  (+ their specs), `firestore-paths.ts`; the barrel lines in
  `index.ts`/`firestore.adapters.ts`/`firestore.lazy.ts`
- the class bodies of `avatar-uploader.adapter.ts`, `media-reader.adapter.ts`,
  `session-storage-draft-store.adapter.ts`, `local-storage-key-value-store.adapter.ts`
  (each file kept as its factory, or renamed with its spec)
- `libs/features/client/appointments/src/lib/calendar-month.ts` (+ spec)
- the bridge half of `libs/features/staff/dashboard/src/lib/block-editor/block-repeat.ts`
- the class form of `provideLazyPort`, and `lazy-port.ts`' `LoadedScope`,
  `LazyAdapterScope`, `LazyPortLoadError` classes (→ closures, 4A-14)
- `LegacyWireCode`, `LEGACY_WIRE_CODE`, `WIRE_FIELD_NAME`, `WIRE_ZONE` and
  the ISO param rendering in `edge.ts`; `LEGACY_FIELD_OF`
  (`loyalty.wire.ts`) and `FIELD_OF_LOCATOR` (the streak publish adapter)
- `apps/functions/src/lib/booking/tenant-zone.ts` (→ `lib/cron-zone.ts`'s
  `CRON_TIME_ZONE`, the cron options only), `TenantZonePorts`, every
  feature zone constant (4A-11)
- the pipelines' duplicate input types (moved to components), and the
  systems' duplicate seat/subject/waitlist input types and dictionaries
  (`CommitSeatRequest`, `CommitSubject`, `CommitSubjectRole`,
  `RequestedSeatInput`, `MoveCartSeatInput`, `MoveSubjectRole`,
  `RequestedSubjectInput`, `WaitlistAskInput`, `WaitlistAskDayInput`, §3.2)
- the staff day's private zone engines (`shopInstantIso`,
  `shopWallClockUtc`, `shopMinuteOfDay`, `shopMinuteAfter`, `shopClock`)
- the per-feature status/reason words tables (`STATUS_KEY`,
  `WIRE_STATUS`, `REASON_KEY` → i18n, 4A-10)
- `ProfilePorts.writeOwnProfile`, `OtpStorePorts.loadOtp`,
  `AuthAdminPorts.setClaims` with their adapter members and doubles

Deletion rule: a file goes only if nothing imports it after its package
lands AND each of its spec cases has a successor or a `dead:` reason in
§11.

---

## 8. Integration and gates

1. Merge P0; run its done-when. Then merge P1…P8 (any order), each
   against P0 — except that P8's `verify:bundle` runs only after P2, P3,
   P4 and P6 are merged (§4 P8); then P9.
2. The full gate (HANDOFF §4), with ALWAYS `--skip-nx-cache` on
   typecheck:

   ```bash
   pnpm nx sync && pnpm nx sync:check
   pnpm nx run verify-tools:layering --skip-nx-cache
   pnpm nx run-many -t typecheck --skip-nx-cache
   pnpm nx run-many -t lint
   pnpm nx run-many -t test --parallel=3
   pnpm nx test ecs-core --coverage
   pnpm nx typecheck seed-tools
   pnpm nx build web
   pnpm run verify:bundle
   pnpm nx build functions --skip-nx-cache && node tools/verify/p0/check-functions-deps.mjs
   # ONE AT A TIME (shared emulator ports), integrator only:
   pnpm run verify:p0
   pnpm run test:emulator
   pnpm run e2e:web
   ```

   Baseline reds only: typecheck of `patterns`, `staff-client-card`,
   `staff-dashboard` (spec-only; fixing welcome); unit `gauge.spec.ts`
   (4), `visit-pills.spec.ts` (1), `visits-page.presenter.spec.ts` "strikes
   an hour that did not happen" (1); `e2e:web` exactly 19 failed / 41
   passed (6 `*-screenshots`, `landing.spec.ts:120`, 12
   `client-card-glance` at `:343`/`:686`); `appointments.spec.ts:152`
   re-run alone with `--repeat-each=3`.

3. §6's gate PASS; runbook §4.2–§4.5 PASS.
4. **Dev-stack smoke** (`pnpm run dev` after `pnpm run seed:dev`; sign-in
   by custom token for the seed staff `dev-staff-ivan` and a seed
   client, `window.__e2eSignIn`; every check with an empty console):
   1. Profile: a client edits first name and birth date on `/account/profile` →
      `users/{uid}` stores them (search keys re-derived),
      `profileEditedAtUtcMs` set; exactly ONE `auditLog` row,
      `actorRole: 'USER'`, `actorUserId` = the client, fields
      `firstName, birthDate`; restore the name the same way.
   2. The same client's direct `updateDoc(users/{uid}, { firstName })` from
      the console is DENIED (`permission-denied`).
   3. Onboarding personalize save and the booking contact sheet's «save to
      profile» both go through `updateProfile` (network: the callable),
      the row credited to the user.
   4. Too-short name → the same inline refusal copy as today; a forced
      store failure (stop the Firestore emulator mid-call), the network
      offline, and an expired session → each the
      `accounts.update_profile.repository_failure` copy, exactly today's
      (§3.9).
   5. Impersonation: as a seed admin, call `startImpersonation` (console,
      `httpsCallable`) for a seed client → `impersonationSessions/{id}`
      flat ACTIVE body with `purgeAt` = expiry + 30 d; `endImpersonation`
      → `ADMIN_ENDED` with `endedAtUtcMs`, `purgeAt` re-stamped to
      `endedAtUtcMs + 30 d`; a non-admin `startImpersonation` AND a
      non-admin `endImpersonation` of that admin's session id → each
      `GOVERNANCE_IMPERSONATION_FORBIDDEN`, the session untouched; an
      admin's direct `setDoc` → DENIED.
   6. Invitation: seed one invitation (Admin SDK), redeem as another
      client → the redemption doc + `redemptionCount` 1; again →
      `ENGAGEMENT_INVITATION_ALREADY_REDEEMED`; the inviter →
      `ENGAGEMENT_INVITATION_SELF_REDEMPTION`; a direct client create of
      a redemption → DENIED.
   7. Phone field (onboarding, contact sheet, visit editor «Нов клиент»):
      formatting as you type, country list, example placeholder — and the
      network panel shows the phone chunk loaded lazily, not in `main`.
   8. `/book`: a full booking (location → services → schedule → review →
      confirmed), a party of two, reload mid-flow (the draft restores), a
      reschedule via `?reschedule=` with a carried seat, a waitlist ask;
      a slot taken in a second tab → the slot-taken copy and the grid
      refresh; the carried-seat refusal copy.
   9. `/account/appointments`: cancel inside and outside the free window
      → the window-closed copy with its hours/deadline exactly as today.
   10. Staff day: move, resize, add/remove seat, reprice, tip, transition
       (complete, no-show, cancel with a reason), an overlapping move →
       the «Запази въпреки застъпването» offer and its retry, a stale
       edit (two tabs) → the stale reload copy; block editor repeat
       presets and an invalid recurrence copy; a transition refusal shows
       today's «from "…" to "…"» sentence with today's words.
   11. Client card: hero avatar, loyalty wallet, achievements and medal
       pages, ledger — identical to before.
   12. Admin rhythm: publish and withdraw a streak definition, a refused
       publish's copy, its highlighted fields and the too-early day
       (the `REFUSED` answer).
   13. Sign out, the session-expiry path, `/staff` as a client →
       `/forbidden`, `/account` as anonymous → sign-in with `?redirect=`.
   14. Zones (4A-11): with the seeded default location's `timeZone`,
       every "today" (site menu, client card, admin rhythm, appointments,
       booking grid) reads as before; the site menu subtitle appears once
       the zone resolves (4A-2 (f)).

### 8.1 Integration record

**P9 — the sweep, 2026-10-22**, on the wave-1 tree (P0–P8 in the working
tree of `main`, uncommitted, on `e9d1ca4`). Status: **the 4a end condition
holds, the gate is NOT green** — four defects in files P9 does not own
(item 6) block typecheck, test, the web build and the new seed-port gate.
Nothing was committed; the emulator journeys and the §8 step 4 smoke are the
integrator's, after item 6.

1. **Project references.** On the wave-1 tree 27 legacy reference lines
   remained in 9 tsconfigs (the three apps' `tsconfig.app.json`; the
   `tsconfig.lib.json` of admin-loyalty, shared-shell, staff-client-card,
   staff-dashboard, ui-controls; admin-loyalty's `tsconfig.spec.json`) — the
   other library configs had been re-synced by the packages' own runs.
   `pnpm nx sync` rewrote every `tsconfig.app.json`/`tsconfig.lib.json`
   (26 `tsconfig.app.json`/`tsconfig.lib.json` now differ from `e9d1ca4`, each
   the sync's own rewrite; 27 tsconfigs with the spec config below).
   The `@nx/js:typescript-sync` generator does not manage a
   `tsconfig.spec.json`'s references, so the two it left
   (`libs/features/admin/loyalty/tsconfig.spec.json` →
   `application/booking`, `application/shared`, kept since flip 3's spec
   imports) were removed by hand. `nx sync:check`: up to date. The project
   graph has no edge from a non-legacy project into `libs/application/*` or
   `libs/domain/*` (runbook §4.7 gate 8).
2. **§6, dry run.** 45 probes (every gate against a known-bad line; the
   narrowed gates against a known-good line too — `MoveRefusal`,
   `MoveRefusalReason`, `StaffEditGuardRefusal`, `CLOCK_PORTS`,
   `AUTH_DEPLOYMENT_PORTS`, `wordPipelineError`, `new Date(ms)`, a comment, a
   `nonce: Date.now()`). Every gate held but one: the class-form alternative
   `adapter: \(` can never match under `-w`, because the class-form row reads
   `adapter: (m) => …` and the `(` is followed by a word character. The
   gate's own `gate()` had two defects as well: `git grep -n` without
   `--untracked` is blind to every file a package created and nobody has
   added (97 on this tree), and an exit status of 128 (a grep error) read as
   `ok`. Runbook §4.7 is §6 with the three fixed (it runs on §4.0's `gate`);
   §6 above is left as the plan wrote it. 18 more probes prove the corrected
   and added gates of §4.7 (63 in all).
3. **§6 on the tree.** With `--untracked`, §6 failed four gates and every
   hit was a comment or a spec proving an absence: the date classes (3 — two
   provenance comments, the i18n lint config's import-restriction message),
   the legacy wire (10 — provenance and `dead:` notes, and
   `booking.wire.spec.ts`' legacy `amountMinorUnits` payload and its
   «(LEGACY_FIELD_OF deleted)» title), the legacy tokens (15, all comments —
   "successor of the legacy `wordError`", "as the legacy `FEATURE_FLAGS`
   defaulted", the specs' `dead:` notes), the tenant-zone names (1 —
   `main.spec.ts` asserting `tenantTimeZone` ABSENT). Runbook §4.7 skips
   comment lines on those four gates (4A-13: provenance is 4b's sweep; its
   closing `review` lists the 37 comment mentions for it) and excludes the
   three files, one gate each, with the reason beside the exclusion. Three
   of the comment mentions describe a retired member as PRESENT — stale, not
   provenance (item 6 (e)). **Result: §4.7's 22 gates of §6 (its 21, the class-form row
   split in two) and the graph gate `ok`; the added gate "no tenant-zone port bound by the tools" FAILS**
   on `tools/seed-dev-catalog.mjs:688` and `tools/seed/load-domain.spec.mjs:98`
   (item 6 (c)) — §6's gate 5 left the tools out of scope for their zone
   CONSTANTS and with them missed a binding of the deleted PORT.
4. **Runbook §4.2–§4.5 with `WIRE_FILES` emptied.** §4.5 PASS with the
   preamble's `STORE` and with §4.4's widened one (6 gates `ok` each — the
   `@core/testing` vouchers are flat). Emptying `WIRE_FILES` surfaced three
   former wire files naming a retired spelling on purpose, now excluded from
   one gate each with the reason (`booking.wire.spec.ts`,
   `waitlist.wire.spec.ts` — wire-only spellings, they prove the decoders
   read no legacy `amountMinorUnits`/`dayKey`; `edge.spec.ts` — Law 6 status
   keys, its throw-site scanner's comment spells the `HttpsError` status
   argument `'status'`). Then §4.2 27/28, §4.3 21/22, §4.4 16/17 `ok`: each
   FAILS only "Law 9 no bundle record outside ports" on the spec-local
   `type GreeterPorts = {…}`/`CounterPorts`/`DayReadPorts` of
   `lazy-port.spec.ts` and `lazy-port.forms.spec.ts` (item 6 (d)).
5. **The full gate (§8 step 2), once, then each red project alone:**
   - `nx sync` + `sync:check` ok; `verify-tools:layering --skip-nx-cache` ok;
     `run-many -t lint` 61 projects, 0 errors (2 `_userId` warnings).
   - `run-many -t typecheck --skip-nx-cache` (57 projects): red `patterns`
     (baseline) and **`engagement` (new, item 6 (b))**. `staff-client-card`
     and `staff-dashboard` typecheck GREEN — two baseline reds gone.
   - `run-many -t test --parallel=3`: baseline `gauge.spec.ts` (4),
     `visit-pills.spec.ts` (1), `visits-page.presenter.spec.ts` «strikes an
     hour that did not happen» (1); load timeouts in `marketing-landing` (1),
     `staff-client-card` (3), `staff-dashboard` (7) — re-run alone: 23/23,
     989/990 (the baseline case only), 487/487. **New reds:** `engagement`
     (26 cases in 3 legacy specs, item 6 (b)), `seed-tools` (`load-domain.spec.mjs`
     «bundles the projection the trigger runs …»: «ports.loadLocation is
     not a function», item 6 (c)), `web` (its build, item 6 (a)).
   - `nx test ecs-core --coverage`: green (97.85 % statements, 98.81 % lines).
   - `nx typecheck seed-tools`: green.
   - `nx build web`: **RED** (item 6 (a)); `verify:bundle`: blocked by the
     same build — not measured, so R10 (the lazy phone chunk) is still open.
   - `nx build functions --skip-nx-cache` + `check-functions-deps.mjs`:
     green — the dist lists exactly the re-recorded five (`dinero.js`,
     `firebase-admin`, `firebase-functions`, `libphonenumber-js`, `rxjs`);
     `@angular/*` and `luxon` are gone (4A-15).
   - Not run (not P9's): `verify:p0`, `test:emulator`, `e2e:web`, the §8
     step 4 smoke.
6. **Open defects (the integrator's, each in a wave-1 package's files):**
   (a) `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.ts`
   (P3): `phoneCountry = signal<CountryIso2 | undefined>(undefined)` feeds
   `[(country)]` of the phone field, whose model is now
   `model<CountryIso2 | null>(null)` (P8) — make it
   `signal<CountryIso2 | null>(null)` (its two `?? this.defaultCountry`
   reads stay); `web:build` and `web:test` fail on this one template error.
   (b) `libs/application/engagement` (legacy, dead outside the legacy libs):
   `src/testing.ts:70` types `@core/testing`'s `vouchers.json` as the NESTED
   legacy voucher, and P7 flattened that JSON; `gift-voucher-document.spec.ts`
   (15), `client-vouchers-reader.port.spec.ts` (6) and `testing.spec.ts` (5)
   fail. Nothing outside `libs/application/**` imports
   `ClientVouchersReader`, `CLIENT_VOUCHERS_READER`,
   `InMemoryClientVouchersReader` or the legacy `giftVoucherFixtures`
   (the client card reads `@core/testing`'s flat `giftVoucherFixtures()`), so
   the default is to delete that voucher half of the legacy lib ahead of 4b
   (the reader port, its document mapper, the in-memory reader, the fixture
   export and the three specs' voucher cases), each case `dead:` "4b, the
   flat `GiftVoucher` is the fixture" in §11.3 — never a nested copy of the
   JSON. (c) `tools/seed-dev-catalog.mjs:685–690` and
   `tools/seed/load-domain.spec.mjs:95–100` still hand `projectClientStats`
   the deleted `tenantTimeZone`; its ports now end in
   `LocationLoadPorts & DefaultLocationPorts` (4A-11, P1), so **`pnpm run seed:dev` throws on the
   first stats recompute** (and with it `e2e:web` and `verify:p0`): bind
   `defaultLocationId` (`TenantConfig.DEFAULT.defaultLocationId`) and
   `loadLocation` — the functions' `firestoreCatalogPorts` exported through
   `tools/seed/load-domain.mjs`' ENTRY and spread over `db` in the seed; a
   `loadLocation` closure over the book's location in the spec. (d)
   `libs/infrastructure/firebase-app/src/lib/lazy-port.spec.ts` and
   `lazy-port.forms.spec.ts` (P2): rename the spec-local records
   `GreeterPorts` → `Greeter`, `CounterPorts` → `Counter`, `DayReadPorts` →
   `DayRead` (the flip-3 `HeldCatalog` precedent; `Greeter`/`Counter` occur
   there only inside string literals). (e) Stale comments (not provenance):
   `apps/functions/src/adapters/firestore-otps.adapter.ts` (header lists
   `loadOtp`), `libs/ecs-core/src/testing/port-doubles.ts`
   (`memoryOtpStorePorts`' doc lists `loadOtp`),
   `libs/features/client/onboarding/src/lib/services-cap.ts` (names the
   `AUTH_DEPLOYMENT` token — now `AUTH_DEPLOYMENT_PORTS`); and the i18n lint
   config's restriction messages (`libs/infrastructure/i18n/eslint.config.mjs`)
   still advise `ZonedDateTime`/`Money`/`PhoneNumber` — 4b deletes them with
   `luxon`/`dinero.js`, but until then they steer to a banned class. (f) A
   §11.1 case with no successor: `booking-gateway.adapter.spec.ts` «does not
   read a `refusal` riding on some other code as a lost slot» — add a
   `pipeline-errors.data.spec.ts` case (`BOOKING_INVALID_INPUT` with
   `refusal: 'barber_unavailable'` → `PIPELINE_INVALID_REQUEST`).
7. **4A-13's deferred view-model unions, by file** (the grep
   `-nE "(kind|status|state): '"` over `libs/features`, specs out: 260 lines
   in 35 files; specs: 278 lines in 27 files, mostly fixtures of the same
   unions). Each stays a lowercase view-model union until the shim /
   view-model pass:
   - `admin/loyalty` — `admin-rhythm/admin-rhythm.words.ts` (`kind`: estimate | unavailable).
   - `admin/programs` — `admin-programs/admin-programs.ts` (`kind`: course | event | position).
   - `client/account` — `client-account/client-account.ts` (`kind`: loading | error | empty | populated | next).
   - `client/auth` — `client-auth/client-auth.ts` (`kind`: privacy | terms | text).
   - `client/booking` — `schedule-step/booking-schedule-step.ts` (`kind`: served | elsewhere | nowhere); `schedule-step/availability-month.ts` (`state`: plain | outside | unavailable).
   - `client/profile` — `client-profile/client-profile.ts` + `.html` (`kind`: name | birthday).
   - `marketing/careers`, `courses`, `events` — each page's `kind`: loading | ready | error.
   - `marketing/landing` — `content/landing-content.ts` (`kind`: open | closed, single | bundle — the marketing content's own; the location keeps its `timezone` there, §6 gate 5); `pages/home/locations/locations.component.ts` (`kind`: opensAt | closesAt | opensOn).
   - `shared/catalog` — `content/catalog-vm.ts` (`kind`: single).
   - `shared/shell` — `footer/site-footer.component.ts` (`kind`: router | hash | external | tel).
   - `shared/visits` (frozen with the shim, 4A-13) — `visit-row.vm.ts`, `visit-row.presenter.ts` (`kind`: visit | barber | status | badge | amount | waitlist), `visit-card/visit-card.presenter.ts` (`kind`: waitlist), `visit-list/visit-list.ts` (`kind`: more).
   - `staff/client-card` — `client-pages.vm.ts` (`kind`: today | ticket | voucher | stamps | more), `wallet.presenter.ts` (`kind`: voucher | ticket | stamps), `glance.presenter.ts` (`kind`: today | upcoming | last), `ledger.presenter.ts` and `visits-page.presenter.ts` (`kind`: loading | end; the latter's page `status: 'ready'`), `medals.presenter.ts` (`state`: complete …), `client-achievements/achievements-page-state.ts` (`kind`: loading | ready | failed | absent), `client-records/client-records.ts` (`kind`: loading | ready | failed | empty); fixtures `src/testing/client-pages.vm-fixtures.ts` (71) and `client-card.fixtures.ts` (`status: 'open'`). (`client-loyalty/client-loyalty.ts`' `status:` is a CSS size key — no union.)
   - `staff/dashboard` — `visit-editor/staff-visit-editor.ts` (`kind`: visit | save | conflict | cancelled | outsideRoster | name | phone | email | promo | grant | variant | amount | percent — the discount `kind` was flattened to `discountMethod` by P6; these are the editor's page, refusal and row unions), `time-grid/staff-time-grid.ts` (`kind`: visit | move | overlap | short | outside | elapsed), `timeline/staff-timeline.ts` (`kind`: overlap | short | outside), `staff-dashboard/staff-dashboard.ts` (`kind`: booking | block | visit | gap | save; `status: 'new'`), `block-editor/staff-block-editor.ts` (`kind`: block | visit).

**The integration, 2026-10-22** (the integrator, on the P9 tree; nothing
committed by the integrator — the commit and push follow the green gate).

8. **Item 6 fixed.** (a) onboarding's `phoneCountry` is
   `signal<CountryIso2 | null>(null)`; (b) the dead voucher half of
   `libs/application/engagement` is deleted (`src/testing.ts`,
   `testing.spec.ts`, `gift-voucher-document.ts` (+ spec),
   `client-vouchers-reader.port.ts` (+ spec), their two barrel lines) — the
   lib's `engagement` typecheck and tests are green again, every case in
   §11.5; the plan's default, an early slice of 4b's deletion, because no
   nested copy of the flat JSON may exist; `giftVoucherFixtures()` gained its
   `loyalty.fixtures.spec.ts` cases (P7's open item); (c) the seed binds the
   default location: `tools/seed/load-domain.mjs` hands out the server's
   `firestoreCatalogPorts` (server module `catalog`) and `TenantConfig`,
   `seed-dev-catalog.mjs` spreads `seed.firestoreCatalogPorts(db)` with
   `defaultLocationId: TenantConfig.DEFAULT.defaultLocationId` (the shops are
   written first), `load-domain.spec.mjs` binds a `loadLocation` closure over
   a `locationFixture` on the book's zone; (d) the lazy-port specs' records
   are the test handles `Greeter`, `Counter`, `DayRead`; (e) the three stale
   comments are reworded, and `libs/infrastructure/i18n/eslint.config.mjs`
   derives its restrictions from the root's `LAYER_IMPORT_RESTRICTIONS` minus
   the firebase half (as the five infrastructure configs do), so runbook
   §4.7's date-class gate needs no exclusion any more (removed); (f) the
   missing successor is in `pipeline-errors.data.spec.ts`.
9. **The wave-1 open items, resolved by the integrator:**
   - **(a) `PhoneSystem` out of the initial chunk (R10).** The first
     `verify:bundle` FAILED: `libphonenumber-js` (217.9 kB) in `main`. The
     eager reach was not a namespace import but a file-level edge:
     `@creativo/features/client/account-state`'s barrel (eager — the guards,
     the shell, the e2e sign-in hook) re-exports `own-profile.ts`, whose
     module-level `new Set(...)` made esbuild treat it as side-effecting, so
     it was evaluated from `main` together with what its exports use
     (`ProfileEditSystem` → `SearchFieldsSystem` → `PhoneSystem`). Fix, R10
     step (2): `libs/features/client/account-state/src/package.json`
     `{ "sideEffects": false }` (+ its `.nxignore` line), the precedent of
     every `libs/{ecs-core,infrastructure/*}/src/package.json`. `main` went
     from 350.1 kB to 191.8 kB, the initial total from 802.5 kB to 597.5 kB;
     `verify:bundle` PASS — no owner escalation needed (§10.3).
   - **(b) The commit's placement (P1).** The flipped wire sends every key,
     so `onBehalfOfUserId: null` no longer told a client's booking from the
     shop's walk-in; P1's reading (a caller who works the book, every seat a
     guest) made a staff member's guests-only cart from `/book` a staff
     placement with no owner — a departure. `BookingCall` gains
     `placement: Placement` (the appointment's own `SELF`/`STAFF`
     dictionary, reused): `/book` sends `SELF`, the staff day's create sends
     `STAFF`, and `decodeCommitBooking` reads a staff placement iff
     `placement === 'STAFF'` or a client is named (a client naming one is
     refused `BOOKING_COMMIT_FORBIDDEN`, as today). Pinned in
     `booking.wire.spec.ts`, `booking-flow.store.spec.ts`,
     `staff-dashboard.spec.ts`. No departure remains.
   - **(c) 4A-2 (e) on the web (P5, P7).** `ShopZoneService` exposes
     `defaultZoneFailed()` and `retryDefaultZone()` (a resolved zone stays
     cached; a failed read is read again only on a retry). The appointments
     page shows its ERROR state on a failed zone read and its «Опитай пак»
     reads the zone again; the client card folds it into its S7
     (`overview().failed: ['profile']`, the visits page failed) and its
     retry reads the zone again. The site menu keeps 4A-2 (f); the staff
     day reads the catalogue's first shop before the default (P6's folded
     loading state); the admin rhythm's `zoneOf(null)` per load (P7's
     deviation) already meets (e) and is ratified.
   - **(d) Reuse, never copy.** `MoveSystem.cartRiders` replaces the booking
     store's `cartRiderOf` (P4); `BookingCall.clientCancel(appointmentId,
typedReason)` replaces the appointments store's `cancellationReasonOf`
     (P5) — the cancel stays code-only (`CancellationReason`, P0's typing of
     §3.2's `reason`, ratified); the booking rig binds the production
     `sessionStorageBookingDraftPorts` instead of its stand-in (P4); the dead
     `frameShopDay` is deleted (P1; `ShopDayFrame` stays, `frameWallClock`'s
     answer).
   - **(e) Ratified as built.** P1's `shop-zone-read.pipeline.ts` (the
     server pipelines' reading of the zone refusal as
     `RepositoryError.readFailed('locations/<id>')`; folding it into
     `resolveShopZone` would hand the browser a different error than
     `ShopZoneService` words); P0's out-of-ownership edits (the shell specs'
     providers, `site-menu.component.ts`' two principal lines, the
     `tsconfig` reference drops, `availability.ts`' `ChairTime` import);
     P2's index note (nothing is staged); P6's transition sentence keeps
     today's catalogue labels for the two statuses (4A-1 fidelity — the
     `word-pipeline-error.spec.ts` raw-word sentence is the generic helper's
     default, never this surface's); P6's local refusals name the fields
     the server's decoders name (checked against `booking.wire.ts`); the
     stale prose P1 listed (`scheduling-errors.data.ts`,
     `identity-entities.type-spec.ts`, runbook §1.1's `users`,
     `impersonationSessions` and `invitations` rows) rewritten to the 4a
     state.
   - **(f) Recorded, equal outcomes (internal reshapes, no departure):** P2's
     four (a Storage chunk that fails to load is a transient `MediaError`;
     the publish's bare wire status as `RepositoryError.reason`; the draft
     adapter clears a stored value that is no draft; the publish binding
     stays lazy over `GATEWAY_PORTS`); P4's (a) the lapsed-day prune runs
     when the schedule step first knows the shop's today, (b) a `repeat()`
     on a move keeps only the `RESCHEDULE` origin (`BookingDraft` has one;
     a move never sent `bookedFrom`), (c) an attempt id that is no
     `ClientOperationId` is refused locally (`browserIdPorts` mints UUIDs),
     and the shell's `shopZone()` deleted (the flat draft stores no zone; a
     restored draft's lapsed days are settled by the schedule step's chain);
     P5's deadline line on the visit's own shop's zone (4A-11) and its
     lowercase `data-state` through `appointmentsViewStateWords`
     (`LOADING`/`ERROR`/`READY`; the card and rhythm say `FAILED` — two
     view-state dictionaries, each its surface's); P1's wire readings (a
     cancel's `reason` is a `CancellationReason` value; `updateProfile`'s
     `null` keeps a field; `callerKnownRoles` reads claim entries as
     stored; new decoders refuse a non-text id; `TOO_EARLY` answers
     `fields: []`); P8's `UiIconManifestSource` keeps `Error` (no production
     provider; a flat struct is a separate change).
   - **(g) For 4b (no SCREAMING successor yet; 4b keeps these dotted keys
     or adds successors and re-points the constants):**
     `errors.accounts.upload_avatar.upload_failed`,
     `errors.accounts.remove_avatar.remove_failed`,
     `errors.identifier_missing`, `errors.unknown`,
     `errors.repository_failure`, `errors.identity.phone.<reason>`,
     `accounts.update_profile.repository_failure` (`PROFILE_WRITE_FAILED`),
     `booking.gateway.failed` (the review step's fallback),
     `errors.booking.transition.seat_resolved` (the staff day). Their
     readers are what keeps `translateDomainError`'s `{ code }` arm alive
     (4A-5), so 4b re-points them before it deletes the arm:
     `admin-rhythm.ts` (three `{ code: 'repository_failure' }`),
     `client-account.ts` (`repository_failure`), `client-onboarding.ts`
     `phoneError` (`identity.phone.<reason>` with its `example`), and the
     `translateError(code)` of `client-auth.ts` (`unknown` beside the
     server's codes), `client-profile.ts` (`identifier_missing`, the
     `accounts.*` avatar and profile-write constants) and
     `client-onboarding.ts` (`unknown`, the same constants). The dotted
     `booking.staffEdit.forbidden` has no reader left (`admin-rhythm.ts`'s
     forbidden toast reads `StaffEditError.forbidden()`, the same words).
     Also 4b's or
     later: `groupAppointmentsByDay` has no production reader (§10.4: left
     for the visit view-model pass); the 4A-13 unions of item 7; the
     owner's confirmation of §11.4 (a)'s time-sheet re-pin.
10. **The gate (HANDOFF §4), 2026-10-22, on the integrated tree** — green,
    baseline reds only:
    - `nx sync` (28 tsconfigs, the legacy `engagement` lib's included) and
      `nx sync:check` up to date; `verify-tools:layering --skip-nx-cache`
      ok; `run-many -t lint` 61 projects, 0 errors.
    - `run-many -t typecheck --skip-nx-cache` (57 projects + 1): only
      `patterns` red (baseline); `staff-client-card`, `staff-dashboard` and
      `engagement` green.
    - `run-many -t test --parallel=3`: 12,599 passed, 6 failed — the
      baseline (`gauge.spec.ts` 4, `visit-pills.spec.ts` 1,
      `visits-page.presenter.spec.ts` «strikes an hour …» 1); no load
      timeout this run. `nx test ecs-core --coverage`: 271 files, 4,460
      tests, 97.85 % statements, 98.81 % lines. `nx typecheck seed-tools`
      green.
    - `nx build web` green (initial 597.53 kB; the `gauge.css` budget
      warning is the `patterns` baseline's); `verify:bundle` PASS after
      item 9 (a) — the first run FAILED on `libphonenumber-js` in `main`.
    - `nx build functions --skip-nx-cache` + `check-functions-deps.mjs`:
      pass, the five dependencies P1 re-recorded (`dinero.js`,
      `firebase-admin`, `firebase-functions`, `libphonenumber-js`, `rxjs`;
      4A-15 — the set legitimately shrank by `@angular/compiler`,
      `@angular/core`, `luxon`).
    - The grep gates: runbook §4.2 28 `ok`, §4.3 22, §4.4 17, §4.5 PASS (6)
      with both `STORE`s, §4.7 PASS (24); the 4a end condition — `git grep
--untracked -lE "from '@creativo/(application|domain)/|import\('@creativo/(application|domain)/"
-- apps libs tools ':!libs/application/**' ':!libs/domain/**'` —
      prints nothing, and the project graph has no edge from any of the
      other projects into the 17 legacy ones. (§4.1, outside the gate,
      still flags `booking-core.spec.ts` and the 4a wire specs, which §4.2
      and §4.5 exclude with their reasons.)
    - `verify:p0`: all proved, (a)–(f) — (e) now "the owner write denied,
      `updateProfile` one USER row".
    - `test:emulator`: functions 14 files / 65 tests, firestore 12 / 255 —
      green once `verify-otp.integration.spec.ts`, which no package had
      re-pointed, read the flipped wire: «refuses an Auth user whose users
      doc carries another contact — IDENTITY_TOKEN_MINTING_FAILURE on the
      wire, nothing written» (was «… — token_minting_failure …», the legacy
      `{ code }`; same intent, 4A-4).
    - `e2e:web`: 19 failed / 41 passed — exactly the baseline (6
      `*-screenshots`, `landing.spec.ts:121` — the MapLibre case, a line
      lower since P2/P3's edit of that spec —, 12 `client-card-glance` at
      `:343`/`:686`); `appointments.spec.ts:152` passed.
    - **The §8 step 4 smoke** (`pnpm run dev`, Playwright and the client
      SDK from the scratchpad, custom tokens on the seed tenant): 57 checks
      pass, 0 fail — (1) a client's name and birth-date edits on
      `/account/profile` store through `updateProfile` (the page dials it),
      the search keys re-derived, `profileEditedAtUtcMs` stamped, ONE
      `PROFILE_UPDATED` row per save credited `USER`/the client, by field
      name only; (2) the client's direct `updateDoc(users/{uid})` DENIED;
      (4) a too-short name shows today's inline copy with nothing sent, an
      offline save today's `repository_failure` copy; (5) `startImpersonation`
      writes the flat ACTIVE body with `purgeAt` = expiry + 30 d,
      `endImpersonation` → `ENDED`/`ADMIN_ENDED` with `purgeAt` re-stamped
      to `endedAtUtcMs` + 30 d, a client's start and end of that session
      each `GOVERNANCE_IMPERSONATION_FORBIDDEN`, an admin's direct `setDoc`
      DENIED; (6) `redeemInvitation` writes the redemption and count 1,
      again `ENGAGEMENT_INVITATION_ALREADY_REDEEMED`, the inviter
      `ENGAGEMENT_INVITATION_SELF_REDEMPTION`, a direct redemption create
      DENIED; (7) on onboarding's about step the phone field shows the
      example placeholder, formats as typed and lists 245 countries, the
      phone metadata arriving in a lazy chunk only; (10) the staff day
      renders, and its callables as the store builds them: a wall-clock
      MOVE and back with the answered revision, a stale claim
      `BOOKING_STAFF_EDIT_STALE`, a seat RESIZE and back, a minute past
      midnight `BOOKING_STAFF_EDIT_INVALID_COMMAND` on `startMinutes`, the
      retired lone `command` refused on `commands`, a tip in cents and its
      clearing, a `COMPLETED` transition, and a refused one naming
      `fromBookingStatus`/`toBookingStatus` SCREAMING; (12) the admin rhythm
      page opens; (13) `/account` anonymous → `/auth?redirect=%2Faccount`,
      `/staff` as a client → `/forbidden`; (14) the site menu's
      «График» date appears once the zone resolves, `/account/appointments`
      leaves loading on the default shop's zone. Console clean but for the
      flip-4 smoke's known noise (the router's skipped view transition, the
      Storage emulator's 404 for a person with no avatar). Not driven by
      the smoke and covered elsewhere: (3) onboarding's and the contact
      sheet's saves (the same `saveOwnProfile`; their store specs pin the
      call), (4) the expired-session and stopped-store failures
      (`profile.store.spec.ts`), (8) and (9) the `/book` and cancel journeys
      (`booking-core.spec.ts`, `appointments.spec.ts`, both green in
      `e2e:web`), (11) the client card (`client-card-harness.spec.ts` and the
      passing `client-card-glance` cases), (12) a publish/withdraw
      (`publish-streak-definition.integration.spec.ts`,
      `loyalty.wire.spec.ts`), (13) the sign-out and the session expiry
      (`account-dashboard.spec.ts`' sign-out; the session-gone codes of
      `auth-session.adapter.spec.ts` and `ensure-session-ready.pipeline.spec.ts`).
      The seed state was restored (`pnpm run seed:dev`: the client's name,
      birth date and marker, the party visit) and the stack stopped.

---

## 9. Risks

- **R1 — Wire pair skew.** The web and functions must deploy together
  (§1.2); the e2e and `verify:p0` exercise both halves on one build.
- **R2 — Emulator revive.** Storing the ecs struct (`authStage`) instead
  of the token claims (`stage`) would revive every dev session as
  onboarding — P2 stores `AuthClaims.toToken(...)`, pinned.
- **R3 — `active` splits into CLIENT/STAFF.** A literal `=== 'CLIENT'`
  would lock staff out; every check uses `Principal.isActive` or
  `SessionAccessSystem.decide` (§6 gate 4).
- **R4 — The booking store** (1885 lines) is the long pole; its URL and
  DOM contracts stay lowercase (4A-10); the draft's held move must
  restore a reschedule after reload (smoke 8).
- **R5 — The failure table** encodes product behaviour (the overlap
  offer, the stale reload, the carried seat, the policy outage); every
  legacy row is pinned in `pipeline-errors.data.spec.ts` before an
  adapter is deleted.
- **R6 — Role-claim coercion** differs between `callerRoles` (String
  coercion) and `actorOf` (raw array); the fold keeps both readings,
  pinned (§1.3).
- **R7 — Formatting drift.** Every `new Date(ms)`/Luxon label replaced by
  wall-clock formatting must print the same characters in `bg` and `en`
  (flip 4 pinned `formatWallClock` equal to Luxon); each package pins its
  labels.
- **R8 — Operation ids move** with the new staff-edit command shape
  (`StaffIntentSystem.intentBasis` hashes the command); harmless across a
  deploy (no in-flight retries survive it), pinned specs re-recorded with
  a §11 line.
- **R9 — Media guard.** Resolving by path alone would load a malformed
  stored ref; P3 keeps `MediaRef.parse` at the content service.
- **R10 — Lazy phone chunk (F6's premise).** `@core/systems` is already
  STATIC on the eager path (`app.config.ts` `ZonedTimeSystem`,
  `site-menu.component.ts` `NotificationSystem`; `month-picker.ts`; the
  firestore adapters' `PagingSystem`), and `systems/index.ts` re-exports
  `phone.system.ts` with `export *`. A dynamic `import('@core/systems')`
  of that NAMESPACE would materialise every re-export in the chunk that
  already holds the barrel — `phone.system.ts` and `libphonenumber-js`
  in `main` — and P8's new `FORBIDDEN_IN_INITIAL` entry would turn
  `verify:bundle` red. **Contingency, owned by the integrator, in this
  order:** (1) every lazy phone importer (P8's field, P4's contact sheet,
  P6's editor) loads a component-local named re-export
  (`import('./phone-field.lazy')` → `export { PhoneSystem } from
'@core/systems'`), never the namespace — esbuild then places
  `PhoneSystem`'s code by its users, not by the barrel; (2) P2/P3 keep
  the eager graph's `@core/systems` reach minimal: the catalogue's day
  (`shopToday`) moves into the lazy data scope (§2.2 P2), the site menu's
  `NotificationSystem` use moves behind its lazy menu body if the bundle
  report names it, and the month picker and the firestore adapters are
  checked in the bundle report; (3) only then does P8's entry land, its
  `verify:bundle` run on a build holding P2/P3/P4/P6. If it is still red,
  STOP and escalate to the owner — F6 assumed a separate lazy chunk that a
  static barrel in `main` does not allow, and neither a relaxed
  `FORBIDDEN_IN_INITIAL` nor an eighth alias (Law 8) is an allowed fix.
  If Nx's lazy-load boundary rule fires instead, §10.3's default applies.
- **R11 — Rules before web.** Deploying the rules first would break the
  old web's profile write; the deploy order is functions+hosting, then
  rules (§1.2).
- **R12 — Test beds that relied on optional injection** (`CLOCK`/
  `ID_GENERATOR`/`FEATURE_FLAGS` optional with fallbacks) must bind the
  ports; spec counts may shift — the ledger records each.
- **R13 — Zone reads replace a constant** (4A-11). Every "today" now
  waits on one location read; a store that rendered "today"
  synchronously must fold the resolve into its existing loading state
  (never a new visible state, except the site menu subtitle, 4A-2 (f)),
  and feature test beds must bind `LOCATION_LOAD_PORTS` /
  `DEFAULT_LOCATION_PORTS` with a fixture location on `FIXTURE_TIME_ZONE`.
  The server adds one `locations/{id}` read per location-less invocation
  (cron, triggers) — negligible beside each pipeline's own reads.
- **R14 — Leaking server fields.** Sending the struct verbatim would put
  person keys, violation lists and repository causes on every client;
  the per-code allowlist (4A-4) is pinned per code in `edge.spec.ts`
  before any `toHttpsError` change lands.

---

## 10. Open questions (owner) — with the default this plan applies

1. **`rxjs` in the functions dist** (4A-2 (d), 4A-15). Default: accept and
   record it in the baseline; a follow-up may replace the ports' `Observable`
   with a structural stream type and move the runtime uses out of the
   functions closure.
2. **Impersonation and invitation callables with no web caller.**
   Default: build them now (the blueprint pairs each tightening with its
   callable; their legacy use-case specs need a living successor before
   4b), server-only; no web surface until a feature asks.
3. **If Nx's lazy-load boundary rule refuses the lazy phone import, or
   `verify:bundle` stays red after R10's contingency.** Default for the
   Nx rule: keep the dynamic import of the component-local re-export
   (F6), and scope an eslint exemption for exactly the phone importers'
   `*.lazy.ts` files with a comment citing F6 — never an eighth alias
   (Law 8). For a red bundle after the contingency: no default — the
   owner rules (F6's premise does not hold with a static `@core/systems`
   in `main`).
4. **`groupAppointmentsByDay` → `VisitListSystem.sections`.** Default:
   only when byte-equal; otherwise left for the visit view-model pass.
5. **The tenant zone** (4A-11). DECIDED by flatten-spec F-4 (locked),
   not open: the zone lives only on the location; location-less
   boundaries read the default location's `timeZone`; no web or server
   tenant-zone constant or port survives. Only OQ-2's cron-trigger zone
   stays open (`CRON_TIME_ZONE`, a deploy-time option) and the production
   `defaultLocationId`.
6. **`PipelineError.serverParams` — an open-keyed record inside a
   primitives struct** (Law 7.5 asks for flat structs). Default: keep it,
   for interpolation only, its key set per code bounded to the code's
   `EDGE_WIRE` allowlist and pinned per code in
   `pipeline-errors.data.spec.ts`. The alternative the owner may pick: a
   typed `serverError` field holding the decoded primitives struct (a
   `WireError` union in primitives that `edge.ts`' `EdgeError` re-points
   to), `wordPipelineError` reading that struct's scalar fields per
   `errorCode`.

---

## 11. The case ledgers (§5.4)

Counted on the P9 tree (2026-10-22) against `e9d1ca4`. Case titles are read
at the `it(` / `it.each(…)(` boundary (an `it.each` is one case title);
the `it(` column of 11.2 is the plan's `grep -c "^\s*it("`. «…» quotes a
case title; "same" means the successor spec holds the identical title.

### 11.1 Deleted specs — 14 files, 93 cases

- `libs/features/client/appointments/src/lib/calendar-month.spec.ts` (2) →
  `libs/ecs-core/src/systems/calendar-grid.system.spec.ts`, both same:
  «builds a Monday-first grid padded to whole weeks, anchored on the given
  month», «marks the cell matching `today` and counts appointments per day».
- `libs/infrastructure/clock/src/lib/crypto-id-generator.adapter.spec.ts` (1)
  → `browser-runtime.adapter.spec.ts` «draws a fresh v4 UUID on every call»
  (+ «draws ids the wire takes as client operation ids (4A-12)»).
- `libs/infrastructure/clock/src/lib/system-clock.adapter.spec.ts` (2) →
  `browser-runtime.adapter.spec.ts`: «resolves the current instant for a
  valid zone» → «resolves the current instant on a valid zone’s wall
  clock»; «fails for an invalid zone» → «refuses an invalid zone before any
  clock reading is placed on it».
- `libs/infrastructure/firebase-auth/src/lib/auth-gateway.adapter.spec.ts`
  (15) → `auth-session.adapter.spec.ts`: eleven same («emits the anonymous
  principal when there is no user», «emits an onboarding principal when
  claims have not flipped to active yet», «forces a token refresh for the
  current user», «brings the session back when the SDK reports nobody …»,
  «never revives a session that was ended on purpose», «returns null when no
  user is signed in», «derives a phone identifier …», «derives an email
  identifier …», «returns null for a user record carrying neither channel»,
  «signs out successfully», sign-out's «surfaces a failure when the SDK call
  throws»); «emits an active principal with roles for a token with active
  claims» → «emits an active CLIENT principal with roles and tenant …» + «emits
  a STAFF principal for a token holding a staff role» (R3); refresh's «fails
  when there is no signed-in user» → «fails, retryable, when there is no
  signed-in user — no session gone, nothing to sign out»; refresh's «surfaces
  a failure when the SDK call throws» → «surfaces a network failure as
  retryable, never minting a token in production»; «signs the remembered
  session back in … carrying its uid and claims» → «… carrying its uid and
  the TOKEN’s claims (the `stage` key)» (R2).
- `libs/infrastructure/firebase-auth/src/lib/otp-client.adapter.spec.ts` (5)
  → `otp-challenge.adapter.spec.ts`: «requestChallenge returns the branded
  challenge id from the callable» → «requestOtpChallenge dials
  requestOtpChallenge with the identity call, answering the branded challenge
  id»; «requestChallenge fails when the callable throws» → «requestOtpChallenge
  answers the callable’s failure as it is classified»; «verifyChallenge signs
  in with the returned custom token and never leaks it» and «verifyChallenge
  fails when sign-in with the custom token throws» → the same titles on
  `verifyOtpChallenge`; «completeRegistration forwards …» same.
- `libs/infrastructure/firestore/src/lib/booking-gateway.adapter.spec.ts`
  (13): «forwards the rebooking edge to commitBooking», «carries the edge
  beside a staff placement», «adds no edge to a cold booking» →
  `callable-client.adapter.spec.ts` «sends the call component as it is — the
  rebooking edge and a staff placement included» (the cold call carries
  `bookedFromAppointmentId: null`, `booking-flow.store.spec.ts` «sends `null`
  for the edge on a cold booking»); «reports a response without an id as
  unknown, never as a booking» → `booking-call.data.spec.ts` «answers nothing
  usable in a 200 as PIPELINE_UNKNOWN …» + `callable-client.adapter.spec.ts`
  «reports %s as PIPELINE_UNKNOWN, never as a booking»; «reads a lost race as
  slot_unavailable, keeping the server code» → `pipeline-errors.data.spec.ts`
  «%s → %s (%s) → %s» (row `booking.commit.slot_unavailable`) + «carries the
  server code and its reason as i18n parameters, off the wire»; «sends the
  move under its attempt id, so a retry can fill its audit rows» →
  `callable-client.adapter.spec.ts` «sends the call component as it is …»
  (the attempt id is the call's field) + `reschedule-appointment.pipeline.spec.ts`
  «refuses a known name with another batch (attemptId)» + `ids.primitive.spec.ts`
  (`ClientOperationId`); «reads a carried seat whose barber got taken as a
  LOST SLOT …» and «keeps every OTHER carried-seat refusal a request refusal
  on review …» → `pipeline-errors.data.spec.ts` «answers a carried seat whose
  barber is busy like any lost slot — re-pick from a fresh grid (R2-5)» (its
  `shop_only` half); «reads unreadable cancellation terms as UNAVAILABLE …»
  and «keeps a closed window a request refusal …» → «%s → %s (%s) → %s» (rows
  `booking.cancel.policy_unavailable`, `booking.cancel.window_closed`) + «pins
  the window-closed copy’s one figure and drops its deadline»; «sends the
  intent under its operation id and hands back the revision» →
  `callable-client.adapter.spec.ts` «answers the decoded, branded answer» +
  `booking-call.data.spec.ts` «decodes the arrival, the tip and the staff edit
  with their flags and figures»; «sends the claim on the wire and hands back a
  stale refusal the sheet can act on» → «%s → %s (%s) → %s» (row
  `booking.staffEdit.stale`) + `callable-client.adapter.spec.ts` «classifies a
  FunctionsError with PipelineError.fromWire, keeping the server’s code and
  context»; «does not read a `refusal` riding on some other code as a lost
  slot» → `pipeline-errors.data.spec.ts`, same (added at integration, §8.1
  item 6 (f)).
- `libs/infrastructure/firestore/src/lib/contact-change.adapter.spec.ts` (3):
  «requestChange calls the requestContactChange callable and returns its id»,
  «confirmChange calls the confirmContactChange callable», «maps a callable
  rejection to a failed Result» — `dead:` D12(b) (contact change is not
  shipped; its adapter goes).
- `libs/infrastructure/firestore/src/lib/reward-progress-reader.adapter.spec.ts`
  (3) and `.integration.spec.ts` (3): «emits ok(null) when the enrollment doc
  does not exist», «emits ok(RewardProgress) reconstituted from a well-formed
  doc», «emits a fail Result when the doc is malformed», «emits ok(null) when
  the user has no enrollment yet», «lets the owner observe their own reward
  progress», «denies a different user reading someone else’s reward
  progress» — `dead:` 4A-14 (the dormant reader had no injection site).
- `libs/infrastructure/firestore/src/lib/streak-publish-gateway.adapter.spec.ts`
  (20) → `streak-publish.adapter.spec.ts`: nine same («answers with what the
  SERVER wrote …», «drops the session’s copy of the catalogue once the rule is
  written», «reads the SDK’s own «%s» as the caller not being the admin
  pair», «tells %s apart from a refusal: the request got no answer», «never
  reports a publish on %s: it is no answer at all», «names the version it
  calls off», «drops the session’s copy … once the version is called off»,
  «never reports a withdrawal on an answer for %s», «tells a request that got
  no answer apart from a refusal»); «sends the rule as the callable’s request: the
  draft is the rule’s own nested body» → «sends the publish call as the flat
  call component it is»; «hands over the server’s refusal «%s» as its flat
  struct, never dropping the copy» → «hands over the server’s answered
  refusal %s as its flat struct, never dropping the copy»; «reads an
  «invalid» refusal’s legacy locators as the flat fields, in the order named»
  → «reads an INVALID refusal’s flat fields as named, in order …»; «reads
  «tooEarly» by its word …» → «reads TOO_EARLY with the first day the server
  names»; «reads a «tooEarly» that names no day …» → «reads a TOO_EARLY that
  names no day as the day the publish asked for»; «reads a refusal that names
  no field» → «reads a refusal that names no head version as the version the
  call named»; «hands over «stale» when the version no longer waits» →
  «hands over STALE …»; «carries no id and no name in the draft: they are the
  head’s» → `streak-publish-call.data.spec.ts` «carries the rule as proposed
  beside the head it was drafted against». `dead:` 4A-4 (the nested draft and
  its legacy mapper are the retired wire): «encodes the recommended rule
  exactly as the legacy draft mapper did, key order included», «encodes every
  variant and word as the legacy draft mapper did»; «reads a refusal that
  arrived thrown (%s)» (the flipped wire ANSWERS every publish refusal but
  `CALLER_UNAUTHENTICATED`, which «reads the SDK’s own «%s» …» covers; a
  thrown `TOO_EARLY` is no wire shape any more).
- `libs/infrastructure/storage/src/lib/avatar-uploader.adapter.spec.ts` (7) →
  `avatar.adapter.spec.ts`, three same («removes the avatar object», «treats
  removing a non-existent avatar as success …», «surfaces a real storage
  failure on remove»); «uploads an image blob and returns its url/path» →
  «uploads an image blob to the person’s one object and answers its path and
  url» + `upload-avatar.pipeline.spec.ts` «uploads a within-limit image»;
  «rejects a non-image content type before touching Storage» →
  `avatar.system.spec.ts` «refuses a non-image content type before its size» +
  `upload-avatar.pipeline.spec.ts` «refuses a non-image without uploading»;
  «rejects a blob over the 5 MiB limit before touching Storage» →
  `avatar.system.spec.ts` «refuses a blob over the 5 MiB limit, naming the
  limit» + «refuses a blob over the size limit without uploading»; «maps a
  Storage failure into a fail Result» → «answers Storage’s own refusal as
  MEDIA_FORBIDDEN» + «maps any other Storage failure to a transient
  MediaError».
- `libs/infrastructure/storage/src/lib/media-reader.adapter.spec.ts` (3) →
  `media-resolve.adapter.spec.ts`: «resolves a single variant at the ref’s
  native width» → «resolves a single rendition at the ref’s native width, by
  its path»; «maps %s to the permanent MediaUnavailableError (%s)» → «maps %s
  to the permanent MediaError — the placeholder, never asked again»; «keeps %s
  transient: a RepositoryError, never permanent» → «keeps %s transient: worth
  a bounded retry».
- `libs/infrastructure/web-storage/src/lib/local-storage-key-value-store.adapter.spec.ts`
  (6) → `local-storage-key-value.adapter.spec.ts`: four same («returns null for
  a key that was never set», «removes a value», «wraps a thrown getItem error
  in a failed Result», «wraps a thrown removeItem error in a failed Result»);
  «wraps a thrown setItem error (e.g. quota exceeded) in a failed Result» →
  «… in a failed Result naming the key»; «round-trips a value through
  set/get» → «… — in localStorage, across sessions».
- `libs/infrastructure/web-storage/src/lib/session-storage-draft-store.adapter.spec.ts`
  (10) → `session-storage-booking-draft.adapter.spec.ts`: four same («returns
  null when nothing has been saved yet», «preserves both monotonic counters
  …», «round-trips an ANONYMOUS draft …», «clears the stored draft»); «accepts
  every step the FLOW can be on — including the first» → «accepts every step
  on the spine the flow can be saved on — including the first»; «round-trips
  a full draft through save/load» → «round-trips a whole draft through
  save/load — the flow, the contact, the day, the origin»; «surfaces corrupted
  JSON …», «surfaces a malformed stored shape …», «rejects an unknown step …»
  → the rows of «surfaces %s as a failed Result and clears it — the flow
  starts fresh»; «treats a draft from an older schema as absent, not as an
  error» → «never reads the pre-flatten key: a draft there is absent, not an
  error» (4A-9).

Also dropped inside surviving specs (§5.1's named cases): the class-form
cases of `lazy-port.spec.ts` / `lazy-port.forms.spec.ts`, the `LegacyWireCode`
rows of `edge.spec.ts` (→ `legacy-wire-successors.spec.ts`, the seven
unreferenced rows `dead:` there) and its `WIRE_ZONE` pin, the `loadOtp` /
`setClaims` / `writeOwnProfile` cases — each in 11.2's row of its spec.

### 11.2 Re-targeted specs — before → after

149 spec files changed against `e9d1ca4`; 81 keep every case title and
every count (re-pointed imports, doubles from `@core/testing`, renamed
fields). The 68 below changed a count or a title.

| Spec                                                                                        | `it(` lines | `it.each` | titles −gone / +new | Cases not kept, renames                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------- | --------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/functions/src/adapters/auth-claims.adapter.spec.ts`                                   | 16 → 14     | 0         | −2 / +0             | not kept: «sets custom claims for an already-signed-in user — the active claims with roles», «leaves out a tenant the claims do not carry» — `dead:` 4A-14 (`setClaims` had no caller)                                                                                                                                                                                                                                                                                                                                                       |
| `apps/functions/src/adapters/firestore-catalog.adapter.spec.ts`                             | 7 → 10      | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/functions/src/adapters/firestore-otps.adapter.spec.ts`                                | 6 → 5       | 0         | −2 / +1             | «saves and reads back an OTP …» → «saves an OTP — the flat body, plus purgeAt …» (the read-back half `dead:` 4A-14); not kept: «returns null for a missing OTP» — `dead:` 4A-14 (`loadOtp` had no caller)                                                                                                                                                                                                                                                                                                                                    |
| `apps/functions/src/adapters/firestore-ttl.adapter.spec.ts`                                 | 9 → 10      | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/functions/src/adapters/flags.adapter.spec.ts`                                         | 3 → 3       | 0         | −1 / +1             | «speaks the manifest’s one vocabulary …» `dead:` one flag vocabulary (`FLAG_NAMES`), re-pinned as «keys one param per flag of the one vocabulary — `Object.keys(FLAG_PARAMS)` is `FLAG_NAMES`»                                                                                                                                                                                                                                                                                                                                               |
| `apps/functions/src/edge.spec.ts`                                                           | 38 → 38     | 0→1       | −21 / +22           | re-titled onto the projected struct (4A-4); the ISO-rendering cases («spells every `*Iso` param …», «a local-coordinate param renders the same shop-clock ISO …») and «keys the table by errorCode and leaves as the LEGACY wire code» `dead:` 4A-4 (the rendering is deleted; successor «%s leaves as its errorCode and its listed fields alone»); the `LegacyWireCode` rows → `legacy-wire-successors.spec.ts`; the `WIRE_ZONE` pin `dead:` 4A-11; departure (c) pinned by «speaks the flipped vocabulary …»                               |
| `apps/functions/src/lib/booking/caller-roles.spec.ts`                                       | 10 → 19     | 3         | −0 / +9             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/functions/src/main.spec.ts`                                                           | 18 → 19     | 3         | −6 / +7             | re-titled onto the call components; 30 → 33 exports (4A-3's three callables); the `'setClaims'` member line `dead:` 4A-14                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/functions/src/wire/booking.wire.spec.ts`                                              | 26 → 28     | 1         | −18 / +20           | 18 re-titled onto the call components (4A-4); the three `LEGACY_FIELD_OF` cases («answers the seat start … as startIso», «answers a resize handle as atIso …», «leaves every other field as the refusal names it») fold into «leaves every field — a start, a handle, the stored lifecycle — as the struct holds it, never renamed»                                                                                                                                                                                                          |
| `apps/functions/src/wire/identity.wire.spec.ts`                                             | 29 → 29     | 1         | −22 / +22           | 22 re-titled one for one onto the call components and SCREAMING codes (4A-4); none lost                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/functions/src/wire/loyalty.wire.spec.ts`                                              | 37 → 36     | 14→13     | −27 / +25           | re-titled onto the flat call component (4A-4); not kept: «throws a caller without a session on its NEW dotted code only inside the edge — the wire answers today’s» (`dead:` 4A-4, no second code), «publishes %s as %s» and «withdraws by the version called off» (the lowercase answer encoders are retired, 4A-4 — successor `streak-publish-call.data.spec.ts` «encodes and decodes a published receipt and a withdrawal»)                                                                                                               |
| `apps/functions/src/wire/ops.wire.spec.ts`                                                  | 9 → 9       | 1         | −7 / +7             | 7 re-titled (SCREAMING job name, `runStartedAtUtcMs`, the projected refusals); none lost                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/functions/src/wire/triggers.wire.spec.ts`                                             | 22 → 23     | 2         | −2 / +3             | «… the tenant’s zone beside them» re-titled without the zone (4A-11); «logs a survived failure as today’s ONE line …» → departure (c)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/functions/src/wire/waitlist.wire.spec.ts`                                             | 11 → 12     | 1         | −8 / +9             | re-titled onto the call component; the tenant zone left the command (4A-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `libs/ecs-core/src/components/role.rules-parity.spec.ts`                                    | 9 → 10      | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/components/streak-publish-call.data.spec.ts`                             | 4 → 8       | 0         | −0 / +4             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/audit-profile-change.pipeline.spec.ts`                         | 8 → 10      | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/book-appointment.pipeline.spec.ts`                             | 17 → 21     | 0         | −0 / +4             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/continue-policy-recompute.pipeline.spec.ts`                    | 14 → 15     | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/edit-appointment.pipeline.spec.ts`                             | 15 → 16     | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/match-waitlist.pipeline.spec.ts`                               | 18 → 19     | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/project-client-stats.pipeline.spec.ts`                         | 9 → 10      | 1         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/publish-streak-definition.pipeline.spec.ts`                    | 37 → 38     | 2         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/rebuild-busy.pipeline.spec.ts`                                 | 7 → 9       | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.spec.ts`                             | 10 → 12     | 0         | −1 / +3             | «returns a past day before any read …» → «… before any read but the zone’s …» (4A-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `libs/ecs-core/src/pipelines/request-waitlist.pipeline.spec.ts`                             | 10 → 12     | 2         | −1 / +3             | «records a request for any shop — none named, none read» → «… on the default location’s clock (F-4)»                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/ecs-core/src/pipelines/reschedule-appointment.pipeline.spec.ts`                       | 18 → 19     | 1         | −1 / +2             | «… (startUtcMs) …» → «… (startMinutes) …» (4A-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `libs/ecs-core/src/pipelines/run-backfill.pipeline.spec.ts`                                 | 19 → 21     | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/sample-lead-time.pipeline.spec.ts`                             | 9 → 10      | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/pipelines/update-profile.pipeline.spec.ts`                               | 7 → 8       | 0         | −1 / +2             | the Update case re-titled with the marker and the row (4A-16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `libs/ecs-core/src/primitives/catalog-errors.data.spec.ts`                                  | 4 → 4       | 0         | −1 / +1             | 25 → 26 codes (the zone refusal, 4A-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `libs/ecs-core/src/primitives/ids.primitive.spec.ts`                                        | 13 → 17     | 1         | −0 / +4             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/primitives/pipeline-errors.data.spec.ts`                                 | 4 → 17      | 0→2       | −1 / +16            | «carries the server wire code …» re-titled; + the `fromWire` table (§5.3); + the §11.1 gap (§11.5) and `isPipelineError` (§11.7 (4))                                                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/ecs-core/src/systems/audit.system.spec.ts`                                            | 37 → 45     | 0         | −0 / +8             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/ecs-core/src/testing/port-doubles.spec.ts`                                            | 60 → 69     | 0         | −2 / +11            | not kept: «writes the five keys the decide answers, IN PLACE …» — `dead:` 4A-3 (2) (`writeOwnProfile`); «records minted claims, claims set and display names» → «records minted claims and display names» (`setClaims` `dead:` 4A-14); the `loadOtp` reads `dead:` 4A-14                                                                                                                                                                                                                                                                     |
| `libs/features/admin/loyalty/src/lib/admin-rhythm.store.spec.ts`                            | 113 → 114   | 4         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/admin/loyalty/src/lib/admin-rhythm/admin-rhythm.spec.ts`                     | 27 → 28     | 0         | −0 / +1             | added: «toasts the not-allowed words, without «Отмени», when the server refuses a caller who is no admin» (§11.7 (3): the toast reads `StaffEditError.forbidden()`)                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/client/account-state/src/lib/account-state.service.spec.ts`                  | 12 → 13     | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/client/appointments/src/lib/appointments.store.spec.ts`                      | 7 → 9       | 0         | −2 / +4             | the two `cancel()` cases re-titled onto the call and the SCREAMING reason (`OTHER`/`UNSPECIFIED`)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `libs/features/client/appointments/src/lib/client-appointments/client-appointments.spec.ts` | 44 → 44     | 0         | −1 / +1             | re-titled (`OTHER`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/client/auth/src/lib/auth-flow.store.spec.ts`                                 | 10 → 15     | 0         | −0 / +5             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/client/booking/src/lib/booking-flow.store.spec.ts`                           | 65 → 71     | 1         | −10 / +16           | five guest-label cases left as COPIES of `guest-label.system.spec.ts` / `booking-cart.system.spec.ts` (same titles there — reuse, never copy); «never restores a move written before its chairs were stored» lives in `booking-draft.data.spec.ts`; the rest re-titled (wall clock, `CONFIRMED`, the `null` edge)                                                                                                                                                                                                                            |
| `libs/features/client/booking/src/lib/client-booking/client-booking.spec.ts`                | 41 → 45     | 1         | −0 / +4             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/client/booking/src/lib/contact-sheet/booking-contact-sheet.spec.ts`          | 14 → 17     | 0         | −1 / +4             | «writes the typed name with the STORED phone …» → «sends the profile the typed NAME alone …» (4A-3 (2))                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `libs/features/client/booking/src/lib/review-step/booking-error-message.spec.ts`            | 17 → 18     | 0         | −4 / +5             | re-titled onto `wordPipelineError` (the surface’s own fallback copy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/features/client/booking/src/lib/review-step/booking-review-step.spec.ts`              | 9 → 11      | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/client/booking/src/lib/schedule-step/day-availability.spec.ts`               | 24 → 25     | 1         | −2 / +3             | the chair cases re-titled onto the day’s minutes (`ChairTime` moved to components, 4A-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `libs/features/client/booking/src/lib/schedule-step/time-sheet/booking-time-sheet.spec.ts`  | 3 → 3       | 0         | −2 / +2             | «refuses a minute the spring-forward gap erased …» → «keeps a spring-forward minute as the wall clock says it — the commit’s pipeline is what refuses it» (4A-2 (a), §11.4)                                                                                                                                                                                                                                                                                                                                                                  |
| `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.spec.ts`       | 19 → 19     | 1         | −3 / +3             | re-titled onto `registerUser` / `updateProfile` (4A-3 (2), 4A-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `libs/features/client/onboarding/src/lib/onboarding-flow.store.spec.ts`                     | 9 → 10      | 0         | −2 / +3             | re-titled onto `updateProfile` (4A-3 (2))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `libs/features/client/profile/src/lib/client-profile/client-profile.spec.ts`                | 15 → 15     | 0         | −1 / +1             | re-titled onto `updateProfile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `libs/features/client/profile/src/lib/profile.store.spec.ts`                                | 12 → 12     | 0         | −6 / +6             | six re-titled onto `updateProfile` and its failure wording (4A-3 (2))                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `libs/features/shared/shell/src/lib/identity/session-identity.service.spec.ts`              | 9 → 12      | 1         | −1 / +4             | «ignores a claim outside the vocabulary …» → «grants nothing for a claim outside the vocabulary — the token degrades to onboarding» (4A-2 (b)); the identifier-label cases added, the phone one pinning 4A-2 (g)                                                                                                                                                                                                                                                                                                                             |
| `libs/features/shared/shell/src/lib/menu/site-menu.component.spec.ts`                       | 30 → 32     | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/staff/client-card/src/lib/client-card.store.spec.ts`                         | 56 → 58     | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/staff/dashboard/src/lib/block-editor/block-repeat.spec.ts`                   | 8 → 10      | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts`             | 144 → 147   | 0         | −1 / +4             | «… then as the gateway» → «… then as the surface»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `libs/infrastructure/clock/src/lib/browser-runtime.adapter.spec.ts`                         | 4 → 8       | 0         | −0 / +4             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/infrastructure/firebase-app/src/lib/lazy-port.forms.spec.ts`                          | 22 → 22     | 0         | −4 / +4             | the class-form halves `dead:` 4A-14; four re-titled onto the factory rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `libs/infrastructure/firebase-app/src/lib/lazy-port.spec.ts`                                | 25 → 25     | 0         | −11 / +11           | re-titled onto the closure scope; «an adapter constructor that throws …» and «retries an adapter creation that threw too …» `dead:` 4A-14 (no class form); + the `LazyPortLoadError` telemetry case (4A-14)                                                                                                                                                                                                                                                                                                                                  |
| `libs/infrastructure/firestore/src/lib/accounts.adapter.integration.spec.ts`                | 9 → 5       | 0         | −5 / +1             | «round-trips an owner name edit through writeOwnProfile/loadProfile» → «answers the owner their own profile as stored through loadProfile»; not kept: «leaves roles, phone and email as stored», «leaves a server-written block untouched», «never creates the document», «a PROVISIONED stub is refused by decide» — `dead:` 4A-3 (2) (`writeOwnProfile`); the denial is proved by `firestore.rules.integration.spec.ts` «refuses a client updating their own first name …» and siblings, the write by `update-profile.integration.spec.ts` |
| `libs/infrastructure/firestore/src/lib/accounts.adapter.spec.ts`                            | 24 → 13     | 0         | −11 / +0            | not kept: the eleven `writeOwnProfile` cases — `dead:` 4A-3 (2) (the rule is `ProfileEditSystem.decide`’s, pinned in `profile-edit.system.spec.ts`; the write is `update-profile.pipeline.spec.ts`’)                                                                                                                                                                                                                                                                                                                                         |
| `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`                 | 67 → 74     | 22→24     | −6 / +15            | the five owner-update allows become denies (§1.2); «admits %s» → «refuses %s as well — a well-formed value is the callable’s»; + the unchanged-read pairs and the impersonation/invitation denies                                                                                                                                                                                                                                                                                                                                            |
| `libs/infrastructure/firestore/src/lib/loyalty-catalog.adapter.spec.ts`                     | 18 → 19     | 0         | −0 / +1             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `libs/infrastructure/firestore/src/lib/subscribe-with-retry.spec.ts`                        | 4 → 6       | 1         | −2 / +4             | re-titled onto the flat `Result`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `libs/ui/controls/src/lib/phone-field/phone-field.spec.ts`                                  | 20 → 22     | 0         | −1 / +3             | «(kernel formatting)» → «(PhoneSystem formatting)» (F6); + `null` for the legacy `undefined`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tools/flags/feature-flags.manifest.spec.mjs`                                               | 2 → 2       | 2         | −2 / +2             | re-titled `FeatureFlagKey` → `FlagName`, `FeatureFlags.create` → `.parse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tools/verify/bundle/initial-bundle.spec.mjs`                                               | 8 → 10      | 0         | −0 / +2             | added cases only, or re-titled with the same intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 11.3 The 4b pre-ledger (§5.3) — the legacy specs whose rule moved in 4a

4b's deletion ledger cites these successors; the case-by-case lines are 4b's
(the legacy specs stay green until then, `engagement` aside, §8.1 item 6 (b)).

| New (or extended) spec, case count on the P9 tree                                                                                              | Carries the cases of (legacy, deleted in 4b)                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primitives/ids.primitive.spec.ts` (14 → 18)                                                                                                   | `libs/application/booking/src/lib/ports/booking-gateway.port.spec.ts` (7 — the guards)                                                                                                                    |
| `primitives/redirect-path.primitive.spec.ts` (12)                                                                                              | `libs/domain/identity/src/lib/redirect-path.spec.ts` (11; its `toString` case `dead:`, a brand IS its string)                                                                                             |
| `primitives/pipeline-errors.data.spec.ts` (4 → 18)                                                                                             | the failure rows of the deleted `booking-gateway.adapter.spec.ts` (11.1), `waitlist-gateway.adapter.ts`, `otp-client.adapter.spec.ts`                                                                     |
| `primitives/legacy-wire-successors.spec.ts` (4)                                                                                                | `edge.spec.ts`' live `LegacyWireCode` rows (seven unreferenced rows `dead:` there)                                                                                                                        |
| `primitives/{cancellation,move,staff-edit}-errors.data.spec.ts` (3, 2, 2)                                                                      | the systems' dictionary cases, moved with their dictionaries (4A-6)                                                                                                                                       |
| `systems/avatar.system.spec.ts` (4), `pipelines/upload-avatar.pipeline.spec.ts` (3)                                                            | `libs/application/accounts/src/lib/use-cases/upload-avatar.use-case.spec.ts` (2) + the Storage adapter's guard cases (11.1)                                                                               |
| `systems/audit.system.spec.ts` (37 → 45)                                                                                                       | — (4A-16: the own-edit row; skip on a changed marker; no skip on creation, deletion, an unchanged marker, a reset to `null`)                                                                              |
| `systems/shop-zone.system.spec.ts` (4), `pipelines/resolve-shop-zone.pipeline.spec.ts` (5), `pipelines/shop-zone-read.pipeline.spec.ts` (3)    | `ProgramsSystem.zoneOf`'s cases (kept there, over the lifted rule) + 4A-2 (e)                                                                                                                             |
| `components/edit-command.data.spec.ts` (2), `move-rider.data.spec.ts` (3), `chair-time.data.spec.ts` (4), `booking-draft.type-spec.ts`         | the moved dictionaries' and guards' cases; `Disjoint` / `NoNested` / narrowing (4A-9)                                                                                                                     |
| `libs/infrastructure/i18n/src/lib/booking-status-words.spec.ts` (3)                                                                            | the deleted `STATUS_KEY` / `WIRE_STATUS` / `REASON_KEY` pins                                                                                                                                              |
| `libs/infrastructure/firebase-app/src/lib/shop-zone.service.spec.ts` (3)                                                                       | —                                                                                                                                                                                                         |
| `pipelines/ensure-session-ready.pipeline.spec.ts` (4)                                                                                          | `libs/application/identity/src/lib/use-cases/ensure-session-ready.use-case.spec.ts` (3)                                                                                                                   |
| `pipelines/register-user.pipeline.spec.ts` (4)                                                                                                 | `libs/application/identity/src/lib/use-cases/register-user.use-case.spec.ts` (5)                                                                                                                          |
| `pipelines/start-impersonation.pipeline.spec.ts` (6), `end-impersonation.pipeline.spec.ts` (5)                                                 | `libs/application/governance/src/lib/use-cases/{start,end}-impersonation.use-case.spec.ts` (2, 3)                                                                                                         |
| `pipelines/redeem-invitation.pipeline.spec.ts` (6)                                                                                             | — (F3-12's dead invitation cases get a living home)                                                                                                                                                       |
| `pipelines/update-profile.pipeline.spec.ts` (7 → 8)                                                                                            | — (the row in the transaction, the marker, unchanged → nothing)                                                                                                                                           |
| `components/booking-draft.data.spec.ts` (10)                                                                                                   | the store's `heldSource` / `heldMove` / `isChairTime` cases                                                                                                                                               |
| `components/booking-call.data.spec.ts` (7), `call-answers.data.spec.ts` (8), `streak-publish-call.data.spec.ts` (4 → 8)                        | the builders and the answer decoders; the wire round trip stays in `*.wire.spec.ts`                                                                                                                       |
| `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts` (7)                                                                             | `wordError`'s cases (`booking-gateway.port.spec.ts`)                                                                                                                                                      |
| `libs/features/shared/visits/src/lib/wall-clock.spec.ts` (3)                                                                                   | `ZonedDateTime.weekdayLabels`' cases (`libs/domain/kernel/src/lib/zoned-date-time.spec.ts`)                                                                                                               |
| `callable-client.adapter.spec.ts` (10), `auth-session.adapter.spec.ts` (22), `otp-challenge.adapter.spec.ts` (7)                               | — (11.1 carries the deleted adapters' cases into them)                                                                                                                                                    |
| `firestore.rules.integration.spec.ts` (89 → 98)                                                                                                | — (the denies and the unchanged-read pairs, §1.2)                                                                                                                                                         |
| `apps/functions/src/integration/impersonation.integration.spec.ts` (3), `wire/governance.wire.spec.ts` (8), `wire/invitation.wire.spec.ts` (4) | — (`purgeAt` = `endedAtUtcMs` + 30 d after end, §1.2; the new callables' wires)                                                                                                                           |
| the pass-through use cases now direct port calls (4A-8)                                                                                        | `sign-out.use-case.spec.ts` (1), `request-otp.use-case.spec.ts` (2), `verify-otp.use-case.spec.ts` (2) (`libs/application/identity`) — their behaviour is the adapters' (`auth-session`, `otp-challenge`) |

### 11.4 The departures of 4A-2, each pinned

- **(a) A spring-forward gap start is refused `DST_GAP_INVALID_TIME`** —
  `book-appointment.pipeline.spec.ts` «refuses a start inside the
  spring-forward gap DST_GAP_INVALID_TIME, never shifted, writing nothing (4A-2
  (a))»; `reschedule-appointment.pipeline.spec.ts` «refuses a cart start
  inside the spring-forward gap DST_GAP_INVALID_TIME, writing nothing (4A-2
  (a))»; `edit-appointment.pipeline.spec.ts` «refuses a wall clock inside the
  spring-forward gap DST_GAP_INVALID_TIME, writing nothing (4A-2 (a))». With
  it the time sheet stops refusing such a minute itself:
  `booking-time-sheet.spec.ts` «keeps a spring-forward minute as the wall
  clock says it — the commit’s pipeline is what refuses it» (was «refuses a
  minute the spring-forward gap erased …») — unreachable from a screen on
  the same premise as (a) (no grid offers a gap minute); the reviewer should
  confirm this re-pin is inside (a).
- **(b) An `active` token with no tenant or empty roles reads ONBOARDING** —
  `principal.data.spec.ts` «degrades active claims with no tenant to
  onboarding»; `auth-session.adapter.spec.ts` «reads an active token with %s
  as ONBOARDING (4A-2 (b))»; `session-identity.service.spec.ts` «grants
  nothing for a claim outside the vocabulary — the token degrades to
  onboarding».
- **(c) The attempt line speaks the flipped vocabulary** — `edge.spec.ts`
  «speaks the flipped vocabulary: the SCREAMING outcome, the failure’s code as
  `errorCode`».
- **(d) `rxjs` stays in the functions dist** — measured: the dist lists the
  five of `tools/verify/p0/functions-deps.baseline.json`
  (`check-functions-deps.mjs` (f) `pass`); no spec case.
- **(e) No location in scope → the default location's zone, its read
  failure the boundary's store failure** — `resolve-shop-zone.pipeline.spec.ts`
  «refuses when neither is stored», «answers a read that fails with its
  repository error»; `shop-zone-read.pipeline.spec.ts` «answers neither
  location stored as a read failure on the default location …»; one case per
  re-typed server pipeline, each titled «… (4A-2 (e))»:
  `project-client-stats`, `publish-streak-definition`, `run-backfill`,
  `request-waitlist`, `rebuild-busy`, `rebuild-capacity`, `match-waitlist`,
  `sample-lead-time` (`rebuild-capacity` adds «answers a default location
  that is not stored as a read failure naming it»); on the web
  `client-card.store.spec.ts` «fails the whole card when the zone cannot be
  read — nothing is judged on a day it cannot name — and its retry reads the
  zone again (4A-2 (e))» (the card's S7, at integration — the wave-1 card
  stayed in its loading state), `admin-rhythm.store.spec.ts` «reads the
  shop’s zone before the rule: a zone that cannot be read is the rule’s
  failed read …», `appointments.store.spec.ts` «reads "today" on the
  default shop’s zone, and loads until that zone has resolved» and «shows
  its failed state when the shop’s zone cannot be read, and reads the zone
  again on retry (4A-2 (e))» (at integration — the wave-1 page stayed
  loading), `shop-today.pipeline.spec.ts` (was `loyalty-catalog-today.spec.ts`,
  §11.6) «answers a failed zone read with its RepositoryError, and reads
  again next call» and «answers no stored default location as a failed read
  of it …», `staff-dashboard.spec.ts` «names no day until the shop’s zone is
  known, then opens on today» (the chrome drawn, the lanes in their loading
  state) and «reads the default location again when its zone could not be
  read» (§11.6), `shop-zone.service.spec.ts`
  «answers a location’s own zone, else the default’s, else the refusal»,
  «says when the default read failed, and reads again only on a retry after
  a failure», «counts no default location stored as a failed read».
- **(f) The site menu's «График» subtitle waits for the zone** —
  `site-menu.component.spec.ts` «leaves the date out until the shop zone
  resolves», «leaves the date out when the shop zone cannot be read».
- **(g) A phone session's identifier line reads the raw E.164 until the
  lazy formatter lands** — `session-identity.service.spec.ts` «reads a
  phone session as the raw E.164 until the formatter lands, then formats it
  internationally».

### 11.5 The integrator's changes (2026-10-22, after the P9 sweep)

Counted the same way against the P9 tree. Each deleted case has a successor
or a `dead:` reason; nothing else lost a case.

- **Deleted — the legacy voucher half of `libs/application/engagement`**
  (§8.1 item 6 (b); dead outside the legacy libs, its fixture read the flat
  `vouchers.json` as nested):
  - `src/testing.spec.ts` (11): «holds five vouchers, each under its own
    code» and «counts money in whole euro cents, never more left than was
    issued» → `libs/ecs-core/src/testing/loyalty.fixtures.spec.ts` «holds
    five vouchers, each under its own code, never more left than was
    issued»; «offers the gift voucher fixture» → «spreads each document id
    in, in Firestore’s id order, the body as stored»; «hands them out
    frozen, all the way down» → same title there; «speaks only the closed
    vocabulary, and dates everything in the shop’s zone» → «holds five
    vouchers …» (`voucherStatus` in `VoucherStatus`) + the compile-time
    `Json<GiftVoucher>` check of the file (the `*UtcMs` stamps carry no
    zone); «issues a voucher to a seeded client, or to nobody», «the
    vouchers: Георги has 25,00 € left of 50,00 € until the year’s end» and
    «hands each client the vouchers issued to them, and nobody the paper
    one» → `tools/seed/promotions.spec.mjs` «are written to the adapters’
    collection, and say their record and their account», «Георги holds one
    he can spend: 25,00 € left of 50,00 €, to the end of the year» and
    `coupons-vouchers.adapter.spec.ts` «lists what a client holds, whatever
    its state — never another’s, never a paper one»; «offers the vouchers
    port its in-memory reference», «keeps them off the production barrel»,
    «re-exports none of the test support» — `dead:` the legacy testing entry
    point is gone (`@core/testing` is kept off production code by the root
    `TESTING_ENTRY_POINT_RESTRICTION`).
  - `src/lib/ports/client-vouchers-reader.port.spec.ts` (9): «lists what the
    account was issued, whatever its state», «keeps one person’s vouchers
    from another», «puts a paper voucher on nobody’s list» →
    `coupons-vouchers.adapter.spec.ts` «lists what a client holds, whatever
    its state — never another’s, never a paper one» +
    `coupons-vouchers.adapter.integration.spec.ts` «hands a barber what the
    client record holds …»; «answers an empty list for a client who holds
    none» → «is an empty list, never an error, for a client who holds none»
    (both specs); «fails while told to, and records every read» →
    `coupons-vouchers.adapter.spec.ts` «turns a refused read into a failed
    Result» (the read's failure; the call log was the in-memory class's own,
    `dead:` with it); «names its token», «reads each
    voucher through the wire’s reader: money, dates, the holder», «issues a
    voucher, and replaces one under its id», «leaves out a document that is
    no voucher, and keeps the rest» — `dead:` the reader port, its token,
    its in-memory class and the document mapper (Law 5: the flat
    `GiftVoucher` IS the document, read as stored since flip 1).
  - `src/lib/ports/gift-voucher-document.spec.ts` (15, two `it.each`): every
    case `dead:` with the mapper (Law 5, zero mapper; `giftVoucherFromDocument`
    / `giftVoucherToDocument` left the runtime with flip 1, runbook §4.1
    `M1`); the rules they carried live on: the balance never below nothing
    and the drawn-down round trip → `voucher.system.spec.ts` «VoucherSystem —
    the balance algebra»; Георги's story → `promotions.spec.mjs` (above); the
    by-holder reads → `coupons-vouchers.adapter.spec.ts` (above).
- **Deleted case:** `libs/ecs-core/src/pipelines/booking-read-set.pipeline.spec.ts`
  «frames wire instants on the shop’s ONE day — a start on another day, or
  none, places nothing» — `dead:` `frameShopDay` had no caller once the
  wire carried the wall clock (4A-4); its successor rule is
  `book-appointment.pipeline.spec.ts` «frameWallClock — the call’s wall
  clock on the shop’s zone (Law 7.3)». 13 → 12.
- **Re-titled (same subject, the plan's outcome):**
  `client-card.store.spec.ts` «keeps the card in that state when the zone
  cannot be read …» → «fails the whole card when the zone cannot be read …»
  (4A-2 (e), §11.4); `booking.wire.spec.ts` «a staff placement names its
  client — or books guests only — and needs a role that works the book» →
  «a staff placement says so — or names its client — and needs a role that
  works the book» (the call's own `placement`, §8.1 item 9 (b));
  its sibling «a staff member booking their own seat is a client booking …»
  gains the guests-only cart of a staff member from `/book`. `apps/functions/src/integration/verify-otp.integration.spec.ts` «refuses
  an Auth user whose users doc carries another contact —
  token_minting_failure, nothing written» → «… —
  IDENTITY_TOKEN_MINTING_FAILURE on the wire, nothing written» (no package
  had re-pointed it to the flipped wire, 4A-4; 5 → 5).
- **Added:** `pipeline-errors.data.spec.ts` 15 → 16 (the §11.1 gap);
  `loyalty.fixtures.spec.ts` +3 (`giftVoucherFixtures`, P7's open item);
  `move.system.spec.ts` +2 (`MoveSystem.cartRiders`);
  `booking-call.data.spec.ts` +2 (`BookingCall.clientCancel`, one an
  `it.each` of three blanks); `shop-zone.service.spec.ts` 3 → 5;
  `appointments.store.spec.ts` 9 → 10; `booking-flow.store.spec.ts` and
  `staff-dashboard.spec.ts` pin the `placement` each sends (inside existing
  cases); `tools/seed/load-domain.spec.mjs` binds the default location
  instead of `tenantTimeZone` and names the `catalog` server module (inside
  existing cases).
- **Moved test double:** `libs/features/client/booking/src/testing/booking-shell.rig.ts`'s
  stand-in `sessionStorageDrafts()` is gone; the rig binds the production
  `sessionStorageBookingDraftPorts` (reuse, never copy — P4's open item).

### 11.6 The fixer's changes (2026-10-22, the review round)

Each a reviewer's confirmed finding, fixed to fidelity; nothing departs
beyond 4A-2.

- **The staff day draws its chrome while the zone resolves** (fidelity,
  R13). The page-wide `@if (store.ready())` is gone: `<main>`, the toolbar
  and its pickers render at once, as at e9d1ca4; only the day pill waits on
  `store.ready()` (the week strip is already empty with no today), and
  `StaffDayStore.loading` stays `true` while `zone()` is `null`, so the
  lanes' existing loading state covers the wait and «Днес никой не е на
  смяна.» is never said of a day not yet read. A zone that cannot be read
  (no catalogue shop and the default read failed, `defaultZoneFailed`) leaves
  the page as a failed lane read does — no lanes, no sentence — and the two
  moments that already re-read "now" (the minute tick, the tab's return)
  retry through `ShopZoneService.retryDefaultZone`. Creating before the zone
  is known is a no-op (`openCreate`). Pinned by `staff-dashboard.spec.ts`
  «names no day until the shop’s zone is known, then opens on today»
  (gains the chrome and no-sentence assertions) and the new «reads the
  default location again when its zone could not be read»; 4A-2 (e) lists
  the staff day.
- **A restored draft whose day has lapsed opens on today** (fidelity): the
  schedule step decides its scroll AFTER `settleLapsedDays` — a day the
  settle just dropped scrolls to today (`'auto'`, `'nearest'`), as a flow
  with no day picked does. Pinned by `client-booking.spec.ts` «opens on
  today when the settle drops the picked day» (+1 case).
- **The loyalty catalogue's day is a pipeline over `readShopZone`** (reuse,
  Law 4/8): `libs/infrastructure/firestore/src/lib/loyalty-catalog-today.ts`
  and its spec are deleted; `libs/ecs-core/src/pipelines/shop-today.pipeline.ts`
  (`shopToday`) builds on `readShopZone(null)` — no second copy of the
  `CATALOG_LOCATION_ZONE_UNKNOWN` → `REPOSITORY_READ_FAILED` fold — and its
  spec carries the six cases unchanged in substance
  (`shop-today.pipeline.spec.ts`, the describe renamed `shopToday`). The
  lazy `firestore.adapters.ts` carries it as a NAMED re-export
  (`export { shopToday } from '@core/pipelines'`, the phone field's
  `*.lazy.ts` precedent), so `app.config.ts` binds `m.firestore.shopToday`
  in the same lazy scope and R10 holds.
- **One admin-role check** (Law 3/4, reuse): `isAdmin(roles)` joins
  `isStaff`/`mayBook`/`seesMoney` in `role.data.ts` (claims-tolerant, over
  `ADMIN_ROLES`); `admitImpersonationCaller` and the functions'
  `callerIsAdmin` (`isAdmin(callerKnownRoles(request))`, equivalent — a
  string in `ADMIN_ROLES` is a known role) both call it. `role.data.spec.ts`
  +1 case («isAdmin admits exactly the admin pair — the rules’ isAdmin()»)
  and one assertion in «an unrecognised claim grants nothing».
- **A refused impersonation start is ONE flat struct** (Law 7.5):
  `startImpersonation` answers `started.error[0]` (`defect` on an empty
  list); `StartImpersonationError` is `GovernanceError | RepositoryError`;
  the wire's `isFaultList` is deleted and `startImpersonationRefusal` is
  `refusalOf`, like the end's. The callable's answer is unchanged.
  `start-impersonation.pipeline.spec.ts` «answers the structural faults at
  once …» → «answers the FIRST structural fault — self, then no reason, then
  no window — as one flat refusal, writing nothing» (each fault alone now
  asserted too); `governance.wire.spec.ts` «answers `{ sessionId }`, a
  start’s structural faults as the FIRST of them …» → «… a start’s refusal
  as itself (the pipeline picked its first fault) …».
- **Dead exports deleted:** `IdentityCallRefusal`
  (`identity-errors.data.ts`) and `StreakPublishCallRefusal`
  (`streak-publish-errors.data.ts`) — referenced nowhere.

### 11.7 The fixer's changes (2026-10-22, the second review round)

Each a reviewer's confirmed finding; fixed to fidelity except (2), which
F6 makes impossible to keep exactly and which 4A-2 (g) records.

1. **A reset of the profile-edit marker is never the callable's** (4A-16,
   fidelity): `AuditSystem.auditedByCallable` skips only an update whose
   AFTER side carries an instant (`afterProfileEditedAtUtcMs !== null`)
   different from the before side's. A whole-body Admin `set` writing
   `profileEditedAtUtcMs: null` over an account `updateProfile` already
   stamped (the dev seed's `registeredAccountBody`, the e2e `seedUser`)
   is audited `PROFILE_UPDATED`, as at e9d1ca4. `audit.system.spec.ts`
   +1 case (44 → 45): «audits an update that reset the stamp to null (a
   whole-body seed set) — a reset is never the callable's».
2. **The phone identifier line is never blank** (4A-2 (g)):
   `SessionIdentityService.identifierLabel` reads the raw E.164 until the
   lazy formatter lands, and the lazy import's rejection is handled (the
   request flag resets, so the next sign-in asks again). The 4a case
   «formats a phone session internationally once the formatter has
   loaded» → «reads a phone session as the raw E.164 until the formatter
   lands, then formats it internationally» (count unchanged).
3. **Readers with an ecs-core code pass the flat struct** (4A-5):
   `admin-rhythm.ts`'s forbidden toast reads `StaffEditError.forbidden()`
   (`errors.BOOKING_STAFF_EDIT_FORBIDDEN`, the same words in both
   catalogues as the dotted `booking.staffEdit.forbidden`) and the
   onboarding partial birthday `{ errorCode:
IdentityErrorCode.BirthDateInvalid }`. The `{ code }` arm's remaining
   readers are exactly those of the (g) keys (4A-5, 4A-13, §8.1 item 9
   (g), HANDOFF §3.3 4b step 3 corrected: the arm is not readerless).
   `admin-rhythm.spec.ts` +1 case (27 → 28) pins the toast's words: «toasts
   the not-allowed words, without «Отмени», when the server refuses a
   caller who is no admin».
4. **One "is this a failed call" guard** (reuse, never copy):
   `PipelineError.isPipelineError(error)` in
   `primitives/pipeline-errors.data.ts` (over the derived
   `Object.values(PipelineErrorCode)` list; no `new` in a data file) replaces the booking flow store's
   `isPipelineFailure` (and its `PIPELINE_CODES`) and the functions
   identity wire's private copy; the store, `booking-error-message.ts` and
   `identity.wire.ts` call it. `pipeline-errors.data.spec.ts` +1 case
   (16 → 17 `it(` lines): «isPipelineError() tells a failed call from any
   other refusal by its code».

The full gate (HANDOFF §4) re-run on this tree, baseline reds only:
`sync:check` and `verify-tools:layering` ok; `run-many -t typecheck
--skip-nx-cache` only `patterns` red; `run-many -t lint` 61 projects, 0
errors; `run-many -t test --parallel=3` 12,605 passed, 6 failed (the
baseline `gauge.spec.ts` 4, `visit-pills.spec.ts` 1,
`visits-page.presenter.spec.ts` 1); `nx test ecs-core --coverage` 272
files, 4,469 tests, 97.85 % statements, 98.81 % lines; `typecheck
seed-tools` green; `build web` green (initial 597.59 kB, the `gauge.css`
budget warning as before); `verify:bundle` ok; `build functions` +
`check-functions-deps.mjs` pass (five dependencies, as recorded); runbook
§4.2 PASS, §4.3 PASS, §4.4 PASS, §4.5 PASS with the preamble's and with
§4.4's `STORE`, §4.7 PASS (103 `ok` in all); `verify:p0` all proved;
`test:emulator` 65 + 255 passed; `e2e:web` 41 passed, 19 failed — the
baseline 6 `*-screenshots`, `landing.spec.ts:121`, 12
`client-card-glance.spec.ts` runs at `:343`/`:686`.
