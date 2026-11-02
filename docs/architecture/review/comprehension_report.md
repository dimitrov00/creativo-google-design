## What this proposes

No code changes yet. The document asks for two stages of work before the product moves on.

- **Gate A (before feature work):**
  - Fix the availability search so larger parties see the whole day.
  - Protect `main` and lint every project in CI.
  - Add build-failing budgets that count bytes, modules, call sites and operations, never time.
  - Apply a batch of cheap Firestore, Storage and bundle fixes.
  - Move the domain rules in two very large staff components into pure code.
- **Gate B (before first deploy):** choose a region (Frankfurt recommended), cap instances at 10 globally, set a budget with alerts, and put OTP limits ahead of any write.
- **Also proposed:** an eleventh law making performance budgets binding, for the owner to rule on, and a list of "savings" to leave alone, chiefly incremental client stats.

What the reviewer could not restate is what "follows the laws" means, or what the "tightest arrangement" rule the fix must preserve actually is.

## How the existing system works, per this document

It appears to be a barbershop booking app on Firebase: Firestore, 50 Cloud Functions, Storage and Hosting, with what looks like an Angular client and a service worker. The document never says this outright, so the product and stack are the reviewer's inference. It has never been deployed.

Code sits in an `ecs-core` library of systems, pipelines and similar tiers, governed by ten "laws" that are partly linted. Availability is a depth-first search with a 200,000-node budget that exhausts silently, so large parties lose later start times. Writes trigger cascades that rebuild busy data, a shared monthly capacity document, waitlist matching and client stats.

CI has seven jobs that block nothing and lints only affected projects. OTP sends are currently impossible because a refusing sender is wired in and a preflight check refuses the deploy.

## Findings

Reviewer: `egm-comprehension`, fresh context. It read the persona and all 687 lines of the target, with FeatureRange 1..507 and DetailedRange 508..687. No document standard applies. It read no other files, so anything the document leaves to `CLAUDE.md` or `HANDOFF.md` counts as not in the document.

Result: 1 Blocker, 15 Major, 10 Nit. The Blocker has a small fix: state or point to the laws.

### Blocker

**1. The laws are never stated or located.**

- **Scope:** lines 8, 36-37, 55; F-07 (161-179), section 5.3, F-08 heading (194), F-09, F-10, F-11, A4 (457), section 12, WS-3 step 7. FeatureRange and DetailedRange.
- **Gap:** Goal 1 and the first sentence of the summary are verdicts on "the ten laws", but the document never lists them or says where they are.
  - `CLAUDE.md` §0 is cited only for the two reasons behind the architecture. That the laws live in `CLAUDE.md` can only be inferred from line 433.
  - Only fragments can be recovered: Law 7.3 (instant computed at ingestion), Law 8 (no deep subpaths), and a hint of Law 1.
  - The reviewer cannot paraphrase the F-07 bullets for Law 5, 6.1, 7.4 and 9, or say what the appendix rows are evidence of. "Mappers: 0" also sits oddly beside F-10's "inbound mapping".
  - "Law 10.2 and §2" can be read as this document's own section 2.
- **Why Blocker:** the persona rule treats an unparaphrasable section as a Blocker. A law-to-one-line table or an explicit pointer would clear it.

### Major

**2. The opening argues with a request the reader never saw.**

- **Scope:** lines 9-10, 26.
- "The ones the question assumed" and the quoted "No gaps left" refer to a commissioning question that appears nowhere. The reader cannot tell what was assumed or why the summary pushes back.

**3. No statement of what the product and stack are.**

- **Scope:** whole document; lines 321, 383, 606-607, 644.
- Nothing says this is a barbershop booking product, who uses it, or that it runs on Angular and Nx. Angular appears only in passing at line 485.
- "From Bulgaria" appears with no statement that the users are there.
- «по», «Подстригване» and «Покажи още» are left untranslated, though F-26's argument depends on them.

**4. The architecture vocabulary is assumed.**

- **Scope:** lines 8, 165-167, 174-177, 445, 559, 574.
- System, pipeline, presenter, store, port, adapter, entity, primitive, "tier file", "non-suffix", "raw brands" and "ECS core" are used as if known.
- These are project-specific uses, and findings depend on them. For example, "domain rules belong in a system, not a component" is only meaningful if you know what a system is here.

**5. The domain vocabulary is assumed.**

- **Scope:** F-01, sections 5.4 and 5.6, WS-1, WS-4.
- Undefined terms:
  - "seat" versus "line" versus "party"
  - "tightest arrangement" and "rule 3's order" (500, 520)
  - "busy", `rebuildBusy`, "liveness" (596)
  - the role of `capacity/{YYYY-MM}`
  - "open schedule step" (274)
  - "rhythm preview"
  - "zone and policy" (280)
  - `retireLapsed`
  - "client issue sink"
  - "the reward moment" (617)
  - `dispatchSubjects` (271)
  - "Audit and privacy groups" (153)
- Barber, chair and lane appear to be interchangeable but this is never said.

**6. Project record identifiers have no definition or link.**

- **Scope:** lines 66, 454, 462, 479, 501, 505, 621, 637, 652, 660.
- Undefined items:
  - D1-D29, OR-1 to OR-59
  - "Deferred #4", "P3-RU-6", "kept by ruling"
  - "a practice recorded on 2026-10-10"
  - "preflight P8"
  - `verify:p0`
  - `pnpm run preflight` "for both scopes"
- The most load-bearing is "the DOM differential method from the earlier passes". It is the safety mechanism for moving rules out of 14,000 lines of components, and also the verify step of WS-5, yet it is never described or linked.

**7. The fix for the top finding cannot be pinned down.**

- **Scope:** F-01 (116-127), section 6.1 line 424, section 10 line 500, WS-1 (517-535).
- "A small node quota" has no number. The budget table says "see WS-1", and WS-1 says "a `nodesVisited` ceiling" with no number, so the reference is circular.
- The "earlier prototype" has no location, and it is unclear whether 57-150 nodes is per start or per query.
- Step 4 requires "starts found equals the exhaustive answer", but the table has no exhaustive column. "Starts for one line" is a different quantity, and nothing says how to compute the exhaustive answer when today's search cannot finish.
- The synthetic day does not say where the appointments fall, so the "Measured" table cannot be rebuilt as specs from this document.
- "Check the server accepts it" (535) does not say whether the server path shares this search and its budget.

**8. The read-count symbols collide and are incomplete.**

- **Scope:** lines 237-249, 446.
- S is defined as services. Line 446 says `commitBooking` with K=1 reads "8+S". At planning scale that is 38 reads, which does not fit the leading "9" in the booking row (9 + (1+V) + (L+5) + 3 + (H+3), total 43) unless S means something else there, such as seats.
- C and E in the staff grid row are undefined, and the terms of the booking formula are unlabelled.
- Section 6.1 gives "section 5.4" as today's value for per-pipeline budgets, but that table is per action.

**9. The daily total cannot be reproduced, and the 10x claim does not follow.**

- **Scope:** lines 251-254.
- No breakdown yields 150,000 reads a day.
- Using the document's own prices, 10x is 1.5M reads, minus 50,000 free, which is about 14.5 units of 100,000. That is about $0.44-0.87 a day, or about $13-26 a month, not "a few dollars a month by the same estimate".
- The conclusion that this is not a problem may still hold, but the stated figure does not.

**10. Some findings have no disposition, despite "IDs are used by the plan" (line 100).**

- **Scope:** F-16, F-23, F-27, F-28, F-07, F-19, F-24; WS-3 step 7.
- F-28 is yellow ("should be fixed") and is in no work stream. It also carries the only statement that the V8 goal is unproven, so section 2's first outcome is left with no number and no gate, and the document does not say so.
- F-16 says rhythm preview "belongs in the journey budget so that it cannot grow", but section 6.3 says journeys are not pinned and section 6.1 has no such budget.
- WS-3 claims to close the F-07 holes, but its list omits the bare discriminator, Law 5, Law 6.1 and Law 9. It also introduces "L1 and L3" (574), defined nowhere and not mapped to F-07.
- F-19's "grids download the 1600 px file" and F-24's `libphonenumber` have no step.

**11. It is unclear how some budgets catch new code.**

- **Scope:** lines 20-21, 423, 436-441, 568-569, 578-580.
- The summary's complaint is that a new listener or query passes every check.
- The listener ratchet allowlists `onSnapshot` imports in `observe.ts`, which is never described. If new listeners go through that file, the ratchet stays green.
- Read and write pinning is listed as per server pipeline and Law 11 says "every cost", but WS-3 names six specs out of 49 pipelines and nothing requires a spec for a new pipeline.

**12. Owner decisions are scattered and have no fallback.**

- **Scope:** lines 139, 431-441, 454, 539-550, 548, 633, 642, 651.
- There are at least six rulings (A1, Law 11, Firestore location, OTP row TTL, security rules, Law 1 wording) and no consolidated list.
- Law 11 has no step in section 11, and the document does not say whether the budgets proceed if it is rejected.
- Gate A depends on A1, but nothing says what happens if the owner refuses or picks the weaker option.
- WS-2's verify step ("cannot merge") does not hold cleanly under owner bypass.

**13. Severity and gate membership do not connect, and "gate" is overloaded.**

- **Scope:** lines 30-31, 100, 510, 591-638.
- Red means "stops a gate", yet Gate A also contains yellow and green items (F-11, F-29, WS-4). The reader cannot tell whether those must finish before features or whether severity carries any weight there.
- "Gate" also means the `CLAUDE.md` §5 check set, the test and emulator gates, the merge gates, and the `runbook-gates` job.

**14. F-08's scope is contradictory.**

- **Scope:** lines 459, 628-630.
- "The listed set, not a rewrite" and "extract the listed rules" sit beside "do a full inventory first, because F-08 is a sample". Nothing says whether newly found rules join Gate A, which blocks feature work.

**15. The irreversible region decision is not connected to its own cost evidence.**

- **Scope:** F-19 (304-306), F-05, WS-6 step 1 (642-644).
- Frankfurt is justified by latency and lower per-operation cost. F-19 says an EU bucket pays for Storage from the first byte, and WS-6 puts Storage in the same region. The trade-off is never put to the owner.
- The Firestore prices behind the comparison are stated to be from memory (lines 94-96).

**16. Other gaps, each a side effect, prerequisite or unmet goal the document does not state.**

- **WS-6 step 6 (656):** a per-client open-booking cap appears with no finding, no value and no explanation of the abuse it addresses. It is a new business rule.
- **Drift repair (267-271, 595-597):** F-13 calls the rebuild wasted work on "an unchanged result", yet WS-4 step 1 reveals it also serves as drift repair, to be replaced by an undefined "backfill".
- **Verifier prerequisites (554, 564-567):** verifiers run in the CI `static` job but need `dist` and built `main.js`. Nothing says that job builds, or adds a build.
- **Goals not met or disclaimed (56-57, 483-494):** the goals promise per-action cost in Functions, Storage and Hosting, plus client memory. No per-action figures exist for those three and no client memory figure appears, and section 9 does not disclaim them.

### Nit

- **Citation (22-24):** summary item 4 cites F-05 and F-06 for the OTP point, which is F-21.
- **F-01 table (12-15, 121, 125, 116):** "three or more lines... too few times" is contradicted by the 3-barber a, b, c row at 28 of 28. A "Last start" of 12:50 is off the stated 15-minute step.
- **`main` as a job name (501, 544):** a required check called `main` on branch `main` reads ambiguously. Only five of the seven jobs are ever named.
- **Budget direction (411, 415, 441, 502):** "then only go down" conflicts with rises explained in a commit. 589 to 650/750 kB is not a "small margin".
- **`maxWarnings` (181, 545-548):** it is set "for" one rule, but as far as the reviewer knows it is a whole-run threshold, not per rule. How 71, 127 and "200 or more" relate is unstated. F-07's security warning point ends in an unscheduled "rule on them separately".
- **WS-3 step 1 (557-558):** it is the first item of a Gate A stream but lands with Gate B.
- **F-29 (401, 520, 635):** "the comment" in WS-5 step 5 is already corrected by WS-1 step 1.
- **Scale and scale words (187, 275):** F-14 sizes at 30 barbers against a planning scale of 10, with no reason given. "No Blockers" in section 5.3 is not on the document's severity scale.
- **Units (360-364, 415-418):** kB and KB are mixed, and "compressed" never names an algorithm, although the budgets are meant to be deterministic.
- **Traceability (156, 646, 523, 469):** "the table" in `main.spec.ts`, the audit that "ranked it the top avoidable cost", and the five audits have no pointer. Many plan steps use bare filenames with no path.
