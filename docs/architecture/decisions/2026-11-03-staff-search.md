# The schedule search, part 1 — one highlighter, one phone reading, a window that reaches the horizon (2026-11-03)

> **Status: BUILT (stages 1 to 4 of part 1).** Part 2 (the Spotlight sheet,
> filters, event-card results) is `docs/designs/staff-search-spotlight.md` and
> is not built. The design is `docs/designs/staff-search.md` and its review
> reports are in `docs/designs/staff-search-review/`; this file is the record
> of what was decided and where the build differs from the design.

## Decisions

| #   | Question                       | Decision                                                                                                                                                                         |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | How far does search reach?     | Everything up to the booking horizon, and 60 days back, as date ranges on `utcEpochMs` with a cap of 3,000 visits a side. `SearchWindowSystem.rangeOf`.                          |
| A2  | How is the window kept fresh?  | Refresh on open: read again when older than 15 minutes or when this device wrote a visit. The old window stays on screen meanwhile. No listener.                                 |
| A3  | Which highlight style?         | The accent wash (`--sys-color-mark`, `ui-marked-text`) in every search. The ink-only marking of the dashboard search and the event head (2026-09-24, 2026-09-22) is superseded.  |
| A4  | Where does phone reading live? | `PhoneSystem.searchDigitsOf` (a `PhoneReading` component), with `readingMatches`, `readingRun` and `isNumberShaped`. The add-client lookup and the schedule search both call it. |
| A5  | What is in part 1?             | The highlighter, the phone reading, the window. Part 2 is separate.                                                                                                              |

## What was built, per stage

1. **Highlighter** (`d53f590c`). `TextMatchSystem` gained `segmentsAny`,
   `phoneSegments` and `fold`; `MatchMode` and `TextSegment` are components;
   `ui-marked-text` prints the runs. The three copies of the marking logic
   (`splitOnTerm`, `splitOnDigits`, `ClientQuerySystem`'s own loops) are gone.
2. **Phone reading** (`7cc1aa50`). `088 333` now finds `+359 88 333…` in the
   schedule search; the add-client page calls the same function.
   `SearchFieldsSystem.digitQuery`/`digitsMatch` are retired.
3. **Reach and freshness** (`fbe8c290`). `SearchWindowSystem`, the range
   port, the store's refresh on open, the two footnotes.
4. **Proof and records** (this change). The e2e spec, this record, the stale
   passages of the older docs, the ratcheted line caps.

## Cost model

Assumptions: a 3 to 5 chair shop books about 40 visits a day (the store
comment's old estimate); the default policy horizon is two months; the window
is 60 days back and about 60 ahead, so about 4,800 visits (about 8 times the
old 600). Firestore list price about US$0.06 per 100,000 document reads in the
default US region — to be checked against the project's region and the current
price sheet before launch.

- One window load: about 4,800 reads, about US$0.003.
- Loads happen only on an opening that finds the window stale (15 minutes, or
  a write on this device). A device that opens the sheet 50 times a day and
  finds it stale every time reads about 240,000 documents: about US$0.14 a day,
  about US$3 a month.
- Typing, filtering and reopening inside 15 minutes read nothing.
- Memory: about 1.5 MB for the window. One keystroke over 4,800 visits
  measured about 57 ms in the presenter spec (inside the 80 ms debounce).
- A longer horizon costs proportionally more; the window, the age and the cap
  are named values in `search-window.system.ts` for that reason.

## Alternatives, and what would reopen them

The design's Alternatives A to K (`docs/designs/staff-search.md`), each with the
reason it lost and the condition that reopens it.

| Alternative                                          | Rejected because                                                                                                                                                        | Reopen if                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A. A hosted search service                           | A second system to pay for, secure and keep in sync; copies clients' names, phones and e-mails to a third party; a linear scan of under 5,000 visits answers in ms      | One shop's searchable history passes about 50,000 visits, or typo tolerance and transliteration is required |
| B. A search-prefix index on the appointment document | Firestore tests "begins with", never "contains"; phone runs, e-mail local parts and notes would not work; every filter needs its own composite index; every write grows | The window cap is regularly hit (the "nearest 3,000" note appears in the logs)                              |
| C. A fixed count around now                          | A count does not follow the booking horizon (300 is a week, 3,000 about 75 days); a range follows it and the cap is only a safety valve                                 | The horizon is so long the cap is hit routinely (see B)                                                     |
| D. Query Firestore on each search                    | Every keystroke bills the documents returned                                                                                                                            | The window outgrows what fits in memory                                                                     |
| E. Rewrite the field's text in place                 | Fights the caret: backspace, IME composition and undo break                                                                                                             | The owner prefers it; then only for a whole-phone-shaped field, on blur, never mid-typing                   |
| F. Two highlight styles                              | The owner required one highlighter; two styles keep two code paths                                                                                                      | The owner reverses that requirement                                                                         |
| G. A "changed since" cursor                          | Appointments carry no generic `updatedAt`; it needs a new field on every write path and a new index                                                                     | Appointments gain an indexed generic `updatedAt`                                                            |
| H. Our own copy of the window in IndexedDB           | The SDK already persists documents (`persistentLocalCache`); a second copy needs its own invalidation                                                                   | The SDK cache proves too small to serve a refreshed window's first paint                                    |
| I. Re-read the whole window after every write        | Each write would bill the full window (about 4,800 documents)                                                                                                           | The shop's volume falls so far that a re-read per write is cheaper than anything else                       |
| J. A live range listener for the page session        | A new store, port bundle and adapter rewrite, a visibility timer and detach rule, a re-anchoring rule, partial-first-paint handling — to save a few dollars a month     | Staff need other devices' changes within seconds, or measured loads exceed about US$10 a month a shop       |
| K. A "search older" step in the sheet                | Each step reads 60 days whether or not anything matches; needs an end-of-data rule; the client card already has a paged, client-scoped history                          | Staff report that finding an old visit by name, without opening the client, is common                       |

The listener ruling recorded at `staff-day.store.ts` (a listener held open for
as long as a field has text is a second subscription over the whole
collection) is kept, not reversed.

## Where the build differs from the design

- **The mark is at twice the selection rung, not one.** A picked row is
  already washed at one rung, so a one-rung mark would vanish on it. The worst
  ink contrast on the mark is 13.05:1 in light and 6.93:1 in dark, both above
  the 4.6:1 floor; the "room to spare" floors in `accent-rule.spec.ts` were
  lowered to 13 and 6.9 for this one wash. Recorded in
  `docs/design-research/decisions.md`.
- **Footnote words** are `staff.day.searchTruncated` and
  `staff.day.searchStale`, beside the other search words (no `staff.search`
  namespace exists).
- **Invalidation lives in the store.** A landed booking, staff edit (move,
  reschedule, the visit sheet's save) or status change calls
  `invalidateSearchWindow()` there, not from the dashboard handlers.
- **Policy.** The horizon comes from a live `observePolicy` subscription in the
  store, not the first emission (which is the default policy).
- **Before the shop's zone is known** the range is read in UTC: a day of slack
  at the far edges, so the search never waits on the zone.
- **Lookup keys for `088 765`** are now asked as `35988765`, `088765` (the
  order flipped; the same two keys).
- **No per-load logging.** The web app has no log port token to inject; the
  design's observability bullet is open.
- **No seed visit 24 days ahead.** The dev seed keeps its hand-written visits
  within four days and fabricates busy days beyond; a far visit breaks that
  model. The e2e spec seeds its own.
- **CUJ 3 has no e2e.** It is the store's rule, pinned in
  `staff-day.store.spec.ts`.

## Verified, and not

- **Run, passing (2026-11-04):** `apps/web/e2e/staff-search.spec.ts` against the
  emulators (2 passed: the number found four ways with the wash painted, and a
  booking 24 days out found by name); the firestore adapter's emulator
  integration suite (390 passed), including the window case, which is the proof
  that the range queries need no new composite index — on the emulator, which
  does not enforce composite indexes, so `firestore.indexes.json` was reasoned
  over, not exercised.
- **Not done:** counting the document reads of one window load in the emulator
  UI's Requests tab; a check of the real Firestore price and region; the
  per-load logging (no log port exists on the web side).
