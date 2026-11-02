# Stage 5: Zoom-out review

Target: `docs/architecture/performance-cost-audit.md`, full file. Reviewer: `egm-zoom-out`, in a fresh context.

**Overall:** the audit passes context sufficiency and its diagnosis is sound, but the plan does not pass on simplicity. There are 0 Blockers, 8 Majors and 5 Nits.

- **Main problem:** the document shows that the real risks are a booking defect, ungated merges and abuse. It then schedules cent-a-day Firestore tuning, a new law and several new verifiers ahead of feature work.
- **Basis:** the reviewer read the target, the persona, the standard, `CLAUDE.md` and the code cited below. It ran nothing; the claims about `availability.system.spec.ts` come from reading it. It did not read the runbook-gates runner.

## Major

**1. Gate A includes premature cost optimisation, by the document's own numbers.**
_Scope: §1 Recommendation, WS-4, F-12 to F-15, F-25, §3 non-goals._

- **The numbers:** §5.4 puts all Firestore spend at $0.03–0.06 a day and calls it "not a problem". F-12, "the biggest avoidable read", is 18,000 reads, or about $0.005–0.01 a day at the document's prices. F-15 saves about 2 reads per busy write.
- **Inconsistent reasoning:** §8 rejects incremental client stats because the saving is "a tiny fraction of a cent" and the current design repairs itself. F-13 is the same trade, yet it is scheduled: it needs a note that "drift repair still has a path", and §9 says its "billed" claim is untested.
- **Scale creep:** F-14's size is quoted at 30 barbers, while the planning scale is 10. §3 says optimising for traffic that does not exist is a non-goal.
- **Evidence arrives after the fix:** F-25 says it "needs a trace", but the trace is WS-6 step 7, after first deploy. The WS-4 fix adds per-`BusyKey` shared streams with a 30 s linger, which is caching with no proven bottleneck. A5 applies the correct rule ("decide with a real measurement"), but WS-4 does not.
- **Suggested change:**
  - Move F-12 to F-15 and F-25 behind WS-6 step 7, triggered by real billing and trace data.
  - Keep the cheap, low-complexity items in Gate A: F-17, F-18, F-19, the `gsap` import and the F-26 debounce and cap.

**2. WS-1's verification cannot be met, and the search design is unresolved.**
_Scope: WS-1, §10 row 1, §6.1 "Availability nodes" row._

- **The conflict:** the plan requires "every existing availability case passes unchanged". `availability.system.spec.ts:2233-2246` asserts that `availableStarts` equals a depth-first `referenceSearch`, in both `options` and `exhausted`, at node budgets of 30, 400 and 20,000. A per-start quota should not reproduce a truncated depth-first answer. The exact `nodesVisited` of 500 at `:1662-1671` is also at risk.
- **What to say instead:** the plan should state that this test's intent is being redefined, for example equivalence at an unlimited budget. `CLAUDE.md` §0 only requires preserving test intent, so this is allowed, but it must be explicit.
- **The real design question is open:** the 57–150 node prototype took the first leaf. Keeping the "tightest arrangement" may require enumerating every arrangement for a start. The plan does not say what happens when a quota runs out. If tightness is truncated, the silent defect returns at a smaller scale. The budget row has no number ("see WS-1"), and WS-1 gives no ceiling.
- **A simpler option to evaluate:** make the grid a feasibility check per start, then compute the tightest arrangement only for the start the client picks. That fits Law 3's lazy evaluation, and the prototype's numbers suggest it is cheap.
- **Spike first:** do this before committing to WS-1. Steps 2 and 3 (carrying `exhausted`, plus bg and en copy) should depend on it, because if the ceiling spec proves no exhaustion up to the maximum party, that message is dead UI.

**3. F-01's summary is broader than its evidence.**
_Scope: §1 item 1, F-01._

- "Runs out… for parties of three or more" comes from synthetic any-barber days.
- The F-01 table's 3-barber, three-line row loses nothing (28 of 28).
- `availability.system.spec.ts:1718-1720,1847-1856` pins the seed catalogue's party of three as not exhausted, at 167,690 nodes and 39 starts.
- The defect is probably real for four lines, and 16% headroom at three lines is thin. Even so, a four-line and five-line case on `seedCatalogue` is a cheap measurement that should come before a redesign. It would also supply the missing "real barber preferences" data and the §6.1 number.

**4. The listener ratchet does not catch new listeners.**
_Scope: §1 item 3, §6.1 row, WS-3 step 5._

- The ratchet allowlists `onSnapshot` import sites in `observe.ts`. That file holds the generic `observeDoc`, `observeQuery` and `observeCountedQuery` helpers (`libs/infrastructure/firestore/src/lib/observe.ts:310,340,364`) that adapters use.
- A feature adding a stream through those helpers stays green, which is the exact failure §1 says must end. F-25 confirms that 4 sites already produce 40–220 live listeners.
- Replace it with a limit on helper call sites, or drop the budget and say listeners remain a review concern.

**5. WS-6 recommends an EU region but omits the required changes.**
_Scope: WS-6 steps 1–2 and Verify, F-05, F-19._

- Step 2 modifies only `main.ts` and its spec. `docs/production-deploy.md:106-116` says an EU database means adding a region to every export, `getFunctions`, the `connect-src` host in `firebase.json` and `functionsHost` in `check-csp.mjs`, "all in one change".
- Preflight P5 also pins the `us-central1` host (`docs/production-deploy.md:51`), and `tools/verify/p0/verify-p0.mjs:90` hard-codes the region. As written, callables would break, and the plan's own preflight Verify step should fail.
- This is flagged as an irreversible decision, but the recommendation leaves out two things:
  - The doc does not connect it to F-19's finding that an EU bucket pays from the first byte.
  - It does not weigh the deploy doc's "`nam5` or `us-central1` is the simple choice" against a latency figure that is only estimated.

**6. The OTP limiter reinvents an existing throttle and adds a contended store.**
_Scope: WS-6 step 3, F-21, F-22._

- **Existing mechanism:** the plan asks for "a new limiter port and adapter" with four mechanisms. `apps/functions/src/edge.ts:937-948,1240-1248` already has `tokenBucket` and `throttledCallable`, which refuse "before anything is read". Multiplied by `maxInstances`, that gives a global rate ceiling with no storage and no writes. The client issue sink already uses this pattern (`apps/functions/src/main.ts:1220,1232-1238`). It also meets F-22's "before the commit" requirement.
- **New problems from the proposal:** a Firestore global daily counter is one shared document under a flood, the same contention F-14 complains about. A stored IP bucket adds writes per accepted request and needs its own TTL.
- **Suggested simpler set:**
  - the existing throttle;
  - a pure country allowlist;
  - a daily count per destination, kept on the existing per-destination challenge record if the data fits;
  - App Check;
  - the SMS provider's own geo and spend limits, which cap dollars at the source and are not mentioned anywhere.
- A rate ceiling alone does not bound the money (2 requests a second is still ruinous), so the provider cap or a daily cap remains necessary.

**7. New verifiers duplicate existing tools or guard something the document says does not matter.**
_Scope: §6.1, WS-3 steps 3, 4, 5, 11, A4._

- **Route closure:** `tools/verify/bundle/initial-bundle.mjs:53-70` already walks the static-import closure, and `verify:bundle` already runs in the `static` job. Generalise it rather than creating `tools/verify/budgets/route-closure.mjs`. The plan also needs to define how a route maps to hashed chunks. The metafile reports raw bytes, so raw limits would avoid a compression step and match the initial budget's unit and F-24's per-raw-KB CPU estimate.
- **Functions load:** a `Module._load` hook relies on a Node internal. A4 rejects load work as worth "an estimated 50–100 ms and no meaningful money", and baseline plus 10% allows about 140 more modules. `tools/verify/p0/functions-deps.mjs` already catches new packages. Cut this until the WS-6 cold-start measurement shows a need.
- **Line-count ratchet:** ESLint's core `max-lines` rule, scoped to the two files, does this with no new script.
- **`onSnapshot` allowlist:** an import restriction in the existing lint layer can do this, as `firebase/*` confinement does. Note the warning at `eslint.config.mjs:520` that a later block replaces earlier restricted-rule entries. A small custom rule may be needed.
- **Rules `get`/`exists` count:** check whether this fits the existing `verify-tools:runbook-gates` grep runner.
- **Budget count:** §10 promises "few budgets", but §6.1 has 12 rows.

**8. Law 11 cannot be satisfied on day one, and a law is the wrong instrument.**
_Scope: §6.2, §6.3, WS-3 step 9, F-16._

- "Every cost that can grow… has a number and a check" is contradicted by the document itself:
  - §6.3 exempts browser journeys, and `/book` is roughly half of the estimated daily reads.
  - WS-3 step 9 pins 6 of 49 pipelines, while the law and §6.1 say "per pipeline".
  - F-16 relies on "the journey budget", which §6.3 declines to create.
  - §2 also lists reads per journey as a missing target, and the design never supplies one.
- "A budget rises only in the commit that explains why" is not mechanically checkable, though §2's complaint is that review alone protects the base.
- Pinned read counts are also change detectors rather than budgets: every legitimate extra read means editing a spec.
- Simpler alternative: no new law. Keep `budgets.json` as the record and add the gate to `CLAUDE.md` §5. If the owner wants a law, narrow it to what is actually enforced.

**Also consider, within scope of 1 and 8:** WS-5's F-08 step has no exit condition. "Do a full inventory of both files first" covers 14,000 lines inside a gate that must close before feature work, which works against A6 and §3. With a no-growth limit in place, extract the listed rules and leave the rest to incremental work as features touch these files.

**Unaddressed half of the root problem (§2, F-28, A2, A3).** §2 names two goals, V8 and Firestore. The V8 half gets no budget and no work stream, because A2 and A3 reject the checks, F-28 appears in no WS, and there is no disposition for it. Not measuring V8 may well be correct, but the document should say so outright, for example in §8: the V8 claim stays asserted until a measured problem exists.

**Unsupported scope (WS-6 step 6).** The per-client open-booking cap has no finding, estimate or owner ruling behind it, and a search of `libs/ecs-core/src` finds no existing cap. It is a new product rule that would refuse real bookings. Remove it, or raise it as its own finding with a ruling.

## Nit

**9. WS-3 step 1 is misfiled (WS-3, WS-6 step 2).** It sits first in a Gate A list "ordered by value", but it cannot land until Gate B. Keep it only in WS-6.

**10. CI duplication and an unstated dependency (WS-2).**

- Adding `run-many -t lint` to `static` while `main` still runs `affected -t lint` lints twice. Remove lint from the affected run (`.github/workflows/ci.yml:57`).
- Every budget "fails a build" only if A1 is accepted, and there is no stated fallback if the owner declines.
- Confirm that the repository's GitHub plan and visibility allow required-check rulesets before relying on them. `ci.yml:24-28` treats visibility as unknown.
- The risk table covers flakes but not the 75-minute job timeout as a merge wait.

**11. Arithmetic (§5.4).** "At ten times this scale… a few dollars a month" is about 1.45M billed reads a day, or $0.44–0.87 a day, or $13–26 a month. The conclusion survives, but the figure is off by several times, and it underpins the cost argument.

**12. Margins and aspirational limits (§6.1, WS-3 step 10, WS-4 item 10).**

- "Plus a small margin" does not match an error limit of 750 kB against 589 kB, which is 27%.
- The second-stage route limits (250 and 500 KB) are set before the work, on estimated CPU costs. Do `gsap` and `@defer` first, then set them from the result.

**13. Unexplained references and volatile detail (§1, §11).**

- "The question assumed" and the quoted "No gaps left" refer to a request the document never states.
- §11's many line-number citations are the same rot F-29 reports. Function or symbol names would age better.

## What should stay

These hold up well and should not be reduced:

- F-01 as the top priority
- F-02 and F-03
- F-05, F-06 and F-22
- §8's client-stats reasoning
- A2, A4, A6, A7, A8 and A10
- the operation-count rule in §6
