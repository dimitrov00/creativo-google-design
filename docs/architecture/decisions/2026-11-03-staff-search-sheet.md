# The schedule search, part 2 — the Spotlight sheet: filters as chips, results as event cards (2026-11-03)

> **Status: BUILT (stages 1 to 3 of part 2).** Part 1 (the highlighter, the
> phone reading, the window) is `2026-11-03-staff-search.md`. The design is
> `docs/designs/staff-search-spotlight.md`; this file is the record of what was
> decided and where the build differs from the design.

## Decisions

| #   | Question                        | Decision                                                                                                                                                                                                             |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | How are filters entered?        | Suggestions and chips only. The typed `barber:` form and text that resolves to a filter are not built.                                                                                                               |
| B2  | What do suggestions show?       | The distinct barbers, services, statuses and date presets present in the text-matched visits, with each kind's own filter removed. No counts. A chosen value is not offered again.                                   |
| B3  | What is a date filter?          | A preset: Today, Tomorrow, or This week (today and the next 6 days), built by `SearchFilterSystem.whenOf(preset, shopNow)`. No picker.                                                                               |
| B4  | What does a result card show?   | `visitRowOf` as for the client card, plus one `StaffEventLine` (with marked parts) per field the query matched. The title stays the services and gets marked parts when a service name matched.                      |
| B5  | Where do recent searches live?  | `localStorage` on the device (`creativo.staff.search.recents`), last 8, de-duplicated, newest first. No Firestore reads or writes. Every access is in try/catch and every entry is validated by `SearchQuery.parse`. |
| B6  | How is the index kept current?  | Rebuilt whenever the window changes (a window load), not patched per visit: `SearchIndexSystem.build` is one linear fold into flat folded columns.                                                                   |
| B7  | Where does the sheet read from? | `StaffDayStore`'s window from part 1 (`pool`, `searchCapped`, `searchStale`, the refresh on open). No second store.                                                                                                  |

## What was built, per stage

1. **The pure systems** (`5b8bdfe6`). `SearchQuery` and `SearchFilter` as flat
   components; `SearchQuerySystem.read` (terms plus the phone reading through
   `ClientQuerySystem.parse`); `SearchIndexSystem.build`;
   `SearchFilterSystem.keep` and `suggestions`; `VisitListSystem.dayGroups`.
2. **The sheet** (`73a4b7b9`). `lib-staff-search-sheet` replaces the old sheet
   in the dashboard; `ui-search-field` gained `uiTokens`/`uiTokenRemove`;
   `UiChip` gained `uiToggle`; `visitRowOf` accepts matched lines and title
   terms; the presenter, view model and words of the sheet; device recents; the
   showcase page `controls/search-field`; `bg`/`en` words under
   `staff.search.*`. `staff-dashboard.ts` fell from 4,680 to 4,617 lines and
   its cap was lowered to match.
3. **Proof and records** (this change). The e2e spec
   `apps/web/e2e/staff-search-sheet.spec.ts` (four journeys), the seed helpers
   it needed (a barber, an e-mail and a note on a seeded visit), this record,
   the HANDOFF line.

## Alternatives, and what would reopen them

The design's Alternatives A to F (`docs/designs/staff-search-spotlight.md`),
each with the reason it lost and the condition that reopens it.

| Alternative                                        | Rejected because                                                                                                                               | Reopen if                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A. Typed filter syntax (`barber:…`)                | A feature people must learn; beside the menu it adds a parser, a key table and locale words that a pure system cannot hold (Laws 8 and 10)     | Staff ask for typed filters as a first-class entry                            |
| B. Counts beside suggestions                       | The hardest algorithm in the design (a facet's count over the text-matched set with its own filter removed) for a number printed beside a chip | Staff ask for counts, or a suggestion list is too long to choose from         |
| C. The agenda's own card as the result row         | It is template and CSS inside `staff-dashboard.html`, not a component; reusing it means first extracting it. `lib-visit-row` is already shared | The visual gap to `lib-visit-row`'s staff layout is judged too large          |
| D. Recent searches in Firestore, per staff account | Each save is a write and needs rules, for recents on a second device that a desk with one tablet rarely needs                                  | Staff share devices and need their own recents, or move between devices often |
| E. A date picker for a chosen day or range         | A new DS element and a stage of its own; the three presets cover the questions asked at a desk                                                 | Staff ask for arbitrary dates or ranges                                       |
| F. Patch the index per changed visit               | A second code path (including removals) to save a few milliseconds nobody would notice                                                         | A measured rebuild misses a frame budget on the slowest desk tablet           |

## Where the build differs from the design

- **Every card names its client.** A filter-only result (a barber chip with no
  text) would otherwise show no client. The client line is always printed,
  marked when the typed words found the client; the phone, e-mail and note
  lines appear only when the query matched that field.
- **No phone chip and no phone filter.** The design has no phone variant of
  `SearchFilter`, so the «Телефон +359 88 777» row under the field informs and
  does nothing when pressed.
- **No `uiTokenActivate`.** A chip is pressed to be removed. Barber and service
  values are listed as suggestions (all of them, each keeping a result) instead
  of opening a nested list from a chip.
- **The result list is capped at 200** (`SearchFilterSystem.RESULT_LIMIT`),
  with a footnote («Показани са първите 200 резултата. Стесни търсенето.»): a filter such as «Потвърдени»
  can match thousands of visits, and 200 event cards are already more than a
  desk reads.
- **`SearchFilterSystem.presetOf`** was added (the inverse of `whenOf`) so a
  chip says «Днес» only while its span is today, and a stale chip says the dates.
- **`suggestions` takes `shopNow`**, because the date presets are offered
  relative to the shop's today.
- **The store keeps `searching`, `openSearch`, `closeSearch` and
  `searchLoading`.** Only the typed-term state (`_term`, `term`, `setTerm`)
  moved into the sheet; the window and its refresh are unchanged.
- **`SearchFilter.bookingStatuses` is `filterBookingStatuses`.** The repo's
  lint refuses a `status` key (Law 6); the filter's field is domain-prefixed
  like every other.
- **Words.** The new words live under `staff.search.*`; `staff.day.searchLabel`,
  `searchScope`, `searchPlaceholder`, `searchEmpty`, `searchTruncated` and
  `searchStale` stay where part 1 put them and are still used.
- **Showcase.** `ui-search-field`'s token mode has its own showcase page,
  which the design did not list.
- **Data files are split** (`staff-search.vm.ts`, `.words.ts`, `.presenter.ts`)
  as Law 10 asks, where the design named one presenter file.
- **Seed.** No dev-seed visits were added. The dev seed already has what a hand
  check needs: all three barbers across today, tomorrow and the day after,
  clients with distinct e-mails (`kiril@test.local`, `georgi@test.local`, …)
  and a visit note («Къса отстрани»). Its visits stay within four days (see
  part 1), so the e2e seeds its own through
  `seedUpcomingAppointment(…, barberId)` and
  `setVisitContact(…, { email, note })`.

## Verified, and not

- **Run, passing:** the unit suites (systems, presenter in `bg` and `en`, the
  sheet, recents, the chip field, the shared visit row, the dashboard's
  integration cases), typecheck, lint, style lint, `verify-tools:layering`, and
  the `web`, `showcase` and `functions` builds.
- **E2E, passing (2026-11-04):** `apps/web/e2e/staff-search-sheet.spec.ts`
  against the emulators, 4 passed: a name and a number narrowing two visits of
  one name to one with the runs washed; the sheet opening without recents,
  keeping a picked search, restoring it and forgetting it; a barber chip
  narrowing the cards, not offered twice, coming off by its press and by
  Backspace; an e-mail found with its line marked. The seed guard
  (`e2e-appointment-seed.spec.ts`, 9 passed) still holds with the optional
  barber on the seeded body.
- **Dark mode, looked at (2026-11-04):** the chip field in the showcase's dark
  theme (`controls/search-field`): the field keeps its quiet fill and hairline,
  the white chips and their remove glyphs stay legible, the wrapped field's
  clear stays at the trailing edge.
- **Not done:** the sheet used by hand in the running app against seeded data
  (the e2e covers it through assertions).
