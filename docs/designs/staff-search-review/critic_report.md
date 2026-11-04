# Stage 7: Critic Review

Target: `docs/designs/staff-search.md`, FeatureRange lines 1..625 (Overview through Alternatives Considered)
Reviewers, all three completed:

- `egm-design` against `feature-spec-standard.md`: 21 findings (1 Blocker, 10 Major, 10 Nit). Raw ids `design-1-1` to `design-1-21`.
- `egm-structural` against `feature-spec-standard.md`: 16 findings (1 Blocker, 5 Major, 10 Nit). Raw ids `structural-1-1` to `structural-1-16`.
- `egm-style`, no standard: 16 findings (0 Blocker, 8 Major, 8 Nit). Raw ids `style-1-1` to `style-1-16`.

Context supplied: `CLAUDE.md`, `docs/styling-conventions.md`. Branch state: `origin/main` merged (includes PR #20, so `text-match.system.ts` exists).

Findings below are consolidated and deduplicated. The traceability matrix at the end maps every raw finding to a consolidated item. Severity is the highest any reviewer gave.

## Reviewer disagreement to settle first

- The design critic says the feature-spec part has a risks section ("Cross-cutting"). The structural critic says it has none: the only headed risk list is "Risks the implementer should watch" at line 776, in the implementation half. The two readings differ on whether a "Cross-cutting" section satisfies the standard's Risks & Mitigations area. Item B2 follows the structural reading, because the standard asks for failure modes, security and scalability limits, and mitigations together.

## 🔴 Blockers

### B1. The search window never re-anchors

**Scope:** lines 36-66, 356-362, 387-394, 697. **Source:** design-1-1.

`now`, `from` and `to` are computed when the listener attaches and are never recomputed. The listener is kept "for the page session" and detaches only after the page is hidden for 20 minutes.

- A front-desk tablet that stays visible for days keeps its old split between the "before now" and "from now" queries. The past reach shrinks below 60 days, and newly bookable days beyond the old `to` fall outside the window.
- Visits drift across the old "now" boundary, so each side's cap trims the wrong edge.
- That reintroduces the staleness bug the Problem section describes.
- Suggested direction: re-anchor and re-attach when the shop's local date rolls over, state the cost (about 4,800 reads once per day per device), or make the boundaries a function of the shop date only.

### B2. No Risks & Mitigations in the feature spec; security and failure modes are unstated

**Scope:** 491-513, 363-398; the only risk heading is at 776. **Source:** structural-1-1, with design-1-8, design-1-11, design-1-21.

- Risk content is scattered across "Cross-cutting", §3, Alternative A and the "Reopen if" lines. The standard asks for failure modes, security and scalability limits, and mitigations in one place.
- The listener pulls about 4,800 appointments (client names, phones, e-mails, notes) into every staff browser. The doc says only that scope rules "stay as they are". Nothing covers role scoping or what happens if Firestore rules deny the range query (see M10).
- First-paint and partial-load behaviour is unspecified: two listeners deliver separately, and with a persistent cache the first snapshot may be partial and `fromCache`. Counts and suggestions would flicker or be wrong until both sides arrive.
- There are no success criteria and no kill-switch. Only a log line exists "so a bill spike can be traced". No read threshold per device per day is set, and nothing says how to turn the listener back into a one-shot read without a deploy.
- Suggested direction: add one H2 risk-to-mitigation table before Alternatives, and merge the content from line 776.

## 🟡 Majors

### M1. CUJ 1 describes the rejected in-field rewrite

**Scope:** 147-150 vs 307-312, 567-576 (Alternative E). **Source:** design-1-3, structural-1-2, style-1-4.

CUJ 1 says "The field reads `+359 88 333` as the user types". §2 and Alternative E say the field is not rewritten, and the reading appears as a suggestion row and then a chip. Rewrite the CUJ to match, for example: a suggestion row shows `Телефон +359 88 333…`.

### M2. Which card the results use is stated three ways

**Scope:** 24-25, 61-63, 88-90 vs 430-439, 593-602. **Source:** structural-1-3, style-1-3.

The Overview and Goal 7 say results are "the same event cards the agenda uses" (Goal 7 names `lib-staff-event-head`). §4 uses `lib-visit-row`, and Alternative H says `.agenda-card` is not reusable and concedes a "visual gap". Line 432's "looks exactly like" is an unprovable absolute. Make the Overview and Goal 7 match the decision, and drop "exactly".

### M3. Cross-references point to the wrong places

**Scope:** 100, 111, 131, 312, 489 (and 752 in Detailed). **Source:** design-1-12, structural-1-4, style-1-5.

- Line 100: "see Alternatives, section 4". Alternatives are lettered; the hosted service is A.
- Line 111: reasoning is "in the Technical Plan (section 2)". It is spread over §2 to §5 (D1 and D2 in §3, D4 in §4, D5 in §5).
- Lines 131 and 489: "Section 5 lists it". Section 5 is the highlighter; the table is in §6.
- Line 312: "rewrite in place, section 4". It is Alternative E.
- Line 752: the ADR covers "D1 to D7"; only D1 to D6 exist.

Name the target or use the letter and heading, not a bare number.

### M4. The doc depends on a conversation the reader never saw

**Scope:** 30-34, 57-60, 109-111, 120, 125-128, 138, 439, 519-521, 574, 580-581, 587, 593. **Source:** structural-1-6, style-1-1, style-1-2, design-1-13.

- "You asked", "you ruled out", "decisions made on your delegation", "the conversation of 2026-11-03" and "How this draft was made" cannot be verified by a fresh reader.
- Lines 519-520 repeat the missing-brainstorm-brief note. Lines 57-60 carry revision history ("An earlier version of this draft said…").
- Suggested direction: one short provenance note, impersonal wording ("Owner-directed requirement, 2026-11-03: …"), and a retitled H2. Only "Open Questions" may address the owner directly. Add one line of evidence for how often search misses today.

### M5. The horizon, the cap and "every future visit" disagree

**Scope:** 77-79, 116, 125-128, 349-354, 365, 689, 785-787. **Source:** design-1-2, structural-1-5, style-1-8.

- The 3,000-per-side cap holds about 75 days at 40 visits a day. The default horizon is two months (`booking-policy.data.ts:38,61`), so the default barely fits. A 12-month horizon is about 14,600 visits and is truncated silently.
- The Open Question's "120 days as the cap" is ambiguous (days ahead or total window). With a 2-month default, "if the policy has no horizon" is moot. The 4,800-read figure assumes 120 days in total, not 60 back plus 120 ahead.
- Related drift: 6 folded fields at 321-322 vs "about 8" at 493; "bookable horizon" (79) vs "booking horizon" (125).
- Suggested direction: derive the cap from the horizon, or weaken Goal 3 to "up to the cap". Add cost and memory rows for 6- and 12-month horizons and remove the stale Open Question.

### M6. Marking semantics for the add-client page are unresolved

**Scope:** 70-72, 337-341 vs Stage 1 `client-query.system.ts` (line 652) and Risks. **Source:** design-1-4.

Goal 1 says the three copies are deleted and CUJ 6 says marking is identical everywhere. Stage 1 says `nameSegments` stays if the add-client page's word-start rule differs from "anywhere". Decide in the spec: the shared matcher takes a mode, or the behaviour changes and the doc says so.

### M7. The listener case is argued against a strawman, and the 20-minute detach is unproven

**Scope:** 369-371, 385-394, 604-609. **Source:** design-1-5, style-1-7.

- The doc compares the listener only with "reload after every write" (a path the code does not take) and the changed-since cursor. It never evaluates keeping the one-shot read and refreshing it on sheet open when older than N minutes (about US$0.003 a load by the doc's own figure).
- Row 370 justifies the re-read after a 20-minute detach with "Firestore would bill that re-read anyway for a listener off over 30 minutes". That holds only beyond 30 minutes. In the 20 to 30 minute band the detach adds a 4,800-document re-read that Firestore would not have billed, which also contradicts Goal 4. The 30-minute behaviour is asserted without a source.
- With `persistentLocalCache` the SDK keeps the target and resume token, so the detach may save nothing.
- Lines 389-390 refer to "the original reason for avoiding a listener" without saying where it is recorded (`staff-day.store.ts:1773-1778`).
- Suggested direction: add the refresh-on-open alternative with numbers, verify billing in the emulator or a real project before fixing the 20-minute figure, or drop the detach. State the cost trade-off in the band explicitly.

### M8. The add-client page shares the window, and the cost model omits it

**Scope:** 51-60, 212-247, 361, 363-371, 481-489. **Source:** design-1-6.

`ensureWindow()` is called from the add-client page (`staff-dashboard.ts:3912`), and «Скорошни» reads the same pool. The read table lists only the search sheet as a trigger. It also does not say that «Скорошни» keeps its "nearest to now" meaning over a wider range. Add this use to the architecture, the read table and the reuse table. (Line 54-60 also says `reloadSearchPool` has one caller; there are two, `openSearch` and `ensureWindow`.)

### M9. "Search older" is underspecified

**Scope:** 77-79, 177-183 (CUJ 5), 135-138, 371. **Source:** design-1-7, plus the reuse question raised in the zoom-out report.

- A visit about 200 days back takes about 3 taps (60 days per step), but CUJ 5 implies one.
- Each step reads a full range whether or not anything matches (about 2,400 documents) and gives no cap.
- "Beginning of the data" has no detection rule; an empty 60-day range does not prove nothing older exists. Merged older data is not live and goes stale. What happens to it on re-attach is not stated.
- Resolve the Open Question about using the client card's paged history, which is client-scoped and cheaper.

### M10. The location-scope and role claim has no support

**Scope:** 107-110, 357-359, 392-398. **Source:** design-1-8.

"Nothing outside the shop's own location scope is read" is unsupported. The queries are `where('utcEpochMs', …)` ranges with no `locationId` filter, and adding one would need a composite index, which the doc rules out (257-258). `firestore.rules:297` lets every barber, receptionist and admin read every appointment. State that the search reads the whole collection for the permitted roles, including that a barber will search all barbers' clients' phones and e-mails, or add the constraint and its index.

### M11. Filter-hint parsing cannot be done by the system as described

**Scope:** 237-243, 281-283, 314-318, 326-336. **Source:** design-1-9.

`SearchQuerySystem.read(raw, callingCode, names)` is a pure system in `@core/systems` and must recognise `barber:`, `бръснар:`, `service:` and `status:отказан`. The text says key names and status names "live in the words table, not the system", and a system cannot import presenter words (Law 8 and Law 10). Resolving `status:отказан` against locale words is wording, not a domain decision. Define what `names` contains, who supplies it, and where the locale lives.

### M12. The phone-reading table has gaps and conflicts with Goal 2

**Scope:** 73-76, 292-299, 488; Stage 2 (675). **Source:** design-1-10, structural-1-13, style-1-12.

- Exactly 3 unprefixed digits has no row ("under 3: none", "4+ digits: bare"). Goal 2 says digits with no prefix "still match any part of the number" with no length threshold.
- A bare run starting `359` is not separated from a genuine foreign run starting 359.
- Line 488 says the client directory (`searchUsers`) will use this reading, but it queries a server-side prefix index and cannot do "the run anywhere".
- The `044…` Open Question is answered inside the question. Make it a decision row, and say what each caller (sheet, add-client, directory) does with the fallback.

### M13. How text terms and the phone reading combine is not specified

**Scope:** `SearchFilterSystem.keep` and `SearchQuerySystem.read` (§2). **Source:** comprehension report, finding 1 (carried here as a cross-check, not a Stage 7 reviewer finding).

For `088 333` the terms are `088` and `333` plus a phone reading. If ANDed, `088` matches nothing stored as `+359 88 333 4455` and CUJ 1 fails. The mixed query `Иван 088` is also undefined. This was a Blocker in the Stage 6 report and stays open until the doc is edited.

### M14. Performance claims are unmeasured, and the index rebuild policy is unclear

**Scope:** 493-497, 530-533, 320-325. **Source:** style-1-6, design-1-18.

- "A few milliseconds", "buys nothing a staff member would notice" and "a few megabytes" have no basis, and the spec asserts operation counts, not wall time (495-496), so nothing checks them. Give a figure and how it is measured, or soften to "expected".
- Lines 532-533 cite the repo's greenfield stance as favouring fewer systems. CLAUDE.md §0 says only "no backward compatibility, no schema deprecation duty".
- The index is "rebuilt only when the window changes (a listener batch)". Any appointment change on any device rebuilds about 4,800 visits × 8 folded fields, and a rebuild during typing can shift results. State a budget, or make the update incremental (Stage 4 already adds `patch`; see N7).

## 🟢 Nits

### N1. Date filter has no entry point

**Scope:** 82-86, 407-415. **Source:** design-1-20. Goal 5 promises "a chosen day or range"; the mock offers Today, Tomorrow and This week, and there is no date picker or DS element for one. Add one or drop it from the goal.

### N2. Recents and sign-out

**Scope:** 506-508, 456-458. **Source:** design-1-19. Recents (client names and numbers) sit in `localStorage` keyed by origin, not user. "Cleared on sign-out" names no hook, and session expiry, revocation and a shared tablet are not covered. Name the hook, consider keying by uid, set a retention limit.

### N3. Mark token and the accent-wash rule

**Scope:** 120, 467-476, 585-591, 658. **Source:** design-1-17, structural-1-16. The mark is accent at twice `--sys-alpha-segment-selected` (28% light, 40% dark). `styling-conventions.md` says a tone wash is the tone at `--sys-alpha-tint`, and exceptions go in `docs/design-research/decisions.md`. State how the deviation is recorded (the ADR path is `docs/architecture/decisions/`, line 752), and that the mark joins the `WASHES` list in `accent-rule.spec.ts` with a dark-mode contrast expectation. The Stage 1 row should name `accent-rule.spec.ts`, not "`accent-label.spec.ts`'s neighbour".

### N4. Layering sentence

**Scope:** 255-256, 213-218, 511. **Source:** design-1-15, structural (Passes note). "Only the store touches Firestore and `localStorage`" should say the store calls the ports. "components → systems → ports → store" at 511 reads as if systems feed ports, which is misleading under Law 8.

### N5. E.164 citation

**Scope:** 287-290. **Source:** design-1-16. The trunk-prefix convention comes from the national plan and E.123; E.164 defines the international format. Cite the code instead.

### N6. Spec/Detailed contradictions

**Scope:** 326-336, 320-324, 440-449, 493-495 vs Detailed 719-722, 729, 752. **Source:** structural-1-15, design-1-18 and the design critic's contradiction list.

- `facets(index, kept)` (§2) vs `facets(index, read, filters)` (Stage 4). A `kept` set already has the filters applied, so they cannot be lifted from it.
- "Rebuilt only when the window changes" vs the incremental `patch` in Stage 4.
- `byLocalDate` with `dayOffset` (§4) vs `VisitGrain.Day` with `dayBucketOf` (Stage 4).
- `uiTokens` / `uiTokenRemove` (§4) vs the added `uiTokenActivate` (Stage 5).
- Stage 4 lists the "window" system, but Stage 3 creates `search-window.system.ts` (689).
- Cap flag `windowTruncated` (354) vs `capped` (691).

### N7. Systems and sections organisation

**Scope:** 281-342, 344, 454. **Source:** structural-1-7. §2 "Reading what was typed" also holds `SearchIndexSystem`, `SearchFilterSystem` and `TextMatchSystem`. `SearchWindowSystem` and `SearchRecentsSystem` appear inside other sections' prose. Rename the heading or list the systems in one place.

### N8. Rejected options outside Alternatives, and missing "Reopen if"

**Scope:** 385-388, 135-138, 519-523. **Source:** structural-1-8, structural-1-9. "Re-read after every write" is rejected in §3 prose and "open the client card for older" sits in Open Questions. Move them to Alternatives. The intro promises a "Reopen if" for every option, but only A, B, E, H and J have one (C, D, F, G, I, K do not).

### N9. Heading and numbering scheme

**Scope:** 109-138, 195, 197, 210, 491. **Source:** structural-1-10. "Decisions" and "Open Questions" sit before the CUJs and refer forward. The H2 is "Technical Plan (Architecture)" where the standard says "Proposed Architecture". Unnumbered H3s sit among numbered ones used for cross-references.

### N10. Code fences and diagram

**Scope:** 212-247, 266-275, 402-428, 454-457, 459. **Source:** structural-1-11, structural-1-12. Two fenced blocks lack a language tag. The diagram omits `SearchRecentsSystem` and draws `Win2 --> FS`, which implies a system touches Firestore. §4 says "three states" but the wireframe labels two regions (the empty state is in a bullet), and Stage 5's VM lists IDLE|RESULTS|EMPTY. "Chip present, empty text" has no defined state.

### N11. Terminology and glossary

**Scope:** 167, 417-420, 158-159, 447-449, 464. **Source:** structural-1-14, style-1-14, style-1-15. «Барбър» (CUJ 3) vs «Бръснар» (wireframe). CUJ 2 omits the Service group the wireframe shows. Chip / token / `ui-search-token`, and window / pool / search pool, visit / appointment, each name one thing in several ways. Bulgarian strings are not glossed, and internal symbols (`pool`, event head, `ReadGuard`) have no glossary. "a labelled `ul`/`ol` group" should pick one element.

### N12. Function naming around the phone reading

**Scope:** 74, 121, 204, 304. **Source:** style-1-13. D6 says `phoneAsTyped` becomes a caller of `PhoneSystem`; line 304 says `ClientQuerySystem.phoneInternationalDigits` calls it; line 204 treats `phoneInternationalDigits` as the existing reading. Say which function is deleted and which delegates.

### N13. Wording

**Scope:** 12, 22-23, 44, 62-63, 66, 199, 376-383, 388, 556-557, 532. **Source:** style-1-9, style-1-10, style-1-16. Subjective or rhetorical phrases: "small and plain", "looks like a different app", "The trade is plain", "The obvious fix", "a count is not a promise", "nobody has to know it", "the service's ranking power buys nothing", "joining pieces", "reads a typed number correctly". Replace with the measurable fact, for example "reads `0…` as a trunk prefix".

### N14. Redundant table rows

**Scope:** 363-371, 366-367, 80-82. **Source:** style-1-11. Rows 367 and 368 both say zero reads on reopen; Goal 4 repeats it.

### N15. Source of the "40 visits a day" figure

**Scope:** the cost model (363-383). **Source:** comprehension report, finding 18 (not a Stage 7 finding). The "40 visits a day, 3 to 5 chair shop" figure is attributed to a code comment, not to data.

### N16. One more factual correction

**Scope:** 54-60. **Source:** design-1-14. See M8: `reloadSearchPool` has two callers.

## Traceability matrix

| Raw finding     | Severity | Consolidated |
| --------------- | -------- | ------------ |
| design-1-1      | Blocker  | B1           |
| design-1-2      | Major    | M5           |
| design-1-3      | Major    | M1           |
| design-1-4      | Major    | M6           |
| design-1-5      | Major    | M7           |
| design-1-6      | Major    | M8           |
| design-1-7      | Major    | M9           |
| design-1-8      | Major    | M10, B2      |
| design-1-9      | Major    | M11          |
| design-1-10     | Major    | M12          |
| design-1-11     | Major    | B2           |
| design-1-12     | Nit      | M3           |
| design-1-13     | Nit      | M4           |
| design-1-14     | Nit      | M8, N16      |
| design-1-15     | Nit      | N4           |
| design-1-16     | Nit      | N5           |
| design-1-17     | Nit      | N3           |
| design-1-18     | Nit      | M14, N6      |
| design-1-19     | Nit      | N2           |
| design-1-20     | Nit      | N1           |
| design-1-21     | Nit      | B2           |
| structural-1-1  | Blocker  | B2           |
| structural-1-2  | Major    | M1           |
| structural-1-3  | Major    | M2           |
| structural-1-4  | Major    | M3           |
| structural-1-5  | Major    | M5           |
| structural-1-6  | Major    | M4           |
| structural-1-7  | Nit      | N7           |
| structural-1-8  | Nit      | N8           |
| structural-1-9  | Nit      | N8           |
| structural-1-10 | Nit      | N9           |
| structural-1-11 | Nit      | N10          |
| structural-1-12 | Nit      | N10          |
| structural-1-13 | Nit      | M12          |
| structural-1-14 | Nit      | N11          |
| structural-1-15 | Nit      | N6           |
| structural-1-16 | Nit      | N3           |
| style-1-1       | Major    | M4           |
| style-1-2       | Major    | M4           |
| style-1-3       | Major    | M2           |
| style-1-4       | Major    | M1           |
| style-1-5       | Major    | M3           |
| style-1-6       | Major    | M14          |
| style-1-7       | Major    | M7           |
| style-1-8       | Major    | M5           |
| style-1-9       | Nit      | N13          |
| style-1-10      | Nit      | N13          |
| style-1-11      | Nit      | N14          |
| style-1-12      | Nit      | M12          |
| style-1-13      | Nit      | N12          |
| style-1-14      | Nit      | N11          |
| style-1-15      | Nit      | N11          |
| style-1-16      | Nit      | N13          |

Items M13 and N15 come from the Stage 6 comprehension report, not from a Stage 7 reviewer, and are carried here so they are not lost when the doc is edited. Two structural passes had no finding: heading hierarchy (no level skips) and the cost arithmetic (4,800 × $0.06 / 100k ≈ $0.003; $0.45 and $1.80 a month), which the structural critic checked.
