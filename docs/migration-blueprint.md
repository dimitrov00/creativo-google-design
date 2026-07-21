# Creativo Migration Blueprint — React (`v2/`) → Angular 22 Nx

> Status: proposed · Date: 2026-07-21
> Source: `Creativo/v2` (TanStack Start + React 19, Vite 8, Tailwind v4, XState 5, Valibot, Firebase)
> Target: `Creativo/creativo-google-design` (Nx 23, Angular ~22.0, pnpm, Vitest, hand-wrapped Firebase SDK)

---

## 0. Ground truth & target decision

### 0.1 Corrections to the brief

- **The source app is NOT Next.js.** `v2/apps/web` is **TanStack Start + TanStack Router** on React 19 / Vite 8 (SPA shell, `firebase.json` rewrites to `/_shell.html`). This changes nothing architecturally, but the routing/guard migration maps from TanStack `beforeLoad` + pathless layouts, not Next.js middleware/layouts.
- **The target workspace already exists.** `creativo-google-design` already ships the exact `Result<T, E>` kernel from the brief ([libs/domain/kernel/src/lib/result.ts](../libs/domain/kernel/src/lib/result.ts) — with `combine`, `combineAll`, `match` on top), branded `Id` types, `Money` (dinero), `ZonedDateTime` (Luxon), `DomainError`, a rich `libs/domain/models` layer with ports, Firebase `InjectionToken` providers, Transloco i18n, SwiftUI-semantic CSS tokens, and Nx module-boundary enforcement. **Decision: extend this workspace.** Creating a fresh `creativo-nx` would discard a tested domain kernel and token system that already match the brief's philosophy. (Every section below works identically if you later decide to start clean — the generators and layout are fully specified.)

### 0.2 What the product is (from `v2` analysis)

White-label barbershop **booking + loyalty PWA** ("Creativo" tenant): Bulgarian-first (bg/en), EUR, `Europe/Sofia`, phone-OTP auth, roles `client | barber | receptionist | content_manager | admin | sysadmin`, marketing landing, resumable onboarding, booking wizard (guests/services/staff/datetime/review/payment), account dashboard, appointments calendar, reward programs with milestones, coupon wallet, referral invites, staff dashboard, admin impersonation with audit log. Cloud Functions Gen-2 backend (OTP mint, booking, rewards materialization, impersonation, RBAC admin ops).

### 0.3 Constraint reconciliation (target workspace vs. brief)

| Topic             | Workspace today                                             | Brief mandates                             | Blueprint decision                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ports location    | inside `libs/domain/models`                                 | `libs/application`                         | **Create `libs/application/*`**; frontend-facing ports + use-cases move there. Domain keeps only entities/VOs/domain events.                                                                                                                                                                                                                                                                  |
| Adapters location | `libs/adapters/*`                                           | `libs/infrastructure`                      | **Rename/re-home to `libs/infrastructure/*`** (mechanical Nx `mv` + alias update).                                                                                                                                                                                                                                                                                                            |
| UI lib            | `libs/shared/ui` (`cr` prefix, `--cr-*` tokens, Roboto)     | `libs/ui` (`ui` prefix, `--sys-*` tokens)  | **New `libs/ui/*` is the system of record**, `ui` prefix, `--sys-*` tokens carrying **v2's actual visual values** (Onest/DM Sans, `#f26b22` accent) — parity target is the React app, not the Google-flavored showcase theme. Existing `cr` components are donor code.                                                                                                                        |
| Apps              | 4 frontend apps (client/staff/showcase/marketing)           | wiring at `apps/web/src/app/app.config.ts` | **Consolidate to a single `apps/web`** mirroring v2's one-SPA route tree (marketing at `/`, role-gated `/account`, `/staff`, `/admin`). Keep `apps/showcase` as the design-system workbench and `apps/functions` for the backend. v2 ships one PWA with one auth session; splitting it would break install/redirect UX parity.                                                                |
| Validation        | none (factories only)                                       | no Zod/Valibot/Forms validators            | Already aligned. v2's Valibot rules get **re-expressed inside static factories**.                                                                                                                                                                                                                                                                                                             |
| Domain purity     | kernel wraps `dinero.js` + `luxon`                          | "ZERO external dependencies"               | Keep the wrappers: both libs are pure, deterministic, and fully hidden behind `Money`/`ZonedDateTime`. Enforced rule: **only `domain/kernel` may import them** (ESLint boundary). Add `libphonenumber-js` under the same rule for `PhoneNumber` (E.164 validation is not something to hand-roll for a phone-OTP product). If you want literal zero deps, the seam to swap is one file per VO. |
| Firebase          | hand-wrapped SDK via `InjectionToken`s (no `@angular/fire`) | ports + adapters, no SDK leakage           | Already aligned — keep it.                                                                                                                                                                                                                                                                                                                                                                    |

### 0.4 Greenfield stance — full model & schema freedom

**Both apps are greenfield** — there is no production data and no live user base. Consequences:

- **v2's Firestore schema is a reference inventory, not a constraint.** The Angular app defines its own canonical schema; collections, field names, document shapes, callable contracts, entities, and aggregates may be renamed, merged, or redesigned wherever the domain model comes out cleaner. Improvements are encouraged, e.g.: drop the orphaned `referralRules`/`discountGrants` concepts entirely; unify the `coupons` / `couponGrants` / reward-ledger naming under the `engagement` context vocabulary; keep the `identities`/`identifiers` split only if the account-merge use-case actually demands it; derive indexes fresh from real queries instead of inheriting any.
- **No strangler/cutover machinery.** No side-by-side operation, no data migration, no schema-compat mappers. v2 is a spec donor (visuals, flows, business rules) and is otherwise left untouched.
- **v2 bugs are not fixed in v2.** The bug ledger (§7) exists only so the same mistakes are _designed out_ of the Angular domain — zero effort goes into patching the React app.

---

## 1. Deliverable 1 — Nx workspace & Ports/Adapters layout

### 1.1 Directory tree

```
creativo-google-design/
├── apps/
│   ├── web/                              # THE app (marketing + client + staff + admin), PWA
│   │   └── src/
│   │       ├── main.ts                   # bootstrapApplication(App, appConfig)
│   │       ├── styles.css                # @layer sys-tokens, sys-reset, sys-base, sys-components, sys-utilities
│   │       └── app/
│   │           ├── app.config.ts         # ★ COMPOSITION ROOT — Port → Adapter wiring (§1.3)
│   │           ├── app.routes.ts         # mirrors v2 route tree (§1.4)
│   │           ├── app.ts                # shell: theme init, session expiry guard, impersonation banner
│   │           └── guards/
│   │               ├── active.guard.ts   # ≈ v2 requireActive (anon→/auth, onboarding→/onboarding)
│   │               └── roles.guard.ts    # ≈ v2 RequireRoles (Principal.isStaff / isAdmin)
│   ├── showcase/                         # design-system workbench (tokens, modifiers, controls, cursor)
│   └── functions/                        # Cloud Functions Gen 2 (Node 22) — backend hexagon
│       └── src/
│           ├── main.ts                   # exports callables + scheduled fns
│           ├── use-cases/                # pure, DI'd via make-deps
│           └── adapters/                 # Admin-SDK Firestore repos, SMSAPI, Resend, crypto, clock
│
├── libs/
│   ├── domain/                           # ══ HEXAGON CORE — pure TS, no Angular, no Firebase ══
│   │   ├── kernel/                       # (exists) Result, DomainError, Brand, Id, Money, ZonedDateTime
│   │   ├── identity/                     # Principal, AuthClaims, Identifier(phone|email), AuthStrategy,
│   │   │                                 #   Otp, OtpCode, SessionKind, RedirectPath
│   │   ├── accounts/                     # User, UserAccount, UserRole, AccountStatus, BlockReason,
│   │   │                                 #   Email, PhoneNumber, FirstName/LastName, BirthDate
│   │   ├── scheduling/                   # Appointment (aggregate root), AppointmentStatus (state machine),
│   │   │                                 #   BookingParty, Seat, SeatLabel, TimeSlot, WorkingHours
│   │   ├── catalog/                      # Service, ServiceCategory, Barber, Location, VenuePhone, MediaRef
│   │   ├── engagement/                   # Coupon, CouponValue, CouponGrant, DiscountApplication,
│   │   │                                 #   Reward, RewardProgram, RewardProgress, Milestone,
│   │   │                                 #   Invitation, InvitationRedemption, Achievement
│   │   └── governance/                   # AuditEntry, Actor, ImpersonationSession, FeatureFlags, TenantConfig
│   │
│   ├── application/                      # ══ USE CASES + PORTS (interfaces + InjectionTokens) ══
│   │   ├── identity/
│   │   │   ├── ports/                    # AuthGateway, OtpSender, AuthTokenPort, IdentityRepository
│   │   │   └── use-cases/               # RequestOtp, VerifyOtp, RegisterUser, SignOut, RefreshUntilActive
│   │   ├── booking/
│   │   │   ├── ports/                    # AppointmentRepository, AvailabilityReader, BookingDraftStore
│   │   │   ├── use-cases/               # CreateBooking, CancelAppointment, ObserveUpcoming
│   │   │   └── flow/                     # BookingFlow — pure state machine (v2 XState port, §5.3)
│   │   ├── catalog/                      # CatalogReader, MediaReader ports + queries
│   │   ├── engagement/                   # CouponGrantRepository, RewardProgressReader, InvitationPort,
│   │   │                                 #   ApplyDiscounts orchestration, CreateInvitation
│   │   ├── accounts/                     # ProfilePort, ContactChangePort, AvatarUploader ports + use-cases
│   │   ├── governance/                   # ImpersonationPort, UserSearchPort, admin use-cases
│   │   └── shared/                       # Clock port, IdGenerator port, KeyValueStore port (theme/drafts)
│   │
│   ├── infrastructure/                   # ══ ADAPTERS — the ONLY libs importing firebase/* ══
│   │   ├── firebase-app/                 # (exists as adapters/firebase) FIREBASE_APP/AUTH/FIRESTORE/FUNCTIONS
│   │   │                                 #   tokens + provideFirebaseApp/Auth/FirestoreDb/Functions()
│   │   ├── firebase-auth/                # FirebaseAuthGateway (onIdTokenChanged → Principal signals),
│   │   │                                 #   CallableOtpClient (requestChallenge/verifyChallenge)
│   │   ├── firestore/                    # firestore-paths.ts (fresh schema, v2 as reference), converters/mappers
│   │   │                                 #   (toDomain via reconstitute / toPersistence), repositories:
│   │   │                                 #   FirestoreUserRepository, FirestoreAppointmentRepository,
│   │   │                                 #   FirestoreCouponGrantRepository, FirestoreRewardProgressReader,
│   │   │                                 #   FirestoreCatalogReader, subscribeWithRetry
│   │   ├── storage/                      # FirebaseStorageAvatarUploader, MediaAssetReader
│   │   ├── web-storage/                  # LocalStorageKeyValueStore (theme/locale), SessionStorage drafts
│   │   └── i18n/                         # (exists as adapters/i18n) Transloco + translateDomainError
│   │
│   ├── ui/                               # ══ DESIGN SYSTEM — headless, tokens, ui-prefix ══
│   │   ├── tokens/                       # tokens.css, theme-light.css, theme-dark.css (§3)
│   │   ├── modifiers/                    # UiFont, UiWeight, UiForeground, UiPadding, UiFrame, UiRadius (§4)
│   │   ├── controls/                     # UiButton, UiInput, UiOtpField, UiChip, UiBadge, UiAvatar,
│   │   │                                 #   UiSpinner, UiSkeleton, UiProgressRing (CDK a11y under the hood)
│   │   ├── layout/                       # UiStack (h/v/z), UiToolbar, UiSheet, UiScrollView, UiList
│   │   └── patterns/                     # UiCard, UiCalendarGrid, UiStepIndicator, UiDateBadge
│   │
│   ├── features/                         # presentation slices composing application + ui (scope-tagged)
│   │   ├── marketing/landing/            # hero, work-gallery, barbers, services, locations (MapLibre), CTA
│   │   ├── client/auth/                  # welcome → identify → OTP → activation (BookingFlow-style machine)
│   │   ├── client/onboarding/            # about → avatar → services → reward steps
│   │   ├── client/booking/               # wizard screens bound to BookingFlow store
│   │   ├── client/account/               # dashboard, appointments/calendar, rewards, coupons, invites, settings
│   │   ├── staff/dashboard/
│   │   └── admin/impersonation/
│   │
│   └── shared/                           # cross-cutting non-layer libs (cursor stays here)
│       └── cursor/                       # (exists)
```

### 1.2 Nx tags & boundaries (extends `docs/architecture/module-boundaries.md`)

Two axes, enforced by `@nx/enforce-module-boundaries`:

- `type:app → *` · `type:feature → feature|application|ui|util` · `type:application → application|domain|util` · `type:ui → ui|tokens|util` · `type:infrastructure → application|domain|util` · `type:domain → domain` (kernel only) · `type:tokens` leaf.
- `scope:marketing|client|staff|admin` may each depend only on themselves + `scope:shared`. All of `domain/application/infrastructure/ui` are `scope:shared`.

The critical arrows: **`ui` never sees `application` or `infrastructure`. `application` never sees Angular templates or Firebase. `infrastructure` is the only place `firebase/*` resolves** (add a `no-restricted-imports` rule for `firebase/*` everywhere else, mirroring the existing "only kernel imports dinero/luxon" rule).

### 1.3 Composition root — `apps/web/src/app/app.config.ts`

Ports export their contract **and** their `InjectionToken` from `libs/application/*` (the one permitted `@angular/core` import in that layer — the token must be visible to both consumers and the wiring). Adapters implement them in `libs/infrastructure/*`. Nothing outside `app.config.ts` names an adapter class.

```ts
// libs/application/booking/src/lib/ports/appointment-repository.port.ts
import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import {
  Appointment,
  AppointmentId,
  UserId,
} from '@creativo/domain/scheduling';
import { RepositoryError } from './repository.errors';

export interface AppointmentRepository {
  findById(
    id: AppointmentId,
  ): Promise<Result<Appointment | null, RepositoryError>>;
  save(appointment: Appointment): Promise<Result<void, RepositoryError>>;
  observeUpcomingFor(
    userId: UserId,
  ): Observable<Result<readonly Appointment[], RepositoryError>>;
}

export const APPOINTMENT_REPOSITORY = new InjectionToken<AppointmentRepository>(
  'AppointmentRepository',
);
```

```ts
// apps/web/src/app/app.config.ts
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import {
  provideFirebaseApp,
  provideFirebaseAuth,
  provideFirestoreDb,
  provideFirebaseFunctions,
} from '@creativo/infrastructure/firebase-app';
import { provideI18n } from '@creativo/infrastructure/i18n';

// Ports (application layer)
import { AUTH_GATEWAY, OTP_CLIENT } from '@creativo/application/identity';
import {
  APPOINTMENT_REPOSITORY,
  BOOKING_DRAFT_STORE,
} from '@creativo/application/booking';
import { CATALOG_READER, MEDIA_READER } from '@creativo/application/catalog';
import {
  COUPON_GRANT_REPOSITORY,
  REWARD_PROGRESS_READER,
  INVITATION_PORT,
} from '@creativo/application/engagement';
import {
  PROFILE_PORT,
  CONTACT_CHANGE_PORT,
  AVATAR_UPLOADER,
} from '@creativo/application/accounts';
import {
  IMPERSONATION_PORT,
  USER_SEARCH_PORT,
} from '@creativo/application/governance';
import { CLOCK, KEY_VALUE_STORE } from '@creativo/application/shared';

// Adapters (infrastructure layer) — named ONLY here
import {
  FirebaseAuthGateway,
  CallableOtpClient,
} from '@creativo/infrastructure/firebase-auth';
import {
  FirestoreAppointmentRepository,
  FirestoreCatalogReader,
  FirestoreCouponGrantRepository,
  FirestoreRewardProgressReader,
  CallableProfileAdapter,
  CallableContactChangeAdapter,
  CallableInvitationAdapter,
  CallableImpersonationAdapter,
  CallableUserSearchAdapter,
} from '@creativo/infrastructure/firestore';
import {
  FirebaseStorageAvatarUploader,
  StorageMediaReader,
} from '@creativo/infrastructure/storage';
import {
  LocalStorageKeyValueStore,
  SessionStorageDraftStore,
} from '@creativo/infrastructure/web-storage';
import { systemClock } from '@creativo/infrastructure/clock';

import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withViewTransitions(),
    ),
    provideServiceWorker('ngsw-worker.js', { enabled: environment.production }),
    ...provideI18n(),

    // Firebase SDK singletons (raw SDK stays behind these tokens)
    provideFirebaseApp(environment.firebase),
    provideFirebaseAuth(),
    provideFirestoreDb(),
    provideFirebaseFunctions(),

    // ── Port → Adapter map (the hexagon's outer wiring) ──
    { provide: AUTH_GATEWAY, useClass: FirebaseAuthGateway },
    { provide: OTP_CLIENT, useClass: CallableOtpClient },
    {
      provide: APPOINTMENT_REPOSITORY,
      useClass: FirestoreAppointmentRepository,
    },
    { provide: CATALOG_READER, useClass: FirestoreCatalogReader },
    { provide: MEDIA_READER, useClass: StorageMediaReader },
    {
      provide: COUPON_GRANT_REPOSITORY,
      useClass: FirestoreCouponGrantRepository,
    },
    {
      provide: REWARD_PROGRESS_READER,
      useClass: FirestoreRewardProgressReader,
    },
    { provide: INVITATION_PORT, useClass: CallableInvitationAdapter },
    { provide: PROFILE_PORT, useClass: CallableProfileAdapter },
    { provide: CONTACT_CHANGE_PORT, useClass: CallableContactChangeAdapter },
    { provide: AVATAR_UPLOADER, useClass: FirebaseStorageAvatarUploader },
    { provide: IMPERSONATION_PORT, useClass: CallableImpersonationAdapter },
    { provide: USER_SEARCH_PORT, useClass: CallableUserSearchAdapter },
    { provide: BOOKING_DRAFT_STORE, useClass: SessionStorageDraftStore },
    { provide: KEY_VALUE_STORE, useClass: LocalStorageKeyValueStore },
    { provide: CLOCK, useValue: systemClock('Europe/Sofia') },
  ],
};
```

Test configs swap the same tokens for in-memory fakes (`{ provide: APPOINTMENT_REPOSITORY, useClass: InMemoryAppointmentRepository }`) — no Firebase in component tests, ever.

### 1.4 Route tree (`apps/web/src/app/app.routes.ts`) — 1:1 with v2

| Path                                                   | v2 source                     | Guard                                                                                                       | Feature lib                    |
| ------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `/`                                                    | `routes/index.tsx`            | — (installed-PWA + active → redirect `/account`)                                                            | `features/marketing/landing`   |
| `/auth`                                                | `routes/auth/index.tsx`       | latched guest logic in component (NOT a route guard — v2 deliberately lets the user become authed mid-flow) | `features/client/auth`         |
| `/onboarding`                                          | `routes/onboarding/index.tsx` | `anonGate` (anon → `/auth`)                                                                                 | `features/client/onboarding`   |
| `/book`                                                | `routes/book/index.tsx`       | —                                                                                                           | `features/client/booking`      |
| `/account` (+`/appointments`, `/invites`, `/settings`) | `_client/*`                   | `activeGuard`                                                                                               | `features/client/account`      |
| `/staff`                                               | `staff.tsx`                   | `activeGuard` + `rolesGuard(Principal.isStaff)`                                                             | `features/staff/dashboard`     |
| `/admin`, `/admin/impersonate`                         | `admin/*`                     | `activeGuard` + `rolesGuard(admin)`                                                                         | `features/admin/impersonation` |

Guards are `CanActivateFn`s calling an `EnsureSessionReady` application service (port `AuthGateway`) that reproduces v2's `routerAuth.ensureReady()` + `refreshUntilActive` backoff (`[0, 200, 400, 700, 1200, 1600]ms`). The **latch** semantics from v2's `use-guest-guard.ts` (freeze the arrival verdict; don't bounce the user when claims flip mid-flow) are preserved as a signal captured once in the auth feature store.

---

## 2. Deliverable 2 — Core domain infrastructure

### 2.1 `Result<T, E>` — exists at [libs/domain/kernel/src/lib/result.ts](../libs/domain/kernel/src/lib/result.ts)

The kernel already contains the exact class pair from the brief, plus `combine()` (homogeneous list), `combineAll()` (heterogeneous tuple, collects **all** errors — used by multi-field factories), and `match()`. Reproduced for reference:

```ts
export class Success<T, E = never> {
  readonly kind = 'success' as const;
  constructor(readonly value: T) {}
  isSuccess(): this is Success<T, E> {
    return true;
  }
  isFailure(): this is Failure<T, E> {
    return false;
  }
}

export class Failure<T, E> {
  readonly kind = 'failure' as const;
  constructor(readonly error: E) {}
  isSuccess(): this is Success<T, E> {
    return false;
  }
  isFailure(): this is Failure<T, E> {
    return true;
  }
}

export type Result<T, E> = Success<T, E> | Failure<T, E>;

export const ok = <T, E = never>(value: T): Result<T, E> => new Success(value);
export const fail = <T = never, E = unknown>(error: E): Result<T, E> =>
  new Failure(error);
```

Rule (already documented in `docs/architecture/domain-model.md`): **Result-not-throw everywhere**; the only throw boundary is the Cloud Functions `onCall` composition root (Result → `HttpsError`) and, on the frontend, the adapter edge (SDK exception → `Result.fail(RepositoryError)`).

### 2.2 Branded-type helper — `libs/domain/kernel/src/lib/brand.ts`

```ts
declare const __brand: unique symbol;

/** Nominal typing without runtime cost: Brand<string, 'UserId'> ≠ Brand<string, 'ServiceId'>. */
export type Brand<TBase, TTag extends string> = TBase & {
  readonly [__brand]: TTag;
};
```

Every identifier and validated primitive is branded; raw `string`/`number` never crosses a port:

```ts
// libs/domain/scheduling — ids follow the existing kernel Id<Brand> class pattern
export type AppointmentId = Brand<string, 'AppointmentId'>;
export type UserId = Brand<string, 'UserId'>;
export type ServiceId = Brand<string, 'ServiceId'>;
```

The existing class-based `Id<Brand>` in `kernel/id.ts` (with `create(): Result` + `generate(): crypto.randomUUID()`) remains the constructor authority; the `Brand` alias is the zero-cost type used in port signatures.

**The primitive-obsession ban (hard rule).** No bare `string`/`number` may carry domain meaning anywhere in `libs/domain`, `libs/application`, or `libs/features`. Every id, email, phone, name, date, code, amount, percentage, count-with-meaning, path, and locale is a branded type or a value object. Bare primitives are legal in exactly three places:

1. **Inside a VO/entity factory implementation** — `create(raw: string)` is the one door where a primitive enters and is validated into a type.
2. **At the adapter/persistence edge** — `toPersistence()` output, Firestore document shapes, callable wire payloads (`libs/infrastructure`, `apps/functions` adapters). The matching `toDomain()` must immediately re-enter through `reconstitute()`/branded types.
3. **Purely presentational text in UI** — labels, aria strings, CSS values; anything that never reaches a port or a domain rule.

Technical booleans (`uiLoading`), array indices, and pixel/duration numbers inside UI directives are not domain values and stay plain. Enforcement: (a) port and use-case public signatures may not mention `string`/`number` except inside `create(raw: …)`-style validating entry points — audited per phase (goals 02–04 carry the check); (b) code review treats a bare-primitive parameter that names a domain concept (`userId: string`, `email: string`, `priceMinor: number`) as a blocking defect; (c) a type-level test file per context asserts key mistakes fail to compile (e.g. `@ts-expect-error` on `repo.findById('abc')` and on passing a `ServiceId` where `AppointmentId` is expected).

### 2.3 Sample Value Object — `Email` (private ctor, static factories, Result)

Ports v2's `packages/domain/src/primitives/Email.ts` Valibot rule into a factory; the Valibot dependency disappears.

```ts
// libs/domain/accounts/src/lib/email.errors.ts
import { DomainError } from '@creativo/domain/kernel';

export class EmailInvalidError extends DomainError {
  override readonly code = 'accounts.email.invalid';
  constructor(readonly attempted: string) {
    super(`"${attempted}" is not a valid email address`);
  }
}
```

```ts
// libs/domain/accounts/src/lib/email.ts
import { Result, ok, fail } from '@creativo/domain/kernel';
import { EmailInvalidError } from './email.errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class Email {
  private constructor(private readonly _value: string) {}

  /** Validating factory — the ONLY way user input becomes an Email. */
  static create(raw: string): Result<Email, EmailInvalidError> {
    const cleaned = raw.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleaned)) {
      return fail(new EmailInvalidError(raw));
    }
    return ok(new Email(cleaned));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: string): Email {
    return new Email(trusted);
  }

  get value(): string {
    return this._value;
  }
  equals(other: Email): boolean {
    return this._value === other._value;
  }
  toString(): string {
    return this._value;
  }
}
```

Same pattern applies across the port of v2's primitives: `PhoneNumber` (E.164 via libphonenumber, kernel-only import), `BirthDate` (age 16–120 — **fixed** to compute against `Clock.today()` in `Europe/Sofia`, see §7.1), `OtpCode` (`/^\d{6}$/`), `RedirectPath` (open-redirect-safe), `HexColor`, `Percentage`, `Points`, `SeatLabel`, `VoucherCode`. Entities (`Appointment`, `User`, `Coupon`, `RewardProgram`, `Invitation`, `ImpersonationSession`) follow the existing `models` convention: `private constructor` + `static create()` (invariants, `combineAll` for multi-error collection) + `static reconstitute()` (persistence rebuild) + **immutable transition methods returning new instances** (`appointment.confirm()`, `.cancel(reason)`, `.complete()`, `.markNoShow()` — porting v2's `AppointmentStatus.canTransition` matrix `pending → confirmed → completed | cancelled | no_show`).

---

## 3. Deliverable 3 — Design system: `libs/ui/tokens/tokens.css`

Pure CSS custom properties, SwiftUI semantic naming, **no Tailwind, no t-shirt sizes**. All values below are **extracted from v2's `packages/styles/styles.css`** — this is what guarantees pixel parity. Cascade layers: `@layer sys-tokens, sys-reset, sys-base, sys-components, sys-utilities;`.

```css
/* ════════════════════════════════════════════════════════════════
   libs/ui/tokens/tokens.css — system tokens (theme-independent)
   Naming: SwiftUI semantic scales. Scale vocabulary (NO t-shirt sizes):
   none · tight · compact · regular · comfortable · loose · spacious
   Control emphasis: subtle · regular · prominent · capsule
   ════════════════════════════════════════════════════════════════ */
@layer sys-tokens {
  :root {
    /* ── Typography: families (v2 parity: Onest / DM Sans / Geist Mono) ── */
    --sys-font-family-display: 'Onest Variable', system-ui, sans-serif;
    --sys-font-family-text: 'DM Sans', system-ui, sans-serif;
    --sys-font-family-mono: 'Geist Mono', ui-monospace, monospace;

    /* ── Typography: SwiftUI text roles (size/line-height ← v2 heading/text ladder) ── */
    --sys-font-extraLargeTitle: 800 clamp(2.125rem, 5vw, 2.75rem)/1.02
      var(--sys-font-family-display);
    --sys-font-largeTitle: 800 2.25rem/0.96 var(--sys-font-family-display); /* v2 heading-xl */
    --sys-font-title: 700 1.75rem/1.08 var(--sys-font-family-display); /* v2 heading-lg 28px */
    --sys-font-title2: 700 1.5rem/1.1 var(--sys-font-family-display); /* v2 heading-md */
    --sys-font-title3: 600 1.25rem/1.2 var(--sys-font-family-display); /* v2 heading-sm */
    --sys-font-headline: 600 1.125rem/1.3 var(--sys-font-family-display); /* v2 heading-xs */
    --sys-font-body: 400 0.9375rem/1.5 var(--sys-font-family-text); /* v2 text-lg 15px */
    --sys-font-callout: 400 0.875rem/1.45 var(--sys-font-family-text); /* v2 label-lg 14px */
    --sys-font-subheadline: 500 0.8125rem/1.4 var(--sys-font-family-text); /* v2 label 13px */
    --sys-font-footnote: 500 0.75rem/1.35 var(--sys-font-family-text); /* v2 label-sm 12px */
    --sys-font-caption: 500 0.6875rem/1.3 var(--sys-font-family-text); /* v2 label-xs 11px */

    --sys-tracking-largeTitle: -0.075rem; /* v2 -1.2px */
    --sys-tracking-title: -0.0375rem; /* v2 -0.6px */
    --sys-tracking-caption: 0.02em;

    /* ── Spacing: density-aware scale (v2 --spacing × --spacing-scale) ── */
    --sys-density: 1; /* [data-density] overrides */
    --sys-space-unit: calc(0.25rem * var(--sys-density));
    --sys-space-none: 0;
    --sys-space-tight: var(--sys-space-unit); /*  4px */
    --sys-space-compact: calc(var(--sys-space-unit) * 2); /*  8px */
    --sys-space-regular: calc(var(--sys-space-unit) * 4); /* 16px — v2 gutter */
    --sys-space-comfortable: calc(var(--sys-space-unit) * 6); /* 24px */
    --sys-space-loose: calc(var(--sys-space-unit) * 8); /* 32px */
    --sys-space-spacious: calc(var(--sys-space-unit) * 12); /* 48px */

    /* ── Controls (v2: sm 36 / md 44 HIG tap / lg 52) ── */
    --control-size-compact: calc(var(--sys-space-unit) * 9);
    --control-size-regular: calc(var(--sys-space-unit) * 11);
    --control-size-prominent: calc(var(--sys-space-unit) * 13);

    /* ── Radii (v2: --radius 0.75rem × --radius-scale 0.85) ── */
    --sys-radius-base: 0.75rem;
    --sys-radius-scale: 0.85;
    --control-radius-subtle: calc(
      var(--sys-radius-base) * var(--sys-radius-scale) * 0.5
    );
    --control-radius-regular: calc(
      var(--sys-radius-base) * var(--sys-radius-scale)
    );
    --control-radius-prominent: calc(
      var(--sys-radius-base) * var(--sys-radius-scale) * 1.75
    );
    --control-radius-capsule: 9999px;

    /* ── Containment (v2 parity) ── */
    --sys-container-content: 40rem; /* v2 --app-max-width */
    --sys-container-console: 48rem;
    --sys-container-drawer: 36rem;
    --sys-container-sidebar: 17rem;

    /* ── Elevation ── */
    --sys-elevation-raised:
      0 1px 2px rgb(0 0 0 / 0.06), 0 2px 8px rgb(0 0 0 / 0.04);
    --sys-elevation-overlay: 0 8px 30px rgb(0 0 0 / 0.12);

    /* ── Motion (v2: 200ms default / 150 fast / 300 medium) ── */
    --sys-motion-duration-instant: 150ms;
    --sys-motion-duration-regular: 200ms;
    --sys-motion-duration-deliberate: 300ms;
    --sys-motion-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
    --sys-motion-ease-emphasized: cubic-bezier(0.22, 1, 0.36, 1);

    /* ── Layering (v2 z-ladder) ── */
    --sys-layer-header: 60;
    --sys-layer-banner: 70;
    --sys-layer-overlay: 100;
    --sys-layer-alert: 110;
    --sys-layer-popover: 200;
  }

  :root[data-density='compact'] {
    --sys-density: 0.92;
  }
  :root[data-density='spacious'] {
    --sys-density: 1.08;
  }
}
```

```css
/* theme-light.css + theme-dark.css — v2 palette, verbatim values */
@layer sys-tokens {
  :root {
    color-scheme: light;
    --sys-color-background: #ffffff;
    --sys-color-foreground: #121212;
    --sys-color-surface: #ffffff; /* v2 card */
    --sys-color-surface-secondary: #f7f7f7; /* v2 secondary/muted */
    --sys-color-primary: #121212;
    --sys-color-on-primary: #ffffff;
    --sys-color-secondary-label: #666666; /* v2 muted-foreground */
    --sys-color-accent: #f26b22;
    --sys-color-on-accent: #ffffff;
    --sys-color-destructive: #c62828;
    --sys-color-success: #1f8a5f;
    --sys-color-warning: #b26a00;
    --sys-color-promo: #c2710c;
    --sys-color-on-promo: #241a00;
    --sys-color-ring: #121212;
    --sys-separator-strength: 4%; /* v2 --border-strength light */
    --sys-color-separator: color-mix(
      in srgb,
      var(--sys-color-foreground) var(--sys-separator-strength),
      var(--sys-color-background)
    );
    --sys-color-scrim: color-mix(in srgb, #000 45%, transparent);
    --sys-color-media-scrim: color-mix(in srgb, #000 70%, transparent);
    /* v2 alpha foundations (light) */
    --sys-alpha-fill: 4%;
    --sys-alpha-fill-hover: 6.5%;
    --sys-alpha-press: 9%;
    --sys-alpha-interactive: 7%;
    --sys-alpha-segment-selected: 14%;
  }

  :root[data-theme='dark'] {
    color-scheme: dark;
    --sys-color-background: #000000;
    --sys-color-foreground: #ededed;
    --sys-color-surface: #171717;
    --sys-color-surface-secondary: #242424;
    --sys-color-primary: #ededed;
    --sys-color-on-primary: #0d0d0d;
    --sys-color-secondary-label: #8c8c8c;
    --sys-color-accent: #f26b22;
    --sys-color-destructive: #d32f2f;
    --sys-color-success: #3fa56e;
    --sys-color-warning: #d08a2c;
    --sys-color-promo: #fbbf24;
    --sys-color-ring: #ededed;
    --sys-separator-strength: 12%;
    --sys-alpha-fill: 8%;
    --sys-alpha-fill-hover: 12%;
    --sys-alpha-press: 16%;
    --sys-alpha-interactive: 12%;
    --sys-alpha-segment-selected: 20%;
  }
}

/* v2's [data-brand="blue"] variant is deliberately NOT ported — the product ships
   the black-and-white brand only. The theming seam stays (all colors route through
   --sys-color-*), so a future brand is one override block, not a refactor. */
```

### 3.1 State & variant selection — class-identity + `[data-*]` only

```css
/* libs/ui/controls/button/button.css */
@layer sys-components {
  .ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sys-space-compact);
    block-size: var(--control-size-regular);
    padding-inline: var(--sys-space-regular);
    border: 0;
    border-radius: var(--control-radius-regular);
    font: var(--sys-font-callout);
    font-weight: 600;
    background: transparent;
    color: var(--sys-color-foreground);
    cursor: pointer;
    transition:
      background-color var(--sys-motion-duration-regular)
        var(--sys-motion-ease-standard),
      transform var(--sys-motion-duration-instant)
        var(--sys-motion-ease-standard);
  }

  /* Variants — SwiftUI button-style vocabulary */
  .ui-button[data-variant='prominent'] {
    /* v2 "default" */
    background: var(--sys-color-primary);
    color: var(--sys-color-on-primary);
  }
  .ui-button[data-variant='bordered'] {
    /* v2 "outline" */
    box-shadow: inset 0 0 0 1px var(--sys-color-separator);
  }
  .ui-button[data-variant='tinted'] {
    /* v2 "soft" */
    background: color-mix(in srgb, var(--sys-color-accent) 12%, transparent);
    color: var(--sys-color-accent);
  }
  .ui-button[data-variant='plain'] {
    color: var(--sys-color-secondary-label);
  } /* v2 ghost */
  .ui-button[data-variant='destructive'] {
    background: var(--sys-color-destructive);
    color: var(--sys-color-on-primary);
  }

  /* Sizes — semantic, not t-shirt */
  .ui-button[data-size='compact'] {
    block-size: var(--control-size-compact);
    font: var(--sys-font-subheadline);
    font-weight: 600;
  }
  .ui-button[data-size='prominent'] {
    block-size: var(--control-size-prominent);
    border-radius: var(--control-radius-prominent);
  }
  .ui-button[data-shape='capsule'] {
    border-radius: var(--control-radius-capsule);
  }

  /* States — attributes only, never modifier classes */
  .ui-button[data-state='loading'] {
    pointer-events: none;
    opacity: 0.65;
  }
  .ui-button[data-state='pressed'] {
    transform: scale(0.98);
  }
  .ui-button:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .ui-button:focus-visible {
    outline: 2px solid var(--sys-color-ring);
    outline-offset: 2px;
  }

  /* Modifier-attribute targets (written by ui* directives, §4) */
  [data-font='largeTitle'] {
    font: var(--sys-font-largeTitle);
    letter-spacing: var(--sys-tracking-largeTitle);
  }
  [data-font='title'] {
    font: var(--sys-font-title);
    letter-spacing: var(--sys-tracking-title);
  }
  [data-font='headline'] {
    font: var(--sys-font-headline);
  }
  [data-font='body'] {
    font: var(--sys-font-body);
  }
  [data-font='caption'] {
    font: var(--sys-font-caption);
    color: var(--sys-color-secondary-label);
  }

  [data-weight='regular'] {
    font-weight: 400;
  }
  [data-weight='medium'] {
    font-weight: 500;
  }
  [data-weight='semibold'] {
    font-weight: 600;
  }
  [data-weight='bold'] {
    font-weight: 700;
  }

  [data-foreground='secondary'] {
    color: var(--sys-color-secondary-label);
  }
  [data-foreground='accent'] {
    color: var(--sys-color-accent);
  }
  [data-foreground='destructive'] {
    color: var(--sys-color-destructive);
  }

  [data-padding='tight'] {
    padding: var(--sys-space-tight);
  }
  [data-padding='compact'] {
    padding: var(--sys-space-compact);
  }
  [data-padding='regular'] {
    padding: var(--sys-space-regular);
  }
  [data-padding='comfortable'] {
    padding: var(--sys-space-comfortable);
  }
  [data-padding='loose'] {
    padding: var(--sys-space-loose);
  }
  [data-padding='spacious'] {
    padding: var(--sys-space-spacious);
  }
}
```

Theme application: `data-theme` / `data-density` / `lang` are stamped on `<html>` by a pre-paint inline script in `index.html` reading the `KeyValueStore` key — porting v2's `THEME_INIT_SCRIPT`, but generated from **one** source module so the duplicated-constants drift in v2 (§7.6) cannot recur.

---

## 4. Deliverable 4 — SwiftUI modifier API via `ui*` directives

Atomic modifier directives write `data-*` attributes; CSS does 100% of the styling. Composition uses Angular `hostDirectives`.

```ts
// libs/ui/modifiers/src/lib/font.directive.ts
import { Directive, input } from '@angular/core';

export type UiFontStyle =
  | 'extraLargeTitle'
  | 'largeTitle'
  | 'title'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption';

@Directive({
  selector: '[uiFont]',
  host: { '[attr.data-font]': 'uiFont()' },
})
export class UiFontDirective {
  readonly uiFont = input.required<UiFontStyle>();
}
```

```ts
// libs/ui/modifiers/src/lib/weight.directive.ts
import { Directive, input } from '@angular/core';

export type UiFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

@Directive({
  selector: '[uiWeight]',
  host: { '[attr.data-weight]': 'uiWeight()' },
})
export class UiWeightDirective {
  readonly uiWeight = input.required<UiFontWeight>();
}
```

```ts
// libs/ui/modifiers/src/lib/padding.directive.ts
import { Directive, input } from '@angular/core';

export type UiPaddingScale =
  | 'none'
  | 'tight'
  | 'compact'
  | 'regular'
  | 'comfortable'
  | 'loose'
  | 'spacious';

@Directive({
  selector: '[uiPadding]',
  host: { '[attr.data-padding]': 'uiPadding()' },
})
export class UiPaddingDirective {
  readonly uiPadding = input<UiPaddingScale>('regular');
}
```

**Composition** — a text primitive that bundles the common modifiers, exactly like chaining SwiftUI view modifiers:

```ts
// libs/ui/modifiers/src/lib/text.directive.ts
import { Directive } from '@angular/core';
import { UiFontDirective } from './font.directive';
import { UiWeightDirective } from './weight.directive';
import { UiForegroundDirective } from './foreground.directive';

@Directive({
  selector: '[uiText]',
  hostDirectives: [
    { directive: UiFontDirective, inputs: ['uiFont'] },
    { directive: UiWeightDirective, inputs: ['uiWeight'] },
    { directive: UiForegroundDirective, inputs: ['uiForeground'] },
  ],
})
export class UiTextDirective {}
```

```html
<!-- SwiftUI: Text("Upcoming").font(.title).bold()                    -->
<h2 uiText [uiFont]="'title'" [uiWeight]="'bold'">Upcoming</h2>

<!-- SwiftUI: .padding(.large) → semantic scale, not t-shirt          -->
<section [uiPadding]="'loose'">…</section>
```

**Headless control** — native element + CDK a11y, state as data attributes, composed modifiers:

```ts
// libs/ui/controls/src/lib/button/button.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiPaddingDirective } from '@creativo/ui/modifiers';

export type UiButtonVariant =
  'prominent' | 'bordered' | 'tinted' | 'plain' | 'destructive';
export type UiControlSize = 'compact' | 'regular' | 'prominent';

@Component({
  selector: 'button[uiButton], a[uiButton]', // native elements only — free a11y semantics
  template: `<ng-content />`,
  styleUrl: './button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-button',
    '[attr.data-variant]': 'uiVariant()',
    '[attr.data-size]': 'uiSize()',
    '[attr.data-shape]': 'uiShape()',
    '[attr.data-state]': 'uiLoading() ? "loading" : null',
    '[attr.aria-busy]': 'uiLoading() || null',
  },
  hostDirectives: [{ directive: UiPaddingDirective, inputs: ['uiPadding'] }],
})
export class UiButton {
  readonly uiVariant = input<UiButtonVariant>('prominent');
  readonly uiSize = input<UiControlSize>('regular');
  readonly uiShape = input<'rounded' | 'capsule'>('rounded');
  readonly uiLoading = input(false);
}
```

Accessibility plumbing uses `@angular/cdk/a11y` (`FocusMonitor` → `data-state="focused"`, `LiveAnnouncer` for OTP/booking status) and `@angular/aria` listbox/combobox patterns for pickers — no ARIA hand-rolling in feature code.

---

## 5. Signal architecture (Angular 22, zoneless, OnPush)

### 5.1 Form fields bind to domain factories — no validators anywhere

```ts
// features/client/auth — email step (email_otp tenant variant)
@Component({/* … OnPush, uiInput composition … */})
export class EmailStep {
  readonly raw = signal('');
  readonly touched = signal(false);

  /** The domain factory IS the validator. */
  readonly result = computed(() => Email.create(this.raw()));
  readonly error = computed(() => {
    const r = this.result();
    return this.touched() && r.isFailure() ? r.error : null; // DomainError | null
  });
}
```

```html
<input
  uiInput
  [value]="raw()"
  (input)="raw.set($any($event.target).value)"
  (blur)="touched.set(true)"
  [attr.data-state]="error() ? 'invalid' : null"
/>
@if (error(); as e) {
<p uiText [uiFont]="'footnote'" [uiForeground]="'destructive'">
  {{ e | translateDomainError }}
</p>
}
```

`translateDomainError` (exists in the i18n adapter) maps `DomainError.code` + `params` to bg/en copy — dev-English messages never reach the UI.

### 5.2 Live data: ports return `Observable<Result<…>>`, components consume signals

Adapters wrap `onSnapshot` with the ported `subscribeWithRetry`; features convert at the edge with `toSignal(…, { initialValue: ok([]) })`. v2's app-wide single `users/{uid}` snapshot (`AccountProvider`) becomes one root-provided `AccountStateService` exposing `account`, `principal`, `claims` signals — same single-listener discipline as v2's `onIdTokenChanged`/`onSnapshot` pairing.

### 5.3 Flows: XState machines → pure TS state machines + signal stores

v2's `auth.machine.ts`, `onboarding.machine.ts`, `booking.machine.ts` are re-expressed as **pure transition functions in `libs/application/*/flow`** (discriminated-union state + `advance(state, event): Result<State, FlowError>`), unit-tested without Angular. A thin feature-store service wraps each in signals and handles URL sync (`?step=` ⇄ state via Router, replacing v2's hand-rolled dual-`popstate` reconciliation — §7.5) and draft persistence via the `BookingDraftStore` port. The v2 E2E selector contract is preserved verbatim: host binds `data-testid="booking-machine"` + `[attr.data-state]`.

---

## 6. Firebase infrastructure plan

- **Providers** (exist): `FIREBASE_APP/AUTH/FIRESTORE/FUNCTIONS` tokens; Firestore/Storage lazily imported to keep the entry bundle light (port v2's dynamic-import trick into the provider factories).
- **Auth**: `FirebaseAuthGateway` = single `onIdTokenChanged` → `Principal` (`anonymous | onboarding | active`) parsed by the domain (`SessionClaims`/`AuthClaims.fromToken`), plus `refreshUntilActive` backoff and session-expiry watchdog (`expiresAt` vs `Clock.now()` → sign-out + hard redirect).
- **Callables**: one thin adapter per port over `requestChallenge`, `verifyChallenge`, `registerUser`, `updateProfile`, `requestContactChange`/`verifyContactChange`, `createBooking`, `createInvitation`, `startImpersonationSession`/`endImpersonationSession`/`returnFromImpersonation`, `blockUser`/`unblockUser`/`grantRoles`/`listUsers`, `findClients`. Wire error mapping through `translateFunctionsError` (exists).
- **Repositories**: implement the deferred adapters in `libs/infrastructure/firestore` against a **freshly designed `firestore-paths.ts`** (single path authority; v2's version is the reference inventory, but names/shapes follow the new domain vocabulary — greenfield, §0.4). Mappers live inside each adapter file: `toDomain` calls `X.reconstitute(...)`, `toPersistence` emits plain JSON — per the existing `domain-model.md` convention.
- **Functions**: port v2's use-cases onto the new domain inside `apps/functions` (which already demonstrates the exact hexagonal shape with the OTP flow). Callable request/response contracts (v2 `callable/schemas.ts`) become domain factories on the server boundary too — Valibot exits everywhere.
- **Rules/indexes**: write fresh default-deny `firestore.rules` for the new schema (v2's rules are the philosophical baseline: owner-only user docs, server-only `otps`/`rateLimits`/`blocklist`); generate `firestore.indexes.json` from real queries only. Verify with `@firebase/rules-unit-testing` (already installed) + emulators (already configured: firestore 8080, auth 9099, functions 5001).

---

## 7. Legacy bug ledger — designed out of the new domain (v2 is never patched)

Found during React analysis. Both apps are greenfield, so no effort is spent fixing v2 — each item below simply gets a failing test first in the Angular domain, and the design prevents the bug class from recurring.

| #   | Bug (v2 location)                                                                                                                                                                                                                        | Fix in Angular domain                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | **`DateString.fromDate` uses runtime-local timezone** (`packages/domain/src/primitives/DateString.ts`) — a `Date` near midnight on a UTC server/foreign device yields the wrong calendar day for an Europe/Sofia product.                | No calendar-day is ever derived from a raw `Date`. `BirthDate`/`DateOnly` factories take ISO strings or `Clock.today()` (Clock port is zone-fixed to `Europe/Sofia`); `ZonedDateTime` kernel VO is the only date math authority. |
| 7.2 | **Orphaned Firestore indexes** — `firestore.indexes.json` declares `referralRules` + `discountGrants` collections that exist nowhere in source (renamed to `invitations`/`coupons`/`couponGrants`); real queries may be missing indexes. | Greenfield schema: indexes are generated only from queries the new adapters actually issue; orphan concepts are dropped entirely. Emulator test that every composite query runs.                                                 |
| 7.3 | **`Money.unsafe` bypasses invariants** and `fromMajor` takes `base[0]` for multi-base currencies (`primitives/Money.ts`) — `applyCap` can theoretically construct negative money.                                                        | Kernel `Money` already validates in factories; no `unsafe` escape hatch is ported. Currency set stays curated (EUR + …), exotic multi-base currencies rejected at `currencyFromCode`.                                            |
| 7.4 | **Order-sensitive discount cap** (`coupon/apply-discounts.ts`) — which coupon "gives way" under the cap depends on sort stability; ties break on array index.                                                                            | `DiscountApplication.apply()` defines a **total deterministic order** (kind rank → value → grantedAt → id) and is pinned with property-based tests (cap respected, never negative, order-independent input).                     |
| 7.5 | **Dual `popstate` listeners** in auth + onboarding flows and hand-rolled `?step=` back-stack sync (`routes/auth/index.tsx`, `book/index.tsx`) can double-fire on one browser-back.                                                       | Router is the single history authority: flow stores derive state from route params (`withComponentInputBinding`), never from raw `popstate`.                                                                                     |
| 7.6 | **Duplicated theme constants drift** — inline `THEME_INIT_SCRIPT` says dark meta-color `#000000`, `app.store.ts` says `#0D0D0D`.                                                                                                         | One generated pre-paint snippet sourced from the tokens module; meta `theme-color` values exist exactly once.                                                                                                                    |
| 7.7 | **Guest/waitlist ID resurrection hazard** (documented fix in `booking.machine.ts` — ids must key off max suffix, not array length).                                                                                                      | The pure `BookingFlow` keeps monotonic sequence counters in state; regression test ports v2's comment scenario (add, remove, add → no ID reuse).                                                                                 |
| 7.8 | **Impersonation expiry enforced only server-side**; client just compares `expiresAt`.                                                                                                                                                    | Kept server-authoritative (correct), but `ImpersonationSession` domain entity exposes `isExpired(clock)` so client UI and functions share one rule; audit write on every transition.                                             |

---

## 8. Deliverable 5 — Phase-by-phase migration plan

> **Execution package:** each phase below is packaged for Claude Code's `/goal` feature in [migration/goals/](migration/goals/README.md) — a kickoff prompt plus a machine-verifiable goal condition per phase. Run phases from those files; this section remains the narrative source of truth.

Each phase has an exit gate; phases 2–4 parallelize with 1 after 0 lands. Greenfield throughout: v2 is a read-only reference for visuals, flows, and business rules — never a runtime dependency and never patched.

### Phase 0 — Workspace alignment (≈ 3 days)

Restructure to the brief's layout: generate `libs/application/*`, `libs/ui/*`, `libs/features/*`; `nx g mv` `libs/adapters/*` → `libs/infrastructure/*`; move ports out of `domain/models` into `application/*/ports` (temporary re-exports keep functions compiling); consolidate `apps/client` + `apps/staff` + `apps/marketing` into `apps/web` (marketing home/locations/team components carry over as `features/marketing/landing` donor code). Add boundary rules: `firebase/*` restricted to `infrastructure`, `dinero/luxon/libphonenumber` restricted to `domain/kernel`.
**Exit gate:** `nx run-many -t typecheck lint test` green; dependency graph shows no layer violation.

### Phase 1 — Design system foundation (≈ 1.5 weeks)

Port v2 `styles.css` values into `libs/ui/tokens` (§3); fonts via `@fontsource` (Onest Variable, DM Sans, Geist Mono); build modifier directives (§4) and the control set needed by the first three features (`UiButton`, `UiInput`, `UiOtpField`, `UiChip`, `UiBadge`, `UiAvatar`, `UiCard`, `UiStack`, `UiToolbar`, `UiSheet`, `UiSkeleton`, `UiSpinner`); rebuild `apps/showcase` pages on the new system as the living spec.
**Exit gate:** showcase renders every control × variant × state × theme (light/dark, black-and-white brand only) × density; **screenshot-diff harness** (Playwright, added to the workspace) compares showcase controls against the running v2 Storybook at ≤ 1% pixel delta.

### Phase 2 — Domain port + bug fixes (≈ 2 weeks, parallel w/ 1)

Port every v2 primitive/entity into `libs/domain/*` bounded contexts in the class-factory style (§2.3): identity, accounts, scheduling, catalog, engagement, governance. Apply ledger fixes 7.1/7.3/7.4/7.7/7.8 with tests-first. Port v2's vitest suites and extend (target: every factory has invalid-input coverage; `AppointmentStatus` transition matrix and `ApplyDiscounts` are property-tested).
**Exit gate:** domain coverage ≥ 90%; zero imports of Angular/Firebase/Valibot anywhere under `libs/domain`.

### Phase 3 — Application layer (≈ 1 week)

Ports + `InjectionToken`s (§1.3) for all adapters listed in the wiring map; use-cases for auth/booking/engagement/accounts/governance; pure `AuthFlow`/`OnboardingFlow`/`BookingFlow` machines (§5.3) with unit tests replaying v2's machine scenarios (including latch semantics and monotonic guest IDs).
**Exit gate:** every use-case tested against in-memory fakes; no `firebase/*` or `@angular/*` (except `InjectionToken`/`inject`) imports.

### Phase 4 — Infrastructure adapters (≈ 1.5 weeks)

Design the canonical Firestore schema (`firestore-paths.ts`, new domain vocabulary — §0.4); converters + repositories; callable adapters; `FirebaseAuthGateway`; storage + web-storage adapters; fresh rules + indexes (§6). Emulator integration suites per repository (seed script inspired by v2 `seed:emulator`).
**Exit gate:** emulator suite green incl. rules tests; contract tests prove each adapter satisfies its port against the in-memory fake's behavior spec.

### Phase 5 — App shell (≈ 1 week)

`apps/web` composition root (§1.3), route tree + guards (§1.4), pre-paint theme script (7.6 fix), PWA service worker + install detection (v2's installed-PWA redirect), Transloco bg/en with v2's copy catalogs migrated, Sentry equivalent hookup, `SessionExpiryGuard` + `ImpersonationBanner` in the shell.
**Exit gate:** empty-page app boots against emulators; guards redirect anon→`/auth`, onboarding→`/onboarding`, non-staff→`Forbidden`.

### Phase 6 — Feature slices, in dependency order (≈ 6–8 weeks)

Each slice = feature lib + screenshot parity vs v2 (run locally as reference) + emulator E2E; ship to hosting preview channels as they land.

1. **Marketing landing** (`/`) — static-ish, exercises tokens/typography/MapLibre; biggest visual surface, best parity shakedown.
2. **Auth + onboarding** (`/auth`, `/onboarding`) — OTP flow end-to-end against ported functions; latched guest guard; activation backoff.
3. **Account dashboard** (`/account`) — live `users/{uid}` subscription, action tiles, upcoming appointment, profile completion.
4. **Appointments + calendar** (`/account/appointments`) — date primitives get real workout (7.1 fix visible here).
5. **Booking wizard** (`/book`) — `BookingFlow` store, draft persistence, `?step=` sync, cart, waitlist prefs.
6. **Rewards, coupons, invites** (`/account`, `/account/invites`) — progress cards, wallet, share flow, expiry badges (7.4 fix).
7. **Settings/profile + contact change** (`/account/settings`).
8. **Staff dashboard** (`/staff`) + `findClients`.
9. **Admin + impersonation** (`/admin/*`) — banner, scoped write, audit.

### Phase 7 — Cloud Functions port (overlaps 4–6)

Re-implement v2's functions use-cases on the new domain in `apps/functions` (OTP reference implementation already exists there): booking, register+invitation redemption, reward materialization + `expireStaleMilestonesScheduled` + clawback, impersonation lifecycle, admin ops, rate-limit/blocklist libs, SMSAPI + Resend adapters. Contracts and Firestore writes follow the **new** schema — no byte-compat with v2 required.
**Exit gate:** emulator integration suite asserts the business outcomes per use-case (OTP lifecycle incl. attempts/blocklist, booking creation, reward materialization + clawback, impersonation audit trail) from seeded scenarios.

### Phase 8 — Quality & parity hardening (≈ 1 week)

Full-page screenshot diffs (light + dark × bg/en × mobile/desktop) against a locally running v2; Lighthouse/PWA audit (install, offline shell); a11y sweep (CDK + axe); bundle budget (lazy Firestore/Storage/MapLibre confirmed).

### Phase 9 — Launch

Deploy functions + rules + indexes → hosting preview channel soak → go live on the hosting target. No cutover machinery needed (greenfield — nothing to migrate or keep warm); v2 is archived as reference.

---

## 9. Decision log

1. **Extend `creativo-google-design`** rather than new workspace — kernel/tokens/boundaries already match the brief; naming realigned in Phase 0.
2. **Single `apps/web`** — parity with v2's one-PWA UX and the brief's literal `apps/web/src/app/app.config.ts` wiring point.
3. **Greenfield schema freedom** — both apps have no production data; the Firestore schema, callable contracts, and domain model are designed fresh from the new vocabulary, with v2 as reference only. No data migration, no compat mappers, no fixes applied to v2 itself.
4. **`--sys-*` tokens carry v2 values** (Onest/DM Sans/`#f26b22`), superseding the Roboto-flavored `--cr-*` set; scale vocabulary `none…spacious`, control emphasis `subtle/regular/prominent/capsule` — no t-shirt sizes anywhere. **Black-and-white brand only** — the blue brand variant is not ported (the `--sys-color-*` seam keeps future brands cheap).
5. **Ports live in `libs/application` with co-located `InjectionToken`s** — the single sanctioned `@angular/core` import below the app shell.
6. **XState is not ported** — flows become pure transition functions (domain-testable) + signal stores; Router owns history.
7. **`dinero`/`luxon`/`libphonenumber` stay, caged in `domain/kernel`** behind VO facades and an ESLint import wall — pragmatic reading of "zero dependencies" that keeps money/time/phone correctness.
8. **No `@angular/fire`, no Zod/Valibot, no Tailwind, no Reactive Forms validators** — domain factories are the only validation authority; CSS classes give identity, `data-*` attributes give variant/state.
9. **Primitive obsession is banned outright (§2.2)** — no bare `string`/`number` with domain meaning outside VO factory entry points, adapter/persistence edges, and purely presentational UI text; branded types/VOs everywhere else, backed by per-context `@ts-expect-error` type tests and signature audits in goals 02–04.
