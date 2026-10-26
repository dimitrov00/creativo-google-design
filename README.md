# Creativo

A barbershop booking app on Firebase: an Angular SPA, Cloud Functions and
Firestore in one Nx workspace (pnpm). The code is pure ECS / data-oriented —
plain data, pure systems, impure-pure-impure pipelines, zero-mapper Firestore.

## Read first

- `CLAUDE.md` (mirrored byte for byte by `AGENTS.md`) — the repository
  constitution, Laws 1–10, for people and agents alike. The path-scoped
  templates per file kind are `.claude/rules/*.md`.
- `docs/architecture/HANDOFF.md` — the ECS migration record: what landed,
  the gate every change passes and its known baselines (§4), the open
  questions for the owner (§6) and the work carried forward.
- `docs/production-deploy.md` — production deploy: the one-time setup, the
  data bootstrap, the deploy order, verification and rollback.

## Apps

- `apps/web` — the Angular 22 SPA, served from Firebase Hosting.
- `apps/functions` — Firebase Cloud Functions (gen 2, Node 22), the backend
  composition root.
- `apps/showcase` — the design-system workbench.

The domain is `libs/ecs-core`, exported only through its `@core/*` tier
barrels (Law 8); the design system is `libs/ui/*`, the screens
`libs/features/*`, the SDK adapters `libs/infrastructure/*`.

## Verify

Always through Nx, never the raw tool (`CLAUDE.md` §5):

```bash
pnpm nx run-many -t typecheck
pnpm nx run-many -t test
pnpm nx run-many -t lint
pnpm nx run verify-tools:layering   # Law 8 — never cached, not part of run-many
pnpm nx build web
pnpm nx build functions
```

`typecheck` is plain `tsc` and does not see Angular templates — a template
error only surfaces in `pnpm nx build web`. The full gate, the emulator
journeys included, is `docs/architecture/HANDOFF.md` §4.
