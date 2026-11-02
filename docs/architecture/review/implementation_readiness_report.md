# Stage 9: Implementation readiness, round 1

Target: `docs/architecture/performance-cost-audit.md`, lines 508..687. Standard for readiness and code accuracy: `implementation-readiness-standard.md`.

| Reviewer                       | Status    | Blocker | Major                       | Nit |
| ------------------------------ | --------- | ------- | --------------------------- | --- |
| `egm-implementation-readiness` | completed | 6       | 21 (plus a cross-plan item) | 5   |
| `egm-codebase-details`         | completed | 9       | 21                          | 8   |
| `egm-style`                    | completed | 0       | 16                          | 11  |

**Verdict: the plan is not ready to implement.** It works as a backlog, but many steps leave the algorithm, values or test oracle to the implementer, and some would break working behaviour. After deduplication there are 8 Blockers and 15 Majors. The style reviewer's own summary line says 15 Majors while its list holds 16; the list is used here.

This stage reviewed the plan as drafted, before the cuts Stage 8 proposes. Under each Blocker, **Stage 8 effect** says whether those cuts would remove it.

## Author's checks against source

| Claim                                                 | Result                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No busy backfill exists                               | **Confirmed.** `BackfillJobName` holds only `SUBJECT_MIRROR` and `CLIENT_STATS`, and neither backfill file mentions busy.                                                                                                                                          |
| The waitlist also consumes the search                 | **Confirmed.** `waitlist.system.ts:555` calls `optionsForDay` with `maxOptions: 1` and returns `null` on no option.                                                                                                                                                |
| The region change reaches beyond `main.ts`            | **Confirmed.** `production-deploy.md:106-119` lists it.                                                                                                                                                                                                            |
| `Math.random` in `confetti.ts`                        | **Confirmed.** Eight matches. The appendix count is wrong.                                                                                                                                                                                                         |
| "No comment says the week view defaults to one chair" | **Refuted.** `staff-day.store.ts:157` and `:1010` both say it, so a part of R-5 is contested. The plan cited the wrong line. `_scope` starts `null` and only the URL or the UI changes it, so F-25's core claim holds: the code does not do what the comments say. |

## Blockers

**R-1. WS-1's search algorithm is undefined, and its acceptance test conflicts with it.**
_readiness-1-B1, codebase-1-B1. Lines 517-523, 533-535._

- Left open: the quota value; how candidate party starts are enumerated, when each barber's grid is measured from their own gap and the envelope start is the minimum sold-slot start; whether the quota replaces `nodeBudget`; what `exhausted` and `nodesVisited` mean afterwards; and what happens when a quota runs out before the tightest arrangement is proven.
- "Every existing availability case passes unchanged" cannot hold. `availability.system.spec.ts:2233-2246` requires equality with the depth-first reference, including `exhausted`, at small budgets. `:1662-1668` pins `nodesVisited`, and `:1847-1856` pins seed digests and node ceilings.

**Stage 8 effect:** replaced by the spike and an explicit statement of which spec intent changes.

**R-2. WS-1's specs have no oracle and its budget has no number.**
_readiness-1-B2, codebase-1-M1, style-1-M4. Lines 424, 529-535._ Section 6.1 says "see WS-1", and WS-1 gives no value. The F-01 table records no exhaustive answer, and an exhaustive search for 10 barbers and 4-5 lines is not tractable as a unit test. The fixture is not reproducible, because it gives a count of appointments but no placement or lengths. "Equals the exhaustive answer" also conflicts with the target "all but at most one start". The e2e journey has no file or seed, and a normal seed may not trigger the defect.

**Stage 8 effect:** eased by using the existing `referenceSearch`, unbudgeted, on small fixtures. Values still need the spike.

**R-3. WS-1 misses a server-side consumer.**
_codebase-1-B2, readiness-1-M1. Lines 524-528._ `optionsForDay` is also called by `WaitlistSystem.match`, which reads `options[0]` and returns `null` when there are none. An exhausted search therefore gives a silent false "no match" on the server. The plan names two UI callers only. The new return shape, the merge rule across shops and the meaning of a message on `booking-schedule-step.ts:673` (a per-day boolean, so an exhausted empty result marks the day unbookable) are all undefined.

**Stage 8 effect:** not removed. This is a new item for the spike.

**R-4. F-13 would remove the repair mechanism and points at a path that does not exist.**
_codebase-1-B3, readiness-1-M12. Lines 595-597._ No busy backfill exists. Today every appointment write recomputes the day, and that is the self-repair. `affectedKeys` takes `busyKeys`, `localDate` and `seats`, so a liveness test needs a wider signature.

**Stage 8 effect:** removed. F-13 moves to the leave-alone list.

**R-5. F-25 is a user-visible change with undefined behaviour.**
_codebase-1-B4 (in part contested), readiness-1-M16. Lines 608-610._ Which chair is the default (the viewer's own, or the first), the behaviour for managers, the interaction with `?barber=`, and how the shared streams and 30 s retention are built are all undefined. The comment exists, but at `:157` and `:1010` rather than the cited place.

**Stage 8 effect:** removed. Deferred until a trace exists. The mismatch between comment and code remains a small defect worth recording.

**R-6. WS-5's F-08 step has no closed scope.**
_readiness-1-B5, codebase-1-B5, style-1-M10. Lines 628-630._ "The listed set" contradicts "do a full inventory first". No system, presenter, signature or stopping rule is named, over 14,482 lines, as a condition of Gate A.

**Stage 8 effect:** removed from Gate A. `max-lines` plus extraction as files are touched. This needs the owner's acceptance, as noted in the Stage 8 report.

**R-7. WS-6's region step would break every callable.**
_readiness-1-B3, codebase-1-B6. Lines 645-646, 660._ It names `main.ts` and its spec. The change also reaches `firebase-app.provider.ts:121`, `firebase.json:41`, `check-csp.mjs:170-173`, `verify-p0.mjs:90`, `preflight.spec.mjs:38,543` and the runbook's own text. Other gaps: no home for the region constant; `setGlobalOptions` must run before the definitions; the fate of the `maxInstances: 2` override; and Verify exercises no callable. The `apps/web/e2e` exposure was not inspected.

**Stage 8 effect:** not removed. An EU choice must cite the one-change list. Keeping `us-central1` avoids all of this, so the ruling drives the scope.

**R-8. WS-6's OTP limiter and App Check are feature descriptions, and they target the wrong threat.**
_readiness-1-B4, codebase-1-B7, B8. Lines 647-650, 660-661._

- No values, port, store, TTL, rules, error codes or tests. `RequestOtpCommand` has no IP field, and whether to hash an IP is a privacy decision. The pipeline documents a frozen refusal order and "ONE commit with no reads".
- App Check does not exist anywhere in the repository. Enforcing it on the server alone would reject every OTP request, which locks users out of login.
- The deployment uses `EmailOtp` (Stage 7, C-3), so country limits do nothing today.

**Stage 8 effect:** replaced by `throttledCallable`, a per-destination daily cap through `loadOpenOtps`, and the provider's quota, with no new store. Still needs values and tests.

## Majors

**R-9. WS-2's outcomes are open.** _readiness-1-M3, M4, codebase-1-M3, M4, M5._ The ruleset variant, bypass list and path on refusal are unspecified. "Alternatively" leaves a choice. `ci-workflow.spec.mjs:109-123` pins the gate commands and is not updated, so the F-03 fix could be removed without a red check. The `static` job has a 20-minute timeout, and cold lint time is unmeasured. **`maxWarnings: 0` for one rule does not exist:** it is a per-run threshold, and with the security warnings present it would fail every run. The mechanism must be setting the rule to `error`.

**R-10. New rules and verifiers lack wiring.** _readiness-1-M5, codebase-1-M7._ No registration in `tools/lint-rules/index.mjs`, no ESLint config blocks, severities or globs, no package scripts, CI lines or `GATE` rows, and no specs for the verifiers.

**R-11. `query-needs-limit` does not fit the code.** _readiness-1-M6, codebase-1-M6._ `QuerySpec` always carries `limit`, written as `limit: null`, so the rule must detect `null`. Builders live in `*.pipeline.ts`, outside the stated glob. `catalog.adapter.ts:33` uses spread constraints an AST rule can't judge. `firestore-tx.adapter.ts:170` is the generic executor, not a real candidate. `clientHistory` stays unbounded on purpose and needs an annotation.

**R-12. Budget measurements are undefined.** _readiness-1-M7, M8, codebase-1-M8._ No compression algorithm, no route-to-chunk mapping, no `budgets.json` schema, and no byte baseline for function load. `initial-bundle.mjs:53-70` already walks static closures and should be reused. A plain text count of `exists(` gives 2, because of the comment at `firestore.rules:176`.

**R-13. WS-3 steps 6-8 do not match their findings.** _readiness-1-M9, M10, codebase-1-M9, M10, style-1-M8._ More `new Intl.*` candidates exist than "the 5 sites", and the exempt files aren't listed. "Close the holes in F-07" lists a subset. L1 and L3 are undefined. Package bans belong in `no-restricted-imports` per the header of `ecs-syntax.mjs`, not in that file. "Fix what they find" has no bound.

**R-14. WS-3 step 9 names wrong things.** _readiness-1-M11, codebase-1-M11._ `commit-booking` and `cancel` are not pipeline files. Recording lives in `memoryReadTx` in `test-support.ts`, not `port-doubles.ts`, so section 6.3's claim that port doubles count their calls is false. No expected values are given. _Stage 8 cuts this step._

**R-15. WS-3 step 12 misnames its port.** _readiness-1-N4, codebase-1-M12._ `LogEvent` is a dictionary, the port is `LogPorts`, and `ClientStatsRecomputePorts` has no log access. Retrying transactions could log twice.

**R-16. F-12's change is a product decision.** _readiness-1-M14, codebase-1-M13._ The pool holds visits, and `searchCustomers` returns people. It lives in `staff-dashboard.ts`, not the store. What an older-name hit shows or does is undefined. _Stage 8 defers this._

**R-17. F-14 needs more than one line.** _readiness-1-M13, codebase-1-M14._ A one-shot read touches the port bundle, adapter, double and store. Markers may go stale while a calendar is open. _Stage 8 defers this._

**R-18. F-26 and F-24 point at the wrong place or name nothing.** _readiness-1-M15, M19, codebase-1-M15, M16, style-1-M15._ The debounce lands in `store.setTerm`, not the template, and `CLIENT_SEARCH_DEBOUNCE_MS` already exists. The reward moment and "rare" components are unnamed. The `libphonenumber` finding has no step.

**R-19. F-17, F-18 and F-19 leave values open.** _readiness-1-M17, M18, codebase-1-M17._ Hashed chunk names mean globs may not separate initial from lazy chunks. No encoder settings, and the two video sites are unnamed. `downscaleImage` returns `SizedImage` and re-encodes to JPEG. No `cacheControl` value is given, and avatars overwrite one fixed path, so a long lifetime could show stale images.

**R-20. F-09, F-10 and F-11 are conditional or wrong for the code.** _readiness-1-M20, codebase-1-M18, M19._ `VisitFact` has no `utcEpochMs`, and `achievements.presenter.ts:470` reads a draft visit with no stored instant, so "use the stored instant" is impossible there. A rename does not remove F-10's mapping, because `toRunEvent` also converts coordinates; there are 177 occurrences across 9 files. F-11's items have no destinations.

**R-21. WS-6 steps 5-6 and Verify are open.** _readiness-1-M21, codebase-1-M20._ No budget amount; the Storage decision is deferred; the open-booking cap has no number or finding. `pnpm run preflight` needs `--project` and credentials, and `.firebaserc` holds a placeholder. P8 fails by design, so success is undefined. Line 504's alert has no step. _Stage 8 removes the cap and makes the check "P8 passes"._

**R-22. Phasing and marks contradict the plan's framing.** _readiness-1-N1, N2, codebase-1-M21, style-1-M1, M2, M3._ WS-6 step 7 happens after the deploy, inside a gate that must finish before it. WS-3 step 1 stays red until WS-6. "Create" and "Modify" do not mark each file, and `ratchets.mjs` is created twice. "Gate" has several meanings.

**R-23. Cross-plan gaps and unmeasured terms.** _readiness-1 cross-plan, style-1-M5, M6, M7, M9, M11, M12, M13, M14, M16._ The composite-index gap, F-16, F-27 and F-28 have no step. Law 11 has no step. "Small", "cheap", "rare", "noise" and "mostly false positives" have no measure. "Check" has no pass criterion. "Rule 3's order" and `verify:p0` are undefined. The Frankfurt cost claim rests on prices from memory. Appendix counts name no regex or script, and the `Math.random` row is false as stated (codebase-1-B9, a one-row fix).

## Nits

- `apps/web/project.json` has two budget blocks, and the step does not say which (readiness-1-N3, codebase-1-N4).
- `retireLapsed` calls `loadOpenWaitlist` itself, so reading the waitlist first would read twice unless its signature changes (codebase-1-N5).
- No home for the capacity entry comparison, which Law 4 suggests belongs in `CapacitySystem` (codebase-1-N6).
- `pnpm nx` against the workflow's `pnpm exec nx` (codebase-1-N7).
- "DOM differential" has no pointer; `HANDOFF.md:20` and `:783` mention it (readiness-1-N5, codebase-1-N8).
- The `:851` comment fix is listed twice (readiness-1-N5, style-1-N9).
- Heading case, the `main` job against the `main` branch, «Покажи още» without an English string, a lone contraction, and uneven wording in the appendix (style-1-N1 to N11).

## Checked and accurate

The two code-facing reviewers matched these to source: `availability.system.ts:191,851`; `booking-cart.system.ts:638-655`; `booking-time-sheet.ts:265`; `booking-schedule-step.ts:673`; `ci.yml:57`; 4 `onSnapshot` sites in 2 files; the one `exists()`; 6,672 and 7,810 line counts; the `presenter-purity` regex; `rebuild-capacity.pipeline.ts:194-202`; `match-waitlist.pipeline.ts:427-442`; `shop-day.pipeline.ts:90`; `staff-day.store.ts:131,940,1337,1447-1451`; `confetti.ts:14`; `avatar.adapter.ts:33`; `appointment-photos.adapter.ts:223`; `user.entity.ts:91`; `maxInstances: 2`.

**Not verified by these reviewers:** the 71 and 127 warning counts, the 19 query candidates, bundle and load measurements, most appendix rows, and `apps/web/e2e`'s region exposure.
