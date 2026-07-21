# Goal 04 — Infrastructure adapters (fresh Firestore schema)

**Depends on:** 03 · **Blueprint refs:** §0.4, §6, §8 Phase 4

## Kickoff prompt

> Execute Phase 4 of `docs/migration-blueprint.md` (read §0.4 and §6 first). Reference inventory: `../v2/packages/infrastructure/src/firestore-paths.ts` and `../v2/firestore.rules` (read-only). This is greenfield — design the canonical schema from the NEW domain vocabulary; do not inherit v2 names that the Goal 02/03 model renamed. Drop concepts with zero references (e.g. v2's orphaned referralRules/discountGrants indexes).
>
> 1. `libs/infrastructure/firestore`: `firestore-paths.ts` as the single path authority + typed ref factories; converters/mappers inside each adapter file (`toDomain` → `reconstitute`, `toPersistence` → plain JSON); repositories and callable adapters for every port in the §1.3 wiring map; `subscribeWithRetry` for live queries returning `Observable<Result<…>>`. **Primitive boundary (blueprint §2.2):** adapters are the ONLY layer where domain values become bare strings/numbers — inside `toPersistence()` output and wire payloads. Every value read back re-enters through `reconstitute()`/branded factories before leaving the adapter; adapter public methods (the port implementations) expose branded/VO types only, never raw primitives.
> 2. `libs/infrastructure/firebase-auth`: FirebaseAuthGateway — single `onIdTokenChanged` → `Principal` via domain claim parsing, `refreshUntilActive`, session-expiry watchdog. `libs/infrastructure/storage`: avatar upload + media reader. `libs/infrastructure/web-storage`: LocalStorage KeyValueStore + SessionStorage BookingDraftStore. Keep Firestore/Storage SDK imports lazy (dynamic import in provider factories) per §6.
> 3. Write fresh default-deny `firestore.rules` for the new schema (philosophy from v2: owner-only user docs, server-only otps/rateLimits/blocklist, clients never hard-delete appointments) and regenerate `firestore.indexes.json` strictly from the queries your repositories actually issue.
> 4. Tests: emulator integration suite per repository (Firestore emulator, seeded fixtures) + `@firebase/rules-unit-testing` suite for the rules + contract tests proving each adapter matches its port's in-memory-fake behavior spec.

## /goal condition

```
Phase 4 of docs/migration-blueprint.md is complete: (1) libs/infrastructure/firestore contains firestore-paths.ts plus adapter classes implementing every repository/callable/storage/web-storage port from blueprint §1.3's wiring map, with mappers calling domain reconstitute(), and no adapter public method (port implementation) accepts or returns a bare string/number for a domain concept — raw primitives appear only inside toPersistence/toDomain mapping code; (2) grep confirms "firebase/" imports exist only under libs/infrastructure and apps/functions; (3) firestore.rules is rewritten for the new schema with a default-deny match and passes a @firebase/rules-unit-testing suite covering owner-only user docs and server-only OTP/rate-limit/blocklist collections; (4) firestore.indexes.json contains no referralRules or discountGrants entries and every composite query issued by the repositories runs against the emulator without a missing-index error; (5) emulator-backed integration tests exist and pass for user, appointment, coupon-grant, reward-progress and catalog adapters; (6) `pnpm nx run-many -t typecheck lint test` exits 0 (emulator suites may run under a dedicated test-integration target, which also exits 0); (7) nothing under ../v2 was modified. Or stop after 60 turns.
```

## Scope guard

- No UI, no app wiring (Goal 05 owns `app.config.ts`).
- Schema decisions get one-line entries in `docs/architecture/domain-deviations.md` when they diverge from v2.
- Emulators are already configured in `firebase.json` (firestore 8080, auth 9099, functions 5001) — reuse, don't reinvent.
