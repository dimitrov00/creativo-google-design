# Goal 09 — Launch

**Depends on:** 08 · **Blueprint refs:** §8 Phase 9

## Kickoff prompt

> Execute Phase 9 of `docs/migration-blueprint.md`. Greenfield launch — nothing to migrate, no cutover machinery.
>
> 1. Production Firebase config review: `firebase.json` hosting target serves `apps/web`'s build output with SPA rewrites + immutable-asset caching headers; functions predeploy builds via Nx; rules + indexes from Goal 04 are the deploy artifacts. `apps/showcase` is an internal workbench (blueprint §0.5) — it must not appear in any hosting target or deploy artifact.
> 2. Deploy sequence (each step gated on the previous succeeding): `firebase deploy --only firestore:rules,firestore:indexes` → `--only functions` → hosting **preview channel** → run the Playwright E2E suite against the preview URL → promote to live.
> 3. Post-deploy verification: OTP sign-in, booking creation and account dashboard work on the live URL (manual script or Playwright against production with a test tenant); service worker serves the offline shell; Sentry (or chosen error reporter) receives a test event.
> 4. Write `docs/runbook-deploy.md` capturing the exact commands, rollback (`firebase hosting:rollback`, functions redeploy of previous tag), and emulator-vs-prod config differences.
>
> Do not run production deploys without confirming the target Firebase project id with me first — stop and ask before the first `firebase deploy` against a non-emulator project.

## /goal condition

```
Phase 9 of docs/migration-blueprint.md is complete: (1) firebase.json serves apps/web via the hosting target with SPA rewrites and caching headers, no hosting target references apps/showcase, and its functions predeploy builds through Nx; (2) rules, indexes and functions deployed successfully (command outputs shown in the transcript) and a hosting preview channel URL passed the Playwright E2E suite; (3) the site is promoted live and the transcript shows successful post-deploy checks for OTP sign-in, booking creation and the account dashboard; (4) docs/runbook-deploy.md exists with deploy and rollback commands; (5) the user explicitly confirmed the Firebase project id in this session before the first production deploy. Or stop after 25 turns.
```

## Scope guard

- Human gate on the project id is mandatory — the goal condition itself requires the confirmation to appear in the transcript.
- No feature work; any bug found here goes through a fix-forward commit with its own test.
