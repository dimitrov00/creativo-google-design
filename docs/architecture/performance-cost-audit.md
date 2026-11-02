# Performance and cost audit, and the enforcement design

Audited at commit `86870b9d` on 2026-11-02; no code changed. **Review concluded the same day: the plan is
not ready to implement and known errors remain in this text. Read `docs/architecture/review/` before acting. F-01 is since fixed. Security hardening Phase 4 (PR #6) landed on `main` while this was written and this text does not reflect it: App Check now exists behind an OFF / MONITOR / ENFORCE switch, so re-check F-21 and A9 against it.**

## 1. Summary

The laws hold up well in the ECS core and poorly in the two largest staff
components. Steady-state cost is low at the expected scale. The serious
problems are of a different kind from the ones the question assumed:

1. **A booking defect.** The availability search runs out of its node budget
   for parties of three or more service lines, and the app silently shows too
   few times. Two people with two services each see one start time on a
   half-empty day (F-01).
2. **Nothing blocks a bad merge.** `main` has no protection, and CI lints only
   affected projects. Editing a lint rule does not re-lint `ecs-core` or
   `functions` (F-02, F-03).
3. **Performance and cost have almost no gates.** The shape laws are linted;
   performance is not. A future feature can add an unbounded query, a new
   listener or a heavy import and every check stays green (F-04).
4. **The bill risk is abuse, not traffic.** 49 of 50 functions have no instance
   cap, no budget amount is set, and the OTP callable will need limits it does
   not have before a real SMS sender can go live (F-05, F-06).

"No gaps left" cannot be claimed from this audit. Section 9 lists what was not
examined. What this document can do is define budgets, so that a gap becomes a
red check instead of something a later audit has to find.

**Recommendation.** Do the Gate A work (section 11) before feature development.
Do the Gate B work before the first production deploy. Leave alone the items in
section 8, which look like savings and are not.

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

- State whether the code follows the ten laws, including what lint cannot see.
- State what the system costs per user action in Firestore, Functions, Storage
  and Hosting, and in client CPU and memory.
- Rank what to fix before feature work and what to fix before the first deploy.
- Define budgets and automated checks that stop regressions.

**Non-goals**

- Optimising for traffic the product does not have. The planning scale is
  below (section 4).
- Rewriting the staff components in one pass.
- Reopening decisions D1–D29 or the owner rulings OR-1 to OR-59, except where a
  finding is flagged as needing a new ruling.
- Reviewing visual design, `libs/ui` internals or security beyond cost abuse.

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

**Planning scale (assumption):** 2 shops, 10 barbers, 30 services, 300 bookings
a day, 1,000 `/book` visitors a day, 10 staff. The app has never been deployed,
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

**F-01 🔴 The availability search loses most of the day for larger parties.**
_Measured, reproduced twice._

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
be booked today. Cost on the CPU is small: about 9 ms on the dev Mac, about 45 ms
on a phone (estimated), running in `computed()`. The harm is lost bookings, not
slowness. The real shop's barber preferences would narrow the search, and that
case was not measured.

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

**Daily total (estimated):** about 150,000 reads and 3,000 writes. After the free
allowance that is about 100,000 billed reads, or $0.03–0.06 a day. Firestore cost
is not a problem at this scale, and at ten times this scale it is still only a
few dollars a month by the same estimate.

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
_Confirmed._ It is admin-only and rare, so no fix now. It belongs in the journey
budget so that it cannot grow.

### 5.5 Storage and Hosting

**F-17 🟡 The service worker downloads the whole app on a first visit.**
_Confirmed; sizes measured._ `ngsw-config.json:7-16` prefetches `/*.js`: 75 chunks,
1.29 MB compressed, including MapLibre and the staff dashboard, for every
anonymous visitor. This wastes mobile data and uses up Hosting's 360 MB daily free
transfer in under 280 first visits, before any video.

**F-18 🟡 Two videos are large.** _Measured._ `apps/web/public/hero.mp4` is 3.2 MB
and `welcome.mp4` is 4.4 MB. Whether they load on the landing page by default
was not checked.

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
quotas may be lower; a realistic 1,000 requests a second is about $80–100 a day
(both estimated). `docs/production-deploy.md:967` lists this as **decide**.

**F-06 🔴 (Gate B) No spending brake.** _Confirmed._ `production-deploy.md:444`
describes an alert only, with no amount, and alert policies have no channel until
someone attaches one by hand. A weekend flood runs until someone reads an email.
The checklist also has no `functions:artifacts:setpolicy` step for the images of
50 functions.

**F-21 🔴 (Gate B) The OTP callable is ready for abuse once a sender lands.**
_Confirmed for the code; dollars estimated._ `request-otp.pipeline.ts:152` limits
one challenge per destination per 60 s, with no IP, daily, global or country limit.
At 1 request a second to random international numbers that is 86,400 SMS a day,
about $4,000–9,000. It cannot be billed today, because `main.ts:347` constructs a
refusing sender outside the emulator and preflight P8 refuses the deploy. The
sender item in `production-deploy.md` does not list these limits as conditions.

**F-22 🟡 (Gate B) Anonymous callers can write permanent rows.** _Confirmed._ Each
new destination commits an `otps` document and an `auditLog` row, even under the
refusing sender, and `auditLog` has no TTL. At 100 requests a second that is 8.6
million permanent rows a day (estimated). The limiter must sit before the commit.

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

## 6. The design: budgets, checks and one new law

The design rule is that a budget must be **deterministic, cheap and able to fail a
build**. Wall-clock timing fails the first test, so the design counts operations,
bytes, modules and call sites instead.

### 6.1 The budgets

Numbers start at today's measured value plus a small margin, then only go down.

| Budget                                       | Starting limit               | Today                 | Mechanism                |
| -------------------------------------------- | ---------------------------- | --------------------- | ------------------------ |
| Initial JS + CSS, raw                        | warn 650 kB, error 750 kB    | 589 kB                | `apps/web/project.json`  |
| Route closure, compressed: `/`               | 400 KB, then 250 KB (WS-4)   | 363 KB                | new verifier             |
| Route closure, compressed: `/book`           | 650 KB, then 500 KB (WS-4)   | 609 KB                | new verifier             |
| Route closure, compressed: `/staff/schedule` | 720 KB                       | 679 KB                | new verifier             |
| Functions load: modules and bytes            | baseline + 10%               | 1,429 modules         | new verifier             |
| Realtime listener sites                      | allowlist, 2 files           | 4 sites in 2 files    | new ratchet              |
| `get`/`exists` in rules                      | 1                            | 1                     | new ratchet              |
| Query without limit                          | needs `// unbounded-ok: why` | 19 to triage          | new lint rule            |
| Reads and writes per server pipeline         | pinned per pipeline          | section 5.4           | spec with counting ports |
| Availability nodes per query                 | see WS-1                     | 200,000 and exhausted | spec on `nodesVisited`   |
| Endpoint region and `maxInstances`           | required, non-null           | 1 of 50               | `main.spec.ts`           |
| `new Intl.*`                                 | module scope or cached files | 5 sites               | new lint rule            |

The availability budget works because `nodesVisited` is already a pure output, so
a spec can test search effort with no clock.

### 6.2 A new law, for the owner to rule

Laws are added by the owner, so `CLAUDE.md` and its mirror `AGENTS.md` are not
changed by this document. Proposed text:

> **Law 11 — Performance and cost are budgets, enforced.** Every cost that can grow
> without a code review noticing has a number in the repository and a check that
> fails the build: bundle bytes per route, function load weight, realtime listeners,
> unbounded queries, rule-time reads, reads and writes per pipeline, and search effort.
> Checks count operations, bytes and call sites; never wall-clock time. A budget rises
> only in the commit that explains why.

### 6.3 Reads per journey

Server pipelines can be pinned exactly: port doubles in `@core/testing` count their
calls, so a spec can assert "`commitBooking` with K=1 reads 8+S". Browser journeys
open many streams and are not pinned this way. This document's table in section 5.4
serves as their reference until real billing data exists.

## 7. Alternatives considered

| #   | Alternative                                                | Decision and reason                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Protect `main`: pull requests with required checks         | **Recommended, needs an owner ruling.** It ends direct commits to `main`, a practice recorded on 2026-10-10. Recent work already went through PR #5. The weaker option is a required-checks ruleset with owner bypass, which keeps the habit and also keeps the hole. |
| A2  | Timed benchmarks in CI                                     | Rejected. Runner noise makes them flaky, and flaky gates get disabled. Operation counts answer the same question for the one search that matters.                                                                                                                     |
| A3  | A lint rule against allocation in hot loops                | Rejected. 212 candidate sites in 46 system files, and most are harmless at their real sizes.                                                                                                                                                                          |
| A4  | Bundled functions, lazy per-function loading, or codebases | Rejected. Saves an estimated 50–100 ms and no meaningful money, and Law 8's ban on deep subpaths means the barrel still loads.                                                                                                                                        |
| A5  | `minInstances: 1` on booking callables                     | Deferred. About $8 a month per function (estimated), for latency only. Decide with a real cold-start measurement.                                                                                                                                                     |
| A6  | Rewrite the staff components before feature work           | Rejected. 14,000 lines, a large regression risk. Instead: extract the listed rules, plus a ratchet so these files cannot grow.                                                                                                                                        |
| A7  | Shard `capacity` by shop                                   | Rejected. Entries span shops. A one-shot calendar read removes the re-fire cost without a schema change.                                                                                                                                                              |
| A8  | Automatic billing cut-off                                  | Rejected at this size. It also takes the site down, and the budget, caps and a runbook step cover the realistic case.                                                                                                                                                 |
| A9  | App Check on all callables now                             | Deferred as ruled (Deferred #4), except the OTP callable, which needs it before a real sender lands.                                                                                                                                                                  |
| A10 | `maxInstances` per function, tuned                         | Rejected for now. One global value of 10 is one line and enough at this size. Raise per function when data shows a need.                                                                                                                                              |

## 8. Things that look like savings and are not

**Incremental client stats.** `project-client-stats.pipeline.ts:123-135` reads a
client's whole history on each relevant write, with no limit, and one audit ranked it
the top avoidable cost. This document disagrees. A regular client over five years has
about 120 visits, so 120 reads per write costs a tiny fraction of a cent. In exchange,
the current design repairs itself from source data, which an incremental one would give
up. **Keep it.** The real risk is a very long read set inside one transaction, and that
risk arrives only at several hundred visits per person. Revisit if a client's history
passes 300. The counterargument is that a data bug or a shared walk-in record could
create a very large H. The check for this is a test or log for H over 300 (WS-3).

**Also leave alone:** trigger filtering beyond F-13 and F-15, log trimming,
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

| Risk                                                     | Mitigation                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The F-01 fix changes which arrangement a time offers     | Keep the "tightest arrangement" rule; every existing `availability.system.spec.ts` case must pass unchanged. Add recall specs from the table in F-01. Recheck that the server's commit path accepts every newly offered start. |
| A required-checks ruleset slows work, or CI flakes       | The record lists a load flake in e2e. Start by requiring `main`, `static` and `runbook-gates`, and add `emulators` and `e2e` after a week without flakes.                                                                      |
| Budgets breed noise and get raised by habit              | Few budgets, starting near today's values, and a rise must be explained in its commit. Measured in bytes and counts, so no flakes.                                                                                             |
| `query-needs-limit` adds comments nobody reads           | `// unbounded-ok:` needs a reason, and bounded-by-construction cases (an `in` batch) are recognised by the rule rather than commented.                                                                                         |
| `maxInstances: 10` refuses real users during a spike     | Accepted at this size: refusal is cheaper than the alternative. Alert on refused requests, and raise per function with evidence.                                                                                               |
| Moving rules out of the staff components changes screens | Move with specs first. The earlier passes' DOM-differential method applies. Each move lands alone.                                                                                                                             |
| Estimates in this document are wrong                     | Every estimate is labelled. WS-6 includes one real trace and the first week's billing; revise the budgets then.                                                                                                                |

## 11. Detailed Implementation Plan

Each work stream ends at a green gate (`CLAUDE.md` §5) and lands alone. **Gate A**
(WS-1 to WS-5) comes before feature development. **Gate B** (WS-6) comes before the
first production deploy. "Create" and "Modify" mark each file; the paths under Create
do not exist yet.

### WS-1 Availability recall (F-01) — Gate A

1. **Modify** `libs/ecs-core/src/systems/availability.system.ts`: for `availableStarts`,
   search per candidate party start with a small node quota, rather than a single
   depth-first walk over the day. Keep `search` for the non-deduplicated path. Keep the
   "tightest arrangement per start" rule and rule 3's order. Correct the comment at
   `:851`. An earlier prototype of this approach found all but at most one start in
   57–150 nodes; it took the first leaf, so it does not yet keep the tightest rule, and
   the author of this document has not re-run it. Treat those numbers as a target.
2. **Modify** `libs/ecs-core/src/systems/booking-cart.system.ts:638-655`: stop dropping
   `exhausted`, and carry it in the merged answer.
3. **Modify** the two callers, `booking-time-sheet.ts:265` and
   `booking-schedule-step.ts:673`: when the answer is incomplete, show a message (bg and
   en copy, added to both catalogues). This should become rare after step 1.
4. **Modify** `libs/ecs-core/src/systems/availability.system.spec.ts`: add recall cases
   from the F-01 table (starts found equals the exhaustive answer) and a `nodesVisited`
   ceiling for up to 5 lines at 10 barbers.

Verify: `pnpm nx test ecs-core`; every existing availability case passes unchanged; the
new cases fail on the current code; a booking journey in `apps/web/e2e` for a party of
four books an afternoon time. Check the server accepts it.

### WS-2 Merge gates (F-02, F-03) — Gate A

1. **Owner ruling first:** alternative A1.
2. **Modify** `.github/workflows/ci.yml`: add `pnpm nx run-many -t lint` to the `static`
   job. Alternatively make every project depend on `lint-rules`; the `run-many` line is
   simpler and costs CI time only.
3. **Apply** the GitHub ruleset on `main`: this acts on the repository's settings, so it
   runs only after the ruling. Start with `main`, `static`, `runbook-gates` as required.
4. **Modify** lint config: set `maxWarnings: 0` for `@typescript-eslint/no-non-null-assertion`
   only after the 71 current warnings are triaged. Do not apply this to the `security/*`
   rules; 127 `detect-object-injection` hits are mostly false positives on array
   indexing, and those rules are noise as configured. Rule on them separately.

Verify: a deliberately violating branch goes red and cannot merge. Delete the branch.

### WS-3 Budgets and checks (F-04, F-07) — Gate A

All lint rules live in `tools/lint-rules/` with a canary test beside them, and each
verifier runs in the CI `static` job. Order by value:

1. **Modify** `apps/functions/src/main.spec.ts`: require non-null `maxInstances` and a
   region on every endpoint. It stays red until WS-6, so land this test with WS-6.
2. **Create** `tools/lint-rules/query-needs-limit.mjs` (+ spec): on `*.adapter.ts` and
   `QuerySpec` builders, each `query()` or admin chain has a `limit` or a
   `// unbounded-ok: <reason>` comment. Triage the 19 candidates, starting with
   `catalog.adapter.ts:33`, `appointments.adapter.ts:272`, `appointment-photos.adapter.ts:112`
   and `firestore-tx.adapter.ts:170`.
3. **Create** `tools/verify/budgets/route-closure.mjs` and `budgets.json`: compressed size
   of each route's static import closure, compared with the limits in section 6.1.
4. **Create** `tools/verify/budgets/functions-load.mjs`: load built `main.js` with a
   `Module._load` hook, then compare module count and bytes with baseline +10%.
5. **Create** `tools/verify/budgets/ratchets.mjs`: `onSnapshot` import sites allowlisted
   to `observe.ts` and `appointment-photos.adapter.ts`; `get`/`exists`/`getAfter`/`existsAfter`
   count in `firestore.rules` (baseline 1).
6. **Create** `tools/lint-rules/intl-cached.mjs` (+ spec): `new Intl.*` only at module
   scope or in the cached formatter files. Fix the 5 sites.
7. **Modify** `tools/lint-rules/ecs-syntax.mjs`: close the holes in F-07: extra system
   globals, `node:*`, lazy package imports, purity guards on non-suffix tier files, L1
   and L3 on pipelines, functions, `libs/shared` and `libs/infrastructure`, sort/reverse/
   splice on system parameters. Fix what they find; read the two `.push` sites first.
8. **Modify** `tools/lint-rules/presenter-purity.mjs`: match `*-words.ts` as well.
9. **Create** read and write count specs for `commit-booking`, `cancel`, `rebuild-busy`,
   `rebuild-capacity`, `match-waitlist` and `project-client-stats`, built on counting
   port doubles (**Modify** `libs/ecs-core/src/testing/port-doubles.ts`).
10. **Modify** `apps/web/project.json`: initial budget to 650/750 kB. Fix the 45-byte
    `gauge.css` warning, then treat that warning as an error.
11. **Create** a line-count ratchet in `tools/verify/budgets/ratchets.mjs` for
    `staff-dashboard.ts` and `staff-visit-editor.ts`: neither may grow.
12. **Add** a warning log when `clientHistory` returns over 300 documents (section 8), in
    `project-client-stats.pipeline.ts` through the existing `LogEvent` port.

Verify: each rule's spec holds a failing and a passing canary; `pnpm nx run-many -t lint`
and `pnpm nx run verify-tools:layering` remain green.

### WS-4 Cheap cost fixes (F-12 to F-15, F-17 to F-19, F-24 to F-26) — Gate A

Each item is small and lands alone, with its own spec or budget:

1. **F-13.** **Modify** `busy.system.ts` and `rebuild-busy.pipeline.ts`: return no keys when
   busy keys, chair times and liveness are unchanged. Make sure drift repair still has a
   path, through the backfill.
2. **F-14.** **Modify** `rebuild-capacity.pipeline.ts:194-202`: skip the write when `entries`
   are unchanged. **Modify** `shop-day.pipeline.ts:90`: read the calendar's month once on
   open, not as a stream. The commit path remains the authority.
3. **F-15.** **Modify** `match-waitlist.pipeline.ts:427-442`: read the waitlist first; read
   zone and policy on a hit. Keep `retireLapsed`, which still needs the zone for past days.
4. **F-12.** **Modify** `staff-day.store.ts:131`: reduce the window to 60 per side and fall
   through to `searchCustomers` for older names. Verify the search still finds an older
   client.
5. **F-26.** **Modify** `staff-dashboard.html:355,375`: debounce, cap at 50 rows with «Покажи
   още». Add `content-visibility: auto` to long lists.
6. **F-25.** **Modify** `staff-day.store.ts:1447-1451`: `distinctUntilChanged` on the lane key;
   per-`BusyKey` shared streams that linger 30 s; schedules in their own stream; default the
   week view to one chair, as the comment there states.
7. **F-17.** **Modify** `apps/web/ngsw-config.json`: prefetch index, main and styles; move the
   other chunks to a lazy group. Check the offline and update behaviours still work.
8. **F-18.** Recompress both videos to under 1 MB, and check their `preload`.
9. **F-19.** **Modify** `profile.store.ts` and `onboarding-flow.store.ts` to pass avatars through
   `downscaleImage(file, 256)`. **Modify** `avatar.adapter.ts:33` and
   `appointment-photos.adapter.ts:223` to set `cacheControl`.
10. **F-24.** Make `gsap` a dynamic import (`confetti.ts:14`), `@defer` the reward moment, move
    rare `ui/patterns` components to secondary entry points, then lower the route budgets to the
    second values in section 6.1.

Verify: the full gate in `CLAUDE.md` §5, `verify:p0`, `test:emulator`, `e2e:web`.

### WS-5 Law fixes (F-08 to F-11, F-29) — Gate A

1. **F-09.** **Modify** the three read sites to use the stored `utcEpochMs`, adding it to
   `VisitFact` if absent. If the stored instant can't reach these screens, a system owns the one
   fallback. Compare with the server's projection in a spec.
2. **F-08.** **Create or extend** systems and presenters for the rules listed in F-08, each with a
   purity and boundary spec, then point the components at them. This is the listed set, not a
   rewrite. Do a full inventory of both files first, because F-08 is a sample.
3. **F-10.** **Modify** `staff-time-grid.ts` so its struct uses the system's field name.
4. **F-11.** Fix the confirmed items (`user.entity.ts:91`, `staff-day.store.ts:1337`). Move the
   duplicated next-state assembly into one system. Rule on the Law 1 "one name" wording with the
   owner.
5. **F-29.** Correct the citations in `production-deploy.md` and the comment.

Verify: the full gate; the DOM differential method from the earlier passes for each component
move.

### WS-6 First-deploy readiness (F-05, F-06, F-20 to F-22) — Gate B

1. **Owner decision, irreversible:** the Firestore location. Recommended: one region in
   Frankfurt (`europe-west3`), with functions and Storage in the same place, for latency from
   Bulgaria and lower per-operation cost than a multi-region. Check the current price list.
2. **Modify** `apps/functions/src/main.ts`: `setGlobalOptions({ region, maxInstances: 10 })`.
   Update the table in `main.spec.ts` and land the WS-3 step 1 test.
3. **Modify** the OTP path (`request-otp.pipeline.ts`, a new limiter port and adapter, `OtpSystem`):
   a country allowlist, a daily cap per destination, an IP bucket and a global daily counter,
   all **before** the commit, so a refused request writes nothing. Add App Check on this callable.
   Add these as conditions of the sender item in `docs/production-deploy.md`.
4. **Owner decision:** whether `IDENTITY_OTP_REQUESTED` rows get a TTL. This would reverse
   P3-RU-6's permanent trail, so the default is no. The limiter makes it less urgent.
5. **Modify** `docs/production-deploy.md`: set a budget amount with 50/90/100% alerts and a channel;
   add `functions:artifacts:setpolicy`; add a runbook step to cap or delete a function during a
   flood; add a Storage lifecycle or orphan sweep decision (F-20).
6. **Add** a per-client open-booking cap in a system, against commit and cancel loops.
7. **After the first deploy:** take one real browser trace of the staff grid on a mid-range phone,
   measure cold starts, read the first week's billing, and update section 6.1 with real numbers.

Verify: `pnpm run preflight` for both scopes; preflight P8 still refuses a deploy until a real
sender is wired.

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
