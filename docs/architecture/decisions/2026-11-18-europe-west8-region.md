# The region: europe-west8, Milan, for everything (2026-11-18)

> **Status: DECIDED, built.** Owner, 2026-11-18: "we need to change our
> functions to use EU location as my target is Bulgaria". The region among
> the EU ones was delegated (rubric of `2026-10-26-owner-rulings.md`).
> Standard edition for the database was the owner's call the same day.

## The problem

Nothing set a region, so every function would have deployed to
`us-central1`, the web would have dialled it, and the CSP and preflight P5
named its host. The database's location was an open **decide** item in
`docs/production-deploy.md`. The shop and its clients are in Bulgaria:

- Every live update and read goes from the browser straight to the database.
  From Bulgaria, a US database adds roughly a transatlantic round trip to
  each one.
- A callable's transaction makes several database round trips inside the
  function, so the function belongs in the database's region.
- A Firestore trigger must sit in the database's location (Eventarc).

A database's location can never be changed. It is chosen once, for both
projects, before their databases exist.

## Decision

**`europe-west8` (Milan), regional, for the database, the default Storage
bucket and every function.**

- **Functions.** `setGlobalOptions({ region: FUNCTIONS_REGION })` runs in
  `apps/functions/src/main.ts`, before the first function is defined.
  Every function is 2nd gen, which is all Milan offers.
- **Web.** `getFunctions(app, FUNCTIONS_REGION)` in
  `libs/infrastructure/firebase-app`.
- **CSP.** The callables host is `https://europe-west8-<id>.cloudfunctions.net`.
  It comes from `functionsHost` in `tools/verify/csp/check-csp.mjs`, which
  `firebase.json`, the CSP gate, preflight P5, the deploy's checkout pointer
  and the smoke check all read.
- **Emulator journeys.** `verify-p0.mjs`, `verify-app-check.mjs` and the
  e2e warm-up post to the same region.
- **One value, four copies.** The functions, the web, the Node tools and
  the Playwright support cannot share a module.
  `tools/verify/csp/functions-region.spec.mjs` holds the copies equal. It
  also fails on any other region named in the code.

## Why Milan

| Location                 | Firestore | Functions (2nd gen)      | Scheduler | Price tier | Note                                                                    |
| ------------------------ | --------- | ------------------------ | --------- | ---------- | ----------------------------------------------------------------------- |
| **`europe-west8` Milan** | regional  | yes                      | yes       | Tier 1     | the nearest Tier 1 region to Bulgaria — chosen                          |
| `europe-west3` Frankfurt | regional  | yes                      | yes       | Tier 2     | as near, dearer per vCPU and GiB                                        |
| `europe-central2` Warsaw | regional  | yes                      | yes       | Tier 2     | as near, dearer                                                         |
| `europe-west1` Belgium   | regional  | yes                      | yes       | Tier 1     | farther from Bulgaria                                                   |
| `eur3` multi-region      | multi     | no (pair `europe-west1`) | no        | —          | 99.999 % SLA; dearer storage and operations; a function can't sit in it |

- **U (UX):** the database and the functions sit together, in the nearest
  Tier 1 region. The Tier 2 regions are about as near, but not nearer by
  enough to matter.
- **Cost:** Tier 1 rates for the functions' CPU and memory, and a regional
  database's operations rather than a multi-region's.
- **C (correctness):** Firestore, 2nd gen functions, Firestore triggers
  (Eventarc), Cloud Scheduler and Storage buckets are all offered in Milan
  (Google's location pages, read 2026-11-18). With one region for all of
  them, the trigger rule holds by construction.
- **M (simplicity):** one region everywhere. A multi-region database would
  pair with a function region the docs disagree on (`europe-west1` or
  `europe-west4` for `eur3`).
- **R (reversibility):** none for the database's location, which is why the
  staging project takes it first. The functions' region is a one-line
  change and this spec.

## Consequences

- Both projects' (default) database and default bucket are created in
  `europe-west8`: `docs/production-deploy.md` §1 and «Environments and
  releases».
- The Storage no-cost tier is for US buckets only, so the EU bucket is
  billed from its first byte: cents a month at this size.
- The deploy identity and the deploy itself need no change: they name no
  region.
- `CRON_TIME_ZONE` (`Europe/Sofia`) is the schedules' wall clock. It is not
  a region, and it is unchanged.

## Sources

- Cloud Functions for Firebase locations: https://firebase.google.com/docs/functions/locations
- Firestore locations: https://firebase.google.com/docs/firestore/locations
- Eventarc locations: https://docs.cloud.google.com/eventarc/docs/locations
- Cloud Scheduler locations: https://docs.cloud.google.com/scheduler/docs/locations
- Cloud Run locations and price tiers: https://docs.cloud.google.com/run/docs/locations
- Storage for Firebase locations: https://firebase.google.com/docs/storage/locations
