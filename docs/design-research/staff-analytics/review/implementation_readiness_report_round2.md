# Goldfish Review Report: Implementation Readiness, Round 2 (the one permitted re-audit)

**Target:** `docs/designs/staff-analytics.md`, the section `## Detailed Implementation Plan` (lines 733-1026). The specification in lines 1-732 is the source of truth.

**Date:** 2026-11-07

## Reviewer Status

| Reviewer                       | Persona                       | Standard                               | Status    | Raw findings                |
| ------------------------------ | ----------------------------- | -------------------------------------- | --------- | --------------------------- |
| `egm-implementation-readiness` | `implementation_readiness.md` | `implementation-readiness-standard.md` | completed | 4 Blocker, 14 Major, 12 Nit |
| `egm-codebase-details`         | `codebase_details.md`         | `implementation-readiness-standard.md` | completed | 5 Blocker, 17 Major, 12 Nit |
| `egm-style`                    | `style.md`                    | (persona only)                         | completed | 0 Blocker, 22 Major, 17 Nit |

Each reviewer ran once, in a fresh context. None needed a retry.

**After deduplication:** 6 Blocker, 27 Major, 17 Nit (50 findings).

**Not re-raised (settled in round 1):** reading departures by `BusyKey` with `getAll`, and one uniform template for every plan item. No reviewer raised either.

**How the list was merged:**

- Overlapping findings are merged under one id. The id belongs to the reviewer who gave the fullest account. "Also raised by" lists the other reviewers' raw finding numbers.
- When reviewers disagreed on severity, the higher one was kept and the disagreement is noted. One exception: ir B4 is split in two (ir-2-3 and cd-2-4), and the audit-row half is rated Major because it can be fixed on its own.
- Each finding says whether it is new or carries a round-1 finding forward.

**Checked by the synthesizer:** six load-bearing claims, against the code on disk.

- `ProfileReadPorts` and `RosterReadPorts` appear nowhere under `libs/`. `ProfilePorts` is at `accounts.port.ts:76`.
- `tools/lint-rules/ecs-syntax.mjs:90-92` refuses `TSPropertySignature[optional=true]` in a component or entity.
- `wiredCallable`'s `run` is `(ports: P, cmd: C, budget: WorkBudget)` (`apps/functions/src/main.ts:554`).
- `apps/functions/src/edge.spec.ts:383-386` asserts that `EDGE_DICTIONARIES` lists every ecs-core error dictionary.
- The visibility table (spec lines 296-306) has nine rows, not eleven. `lane-geometry.spec.ts:25` imports `laneGeometryOf` from `./staff-day.store`, and `LaneGeometry` is an `interface` (`staff-day.store.ts:337`).
- `flatten-spec.md:539` says "These rows, and ONLY these, compare or add `UtcEpochMs` values". `client-stats.system.ts:677` declares `function inEuroCents` with no `export`.

**Round-1 findings resolved by the revision:**

- ir-1-4 (the erasure items were dropped)
- ir-1-13 (rollout and rollback present; the rollback text is wrong, see style-2-6)
- ir-1-14 (log fields)
- cd-1-2 (`view=agenda`, the `free` input; the Apply rule is still open, see cd-2-12)
- cd-1-5 (`DateRange` reused, `isWithinRange`)
- cd-1-7 (`ANALYTICS_INVALID_INPUT`)
- style-1-1, style-1-2, style-1-3 (apart from the rule numbering, style-2-8), style-1-6, and most of style-1-11

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 🔴 Blockers

### cd-2-1: The "each step is green on its own" gate still fails at Steps 1 and 3 - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details` (B1). Also raised by `egm-implementation-readiness` (B3) and `egm-style` (M1). Carried forward from ir-1-1.
- **Affected Scope:** Lines 735-739, with items 1, 5, 8, 9, 23 and 31.
- **Discrepancy Description:**
  - **Item 1 (Step 1).** It adds `AnalyticsErrorCode`, but `edge.spec.ts:383-386` requires `EDGE_DICTIONARIES` to list every ecs-core error dictionary. The edge rows only come in item 32 (Step 4). Item 2 puts the governance edge rows in Step 1, so the two items are also inconsistent with each other.
  - **Item 8 (Step 1).** `RolesCall.Changed` gains the link. `set-roles.pipeline.ts:192-196` returns the old shape until item 26 (Step 3), so `AnswerIsTheWire` in `main.ts` and the client-card specs that build `Changed` answers fail `typecheck`.
  - **Item 9 (Step 1).** It adds two required fields to `AuditContext.Profile` (`audit-context.data.ts:596-603`). The following literals and types break, and no item in Step 1 lists them:
    - `NO_TAGS` (`:189-194`) and `profileWithTags` (`:350-363`)
    - `ProfileTagDelta` (an `Omit` of `AuditContext.Profile`), `NO_TAG_DELTA` and `profileTagDelta` (`audit.system.ts:161-164, 228-233, 706-728`)
    - the literal in `planRolesChanged` (`:892-897`), which only changes in Step 2
    - the trigger decoder's specs (`triggers.wire.spec.ts`, `audit-document-change.pipeline.spec.ts`)
  - **Item 5.** `User` literals are missing from the list:
    - `userFixture` in `libs/ecs-core/src/testing/identity.fixtures.ts:83-94`, and its spec
    - `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`
    - `profile-edit.system.spec.ts`
  - **Item 23 (Step 3).** It adds `Callables.StaffAnalytics`, but the export arrives in Step 4 (item 31). For all of Step 3, `main.spec.ts:1255` fails: it asserts that the exported callables equal `Object.values(Callables)`.
- **Rationale & Recommendation:**
  - Move each consumer into the step that changes its type:
    - the analytics edge rows with item 1;
    - `set-roles.pipeline.ts`'s return value with item 8;
    - the audit-tag literals and specs with item 9;
    - the missing `User` literals with item 5;
    - the `main.ts` export and `main.spec.ts` with item 23.
  - Otherwise weaken the sentence to name which projects may be red in each step.

### ir-2-1: The analytics pipeline depends on port bundles that do not exist (Law 9) - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness` (B1). Also raised by `egm-codebase-details` (B2) and `egm-style` (M2), who rated it Major. This is a new problem, introduced by the fix for ir-1-2.
- **Affected Scope:** Item 25 (lines 866-868), with items 22 and 31.
- **Discrepancy Description:**
  - `ProfileReadPorts` and `RosterReadPorts` are not declared anywhere in `libs/ecs-core/src/ports` (confirmed).
  - `LoadProfile` belongs only to `ProfilePorts` (`accounts.port.ts:76-79`, which also carries the rxjs `observeProfile`) and to `ClientFootprintPorts` (`privacy.port.ts:267-284`, 15 members).
  - The roster read is `loadSchedule`, in `ShopDayReadPorts` (`scheduling.port.ts:473-477`).
  - `root.ports` is `serverPorts`/`FirestorePorts` (`main.ts:333-337`, `firestore-ports.ts:87-122`). It has no `loadProfile`; only `privacyPorts` builds one (`main.ts:468-478`). So item 31's `root.ports` cannot satisfy the pipeline.
- **Rationale & Recommendation:**
  - Split `ProfilePorts` in `accounts.port.ts` into `ProfileStreamPorts { observeProfile }` and `ProfileLoadPorts { loadProfile }`, keeping `ProfilePorts` as their `&`. Recompose `ClientFootprintPorts` over `ProfileLoadPorts`.
  - Have a functions adapter return `ProfileLoadPorts`, add it to `FirestorePorts`, and spread it in `firestorePorts`.
  - Type the pipeline as `AnalyticsReadPorts & ProfileLoadPorts & ShopDayReadPorts & PolicyReadPorts & ClockPorts & LogPorts`.

### ir-2-2: Item 31's callable wiring does not match `wiredCallable`, and `main.spec.ts` is under-listed - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness` (B2). Also raised by `egm-codebase-details` (B3, M7) and `egm-style` (N11, N12). Carried forward from ir-1-7.
- **Affected Scope:** Items 12, 25, 30 and 31 (lines 804-806, 866-877, 895-901).
- **Discrepancy Description:**
  - **Signature.** `run` is `(ports, cmd, budget: WorkBudget)` (`main.ts:554`, confirmed). The plan's `(ports, cmd, caller) => staffAnalyticsPipeline(ports)(cmd, caller)` passes the `WorkBudget` in as the caller.
  - **Caller.** The house pattern puts the verified caller inside the decoded command: `SetRolesCommand = RolesCall & { adminUserId; adminRoles; operationId }` (`set-roles.pipeline.ts:69-79`), built by `decodeSetRoles` (`governance.wire.ts:116-142`). No `StaffAnalyticsCommand` is defined.
  - **Options.** The options object omits `...LOG_DIGEST_SECRETS` (precedent `main.ts:603-654, 1141-1142`).
  - **Names.** The pipeline export is unnamed in item 25. Item 31 calls `staffAnalyticsPipeline`, the spec diagram (line 272) shows `staffAnalytics(ports)(cmd, caller)`, and `staffAnalytics` collides with the `onCall` export.
  - **`main.spec.ts` needs more than "the export list":**
    - the `PIPELINES` seam list (`:36-72`)
    - an `ENDPOINTS` row with `availableMemoryMb: 512` (`:288-359`)
    - a `FLIPPED` / seam case (`:556` onward; `caseOf` throws at `:1165`)
    - `toHaveLength(53)` (`:1260`)
    - the callable-set equality (`:1255`)
  - **Repository code.** `plain(Callables.StaffAnalytics, null)` passes no repository-failure `EdgeCode`, unlike every neighbouring call, and gives no reason.
- **Rationale & Recommendation:**
  - Declare `StaffAnalyticsCommand = AnalyticsCall & { callerUserId: UserId | null; callerRoles: readonly Role[] }` in the pipeline file, and have `decodeStaffAnalytics` build it.
  - Name the pipeline export once (e.g. `reportStaffAnalytics`) and import it under that name.
  - Wire `(ports, cmd) => reportStaffAnalytics(ports)(cmd)` with `{ ...LOG_DIGEST_SECRETS, memory: LARGE_MEMORY }`.
  - List each `main.spec.ts` change.
  - Pass the analytics repository code to `plain`, or state why it is `null`.
  - Fix spec line 272 to match.

### cd-2-2: Item 8's optional `linkedBarberId` is refused by lint, and the three-way wire meaning has no lawful shape - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details` (B4). Also raised by `egm-implementation-readiness` (M1), who rated it Major, and `egm-style` (N5). This is a new problem, introduced by the fix for ir-1-3.
- **Affected Scope:** Item 8 (lines 777-780).
- **Discrepancy Description:**
  - **Lint.** "Optional `linkedBarberId` (absent = unchanged, `null` = clear)" is refused by `ecs-syntax.mjs:88-92` (`TSPropertySignature[optional=true]` in any component, confirmed) and by `ecs-components.md` ("No optional property").
  - **Wrong file.** `decodeChanged` is a member of `RolesCall`'s own companion (`roles-call.data.ts:24-37`), used by the web's `roles-admin.adapter.ts`. Item 8 places it under `governance.wire.ts`.
  - **Answer.** The answer has no `linkChanged` flag, so the card cannot tell that a link-only change committed.
- **Rationale & Recommendation:**
  - Keep `linkedBarberId: BarberId | null`, and add a tag from an `as const` dictionary, e.g. `roleLinkChange: 'KEEP' | 'SET' | 'CLEAR'`.
  - `decodeSetRoles` decodes an absent field as `KEEP`, so an older web client never unlinks.
  - Put `decodeChanged` under `roles-call.data.ts`, and add `linkChanged` to `RolesCall.Changed`.

### cd-2-3: The `BarberLink` lock's id contradicts zero-mapper and the fixed-id precedent, and its field name drifts - Severity: Blocker

- **Reviewer Lens:** `egm-codebase-details` (B5). Also raised by `egm-style` (M15, N8) and `egm-implementation-readiness` (N2), who rated it Major and Nit. The higher severity is kept. This is a new problem, introduced by the fix for cd-1-8.
- **Affected Scope:** Items 6, 13 and 35 (lines 770-772, 807, 917-918). Spec line 419.
- **Discrepancy Description:**
  - **Id.** `BarberLink = { id: BarberId; linkedUserId }` is stored at `barbers/{id}/restricted/link`. Under Law 5, `{ id: snap.id, ...snap.data() }` gives `id = 'link'`, not a `BarberId`.
  - **Precedent.** The fixed-id precedent is a brand: `ClientMoneyStatsId` with `FIXED: 'money'` (`ids.primitive.ts:404-409`), used by `CLIENT_MONEY_DOC = ClientMoneyStatsId.FIXED` (`collections.ts:121-122`) and `client-money-stats.entity.ts:18-23`.
  - **Field name.** The spec says `{ userId }` (line 419). Items 6 and 35 say `linkedUserId`.
  - **Missing edits.** `entities/index.ts` is not listed as modified, and the `Subcollections.Restricted` JSDoc (`collections.ts:106`) is not updated.
- **Rationale & Recommendation:**
  - Add `BarberLinkId` (`FIXED: 'link'`) to `ids.primitive.ts` (Modify), and type the entity as `BarberLink = { id: BarberLinkId; linkedUserId: UserId }`.
  - Set `BARBER_LINK_DOC = BarberLinkId.FIXED`.
  - Use one field name in spec line 419, items 6 and 35, and the integration test.
  - Add the `entities/index.ts` export and the JSDoc update.

### ir-2-3: The `setRoles` link decision table is still not executable - Severity: Blocker

- **Reviewer Lens:** `egm-implementation-readiness` (B4). Also raised by `egm-codebase-details` (M1, M2, N1). Carried forward from ir-1-3.
- **Affected Scope:** Items 2, 19 and 26 (lines 751-754, 847-849, 878-881). Spec lines 445-456.
- **Discrepancy Description:**
  - **Revoke conflict (S-L-15).** The spec's table says "unchanged / unchanged → not revoked". Today an admitted unchanged call revokes, so that a retry can finish a failed revoke:
    - `set-roles.pipeline.ts:51-53, 178`
    - `role-assignment.system.ts:11-12`
    - `saveOf(change, revokePending)` at `:195-197`
    - `roles-call.data.ts:57`

    Item 26 says nothing about revocation, and the table breaks the intent of the S-L-15 tests (CLAUDE.md §0).

  - **Record existence.** The transaction reads only the new and the old lock, never `barbers/{id}`. `BarberId.parse` checks shape only, so a link to a record that does not exist would commit, and there is no error code for it.
  - **Link without the role.** Setting or changing a link on an account that does not hold, and does not gain, the barber role is not in the table.
  - **Error context.** `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED` carries "context `barberId`" (item 2), but it fires exactly when no barber id was sent. Only `ALREADY_LINKED` has a barber id.
  - **Snapshot shape.** Today's read is one `getAll` (`set-roles.pipeline.ts:121`). The read of the target, the old lock and the new lock, and the shape of the snapshot, are undefined.
- **Rationale & Recommendation:**
  - State the revoke rule: revoke when the roles changed, or when the set is unchanged and a revoke is pending; never on a link-only change. Name the `saveOf` edit.
  - Read `barbers/{id}` in the same `getAll`, and refuse a missing record with a named code.
  - Add rows for a link without the barber role.
  - Give `LINK_REQUIRED` the context `targetUserId`.
  - Define the snapshot type that `decide` receives.

### 🟡 Major

### cd-2-4: A link-only audit row claims the roles changed, and the `profileEditedAtUtcMs` stamp is missing - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M3). Also raised by `egm-style` (M16) and `egm-implementation-readiness` (as part of B4). Carried forward from ir-1-8.
- **Affected Scope:** Items 9, 20 and 26 (lines 781-784, 850-851, 878-881). Spec lines 440-441.
- **Discrepancy Description:**
  - **`profileFields`.** `planRolesChanged` hard-codes `profileFields: [AuditedProfileField.Roles]` (`audit.system.ts:892`).
  - **Missing field.** `AuditedProfileField` has no link member (`audited-profile-field.data.ts:17-23`), and `AUDITED_PROFILE_FIELDS` (`audit.system.ts:215-225`) omits the link. So an Admin-SDK or seed write of the link is never audited.
  - **Missing stamp.** The spec says "a link-only change stamps `profileEditedAtUtcMs` like a role change", but neither item 20 nor item 26 says so. Without the stamp, the `auditProfileChanges` trigger writes a second row (`auditedByCallable`, `audit.system.ts:817-824`).
  - **Audit action.** The `auditAction` of a link-only row is unstated.
- **Rationale & Recommendation:**
  - Add `AuditedProfileField.LinkedBarberId` (Modify `audited-profile-field.data.ts`) and append it to `AUDITED_PROFILE_FIELDS`.
  - Have `profileTagDelta` fill the link pair.
  - Make `profileFields` reflect what changed, and name the action.
  - Item 26 writes the user field and `profileEditedAtUtcMs`.

### cd-2-5: The report carries no rate fields, so the base-20 gate would sit in the presenter (Law 10.2) - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M10). Also raised by `egm-style` (M6) and `egm-implementation-readiness` (M3).
- **Affected Scope:** Item 11 (lines 790-803) against items 18 and 36. Spec lines 397-398.
- **Discrepancy Description:**
  - The spec says a rate "is `null` below it, counts always present", and item 18 tests "the rate gate at 19/20". Item 11 carries only counts and bases.
  - Nor does the report carry a fill percentage, takings per hour, the hero's change or sign, or an empty or first-period state tag.
  - The presenter would have to compare against 20 and derive states, which Law 10.2 forbids.
- **Rationale & Recommendation:**
  - Add `reportRebookedRate: number | null` and `reportNoShowRate: number | null`, computed in `StaffAnalyticsSystem.report`.
  - Add the other decided values the presenter prints, or name the system functions it calls for them.

### style-2-1: The hero comparison field does not say which side it holds - Severity: Major

- **Reviewer Lens:** `egm-style` (M7). Also raised by `egm-implementation-readiness` (M3).
- **Affected Scope:** Item 11 (line 796). Spec lines 370-374 and CUJ 5.
- **Discrepancy Description:**
  - The spec trims both sides of the comparison: day 1-28 against day 1-28, and a seat on today counts only once it has ended. So the current side is not always `reportTakingsCents`.
  - The single field `reportCompareTakingsCents | null` names neither side, and its `null` has no stated meaning.
- **Rationale & Recommendation:** Use two fields, `reportHeroCurrentTakingsCents` and `reportHeroPreviousTakingsCents: … | null`, each defined by the spec's day rule. State that `null` means "no previous period".

### cd-2-6: Report row types, partition fields and system inputs are still undeclared - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M11). Also raised by `egm-style` (M8) and `egm-implementation-readiness` (M3). Carried forward from cd-1-4.
- **Affected Scope:** Items 11, 16, 17 and 18 (lines 790-846).
- **Discrepancy Description:**
  - **Partition fields.** Seven of the ten partition field names are left as "…". The log line (item 25), the cache (item 39) and the presenter all depend on them.
  - **Undeclared types.** No fields are given for any of these:
    - the report rows `ServiceRow`, `WeekdayFill`, `OriginShare`, `BarberFigures`, `AnalyticsDayRow` and `AnalyticsSeatRow`
    - the `AnalyticsFigure` members
    - the system types `ChairDay` and `SeatNet`, with their home files
    - the inputs of `dayBreakdown` and `report`
  - **Namespace.** The namespace that holds the row types is unnamed, and the types are written unqualified.
  - **Day rows.** In the shop scope, "≤ 31 day rows" could mean one per day or one per barber-day (about 310).
  - **Ordering.** The order of the service rows is unstated.
  - **`readonly`.** The list types drop `readonly`, unlike spec line 262.
- **Rationale & Recommendation:**
  - List all ten field names.
  - Qualify each row type (`AnalyticsReport.ServiceRow`) and give its fields on one line.
  - List the `AnalyticsFigure` members.
  - Give `ChairDay` and `SeatNet` a file and fields.
  - Define the day-row grain and the service-row order.

### cd-2-7: `seatNets` invents a bare-literal union, and the non-euro case and `inEuroCents` export are undefined - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M12). Also raised by `egm-style` (M13) and `egm-implementation-readiness` (N3). Carried forward from cd-1-6.
- **Affected Scope:** Item 17 (lines 829-835).
- **Discrepancy Description:**
  - **Bare literals.** `{ allocation: 'ALLOCATED' } | { allocation: 'NOT_EVALUATED' }` uses bare literals with no `as const` dictionary (Law 1, `ecs-components.md`).
  - **Existing `Result`.** `BillingSystem.evaluate` already answers a `Result` with typed errors (`billing.system.ts:376-412`).
  - **Non-euro currencies.** `inEuroCents` returns `null` for currencies other than EUR and BGN (`client-stats.system.ts:677-681`). The plan does not say whether such a visit counts in `reportExcludedVisits`.
  - **Export.** `inEuroCents` is module-private (confirmed), and `client-stats.system.ts` is not listed as a modified file.
- **Rationale & Recommendation:**
  - Return `Result<readonly SeatNet[], …>`, or a union discriminated by a tag from a dictionary.
  - Count non-euro visits as not evaluated.
  - Add `client-stats.system.ts` (Modify): expose the conversion as `ClientStatsSystem.inEuroCents`, beside `BGN_PER_EUR` (`:899`), with no change in behaviour.

### ir-2-4: The time bar and fill cannot be built from the report's whole-period totals - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M4).
- **Affected Scope:** Items 11, 16 and 18. Spec lines 351 and 354.
- **Discrepancy Description:**
  - The bar covers past time only, "up to the current minute": worked, no-show, unmarked, blocked, unsold, and other (held + short gaps).
  - Fill also uses past-only blocked, held, unsold and short-gap minutes.
  - The report carries only whole-period totals of the ten parts, with no past/future split for blocked, break, held or short gaps. So `barSegments(report)` and `reportWeekdayFill` have no input.
- **Rationale & Recommendation:** Define a past/future split of each part on `ChairDay`, and add the matching report fields, or emit the bar segments and fill directly from `report`.

### ir-2-5: ChairTimeSystem's edge rules are undecided - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M5). Carried forward from ir-1-5.
- **Affected Scope:** Item 16 (lines 817-828).
- **Discrepancy Description:**
  - **Seats outside rostered time.** Whether their minutes are clipped from the ten parts is unstated, including a no-show or unmarked seat outside hours.
  - **"Worked outside hours".** Whether this is measured outside the hull (`IntervalSetSystem.hull`) or outside the rostered set is unstated. A split shift gives different answers.
  - **`reportClosedDayMinutes`.** "Minutes the roster would have given" needs the roster re-run without the `CLOSED` exception, which the plan does not include.
  - **A fully covered day.** When blocks and breaks cover the whole day, `laneGeometryOf` returns `NO_GEOMETRY` because `offeredWindows` is empty (`staff-day.store.ts:411-412`). That day's rostered and blocked minutes then vanish, which contradicts the catalogue's blocked part and the fill denominator.
- **Rationale & Recommendation:**
  - State the clipping rule and the hull rule.
  - Define the `closedDayMinutes` derivation.
  - Handle the empty-offered-windows day, with a spec case for each.

### ir-2-6: The location of "now" and "today" is undefined for holes, the period and follow-ups - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M6). Also raised by `egm-style` (M10) and `egm-codebase-details` (N6). Carried forward from ir-1-6.
- **Affected Scope:** Items 16, 18 and 25 (lines 819-821, 837-839, 873-874).
- **Discrepancy Description:**
  - **Holes.** "`sellableAt` with the seat's location's `ShopNow`" cannot apply: a hole has no seat, and a barber-day with no seats has no seat location.
  - **Still unstated:**
    - which location's "today" drives `isWithinRange`, the next 7 days and the current period;
    - which zone gives the bounds of the shop's `bookedAtUtcMs` range (`ZonedTimeSystem.startOfLocalDay`);
    - which zone converts a follow-up's booking date.
- **Rationale & Recommendation:**
  - Use the barber-day's location, i.e. the `locationId` of its rostered window (`RosterWindow`), and state the tie rule for a day split over two locations.
  - Name the location that supplies "today", and the zone for each conversion.

### cd-2-8: `ListLocations()` "any status" breaks agreement with the schedule (G5) - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M4). Also raised by `egm-implementation-readiness` (M6). This is a new problem, introduced by the fix for ir-1-2.
- **Affected Scope:** Items 15, 16 and 22 (line 859). Spec line 539.
- **Discrepancy Description:**
  - The store passes `this.catalog.locations()` to `laneGeometryOf` (`staff-day.store.ts:1678, 1706-1713`), and `ObserveLocations` streams ACTIVE shops only (`catalog.port.ts:36-39`).
  - `RosterSystem.shopHoursOn` does not filter: "which shops a day may offer … is the caller's rule" (`roster.system.ts:395-406`).
  - Fed every location, analytics produces different windows from the day summary. That is exactly the agreement case the fixture pins.
- **Rationale & Recommendation:** Pass only ACTIVE locations to `laneGeometry`/`shopHoursOn`, and keep the full list only for time zones and `ShopNow`. State this in items 22 and 25.

### ir-2-7: The `laneGeometry` move cannot be "unchanged" with its specs green, and an existing reuse is unnamed - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M8). Also raised by `egm-codebase-details` (M5) and `egm-style` (M9). Carried forward from cd-1-3.
- **Affected Scope:** Items 15 and 16 (lines 812-816, 824).
- **Discrepancy Description:**
  - **Spec import.** `lane-geometry.spec.ts:25` imports `laneGeometryOf` from `./staff-day.store` (confirmed).
  - **Delegate.** A forwarder left in the store fails `creativo/no-identity-mapper` (`eslint.config.mjs:471-480`).
  - **Type.** `LaneGeometry` is an `interface` in the store (`:337`, confirmed). Systems use `type`.
  - **Output.** The function returns the carved `rostered`, `blocks`, `breaks`, `dayBreaks` and `busy` (the stored projection). It returns no "uncarved union" and no "occupied time".
  - **Existing reuse.** The uncarved union already exists as `RosterSystem.atWork` (`roster.system.ts:447-474`), and the spec defines rostered time as `normalize(offeredWindows ∪ offeredCarveOuts ∪ offeredBreaks)`.
- **Rationale & Recommendation:**
  - Move the spec cases to `grid-layout.system.spec.ts` and delete the store export.
  - Declare `LaneGeometry` as a `type` in the system, and describe its real outputs.
  - In item 16, take rostered time from `RosterSystem.atWork`.

### ir-2-8: `scopeOf` lacks inputs and runs before the data it needs, and the row count is wrong - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M7). Also raised by `egm-style` (M4, M5) and `egm-codebase-details` (M16, N5). Carried forward from style-1-5.
- **Affected Scope:** Item 18 (line 836) and item 25 (lines 869-870). Spec lines 296-306.
- **Discrepancy Description:**
  - **Inputs.** `ANALYTICS_SCOPE_UNKNOWN` needs the barber records, and "a blocked account" needs `nowUtcMs` (`AccountLifecycle.isBlockedAt`). `scopeOf(caller, request)` takes neither.
  - **Order.** Item 25 calls `scopeOf` before it reads the barber records.
  - **Row count.** "All eleven rows" is wrong: the table has nine (confirmed), and its signed-out row belongs to the wire (item 30).
  - **Undefined cases:**
    - the default scope of an admin who also holds the barber role (dev Ivan, the subject of the item 51 e2e);
    - the answer for a missing or unregistered caller document.
- **Rationale & Recommendation:**
  - Use `scopeOf(caller, request, barberRecords, nowUtcMs)`, after the barber records are read.
  - Write "the eight rows after signed out; the signed-out row is covered by the wire spec, item 30".
  - Define the two missing cases.

### style-2-2: Item 25 omits reads the spec requires - Severity: Major

- **Reviewer Lens:** `egm-style` (M3).
- **Affected Scope:** Item 25 (lines 869-874). Spec lines 255-257, 279-280 and 360.
- **Discrepancy Description:** The listed steps never read three things the spec requires:
  - the rosters (`barberSchedules/{id}`);
  - the period's departures. Only the next 7 days' departures are read, but blocked, break and closed-day minutes need the whole period's;
  - the policy, which the late-cancellation fallback window needs.
- **Rationale & Recommendation:** Before "merge visits", add: read each scoped barber's roster; read the period's departures per barber (`LoadDeparturesForBarber`); read the policy.

### cd-2-9: The analytics request nests a sub-object, has no root type, and no alignment check - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M9). Also raised by `egm-implementation-readiness` (M2). This is a new problem, introduced by the fix for cd-1-4.
- **Affected Scope:** Item 12 (lines 804-806), items 28 and 30.
- **Discrepancy Description:**
  - **Nesting.** `AnalyticsCall.Request = { scopeBarberId; period: AnalyticsPeriod }` nests a 1-to-1 struct in wire JSON, which Law 6.1 forbids.
  - **Root type.** Law 1 needs the root type to be `AnalyticsCall`; the precedent `RolesCall` is the request itself (`roles-call.data.ts:12-15`).
  - **Alignment.** Nothing checks that `from` is a Monday or the 1st and that `to` is the span's end. So a caller can send an arbitrary range, which bypasses the read bounds (departures `limit(31)`) and the cost model.
- **Rationale & Recommendation:**
  - Define `AnalyticsCall = { scopeBarberId: BarberId | null; fromLocalDate: LocalDate; analyticsSpan: AnalyticsSpan }`, with `to` derived from the span.
  - The guard refuses a misaligned `fromLocalDate` (`ANALYTICS_INVALID_INPUT`).
  - Set `CallableWire[StaffAnalytics].input = AnalyticsCall`.

### cd-2-10: The adapter's limits would truncate silently, and its wiring is incomplete - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M6). Also raised by `egm-style` (M17) and `egm-implementation-readiness` (N8). Carried forward from cd-1-1.
- **Affected Scope:** Items 28 and 29 (lines 886-894).
- **Discrepancy Description:**
  - **Truncation.** `limit(keys × 60)`, `limit(30 × 5)`, `limit(20_000)` and `limit(31)` give no reason for 60 and 5, and say nothing about what happens when a query returns a full page. Silent truncation breaks G4 and G5.
  - **Precedent.** `firestore-privacy.adapter.ts:70-81, 141-165` reads at cap + 1 and refuses past the cap, "never truncated". The first malformed guarded document fails the read.
  - **Refused visits.** Whether a visit the guard refuses fails the report or is counted as excluded is unstated.
  - **Wiring.** Item 29 omits `FirestorePorts` gaining `AnalyticsReadPorts`, and `firestore-ports.spec.ts:64-69`, which pins every member name.
  - **Chunking.** `IN_CHUNK = 30` already exists (`firestore-privacy.adapter.ts:87`, `firestore-audit.adapter.ts:54`). It is unclear whether the pipeline or the adapter chunks the keys.
- **Rationale & Recommendation:**
  - Name each bound (≤ 60 visits per barber-day, ≤ 5 follow-ups per visit).
  - Read at cap + 1, and answer `RepositoryError` past the cap.
  - State the rule for guard refusals.
  - Add `FirestorePorts` and `firestore-ports.spec.ts` to item 29.
  - Reuse or lift `IN_CHUNK`, and say which layer chunks.

### ir-2-9: The edge table for the new codes is not fully specified - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M12). Also raised by `egm-codebase-details` (M7). Carried forward from ir-1-7.
- **Affected Scope:** Items 2 and 32 (lines 753, 902-904).
- **Discrepancy Description:**
  - **Edge entries.** `AnalyticsErrorCode` must join `EDGE_DICTIONARIES` and the `EdgeCode` union (`edge.ts:105-163`), and get an `ANALYTICS_WIRE: WireTable<AnalyticsErrorCode>` spread into `EDGE_WIRE` (`:765-794`). Each code needs `fields` or `withField` chosen (`INVALID_INPUT` names a `field`). Otherwise every code leaves as UNMAPPED `internal` (`:799-808`).
  - **Status code.** Item 2 maps `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED` to `failed-precondition`. The edge's own rule (`edge.ts:283-284`) makes a refusal of what was sent `invalid-argument`.
  - **Allowlist.** `WIRE_PARAM_ALLOWLIST` rows (`pipeline.error.ts:126`) are not mentioned.
- **Rationale & Recommendation:**
  - Write item 32 as a table: code, `HttpsError`, `fields`/`withField`, allowlisted params.
  - Reconsider `failed-precondition` for `LINK_REQUIRED`.

### cd-2-11: The answer decoder and the cache's "report guard" are undefined - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M8). Also raised by `egm-style` (M20). Carried forward from ir-1-7.
- **Affected Scope:** Items 11, 12, 23 and 39 (lines 790-806, 863-864, 941-944).
- **Discrepancy Description:**
  - `CALLABLE_ANSWER_DECODERS` is total (`callables.ts:334-364`), and decoders live on the call component (`RolesCall.decodeChanged`, `roles-call.data.ts:24-37`).
  - Item 23 says only "answer decoder", and item 39 decodes through "the report's guard", which no item declares.
  - A cached entry lacks seat rows, so the decoder must accept them empty.
- **Rationale & Recommendation:**
  - Add `AnalyticsCall.decodeReport(raw): Result<AnalyticsReport, PipelineError>` (through `CallAnswer`), with a spec, in item 12.
  - Cite it by name in items 23 and 39.
  - State that a cached entry has `reportSeatRows: []`.

### ir-2-10: The cache, the seat rows, freshness and sign-out clearing conflict or are unassigned - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M10). Also raised by `egm-style` (M18, M19) and `egm-codebase-details` (M16). Carried forward from ir-1-10.
- **Affected Scope:** Items 22, 36, 39 and 41 (lines 860-861, 927-929, 941-948). Spec lines 496-498, 505 and 699.
- **Discrepancy Description:**
  - **Missing seat rows.** The cache drops seat rows, and the store skips the call while `isFresh` holds. So a drill-down on a fresh cached report has no seat rows, and its footer cannot equal the figure. No field marks rows as "not loaded".
  - **No fresh request.** The spec's "only a barber's seat rows need a fresh request, shown with its own computed time" is not planned.
  - **No subscriber.** Nothing subscribes to `accountChanged` to clear the cache. The lazy analytics store is not alive at sign-out.
  - **Undefined ports.** The `AnalyticsCachePorts` signatures (parameters, return type, sync or async) are not given, nor is the encoding of `<scope>` and `<period>` in the key.
- **Rationale & Recommendation:**
  - Add the seat-row drill-down request, which shows its own `reportComputedAtUtcMs`.
  - Name an always-loaded subscriber, e.g. an environment initializer in `app.config.ts` that calls `clearCachedReports()` on `accountChanged`.
  - Give the cache port signatures and the key encoding.

### ir-2-11: Seat rows cannot go through `visitRowOf`, and the library export conflicts with `loadComponent` - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M9). Also raised by `egm-codebase-details` (M15, M16) and `egm-style` (N14). Carried forward from ir-1-19, with the severity raised.
- **Affected Scope:** Item 36 (lines 926, 930-931, 935) and item 42.
- **Discrepancy Description:**
  - **Wrong input.** `visitRowOf(appointment: Appointment, options, lookup)` (`visit-row.presenter.ts:294-312`) renders one row per visit. An `AnalyticsSeatRow` is not an `Appointment`.
  - **Export conflict.** "`src/index.ts` — the routes only" conflicts with item 42's `loadComponent`. The precedent exports the page class (`app.routes.ts:136-142`).
- **Rationale & Recommendation:**
  - Name a presenter function that maps `AnalyticsSeatRow` to `VisitSectionVm`/`VisitRowVm` for `lib-visit-list` (`visit-list.ts:103`).
  - Have `src/index.ts` export only `StaffAnalyticsPage`.

### ir-2-12: The client card has no barber stream, contrary to item 44 - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M11). Also raised by `egm-codebase-details` (N11). Carried forward from cd-1-11; the fix introduced a wrong claim.
- **Affected Scope:** Item 44 (lines 954-958).
- **Discrepancy Description:**
  - **No barber stream.** "The catalog's barber stream already provided to the card" is false. `client-card.store.ts` injects no catalog or barber port (`:394-475`).
  - **Candidate source.** The nearest source is `ClientCardCatalog.barberIds?()` plus `barberName` (`client-card.contracts.ts:106-133`), which is optional, or `CATALOG_PORTS.observeBarbers`.
  - **Retired barbers.** Both list ACTIVE barbers only (`catalog.port.ts:26-29`), so a retired linked barber's name cannot be shown.
  - **Template.** "The roles row's template" names no file.
- **Rationale & Recommendation:**
  - Name the source, and say what the picker does when it is absent.
  - Say how a retired linked record is shown.
  - Name the template `client-card/client-card.html` (around `:725`).

### cd-2-12: `?free=1` outlives the page load, and the sheet's Apply would persist it - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M14). Also raised by `egm-implementation-readiness` (N5). Carried forward from cd-1-2.
- **Affected Scope:** Items 46 and 47 (lines 964-969).
- **Discrepancy Description:**
  - `ScheduleStatusFilter` is `providedIn: 'root'` (`schedule-status-filter.ts:90`), so a non-persisting set survives later navigation.
  - `apply(draft)` stores `draft.freeTimeShown` (`:149-154`), so a draft seeded from the one-off value would persist it.
- **Rationale & Recommendation:**
  - Keep a separate `once` signal, with `freeTimeShown = computed(() => freeTime() || once())`.
  - Reset `once` when the dashboard is destroyed.
  - Seed the sheet's draft from the stored value only.

### cd-2-13: "Within one cent per visit" does not hold for a client with several seats on one bill - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M13).
- **Affected Scope:** Items 17, 48 and 49 (lines 834-835, 975-983). G5.
- **Discrepancy Description:**
  - `moneyOf` rounds once per visit over the client's own WORKED seats (`client-stats.system.ts:796-806`). The largest-remainder split rounds per seat.
  - Counter-example: 7 seats at 1¢, a total of 4¢, one client owning 4 seats. Largest remainder gives that client 4¢; `moneyOf` gives `round(16/7) = 2¢`.
  - BGN visits also round per seat.
- **Rationale & Recommendation:**
  - State the bound per worked seat (≤ k cents for k seats).
  - Add a multi-seat client and a BGN visit to the item 48 fixture.

### cd-2-14: The Verification Plan names wrong Nx projects and misses targets - Severity: Major

- **Reviewer Lens:** `egm-codebase-details` (M17). Also raised by `egm-implementation-readiness` (M13) and `egm-style` (M21). Carried forward from ir-1-12.
- **Affected Scope:** Lines 1000-1015, item 36.
- **Discrepancy Description:**
  - **Wrong project names.**
    - `client-card:test` should be `staff-client-card:test` (`libs/features/staff/client-card/project.json:2`).
    - `shell:test` should be `shared-shell:test` (`libs/features/shared/shell/project.json:2`).
    - The generator call does not fix the new project's name (`--name=staff-analytics`).
  - **Emulators.** `functions:test-integration` and `web:e2e` need emulators. The repository's commands are `pnpm run test:emulator` and `pnpm run e2e:web` (`package.json:13-14`).
  - **Missing targets.**
    - `firestore:test-integration`, which runs item 34's case in `firestore.rules.integration.spec.ts` (`libs/infrastructure/firestore/project.json:12-23`)
    - `verify-tools:test`, which audits the new `fieldOverrides`
    - `i18n:test`
    - `lint-rules:test`
    - `pnpm run verify:p0`, although item 5 edits `verify-p0.mjs`
- **Rationale & Recommendation:** Fix the names, use the emulator scripts, and add the missing targets.

### ir-2-13: The e2e test has no seeded accounts and an undecided default scope - Severity: Major

- **Reviewer Lens:** `egm-implementation-readiness` (M14). Carried forward from ir-1-11.
- **Affected Scope:** Items 5 and 51 (lines 767-769, 986-989).
- **Discrepancy Description:**
  - **Seed data.** The e2e test needs three things that `apps/web/e2e/support/seed-firestore.ts` does not list:
    - an unlinked barber account;
    - an account for the admin to link;
    - a free barber record for that link.
  - **Default scope.** `dev-staff-ivan` is barber + admin (`seed-dev-catalog.mjs:533-535`). His default scope decides what "the footer equals the figure" asserts, and it is undefined.
- **Rationale & Recommendation:** List the seeded bodies, and fix Ivan's default scope (see ir-2-8).

### style-2-3: `isFresh` is called a T2 staleness budget, but T2 is a closed list that does not include it - Severity: Major

- **Reviewer Lens:** `egm-style` (M14).
- **Affected Scope:** Item 18 (lines 840-841). Spec Terms line 110.
- **Discrepancy Description:** `flatten-spec.md:539` says "These rows, and ONLY these, compare or add `UtcEpochMs` values" (confirmed), and its staleness row (`:551`) does not list analytics. No target file amends `flatten-spec.md`.
- **Rationale & Recommendation:** Add `docs/architecture/flatten-spec.md` (Modify) with a new row under "Staleness and budgets", or record it in item 53's ADR.

### style-2-4: "A cancelled seat on a completed visit" still drifts from the spec - Severity: Major

- **Reviewer Lens:** `egm-style` (M11). Carried forward from style-1-4.
- **Affected Scope:** Item 16 (line 827) and item 48 (lines 976-977). Spec lines 329-331 and 403.
- **Discrepancy Description:** The spec's term is "a `CANCELLED` seat on a visit that is not wholly cancelled". "Completed" is narrower: it leaves out future visits.
- **Rationale & Recommendation:** Use the spec's wording in both places. Item 16's own rule text (line 823) already does.

### style-2-5: The specification is stale against the plan - Severity: Major

- **Reviewer Lens:** `egm-style` (M12). Also raised by `egm-codebase-details` (N10) and `egm-implementation-readiness` (N6), who rated it Nit.
- **Affected Scope:** Spec lines 63/72, 262, 272, 390, 396, 415-416 and Alternative I.
- **Discrepancy Description:** The spec still says:
  - `seatNets(appointment): readonly SeatNet[]` (line 390), where the plan has a union;
  - `report(input, now)` (line 396), where the plan has `nowByLocation`;
  - `barbers:` (line 262), where the plan has `reportBarbers`;
  - "setRoles and erasure change it" (lines 415-416), which contradicts lines 437-439;
  - "2 range queries (~4,000 results)" in Alternative I, where the reads table has one query of ~2,000;
  - `mayEditRoster` at `firestore.rules:63`, which is its comment; the function is at `:72`.
- **Rationale & Recommendation:** Update each spec line to the plan's decision, so the source of truth agrees with it.

### style-2-6: The rollout and rollback text is wrong - Severity: Major

- **Reviewer Lens:** `egm-style` (unnumbered Major). Also raised by `egm-implementation-readiness` (N9), who rated it Nit.
- **Affected Scope:** Item 52 (lines 990-992). Spec line 705.
- **Discrepancy Description:**
  - **Rollback.** "The callable and the field stay unread" is false: after rollback, `setRoles` still reads the lock and the field, and still requires a link to grant the barber role.
  - **Older clients.** Between the functions deploy and the web deploy, an older card granting the barber role is refused `LINK_REQUIRED`. So "an older web app ignores `linkedBarberId`" understates the impact.
  - **Indexes.** The `firestore.indexes.json` deploy is missing from the deploy order.
- **Rationale & Recommendation:**
  - Reword the rollback: "`staffAnalytics` stays deployed but uncalled; `setRoles` keeps requiring and writing the link and its lock".
  - State the older-client impact, and add the indexes to the deploy order.
  - Correct spec line 705.

### 🟢 Nits

### ir-2-14: The `LogEvent.AnalyticsReported` value and its pinned spec are missing - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness` (N1). Also raised by `egm-codebase-details` (N2).
- **Affected Scope:** Item 14 (line 808).
- **Discrepancy Description:** The string value is not given. New values are dotted and domain-prefixed (`log-event.data.ts:9-12`), and `log-event.data.spec.ts` pins the whole dictionary.
- **Rationale & Recommendation:** Give the value (e.g. `'analytics.reported'`) and add the spec update.

### cd-2-15: The governance codes' union, namespace and factories are not named - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` (N1). Also raised by `egm-implementation-readiness` (N4).
- **Affected Scope:** Item 2 (lines 751-754).
- **Discrepancy Description:** `SetRolesError` is `GovernanceError | RepositoryError` (`governance.error.ts:403`). The codes go into `GovernanceErrorCode`, the `GovernanceError` union, its namespace and its factories (`:19-116`).
- **Rationale & Recommendation:** Say so in item 2.

### cd-2-16: `OPERATION_ID_FIELD: null` departs from precedent without a reason - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` (N3).
- **Affected Scope:** Item 23 (line 864).
- **Discrepancy Description:** The read-only `previewClientErasure` carries `'operationId'` (`callables.ts:253`). Today's only `null` is the client issue sink, which has an OR-34 privacy reason.
- **Rationale & Recommendation:** Use `'operationId'` for trace correlation, or record the reason for `null`.

### cd-2-17: There is no claims-tolerant role predicate - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` (N4).
- **Affected Scope:** Item 7 (lines 773-776).
- **Discrepancy Description:** `anyIn` is private. The precedent predicates are `assignsRoles` and `handlesClientPrivacy` (`roles.data.ts:188-200`). The callable-only comment in `role.rules-parity.spec.ts:24-29` lists the role sets.
- **Rationale & Recommendation:** Add `Roles.readsAnalytics(roles)`, and note the new sets in that comment.

### cd-2-18: New tag fields lack dictionary type-spec pairings - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` (N8).
- **Affected Scope:** Items 10 and 11.
- **Discrepancy Description:** `analyticsSpan` and `AnalyticsFigure` need entries in a `components/*-dictionaries.type-spec.ts`, which `tools/lint-rules/dictionary-fields.spec.mjs` checks.
- **Rationale & Recommendation:** Add the pairing.

### cd-2-19: Item 34's rules wording and spec file are vague - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` (N9). Also raised by `egm-implementation-readiness` (N10) and `egm-style` (N13). Carried forward from style-1-7.
- **Affected Scope:** Item 34 (lines 913-916).
- **Discrepancy Description:**
  - The "documented user key list" is a comment (`firestore.rules:213-216`), not a rule.
  - The root deny (`:197-199`) already covers the lock.
  - Keep the wildcard `{doc}`, not `{docId}`: `role.rules-parity.spec.ts:96-99` finds `/restricted/{docId}` by its text.
  - The rules spec file is unnamed.
- **Rationale & Recommendation:**
  - Write "the comment listing the user document's keys gains `linkedBarberId`".
  - Name `firestore.rules.integration.spec.ts`.

### ir-2-15: The generated library's ESLint config and name are not pinned - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness` (N11). Also raised by `egm-codebase-details` (N7).
- **Affected Scope:** Item 36 (lines 922-923).
- **Discrepancy Description:** The generated `eslint.config.mjs` must import `#eslint-config` (`ecs-layering.md`; `libs/features/staff/dashboard/eslint.config.mjs:2`), or `verify-tools:layering` fails.
- **Rationale & Recommendation:** Say so, and pass `--name=staff-analytics`.

### ir-2-16: There are no in-memory doubles for the new ports - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness` (N7).
- **Affected Scope:** Items 25 and 48.
- **Discrepancy Description:** The pipeline spec contract needs in-memory doubles for `AnalyticsReadPorts` and the cache ports in `@core/testing`.
- **Rationale & Recommendation:** Add them to item 48.

### ir-2-17: The pipeline should read `linkedBarberId` through the absent-as-`null` reader - Severity: Nit

- **Reviewer Lens:** `egm-implementation-readiness` (N12). Also raised by `egm-style` (N4).
- **Affected Scope:** Items 4 and 25 (lines 756-758).
- **Discrepancy Description:** The adapter returns the stored body raw. A "guard" answers yes or no, so it is the wrong name for something that reads an absent field.
- **Rationale & Recommendation:** Name it as a reader, `StaffLink.of(raw)`, and call it in item 25 and on the web.

### cd-2-20: The cited dashboard lines sit in a file with uncommitted edits - Severity: Nit

- **Reviewer Lens:** `egm-codebase-details` (N12).
- **Affected Scope:** Item 47 (line 967).
- **Discrepancy Description:** `staff-dashboard.ts:806-815` matches the current working copy only. That file, its html and its spec have uncommitted edits.
- **Rationale & Recommendation:** Cite the symbol (the route `input()` block) rather than line numbers.

### style-2-7: The opening sentence and the Step 7 heading are imprecise - Severity: Nit

- **Reviewer Lens:** `egm-style` (N1, N2).
- **Affected Scope:** Lines 735-737, 962 and 971.
- **Discrepancy Description:** "And the record" means the ADR in item 53. "The two schedule changes" holds one change; the other is a pointer to item 15.
- **Rationale & Recommendation:** Write "the ADR", and rename the heading "The free-time query parameter".

### style-2-8: Item 16's rule numbering differs from the spec's - Severity: Nit

- **Reviewer Lens:** `egm-style` (N3).
- **Affected Scope:** Item 16 (line 824).
- **Discrepancy Description:** The spec numbers Blocked as rule 2 and Break as rule 3. Item 16 merges them as "Rule 2".
- **Rationale & Recommendation:** Write "Rules 2 and 3".

### style-2-9: Notation and naming are inconsistent - Severity: Nit

- **Reviewer Lens:** `egm-style` (N6, N7).
- **Affected Scope:** Items 10 and 11 (lines 787-799).
- **Discrepancy Description:**
  - `startOfMonth(today) − 12 months` is pseudo-notation.
  - The count suffixes are mixed: `reportOutsideHoursSeats` and `reportExcludedVisits` sit beside `…Count`.
  - "Excluded" does not say why.
- **Rationale & Recommendation:**
  - Write `LocalDate.addMonths(LocalDate.startOfMonth(today), -12)`.
  - Use `reportOutsideHoursSeatCount` and `reportUnevaluatedVisitCount`.

### style-2-10: Port names and parameters are vague or untyped - Severity: Nit

- **Reviewer Lens:** `egm-style` (N10). Carried forward from style-1-10.
- **Affected Scope:** Item 22 (lines 856-861).
- **Discrepancy Description:**
  - "Web bundles" reads as JavaScript bundles.
  - `LoadDeparturesForBarber(barberId, from, to)` is untyped.
  - `LoadFollowUpsFrom` is vague.
- **Rationale & Recommendation:**
  - Write "for the web app, the bundles …".
  - Type the parameters as `fromLocalDate, toLocalDate`.
  - Rename the port `LoadFollowUpsOf(appointmentIds)`.

### style-2-11: Several phrases drift from the spec or are vague - Severity: Nit

- **Reviewer Lens:** `egm-style` (N9, N11, N14, N15). Carried forward from style-1-10.
- **Affected Scope:** Items 19, 25, 26, 36, 45, 49, 50 and 51.
- **Discrepancy Description:**
  - "The involved locks" (item 19) against "the new and the old lock" (item 26).
  - "Keep those with a `bookedFromAppointmentId` in memory" is ambiguous.
  - "By-service rows" and "rates" drift from the spec's terms.
  - "The two governance codes" are not named.
  - "Through the store's own path" names no function.
  - "Dated" is unclear.
  - "Sees the footer of takings equal the figure" is awkward.
- **Rationale & Recommendation:**
  - Use "the new and the old lock" in both places.
  - Write "filter in memory to those with".
  - Use "seats by service" and "rebooked, no-shows, late cancellations".
  - Name `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED` and `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED`.
  - Name `laneGeometryOf` and the day-summary gap rows.
  - Write "with the date it was set".
  - Write "opens the takings figure and sees the footer total equal it".

### style-2-12: Code spans still break across lines - Severity: Nit

- **Reviewer Lens:** `egm-style` (N16). Carried forward from style-1-9.
- **Affected Scope:** Lines 756-757, 770-771, 800-801, 805-806, 841-842, 867-868, 886-887, 895-896, 898-900 and 917-918.
- **Discrepancy Description:** Continuation lines start at column 0 inside backtick spans.
- **Rationale & Recommendation:** Keep each span on one line, or move signatures (especially item 31's `onCall` expression) into fenced `ts` blocks.

### style-2-13: Parts of the Verification Plan are incomplete - Severity: Nit

- **Reviewer Lens:** `egm-style` (N17). Carried forward from style-1-12.
- **Affected Scope:** Lines 1016-1022.
- **Discrepancy Description:**
  - The p95 sentence has no thresholds.
  - "Correctness gate before v2" drifts from the spec's "Reconciliation gate before earnings" (line 153).
  - "Voucher draws" is undefined.
  - The gate has no owner.
- **Rationale & Recommendation:**
  - Add the thresholds: ≤ 1.5 s for a barber-month and ≤ 4 s for a shop-month.
  - Use the spec's gate name.
  - Define "voucher draws" and name the owner.

---

## Severity Breakdown

| Severity   | Count | Ids                                                    |
| ---------- | ----- | ------------------------------------------------------ |
| 🔴 Blocker | 6     | cd-2-1, ir-2-1, ir-2-2, cd-2-2, cd-2-3, ir-2-3         |
| 🟡 Major   | 27    | cd-2-4…cd-2-14, ir-2-4…ir-2-13, style-2-1…style-2-6    |
| 🟢 Nit     | 17    | ir-2-14…ir-2-17, cd-2-15…cd-2-20, style-2-7…style-2-13 |

**New problems introduced by the round-1 fixes:**

- ir-2-1 (bundles that do not exist)
- ir-2-2 (part: the `caller` argument)
- cd-2-2 (optional property)
- cd-2-3 (lock id)
- cd-2-8 (`ListLocations` any status)
- cd-2-9 (nested `period`)
- ir-2-12 (false barber-stream claim)
