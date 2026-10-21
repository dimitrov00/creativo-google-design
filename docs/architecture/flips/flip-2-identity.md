# Flip 2 — identity and accounts (Phase 3b)

**Date:** 2026-10-21 · **Status:** integrated on `main` 2026-10-21 (the
flip 2 commit) — P0–P5 built, §11 complete, the full gate of
`docs/architecture/HANDOFF.md` §4 green but the baseline reds (incl.
`verify:p0` with (e) both ways, `test:emulator`, `e2e:web`) and the §6 gate
PASS; what is left is `HANDOFF.md` §3.2. Written on `3ff1793` (the Law 9
port pass), revised against the plan review's verified gaps (deltas 10–14,
F2-3/7/9/10 restated, §6 gates added); it was the contract the parallel
packages built against. · **Law:** `CLAUDE.md` Laws 1–9 and the eight
`.claude/rules/*.md` (`ecs-ports.md` is Law 9's template); this plan never
overrides them. · **Sources:**
`docs/architecture/ecs-migration.md` §1.4 (the twelve `libs/domain/models`
importers), §2.4, §3.1 (`users`, `otps`), §3.5, §4.1 (`requestOtp`,
`verifyOtp`, `completeRegistration`, `updateProfile`), §6 Phase 3 / Phase 4,
§9 D8 and D29; `docs/architecture/flatten-spec.md` §3.7 (identity names),
§2.3 T2 (OTP and impersonation expiries are elapsed-time rules on
`UtcEpochMs`), §4.2–4.3 (error codes, wire freeze), §5 (D29); the runbook
`docs/architecture/firestore-runbook.md` §1 (matrix), §2 (TTL), §4.2 (gate);
`docs/architecture/flips/flip-1-booking-core.md` (the worked example: its
method, contracts and ledgers are copied here — but NOT its adapter table,
whose `Pick<…Ports>` return types Law 9 superseded). Every file below was
located by `git grep` on 2026-10-21 against `3ff1793` (the tree clean but
for this plan); line anchors are left out on purpose.

**Law 9 in this plan, once.** Every port this flip adds or consumes is a
member of a focused bundle record declared in
`libs/ecs-core/src/ports/*.port.ts`; every web `InjectionToken` and every
functions adapter factory is typed against exactly one bundle (an adapter
serving several returns their `&`, never a local alias); every pipeline's
`XPorts` is an intersection of named bundles and nothing else; no
`Pick`/`Omit` of a `*Ports` type appears anywhere in this plan or in the
code it produces (`creativo/no-sliced-ports`, §6's Law 9 gates). The bundle
map is §3.1.1.

A flip is the read/write closure of its collections, landed as **one
commit**: pipelines, server adapters, every surviving reader, web bundles,
the consuming store fields, rules, indexes, seed fixtures, the e2e seed and
the P0 proofs. Greenfield: no dual shape, no backfill, no fallback reader;
the emulator is wiped and reseeded.

---

## 0. Decisions this plan takes (read first)

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| F2-1  | **What "frozen" means** (F1-1, unchanged). Every single-request outcome — the documents a request leaves, the answer, the error status and `details`, the claims minted, the audit rows the `auditProfileChanges` trigger writes — equals today's. The sandwich may close a race where today's code already intends the invariant. Two deliberate departures besides the two below: `verifyOtp` adopts an Auth user that holds the destination without a `users` doc, when tx 2's read allows it (F2-9, §10.6); and the raw e-mail destination's last label needs at least two characters — the three OTP callables parse through the single ecs-core `Email.parse` rule (`ParsedIdentifier.parse`) where the legacy `@creativo/domain/models` `Email` accepted one, so `{ kind: 'email', value: 'a@b.c' }` is now refused by `requestOtpChallenge` as `invalid_input` 'invalid email destination' and by `completeRegistration` as 'invalid identifier value'. The tightening is safe: it is the one e-mail rule of ecs-core (no second, looser rule is kept for the old answer), the shipping client's `@creativo/domain/identity` `Email` already requires two characters, and greenfield means no stored challenge holds such a destination (§11.3 pins it). The product changes of this flip are exactly two: the D29 `REGISTRATION` client record (flatten-spec §5.3) and the new `updateProfile` callable (blueprint §4.1, needed by `verify:p0` (e)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Task constraint.                                                                                              |
| F2-2  | **Out of this flip** (each is Phase 4, blueprint §6 Phase 4 / runbook §2.1): the rules tightenings (`users` client `update` → `false`, `impersonationSessions` write → `false`), the web's switch of its profile write to `updateProfile`, the `startImpersonation`/`endImpersonation` callables and the `impersonationSessions.purgeAt` stamp they own, `Role`/`AuthStage` value casing (flatten-spec OQ-3 — kept lowercase), the e2e `sign-in.ts` `UserRole` re-point, the `OTP_CLIENT`/`AUTH_GATEWAY` rows and their `new XxxUseCase` sites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Risk 11: a rule closes in the commit of the surface it closes.                                                |
| F2-3  | **The callable wire is frozen in both directions** (F1-3 applied to identity). `requestOtpChallenge` keeps `{ channelKey?, kind, value }` → `{ challengeId, devCode? }` (`devCode` only under `FUNCTIONS_EMULATOR`), `verifyOtpChallenge` keeps `{ challengeId, code }` → `{ sessionKind: 'new' \| 'returning', customToken }`, `completeRegistration` keeps `{ kind, value, fields }` → `{ customToken }`; every refusal keeps today's `LegacyWireCode` status and `details`, including the `invalid_input` `reason` strings (`'missing or empty destination'`, `'invalid phone destination'`, `'code must be a 6-digit string'`, …). The `HttpsError` **message** is NOT frozen: it becomes the wire code, as for every flipped callable (`edge.ts` `toHttpsError`), because no client reads it (`CallableOtpClient` reads `details.code` / `details.errors[0].code` only); the legacy human messages (`'Invalid input: …'`, `'An OTP was already sent recently …'`, `'OTP challenge over … is not allowed …'`) go with the handlers, and `identity.wire.spec.ts` pins status and `details`, never the message. `requestOtpChallenge`'s `kind` is never refused: `'phone'` → SMS, anything else (absent, garbage) → e-mail, as `lib/otp/request-otp.ts` maps it today. A new `apps/functions/src/wire/identity.wire.ts` holds the decoders, the encoders and one `…Refusal(error): EdgeError` per callable that turns a pipeline's ecs-core error back into today's legacy code (as `commitBookingRefusal` does). `CallableOtpClient` and `verify:p0`'s payloads are untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Keeps the web OTP client and the e2e auth journey untouched; the wire flips with `callableClient` in Phase 4. |
| F2-4  | **New ecs-core error codes, never a second rule for a legacy wire code.** The pipelines need codes for refusals no dictionary spells yet. P0 adds to `IdentityErrorCode` (nine): `OtpChannelMismatch`, `OtpRateLimited`, `OtpNotFound`, `OtpDestinationCorrupted`, `OtpAccountConflict` (F2-9's refused adoption), `RegistrationUnauthenticated`, `RegistrationForbidden`, `RegistrationUserNotFound`, `RegistrationFieldMissing`; to `AccountsErrorCode`: `UpdateProfileUnauthenticated`. Their edge rows use NEW dotted wire codes (`identity.otp.not_found`, …, `accounts.update_profile.unauthenticated`), because `edge.spec.ts` holds "no wire code by two rules"; the three OTP callables never let them reach the wire (F2-3's refusal functions translate first), `updateProfile` (a new wire) answers them as themselves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `edge.spec.ts` "holds exactly one rule per code".                                                             |
| F2-5  | **`updateProfile` lands now, server-side only.** Pipeline, callable export, `Callables.UpdateProfile`, emulator spec, and `verify:p0` (e) run **both ways** (blueprint §6 Phase 3): the rename through the owner write the rules still allow, the restore through `updateProfile` (so the search keys end consistent). The trigger credits each row to the event's writer (`AuditSystem.profileWriter`): the owner rename's row names the user, the `updateProfile` restore's row names `Actor.system(ADMIN_SDK)` — an attribution change for callable edits that §10.15 decides before Phase 4 routes client edits through the callable; `verify:p0` (e) asserts the actor of each row. The web keeps its direct owner write in this flip, re-typed to the flat body (§3.4) — the sheet switch is Phase 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Blueprint §6 Phase 3 + Risk 11.                                                                               |
| F2-6  | **One profile-edit rule, two writers.** `ProfileEditSystem.decide(stored, edits, ageDay)` (new, P0) is the only code that validates an owner's names/birth date and derives the five allowlisted keys (`firstName`, `lastName`, `birthDate`, `searchName`, `searchPrefixes`) from the STORED phone and e-mail. The `updateProfile` pipeline runs it inside its transaction; the web's `ProfilePorts.writeOwnProfile` (the bundle `PROFILE_PORTS` binds, §3.1.1) runs it inside the browser transaction (the `writeScheduleException(keys, merge)` shape of flip 1). The adapter holds no rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Law 3/4; `profile.adapter.ts` computed search keys in the adapter.                                            |
| F2-7  | **The age check's day is the UTC civil date, as today.** `completeRegistration` (`BIRTH_DATE_ZONE = 'UTC'`), the web profile store and onboarding store (`clock.now('UTC')`) all judge the 16–120 window on the UTC date. That day, `ageDay: LocalDate`, is derived ONCE at the boundary as `ZonedTimeSystem.toLocal(now, UTC_ZONE).localDate` — `UTC_ZONE` is the existing `@core/pipelines` constant of `booking-read-set.pipeline.ts` (`ZonedTimeSystem.checkZone('UTC')`, a defect on failure); the pipelines derive it from `ClockPorts.nowUtcMs`, the web stores from their one `CLOCK` reading. No system takes an instant for it: `ProfileEditSystem.decide` and `AgeSystem.parseIso` take only the `LocalDate` (bucketing an instant into a civil day inside a system would be T1 day-bucketing under an implicit zone, and raw arithmetic on a `UtcEpochMs` outside `compare`/`plus*` — the age check is not a T2 row). No zone field anywhere (Law 7.2). P5 records the UTC age day in flatten-spec §2.3 as an owner-acknowledged exception tied to §10.1. Open question §10.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | F2-1.                                                                                                         |
| F2-7b | **Registration creates the client record (D29, flatten-spec §5.3).** `completeRegistration` reads `customers/{CustomerId.forUser(uid, hash)}` inside its transaction and, when absent, plans `WriteOp.create` with `customerOrigin: 'REGISTRATION'`, `userId: uid`, `displayName = Profile.fullName`, the registered `phone`/`email`, `SearchFieldsSystem.searchFields(…)`, `createdAtUtcMs = now` — the plan built by `CustomerRecordSystem.createsFor(resolved, stored, contacts, CustomerOrigin.Registration, now)`, the system P0 lifts out of flip 1's pipeline helper `customerCreates` (Law 3/4: the body and the create-when-absent decision are business math; the booking/edit pipelines call it with `CustomerOrigin.FirstBooking`, no behaviour change). Present (a `FIRST_BOOKING` or `SEED` record, or a re-run) → no customer write. A commit-time `ALREADY_EXISTS` re-runs the transaction once (flip 1's retry, F1-5, generalised by P0 to `runWithCreateRetry(run, collectionPrefixes)`; `runWithCustomerRetry` stays its customers specialisation), never maps to success. Every registration creates one, whatever the roles. The record is never synchronised with later profile edits (§10.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | D29; F1-5 reuse.                                                                                              |
| F2-8  | **`completeRegistration` writes one `Set`, value-idempotent, from an in-tx read.** Today: `findByDestination` (outside) → uid match → `.set(registered body)`; a re-run on a registered user re-settles (roles, status and contacts kept, names from the form) and writes again. Kept: `findUserByDestination` stays OUTSIDE (it classifies not-found vs forbidden exactly as today), then the transaction re-reads `users/{uid}` and settles on THAT read (closing today's stale read), writing the full flat body with `WriteOp.set` — the entity minus `id`, exactly one `AccountLifecycle` variant, so no stale variant key survives. Not the blueprint's "replay writes nothing" (that would freeze names a re-run changes today, §10.5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | F2-1.                                                                                                         |
| F2-9  | **`verifyOtp` runs the attempt in a transaction and the stub as create-if-absent.** The attempt: `ReadTx.get(otps/{id})`, `codeMatches` from `OtpCrypto` in the read half, `OtpSystem.attempt` decides; the decide ALWAYS answers ok with its plan (`attemptCount` `Update` on a wrong code, `consumedAtUtcMs` `Update` on success, nothing otherwise) and the outcome rides beside it, so a wrong code's increment commits and the refusal is answered after (today's semantics; a `Result.err` from decide writes nothing). The stub: `RegistrationSystem.provision(uid, parsed)` — every key present (`registrationState: 'PROVISIONED'`, `accountStatus: 'ACTIVE'`, names/birth date/`searchName` `null`, `roles: []`, `searchPrefixes: []`) — written by a second `commit` (tx 2) whose read of `users/{uid}` decides for EVERY uid, provisioned or adopted, through `RegistrationSystem.adoptStub(stored, uid, parsed)` (P0): **absent** → create the stub, mint from the stub, `NEW`; **present, `PROVISIONED`, and its `phone`/`email` equals the parsed identifier** → no write, mint from the read, `NEW`; **present `REGISTERED`, or present with a contact mismatch** → write nothing and refuse `IDENTITY_OTP_ACCOUNT_CONFLICT` (`token_minting_failure` on the wire, as today). The claims and `sessionKind` always come from the in-tx body, never from a stub built outside it. Today's plain `.set({ email, phone })` could clobber a registered body. tx 2 runs through `runWithCreateRetry(…, [Collections.Users])`: a commit-time `ALREADY_EXISTS` on the stub `Create` (the Admin SDK retries only `ABORTED`, F1-5) re-runs tx 2 once, which re-reads, finds the winner's stub and plans no write; a second conflict is the answer, never success. The uid comes from blueprint §4.1: `provisionAuthUser` answering `null` → `findAuthUserByDestination` → that uid. This is **not race-only**: `provisionAuthUser` answers `null` whenever ANY Auth user holds the destination while no `users` doc carries it, so besides the first-verification race it also adopts an orphan Auth user left by a failed stub write (today `token_minting_failure` for both); a uid whose doc is registered or carries another contact is refused, never signed into (§10.6). | F2-1 race rule; blueprint §4.1.                                                                               |
| F2-10 | **The stored OTP `destination` is the TRIMMED raw payload value, byte-identical to today** (`Otp.issue` stores `Otp.validateDestination(raw)`, which is `raw.trim()`; the legacy handler hands it the untrimmed `input.destination`). The rate-limit probe queries the PARSED identifier (`destination ==` normalised E.164 / lower-cased e-mail) while the challenge stores `Identifier.of(rawValue.trim())` — the decoder keeps the untrimmed text only for the emptiness check and trims once — today's exact pair (a client that sends a non-normalised value is never rate-limited; latent today, §10.8). `verifyOtp` re-parses the stored value (`ParsedIdentifier.parse`) and answers `otp_destination_corrupted` on failure, as `otpDestinationFromRaw` does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | F2-1.                                                                                                         |
| F2-11 | **`purgeAt` for `otps` is stamped by `purgeAtFor`** (F1-7's one place): the group `otps` gains `expiresAtUtcMs` + 24 h (today's `firestore-otp-repository.ts` formula), applied by `firestoreCommitPlan` on `Set`/`Create` and by `saveOtp`. `verifyOtp`'s `Update`s never re-stamp (the expiry does not move). `impersonationSessions` gets no stamp in this flip — no server writer exists (F2-2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `firestore-layout.md`.                                                                                        |
| F2-12 | **`libs/domain/models` ends this flip with no importer** (D8(a)). The seven `apps/functions` importers and their specs go with the legacy handlers; the four `libs/application/identity` ports that import it (`auth-token.port.ts`, `otp-destination.ts`, `otp-repository.port.ts`, `user-repository.port.ts`) are **deleted with their barrel lines**, with `otp-sender.port.ts` and `otp-crypto.port.ts` (whose only importers are the deleted server adapters) — a deliberate departure from flip 1's "`libs/application/**` stays until Phase 4", because these six are server-only port halves ecs-core already replaced (`identity.port.ts`) and D8(a) needs zero importers; `auth-state.service.ts` (`SessionClaims`, no injection site, decodes a `role` claim no token carries — blueprint §1.4 "delete") is deleted. The lib itself and its `tsconfig.base.json` alias are deleted in Phase 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | D8(a); blueprint §1.4.                                                                                        |
| F2-13 | **`impersonationSessions` is re-shaped through its only reader.** `impersonation.adapter.ts` becomes `impersonationReadPorts(db): ImpersonationReadPorts` — the governance bundle that already exists, 1:1 with the new `IMPERSONATION_READ_PORTS` token — whose one member is `observeActiveImpersonation` (`adminUserId ==`, `impersonationStatus == 'ACTIVE'`, limit 1, index #9 re-keyed). Its `save`/`findById` have no caller (the `IMPERSONATION_PORT` row has no injection site) and go; the writes arrive with Phase 4's callables (F2-2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Runbook §1.3 "singleton"; deletion rule.                                                                      |
| F2-14 | **The rules change no line in this flip, comments only.** No rule tests a removed users/otps/impersonation key: the users owner allowlist keys and the "registered" test (`resource.data.firstName` non-blank) keep their names, and the flat stub's `firstName: null` fails the test exactly as the absent key does today; `impersonationSessions` and `otps` rules name no field. The comments naming `status`, `FirestoreUserRepository` and the `{email, phone}` stub are rewritten (the gate counts comments).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | blueprint §3.5 "shape-driven only".                                                                           |
| F2-15 | **The staff client search reads `User` rows.** `USER_SEARCH_PORT`'s view model (`UserSearchResult`) dies with its adapter; `searchUsers(prefix, limit)` (`accounts.port.ts`, already declared; P0 gives it its own bundle `UserSearchPorts`, 1:1 with `USER_SEARCH_PORTS`) answers `User[]` on index #8, the caller normalises the query (`SearchFieldsSystem.normalizeQuery`) and passes today's limit 20; the display name rule (the written name, else `searchName`) moves into the dashboard's option builder unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Law 5 (no mapper); `angular-ui.md`.                                                                           |
| F2-16 | **Law 9: one bundle per token and per adapter factory, no slice, no local alias.** The bundles this flip binds are the existing identity/accounts/governance ones, re-cut only where a consumer needs a subset no bundle names (§3.1.1): `AccountReadPorts` (no consumer on `3ff1793`) is replaced by `ProfilePorts` (`observeProfile`, `loadProfile`, `writeOwnProfile`) and `UserSearchPorts` (`searchUsers`); `UserDirectoryPorts` becomes `UserLookupPorts & AuthUserLookupPorts` (the Firestore query and the Auth lookup live in two adapters); configuration is a bundle (`AuthDeploymentPorts`, as `TenantZonePorts`). `AccountsPorts`, `IdentityPorts`, `GovernancePorts` stay the `&` of their parts. Spec doubles are one `memoryXPorts(): XPorts` per bundle; a scripted double spreads one and overrides members through `Partial<XPorts>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Law 9; `.claude/rules/ecs-ports.md`.                                                                          |
| F2-17 | **`OwnerProfileFields` is a named flat record, not a `Pick<User, …>`.** It is the argument shape of a port (`WriteOwnProfile`'s decide answer), and "a port's argument shape is a named type" — declared in `user.entity.ts` as `{ firstName: string; lastName: string; birthDate: BirthDate \| null } & SearchFields`, with a type-spec proving its keys are exactly the rules allowlist and each is assignable to `User`'s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Law 9 (ports tier holds no `Pick`/`Omit`).                                                                    |
| F2-18 | **The identity adapters' Law 9 residue is fixed here, by the package that owns them.** On `3ff1793` `auth-claims.adapter.ts` returns a local record `AuthClaimsPorts`, `crypto.adapter.ts` a local `CryptoPorts`, `firestore-ports.ts` takes a local `Primitives` record and `edge.ts` declares `EdgePorts = TelemetryPorts & { nowUtcMs }`. They become `AuthAdminPorts & AuthUserLookupPorts`, `HashPorts & IdPorts`, `ClockPorts & HashPorts & IdPorts` and `TelemetryPorts & ClockPorts` (P1; `edge.ts` P0). `consoleOtpSender` and the two OTP-crypto factories, which return a bare `SendOtp`/`OtpCrypto` today, return `OtpDeliveryPorts` / `OtpCryptoPorts`. §6 gates every one, each by a named gate: `AuthClaimsPorts`/`CryptoPorts` by `R9` and the adapter-return gate, `Primitives` by `R9` (scoped to `apps/functions/src`), `EdgePorts`' inline member by the "inline member in a *Ports intersection" gate, the bare `SendOtp`/`OtpCrypto` returns by the two adapter-return gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Law 9 ("an adapter … never a local alias").                                                                   |

---

## 1. The closure

### 1.1 Collections, bodies, TTL, indexes, rules

Every body **is** the entity type minus `id` (Law 5), every key a root key.
Index numbers are blueprint §3.3's; "→" marks the after-state.

| Collection                                          | Body = entity (file)                                                                                                                                                                                                                                                                                                                                         | `purgeAt`                                                                                         | Composite indexes after the flip                                                                                                              | fieldOverrides after the flip                                                                         | Rules lines that change                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `users`                                             | `User` = `UserMeta & AccountContact & AccountLifecycle & SearchFields` (`libs/ecs-core/src/entities/user.entity.ts`): `registrationState`, `phone`, `firstName`, `lastName`, `roles`, `email`, `birthDate`, `accountStatus` (+ `blockReason`, `blockedUntilUtcMs` in `BLOCKED`), `searchName`, `searchPrefixes` — every key present in both states           | —                                                                                                 | #8 unchanged: `searchPrefixes CONTAINS, searchName ASC`                                                                                       | **new** `users.roles` `indexes: []` (an array never queried; the rules read it, which needs no index) | none (comments only, F2-14)              |
| `otps`                                              | `Otp` (`otp.entity.ts`): `tenantId`, `destination`, `otpDestinationType`, `otpPurpose`, `codeHash`, `salt`, `expiresAtUtcMs`, `attemptCount`, `maxAttempts`, `consumedAtUtcMs`, `createdAtUtcMs`                                                                                                                                                             | `expiresAtUtcMs` + 24 h (F2-11)                                                                   | #10 → `destination ASC, consumedAtUtcMs ASC, createdAtUtcMs ASC` (the probe `destination ==`, `consumedAtUtcMs == null`, `createdAtUtcMs >=`) | none                                                                                                  | none (`allow read, write: if false`)     |
| `impersonationSessions`                             | `ImpersonationSession` = `ImpersonationSessionMeta & ImpersonationLifecycle` (`impersonation-session.entity.ts`): `adminUserId`, `targetUserId`, `impersonationScope`, `reason`, `startedAtUtcMs`, `expiresAtUtcMs`, `impersonationStatus` (+ `endedAtUtcMs`, `impersonationEndReason`, `endedByUserId` / `revokedByUserId`, `revocationNotes` when `ENDED`) | none in this flip (Phase 4 writers stamp `expiresAtUtcMs` + 30 d, re-stamp `endedAtUtcMs` + 30 d) | #9 → `adminUserId ASC, impersonationStatus ASC`                                                                                               | none                                                                                                  | none (`allow read, write: if isAdmin()`) |
| `customers` (D29, joins by the REGISTRATION writer) | `Customer` (`customer.entity.ts`), unchanged since flip 1                                                                                                                                                                                                                                                                                                    | —                                                                                                 | none                                                                                                                                          | `searchPrefixes` (unchanged)                                                                          | none                                     |

Not in the closure: `auditLog` (the profile trigger's rows keep their flat
body; the five audited user keys keep their names, runbook §1.2), the inbox
`users/{uid}/notifications` (flip 1), `users/{uid}/rewardProgress` (dormant).

### 1.2 D29 — account vs client record after this flip

- `users/{uid}` is the ACCOUNT. It carries **no** link to a customer
  (flatten-spec §3.7: the link lives on the customer).
- `customers/{customerId}` carries the explicit nullable link
  `userId: UserId | null` — `uid` for an account holder, `null` for a walk-in.
- **Who creates the client record:** `completeRegistration` (`REGISTRATION`,
  this flip, F2-7b), the booking/edit pipelines on a first booking
  (`FIRST_BOOKING`, flip 1), the seed (`SEED`). The staff walk-in
  (`STAFF_WALK_IN`) is still deferred (F1-2).
- An account holder's id is `CustomerId.forUser(uid, hash)` on the server
  (derived, never cast); the web resolves it through `CUSTOMER_PORTS`
  (`customers where userId == uid limit 1`, flip 1).
- Stay `UserId` (account acts): `User.id`, roles, `AuthClaims`, `Principal`,
  impersonation `adminUserId`/`targetUserId`, the profile audit target
  (`AuditTargetRef.User`), `updateProfile`'s caller.

---

## 2. Reader / writer matrix (re-derived 2026-10-21 on `3ff1793`)

Searches run (runbook §1.4, plus): every importer of `@creativo/domain/models`,
`@creativo/application/identity` and `@creativo/domain/identity` in
`apps/functions`; every `PROFILE_PORT`, `USER_SEARCH_PORT`,
`IMPERSONATION_PORT`, `ProfilePort`, `InMemoryProfilePort`, `HeldProfilePort`
and `AccountStateService` site; every `users`/`otps`/`impersonationSessions`
literal and `Collections.*` use; every `status: { kind`, `storedStatusOf`,
`accountStatusFromDocument`/`ToDocument` and `registeredToPersistence` use. On
`3ff1793`, for Law 9, also: every consumer of an identity / accounts /
governance bundle outside the ports tier, every `type …Ports =` outside the
ports and pipelines tiers, every `Pick<`/`Omit<` over a `*Ports` type
(none), every adapter factory's return type under
`apps/functions/src/adapters` and `libs/infrastructure`, and every
`PROFILE_PORT` method call (`getProfile`, `observeProfile`, `saveProfile`)
and `USER_SEARCH_PORT` call (`search`) in `libs/features`.

Abbreviations as flip 1: `fn:` = `apps/functions/src/`, `wa:` =
`libs/infrastructure/firestore/src/lib/`, `ft:` = `libs/features/`, `pl:` =
`libs/ecs-core/src/pipelines/`, `sd:` = `tools/seed/`, `sdc` =
`tools/seed-dev-catalog.mjs`, `e2e:` = `apps/web/e2e/`, `p0` =
`tools/verify/p0/verify-p0.mjs`, `cfg` = `apps/web/src/app/app.config.ts`.
Package tags `[P0]`…`[P5]` (§4); fate **del** / **rw** / **new** / **edit** /
**kept** (reads only kept keys).

| Collection              | Readers today → owner, fate, successor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Writers today → owner, fate, successor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | **sa** `fn:adapters/firestore-user-repository.ts` (`findByDestination`: `phone`/`email ==`; `toSnapshot`: `status` via `accountStatusFromDocument`, `registered` = non-blank `firstName`) [P1 del → `fn:adapters/firestore-users.adapter.ts` `firestoreUserPorts(db): UserLookupPorts` (`findUserByDestination`), + in-tx `ReadTx.get` in `pl:verify-otp`, `pl:complete-registration`]; **h** `fn:use-cases/{verify-otp,complete-registration}.use-case.ts`, `fn:lib/otp/{verify-otp,complete-registration}.ts` [P1 del → the pipelines]; **new** `pl:update-profile` (in-tx) [P1]; **kept** `fn:adapters/firestore-accounts.adapter.ts` (`firestoreAccountPorts(db): AccountContactPorts`, `loadAccountContacts`: names/contact), `fn:adapters/firestore-jobs.adapter.ts` (`BackfillJobPorts & CallerRolesPorts`, `loadCallerRoles`) and `fn:lib/booking/caller-roles.ts` (`roles`); **kept, spec seeds of kept keys, no edit** `fn:integration/book-appointment.integration.spec.ts` (names/contact for the first-booking copy), `fn:integration/project-client-stats.integration.spec.ts` (`{ roles: ['sysadmin'] }`), `fn:adapters/firestore-tx.adapter.spec.ts` (`users/u-*` as a generic `Create` target, `{ roles: [] }`); **trg** `auditProfileChanges` → `fn:wire/triggers.wire.ts` `decodeProfileChangeEvent` → `pl:audit-profile-change` (the five audited keys; `null` ≡ absent in `comparable`, so the flat stub audits exactly as today's `{email, phone}` stub); **wa** `wa:profile.adapter.ts` (`profileFrom`: `status`, stub → `null`) [P2 del → `wa:accounts.adapter.ts` `profilePorts(db): ProfilePorts`], `wa:user-search.adapter.ts` (#8, `UserSearchResult`) [P2 del → `wa:accounts.adapter.ts` `userSearchPorts(db): UserSearchPorts`]; **st** `PROFILE_PORT` (cfg; → `PROFILE_PORTS`) → `ft:client/account-state/src/lib/account-state.service.ts` (`observeProfile`), `ft:client/booking/src/lib/contact-sheet/booking-contact-sheet.ts`, `ft:client/onboarding/src/lib/onboarding-flow.store.ts`, `ft:client/profile/src/lib/profile.store.ts` [P3], `ft:staff/client-card/src/lib/client-card.store.ts` (`getProfile` → `loadProfile`), `ft:staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts` (`resolveCompanionNames`, `getProfile` → `loadProfile`) [P4]; `USER_SEARCH_PORT` (cfg; → `USER_SEARCH_PORTS`) → `staff-dashboard.ts` (`runClientSearch`, `search` → `searchUsers`) [P4]; consumers of `AccountStateService.account()` (legacy `User` methods): `ft:client/profile/src/lib/client-profile/client-profile.ts`, `ft:client/booking/src/lib/review-step/booking-review-step.ts`, `ft:shared/shell/src/lib/identity/session-identity.service.ts` (+ the other `AccountStateService` users if the re-type breaks them) [P3]; the read model `libs/application/accounts/src/lib/read-models/profile-completion.ts` (+ `.spec.ts`) — `profileCompletion(user: User, hasPhoto)` takes the legacy `@creativo/domain/accounts` `User` (`profileOf` calls `user.birthDate.toISODate()`) and is called with `AccountStateService.account()` by `client-profile.ts` and `session-identity.service.ts` [P3 rw → the flat `User` of `@core/entities`, lowercase keys kept]; every `loadProfile`/`observeProfile` consumer maps a `PROVISIONED` stub to `null` with `Registration.isRegistered` (§3.5) [P3, P4]; presenters taking the legacy `User`: `ft:staff/client-card/src/lib/{client-card,glance}.presenter.ts` (incl. the `statusOf` shim) [P4]; **seed** `sdc` photo writer (`firstName`/`lastName`, kept) [P5 kept], `sd:seed-data.spec.mjs` (`User.create` over the seeded bodies) [P5 rw]; **e2e** `e2e:support/seed-firestore.ts` `seedCustomerRecord` (names/contact, kept) [P5]; `e2e:support/sign-in.ts`, `e2e:account-dashboard.spec.ts`, `e2e:booking-core.spec.ts` (comments naming `users/{uid}` only; `sign-in.ts`'s `UserRole` re-point is Phase 4, F2-2) [kept, no edit]; **p0** `p0` (e) reads `firstName` [P5]; **rules** `wa:firestore.rules.integration.spec.ts` [P5] | **sa** `firestore-user-repository.ts` `provision` (`set({ email, phone })`), `saveRegistered` (`set` of `registeredToPersistence`, `status` map) [P1 del → `WriteOp.create` (stub, create-if-absent) in `pl:verify-otp`; `WriteOp.set` (registered body) in `pl:complete-registration`]; **new** `pl:update-profile` `WriteOp.update` of the five keys [P1]; **wa** `wa:profile.adapter.ts` `saveProfile` (owner transaction, five keys) [P2 → `ProfilePorts.writeOwnProfile` of `profilePorts(db)`, the decide from `ProfileEditSystem`, F2-6; its THREE callers move [P3]: `ft:client/profile/src/lib/profile.store.ts` and `ft:client/onboarding/src/lib/onboarding-flow.store.ts` (each through `new UpdateProfileUseCase`), and `ft:client/booking/src/lib/contact-sheet/booking-contact-sheet.ts` `writeProfile` (a direct `saveProfile` of a `User.reconstitute`d name change — the contact sheet's «save to profile»)]; **seed** `sdc` staff account (`status`) and client profiles (bodies of `sd:fixtures.mjs` `userDocumentOf`, `status`, its own `searchFields` copy) [P5 → `sd:fixtures/users.fixtures.ts`]; **e2e** `e2e:support/seed-firestore.ts` `seedUserProfile` (`status`) [P5]; **p0** `p0` sysadmin body (`status`), (e) owner writes [P5]; **rules** spec seeds (`registeredUser()` with `status`, the `{email, phone}` stub) [P5] |
| `otps`                  | **sa** `fn:adapters/firestore-otp-repository.ts` (`update` tx, `findById`, `findRecentUnconsumedByDestination` on #10 `destination, consumedAt, createdAt`) reached from `fn:lib/otp/{request-otp,verify-otp}.ts` [P1 del → `fn:adapters/firestore-otps.adapter.ts` `firestoreOtpPorts(db): OtpStorePorts` (`loadOpenOtps`, `loadOtp`, `saveOtp`), + `ReadTx.get` in `pl:verify-otp`]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **sa** same file `save`/`update` (`set` of ISO stamps + `purgeAt`) [P1 del → `saveOtp` (`Set` + `purgeAtFor`) and the `Update`s of `pl:verify-otp` through `firestoreCommitPlan`]. No seed, no web writer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `impersonationSessions` | **wa** `wa:impersonation.adapter.ts` (`findById`, `findActiveForAdmin` on #9 `adminUserId, status.kind`) [P2 rw → `impersonationReadPorts(db): ImpersonationReadPorts` (`observeActiveImpersonation`)]; **st** `IMPERSONATION_PORT` (cfg): **no injection site**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **wa** same file `save` (`setDoc`, no `purgeAt`, no caller) [P2 del: no successor in this flip, F2-13]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `customers`             | unchanged (flip 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **new** `pl:complete-registration` `WriteOp.create` (`REGISTRATION`, F2-7b) [P1]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**`cfg` rows the flip removes** (3 class-form `adapter:` rows, each replaced
by a `provideLazyPort` **factory** row typed by its token's bundle, §3.4):
`PROFILE_PORT` (`FirestoreProfileAdapter`: `getProfile`, `observeProfile`,
`saveProfile`) → `PROFILE_PORTS: ProfilePorts`; `USER_SEARCH_PORT`
(`FirestoreUserSearchAdapter`: `search`) → `USER_SEARCH_PORTS:
UserSearchPorts`; `IMPERSONATION_PORT` (`FirestoreImpersonationAdapter`:
`save`, `findById`, `findActiveForAdmin`) → `IMPERSONATION_READ_PORTS:
ImpersonationReadPorts`. Untouched: `AUTH_GATEWAY`, `OTP_CLIENT`,
`AUTH_DEPLOYMENT`, `CONTACT_CHANGE_PORT`, `AVATAR_UPLOADER`, every flip-1
row (`CUSTOMER_PORTS` included), the flip-3/4 rows.

**Owner-write sites over a rebound token** (all three move here, [P3]):
`new UpdateProfileUseCase(inject(PROFILE_PORT))` in
`ft:client/onboarding/src/lib/onboarding-flow.store.ts` (birthday step) and
`ft:client/profile/src/lib/profile.store.ts` (names, birth date) — plus the
direct write site over the same token, `booking-contact-sheet.ts`
`writeProfile` (`saveProfile(User.reconstitute(…))`, names only; [P3]). Each
becomes `PROFILE_PORTS.writeOwnProfile(userId, (stored) =>
ProfileEditSystem.decide(stored, edits, ageDay))` with `ageDay =
ZonedTimeSystem.toLocal(nowUtcMs, UTC_ZONE).localDate` derived once from
the store's one `CLOCK` reading, as today (F2-7), and `userId` from
`UserId.parse` (§3.5). Untouched (not rebound):
`RequestOtpUseCase`/`VerifyOtpUseCase`/`RegisterUserUseCase` over `OTP_CLIENT`,
`EnsureSessionReadyUseCase`/`SignOutUseCase` over `AUTH_GATEWAY`,
`UploadAvatarUseCase`/`RemoveAvatarUseCase` over `AVATAR_UPLOADER`.

**Test-provider sites of a rebound token** (they swap `PROFILE_PORT` /
`USER_SEARCH_PORT` for `PROFILE_PORTS` / `USER_SEARCH_PORTS` with the
`@core/testing` per-bundle doubles `memoryProfilePorts` /
`memoryUserSearchPorts`; a double that scripts a member spreads the memory
double and overrides it through `Partial<ProfilePorts>` — never a `Pick`):
`apps/web/src/app/app.spec.ts` [P2]; `account-state.service.spec.ts`,
`client-booking.spec.ts`, `booking-contact-sheet.spec.ts`,
`booking-review-step.spec.ts`, `booking-schedule-step.spec.ts`,
`booking-services-step.spec.ts`, `client-onboarding.spec.ts`,
`onboarding-flow.store.spec.ts`, `client-profile.spec.ts`,
`profile.store.spec.ts`, `site-header.component.spec.ts`,
`site-menu.component.spec.ts`, `marketing-{careers,courses,events}.spec.ts`
[P3]; `client-card.store.spec.ts`, `client-card.spec.ts`,
`client-history.spec.ts`, `client-ledger.spec.ts`, `client-loyalty.spec.ts`,
`ft:staff/client-card/src/testing/{client-card.fixtures,achievements-pages.rig}.ts`
(`InMemoryProfilePort`, `HeldProfilePort` → `memoryProfilePorts` and a held variant typed `ProfilePorts`), `staff-dashboard.spec.ts`,
`staff-visit-editor.spec.ts` [P4].

**The twelve `libs/domain/models` importers** (blueprint §1.4; non-spec) and
where each goes:

| #   | Importer (uses)                                                                              | Fate                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fn:adapters/firebase-auth-token-adapter.ts` (`TenantId`, `UserId`)                          | del [P1] → `fn:adapters/auth-claims.adapter.ts` (3a, already on `@core/*`)                                                            |
| 2   | `fn:adapters/firestore-otp-repository.ts` (`Otp`, `OtpId`)                                   | del [P1] → `fn:adapters/firestore-otps.adapter.ts` (`Otp`, `OtpId` from `@core/entities`/`@core/primitives`)                          |
| 3   | `fn:adapters/firestore-user-repository.ts` (`UserId`)                                        | del [P1] → `fn:adapters/firestore-users.adapter.ts` (`UserId` from `@core/primitives`)                                                |
| 4   | `fn:use-cases/complete-registration.use-case.ts` (`TenantId.create`)                         | del [P1] → `pl:complete-registration.pipeline.ts` (`loadTenant` port)                                                                 |
| 5   | `fn:use-cases/request-otp.errors.ts` (`IssueOtpError`)                                       | del [P1] → `IdentityError` (`@core/primitives`) + `identity.wire.ts` refusals                                                         |
| 6   | `fn:use-cases/request-otp.use-case.ts` (`Email`, `Otp`, `OtpId`, `OtpPurpose`)               | del [P1] → `pl:request-otp.pipeline.ts` (`ParsedIdentifier`, `OtpSystem.issue`, `OtpPurpose` from `@core/components`)                 |
| 7   | `fn:use-cases/verify-otp.use-case.ts` (`Otp`, `OtpId`)                                       | del [P1] → `pl:verify-otp.pipeline.ts`                                                                                                |
| 8   | `libs/application/identity/src/lib/ports/auth-token.port.ts` (`TenantId`, `UserId`)          | del [P1] (F2-12) → `identity.port.ts` `AuthAdminPorts` + `AuthUserLookupPorts`                                                        |
| 9   | `libs/application/identity/src/lib/ports/otp-destination.ts` (`Email`, `OtpDestinationType`) | del [P1] → `ParsedIdentifier` (`@core/components`)                                                                                    |
| 10  | `libs/application/identity/src/lib/ports/otp-repository.port.ts` (`Otp`, `OtpId`)            | del [P1] → `OtpStorePorts` (`LoadOpenOtps`/`LoadOtp`/`SaveOtp`)                                                                       |
| 11  | `libs/application/identity/src/lib/ports/user-repository.port.ts` (`UserId`)                 | del [P1] → `UserLookupPorts` (`FindUserByDestination`) + the `CommitPlan` writes                                                      |
| 12  | `libs/infrastructure/firebase-app/src/lib/auth-state.service.ts` (`SessionClaims`)           | del [P2] (no injection site; `AuthClaims.fromToken` in `@core/components` is the claims decoder, `ObservePrincipal` the session port) |

Spec importers that go with them: `fn:adapters/{firebase-auth-token-adapter,firestore-otp-repository,firestore-user-repository}.spec.ts`,
`fn:lib/otp/request-otp.spec.ts`, `fn:use-cases/{complete-registration,request-otp,verify-otp}.use-case.spec.ts`
(del [P1]); `fn:adapters/auth-claims.adapter.spec.ts` (rw [P1]: its
`Email`/`TenantId`/`UserId` fixtures from `@core/*`).

**Re-derivation deltas — what moved between the draft (`0a9439c`) and
`3ff1793`** (each already folded into the rows above and the packages):

1. `User` is `UserMeta & AccountContact & AccountLifecycle & SearchFields`
   (flip 1 split `AccountContact` out as a named slice); §1.1 says so.
2. The Law 9 pass split the identity/accounts/governance suites into the
   bundles HANDOFF §3.2 names. `AccountReadPorts`
   (`searchUsers` + `observeProfile`) and `UserDirectoryPorts`
   (`findUserByDestination` + `findAuthUserByDestination`) have **no
   consumer** and do not match any token or adapter this flip builds, so
   P0 re-cuts them (F2-16, §3.1.1).
3. Law 9 residue on identity files (F2-18): `auth-claims.adapter.ts`
   (`AuthClaimsPorts` local record), `crypto.adapter.ts` (`CryptoPorts`
   local record), `firestore-ports.ts` (`Primitives` local record),
   `edge.ts` (`EdgePorts` with an inline `{ nowUtcMs }`),
   `console-otp-sender.adapter.ts` / `otp-crypto.adapter.ts` (factories
   returning a bare port function or member, not a bundle).
4. A THIRD owner-profile write: `booking-contact-sheet.ts` `writeProfile`
   calls `PROFILE_PORT.saveProfile` directly (P3).
5. `fn:adapters/crypto.adapter.spec.ts` and `otp-crypto.adapter.spec.ts`
   import `NodeOtpCrypto` / `FixedCodeOtpCrypto` as parity oracles — they
   are importers of files this flip deletes. P1 pins the oracle's outputs
   as literal vectors (recorded from the legacy classes BEFORE deletion)
   and drops the imports.
6. `wa:contact-change.adapter.ts` names `ProfilePort` in a comment (the §6
   `T2` gate scans `libs/infrastructure`): P2 rewrites the comment.
7. `identity.port.ts` and its docs name `NodeOtpCrypto`,
   `FixedCodeOtpCrypto`, `firestore-user-repository.ts:175`,
   `otp-repository.port.ts`, `console-otp-sender.ts`: P0 re-points them to
   the successors. `W2` lists class and mapper names only, so the stale
   FILE paths (`identity.port.ts`, `accounts.port.ts`, the surviving
   `auth-claims`/`crypto`/`otp-crypto`/`console-otp-sender` adapters,
   `edge.spec.ts`, `main.ts`) are enforced by §6's own "stale pointers to
   deleted files" gate.
8. Kept readers no draft row named (spec seeds of kept keys, e2e comments):
   listed above as **kept, no edit**.
9. `pipelines/index.ts` moves from P0 to P1 (the only package that adds a
   pipeline), so P0's own gate is green alone (§8).
10. `apps/web/e2e/booking-core.spec.ts` (landed in `0a9439c`, after flip 1's
    gate was written) trips three flip-1 gates — `:164` asserts the retired
    keys `timeSlot`/`status`/… are ABSENT and the `dayKey` lines read the
    `data-day-key` DOM attribute: a legitimate user. §6 step 1 excludes it
    from the pasted "removed fields", "wire-only spellings" and "Law 6
    status keys" gates (measured on `3ff1793`: with that exclusion and the
    flip-2 files gone, nothing else trips them).
11. A reader of the legacy `User` class no draft row named:
    `libs/application/accounts/src/lib/read-models/profile-completion.ts`
    (P3, §3.5).
12. `customerCreates`' two production callers
    (`pl:book-appointment.pipeline.ts`, `pl:edit-appointment.pipeline.ts`)
    are touched by the lift to `CustomerRecordSystem` (P0, F2-7b);
    `pl:reschedule-appointment.pipeline.ts` imports only `customerIdsFor`
    and is untouched.
13. Kept ecs-core files still describing the pre-flip bytes ("until the
    identity flip", provenance pointers to deleted files) and one old-shape
    fixture (`systems/audit.system.spec.ts`, the `status: { kind }` map):
    P0 (§4).
14. Stale project references to `libs/domain/models`:
    `libs/application/identity/tsconfig.lib.json` (P1),
    `libs/infrastructure/firebase-app/tsconfig.{lib,spec}.json` (P2) —
    beside `apps/functions/tsconfig.app.json` (P1).

---

## 3. Contracts every package builds against

### 3.1 P0 lands first, alone (the ecs-core vocabulary)

P0's edits fix the types every other package compiles against.

#### 3.1.1 Ports — the bundle map (Law 9)

Port function types and bundles live in `libs/ecs-core/src/ports/` only.
Each bundle below is a concrete record, 1:1 with ONE web token or ONE
functions adapter factory (the "bound by" column); every larger suite is the
`&` of bundles. Nothing is sliced, nothing is re-aliased outside the tier.

**New port function types** (P0):

- `accounts.port.ts`
  - `LoadProfile = (userId: UserId) => Promise<Result<User | null, RepositoryError>>`
    — `users/{uid}`, one read; `null` only when absent. It (and the existing
    `ObserveProfile`) answers the STORED body, a `PROVISIONED` stub
    included — the adapter holds no rule. Today every web profile read
    answered `null` for the stub (`profileFrom`'s non-blank `firstName`
    test), so EVERY consumer maps `!Registration.isRegistered(user)` →
    `null` at its call site (§3.5): `AccountStateService`,
    `client-card.store`, `resolveCompanionNames`, and any P3 `loadProfile`
    user — one spec case per site, "a provisioned stub reads as no
    profile";
  - `WriteOwnProfile = <E>(userId: UserId, decide: (stored: User | null) =>
Result<OwnerProfileFields | null, E>) => Promise<Result<void, E |
RepositoryError>>` — reads `users/{uid}` and writes the answer's five
    keys with one `update` in ONE transaction; a `null` answer writes
    nothing; a refusal writes nothing. Its argument shape is the named
    entity slice `OwnerProfileFields` (F2-17), never a `Pick`.
  - The file's header ("Profile WRITES are the `updateProfile` callable,
    never a port here") is rewritten: until Phase 4 switches the sheet to
    the callable, the owner write is `WriteOwnProfile` (F2-5, F2-6).
- `governance.port.ts`: the `ObserveActiveImpersonation` doc re-keyed to
  `impersonationStatus` (#9) — no new type.
- `identity.port.ts`: the docs of `LoadTenant` (`lib/otp/tenant.ts`),
  `LoadOpenOtps` (#10's new keys, `otp-repository.port.ts`),
  `FindUserByDestination` (`firestore-user-repository.ts:175`),
  `OtpCrypto`, `SendOtp` (`console-otp-sender.ts`) re-pointed from the
  deleted legacy files to their successors (delta 7); `accounts.port.ts`'s
  `SearchUsers` doc likewise (`user-search.adapter.ts:62-63`); no
  signature change.
- `callables.ts`: `UpdateProfile: 'updateProfile'`.

**Bundles** (✱ = new or re-cut by P0; everything else exists on `3ff1793`
and is named, not changed):

| Port file            | Bundle                                              | Members                                                                                                                                                                               | Bound by (1:1)                                                                            |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `accounts.port.ts`   | ✱ `ProfilePorts`                                    | `observeProfile`, `loadProfile`, `writeOwnProfile`                                                                                                                                    | web token `PROFILE_PORTS`; web adapter `profilePorts(db)`                                 |
| `accounts.port.ts`   | ✱ `UserSearchPorts`                                 | `searchUsers`                                                                                                                                                                         | web token `USER_SEARCH_PORTS`; web adapter `userSearchPorts(db)`                          |
| `accounts.port.ts`   | `CallerRolesPorts`                                  | `loadCallerRoles`                                                                                                                                                                     | `firestoreJobPorts(db)` (with `BackfillJobPorts`)                                         |
| `accounts.port.ts`   | `AccountsPorts`                                     | `= ProfilePorts & UserSearchPorts & CallerRolesPorts` (✱ re-composed)                                                                                                                 | — (context suite)                                                                         |
| `accounts.port.ts`   | ✱ ~~`AccountReadPorts`~~                            | deleted — no consumer on `3ff1793`; its two members now sit in the two above                                                                                                          | —                                                                                         |
| `identity.port.ts`   | `CustomerPorts`                                     | `loadCustomerForUser`                                                                                                                                                                 | web token `CUSTOMER_PORTS` (flip 1)                                                       |
| `identity.port.ts`   | `AccountContactPorts`                               | `loadAccountContacts`                                                                                                                                                                 | `firestoreAccountPorts(db)` (flip 1)                                                      |
| `identity.port.ts`   | `TenantPorts`                                       | `loadTenant`                                                                                                                                                                          | new `singleTenantPorts(tenantId)`                                                         |
| `identity.port.ts`   | `OtpStorePorts`                                     | `loadOpenOtps`, `loadOtp`, `saveOtp`                                                                                                                                                  | new `firestoreOtpPorts(db)`                                                               |
| `identity.port.ts`   | `OtpDeliveryPorts`                                  | `sendOtp`                                                                                                                                                                             | `consoleOtpSender(log)` (re-typed, F2-18)                                                 |
| `identity.port.ts`   | `OtpCryptoPorts`                                    | `otpCrypto`                                                                                                                                                                           | `nodeOtpCryptoPorts()` / `fixedCodeOtpCryptoPorts()` (re-typed, F2-18)                    |
| `identity.port.ts`   | ✱ `UserLookupPorts`                                 | `findUserByDestination`                                                                                                                                                               | new `firestoreUserPorts(db)`                                                              |
| `identity.port.ts`   | ✱ `AuthUserLookupPorts`                             | `findAuthUserByDestination`                                                                                                                                                           | `authClaimsPorts(auth)` (with `AuthAdminPorts`)                                           |
| `identity.port.ts`   | ✱ `UserDirectoryPorts`                              | `= UserLookupPorts & AuthUserLookupPorts` (was a record spanning two adapters)                                                                                                        | — (suite)                                                                                 |
| `identity.port.ts`   | `AuthAdminPorts`                                    | `provisionAuthUser`, `mintCustomToken`, `setClaims`, `setDisplayName`                                                                                                                 | `authClaimsPorts(auth)`                                                                   |
| `identity.port.ts`   | ✱ `AuthDeploymentPorts`                             | `authDeployment: AuthDeployment` (configuration, as `TenantZonePorts`)                                                                                                                | the root's literal `{ authDeployment: AuthDeployment.DEFAULT }`                           |
| `identity.port.ts`   | `IdentityPorts`                                     | `= CustomerPorts & AccountContactPorts & TenantPorts & OtpStorePorts & OtpDeliveryPorts & OtpCryptoPorts & UserDirectoryPorts & AuthAdminPorts & AuthDeploymentPorts` (✱ += the last) | — (context suite)                                                                         |
| `governance.port.ts` | `ImpersonationReadPorts`                            | `observeActiveImpersonation`                                                                                                                                                          | web token `IMPERSONATION_READ_PORTS`; web adapter `impersonationReadPorts(db)`            |
| `governance.port.ts` | `AuditRowsPorts`                                    | `createAuditRows`                                                                                                                                                                     | `firestoreAuditPorts(db, tel)` (flip 1; the profile trigger)                              |
| `tx.port.ts`         | `CommitPorts`, `ClockPorts`, `HashPorts`, `IdPorts` | `commit`, `nowUtcMs`, `hash`, `nextId`                                                                                                                                                | `firestoreCommitPlan`, the root's clock, `cryptoPorts()` (re-typed `HashPorts & IdPorts`) |
| `telemetry.port.ts`  | `TelemetryPorts` = `LogPorts & ErrorTrackingPorts`  | `log`, `trackError`                                                                                                                                                                   | `consoleTelemetry()`                                                                      |

`authClaimsPorts(auth)` returns `AuthAdminPorts & AuthUserLookupPorts` (the
intersection of the two bundles it serves; the local `AuthClaimsPorts`
record is deleted, F2-18). `loadOtp` and `setClaims` keep their bundles but
have no pipeline caller after this flip (`verifyOtp` reads `otps/{id}`
through `ReadTx`; `completeRegistration` mints instead of setting claims, as
today) — listed in §10.13, not deleted.

**Entities:** `user.entity.ts` exports the named flat record (F2-17)

```ts
/** The owner-editable keys of `users/{uid}` — the rules' owner allowlist, verbatim. */
export type OwnerProfileFields = {
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: BirthDate | null;
} & SearchFields;
```

— no `Pick<User, …>`: it is a port's argument shape. The "until the
identity flip the stored bytes are today's" sentences of `user.entity.ts`,
`otp.entity.ts`, `impersonation-session.entity.ts`, `customer.entity.ts`
and `entities/collections.ts` are rewritten to the after-state;
`identity-entities.type-spec.ts` gains: `keyof OwnerProfileFields` is
exactly `'firstName' | 'lastName' | 'birthDate' | 'searchName' |
'searchPrefixes'` and every key is assignable to `User`'s, the provisioned
stub of `RegistrationSystem.provision` is a `User`, a `BLOCKED` user
narrows to `blockReason`.

**Errors** (F2-4): `primitives/identity-errors.data.ts` (+ spec) adds the
nine `IdentityErrorCode`s with factories and flat context fields —
`otpChannelMismatch(requested: IdentifierChannel, authStrategyKind:
string)`, `otpRateLimited()`, `otpNotFound()`, `otpDestinationCorrupted()`,
`otpAccountConflict()`, `registrationUnauthenticated()`,
`registrationForbidden()`, `registrationUserNotFound()`,
`registrationFieldMissing(field: string)`. **Law 8:** the primitives tier
imports nothing from `@core/components`, so `RegistrationField` and
`AuthStrategyKind` (both component dictionaries) never type a primitives
factory — the context fields are scalars, as `authStrategyUnknownField(received:
string)` already is; the pipelines/systems callers pass the component
values (string literals). `primitives/accounts-errors.data.ts` (+ spec) adds
`updateProfileUnauthenticated()`. `apps/functions/src/edge.ts` (owned by P0
for these rows and one type only: `EdgePorts = TelemetryPorts & ClockPorts`,
F2-18) adds their `IDENTITY_WIRE` / `ACCOUNTS_WIRE` rows and
`LEGACY_WIRE_CODE` entries (dotted, unique: `identity.otp.channel_mismatch`
`FailedPrecondition` (+ `requested`, `strategyKind` params), `identity.otp.rate_limited`
`ResourceExhausted`, `identity.otp.not_found` `NotFound`,
`identity.otp.destination_corrupted` `Internal`,
`identity.otp.account_conflict` `Internal`,
`identity.registration.unauthenticated` `Unauthenticated`,
`identity.registration.forbidden` `FailedPrecondition`,
`identity.registration.user_not_found` `FailedPrecondition`,
`identity.registration.field_missing` `InvalidArgument` (+ `field`),
`accounts.update_profile.unauthenticated` `Unauthenticated`). No i18n key is
added (flatten-spec §4.3: a row with no key today gets none).

**The new system** `systems/profile-edit.system.ts` (+ spec, + `systems/index.ts` line):

```ts
export type ProfileEdits = {
  readonly firstName?: string;   // absent = keep the stored one
  readonly lastName?: string;
  readonly birthDate?: string;   // 'YYYY-MM-DD'; absent = keep (no clearing, as today) — §3.2's stated exception
};
export const ProfileEditSystem = {
  // No `ageCheckDay(nowUtcMs)`: the boundary derives `ageDay` (F2-7).
  /** `FirstName.create`/`LastName.create` parity: trimmed, at least 2. */
  nameRefusals(firstName: string, lastName: string): readonly AccountsError[],
  /**
   * The owner edit: `stored` absent or not REGISTERED → ACCOUNTS_UPDATE_PROFILE_NOT_FOUND;
   * any field refusal (names, `AgeSystem.parseIso(birthDate, ageDay)`) →
   * ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED (the wrapper today's
   * `UpdateProfileValidationFailure` answers); else the five keys — names
   * trimmed, search keys from `SearchFieldsSystem.searchFields(first, last,
   * stored.phone, stored.email)` (the STORED contact, never the caller's) —
   * or `null` when all five equal the stored values (value-idempotent).
   */
  decide(stored: User | null, edits: ProfileEdits, ageDay: LocalDate):
    Result<OwnerProfileFields | null, AccountsError>,
  /**
   * The registration aggregate — `User.create`'s checks AND its
   * normalisation, so `RegistrationSystem.register` receives a branded
   * profile and no caller casts: the phone through
   * `PhoneSystem.parse(raw, null)` (parity with `PhoneNumber.create(raw)`,
   * no default country) → its `e164`; the e-mail through `Email.parse`
   * (trim + lower-case; `null` → `ACCOUNTS_EMAIL_INVALID`); the names
   * trimmed (`nameRefusals`); the roles non-empty and known
   * (`ACCOUNTS_USER_ROLES_EMPTY` / `ACCOUNTS_USER_ROLE_INVALID`,
   * `User.validateRoles`); the settled birth date re-checked against the
   * 16–120 window on `ageDay` in create mode (`AgeSystem`). Errors
   * collected in today's order: phone, first name, last name, e-mail,
   * roles, birth date. The pipeline hands the ok value to `register`.
   */
  registrationProfile(settlement: RegistrationSettlement, ageDay: LocalDate):
    Result<RegisteredProfile, readonly (AccountsError | PhoneError | IdentityError)[]>,
} as const;
```

Spec: purity; the cases of `libs/domain/accounts/src/lib/{first-name,last-name,user}.spec.ts`
that judge names, phone, e-mail, roles and the create-mode birth date
**copied, not moved** (the legacy specs keep running until Phase 4); the
web adapter's search-key cases (stored contact wins, name-only edit
recomputes all prefixes); the unchanged → `null` case; a `PROVISIONED`
stored user → not found; `registrationProfile`: a spaced phone
(`'+359 888 123 456'`) yields the E.164, a mixed-case e-mail yields the
lower-cased one, the error order above, and stub → registered changes
exactly `firstName`/`lastName` (+ `birthDate`/`email` when given), never
`phone`.

**Two more systems P0 owns** (pure, + specs, + `systems/index.ts` lines):

- `systems/registration.system.ts` gains
  `adoptStub(stored: User | null, uid: UserId, parsed: ParsedIdentifier):
Result<{ readonly user: User; readonly createStub: boolean },
IdentityError>` — F2-9's tx-2 decision: absent → `{ user:
provision(uid, parsed), createStub: true }`; `PROVISIONED` with the
  login channel's `phone`/`email` equal to `parsed.identifier` → `{ user:
stored, createStub: false }`; `REGISTERED`, or a contact mismatch →
  `IDENTITY_OTP_ACCOUNT_CONFLICT`. Spec: the four branches, purity.
- **new** `systems/customer-record.system.ts` —
  `CustomerRecordSystem.createsFor(resolved, stored, contacts, origin:
CustomerOrigin, nowUtcMs): readonly WriteOp[]`, flip 1's
  `customerCreates` body and create-when-absent decision lifted out of
  `pl:customer-records.pipeline.ts` (Law 3/4: a pipeline holds no business
  math), the path built from `Collections.Customers`. Its spec takes over
  `customer-records.pipeline.spec.ts`'s `customerCreates` cases (titles
  kept) plus one `REGISTRATION` origin case. `customer-records.pipeline.ts`
  keeps `customerIdsFor`, `readCustomers` and the retry: P0 generalises
  `isCustomerConflict` / `runWithCustomerRetry` to
  `isCreateConflict(result, collectionPrefixes)` /
  `runWithCreateRetry(run, collectionPrefixes)` (same semantics: ONE
  re-run on a commit-time `ALREADY_EXISTS` whose `path` starts with a
  listed prefix, the second answer final), with `runWithCustomerRetry`
  kept as the `[Collections.Customers]` specialisation; it deletes
  `customerCreates` and points its two callers
  (`book-appointment.pipeline.ts`, `edit-appointment.pipeline.ts`) at
  `CustomerRecordSystem.createsFor(…, CustomerOrigin.FirstBooking, …)` —
  no behaviour change, their specs untouched. P0 re-runs `git grep -n
'customerCreates'` before landing (empty outside `*.md`).

**Testing** (`libs/ecs-core/src/testing/`, + `index.ts` lines, + specs):
`port-doubles.ts` gains ONE double per bundle, each returning exactly its
bundle (the flip-1 convention, `memoryCustomerPorts(): CustomerPorts`):

| Double                                   | Returns                             | Behaviour                                                                                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memoryProfilePorts(users)`              | `ProfilePorts`                      | observe/load/write over a `Map<UserId, User>`; observe/load answer the entry AS STORED (a `PROVISIONED` stub included, as the adapter does — the consumer judges); `writeOwnProfile` runs the given decide against the entry and applies its five keys |
| `memoryUserSearchPorts(users)`           | `UserSearchPorts`                   | `searchPrefixes` contains, sorted by `searchName`, cut at `limit`                                                                                                                                                                                      |
| `memoryImpersonationReadPorts(sessions)` | `ImpersonationReadPorts`            | the admin's `ACTIVE` session or `null`                                                                                                                                                                                                                 |
| `memoryOtpStorePorts(world)`             | `OtpStorePorts`                     | `loadOpenOtps` (`destination ==`, unconsumed, `createdAtUtcMs >=`), `loadOtp`, `saveOtp` over the world's `otps` map                                                                                                                                   |
| `memoryUserLookupPorts(world)`           | `UserLookupPorts`                   | `findUserByDestination` over the world's `users` (field by `identifierChannel`)                                                                                                                                                                        |
| `memoryAuthUserLookupPorts(world)`       | `AuthUserLookupPorts`               | `findAuthUserByDestination` over the world's Auth users                                                                                                                                                                                                |
| `memoryAuthAdminPorts(world)`            | `AuthAdminPorts`                    | `provisionAuthUser` (answers `null` for a destination already held — the race or an orphan Auth user), `mintCustomToken` (records the claims), `setClaims`, `setDisplayName` (records)                                                                 |
| `recordingOtpDeliveryPorts()`            | `{ ports: OtpDeliveryPorts; sent }` | `sendOtp` records `(destination, code)`; a `failing` option answers a `PipelineError`                                                                                                                                                                  |
| `fixedOtpCryptoPorts()`                  | `OtpCryptoPorts`                    | the fixed code, a deterministic salt, a test hash, `codeMatches` by equality                                                                                                                                                                           |
| `fixedTenantPorts(tenantId?)`            | `TenantPorts`                       | `loadTenant` → the fixture tenant                                                                                                                                                                                                                      |

`memoryIdentityWorld(seed)` builds the ONE shared state (`otps`, `users`,
Auth users, minted claims) the world-parameterised doubles read, so a
provision is visible to the next lookup; it holds data only, never a port
member. A pipeline spec composes its `XPorts` by spreading the doubles —
`{ ...memoryTxPorts(store), ...memoryOtpStorePorts(world), … }` — and a
scripted member is an override typed `Partial<TheBundle>`. `AuthDeploymentPorts`
needs no double: a spec passes `{ authDeployment: AuthDeployment.DEFAULT }`
(or a strategy variant). `identity.fixtures.ts` gains
`provisionedUserFixture`, `registeredUserFixture`, `blockedUserFixture`,
`otpFixture`, `impersonationSessionFixture`. P1–P4 specs use these; nobody
re-implements a double.

**Pipelines barrel** `libs/ecs-core/src/pipelines/index.ts` is **P1's**
(delta 9): P1 adds `complete-registration`, `request-otp`, `update-profile`,
`verify-otp` (sorted) with the files themselves, so no package compiles
against a barrel line whose file is missing.

**Web tokens** `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`:
`PROFILE_PORTS = new InjectionToken<ProfilePorts>('PROFILE_PORTS')`,
`USER_SEARCH_PORTS = new InjectionToken<UserSearchPorts>('USER_SEARCH_PORTS')`,
`IMPERSONATION_READ_PORTS = new InjectionToken<ImpersonationReadPorts>('IMPERSONATION_READ_PORTS')`
— each typed by exactly one bundle of §3.1.1, beside `CUSTOMER_PORTS`.

### 3.2 Pipelines (all in `libs/ecs-core/src/pipelines/`, `@core/pipelines`)

Each is `(ports) => async (cmd) => Promise<Result<Out, E>>`. Its `XPorts`
type, exported from the pipeline file, is an **intersection of named
bundles of §3.1.1 and nothing else** (Law 9; `BookAppointmentPorts =
TxPorts & PolicyReadPorts & AccountContactPorts & AuditAppendPorts &
TelemetryPorts` is the model) — no `Pick`, no inline `{ … }` member, no
port function type declared in the pipeline:

```ts
export type RequestOtpPorts = TenantPorts &
  OtpStorePorts &
  OtpDeliveryPorts &
  OtpCryptoPorts &
  AuthDeploymentPorts &
  ClockPorts &
  IdPorts &
  TelemetryPorts;
export type VerifyOtpPorts = CommitPorts &
  ClockPorts &
  OtpCryptoPorts &
  UserLookupPorts &
  AuthUserLookupPorts &
  AuthAdminPorts &
  TelemetryPorts;
export type CompleteRegistrationPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  UserLookupPorts &
  TenantPorts &
  AuthAdminPorts &
  AuthDeploymentPorts &
  TelemetryPorts;
export type UpdateProfilePorts = CommitPorts & ClockPorts & TelemetryPorts;
```

(`CompleteRegistrationPorts` needs `HashPorts` for `CustomerId.forUser`;
`VerifyOtpPorts` needs no `IdPorts` — the stub's id is the Auth uid.)
Commands carry branded values only; the decoder (§3.3) builds them. **One
stated exception (Law 7.4):** a birth date (`ProfileEdits.birthDate`,
`completeRegistration`'s `fields.birthDate`) stays the raw `'YYYY-MM-DD'`
string until the pipeline (or the web store's decide), because its refusal
needs `ageDay` and today's aggregate reports it beside the name refusals in
one validation failure — branding it in the decoder would refuse the format
before the names and drop their errors. `AgeSystem.parseIso(raw, ageDay)` is
its smart constructor; it runs inside `ProfileEditSystem.decide` /
`registrationProfile`, never as a cast.

| File · factory                                               | Ports (bundle intersection)         | Read set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Write plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Idempotency                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request-otp.pipeline.ts` · `requestOtp`                     | `RequestOtpPorts` (above)           | none in a transaction (as today). Order frozen: (1) `OtpSystem.channelAccepts(authDeployment.strategy, cmd.otpDestinationType)` else `IDENTITY_OTP_CHANNEL_MISMATCH` (`email_link` refused too); (2) `ParsedIdentifier.parse(channel, cmd.rawDestination, PhoneSystem.parse(…, null))` else `IDENTITY_IDENTIFIER_INVALID`; (3) `loadOpenOtps(parsed.identifier, OtpSystem.resendWindowStartUtcMs(now))` → `OtpSystem.mayIssue` false → `IDENTITY_OTP_RATE_LIMITED`; (4) `loadTenant`                                                                                                                                                                                                                                                                                                                           | `saveOtp(OtpSystem.issue({ tenantId, destination: Identifier.of(cmd.rawDestination.trim()) (F2-10 — trimmed, as `Otp.validateDestination` stores it), otpDestinationType, otpPurpose: LOGIN, ttlMinutes, maxAttempts from the OTP strategy's policy }, { codeHash: hashCode(code, salt), salt }, now, nextId))` — a `Set` + `purgeAt`; then `sendOtp(parsed, code)` (a failure answers the send refusal; the saved challenge stays, as today). Answer `{ otpId, rawCode }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | none (a new challenge per request; the resend window is the throttle, as today)                                                                                                                                                                                                                               |
| `verify-otp.pipeline.ts` · `verifyOtp`                       | `VerifyOtpPorts` (above)            | **tx 1:** `otps/{otpId}`; absent → `IDENTITY_OTP_NOT_FOUND`; `codeMatches(cmd.code, otp.salt, otp.codeHash)` computed in the read half. **Outside:** re-parse the stored destination (F2-10) else `IDENTITY_OTP_DESTINATION_CORRUPTED`; `findUserByDestination(parsed)`. **tx 2 (new identity only):** `users/{uid}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | tx 1: `OtpSystem.attempt` → `WriteOp.update(otps/id, { attemptCount })` on a wrong code, `{ consumedAtUtcMs: now }` on success, nothing for consumed/expired/locked; the outcome answered AFTER the commit (F2-9). New identity: `provisionAuthUser(parsed)` → uid, or `null` → `findAuthUserByDestination` → uid (`null`/failure → the Auth failure, `token_minting_failure` on the wire); tx 2 (through `runWithCreateRetry(…, [Collections.Users])`): `RegistrationSystem.adoptStub(stored, uid, parsed)` decides for every uid (F2-9) — `createStub` → `WriteOp.create(users/uid, user minus id)`; present `PROVISIONED` with the same contact → no write; `REGISTERED` or a contact mismatch → `IDENTITY_OTP_ACCOUNT_CONFLICT`, nothing written (`token_minting_failure` on the wire). Then `mintCustomToken(uid, RegistrationSystem.claimsFor(user.registrationState, user.roles, otp.tenantId))` where `user` is the RETURNING user found outside, or on the NEW path `adoptStub`'s in-tx `user` — never a stub built outside tx 2. Answer `{ customToken, sessionKind: NEW when no user held the destination, else RETURNING }` | `otpId` + the in-tx attempt state (`attemptCount`/`consumedAtUtcMs` CAS by the transaction); Auth's unique phone/e-mail for the first-verification race; the stub created only when absent in tx 2, and a commit-time `ALREADY_EXISTS` on it re-runs tx 2 once (re-read → the winner's stub → no write; F1-5) |
| `complete-registration.pipeline.ts` · `completeRegistration` | `CompleteRegistrationPorts` (above) | Order frozen: `callerUserId === null` → `IDENTITY_REGISTRATION_UNAUTHENTICATED` (the decoder, before the payload); `RegistrationSystem.effectiveFields` → `missingField(authDeployment.strategy, …)` → `IDENTITY_REGISTRATION_FIELD_MISSING`; a non-blank birth date → `AgeSystem.parseIso(raw, ageDay)` (`ageDay = ZonedTimeSystem.toLocal(now, UTC_ZONE).localDate`, F2-7) → the `IdentityError` (wrapped on the wire as `registration_birth_date_invalid`); the identifier parse → `invalid_input` `'invalid identifier value'`; **outside:** `findUserByDestination` → `null` → `IDENTITY_REGISTRATION_USER_NOT_FOUND`, `user.id !== callerUserId` → `IDENTITY_REGISTRATION_FORBIDDEN`. **In tx:** `users/{uid}` (absent → user not found) and `customers/{CustomerId.forUser(uid, hash)}` in one `getAll` | `RegistrationSystem.settle(in-tx standing, fields, birthDate)` → `ProfileEditSystem.registrationProfile(settlement, ageDay)` → err → `user_validation_failed` aggregate; ok `profile` (phone E.164, e-mail lower-cased, names trimmed) → `WriteOp.set(users/uid, RegistrationSystem.register(stored, profile) minus id)` (the lifecycle slice of the read kept; F2-8) + `CustomerRecordSystem.createsFor(…, CustomerOrigin.Registration, now)` (the customer `Create` when absent, F2-7b, contacts from `profile`); the transaction runs through `runWithCustomerRetry`. **After the commit:** `setDisplayName(uid, Profile.fullName)` — Result IGNORED (as today); `mintCustomToken(uid, AuthClaims.active(tenant, RegistrationSystem.grantedRoles(roles)))` — a failure answers `claims_promotion_failure` (no `setClaims`: today's comment on the emulator conflict stands). Answer `{ customToken }`                                                                                                                                                                                                                                | `uid`-keyed `Set` of a value-idempotent body; the customer's deterministic id, created only when absent in the read; a commit-time `ALREADY_EXISTS` re-runs the transaction once (F1-5)                                                                                                                       |
| `update-profile.pipeline.ts` · `updateProfile`               | `UpdateProfilePorts` (above)        | in tx: `users/{callerUserId}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ProfileEditSystem.decide(stored, cmd.edits, ageDay)` (`ageDay` from `now` and `UTC_ZONE`, F2-7) → `WriteOp.update(users/uid, patch)` or no write; answer `{ changed: boolean }`. No audit row of its own: the `auditProfileChanges` trigger stays the only profile auditor (exactly one `PROFILE_UPDATED` row per real change, `verify:p0` (e))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | value-idempotent `Update` (the same edits twice → the second plan is empty and no trigger row)                                                                                                                                                                                                                |

Each transactional pipeline's spec asserts the exact `WriteOp[]` that reached
`commit` (`memoryTxPorts`, `memoryCommitPlan`, `pinnedNowUtcMs`,
`sequentialIds`, `fixtureHash`, `recordingTelemetry` from `@core/testing`);
`verify-otp`'s also asserts that a wrong code's plan commits AND the answer
is the refusal, that an adopted uid whose doc carries another contact, and
one whose doc is `REGISTERED`, both write nothing and answer
`IDENTITY_OTP_ACCOUNT_CONFLICT`, that an adopted `PROVISIONED` doc with the
same contact mints from the read with no write, and that a scripted commit
answering `ALREADY_EXISTS` once on the stub `Create` settles on the second
run with no write; `request-otp`'s that a padded e-mail (`' a@b.com '`)
and a padded phone store the trimmed `destination`; `complete-registration`'s that the customer's path is in the
snapshot's read keys and that the stub → registered `Set` changes exactly the
audited fields today's `set` changes (the trigger's `changedProfileFields`
over before/after), and that a spaced login phone and a mixed-case form
e-mail land in `users` (and in the `REGISTRATION` customer) as E.164 and
lower-case.

### 3.3 Server adapters, the wire, the composition root (owner P1)

Server adapters (`apps/functions/src/adapters/`), each a logic-free factory
whose return type is ONE bundle of §3.1.1 — or, when it serves several, their
`&` — never a `Pick`, never a record or alias declared in the adapter file;
each with a spec (over `FakeProjectionFirestore` for Firestore):

| File                                   | Export → bundle                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firestore-otps.adapter.ts` (new)      | `firestoreOtpPorts(db): OtpStorePorts` — `loadOpenOtps`: `destination ==`, `consumedAtUtcMs == null`, `createdAtUtcMs >=` (#10); `loadOtp`: `get`; `saveOtp`: `set` of the body + `purgeAtFor`                                                                                                                  |
| `firestore-users.adapter.ts` (new)     | `firestoreUserPorts(db): UserLookupPorts` — `where(phone \| email, '==', parsed.identifier).limit(1)`, the field by `identifierChannel`                                                                                                                                                                         |
| `tenant.adapter.ts` (new)              | `singleTenantPorts(tenantId: TenantId): TenantPorts` — no cast and no literal in the adapter: `main.ts` declares `const DEFAULT_TENANT = TenantId.parse('creativo')` (today's `lib/otp/tenant.ts` value), a `defect` on failure as the unreadable-clock `nowUtcMs` is, beside `WIRE_ZONE`, and passes the brand |
| `auth-claims.adapter.ts` (edit, F2-18) | `authClaimsPorts(auth): AuthAdminPorts & AuthUserLookupPorts` — the local `AuthClaimsPorts` record goes; the "keeps serving the `lib/otp/*` handlers until the identity flip" doc goes                                                                                                                          |
| `console-otp-sender.adapter.ts` (edit) | `consoleOtpSender(log: Log): OtpDeliveryPorts` — `{ sendOtp }`, today's line word for word                                                                                                                                                                                                                      |
| `otp-crypto.adapter.ts` (edit)         | `nodeOtpCryptoPorts(): OtpCryptoPorts`, `fixedCodeOtpCryptoPorts(): OtpCryptoPorts` — `{ otpCrypto }`; `OTP_FIXED_CODE` kept; the "stay until the identity flip" doc goes                                                                                                                                       |
| `crypto.adapter.ts` (edit, F2-18)      | `cryptoPorts(): HashPorts & IdPorts` — the local `CryptoPorts` record goes                                                                                                                                                                                                                                      |
| `firestore-ttl.adapter.ts` (edit)      | the `otps` group (F2-11)                                                                                                                                                                                                                                                                                        |
| `firestore-ports.ts` (edit)            | `FirestorePorts` += `ReturnType<typeof firestoreOtpPorts>` (= `OtpStorePorts`) and `ReturnType<typeof firestoreUserPorts>` (= `UserLookupPorts`), spread in `firestorePorts`; the local `Primitives` record becomes the parameter type `ClockPorts & HashPorts & IdPorts` (F2-18)                               |

Edge (`apps/functions/src/wire/identity.wire.ts`, + spec pinning today's
status and `details` byte for byte, incl. every `reason` string and the
`devCode` gate — never the `HttpsError` message, which becomes the wire code
(F2-3)):
`decodeRequestOtp` (`{ channelKey?, kind, value }`: `kind === 'phone'` → SMS, anything else — absent or garbage — → e-mail, never refused; then today's order: `'missing or empty destination'` (the untrimmed `value` blank) before the channel check, then `'invalid phone destination'` / `'invalid email destination'`; `rawDestination` handed on for F2-10's single trim; spec cases for a garbage `kind` and a padded value), `decodeVerifyOtp`, `decodeCompleteRegistration`,
`decodeUpdateProfile` (caller uid from `request.auth`; unauthenticated →
`ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED`; each field string-or-absent else
validation failed), `encodeRequestOtpAnswer(answer, exposeDevCode)`,
`encodeVerifyOtpAnswer` (`SessionKind` → `'new' | 'returning'`),
`encodeCompleteRegistrationAnswer`, `encodeUpdateProfileAnswer`, and
`requestOtpRefusal`, `verifyOtpRefusal`, `completeRegistrationRefusal`
(ecs-core error → today's `LegacyWireCode` struct: `IDENTITY_OTP_CHANNEL_MISMATCH` →
`otp_channel_mismatch` `FailedPrecondition` with params `requested`
(`'phone' | 'email'`, from the `IdentifierChannel`) and `strategyKind` (the
legacy lowercase kind, `'phone_otp'` for `PHONE_OTP`), pinned by a spec case;
`IDENTITY_OTP_ACCOUNT_CONFLICT` → `token_minting_failure`; `IDENTITY_OTP_WRONG_CODE`
→ `otp_incorrect_code`, `IDENTITY_IDENTIFIER_INVALID` → `invalid_input` with
today's reason, `PipelineError` from Auth → `token_minting_failure` /
`claims_promotion_failure`, `RepositoryError` → `repository_failure`, the
send failure → `otp_send_failure`, the registration aggregate →
`user_validation_failed` `{ errors: [{ code, params }] }` with today's nested
codes, the birth-date refusal → `registration_birth_date_invalid` `{ code,
errors: [cause] }`).

`main.ts`: `requestOtpChallenge`, `verifyOtpChallenge`,
`completeRegistration` become `callableEdge` rows over the pipelines (the
`bookingCallable` shape: decode → run → encode / refuse), keeping their names
and options byte-identical; **new** export `updateProfile` (30 exports) over
`root.ports` (`UpdateProfilePorts` ⊂ the server ports). `root.otp` /
`root.auth` are replaced by ONE lazily built identity bundle, so a booking
callable still never initialises Admin Auth (today's `once` split):

```ts
const identityPorts = once(() => ({
  ...serverPorts(), // CommitPorts, ClockPorts, HashPorts, IdPorts, OtpStorePorts, UserLookupPorts, TelemetryPorts, …
  ...authClaimsPorts(adminAuth()), // AuthAdminPorts & AuthUserLookupPorts
  ...consoleOtpSender(telemetry.log), // OtpDeliveryPorts — the login-OTP sender, never a campaign sender
  ...(process.env['FUNCTIONS_EMULATOR'] === 'true'
    ? fixedCodeOtpCryptoPorts()
    : nodeOtpCryptoPorts()), // OtpCryptoPorts
  ...singleTenantPorts(DEFAULT_TENANT), // TenantPorts
  authDeployment: AuthDeployment.DEFAULT, // AuthDeploymentPorts
}));
```

Each identity callable hands `identityPorts()` to its pipeline factory; the
pipeline's own `XPorts` intersection is what type-checks it (no root-side
alias). `primitives` becomes `{ nowUtcMs, ...cryptoPorts() }` typed
`ClockPorts & HashPorts & IdPorts`. `legacyCallable` keeps one user
(`publishStreakDefinition`, flip 3). `apps/functions/tsconfig.app.json`
drops the references to `libs/domain/models`, `libs/domain/identity` and
`libs/application/identity` (`pnpm nx sync` writes them; re-check each with
`git grep` at integration; `libs/domain/accounts` stays for
`lib/booking/caller-roles.ts`).

### 3.4 Web bundles (`libs/infrastructure/**`, owner P2)

| New / rewritten file               | Export (`(db) => bundle`)                                                                                                                                                                                                                                                                                                                                                                                    | Replaces (deleted)                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `wa:accounts.adapter.ts` (new)     | `profilePorts(db): ProfilePorts` — `observeProfile` (`onSnapshot` of `users/{uid}`, `{ id, ...data }`, through `subscribeWithRetry`), `loadProfile` (`getDoc`), `writeOwnProfile` (`runTransaction`: read, `decide`, `tx.update(ref, patch)` of the five keys only — never a set, F2-6); `userSearchPorts(db): UserSearchPorts` — `searchPrefixes array-contains prefix`, `orderBy searchName`, `limit` (#8) | `wa:profile.adapter.ts` (`FirestoreProfileAdapter`), `wa:user-search.adapter.ts` (`FirestoreUserSearchAdapter`) |
| `wa:impersonation.adapter.ts` (rw) | `impersonationReadPorts(db): ImpersonationReadPorts` — `observeActiveImpersonation` (`adminUserId ==`, `impersonationStatus == 'ACTIVE'`, limit 1, #9)                                                                                                                                                                                                                                                       | `FirestoreImpersonationAdapter`                                                                                 |

`firestore.adapters.ts` exports the three new names and drops the three
classes; `firestore-paths.ts` loses `usersCollection`, `userDocRef`,
`impersonationSessionDocRef`, `impersonationSessionsCollection` (no caller
left; adapters use `Collections.*` as flip 1's do).
`libs/infrastructure/firebase-app/src/lib/auth-state.service.ts` (+ spec)
and its `index.ts` line are deleted (F2-12).
`wa:contact-change.adapter.ts`'s comment naming `ProfilePort` names
`ProfilePorts.writeOwnProfile` instead (delta 6; the adapter itself dies in
Phase 4, D12(b)). Each web factory returns its token's bundle by name
(`customerPorts(db): CustomerPorts` is the model); no feature or spec
re-aliases a bundle.

`cfg` rows (owner P2), `provideLazyPort` factory form as flip 1:
`PROFILE_PORTS` (`observeProfile: 'observable'`, `loadProfile: 'promise'`,
`writeOwnProfile: 'promise'`), `USER_SEARCH_PORTS` (`searchUsers:
'promise'`), `IMPERSONATION_READ_PORTS` (`observeActiveImpersonation:
'observable'`), each `onLoadError: ecsDataUnavailable`.

### 3.5 Store fields (owners P3, P4) — what "re-typed" means

- `AccountStateService.account: Signal<User | null>` — the flat `User` of
  `@core/entities`, **`null` while absent or `PROVISIONED`**
  (`Registration.isRegistered`), exactly today's `profileFrom` rule.
- **Every** `loadProfile` / `observeProfile` consumer applies the same rule
  at its call site — `!Registration.isRegistered(user)` → `null` — because
  the port answers the stored body (§3.1.1): `AccountStateService` (P3),
  `client-card.store` `loadAll` (the card's gate) and
  `staff-dashboard.ts` `resolveCompanionNames` (P4), and any P3 store that
  reads a profile. One spec case per site: "a provisioned stub reads as no
  profile".
- Ids: legacy `UserId.create(raw)` (the `@creativo/domain/*` class) →
  `UserId.parse(raw)` from `@core/primitives` (or the principal's already
  branded uid where it carries one); a failed parse takes today's skip /
  `null` path; never an `as UserId` cast. Sites: `account-state.service.ts`,
  `onboarding-flow.store.ts` (2), `profile.store.ts`,
  `session-identity.service.ts` [P3]; `client-card.store.ts`,
  `staff-dashboard.ts` (2) and `staff-dashboard.spec.ts` [P4]. Every
  `User` / `UserId` import from `@creativo/application/accounts` in a P3/P4
  file moves to `@core/entities` / `@core/primitives`.
- `profileCompletion(user, hasPhoto)`
  (`libs/application/accounts/src/lib/read-models/profile-completion.ts`)
  takes the flat `User`: `profileOf` becomes `{ birthDate: user.birthDate }`;
  the lowercase `ProfileCompletionKey`s (`'name' | 'phone' | 'birthday' |
'photo'`) stay, so the `account-completion-<key>` test ids, the
  `account.completion.items.<key>` i18n keys and
  `e2e:account-dashboard.spec.ts`'s `account-completion-birthday` selector
  are unchanged; its spec's fixture becomes `registeredUserFixture`.
- Form drafts in the files P3 rewrites (`client-profile.ts`,
  `client-onboarding.ts`, `onboarding-flow.store.ts`): `FirstName.create` /
  `LastName.create` → `ProfileEditSystem.nameRefusals` (the one name rule,
  so page and store cannot drift); `BirthDate.create(parts, today)` →
  `BirthDate.fromParts(parts)` + `AgeSystem.ageOn` / `windowRefusal` on the
  boundary-derived `ageDay` (F2-7) — the legacy `ZonedDateTime` `today`
  goes. The words on screen do not change (the `errors.<errorCode>` keys
  below).
- Legacy method → flat read, everywhere: `.fullName()` → `Profile.fullName(user)`;
  `.firstName.value` → `user.firstName`; `.phone.value` → `user.phone`;
  `.phone.formatInternational()` → `PhoneSystem.formatInternational(user.phone)`;
  `.email?.value` → `user.email`; `.birthDate?.toISODate()` → `user.birthDate`;
  `user.status` → `user.accountStatus` (+ `blockReason`,
  `blockedUntilUtcMs`; the client card's `statusOf` shim goes, it reads the
  `AccountLifecycle` slice off the user).
- Errors a store hands its template: today's string code becomes the
  struct's `errorCode` (`ACCOUNTS_UPDATE_PROFILE_NOT_FOUND`,
  `ACCOUNTS_UPDATE_PROFILE_VALIDATION_FAILED`, `REPOSITORY_*`), whose
  `errors.<errorCode>` keys exist with today's text verbatim (flatten-spec
  §4.3; `translateDomainError` reads both shapes). The words on screen do
  not change; a spec per store pins one.

---

## 4. Packages

Run order by **wave**: **wave 0 = P0 alone** (the ecs-core vocabulary every
other package compiles against; it lands green on its own gate) → **wave 1 =
P1–P5 in parallel** → integration (§8). No dependency forces a later wave:
P1–P5 compile only against P0's types, doubles and tokens; what one wave-1
package needs from another is runtime-only (P5's `verify:p0` (e) calls P1's
`updateProfile`; the web stores reach P2's adapters through `cfg`) and is
proven by the integrator. Ownership is disjoint by file; a directory listed
with `/**` is owned whole (every file in it that the re-type breaks belongs
to that package, listed or not). A package never edits another package's
file; a needed change is reported to the integrator. Every package obeys
Law 9 in what it writes: bundles by name, adapters returning bundles, no
`Pick`/`Omit` of a `*Ports` type, no port type outside the ports tier
(`pnpm nx run-many -t lint` reports `creativo/no-sliced-ports`).

### P0 — ecs-core vocabulary and shared contracts · wave 0

**Change:** `libs/ecs-core/src/primitives/{identity-errors,accounts-errors}.data.ts` (+ specs);
`libs/ecs-core/src/entities/{user,otp,impersonation-session,customer}.entity.ts`,
`entities/collections.ts`, `entities/identity-entities.type-spec.ts`;
`libs/ecs-core/src/ports/{accounts,governance,identity}.port.ts`,
`ports/callables.ts`; `libs/ecs-core/src/systems/index.ts`;
`libs/ecs-core/src/systems/registration.system.ts` (+ spec: `adoptStub`;
its doc's pointers to the deleted use cases rewritten to the pipelines);
`libs/ecs-core/src/pipelines/customer-records.pipeline.ts` (+ spec:
`customerCreates` lifted out, `runWithCreateRetry` generalised, F2-7b) and
its two callers `libs/ecs-core/src/pipelines/{book-appointment,edit-appointment}.pipeline.ts`
(the call re-pointed to `CustomerRecordSystem.createsFor(…,
CustomerOrigin.FirstBooking, …)`; their specs untouched — NOT the
pipelines barrel, which stays P1's);
`libs/ecs-core/src/systems/audit.system.spec.ts` (the "ignores fields other
writers own" case re-seeded with the flat lifecycle keys — `accountStatus`,
`registrationState`, `blockReason`, `blockedUntilUtcMs` — same title, same
`[]` answer, proving a stub → registered `Set` adds no audited field);
the after-state docs of `libs/ecs-core/src/components/{otp-destination-type,otp-purpose,session-kind,auth-claims}.data.ts`
and `libs/ecs-core/src/systems/search-fields.system.ts` (the "stored bytes
stay lowercase until the identity flip, the shims converting" sentences,
and pointers to `firestore-otp-repository.ts`,
`firebase-auth-token-adapter.ts`, `profile.adapter.ts`,
`firestore-user-repository.ts`; `session-kind`'s wire stays lowercase until
Phase 4, F2-3);
`libs/ecs-core/src/testing/{port-doubles,identity.fixtures}.ts` (+ specs),
`testing/index.ts`;
`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`;
`apps/functions/src/edge.ts` (the F2-4 rows and `EdgePorts =
TelemetryPorts & ClockPorts` only).
**New:** `libs/ecs-core/src/systems/profile-edit.system.ts` (+ spec),
`libs/ecs-core/src/systems/customer-record.system.ts` (+ spec).
**Brief:** §3.1 verbatim — the §3.1.1 bundle map (re-cut `AccountsPorts`
into `ProfilePorts` + `UserSearchPorts` + `CallerRolesPorts`, delete
`AccountReadPorts`; re-cut `UserDirectoryPorts` into `UserLookupPorts &
AuthUserLookupPorts`; add `AuthDeploymentPorts` and fold it into
`IdentityPorts`), `OwnerProfileFields` as a named record (F2-17), the
per-bundle doubles, the nine scalar-context error factories (no component
type in primitives, Law 8), `ProfileEditSystem` with no instant input
(F2-7), `registrationProfile`, `adoptStub`, the `CustomerRecordSystem`
lift (flip 1's booking/edit specs prove it changes nothing). Before landing, `git grep -nE
"(AccountReadPorts|UserDirectoryPorts)\b"` outside the ports tier must be
empty (it is on `3ff1793`). Gate on its own: `pnpm nx typecheck ecs-core`,
`pnpm nx test ecs-core --coverage`, `pnpm nx lint ecs-core`,
`pnpm nx run verify-tools:layering --skip-nx-cache`,
`pnpm nx run-many -t typecheck --skip-nx-cache` (baseline reds only — the
barrel no longer lists missing pipelines, delta 9),
`pnpm nx test functions -- edge.spec` (the new rows keep "one rule per code"
green). Land before wave 1 starts.

### P1 — server identity: pipelines, adapters, wire, root, deletions · wave 1

**New:** `libs/ecs-core/src/pipelines/{request-otp,verify-otp,complete-registration,update-profile}.pipeline.ts` (+ `.pipeline.spec.ts` each);
`apps/functions/src/adapters/{firestore-otps,firestore-users,tenant}.adapter.ts` (+ specs);
`apps/functions/src/wire/identity.wire.ts` (+ spec);
`apps/functions/src/integration/{verify-otp,complete-registration,update-profile}.integration.spec.ts`.
**Change:** `libs/ecs-core/src/pipelines/index.ts` (the four lines, delta 9)
(NOT `customer-records.pipeline.ts` or its callers: P0 lifts
`customerCreates` into `CustomerRecordSystem` and generalises the retry,
F2-7b; P1 only calls them);
`apps/functions/src/adapters/{auth-claims,console-otp-sender,otp-crypto,crypto}.adapter.ts` (+ their specs; F2-18 — `crypto.adapter.spec.ts` and `otp-crypto.adapter.spec.ts` pin the legacy oracles' outputs as literal vectors before the oracles are deleted, delta 5);
`apps/functions/src/adapters/{firestore-ttl.adapter,firestore-ports}.ts` (+ specs);
`apps/functions/src/main.ts`, `main.spec.ts`, `edge.spec.ts` (floors, §7.2);
`apps/functions/tsconfig.app.json`; `libs/application/identity/src/index.ts`
(barrel lines of the deleted ports); `libs/application/identity/tsconfig.lib.json`
(the `../../domain/models/tsconfig.lib.json` reference dropped — its only
importers are the four ports P1 deletes; `pnpm nx sync` would write the same); `tools/verify/p0/functions-deps.baseline.json`
(re-recorded only if `check-functions-deps.mjs` says the generated
`package.json` shrank).
**Delete:** §7.1's server list.
**Brief:** §3.2 and §3.3. Each pipeline exports its `XPorts` exactly as the
§3.2 block spells it (intersections of named bundles); each adapter returns
its §3.3 bundle. Copy every behaviour from the deleted use cases and
handlers, case by case (§5.4 ledger). The three OTP callables' wire is
pinned by `identity.wire.spec.ts` against the deleted handlers' `toHttpsError`
switch tables before they go (status and `details`; the message becomes
the wire code, F2-3). `requestOtp` stores the trimmed destination (F2-10);
`verifyOtp`'s tx 2 decides through `adoptStub` and runs under
`runWithCreateRetry` (F2-9); `completeRegistration` builds its profile with
`registrationProfile` and its customer with `CustomerRecordSystem.createsFor`
(`REGISTRATION`); `main.ts` declares `DEFAULT_TENANT` by `TenantId.parse`
(§3.3). The emulator specs need `firestore` + `auth`
(`pnpm run test:emulator` already starts both): `verify-otp` — wrong code
increments and locks out at `maxAttempts`, two concurrent first
verifications of one phone → one Auth user, one stub, both sign in to the
same uid (whichever tx 2 loses the `Create` re-runs and settles); an orphan
Auth user (Auth holds the phone, no `users` doc) → the stub created and the
sign-in adopted; an Auth user whose `users` doc carries another contact →
`token_minting_failure`, nothing written; `complete-registration` — the registered `Set`, the
`REGISTRATION` customer with `userId == uid`, a re-run writes the same body
and no second customer, a forbidden uid writes nothing; `update-profile` —
one write, the search keys from the stored contact, an identical second
call writes nothing. Pipeline specs build their ports by spreading P0's
per-bundle doubles over one `memoryIdentityWorld`.

### P2 — web data layer (`libs/infrastructure/**`, `cfg`) · wave 1

**New:** `libs/infrastructure/firestore/src/lib/accounts.adapter.ts` (+ `.spec.ts`, + `.integration.spec.ts`).
**Change:** `libs/infrastructure/firestore/src/lib/impersonation.adapter.ts` (+ `.spec.ts`, `.integration.spec.ts`),
`firestore.adapters.ts`, `firestore-paths.ts`,
`contact-change.adapter.ts` (the one comment, delta 6);
`libs/infrastructure/firebase-app/src/index.ts`,
`libs/infrastructure/firebase-app/tsconfig.{lib,spec}.json` (the
`../../domain/models/tsconfig.lib.json` references dropped — the only
importer, `auth-state.service.ts`, is deleted here; `pnpm nx sync` would
write the same);
`apps/web/src/app/app.config.ts`, `apps/web/src/app/app.spec.ts`.
**Delete:** `libs/infrastructure/firestore/src/lib/{profile.adapter,profile.adapter.spec,profile.adapter.integration.spec,user-search.adapter,user-search.adapter.spec}.ts`;
`libs/infrastructure/firebase-app/src/lib/{auth-state.service,auth-state.service.spec}.ts`.
**Brief:** §3.4. `profilePorts(db): ProfilePorts`, `userSearchPorts(db):
UserSearchPorts`, `impersonationReadPorts(db): ImpersonationReadPorts` —
each 1:1 with its P0 token and its `cfg` factory row. The adapters spread
`snap.data()` (Law 5) — no `reconstitute`, no `accountStatusFromDocument`;
`observeProfile`/`loadProfile` answer the stored body, a `PROVISIONED` stub
included (`null` only when absent) — the stub → `null` rule moves to the
consumers (§3.5), with an adapter spec case "a stub is answered as stored".
The integration specs keep the deleted ones' query and transaction cases
(owner write of the five keys admitted, a stub refused by `decide`, the live
snapshot delivering a server-side `accountStatus` change, the #8 search
order, the #9 active session) against the flat seeds. `app.spec.ts`
provides `PROFILE_PORTS` with `memoryProfilePorts([])`. Note:
`firestore.rules.integration.spec.ts` in the same folder is **P5's**.

### P3 — web client surfaces and the shell · wave 1

**Own whole:** `libs/features/client/account-state/**`,
`libs/features/client/profile/**`, `libs/features/client/onboarding/**`,
`libs/features/client/booking/**`, `libs/features/client/account/**`,
`libs/features/client/appointments/**`, `libs/features/shared/shell/**`;
and the three spec files
`libs/features/marketing/{careers,courses,events}/src/lib/marketing-*/marketing-*.spec.ts`
(provider swap only); and the read model
`libs/application/accounts/src/lib/read-models/profile-completion.ts`
(+ `profile-completion.spec.ts`) — re-typed to the flat `User` of
`@core/entities`, lowercase keys kept (§3.5, delta 11). Expected edits: `account-state.service.ts`
(`inject(PROFILE_PORTS).observeProfile`), `profile.store.ts`,
`client-profile.ts` (+ `.html`), `onboarding-flow.store.ts`,
`client-onboarding.ts` (the draft checks, §3.5),
`booking-contact-sheet.ts` (`writeProfile` → `writeOwnProfile`, delta 4),
`booking-review-step.ts`, `session-identity.service.ts` and the specs of
§2's provider list (plus `client-account.spec.ts`,
`client-appointments.spec.ts`, `session-identity.service.spec.ts`, which
build a legacy `User`).
`apps/web/src/app/shell/session-expiry.service.ts` reads only `principal()`
and needs no edit (report it if it does).
**Brief:** §3.5; the three owner-write sites of §2 become the
`writeOwnProfile` + `ProfileEditSystem.decide` call; `ProfileStore.saveName`
takes the two trimmed strings; the pages and the onboarding component judge
their drafts with `ProfileEditSystem.nameRefusals` and `BirthDate.fromParts`

- `AgeSystem` on `ageDay` (§3.5 — "convert what you touch": no
  `FirstName.create` / `LastName.create` / `BirthDate.create` survives in a P3
  file, §6 gates it); ids by `UserId.parse`; every profile read maps a
  `PROVISIONED` stub to `null` (§3.5). Specs swap `PROFILE_PORT` for
  `PROFILE_PORTS` with `memoryProfilePorts` (a scripted member overrides a
  spread of it, typed `Partial<ProfilePorts>`); every store spec keeps its
  cases (a renamed `code` expectation becomes the `errorCode`, same words).
  Visual: the `pnpm run dev` smoke of §8 (profile page, onboarding birthday
  step, booking contact sheet's «save to profile», the menu's monogram).

### P4 — web staff surfaces · wave 1

**Own whole:** `libs/features/staff/client-card/**`,
`libs/features/staff/dashboard/**`.
Expected edits: `client-card.store.ts` (`inject(PROFILE_PORTS, { optional:
true })`, `getProfile` → `loadProfile`), `client-card.presenter.ts`,
`glance.presenter.ts` (+ their specs), `src/testing/{client-card.fixtures,achievements-pages.rig}.ts`
(`InMemoryProfilePort`/`HeldProfilePort` → `memoryProfilePorts` and a held
variant over it, typed `ProfilePorts` — a `PortDouble<ProfilePorts>` beside
flip 1's `PortDouble<CustomerPorts>`), their specs; `staff-dashboard.ts`
(`resolveCompanionNames` over `PROFILE_PORTS.loadProfile`, `runClientSearch`
over `USER_SEARCH_PORTS.searchUsers` with `SearchFieldsSystem.normalizeQuery`
and limit 20, F2-15), `staff-dashboard.spec.ts`, `staff-visit-editor.spec.ts`.
**Brief:** §3.5 and F2-15. The pause badge reads `accountStatus` /
`blockReason` / `blockedUntilUtcMs` off the user; the option builder keeps
today's label (written name, else `searchName`), phone display
(`PhoneSystem.formatInternational`) and `meta`/`email`. A feature helper
that needs only the profile read takes `ports: ProfilePorts`, never a slice.
The port answers the stored body: `client-card.store` `loadAll` and
`resolveCompanionNames` map `!Registration.isRegistered(user)` → `null`
(today's "no profile" for a stub — the card never renders a stub, no
`formatInternational(null)`), one spec case each; ids by `UserId.parse`,
never a cast (§3.5).
Baseline reds of `staff-client-card` / `staff-dashboard` typecheck
(spec-only) must not grow.

### P5 — data plane: rules, indexes, seed, e2e, P0 proofs, runbook · wave 1

**Change:** `firestore.rules` (comments, F2-14); `firestore.indexes.json`
(#9, #10, `users.roles` override); `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`;
`tools/seed/fixtures.mjs` (`userDocumentOf` and the local `searchFields`
copy removed, the plan hands the users builder its rows);
`tools/seed-dev-catalog.mjs` (staff account + client profiles from the
users fixtures); `tools/seed/load-domain.mjs` (+ `load-domain.spec.mjs`:
`users` in `SEED_PLAN_MODULES`); `tools/seed/seed-data.spec.mjs` (the
"every account on a seat has a profile registration would accept" case
re-targeted to `ProfileEditSystem.registrationProfile(…, ageDay).ok`);
`tools/seed/fixtures/README.md`; `apps/web/e2e/support/seed-firestore.ts`
(`seedUserProfile` writes `satisfies Omit<User, 'id'>` — an entity, not a
port — search keys from `SearchFieldsSystem.searchFields`; the
`FirestoreProfileAdapter` comment rewritten); `tools/verify/p0/verify-p0.mjs`
(+ `tools/verify/p0/README.md`); `docs/architecture/firestore-runbook.md`;
`docs/architecture/flatten-spec.md` (§2.3: one line recording the UTC age
day as an owner-acknowledged exception tied to this plan's §10.1, F2-7).
**New:** `tools/seed/fixtures/users.fixtures.ts` — `staffAccountBody`,
`clientUserBody(contact, birthDate)` (`REGISTERED`, `accountStatus:
'ACTIVE'`, `roles`, search keys from `SearchFieldsSystem.searchFields`), each
`satisfies Body<User>`.
**Brief:** the rules spec seeds flat bodies: `registeredUser()` with
`registrationState: 'REGISTERED'`, `accountStatus: 'ACTIVE'`; the stub is
`RegistrationSystem.provision`'s body (every key, `firstName: null`); the
"server-written status" cases use the `BLOCKED` variant keys (`accountStatus`,
`blockReason`, `blockedUntilUtcMs`) — same verdicts, same case titles with
"status" read as "account status". No rule line changes, so no new case.
`verify-p0.mjs`: the sysadmin body flat (`satisfies`-equivalent shape:
`registrationState: 'REGISTERED'`, `accountStatus: 'ACTIVE'`, `searchName`,
`searchPrefixes`); check (e) **both ways** (F2-5): rename by
`ownerUpdate(users/{uid}, { firstName: renamed })` → exactly one
`PROFILE_UPDATED` row with `profileFields ['firstName']`; restore by
`callable('updateProfile', client, { firstName: original })` → answer
`{ changed: true }` and exactly one row; both rows hold no value; and each
row's actor is asserted — the user for the owner rename, `Actor.system(ADMIN_SDK)`
for the callable restore (the §10.15 default; whatever the owner rules there
is what (e) pins). Runbook:
§1.1 rows for `users`/`otps`/`impersonationSessions` rewritten to §2 of this
plan (bundle names included), §2.1 `otps` "successor" =
`firestore-otps.adapter.ts` + `purgeAtFor` (done), §4.0 lists `W2`/`K2`/`T2`
and the Law 9 lists replaced by §6's, §4.2 = §6 (step 1's
`booking-core.spec.ts` exclusion included, delta 10), §4.6 unchanged.

---

## 5. Specs

### 5.1 Deleted (cases live elsewhere; §5.4's ledger proves each)

| Deleted spec (cases)                                                                       | Owner | Successor(s) holding its cases                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn:lib/otp/request-otp.spec.ts` (5)                                                       | P1    | `fn:wire/identity.wire.spec.ts` (status + details per code, `devCode` emulator gate), `fn:main.spec.ts`                                                    |
| `fn:lib/otp/verify-otp.spec.ts` (7)                                                        | P1    | `fn:wire/identity.wire.spec.ts`, `pl:verify-otp.pipeline.spec.ts`                                                                                          |
| `fn:use-cases/request-otp.use-case.spec.ts` (8)                                            | P1    | `pl:request-otp.pipeline.spec.ts`                                                                                                                          |
| `fn:use-cases/verify-otp.use-case.spec.ts` (10)                                            | P1    | `pl:verify-otp.pipeline.spec.ts`, `fn:integration/verify-otp.integration.spec.ts`                                                                          |
| `fn:use-cases/complete-registration.use-case.spec.ts` (14)                                 | P1    | `pl:complete-registration.pipeline.spec.ts`, `systems/profile-edit.system.spec.ts` (the aggregate, `registrationProfile`), `fn:wire/identity.wire.spec.ts` |
| `fn:adapters/firestore-user-repository.spec.ts` (5)                                        | P1    | `fn:adapters/firestore-users.adapter.spec.ts`, the pipeline specs (the body), `entities/identity-entities.type-spec.ts`                                    |
| `fn:adapters/firestore-otp-repository.spec.ts` (5)                                         | P1    | `fn:adapters/firestore-otps.adapter.spec.ts`, `fn:adapters/firestore-ttl.adapter.spec.ts`                                                                  |
| `fn:adapters/firebase-auth-token-adapter.spec.ts` (5)                                      | P1    | `fn:adapters/auth-claims.adapter.spec.ts` (3a)                                                                                                             |
| `fn:adapters/node-otp-crypto.spec.ts` (5), `fn:adapters/fixed-code-otp-crypto.spec.ts` (2) | P1    | `fn:adapters/otp-crypto.adapter.spec.ts` (3a)                                                                                                              |
| `wa:profile.adapter.spec.ts` (17), `wa:profile.adapter.integration.spec.ts` (7)            | P2    | `wa:accounts.adapter.spec.ts` / `.integration.spec.ts`, `systems/profile-edit.system.spec.ts`, `wa:firestore.rules.integration.spec.ts`                    |
| `wa:user-search.adapter.spec.ts` (4)                                                       | P2    | `wa:accounts.adapter.spec.ts` (search)                                                                                                                     |
| `libs/infrastructure/firebase-app/src/lib/auth-state.service.spec.ts` (5)                  | P2    | `dead:` the class has no consumer; claims decoding is `components/auth-claims.data.spec.ts` (`fromToken`)                                                  |

14 files, 99 cases (server: 10 files, 66 cases; web: 4 files, 33 cases).
(`wa:impersonation.adapter.spec.ts` (6) and its
integration spec (3) are **re-targeted**, not deleted: their `save` and
`findById` cases are `dead:` — no port, Phase 4's callables own the write —
and are listed in the P2 ledger.)

### 5.2 Re-targeted

`fn:adapters/auth-claims.adapter.spec.ts` (fixtures from `@core/*`; the
factory typed `AuthAdminPorts & AuthUserLookupPorts`),
`fn:adapters/{crypto,otp-crypto}.adapter.spec.ts` (the `NodeOtpCrypto` /
`FixedCodeOtpCrypto` parity cases re-stated against literal vectors recorded
from the oracles before deletion — same `it` titles, no case lost, delta 5),
`fn:adapters/console-otp-sender.adapter.spec.ts` ("is the SendOtp port" →
"is the OtpDeliveryPorts bundle"),
`fn:main.spec.ts` (30 exports; the identity endpoints pinned by literal
options now that `lib/otp/*` is gone; `updateProfile` in the Callables
registry case), `fn:edge.spec.ts` (floors), `fn:adapters/{firestore-ttl.adapter,firestore-ports}.spec.ts`,
`pl:customer-records.pipeline.spec.ts` (P0: its `customerCreates` cases
move, titles kept, to `systems/customer-record.system.spec.ts`; the retry
cases re-stated over `runWithCreateRetry`), `systems/audit.system.spec.ts`
(P0: one case re-seeded flat, delta 13), `systems/registration.system.spec.ts`
(P0: + `adoptStub`), `libs/application/accounts/src/lib/read-models/profile-completion.spec.ts`
(P3: `registeredUserFixture`), `wa:impersonation.adapter{,.integration}.spec.ts`,
`wa:firestore.rules.integration.spec.ts`, every store/component spec of §2's
provider list, `tools/seed/{seed-data,load-domain}.spec.mjs`,
`testing/port-doubles.spec.ts`, `testing/identity.fixtures.spec.ts`.

### 5.3 New

`systems/profile-edit.system.spec.ts`, `systems/customer-record.system.spec.ts`; the four `pl:*.pipeline.spec.ts`
(exact `WriteOp[]`); `fn:adapters/{firestore-otps,firestore-users,tenant}.adapter.spec.ts`;
`fn:wire/identity.wire.spec.ts`; `fn:integration/{verify-otp,complete-registration,update-profile}.integration.spec.ts`;
`wa:accounts.adapter.spec.ts` + `.integration.spec.ts`; the type-spec cases
of §3.1.

### 5.4 The case ledger (the proof)

P1 and P2 each return, for every spec they delete or re-target with dead
cases, a ledger line per case:
`<deleted file>:<it title> → <successor file>:<it title>` or `dead:
<reason>` (a legacy class, a mapper round-trip, an ISO parser, a port with
no successor). Table-driven cases (`[each]`) move as one line with their
rows. The integrator appends the ledgers to this document as §11 in the flip
commit; a deleted case with neither a successor nor a reason blocks the
flip. Expected shape: 99 deleted cases + the 9 dead-or-moved cases of the
two re-targeted impersonation specs, of which the `dead:` ones are only: the `SessionClaims`/`AuthStateService`
cases (5), the impersonation `save`/`findById` round-trips, the
`Otp.reconstitute`/`toPersistence` ISO round-trips (subject gone; the body
is the entity type), and the `NodeOtpCrypto`/`FixedCodeOtpCrypto` class
construction cases already re-stated by `otp-crypto.adapter.spec.ts`.

---

## 6. The per-flip grep gate

Paste once per shell; passes when every `gate` prints `ok`. It runs after
flip 2 lands with flip 1 landed, so it re-runs **flip 1's gate with its
flip-2 exclusions removed** (they lapse now: `firestore-otp-repository*`,
`request-otp.use-case.spec.ts`, `impersonation.adapter*` (all three
occurrences; the `event-repository.adapter*` line beside one of them is
flip 4's and stays), `firestore-user-repository*`, `profile.adapter*` and
`firestore.rules.integration.spec.ts` — whose remaining `'status'` hits on
`3ff1793` are all `users` seeds this flip flattens) — and with ONE new
exclusion, `apps/web/e2e/booking-core.spec.ts`, on its "removed fields",
"wire-only spellings" and "Law 6 status keys" gates (delta 10: it landed in
`0a9439c`, after flip 1's gate was written; it asserts the retired keys
are absent and reads the `data-day-key` DOM attribute). Measured on
`3ff1793`: those three flip-1 gates fail today on that file alone besides
the flip-2 files this flip deletes or flattens, so the pre-flip run is NOT
clean without the exclusion. It adds the **Law 9
gates**: no `Pick`/`Omit` over a `*Ports` type in any code file, none at
all in the ports tier, no bundle record declared outside the ports tier,
no identity adapter returning a bare port, and the retired names gone.

```bash
cd "$(git rev-parse --show-toplevel)" || echo 'ERROR run this inside the repository'
STORE=(apps/functions/src libs/infrastructure tools/seed tools/seed-dev-catalog.mjs
       apps/web/e2e apps/web/src/testing tools/verify firestore.rules
       libs/ecs-core/src/pipelines libs/ecs-core/src/ports libs/ecs-core/src/testing)
REVIEW=(libs/features apps/web/src/app)
NOT_FS=(':(exclude)libs/infrastructure/web-storage/**' ':(exclude)*.md')
IDENTITY=(':(glob)apps/functions/src/**/*otp*' ':(glob)apps/functions/src/**/*user*'
          ':(glob)apps/functions/src/**/*registration*' ':(glob)apps/functions/src/**/*impersonation*'
          ':(glob)apps/functions/src/**/*identity*' ':(glob)apps/functions/src/**/*tenant*'
          ':(glob)libs/infrastructure/**/*otp*' ':(glob)libs/infrastructure/**/*impersonation*'
          ':(glob)libs/infrastructure/**/*profile*' ':(glob)libs/infrastructure/**/*user*'
          ':(glob)libs/infrastructure/**/*accounts*' ':(glob)libs/infrastructure/**/*governance*'
          ':(glob)libs/ecs-core/src/pipelines/*otp*' ':(glob)libs/ecs-core/src/pipelines/*registration*'
          ':(glob)libs/ecs-core/src/pipelines/*profile*' ':(glob)tools/seed/fixtures/users*')

# Legacy mappers, shims and classes that read or wrote the old bodies (whole words).
W2=(-e accountStatusFromDocument -e accountStatusToDocument -e registeredToPersistence
    -e storedStatusOf -e StoredAccountStatus -e UserRecordSnapshot -e ProvisionedUser
    -e otpDestinationFromRaw -e otpDestinationValue -e OtpDestination
    -e expiresAtIso -e consumedAtIso -e startedAtIso -e endedAtIso
    -e FirestoreUserRepository -e FirestoreOtpRepository -e FirebaseAuthTokenAdapter
    -e NodeOtpCrypto -e FixedCodeOtpCrypto -e ConsoleLogOtpSender
    -e FirestoreProfileAdapter -e FirestoreUserSearchAdapter -e FirestoreImpersonationAdapter
    -e AuthStateService -e SessionClaims -e userDocRef -e usersCollection
    -e impersonationSessionDocRef -e impersonationSessionsCollection)
# The users / impersonation status maps (exact strings).
S2=(-e "status: { kind: 'active'" -e "status: { kind: 'blocked'" -e "status: { kind: 'absent'"
    -e "status: { kind: 'frozen'" -e "kind: 'ended'" -e "kind: 'unreadable'" -e "kind: 'stored'"
    -e "untilIso")
# Removed otp / user / session document keys (exact strings), identity files only.
K2=(-e "['expiresAt']" -e "['consumedAt']" -e "['createdAt']" -e "['startedAt']" -e "['endedAt']"
    -e "'consumedAt'" -e "'createdAt'" -e "expiresAt:" -e "consumedAt:" -e "createdAt:"
    -e "startedAt:" -e "endedAt:" -e "'status.kind'" -e "['status']" -e "'status'"
    -e "['destinationType']" -e "['purpose']" -e "['scope']" -e "['registration']")
# Tokens and doubles the flip rebinds (whole words: PROFILE_PORTS is not PROFILE_PORT).
T2=(-e PROFILE_PORT -e USER_SEARCH_PORT -e IMPERSONATION_PORT -e ProfilePort
    -e UserSearchPort -e ImpersonationPort -e UserSearchResult -e InMemoryProfilePort
    -e HeldProfilePort -e UpdateProfileUseCase)
# Stale pointers to the files this flip deletes (exact strings; W2 names classes, not paths).
F2=(-e firestore-user-repository -e firestore-otp-repository -e firebase-auth-token-adapter
    -e node-otp-crypto -e fixed-code-otp-crypto -e console-otp-sender.ts -e 'lib/otp/'
    -e otp-repository.port -e user-repository.port -e auth-token.port
    -e profile.adapter -e user-search.adapter -e auth-state.service)
# The P3/P4 directories: legacy ids and form value objects (§3.5).
WEB_P34=(libs/features/client/account-state libs/features/client/profile libs/features/client/onboarding
         libs/features/client/booking libs/features/client/account libs/features/client/appointments
         libs/features/shared/shell libs/features/staff/client-card libs/features/staff/dashboard)
# Law 9 — every code file of the monorepo (the lint rule's own fixtures excluded).
CODE=(apps libs tools ':(exclude)*.md' ':(exclude)tools/lint-rules/**')
# A Pick/Omit whose sliced type names a *Ports type (one line; the lint rule catches the rest).
SLICE='(^|[^A-Za-z0-9_])(Pick|Omit)<[[:space:]]*(readonly[[:space:]]+)?[A-Za-z0-9_.]*Ports([^A-Za-z0-9_]|$)'
# A type name that does NOT end in `Ports` (ERE has no negative suffix; one alternative per letter).
NOT_PORTS='[A-Z]([A-Za-z0-9_]*[A-Za-rt-z0-9_]|[A-Za-z0-9_]*[A-Za-su-z0-9_]s|[A-Za-z0-9_]*[A-Za-qs-z0-9_]ts|[A-Za-z0-9_]*[A-Za-np-z0-9_]rts|[A-Za-z0-9_]*[A-OQ-Za-z0-9_]orts)'
# Bundles and aliases this flip retires (whole words; OtpCryptoPorts is not CryptoPorts).
R9=(-e AccountReadPorts -e AuthClaimsPorts -e CryptoPorts)

FAILED=0
gate() { local label=$1; shift
  git grep --untracked -nI "$@"
  case $? in 0) echo "FAIL  $label"; FAILED=1 ;; 1) echo "ok    $label" ;; *) echo "ERROR $label"; FAILED=1 ;; esac; }
review() { local label=$1; shift; echo "----  review: $label"; git grep --untracked -nI "$@" || echo "      (none)"; }

# 1. Flip 1's gate, its flip-2 exclusions dropped: paste flip 1's §6 block with
#    every ':(exclude)…' line naming firestore-otp-repository*,
#    request-otp.use-case.spec.ts, impersonation.adapter* (3x),
#    firestore-user-repository*, profile.adapter* or
#    firestore.rules.integration.spec.ts deleted, AND
#    ':(exclude)apps/web/e2e/booking-core.spec.ts' added to its 'removed fields',
#    'wire-only spellings' and 'Law 6 status keys' gates (delta 10) — every gate ok.
# 2. Flip 2.
gate 'flip 2 · legacy mappers and classes' -wF "${W2[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}"
gate 'flip 2 · status maps'                -F  "${S2[@]}" -- "${STORE[@]}" "${NOT_FS[@]}"
gate 'flip 2 · otp, user and session keys' -F  "${K2[@]}" -- "${IDENTITY[@]}" "${NOT_FS[@]}"
gate 'flip 2 · rebound tokens'             -wF "${T2[@]}" -- libs/features apps/web/src libs/infrastructure "${NOT_FS[@]}"
gate 'flip 2 · stale pointers to deleted files' -F "${F2[@]}" -- "${STORE[@]}" "${NOT_FS[@]}" \
  ':(exclude)tools/verify/bundle/initial-bundle.spec.mjs' ':(exclude)libs/application/**'
gate 'flip 2 · P3/P4 legacy ids and form value objects' -E -e 'UserId\.create\(' -e 'User\.reconstitute\(' \
  -e 'as UserId([^A-Za-z0-9_]|$)' -e 'FirstName\.create\(' -e 'LastName\.create\(' -e 'BirthDate\.create\(' \
  -- "${WEB_P34[@]}" "${NOT_FS[@]}"
gate 'flip 2 · libs/domain/models has no importer' -F -e '@creativo/domain/models' \
  -- apps libs tools ':(exclude)libs/domain/models/**' "${NOT_FS[@]}"
gate 'flip 2 · no project reference to libs/domain/models' -F -e 'domain/models/tsconfig' \
  -- '*.json' ':(exclude)libs/domain/models/**'
gate 'flip 2 · functions off the identity legacy libs' -F \
  -e '@creativo/application/identity' -e '@creativo/domain/identity' -e '@creativo/domain/models' \
  -e 'libs/application/identity/' -e 'libs/domain/identity/' -e 'libs/domain/models/' \
  -- apps/functions "${NOT_FS[@]}"
node -e '
  const groups = new Set(process.argv[1].split(","));
  const removed = /^(consumedAt|createdAt|expiresAt|startedAt|endedAt|status|registration|scope|destinationType|purpose)$|[.]|^(kind|type)$/;
  const { indexes = [], fieldOverrides = [] } = require(process.cwd() + "/firestore.indexes.json");
  const bad = [
    ...indexes.filter((i) => groups.has(i.collectionGroup)).flatMap((i) => i.fields.map((f) => [i.collectionGroup, f.fieldPath])),
    ...fieldOverrides.filter((o) => groups.has(o.collectionGroup) && o.indexes.length > 0).map((o) => [o.collectionGroup, o.fieldPath]),
  ].filter(([, p]) => removed.test(p));
  for (const [g, p] of bad) console.log(`firestore.indexes.json: ${g} -> ${p}`);
  process.exit(bad.length ? 1 : 0);
' users,otps,impersonationSessions,customers \
  && echo 'ok    flip 2 · indexes' || { echo 'FAIL  flip 2 · indexes'; FAILED=1; }
# 3. Law 9 (port composition).
gate 'flip 2 · Law 9 no Pick/Omit of a *Ports type'   -E -e "$SLICE" -- "${CODE[@]}"
gate 'flip 2 · Law 9 ports tier holds no Pick/Omit'   -E -e '(^|[^A-Za-z0-9_])(Pick|Omit)<' -- libs/ecs-core/src/ports
gate 'flip 2 · Law 9 no bundle record outside ports'  -E -e 'type [A-Za-z0-9_]*Ports(<[^>]*>)? = \{' \
  -- "${CODE[@]}" ':(exclude)libs/ecs-core/src/ports/**'
gate 'flip 2 · Law 9 inline member in a *Ports intersection' -E \
  -e 'Ports(<[^>]*>)? = [^;]*&[[:space:]]*\{' -e 'Ports(<[^>]*>)? =[[:space:]]*$' \
  -- "${CODE[@]}" ':(exclude)libs/ecs-core/src/ports/**'
gate 'flip 2 · Law 9 pipeline XPorts hold no record' -E -e 'export type [A-Za-z0-9_]+Ports = [^;]*\{' \
  -- libs/ecs-core/src/pipelines
gate 'flip 2 · Law 9 adapters return bundles'         -E \
  -e '\): (Pick<|SendOtp([^A-Za-z0-9_]|$)|OtpCrypto([^A-Za-z0-9_]|$)|AuthClaimsPorts|CryptoPorts)' \
  -- apps/functions/src/adapters libs/infrastructure
gate 'flip 2 · Law 9 adapter factories return *Ports' -E \
  -e "^export const [a-zA-Z]+ = (<[^>]*>)?\\([^)]*\\): ${NOT_PORTS}([^A-Za-z0-9_]|\$)" \
  -- 'apps/functions/src/adapters/*.adapter.ts' 'libs/infrastructure/**/*.adapter.ts' \
  ':(exclude)apps/functions/src/adapters/firestore-tx.adapter.ts'
gate 'flip 2 · Law 9 no port function type outside ports' -E \
  -e '^export type [A-Z][A-Za-z0-9_]* =[[:space:]]*(<[^>]*>)?\([^)]*\)[[:space:]]*=>' \
  -- libs/ecs-core/src/pipelines apps/functions/src libs/infrastructure
gate 'flip 2 · Law 9 retired bundles'                 -wF "${R9[@]}" -- "${CODE[@]}"
gate 'flip 2 · Law 9 retired local record (functions)' -wF -e Primitives -- apps/functions/src
review 'flip 2 · Law 9 *Ports aliases outside ports/pipelines (expect only intersections: FirestorePorts, EdgePorts, ServerPorts)' \
  -E -e 'type [A-Za-z0-9_]*Ports(<[^>]*>)? =' -- "${CODE[@]}" \
  ':(exclude)libs/ecs-core/src/ports/**' ':(exclude)libs/ecs-core/src/pipelines/**'
review 'flip 2 · stores and components' -F -e '.status.kind' -e 'fullName()' -e '.firstName.value' \
  -e '.lastName.value' -e '.phone.value' -e '.email?.value' -e 'toISODate()' -e 'profileCompletion(' \
  -- "${REVIEW[@]}" libs/application/accounts/src/lib/read-models
[ "$FAILED" = 0 ] && echo 'flip 2 gate: PASS' || echo 'flip 2 gate: FAIL'
```

Notes. (1) `W2` runs over `REVIEW` too, as a hard gate: every name in it is a
deleted class or mapper, so any mention left in a store or component is
stale. (2) The `S2` strings are the users and impersonation status maps
only: `status: { kind` alone would match flip 1's symbolic seed plans
(`tools/seed/{fixtures,appointments}.mjs`, `seed-data.spec.mjs`) and the
flip-3 `phase: { kind` of `loyalty.spec.mjs`, which are not this flip's.
(3) `T2` deliberately leaves `libs/application/**` out: the legacy token
declarations, `UpdateProfileUseCase` and the governance use cases die with
the layer in Phase 4. (4) The `review` list is informational: each hit is
either a legacy-`User` read P3/P4 missed (fix it) or a hit outside the
P3/P4 directories that Phase 4 retires; the reviewer records which (the
form value objects inside them are a hard gate now, note 8). (5) The integrator dry-runs the
whole block on the integrated tree before §8 step 3 closes, and P5 copies
it into runbook §4.2 (replacing today's block, whose `status: { kind` gate
would trip on flip 1's symbolic plans). (6) The Law 9 gates complement,
never replace, `creativo/no-sliced-ports` in `pnpm nx run-many -t lint`:
the grep sees one line, the rule sees the type tree (a multi-line `Pick<`,
a union, a parenthesised type). Measured on `3ff1793` with this block
(the integrator re-measures before §8 step 3 closes): **ok** — `SLICE`,
ports tier, pipeline `XPorts` records, port function types outside the
ports tier; **FAIL exactly on the F2-18 residue and `AccountReadPorts`** —
record gate: `AuthClaimsPorts`, `CryptoPorts`; inline-member gate:
`edge.ts` `EdgePorts`; `adapters return bundles`: `authClaimsPorts`,
`consoleOtpSender` (`SendOtp`), `cryptoPorts`, `nodeOtpCrypto`,
`fixedCodeOtpCrypto`; adapter-factory gate: the two OTP-crypto factories
(`firestore-tx.adapter.ts` is excluded whole: `firestoreReadTx` returns the
`ReadTx` handle, a port argument, not a bundle); retired bundles:
`AuthClaimsPorts`, `CryptoPorts`, `AccountReadPorts`; retired local
record: `firestore-ports.ts` `Primitives` — so a hit after integration is a
regression. The grep gates are single-line: a multi-line return type or
parameter list is the lint rule's and the reviewer's (the inline-member
gate's `Ports =$` alternative surfaces a multi-line `*Ports` alias for
manual follow-up; none exists outside the ports tier on `3ff1793`).
(7) `W2` now also scans `libs/ecs-core/src/{ports,testing}`; the
FILE-path pointers of delta 7 are the `F2` gate's (`tools/verify/bundle/initial-bundle.spec.mjs`
is excluded: its `profile.adapter.ts` path is synthetic test data;
`libs/application/**` dies in Phase 4). On `3ff1793` `F2` hits only files
this flip deletes or a package owns (P0: the two port files; P1: the
surviving `auth-claims`/`console-otp-sender`/`crypto`/`otp-crypto`
adapters and specs, `edge.spec.ts`, `main.ts`, `main.spec.ts`; P2: the two
barrels; P5: `e2e/support/seed-firestore.ts`). (8) The P3/P4 gate covers
specs and `src/testing` too (§3.5: `UserId.parse` / `UserId.of`, never a
cast; no legacy form value object in a touched directory). (9) The
project-reference gate is the path half of the "no importer" gate: on
`3ff1793` it hits `apps/functions/tsconfig.app.json`,
`libs/application/identity/tsconfig.lib.json` (P1) and
`libs/infrastructure/firebase-app/tsconfig.{lib,spec}.json` (P2).

---

## 7. Deletions and the edge floors

### 7.1 Deletion rule

A file is deleted in the flip commit when `git grep` shows no importer of it
and `pnpm nx run-many -t typecheck --skip-nx-cache` stays green — never
earlier because a successor exists. Checked against today's import graph:

**Deleted in this flip** (each loses its last importer here):

- `apps/functions/src/lib/otp/{request-otp,verify-otp,complete-registration,tenant}.ts`,
  `lib/otp/{request-otp,verify-otp}.spec.ts` (the folder goes) [P1];
- `apps/functions/src/use-cases/{request-otp,verify-otp,complete-registration}.use-case.ts`,
  their `.errors.ts` and `.use-case.spec.ts` [P1];
- `apps/functions/src/adapters/{firestore-user-repository,firestore-otp-repository,firebase-auth-token-adapter,node-otp-crypto,fixed-code-otp-crypto}.ts`
  and their specs, `adapters/console-otp-sender.ts` (no spec) [P1];
- `apps/functions/src/test-support/fake-firestore.ts` (importers: the two
  repository specs only), `test-support/fake-auth.ts` (importer:
  `firebase-auth-token-adapter.spec.ts` only) [P1];
- `libs/application/identity/src/lib/ports/{auth-token.port,otp-destination,otp-repository.port,user-repository.port,otp-sender.port,otp-crypto.port}.ts`
  and their lines in `libs/application/identity/src/index.ts` (F2-12) [P1];
- `libs/infrastructure/firestore/src/lib/{profile.adapter,user-search.adapter}.ts`
  (+ specs, + the profile integration spec) [P2];
- `libs/infrastructure/firebase-app/src/lib/auth-state.service.ts`, its
  spec and its `index.ts` line [P2].

`node-otp-crypto.ts` and `fixed-code-otp-crypto.ts` have two more importers
on `3ff1793` than the draft saw — `adapters/crypto.adapter.spec.ts` and
`adapters/otp-crypto.adapter.spec.ts` use them as parity oracles. P1 first
records the oracles' outputs into those specs as literal vectors (delta 5),
then deletes the two classes; the Law 9 re-type of the surviving adapters
(F2-18) is in the same package, so no file is left half-converted.

**Survivors, with the importer that keeps them:**
`apps/functions/src/test-support/fixed-clock.ts` ←
`adapters/firestore-streak-definition-store.spec.ts`,
`lib/loyalty/publish-streak-definition.spec.ts`,
`use-cases/publish-streak-definition.use-case.spec.ts` (all flip 3): it is
deleted with the last of them in flip 3, by this same rule;
`fn:adapters/system-clock.ts` (+ spec) ← `lib/loyalty/publish-streak-definition.ts`
(flip 3); `fn:lib/booking/caller-roles.ts` (+ spec) ←
`publish-streak-definition.ts`, `wire/ops.wire.ts`;
`fn:lib/booking/tenant-zone.ts` ← `edge.ts`, `main.ts`;
`fn:test-support/fake-projection-firestore.ts`; `fn:lib/{flags,firebase-admin}.ts`.
`libs/domain/models/**`, `libs/domain/identity/**`,
`libs/application/identity/**` (the rest), `libs/application/accounts/**`
(`PROFILE_PORT`, `UpdateProfileUseCase`) and
`libs/application/governance/**` (`USER_SEARCH_PORT`, `IMPERSONATION_PORT`,
the impersonation use cases) are **not** deleted: their own barrels or the
web's guards still reach them (Phase 4); the gate of §6 proves no `STORE`
file or store imports the flip-2 names. Each package re-runs the importer
grep for its deletions at integration; a file that still has an importer
stays and is reported.

### 7.2 `edge.spec.ts` floors (P1)

The throw-site scanner reads `lib/**` and `use-cases/**`. After this flip
only `lib/loyalty/publish-streak-definition.ts` throws its own
`HttpsError`s (measured 2 sites on `c0e5d73` by flip 1) and only
`use-cases/publish-streak-definition.errors.ts` declares error classes
(measured 9 codes). So: `expect(sites.length).toBeGreaterThanOrEqual(2)`
(comment: "2 sites after flip 2") and
`expect(classes.length).toBeGreaterThanOrEqual(9)`; the
`outsideASwitch` entry for `OtpValidationFailed` (it named
`lib/otp/request-otp.ts`) goes. Re-measure with the scanner after the
deletions; the floors equal the measured counts.

---

## 8. Integration and gates

1. **Wave 0:** merge P0 alone, green on its own gate (§4 P0 — the
   pipelines barrel is P1's, so nothing in ecs-core points at a missing
   file). **Wave 1:** P1–P5 in parallel, then merged. Expected red only
   while wave 1 is partial: `cfg` factory rows before P2's bundles exist,
   `main.ts` before P1's adapters exist — never a P0 type, double or token.
2. Deletion sweep (§7.1), edge floors (§7.2), the project references to
   `libs/domain/models` (`apps/functions/tsconfig.app.json`,
   `libs/application/identity/tsconfig.lib.json`,
   `libs/infrastructure/firebase-app/tsconfig.{lib,spec}.json` — each
   package drops its own, delta 14), `pnpm nx sync` (then
   `pnpm nx sync:check`; it must leave those four files as the packages
   left them).
3. The full gate of `HANDOFF.md` §4, all green but the baseline reds
   (typecheck of `patterns`, `staff-client-card`, `staff-dashboard`
   spec-only; unit `gauge.spec.ts` (4), `visit-pills.spec.ts` (1),
   `visits-page.presenter.spec.ts` "strikes an hour that did not happen" (1);
   e2e exactly 19 failures with 41 passed — 6 `*-screenshots`,
   `landing.spec.ts:120`, 12 `client-card-glance` runs at `:341`/`:684`; the
   `appointments.spec.ts:152` flake, re-run alone with `--repeat-each=3`):
   - `pnpm nx run verify-tools:layering --skip-nx-cache`,
     `pnpm nx run-many -t typecheck --skip-nx-cache`,
     `pnpm nx run-many -t lint`, `pnpm nx run-many -t test --parallel=3`,
     `pnpm nx test ecs-core --coverage`, `pnpm nx typecheck seed-tools`
   - `pnpm nx build web`, `pnpm run verify:bundle`,
     `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs`
   - **one at a time** (shared ports): `pnpm run verify:p0` ((e) both ways),
     `pnpm run test:emulator` (the three new identity emulator specs, the
     re-targeted adapter and rules specs), `pnpm run e2e:web`
     (`auth-onboarding.spec.ts` is the live OTP → registration journey)
   - the grep gate of §6 (its Law 9 block included) and
     `pnpm nx run lint-rules:test` (the `no-sliced-ports` rule's own spec)
   - a `pnpm run dev` smoke: OTP sign-in as a new client (stub written
     flat), onboarding to the end (the users body `REGISTERED`, a
     `customers` record `REGISTRATION` with `userId == uid`), the profile
     page name and birthday edits (search keys re-derived), the booking
     contact sheet's "save to profile", the menu monogram; as
     `staff@test.local`: the visit editor's client search, a client card
     (name, birthday banner, pause badge on a blocked client), companion
     names on a party row.
4. One commit (never pushed by a package), message ending with the
   attribution line; the integrator appends §11 (ledgers) and updates
   `docs/architecture/HANDOFF.md` §2/§3.

---

## 9. Risks specific to this flip

| Risk                                                                                                                                                                                                    | Mitigation                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The OTP wire is the sign-in door; a status or `details` drift locks every client out, and no unit test sees `CallableOtpClient`'s duck-typing.                                                          | `identity.wire.spec.ts` pins today's tables (written from the deleted `toHttpsError` switches before they go); `e2e:web`'s `auth-onboarding.spec.ts` and the dev smoke run the real door.                                                                                |
| `verifyOtp`'s wrong-code increment must commit although the request is refused; a naive `Result.err` from decide writes nothing and silently disables the lockout.                                      | F2-9: decide always answers ok with its plan; the pipeline spec and the emulator spec assert the lockout at `maxAttempts`.                                                                                                                                               |
| The web re-type touches every screen that shows the signed-in name or a client's profile.                                                                                                               | `AccountStateService.account` keeps its `null`-while-provisioned rule; shared doubles from P0; every store spec keeps its cases; the §8 dev smoke is mandatory.                                                                                                          |
| A registration that creates the client record widens the registration transaction.                                                                                                                      | One deterministic-path read in the same `getAll` as `users/{uid}`; the account contact needs no extra read (the settlement IS the contact); `ALREADY_EXISTS` re-runs once (F1-5).                                                                                        |
| `libs/domain/models` deletion readiness: a missed importer blocks Phase 4.                                                                                                                              | The §6 "no importer" gate.                                                                                                                                                                                                                                               |
| A wave-1 package reaches for a member its bundle lacks and slices a suite (`Pick<IdentityPorts, …>`) or declares a local record to get it — Law 9 regresses inside the flip that was meant to apply it. | §3.1.1 names a bundle for every token, adapter and pipeline of the flip; a missing subset is reported to the integrator and added to the port file (P0's file, so the integrator owns the edit); `creativo/no-sliced-ports` in lint and §6's Law 9 gates fail the merge. |

---

## 10. Open questions (owner) — with the default this plan applies

1. **Age-check day** (F2-7): keep the UTC civil date (today, every writer),
   or judge the 16–120 window on the default shop's wall-clock date (Law 7's
   location-only zone)? _Default: UTC, as today_ — derived at the
   boundary from the existing `UTC_ZONE` (never inside a system), and
   recorded by P5 in flatten-spec §2.3 as an owner-acknowledged exception.
2. **Impersonation writes**: `startImpersonation` / `endImpersonation`
   pipelines + callables + the `purgeAt` stamps in this flip, or with
   Phase 4's web switch and `write: if false` (runbook §2.1's successor
   column)? _Default: Phase 4; flip 2 re-shapes the body and its one reader._
3. **`Role` / `AuthStage` values** (flatten-spec OQ-3): SCREAMING with the
   claims, rules and seed, or lowercase for good? _Default: unchanged
   lowercase._
4. **Client record sync** (flatten-spec OQ-5): should a profile name edit
   (owner write or `updateProfile`) update the account's `customers` record?
   _Default: no — registration creates it, nothing syncs it._
5. **`completeRegistration` re-run on a registered account** (F2-8): today it
   re-settles and rewrites names; the blueprint says "replay, write
   nothing". _Default: today's behaviour (value-idempotent `Set`)._
6. **Adopting an Auth user that holds the destination without a `users`
   doc** (F2-9): the blueprint's resolve-the-winner path vs today's
   `token_minting_failure`. It is NOT race-only: `provisionAuthUser`
   answers `null` for the first-verification race AND for an orphan Auth
   user (a failed stub write) or a `users` doc whose contact drifted from
   its Auth record. _Default: adopt only when tx 2's read is absent or a
   `PROVISIONED` stub with the same contact (the loser and the orphan sign
   in); a `REGISTERED` doc or a contact mismatch is refused
   (`token_minting_failure`, as today) — never a sign-in into another
   person's account._
7. **The stub write**: create-only-when-absent in a transaction (closes the
   clobber of a registered body) vs today's plain `set`. _Default:
   create-if-absent._
8. **Raw OTP destination** (F2-10): store the normalised identifier so the
   resend window matches what the probe queries (a behaviour fix) vs today's
   raw value. _Default: the trimmed raw value, frozen (as
   `Otp.validateDestination` stores it today); the fix as its own commit._
9. **`libs/application/identity` ports deleted now** (F2-12), departing from
   flip 1's "application stays until Phase 4". _Default: delete the six
   server-only ports with their barrel lines._
10. **`users.roles` fieldOverride** (`indexes: []`). _Default: add it (an
    array no query reads)._
11. **`AuthStateService`**: delete (no injection site, decodes a `role`
    claim no token carries) or re-type to `AuthClaims.fromToken`?
    _Default: delete._
12. **The rules' "registered" test**: keep `resource.data.firstName`
    non-blank (frozen) or switch to `registrationState == 'REGISTERED'` now?
    _Default: keep; Phase 4 rewrites the users block whole._
13. **Ports with no caller after the flip** (`OtpStorePorts.loadOtp`,
    `AuthAdminPorts.setClaims`): keep them in their bundles (the adapters
    implement them; flip 1 kept `loadWaitlistRequest` the same way) or
    drop the members? _Default: keep; Phase 4's impersonation and
    contact work may call them, and dropping is a one-line bundle edit._
14. **`AccountReadPorts`** (no consumer on `3ff1793`): delete it in favour
    of `ProfilePorts` + `UserSearchPorts`, or keep it as their `&`?
    _Default: delete (F2-16) — a name with no token, no adapter and no
    pipeline is exactly what Law 9 says not to keep; `AccountsPorts` is the
    suite._
15. **Profile-row attribution under `updateProfile`** (F2-5): the
    `auditProfileChanges` trigger credits the event's writer, so a
    callable edit (Admin SDK) is credited `Actor.system(ADMIN_SDK)`, not the
    owner; once Phase 4 routes every client edit through the callable, no
    profile row would name the person. Keep system attribution, or have
    `updateProfile` stamp the editor (e.g. a root `lastEditedByUserId` the
    trigger reads as `Actor.user`)? _Default for this flip: system
    attribution, pinned by `verify:p0` (e) (user for the owner rename,
    `ADMIN_SDK` for the callable restore); the owner decides before Phase 4
    switches the web write, and a stamp, if chosen, lands with that switch._

---

## 11. The case ledgers (§5.4)

Appended by the integrator in the flip commit (2026-10-21). Every case of
the 14 deleted specs (99 cases: server 10 files / 66, web 4 files / 33) and
the 9 cases of the two re-targeted impersonation specs, each against its
successor (`successor file` › its `it` title) or `dead:` with the reason its
subject no longer exists. Every successor title below was grepped in its
file at integration. Prefixes: `fn:` = `apps/functions/src/`, `pl:` =
`libs/ecs-core/src/pipelines/`, `sy:` = `libs/ecs-core/src/systems/`,
`co:` = `libs/ecs-core/src/components/`, `wa:` =
`libs/infrastructure/firestore/src/lib/`.

**Totals.** Server: 66 cases, 64 with successors, 2 `dead:` (the
unreachable `otp_validation_failed` aggregate and the unreadable stored
status — both subjects gone with the mappers). Web: 42 cases (33 deleted +
9 re-targeted), 30 with a successor (the integration spec's
save-then-find case only for its no-audit-row half), 12 `dead:` — the 5
`AuthStateService` cases, the 3 mapper-validation cases of
`profile.adapter.spec.ts` (no reader-side mapper under zero mapping; the
integrator accepts them beyond §5.4's expected list) and the 4 impersonation
`save`/`findById` cases (no port until Phase 4's callables, F2-13). The `NodeOtpCrypto`/`FixedCodeOtpCrypto` class-construction cases
needed no `dead:` line: `otp-crypto.adapter.spec.ts` re-states each.

### 11.1 P1 — server (10 files, 66 cases)

**`fn:lib/otp/request-otp.spec.ts` (5)**

- maps InvalidInputError to invalid-argument and forwards code/params → `fn:wire/identity.wire.spec.ts` › maps a blank destination to invalid-argument and forwards code/params — `missing or empty destination` (+ › maps an unparsable destination to invalid-argument with today’s per-channel reason)
- maps OtpChannelMismatchError to failed-precondition with its stable code → `fn:wire/identity.wire.spec.ts` › maps the channel mismatch to failed-precondition with its stable code and today’s lowercase params
- maps RateLimitedError to resource-exhausted → `fn:wire/identity.wire.spec.ts` › maps the rate limit to resource-exhausted
- maps any other error to internal → `fn:wire/identity.wire.spec.ts` › maps a failed delivery — any other refusal — to internal
- maps ValidationFailure to invalid-argument with aggregated error codes → `dead:` the OTP-issue aggregate `otp_validation_failed` is unreachable — `OtpSystem.issue` is total, `ParsedIdentifier.parse` refuses the destination and `AuthStrategy.parse` the policy before it; `fn:edge.spec.ts` still pins the table row's shape

**`fn:lib/otp/verify-otp.spec.ts` (7)**

- maps InvalidInputError to invalid-argument and forwards code/params → `fn:wire/identity.wire.spec.ts` › maps a blank challenge id to invalid-argument and forwards code/params
- maps OtpNotFoundError to not-found; maps OtpAlreadyConsumedError to failed-precondition; maps OtpExpiredError to deadline-exceeded; maps OtpLockedOutError to resource-exhausted; maps IncorrectCodeError to invalid-argument (5) → `fn:wire/identity.wire.spec.ts` › maps %o to %s / %s (one row each)
- maps any other error to internal → `fn:wire/identity.wire.spec.ts` › maps %o to %s / %s — its `token_minting_failure` rows (a `PipelineError` and `IDENTITY_OTP_ACCOUNT_CONFLICT`) and its `otp_destination_corrupted` row

**`fn:use-cases/request-otp.use-case.spec.ts` (8)**

- creates an OTP, sends the raw code, and returns otpId + rawCode → `pl:request-otp.pipeline.spec.ts` › issues a challenge, saves its flat body, sends the raw code and answers otpId + rawCode
- rejects malformed input → `fn:wire/identity.wire.spec.ts` › maps a blank destination to invalid-argument and forwards code/params — `missing or empty destination`
- rate-limits a second request for the same destination within the window → `pl:request-otp.pipeline.spec.ts` › rate-limits a second request for the same destination within the window — nothing saved, nothing sent
- allows a new request once the rate-limit window has passed → `pl:request-otp.pipeline.spec.ts` › same title
- rejects an email request under a phone_otp deployment (channel mismatch) → `pl:request-otp.pipeline.spec.ts` › same title
- rejects an sms request under an email_otp deployment (channel mismatch) → `pl:request-otp.pipeline.spec.ts` › same title
- issues the OTP with the deployment strategy's own ttl/maxAttempts, not local constants → `pl:request-otp.pipeline.spec.ts` › same title
- generates a valid otpId end-to-end (real SystemClock) → `pl:request-otp.pipeline.spec.ts` › answers the id the IdPorts drew and the code the OtpCrypto port drew — never one of its own (+ `fn:main.spec.ts`, the `requestOtpChallenge` case)

**`fn:use-cases/verify-otp.use-case.spec.ts` (10)**

- mints a client-role custom token on a correct code, provisioning a new user → `pl:verify-otp.pipeline.spec.ts` › same title — the flat PROVISIONED stub, onboarding claims, NEW
- reuses an existing user on a second OTP flow for the same destination → `pl:verify-otp.pipeline.spec.ts` › same title — RETURNING, no second stub
- rejects an incorrect code and increments attemptCount on the stored OTP → `pl:verify-otp.pipeline.spec.ts` › same title — the plan COMMITS, the answer is the refusal
- locks out after maxAttempts incorrect tries, even with the correct code → `pl:verify-otp.pipeline.spec.ts` › same title (+ `fn:integration/verify-otp.integration.spec.ts`, the lockout case)
- rejects an expired OTP → `pl:verify-otp.pipeline.spec.ts` › rejects an expired OTP — and writes nothing
- rejects reusing an already-consumed OTP → `pl:verify-otp.pipeline.spec.ts` › same title
- rejects an unknown otpId → `pl:verify-otp.pipeline.spec.ts` › rejects an unknown otpId — nothing written, nobody provisioned
- mints the STORED roles for a staff account — the out-of-band grant finally reaches the token → `pl:verify-otp.pipeline.spec.ts` › same title
- falls back to client claims when the doc carries no roles — a stub or pre-roles record never escalates → `pl:verify-otp.pipeline.spec.ts` › same title
- verifies successfully end-to-end (real SystemClock) → `fn:integration/verify-otp.integration.spec.ts` › verifies end to end: the challenge consumed, the flat PROVISIONED stub created, a NEW session

**`fn:use-cases/complete-registration.use-case.spec.ts` (14)**

- fills in the required profile fields and promotes claims to active → `pl:complete-registration.pipeline.spec.ts` › same title — ONE Set of the flat body, the REGISTRATION record beside it
- rejects when a required field (e.g. lastName) is missing → `pl:complete-registration.pipeline.spec.ts` › same title — nothing minted, nothing written
- rejects when no provisioned user exists for the identifier → `pl:complete-registration.pipeline.spec.ts` › same title
- persists a valid optional birthDate on the user document → `pl:complete-registration.pipeline.spec.ts` › same title
- registers exactly as before when birthDate is absent — nothing persisted, nothing rejected → `pl:complete-registration.pipeline.spec.ts` › same title
- rejects an invalid birthDate with the typed, reason-carrying error — nothing minted, nothing saved → `pl:complete-registration.pipeline.spec.ts` › same title (+ `fn:wire/identity.wire.spec.ts` › wraps a birth-date refusal …)
- refuses to complete a registration the caller's uid does not own → `pl:complete-registration.pipeline.spec.ts` › same title
- takes the channel the login did not verify from the form on a first registration → `pl:complete-registration.pipeline.spec.ts` › same title
- keeps a paused status — calling the callable again never lifts a pause → `pl:complete-registration.pipeline.spec.ts` › same title
- keeps the pause even when the stored first name was blanked → `pl:complete-registration.pipeline.spec.ts` › same title
- keeps staff roles and mints them, never a demoting plain client → `pl:complete-registration.pipeline.spec.ts` › same title
- never changes a registered contact channel — those move only through a verified contact change → `pl:complete-registration.pipeline.spec.ts` › same title
- rejects an unauthenticated caller — registration needs the verified session → `fn:wire/identity.wire.spec.ts` › refuses an unauthenticated caller before reading the payload
- refuses an unreadable stored status instead of guessing active — nothing saved, nothing minted → `dead:` the flat body's `accountStatus` is a typed `AccountLifecycle` tag; there is no `status` map and no `accountStatusFromDocument` mapper, so no unreadable stored status exists

**`fn:adapters/firestore-user-repository.spec.ts` (5)**

- provisions a contact-channel stub and finds it back, unregistered → `fn:adapters/firestore-users.adapter.spec.ts` › finds a provisioned stub back as stored — PROVISIONED, its one channel, every key present (the stub write: `pl:verify-otp.pipeline.spec.ts` › mints a client-role custom token on a correct code, provisioning a new user …)
- persists a registered user in the accounts-adapter document shape → `pl:complete-registration.pipeline.spec.ts` › fills in the required profile fields and promotes claims to active — ONE Set of the flat body … (+ `fn:integration/complete-registration.integration.spec.ts` › sets the flat REGISTERED body over the stub …)
- reads a registered user back with the registered flag and stored birthDate → `fn:adapters/firestore-users.adapter.spec.ts` › reads a registered user back with its registration state and stored birthDate
- returns null when no user matches the destination → `fn:adapters/firestore-users.adapter.spec.ts` › same title
- looks up by phone when destinationType is sms → `fn:adapters/firestore-users.adapter.spec.ts` › looks up by phone when the destination is a phone — never by e-mail text

**`fn:adapters/firestore-otp-repository.spec.ts` (5)**

- saves and reads back an OTP → `fn:adapters/firestore-otps.adapter.spec.ts` › saves and reads back an OTP — the flat body, plus purgeAt = expiresAtUtcMs + 24 h (+ `fn:adapters/firestore-ttl.adapter.spec.ts` › otps: expiresAtUtcMs + 24 hours …)
- returns null for a missing OTP → `fn:adapters/firestore-otps.adapter.spec.ts` › same title
- finds a recent unconsumed OTP for rate limiting → `fn:adapters/firestore-otps.adapter.spec.ts` › same title — by destination, unconsumed, created at or after the window start
- does not count a consumed OTP toward the rate limit → `fn:adapters/firestore-otps.adapter.spec.ts` › same title
- does not count an OTP older than the rate-limit window → `fn:adapters/firestore-otps.adapter.spec.ts` › same title

**`fn:adapters/firebase-auth-token-adapter.spec.ts` (5)**

- mints a token carrying onboarding-stage claims → `fn:adapters/auth-claims.adapter.spec.ts` › mints an onboarding token WITHOUT a roles key
- mints a token carrying active-stage claims with roles → `fn:adapters/auth-claims.adapter.spec.ts` › mints an active token with { tenantId, stage, roles }
- sets custom claims for an already-signed-in user → `fn:adapters/auth-claims.adapter.spec.ts` › same title — the active claims with roles
- creates a Firebase Auth user by email and returns its uid; creates a Firebase Auth user by phone number (2) → `fn:adapters/auth-claims.adapter.spec.ts` › provisions a phone user by phoneNumber and an e-mail user by email

**`fn:adapters/node-otp-crypto.spec.ts` (5) and `fn:adapters/fixed-code-otp-crypto.spec.ts` (2)**

- always produces a 6-digit, zero-padded string → `fn:adapters/otp-crypto.adapter.spec.ts` › draws six-digit, zero-padded codes
- verifies a code hashed with the same salt; rejects a wrong code; rejects the right code hashed with a different salt (3) → `fn:adapters/otp-crypto.adapter.spec.ts` › verifies a code hashed with the same salt, and rejects a wrong code or another salt
- never stores/compares the raw code as the hash itself → `fn:adapters/otp-crypto.adapter.spec.ts` › never stores the raw code as the hash itself
- always generates the fixed 123456 code → `fn:adapters/otp-crypto.adapter.spec.ts` › pins every code to the pre-flip fixed code
- keeps the REAL hashing pipeline — the fixed code round-trips through scrypt verify → `fn:adapters/otp-crypto.adapter.spec.ts` › keeps the real salt and scrypt, so request → hash → verify is production

The re-targeted `crypto`, `otp-crypto`, `auth-claims` and console-sender
specs kept every case and assertion; only titles naming a class the W2 gate
forbids were reworded (`scryptHex is the pre-flip node OTP hash, byte for
byte — the vector recorded from it`; `both variants are the OtpCryptoPorts
bundle`; `hashes exactly as the pre-flip node crypto did — …`;
`codeMatches is the pre-flip constant-time verify — its recorded verdicts`;
`writes exactly what the pre-flip token adapter wrote — its recorded calls,
pinned`; `sets it with updateUser — the one call the pre-flip setDisplayName
made`; `is the OtpDeliveryPorts bundle`).

### 11.2 P2 — web (4 deleted files, 33 cases; 2 re-targeted files, 9 cases)

**`wa:profile.adapter.spec.ts` (17)**

- saveProfile › updates only the owner-editable keys, never a whole-document set → `wa:accounts.adapter.spec.ts` › same title (+ `sy:profile-edit.system.spec.ts` › answers exactly the five owner keys — the rules’ allowlist, nothing else)
- saveProfile › never sends roles, status, phone or email, whatever the passed User carries → `wa:accounts.adapter.spec.ts` › never sends roles, accountStatus, phone or email, whatever the answer carries
- saveProfile › rebuilds the search keys from the edited name and the STORED contact channels → `sy:profile-edit.system.spec.ts` › same title (the rule) + `wa:accounts.adapter.spec.ts` › writes the search keys the decide derived from the STORED contact channels
- saveProfile › sends null for an absent birth date, so a cleared one is cleared → `wa:accounts.adapter.spec.ts` › sends the answer’s null birth date as null — a key of the five is never dropped (the edit-level rule: `sy:profile-edit.system.spec.ts` › keeps the stored birth date when the edit leaves it out — there is no clearing)
- saveProfile › refuses to create: a missing document fails and nothing is written → `wa:accounts.adapter.spec.ts` › refuses to create: decide over a missing document answers not found, nothing written
- saveProfile › refuses to register: a contact-only stub fails and nothing is written → `wa:accounts.adapter.spec.ts` › refuses to register: decide over a PROVISIONED stub answers not found, nothing written
- saveProfile › surfaces a refused transaction (rules, offline) as a failed Result → `wa:accounts.adapter.spec.ts` › turns a refused transaction (rules, offline) into REPOSITORY_WRITE_FAILED, nothing written
- saveProfile › property: the payload is always exactly the allowlist → `wa:accounts.adapter.spec.ts` › same title
- getProfile › returns null when the doc does not exist → `wa:accounts.adapter.spec.ts` › loadProfile › answers null when the document does not exist
- getProfile › returns null for the pre-registration stub (contact channels only) → `wa:accounts.adapter.spec.ts` › loadProfile › a stub is answered as stored — the PROVISIONED body, never null; the consumer judges (the stub → null rule moved to the consumers: `account-state.service.spec.ts` › reads a provisioned stub as no profile, and the registered body once it lands; `profile.store.spec.ts` › answers not-found for a provisioned stub — a stub is no profile to edit; `client-card.store.spec.ts` › reads a provisioned stub as no profile: …; `staff-dashboard.spec.ts` › names no companion by a provisioned stub: …)
- getProfile › reconstitutes a User from a stored document → `wa:accounts.adapter.spec.ts` › answers the stored body as the flat User, unmapped — { id, ...data }
- getProfile › surfaces a malformed document as a failed Result → `dead:` mapper validation (`User.reconstitute`); under zero mapping a body that is not its entity is a writer's defect (`observe.ts` `entityOf`)
- getProfile › surfaces a registered document without a status as a failed Result, not a throw → `dead:` the `accountStatusFromDocument` mapper is gone; every key is present by construction (`libs/ecs-core/src/entities/identity-entities.type-spec.ts`)
- observeProfile › emits ok(null) while the document is absent or still a stub → `wa:accounts.adapter.spec.ts` › answers null while there is no document, then the body the server writes (+ › a stub is answered as stored …; null-for-stub: the `AccountStateService` consumer case above)
- observeProfile › maps each snapshot, so a server-written status change arrives live → `wa:accounts.adapter.spec.ts` › a server-written accountStatus change arrives live, the block’s keys at the root
- observeProfile › emits a failed Result for a malformed document → `dead:` mapper validation (as above); the stream's failure channel is `wa:accounts.adapter.spec.ts` › answers a refused read as the port’s RepositoryError
- observeProfile › detaches the snapshot listener on unsubscribe → `wa:accounts.adapter.spec.ts` › same title

**`wa:profile.adapter.integration.spec.ts` (7)**

- round-trips an owner name edit through saveProfile/getProfile → `wa:accounts.adapter.integration.spec.ts` › round-trips an owner name edit through writeOwnProfile/loadProfile
- lets staff read a client profile they do not own → `wa:accounts.adapter.integration.spec.ts` › same title
- never carries roles, phone or email from the passed User to the document → `wa:accounts.adapter.integration.spec.ts` › leaves roles, phone and email as stored: the write carries the five owner keys only
- leaves a server-written status untouched by the owner's name save → `wa:accounts.adapter.integration.spec.ts` › leaves a server-written block untouched by the owner's name save
- never creates the document: saving a missing profile fails → `wa:accounts.adapter.integration.spec.ts` › never creates the document: writing a missing profile is refused, nothing exists (+ a PROVISIONED stub is refused by decide and stays as stored)
- observeProfile delivers a server-side status change live → `wa:accounts.adapter.integration.spec.ts` › observeProfile delivers a server-side accountStatus change live
- observeProfile reads the pre-registration stub as no profile yet → `wa:accounts.adapter.integration.spec.ts` › observeProfile answers the PROVISIONED stub as stored — the consumer judges (null-for-stub: the `AccountStateService` consumer case)

**`wa:user-search.adapter.spec.ts` (4)**

- returns an empty result for a blank query without hitting Firestore → moved to the caller (F2-15): `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts` › asks the index nothing for a blank query — not even after the pause (F2-15) (+ `sy:search-fields.system.spec.ts` › lower-cases and trims anything else — `normalizeQuery`)
- names a person as written, not by the lowercased search key → `wa:accounts.adapter.spec.ts` › names nobody: each row is the body as written — the display name is the caller’s (the written-name-else-`searchName` rule: `staff-dashboard.spec.ts` › labels a found account by its name as written, else by its search key, and reads its contact off the account)
- maps matching documents to UserSearchResult → `wa:accounts.adapter.spec.ts` › asks searchPrefixes array-contains, orderBy searchName, limit — and answers the stored rows (+ cuts at the caller’s limit; emulator: `wa:accounts.adapter.integration.spec.ts` › searchUsers answers the front desk index #8 in searchName order, cut at the limit)
- surfaces a Firestore error as a failed Result → `wa:accounts.adapter.spec.ts` › answers a refused query as the port’s RepositoryError

**`libs/infrastructure/firebase-app/src/lib/auth-state.service.spec.ts` (5)** — all `dead:`: `AuthStateService` had no injection site and decoded a `role` claim no token carries (F2-12, §10.11)

- starts with no current user and no claims → `dead:` class deleted; the session is `ObservePrincipal` (`AUTH_GATEWAY`)
- decodes valid custom claims off the ID token when a user signs in → `dead:` class deleted; the claims decoder is `co:auth-claims.data.spec.ts` › parses a well-formed active claims bag
- clears claims to null when claims fail schema validation (e.g. missing role) → `dead:` class deleted; `AuthClaims.fromToken` degrades instead (`co:auth-claims.data.spec.ts` › degrades to onboarding when roles is not an array)
- refreshClaims() forces a token refresh via getIdTokenResult(true) → `dead:` class deleted (`AUTH_GATEWAY.refreshToken` is the live door)
- refreshClaims() is a no-op when nobody is signed in → `dead:` class deleted

**`wa:impersonation.adapter.spec.ts` (6, re-targeted)**

- save() writes the session document and nothing else → `dead:` no write port in this flip; Phase 4's `startImpersonation` callable owns the write (F2-13)
- save() writes no audit row from the browser → `wa:impersonation.adapter.spec.ts` › writes nothing from the browser — the bundle’s one member is a read, no session and no audit row
- findById() returns null for a missing document → `dead:` `findById` has no caller and no port (F2-13)
- findById() reconstitutes a found document → `dead:` `findById` + reconstitute; the body as stored is pinned by `wa:impersonation.adapter.spec.ts` › asks adminUserId ==, impersonationStatus == ACTIVE, limit 1 — and answers the flat body as stored
- findActiveForAdmin() returns null when no active session exists → `wa:impersonation.adapter.spec.ts` › answers null when the admin has no ACTIVE session — an ended one and another admin’s are not it (+ a session ending arrives live: the ACTIVE body, then null)
- surfaces a RepositoryError when the session write rejects → `dead:` no write member; the read's failure channel is `wa:impersonation.adapter.spec.ts` › answers a refused read as the port’s RepositoryError

**`wa:impersonation.adapter.integration.spec.ts` (3, re-targeted)**

- saves a session, writes no audit row from the browser, then finds it by id → the save/findById halves `dead:` (no port, Phase 4); the no-audit-row half → `wa:impersonation.adapter.integration.spec.ts` › finds the one ACTIVE session for an admin — the flat body as stored — and writes no audit row
- finds the one active session for an admin → `wa:impersonation.adapter.integration.spec.ts` › finds the one ACTIVE session for an admin — the flat body as stored — and writes no audit row (+ › answers null for an admin with no ACTIVE session)
- denies a non-admin from reading or writing impersonation sessions → `wa:impersonation.adapter.integration.spec.ts` › denies a non-admin the read (the write half is the rules spec's; rules unchanged)

### 11.3 Deliberate departures, pinned

- The raw e-mail destination's last label needs at least two characters (§0 F2-1): the legacy `Email.create` pattern `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` gave way to the ecs-core `Email.parse` pattern `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` (`co:email.data.ts`), reached through `ParsedIdentifier.parse` by `pl:request-otp.pipeline.ts`, `pl:complete-registration.pipeline.ts` and `pl:verify-otp.pipeline.ts` → `pl:request-otp.pipeline.spec.ts` › refuses an e-mail whose last label is one character — the one `Email.parse` rule, a deliberate tightening (plan §0 F2-1) — nothing saved, nothing sent (its `IDENTITY_IDENTIFIER_INVALID` refusal leaves as `invalid_input` 'invalid email destination': `fn:wire/identity.wire.spec.ts` › maps an unparsable destination to invalid-argument with today’s per-channel reason)
