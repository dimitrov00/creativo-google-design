# Goldfish Review Report

**Target:** `/Users/dimitardimitrov/Projects/Creativo/creativo-google-design/docs/designs/staff-permissions.md` (`1-642`)

**Round:** 1 (first review round; stage 0 built, stage A not started). **Date:** 2026-11-14.

## Reviewer Status

| Reviewer                       | Status    |
| ------------------------------ | --------- |
| `egm-design`                   | completed |
| `egm-codebase-details`         | completed |
| `egm-zoom-out`                 | completed |
| `egm-comprehension`            | completed |
| `egm-implementation-readiness` | completed |
| `egm-structural`               | completed |

One instance of each, run in parallel. No reviewer failed or was retried.

**Totals after deduplication:** 2 Blockers, 24 Major, 25 Nits.

**Conventions.**

- `L###` is a line of the target document. Section ids are the document's own (P1–P12, G1–G4, O1–O7, R1–R6, stages 0/A/B/M/C/D).
- Code is cited repo-relative to `/Users/dimitardimitrov/Projects/Creativo/creativo-google-design` as `path:line`.
- "(platform knowledge)" marks a statement about Firebase behaviour that rests on a reviewer's knowledge and not on anything in the repository.
- Severity: Blocker = building stage A on this would be wrong or would have to be redone; Major = a real gap or error that needs a decision or a rewrite of a section; Nit = smaller. Where reviewers rated the same finding differently, each rating is listed beside the lens and the consolidated severity follows that definition.
- Where reviewers recommended different remedies, both are kept and attributed.
- The synthesizer re-read these citations because reviewers disagreed on line numbers or on the fact, and found them accurate: `firestore.rules:191-193`, `:215-216`, `:415-417`, `:808-815`; `apps/functions/src/wire/triggers.wire.ts:292-295`; `libs/ecs-core/src/pipelines/staff-analytics.pipeline.ts:127-136`; the port members and query bodies of `libs/infrastructure/firestore/src/lib/appointments.adapter.ts`; the absence of any "slice 5" in `docs/designs/team-onboarding.md`. Every other citation is as the reviewer reported it.

## Prioritized Findings (Blockers -> Major -> Nits)

### B1. A stored role list per capability pins every level, so a level or a per-level default that arrives later is silently lost - Severity: Blocker

- **Reviewer Lens:** `egm-design` (Blocker), `egm-zoom-out` (Blocker), `egm-implementation-readiness` (Blocker), `egm-codebase-details` (Major)
- **Affected Scope:** P5 (L312–348; L319–320, L328–333, L338–339); Alternatives Weighed (L194–196, L204–207); P1 (L229–234); P2 (L242–244); P12 (L527); stage A (L602–604); stage M (L619–620); O2, O3 (L578–580), O6 (L588)
- **Discrepancy Description**:
  - The unit of departure is the field, and a field is a whole role list (L319–320, L328–331). Narrowing one level freezes every other level's answer for that capability, including a level that does not exist yet.
  - Worked case, reached independently by three reviewers: after stage A the owner narrows barbers on `BOOKINGS_MANAGE` (or takes `HOURS` from the front desk). That stores, for example, `bookingsManageAllRoles: ['receptionist','admin','sysadmin']`. Stage M ships "any time after A" (L619–620) with a manager default of `ALL` (L249, L251). `manager` is in no stored list, so the server guard and the rules' `.get(field, standard)` both answer `NONE` for managers on that capability, and the default everywhere the owner never edited.
  - The guard cannot tell "the owner removed it" from "it did not exist when the list was saved". That is the objection the document raises against the per-level list at L204–207, moved from the capability axis to the level axis.
  - `Role` has no `manager` today (`libs/ecs-core/src/components/role.data.ts:15-22`). An unknown role in a list grants nothing (`libs/ecs-core/src/components/roles.data.ts:171-183`). `docs/designs/team-onboarding.md:1000-1003` anticipates a further level (a narrower role for course students).
  - Claims that fail as a result:
    - "A capability shipped later needs no migration, and a shop that never touched a capability follows a corrected default" (L331–333). It holds for a new capability. It fails for a new level and for a corrected default of any other level of a touched capability.
    - "The stored shape (P5) does not rule it out" (L194–196, O6).
    - "a per-person list of departures on the account fits the same model" (L579–580, O3).
  - The callable input (L378), the audit element (L513) and the screen (L480–483) all speak in (level, capability) cells. Only storage speaks in lists, for one stated reason: one `hasAny` in the rules (L338–339).
- **Rationale & Recommendation**: Decide before the entity, the guard, the planner and the audit diff are built. State in Staging that O2 must be closed before A. The reviewers gave three options:
  - **(a) One scalar per cell** (preferred by `egm-design` and `egm-zoom-out`). One fixed root field per (editable level, capability) holding a `GrantScope` tag or `null`, for example `barberHoursScope: 'OWN'`; absent or `null` means that level's code default.
    - 64 fixed names for four editable levels, no dynamic keys, no arrays.
    - `admin` and `sysadmin` never appear in the document, so P4 holds by construction and the guard needs no "add back" or "drop from Own" step.
    - The audit element, «3 промени» and «Върни стандартните» map one-to-one to fields.
    - A later level or capability has no fields and reads its defaults.
    - The rules helper becomes one clause per editable level, for example `'barber' in roles() && perm.get('barberClientCardScope', 'ALL') == 'ALL'`. Building a key by string concatenation is already done at `firestore.rules:389`.
    - Cost: L196 must be corrected, because owner-named levels would then need one document per level.
    - Per-shop scoping (excluded at L181–182) would be a new tag value; with lists it is a third list per capability.
  - **(b) Keep the lists** (preferred by `egm-implementation-readiness`, because it keeps the single `hasAny`). Put `Role.Manager` in the `Role` dictionary and in `StaffPermissions.DEFAULT` in stage A, inert: outside `Roles.STAFF` and `Roles.ASSIGNABLE` until M. State in P5 that any later level or per-level default correction needs a one-off rewrite of `settings/staffPermissions`. Drop the no-migration claim for levels. Define the mixed-list rule (M1) and resolve the partial-document question (M2).
  - **(c) Store departures per role** (added and removed lists per field), listed by `egm-codebase-details` and `egm-implementation-readiness` without preference.

### B2. All sixteen capabilities can be edited, saved, audited and shown before most are enforced - Severity: Blocker

- **Reviewer Lens:** `egm-comprehension` (Blocker), `egm-implementation-readiness` (Blocker), `egm-structural` (Blocker), `egm-design` (Major), `egm-zoom-out` (Major), `egm-codebase-details` (Major)
- **Affected Scope:** Staging (L593–594, L602–611, L626–627); P2 "Stage" column (L246–263); P6 (L377–381); P8 (L431–440); P10 (L476–507); Goals (L167–168); Alternatives Weighed (L211–212)
- **Discrepancy Description**:
  - Stage A ships "the catalogue, the defaults" and `setStaffPermissions` (L602–605). Its system refuses only "a role that is not editable and a scope the capability does not have" (L378–380). Nothing refuses a capability whose enforcement has not shipped.
  - The Team-screen stage then ships «Права» with all sixteen rows (L478–483, L490–507) and moves the web gates for `VISIT_REPRICE`, `CLIENT_SPEND`, `CLIENTS_SEARCH` and the programmes and loyalty routes to the document (L435–440).
  - By the Stage column, six capabilities are enforced at A, ten after B, fourteen after C. `BOOKINGS_VIEW` and `CLIENT_CONTACT` are enforced only if D's "go or no-go" (L626–627) is a go. The "Stage" column is never defined.
  - In the window, the booking callables still gate on the token's `Roles.BOOK` (`apps/functions/src/wire/booking.wire.ts:283`, `:450`, `:572`, `:662`, `:1068`) and the rules still use fixed lists (`firestore.rules:54-60`, `:192-193`, `:440`, `:699-711`).
    - A narrowing of `BOOKINGS_MANAGE` is stored, audited, shown in «Какво може», hidden in the web, and still honoured by the server. That is the "Hiding things in the web only" alternative rejected at L211–212.
    - A widening shows an entry point the server or the rules refuse: `VISIT_DISCOUNT` (`libs/ecs-core/src/systems/billing.system.ts:601`), `CLIENTS_SEARCH` (`firestore.rules:192-193`), `CLIENT_SPEND` (`firestore.rules:440`). The `CLIENTS_SEARCH` case recreates G4.
    - The saved value takes effect unannounced on the day B or C deploys.
  - This contradicts "A change applies to the next call" (L167–168) and "changes no behaviour until the owner edits something" (L593–594).
  - A D no-go leaves two rows permanently inert, and turns "sixteen" and "twenty-five" into fourteen and twenty-two.
  - The `NONE`/`ALL` conversion of the `appointments` rule for `BOOKINGS_VIEW` is in no stage (`egm-codebase-details`).
- **Rationale & Recommendation**: The fix lands in stage A's own callable and planner, which is why three reviewers rate it a Blocker.
  - Preferred by five reviewers: the catalogue carries a code constant of enforced capabilities, grown by each stage's change. `setStaffPermissions` refuses a change to any other (this needs a refusal code, see M7). «Права» and `StaffAccessService` hide an unenforced capability or read it as its fixed default; the rest keep today's role gates. The screen is data-driven, so it is still written once.
  - Keep `BOOKINGS_VIEW` and `CLIENT_CONTACT` out of the catalogue until D's spikes pass, and state what a D no-go does to the counts.
  - Move the `NONE`/`ALL` half of `BOOKINGS_VIEW` to stage C.
  - Alternatives: move B and C ahead of the Team screen (`egm-implementation-readiness`); or the Team screen takes `StaffAccessService` and the lane gates now and «Права» ships after B (`egm-zoom-out`). Either way drop "written once" (L611) or make it true.
  - Define the "Stage" column and add an "editable from" rule (`egm-structural`).

### M1. The guard's behaviour for an empty, unknown, mixed or malformed field is undefined, and the server and the rules give different answers for one document - Severity: Major

- **Reviewer Lens:** `egm-comprehension` (Blocker), `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-structural`, `egm-zoom-out` (all Major)
- **Affected Scope:** P4 (L302–310); P5 (L314–315, L319–321, L334–337); P7 (L388–399); R3 (L559–561)
- **Discrepancy Description**:
  - L334–336: "Per field it keeps a list of known roles or falls back to the default, adds back the locked members (P4), and drops from `Own` a role that is also in `All`." The sentence has two readings for a list that mixes known and unknown roles: drop the unknown members (what `Roles.known` does, `libs/ecs-core/src/components/roles.data.ts:176-183`), or reject the whole field to the default.
  - L397: `hasAnyRole(permissions().get(field, standard))`. The rules apply no guard.
  - Per stored value (`egm-comprehension`'s table, confirmed by four other reviewers):

    | Stored field              | Guard, as written                                     | Rule, as written                                               |
    | ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
    | absent                    | default (L331, L339)                                  | `standard`                                                     |
    | `[]`                      | not stated                                            | nobody but admin                                               |
    | `['typo']`                | two readings: `[]`, or the default                    | nobody but admin                                               |
    | `['receptionist','typo']` | two readings: keep receptionist, or the whole default | receptionist                                                   |
    | not a list                | default                                               | `hasAny` on a non-list raises, so refused (platform knowledge) |

  - `[]` is an ordinary app-written value: a barber moved from `OWN` to `NONE` on `HOURS` leaves `hoursOwnRoles: []`, and Own fields have no locked member. The text never says an empty list is kept and not treated as missing.
  - "Known roles" is undefined. `client` is a known role (`libs/ecs-core/src/components/role.data.ts:16`; `libs/ecs-core/src/components/roles.data.ts:167-169`).
  - The fallback fails open. The precedent's reason is the availability of a public page (`libs/ecs-core/src/components/booking-policy.data.ts:138-144`). For a grant list, falling back to the default restores access the owner removed. One bad field therefore gives three answers: callables grant the default, rules deny all staff, and the web (same guard) shows entry points the rules refuse. `settings` is not a guarded collection in the transaction reader (`apps/functions/src/adapters/firestore-tx.adapter.ts:67-73`), so nothing else catches it.
  - The helper does not implement P4. It adds back `admin` only (L396). `sysadmin`'s place then depends on the stored list. L319 shows `admin` and `sysadmin` inside a stored list, but no sentence says the save writes them, and nothing says the guard removes a `sysadmin` added by hand (L309–310, "cannot add or remove").
  - "Every field is a list of roles" (L314–315) contradicts `writeOperationId` (L321).
  - R3's parity spec covers the defaults only, not these cases.
- **Rationale & Recommendation**: Add one normative paragraph to P5, pin it in the parity spec and in stage A's exit, and give the rules helper the same answers without an evaluation error.
  - Absent field: the default.
  - A list: (stored ∩ editable roles) ∪ locked(field), where locked(field) is `admin` plus `sysadmin` where the default has it. Unknown strings and `client` are dropped, as `Roles.known` does. `[]` or an all-unknown list means nobody but the locked members.
  - Present but not a list: reviewers differ. `egm-design`: locked members only, plus a logged refusal line (fail closed). `egm-comprehension` and `egm-implementation-readiness`: the default, with the rules helper falling back to `standard` unless the value `is list`. Pick one and make both enforcement points agree; `egm-design`'s form for the rules is `v is list ? hasAnyRole(v) : false`.
  - State that the planner always writes the locked members.
  - Reword L314.
  - Under B1 option (a) there are no lists; the same paragraph is then needed for a scalar that is not a known `GrantScope` tag.

### M2. The stored sparse document is not the entity (Laws 5 and 6), the cited precedent does not carry the shape, and "Indexes: none" contradicts applied practice - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-implementation-readiness`, `egm-comprehension`, `egm-zoom-out`, `egm-structural`
- **Affected Scope:** P5 (L328–333, L337, L340–345); P12 (L538–539)
- **Discrepancy Description**:
  - L343–345 defines `StaffPermissionsSettings = { id } & StaffPermissions & WriteProvenance`, twenty-five present fields. The document holds "only the fields the owner changed" and a save deletes fields (L329–330). One name covers two shapes.
  - `CLAUDE.md` Law 5: "A document body **is** the flat entity minus `id` … There is no `fromFirestore`/`toFirestore`/`reconstitute` layer." `.claude/rules/firestore-layout.md`: "If a stored shape and an in-memory shape disagree, change one so they agree." `.claude/rules/ecs-components.md` bans optional properties; absent is `null`. `Partial<>` would add optional properties.
  - `tx.get<E>` casts the body to the entity (`apps/functions/src/adapters/firestore-tx.adapter.ts:218-229`; `libs/ecs-core/src/ports/tx.port.ts:71`).
  - Law 5's "pattern plus its departures" is about one document per departing day, not absent fields (`egm-design`).
  - The precedent is narrower than L337 and L345 imply:
    - `BookingPolicySettings` declares all seven fields (`libs/ecs-core/src/entities/booking-policy-settings.entity.ts:5-18`) and tolerates absence only in a comment (`:8-12`).
    - The seed writes every field, with the reason recorded: a missing document and a read default are indistinguishable on screen (`tools/seed/fixtures/settings.fixtures.ts:1-14`, `:42-51`).
    - It is read outside any transaction on purpose, by a cast and a guard (`apps/functions/src/adapters/firestore-settings.adapter.ts:13-21`, `:28-32`), no rule reads it, and nothing writes it (`firestore.rules:810-814`).
    - So it is precedent for the read guard only: not for departures-only storage, in-transaction reads, a rules fallback or "no seed".
  - "Indexes: none" (L538): `.claude/rules/firestore-layout.md` requires a `fieldOverrides` entry for arrays never queried, and the file already does it for every such array and every `writeOperationId` (`firestore.indexes.json:405-421`, `:495-496`, `:1006-1007`).
- **Rationale & Recommendation**: Choose one and say so in P5.
  - Store every field always, with `null` for "follows the default". The guard reads a field missing on an older document as `null`, as `writeOperationId` is already treated (`egm-design`).
  - Or obtain an owner ruling that sanctions a sparse settings document, and type the stored body separately from the resolved component (`DocBody`/`StoredFields` in both directions; `StaffPermissions` is the resolved value only).
  - If lists stay, add the 26 `fieldOverrides` entries (25 lists and `writeOperationId`). Under B1 option (a) there are no arrays.
  - Say how the "document exists" path is exercised without a seed (an integration helper that seeds `settings/staffPermissions`).

### M3. Two of stage A's callables have no transaction to read in, and P12 gives the server no read port - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (Blocker, "contradicts code"), `egm-design`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness` (all Major)
- **Affected Scope:** Overview (L41–43); fact 3 (L86–88); P6 (L357–360); P12 (L532–535); Cost (L543–545, L549); stage A (L602–607); Alternatives Weighed (L208–210)
- **Discrepancy Description**:
  - L357–358: "Each pipeline reads `users/{caller}` and `settings/staffPermissions` in the read step of its one commit." L532–533: "The server reads through the transaction it already has."
  - `staffAnalytics` has no transaction. Its ports hold no `CommitPorts` (`libs/ecs-core/src/pipelines/staff-analytics.pipeline.ts:127-136`) and the caller is read through `ports.loadProfile` (`:204-215`, `:212`). The report reads about 5,000 documents for a shop-year (`apps/functions/src/main.ts:944-951`).
  - `setAnalyticsGoal` reads the caller with `loadProfile` before its commit (`libs/ecs-core/src/pipelines/set-analytics-goal.pipeline.ts:110`). Its transaction reads nothing: "Nothing is read inside the transaction" (`:64-65`), `async () => null` (`:158-160`, `:200-201`).
  - Fact 3's "inside their transaction" (L72, L86–88) is true only for the nine roster and team calls and `setRoles`. The three privacy calls and `runBackfill` also read stored roles outside a transaction (`libs/ecs-core/src/pipelines/export-client-data.pipeline.ts:125`, `erase-client.pipeline.ts:199`, `run-backfill.pipeline.ts:676`).
  - One shared reader of the caller and the document over `ReadTx` (L534–535) cannot be built for two of stage A's eleven conversions.
  - The cited precedent reads its settings document outside any transaction on purpose (`apps/functions/src/adapters/firestore-settings.adapter.ts:12-22`), and that is the existing rule in the booking pipelines (`libs/ecs-core/src/pipelines/book-appointment.pipeline.ts:297`, `edit-appointment.pipeline.ts:277`).
- **Rationale & Recommendation**:
  - Add a named read bundle beside `PolicyReadPorts`, for example `StaffPermissionsReadPorts { loadStaffPermissions }`, implemented in `apps/functions/src/adapters/firestore-settings.adapter.ts` through `StaffPermissions.read` (a new Law 9 bundle and adapter).
  - Decide per callable and say so: roster and team read in the transaction, as written; `setAnalyticsGoal` either moves the caller and document reads and the scope decision into its commit, or judges on a non-transactional read; `staffAnalytics` judges on a non-transactional read with the staleness stated ("the next call", not atomicity).
  - Make the shared reader two functions: one over `ReadTx`, one over ports.
  - Weigh in Alternatives reading the caller and the document immediately before the transaction for every call. It also applies to the next call and changes no read set; only a per-instance cache is rejected today (`egm-design`). `egm-zoom-out` recommends the opposite split: one server read port for the document used by every converted pipeline, with `users/{caller}` kept in the transaction where one exists.
  - Rewrite fact 3, P6, P12 and Cost to match.

### M4. `settings/` is not a neutral home: every save fires a full capacity sweep, the audit skip does not cover settings, and the read rule cannot be narrowed by adding a match - Severity: Major

- **Reviewer Lens:** all six (`egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`)
- **Affected Scope:** P5 (L314, L346–348); P11 (L515–518); Cost (L541–549); P12 (L536–537); stages A and C (L602–607, L622–624)
- **Discrepancy Description**:
  - **Capacity sweep.** `rebuildCapacityOnSettingsChange` listens on `settings/{docId}` and passes no document id (`apps/functions/src/main.ts:651`, `:1228-1236`). `decodeCapacityEvent` maps any settings write to a whole `Sweep` (`apps/functions/src/wire/triggers.wire.ts:292-295`). `libs/ecs-core/src/pipelines/rebuild-capacity.pipeline.ts:301-316` then rebuilds every rostered barber over the horizon. The Cost section does not count this.
  - **Policy recompute.** `recomputeClientStatsOnPolicyChange` (`apps/functions/src/main.ts:1319`) also fires, and exits on the id (`libs/ecs-core/src/pipelines/start-policy-recompute.pipeline.ts:71`).
  - **Audit.** L515–518 states as fact that `GovernedChangeSystem.auditedByCallable` skips the settings trigger's generic row for a stamped write. Today it admits `barbers` and `services` only (`libs/ecs-core/src/systems/governed-change.system.ts:276-282`), and never a deletion or a write that leaves the stamp unchanged (`:245-247`, `:251-261`, `:272-274`). `auditSettingsChanges` (`apps/functions/src/main.ts:765`) would write a second, generic row. P12 lists no such change.
  - **Read rule.** "Reading narrows to staff for this one document" (L347–348) names no mechanism. `match /settings/{docId} { allow read: if true; }` (`firestore.rules:808-815`). Overlapping allows are OR'd, as the file itself records (`firestore.rules:215-216`), so a second, narrower match leaves the document world-readable.
  - **Stage.** Rules work is listed only under C (L622–624). From stage A the callable creates the document, so it is world-readable until C. The file also records a retry loop from a denied settings read (`firestore.rules:805-807`), so a client or anonymous session must not subscribe.
- **Rationale & Recommendation**: Add Triggers and Rules bullets to P12 and make these stage A items.
  - Filter the capacity trigger by document id: the decoder returns `null` unless the id is `BOOKING_POLICY_DOC`, as `start-policy-recompute.pipeline.ts:71` already does. The alternative is to put the document outside `settings/`; state which. Add the trigger invocations to Cost.
  - Add `Settings` to `auditedByCallable`, and state that the document is never deleted (a full reset writes an empty body).
  - Rewrite the wildcard as `allow read: if docId != 'staffPermissions' || isStaff();`. `egm-implementation-readiness` and `egm-structural` place it in stage A because the document exists from A; `egm-design` places it no later than the Team-screen stage, which needs it. State that only staff sessions subscribe.
  - Add emulator cases beside `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts:1303`: anonymous and client refused, barber allowed, absent document readable by staff.

### M5. `OWN` is vacuously true for a call that names no barber, and analytics does not fit `admit` - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-comprehension`, `egm-codebase-details`, `egm-implementation-readiness`
- **Affected Scope:** P3 (L285–298); P6 (L352–356); P2 (L258); P8 (L428)
- **Discrepancy Description**:
  - L285–286: "`OWN` admits an act when the caller's record is the barber of everything the act changes." That holds for an empty set.
  - Empty scopes are real. In analytics, naming none means the whole team (`libs/ecs-core/src/systems/staff-analytics.system.ts:131-137`). Today a barber who names none is narrowed to their own record and an admin's empty ask is the whole shop (`:1777-1803`, `:1786-1802`). `admit` returns a `Result` and cannot express a narrowing.
  - A location scope is for shop readers only (`:1751-1767`, `:1756-1758`).
  - There is a distinct `ANALYTICS_BARBER_NOT_LINKED` (`:1796-1798`).
  - A colleague's goal is settable by nobody else, the admin included: an admin naming a colleague gets `ANALYTICS_GOAL_FORBIDDEN` (`libs/ecs-core/src/pipelines/set-analytics-goal.pipeline.ts:47-50`, `:127-129`; `staff-analytics.system.ts:2077-2093`, `:2086-2093`). P3's "`ALL` on any level the account holds wins" (L298) and L258 would admit it, which changes today's behaviour and contradicts "the defaults reproduce today's behaviour exactly" (L170).
  - The text does not say what `changedBarberIds` is for a shop-wide capability, or for a staff «Който и да е» booking where the server picks the barber. The booking wire passes seat barber ids as raw strings (`apps/functions/src/wire/booking.wire.ts:210-223`).
- **Rationale & Recommendation**:
  - Give `admit` an explicit target: `BARBERS` with a non-empty parsed list, or `SHOP`, which needs `ALL`. Any other scoped call with an empty or unparsable set is refused.
  - State that analytics asks `scopeOf` only and keeps its own rules. The mapping: `NONE` refuses; `ALL` behaves as today's shop reader; `OWN` needs a link and resolves none-or-own to the own record; the location scope needs `ALL`; `goalScopeAllowed` stays as a domain rule after access is admitted.
  - Reword L258 so it does not read as "`ALL` sets every barber's goal".
  - Name which analytics codes survive (see M7).

### M6. The `StaffAccessSystem` contract and the meaning of "converted" are not fixed; a departed barber record is not addressed - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-comprehension`, `egm-design` (Nit, the departed record)
- **Affected Scope:** fact 5 (L99–102); P3 (L287–289); P6 (L352–356, L367–372); stage A (L602–607)
- **Discrepancy Description**:
  - "`admit(...)` answers a `Result`" (L353–354) names no value type and no error-per-case table.
  - Today's callers need different things back: the `Barber`, with not-found and departed asked after the caller check (`libs/ecs-core/src/systems/roster-access.system.ts:40-62`); the stored `User` for the audit actor (`libs/ecs-core/src/systems/team.system.ts:203-227`; `libs/ecs-core/src/pipelines/edit-barber.pipeline.ts:218`).
  - `users.roles` is read raw (`libs/ecs-core/src/systems/role-assignment.system.ts:186-188`), so the `roles` parameter must tolerate claims-shaped input.
  - L288–289 says "This is today's `RosterAccessSystem.admit` and `admitDays`", L352 says "One pure system", and L370–372 says the domain refusals "retire as each callable converts". The text does not say what remains of the three own-only systems.
  - The document never mentions `DEPARTED`. Roster and profile edits refuse a departed record (`roster-access.system.ts:59-61`; `team.system.ts:153-157`); `OWN` on `BOOKINGS_MANAGE` and `ANALYTICS` would not.
  - `egm-comprehension`: team onboarding's close job that strips a leaver's roles and link has no export in `apps/functions/src/main.ts`, so a leaver's account keeps `barber` and its link until «Роли» is changed. `egm-design` reports the same point as unverified.
- **Rationale & Recommendation**:
  - Print the two signatures and one decision table: missing, blocked, erased, no staff role, or `NONE` answer `ACCESS_DENIED`; `OWN` with no link, or with any named barber other than the link, answers `ACCESS_OWN_ONLY`; `OWN` with no barber named refuses (analytics passes the resolved own id); a shop-wide capability answers only `NONE` or `ALL`. Return the stored `User`.
  - Add a conversion recipe (order of gate, reads, `admit`, domain checks) and a keep / move / delete table for each existing check. Keep `RosterAccessSystem`'s record checks (`withinShops`, departed) and say they run after `admit`.
  - Add one line on departed records: what `OWN` means when the linked record is `DEPARTED`, for each scoped capability.

### M7. The error design leaves seven choices open, and `TEAM_FORBIDDEN` cannot retire - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-structural` (part of its Blocker), `egm-comprehension`, `egm-zoom-out` (Nit), `egm-design` (Nit)
- **Affected Scope:** P6 (L367–372, L377–381); P2 (L275–276); P11 (L513)
- **Discrepancy Description**:
  - **`TEAM_FORBIDDEN` cannot retire.** `admitActivation` uses it (`libs/ecs-core/src/systems/team.system.ts:237-246`), and P2 leaves `activateBarber` at the fixed staff tier (L275–276). Stage A's "the roster, team and analytics callables converted" (L604–605) is eleven callables by L87–88 and the exports at `apps/functions/src/main.ts:897`, `:913`, `:932`, `:953`, `:971`, `:988`, `:1005`, `:1023`, `:1040`, `:1057`, `:1073`; P2's A rows name ten.
  - **`ANALYTICS_BARBER_NOT_LINKED`** is not in the retire list. It is a distinct `failed-precondition` (`libs/ecs-core/src/errors/analytics.error.ts:22`; `apps/functions/src/edge.ts:436`) that the web store branches on (`libs/features/staff/analytics/src/lib/staff-analytics.store.ts:1035-1036`). L283–284 says "refused" without a code.
  - **Field name.** `{ capability }` breaks Law 1's "dictionary named after the field" (precedent `barberEdit: BarberEdit`, `libs/ecs-core/src/components/team-call.data.ts:26`).
  - **Wire rows.** The new dictionary needs `EDGE_DICTIONARIES` and `EDGE_WIRE` entries (`apps/functions/src/edge.ts:107-137`, `:433-444`, `:811-842`). `capability` leaves the server only if it is in `WIRE_PARAM_ALLOWLIST` (`libs/ecs-core/src/errors/pipeline.error.ts:126-134`; `apps/functions/src/edge.ts:83-93`). Without the row, "worded per capability" (L369) is impossible.
  - **Words.** The convention is `errors.<errorCode>` in `libs/infrastructure/i18n/src/assets/i18n/{bg,en}.json`. The per-capability key shape is not given.
  - **Wire-gate refusal.** The is-staff gate's refusal code is not given. Today it is `SCHEDULING_ROSTER_FORBIDDEN` (`apps/functions/src/wire/roster.wire.ts:78-80`) or `ANALYTICS_FORBIDDEN` (`apps/functions/src/wire/analytics.wire.ts:57-59`).
  - **Editor refusals.** `setStaffPermissions` has no codes for its own refusals (role not editable, scope not available, invalid input, and under B2 "capability not live").
  - "and the booking ones" (L371–372) is not enumerated.
  - Churn (`egm-zoom-out`): the four named codes and their factories occur 75 times across 34 files, including i18n and web stores.
- **Rationale & Recommendation**: Decide each in P6. `egm-implementation-readiness`'s set:
  - Keep the per-domain `*_UNAUTHENTICATED` codes. The wire answers `ACCESS_DENIED` with the callable's capability (`editBarber`'s chosen by `barberEdit`).
  - Keep `TEAM_FORBIDDEN` for `activateBarber` only, and keep `ANALYTICS_BARBER_NOT_LINKED`.
  - Rename the fields `staffCapability` (and decide `role`).
  - Word it as one sentence per code with the capability's label interpolated; the sixteen labels exist in P10. Put the words and the analytics store's switch in stage A.
  - Add an 11-row callable table to stage A: converted or stays, wire gate, refusal code (`egm-structural`).
  - `egm-zoom-out`'s alternative: in A, map an access refusal to each domain's existing forbidden code and add `ACCESS_OWN_ONLY` only if a screen must say "own only". The document should weigh this against the new dictionary.

### M8. `setStaffPermissions` is under-specified as a callable - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-structural`, `egm-zoom-out` (Nit)
- **Affected Scope:** P6 (L377–381); P11 (L511–518); P12 (L528, L536)
- **Discrepancy Description**:
  - **Wire.** No call component name, fields, answer or cap is given. `wiredCallable` needs a `CallableWire` entry (`libs/ecs-core/src/ports/callables.ts:96`), and four tables are total over `CallableName` (`:50`, `:319-321`, `:376-378`, `:447-449`).
  - **App Check.** The token class is undecided; `setRoles` is limited-use (`libs/ecs-core/src/ports/callables.ts:371-374`, `:402`).
  - **Pinned counts.** The export count is pinned at 65 and the limited-use set at five (`apps/functions/src/main.spec.ts:1613`, `:3050`).
  - **Write plan.** "Plans the fields to set and to delete" (L380) implies an `Update`, but an `Update` of an absent document rejects (`libs/ecs-core/src/ports/tx.port.ts:115-118`), and the first save has no document.
  - **Audit row.** The context's field names, resource id and id basis are not given (precedent prefixes at `libs/ecs-core/src/components/audit-context.data.ts:803-823`).
  - **Gate.** The token gate and stored-account check for the editor are named only as "`Roles.ASSIGN`" in P4.
- **Rationale & Recommendation**: Specify each.
  - Call shape `{ operationId, changes: [{ staffCapability, role, grantScope }] }`, at most 64 entries; refuse two entries for the same pair.
  - Token gate `Roles.ASSIGN`, then the stored account, as `admitRolesCaller` does. This also fixes O7.
  - `LimitedUse` App Check, with the two pinned counts updated.
  - Always `WriteOp.set` the whole next body, read in the same transaction; never delete the document (see M4).
  - Give the audit context's field names and id basis.

### M9. The token gate is not only at the wire, and a refused call would pay the full read set - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-design` (Nit, the refusal order)
- **Affected Scope:** P6 (L361–364); Cost (L543–545)
- **Discrepancy Description**:
  - "The wire gate becomes 'is staff'" understates the change. Pipelines repeat the token gate: `admitTeamCaller` (`libs/ecs-core/src/pipelines/team-caller.pipeline.ts:39-46`), called at `libs/ecs-core/src/pipelines/list-team.pipeline.ts:59` and `edit-barber.pipeline.ts:172-176`. The wire has a second one for non-profile edits (`apps/functions/src/wire/team.wire.ts:139`, `:268-278`).
  - `listTeam` reads the caller and four whole collections in parallel before it decides (`list-team.pipeline.ts:63-83`). Today the admin token gate stops other staff before those reads.
  - Booking: today a content manager is refused before any read (`apps/functions/src/wire/booking.wire.ts:450-452`, `:1068-1070`). After the change any staff reaches the pre-transaction reads (`libs/ecs-core/src/pipelines/book-appointment.pipeline.ts:297-310`; `edit-appointment.pipeline.ts:277-289`) and the read half's own refusals (`edit-appointment.pipeline.ts:506-541`).
- **Rationale & Recommendation**:
  - Name every gate site that changes, in the wire and in the pipelines.
  - Specify a two-step read: caller and document first, refuse early. `edit-appointment.pipeline.ts:250-260` has a refused-snapshot precedent.
  - State the refusal order as replay, then access, then everything else.
  - `egm-implementation-readiness` confirms that "is staff" at the wire is safe for every stage A callable, since each re-reads the stored account.

### M10. Deleting the fixed lists has no stage, would break the web build in stage A, and leaves the parity spec without a plan - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-structural` (part of its Blocker), `egm-comprehension`, `egm-codebase-details`, `egm-zoom-out` (Nit)
- **Affected Scope:** P6 (L373–376); stage A (L602–604); P7 (L394–398); R3 (L559–561); stages B and C
- **Discrepancy Description**:
  - L373–376 says eight lists "are deleted as lists", with no stage. Stage A lists no web work, and these files read the lists until `capabilityGuard` and `StaffAccessService` arrive a stage later (L435–437, L609–611):
    - `apps/web/src/app/app.routes.ts:150`, `:163` (`ANALYTICS_SELF`, `ANALYTICS_SHOP`);
    - `libs/features/shared/shell/src/lib/identity/session-identity.service.ts:99-104`;
    - `libs/features/staff/analytics/src/lib/staff-analytics.store.ts:217`;
    - `libs/features/staff/dashboard/src/lib/staff-dashboard/analytics-entry.ts:57`;
    - `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts:703` (`MONEY`);
    - `libs/features/staff/client-card/src/lib/client-card.store.ts:2651`;
    - the wire gates at `apps/functions/src/wire/analytics.wire.ts:57`, `:132` and `apps/functions/src/wire/team.wire.ts:275`.
  - The parity spec twins `BOOK`, `MONEY` and `SPEND` (`libs/ecs-core/src/components/role.rules-parity.spec.ts:87-106`). The `MONEY` case pins `Roles.MONEY` to the `users` list clause (`:58-76`, `:97-100`); stage B deletes that list before stage C converts the rule. `Roles.BOOK` is `worksTheBook()`'s twin (`:87-91`) until D.
  - The rules-text reader accepts only no-argument helpers that are a single return of `||`-joined role checks (`libs/ecs-core/src/testing/rules-text.ts:13-16`, `:67-68`, `:161-164`), and its role scan matches only `hasAnyRole([` (`role.rules-parity.spec.ts:108-120`). It works on named helpers (`:84-91`), so it cannot read `granted(field, [...])` with a literal list at each call site (L394–398).
  - `isCatalogManager()` has no code twin at all.
  - L373–376 accounts for 13 of the 14 `Roles` lists (`egm-structural`).
- **Rationale & Recommendation**:
  - Add a list-by-stage table. `egm-implementation-readiness`'s proposal: `ROSTERS`, `TEAM`, `TEAM_PROFILES` in stage A (a grep of `libs/features` found no reader of their predicates); `ANALYTICS_*` with the Team-screen stage; `BOOK` and `MONEY` with B (`BOOK`'s rules twin stays until D); `SPEND` with C.
  - Say what the parity spec compares after each deletion: the rules' `standard` lists against `StaffPermissions.DEFAULT`.
  - Add the reader extension to stage C, or use one named rules helper per governed capability so the existing reader works (`egm-zoom-out`).
  - Account for the fourteenth list.

### M11. Stage A's exit criteria can pass while the stage is wrong - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-structural`, `egm-design` (Nit), `egm-zoom-out` (Nit)
- **Affected Scope:** stage A (L602–607); Goals (L170); P4 (L309–310)
- **Discrepancy Description**:
  - "The spec that pins them to today's lists" (L603) loses its source of truth when the lists are deleted in the same stage (M10).
  - "Narrows a level and sees the next call refused" (L607) passes with the old token gates still in place (`apps/functions/src/wire/roster.wire.ts:78`; `apps/functions/src/wire/analytics.wire.ts:57`; `libs/ecs-core/src/pipelines/team-caller.pipeline.ts:39-46`). It also passes with no audit row, a double audit row, a capacity sweep, or an owner lock-out.
  - There is no exam for: an admin admitted under a hostile document; a widening applying to the next call; a non-admin refused on the stored account with a still-valid token; one audit row and no second generic row; no capacity sweep; the `setStaffPermissions` refusals; the pinned tables of `main.spec.ts`.
- **Rationale & Recommendation**: Replace the exit sentence with named tests, each with its level.
  1. **Characterization spec.** A frozen table of role subset × link (none, own, other) × stage-A act, generated from today's `RosterAccessSystem`, `TeamSystem` and `StaffAnalyticsSystem.scopeOf` before they change. It must equal `StaffAccessSystem` over `DEFAULT`. `egm-zoom-out`'s lighter form: the existing access cases of the roster, team and analytics system specs pass unchanged with no document.
  2. **Per-pipeline specs.** Absent document equals defaults; narrowed refuses; `OWN` on a colleague refuses; widened admits.
  3. **Emulator, through the callable edge** (`functions:test-integration`, `apps/functions/project.json:83`): a content manager's token granted `TEAM_MANAGE` gets `listTeam`; a receptionist narrowed on `HOURS` is refused on the next `setRosterWeek` with the same token; a hand-written `teamManageRoles: []` still admits the admin; one `TEAM_PERMISSIONS_CHANGED` row is written and no trigger row; no capacity sweep; a replay writes nothing.
  4. **Guard property spec.** `read` never throws on arbitrary JSON.

### M12. Stage M has no fixed place: "any time after A" does not hold against the manager's own defaults - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`, `egm-design`
- **Affected Scope:** P1 (L223, L229–234); P2 (L242–263); P5 (L319); P10 (L478); stage M (L619–620); stage C (L622–624); O2, O7
- **Discrepancy Description**:
  - The default table has a «У» column and the P5 example stores `'manager'` from stage A, but the role arrives in M. «Права» lists «Управител» (L223, L478), possibly before the role exists. `Role` has no `manager` (`libs/ecs-core/src/components/role.data.ts:15-22`).
  - P1 adds the manager to `Roles.STAFF`, `Roles.ASSIGNABLE`, `Roles.BOOK`, `isStaff()` and `worksTheBook()` only. P2 also gives the manager discount, reprice, client search and content. Until B and C those sit behind separate hard-coded lists:
    - `Roles.MONEY` (`libs/ecs-core/src/components/roles.data.ts:64`; used at `libs/ecs-core/src/systems/billing.system.ts:601`, `:640` and `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts:700-704`);
    - the `users` list rule (`firestore.rules:192-193`);
    - `isCatalogManager()` (`firestore.rules:58-60`);
    - the programmes route guard (`apps/web/src/app/app.routes.ts:193`).
  - Before B and C, «Права» would show manager grants the server and rules refuse.
  - `storage.rules:24-27` holds its own `worksTheBook()` copy. The parity spec reads `firestore.rules` only (`libs/ecs-core/src/components/role.rules-parity.spec.ts:53-56`), so "holds them equal" (L233–234) does not cover it. Whether another spec pins that list is unverified.
  - `role.rules-parity.spec.ts:97-100` holds `Roles.MONEY` equal to the inline `users` list, so adding `manager` to one side breaks the spec. The spec also fails on a role the rules name that `Role` lacks (`:108-120`), so C's fallback lists cannot name `manager` before M.
  - A functions deploy ahead of the rules lets `setRoles` mint a `manager` token that `isStaff()` and `worksTheBook()` do not know (`firestore.rules:45-56`).
  - Neither owner ask names a manager; the survey supports one (L153).
- **Rationale & Recommendation**: Decide before A.
  - If the manager is in: `Role.Manager` enters the dictionary and the default table with stage A (see B1 option b), and M is ordered after B and C, or M names the manager's interim memberships (`MONEY`, the `users` list rule, `isCatalogManager`, the programmes guard). List every site M edits, `storage.rules` included. State the deploy order: rules, then functions, then web. Extend parity to `storage.rules`.
  - If the manager is out for now: strike it from P1, P2, P5 and P10. Under B1 option (a) a later level costs no stored-data change.

### M13. The catalogue misses staff writes and one read, and several capabilities depend on another's collections with no "requires" rule - Severity: Major

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** P2 (L246–278); glossary (L59–60); P7 (L537); P8 (L435–437)
- **Discrepancy Description**:
  - **In no row and in neither exclusion list:**
    - `appointmentNotes` create, update and delete (`firestore.rules:352-357`);
    - `appointmentPhotos` create and delete (`firestore.rules:381-392`) and their Storage objects (`storage.rules:77-83`, `:79-82`).
    - These are direct browser writes under `worksTheBook()` (`libs/ecs-core/src/systems/governed-change.system.ts:121-124`). `BOOKINGS_VIEW` says "See" (L248); `BOOKINGS_MANAGE` lists callables only (L249). A barber at `BOOKINGS_MANAGE` `OWN` or `NONE` could still write a note on, or delete photos of, a colleague's visit.
    - The glossary's Act is "a change made through a callable" (L59), which excludes them, while `CONTENT` is itself a rules-enforced write (L262).
  - **`LOYALTY`** lists the callable only. `streakDefinitions/{id}/versions/*` is `isAdmin()` (`firestore.rules:490-493`) and the rhythm page reads it (`libs/features/admin/loyalty/src/lib/admin-rhythm.store.ts:1010`). A granted level can publish but is refused the history, and stage B touches no rule.
  - **Dependencies between rows:**
    - `staffEditAppointment` sits under three rows (L249, L252, L253). Nothing says a discount needs `BOOKINGS_MANAGE` as well.
    - `BOOKINGS_MANAGE` without `BOOKINGS_VIEW` (`firestore.rules:281`) is the inversion the code calls "the wrong way round" (`libs/ecs-core/src/components/roles.data.ts:49-56`; `firestore.rules:321-326`).
    - "Honour a coupon or voucher" is `BOOKINGS_MANAGE` (L249), but the visit sheet lists a client's coupon grants (`libs/features/staff/dashboard/src/lib/staff-day.store.ts:1375-1403`; reason at `firestore.rules:253-256`, `:257-261`) and looks up voucher codes (`staff-day.store.ts:1489`; `firestore.rules:730-741`). Both collections are placed under `CLIENT_CARD` (L255).
    - The staff day loads the client (`libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts:3544`) and searches clients to book for them (`:3696`); single `users` documents are under `CLIENT_CARD`.
    - The card's "history" is a query on `appointments` (`libs/features/staff/client-card/src/lib/client-card.store.ts:2787`, `:2856`; `libs/infrastructure/firestore/src/lib/appointments.adapter.ts:346-353`, query body `:165-184`). That is `BOOKINGS_VIEW`'s rule, not one of `CLIENT_CARD`'s.
    - `listTeam` admits the team manager only (`libs/ecs-core/src/pipelines/list-team.pipeline.ts:59`, `:76`) and answers every staff account's roles (`:33`). A content manager holds `TEAM_PROFILES` at `ALL` by default (L259) and would have no list to reach a profile from; the Team screen route sits behind an unnamed capability (L435–437).
  - **Storage dialect.** "The two helpers of P7" (L537) are in Firestore dialect. Storage rules use `firestore.get(/databases/(default)/…)` (`storage.rules:36`).
- **Rationale & Recommendation**:
  - Add the note and photo writes to `BOOKINGS_MANAGE` with their stage, or name them under "Left at the fixed staff tier". Add the versions read to `LOYALTY`'s enforcement, or to "Not configurable".
  - Add a "kind" column (callable, rules write, rules read, route) and a "requires" column to P2 as a closed table: `BOOKINGS_MANAGE` → `BOOKINGS_VIEW`; `VISIT_*` → `BOOKINGS_MANAGE`; `CLIENT_SPEND` and `CLIENT_CONTACT` → `CLIENT_CARD`. `setStaffPermissions` enforces it and the editor shows it. `egm-zoom-out`'s variant: `scopeOf` clamps a dependent to its prerequisite and the editor disables the row.
  - Assign each rules collection to a capability by who reads it, not by screen: decide whether the coupon, voucher and single-user reads follow `BOOKINGS_VIEW` or `CLIENT_CARD`, and which capability card history follows.
  - Decide `listTeam`'s admission in A: `TEAM_MANAGE`, or `TEAM_PROFILES` or `TEAM_OFFERINGS` at `ALL`, and what a non-manager's rows hold.
  - Extend the glossary's Act and Read to cover rules-guarded writes and callable reads.

### M14. The `CLIENTS_SEARCH` default and G4 miss the `customers` half of the search - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` ("contradicts code"). The other reviewers compared the `users` list rule only and reported this default as matching.
- **Affected Scope:** G4 (L125–128); P2 (L242–244, L254–255); P8 (L438–440)
- **Discrepancy Description**:
  - The staff search queries `users` and `customers` together (`libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts:3695-3698`; `libs/infrastructure/firestore/src/lib/customers.adapter.ts:75-90`).
  - `customers` is `allow read: if worksTheBook() || …`, and `read` includes list (`firestore.rules:415-417`).
  - A refused `users` half is skipped and the records are still shown (`libs/features/staff/dashboard/src/lib/visit-editor/client-search.ts:106-113`).
  - So a barber can search the client records today. «—» for Б (L254) is not today's behaviour, against L243–244. The row's enforcement point, "Rules: listing `users`", does not close it. `customers` sits under `CLIENT_CARD` with get and list together (L255).
- **Rationale & Recommendation**: Define `CLIENTS_SEARCH` as list on both collections and split get from list on `customers`. Then either set Б to yes, or record the change as a closed gap, as G1 is. Run the barber's screen, which G4 says was not done (L126–127).

### M15. P3's seat and visit split does not cover the command set, "own" means two things for a visit, and the booking commands carry no caller uid - Severity: Major

- **Reviewer Lens:** `egm-codebase-details`, `egm-comprehension`, `egm-zoom-out`
- **Affected Scope:** P3 (L285–297); P6 (L353–354); O4 (L581–583); R4 (L562); stage B (L613–617)
- **Discrepancy Description**:
  - P3 classifies eleven acts (L292–295). Unclassified (all in `apps/functions/src/wire/booking.wire.ts` unless noted):
    - `transitionAppointment` takes an optional `seatId` (`:469-476`);
    - `MOVE` and `RESIZE` take `seatIds` (`:729-739`, `:886-938`);
    - `ADD_SEAT` names a barber (`:954-1002`);
    - `REMOVE_SEAT` (`:1003-1008`) and `VOUCHERS` (`:1024-1029`);
    - `clearArrival` and coupon honouring;
    - the command set is `libs/ecs-core/src/components/edit-command.data.ts:22-33`.
  - The five booking commands carry `actor` and `actorRoles` but no caller uid (`:307-321`, `:487-494`, `:588-593`, `:692-698`, `:1101-1110`). Stage B's `users/{caller}` read needs one.
  - Two meanings of "own" (`egm-zoom-out`): for acts, own is seat-level (L292–297). For reads, a rule admits a whole document, so own can only mean "my record is in the visit's `barberIds`". Seat-level needs a per-command classification of changed barbers, and puts `changedBarberIds` into the stage A signature for a rule only stage B uses.
  - R4's answer is "needs the front desk"; a shop without one leaves shared visits to the owner. R4 states no mitigation.
- **Rationale & Recommendation**: Two routes; pick one before B and record it under O4.
  - Keep seat-level own (`egm-codebase-details`, `egm-comprehension`): give `changedBarberIds` for each of the ten `EditCommand`s and for each callable, and add the caller uid to the commands.
  - Use one definition (`egm-zoom-out`): a visit is own when the caller's record is in `barberIds`, and moving a seat to or from a colleague needs `ALL`. This overturns O4. The cost is that an `OWN` barber can act on a shared party.

### M16. `OWN` means nothing on a level that cannot hold a link - Severity: Major

- **Reviewer Lens:** `egm-design` (Major), `egm-zoom-out` (Major), `egm-comprehension` (Nit)
- **Affected Scope:** P3 (L282–284); P5 (`…OwnRoles`); P10 (L480–482)
- **Discrepancy Description**:
  - A link exists only on an account that holds `barber`. `libs/ecs-core/src/systems/role-assignment.system.ts:283-288` refuses a link without the role, and `:301-302` clears it when the role goes (`:279-302`).
  - So «Само своите» on «Рецепция», «Съдържание» or «Управител» refuses everyone who is not also a barber (L283–284). An owner choosing it for the front desk on `TIME_OFF` has switched the capability off under a label that says otherwise.
- **Rationale & Recommendation**: Offer `OWN` only on the `barber` level, in the editor and in `setStaffPermissions`, and say so in P3.

### M17. Catalogue grain: four rows to cut or merge, and two cheaper shapes are not weighed - Severity: Major

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** P2 (L246–263); Alternatives Weighed (L188–212); survey (L133–138); stages C and D
- **Discrepancy Description**:
  - Rows:

    | Item            | Finding                                                                                                                                                                                                                                                                                                                      |
    | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `VISIT_REPRICE` | No screen offers a price field (L115). The only web gate is the discount arm (`libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.html:1381`). Code has one list and one predicate for both (`libs/ecs-core/src/components/roles.data.ts:64`; `libs/ecs-core/src/systems/billing.system.ts:601`, `:640`). |
    | `CONTENT`       | It is the `content_manager` level. An account holds a set of levels (L227), so stacking already grants it, which is O3's own argument (L578–579).                                                                                                                                                                            |
    | `LOYALTY`       | Default is nobody. Granting it also needs the `versions` read, which is `isAdmin()` (`firestore.rules:490-492`) and is in no row.                                                                                                                                                                                            |
    | `CLIENT_CARD`   | Same list as `BOOKINGS_VIEW` today (`firestore.rules:281`, `:416`, `:431`, `:503`, `:524`, `:739`), and entangled with it (M13).                                                                                                                                                                                             |

  - **Fixed levels plus a short list of switches** is Booksy's shape (L136) and is not weighed. `OWN` can only apply to accounts holding `barber` (M16), and all three owner examples are barber-to-colleague (L265–268).
  - **Rules stay role-based, only callables configurable** is stages A and B, and covers two of the three examples. Stage C's four rows are not among the examples. P7's machinery is justified only by `BOOKINGS_VIEW` at `OWN` and the client-privacy rows.
- **Rationale & Recommendation**:
  - Twelve rows: merge reprice into one "money on a visit" row, leave `CONTENT` and `LOYALTY` fixed, derive the client card from `BOOKINGS_VIEW`. Sixteen is the author's call; the document should at least answer why each of the four is separately togglable.
  - Add the Booksy shape to "Alternatives Weighed" with a reason. Make P7 conditional on the stage D spike; if the spike says no, weigh stage C on its own.
  - Where the reviewer agrees with the document: departures are the right idea (the granularity is B1), and judging the stored account is right over a claim refresh, because the read is the existing pattern (`libs/ecs-core/src/pipelines/set-day-exceptions.pipeline.ts:122-123`) and "own" needs the link and block state, which no claim carries.

### M18. The owner's named examples land last, one behind a go or no-go, and stage D's spike is under-scoped - Severity: Major

- **Reviewer Lens:** `egm-zoom-out` (Major), `egm-codebase-details` (Nit), `egm-design` (Nit)
- **Affected Scope:** L265–268; P2 (L248, L256); P7 (L401–422); O5 (L584–587); stage D (L626–627)
- **Discrepancy Description**:
  - "See a colleague's schedule" is `BOOKINGS_VIEW`. For a barber the useful value is `OWN`, which is stage D. `NONE` or `ALL` on that row is worth nothing for a barber. Stage A still fixes the row as scoped (L248), and the screen offers «Само своите» on it (L481–482).
  - The table claims enforcement on the photos' Storage objects (L248). At `OWN` that needs three reads: the settings document, `users/{uid}`, and the photo document. The barber is on the photo document (`firestore.rules:385`), not in the path (`storage.rules:77`). L405–406 states the limit is two (the figure itself is unverified).
  - `appointmentNotes` has no barber field either (`libs/ecs-core/src/systems/governed-change.system.ts:86-90`).
  - Stage D names one query to change (L416–418), the day query (`libs/infrastructure/firestore/src/lib/appointments.adapter.ts:289-292`). Three more staff reads of `appointments` exist: `observeAppointment` (`:277`), `pageClientHistory` (`:346-353`, query body `:165-184`) and `searchAppointmentWindow` (`:364-375`, query body `:230-253`).
  - Contact fields are also on `users/{uid}` (`firestore.rules:185-191`), which L419–420 does not list.
  - A second `/restricted/{docId}` wildcard breaks the parity reader (`firestore.rules:562-566`; `libs/ecs-core/src/testing/rules-text.ts:197-200`).
- **Rationale & Recommendation**:
  - Run the `BOOKINGS_VIEW`-own spike before stage A, because its answer decides whether the row is scoped.
  - Until each spike says go, declare `BOOKINGS_VIEW` shop-wide and leave `CLIENT_CONTACT` out of the catalogue (see B2).
  - Pull `BOOKINGS_MANAGE` into the first editable release, since it is the owner's first example.
  - Add to the spike: the three-document Storage case, `appointmentNotes`, the three further `appointments` readers, the `users/{uid}` contact fields and the parity reader.

### M19. P2 has no `sysadmin` column and names no source, so the default lists cannot be written or checked from the text - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (Major), `egm-structural` (Major), `egm-comprehension`, `egm-codebase-details` (Nit), `egm-zoom-out` (Nit)
- **Affected Scope:** P2 (L242–263); P4 (L308–310); P5 (L319, L334–336); R3 (L559–561)
- **Discrepancy Description**:
  - The header is "Defaults (Б / Р / С / У)". The stored lists carry `admin` and `sysadmin` (L319), and the guard "adds back the locked members (P4)". The twenty-five field names are derivable (nine scoped × 2, plus seven). The values are not, because `sysadmin`'s place differs by capability:
    - in `BOOK`, `MONEY`, `ROSTERS` (`libs/ecs-core/src/components/roles.data.ts:56`, `:64`, `:151`);
    - out of `SPEND`, `ANALYTICS_SELF`, `ANALYTICS_SHOP`, `TEAM`, `TEAM_PROFILES` (`:81`, `:90`, `:97`, `:132`, `:141`);
    - in the `users` list rule, `isCatalogManager()` and `isAdmin()` (`firestore.rules:193`, `:59`, `:63`);
    - in the loyalty publish gate (`apps/functions/src/lib/booking/caller-roles.ts:83-85`).
  - No column maps the eight lists (L373–375) and the rules helpers to the sixteen rows. So "Every default but the manager's is today's behaviour" (L243–244) cannot be checked from the document, and R3's second copy would be transcribed from an incomplete table.
  - `egm-codebase-details` derived the column from today's lists: `ALL` or yes for bookings view and manage, time off, hours, discount, reprice, client search, card, contact, content, loyalty; none for spend, analytics and the three team capabilities.
- **Rationale & Recommendation**: Add a `sysadmin` column and a "today's source" column (list or rules helper with `path:line`) to P2, or print the default lists in P5. State that "locked members" means `admin` on every field plus `sysadmin` where the default has it.

### M20. P12 lists additions only, and stage A has no file-level change list - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-structural`, `egm-codebase-details`
- **Affected Scope:** P12 (L523–539), against L99–102, L368–376, L426–443, L516–518, L559–561
- **Discrepancy Description**:
  - P12 lists tiers, not files, and carries no create / modify / delete marks.
  - Missing from the inventory:
    - **Changes and removals.** `GovernedChangeSystem.auditedByCallable` (`libs/ecs-core/src/systems/governed-change.system.ts:276-281`); the eight lists; the refusals; the fate of the three own-only systems of fact 5; the capacity trigger decoder (M4).
    - **Web and infrastructure.** `StaffAccessService`, `capabilityGuard`, the stream adapter, the words for `ACCESS_*`.
    - **Callable registry.** The `Callables` entry and its `CALLABLE_APP_CHECK_TOKEN` entry (`libs/ecs-core/src/ports/callables.ts:50`, `:376-402`).
    - **Specs.** `libs/ecs-core/src/components/role.rules-parity.spec.ts:87-106`; `apps/functions/src/main.spec.ts`.
- **Rationale & Recommendation**: Make P12 a table: item, file, added / changed / removed, stage. `egm-implementation-readiness`'s minimum for stage A:

  | Area            | Files                                                                                                                                   |
  | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
  | Primitives      | `staff-capability.data.ts`, the scope dictionary, the settings id                                                                       |
  | Errors          | `errors/access.error.ts`; the allowlist in `pipeline.error.ts`                                                                          |
  | Components      | `staff-permissions.data.ts`, the call component, the `audit-context.data.ts` variant, `role.data.ts`                                    |
  | Entities        | `staff-permissions-settings.entity.ts`                                                                                                  |
  | Systems         | `staff-access.system.ts`, the planner, `audit.system.ts`, `governed-change.system.ts`; edits to roster-access, team and staff-analytics |
  | Ports           | the read bundle from M3; `callables.ts`                                                                                                 |
  | Pipelines       | the shared reader; `set-staff-permissions`; the three roster, six team and two analytics pipelines; `team-caller`                       |
  | Functions       | `firestore-settings.adapter.ts`; `wire/{roster,team,analytics,governance,triggers}.wire.ts`; `edge.ts`; `main.ts` and its endpoint spec |
  | Rules and words | `firestore.rules` and its emulator spec; `bg.json`, `en.json`                                                                           |

### M21. The Team-screen stage has no id and no exit criterion, and its pointers ("slice 5", "the Team screen's open items") resolve nowhere - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-comprehension`, `egm-codebase-details` (reported as unverified)
- **Affected Scope:** header (L5–7); P8 (L433–434); P10 (L487–488); Staging (L609–611)
- **Discrepancy Description**:
  - "team onboarding slice 5" appears at L6 and L609. `docs/designs/team-onboarding.md` has stages 0, 1a, 1b, 2, 3, 4 (`:1026`, `:1073`, `:1087`, `:1101`, `:1105`, `:1118`) and no slice numbering. The Team page is stage 1a (`:1073`) and is called "Team page" there (`:65`) and in `apps/functions/src/main.ts:983`.
  - The only "Slice 5" under `docs/` is `docs/design-research/auth-flow-design.md:296`, which is unrelated.
  - "the Team screen's open items" (L433) has no list in either document. A lane belongs to the staff schedule (`docs/designs/team-onboarding.md:73`).
  - This stage ships all sixteen «Права» rows and the route guards for analytics, programmes and loyalty before B, C and D enforce anything (B2).
  - The prototype pass (L487–488) is in P10, not in Staging.
- **Rationale & Recommendation**: Give the stage a letter and cite team-onboarding by its real stage id. Define what is built and what remains, and link the open-items list. Add exit tests, state which rows are enabled per stage, and move the prototype pass into Staging.

### M22. Seven stages, three exit criteria, none itemised; B's and C's can pass with nothing enforced - Severity: Major

- **Reviewer Lens:** `egm-structural`, `egm-implementation-readiness`
- **Affected Scope:** Staging (L591–627); R1 (L553–555); R5 (L563–564)
- **Discrepancy Description**:

  | Stage              | Exit stated           | Depends on stated |
  | ------------------ | --------------------- | ----------------- |
  | 0 (L596)           | yes, prose            | no                |
  | A (L602)           | yes, prose            | no                |
  | Team screen (L609) | no                    | "after A"         |
  | B (L613)           | yes, prose            | no                |
  | M (L619)           | no                    | "after A"         |
  | C (L622)           | no, deliverables only | no                |
  | D (L626)           | no, a go/no-go        | no                |
  - **B.** "The e2e booking suite stays green" (L615–617) passes with nothing enforced. Widening `BOOKINGS_MANAGE` beyond `worksTheBook()` is unusable until the reads move in C and D. R5's "Stage B watches their latency" has no item in B.
  - **C.** The R1 proof has no pass condition and no decision if the listener survives.
  - The sibling document sets the bar: "Every exit test names its level" (`docs/designs/team-onboarding.md:1024`, `:1062-1071`).

- **Rationale & Recommendation**:
  - Use one template per stage: scope, depends on, builds, exit tests with their level, what it leaves undone.
  - B: add "a narrowed barber's call on a colleague's visit is refused with the same token", and a latency item for R5.
  - C: state the R1 pass condition and the fallback (for example, the web re-attaches and the remaining exposure is bounded and accepted in writing).

### M23. The gap ledger disagrees with itself and with the stages - Severity: Major

- **Reviewer Lens:** `egm-comprehension`, `egm-structural`
- **Affected Scope:** L108–127; P2 (L270–272); P6 (L365–366); P8 (L438–440); stage B (L614)
- **Discrepancy Description**:
  - L108–110 says the first gap is closed, "the design closes the second; the others are listed so they are not lost". But P8 closes G4 (L440).
  - G2 names "the impersonation calls" (L90–91). They are token-only (`libs/ecs-core/src/pipelines/start-impersonation.pipeline.ts:93`, `:110`, fed from the claims at `apps/functions/src/wire/governance.wire.ts:94`, `:117`), not configurable (L270–272) and in no stage. So G2 stays open for them. L366 ("for acts") and L614 ("for these calls") are narrower than L109.
  - G3 is defined at L122 and referenced nowhere else. It has no stage, non-goal or risk.
- **Rationale & Recommendation**: Add one table: gap, status, closed by (P and stage), residual. Decide G3 and the impersonation residual.

### M24. `TEAM_OFFERINGS` as "scoped" reopens a team-onboarding non-goal without saying so - Severity: Major

- **Reviewer Lens:** `egm-comprehension`
- **Affected Scope:** P2 (L260)
- **Discrepancy Description**: A scoped `TEAM_OFFERINGS` lets the owner grant a barber `OWN`, which is "a barber setting their own prices". That is out of scope in `docs/designs/team-onboarding.md:209-210`, and `libs/ecs-core/src/components/roles.data.ts:126` says "Prices are the owner's". P9 flags its own overturn of a team-onboarding cut (L463–465); this one is not flagged.
- **Rationale & Recommendation**: Make it shop-wide (twenty-four fields) or add it as an open decision that names the overturned non-goal.

### N1. Stale present-tense statements and dates - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` ("contradicts code"), `egm-structural`
- **Affected Scope:** L4, L26–29, L116, L446–447, L599
- **Discrepancy Description**: L27–29 and L446–447 say `setRoles` refuses a change to the caller's own account. It now admits one that keeps `admin` (`libs/ecs-core/src/systems/role-assignment.system.ts:180-182`, `:220-227`), as L466–469 and L599 say. Stage 0 says "Built" without saying its exit was met; it was (`apps/functions/src/integration/set-roles.integration.spec.ts:348-425`). The header date is 2026-11-13 (L4) against content dated 2026-11-14 (L116).
- **Rationale & Recommendation**: Move L27–29 and L446–447 to past tense, state that stage 0's exit was met, and update the header date.

### N2. `client` is a role, and the text treats every role as a level - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-comprehension`, `egm-structural`
- **Affected Scope:** L22–23, L54, P1
- **Discrepancy Description**: L22–23 lists five roles; `Role` has six, including `client` (`libs/ecs-core/src/components/role.data.ts:15-22`). "Level: a role an account holds" (L54) therefore includes `client`.
- **Rationale & Recommendation**: Say in P1 that `client` is not a level.

### N3. Fact 1, "the rules read the token only", is overstated - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** L71, L77–78
- **Discrepancy Description**: `storage.rules:35-36` reads `users/{uid}`. `firestore.rules:175`, `:356`, `:390` read other documents with `exists()`. The Firestore half of L77–78 ("No Firestore rule reads `users/{uid}`") holds.
- **Rationale & Recommendation**: Narrow the fact to "no Firestore rule reads the stored account or a settings document", and note the Storage read.

### N4. "Photo" under `editBarber` (profile part) does not exist - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` ("contradicts code")
- **Affected Scope:** P2 (L259)
- **Discrepancy Description**: The profile part has no photo (`apps/functions/src/wire/team.wire.ts:189-213`; `libs/ecs-core/src/systems/team.system.ts:71-77`), and no exported callable writes a barber's avatar.
- **Rationale & Recommendation**: Remove "photo" from the row, or name the act that will write it and its stage.

### N5. "Owner only, as today" covers gates that admit `sysadmin` - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`, `egm-comprehension`, `egm-structural`
- **Affected Scope:** P2 (L270–272)
- **Discrepancy Description**: Impersonation, the audit log and trigger failures are `admin` plus `sysadmin` today (`firestore.rules:62-64`, `:777`, `:787`, `:797`; `apps/functions/src/lib/booking/caller-roles.ts:83-85`; `libs/ecs-core/src/pipelines/start-impersonation.pipeline.ts:93`).
- **Rationale & Recommendation**: Reword to "admin and the vendor's sysadmin, as today" for those three.

### N6. The web does not read the barber role from the stored account - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** P9 (L457–459)
- **Discrepancy Description**: The web reads roles from the token and only the link from the account (`libs/features/shared/shell/src/lib/identity/session-identity.service.ts:88-104`, `:118-132`), as L73 says.
- **Rationale & Recommendation**: Correct L457–459, and say what an owner-barber's web session shows before `StaffAccessService` exists.

### N7. P8's route list omits `staff/schedule` - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** P8 (L435–437)
- **Discrepancy Description**: `staff/schedule` is guarded by `Roles.STAFF`, which admits `content_manager` (`apps/web/src/app/app.routes.ts:137`), whom the rules then refuse.
- **Rationale & Recommendation**: Add the route to the `capabilityGuard` list under `BOOKINGS_VIEW`.

### N8. A link write sits under `TEAM_MANAGE` - Severity: Nit

- **Reviewer Lens:** `egm-design`
- **Affected Scope:** P2 (L261, L270)
- **Discrepancy Description**: `deleteDraftBarber` clears an account's `linkedBarberId` (`libs/ecs-core/src/pipelines/delete-draft-barber.pipeline.ts:91-96`) while L270 says links are owner-only. It only lowers a grant.
- **Rationale & Recommendation**: State the exception, or keep the act with the owner.

### N9. R1's proof is weaker than it reads, and three mechanisms are not explained - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-comprehension`
- **Affected Scope:** P6 (L365–366); P7 (L408–411); R1 (L553–555)
- **Discrepancy Description**: The emulator is not evidence of production listener behaviour; `CLAUDE.md` §5 already records one divergence. "The token refresh bounds the rest" (L555) is not explained and is undocumented (platform knowledge). "The web re-attaches its streams" (L410–411) does not say which service or which streams, and P8 does not mention it. A role change still reaches rule-guarded reads only at token refresh, because `granted` tests token roles (L396–397).
- **Rationale & Recommendation**: Write the one-hour bound as an assumption, name the service that re-attaches, and add the role-change residual to L366 and to a risk.

### N10. R5 and Cost: read counts and one retry are off - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`, `egm-structural`
- **Affected Scope:** Cost (L543–549); R5 (L563–564)
- **Discrepancy Description**: The two reads cost no round trip if they join each transaction's first read (`libs/ecs-core/src/pipelines/book-appointment.pipeline.ts:368`; `libs/ecs-core/src/pipelines/set-day-exceptions.pipeline.ts:122`). `editAppointment` can run its commit twice (`libs/ecs-core/src/pipelines/edit-appointment.pipeline.ts:328-340`). `LOYALTY`'s refusal is answered today, not thrown (`apps/functions/src/edge.ts:457-460`). "One more document" (L549) against two (L359–360, L563).
- **Rationale & Recommendation**: Make R5 a rule ("the reads join the first read step") and correct L549.

### N11. The rules helper relies on forms no existing rule uses - Severity: Nit

- **Reviewer Lens:** `egm-design`, `egm-codebase-details`
- **Affected Scope:** P7 (L388–399)
- **Discrepancy Description**: `? … : {}` relies on an empty map literal and on `Map.get(key, default)`. No existing rule in `firestore.rules` uses a map literal or `Map.get`; both reviewers believe they are valid but could not check.
- **Rationale & Recommendation**: Either prove the form in the emulator in stage A, or write `exists(p) && field in get(p).data ? get(p).data[field] : standard`, which avoids the question.

### N12. Naming: collisions and Law 1 field names - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-comprehension`, `egm-structural`, `egm-zoom-out`, `egm-design`
- **Affected Scope:** P5 (L340); P6 (L367–368, L378); P11 (L513); P2 capability names
- **Discrepancy Description**:
  - `GrantScope` sits beside the coupon `GrantStatus` (`libs/ecs-core/src/primitives/grant-status.data.ts:7`) and the `couponGrants` collection in the same table (L255). `grantScopeFrom` on an audit row reads as a coupon grant.
  - Dictionary `StaffCapability` against field `capability`, and field `role`; Law 1 names the dictionary after the field.
  - Scope `ALL` against `Roles.ALL` (`libs/ecs-core/src/components/roles.data.ts:33`). `TEAM_PROFILES` is both a list to delete (L374) and a capability (L259).
  - Prefixes are asymmetric (`BOOKINGS_` / `VISIT_`, `CLIENTS_` / `CLIENT_`) and become stored field names.
- **Rationale & Recommendation**: Use `AccessScope` (`accessScope`, `accessScopeFrom`, `accessScopeTo`) and `staffCapability`; settle the prefixes before they are stored.

### N13. Reinvention and unsupported reuse in P6 and P8 - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** P6 (L361–364); P8 (L426–437); P12 (L534–535)
- **Discrepancy Description**:
  - The is-staff gate exists as `admitTeamStaffCaller`, with `teamActor` beside it (`libs/ecs-core/src/pipelines/team-caller.pipeline.ts:53-67`).
  - `StaffAccessService` "holds the signed-in account", but `AccountStateService.account` is already the one live snapshot (`libs/features/client/account-state/src/lib/account-state.service.ts:41`, `:74-75`).
  - Route decisions live in `SessionAccessSystem.decide` behind `RouteGate` (`libs/ecs-core/src/systems/session-access.system.ts:75-95`). P8 does not say what `capabilityGuard` does before the account and document load; `rolesGuard` reads a settled principal (`apps/web/src/app/guards/roles.guard.ts:19-32`).
  - `AnalyticsCaller` (`libs/ecs-core/src/systems/staff-analytics.system.ts:69-75`) becomes redundant.
- **Rationale & Recommendation**: Grow the shared reader from `team-caller.pipeline.ts`. Give the service only the document stream. Add a `RouteGate` variant. Delete `AnalyticsCaller` in A.

### N14. Screens and measures to trim; refusal logging has no home - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`, `egm-implementation-readiness`
- **Affected Scope:** P10 (L482–486); P11 (L519–521); R2 (L556–558)
- **Discrepancy Description**: «Какво може» equals the level's page for a single-level account. «Отмени» is a second save. The refusal measure has no reader; telemetry is console-only. A system cannot log, and `SetRosterWeekPorts` is `CommitPorts & ClockPorts` (`libs/ecs-core/src/pipelines/set-roster-week.pipeline.ts:62`).
- **Rationale & Recommendation**: Defer the three, and link the member page to the level's page. If refusal logging stays, carry the scope found as a server-only field of the error and log it at the edge's outcome line, so no pipeline's port type changes.

### N15. Altitude - Severity: Nit

- **Reviewer Lens:** `egm-zoom-out`
- **Affected Scope:** P9 (L466–474); P7 (L388–399)
- **Discrepancy Description**: The "As built" paragraph is code history. The rules snippet is stage C detail that will drift.
- **Rationale & Recommendation**: Move the first to the PR and mark the second illustrative.

### N16. Stage 0's criterion is weaker than its wording - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** stage 0 (L596–600)
- **Discrepancy Description**: "Has analytics admit the account's own scope" is asserted on the pure system over the stored document (`apps/functions/src/integration/set-roles.integration.spec.ts:391-406`), not through the callable with the un-refreshed token.
- **Rationale & Recommendation**: Reword the criterion or add the callable case.

### N17. No verification commands or fixtures per stage - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`
- **Affected Scope:** Staging; P12 (L539)
- **Discrepancy Description**: No stage names a command to run or a seed for the settings document.
- **Rationale & Recommendation**: Name `CLAUDE.md` §5's list plus `pnpm nx run functions:test-integration` and the rules emulator spec, and add an integration helper that seeds `settings/staffPermissions`.

### N18. Open decisions are not tied to stages, and some undecided items sit outside the list - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness`, `egm-structural`
- **Affected Scope:** O1–O7 (L569–589); L180, L194, L202–203, L626–627
- **Discrepancy Description**:
  - Nothing says which decision gates which stage. `egm-implementation-readiness`'s reading: O2 gates A (B1); O7 is fixed by M8's gate; O1 and O4 gate B; O5 gates D; O3 and O6 gate nothing, but their "fits the same model" claims need rewording after B1.
  - O6 (L588) has no alternative or reason; its status reads "Deferred" (L194), non-goal (L180) and "No" (L588).
  - Undecided items outside the list: D's go/no-go, G3, L202–203, and G4's self-flagged "not run" (L126–127).
- **Rationale & Recommendation**: Add a "gates stage" note to each O and bring the four stray items into the list.

### N19. Glossary gaps and undefined project terms - Severity: Nit

- **Reviewer Lens:** `egm-comprehension`, `egm-structural`
- **Affected Scope:** glossary (L49–61); L73, L92, L115, L159, L193, L195, L234, L246, L361, L433–434, L479–482, L516, L539
- **Discrepancy Description**:
  - Act and Read do not cover callable reads (`staffAnalytics`, `listTeam`) or rule-guarded writes (L262).
  - P2's "Scope" column (scoped / shop-wide) is not the glossary's Scope (L56). "Shop-wide" is undefined and misleads in a multi-shop business (L182, L258). The same value is written "yes", a switch (L482) and `ALL`.
  - "Owner" is the brief's commissioner (L3, L569, L626) and any `admin` (L58). "Vendor" is undefined.
  - No definition or pointer: "wire gate" (L361), "the book" and "book gate" (L92, L115), "governed" (L516), "the words" (L195, L234, L539), "dock", "receipt" and "value row" (L479–482), "lane" (L433; defined only at `docs/designs/team-onboarding.md:73`), "Law 5" and "Law 9" (L327, L442), "Goldfish review round" (L9).
  - "The reading guard" and "the editor" appear in P4 (L302–304) before P5 and P10.
  - Bulgarian labels carry no English gloss (L44, L218–224, L460–462, L478–507, and the Б/Р/С/У header at L246).
  - Paths missing in L73: `apps/web/src/app/guards/roles.guard.ts:19`, `apps/web/src/app/shell/session-expiry.service.ts:21`, `libs/features/shared/shell/src/lib/identity/session-identity.service.ts:55`.
  - "One to fifteen people" (L159, L193) is unsourced; the requester's context says a handful to a few dozen.
- **Rationale & Recommendation**: Extend the glossary with these terms, rename P2's column to "Scopable", gloss each Bulgarian label once, and add the three paths.

### N20. Standard mapping - Severity: Nit

- **Reviewer Lens:** `egm-structural`, `egm-design`
- **Affected Scope:** headings (L13, L63, L164, L188, L214, L541, L551, L569, L591, L629)
- **Discrepancy Description**: No heading level is skipped. "Problem Statement" is hidden under Overview. "Risks & Mitigations" is an H3 under a heading that does not name it. R4 states no mitigation. The residual hour for reads (L84–85) is in no R. There is no timeline and no build effort per stage; the Cost section covers runtime only (Heilmeier).
- **Rationale & Recommendation**: Add a Problem Statement heading, give Risks its own H2, write R4's mitigation, add the read residual as a risk, and add a build-effort line per stage.

### N21. Ids used before they are defined, or colliding across documents - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** L118, L246, L586, L591–627; O1–O7
- **Discrepancy Description**: Stage letters are used from L118 and L246; Staging starts at L591. "Stage D's second half" (L586) is not a defined unit. "Stage 0" also exists in `docs/designs/team-onboarding.md:1026`. Stage "D" sits beside the borrowed D1 and D5. O1–O7 duplicate team-onboarding's O1–O7 (`docs/designs/team-onboarding.md:1000-1020`), which code already cites (`libs/ecs-core/src/components/roles.data.ts:145`; `firestore.rules:603`). M breaks the alphabetical order.
- **Rationale & Recommendation**: Add a one-line stage key before first use, prefix this document's ids (for example `SP-O1`), and split D into D1/D2 under a name that does not collide.

### N22. P2 and P10 table details - Severity: Nit

- **Reviewer Lens:** `egm-structural`, `egm-comprehension`
- **Affected Scope:** P2 (L246–263); P10 (L479–480, L490–507)
- **Discrepancy Description**: `CLIENT_CONTACT`'s "Enforced by" cell is a prerequisite, not an enforcement point (L256). Routes are listed for two rows, though P8 names four families (L435–437). "Rows grouped as the catalogue is" (L480), but the groups exist only in P10's table.
- **Rationale & Recommendation**: Add a group column to P2, list the route for every row that has one, and write `CLIENT_CONTACT`'s real enforcement point.

### N23. Formatting - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** L44–45, L166, L177, L197, L317, L343–344, L352–354, L367–368, L388, L416–417, L465, L631
- **Discrepancy Description**: Both fences are unlabelled (L317, L388). Code spans are broken across lines with the continuation at column 0, so the signatures cannot be grepped (L343–344, L352–354, L367–368, L416–417). L44–45 uses "what this person may do" where L485 uses «Какво може». Level words are quoted at L35 and L577 but bare at L242. "Goals:" against "Out-of-Scope Non-Goals:" (L166, L177). Positional references: "as above" (L197); "the line above" (L465) is two bullets up. "Vendor help pages" (L631) includes Firebase docs.
- **Rationale & Recommendation**: Label the fences, keep each code span on one line, and replace positional references with section ids.

### N24. Small count and signature slips - Severity: Nit

- **Reviewer Lens:** `egm-structural`
- **Affected Scope:** P6 (L352–354, L373–376); P8 (L428)
- **Discrepancy Description**: `scopeOf` and `admit` order their parameters differently (L352–354). `mayFor` (L428) has no counterpart in P6. L373–376 accounts for 13 of the 14 `Roles` lists.
- **Rationale & Recommendation**: Align the parameter order, name the system function `mayFor` calls, and place the fourteenth list.

### N25. Ten client-facing callables are in neither P2 list - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details`
- **Affected Scope:** P2 (L270–278); Non-Goals (L186)
- **Discrepancy Description**: `requestOtpChallenge`, `verifyOtpChallenge`, `completeRegistration`, `updateProfile`, `cancelAppointment`, `rescheduleAppointment`, `requestWaitlist`, `cancelWaitlist`, `redeemInvitation` and `reportClientIssues` are covered only by the Non-Goal. All 35 exported callables are otherwise accounted for: 17 in rows, 7 not configurable, 1 fixed tier, 10 client-facing. `cancelAppointment` and `rescheduleAppointment` are booking-owner only (`libs/ecs-core/src/pipelines/cancel-appointment.pipeline.ts:113`; `libs/ecs-core/src/pipelines/reschedule-appointment.pipeline.ts:369`).
- **Rationale & Recommendation**: Add a third line under P2, "Client-facing, unchanged", naming the ten.

## Unverified claims

These are reported as unverified, not as findings of fact.

- **Firebase platform behaviour in P7 and R1** (L401–411, L553–555): one billed read per request however often a rule names the document; the limit of ten such calls; two Firestore documents per Storage rule evaluation; whether an open listener is cut when a rule's dependency changes; whether the token refresh bounds the rest. No reviewer could check these against Firebase documentation; no network tool was available. `egm-design` believes the billing statement, the ternary, `Map.get(key, default)` and `hasAny` are valid (platform knowledge).
- **The empty map literal `{}` and `Map.get(key, default)`** in the P7 helper: no existing rule uses either (N11).
- **Whether Firestore can prove an `array-contains` query against an own-barber rule** (L414–418). That is the stage D spike's question.
- **"The reason for the cut was token handling"** (L464): `egm-codebase-details` reads `docs/designs/team-onboarding.md:215-216` as giving a different reason; `egm-comprehension` reports the pointer as resolving at `:215-217`. The two reviewers disagree.
- **Whether the leaving flow removes a leaver's `barber` role and link.** `egm-comprehension` found no export for team onboarding's close job in `apps/functions/src/main.ts`; `egm-design` could not verify either way.
- **Whether another spec pins `storage.rules`' role list.** Only its absence from `role.rules-parity.spec.ts` was confirmed.
- **Whether the edge's existing outcome line carries the refusal code** (N14).
- **Staff path in `cancelAppointment` and `rescheduleAppointment`:** `egm-implementation-readiness` checked by search only.
- **`apps/functions/src/edge.ts`** was read by `egm-codebase-details` to line 1122 of 1543.
- **The external URLs** at L633–642 were not opened.

## The author's eight questions, where reviewers found no defect

1. **Stored shape.** Not as written: B1, M1, M2. Storing departures is the right idea; the grain is the defect.
2. **Enforcement in the transaction.** Correct for the nine roster and team pipelines, which already read `users/{caller}` in their commit. Cost and contention are correct at this scale: Admin SDK transactions take shared read locks (platform knowledge), both documents are written a few times a year, and a retry adds two reads. "Is staff" at the wire is safe for every stage A callable. Defects: M3, M9.
3. **Rules reading the document.** Defects: M1, M4, M10, N11. The ten-call limit is far away: existing rules use at most one `exists()` (`firestore.rules:175`, `:356`, `:390`).
4. **Scope model.** Two levels with different scopes is answered three times, consistently (L54, L227–228, L298). Owner-as-barber is answered (L302, L446–459) and matches `libs/ecs-core/src/systems/role-assignment.system.ts:222-227`, `:337-339`. A receptionist with no link is answered (L282–284) apart from the error code. Defects: M5, M6, M15, M16.
5. **Catalogue.** Sixteen capabilities and twenty-five fields are counted correctly (nine scoped × 2 plus seven), and the Stage column (6 / 4 / 4 / 2) matches the staging text. Defects: M13, M14, M17, M24.
6. **Safety.** An admin cannot be locked out by callable or by document. No reviewer found a path by which a non-admin level raises a grant; N8 only lowers one. The self-change rule holds at `libs/ecs-core/src/systems/role-assignment.system.ts:222-227`. Defects: M1 (fail-open fallback, `sysadmin` in the rules helper).
7. **Staging.** Stage 0 is built as described. Defects: B2, M10, M11, M12, M18, M21, M22.
8. **Defaults.** The Б, Р and С cells match the code for every row except `CLIENTS_SEARCH` for Б (M14) and the goal nuance in `ANALYTICS` (M5). The `sysadmin` column is missing (M19). `egm-codebase-details`'s cell-by-cell check:

   | Capability                        | Б / Р / С in document | Code today                                                                                                                                |
   | --------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | `BOOKINGS_VIEW`                   | `ALL` / `ALL` / —     | matches (`firestore.rules:54-56`, `:281`, `:351`, `:380`)                                                                                 |
   | `BOOKINGS_MANAGE`                 | `ALL` / `ALL` / —     | matches (`libs/ecs-core/src/components/roles.data.ts:56`; `apps/functions/src/wire/booking.wire.ts:283`, `:450`, `:572`, `:662`, `:1068`) |
   | `TIME_OFF`, `HOURS`               | `OWN` / `ALL` / —     | matches (`roles.data.ts:151`; `libs/ecs-core/src/systems/roster-access.system.ts:46-54`)                                                  |
   | `VISIT_DISCOUNT`, `VISIT_REPRICE` | — / `ALL` / —         | matches (`libs/ecs-core/src/systems/billing.system.ts:601`, `:635-649`)                                                                   |
   | `CLIENTS_SEARCH`                  | — / yes / —           | differs for Б (M14)                                                                                                                       |
   | `CLIENT_CARD`, `CLIENT_CONTACT`   | yes / yes / —         | matches (`firestore.rules:191`, `:416`, `:431`, `:503-513`, `:524`, `:739`)                                                               |
   | `CLIENT_SPEND`                    | — / — / —             | matches (`firestore.rules:440`)                                                                                                           |
   | `ANALYTICS`                       | `OWN` / — / —         | matches for reading (`libs/ecs-core/src/systems/staff-analytics.system.ts:1777-1803`); goal nuance M5                                     |
   | `TEAM_PROFILES`                   | `OWN` / — / `ALL`     | matches (`libs/ecs-core/src/systems/team.system.ts:216-227`)                                                                              |
   | `TEAM_OFFERINGS`, `TEAM_MANAGE`   | — / — / —             | matches (`roles.data.ts:132`)                                                                                                             |
   | `CONTENT`                         | — / — / yes           | matches (`firestore.rules:58-60`, `:699-711`)                                                                                             |
   | `LOYALTY`                         | — / — / —             | matches (`apps/functions/src/lib/booking/caller-roles.ts:83-85`; `apps/functions/src/wire/loyalty.wire.ts:174`)                           |

Other claims checked and found correct: facts 2, 4, 5 and 6; G1 and G3 as described; the thirteen `Roles` lists named in P6; the four retiring error codes exist; the `busyKeys` day query; the stage 0 "as built" paragraph; the pointers to team-onboarding D1 and D5 (`docs/designs/team-onboarding.md:286-290`, `:395`, `:406-416`).

## Id-family audit (`egm-structural`)

| Family          | Defined                | Gaps or duplicates    | Dangling or mismatched references                                    |
| --------------- | ---------------------- | --------------------- | -------------------------------------------------------------------- |
| P1–P12          | L216–L523, once each   | none                  | none                                                                 |
| G1–G4           | L112–L125              | none                  | G3 never referenced; L109 against L440 (M23)                         |
| O1–O7           | L571–L589              | none                  | none inside the document; collides across documents (N21)            |
| R1–R6           | L553–L565              | none                  | R5's mitigation not in stage B (M22)                                 |
| Facts 1–6       | L77–L104               | none                  | none (L121, L199 resolve)                                            |
| Stages          | L596–L626              | Team screen has no id | "slice 5" unresolved (M21); "D's second half" (N21)                  |
| Borrowed D1, D5 | qualified at L10, L236 | —                     | resolve at `docs/designs/team-onboarding.md:286-289`, `:395`, `:406` |

Every table has a separator and a constant column count.

## Comprehension paraphrase (`egm-comprehension`)

Kept so the author can compare it with the intent. A mismatch is a finding the reviewer could not see.

**What this proposes.** Today's hard-coded "role → what it may do" lists become a closed catalogue of sixteen capabilities. The owner sets which of them each level grants (barber, receptionist, content manager, a new manager) in a «Права» screen; admin always has everything and sysadmin keeps its fixed lists. Nine capabilities concern one barber's work and take nobody / own linked barber record / everyone; the other seven are on or off. Only departures from code defaults are stored, as role lists in one `settings/staffPermissions` document; callables judge the caller's stored account against it through one pure `StaffAccessSystem`, and the security rules read the same document. Stage 0 (an admin links their own account to a barber record) is built; then come the engine with the roster, team and analytics callables (A), the Team screen with the permission screens, the booking callables (B), the manager level (M), rule-guarded reads (C), and own-only schedule and hidden contacts behind spikes (D).

**How the existing system works, per this document.** An account holds a set of roles, and what each role may do is a fixed list in `roles.data.ts`, repeated by hand in `firestore.rules`, so any change is a release. The rules judge only the ID token's `roles` claim, minted at sign-in; a role change revokes refresh tokens but the old token is honoured for up to an hour. Callables gate first on the token at "the wire"; some then re-read the stored account (roles, roster, team, analytics, privacy, backfill), others trust the token alone (booking, arrival, tip, staff edit, impersonation, loyalty publish). Staff read most booking and client data straight from Firestore under `worksTheBook()`. "Own only" exists in three server systems that compare the call's barber with the account's linked barber record, and no callable writes `settings/*`.
