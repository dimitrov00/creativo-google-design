# Consolidated review, round 2: schedule storage, memory, cost and lazy evaluation

**Target:** [`docs/architecture/schedule-storage-and-lazy-evaluation.md`](../../../schedule-storage-and-lazy-evaluation.md), as committed in `7481e544`.

- FeatureRange: lines 1–359
- DetailedRange: lines 360–397

**Mode:** consolidated, all five stages, run in order. Each reviewer started in a fresh context and read the code. The target was not edited during the review.

**Stage reports:**

- [`zoom_out_report.md`](zoom_out_report.md), stage 5
- [`comprehension_report.md`](comprehension_report.md), stage 6
- [`critic_report.md`](critic_report.md), stage 7
- [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md), stage 8
- [`implementation_readiness_report.md`](implementation_readiness_report.md), stage 9

Round 1 is one folder up.

## Verdict

**Ready to build after one revision. Nothing in the design is wrong.**

- The rule holds, and so do each item's decision, C1, the deferrals and the drops. Every stage confirmed them against the code.
- **What the revision fixes:**
  - one spec that would fail;
  - comment texts that would be wrong;
  - a cap described as 366 days when it is 366 occurrences;
  - a week-view figure about three times too low;
  - a Law sentence that contradicts the document;
  - owner questions with no recommended answer.
- **Proposed additions not taken:** three, each rejected by stage 8 against the code (A14).

## Actions, by priority

### 🔴 Blocker

| ID  | Action                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Rewrite the idempotence spec.** The idempotence case in `rebuild-capacity.pipeline.spec.ts:259-287` asserts that the second plan equals the first. Under C1, the second plan is `[]`. Its intent stays: the same document after redelivery. |

### 🟡 Major

| ID  | Action                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2  | **Put the whole skip decision in one system function.** `CapacitySystem.monthUnchanged(stored, month, entries)` wraps `sameEntries` and adds the stored-`month` check, which matters because the TTL is stamped from `month`. The pipeline only calls it, which keeps Law 4.                                                                                                                       |
| A3  | **Spell out every spec case with its setup.** This covers the Sweep-twice case, a Sweep that changes one month, the wrong-`month` case, a stored month cleared to empty, and one `sameEntries` case per field, plus order and purity.                                                                                                                                                              |
| A4  | **Give the exact replacement text for every comment.** The `barberBusy` rules comment names the booking callables and keeps its security sentence. Three `unbounded-ok` lines each get their own reason, on one line. The four C1 comments in the capacity code change too, as do the two "a year" recurrence comments and the spec title, and the two F-25 store comments.                        |
| A5  | **Restate the series cap: 366 occurrences, with no limit on span.** Add its one-off creation cost and why far-future months are harmless. Correct the "about 4 live capacity months" claim.                                                                                                                                                                                                        |
| A6  | **Correct the figures.** The week view is about 850 reads (about 1,000 with the day view), with the arithmetic shown. A capacity month is about 70–90 KB, and 0.5–0.7 MiB at 10× scale. A roster version is about 1 KB. C1 saves about $0.002 a month; it is hygiene, done for the owner's "no redundant writes". Explain the 40 Sweep writes. Show the break-even arithmetic, and the $1–2 basis. |
| A7  | **Split the Law sentence between Law 3 and Law 5.** Show the text before and after. Law 3 keeps "availability windows" and "slot grids". Law 5 gains the truth and projection rule, with the bounded series named.                                                                                                                                                                                 |
| A8  | **Give every owner question a recommended answer, its consequence and "does not block Phase 1".** The F-25 comment fix goes into Phase 1: the code follows a recorded ruling, so the comments are the defect.                                                                                                                                                                                      |
| A9  | **Edit the audit in the same commit.** That covers row 260, F-14, F-25 and the "Waits for evidence" list, so the two documents agree.                                                                                                                                                                                                                                                              |
| A10 | **Fix the cross-references.** The rule is in §6. Gate B is in the audit's §11.                                                                                                                                                                                                                                                                                                                     |
| A11 | **Define the terms the reasons depend on, and use one name for each idea.** The terms are booking transaction, series, rebuild span, busy day, capacity month, `/book` and audit-log entry. Explain the §9 and §10 terms (read guard, phantom busy block, companion, "anyone" cart) in a clause where each is used.                                                                                |
| A12 | **State only what is true about what is stored.** The answer says "two derived things", and names the series. What is worked out when read is the days that weekly hours and breaks produce. Answer memory and storage in §1.                                                                                                                                                                      |
| A13 | **Make the plan checkable.** Write the specs first and confirm they fail. Call the checks "the check suite", not "the gate". Use one name for "returns no capacity `WriteOp`". The acceptance line names the files, says the rules change is comments only, and says the indexes are unchanged. Add the emulator lane.                                                                             |

### Not taken (A14)

- **A one-year span limit on series (stage 5, stage 7).** It fixes no defect. The number of day documents is already capped. Far-future months are tiny, nobody reads them, and they expire. The limit would need a new refusal code, new strings and new UI.
- **Day rebuilds skipping days past the rebuild span (stage 7).** It adds one policy read to every Day rebuild, about 3,000 reads a month, to trim a one-off burst. It does not remove the contention either.
- **Size warning logs (stage 7).** Nobody reads warnings before Gate B adds alerting, and a document that is too large already fails loudly.
- **A full glossary, a section on alternatives to the rule, and a held-memory model (stages 6 and 7).** They would add weight; A11 and A12 add only what a reader needs.

### 🟢 Nits

- The status note's warning about the audit's figure is stale; drop it.
- Link the breaks decision's ruling 3.
- Give the Security risk row a real risk.
- Number the plan "13".
- Use one step pattern throughout.
- Say where the two older dropped items came from.
- Rename the §9 labels to Saves / Needs / Risk / Revisit when.
- The appointments week query needs no composite index (`busyKeys array-contains-any`).
- Correct the busy-day drift mitigation: the merge happens in the same transaction, `retry: true`, and drift can only make a slot look taken.

## Recommended answers to the owner questions

1. **The series cap:** keep 366 occurrences, with no span limit. Fix the two comments that promise "a year". If a calendar limit is wanted later, use one year from the start, with its own refusal code.
2. **The week view's default (F-25):** "all chairs", as the code does under the shared-iPad ruling. Fix the comments in Phase 1.
3. **The Law text:** adopt the Law 3 / Law 5 split. Edit `CLAUDE.md` and `AGENTS.md` together, with a decision record, in Phase 2 after the owner says yes.

## Traceability

| Action | Raw findings                    |
| ------ | ------------------------------- |
| A1     | Z3, G9, R1                      |
| A2     | K13, G4, R2                     |
| A3     | Z7, N15, N16, R3, R4            |
| A4     | Z2, Z6, K16, G1, G9, R5–R9      |
| A5     | Z4, K1, K2, G1, G2              |
| A6     | Z1, K6, K15, G6, G7, G8, N6–N9  |
| A7     | Z5, K3, G5                      |
| A8     | K8, G11, R9; structural 4–7     |
| A9     | Z1, K9, G6, G8, R10             |
| A10    | K4, M1, G10                     |
| A11    | M2–M4, K10, G13; N2–N5, N11–N13 |
| A12    | K5, K11, K12                    |
| A13    | R11; style 1–9; codebase 13     |
| A14    | G1, G2, G3, G13                 |
