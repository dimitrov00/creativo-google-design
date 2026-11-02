# Stage 8: Intermediate zoom-out

Target: `docs/architecture/performance-cost-audit.md`, full file, plus the three earlier reports. Reviewer: `egm-zoom-out`, in a fresh context. The target has not been edited since those reports were written.

**Verdict: do not apply the reports as a set.** The diagnosis holds. Applied in full, the requests would turn a 687-line audit into roughly 1,100-1,300 lines (the reviewer's estimate). It would also become a glossary, a threat model, a bill model and a specification for 17 or so budgets, while several of those requests contradict each other. The smallest sound plan is about 14 steps against today's 42, with 6 checks against 12, no new law, and three owner rulings.

**Result:** 0 Blockers, 7 Majors, 1 Nit. None of these re-lists a finding; they rule on the requests. The reviewer ran nothing. Dollar figures are its arithmetic at the document's prices, which the document says are from memory.

## Author's note: where this report conflicts with the request

The original request was to confirm the code follows the laws and to leave no gaps before feature work. This reviewer applies a simplicity test, and finding 2 moves known law violations (F-08 to F-11) out of Gate A into a backlog on that basis. That is a trade-off for the owner to decide, not a settled conclusion:

- **For the cut:** `max-lines` stops the two staff files growing, and a feature that needs to add lines must extract something first.
- **Against the cut:** the laws are recorded as non-negotiable, and F-09 is a correctness issue rather than a style one: one DST-gap time gets three different answers. F-08's rules live in the files feature work will touch, and they have no specs.

The author's position: F-09 belongs in Gate A, because it is small and affects correctness. The listed F-08 rules can follow `max-lines`, if the owner accepts that known violations stay open while features proceed.

## Findings

**1. Major: the reports pull in different directions because they measure different things.**
_Scope: the whole document; all three reports._

- The comprehension reviewer deliberately read no other files, so many of its gaps (items 1, 3, 4, 5, 6) are effects of that isolation. One pointer to `CLAUDE.md` §1, `HANDOFF.md` and the rulings file clears the Blocker, so no glossaries are needed.
- The critic applied a feature-spec standard, which asks for depth. Zoom-out asks for less depth.
- Findings are evidence pinned to commit `86870b9d`, so their line citations do not rot. Decline stage-5 item 13 for findings and apply it only to plan steps.

**2. Major: Gate A is still too large, even after the cuts stage-5 item 1 proposes.**
_Scope: §1, §11, stage-5 item 1, C-7._

- Stage-5 keeps F-17, F-18, F-19, `gsap` and F-26 in Gate A. The app has never been deployed, so these cost nothing until the first deploy and get no harder to fix later. Move them to Gate B.
- The same reasoning applies to F-09, F-10, F-11 and the F-08 extractions.
- C-7's admission test should be two sentences:
  - Gate A holds only what lets bad code merge, gets worse as features land, or is a booking defect.
  - Gate B holds what can cost money or harm users at launch.
- This also settles C-7's and comprehension item 13's complaint that severity does not predict the gate.
- Trade-off for the owner: known law violations remain open while features proceed. `max-lines` contains that risk, because a feature that adds lines to those files must extract something first.

**3. Major: the budget requests conflict directly, and most resolve by cutting.**
_Scope: §6, WS-3, stage-5 items 4, 7, 8, C-9, C-13._ See the conflict table and the six checks below. The two most useful cuts:

- **Read and write count specs (WS-3 step 9).** One report calls them change detectors and another wants them improved to count documents and fan-out. `query-needs-limit` already catches the unbounded `clientHistory` case, and the money at stake is cents a day. Cut them, and §6.3 with them.
- **Listener budget.** F-25 shows 4 sites producing 40-220 live listeners, so no static count sees the multiplier. Remove "a new listener" from §1's claim and leave listeners to review.

**4. Major: the F-01 requests collapse into one timeboxed spike, and it has a risk nobody named.**
_Scope: WS-1, §6.1, §10, C-1, stage-5 items 2 and 3, comprehension item 7._

- **Unflagged risk:** the seed party of three uses 167,690 of 200,000 nodes, and `availability.system.spec.ts:1855` pins its digest. A per-start quota could truncate tightness there and break that digest. Make this the spike's first acceptance test.
- **Oracle needs no new harness:** `referenceSearch` already exists in that spec. Run it unbudgeted on small fixtures, which answers C-1's point that the true answer at 10 barbers is out of reach.
- **Spec intent to state:** the depth-first equivalence at `:2233-2246` is redefined against the unbudgeted reference. Budget-truncated equality goes. Seed digests stay.
- **Correction to stage-5 item 2:** truncated tightness gives a valid but longer arrangement, which is a quality loss. F-01's defect is a missing time. Only the second must be proven absent.
- **Decline, for now, the lazy "tightest on pick" option.** The grid's contract and digest pin the arrangement, so it changes every caller. Record it as an alternatives row, with "raise the budget" rejected on C-1's 8 billion figure.
- **Spike output:** the seed four-line and five-line measurements, the quota, and one alternatives row. Those replace C-1's design subsection. Write the bg and en message only if the ceiling spec cannot prove recall.

**5. Major: Gate B omits the launch blocker it depends on, and the OTP requests conflict.**
_Scope: WS-6 step 3 and Verify, F-21, F-22, stage-5 item 6, C-3, C-10, C-11._

- **Missing work:** `docs/production-deploy.md:40` says P8 fails every functions deploy until the real sender lands. WS-6's Verify still expects P8 to refuse, and no step wires a sender. Gate B cannot close as written. The sender and its limits should be one change, and Gate B's check should be that P8 passes.
- **Stage-5 versus C-3 and C-11:** stage-5's simpler set keeps a country allowlist and App Check. C-3 shows the deployment uses `EmailOtp`, where a country limit does nothing. C-11 shows App Check is deferred, large work that would refuse callables from the current build. Drop both for launch and list them, with provider geo limits, as conditions on adopting `PhoneOtp`.
- **Smallest email set:**
  - `throttledCallable` with `tokenBucket` and a low `maxInstances`, the existing `reportClientIssues` pattern. It refuses before any read or write, with no new port, adapter or stored counter.
  - A per-destination daily cap, by widening the `loadOpenOtps` window and changing `OtpSystem`. Index #10 already serves it, and the TTL of expiry plus 24 h keeps the data. It counts unconsumed challenges only, which spares real users. This is a reuse no report found.
  - The email provider's daily quota, as the actual cap on spend.
- **Effect:** at an illustrative ceiling of 2 requests a second, writes fall to about 346,000 a day, or $0.31-0.62, against C-2's $155-311.
- **Risk row to add:** a global ceiling lets a flood lock out real logins. Accept it at this size and say so.

**6. Major: the flood requests collide with stage-5's "should stay" list, and one table settles both.**
_Scope: F-05, F-06, A8, A10, C-2, C-4, C-5._

- Stage-5 says keep A8 and A10. C-2 says the brake does not brake and the cap does not bite.
- Keep both rejections, since an automatic cut-off and per-function tuning are still not worth building. C-2 is right on the wording, though: rename F-06, because alerts are not a brake, and state the residual exposure.
- Replace the flood prose with one five-row abuse table covering callables, OTP, video bytes, anonymous Firestore reads (12 `allow read: if true` blocks confirmed) and Storage. Columns: rate, cost per day, control, residual.
- The table's one real investigation is which callables write before authentication. The reviewer did not verify that.
- Add one short bill-by-service table with landing traffic. Move per-action Functions, Storage and Hosting costs, and client memory, to non-goals, as C-5 allows. Decline C-2's full fan-out model.
- Extend the runbook flood step to Hosting, which has no cap and is C-4's largest exposure.

**7. Major: delete Law 11, which also removes the requests to repair it.**
_Scope: §6.2, stage-5 item 8, comprehension item 12, C-9, C-17._

- Rewording requests and "add a step and fallback" requests fall away with it.
- This goes further than stage-5 item 8: no `CLAUDE.md` §5 change is needed either. `verify:bundle` already gates CI without being listed there.
- It remains an owner option once the checks exist.

**8. Nit: decline the style and traceability sweep.**
_Scope: critic Nits, C-14, comprehension Nits._

- Fix only factual errors: the F-01 headline, the 10x figure, the impossible 300-bookings scale, the summary's wrong F-number, and the false "every estimate is labelled".
- A command per Measured row is needed only for F-01, whose fixture becomes a committed spec.
- Raw bytes remove the kB/KB and compression-algorithm complaints.

## Conflicts and rulings

| Requests in tension                                                                                     | Ruling                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage-5 item 7 (fewer budgets) vs C-9 (more) and C-13 (specify each in §6)                              | Six checks. Accept one addition, a size ceiling on public assets, if it fits the bundle verifier: videos outweigh the whole Firestore bill. |
| Stage-5 item 1 (defer F-13) vs C-8 (drop, or add a detector)                                            | Drop to §8. It removes self-repair from data the booking conflict check reads, so real billing data should not revive it.                   |
| Stage-5 item 1 (defer F-25, F-14) vs C-13 (design F-25 streams, add capacity limits and staleness rows) | Defer. Those C-13 requests are then moot.                                                                                                   |
| Stage-5 item 7 (raw bytes) vs §6.1 (compressed) and critic Nits (derive 250/500 KB)                     | Raw bytes, no second-stage limits. Set limits after the work.                                                                               |
| Comprehension item 10 (schedule all F-07 holes) vs simplicity                                           | Close the system purity holes and the `*-words.ts` match. Give zero-use holes one disposition line and leave them to review.                |
| Comprehension item 14 (scope of the F-08 inventory) vs A6                                               | Skip the inventory. `max-lines` forces extraction as files are touched.                                                                     |
| C-6 (derive every read count) vs deferring Firestore work                                               | Correct the order of magnitude only.                                                                                                        |

**Accept as written:**

- C-11's ruling flag, for any future App Check work.
- Stage-5 item 5, C-10 and comprehension item 15: the region gets an alternatives row covering residency and Storage cost, and an EU choice cites the one-change list at `production-deploy.md:113-115`.
- Stage-5 item 10's A1 fallback and plan check.
- Dispositions for F-16, F-20, F-23, F-27 and F-28, including the statement that the V8 claim stays unproven.
- Removal of the per-client booking cap.
- One owner-ruling list.

**Also cut:** WS-2 step 4, WS-6 step 4 and §6.3.

## The smallest sound plan

**Six checks**

1. Initial and route bytes, raw, by generalising `tools/verify/bundle/initial-bundle.mjs`. Use one default ceiling plus named routes, so new routes are covered. The current `project.json` limit is 1 MB against 589 kB, so tighten it.
2. `query-needs-limit`, with the 19 candidates triaged.
3. `max-lines` on the two staff files.
4. The F-01 recall spec with a `nodesVisited` ceiling.
5. Required region and `maxInstances` in `main.spec.ts`, landing in Gate B.
6. The rules `get`/`exists` count, only if it is one line in `runbook-gates`. Otherwise drop it.

**Gate A: before features**

1. F-01 spike.
2. F-01 fix, specs and a party-of-four journey.
3. Full lint in `static`, removed from the affected run.
4. Ruleset, after the A1 ruling and a check that the plan and repository visibility allow it. If declined, checks report and do not block, and the document says so.
5. Bundle and asset check.
6. `query-needs-limit` and the rules count.
7. `max-lines`, the purity holes and `*-words.ts`.

**Gate B: before first deploy**

1. Region ruling, and the one-change list if EU.
2. `setGlobalOptions` and its spec.
3. Real email sender with the three limits, with P8 passing.
4. Deploy doc: budget amount and channel, `setpolicy`, flood runbook, F-29 citations.
5. F-17, F-18, F-19, `gsap`, and the F-26 debounce and cap, without `content-visibility`.
6. After deploy: one trace, cold starts, first week's billing.

**Not gating**

- **Triggered by that data:** F-12, F-14, F-15, F-16, F-25.
- **Backlog:** F-09, F-10, F-11 and the F-08 listed rules, as files are touched.
- **Left alone, in §8:** F-13.

**Document edits:** a pointer to the laws and one sentence on the product, a booking-correctness goal, the admission test with gate vocabulary, the factual fixes, the abuse and bill tables, and the rulings list. Length should end near today's, or shorter.

**Owner rulings:** A1, the Firestore location, and the budget amount with tolerated loss.

**Not verified by the reviewer:**

- Route-to-chunk mapping in the metafile: it reported that no `dist` exists, although this session's build wrote one. esbuild normally records `entryPoint`, so confirm it in a real stats file.
- Whether the rules count fits the `runbook-gates` runner.
- Any spike outcome.
