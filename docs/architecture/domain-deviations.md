# Domain deviations — v2 → `libs/domain/*` (Goal 02)

Per `docs/migration/goals/02-domain-port.md`: greenfield, encouraged to
rename/merge concepts where v2's model was awkward. Each entry below is a
deliberate deviation from v2's `packages/domain/src/` shape, grouped by
bounded context. v2 itself was never modified.

## Kernel additions (on top of the existing `libs/domain/kernel`)

- **`Brand<TBase, TTag>`** (`kernel/brand.ts`) — the blueprint §2.2 zero-cost
  nominal-typing alias, added alongside the existing class-based `Id<Brand>`.
- **`Clock`** (`kernel/clock.ts`) — a minimal `{ now(): ZonedDateTime }`
  interface. No domain code may call `Date.now()`/`new Date()` (blueprint
  §7.1); every entity/VO that needs "now" takes a `Clock` or an already-resolved
  `ZonedDateTime` parameter instead.
- **`ZonedDateTime` additions** — `isSameOrBefore`/`isSameOrAfter`,
  `yearsUntil(other)` (whole calendar years, counting a birthday only once
  it has passed), and `.year`/`.month`/`.day` accessors. Added because
  `BirthDate` (accounts) and `TimeSlot.calendarDayKey()` (scheduling) both
  need calendar-day arithmetic without ever touching a raw `Date` (§7.1).
- **`PhoneNumber`** (`kernel/phone-number.ts`) — moved _into_ kernel rather
  than `domain/accounts`, even though the blueprint's target-tree prose
  lists it under `accounts`. Reconciled with the ESLint rule (already
  present from Goal 00) restricting `libphonenumber-js` to
  `libs/domain/kernel/**` — the class itself, not just the raw library
  import, has to live where the import is legal. `accounts`/`catalog`
  (`VenuePhone`) both just import kernel's `PhoneNumber`.

## `identity`

- **Otp is fully zero-port**: `Otp.issue()` takes a pre-computed
  `codeHash`/`salt` instead of `OtpCodeGenerator`/`OtpCodeHasher` port
  parameters; `Otp.verify()` takes a pre-computed `codeMatches: boolean`
  instead of a raw code + hasher port. The pre-existing
  `libs/domain/models/otp.ts` (this repo's own prior "foundation pass")
  took crypto ports directly — that violates Goal 02's pure-domain, zero-port
  scope guard. All crypto-port wiring is deferred to Goal 03's application
  layer, which will own `OtpCodeGenerator`/`OtpCodeHasher` and call into this
  now-pure state machine.
- **`Email` duplicated locally** rather than imported from `accounts` —
  keeps `identity` self-contained as its own bounded context instead of
  cross-depending on a sibling for a shared primitive. Accepted duplication
  cost, same primitive shape as `accounts`' own `Email`.
- **`Role` is an unvalidated `Brand<string, 'Role'>` placeholder**, not a
  real enum — the real role/permission vocabulary lives in `accounts`'
  `UserRole` (`client | barber | receptionist | content_manager | admin |
sysadmin`) and `governance`'s staff-authorization checks. `identity`'s
  `AuthClaims`/`Principal` treat roles as opaque, comparable tokens only.
  **Open follow-up**: a later pass could have `identity` import the real
  `UserRole` from `accounts` (both are `type:domain`, cross-imports are
  allowed) to strengthen this — deferred here to avoid re-opening a
  finished context's design mid-migration; revisit in Goal 03 when the
  application layer composes `identity` + `accounts` together.
- **`NonEmptyArray<T>`** (v2's hand-rolled generic) is not ported — non-empty
  role arrays are enforced at construction time by `activeClaims()`/
  `activePrincipal()` (an `EmptyRolesError` on violation), not encoded as a
  type-level tuple.
- **`Principal`/`AuthClaims`/`Identifier`/`SessionKind`** are plain
  discriminated unions + free functions, not v2's `namespace X { … } + const
X = {...} as const` companion-object pattern (this repo's own
  `AppointmentStatus` precedent, and this repo's ESLint config bans
  `@typescript-eslint/no-namespace` outright).
- **`AuthStrategy`** has one validating factory (`createAuthStrategy`), no
  `create`/`reconstitute` split — it's stateless deployment config with no
  creation-only invariant to skip.
- **`Identity` aggregate root not built** — out of scope per the goal's
  explicit deliverable list (`Principal, AuthClaims, Identifier,
AuthStrategy, Otp, OtpCode, SessionKind, RedirectPath`); v2's
  linked-channels/account-merge logic on `Identity.ts` is not ported.

## `accounts`

- **`BirthDate`** — new VO, no v2 equivalent. `create(raw, today:
ZonedDateTime)` enforces age 16–120 against an injected "today" (never
  `Date.now()`); `reconstitute(raw, today)` only re-validates calendar
  format, not the age window (same "a past-dated read is legitimate"
  precedent as `Appointment`).
- **`UserRole`** — v2's `customer` renamed to `client`, matching this
  workspace's own `scope:client`/`apps/client` vocabulary (blueprint
  §0.2/§1.1 already use "client" for this role).
- **`isStaff`** — `barber | receptionist | content_manager | admin |
sysadmin` are staff (broader than v2's own `isStaff`, which excludes
  `admin`/`sysadmin` into a separate `isAdmin` tier) — followed the Goal 02
  task spec's explicit wording over v2's code.
- **No TS `namespace`** — v2's `AccountStatus`/`UserAccount`/`User`
  nested-namespace + companion-object pattern is replaced with flat
  top-level interfaces (`AccountStatusBlocked`, `UserAccountProvisioned`,
  …) plus a same-named companion `const` — this repo's ESLint config bans
  `@typescript-eslint/no-namespace`.
- **`UserAccount.Provisioned.channel`** narrowed to kernel's `PhoneNumber`
  directly rather than v2's cross-context `Identifier` (which belongs to
  `identity`, not built yet when `accounts` needed it) — `PhoneNumber`
  already carries the "always has a reach-out channel" invariant.
- **`User` enriched** vs. this repo's pre-existing `libs/domain/models`
  shape: added mandatory `PhoneNumber`, `FirstName`/`LastName` (replacing
  free-text `displayName`), non-empty `roles: UserRole[]`, `AccountStatus`,
  optional `BirthDate`. Dropped `referralCode`/`gamificationPoints`/
  `tenantMemberships` (foundation-pass-only fields, not in v2's `User` or
  this task's scope) and `createdAt`/`updatedAt` (no persistence layer yet
  — added when the Firestore adapter for this context lands, Phase 4).

## `catalog`

- Dropped `Temporal.Instant` `createdAt`/`updatedAt` and `Revision`
  (optimistic-concurrency versioning) from every entity (`Barber`,
  `Location`, `Service`) — persistence-layer concerns out of scope for this
  pure-domain pass; zero `Temporal` dependency in this lib.
- **`LocalizedText`** reimplemented from scratch as a minimal two-field
  (`en`/`bg`) validating VO instead of v2's full Transloco-adjacent i18n
  record type — no i18n library dependency in `domain/catalog`.
- **`Barber.userId`** (optional link to a staff/user account) dropped
  entirely rather than modeled as a placeholder, to keep `catalog`
  independent of `accounts` (both were built in the same wave, in
  parallel). **Open follow-up**: revisit once a real "linked staff
  account" use-case lands (Goal 03) — `catalog` and `accounts` are both
  `type:domain` so a future direct import is architecturally free.
- **`Barber.socials`** flattened from `{ instagram? }` to a single
  `instagramHandle: string | null` (only one platform was ever populated in
  v2).
- **`Service` significantly simplified**: v2's per-barber `offerings`/
  `variants` pricing matrix (`Terms`, `termsFor`, `priceRange`,
  `durationRange`, per-barber overrides) collapsed to one canonical
  `price: Money` + `durationMinutes: number` per service — per-barber/
  variant pricing resolution deferred to the booking/scheduling application
  layer (Goal 03) once a real use-case needs it. Kept the `single | bundle`
  split and `conflictsWith`; dropped `requiresAnyOf` and the derived
  `barberIds` query-mirror field.
- **`NonNegInt`/`PositiveInt`** not ported as shared VOs — every numeric
  field is validated inline in its owning entity's `create()` (still
  satisfies the primitive-obsession ban, which only requires _a_ validating
  door, not a dedicated shared VO class).
- **`MediaAsset`** (v2's full processing/contributor-credit/gallery-link
  aggregate) is out of scope — only the denormalized `MediaRef` pointer was
  built, directly constructed (no `MediaRef.fromAsset` snapshot path, since
  there's no `MediaAsset` to snapshot from in this pass).
- **`VenuePhone.create`** takes only a raw E.164 string (no
  `defaultCountry`) — venue phones are always pre-normalized tenant
  content, matching v2's own rationale for decoupling `VenuePhone` from
  country-inference logic.
- **`Location.hours`** kept the "exactly 7 entries, `opens < closes` on open
  days" invariant with a locally-scoped `HH:mm` check, deliberately not
  reusing `scheduling`'s `WorkingHours` (would have been a cross-context
  import for a concept `catalog` needs independently — `scheduling` has its
  own, separately-built `WorkingHours` for barber/location schedules).

## `scheduling`

- **`BookingParty` fixes legacy bug 7.7** (guest/waitlist ID resurrection):
  `GuestId` has **no `generate()`** — its only constructor is
  `fromSequence(n)`, fed exclusively by `BookingParty`'s own monotonic
  `nextSequence` counter, which only ever increments on `addGuest` and is
  **never** touched by `removeGuest`. A regression test
  (`booking-party.spec.ts`) proves add → remove → add never reuses an id,
  porting v2's own documented bug scenario.
- **`TimeSlot.calendarDayKey()` fixes legacy bug 7.1**: the calendar day is
  derived exclusively from kernel `ZonedDateTime`'s `.year`/`.month`/`.day`
  accessors, never a raw `Date` — v2's `DateString.fromDate` used the
  runtime-local timezone and could pick the wrong calendar day for a UTC
  server/foreign device on this Europe/Sofia product.
- **`Seat`/`SeatSubject`** trimmed v2's `Subject` union to two tiers
  (`anonymous` with a `SeatLabel`, `account` with a `UserId` +
  `SeatRelationship`) — v2's middle `provisioned` (phone-only "foothold"
  account) tier is dropped since `accounts` in this workspace has no such
  foothold concept yet to port it onto.
- **`Appointment` carries one shared `barberId`/`locationId` for the whole
  slot**, with each `Seat` booking exactly one `ServiceId` — a deviation
  from v2's per-seat `BarberPref`/variant model, simplified for this pass
  (per-seat barber preference is an application-layer/booking-flow concern
  for Goal 03, not a pure-domain invariant).
- **`WorkingHours`/`WorkingHoursRange`** re-created in `scheduling` rather
  than imported from the pre-existing `libs/domain/models` copy — this new
  bounded context does not depend on the old foundation-pass `domain/models`
  lib at all; the pattern is intentionally the same shape, just
  independently owned.
- **`Appointment.cancel(reason)`** requires a non-empty trimmed reason
  (`AppointmentEmptyCancellationReasonError`) — a small hardening v2 did not
  enforce at the type level.

## `engagement`

- **`Reward`'s `badge` variant dropped** — badge-granting is folded
  entirely into `Achievement`'s own reward set (an achievement already
  carries `rewards: Reward[]`); avoids two parallel badge-granting paths
  that v2 kept separate (`Reward.Badge` vs. `AchievementDefinition.rewards`
  duplicating the same fact).
- **`CouponGrant`'s redemption channel decoupled from `scheduling`**: v2's
  `CouponGrant.Redemption` discriminated union references `AppointmentId`
  directly. This pass's `markUsed(at, note)` takes a free-text `note`
  instead, keeping `engagement` independent of `scheduling` (built in the
  same wave, in parallel). The Goal-03 use-case that actually redeems a
  coupon against a real appointment composes both contexts and can format
  the note however it needs (e.g. `"appointment ${id.toString()}"`).
- **`RewardProgram`/`RewardProgress`/`Milestone` heavily simplified** vs.
  v2's full system: dropped `audience`, per-referrer anti-fraud `cap` +
  rolling-window counting, the multi-criterion evaluator (account-age
  gates, completion-rate gates), milestone `deadline`/deadline-cron
  support, and the `reverted`/clawback terminal state with its
  `RewardEventId` audit chains. What remains is the essential state
  machine — enroll (all milestones `pending`) → `advanceMilestone`
  (`pending → completed`, `Result`-returning, never throws unlike v2's
  version) / `expireMilestone` (`pending → expired`) — monotone,
  terminal-states-never-revert, matching the goal's minimum bounded-context
  content list (`Reward, RewardProgram, RewardProgress, Milestone`). The
  full anti-fraud/clawback richness is real product value but belongs to a
  concrete Goal-03 materialization use-case, not this pure-entity pass.
- **`Milestone.criteria`** supports two variants (`always_true`,
  `appointments_completed_at_least`) instead of v2's five (account-age,
  completion-rate, first-appointment-minor, n-appointments-in-window) —
  same reasoning as above.
- **`Invitation`/`InvitationRedemption`** ported closely to v2's shape
  (`recordRedemption()` bumps a validated non-negative counter,
  `isSelfInvitation`/`InvitationRedemption.forInvitation` guards
  self-redemption) — one of the more direct ports in this context.
- **`Achievement`** ported as a single `Achievement` VO (v2 splits
  `AchievementDefinition` config from a separate `UserAchievement` unlock
  record) — the unlock-record half is a persistence/tracking concern
  (`users/{uid}/achievements/{id}`) deferred to Goal 04's Firestore schema
  design, not a pure-domain value.
- **`DiscountApplication` — the ledger 7.4 fix**: v2's `apply-discounts.ts`
  sorted by `(kindRank, arrayIndex)`, so a discount's fate under the
  anti-abuse cap depended on the caller's incidental array order,
  not a property of the discounts themselves. This pass's
  `DiscountApplication.apply()` uses a **total deterministic order** — kind
  rank (fixed → percent → free_service) → magnitude → `grantedAt` → `id` —
  none of it array position. Pinned with `fast-check` property tests
  proving: the cap is always respected, the total is never negative, and
  the result is independent of the input array's shuffle order (200 runs
  each).

## `governance`

- **`Actor`** is a discriminated union over four cases
  (`system | user | admin | impersonator`), pure factories/predicates, no
  `Result` — by construction time its `UserId`/`ImpersonationSessionId`
  fields are already-validated domain values (same "value used inside an
  aggregate, not its own persistence-rebuild story" rationale as
  `AccountStatus`).
- **`AuditEntry.action`/`resourceId`** stay validated plain strings
  (non-empty `action`, optional free-form `resourceId`) rather than a
  closed union or a typed per-aggregate id brand — the audit log's whole
  point is to log _any_ code path's action without forcing every new
  mutation type through a domain-layer enum edit, and `resourceId` there
  deliberately doesn't carry a dependency on every other context's id-brand
  type.
- **`ImpersonationScope`** (`read | write`) is new — not explicit in v2's
  simpler model — added so `ImpersonationSession.start`/authorization
  checks can distinguish observation-only impersonation from full
  target-user authority, both switching on it exhaustively.
- **`ImpersonationSession.isExpired(clock)` — the ledger 7.8 fix**: v2 kept
  expiry enforcement server-authoritative but let the client independently
  compare `expiresAt` itself. This pass exposes `isExpired(clock: Clock):
boolean` as the _one_ place the comparison is written, so a future Cloud
  Functions callable and a client-side guard share the exact rule instead
  of re-implementing `expiresAt <= now` twice. Boundary-tested at
  just-before/at/just-after expiry.
- **`ImpersonatorNotStaffError`**: `ImpersonationSession.start` requires the
  impersonator's roles to satisfy `accounts`' `isStaff` — a real
  authorization invariant enforced at the domain layer, not left to the
  application/use-case layer to remember.
- **`FeatureFlags`** flattened to a closed union of dotted-path string keys
  (`'referrals.invitations' | 'rewards.points' | ...`) instead of v2's
  nested-object + recursive `Paths<T>` type-level derivation — a flat union
  gives the same "adding a flag is a compile-time-visible change" property
  with far less type machinery.
- **`Locale`** (governance's `TenantConfig`-facing type) is a closed
  `'en' | 'bg'` union matching `libs/adapters/i18n`'s UI-chrome
  `availableLangs` — v2's open content-locale/chrome-locale distinction
  isn't ported since there's no content-authoring locale list yet to
  distinguish it from.
- **`CurrencyCode`** delegates validity to kernel's already-curated
  `currencyFromCode` (the same list `Money` validates against) rather than
  owning a second currency vocabulary — never leaks kernel's `DineroCurrency`
  type, storing only the normalized ISO code string.
- **`TenantConfig`** is this pass's replacement for v2's `TenantConfig.ts`
  — a deliberately smaller aggregate (`name`, `timezone`, `locale`,
  `currencyCode`, `featureFlags`) than this repo's own pre-existing
  `libs/domain/models/tenant.ts` (a full multi-tenant aggregate with
  memberships/branding) — that older lib is a different, broader concept
  and is untouched by this pass.

## Cross-cutting

- Every context's `ids.ts` mints its own `EmptyIdError` (dot-namespaced
  per context: `identity.id.empty`, `accounts.id.empty`,
  `scheduling.id.empty`, `catalog.id.empty`, `engagement.id.empty`,
  `governance.id.empty`) rather than sharing one `EmptyIdError` class
  workspace-wide — matches each context's own error-code namespacing
  convention (`<context>.<concept>.<reason>`) and avoids `type:domain`
  contexts depending on each other purely for an error class.
- No `ports/*.port.ts` files exist in any of the six contexts — per the
  Goal 02 scope guard, all port interfaces (repositories, crypto,
  key-value stores) are deferred to Goal 03's `libs/application/*`.
