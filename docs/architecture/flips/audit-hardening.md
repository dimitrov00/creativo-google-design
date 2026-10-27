# Audit hardening — Phases 0–2

**Date:** 2026-10-26 · **Status:** PLAN — written on branch `audit-hardening`
at branch point `0df7d7abc6703af5cd88e83b55b7d0ea995283d2` (= `origin/main`;
`git log 1322b782..0df7d7ab` = `9512f6d`, `206ef63`, `2f75cb2`, `0df7d7a`).
WS-0 was built by the orchestrator as package P0 and is committed
(`1f027ee`); every other line number is a hint on
`0df7d7ab` (`git show HEAD:<path>` for the files P0 edits — `main.ts`,
`main.spec.ts`, `edge.ts`, `identity.wire.ts` shift by a few lines in the
tree) and every package re-reads its sites before it edits. ·
**Owner's word:** the mission brief "Audit-hardening pass (Phases 0–2)"
(verbatim user brief + the orchestrator's environment notes): _"Close the
audit gaps in §4, so that for any write the system can prove who did it,
when, from which operation, and with what before/after values, and a user's
report can be traced to the failing line (auditability ≈4/10 → ≈7/10)."_
Its §4 findings are settled; this plan verifies each against the branch
point (§0.1) and fixes it. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md` (`ecs-layering`,
`ecs-primitives`, `ecs-components`, `ecs-systems`, `ecs-ports`,
`ecs-pipelines`, `firestore-layout`, `presenters`, `angular-ui`). This plan
never overrides them; where the brief's design breaks one, §0.2 records the
lawful form with both quotes. ·
**Sources:** the brief (§1 hierarchy and hard limits, §4 workstreams, §5 out
of scope, §6 behaviour policy, §7 lessons, §9 gate, §11 stop conditions);
`docs/architecture/decisions/2026-10-26-owner-rulings.md` (OR-9, OR-12,
OR-24, OR-25, OR-26, OR-33, OR-34, OR-35, OR-51, OR-55, OR-58, the Deferred
list); `docs/architecture/HANDOFF.md` §4 (gate, reference numbers), §5, §6
(the OR-24 read-as contract); `docs/architecture/firestore-runbook.md` (§1.1
matrix, §3 recipes, §4.0–§4.10 grep gates); `docs/production-deploy.md` §1;
`docs/design-research/client-details-design.md` (R36 / T5, row 12, F1/F2);
the six read-only inventories of this pass (orchestrator scratchpad
`inv/ws0-otp.md`, `ws1-ws41-audit-commit.md`, `ws2-ws44-deltas.md`,
`ws3-governed.md`, `ws4-correlation.md`, `ws5-ws6-ws7-ops.md`; not
committed — every claim used here was re-verified against the code).

**What this is.** One pass, one branch, one PR, landing the ten workstreams
of the brief in the order WS-0 → WS-4.1 → WS-1 + WS-4.4 (+ WS-7) → WS-2 →
WS-3 → WS-4.2–4.6 → WS-5 → WS-6, each at a green boundary.

**Behaviour is frozen** except each workstream's declared DEPARTURE (§5,
`DEP-n`, with before/after, evidence and every spec / e2e / P0 / emulator
file changed on purpose). Valid stored documents and callables answer
exactly as before apart from those DEPs.

**This pass ends** when the packages of §3 are integrated, every existing
spec passes unchanged except the edits §4/§5 name, the FULL gate of §6.1 is
green against the measured baseline of §6.3, and HANDOFF, the runbook,
`production-deploy.md` and the §8 ledger record the pass.

---

## 0. Reconciliation, rulings and the latitude register (read first)

### 0.1 Reconciliation (Step 0 — every sub-item against `0df7d7ab`)

STILL OPEN = nothing of it exists; PARTLY DONE = what remains is named; DONE
/ SUPERSEDED = nothing to build. No OR ruling built or decided any item
differently (grep of `decisions/*.md` and HANDOFF §6 for audit, operation
id, dead letter, PITR, `AuditReadPorts`: only OR-24 (read-as stays out),
OR-25/OR-58 (customers/coupons closed), OR-34 (the sink exists) and OR-35
(the preflight) touch these items, each as noted).

| #     | Item                                                                  | Status                                         | Evidence (file:line at `0df7d7ab` unless marked WT)                                                                                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1   | console OTP sender wired in every environment                         | STILL OPEN → P0 building                       | `apps/functions/src/main.ts:288` `...consoleOtpSender(telemetry.log),` ungated; crypto gated at `:291`                                                                                                                                                                                                                                                                              |
| 0.2   | `refusingOtpSender` adapter                                           | STILL OPEN → P0 building                       | absent at HEAD; WT `apps/functions/src/adapters/refusing-otp-sender.adapter.ts` (untracked draft)                                                                                                                                                                                                                                                                                   |
| 0.3   | `IDENTITY_OTP_SEND_UNAVAILABLE` + `SendOtp` widened                   | STILL OPEN → P0 building                       | `libs/ecs-core/src/errors/identity.error.ts` (no such code); `ports/identity.port.ts:62-65` `Result<void, PipelineError>`                                                                                                                                                                                                                                                           |
| 0.4   | `requestOtpRefusal` order + `EDGE_WIRE` row                           | STILL OPEN → P0 building                       | `wire/identity.wire.ts:122-135` collapses every `PipelineError` to `IDENTITY_OTP_SEND_FAILURE`; `edge.ts:437`                                                                                                                                                                                                                                                                       |
| 0.5   | bg/en words                                                           | STILL OPEN → P0 building                       | `i18n/en.json`, `bg.json` (`errors.IDENTITY_OTP_SEND_FAILURE` ends in «Опитай пак» — a retry that cannot succeed)                                                                                                                                                                                                                                                                   |
| 0.6   | save + OR-9 cooldown before `sendOtp`                                 | DECIDED: kept (RU-3)                           | `pipelines/request-otp.pipeline.ts:117` (`mayIssue`), `:146` `saveOtp`, `:149` `sendOtp`; pinned `request-otp.pipeline.spec.ts:405`                                                                                                                                                                                                                                                 |
| 0.7   | P7 real-tree pin flips; a new FAIL row                                | STILL OPEN → P0 building (row P8)              | `tools/verify/preflight/preflight.spec.mjs:1100-1141` "P7 refuses today's functions…"; WT `preflight.mjs` `CHECKS.P8`, `SCOPES.functions` `[P1,P2,P3,P6,P7,P8]`                                                                                                                                                                                                                     |
| 0.8   | `production-deploy.md` §1 reworded                                    | STILL OPEN → P0 building                       | `docs/production-deploy.md` §1 "Sign-in: the OTP sender" (checkbox stays open)                                                                                                                                                                                                                                                                                                      |
| 0.9   | acceptance grep "shows only the emulator-gated adapter"               | CANNOT HOLD LITERALLY (RU-2)                   | at HEAD 5 hits: `console-otp-sender.adapter.ts:14,:49` (wanted) + `wire/identity.wire.ts:158,:164`, `adapters/firestore-ports.ts:58` (non-logging)                                                                                                                                                                                                                                  |
| 4.1-a | ids on book / reschedule / edit / publish                             | PARTLY DONE                                    | `wire/booking.wire.ts:291-297` (book `attemptId` optional; malformed → `null`), `:378-385` (reschedule optional), `:1029-1034` (edit optional); `wire/loyalty.wire.ts:243-247` (publish `requestId` REQUIRED). Remains: required on book / reschedule / edit                                                                                                                        |
| 4.1-b | ids on cancel / transition / arrival / clear-arrival / tip            | STILL OPEN                                     | `decodeCancelAppointment` `booking.wire.ts:322`, `decodeTransitionAppointment` `:417`, `decodeMarkArrived` `:572`, `decodeClearArrival` `:578`, `decodeRecordSeatTip` `:628` carry none                                                                                                                                                                                             |
| 4.1-c | web minting                                                           | PARTLY DONE                                    | minted: `booking-flow.store.ts:522`/`:1293` (attempt), `staff-day.store.ts:1980` (commit), `:2139` `operationIdFor` (edit), `admin-rhythm.store.ts` (publish). None for cancel (`appointments.store.ts:86`), transition (`staff-day.store.ts:2379`), arrival (`:2005`, `:2035`), tip (`:2333`), nor any other callable                                                              |
| 1.1   | post-commit, swallowed audit writer                                   | STILL OPEN                                     | `pipelines/booking-read-set.pipeline.ts:382` `AuditWritePorts`, `:396` `appendAuditFacts` (`nextId()` branch when `idBasis === null`); callers book `:302`, cancel `:158`, edit `:337`, mark-arrival `:72`, tip `:96`, reschedule `:264`, transition `:377`                                                                                                                         |
| 1.2   | rows inside the commit plan                                           | STILL OPEN (pattern DONE)                      | target pattern `pipelines/update-profile.pipeline.ts:69-90` (`WriteOp.create([Collections.AuditLog, id], audit.row)`), `publish-streak-definition.pipeline.ts:448` `auditCreates`                                                                                                                                                                                                   |
| 1.3   | replay detection per verb                                             | PARTLY DONE; brief imprecise (RU-4)            | book `Replay` snapshot `book-appointment.pipeline.ts:393-399`; reschedule/edit ledger (`AppointmentEditSystem.ledgerVerdict`); arrival/clear "unchanged" `systems/appointment-lifecycle.system.ts:744-747`/`:769-772`; tip `record-seat-tip.pipeline.ts:71-73`; **cancel and transition have no unchanged branch — a replay is a graph refusal** (`BookingLifecycle.canTransition`) |
| 1.4   | instant-keyed change keys, `nextId` fallback                          | STILL OPEN                                     | `systems/audit.system.ts:169` `'audit-row/v1'`, `:353-411` `changeKey` (`cancelled(<ms>)`, `transition(seat,<ms>)`, `arrived(<ms>)`, `tip(seat,<ms>)`, `revision(n)`)                                                                                                                                                                                                               |
| 1.5   | run-backfill's row                                                    | L2 → KEEP on `appendAudit`                     | `pipelines/run-backfill.pipeline.ts:625-668` (`auditCall` in `finally`, `:712`)                                                                                                                                                                                                                                                                                                     |
| 1.6   | tx adapter refuses a colliding Create as a value                      | DONE                                           | `apps/functions/src/adapters/firestore-tx.adapter.ts:95` `ALREADY_EXISTS`, `:378` `RepositoryError.alreadyExists(…)` — whole plan unapplied                                                                                                                                                                                                                                         |
| 1.7   | write volume measured                                                 | DONE here (§0.4)                               | far below every limit                                                                                                                                                                                                                                                                                                                                                               |
| 1.8   | `.claude/rules/ecs-pipelines.md` text                                 | STILL OPEN (and already stale)                 | L55-59 `BookAppointmentPorts` example (omits `WalkInKeyPorts`, names `AuditAppendPorts`); L98-102 "files its audit rows after the commit (`appendAuditFacts`)"                                                                                                                                                                                                                      |
| 1.9   | missing verified actor                                                | PARTLY DONE                                    | `booking-read-set.pipeline.ts:402-408` logs `'audit row has no verified actor'` and returns; no `LogEvent` (`ports/telemetry.port.ts:7-9`). `callerActorAsClaimed` (`apps/functions/src/lib/booking/caller-roles.ts:106-109`) is `null` only with no uid, which every decoder refuses first → unreachable over the wire                                                             |
| 2.1   | before/after values on rows                                           | STILL OPEN                                     | `components/audit-context.data.ts:204-279` (verbs, revisions, codes, seat id only; `Tip` "the act, never the amount")                                                                                                                                                                                                                                                               |
| 2.2   | both sides in the read set                                            | feasible, zero extra reads                     | reschedule `decideMove` has `stored`/`after`; edit builds `after` in `decideEdit`; tip `BillingSystem.recordTip` before/after seats; lifecycle `step(before, after, facts)` `appointment-lifecycle.system.ts:271`                                                                                                                                                                   |
| 2.3   | names under the runbook gates                                         | DONE (checked)                                 | every new identifier of §2 run through the §4.0 `-wF`/`-F` arrays from a scratch copy (canary `tipMinorUnits`, `currencyCode`, `hours:` caught): 0 hits                                                                                                                                                                                                                             |
| 3.1   | impersonation start/end trace                                         | STILL OPEN                                     | `pipelines/start-impersonation.pipeline.ts:106` one `WriteOp.create(session)`; `end-impersonation.pipeline.ts:82` one `WriteOp.set(session)`; no `AuditLog`; session TTL'd                                                                                                                                                                                                          |
| 3.1a  | end reasons                                                           | CORRECTION (RU-14)                             | stored reasons `components/end-reason-fields.data.ts:7-14` = `ADMIN_ENDED`, `EXPIRED`, `REVOKED_BY_SECURITY`; `ALREADY_ENDED` is the refusal `GOVERNANCE_IMPERSONATION_SESSION_ALREADY_ENDED`                                                                                                                                                                                       |
| 3.2   | roles / accountStatus unaudited, false premise                        | STILL OPEN; premise false for both             | comment `systems/audit.system.ts:149-156`; `AUDITED_PROFILE_FIELDS` `:157-163`; `roles` written by `completeRegistration`'s `Set` with no row; no `accountStatus` writer exists                                                                                                                                                                                                     |
| 3.2a  | Auth custom claims                                                    | STILL OPEN as stated (record only)             | `adapters/auth-claims.adapter.ts:62` `createCustomToken` only; `setCustomUserClaims` in no code; claims re-derived from `users.roles` at sign-in                                                                                                                                                                                                                                    |
| 3.3   | governed-collection trigger                                           | STILL OPEN                                     | only `auditProfileChanges` (`main.ts:490-514`); 34 exports pinned (`main.spec.ts:805`, `:825`)                                                                                                                                                                                                                                                                                      |
| 3.3a  | `customers`, `coupons` client writes                                  | DONE — SUPERSEDED BY OR-25 / OR-58             | `firestore.rules:375-380` (create/update/delete `false`), `:639-642` (`write: if false`)                                                                                                                                                                                                                                                                                            |
| 3.4   | notes/photos author + stamp unchecked                                 | STILL OPEN                                     | `firestore.rules:342-344`, `:353-355` `allow read, write: if worksTheBook()`; no `request.time` anywhere in the rules                                                                                                                                                                                                                                                               |
| 3.4a  | `scheduleExceptions` field change                                     | CONFIRMED none (item 3 audits it)              | `firestore.rules:537-546` `allow write: if mayEditRoster()`; entity has no author/stamp field                                                                                                                                                                                                                                                                                       |
| 3.4b  | live web writers send `auth.uid` + a fresh stamp                      | PARTLY DONE (L6)                               | notes: `append-team-note.pipeline.ts:77` / `:117` stamp at the write; photos: `attach-visit-photo.pipeline.ts:86` stamps BEFORE `uploadPhotoBytes` `:137`; authors from `staff-day.store.ts` `currentUserId()` (`UserId \| null`)                                                                                                                                                   |
| 4.2-a | one outcome line per callable                                         | STILL OPEN                                     | `edge.ts:959-985` `callableEdge` logs nothing on ok or refusal; only `trackError` on a throw (`:924-935`)                                                                                                                                                                                                                                                                           |
| 4.2-b | `inputDigest` / `LOG_DIGEST_KEY`                                      | STILL OPEN                                     | 0 hits; idiom `WALKIN_ID_KEY` `main.ts:334-347`, `adapters/crypto.adapter.ts` `hmacSha256Hex`, `tools/flags/write-functions-env.mjs` `EMULATOR_SECRETS`                                                                                                                                                                                                                             |
| 4.2-c | decision inputs on booking/move refusals                              | STILL OPEN                                     | only `book-appointment.pipeline.ts:285` logs `'booking.rejected'` `{ errorCode }`; OR-12: no data in error structs                                                                                                                                                                                                                                                                  |
| 4.2-d | `updateTime` in the read adapter                                      | STILL OPEN                                     | `firestore-tx.adapter.ts` read wrapper drops `snap.updateTime`                                                                                                                                                                                                                                                                                                                      |
| 4.2-e | per-invocation context on every line                                  | PARTLY DONE (platform trace id only)           | `firebase-functions` v2 handlers already run in its trace-context ALS; our ids are absent; `console-telemetry.adapter.ts:63-78` has no ALS                                                                                                                                                                                                                                          |
| 4.3   | `WriteProvenance`                                                     | STILL OPEN; L5 → appointments + customers only | 0 hits; idiom `components/stood-seat-pairs.data.ts`; guards `systems/stored-document.system.ts:145-200`                                                                                                                                                                                                                                                                             |
| 4.4   | `auditOperationId` on rows                                            | STILL OPEN                                     | `entities/audit-entry.entity.ts:17-21` `AuditEntryMeta = { id, recordedAtUtcMs, resourceId }`                                                                                                                                                                                                                                                                                       |
| 4.5   | reference line in the UI                                              | STILL OPEN; premise false (RU-28)              | `ui-alert` renders no callable error (`admin-rhythm.html:943`, `staff-dashboard.html:299`, `:1572` are confirmations/notices); the shared callable-error wording path is `wordPipelineError` (callers `staff-dashboard.ts:6591`, `booking-error-message.ts:41`, `client-appointments.ts:1060`)                                                                                      |
| 4.6   | `LogEvent` + literal-message lint + `Error` normalisation             | STILL OPEN                                     | 0 `LogEvent`; 39 `log(` sites (32 in `libs/ecs-core/src/pipelines`, 7 in `apps/functions/src`); console adapter passes an `Error` through as `{}`                                                                                                                                                                                                                                   |
| 5.0   | OR-34 sink                                                            | DONE — do not rebuild                          | `reportClientIssues` (`main.ts:941`), `ReportingErrorHandler`, `ClientIssueSystem`, `client-issue-reporter.adapter.ts`, runbook §3 step 7 `client_issue_count`; `grep -rn reportClientError apps libs` empty                                                                                                                                                                        |
| 5.1   | non-Functions throw reported                                          | STILL OPEN                                     | `libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts:28-38` answers `PIPELINE_UNKNOWN`, reports nothing                                                                                                                                                                                                                                                             |
| 5.2   | `operationId` / `callableName` / `callableErrorCode` on `ClientIssue` | STILL OPEN                                     | `components/client-issue.data.ts:52-62` (9 fields), `:65` `FIELDS`; `admitBatch` demands exactly the struct's keys                                                                                                                                                                                                                                                                  |
| 6.1   | `tools/ops/` scripts                                                  | STILL OPEN                                     | no `tools/ops`; recipes today: runbook §3 step 7, `production-deploy.md` "Backups", "Cloud Audit Logs", "Monitoring and privacy" (owner decide items)                                                                                                                                                                                                                               |
| 6.2   | metrics / alerts as code                                              | PARTLY DONE                                    | only `client_issue_count` (runbook §3 step 7 YAML)                                                                                                                                                                                                                                                                                                                                  |
| 6.3   | `triggerFailures` dead letter                                         | STILL OPEN                                     | `retryingTrigger` `edge.ts:1025-1058` logs only; `EdgePorts = TelemetryPorts & ClockPorts` `:913`                                                                                                                                                                                                                                                                                   |
| 6.4   | retention policy                                                      | PARTLY DONE                                    | `auditLog` already has no TTL (7 `ttl: true` overrides, none for `auditLog`/`clientJournal`); no written policy                                                                                                                                                                                                                                                                     |
| 6.5   | read-only preflight row                                               | STILL OPEN → P9 (P8 taken by WS-0)             | `preflight.mjs` `Verdict = { Pass, Fail, Skip }` (no INFO); P2/P3 render INFO lines inside a PASS row                                                                                                                                                                                                                                                                               |
| 7.1   | five `auditLog` composites                                            | STILL OPEN                                     | `firestore.indexes.json`: 19 composites, none on `auditLog`; overrides `auditLog.profileFields`, `.streakChanged`                                                                                                                                                                                                                                                                   |
| 7.2   | P3 count pin                                                          | DONE (no code pin)                             | `preflight.spec.mjs` P3 cases use a synthetic `DECLARED`; only prose: `production-deploy.md` "all 19 composites"                                                                                                                                                                                                                                                                    |
| 7.3   | `auditActionsFor` `resourceId in` reads                               | DONE — must stay green                         | `adapters/firestore-audit.adapter.ts:112-135` (single-field `in`, chunks of 30, no `orderBy`)                                                                                                                                                                                                                                                                                       |
| 7.4   | `AuditReadPorts`                                                      | STILL OPEN                                     | `ports/governance.port.ts:84` `AuditPorts` is write/backfill only; no web reader of `auditLog`                                                                                                                                                                                                                                                                                      |
| 7.5   | admin-only rules                                                      | DONE                                           | `firestore.rules:695-703` `allow read: if isAdmin(); allow create, update, delete: if false`                                                                                                                                                                                                                                                                                        |

### 0.2 Rulings (every law / brief conflict, every rename — higher source applied)

Hierarchy (brief §1): hard limits › Laws + rules › OR rulings / HANDOFF §6 ›
the brief's process › the brief's designs › latitude. Each row quotes both
sides; the applied side is the higher one.

- **RU-1 (WS-0) "not tagged" means not `@emulatorOnly`.** Brief: _"`refusingOtpSender` (…not tagged)"_. OR-35 (P7): _"fails the functions predeploy on any use outside `onEmulator() ? … : …`"_ — an `@emulatorOnly` tag on an adapter used in the deployed branch would fail P7. The refusing sender carries the distinct JSDoc tag `@launchBlocker`, which only the new P8 reads (tag-anchored like P7, never name-matched: OR-35 records that two adversarial rounds beat a name-based draft). The console adapter keeps `@emulatorOnly`.
- **RU-2 (WS-0) the acceptance grep is restated.** Brief: _"`grep -rnE "would send|otp.*(code|destination)" … | grep -v spec` shows only the emulator-gated adapter"_. The regex also hits three non-logging lines (`wire/identity.wire.ts:158`, `:164` decode the typed code into the command; `adapters/firestore-ports.ts:58` is a comment). Acceptance: the hits are `console-otp-sender.adapter.ts` plus exactly those three named lines; the refusing adapter adds none.
- **RU-3 (WS-0) the pipeline order stays frozen.** Brief: _"State in the DEP whether the pipeline keeps saving the OTP doc and consuming the cooldown before `sendOtp` (frozen unless you justify a change)"_. Kept: reordering needs a new port or breaks "a saved challenge verifies even if the delivery answer is lost" (OR-9 flow). Consequence stated in DEP-1: a refused request leaves one unusable, TTL-purged `otps` doc, and a repeat for the same destination inside 60 s answers `IDENTITY_OTP_RATE_LIMITED`.
- **RU-4 (WS-1) cancel and transition have no "unchanged".** Brief: _"the state machine's 'unchanged' on arrival, tip and transition"_. Code: a transition or cancel replayed after it landed is refused by the graph (`BookingLifecycle.canTransition`; `CancellationPolicySystem.mayCancel` → `notCancellable`). Acceptance for those two verbs: the second call answers the refusal a lost-response retry gets today and commits nothing, so its plan holds zero audit ops. Book / reschedule / edit answer `replayed: true` with the first call's ids; arrival / clear / tip answer `unchanged: true`.
- **RU-5 (WS-1) `changeKey.staffEdit(operationId, revision)` → `staffEdit(operationId)`.** With the id required (WS-4.1) the revision branch is dead and an unused parameter fails `@typescript-eslint/no-unused-vars`; the key text `operation:<id>` is today's.
- **RU-6 (WS-1) key spellings.** Brief: _"`<verb>:<operationId>[:<seatId>]`"_. Applied: `cancel:<op>`, `transition:<op>` (party) / `transition:<op>:<seatId>`, `arrived:<op>`, `unarrived:<op>` (the arrival pair keeps today's verb words), `tip:<op>:<seatId>`; book `attempt:<attemptId>`, reschedule `move:<attemptId>`, edit `operation:<operationId>`. Five shapes change, so `ROW_BASIS_TAG` becomes `'audit-row/v2'` (brief: _"Bump the `audit-row/v1` basis tag if a key's shape changes"_).
- **RU-7 (WS-1) precision, not conflict.** Brief: _"`ports.hash` is the only port the decide step uses"_ — the book / reschedule / edit decides also use `nextId` for seat and decision ids; the AUDIT planning inside them uses `hash` only. Brief: _"never read audit ids in it"_ — binds the booking verbs; `publish-streak-definition.pipeline.ts:399-406` (`readWithdraw`) keeps reading its own row id as its replay probe (runbook §1.1), out of scope.
- **RU-8 (WS-1 / WS-4.6) `LogEvent` is created in WS-1.** Brief WS-1: _"Log `LogEvent.AuditActorMissing` at error"_; brief WS-4.6 builds the dictionary. Applied: P4 (WS-1) creates `primitives/log-event.data.ts` holding every existing message text plus nothing new; WS-1 uses `AuditActorMissing`; WS-4.6 adds its new values, converts every other call site and adds the lint.
- **RU-9 (WS-4.6) `LogEvent` values.** Brief: _"`as const`, dotted, domain-prefixed"_ and _"with each existing message's text kept as its value"_ — the existing texts are not all dotted (`'trigger attempt failed'`, `'malformed document refused'`). Applied: existing values byte for byte (the WS-6 metric filters and `reporting-error-handler.ts`'s `endsWith('dropped')` classifier read them); new values dotted and domain-prefixed (`callable.completed`). Law 1's SCREAMING rule is for discriminator dictionaries; `LogEvent` is an operator vocabulary like `HttpsStatus` (`errors/pipeline.error.ts:36`, lowercase). Home: primitives (a tier the ports may import, Law 8).
- **RU-10 (WS-1) `AuditContext.Rescheduled.loggedOnRetry` is deleted.** Its only writer was the replay row (`reschedule-appointment.pipeline.ts:246-262`); replays plan no row (brief WS-1), so the flag is unreachable (DEP-7).
- **RU-11 (WS-2) delta names kept; additions declared.** The brief's 19 names are lawful and kept verbatim (`editDiscountIds` is documented as the AFTER set). Planner additions — each nullable, each closing a gap the brief's Problem names, each strike-able on its own: `rescheduleFromLocationId`/`ToLocationId` (a move may change shop; wall-clock coordinates mean nothing without it, Law 7.2), `editMoveFromLocalDate`/`ToLocalDate`, `editMoveFromStartMinutes`/`ToStartMinutes`, `editRestaffFromBarberIds`/`ToBarberIds` (_"no old/new slot"_: BOOKING_STAFF_MOVE/RESIZE/RESTAFF would otherwise carry no delta), `editDiscountFromIds` (the AFTER set alone cannot prove a removal), `tipFromCents` (a cleared tip loses the amount), `transitionFromAttendanceState` (a seat act's prior state), `cancellationFromBookingStatus`/`cancellationFromStatusAtUtcMs` (a client cancel deletes the prior stamp too). These 13 are a **departure from the decided list**, recorded against the brief's own limit — _"Latitude register. Only these points are left to you … everything else is decided, subject to §1's hierarchy"_ — and justified only by the brief's Problem (_"no old/new slot on a reschedule, no price or discount delta, no tip amount, no prior status"_) and objective (_"with what before/after values"_). They are declared as their own DEP (DEP-10a), live in the same per-verb component files beside the brief's 19 (striking one touches its file, its override and its spec case only), and are owner flag §7.15.
- **RU-12 (WS-2) delta slices are components, one name per file**, intersected into the variants (`Rescheduled = { … } & RescheduleDelta`): Law 1 (one name per `*.data.ts`), Law 6.3 (compose by `&`), ecs-components "a slice without variants".
- **RU-13 (WS-3) impersonation actor.** Brief: _"Actor `Actor.admin(callerUid)`"_. `admitImpersonationCaller` admits `Roles.isAdmin` (admin OR sysadmin); `Actor.admin` would record the vendor sysadmin as the owner, which `Actor.forCaller` (`components/actor.data.ts:95-110`) never does. Applied: `Actor.forCaller(adminUserId, cmd.adminRoles)` — identical to `Actor.admin` for an admin, STAFF with `actorRoles: ['sysadmin']` for the sysadmin. Owner flag §7.
- **RU-14 (WS-3) end reasons.** Brief: _"the existing `impersonationEndReason` fields"_ with _"end reasons `ADMIN_ENDED`, `EXPIRED`, `ALREADY_ENDED`"_. `ALREADY_ENDED` is a refusal that writes nothing. The ENDED row's `impersonationEndReason` is typed by the whole `ImpersonationEndReason` dictionary (its L8 pair line in `identity-dictionaries.type-spec.ts` then holds with no exemption — flatten-spec N15); `planImpersonationEnded` writes only `ADMIN_ENDED` / `EXPIRED` (no REVOKED writer, as the brief says), pinned by its spec.
- **RU-15 (WS-3) `governedCollection` values are SCREAMING** (`APPOINTMENT_NOTES`, …): Law 1 (a tag dictionary's values); the dictionary sits in components and cannot import `Collections` (entities, a higher tier — Law 8); the tag → path map lives in a system, spec-checked against `Collections`.
- **RU-16 (WS-3) `AuditedProfileField` values are document field names** (`'roles'`, `'accountStatus'`) — the `RegistrationField` precedent (flatten-spec §3.7); the literal `'status'` is never spelled (runbook §4.2).
- **RU-17 (WS-3) rename.** Brief: _"The writer comes from the existing `AuditSystem.profileWriter` (rename it if it becomes general)"_ → `AuditSystem.writerOf`. The `ProfileAuthType` dictionary keeps its name (cosmetic churn in four type-specs; owner may rename later).
- **RU-18 (WS-3) the rules spec reads the wall clock once.** Brief §7: _"Specs never depend on the wall clock"_; the rule judges `request.time`, the emulator's real clock, which cannot be pinned. One named helper `emulatorNowMs()` in the rules spec, read immediately before each write; accepted bodies at 0 s and ±240 s; refused at −301 s and +301 s (brief) and ±360 s; the `300000` literal is pinned by a pure rules-text spec.
- **RU-19 (WS-3) photo update denied.** Brief: _"Delete stays; no update path exists"_ → `allow update: if false` (a tightening: a duplicated `setDoc` of an existing id is now refused; DEP-15).
- **RU-20 (WS-4.1) wire field names.** `operationId` for cancel / transition / markArrived / clearArrival / recordSeatTip (today's staff-edit spelling, `components/booking-call.data.ts:614`); book and reschedule keep `attemptId` (brief). Commands carry a uniform `operationId: OperationId` (book / reschedule: the attempt id's text, parsed once at the edge).
- **RU-21 (WS-4.1) "optional elsewhere".** Brief: _"The web mints one for every mutating call … REQUIRED on the WS-1 verbs …; optional elsewhere"_. Applied: the five verb stores and the booking flow mint (they own retries); the web callable adapter mints a fresh `operationId` for every other callable whose table entry is `'operationId'` (§2.1) and whose input carries none; the server reads it at the edge (outcome line) and, optionally (absent or malformed → `null`, never refused), in the four decoders whose pipeline writes an audit row or a provenance-bearing entity in its own commit: `decodeUpdateProfile` (the own-edit row's `auditOperationId`), `decodeStartImpersonation` / `decodeEndImpersonation` (the WS-3.1 rows' `auditOperationId` — brief WS-4.4 _"Audit rows carry `auditOperationId`"_ and the DoD's _"traceable from the UI reference to the callable outcome line, the audit row"_) and `decodeCompleteRegistration` (the customer create's `writeOperationId`, WS-4.3); every other decoder ignores it.
- **RU-22 (WS-4.1) intent types.** The ports tier holds no `Pick`/`Omit` (Law 9.3), so `SendStaffEdit` / `SendSeatTip` take named intent types (`BookingCall.StaffEditIntent`, `TipIntent`), and the wire types are `Intent & BookingCall.Operated`.
- **RU-23 (WS-4.2) the digest basis is an allowlist.** Brief: _"over the canonical JSON of the decoded command with `contact` and every free-text field removed"_. R36/T5 (free text and contact never enter a log line) outrank the brief's mechanism: a deny-list leaks the next free-text field. `LogDigestSystem.basisOf` keeps only allowlisted keys (ids, codes, minutes, cents, dates, flags); OTP codes, voucher / coupon codes, `reason` texts, labels and contact values are never in the basis.
- **RU-24 (WS-4.2) the sink is untraced.** `reportClientIssues` gets no outcome line and no bound context: OR-34 _"privacy by shape: no uid"_ and `throttledCallable`'s _"no line of ours"_.
- **RU-25 (WS-4.2) decision inputs are logged from the pipeline's read set, never carried in the error** (OR-12: _"An error carries scalars and brands only and is never a data channel"_); `updateTime` is recorded adapter-locally (brief: _"never invent a revision field without a DEP"_).
- **RU-26 (WS-4.2) new port bundles.** _"Bind the context once per invocation (… behind the Log port, in the adapter)"_ → `LogContextPorts` + `LogDigestPorts`; `CallableEdgePorts = EdgePorts & LogContextPorts & LogDigestPorts` (Law 9.2). `TelemetryPorts` and `EdgePorts` keep their members (`main.spec.ts` pins `Object.keys(telemetry)` = `['log','trackError']`).
- **RU-27 (WS-4.5) copy keys.** Brief: _"`errors.reference` … and `errors.referenceCopied`"_. Runbook §4.8 gate 7 (`firestore-runbook.md:1095-1103`: every `errors` key matches `^[A-Z]`), `catalogue-parity.spec.ts:131` (every `errors` key's first segment is SCREAMING) and Law 7.5 (`errors.<errorCode>`). Renamed `operation.reference` / `operation.referenceCopied`.
- **RU-28 (WS-4.5) surfaces and the presenter.** Brief: _"find the shared path that turns a callable `errorCode` into `errors.<code>` words and add one presenter function (Law 10) beside it; print … in `ui-alert` and the toast that path uses"_. `ui-alert` shows no callable error; the shared path is `wordPipelineError` (`libs/infrastructure/i18n/src/lib/word-pipeline-error.ts`), whose three callers feed the staff toast (`staff-dashboard.html:1590`), the booking review error (`booking-review-step.html:427`) and the client cancel error (`client-appointments.html:646-652`). Law 10.1 homes `*.presenter.ts` in `libs/features/**`; beside `word-pipeline-error.ts` the lawful kind is a wording helper (`operation-reference.words.ts`, presenter-purity applies). It returns words only — `{ text, copiedText } | null` — and builds no `…Vm`: `presenters.md` says a display model's _"functions live in a `*.presenter.ts`"_, so no `operation-reference.vm.ts` exists; the value printed is the id itself, which the surface already holds. `ui-alert` is untouched.
- **RU-29 (WS-4.3) provenance scope.** `WriteProvenance` on `Appointment` and `Customer` only (L5); a customer created by `completeRegistration` carries the call's optional transport `operationId` (RU-21; `null` when the caller sent none). The field means **the last booking-verb or registration callable that wrote the document**: `runBackfill`'s `stampMirrors` (`run-backfill.pipeline.ts:276-310`, an ops callable updating mirror stamps) neither sets nor clears it — its BACKFILL audit row is that call's trace — and a spec pins that its update plan holds no `writeOperationId` key (Law 5: the field stores what its definition says, and nothing claims a backfill wrote nothing).
- **RU-30 (WS-5) field shapes.** _"optional, allowlisted `ClientIssue` fields"_ → on the STRUCT always present, `null` when absent (ecs-components checklist: no `?:`): `operationId: ClientOperationId | null`, `callableName: string | null`, `callableErrorCode: string | null`. On the WIRE they stay optional, as the brief decided: `admitBatch` admits an issue whose keys are exactly the nine OR-34 keys plus any subset of the three new ones, and the admitted copy reads each absent new key as `null` (admission is decoding foreign input; the no-`?:` rule binds the struct, not the payload) — so an already-open old shell's 9-key batch is still admitted after the functions deploy. WS-5 acceptance: _"the OR-34 specs, size and rate caps stay unchanged"_ — the caps (`MAX_ISSUES` 10, `MAX_BYTES` 4096, `MAX_PER_SESSION` 20, the per-instance bucket), the rates, `FINGERPRINT_OF_DROPPED = '97594ab2'` and every OR-34 behavioural assertion (including every existing shape refusal: a missing ORIGINAL key, an unknown extra key) stay unchanged; the only OR-34 spec edits are type-forced key-set and typed-fixture literals (the 12-key `FIELDS` pin, `ClientIssue`-typed literals gaining three `null`s). The 7th kind `CALLABLE_TRANSPORT_FAILED` amends OR-34's six (owner flag). The fingerprint mixes `callableName` / `callableErrorCode` only when either is non-null (every existing fingerprint, `'97594ab2'` among them, unchanged) and never `operationId` (per attempt; it would defeat dedupe).
- **RU-31 (WS-6) `TriggerFailure` shape.** _"(fn, eventId, documentPath, attemptOutcome, failureCode, writeOperationId, recordedAtUtcMs)"_: `eventId` is the document id (`id: TriggerEventId` — Law 5, the body is the entity minus `id`); `writeOperationId` comes from the `WriteProvenance` slice by intersection; `fn` kept.
- **RU-32 (WS-6) the dead letter goes through a port.** _"written by `retryingTrigger`'s adapter"_ — `retryingTrigger` is an edge; the write is `TriggerFailurePorts.writeTriggerFailure` (ports tier) implemented by `firestore-trigger-failures.adapter.ts` (Law 4); `TriggerEdgePorts = EdgePorts & TriggerFailurePorts`.
- **RU-33 (WS-6) P9 is INFO inside a PASS row** (no INFO verdict exists; P2/P3 precedent): every read failure is an INFO line, never a throw, so a 403 under the documented role set cannot fail the predeploy. The Data Access audit config is not readable with that role set (`getIamPolicy`) → a `production-deploy.md` §1 checkbox (brief's fallback).
- **RU-34 (WS-6) Data Access audit service name.** Brief: _"Verify the service name(s) for Firestore Native mode first"_. Confirmed by search (pages blocked in the container): _"When configuring audit logging, use the service name `datastore.googleapis.com` to configure both `datastore.googleapis.com` and `firestore.googleapis.com`"_ — cloud.google.com/firestore/native/docs/audit-logging; Native-mode entries arrive under `protoPayload.serviceName="firestore.googleapis.com"`. Identity Toolkit: `identitytoolkit.googleapis.com` (not confirmed; flagged in the script header).
- **RU-35 (WS-7) two ports per field pair.** Actor and target each live in two fields (`actorUserId` / `actorAdminUserId`, `targetUserId` / `targetCustomerId`); one port per field (`pageAuditByActorUser`, `pageAuditByActorAdmin`, …) — no floating field-name parameter, no merge-paging in an adapter.
- **RU-36 (WS-6) the 400-day sink keeps every function line.** Brief: _"A log sink into a retention-locked bucket (≥ 400 days) for audit, function and security lines"_. Applied: `log-sink.sh`'s filter is the project's Data Access + activity audit logs OR every Cloud Functions (gen 2) log line of the project (`resource.type="cloud_run_revision"` with the Functions-managed label), AND `NOT jsonPayload.clientIssueKind:*` (client issues stay at 30 d: OR-34's published "30-day Cloud Logging retention"). An allowlist of four `LogEvent` texts (the first draft) would drop the outcome lines (the only join of an operation id, a uid and a refusal — the DoD trace) and every security line (`impersonation.*`, `otp.*`, `*.refused`). Function lines hold ids, codes and roles only (R36 / T5 hold for every log line); keeping a uid for 400 days is the owner's legal-basis call (§7 item 9).
- **RU-37 (WS-4.6 / WS-0) two literal-message exemptions.** Brief WS-4.6: _"pass `LogEvent.X` at every call site … Add a lint check … refusing a string literal as `log`'s message"_. Brief WS-0: _"Leave the console adapter's log line as it is (or drop the destination from it)"_. Applied: (a) the emulator-only console OTP line keeps its text under a justified `eslint-disable-next-line` (the lower WS-0 design yields only its wording, not the rule); (b) the sink's message (`report-client-issues.pipeline.ts:36`, `ClientIssueSystem.logLine`'s `msg` — `client issue <kind>` or the scrubbed reported head, built at `client-issue.system.ts:622-660`) is not a `LogEvent` value by design (OR-34: Error Reporting groups by the client's frame) — it is a non-literal and the rule never reports a non-literal. `no-literal-log-message.spec.mjs` pins both: the justified disable is honoured, an identifier / member-expression message is not reported.
- **RU-38 (WS-4.6) an `Error` in log fields is scrubbed.** Brief: _"The console adapter normalises an `Error` in fields to `{ name, message, code, stack }`"_. R36 / T5 (brief §2 item 7): _"Free text and contact values never enter an audit row or a log line"_ — an SDK or provider `Error.message` (and its stack's first line) can embed a phone or an e-mail. Applied: `{ name, code, message: ClientIssueSystem.scrub(message), stack }` where `stack`'s first line is replaced by `<name>: <scrubbed message>` and every frame line goes through `ClientIssueSystem.frame` (the existing pure masks, reused — never copied).
- **RU-39 (WS-5 / OR-34) the issue's `operationId` is a server-side join.** OR-34 (`decisions/2026-10-26-owner-rulings.md:917`): _"Privacy by shape: no uid, only a role and an authed flag"_. Brief WS-5: _"Add optional, allowlisted `ClientIssue` fields for the operation id and the callable's error code"_. OR-34 outranks the brief's design. Applied: the issue struct still holds no uid; its `operationId` joins it to a `callable.*` outcome line (which carries `uid`) only server-side, inside Cloud Logging, and only when the call reached the server. Kept because the DoD (_"Callable transport failures and operation ids reach Cloud Logging through the existing `reportClientIssues` sink"_) needs it; owner flag §7 item 20 — if the owner reads OR-34 strictly, `operationId` is dropped from `ClientIssue` (one field, its CAP and its admit case) and `callableName` / `callableErrorCode` stay.
- **RU-40 (WS-3.3) ONE document-change handler.** Brief: _"Generalise `auditProfileChange` into ONE shared handler (pipeline + wire decoder)"_ and §7 _"Reuse, never copy"_. Applied (§2.5): `GovernedCollection` gains `Users: 'USERS'` (14 members); `ProfileChange` gains `governedCollection: typeof GovernedCollection.Users`; `GovernedChange.governedCollection` is the 13-member subset `GovernedDocCollection` (its own file, the `ProfileAction` precedent); `DocumentChange = ProfileChange | GovernedChange` narrows with `===` on `governedCollection` (Law 1 / Law 6.2). ONE pipeline `auditDocumentChange` (`audit-document-change.pipeline.ts`, replacing `audit-profile-change.pipeline.ts` — every existing case moves into its spec unchanged), ONE planner entry `GovernedChangeSystem.plan(change: DocumentChange, …)` (USERS → `AuditSystem.planProfileChange`, the rest → the governed plan), ONE decoder `decodeDocumentChangeEvent(governedCollection, event)` over one shared core (id, time, `authType` / `authId`, both sides, `writerOf`), ONE non-exported `main.ts` helper behind all 14 exports. The export name `auditProfileChanges` stays (a deployed function's name); its path param becomes `{docId}` like the other 13.
- **RU-41 (WS-1) change keys are never null.** Brief WS-1: _"Remove the `nextId()` branch: a fact with a null change key is a defect"_; L2 keeps `run-backfill` on `appendAudit` but decides only WHERE its row is written. Applied: `AuditFact.changeKey: string` and `AuditRowPlan.idBasis: string` everywhere (the `?? defect`, `?? cmd.eventId` and `idBasis === null ? nextId()` fallbacks go). `run-backfill`'s FAILED call — one row per CALL, no result to key on, every call a distinct act — keys its fact `AuditSystem.changeKey.backfillFailed(ports.nextId())` (`backfill-failed:<id>`): the one minted key, built in the one pipeline L2 keeps off the commit plan.

### 0.3 The latitude register (L1–L6, copied into the PR's owner flags)

| L   | Choice                                                                                                                                                               | Reason                                                                                                                                                                                                                                                                                                                                                     | Law                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| L1  | NEW code `IDENTITY_OTP_SEND_UNAVAILABLE` (`failed-precondition`)                                                                                                     | `IDENTITY_OTP_SEND_FAILURE`'s words end in «Опитай пак» / "Try again", which OR-55 allows only when a retry can succeed, and existing copy is frozen (brief §5); the distinct code and status separate "no sender" from "provider fault" in logs and metrics                                                                                               | Law 7.5 (one `errorCode` per refusal); OR-55               |
| L2  | `run-backfill` stays on `appendAudit`                                                                                                                                | one call is many commits plus a job document written through a non-plan port; the row records the CALL, including a `FAILED` call where nothing committed (`auditCall` in `finally`, `run-backfill.pipeline.ts:707-722`) — there is no single commit to join; `AuditAppendPorts`, `firestoreAuditPorts.appendAudit` and the `nextId` mint stay for it only | Law 4 (the transaction is the sandwich — one per decision) |
| L3  | a multi-command staff save writes ONE row per client record with every touched delta                                                                                 | the batch is folded and decided once (`edit-appointment.pipeline.ts` header); deltas come from stored-vs-after, so they are command-count independent; one `operation:<id>` key and the `BOOKING_STAFF_SAVE` verb already model one save = one act                                                                                                         | Law 3 (one pure decision over before/after); Law 6.3       |
| L4  | the governed trigger records EVERY write, no skip                                                                                                                    | 11 of the 13 collections have no pipeline row to dedupe against; on `customers` the booking row says what happened to the visit, the governed row what changed on the record; a skip needs a cross-document read inside a trigger                                                                                                                          | Law 4 (no extra read to decide); Law 3                     |
| L5  | `barberBusy` carries NO provenance                                                                                                                                   | four whole-body `Set` writers (`busyMergeWrites` in book / reschedule / edit / transition) plus the rebuild trigger would erase or rewrite the stamp; copying it in the trigger makes every rebuild a real write that wakes two change-blind triggers; the document is anonymously readable                                                                | Law 5 (projections are caches rebuilt by triggers)         |
| L6  | the PHOTO stamp is read AFTER the Storage upload; note stamps stay where they are (fresh at the write); LIBRARY photos get the same ±300 s window and no extra check | `attachVisitPhoto` stamps before `uploadPhotoBytes` — a slow upload (≤ 8 MiB) would be refused and orphan the object; notes stamp at the write (`append-team-note.pipeline.ts:77`, `:117`); an adopted LIBRARY photo's `takenAtUtcMs` is the adoption click (no EXIF is read anywhere)                                                                     | Law 7.3 (lifecycle stamps; elapsed-time rules on stamps)   |

### 0.4 Write volume (WS-1, measured from code)

**Limits** (orchestrator's environment notes: confirmed through the official
pages `firebase.google.com/docs/firestore/quotas` and
`docs.cloud.google.com/firestore/quotas` _as indexed by search_ — the pages
themselves are blocked by this container's network policy): maximum API
request size **10 MiB**; maximum document size **1 MiB** (1,048,576 bytes);
transaction time limit **270 s** with a **60 s** idle expiration; a 500 cap
exists only for **field transformations on one document in one commit**; no
500-writes-per-commit cap is listed any more (consistent with the repo
research, `docs/design-research/client-details-design.md` row FB / L206,
"The 500-write cap is gone"). Rows go INSIDE the transaction; no outbox.

**Inputs.** `BookingPolicy.maxPartySize` default **5**
(`components/booking-policy.data.ts:58`), validated only as a positive
integer (`:119`) and enforced on PEOPLE (`systems/party-admission.system.ts:144`);
seats per person are not capped on the booking path, so the measurement takes
the waitlist's own cap, 8 services per person (`systems/waitlist.system.ts:156`)
→ **S = 40 seats**, distinct barbers **B = 10** (one busy document per
barber-day, `busyMergeWrites`, `booking-read-set.pipeline.ts:309-361`),
live voucher lines **V = 5**, grant lines **G = 5**, one audit row per
distinct client record (≤ P = 5, +1 owner record on an added SELF seat).
Sizes are upper bounds from the field lists (Firestore size = field names +
values): a seat ≈ 30 fields ≤ 1.5 KB; an appointment ≤ 2 KB root + S × 1.5
KB + the 20-entry ledger ≤ 4 KB ≈ **66 KB**; a busy day ≤ 2 KB; a customer
≤ 2 KB; a voucher / grant ≤ 1 KB; an audit row with WS-2 deltas and
`auditOperationId` ≤ 1.2 KB.

| Verb                | Writes (worst, P = 5)                                        | Audit rows | Total ops | Bytes (worst) |
| ------------------- | ------------------------------------------------------------ | ---------- | --------- | ------------- |
| book                | 1 appt Create + B busy Sets + ≤ P customer / walk-in Creates | ≤ 5        | 21        | ≈ 104 KB      |
| reschedule          | 1 appt Update + B busy Sets                                  | ≤ 5        | 16        | ≈ 92 KB       |
| staff edit          | 1 appt Update + B busy + V vouchers + G grants + ≤ P Creates | ≤ 6        | 32        | ≈ 113 KB      |
| client cancel       | 1 appt Update (transition) + V + G                           | ≤ 5        | 16        | ≈ 82 KB       |
| transition (reopen) | 1 appt Update + V + G + B busy                               | ≤ 5        | 26        | ≈ 102 KB      |
| arrival / clear     | 1 appt Update                                                | ≤ 5        | 6         | ≈ 72 KB       |
| tip                 | 1 appt Update                                                | 1          | 2         | ≈ 67 KB       |

Worst commit ≈ **113 KB = 1.1 % of 10 MiB**; largest document ≈ **66 KB =
6.3 % of 1 MiB**; field transformations per document ≤ ~10
`FieldValue.delete()`s of a variant transition (2 % of 500); the audit rows
add ≤ 7.2 KB (≈ 6 %) to any commit and no read. Every figure is far below
the brief's 50 % stop threshold — **no stop condition**.

### 0.5 `maxPartySize` cap (owner flag — proposed, not built)

`maxPartySize` has no validated upper bound and seats per person are
unbounded on the booking wire (`wire/booking.wire.ts` `seatsOf` bounds
nothing), so the first limit a hostile or mistaken setting reaches is the
appointment's 1 MiB document (≈ 650 seats), long before the 10 MiB request.
**Proposal:** `BookingPolicy.create` refuses `maxPartySize > 20` (the
settings door), and `PartyAdmissionSystem` refuses a cart of more than
`maxPartySize × 8` seats (reusing the waitlist's `MAX_SERVICES_PER_PERSON`).
At the cap: S = 160 → appointment ≈ 246 KB (24 % of 1 MiB), worst commit ≈
0.4 MiB (4 %). Not built in this pass; listed in §7.

### 0.6 Critique disposition (three critics; every gap verified against `1f027ee` / `0df7d7ab`)

Ids: **C** = completeness, **F** = fidelity, **L** = laws. All 42 gaps were
real; none was rejected. Where a critic offered options, the chosen one is named.

- C-1 APPLIED — `billing.system.spec.ts` / `cancellation-policy.system.spec.ts` lifecycle literals (`:198-207`, `:300-308`, `:373-378`, `:446-455`, `:557-566`) confirmed; owned by P4, §4 P4 row.
- C-2 APPLIED — `audit.system.spec.ts:76`, `:334`, `:348` call the widened factories; owned by P7 (`:69-77`, `:332-353`).
- C-3 APPLIED — rules-spec literal `:1816` `AuditContext.cancelled(…)` confirmed; owned by P7; P9a moved to W4 beside P8; C3 = P7 alone; P5 asserts rows without hand-built contexts.
- C-4 APPLIED — `audit-profile-change.pipeline.spec.ts:41-54`, `:76-97` confirmed; P8 owns it (moved into `audit-document-change.pipeline.spec.ts`, F-1); DEP-13 lists it.
- C-5 APPLIED — `port-doubles.spec.ts:885-895`, `:939-951`, `customers.adapter.spec.ts:134-151`, `staff-visit-editor.spec.ts:7345-7365` confirmed; owned by P11c, Checks + DEP-19 extended.
- C-6 APPLIED — `operation-trace.integration.spec.ts` owned by P16 (ports literal + TRANSIENT-early assertion); DEP-23 lists it.
- C-7 APPLIED — no decoder refuses an extra key (`booking.wire.ts` `decodeCancelAppointment`), so web-first is safe; DEP-4 states the skew; order indexes → hosting → rules → functions in §7.7, runbook §3 and `production-deploy.md` §3 (P17), HANDOFF (integrator).
- C-8 APPLIED — RU-36: the sink keeps audit logs + every Cloud Functions line, client issues excluded; §7.9 flags the 400-day uid retention; `ops-scripts.spec.mjs` pins the filter.
- C-9 APPLIED — runbook `:52` "No other collection exists" confirmed; P17 adds the `triggerFailures` row, the `writeOperationId` notes and re-runs §1.4.
- C-10 APPLIED — P6 moved to W2c after C2 (types against P4's `auditOperationId`).
- C-11 APPLIED — §6.2: helper literal count 1, exports `^export const audit…Changes = ` 14.
- C-12 APPLIED — `test:emulator` at C1, C2′ and C3; P16 moved to W8 beside P17; every commit is gated on exactly its tree.
- C-13 APPLIED — RU-37 (the OTP console line's disable; the sink's non-literal `line.msg`, `report-client-issues.pipeline.ts:36`); pinned in `no-literal-log-message.spec.mjs` (P14).
- C-14 APPLIED — RU-30 quotes the acceptance line and limits OR-34 spec edits to type-forced key-set / fixture literals (with F-5, behavioural pins stay).
- C-15 APPLIED — the new emulator spec is `visit-media-writers.integration.spec.ts`: photo bodies from `attachVisitPhoto` / `adoptVisitPhoto`, written with the adapter's own `setDoc` line.
- C-16 APPLIED — `firestore.indexes.json` is absent from `tools/verify/project.json` `test.inputs` (confirmed); P6 adds it.
- C-17 APPLIED — with L-8, option (b): RU-29 / DEP-19 define the field as the last booking-verb or registration writer; a `run-backfill` spec pins no `writeOperationId` key (P11c).
- C-18 APPLIED — `ecs-pipelines.md` Composition-root sentence reworded by P14; §7.6 lists it.
- C-19 APPLIED — §8 names the carried items.
- C-20 APPLIED — P9b adds the `production-deploy.md` §2 bootstrap sentence and the runbook Audit-column attribution legend.
- F-1 APPLIED — full merge (RU-40): ONE pipeline `auditDocumentChange`, ONE decoder `decodeDocumentChangeEvent`, ONE `main.ts` helper; `GovernedCollection.Users` + `GovernedDocCollection` give a lawful `===` discriminator.
- F-2 APPLIED — `decodeStartImpersonation` / `decodeEndImpersonation` (`governance.wire.ts:59`, `:100`) and `decodeCompleteRegistration` read the optional id (P2, which also owns the two integration specs that build those commands); commands gain it (P1); `planImpersonation*` take it (P8); registration creates carry it (P11a); RU-21 / RU-29 amended.
- F-3 APPLIED — same fix as C-10.
- F-4 APPLIED — same fix as C-8 (RU-36).
- F-5 APPLIED — `admitBatch` admits the nine OR-34 keys plus any subset of the new three (`issueFault` today demands exactly `FIELDS`, `client-issue.system.ts:361-375`); DEP-22 / §7.8 no longer refuse old webs; the reverse window (old sink, new web) stays declared.
- F-6 APPLIED — `mark-arrival.pipeline.ts:60-75` + lifecycle `:734-751` confirm the facts are actor-independent; DEP-8 withdrawn, §2.2 says "the lifecycle step's writes".
- F-7 APPLIED — same fix as C-11.
- F-8 APPLIED — §2.5 states `forImpersonationSession(session.id)`, `AuditTargetRef.user(session.targetUserId)` and `auditOperationId`; P8 spec pins all three.
- F-9 APPLIED — option 1 (RU-41): `changeKey` / `idBasis` non-null everywhere; the FAILED backfill call keys `backfill-failed:<nextId()>` inside `run-backfill` (`:639-655`).
- F-10 APPLIED — §0.1 row 4.5 cites RU-28.
- F-11 APPLIED — RU-11 quotes the latitude limit and the Problem / objective; the 13 extras are their own DEP-10a, each strike-able.
- F-12 APPLIED — same fix as C-3 / C-12 (W2c, W3 = P7, W4 = P8 ‖ P9a, W7 = P15, W8 = P16 ‖ P17).
- F-13 APPLIED — same fix as C-16.
- F-14 APPLIED — RU-39 quotes OR-34 (`owner-rulings.md:917`) and the brief; §7 item 20 flags the server-side join and the strict alternative.
- L-1 APPLIED — `ECS_RAW_PRIMITIVE_RESTRICTIONS` (`ecs-syntax.mjs:225-230`, installed on `*.system.ts` at `:440`) would report `documentId: string`; `GovernedChange` carries `resourceId: AuditResourceId` + `targetCustomerId: CustomerId | null`, parsed at the wire; `forDocument` deleted.
- L-2 APPLIED — the snapshot is captured in the impure read callback; `decide` stays pure; P11b spec with a `deepFreeze`d snapshot.
- L-3 APPLIED — RU-38: `ClientIssueSystem.scrub` / `.frame` (`client-issue.system.ts:212`, `:223`, exported `:489-497`) reused for the message and frames; P12 sentinel case.
- L-4 APPLIED — pair lines owned by P7 (two, N15-exempt), P8 (`governedCollection`, `impersonationEndReason` — the latter now typed by the whole dictionary, RU-14) and P16 (`TriggerFailure['attemptOutcome']`; P16 runs after P15 now, so it owns the line itself); nullable tag fields are pinned in the entity type-specs (the `PAIR` regex reads `Owner['field']` against one dictionary name only).
- L-5 APPLIED — purity cases required for `canonical-json`, `log-digest`, `decision-input` (P10) and for `profileTagDelta` / `writerOf` / `GovernedChangeSystem` (P8).
- L-6 APPLIED — the versions-read line holds returned snapshots' paths only (voucher ids are not codes: `GiftVoucherId` is minted separately); P12 sentinel case.
- L-7 APPLIED — `OperationId.is(raw) ? raw : null` (the `idCompanion` guard exists); P12 spec case.
- L-8 APPLIED — same fix as C-17 (option b).
- L-9 APPLIED — §3 preamble: the name check runs every §4.0 array with its gate's flags over the package's ADDED lines.
- L-10 APPLIED — §3 preamble + P6 / P9a / P17: root files read with `readFileSync` / `resolve`, never a `../../../` import.
- L-11 APPLIED — `ops-scripts.spec.mjs` reads `log-event.data.ts` and checks every message text; P17 adds it to `test.inputs`.
- L-12 APPLIED — (a) `AuditSystem.chronological` (P6, pure, spec'd) orders `auditRowsForOperation`; (b) no `operation-reference.vm.ts`, the wording helper returns words only (RU-28).

---

### 0.7 Orchestrator notes

- **Rulings accepted.** RU-1 … RU-41 and the L-register (§0.3) stand as written. RU-11 / DEP-10a (13 delta fields beyond the brief's 19) and RU-13 (`Actor.forCaller` for the impersonation rows) are built and owner-flagged; each is strike-able on its own.
- **CI `main` job: red on the base branch, not ours.** `pnpm icons:check` fails on `main` at `0df7d7ab` and on every recent `main` run with the same three hits (`gauge.ts:192` inline-svg — `INLINE_SVG_ALLOWED` in `tools/icons/check-icon-usage.mjs` drifted from `eslint.config.mjs`, which also allows the gauge ring; `accent-rule.spec.ts:610`/`:615` placeholder key `a.b`). The HANDOFF §4 gate does not run it. Reported on the PR with a two-line proposed patch; not widened into this pass unless the owner says so.
- **Environment** (no repository change): see §6.3's notes — Node 22.22.3, the emulator journeys without the proxy variables, coverage with `--testTimeout=30000`, the Linux screenshot references kept local.

## 1. Inventory (file:line on `0df7d7ab`; WT = working tree)

| #   | Item                                | Sites                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Package                  |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | OTP sender gate (WS-0)              | `apps/functions/src/main.ts:288`; `adapters/console-otp-sender.adapter.ts`; WT `adapters/refusing-otp-sender.adapter.ts`; `errors/identity.error.ts`; `ports/identity.port.ts:62-65`; `wire/identity.wire.ts:122-135`; `edge.ts:437`; `pipelines/request-otp.pipeline.ts:117-158`; `tools/verify/preflight/preflight.mjs` (CHECKS / SUBJECTS / SCOPES / P7 body); `preflight.spec.mjs:852-857`, `:885-925`, `:996-1010`, `:1084-1141`; `docs/production-deploy.md` §1 | P0                       |
| 2   | wire ids (WS-4.1)                   | decoders `wire/booking.wire.ts:274`, `:322`, `:367`, `:417`, `:572`, `:578`, `:628`, `:1012`; `wire/identity.wire.ts:333` (`decodeUpdateProfile`); `wire/wire-read.ts` (`idOf`); `ids.primitive.ts:235-266` (`ClientOperationId`)                                                                                                                                                                                                                                     | P1, P2                   |
| 3   | wire types (WS-4.1)                 | `components/booking-call.data.ts:566-615` (`Reschedule`, `Cancel`, `Transition`, `Arrival`, `Tip`, `StaffEdit`), `:186-198` `clientCancel`; `ports/callables.ts:57-156` (`CallableWire`), `:186-193`; `ports/visit-edit.port.ts:24`, `:40`                                                                                                                                                                                                                            | P1                       |
| 4   | commands (WS-4.1)                   | `book-appointment.pipeline.ts:138` (`attemptId`), `reschedule-appointment.pipeline.ts:146`, `edit-appointment.pipeline.ts:188`, and the cancel / transition / mark-arrival / record-seat-tip / update-profile command types; `save-visit-edit.pipeline.ts:48-70`; `testing/port-doubles.ts:1516-1560`                                                                                                                                                                 | P1                       |
| 5   | web senders (WS-4.1)                | `staff-day.store.ts:1976-2001` (commit), `:2005`, `:2035`, `:2139-2155`, `:2287-2299`, `:2333`, `:2379`; `staff-dashboard.ts:906-914` (`transitionOf`); `appointments.store.ts:86`, `:370-372`; `booking-flow.store.ts:822-838` (`sendMove`), `:1293`; `callable-client.adapter.ts:28-38`; `apps/web/src/app/app.config.ts:331`                                                                                                                                       | P3                       |
| 6   | post-commit audit writer (WS-1)     | `booking-read-set.pipeline.ts:380-428`; seven callers (§0.1 #1.1); ports `ports/governance.port.ts:25`, `:69-71`, `:84`; docs `governance.port.ts:14-22`, `ports/tx.port.ts:19-21`, `adapters/firestore-audit.adapter.ts:6-30`                                                                                                                                                                                                                                        | P4, P5                   |
| 7   | audit system (WS-1, WS-4.4)         | `systems/audit.system.ts:80-86` (`AuditFact`), `:104-107` (`AuditRowPlan`), `:169`, `:183-197` (`rowBasis`), `:250-285` (`plan`), `:353-411` (`changeKey`), `:555-579` (`planOwnProfileEdit`); `systems/appointment-lifecycle.system.ts:61-66`, `:288-315`, `:629-660`, `:725-785`; `systems/streak-publish.system.ts:774-796`; `entities/audit-entry.entity.ts:17-21`                                                                                                | P4                       |
| 8   | non-booking row writers (WS-4.4)    | `update-profile.pipeline.ts:69-90`; `publish-streak-definition.pipeline.ts:268`, `:337`, `:448-490`; `run-backfill.pipeline.ts:625-668`; `audit-profile-change.pipeline.ts:46-54`                                                                                                                                                                                                                                                                                     | P4                       |
| 9   | whole-row fixtures outside ecs-core | `adapters/firestore-audit.adapter.spec.ts:30-35`; `firestore-audit.adapter.integration.spec.ts:53-69`; `integration/project-client-stats.integration.spec.ts:538-544`; `integration/update-profile.integration.spec.ts:126`; `integration/publish-streak-definition.integration.spec.ts`; `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts:1813-1816`; `tools/verify/p0/verify-p0.mjs:458-480`, `:694-716`                                  | P5                       |
| 10  | audit timeline (WS-7)               | `firestore.indexes.json` (19 composites; `auditLog` overrides only); `adapters/firestore-audit.adapter.ts:112-135` (kept); model `ports/scheduling.port.ts:184-188`, `:439-444`; `libs/infrastructure/firestore/src/lib/client-stats.adapter.ts:36-80`; `ports.tokens.ts:73-75`; `app.config.ts:409-411`; `production-deploy.md` "all 19 composites"                                                                                                                  | P6                       |
| 11  | deltas (WS-2)                       | `components/audit-context.data.ts:118-147`, `:204-279`; `reschedule-appointment.pipeline.ts:620-727`; `edit-appointment.pipeline.ts:738-1030`; `record-seat-tip.pipeline.ts:56-98`; lifecycle `:271-300`, `:629-657`; `components/booking-lifecycle.data.ts` (`enteredAtUtcMs`); `systems/billing.system.ts` (`subtotalOf`, `redeemedOf`)                                                                                                                             | P7                       |
| 12  | impersonation rows (WS-3)           | `start-impersonation.pipeline.ts:40-43`, `:73-116`; `end-impersonation.pipeline.ts:35`, `:48-90`; `entities/impersonation-session.entity.ts:16-43`; `components/end-reason-fields.data.ts`                                                                                                                                                                                                                                                                            | P8                       |
| 13  | roles / status (WS-3)               | `audit.system.ts:127-176`, `:437-545`; `components/audit-context.data.ts:191-196`, `:274-278`; `pipelines/complete-registration.pipeline.spec.ts:206-224`; `apps/functions/src/wire/triggers.wire.ts:350-372`                                                                                                                                                                                                                                                         | P8, P9b                  |
| 14  | governed triggers (WS-3)            | `main.ts:422-427` (paths), `:490-514` (the profile trigger); `main.spec.ts:19-48`, `:137-144`, `:160-257`, `:342-774`, `:805`, `:825`; `wire/triggers.wire.ts:52-69`, `:104-173`, `:395-470`; `entities/collections.ts:28-91`                                                                                                                                                                                                                                         | P8, P9b                  |
| 15  | rules + stamps (WS-3)               | `firestore.rules:342-344`, `:353-355`, `:54-86` (helpers); `firestore.rules.integration.spec.ts:191`, `:1749-1806`; `attach-visit-photo.pipeline.ts:79-146`; `append-team-note.pipeline.ts:34-121`; `libs/infrastructure/firestore/src/lib/appointment-notes.adapter.ts:56-127`; `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts:129-139`                                                                                                          | P9a                      |
| 16  | log port + call sites (WS-4.2, 4.6) | `ports/telemetry.port.ts:1-30`; 32 pipeline sites + `adapters/firestore-audit.adapter.ts:93`, `firestore-tx.adapter.ts:103-107`, `edge.ts:1051`, `wire/triggers.wire.ts:410`, `wire/client-issue.wire.ts:46`, `wire/loyalty.wire.ts:93`, `console-otp-sender.adapter.ts:47-49`; web `libs/infrastructure/firestore/src/lib/observe.ts:143-145`, `:181`                                                                                                                | P4, P11b, P11c, P12, P14 |
| 17  | callable edge (WS-4.2)              | `edge.ts:913-1000` (`EdgePorts`, `unexpected`, `CallableSpec`, `callableEdge`); `main.ts:334-347`, `:387-421` (`wiredCallable`, `plain`); `adapters/console-telemetry.adapter.ts:63-78`; `adapters/crypto.adapter.ts`; `tools/flags/write-functions-env.mjs` `EMULATOR_SECRETS`; `systems/client-stats.system.ts:1263` `canonicalJson`                                                                                                                                | P10, P12                 |
| 18  | provenance (WS-4.3)                 | `entities/appointment.entity.ts`, `entities/customer.entity.ts`; `systems/stored-document.system.ts:145-200`; `systems/customer-record.system.ts:142-160`, `:307-325`; `systems/booking-decision.system.ts` (new body); `booking-read-set.pipeline.ts:578` `placementFields`, `:492-504` `withMoreFields`; `systems/trigger-attempt.system.ts:74-95`, `:208-219`; `edge.ts:1017`, `:1063-1075`                                                                        | P10, P11a, P11b, P12     |
| 19  | UI reference (WS-4.5)               | `errors/pipeline.error.ts` (`PipelineError`); `callable-client.adapter.ts:28-38`; `word-pipeline-error.ts:37-51`; `staff-dashboard.ts:3969-3977`, `:6555`; `staff-dashboard.html:1590-1598`; `booking-review-step.html:427`; `booking-error-message.ts:40-44`; `client-appointments.ts:1060`, `.html:646-652`; `libs/ui/patterns/src/lib/toast/toast.ts:143-151`                                                                                                      | P13a, P13b               |
| 20  | client issue (WS-5)                 | `components/client-issue.data.ts:6-19`, `:52-92`; `systems/client-issue.system.ts:49-80`, `:352-391`, `:438-447`, `:518-662`; `callable-client.adapter.ts`; `client-issue-reporter.adapter.ts:74-85`; `app.config.ts:285`, `:331`                                                                                                                                                                                                                                     | P15                      |
| 21  | dead letter (WS-6)                  | `edge.ts:1009-1058`; `systems/trigger-attempt.system.ts:66-71`, `:143-219`; `wire/triggers.wire.ts:395-430`; `adapters/firestore-ports.ts:87-132`; `entities/collections.ts`; `firestore.rules:684-703`                                                                                                                                                                                                                                                               | P16                      |
| 22  | ops + preflight row (WS-6)          | `preflight.mjs` WT `:73-106` (Verdict, CHECKS, SUBJECTS, SCOPES, READS_PROJECT), `runPreflight`, `liveReaders`; `preflight.spec.mjs` WT `:1014-1100`, `:1254-1384`; `tools/verify/project.json` `test.inputs`; runbook §2, §3 (step 7 `:240-259`), table `:195-210`; `production-deploy.md` "Backups", "Cloud Audit Logs", "Monitoring and privacy", §3.5                                                                                                             | P17                      |

---

## 2. Contracts

Every new identifier below passed the runbook §4.0 word lists (§0.1 #2.3).
No optional property and no `| undefined` in any ECS file — absent is `null`.

### 2.0 WS-0 (P0 — as built in the working tree)

```ts
// errors/identity.error.ts — inside the IdentityError union (lawful; no exhaustive switch over it exists)
IdentityErrorCode.OtpSendUnavailable = 'IDENTITY_OTP_SEND_UNAVAILABLE';
IdentityError.otpSendUnavailable(): IdentityError.OtpSendUnavailable;
export namespace IdentityError { export type OtpSendUnavailable = { readonly errorCode: typeof IdentityErrorCode.OtpSendUnavailable }; }
// ports/identity.port.ts
export type SendOtp = (destination: ParsedIdentifier, code: string) =>
  Promise<Result<void, PipelineError | IdentityError.OtpSendUnavailable>>;
// apps/functions/src/adapters/refusing-otp-sender.adapter.ts — JSDoc tag @launchBlocker, never @emulatorOnly
export const refusingOtpSender = (): OtpDeliveryPorts => ({
  sendOtp: async () => Result.err(IdentityError.otpSendUnavailable()),
});
// main.ts identityPorts
...(onEmulator() ? consoleOtpSender(telemetry.log) : refusingOtpSender()),
// wire/identity.wire.ts requestOtpRefusal — before the PipelineError collapse
if (error.errorCode === IdentityErrorCode.OtpSendUnavailable) return error;
// edge.ts IDENTITY_WIRE
[IdentityErrorCode.OtpSendUnavailable]: fields(S.FailedPrecondition),
```

Copy (flagged): bg `errors.IDENTITY_OTP_SEND_UNAVAILABLE` «Кодовете за вход
още не се изпращат. Свържи се със салона.»; en "Sign-in codes aren't being
sent yet. Contact the shop." (OR-51 «ти», OR-55: two sentences, no «моля»,
no «Опитай пак»).

Preflight: `CHECKS.P8 = 'no launch-blocker stand-in is wired (@launchBlocker)'`,
`SUBJECTS.P8 = 'the launch blockers'`, `SCOPES.functions = ['P1','P2','P3','P6','P7','P8']`;
P7 and P8 share one traversal (`taggedExportUses`); P8 FAILs while any use of
a `@launchBlocker` export remains (today: `main.ts`'s deployed branch), and
flips to PASS in the change that lands a transactional sender (its pin is
updated there).

### 2.1 WS-4.1 — operation ids (P1, P2, P3)

```ts
// primitives/ids.primitive.ts — ClientOperationId companion gains:
/** The client-minted id `payload[field]` carries, else null — never an unvalidated string (WS-4.1). */
inPayload(payload: unknown, field: string): ClientOperationId | null;
// (StoredFields.isRecord from ./stored-fields.data; own property only)

// components/booking-call.data.ts — namespace BookingCall
export type Operated = { readonly operationId: ClientOperationId };
export type Reschedule = { …; readonly attemptId: ClientOperationId };          // was | null
export type CancelIntent = { readonly appointmentId: AppointmentId; readonly reason: CancellationReason };
export type Cancel = CancelIntent & Operated;
export type TransitionIntent = { appointmentId; toBookingStatus; cancellationReason; seatId };
export type Transition = TransitionIntent & Operated;
export type Arrival = { readonly appointmentId: AppointmentId } & Operated;
export type TipIntent = { appointmentId; seatId; amountCents };
export type Tip = TipIntent & Operated;
export type StaffEditIntent = { appointmentId; commands; acknowledgedOverlap; expectedVersion };
export type StaffEdit = StaffEditIntent & Operated;                               // operationId non-null
// companion: clientCancel(appointmentId, typedReason): BookingCall.CancelIntent

// ports/callables.ts
export type OperationIdField = 'operationId' | 'attemptId' | 'requestId';
/** Where each callable's operation id rides on the wire (WS-4.1); null — the log sink carries none. Total over CallableName. */
export const OPERATION_ID_FIELD: { readonly [N in CallableName]: OperationIdField | null };
// commitBooking, rescheduleAppointment: 'attemptId'; publishStreakDefinition: 'requestId';
// reportClientIssues: null; every other callable: 'operationId'

// ports/visit-edit.port.ts
export type SendStaffEdit = (intent: BookingCall.StaffEditIntent) => Promise<boolean>;
export type SendSeatTip = (request: BookingCall.TipIntent) => Promise<boolean>;

// pipeline commands (libs/ecs-core/src/pipelines)
BookAppointmentCommand:       attemptId: AppointmentId;  operationId: OperationId   // same text
RescheduleAppointmentCommand: attemptId: ClientOperationId; operationId: OperationId // same text
EditAppointmentCommand:       operationId: OperationId                              // was | null
CancelAppointmentCommand, TransitionAppointmentCommand, MarkArrivalCommand,
RecordSeatTipCommand:         + operationId: OperationId
UpdateProfileCommand:         + operationId: OperationId | null                      // transport id, optional
```

The `null` branches that stop compiling go (book's "a `null` attempt mints
one", reschedule's `cmd.attemptId === null` operation branch, edit's
`operation === null` branches); every audit key stays byte-identical in this
commit (the web always sent these ids).

Wire (`apps/functions/src/wire`):

```ts
// wire-read.ts
export function operationIdOf(
  payload: unknown,
  field: OperationIdField,
): OperationId | null;
// = ClientOperationId.inPayload(payload, field) then OperationId.parse (a reserved `__x__` name → null)
```

| Callable                       | Field         | Missing / malformed / reserved → (refusal names the field)                                        |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------- |
| `commitBooking`                | `attemptId`   | `BookingError.invalidInput('attemptId')`; the id is `AppointmentId.parse` (was `.of` — R6)        |
| `rescheduleAppointment`        | `attemptId`   | `BookingError.invalidInput('attemptId')`                                                          |
| `staffEditAppointment`         | `operationId` | `invalid('operationId')` — today's malformed answer, now also for an absent id                    |
| `cancelAppointment`            | `operationId` | `CancellationRefusal.invalidInput('operationId')`                                                 |
| `transitionAppointment`        | `operationId` | the decoder's own invalid-input struct (`BookingErrorCode.TransitionInvalidInput`), `operationId` |
| `markArrived` / `clearArrival` | `operationId` | `BookingErrorCode.ArrivedInvalidInput`, `operationId`                                             |
| `recordSeatTip`                | `operationId` | the decoder's `TipInvalidInput` struct, `operationId`                                             |
| `updateProfile`                | `operationId` | OPTIONAL: absent or malformed → `null`, never refused                                             |

Refusal order unchanged: unauthenticated → forbidden → payload fields. No new
`errorCode`, no new words (the web always sends a valid id).

Web:

```ts
// libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts
export const callableClientPorts = (functions: Functions, ids: IdPorts): GatewayPorts;
// when OPERATION_ID_FIELD[name] === 'operationId' and ClientOperationId.inPayload(input,'operationId') === null:
//   send { ...input, operationId } with operationId = ClientOperationId.parse(ids.nextId()) (a failed mint sends none)
// apps/web/src/app/app.config.ts:331 → callableClientPorts(inject(FIREBASE_FUNCTIONS), inject(ID_PORTS))
```

Stores mint `ClientOperationId.parse(this.ids.nextId())` and refuse a failed
mint client-side with `PipelineError.bare(PipelineErrorCode.InvalidRequest)`
exactly as `staff-day.store.ts:1980-1987` does: `AppointmentsStore.cancel`
(gains `inject(ID_PORTS)`), `StaffDayStore.markArrived` / `clearArrival` /
`transition(intent: BookingCall.TransitionIntent)` / `recordTip(intent:
BookingCall.TipIntent)` / `staffEdit(intent: BookingCall.StaffEditIntent)`
(keeps `operationIdFor`). `booking-flow.store.ts` `sendMove` refuses a
`null` `_attemptId` like `sendBooking` and its comment loses "a retry … fills
a lost row" (rows are atomic after WS-1).

### 2.2 WS-1 + WS-4.4 — rows in the commit plan, `auditOperationId` (P4, P5)

```ts
// primitives/log-event.data.ts (+ export in primitives/index.ts) — every existing text, byte for byte
export const LogEvent = {
  AuditActorMissing: 'audit row has no verified actor',
  AuditWriteFailed: 'audit write failed',
  BackfillAuditNotWritten: 'backfill audit row not written',
  BarberBusyRebuildFailed: 'barberBusy rebuild failed',
  BookingRejected: 'booking.rejected',
  CancelPolicyUnread: 'cancellation policy unread; cancel refused',
  CancelWindowUnread: 'cancellation window unread; stamped unknown',
  CapacitySpanTruncated: 'capacity span truncated at 500 days',
  CapacitySweepFailed: 'capacity sweep failed for barber',
  ClientIssueBatchRefused: 'client issue batch refused',
  DocumentDropped: 'malformed document dropped',
  DocumentRefused: 'malformed document refused',
  ImpersonationEnded: 'impersonation.ended',
  ImpersonationEndRefused: 'impersonation.end.refused',
  ImpersonationStarted: 'impersonation.started',
  ImpersonationStartRefused: 'impersonation.start.refused',
  InvitationRedeemRefused: 'invitation.redeem.refused',
  LeadTimeSampleFailed: 'lead-time sample failed for barber',
  OtpSendFailed: 'otp.send_failed',
  OtpVerifyAdoptionRefused: 'otp.verify.adoption_refused',
  PolicyRecomputeNudged: 'policy recompute nudged',
  PolicyRecomputeStallNotRecorded: 'policy recompute stall not recorded',
  PolicyRecomputeSweepStarted: 'policy recompute started by the sweep: a dropped start',
  ProfileUpdateRefused: 'profile.update.refused',
  RegistrationDisplayNameFailed: 'registration.display_name_failed',
  RhythmRuleWriteFailed: 'rhythm rule write failed',
  TriggerAttemptFailed: 'trigger attempt failed',
  WaitlistBarberSkipped: 'waitlist barber skipped',
  WaitlistMatchFailed: 'waitlist match failed',
} as const;
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
// ('audit entry refused by domain' dies with appendAuditFacts: a refused plan is now a defect)

// entities/audit-entry.entity.ts
export type AuditEntryMeta = {
  readonly id: AuditEntryId;
  readonly recordedAtUtcMs: UtcEpochMs;
  readonly resourceId: AuditResourceId;
  /** The client-minted operation that caused the row (WS-4.4); null for a trigger or backfill row. */
  readonly auditOperationId: OperationId | null;   // automatic single-field index kept — never in fieldOverrides
};

// systems/audit.system.ts
const ROW_BASIS_TAG = 'audit-row/v2';
export type AuditFact = {
  readonly resourceId: AuditResourceId;
  readonly subjects: readonly AuditSubject[];
  /** Never null (RU-41): a booking verb's key derives from its operation id; a failed backfill call's from a minted id. */
  readonly changeKey: string;
  readonly operationId: OperationId | null;          // → every fan-out row's auditOperationId
  readonly context: AuditContext;
};
export type AuditCommit = {
  readonly writes: readonly WriteOp[];               // WriteOp.create([Collections.AuditLog, id], row) per row
  readonly unaudited: readonly AuditFact[];          // facts dropped for want of a verified actor
};
// AuditRowPlan.idBasis: string (was | null — RU-41)
AuditSystem.createsOf(plans: readonly AuditRowPlan[], hash: (input: string) => string): readonly WriteOp[];
//   id = AuditEntryId.of(hash(plan.idBasis))
AuditSystem.commitWrites(facts: readonly AuditFact[], actor: Actor | null, nowUtcMs: UtcEpochMs,
                         hash: (input: string) => string): AuditCommit;
//   actor null → { writes: [], unaudited: facts }; a refused plan → defect (closed verb sets; precedent streak-publish.system.ts:795)
AuditSystem.changeKey = {
  attempt(attemptId: AppointmentId): string,            // `attempt:<id>`
  move(attemptId: ClientOperationId): string,           // `move:<id>`
  staffEdit(operationId: OperationId): string,          // `operation:<id>`
  cancel(operationId: OperationId): string,             // `cancel:<op>`
  transition(operationId: OperationId, seatId: SeatId | null): string, // `transition:<op>` | `transition:<op>:<seatId>`
  arrived(operationId: OperationId): string,            // `arrived:<op>`
  unarrived(operationId: OperationId): string,          // `unarrived:<op>`
  tip(operationId: OperationId, seatId: SeatId): string,// `tip:<op>:<seatId>`
  backfillFailed(mintedId: string): string,             // `backfill-failed:<id>` — run-backfill's FAILED call only (RU-41)
  publish, profile, ownProfileEdit,                     // unchanged
};  // deleted: revision, cancelled, the instant-keyed shapes
AuditSystem.planOwnProfileEdit(ownerUserId, fields, nowUtcMs, operationId: OperationId | null): AuditRowPlan | null;
// plan(): row.auditOperationId = fact.operationId; planProfileChange(): null

// systems/appointment-lifecycle.system.ts
LifecycleTransitionRequest + readonly operationId: OperationId;
cancelByClient(appointment, reason, windowHours, nowUtcMs, operationId: OperationId);
markArrived(appointment, nowUtcMs, operationId: OperationId);
clearArrival(appointment, operationId: OperationId);
// facts keyed by AuditSystem.changeKey.* above and carrying operationId; no instant in any key

// components/audit-context.data.ts
AuditContext.rescheduled(rescheduleRevision: number): AuditContext.Rescheduled;   // loggedOnRetry deleted
```

Pipelines (book, reschedule, edit, cancel, transition, mark-arrival,
record-seat-tip): `XPorts` lose `AuditAppendPorts` (still `&` of named
bundles); the decide step plans `AuditSystem.commitWrites(facts, cmd.actor,
nowUtcMs, ports.hash)` and appends its `writes` LAST to the plan the
transaction commits; `nowUtcMs` is read once before `ports.commit`, so a
contention re-run of `decide` derives identical ids. A replay or
"unchanged" decision plans no audit op (book `Replay`; reschedule `Replay` /
`Unchanged`; edit `Replay` and the `NeedsContacts` first pass; arrival /
clear / tip unchanged; cancel / transition refuse). Each `Decided` drops
`auditFacts` and carries `unaudited`; mark-arrival's answer `unchanged` is
the LIFECYCLE STEP's `writes.length === 0` — never the audit creates, so an
actor-null call that writes the stamp still answers `unchanged: false`,
exactly as today (no departure; DEP-8 withdrawn). After a landed commit
the pipeline calls:

```ts
// booking-read-set.pipeline.ts (replaces appendAuditFacts + AuditWritePorts)
export function logUnaudited(
  ports: LogPorts,
  unaudited: readonly AuditFact[],
): void;
// one ports.log('error', LogEvent.AuditActorMissing, { action: fact.context.auditAction, resourceId: fact.resourceId }) per fact
```

`update-profile.pipeline.ts` and `publish-streak-definition.pipeline.ts`
reuse `AuditSystem.createsOf` (behaviour-neutral; their private copies go);
`streak-publish.system.ts`'s facts carry `operationId:
OperationId.of(requestId)`; `run-backfill` facts carry `operationId: null`
and stay on `appendAudit` (L2; a RETURNED call keeps `backfillChangeKey`,
a FAILED one `changeKey.backfillFailed(ports.nextId())` — RU-41);
`audit-profile-change` rows carry `null`.
Docs: `governance.port.ts:14-22` and `tx.port.ts:19-21` ("the one write
after a commit is the backfill's `appendAudit`"), `telemetry.port.ts:7-9`
(the `LogEvent` dictionary exists; the signature stays verbatim).
`.claude/rules/ecs-pipelines.md` L55-59 → `TxPorts & WalkInKeyPorts &
PolicyReadPorts & AccountContactPorts & TelemetryPorts`; L98-102 → "…plans
its audit rows inside the same decide step (`AuditSystem.commitWrites`), as
`WriteOp.create` entries of the one commit plan…".

A "no audit write outside a CommitPlan" gate (§6.2) allowlists the trigger's
`createAuditRows` and `run-backfill.pipeline.ts`'s `appendAudit`.

### 2.3 WS-7 — reviewable trail (P6)

```ts
// libs/ecs-core/src/ports/audit-read.port.ts (+ ports/index.ts)
export type AuditTimelinePage = Page<AuditEntry, UtcEpochMs>;     // newest first; cursor = beforeRecordedAtUtcMs
export type PageAuditByTargetCustomer = (targetCustomerId: CustomerId, beforeRecordedAtUtcMs: UtcEpochMs | null, limit: number) => Promise<Result<AuditTimelinePage, RepositoryError>>;
export type PageAuditByTargetUser     = (targetUserId: UserId,         beforeRecordedAtUtcMs: UtcEpochMs | null, limit: number) => Promise<Result<AuditTimelinePage, RepositoryError>>;
export type PageAuditByResource       = (resourceId: AuditResourceId,  beforeRecordedAtUtcMs: UtcEpochMs | null, limit: number) => Promise<Result<AuditTimelinePage, RepositoryError>>;
export type PageAuditByActorUser      = (actorUserId: UserId,          beforeRecordedAtUtcMs: UtcEpochMs | null, limit: number) => Promise<Result<AuditTimelinePage, RepositoryError>>;
export type PageAuditByActorAdmin     = (actorAdminUserId: UserId,     beforeRecordedAtUtcMs: UtcEpochMs | null, limit: number) => Promise<Result<AuditTimelinePage, RepositoryError>>;
export type AuditRowsForOperation     = (operationId: OperationId) => Promise<Result<readonly AuditEntry[], RepositoryError>>;
/** The timelines — one equality field + recordedAtUtcMs desc each (the five auditLog composites). */
export type AuditTimelinePorts = {
  readonly pageAuditByTargetCustomer: PageAuditByTargetCustomer;
  readonly pageAuditByTargetUser: PageAuditByTargetUser;
  readonly pageAuditByResource: PageAuditByResource;
  readonly pageAuditByActorUser: PageAuditByActorUser;
  readonly pageAuditByActorAdmin: PageAuditByActorAdmin;
};
/** One operation's rows — equality on auditOperationId (its automatic single-field index), ≤ 50, in AuditSystem.chronological order. */
export type AuditOperationPorts = { readonly auditRowsForOperation: AuditRowsForOperation };
export type AuditReadPorts = AuditTimelinePorts & AuditOperationPorts;
// libs/infrastructure/firebase-app/src/lib/ports.tokens.ts
export const AUDIT_READ_PORTS = new InjectionToken<AuditReadPorts>('AUDIT_READ_PORTS');
// libs/infrastructure/firestore/src/lib/audit.adapter.ts — model client-stats.adapter.ts + appointments.adapter.ts paging
export const auditReadPorts = (db: Firestore): AuditReadPorts;
// where(field,'==',id), where('recordedAtUtcMs','<', before) when given, orderBy('recordedAtUtcMs','desc'), limit(limit + 1);
// PagingSystem.nextCursor / PageStep.Tied / the same-instant boundary (fan-out rows share one instant)
// auditRowsForOperation: where('auditOperationId','==',id), limit(50), then AuditSystem.chronological(rows) —
//   the ordering rule is a system's (OR-18's code-unit tie-break precedent), never the adapter's (Law 4)
// libs/ecs-core/src/systems/audit.system.ts (P6 adds this one function)
AuditSystem.chronological(rows: readonly AuditEntry[]): readonly AuditEntry[];   // recordedAtUtcMs asc, then code-unit id; copies, pure
```

Exported from `firestore.adapters.ts` / `firestore.lazy.ts`; bound in
`app.config.ts` by `provideLazyPort(AUDIT_READ_PORTS, …)` (model `:409-411`);
`memoryAuditReadPorts` in `testing/port-doubles.ts`. No screen consumes it
(the Activity screen is out of scope).

```json
{
  "collectionGroup": "auditLog",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "targetCustomerId", "order": "ASCENDING" },
    { "fieldPath": "recordedAtUtcMs", "order": "DESCENDING" }
  ]
}
// the same for targetUserId, resourceId, actorUserId, actorAdminUserId — 19 → 24 composites; auditOperationId NOT overridden
```

`auditActionsFor` (`resourceId in`, no `orderBy`) keeps its single-field
index; no override touches `resourceId`.

### 2.4 WS-2 — typed deltas (P7)

```ts
// components/reschedule-delta.data.ts
export type RescheduleDelta = {
  readonly rescheduleFromLocalDate: LocalDate;  readonly rescheduleToLocalDate: LocalDate;
  readonly rescheduleFromStartMinutes: MinuteOfDay;  readonly rescheduleToStartMinutes: MinuteOfDay;
  /** Seat order on each side, duplicates kept — positional lists, never id-aligned (a move re-ids cart seats). */
  readonly rescheduleFromBarberIds: readonly BarberId[];  readonly rescheduleToBarberIds: readonly BarberId[];
  readonly rescheduleFromLocationId: LocationId;  readonly rescheduleToLocationId: LocationId;   // RU-11
};
// components/staff-edit-delta.data.ts — every pair null when that dimension is untouched
export type StaffEditDelta = {
  readonly editRepriceFromCents: PriceCents | null;  readonly editRepriceToCents: PriceCents | null;   // bill subtotal
  readonly editCurrency: Currency | null;                                                             // set iff a money field is
  readonly editDiscountFromIds: readonly AppliedDiscountId[] | null;                                   // RU-11
  readonly editDiscountIds: readonly AppliedDiscountId[] | null;                                       // the AFTER set (brief)
  readonly editVoucherDebitCents: PriceCents | null;            // signed net of live redemptions, PriceCents.signed
  readonly editDurationFromMinutes: DurationMinutes | null;  readonly editDurationToMinutes: DurationMinutes | null;
  readonly editRelocateFromLocationId: LocationId | null;  readonly editRelocateToLocationId: LocationId | null;
  readonly editMoveFromLocalDate: LocalDate | null;  readonly editMoveToLocalDate: LocalDate | null;           // RU-11
  readonly editMoveFromStartMinutes: MinuteOfDay | null;  readonly editMoveToStartMinutes: MinuteOfDay | null;
  readonly editRestaffFromBarberIds: readonly BarberId[] | null;  readonly editRestaffToBarberIds: readonly BarberId[] | null;
};
export const StaffEditDelta = { NONE: { /* every field null */ } } as const;
// components/tip-delta.data.ts
export type TipDelta = { readonly tipAmountCents: PriceCents | null; readonly tipFromCents: PriceCents | null; readonly tipCurrency: Currency };
// components/transition-delta.data.ts
export type TransitionDelta = {
  readonly transitionFromBookingStatus: BookingStatus;
  readonly transitionFromStatusAtUtcMs: UtcEpochMs;               // BookingLifecycle.enteredAtUtcMs(before) — what the transition deletes
  readonly transitionFromAttendanceState: AttendanceState | null; // a seat act's prior state; null for the party
};
// components/cancellation-delta.data.ts (RU-11)
export type CancellationDelta = { readonly cancellationFromBookingStatus: BookingStatus; readonly cancellationFromStatusAtUtcMs: UtcEpochMs };

// components/audit-context.data.ts — variants intersect the slices; factories take them
Rescheduled = { auditAction; rescheduleRevision } & RescheduleDelta;   rescheduled(rescheduleRevision, delta)
StaffEdit   = { auditAction; editRevision } & StaffEditDelta;          staffEdit(auditAction, editRevision, delta)
Tip         = { auditAction; tipSeatId } & TipDelta;                   tip(auditAction, tipSeatId, delta)
Transition  = { auditAction; transitionReason; transitionSeatId } & TransitionDelta; transition(auditAction, reason, seatId, delta)
Cancelled   = { auditAction; cancellationReason } & CancellationDelta; cancelled(reason, delta)

// systems/audit-delta.system.ts (+ systems/index.ts) — pure, total, zero extra reads
export const AuditDeltaSystem = {
  rescheduled(before: Appointment, after: Appointment): RescheduleDelta,
  staffEdit(before: Appointment, after: Appointment): StaffEditDelta,   // StaffEditDelta.NONE when nothing differs
  tip(before: Seat, after: Seat): TipDelta,
  transitioned(before: Appointment, seatId: SeatId | null): TransitionDelta,
  cancelled(before: Appointment): CancellationDelta,
} as const;
// reuses BillingSystem.subtotalOf (a !ok subtotal → both price fields null, never defect), BillingSystem.redeemedOf,
// PriceCents.signed, DurationMinutes.sum, BookingLifecycle.enteredAtUtcMs
```

Call sites, all inside the pure decide step: `decideMove` (Moved branch),
`decideEdit` (Edited branch — `after` is already built), the tip decide
(`appointment.seats` vs `tip.value.seats`), `AppointmentLifecycleSystem`
(`transitionAt` and `cancelByClient` build `after` first, then the fact). No
PII: money, time and ids only; no `VoucherCode`, no discount label, no
contact value (R36). `firestore.indexes.json`: one `auditLog` override with
`"indexes": []` per delta field (32 fields).

### 2.5 WS-3 — privileged and governed changes (P8, P9a, P9b)

```ts
// primitives/ids.primitive.ts — AuditResourceId companion (≤ one '/'; casts stay in the file)
forImpersonationSession(id: ImpersonationSessionId): AuditResourceId;   // `impersonationSessions/<id>` (a brand in, like every for*)
// NO forDocument(collection: string, docId: string): a raw string becomes a brand only through parse (Law 7.4) —
// the governed row's resource is AuditResourceId.parse(`<path>/<docId>`) at the wire edge (below)

// components/audit-context.data.ts
AuditAction += GovernanceImpersonationStarted: 'GOVERNANCE_IMPERSONATION_STARTED',
               GovernanceImpersonationEnded:   'GOVERNANCE_IMPERSONATION_ENDED',
               GovernedDocCreated: 'GOVERNED_DOC_CREATED', GovernedDocUpdated: 'GOVERNED_DOC_UPDATED',
               GovernedDocDeleted: 'GOVERNED_DOC_DELETED';
export namespace AuditContext {
  export type ImpersonationStarted = {
    readonly auditAction: typeof AuditAction.GovernanceImpersonationStarted;
    readonly impersonationSessionId: ImpersonationSessionId;
    readonly impersonationScope: ImpersonationScope;
    readonly impersonationExpiresAtUtcMs: UtcEpochMs;
  };
  export type ImpersonationEnded = {
    readonly auditAction: typeof AuditAction.GovernanceImpersonationEnded;
    readonly impersonationSessionId: ImpersonationSessionId;
    readonly impersonationScope: ImpersonationScope;
    readonly impersonationExpiresAtUtcMs: UtcEpochMs;
    readonly impersonationEndReason: ImpersonationEndReason;   // only ADMIN_ENDED / EXPIRED are written (RU-14)
  };
  export type Governed = {
    readonly auditAction: GovernedAction;
    readonly governedCollection: GovernedCollection;     // the whole dictionary (L8 pair line); never USERS on a row (USERS rows are PROFILE_*)
    /** Changed top-level field NAMES, ascending, deduplicated — never a value (R36). */
    readonly governedFields: readonly string[];
  };
  export type Profile = {
    readonly auditAction: ProfileAction;
    readonly profileFields: readonly AuditedProfileField[];             // was RegistrationField[]
    readonly profileRolesFrom: readonly Role[] | null;                  // set iff 'roles' changed (Roles.known)
    readonly profileRolesTo: readonly Role[] | null;
    readonly profileAccountStatusFrom: AccountStatus | null;            // set iff 'accountStatus' changed
    readonly profileAccountStatusTo: AccountStatus | null;
  };
}
// never `reason` / `revocationNotes` (free text, T5/R36); no REVOKED verb; the row is never TTL'd
// components/governed-collection.data.ts — every collection the document-change trigger audits (RU-40)
export const GovernedCollection = { Users: 'USERS', Settings: 'SETTINGS', Services: 'SERVICES', Barbers: 'BARBERS',
  Locations: 'LOCATIONS', BarberSchedules: 'BARBER_SCHEDULES', ScheduleExceptions: 'SCHEDULE_EXCEPTIONS', Coupons: 'COUPONS',
  Positions: 'POSITIONS', Courses: 'COURSES', Events: 'EVENTS', Customers: 'CUSTOMERS', AppointmentNotes: 'APPOINTMENT_NOTES',
  AppointmentPhotos: 'APPOINTMENT_PHOTOS' } as const;
// components/governed-doc-collection.data.ts — the 13 whose writes become GOVERNED_DOC_* rows (model profile-action.data.ts)
export type GovernedDocCollection = typeof GovernedCollection.Settings | … | typeof GovernedCollection.AppointmentPhotos;  // every member but Users
// components/governed-action.data.ts — the three GOVERNED_DOC_* verbs (model profile-action.data.ts)
// components/audited-profile-field.data.ts — RegistrationField's five names + Roles: 'roles', AccountStatus: 'accountStatus'

// systems/audit.system.ts
AUDITED_PROFILE_FIELDS = [firstName, lastName, phone, email, birthDate, roles, accountStatus];  // stored order, appended
comparable(): an empty array is "no value" (the PROVISIONED stub's roles: [] lists nothing)
AuditSystem.writerOf(authType: string, authId: string | null): Actor;                         // was profileWriter (RU-17)
AuditSystem.profileTagDelta(before, after): { profileRolesFrom; profileRolesTo; profileAccountStatusFrom; profileAccountStatusTo };
AuditSystem.changeKey.impersonationStarted(id): `impersonation-start:<id>`;  .impersonationEnded(id): `impersonation-end:<id>`;
AuditSystem.planImpersonationStarted(session: ImpersonationSession, actor: Actor, operationId: OperationId | null): AuditRowPlan;
//   recordedAtUtcMs = startedAtUtcMs
AuditSystem.planImpersonationEnded(session: ImpersonationSession, actor: Actor, operationId: OperationId | null): AuditRowPlan;
//   = endedAtUtcMs; refuses (defect) a non-ENDED session
// both rows: resourceId = AuditResourceId.forImpersonationSession(session.id); ...AuditTargetRef.user(session.targetUserId)
//   (brief: target AuditTargetRef.user(targetUserId) — the row is on WS-7's pageAuditByTargetUser timeline);
//   auditOperationId = operationId (the call's optional transport id, RU-21); a spec pins all three
// the false comment (:149-156) is corrected; ProfileChange gains the four tag fields and
//   readonly governedCollection: typeof GovernedCollection.Users (RU-40)

// systems/governed-change.system.ts (+ systems/index.ts)
export type GovernedChange = {
  readonly eventId: TriggerEventId; readonly eventAtUtcMs: UtcEpochMs | null;
  readonly governedCollection: GovernedDocCollection;
  readonly resourceId: AuditResourceId;            // `<path>/<docId>`, branded at the wire edge (Law 7.4 — never a raw id field)
  readonly targetCustomerId: CustomerId | null;    // the document id for CUSTOMERS only (CustomerId.parse at the edge), else null
  readonly writer: Actor; readonly beforeExists: boolean; readonly afterExists: boolean;
  readonly fields: readonly string[];
};
/** One document write the trigger audits — narrowed with `===` on governedCollection (RU-40). */
export type DocumentChange = ProfileChange | GovernedChange;
export const GovernedChangeSystem = {
  pathOf(governedCollection: GovernedCollection): string,              // exhaustive switch to Collections.* (Users → Collections.Users)
  changedFields(before: StoredFields | null, after: StoredFields | null): readonly string[], // key-sorted stable compare; a delete lists the before-image keys, a create the after-image's
  action(beforeExists: boolean, afterExists: boolean): GovernedAction,
  plan(change: DocumentChange, nowUtcMs: UtcEpochMs): Result<AuditRowPlan | null, GovernanceError.AuditEntryEmptyAction>,
  // USERS → AuditSystem.planProfileChange(change, nowUtcMs) (unchanged behaviour);
  // otherwise: fields [] → ok(null); resource change.resourceId; target change.targetCustomerId === null
  //   ? AuditTargetRef.none() : AuditTargetRef.customer(change.targetCustomerId); changeKey = eventId; auditOperationId null
} as const;
// imports AuditSystem (one way; audit.system.ts never imports this file)

// pipelines
StartImpersonationPorts = CommitPorts & ClockPorts & IdPorts & HashPorts & TelemetryPorts;  // + HashPorts
EndImpersonationPorts   = CommitPorts & ClockPorts & HashPorts & TelemetryPorts;
// plans: [session op, WriteOp.create([Collections.AuditLog, AuditEntryId.of(hash(basis))], row)]; actor Actor.forCaller(adminUserId, adminRoles) (RU-13);
//   operationId = cmd.operationId (P1 adds it to both commands)
// a second end is refused before any plan is built (no audit op, no tripwire)
// pipelines/audit-document-change.pipeline.ts (+ pipelines/index.ts) — REPLACES audit-profile-change.pipeline.ts (RU-40)
export type AuditDocumentChangePorts = AuditRowsPorts & HashPorts & ClockPorts;
export type AuditDocumentChangeAnswer = { readonly rows: number };   // was AuditProfileChangeAnswer
export const auditDocumentChange = (ports: AuditDocumentChangePorts) =>
  async (cmd: DocumentChange): Promise<Result<AuditDocumentChangeAnswer, GovernanceError.AuditEntryEmptyAction | RepositoryError>>;
// GovernedChangeSystem.plan → null → { rows: 0 }; else id = hash(idBasis); createAuditRows (ALREADY_EXISTS = success)
```

Functions (P9b): `wire/triggers.wire.ts` ONE decoder
`decodeDocumentChangeEvent(governedCollection: GovernedCollection, event:
AuthDocumentWriteEvent<{ readonly docId: string }>): DocumentChange` (replaces
`decodeProfileChangeEvent`) over one shared core — `eventId`, `eventAtUtcMs`,
`writer` (`AuditSystem.writerOf(authType, authId)`), both sides' existence;
USERS adds `ownerUserId: UserId.of(docId)`, the profile fields, the four tag
fields and the `profileEditedAtUtcMs` stamps (today's decoder, unchanged);
every other collection adds `resourceId = AuditResourceId.parse(`${pathOf(c)}/${docId}`)`,
`targetCustomerId = CustomerId.parse(docId)` for CUSTOMERS only, and the
changed field names. A `!ok` parse (unreachable: a Firestore path segment is
never empty and holds no `/`) is thrown as a defect inside the trigger's
handler, so `retryingTrigger` judges it PERMANENT. `profileAuditReport` →
`documentAuditReport`. `main.ts` ONE non-exported helper building
`onDocumentWrittenWithAuthContext({ document: `${GovernedChangeSystem.pathOf(c)}/{docId}`,
retry: true }, retryingTrigger({ fn, timeoutSeconds: null }, root.edge, …))`
behind all 14 exports: `auditProfileChanges` (name kept — a deployed
function; its path param `{uid}` → `{docId}`), `auditSettingsChanges`,
`auditServicesChanges`, `auditBarbersChanges`, `auditLocationsChanges`,
`auditBarberSchedulesChanges`, `auditScheduleExceptionsChanges`,
`auditCouponsChanges`, `auditPositionsChanges`, `auditCoursesChanges`,
`auditEventsChanges`, `auditCustomersChanges`, `auditAppointmentNotesChanges`,
`auditAppointmentPhotosChanges`. Never a `{collection}/{docId}` wildcard.
34 → **47** exports.

Rules (P9a):

```
/** A client-minted lifecycle stamp within five minutes of the server's clock (WS-3.4). */
function stampInWindow(ms) {
  return ms is int && math.abs(ms - request.time.toMillis()) <= 300000;
}
match /appointmentNotes/{appointmentId} {
  allow read: if worksTheBook();
  allow create, update: if worksTheBook()
    && request.resource.data.authorUserId == request.auth.uid
    && stampInWindow(request.resource.data.writtenAtUtcMs);
  allow delete: if worksTheBook();          // an empty note deletes the document
}
match /appointmentPhotos/{photoId} {
  allow read: if worksTheBook();
  allow create: if worksTheBook()
    && request.resource.data.takenByUserId == request.auth.uid
    && stampInWindow(request.resource.data.takenAtUtcMs);
  allow update: if false;                   // no update path exists (RU-19)
  allow delete: if worksTheBook();
}
```

`scheduleExceptions`, `customers`, `coupons`: no rules change. L6:
`attachVisitPhoto` reads `ports.nowUtcMs()` again after `uploadPhotoBytes`
succeeds and saves the document with that `takenAtUtcMs` (the Storage
object's `customMetadata` keeps the provisional stamp). Auth custom-claims
changes fire no Firestore trigger: recorded in this plan and runbook §3 as
unaudited until a `setRoles` callable exists.

Indexes (P9b): `auditLog` overrides `"indexes": []` for `governedFields`,
`profileRolesFrom`, `profileRolesTo`, `profileAccountStatusFrom`,
`profileAccountStatusTo`, `impersonationExpiresAtUtcMs` (`governedCollection`,
`impersonationSessionId`, `impersonationScope`, `impersonationEndReason`
keep their single-field index).

### 2.6 WS-4.2–4.6 — correlation, provenance, reference, `LogEvent` (P10–P14)

```ts
// primitives/log-event.data.ts — new values
CallableCompleted: 'callable.completed', CallableRefused: 'callable.refused', CallableFailed: 'callable.failed',
BookingMoveRejected: 'booking.move_rejected', BookingStaffEditRejected: 'booking.staff_edit_rejected',
DocumentVersionsRead: 'document.versions_read',

// ports/telemetry.port.ts (additive; Log and TrackError VERBATIM)
export type LogContext = { readonly [field: string]: string | number | boolean | null | readonly string[] };
export type BindLogContext = <T>(context: LogContext, run: () => Promise<T>) => Promise<T>;
export type AddLogContext = (context: LogContext) => void;
export type LogContextPorts = { readonly bindLogContext: BindLogContext; readonly addLogContext: AddLogContext };
export type LogDigestPorts = { readonly logDigest: KeyedHash };          // KeyedHash of tx.port.ts (WalkInKeyPorts' type)

// systems/canonical-json.system.ts — moved from ClientStatsSystem.canonicalJson, which delegates (its spec unchanged)
CanonicalJsonSystem.of(value: unknown): string;
// systems/log-digest.system.ts
LogDigestSystem.basisOf(command: unknown): string;       // canonical JSON of the ALLOWLISTED projection (RU-23)
LogDigestSystem.digestOf(command: unknown, keyedHash: (input: string) => string): string | null;  // 16 hex; '' hash (empty key) → null
// allowlist (walk records and arrays; keep a key only if listed; keep only string/number/boolean/null leaves):
//   appointmentId, locationId, localDate, startMinutes, endMinutes, seatId, seats, lineId, serviceId, variantId,
//   barberId, barberPreference, toBookingStatus, cancellationReason, markArrivalAction, amountCents, tipCents,
//   expectedVersion, acknowledgedOverlap, commands, editCommand, durationMinutes, priceCents, operationId, attemptId,
//   requestId, streakId, version, baseVersion, backfillJobName, targetUserId, impersonationScope, expiresAtUtcMs,
//   sessionId, ownerUserId, staffPlacement, placement, days, windows
//   (never: contact, label, guestKey, reason, code, codes, rawDestination, rawIdentifier, fields, edits, text, issues)
// systems/decision-input.system.ts
export type SlotFacts = {
  readonly readBusyKeys: readonly BusyKey[];
  readonly collidingStartMinutes: MinuteOfDay | null;
  readonly collidingEndMinutes: EndMinute | null;
  readonly readRevision: number | null;                  // the stored appointment's revision (move / edit)
};
DecisionInputSystem.slotFacts(busyDays: readonly BarberBusyDay[], refusal: { readonly barberId: BarberId; readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay } | null, revision: number | null): SlotFacts;

// components/write-provenance.data.ts (+ components/index.ts)
export type WriteProvenance = { readonly writeOperationId: OperationId | null };
export const WriteProvenance = {
  NONE: { writeOperationId: null } as WriteProvenance,
  of(writeOperationId: OperationId | null): WriteProvenance,
  /** Absent (a document written before WS-4.3) and null are valid; present must be an OperationId. */
  fieldFault(doc: StoredFields): string | null,
} as const;
// entities: Appointment = … & StoodSeatPairs & WriteProvenance;  Customer = CustomerMeta & WriteProvenance (the literal renamed CustomerMeta)
// StoredDocumentSystem: appointmentFault / customerFault call WriteProvenance.fieldFault; busyDayFault unchanged (L5)

// errors/pipeline.error.ts — the web's error carries the call's id
PipelineError + readonly operationId: ClientOperationId | null;     // bare / fromWire → null
PipelineError.withOperation(error: PipelineError, operationId: ClientOperationId | null): PipelineError;

// systems/trigger-attempt.system.ts
AttemptEvent + readonly documentPath: string | null; readonly writeOperationId: OperationId | null;
AttemptLine  + readonly documentPath: string | null; readonly writeOperationId: OperationId | null;
```

Stamping (WS-4.3): every callable write of an appointment sets
`writeOperationId = cmd.operationId` on the op it already plans (book's
Create body; `placementFields(after)` for reschedule / edit; the lifecycle's
`transitionWrite` fields for cancel / transition / arrival / clear;
`withMoreFields` on tip's Update); a replay or unchanged act plans no write
and stamps nothing. Customers created by book / edit carry the op id
(`CustomerRecordSystem.createsFor` / `walkInCreates` take it); registration's
creates carry the call's optional `cmd.operationId` (RU-29; `null` when none
was sent); `runBackfill`'s mirror stamps neither set nor clear the field
(RU-29). `firestore.indexes.json`: `appointments.writeOperationId`
and `customers.writeOperationId` `"indexes": []`. Seeds and fixtures spread
`...WriteProvenance.NONE`.

Functions (P12):

```ts
// edge.ts
export type CallableEdgePorts = EdgePorts & LogContextPorts & LogDigestPorts;   // EdgePorts unchanged
CallableSpec<Out> + readonly traced: boolean;        // false for reportClientIssues only (RU-24)
export type CallTrace = { readonly noteInputDigest: (digest: string | null) => void };
callableEdge(spec, ports: CallableEdgePorts, handle: (request, budget, trace: CallTrace) => Promise<Result<Out, EdgeError>>)
// traced: bindLogContext({ callable, operationId, uid, roles }, …) around handle, where
//   operationId = OPERATION_ID_FIELD[callable] === null ? null : OperationId of ClientOperationId.inPayload(request.data, field)
// one line per invocation: ports.log(level, LogEvent.Callable{Completed|Refused|Failed},
//   { callable, operationId, uid, roles, errorCode, wireStatus, durationMs, inputDigest })
//   completed = info (wireStatus 'ok'); an answered refusal = warn ('ok'); a thrown refusal or a decoder's own HttpsError = warn
//   (its status); unexpected = error ('internal' or the coded failure) — trackError stays once
//   durationMs = UtcEpochMs.elapsedMs(budget.startedAtUtcMs, ports.nowUtcMs())
export function attemptLineFields(line: AttemptLine): Record<string, unknown>;  // + documentPath, writeOperationId
// main.ts
const LOG_DIGEST_KEY = defineSecret('LOG_DIGEST_KEY');   // bound on every onCall but reportClientIssues; WALK_IN_SECRETS gains it
root.edge = { ...telemetry, ...consoleLogContext(), ...logDigestPorts(() => LOG_DIGEST_KEY.value()), nowUtcMs };
// wiredCallable: after a decode, trace.noteInputDigest(LogDigestSystem.digestOf(cmd, root.edge.logDigest))
// adapters/console-telemetry.adapter.ts
export const consoleLogContext = (): LogContextPorts;    // module AsyncLocalStorage (node:async_hooks — a built-in, no dependency)
// log / trackError merge the scope's fields UNDER the call's own; every Error value in fields →
//   { name, code, message: ClientIssueSystem.scrub(message), stack: `<name>: <scrubbed message>` + each frame line through
//   ClientIssueSystem.frame } (RU-38 — R36/T5: a provider's message can embed a phone or an e-mail);
// the REPORTED_ERROR_EVENT branch keeps its whole-entry write (and never gets the scope)
// adapters/crypto.adapter.ts
export const logDigestPorts = (key: () => string): LogDigestPorts;   // hmacSha256Hex(key(), input); '' when the key is empty
// adapters/firestore-tx.adapter.ts — per attempt, the reads' { path, updateTimeMs } (cap 50); after a refused decide:
//   one log('warn', LogEvent.DocumentVersionsRead, { reads }) — no port, no entity field (RU-25).
//   ONLY `snap.ref.path` of each RETURNED snapshot (getAll hits, query hits): never a query's `where` values, never a
//   missed lookup's key (edit-appointment's `giftVouchers where code == <VoucherCode>` is a bearer credential, R36)
// wire/triggers.wire.ts
export function attemptProvenanceOf(event: unknown): { readonly documentPath: string | null; readonly writeOperationId: OperationId | null };
// event.document; data.after ?? data.before's writeOperationId as `OperationId.is(raw) ? raw : null`
//   (the companion's guard — never a cast, Law 7.4; a malformed stored value reads null, never refuses the attempt)
// tools/flags/write-functions-env.mjs EMULATOR_SECRETS + LOG_DIGEST_KEY: a fixed public TEST value
```

Decision inputs (P11b): `bookAppointment`, `rescheduleAppointment`,
`editAppointment` capture the last snapshot in the IMPURE read callback —
`(tx) => readBookingSet(tx, cmd).then((s) => ((lastRead = s), s))` — never
inside `decide`, which stays a pure function of its argument (Law 4: _"the
port takes the pure decision function as a parameter"_; `decide` re-runs on
contention, and the last read is exactly the input the refusing `decide`
saw) and, on a refused commit, log `LogEvent.BookingRejected` / `BookingMoveRejected` /
`BookingStaffEditRejected` with `{ errorCode, ...DecisionInputSystem.slotFacts(…) }`
— flat scalars from the public busy geometry; the error struct and the wire
are untouched (OR-12).

UI reference (P13a, P13b):

```ts
// libs/infrastructure/i18n/src/lib/operation-reference.words.ts (presenter-purity applies; no *.vm.ts — RU-28)
export function operationReferenceWords(
  operationId: ClientOperationId | null,
  translate: TranslateCode,
): { readonly text: string; readonly copiedText: string } | null; // null without an id; the surface prints the id itself
// keys: operation.reference «Код за справка: {{ref}}» / "Reference: {{ref}}";
//       operation.referenceCopied «Кодът е копиран.» / "Reference copied."      (flagged for copy review)
// libs/ui/patterns/src/lib/reference/reference.ts — <ui-reference> (selector ui-reference)
//   inputs uiText, uiValue, uiCopiedText; a mono line, copy on tap (navigator.clipboard.writeText in try/catch), role="status" confirmation
// libs/ui/patterns/src/lib/toast/toast.ts — + uiReferenceText, uiReferenceValue, uiReferenceCopiedText ('' = none), rendering <ui-reference>
```

The callable adapter sets `PipelineError.operationId` from
`OPERATION_ID_FIELD[name]` on every refusal and on the `PIPELINE_UNKNOWN`
branch. Surfaces: the staff toast (`noticeReference` beside `notice`), the
booking review error and the client cancel error — a SIBLING of the existing
paragraph (their `textContent` pins stay). The full id is printed (wrapping
allowed) and copied. No other screen, no `ui-alert` change.

Lint (P14): `tools/lint-rules/no-literal-log-message.mjs` — reports a string
`Literal`, a `TemplateLiteral` or a `+` concatenation containing one as the
2nd argument of a `log(…)` / `x.log(…)` call whose 1st argument is
`'info' | 'warn' | 'error'` (`console`, `Math`, `logger` objects excluded);
registered in `tools/lint-rules/index.mjs`; root `eslint.config.mjs` block on
`**/*.ts` ignoring specs and test support. The emulator-only console OTP line
keeps its text under `// eslint-disable-next-line creativo/no-literal-log-message -- emulator-only QA line, WS-0 keeps it word for word`;
the sink's `line.msg` is a non-literal and is never reported (RU-37).

### 2.7 WS-5 — the sink, extended (P15)

```ts
// components/client-issue.data.ts
ClientIssueKind.CallableTransportFailed = 'CALLABLE_TRANSPORT_FAILED';   // 7th kind; isError stays false (warn)
export type ClientIssue = { …nine fields…,
  readonly operationId: ClientOperationId | null;
  readonly callableName: string | null;          // shape ^[a-z][A-Za-z0-9]*$, cap 64
  readonly callableErrorCode: string | null;     // shape ^[A-Za-z][A-Za-z0-9_./-]*$, cap 64 — never a bare errorCode
};
FIELDS = [...nine, 'operationId', 'callableName', 'callableErrorCode'];   // appended
// systems/client-issue.system.ts
export type TransportIssueInput = { readonly callableName: string; readonly errorName: string | null;
  readonly callableErrorCode: string | null; readonly operationId: ClientOperationId | null; readonly release: string | null };
ClientIssueSystem.composeTransport(input: TransportIssueInput): ClientIssue;   // scrubbedMessage, topFrame, routePattern, documentPath, fieldName null
// compose(): the three new fields null; CAPS += { callableName: 64, callableErrorCode: 64 };
// issueFault / admitBatch (RU-30): the nine OR-34 keys required as today; any subset of the three new keys admitted
//   (each type- and cap-checked when present); any other key refused SHAPE as today; the admitted copy reads an absent
//   new key as null (MAX_BYTES weighed on the payload as sent);
// fingerprint: mixes callableName, callableErrorCode after the seven only when either is non-null; never operationId
// callable-client.adapter.ts
export const callableClientPorts = (functions: Functions, ids: IdPorts, issues: ClientIssuePorts): GatewayPorts;
// a non-Functions throw: reportClientIssues([composeTransport(…)]) ONCE, inside try/catch (never rejects),
// skipped when name === Callables.ReportClientIssues (recursion guard); the answer stays PIPELINE_UNKNOWN
// app.config.ts: callableClientPorts(inject(FIREBASE_FUNCTIONS), inject(ID_PORTS), inject(CLIENT_ISSUE_REPORTER))
```

Size and rate caps (`MAX_ISSUES` 10, `MAX_BYTES` 4096, `MAX_PER_SESSION`
20, the per-instance bucket) are untouched.

### 2.8 WS-6 — backstop (P16, P17)

```ts
// entities/trigger-failure.entity.ts (+ entities/index.ts)
export type TriggerFailureMeta = {
  readonly id: TriggerEventId;                 // the event id = the document id (RU-31)
  readonly fn: string;
  readonly documentPath: string | null;
  readonly attemptOutcome: AttemptOutcome;
  readonly failureCode: string;                // TriggerAttemptSystem's gRPC vocabulary, not an errorCode
  readonly recordedAtUtcMs: UtcEpochMs;
};
export type TriggerFailure = TriggerFailureMeta & WriteProvenance;
// entities/collections.ts: TriggerFailures: 'triggerFailures' (admin-read, server-written, no TTL)
// systems/trigger-attempt.system.ts
TriggerAttemptSystem.RETRY_WINDOW_MS = 86_400_000;  TriggerAttemptSystem.LAST_ATTEMPT_MARGIN_MS = 900_000;
TriggerAttemptSystem.deadLetter(failure: AttemptFailure, ageMs: number | null): boolean;
//   PERMANENT → true; TRANSIENT → ageMs !== null && ageMs >= RETRY_WINDOW_MS − LAST_ATTEMPT_MARGIN_MS
TriggerAttemptSystem.triggerFailure(line: AttemptLine, nowUtcMs: UtcEpochMs): TriggerFailure;
// ports/trigger-failure.port.ts (+ ports/index.ts)
export type WriteTriggerFailure = (failure: TriggerFailure) => Promise<Result<void, RepositoryError>>;
export type TriggerFailurePorts = { readonly writeTriggerFailure: WriteTriggerFailure };
// apps/functions/src/adapters/firestore-trigger-failures.adapter.ts
export const firestoreTriggerFailurePorts = (db: Firestore): TriggerFailurePorts;   // create(); ALREADY_EXISTS = success
// edge.ts
export type TriggerEdgePorts = EdgePorts & TriggerFailurePorts;
// retryingTrigger(spec, ports: TriggerEdgePorts, handle): after the attempt line, when deadLetter(...): write once;
//   a failed write logs LogEvent.TriggerFailureNotRecorded ('trigger.failure_not_recorded') and changes neither verdict nor rethrow
// main.ts: edge gains a LAZY writeTriggerFailure (serverPorts() is built on first use); FirestorePorts & TriggerFailurePorts
```

```
match /triggerFailures/{eventId} { allow read: if isAdmin(); allow write: if false; }
```

No TTL, no index change, no guard (`guardOf` answers `null`), no seed entry.
`logAttempt` (a survived failure) does not dead-letter.

Ops (P17, scripts only, applied by nobody here): `tools/ops/names.env` (one
source of names: `LOG_SINK_NAME=creativo-audit-sink`,
`LOG_BUCKET_ID=creativo-audit-400d`, `LOG_BUCKET_RETENTION_DAYS=400`,
`PITR_DAYS=7`, `BACKUP_RETENTION=28d`, the metric names);
`tools/ops/audit-logs.sh` (Data Access `DATA_WRITE` + `ADMIN_READ` on
`datastore.googleapis.com` — RU-34 — and `identitytoolkit.googleapis.com`,
read-modify-write of `auditConfigs` with node for the JSON, the DATA_WRITE
volume / billing caveat printed first); `tools/ops/log-sink.sh` (a 400-day
bucket and a sink filter — RU-36: the project's Data Access / activity audit
logs OR every Cloud Functions gen-2 log line (`resource.type="cloud_run_revision"`
with the Functions-managed service label), AND `NOT
jsonPayload.clientIssueKind:*`; `--lock` only with the explicit flag);
`tools/ops/firestore-backups.sh` (PITR 7 days, a daily schedule of 28 d, a
describe/list probe before each create); `tools/ops/log-metrics.sh`
(`client_issue_count` moved from runbook §3 step 7, `trigger_attempt_failed`
(labels `outcome`, `fn`), `document_refused`, `audit_actor_missing`,
`callable_failed`; alert policy YAML printed). Every script: `set -euo
pipefail`, dry-run by default printing its gcloud commands and exiting 0,
`--apply` to mutate. Filters use the has-operator
(`jsonPayload.message:"trigger attempt failed"`): the logger rewrites an
ERROR line's `message` to a stack. Every message text a script names is a
`LogEvent` value — `ops-scripts.spec.mjs` reads
`libs/ecs-core/src/primitives/log-event.data.ts` with `readFileSync` and
fails on any `jsonPayload.message:"…"` text or metric source that is not
one of its values (a rename in the dictionary cannot silently kill an alert). Preflight: `CHECKS.P9 = 'the platform
backstops (PITR, backups, audit sink, locked bucket) — informational'`,
`SUBJECTS.P9 = 'the platform backstops'`, `SCOPES.functions` + `P9`,
`READS_PROJECT` + `P9`; `checkBackstops({ pitr, backups, sink, bucket })`
answers PASS with four `INFO` lines; a read error is an `INFO … unreadable`
line. Retention policy (runbook new §2.5): `auditLog` and `triggerFailures`
indefinite (never TTL'd), `clientJournal` as today (no TTL), the seven TTLs,
logs `_Default` 30 d and the audit bucket 400 d, legal hold as an owner
procedure.

---

## 3. Packages — waves and DISJOINT file ownership

Rules for every package: re-read each site before editing; NEVER git
commit, push, stash, checkout, reset, switch or worktree-add (only the
orchestrator commits); undo your own edit by the inverse edit; `git grep`
misses untracked files (`grep -r` for new files and renames); never `pnpm
install/add/remove`, never `nx reset`; never run an emulator journey
(`verify:p0`, `test:emulator`, `e2e:web`, `verify:csp`) — the orchestrator
runs them, one at a time; never run the runbook grep gates themselves (they
write a canary into the repo, which the wave partner's lint would read) —
the "name check" below sources the §4.0 arrays from a scratch copy OUTSIDE
the repo and runs EACH array with the flags its gate uses (`-wF` for the
`W*` / `M*` / `T*` / `R9` lists, `-F` for `K*` / `S2` / `F2` and the
`'status'` / `['status']` pair) over the package's ADDED text — the `^+`
lines of `git diff -U0` of its tracked files plus every line of its new
untracked files — never over identifiers only (the gates forbid fixed
strings such as `'status'`, `hours:`, `expiresAt:` inside STORE paths,
`tools/verify/**` and the `*profile*` / `*impersonation*` globs included);
a spec or script reads a root file (`firestore.indexes.json`,
`firestore.rules`, `tools/ops/*`, `log-event.data.ts`) with
`readFileSync(new URL('…', import.meta.url))` or `resolve(…)` — a plain
path, never an `import … from '../../../…'` (Law 8.3, `check-layering.mjs`
check (d)); typecheck is
project-scoped (`pnpm nx run <project>:typecheck --skip-nx-cache`) —
`rm -rf dist/out-tsc && run-many -t typecheck` is the orchestrator's. A file
not in a package's list is not its to edit: a forced edit elsewhere is
reported, never made. **At most two builders run at a time**; a wave lists
its packages; the next wave starts when both are back and the orchestrator
has checked the tree. Emulator-only specs a package writes (`*.integration.spec.ts`,
the rules spec) are typechecked by the builder and run by the orchestrator
(`pnpm run test:emulator`) at the stage boundary.

| Stage (commit)                    | Waves (≤ 2 builders)                                                   | Commit boundary                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C0 — WS-0                         | P0 (orchestrator)                                                      | committed `1f027ee`; draft PR opened                                                                                                                       |
| C1 — WS-4.1                       | W1a: P1 · W1b: P2 ‖ P3                                                 | one commit after W1b + gate                                                                                                                                |
| C2 — WS-1 + WS-4.4 (shared files) | W2a: P4 (one agent, or P4-prod ‖ P4-spec) · W2b: P5                    | WS-1 and WS-4.4 share `audit.system.ts`, `audit-entry.entity.ts` and the seven pipelines → ONE commit (two ledger rows, one sha), gated on exactly P4 + P5 |
| C2′ — WS-7                        | W2c: P6 (after C2: it types against P4's `auditOperationId`)           | its own commit, gated on its own tree                                                                                                                      |
| C3 — WS-2                         | W3: P7                                                                 | P7's files; the gated tree is the committed tree                                                                                                           |
| C4 — WS-3                         | W4: P8 ‖ P9a · W5: P9b                                                 | P8 + P9a + P9b files (P8 and P9a are disjoint: ecs-core vs rules / rules specs / the photo pipeline)                                                       |
| C5 — WS-4.2–4.6                   | W6a: P10 ‖ P13a · W6b: P11a ‖ P12 · W6c: P11b ‖ P11c · W6d: P13b ‖ P14 | one commit after W6d + gate                                                                                                                                |
| C6 — WS-5                         | W7: P15                                                                | P15's files; the gated tree is the committed tree                                                                                                          |
| C7 — WS-6                         | W8: P16 ‖ P17                                                          | P16 + P17 (disjoint: ecs-core / functions / rules vs `tools/ops`, preflight, docs)                                                                         |

Every commit's gate runs on exactly the tree it commits: no wave of the
next workstream starts before the previous stage is committed.

`git fetch origin` and a merge of `origin/main` (never a rebase) before each
stage; shared files (`main.ts`, `firestore.rules`, `firestore.indexes.json`,
HANDOFF, the runbook) keep both sides' intent.

### P0 — WS-0: the OTP sender gated to the emulator (orchestrator; committed `1f027ee`)

- **Files:** `apps/functions/src/edge.ts`, `edge.spec.ts`, `main.ts`,
  `main.spec.ts`, `wire/identity.wire.ts`, `wire/identity.wire.spec.ts`,
  `adapters/refusing-otp-sender.adapter.ts` (new), `adapters/refusing-otp-sender.adapter.spec.ts`
  (new); `libs/ecs-core/src/errors/identity.error.ts`, `identity.error.spec.ts`,
  `errors/pipeline.error.ts` (the `SendOtp` comment at `:11` only),
  `ports/identity.port.ts`, `pipelines/request-otp.pipeline.ts`,
  `request-otp.pipeline.spec.ts`; `libs/features/client/auth/src/lib/auth-flow.store.spec.ts`;
  `libs/infrastructure/i18n/src/assets/i18n/{bg,en}.json`,
  `i18n/src/lib/translate-coded-error.spec.ts`, `word-flow-failure.spec.ts`,
  `word-pipeline-error.spec.ts`; `tools/verify/preflight/preflight.mjs`,
  `preflight.spec.mjs`, `tools/verify/project.json`;
  `docs/production-deploy.md`, `docs/architecture/firestore-runbook.md`
  (P7/P8 table, deploy step), `docs/architecture/HANDOFF.md` (§4 prose).
- **Brief:** §2.0. P8 shares P7's traversal; P7's exported name, words and
  every asserted string stay byte-identical; the real-tree pin asserts P7
  PASS and P8 FAIL naming `refusingOtpSender (@launchBlocker, …refusing-otp-sender.adapter.ts)`,
  then mutates `refusingOtpSender()` → `transactionalOtpSender()` (P8 PASS)
  and re-ungates the console line (P7 FAIL). The `main.spec.ts` case reaches
  `sendOtp` through the pipeline seam with `FUNCTIONS_EMULATOR` unset and
  asserts the console adapter is never constructed.
- **Checks:** `pnpm nx test functions`, `pnpm nx test ecs-core`, `pnpm nx
test i18n`, `pnpm nx test client-auth`, `pnpm nx test verify-tools`;
  typecheck `functions`, `ecs-core`, `i18n`, `client-auth`; lint the same;
  the RU-2 grep; name check (`refusingOtpSender`, `OtpSendUnavailable`).

### P1 — WS-4.1 ecs-core contracts and commands (W1a)

- **Files:** `libs/ecs-core/src/primitives/ids.primitive.ts`, `ids.primitive.spec.ts`;
  `components/booking-call.data.ts`, `booking-call.data.spec.ts`;
  `ports/callables.ts`, `ports/callables.spec.ts` (new), `ports/visit-edit.port.ts`;
  `pipelines/book-appointment.pipeline.ts`, `cancel-appointment.pipeline.ts`,
  `edit-appointment.pipeline.ts`, `mark-arrival.pipeline.ts`,
  `record-seat-tip.pipeline.ts`, `reschedule-appointment.pipeline.ts`,
  `transition-appointment.pipeline.ts`, `update-profile.pipeline.ts`,
  `save-visit-edit.pipeline.ts`, and — the command type only, `+ operationId:
OperationId | null` (RU-21) — `start-impersonation.pipeline.ts`,
  `end-impersonation.pipeline.ts`, `complete-registration.pipeline.ts`; the
  twelve `*.pipeline.spec.ts` beside them (command fixtures only for the last
  three); `testing/port-doubles.ts`, `testing/port-doubles.spec.ts`;
  `testing/booking-core.fixtures.ts` (only if it builds one of the commands).
- **Brief:** §2.1 (ecs-core half). Commands gain the fields; branches that
  stop compiling go; NO audit key changes (keys of today's replays stay
  byte-identical — assert that in each verb's spec). `OPERATION_ID_FIELD` is
  total by its mapped type; its spec pins the three non-`operationId` rows.
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx run ecs-core:typecheck --skip-nx-cache`,
  `pnpm nx lint ecs-core`, `pnpm nx run verify-tools:layering --skip-nx-cache`;
  name check. Downstream `functions` / web projects are red until W1b — expected.

### P2 — WS-4.1 functions decoders (W1b)

- **Files:** `apps/functions/src/wire/wire-read.ts`, `wire/booking.wire.ts`,
  `booking.wire.spec.ts`, `wire/identity.wire.ts`, `identity.wire.spec.ts`
  (`decodeUpdateProfile` and `decodeCompleteRegistration` read the optional
  id), `wire/governance.wire.ts`, `governance.wire.spec.ts`
  (`decodeStartImpersonation` / `decodeEndImpersonation` read the optional
  id — RU-21), `main.spec.ts` (the `caseOf` inputs only);
  `apps/functions/src/integration/book-appointment.integration.spec.ts`,
  `cancel-appointment.integration.spec.ts`, `edit-appointment.integration.spec.ts`,
  `reschedule-appointment.integration.spec.ts`, `coupon-grant-burn.integration.spec.ts`,
  `project-client-stats.integration.spec.ts`, `update-profile.integration.spec.ts`,
  and — their command literals gain `operationId: null` (RU-21, type-forced) —
  `impersonation.integration.spec.ts` (`:98`, `:122`, `:143`),
  `complete-registration.integration.spec.ts` (`command()`, `:83-94`);
  `tools/verify/p0/verify-p0.mjs`.
- **Brief:** §2.1 wire table. Book uses `AppointmentId.parse` after the
  shape guard; P0's `staffMove` takes an id and check (d) sends two fresh
  ids, its assertions unchanged.
- **Checks:** `pnpm nx test functions`, `pnpm nx run functions:typecheck --skip-nx-cache`,
  `pnpm nx lint functions`, `node --check tools/verify/p0/verify-p0.mjs`;
  name check (`operationIdOf`).

### P3 — WS-4.1 web minting (W1b)

- **Files:** `libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts`,
  `callable-client.adapter.spec.ts`; `apps/web/src/app/app.config.ts`;
  `libs/infrastructure/firestore/src/lib/streak-publish.adapter.spec.ts`
  (constructor call); `libs/features/staff/dashboard/src/lib/staff-day.store.ts`,
  `staff-day.store.spec.ts`, `staff-dashboard/staff-dashboard.ts`,
  `staff-dashboard/staff-dashboard.spec.ts`;
  `libs/features/client/appointments/src/lib/appointments.store.ts`,
  `appointments.store.spec.ts`, `client-appointments/client-appointments.spec.ts`;
  `libs/features/client/booking/src/lib/booking-flow.store.ts`, `booking-flow.store.spec.ts`.
- **Brief:** §2.1 web half. Each new mint refuses a bad id client-side; a
  genuine second tap mints a new id (no unsettled-name memory for these
  verbs — R7, noted).
- **Checks:** `pnpm nx test firebase-app staff-dashboard client-appointments client-booking web firestore`
  (one `run-many -t test -p …`), typecheck and lint of those projects; name check.

### P4 — WS-1 + WS-4.4 ecs-core (W2a) — the pass's largest package

- **Files:** `libs/ecs-core/src/primitives/log-event.data.ts` (new),
  `log-event.data.spec.ts` (new), `primitives/index.ts`;
  `entities/audit-entry.entity.ts`, `entities/identity-entities.type-spec.ts`;
  `components/audit-context.data.ts`, `audit-context.data.spec.ts`;
  `systems/audit.system.ts`, `audit.system.spec.ts`,
  `systems/appointment-lifecycle.system.ts`, `appointment-lifecycle.system.spec.ts`,
  `systems/streak-publish.system.ts`, `streak-publish.system.spec.ts`;
  `pipelines/booking-read-set.pipeline.ts`, `book-appointment.pipeline.ts`,
  `cancel-appointment.pipeline.ts`, `edit-appointment.pipeline.ts`,
  `mark-arrival.pipeline.ts`, `record-seat-tip.pipeline.ts`,
  `reschedule-appointment.pipeline.ts`, `transition-appointment.pipeline.ts`,
  `update-profile.pipeline.ts`, `publish-streak-definition.pipeline.ts`,
  `run-backfill.pipeline.ts` (RU-41: the FAILED call's key, the `nextId`
  branch gone), `audit-profile-change.pipeline.ts` and their
  twelve `*.pipeline.spec.ts`; `systems/billing.system.spec.ts`,
  `systems/cancellation-policy.system.spec.ts` (the lifecycle call sites only:
  `operationId: OPERATION_ID` in the `LifecycleTransitionRequest` literals at
  `billing…:198-207`, `:300-308`, `cancellation-policy…:446-455`,
  `:557-566`, and `cancelByClient`'s fifth argument at `:373-378` —
  type-forced, assertions unchanged); `ports/governance.port.ts`, `ports/tx.port.ts`,
  `ports/telemetry.port.ts` (docs only); `testing/test-support.ts` (only the
  audit doubles, if a rig needs it).
- **Brief:** §2.2. Audit creates last in every plan. Per verb, the spec
  proves: the committed plan holds exactly the rows (ids `hash(rowBasis(…))`
  with `'audit-row/v2'`, actor, context, target, `auditOperationId`); the
  same command twice → zero audit ops, same ids / revision (`replayed` /
  `unchanged` true; cancel / transition the same refusal); `actor: null` →
  the act commits, no row, one `LogEvent.AuditActorMissing` error line; a
  forced collision → `REPOSITORY_ALREADY_EXISTS` and nothing applied; a
  re-run of `decide` → identical ids. `createsOf` / `commitWrites` purity
  specs (`deepFreeze`). The orchestrator may run this package as two agents
  in one wave (P4-prod: production files; P4-spec: the specs) when it
  prefers; their union is this list.
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx run ecs-core:typecheck --skip-nx-cache`,
  `pnpm nx lint ecs-core`, layering; name check. `functions`, `firestore`
  (rules spec) and `tools/verify/p0` follow in P5.

### P5 — WS-1 + WS-4.4 consequences outside ecs-core (W2b)

- **Files:** `apps/functions/src/adapters/firestore-audit.adapter.ts` (docs),
  `firestore-audit.adapter.spec.ts`, `firestore-audit.adapter.integration.spec.ts`;
  `apps/functions/src/integration/book-appointment.integration.spec.ts`,
  `cancel-appointment.integration.spec.ts`, `edit-appointment.integration.spec.ts`,
  `reschedule-appointment.integration.spec.ts`, `coupon-grant-burn.integration.spec.ts`,
  `project-client-stats.integration.spec.ts`, `update-profile.integration.spec.ts`,
  `publish-streak-definition.integration.spec.ts`,
  `audit-in-commit.integration.spec.ts` (new); `apps/functions/src/main.spec.ts`
  (only if a port-key list moves); `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`
  (the `auditLog` row literal only); `tools/verify/p0/verify-p0.mjs` (only
  if a row assertion needs the new field); `.claude/rules/ecs-pipelines.md`
  (L55-59, L98-102); `docs/architecture/firestore-runbook.md` (§1.1
  `auditLog` row: writers = the seven pipelines' commit plans, `appendAudit`
  = backfill only, the profile and governed triggers).
- **Brief:** §2.2 consequences. The new integration spec, per verb against
  the emulator's real `firestoreCommitPlan`: a committed act has exactly its
  rows; a commit that fails (an `auditLog/<id>` seeded first → `alreadyExists`)
  writes no row and no other document; a replay writes no second row
  (transition / arrival / tip get their first integration cases). It
  asserts rows through counts, `auditAction`, ids and `AuditSystem`-built
  expectations — never hand-built `AuditContext.*` contexts — so P7's
  widened factories (W3) do not silently break it.
- **Checks:** `pnpm nx test functions`, typecheck `functions` and `firestore`,
  lint both; `node --check tools/verify/p0/verify-p0.mjs`. Orchestrator:
  `test:emulator`, `verify:p0` after W2b.

### P6 — WS-7 the reviewable trail (W2c, after C2)

- **Files:** `libs/ecs-core/src/ports/audit-read.port.ts` (new), `ports/index.ts`,
  `ports/audit-read.port.type-spec.ts` (new: the `&` of the two bundles,
  no `Pick`/`Omit`); `libs/ecs-core/src/systems/audit.system.ts` and
  `audit.system.spec.ts` (`AuditSystem.chronological` and its own
  describe only — pure, `deepFreeze` purity case, ties by code-unit id);
  `libs/ecs-core/src/testing/port-doubles.ts`,
  `port-doubles.spec.ts` (`memoryAuditReadPorts`);
  `libs/infrastructure/firestore/src/lib/audit.adapter.ts` (new),
  `audit.adapter.spec.ts` (new), `audit.adapter.integration.spec.ts` (new),
  `firestore.adapters.ts`, `firestore.lazy.ts`;
  `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`;
  `apps/web/src/app/app.config.ts`; `firestore.indexes.json`;
  `tools/verify/indexes/audit-indexes.spec.mjs` (new: the five composites
  with `recordedAtUtcMs` DESC last; `auditOperationId` and `resourceId` in
  no override; reads the file with `readFileSync`, never an import);
  `tools/verify/project.json` (`test.inputs` +
  `{workspaceRoot}/firestore.indexes.json`, so P7 / P9b / P11a's index edits
  invalidate the cached spec); `docs/production-deploy.md` ("all 19" → 24);
  `docs/architecture/firestore-runbook.md` (index list, new descriptive
  names — never reuse `#20`/`#21`).
- **Brief:** §2.3. The integration spec seeds raw, untyped bodies through
  `withSecurityRulesDisabled` (so it does not depend on P4's entity field),
  runs every query as `admin` and `sysadmin` (newest first, cursors, a
  same-instant tie across a page boundary, empty) and as barber /
  receptionist / client / content_manager / anonymous (every query refused);
  its header says the emulator cannot prove composites (P3 / deploy do).
  P6 starts after C2, so every typed `AuditEntry` it builds (the
  `memoryAuditReadPorts` cases, `audit.adapter.spec.ts`) carries P4's
  `auditOperationId` (`null` unless the case is about it).
- **Checks:** `pnpm nx test ecs-core firestore firebase-app web verify-tools`,
  typecheck and lint of those; layering; name check.

### P7 — WS-2 typed deltas (W3)

- **Files:** `libs/ecs-core/src/components/reschedule-delta.data.ts`,
  `staff-edit-delta.data.ts`, `tip-delta.data.ts`, `transition-delta.data.ts`,
  `cancellation-delta.data.ts` (all new), `components/index.ts`,
  `components/audit-context.data.ts`, `audit-context.data.spec.ts`;
  `systems/audit-delta.system.ts` (new), `audit-delta.system.spec.ts` (new),
  `systems/index.ts`, `systems/appointment-lifecycle.system.ts`,
  `appointment-lifecycle.system.spec.ts`; `systems/audit.system.spec.ts`
  (the `fact()` helper at `:69-77` and the transition block at `:332-353`
  only — the factories gain their delta argument);
  `entities/identity-entities.type-spec.ts`;
  `components/identity-dictionaries.type-spec.ts` (L8 pair lines for the
  non-null tag fields `transitionFromBookingStatus` and
  `cancellationFromBookingStatus`, each `// N15-exempt: the before-value of a
transition (role-prefixed)`; the nullable `transitionFromAttendanceState`
  is pinned `AttendanceState | null` in the entity type-spec);
  `pipelines/reschedule-appointment.pipeline.ts`, `edit-appointment.pipeline.ts`,
  `record-seat-tip.pipeline.ts` and their specs, `transition-appointment.pipeline.spec.ts`,
  `cancel-appointment.pipeline.spec.ts`;
  `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`
  (the `auditLog — admins read…` row literal at `:1811-1818` only:
  `AuditContext.cancelled(reason, delta)`); `firestore.indexes.json`;
  `docs/architecture/firestore-runbook.md` (§1.1 `auditLog` row: the delta
  fields).
- **Brief:** §2.4. The comments "the act, never the amount"
  (`audit-context.data.ts:236`, `record-seat-tip.pipeline.ts:25`) are
  corrected. Type-spec: `AuditEntry` not `never`, every variant flat, the
  slices disjoint, each verb narrows to its delta fields
  (`@ts-expect-error` on another verb's field).
- **Checks:** `pnpm nx test ecs-core lint-rules`, typecheck `ecs-core` and
  `firestore`, lint, layering; JSON parse of `firestore.indexes.json`; name
  check. Orchestrator: `test:emulator` at C3 (the reschedule, edit and cancel
  integration specs commit the new rows).

### P8 — WS-3 ecs-core (W4)

- **Files:** `libs/ecs-core/src/primitives/ids.primitive.ts`, `ids.primitive.spec.ts`;
  `components/audit-context.data.ts`, `audit-context.data.spec.ts`,
  `components/governed-collection.data.ts` (new), `governed-collection.data.spec.ts`
  (new — parity with `Collections`, USERS included), `components/governed-doc-collection.data.ts`
  (new — the 13-member subset), `components/governed-action.data.ts` (new),
  `components/audited-profile-field.data.ts` (new), `components/index.ts`,
  `components/identity-dictionaries.type-spec.ts` (the L8 pair lines:
  `AuditContext.Governed['governedCollection']`,
  `AuditContext.ImpersonationEnded['impersonationEndReason']` — both by
  their whole dictionary, no exemption; the nullable `profileRolesFrom/To`
  and `profileAccountStatusFrom/To` pinned `… | null` in the entity
  type-spec);
  `systems/audit.system.ts`, `audit.system.spec.ts`,
  `systems/governed-change.system.ts` (new), `governed-change.system.spec.ts`
  (new), `systems/index.ts`; `entities/identity-entities.type-spec.ts`;
  `pipelines/start-impersonation.pipeline.ts`, `start-impersonation.pipeline.spec.ts`,
  `end-impersonation.pipeline.ts`, `end-impersonation.pipeline.spec.ts`,
  `audit-document-change.pipeline.ts` (new), `audit-document-change.pipeline.spec.ts`
  (new — every case of the old spec moved unchanged, its `changeOf` fixture
  gaining `governedCollection: GovernedCollection.Users` and the four tag
  fields as `null`, `rowOf` following the new `Profile` shape; plus the
  governed cases), `audit-profile-change.pipeline.ts` and
  `audit-profile-change.pipeline.spec.ts` (deleted — RU-40),
  `pipelines/index.ts`, `complete-registration.pipeline.spec.ts`;
  `ports/governance.port.ts` (the `:27` comment naming `auditProfileChange` only).
- **Brief:** §2.5 ecs-core half. Specs: no `reason` / `revocationNotes`
  bytes anywhere in an impersonation row (a distinctive reason string
  scanned in the JSON); each impersonation row's `resourceId`
  (`forImpersonationSession`), target (`AuditTargetRef.user(targetUserId)`)
  and `auditOperationId` (the command's id, and `null` without one);
  sysadmin vs admin attribution; only `ADMIN_ENDED` / `EXPIRED` ever on an
  ENDED row; `changedFields` (map key reorder is no change, an emptied list
  is a change, delete lists the before-image keys); a USERS change plans
  exactly what `planProfileChange` plans; a CUSTOMERS change targets
  `targetCustomerId`, every other collection `none()`; a fast-check "no
  value leaks" property; purity (`deepFreeze`) for `GovernedChangeSystem`
  and for the extended `AuditSystem.profileTagDelta` and `writerOf`.
- **Checks:** `pnpm nx test ecs-core`, typecheck, lint, layering; name
  check. `functions` (`triggers.wire.ts` names `profileWriter` and
  `AuditProfileChangeAnswer`, `main.ts` imports `auditProfileChange`) is red
  until P9b.

### P9a — WS-3 rules and the photo stamp (W4, beside P8; committed with C4)

- **Files:** `firestore.rules`; `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`;
  `libs/infrastructure/firestore/src/lib/visit-media-writers.integration.spec.ts`
  (new — the live writers' bodies under the rules: the notes adapter
  itself, and photo bodies built by `attachVisitPhoto` / `adoptVisitPhoto`
  over memory ports with the clock at `emulatorNowMs()` and `takenByUserId`
  the caller, written with the storage adapter's own
  `setDoc(doc(db, 'appointmentPhotos', id), body)` line — `test:emulator`
  runs no Storage emulator);
  `libs/infrastructure/firestore/src/lib/stamp-window.rules-text.spec.ts`
  (new — pure: reads `firestore.rules` with `readFileSync`, pins
  `stampInWindow`'s text, the `300000` literal and its two call sites);
  `libs/ecs-core/src/pipelines/attach-visit-photo.pipeline.ts`,
  `attach-visit-photo.pipeline.spec.ts`; `libs/infrastructure/storage/src/lib/appointment-photos.adapter.ts`
  (doc comment on the provisional metadata stamp only).
- **Brief:** §2.5 rules + L6 + RU-18. Rules cases: forged author, `null`
  author, −301 s, +301 s, ±360 s, a non-integer stamp refused; 0 s and
  ±240 s accepted; delete allowed to `worksTheBook()` (a non-author
  included); `content_manager` / client / anonymous refused; photo update
  refused; the `scheduleExceptions` positive staff write + delete case
  (barber allowed, content manager refused). The photos block's
  `SEPT_FIRST` stamp and its role-refusal bodies are made valid for THAT
  caller so each refusal is for its stated reason.
- **Checks:** `pnpm nx test ecs-core firestore storage`, typecheck and lint
  of those; name check (`stampInWindow`). Orchestrator: `test:emulator`.

### P9b — WS-3 functions wiring (W5)

- **Files:** `apps/functions/src/main.ts`, `main.spec.ts`;
  `wire/triggers.wire.ts`, `triggers.wire.spec.ts`;
  `apps/functions/src/integration/impersonation.integration.spec.ts`,
  `governed-audit.integration.spec.ts` (new — the decoder + pipeline over
  the emulator, a note, a photo, a customer, an exception and one DELETE;
  redelivery idempotent); `firestore.indexes.json`;
  `docs/architecture/firestore-runbook.md` (§1.1: an `Audit` column —
  `trg users`, `trg gov`, `pl <file>`, `none (console)` — for every row,
  with a legend saying how the writer is attributed: a browser write is
  `USER` with no role snapshot (an auditor never reads `USER` as "client"),
  an Admin-SDK / console write `SYSTEM` / `ADMIN_SDK`, a pipeline's human
  writer is its own row; `impersonationSessions` and `auditLog` writers;
  §3: Auth custom claims unaudited until a `setRoles` callable);
  `docs/production-deploy.md` (the 13 new functions; the rules change; one
  §2 sentence: the bootstrap's catalogue, settings and `users.roles` writes
  happen before the first functions deploy and leave no governed or profile
  row, later console edits are recorded as `SYSTEM` / `ADMIN_SDK`).
- **Brief:** §2.5 functions half (RU-40: ONE decoder, ONE helper).
  `main.spec.ts`: title and length 34 → 47, 13 new `ENDPOINTS` rows
  (`withAuthContext`, `retry: true`, `<collection>/{docId}`) and the
  `auditProfileChanges` row's path `users/{uid}` → `users/{docId}`, 13
  `FLIPPED` cases, `seam.PIPELINES` `auditProfileChange` →
  `auditDocumentChange`, the history comment, and a generated check that
  every `GovernedCollection` member (USERS included) has exactly one export
  on its `Collections` path. `triggers.wire.spec.ts`: the
  `decodeProfileChangeEvent` cases re-pointed to
  `decodeDocumentChangeEvent(GovernedCollection.Users, …)` with their
  expectations unchanged but for `governedCollection`, `roles` /
  `accountStatus` and the four tag fields; `decodeDocumentChangeEvent` as an
  `it.each` over the 13 other members — create, update, delete (fields from
  the before-image), an absent `authId`, each `authType`, an unreadable
  `time`; a CUSTOMERS event yields a branded `targetCustomerId`, every
  other member `null`; the resource is `<path>/<docId>`.
- **Checks:** `pnpm nx test functions`, typecheck, lint; JSON parse of the
  indexes; name check. Orchestrator: `test:emulator`, then `verify:p0` and
  `e2e:web` (the 13 triggers fire on every seeded document — longer settle).

### P10 — WS-4.2/4.3 ecs-core additive contracts (W6a)

- **Files:** `libs/ecs-core/src/primitives/log-event.data.ts`, `log-event.data.spec.ts`;
  `ports/telemetry.port.ts`; `systems/canonical-json.system.ts` (new),
  `canonical-json.system.spec.ts` (new), `systems/client-stats.system.ts`
  (delegation only), `systems/log-digest.system.ts` (new),
  `log-digest.system.spec.ts` (new), `systems/decision-input.system.ts`
  (new), `decision-input.system.spec.ts` (new), `systems/index.ts`;
  `components/write-provenance.data.ts` (new), `write-provenance.data.spec.ts`
  (new), `components/index.ts`.
- **Brief:** §2.6 contracts — additive only: no entity, no caller changes.
  `log-digest` spec: sentinel contact / label / code / reason values
  never appear in the basis; same basis → same digest; purity. Every new
  system spec carries `is pure: same input → same output, inputs untouched`
  (`deepFreeze`, Law 3 / `ecs-systems.md`): `canonical-json` (plus key-order
  independence), `log-digest`, `decision-input` (plus boundary cases: no
  busy day, a refusal with no collision, minute 0 and minute 1439).
- **Checks:** `pnpm nx test ecs-core`, typecheck, lint, layering; name check.

### P11a — WS-4.3 provenance core (W6b)

- **Files:** `libs/ecs-core/src/entities/appointment.entity.ts`, `customer.entity.ts`,
  `appointment-entities.type-spec.ts`, `identity-entities.type-spec.ts`;
  `systems/stored-document.system.ts`, `stored-document.system.spec.ts`,
  `systems/customer-record.system.ts`, `customer-record.system.spec.ts`,
  `systems/booking-decision.system.ts`, `booking-decision.system.spec.ts`;
  `testing/appointment.fixtures.ts`, `testing/identity.fixtures.ts`;
  `pipelines/booking-read-set.pipeline.ts`, `booking-read-set.pipeline.spec.ts`,
  `book-appointment.pipeline.ts`, `book-appointment.pipeline.spec.ts`,
  `edit-appointment.pipeline.ts`, `edit-appointment.pipeline.spec.ts`,
  `reschedule-appointment.pipeline.ts`, `reschedule-appointment.pipeline.spec.ts`,
  `complete-registration.pipeline.ts`, `complete-registration.pipeline.spec.ts`;
  `firestore.indexes.json`; `.claude/rules/ecs-components.md` (the
  "intersects seven slices" sentence), `.claude/rules/firestore-layout.md`
  (the stored layout example and "seven flat slices").
- **Brief:** §2.6 stamping for book / reschedule / edit and the customer
  creates (registration's with `cmd.operationId`, RU-29); guards admit absent / `null` / valid and refuse anything else
  (`REPOSITORY_MALFORMED`, `writeOperationId`); an extra key on a busy day
  stays admitted (L5, spec'd).
- **Checks:** `pnpm nx test ecs-core`, typecheck, lint, layering; name check.
  Seeds / e2e / client-card fixtures are red until P11c — expected.

### P12 — WS-4.2/4.3/4.6 functions (W6b, beside P11a)

- **Files:** `apps/functions/src/edge.ts`, `edge.spec.ts`, `main.ts`, `main.spec.ts`;
  `adapters/console-telemetry.adapter.ts`, `console-telemetry.adapter.spec.ts`,
  `adapters/crypto.adapter.ts`, `crypto.adapter.spec.ts`,
  `adapters/firestore-tx.adapter.ts`, `firestore-tx.adapter.spec.ts`,
  `adapters/firestore-audit.adapter.ts`, `adapters/firestore-jobs.adapter.ts`,
  `adapters/firestore-schedules.adapter.ts` (the `MALFORMED_DOCUMENT_REFUSED`
  users → `LogEvent.DocumentRefused`), `wire/triggers.wire.ts`,
  `triggers.wire.spec.ts`, `wire/client-issue.wire.ts`, `wire/loyalty.wire.ts`;
  `libs/ecs-core/src/systems/trigger-attempt.system.ts`, `trigger-attempt.system.spec.ts`;
  `tools/flags/write-functions-env.mjs`, `write-functions-env.spec.mjs`;
  `docs/production-deploy.md` ("### Secrets": `LOG_DIGEST_KEY`), `docs/architecture/firestore-runbook.md`
  (deploy step 4).
- **Brief:** §2.6 functions. `Wiring` (`main.ts` `plain`) gains `traced:
true`; the sink's own `Wiring` literal sets `false` (it runs through
  `throttledCallable` → `wiredCallable`); `publishStreakDefinition`, which
  calls `callableEdge` directly, notes its digest after its own decode. A
  main.spec case: every callable export but the sink declares
  `LOG_DIGEST_KEY`; an empty key → `inputDigest: null` and the call still
  answers. Edge cases per outcome line; the sink logs
  no outcome line and carries no uid; `operationId` only when the payload
  passes `ClientOperationId.is`. Console adapter: explicit fields win over
  the scope; two interleaved scopes never bleed; `Error` → `{ name, code,
message, stack }` scrubbed (RU-38: an `Error('… +359888123456 a@b.bg …')`
  in `fields` never shows either sentinel in any sink argument); the
  `REPORTED_ERROR_EVENT` branch unchanged. Tx adapter: a refused decide
  after a voucher-code query logs no line containing the code sentinel
  (paths of returned snapshots only). `triggers.wire.spec.ts`: a malformed
  stored `writeOperationId` reads `null` (`OperationId.is`, never a cast).
- **Checks:** `pnpm nx test functions ecs-core flag-tools`, typecheck and
  lint `functions`, `ecs-core`; layering; name check. Typecheck errors
  confined to the integration specs P11c owns (stored-body literals missing
  `writeOperationId`, caused by P11a beside it) are expected until W6c.

### P11b — WS-4.2/4.3/4.6 booking pipelines, part two (W6c)

- **Files:** `libs/ecs-core/src/systems/appointment-lifecycle.system.ts`,
  `appointment-lifecycle.system.spec.ts`; `pipelines/cancel-appointment.pipeline.ts`,
  `transition-appointment.pipeline.ts`, `mark-arrival.pipeline.ts`,
  `record-seat-tip.pipeline.ts` and their specs; `book-appointment.pipeline.ts`,
  `reschedule-appointment.pipeline.ts`, `edit-appointment.pipeline.ts` and
  their specs (decision inputs and their `LogEvent` lines).
- **Brief:** §2.6 — the lifecycle's `transitionWrite` stamps the request's
  `operationId`; tip `withMoreFields`; the refusal facts, the snapshot
  captured in the read callback (never in `decide`); every log line of
  these seven pipelines through `LogEvent`. Spec per verb: `decide` handed a
  `deepFreeze`d snapshot returns the same refusal, and the logged facts equal
  `DecisionInputSystem.slotFacts` of the last read.
- **Checks:** `pnpm nx test ecs-core`, typecheck, lint; name check.

### P11c — `LogEvent` everywhere else + provenance fixtures (W6c, beside P11b)

- **Files:** `libs/ecs-core/src/pipelines/complete-registration.pipeline.ts`,
  `continue-policy-recompute.pipeline.ts`, `end-impersonation.pipeline.ts`,
  `start-impersonation.pipeline.ts`, `match-waitlist.pipeline.ts`,
  `rebuild-busy.pipeline.ts`, `rebuild-capacity.pipeline.ts`,
  `redeem-invitation.pipeline.ts`, `request-otp.pipeline.ts`,
  `run-backfill.pipeline.ts`, `sample-lead-time.pipeline.ts`,
  `sweep-policy-recompute.pipeline.ts`, `update-profile.pipeline.ts`,
  `verify-otp.pipeline.ts` (call sites only — their specs compare the same
  texts and stay unchanged); `run-backfill.pipeline.spec.ts` (one added
  case: a mirror stamp's update plan holds no `writeOperationId` key —
  RU-29); `libs/ecs-core/src/testing/port-doubles.spec.ts` (the `Customer`
  literals at `:885-895` and `:939-951`),
  `libs/infrastructure/firestore/src/lib/customers.adapter.spec.ts`
  (`:134-151`), `libs/features/staff/dashboard/src/lib/visit-editor/staff-visit-editor.spec.ts`
  (`GEORGI_RECORD`, `:7345-7365`) — each spreads `...WriteProvenance.NONE`
  into the typed literal only; `tools/seed/fixtures/appointments.fixtures.ts`,
  `tools/seed/fixtures/customers.fixtures.ts`, `apps/web/e2e/support/appointment-seed-document.ts`,
  `apps/web/e2e/support/seed-firestore.ts`,
  `libs/features/staff/client-card/src/testing/client-card.fixtures.ts`;
  `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`
  (the `Omit<Customer,'id'>` literal); the functions integration specs
  whose stored-body equality needs the field (`book-appointment`,
  `edit-appointment`, `coupon-grant-burn`, `complete-registration`).
- **Checks:** `pnpm nx test ecs-core seed-tools staff-client-card firestore staff-dashboard`,
  `pnpm nx typecheck seed-tools`, typecheck `functions`, `firestore`,
  `web`, `staff-client-card`, `staff-dashboard`; lint; name check.

### P13a — WS-4.5 the id on the web error and its words (W6a, beside P10)

- **Files:** `libs/ecs-core/src/errors/pipeline.error.ts`, `pipeline.error.spec.ts`;
  every `PipelineError` literal site: `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts`,
  `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts`,
  `libs/features/client/auth/src/lib/auth-flow.store.spec.ts`,
  `libs/ecs-core/src/components/booking-call.data.spec.ts`,
  `apps/functions/src/adapters/auth-claims.adapter.spec.ts`;
  `libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts`,
  `callable-client.adapter.spec.ts`; `libs/infrastructure/i18n/src/lib/operation-reference.words.ts`
  (new — words only, no `*.vm.ts`, RU-28), `operation-reference.words.spec.ts`
  (new), `libs/infrastructure/i18n/src/index.ts`, `i18n/src/assets/i18n/{bg,en}.json`.
- **Brief:** §2.6 UI half one. The words spec pins bg and en exactly;
  `catalogue-parity.spec.ts` stays green (new namespace `operation`).
- **Checks:** `pnpm nx test ecs-core i18n firebase-app staff-dashboard client-auth functions`,
  typecheck and lint of those; name check.

### P13b — WS-4.5 the reference on three surfaces (W6d)

- **Files:** `libs/ui/patterns/src/lib/reference/reference.ts` (new),
  `reference.css` (new), `reference.spec.ts` (new), `libs/ui/patterns/src/index.ts`,
  `libs/ui/patterns/src/lib/toast/toast.ts`, `toast.css`, `toast.spec.ts`;
  `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts`,
  `staff-dashboard.html`, `staff-dashboard.spec.ts`;
  `libs/features/client/booking/src/lib/review-step/booking-review-step.ts`,
  `booking-review-step.html`, `booking-review-step.spec.ts`,
  `booking-error-message.ts`; `libs/features/client/appointments/src/lib/client-appointments/client-appointments.ts`,
  `client-appointments.html`, `client-appointments.spec.ts`.
- **Brief:** §2.6 UI half two. DS-inputs-only; tokens `--sys-*`; no
  `kind` / `status` keys; existing `textContent` pins stay (sibling). One
  case per surface: a failure with an id shows the line, copy confirms,
  a failure without one shows none.
- **Checks:** `pnpm nx test patterns staff-dashboard client-booking client-appointments`,
  typecheck and lint, **`pnpm nx build web`** (templates), `pnpm run lint:styles`;
  name check. Orchestrator: `e2e:web` (no baseline renders a failure; a
  changed screenshot is a DEP, viewed and listed).

### P14 — WS-4.6 the lint + the trace proof (W6d, beside P13b)

- **Files:** `tools/lint-rules/no-literal-log-message.mjs` (new),
  `no-literal-log-message.spec.mjs` (new), `tools/lint-rules/index.mjs`,
  `eslint.config.mjs` (root block); `apps/functions/src/adapters/console-otp-sender.adapter.ts`
  (the justified disable only); `libs/infrastructure/firestore/src/lib/observe.ts`
  (`REFUSED` / `DROPPED` → `LogEvent.DocumentRefused` / `DocumentDropped`);
  `libs/infrastructure/firebase-app/src/lib/reporting-error-handler.ts`
  (comment only); `apps/functions/src/integration/operation-trace.integration.spec.ts`
  (new — `callableEdge` → `wiredCallable` → `bookAppointment` over the
  emulator with a fixed `attemptId`: the outcome line, the appointment's
  `writeOperationId`, the rows' `auditOperationId`, then a `retryingTrigger`
  whose handler throws for that document: its attempt line carries
  `documentPath` and the same id); `.claude/rules/ecs-pipelines.md` (the
  example's `log` line → `LogEvent.BookingRejected`; the Log signature
  block stays verbatim; the Composition-root sentence "…would replace it
  with the same two ports" → "…with the same bundles (`TelemetryPorts`,
  `LogContextPorts`)"); `libs/ecs-core/src/ports/telemetry.port.ts` (doc).
  `no-literal-log-message.spec.mjs` pins RU-37: the justified disable is
  honoured, an identifier / member-expression message is not reported.
- **Checks:** `pnpm nx test lint-rules`; `pnpm nx run-many -t lint` judged
  on `creativo/no-literal-log-message` hits only (zero outside specs and
  test support; P13b's in-progress files beside it carry no `log` call);
  typecheck `functions`, `firestore`; name check.

### P15 — WS-5 the sink, extended (W7)

- **Files:** `libs/ecs-core/src/components/client-issue.data.ts`, `client-issue.data.spec.ts`,
  `components/stats-ops-dictionaries.type-spec.ts`; `systems/client-issue.system.ts`,
  `client-issue.system.spec.ts`; `pipelines/report-client-issues.pipeline.spec.ts`;
  `testing/port-doubles.spec.ts` (the issue fixture only);
  `libs/infrastructure/firebase-app/src/lib/callable-client.adapter.ts`,
  `callable-client.adapter.spec.ts`, `reporting-error-handler.spec.ts`,
  `client-issue-reporter.adapter.spec.ts`; `apps/web/src/app/app.config.ts`;
  `libs/infrastructure/firestore/src/lib/streak-publish.adapter.spec.ts`;
  `apps/functions/src/wire/client-issue.wire.spec.ts`.
- **Brief:** §2.7, RU-30, RU-39. `FINGERPRINT_OF_DROPPED = '97594ab2'` must
  not move; every existing OR-34 shape refusal still holds (a missing
  ORIGINAL key refused `SHAPE` naming it; an unknown extra key refused); an
  old 9-key issue is ADMITTED with the three new fields `null` in the
  admitted copy; a 9 + 1 or 9 + 2 issue is admitted; a present new key of
  the wrong type or over its cap is refused naming it.
- **Checks:** `pnpm nx test ecs-core firebase-app firestore functions web`,
  typecheck, lint; `grep -rn reportClientError apps libs` empty; name check.

### P16 — WS-6 the dead letter (W8, beside P17, after C6)

- **Files:** `libs/ecs-core/src/entities/trigger-failure.entity.ts` (new),
  `entities/collections.ts`, `entities/index.ts`, `entities/stats-ops-entities.type-spec.ts`;
  `components/stats-ops-dictionaries.type-spec.ts` (the
  `TriggerFailure['attemptOutcome']` L8 pair line only);
  `apps/functions/src/integration/operation-trace.integration.spec.ts` (its
  ports literal gains a recording `writeTriggerFailure`, plus one assertion
  that the TRANSIENT early failure writes no dead letter);
  `systems/trigger-attempt.system.ts`, `trigger-attempt.system.spec.ts`;
  `ports/trigger-failure.port.ts` (new), `ports/index.ts`;
  `primitives/log-event.data.ts`, `log-event.data.spec.ts`;
  `apps/functions/src/adapters/firestore-trigger-failures.adapter.ts` (new),
  `firestore-trigger-failures.adapter.spec.ts` (new),
  `firestore-trigger-failures.adapter.integration.spec.ts` (new),
  `adapters/firestore-ports.ts`, `firestore-ports.spec.ts`;
  `apps/functions/src/edge.ts`, `edge.spec.ts`, `main.ts`, `main.spec.ts`,
  `wire/triggers.wire.spec.ts`; `firestore.rules`,
  `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`.
- **Brief:** §2.8. `retryingTrigger` spec: PERMANENT writes exactly one dead
  letter with id = event id; the same event twice leaves one (adapter
  idempotence); an early TRANSIENT writes none and rethrows; a final-window
  TRANSIENT writes one and rethrows; a failing write is logged and changes
  nothing else. Rules: admin and sysadmin read, every other role and
  anonymous refused, every write refused.
- **Checks:** `pnpm nx test ecs-core functions`, typecheck and lint
  `ecs-core`, `functions`, `firestore`; layering; name check.

### P17 — WS-6 ops scripts, preflight P9, retention (W8)

- **Files:** `tools/ops/names.env`, `tools/ops/audit-logs.sh`,
  `tools/ops/log-sink.sh`, `tools/ops/firestore-backups.sh`,
  `tools/ops/log-metrics.sh`, `tools/ops/alerts/*.yaml` (new);
  `tools/verify/ops/ops-scripts.spec.mjs` (new — each script with no args
  exits 0 and prints `gcloud`; a stub `gcloud` on `PATH` proves nothing is
  executed without `--apply`; `bash -n`; every script sources `names.env`;
  `--lock` never implied; the sink filter pinned as RU-36 states it; every
  `jsonPayload.message:"…"` text and metric source is a value read from
  `log-event.data.ts` with `readFileSync`), `tools/verify/ops/retention.spec.mjs` (new — the
  `ttl: true` groups are exactly the seven, none is `auditLog`,
  `triggerFailures` or `clientJournal`); `tools/verify/preflight/preflight.mjs`,
  `preflight.spec.mjs`; `tools/verify/project.json` (`test.inputs` +
  `{workspaceRoot}/tools/ops/**/*` and
  `{workspaceRoot}/libs/ecs-core/src/primitives/log-event.data.ts`;
  `firestore.indexes.json` is P6's);
  `docs/architecture/firestore-runbook.md` (new §2.5 Retention; §1.1: a
  `triggerFailures` row — writer `fn:adapters/firestore-trigger-failures.adapter.ts`
  through `retryingTrigger`, readers admin rules only, Audit none, never
  TTL'd — and the `writeOperationId` note on the `appointments` and
  `customers` rows, then the §1.4 collection search re-run so the "No other
  collection exists" sentence stays true; §3 steps linking the scripts, the
  deploy order of §7 item 7, step 7 → pointer, the P1–P9 table, the
  credentials paragraph + `roles/logging.viewer`); `docs/production-deploy.md`
  (Backups, Cloud Audit Logs, Monitoring items with recommended values,
  still owner "decide"; the Data Access checkbox; §3: the deploy order of §7
  item 7 and the wire-skew note; §3.5).
- **Checks:** `pnpm nx test verify-tools`, `bash -n tools/ops/*.sh`,
  `shellcheck` if available (it is not installed here: say so); name check.
  The orchestrator never runs a script with `--apply`.

---

## 4. Specs per package (added / changed ON PURPOSE)

| Package | Added                                                                                                                                                                                                                                                                                                                                                     | Changed on purpose (DEP)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0      | refusing adapter spec; `main.spec.ts` emulator-unset case; wire / edge / error cases; pipeline: refusal passes through, challenge saved, a repeat inside 60 s answers RATE_LIMITED; i18n exact words; P8 block                                                                                                                                            | DEP-1, DEP-2: `preflight.spec.mjs:852-857`, `:885-925`, `:996-1010`, `:1088`, `:1100-1141`; `main.spec.ts:1340` (strengthened); `tools/verify/project.json` comment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P1      | `callables.spec.ts`; `inPayload` cases; intent-type cases; per verb "keys unchanged" pins                                                                                                                                                                                                                                                                 | DEP-4: the eight pipeline specs' command fixtures; the start / end-impersonation and complete-registration specs' command fixtures (`operationId: null`); `save-visit-edit.pipeline.spec.ts:181`; `port-doubles.spec.ts:1741`; `booking-call.data.spec.ts` (`clientCancel` returns the intent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P2      | per decoder: missing / malformed (`'short'`, 65 chars, spaces, number, object) / reserved (`'________________'`) → the field's refusal; valid → `OperationId`; unauthenticated / forbidden still win; `updateProfile`, `startImpersonation`, `endImpersonation`, `completeRegistration` optional (absent / malformed → `null`, never refused)             | DEP-4: `booking.wire.spec.ts:195-209`, `:652`, `:678`, `:691`, `:1210-1225`, `:1346`, `:1387`, `:1507`, `:1515`, `:1520` and the cancel / transition / arrival / tip describes; `main.spec.ts:414-524`; the seven integration specs' commands; `impersonation.integration.spec.ts` and `complete-registration.integration.spec.ts` command literals (`operationId: null`); `verify-p0.mjs:473-480`, `:694-716`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P3      | store mints per call and refuses a bad mint; transport id minted only when absent; move refused without an attempt id                                                                                                                                                                                                                                     | DEP-4: `appointments.store.spec.ts:150-200`, `:497`; `client-appointments.spec.ts` (provides `ID_PORTS`); `staff-day.store.spec.ts`; `staff-dashboard.spec.ts:721`, `:4181`, `:5576-5601`; `callable-client.adapter.spec.ts:81`; `streak-publish.adapter.spec.ts:75`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4      | `log-event.data.spec.ts`; `createsOf` / `commitWrites` (+ purity); per verb: rows in the plan, replay → 0 ops, actor null, collision, re-run                                                                                                                                                                                                              | DEP-5, DEP-6, DEP-7, DEP-9: `book…spec:156`, `:175-250`, `:305-325`, `:351`; `cancel…:181`, `:241`; `mark-arrival…:44`, `:86`, `:129`, `:148`; `record-seat-tip…:59`, `:108`, `:130`, `:165`; `reschedule…:151`, `:224-229`, `:244`, `:267`, `:292`, `:296-299`; `edit…:297`, `:365`, `:429-435`, `:841-867`, `:1187`; `transition…:176`, `:232`, `:284`, `:419`, `:1088-1109`; `booking-read-set…:65`, `:462-520` (deleted describe); `run-backfill`, `audit-profile-change`, `update-profile`, `publish-streak-definition` row literals; `audit.system.spec.ts:75`, `:146-160`, `:371`, `:392`, `:424-440`; `appointment-lifecycle.system.spec.ts:908`, `:942`, `:965`, `:997`; `billing.system.spec.ts:198-207`, `:300-308`, `cancellation-policy.system.spec.ts:373-378`, `:446-455`, `:557-566` (type-forced, assertions unchanged); `run-backfill.pipeline.spec.ts` (the FAILED call's key, RU-41); `audit-context.data.spec.ts:98-99`; `streak-publish.system.spec.ts` rows; `identity-entities.type-spec.ts` |
| P5      | `audit-in-commit.integration.spec.ts`                                                                                                                                                                                                                                                                                                                     | DEP-5, DEP-9: `firestore-audit.adapter.spec.ts:30-35`; `firestore-audit.adapter.integration.spec.ts:53-69`; integration `book…:190`, `:202`; `cancel…:155`, `:175`; `edit…:225`, `:363`, `:454`; `reschedule`; `coupon-grant-burn…:247`; `project-client-stats…:538-544`; `update-profile…:126`; `publish-streak-definition`; `firestore.rules.integration.spec.ts:1813-1816`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P6      | `audit-read.port.type-spec.ts`; `AuditSystem.chronological` (+ purity, code-unit tie); `audit.adapter.spec.ts`; `audit.adapter.integration.spec.ts`; `audit-indexes.spec.mjs`; `memoryAuditReadPorts` cases                                                                                                                                               | DEP-11: none of code (docs count only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P7      | `audit-delta.system.spec.ts` (per verb boundaries: other shop, duplicate barber, reorder, minutes 0 / 1439, re-id'd cart seats, nothing touched → NONE, reprice only, discount add / remove / `[]` vs `null`, voucher +, 0, −, mixed currency → null, tip set / change / clear, every from-variant, seat act; purity; fast-check delta(x, x) is all-null) | DEP-10 / DEP-10a: `audit-context.data.spec.ts:84-130`; `audit.system.spec.ts:69-77`, `:332-353`; `firestore.rules.integration.spec.ts:1811-1818` (the `auditLog` row literal); `identity-dictionaries.type-spec.ts` (two pair lines); `appointment-lifecycle.system.spec.ts:961-971`; `reschedule…:222-226`; `edit…:357-362`, `:400`; `record-seat-tip…:100-105`, `:145`; `transition…:227`, `:277-281`, `:434`, `:451`, `:481`; `cancel…:233-238`; `identity-entities.type-spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P8      | `governed-change.system.spec.ts`; `governed-collection.data.spec.ts`; `audit-document-change.pipeline.spec.ts` (the old profile cases moved + governed cases); impersonation row cases (resource, target, `auditOperationId`); `forImpersonationSession`                                                                                                  | DEP-12: `start-impersonation.pipeline.spec.ts:64-82`; `end-impersonation.pipeline.spec.ts:80-119`. DEP-13: `audit.system.spec.ts:466-489` (flips), `:491-532` (property extended), `:542-588` (`writerOf`), profile plan cases `~:620-770`; `complete-registration.pipeline.spec.ts:206-224` (+ `'roles'`); `audit-context.data.spec.ts:198-201`; `audit-profile-change.pipeline.spec.ts:41-54`, `:76-97` (moved into `audit-document-change.pipeline.spec.ts`: `changeOf` gains `governedCollection` and the four tag fields as `null`, `rowOf` the new `Profile` shape). DEP-17: `audit-context.data.spec.ts:39`, `:54-79`; `identity-dictionaries.type-spec.ts`                                                                                                                                                                                                                                                                                                                                                   |
| P9a     | notes rules block; `visit-media-writers.integration.spec.ts` (notes adapter + `attachVisitPhoto` / `adoptVisitPhoto` bodies); `stamp-window.rules-text.spec.ts`; `scheduleExceptions` staff write / delete                                                                                                                                                | DEP-15: `firestore.rules.integration.spec.ts:1749-1806` (stamp and bodies). DEP-16: `attach-visit-photo.pipeline.spec.ts` call-order pins (`~:123`, `:189`, `:209`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P9b     | `governed-audit.integration.spec.ts`; the generated export check (USERS included); `decodeDocumentChangeEvent` per member (CUSTOMERS target branded, others `null`)                                                                                                                                                                                       | DEP-14: `main.spec.ts:19-48`, `:160-179`, `:180-257`, `:342-774`, `:713` (`seam.PIPELINES`), `:805`, `:825`; `triggers.wire.spec.ts:441-500` (re-pointed to `decodeDocumentChangeEvent`). DEP-12: `impersonation.integration.spec.ts:107-142`. DEP-13: `triggers.wire.spec.ts` profile cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P10     | `canonical-json`, `log-digest`, `decision-input`, `write-provenance` specs, each with its `deepFreeze` purity case (+ key-order independence, + the decision-input boundaries); `log-event` values                                                                                                                                                        | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P11a    | guard cases (absent / null / valid / invalid; busy day with the key admitted); stamp cases book / reschedule / edit / customer creates                                                                                                                                                                                                                    | DEP-19: `stored-document.system.spec.ts`; `customer-record.system.spec.ts:79`, `:488`; `booking-decision.system.spec.ts`; `book…:210`, `:286`, `:638` + plan pins; `reschedule…`, `edit…` plan pins; `booking-read-set…` (`placementFields`); `complete-registration…:168`; `appointment-entities.type-spec.ts`, `identity-entities.type-spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P12     | outcome-line cases; digest-holds-no-contact case; secret-bound case; ALS merge / bleed / scrubbed-Error cases (RU-38 sentinels); `logDigestPorts`; versions-read line (paths only, no voucher-code sentinel); malformed `writeOperationId` → `null`                                                                                                       | DEP-18: `main.spec.ts:129-135`, `:170-178`, `:180-257` (secrets), `:1422`, `:1525`, `:1649` (logger counts), `:1526`, `:1549` (payloads); `edge.spec.ts:1028-1044` (fixture); `console-telemetry.adapter.spec.ts`; `crypto.adapter.spec.ts`; `firestore-tx.adapter.spec.ts`; `write-functions-env.spec.mjs:209-231`. DEP-19: `edge.spec.ts:992-1010` (`attemptLineFields`; `:1306` "logs nothing when the attempt succeeds" stays); `triggers.wire.spec.ts`; `trigger-attempt.system.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P11b    | refusal-facts cases (book / reschedule / edit: a `deepFreeze`d snapshot, facts = `slotFacts` of the last read); stamp cases cancel / transition / arrival / tip; replay / unchanged stamp nothing                                                                                                                                                         | DEP-18, DEP-19: `appointment-lifecycle.system.spec.ts` (transition fields); `cancel…`, `transition…`, `mark-arrival…`, `record-seat-tip…` plan pins; `book…:285` line (+ facts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P11c    | none                                                                                                                                                                                                                                                                                                                                                      | DEP-19 fixtures: seed fixtures, e2e support, client-card fixtures, `firestore.rules.integration.spec.ts:1617`, `port-doubles.spec.ts:885-895`, `:939-951`, `customers.adapter.spec.ts:134-151`, `staff-visit-editor.spec.ts:7345-7365`, functions integration stored-body equality (`book`, `edit`, `coupon-grant-burn`, `complete-registration`); `run-backfill.pipeline.spec.ts` (one added case, RU-29)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P13a    | `operation-reference.words.spec.ts` (bg + en exact)                                                                                                                                                                                                                                                                                                       | DEP-20: `pipeline.error.spec.ts`; the `PipelineError` literal sites listed in P13a; `callable-client.adapter.spec.ts` (id on refusal and on `PIPELINE_UNKNOWN`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P13b    | `reference.spec.ts`; `toast.spec.ts` reference case; one case per surface                                                                                                                                                                                                                                                                                 | DEP-20: none of the existing pins (sibling element)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P14     | `no-literal-log-message.spec.mjs`; `operation-trace.integration.spec.ts`                                                                                                                                                                                                                                                                                  | DEP-21: none (texts identical)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P15     | `composeTransport` (+ purity); `operationIdOf`-free adapter cases (a plain `Error`, a string, a lookalike reported ONCE with name + id; a real `FunctionsError` and the sink's own failure report nothing; a throwing reporter never rejects); admit cases: 9-key admitted with `null`s, 9 + subset admitted, a bad present new key refused (RU-30)       | DEP-22: `client-issue.data.spec.ts:22-31`, `:33-45`, `:47-56`; `stats-ops-dictionaries.type-spec.ts:98`, `:118`, `:139`, `:158`; `client-issue.system.spec.ts:26`, `:40`, `:312`, `:463`, `:490`; `report-client-issues.pipeline.spec.ts:29`, `:38`; `port-doubles.spec.ts:1792`; `reporting-error-handler.spec.ts:57`, `:148`, `:239`; `client-issue-reporter.adapter.spec.ts:108`; `client-issue.wire.spec.ts`; `streak-publish.adapter.spec.ts:75`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P16     | `deadLetter` truth table + `triggerFailure` purity; adapter spec + integration; rules block; entity type-spec                                                                                                                                                                                                                                             | DEP-23: `edge.spec.ts:1311-1385`; `triggers.wire.spec.ts:546`; `main.spec.ts` (edge object, lazy write); `firestore-ports.spec.ts` (if it enumerates bundles); `operation-trace.integration.spec.ts` (ports literal + one assertion); `stats-ops-dictionaries.type-spec.ts` (one pair line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P17     | `ops-scripts.spec.mjs` (incl. the sink filter and the `LogEvent`-value check); `retention.spec.mjs`; the P9 block                                                                                                                                                                                                                                         | DEP-24: `preflight.spec.mjs` WT `:1014-1045`, `:1047-1100`, `:1254-1384`; `tools/verify/project.json` inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

### 4.1 Added at integration (spec changes on purpose found by the stage integrators)

- **C1 (WS-4.1):** listed under DEP-4 ("Also changed on purpose").
- **C2 (WS-1 + WS-4.4):** the `logUnaudited` cases in `booking-read-set.pipeline.spec.ts` replace the deleted `appendAuditFacts` describe (DEP-5); `log-event.data.spec.ts` also pins that every value is unique and the "dropped" pair that `reporting-error-handler.ts` classifies on (RU-9); the book, reschedule and edit contention re-run cases compare the audit rows only, not the whole plan (their seat and decision ids come from `nextId`, RU-7).
- **C4 (WS-3):** `profile-edit.system.spec.ts`'s `stub → registered` case — both expected field lists now end in `'roles'` (registration moves `roles` from `[]` to `['client']`, and DEP-13 audits `roles`).
- **Carried from C4 (not built):** whether a REORDERED `roles` list counts as a change (today it does — owner flag); `auditProfileChanges`' trigger path changes from `users/{uid}` to `users/{docId}` (RU-40) — if `firebase deploy` refuses to update the trigger in place, delete that one function and deploy again (deploy step, §7 item 7); `libs/infrastructure/firestore`'s inferred `test` target does not list the root `firestore.rules` as an input, so a CACHED run can skip the rules-text spec after a rules edit (the gate always runs with `--skip-nx-cache`).
- **C5 (WS-4.2–4.6):** the C5 integrator's corrections to §4 / §5 — DEP-19's row lists the four functions integration specs as edited, but P11c left them unedited (they pass unchanged); P13a's three listed spec files needed no `PipelineError` literal edit (P13b added one `staff-dashboard.spec.ts` case); P11b's `book…:285` pin did not exist, so it became new cases. **Orchestrator:** `toast.spec.ts`'s "resumes with what was left of the clock" case now runs on Vitest fake timers (`setTimeout`, `clearTimeout`, `performance`) and gains a "not yet at +19 ms" check — the real 30 ms / 50 ms timers raced on loaded runners (it failed CI on `de045ff` and the local baseline under load); the case is stricter, not weaker, and the PR already touches that spec (P13b).
- **Flags from C5 (for the review rounds / owner):** `trackError(error)` still hands the raw `Error` to Error Reporting unscrubbed (pre-existing; RU-38 scrubs `Error` values inside `fields` only); the reference line's tap target is one footnote line, under WCAG 2.5.8's 24 px; the toast nests one polite live region inside another; the input digest's allowlist includes `operationId` / `attemptId` / `requestId`, so two digests match only on a retry of the same operation (the brief's "the decoded command"); a short `publishStreakDefinition` `requestId` prints no reference.
- **C6 (WS-5):** `client-issue.system.spec.ts`'s Cyrillic and astral `TOO_LARGE` cases now send nine-key issues (the OR-34 shape the sink still admits, RU-30): with the three new keys the batch is 4,101 UTF-16 units and would break the case's own "under 4,096 units, over 4,096 bytes" premise. Every literal and assertion is kept; the caps, rates and `FINGERPRINT_OF_DROPPED = '97594ab2'` are unchanged. Deploy window (DEP-22): the old sink refuses the new web's 12-key batches until the functions deploy; §7 item 7's order (hosting before functions, for DEP-4) accepts that window — between the two deploys a client issue may be dropped, never a user's act.
- **C7 (WS-6):** `log-event.data.spec.ts`'s full-dictionary pin gains the new trigger-failure values (DEP-23); the DEP-23 line hints moved with the files; `main.spec.ts`'s TRANSIENT trigger cases now fall in the final retry window under the real clock — their mocked dead-letter writer answers success, so no assertion depends on the date (flagged for the review rounds). C7 integrator edit: `firestore-trigger-failures.adapter.ts`'s `bodyOf` drops `id` by filtering entries (the destructured `_id` added a lint warning); the stored body is unchanged.
- **Flags from C7 (owner):** P9 stays INFO; `identitytoolkit.googleapis.com` is unconfirmed; locking the 400-day bucket (irreversible) and keeping uids that long are the owner's legal-basis call; the alert thresholds name no notification channel and use the alpha `gcloud monitoring policies` command; a final-window TRANSIENT dead letter stays even when a later redelivery succeeds; `trigger.failure_not_recorded` has no metric or alert. `shellcheck` is not installed in this container: the scripts pass `bash -n` and every dry run exits 0 (the owner runs `shellcheck` before `--apply`).

## 5. DEPARTURES

- **DEP-1 (P0, WS-0) — a deployed sign-in refuses instead of logging the
  code.** Before: every environment wired `consoleOtpSender`; a deployed
  project logged `[otp] would send <channel> OTP to <destination>: <code>`
  at info and answered success. After: outside the emulator `sendOtp`
  answers `IDENTITY_OTP_SEND_UNAVAILABLE` (`failed-precondition`, never
  `permission-denied`); the web words it without a retry; the emulator is
  unchanged (fixed code, `devCode`). The pipeline still saves the challenge
  and consumes the OR-9 window before sending (RU-3): a refused request
  leaves one unusable, TTL-purged `otps` document and a repeat inside 60 s
  answers `IDENTITY_OTP_RATE_LIMITED`. Evidence: `main.ts:288`. Specs:
  `refusing-otp-sender.adapter.spec.ts` (new), `main.spec.ts` (new case,
  `:1340` strengthened), `identity.wire.spec.ts`, `edge.spec.ts`,
  `identity.error.spec.ts`, `request-otp.pipeline.spec.ts`,
  `auth-flow.store.spec.ts`, `translate-coded-error.spec.ts`,
  `word-flow-failure.spec.ts`, `word-pipeline-error.spec.ts`. No e2e / P0 /
  emulator journey pins the deployed path (all run with `FUNCTIONS_EMULATOR=true`).
- **DEP-2 (P0, WS-0) — the launch stays fail-closed by P8.** Before: P7
  FAILed on the real tree (the console sender outside the gate). After: P7
  PASSes; P8 FAILs while `refusingOtpSender` is used and flips to PASS when
  a transactional sender lands; `--scope functions` runs P1–P3 and P6–P8.
  `production-deploy.md` §1 stays an open checkbox. Specs:
  `preflight.spec.mjs:852-857`, `:885-925`, `:996-1010`, `:1088`,
  `:1100-1141`; `tools/verify/project.json` comment.
- **DEP-3 (P0, copy) — `errors.IDENTITY_OTP_SEND_UNAVAILABLE`** in bg and
  en (§2.0). No existing string changes.
- **DEP-4 (P1–P3, WS-4.1) — operation ids are required on eight callables.**
  Before: book's `attemptId` absent or malformed → `null` (a fresh id);
  reschedule / edit optional; cancel / transition / markArrived /
  clearArrival / recordSeatTip carried none. After: each refuses a missing,
  malformed or reserved id with its own invalid-input struct naming the
  field; book's id is `AppointmentId.parse`d (a reserved `__x__` name is
  refused, not a 500); the web mints every one, and the callable adapter
  adds a transport `operationId` to every other callable but the sink;
  `updateProfile`, `startImpersonation`, `endImpersonation` and
  `completeRegistration` read it optionally (RU-21). Audit keys unchanged in
  this commit. **Wire skew:** an already-open old shell sends no
  `operationId` on cancel / transition / markArrived / clearArrival /
  recordSeatTip, so after the functions deploy each of those calls is
  refused with its `*_INVALID_INPUT` until the shell reloads (book, move and
  staff edit are unaffected: the web always sent their ids), and staff
  dashboards stay open all day; old functions ignore the new field (no decoder refuses an extra
  key), so the deploy order of §7 item 7 — hosting before functions —
  narrows the window to shells opened before the hosting deploy. Specs: as
  P1–P3 rows of §4. e2e: none (UI-driven, `browserIdPorts`
  mints; `appointments.spec.ts` and `staff-walk-in.spec.ts` are the smoke).
  P0: `verify-p0.mjs:473-480`, `:694-716` (ids only; assertions unchanged).
  **Also changed on purpose (C1 integrator):** the reschedule "unnamed
  move" case (deleted — a move without an attempt id is now a wire
  refusal); the book walk-in fixture and the transition spec's E-14 book
  command (they now carry an id); `booking.wire.spec.ts` — an anonymous book
  is refused `BOOKING_UNAUTHENTICATED` by the decoder before the id check
  (P2: the pipeline's own first check, moved to the edge so the §2.1 refusal
  order holds — the answer is unchanged), the anonymous reschedule case at
  `:691` now decodes a signed-in caller, two cases retitled; two
  `edit-appointment.integration.spec.ts` cases; the reschedule integration
  spec's retry path (now a ledger replay answering the same);
  `staff-dashboard.spec.ts`'s "keeps a name the caller chose" case (replaced:
  the store mints the id); the two `cancelCalls` pins of
  `client-appointments.spec.ts`.
- **DEP-5 (P4, P5, WS-1) — audit rows commit with the act.** Before: the
  seven booking pipelines appended rows after the commit, swallowed every
  failure, re-appended a row on a book / reschedule / edit replay
  (`loggedOnRetry: true`), and minted ids by `nextId()` for un-keyed facts.
  After: the rows are `WriteOp.create`s of the same plan; a failed commit
  writes none; a replay or unchanged act plans none; a Create of an
  existing row (a delayed duplicate after the visit cycled back, or an edit
  id older than the 20-entry ledger) refuses the whole act with
  `REPOSITORY_ALREADY_EXISTS` (before: re-applied silently). A missing
  verified actor (unreachable over the wire) commits without rows and logs
  `LogEvent.AuditActorMissing` at error, as before. Specs: P4 and P5 rows of
  §4; `verify-p0.mjs` check (d) still sees 2 rows per edit. e2e: none.
- **DEP-6 (P4, WS-1) — instant-free keys and `audit-row/v2`.** Before:
  cancel / transition / arrival / clear / tip keys carried instants; the
  basis tag was `v1`. After: §2.2 keys; every row id basis changes (profile,
  publish and backfill rows too — no hosted data exists; a profile event
  redelivered across the deploy would write a v1 and a v2 row once). Specs:
  `audit.system.spec.ts:371`, `:392`, `:424-440`; lifecycle `:908-997`.
- **DEP-7 (P4, WS-1) — `loggedOnRetry` is gone** from `BOOKING_RESCHEDULED`
  rows. Specs: `audit-context.data.spec.ts:98-99`,
  `reschedule-appointment.pipeline.spec.ts:296-299`.
- **DEP-8 — withdrawn (not a departure).** `unchanged` stays "the lifecycle
  step wrote nothing": before `auditFacts.length === 0`, after the step's
  `writes.length === 0` — the same for every input, an actor-null direct
  call included (the lifecycle builds its facts whatever the actor:
  `appointment-lifecycle.system.ts:734-751`, `:767-784`), and never the
  audit creates. The actor-null spec case stays as a pin.
- **DEP-9 (P4, P5, WS-4.4) — rows carry `auditOperationId`** (a new root
  field, single-field indexed). Specs: every whole-row literal (P4 / P5
  rows of §4).
- **DEP-10 (P7, WS-2) — rows carry typed before/after deltas** (the brief's
  19 fields, new root fields per variant, `null` when untouched). Specs: P7
  row of §4. P0: unchanged (it reads `auditAction`).
- **DEP-10a (P7, WS-2, RU-11) — 13 planner-added delta fields**, beyond the
  brief's decided list: `rescheduleFromLocationId` / `ToLocationId`,
  `editMoveFrom/ToLocalDate`, `editMoveFrom/ToStartMinutes`,
  `editRestaffFrom/ToBarberIds`, `editDiscountFromIds`, `tipFromCents`,
  `transitionFromAttendanceState`, `cancellationFromBookingStatus`,
  `cancellationFromStatusAtUtcMs`. Each strike-able alone (its field, its
  override, its spec case). 19 + 13 = 32 `fieldOverrides`. Owner flag §7.15.
- **DEP-11 (P6, WS-7) — five `auditLog` composites are declared** (a deploy
  builds them; 19 → 24). `production-deploy.md` count text. No code spec.
- **DEP-12 (P8, P9b, WS-3) — impersonation start / end write an audit row
  in their commit** (plans of 1 → 2 ops; actor `Actor.forCaller` — RU-13).
  Specs: `start-impersonation.pipeline.spec.ts:64-82`,
  `end-impersonation.pipeline.spec.ts:80-119`,
  `impersonation.integration.spec.ts:107-142`.
- **DEP-13 (P8, P9b, WS-3) — `roles` and `accountStatus` are audited.**
  Before: `profileFields` named five registration fields; the stub and the
  registration `Set` listed none of these. After: `roles` / `accountStatus`
  join the list (appended); a PROFILE_CREATED row lists `accountStatus`
  (an empty `roles` array is "no value"); the registration PROFILE_UPDATED
  row gains `roles`; the four `profile*From/To` tag fields are set when
  their field changed. Specs: `audit.system.spec.ts:466-489`, `:491-532`,
  `:542-588`, `~:620-770`; `complete-registration.pipeline.spec.ts:206-224`;
  `audit-context.data.spec.ts:198-201`; `triggers.wire.spec.ts`;
  `audit-profile-change.pipeline.spec.ts:41-54`, `:76-97` (moved into
  `audit-document-change.pipeline.spec.ts`).
- **DEP-14 (P8, P9b, WS-3) — thirteen governed-collection triggers; 34 → 47
  exports; ONE document-change handler (RU-40).** Every Admin-SDK and
  browser write of the thirteen collections (deletes included) writes one
  `GOVERNED_DOC_*` row named by field. `auditProfileChange` /
  `decodeProfileChangeEvent` become `auditDocumentChange` /
  `decodeDocumentChangeEvent` (a users event plans exactly the row it plans
  today); the `auditProfileChanges` export keeps its name, its path param
  `{uid}` → `{docId}`. Specs: `main.spec.ts:19-48`, `:160-257`,
  `:342-774`, `:713`, `:805`, `:825`; `triggers.wire.spec.ts:441-500`. e2e /
  P0: answers unchanged; seeds and settle take longer (more trigger runs).
- **DEP-15 (P9a, WS-3) — rules refuse forged authors and stale stamps.**
  Before: any `worksTheBook()` write of a note or photo. After: create /
  update of a note and create of a photo require the caller's uid and a
  stamp within ±300 s of `request.time`; a photo update is refused. The
  window is judged against the device clock (owner flag). Specs:
  `firestore.rules.integration.spec.ts:1749-1806` + the new notes block;
  `visit-media-writers.integration.spec.ts` (the live writers' bodies pass).
  e2e: no journey writes a note or photo through the browser, and the one
  spec that pins the browser clock (`appointments-screenshots.spec.ts`)
  writes neither.
- **DEP-16 (P9a, WS-3 L6) — a photo's document stamp is read after its
  upload.** Specs: `attach-visit-photo.pipeline.spec.ts` call-order pins.
- **DEP-17 (P8, WS-3) — five new verbs** (`GOVERNANCE_*`, `GOVERNED_*`).
  Specs: `audit-context.data.spec.ts:39` (regex), `:54-79` (partition).
- **DEP-18 (P10, P11b, P12, WS-4.2) — callables are traced.** Before: no
  line on success or refusal. After: one `callable.completed|refused|failed`
  line per invocation (not for the sink), every `ports.log` line of an
  invocation carries `callable`, `operationId`, `uid`, `roles`;
  `LOG_DIGEST_KEY` is bound on every callable but the sink; book / move /
  staff-edit refusals log what the decision read; a refused decide logs the
  read documents' `updateTime`s. Answers unchanged. Specs: P12 / P11b rows
  of §4.
- **DEP-19 (P11a–P11c, P12, WS-4.3) — `writeOperationId` on appointments
  and customers** (new root field; the last booking-verb or registration
  callable writer — `runBackfill`'s mirror stamps leave it as it was,
  RU-29; absent on old documents is valid); trigger attempt lines gain
  `documentPath` and `writeOperationId`. Specs: P11a–P11c, P12 rows of §4. P0: `verify-p0.mjs:503-515`
  byte-compares two seeds (both `null`): unchanged.
- **DEP-20 (P13a, P13b, WS-4.5) — a reference line under three callable
  failures** (new copy `operation.reference` / `.referenceCopied`). Specs:
  P13a / P13b rows. Screenshot baselines: none renders a failure (a changed
  one is viewed and listed in the PR).
- **DEP-21 (P11b, P11c, P12, P14, WS-4.6) — `LogEvent` messages and the
  lint.** Message texts byte-identical; an `Error` in log fields is
  written as `{ name, code, message, stack }` with the message and frames
  scrubbed (RU-38; before: `{}`); a literal message is a lint error (two
  recorded exemptions, RU-37). Specs: `console-telemetry.adapter.spec.ts`;
  `no-literal-log-message.spec.mjs`.
- **DEP-22 (P15, WS-5) — transport failures reach the sink.** A non-Functions
  throw is reported once as `CALLABLE_TRANSPORT_FAILED` with the callable,
  the error name and the operation id, and still answers `PIPELINE_UNKNOWN`;
  every issue carries three new fields (on the wire optional: an old web's
  9-key batch is still admitted, RU-30). Between the hosting and the
  functions deploy (§7 item 7) the OLD sink refuses the new web's 12-key
  batches `SHAPE` — client issues of that window are lost (accepted, no
  answer the user sees changes). Specs: P15 row.
- **DEP-23 (P16, WS-6) — a dead letter for failed triggers.** PERMANENT and
  final-window TRANSIENT failures write `triggerFailures/{eventId}` once;
  verdicts and rethrows unchanged. Specs: P16 row (incl.
  `operation-trace.integration.spec.ts`'s ports literal).
- **DEP-24 (P17, WS-6) — preflight P9 (INFO) in the functions scope**;
  scripts and docs only, nothing applied. Specs: P17 row.

Frozen (no DEP): WS-7's ports and adapter (additive), the OR-34 caps and
rates, every callable answer apart from DEP-4's new refusals.

---

## 6. Gates

### 6.1 The FULL gate (brief §9, verbatim — one command at a time)

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

Known load flakes (brief §9): `auth-onboarding.spec.ts:106`,
`appointments.spec.ts:152`, the landing hero screenshot, the glance barber
test after ~23:15 shop time; under `--parallel=3` the heavy
`staff-dashboard`, `staff-client-card`, `marketing-landing` and
`booking-return-url.spec.ts` specs — judged on a solo re-run. The
functions dist keeps its four runtime dependencies (`node:async_hooks` is a
built-in).

### 6.2 Per package and per stage

Per package: its §3 "Checks", nothing else. Per stage (orchestrator, before
the commit): `rm -rf dist/out-tsc` + `run-many -t typecheck --skip-nx-cache`,
`run-many -t lint`, `run-many -t test --parallel=3 --skip-nx-cache`,
layering, the grep gates alone, `test:emulator` (C1, C2, C2′, C3, C4, C5, C7 — C1's P2 edits seven integration specs' commands, C3's P7 changes the rows they commit), and
`verify:p0` + `e2e:web` (C1, C2, C4, C5); the full §6.1 at C0, after C7 and
after each review fix round. Pass-specific checks (orchestrator; `grep -r`
for untracked files):

```bash
grep -rn "appendAuditFacts\|AuditWritePorts" libs apps                      # 0 (C2)
grep -rln "appendAudit(" libs/ecs-core/src/pipelines --include=*.ts | grep -v spec   # run-backfill.pipeline.ts only (L2)
grep -rnE "would send|otp.*(code|destination)" apps/functions/src --include=*.ts | grep -v spec  # RU-2: adapter + 3 named lines
grep -rn "audit-row/v1" libs apps --include=*.ts                             # 0 (C2)
grep -c "onDocumentWrittenWithAuthContext(" apps/functions/src/main.ts       # 1 — the one helper (C4, RU-40)
grep -cE "^export const audit[A-Za-z]+Changes = " apps/functions/src/main.ts  # 14 (C4)
grep -rn "auditProfileChange\b\|decodeProfileChangeEvent\|forDocument(" libs apps --include=*.ts  # 0 (C4)
grep -rn "errors\.reference" apps libs                                       # 0 (C5, RU-27)
grep -rn "reportClientError" apps libs                                       # empty (C6)
grep -n "request.time" firestore.rules                                      # the helper only (C4)
grep -n "LOG_DIGEST_KEY" apps/functions/src/main.ts tools/flags/write-functions-env.mjs   # bound + TEST value (C5)
node -e 'const j=require("./firestore.indexes.json");const a=j.indexes.filter(i=>i.collectionGroup==="auditLog");console.log(a.length, j.indexes.length, j.fieldOverrides.length, j.fieldOverrides.some(o=>o.fieldPath==="auditOperationId"))'  # 5, 24, ~100, false
bash -n tools/ops/*.sh                                                       # C7
```

### 6.3 Measured baseline (the orchestrator fills it; measured on `0df7d7ab` in `/home/user/baseline`)

| Gate step                                                           | Baseline `0df7d7ab`                                                          | After C0 (WS-0)                                                                                | Final (after C7 + reviews) |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| `nx sync:check`                                                     | up to date                                                                   | up to date                                                                                     | ‹fill›                     |
| layering (files / import edges)                                     | 923 / 4,106 (2,566 scanned)                                                  | 923 / 4,106 (2,568 scanned)                                                                    | ‹fill›                     |
| typecheck (projects green)                                          | 40 / 40                                                                      | 40 / 40                                                                                        | ‹fill›                     |
| lint (projects, errors, warnings)                                   | 44, 0, 242                                                                   | 44, 0, 242                                                                                     | ‹fill›                     |
| `run-many -t test` (targets, passed, failed)                        | 44; vitest 13,228 (13,226 + 2 load timeouts, green alone) + node 125; 0 real | 44; vitest 13,244 (13,243 + the `patterns` toast load flake, 547/547 alone) + node 134; 0 real | ‹fill›                     |
| ecs-core tests / statements % (covered/total)                       | 6,397 / 98.43 % (14,759/14,994)¹                                             | 6,399 (WS-0 builder run)                                                                       | ‹fill›                     |
| functions tests                                                     | 1,004                                                                        | 1,013                                                                                          | ‹fill›                     |
| `verify-tools` (preflight spec) tests                               | 125                                                                          | 134 (preflight 55)                                                                             | ‹fill›                     |
| `seed-tools` typecheck / `lint-rules` tests                         | green / 319                                                                  | — / 319                                                                                        | ‹fill›                     |
| `lint:styles`                                                       | green                                                                        | green                                                                                          | ‹fill›                     |
| `build web` initial (kB, transfer) + `verify:bundle`                | 581.84 kB (157.93 kB) + green                                                | 582.00 kB (158.13 kB)                                                                          | ‹fill›                     |
| functions dist runtime dependencies                                 | 4 (firebase-admin, firebase-functions, libphonenumber-js, rxjs)              | 4, same                                                                                        | ‹fill›                     |
| runbook §4.2 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 / §4.10 `ok` | 28/22/17/6/24/27/25/20, 0 FAIL                                               | 28/22/17/6/24/27/25/20, 0 FAIL                                                                 | ‹fill›                     |
| `verify:p0` (a)–(f)                                                 | green²                                                                       | green²                                                                                         | ‹fill›                     |
| `test:emulator` (functions + infra)                                 | 69 + 311²                                                                    | —                                                                                              | ‹fill›                     |
| `e2e:web` (passed / failed)                                         | 49 / 14³                                                                     | 63 / 0²³                                                                                       | ‹fill›                     |
| `verify:csp` (hashes, smoke)                                        | both match; smoke 10 passed²                                                 | —                                                                                              | ‹fill›                     |

¹ Coverage measured with `--testTimeout=30000` on the command line: under v8 instrumentation on this 4-vCPU container one `streak.system.spec.ts` fast-check property case runs ~5.1 s against the 5 s default (it timed out twice, once alone); without coverage it passes. No repository change.
² The emulator journeys ran with the proxy variables unset (`env -u HTTPS_PROXY -u https_proxy …`): firebase-tools' apiv2 client sends even its `127.0.0.1` emulator calls through `HTTPS_PROXY` (it ignores `NO_PROXY`), and the container proxy answered the Firestore trigger registration with "request blocked". The first baseline pass failed `verify:p0`, `e2e:web` and the `verify:csp` smoke on that alone (its static hash gate passed); the re-run without the proxy is the recorded one. `test:emulator` reads 311 where HANDOFF records 312.
³ The repository holds only `*-chromium-darwin.png` screenshot baselines: on this Linux container the 10 screenshot cases fail with "A snapshot doesn't exist … writing actual". The baseline run's Linux actuals are kept as LOCAL references (`.git/info/exclude`, never committed), so from C0 on the screenshot cases compare the branch against the branch point on the same machine. The 4 behavioural baseline reds (`appointments.spec.ts:158` — HANDOFF's known `:152` —, `auth-onboarding.spec.ts:63` and `:106`, `client-card-harness.spec.ts:40` [phone]) ran under a load average of ~9 on 4 vCPU; all four pass on the C0 tree's quiet run, whose code for them is unchanged.

Environment (no repository change): Node 22.22.3 (the `.nvmrc` pin — the container's default 22.22.0 is below `engines`, and pnpm then skips the engine-mismatched native bindings), JDK 21, Playwright's pinned chromium-1228 unpacked from the Chrome-for-Testing Google mirror (cdn.playwright.dev is blocked by the network policy), gitleaks 8.24.3.

Expected movement: tests only up (every drop explained in §8); ecs-core
statements ≥ the baseline, new system and pipeline files ≥ 95 %; layering
grows by the added files only; `build web` within a few kB (one DS element,
one words helper); the grep gates keep their reference counts (a new name
that trips one is renamed, never excluded).

---

## 7. Owner items touched (flags — copied into the PR)

1. **New copy (review):** `errors.IDENTITY_OTP_SEND_UNAVAILABLE` (bg «Кодовете
   за вход още не се изпращат. Свържи се със салона.», en "Sign-in codes
   aren't being sent yet. Contact the shop."); `operation.reference` (bg «Код
   за справка: {{ref}}», en "Reference: {{ref}}"); `operation.referenceCopied`
   (bg «Кодът е копиран.», en "Reference copied.") — OR-51 / OR-55.
2. **The L-register** L1–L6 (§0.3).
3. **`maxPartySize` cap** (§0.5): ≤ 20 at the settings door, seats ≤
   `maxPartySize × 8` — proposed, not built.
4. **Missing verified actor:** the act commits without rows and logs
   `audit row has no verified actor` at error (built, unchanged); refusing
   the act instead is the owner's call.
5. **Preflight severities:** P8 FAIL until a transactional sender lands
   (fail-closed launch); P9 INFO (the owner may rule it a gate; the flip is
   local to `checkBackstops`).
6. **`.claude/rules` edits** (text this pass makes false): `ecs-pipelines.md`
   L55-59 and L98-102 (P5), its `log` example and its Composition-root
   sentence "…would replace it with the same two ports" → "…with the same
   bundles (`TelemetryPorts`, `LogContextPorts`)" (P14); `ecs-components.md`
   ("intersects seven slices", P11a); `firestore-layout.md` (the stored
   layout and "seven flat slices", P11a). No `CLAUDE.md` / `AGENTS.md` edit;
   **no law amendment is required** (`LogEvent` is not a discriminator —
   RU-9; every other design has a lawful form).
7. **Deploy steps (owner):** create `LOG_DIGEST_KEY` (`openssl rand -hex 32
| firebase functions:secrets:set LOG_DIGEST_KEY`) before the first
   functions deploy (rotation breaks digest comparability, nothing else);
   **deploy order** (DEP-4 / DEP-22 wire skew; written into runbook §3,
   `production-deploy.md` §3 and the HANDOFF deploy notes):
   `firestore:indexes` (5 composites, the new overrides) → `hosting` (the
   new web; old functions ignore the extra `operationId`, the new photo
   stamp is live before the window rule) → `firestore:rules` (notes /
   photos window, `triggerFailures`) → `functions` (the 13 new triggers;
   from here an already-open pre-hosting shell's id-less verb calls are
   refused until it reloads, DEP-4); between the hosting and the functions
   deploys the old sink refuses the new web's 12-key issue batches (DEP-22); grant `roles/logging.viewer` to the preflight
   credentials for P9; run `tools/ops/*.sh --apply` by hand when decided,
   `--lock` only on purpose (irreversible); the Data Access logs' volume and
   billing; Auth custom-claims changes stay unaudited until a `setRoles`
   callable.
8. **OR-34 amended:** a 7th kind `CALLABLE_TRANSPORT_FAILED` and three
   allowlisted fields (RU-30) — optional on the wire, so an old web's 9-key
   batch is still admitted.
9. **Privacy line:** server lines now carry account ids and roles (outcome
   lines, the bound context); the published "no personal identifiers"
   sentence should say "no names, contact details or free text"; the
   400-day audit bucket keeps the audit logs and EVERY function line (RU-36:
   outcome lines with uid and roles, security lines) but no client issue,
   and Data Access logs hold principal e-mails — 400 days of account
   identifiers is a legal-basis decision (narrowing the filter to an
   allowlist is the alternative, at the cost of the DoD trace after 30 d).
10. **Impersonation attribution** (RU-13): a sysadmin's session is recorded
    as STAFF + `['sysadmin']`, an admin's as ADMIN.
11. **Device clock** (DEP-15): a phone more than 5 minutes off, or an
    offline note / photo synced later, is refused (`REPOSITORY_WRITE_FAILED`
    on screen); server timestamps would need a different schema.
12. **Money next to a client record** (WS-2): tip and price figures sit on
    rows that name `targetCustomerId` — read as "no PII values; money, time
    and ids allowed" (R36 / T5).
13. **WS-0 quirk** (RU-3): after a refused send, a repeat inside 60 s reads
    "we already sent you a code".
14. **P8 and OR-35:** P8 is recorded in HANDOFF and this plan, not appended
    to OR-35's text.
15. **Planner additions to WS-2's fields** (RU-11, DEP-10a) — 13 fields
    beyond the brief's decided 19, each strike-able.
16. **Single-field exemptions:** 61 today, ≈ 100 after this pass; the per
    database cap is not in the confirmed list (search snippets lacked the
    number; recalled as 200) — confirm on the quotas page before deploy.
17. **Dead-letter constants:** a 24 h retry window and a 15 min last-attempt
    margin; owner-tunable.
18. **Identity Toolkit audit service name** (`identitytoolkit.googleapis.com`)
    unconfirmed — the script header says so.
19. **Out-of-scope edges touched** (brief §5): impersonation read-as (OR-24)
    — rows use `Actor.forCaller`, no IMPERSONATOR actor or claim; no real
    OTP provider (P8 waits for it); no login / OTP audit rows; no `setRoles`;
    no Activity screen (ports only); no existing copy changed.
20. **Client issues joinable to an account** (RU-39, OR-34): an issue's
    `operationId` joins it server-side to a `callable.*` outcome line that
    carries the uid, for the log retention period; the issue struct still
    holds no uid. A strict reading of OR-34 drops `operationId` from
    `ClientIssue` (one field) and keeps `callableName` / `callableErrorCode`.
21. **Merged document-change handler** (RU-40): `GovernedCollection`
    carries `USERS`; the `auditProfileChanges` export keeps its name, its
    path param becomes `{docId}` (a redeploy of the same function).

---

## 8. Ledger (the orchestrator fills it)

| Workstream                      | Packages     | Status | Commit sha                  | Gate result                                                   |
| ------------------------------- | ------------ | ------ | --------------------------- | ------------------------------------------------------------- |
| WS-0 — OTP sender gated         | P0           | GREEN  | `1f027ee`                   | static gate + `verify:p0` + `e2e:web` 63/63 (§6.3 "After C0") |
| WS-4.1 — operation ids          | P1, P2, P3   | TODO   | ‹fill›                      | ‹fill›                                                        |
| WS-1 — rows commit with the act | P4, P5       | TODO   | ‹fill› (shared with WS-4.4) | ‹fill›                                                        |
| WS-2 — before/after deltas      | P7           | TODO   | ‹fill›                      | ‹fill›                                                        |
| WS-4.4 — `auditOperationId`     | P4, P5       | TODO   | ‹fill› (shared with WS-1)   | ‹fill›                                                        |
| WS-7 — reviewable trail         | P6           | TODO   | ‹fill›                      | ‹fill›                                                        |
| WS-3 — privileged / governed    | P8, P9a, P9b | TODO   | ‹fill›                      | ‹fill›                                                        |
| WS-4.2–4.6 — correlation        | P10–P14      | TODO   | ‹fill›                      | ‹fill›                                                        |
| WS-5 — web error capture        | P15          | TODO   | ‹fill›                      | ‹fill›                                                        |
| WS-6 — platform backstop        | P16, P17     | TODO   | ‹fill›                      | ‹fill›                                                        |

Statuses: TODO / IN-PROGRESS / GREEN / BLOCKED. On resume, continue from
the first non-GREEN row; never redo a GREEN one. The records (brief §10,
the way pass F's `9512f6d9` did): HANDOFF §2 row "Audit hardening (Phases
0–2)"; a new reference-numbers block at the top of §4 (§6.3's final column);
the DEPs and the §7 owner flags appended at the end of §3.3 in the pass-F
format; the carried list pruned and extended — at least with: the
`maxPartySize` cap (§0.5, proposed, not built); Auth custom claims
unaudited until a `setRoles` callable exists; cancel / transition / arrival
/ clear / tip mint a new id per tap (no unsettled-name memory, R7); `blockReason`
and `blockedUntilUtcMs` not audited (WS-3 inventory R11); the Identity
Toolkit audit service name and the single-field exemption cap
unconfirmed (§7 items 16, 18); preflight P8 flips with a transactional
sender; governed rows carry `auditOperationId: null` even when the document
holds a `writeOperationId`; the OR-34 privacy-line rewording (§7 item 9);
DEP-4's wire skew and the deploy order (§7 item 7); the OR-34 / operation-id
join (§7 item 20); this ledger filled, with a
per-package file list, every integrator edit beyond the packages, and every
spec count that dropped explained.
