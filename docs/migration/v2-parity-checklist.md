# v2 → `apps/web` parity checklist (living ledger)

Authority: blueprint §0.5. **The migration is done only when every row below is checked** and its "New location" column names a concrete `apps/web` route/component or `apps/functions` handler. `apps/showcase` is an internal design-system workbench — it never satisfies a row; a feature that exists only in showcase is NOT migrated.

How to use: the goal that owns a row ticks it in the same session that lands the feature (with tests green). Renames/merges are fine (greenfield) — note them here and in `docs/architecture/domain-deviations.md`. Goal 08 audits this file and blocks until no row is unchecked or unmapped.

## Routes & screens

| ✔   | v2 surface (source)                                                          | What must work                                                                                                    | Owning goal | New location                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✔   | `/` landing (`routes/index.tsx`, `components/landing/*`, `components/map/*`) | Hero, work gallery, barbers, services + detail, hiring, locations map (lazy MapLibre), CTA, footer, scroll FX     | 06.1        | `apps/web` route `/` → `libs/features/marketing/landing` (`HomePage`); sections: hero + hiring-film + closing-cta + footer inline in `home.page`, `work-gallery`, `team-showcase` (barbers), `services.page` (+ detail sheet), `locations.component` (MapLibre, lazy `@defer (on viewport)` + dynamic `import('maplibre-gl')`) |
| ✔   | Installed-PWA redirect (active user on `/` → `/account`)                     | Redirect logic + test                                                                                             | 06.1        | `apps/web/src/app/guards/home.guard.ts` (pre-existing logic, unchanged); tests: `home.guard.spec.ts` (unit) + `apps/web/e2e/landing.spec.ts` (emulator E2E)                                                                                                                                                                    |
| ☐   | `/auth` (`routes/auth/*`, auth machine)                                      | Welcome → identify (phone/email per tenant strategy) → OTP entry → activation polling; latched guest guard        | 06.2        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/onboarding` (`routes/onboarding/*`, onboarding machine)                    | Steps: about, avatar, services, reward; resume for authed-but-inactive; lands on `/account`                       | 06.2        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/account` dashboard (`components/account/*`)                                | Shell nav, dashboard tiles, upcoming appointment, profile completion, loyalty summary                             | 06.3        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/account/appointments` (`appointments-*`, `components/date/*`)              | Month scrubber, calendar, appointment cards, cancel-own flow                                                      | 06.4        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/book` wizard (`features/book/*`, booking machine)                          | Guests/services/staff/datetime/review, `?step=` URL sync, cart, waitlist prefs, draft persistence, terminal views | 06.5        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | Rewards + coupons (`features/rewards/*`, `features/coupons/*`)               | Progress cards with milestones, coupon wallet                                                                     | 06.6        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/account/invites` (`invite-*`)                                              | Invite creation, share, expiry badge                                                                              | 06.6        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/account/settings` (`_client/account_.settings.tsx`)                        | Profile editor via domain factories, avatar upload, contact change request + verify                               | 06.7        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/staff` (`routes/staff/*`)                                                  | Role-gated dashboard, client search, staff-booked entry into booking flow                                         | 06.8        |                                                                                                                                                                                                                                                                                                                                |
| ☐   | `/admin`, `/admin/impersonate` (`routes/admin/*`, impersonation banner)      | User search, scope+reason form, session banner + return action, expiry enforcement, audit visibility              | 06.9        |                                                                                                                                                                                                                                                                                                                                |

## Cloud Functions

| ✔   | v2 function (source: `../v2/apps/functions/src/`)                             | Owning goal         | New handler |
| --- | ----------------------------------------------------------------------------- | ------------------- | ----------- |
| ☐   | OTP request/verify lifecycle (incl. attempt limits, blocklist, rate limiting) | 07 (pattern exists) |             |
| ☐   | registerUser (+ invitation redemption)                                        | 07                  |             |
| ☐   | createBooking                                                                 | 07                  |             |
| ☐   | updateProfile                                                                 | 07                  |             |
| ☐   | requestContactChange / verifyContactChange                                    | 07                  |             |
| ☐   | createInvitation                                                              | 07                  |             |
| ☐   | reward materialization (updateRewardProgress)                                 | 07                  |             |
| ☐   | expireStaleMilestones (scheduled hourly) + clawbackMilestoneRewards           | 07                  |             |
| ☐   | impersonation start / end / return                                            | 07                  |             |
| ☐   | admin blockUser / unblockUser / grantRoles / listUsers                        | 07                  |             |
| ☐   | staff findClients                                                             | 07                  |             |
| ☐   | SMS + email sender adapters (SMSAPI, Resend; console fallback in emulator)    | 07                  |             |
| ☐   | emulator seed script (`seed:emulator` concept)                                | 07                  |             |

## Cross-cutting behaviors

| ✔   | v2 behavior                                                                 | Owning goal | Where verified |
| --- | --------------------------------------------------------------------------- | ----------- | -------------- |
| ☐   | PWA: installability, offline shell, manifest, theme color                   | 05 / 08     |                |
| ☐   | i18n bg/en across all screens (Transloco)                                   | 05 / 06     |                |
| ☐   | Light/dark theming (black-and-white brand only — blue not ported by design) | 01 / 08     |                |
| ☐   | Session expiry watchdog + refreshUntilActive backoff                        | 04 / 05     |                |
| ☐   | Router as single history authority (no popstate listeners)                  | 06.2 / 06.5 |                |
| ☐   | Visual parity ≤1% pixel delta vs running v2 on key pages                    | 08          |                |

## Explicitly out of scope (decided, not forgotten)

- Blue brand theme — black-and-white only (blueprint decision log).
- v2's orphaned `referralRules` / `discountGrants` indexes — dropped (blueprint §0.4, §6).
- Any fix to v2 itself — v2 is read-only reference forever.
