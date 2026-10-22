# Flip 4 — programs (Phase 3b)

**Date:** 2026-10-22 · **Status:** INTEGRATED 2026-10-22 — all six packages merged (P0–P5), the full gate of `HANDOFF.md` §4 green but the baseline reds, the §6 grep gate and the end-of-3b grep gate PASS, the §8 dev smoke run; the integration record is §8.1 and the case ledgers are §11. Written as the PLAN on `09229b0` (flips 1–3 integrated, the tree clean but for this file), revised the same day on review (the `…Input` edge structs, branded error ids, the zone conversion moved to the pipeline with a `DefaultLocationPorts` bundle, the event slices, the end-of-3b gate, the `positions.locationIds` override, the Firestore tie order, the widened grep gate); the contract the parallel packages built against. · **Law:** `CLAUDE.md`
Laws 1–9 and the eight `.claude/rules/*.md` (`ecs-ports.md` is Law 9's
template). This plan never overrides them. · **Sources:**
`docs/architecture/ecs-migration.md` §3 (the `positions/`, `courses/`,
`events/` row, indexes #11/#12), §4.2 (`ObservePositions`, `ObserveCourses`,
`ObserveEvents`), §5 (`AdminProgramsStore`), §6 Phase 3, §9 D9 (resolved
(b): programs content stays a rules-guarded admin write);
`docs/architecture/flatten-spec.md` §3 (the `position`, `course`, `event`
entity rows; `program-status.data.ts`, `enrollment-status.data.ts`), F-3
(`XId.parse` at every foreign-input edge), F-4 (an event's instant uses the
zone of `locationId ?? TenantConfig.defaultLocationId`), F-7
(`LocalizedText` stays a nested bounded map), §2.3 T1–T9 (an event's day and
time are the shop wall clock, `LocalDate` + `MinuteOfDay`; the instant is
computed once at ingestion); the runbook `docs/architecture/firestore-runbook.md`
§1 (the programs row of the matrix), §1.3 (the programs closure), §4.4 (this
flip's gate); `docs/architecture/flips/flip-2-identity.md` and
`flip-3-loyalty.md` (the worked examples: method, contracts, ledgers and the
Law 9 block are copied from them). Every file below was located by
`git grep` on `09229b0`. Line anchors are left out on purpose, because they
drift.

**Law 9 in this plan, once.** Every port this flip adds or consumes is a
member of a focused bundle record declared in
`libs/ecs-core/src/ports/*.port.ts`. Every web `InjectionToken` and every
adapter factory is typed against exactly one bundle; an adapter serving
several returns their `&`, never a local alias. The pipelines' `XPorts` are
intersections of named bundles and nothing else. No `Pick`/`Omit` of a
`*Ports` type appears anywhere in this plan or in the code it produces
(`creativo/no-sliced-ports`, §6's Law 9 gates). The bundle map is §3.1.

A flip is the read/write closure of its collections, landed as **one
commit**: the pipelines, every surviving reader, the web bundles, the
consuming stores and components, the indexes, the runbook. Greenfield: no
dual shape, no backfill, no fallback reader. The emulator is wiped and
reseeded (`pnpm run seed:dev`; `e2e:web` reseeds itself). No seed, e2e or
P0 file reads or writes a programs collection today (§2), so nothing there
moves.

---

## 0. Decisions this plan takes (read first)

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Why                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| F4-1  | **What "frozen" means** (F1-1/F2-1/F3-1, unchanged). Every outcome a person sees or a request leaves equals today's. For the admin page (`/admin/programs`), that is the document an admin save writes (field for field, apart from the renamed and re-typed fields of §1), the refusal (the save returns `false` and the page shows its one "Couldn't save" line — today's UI reads only that boolean), the three lists (their rows, their order, the trailing status text) and the edit form's prefill. For the public pages (`/careers`, `/courses`, `/events`), it is the rows, their order, the tabs, the badge text and tone, the formatted event date, the apply/RSVP href with its Instagram fallback, and the loading, error and empty states. The stored BYTES change (that is the flip). **Six deliberate departures**, each pinned by a spec (§11.4): **(a)** a start time inside the spring-forward gap (e.g. `2027-03-28T03:30` in Sofia) is refused with `DST_GAP_INVALID_TIME` (Law 7.3, locked 2026-10-10), so the save returns `false`. Today Luxon's `DateTime.fromISO` silently moves it forward an hour and saves it. A fall-back repeat time resolves to the EARLIER offset in both, so there is no departure there (§9 has the one-off check against Luxon). **(b)** Read-side validation of stored bodies goes (Law 5, zero mapper; flip 3's F3-1 (b) is the precedent). A stored position, course or event is answered AS STORED. Today one malformed document fails the WHOLE live list: the public page shows its error card and the admin list shows `[]`. Every writer after this flip writes the entity type through the system (§3.3), and no seed writes these collections. **(c)** An event's zone is its location's (F-4, Law 7.2), not the hard-coded `PROGRAMS_ZONE = 'Europe/Sofia'`. The save reads `locations/{locationId ?? defaultLocationId}`, where `defaultLocationId` arrives through the configuration bundle `DefaultLocationPorts` (§3.1), bound from `TenantConfig.DEFAULT.defaultLocationId` (`loc-center`). Flip 4 is the FIRST runtime reader of that constant. When the admin typed a location id that names no document (the field is free text and was never checked), the save falls back to the default location's zone, so it saves exactly as today (§10.1). The save is refused only when a location read FAILS, or when the default location itself is absent (`ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN`, decided by `ProgramsSystem.zoneOf`). Today the save reads no location. The seed has `loc-center`, and both seed locations are `Europe/Sofia`, so every reachable instant in dev is unchanged. The production default id is flatten-spec OQ-2's and is not yet confirmed: runbook §3 gains a deploy precondition (P4) that `locations/<defaultLocationId>` exists with a valid `timeZone` in the target project before the web carrying flip 4 deploys (§10.11). Without it, every event save in that project that names no location, or names one with no document, is refused (an event naming an existing shop still saves on that shop's zone). **(d)** An event location id containing `/` is refused (`PRIMITIVE_ID_HAS_SLASH`, `LocationId.parse`, F-3). Today the legacy `LocationId.create` accepted it and stored it, although no location document can carry such an id. **(e)** Upcoming vs past splits on the instant (`utcEpochMs >= nowUtcMs`), where today it compares the ISO STRING lexicographically (`startDateIso >= nowIso`). The two disagree only when the event and "now" both fall inside the fall-back repeated hour, and the instant order is the right one. **(f)** The start field is read in exactly the form `<input type="datetime-local">` emits without a `step` (`YYYY-MM-DDTHH:mm`). Luxon also accepted forms the page cannot send (seconds, an offset, a bare date, ordinal or week dates). Those are now refused as `TIME_INVALID_DATE_TIME`. | Task constraint; flip-3 F3-1.                                             |
| F4-2  | **Out of this flip** (each Phase 4 or later, recorded so nobody builds it): any rules change (`match /positions`, `/courses`, `/events` keep `allow read: if true; allow write: if isCatalogManager();`. They are shape-free, so this flip needs no rules edit at all, and a tightening such as field allowlists or type checks is Phase 4's); any callable (D9(b): no `saveProgramContent`; D9(a) was not chosen); a delete of a position, course or event (none exists today); the free-text location field becoming a picker; i18n of the status words (they print the stored word today, F4-7); localising the hard-coded admin copy ("Starts at (Europe/Sofia)" stays as static text); the Angular view-state `kind` unions (`PositionEditing`/`CourseEditing`/`EventEditing`, `PositionsListState`/`CoursesListState`/`EventsListState`. They are in-memory UI state, F-8, a flatten-pass candidate like flip 3's `AchievementScope`); a programs e2e journey (none exists today; §8 step 3's dev smoke covers the live paths, §10.7); seeding programs (§10.5). **The blueprint's end-of-3b graph and bundle assertion** (§6 Phase 3: no `functions → libs/application/*` edge in `pnpm nx graph`, no `@angular/*` or `rxjs` in `dist/apps/functions/package.json`, `tools/verify/p0/functions-deps.baseline.json` re-recorded) is deferred to Phase 4. It cannot pass on this tree, and flip 4 does not touch its causes: the frozen wires (`apps/functions/src/wire/booking.wire.ts`, `loyalty.wire.ts`), `lib/booking/caller-roles.ts` and `lib/flags.ts` (+ specs) still import `@creativo/application/*` / `@creativo/domain/*`, `apps/functions/tsconfig.app.json` references `libs/application/booking`, and the baseline still lists `@angular/compiler`, `@angular/core`, `luxon`, `rxjs`, `dinero.js`. Runbook §4.5's grep block DOES run in this flip (§8 step 3); only the graph/bundle half and the baseline re-record are open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Risk: a rule or a writer lands in the commit of the surface it serves.    |
| F4-3  | **Admin writes under D9(b) are browser pipelines in `@core/pipelines` over plain write ports, the system deciding.** A new `libs/ecs-core/src/pipelines/program-content.pipeline.ts` exports `writePosition`, `writeCourse` and `writeShopEvent`, each `(ports) => (cmd) => Promise<Result<X, readonly ProgramSaveError[]>>`. The sandwich: **impure read** (on update `loadX(id)`, so an update never silently re-creates a deleted document, which is today's `findById` existence check; for an event, also the zone's location, and the default shop's when a typed one is absent), **pure compute** (`ProgramsSystem` validates the raw input and builds the entity; for an event, `ProgramsSystem.zoneOf` picks the zone or refuses, then the pipeline, as the ingestion boundary, calls `ZonedTimeSystem.toUtc` ONCE (Law 7.3: no system converts zones) and `ProgramsSystem.shopEvent` assembles the entity with that instant), **impure write** (`saveX(entity)` = a full-document `setDoc` of the body, never a merge, as today). It needs no transaction: today's read-then-write was not atomic either, and an admin save has no invariant across documents. The create id comes from `IdPorts.nextId` (`crypto.randomUUID()` in production, as today's `CryptoIdGenerator`). The store answers today's boolean, `result.ok`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Law 4; blueprint §6 Phase 3 under D9(b).                                  |
| F4-4  | **Bodies = the ecs-core entities, flat** (Law 5/6/7, flatten-spec §3 verbatim): `Position` (`status` → `positionStatus`, values `'open'/'closed'` → `'OPEN'/'CLOSED'`), `Course` (`enrollmentStatus` values `'open'/'upcoming'/'closed'` → `'OPEN'/'UPCOMING'/'CLOSED'`), `ShopEvent` (`startDateIso` and `timezone` → `localDate` + `startMinutes` + `utcEpochMs`). Every optional is present (`applyUrl`, `startsLabel`, `locationId` are written as `null`, read back with no conditional spread). `LocalizedText` stays the nested `{ bg, en }` (F-7). The id is never stored in the body.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | flatten-spec §3; runbook §4.4.                                            |
| F4-5  | **Validation is today's, in ONE pure system** (`libs/ecs-core/src/systems/programs.system.ts`): `title`/`summary`/`description` via `LocalizedText.parse` (both locales trimmed, each blank locale refused as `CATALOG_LOCALIZED_TEXT_FIELD_EMPTY`, `en` first); a course's `startsLabel` is `null` when BOTH locales are blank after trimming, otherwise `LocalizedText.parse`, so a one-sided label is refused, which is exactly today's outcome; `sortOrder` must be an integer `>= 0` (`ENGAGEMENT_{POSITION,COURSE,SHOP_EVENT}_INVALID_SORT_ORDER`); `applyUrl` trimmed, blank → `null`, otherwise it must parse as a URL (`try { new URL(trimmed) } catch` — the legacy check, legal in a `*.system.ts`, where the Law 1 `new` guard does not apply; `URL.canParse` is NOT used, see §9), `ENGAGEMENT_*_INVALID_APPLY_URL`, the trimmed text stored; an event's `locationId` trimmed, blank → `null`, otherwise `LocationId.parse`; a position's `locationIds` each `LocationId.parse` (the admin page always sends `[]`, F4-8). The system collects EVERY field refusal at once, in the legacy order (sortOrder, the texts, the location(s), the apply URL; for an event the start first). A refusal's wording never reaches the UI (the page shows one generic line), so the new codes replace the legacy `programs.*` classes invisibly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fidelity; Law 3.                                                          |
| F4-6  | **New error codes, one home** (Law 7.5, `primitives/engagement-errors.data.ts`): `PositionNotFound` (`'ENGAGEMENT_POSITION_NOT_FOUND'`), `CourseNotFound` (`'ENGAGEMENT_COURSE_NOT_FOUND'`), `ShopEventNotFound` (`'ENGAGEMENT_SHOP_EVENT_NOT_FOUND'`), with the factory `EngagementError.programNotFound(errorCode, programId: PositionId \| CourseId \| EventId)` → `{ errorCode, programId }`; `ShopEventZoneUnknown` (`'ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN'`), with the factory `EngagementError.shopEventZoneUnknown(locationId: LocationId)` → `{ errorCode, locationId }`. The ids are BRANDED (Law 7.4: L3 lint, `ECS_RAW_PRIMITIVE_RESTRICTIONS`, runs over primitives and refuses a raw `string` on an `…Id` key; every existing error struct carries branded ids, e.g. `booking-errors.data.ts` `locationId: LocationId`). They come from the sibling `./ids.primitive`. "Scalar" means never a COMPONENT type, not a raw string. Two type aliases in the same file: `ProgramFieldError = EngagementError.ProgramError \| CatalogError \| PrimitiveError \| TimeError` and `ProgramSaveError = ProgramFieldError \| EngagementError.ProgramNotFound \| EngagementError.ShopEventZoneUnknown \| RepositoryError`. Four new `apps/functions/src/edge.ts` rows (the `EngagementErrorCode` table is exhaustive): `engagement.position.not_found`, `engagement.course.not_found`, `engagement.shop_event.not_found`, `engagement.shop_event.zone_unknown`. No callable returns them (D9(b)), and no i18n key is added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Law 7.5; `edge.spec.ts` "one rule per code".                              |
| F4-7  | **The status words stay today's lowercase text.** The admin list's trailing text and the public badges print the RAW stored string today (`open`, `closed`, `upcoming`). After the byte flip each feature prints it through one words table, `satisfies Record<PositionStatus, string>` / `Record<EnrollmentStatus, string>`, mapping `OPEN` → `'open'` and so on. Same text, same badge tones (`STATUS_TONES` re-keyed by the dictionaries, `satisfies Record<…, UiBadgeTone>`). A spec pins the text (§5.3). Every bare `'open'`/`'closed'`/`'upcoming'` comparison (the chips, the tabs, the signal defaults) uses the dictionary (Law 1). DOM test ids keep their lowercase spelling (`courses-tab-open`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Fidelity (task: "what the marketing pages and the admin lists show").     |
| F4-8  | **Frozen quirks kept, each pinned:** a position save ALWAYS writes `locationIds: []` (the admin form has no location field, so editing wipes any stored `locationIds`, as today); `numberValue` (`Number(v) \|\| 0`) still lets `1.5`/`-1` through to the system, which refuses them; the admin's event list is the upcoming list (`>= now`, ascending, no limit) followed by the past list (`< now`, descending, the latest 24), and EITHER read failing empties the whole list; "now" is read ONCE per subscription (the admin store's construction; each tab switch of `/events`), never rolling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Fidelity.                                                                 |
| F4-9  | **Law 9: one bundle per token and per adapter factory.** `ProgramsPorts` (one flat 9-member record today, with no consumer) becomes the suite `PositionReadPorts & PositionWritePorts & CourseReadPorts & CourseWritePorts & ShopEventReadPorts & ShopEventWritePorts` (§3.1). A new `LocationLoadPorts` (`catalog.port.ts`) gives the event save its zone's location, and a new configuration bundle `DefaultLocationPorts = { readonly defaultLocationId: LocationId }` (same file; `.claude/rules/ecs-ports.md`: configuration a pipeline needs is a bundle too, as `TenantZonePorts`) gives it the default shop. Neither the system nor the pipeline reads `TenantConfig.DEFAULT` directly; `cfg` binds the token from it. The web's clock and id source become bundles too: new tokens `CLOCK_PORTS: ClockPorts` and `ID_PORTS: IdPorts`, bound in `cfg` to `browserClockPorts()` / `browserIdPorts()` (new `libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts`), so the flipped features never touch the legacy `CLOCK`/`ID_GENERATOR` (which stay for the features of flips 1–3 until Phase 4) and their specs pin time and ids with `@core/testing`. Tokens (`ports.tokens.ts`): `PROGRAMS_PORTS`, `POSITION_READ_PORTS`, `COURSE_READ_PORTS`, `SHOP_EVENT_READ_PORTS`, `LOCATION_LOAD_PORTS`, `DEFAULT_LOCATION_PORTS`, `CLOCK_PORTS`, `ID_PORTS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Law 9; `.claude/rules/ecs-ports.md`.                                      |
| F4-10 | **The legacy programs libraries are deleted in this flip** (wave 2, P5). `libs/application/programs` and `libs/domain/programs` serve only this flip's files: every importer is an adapter P1 deletes, or a feature P2/P3 re-types. They go whole, with their `tsconfig.base.json` aliases, their `.nxignore` lines and every project reference (`pnpm nx sync`). This follows flip 3's F3-15 on its grounds; nothing outside the closure imports them (§2 delta 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Deletion rule; HANDOFF §3.3 brought forward for a self-contained context. |
| F4-11 | **The event's date on `/events` is formatted from the wall clock**, never from an instant: `formatWallClock(event.localDate, event.startMinutes, lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })` of `@creativo/features/shared/visits` (reuse, never copy; a `scope:app, type:feature` → `scope:app, type:feature` import, already made by `admin/loyalty` and `client/account`). It formats civil ms in `'UTC'`, which prints the same fields Luxon's `setLocale(lang).toLocaleString(opts)` printed in the stored zone. A spec pins the exact strings for `bg` and `en` (§5.3). The admin edit prefill is formatted in the UI (Law 5: "Formatting happens in the UI"; a system returns values it computes on, never a display string): a pure page-local helper `datetimeLocalOf(localDate, startMinutes)` in `admin-programs.ts` = `` `${localDate}T${HH}:${mm}` `` (today `startDate.toISO().slice(0, 16)`: the same characters, because both are the Sofia wall clock). The PARSE direction (`ProgramsSystem.eventFields` reading `startsAt`) stays in the system: it is foreign-input validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Fidelity; reuse rule.                                                     |

---

## 1. The closure

### 1.1 Collections, bodies, TTL, indexes, rules

Every body **is** the entity type minus `id` (Law 5), every key a root key.
Index numbers are blueprint §3.3's; "→" marks the after-state. No programs
collection has a TTL: they are durable, admin-managed content.

| Collection               | Body = entity (file)                                                                                                                                                                                                                                                                                                                     | Composite indexes after                                                                                                                           | fieldOverrides after                                                                                                                                                                                                   | Rules lines that change |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `positions/{positionId}` | `Position` (`entities/position.entity.ts`): `title: { bg, en }`, `summary: { bg, en }`, `locationIds: LocationId[]` (always `[]` from the admin page, F4-8), `positionStatus: 'OPEN' \| 'CLOSED'`, `applyUrl: string \| null`, `sortOrder: number`                                                                                       | #12 → `positionStatus ASC, sortOrder ASC` (was `status ASC, sortOrder ASC`); the admin list's `orderBy('sortOrder')` stays single-field automatic | NEW `positions.locationIds` single-field indexes off (`"indexes": []`): never queried (the careers page filters on `positionStatus` only, the admin list orders by `sortOrder` only), Law 5, as `services.locationIds` | none                    |
| `courses/{courseId}`     | `Course` (`entities/course.entity.ts`): `title`, `description`, `enrollmentStatus: 'OPEN' \| 'UPCOMING' \| 'CLOSED'`, `startsLabel: { bg, en } \| null`, `applyUrl: string \| null`, `sortOrder`                                                                                                                                         | #11 unchanged (`enrollmentStatus ASC, sortOrder ASC`; the `in` query's VALUES change, its field paths do not)                                     | none                                                                                                                                                                                                                   | none                    |
| `events/{eventId}`       | `ShopEvent` = `ShopEventMeta & ShopEventContent` (`entities/event.entity.ts`, §3.2): `title`, `description`, `localDate: LocalDate` (`'YYYY-MM-DD'`), `startMinutes: MinuteOfDay` (`0…1439`), `utcEpochMs: UtcEpochMs` (computed once at ingestion, F4-1 (c)), `locationId: LocationId \| null`, `applyUrl: string \| null`, `sortOrder` | none (range + order on the one field `utcEpochMs` is served by its automatic single-field index, both directions)                                 | none                                                                                                                                                                                                                   | none                    |

Rules: unchanged. Each `match` is shape-free (`allow read: if true; allow
write: if isCatalogManager();`), so the new bodies pass as the old did. The
rules emulator spec's `programs (positions/courses/events)` cases write
`{ title }` only and stay as they are. The section comment "Open positions,
courses, and shop events — same posture as catalog" stays.

Not in the closure: `locations` (read once by the event save for its zone,
never written here; flip 1's body), `rewardPrograms` / `rewardProgress`
(dormant, F3-2).

### 1.2 The event's time, after this flip (Law 7.3, T1–T9)

- The admin types a shop wall-clock time. `ProgramsSystem.eventFields`
  reads it into `localDate` + `startMinutes` (no zone involved).
- `writeShopEvent` (the ingestion boundary) reads the location
  (`loadLocation(ProgramsSystem.zoneLocationOf(fields, ports.defaultLocationId))`,
  plus `loadLocation(ports.defaultLocationId)` when a typed id names no
  document, F4-1 (c)); `ProgramsSystem.zoneOf` picks ONE zone or refuses;
  the pipeline then calls `ZonedTimeSystem.toUtc(localDate, startMinutes,
zone)` once and `ProgramsSystem.shopEvent(id, fields, utcEpochMs)`
  assembles the entity. No system converts zones (Law 7.3,
  `.claude/rules/ecs-pipelines.md`). A gap time is refused (F4-1 (a)); a
  repeated time takes the earlier offset.
- Readers never convert: `/events` and the admin prefill (formatted in the
  page, F4-11) print the wall clock; the upcoming/past split and its order use `utcEpochMs` (a range on
  an instant, the T2 use the law allows).

---

## 2. Reader / writer matrix (re-derived 2026-10-22 on `09229b0`)

Searches run (runbook §1.4, plus): every file naming `positions`/`courses`/
`events` as a collection (`Collections.Positions|Courses|Events` in
`@core/entities` and in `firestore-paths.ts`, the helpers
`positionsCollection`/`positionDocRef`/`coursesCollection`/`courseDocRef`/
`eventsCollection`/`eventDocRef`); every importer of
`@creativo/application/programs` and `@creativo/domain/programs` in `apps/`,
`libs/`, `tools/`, `apps/web/e2e`; every `POSITION_REPOSITORY`,
`COURSE_REPOSITORY`, `SHOP_EVENT_REPOSITORY`, `Firestore*Repository` site;
every `startDateIso`, `timezone`, `PROGRAMS_ZONE`, `CourseEnrollmentStatus`,
`ShopEventId` use; `tools/seed/**`, `tools/seed-dev-catalog.mjs`,
`tools/verify/**`, `apps/web/e2e/**` (no programs reader or writer); for Law 9,
every consumer of a program port type (none on `09229b0`: `ProgramsPorts`,
`LoadPosition` … `ObserveEvents` have no consumer outside `programs.port.ts`)
and every `Pick`/`Omit` over a `*Ports` type (none).

Abbreviations as flips 1–3: `wa:` = `libs/infrastructure/firestore/src/lib/`,
`ft:` = `libs/features/`, `pl:` = `libs/ecs-core/src/pipelines/`, `sy:` =
`libs/ecs-core/src/systems/`, `co:` = `libs/ecs-core/src/components/`,
`cfg` = `apps/web/src/app/app.config.ts`, `app:` =
`libs/application/programs/src/`, `dom:` = `libs/domain/programs/src/`,
`clk:` = `libs/infrastructure/clock/src/lib/`. Package tags `[P0]`…`[P5]`
(§4); fate **del** / **rw** / **new** / **edit** / **kept**.

| Collection                   | Readers today → owner, fate, successor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Writers today → owner, fate, successor                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `positions`                  | **wa** `wa:position-repository.adapter.ts` `FirestorePositionRepository.findById` / `observeOpen` (`status == 'open'`, `orderBy sortOrder`, #12) / `observeAll` (`orderBy sortOrder`); `Position.reconstitute` per doc, one bad doc fails the stream [P1 del → `wa:programs.adapter.ts` `positionReadPorts(db): PositionReadPorts` / `positionWritePorts(db).loadPosition`]; **st** `POSITION_REPOSITORY` (cfg) → `ft:marketing/careers/…/marketing-careers.ts` (`ObserveOpenPositionsUseCase`) [P3 rw → `POSITION_READ_PORTS.observePositions(PositionStatus.Open)`], `ft:admin/programs/src/lib/admin-programs.store.ts` (`ObserveAllPositionsUseCase`) [P2 rw → `PROGRAMS_PORTS.observePositions(null)`]; `app:lib/use-cases/observe-{open,all}-positions.use-case.ts` [P5 del] | `wa:position-repository.adapter.ts` `save` (`setDoc`, `toPersistence`) [P1 del → `positionWritePorts(db).savePosition`]; `app:lib/use-cases/{create,update}-position.use-case.ts` (+ errors) [P5 del → `pl:program-content.pipeline.ts` `writePosition`]; `AdminProgramsStore.submitPosition` [P2 rw → `writePosition`] |
| `courses`                    | **wa** `wa:course-repository.adapter.ts` `findById` / `observeOpenAndUpcoming` (`enrollmentStatus in ['open','upcoming']`, `orderBy sortOrder`, #11) / `observeAll` [P1 del → `courseReadPorts(db)` / `courseWritePorts(db).loadCourse`]; **st** `COURSE_REPOSITORY` (cfg) → `ft:marketing/courses/…/marketing-courses.ts` (`ObserveCoursesUseCase`) [P3 rw → `COURSE_READ_PORTS.observeCourses([EnrollmentStatus.Open, EnrollmentStatus.Upcoming])`], the admin store (`ObserveAllCoursesUseCase`) [P2 rw → `observeCourses(null)`]; `app:lib/use-cases/observe-{courses,all-courses}.use-case.ts` [P5 del]                                                                                                                                                                       | `wa:course-repository.adapter.ts` `save` [P1 del → `courseWritePorts(db).saveCourse`]; `app:lib/use-cases/{create,update}-course.use-case.ts` (+ errors) [P5 del → `writeCourse`]; `AdminProgramsStore.submitCourse` [P2 rw]                                                                                            |
| `events`                     | **wa** `wa:event-repository.adapter.ts` `findById` / `observeUpcoming` (`startDateIso >= nowIso`, asc) / `observePast` (`<`, desc, `limit(24)`), `nowIso` from the legacy `CLOCK` once per subscription [P1 del → `shopEventReadPorts(db).observeEvents({ nowUtcMs, upcoming })` / `shopEventWritePorts(db).loadEvent`]; **st** `SHOP_EVENT_REPOSITORY` (cfg) → `ft:marketing/events/…/marketing-events.ts` (`ObserveUpcoming/PastShopEventsUseCase`, `switchMap` per tab) [P3 rw → `SHOP_EVENT_READ_PORTS` + `CLOCK_PORTS`], the admin store (`combineLatest` + `combineEventPages`) [P2 rw → `PROGRAMS_PORTS` + `CLOCK_PORTS`]; `app:lib/use-cases/observe-{upcoming,past}-shop-events.use-case.ts` [P5 del]                                                                     | `wa:event-repository.adapter.ts` `save` [P1 del → `shopEventWritePorts(db).saveEvent`]; `app:lib/use-cases/{create,update}-shop-event.use-case.ts` (+ errors) [P5 del → `writeShopEvent`]; `AdminProgramsStore.submitEvent` (`PROGRAMS_ZONE`) [P2 rw]                                                                   |
| `locations` (zone read only) | NEW reader: `writeShopEvent` through `LOCATION_LOAD_PORTS` → `wa:catalog.adapter.ts` `locationLoadPorts(db): LocationLoadPorts` (`readDoc(doc(db, Collections.Locations, id))`) [P1 new]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                       |

**`cfg` rows the flip removes** (3 class-form rows and the
`@creativo/application/programs` import) and **adds** (factory form,
`onLoadError: ecsDataUnavailable`):

- `POSITION_REPOSITORY`, `COURSE_REPOSITORY`, `SHOP_EVENT_REPOSITORY` → gone.
- `PROGRAMS_PORTS: ProgramsPorts` → `m.firestore.programsPorts(db)`;
  methods `loadPosition`, `savePosition`, `loadCourse`, `saveCourse`,
  `loadEvent`, `saveEvent`: `'promise'`; `observePositions`,
  `observeCourses`, `observeEvents`: `'observable'`.
- `POSITION_READ_PORTS: PositionReadPorts` → `m.firestore.positionReadPorts(db)`
  (`observePositions: 'observable'`).
- `COURSE_READ_PORTS: CourseReadPorts` → `m.firestore.courseReadPorts(db)`
  (`observeCourses: 'observable'`).
- `SHOP_EVENT_READ_PORTS: ShopEventReadPorts` → `m.firestore.shopEventReadPorts(db)`
  (`observeEvents: 'observable'`).
- `LOCATION_LOAD_PORTS: LocationLoadPorts` → `m.firestore.locationLoadPorts(db)`
  (`loadLocation: 'promise'`).
- Eager (no SDK): `{ provide: CLOCK_PORTS, useFactory: browserClockPorts }`,
  `{ provide: ID_PORTS, useFactory: browserIdPorts }`,
  `{ provide: DEFAULT_LOCATION_PORTS, useValue: { defaultLocationId:
TenantConfig.DEFAULT.defaultLocationId } satisfies DefaultLocationPorts }`
  (`TenantConfig` from `@core/components`; the one place the default shop
  is named on the web, as `main.ts` names `tenantTimeZone` on the server).

The comment "The class adapters still bound with the class form: the media
reader, the dormant reward progress, the avatar uploader and flip 4's
programs." loses "and flip 4's programs". Untouched: `CLOCK`, `ID_GENERATOR`
(flips 1–3 features still inject them), `MEDIA_READER`,
`REWARD_PROGRESS_READER`, `AVATAR_UPLOADER`, every flip-1/2/3 row.

**Re-derivation deltas — what the scouts' maps missed or got wrong** (each
is folded into the rows above and the packages):

1. `marketing/events` → `shared/visits` is NOT a boundary violation: both
   are `scope:app, type:feature`, and `type:feature` may depend on
   `type:feature` (`eslint.config.mjs`); `admin/loyalty` and
   `client/account` already import `@creativo/features/shared/visits`. F4-11
   reuses `formatWallClock`.
2. `firestore-paths.ts` keeps ONLY the reward-progress paths after the flip:
   the `Positions`/`Courses`/`Events` keys of its local `Collections`, the six
   programs helpers and the `@creativo/domain/programs` import all go (P1).
   No consumer outside the three deleted adapters names them.
3. No programs port has a consumer on `09229b0`, so P0 can reshape
   `ProgramsPorts` and its function types without breaking anything, and wave 0
   is green alone.
4. Nothing outside the closure imports `@creativo/application/programs` /
   `@creativo/domain/programs`: the importers are `cfg`, the three
   adapters (+ specs), `firestore-paths.ts`, the four features (+ specs) and
   the two libs themselves. The non-code references are `tsconfig.base.json`
   (two aliases), `.nxignore` (two `src/package.json` lines),
   `apps/web/tsconfig.app.json`, `libs/infrastructure/firestore/tsconfig.lib.json`
   and the four features' `tsconfig.lib.json` (project references, which
   `pnpm nx sync` rewrites). Hence F4-10.
5. The legacy `ShopEvent.isUpcoming`/`isPast`, `Position.servesLocation`/
   `isOpen`, `Course.isOpenOrUpcoming` have no production caller. Their
   rules live on as the query split (the adapter), `LocationScopeSystem.serves`
   (`sy:location-scope.system.ts`, "empty = everywhere") and
   `isEnrollmentOpenOrUpcoming` (`co:enrollment-status.data.ts`, which
   the courses page's `LISTED_STATUSES` filters `ENROLLMENT_STATUSES`
   through), so no successor code is needed (ledgered in §11).
6. A clock failure today makes the event adapter emit a `RepositoryError`
   (the page's error state). After the flip, `CLOCK_PORTS.nowUtcMs` cannot
   fail (`UtcEpochMs.of(Date.now())`), so that branch is unreachable, not a
   departure.
7. The admin form's label "Starts at (Europe/Sofia)" is static template text,
   not a zone read. It stays (F4-2).
8. `ID_GENERATOR` is injected by `admin-rhythm.store.ts` (flip 3) too, and
   `CLOCK` by many flipped features. Both tokens STAY; only the programs
   features move to `ID_PORTS`/`CLOCK_PORTS` (F4-9).

---

## 3. Contracts every package builds against

P0 lands first, alone. Its edits fix every type, system, pipeline, double,
fixture and token the other packages compile against. It changes NO
existing consumer's signature (delta 3), so wave 0 is green on its own gate.

### 3.1 Ports — the bundle map (Law 9) (P0)

`libs/ecs-core/src/ports/programs.port.ts`. The function types stay as they
are (`LoadPosition`, `SavePosition`, `ObservePositions(positionStatus |
null)`, `LoadCourse`, `SaveCourse`, `ObserveCourses(statuses | null)`,
`LoadEvent`, `SaveEvent`, `EventsQuery { nowUtcMs, upcoming }`,
`ObserveEvents(query)`). Their docs are rewritten to the after-state (no
`status ==`, no `event-repository.adapter.ts:96-126` pointer; `SaveX` = "a
full-document set of the body (the entity minus `id`), never a merge"). The
flat record goes; the focused bundles and the suite take its place:

```ts
/** The careers page's roles, live — `POSITION_READ_PORTS`. */
export type PositionReadPorts = { readonly observePositions: ObservePositions };
/** One role by id and its full-document save — the admin page's write. */
export type PositionWritePorts = {
  readonly loadPosition: LoadPosition;
  readonly savePosition: SavePosition;
};
/** The courses page's courses, live — `COURSE_READ_PORTS`. */
export type CourseReadPorts = { readonly observeCourses: ObserveCourses };
export type CourseWritePorts = {
  readonly loadCourse: LoadCourse;
  readonly saveCourse: SaveCourse;
};
/** The events page's events on one side of now, live — `SHOP_EVENT_READ_PORTS`. */
export type ShopEventReadPorts = { readonly observeEvents: ObserveEvents };
export type ShopEventWritePorts = {
  readonly loadEvent: LoadEvent;
  readonly saveEvent: SaveEvent;
};
/** The programs suite the admin page binds — `PROGRAMS_PORTS`. */
export type ProgramsPorts = PositionReadPorts &
  PositionWritePorts &
  CourseReadPorts &
  CourseWritePorts &
  ShopEventReadPorts &
  ShopEventWritePorts;
```

`libs/ecs-core/src/ports/catalog.port.ts` gains:

```ts
/** `locations/{id}`, once — `null` when absent (an event save's zone, F-4). */
export type LoadLocation = (
  id: LocationId,
) => Promise<Result<ShopLocation | null, RepositoryError>>;
/** One shop by id — `LOCATION_LOAD_PORTS`. */
export type LocationLoadPorts = { readonly loadLocation: LoadLocation };
/**
 * The deployment's main shop — configuration, not a read (F-4): a boundary
 * with no location in scope places its wall clock on this shop's zone.
 * `DEFAULT_LOCATION_PORTS`, bound from `TenantConfig.DEFAULT`.
 */
export type DefaultLocationPorts = { readonly defaultLocationId: LocationId };
```

`CatalogPorts` stays `CatalogReadPorts & CatalogLoadPorts &
ListedCatalogPorts` (the new bundle serves the web only and is not a
server catalogue member; an intersection never needs to grow).
`IdPorts`/`ClockPorts` (`tx.port.ts`) are reused unchanged.

### 3.2 Errors and inputs (P0)

- `primitives/engagement-errors.data.ts`: F4-6's four codes (after the six
  program codes), their namespace types (`ProgramNotFoundCode` = the three
  not-found codes, `ProgramNotFound { errorCode; programId: PositionId |
CourseId | EventId }`, `ShopEventZoneUnknown { errorCode; locationId:
LocationId }`, ids BRANDED, Law 7.4 / L3 lint), both factories
  (`programNotFound(errorCode, programId: PositionId | CourseId | EventId)`,
  `shopEventZoneUnknown(locationId: LocationId)`), the root
  `EngagementError` union extended, and the aliases `ProgramFieldError` /
  `ProgramSaveError` exported beside the dictionary (siblings
  `./ids.primitive` (`PositionId`, `CourseId`, `EventId`, `LocationId`, added
  to the existing `import type`), `./catalog-errors.data`,
  `./primitive-errors.data`, `./time-errors.data`, `./repository-errors.data`
  imported by `import type`). `engagement-errors.data.spec.ts` builds its
  cases with branded ids (`PositionId.of(…)`, `LocationId.of('loc-center')`).
  The file's header comment drops the `libs/domain/programs` provenance as
  "deleted by flip 4".
- `components/program-input.data.ts` (NEW, per `ecs-components.md`): the raw
  admin-form inputs, every string untrimmed (the system trims). They are
  foreign input before parse, so they carry the sanctioned `…Input` suffix:
  that is the only escape from L3 (`ECS_RAW_PRIMITIVE_RESTRICTIONS`, selector
  `TSTypeAliasDeclaration:not([id.name=/Input$/])`), which otherwise refuses
  the raw `string` on `locationIds`/`locationId`. Precedents:
  `BarberOfferingInput`, `BookingPolicyInput`, `ServiceTermsInput`,
  `MediaRefInput`. Each is a TOP-LEVEL alias. A namespace member such as
  `ProgramInput.Position` would hide the suffix from L3 and fail lint, so
  Law 1's "variants in the namespace" does not apply to these edge structs,
  exactly as in `barber-offering.data.ts`.
  - `PositionInput = { title: LocalizedText; summary: LocalizedText;
locationIds: readonly string[]; positionStatus: PositionStatus;
applyUrl: string; sortOrder: number }`
  - `CourseInput = { title; description: LocalizedText; enrollmentStatus:
EnrollmentStatus; startsLabel: LocalizedText /* both blank = none */;
applyUrl: string; sortOrder: number }`
  - `ShopEventInput = { title; description; startsAt: string /*
'YYYY-MM-DDTHH:mm' */; locationId: string; applyUrl: string; sortOrder:
number }`

  The file's one Law 1 name is `ProgramInput`: the root type
  `ProgramInput = PositionInput | CourseInput | ShopEventInput` and the
  companion `ProgramInput = { blankPosition(): PositionInput; blankCourse():
CourseInput; blankShopEvent(): ShopEventInput } as const`, returning
  today's reset values (`OPEN`, empty strings, `sortOrder: 0`,
  `locationIds: []`). These are raw edge structs (F-8), never stored. P0's
  gate `pnpm nx lint ecs-core` (it extends the root config, so it runs
  `ecsSyntaxBlocks` and L3 over this file and over
  `engagement-errors.data.ts`) must be green before wave 1 starts: a rename
  after wave 0 would spread into P2's store and §3.3/§3.4.

- `entities/event.entity.ts` (a TYPE change, not docs only): the entity is
  composed of two slices declared once (Law 2/6), so the event's field set
  has ONE home and the system imports the slice instead of re-declaring it:
  `ShopEventMeta = { readonly id: EventId; readonly utcEpochMs: UtcEpochMs }`
  (the two fields an admin never types: the id, and the instant computed at
  ingestion) and `ShopEventContent = { title; description; localDate:
LocalDate; startMinutes: MinuteOfDay; locationId: LocationId | null;
applyUrl: string | null; sortOrder: number }`, with
  `ShopEvent = ShopEventMeta & ShopEventContent`. The runtime body is
  unchanged. `entities/index.ts` already re-exports the file whole
  (`export * from './event.entity'`), so the barrel needs no edit.
  `engagement-entities.type-spec.ts` gains `Disjoint<ShopEventMeta,
ShopEventContent>` (badge-series precedent); its existing
  `IsNever<ShopEvent>` / `EveryVariantFlat<ShopEvent>` cases stay
  (`LocalizedText` is the one sanctioned nested map, F-7).

- `components/program-status.data.ts` and `enrollment-status.data.ts`: the
  JSDoc's "stored bytes stay today's lowercase until then / the shims map"
  becomes the after-state ("stored SCREAMING since flip 4"); the `Course.isOpenOrUpcoming`
  pointer names the guard's one caller, the courses page's `LISTED_STATUSES`
  (P3 builds it as `ENROLLMENT_STATUSES.filter(isEnrollmentOpenOrUpcoming)`,
  one source for the rule, review fix). No code change here.
- `entities/{position,course,event}.entity.ts`: the docs that cite the
  deleted adapters' line numbers are rewritten to the after-state (the
  conditional-spread history in one sentence, no file pointer); `event`
  also takes the slice split above.

### 3.3 The system (`sy:programs.system.ts`, P0)

Pure; it imports components, entities and primitives, and nothing from
ports or pipelines. It does NOT import `./zoned-time.system`: no system
converts zones (Law 7.3; `.claude/rules/ecs-systems.md` §Time,
`ecs-pipelines.md` "The ingestion boundary owns time"; the only non-spec
`ZonedTimeSystem.toUtc` callers on `09229b0` are pipelines). It never reads
`TenantConfig.DEFAULT`: the default shop arrives as a parameter.

```ts
// `ShopEventContent` (the event's fields before its instant) is imported
// from `@core/entities` — declared once, in event.entity.ts (§3.2).
export const ProgramsSystem = {
  position(id: PositionId, input: PositionInput): Result<Position, readonly ProgramFieldError[]>;
  course(id: CourseId, input: CourseInput): Result<Course, readonly ProgramFieldError[]>;
  eventFields(input: ShopEventInput): Result<ShopEventContent, readonly ProgramFieldError[]>;
  /** The location to read for the event's zone (F-4): its own, else the default shop. */
  zoneLocationOf(fields: ShopEventContent, defaultLocationId: LocationId): LocationId;
  /**
   * The zone that places the event, or the refusal: the named location's
   * zone; else (a typed id naming no document) the default shop's; neither
   * → `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` naming `defaultLocationId`.
   */
  zoneOf(
    named: ShopLocation | null,
    fallback: ShopLocation | null,
    defaultLocationId: LocationId,
  ): Result<TimeZone, EngagementError.ShopEventZoneUnknown>;
  /** The event with the instant the ingestion boundary computed — a pure assembler. */
  shopEvent(id: EventId, fields: ShopEventContent, utcEpochMs: UtcEpochMs): ShopEvent;
} as const;
```

Rules (F4-5, in this order of refusals): **position**: sortOrder → title →
summary → each locationId → applyUrl. **course**: sortOrder → title →
description → startsLabel (only when either locale is non-blank after
trimming) → applyUrl. **event**: startsAt (exactly `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/`;
the date through `LocalDate.parse`, the time through `MinuteOfDay.of(h*60+m)`
with `h < 24`, `m < 60`; otherwise `TimeError.invalidDateTime(raw,
DateTimeInvalidReason.Unparsable)` for the form and `.OutOfRange` for a
non-date such as `2026-02-30T10:00`) → sortOrder → title → description →
locationId → applyUrl. A valid course with both `startsLabel` locales blank
has `startsLabel: null`. Every stored string is the trimmed one.
`zoneOf` decides the zone refusal; the pipeline only reads.
The admin form's `datetime-local` prefill is NOT a system function
(formatting is the UI's, Law 5): it is `datetimeLocalOf` in
`admin-programs.ts` (F4-11, P2).

### 3.4 The pipelines (`pl:program-content.pipeline.ts`, P0)

```ts
export type WritePositionPorts = PositionWritePorts & IdPorts;
export type WriteCoursePorts = CourseWritePorts & IdPorts;
export type WriteShopEventPorts = ShopEventWritePorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  IdPorts;

/** `id: null` creates (a fresh `nextId`), an id updates an EXISTING document. */
export type WriteProgramCommand<Id, Input> = { readonly id: Id | null; readonly input: Input };

export const writePosition = (ports: WritePositionPorts) =>
  async (cmd: WriteProgramCommand<PositionId, PositionInput>):
    Promise<Result<Position, readonly ProgramSaveError[]>> => …;
export const writeCourse = (ports: WriteCoursePorts) => …;     // same shape
export const writeShopEvent = (ports: WriteShopEventPorts) => …; // same shape
```

`WriteProgramCommand` is a generic command record of the pipeline's own
call shape, not a port. If the layering verifier's "one home tier per name"
objects to a pipeline-tier type, P0 moves it to `program-input.data.ts` (a
component). The pipeline steps:

1. **Update only:** `loadX(id)`. `err` → `[that RepositoryError]`; `null` →
   `[EngagementError.programNotFound(XNotFound, id)]`. Nothing is validated
   or written after a refusal (today's order: existence first).
2. `ProgramsSystem.position|course(id, cmd.input)` (on create
   `XId.of(ports.nextId())`, an id by construction) / `eventFields(cmd.input)`.
   `err` → the field list, nothing written.
3. **Event only (the ingestion boundary):**
   `target = ProgramsSystem.zoneLocationOf(fields, ports.defaultLocationId)`;
   `named = await loadLocation(target)`; only when `named` is `null` AND
   `target !== ports.defaultLocationId`, `fallback = await
loadLocation(ports.defaultLocationId)` (else `null`). Any read `err` →
   `[RepositoryError]` (an I/O failure is the pipeline's to map). Then
   `ProgramsSystem.zoneOf(named, fallback, ports.defaultLocationId)`; `err`
   → `[EngagementError.ShopEventZoneUnknown]`. Then, ONCE,
   `ZonedTimeSystem.toUtc(fields.localDate, fields.startMinutes, zone)`;
   `err` → `[TimeError]` unchanged (`DST_GAP_INVALID_TIME`,
   `TIME_INVALID_TIME_ZONE`, `TIME_INVALID_DATE_TIME` out of range). Then
   `entity = ProgramsSystem.shopEvent(id, fields, utcEpochMs)`.
4. `saveX(entity)`. `err` → `[RepositoryError]`; `ok` → `Result.ok(entity)`.

On create the id is drawn BEFORE validation (today's `idGenerator.next()`
ran before `X.create`), so a refused create spends one id, as today. No
pipeline logs (no `TelemetryPorts` on the web, flip-3 §8.1's ruling).

### 3.5 Test support (`@core/testing`, P0)

- `testing/programs.fixtures.ts` (+ `.spec.ts`): `positionOf(id,
overrides?)`, `courseOf(id, overrides?)`, `shopEventOf(id, overrides?)`,
  plain entity literals with branded ids, each `satisfies` its entity; the
  events default to `FIXTURE_TODAY`-relative days with a pinned
  `utcEpochMs` (Sofia), never the wall clock.
- `testing/port-doubles.ts` (+ cases in `port-doubles.spec.ts`):
  `memoryProgramsWorld(seed?)` (three `Map`s plus `locations`), and over it
  `memoryProgramsPorts(world): ProgramsPorts`, `memoryPositionReadPorts(world):
PositionReadPorts`, `memoryCourseReadPorts(world): CourseReadPorts`,
  `memoryShopEventReadPorts(world): ShopEventReadPorts`,
  `memoryLocationLoadPorts(world): LocationLoadPorts`, and
  `memoryDefaultLocationPorts(defaultLocationId =
TenantConfig.DEFAULT.defaultLocationId): DefaultLocationPorts`. They
  implement the documented queries with Firestore's exact tie rule (on equal
  `orderBy` values Firestore breaks ties by `__name__` in the direction of
  the LAST `orderBy`): positions and courses (`positionStatus ===` /
  `enrollmentStatus` membership / `null` = all) by `sortOrder` ascending
  then id ascending; events upcoming = `utcEpochMs >= nowUtcMs`, ordered
  `utcEpochMs` ascending then id ascending, unlimited; events past =
  `utcEpochMs < nowUtcMs`, ordered `utcEpochMs` DESCENDING then id
  DESCENDING, then the first 24 (so on a tie at the cap the double keeps the
  same document Firestore keeps). `port-doubles.spec.ts` gains a case with
  two past events at the same `utcEpochMs` (ids `e-a`, `e-b` → `e-b` first),
  and one with 25 past events where the 24th and 25th tie. P1's
  `programs.adapter.integration.spec.ts` pins the same two orders on the
  emulator, so the double and Firestore agree. Saves write the map (a full
  replace). `memoryClockPorts(nowUtcMs = FIXTURE_NOW_UTC_MS):
ClockPorts` and `memoryIdPorts(prefix?): IdPorts` (over the existing
  `pinnedNowUtcMs`/`sequentialIds`) are added only if not already exported
  under another name (reuse first).
- `testing/index.ts`: the new lines.

### 3.6 Web tokens (`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`, P0)

`PROGRAMS_PORTS<ProgramsPorts>`, `POSITION_READ_PORTS<PositionReadPorts>`,
`COURSE_READ_PORTS<CourseReadPorts>`, `SHOP_EVENT_READ_PORTS<ShopEventReadPorts>`,
`LOCATION_LOAD_PORTS<LocationLoadPorts>`,
`DEFAULT_LOCATION_PORTS<DefaultLocationPorts>`, `CLOCK_PORTS<ClockPorts>`,
`ID_PORTS<IdPorts>`, each with a one-line JSDoc naming its bundle, and no
default factory (the root binds every one; a spec binds a double).

### 3.7 Web adapters (P1)

| New file                         | Export (each returns ONE bundle by name, or their `&`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Replaces (deleted)                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wa:programs.adapter.ts`         | `positionReadPorts(db): PositionReadPorts` (`observeQuery` of `positions` + `where('positionStatus', '==', s)` when non-null + `orderBy('sortOrder')`); `positionWritePorts(db): PositionWritePorts` (`readDoc(doc(db, Collections.Positions, id))`; `attemptWrite(path, () => setDoc(ref, body))` with `const { id, ...body } = position`); `courseReadPorts` (`where('enrollmentStatus', 'in', statuses)` when non-null + `orderBy('sortOrder')`); `courseWritePorts`; `shopEventReadPorts` (`upcoming`: `where('utcEpochMs', '>=', nowUtcMs)`, `orderBy('utcEpochMs', 'asc')`; else `'<'`, `'desc'`, `limit(PAST_EVENTS_LIMIT)` with `PAST_EVENTS_LIMIT = 24` and today's comment on why the past tab is bounded); `shopEventWritePorts`; `programsPorts(db): ProgramsPorts` = the spread of the six | `wa:position-repository.adapter.ts`, `wa:course-repository.adapter.ts`, `wa:event-repository.adapter.ts` (classes, mappers, `subscribeWithRetry` loops) |
| `wa:catalog.adapter.ts` (edit)   | `locationLoadPorts(db): LocationLoadPorts` (`readDoc(doc(db, Collections.Locations, id))`) beside `catalogReadPorts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                       |
| `clk:browser-runtime.adapter.ts` | `browserClockPorts(): ClockPorts` (`UtcEpochMs.of(Date.now())`, a `defect` on the unreachable refusal); `browserIdPorts(): IdPorts` (`crypto.randomUUID()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | — (the legacy `SystemClock`/`CryptoIdGenerator` stay for flips 1–3)                                                                                     |

Zero mapping: every read is `entityOf`, so a stored body is answered as
stored (F4-1 (b)). The adapters spell no `'status'`, no `['status']`, no
`timezone`, no conditional spread (runbook K4). Collection names come from
`@core/entities` `Collections`.

### 3.8 Store and component fields (P2, P3) — what "re-typed" means

- **`AdminProgramsStore`** (`ft:admin/programs/src/lib/admin-programs.store.ts`):
  injects `PROGRAMS_PORTS`, `LOCATION_LOAD_PORTS`, `DEFAULT_LOCATION_PORTS`,
  `CLOCK_PORTS`, `ID_PORTS`. It builds the three pipelines once
  (`writePosition({ ...programs, ...ids })`, `writeShopEvent({ ...programs,
...locations, ...defaultLocation, ...ids })` and so on: a spread
  composition, never a type alias). The lists:
  `positions` = `observePositions(null)` → `readonly Position[]` (`[]` on
  `err`); `courses` = `observeCourses(null)`; `events` = `combineLatest([
observeEvents({ nowUtcMs, upcoming: true }), observeEvents({ nowUtcMs,
upcoming: false })])` → upcoming then past, `[]` when either is `err`
  (F4-8), `nowUtcMs` read once in the constructor. The inputs:
  `PositionFormInput`/`CourseFormInput`/`ShopEventFormInput` become
  `WriteProgramCommand<XId, XInput>` = `{ id: XId | null; input: XInput }`
  (`PositionInput`/`CourseInput`/`ShopEventInput` of §3.2); `submitPosition`,
  `submitCourse`, `submitEvent` return `(await pipeline(input)).ok`.
  `PROGRAMS_ZONE`, `toResultUndefinedIfEmpty` (the system trims) and
  `combineEventPages` go, and so does `LocalizedInput` (a duplicate of
  `LocalizedText`; §6 `T4` gates it). `ProgramsTab` stays a view type.
- **`AdminPrograms`** (`admin-programs.ts` + `.html`): `positionStatus =
signal<PositionStatus>(PositionStatus.Open)`, `courseEnrollmentStatus =
signal<EnrollmentStatus>(EnrollmentStatus.Open)`; the resets read
  `ProgramInput.blank*()`; the chips compare and set the dictionary values
  (the template reads them through `protected readonly` fields, never bare
  literals); the signal `eventStartDateIso` is renamed `eventStartsAt`;
  `startEditEvent` sets `eventStartsAt(datetimeLocalOf(event.localDate,
event.startMinutes))`, a pure module-level helper in `admin-programs.ts`
  (`` `${localDate}T${HH}:${mm}` ``, zero-padded; F4-11, Law 5),
  and `eventLocationId(event.locationId ?? '')`; every `track x.id.value` →
  `track x.id`; the trailing text `{{ positionStatusWords[position.positionStatus] }}`
  / `{{ enrollmentStatusWords[course.enrollmentStatus] }}` through ONE words
  file — at integration, `@creativo/infrastructure/i18n`'s
  `program-status-words.ts` (`satisfies Record<…, string>`, today's
  lowercase text, F4-7), which the careers and courses badges read too
  (the review's three copies collapsed into it: reuse, never copy). The view-state `kind` unions stay (F4-2).
- **`MarketingCareers`**: `inject(POSITION_READ_PORTS).observePositions(PositionStatus.Open)`;
  the state union unchanged; `text(t: LocalizedText)` =
  `LocalizedText.pick(t, lang === Locale.En ? Locale.En : Locale.Bg)` (the
  legacy `get` answered `bg` for every non-`en` language); `STATUS_TONES`
  `satisfies Record<PositionStatus, UiBadgeTone>`; a words table for the
  badge text; `track position.id`.
- **`MarketingCourses`**: `COURSE_READ_PORTS.observeCourses([EnrollmentStatus.Open,
EnrollmentStatus.Upcoming])`; `CoursesTab = typeof EnrollmentStatus.Open |
typeof EnrollmentStatus.Upcoming`, default `EnrollmentStatus.Open`; the tab
  chips compare the dictionary values, test ids unchanged; `STATUS_TONES` and
  the badge words re-keyed; `text` as above; `track course.id`.
- **`MarketingEvents`**: `SHOP_EVENT_READ_PORTS` + `CLOCK_PORTS`; the
  `switchMap` reads `nowUtcMs()` once per tab subscription and calls
  `observeEvents({ nowUtcMs, upcoming: tab === 'upcoming' })`; `formatDate` per
  F4-11; `text` as above; `track event.id`. `EventsTab` stays a view union.

---

## 4. Packages

Run order by **wave**: **wave 0 = P0 alone** (the ecs-core vocabulary, the
system, the pipelines, the doubles, the tokens and the edge rows; it lands
green on its own gate) → **wave 1 = P1–P4 in parallel** → **wave 2 = P5
alone** (the legacy sweep: it can delete the two legacy libraries only once
every wave-1 importer is gone, a real dependency) → integration (§8).
Ownership is disjoint by file within a wave; a directory listed with `/**`
is owned whole. A package never edits another package's file. A needed
change is reported to the integrator. Every package obeys Law 9 in what it
writes. **Expected red while wave 1 is partial** (never a P0 type, double or
token): `cfg` before P1's factories exist; the features' specs before
P2/P3 re-target them; and `pnpm nx sync:check` until P5's `pnpm nx sync`
(§4 P5) rewrites the project references of every project whose imports
wave 1 changes: `apps/web/tsconfig.app.json`,
`libs/infrastructure/firestore/tsconfig.lib.json`,
`libs/infrastructure/clock/tsconfig.lib.json` (gains `ecs-core` through
`browser-runtime.adapter.ts`'s `@core/*` imports),
`libs/features/admin/programs/tsconfig.lib.json` (+ `tsconfig.spec.json`
if sync writes one; gains `ecs-core` and `infrastructure/firebase-app`,
loses `application/shared` and `application/programs`),
`libs/features/marketing/events/tsconfig.lib.json` (gains
`features/shared/visits`, F4-11), and the careers/courses features (lose
`application/programs`). No wave-1 package edits a `tsconfig*.json`
reference by hand.

### P0 — ecs-core vocabulary, system, pipelines, doubles, tokens · wave 0

**Change:** `libs/ecs-core/src/ports/{programs,catalog}.port.ts`;
`libs/ecs-core/src/primitives/engagement-errors.data.ts` (+ `.spec.ts`);
`libs/ecs-core/src/components/{program-status,enrollment-status}.data.ts`
(docs only), `components/index.ts` (one line);
`libs/ecs-core/src/entities/{position,course}.entity.ts` (docs only),
`entities/event.entity.ts` (docs AND the `ShopEventMeta & ShopEventContent`
slice split of §3.2, a type change),
`entities/engagement-entities.type-spec.ts` (cases: `ProgramsPorts` members
are exactly the nine, each bundle non-`never`; `Disjoint<ShopEventMeta,
ShopEventContent>`);
`libs/ecs-core/src/systems/index.ts`, `libs/ecs-core/src/pipelines/index.ts`
(one line each); `libs/ecs-core/src/testing/{port-doubles,index}.ts`
(+ `port-doubles.spec.ts`);
`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts` (+ its barrel if
it lists names); `apps/functions/src/edge.ts` (the four F4-6 rows only),
`apps/functions/src/edge.spec.ts` (only if a floor or table counts the
engagement rows).
**New:** `components/program-input.data.ts` (+ `.spec.ts`);
`systems/programs.system.ts` (+ `.spec.ts`);
`pipelines/program-content.pipeline.ts` (+ `.spec.ts`);
`testing/programs.fixtures.ts` (+ `.spec.ts`).
**Brief:** §3.1–§3.6 verbatim. Write `programs.system.spec.ts` FROM the
three deleted domain specs and `program-content.pipeline.spec.ts` FROM the
four deleted use-case specs, case by case (§5.1), before wave 2 deletes
them. The pipeline spec asserts the saved entity (the full body), the
refusal list and that NOTHING was saved after a refusal, with pinned
`nextId` and `@core/testing` doubles. The system spec covers every F4-5 rule
and boundary (sortOrder `0`, `-1`, `1.5`; an applyUrl of spaces → `null`, `https://x.test` → trimmed and kept, `not a url` refused; a one-sided
`startsLabel` refused, both blank → `null`; `2026-02-30T10:00` and
`2026-11-05T19:00:00` refused; `zoneLocationOf` (own id, else the default);
`zoneOf` (named → its zone; named `null` + fallback → the fallback's zone;
both `null` → `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` naming the default id);
`shopEvent` assembles exactly the given instant; collect-all order; purity:
same input → same output, inputs unchanged). The zone CONVERSION pins live
in `program-content.pipeline.spec.ts` (the ingestion boundary owns
`ZonedTimeSystem.toUtc`): the Sofia gap `2027-03-28T03:30` →
`DST_GAP_INVALID_TIME` and nothing saved; the repeat `2026-10-25T03:30` →
the `+03:00` instant saved; a typed unknown location → saved on the
default's zone; the default absent → `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN`,
nothing saved; a location read `err` → that `RepositoryError`. The docs P0 owns must not spell a §6 word
(`'status'`, `startDateIso`, `timezone`, the retired class names). Before
landing: `git grep -nE "(ProgramsPorts|LoadPosition|ObserveEvents|EventsQuery)"`
outside `libs/ecs-core` must be empty (it is on `09229b0`). **Gate on its
own:** `pnpm nx typecheck ecs-core`, `pnpm nx test ecs-core --coverage`,
`pnpm nx lint ecs-core` (green: it applies the root `ecsSyntaxBlocks`,
so L3 judges `program-input.data.ts`, `engagement-errors.data.ts` and
`event.entity.ts`; a red here means a contract rename, which must happen
BEFORE wave 1 starts), `pnpm nx run verify-tools:layering --skip-nx-cache`,
`pnpm nx run-many -t typecheck --skip-nx-cache` (baseline reds only),
`pnpm nx test functions -- edge.spec`, `pnpm nx typecheck firebase-app`.
Land before wave 1 starts.

### P1 — web data layer (`libs/infrastructure/**`, `cfg`) · wave 1

**New:** `wa:programs.adapter.ts` (+ `.spec.ts`, `.integration.spec.ts`);
`clk:browser-runtime.adapter.ts` (+ `.spec.ts`).
**Change:** `wa:catalog.adapter.ts` (+ `catalog.adapter.spec.ts`, and
`catalog.adapter.integration.spec.ts` one case: a seeded location read once,
an absent id → `null`); `wa:firestore.adapters.ts` (export
`./programs.adapter`, drop the three class adapters, rewrite the "class
adapters still bound…" comment to name only the dormant reward progress);
`wa:firestore-paths.ts` (delta 2); `libs/infrastructure/clock/src/index.ts`
(one line); `cfg` (§2's rows and the import).
**Delete:** `wa:{position,course,event}-repository.adapter.ts` and their
three specs.
**Brief:** §3.7. Write `programs.adapter.spec.ts` FROM the three deleted
adapter specs (mocked `firebase/firestore`, as they did): the round trip
(save writes the body minus `id` with `setDoc`, no merge; load answers `{
id, ...data }`), absent → `null`, each query's exact constraints (positions
with and without the status filter, courses with and without `in`, events
upcoming `>=`/`asc`/no limit and past `<`/`desc`/`limit(24)`), and "a stored
body is answered as stored" for each collection (F4-1 (b)). The integration
spec runs against the emulator: seeded flat bodies read back through every
query, in `sortOrder` (events by `utcEpochMs`) order, the past side capped at
24 (seed 25), with the tie order of §3.5 pinned (two past events at the same
`utcEpochMs` come back id DESCENDING; two upcoming ones id ascending), so
the memory double and Firestore agree. `cfg`: build `nx build web` locally (the factory rows'
`methods` must list every bundle member; `provideLazyPort` refuses a
missing one at startup).

### P2 — the admin programs page · wave 1

**Change:** `ft:admin/programs/src/lib/admin-programs.store.ts`,
`ft:admin/programs/src/lib/admin-programs/{admin-programs.ts,admin-programs.html,admin-programs.spec.ts}`.
**New:** `ft:admin/programs/src/lib/admin-programs/admin-programs.words.ts` (moved at integration to `libs/infrastructure/i18n/src/lib/program-status-words.ts`, shared with the marketing badges).
**Brief:** §3.8 (store and page). The spec binds `PROGRAMS_PORTS` (over
`memoryProgramsWorld`), `LOCATION_LOAD_PORTS` (the world's locations, seeded
with a `loc-center` in `Europe/Sofia`), `DEFAULT_LOCATION_PORTS`
(`memoryDefaultLocationPorts()`), `CLOCK_PORTS` (pinned) and `ID_PORTS`
(`sequentialIds`). Its five cases stay (titles unchanged; "saves a new
position" asserts the world's document is the flat body with
`positionStatus: 'OPEN'`, `locationIds: []`, `applyUrl: null`). New cases:
an edit of a position whose stored `locationIds` is non-empty saves `[]`
(F4-8); the Positions tab's trailing status text reads `open`/`closed`
(F4-7); the Courses tab's trailing status text reads `open` / `upcoming` /
`closed` (F4-7: `{{ course.enrollmentStatus }}` is a raw print today too,
and its values turn SCREAMING); a course with
a one-sided starts label is refused and saves nothing; an event saved from
`2026-11-05T19:00` stores `localDate`, `startMinutes: 1140` and the Sofia
instant; the event prefill shows `2026-11-05T19:00`, and one at 09:05 shows
`…T09:05` (the `datetimeLocalOf` zero-padding, F4-11); a gap time
(`2027-03-28T03:30`) shows the error line and saves nothing (F4-1 (a)); a
typed unknown location saves on the default zone (F4-1 (c)); the events list
is upcoming-then-past with the pinned now. Run `pnpm nx build web` (template
errors are invisible to `typecheck`).

### P3 — the three public pages · wave 1

**Change:** `ft:marketing/careers/src/lib/marketing-careers/{marketing-careers.ts,.html,.spec.ts}`,
`ft:marketing/courses/src/lib/marketing-courses/{marketing-courses.ts,.html,.spec.ts}`,
`ft:marketing/events/src/lib/marketing-events/{marketing-events.ts,.html,.spec.ts}`.
**Brief:** §3.8 (the three pages), F4-7, F4-11. Every spec keeps its cases
(titles unchanged) and builds its fixtures through `@core/testing`
(`positionOf`/`courseOf`/`shopEventOf`, the read doubles); the events spec
pins `CLOCK_PORTS` to `FIXTURE_NOW_UTC_MS` (no 2030 dates against the wall
clock). New cases: the careers badge TEXT is `open` (F4-7), and `closed` for a
closed role; the courses badge text `upcoming` with tone `warning`; the
events row's formatted date pinned literally in `en` AND `bg`. Take the
expected strings from today's code first: run the legacy
`formatDate` once (a scratch script under the scratchpad over
`ZonedDateTime.toLocaleString`, never committed) and paste its output, so
the pin proves F4-11. The past tab re-queries with `upcoming: false` and
the same pinned now. Run `pnpm nx build web`.

### P4 — data plane and docs · wave 1

**Change:** `firestore.indexes.json` (#12: the `positions` field
`status` → `positionStatus`; and a NEW fieldOverride `{ "collectionGroup":
"positions", "fieldPath": "locationIds", "indexes": [] }`: never queried,
Law 5, as `services.locationIds`; nothing else); `docs/architecture/firestore-runbook.md`
(§1.1 the programs row re-derived to §2's after-state; §4.4 replaced by this
plan's §6 block; the "Fields removed" paragraph of §4.4 rewritten:
positions `status` → `positionStatus` SCREAMING, courses' values SCREAMING,
events `startDateIso`/`timezone` → `localDate`/`startMinutes`/`utcEpochMs`,
no conditional spreads; §4.0's `W4`/`K4` arrays kept in step with §6;
§4.5 confirmed to still read the updated §4.0 `W4` (it spreads
`"${W4[@]}"` into its removed-fields gate) and left otherwise unchanged,
with its closing sentence extended: "the graph/bundle half is deferred to
Phase 4, flip-4 plan F4-2"; §3 (deploy order) gains the precondition
"before the web carrying flip 4 deploys, `locations/<TenantConfig.DEFAULT.defaultLocationId>`
(`loc-center` in the seed; the production id is flatten-spec OQ-2's) exists
in the target project with a valid IANA `timeZone`; otherwise every event
save there that names no location, or names one with no document, is
refused `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN`").
**Brief:** no rules edit (§1.1). Do NOT touch `firestore.rules` or the rules
spec. Gate: `node -e` the index gate of §6 alone, plus
`pnpm exec prettier --check` on both files.

### P5 — the legacy sweep · wave 2

**Delete (F4-10):** `libs/application/programs/**` and `libs/domain/programs/**`
(their `project.json`, `tsconfig*.json`, `eslint.config.mjs`, `vite`/`vitest`
configs, README, every source and spec).
**Change:** `tsconfig.base.json` (the `@creativo/domain/programs` and
`@creativo/application/programs` aliases), `.nxignore` (the two
`…/programs/src/package.json` lines); then `pnpm nx sync` rewrites the
project references of every project wave 1 changed, the full set of §4's
"Expected red" (`apps/web/tsconfig.app.json`,
`libs/infrastructure/firestore/tsconfig.lib.json`,
`libs/infrastructure/clock/tsconfig.lib.json`, the four features'
`tsconfig.lib.json` incl. `admin/programs` (+ its `tsconfig.spec.json` if
sync writes one) and `marketing/events` (+ `shared/visits`)), and P5
commits nothing else. A `tsconfig*.json` that sync rewrites outside that
list is reported, not reverted.
**Brief:** run only after wave 1 is merged. Re-run the importer grep first
(`git grep -n "@creativo/application/programs\|@creativo/domain/programs\|libs/application/programs\|libs/domain/programs" -- . ':(exclude)*.md'`
must list only the two libraries' own files and the config lines above). A
hit elsewhere stays and is reported. Ledger every deleted case (§5.1, §11).
`libs/domain/catalog` stays (other importers), as does `libs/domain/kernel`.
Gate: `pnpm nx sync:check`, `pnpm nx run-many -t typecheck --skip-nx-cache`,
`pnpm nx run-many -t lint`, `pnpm nx graph --file=stdout` shows no
`programs`/`domain-programs` project.

---

## 5. Specs

### 5.1 Deleted (cases live elsewhere; §11's ledger proves each)

Counts are `it(`/`test(` lines measured on `09229b0`.

| Deleted spec (cases)                                                                                                                                                             | Owner | Successor(s) holding its cases                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wa:position-repository.adapter.spec.ts` (4)                                                                                                                                     | P1    | `wa:programs.adapter.spec.ts` (round trip, absent → `null`, the open filter, the unfiltered admin query)                                                                                                                                                                                                                                                                         |
| `wa:course-repository.adapter.spec.ts` (4)                                                                                                                                       | P1    | `wa:programs.adapter.spec.ts` (+ `.integration.spec.ts`)                                                                                                                                                                                                                                                                                                                         |
| `wa:event-repository.adapter.spec.ts` (4)                                                                                                                                        | P1    | `wa:programs.adapter.spec.ts`: "round-trips … the location and zone" keeps the location; the zone half is `dead:` (no zone field, F4-4), its successor the pipeline spec's zone-from-location cases                                                                                                                                                                              |
| `dom:lib/position.spec.ts` (11)                                                                                                                                                  | P5    | `sy:programs.system.spec.ts` (valid; applyUrl → `null`; blank title; negative sortOrder; malformed URL; empty locationId; collect-all); `sy:location-scope.system.spec.ts` (empty = everywhere; scoped); `dead:` "rejects an empty id" (ids by construction, `nextId` or a stored doc id) and "validates identically to create()" (no `reconstitute`, F4-1 (b))                  |
| `dom:lib/course.spec.ts` (8)                                                                                                                                                     | P5    | `sy:programs.system.spec.ts`; `co:enrollment-status.data.spec.ts` ("closed is not open-or-upcoming"); `dead:` the empty id and `reconstitute` cases (as above)                                                                                                                                                                                                                   |
| `dom:lib/shop-event.spec.ts` (10)                                                                                                                                                | P5    | `sy:programs.system.spec.ts` (valid; null location/applyUrl; invalid start; negative sortOrder; malformed URL); "rejects an invalid timezone" → `sy:zoned-time.system.spec.ts`'s unknown-zone case (the zone is a location's, F4-4); "is upcoming/past" → `wa:programs.adapter.spec.ts` (the instant split) and `testing/port-doubles.spec.ts`; `dead:` empty id, `reconstitute` |
| `app:lib/use-cases/create-position.use-case.spec.ts` (2), `update-position.use-case.spec.ts` (2), `create-course.use-case.spec.ts` (2), `create-shop-event.use-case.spec.ts` (2) | P5    | `pl:program-content.pipeline.spec.ts` (creates and saves; refuses a blank title / description / invalid start and saves nothing; closes an existing position; refuses a missing one as `ENGAGEMENT_POSITION_NOT_FOUND`)                                                                                                                                                          |

Web 3 files / 12 cases; domain 3 files / 29 cases; application 4 files / 8
cases.

### 5.2 Re-targeted

`ft:admin/programs/…/admin-programs.spec.ts` (5 kept + §4 P2's new),
`ft:marketing/{careers,courses,events}/…/*.spec.ts` (5, 4, 3 kept + §4 P3's
new), `primitives/engagement-errors.data.spec.ts` (the new factories and
codes), `wa:catalog.adapter.spec.ts` (+ `loadLocation`),
`testing/port-doubles.spec.ts` (the programs doubles' contract),
`entities/engagement-entities.type-spec.ts` (the bundle split),
`apps/functions/src/edge.spec.ts` (only if a count moves; "one rule per
code" must hold with the four new dotted codes). Unchanged and expected
green: `wa:firestore.rules.integration.spec.ts` (`programs` cases, `{ title }`
bodies), `co:program-status.data.spec.ts`, `co:enrollment-status.data.spec.ts`.

### 5.3 New

`sy:programs.system.spec.ts`; `pl:program-content.pipeline.spec.ts`;
`co:program-input.data.spec.ts`; `testing/programs.fixtures.spec.ts`;
`wa:programs.adapter.spec.ts`; `wa:programs.adapter.integration.spec.ts`;
`clk:browser-runtime.adapter.spec.ts` (an instant within the test's own
`Date.now()` bracket, a UUID v4 shape; no time-of-day dependence). The pins
of the departures and of F4-7/F4-8/F4-11 named in §4 P2/P3.

### 5.4 The case ledger (the proof)

P1 and P5 each return, for every spec they delete, a ledger line per case:
`<deleted file>:<it title> → <successor file> › <describe> › <it title>` or
`dead: <reason>` (an id that is never foreign input any more; the legacy
`reconstitute` re-validation, F4-1 (b); a zone field that no longer exists,
F4-4; a legacy class). The integrator appends them as §11 in the flip
commit, grepping every successor title in its file. A deleted case with
neither a successor nor a reason blocks the flip. P2/P3 report only cases
they could not keep (expected: none). §11.4 lists the six F4-1 departures
with the spec case that pins each.

---

## 6. The per-flip grep gate

Paste once per shell; it passes when every `gate` prints `ok`. It runs after
flip 4 lands, with flips 1–3 landed: (1) the blocks of runbook §4.1–§4.3 as
they stand (no flip-4 exclusion exists in them, so a hit is a regression),
then (2) the block below. P4 copies it into runbook §4.4 (replacing today's
block, whose `W4`/`K4`/`index_gate` it subsumes).

```bash
cd "$(git rev-parse --show-toplevel)" || echo 'ERROR run this inside the repository'
STORE=(apps/functions/src libs/infrastructure tools/seed tools/seed-dev-catalog.mjs
       apps/web/e2e apps/web/src/testing tools/verify firestore.rules
       libs/ecs-core/src/pipelines libs/ecs-core/src/ports libs/ecs-core/src/testing)
REVIEW=(libs/features apps/web/src/app)
NOT_FS=(':(exclude)libs/infrastructure/web-storage/**' ':(exclude)*.md')
# The flip's own files: the programs adapter, the four features, the system, the pipeline.
FLIPPED4=(libs/features/admin/programs libs/features/marketing/careers
          libs/features/marketing/courses libs/features/marketing/events
          ':(glob)libs/infrastructure/**/*program*' ':(glob)libs/infrastructure/**/*position*'
          ':(glob)libs/infrastructure/**/*course*' ':(glob)libs/infrastructure/**/*event*'
          libs/ecs-core/src/systems/programs.system.ts libs/ecs-core/src/pipelines/program-content.pipeline.ts
          libs/ecs-core/src/components/program-input.data.ts)

# Removed document fields (whole words; runbook W4). `timezone` is scoped to the flip's files:
# `edge.ts`, `tenant-zone.ts` and the shop location's docs spell it for other reasons.
W4=(-e startDateIso)
W4z=(-e timezone)
# Removed keys, the old status spellings and conditional spreads (exact strings; runbook K4).
K4=(-e "['timezone']" -e "timezone:" -e "&& { applyUrl" -e "&& { locationId"
    -e "(startsLabel &&" -e "['status']" -e "'status'" -e "position.status" -e ".status ==="
    -e "startDate.toISO" -e ".startDate." -e "localized.get(" -e ".get(this.transloco" -e ".id.value"
    -e "{{ course.enrollmentStatus }}" -e "{{ position.positionStatus }}" -e "{{ position.status }}")
# Tokens, classes, helpers and constants the flip retires (whole words).
T4=(-e POSITION_REPOSITORY -e COURSE_REPOSITORY -e SHOP_EVENT_REPOSITORY
    -e PositionRepository -e CourseRepository -e ShopEventRepository
    -e FirestorePositionRepository -e FirestoreCourseRepository -e FirestoreEventRepository
    -e CreatePositionUseCase -e UpdatePositionUseCase -e CreateCourseUseCase -e UpdateCourseUseCase
    -e CreateShopEventUseCase -e UpdateShopEventUseCase -e ObserveOpenPositionsUseCase
    -e ObserveAllPositionsUseCase -e ObserveCoursesUseCase -e ObserveAllCoursesUseCase
    -e ObserveUpcomingShopEventsUseCase -e ObservePastShopEventsUseCase
    -e ShopEventId -e CourseEnrollmentStatus -e PROGRAMS_ZONE -e combineEventPages
    -e positionsCollection -e positionDocRef -e coursesCollection -e courseDocRef
    -e eventsCollection -e eventDocRef -e toResultUndefinedIfEmpty
    -e eventStartDateIso -e LocalizedInput)
# Stale pointers to the files and libraries this flip deletes (exact strings).
F4=(-e position-repository.adapter -e course-repository.adapter -e event-repository.adapter
    -e '@creativo/application/programs' -e '@creativo/domain/programs'
    -e 'libs/application/programs' -e 'libs/domain/programs'
    -e 'application/programs/' -e 'domain/programs/')
# Law 9 (copied from flip 3, unchanged).
CODE=(apps libs tools ':(exclude)*.md' ':(exclude)tools/lint-rules/**')
SLICE='(^|[^A-Za-z0-9_])(Pick|Omit)<[[:space:]]*(readonly[[:space:]]+)?[A-Za-z0-9_.]*Ports([^A-Za-z0-9_]|$)'
NOT_PORTS='[A-Z]([A-Za-z0-9_]*[A-Za-rt-z0-9_]|[A-Za-z0-9_]*[A-Za-su-z0-9_]s|[A-Za-z0-9_]*[A-Za-qs-z0-9_]ts|[A-Za-z0-9_]*[A-Za-np-z0-9_]rts|[A-Za-z0-9_]*[A-OQ-Za-z0-9_]orts)'
R9=(-e AccountReadPorts -e AuthClaimsPorts -e CryptoPorts)

FAILED=0
gate() { local label=$1; shift
  git grep --untracked -nI "$@"
  case $? in 0) echo "FAIL  $label"; FAILED=1 ;; 1) echo "ok    $label" ;; *) echo "ERROR $label"; FAILED=1 ;; esac; }
review() { local label=$1; shift; echo "----  review: $label"; git grep --untracked -nI "$@" || echo "      (none)"; }

gate 'flip 4 · removed fields'                 -wF "${W4[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}"
gate 'flip 4 · no zone field in the flip'      -wF "${W4z[@]}" -- "${FLIPPED4[@]}" "${NOT_FS[@]}"
gate 'flip 4 · removed keys and spreads'       -F  "${K4[@]}" -- "${FLIPPED4[@]}" "${NOT_FS[@]}"
gate 'flip 4 · retired tokens and classes'     -wF "${T4[@]}" -- apps libs tools "${NOT_FS[@]}"
gate 'flip 4 · stale pointers'                 -F  "${F4[@]}" -- apps libs tools tsconfig.base.json .nxignore "${NOT_FS[@]}"
[ ! -e libs/application/programs ] && [ ! -e libs/domain/programs ] \
  && echo 'ok    flip 4 · the legacy libraries are gone' || { echo 'FAIL  flip 4 · the legacy libraries are gone'; FAILED=1; }
RULES4=$(grep -cE 'match /(positions|courses|events)/\{[A-Za-z]+\} \{' firestore.rules)
WRITES4=$(grep -A2 -E 'match /(positions|courses|events)/\{' firestore.rules | grep -c 'allow write: if isCatalogManager();')
[ "$RULES4" = 3 ] && [ "$WRITES4" = 3 ] \
  && echo 'ok    flip 4 · rules keep their three shape-free blocks' \
  || { echo "FAIL  flip 4 · rules (blocks $RULES4, catalogue-manager writes $WRITES4)"; FAILED=1; }
gate 'flip 4 · the suite is an intersection'   -F  -e 'export type ProgramsPorts = {' -- libs/ecs-core/src/ports
node -e '
  const { indexes = [], fieldOverrides = [] } = require(process.cwd() + "/firestore.indexes.json");
  const groups = new Set(["positions", "courses", "events"]);
  const removed = /^(status|startDateIso|timezone)$|[.]|^(kind|type)$/;
  const bad = [
    ...indexes.filter((i) => groups.has(i.collectionGroup)).flatMap((i) => i.fields.map((f) => [i.collectionGroup, f.fieldPath])),
    ...fieldOverrides.filter((o) => groups.has(o.collectionGroup) && o.indexes.length > 0).map((o) => [o.collectionGroup, o.fieldPath]),
  ].filter(([, p]) => removed.test(p));
  for (const [g, p] of bad) console.log(`firestore.indexes.json: ${g} -> ${p}`);
  const keys = (g) => indexes.filter((i) => i.collectionGroup === g).map((i) => i.fields.map((f) => f.fieldPath).join(","));
  const miss = [];
  if (!keys("positions").includes("positionStatus,sortOrder")) miss.push("positions #12 not re-keyed to positionStatus,sortOrder");
  if (!keys("courses").includes("enrollmentStatus,sortOrder")) miss.push("courses #11 missing");
  if (keys("events").length > 0) miss.push("events needs no composite index");
  if (!fieldOverrides.some((o) => o.collectionGroup === "positions" && o.fieldPath === "locationIds" && o.indexes.length === 0))
    miss.push("positions.locationIds override missing");
  for (const m of miss) console.log(`firestore.indexes.json: ${m}`);
  process.exit(bad.length || miss.length ? 1 : 0);
' && echo 'ok    flip 4 · indexes' || { echo 'FAIL  flip 4 · indexes'; FAILED=1; }
# Law 9 (port composition) — flip 3's block, unchanged.
gate 'flip 4 · Law 9 no Pick/Omit of a *Ports type'   -E -e "$SLICE" -- "${CODE[@]}"
gate 'flip 4 · Law 9 ports tier holds no Pick/Omit'   -E -e '(^|[^A-Za-z0-9_])(Pick|Omit)<' -- libs/ecs-core/src/ports
gate 'flip 4 · Law 9 no bundle record outside ports'  -E -e 'type [A-Za-z0-9_]*Ports(<[^>]*>)? = \{' \
  -- "${CODE[@]}" ':(exclude)libs/ecs-core/src/ports/**'
gate 'flip 4 · Law 9 inline member in a *Ports intersection' -E \
  -e 'Ports(<[^>]*>)? = [^;]*&[[:space:]]*\{' -e 'Ports(<[^>]*>)? =[[:space:]]*$' \
  -- "${CODE[@]}" ':(exclude)libs/ecs-core/src/ports/**'
gate 'flip 4 · Law 9 pipeline XPorts hold no record' -E -e 'export type [A-Za-z0-9_]+Ports = [^;]*\{' \
  -- libs/ecs-core/src/pipelines
gate 'flip 4 · Law 9 adapter factories return *Ports' -E \
  -e "^export const [a-zA-Z]+ = (<[^>]*>)?\\([^)]*\\): ${NOT_PORTS}([^A-Za-z0-9_]|\$)" \
  -- 'apps/functions/src/adapters/*.adapter.ts' 'libs/infrastructure/**/*.adapter.ts' \
  ':(exclude)apps/functions/src/adapters/firestore-tx.adapter.ts'
gate 'flip 4 · Law 9 no port function type outside ports' -E \
  -e '^export type [A-Z][A-Za-z0-9_]* =[[:space:]]*(<[^>]*>)?\([^)]*\)[[:space:]]*=>' \
  -- libs/ecs-core/src/pipelines apps/functions/src libs/infrastructure
gate 'flip 4 · Law 9 retired bundles'                 -wF "${R9[@]}" -- "${CODE[@]}"
review 'flip 4 · Law 9 *Ports aliases outside ports/pipelines (expect only intersections: FirestorePorts, EdgePorts, ServerPorts)' \
  -E -e 'type [A-Za-z0-9_]*Ports(<[^>]*>)? =' -- "${CODE[@]}" \
  ':(exclude)libs/ecs-core/src/ports/**' ':(exclude)libs/ecs-core/src/pipelines/**'
review 'flip 4 · lowercase status literals in the flipped features (expect only the words tables and test ids)' \
  -E -e "'(open|closed|upcoming)'" -- libs/features/admin/programs libs/features/marketing/careers \
  libs/features/marketing/courses libs/features/marketing/events
[ "$FAILED" = 0 ] && echo 'flip 4 gate: PASS' || echo 'flip 4 gate: FAIL'
```

Notes. (1) The rules check counts, rather than greps for absence: the three
programs `match` blocks must still be there, each still writing
`if isCatalogManager()` (rules change shape only, and here not at all,
F4-2). (2)
`K4` runs over `FLIPPED4` only: `.id.value` and `.status ===` are legacy
class reads that must leave the flip's files (`track x.id.value`), but other
flips' files and the frozen wires legitimately spell `'status'`
(runbook `WIRE_FILES`). (3) `W4z` (`timezone`) is scoped the same way:
`apps/functions/src/edge.ts`, `lib/booking/tenant-zone.ts`,
`entities/shop-location.entity.ts` docs and `tenant-config.data.spec.ts`
spell it for reasons outside this flip (measured on `09229b0`).
(4) `T4` runs over all of `apps libs tools` with no `libs/domain/**`
exclusion, because P5 deletes both legacy programs libraries (F4-10).
Measured on `09229b0` (the block dry-runs FAIL on the eight flip gates and
`ok` on the rules check and all eight Law 9 gates): every hit of `W4`,
`T4` and `F4` outside the two legacy libraries falls in a file a package
deletes or owns, or in a project reference that P5's `pnpm nx sync`
rewrites. `programs.port.ts` ("Successor of `PositionRepository`…"),
`enrollment-status.data.ts` (`CourseEnrollmentStatus`), the three entity
docs (`*-repository.adapter.ts` pointers) and `engagement-errors.data.ts`
(`libs/domain/programs`) are P0's doc rewrites. The words added on review
were dry-run on `09229b0` and each FAILS before the flip, only in files a
package owns or deletes: `.startDate.` (`admin-programs.ts`,
`marketing-events.ts`, the event adapter + spec), `localized.get(` and
`.get(this.transloco` (the three marketing pages), `{{ course.enrollmentStatus }}`
(`admin-programs.html`, `marketing-courses.html`), `{{ position.status }}`
(`admin-programs.html`, `marketing-careers.html`), `eventStartDateIso`
(`admin-programs.ts`/`.html`), `LocalizedInput` (`admin-programs.store.ts`);
`{{ position.positionStatus }}` has no hit (it guards a raw print of the NEW
field). `-w startDateIso` alone could not catch `eventStartDateIso` (a
different case and no word boundary), hence the separate `T4` word. (5)
The Law 9 gates complement `creativo/no-sliced-ports` in
`pnpm nx run-many -t lint`; on `09229b0` every one of them is `ok`, so a hit
after integration is a regression. (6) The integrator dry-runs the block on
the integrated tree before §8 step 3 closes and records the measured state.

---

## 7. Deletions

### 7.1 Deletion rule

A file is deleted in the flip commit when `git grep` shows no importer of it
and `pnpm nx run-many -t typecheck --skip-nx-cache` stays green, never
earlier because a successor exists. Checked against `09229b0`'s import
graph:

- **P1:** `wa:position-repository.adapter.ts`, `wa:course-repository.adapter.ts`,
  `wa:event-repository.adapter.ts` (+ their three specs). Importers:
  `firestore.adapters.ts` (P1 edits it) and their own specs. The six
  programs helpers and keys of `wa:firestore-paths.ts` (importers: the three
  deleted adapters).
- **P5 (wave 2):** `libs/application/programs/**` (3 ports, 12 use cases,
  7 error files, 4 specs, `public-reexports.ts`, `index.ts`, project files)
  and `libs/domain/programs/**` (`position`, `course`, `shop-event`, `ids`,
  `localized-text` and their `.errors.ts`, 3 specs, `index.ts`, project
  files). Importers after wave 1: none outside themselves (§2 delta 4).

**Survivors, with the importer that keeps them:** `wa:firestore-paths.ts`
(the reward-progress paths) ← `reward-progress-reader.adapter.ts`;
`libs/domain/catalog/**` ← flips 1–3's remaining legacy users;
`libs/application/shared` (`CLOCK`, `ID_GENERATOR`, `RepositoryError`) ←
the other features and `cfg`; `libs/infrastructure/clock`'s `SystemClock`,
`CryptoIdGenerator` ← `cfg`'s `CLOCK`/`ID_GENERATOR` rows. Each package
re-runs the importer grep for its deletions at integration; a file that
still has an importer stays and is reported.

---

## 8. Integration and gates

1. **Wave 0:** merge P0 alone, green on its own gate. **Wave 1:** P1–P4 in
   parallel, then merged. **Wave 2:** P5 on the merged tree.
2. Deletion re-check (§7.1); `pnpm nx sync` then `pnpm nx sync:check`.
3. The full gate of `HANDOFF.md` §4, all green but the baseline reds
   (typecheck of `patterns`, `staff-client-card`, `staff-dashboard`
   spec-only; unit `gauge.spec.ts` (4), `visit-pills.spec.ts` (1),
   `visits-page.presenter.spec.ts` "strikes an hour that did not happen" (1);
   e2e exactly 19 failures with 41 passed — 6 `*-screenshots`,
   `landing.spec.ts:120`, 12 `client-card-glance` runs at `:343`/`:686`;
   the `appointments.spec.ts:152` flake, re-run alone with
   `--repeat-each=3`):
   - `pnpm nx sync:check`, `pnpm nx run verify-tools:layering --skip-nx-cache`,
     `pnpm nx run-many -t typecheck --skip-nx-cache`,
     `pnpm nx run-many -t lint`, `pnpm nx run-many -t test --parallel=3`,
     `pnpm nx test ecs-core --coverage`, `pnpm nx typecheck seed-tools`
   - `pnpm nx build web`, `pnpm run verify:bundle` (the new eager files,
     `ports.tokens.ts` and `browser-runtime.adapter.ts`, must not pull the
     Firestore SDK into the initial chunk),
     `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs`
   - **one at a time** (shared ports): `pnpm run verify:p0`,
     `pnpm run test:emulator` (the new `programs.adapter.integration.spec.ts`,
     the `catalog.adapter.integration.spec.ts` location case, the unchanged
     rules spec), `pnpm run e2e:web` (no programs journey; the baseline only)
   - the grep gate of §6 and `pnpm nx run lint-rules:test`
   - **the end-of-3b grep gate** (flip 4 is the last 3b flip): runbook
     §4.5's block, run after the §4.0 preamble with P4's updated `W4`/`K4`,
     must print `end-of-3b gate: PASS`; the integrator records the output in
     §8.1. The blueprint's graph/bundle half (no `functions →
libs/application/*` edge, no `@angular/*`/`rxjs` in
     `dist/apps/functions/package.json`, the `functions-deps.baseline.json`
     re-record) is NOT run as a gate: it is deferred to Phase 4 (F4-2). The
     integrator still records its measured state in §8.1 (the
     `git grep -lE '@creativo/(application|domain)/' -- apps/functions`
     hits and the dist dependency keys) so Phase 4 starts from a number.
     `check-functions-deps.mjs` (above) runs against the UNCHANGED baseline.
   - **a `pnpm run dev` smoke** on a wiped, reseeded emulator
     (`pnpm run seed:dev`; no programs data exists, so every document below
     is created through the page), signed in as a catalogue manager (the
     seeded admin used by flip 3's smoke; content_manager/admin/sysadmin pass
     `isCatalogManager()`). Check each body in the Emulator UI:
     1. `/admin/programs` › Positions: **+ New** "Barber"/"Бръснар", a
        summary, Open, no apply URL, sort 0 → saved;
        `positions/{uuid}` = `{ title, summary, locationIds: [],
positionStatus: 'OPEN', applyUrl: null, sortOrder: 0 }` (no
        `status`). The row's trailing text reads `open`. Edit it → Closed,
        apply URL `https://example.test/apply` → stored trimmed; the row
        reads `closed`. A second role with a blank BG title → "Couldn't save",
        no document.
     2. `/careers`: the open role is listed with the `open` badge (accent)
        and its apply href; after closing it, the page shows the empty state
        with the Instagram fallback; reopen it → back, live.
     3. Courses: create one Open (starts label EN/BG "Spring 2027"/"Пролет
        2027"), one Upcoming (no label → `startsLabel: null`), one Closed;
        bodies carry `enrollmentStatus: 'OPEN' | 'UPCOMING' | 'CLOSED'`. A
        course with only the EN starts label → "Couldn't save". The admin
        Courses tab's rows read `open`, `upcoming`, `closed` as trailing text
        (never `OPEN`/`UPCOMING`/`CLOSED`, F4-7). `/courses`:
        the Open tab lists the open one (badge `open`, accent), the Upcoming
        tab the upcoming one (badge `upcoming`, warning), the closed one
        nowhere.
     4. Events: create "Open Chair Day" for next month 19:00, no location →
        `events/{uuid}` = `{ …, localDate, startMinutes: 1140, utcEpochMs
(= the Sofia instant: check with `new Date(ms).toISOString()`),
locationId: null, applyUrl: null, sortOrder: 0 }` (no `startDateIso`,
        no `timezone`). One at `loc-mladost` → `locationId: 'loc-mladost'`,
        the same zone. One last month (past). One with the typed location
        `loc-nowhere` → saved on the default shop's zone (F4-1 (c)). One at
        `2027-03-28T03:30` → "Couldn't save" (F4-1 (a)). Re-open an event:
        the prefill shows the time typed. `/events`: Upcoming lists the
        future ones soonest first with today's date format (switch the
        language: bg and en), the RSVP href falls back to Instagram; Past
        lists last month's, and its empty state has no Instagram link.
     5. The admin Events tab shows upcoming then past. No flip-4 console
        error anywhere; no document carries `status`, `startDateIso` or
        `timezone`.
4. One commit (never pushed by a package), message ending with the
   attribution line; the integrator appends §8.1 and §11 and updates
   `docs/architecture/HANDOFF.md` §2/§3 (flip 4 integrated; "Phase 3b
   flips complete; the end-of-3b graph/bundle assertion is open (Phase 4,
   flip-4 F4-2)"; the default-location deploy precondition of runbook §3;
   what is left for Phase 4), then pushes to `main` as the
   operating rules say (fast-forward only).

### 8.1 Integration record (2026-10-22)

**Integrator rulings on the packages' open items.**

1. P0, the edge statuses: the four F4-6 codes got their dotted wire codes
   AND a status each in `ENGAGEMENT_WIRE` — `not-found` for the three
   `*_NOT_FOUND` codes (as every other missing document in the table) and
   `failed-precondition` for `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` (a
   precondition the deployment owes, runbook §3), instead of the
   dictionary's default `invalid-argument`. No callable returns them
   (D9(b)); `params` stay `{}` (the rules name no param, so the ids stay on
   the server). Pinned by `apps/functions/src/edge.spec.ts` › edge — the wire
   table › details — today’s exact shapes › the programs refusals no callable
   returns yet (flip 4, D9(b)) leave by their kind — a missing program
   `not-found`, an event no zone places `failed-precondition`.
2. P0's additions to `@core/testing` beyond §3.5 are accepted:
   `memoryPositionWritePorts`, `memoryCourseWritePorts`,
   `memoryShopEventWritePorts`, `memoryClockPorts(nowUtcMs =
FIXTURE_NOW_UTC_MS)`, `memoryIdPorts(prefix?)` (no bundle-shaped
   clock/id double existed), the `ProgramsWorldSeed` type, the input
   fixtures `positionInputOf`/`courseInputOf`/`shopEventInputOf`,
   `FIXTURE_EVENT_DAY` and `shopInstantOf(localDate, startMinutes)`.
   `WriteProgramCommand` stays in `program-content.pipeline.ts` (the layering
   verifier accepts it, so §3.4's fallback move was not needed); the event
   slices `ShopEventMeta`/`ShopEventContent` are exported from
   `@core/entities` as §3.2 drew them.
3. P1/P2/P3/P5, the project references: P5's `pnpm nx sync` rewrote exactly
   the seven `tsconfig.lib/app.json` files of §4's "Expected red" list;
   `admin/programs/tsconfig.spec.json` needed no change; the root
   `tsconfig.json` is unchanged — the long "Missing references" list
   `sync:check` printed for it while other files were out of sync is
   `@nx/js:typescript-sync` noise (it records every project, then writes
   only composite references). `sync:check` now reports "up to date".
4. P1, an adapter guard (not a behaviour change): `courseReadPorts
.observeCourses([])` answers `Result.ok([])` without a read, because
   Firestore refuses an empty `in`. No caller passes `[]`; the memory double
   answers the same; pinned by `wa:programs.adapter.spec.ts` › … › answers
   no course, and reads nothing, when asked for no status at all (an empty
   `in`).
5. P1, fixed at integration: the first `test:emulator` run failed one case
   of the new `wa:programs.adapter.integration.spec.ts` ("lists the open and
   upcoming courses … and every course when asked for none": 2 of 3). On ONE
   client the unfiltered listener's first snapshot is the local cache — the
   two courses the `in` read had just left there — so `firstValueFrom`
   caught it before the server's answer. Each read now goes through its own
   client (a spec fix; the assertion is unchanged). The adapter is
   unchanged: every live listener of the web (`observeQuery`, and the legacy
   `subscribeWithRetry` before it) emits the cached snapshot first and the
   server's after it, today's behaviour.
6. P2/P3: the template test ids P2 added are DOM-only; P3's spec notes (the
   specs boot `LanguageService` before `setActiveLang`; the careers
   closed-role cases pin the tone and word tables; the ICU-dependent
   F4-11 literals) are recorded in §11.3.
7. P4: runbook §4.4's status line now records this dry run, and §4.5 its
   own (item 8); the runbook §3 deploy precondition is carried into
   `HANDOFF.md`; the F4-1 (c) wording here (§0 and P4's brief) now says what
   the pipeline does: without the default location, an event save is
   refused when it names no location or names one with no document — an
   event naming an existing shop still saves on that shop's zone.
8. The end-of-3b grep gate (runbook §4.5) FAILed on its first dry run, on
   three files that name no stored body: `apps/web/e2e/booking-core.spec.ts`
   (it asserts the retired keys ABSENT and reads the `data-day-key` DOM
   attribute — §4.2 already excludes it, flip-2 plan delta 10; §4.5 was
   written before it landed), `libs/ecs-core/src/testing/test-support.spec.ts`
   (the memory double's query-engine spec: a synthetic `status.kind` row
   proves dotted-path reads) and `testing/booking-core.fixtures.ts` (`at(hours:
number…)` / `until(hours…)` matched the retired key `hours:`). The first
   two are excluded in the block with their reasons; the helpers' parameter
   is renamed `hour` (no caller names it). It now PASSes.
9. §9's one-off check against Luxon, run at integration (Luxon is still in
   `package.json`): `DateTime.fromISO('2026-10-25T03:30', { zone:
'Europe/Sofia' }).toISO()` = `2026-10-25T03:30:00.000+03:00`
   (`00:30Z`), the same instant `toUtc` gives (the earlier offset) — no
   F4-1 (g). The gap time `2027-03-28T03:30` reads `04:30+03:00` in Luxon:
   the silent move F4-1 (a) now refuses.
10. P5: three `.md` files still name the deleted libraries — the blueprint's
    inventory tables (`ecs-migration.md` §1/§3), the inventory of
    `docs/design-research/client-card-redesign.md` and the runbook's own F4
    word list. They are history (every gate excludes `*.md`) and are left
    as written.
11. Review fix: the courses page hard-coded `LISTED_STATUSES` as
    `[EnrollmentStatus.Open, EnrollmentStatus.Upcoming]`, a second copy of
    the rule `isEnrollmentOpenOrUpcoming` states (whose only callers were
    its own spec). The page now builds the list as
    `ENROLLMENT_STATUSES.filter(isEnrollmentOpenOrUpcoming)` — the same
    `['OPEN', 'UPCOMING']`, in dictionary order, which
    `marketing-courses.spec.ts` still pins as the one `observeCourses`
    argument — and the guard's JSDoc names that caller. No behaviour change.

**The gate, measured on the integrated tree.**

| Command                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nx sync:check`                                                       | pass ("The workspace is up to date"; `typescript-sync`: all files up to date)                                                                                                                                                                                                                                                                                                                        |
| `pnpm nx run verify-tools:layering --skip-nx-cache`                        | pass, (a)–(e) `ok`                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm nx run-many -t typecheck --skip-nx-cache`                            | baseline only: `patterns` (2), `staff-dashboard` (5), `staff-client-card` (2) spec-only errors                                                                                                                                                                                                                                                                                                       |
| `pnpm nx run-many -t lint`                                                 | pass, 61 projects (63 before, less the two deleted libraries), 0 errors                                                                                                                                                                                                                                                                                                                              |
| `pnpm nx run-many -t test --parallel=3`                                    | 11 956 passed, 6 failed — exactly the baseline (`gauge.spec.ts` 4, `visit-pills.spec.ts` 1, `visits-page.presenter.spec.ts` "strikes an hour that did not happen" 1)                                                                                                                                                                                                                                 |
| `pnpm nx test ecs-core --coverage`                                         | pass, 250 files / 4 162 tests, thresholds met (98.11 % statements, 93.87 % branches)                                                                                                                                                                                                                                                                                                                 |
| `pnpm nx typecheck seed-tools` · `pnpm nx run lint-rules:test`             | pass · pass (145)                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm nx build web` · `pnpm run verify:bundle`                             | pass (the pre-existing `gauge.css` budget warning only) · pass (Firestore and Storage are not in the initial chunk; `ports.tokens.ts` and `browser-runtime.adapter.ts` pull no SDK)                                                                                                                                                                                                                  |
| `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs` | pass · pass (8 runtime dependencies, as recorded; the baseline unchanged)                                                                                                                                                                                                                                                                                                                            |
| `pnpm run verify:p0`                                                       | all proved, (a)–(f)                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm run test:emulator`                                                   | pass: functions 13 files / 62 tests, web 13 files / 251 tests (the new `programs.adapter.integration.spec.ts` 9, the `catalog.adapter.integration.spec.ts` location case, the unchanged rules spec) — after ruling 5                                                                                                                                                                                 |
| `pnpm run e2e:web`                                                         | 19 failed / 41 passed — exactly the baseline (6 `*-screenshots`, `landing.spec.ts:120`, the 12 `client-card-glance` runs at `:343`/`:686`)                                                                                                                                                                                                                                                           |
| §6 grep gate (= runbook §4.4) · runbook §4.2 · §4.3 · §4.5 (end of 3b)     | PASS, 17 gates `ok` · PASS, 28 · PASS, 22 · PASS, 6 (after ruling 8); both §4.4 `review` lists informational — the `*Ports` aliases outside ports/pipelines are exactly `FirestorePorts`, `EdgePorts`, `ServerPorts`; the lowercase literals are the words tables, the specs' badge-text pins and the `/events` view tab                                                                             |
| The end-of-3b graph/bundle half (deferred to Phase 4, F4-2; measured only) | seven `apps/functions` files import `@creativo/(application\|domain)/*`: `wire/booking.wire.ts`, `wire/loyalty.wire.ts`, `lib/booking/caller-roles.ts` (+ spec), `lib/flags.ts` (+ spec), `adapters/flags.adapter.spec.ts`; `dist/apps/functions/package.json` lists `@angular/compiler`, `@angular/core`, `dinero.js`, `firebase-admin`, `firebase-functions`, `libphonenumber-js`, `luxon`, `rxjs` |

**Smoke (§8 step 3), 2026-10-22, against `pnpm run dev`** (wiped and
reseeded; no programs document before it), signed in by custom token as
`dev-staff-ivan` (`roles: ['barber', 'admin']`), the public pages in fresh
signed-out contexts, each document read back with `firebase-admin` — 58
checks, all pass. Positions: «Barber»/«Бръснар» created → ONE
`positions/{uuid}` = `{ title, summary, locationIds: [], positionStatus:
'OPEN', applyUrl: null, sortOrder: 0 }`, its row reading `open`; `/careers`
listed it with the `open` badge (`data-tone="accent"`) and the Instagram
href; edited to Closed with `"  https://example.test/apply  "` → `CLOSED`,
the URL stored trimmed, the row reading `closed`, `/careers` the empty state
with its Instagram fallback; reopened → back live in en and bg with the
stored href; a blank BG title → "Couldn't save", nothing written. Courses:
Open with «Spring 2027»/«Пролет 2027», Upcoming with no label
(`startsLabel: null`), Closed → `enrollmentStatus: 'OPEN' | 'UPCOMING' |
'CLOSED'`, the body keys exactly the entity's; an EN-only starts label →
refused, nothing written; the admin rows `open`/`upcoming`/`closed`;
`/courses` Open tab the open one (badge `open`, accent), Upcoming tab the
upcoming one (badge `upcoming`, `data-tone="warning"`), the closed one
nowhere. Events: «Open Chair Day» 30 days ahead at 19:00, no location →
`{ localDate, startMinutes: 1140, utcEpochMs (= 17:00Z, the Sofia winter
instant), locationId: null, applyUrl: null, sortOrder: 0 }`, keys exactly
the entity's (no `startDateIso`, no `timezone`); one at `loc-mladost`
(18:30 → 1110, Sofia); one last month; one at the typed `loc-nowhere`
(09:05 → 545, saved on the default shop's zone, F4-1 (c)); one at
`2027-03-28T03:30` → "Couldn't save", nothing written (F4-1 (a)); re-opened,
the prefill read `…T09:05` and `loc-nowhere`; the admin Events tab listed
upcoming soonest first, then the past one; `/events` in en and bg listed the
upcoming ones soonest first, each date EQUAL to the legacy Luxon
`setLocale(lang).toLocaleString(…)` of the same wall clock (en «Sat, Nov 21,
07:00 PM», bg «сб, 21.11, 19:00»), the RSVP href falling back to Instagram,
Past listing last month's. No document carried `status`, `startDateIso` or
`timezone`; the seed state was restored (the three collections emptied). No
flip-4 console error. Seen and pre-existing, not chased here: the shell's
`AbortError: Transition was skipped`; the 404 of Ivan's absent avatar; and,
intermittently on `/careers`, `/courses` and `/events`, a dev-mode Angular
assertion inside the shared `SiteFooterComponent` ("Reached the max number
of directives", then "reading 'componentOffset'") — its stack is the
footer's `*transloco` view only: on these hero-less pages the footer's
`cr-locale-theme-toggle` is the first to construct `LanguageService`, whose
constructor calls `transloco.setActiveLang('bg')` synchronously and so
re-renders that view inside its own first create pass. Neither the shell nor
the pages' chrome is a flip-4 file (a follow-up). Also pre-existing: a
stored `ui-lang = 'en'` is not restored on a fresh load (the landing page
too), so the smoke switched language with the page's own toggle.

---

## 9. Risks specific to this flip

| Risk                                                                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Index #12 not re-keyed: the emulator does not enforce composite indexes, so `/careers` is emulator-green and production-dead.                     | P4 owns the edit in the same commit; §6's index gate asserts `positionStatus,sortOrder`. Deploy indexes before the web (runbook §3).                                                                                                                                                                                                                                                                                 |
| The status text silently turns SCREAMING (`OPEN`) on `/careers`, `/courses` and the admin lists, because today's specs check only the badge tone. | F4-7 words tables; new spec cases pin the text; §8 smoke step 1–3.                                                                                                                                                                                                                                                                                                                                                   |
| `formatDate` drifts from Luxon's output (a different separator or hour cycle in `bg`).                                                            | F4-11 pins the exact `en` and `bg` strings, taken from the legacy code BEFORE it is deleted (§4 P3 brief).                                                                                                                                                                                                                                                                                                           |
| Luxon's fall-back choice is not the earlier offset after all (the F4-1 "no departure" claim).                                                     | Before wave 2 deletes the domain lib, the integrator runs a one-off scratch check: `DateTime.fromISO('2026-10-25T03:30', { zone: 'Europe/Sofia' }).toISO()` must equal `ZonedTimeSystem.toIso(toUtc('2026-10-25', 210, 'Europe/Sofia'))` (`+03:00`). If it differs, F4-1 gains a (g) with a pin, not a code change (Law 7.3 is locked).                                                                              |
| `URL.canParse` crashes on older Safari (< 17) that Angular's browser support still includes.                                                      | F4-5 keeps `try { new URL(x) } catch` in the system, the legacy check exactly.                                                                                                                                                                                                                                                                                                                                       |
| A wave-1 package needs a member its bundle lacks and slices a suite or declares a local record.                                                   | §3.1 names a bundle for every token, adapter and pipeline; a missing subset is reported and added to the port file; `creativo/no-sliced-ports` and §6's Law 9 gates.                                                                                                                                                                                                                                                 |
| Template-level breakage (`track x.id.value`, `localized.get(...)`, chip literals) passes `typecheck`.                                             | P2/P3 run `pnpm nx build web`; §6's `K4` gates `id.value`, `.startDate.`, `localized.get(`, `.get(this.transloco` and the raw status prints in the flipped features; `T4` gates `eventStartDateIso` and `LocalizedInput`.                                                                                                                                                                                            |
| The event save's zone read adds a failure mode (a location read error) and a dependency on `loc-center` existing.                                 | F4-1 (c) records it; the system spec pins `zoneOf`, the pipeline spec both refusals. The seed has `loc-center`; the production id is flatten-spec OQ-2's and unconfirmed, and flip 4 is the first runtime reader of `TenantConfig.DEFAULT.defaultLocationId`. P4 adds the runbook §3 deploy precondition (the default location exists with a valid `timeZone` in the target project before the web deploys); §10.11. |
| Stale old-shape documents in a long-running dev emulator disappear from the lists (no `positionStatus`, no `utcEpochMs`).                         | Greenfield: wipe and reseed before the smoke (§8 step 3); no seed or production data exists for these collections.                                                                                                                                                                                                                                                                                                   |
| Deleting two Nx projects leaves a dangling reference (a `tsconfig` path, a project reference, `.nxignore`).                                       | P5's importer grep and `pnpm nx sync:check`; §6's stale-pointer gate covers `tsconfig.base.json` and `.nxignore`.                                                                                                                                                                                                                                                                                                    |

---

## 10. Open questions (owner) — with the default this plan applies

1. **An event's typed location names no shop** (F4-1 (c)): fall back to
   the default shop's zone and save (today's outcome), or refuse the save
   with a flat error (the field would finally be checked)? _Default: fall
   back; the field stays free text until a picker replaces it (F4-2)._
2. **The status words** (F4-7): keep today's raw lowercase (`open`,
   `upcoming`, `closed`) or translate them (`programs.status.*` keys, a
   visible change)? _Default: keep (fidelity); translating is a follow-up._
3. **Read-side validation** (F4-1 (b)): drop it (zero mapper) or keep a
   per-document guard on the public lists? _Default: drop; every writer is
   the system._
4. **The legacy programs libraries** (F4-10): delete them in this flip
   (wave 2) or leave them to Phase 4? _Default: delete now._
5. **Seed programs content** (a few positions, courses and events in
   `tools/seed`) so the pages are not empty in dev? _Default: no. Nothing
   seeds them today; adding rows is new data, and the smoke creates them
   through the page._
6. **The web's clock and id source** (F4-9): new `CLOCK_PORTS`/`ID_PORTS`
   bundles (flipped features only), or the legacy `CLOCK`/`ID_GENERATOR` as
   flip 3's admin rhythm store still does? _Default: the bundles; Phase 4
   moves every remaining feature to them and deletes the legacy two._
7. **A programs e2e journey** (admin create → public page)? _Default: not
   in this flip (none exists today); propose it as a follow-up after the
   smoke._
8. **The event-date formatter** (F4-11): reuse `formatWallClock` of
   `shared/visits`, or a page-local `Intl.DateTimeFormat`? _Default: reuse._
9. **The accepted start form** (F4-1 (f)): exactly `YYYY-MM-DDTHH:mm`, or
   also `…:ss` with zero seconds? _Default: exactly what the input emits._
10. **The position `locationIds` wipe-on-edit** (F4-8): keep, or have an
    update carry the stored `locationIds` forward? _Default: keep (frozen);
    fixing it is a behaviour change for a follow-up._
11. **The production default shop id** (F4-1 (c), linked to flatten-spec
    OQ-2): flip 4 makes `TenantConfig.DEFAULT.defaultLocationId` load-bearing
    for every event save. Which id is the production default shop, and does
    that document carry a valid `timeZone`? _Default: `loc-center`,
    verified in the target project before deploy (runbook §3 precondition,
    P4); if production uses another id, `TenantConfig.DEFAULT` changes in
    one place and `cfg` binds it._

---

## 11. The case ledgers (§5.4)

Appended by the integrator on 2026-10-22. Every deleted case has a
successor (`<file>` › its describe › its title, each title checked against
its file by a script over the TypeScript AST of the spec) or a `dead:`
reason; every left-hand title was checked against the deleted file at
`09229b0`. Abbreviations as the top of §2 (`wa:`, `sy:`, `pl:`, `co:`,
`ft:`, `app:`, `dom:`); `testing/…` is under `libs/ecs-core/src/`. A
`(+ …)` names a second successor that holds the rest of the case. Totals:
web 3 files / 12 cases (§11.1); domain 3 files / 29 cases and application
4 files / 8 cases (§11.2); re-targeted, none lost (§11.3).

### 11.1 P1 — web adapters (3 files / 12 cases)

**`wa:position-repository.adapter.spec.ts` (4)**

- FirestorePositionRepository › round-trips save → findById → `wa:programs.adapter.spec.ts` › positionReadPorts / positionWritePorts — positions/{id} › saves the body minus its id with ONE full set (never a merge), and loads it back as { id, ...body }
- FirestorePositionRepository › findById returns null when the document does not exist → `wa:programs.adapter.spec.ts` › positionReadPorts / positionWritePorts — positions/{id} › answers null for an absent role
- FirestorePositionRepository › observeOpen emits every position from the live snapshot → `wa:programs.adapter.spec.ts` › positionReadPorts / positionWritePorts — positions/{id} › lists the roles of one status by sortOrder, ties by id — index #12 (+ `wa:programs.adapter.integration.spec.ts` › programsPorts (emulator) › lets an anonymous visitor read the open roles by sortOrder, ties by id — index #12, the body as stored)
- FirestorePositionRepository › observeAll queries without a status filter, unlike observeOpen → `wa:programs.adapter.spec.ts` › positionReadPorts / positionWritePorts — positions/{id} › lists every role by sortOrder when asked for no status — the admin list, unfiltered (+ `wa:programs.adapter.integration.spec.ts` › programsPorts (emulator) › lists every role by sortOrder when asked for no status — the admin list)

**`wa:course-repository.adapter.spec.ts` (4)**

- FirestoreCourseRepository › round-trips save → findById, including the startsLabel → `wa:programs.adapter.spec.ts` › courseReadPorts / courseWritePorts — courses/{id} › saves the body minus its id with one full set, the starts label included, and loads it back
- FirestoreCourseRepository › findById returns null when the document does not exist → `wa:programs.adapter.spec.ts` › courseReadPorts / courseWritePorts — courses/{id} › answers null for an absent course
- FirestoreCourseRepository › observeOpenAndUpcoming emits every course from the live snapshot → `wa:programs.adapter.spec.ts` › courseReadPorts / courseWritePorts — courses/{id} › lists the courses of the given statuses by sortOrder — index #11, the closed one left out (+ `wa:programs.adapter.integration.spec.ts` › programsPorts (emulator) › lists the open and upcoming courses by sortOrder — index #11 — and every course when asked for none)
- FirestoreCourseRepository › observeAll queries without an enrollmentStatus filter → `wa:programs.adapter.spec.ts` › courseReadPorts / courseWritePorts — courses/{id} › lists every course by sortOrder when asked for no status — the admin list, unfiltered

**`wa:event-repository.adapter.spec.ts` (4)**

- FirestoreEventRepository › round-trips save → findById, including the location and zone → the location half: `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › saves the body minus its id with one full set, its shop and wall clock included, and loads it back (it also pins that the body holds no zone key); the zone half is `dead:` — the body has no zone field any more (F4-4, Law 7.2); the zone is the location's, pinned by `pl:program-content.pipeline.spec.ts` › writeShopEvent › places an event at a named shop on that shop’s zone, and stores the id as typed
- FirestoreEventRepository › findById returns null when the document does not exist → `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › answers null for an absent event
- FirestoreEventRepository › observeUpcoming queries startDateIso >= now, ascending → `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › reads the upcoming side: utcEpochMs >= now, soonest first, every one — an event AT now is upcoming (F4-1 (e)) (+ `wa:programs.adapter.integration.spec.ts` › programsPorts (emulator) › reads the upcoming side soonest first, every one, an event AT now included, a tie by id ascending)
- FirestoreEventRepository › observePast queries startDateIso < now, descending → `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › reads the past side: utcEpochMs < now, latest first, the latest 24 (+ `wa:programs.adapter.integration.spec.ts` › programsPorts (emulator) › reads the past side latest first, capped at 24 of 25, ties by id DESCENDING — the one kept at the cap included)

### 11.2 P5 — domain (3 files / 29 cases) and application (4 files / 8 cases)

**`dom:lib/position.spec.ts` (11)**

- Position.create › accepts fully valid props → `sy:programs.system.spec.ts` › ProgramsSystem.position › accepts a fully valid role
- Position.create › accepts a missing applyUrl as null → `sy:programs.system.spec.ts` › ProgramsSystem.position › accepts a blank apply URL as null — empty or spaces
- Position.create › rejects an empty id → `dead:` an id is never foreign input any more — a create draws it from `IdPorts.nextId` (`PositionId.of`, an id by construction), an update names a stored document the admin list read; the id refusal itself is `ids.primitive`'s (`PRIMITIVE_ID_EMPTY`)
- Position.create › rejects a blank localized title field → `sy:programs.system.spec.ts` › ProgramsSystem.position › rejects a blank localized title field
- Position.create › rejects a negative sort order → `sy:programs.system.spec.ts` › ProgramsSystem.position › accepts sort order 0 and rejects -1 and 1.5
- Position.create › rejects a malformed apply URL → `sy:programs.system.spec.ts` › ProgramsSystem.position › rejects a malformed apply URL
- Position.create › rejects an empty locationId in the list → `sy:programs.system.spec.ts` › ProgramsSystem.position › rejects an empty location id in the list
- Position.create › collects every invalid field at once → `sy:programs.system.spec.ts` › ProgramsSystem.position › collects every invalid field at once, in the form order
- Position.reconstitute › validates identically to create() → `dead:` no `reconstitute`: a stored body is answered as stored (F4-1 (b)), pinned by `wa:programs.adapter.spec.ts` › positionReadPorts / positionWritePorts — positions/{id} › answers a stored role AS STORED — no read-side validation (F4-1 (b))
- Position.servesLocation › treats an empty locationIds as "available everywhere" → `sy:location-scope.system.spec.ts` › LocationScopeSystem.serves › treats an empty locationIds as "available everywhere"
- Position.servesLocation › matches only listed locations when scoped → `sy:location-scope.system.spec.ts` › LocationScopeSystem.serves › matches only the listed locations when scoped

**`dom:lib/course.spec.ts` (8)**

- Course.create › accepts fully valid props → `sy:programs.system.spec.ts` › ProgramsSystem.course › accepts a fully valid course
- Course.create › accepts a missing startsLabel/applyUrl as null → `sy:programs.system.spec.ts` › ProgramsSystem.course › accepts a blank starts label and apply URL as null
- Course.create › treats a closed course as not open-or-upcoming → `sy:programs.system.spec.ts` › ProgramsSystem.course › keeps the enrollment chip as typed — a closed course stays closed (+ `co:enrollment-status.data.spec.ts` › EnrollmentStatus › shows an open or an upcoming course, never a closed one)
- Course.create › rejects an empty id → `dead:` as Position's (an id by construction or a stored document's)
- Course.create › rejects a blank localized description field → `sy:programs.system.spec.ts` › ProgramsSystem.course › rejects a blank localized description field
- Course.create › rejects a negative sort order → `sy:programs.system.spec.ts` › ProgramsSystem.course › rejects a negative sort order
- Course.create › rejects a malformed apply URL → `sy:programs.system.spec.ts` › ProgramsSystem.course › rejects a malformed apply URL
- Course.reconstitute › validates identically to create() → `dead:` no `reconstitute` (F4-1 (b)), pinned by `wa:programs.adapter.spec.ts` › courseReadPorts / courseWritePorts — courses/{id} › answers a stored course AS STORED — no read-side validation (F4-1 (b))

**`dom:lib/shop-event.spec.ts` (10)**

- ShopEvent.create › accepts fully valid props → `sy:programs.system.spec.ts` › ProgramsSystem.eventFields › reads the wall clock of a valid event, with its location and RSVP link
- ShopEvent.create › accepts a missing locationId/applyUrl as null → `sy:programs.system.spec.ts` › ProgramsSystem.eventFields › accepts a blank location and apply URL as null, and trims a typed location
- ShopEvent.create › rejects an empty id → `dead:` as Position's
- ShopEvent.create › rejects an invalid startDateIso → `sy:programs.system.spec.ts` › ProgramsSystem.eventFields › rejects an invalid start
- ShopEvent.create › rejects an invalid timezone → `sy:zoned-time.system.spec.ts` › toUtc — DST is decided once, locked (gap refused, repeat → the earlier offset) › refuses an unknown zone and impossible parts (the event carries no zone, F4-4: the zone is its location's, which the pipeline hands to `toUtc` — whose `TIME_INVALID_TIME_ZONE` it answers unchanged, §3.4 step 3)
- ShopEvent.create › rejects a negative sort order → `sy:programs.system.spec.ts` › ProgramsSystem.eventFields › rejects a negative sort order
- ShopEvent.create › rejects a malformed apply URL → `sy:programs.system.spec.ts` › ProgramsSystem.eventFields › rejects a malformed apply URL
- ShopEvent.reconstitute › validates identically to create() → `dead:` no `reconstitute` (F4-1 (b)), pinned by `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › answers a stored event AS STORED — no read-side validation (F4-1 (b))
- ShopEvent.isUpcoming / isPast › is upcoming when startDate is in the future → `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › reads the upcoming side: utcEpochMs >= now, soonest first, every one — an event AT now is upcoming (F4-1 (e)) (+ `testing/port-doubles.spec.ts` › memoryProgramsWorld — the one state the programs doubles share › splits events on the instant: upcoming >= now ascending, past < now descending)
- ShopEvent.isUpcoming / isPast › is past when startDate is in the past → `wa:programs.adapter.spec.ts` › shopEventReadPorts / shopEventWritePorts — events/{id} › reads the past side: utcEpochMs < now, latest first, the latest 24 (+ `testing/port-doubles.spec.ts` › memoryProgramsWorld — the one state the programs doubles share › splits events on the instant: upcoming >= now ascending, past < now descending)

**`app:lib/use-cases/create-position.use-case.spec.ts` (2)**

- CreatePositionUseCase › creates and saves an open position → `pl:program-content.pipeline.spec.ts` › writePosition › creates and saves an open position under a fresh id
- CreatePositionUseCase › rejects a blank title → `pl:program-content.pipeline.spec.ts` › writePosition › rejects a blank title and saves nothing — the refused create spends its id

**`app:lib/use-cases/update-position.use-case.spec.ts` (2)**

- UpdatePositionUseCase › closes an existing position → `pl:program-content.pipeline.spec.ts` › writePosition › closes an existing position — the full body replaced, its locations wiped as the page sends none (F4-8)
- UpdatePositionUseCase › fails when the position does not exist → `pl:program-content.pipeline.spec.ts` › writePosition › refuses a missing position as ENGAGEMENT_POSITION_NOT_FOUND before judging the form, and saves nothing

**`app:lib/use-cases/create-course.use-case.spec.ts` (2)**

- CreateCourseUseCase › creates and saves an open course → `pl:program-content.pipeline.spec.ts` › writeCourse › creates and saves an open course
- CreateCourseUseCase › rejects a blank description → `pl:program-content.pipeline.spec.ts` › writeCourse › rejects a blank description and saves nothing

**`app:lib/use-cases/create-shop-event.use-case.spec.ts` (2)**

- CreateShopEventUseCase › creates and saves an event → `pl:program-content.pipeline.spec.ts` › writeShopEvent › creates and saves an event at no shop, on the default shop’s clock
- CreateShopEventUseCase › rejects an invalid start date → `pl:program-content.pipeline.spec.ts` › writeShopEvent › rejects an invalid start and saves nothing — no location is read

### 11.3 P2/P3 — re-targeted cases they could not keep (expected: none)

None. Every title of the re-targeted specs on `09229b0` is still in its
file (compared title for title by the AST script): `ft:admin/programs/…/admin-programs.spec.ts`
5 → 16, `ft:marketing/careers/…/marketing-careers.spec.ts` 5 → 8,
`ft:marketing/courses/…/marketing-courses.spec.ts` 4 → 6,
`ft:marketing/events/…/marketing-events.spec.ts` 3 → 6,
`wa:catalog.adapter.spec.ts` 7 → 11, `wa:catalog.adapter.integration.spec.ts`
5 → 6, `primitives/engagement-errors.data.spec.ts` 9 → 11,
`testing/port-doubles.spec.ts` 50 → 60. Two notes from P3, recorded, not
lost cases: the careers cases "badges a closed position with a neutral tone"
and "prints the badge text "closed" for a closed role" seed a closed role
into the recorded read, as the legacy stub did — a live open-only query
never returns one, so they pin the tone and word tables, while "renders
one row per open position…" asserts the page asks exactly
`[PositionStatus.Open]`; and the events date pins (F4-11) are ICU-dependent
— on Node 22.22.3 the `en` hour prints an ASCII space before AM/PM; an ICU
emitting U+202F there would change the legacy formatter and
`formatWallClock` alike, and the literals would be re-taken.
`apps/functions/src/edge.spec.ts` gained one case at integration (§8.1).

### 11.4 Deliberate departures, pinned

| Departure                                                       | Pinned by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4-1 (a) DST gap refused                                        | `pl:program-content.pipeline.spec.ts` › writeShopEvent › refuses a spring-forward gap time with DST_GAP_INVALID_TIME and saves nothing (F4-1 (a)); `ft:admin/programs/…/admin-programs.spec.ts` › AdminPrograms › events (flip 4) › refuses a start inside the spring-forward gap and saves nothing (F4-1 (a)); the system reads the gap time as a valid wall clock (`sy:programs.system.spec.ts` › ProgramsSystem.eventFields › touches no zone: a spring-forward gap time is a valid wall clock here)                                                                                                                                                                                                                                                                                                                                                           |
| F4-1 (a), no departure: the fall-back repeat                    | `pl:program-content.pipeline.spec.ts` › writeShopEvent › resolves a fall-back repeat time to the EARLIER offset (+03:00); §9's one-off check against Luxon run at integration: `DateTime.fromISO('2026-10-25T03:30', { zone: 'Europe/Sofia' })` = `2026-10-25T03:30:00.000+03:00` (`00:30Z`), the same instant — no (g)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F4-1 (b) bodies answered as stored                              | `wa:programs.adapter.spec.ts` › answers a stored role AS STORED — no read-side validation (F4-1 (b)); › answers a stored course AS STORED — …; › answers a stored event AS STORED — … (one per collection)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F4-1 (c) zone from the location, default fallback, two refusals | `sy:programs.system.spec.ts` › ProgramsSystem — the event’s zone (F-4, F4-1 (c)) (all four cases); `pl:program-content.pipeline.spec.ts` › writeShopEvent › places an event at a named shop on that shop’s zone, …; › saves a typed location that names no shop on the default shop’s zone (F4-1 (c)); › refuses ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN when the default shop is absent, and saves nothing; › answers a failed location read with that RepositoryError, …; › answers a failed fallback read with that RepositoryError, …; `ft:admin/programs/…/admin-programs.spec.ts` › … › saves a typed location that names no shop on the default shop zone (F4-1 (c))                                                                                                                                                                                            |
| F4-1 (d) `/` in a location id refused                           | `sy:programs.system.spec.ts` › ProgramsSystem.position › rejects a location id holding a "/" (F4-1 (d)); › ProgramsSystem.eventFields › rejects a location id holding a "/" (F4-1 (d))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F4-1 (e) instant split                                          | `wa:programs.adapter.spec.ts` › reads the upcoming side: utcEpochMs >= now, … (F4-1 (e)); › reads the past side: utcEpochMs < now, …; › breaks a tie on the instant by id in the direction of the order: upcoming id ascending, past id DESCENDING; the emulator pins in `wa:programs.adapter.integration.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F4-1 (f) only the input's form                                  | `sy:programs.system.spec.ts` › ProgramsSystem.eventFields › reads only the form the datetime-local input emits (F4-1 (f)); › refuses a well-formed start that is not on the calendar or the clock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F4-7 / F4-8 / F4-11 (fidelity pins, no departure)               | F4-7: `admin-programs.spec.ts` › positions (flip 4) › prints each role status as its lowercase word, never the stored tag (F4-7), › courses (flip 4) › prints each enrolment status as its lowercase word, …; `marketing-careers.spec.ts` › prints the badge text "open" / "closed" …; `marketing-courses.spec.ts` › badges an upcoming course "upcoming" with a warning tone, › prints the badge text "open" for an open course. F4-8: `admin-programs.spec.ts` › positions (flip 4) › wipes the stored location ids on an edit — the form has none (F4-8), › events (flip 4) › lists no event at all when one side of now fails to read (F4-8). F4-11: `marketing-events.spec.ts` › formats each row's date from the shop wall clock in en / in bg; `admin-programs.spec.ts` › events (flip 4) › pre-fills the start as the input reads it, zero-padded (F4-11) |
