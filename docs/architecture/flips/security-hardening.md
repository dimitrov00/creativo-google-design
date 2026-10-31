# Security hardening — Phase 4

**Date:** 2026-10-31 · **Status:** PLAN (ledger §8 all TODO) — written on
branch `claude/adoring-pascal-o0miro`, restarted from `origin/main` at
branch point `86870b9` (PR #5 merged: audit hardening Phase 3 and the
owner-review sweep `968a97e` / `ac23b1d`). Every line number below is a hint
on `86870b9`; every package re-reads its sites before it edits. ·
**Owner's word:** the Phase 4 brief (orchestrator scratchpad `brief-p4.md`,
"Mission: Security hardening — App Check and the audit's security follow-ups
(Phase 4)") and the owner's choices of 2026-10-31 it records — build **App
Check** (owner rulings, Deferred #4) and **the security follow-ups** of the
HANDOFF §3.3 carried lists; **not** the real OTP sender (P8 stays FAIL) —
plus the standing delegation of 2026-10-28 (_"pick decisions as a FAANG
grade decision maker and proceed with recommended stuff"_: the safest
reversible recommended option on every open call, recorded as a ruling; the
owner's own steps listed as flags; never block on a question). The Phase 0–2
brief's §1 (hierarchy and HARD LIMITS), §6, §7, §8, §9, §10 and §11 and
`brief-p3.md` §3 carry over verbatim. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md` (`ecs-layering`,
`ecs-primitives`, `ecs-components`, `ecs-systems`, `ecs-ports`,
`ecs-pipelines`, `firestore-layout`, `presenters`, `angular-ui`). This plan
never overrides them; where the brief's design breaks one, §0.2 records the
lawful form with both quotes (hierarchy: hard limits › Laws + rules › OR
rulings / HANDOFF §6 › the brief's process › the brief's designs ›
latitude). The new lint rule `creativo/no-identity-mapper` binds every
package (no copy-only or forward-only function). ·
**Sources:** the two briefs; `docs/architecture/decisions/2026-10-26-owner-rulings.md`
(OR-9, OR-24, OR-29, OR-31, OR-32, OR-34, OR-35, OR-50, OR-51, OR-55, the
Deferred list — #3, #4); `docs/architecture/HANDOFF.md` §3.3 (the two
audit-hardening records and both carried lists, `:2590-2657`, `:3071-3117`),
§4 (the gate and the reference numbers), §5, §6;
`docs/architecture/flips/audit-hardening-phase-3.md` (the structure template
and the record of the machinery reused: §0.1–§0.3, §2.D writer table
`:1180-1191`, §3 rules paragraph, §5, §6, §7 items 6, 11, 23, §8);
`docs/architecture/firestore-runbook.md` §4.0 (the word lists the name check
runs); `docs/design-research/client-details-design.md` §3.6.6 (App Check,
step-up, consumed tokens) and R47; `docs/architecture/flatten-spec.md` §2.3
T2 (`:532-558`); `docs/security/csp-baseline.md`; `docs/production-deploy.md`;
the three read-only inventories of this phase (orchestrator scratchpad
`inv-p4/a-app-check.md`, `bcd-scrub-erased-rules.md`, `ef-roles-walkin.md`;
not committed — every claim used here was re-verified against the code and
`node_modules`, and §0.4 lists the five the code disproved and the one
claim not adopted).

**What this is.** One branch, one PR, six commits — one per workstream at a
green boundary, in the order **B → C → D → E → F → A**. B, C and D are small
and independent (an adapter, two rules files and one pipeline); E adds the
one new callable (`setRoles`); F is web-only; **A is last** because it
touches every callable (the edge), the callable client, the CSP, the
preflight and CI — and because it must name `setRoles` (E) in its
limited-use table and run its journeys over every surface B–F changed.
Phases 0–3 built the machinery reused here, never copied: the edge
(`callableEdge`, `EDGE_DICTIONARIES` / `EDGE_WIRE`, `refusalOf`,
`invocationContext` and the ONE outcome line), `wiredCallable` +
`AnswerIsTheWire`, `Actor.forCaller`, `AuditSystem.createsOf` and the audit
row inside the commit plan, `AuditContext.profileWithTags`,
`AuditSystem.auditedByCallable` (the profile trigger's dedupe),
`LogEvent` + `creativo/no-literal-log-message`, `FailureCodeSystem` and
`adapters/store-answer.ts`, RU-38's `errorField` over
`ClientIssueSystem.scrub` / `frame`, the guarded reads (OR-33), the
`client.privacy` card block and its callables, the flags manifest writer
(`tools/flags/write-functions-env.mjs`), the preflight rows and their
P7/P8 idiom, `check-csp.mjs` and the Hosting smoke, the CI jobs.

**Behaviour is frozen** except each workstream's declared DEPARTURE (§5,
`S-DEP-n`, with before/after, evidence and every spec / e2e / P0 /
emulator file whose pinned behaviour changes). Valid stored documents and
callables answer exactly as before apart from those DEPs; with
`config/app-check.json` at its shipped values (staging and production
`OFF`) no deployed callable answers differently. Phase 4's ids — `S-RU-n`,
`S-L-n`, `S-DEP-n` — never collide with `RU` / `L` / `DEP` (Phases 0–2) or
`P3-*` (Phase 3).

**Out of scope** (brief §2 "Out of scope"; listed in the PR if an edge is
touched): the real OTP sender (the owner picks the provider; P8 stays
FAIL); impersonation read-as (OR-24); the product backlog (atomic visit
save, walk-in adoption at registration, vouchers, the location editor, the
nightly sweep); the `maxPartySize` cap; Trusted Types enforcement and HSTS
`preload` (Deferred #3, #10); any change to EXISTING copy; Firestore and
Storage App Check enforcement themselves (console-only owner steps, §7).

**This phase ends** when the packages of §3 are integrated, every existing
spec passes unchanged except the edits §4/§5 name, the FULL gate of §6.1
(plus its Phase 4 additions) is green against the measured baseline of §6.3,
and HANDOFF, the runbook, `production-deploy.md`, `csp-baseline.md` and the
§8 ledger record the phase.

---

## 0. Reconciliation, rulings and the latitude register (read first)

### 0.1 Reconciliation (every sub-item of S-WS-A…F against `86870b9`)

STILL OPEN = nothing of it exists; PARTLY DONE = what remains is named;
DONE = nothing to build; DECIDED = a ruling, a constraint or this plan's
§0.2/§0.3 settles it. No OR ruling decides HOW any Phase 4 item is built:
the Deferred list's #4 (`owner-rulings.md:1472`) only deferred App Check;
OR-29 fixes the CSP's style (exact hosts, a hash `script-src`), OR-32 is why
`frame-src 'none'` holds today, OR-34 shapes the issue sink, OR-35 the
preflight, OR-50 / OR-51 / OR-55 every new word.

| #    | Item                                                                                            | Status                                            | Evidence (file:line at `86870b9`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.1  | web App Check initialised (reCAPTCHA Enterprise, auto-refresh)                                  | STILL OPEN                                        | `git grep -n -i "appcheck\|app-check\|recaptcha" -- ':!docs' ':!pnpm-lock.yaml'` is empty; `libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts:52-56` (`provideFirebaseApp`: `initializeApp` only), `:116-131` (`provideFirebaseFunctions`: `getFunctions` + the emulator); `apps/web/src/app/app.config.ts:293-295`; `firebase/app-check` ships in `firebase@12.16.0` (`@firebase/app-check@0.12.0`, no new package)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A.2  | the site key as public config, empty = not configured                                           | STILL OPEN                                        | `apps/web/src/environments/environment.ts` and `environment.production.ts` hold `firebase`, `emulators`, `featureFlags` only; `apps/web/project.json:56-61` swaps the production file; the `csp-smoke` configuration (`:68-83`) swaps nothing (dev environment, emulators on)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A.3  | the debug provider under emulators / dev / e2e                                                  | DECIDED → S-RU-18 (not the debug provider)        | the SDK's debug mode exchanges the token with Google's real `content-firebaseappcheck.googleapis.com` (`@firebase/app-check` esm `:65`, `:649-657`), which a `demo-*` project cannot answer; firebase-tools 15.34.1 has no App Check code (`grep -rli "app.\?check" node_modules/firebase-tools/lib/emulator` empty)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A.4  | the limited-use client option                                                                   | STILL OPEN                                        | ONE call site: `libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts:73` `httpsCallable(functions, name)(sent)`; the SDK's option `limitedUseAppCheckTokens` (`@firebase/functions@0.13.5` esm `:367-383`, `:587`, header `X-Firebase-AppCheck` `:595`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A.5  | the CSP admits exactly the reCAPTCHA hosts                                                      | STILL OPEN                                        | `firebase.json:41` (`frame-src 'none'`, no Google host); `docs/security/csp-baseline.md:42`, `:89-93` (OR-32's rationale), `:267-269` ("App Check … needs a reCAPTCHA host admitted here"); `tools/verify/csp/check-csp.mjs:1-30` checks (a)–(e), none on `frame-src` / third-party hosts; no `check-csp.spec.mjs` exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A.6  | ONE switch OFF / MONITOR / ENFORCE                                                              | STILL OPEN                                        | `apps/functions/src/lib/flags.ts:14-17` `defineBoolean` only; `config/feature-flags.json` booleans only; `tools/flags/write-functions-env.mjs:56` `manifestErrors` refuses non-booleans, `:41` `RESERVED_PREFIXES` (`FIREBASE_`), `:109-118` `chooseEnvironment`, `:120-178` writes `.env.<project>` + `.env.local`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A.7  | the edge logs the App Check outcome on the outcome line                                         | STILL OPEN                                        | `apps/functions/src/edge.ts:1022-1037` `invocationContext` (`callable`, `operationId`, `uid`, `roles`), `:1142-1151` the ONE line (`...context, errorCode, wireStatus, durationMs, inputDigest`), `:1116-1120` the untraced sink writes none (RU-24); `LogContext` scalars only (`libs/ecs-core/src/ports/telemetry.port.ts:54-57`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A.8  | the platform's own App Check mechanics                                                          | FOUND OUT (node_modules)                          | `firebase-functions@7.2.5` `lib/v2/providers/https.js:131-139` (`enforceAppCheck` / `consumeAppCheckToken` resolved with `.value()` AT DEFINITION); `lib/common/providers/https.js:337-373` (`checkAppCheckToken`: no header → `MISSING`; a throw → `INVALID`; `request.app` set only when `VALID`), `:437-453` (the bare `unauthenticated` refusal before the handler); `firebase-admin@13.10.0` `app-check/app-check.js:72-91` (`{ consume: true }` answers `alreadyConsumed`, never throws on a replay)                                                                                                                                                                                                                                                                                                                                                                                               |
| A.9  | the emulator's behaviour                                                                        | FOUND OUT                                         | `firebase-tools/lib/emulator/functionsEmulator.js:1004-1008` sets `skipTokenVerification`; with it `unsafeDecodeAppCheckToken` decodes WITHOUT verifying (`https.js:232-273`): a non-JWT decodes to `{}` → `VALID`, but a JWT-shaped token whose payload segment is base64url `null` makes it read `.sub` of `null` → TypeError → `INVALID` (`:368-373`; probed with `'bnVsbA.bnVsbA.'`, which matches `JWT_REGEX` `:13`); no header is `MISSING`; `alreadyConsumed` is always `false` (`:343-352`), so only `REPLAYED` is unobservable — §0.4 item 1                                                                                                                                                                                                                                                                                                                                                    |
| A.10 | replay protection on eraseClient / previewClientErasure / exportClientData / startImpersonation | STILL OPEN                                        | `apps/functions/src/main.ts:1116` (`LOG_DIGEST_SECRETS`), `:1159` (`{ memory, ...WALK_IN_SECRETS }`), `:1176` (`WALK_IN_SECRETS`), `:1194` (`{ timeoutSeconds, memory, ...WALK_IN_SECRETS }`); the library refuses no replay (A.8) — the edge must                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A.11 | step-up for the erasure (R47)                                                                   | DECIDED → S-RU-22 (flagged, not built)            | `HANDOFF.md:3082` (Phase 3 flag 6), `audit-hardening-phase-3.md:214` (P3-L-13: "Law 7.3 (no elapsed-time rule added to T2)"); `flatten-spec.md:532-558` (T2, the closed list Law 7.3 names); preflight P8 FAILs by design (`preflight.mjs:91`) — no deployed re-verification can succeed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A.12 | preflight row: the mode, refusing ENFORCE without a site key                                    | STILL OPEN                                        | `tools/verify/preflight/preflight.mjs:84-95` `CHECKS` P1–P9, `:97-108` `SUBJECTS`, `:110-113` `SCOPES`, `:427-461` `checkBundle` (P4's literal search), `:1383-` `liveReaders`; it already imports `../../seed/load-domain.mjs` (`:32`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A.13 | docs                                                                                            | STILL OPEN                                        | `docs/production-deploy.md:446-449` (the budget bullet), `:963` (§8 row "Not wired … Leave enforcement OFF"); `apps/functions/src/main.ts:196` comment ("no export sets … App Check"); `csp-baseline.md:267-269`; runbook P-row lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A.14 | the web's App Check failure modes                                                               | FOUND OUT → S-RU-31                               | `@firebase/app-check@0.12.0` esm `:1193-1199` (`loadReCAPTCHAEnterpriseScript`: `script.onload` only — no `onerror`, no timeout), `:1102-1121` (`initializeEnterprise`: the Deferred settles only inside `grecaptcha.ready`), `:1146-1150` (`getToken$1` awaits it), `:852-868` (`getLimitedUseToken$1`: no catch), `:1321-1349` (`getToken(true)` throws `recaptcha-error` / `throttled` / `initial-throttle`); `@firebase/functions@0.13.5` esm `:367-383`, `:585-597`, `:614-621` (the token awaited in `makeAuthHeaders` BEFORE `failAfter`), `:332-336` (a LATER App Check instance is still picked up, `appCheckProvider.get()`); Firestore, Auth and Storage await the same token per request. A script that never loads hangs every call; a limited-use token the provider cannot mint rejects the call before it leaves (`callable-client.adapter.ts:88-99` → `PIPELINE_UNKNOWN`) — §0.4 item 5 |
| B.1  | `trackError(error)` hands the raw `Error` to Error Reporting                                    | STILL OPEN                                        | `apps/functions/src/adapters/console-telemetry.adapter.ts:159-164` `sink.error(error, payload)`; RU-38's `errorField` (`:113-128`) runs only on a top-level `Error` VALUE of `fields` (`withScope`, `:135-146`); one production caller `edge.ts:1053` (`unexpected`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| B.2  | a thrown non-`Error` is written unscrubbed                                                      | STILL OPEN (same defect)                          | `console-telemetry.adapter.ts:64-72` `describe`, `:163` `thrown: describe(error)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B.3  | store failures carrying `String(error)`                                                         | STILL OPEN (same defect, beyond the brief's text) | `firestore-accounts.adapter.ts:37`, `firestore-coupons.adapter.ts:35`, `firestore-settings.adapter.ts:34`, `firestore-audit.adapter.ts:96` (a LOG field) and `:134`, `main.ts:367` (`settledCommit`: `writeFailed(null, String(cause))`, logged by `wire/loyalty.wire.ts:89-91`); the idiom they skip: `adapters/store-answer.ts:5-25` ("never the SDK's message")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B.4  | the web counterpart                                                                             | DONE                                              | `libs/infrastructure/firebase-app/src/lib/reporting-error-handler.ts:166-216` (`errorIssue` → `ClientIssueSystem.compose`: scrubbed message, one frame), `callable-client.adapter.ts` `composeTransport` (name + code); no raw `Error` leaves the browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C.1  | an erased account's live ID token can upload an avatar                                          | STILL OPEN                                        | `storage.rules:41-47` (owner + size + type only); Phase 3 flag 23 (`HANDOFF.md:3103-3106`); `rules_version = '2'` (`storage.rules:1`); the emulator runs `firestore.get` (`firebase-tools/lib/emulator/storage/rules/runtime.js:255-259`, `:331-343`: a missing document answers `NOT_FOUND` → the rule errors → deny); deploy grants `roles/firebaserules.firestoreServiceAgent` (`lib/rulesDeploy.js:17-18`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C.2  | `startImpersonation` may target an erased (or absent) uid                                       | STILL OPEN                                        | `libs/ecs-core/src/pipelines/start-impersonation.pipeline.ts:46` ("Nothing is read."), `:118-136` (`ports.commit(async () => null, …)`); writer table `audit-hardening-phase-3.md:1191`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C.3  | every other writer the Phase 3 table lists as "not refused"                                     | DECIDED → S-RU-6 (no change)                      | `audit-hardening-phase-3.md:1180-1191`: lifecycle writers, `requestWaitlist`, `redeemInvitation`, the waitlist matcher write no personal value; old-visit notes / photos are swept by the ERASED re-sweep (P3-L-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D.1  | `appointmentNotes` document id is caller text                                                   | STILL OPEN                                        | `firestore.rules:360-366`; `HANDOFF.md:2603-2611` ("owner flag"); the id IS the appointment's (`libs/infrastructure/firestore/src/lib/appointment-notes.adapter.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D.2  | `appointmentPhotos` document id                                                                 | STILL OPEN                                        | `firestore.rules:379-386`; minted only by `AppointmentPhotoId.of(ports.nextId())` (`pipelines/attach-visit-photo.pipeline.ts:85`) = `crypto.randomUUID()` (`libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts:30-32`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D.3  | `scheduleExceptions` document id                                                                | STILL OPEN                                        | `firestore.rules:570-577` (`allow write: if mayEditRoster()`); the id is `BusyKey.of(barberId, localDate)` = `${barberId}__${localDate}` (`primitives/busy-key.primitive.ts:21-24`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D.4  | `keys().hasOnly([…])` on notes and photos                                                       | STILL OPEN                                        | `HANDOFF.md:2610-2611`; the key tables exist, compile-checked: `systems/governed-change.system.ts:82-109` (`NOTE_KEYS`, `PHOTO_KEYS`, `EXCEPTION_KEYS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D.5  | an `appointmentPhotos` create pins `photoOrigin` and a `SHOT`'s `path` (Phase 3 flag 26)        | STILL OPEN → S-RU-7, S-L-27                       | `audit-hardening-phase-3.md:2809-2818` (flag 26), carried at `HANDOFF.md:3110-3112`; the one SHOT path minter `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts:219-220` (`appointmentPhotos/${appointmentId}/${photo.id}`); `PhotoOrigin` = `SHOT` / `LIBRARY` (`components/photo-origin.data.ts:2-5`); a LIBRARY photo keeps the library object's path as given (`pipelines/attach-visit-photo.pipeline.ts:177`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E.1  | an admin path that changes `users.roles`                                                        | STILL OPEN                                        | the only writers: `completeRegistration` (`RegistrationSystem.settle`), the dev seed, the console; `firestore.rules:202-233` (`allow create, update, delete: if false` — no rules change needed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| E.2  | "refreshes the custom claims"                                                                   | DECIDED → S-RU-10 (premise corrected)             | no `setCustomUserClaims` in code (only a spec mock, `adapters/auth-claims.adapter.spec.ts:16`, `:26`, `:107`); roles reach a token only as developer claims of the custom token minted at sign-in (`verify-otp.pipeline.ts` / `complete-registration.pipeline.ts` → `RegistrationSystem.claimsFor`); `AuthAdminPorts` = provision / mint / setDisplayName (`ports/identity.port.ts:226-230`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E.3  | the audit row inside the `users` commit                                                         | PARTLY DONE (idiom)                               | `AuditContext.Profile` already carries `profileRolesFrom` / `profileRolesTo` (`components/audit-context.data.ts:590-600`, `profileWithTags` `:344`); their overrides exist (`firestore.indexes.json`: `auditLog.profileRolesFrom/To` `indexes: []`); the trigger's dedupe `AuditSystem.auditedByCallable` (`systems/audit.system.ts:794-801`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E.4  | the verb `ACCOUNTS_ROLES_CHANGED`                                                               | DECIDED → S-RU-9 (renamed)                        | the pinned prefix regex `components/audit-context.data.spec.ts:68` `/^(BOOKING\|LOYALTY\|OPS\|PROFILE\|GOVERNANCE\|GOVERNED\|IDENTITY\|PRIVACY)_[A-Z_]+$/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E.5  | last-admin and own-roles guards                                                                 | DECIDED → S-RU-11                                 | `Roles.ADMIN = [admin, sysadmin]` (`components/roles.data.ts:72`), `Roles.PRIVACY = [admin]` (`:93`, the owner-admin precedent); `users.roles` single-field index OFF (`firestore.indexes.json:920-924`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E.6  | an admin UI entry point                                                                         | STILL OPEN → S-RU-13                              | the card's admin privacy block (`libs/features/staff/client-card/src/lib/client-card.store.ts:1640-1666`) is the precedent surface; the card already loads the stored `User` (`:644`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F.1  | the staff search returns walk-in records                                                        | DONE                                              | `libs/features/staff/dashboard/src/lib/visit-editor/client-search.ts:63-74` (`recordOption`: a walk-in as `guest-<customerId>`, `noAccount: true` — the id rides only inside the key)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F.2  | the card opens on a walk-in record                                                              | STILL OPEN                                        | `ClientCardSubject` has no record id (`client-card.contracts.ts:45-56`); `cardSubjectOf` (`staff-visit-editor.ts:7019-7029`); the store reads nothing without `subject.userId` (`client-card.store.ts:1628-1630`); the privacy block needs `customerId()` (`:1652`); a stored visit's WALK_IN seat carries `subjectCustomerId` (`components/seat-occupant.data.ts:147-153`) but `personOf` drops it (`staff-dashboard.ts:3606-3617`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F.3  | export / erasure on a record with no account                                                    | DONE (server)                                     | Phase 3 flag 11 (`HANDOFF.md:3086-3091`: "the callable takes the record id, but no UI reaches it"); `customers` read: `worksTheBook()` (`firestore.rules:408-413`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F.4  | a record read by id on the web                                                                  | STILL OPEN                                        | `CustomerPorts = { loadCustomerForUser }` (`ports/identity.port.ts:175-178`), the token `CUSTOMER_PORTS` (`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts:111`), the adapter `libs/infrastructure/firestore/src/lib/customers.adapter.ts:32`, its lazy binding `app.config.ts:532-540`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G.1  | `blockReason` / `blockedUntilUtcMs` are not audited                                             | NOT IN THE BRIEF'S §2 — stays carried             | `HANDOFF.md:2599-2600` (the WS-3 inventory's R11); none of the brief's six workstreams names it — HANDOFF keeps it in the carried list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| G.2  | governed rows carry `auditOperationId: null` beside a `writeOperationId`                        | NOT IN THE BRIEF'S §2 — stays carried             | `HANDOFF.md:2601-2602`; same reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 0.2 Rulings (every law / brief conflict, every rename — the higher source applied)

Each row quotes both sides; the applied side is the higher one (brief §1
hierarchy). Names the brief proposes are proposals (Phase 0–2 brief §1 item
5): every rename is a row.

**WS-B — error reports scrubbed**

- **S-RU-1 (B) the scrub stays in the adapter, through RU-38's helper.** Brief: _"the console-telemetry adapter … reports errors through the same scrub the fields get (or the repo's existing scrubber, `ClientIssueSystem.scrub` idiom), keeping the error name, a scrubbed message and the stack frames' file:line, never values"_. Law 4 (an adapter holds no business logic): rewriting an `Error` into a scrubbed entry is sink formatting, and RU-38 already placed `errorField` (`console-telemetry.adapter.ts:113-128`) over the pure masks `ClientIssueSystem.scrub` / `frame`. Applied: `trackError` writes ONE whole ERROR entry through the existing `sink.write` (the OR-34 branch's own idiom, `:150-153`) — `message` is `errorField(error).stack` (`<name>: <scrubbed message>` + each `    at <frame>` line), `error` is the `{ name, code, message, stack }` struct — so Error Reporting still groups by the server's frames; `cause`, `details` and every other own property are dropped; a thrown non-`Error` is `ClientIssueSystem.scrub(describe(thrown))`. No new helper, no system change. The residual is recorded, not hidden (S-L-25): `ClientIssueSystem.scrub` masks e-mails, token runs and digits (`client-issue.system.ts:244-253`), so a name or free text inside an SDK message survives it — OR-34 accepted the same residual for the client sink and RU-38 for an `Error` inside `fields`, and the brief asks for "a scrubbed message"; the PB spec pins the residual (§4 PB), and the stricter form (the message replaced by `FailureCodeSystem.codeOf(error)`) is the owner's one-line reversal (§7 item 20).
- **S-RU-2 (B) the five `String(error)` store failures join the store-answer idiom.** Brief: silent (it names `trackError` only). `store-answer.ts:5-11`: _"A failure's `reason` is the SDK's canonical code … never the SDK's message"_; R36 / T5 (an SDK message can carry a document's values). Applied as its own DEP (S-DEP-2, droppable without touching S-DEP-1): `readFailed` / `writeFailed` at the four adapter sites, `RepositoryError.writeFailed(null, FailureCodeSystem.codeOf(cause))` in `settledCommit`, and the audit adapter's failure line names the code as `reason`.
- **S-RU-3 (B) the web half is DONE.** Brief: _"(and any web counterpart)"_. §0.1 B.4: the browser never sends a raw `Error`; nothing to build.

**WS-C — an erased person can do nothing**

- **S-RU-4 (C) the Storage guard is ONE cross-service read and fails closed.** Brief: _"`storage.rules` must refuse an avatar write when `users/{uid}.accountStatus` is `ERASED` (a `firestore.get` cross-service read — confirm the rules version supports it and the emulator runs it)"_. Confirmed (§0.1 C.1). Applied: one `firestore.get` per avatar create / update, evaluated LAST (after owner, size and type); an absent `users` document refuses (every app account has one — `verifyOtp` writes the stub; the seeds write avatars with the Admin SDK, which bypasses rules); a delete stays the owner's (an erased person may always drop their own picture); a `BLOCKED` account still uploads (not in scope).
- **S-RU-5 (C) `startImpersonation` reads its target inside its own commit.** Brief: _"refuse `ERASED` (and any absent / non-registered target the pipeline can already see) with a coded refusal, from the read set the pipeline already holds (add a read only if none exists)"_. None exists (`:118-136` reads nothing), so one `tx.get(users/{target})` is added inside the existing `ports.commit` (Law 4: the transaction is the sandwich — an erasure committing meanwhile is serialised by Firestore). Applied: absent → `GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND` (`not-found`), `ERASED` → `GOVERNANCE_IMPERSONATION_TARGET_ERASED` (`failed-precondition`), a stub that never finished registering (`registrationState` `PROVISIONED` — on the SAME document: `entities/user.entity.ts:22-25`, `Registration.isRegistered` `components/registration.data.ts:68-70`) → `GOVERNANCE_IMPERSONATION_TARGET_NOT_REGISTERED` (`failed-precondition`, the twin of `GOVERNANCE_ROLES_TARGET_NOT_REGISTERED`), in that order, decided by `ImpersonationSystem.admitTarget` (Law 3, over `AccountLifecycle.isErased` and `Registration.isRegistered`). A `BLOCKED` account stays startable (S-L-13: support may need to see what a blocked client sees). No words (OR-55: _"A code no web surface can reach gets no words"_ — OR-24 removed the impersonation UI).
- **S-RU-6 (C) the rest of the Phase 3 writer table stays as decided.** Brief: _"Any other writer the Phase 3 erasure writer table lists as 'not refused' — check each"_. Checked (`audit-hardening-phase-3.md:1180-1191`): lifecycle writers, `requestWaitlist`, `redeemInvitation`, the matcher's notifications write no personal value (ids, tags, shop copy); notes and photos on an OLD visit would need a visit → subject → account walk in rules (two `get()`s per write) and are swept by the next ERASED call (P3-L-19). Only C.1 and C.2 change.

**WS-D — rules the audit found missing**

- **S-RU-7 (D) each id is tied to what it names, at the cheapest proof.** Brief: _"Add the rule `exists(…/appointments/$(appointmentId))` … and the same treatment for `appointmentPhotos` / `scheduleExceptions` ids where their id shape can be tied to an existing document or a strict id pattern; the optional `keys().hasOnly([…])` on the notes and photos rules"_. Applied: notes — `exists(appointment)` (one read) + `hasOnly`; photos — a strict UUID id pattern (the one minter, §0.1 D.2) + `exists(appointments/<body's appointmentId>)` (one read) + `hasOnly`; exceptions — the id bound to the body (`dayDocId == barberId + '__' + localDate`, zero reads) + a date shape + `hasOnly` (on exceptions too: the same key table exists). No `exists(barbers/…)`: a multi-day block writes N exception documents in ONE client transaction (`scheduling.adapter.ts`), and rules allow a bounded number of access calls per batch (S-L-14). Deletes unchanged (a stray note or photo can always be removed). Law 5 holds: every key tested is a root key. Phase 3 flag 26 (`audit-hardening-phase-3.md:2809-2818`, carried at `HANDOFF.md:3110-3112`) is the same rule's missing half and is built here (S-L-27): the photo create also requires `photoOrigin in ['SHOT', 'LIBRARY']` and, for a `SHOT`, `path == 'appointmentPhotos/' + appointmentId + '/' + photoId` — zero reads, the one minter's own shape (`appointment-photos.adapter.ts:219-220`); a `LIBRARY` photo's `path` names the shop's library object and stays unpinned.
- **S-RU-8 (D) the rules-text pins change on purpose.** `libs/infrastructure/firestore/src/lib/stamp-window.rules-text.spec.ts:90-112` pins the exact folded `allow` strings of notes and photos; the new strings keep `worksTheBook()`, the author / taker equality and the ONE `stampInWindow(` each (its counts at `:73-80` unchanged) — a declared DEP (S-DEP-5), never a weakening.

**WS-E — an audited role change**

- **S-RU-9 (E) rename `ACCOUNTS_ROLES_CHANGED` → `PROFILE_ROLES_CHANGED`.** Brief: _"`ACCOUNTS_ROLES_CHANGED` or the lawful name — roles before/after as tags, never names"_. The verb regex is pinned (`audit-context.data.spec.ts:68`, no `ACCOUNTS_` family). Applied: `AuditAction.ProfileRolesChanged: 'PROFILE_ROLES_CHANGED'`, a member of `ProfileAction`, written through `AuditContext.profileWithTags` with `profileFields: ['roles']`, `profileRolesFrom` / `profileRolesTo` (closed `Role[]` tags) — zero new fields, zero index overrides (`auditLog.profileRolesFrom/To` already `indexes: []`).
- **S-RU-10 (E) "refreshes the custom claims" = the next sign-in mints them; the callable revokes.** Brief: _"writes `users.roles` and refreshes the custom claims, revokes the target's refresh tokens so the new claims apply"_. §0.1 E.2: no claims are persisted anywhere — `RegistrationSystem.claimsFor(…, user.roles, …)` mints them into every custom token at sign-in, from `users.roles`. A `setCustomUserClaims` writer would add a second source of truth and arm the erasure's claim check (`AuthRolesPorts.loadAuthRoles`, P3-L-16) with values the trigger never audits. Applied: the commit writes `users.roles`; after it, `revokeRefreshTokens(target)` forces the target's next refresh to fail, so their next session is minted from the written roles (proved in the integration spec by minting through the real claims path, §4 PE2). After a SUCCESSFUL revoke an already-issued ID token keeps its roles until it expires (≤ 1 h). After a FAILED one (`GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED`) the old roles live as long as the target's session — developer claims ride every ID token refreshed from it (`auth-claims.adapter.ts:65`, `HANDOFF.md:2595`) — so the failure must not be forgettable: the card keeps a retry that re-sends the stored set (S-L-18), the pipeline logs `LogEvent.RolesSessionsNotRevoked`, and an alert fires on any occurrence (PE2, `tools/ops`). The pipelines that matter re-read STORED roles (privacy, backfill, `setRoles` itself); owner flag §7 item 11.
- **S-RU-11 (E) "refuses removing the last admin" holds by construction.** Brief: _"refuses removing the last admin and changing one's own roles"_. Applied: only the owner-admin assigns (`Roles.ASSIGN = [admin]`, S-RU-14), the caller's STORED roles are re-read inside the transaction (and a caller blocked at `now` — `AccountLifecycle.isBlockedAt`, an existing T2 row, ERASED included — is refused `GOVERNANCE_ROLES_FORBIDDEN`: blocking is console-only and revokes nothing, so a blocked admin keeps a working session), and the self guard refuses touching one's own roles — so every admitted plan leaves the caller an admin, and the shop can never lose its last admin through `setRoles`. The system states the invariant (`RoleAssignmentSystem.decide` answers only plans after which the caller — an admin not blocked at `now` — or the target holds `admin`), and a property spec proves it over every caller × target × requested role set; no count query, no `users.roles` index flip (a query nobody's answer could change is cost without proof). Should `ASSIGN` ever widen, the invariant line becomes a real coded refusal in the same function (S-L-15).
- **S-RU-12 (E) one row, credited — the trigger skips the callable's write.** The profile trigger already audits `users.roles` as a process row (`audit.system.ts:207-215`). Applied: the callable's `users` update also writes `profileEditedAtUtcMs: now`, which `AuditSystem.auditedByCallable` (`:794-801`) reads as "audited by a callable" — the 4A-16 / flip-2 §10.15 idiom of `updateProfile`. The entity's doc for the stamp widens from "the owner's own edit" to "a callable-audited profile write" (S-L-17).
- **S-RU-13 (E) the entry point is the staff client card.** Brief: _"an admin UI entry point on an existing staff/admin surface (minimal, new copy flagged)"_. Applied: a «Роли» block on the card beside the admin's privacy block (the existing admin-only card surface, reached through the visit editor's client search), not a new admin page, route or lib. Hidden for the viewer's own account and for a target holding `sysadmin`; the server stays the authority (S-L-18).
- **S-RU-14 (E) "admin-only" is the owner-admin.** Brief: _"an admin-only `setRoles` callable … from the closed `Role` dictionary"_. `Roles.isAdmin` admits the sysadmin; `Roles.PRIVACY` documents the sysadmin as a support role with no business in a client's data (P3-RU-13). Applied: `Roles.ASSIGN = [admin]`; `sysadmin` is never assignable and a target holding it is refused (`GOVERNANCE_ROLES_TARGET_SYSADMIN`) — the vendor role is provisioned out of band.

**WS-F — a staff route to walk-in-only records**

- **S-RU-15 (F) the record id rides as an explicit field, never parsed from a key.** Brief: _"opens a walk-in RECORD's card — the existing card keyed by the record when no account exists"_. `DraftPersonKey.guest(label)` is `guest-${label}` (`ids.primitive.ts:656`): a typed label `cus_x` would collide, so the record id is never read back out of `guest-<id>`. Applied: `ClientCardSubject.customerId: CustomerId | null` (required, `null` for accounts and typed guests), set only by `recordOption` (a record with `userId: null`) and by a stored visit's `WALK_IN` seat (`seat.subjectCustomerId`).
- **S-RU-16 (F) "the dashboard's merged account + record search" is the visit editor's add-client page.** Brief names `client-search.ts`; it is the visit editor's search (`staff-dashboard.ts:5784-` `runClientSearch`), not a global one. Applied there, plus the stored visit's WALK_IN seat (both open the same card). A standalone staff client page is a follow-up (§7 item 13).

**WS-A — App Check**

- **S-RU-17 (A) enforcement lives in the edge, with a coded refusal.** Brief: _"every `onCall` gets App Check enforcement through ONE switch the owner flips at deploy (a functions param / the flags manifest — staged: OFF (today), MONITOR (verify and log `app: MISSING|INVALID`, never refuse), ENFORCE (refuse)); the edge logs the App Check outcome on the outcome line"_. The platform's `enforceAppCheck` refuses BEFORE the handler with a bare `unauthenticated` (`https.js:437-453`): no outcome line of ours, no `errorCode` for `errors.<errorCode>` (Law 7.5), the web reads it as "sign in" (`PipelineError` `codeOfStatus`), and it has no MONITOR state. Applied: the platform option stays unset (the library still verifies every presented token and sets `request.app`); `callableEdge` reads the facts, asks `AppCheckSystem.verdictOf(mode, facts, tokenUse)` FIRST — before decode, digest and the work budget — and refuses through the existing `attempt` / `outcomeOf` path: ONE `callable.refused` line with `errorCode: 'APP_CHECK_REQUIRED'` and the tag. One switch read in one function; zero edits to the 24 option literals for enforcement. Fallback recorded: the platform `enforceAppCheck: APP_CHECK_MODE.equals('ENFORCE')`.
- **S-RU-18 (A) no debug provider in code: the emulator path presents an unsigned emulator token.** Brief: _"the debug provider under the emulators / dev / e2e (a debug token from the environment, never committed as a secret)"_. The debug provider exchanges its token with Google's real endpoint (§0.1 A.3), which a `demo-*` project with `appId: 'REPLACE_ME'` cannot answer (every call would go out headerless — MISSING), and the Functions emulator verifies no signature anyway (A.9). Applied: under `environment.emulators.enabled` the web initialises App Check with a `CustomProvider` whose token is an unsigned, JWT-shaped value built AT RUN TIME (never a literal — gitleaks' JWT rule binds the pre-commit hook) that every real verifier refuses (fail-safe if it ever shipped). A hosted non-production build uses its own reCAPTCHA Enterprise key (staging, §2.A.6 step 2). Debug tokens are for a developer's own device only — never in an environment file, a CI variable or the repo — and are revoked in the console after use (§7 item 6): with `appCheck.siteKey: ''` the SDK never reads `self.FIREBASE_APPCHECK_DEBUG_TOKEN` (`initializeAppCheck` is not called; the SDK reads it only inside it, `@firebase/app-check` esm `:1501-1511`, `:640-659`), and the hash-only `script-src` admits no inline script to set it, so a keyless hosted build cannot carry one.
- **S-RU-19 (A) the switch: a committed manifest → one string param.** Brief: _"a functions param / the flags manifest"_. `.env.<project>` is regenerated by every predeploy (`firebase.json:19-23`), and the flags manifest holds booleans (`manifestErrors`, `:56`). Applied: `config/app-check.json` (`{ development, staging, production }` → `OFF | MONITOR | ENFORCE`), validated and rendered by the same writer as ONE `APP_CHECK_MODE=<mode>` line in `.env.<project>` and `.env.local`, read by `defineString('APP_CHECK_MODE', { default: 'OFF' })` inside each call (the `flagOn` rule: never at load, except the platform's own `consumeAppCheckToken` expression). An UNSET parameter reads as `OFF` silently: `StringParam.value()` answers `''` for an unset variable, not the declared default (`firebase-functions/lib/params/types.js:375-379`) — which is what every in-process run (`test:emulator`, the unit specs) sees, while every CLI-started runtime gets the manifest's line. A NON-EMPTY unknown value reads as `OFF` with ONE `LogEvent.AppCheckModeUnreadable` line per instance (fail-open: the switch "can never lock out the current build"); the writer and P10 refuse it before any deploy.
- **S-RU-20 (A) the development map is MONITOR.** Brief: _"the e2e suite, `verify:p0`, `test:emulator` and the CSP smoke keep passing with enforcement in each mode the emulator can exercise"_. Applied: `development: 'MONITOR'` — so every Functions-emulator journey CI runs (`verify:p0`, `e2e:web`, `verify:csp`) drives the verification path on every call and proves MONITOR never refuses; `staging` and `production` ship `OFF`. `test:emulator` starts NO Functions emulator (`package.json:13`, `--only firestore,auth,storage`): its functions specs run the exports in-process with `APP_CHECK_MODE` unset — OFF (S-RU-19) — so it proves OFF, and `operation-trace.integration.spec.ts` gains one MONITOR case (the mode stubbed before the call: answered, `appCheckOutcome: 'MISSING'`). ENFORCE is exercised by the new `verify:appcheck` journey and by one-off ENFORCE runs of `verify:p0`, `e2e:web` and `verify:csp` at the C_A gate (§6.1 additions), each opened by a probe proving its emulator really runs ENFORCE.
- **S-RU-21 (A) limited-use: the four named callables and `setRoles`; consumption whenever the switch is MONITOR or ENFORCE.** Brief: _"The destructive / sensitive callables (eraseClient, previewClientErasure, exportClientData, startImpersonation) use LIMITED-USE (replay-protected) tokens (`consumeAppCheckToken` + the client's limited-use option) when enforcing"_. Research §3.6.6 / F4 lists role changes as consuming; `setRoles` (E) is as sensitive as `startImpersonation`. Applied: ONE table `CALLABLE_APP_CHECK_TOKEN` (ports tier, beside `OPERATION_ID_FIELD`) drives both the web's `limitedUseAppCheckTokens` and the server's `consumeAppCheckToken`; consumption runs in MONITOR too (`APP_CHECK_MODE.equals('MONITOR').thenElse(true, APP_CHECK_MODE.equals('ENFORCE'))` — never `notEquals('OFF')`, which an unset `''` satisfies), so MONITOR measures exactly the replays ENFORCE will refuse. The consuming verification is an authenticated call to the App Check API (`firebase-admin` `app-check/app-check.js:72-91`, `app-check-api-client-internal.js:90-132`); if the API is off or the runtime account may not call it, the platform reads `INVALID` on every call of the five — an owner step (§7 item 3) and a PER-CALLABLE bar (§7 item 4) keep that from passing into ENFORCE. The library refuses no replay (A.8): the edge refuses `REPLAYED` on those five in ENFORCE.
- **S-RU-22 (A) step-up is decided: not built in Phase 4.** Brief: _"decide lawfully whether a recent-sign-in requirement (`auth_time` within N minutes, re-verified by OTP in the existing flow) is built now; record the decision"_. Law 7.3: the elapsed-time rules on `UtcEpochMs` are _"exactly the list in `flatten-spec.md` §2.3 T2"_ — `auth_time` + N minutes is a new row only the owner may add; the re-verification runs the OTP flow, which no deployed project can complete while P8 FAILs; and the erasure's resumable loop would need a first-call-only window. Applied: not built; owner flag §7 item 9 with the ready contract of §2.A.9 (a later build is mechanical once the owner rules the T2 row and the OTP provider lands). Phase 3 flag 6 stays open with this reason instead of "App Check missing".
- **S-RU-23 (A) the CSP admits exact reCAPTCHA hosts; OR-29's `frame-src 'none'` is superseded for one directive.** OR-29: _"A static hash CSP with exact host allowlists … Exact hosts, never `*.cloudfunctions.net`"_; `csp-baseline.md:89-93`: _"`frame-src 'none'` — the app embeds nothing"_; brief: _"the CSP admits exactly the reCAPTCHA hosts it needs … never widen beyond what reCAPTCHA Enterprise needs"_. Applied (S-L-6): `script-src` + `https://www.google.com/recaptcha/` `https://www.gstatic.com/recaptcha/`; `frame-src` `'none'` → `https://www.google.com/recaptcha/` `https://recaptcha.google.com/recaptcha/`; `connect-src` + `https://content-firebaseappcheck.googleapis.com` — path-scoped, never a wildcard; `check-csp.mjs` (f) pins exactly these. OR-32's rationale stays true (Auth still embeds nothing); the new frames are App Check's. Two recorded trade-offs: (1) the inventory's `connect-src https://www.google.com/recaptcha/` (reCAPTCHA's reload beacons, `a-app-check.md:72`, `:247`) is NOT admitted — Google's reCAPTCHA CSP list names `script-src` and `frame-src`, and the beacons run inside Google's own frame under its own policy; the list could not be re-read from this container (§0.4, not adopted), so staging checks for a `connect-src` violation and a host it shows missing joins in the same PR as its measurement (S-L-6) — with S-RU-31 a blocked request means a headerless call (MISSING), never a hang; (2) `https://www.google.com/recaptcha/` in a `script-src` that holds `'self'` stays path-scoped only while no admitted source redirects (CSP drops a source's path after a redirect; CSP Evaluator flags the host): `firebase.json` hosting has no `redirects` today, only the `**` rewrite, and `check-csp.mjs` check (g) keeps it so.
- **S-RU-24 (A) the refusal is `failed-precondition`, worded once.** The web reads `unauthenticated` as "sign in" and `permission-denied` as "blocked" (OTP); `codeOfStatus` maps `failed-precondition` to `PIPELINE_INVALID_REQUEST` ("repeating the same request cannot succeed" — true for a device without a token). `wordPipelineError` tries the server's code first (`word-pipeline-error.ts:39-51`), so `errors.APP_CHECK_REQUIRED` words it with no `PipelineErrorCode` member and no `CODE_OVERRIDES` row. `APP_CHECK_REPLAYED` gets no words (OR-55: the build sends a fresh limited-use token per call — no web surface reaches it).
- **S-RU-25 (A) `reportClientIssues` is inside the switch.** Brief: _"every callable and `reportClientIssues` refuses requests without a valid App Check token once the owner turns enforcement on"_. Applied: it is; being untraced (RU-24) it writes no line of ours — its MONITOR outcome is read from the platform's own `callable-request-verification` lines (`https.js:285-306`). Trade-off (telemetry from blocked clients is lost under ENFORCE) flagged, §7 item 8.
- **S-RU-26 (A) `verify:p0` presents the emulator token.** Brief: _"the e2e suite, `verify:p0`, `test:emulator` and the CSP smoke keep passing with enforcement in each mode the emulator can exercise"_ — ENFORCE is one of them. Its raw posts (`tools/verify/p0/verify-p0.mjs:208-262`, `:311`) gain an `X-Firebase-AppCheck` header built at run time by ONE shared helper (`tools/verify/app-check/emulator-token.mjs`, also `verify-app-check.mjs`'s), so P0 passes in OFF, MONITOR and ENFORCE (its lines read `VALID`); C_A and the final gate run it under ENFORCE. The headerless refusal is `verify:appcheck`'s to prove. A declared DEP (S-DEP-18).
- **S-RU-27 (A) Firestore and Storage enforcement are console steps.** Brief: _"Firestore and Storage enforcement themselves are console-only — owner steps, not code"_. The web's Firestore and Storage SDKs pick up the same App Check instance once it is initialised (they read the app's `app-check-internal` provider); the owner reads their metrics at MONITOR before flipping each (§7 item 5).
- **S-RU-28 (A) the Trusted Types report-only noise of the reCAPTCHA script is dropped by a second baseline list.** OR-30 / OR-31: the issue reporter drops the MEASURED MapLibre report-only sinks (`csp-baseline.ts:22-26`). The SDK injects `https://www.google.com/recaptcha/enterprise.js` by assigning `script.src` (`@firebase/app-check` esm `:1080`, `:1193-1199`), which trips `require-trusted-types-for 'script'` on every page load once a site key is set. It cannot be measured here (the smoke runs the emulator path). Applied (S-L-22): `RECAPTCHA_REPORT_ONLY_SINKS` holds the two script-injection samples derived from the SDK source and the Trusted Types sample format (`<sink>|<first 40 characters of the value>`), and `RECAPTCHA_REPORT_ONLY_POLICIES` the policy names reCAPTCHA's Closure code is expected to create (`goog#html`), which the report-only `trusted-types angular angular#bundler` (`firebase.json:44-45`) reports under the `trusted-types` directive (the sample is the policy name) — both marked UNMEASURED; a wrong pattern simply drops nothing (fail-visible); the owner's staging smoke measures and corrects it before the production key (§7 item 3). Deferred #3 (enforcing Trusted Types) gains this second blocker.

- **S-RU-31 (A) a client whose App Check fails sends headerless — it never hangs and never fails a call at OFF / MONITOR.** Brief: _"a staged rollout that can never lock out the current build"_. §0.1 A.14: a reCAPTCHA script that never loads (a blocker, a firewall, a network failure, a wrong CSP host) leaves the SDK's readiness unsettled, and Functions, Firestore, Auth and Storage all await the token before they send — every call hangs, whatever the server mode; a limited-use token the provider cannot mint rejects the call before it leaves. Neither reaches the server, so MONITOR cannot see either: the real point of no return is the web deploy that ships a site key (§2.A.6 step 3), not ENFORCE. Applied (S-L-24): (i) the RECAPTCHA_ENTERPRISE branch loads `https://www.google.com/recaptcha/enterprise.js?render=explicit` itself, with `onload` + `onerror` and a bounded wait (`APP_CHECK_SCRIPT_TIMEOUT_MS = 10_000`), and calls `initializeAppCheck` only once `self.grecaptcha?.enterprise` exists — the SDK then reuses it (`getRecaptcha(true)`, esm `:262-267`, `:1107`); on an error or a timeout App Check is never initialised for the page (one client issue reported), so every SDK sends without it (MISSING — measurable, refused only under ENFORCE); the callable client awaits that bounded decision before each call (S-L-5); (ii) `callable-client.adapter.ts` retries a LIMITED_USE call ONCE through the standard `httpsCallable(functions, name)` when the rejection is a `FirebaseError` whose `code` starts with `appCheck/` (the request never left; reported once) — the server still decides: ENFORCE refuses what it would refuse, OFF / MONITOR answer. A shipped key rolls back as `siteKey: ''` + a web deploy.
- **S-RU-32 (A) the smoke half of `verify:csp` is unchanged — a recorded deviation.** Brief: _"the CSP gate `verify:csp` and its static check — update both"_. The static half changes (checks (f), (g)); the smoke builds the `csp-smoke` configuration on the emulator path (`apps/web/project.json:68-83`: emulators on → the `CustomProvider`), which loads no Google script, so no smoke assertion can see the reCAPTCHA hosts. Their proof is the ENFORCE smoke run (§6.1 addition 2) plus the owner's staging smoke with a real key (§2.A.6 step 2, §7 item 3).

**Order and delegation**

- **S-RU-29 the stage order B → C → D → E → F → A.** Task: _"ONE commit per workstream in the order B → C → D → E → F → A (App Check last: it touches every callable and the CSP; or justify another order)"_. Kept: A must list `setRoles` (E) in its limited-use table, its edge change re-pins outcome lines every earlier stage's specs touch, and its journeys (one-off ENFORCE e2e) run over the F card and the E block.
- **S-RU-30 the owner's delegation applied.** Brief §1: _"take the safest reversible, recommended option on every open call, record each as a ruling, and list the owner's own steps … as owner flags — never block on a question"_. Every S-L below is such a call; §7 lists each with its reversal.

### 0.3 The latitude register (S-L-1 … S-L-28, copied into the PR's owner flags)

| L      | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Reason                                                                                                                                                                                                                                                                                                                                                                                                        | Law                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-L-1  | **The switch's home and states** (S-RU-19): `config/app-check.json` → `APP_CHECK_MODE` (`defineString`, default `OFF`). **OFF** = inert: no outcome is reported (`appCheckOutcome: null` on the line), nothing is consumed, nothing refused — today's behaviour. **MONITOR** = the outcome on every line, limited-use tokens consumed, never a refusal. **ENFORCE** = MONITOR + refuse `MISSING` / `INVALID` (`APP_CHECK_REQUIRED`) and `REPLAYED` on a limited-use callable (`APP_CHECK_REPLAYED`). Rollback = `OFF` + a functions-only deploy                                                                                                                                                                                                                                                                                                                                                                                                                                       | one committed, reviewable line per environment; P10 reads the same file; fail-open on an unreadable value                                                                                                                                                                                                                                                                                                     | Law 1 / 6.2 (tags), Law 4 (the edge)                                                                                                                                                                                                                                                          |
| S-L-2  | **Shipped values**: `development: MONITOR` (every emulator journey and CI), `staging: OFF`, `production: OFF`; an emulator-only override `CREATIVO_APP_CHECK_MODE` (env) / `--app-check <MODE>` honoured for a `demo-*` project only, refused (exit 2) for a real one, and written to BOTH `.env.<project>` and `.env.local` (the emulator loads `.env.local` LAST — `firebase-tools/lib/functions/env.js:179-187`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | CI proves MONITOR never refuses; the override lets the journeys run ENFORCE; a name distinct from the param keeps a stray shell variable out of vitest                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                             |
| S-L-3  | **Limited-use set**: `eraseClient`, `previewClientErasure`, `exportClientData`, `startImpersonation`, `setRoles` (S-RU-21), by ONE table `CALLABLE_APP_CHECK_TOKEN`; the server consumes when the switch is `MONITOR` or `ENFORCE` (never on an unset `''`); the web always asks a limited-use token for those five (one extra exchange per call), falling back ONCE to a standard call when the provider cannot mint one (S-RU-31)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | client and server cannot drift; MONITOR measures replays before ENFORCE                                                                                                                                                                                                                                                                                                                                       | Law 9 (one table, ports tier)                                                                                                                                                                                                                                                                 |
| S-L-4  | **The emulator token**: a `CustomProvider` under `environment.emulators.enabled`, its token unsigned and JWT-shaped (`sub` = the app id), built at run time by `emulatorAppCheckToken(appId)`; the Node journeys (`verify:appcheck`, `verify:p0`) build the same shape through ONE helper, `tools/verify/app-check/emulator-token.mjs` (another runtime; it also builds the INVALID token), both pinned by specs to firebase-functions' JWT shape (`https.js:13`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | the Functions emulator decodes without verifying; a literal would trip gitleaks' JWT rule; a real verifier refuses it                                                                                                                                                                                                                                                                                         | Law 7.4 n/a (not a domain value)                                                                                                                                                                                                                                                              |
| S-L-5  | **Web init eager, bounded**: `provideFirebaseAppCheck(appCheckConfigOf(environment))` registers `FIREBASE_APP_CHECK: Promise<AppCheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null>`and an environment initializer that starts it at boot; EMULATOR resolves at once,`NONE`(no site key, production today) resolves`null`and loads nothing, RECAPTCHA_ENTERPRISE settles within`APP_CHECK_SCRIPT_TIMEOUT_MS` (S-L-24); the callable client awaits it before each call, so no callable — the early issue send included — leaves before App Check is decided, and none waits beyond the bound | the Functions SDK attaches a token once the App Check component exists, a later instance included (`@firebase/functions` esm `:332-336`); under ENFORCE a boot call sent before a slow script would be refused; Firestore / Auth / Storage do not wait (they attach the token once it exists) | `angular-ui.md` (SDK in infrastructure) |
| S-L-6  | **CSP hosts** (S-RU-23): `script-src` + `https://www.google.com/recaptcha/`, `https://www.gstatic.com/recaptcha/`; `frame-src` = `https://www.google.com/recaptcha/`, `https://recaptcha.google.com/recaptcha/`; `connect-src` + `https://content-firebaseappcheck.googleapis.com`. No `img-src` / `style-src` change; a host staging shows missing is added in the same PR as its measurement. Not admitted: the inventory's `connect-src https://www.google.com/recaptcha/` (S-RU-23 — staging checks for its violation). Check (g): the hosting entry has no `redirects`                                                                                                                                                                                                                                                                                                                                                                                                           | Google's reCAPTCHA CSP list + the SDK's exchange host; with S-RU-31 a blocked script or request means a headerless call (MISSING, visible in MONITOR), never a hang; a redirect would void the `script-src` path scope                                                                                                                                                                                        | OR-29 (exact hosts)                                                                                                                                                                                                                                                                           |
| S-L-7  | **Step-up**: not built; owner flag with the §2.A.9 contract (S-RU-22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | needs a T2 row, a working OTP sender and new copy                                                                                                                                                                                                                                                                                                                                                             | Law 7.3                                                                                                                                                                                                                                                                                       |
| S-L-8  | **Preflight P10** (both scopes): `OFF` → PASS; `MONITOR` → PASS (INFO `site key empty — every request reads MISSING` when it is); `ENFORCE` → FAIL when `environment.production.ts`' `appCheck.siteKey` is empty or unreadable; in the web scope FAIL when the built bundle does not carry the key (P4's literal search over `bundle()`); in the functions scope — which never calls `bundle()` (`preflight.spec.mjs:1360-1361`; a functions predeploy has no web build) — FAIL unless the LIVE web carries the key literal (`liveBundle()`: the `web` hosting target of `.firebaserc` for the project, `https://<site>.web.app/`, the `main-*.js` its `index.html` names; fails closed — unreachable or P6 failing = FAIL, never SKIP), PASS otherwise with INFO naming the per-callable MONITOR bar (§7 item 4); an unknown mode FAILs. The mode = `config/app-check.json[chooseEnvironment({ projectId, requested: FLAGS_ENV })]`, the writer's own chooser imported, never copied | the P7/P8 idiom; an ENFORCE flip is judged on what is LIVE, not the source (a key committed with the flip but not yet hosted fails); passes on today's tree (`OFF`); the exact row lists `preflight.spec.mjs:1404-1416`, `:1679-1699` gain `['P10', Pass]` ("P8 alone stops it" holds)                                                                                                                        | OR-35                                                                                                                                                                                                                                                                                         |
| S-L-9  | **The ENFORCE proofs**: a new journey `pnpm run verify:appcheck` (`tools/verify/app-check/verify-app-check.mjs`: ENFORCE then MONITOR, raw callable posts with and without the header, §2.A.7), a CI step after `verify:p0`; and, at the C_A gate only, the ENFORCE runs of `verify:p0`, `e2e:web` and `verify:csp`, each opened by a mode probe (one headerless post → `APP_CHECK_REQUIRED`, §6.1 addition 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | the only end-to-end proof the edge and the platform cooperate; the e2e browser carries the emulator token, so the whole suite must pass under ENFORCE                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                                                                             |
| S-L-10 | **Wire and copy** (S-RU-24): `APP_CHECK_REQUIRED` / `APP_CHECK_REPLAYED` → `failed-precondition`, no wire params; words for `APP_CHECK_REQUIRED` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the web's existing status reading; OR-55                                                                                                                                                                                                                                                                                                                                                                      | Law 7.5, OR-55                                                                                                                                                                                                                                                                                |
| S-L-11 | **The Storage rule** (S-RU-4): one `firestore.get`, last, `!= 'ERASED'`; absent `users` doc refused; delete unchanged; `BLOCKED` unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | one billed read per upload, one cross-service call per request                                                                                                                                                                                                                                                                                                                                                | Law 5 (root key)                                                                                                                                                                                                                                                                              |
| S-L-12 | **The Storage rules spec's home**: `libs/infrastructure/firestore/src/lib/storage.rules.integration.spec.ts` (the lib that already holds the Firestore rules spec and the emulator test env), run by `test:emulator` (which starts the Storage emulator), project `demo-creativo-test` (the Storage emulator resolves `firestore.get` against its own project), run-unique uids deleted in `afterAll`; the lib's `test-integration` inputs gain `firestore.rules` and `storage.rules` (closes the carried cache item, `HANDOFF.md:2631-2633`)                                                                                                                                                                                                                                                                                                                                                                                                                                         | no new Nx target                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                                                                                                                             |
| S-L-13 | **Impersonation target scope** (S-RU-5): refuse absent, `ERASED` and not `REGISTERED` (a `PROVISIONED` stub), in that order; `BLOCKED` stays startable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | the brief's three cases, all from the one read                                                                                                                                                                                                                                                                                                                                                                | Law 3                                                                                                                                                                                                                                                                                         |
| S-L-14 | **Rules id proofs** (S-RU-7): photo id `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`; exception id bound to its body; no `exists(barbers/…)`; deletes unchanged; `hasOnly` on all three; a parity spec ties each rules list to a compile-checked key table of the entity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | zero or one read per write; a new entity field fails a spec, not production                                                                                                                                                                                                                                                                                                                                   | Law 5, Law 6.1                                                                                                                                                                                                                                                                                |
| S-L-15 | **`setRoles` guards**: caller gate on claims at the wire, then the STORED caller re-read in the transaction (`Roles.ASSIGN = [admin]`, and not blocked at `now` — `AccountLifecycle.isBlockedAt`, ERASED included); the row's actor is `Actor.forCaller(adminUserId, caller.roles)` — the STORED roles, never the token's (the erasure's idiom, `erase-client.pipeline.ts:413-416`); self refused; target absent / not `REGISTERED` / `ERASED` / holding `sysadmin` refused; requested set non-empty, known, never `sysadmin`, normalised to dictionary order; an unchanged set commits nothing (no row) but still revokes (an idempotent retry finishes a revoke that failed) — a forced sign-out, so EVERY successful revoke logs `roles.sessions_revoked { targetUserId, rolesChanged }` (S-L-26); revoke after the commit; a failed revoke answers `GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` (`unavailable`, retryable)                                                             | the roles are committed either way; a retry of the same act re-revokes                                                                                                                                                                                                                                                                                                                                        | Law 3, Law 4                                                                                                                                                                                                                                                                                  |
| S-L-16 | **Revoke on every change**, a promotion included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | a promoted user's custom-token claims also only change at the next sign-in                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                             |
| S-L-17 | **Dedupe through `profileEditedAtUtcMs`** (S-RU-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the proven `updateProfile` idiom; the alternative (two rows) is the owner's to choose                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                                                                             |
| S-L-18 | **The card's «Роли» block**: admin viewer (`Roles.assignsRoles`), an account subject with a stored `User`, not the viewer, not holding `sysadmin`, `client.privacy`-independent, online; five toggles (client, barber, receptionist, content_manager, admin), Save disabled when unchanged or empty EXCEPT while the store's last answer for this subject is `GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` (that line stays and Save re-sends the stored set — the only remedy for a failed revoke, S-RU-10); "may offer" = `RoleAssignmentSystem.offerOf`, "changed" = `changeOf`, "may save" = `saveOf` (Law 10.2: the store calls them inside `computed()`, the presenter receives the answers); one operation id per act, reused on retry                                                                                                                                                                                                                                               | the privacy block's own idioms                                                                                                                                                                                                                                                                                                                                                                                | Law 10                                                                                                                                                                                                                                                                                        |
| S-L-19 | **The record-keyed card**: head (the seat's label, unchanged), the admin privacy block and the erasure state from the record (`erasureStatus`); no stats / history / photos / vouchers for a record yet (all are CustomerId-keyed — a follow-up)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | what the brief asks; e2e `staff-walk-in.spec.ts` (a barber viewer) unchanged                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                             |
| S-L-20 | **`trackError`'s entry** (S-RU-1): `{ ...scope, ...context, error: { name, code, message, stack }, severity: 'ERROR', message: stack }` through `sink.write`; non-`Error`: `sink.error('non-error thrown', { …, thrown: scrub(describe(thrown)) })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Error Reporting groups an ERROR entry by the V8 stack in `message`, as `logger.error(err)` did                                                                                                                                                                                                                                                                                                                | R36 / T5                                                                                                                                                                                                                                                                                      |
| S-L-21 | **The five `String(error)` sites included** (S-RU-2) as their own DEP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | same defect, one idiom, droppable                                                                                                                                                                                                                                                                                                                                                                             | `store-answer.ts`                                                                                                                                                                                                                                                                             |
| S-L-22 | **reCAPTCHA Trusted Types baseline** (S-RU-28): `RECAPTCHA_REPORT_ONLY_SINKS = [/^HTMLScriptElement src\|https:\/\/www\.google\.com\/recaptcha\//, /^HTMLScriptElement src\|https:\/\/www\.gstatic\.com\/recaptcha\//]`, UNMEASURED, beside the MapLibre list, and `RECAPTCHA_REPORT_ONLY_POLICIES = ['goog#html']` for the `trusted-types` directive's samples (the policy name), UNMEASURED; read by the page's reporter only (the smoke never loads reCAPTCHA); the staging measurement records BOTH directives                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | a known report-only noise would spend the issue throttle and light `client_issue_count`; a wrong pattern drops nothing                                                                                                                                                                                                                                                                                        | OR-30                                                                                                                                                                                                                                                                                         |
| S-L-23 | **`reportClientIssues` inside ENFORCE** (S-RU-25), standard tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | the brief; excluding it is one table row (§7 item 8)                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                                             |
| S-L-24 | **The client fail-safe** (S-RU-31): the RECAPTCHA_ENTERPRISE branch loads `enterprise.js?render=explicit` itself (`onload` / `onerror`, `APP_CHECK_SCRIPT_TIMEOUT_MS = 10_000` — named, documented) and initialises App Check only once `grecaptcha.enterprise` exists; error / timeout → `null` for the page + one client issue; a LIMITED_USE call rejected with an `appCheck/*` `FirebaseError` is retried once as a standard call (reported once)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a blocked script must mean MISSING (measurable), never a hang; the server keeps deciding; the provider's own `script.src` assignment is the sample S-L-22 already lists                                                                                                                                                                                                                                       | `angular-ui.md` (SDK in infrastructure), Law 4                                                                                                                                                                                                                                                |
| S-L-25 | **The scrub's residual** (S-RU-1): names and free text inside an `Error`'s message are not masked (`ClientIssueSystem.scrub` masks e-mails, token runs, digits); kept, pinned by a PB spec case, flagged (§7 item 20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the brief's "a scrubbed message"; OR-34 and RU-38 accepted the same residual; the reversal (message = the canonical code) is one line                                                                                                                                                                                                                                                                         | R36 / T5 (residual flagged)                                                                                                                                                                                                                                                                   |
| S-L-26 | **Every revoke logged**: `roles.sessions_revoked { targetUserId, rolesChanged }` (ids and a boolean) after each successful revoke, the no-op path included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | an unchanged `setRoles` is a forced sign-out of another account with no row; the line makes it visible; refusing the no-op would remove the only retry of a failed revoke                                                                                                                                                                                                                                     | R36 / T5                                                                                                                                                                                                                                                                                      |
| S-L-27 | **Phase 3 flag 26 built** (S-RU-7): `photoOrigin in ['SHOT','LIBRARY']`; a `SHOT`'s `path` equals `'appointmentPhotos/' + appointmentId + '/' + photoId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | zero reads; the one minter's shape; a LIBRARY path names the shop's library object                                                                                                                                                                                                                                                                                                                            | Law 5 (root keys)                                                                                                                                                                                                                                                                             |
| S-L-28 | **CI time budget**: `verify:appcheck` stays in the `emulators` job; its time is measured at C_A and, if the job then exceeds 20 minutes, `timeout-minutes` goes 30 → 45 (`ci.yml:117-119`, pinned by `ci-workflow.spec.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | one job keeps the emulator ports serial; a separate job would change `JOB_NAMES` / `GATE`                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                             |

### 0.4 Inventory claims the code disproved (recorded so no package builds on them)

1. **"A garbage header → `INVALID` in the emulator."** Half true (the first draft of this plan wrongly read it as unobservable): with `skipTokenVerification` a non-JWT decodes to `{}` and reads `VALID`, but a JWT-shaped token whose payload segment is base64url `null` throws inside `unsafeDecodeAppCheckToken` (`.sub` of `null`) and reads `INVALID` (`firebase-functions/lib/common/providers/https.js:232-273`, `:368-373`; probed with `'bnVsbA.bnVsbA.'`, which matches `JWT_REGEX` `:13`). So `MISSING` and `INVALID` are proved end to end (`verify:appcheck`, the token built at run time); `REPLAYED` is unit-only (`alreadyConsumed` is always `false` there, `:343-352`).
2. **"A last-admin count query with a `users.roles` index flip."** Unneeded (S-RU-11): the guard holds by construction; `firestore.indexes.json` is untouched by E (24 composites, 120 overrides stay).
3. **"A new `PipelineErrorCode.AppCheckRequired` with words."** Unneeded (S-RU-24): `wordPipelineError` words the server's code first.
4. **"The debug provider under the emulators."** Cannot work (S-RU-18): it calls Google's real exchange endpoint.
5. **"Any App Check failure → `getToken` resolves with `error` and a dummy token → no header → MISSING"** (`inv-p4/a-app-check.md:54`). False for the commonest failure: a script that never loads leaves the readiness Deferred unsettled and every SDK call waits on it; a limited-use token the provider cannot mint rejects the call before it is sent (§0.1 A.14). S-RU-31 makes both headerless.

Not adopted: the inventory's `connect-src += https://www.google.com/recaptcha/` (`a-app-check.md:72`, `:247`) — S-RU-23 (1).

Verified as stated (and relied on): the 23 `onCall` sites and their options (`main.ts:561-1230`), the single `httpsCallable` site, the edge's line shape, the preflight tables, the CSP text, the console telemetry branches, the five `String(error)` sites, the rules texts, the Storage emulator's cross-service read, the impersonation pipeline's empty read, the absence of persisted claims, the card's `customerId` gate, `recordOption`, `personOf`.

### 0.5 Orchestrator notes

- **Environment** (brief-p3 §3, no repository change): Node 22.22.3; JDK 21; firebase-tools 15.34.1; Playwright 1.61.1 with chromium-1228; gitleaks 8.24.3. Emulator journeys run with the proxy variables unset (`env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY …`), ONE AT A TIME, only by the orchestrator. ecs-core coverage with `--testTimeout=30000`. LOCAL Linux screenshot references of the branch point stay uncommitted (`.git/info/exclude`).
- **The baseline** runs in `/home/user/baseline3` (checked out at `86870b9`); §6.3's first column is filled from its logs.
- **Stage order** B → C → D → E → F → A, one commit each; `git fetch origin` and a merge of `origin/main` (never a rebase) before each stage; shared files (`apps/functions/src/main.ts`, `main.spec.ts`, `edge.ts`, `firestore.rules`, the i18n catalogues, `app.config.ts`, `ports.tokens.ts`, `client-card.store.ts`, `docs/production-deploy.md`, the runbook, `package.json`) keep both sides' intent.
- **HANDOFF, the owner-rulings record, the plan's ledger and the PR body** are the orchestrator's. At C_A the orchestrator marks Deferred #4 as built in HANDOFF §6 and §3.3 (the owner-rulings file is the owner's record: it gets no edit beyond what the owner asks), and adds Deferred #3's second blocker there.
- **Superseded rulings get pointers** (orchestrator): HANDOFF §6 records S-RU-23 (OR-29's `frame-src 'none'` superseded for that directive; OR-32's "the app embeds nothing" now true of Auth only) and S-RU-22 (step-up decided, not built) beside "Deferred #4 built"; §7 item 18 asks the owner to annotate OR-29 and Deferred #4 in the rulings file.
- **Typecheck does not see Angular templates**: PE3 and PF run `pnpm nx build web` themselves (CLAUDE.md §5); the orchestrator's stage gate builds it too.
- **Not verifiable in this container** (flagged): the live reCAPTCHA hosts and Trusted Types samples (S-L-6, S-L-22 — the owner's staging smoke); the platform's `alreadyConsumed` on a real replay (unit-proved only, A.9); the reCAPTCHA Enterprise quota and price; the Firestore rules access-call limits per batch (S-L-14 avoids depending on them); the App Check API permission of the functions runtime account (S-RU-21, §7 item 3); Google's published reCAPTCHA CSP list (S-RU-23 — `docs.cloud.google.com` is outside this session's network allowlist); a reCAPTCHA that loads but never answers `ready` (S-L-24 bounds the load only).

### 0.6 Critique disposition (reviser, 2026-10-31)

Two read-only critiques of the first draft — completeness and fidelity
(CF-1 … CF-20) and laws and security (LS-1 … LS-15) — each gap re-verified
against `86870b9` and `node_modules` before it was applied.

- CF-1 APPLIED — confirmed (`@firebase/app-check` esm `:1193-1199`, `:852-868`; `@firebase/functions` esm `:614-621`): S-RU-31, S-L-24, S-L-5 rewritten (the callable client awaits a BOUNDED decision, so ENFORCE refuses no boot call merely because the script was slow), §2.A.4, §2.A.6 step 3, §7 item 3.
- CF-2 APPLIED — `registrationState` is on the one document read: S-RU-5, S-L-13, §2.C (+1 code / factory / wire row), §4 PC1, S-DEP-3.
- CF-3 APPLIED — `operation-trace.integration.spec.ts:222-239` and `edge.spec.ts:1398-1406` added to PA2, §4, S-DEP-9, with the C_A re-read grep.
- CF-4 APPLIED — `initializeAppCheck({})` throws at injector creation: `app.config.spec.ts` gains one stand-in (PA4, §4, S-DEP-15).
- CF-5 APPLIED — `verify:p0` presents the emulator token and runs under ENFORCE (S-RU-26 rewritten, S-DEP-18, PA3); `test:emulator` is OFF in-process + one MONITOR case (S-RU-20). Found while verifying: an unset `defineString` reads `''`, not its default (`params/types.js:375-379`) — S-RU-19 makes `''` a silent OFF and S-RU-21's consume expression `equals(MONITOR).thenElse(true, equals(ENFORCE))`, since `notEquals('OFF')` is true for `''`.
- CF-6 APPLIED — flag 26 built (zero reads): §0.1 D.5, S-RU-7, S-L-27, §2.D, §4 PD, S-DEP-5.
- CF-7 APPLIED — reproduced (`'bnVsbA.bnVsbA.'` → `INVALID`): §0.1 A.9, §0.4 item 1, §2.A.7 rows, §2.A.8 (2).
- CF-8 APPLIED — `.env.local` loads last (`env.js:179-187`): S-L-2, §2.A.2, §4 PA2, plus the mode probe (§6.1 addition 2).
- CF-9 APPLIED — the four preflight-spec edits in §4 PA3; S-L-8 "functions scope never `bundle()`".
- CF-10 APPLIED — `PIPELINES` seam vs `ENDPOINTS` relabelled in PE2 and §4.
- CF-11 APPLIED — `['client', 'barber']`; the ≥ 1 s sign-in before the revoke and the `TOKEN_EXPIRED` refresh.
- CF-12 APPLIED — `reason: 'unknown'` (the fixture's `Error` has no `code`).
- CF-13 APPLIED — PC2 → §3.2 `:715-729`; PA5 → `:36-37`, `:43`, `:740`, `:786`, the §1 checkboxes; PA3 → `preflight.mjs:41-42`; PD owns the §3.2 / runbook S-DEP-5 sentences.
- CF-14 APPLIED — HANDOFF §6 pointers (§0.5) and the owner's annotation ask (§7 item 18).
- CF-15 APPLIED — §0.1 G.1 / G.2 "stays carried".
- CF-16 APPLIED — `RECAPTCHA_REPORT_ONLY_POLICIES` for the `trusted-types` directive (S-RU-28, S-L-22, PA4).
- CF-17 APPLIED — the staging key is a never-committed edit of `environment.production.ts` (no staging configuration: `apps/web/project.json`).
- CF-18 APPLIED — PC2 may use `// @vitest-environment node`.
- CF-19 APPLIED — S-L-28: measure at C_A, raise `timeout-minutes` 30 → 45 if needed (one job kept).
- CF-20 APPLIED — S-RU-32 records the unchanged smoke half.
- LS-1 APPLIED — same defect as CF-1 (S-RU-31; §0.4 item 5; the DevTools blocking step). Its (b) ("a boot call carries no header") is replaced by the bounded wait.
- LS-2 APPLIED — S-RU-10 / §7 item 11 corrected; S-L-18 keeps the retry; PE2 adds the `roles_sessions_not_revoked` metric + alert; the failure case lives in the pipeline spec (the emulator cannot fail the Admin revoke).
- LS-3 APPLIED (a) / REJECTED (b) — (a) P10 judges the LIVE web in the functions scope, fail-closed (S-L-8, §2.A.3). (b), a 7-day Cloud Logging census in the preflight, is rejected: it needs a new log-entries reader over a retention-bound bucket and still cannot judge "explained". The per-callable bar stays the owner's (§7 item 4), named by P10's INFO line.
- LS-4 APPLIED (a)–(c) / REJECTED (d) — the API + token-verifier owner step, the per-callable bar, the staging `exportClientData` at `VALID`; (d) goes with LS-3 (b).
- LS-5 APPLIED — same gap as CF-2.
- LS-6 APPLIED — `roles.changed`, `roles.change_refused`, `roles.sessions_not_revoked`, `edge.app_check_mode_unreadable` (+ `roles.sessions_revoked`); the §2 preamble corrected.
- LS-7 APPLIED — S-RU-18 / §7 item 6: no debug token on a keyless hosted build.
- LS-8 APPLIED — same gap as CF-8, plus the probe that fails a run silently in MONITOR.
- LS-9 APPLIED — `offerOf`, `changeOf`, `saveOf` named in PE1; the presenter receives `saveEnabled`.
- LS-10 APPLIED — a caller blocked at `nowUtcMs` → FORBIDDEN (`decide` gains `nowUtcMs`).
- LS-11 APPLIED — the actor is `Actor.forCaller(adminUserId, caller.roles)` (stored roles); a spec with a token/stored mismatch.
- LS-12 APPLIED — the logging option: every revoke logs `roles.sessions_revoked` (S-L-26); the no-op path is kept, as the only retry of a failed revoke.
- LS-13 APPLIED — the beacon host is NOT admitted, now recorded (S-RU-23 (1), S-L-6, §0.4) with a staging check.
- LS-14 APPLIED — the trade-off is recorded in `csp-baseline.md`; check (g) refuses hosting `redirects`.
- LS-15 APPLIED (option b) — the brief's "scrubbed message" is kept, following the OR-34 / RU-38 precedent. The residual is S-L-25, pinned by a PB spec case, and §7 item 20 offers the code-only message as the owner's one-line reversal.

---

## 1. Inventory (file:line on `86870b9`)

| #   | Item                     | Sites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | console telemetry (B)    | `apps/functions/src/adapters/console-telemetry.adapter.ts:52-62` (`LogSink`, `write`), `:64-72` (`describe`), `:107-128` (`codeOfError`, `errorField`), `:135-146` (`withScope`), `:148-165` (`consoleTelemetry`); spec `console-telemetry.adapter.spec.ts:103-140`, `:239-251`, `:305-325`, `:337-346`; caller `edge.ts:1046-1057`                                                                                                                                                                                                                                 |
| 2   | store failures (B)       | `adapters/firestore-accounts.adapter.ts:37`, `firestore-coupons.adapter.ts:35`, `firestore-settings.adapter.ts:34`, `firestore-audit.adapter.ts:92-97`, `:132-135`; `main.ts:356-369` (`settledCommit`); `wire/loyalty.wire.ts:78-91` (doc); `adapters/store-answer.ts:17-25`; pins `main.spec.ts:2085-2091`, `firestore-audit.adapter.spec.ts:109`                                                                                                                                                                                                                 |
| 3   | Storage rules (C)        | `storage.rules:1`, `:41-47`; `libs/infrastructure/firestore/src/testing/emulator-test-env.ts:24-35`; `libs/infrastructure/firestore/project.json:12-17` (`test-integration`); `package.json:13` (`test:emulator` starts `firestore,auth,storage`)                                                                                                                                                                                                                                                                                                                   |
| 4   | impersonation (C)        | `pipelines/start-impersonation.pipeline.ts:40-150`; `systems/impersonation.system.ts`; `errors/governance.error.ts:19-52` (dictionary), union, factories; `edge.ts:490-504` (`GOVERNANCE_WIRE`); `apps/functions/src/integration/impersonation.integration.spec.ts:67-150`; `components/account-status.data.ts:84` (`AccountLifecycle.isErased`)                                                                                                                                                                                                                    |
| 5   | Firestore rules (D)      | `firestore.rules:96-102` (`stampInWindow`), `:186-193` (the `exists()`-last idiom), `:360-366`, `:379-386`, `:570-577`; `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts:219-220` (the SHOT path); `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts` (notes / photos / exceptions blocks), `stamp-window.rules-text.spec.ts:73-112`, `visit-media-writers.integration.spec.ts:67`; `systems/governed-change.system.ts:82-109`                                                                                           |
| 6   | roles and audit (E)      | `components/role.data.ts:15-23`, `components/roles.data.ts:59-170`, `role.rules-parity.spec.ts`; `components/audit-context.data.ts:89-95` (verbs), `:344-356` (`profileWithTags`), `:590-600`; `components/profile-action.data.ts`; `audit-context.data.spec.ts:68`; `systems/audit.system.ts:755`, `:794-801`, `:812-880` (`planOwnProfileEdit`, `planImpersonationStarted`); `entities/user.entity.ts:30-37`                                                                                                                                                      |
| 7   | Auth admin (E)           | `apps/functions/src/adapters/auth-claims.adapter.ts:37-61` (`authCodeOf`, `authFailure`, `authClaimsPorts`); `ports/identity.port.ts:218-230`; `testing/port-doubles.ts` (the auth double); `firebase-admin` `revokeRefreshTokens(uid)`                                                                                                                                                                                                                                                                                                                             |
| 8   | callable registry (E, A) | `ports/callables.ts:33-58` (`Callables`, 23 names), `:67-` (`CallableWire`), `:198-` (`OPERATION_ID_FIELD`), `:257-` (`CALLABLE_ANSWER_DECODERS`); `callables.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | functions root (E, A)    | `main.ts:190-200` (header), `:246` (`telemetry`), `:294` (`LOG_DIGEST_SECRETS`), `:318-324` (`edge`), `:401` (`WALK_IN_SECRETS`), `:472-483` (`root`), `:502-537` (`wiredCallable`, `plain`), `:1112-1150` (impersonation + invitation), `:1159-1215` (privacy), `:1230-1262` (the sink); `main.spec.ts:36-70` (the `@core/pipelines` seam's `PIPELINES`), `:263-341` (`ENDPOINTS` → `EXPORTS`), `:1035-1145` (`FLIPPED_EXPORTS`, 50), `:2278-2330` (outcome lines)                                                                                                 |
| 10  | governance wire (E)      | `apps/functions/src/wire/governance.wire.ts` (`decodeStartImpersonation` — the gate before the payload); `components/governance-call.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 11  | client card (E, F)       | `libs/features/staff/client-card/src/lib/client-card.contracts.ts:45-56`; `client-card.store.ts:402` (`CUSTOMER_PORTS`), `:497-502` (`_customerId`), `:561`, `:644` (`user`), `:1603-1632` (`open`), `:1640-1666` (`privacy`), `:2105-2165` (`recordOf`), `:2189-2210` (`reset`); `client-card/client-card.html` (the privacy block), `client-card.ts`; `client-card.words.ts`; `client-pages.vm.ts`; `client-privacy.presenter.ts`; fixtures `src/testing/client-card.fixtures.ts:917`, `:1026-1042`, `:1437`, `src/testing/achievements-pages.rig.ts:208`, `:339` |
| 12  | visit editor (F)         | `visit-editor/client-search.ts:63-74`; `staff-visit-editor.ts:609-632` (`VisitEditorClientOption`), `:816-831` (`DraftClient`), `:7019-7029` (`cardSubjectOf`); `staff-dashboard/staff-dashboard.ts:3606-3640` (`personOf`)                                                                                                                                                                                                                                                                                                                                         |
| 13  | customer reads (F)       | `ports/identity.port.ts:175-178`; `libs/infrastructure/firestore/src/lib/customers.adapter.ts:32`; `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts:111`; `apps/web/src/app/app.config.ts:532-540`; `testing/port-doubles.ts:753`                                                                                                                                                                                                                                                                                                                          |
| 14  | edge (A)                 | `apps/functions/src/edge.ts:98-155` (`EDGE_DICTIONARIES`, `EdgeCode`), `:397-399` (`CLIENT_ISSUE_WIRE` idiom), `:710-737` (`EDGE_WIRE`), `:953-960` (`EdgePorts`, `CallableEdgePorts`), `:1022-1037`, `:1060-1076` (`CallableSpec`), `:1099-1155` (`callableEdge`), `:1166-1233`; `edge.spec.ts:380-385` (dictionaries from disk), `:1153` (the ports double), `:1370-1385`, `:1398-1406` (the `bound` literal), `:1426-1438` (outcome lines); `integration/operation-trace.integration.spec.ts:222-239` (the exact `callable.completed` fields, in-process)        |
| 15  | flags and params (A)     | `apps/functions/src/lib/flags.ts`; `adapters/flags.adapter.ts:10` (`paramFlagsPorts`, the adapter idiom); `config/feature-flags.json`; `tools/flags/write-functions-env.mjs:30-41`, `:56-90`, `:99-118`, `:120-178`; `write-functions-env.spec.mjs:163-184`; `tools/flags/project.json`                                                                                                                                                                                                                                                                             |
| 16  | preflight (A)            | `tools/verify/preflight/preflight.mjs:7-42` (header; `:41-42` the scope sentence), `:84-119`, `:198-201` (`row`), `:427-461` (`checkBundle`), `:1218-1270`, `:1383-`; `preflight.spec.mjs:249-280` (`fakeReaders`), `:1323-1336`, `:1346`, `:1358`, `:1360-1361` (the functions scope never calls `bundle()`), `:1370`, `:1404-1416`, `:1583-1590`, `:1679-1699` (exact row lists); `tools/verify/project.json:34-55` (test inputs)                                                                                                                                 |
| 17  | web runtime (A)          | `libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts:31-56`, `:116-131`; `callable-client.adapter.ts:60-80`; `csp-baseline.ts`; `reporting-error-handler.ts:245-300`; `libs/infrastructure/firebase-app/src/index.ts`, `src/csp-baseline.ts`; `apps/web/src/app/app.config.ts:111-113`, `:277-296`; `apps/web/src/environments/environment*.ts`; `libs/infrastructure/firestore/src/lib/streak-publish.adapter.spec.ts:132`, `:419`                                                                                                                   |
| 18  | CSP (A)                  | `firebase.json:41`, `:44-45`; `tools/verify/csp/check-csp.mjs:40-63`, `:205-290` (`checkArtifact`); `tools/verify/csp/emulator-config.mjs` (structural superset — unchanged); `apps/web/e2e/csp/csp-smoke.spec.ts:150-191`; `docs/security/csp-baseline.md:30-50`, `:89-93`, `:262-269`                                                                                                                                                                                                                                                                             |
| 19  | CI and scripts (A)       | `.github/workflows/ci.yml:117-119` (`timeout-minutes: 30`), `:120-140` (`emulators` job: `test:emulator`, `verify:p0`); `tools/verify/p0/verify-p0.mjs:208-262`, `:311` (the raw posts); `tools/verify/ci/ci-workflow.spec.mjs:115-131`, `:243-244`; `package.json:13-17`                                                                                                                                                                                                                                                                                           |
| 20  | words (E, A)             | `libs/infrastructure/i18n/src/assets/i18n/{bg,en}.json` (`clientCard.privacy.*`, `errors.*`); `libs/infrastructure/i18n/src/lib/word-pipeline-error.ts:39-51`, `word-pipeline-error.spec.ts:1-18` (OR-55 rules); `catalogue-parity.spec.ts`                                                                                                                                                                                                                                                                                                                         |
| 21  | docs (all)               | `docs/production-deploy.md:36-60` (predeploy table; `:36-37` "P1–P6" / "P1–P3, P6–P9", `:43` "Its nine checks"), `:446-449`, `:451-513` (§1 "Monitoring and privacy"), `:715-729` (§3.2 Rules — `:269` is the OTP sender's section, an inventory error), `:740` (§3.3), `:786` (§3.4), `:963`; `docs/architecture/firestore-runbook.md:282` (the five ops counters); `docs/architecture/firestore-runbook.md:245`, `:271`, `:277`, `:287` (the claims sentence); `docs/security/csp-baseline.md`                                                                    |

---

## 2. Contracts

Every new identifier below must pass the runbook §4.0 word lists (§3's name
check). No optional property and no `| undefined` in any ECS file — absent
is `null`. Every new system ships a purity spec (Law 3); every new port is
a member of a named bundle in `libs/ecs-core/src/ports/` (Law 9); every new
error lives in an `errors/*.error.ts` (Law 7.5, `creativo/error-dictionary-home`)
and joins the edge's total table; every new `AuditAction` passes the pinned
prefix regex; every new `LogEvent` is dotted and domain-prefixed
(`primitives/log-event.data.ts:10-11`; its specs pin `/^[a-z]+\.[a-z_]+$/`). Avoid as property or parameter names:
`status`, `kind`, `type` (Law 6.2), `hours:`, `timezone`, `expiresAt:`,
`createdAt:`, `startedAt:`, `issuedAt`, `grantedAt`, `['scope']`,
`['purpose']` (runbook K1 / K2 / W1 / W4z).

### 2.B WS-B — error reports scrubbed (PB)

```ts
// apps/functions/src/adapters/console-telemetry.adapter.ts
trackError: (error, context) => {
  const payload = withScope(context) ?? {};
  if (error instanceof Error) {
    // RU-38's struct: the name and message scrubbed, every frame line through
    // ClientIssueSystem.frame, every other stack line dropped; cause, details
    // and every other own property never leave.
    const field = errorField(error);
    sink.write({ ...payload, error: field, severity: 'ERROR', message: field.stack });
    return;
  }
  sink.error('non-error thrown', {
    ...payload,
    thrown: ClientIssueSystem.scrub(describe(error)),
  });
},
```

- The header comment's "An `Error` is logged as itself, so its stack
  reaches the entry" is rewritten to say the stack reaches it rebuilt and
  scrubbed (`message` = the V8-shaped stack, so Error Reporting groups by the
  server's frames, as `logger.error(err)` did).
- Store failures (S-RU-2): `firestore-accounts.adapter.ts:37` →
  `readFailed(Collections.Users, error)`; `firestore-coupons.adapter.ts:35` →
  `readFailed(Collections.Coupons, error)`; `firestore-settings.adapter.ts:34`
  → `readFailed(POLICY_PATH, error)`; `firestore-audit.adapter.ts:134` →
  `readFailed(Collections.AuditLog, error)`; `firestore-audit.adapter.ts:96`
  → the field `reason: FailureCodeSystem.codeOf(error)` (renamed from
  `error`, the store-answer word); `main.ts:367` →
  `RepositoryError.writeFailed(null, FailureCodeSystem.codeOf(cause))` (its doc
  `:356-362` and `loyalty.wire.ts:82`'s "a rejected commit's
  `String(cause)`" re-worded to "the cause's canonical code").

### 2.C WS-C — an erased person can do nothing (PC1, PC2)

```
// storage.rules — inside match /b/{bucket}/o, beside isOwner
    // An erased account (`users/{uid}.accountStatus` ERASED, audit hardening
    // Phase 3) keeps a valid ID token for up to an hour after its Auth user
    // is deleted; it uploads nothing in that hour. ONE cross-service read per
    // upload (rules v2; the deploy grants the Storage rules agent Firestore
    // read — production-deploy.md). No `users` document reads as no account:
    // refused. Evaluated last, after the cheap checks.
    function accountMayUpload(uid) {
      return firestore.get(/databases/(default)/documents/users/$(uid)).data.accountStatus != 'ERASED';
    }

    match /avatars/{userId}/{fileName} {
      allow read: if true;
      allow create, update: if isOwner(userId)
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*')
        && accountMayUpload(userId);
      allow delete: if isOwner(userId);
    }
```

```ts
// libs/ecs-core/src/errors/governance.error.ts — GovernanceErrorCode gains
  /** `startImpersonation` named a uid with no account document. */
  ImpersonationTargetNotFound: 'GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND',
  /** `startImpersonation` named an erased account (Phase 3's ERASED tag). */
  ImpersonationTargetErased: 'GOVERNANCE_IMPERSONATION_TARGET_ERASED',
  /** `startImpersonation` named an account that never finished registering (a PROVISIONED stub). */
  ImpersonationTargetNotRegistered: 'GOVERNANCE_IMPERSONATION_TARGET_NOT_REGISTERED',
// namespace + union: { readonly errorCode: typeof …; readonly targetUserId: UserId } each
// companion: impersonationTargetNotFound(targetUserId), impersonationTargetErased(targetUserId),
//   impersonationTargetNotRegistered(targetUserId)

// libs/ecs-core/src/systems/impersonation.system.ts — ImpersonationSystem gains
  /** The stored target an impersonation may open on: present, not erased, registered — in that order. */
  admitTarget(stored: User | null, targetUserId: UserId): Result<User, GovernanceError>,

// libs/ecs-core/src/pipelines/start-impersonation.pipeline.ts — the commit reads the target
const committed = await ports.commit(
  (tx) => tx.get<User>([Collections.Users, cmd.targetUserId]),
  (stored) => {
    const target = ImpersonationSystem.admitTarget(stored, cmd.targetUserId);
    if (!target.ok) return target;
    return Result.ok({ writes: [WriteOp.create(…session…), ...AuditSystem.createsOf([…], ports.hash)] });
  },
);
// a governance refusal logs LogEvent.ImpersonationStartRefused { errorCode } (the existing line);
// the docblock's "Nothing is read." becomes the one read. StartImpersonationPorts unchanged.

// apps/functions/src/edge.ts — GOVERNANCE_WIRE gains
  [G.ImpersonationTargetNotFound]: fields(S.NotFound),
  [G.ImpersonationTargetErased]: fields(S.FailedPrecondition),
  [G.ImpersonationTargetNotRegistered]: fields(S.FailedPrecondition),
```

No wire change, no `callables.ts` change, no words (S-RU-5).

### 2.D WS-D — rules the audit found missing (PD)

```
    match /appointmentNotes/{appointmentId} {
      allow read: if worksTheBook();
      allow create, update: if worksTheBook()
        && request.resource.data.authorUserId == request.auth.uid
        && stampInWindow(request.resource.data.writtenAtUtcMs)
        && request.resource.data.keys().hasOnly(['authorUserId', 'text', 'writtenAtUtcMs'])
        && exists(/databases/$(database)/documents/appointments/$(appointmentId));
      allow delete: if worksTheBook();
    }

    match /appointmentPhotos/{photoId} {
      allow read: if worksTheBook();
      allow create: if worksTheBook()
        && request.resource.data.takenByUserId == request.auth.uid
        && stampInWindow(request.resource.data.takenAtUtcMs)
        && photoId.matches('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        && request.resource.data.keys().hasOnly(['appointmentId', 'barberId', 'clientCustomerId', 'clientLabel', 'height', 'label', 'path', 'photoOrigin', 'takenAtUtcMs', 'takenByUserId', 'url', 'width'])
        && request.resource.data.appointmentId is string
        && request.resource.data.photoOrigin in ['SHOT', 'LIBRARY']
        && (request.resource.data.photoOrigin != 'SHOT'
            || request.resource.data.path == 'appointmentPhotos/' + request.resource.data.appointmentId + '/' + photoId)
        && exists(/databases/$(database)/documents/appointments/$(request.resource.data.appointmentId));
      allow update: if false;
      allow delete: if worksTheBook();
    }

    match /scheduleExceptions/{dayDocId} {
      allow read: if true;
      allow create, update: if mayEditRoster()
        && request.resource.data.keys().hasOnly(['barberId', 'exceptionEffect', 'exceptionRanges', 'localDate', 'locationId', 'utcEpochMs'])
        && request.resource.data.barberId is string
        && request.resource.data.localDate is string
        && request.resource.data.localDate.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && dayDocId == request.resource.data.barberId + '__' + request.resource.data.localDate;
      allow delete: if mayEditRoster();
    }
```

Each block's comment gains one sentence on what its id is tied to and why
(the carried `HANDOFF.md:2603-2611` item). The lists are the entities' stored
keys (`governed-change.system.ts:82-109`); the parity spec of §4 PD pins
each against a compile-checked key table of `AppointmentNote`,
`AppointmentPhoto`, `ScheduleException` written inside the spec (no new
production export). The photo block's `photoOrigin` / `path` lines are Phase
3 flag 26 (S-L-27). `production-deploy.md` §3.2 (`:715-729`) and the runbook
§3 rules sentence gain the S-DEP-5 constraints beside DEP-15's (PD).

### 2.E WS-E — an audited role change (PE1, PE2, PE3)

```ts
// components/roles.data.ts — Roles gains (callable-only, no rules twin: role.rules-parity.spec.ts lists it)
  /** Who may change an account's roles (`setRoles`): the shop's admin only — not the sysadmin (S-RU-14). */
  ASSIGN: [Role.Admin],
  /** The roles `setRoles` may grant or take away — every role but the vendor's sysadmin. */
  ASSIGNABLE: [Role.Client, Role.Barber, Role.Receptionist, Role.ContentManager, Role.Admin],
  assignsRoles(roles: readonly string[]): boolean,   // anyIn(Roles.ASSIGN, roles)

// components/audit-context.data.ts — AuditAction gains; profile-action.data.ts adds it to ProfileAction
  ProfileRolesChanged: 'PROFILE_ROLES_CHANGED',

// components/roles-call.data.ts (new) — the setRoles wire, the GovernanceCall idiom
export type RolesCall = {
  readonly targetUserId: UserId;
  readonly roles: readonly Role[];
};
export const RolesCall = {
  decodeChanged(raw: unknown): Result<RolesCall.Changed, PipelineError>,   // CallAnswer idiom
} as const;
export namespace RolesCall {
  export type Changed = {
    readonly targetUserId: UserId;
    readonly roles: readonly Role[];      // the stored set after the call, dictionary order
    readonly rolesChanged: boolean;       // false: the set was already this — nothing written
  };
}

// errors/governance.error.ts — GovernanceErrorCode gains (structs flat; context scalars and brands)
  RolesUnauthenticated: 'GOVERNANCE_ROLES_UNAUTHENTICATED',              // unauthenticated
  RolesForbidden: 'GOVERNANCE_ROLES_FORBIDDEN',                          // { callerUserId } — the impersonation twin's status
  RolesInvalid: 'GOVERNANCE_ROLES_INVALID',                              // invalid-argument — empty, unknown, or sysadmin
  RolesSelf: 'GOVERNANCE_ROLES_SELF',                                    // { callerUserId } failed-precondition
  RolesTargetNotFound: 'GOVERNANCE_ROLES_TARGET_NOT_FOUND',              // { targetUserId } not-found
  RolesTargetNotRegistered: 'GOVERNANCE_ROLES_TARGET_NOT_REGISTERED',    // { targetUserId } failed-precondition
  RolesTargetErased: 'GOVERNANCE_ROLES_TARGET_ERASED',                   // { targetUserId } failed-precondition
  RolesTargetSysadmin: 'GOVERNANCE_ROLES_TARGET_SYSADMIN',               // { targetUserId } failed-precondition
  RolesSessionsNotRevoked: 'GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED',      // { targetUserId } unavailable (retryable)
export type SetRolesError = GovernanceError | RepositoryError;

// systems/role-assignment.system.ts (new)
export type RoleAssignment = {
  readonly rolesFrom: readonly Role[];
  readonly rolesTo: readonly Role[];
  readonly rolesChanged: boolean;
};
export const RoleAssignmentSystem = {
  /**
   * The roles change one admin may make: the caller's STORED roles hold
   * Roles.ASSIGN and the caller is not blocked at nowUtcMs
   * (AccountLifecycle.isBlockedAt, ERASED included); the target is not the caller, exists, is REGISTERED, not
   * ERASED, holds no sysadmin; the requested set is non-empty, inside
   * Roles.ASSIGNABLE, normalised to dictionary order. Every admitted plan
   * leaves the caller an admin (S-RU-11 — the property spec proves it).
   */
  decide(input: {
    readonly callerUserId: UserId;
    readonly caller: User | null;     // users/{caller}, read in the transaction
    readonly target: User | null;     // users/{target}, read in the transaction
    readonly targetUserId: UserId;
    readonly requestedRoles: readonly Role[];
    readonly nowUtcMs: UtcEpochMs;    // the caller's block judged at this instant (T2: account-status.isBlockedAt)
  }): Result<RoleAssignment, GovernanceError>,
  /**
   * Whether the card may OFFER the block (S-L-18): the viewer assigns roles,
   * the subject is a stored, REGISTERED, not ERASED account that is not the
   * viewer and holds no sysadmin — the subject guards `decide` shares.
   */
  offerOf(viewerUserId: UserId, viewerRoles: readonly Role[], subject: User | null): boolean,
  /** The requested set against the stored one — deduplicated, dictionary order; `decide` uses it. */
  changeOf(stored: readonly Role[], requested: readonly Role[]): RoleChange,
  /** May the card send: changed and non-empty — or a failed revoke pending its retry of the stored set. */
  saveOf(change: RoleChange, revokePending: boolean): boolean,
} as const;
export type RoleChange = {
  readonly rolesTo: readonly Role[];
  readonly rolesChanged: boolean;
  readonly rolesEmpty: boolean;
};

// systems/audit.system.ts — AuditSystem gains (the planOwnProfileEdit / planImpersonationStarted idioms)
  planRolesChanged(
    targetUserId: UserId,
    assignment: RoleAssignment,
    actor: Actor,                      // Actor.forCaller(cmd.adminUserId, caller.roles): the STORED roles read in
                                       //   the transaction, never the token's (erase-client.pipeline.ts:413-416)
    recordedAtUtcMs: UtcEpochMs,       // the instant the users update stamps
    operationId: OperationId | null,
  ): AuditRowPlan,
  // AuditContext.profileWithTags(AuditAction.ProfileRolesChanged, ['roles'],
  //   { profileRolesFrom, profileRolesTo, profileAccountStatusFrom: null, profileAccountStatusTo: null });
  // target AuditTargetRef.user(targetUserId); resource users/<uid>; id basis keyed by uid + recordedAtUtcMs

// ports/identity.port.ts — beside AuthAdminPorts
export type RevokeRefreshTokens = (uid: UserId) => Promise<Result<void, PipelineError>>;  // auth/user-not-found → ok
/** Ending an account's sessions so its next token is minted fresh — `setRoles` (S-RU-10). */
export type AuthSessionRevokePorts = { readonly revokeRefreshTokens: RevokeRefreshTokens };

// ports/governance.port.ts — the web's call
export type SetRoles = Callable<RolesCall, RolesCall.Changed>;
/** The admin's roles change — the card's «Роли» block; one InjectionToken (ROLES_ADMIN_PORTS). */
export type RolesAdminPorts = { readonly setRoles: SetRoles };

// ports/callables.ts
  SetRoles: 'setRoles',                                    // Callables
  [Callables.SetRoles]: { input: RolesCall; answer: RolesCall.Changed },  // CallableWire (the impersonation rows' shape; the transport id rides the payload, OPERATION_ID_FIELD)
  [Callables.SetRoles]: 'operationId',                     // OPERATION_ID_FIELD
  [Callables.SetRoles]: RolesCall.decodeChanged,           // CALLABLE_ANSWER_DECODERS

// primitives/log-event.data.ts
  RolesChanged: 'roles.changed',
  RolesChangeRefused: 'roles.change_refused',
  RolesSessionsNotRevoked: 'roles.sessions_not_revoked',
  RolesSessionsRevoked: 'roles.sessions_revoked',      // every successful revoke, the no-op path too (S-L-26)

// pipelines/set-roles.pipeline.ts (new)
export type SetRolesPorts = CommitPorts & ClockPorts & HashPorts & AuthSessionRevokePorts & TelemetryPorts;
export type SetRolesCommand = RolesCall & {
  readonly adminUserId: UserId | null;     // the verified session's uid
  readonly adminRoles: readonly Role[];    // the verified token's roles (the wire's gate read them)
  readonly operationId: OperationId | null;
};
export const setRoles = (ports: SetRolesPorts) => async (cmd: SetRolesCommand)
  : Promise<Result<RolesCall.Changed, SetRolesError>> => {
  // 1. read inside ONE commit: users/{caller}, users/{target}
  // 2. RoleAssignmentSystem.decide (nowUtcMs read once from ports.nowUtcMs()) → writes: rolesChanged
  //      ? [WriteOp.update(users/<target>, { roles: rolesTo, profileEditedAtUtcMs: now }),
  //         ...AuditSystem.createsOf([AuditSystem.planRolesChanged(…)], ports.hash)]
  //      : []
  // 3. after the commit (also when unchanged): ports.revokeRefreshTokens(target);
  //    success → log RolesSessionsRevoked { targetUserId, rolesChanged } (a forced sign-out is never silent);
  //    a failure → log RolesSessionsNotRevoked { targetUserId, errorCode } and answer
  //    GovernanceError.rolesSessionsNotRevoked(target) — the roles stay committed; a retry re-revokes
  // log RolesChanged { targetUserId, rolesCount } / RolesChangeRefused { errorCode }
};
```

Functions (PE2): `apps/functions/src/wire/governance.wire.ts` gains
`decodeSetRoles(request)` — the gate FIRST, on the verified claims
(`callerUserId(request)` null → `GOVERNANCE_ROLES_UNAUTHENTICATED`;
`!Roles.assignsRoles(callerKnownRoles(request))` → `GOVERNANCE_ROLES_FORBIDDEN`),
then `targetUserId` (`UserId.parse`), `roles` (an array; each entry
`Tag.has(Role, raw)`, else `GOVERNANCE_ROLES_INVALID`), the optional
`operationId` (`operationIdOf`). `auth-claims.adapter.ts` gains
`authSessionRevokePorts(auth): AuthSessionRevokePorts` (`revokeRefreshTokens`;
`auth/user-not-found` → ok; any other failure → `authFailure` — the code,
never the message). `main.ts`:

```ts
/** The admin roles change's ports: the server ports and Admin Auth's session revocation. Built on first use. */
const rolesPorts = once(() => ({
  ...serverPorts(),
  ...authSessionRevokePorts(auth()),
}));

/** An admin changes one account's roles (Phase 4, S-WS-E) — `users.roles` and its row in one commit, then the sessions revoked. */
export const setRoles = onCall(
  LOG_DIGEST_SECRETS,
  wiredCallable(
    plain(Callables.SetRoles, null),
    rolesPorts,
    decodeSetRoles,
    (ports, cmd) => setRolesPipeline(ports)(cmd),
    refusalOf,
  ),
);
```

`edge.ts`' `GOVERNANCE_WIRE` gains the nine rows (statuses above; PE1 owns
them so the functions typecheck stays green between waves).

Ops (PE2, S-RU-10): `tools/ops/names.env` gains
`METRIC_ROLES_SESSIONS_NOT_REVOKED=roles_sessions_not_revoked`,
`tools/ops/log-metrics.sh` one counter filtered on the
`roles.sessions_not_revoked` message, and
`tools/ops/alerts/roles-sessions-not-revoked.yaml` alerts on ANY occurrence
in 5 minutes (the `audit-actor-missing.yaml` shape) — one failed revoke stays
under `callable_failed`'s threshold; the runbook §3 item 7 (`:282`) reads six
counters.

Web (PE3):

```ts
// libs/infrastructure/firebase-app/src/lib/roles-admin.adapter.ts (new; the client-privacy.adapter idiom)
export const rolesAdminPorts = (gateway: GatewayPorts): RolesAdminPorts => ({
  setRoles: gateway.callableClient(Callables.SetRoles),
});
// ports.tokens.ts: export const ROLES_ADMIN_PORTS = new InjectionToken<RolesAdminPorts>('ROLES_ADMIN_PORTS');
// app.config.ts: provide it beside the privacy port (eager over GATEWAY_PORTS, as the privacy port is)

// libs/features/staff/client-card — the «Роли» block
// client-pages.vm.ts:
export type ClientRolesVm = {
  readonly groupLabel: string;
  readonly toggles: readonly ClientRoleToggleVm[]; // the five Roles.ASSIGNABLE, dictionary order
  readonly saveLabel: string;
  readonly saveEnabled: boolean; // a system answer: changed and non-empty
  readonly line: string | null; // the saved line or the refusal's words
  readonly testId: string;
};
export type ClientRoleToggleVm = {
  readonly role: Role;
  readonly label: string;
  readonly checked: boolean;
  readonly testId: string;
};
// client-roles.presenter.ts (new): clientRolesVm(input) — words only; `saveEnabled` arrives as an
//   input (RoleAssignmentSystem.saveOf over changeOf) — never re-derived in the presenter (Law 10.2)
// client-card.store.ts: readonly roles: Signal<ClientRolesVm | null>  (null unless
//   RoleAssignmentSystem.offerOf answers true and S-L-18's port / online conditions hold);
//   toggleRole(role), saveRoles() — one ClientOperationId per act, reused on its retry (the privacy idiom);
//   the last answer's errorCode per subject: SESSIONS_NOT_REVOKED keeps its line and saveOf(…, true),
//   so Save re-sends the stored set until a revoke succeeds (S-RU-10)
```

### 2.F WS-F — a staff route to walk-in-only records (PF)

```ts
// ports/identity.port.ts
export type LoadCustomer = (customerId: CustomerId) => Promise<Result<Customer | null, RepositoryError>>;
/** One client record by its id — the card of a walk-in with no account (S-WS-F). */
export type CustomerRecordPorts = { readonly loadCustomer: LoadCustomer };
/** The web's client-record reads — the suite `CUSTOMER_PORTS` binds (Law 9: an intersection). */
export type CustomerReadPorts = CustomerPorts & CustomerRecordPorts;

// libs/infrastructure/firestore/src/lib/customers.adapter.ts — customerPorts gains loadCustomer
//   (a guarded read of customers/{id}, the same guard and dropped-document report as loadCustomerForUser)
// ports.tokens.ts: CUSTOMER_PORTS becomes InjectionToken<CustomerReadPorts>
// app.config.ts:532-540: methods gain loadCustomer: LazyMethod.Promise

// client-card.contracts.ts — ClientCardSubject gains (required)
  /**
   * The walk-in's client RECORD (`customers/{id}`) when the seat has no
   * account — set only from a record the search found or a WALK_IN seat's
   * `subjectCustomerId`, never parsed from a `guest-…` key (S-RU-15);
   * `null` for an account (the card resolves its record by uid) and for a
   * typed guest.
   */
  readonly customerId: CustomerId | null;

// client-search.ts recordOption: customerId: customer.userId === null ? customer.id : null
// staff-visit-editor.ts: VisitEditorClientOption and DraftClient gain `readonly customerId?: CustomerId | null`
//   (the file's own optional-field style, beside noAccount); cardSubjectOf copies it (?? null)
// staff-dashboard.ts personOf: a WALK_IN seat → customerId: seat.subjectCustomerId; ANONYMOUS → null

// client-card.store.ts open(): an account → loadAll(uid) as today; else a record →
//   _customerId.set(id) at once (the privacy block becomes decidable), then
//   customers.loadCustomer(id) → _erasureStatus.set(record.erasureStatus) (absent → the block stays,
//   the erasure offer reads its default); a typed guest reads nothing (as today)
```

### 2.A WS-A — App Check (PA1 … PA5)

**2.A.1 ecs-core (PA1).**

```ts
// primitives/app-check-mode.data.ts (new)
/** The App Check switch (`config/app-check.json` → `APP_CHECK_MODE`) — the field `appCheckMode`. */
export const AppCheckMode = {
  /** Inert: nothing read, reported, consumed or refused — the shipped production value. */
  Off: 'OFF',
  /** Every callable's outcome reported and limited-use tokens consumed; nothing refused. */
  Monitor: 'MONITOR',
  /** MONITOR, and a request without a valid token is refused (`APP_CHECK_REQUIRED`). */
  Enforce: 'ENFORCE',
} as const;
export type AppCheckMode = (typeof AppCheckMode)[keyof typeof AppCheckMode];

// primitives/app-check-outcome.data.ts (new) — the field `appCheckOutcome` (outcome line, error context)
export const AppCheckOutcome = {
  Valid: 'VALID',        // the platform verified the token
  Missing: 'MISSING',    // no X-Firebase-AppCheck header
  Invalid: 'INVALID',    // a header the platform could not verify
  Replayed: 'REPLAYED',  // a verified limited-use token the platform had consumed before
} as const;

// primitives/app-check-token-use.data.ts (new) — the field `appCheckTokenUse`
export const AppCheckTokenUse = { Standard: 'STANDARD', LimitedUse: 'LIMITED_USE' } as const;

// primitives/log-event.data.ts
  AppCheckModeUnreadable: 'edge.app_check_mode_unreadable',

// errors/app-check.error.ts (new; the client-issue.error idiom)
export const AppCheckErrorCode = {
  /** ENFORCE: the request carried no verified App Check token. */
  Required: 'APP_CHECK_REQUIRED',
  /** ENFORCE: a limited-use callable received a token already consumed. */
  Replayed: 'APP_CHECK_REPLAYED',
} as const;
export type AppCheckError =
  | { readonly errorCode: typeof AppCheckErrorCode.Required; readonly appCheckOutcome: typeof AppCheckOutcome.Missing | typeof AppCheckOutcome.Invalid }
  | { readonly errorCode: typeof AppCheckErrorCode.Replayed; readonly appCheckOutcome: typeof AppCheckOutcome.Replayed };
export const AppCheckError = { required(appCheckOutcome), replayed() } as const;

// systems/app-check.system.ts (new)
/** What the edge read off one request — presence and the platform's verdict, never the token. */
export type AppCheckFacts = {
  readonly appCheckTokenSent: boolean;      // an X-Firebase-AppCheck header arrived
  readonly appCheckTokenVerified: boolean;  // the platform verified it (`request.app` is set)
  readonly appCheckTokenReplayed: boolean;  // `request.app.alreadyConsumed === true`
};
export const AppCheckSystem = {
  outcomeOf(facts: AppCheckFacts): AppCheckOutcome,   // !sent → MISSING; !verified → INVALID; replayed → REPLAYED; else VALID
  /**
   * OFF → ok(null) (nothing reported); MONITOR → ok(outcome); ENFORCE →
   * VALID ok; MISSING / INVALID → required(outcome); REPLAYED →
   * replayed() on a LIMITED_USE callable, ok(REPLAYED) on a STANDARD one.
   */
  verdictOf(mode: AppCheckMode, facts: AppCheckFacts, tokenUse: AppCheckTokenUse)
    : Result<AppCheckOutcome | null, AppCheckError>,
} as const;

// ports/app-check.port.ts (new)
/** The App Check switch as the edge reads it per call (`app-check.adapter.ts`, functions). */
export type ReadAppCheckMode = () => AppCheckMode;
export type AppCheckModePorts = { readonly appCheckMode: ReadAppCheckMode };

// ports/callables.ts — beside OPERATION_ID_FIELD, total over CallableName
export const CALLABLE_APP_CHECK_TOKEN: { readonly [N in CallableName]: AppCheckTokenUse } = {
  … every callable: AppCheckTokenUse.Standard, except
  [Callables.EraseClient]: AppCheckTokenUse.LimitedUse,
  [Callables.PreviewClientErasure]: AppCheckTokenUse.LimitedUse,
  [Callables.ExportClientData]: AppCheckTokenUse.LimitedUse,
  [Callables.StartImpersonation]: AppCheckTokenUse.LimitedUse,
  [Callables.SetRoles]: AppCheckTokenUse.LimitedUse,
};

// apps/functions/src/edge.ts (PA1's part): EDGE_DICTIONARIES + EdgeCode gain AppCheckErrorCode;
const APP_CHECK_WIRE: WireTable<AppCheckErrorCode> = {
  [AppCheckErrorCode.Required]: fields(S.FailedPrecondition),
  [AppCheckErrorCode.Replayed]: fields(S.FailedPrecondition),
};  // spread into EDGE_WIRE; no WIRE_PARAM_ALLOWLIST row (the outcome never leaves)
```

**2.A.2 functions (PA2).**

```ts
// apps/functions/src/lib/app-check.ts (new; the flags.ts idiom)
export const APP_CHECK_MODE = defineString('APP_CHECK_MODE', {
  default: AppCheckMode.Off,
  description: 'App Check: OFF | MONITOR | ENFORCE (config/app-check.json)',
  input: select(Object.values(AppCheckMode)),
});
// read only inside a call (the adapter below), never at module load (flags.ts rule) — no forwarder
// around `.value()` (creativo/no-identity-mapper); an unset variable reads '' (params/types.js:375-379)
/**
 * The platform options of a limited-use callable: consume while the switch is MONITOR or ENFORCE —
 * `APP_CHECK_MODE.equals('MONITOR').thenElse(true, APP_CHECK_MODE.equals('ENFORCE'))`, resolved at
 * definition (`v2/providers/https.js:136-139`), false for '' / OFF / an unknown value; `{}` otherwise.
 */
export function replayProtectedOptions(name: CallableName): { readonly consumeAppCheckToken?: Expression<boolean> };
/** Presence of the header (never its value), `request.app`, and `request.app.alreadyConsumed` — read defensively (StoredFields). */
export function appCheckFactsOf(request: CallableRequest<unknown>): AppCheckFacts;

// apps/functions/src/adapters/app-check.adapter.ts (new; the flags.adapter idiom)
/** The switch over the param: '' (unset) is OFF silently; a non-empty unknown value is OFF, logged ONCE per instance (fail-open, S-RU-19). */
export const paramAppCheckModePorts = (log: Log): AppCheckModePorts;  // reads APP_CHECK_MODE.value() per call, parses with Tag.has(AppCheckMode, raw)

// edge.ts: CallableEdgePorts = EdgePorts & LogContextPorts & LogDigestPorts & AppCheckModePorts;
// callableEdge, FIRST statement of the returned handler:
//   const verdict = AppCheckSystem.verdictOf(ports.appCheckMode(), appCheckFactsOf(request),
//     CALLABLE_APP_CHECK_TOKEN[spec.callable]);
//   const appCheckOutcome = verdict.ok ? verdict.value : verdict.error.appCheckOutcome;
//   untraced: verdict.ok ? the handler as today : settleCallable of the refusal (no line — RU-24)
//   traced:   invocationContext(…) gains appCheckOutcome (every line of the invocation carries it);
//             attempt() runs a handle that answers the refusal before decode / digest / budget,
//             so a refusal is ONE callable.refused line (errorCode APP_CHECK_*, wireStatus failed-precondition)
// main.ts: edge gains ...paramAppCheckModePorts(telemetry.log);
//   the five LIMITED_USE exports spread ...replayProtectedOptions(Callables.X) into their options;
//   the header comment (:190-200) says App Check now reads one switch
```

```jsonc
// config/app-check.json (new)
{ "development": "MONITOR", "staging": "OFF", "production": "OFF" }
```

`tools/flags/write-functions-env.mjs` gains `APP_CHECK_MANIFEST_PATH`,
`appCheckManifestErrors(manifest)` (exactly the three environments, each one
of the three modes), `appCheckModeOf({ manifest, environment, override,
projectId })` (an override only for a `demo-*` project — else an error), and
`renderEnv` / `writeFunctionsEnv` append ONE `APP_CHECK_MODE=<mode>` line to
`.env.<project>` (the chosen environment's mode) and to `.env.local` (the
development map's) — and, for a `demo-*` project with an override, the
override's mode to BOTH: the emulator loads `.env.local` LAST
(`firebase-tools/lib/functions/env.js:179-187`), so an override in
`.env.<project>` alone would leave the ENFORCE runs silently MONITOR.
`main()` reads `--app-check <MODE>` or `CREATIVO_APP_CHECK_MODE`.
`tools/flags/project.json` test inputs gain `config/app-check.json`.
`apps/functions/src/integration/operation-trace.integration.spec.ts` (PA2):
its exact `callable.completed` fields gain `appCheckOutcome: null`
(in-process, unset → OFF), and one MONITOR case stubs `APP_CHECK_MODE` before
the call (answered; `appCheckOutcome: 'MISSING'`).

**2.A.3 preflight P10 (PA3).**

```js
// tools/verify/preflight/preflight.mjs
CHECKS.P10 = 'App Check: the mode, and a web build that can satisfy ENFORCE';
SUBJECTS.P10 = 'App Check';
SCOPES.web = [...SCOPES.web, 'P10']; SCOPES.functions = [...SCOPES.functions, 'P10'];
export function checkAppCheck({ mode, siteKey, scripts, scope }) { … }  // pure; S-L-8's table
// liveReaders: appCheckMode() = appCheckModeOf over config/app-check.json and
//   chooseEnvironment({ projectId, requested: env.FLAGS_ENV }) — imported from
//   ../../flags/write-functions-env.mjs; siteKey() = the `appCheck: { siteKey: '…' }` literal of
//   apps/web/src/environments/environment.production.ts (null when unreadable); scripts = bundle()
```

In the functions scope P10 never calls `bundle()` (`preflight.spec.mjs:1360-1361`);
under ENFORCE it calls a new reader `liveBundle()` — `.firebaserc`'s `web`
hosting target for the project, `https://<site>.web.app/`, the `main-*.js`
its `index.html` names, searched with P4's literal idiom (`fetch` is already
the live readers' transport, `preflight.mjs:1398`) — and answers FAIL, never
SKIP, when it cannot read or P6 fails (it fails closed). The header comment
(`:7-42`, the scope sentence `:41-42` included) and `production-deploy.md`'s
predeploy table name P10. `tools/verify/project.json` test inputs gain
`config/app-check.json`, `apps/web/src/environments/environment.production.ts`
and `tools/flags/write-functions-env.mjs`.

**2.A.4 web (PA4).**

```ts
// apps/web/src/environments/environment.ts and environment.production.ts — both gain
  // App Check (Phase 4): the reCAPTCHA Enterprise SITE key — public client
  // config like `firebase` above; '' = not configured (no App Check loads).
  appCheck: { siteKey: '' },

// libs/infrastructure/firebase-app/src/lib/app-check.provider.ts (new)
export const AppCheckSource = {
  RecaptchaEnterprise: 'RECAPTCHA_ENTERPRISE',
  Emulator: 'EMULATOR',
  None: 'NONE',
} as const;
export type AppCheckConfig =
  | { readonly appCheckSource: typeof AppCheckSource.RecaptchaEnterprise; readonly siteKey: string }
  | { readonly appCheckSource: typeof AppCheckSource.Emulator }
  | { readonly appCheckSource: typeof AppCheckSource.None };
/** How long the RECAPTCHA_ENTERPRISE branch waits for `enterprise.js` before the page runs without App Check (S-L-24). */
export const APP_CHECK_SCRIPT_TIMEOUT_MS = 10_000;
/** Settles once per page: the instance, or `null` (NONE, or a script that failed / timed out). */
export const FIREBASE_APP_CHECK = new InjectionToken<Promise<AppCheck | null>>('FIREBASE_APP_CHECK');
/** emulators on → EMULATOR; else siteKey '' → NONE; else RECAPTCHA_ENTERPRISE. */
export function appCheckConfigOf(environment: {
  readonly emulators: { readonly enabled: boolean };
  readonly appCheck: { readonly siteKey: string };
}): AppCheckConfig;
/** The token + an environment initializer that starts it at boot (S-L-5). */
export function provideFirebaseAppCheck(config: AppCheckConfig): EnvironmentProviders;
//   RECAPTCHA_ENTERPRISE → append `<script src="https://www.google.com/recaptcha/enterprise.js?render=explicit">`
//                (through DOCUMENT; onload / onerror, raced against APP_CHECK_SCRIPT_TIMEOUT_MS); once
//                self.grecaptcha?.enterprise exists → initializeAppCheck(app, { provider: new
//                ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true }) (the SDK reuses the
//                loaded grecaptcha, esm :1107); error / timeout → null, initializeAppCheck never called, one
//                client issue reported (S-RU-31)
//   EMULATOR → initializeAppCheck(app, { provider: new CustomProvider({ getToken: async () =>
//                ({ token: emulatorAppCheckToken(app.options.appId), expireTimeMillis: <far future> }) }),
//              isTokenAutoRefreshEnabled: false })
//   NONE → Promise.resolve(null); firebase/app-check's initializeAppCheck is never called
/** Unsigned, JWT-shaped (`{"alg":"none"}` . `{"sub": appId}` . ''), base64url, built at run time (S-L-4). */
export function emulatorAppCheckToken(appId: string): string;

// provideFirebaseFunctions unchanged: the Functions SDK picks a later App Check instance up (esm :332-336)
// app.config.ts: provideFirebaseAppCheck(appCheckConfigOf(environment)) between provideFirebaseApp and Auth / Functions;
//   the GATEWAY_PORTS factory passes inject(FIREBASE_APP_CHECK) as callableClientPorts' 4th argument
// app.config.spec.ts: one stand-in { provide: FIREBASE_APP_CHECK, useValue: Promise.resolve(null) } beside
//   FIREBASE_APP / AUTH / FUNCTIONS — the EMULATOR factory would otherwise call initializeAppCheck({}, …)
//   (`_getProvider` reads `app.container` → TypeError while the injector is created)

// callable-client.adapter.ts — callableClientPorts(functions, ids, issues, appCheckReady: Promise<unknown>)
await appCheckReady;                     // settled within the bound; an already-settled promise afterwards
const LIMITED_USE: HttpsCallableOptions = { limitedUseAppCheckTokens: true };
const callable =
  CALLABLE_APP_CHECK_TOKEN[name] === AppCheckTokenUse.LimitedUse
    ? httpsCallable(functions, name, LIMITED_USE)
    : httpsCallable(functions, name);   // the standard callables' call is unchanged (no spec re-pin)
// a LIMITED_USE call rejected with a FirebaseError whose code starts with 'appCheck/' (the provider could
//   not mint a limited-use token; nothing was sent): report once, retry ONCE as httpsCallable(functions, name)
//   (S-RU-31) — a FunctionsError (the server answered) is never retried
// libs/ecs-core/src/ports/scheduling.port.ts:276 (doc comment only) names the four-argument factory

// csp-baseline.ts: export const RECAPTCHA_REPORT_ONLY_SINKS: readonly RegExp[] and
//   RECAPTCHA_REPORT_ONLY_POLICIES: readonly string[] (S-L-22), each with its own doc block
// reporting-error-handler.ts: isMapLibreBaseline → isMeasuredBaseline (private): report-only, and either a
//   `require-trusted-types-for` sample matching either sink list or a `trusted-types` sample naming a listed policy
```

Words (new copy, flagged §7 item 1): `errors.APP_CHECK_REQUIRED` — «Не
успяхме да потвърдим това устройство. Презареди страницата.» / "We couldn't
verify this device. Reload the page."

**2.A.5 CSP (PA5).** `firebase.json:41`'s `Content-Security-Policy` per
S-L-6 (every other directive byte-identical). `tools/verify/csp/check-csp.mjs`
gains exported `APP_CHECK_SOURCES` (the five sources by directive) and check
**(f)**: `script-src` holds both reCAPTCHA sources and no third-party host
besides them; `frame-src` is exactly the two; `connect-src` holds the
exchange host; and check **(g)**: the web hosting entry declares no
`redirects` (CSP drops a source's path after a redirect, so a same-origin
redirect would void the `script-src` path scope). `emulator-config.mjs` is
untouched (its superset is structural). `docs/security/csp-baseline.md`: the
policy block, the `frame-src` bullet (App Check's frames; OR-32's reason
still true for Auth), the `script-src` trade-off (Google requires
`www.google.com`; path-scoped; no `'strict-dynamic'`; (g) pins the
no-redirect premise), the `connect-src` beacon not admitted (S-RU-23), the
carried App Check bullet → done, a Trusted Types note (Deferred #3's second
blocker, the UNMEASURED lists).

**2.A.6 the rollout as the docs say it (PA5).** `production-deploy.md` gains
an "App Check" section and its §8 row is rewritten ("wired; the switch is
`config/app-check.json`, shipped OFF"), the budget bullet `:446-449` updated:

1. Create a reCAPTCHA Enterprise score-based **website** key for the hosting
   domains; register the web app under Firebase console → App Check →
   reCAPTCHA Enterprise; enable billing; paste the PUBLIC site key into
   `environment.production.ts` `appCheck.siteKey`. Enable the Firebase App
   Check API on the project and give the functions runtime service account
   the App Check token-verifier role (`roles/firebaseappcheck.tokenVerifier`,
   or any role holding the token-verify permission — confirmed in the
   console): the five consuming callables call `:verifyAppCheckToken`
   (S-RU-21).
2. Staging first: the same with a staging key — a temporary, NEVER-COMMITTED
   edit of `environment.production.ts` for the staging build (no staging
   configuration exists, `apps/web/project.json:40-70`; P10 then judges the
   edited file); the console open on a real browser — no enforced CSP
   violation (none from `connect-src` either, S-RU-23); record the Trusted
   Types samples of BOTH directives and correct `RECAPTCHA_REPORT_ONLY_SINKS`
   / `_POLICIES` if they differ (S-L-22); block `www.google.com` in DevTools
   (request blocking) and reload — the app must still work, its calls going
   out headerless (MISSING, S-RU-31); at staging MONITOR one real
   `exportClientData` reads `VALID`.
3. Deploy the web (P10 passes at OFF / MONITOR) — the CLIENT-side point of
   no return: from here every client loads reCAPTCHA whatever the server
   mode (S-RU-31 keeps a failure headerless); a key rolls back as
   `siteKey: ''` + a web deploy. Wait for the service worker to roll the new
   shell.
4. Set `production: "MONITOR"`; deploy functions only. Read the console's
   App Check → APIs → Cloud Functions verified share and the log filter
   `jsonPayload.appCheckOutcome` on the outcome lines (the sink: the
   platform's `callable-request-verification` lines). Hold until `MISSING` /
   `INVALID` / `REPLAYED` are explained (old tabs, blockers) PER CALLABLE —
   the filter grouped by `jsonPayload.callable`; each of the five LIMITED_USE
   callables shows real `VALID` calls and no unexplained `INVALID` — the
   owner's bar (§7 item 4).
5. Set `"ENFORCE"`; deploy functions only (P10 refuses it unless the LIVE
   web carries the key).
6. Firestore, then Storage: their App Check metrics at MONITOR, then the
   console's enforce switch (up to ~15 minutes to apply) — never code.
7. Rollback: `"OFF"` + a functions-only deploy.

The runbook §3 deploy order and its P-row lists gain P10 and these steps.

**2.A.7 `verify:appcheck` (PA3).** `package.json`:

```jsonc
"verify:appcheck": "pnpm nx build functions && node tools/flags/write-functions-env.mjs --project demo-creativo-test --app-check ENFORCE && firebase emulators:exec --only firestore,auth,functions --project demo-creativo-test \"node tools/verify/app-check/verify-app-check.mjs --expect ENFORCE\" && node tools/flags/write-functions-env.mjs --project demo-creativo-test --app-check MONITOR && firebase emulators:exec --only firestore,auth,functions --project demo-creativo-test \"node tools/verify/app-check/verify-app-check.mjs --expect MONITOR\""
```

The script posts raw callable requests to the Functions emulator (no auth,
the `verify-p0.mjs` request shape) and checks each answer:

| Expect  | Call (no auth)                                                            | No header                                    | Emulator token header                                         |
| ------- | ------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| ENFORCE | `cancelAppointment` (traced, standard)                                    | `failed-precondition` / `APP_CHECK_REQUIRED` | its own unauthenticated refusal (not `APP_CHECK_*`)           |
| ENFORCE | `eraseClient` (traced, limited-use)                                       | `failed-precondition` / `APP_CHECK_REQUIRED` | its own unauthenticated refusal — the consuming path answers  |
| ENFORCE | `reportClientIssues` (untraced)                                           | `failed-precondition` / `APP_CHECK_REQUIRED` | `ok` (one valid issue)                                        |
| ENFORCE | `cancelAppointment`, INVALID token (JWT-shaped, payload base64url `null`) | —                                            | `failed-precondition` / `APP_CHECK_REQUIRED`                  |
| MONITOR | `cancelAppointment`                                                       | its own unauthenticated refusal              | —                                                             |
| MONITOR | `cancelAppointment`, INVALID token                                        | —                                            | its own unauthenticated refusal (answered, not `APP_CHECK_*`) |
| MONITOR | `reportClientIssues`                                                      | `ok`                                         | —                                                             |

Its pure half (the case table, the answer reader) has a `node:test` spec;
the emulator token and the INVALID token come from ONE helper,
`tools/verify/app-check/emulator-token.mjs` (run-time builders, no literal;
also `verify-p0.mjs`'s), with its own spec pinning firebase-functions' JWT
shape. Each `--expect` run's FIRST post is the mode probe (a headerless
`cancelAppointment`: ENFORCE → `APP_CHECK_REQUIRED`, MONITOR → answered;
anything else fails the run), also runnable alone as `--probe <MODE>` for
the ENFORCE runs of §6.1 addition 2. CI's `emulators` job runs it after `verify:p0`
(`.github/workflows/ci.yml`; `ci-workflow.spec.mjs` pins the step).

**2.A.8 the proofs the task demands, and where each lives.**

| Proof                                                        | Unit / static                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Emulator / journey                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) OFF and MONITOR never refuse                             | `app-check.system.spec.ts`: the full grid (3 modes × every fact combination × 2 token uses), OFF / MONITOR always `ok`; `edge.spec.ts`: MONITOR + MISSING → `callable.completed` with the tag; OFF → `appCheckOutcome: null`, the handler runs                                                                                                                                                                                                                                      | the dev map is MONITOR: `verify:p0` (the emulator token → VALID), `e2e:web`, `verify:csp` pass in CI's mode; `test:emulator` runs the functions in-process at OFF (unset, S-RU-19) plus `operation-trace.integration.spec.ts`' MONITOR case (headerless → answered, MISSING); `verify:appcheck --expect MONITOR` (headerless, INVALID token) |
| (2) ENFORCE refuses a missing / invalid token, coded, tagged | `edge.spec.ts`: ENFORCE + MISSING and + INVALID → ONE `callable.refused` line `{ errorCode: 'APP_CHECK_REQUIRED', wireStatus: 'failed-precondition', appCheckOutcome }`, nothing decoded (a throwing payload getter), the pipeline never called; untraced: refused, no line                                                                                                                                                                                                         | `verify:appcheck --expect ENFORCE` (MISSING and INVALID end to end — the INVALID token, §0.4 item 1)                                                                                                                                                                                                                                         |
| (3) limited-use tokens consumed on the sensitive callables   | `callables.spec.ts`: the table is total and names exactly the five; `callable-client.adapter.spec.ts`: `limitedUseAppCheckTokens: true` for exactly those names; `app-check.spec.ts`: `replayProtectedOptions` → an expression for exactly those; `main.spec.ts`: the five exports' captured `onCall` options carry `consumeAppCheckToken`, no other export carries it or `enforceAppCheck`; `edge.spec.ts`: REPLAYED refused on a limited-use callable, answered on a standard one | `verify:appcheck`: the consuming `eraseClient` answers under ENFORCE with the token (the emulator's `alreadyConsumed: false`); the replay itself is unit-only (A.9)                                                                                                                                                                          |
| (4) the journeys pass in the mode CI runs                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | every stage gate runs the journeys in MONITOR (CI's); C_A adds the ENFORCE runs of `verify:p0` (its posts carry the token), `e2e:web` and `verify:csp` (the browser carries it), each opened by the mode probe                                                                                                                               |
| (5) the preflight refuses ENFORCE without a site key         | `preflight.spec.mjs`: `checkAppCheck` cases — OFF pass; MONITOR with / without a key (INFO); ENFORCE without a key FAIL; ENFORCE with a key absent from the bundle FAIL (web scope); ENFORCE ok PASS; an unknown mode FAIL; functions scope + ENFORCE: the live bundle carries the key PASS, lacks it FAIL, unreachable FAIL, P6 failing FAIL; `bundle()` never called in the functions scope; the live reader over today's tree PASSes (OFF)                                       | —                                                                                                                                                                                                                                                                                                                                            |
| (6) a client whose App Check fails never hangs (S-RU-31)     | `app-check.provider.spec.ts`: a script `error`, and no `load` within `APP_CHECK_SCRIPT_TIMEOUT_MS` (fake timers), each leave `initializeAppCheck` uncalled and resolve `null` (one client issue); `callable-client.adapter.spec.ts`: the call awaits `appCheckReady`; an `appCheck/recaptcha-error` rejection on `eraseClient` → exactly one standard retry, reported once                                                                                                          | the owner's staging smoke with `www.google.com` blocked (§2.A.6 step 2)                                                                                                                                                                                                                                                                      |

**2.A.9 step-up — the ready contract (NOT built in Phase 4, S-RU-22).**
After the owner adds a T2 row ("an admin's sign-in age, `auth_time`, within
`stepUpMaxAgeMinutes` of now, for the erasure's FIRST call and `setRoles`")
and the OTP provider lands: `PrivacyErrorCode.StepUpRequired =
'PRIVACY_STEP_UP_REQUIRED'` (`unauthenticated`, `support.step_up_required`
in the research's words); a pure `StepUpSystem.isFresh(authTimeUtcMs,
nowUtcMs, maxAgeMinutes)` over `UtcEpochMs.compare` / `plusMinutes`; the
wire reads `auth_time` (seconds) through the `caller-roles.ts`
`StoredFields` idiom; `eraseClient` checks it only on a call whose stored
tag is NONE (the loop's first); the card's alert raises a re-verify sheet
that locks the identifier and re-runs the house OTP; the research's
`stepUpMaxAgeMinutes = 5` (`client-details-design.md:1227`).

---

## 3. Packages — waves and DISJOINT file ownership

**Rules for every package** (the Phase 0–3 rules, carried): re-read each
site before editing; NEVER git commit, push, stash, checkout, reset,
restore, switch or worktree-add (only the orchestrator commits); undo your
own edit by the inverse edit; `git grep` misses untracked files (`grep -r`
for new files and "no caller" proofs); never `pnpm install/add/remove`,
never `nx reset`; never run an emulator journey (`verify:p0`,
`test:emulator`, `e2e:web`, `verify:csp`, `verify:appcheck`) — the
orchestrator runs them, one at a time; never run the runbook grep gates
themselves (they write a canary into the repo, which the wave partner's lint
would read) — the **name check** sources the §4.0 arrays from a scratch copy
OUTSIDE the repo and runs EACH array with the flags its gate uses (`-wF` for
the `W*` / `M*` / `T*` / `R9` lists, `-F` for `K*` / `S2` / `F2` and the
`'status'` / `['status']` pair) over the package's ADDED text — the `^+`
lines of `git diff -U0` of its tracked files plus every line of its new
untracked files (K2 binds the `*otp*`, `*registration*`, `*identity*`,
`*profile*`, `*impersonation*` files — `start-impersonation.pipeline.ts`,
`impersonation.system.ts`, `profile-action.data.ts`,
`identity.port.ts`, `impersonation.integration.spec.ts` among this phase's:
no `'status'`, `'purpose'`, `['scope']`, `expiresAt:`, `createdAt:`,
`startedAt:` there); a spec or script reads a root file
(`firestore.rules`, `storage.rules`, `firebase.json`, `config/*.json`, the
runbook, `ci.yml`, an environment file) with `readFileSync(new URL('…',
import.meta.url))` or `resolve(…)` — never an `import … from
'../../../…'` (Law 8.3); typecheck is project-scoped (`pnpm nx run
<project>:typecheck --skip-nx-cache`) — `rm -rf dist/out-tsc && run-many -t
typecheck` is the orchestrator's. A file not in a package's list is not its
to edit: a forced edit elsewhere is reported, never made. **At most two
builders run at a time**; a wave lists its packages; the next wave starts
when both are back and the orchestrator has checked the tree. Emulator-only
specs a package writes (`*.integration.spec.ts`, the rules specs, e2e specs)
are typechecked / linted by the builder and run by the orchestrator at the
stage boundary. A package that touches an Angular template runs `pnpm nx
build web`. A package's report goes to the scratchpad (`build-S<pkg>.md`):
files touched, checks run with their numbers, anything forced elsewhere.

| Stage (commit)                | Waves (≤ 2 builders)                          | Commit boundary                                                                                                                                       |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| C_B — WS-B error scrub        | W-B1: PB                                      | one commit after W-B1 + the stage gate                                                                                                                |
| C_C — WS-C erased can't write | W-C1: PC1 ‖ PC2                               | one commit after W-C1 + the stage gate (`test:emulator` — the Storage rules spec and the impersonation case)                                          |
| C_D — WS-D rules              | W-D1: PD                                      | one commit after W-D1 + the stage gate (`test:emulator` — the rules spec; `e2e:web` — the staff journeys write notes and photos under the new rules)  |
| C_E — WS-E setRoles           | W-E1: PE1 · W-E2: PE2 ‖ PE3                   | one commit after W-E2 + the stage gate (`test:emulator` — `set-roles.integration.spec.ts`; `verify:p0`; `e2e:web` — the roles journey)                |
| C_F — WS-F walk-in card       | W-F1: PF                                      | one commit after W-F1 + the stage gate (`e2e:web` — the walk-in privacy journey)                                                                      |
| C_A — WS-A App Check          | W-A1: PA1 · W-A2: PA2 ‖ PA4 · W-A3: PA3 ‖ PA5 | one commit after W-A3 + the FULL gate (§6.1) + the Phase 4 additions (`verify:appcheck`, the ENFORCE runs of `verify:p0`, `e2e:web` and `verify:csp`) |

Every commit's gate runs on exactly the tree it commits: no wave of the
next workstream starts before the previous stage is committed. Across the
sequential waves of one stage a file may have successive owners, each
editing on top of the committed-to-tree work of the one before (the
orchestrator checks the tree between waves); each is marked "(sequential:
…)" in both lists:

- C_E: PE1 → PE2 — `apps/functions/src/edge.ts` (PE1 adds the nine `GOVERNANCE_WIRE` rows; PE2 does not touch it — listed only so nobody else does); `libs/ecs-core/src/pipelines/index.ts` is PE2's alone.
- C_A: PA1 → PA2 — `apps/functions/src/edge.ts` (PA1 the dictionary, `EdgeCode` and `APP_CHECK_WIRE`; PA2 `CallableEdgePorts` and `callableEdge`), `apps/functions/src/edge.spec.ts` (PA1 nothing but what the totality needs; PA2 the cases); PA2 → PA3 — `tools/flags/write-functions-env.mjs` (PA2 writes it; PA3 only imports from it — never edits).

Files edited in several STAGES (always on the committed tree of the stage
before): `main.ts` / `main.spec.ts` (PB, PE2, PA2), `edge.ts` (PC1, PE1,
PA1, PA2), `governance.error.ts` (+ spec) (PC1, PE1), `ports/callables.ts`
(+ spec) (PE1, PA1), `ports/identity.port.ts` (PE1, PF),
`testing/port-doubles.ts` (PE2, PF), `log-event.data.ts` (+ spec) (PE1,
PA1), `app.config.ts` (PE3, PF, PA4), `ports.tokens.ts` (PE3, PF),
`client-card.store.ts` (+ spec) (PE3, PF), `client-card.html` /
`client-card.ts` (PE3, PF if needed), the i18n catalogues (PE3, PA4),
`docs/production-deploy.md` (PC2, PD, PE2, PA5), the runbook (PD, PE2, PA5),
`firebase-app/src/index.ts` (PE3, PA4).

### PB — WS-B the scrubbed error reports (W-B1)

- **Files:** `apps/functions/src/adapters/console-telemetry.adapter.ts`,
  `console-telemetry.adapter.spec.ts`, `firestore-audit.adapter.ts`,
  `firestore-audit.adapter.spec.ts`, `firestore-accounts.adapter.ts`,
  `firestore-accounts.adapter.spec.ts`, `firestore-coupons.adapter.ts`,
  `firestore-coupons.adapter.spec.ts`, `firestore-settings.adapter.ts`,
  `firestore-settings.adapter.spec.ts`, `apps/functions/src/main.ts`
  (`settledCommit` and its doc only), `apps/functions/src/main.spec.ts`
  (`:2085-2091` only), `apps/functions/src/wire/loyalty.wire.ts` (the doc
  comment `:78-86` only).
- **Brief:** §2.B. No other `main.ts` edit; `loyalty.wire.spec.ts` stays
  unchanged (its fixtures build the struct directly); `edge.ts` unchanged.
- **Checks:** `pnpm nx test functions`, `pnpm nx run functions:typecheck
--skip-nx-cache`, `pnpm nx lint functions`; `grep -rn "String(error)\|String(cause)"
apps/functions/src --include=*.ts | grep -v spec` = `console-telemetry.adapter.ts`'s
  `describe` and `firestore-tx.adapter.ts:346` (a path match, never logged)
  only; name check (`reason`, `thrown`).

### PC1 — WS-C the impersonation target guard (W-C1)

- **Files:** `libs/ecs-core/src/errors/governance.error.ts`,
  `governance.error.spec.ts`, `libs/ecs-core/src/systems/impersonation.system.ts`,
  `impersonation.system.spec.ts`, `libs/ecs-core/src/pipelines/start-impersonation.pipeline.ts`,
  `start-impersonation.pipeline.spec.ts`, `apps/functions/src/edge.ts`
  (`GOVERNANCE_WIRE` rows only), `apps/functions/src/integration/impersonation.integration.spec.ts`.
- **Brief:** §2.C (impersonation). The read is inside the existing commit;
  self-impersonation and the structural checks stay before it; no new port.
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx test functions`, typecheck
  and lint of `ecs-core` and `functions`; name check
  (`ImpersonationTargetNotFound`, `ImpersonationTargetErased`,
  `ImpersonationTargetNotRegistered`,
  `GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND`,
  `GOVERNANCE_IMPERSONATION_TARGET_ERASED`,
  `GOVERNANCE_IMPERSONATION_TARGET_NOT_REGISTERED`, `admitTarget`,
  `impersonationTargetNotFound`, `impersonationTargetErased`,
  `impersonationTargetNotRegistered`) — K2 binds
  the three `*impersonation*` files.

### PC2 — WS-C the Storage guard (W-C1, beside PC1)

- **Files:** `storage.rules`,
  `libs/infrastructure/firestore/src/testing/emulator-test-env.ts` (a
  Storage-and-Firestore variant beside `createEmulatorTestEnv`),
  `libs/infrastructure/firestore/src/lib/storage.rules.integration.spec.ts`
  (new), `libs/infrastructure/firestore/project.json` (`test-integration`
  and `test` inputs: `{workspaceRoot}/firestore.rules`,
  `{workspaceRoot}/storage.rules`), `docs/production-deploy.md` (§3.2 Rules
  `:715-729` — `:269` is the OTP sender's section: the Storage rules
  service agent's Firestore read, granted at the first deploy's prompt; one
  billed read per upload).
- **Brief:** §2.C (Storage), S-L-11, S-L-12. The new spec is the first in
  the repo to drive the Storage emulator through `@firebase/rules-unit-testing`'s
  `storage()`; the lib's integration config runs jsdom with Angular's
  `test-setup.ts` (`vitest.integration.config.mts`), so the spec may open
  with `// @vitest-environment node` if the upload fails under jsdom.
- **Checks:** `pnpm nx lint firestore`, `pnpm nx run firestore:typecheck
--skip-nx-cache` (if the project has one; else the lib's lint), `pnpm nx
test firestore` (the unit target must not pick up the new
  `*.integration.spec.ts`); name check (`accountMayUpload`,
  `createStorageRulesTestEnv` or the chosen name).

### PD — WS-D the three rules (W-D1)

- **Files:** `firestore.rules` (the three blocks and their comments only),
  `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`,
  `libs/infrastructure/firestore/src/lib/stamp-window.rules-text.spec.ts`,
  `libs/infrastructure/firestore/src/lib/visit-media-writers.integration.spec.ts`,
  `libs/infrastructure/firestore/src/lib/rules-key-parity.rules-text.spec.ts`
  (new — the compile-checked key tables vs the rules' `hasOnly` lists),
  `libs/infrastructure/firestore/src/lib/scheduling.adapter.integration.spec.ts`
  (only if a case writes an id its body does not match — re-read; expected
  untouched), `docs/production-deploy.md` (§3.2 Rules `:715-729`: the S-DEP-5
  constraints beside DEP-15's), `docs/architecture/firestore-runbook.md`
  (the §3 rules sentence only — re-read its line; never §4).
- **Brief:** §2.D, S-RU-7, S-RU-8, S-L-14, S-L-27.
- **Checks:** `pnpm nx test firestore` (the two text specs), lint and
  typecheck of `firestore`; `grep -c "stampInWindow(" firestore.rules`
  unchanged (3 = the helper + two uses); the e2e and P0 seeds write these
  collections with the Admin SDK only (`grep -rn "appointmentNotes\|appointmentPhotos\|scheduleExceptions"
apps/web/e2e tools/verify/p0` — report any client write); name check
  (the new spec's identifiers).

### PE1 — WS-E ecs-core contracts and the decision (W-E1)

- **Files:** `libs/ecs-core/src/components/roles.data.ts`,
  `roles.data.spec.ts`, `role.rules-parity.spec.ts`,
  `components/audit-context.data.ts`, `audit-context.data.spec.ts`,
  `components/profile-action.data.ts`, `components/roles-call.data.ts`
  (new), `roles-call.data.spec.ts` (new), `components/index.ts`,
  `entities/identity-entities.type-spec.ts` (the Profile variant narrows on
  the new verb), `errors/governance.error.ts`, `governance.error.spec.ts`,
  `systems/role-assignment.system.ts` (new), `role-assignment.system.spec.ts`
  (new), `systems/audit.system.ts` (`planRolesChanged`), `audit.system.spec.ts`,
  `systems/index.ts`, `ports/identity.port.ts` (`AuthSessionRevokePorts`),
  `ports/governance.port.ts` (`SetRoles`, `RolesAdminPorts`),
  `ports/callables.ts`, `callables.spec.ts`, `primitives/log-event.data.ts`,
  `log-event.data.spec.ts`, `apps/functions/src/edge.ts` (the nine
  `GOVERNANCE_WIRE` rows only; sequential: PE1 → nobody).
- **Brief:** §2.E (ecs-core). `RoleAssignmentSystem` imports components and
  entities only; no port.
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx run ecs-core:typecheck
--skip-nx-cache`, `pnpm nx lint ecs-core`, `pnpm nx run
functions:typecheck --skip-nx-cache` (the wire table stays total), `pnpm
nx run verify-tools:layering --skip-nx-cache`; name check (`ASSIGN`,
  `ASSIGNABLE`, `assignsRoles`, `ProfileRolesChanged`,
  `PROFILE_ROLES_CHANGED`, `RolesCall`, `decodeChanged`, `rolesChanged`,
  `RoleAssignment`, `RoleAssignmentSystem`, `planRolesChanged`, the nine
  `GOVERNANCE_ROLES_*` codes and their factories, `RevokeRefreshTokens`,
  `AuthSessionRevokePorts`, `SetRoles`, `RolesAdminPorts`, `SetRoles` /
  `setRoles`, `RolesChanged`, `RolesChangeRefused`,
  `RolesSessionsNotRevoked`, `RolesSessionsRevoked`, `offerOf`, `changeOf`,
  `saveOf`, `RoleChange`) — K2 binds `profile-action.data.ts` and
  `identity.port.ts`.

### PE2 — WS-E the pipeline, the functions and the proof (W-E2)

- **Files:** `libs/ecs-core/src/pipelines/set-roles.pipeline.ts` (new),
  `set-roles.pipeline.spec.ts` (new), `pipelines/index.ts`,
  `libs/ecs-core/src/testing/port-doubles.ts` (the auth double gains a
  `revokeRefreshTokens` recorder), `apps/functions/src/adapters/auth-claims.adapter.ts`,
  `auth-claims.adapter.spec.ts`, `apps/functions/src/wire/governance.wire.ts`,
  `governance.wire.spec.ts`, `apps/functions/src/main.ts` (`rolesPorts`,
  `setRoles`, the header's export count), `apps/functions/src/main.spec.ts`
  (the `@core/pipelines` seam's `PIPELINES` list `:36-70` gains `'setRoles'`
  — else the case table runs the real pipeline over the mocked bundle; an
  `ENDPOINTS` row `:263-338`, from which `EXPORTS` derives `:341`; the case
  table, `FLIPPED_EXPORTS` 50 → 51, the gate-order loop),
  `apps/functions/src/integration/set-roles.integration.spec.ts` (new),
  `tools/ops/names.env`, `tools/ops/log-metrics.sh`,
  `tools/ops/alerts/roles-sessions-not-revoked.yaml` (new),
  `tools/verify/ops/ops-scripts.spec.mjs` (five → six metrics),
  `docs/architecture/firestore-runbook.md` (`:287`'s claims sentence; the
  export counts; `:282` six counters), `docs/production-deploy.md` (the export
  count; the bootstrap item: the first admin stays console / seed, every
  later change through `setRoles`).
- **Brief:** §2.E (functions). `setRoles` takes `LOG_DIGEST_SECRETS`;
  limited-use comes with C_A.
- **Checks:** `pnpm nx test ecs-core` (the pipeline spec; coverage of the
  new pipeline ≥ 95 % by `pnpm nx test ecs-core --coverage
--testTimeout=30000` on the file), `pnpm nx test functions`, typecheck and
  lint of `ecs-core` and `functions`, `pnpm nx test verify-tools` (the ops
  spec); name check (`setRoles`, `SetRolesPorts`, `SetRolesCommand`,
  `SetRolesError`, `rolesPorts`, `decodeSetRoles`, `authSessionRevokePorts`,
  `METRIC_ROLES_SESSIONS_NOT_REVOKED`, `roles_sessions_not_revoked`) —
  `tools/ops` and `tools/verify` sit in `STORE`.

### PE3 — WS-E the card's «Роли» block (W-E2, beside PE2)

- **Files:** `libs/infrastructure/firebase-app/src/lib/roles-admin.adapter.ts`
  (new), `roles-admin.adapter.spec.ts` (new),
  `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`,
  `libs/infrastructure/firebase-app/src/index.ts`,
  `apps/web/src/app/app.config.ts`, `libs/features/staff/client-card/src/lib/client-card.store.ts`,
  `client-card.store.spec.ts`, `client-card/client-card.html`,
  `client-card/client-card.ts`, `client-card/client-card.spec.ts`,
  `client-card.words.ts`, `client-card.words.spec.ts`,
  `client-pages.vm.ts`, `client-roles.presenter.ts` (new),
  `client-roles.presenter.spec.ts` (new),
  `libs/features/staff/client-card/src/testing/client-card.fixtures.ts`
  (a `ROLES_ADMIN_PORTS` double), `libs/infrastructure/i18n/src/assets/i18n/bg.json`,
  `en.json`, `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts`
  (only if its code tables must list the new reachable codes),
  `apps/web/e2e/staff-client-roles.spec.ts` (new),
  `apps/web/e2e/support/seed-firestore.ts` (a helper only if the journey
  needs one beyond `seedUserProfile`).
- **Brief:** §2.E (web), S-L-18, the copy of §7 item 1 (OR-51 / OR-55).
- **Checks:** `pnpm nx test client-card` (the card's project name — the
  builder confirms with `nx show projects`), `pnpm nx test firebase-app`,
  `pnpm nx test i18n`, lint of each, `pnpm nx lint web`, `pnpm nx build
web`; `pnpm nx test web` if `app.config.spec.ts` lives there; name check
  (`ROLES_ADMIN_PORTS`, `rolesAdminPorts`, `ClientRolesVm`,
  `ClientRoleToggleVm`, `clientRolesVm`, `toggleRole`, `saveRoles`, the new
  i18n keys).

### PF — WS-F the walk-in record's card (W-F1)

- **Files:** `libs/ecs-core/src/ports/identity.port.ts`
  (`CustomerRecordPorts`, `CustomerReadPorts`), `libs/ecs-core/src/testing/port-doubles.ts`
  (`loadCustomer` over the memory records), `libs/infrastructure/firestore/src/lib/customers.adapter.ts`,
  `customers.adapter.spec.ts`, `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`,
  `apps/web/src/app/app.config.ts` (the `LazyMethod` row),
  `libs/features/staff/client-card/src/lib/client-card.contracts.ts`,
  `client-card.store.ts`, `client-card.store.spec.ts`,
  `libs/features/staff/client-card/src/testing/client-card.fixtures.ts`,
  `libs/features/staff/client-card/src/testing/achievements-pages.rig.ts`,
  `libs/features/staff/dashboard/src/lib/visit-editor/client-search.ts`,
  `client-search.spec.ts`, `visit-editor/staff-visit-editor.ts`, its spec
  (`cardSubjectOf` cases, if present), `staff-dashboard/staff-dashboard.ts`
  (`personOf`), its spec (the WALK_IN seat case, if a seat → option spec
  exists), `apps/web/e2e/staff-walk-in-privacy.spec.ts` (new),
  `apps/web/e2e/support/seed-firestore.ts` (`seedWalkInRecord`).
- **Brief:** §2.F, S-RU-15, S-L-19. Every other `ClientCardSubject`
  constructor the compiler names is in this list; one outside it is
  reported.
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx test firestore`, `pnpm nx
test client-card`, `pnpm nx test dashboard` (names confirmed with `nx show
projects`), typecheck and lint of each, `pnpm nx lint web`, `pnpm nx build
web`; `grep -rn "accountOf(\|guest-" libs/features/staff/client-card/src/lib`
  shows no record id parsed from a key; name check (`LoadCustomer`,
  `loadCustomer`, `CustomerRecordPorts`, `CustomerReadPorts`,
  `seedWalkInRecord`).

### PA1 — WS-A ecs-core contracts and the edge's vocabulary (W-A1)

- **Files:** `libs/ecs-core/src/primitives/app-check-mode.data.ts` (new),
  `app-check-mode.data.spec.ts` (new), `primitives/app-check-outcome.data.ts`
  (new), `app-check-outcome.data.spec.ts` (new),
  `primitives/app-check-token-use.data.ts` (new),
  `app-check-token-use.data.spec.ts` (new), `primitives/index.ts`,
  `primitives/log-event.data.ts`, `log-event.data.spec.ts`,
  `errors/app-check.error.ts` (new), `app-check.error.spec.ts` (new),
  `errors/index.ts`, `systems/app-check.system.ts` (new),
  `app-check.system.spec.ts` (new), `systems/index.ts`,
  `ports/app-check.port.ts` (new), `ports/index.ts`, `ports/callables.ts`,
  `callables.spec.ts`, `apps/functions/src/edge.ts` (sequential: PA1 →
  PA2 — `EDGE_DICTIONARIES`, `EdgeCode`, `APP_CHECK_WIRE` only).
- **Brief:** §2.A.1.
- **Checks:** `pnpm nx test ecs-core`, typecheck / lint of `ecs-core` and
  `functions`, `pnpm nx test functions` (the edge's totality over the
  dictionaries on disk), layering; name check (`AppCheckMode`,
  `appCheckMode`, `AppCheckOutcome`, `appCheckOutcome`, `AppCheckTokenUse`,
  `appCheckTokenUse`, `LIMITED_USE`, `AppCheckModeUnreadable`,
  `AppCheckErrorCode`, `APP_CHECK_REQUIRED`, `APP_CHECK_REPLAYED`,
  `AppCheckError`, `AppCheckFacts`, `appCheckTokenSent`,
  `appCheckTokenVerified`, `appCheckTokenReplayed`, `AppCheckSystem`,
  `outcomeOf`, `verdictOf`, `ReadAppCheckMode`, `AppCheckModePorts`,
  `CALLABLE_APP_CHECK_TOKEN`, `APP_CHECK_WIRE`).

### PA2 — WS-A the functions switch and the edge (W-A2)

- **Files:** `apps/functions/src/lib/app-check.ts` (new),
  `apps/functions/src/lib/app-check.spec.ts` (new),
  `apps/functions/src/adapters/app-check.adapter.ts` (new),
  `app-check.adapter.spec.ts` (new), `apps/functions/src/edge.ts`
  (sequential: PA1 → PA2), `apps/functions/src/edge.spec.ts`,
  `apps/functions/src/main.ts`, `apps/functions/src/main.spec.ts`,
  `config/app-check.json` (new), `tools/flags/write-functions-env.mjs`,
  `tools/flags/write-functions-env.spec.mjs`, `tools/flags/project.json`,
  `apps/functions/src/integration/operation-trace.integration.spec.ts`
  (`appCheckOutcome: null` in the exact fields; the MONITOR case).
- **Brief:** §2.A.2, S-L-1, S-L-2; S-RU-19's unset `''`.
- **Checks:** `pnpm nx test functions`, `pnpm nx test flag-tools`,
  typecheck / lint of `functions`, `node --check
tools/flags/write-functions-env.mjs`; `grep -rn "enforceAppCheck"
apps/functions/src --include=*.ts | grep -v spec` = 0;
  `grep -rn "consumeAppCheckToken" apps/functions/src --include=*.ts | grep -v spec`
  = `lib/app-check.ts` only; name check (`APP_CHECK_MODE`,
  `replayProtectedOptions`, `appCheckFactsOf`,
  `paramAppCheckModePorts`, `APP_CHECK_MANIFEST_PATH`,
  `appCheckManifestErrors`, `appCheckModeOf`, `CREATIVO_APP_CHECK_MODE`).

### PA4 — WS-A the web (W-A2, beside PA2)

- **Files:** `apps/web/src/environments/environment.ts`,
  `apps/web/src/environments/environment.production.ts`,
  `libs/infrastructure/firebase-app/src/lib/app-check.provider.ts` (new),
  `app-check.provider.spec.ts` (new), `callable-client.adapter.ts`,
  `callable-client.adapter.spec.ts`, `csp-baseline.ts`,
  `reporting-error-handler.ts`, `reporting-error-handler.spec.ts`,
  `libs/infrastructure/firebase-app/src/index.ts`,
  `libs/infrastructure/firebase-app/src/csp-baseline.ts` (only if the new
  list must reach the smoke — it need not; expected untouched),
  `apps/web/src/app/app.config.ts`, `apps/web/src/app/app.config.spec.ts`
  (the one stand-in), `libs/infrastructure/firestore/src/lib/streak-publish.adapter.spec.ts`
  (`:82` — `callableClientPorts(…)` gains a resolved `appCheckReady`),
  `libs/ecs-core/src/ports/scheduling.port.ts` (the doc comment `:276`
  only), `libs/infrastructure/i18n/src/assets/i18n/bg.json`,
  `en.json`, `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts`
  (only if its tables must list `APP_CHECK_REQUIRED`).
- **Brief:** §2.A.4, S-L-4, S-L-5, S-L-22, S-L-24. `app.config.spec.ts`
  gains ONE stand-in, `{ provide: FIREBASE_APP_CHECK, useValue:
Promise.resolve(null) }` beside the three Firebase singletons (the EMULATOR
  factory would otherwise call `initializeAppCheck({}, …)` and throw while
  the injector is created); its intent — nothing loads, nothing reaches the
  network — is unchanged.
- **Checks:** `pnpm nx test firebase-app`, `pnpm nx test web`, `pnpm nx
test i18n`, `pnpm nx test firestore` (the streak publish adapter spec:
  one constructor argument added; its `:132`, `:419` call assertions
  unchanged — the standard call is unchanged), `pnpm nx run
ecs-core:typecheck --skip-nx-cache`, lint of each,
  `pnpm nx build web` + `pnpm run verify:bundle` (record the initial kB);
  `grep -rn "eyJ" libs/infrastructure/firebase-app/src` = 0 (no token
  literal); name check (`AppCheckSource`, `appCheckSource`,
  `RECAPTCHA_ENTERPRISE`, `AppCheckConfig`, `FIREBASE_APP_CHECK`,
  `appCheckConfigOf`, `provideFirebaseAppCheck`, `emulatorAppCheckToken`,
  `RECAPTCHA_REPORT_ONLY_SINKS`, `RECAPTCHA_REPORT_ONLY_POLICIES`,
  `APP_CHECK_SCRIPT_TIMEOUT_MS`, `appCheckReady`, `isMeasuredBaseline`,
  `siteKey`).

### PA3 — WS-A the preflight row, the journey and CI (W-A3)

- **Files:** `tools/verify/preflight/preflight.mjs`,
  `tools/verify/preflight/preflight.spec.mjs`,
  `tools/verify/app-check/verify-app-check.mjs` (new),
  `tools/verify/app-check/verify-app-check.spec.mjs` (new),
  `tools/verify/app-check/emulator-token.mjs` (new),
  `tools/verify/app-check/emulator-token.spec.mjs` (new),
  `tools/verify/p0/verify-p0.mjs` (the header at its raw posts, S-RU-26),
  `tools/verify/project.json` (test inputs), `package.json` (the
  `verify:appcheck` script only), `.github/workflows/ci.yml` (one step in
  the `emulators` job; its `timeout-minutes` only if S-L-28 needs it),
  `tools/verify/ci/ci-workflow.spec.mjs`.
- **Brief:** §2.A.3, §2.A.7, S-L-8, S-L-9, S-L-28; the preflight header
  `:7-42` (the scope sentence `:41-42` included).
- **Checks:** `pnpm nx test verify-tools`, `node --check` on the touched
  `.mjs`, `pnpm nx lint verify-tools` (if the project lints); name check
  (`P10`, `checkAppCheck`, `liveBundle`, `verify:appcheck`, the journey's
  and the token helper's identifiers) — `tools/verify` is in `STORE`, so
  W1 / K1 / K2 apply in full; `grep -rn "eyJ" tools/verify` = 0 (no token
  literal).

### PA5 — WS-A the CSP and the docs (W-A3, beside PA3)

- **Files:** `firebase.json` (the `Content-Security-Policy` value only),
  `tools/verify/csp/check-csp.mjs`, `tools/verify/csp/check-csp.spec.mjs`
  (new), `docs/security/csp-baseline.md`, `docs/production-deploy.md` (the
  App Check section, `:446-449`, `:963`, the predeploy table's P10 and its
  prose `:36-37`, `:43`, `:740`, `:786`, the CSP section, the staging smoke
  checkbox, §1 "Monitoring and privacy" `:451-513`: the reCAPTCHA
  disclosure / privacy line / pre-consent view, the Storage rules agent
  grant, the App Check API and token-verifier role), `docs/architecture/firestore-runbook.md`
  (§3 deploy order, the P-row lists `:245`, `:271`, `:277`; never §4).
- **Brief:** §2.A.5, §2.A.6, S-L-6, S-RU-23, S-RU-32.
- **Checks:** `pnpm nx test verify-tools` (the new CSP spec), `pnpm nx build
web && node tools/verify/csp/check-csp.mjs` (the static half — (a)–(f)
  on the production build), `node --check tools/verify/csp/check-csp.mjs`;
  `pnpm run lint:styles` is not touched; name check (`APP_CHECK_SOURCES`).

---

## 4. Specs per package (added / changed ON PURPOSE)

Specs never read the wall clock (pinned `nowUtcMs`, `FIXTURE_NOW`); every
new system spec has the purity case (`deepFreeze`d inputs, same input →
same output); every PII-bearing input carries SENTINEL values
(`'Sentinel Firstname'`, `'+359880000777'`, `'sentinel@example.invalid'`,
`'sentinel note text'`) so a scan proves absence by string search over the
serialised writes, rows and log entries.

| Package | Added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Changed on purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PB      | `console-telemetry.adapter.spec.ts` + `trackError(new Error('no route to +359880000777 for sentinel@example.invalid'), { callable })` → exactly one `write` entry, `severity: 'ERROR'`, `message`'s first line `Error: <scrubbed>`, every other line `^ {4}at \S`, and `JSON.stringify(calls)` holds neither sentinel (nor the phone without its `+`); an `Error` with `code: 'bad-sentinel@example.invalid'`, `cause: leakyError` and `details: { phone }` leaks none (cause / details dropped); a thrown non-`Error` object holding the sentinels is scrubbed; a frame with `?token=…` is cut; the scope rides under the call's context. The four adapter specs + a thrown `Error('… +359880000777 …')` → the failure's `reason` is the canonical code and the sentinel is absent; the audit adapter's failure line holds `reason`, no message. The recorded residual (S-L-25): `'Sentinel Firstname'` and `'sentinel note text'` inside an `Error`'s message SURVIVE the scrub and the spec pins that they do (so a stricter scrub is a visible change), beside the phone and e-mail it proves absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `:103-112` ("logs an Error as itself" → a scrubbed whole entry through `write`), `:239-251` (`args: [boom, …]` → the entry), `:337-346` (`logger.error` spy → `logger.write`); `:114-131` and `:133-140` re-read — their values survive `scrub` unchanged (assert the text, not the writer). `firestore-audit.adapter.spec.ts:109` (`error: 'Error: unavailable'` → `reason: 'unknown'` — its fixture throws `new Error('unavailable')` with no `code`, `:94`, and `FailureCodeSystem.codeOf` answers `unknown`, `failure-code.system.ts:44-57`). `main.spec.ts:2085-2091` (`error: 'Error: deadline exceeded'` → the canonical `'unknown'`)                                                                                                                                                                                   |
| PC1     | `impersonation.system.spec.ts` + `admitTarget`: `null` → NOT_FOUND naming the uid; an `ERASED` user → ERASED; a `PROVISIONED` stub → NOT_REGISTERED; `ACTIVE` and `BLOCKED` → ok; the order absent → ERASED → NOT_REGISTERED; purity. `governance.error.spec.ts` + the three factories. `start-impersonation.pipeline.spec.ts` + an absent target → `GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND`, nothing committed, one refusal line; an `ERASED` target → `…_TARGET_ERASED`, no session, no row; a `PROVISIONED` target → `…_TARGET_NOT_REGISTERED`, nothing written; a `BLOCKED` target still starts; precedence — an unauthenticated / forbidden caller and a self-impersonation are refused BEFORE the read (the read callback never runs). `impersonation.integration.spec.ts` + an `ERASED` target writes no session and no audit row (emulator)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `start-impersonation.pipeline.spec.ts` `rig()` (`:51-56`) seeds `users/{TARGET}` (`registeredUserFixture({ id: TARGET })`) for every start case, the `tx.plans` equality (`:104-125`) unchanged otherwise; `impersonation.integration.spec.ts`' `start()` cases (`:126-134`) seed `users/CLIENT` after the `beforeEach` clear                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PC2     | `storage.rules.integration.spec.ts` (emulator; project `demo-creativo-test`, run-unique uids, cleanup) — an `ACTIVE` user uploads `avatars/<uid>/original` (a PNG): allowed; an `ERASED` user: create AND update refused; the `ERASED` user's delete: allowed; another user's path: refused; no `users` document: refused (fail-closed); 5 MiB and a non-image: refused (today's missing pins); anonymous: refused; a public read: allowed; `appointmentPhotos/*` still staff-only (one case); an unknown path: denied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PD      | `firestore.rules.integration.spec.ts` + notes: a note on an existing appointment succeeds; on an absent appointment id refused; an extra key refused; the delete of a note whose appointment is absent still allowed. Photos: a UUID id on an existing appointment succeeds; a `photo-1`-style id refused; an absent `appointmentId` refused; an extra key refused; (flag 26) an unknown `photoOrigin` refused, a `SHOT` whose `path` names another appointment or another id refused, a `LIBRARY` photo with the library object's path accepted. Exceptions: id `ivan__2026-09-0x` matching the body succeeds; a mismatching id refused; a body `localDate` not `YYYY-MM-DD` refused; an extra key refused; the CLOSED variant (no ranges) accepted; delete unchanged. `rules-key-parity.rules-text.spec.ts`: each block's `hasOnly` list equals the spec's compile-checked key table of its entity; `exists(` once per notes and photos block; the UUID pattern once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `stamp-window.rules-text.spec.ts:93-95` (the notes `allow create, update` string), `:104-106` (the photos `allow create` string) — the new folded strings, still containing `worksTheBook()`, the author / taker equality and one `stampInWindow(`; `:73-80` counts unchanged. `firestore.rules.integration.spec.ts`: the notes block seeds `appointments/appt-1`, `appt-2`, `appt-new*` before each create (bodies already carry exactly the three keys); every created photo id becomes a UUID-shaped constant and every created SHOT's `path` becomes `appointmentPhotos/appt-1/<that uuid>` (`:1811`, `:1840`) (each refusal case keeps its stated reason only); reads / deletes of seeded `photo-*` unchanged. `visit-media-writers.integration.spec.ts` seeds `appointments/appt-1` and gives the photo writer a UUID id |
| PE1     | `role-assignment.system.spec.ts` — purity; the caller's STORED roles without `admin` → FORBIDDEN (a sysadmin too); self → SELF; target absent / `PROVISIONED` / `ERASED` / holding `sysadmin` → the four codes; requested empty / unknown / `sysadmin` → INVALID; duplicates and order normalised; the same set → `rolesChanged: false`; a caller blocked at `nowUtcMs` (and an `ERASED` caller) → FORBIDDEN; `offerOf` (self, a sysadmin subject, an `ERASED` / `PROVISIONED` subject, no subject, a non-assigning viewer → false), `changeOf` (order, duplicates, empty), `saveOf` (a pending revoke → true even unchanged); a property case (fast-check): over every caller × target × requested set the system admits, the caller is an admin not blocked at `nowUtcMs` (or the target holds `admin`) after the plan (S-RU-11). `audit.system.spec.ts` + `planRolesChanged`: actor credited (`Actor.forCaller`), `PROFILE_ROLES_CHANGED`, `profileFields: ['roles']`, the two tag arrays, no name / phone / e-mail (sentinel scan), the id stable for the same instant. `roles.data.spec.ts` + `ASSIGN`, `ASSIGNABLE`, `assignsRoles`; `roles-call.data.spec.ts` (`decodeChanged`: a usable answer; a missing field / unknown role → `PIPELINE_UNKNOWN`); `governance.error.spec.ts` + nine factories; `callables.spec.ts` + the `setRoles` lines; `log-event.data.spec.ts` + four values, each matching `/^[a-z]+\.[a-z_]+$/`; the type-spec line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `audit-context.data.spec.ts` (the verb list / partition gains `PROFILE_ROLES_CHANGED` in the Profile group; the regex `:68` unchanged); `role.rules-parity.spec.ts` (the callable-only lists gain `ASSIGN`, `ASSIGNABLE`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| PE2     | `set-roles.pipeline.spec.ts` (memory ports, `pinnedNowUtcMs`) — the committed plan is `[Update users/<target> { roles, profileEditedAtUtcMs }, Create auditLog/<id>]` in ONE commit; revoke called AFTER the commit, once; the row's actor is `Actor.forCaller(adminUserId, stored roles)` — a token `['admin', 'barber']` against stored `['admin']` credits `['admin']`; a successful revoke logs `RolesSessionsRevoked { targetUserId, rolesChanged }` (the no-op path too); an unchanged set commits no write and still revokes; every refusal commits nothing and never revokes; a failed revoke answers `GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` with the roles committed and logs `RolesSessionsNotRevoked` (here, not in the integration spec: the emulator cannot make the Admin revoke fail); a replay with the same operation id after success plans no row. `auth-claims.adapter.spec.ts` + `revokeRefreshTokens` ok; `auth/user-not-found` → ok; another failure → its code, never the message (a sentinel in the message never reaches the error). `governance.wire.spec.ts` + `decodeSetRoles`: no uid → UNAUTHENTICATED and a non-admin token → FORBIDDEN, both before the payload is read (a throwing getter proves it); a bad uid / non-array / unknown role → INVALID; `operationId` optional. `main.spec.ts` + the `setRoles` `ENDPOINTS` row and case. `set-roles.integration.spec.ts` (emulator Firestore + Auth; real `firestoreCommitPlan`, real `authSessionRevokePorts`) — an admin promotes a client to barber: `users.roles` is `['client', 'barber']` (dictionary order, `role.data.ts:15-22`), exactly ONE `PROFILE_ROLES_CHANGED` row whose ids match; the target signed in ≥ 1 s before the revoke (the Auth emulator stamps `validSince` in whole seconds, `firebase-tools/lib/emulator/auth/operations.js:863-864`), so `tokensValidAfterTime` moved past the sign-in and the target's refresh is refused `TOKEN_EXPIRED` (`:1729`); the profile trigger over the before / after image (`decodeDocumentChangeEvent` + the audit handler, the `governed-audit.integration.spec.ts` idiom) plans NO second row; a custom token minted for the target through the real claims path after the change carries `roles: ['client', 'barber']` (the next sign-in's claims come from the written roles); self, a `sysadmin` target and an `ERASED` target refused with nothing written; a target with no Auth user: roles written, revoke treated as done. `ops-scripts.spec.mjs`: the sixth metric's filter is the `roles.sessions_not_revoked` LogEvent value and its alert exists | `main.spec.ts` the seam's `PIPELINES` (`:36-70`, + `'setRoles'`), the `ENDPOINTS` row (`:263-338`; `EXPORTS` derives, `:341`), the case table, `FLIPPED_EXPORTS toHaveLength(50)` (`:1141` → 51), the gate-order loop (`:1313` gains `setRoles`); `ops-scripts.spec.mjs` (`:324` five → six metrics)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PE3     | `roles-admin.adapter.spec.ts` (dials `setRoles`, input untouched, a `PipelineError` passes through); `client-roles.presenter.spec.ts` (bg + en words; the saved line; a refusal worded through `wordPipelineError`); `client-card.store.spec.ts` + a `describe`: `roles` is `null` without the port, for a non-admin / sysadmin viewer, for the viewer's own account, for a target holding `sysadmin`, for a guest, offline; a toggle then save calls `setRoles` once with the act's ONE operation id, reused on its retry; the answer refreshes the toggles; after a `GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` answer the line stays and Save stays enabled with the toggles unchanged, and Save re-dials `setRoles` with the stored set; `client-card.spec.ts` + the block renders after the privacy block for an admin viewer, its toggles and Save; `client-card.words.spec.ts` + the keys. `apps/web/e2e/staff-client-roles.spec.ts`: an admin (stored `roles: ['admin']` + claims) opens a seeded client's card through the agenda, ticks «Бръснар», saves → an Admin-SDK read shows `roles` with `barber` and one `PROFILE_ROLES_CHANGED` row for the uid; a barber viewer sees no block; axe light and dark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none (the card's existing cases unchanged — the block is additive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PF      | `customers.adapter.spec.ts` + `loadCustomer` (guarded; a malformed document dropped and reported; absent → `null`; a failure → its code). `client-search.spec.ts` + a walk-in record's option carries `customerId`, an account's `null`. `client-card.store.spec.ts` + a record subject: `customerId()` set at once, `loadCustomer` called once, no profile / loyalty / waitlist / avatar read, the privacy block present for an admin viewer and absent for barber / receptionist / sysadmin / flag off / offline; an `ERASED` record → the erased offer; an absent record → the block keeps the id, the erasure offer its default. The editor / dashboard specs + a WALK_IN seat's option carries `seat.subjectCustomerId`; an ANONYMOUS seat `null`. `apps/web/e2e/staff-walk-in-privacy.spec.ts`: an admin opens a visit, adds a client by the seeded walk-in's phone, opens their row's card → «Лични данни» shows; «Изтегли данните» downloads one file naming the record; «Изтрий личните данни» → the alert → «Изтрий» → an Admin-SDK read shows the record `ERASED`; no account or Auth user is touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `client-card.store.spec.ts`' "reads nothing for a guest" (split: a TYPED guest reads nothing; a walk-in record reads its record); `client-search.spec.ts`' `recordOption` shape; the fixtures' `GUEST` / subject builders gain `customerId: null` (`client-card.fixtures.ts:1026`, `:1042`, `achievements-pages.rig.ts:339`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PA1     | `app-check-mode.data.spec.ts`, `app-check-outcome.data.spec.ts`, `app-check-token-use.data.spec.ts` (values once, SCREAMING, `Tag.has`); `app-check.error.spec.ts` (factories, flat, `APP_CHECK_` prefix, each struct's outcome); `app-check.system.spec.ts` (purity; `outcomeOf`'s truth table over the 8 fact combinations; `verdictOf`'s full grid — OFF and MONITOR never `err`, OFF answers `null`; ENFORCE refuses MISSING / INVALID with their outcome and REPLAYED only on LIMITED_USE); `callables.spec.ts` + `CALLABLE_APP_CHECK_TOKEN` total and exactly the five; `log-event.data.spec.ts` + the value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PA2     | `app-check.spec.ts` (functions lib): `appCheckFactsOf` over `rawRequest: {}` (no headers — MISSING facts), a header with no `app` (INVALID facts), `app` set (verified), `app.alreadyConsumed: true` (replayed); the header's VALUE is never read (a getter that throws); `replayProtectedOptions` over every `Callables` member agrees with the table. `app-check.adapter.spec.ts`: each mode read through; `''` (unset) → `OFF` and NO line; a non-empty unknown value → `OFF` and ONE `edge.app_check_mode_unreadable` line across two reads; `replayProtectedOptions`' expression is false for `''`, `OFF` and an unknown value, true for `MONITOR` / `ENFORCE`. `operation-trace.integration.spec.ts` + the MONITOR case (headerless → answered, `appCheckOutcome: 'MISSING'`). `edge.spec.ts` + the grid of §2.A.8 (1)–(3): MONITOR + MISSING → completed with the tag; ENFORCE + MISSING / INVALID → one refused line, nothing decoded, no pipeline call; ENFORCE + REPLAYED on `eraseClient` → `APP_CHECK_REPLAYED`, on `cancelAppointment` → answered; untraced `reportClientIssues` under ENFORCE → refused, no line; OFF → `appCheckOutcome: null`. `main.spec.ts` + the captured `onCall` options (a `vi.mock` of `firebase-functions/v2/https` that delegates to the real `onCall`, keyed by the returned handler): exactly the five LIMITED_USE exports carry `consumeAppCheckToken`, none carries `enforceAppCheck`. `write-functions-env.spec.mjs` + `appCheckManifestErrors` (an unknown environment / mode, a missing one), `appCheckModeOf` (the chosen environment; the override honoured for `demo-*`, refused for a real project), the shipped manifest is valid and its `development` is `MONITOR`; under an override the mode lands in BOTH `.env.demo-…` and `.env.local`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `edge.spec.ts` — the ports double (`:1153`) gains `appCheckMode`; the outcome-line equalities `:1372-1385`, `:1426-1438` gain `appCheckOutcome: null` (through `SCOPE`), and so does the `bound` literal `:1398-1406` (not through `SCOPE`). `main.spec.ts:2285-2296` (`toEqual` gains `appCheckOutcome: null`). `operation-trace.integration.spec.ts:222-239` (the exact fields gain `appCheckOutcome: null`). Before C_A every exact-equality outcome / scope assertion `grep -rn "wireStatus: 'ok'\|roles: \[\]," apps/functions/src --include=*.spec.ts` finds is re-read (today: `edge.spec.ts`, `main.spec.ts`, `operation-trace…`; `export-client-data…` uses `objectContaining`). `write-functions-env.spec.mjs:163-184` (both env files gain the `APP_CHECK_MODE=MONITOR` line for the demo project)                  |
| PA3     | `preflight.spec.mjs` + `checkAppCheck` (§2.A.8 (5)); `runPreflight` all-pass tables with P10; the live reader over today's tree (OFF, the empty key) PASSes. functions scope + ENFORCE: `liveBundle()` with / without the key, unreachable, P6 failing. `verify-app-check.spec.mjs`: the case table (ENFORCE and MONITOR rows of §2.A.7, the INVALID rows and the probe included), the answer reader (status + `details.errorCode`). `emulator-token.spec.mjs`: the emulator token's JWT shape and `sub`; the INVALID token matches `JWT_REGEX` and its payload decodes to `null`; no literal token in the source. `ci-workflow.spec.mjs` + the `emulators` job runs `pnpm run verify:appcheck` after `verify:p0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `preflight.spec.mjs:1323-1336` (`SCOPES.web` / `.functions` gain P10; `CHECKS` = their union), `:1346`, `:1358` (the all-pass tables gain the P10 row), `:1370` (the P6-fail SKIP set — P10 is NOT skipped: at OFF / MONITOR it reads files only, at ENFORCE in the functions scope it FAILs; the expectation states it), `:1404-1416` and `:1679-1699` (the exact functions-scope row lists gain `['P10', Pass]` — P8 alone still stops a functions deploy), `fakeReaders()` `:249-280` (gains `appCheckMode` (OFF), `siteKey` and `liveBundle` readers — else P10 FAILs "cannot read" in every `runPreflight` case), `:1360-1361` holds (the functions scope never calls `bundle()`). `ci-workflow.spec.mjs:115-131` (the commands / jobs table gains the step)                                                              |
| PA4     | `app-check.provider.spec.ts`: `appCheckConfigOf` (emulators on → EMULATOR; key `''` → NONE; else RECAPTCHA_ENTERPRISE); RECAPTCHA_ENTERPRISE → `initializeAppCheck(app, { provider: ReCaptchaEnterpriseProvider instance, isTokenAutoRefreshEnabled: true })`; EMULATOR → a `CustomProvider`, auto-refresh off, its token JWT-shaped with `sub` = the app id and decodable; NONE → `null`, `initializeAppCheck` never called; the environment initializer starts the token; the fail-safe (S-L-24): a script `error`, and no `load` within `APP_CHECK_SCRIPT_TIMEOUT_MS` (fake timers), each leave `initializeAppCheck` uncalled and resolve `null` with one client issue; a script that loads → `initializeAppCheck` once over the loaded `grecaptcha.enterprise`. `callable-client.adapter.spec.ts` + `it.each` over `Callables`: `httpsCallable` gets `{ limitedUseAppCheckTokens: true }` for exactly the five, two arguments for every other; no call leaves before `appCheckReady` settles; an `appCheck/recaptcha-error` rejection on `eraseClient` → exactly one standard retry, reported once; a `FunctionsError` is never retried. `reporting-error-handler.spec.ts` + a report-only TT violation matching `RECAPTCHA_REPORT_ONLY_SINKS` is dropped, and a report-only `trusted-types` sample naming `goog#html`; an enforced one and a non-matching report-only one are kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `app.config.spec.ts` (the `FIREBASE_APP_CHECK` stand-in; intent unchanged); `callable-client.adapter.spec.ts:97` and `streak-publish.adapter.spec.ts:82` (the factory's resolved `appCheckReady` argument); `callable-client.adapter.spec.ts:110` and `streak-publish.adapter.spec.ts:132`, `:419` stay as they are (the standard call keeps its two arguments, S-L-3 / §2.A.4); the i18n parity specs stay total (bg and en together)                                                                                                                                                                                                                                                                                                                                                                                         |
| PA5     | `check-csp.spec.mjs` (new): (a)–(e) over synthetic configs and HTML, (f) — a policy with the five App Check sources passes; one missing, one extra third-party `script-src` / `frame-src` host, `frame-src 'none'`, and a wildcard each fail; (g) — a hosting entry with a `redirects` entry fails; the REAL `firebase.json` passes (f) and (g)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | none (no spec pinned `frame-src 'none'`); `apps/web/e2e/csp/csp-smoke.spec.ts` unchanged (the smoke builds the emulator path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 5. DEPARTURES

Every behaviour change, with before / after, evidence and the specs (and
P0 / emulator / e2e files) changed on purpose. Anything not listed is
frozen.

**WS-B**

- **S-DEP-1 (PB) — a tracked error leaves as a scrubbed whole entry.** Before: `trackError(error)` handed the raw `Error` to `logger.error`, which `util.format`s its message, stack, `cause` and own properties into the entry (`console-telemetry.adapter.ts:162`); a thrown non-`Error` was written as `describe(thrown)` raw. After: ONE ERROR entry through `sink.write`, `message` = the rebuilt stack (`<name>: <scrubbed message>` + scrubbed frames), `error` = `{ name, code, message, stack }`; `cause` / `details` / other properties dropped; a non-`Error` scrubbed. Error Reporting still groups by the server's frames. Evidence: R36 / T5; HANDOFF `:2619-2620`. Specs: `console-telemetry.adapter.spec.ts:103-112`, `:239-251`, `:337-346` (changed), + the sentinel cases.
- **S-DEP-2 (PB) — store failures name their canonical code, never `String(error)`.** Before: five sites put `String(error)` into a `RepositoryError.reason` or a log field (§0.1 B.3), so an SDK message reached the streak publish's `rhythm rule write failed` line and the audit adapter's failure line. After: `readFailed` / `writeFailed` / `FailureCodeSystem.codeOf` — the code (`unavailable`, `unknown`, …); the audit failure line's field is `reason`. Specs: `firestore-audit.adapter.spec.ts:109`, `main.spec.ts:2085-2091` (changed), + the four adapter sentinel cases. Droppable alone (S-RU-2).

**WS-C**

- **S-DEP-3 (PC1) — `startImpersonation` refuses an absent, erased or unregistered target.** Before: no read; a session and its free-text `reason` were written for any uid (`start-impersonation.pipeline.ts:118-136`). After: one read of `users/{target}` inside the commit; absent → `GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND` (`not-found`), `ERASED` → `…_TARGET_ERASED`, a `PROVISIONED` stub → `…_TARGET_NOT_REGISTERED` (both `failed-precondition`); nothing written; one refusal line; `BLOCKED` still starts. Specs: `start-impersonation.pipeline.spec.ts` (the rig seeds a registered target), `impersonation.integration.spec.ts` (seeds `users/CLIENT`), `governance.error.spec.ts` (+3); the edge's totality covers the rows. Evidence: Phase 3 flag 23.
- **S-DEP-4 (PC2) — an erased account (or one with no `users` document) cannot upload an avatar.** Before: owner + size + type (`storage.rules:41-47`). After: + one `firestore.get(users/{uid})` whose `accountStatus` is not `ERASED`; deletes unchanged. The first deploy of `storage.rules` asks to grant the Storage rules agent Firestore read (`rulesDeploy.js:17-18`); one billed read per upload. Specs: `storage.rules.integration.spec.ts` (new, emulator). `libs/infrastructure/firestore/project.json` inputs gain both rules files (the carried cache item closes). Evidence: Phase 3 flag 23.

**WS-D**

- **S-DEP-5 (PD) — notes, photos and exceptions refuse an id they do not name.** Before: any book worker could create a note under any id, a photo under any id, an exception under any id with any keys (`firestore.rules:360-366`, `:379-386`, `:570-577`). After: a note needs its appointment to exist and only its three keys; a photo needs a UUID id, its body's appointment to exist, only its twelve keys, a known `photoOrigin` and — for a `SHOT` — the `path` `appointmentPhotos/<appointmentId>/<photoId>` (Phase 3 flag 26); an exception's id must be its body's `barberId__localDate`, its `localDate` date-shaped and its keys the six. The app's own writers already comply (one minter per id, compile-checked bodies), so no web behaviour changes. Specs: `firestore.rules.integration.spec.ts` (notes seed appointments; photo ids → UUIDs; + the new cases), `stamp-window.rules-text.spec.ts:93-95`, `:104-106`, `visit-media-writers.integration.spec.ts` (seed + UUID); `rules-key-parity.rules-text.spec.ts` (new). E2e unchanged (the staff journeys write on seeded appointments with minted ids and the minter's path) — the C_D gate's `e2e:web` proves it. Docs: `production-deploy.md` §3.2, the runbook §3 rules sentence. Evidence: HANDOFF `:2603-2611`, `:3110-3112` (flag 26).

**WS-E**

- **S-DEP-6 (PE1, PE2) — an admin-only `setRoles` callable (51 exports).** Before: no path changed `users.roles` but the seed and the console; a console change left only the trigger's process row; claims changed only at the next sign-in (HANDOFF `:2594-2595`). After: `setRoles` writes `users.roles` and ONE `PROFILE_ROLES_CHANGED` row (credited to the admin, roles as tags) in one commit, the trigger skips it (`profileEditedAtUtcMs`), then revokes the target's refresh tokens (each successful revoke logged `roles.sessions_revoked`; a failed one logged and alerted, `roles_sessions_not_revoked`); the guards of S-L-15. Specs: `main.spec.ts` (`EXPORTS`, case table, `FLIPPED_EXPORTS` 51, the gate loop), `callables.spec.ts`, `audit-context.data.spec.ts` (verb list), `roles.data.spec.ts`, `role.rules-parity.spec.ts`, `ops-scripts.spec.mjs` (changed); the pipeline, system, wire, adapter and integration specs (added). Docs: the runbook's claims sentence `:287`, the six counters `:282`, the export counts.
- **S-DEP-7 (PE3) — the card's «Роли» block.** Before: no admin UI for roles. After: an admin viewer sees five toggles and Save on an account's card (not their own, not a sysadmin's); new copy (§7 item 1). Specs: added only (store, component, presenter, words, adapter, `staff-client-roles.spec.ts`).

**WS-F**

- **S-DEP-8 (PF) — a walk-in record's card opens record-keyed.** Before: a walk-in's card showed the seat's head and nothing else; export / erasure could not be reached for a person with no account (Phase 3 flag 11). After: `ClientCardSubject.customerId` carries the record id from the search or a WALK_IN seat; the card sets it at once, reads `customers/{id}` for its erasure tag, and shows the admin's privacy block (export, erase) keyed by the record. `CUSTOMER_PORTS` binds `CustomerReadPorts`. Specs: `client-card.store.spec.ts` (the guest case split), `client-search.spec.ts` (`recordOption`), the fixtures' subjects (`customerId: null`) (changed); the adapter, store, editor / dashboard and `staff-walk-in-privacy.spec.ts` cases (added). `staff-walk-in.spec.ts` unchanged (a barber viewer; the head unchanged).

**WS-A**

- **S-DEP-9 (PA2) — every callable reads the App Check switch; outcome lines carry `appCheckOutcome`.** Before: no App Check logic; the line `{ callable, operationId, uid, roles, errorCode, wireStatus, durationMs, inputDigest }`. After: the edge reads `APP_CHECK_MODE` per call; every traced line carries `appCheckOutcome` — `null` under OFF (production and staging today), the observed tag under MONITOR / ENFORCE. Specs: `edge.spec.ts` (the double, `:1372-1385`, `:1398-1406`, `:1426-1438`), `main.spec.ts:2285-2296`, `operation-trace.integration.spec.ts:222-239` (changed), + its MONITOR case.
- **S-DEP-10 (PA1, PA2) — ENFORCE refuses `APP_CHECK_REQUIRED` / `APP_CHECK_REPLAYED`.** Before: every request ran its handler whatever its App Check header. After: under ENFORCE only, a request with no verified token (or a replayed one on a limited-use callable) is refused `failed-precondition` before decode — ONE `callable.refused` line (none for the untraced sink). Unreachable on the shipped manifest outside the emulator journeys. Specs: added (system, edge, error, `verify:appcheck`).
- **S-DEP-11 (PA2) — five callables consume their App Check token while the switch is MONITOR or ENFORCE.** Before: no platform App Check option on any export (`main.ts:196`). After: `eraseClient`, `previewClientErasure`, `exportClientData`, `startImpersonation`, `setRoles` carry `consumeAppCheckToken: APP_CHECK_MODE.equals('MONITOR').thenElse(true, APP_CHECK_MODE.equals('ENFORCE'))` (one extra App Check round-trip per call when on; false for an unset `''`). Specs: `main.spec.ts` (+ the captured options case), `app-check.spec.ts`. The `ENDPOINTS` table is unchanged (the option is not in `__endpoint`).
- **S-DEP-12 (PA2) — the switch's manifest and the env files.** Before: `.env.<project>` / `.env.local` held one `PARAM=true|false` line per flag. After: + `APP_CHECK_MODE=<mode>` from `config/app-check.json` (`development` MONITOR, so every emulator run verifies and tags; `staging` / `production` OFF); the demo-only override. Specs: `write-functions-env.spec.mjs:163-184` (changed), + the manifest cases. Every Functions-emulator journey's outcome lines gain the tag (`verify:p0`'s and e2e's calls read `VALID`, S-DEP-18); none is refused.
- **S-DEP-13 (PA3) — preflight P10 in both predeploys.** Before: P1–P6 (web), P1–P3 + P6–P9 (functions). After: + P10 (the mode; FAIL on ENFORCE without a site key, or without it in the built bundle for the web scope). PASSes on today's tree. In the functions scope an ENFORCE flip is judged on the LIVE web (`liveBundle()`, fail-closed). Specs: `preflight.spec.mjs:249-280`, `:1323-1336`, `:1346`, `:1358`, `:1370`, `:1404-1416`, `:1679-1699` (changed), + `checkAppCheck`. Docs: `production-deploy.md`'s table and its prose (`:36-37`, `:43`, `:740`, `:786`), the runbook's P-row lists, the preflight header `:7-42`.
- **S-DEP-14 (PA3) — a new journey `verify:appcheck`, in CI and in the FULL gate.** Before: no journey exercised App Check. After: `pnpm run verify:appcheck` (ENFORCE then MONITOR, §2.A.7) runs in CI's `emulators` job after `verify:p0` (its `timeout-minutes` raised 30 → 45 only if the C_A measurement needs it, S-L-28) and, alone, in HANDOFF §4's gate. Specs: `ci-workflow.spec.mjs:115-131` (changed), `verify-app-check.spec.mjs`, `emulator-token.spec.mjs` (added).
- **S-DEP-15 (PA4) — the web initialises App Check and asks limited-use tokens for five callables.** Before: no App Check on the web. After: under the emulators a `CustomProvider` (every e2e call carries the emulator token); with a site key, reCAPTCHA Enterprise (auto-refresh), its script loaded by the provider with a bounded wait — a script that fails or times out leaves the page without App Check, every call going out headerless, never hanging (S-RU-31); with none (production today), nothing loads; callables wait for that bounded decision; the five LIMITED_USE callables ask `limitedUseAppCheckTokens` and fall back once to a standard call when the provider cannot mint one. The reporter drops the reCAPTCHA script's report-only Trusted Types sample (UNMEASURED). Initial bundle grows by `@firebase/app-check` (measured at C_A, §6.3). Specs: `app-check.provider.spec.ts` (added); `callable-client.adapter.spec.ts`, `reporting-error-handler.spec.ts` (cases added); `app.config.spec.ts` (one stand-in), `streak-publish.adapter.spec.ts:82` and `callable-client.adapter.spec.ts:97` (one constructor argument) (changed).
- **S-DEP-16 (PA5) — the CSP admits the reCAPTCHA and App Check hosts.** Before: `frame-src 'none'`, no Google host in `script-src` / `connect-src` (`firebase.json:41`). After: S-L-6's five sources; `check-csp.mjs` (f) pins them. Supersedes OR-29's `frame-src 'none'` for that directive (S-RU-23). `check-csp.mjs` (g) refuses a hosting `redirects` entry. Specs: `check-csp.spec.mjs` (new). Docs: `csp-baseline.md`. The Hosting smoke is unchanged (S-RU-32).
- **S-DEP-17 (PA4) — new copy `errors.APP_CHECK_REQUIRED`.** bg + en, flagged (§7 item 1).
- **S-DEP-18 (PA3) — `verify:p0` presents the emulator App Check token.** Before: its raw posts carried no App Check header (`verify-p0.mjs:208-262`, `:311`). After: each post carries the run-time emulator token of `tools/verify/app-check/emulator-token.mjs` (S-RU-26), so P0 passes under ENFORCE too and its lines read `VALID`; the headerless refusal is `verify:appcheck`'s. Specs: `emulator-token.spec.mjs` (added); P0's own checks unchanged.

---

## 6. Gates

### 6.1 The FULL gate (the Phase 0–2 brief's §9, verbatim — one command at a time)

```bash
pnpm nx sync:check
pnpm nx run verify-tools:layering --skip-nx-cache
rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache
pnpm nx run-many -t lint
pnpm nx run-many -t test --parallel=3 --skip-nx-cache   # includes the preflight spec (verify-tools)
pnpm nx test ecs-core --coverage   # thresholds 90/95 pass; statements never below the measured baseline; new system/pipeline files ≥ 95 %
pnpm nx typecheck seed-tools && pnpm nx test lint-rules
pnpm run lint:styles
pnpm nx build web && pnpm run verify:bundle
pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
# alone: runbook grep gates §4.0 preamble, then §4.2–§4.10, 0 FAIL
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web
pnpm run verify:csp
```

The runbook grep gates run through the committed runner (`pnpm nx run
verify-tools:runbook-gates`, alone; `--allow-dirty` on an uncommitted tree —
Phase 3 P3-DEP-26). Known load flakes (HANDOFF §4):
`auth-onboarding.spec.ts:63` and `:106`, `appointments.spec.ts:36` and
`:161`, `client-card-harness.spec.ts:17` [tablet / desktop] and `:40`
[phone], the landing hero screenshot; under `--parallel=3` the heavy
`staff-dashboard`, `staff-client-card`, `marketing-landing` and
`booking-return-url.spec.ts` specs — judged on a solo `--repeat-each=3`
re-run. ecs-core coverage with `--testTimeout=30000`. Emulator journeys with
the proxy variables unset.

**Phase 4 additions to the FULL gate** (from C_A on, alone, one at a time):

1. `pnpm run verify:appcheck` — the ENFORCE and MONITOR journey (§2.A.7);
   HANDOFF §4 gains it after `verify:csp`.
2. **The ENFORCE runs** (C_A and the final gate): `verify:p0`, `e2e:web`
   and `verify:csp`, each its package script's own command with
   `CREATIVO_APP_CHECK_MODE=ENFORCE` set and
   `node tools/verify/app-check/verify-app-check.mjs --probe ENFORCE && `
   prefixed to its `emulators:exec` payload — the probe posts one headerless
   callable and requires `failed-precondition` / `APP_CHECK_REQUIRED`, so a
   run whose emulator silently ran MONITOR fails (S-L-2: the override lands
   in `.env.local` too; the orchestrator also reads
   `dist/apps/functions/.env.local` first). Each must pass exactly as its
   MONITOR run does (P0's posts and the browser carry the emulator token).
   Afterwards the orchestrator re-runs
   `node tools/flags/write-functions-env.mjs --project demo-creativo-test`
   so the dist env is back at the development map.

### 6.2 Per package and per stage

Per package: its §3 "Checks", nothing else. Per stage (orchestrator, before
the commit): `rm -rf dist/out-tsc` + `run-many -t typecheck
--skip-nx-cache`, `run-many -t lint`, `run-many -t test --parallel=3
--skip-nx-cache`, layering, `pnpm nx build web` (C_E, C_F, C_A), the grep
gates alone through the runner, and the journeys of the table below (one at
a time); the full §6.1 after C_A and after each review fix round.

| Stage | `test:emulator`                           | `verify:p0`              | `e2e:web`                                  | `verify:csp` | `verify:appcheck` |
| ----- | ----------------------------------------- | ------------------------ | ------------------------------------------ | ------------ | ----------------- |
| C_B   | —                                         | yes (the edge's tracker) | —                                          | —            | —                 |
| C_C   | yes (Storage rules, impersonation)        | —                        | —                                          | —            | —                 |
| C_D   | yes (the rules spec, media writers)       | —                        | yes (notes and photos under the new rules) | —            | —                 |
| C_E   | yes (`set-roles.integration.spec.ts`)     | yes                      | yes (the roles journey)                    | —            | —                 |
| C_F   | —                                         | —                        | yes (the walk-in privacy journey)          | —            | —                 |
| C_A   | the FULL §6.1 + Phase 4 additions 1 and 2 |                          |                                            |              |                   |

Pass-specific checks (orchestrator; `grep -r` sees untracked files):

```bash
grep -rn "sink.error(error" apps/functions/src --include=*.ts | grep -v spec          # 0 (C_B)
grep -rn "String(error)\|String(cause)" apps/functions/src --include=*.ts | grep -v spec # describe() + firestore-tx's path match only (C_B)
grep -n "firestore.get(" storage.rules                                                  # 1 (C_C)
grep -n "hasOnly(\[" firestore.rules | grep -c "authorUserId\|appointmentId\|barberId"  # the three new lists (C_D)
node -e 'const j=require("./firestore.indexes.json");console.log(j.indexes.length,j.fieldOverrides.length)'  # 24 120 throughout — no index change in Phase 4
grep -rn "setCustomUserClaims" apps/functions/src libs --include=*.ts | grep -v spec    # 0 (C_E: claims are never persisted, S-RU-10)
grep -rn "accountOf(" libs/features/staff/client-card/src/lib                           # no record id parsed from a key (C_F)
grep -rn "enforceAppCheck" apps libs --include=*.ts | grep -v spec                       # 0 (C_A: the edge enforces, S-RU-17)
grep -rln "consumeAppCheckToken" apps/functions/src --include=*.ts | grep -v spec        # lib/app-check.ts only (C_A)
grep -rn "eyJ" libs/infrastructure/firebase-app/src tools/verify/app-check               # 0 — no token literal (C_A, gitleaks)
node -e 'console.log(require("./config/app-check.json"))'                                # { development: MONITOR, staging: OFF, production: OFF } (C_A)
git diff --quiet 86870b9 -- apps/web/e2e/csp/csp-smoke.spec.ts apps/web/e2e/staff-walk-in.spec.ts && echo unchanged   # (C_A; verify-p0.mjs changes on purpose, S-DEP-18)
git diff -U0 86870b9 -- tools/verify/p0/verify-p0.mjs | grep -c "^+.*X-Firebase-AppCheck"                       # the header at each raw post (C_A)
grep -n '"redirects"' firebase.json                                                                                # none (C_A, check (g))
```

### 6.3 Measured baseline (the orchestrator fills it; measured on `86870b9` in `/home/user/baseline3`)

The "last recorded" column is HANDOFF §4's "After the owner-review sweep"
block (the same tree as `86870b9` modulo the record commit `de32ef6`) — a
hint, never a substitute for the measurement.

| Gate step                                                           | Last recorded (`ac23b1d`)             | Baseline `86870b9`                | After C_B | After C_C | After C_D | After C_E | After C_F | Final (after C_A + reviews)   |
| ------------------------------------------------------------------- | ------------------------------------- | --------------------------------- | --------- | --------- | --------- | --------- | --------- | ----------------------------- |
| `nx sync:check`                                                     | up to date                            | up to date                        | ___       | ___       | ___       | ___       | ___       | ___                           |
| layering (files / import edges)                                     | 987 / 4,453                           | 987 / 4,453                       | ___       | ___       | ___       | ___       | ___       | ___                           |
| typecheck (projects green)                                          | 40 / 40                               | 40 / 40                           | ___       | ___       | ___       | ___       | ___       | ___                           |
| lint (projects, errors, warnings)                                   | 45, 0, 220                            | 45, 0, 215                        | ___       | ___       | ___       | ___       | ___       | ___                           |
| `run-many -t test` (vitest + node; failed)                          | 14,639 + 239; 0                       | 14,538 + 239; 0 ¹                 | ___       | ___       | ___       | ___       | ___       | ___                           |
| ecs-core tests / statements %                                       | 7,136 / 98.57 % (16,034 / 16,266)     | 7,136 / 98.57 % (16,034 / 16,266) | ___       | ___       | ___       | ___       | ___       | ___ (new files ≥ 95 %)        |
| functions tests                                                     | 1,428                                 | 1,428                             | ___       | ___       | ___       | ___       | ___       | ___                           |
| `verify-tools` / `flag-tools` tests                                 | 239 / ___                             | 239 / 28                          | ___       | ___       | ___       | ___       | ___       | ___                           |
| `seed-tools` typecheck / `lint-rules` tests                         | green / 422                           | green / 422                       | ___       | ___       | ___       | ___       | ___       | ___                           |
| `lint:styles`                                                       | green                                 | green                             | ___       | ___       | ___       | ___       | ___       | ___                           |
| `build web` initial (kB, transfer) + `verify:bundle`                | 587.74 kB (159.30 kB) — Phase 3 final | 587.28 kB (159.31 kB), OK         | ___       | ___       | ___       | ___       | ___       | ___ (+ `@firebase/app-check`) |
| functions dist runtime dependencies                                 | 4                                     | 4                                 | 4         | 4         | 4         | 4         | 4         | 4                             |
| functions exports                                                   | 50                                    | 50                                | 50        | 50        | 50        | 51        | 51        | 51                            |
| `firestore.indexes.json` composites / overrides                     | 24 / 120 (57 on `auditLog`)           | 24 / 120                          | 24 / 120  | 24 / 120  | 24 / 120  | 24 / 120  | 24 / 120  | 24 / 120                      |
| runbook §4.2 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 / §4.10 `ok` | 28/22/17/6/24/27/25/20, 0 FAIL        | 28/22/17/6/24/27/25/20, 0 FAIL    | ___       | ___       | ___       | ___       | ___       | ___                           |
| `verify:p0`                                                         | (a)–(g) green                         | (a)–(g) all proved                | ___       | —         | —         | ___       | —         | ___                           |
| `test:emulator` (functions + infra)                                 | 135 + 361                             | 135 + 361                         | —         | ___       | ___       | ___       | —         | ___                           |
| `e2e:web` (passed / failed)                                         | 68 / 0                                | 68 / 0                            | —         | —         | ___       | ___       | ___       | ___                           |
| `verify:csp` (hashes, smoke)                                        | both match; smoke 10 passed           | both match; smoke 10 passed       | —         | —         | —         | —         | —         | ___                           |
| `verify:appcheck` (ENFORCE / MONITOR cases)                         | — (new)                               | —                                 | —         | —         | —         | —         | —         | ___                           |
| ENFORCE `verify:p0` / `e2e:web` / `verify:csp` (probe first)        | — (new)                               | —                                 | —         | —         | —         | —         | —         | ___ / ___ / ___               |

¹ Summed per project from the baseline log (43 vitest projects + `verify-tools`' node runner). HANDOFF §4's 14,639 for `ac23b1d` was summed another way: no spec file differs between `ac23b1d` and `86870b9`. This phase compares against the measured column.

Expected movement: tests only up (every drop explained in §8); ecs-core
statements ≥ the baseline; layering grows by the added files only;
`firestore.indexes.json` untouched; the functions' exports 50 → 51 at C_E;
`build web` grows by `@firebase/app-check` at C_A (an estimate of a few kB
transfer — measured, recorded, inside the 975 kB warning budget); the grep
gates keep their reference counts.

---

## 7. Owner items touched (flags — copied into the PR)

1. **New copy, for review** (OR-51 / OR-55; bg and en in the same commit;
   no existing string changes):
   `errors.APP_CHECK_REQUIRED` «Не успяхме да потвърдим това устройство.
   Презареди страницата.» / "We couldn't verify this device. Reload the
   page."; `clientCard.roles.groupLabel` «Роли» / "Roles";
   `clientCard.roles.role.client` «Клиент» / "Client", `.barber` «Бръснар» /
   "Barber", `.receptionist` «Рецепция» / "Front desk",
   `.content_manager` «Съдържание» / "Content", `.admin` «Администратор» /
   "Admin"; `clientCard.roles.save` «Запази ролите» / "Save roles";
   `clientCard.roles.saved` «Ролите са запазени. Важат от следващото
   влизане.» / "Roles saved. They apply from the next sign-in.";
   `errors.GOVERNANCE_ROLES_FORBIDDEN` = OR-50's ONE forbidden line («Нямаш
   права за това. Влез отново или питай администратора.» / "You don't have
   access to this. Sign in again or ask an admin.", the
   `PRIVACY_FORBIDDEN` precedent); `errors.GOVERNANCE_ROLES_TARGET_NOT_FOUND`
   «Не намерихме този профил.» / "We couldn't find this account.";
   `errors.GOVERNANCE_ROLES_TARGET_NOT_REGISTERED` «Този човек още не е
   завършил регистрацията си.» / "This person hasn't finished signing up
   yet."; `errors.GOVERNANCE_ROLES_TARGET_ERASED` «Личните данни на този
   клиент са изтрити.» / "This client's personal data was erased.";
   `errors.GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED` «Ролите са запазени, но
   старите сесии не бяха прекратени. Опитай пак.» / "The roles are saved,
   but the old sessions weren't ended. Try again.". No words (unreachable
   from any web surface, OR-55): `APP_CHECK_REPLAYED`, the three impersonation
   target codes, `GOVERNANCE_ROLES_SELF`, `…_TARGET_SYSADMIN`,
   `…_INVALID`; `GOVERNANCE_ROLES_UNAUTHENTICATED` falls back to the
   existing sign-in words as the privacy family does.
2. **The latitude register** S-L-1 … S-L-28 (§0.3), each reversible: the
   switch's states and shipped values (one line each in
   `config/app-check.json`), the limited-use set (one table row each), the
   CSP hosts, the card as the roles surface, the record-only card's scope.
3. **reCAPTCHA Enterprise and App Check registration** (console): create
   the score-based website key for the hosting domains; register the web app
   under App Check → reCAPTCHA Enterprise; enable billing and confirm the
   assessment quota (auto-refresh ≈ one assessment per active tab per hour;
   one per call of the five limited-use callables); paste the PUBLIC site key
   into `environment.production.ts` `appCheck.siteKey` (gitleaks has no rule
   for site keys; if it flags one, the owner allowlists it — never a hook
   bypass). Enable the Firebase App Check API and give the functions runtime
   service account the token-verifier role (`roles/firebaseappcheck.tokenVerifier`
   or equivalent — confirm in the console): without it the five consuming
   callables read `INVALID` on every call (S-RU-21). **Staging first**: a
   staging key as a temporary, never-committed edit of
   `environment.production.ts` (no staging build configuration exists), a
   real browser with the console open — no ENFORCED CSP violation, none from
   `connect-src` either (else add the host, S-L-6), the Trusted Types
   report-only samples of BOTH directives recorded and compared with
   `RECAPTCHA_REPORT_ONLY_SINKS` / `_POLICIES` (S-L-22), `www.google.com`
   blocked in DevTools with the app still working (calls go out headerless,
   S-RU-31), one real `exportClientData` reading `VALID` at MONITOR — BEFORE
   the production key. The production key's web deploy is the client-side
   point of no return; its rollback is `siteKey: ''` + a web deploy.
4. **The MONITOR → ENFORCE rollout and its metrics** (§2.A.6): web first
   (wait for the service worker); `production: "MONITOR"` + a functions
   deploy; read the console's verified-request share for Cloud Functions and
   `jsonPayload.appCheckOutcome` on the outcome lines for at least 7 days of
   real traffic; proposed bar, PER CALLABLE (the filter grouped by
   `jsonPayload.callable` — an aggregate would hide the five low-volume
   admin callables): `MISSING` + `INVALID` + `REPLAYED` under 1 % of each
   callable's calls, each explained, and each of the five LIMITED_USE
   callables showing real `VALID` calls and no unexplained `INVALID`; then
   `"ENFORCE"` (P10 refuses it unless the live web carries the key). Rollback: `"OFF"` + a
   functions deploy. A stale shell under ENFORCE reads `APP_CHECK_REQUIRED`
   ("reload"), never "sign in".
5. **Firestore and Storage enforcement** — console switches, after the
   callables, each after its own MONITOR metrics (up to ~15 minutes to
   apply); never code.
6. **Debug tokens** — not wired in code (S-RU-18). Hosted non-production
   builds use their own reCAPTCHA Enterprise key (staging, §2.A.6 step 2);
   debug tokens are for a developer's own device only, never placed in an
   environment file, a CI variable or the repo, and are revoked in the
   console after use.
7. **Privacy and legal**: reCAPTCHA loads Google's script and an invisible
   frame on EVERY page once a key is set (the public landing included),
   before any consent — the badge or a "protected by reCAPTCHA" disclosure
   (Google's terms), the privacy-policy line and a GDPR view on loading it
   pre-consent are the owner's — a checkbox in `production-deploy.md` §1
   "Monitoring and privacy" (PA5).
8. **`reportClientIssues` inside ENFORCE** (S-L-23): telemetry from
   clients whose App Check fails (blockers) is lost under ENFORCE; excluding
   the sink is one `CALLABLE_APP_CHECK_TOKEN`-adjacent decision the owner
   may take (the code would need an "exempt" value — a follow-up).
9. **Step-up (R47)** — not built (S-RU-22): adding a T2 row (`auth_time`
   within N minutes for the erasure's first call and `setRoles`) is a Law 7.3
   amendment proposal for the owner; it is buildable once the OTP provider
   lands (P8), with the §2.A.9 contract. Phase 3 flag 6 stays open with this
   reason.
10. **Storage rules deploy**: the first `firebase deploy --only storage`
    with `firestore.get` asks to grant `roles/firebaserules.firestoreServiceAgent`
    — deploy interactively once or grant it beforehand; one billed
    Firestore read per avatar upload; an account with no `users` document
    cannot upload (fail-closed). A checkbox in `production-deploy.md` §1
    (PA5) and the §3.2 step (PC2).
11. **`setRoles`'s windows**: after a SUCCESSFUL revoke an already-issued
    ID token keeps its roles ≤ 1 h (rules read claims); after a FAILED one
    the old roles live as long as the target's session (claims ride every
    refresh) — the card keeps the retry and the `roles_sessions_not_revoked`
    alert fires (attach a channel); the revoke signs the target out at their
    next refresh and their next OTP sign-in mints the new roles; an
    unchanged `setRoles` is a forced sign-out of that account, logged
    `roles.sessions_revoked` (S-L-26); a console-blocked admin cannot
    reassign roles (S-RU-11); the promoted or
    demoted person must sign in again. The sysadmin is never managed here;
    the FIRST admin stays a console / seed bootstrap (`production-deploy.md`
    §2). The trigger dedupe widens `profileEditedAtUtcMs`' meaning to "a
    callable-audited profile write" (S-L-17 — the alternative is two rows).
12. **The roles surface**: the «Роли» block lives on the staff client card
    (reached through the visit editor's search); a dedicated admin page and
    menu entry are the owner's call.
13. **The walk-in record's card** shows the head and the privacy block only
    (S-L-19); its stats / history / photos (already CustomerId-keyed) and a
    standalone staff client page are follow-ups.
14. **Costs**: `exists()` — one read per note write and per photo create;
    the reCAPTCHA assessments; the consume round-trips on five admin
    callables.
15. **`.claude/rules` edits**: none expected — no rules text becomes false
    (verified: none mentions App Check; `firestore-layout.md`'s "rules test
    top-level keys only" holds; `ecs-pipelines.md`'s console telemetry text
    holds). Any edit a package finds necessary is listed in the PR.
16. **Law amendment proposals** (never an edit of `CLAUDE.md` / `AGENTS.md`):
    item 9's T2 row, only if the owner wants step-up. None else.
17. **Deploy steps** (`production-deploy.md`, runbook §3): Firestore +
    Storage rules first (S-DEP-4 / S-DEP-5 — the current web already
    complies), then functions (51 exports; `setRoles`; the env files carry
    `APP_CHECK_MODE`), then hosting (the CSP with the reCAPTCHA hosts, the
    App Check web init). Every later App Check flip is a functions-only
    deploy; P10 judges both predeploys.
18. **The Deferred list and superseded rulings**: #4 (App Check) built by
    Phase 4 — the orchestrator records it in HANDOFF §6 with S-RU-23 (OR-29's
    `frame-src 'none'` superseded for that directive) and S-RU-22 (step-up
    decided, not built); the owner is asked to annotate OR-29 and Deferred #4
    in the rulings file so neither contradicts the shipped tree.
    #3 (enforcing Trusted Types) gains a second blocker: the reCAPTCHA SDK's
    script injection (`csp-baseline.md`).
19. **CI**: the `emulators` job gains `verify:appcheck` (a functions
    build, two env writes, two emulator starts) — measured at C_A against the
    job's `timeout-minutes: 30`, raised to 45 if needed (S-L-28); mark it
    required with the other jobs after green runs (Phase 3 flag 15).
20. **Error Reporting after S-DEP-1**: a server error's report keeps its
    name, scrubbed message and frames; its `cause` and SDK details no longer
    appear — debugging reads the outcome line's `operationId` and
    `errorCode` instead. Residual (S-L-25): the scrub masks e-mails, token
    runs and digits, not names or free text inside an SDK message (the
    OR-34 / RU-38 precedent; a PB spec pins it). The stricter option — the
    message replaced by the error's canonical code (`<name>: <code>` + the
    frames; Error Reporting still groups by name and frames) — is one line,
    the owner's call.

---

## 8. Ledger (the orchestrator fills it)

| Workstream                                | Packages                | Status | Commit sha | Gate result |
| ----------------------------------------- | ----------------------- | ------ | ---------- | ----------- |
| S-WS-B — error reports scrubbed           | PB                      | TODO   | —          | —           |
| S-WS-C — an erased person can do nothing  | PC1, PC2                | TODO   | —          | —           |
| S-WS-D — rules the audit found missing    | PD                      | TODO   | —          | —           |
| S-WS-E — an audited role change           | PE1, PE2, PE3           | TODO   | —          | —           |
| S-WS-F — a staff route to walk-in records | PF                      | TODO   | —          | —           |
| S-WS-A — App Check                        | PA1, PA2, PA4, PA3, PA5 | TODO   | —          | —           |
| Review round 1                            | fixer                   | TODO   | —          | —           |
| Review round 2 + FULL gate                | fixer                   | TODO   | —          | —           |
