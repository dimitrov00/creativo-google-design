# Performance and cost audit, and the enforcement design

Audited at commit `86870b9d` on 2026-11-02, reviewed in five stages
(`docs/architecture/review/`) and revised the same day. The findings describe
that commit; those reports' line numbers point at the first draft.

Creativo is a booking app for barbershops, in Bulgaria, on Angular and Firebase.
"The laws" are the ten in `CLAUDE.md` §1. `HANDOFF.md` is the project record, and
D-numbers and OR-numbers are rulings recorded there and in `decisions/`.

## 1. Summary

The question was whether the code follows the laws, is data-oriented and
cost-efficient, and whether any gap stands between it and feature work.

**Before feature work, four things needed fixing. All are fixed or in review:**

| Finding | What was wrong                                                           | State                    |
| ------- | ------------------------------------------------------------------------ | ------------------------ |
| F-01    | Parties of four or more service lines lost most of the day's start times | Fixed on `main`          |
| F-02    | Nothing blocked a bad merge                                              | Fixed: ruleset on `main` |
| F-03    | A lint rule change did not re-lint `ecs-core` or `functions`             | PR #8                    |
| F-04    | Performance and cost had almost no checks                                | PRs #10, #11, #12        |

F-09, a Law 7.3 breach that gave one daylight-saving-gap time three answers, is
also in review: PR #9.

**Laws:** the sweep found no blocker-level violation. The largest breach, domain
rules and wording inside two staff components (F-08), is fixed on the owner's ruling
that it comes before feature work: 24 decisions moved to systems, 65 wording rows to
presenters, and `max-lines` holds both files at their new, shorter length. Both files
were then read in full, so the inventories in `review/` replace the sample below.

**Data-oriented design:** true of the availability search, not of the feature
layer. The V8 goal stays unproven, and nothing here measures it (section 8).

**Cost:** low at the assumed scale. Firestore is about $1-2 a month, and Hosting is
probably the largest recurring line (section 5.4). The real exposure is abuse
(section 5.6), and it can't cost money until the first deploy. Gate B handles it.

"No gaps left" cannot be claimed: section 9 lists what was not examined. The
checks turn some regressions into a red build, but several laws stay review
rules, because no reliable check exists for them (section 6).

## 2. Problem

The architecture exists for two stated reasons: mechanical sympathy with V8, and
mechanical sympathy with Firestore's pricing and indexing (`CLAUDE.md` §0). The
record in `HANDOFF.md` shows the laws were applied, but neither of those two
outcomes has a number attached:

- No document states a target for reads per journey, bundle size per route or
  function load weight.
- No benchmark exists. The claims about V8 are asserted, apart from
  operation-count comments in code.
- `docs/production-deploy.md` leaves budget, instance caps and region as open
  **decide** items.

Feature work is about to add code to this base. Without numbers and gates, the
base can only be protected by review.

## 3. Goals and non-goals

**Goals**

- Find what would make bookings wrong or lost.
- State whether the code follows the ten laws, including what lint cannot see.
- State what Firestore costs per user action, and the rough bill by service.
- Rank what to fix before feature work and what to fix before the first deploy.
- Define budgets and automated checks that stop regressions.

**Non-goals**

- Optimising for traffic the product does not have. The planning scale is
  below (section 4).
- Rewriting the staff components in one pass.
- Reopening decisions D1–D29 or the owner rulings OR-1 to OR-59, except where a
  finding is flagged as needing a new ruling.
- Reviewing visual design, `libs/ui` internals or security beyond cost abuse.
- Per-action costs for Functions, Storage and Hosting, and client memory figures.

## 4. Method and limits

Five read-only audits ran independently, covering law compliance, enforcement
coverage, Firestore cost, Functions and Hosting cost, and client CPU and
memory. The main findings were then checked against source by the author of this
document. Each finding carries one of these labels:

| Label         | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| **Measured**  | A command or script ran and produced the number.                      |
| **Confirmed** | Read in source; no run needed.                                        |
| **Estimated** | Derived from counts plus assumptions. Treat as an order of magnitude. |

**Run on this commit:** `verify-tools:layering`, `run-many -t lint`, `build web`
and `build functions` all exited 0. The test, typecheck and emulator gates were
not re-run.

**Planning scale (assumption):** 2 shops, 10 barbers, 30 services, 100 bookings
a day, 1,000 `/book` visitors a day, 10 staff. The first draft assumed 300 bookings
a day, which exceeds what 10 barbers can serve. The app has never been deployed,
so no real billing or traffic data exists.

**Prices.** The Firebase pricing page gave the free allowances used here: 50,000
Firestore reads, 20,000 writes a day; 2 million function invocations a month;
360 MB of Hosting transfer a day at $0.15 per GB after that. The Google Cloud
Firestore price page could not be read, so per-operation Firestore prices are
from memory ($0.03–0.06 per 100,000 reads, $0.09–0.18 per 100,000 writes,
varying by location) and must be checked before anyone relies on them.

## 5. Findings

Severity: 🔴 stops a gate, 🟡 should be fixed, 🟢 small. IDs are used by the plan
in section 11.

### 5.1 Booking correctness

**F-01 🔴 The availability search loses start times for larger parties.**
_Measured, reproduced twice. Fixed: see `review/availability_spike.md`, whose
e2e journey fails on the old search on the real dev catalogue._

`availableStarts` walks every arrangement depth-first. The first seat stays at
its earliest start while later seats try every other time of day, so the 200,000
node budget (`availability.system.ts:191`) is spent before the first seat ever
reaches the afternoon. The comment at `availability.system.ts:851` says the
budget "buys breadth (the afternoon)", which these runs contradict.
`booking-cart.system.ts:638-655` keeps `result.options` and drops `exhausted`, so
no caller knows. A search of production code finds no reader of this flag.

Synthetic day, all lines on any barber, 30 min service, 15 min step, 09:00–19:00:

| Barbers | Appts per barber | Party (by person) | Nodes   | Starts found | Last start | Starts for one line |
| ------- | ---------------- | ----------------- | ------- | ------------ | ---------- | ------------------- |
| 3       | 4                | a, b              | 6,912   | 28           | 18:30      | 28                  |
| 3       | 4                | a, b, c           | 200,000 | 28           | 18:30      | 28                  |
| 3       | 4                | a, a, b, b        | 200,000 | 1            | 09:30      | 28                  |
| 5       | 5                | a, b, c           | 200,000 | 14           | 14:15      | 25                  |
| 5       | 5                | a, a, b, b        | 200,000 | 1            | 09:30      | 25                  |
| 10      | 6                | a, b, c           | 200,000 | 7            | 12:50      | 18                  |
| 10      | 3                | a, a, b, b        | 200,000 | 1            | 09:30      | 30                  |

The default `maxPartySize` is 5 and lines count services, so these parties can
be booked today. Three-line parties lost anything from none to most of their
starts on these synthetic days, and the seed catalogue's party of three lost none.
Four lines lost nearly all. The app has never been deployed, so no real booking was
lost. The search also fed the waitlist, which could report a false "no match".

### 5.2 Enforcement

**F-02 🔴 `main` has no protection.** _Measured._ The GitHub API answers 404
"Branch not protected". The seven CI jobs report but block nothing. This
conflicts with the standing practice of committing directly to `main`, so it
needs an owner ruling (section 7, alternative A1).

**F-03 🔴 A lint rule change does not re-lint the core.** _Measured._ CI runs `nx
affected -t lint` (`ci.yml:57`). `nx show projects --affected
--files=tools/lint-rules/ecs-syntax.mjs` lists 38 projects, and `ecs-core` and
`functions` are not among them. A tightened rule can merge green without running
on the code it was written for. The pre-commit hook runs no ESLint.

**F-04 🔴 No performance or cost gate exists.** _Confirmed._

| Concern                      | Today                                                     |
| ---------------------------- | --------------------------------------------------------- |
| Unbounded query              | No check. 19 heuristic candidates, not triaged            |
| New realtime listener        | No check. 4 `onSnapshot` sites today                      |
| Query has a composite index  | Audit and privacy groups only; 24 composites overall      |
| `get()`/`exists()` in rules  | No count. One today (`firestore.rules:193`)               |
| Route bundle size            | Initial bundle only; route chunks have no limit           |
| Function settings            | `main.spec.ts` pins the table, it does not require values |
| Function load weight         | Dependency names only                                     |
| `new Intl.*` outside a cache | Banned in systems and primitives only; 5 UI sites         |
| Benchmarks or scaling tests  | None                                                      |

**F-07 🟡 Holes in the law rules.** _Measured by running ESLint on virtual files;
the rule did not fire._

- Bare discriminator literal: `=== 'CONFIRMED'` passes. Zero real uses today.
- Systems: `performance.now`, `setInterval`, `process.env`, `node:fs` and a lazy
  `import('firebase-admin')` all pass.
- Non-suffix files inside `src/systems` escape the purity rules. Five non-suffix
  tier files exist across the library, such as `entities/collections.ts`.
- Input mutation: `xs.sort()` on a parameter passes. Two `.push` calls on
  parameters exist (`billing.system.ts:257`, `loyalty-catalog.system.ts:109`).
  These two were not read to see whether they mutate caller-owned data.
- Law 5: a dot-path key and a `Record<string, …>` field both pass. Zero real
  uses today.
- Law 6.1: a named nested type passes; only inline literals are caught.
- Law 7.4: raw brands in parameters, `interface`, pipelines, functions,
  `libs/shared` and `libs/infrastructure` all pass.
- Law 9: a port type declared in a pipeline passes.
- `presenter-purity` matches `.words.ts`, so `tag-words.ts`, `booking-words.ts`
  and `visit-row-words.ts` (with a hyphen) escape it.

Security rules are warnings with no `maxWarnings`, so 200 or more warnings pass
in every lint run. `gauge.css` is 45 bytes over its style budget warning in every
build.

### 5.3 Law compliance

The sweep found no Blockers. Counts for the patterns searched, in production
code, are in the appendix (section 12). The core is law-shaped and, in its hot
path, also data-oriented: `availability.system.ts:322` uses `Int32Array` terms
and a compressed eligibility index; across systems there are 668 indexed `for`
loops against 11 `map`/`filter` calls. Only about 25 of 99 systems and 8 of 49
pipelines were read in part, and the rest were pattern-swept.

**F-08 🟡 Domain rules and wording sit in two large components (Law 10.2 and §2).**
_Confirmed; sampled, so these examples are a minimum._ `staff-dashboard.ts` has
6,672 lines and `staff-visit-editor.ts` has 7,810 lines, with 102 `computed()`
and 59 `translate(` lines between them. Examples:

- Ordering rules: `staff-dashboard.ts:1630` (upcoming before past), `:2776`
  (visits before gaps), `:5668-5677` (filter and sort "past").
- Qualifying rules: `:2741-2746`, and `:~2672` picks the next visit.
- A threshold: `staff-visit-editor.ts:2602,2611` (`shift.startMinute - 60`).
- Wording: `staff-dashboard.ts:3803`, `:3211`.

None of this is pure or specced as a system, and no lint rule can see it. This
is where feature work will land next, so it is the largest law risk.

**F-09 🟡 Instants recomputed from the wall clock on the read path (Law 7.3).**
_Confirmed._ `client-card.store.ts:218` calls `ZonedTimeSystem.toUtc` and falls
back to `startOfLocalDay`; `medal-detail.presenter.ts:211` falls back to
`visit.utcEpochMs`; `achievements.presenter.ts:470` falls back to `null`. Law 7.3
says an instant is computed once at ingestion. One DST-gap time gets three
answers here. Whether this diverges from the server projection was not checked.

**F-10 🟡 Inbound mapping before system calls (Law 3).** _Confirmed; low runtime
cost._ `staff-time-grid.ts:1011-1012` and `:2504` map events before calling
`GridLayoutSystem`, because the UI struct uses `startMinute` where the system
uses `startMinutes`. The root cause is the differing field name and coordinate.

**F-11 🟢 Smaller items.** Judgement calls unless stated:

- Next-state assembly duplicated in `edit-appointment.pipeline.ts:1001-1012` and
  `reschedule-appointment.pipeline.ts:725-735`, while
  `appointment-lifecycle.system.ts:243` keeps similar work in a system.
- Light presenter decisions: `achievements.presenter.ts:1071-1081`,
  `records.presenter.ts:341,355`.
- Domain rule in an adapter: `coupons-vouchers.adapter.ts:116`.
- Confirmed: `user.entity.ts:91` has logic in an entity file, and
  `staff-day.store.ts:1337` hard-codes the `'bg'` locale in an ordering.
- 72 of 322 `*.data.ts` files export more than one root name (regex count). Most
  are a dictionary plus a union, which Law 1's own dictionary rule invites. The
  law's wording needs a ruling more than the code needs a fix.

### 5.4 Firestore cost

**Reads and writes per action.** _Counts confirmed from source, scale estimated._
S services, B barbers, L shops, K barbers on a booking, V live visits on that
barber-day, H a client's total visits.

| Action                            | Reads                                    | Writes | At planning scale  |
| --------------------------------- | ---------------------------------------- | ------ | ------------------ |
| Open `/book` to the calendar      | S+B+L + 1 + 2–3, then 3B for exact days  | 0      | about 76           |
| Pick a day                        | up to 3B for new targets                 | 0      | up to 30           |
| Book, one seat, with all triggers | 9 + (1+V) + (L+5) + 3 + (H+3)            | 7–9    | 43 reads, 7 writes |
| Staff grid, day view              | S+B+L+C+E + 3B + max(ΣV, B)              | 0      | about 140          |
| Staff grid, week view             | adds B + 14B + max(ΣV, 7B)               | 0      | about 300          |
| Staff search pool                 | up to 600, per dashboard mount when used | 0      | 600                |
| Client card opened                | about 120 plus catalog                   | 0      | about 160          |
| Admin rhythm preview              | up to 1,005 per visit                    | 0      | up to 1,005        |

**Daily total (order of magnitude, estimated):** about 150,000 reads and 1,000
writes, most of the reads from `/book` visitors. After the free allowance that is
about 100,000 billed reads, or $0.03–0.06 a day, about $1-2 a month. At ten times this
scale it is about $13-26 a month by the same estimate. These prices are from memory.

**Rough bill by service (estimated):** Firestore as above. Hosting about $33 a month
if 1,000 landing visits a day each pull both videos (7.6 MB), which is what F-18 is
for. Functions and Storage inside their free allowances at this scale, though free
Storage allowances do not apply in an EU region.

**Already good.** _Confirmed._ No security rule reads a document except one
`exists()` (claims carry roles). 24 composites all map to a query, and none was
found missing by tracing. 120 `fieldOverrides`. No offset pagination. Seven TTL
policies. No trigger loops. The 14 audit handlers read nothing.

**F-12 🟡 Staff search reads 600 full appointments.** _Confirmed._
`staff-day.store.ts:131` sets `SEARCH_WINDOW_PER_SIDE = 300`, read with `getDocs`.
The local cache does not help a `getDocs`. At three mounts per staff member per
day this one path costs 18,000 reads a day, more than a third of the free
allowance (estimated). It is the biggest avoidable read in normal use.

**F-13 🟡 `rebuildBusy` runs on every appointment write.** _Confirmed._
`BusySystem.affectedKeys` (`busy.system.ts:179`) has no change test, so an arrival,
tip or contact edit costs 1+ΣV reads and K billed writes for an unchanged result.
A visit save writes the appointment twice and pays twice. The event payload holds
what the check needs, as `dispatchSubjects` already does for stats.

**F-14 🟡 `capacity/{YYYY-MM}` is one shared document.** _Confirmed; size
estimated._ Every open schedule step re-reads the whole document on each write
anywhere in the deployment (about 130 KB at 30 barbers, estimated). A K-seat party
fires K contending transactions on it (`rebuild-capacity.pipeline.ts:194-202`), and
the nightly sweep writes 4 months per barber even when nothing changed.

**F-15 🟢 `matchWaitlist` reads before it can skip.** _Confirmed._
`match-waitlist.pipeline.ts:427-442` reads zone and policy first, about 3 reads on
every busy write, including TTL purges. Reading the waitlist first gets this to 1
when nobody is waiting.

**F-16 🟢 Rhythm preview reads up to 1,005 documents per admin page visit.**
_Confirmed._ It is admin-only and rare, so no fix now.

### 5.5 Storage and Hosting

**F-17 🟡 The service worker downloads the whole app on a first visit.**
_Confirmed; sizes measured._ `ngsw-config.json:7-16` prefetches `/*.js`: 75 chunks,
1.29 MB compressed, including MapLibre and the staff dashboard, for every
anonymous visitor. This wastes mobile data and uses up Hosting's 360 MB daily free
transfer in under 280 first visits, before any video.

**F-18 🟡 Two videos are large.** _Measured._ `apps/web/public/hero.mp4` is 3.2 MB
and `welcome.mp4` is 4.4 MB. The landing hero plays `hero.mp4` with `preload="auto"`
(`ambient-video.ts`, confirmed). The review traced `welcome.mp4` to the hiring section too.

**F-19 🟡 Images are stored and served larger than needed.** _Confirmed._
`downscaleImage` is used only in `staff-day.store.ts`, so avatars upload at their
original size (up to 5 MiB) and render as small discs. No upload sets
`cacheControl` (`avatar.adapter.ts:33`, `appointment-photos.adapter.ts:223`), and
grids download the 1600 px file. On the Firebase page, free Storage allowances for
`*.firebasestorage.app` buckets apply only to `us-central1`, `us-west1` and
`us-east1`, so an EU bucket pays from the first byte.

**F-20 🟢 Orphaned Storage objects.** _Confirmed._ A failed save after upload, or a
failed object delete, leaves a file. No sweep or lifecycle rule exists. The amounts
are small unless failures are common.

### 5.6 Functions and bill risk

Load: 50 functions (23 callable, 24 Firestore, 3 scheduled). _Measured on the dev
Mac:_ 1,429 modules at about 255 ms on a warm disk, 112 MB RSS. On Cloud Run that
is an estimated 0.5–1 s of module load, plus platform start.

**F-05 🔴 (Gate B) 49 of 50 functions have no instance cap, and the region is not
set.** _Confirmed._ No `setGlobalOptions` exists. The platform default is 100
instances per function (from firebase-tools source), and the default region is
`us-central1`, which adds an estimated 130 ms round trip from Bulgaria. A flood's
theoretical ceiling is about $4,900 a day across the callables, though project
quotas may be lower (estimated). A cap of 10 is no brake on its own: ten instances
at the default concurrency of 80 handle far more than a 1,000-request-a-second
flood. What the cap limits is the worst case. At that rate the OTP path alone would
write about 172.8 million documents a day, or $155-311 at the prices above, which is
why Gate B throttles it. Hosting and anonymous Firestore reads (12 `allow read: if
true` blocks) sit outside any function cap. `docs/production-deploy.md` lists this
as **decide**.

**F-06 🔴 (Gate B) Nothing limits or even reports a flood's spend.** _Confirmed._ `production-deploy.md:444`
describes an alert only, with no amount, and alert policies have no channel until
someone attaches one by hand. A weekend flood runs until someone reads an email.
The checklist also has no `functions:artifacts:setpolicy` step for the images of
50 functions.

**F-21 🔴 (Gate B) The OTP callable has too few limits for a real sender.**
_Confirmed for the code._ `request-otp.pipeline.ts` limits one challenge per
destination per 60 s, with no daily or global cap. Nothing can be sent today:
`main.ts` constructs a refusing sender outside the emulator and preflight P8 refuses
the deploy. The deployment uses `EmailOtp`, so the threat at launch is email: provider
cost, mail-bombing strangers, and sender-domain reputation. **The first draft's
"86,400 SMS a day" scenario is not reachable** without adopting `PhoneOtp` as well.
Security hardening Phase 4 added App Check behind an OFF / MONITOR / ENFORCE switch,
and its rollout is an owner checklist at the end of `HANDOFF.md` §3.3.

**F-22 🟡 (Gate B) Anonymous callers can write permanent rows.** _Confirmed._ Each
new destination commits an `otps` document and an `auditLog` row, even under the
refusing sender, and `auditLog` has no TTL. At 100 requests a second that is 8.6
million permanent rows a day (estimated). The limit must refuse before the commit.

**F-23 🟢 The client issue sink's worst case.** _Estimated._ At its cap it writes
about 14 GiB of logs a day, $5–12. It is capped already, so this is only a note.

### 5.7 Client CPU and memory

**Already good.** _Measured for the maths, confirmed for the rest._ Zoneless, with
all 153 components effectively OnPush. All routes lazy; MapLibre, Firestore and
Storage load on demand. Grid layout for 10 chairs and 60 visits takes 8–13 µs.
Zoned time is cached (3–9 µs). Ranking 300 clients takes 0.15 ms per keystroke.
The `ui-menu` rAF loop stops on close. The initial bundle is 589 kB raw, 160 kB
estimated transfer, against a 1 MB limit (`build web` output).

**F-24 🟡 Route chunks have no budget, and one chunk loads everywhere.** _Measured
by walking static imports in `dist`._

| Route             | JS compressed | JS raw  |
| ----------------- | ------------- | ------- |
| `/`               | 363 KB        | 1.25 MB |
| `/book`           | 609 KB        | 2.13 MB |
| `/staff/schedule` | 679 KB        | 2.48 MB |

At about 1 ms per raw KB on a mid-range phone, that is 1.2–2 s of main-thread
script (estimated). The landing page's own chunk is 13 KB compressed, but it pulls
a shared 130 KB chunk of 71 design-system components, including gsap, the code
scanner, the camera and the medals. `libphonenumber` (39 KB compressed) is in the
static closure of five areas despite the lazy phone field.

**F-25 🟡 Staff listeners are rebuilt on every day tap.** _Confirmed in source; cost
estimated, needs a trace._ At 10 chairs, the day view holds 40 listeners and the
week view 220, because `_scope` starts as `null` (`staff-day.store.ts:940`) and
the comment's "default to one chair" is not enforced. `switchMap` unsubscribes
before resubscribing, so Firestore cannot reuse identical targets, and schedules
are rewired although a day change does not touch them. Estimated at hundreds of
milliseconds of async work per tap on a phone. Billed reads on rewiring were not
separated from cache hits.

**F-26 🟡 Agenda search can render 600 rows on one keystroke.** _Confirmed; render
cost estimated._ `staff-dashboard.html:355` has no debounce and `:375` no cap, with
a two-character minimum, so «по» matches «Подстригване» on most visits. The
calculation takes about 3 ms on a phone; the DOM takes an estimated 150–400 ms.
No virtualization or `content-visibility` exists anywhere.

**F-27 🟢 Small items.** A drag step refreshes the whole grid, 5–10 ms on a phone
(estimated), fits in a frame. `findService` is a linear scan per seat per keystroke.
`bg.json` is one file of 28 KB compressed for all routes.

**F-28 🟡 The feature layer is not data-oriented.** _Confirmed by sampling._ The
dashboard uses `flatMap`/`filter`/spread chains and `{...event}` per event inside
`computed()`. At today's sizes this is not measured as a user-visible problem. The
V8 monomorphism goal is unproven: `{id, ...snap.data()}` takes field order from
the store, and flat variant unions produce several object shapes by design.

### 5.8 Documentation drift

**F-29 🟢** `production-deploy.md:447,967` cites `main.ts:1120-1127` for
`reportClientIssues`, which now sits at about `main.ts:1230`. The comment at
`availability.system.ts:851` is false (F-01).

## 6. The checks

A check must be deterministic, cheap and able to fail a build, so these count bytes,
lines, nodes and call sites, never wall-clock time. They run in CI, and the ruleset on
`main` makes that binding.

| Check                                           | Where                                       | Limit                        | State   |
| ----------------------------------------------- | ------------------------------------------- | ---------------------------- | ------- |
| Availability recall and search effort           | `availability.system.spec.ts`               | Pinned starts, node ceilings | On main |
| Every project linted                            | `static` job, pinned by `ci-workflow.spec`  | Not affected-only            | PR #8   |
| Initial bundle                                  | `apps/web/project.json`                     | Warn 650 kB, fail 750 kB     | PR #10  |
| Raw bytes to open a route, with a default       | `tools/verify/bundle/budgets.json`          | 1.55 MB; named routes above  | PR #10  |
| Largest public asset                            | same                                        | 4.5 MB                       | PR #10  |
| Size of the two largest staff files             | `max-lines` in the root ESLint config       | Their current length         | PR #10  |
| A query with no limit                           | `creativo/query-needs-limit`                | A limit, or a stated reason  | PR #11  |
| System purity, including lazy imports           | `ecs-syntax`, `libs/ecs-core` ESLint config | Fails lint                   | PR #12  |
| Files in `src/systems` are `*.system.ts`        | `verify-tools:layering` (f)                 | Fails the verifier           | PR #12  |
| Hyphenated wording helpers are pure             | `creativo/presenter-purity`                 | Fails lint                   | PR #12  |
| Every function has a region and an instance cap | `main.spec.ts`                              | Non-null                     | Gate B  |

**Stay review rules on purpose,** because no reliable check exists or they have no
use today: Law 4 and Law 10.2 "decides nothing", placement math on UTC, allocation in
hot loops, new realtime listeners (4 sites already make 40-220 live listeners, so a
static count sees nothing), bare discriminator literals, dot-path keys, `Record`
fields, named nested types, port types declared in a pipeline. A query's stated
reason is also a review promise: nothing notices when it stops being true.

**Dropped from the first draft:** a Law 11 (it promised more than any check delivers),
read-count specs per pipeline (they break on every legitimate extra read, for cents),
a functions load-weight verifier (the saving is under 100 ms and no money).

## 7. Alternatives considered

| #   | Alternative                                                | Decision and reason                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0  | F-01: raise the node budget                                | Rejected. The worst case measured needs 12.7 million nodes even with the new pruning.                                                                                                                                                                                                                                             |
| A0b | F-01: a per-start quota taking the first seating           | Rejected. It keeps every start and gives up the tightest arrangement. The fix adds that step.                                                                                                                                                                                                                                     |
| A0c | F-01: check feasibility, find the tightest on pick         | Rejected. It changes what the grid returns, so every caller and the pinned digests change.                                                                                                                                                                                                                                        |
| A1  | Protect `main`: pull requests with required checks         | **Done, owner ruling 2026-11-02.** No bypass, no approvals, all seven jobs. A bypass would keep the hole.                                                                                                                                                                                                                         |
| A2  | Timed benchmarks in CI                                     | Rejected. Runner noise makes them flaky, and flaky gates get disabled. Operation counts answer the same question for the one search that matters.                                                                                                                                                                                 |
| A3  | A lint rule against allocation in hot loops                | Rejected. 212 candidate sites in 46 system files, and most are harmless at their real sizes.                                                                                                                                                                                                                                      |
| A4  | Bundled functions, lazy per-function loading, or codebases | Rejected. Saves an estimated 50–100 ms and no meaningful money, and Law 8's ban on deep subpaths means the barrel still loads.                                                                                                                                                                                                    |
| A5  | `minInstances: 1` on booking callables                     | Deferred. About $8 a month per function (estimated), for latency only. Decide with a real cold-start measurement.                                                                                                                                                                                                                 |
| A6  | Rewrite the staff components before feature work           | Rejected. 14,000 lines, a large regression risk. Instead `max-lines` stops them growing, and rules move out as features touch them.                                                                                                                                                                                               |
| A7  | Shard `capacity` by shop                                   | Rejected. Entries span shops. A one-shot calendar read removes the re-fire cost without a schema change.                                                                                                                                                                                                                          |
| A8  | Automatic billing cut-off                                  | Rejected at this size. It also takes the site down, and the budget, caps and a runbook step cover the realistic case.                                                                                                                                                                                                             |
| A9  | App Check on all callables now                             | Out of this audit: Phase 4 built the switch, and its rollout is an owner checklist in `HANDOFF.md` §3.3.                                                                                                                                                                                                                          |
| A11 | Firestore location                                         | Owner's, and irreversible. `nam5` or `us-central1` needs no code change, and gets free Storage allowances. An EU location gets an estimated 130 ms less latency from Bulgaria and may matter for data residency, but it means one change across every export, the web client, the CSP and the verifiers (`production-deploy.md`). |
| A10 | `maxInstances` per function, tuned                         | Rejected for now. One global value of 10 is one line and enough at this size. Raise per function when data shows a need.                                                                                                                                                                                                          |

## 8. Savings not worth taking

**Incremental client stats.** `project-client-stats.pipeline.ts:123-135` reads a
client's whole history on each relevant write, with no limit, and one audit ranked it
the top avoidable cost. This document disagrees. A regular client over five years has
about 120 visits, so 120 reads per write costs a tiny fraction of a cent. In exchange,
the current design repairs itself from source data, which an incremental one would give
up. **Keep it.** The real risk is a very long read set inside one transaction, and that
risk arrives only at several hundred visits per person. Revisit if a client's history
passes 300. The counterargument is that a data bug or a shared walk-in record could
create a very large H, and nothing watches for that yet.

**F-13: skip `rebuildBusy` on non-geometry writes.** Worth under a cent a day, and it
would remove the only self-repair of data the booking conflict check reads. No busy
backfill exists to replace it, so real billing data should not revive this.

**V8 monomorphism.** The claim stays unproven, because no benchmark exists and none
is planned: timed checks flake, and the one search that needed it now has node
ceilings. Revisit if a real trace shows a problem.

**Also leave alone:** trigger filtering, log trimming,
converting scheduled jobs (all three run daily), and removing `rxjs` from the
functions bundle (22 ms, kept by ruling).

## 9. What this audit did not cover

- No real phone, browser trace or production billing. Rendering, Firestore-listener
  and cold-start figures are estimates.
- `libs/ui` internals, Angular templates, 82 `effect()` calls (sampled), the visit
  editor's `computed` chains and 19 template method calls.
- About 74 of 99 systems and 41 of 49 pipelines were swept by pattern rather than read.
- Type findings come from regex, not the TypeScript checker.
- Firestore's behaviour on a no-change `Set` (billed, and no event fired) comes from
  documentation, not a test. F-13's "billed" claim depends on it.
- The trigger retry window (the code assumes 24 hours).
- Storage security rules, rules-based read abuse, media-upload abuse and the costs of
  the optional audit-log and backup scripts.
- Tests, typecheck and the emulator journeys were not re-run for this audit.

## 10. Risks of this plan

| Risk                                                       | Mitigation                                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A query's stated reason stops being true                   | Accepted: review only. It is one comment on the query's own line, which is where a reader looks.                                             |
| Budgets breed noise and get raised by habit                | Few budgets, near today's values, and a rise must be explained in its commit. Measured in bytes and counts, so no flakes.                    |
| The required jobs flake or slow every merge                | A flaky job blocks until it is re-run, and the `main` job can take up to 75 minutes. Watch this; the ruling can be narrowed.                 |
| A global function cap refuses real users, or lags triggers | It binds the 24 Firestore triggers too, so projections can lag under load. Accepted at this size. Raise it per function with evidence.       |
| A global OTP throttle lets a flood lock out real logins    | Accepted at this size: refusal costs less than the flood. The provider's own quota is the real cap on spend.                                 |
| Moving rules out of the staff components changes screens   | Move with specs first. The earlier passes' DOM-differential method applies. Each move lands alone.                                           |
| Estimates in this document are wrong                       | Estimates are labelled where they lead a finding, though not every figure in the prose is. The first deploy gives real numbers: revise then. |

## 11. Detailed Implementation Plan

Gate A holds what lets bad code merge, gets worse as features land, or is a booking
defect. Gate B holds what can cost money or harm users at launch. The rest waits for
evidence. Everything in Gate B needs its own plan before it starts, because the review
found the first draft of these steps not ready to implement.

### Gate A: before feature work

Merged: PRs #8 to #14, and F-08's wording in its own PR. Nothing else is left.

### Gate B: before the first production deploy

1. **Owner decides the Firestore location** (A11). If EU, make the one change
   `production-deploy.md` describes.
2. **`setGlobalOptions({ region, maxInstances: 10 })`** in `apps/functions/src/main.ts`,
   before the definitions, and require both values in `main.spec.ts`. Set `reportClientIssues`'s
   own cap aside as it is.
3. **A real email sender with its limits, as one change.** The existing
   `throttledCallable` with a low `maxInstances`, so a flood is refused before any read or
   write. A per-destination daily cap in `OtpSystem`, through the existing `loadOpenOtps`
   read. The provider's daily quota, which is what actually caps the spend. Gate B's check
   is that preflight P8 passes. `PhoneOtp` would need a country allowlist and provider geo
   limits as well.
4. **`docs/production-deploy.md`:** a budget amount with 50/90/100% alerts and an attached
   channel; `functions:artifacts:setpolicy`; a flood step covering functions and Hosting;
   the stale citations of F-29.
5. **What visitors download:**
   - F-17: the service worker prefetches only what the first page needs. Hashed chunk names
     may not separate by glob, so this needs a look at the build first.
   - F-18: recompress both videos and lower `publicAssetBytes`.
   - F-19: pass avatars through `downscaleImage`, and set `cacheControl`. Avatars overwrite
     one fixed path, so a long lifetime could show a stale image.
   - F-24: make `gsap` a dynamic import, then lower the route ceilings to the result.
   - F-26: debounce the agenda search (`CLIENT_SEARCH_DEBOUNCE_MS` exists) and cap its rows.
6. **After the deploy:** one browser trace of the staff grid on a mid-range phone, real cold
   starts, the first week's bill. Then revisit the next list.

### Waits for evidence

- **F-12, F-14, F-15, F-16, F-25:** Firestore and listener costs, worth cents today. Act on
  real billing or trace data. F-25 also found that the week view does not default to one
  chair, although `staff-day.store.ts` says it does.

### Backlog, as files are touched

- **F-10, F-11:** the mapping in the time grid, and the smaller items.
- **F-20:** a Storage lifecycle rule or orphan sweep, if failures turn out to be common.

### No action

F-23 (capped already), F-27 (none is noticeable), F-28 (section 8).

### Owner decisions left

1. The Firestore location (A11).
2. The monthly budget amount, and how much loss a flood may cost before someone acts.
3. The App Check rollout, the OTP provider, and the other owner items in `HANDOFF.md` §3.3.

## 12. Appendix: law sweep counts

Production `.ts`, specs excluded. Regex-based unless stated.

| Pattern                                       | Result                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `class` in ecs-core and functions             | 0                                                                       |
| `Object.freeze`, getters                      | 0 in ecs-core, infrastructure and functions                             |
| `new Date`, `Date.now`, `Math.random`         | ecs-core 0; 4 elsewhere (clock adapters, emulator token, retry jitter)  |
| Date classes                                  | 0 live                                                                  |
| `as XId`, `as LocalDate` outside primitives   | 61; about 30 sampled, indexed-access narrowing                          |
| Brand casts in features, infra, functions     | 0                                                                       |
| Bare discriminator literals                   | 6; DOM `tagName` and a test fake only                                   |
| Generic `type`/`kind`/`status` on domain data | 0                                                                       |
| Namespace re-aliases                          | 0 in 322 data files                                                     |
| Nested 1-to-1 on entities                     | Only `LocalizedText`, which `firestore-layout.md` allows as a fixed map |
| Dot-path writes                               | 0                                                                       |
| Mappers                                       | 0                                                                       |
| `Record<Id, …>` in documents                  | 0                                                                       |
| Array fields lacking `fieldOverrides`         | 3, all query keys                                                       |
| Time zone on temporal entities                | Only `shop-location`                                                    |
| UTC in placement math                         | None found                                                              |
| Expected-path `throw` in ecs-core             | 2 backfill rethrows, documented                                         |
| `CustomerId`/`UserId` crossing                | 0                                                                       |
| Law-rule `eslint-disable` lines               | 3 of 124                                                                |
