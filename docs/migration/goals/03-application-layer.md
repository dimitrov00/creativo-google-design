# Goal 03 — Application layer (ports, use-cases, pure flows)

**Depends on:** 02 · **Blueprint refs:** §1.3, §5.3, §8 Phase 3

## Kickoff prompt

> Execute Phase 3 of `docs/migration-blueprint.md` (read §1.3, §5.3 first). Reference for flow semantics: `../v2/apps/web/src/machines/*.ts` and `../v2/apps/web/src/lib/auth/*` (read-only).
>
> 1. In `libs/application/*/ports`: define every port interface + co-located `InjectionToken` from the §1.3 wiring map (AuthGateway, OtpClient, AppointmentRepository, CatalogReader, MediaReader, CouponGrantRepository, RewardProgressReader, InvitationPort, ProfilePort, ContactChangePort, AvatarUploader, ImpersonationPort, UserSearchPort, BookingDraftStore, KeyValueStore, Clock, IdGenerator). Signatures speak domain types + `Result`; async streams are `Observable<Result<…>>`. The only `@angular/core` import allowed is `InjectionToken`/`inject`. **Primitive-obsession ban (blueprint §2.2):** no port method or use-case public API may take or return a bare `string`/`number` for a domain concept — ids, emails, phones, codes, amounts, dates are branded types/VOs; primitives cross only inside adapters (Goal 04) and VO factories. Extend the per-context type-level tests (`*.type-spec.ts`) with `@ts-expect-error` assertions on port signatures (e.g. `repo.findById('abc')` must not compile).
> 2. Retire the temporary port re-exports left in `libs/domain/models` by Goal 00 (`TODO(goal-03)` markers): repoint `apps/functions` imports to the application libs and delete the re-exports. Backend-only ports (OtpRepository, OtpCrypto, OtpSender, AuthTokenPort, UserRepository) live in `libs/application/identity` too, so functions and web share one contract source.
> 3. Use-cases per context (RequestOtp, VerifyOtp, RegisterUser, SignOut, EnsureSessionReady with refreshUntilActive backoff [0,200,400,700,1200,1600]ms; CreateBooking, CancelAppointment, ObserveUpcoming; catalog queries; ApplyDiscounts orchestration, CreateInvitation; profile/contact-change/avatar; impersonation lifecycle + user search). Constructor-injected ports, framework-free, every path tested against in-memory fakes.
> 4. Pure flow machines in `libs/application/*/flow` (§5.3): AuthFlow, OnboardingFlow, BookingFlow as discriminated-union state + `advance(state, event): Result<State, FlowError>`. Port v2's machine scenarios as tests, including the guest-guard latch semantics and monotonic guest/waitlist IDs. No XState.
>
> Greenfield: contracts may deviate from v2's callable schemas — record deviations in `docs/architecture/domain-deviations.md`.

## /goal condition

```
Phase 3 of docs/migration-blueprint.md is complete: (1) every port and InjectionToken named in blueprint §1.3's wiring map exists under libs/application with domain-typed, Result-returning signatures; (2) libs/domain/models no longer re-exports ports (no TODO(goal-03) markers remain) and apps/functions imports its ports from @creativo/application/*; (3) grep over libs/application shows no imports of firebase, and no @angular imports other than InjectionToken/inject from @angular/core; (4) use-case classes exist for identity, booking, catalog, engagement, accounts and governance per §1.1 with vitest suites running against in-memory fakes, all passing; (5) no port interface or use-case public signature under libs/application uses a bare string or number for a domain concept (ids, emails, phones, codes, amounts, dates are branded types or VOs), and type-level tests with @ts-expect-error assertions prove port methods reject plain strings; (6) libs/application contains AuthFlow, OnboardingFlow and BookingFlow as pure transition functions with tests covering the latch semantics and monotonic guest-id scenarios, with no xstate dependency anywhere in the workspace's libs; (7) `pnpm nx run-many -t typecheck lint test` exits 0; (8) nothing under ../v2 was modified. Or stop after 50 turns.
```

## Scope guard

- No adapters, no Firestore paths, no Angular components. In-memory fakes live in test utilities, not `src/lib`.
- Flow machines are UI-agnostic: no Router, no signals — a thin feature store wraps them later (Goal 06).
