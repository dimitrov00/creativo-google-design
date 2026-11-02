# Stage 7: Critic review, round 1

Target: `docs/architecture/performance-cost-audit.md`, lines 1..507. Standard for design and structure: `feature-spec-standard.md`.

| Reviewer         | Status    | Blocker | Major                                             | Nit |
| ---------------- | --------- | ------- | ------------------------------------------------- | --- |
| `egm-design`     | completed | 2       | 9 (plus a combined reproducibility and risk item) | 5   |
| `egm-structural` | completed | 1       | 12                                                | 6   |
| `egm-style`      | completed | 0       | 13                                                | 10  |

The round is not clean. After deduplication there are 2 Blockers, 15 Majors and a group of Nits. "Raised by" gives each original finding's id as `<reviewer>-1-<n>`, using each reviewer's own numbering.

**Checked against source by the document's author after this round:**

- `AuthDeployment.DEFAULT` uses `EmailOtp` (`auth-strategy.data.ts:74`), and `channelAccepts` refuses other channels (`otp.system.ts:300`). Confirms C-3: the SMS scenario in F-21 is not reachable today.
- `availability.system.spec.ts:2233-2245` asserts equality with the depth-first reference. Confirms that WS-1's "passes unchanged" cannot be met for this case.
- `availability.system.spec.ts:1847-1856` pins the seed catalogue's party of three as not exhausted. Confirms that the summary overstates F-01 at three lines.
- `ambient-video.ts:39` sets `preload="auto"`, and the landing hero uses it with `/hero.mp4`. Confirms part of C-5. `welcome.mp4` on the landing page, and the dollar estimates, were not checked.
- `firestore.rules` holds 12 `allow read: if true` blocks. Confirms that anonymous reads sit outside every proposed control.

The critic's dollar figures are its own arithmetic and were not re-derived.

## Blockers

**C-1. The F-01 fix has no evaluated design, no alternatives, no defined oracle, and a mitigation the existing spec makes impossible.**
_Raised by: design-1-B1, structural-1-1. Lines 105-132, 424, 450-463, 500._

1. The only proposal is one per-start-quota idea in section 11, based on a prototype that was not re-run, which took the first leaf and missed up to one start.
2. Section 7 has ten alternatives and none concerns F-01. Raising the budget, pruning or memoising dominated branches, and iterative widening are all unexamined. The standard's Alternatives Rule states this as an explicit fail condition.
3. Line 500 requires every existing spec case to pass unchanged, while `availability.system.spec.ts:2233-2245` asserts equality with a naive depth-first search under arbitrary small budgets, and `:1662-1668` pins `nodesVisited`. The fix and its mitigation appear mutually exclusive.
4. The F-01 table has no ground truth. "Starts for one line" is only an upper bound. Exhaustive truth for a, a, b, b at 10 barbers is on the order of 8 billion nodes, so the recall oracle needs a defined method.
5. Business impact comes from a synthetic worst case. Line 131 admits real barber preferences were not measured.

**Requested:** a design subsection and alternatives row for F-01; true answers on small fixtures with the budget off; a statement of which spec cases change and why; the quota and a worst-case node formula; one realistic roster measured.

**C-2. The proposed brake does not stop the bill risk the document headlines.**
_Raised by: design-1-B2. Lines 22-24, 318-330, 461, 463, 504._

- F-06 is rated red as "No spending brake". A8 then rejects any automatic brake. Budget alerts do not brake, so F-06's sentence stays true after the fix.
- Ten instances at default concurrency 80 is 800 requests in flight, about 4,000 requests a second per function at 200 ms. The stated "realistic" flood of 1,000 requests a second needs about 3 instances, so the cap does not bite.
- The $80-100 a day figure has no shown inputs and appears to omit Firestore. The OTP path commits two documents per new destination before sending (`request-otp.pipeline.ts:189-204`). At 1,000 requests a second that is about 172.8 million writes a day, or $155-311 at the document's prices.
- The residual exposure after the fix is never quantified.
- A8 rejects a cut-off because "it also takes the site down", while line 504 accepts refusing real users because "refusal is cheaper". The reasoning is inconsistent.

**Requested:** flood cost including Firestore and trigger fan-out; residual dollars per weekend after caps; caps sized from concurrency and latency; an explicit decision on a kill switch, with a tolerated loss figure.

## Majors

**C-3. F-21's dollar figure and mitigation assume a channel the deployment refuses.**
_design-1-M1. Lines 23, 332-338, 462._ The deployment uses `EmailOtp`. The "86,400 SMS a day, $4,000-9,000" scenario needs a strategy change as well as a sender, and a country limit does nothing for email. The real first-launch risks are unpriced: email provider cost, mail-bombing strangers, sender-domain reputation, and F-22's row growth. **Requested:** split into an email threat now and an SMS threat if `PhoneOtp` is adopted, each with limits and a cost.

**C-4. The bill-risk ranking rests on the one surface examined.**
_design-1-M2. Lines 22, 68, 318-330, 492._ `welcome.mp4` at 4.4 MB and 100 requests a second is about 38 TB a day, or about $5,700 at line 93's price, the same order as the $4,900 ceiling at a far lower request rate. Anonymous Firestore reads bypass every proposed control, and App Check is deferred. Line 68 keeps cost abuse in scope while line 492 defers rules-based read abuse. **Requested:** a one-page abuse table of vector, rate, cost per day and control.

**C-5. Goal 2 is not met.**
_design-1-M3, structural-1-2. Lines 56-57, 288-310, 312-346, 348-395._ Only Firestore has a per-action table, and no client memory figure exists. There is no monthly bill, so "steady-state cost is low" is proven for Firestore only. F-18 leaves open whether videos load on landing; the critic traced `home.page.html:55`, `landing-hero.component.html:8` and `ambient-video.ts:39`, so a landing visit can pull up to 7.6 MB. At an assumed 1,000 landing visits a day that is about $33 a month, about 20 times the Firestore bill. Hosting is probably the largest recurring line and the summary does not mention it. **Requested:** a monthly bill by service, landing traffic in the planning scale, F-18 resolved, and client memory reported or moved to non-goals.

**C-6. Cost arithmetic and the planning scale are inconsistent.**
_design-1-M4, style-1-M5, style-1-M12, structural-1-13. Lines 87-89, 237-254, 275, 446, 469._

- Ten times the scale is $13-26 a month, not "a few dollars".
- 300 bookings a day on 10 barbers at 30 minutes exceeds capacity: 200 slots a day at most.
- 43 reads implies V+H = 20, while 300 bookings a day implies V of about 30, and section 8 uses about 120 visits.
- The 150,000 daily total has no derivation.
- C and E are undefined; "8+S" collides with S = services.
- F-14 uses 30 barbers against a planning scale of 10.

**C-7. There is no criterion for what is worth fixing, and severity does not predict the gate.**
_design-1-M5, structural-1-12, style-1-M8. Lines 30-32, 63-64, 100, 187, 261-282, 308, 318-340, 465-479._ Section 8 rejects a saving as "a tiny fraction of a cent", while F-12, F-13 and F-15, worth under a cent a day, sit in Gate A. Red means "stops a gate", yet yellow and green items are required by Gate A. "Gate" has several meanings, and "security rule" means both ESLint rules and Firestore rules. **Requested:** one admission test (dollars, user latency or correctness risk), an aligned legend, and separate words for CI check and milestone.

**C-8. F-13 removes self-repair from a booking-safety projection for negligible money.**
_design-1-M6. Lines 267-271, 467-475, 489-490, 498-506._ `barberBusy` feeds the placement conflict read (`booking-read-set.pipeline.ts:64-68`). Today any appointment write recomputes the day from source. A change test leaves drift in place until something else repairs it, which risks double-booking or false refusals. Section 8 keeps stats recomputation because it repairs itself, and stats are less safety-critical. **Requested:** drop F-13 under the section 8 test, or add a risk row with a drift detector and a payload proof.

**C-9. Several budgets cannot see what they claim to guard.**
_design-1-M7, structural-1-8, structural-1-9. Lines 20-21, 27-28, 149-159, 405-448._

- **Listeners:** the ratchet counts `onSnapshot` import sites, but streams are created through `observe.ts` helpers across 18 files.
- **Reads:** port doubles count calls, while Firestore bills per document returned. `clientHistory` is one call with no limit, so a call count hides the unbounded read. Trigger fan-out sits outside any single pipeline's count.
- **Browser journeys:** excluded, although they are the bulk of daily reads, which contradicts Law 11 and line 28.
- **Unbudgeted:** new routes, service-worker prefetch bytes, public assets and videos, and the "query has a composite index" gap, which has no row, alternative or step.
- **Not implementable as written:** line 424 has no number, line 423 points at a per-action table, and line 419 has no bytes baseline.

**C-10. High-regret and security-relevant decisions are missing from Alternatives.**
_design-1-M8. Lines 318-321, 343, 450-463._ The Firestore location is irreversible, and its recommendation sits only in section 11, with no comparison and no EU data-residency statement. F-22's limiter has no design: a global counter or IP bucket needs state, so a flood either writes to a hot document or relies on per-instance memory, which conflicts with "a refused request writes nothing". Provider-side controls are not considered.

**C-11. A9 reopens a deferred ruling without flagging it.**
_design-1-M9. Lines 66-67, 462._ `2026-10-26-owner-rulings.md:1467,1472` classes App Check as L-size work needing a reCAPTCHA host under the CSP and an enrolment design, and `production-deploy.md:963` warns that enforcement refuses every callable from the current build. A9 carves out the OTP callable in passing. **Requested:** mark it as a needed owner ruling and list the prerequisites.

**C-12. The problem statement and goals do not match the summary.**
_structural-1-5, structural-1-10, style-1-M1. Lines 8-28, 34-59._ The summary leads with a booking defect and merge gates, but section 2 states only the laws' missing numbers, and section 3 has no booking-correctness goal. "The question assumed" and "No gaps left" refer to a request the document never states. The summary cites F-05 and F-06 for OTP, where F-21 and F-22 apply.

**C-13. The risk section and the architecture section do not meet the standard.**
_structural-1-3, structural-1-4, design-1 risk register. Lines 403-448, 460, 463, 496-506._ Section 10 has no security implications or scalability limits. Missing rows: the global cap of 10 also binds 24 Firestore triggers, so projection rebuilds lag under load and availability goes stale; A7's one-shot read creates staleness; F-17's offline risk; region migration. The capacity document's 1 MiB and write-rate limits are not mentioned. Section 6 says only "new verifier" and defers what each check reads and where it runs to the task list. It contains no design for the F-01 search, the F-25 streams or the F-21 limiter.

**C-14. Evidence labels and limits are not applied as defined.**
_structural-1-6, structural-1-11, style-1-M6, style-1-M7, design-1 reproducibility. Lines 75-81, 106, 116, 161, 220, 315, 357, 387, 399, 481-494, 506._

- F-27 and F-29 carry no label; F-11 uses a fourth label; hybrids are undefined.
- F-13 is "Confirmed" although its billing claim comes from documentation.
- "Every estimate is labelled" is false: lines 384, 470, 473 and 479 hold unlabelled figures.
- "Measured" names no command or harness for F-01, F-07, module load or routes, and F-01's fixture omits appointment placement.
- Section 9 is incomplete: lines 132, 171, 213, 297-298 and 378-379 hold further unchecked items. It lists Angular templates and `libs/ui` as not covered, while F-26 and line 354 cite both.

**C-15. Headline claims go beyond their evidence.**
_style-1-M2, style-1-M3, style-1-M4, style-1-M13. Lines 8, 13-21, 105, 118-132, 147-157, 188, 205-206, 323, 355, 455-463, 504._

- "Three or more" and "most of the day" are contradicted by F-01's own rows; "half-empty" does not match occupancy of 15-30%. "The harm is lost bookings" is a prediction for an app that has never been deployed.
- "No performance or cost gate exists" sits above a table of partial gates.
- "Hold up well ... poorly" and "law-shaped" have no metric and exceed the reading coverage.
- Decision cells rest on phrases such as "realistic", "harmless", "large regression risk" and "enough at this size".

**C-16. Findings without a disposition.**
_structural-1-7. Lines 100-101, 284-286, 345-346, 387-395, 443-448._ F-16, F-23, F-27 and F-28 appear in no work stream. F-28 is yellow with no outcome. F-16 "belongs in the journey budget", which does not exist.

**C-17. Budget direction, Law 11 wording, and one reversed sentence.**
_style-1-M9, style-1-M10, style-1-M11, design-1-N2. Lines 138-139, 411, 436-441, 502._ "Only go down" contradicts rises explained in a commit. "Small margin" covers 0-27%. Law 11's "every cost that can grow without a code review noticing" has no objective test. In F-02, "this conflicts with" points at having no protection, when the proposed fix is what conflicts.

## Nits

- **Language (style-1-N1 to N4):** informal wording ("bad merge", "holes", "breed noise"), slogans ("abuse, not traffic"), filler, and repeated points. "Things that look like savings and are not" overstates a set of real, small savings.
- **Shorthand and references (style-1-N5, N6, design-1-N5, structural-1-13):** "mechanical sympathy", "raw brands", "ratchet", OR-n, P8, P3-RU-6, Deferred #4 and DOM-differential have no gloss. "§2" collides with this document's section 2. Ambiguous "the table", "the sweep", "one audit" and "the record".
- **Severity and order (style-1-N7, structural-1-14, 15):** a mixed key; IDs out of document order; uneven finding layout; F-29 has no title.
- **Terms and units (style-1-N8, N9, structural-1-18):** kB and KB in one column; "rows" for documents; three names for the scale; seat, line, barber and chair undistinguished; spelling mixes. "Not measured as a user-visible problem" can be read two ways.
- **Citations (structural-1-17, design-1-N1, N3, N4):** no URLs for pricing sources; mixed path forms; `:~2672`; 1.25-2.48 MB gives 1.25-2.5 s, not 1.2-2 s; the 250 KB and 500 KB targets have no derivation; the `libphonenumber` point omits the owner's F6 ruling in `.claude/rules/ecs-layering.md`.
- **Alternatives layout (structural-1-16):** rows name no finding; a recommendation sits among rejections; section 8 is split from section 7.
- **Formatting (structural-1-19, style-1-N10):** table pipe spacing; a code span breaks across lines; Bulgarian terms without a gloss; line 508's heading case. Line 125's 12:50 start is off the stated 15-minute step and should be confirmed or explained.

## Checked and holding

The design reviewer matched these claims to source: no production reader of availability's `exhausted`; the 200,000 budget and depth-first order; `maxPartySize` of 5; `ci.yml:57` and the seven jobs; the OTP commit before the send and the 60 s limit; the refusing sender; the one `exists()`; 4 `onSnapshot` sites in 2 files; `SEARCH_WINDOW_PER_SIDE`; `_scope` null; the `'bg'` sort; `ngsw-config.json`; `reportClientIssues` as the only capped function; the stale deploy citations; the transactional `clientHistory` read; the F-17 calculation; and the booking reads formula at L=2.

The structural reviewer confirmed heading hierarchy, closed fences and tables, and that internal section references resolve.
