# Domain model architecture

Rich domain model, not flat DTOs — replaced the Foundation pass's Zod-schema
`domain-models` lib wholesale. `apps/functions`'s OTP flow is the reference
implementation of the full pattern end-to-end (the only code in this repo
with real Firestore reads/writes today); every other entity has the domain
layer built but no adapter yet (see "What's deferred" below).

## Why `libs/domain/*` and `libs/adapters/*`, not `libs/shared/*`

The domain layer briefly lived under `libs/shared/kernel` and
`libs/shared/domain-models`, alongside genuinely generic presentational
infra (`design-tokens`, `ui`, `cursor`). That buried the most central part
of the system as one of six peers in an undifferentiated "shared" bucket.
Moved to a dedicated top-level grouping that says what it is:

```
libs/
  domain/
    kernel/    (@creativo/domain/kernel — Result, Money, ZonedDateTime, Id, DomainError)
    models/    (@creativo/domain/models — entities, value objects, ports/)
  adapters/
    firebase/  (@creativo/adapters/firebase — browser-side Firebase adapters)
  shared/
    design-tokens/, ui/, cursor/   (genuinely generic design-system infra)
```

Ports stay **inside** `domain/models`, not split into their own
`libs/ports` — a port is part of the domain's own declaration of what it
needs (`Otp.verify()` and the `OtpCodeHasher` port that backs it change
together), not an independent artifact anyone imports on its own.

This is a pure directory/import-path change — `scope:*`/`type:*` tags are
unchanged (`libs/domain/kernel` and `libs/domain/models` are still
`scope:shared,type:util`; `libs/adapters/firebase` is still
`scope:shared,type:data-access`), so none of the boundary _rules_ moved,
only where humans find things.

## `libs/domain/kernel` (`scope:shared`, `type:util`)

The innermost layer — zero Firebase/Angular imports, everything else in the
domain depends on it.

- **`Result<T, E>`** (`result.ts`) — `Success<T, E>` / `Failure<T, E>`, `ok()`/`fail()`,
  `isSuccess()`/`isFailure()` type guards. Domain code returns `Result`, it
  never throws for expected failure modes. `match()` converts a `Result`
  into something else (a thrown error, a response payload) — used exactly
  once per call chain, at the outermost boundary (see "Result → HttpsError"
  below), not scattered through the domain.
- **`DomainError`** (`domain-error.ts`) — abstract base every domain/use-case
  error extends. `message` stays an English, developer-facing string (logs
  only, never shown to a user). `code` (`readonly code = 'invalid_email' as
const`) is the stable, language-neutral key the frontend resolves to a
  real, localized message via `libs/adapters/i18n`'s `translateDomainError` —
  see "`libs/adapters/i18n` — day-0 i18n" below for the full seam. `params`
  carries interpolation data. Every error class in `domain/models` and
  `apps/functions`'s use-case error files extends this — `grep -rn "extends
Error" libs/domain apps/functions/src` should only ever match `DomainError`
  itself (plus the three infra-adapter wrapper errors called out there:
  `RepositoryError`/`AuthTokenError`/`OtpSendError` carry a dynamic,
  adapter-supplied message and are never surfaced to a user directly — they
  travel as `.cause` on a `DomainError` that already has its own stable
  `code`, so giving them a fixed code of their own would be meaningless).
- **`combine`/`combineAll`** — `combine(results: Result<T,E>[])` for a
  _homogeneous_ list (e.g. validating every item in `serviceIds: string[]`
  into `ServiceId[]`). `combineAll([r1, r2, r3] as const)` for _heterogeneous_
  fields of one entity — preserves each element's own type in a tuple via a
  mapped-type inference trick, and collects every field's error at once
  (not just the first). **Do not feed a `combine()` result directly into a
  `combineAll()` tuple** — its error type is already an array, which
  produces a jagged/nested error array instead of a flat one (a real type
  error caught building `Staff`/`User`, see their `.build()` methods for the
  correct two-step pattern: `combineAll` the scalar fields, manually
  `.push(...listResult.error)` the array-typed ones).
- **`Money`** (`money.ts`) — wraps `dinero.js` v2 (integer-safe currency
  math), never leaks `Dinero<number>` past the class boundary. `add`/`subtract`
  return `Result` (currency mismatch is a real, recoverable failure, not a
  thrown error). Currency lookup (`currencyFromCode`) is a **deliberately
  curated** short list (USD/EUR/GBP/BGN today), not dinero's full 150+
  currency set — extend on demonstrated need.
- **`ZonedDateTime`** (`zoned-date-time.ts`) — wraps Luxon (chosen over the
  Temporal polyfill, which is still pre-1.0). `fromISO`/`now` return
  `Result` (a bad IANA zone is a real failure).
- **`Id<Brand>`** (`id.ts`) — generic branded-ID base. Concrete IDs
  (`TenantId`, `UserId`, ... in `domain/models`) each get a `private
constructor`, `static create(raw): Result<XId, EmptyIdError>`, and `static
generate(): XId` (`crypto.randomUUID()` directly — no `IdGeneratorPort`,
  that's a real seam but nothing needs to swap ID strategies yet).

## `libs/domain/models` (`scope:shared`, `type:util`, depends on `domain/kernel`)

Every model is a class: `private constructor` + `static create(props):
Result<X, XError[]>` (new instances — enforces creation-time invariants) +
`static reconstitute(props): Result<X, XError[]>` (rebuilding from
persistence — same field validation, skips creation-only invariants, e.g. a
past `Appointment` read from the DB is legitimate even though `schedule()`
requires a future start time). Error classes (`InvalidEmailError`,
`EmptyTenantNameError`, ...) live alongside each model in a `*.errors.ts`
file — classes extending `DomainError` (see `kernel` above), not `{kind:
...}` discriminated-union literals, except where the failure genuinely has
no useful subclass hierarchy (`OtpVerificationError` —
`already_consumed`/`expired`/`locked_out`/`wrong_code` — stays a `{kind}`
union since the caller branches on it immediately, it never propagates
further as a typed exception).

**`Appointment`** is the aggregate root and the deepest example: `status` is
a discriminated union (`AppointmentStatus`), not a status string plus a
separate optional `cancellationReason` field — `cancelled` structurally
_carries_ its reason, so there's no reachable state where a non-cancelled
appointment has a dangling cancellation reason. Every transition method
(`confirm()`, `cancel()`, `complete()`, `markNoShow()`) returns a **new**
instance and checks the current `status.kind` before allowing the
transition — the aggregate is immutable, nothing mutates `this`.

**`Otp`** is the other complex one, for a different reason: OTP hashing
genuinely needs `node:crypto` (`scryptSync`, `timingSafeEqual` have no
browser equivalent), but `domain/models` is `scope:shared` and gets
consumed by browser apps too (`apps/client`/`apps/staff` import it directly,
same as `apps/functions` does) — it can never import a Node builtin.
Resolved with `OtpCodeGenerator`/`OtpCodeHasher` ports
(`ports/otp-crypto.port.ts`); `Otp.issue()`/`.verify()` depend only on the
interfaces, the real `node:crypto`-backed implementation (`NodeOtpCrypto`)
lives in `apps/functions/src/adapters`. `Otp.verify()` is a pure check
(never mutates); a wrong code is reported via `{kind: 'wrong_code'}`
without touching `attemptCount` — the caller explicitly calls the separate
`otp.recordFailedAttempt()` and persists that. This split exists because
"the code was wrong" is a use-case-level decision about _what to do next_
(increment and persist), not something the pure verification check should
silently bundle in.

**Ports** (`ports/*.port.ts`) — pure interfaces, zero Firebase imports. This
is what makes the layer genuinely hexagonal, and it's mechanically
enforced: `eslint.config.mjs`'s `type:util → type:util, type:tokens` rule
structurally forbids `domain/models` from ever importing a `type:data-access`
lib, so a port interface here can never accidentally pull in
`firebase-admin`. `OtpRepositoryPort`/`UserRepositoryPort`/`ClockPort`/
`OtpSenderPort`/`AuthTokenPort` all have real adapters (`apps/functions`).
`TenantRepositoryPort`/`ServiceRepositoryPort`/`StaffRepositoryPort`/
`AppointmentRepositoryPort` are **interfaces only** — no Firestore adapter
exists yet, deliberately: nothing in this repo does CRUD on those entities
yet (the booking-flow/dashboard UI passes haven't landed), and building
untested, unused adapter code now would be exactly the kind of speculative
work this repo's `docs/design-research/decisions.md` already argues against
elsewhere. Build the adapter when a real use-case needs it.

## `apps/functions` — the reference hexagonal implementation

```
src/adapters/          Firebase/Node-specific — implements the ports
  firestore-otp-repository.ts    FirestoreOtpRepository implements OtpRepositoryPort
  firestore-user-repository.ts   FirestoreUserRepository implements UserRepositoryPort
  node-otp-crypto.ts             NodeOtpCrypto implements OtpCodeGenerator + OtpCodeHasher
  system-clock.ts                SystemClock implements ClockPort
  console-otp-sender.ts          ConsoleLogOtpSender implements OtpSenderPort (stub — real provider TBD)
  firebase-auth-token-adapter.ts FirebaseAuthTokenAdapter implements AuthTokenPort
src/use-cases/          Depend only on ports, never on firebase-admin/firestore directly
  request-otp.use-case.ts        RequestOtpUseCase
  verify-otp.use-case.ts         VerifyOtpUseCase
src/lib/otp/             onCall handlers — the composition root + the one place
  request-otp.ts, verify-otp.ts  a Result gets converted into a thrown HttpsError
```

**Mappers live inside each adapter file**, not as a separate layer — e.g.
`firestore-otp-repository.ts`'s module-private `toDomain()`/`toPersistence()`
functions call `Otp.reconstitute(...)`, so a malformed Firestore document
surfaces as a real, typed domain validation error at the read, not a silent
`undefined` deep in a template. This is also why **Zod was removed
entirely** from this repo: once entity factories are the sole validation
authority (confirmed as the deliberate choice over keeping a second
raw-shape-guard layer), a schema-validation library duplicates work the
entities already do.

**Result → HttpsError boundary**: `onCall`'s contract with the Firebase
client SDK is throw-based, so the `onCall` handlers are the one legitimate
place a `Result` gets `match()`-ed into either a return value or a thrown
`HttpsError` — every exported `toHttpsError()` function maps a specific
error class to the right code (`'resource-exhausted'` for rate-limit/lockout,
`'not-found'`, `'deadline-exceeded'`, `'invalid-argument'`, ...) **and**
forwards the `DomainError`'s `code`/`params` via `HttpsError`'s `details`
argument, so the frontend gets a structured, localizable payload instead of
raw English prose. Don't push the `Result` → `HttpsError` conversion any
earlier in the call chain — use-cases and entities stay `Result`-pure
throughout.

## `libs/adapters/i18n` (`scope:shared`, `type:util`) — day-0 i18n

English + Bulgarian at launch. Lives under `adapters/`, not `shared/`,
following the same precedent as `AuthStateService` in `adapters/firebase`:
this repo's `adapters/*` groups Angular services that wrap an external
library/system, not strictly domain-port implementations — Transloco is the
external system here, same as Firebase is for `adapters/firebase`.

- **`provideI18n()`** (`provide-i18n.ts`) — wraps `@jsverse/transloco`'s
  `provideTransloco({ config, loader: TranslationHttpLoader })`.
  `availableLangs: ['en', 'bg']`, `defaultLang`/`fallbackLang: 'en'`. Not yet
  wired into any app's `app.config.ts` — no UI currently renders user-facing
  text that needs translating (no login form shows an OTP error yet). Wire
  it in alongside whichever pass first ships real user-facing copy.
- **`TranslationHttpLoader`** (`translation-loader.ts`) — implements
  Transloco's `TranslocoLoader`, fetching `assets/i18n/{lang}.json` via
  `HttpClient`. The catalogs themselves live in this lib
  (`src/assets/i18n/en.json`, `bg.json`) under an `errors.*` namespace (room
  for `common.*`/`booking.*` etc. later) — **whichever app wires
  `provideI18n()` in also needs an assets glob in its build config copying
  this lib's `src/assets/i18n` into its own `assets/i18n` output**, since
  this is a non-buildable lib consumed via TS path mapping, not a package
  with its own published assets.
- **`translateDomainError(transloco, { code, params })`** — looks up
  `errors.<code>`, interpolates `params` (Transloco's default `{{param}}`
  syntax). Falls back to the raw `code` (never a raw English exception
  message) if the catalog has no entry — this is why `provideI18n()` also
  silences Transloco's own missing-key console warning, so there's exactly
  one fallback path, not two disagreeing ones.
- **`translateFunctionsError(error, transloco)`** — the actual frontend
  helper a login/OTP form calls. Unwraps a thrown `FunctionsError` (from
  `firebase/functions`, thrown by `httpsCallable()`) and reads the
  `code`/`params` (or aggregated `errors[]`) that `apps/functions`'s
  `toHttpsError()` forwarded via `HttpsError`'s `details` argument — see
  "Result → HttpsError boundary" above.

## What's deferred (named explicitly, not silently skipped)

Real Firestore adapters for `Tenant`/`Service`/`Staff`/`Appointment` —
build them alongside whichever feature pass first needs to actually read or
write one of these (the booking-flow UI, the dashboard). The domain
entities and port interfaces are already there; only the
`firebase-admin`/`firebase` SDK-specific implementation is missing.

**Where that adapter goes when it's built**: `libs/adapters/firebase/src/lib/adapters/`
(e.g. `firestore-appointment-repository.ts`, implementing `AppointmentRepositoryPort` from
`domain/models`, using the browser `firebase/firestore` SDK) — **never** a new
`scope:client`/`scope:owner`-tagged library. `libs/client/booking-data-access` and
`libs/owner/dashboard-data-access` existed briefly and were deleted for exactly this reason:
Firestore Security Rules are the real authorization boundary (`firestore.rules` already
restricts a client to their own appointments, staff to their tenant's), so there is nothing
scope-specific about the _adapter_ code — a `FirestoreAppointmentRepository` is the same
class whether `apps/client` or `apps/staff` calls it. This mirrors `apps/functions`'s own
adapters directory and gets the actual payoff of hexagonal architecture: one port
(`AppointmentRepositoryPort`), two adapters for two runtimes (Admin SDK for Cloud Functions,
browser SDK for Angular), not a third and fourth adapter per frontend app scope. What _is_
legitimately scope-specific is UI/feature code (`libs/client/booking-feature`, when that
pass lands) — see `docs/architecture/module-boundaries.md`'s Amendments section.
