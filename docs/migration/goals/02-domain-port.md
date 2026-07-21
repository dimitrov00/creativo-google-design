# Goal 02 — Domain port (bounded contexts + bug-class tests)

**Depends on:** 00 · **Parallel with:** 01 · **Blueprint refs:** §2, §7, §8 Phase 2

## Kickoff prompt

> Execute Phase 2 of `docs/migration-blueprint.md` (read §2, §7 first; conventions authority: `docs/architecture/domain-model.md`). Reference for business rules: `../v2/packages/domain/src/` (read-only — port the _rules_, not the code style; Valibot disappears entirely).
>
> Build `libs/domain/{identity,accounts,scheduling,catalog,engagement,governance}` on top of the existing kernel. Every VO/entity: private constructor, `static create()` returning `Result<T, DomainError[]>` (use `combineAll` for multi-field), `static reconstitute()` for persistence rebuild, immutable transition methods returning new instances. Branded types for every ID and validated primitive (kernel `Brand` helper — create `kernel/brand.ts` per §2.2 if absent).
>
> Content by context (from v2 inventory): identity — Principal, AuthClaims, Identifier, AuthStrategy, Otp, OtpCode, SessionKind, RedirectPath; accounts — User, UserAccount, UserRole (+isStaff), AccountStatus, BlockReason, Email, PhoneNumber (E.164 via libphonenumber, kernel-caged), FirstName/LastName, BirthDate (age 16–120 vs Clock-provided today); scheduling — Appointment aggregate with status machine pending→confirmed→completed|cancelled|no_show, BookingParty, Seat, SeatLabel, TimeSlot, WorkingHours; catalog — Service, ServiceCategory, Barber, Location, VenuePhone, MediaRef; engagement — Coupon, CouponValue, CouponGrant, DiscountApplication (deterministic total order per §7.4), Reward, RewardProgram, RewardProgress, Milestone, Invitation, InvitationRedemption, Achievement; governance — AuditEntry, Actor, ImpersonationSession (isExpired(clock)), FeatureFlags, TenantConfig.
>
> **Primitive-obsession ban (blueprint §2.2, hard rule):** no bare `string`/`number` carries domain meaning. Every id, email, phone, name, date, code, amount, percentage and path is a branded type or VO; a raw primitive may appear only as the `raw` parameter of a validating `create()` factory. Add a type-level test file per context (`*.type-spec.ts`) with `@ts-expect-error` assertions proving that (a) a plain string is rejected where a branded id is expected and (b) one brand cannot substitute for another (e.g. `ServiceId` where `AppointmentId` is required).
>
> This is greenfield: improve the model where v2 was awkward (you are encouraged to rename/merge concepts — record each deviation in a `docs/architecture/domain-deviations.md` list). Bake in the §7 ledger as tests-first: no calendar day ever derived from a raw Date (7.1), no `unsafe` money constructor (7.3), property-tested discount cap (7.4), monotonic sequence IDs in flows (7.7), shared expiry rule for impersonation (7.8). v2 itself is never patched.

## /goal condition

```
Phase 2 of docs/migration-blueprint.md is complete: (1) libs/domain contains identity, accounts, scheduling, catalog, engagement and governance libs, each exporting the entities/VOs listed in blueprint §1.1 (or documented renames in docs/architecture/domain-deviations.md), all using private constructors with static create/reconstitute factories returning Result; (2) grep over libs/domain shows zero imports from @angular, firebase, rxjs, zod or valibot, and dinero.js/luxon/libphonenumber-js appear only under libs/domain/kernel; (3) vitest coverage for libs/domain projects is at least 90% statements and every create() factory has at least one invalid-input test; (4) each bounded context contains a type-level test file with @ts-expect-error assertions proving plain strings are rejected where branded ids are expected and that distinct brands are not interchangeable, and no exported factory, entity method or VO accessor other than create(raw)-style entry points takes or returns a bare string/number for a domain concept; (5) tests exist and pass for: AppointmentStatus full transition matrix, discount application (property test: cap respected, never negative, input-order independent), BirthDate age bounds using an injected clock (no `new Date()` in domain source), monotonic guest/waitlist sequence (add-remove-add yields a fresh id), ImpersonationSession.isExpired; (6) `pnpm nx run-many -t typecheck lint test` exits 0; (7) nothing under ../v2 was modified. Or stop after 60 turns.
```

## Scope guard

- Pure TS only — no ports here (application layer owns them, Goal 03), no persistence shapes.
- Don't chase 1:1 API parity with v2's namespace-companion style; the class-factory convention wins.
