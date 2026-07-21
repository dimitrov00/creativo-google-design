# Goal 07 — Cloud Functions on the new domain

**Depends on:** 04 · **Parallel with:** 05/06 · **Blueprint refs:** §6, §8 Phase 7

## Kickoff prompt

> Execute Phase 7 of `docs/migration-blueprint.md` (read §6 first). `apps/functions` already demonstrates the exact target shape with its OTP flow (use-cases + adapters + onCall Result→HttpsError boundary) — extend that pattern. Behavior reference: `../v2/apps/functions/src/` (read-only). Contracts and writes follow the NEW schema from Goal 04 — no compatibility with v2 required; request/response validation happens through domain factories at the boundary (no Valibot).
>
> Implement, each as use-case + adapters + onCall/onSchedule composition root, with unit tests on fakes and emulator integration tests: registerUser (+ invitation redemption), createBooking, updateProfile, requestContactChange/verifyContactChange, createInvitation, reward materialization (updateRewardProgress) + expireStaleMilestones (scheduled, hourly) + clawbackMilestoneRewards, impersonation start/end/return, admin blockUser/unblockUser/grantRoles/listUsers, staff findClients. Supporting libs: rate limiting, blocklist, SMSAPI + Resend sender adapters (console fallbacks for emulator), actor-from-request. Port the emulator seed script concept from v2 (`seed:emulator`) to the new schema.

## /goal condition

```
Phase 7 of docs/migration-blueprint.md is complete: (1) apps/functions/src/main.ts exports callable handlers for register, booking creation, profile update, contact change (request+verify), invitation creation, impersonation start/end/return, admin block/unblock/grantRoles/listUsers and staff findClients, plus an hourly scheduled stale-milestone expiry — alongside the existing OTP handlers; (2) every handler delegates to a use-case class whose unit tests run on in-memory fakes, and grep shows no valibot or zod anywhere in apps/functions; (3) an emulator integration suite passes covering: full OTP lifecycle including attempt limits and blocklist, registration redeeming an invitation, booking creation, reward materialization plus clawback, and an impersonation session leaving audit entries; (4) a seed script populates the emulator with the new schema and is documented in the functions README; (5) `pnpm nx build functions` and `pnpm nx run-many -t typecheck lint test` exit 0; (6) nothing under ../v2 was modified. Or stop after 60 turns.
```

## Scope guard

- Server-side adapters (Admin SDK) live in `apps/functions/src/adapters`, per the existing convention — not in `libs/infrastructure` (that's browser-side).
- Domain and application libs are consumed, never modified here except to add genuinely missing shared contracts (flag them in the final report).
