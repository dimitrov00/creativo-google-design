# Goal 06 — Feature slices (nine sequential sub-goals)

**Depends on:** 05 · **Blueprint refs:** §1.4, §5, §8 Phase 6

Run each sub-goal in its own session, in order. Shared kickoff preamble for every slice:

> Execute Phase 6 slice N of `docs/migration-blueprint.md` (read §5 for the signal/Result binding patterns). Visual reference: run v2 locally (`cd ../v2 && npm run dev`) and match it pixel-for-pixel using the `--sys-*` tokens and `ui*` components — extend `libs/ui` when a primitive is missing (keep it headless + `[data-*]`-styled). Components: standalone, OnPush, signals only; form inputs bind raw signals through domain `create()` factories, errors render via `translateDomainError` (blueprint §5.1). No new validation logic outside the domain. Each screen binds `data-testid` + `data-state` for E2E. Add a Playwright screenshot spec + emulator E2E per screen. Never modify ../v2. Keep `pnpm nx run-many -t typecheck lint test` green.

Common condition suffix for every sub-goal below: _"…; typecheck, lint and unit tests exit 0 workspace-wide; the slice's Playwright spec passes against emulators; nothing under ../v2 was modified. Or stop after 40 turns."_

## 6.1 Marketing landing (`/`) — `libs/features/marketing/landing`

v2 ref: `apps/web/src/components/landing/*`, `components/map/*`. Hero, work gallery, barbers, services + detail, hiring, locations (MapLibre, lazy-loaded), closing CTA, footer, scroll effects (respect reduced motion).
**/goal:** `The landing feature renders at / in apps/web with hero, work gallery, barbers, services, hiring, locations map and footer sections composed from libs/features/marketing/landing; MapLibre is lazy-loaded (not in the initial bundle per the build stats); installed-PWA active-user redirect to /account still passes its test; …`

## 6.2 Auth + onboarding (`/auth`, `/onboarding`) — `client/auth`, `client/onboarding`

v2 ref: `routes/auth/-components/*`, machines. Welcome → identify (phone or email per tenant strategy) → OTP entry (UiOtpField) → activation polling → onboarding steps (about, avatar, services, reward). AuthFlow/OnboardingFlow stores wrap the pure machines; Router owns step history (no popstate handling).
**/goal:** `A user can complete phone-OTP sign-in and onboarding end-to-end against emulators and ported functions: /auth walks welcome→identify→otp→activation using the AuthFlow store with data-testid/data-state bindings, invalid phone and invalid OTP show translated domain errors inline, /onboarding resumes for authed-but-inactive users and activation lands on /account; grep of the two feature libs shows no popstate listeners; …`

## 6.3 Account dashboard (`/account`) — `client/account`

v2 ref: `components/account/*`. App shell nav, dashboard tiles, upcoming appointment card, profile completion, loyalty summary — live from the single account snapshot.
**/goal:** `/account renders dashboard tiles, upcoming appointment and profile-completion cards from the AccountStateService signals with skeleton loading states; unit tests cover empty/loading/populated; …`

## 6.4 Appointments + calendar (`/account/appointments`)

v2 ref: `components/account/appointments-*`, `components/date/*`. Month scrubber, calendar view, appointment cards, cancel-own flow (domain transition + repository).
**/goal:** `/account/appointments shows a calendar and list bound to observeUpcomingFor with month navigation; cancelling an own appointment runs the domain cancel() transition through the repository and the E2E proves the status change; all date rendering flows through the kernel ZonedDateTime/Clock (grep shows no new Date() in the feature lib); …`

## 6.5 Booking wizard (`/book`) — `client/booking`

v2 ref: `features/book/*`, `machines/booking.machine.ts`. BookingFlow store + `?step=` URL sync via Router, guests/services/staff/datetime/review steps, cart, waitlist prefs, draft persistence via BookingDraftStore port, terminal success/failure views.
**/goal:** `A booking can be completed end-to-end on /book against emulators: steps sync to the ?step query param through the Router, browser back moves exactly one step, a mid-flow reload restores the draft from the BookingDraftStore, guest add-remove-add yields a fresh guest id, and createBooking writes an appointment verified by the E2E; …`

## 6.6 Rewards, coupons, invites (`/account`, `/account/invites`) — `client/account`

v2 ref: `features/rewards/*`, `features/coupons/*`, `components/account/invite-*`. Progress cards with milestones, coupon wallet, invite creation/share/expiry.
**/goal:** `Reward progress cards, the coupon wallet and the invites screen render live emulator data; creating an invitation via the port succeeds and shows an expiry badge; milestone progress reflects seeded reward events; …`

## 6.7 Settings + contact change (`/account/settings`)

v2 ref: `_client/account_.settings.tsx`. Profile editor (all fields through domain factories), avatar upload, contact-change request+verify flow.
**/goal:** `/account/settings edits profile fields through domain factories with inline translated errors, uploads an avatar through the AvatarUploader port, and completes the two-step contact change against emulators; …`

## 6.8 Staff dashboard (`/staff`) — `staff/dashboard`

v2 ref: `routes/staff/*`, `findClients`. Role-gated dashboard, client search, staff-booked appointment entry into the booking flow.
**/goal:** `/staff is reachable only for staff roles (rolesGuard test), renders the dashboard with client search via the UserSearchPort, and can start a staff-booked booking that pre-fills the BookingFlow; …`

## 6.9 Admin + impersonation (`/admin`, `/admin/impersonate`) — `admin/impersonation`

v2 ref: `routes/admin/*`, `components/impersonation-banner.tsx`. User search, scope+reason form, session banner with return action, audit visibility.
**/goal:** `An admin can start an impersonation session from /admin/impersonate (user search, read/write scope, reason), the shell banner appears with a working return action, expiry is enforced via ImpersonationSession.isExpired, and the E2E verifies the audit entries; …`
