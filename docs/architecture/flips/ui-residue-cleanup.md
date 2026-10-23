# UI residue cleanup — the visit shim, the `kind` unions, the stray classes, the ambient clock

**Date:** 2026-10-23 · **Status:** INTEGRATED 2026-10-23 — every package
landed, the FULL gate of HANDOFF §4 green (baseline reds only, the emulator
journeys included), runbook §4.2–§4.5, §4.7, §4.8 and §4.9 PASS, the dev
smoke byte-identical to `c77e932` (§8.1, §11); it lands as the "UI residue
cleanup" commit on `main`. Written as a PLAN on `main` at `c77e932` (the ECS
migration complete, the tree clean); line numbers are hints on that commit
and drift. ·
**Law:** `CLAUDE.md` Laws 1–9 and the eight `.claude/rules/*.md` (here above
all `angular-ui.md`: stores hold ecs-core values and call systems, formatting
in the template layer, "today" in the LOCATION's zone). This plan never
overrides them. It removes the translation tables and the legacy words; it
does NOT remove the presenter/view-model mapper layer (`visitRowOf`,
`visitCardOf`, `catalog-to-vm.ts`, the client-card presenters — 20
production `*.presenter.ts`/`*vm*.ts` files), which behaviour-frozen work
cannot touch: that is its own view-model pass (UR-13 f, §10 OQ-11). ·
**Sources:** `docs/architecture/HANDOFF.md` §3.3 "Carried forward", §4 (gate
and baselines), §5 (operating rules); `docs/architecture/flips/phase-4b-delete.md`
OQ 15 and §3; `docs/architecture/flips/phase-4a-repoint.md` 4A-13 and §8.1
item 7; `docs/architecture/firestore-runbook.md` §4.7 (the shim exemptions of
the zone gates); the four inventories the workflow handed in, each re-derived
here with an AST scan of every production `.ts` under `libs/features`,
`libs/ui`, `libs/shared`, `libs/infrastructure`, `apps/web/src` and
`apps/showcase/src` (specs, type-specs, `testing/`, `test-setup.ts` and
`e2e/` excluded).

**What this is.** Not migration — follow-up work the migration carried
forward. Four kinds of transitional residue remain in the web UI layer:

1. **The visit shim** — `libs/features/shared/visits/src/lib/visit-ecs.shim.ts`
   translates the ecs-core SCREAMING tags and the shop wall clock back into
   the legacy lower-case words and epoch instants the frozen
   `visit-row.vm.ts` still speaks, plus a Sofia zone literal and a
   module-level mutable cache. The re-derivation found three more
   translation layers of the same shape the inventories did not list
   (§1.5): `client-query.ts`'s `LEGACY_CLIENT_QUERY_SHAPE` + inverse,
   `staff-time-grid.ts`'s `GRID_EVENT_OF`, the dashboard's verb word round
   trip (`ROW_VERB_WORD` out to the sheet and back), the time grid's and the
   agenda's `bookingStatusWords` → lower-case → `hollowStatus` round trip,
   the dashboard's `resolutionOf` (`BookingStatus` → word → the editor's
   `resolution.kind`), and the coupon occasion chain (the day store's
   `'birthday'` ternary → the editor's `VisitEditorGrantOption.occasion` →
   the client card's `COUPON_OCCASION_OF`).
2. **View-state and other unions discriminated by `kind`/`status`** — 28
   production files carry a `kind`/`type`/`status` property signature (§1.2;
   no `type` survives, all are `kind` or `status`), plus three local copies
   of one load-state dictionary (`CardLoadState`, `RhythmLoadState`,
   `AppointmentsViewState`) and four bare-string load-state unions.
3. **Five undecorated classes in production code** — `VisitClock`,
   `CardClock`, `EdgeScroller`, `FrameFullscreen` and, missed by the brief,
   `ConsoleUiIconReporter` (`libs/ui/icons`).
4. **Ambient clock and entropy reads** — 22 production files outside the
   sanctioned adapters build a `Date`, read `Date.now()`/`Date.parse()` or
   call `Math.random()` (§1.4).

**This pass ends** when the shim and every other legacy translation table is
deleted, no production feature/ui file carries a `kind`/`type`/`status`
property signature (one allowlisted wire format), no undecorated class lives
in production code, no production feature/ui/showcase file reads the clock or
`Math.random()` outside two justified allowlist entries, three new lint rules
plus a runbook gate (§4.9) make each of those facts mechanical, and the full
gate of HANDOFF §4 is green (baseline reds only) with the screens unchanged.

Greenfield, as before: no fallback reader, no dual shape, no shim. Nothing is
committed by a package; the integrator owns the gate.

---

## 0. Decisions this plan takes (read first)

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UR-1  | **Frozen behaviour.** Every screen renders the same text in `bg` and `en`, the same DOM structure, the same `data-testid`s, CSS classes and attributes (`data-state`, `data-upcoming`, `data-perspective`, `data-kind`, `data-status`, `data-page`, `data-verdict`, `data-section-key`, …) with the same VALUES, the same ordering, the same timing; every i18n key is byte-identical; every stored document and callable payload is unchanged (draft seat and guest ids keep their exact format, UR-11). A spec failing after a change means the change altered behaviour: fix the code, never the spec. A spec is re-targeted ONLY to name the new types, fields and values (`VisitFilter.NoShow` for `'no_show'`, `loadState` for `kind`, a `CLOCK_PORTS` provider where a component now injects it), never to accept different output. The five departures §0 cannot avoid without breaking a law are listed in UR-16 and ruled in §10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| UR-2  | **ONE shared view-state vocabulary, in a new zero-dependency lib** `libs/shared/view-state`, alias `@creativo/shared/view-state`, tags `scope:shared`, `type:util` (importable by every `type:feature`, `type:ui` and `type:app` project; depends on nothing). It holds `LoadState` (`LOADING`/`READY`/`FAILED`/`EMPTY`), the slice `LoadSlice<T>` (+ `LoadSlice.WithEmpty<T>`), `PagingState` (`MORE`/`LOADING`/`FAILED`/`END`) and the one shared words table `loadStateWords`. It REPLACES the three local copies (`CardLoadState` + `Slice<T>` in `client-pages.vm.ts`, `RhythmLoadState` + `Slice<T>` in `admin-rhythm.store.ts`, `AppointmentsViewState` + `UpcomingListState` in `appointments.store.ts`), the eight `kind`-discriminated load unions and the four bare-string ones (`VisitListState`, `VisitsPageStatus`, the client card's `more: 'idle'\|'loading'\|'failed'`, the bare `state()`/`pageState()` strings of admin rhythm and client profile), and the three bare load-word sentinels listed under the §1.2 table (the client card's `'loading'` tier and `'failed'` record read, `/account`'s host `data-state` ternary). Rejected homes: `@creativo/infrastructure/i18n` (a read state is neither i18n nor an adapter, and `type:ui` cannot import it), `@creativo/ui/patterns` (feature view state inside the design system), `@core/components` (domain only — a screen's read state is not a domain component), `libs/shared/cursor` (an Angular cursor lib), any feature lib (marketing and admin would depend on visits).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| UR-3  | **Words tables — one per tag family, where its readers can reach it (ONE placement rule).** A tag family whose word reaches the DOM or an i18n key gets exactly ONE table, placed by who reads it: read by MORE than one lib → `@creativo/infrastructure/i18n` (the precedent `program-status-words.ts`, `booking-status-words.ts`) — here `visit-list-words.ts` (`visitFilterWords`, `visitGrainWords`, `visitPerspectiveWords`; readers: the visits lib, client appointments, the client card), and (review fix) `streak-period-words.ts` (`streakPeriodReasonWords`, `streakPeriodMarkWords`; readers: the client card's wallet and the admin rhythm page, which each kept a copy — `RHYTHM_REASON_WORDS`/`PERIOD_REASON_KEY`, `PERIOD_MARKS`/`PERIOD_MARK`, all deleted; the mark words are typed against the DS's `UiStreakMark` at each use) and `daypart-words.ts` (`daypartWords`; readers: the visits lib's waiting row and the booking time sheet, each keeping its own key prefix — the two `DAYPART_KEY` copies deleted); read by ONE lib → beside its reader in that lib, whether the family is an ecs-core dictionary or a feature one — here `gridEventWords` and `clientQueryShapeWords` (ecs-core `GridEvent`/`ClientQueryShape`, read only by `staff-dashboard`: one file `libs/features/staff/dashboard/src/lib/tag-words.ts`, created by P0 because P4a and P4b both read it), the existing `RECORD_KIND_WORDS`/`LEDGER_FILTER_WORDS` of `client-card.words.ts` (ecs-core families, one reader — they stay; `RhythmReasonWord` stays there as an alias of i18n's `StreakPeriodReasonWord`), and the feature dictionaries' tables beside the dictionary in the same file (`visitCardSlotWords`, `birthdayMomentWords`, `gridMaskWords`, `editorPageWords`, `frameVerdictWords`). The load state's lower-case words differ by page (`FAILED` is `'error'` on `/account` and `/appointments`, `'failed'` on admin rhythm; `READY` is `'populated'` on `/account`'s card): the shared `loadStateWords` serves the pages that spell it that way (admin rhythm, client profile), and a page whose e2e contract spells it otherwise keeps ONE page table `satisfies Record<LoadState, string>` over the ONE dictionary (`upcomingStateWords` in client-account, `appointmentsStateWords` in the appointments store — the renamed `appointmentsViewStateWords`). That is reuse of the dictionary with a per-contract spelling, not a copy. No table is created for a tag whose word reaches neither the DOM nor a key (`VisitRowOutcome`, `CancelledSide`, `PagingState`, `DragGesture`, …).                                                                                                                                                                                                                                                                                                                                                                                        |
| UR-4  | **Law 6 for view state.** Every discriminator is a domain-prefixed field named `camelCase(Dictionary)` with SCREAMING_SNAKE values declared once in an `as const` dictionary, compared with `===` against the dictionary member — in `.ts` and in templates (a component exposes `protected readonly LoadState = LoadState;` and writes `@case (LoadState.Loading)`), never a bare literal. An ecs-core dictionary is reused wherever it already names the variants (`CompositionKind` for single/bundle, `ClientQueryShape`, `GridEvent`, `EditCommand.Move`/`Resize` for the grid commit, `ResizeEdge` (`START`/`END`) for every resize edge of the grid and the timeline (and the drag gesture built from it, §2.5), `DiscountMethod.PercentOff`/`FixedAmount` for the typed discount figure, `BookingStatus` for a resolution and every `status: BookingStatus` field, `PersonalRecordKind` for a record, `CouponOccasion` for a grant's occasion). A single-variant tag (`VisitTrailing.kind: 'barber'`, `VisitEditorCommit.kind: 'save'`) is DELETED, not renamed: a one-member union discriminates nothing; `null`/absence already does (§1.2). The rule holds at the TYPE level too: an exclusion names the member, `Exclude<PagingState, typeof PagingState.End>` (the ecs-core precedent `Exclude<RepeatPreset, typeof RepeatPreset.Never>`, `visit-draft.system.ts:104`), never `Exclude<PagingState, 'END'>`. A method parameter that picks a branch is a discriminator too (`openCreate(kind: 'booking' \| 'block')` → `CreateIntent`, §1.2 row 45). Every NEW feature dictionary, and the variant union it tags, is named once in §2.8; no new name may equal an export of `@core/*` (P0 checks the §2.8 list against the six tier barrels — the check found `ShopReach` taken, hence `ShopCoverage`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| UR-5  | **Zero inbound mapping for the visit rows (Law 3).** `VisitRowVm` drops `startMs` and carries the appointment's own `localDate: LocalDate` + `startMinutes: MinuteOfDay`, its `outcome` typed as the ecs-core `VisitRowOutcome \| null`, so a row IS a `VisitListSystem` `SectionRow` and `FilterRow` and is handed to `sections`/`matches`/`offered`/`workedFigure` as it is. `status` becomes `bookingStatus: BookingStatus \| null` (values unchanged — `data-status` still prints `PENDING`/`CONFIRMED`/`CANCELLED`). The four lower-case unions of `visit-row.vm.ts` are deleted and the ecs-core types (`VisitPerspective`, `VisitGrain`, `VisitRowOutcome`, `VisitFilter` from `@core/systems`, `CancelledSide`) are imported, not re-declared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| UR-6  | **"Now" at the boundary (Law 7.3).** The visit builders take `now: ShopNow` plus `timeZone: TimeZone` (the zone that `now` was read in — the fallback for a photo's day when the lookup does not know a location's zone) in place of `nowMs: number`. The HOST derives `ShopNow` once: the appointments store already exposes `now: Signal<ShopNow \| null>`; the client card store derives it from its `CLOCK_PORTS` reading and `shopZones.defaultZone()`; client-account injects `CLOCK_PORTS` and `ShopZoneService`. `VISITS_TIME_ZONE`, `shopNowOf` (and its module-level `let lastNow`), `utcMsOf`, `zoneOf`, `wallTimeOf`, `filterRowOf` die with the shim; `visitZoneOf` returns `TimeZone \| null` with no Sofia fallback. No `'Europe/Sofia'` literal remains in `libs/features` outside the already-allowlisted static landing content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| UR-7  | **Classes become factories (Law 1/§2), none becomes an Angular kind.** None of the five is owned by Angular DI or lifecycle in a way that needs a decorator. `VisitClock` + `CardClock` merge into ONE `visitClockOf(localDate, minute, now, locale, timeZone): VisitClock` (CardClock is a copy — reuse, never copy) whose type gains the card's three own faces (`dayShort`, `weekdayAndDay`, `whenHeard`); `EdgeScroller` → `edgeScrollerOf(axis, scroller, scrolled): EdgeScroller` (closure state, same tick order); `FrameFullscreen` → `injectFrameFullscreen(options): FrameFullscreen` (Angular's `inject*` idiom, called from the same field initialisers, so templates are untouched); `ConsoleUiIconReporter` → `consoleUiIconReporter(loud): UiIconReporter`. A `@Directive` for the fullscreen toggle was considered and rejected (it moves host bindings, listeners and the toggle's template reference — markup churn against UR-1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| UR-8  | **What stays a class, and why.** Test support only, exempted by PATH from the new guard: `FakeFirestore` (`libs/infrastructure/firestore/src/testing/fake-firestore.ts`, a fake of the SDK that never ships in a bundle); `StubResizeObserver` (`libs/features/staff/client-card/src/testing/achievements-pages.rig.ts`, a DOM polyfill the code under test calls with `new`); the spec-local observer/loader doubles (`FakeIntersectionObserver` in `sheet-header.spec.ts`, the observers in `scroll-row.spec.ts`, `modal-sheet.spec.ts`, `visits-browser.spec.ts`, `sheet-width.spec.ts`, `FixtureLoader` in `translate-domain-error.spec.ts`); the `window.*Observer = class {…}` polyfills of `libs/features/marketing/landing/src/test-setup.ts`, `libs/shared/cursor/src/test-setup.ts`, `apps/showcase/src/test-setup.ts`. Node tooling under `tools/**` (`ExecutionTally` in `tools/seed/settle.mjs`, `LostAnswer extends Error` in `tools/verify/p0/verify-p0.mjs`) is outside the apps and outside this pass (§10 OQ-6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| UR-9  | **Clock routing.** A UI clock read is `inject(CLOCK_PORTS).nowUtcMs()` (`@creativo/infrastructure/firebase-app`, bound in `apps/web/src/app/app.config.ts` to `browserClockPorts`; specs pin `memoryClockPorts(…)` from `@core/testing`). "Today" in the shop's zone is `ZonedTimeSystem.toLocal(nowUtcMs, zone)` / `ZonedTimeSystem.shopNow(nowUtcMs, zone)`; the footer year is the shop's too (`ShopZoneService.defaultZone()`, the UTC calendar only while that read is pending — DEP-2 as amended by the review). Formatting a shop day never builds a `Date`: every feature, ui and showcase site goes through the ONE `wall-clock.ts` (`civilMs`, `formatWallClock`, `formatWallClockParts`, `formatWeekdayLabels`, `formatInstant`, plus the new `formatWallClockRange` and — review fix, for the day pill's same-month branch and the dashboard's title-cased heading — the raw `wallClockParts`, all cached per locale+zone+options). P0 MOVES it unchanged (it imports only `@core/primitives`) out of `@creativo/features/shared/visits` into a new lib `libs/ui/wall-clock`, alias `@creativo/ui/wall-clock`, tags `scope:shared`, `type:ui` (`type:ui ──▶ ui, tokens, util, domain`, so features, ui libs and apps may all import it; `type:util` may not import `@core/*`), and re-points every importer — so `libs/ui`'s pickers, the showcase and the shell reuse the same cached formatters instead of growing their own (reuse, never copy), and no feature → feature edge is added. Day arithmetic is `LocalDate.addDays`/`daysBetween`/`fromEpochDay`/`weekday`. `libs/ui`'s elapsed-time reads (toast hold, phone-field typeahead) and the grid-gesture rAF fallback use `performance.now()` — a monotonic interval, not a domain clock, and not banned. **No root factory is added to `CLOCK_PORTS`**: it would let a spec silently read the wall clock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| UR-10 | **What stays sanctioned.** The clock and entropy ADAPTERS and the backend composition root: `libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts` (`Date.now()`, `crypto.randomUUID()`), `libs/infrastructure/firebase-auth/src/lib/auth-session.adapter.ts:85` (token expiry), `apps/functions/src/main.ts:208`, `apps/functions/src/adapters/crypto.adapter.ts`. `apps/functions/src/edge.ts:897` (`Date.parse` of an event time at the ingestion edge) is a parse, not a clock read, and outside the UI scope. `libs/infrastructure` is INSIDE the `no-ambient-clock` scope; only the two adapter files above are exempted, by exact path (an AST scan of every production `.ts` there finds clock/entropy reads in those two files only — 0 elsewhere — so i18n, the firestore read helpers, firebase-app and the words tables stay guarded). Two `Math.random()` sites stay with a justified allowlist entry each: `libs/features/shared/catalog/src/lib/content/media-url-cache.ts:33` (equal-jitter retry backoff; the policy is already injectable through the cache's `policy` parameter and its spec pins `Math.random` with `vi.spyOn`; there is no `RandomPorts` bundle and inventing one for retry jitter is over-engineering) and `libs/ui/patterns/src/lib/confetti/confetti.ts` (a purely visual particle effect; nothing observable depends on it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| UR-11 | **Ids.** The draft seat ids (`draft-${…}-${stamp}-${minted++}` in the visit editor, `draft-${serviceId}-${index}-${stamp}` on rebook) and guest ids (`guest-${stamp}-${minted++}`) are PERSISTED by the edit pipeline. They keep their exact format, the stamp now `this.clock.nowUtcMs().toString(36)` from `CLOCK_PORTS` (byte-identical in production; the `minted` counter and the leg index keep them unique under a pinned spec clock). They do NOT move to `ID_PORTS`: that would change the stored id format and consume the dashboard spec's counted operation-id sequence (`staff-dashboard.spec.ts` "How many staff intents `ID_PORTS` has named"). The rebook/create `nonce` (only ever `new-${nonce}` as a row id) becomes a component counter `++this.createSeq` — strictly distinct, where a pinned clock would repeat. The captured photo's file name keeps `photo-${clock.nowUtcMs()}.jpg`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| UR-12 | **Lint guards — three custom rules, not `no-restricted-syntax` entries** (`no-restricted-syntax` options are replaced, never merged, by later blocks, and `libs/ui/icons/eslint.config.mjs` turns it off on its non-suffix files — a selector there would not have caught `ConsoleUiIconReporter`): `creativo/no-undecorated-class`, `creativo/no-ambient-clock`, `creativo/no-generic-discriminator` (§3). Each has a RuleTester spec beside it and a canary proof (§3.4). They are authored in wave 1 (tools only) and switched on in the root config in wave 2, once nothing they flag remains. **Scope is decided inside each rule, never by a path glob**: ESLint resolves `files`/`ignores` against a base path that depends on how it is invoked — the `@nx/eslint:lint` executor `chdir`s to the workspace root and passes `overrideConfigFile` (base = workspace root), while directory lookup (an IDE, `eslint` run inside a project) uses the project's nested `eslint.config.mjs` (base = the project dir) — so a repo-root-relative glob is silently off under one of the two. Each rule is registered with the basePath-independent `files: ['**/*.ts']` plus `**/`-prefixed ignores, and reads its scope (`include`) and allowlists (`allowIn`, `allowRandomIn`) as path-fragment options matched against `context.physicalFilename` — the `icon-registry-only` `allowInlineSvg` precedent (`eslint.config.mjs:416`, matched by `filename.includes(part)` in `icon-registry-only.mjs:99`). A runbook gate §4.9 adds the facts a rule cannot see (the shim file, `LEGACY_*` tables, the Sofia literal, the zone-gate exemptions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| UR-13 | **What is explicitly left, and why.** (a) The icon MANIFEST `kind` (`libs/ui/icons/src/lib/manifest/**`, `vector`/`material`/`image`): a `schemaVersion`'d JSON input format validated by `icon-manifest.ts` and the `pnpm icons:check` tooling — renaming it is a manifest schema change, not view state; allowlisted by path in `no-generic-discriminator` until its own pass (§10 OQ-5). (b) Lower-case literal unions that are NOT a discriminator field and not a load state: DS state signals printed as `data-state` (`camera-capture`, `async-image`, `code-scanner`, `otp-field`, `date-badge`, `medal`, `gauge`, `stepper`), tones and styles (`tile.tone`, `fact.tone` → `data-tone`, `VisitListStyle` → `data-list-style`), the visit editor's `discountKind()` signal and `VisitEditorResolution.by`, an Angular input named `kind` (`admin-rhythm-sheet`): not in this pass's four kinds, and the guards do not see them. (c) The staff day's instant-based agenda/grid fields (`startMs: number` threads in `staff-day.store.ts`, `staff-dashboard.ts`, the booking time sheet) and the client card's raw `nowMs: number` threads into its non-visit presenters (pause, photos, capsules): a Law 7.4 branding/T1 pass, not one of the four residue kinds — carried forward (§9 R-12). The contracts this pass rewrites brand what their producers already hold branded — `visitZoneOf(locationId: LocationId \| null, …)`, `ClientCardCatalog.locationTimeZone(locationId: LocationId)` — and hand the branding pass this exact list of raw fields they leave raw (each would need a parse at a UI call site or in ~70 hand-built fixture rows): `VisitRowVm.id: string` (→ `AppointmentId \| WaitlistRequestId`), `VisitRowOptions.subjectUserId: string \| null` (→ `UserId`), `VisitRowOptions.subjectCustomerId?: string \| null` (→ `CustomerId`), `VisitRowOptions.currentAppointmentId: string \| null` (→ `AppointmentId`), `PlacementVerdictSlice` `minutes: number` (→ `DurationMinutes`; the grid's minute math is raw today, (c) above). (d) `apps/functions/src/edge.ts:897` (UR-10). (e) `wall-clock.ts` moves to `@creativo/ui/wall-clock` (UR-9) — the `@creativo/infrastructure/i18n` home `angular-ui.md` names for formatting is unreachable from `type:ui`, so the `type:ui` lib is the one home every reader can import (§10 OQ-7). (f) The presenter/view-model mapper layer: `visitRowOf`/`waitlistRowOf`/`visitCardOf` still build `VisitRowVm`/`VisitCardVm` full of preformatted strings (title, lines, accessibleName, the clock faces), and `catalog-to-vm.ts`, `client-pages.vm.ts` and the client-card presenters stay mappers — 20 production `libs/features/**/*.presenter.ts`/`*vm*.ts` files. `angular-ui.md` bans that layer, but removing it moves formatting into templates screen by screen, which this behaviour-frozen pass cannot do: it is the separate view-model pass, and HANDOFF §3.3 keeps a carried line for it (G2; §10 OQ-11). |
| UR-14 | **Dead code goes with the freeze.** `VisitRowVariant`, `VisitRowOptions.variant`/`photos` (no caller passes either), the "frozen" comments of `visit-row.vm.ts`, the shim mentions in the `visit-filter.ts`/`visit-sections.ts` headers; `LandingContentService.todayIndexAt`/`isOpenNow`/`weekdayLabel` (no caller anywhere; their `Date` reads go with them) and the data only they read — `LocationVm.hours`, `DayHoursVm` and its `open`/`closed` helpers (`timezone` stays: `landing-location-zone.ts` reads it); the local `distinct` copy in `visit-card.presenter.ts` (the exported one of `visit-row.presenter.ts` replaces it — both keep first-seen order over strings).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| UR-15 | **Sequencing.** Wave 0 ALONE lands the shared vocabulary (the view-state lib, the i18n `visit-list-words.ts`, the dashboard's `tag-words.ts` and `row-verb.ts`, the `@creativo/ui/wall-clock` lib with `wall-clock.ts` moved into it, every importer re-pointed, plus `formatWallClockRange`) that every later package imports. Wave 1 runs eight packages with DISJOINT file ownership (P1 visits lib, P2 client libs, P3 staff client card, P4a visit editor, P4b the rest of staff dashboard, P5 marketing + catalog + shell, P6 admin + auth + booking, P7 ui libs + showcase + onboarding) plus G1 (the three rules, authored and specced, not yet on). Wave 2 (G2) switches the rules on, adds runbook §4.9, removes the 4a zone-gate exemptions and updates the docs. The cross-package contracts of §2 are what wave-1 packages build against without seeing each other's files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| UR-16 | **Departures — the five the laws force (each ruled in §10 with a default):** **DEP-1** the landing «Locations» open/closes-soon line and bold "today" row are computed on the SHOP's clock (`Europe/Sofia`, from the static landing content), not the visitor's device clock (Law 7.2, `angular-ui.md`) — identical for every device on Sofia time, which includes every spec and the e2e suite (`timezoneId: 'Europe/Sofia'`); **DEP-2** the footer's copyright year is the civil year on the SHOP's calendar (the default location's zone through `ShopZoneService.defaultZone()`, Law 7.2 — review fix; the integrated tree first read the UTC year through `ageDayOf`), not the device-local year — identical for every device on shop time; while the zone read is pending the same instant is read on the UTC calendar, so the legal bar never renders without a year; **DEP-3** `ui-month-picker`'s relative shortcuts («Днес», «Утре», …) do nothing when clicked while `uiToday` is null (today they pick the DEVICE's UTC date); every consumer passes a today key, so the window is unreachable in the app, and the DOM is unchanged; **DEP-4** (timing, conditional) `/account`'s upcoming card now waits for the default location's zone before it is drawn — while it waits the page stays in its EXISTING pending state (`data-upcoming="loading"`), never «no upcoming»; when the zone has resolved first, nothing changes; **DEP-5** (failure path, conditional) `/account`'s upcoming card reads "now" in the APPOINTMENT's own location zone (`ShopZoneService.zoneOf(appointment.locationId)`, read once per shown SHOP — keyed on the `locationId` alone, so a snapshot of the same visit or a sooner visit at the same shop replaces a drawn card straight, never through the skeleton (review fix; the integrated tree keyed it per appointment id) — Law 7.2, and independent of the default location) instead of the shim's Sofia fallback; while that read is pending the page is in DEP-4's pending state, and when it FAILS (no zone stored, read error) `upcomingState()` reports `LoadState.Failed`, printed with the existing word `'error'` and the existing alert line unchanged, `errors.ACCOUNTS_REPOSITORY_FAILURE`, whichever read failed (integrator ruling §8.1 #1) — today the card draws with Sofia instead. Never `LOADING` forever. A sixth difference is theoretical only and not counted: a list row's "now" is read in the default location's zone instead of the row's own location zone — identical for the one-zone tenant (`VisitLookup`'s own doc: every shop of the tenant keeps one clock).                                                                                                                                                                                                                                                                                                                                                |

---

## 1. The closure per item (re-derived on `c77e932`)

### 1.1 The visit shim and the frozen view models (item 1)

`visit-ecs.shim.ts` (146 lines) has exactly four importers, none outside the
lib, and is not exported from `src/index.ts`:
`visit-filter.ts`, `visit-sections.ts`, `visit-row.presenter.ts`,
`visit-card/visit-card.presenter.ts`. Docs naming it: HANDOFF §3.3,
firestore-runbook §4.7 (lines ≈899, 920–931 — the zone-literal and
tenant-zone gates exempt the file), phase-4a/4b plans (historical, untouched).

| File                                                                             | Today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visit-ecs.shim.ts`                                                              | `LEGACY_VISIT_ROW_OUTCOME` + `VISIT_ROW_OUTCOME_OF`, `LEGACY_VISIT_FILTER` + `VISIT_FILTER_OF`, `VISIT_PERSPECTIVE_OF`, `VISIT_GRAIN_OF`, `LEGACY_CANCELLED_SIDE`, `VISITS_TIME_ZONE = zoneOf('Europe/Sofia')`, `zoneOf`, `utcMsOf`, `shopNowOf` (module `let lastNow`), `wallTimeOf`, `filterRowOf`                                                                                                                                                                                                                                                                                                                                    | **Deleted** (§7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `visit-row.vm.ts`                                                                | `VisitPerspective` `'client'\|'staff'`, `VisitGrain` `'month'\|'year'`, `VisitRowOutcome` `'open'\|…`, `VisitFilter` `'all'\|…\|'no_show'`, dead `VisitRowVariant`; `VisitTrailing.kind: 'barber'`; `VisitTrailingFact.kind: 'amount'\|'status'\|'badge'`; `VisitRowVm.kind: 'visit'\|'waitlist'`, `startMs: number`, `outcome`, `status: string \| null`; `VisitWords.cancelledBy(side: 'client'\|'shop')`; `VisitLookup.locationTimeZone?` optional                                                                                                                                                                                   | Import/re-export the ecs-core types (§2.3). `VisitTrailing` loses `kind` (single variant, UR-4). `VisitTrailingFact` → field `trailingFactFace: TrailingFactFace` (`AMOUNT`/`STATUS`/`BADGE`). `VisitRowVm`: `visitRowEntry: VisitRowEntry` (`VISIT`/`WAITLIST`), `localDate` + `startMinutes`, `outcome: VisitRowOutcome \| null`, `bookingStatus: BookingStatus \| null`. `cancelledBy(side: CancelledSide)`. `locationTimeZone` stays optional on the lookup (a host without a catalogue), but no Sofia fallback anywhere (UR-6). `VisitRowVariant` deleted. `tile.tone`, `fact.tone`, `VisitListStyle` untouched (UR-13 b). |
| `visit-row.presenter.ts`                                                         | `visitZoneOf` → Sofia fallback; `shopNowOf(options.nowMs, zone)`; `new VisitClock(…)` (:283); `storyOf` → legacy words; `isUpcoming` → back to tags; ≈12 bare literals `story.outcome === 'worked'\|'cancelled'\|'no_show'\|'open'` (≈298, 314–316, 405, 431, 450, 477–488, 498), `options.grain === 'month'` (≈330), `perspective === 'staff'` (`visitRowOf`, `visitWordsOf`); `base.startMs = appointment.utcEpochMs`; `waitlistRowOf` `startMs = startOfLocalDay(first.localDate, zone)` or `0`; `VisitRowOptions.nowMs`, dead `photos?`/`variant?`; `VisitStory.outcome/cancelledBy` legacy words; `export class VisitClock` (:782) | `storyOf` returns the system's tags unchanged; every comparison against the dictionary member; `now: ShopNow` + `timeZone: TimeZone` options; row emits `localDate`/`startMinutes`; waitlist row `first.localDate` at `MinuteOfDay` 0, or the sentinel `WAITLIST_UNDATED` = (`LocalDate.fromEpochDay(0)`, `MinuteOfDay.ofProven(0)`) when it watches no day (§9 R-4); `visitZoneOf(locationId, lookup): TimeZone \| null`; photo day zone = `visitZoneOf(…) ?? options.timeZone`; `visitClockOf` factory (§2.5). `visitWordsOf(translate, lang, perspective: VisitPerspective)` keeps every key.                                |
| `visit-filter.ts`                                                                | `FILTERS_FOR` → words; `offeredVisitFilters` through `filterRowOf` and back; `matchesVisitFilter` through `VISIT_FILTER_OF`; `visitFilterWordKey` `visits.filter.${filter}` + `no_show_staff` special case                                                                                                                                                                                                                                                                                                                                                                                                                              | Thin pass-throughs to `VisitListSystem` over SCREAMING tags, rows passed as they are. `visitFilterWordKey(filter, perspective)` = `filter === VisitFilter.NoShow && perspective === VisitPerspective.Staff ? 'visits.filter.no_show_staff' : \`visits.filter.${visitFilterWords[filter]}\`` — keys byte-identical.                                                                                                                                                                                                                                                                                                              |
| `visit-sections.ts`                                                              | `toSectionRow` via `wallTimeOf(row.startMs)` (the Sofia read); `VISIT_GRAIN_OF`; `workedVisitsDetail` via `filterRowOf`; section testId `${prefix}-${options.grain}-${key}`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `VisitListSystem.sections(rows, grain)` directly (`R extends SectionRow`); `toSectionRow` deleted; `workedFigure(rows, atLeast)` on the rows; testId `${prefix}-${visitGrainWords[grain]}-${key}` (DOM unchanged: `history-month-2026-09`, `history-year-2026`, `visits-month-…`). `visitSectionKey(day, grain: VisitGrain)` a pass-through.                                                                                                                                                                                                                                                                                    |
| `visit-card/visit-card.presenter.ts`, `visit-card.vm.ts`, `visit-card.ts`        | `shopNowOf` import; `new CardClock(…)` (:63); `grain: 'month'`; `row.outcome === 'worked'` (≈125, 133), `!== 'open'` (≈138); `staff = perspective === 'staff'`; `class CardClock` (:289); local `distinct` (:278); `VisitCardOptions.nowMs`; `VisitCardKind 'last'\|'next'\|'waitlist'` on `kind`, printed by the host `'[attr.data-kind]': 'vm().kind'` (asserted `visit-card.spec.ts` ≈214/438/474, `client-card.spec.ts` ≈450/652/795)                                                                                                                                                                                               | Dictionary comparisons; `now` + `timeZone`; `visitClockOf` (`at.day()` → `at.dayShort()` ≈153, `at.whenLong(…)` → `at.whenHeard(…)` ≈175); exported `distinct`; `VisitCardVm.visitCardSlot: VisitCardSlot` (`LAST`/`NEXT`/`WAITLIST`) + `visitCardSlotWords` → host `'[attr.data-kind]': 'slotWord()'` (`'last'`/`'next'`/`'waitlist'`).                                                                                                                                                                                                                                                                                        |
| `visit-row/visit-row.ts`, `.html`, `visit-row-words.ts`, `.html`                 | `perspective() === 'client'`/`'staff'`; `vm().kind === 'waitlist'/'visit'` (`wraps`, `reservesFace`); `leadWhole` `vm().kind === 'visit' && vm().outcome === 'cancelled'`; `@switch (fact.kind)`; `[attr.data-status]="vm().status"`                                                                                                                                                                                                                                                                                                                                                                                                    | Dictionary comparisons; `@switch (fact.trailingFactFace)` with `@case (TrailingFactFace.Amount)`…; `[attr.data-status]="vm().bookingStatus"`. Every other attribute untouched (`data-fact`, `data-trailing` are static literals per `@case`).                                                                                                                                                                                                                                                                                                                                                                                   |
| `visit-list/visit-list.ts`, `.html`; `visits-browser/visits-browser.ts`, `.html` | host `'[attr.data-perspective]': 'perspective()'` (asserted `visits-browser.spec.ts` ≈356/387, `client-appointments.spec.ts` ≈513, `client-history.spec.ts` ≈228); `prefix()` via `=== 'staff'`; `VisitListState` input; `VisitListPaging.kind`; `@switch (state())`, `@switch (page.kind)`, `[uiLoading]="page.kind === 'loading'"`                                                                                                                                                                                                                                                                                                    | host `'[attr.data-perspective]': 'perspectiveWord()'` (`computed(() => visitPerspectiveWords[this.perspective()])`); `state = input<LoadState>(…)`; `paging: VisitListPaging` = `{ pagingState: PagingState }`; `@case (LoadState.Loading)`, `@case (PagingState.More)`, `[uiLoading]="page.pagingState === PagingState.Loading"`.                                                                                                                                                                                                                                                                                              |
| `visit-filter-menu/visit-filter-menu.ts`                                         | `model<VisitFilter>('all')`; `!== 'all'`; option testId `${prefix}-${filter}` (asserted across three specs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `model<VisitFilter>(VisitFilter.All)`; testId `${prefix}-${visitFilterWords[filter]}`; option `id` may be the SCREAMING tag (not rendered).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `event-head/staff-event-head.ts`                                                 | `hollowStatus(status: string \| null \| undefined)` compares `'cancelled'`/`'no_show'` — four callers feed it the word: the time grid (`staff-time-grid.html` 266/294, `event.status`) and the dashboard agenda (`staff-dashboard.html` 764 `[struck]="hollowStatus(statusWords[entry.status])"`, 852 `!hollowStatus(statusWords[entry.status])`) (§1.5)                                                                                                                                                                                                                                                                                | `hollowStatus(bookingStatus: BookingStatus \| null \| undefined)` against `BookingStatus.Cancelled`/`NoShow`; all four callers pass the tag with no words table (`hollowStatus(event.bookingStatus)`, `hollowStatus(entry.bookingStatus)` — P4b, §1.2 rows 28/31).                                                                                                                                                                                                                                                                                                                                                              |
| `day-range.ts`                                                                   | `noonOf(day): Date` + per-call `new Intl.DateTimeFormat` for `formatRange`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `formatWallClockRange` of `wall-clock.ts` (§2.6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `testing/visit-fixtures.ts`                                                      | its own `VISITS_TIME_ZONE` (Sofia, legal under `testing/`), `Pick<VisitRowOptions, 'words' \| 'nowMs'>` (≈593)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keeps its zone constant; builds `now` with `ZonedTimeSystem.shopNow(FIXED, VISITS_TIME_ZONE)`; the `Pick` names `'words' \| 'now' \| 'timeZone'` (legal — not a `*Ports` type).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Readers outside the lib** (each owned by its package, §4):
`client/appointments` `client-appointments.ts` (+ `.html`, `visit-vm.ts`);
`client/account` `client-account.ts`; `staff/client-card` `client-card.store.ts`
(visitTitles ≈663–674 and visitBarbers ≈1219–1243 file by `shopDayOf(row.startMs, zone)`,
`signal<VisitFilter>('all')`, `refill`, `_filter.set('all')` ≈1791, visits() status ≈1418–1430),
`glance.presenter.ts` (upcoming sort `a.row.startMs - b.row.startMs` ≈501, kinds `'last'`/`'next'`),
`visits-page.presenter.ts`, `history.presenter.ts`, `client-card.presenter.ts`
(`row.outcome === 'worked'` ≈382), `client-card.words.ts`, `medal-detail.presenter.ts`,
`medals.presenter.ts`, `records.presenter.ts`, `client-history/client-history.ts`,
`client-pages.vm.ts`, `testing/client-pages.vm-fixtures.ts`, `testing/client-card.fixtures.ts`,
`testing/achievements-pages.rig.ts`; `staff/dashboard` `staff-visit-editor.ts`
(`lastVisitDate` ≈6992–7010: `row.outcome !== 'worked'`, max `row.startMs`,
`shopMoment(lastMs, …)`; `visits().status === 'ready'` ≈6995), `staff-dashboard.ts`/`.html`,
`staff-day.store.ts`, `time-grid/staff-time-grid.ts`/`.html` (`hollowStatus`), `lane-gaps.spec.ts`.

### 1.2 `kind`/`type`/`status` property signatures and the load-state copies (item 2)

AST scan (TSPropertySignature named `kind`/`type`/`status`, production files):
28 files (27 + the allowlisted icon manifest), 0 `type`. Each row: site → target. "words" = a lower-case table keeps
a DOM value.

| #   | File (lines ≈)                                                                                                                                                                                                                                                                                                                                                                                                                        | Today                                                                                                                                                                                                                                                                                                                                                                                                                             | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pkg                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | `marketing/careers/…/marketing-careers.ts` 36–39, 95–97; `.html` 17                                                                                                                                                                                                                                                                                                                                                                   | `kind` loading\|error\|ready{positions}                                                                                                                                                                                                                                                                                                                                                                                           | `LoadSlice<readonly Position[]>` (`error`→`FAILED`, payload `data`); `@case (LoadState.X)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P5                         |
| 2   | `marketing/courses/…/marketing-courses.ts` 42–45, 112–119; `.html` 17                                                                                                                                                                                                                                                                                                                                                                 | same, `{courses}`; `state.kind !== 'ready'`                                                                                                                                                                                                                                                                                                                                                                                       | `LoadSlice<readonly Course[]>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P5                         |
| 3   | `marketing/events/…/marketing-events.ts` 36–39, 107–109; `.html` 38                                                                                                                                                                                                                                                                                                                                                                   | same, `{events}`                                                                                                                                                                                                                                                                                                                                                                                                                  | `LoadSlice<readonly ShopEvent[]>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P5                         |
| 4   | `client/account/…/client-account.ts` 64–68, 212–225, 273, 301–306; host 163; `.html` 105/108                                                                                                                                                                                                                                                                                                                                          | `UpcomingState` loading\|empty\|error\|populated{appointment}; `upcomingState()` prints the raw word (host `data-upcoming`, card `data-state`, e2e `account-dashboard*.spec.ts`)                                                                                                                                                                                                                                                  | `LoadSlice.WithEmpty<Appointment>`; `upcomingState()` returns `LoadState`; both attributes print `upcomingStateWords[…]` = `{LOADING:'loading', EMPTY:'empty', FAILED:'error', READY:'populated'}`; `@case (LoadState.Loading)` / `(LoadState.Failed)` / `@default`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P2                         |
| 5   | `client/profile/…/client-profile.ts` 57 (+`.html` 148/170, 266); `pageState()` 114–117 → host `data-state` 102                                                                                                                                                                                                                                                                                                                        | `ProfileEdit` kind name\|birthday; bare `'loading'\|'ready'\|'empty'`                                                                                                                                                                                                                                                                                                                                                             | `ProfileEditField` {`NAME`,`BIRTHDAY`} on `profileEditField`; `pageState()` → `LoadState`, host prints `loadStateWords[…]` (same three words)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P2                         |
| 6   | `client/appointments/…/visit-vm.ts` 41; `.html` 395–396                                                                                                                                                                                                                                                                                                                                                                               | `status: BookingStatus`                                                                                                                                                                                                                                                                                                                                                                                                           | `bookingStatus`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P2                         |
| 7   | `client/appointments/…/appointments.store.ts` 41–70; `client-appointments.ts` 271–277, 483–508; `.html` 170                                                                                                                                                                                                                                                                                                                           | `AppointmentsViewState` (LOADING\|ERROR\|READY) + `appointmentsViewStateWords` + `UpcomingListState{appointments}`; translated to `VisitListState`                                                                                                                                                                                                                                                                                | `LoadState`/`LoadSlice<readonly Appointment[]>` (ERROR→FAILED, `appointments`→`data`); `appointmentsStateWords satisfies Record<LoadState,string>` = `{LOADING:'loading', FAILED:'error', READY:'ready', EMPTY:'empty'}` keeps host `data-state` (e2e `appointments*.spec.ts`); the `VisitListState` WORD mapping disappears but its words GATE stays: `listState = computed<LoadState>(() => { const s = store.upcoming().loadState; return s === LoadState.Ready && this.words() === null ? LoadState.Loading : s; })` (today `'loading'` while the catalogue words are not loaded, when `visits()` is `[]` — passing the store's state straight through would flash READY + empty); `isEmpty` = `listState() === LoadState.Ready && totalVisits() === 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P2                         |
| 8   | `client/auth/…/client-auth.ts` 81, 285–287; `.html` 180                                                                                                                                                                                                                                                                                                                                                                               | consent part kind text\|terms\|privacy                                                                                                                                                                                                                                                                                                                                                                                            | `ConsentPart` {`TEXT`,`TERMS`,`PRIVACY`} on `consentPart`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P6                         |
| 9   | `client/booking/…/booking-schedule-step.ts` 923–936, 329–340; `.html` 50/82                                                                                                                                                                                                                                                                                                                                                           | local `type ShopReach` kind served\|elsewhere\|nowhere on the signal `shopReach` (the name collides with the ecs-core `ShopReach` of `@core/components`, the call/contact phrase, imported by the same lib)                                                                                                                                                                                                                       | `ShopCoverage` {`SERVED`,`ELSEWHERE`,`NOWHERE`} on `shopCoverage`, variant union `ShopCoverageVerdict` (§2.8); the signal renamed `shopCoverage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P6                         |
| 10  | `admin/loyalty/…/admin-rhythm.store.ts` 84–100; `admin-rhythm.ts` 190/196/281–289/470/489; `.html` 9                                                                                                                                                                                                                                                                                                                                  | `RhythmLoadState` + `Slice<T>` on `rhythmLoadState`; `state()` bare `'loading'\|'ready'\|'failed'` → `data-state`                                                                                                                                                                                                                                                                                                                 | shared `LoadState`/`LoadSlice`; `state()` → `LoadState`, host and `.html` print `loadStateWords[state()]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P6                         |
| 11  | `admin/loyalty/…/admin-rhythm.words.ts` 727–739, 771, 803; `.html` 261                                                                                                                                                                                                                                                                                                                                                                | kind estimate\|unavailable{reason}                                                                                                                                                                                                                                                                                                                                                                                                | `RhythmEstimate` {`ESTIMATE`,`UNAVAILABLE`} on `rhythmEstimate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P6                         |
| 12  | `admin/programs/…/admin-programs.ts` 34–44, 157–191; `.html` 46                                                                                                                                                                                                                                                                                                                                                                       | editing kind position\|course\|event                                                                                                                                                                                                                                                                                                                                                                                              | `ProgramEditing` {`POSITION`,`COURSE`,`EVENT`} on `programEditing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P6                         |
| 13  | `marketing/landing/…/content/landing-content.ts` 423–445 (+ `landing-content.service.ts` 90, dead)                                                                                                                                                                                                                                                                                                                                    | `DayHoursVm` kind open\|closed                                                                                                                                                                                                                                                                                                                                                                                                    | deleted (UR-14): `LocationVm.hours`, `DayHoursVm`, the `open`/`closed` helpers and the two `hours` arrays lose their only reader with `todayIndexAt`/`isOpenNow`, so no `DayOpening` dictionary is added; the page's hours come from `locations.component.ts` `schedule`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P5                         |
| 14  | `shared/catalog/…/catalog-vm.ts` 70; `catalog-to-vm.ts` 102; readers `service-row.component.ts` 110, `service-detail-sheet.component.ts` 230 + `.html` 18, `marketing/landing` `service-tile.component.ts` 106, `landing-content.service.ts` 57/60, `test-catalog.providers.ts` 124, `landing-content.ts` 204–404 (10 literals)                                                                                                       | `ServiceVm.kind` single\|bundle (catalog-to-vm maps `compositionKind` → word)                                                                                                                                                                                                                                                                                                                                                     | `compositionKind: Exclude<CompositionKind, typeof CompositionKind.Unspecified>` from `@core/components` (reuse; `catalog-to-vm` keeps "unspecified draws as single": `bundle ? CompositionKind.Bundle : CompositionKind.Single`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P5                         |
| 15  | `marketing/landing/…/locations/locations.component.ts` 80, 472–495; `.html` 70/82/286/298                                                                                                                                                                                                                                                                                                                                             | `LocationStatus.kind` closesAt\|closesSoon\|opensAt\|opensOn                                                                                                                                                                                                                                                                                                                                                                      | `ShopOpening` {`CLOSES_AT`,`CLOSES_SOON`,`OPENS_AT`,`OPENS_ON`} on `shopOpening`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P5                         |
| 16  | `shared/shell/…/footer/site-footer.component.ts` 21, 92–166; `.html` 31/46/48/59                                                                                                                                                                                                                                                                                                                                                      | `FooterLink.kind` hash\|router\|external\|tel                                                                                                                                                                                                                                                                                                                                                                                     | `FooterLinkTarget` {`HASH`,`ROUTER`,`EXTERNAL`,`TEL`} on `footerLinkTarget`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P5                         |
| 17  | `shared/visits/…/visit-row.vm.ts` 77–127, 176 (+ presenter, card)                                                                                                                                                                                                                                                                                                                                                                     | §1.1                                                                                                                                                                                                                                                                                                                                                                                                                              | §1.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P1                         |
| 18  | `shared/visits/…/visit-card/visit-card.vm.ts` 28/40/107; `visit-card.ts` 115                                                                                                                                                                                                                                                                                                                                                          | `VisitCardKind` on `kind` (+ `Exclude<…,'waitlist'>`)                                                                                                                                                                                                                                                                                                                                                                             | `VisitCardSlot` on `visitCardSlot` + `visitCardSlotWords`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1                         |
| 19  | `shared/visits/…/visit-list/visit-list.ts` 34/43–45/104/150–153; `.html` 30/153/192; `visits-browser.ts` 18/113/145/195 + `.html` 9/26                                                                                                                                                                                                                                                                                                | `VisitListState` bare; `VisitListPaging.kind`                                                                                                                                                                                                                                                                                                                                                                                     | `LoadState`; `PagingState` on `pagingState`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P1                         |
| 20  | `staff/client-card/…/client-achievements/achievements-page-state.ts` 26–57; users `client-achievements.ts` 142/157 + `.html` 38/107/128, `achievement-category.ts` 118/132 + `.html` 49/81/100, `achievement-detail.ts` 152/168/179–180 + `.html` 44/68/89/108/127                                                                                                                                                                    | kind loading\|failed\|absent\|ready{vm,words}                                                                                                                                                                                                                                                                                                                                                                                     | `LoadSlice.WithEmpty<{ vm; words }>` (`absent` → `EMPTY`, after checking no page draws `absent` differently from empty, §9 R-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P3                         |
| 21  | `staff/client-card/…/client-records/client-records.ts` 42–50, 145–162; `.html` 35/63/83/89, 100 (`[attr.data-kind]="featured.kind"`)                                                                                                                                                                                                                                                                                                  | `RecordsState` kind loading\|failed\|empty\|ready{vm}                                                                                                                                                                                                                                                                                                                                                                             | `LoadSlice.WithEmpty<RecordsPageVm>`; featured record per row 25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P3                         |
| 22  | `staff/client-card/…/client-pages.vm.ts` 52–63                                                                                                                                                                                                                                                                                                                                                                                        | `CardLoadState` + `Slice<T>` on `cardLoadState` — used by every client-card presenter, the store (≈60 reads), `wallet.presenter.ts`, `ledger.presenter.ts`, `client-loyalty.ts`, `client-ledger.ts`, `client-card.ts`, `achievements-page-state.ts`, `client-records.ts`, fixtures                                                                                                                                                | DELETED; every site reads `LoadState`/`LoadSlice` on `loadState` (payload stays `data`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P3                         |
| 23  | `client-pages.vm.ts` 1076/1085; `visits-page.presenter.ts` 244/277/306/319; `client-card.store.ts` 1418–1430; `client-history.ts` 126–144; `staff-visit-editor.ts` 6995                                                                                                                                                                                                                                                               | `VisitsPageStatus` `'loading'\|'ready'\|'failed'` on `status`; two translations (`CardLoadState`→status, status→`VisitListState` failed→error)                                                                                                                                                                                                                                                                                    | `VisitsPageVm.loadState: LoadState`; both translations disappear; editor reads `=== LoadState.Ready`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P3 (+P4a for :6995)        |
| 24  | `client-pages.vm.ts` 435–439, 797–799; `ledger.presenter.ts` 576–580; `visits-page.presenter.ts` 331/342/356–369; `client-ledger.html` 164/169; `client-card.store.ts` `more` 193/202/229/237/1368–1369/1598/1627/2034/2078–2100/2417–2479                                                                                                                                                                                            | `HistoryPagingVm.kind`, `LedgerPagingVm.kind` more\|loading\|failed\|end; store `more: 'idle'\|'loading'\|'failed'`                                                                                                                                                                                                                                                                                                               | `HistoryPagingVm = VisitListPaging & { endLabel }`, `LedgerPagingVm = VisitListPaging & …`; store field `pagingState: Exclude<PagingState, typeof PagingState.End>` (idle = `MORE`; `END` stays derived from the null cursor in the presenter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P3                         |
| 25  | `client-pages.vm.ts` 491 (+ `glance.presenter.ts` 382/407; `birthday-card.ts` host 64, `.html` 1); 545/831 (+ `medals-glance.html` 69/75 testids, `client-achievements.html` 171, `client-records.html` 100, `record-card.ts` 65); 652–660 (+ `wallet.presenter.ts` 415–440, `wallet-holdings.html` 2, `keyOf`)                                                                                                                       | `BirthdayVm.kind` today\|upcoming → host `data-kind`; record `kind: RecordKindWord` (testids, `data-kind`); `WalletHoldingVm.kind` voucher\|ticket\|stamps                                                                                                                                                                                                                                                                        | `BirthdayMoment` {`TODAY`,`UPCOMING`} on `birthdayMoment` + `birthdayMomentWords` for the host; records carry `personalRecordKind: PersonalRecordKind` (ecs-core) and print `RECORD_KIND_WORDS[…]` where `kind` printed (testids, `data-kind` unchanged); `WalletHolding` {`VOUCHER`,`TICKET`,`STAMPS`} on `walletHolding`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P3                         |
| 26  | `staff/client-card/…/visits-page.presenter.ts` 244                                                                                                                                                                                                                                                                                                                                                                                    | `status: VisitsPageStatus`                                                                                                                                                                                                                                                                                                                                                                                                        | row 23                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P3                         |
| 27  | `staff/client-card/…/client-card.contracts.ts` 49; `glance.presenter.ts` 334–336, 853–862                                                                                                                                                                                                                                                                                                                                             | `ClientCardGrant.occasion?: 'birthday' \| null` + `COUPON_OCCASION_OF` (§1.5) — fed by a three-hop chain: `staff-day.store.ts` 1636–1637 produces the EDITOR's `VisitEditorGrantOption.occasion?: 'birthday' \| null` (`staff-visit-editor.ts` 673) with `coupon.couponOccasion === CouponOccasion.Birthday ? 'birthday' : null`, and the editor copies it into `ClientCardGrant[]` at ≈6525 (`occasion: grant.occasion ?? null`) | `ClientCardGrant.couponOccasion?: CouponOccasion \| null`, table deleted (P3); `VisitEditorGrantOption.couponOccasion?: CouponOccasion \| null` and the ≈6525 pass-through `couponOccasion: grant.couponOccasion ?? null` (P4a); the producer `couponOccasion: coupon.couponOccasion ?? null`, the `'birthday'` ternary deleted (`CouponOccasion` has the one member `BIRTHDAY`, so the value is the same) (P4b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P3, P4a, P4b               |
| 28  | `staff/dashboard/…/staff-dashboard.ts` 323, 609, 874                                                                                                                                                                                                                                                                                                                                                                                  | `status: BookingStatus` (inline param type, `DayRowVm`, another row)                                                                                                                                                                                                                                                                                                                                                              | `bookingStatus` (every reader `row.status` → `row.bookingStatus`; `.html` 683 `statusWords[entry.bookingStatus]`; the agenda's two `hollowStatus` calls `.html` 764 `[struck]="hollowStatus(entry.bookingStatus)"` and 852 `!hollowStatus(entry.bookingStatus)` — NO words table, or the strike and tag flip; pinned by `staff-dashboard.spec.ts` ≈2979 «treats a no-show like a cancellation…» (`data-struck` ≈3025), plus a NEW cancelled-card strike assertion beside it, since only the no-show case is pinned)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P4b                        |
| 29  | `staff-dashboard.ts` 417, 675; `.html` 615                                                                                                                                                                                                                                                                                                                                                                                            | `DayRowVm.kind: 'visit'`, `GapRowVm.kind: 'gap'`                                                                                                                                                                                                                                                                                                                                                                                  | `AgendaRow` {`VISIT`,`GAP`} on `agendaRow`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P4b                        |
| 30  | `staff-dashboard.ts` 5927                                                                                                                                                                                                                                                                                                                                                                                                             | `Extract<VisitEditorCommit, { kind: 'save' }>`                                                                                                                                                                                                                                                                                                                                                                                    | `VisitEditorCommit` (the tag is deleted, row 35)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P4b                        |
| 31  | `staff/dashboard/…/time-grid/staff-time-grid.ts` 66, 111, 253, 322, 384–389, 1350–1352, 2491–2495; `.html` 218/220/225–240/250/266/294; `block-editor/staff-block-editor.ts` 1077–1103; `timeline/staff-timeline.ts` 88/114 (`bar.kind`), 126–131, 405–433, 524, 662, 778; `.html` 114                                                                                                                                                | `GridEvent.kind` visit\|gap\|block (+ `GRID_EVENT_OF` to the ecs tag) → `data-kind` (CSS `[data-kind='block'\|'gap']`); `status: string \| null` (lower-case word) → `data-status` + `hollowStatus`; `GridCommit.kind` move\|resize; `EventMask.kind` elapsed\|surplus\|closed\|overlap → `data-kind` (CSS); `DragKind` (COPIED in grid and timeline); `draftVerdict` short\|overlap\|outside (COPIED)                            | `GridEvent.gridEvent: GridEventTag` (the ecs `GridEvent` dictionary, imported under that alias as today) + `gridEventWords` for `data-kind`, `GRID_EVENT_OF` deleted; `bookingStatus: BookingStatus \| null` plus `draftNew?: true` (set ONLY by the visit editor's frame event for a visit not booked yet, §2.4), `data-status` prints `gridStatusWord(event)` = `event.bookingStatus !== null ? bookingStatusWords[event.bookingStatus] : event.draftNew === true ? 'new' : null` — today the new-visit frame prints `data-status="new"` (editor `status: vm.status` ≈2477 with `vm.status = 'new'`, dashboard ≈5447), and `.staff-grid__event[data-editable][data-status]` (`staff-time-grid.block.css:263`) gives it the primary ink only while some `data-status` is present; the block editor's frame keeps NO `data-status` (no CSS change); `GridCommit.editCommand: typeof EditCommand.Move \| typeof EditCommand.Resize`; `gridMask: GridMask` + `gridMaskWords`; ONE `DragGesture` on `dragGesture` (derived from `EditCommand.Move` + `ResizeEdge`, §2.5) and ONE `PlacementVerdict` {`SHORT`,`OVERLAP`,`OUTSIDE`} on `placementVerdict` (+ its slice union) in the shared `grid-gesture.ts`; every bare resize edge `edge: 'start' \| 'end'` (`staff-time-grid.ts` 1443/1477/1761, `staff-timeline.ts` 483/505/712) typed `ResizeEdge` and compared with `ResizeEdge.Start`/`End`, the templates passing `ResizeEdge.Start`/`.End` through a protected field (`staff-time-grid.html` ≈368–390, `staff-timeline.html` 186–215: `handleText(…)`, `onHandleDown(…)`, `onHandleKey(…)`, `draggingEdge() === …` — DOM unchanged, the attributes print `''`/`null`) | P4b                        |
| 32  | `staff/dashboard/…/visit-editor/client-query.ts` 30–77 (+ `staff-visit-editor.html` 174 `[uiIconKind]="parsedQuery().kind"`)                                                                                                                                                                                                                                                                                                          | `ClientQueryKind` + `LEGACY_CLIENT_QUERY_SHAPE` + inverse, `ParsedClientQuery = Omit<…,'clientQueryShape'> & { kind }`, `toEcs`                                                                                                                                                                                                                                                                                                   | the ecs `ParsedClientQuery` itself (field `clientQueryShape`), no table, no `toEcs`; `[uiIconKind]="clientQueryShapeWords[parsedQuery().clientQueryShape]"` (`ui-search-field` prints it as `data-kind`); the editor's own reads `parsedQuery().kind === 'empty'` (≈3876, 4028, 4054) → `=== ClientQueryShape.Empty`. SECOND reader outside the editor: `staff-dashboard.ts` imports `parseClientQuery` (≈222) and reads `parsed.kind !== 'empty'` in `searchClients` (≈5797) → `parsed.clientQueryShape !== ClientQueryShape.Empty` (`@core/systems`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P4a (dashboard reader P4b) |
| 33  | `staff/dashboard/…/visit-editor/staff-visit-editor.ts` 215                                                                                                                                                                                                                                                                                                                                                                            | `VisitEditorVerb.kind: string` = `ROW_VERB_WORD[verb]`, emitted by `acted` and mapped back by the host (≈4389–4402); compared `verb.kind === 'confirmed'\|'arrived'\|'completed'\|'cancelled'\|'no_show'` (≈2958–3016)                                                                                                                                                                                                            | `rowVerb: RowVerb` (from the new `row-verb.ts`, P0); `acted = output<RowVerb>()`; comparisons against `BookingStatus.*`/`ArrivalVerb.*`; any printed/`id` use goes through `ROW_VERB_WORD[…]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P4a (host side P4b)        |
| 34  | `staff-visit-editor.ts` 431 (+ readers 2477, 2892, 2907, 2957, 2989; producers `staff-dashboard.ts` 4147 `bookingStatusWords[row.status]`, 5447 `'new'`)                                                                                                                                                                                                                                                                              | `VisitEditorVm.status: string` (lower-case booking word, or `'new'`)                                                                                                                                                                                                                                                                                                                                                              | `bookingStatus: BookingStatus \| null` (null = a visit not booked yet, today `'new'`); readers compare `BookingStatus.Pending` etc. / `=== null`; anything printed keeps its word via `bookingStatusWords` (and `'new'` for null); the frame event ≈2477 sets `bookingStatus: vm.bookingStatus` and, when that is `null`, `draftNew: true`, so the grid keeps printing `data-status="new"` on the new-visit frame (row 31)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P4a (producers P4b)        |
| 35  | `staff-visit-editor.ts` 235, 1229                                                                                                                                                                                                                                                                                                                                                                                                     | `VisitEditorCommit.kind: 'save'`                                                                                                                                                                                                                                                                                                                                                                                                  | field deleted (single variant)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P4a                        |
| 36  | `staff-visit-editor.ts` 313                                                                                                                                                                                                                                                                                                                                                                                                           | `VisitEditorResolution.kind` cancelled\|no_show — PRODUCED by `staff-dashboard.ts` `resolutionOf(…)` ≈3393–3395 as `kind: bookingStatusWords[status]` («the sheet's own lowercase word»): a `BookingStatus` → word → compared-as-word round trip (§1.5)                                                                                                                                                                           | `bookingStatus: typeof BookingStatus.Cancelled \| typeof BookingStatus.NoShow` (consumer side P4a); the producer emits `bookingStatus: status` (narrowed to Cancelled\|NoShow), the `bookingStatusWords` hop deleted (P4b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P4a (producer P4b)         |
| 37  | `staff-visit-editor.ts` 587, 3951–3961, 3988                                                                                                                                                                                                                                                                                                                                                                                          | `CreatePart.kind` name\|phone\|email, PRINTED into a test id: `testId: \`staff-visit-new-client-${part.kind}\`` (≈3988)                                                                                                                                                                                                                                                                                                           | `clientQueryShape: Exclude<ClientQueryShape, typeof ClientQueryShape.Empty>`; the test id `\`staff-visit-new-client-${clientQueryShapeWords[part.clientQueryShape]}\`` (`-name`/`-phone`/`-email`, never `-NAME`); pinned, unchanged, by `staff-visit-editor.spec.ts` 3157, 3161, 3253, 3256, 3335 (+3336)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P4a                        |
| 38  | `staff-visit-editor.ts` 921, 4824, 5821                                                                                                                                                                                                                                                                                                                                                                                               | `OfferChoice.kind` promo\|grant                                                                                                                                                                                                                                                                                                                                                                                                   | `OfferSource` {`PROMO`,`GRANT`} on `offerSource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P4a                        |
| 39  | `staff-visit-editor.ts` 859–875, 942; `.html` 20 (`[attr.data-page]`; CSS `[data-page='photo']`, spec `[data-page="service"]`), 29, 2642                                                                                                                                                                                                                                                                                              | `EditorPageKind` (16 camelCase words) on `EditorPage.kind`                                                                                                                                                                                                                                                                                                                                                                        | dictionary `EditorPage` (SCREAMING: `CLIENT`, `CLIENT_SEARCH`, …) on `editorPage`; the interface is renamed `EditorStackPage`; `editorPageWords` keeps every camelCase word for `data-page`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P4a                        |
| 40  | `staff-visit-editor.ts` 1873–1883                                                                                                                                                                                                                                                                                                                                                                                                     | `legMenu` signal `{ seatId; kind: 'variant'\|'client' }`; `isLegMenu`/`setLegMenu(…, kind)`                                                                                                                                                                                                                                                                                                                                       | `LegMenuFace` {`VARIANT`,`CLIENT`} on `legMenuFace`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P4a                        |
| 41  | `staff-visit-editor.ts` 2571–2601; `.html` 1711–1716 (`[attr.data-verdict]`, CSS `[data-verdict='conflict']`)                                                                                                                                                                                                                                                                                                                         | `frameVerdict` `{ kind: 'conflict'\|'outsideRoster'; … }`                                                                                                                                                                                                                                                                                                                                                                         | `FrameVerdict` {`CONFLICT`,`OUTSIDE_ROSTER`} on `frameVerdict` + `frameVerdictWords`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P4a                        |
| 42  | `staff-visit-editor.ts` 5263–5279                                                                                                                                                                                                                                                                                                                                                                                                     | `figureRead` `{ kind: 'percent'\|'amount' }`                                                                                                                                                                                                                                                                                                                                                                                      | `discountMethod: typeof DiscountMethod.PercentOff \| typeof DiscountMethod.FixedAmount` (`@core/components`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | P4a                        |
| 43  | `libs/ui/controls/…/date-field/date-field.ts` 32–35, 299/306; consumers (the only `ui-date-field` hosts binding `uiBlurred`) `client-profile.ts` 297 (P2), `client-onboarding.ts` 533 (P7); `apps/showcase/…/controls/date-field/date-field.page.html` renders the field without binding `uiBlurred` (no change). `client-auth` is NOT a consumer: its `(uiBlurred)` (`client-auth.html` 103) is the phone field's `output<string>()` | `UiDateFieldBlurEvent` kind empty\|partial\|complete{parts}                                                                                                                                                                                                                                                                                                                                                                       | `UiDateFieldFill` {`EMPTY`,`PARTIAL`,`COMPLETE`} on `uiDateFieldFill` (in `libs/ui/controls`, exported)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P7                         |
| 44  | `libs/ui/icons/src/lib/manifest/icon-manifest.ts` 43–60                                                                                                                                                                                                                                                                                                                                                                               | manifest `kind` vector\|material\|image                                                                                                                                                                                                                                                                                                                                                                                           | LEFT, allowlisted (UR-13 a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                          |
| 45  | `staff-dashboard.ts` 5503 (+ `.html` 1032/1043; `staff-dashboard.spec.ts` 3210, 5322, 5515, 5539, 5607)                                                                                                                                                                                                                                                                                                                               | `openCreate(kind: 'booking' \| 'block')`, branching `kind === 'block'` — a bare-literal discriminator PARAMETER (not a property signature, so the rule does not see it; §6 gate 4's regex does)                                                                                                                                                                                                                                   | `CreateIntent` {`BOOKING`,`BLOCK`} (§2.8), `openCreate(createIntent: CreateIntent)`, `createIntent === CreateIntent.Block`; the template passes `CreateIntent.Booking`/`.Block` through `protected readonly CreateIntent = CreateIntent` (no DOM change); the five spec calls re-targeted to name the member                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | P4b                        |

Load-state families that are not `kind` fields but copies of the same
dictionary (rows 7, 10, 19, 22, 23, 24, 5's `pageState`) are folded in for
UR-2, and so are the bare load-word SENTINELS mixed with data:

- `client-card.store.ts` `tierInputs` (≈615–632) returns `… | null | 'loading'`
  and its reader ≈831 checks `tier === 'loading'` → the tier becomes
  `LoadSlice<TierInputs | null>` (or an explicit `LoadState.Loading` member
  checked with `===`), same truth table (P3);
- `client-card.store.ts` the record read (≈1712–1781) returns
  `Promise<CustomerId | null | 'failed'>` with three `return 'failed'` and
  `record === 'failed'` → `Promise<LoadSlice.WithEmpty<CustomerId>>`
  (`ready(id)` / `empty` for `null` / `failed`), same callbacks fired (P3);
- `client-account.ts` host (161) `'[attr.data-state]':
"accountState.accountLoading() ? 'loading' : 'ready'"` → a `computed`
  printing `loadStateWords[accountState.accountLoading() ? LoadState.Loading :
LoadState.Ready]` — the same two words (P2).

§6 gate 8 proves none survives.

### 1.3 Undecorated classes (item 3)

AST scan for `ClassDeclaration`/`ClassExpression` without a `@Component`,
`@Directive`, `@Pipe`, `@Injectable` or `@NgModule` call decorator: exactly
five in production code (libs/infrastructure, libs/shared and apps/web have
none outside `testing/`).

| Class                              | Where                                                                                                                                                                                                                 | Owned by                                                                                                                                | Target                                                                                                                                                 | Pkg                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `VisitClock` (exported)            | `shared/visits/…/visit-row.presenter.ts` :782; built `new VisitClock(…)` :283                                                                                                                                         | a per-row value, no DI, no lifecycle; public through `export *` but no consumer outside the file                                        | `visitClockOf(…)` + `type VisitClock` (§2.5); `:283` one-line change; every `at.*()` call unchanged                                                    | P1                                                         |
| `CardClock`                        | `shared/visits/…/visit-card/visit-card.presenter.ts` :289; `new CardClock(…)` :63                                                                                                                                     | per card; a copy of `VisitClock` (time, dayLong, list, isToday, yearIfElsewhere identical; `list` builds an `Intl.ListFormat` per call) | deleted; `visitClockOf` with the card faces `dayShort` (`:153`), `weekdayAndDay` (`:158`), `whenHeard` (`:175`); `list` reuses the cached `listFormat` | P1                                                         |
| `EdgeScroller` (exported)          | `staff/dashboard/…/time-grid/grid-gesture.ts` :171; field initialisers `staff-time-grid.ts` :1638, `staff-timeline.ts` :613; driven at :1609/:595, stopped at :1750/:701; spec `grid-gesture.spec.ts` :5, :64, :98    | the gesture's own life (no destroy-time stop)                                                                                           | `edgeScrollerOf(axis, scroller, scrolled)` (§2.5), rAF fallback without `Date.now()`                                                                   | P4b                                                        |
| `FrameFullscreen` (exported)       | `staff/dashboard/…/shared/frame-fullscreen.ts` :34; field initialisers `staff-visit-editor.ts` :1970, `staff-block-editor.ts` :1041; templates `staff-visit-editor.html` 1590–1680, `staff-block-editor.html` 510–580 | the host component's lifetime; `inject(Injector)` at construction                                                                       | `injectFrameFullscreen(options)` (§2.5); call sites stay field initialisers; templates unchanged                                                       | P4b defines + block-editor call site; P4a editor call site |
| `ConsoleUiIconReporter` (exported) | `libs/ui/icons/src/lib/registry/icon-registry.service.ts` :66; root token factory :79; named in `docs/design-research/icon-registry-design.md` :264                                                                   | the root `InjectionToken` factory                                                                                                       | `consoleUiIconReporter(loud): UiIconReporter`; factory `() => consoleUiIconReporter(isDevMode())`                                                      | P7                                                         |

Test support classes stay (UR-8).

### 1.4 Ambient clock and entropy reads (item 4)

AST scan for `new Date`, `Date.now()`, `Date.parse()`, `Math.random()`
(plus a grep of `: Date` type references): 22 production files outside the
sanctioned sites of UR-10.

| File (lines ≈)                                                                             | Read                                                                                                                   | Class                           | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pkg |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `client/account/…/client-account.ts` 183                                                   | `openedAtMs = Date.now()` → `visitCardOf({ nowMs })`                                                                   | UI clock                        | `inject(CLOCK_PORTS).nowUtcMs()` once; `ShopNow` in the shown appointment's OWN location zone, `ShopZoneService.zoneOf(appointment.locationId)` read once per shop (pending → DEP-4's `LOADING`; a failed answer → `FAILED`/`'error'`, DEP-5) — never the default location's zone, whose `null` on a failed read or a missing default location would leave the card `LOADING` forever (UR-6, DEP-4, DEP-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P2  |
| `client/appointments/…/visit-ics.ts` 27                                                    | `toIcsUtc` = `new Date(ms).toISOString()` stripped                                                                     | format                          | integer arithmetic: `LocalDate.fromEpochDay(Math.floor(ms / 86_400_000))` without dashes + `T` + `hh mm ss` from `ms % 86_400_000` + `Z` (seconds kept — DTSTAMP carries real seconds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P2  |
| `client/profile/…/client-profile.ts` 153–159                                               | `new Date(\`${birthDate}T00:00:00\`)` device-local midnight, per-compute formatter                                     | format                          | `formatWallClock(birthDate, null, this.transloco.getActiveLang(), { day: 'numeric', month: 'long', year: 'numeric' })` — the SAME non-reactive language read as today (`getActiveLang()` inside the `computed`, so the label still updates only when something else re-runs it; making it reactive would be a departure, not taken); same civil date, cached formatter; pinned bg and en in `client-profile.spec.ts` (a case added if none prints the label, e.g. `2000-05-05` → «5 май 2000 г.» / «5 May 2000»)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P2  |
| `shared/shell/…/menu/site-menu.component.ts` 186–195, 214, 257                             | `signal(Date.now())`, re-set on open; `new Intl.DateTimeFormat(…).format(new Date(openedAt))`                          | UI clock + format               | `clock = inject(CLOCK_PORTS)`; `signal(this.clock.nowUtcMs())`, `set(this.clock.nowUtcMs())`; `formatInstant(openedAt, zone, locale, { weekday: 'short', day: 'numeric', month: 'long' })` imported from `@creativo/ui/wall-clock` (no feature → feature edge) (keep the `'en'`→`'en-GB'`, else `'bg-BG'` mapping)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P5  |
| `shared/shell/…/footer/site-footer.component.ts` 175                                       | `new Date().getFullYear()`                                                                                             | UI clock                        | `LocalDate.parts(ZonedTimeSystem.toLocal(nowUtcMs, shopZone() ?? UTC_ZONE).localDate).year`, one `CLOCK_PORTS` reading, the zone `ShopZoneService.defaultZone()` (DEP-2, review fix)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P5  |
| `marketing/landing/…/locations/locations.component.ts` 210–211, 232, 459–461               | `signal(new Date())`, interval `new Date()`, device `getDay()/getHours()/getMinutes()`                                 | UI clock + Law 7.2              | `now = signal(clock.nowUtcMs())`, interval `now.set(clock.nowUtcMs())`; `{ localDate, minute } = ZonedTimeSystem.toLocal(now, item.timeZone)`; day index `LocalDate.weekday(localDate) % 7` (ISO 1…7 → Sun = 0). The zone's source: `LocationItem` gains `locationId: 'center' \| 'mladost'`, joining the component's own `locations` array (which has no key today) to `LOCATIONS[].id` of `landing-content.ts`; its `timeZone: TimeZone` is that entry's `timezone`, checked once at module scope with `ZonedTimeSystem.checkZone` (`defect` on failure) — no zone literal enters `locations.component.ts` (§6 gate 3). `todayIndex` stays ONE component-level `computed` (the bold row of the open sheet): the weekday of `ZonedTimeSystem.toLocal(now(), activeLocation().timeZone).localDate`; `statusFor(item)` reads `item.timeZone` (DEP-1). Pinned by NEW `locations.component.spec.ts` cases (today it pins no status text and no particular today row) with `memoryClockPorts` at fixed Sofia instants: a Sunday (CENTER closed → its «opens Monday» line), a weekday 19:10 (closes-soon), 08:30 (opens-at), 20:30 (opens-on the next day) — each asserting the status line text and which `.location-sheet__week li[data-selected]` row is bold | P5  |
| `marketing/landing/…/content/landing-content.service.ts` 77, 87, 103–104                   | `todayIndexAt`/`isOpenNow`/`weekdayLabel`                                                                              | dead                            | deleted (UR-14)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P5  |
| `shared/visits/…/day-range.ts` 53–57                                                       | `noonOf` → `Date` for `formatRange`                                                                                    | format                          | `formatWallClockRange` (§2.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | P1  |
| `admin/loyalty/…/admin-rhythm.words.ts` 137–150                                            | private `noonOf` copy + `formatDay`                                                                                    | format, copy                    | `formatWallClock(…)` (already imported at :28)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P6  |
| `staff/client-card/…/client-card.format.ts` 35–40, 131–142                                 | third `noonOf` copy; `daysBetweenDays`/`dayPlus` via `Date`                                                            | format + date math              | `formatWallClock`; `LocalDate.daysBetween`/`LocalDate.addDays` (strings parsed once with `LocalDate.parse`, or callers already hold `LocalDate`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P3  |
| `staff/client-card/…/glance.presenter.ts` 156                                              | `weekdayLong` formats `new Date(\`${day}T12:00:00Z\`)`                                                                 | format                          | `formatWallClock(day, null, lang, { weekday: 'long' })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P3  |
| `staff/dashboard/…/day-pill/staff-day-pill.ts` 91–94                                       | fourth `noonOf` copy                                                                                                   | format                          | `formatDayPillRange`/`formatDayPill` keep EVERY branch verbatim — the same-month branch builds «21 – 27.09» / «Sep 21 – 27» by hand from `formatToParts` and a literal `–` (NOT `formatRange`; `formatWallClockRange` there would change the text) — and only swap `noonOf(key)` for `civilMs(key)` (`Intl`'s `format`, `formatRange` and `formatToParts` all take numbers; the formatters already run on `timeZone: 'UTC'`); pinned by `staff-day-pill.spec.ts` 39–52                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | P4b |
| `staff/dashboard/…/staff-dashboard.ts` 2122                                                | `formatToParts(new Date(this.nowMs()))`                                                                                | format                          | `formatToParts(this.nowMs())`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | P4b |
| `staff-dashboard.ts` 2494, 2497–2501, 2515 (`formatTitled(at: Date, …)`), 2575, 2811, 4218 | Date objects built from day keys only to format, per-call formatters                                                   | format                          | `formatTitled` takes a `LocalDate`; all through `formatWallClock`/`formatWallClockParts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P4b |
| `staff-dashboard.ts` 2869                                                                  | `Date.parse(week) - Date.parse(first)`                                                                                 | date math                       | `LocalDate.daysBetween(first, week) / 7`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P4b |
| `staff-dashboard.ts` 5518, 5533, 5557, 6206                                                | `nonce: Date.now()`                                                                                                    | id                              | `nonce: ++this.createSeq` (UR-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P4b |
| `staff-dashboard.ts` 5560                                                                  | rebook seat id stamp `Date.now().toString(36)`                                                                         | id (persisted)                  | `this.clock.nowUtcMs().toString(36)` (UR-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P4b |
| `staff/dashboard/…/visit-editor/staff-visit-editor.ts` 3832, 4240, 6923                    | seat/guest id stamps                                                                                                   | id (persisted)                  | `this.clock.nowUtcMs().toString(36)` with `clock = inject(CLOCK_PORTS)` (UR-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | P4a |
| `staff-visit-editor.ts` 5092                                                               | `photo-${Date.now()}.jpg`                                                                                              | UI clock (cosmetic)             | `photo-${this.clock.nowUtcMs()}.jpg`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P4a |
| `staff-visit-editor.ts` 6324–6326                                                          | `stepDay` via `Date.UTC` + `setUTCDate` + `toISOString`                                                                | date math                       | `LocalDate.addDays(draft.dayKey, offset)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P4a |
| `staff/dashboard/…/time-grid/grid-gesture.ts` 202                                          | rAF fallback `callback(Date.now())`                                                                                    | not a clock (timestamp ignored) | `globalThis.requestAnimationFrame ?? ((run) => setTimeout(run, 16))` typed `(run: () => void) => unknown` (§2.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P4b |
| `shared/catalog/…/media-url-cache.ts` 33                                                   | `Math.random()` jitter                                                                                                 | randomness                      | LEFT, allowlisted (UR-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —   |
| `libs/ui/controls/…/month-picker/month-picker.ts` 44, 181, 200, 232, 238                   | `addDays`, title, weekday heads (formatter built 7× per compute), device-UTC today fallback, `page()` — all via `Date` | date math + format + UI clock   | `LocalDate.addDays`/`fromEpochDay`/`parts` from `@core/primitives`; the weekday heads ARE `formatWeekdayLabels(locale)` of `@creativo/ui/wall-clock` (Monday-first, `weekday: 'short'`, `timeZone: 'UTC'`, cached per locale — the same strings as today's seven per-compute formatters); the title `formatWallClock(<first of the month>, null, locale, { month: 'long', year: 'numeric' })` then the existing title-casing; `relativeDay` returns `null` without a valid `uiToday` and `pick` skips it (DEP-3); no new cache in `libs/ui`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P7  |
| `libs/ui/controls/…/weekday-picker/weekday-picker.ts` 106                                  | `new Date(Date.UTC(2026, 7, 2 + iso))`                                                                                 | format                          | `formatWeekdayLabels(locale)[iso - 1]` for the short name and `formatWallClock(LocalDate.addDays(<the reference Monday>, iso - 1), null, locale, { weekday: 'long' })` for the long one, from `@creativo/ui/wall-clock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P7  |
| `libs/ui/controls/…/phone-field/phone-field.ts` 650                                        | typeahead reset window                                                                                                 | monotonic interval              | `performance.now()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P7  |
| `libs/ui/patterns/…/toast/toast.ts` 219, 241                                               | hold elapsed time                                                                                                      | monotonic interval              | `performance.now()` (no fake timers in its spec)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P7  |
| `libs/ui/patterns/…/confetti/confetti.ts` 129–162                                          | `Math.random()` ×8                                                                                                     | randomness (visual)             | LEFT, allowlisted (UR-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —   |
| `apps/showcase/src/app/pages/controls/menu/menu.page.ts` 40                                | `new Date(Date.UTC(y, m - 1, d, 12))` formatted                                                                        | format (demo)                   | `formatWallClock(<the LocalDate>, null, locale, <its options>)` from `@creativo/ui/wall-clock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | P7  |

### 1.5 Translation layers beyond the brief (same shape as the shim)

Re-derived with `git grep -nE "LEGACY_[A-Z_]+|_OF = \{"` and the reads of
the lower-case words: each converts an ecs-core value to a lower-case word and
(usually) back.

| Site                                                                                                                                                           | Round trip                                                                                                           | Target                                                                                                       | Pkg                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| `staff/dashboard/…/visit-editor/client-query.ts`                                                                                                               | `ClientQueryShape` → `ClientQueryKind` word and back (`LEGACY_CLIENT_QUERY_SHAPE`, `CLIENT_QUERY_SHAPE_OF`, `toEcs`) | §1.2 row 32                                                                                                  | P4a                 |
| `staff/dashboard/…/time-grid/staff-time-grid.ts` 2480–2495                                                                                                     | grid `kind` word → `GridEventTag` (`GRID_EVENT_OF`)                                                                  | §1.2 row 31                                                                                                  | P4b                 |
| `staff-dashboard.ts` 250–253, 4182, 4389–4402 + editor                                                                                                         | `RowVerb` → `ROW_VERB_WORD` → `VisitEditorVerb.kind` → emitted → matched back                                        | §1.2 row 33; `ROW_VERB_WORD` stays for i18n key segments                                                     | P0 (move), P4a, P4b |
| `staff-dashboard.ts` 2272 → `staff-time-grid` `event.status` → `hollowStatus`; `staff-dashboard.html` 764/852 `hollowStatus(statusWords[entry.status])`        | `BookingStatus` → `bookingStatusWords` → compared as `'cancelled'`/`'no_show'`                                       | §1.2 rows 28, 31, `hollowStatus` on `BookingStatus` (§1.1)                                                   | P1, P4b             |
| `staff-dashboard.ts` 4147 → editor `vm.status`                                                                                                                 | `BookingStatus` → word (or `'new'`) → compared as words                                                              | §1.2 row 34                                                                                                  | P4a, P4b            |
| `staff-dashboard.ts` `resolutionOf` ≈3395 → editor `resolution.kind`                                                                                           | `BookingStatus` → word → compared as words                                                                           | §1.2 row 36                                                                                                  | P4a, P4b            |
| `staff-day.store.ts` 1636 → `staff-visit-editor.ts` `VisitEditorGrantOption.occasion` (673) → ≈6525 `ClientCardGrant.occasion` → `glance.presenter.ts` 853–862 | `CouponOccasion` → `'birthday'` (ternary) → copied → `'birthday'` → `CouponOccasion` (`COUPON_OCCASION_OF`)          | §1.2 row 27: `couponOccasion` end to end, each hop a pass-through                                            | P4b, P4a, P3        |
| `shared/catalog/…/catalog-to-vm.ts` 102                                                                                                                        | `CompositionKind` → `'single'\|'bundle'`                                                                             | §1.2 row 14                                                                                                  | P5                  |
| `staff-dashboard.ts` `toEditorPhoto` → `staff-visit-editor.ts` `VisitEditorPhoto.origin` → `.html` `photo.origin === 'library'` (review fix)                   | `PhotoOrigin` → `'shot'\|'library'` (ternary) → compared as a bare word                                              | `photoOrigin: PhotoOrigin` end to end, a pass-through; the template compares `PhotoOrigin.Library`           | fixer               |
| `staff-dashboard.ts` `DISCOUNT_SOURCE_WORD` / `discountsOf` / `toDiscountRequest` → `VisitEditorDiscount.source` (review fix)                                  | `DiscountSource` → `'grant'\|'code'\|'manual'` → compared as words in the sheet → switched back to `DiscountSource`  | `discountSource: DiscountSource` end to end; `DISCOUNT_SOURCE_WORD` deleted; `discountKey` strings unchanged | fixer               |

---

## 2. Contracts every package builds against

### 2.1 The view-state lib (P0) — `@creativo/shared/view-state`

`libs/shared/view-state/src/lib/load-state.data.ts` (Law 1, the
`booking-status.data.ts` shape):

```ts
/** Where one read stands — the field `loadState`, the ONLY source of these strings. */
export const LoadState = {
  /** No answer yet: the skeleton. */
  Loading: 'LOADING',
  /** The read answered: the content. */
  Ready: 'READY',
  /** The read failed: the heading over «Опитай пак». */
  Failed: 'FAILED',
  /** The read answered with nothing to draw (no slice, no item). */
  Empty: 'EMPTY',
} as const;
export type LoadState = (typeof LoadState)[keyof typeof LoadState];
```

`load-slice.data.ts`:

```ts
import { LoadState } from './load-state.data';

/** One read as a page draws it — its state, and the data once ready. */
export type LoadSlice<T> =
  LoadSlice.Loading | LoadSlice.Failed | LoadSlice.Ready<T>;

export const LoadSlice = {
  loading: { loadState: LoadState.Loading } as LoadSlice.Loading,
  failed: { loadState: LoadState.Failed } as LoadSlice.Failed,
  empty: { loadState: LoadState.Empty } as LoadSlice.Empty,
  ready<T>(data: T): LoadSlice.Ready<T> {
    return { loadState: LoadState.Ready, data };
  },
  /** The data of a READY slice, else null. */
  dataOf<T>(slice: LoadSlice.WithEmpty<T> | null | undefined): T | null {
    return slice?.loadState === LoadState.Ready ? slice.data : null;
  },
} as const;

export namespace LoadSlice {
  export type Loading = { readonly loadState: typeof LoadState.Loading };
  export type Failed = { readonly loadState: typeof LoadState.Failed };
  export type Empty = { readonly loadState: typeof LoadState.Empty };
  export type Ready<T> = {
    readonly loadState: typeof LoadState.Ready;
    readonly data: T;
  };
  /** A read that may answer with nothing to draw. */
  export type WithEmpty<T> = LoadSlice<T> | Empty;
}
```

(The `as` on the three constants is the literal's own type, not a cast of
foreign input; if the root `.data.ts` guards object, declare them as typed
`const`s above the companion.) `paging-state.data.ts`:

```ts
/** Where a list's next page stands — the field `pagingState`. */
export const PagingState = {
  More: 'MORE',
  Loading: 'LOADING',
  Failed: 'FAILED',
  End: 'END',
} as const;
export type PagingState = (typeof PagingState)[keyof typeof PagingState];
```

`load-state-words.ts` (NOT a `.data.ts`: Law 1's three-export rule):

```ts
/** Each load state as a page's `data-state` spells it where it says `failed`/`empty`. */
export const loadStateWords = {
  [LoadState.Loading]: 'loading',
  [LoadState.Ready]: 'ready',
  [LoadState.Failed]: 'failed',
  [LoadState.Empty]: 'empty',
} as const satisfies Record<LoadState, string>;
```

`src/index.ts` exports the four files. Feature payload names collapse onto
`data` (`positions`, `courses`, `events`, `appointment`, `appointments`,
`vm` → `data`; achievements' `T = { vm; words }`).

### 2.2 The i18n words tables (P0) — `@creativo/infrastructure/i18n`

`visit-list-words.ts` (imports `@core/systems`, as the firestore adapters do):

```ts
export const visitFilterWords = {
  ALL: 'all',
  UPCOMING: 'upcoming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const satisfies Record<VisitFilter, string>;
export const visitGrainWords = {
  MONTH: 'month',
  YEAR: 'year',
} as const satisfies Record<VisitGrain, string>;
export const visitPerspectiveWords = {
  CLIENT: 'client',
  STAFF: 'staff',
} as const satisfies Record<VisitPerspective, string>;
```

(written with computed keys `[VisitFilter.All]: 'all'`, like
`program-status-words.ts`), exported from
`libs/infrastructure/i18n/src/index.ts` — its readers span three libs.

The two single-reader tables live beside their reader (UR-3), in ONE file
`libs/features/staff/dashboard/src/lib/tag-words.ts` (P0; read by P4a and
P4b): `gridEventWords` (`[GridEvent.Visit]: 'visit'`, `Gap: 'gap'`,
`Block: 'block'`) and `clientQueryShapeWords` (`EMPTY: 'empty'`,
`NAME: 'name'`, `PHONE: 'phone'`, `EMAIL: 'email'`), each
`as const satisfies Record<Tag, string>`, pinned by `tag-words.spec.ts`
beside it.

### 2.3 The visit view models (P1; consumers P2, P3, P4a, P4b)

```ts
// visit-row.vm.ts
export type { VisitFilter, VisitGrain, VisitPerspective, VisitRowOutcome } from '@core/systems';
export { VisitFilter, VisitGrain, VisitPerspective, VisitRowOutcome } from '@core/systems'; // value + type, for templates and hosts

export const VisitRowEntry = { Visit: 'VISIT', Waitlist: 'WAITLIST' } as const;
export type VisitRowEntry = (typeof VisitRowEntry)[keyof typeof VisitRowEntry];
export const TrailingFactFace = { Amount: 'AMOUNT', Status: 'STATUS', Badge: 'BADGE' } as const;
export type TrailingFactFace = (typeof TrailingFactFace)[keyof typeof TrailingFactFace];

export type VisitTrailing = { /* the barber face, no tag */ … };
export type VisitTrailingFact =
  | { readonly trailingFactFace: typeof TrailingFactFace.Amount; … }
  | { readonly trailingFactFace: typeof TrailingFactFace.Status; … }
  | { readonly trailingFactFace: typeof TrailingFactFace.Badge; readonly text: string };

export interface VisitRowVm {
  readonly id: string;
  readonly visitRowEntry: VisitRowEntry;
  readonly localDate: LocalDate;       // was startMs
  readonly startMinutes: MinuteOfDay;  // was startMs
  readonly sectionKey: string;
  readonly upcoming: boolean;
  … // tile, leadingIcon, title, struck, lines, quote, trailing, trailingFact, marks — unchanged
  readonly outcome: VisitRowOutcome | null;       // the ecs-core tag
  readonly bookingStatus: BookingStatus | null;   // was status
  readonly accessibleName: string;
  readonly testId: string;
}
// VisitWords.cancelledBy(side: CancelledSide) — CancelledSide from @core/systems
```

```ts
// visit-row.presenter.ts
export interface VisitRowOptions {
  readonly perspective: VisitPerspective;
  readonly grain: VisitGrain;
  readonly subjectUserId: string | null;
  readonly subjectCustomerId?: string | null;
  readonly currentAppointmentId: string | null;
  /** "Now" on the shop's wall clock, derived ONCE by the host (Law 7.3). */
  readonly now: ShopNow;
  /** The zone `now` was read in — a photo's day falls back to it. */
  readonly timeZone: TimeZone;
  readonly locale: string;
  readonly photoCount?: number;
  readonly words: VisitBuilderWords;
  readonly clientWords?: boolean;
}
export interface VisitStory {
  readonly seats: readonly Seat[];
  readonly outcome: VisitRowOutcome;
  readonly cancelledBy: CancelledSide | null;
}
export function visitZoneOf(
  locationId: LocationId | null,
  lookup: VisitLookup,
): TimeZone | null;
```

(`id`, `subjectUserId`, `subjectCustomerId`, `currentAppointmentId` stay raw
strings in this pass — listed by name for the branding pass in UR-13 c.)

`VisitCardOptions`: `visitCardSlot: Exclude<VisitCardSlot, typeof VisitCardSlot.Waitlist>`
replaces `kind`; `now: ShopNow` + `timeZone: TimeZone` replace `nowMs`.
`VisitCardVm.visitCardSlot: VisitCardSlot`. `visitCardSlotWords`
(`LAST: 'last'`, `NEXT: 'next'`, `WAITLIST: 'waitlist'`) exported beside it.
`VisitListPaging = { readonly pagingState: PagingState }`. `lib-visit-list` and
`lib-visits-browser` take `state: LoadState` (only `LOADING`/`READY`/`FAILED`
are drawn; `EMPTY` is never passed). `hollowStatus(bookingStatus: BookingStatus | null | undefined): boolean`.
`visitFilterWordKey(filter: VisitFilter, perspective: VisitPerspective): string`
— the same keys. `offeredVisitFilters(perspective, rows, complete)` and
`matchesVisitFilter(row, filter)` take rows as they are.

### 2.4 The staff-card and dashboard contracts

- `client-pages.vm.ts` (P3): `Slice<T>` → `LoadSlice<T>`; `VisitsPageVm.loadState: LoadState`;
  `HistoryPagingVm = VisitListPaging & { readonly endLabel: string }`;
  `ClientCardCatalog.locationTimeZone?: (locationId: LocationId) => TimeZone | null`
  (declared; `staff-dashboard.ts` ≈1382 already fills it);
  `ClientCardGrant.couponOccasion?: CouponOccasion | null` (filled by the
  visit editor's ≈6525 pass-through from `VisitEditorGrantOption.couponOccasion`,
  P4a, which `staff-day.store.ts` ≈1636 produces, P4b).
- The client card store's history input (P3): `HistoryRowsInput.now: ShopNow | null` +
  `timeZone: TimeZone | null` replace `nowMs`; rows are `[]` while `now` is null,
  and `visits()` returns `LOADING` for that window (never `FAILED`, §9 R-1).
- `libs/features/staff/dashboard/src/lib/row-verb.ts` (P0, moved verbatim from
  `staff-dashboard.ts` 232–253): `export const ArrivalVerb`, `export type ArrivalVerb`,
  `export type RowVerb = BookingStatus | ArrivalVerb`, `export const ROW_VERB_WORD`.
- Visit editor (P4a) public types, produced by P4b:
  `VisitEditorVm.bookingStatus: BookingStatus | null` (null = not yet booked);
  `VisitEditorVerb.rowVerb: RowVerb`; `acted = output<RowVerb>()`;
  `VisitEditorCommit` without `kind`;
  `VisitEditorResolution.bookingStatus: typeof BookingStatus.Cancelled | typeof BookingStatus.NoShow`
  (produced by `staff-dashboard.ts` `resolutionOf` ≈3395 as `bookingStatus: status`);
  `VisitEditorGrantOption.couponOccasion?: CouponOccasion | null` (replaces
  `occasion?: 'birthday' | null`; produced by `staff-day.store.ts` ≈1636 as
  `couponOccasion: coupon.couponOccasion ?? null`).
- Time grid (P4b) public types: `GridEvent.gridEvent: GridEventTag`,
  `GridEvent.bookingStatus: BookingStatus | null`,
  `GridEvent.draftNew?: true` (only the visit editor's frame event sets it,
  when `vm.bookingStatus === null`; the grid then prints `data-status="new"`),
  `GridCommit.editCommand: typeof EditCommand.Move | typeof EditCommand.Resize`.
- `ParsedClientQuery` (P4a): the ecs-core `ParsedClientQuery` (field
  `clientQueryShape`); `client-query.ts` keeps only the ranking/lookup helpers
  over it (no conversion). Readers: `staff-visit-editor.html` 174 and
  `staff-visit-editor.ts` ≈3876/4028/4054 (P4a), and `staff-dashboard.ts`
  ≈5797 `searchClients` (P4b: `parsed.clientQueryShape !== ClientQueryShape.Empty`).

### 2.5 The factories (P1, P4b, P7)

```ts
// visit-row.presenter.ts — ONE clock for rows and cards
export type VisitClock = {
  readonly time: () => string; // «10:00»
  readonly weekday: () => string; // «пт»
  readonly whenShort: (today: string) => string; // «днес, 10:00» · «пт, 10:00»
  readonly whenLong: (today: string) => string; // the row's: «4 септември в 10:00» (no weekday)
  readonly dayLong: (takenAtUtcMs?: UtcEpochMs) => string;
  readonly list: (names: readonly string[]) => string; // cached Intl.ListFormat
  readonly isToday: () => boolean;
  readonly yearIfElsewhere: (
    day: LocalDate,
  ) => Pick<Intl.DateTimeFormatOptions, 'year'>;
  readonly dayShort: () => string; // the card's «5.09» (was CardClock.day)
  readonly weekdayAndDay: () => string; // the card's «пт, 23.10»
  readonly whenHeard: (today: string) => string; // the card's long form WITH weekday:'long' (was CardClock.whenLong)
};
export function visitClockOf(
  localDate: LocalDate,
  minute: MinuteOfDay,
  now: ShopNow,
  locale: string,
  timeZone: TimeZone,
): VisitClock;
```

Each face's body is today's method body verbatim (the card's three from
`CardClock`), the closures calling each other directly. `minute` is the
appointment's branded `startMinutes`.

```ts
// grid-gesture.ts
export type EdgeScroller = {
  readonly update: (at: number) => void;
  readonly stop: () => void;
};
export function edgeScrollerOf(
  axis: 'x' | 'y',
  scroller: () => HTMLElement | null | undefined,
  scrolled: () => void,
): EdgeScroller;
/** What a drag does — built from the ecs-core vocabulary, no new dictionary: a move, or a resize at one edge. */
export type DragGesture = typeof EditCommand.Move | ResizeEdge; // 'MOVE' | 'START' | 'END' (was 'move' | 'resize-start' | 'resize-end')
export const PlacementVerdict = {
  Short: 'SHORT',
  Overlap: 'OVERLAP',
  Outside: 'OUTSIDE',
} as const;
export type PlacementVerdict =
  (typeof PlacementVerdict)[keyof typeof PlacementVerdict];
export type PlacementVerdictSlice =
  | {
      readonly placementVerdict: typeof PlacementVerdict.Short;
      readonly minutes: number;
    }
  | {
      readonly placementVerdict: typeof PlacementVerdict.Overlap;
      readonly name: string;
      readonly time: string;
    }
  | { readonly placementVerdict: typeof PlacementVerdict.Outside };
```

`DragGesture` is compared against `EditCommand.Move`, `ResizeEdge.Start`,
`ResizeEdge.End` (`@core/components`); a resize gesture IS its edge, so the
`gesture → edge` mapping the grid and timeline do today becomes the identity.
The gesture is never printed (no attribute reads it), so no words table.
(`PlacementVerdictSlice.minutes` stays `number` — UR-13 c.)

`edgeScrollerOf` keeps `pending`, `carry`, `at` as closure `let`s and
`schedule`/`tick` as inner functions in the SAME order of operations
(velocity 0 resets `carry` and does not reschedule; `room <= 0` returns
without rescheduling; the end of the day returns before `scrolled`;
otherwise reschedule). No destroy-time `stop()` is added.

```ts
// shared/frame-fullscreen.ts
export type FrameFullscreenOptions = {
  readonly surface?: () => HTMLElement | undefined;
  readonly settled?: (expanded: boolean) => void;
};
export type FrameFullscreen = {
  readonly expanded: Signal<boolean>;
  readonly toggle: () => void;
  readonly onEscape: (event: Event) => void;
  readonly set: (next: boolean) => void;
};
/** Must run in an injection context — a component FIELD INITIALISER. */
export function injectFrameFullscreen(
  options?: FrameFullscreenOptions,
): FrameFullscreen;
```

`set()` keeps its order: the same-state guard, `lower()` before
`runViewTransition`, `settle` after.

```ts
// libs/ui/icons registry
export function consoleUiIconReporter(loud: boolean): UiIconReporter; // the same message template; loud → console.error, else console.warn
```

### 2.6 The wall-clock lib (P0) — `@creativo/ui/wall-clock`

`libs/ui/wall-clock` (tags `scope:shared`, `type:ui`; config mirrored from
a sibling `libs/ui/*` lib; nested `eslint.config.mjs` importing
`#eslint-config`): `src/lib/wall-clock.ts` and `wall-clock.spec.ts` MOVED
verbatim (a plain file move — nothing staged, HANDOFF §5) from `libs/features/shared/visits/src/lib/`, exported by
`src/index.ts`; `@creativo/features/shared/visits` stops exporting it (no
re-export — one import path per name). Every importer re-pointed, import
lines only: inside the visits lib `visit-row.presenter.ts`,
`visit-card/visit-card.presenter.ts`, `visit-sections.ts` (`./wall-clock` →
`@creativo/ui/wall-clock`), and the 13 files that take wall-clock names from
`@creativo/features/shared/visits` (`client-appointments.ts`,
`booking-bag-sheet.ts`, `booking-wall-clock.ts`, `booking-review-step.ts`,
`booking-schedule-step.ts`, `client-onboarding.ts`, `marketing-events.ts`,
`glance.presenter.ts`, `history.presenter.ts`, `wallet.presenter.ts`,
`staff-block-editor.ts`, `staff-dashboard.ts`, `staff-visit-editor.ts` —
re-derive with a grep for the seven names before editing). Then add:

```ts
/** «4 – 6 септември» — two shop days as one range, the locale's own range form (cached formatter, timeZone 'UTC'). */
export function formatWallClockRange(
  from: LocalDate,
  to: LocalDate,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string;
```

`dateFormat(locale, 'UTC', options).formatRange(civilMs(from), civilMs(to))`.
Midnight instead of noon is output-identical because every one of these
formatters runs on `timeZone: 'UTC'`.

### 2.7 The injected clock (every package)

No new helper. A component or store reads `inject(CLOCK_PORTS).nowUtcMs()`
(a field initialiser, or an effect for "re-read on open"); "now" on the shop
clock is `ZonedTimeSystem.shopNow(nowUtcMs, zone)`; specs provide
`{ provide: CLOCK_PORTS, useValue: memoryClockPorts(utcMs('…')) }`.

### 2.8 The new feature dictionaries and their variant unions (one line each)

Every package uses exactly these names (UR-4). Dictionary = field name in
camelCase; the variant union is the type the variants make up. P0 greps each
dictionary name against the exports of the six `@core/*` barrels and
`@core/testing` and records "no collision" (the check that renamed row 9).

| Dictionary {values}                                             | Field                                                                                                                      | Variant union (renamed from)                                                    | Row | Pkg |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --- | --- |
| `ProfileEditField` {`NAME`,`BIRTHDAY`}                          | `profileEditField`                                                                                                         | `ProfileEdit` (kept)                                                            | 5   | P2  |
| `ConsentPart` {`TEXT`,`TERMS`,`PRIVACY`}                        | `consentPart`                                                                                                              | `LegalPart` (kept)                                                              | 8   | P6  |
| `ShopCoverage` {`SERVED`,`ELSEWHERE`,`NOWHERE`}                 | `shopCoverage`                                                                                                             | `ShopCoverageVerdict` (local `ShopReach`)                                       | 9   | P6  |
| `RhythmEstimate` {`ESTIMATE`,`UNAVAILABLE`}                     | `rhythmEstimate`                                                                                                           | `RhythmEstimateLine` (inline `{ kind: 'estimate' } \| …`)                       | 11  | P6  |
| `ProgramEditing` {`POSITION`,`COURSE`,`EVENT`}                  | `programEditing`                                                                                                           | `Editing` (kept; members `PositionEditing`/`CourseEditing`/`EventEditing` kept) | 12  | P6  |
| ~~`DayOpening` {`OPEN`,`CLOSED`}~~ — deleted (UR-14)            | ~~`dayOpening`~~                                                                                                           | `DayHoursVm` deleted with `LocationVm.hours` (no reader, UR-14)                 | 13  | P5  |
| `ShopOpening` {`CLOSES_AT`,`CLOSES_SOON`,`OPENS_AT`,`OPENS_ON`} | `shopOpening`                                                                                                              | `ShopOpeningLine` (`LocationStatus`)                                            | 15  | P5  |
| `FooterLinkTarget` {`HASH`,`ROUTER`,`EXTERNAL`,`TEL`}           | `footerLinkTarget`                                                                                                         | `FooterLink` (kept)                                                             | 16  | P5  |
| `VisitRowEntry` {`VISIT`,`WAITLIST`}                            | `visitRowEntry`                                                                                                            | `VisitRowVm` (kept, one interface)                                              | 17  | P1  |
| `TrailingFactFace` {`AMOUNT`,`STATUS`,`BADGE`}                  | `trailingFactFace`                                                                                                         | `VisitTrailingFact` (kept)                                                      | 17  | P1  |
| `VisitCardSlot` {`LAST`,`NEXT`,`WAITLIST`}                      | `visitCardSlot`                                                                                                            | — (a field of `VisitCardVm`; `VisitCardKind` deleted)                           | 18  | P1  |
| `BirthdayMoment` {`TODAY`,`UPCOMING`}                           | `birthdayMoment`                                                                                                           | `BirthdayVm` (kept)                                                             | 25  | P3  |
| `WalletHolding` {`VOUCHER`,`TICKET`,`STAMPS`}                   | `walletHolding`                                                                                                            | `WalletHoldingVm` (kept)                                                        | 25  | P3  |
| `AgendaRow` {`VISIT`,`GAP`}                                     | `agendaRow`                                                                                                                | `RunEntryVm` (kept: `DayRowVm \| GapRowVm`)                                     | 29  | P4b |
| `GridMask` {`ELAPSED`,`SURPLUS`,`CLOSED`,`OVERLAP`}             | `gridMask`                                                                                                                 | `EventMask` (kept)                                                              | 31  | P4b |
| `PlacementVerdict` {`SHORT`,`OVERLAP`,`OUTSIDE`}                | `placementVerdict`                                                                                                         | `PlacementVerdictSlice` (both `draftVerdict` copies)                            | 31  | P4b |
| `CreateIntent` {`BOOKING`,`BLOCK`}                              | `createIntent` (a parameter)                                                                                               | —                                                                               | 45  | P4b |
| `OfferSource` {`PROMO`,`GRANT`}                                 | `offerSource`                                                                                                              | `OfferChoice` (kept)                                                            | 38  | P4a |
| `EditorPage` {`CLIENT`,`CLIENT_SEARCH`,…}                       | `editorPage`                                                                                                               | `EditorStackPage` (interface `EditorPage`; `EditorPageKind` deleted)            | 39  | P4a |
| `LegMenuFace` {`VARIANT`,`CLIENT`}                              | `legMenuFace`                                                                                                              | `LegMenu` (inline signal type, named)                                           | 40  | P4a |
| `FrameVerdict` {`CONFLICT`,`OUTSIDE_ROSTER`}                    | `frameVerdict` (field; the `computed` keeps its name `frameVerdict`, so the template reads `frameVerdict()?.frameVerdict`) | `FrameVerdictSlice` (inline `computed<{ kind … }>`)                             | 41  | P4a |
| `UiDateFieldFill` {`EMPTY`,`PARTIAL`,`COMPLETE`}                | `uiDateFieldFill`                                                                                                          | `UiDateFieldBlurEvent` (kept)                                                   | 43  | P7  |

Reused ecs-core dictionaries (no new name): `CompositionKind` (14),
`BookingStatus` (6, 28, 34, 36), `GridEvent` as `GridEventTag` (31),
`EditCommand` + `ResizeEdge` (31, `DragGesture` is a type alias over them),
`ClientQueryShape` (32, 37), `PersonalRecordKind` (25), `CouponOccasion`
(27), `DiscountMethod` (42), `VisitFilter`/`VisitGrain`/`VisitPerspective`/
`VisitRowOutcome`/`CancelledSide` (17). Shared view-state: `LoadState`,
`LoadSlice`, `PagingState` (§2.1).

---

## 3. The lint guards

All four live in `tools/lint-rules/`, are registered in `index.mjs`'s
`plugin.rules`, and are switched on in the root `eslint.config.mjs` (the
first three by G2, wave 2; the fourth, §3.5, by the review fixes). Separate rule names cannot be erased by a nested project's
`no-restricted-syntax` override or by option replacement.

**Scoping (all four; UR-12).** Each root block is
`files: ['**/*.ts']` with `ignores: ['**/*.spec.ts', '**/*.type-spec.ts',
'**/testing/**', '**/test-setup.ts', '**/e2e/**', '**/*.d.ts']` — patterns
that match under any base path. No repo-root-relative glob appears anywhere
(not `libs/features/**`, not a file path in a second block): under directory
lookup the base path is the project dir and such a glob matches nothing,
silently. Each rule normalises `context.physicalFilename` to `/` separators
and decides from options of path FRAGMENTS (`filename.includes(fragment)`,
the `icon-registry-only` precedent): `include` (in scope only if some fragment
matches; outside it the rule returns `{}`) and the per-rule allowlists below.
Every RuleTester spec carries cases with a `filename:` inside the include
list, outside it, and on each allowlisted path.

### 3.1 `creativo/no-undecorated-class`

- **Rule.** Reports every `ClassDeclaration` and `ClassExpression` unless it
  carries a decorator whose expression is a `CallExpression` with an
  `Identifier` callee in {`Component`, `Directive`, `Pipe`, `Injectable`,
  `NgModule`}. Message: «No `class` outside the Angular row (CLAUDE.md §2):
  a value is a plain object from a factory function; only `@Component`,
  `@Directive`, `@Pipe`, `@Injectable`, `@NgModule` classes are legal.»
- **Scope.** The shared `files`/`ignores` above; option
  `include: ['/libs/', '/apps/']` (so `tools/**` stays out). `libs/ecs-core` and `apps/functions` already ban
  every class; the overlap reports twice on a regression there, which is
  accepted (defence in depth; a decorated class there is still banned by the
  stricter ECS block).
- **Flags today:** exactly the five of §1.3. **Fix:** §2.5.
- **Spec** `no-undecorated-class.spec.mjs` (RuleTester, like
  `no-sliced-ports.spec.mjs`): valid — `@Component({…}) class A {}`,
  `@Injectable() class S {}`, `@Directive({…}) class D {}`, `@Pipe({…})`,
  `@NgModule({})`, an interface, a factory function; invalid — a plain class,
  a class expression, `@Foo() class X {}`, `class Y implements OnDestroy {}`,
  `@Component class Z {}` (decorator not called).

### 3.2 `creativo/no-ambient-clock`

- **Rule.** Reports `new Date(…)`, `Date(…)`, `Date.now()`, `Date.parse(…)`,
  a `Date` type reference (`TSTypeReference[typeName.name='Date']`),
  `Math.random()`, `crypto.randomUUID()`, `crypto.getRandomValues(…)`.
  `Date.UTC(…)` (pure arithmetic returning a number) and `performance.now()`
  are allowed. Options `allowIn` (the file is skipped) and `allowRandomIn`
  (only `Math.random()` is lifted), both path fragments (§3 Scoping). Messages name the replacement: the `CLOCK_PORTS` clock,
  `ZonedTimeSystem`, `LocalDate`, `wall-clock.ts` formatters, `ID_PORTS`.
- **Scope.** The shared `files`/`ignores`; options
  `include: ['/libs/features/', '/libs/ui/', '/libs/shared/',
'/libs/infrastructure/', '/apps/web/src/', '/apps/showcase/src/']`
  (`apps/functions/**` and `libs/ecs-core` out — the backend composition
  root is sanctioned and ecs-core has its own bans), `allowIn:
['/libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts',
'/libs/infrastructure/firebase-auth/src/lib/auth-session.adapter.ts']`
  (the two sanctioned clock/entropy adapters of UR-10, by exact path — every
  other infrastructure file stays guarded) and `allowRandomIn:
['/libs/features/shared/catalog/src/lib/content/media-url-cache.ts',
'/libs/ui/patterns/src/lib/confetti/confetti.ts']` (lifts only
  `Math.random()`; the `allowRandom` boolean is replaced by this option),
  each entry with its reason in a comment in the root config.
- **Flags today:** the 22 files of §1.4 minus the two allowlisted; 0 in
  `libs/infrastructure` outside the two adapters (§11.4).
- **Spec** `no-ambient-clock.spec.mjs`: valid — `Date.UTC(2026, 0, 1)`,
  `performance.now()`, `clock.nowUtcMs()`, `Math.random()` in a file named by
  `allowRandomIn`, `Date.now()` in a file named by `allowIn`, `Date.now()` in
  a file outside `include` (e.g. `/repo/tools/x.ts`); invalid — each banned
  form, a `: Date` parameter, a `(): Date` return type, `Date.now()` in an
  `allowRandomIn` file, `Date.now()` in a non-adapter infrastructure file.

### 3.3 `creativo/no-generic-discriminator`

- **Rule.** Reports a `TSPropertySignature` whose key is the identifier or
  string literal `kind`, `type` or `status` — the half of
  `ECS_GENERIC_DISCRIMINATOR_RESTRICTIONS` without false positives. The
  `Property` half is NOT used: it fires on `Intl` options (`{ type:
'conjunction' }` in `visit-row.presenter.ts`, `visit-card.presenter.ts`,
  `rhythm-rule.words.ts`, `admin-rhythm.words.ts`, `staff-block-editor.ts`;
  `{ type: 'region' }` in `phone-field.ts`) and on `client-loyalty.ts`'s
  `PLACEHOLDER_HEIGHTS.status` CSS key; an object literal typed by a renamed
  type fails typecheck anyway. Inline type literals (`computed<{ kind: … }>`,
  `row: { readonly status: … }`) are property signatures and are caught.
- **Scope.** The shared `files`/`ignores`; options `include` as in 3.2 and
  `allowIn: ['/libs/ui/icons/src/lib/manifest/']` (UR-13 a, comment says why).
- **Flags today:** the 27 files of §1.2 rows 1–43 (row 44, the manifest, allowlisted; row 45 is a method parameter, not a property signature — §6 gate 4 catches it).
- **Spec** `no-generic-discriminator.spec.mjs`: valid — `{ readonly
bookingStatus: BookingStatus }`, an object literal `{ type: 'conjunction' }`,
  an Angular `input` named `kind`, a `kind` signature in a file under
  `/libs/ui/icons/src/lib/manifest/`, one outside `include`; invalid — `kind`,
  `type`, `status`, `'kind'` as keys of an interface, a type alias and an
  inline `computed<{ kind: … }>`.

### 3.4 The canary proof (G1 records it; G2 re-runs it)

For each rule: (a) the RuleTester spec passes (`pnpm nx run lint-rules:test`,
the target that runs `ecs-syntax.spec.mjs`); (b) **known-bad run** — the
rule applied to the pre-cleanup files at `c77e932` lists exactly the sites
of §1.2/§1.3/§1.4: `git show c77e932:<path> | pnpm exec eslint --stdin
--stdin-filename <path> --rule '…'` for each listed path (or a node script
running `ESLint#lintText` over the `git show` contents), and the count is
recorded in §8.1; (c) **canary files, both invocation paths** — a temporary
`__canary__.ts` with one class, one `Date.now()` and one `kind:` signature
(and, since §3.5, one hand-built `{ loadState: LoadState.Loading }`),
placed in turn in one feature lib (`libs/features/shared/visits/src/lib/`),
one ui lib (`libs/ui/controls/src/lib/`), `apps/showcase/src/app/` and
`apps/web/src/app/`, must be flagged once per rule (three times; four since
§3.5) BOTH by
`pnpm nx lint <project>` (the executor: base = workspace root) AND by
the eslint bin run from inside that project's directory —
`node "$ROOT/node_modules/eslint/bin/eslint.js" __canary__.ts` (directory
lookup: base = the project dir, the IDE's path; NOT `pnpm exec eslint`,
which pnpm runs from the workspace root whatever the cwd — measured by G2,
so it never exercises lookup; runbook §4.9 5c, the §4.8 gate 9 precedent);
plus `--print-config <file>` through the same bin from inside each project
showing the rules at severity 2, and for a file under
`libs/ui/icons/src/lib/manifest/` — from the root and from `libs/ui/icons` —
showing `no-generic-discriminator` at 2 with the file allowed by its option
(a `kind:` signature there NOT reported). Never a root-only `--print-config`
or `--stdin` run as the proof: it sees one base path only. Each canary is
deleted afterwards; (d) after wave 1, `pnpm nx run-many -t lint` is clean
with the rules on.

### 3.5 `creativo/no-hand-built-load-slice` (the review fixes)

- **Rule.** Reuse, never copy (UR-2): a `LoadSlice` is built by its
  companion — `LoadSlice.ready(data)`, `LoadSlice.loading`,
  `LoadSlice.failed`, `LoadSlice.empty`. Reports an `ObjectExpression` that
  IS a load slice and nothing else: exactly `{ loadState: LoadState.Ready,
data: … }` (shorthand `data` and either order included) or exactly
  `{ loadState: LoadState.Loading | Failed | Empty }`. Not reported: any
  other field or a spread (a paging or page state — `{ ...LOADING_HISTORY,
loadState: LoadState.Ready }`, the ledger and visits page states — is a
  different slice type), a `loadState` that is not a `LoadState.<member>`
  read, a computed key, a getter.
- **Scope.** The shared `files`/`ignores`; `include` as in 3.2 and
  `allowIn: ['/libs/shared/view-state/']` (the companion's home builds the
  variants).
- **Flags on `474e771`:** 23 — `client-card.store.ts` 21,
  `wallet.presenter.ts` 1, `loyalty.presenter.ts` 1; each became
  `LoadSlice.ready(…)` (a fresh object per call, as the literal was — no
  signal-equality change). The fixtures of
  `client-card/src/testing/client-pages.vm-fixtures.ts` (outside the
  production scope) were converted too.
- **Spec** `no-hand-built-load-slice.spec.mjs`: valid — the companion, a
  spread, extra fields (ledger, paging), READY without data, data beside a
  non-READY member, a variable state, a computed key, a getter, another
  dictionary, the view-state lib, outside `include`; invalid — each of the
  four members, shorthand and string keys, either order, a slice nested in a
  page state, `libs/shared` outside view-state, no `include`.

---

## 4. Packages

Ownership is by FILE. A package edits only its own files; where it needs a
change in another package's file it states the contract (§2) and the owner
makes it. Every package: `pnpm nx run-many -t typecheck --skip-nx-cache
--projects=<own>`, `lint`, `test` on its projects, the specs it re-targets
listed in §11.2 (before → after, same intent), and a hand-over note of every
`@case`/attribute it re-bound and how its DOM value was preserved.

### P0 — the shared vocabulary · wave 0 (ALONE)

**Files (new):** `libs/shared/view-state/**` (project via
`pnpm nx g @nx/js:library` — use the `nx-generate` skill if the session has
it, else mirror `libs/infrastructure/clock`'s config: `project.json` tags
`scope:shared`, `type:util`; nested `eslint.config.mjs` importing
`#eslint-config`; `tsconfig*.json`; `vite.config.mts`), with
`src/index.ts`, `src/lib/load-state.data.ts`, `load-slice.data.ts`,
`paging-state.data.ts`, `load-state-words.ts` and their specs;
`libs/infrastructure/i18n/src/lib/visit-list-words.ts` + its spec
`visit-list-words.spec.ts`; `libs/features/staff/dashboard/src/lib/row-verb.ts`,
`tag-words.ts` (+ `tag-words.spec.ts`); `libs/ui/wall-clock/**` (project
config mirrored from a sibling `libs/ui/*` lib, tags `scope:shared`,
`type:ui`, nested `eslint.config.mjs` importing `#eslint-config`;
`src/index.ts`; `src/lib/wall-clock.ts` + `wall-clock.spec.ts` MOVED from
the visits lib, §2.6).
**Files (edited):** `tsconfig.base.json` (`"@creativo/shared/view-state":
["./libs/shared/view-state/src/index.ts"]`, `"@creativo/ui/wall-clock":
["./libs/ui/wall-clock/src/index.ts"]`); `docs/architecture/module-boundaries.md`
(two rows: `view-state` — "zero dependencies; feature/ui/app may import";
`ui-wall-clock` — "`@core/primitives` only; feature/ui/app may import");
`libs/infrastructure/i18n/src/index.ts`;
`libs/features/shared/visits/src/index.ts` (drops `export * from
'./lib/wall-clock'`); the IMPORT LINES ONLY of every wall-clock importer
listed in §2.6 (16 files across P1–P5/P7's projects — safe because wave 0
runs alone; no other edit in them);
`libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts`
— ONLY the move of `ArrivalVerb`/`RowVerb`/`ROW_VERB_WORD` (lines ≈232–253)
into `row-verb.ts`, the import back, and the wall-clock import line (no
other edit).

**Brief.** (1) Write §2.1 exactly; JSDoc each member. If a root `.data.ts`
guard rejects a construct (the `as` on the constants, the generic), switch
to the guard-clean form and record it. (2) Specs: `LoadState` values pinned
and SCREAMING; `LoadSlice` constructors return the right `loadState` and
`ready(x).data === x`; `dataOf` over all four states and `null`; a type-spec
proving `LoadSlice.WithEmpty<T>` narrows on `loadState` and that
`LoadSlice<T>` excludes `EMPTY`; `PagingState` values pinned; `loadStateWords`
pinned byte for byte. (3) §2.2 tables, each `as const satisfies Record<Tag,
string>` with computed keys, each pinned by its spec (the five filter words,
two grain words, two perspective words in i18n; three grid words, four query
words in the dashboard's `tag-words.ts` — the strings the DOM and the
`visits.filter.*` keys print today). (4) The wall-clock lib (§2.6): move the
file and its spec unchanged, re-point every importer's import line, then add
`formatWallClockRange` with a spec comparing it, for bg and en and three
ranges (same month, across months, across years), to today's `day-range.ts`
output (call the old path in the spec through a local copy of `noonOf`
written inside the spec — the spec is the only place a `Date` may appear).
(5) `row-verb.ts`: verbatim move, `export` added; `staff-dashboard.ts`
imports it. (6) The §2.8 name check: grep each new dictionary name of §2.8
against the exports of the six `@core/*` barrels and `@core/testing`;
record "no collision" in the hand-over (a hit is a rename of the §2.8 row,
reported back to the integrator before wave 1). (7) `pnpm nx sync`,
`pnpm nx sync:check`, `pnpm nx run verify-tools:layering --skip-nx-cache`,
typecheck/lint/test of `view-state`, `ui-wall-clock`, `i18n`,
`shared-visits`, `staff-dashboard`, and `pnpm nx run-many -t typecheck
--skip-nx-cache` (the moved file's 16 importers must still typecheck —
the tree is otherwise unchanged).

### P1 — the visits lib: the shim, the row and card models, the clock · wave 1

**Files:** every file under `libs/features/shared/visits/src/**` (P0 has
moved `wall-clock.ts` out to `@creativo/ui/wall-clock`; a needed change
there is asked of the integrator, not made) — in particular `visit-ecs.shim.ts` (deleted),
`visit-row.vm.ts` (+ `visit-row.vm.spec.ts`), `visit-row.presenter.ts`
(+ spec), `visit-filter.ts` (+ spec), `visit-sections.ts` (+ spec),
`visit-card/*`, `visit-row/*`, `visit-list/*`, `visits-browser/*`
(`visit-pills.ts` only if it reads a changed type), `visit-filter-menu/*`,
`event-head/staff-event-head.ts` (+ spec), `day-range.ts` (+ spec),
`testing/visit-fixtures.ts`, `src/index.ts`.

**Brief.** Implement §1.1 and §2.3/§2.5 for the lib. (1) Delete the shim;
replace each table by the ecs-core dictionary and the §2.2 words tables.
(2) `VisitRowVm`, `VisitTrailing`, `VisitTrailingFact`, `VisitCardVm` per §2.3;
`VisitRowVariant`, `variant?`, `photos?` deleted; the "frozen" comments go.
(3) `visitRowOf`/`waitlistRowOf`/`visitCardOf` take `now` + `timeZone`; no
zone lookup for "now"; the photo day zone `visitZoneOf(…) ?? options.timeZone`;
the waitlist row's `localDate`/`startMinutes` per §1.1 with the
`WAITLIST_UNDATED` sentinel built from existing constructors (never a throw).
(4) Every bare literal → dictionary member (`VisitRowOutcome.Worked`,
`VisitGrain.Month`, `VisitPerspective.Staff`, `VisitFilter.All`,
`CancelledSide.Client`); templates get the dictionary as a protected field.
(5) `visitClockOf` (§2.5) replaces both classes; the card's call sites
`:63`, `:153` (`dayShort`), `:175` (`whenHeard`); the local `distinct`
replaced by the exported one. (6) `data-perspective` via
`visitPerspectiveWords`; `data-kind` via `visitCardSlotWords`; section and
filter test ids via `visitGrainWords`/`visitFilterWords`; `data-status` via
`bookingStatus`. (7) `hollowStatus` on `BookingStatus`; `day-range.ts` on
`formatWallClockRange`. (8) Specs re-targeted per §5.2 (the DOM assertions
byte-identical; `visit-row.vm.spec.ts`'s five-words pin becomes a pin on
`visitFilterWords`). Gate: `shared-visits` typecheck/lint/test; then
`pnpm nx run-many -t typecheck --skip-nx-cache` to list the consumers it
breaks (expected: P2/P3/P4a/P4b files only) for the hand-over.

### P2 — the client libs: appointments, account, profile · wave 1

**Files:** `libs/features/client/appointments/src/lib/appointments.store.ts`
(+ spec), `client-appointments/client-appointments.ts`, `.html`, `.spec.ts`,
`visit-vm.ts`, `visit-ics.ts` (+ spec); `libs/features/client/account/src/lib/client-account/client-account.ts`,
`.html`, `.spec.ts`; `libs/features/client/profile/src/lib/client-profile/client-profile.ts`,
`.html`, `.spec.ts`.

**Brief.** (1) appointments store: `AppointmentsViewState`/`UpcomingListState`
→ `LoadState`/`LoadSlice` (§1.2 row 7); `appointmentsStateWords` keeps
`data-state`; the client page stops translating to `VisitListState` WORDS
but keeps its words gate (§1.2 row 7: `listState` is `LOADING` while
`this.words() === null`, `FAILED` passes through, `isEmpty` on
`LoadState.Ready`) — pinned by a NEW `client-appointments.spec.ts` case «stays
loading, never empty, until the catalogue words load» (store READY with one
appointment, words not yet loaded: `data-state` and the list say loading, the
empty state is absent; then words load: ready, one row). (2)
`client-appointments.ts`: `VisitFilter.All`, `VisitPerspective.Client`,
`VisitGrain.Month`; `now: this.store.now()` + `timeZone` (the store's zone)
with a null guard returning `[]` (the list already waits on the zone);
`visitSectionKey(today, VisitGrain.Month)` (≈796, 1107); `toVisit` reads
`row.trailing !== null` instead of `row.trailing.kind === 'barber'`.
`ClientVisitVm.status` → `bookingStatus` (row 6; `.html` 395–396). (3)
`visit-ics.ts` §1.4 — the spec pins the output byte for byte (add a case with
non-zero seconds in DTSTAMP if none exists). (4) client-account: rows 4 and
§1.4: `CLOCK_PORTS` + `ShopZoneService`; the card's zone is the shown
appointment's OWN location zone, `zoneOf(appointment.locationId)` read once
per shop (a resource keyed on the `locationId` alone — review fix; first
keyed on the appointment id, which flashed the skeleton when a sooner visit
at the same shop replaced a drawn card), and
`ShopNow = ZonedTimeSystem.shopNow(openedAtUtcMs, zone)` with `openedAtUtcMs`
read once from the clock; `NO_CATALOGUE` gets `locationTimeZone: () => zone`;
`upcomingCard` stays null while the zone read is pending and
`upcomingState()` keeps reporting `LOADING` (printed `'loading'`) for a
populated-but-undrawn card — DEP-4; a FAILED zone answer makes
`upcomingState()` `LoadState.Failed` (printed `'error'`, the card's
existing repository-failure alert line, via `translateRepositoryError()`)
— DEP-5, never `LOADING`
forever; `visitCardSlot: VisitCardSlot.Next`, `VisitPerspective.Client`.
The host `data-state` (161) prints `loadStateWords[accountLoading() ?
LoadState.Loading : LoadState.Ready]` (§1.2 sentinels — same two words).
Spec: provide `CLOCK_PORTS` pinned to a 2026 instant (the fixture visit is
2030-01-01, so the card keeps its year and no «днес») and a
`ShopZoneService` double resolving `Europe/Sofia` the way sibling specs do;
NEW cases: «a pending zone read keeps data-upcoming="loading"» and «a failed
zone read shows data-upcoming="error", never loading forever» (the double's
`zoneOf` resolving a failed answer). (5) client-profile: row 5 (`ProfileEditField`, `pageState`
→ `LoadState` + `loadStateWords`), the date-field blur payload (§1.2 row 43
contract, `uiDateFieldFill`), `birthDateLabel` §1.4 (the same non-reactive
`getActiveLang()` read; a bg and an en pin of the label added if none
exists). Gate: the three
projects; e2e contracts `account-dashboard*.spec.ts` and `appointments*.spec.ts`
read the same attribute values (record a grep of the asserted values).

### P3 — the staff client card · wave 1

**Files:** every file under `libs/features/staff/client-card/src/**`
(production, specs, `testing/`).

**Brief.** (1) Delete `CardLoadState`/`Slice<T>`; every reader on
`LoadState`/`LoadSlice` with field `loadState` (row 22) — `loadStateOf` and
the store's helpers keep their truth tables. (2) `VisitsPageVm.loadState`
(rows 23, 26): `visitsPageBlank(LoadState.Loading|Failed)`; the two
translations disappear; the `visits()` truth table is identical (§9 R-1).
(3) Paging (row 24): `pagingState` everywhere; the store's `more` →
`pagingState: Exclude<PagingState, typeof PagingState.End>` (`'idle'` →
`MORE`). (3b) The bare load-word sentinels (§1.2, after the table):
`tierInputs`' `'loading'` and the record read's `'failed'` on
`LoadState`/`LoadSlice`, same truth tables. (4)
Achievements and records (rows 20, 21) after checking R-6. (5) Rows 25, 27:
`BirthdayMoment` + `birthdayMomentWords` (birthday-card host `data-kind`);
`personalRecordKind` + `RECORD_KIND_WORDS` where printed (testids,
`data-kind`, `record-card.ts`); `WalletHolding`; `couponOccasion` and
`COUPON_OCCASION_OF` deleted. (6) Visits: the store derives `visitNow =
computed(() => zone === null ? null : ZonedTimeSystem.shopNow(utc(_nowMs()), zone))`
once; `HistoryRowsInput.now`/`timeZone` (§2.4); `visitTitles`/`visitBarbers`
file by `row.localDate` (no `shopDayOf`); `VisitRowOutcome.Worked`,
`VisitRowEntry.Visit`, `VisitFilter.All`; `glance.presenter.ts` sorts upcoming
by `LocalDate.compare(a.localDate, b.localDate) || a.startMinutes - b.startMinutes`
(never subtracting instants); `visitCardSlot` for `'last'`/`'next'`;
`client-card.presenter.ts` `lastWorkedVisit` on the dictionary;
`client-card.words.ts` `visitWordsOf(…, VisitPerspective.Staff)`;
`visits-page.presenter.ts` and `history.presenter.ts` on the dictionaries.
(7) `client-card.format.ts`, `glance.presenter.ts` §1.4. (8) Fixtures
(`client-pages.vm-fixtures.ts` ≈71 kind/status lines, `client-card.fixtures.ts`,
the rig) re-targeted to the new names; the stale lower-case `status:
'completed'|…` of hand-built rows become `bookingStatus: BookingStatus.*`
(staff rows render no `data-status`; R-5), and every hand-built
`startMs: Date.UTC(…)` (`client-pages.vm-fixtures.ts` ≈131, 2208, 2230,
2418, 2430, 2454, 2471, and any other the re-target finds) converts by its
SOFIA wall time — the meaning `wallTimeOf` gave it — into `localDate` +
`startMinutes` (`ZonedTimeSystem.toLocal(startMs, SHOP_TIME_ZONE)` or the
hand-computed value: `Date.UTC(2026, 8, 5, 7)` is 10:00 in Sofia, so
`startMinutes` 600, never 420), each before → after recorded in §11.2, so
same-day row order inside a section is unchanged. Gate: `staff-client-card`
typecheck/lint/test (alone — it times out under `--parallel=3`).

### P4a — the visit editor · wave 1

**Files:** `libs/features/staff/dashboard/src/lib/visit-editor/**`
(`staff-visit-editor.ts`, `.html`, `.css`/`*.css`, `.spec.ts`,
`client-query.ts`, `client-query.spec.ts`, and any other file in the folder).

**Brief.** §1.2 rows 32–42, §1.4 editor rows, §1.5 editor halves, the
editor's call site of `injectFrameFullscreen` (`:129` import, `:1970`), the
`lastVisitDate` reader (≈6992–7010: max by `(localDate, startMinutes)` among
`VisitRowOutcome.Worked` rows; format with `formatWallClock(localDate, null,
lang, { day: 'numeric', month: 'long', ...year })` where `year` follows
`LocalDate.parts(localDate).year` vs `todayKey` exactly as today — same bg
and en text), `visits().loadState === LoadState.Ready` (≈6995). Inject
`CLOCK_PORTS` for the id stamps and the photo name (UR-11). `data-page`,
`data-verdict`, `uiIconKind` keep their values through `editorPageWords`,
`frameVerdictWords`, `clientQueryShapeWords` (the dashboard's
`tag-words.ts`); the new-client test ids through `clientQueryShapeWords`
(row 37, pins 3157/3161/3253/3256/3335 unchanged); the grant option's
`couponOccasion` field and the ≈6525 pass-through (row 27); the frame event
≈2477 `bookingStatus: vm.bookingStatus` + `draftNew: true` when it is
`null` (rows 31/34). Every type exclusion names the member
(`Exclude<ClientQueryShape, typeof ClientQueryShape.Empty>`). Spec: add `{ provide:
CLOCK_PORTS, useValue: memoryClockPorts(…) }` to the main TestBed (≈470; the
second at ≈6825 already has one); every selector (`[data-page="service"]`, …)
unchanged; NEW case «a new visit's frame block keeps data-status="new" and
data-editable» (the grid event of the editor's frame for an unbooked visit).
Gate: `staff-dashboard` typecheck/lint/test (alone).

### P4b — the staff day: dashboard page, grid, timeline, gestures, block editor · wave 1

**Files:** every file under `libs/features/staff/dashboard/src/**` NOT in
P4a: `staff-dashboard/*` (P0's move already landed), `staff-day.store.ts`
(+ spec), `time-grid/**` (incl. `grid-gesture.ts`/spec, `staff-time-grid.*`
incl. CSS), `timeline/**`, `block-editor/**`, `day-pill/**`,
`shared/frame-fullscreen.ts`, `lane-gaps.spec.ts`, and any other non-editor
file of the lib.

**Brief.** §1.2 rows 28–31, 33/34 producer halves (`staff-dashboard.ts` 4147
`bookingStatus: row.bookingStatus`, 5447 `bookingStatus: null`;
`actFromEditor(appointmentId, verb: RowVerb)` with the inverse lookup gone),
§1.3 `EdgeScroller` and `FrameFullscreen` (+ the block editor's call site
`:70`, `:1041`), §1.4 dashboard/day-pill/grid-gesture rows, §1.5 grid and
verb halves, `staff-day.store.ts` ≈1636 `couponOccasion: coupon.couponOccasion ?? null`
on `VisitEditorGrantOption` (the `'birthday'` ternary deleted; row 27).
Also: row 36's producer — `resolutionOf` ≈3395 emits `bookingStatus: status`
(narrowed to Cancelled|NoShow), the `bookingStatusWords` hop deleted; row
32's second reader — `searchClients` ≈5797 `parsed.clientQueryShape !==
ClientQueryShape.Empty`; row 28's agenda `hollowStatus(entry.bookingStatus)`
at `.html` 764/852 (no words table) + a NEW cancelled-card strike assertion
beside `staff-dashboard.spec.ts` ≈3025; row 45 `CreateIntent` for
`openCreate`; row 31's `draftNew` print (`gridStatusWord`) and the six
`ResizeEdge` edge sites with their template call sites; `day-pill` per §1.4
(every branch verbatim, `civilMs` for `noonOf`, pinned by
`staff-day-pill.spec.ts` 39–52). `DragGesture` (a type alias over
`EditCommand.Move | ResizeEdge`) and `PlacementVerdict` declared ONCE in
`grid-gesture.ts`, imported by grid and timeline (the two copies
deleted). CSS selectors on `data-kind`/`data-status` keep matching (the words
tables print the same strings; the new-visit frame keeps `data-status="new"`
through `draftNew`). NEW `staff-time-grid.spec.ts` case: an event with
`bookingStatus: null, draftNew: true` prints `data-status="new"`, one with
`bookingStatus: null` and no flag prints none. `grid-gesture.spec.ts` re-targeted to
`edgeScrollerOf` (naming only; its frame and scrollTop assertions unchanged).
Gate: `staff-dashboard` typecheck/lint/test (alone, after P4a's files are in
the tree — the integrator runs it on the assembled lib).

### P5 — marketing, landing, catalog, shell · wave 1

**Files:** `libs/features/marketing/careers/**`, `marketing/courses/**`,
`marketing/events/**`, `marketing/landing/**` (incl. `content/*`,
`pages/home/locations/*`, `sections/services/service-tile.component.ts`,
`test-catalog.providers.ts`, specs), `libs/features/shared/catalog/**`,
`libs/features/shared/shell/**`.

**Brief.** §1.2 rows 1–3, 13–16; §1.4 menu, footer, locations, dead service
methods. The shell's menu imports `formatInstant` from
`@creativo/ui/wall-clock` (a `type:ui` lib — no feature → feature edge)
and the footer `ageDayOf` from `@creativo/features/client/account-state`
(already a shell dependency) — since the review fix, the footer reads the
default location's zone through `ShopZoneService.defaultZone()` instead
(DEP-2, OQ-2). Specs: `site-menu.component.spec.ts` ≈637–650
replaces the fake-`Date` pin with `memoryClockPorts(utcMs('2026-09-17T07:00:00Z'))`
and keeps expecting «чт, 17 септември»; add a `CLOCK_PORTS` provider to
`site-footer`, `site-header`, `marketing-careers`, `marketing-courses`,
`locations.component` and any spec the test run reports with a
`NullInjectorError: CLOCK_PORTS` (`home.page.spec` stubs its imports);
`locations.component.spec`: the NEW cases of §1.4's locations row (Sunday,
19:10, 08:30, 20:30 Sofia instants via `memoryClockPorts`, each asserting the
status line text and the bold `li[data-selected]` row) — today the spec pins
neither, so these are what proves DEP-1 kept the screen; the zone comes from
`LOCATIONS[].timezone` joined by `locationId` (no literal in the component).
Gate: the projects; `marketing-landing` alone.

### P6 — admin, auth, booking · wave 1

**Files:** `libs/features/admin/loyalty/**`, `libs/features/admin/programs/**`,
`libs/features/client/auth/**`, `libs/features/client/booking/**`.

**Brief.** §1.2 rows 8–12 with the §2.8 names (row 9 is `ShopCoverage` on
`shopCoverage`, variant union `ShopCoverageVerdict` — the ecs-core
`ShopReach` the lib also imports is untouched); `admin-rhythm.words.ts` §1.4
(`noonOf` copy → `formatWallClock` from `@creativo/ui/wall-clock`). No
date-field work: `client-auth` binds only the phone field's `uiBlurred`
(row 43). Gate: the four projects.

### P7 — ui libs, showcase, onboarding · wave 1

**Files:** `libs/ui/controls/src/lib/date-field/*`, `month-picker/*`,
`weekday-picker/*`, `phone-field/*` (only the typeahead line + spec if
needed); `libs/ui/patterns/src/lib/toast/*`;
`libs/ui/icons/src/lib/registry/icon-registry.service.ts` (+ spec only if it
names the class); `libs/ui/controls/src/index.ts` (export `UiDateFieldFill`);
`apps/showcase/src/app/pages/controls/menu/menu.page.ts`;
`libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.ts`
(+ `.html`) — the blur reader only; `docs/design-research/icon-registry-design.md`
:264.

**Brief.** §1.2 row 43 (`UiDateFieldFill` on `uiDateFieldFill`, a DS
dictionary exported from `@creativo/ui/controls`); §1.3
`ConsoleUiIconReporter`; §1.4 ui and showcase rows — the month picker, the
weekday picker and the showcase menu page all format through
`@creativo/ui/wall-clock` (`formatWeekdayLabels` for the Monday-first short
heads, `formatWallClock` for the title and the long weekday), adding NO cache
or formatter of their own; `relativeDay` per DEP-3; the existing spec pins
`uiToday`, and the showcase passes `TODAY`.
`apps/showcase/…/controls/date-field/date-field.page.html` renders
`ui-date-field` without binding `uiBlurred` — no change. Gate: `controls`,
`patterns`, `icons`, `client-onboarding`, `showcase` projects;
`pnpm icons:check`.

### G1 — the three rules, authored and specced · wave 1

**Files:** `tools/lint-rules/no-undecorated-class.mjs` (+ `.spec.mjs`),
`no-ambient-clock.mjs` (+ `.spec.mjs`), `no-generic-discriminator.mjs`
(+ `.spec.mjs`), `tools/lint-rules/index.mjs` (registration only).

**Brief.** §3.1–§3.3 exactly, including the §3 Scoping contract: each rule
reads `include`/`allowIn`/`allowRandomIn` path-fragment options against
`context.physicalFilename` (normalised to `/`), never relies on a `files`
glob for scope, and its RuleTester spec has `filename:` cases inside and
outside `include` and on every allowlisted path. §3.4 (a) and (b) recorded
in the hand-over (the known-bad counts per rule, per file, against
`c77e932`, run with the options G2 will pass). Do NOT touch
`eslint.config.mjs`. Gate: `pnpm nx run lint-rules:test` (or the target that
runs `ecs-syntax.spec.mjs`), `pnpm nx run-many -t lint --projects=lint-rules`.

### G2 — the guards on, the runbook gate, the docs · wave 2

**Files:** `eslint.config.mjs` (root); `docs/architecture/firestore-runbook.md`
(§4.7 exemption lines, new §4.9); `docs/architecture/HANDOFF.md` (§3.3
carried-forward list, §4 reference numbers left for the integrator);
`docs/architecture/flips/phase-4b-delete.md` (OQ 15 closure note, one line);
`docs/architecture/module-boundaries.md` (only if P0's row needs the guard
note).

**Brief.** (1) Root config: three blocks per §3 — each `files: ['**/*.ts']`
with the `**/` ignores, the scope and allowlists passed as rule OPTIONS
(`include`, `allowIn` — the two clock adapters, the icon manifest —
`allowRandomIn` — the media cache and confetti), each entry commented with
its reason; no repo-root-relative glob, no second path block. Also correct
the stale comment at `eslint.config.mjs` ≈268–285 ("Nx runs each project's
`lint` target with `cwd` set to that project's own directory") to say the
`@nx/eslint:lint` executor runs from the workspace root with
`overrideConfigFile`, while directory lookup uses the project dir — the
reason the new rules scope by filename (comment only; §10 OQ-12 records the
consequence for ecs-core's tier blocks, not changed here). (2) Runbook §4.7: delete the two
`':!libs/features/shared/visits/src/lib/visit-ecs.shim.ts'` exemptions (the
zone-literal gate ≈924 and the tenant-zone gate ≈930) and re-word the ≈899
comment; add §4.9 (§6 below) with its known-bad run against `c77e932`. (3)
HANDOFF §3.3: the four residue items (the shim, the `kind`/`status`
unions, the undecorated classes, the ambient clock) move from "carried
forward" to a "UI residue cleanup" paragraph pointing at this plan; the
remaining carried items stay listed — UR-13 c (the instant threads and the
named raw-id fields), the tools classes, the manifest, and the
**view-model pass** (UR-13 f: the presenter/vm mapper layer — HANDOFF's
"frozen visit view models (the view-model pass)" line is reworded to that
layer, NOT marked closed). Re-word the
sentence that explains why the root class guard stays on the ECS suffixes
(the new rule now covers every production file). (4) §3.4 (c) and (d) —
both invocation paths. Gate: `pnpm nx run-many -t lint` clean; §4.9 PASS
(gates 1–8); §4.7 PASS.

---

## 5. Specs

### 5.1 Deleted

None. (The shim had no spec of its own; its behaviour is pinned by the
visits specs, re-targeted.)

### 5.2 Re-targeted (same intent, new subject — §11.2 lists before → after)

- `visit-row.vm.spec.ts` :21–26 — pins `VisitFilter` = five lower-case
  words; intent "the test ids keep the five words" → pins `visitFilterWords`
  values (the five words) and that `VisitRowVm['outcome']` is
  `VisitRowOutcome | null` from `@core/systems`.
- `visit-filter.spec.ts` (≈38 filter literals), `visit-sections.spec.ts`
  (grain ×13), `visit-row.presenter.spec.ts` (outcome ×36, filter words ×25,
  `startMs` ×4, `nowMs`), `visit-list.spec.ts`, `visit-filter-menu.spec.ts`,
  `visits-browser.spec.ts`, `visit-card(.presenter|.vm).spec.ts`,
  `visit-row.spec.ts`, `staff-event-head.spec.ts` (hollowStatus inputs),
  `day-range.spec.ts` (if present) — dictionary members for literals,
  `localDate`/`startMinutes` for `startMs`, `now` from
  `ZonedTimeSystem.shopNow(<fixture instant>, VISITS_TIME_ZONE)` for `nowMs`,
  `bookingStatus` for `status`; every DOM assertion (`data-perspective`
  `'staff'`/`'client'`, `data-kind`, `data-status`, `history-month-*`,
  `*-filter-no_show`) byte-identical.
- client card: `client-pages.vm.spec.ts`, `visits-page.presenter.spec.ts`
  (61 filter words, 18 load-state literals), `client-card.store.spec.ts`
  (21), `ledger.presenter.spec.ts`, `glance.presenter.spec.ts`,
  `history.presenter.spec.ts`, `medal-detail.presenter.spec.ts`,
  `achievements-page-state.spec.ts` (6), achievement category/detail/tile
  specs, `client-records`, `client-history.spec.ts`, `client-card.spec.ts`,
  `client-card.contracts.spec.ts`, `client-card.words.spec.ts`.
- dashboard: `staff-dashboard.spec.ts` (outcome/`startMs`, grid kinds, the
  five `openCreate('booking'|'block')` calls → `CreateIntent.*`),
  `staff-day-pill.spec.ts` 39–52 (unchanged — the pin of every branch),
  `staff-visit-editor.spec.ts` (+ `CLOCK_PORTS`; the new-client test-id
  assertions 3157/3161/3253/3256/3335 unchanged), `client-query.spec.ts`
  (`clientQueryShape` for `kind`), `staff-time-grid.spec.ts`,
  `staff-timeline.spec.ts`, `grid-gesture.spec.ts` (`edgeScrollerOf`),
  `lane-gaps.spec.ts`, `staff-day.store.spec.ts`.
- client: `client-appointments.spec.ts` (filter words → members; DOM
  assertions unchanged), `appointments.store.spec.ts`, `client-account.spec.ts`
  (+ `CLOCK_PORTS`, zone double), `client-profile.spec.ts`, `visit-ics.spec.ts`.
- marketing/shell: `marketing-careers/courses/events.spec.ts`,
  `locations.component.spec.ts`, `site-menu.component.spec.ts` (clock pin),
  `site-footer.component.spec.ts`, `site-header.component.spec.ts`,
  service row/detail/tile specs (`compositionKind`).
- admin/auth/booking: `admin-rhythm.words.spec.ts`, admin rhythm and
  programs specs, `booking-schedule-step.spec.ts`, `client-auth.spec.ts`.
- ui: `date-field.spec.ts`, `month-picker.spec.ts`, `icon.spec.ts` /
  `icon-registry.service.spec.ts` (only if they name the class).

### 5.3 New

- `libs/shared/view-state/src/lib/*.spec.ts` (+ one `.type-spec.ts`) — §4 P0 (2).
- `libs/infrastructure/i18n/src/lib/visit-list-words.spec.ts` and
  `libs/features/staff/dashboard/src/lib/tag-words.spec.ts` — §4 P0 (3).
- `libs/ui/wall-clock/src/lib/wall-clock.spec.ts` (moved) + case(s) for
  `formatWallClockRange` — §4 P0 (4).
- `visit-row.presenter.spec.ts`: «one clock for rows and cards» — the card
  faces `dayShort`/`weekdayAndDay`/`whenHeard` against today's CardClock
  strings (bg, en, this year and another year); «a waitlist row with no
  watched day files first in the upcoming run without throwing».
- `visit-card.spec.ts`: «data-kind keeps its lower-case word for every slot».
- `staff-time-grid.spec.ts`: «data-kind and data-status keep their
  lower-case words» (one event per `GridEvent` value, one per status, plus
  `bookingStatus: null` + `draftNew` → `new` and `null` alone → no attribute).
- `staff-visit-editor.spec.ts`: «draft seat and guest ids keep the
  draft-/guest- formats» (regex over the minted ids); «a new visit's frame
  block keeps data-status="new" and data-editable».
- `staff-dashboard.spec.ts`: a cancelled agenda card is struck and untagged
  (beside the no-show case ≈2979/3025).
- `client-appointments.spec.ts`: «stays loading, never empty, until the
  catalogue words load».
- `client-account.spec.ts`: «a pending zone read keeps
  data-upcoming="loading"»; «a failed zone read shows data-upcoming="error",
  never loading forever» (DEP-5).
- `client-profile.spec.ts`: the birth date label in bg and en (if no case
  prints it today).
- `locations.component.spec.ts`: the four Sofia-instant cases of §1.4 (the
  status line text and the bold today row).
- `client-card.store.spec.ts`: «visits() is LOADING, never FAILED, while the
  default zone is pending».
- `tools/lint-rules/no-undecorated-class.spec.mjs`,
  `no-ambient-clock.spec.mjs`, `no-generic-discriminator.spec.mjs` — §3,
  each with `filename:` cases inside/outside `include` and on every
  allowlisted path.

---

## 6. The grep gate — runbook §4.9 "UI residue cleanup"

Run under bash after the §4.0 preamble (its `gate` helper). Each line is
dry-run against `c77e932` first (the known-bad run lists the sites named).

```bash
# 1. The visit shim is gone (known-bad: the file exists).
test ! -e libs/features/shared/visits/src/lib/visit-ecs.shim.ts && echo 'ok  shim deleted' || echo 'FAIL shim present'
# 2. No legacy translation table or shim file in the UI layer (known-bad: the shim's five
#    tables, client-query.ts's two, GRID_EVENT_OF, COUPON_OCCASION_OF — 20 lines).
gate 'ui · no legacy tables' -E "LEGACY_[A-Z_]+|(^|[^A-Za-z0-9_])[A-Z][A-Z_]*_OF = \{" -- libs/features libs/ui apps/web/src ':!**/*.md'
gate 'ui · no shim files' -E "." -- 'libs/features/**/*.shim.ts' 'libs/ui/**/*.shim.ts'
# 3. No zone literal in feature production code but the static landing content (the shim
#    exemption is gone from §4.7 too).
gate 'ui · zone literal' -F "'Europe/Sofia'" -- 'libs/features/**/*.ts' ':!**/*.spec.ts' ':!**/testing/**' \
  ':!libs/features/marketing/landing/src/lib/content/landing-content.ts'
# 4. No kind/status key in a production object literal of features/ui but the CSS height
#    key and the icon manifest (the rule covers type signatures; this covers untyped literals).
gate 'ui · kind/status literal keys' -E "(^|[^A-Za-z_.])(kind|status)[[:space:]]*:[[:space:]]*'" -- \
  libs/features libs/ui apps/web/src ':!**/*.spec.ts' ':!**/testing/**' ':!**/*.md' \
  ':!libs/ui/icons/**' \
  ':!libs/features/staff/client-card/src/lib/client-loyalty/client-loyalty.ts'
#    (client-loyalty.ts: PLACEHOLDER_HEIGHTS.status is a CSS height key, not a discriminator;
#    libs/ui/icons: the manifest wire format and its README/vocabulary, UR-13 a.)
#    Known-bad on c77e932: 190 lines in 31 files — every one converted by a §1.2 row,
#    including the PARAMETER staff-dashboard.ts:5503 `openCreate(kind: 'booking' | 'block')`
#    (row 45, CreateIntent), which the regex also catches; nothing is exempted for it.
# 5. No undecorated class, no ambient clock, no generic discriminator, no hand-built load
#    slice (§3.5, the review fixes): the four rules, proven under BOTH base paths (§3.4 c): `pnpm nx lint <project>` flags a canary in a
#    feature, a ui lib, showcase and web; and, from INSIDE each of those project dirs, the
#    eslint bin (`node "$ROOT/node_modules/eslint/bin/eslint.js"` — never `pnpm exec eslint`,
#    which runs from the workspace root whatever the cwd) with `--print-config <file>` shows
#    each rule at severity 2 and on `__canary__.ts` flags the canary four times (runbook
#    §4.9 gate 5 is the runnable form); the icons manifest probe,
#    from the root AND from libs/ui/icons, shows no-generic-discriminator at 2 with the
#    manifest path allowed by its option. A run from one base path only is not the proof.
# 6. No bare legacy visit word compared in the visits lib or its readers.
gate 'ui · no legacy visit literals' -E "(outcome|grain|perspective|filter)\(?\)?[[:space:]]*[!=]==[[:space:]]*'(open|worked|no_show|cancelled|month|year|client|staff|all|upcoming|completed)'" -- \
  libs/features ':!**/*.spec.ts' ':!**/testing/**'
# 6b. (review fix) No ecs-core discount source or photo origin worded back to a lower-case word
#     (§1.5's two review rows). Known-bad on 474e771: 19 lines; canary `d.source === 'manual'`.
gate 'ui · no worded discount source or photo origin' -E "(source|origin)\(?\)?[[:space:]]*[!=]==[[:space:]]*'(grant|code|manual|shot|library)'|(source|origin):[[:space:]]*'(grant|code|manual|shot|library)'" -- \
  libs/features libs/ui apps/web/src apps/showcase/src ':!**/*.spec.ts' ':!**/testing/**' ':!**/*.md'
# 7. No bare SCREAMING tag compared or cased — every new dictionary is compared against its
#    member (UR-4); DOM tagName checks are not tags. Known-bad on c77e932: 0 (the 2 raw hits,
#    staff-visit-editor.ts:3273 and medal.ts:207, are tagName lines). Canary: a temporary
#    `state() === 'LOADING'` line in a feature file must make it FAIL.
gate 'ui · no bare SCREAMING tag comparisons' -E -e "([!=]==[[:space:]]*|@case \()'[A-Z][A-Z_]{2,}'" --and --not -e "tagName" -- \
  libs/features libs/ui apps/web/src apps/showcase/src ':!**/*.spec.ts' ':!**/testing/**'
# 8. No bare load-state word compared (UR-2: the one LoadState/PagingState vocabulary), outside
#    the DS state signals UR-13 b leaves (the camera capture, the editor's cameraState/codeState).
#    Known-bad on c77e932: 33 lines — every one converted by a §1.2 row or the sentinel list.
gate 'ui · no bare load-state words' -E -e "[!=]==[[:space:]]*'(loading|failed|ready|error|empty|idle)'" --and --not -e "cameraState|codeState" -- \
  libs/features libs/ui apps/web/src apps/showcase/src ':!**/*.spec.ts' ':!**/testing/**' \
  ':!libs/ui/patterns/src/lib/camera/**'
```

**Expected after the pass:** 1 `ok`, every `gate` `ok` (2, 3, 4, 6, 7, 8),
5's probes at severity 2 under both base paths. Record the counts in §8.1 and the runbook status line.

---

## 7. Deletions

- `libs/features/shared/visits/src/lib/visit-ecs.shim.ts` (whole file).
- Types/tables: `VisitRowVariant`; the four lower-case unions of
  `visit-row.vm.ts`; `CardLoadState` + `Slice<T>` (client card);
  `RhythmLoadState` + `Slice<T>` (admin rhythm); `AppointmentsViewState`,
  `UpcomingListState` (renamed table `appointmentsStateWords` survives);
  `VisitListState`; `VisitsPageStatus`; `VisitCardKind`; `ClientQueryKind`,
  `LEGACY_CLIENT_QUERY_SHAPE`, `CLIENT_QUERY_SHAPE_OF`, `toEcs`;
  `GRID_EVENT_OF`; `COUPON_OCCASION_OF`; `EditorPageKind` (renamed
  dictionary); both `DragKind` copies; both `draftVerdict` union copies;
  `UiDateFieldBlurEvent`'s `kind` variants; the booking step's local
  `ShopReach` type (renamed `ShopCoverageVerdict`); `LocationStatus`
  (renamed `ShopOpeningLine`); `VisitEditorGrantOption.occasion`,
  `ClientCardGrant.occasion` (→ `couponOccasion`); the client card's
  `'loading'`/`'failed'` sentinels; `openCreate`'s bare-literal parameter.
- Moved, not deleted: `libs/features/shared/visits/src/lib/wall-clock.ts`
  (+ spec) → `libs/ui/wall-clock/src/lib/`; the visits barrel's
  `export * from './lib/wall-clock'` deleted.
- Classes: `VisitClock` (as a class), `CardClock`, `EdgeScroller` (as a
  class), `FrameFullscreen` (as a class), `ConsoleUiIconReporter`.
- Functions: `toSectionRow`, `filterRowOf`, `shopNowOf`, `wallTimeOf`,
  `utcMsOf`, `zoneOf`, the four `noonOf` copies, `LandingContentService`
  `todayIndexAt`/`isOpenNow`/`weekdayLabel`, the card's local `distinct`.
- Options: `VisitRowOptions.variant`/`photos`/`nowMs`, `VisitCardOptions.nowMs`/`kind`.
- Runbook §4.7: the two shim exemption lines.

---

## 8. Integration and gates

1. **Assemble** wave 0 (P0), run `pnpm nx sync` + `sync:check` +
   `verify-tools:layering --skip-nx-cache` + the P0 projects; then wave 1
   (P1–P7, G1) in any order — typecheck is expected red until all wave-1
   packages are in (the contracts of §2 cross packages); then G2.
   `pnpm nx reset` after the two new libs (`view-state`, `ui-wall-clock`) land.
2. **The full gate of HANDOFF §4**, once, then each red project alone:
   `sync:check`; `verify-tools:layering --skip-nx-cache`;
   `run-many -t typecheck --skip-nx-cache` (only `patterns` red);
   `run-many -t lint` (46 projects now — the two new libs; 0 errors);
   `run-many -t test --parallel=3` (only gauge ×4, visit-pills ×1,
   visits-page.presenter «strikes an hour that did not happen» ×1; re-run
   `staff-dashboard`, `staff-client-card`, `marketing-landing` alone on a
   timeout); `nx test ecs-core --coverage` (unchanged: ecs-core is not
   edited); `nx typecheck seed-tools`; `nx build web` (templates: every
   renamed payload and `@case` surfaces here, not in typecheck);
   `pnpm run verify:bundle` (record the initial size — expected ±1 kB);
   `nx build functions && node tools/verify/p0/check-functions-deps.mjs`
   (unchanged). Re-measure the test totals (new specs add cases; a drop
   without a reason is a lost case).
3. **Grep gates:** §4.0 preamble; §4.2–§4.5, §4.7 (exemptions removed),
   §4.8, §4.9 — each new gate dry-run against `c77e932` first.
4. **Canary:** §3.4 (b)–(d).
5. **Emulator journeys, ONE AT A TIME:** `pnpm run verify:p0`;
   `pnpm run test:emulator` (65 + 255); `pnpm run e2e:web` (exactly 19
   failed — 6 `*-screenshots`, `landing.spec.ts:121`, 12
   `client-card-glance` at `:343`/`:686` — 41 passed;
   `appointments.spec.ts:152` alone with `--repeat-each=3` if it flakes).
6. **Dev-stack smoke** (`pnpm run seed:dev`, `pnpm run dev`; staff sign-in
   per the preview note), bg then en, each with no console error, each
   compared with the same screen on `c77e932` where a doubt arises:
   - **Client appointments list** (`/appointments`): `data-state` passes
     `loading` → `ready` with no empty-state flash while the catalogue words
     load (throttle the network); the filter menu (every option, test ids
     `appointments-filter-*`, the no-show option); month sections
     (`appointments-month-YYYY-MM`); a waitlist row; the cancelled row's
     struck text and `data-status`; the calendar view (month keys, today's
     marker); the `.ics` download (open the file: DTSTART/DTEND/DTSTAMP).
   - **`/account`**: `data-upcoming` `loading` → `populated` (or `empty` for a
     client without visits); the card's words, day and capsule; the
     completion card; the host `data-state` `loading` → `ready`; with the
     appointment's location zone made unreadable (emulator rules swapped),
     `data-upcoming="error"`, never a skeleton forever (DEP-5).
   - **Client profile**: `data-state`, the birth date label, the name and
     birthday edit sheets, the date field's empty/partial blur nudges.
   - **Staff client card** — glance (last/next cards `data-kind`, birthday
     card `data-kind`, records), **history** page (`data-perspective="staff"`,
     `history-year-*` sections, filters incl. «Не дойде» = `no_show_staff`,
     paging foot more/loading/failed/end), **visits** page, loyalty wallet
     holdings, ledger paging, achievements and records pages
     (loading/failed/empty/ready each — provoke failed with the emulator's
     rules swapped as in 4b's smoke).
   - **Staff day grid:** blocks `data-kind` visit/gap/block and masks
     (elapsed/surplus/closed/overlap) styled as before; drag a block to the
     top and bottom edges — **edge auto-scroll** runs and stops; resize
     start/end; the placement verdict hints (short/overlap/outside); the
     agenda's cancelled and no-show cards struck and untagged; the staff
     search's empty query; «＋» → booking / block (`openCreate`); the
     timeline (week) the same; the **frame fullscreen toggle** in the visit
     editor and the block editor (open, Escape, toggle back, recentre).
   - **Visit editor:** a NEW visit's frame block in the grid keeps
     `data-status="new"` + `data-editable` and its primary-ink text
     (`staff-time-grid.block.css:263`), an existing visit's frame its booking
     word, the block editor's frame no `data-status`; every pushed page
     (`data-page` values incl. `clientSearch`, `service`, `photo`), the
     new-client rows' test ids (`staff-visit-new-client-name|phone|email`), the client omnibox icon
     (`data-kind` on the search field) for a name/phone/mail, the frame
     verdict (`data-verdict` conflict/outsideRoster), the discount figure
     percent/amount, a birthday coupon's band on the client card's ticket
     (the `couponOccasion` chain store → editor → card), add a service (draft seat id format in the save
     payload — inspect the callable request), add a guest (`guest-` id),
     take a photo (file name), the status verbs (confirm/arrived/no-show/
     cancel) and their undo toast, «Запиши пак» (rebook).
   - **Admin:** loyalty rhythm page `data-state` loading/ready/failed and the
     estimate/unavailable line; programs editing a position/course/event.
   - **Marketing:** careers/courses/events loading/error/ready; landing
     services (single/bundle tiles, the detail sheet's bundle members);
     the locations panel open/closes-soon line and bold today row (device
     on Sofia time; DEP-1 otherwise); the footer year; the menu's date line
     after reopening.
   - **Booking:** the schedule step's shop reach served/elsewhere/nowhere;
     **auth:** the consent sentence's terms/privacy links.
     Record each check in §8.1.
7. **Records:** §8.1, §11; HANDOFF §2/§3.3/§4 numbers; runbook §4.9 status
   line; then (on the user's go-ahead, HANDOFF §5) one commit "UI residue
   cleanup" on `main`, `pnpm nx reset`.

### 8.1 Integration record

Integrated 2026-10-23 on `main` (HEAD `c77e932`, uncommitted tree) by the
integrator. Every package's files were in the tree as handed over: P0 (wave 0),
P1–P7 and G1 (wave 1), G2 (wave 2). Nothing a package reported missing was
missing at assembly.

**Assembly.** `pnpm nx sync` wrote the project references no package owned:
`@creativo/shared/view-state` into client-appointments, client-account,
client-profile, staff-client-card, staff-dashboard and shared-visits;
`@creativo/ui/wall-clock` into client-profile, ui-controls and the showcase app.
`pnpm nx reset` followed, because the daemon still held the old paths. After
that `sync:check` is clean. The root `tsconfig.json` "missing references" line
that `sync:check` printed is how the generator lists things, not a change: no
project is `composite`, so the root keeps `references: []` (the generator
filters references by `composite`).

**Integrator rulings and fixes**

1. **DEP-5 alert text (P2's open call).** A failed card prints the line it has
   always printed, `errors.ACCOUNTS_REPOSITORY_FAILURE` («Възникна проблем от
   наша страна — моля, опитайте отново.»), whichever read failed. Printing the
   zone answer's own code would show the raw `CATALOG_LOCATION_ZONE_UNKNOWN`
   (neither catalogue has an entry for it), or the SAVE message
   `REPOSITORY_READ_FAILED` for a failed read. The fix:
   `client-account.ts` `upcomingErrorLine()` is deleted and the template calls
   `translateRepositoryError()`, as on `c77e932`. The new failed-zone case
   expects that line. No catalogue key was added. The state and the DOM
   (`data-upcoming="error"`, `role="alert"`) are as planned.
2. **The path-scope helper, moved (G1's proposal).** `PATH_FRAGMENTS`,
   `scopedPath` and `pathScope` now live in `tools/lint-rules/path-scope.mjs`.
   The three rules and the class rule's spec import them from there.
   lint-rules is still 9 files and 221 tests, all passing.
3. **`wall-clock.ts` header.** It now says this is the one set of formatters
   for the web UI. It used to say "Shared by the visit lists, the staff
   client card and the staff day".
4. **`consoleUiIconReporter` spec (P7's optional follow-up).** Two cases:
   a loud reporter goes to `console.error`, a quiet one to `console.warn`, and
   the message shape is pinned.
5. **Docs.** §3.4 (c) and §6 gate 5 of this plan now name the eslint bin run
   through node (G2's measurement), not `pnpm exec eslint`. Runbook §4.8 gate
   9's comment now says how Nx runs ESLint: from the workspace root, with the
   project config passed as `overrideConfigFile`.
6. **No `src/package.json` for view-state (P0).** The lib is four modules of
   plain `as const` objects, so esbuild has nothing to drop, and the marker
   would also need a `.nxignore` entry.
7. **Accepted DOM difference, no readers (P2/P3 hand-overs).** The hosts
   `lib-visits-browser` and `lib-visit-filter` (client appointments, staff
   history, achievement detail) no longer carry the bare `perspective="client"`
   / `perspective="staff"` attribute. Angular used to leave it there from the
   static input binding; the input is now bound as
   `[perspective]="VisitPerspective.*"`. No CSS, spec, e2e test or code reads
   that attribute (grepped). `data-perspective` is the contract, and it is
   unchanged. In the smoke below, this is the only DOM difference from
   `c77e932`.
8. **Bundle.** Initial size is 604.22 kB raw / 164.68 kB transfer, against
   598.08 / 163.87 kB on `c77e932`. The HEAD numbers were measured on a
   `git archive` copy of HEAD built in the scratchpad, with the same builder.
   The difference is +6.14 kB raw and +0.81 kB transfer. A per-module diff of
   the two metafiles puts all of it in Angular's own `resource()`
   implementation: `@angular/core` `_resource-chunk` +6.69 kB and
   `_pending_tasks-chunk` +1.34 kB. `@angular/core` sits in the initial chunk,
   so the app's first `resource()` (client-account's zone read, P2) pulls that
   code in. No workspace module moved by more than ±0.3 kB. Kept: it is a
   one-time framework cost, far below the 975 kB warning budget. Recorded for
   the owner.

**Left as found.** These sit outside the four kinds and no gate flags them;
they are listed in HANDOFF §3.3:

- Lower-case unions compared as bare literals that are not a
  `kind`/`type`/`status` field and not a load state:
  - P4b: `discardPending` (`'visit'|'create'`), the grid's `Placement`
    (`'slots'|'proportional'`), `readoutTone`.
  - The dashboard's `StaffView` (`'agenda'|'day'|'three-day'|'week'`,
    `?view=`).
  - P5: `EventsTab` (`'upcoming'|'past'`) and the menu's `lang() === 'en'`.
  - P6: `ProgramsTab` and the rhythm page's `confirm` switch.
  - P4a: `discountKind()`, `VisitEditorResolution.by`,
    `…codeResult.refusal`, `cameraState`/`codeState` (UR-13 b).
- `.claude/rules/angular-ui.md` still names "the i18n lib" as the home for
  formatting. That is OQ-7, and the text is the owner's.
- A pre-existing defect the smoke surfaced, the same on `c77e932`:
  `StaffDashboard.periodLabel` calls `formatDayPill(days[0])` while
  `visibleDays()` is still empty. This throws «Cannot read properties of
  undefined (reading 'split')» in `noonOf` on HEAD and in `localDateOfKey`
  now, a few times per staff-page load, timing-dependent, and the page
  recovers. It is not a cleanup regression, and fixing it would change
  behaviour.

**Review fixes (the fixer, on `474e771`, 2026-10-23).** Six confirmed
findings, each output-identical except where noted:

1. `@creativo/ui/wall-clock` gains the cached raw-parts face
   `wallClockParts` (`formatWallClockParts` joins it); the day pill's
   `formatDayPill`/`formatDayPillRange` read `formatWallClock`,
   `formatWallClockRange` and `wallClockParts`, and the dashboard's
   `formatTitled` reads `wallClockParts` — no per-call `Intl.DateTimeFormat`
   left in either.
2. `VisitEditorPhoto.origin: 'shot' | 'library'` → `photoOrigin: PhotoOrigin`,
   passed through by `toEditorPhoto`; the template compares
   `PhotoOrigin.Library` (§1.5).
3. `/account`'s card zone resource is keyed on the shown `locationId` alone:
   a sooner visit at the same shop replaces a drawn card straight, as on
   `c77e932` (the per-appointment key flashed the skeleton for one hop);
   DEP-5 reworded, a canary-proven spec added.
4. `VisitEditorDiscount.source` → `discountSource: DiscountSource`, the tag
   end to end (draft, save shape, `discountKey` cases, `samePromise`, the
   dashboard's `discountsOf`, `sameDiscount`, `rowShape`,
   `toDiscountRequest`); `DISCOUNT_SOURCE_WORD` deleted; `discountKey`
   strings unchanged (§1.5; runbook §4.9 gate 6b guards both rows).
5. `streakPeriodReasonWords`, `streakPeriodMarkWords` (`streak-period-words.ts`)
   and `daypartWords` (`daypart-words.ts`) move to
   `@creativo/infrastructure/i18n`; the four local copies are deleted (UR-3).
6. The footer's year is read on the default location's calendar
   (`ShopZoneService.defaultZone()`, the UTC calendar while pending) — a
   behaviour change only in the first hours of 1 January for a viewer whose
   device is not on shop time; DEP-2 and OQ-2 amended.

**Review fixes, round 2 (the fixer, 2026-10-23).** Four confirmed findings,
every one output-identical:

1. The landing's opening hours were dead data once UR-14 deleted their only
   readers: `LocationVm.hours`, `DayHoursVm`, the `open`/`closed` helpers,
   both `hours` arrays and the `DayOpening` dictionary the cleanup had given
   them are deleted (`timezone` stays, `landing-location-zone.ts` reads it;
   the page's hours come from `locations.component.ts` `schedule`); §2.8 row
   13 and UR-14 say so.
2. `excuseKey` (`admin-rhythm.words.ts`) returns
   `streakPeriodReasonWords[excuse]` — the second, switch-shaped
   `StreakExcuse` table is gone (UR-3, one table per tag family).
3. DEP-5's wording (§0 UR-16 and the P2 client-account step) now says what
   the code ships and ruling #1 below decided: a failed card prints the
   existing `errors.ACCOUNTS_REPOSITORY_FAILURE` line, whichever read
   failed. No code change.
4. Every hand-built `{ loadState: LoadState.Ready, data }` in production —
   `client-card.store.ts` 21, `wallet.presenter.ts` 1,
   `loyalty.presenter.ts` 1 — is `LoadSlice.ready(…)` (a fresh object per
   call, as the literal was: no signal-equality change), the client-card
   fixtures likewise (`LoadSlice.loading`/`failed` for their static
   variants); paging and page states (spreads, extra fields) stay literals.
   Enforced by the fourth rule, `creativo/no-hand-built-load-slice` (§3.5;
   known-bad 23 on `474e771`; runbook §4.9 gate 5 now probes four rules and
   its canary carries a fourth line, flagged 4× under the executor and 4×
   under lookup in all four projects).

The gate after round 2 (same tree, same day): sync:check, layering,
typecheck (only `patterns`), lint 46 projects 0 errors, test 10,864 passed

- the 6 baseline reds (lint-rules 10 files, 242 tests: +21), ecs-core
  4,530 / 97.85 % / 98.82 %, seed-tools, `build web` 604.22 kB initial,
  `verify:bundle`, `build functions` + deps check, runbook §4.2 28 / §4.3 22
  / §4.4 17 / §4.5 6 / §4.7 24 / §4.8 27 / §4.9 25 `ok`, `verify:p0` all
  proved, `test:emulator` 65 + 255, `e2e:web` 41 passed + exactly the 19
  baseline failures.

**The gate (HANDOFF §4, all on the integrated tree, 2026-10-23)**

| Command                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nx sync:check`                                                       | pass (after `nx sync` + `nx reset`)                                                                                                                                                                                                                                                                                                                                             |
| `pnpm nx run verify-tools:layering --skip-nx-cache`                        | pass — 644 files / 2,874 edges in ecs-core, 2,277 scanned; (a)–(e) ok                                                                                                                                                                                                                                                                                                           |
| `pnpm nx run-many -t typecheck --skip-nx-cache`                            | 42 projects + 1 dependency; only `patterns` red (baseline: `section-header.spec.ts` `findLast`)                                                                                                                                                                                                                                                                                 |
| `pnpm nx run-many -t lint`                                                 | 46 projects, 0 errors                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm nx run-many -t test --parallel=3`                                    | 46 projects; 10,832 passed + exactly the 6 baseline reds (gauge ×4, visit-pills ×1, visits-page.presenter «strikes an hour that did not happen» ×1); verify-tools 79 node tests; no timeout re-run needed. Was 10,698 on the 4b tree: +134, all from new cases (view-state 12, wall-clock +8 incl. `it.each`, visit-list-words 4, tag-words 2, lint-rules +76, the §11.3 cases) |
| `pnpm nx test ecs-core --coverage`                                         | 272 files, 4,530 tests; 97.85 % statements (12,108/12,373), 98.82 % lines; ecs-core untouched                                                                                                                                                                                                                                                                                   |
| `pnpm nx typecheck seed-tools`                                             | pass                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm nx test lint-rules`                                                  | 9 files, 221 tests (6 / 145 before G1); 10 / 242 after review round 2                                                                                                                                                                                                                                                                                                           |
| `pnpm nx build web`                                                        | pass; initial 604.22 kB (ruling 8); the `gauge.css` 10 kB component budget warning (45 B over) is the same on `c77e932`                                                                                                                                                                                                                                                         |
| `pnpm run verify:bundle`                                                   | pass — firestore, storage and libphonenumber-js not in the initial chunk                                                                                                                                                                                                                                                                                                        |
| `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs` | pass — 4 runtime dependencies (`firebase-admin`, `firebase-functions`, `libphonenumber-js`, `rxjs`)                                                                                                                                                                                                                                                                             |
| runbook §4.2 / §4.3 / §4.4 / §4.5 (preamble `STORE`) / §4.7 / §4.8         | PASS — 28 / 22 / 17 / 6 / 24 / 27 `ok`, as on the 4b tree                                                                                                                                                                                                                                                                                                                       |
| runbook §4.9 (this plan's §6)                                              | PASS — 24 `ok` (gates 1–4 and 6–8, 8 `ok`; gate 5, 16 `ok`); after the review fixes 25 `ok` (gate 6b added)                                                                                                                                                                                                                                                                     |
| `pnpm run verify:p0`                                                       | pass — (a)–(f) proved, «P0 exit criteria: all proved»                                                                                                                                                                                                                                                                                                                           |
| `pnpm run test:emulator`                                                   | 65 + 255 passed                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm run e2e:web`                                                         | 41 passed, 19 failed = exactly the baseline: 6 `*-screenshots`, `landing.spec.ts:121`, 12 `client-card-glance` runs at `:343`/`:686`. `appointments.spec.ts:152` passed, so no re-run was needed                                                                                                                                                                                |

**Canary proof.**

- §4.9 gate 5 ran end to end. Each of the ten `--print-config` probes shows
  all three rules at severity 2 with their `include`, under both the executor
  and lookup; the probes cover four projects plus the icon manifest, and the
  manifest probe also shows its `allowIn`.
- On the manifest, under both base paths, `no-generic-discriminator`
  reports 0.
- A temporary `__canary__.ts` (one class, one `Date.now()`, one `kind:`
  signature) was reported exactly 3 times by `pnpm nx lint <project>` and
  3 times by lookup, in each of shared-visits, controls, showcase and web.
- An extra canary in `libs/infrastructure/i18n/src/lib/` (a class,
  `Date.now()`, `Math.random()`, a `status:` signature) under
  `pnpm nx lint i18n` reported `no-undecorated-class` ×1,
  `no-ambient-clock` ×2 and `no-generic-discriminator` ×1. This proves the
  infrastructure scope outside the two adapters.
- A temporary untracked file holding `state() === 'LOADING'`,
  `state() === 'loading'`, a `kind: '…'` literal, `outcome === 'worked'`, a
  `LEGACY_X` table and the Sofia literal made gates 2, 3, 4, 6, 7 and 8 each
  FAIL.
- Every canary file was deleted after its run, and `git status` shows none.

**Dev-stack smoke (§8 item 6).** `pnpm run dev` (seed:dev, the four
emulators, the web on :4200) served the integrated tree. The HEAD copy of
`c77e932` was served on :4300 against the same emulators and the same seed.
A Playwright script in the scratchpad (node_modules symlinked) drove both,
signing in through `window.__e2eSignIn` with custom tokens minted as the e2e
harness mints them: `dev-client-1` as client, `dev-staff-ivan` as
barber+admin. For each screen it wrote a DOM signature: every element, every
attribute except Angular's generated `_ng*` attributes, ids, inline styles and
URLs, and all text. It ran in bg, then en, and the two origins were diffed.

- Batch 1, 15 screens per language: the landing page's `main`, including
  the locations panel with its status line and bold today row; the footer
  and its year; careers, courses and events at READY; `/account`
  (`data-state="ready"`, `data-upcoming="populated"`, card `data-kind="next"`);
  `/account/appointments`, with the month sections, the filter rail and the
  rows' `data-status`; `/account/profile`; the staff agenda; the visit editor;
  the staff client card (glance cards `data-kind` last/next); the history page
  (`data-perspective="staff"`); the day grid (`data-kind`, `data-status`,
  masks); admin rhythm (`data-state="ready"`); admin programs.
- Batch 2, 14 states per language: `/auth` with the consent sentence;
  `/book`; the appointments filter menu open, with every `appointments-filter-*`
  option; the calendar view; a visit sheet; the 3-day and week grids; the
  site menu with its date line; the frame fullscreen toggle open
  (`data-expanded`, `popover="manual"`) and closed again on Escape; the pushed
  `clientSearch` page; the pushed `discount` page; the tip tiles unfolded; the
  shop row.
- Result: all 58 signatures are byte-identical to HEAD's, with two
  exceptions. One is the grid's now-label (06:25 against 06:27, the minute
  each run took). The other is ruling 7's `perspective` attribute.
- Console errors are the same set on both origins: Angular's
  «Transition was skipped», three image 404s, and the pre-existing
  `periodLabel` throw noted above.
- Not smoked:
  - Writes, so the two origins' data never diverged. Rebook, save, verbs
    and photos are covered by `client-card-rebook`, `booking-core` and the
    rest of `e2e:web`, which passed.
  - Drag edge auto-scroll and resize, covered by `grid-gesture.spec.ts` and
    `staff-time-grid.spec.ts`.
  - DEP-5 with the emulator rules swapped, pinned by the new
    `client-account.spec.ts` case.
- The dev stack and the HEAD server were stopped afterwards. The emulators
  keep no data, so the seed state is the committed seed's, and every port is
  free.

---

## 9. Risks

- **R-1 — the client card's `visits()` truth table.** It returns `failed`
  when `visitRowsInput()` is null (≈1423–1425). If the row input becomes null
  while the default zone is pending (ShopNow needs a zone), the history page
  flips `loading` → `failed` in that window. Keep the input non-null with
  `now: ShopNow | null` and rows deferred, and add the explicit zone-pending
  branch returning `visitsPageBlank(LoadState.Loading)`; `gateOpen` already
  requires `zone !== null`, so the page is `LOADING` throughout. New spec §5.3.
- **R-2 — `/account` timing and failure (DEP-4, DEP-5).** The card may draw
  one zone read later; `upcomingState()` must keep reporting `LOADING` for a
  populated-but-undrawn card (its existing rule) — never `EMPTY` — and must
  turn `FAILED` when the zone read fails, never stay `LOADING` (the default
  location's `defaultZone()` would be `null` forever on a failed read or a
  missing default location, which is why the card reads the appointment's
  own `zoneOf(locationId)`). Both pinned by new `client-account.spec.ts` cases.
- **R-3 — DOM words.** Every attribute in §1.1/§1.2 that prints a
  discriminator (`data-upcoming`, `data-state` ×4 pages, `data-perspective`,
  `data-kind` ×6 hosts, `data-status` ×2, `data-page`, `data-verdict`, the
  filter/section/record test ids) and the CSS selecting them
  (`staff-time-grid.state.css`/`.page.css`, `staff-visit-editor*.css`) must
  go through a words table. e2e and specs catch most; the smoke catches CSS.
- **R-4 — the waitlist sentinel.** A waitlist row with no watched day had
  `startMs 0` (read in Sofia as 1970-01-01 minute 120); the new
  (1970-01-01, 0) orders the same relative to every real row. Built from
  `LocalDate.fromEpochDay(0)` and `MinuteOfDay.ofProven(0)`, never a throw.
- **R-5 — fixture values.** `client-pages.vm-fixtures.ts`' hand-built rows
  carry stale lower-case `status` values; re-targeting to
  `bookingStatus: BookingStatus.*` changes fixture values, not output (staff
  rows render no `data-status`). No showcase or snapshot consumes them. Their
  `startMs: Date.UTC(…)` values meant the SOFIA wall clock (`wallTimeOf` read
  them in Sofia): each converts to `localDate` + `startMinutes` by its Sofia
  wall time (`Date.UTC(2026, 8, 5, 7)` → minute 600, not 420), or same-day
  rows reorder inside a section and the specs that pin the order fail for
  the wrong reason; every before → after goes to §11.2.
- **R-6 — achievements' `absent` → `EMPTY`.** Safe only if no page draws
  `absent` differently from empty: P3 reads every `@case ('absent')` block of
  `client-achievements`/`achievement-category`/`achievement-detail` first;
  if one differs, `absent` keeps its own state as `LoadSlice.WithEmpty`'s
  `EMPTY` and the empty page keeps a separate feature tag — recorded.
- **R-7 — payload renames to `data`.** Template reads of `current.positions`,
  `state.appointment`, `…vm` surface only in `pnpm nx build web`.
- **R-8 — `CLOCK_PORTS` has no root default.** Injecting it into the menu,
  footer, locations, client-account and the visit editor breaks every spec
  that renders them without a provider; each gets `memoryClockPorts` (a
  re-target to name the port). Never add a root factory.
- **R-9 — the merged clock.** The row's `whenLong` (no weekday) and the
  card's `whenHeard` (weekday long) must stay distinct; card call sites
  `:153` (`dayShort`) and `:175` (`whenHeard`) are the easy ones to get
  wrong. The new spec §5.3 pins the card faces.
- **R-10 — `FrameFullscreen` must stay a field initialiser** (`inject`
  throws outside an injection context); `EdgeScroller`'s tick order is pinned
  by `grid-gesture.spec.ts`.
- **R-11 — the wall-clock move (P0).** Moving `wall-clock.ts` to
  `@creativo/ui/wall-clock` re-points 16 importers' import lines in wave 0;
  a missed importer fails typecheck at once (P0 runs `run-many -t typecheck
--skip-nx-cache`), and a re-export from the visits barrel is NOT added to
  paper over one. The shell then needs no feature → feature edge.
- **R-12 — scope creep into the staff day's instant math.** The dashboard's
  `startMs` threads look like residue but are a separate Law 7.4/T1 pass
  (UR-13 c); P4b must not convert them in this pass.
- **R-13 — public exports changed.** `VisitClock` (class → type + factory),
  `EdgeScroller`, `FrameFullscreen`, `ConsoleUiIconReporter`, the visit types:
  re-grep `apps/**` and every lib before landing; the doc at
  `icon-registry-design.md:264` renamed.
- **R-14 — ids under a pinned clock.** With `memoryClockPorts`, the stamp is
  constant; uniqueness rests on `minted` (editor) and the leg index
  (rebook). The rebook spec, if it rebooks twice in one test, gets equal ids
  for two different NEW appointments — legal (seat ids are per appointment).
- **R-16 — the new-visit frame's `data-status`.** Mapping `'new'` to
  `bookingStatus: null` drops the attribute and the primary ink of
  `.staff-grid__event[data-editable][data-status]` unless the editor's frame
  event carries `draftNew`; no spec pinned it before this pass — the new
  editor and grid cases and the §8 smoke do.
- **R-17 — lint base path.** A repo-root-relative `files` glob is matched
  under `nx lint` (base = workspace root) but silently not under directory
  lookup (base = the project dir), or the reverse for a project-relative
  glob; the rules scope by `physicalFilename` and the canary runs both ways
  (§3, §3.4 c).
- **R-15 — `.data.ts` guards on the new lib.** The root ECS suffix blocks run
  on `libs/shared/view-state/**/*.data.ts`; the companion's constants or the
  generic may need the guard-clean form (P0 records it).

---

## 10. Open questions (owner) — with the default this plan applies

- **OQ-1 (DEP-1) — locations on the shop clock.** Default: YES — the status
  line and today row read the location's zone (Law 7.2, `angular-ui.md`);
  identical for Sofia devices. Alternative: keep the device's day (the
  device zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`, no
  `Date`) — a Law 7.2 exception this plan does not take.
- **OQ-2 (DEP-2) — footer year on the UTC calendar.** Default: `ageDayOf`
  (UTC); alternative the default location's zone through `ShopZoneService`,
  rejected because it adds a Firestore read and a year-less footer until it
  resolves on every public page. **Amended by the review (fixer):** Law 7.2
  and `angular-ui.md` put a displayed "today" on the location's calendar, so
  the footer reads `ShopZoneService.defaultZone()` — the session's ONE read,
  which the site menu already starts at shell mount, so no read is added —
  and while it is pending reads the same instant on the UTC calendar, so the
  footer is never year-less. Pinned by `site-footer.component.spec.ts`
  (22:30 UTC on 31 December is 2027 in Sofia; 2026 while the zone is
  pending).
- **OQ-3 (DEP-3) — month-picker shortcuts without `uiToday`.** Default: inert
  (no device fallback); no consumer reaches it.
- **OQ-4 (DEP-4) — `/account` waits for the zone.** Default: yes, inside the
  existing pending state.
- **OQ-5 — the icon manifest `kind`.** Default: allowlisted; a later icons
  pass may rename it with a `schemaVersion` bump.
- **OQ-6 — tools classes** (`ExecutionTally`, `LostAnswer extends Error`).
  Default: left (outside the apps); a tooling pass may convert `LostAnswer`
  (Law 7 frowns on an `Error` subclass as control flow, even in tooling).
- **OQ-7 — `wall-clock.ts`'s home.** Ruled in this plan: it moves to
  `@creativo/ui/wall-clock` (`type:ui`, depends on `@core/primitives` only) in
  P0, so `libs/ui`, the showcase, the shell and every feature reuse ONE set of
  cached formatters (UR-9). `@creativo/infrastructure/i18n`, which
  `angular-ui.md` names for formatting, is unreachable from `type:ui`; the
  owner may still prefer a different `type:ui` home name.
- **OQ-8 — draft ids via `ID_PORTS`.** Default: no — `CLOCK_PORTS` stamp,
  format byte-identical (UR-11).
- **OQ-9 — one-variant tags.** Default: deleted (`VisitTrailing.kind`,
  `VisitEditorCommit.kind`), not renamed.
- **OQ-10 (DEP-5) — `/account` when the zone read fails.** Default: the card
  reads "now" in the appointment's own location zone (`zoneOf(locationId)`);
  a failed answer shows the existing `'error'` state. Alternative: the
  default location's zone with `defaultZoneFailed()` folded into `FAILED` —
  one cached read, but the card then depends on the default location.
- **OQ-11 — the view-model pass.** The presenter/vm mapper layer (UR-13 f)
  is left for a pass that may change markup: formatting moves to templates
  and pipes, `VisitRowVm`/`VisitCardVm` become ecs-core values. HANDOFF keeps
  it carried.
- **OQ-12 — ecs-core's tier lint blocks under `nx lint` (found while
  verifying this plan; not changed here).** `libs/ecs-core/eslint.config.mjs`
  scopes its Law 8 tier `no-restricted-imports` blocks with project-relative
  `src/<tier>/**` globs; under the `@nx/eslint:lint` executor (cwd = workspace
  root, `overrideConfigFile`) they do not match — measured on `c77e932`:
  `calculateConfigForFile` of `src/primitives/busy-key.primitive.ts` gives a
  `no-restricted-imports` payload of 1192 chars from the root vs 1862 from
  inside `libs/ecs-core` (the tier block present only there). The layering
  verifier (`verify-tools:layering`) still enforces the hierarchy, so Law 8
  holds, but its lint half is off in CI. Default: a follow-up re-scopes those
  blocks the way §3 scopes the new rules (owner to rule; outside this pass).
  **Resolved 2026-10-23 (after this pass): "off in CI" was wrong, the
  fragility was real.** `ecs-core`'s lint target is the INFERRED `eslint .`
  run from `libs/ecs-core` (`nx:run-commands`), not `@nx/eslint:lint` — a
  canary primitives file importing `@core/components` was flagged by
  `nx run ecs-core:lint` on `72af6e4`, so CI enforced the tiers all along.
  The same canary linted with `eslint -c libs/ecs-core/eslint.config.mjs`
  from the workspace root was NOT flagged: the bare `src/…` globs went silent
  from that base. Every `src/…` glob of that config is now written for both
  base paths (`fromEitherBase`), pinned by
  `tools/lint-rules/ecs-core-base-paths.spec.mjs` (both bases, one upward
  import each). No other project carries a project-relative glob (the 37 on
  `@nx/eslint:lint` use `**/` globs only).

---

## 11. The case ledgers (the packages and the integrator fill)

### 11.1 Deleted specs

None. One spec MOVED, not deleted: `libs/features/shared/visits/src/lib/wall-clock.spec.ts`
→ `libs/ui/wall-clock/src/lib/wall-clock.spec.ts` with its subject (P0) — its 9
cases verbatim, plus the 3 new `formatWallClockRange` cases of §11.3. No case was
lost anywhere: every edited spec has at least as many `it(` cases as on `c77e932`
(counted per file by the integrator).

### 11.2 Re-targeted specs — before → after

Same intent, new names only; every DOM assertion (`data-*` values, test ids,
text) byte-identical unless the row says otherwise.

| Spec (case)                                                                                                                                                                                                                                                                                                                                                                                                         | Before                                                                                                                                                                                   | After                                                                                                                                                                                                                                                                                                                                                                                            | Pkg |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| `visit-row.vm.spec.ts` (the type pins)                                                                                                                                                                                                                                                                                                                                                                              | `VisitFilter` = five lower-case words; the four local unions                                                                                                                             | pins `visitFilterWords` (the same five words) and `VisitRowVm['outcome']` = `@core/systems` `VisitRowOutcome \| null`; names `VisitRowEntry`, `TrailingFactFace`, `CancelledSide`                                                                                                                                                                                                                | P1  |
| `visit-filter.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                              | row fixtures `kind: 'visit'\|'waitlist'`, `startMs: 0`, outcome/filter words                                                                                                             | `visitRowEntry: VisitRowEntry.*`, `localDate: LocalDate.fromEpochDay(0)` + `startMinutes: MinuteOfDay.ofProven(0)`, `VisitRowOutcome.*` / `VisitFilter.*`                                                                                                                                                                                                                                        | P1  |
| `visit-sections.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                            | `grain` words ×13, `startMs`, `status` words                                                                                                                                             | `VisitGrain.*`, `localDate`/`startMinutes`, `bookingStatus: BookingStatus.*`                                                                                                                                                                                                                                                                                                                     | P1  |
| `visit-row.presenter.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                       | outcome ×36, filter words ×25, `startMs` ×4, `nowMs`, `new VisitClock(…)`                                                                                                                | dictionary members, `localDate`/`startMinutes`, `now: ShopNow` + `timeZone`, `visitClockOf(…)`                                                                                                                                                                                                                                                                                                   | P1  |
| `visit-card.presenter.spec.ts`, `visit-card.vm.spec.ts`, `visit-card.spec.ts`                                                                                                                                                                                                                                                                                                                                       | `kind: 'next'\|'last'`, `nowMs`, `CardClock`                                                                                                                                             | `visitCardSlot: VisitCardSlot.*`, `now` + `timeZone`, `visitClockOf`; `data-kind` asserted unchanged                                                                                                                                                                                                                                                                                             | P1  |
| `visit-list.spec.ts`, `visit-filter-menu.spec.ts`, `visits-browser.spec.ts`, `visits-browser.contract.spec.ts`, `visit-row.spec.ts`                                                                                                                                                                                                                                                                                 | `state` words, static `perspective="…"`, filter words, `status`                                                                                                                          | `LoadState.*`, `[perspective]="VisitPerspective.*"`, `VisitFilter.*`, `bookingStatus`; `data-perspective`, `*-filter-no_show`, `history-month-*` unchanged                                                                                                                                                                                                                                       | P1  |
| `staff-event-head.spec.ts` (`hollowStatus`)                                                                                                                                                                                                                                                                                                                                                                         | `hollowStatus('cancelled' \| 'no_show' \| …)`                                                                                                                                            | `hollowStatus(BookingStatus.*)` (+ `Pending` and `null`, both `false`)                                                                                                                                                                                                                                                                                                                           | P1  |
| `appointments.store.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                        | `upcoming().appointmentsViewState` = `AppointmentsViewState.*`                                                                                                                           | `upcoming().loadState` = `LoadState.*` (`Error` → `Failed`)                                                                                                                                                                                                                                                                                                                                      | P2  |
| `client-appointments.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                       | filter words                                                                                                                                                                             | `VisitFilter.*`; DOM assertions unchanged                                                                                                                                                                                                                                                                                                                                                        | P2  |
| `client-account.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                        | a `CLOCK_PORTS` provider and a location (zone) read double; the alert line of the new failed-zone case is the card's existing «Възникна проблем от наша страна…» (integrator ruling on DEP-5, §8.1)                                                                                                                                                                                              | P2  |
| `client-profile.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                            | the date field's `kind` blur variants                                                                                                                                                    | `uiDateFieldFill: UiDateFieldFill.*`                                                                                                                                                                                                                                                                                                                                                             | P2  |
| `visit-ics.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                 | `Date.UTC(…)` fixtures, `STAMP + 5_000`                                                                                                                                                  | `utcMs('…Z')`, `UtcEpochMs.plusMs(STAMP, 5_000)` — same instants                                                                                                                                                                                                                                                                                                                                 | P2  |
| `client-pages.vm.spec.ts`, `visits-page.presenter.spec.ts`, `client-card.store.spec.ts`, `ledger.presenter.spec.ts`, `glance.presenter.spec.ts`, `history.presenter.spec.ts`, `medal-detail.presenter.spec.ts`, `medals.presenter.spec.ts`, `records.presenter.spec.ts`, `wallet.presenter.spec.ts`, `client-loyalty.spec.ts`, `wallet-holdings.spec.ts`, `client-history.spec.ts`, `client-card.contracts.spec.ts` | `status` (load), paging `kind`, store `more`, filter words, trailing `kind`, `nowMs`, `occasion: 'birthday'`, birthday `kind`, record `kind`, holding `kind`, `row.outcome === 'worked'` | `loadState`; `pagingState`; `pagingState`; `VisitFilter.*`; trailing `kind` dropped / `trailingFactFace`; `now: NOW, timeZone: SHOP_TIME_ZONE`; `couponOccasion: CouponOccasion.Birthday`; `birthdayMoment`; `personalRecordKind`; `walletHolding`; `VisitRowOutcome.Worked`                                                                                                                     | P3  |
| `achievements-page-state.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                   | `absent` → `{ kind: 'absent' }`, ready → `{ kind: 'ready', vm, words }`                                                                                                                  | `{ loadState: EMPTY }`, `{ loadState: READY, data: { vm, words } }` (case title gains «(EMPTY)»)                                                                                                                                                                                                                                                                                                 | P3  |
| `client-card.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                               | the `client-record-*` test id from the record word                                                                                                                                       | built through `RECORD_KIND_WORDS` — the same string                                                                                                                                                                                                                                                                                                                                              | P3  |
| `client-pages.vm-fixtures.ts` (testing, the rows the specs read)                                                                                                                                                                                                                                                                                                                                                    | `startMs: Date.UTC(2026, m, d, 7)`, `status` words                                                                                                                                       | the Sofia wall time of each instant: `localDate` 2026-09-05 / 09-28 / 08-08 / 10-23 / 07-11 / 06-27 / 06-20, `startMinutes` 600 (EEST, UTC+3); `bookingStatus: BookingStatus.*`, `VisitRowOutcome.*`, `visitRowEntry`, `trailingFactFace`, `visitCardSlot`, `birthdayMoment`, `personalRecordKind`, `walletHolding`, `pagingState`, `loadState` (R-5)                                            | P3  |
| `client-query.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                              | 6× `.kind).toBe('<word>')`                                                                                                                                                               | `.clientQueryShape).toBe(ClientQueryShape.<Member>)`                                                                                                                                                                                                                                                                                                                                             | P4a |
| `staff-visit-editor.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                        | no clock provider; verb fixtures `kind:`; VM `status: '<word>'` / `'new'`; resolution `kind:`; commits with `kind: 'save'`; grid commits `kind: 'move'`; `occasion: 'birthday'`          | `CLOCK_PORTS` = `memoryClockPorts(EDITOR_NOW_MS)`; `rowVerb:` (`BookingStatus.*` / `ArrivalVerb.Arrived`); `bookingStatus: BookingStatus.*` / `null`; `bookingStatus:`; the one-variant `kind` dropped (`toMatchObject({ tipMinorUnits: 200 })`, `toHaveLength(1)`); `editCommand: EditCommand.Move`; `couponOccasion: CouponOccasion.Birthday`. Selectors and the new-client test ids untouched | P4a |
| `staff-dashboard.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                           | outcome words, `startMs`, grid `kind`, `openCreate('booking'\|'block')`, the coupon case «… as `occasion: 'birthday'`»                                                                   | members, `CreateIntent.Booking/Block`, «… as `couponOccasion: BIRTHDAY`» (same assertion on the same sheet input)                                                                                                                                                                                                                                                                                | P4b |
| `staff-time-grid.spec.ts`, `staff-timeline.spec.ts`                                                                                                                                                                                                                                                                                                                                                                 | events `kind: 'visit'\|'gap'\|'block'`, `status`, commit `kind: 'move'\|'resize'`, edge words                                                                                            | `gridEvent: GridEvent.*`, `bookingStatus`, `editCommand: EditCommand.*`, `ResizeEdge.*`; `data-kind`/`data-status`/`data-edge` unchanged                                                                                                                                                                                                                                                         | P4b |
| `grid-gesture.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                              | `new EdgeScroller(…)`                                                                                                                                                                    | `edgeScrollerOf(…)` — the same tick order asserted                                                                                                                                                                                                                                                                                                                                               | P4b |
| `service-row.component.spec.ts`, `service-detail-sheet.component.spec.ts`                                                                                                                                                                                                                                                                                                                                           | `kind: 'single'\|'bundle'`                                                                                                                                                               | `compositionKind: CompositionKind.Single\|Bundle`                                                                                                                                                                                                                                                                                                                                                | P5  |
| `site-menu.component.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                       | `vi.setSystemTime(2026-09-17T10:00+03:00)`                                                                                                                                               | `render({ now: utcMs('2026-09-17T07:00:00Z') })` through a `CLOCK_PORTS` provider — still «чт, 17 септември»                                                                                                                                                                                                                                                                                     | P5  |
| `site-header`, `site-footer`, `marketing-careers`, `marketing-courses`, `locations` specs                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                        | a `CLOCK_PORTS` provider (`memoryClockPorts`); the footer's one case moved into a shared `configure()` helper, its assertions unchanged                                                                                                                                                                                                                                                          | P5  |
| `admin-rhythm.store.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                        | `RhythmLoadState.*`, `rhythmLoadState`                                                                                                                                                   | `LoadState.*`, `loadState`                                                                                                                                                                                                                                                                                                                                                                       | P6  |
| `admin-rhythm.words.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                        | `kind: 'estimate'\|'unavailable'`                                                                                                                                                        | `rhythmEstimate: RhythmEstimate.*`                                                                                                                                                                                                                                                                                                                                                               | P6  |
| `date-field.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                | blur `{ kind: 'empty'\|'partial'\|'complete' }`                                                                                                                                          | `{ uiDateFieldFill: UiDateFieldFill.* }`                                                                                                                                                                                                                                                                                                                                                         | P7  |
| `no-undecorated-class.spec.mjs` (`pathScope` cases)                                                                                                                                                                                                                                                                                                                                                                 | imported `pathScope`/`scopedPath` from `no-undecorated-class.mjs`                                                                                                                        | imported from `path-scope.mjs`, the helper's own module (G1's proposal, applied by the integrator)                                                                                                                                                                                                                                                                                               | G1  |

### 11.3 New specs

| Spec (case)                                                                                                                                                                                                                | Proves                                                                                                                   | Pkg        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `libs/shared/view-state/src/lib/load-state.data.spec.ts`, `paging-state.data.spec.ts`, `load-slice.data.spec.ts`, `load-state-words.spec.ts` (12 cases) + `load-slice.type-spec.ts`                                        | the one vocabulary: SCREAMING values, the slice factories and guards, the shared words table total over `LoadState`      | P0         |
| `libs/infrastructure/i18n/src/lib/visit-list-words.spec.ts` (4)                                                                                                                                                            | `visitFilterWords`/`visitGrainWords`/`visitPerspectiveWords` print the legacy words, and the filter key                  | P0         |
| `libs/features/staff/dashboard/src/lib/tag-words.spec.ts` (2)                                                                                                                                                              | `gridEventWords`, `clientQueryShapeWords` total and lower-case                                                           | P0         |
| `wall-clock.spec.ts` «formatWallClockRange» (3)                                                                                                                                                                            | the range face equals the retired `dayRange` `noonOf` path in bg and en, inside a month, across months and years         | P0         |
| `visit-row.presenter.spec.ts` «files a request that watches no day first in the upcoming run, without throwing»                                                                                                            | R-4: the waitlist sentinel (1970-01-01, 0)                                                                               | P1         |
| `visit-row.presenter.spec.ts` «prints the card's own date faces as the card always has, the year only outside the current one» · «keeps the row's long form without a weekday beside the card's heard one»                 | R-9: one `visitClockOf` for rows and cards, the card faces as `CardClock` printed them                                   | P1         |
| `visit-card.spec.ts` «keeps data-kind's lower-case word for every slot»                                                                                                                                                    | `visitCardSlotWords` → `data-kind` `next`/`last`                                                                         | P1         |
| `client-account.spec.ts` «a pending zone read keeps data-upcoming="loading"» · «a failed zone read shows data-upcoming="error", never loading forever»                                                                     | DEP-4 / DEP-5                                                                                                            | P2         |
| `client-appointments.spec.ts` «stays loading, never empty, until the catalogue words load»                                                                                                                                 | the words gate (`listState()` LOADING, no empty state)                                                                   | P2         |
| `visit-ics.spec.ts` «keeps the real second of the stamp and drops its milliseconds» · «writes every field of the UTC form with two digits, across a year end»                                                              | the `.ics` DTSTAMP without a `Date`                                                                                      | P2         |
| `client-profile.spec.ts` «prints the birth date as the civil day it is stored as» (en, bg) · «names a complete but refused birth date on blur, and stays quiet on an empty or partial one»                                 | the birth date label through `formatWallClock`; the `UiDateFieldFill` nudges                                             | P2         |
| `client-card.store.spec.ts` «keeps «Посещения» LOADING, never FAILED, while the default zone is pending — its rows wait for "now" (R-1)»                                                                                   | R-1                                                                                                                      | P3         |
| `staff-visit-editor.spec.ts` «mints the draft seat and guest ids in their stored draft-/guest- formats» · «leave a new visit's frame block its data-status="new" and data-editable»                                        | UR-11, R-16                                                                                                              | P4a        |
| `staff-time-grid.spec.ts` «data-kind and data-status keep their lower-case words»                                                                                                                                          | `gridEventWords`, `gridStatusWord` incl. `null` + `draftNew` → `new` and `null` alone → no attribute                     | P4b        |
| `staff-dashboard.spec.ts` «strikes a cancelled agenda card and draws no tag on it, like a no-show»                                                                                                                         | `hollowStatus(BookingStatus)` on the agenda                                                                              | P4b        |
| `site-footer.component.spec.ts` «dates the legal bar with the year of the clock reading»                                                                                                                                   | DEP-2: © 2027 at 2027-03-01Z                                                                                             | P5         |
| `locations.component.spec.ts` — Sunday, 19:10 closes-soon, 08:30 opens-at, 20:30 opens-on, noon «Closes at 20:00» (5)                                                                                                      | DEP-1: the status line and the bold today row on the shop's clock                                                        | P5         |
| `month-picker.spec.ts` «titles the month, and pages it across a year» · «leaves a shortcut inert while there is no today to resolve it against»                                                                            | the title through `formatWallClock`; DEP-3                                                                               | P7         |
| `phone-field.spec.ts` «type-ahead refines inside its window and starts over after it»                                                                                                                                      | the typeahead window on `performance.now()`                                                                              | P7         |
| `icon-registry.service.spec.ts` «consoleUiIconReporter» (2)                                                                                                                                                                | loud → `console.error`, quiet → `console.warn`, the message shape (P7's optional follow-up, added by the integrator)     | integrator |
| `tools/lint-rules/no-undecorated-class.spec.mjs`, `no-ambient-clock.spec.mjs`, `no-generic-discriminator.spec.mjs`                                                                                                         | the three rules: RuleTester cases inside/outside `include` and on every allowlisted path; `pathScope`                    | G1         |
| `wall-clock.spec.ts` «wallClockParts» (3) — review fix                                                                                                                                                                     | the raw parts face: the locale's own part order, joined equal to `formatWallClockParts`, the shop day as stored          |
| `streak-period-words.spec.ts` (3), `daypart-words.spec.ts` (2) in `libs/infrastructure/i18n` — review fix                                                                                                                  | the ONE table per rhythm / daypart family: total over its dictionary, today's words, every word a key in both catalogues |
| `client-account.spec.ts` «replaces a drawn card straight with a sooner visit at the same shop — no skeleton between, the shop's zone read once» — review fix                                                               | DEP-5 keyed per shop; canary-proven against the per-appointment key (fails `'loading'` ≠ `'populated'`)                  |
| `site-footer.component.spec.ts` «dates the legal bar on the SHOP's calendar — 22:30 UTC on 31 December is already the new year in Sofia» · «never renders without a year while the shop's zone is on its way» — review fix | DEP-2 as amended: the default location's zone, the UTC calendar only while it is pending                                 |

### 11.4 Canary and gate counts

| Gate / rule                              | Known-bad count on `c77e932`                                                                         | After                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `creativo/no-undecorated-class`          | 5 files                                                                                              | 0 (canary: 3× per probe, §8.1)                                                      |
| `creativo/no-ambient-clock`              | 20 files (22 − 2 allowlisted); 0 in `libs/infrastructure` outside the two exempted adapters          | 0                                                                                   |
| `creativo/no-generic-discriminator`      | 27 files                                                                                             | 0 (the icon manifest allowed)                                                       |
| `creativo/no-hand-built-load-slice`      | 23 on `474e771` (`client-card.store.ts` 21, `wallet.presenter.ts` 1, `loyalty.presenter.ts` 1; §3.5) | 0 (the view-state lib allowed)                                                      |
| §4.9 gate 2 (legacy tables)              | 20 lines                                                                                             | `ok` (0)                                                                            |
| §4.9 gate 4 (kind/status literal keys)   | 190 lines in 31 files (incl. `openCreate`'s parameter)                                               | `ok` (0)                                                                            |
| §4.9 gate 6 (legacy visit literals)      | 34 lines                                                                                             | `ok` (0)                                                                            |
| §4.9 gate 7 (bare SCREAMING comparisons) | 0 (2 tagName lines excluded)                                                                         | `ok` (0); its canary `state() === 'LOADING'` FAILS it                               |
| §4.9 gate 8 (bare load-state words)      | 33 lines                                                                                             | `ok` (0); its canary `state() === 'loading'` FAILS it                               |
| §4.9 gates 1, 3, 5                       | 1 (shim present), 1 (the shim's literal), —                                                          | `ok`, `ok`, 16 `ok` (10 `--print-config` probes, 2 manifest runs, 4 canaries 3×/3×) |
