# Dev-loop speed plan — typecheck, tests, CI

Status: **draft for owner review** (2026-11-01). Nothing in this plan has been
applied to the repository. Every number marked **measured** was taken on one
4-vCPU / 15 GB Linux container (Node 22.23, TypeScript 6.0.3, Nx 23.1.3,
Vitest 4.1.10, `@analogjs/vite-plugin-angular` 2.8.0), cold, with
`--skip-nx-cache`. Numbers marked **projected** are estimates from those
measurements and must be re-measured when the step lands.

## 1. Baseline (measured)

| Step      | Command                                 | Cold wall  | Critical path             |
| --------- | --------------------------------------- | ---------- | ------------------------- |
| typecheck | `nx run-many -t typecheck` (parallel 3) | **4m 19s** | 3m 10s (8 chained tasks)  |
| test      | `nx run-many -t test --parallel=3`      | **9m 15s** | 3m 24s (`ecs-core` alone) |
| lint      | `nx run-many -t lint`                   | 1m 06s     | 20s — not a bottleneck    |

14,841 tests in 43 vitest projects, all green. HANDOFF §4 already records the
typecheck at 5.5 min and runs the gate at `--parallel=1` because of a race on
the shared `dist/out-tsc`, so the gate is slower than the figure above.

## 2. Findings

### F1 — 35 of 39 spec tsconfigs re-typecheck the whole dependency graph from source

`tsconfig.spec.json` has no `references`, so every spec project parses and
checks its library _and every library below it_ from source. Per-tsconfig cost
with all referenced declarations already built (**measured**, summed over
sequential runs): 385 s total, of which **331 s (86 %) is spec projects**, 54 s
is lib/app code. The median spec project parses 1,614 files (7–12 s);
`ecs-core`'s spec project takes 25 s and re-checks all 90k lines of the library.

The four spec configs that do declare references (`patterns`, `loyalty`,
`dashboard`, `account`) check in 2.7–6.6 s. A throwaway prototype on
`client-booking` (lib + its 12 references added to the spec config) went
**9.6 s → 3.25 s** with zero errors.

Alternative measured: one shared program over every spec file checks in
**44.7 s on one process** (2,782 files, 0 errors, 1.8 GB). It is cheaper in CPU
but loses per-project caching and per-project `types`/`module` options, so it
is the fallback, not the first choice.

### F2 — dependents wait for their dependencies' _spec_ typecheck

`typecheck` is `tsc --build tsconfig.json` (lib, then spec) and depends on
`^typecheck` (added in `78bf9aa` to stop parallel `tsc --build` processes
racing over one `dist/out-tsc`). A dependent only needs the dependency's lib
declarations, but it waits for the dependency's spec project too. Result: the
critical path is 3m10s of the 4m19s run.

### F3 — `noEmitOnError: true` defeats incremental reuse

Defined once, in `tsconfig.base.json`. After a **comment-only** edit to one
`ecs-core` file, `tsc` incremental rechecks everything: check time
**5.74 s with the flag, 0.71 s without** (total 7.6 s → 2.5 s). Nothing else in
the repository reads the flag. A no-change rebuild is already 0.15 s, so the
build info itself works.

### F4 — vitest spends ~90 % of `ecs-core` and `functions` time importing modules

Each spec file gets a fresh module graph, and Law 8 mandates tier-barrel
imports, so every file reloads most of a tier.

| Project               | isolated (solo) | `--no-isolate` | Tests                                |
| --------------------- | --------------- | -------------- | ------------------------------------ |
| `ecs-core`            | 105 s           | **14 s**       | 7,264 / 7,264, also 2 shuffled seeds |
| `ecs-core` + coverage | —               | 29.7 s         | thresholds hold (98.59 % statements) |
| `functions`           | 20.6 s          | **6.0 s**      | 1,538 / 1,538                        |

Inside the 3-way-parallel gate `ecs-core` takes 203 s (import 459 s vs tests
42 s, cumulative across workers).

### F5 — the Analog Angular plugin costs ~13 s at startup, per Angular project, every run

35 of 43 vitest configs use `angular()`. Bisect on `client-booking`:
0.66 s without the plugin, 12.9 s with it, before any spec runs. CPU profile:
12.3 of 15.1 s inside `typescript.js` — `emit` → `getEmitResolver` →
`checkSourceFile`, i.e. a full type-check and emit of the ~1,750-file spec
program. This sits outside vitest's `Duration`, so the gate's 855 s of reported
vitest time understates it: 35 × 13 s ≈ **7.6 CPU-minutes** per full run. It
shares F1's root cause (the spec program contains all dependency source).

### F6 — the gate oversubscribes four cores

Nx runs 3 tasks, each a vitest pool of ~3 workers: up to 9 busy workers on
4 vCPUs. `ecs-core` is 105 s solo and 203 s inside the gate.

### F7 — smaller items

- `seed-tools` depends on `functions`, so `typecheck` (`dependsOn ^build`)
  pulls a full `functions:build:production` bundle into a typecheck run.
- `nxViteTsPaths` and `nxCopyAssetsPlugin` print deprecation warnings in every
  vitest run and are removed in Nx 24.
- CI `main` runs lint, test, build and typecheck serially in one job (75 min
  budget), cold, with no Nx cache restored.

## 3. Tried and rejected (do not repeat)

| Idea                                                | Result                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `angular({ jit: true })`                            | 32.8 s → 30.5 s on `client-booking` — negligible                                                                   |
| `angular({ disableTypeChecking: true })`            | 32.8 s → 29.1 s — negligible                                                                                       |
| `angular({ fastCompile: true })`                    | 4 of 12 booking spec files fail (`SyntaxError`); root cause unknown, `inlineStylesExtension: 'css'` did not fix it |
| `--no-isolate` on an Angular/jsdom project          | `client-booking` 17.9 s → 17.4 s — no gain, more leak risk                                                         |
| `experimental.fsModuleCache` with the Analog plugin | cold run fine, **warm run fails 5 of 12 spec files**                                                               |

## 4. Plan

Ordered by value over risk. Each step lands alone with a before/after number in
its commit message.

### Phase A — config only (about half a day)

**A1. `noEmitOnError: false` in `tsconfig.base.json`** (F3).
Verify: repeat the comment-edit probe (expect check ≈ 0.7 s); a deliberately
broken file in a dependency must still fail its dependents' `typecheck`; then
`nx build web` and `nx build functions` unchanged (both are esbuild, not `tsc`
emit).

**A2. `test.isolate: false` in `libs/ecs-core/vitest.config.mts` and
`apps/functions/vite.config.mts`** (F4). Then measure the other node-only
projects (`seed-tools`, `lint-rules`, `tokens`, the `tools/*` configs) and
adopt where the same pattern holds. Not for Angular/jsdom projects.
Verify: five shuffled runs per project (`--sequence.shuffle --sequence.seed=N`),
the CI `coverage` job, and `nx run-many -t test --parallel=3`. Escape hatch: a
spec that needs isolation moves to its own vitest project instead of reverting
the flag.

Projected: removes about 190 s (`ecs-core`) and 34 s (`functions`) of the
gate's contended time, and moves the critical path off `ecs-core` to
`staff-dashboard` (72 s).

### Phase B — typecheck structure (one to two days)

**B1. Add `references` to every `tsconfig.spec.json`**: the project's own
`tsconfig.lib.json` plus the lib's reference list (F1). Generate it with a
script, not by hand. Open question to check first: `@nx/js:typescript-sync`
and `nx sync:check` (run in CI `static`) may rewrite or reject hand-managed
references — confirm before mass-editing.

**B2. Split the target so dependents wait on lib declarations only** (F2):
a lib/app typecheck that `^`-dependents wait on, and a separate spec typecheck
nothing waits on. Either a small local inference plugin or `project.json`
overrides. This changes the gate commands in `CLAUDE.md` §5, `HANDOFF.md` §4
and `.github/workflows/ci.yml`.

**B3. Separate `outDir` per spec project** (HANDOFF open item). Removes the
shared-output race, so the gate can leave `--parallel=1` and the cache can be
trusted again.

**B4. Drop `^build` from `typecheck`** unless a project truly consumes a built
artifact (F7). Check `seed-tools` first.

**B5 (fallback only). Single shared spec program** (44.7 s) if B1–B3 fall short.

Projected: cold typecheck from 4m19s to roughly 1.5–2 min (spec CPU 331 s →
about 150 s; critical path no longer carries spec projects). **Re-measure.**

### Phase C — Angular test startup (spikes, one day each, time-boxed)

**C1. Diagnose `fastCompile`** (F5). If the `SyntaxError` is one fixable
pattern, startup drops from 13 s to near 1 s on 35 projects.

**C2. One shared Analog program for several Angular libs** (for example one
vitest config per tier: `ui`, `features`, `infrastructure`) so the ~13 s is
paid once per tier, not once per library. Cost: coarser Nx cache granularity.

**C3. Tune concurrency** (F6): Nx `--parallel` against vitest `maxWorkers`
once A and C land, because contention shrinks as the heavy projects shrink.

**C4. Replace the two deprecated Nx vite plugins** with `tsconfigPaths()` and
Vite's native asset handling (F7), before the Nx 24 upgrade.

Projected: C1 or C2 recovers most of the 7.6 CPU-minutes, about 2 min of
gate wall time.

### Phase D — CI (after A–C)

**D1.** Split `main` into parallel jobs (lint, typecheck, test, build), each on
its own VM — today they run back to back in one job.
**D2.** Revisit restoring `.nx/cache`: the stale-cache incident the CI comment
cites traces to the shared `dist/out-tsc` race that B3 removes. Owner decision.
**D3.** The `coverage` job re-runs `ecs-core`; after A2 it costs about 30 s.

## 5. Decisions needed from the owner

1. `isolate: false` for pure node projects — acceptable under the purity laws
   (a leak between specs would now be visible, not hidden)?
2. Changing the `typecheck` target contract (B2) touches the documented gate.
3. CI cache policy (D2).

## 6. Reproducing the numbers

```bash
pnpm install --frozen-lockfile
rm -rf dist && NX_DAEMON=false pnpm nx run-many -t typecheck --skip-nx-cache
NX_DAEMON=false pnpm nx run-many -t test --skip-nx-cache --parallel=3
NX_DAEMON=false pnpm nx run-many -t lint --skip-nx-cache

# per-tsconfig cost, declarations prebuilt (run from the project directory;
# `pnpm exec` in a directory without a package.json silently runs tsc at the
# workspace root and measures the wrong thing)
cd libs/features/client/booking
../../../../node_modules/.bin/tsc -p tsconfig.spec.json --noEmit --extendedDiagnostics

# test startup vs run
../../../../node_modules/.bin/vitest run zzz-none --passWithNoTests   # startup only
cd ../../../ecs-core && ../../node_modules/.bin/vitest run --no-isolate
```

Caveats: one machine, one run per figure except where stated; wall times
inside the parallel gate vary with contention; the typecheck projection in
Phase B rests on one prototype plus the four existing referenced specs.
