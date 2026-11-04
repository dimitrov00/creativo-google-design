# Schedule search — keyed filter tokens, searched at the thumb

Status: built 2026-11-04, moved to the bottom bar 2026-11-05 · Supersedes part of
[`staff-search-spotlight.md`](./staff-search-spotlight.md): decision B1
(“suggestions and chips only”), the removable-chip anatomy and the
«Предложения» section of the idle sheet.

## Why

The owner tried the built sheet against the dev seed and asked for four
changes:

1. The chip in the field did not read as the design system. It painted the
   opaque `surface-secondary` grey, while every control on a sheet paints the
   translucent fill (`--sys-color-fill`, the stacked-alpha lift).
2. A chip squeezed the text. «Тази седмица» left the placeholder clipped to
   «Име, телефон, имейл, ус», instead of the field growing a line.
3. The filters did not say WHAT they filter. GitLab and Jira show a filter as
   a key and a value («Author = @ivan»), and offer the keys in a dropdown
   while the field is focused.
4. The barber offers had no faces.

## What changes

### A token is one filter: key | value

A filter kind (`SearchFilterField`) is ONE token, never one chip per value. The
data already holds one filter per kind, with OR inside it, so the token is
the filter as stored:

```
[ Бръснар │ (Иван)(Стефан) Иван, Стефан ]   [ Кога │ Тази седмица ]
```

- The key segment («Бръснар») sits on the plain fill in the quieter ink
  (`--sys-color-secondary-label-on-fill`). The value segment sits on the value
  pill's stronger fill (foreground at `--sys-alpha-interactive`) in the primary
  ink. Both fills are translucent and stack over the field's own fill.
- Up to two values are named, then «+N». Barbers lead with their faces
  (`ui-avatar`, overlapping).
- The whole token is one button. Pressing it opens that kind's values: each has a check mark, a press toggles it, and a destructive
  «Махни филтъра» row sits last. **There is no ✕ on a token.** Backspace in an
  empty field still removes the last token, and says so.
- Tokens stand in the order their filters were added (`SearchQuery.withFilter`
  appends a new kind and merges a held one where it stands). Two searches
  with the same filters in a different order are still the same search
  (`SearchQuery.equals` compares a sorted key), so recents do not double up.
- The token being edited wears the focus ring. A token is never wider than
  the field minus the leading glyph: a long value ellipsizes beside the glyph
  rather than wrapping and leaving the glyph alone on its line.

### The field grows instead of squeezing

Tokens and the text wrap together, and the field grows a line. The text run
keeps a minimum width (4 em since 2026-11-05, so a half-built token fits beside it in a field that shares its row with the ✕), so it drops to its own line rather than
shrinking to a few letters. With tokens in the field the placeholder shortens
to «Търси…», which fits that width.

### The search at the thumb (≙ iOS 26 Mail and Photos, 2026-11-05)

The first build hung a GitLab-style dropdown under a field pinned at the top
of the sheet. The owner asked to move search to the bottom bar, "like Apple
Photos and Apple Mail", with the filter options as Photos shows its
suggestions and the suggestions as Mail lists them. The dropdown is gone from
this sheet (it stays a `ui-search-field` capability, shown in the showcase).

**The entry.** On a phone (the bottom bar under 600px wide) a field-shaped
button fills the bar between its leading controls and ＋, as Mail's search
field sits between the filter and compose: magnifier and «Търсене» in the
placeholder ink, a capsule. From 600px the toolbar's own search button
carries it instead, as Mail on an iPad keeps search at the top; each bar's
own width shows one (container queries, the same 600px the view segments
switch at). The bar's new `uiFill` slot (`ui-page-action-bar`) is what lets
a child take the room between.

**The sheet.**

```
 Търсене                         ← large title, stays (Photos' «Search»)
 Търси в предстоящи и минали…
 ПРЕДЛОЖЕНИЯ                     ← what the text names (Mail's Suggestions)
 (НД) Нико Димов        Бръснар
 Днес …                          ← the results
 ─────────────────────────────
 (Кога)(Бръснар)(Услуга)(Ста…    ← the keys as chips (Photos), sliding
 [🔍 Бръснар │ избери… ____] (✕) ← the field on the floor, Mail's ✕
```

- The DS field is pinned to the sheet's FLOOR (`uiPinEdge="bottom"`): the
  body's last child, floored by an auto top margin in a column, as a docked
  action bar is (`ui-modal-sheet` turns its scroller into a column for it).
  It lifts over the on-screen keyboard by what the visual viewport lost
  (`--ui-search-keyboard-inset`). The header is bare: the ✕ beside the field
  (`uiDismissLabel`) ends the search, and the grabber, Escape and the scrim
  still dismiss.
- The large title no longer folds: the field is not under it any more.

**What is suggested where.** Same three modes, laid out differently:

| Mode      | When                           | Chips over the field                                                   | Rows above the results                                                                                                             |
| --------- | ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FIELDS`  | nothing typed, no key open     | Кога, Бръснар, Услуга, Статус, С бележка — the kinds that still narrow | none (the recents, or the results)                                                                                                 |
| `VALUES`  | a key open, or a token pressed | none                                                                   | that kind's values, faces for barbers; typing filters them; ✓ on chosen values; «Махни филтъра» when held — the results step aside |
| `MATCHES` | text typed, no key open        | only the keys the text names («бръ» → Бръснар)                         | «Предложения»: the values a word of whose name starts with the text (at most five), each with its key                              |

- Picking a key puts a half-built token before the caret: the key, and a
  value segment that says «избери…» in placeholder ink, so the token already
  has the shape it will keep. The text beside it shows no placeholder of its
  own. Backspace on the empty text drops the half-built token.
- Picking a value from a half-built token adds the filter and closes the key.
  Picking it from a pressed token toggles it and keeps the values open.
- «С бележка» has no values: picking the key adds the filter.
- Pressing a token while text is typed PARKS the search: the input empties,
  the text typed then narrows the token's values, and the search comes back
  when the values close (a pick, Escape, the filter removed).
- Typing narrows the suggestions rather than standing beside them (owner,
  2026-11-05: "when you type the filters below should disappear"). A text
  that names nothing suggests nothing, and the results are all there is.
  Picking a matched value or key TAKES the text, because the text was naming
  it, so what is offered is what would narrow the search without the text. A
  value is matched where a word of its name starts (the add-client page's
  rule), so «ни» offers «Нико», not «Потвърдени». To add a filter after
  typing a search, type the key's name, or clear the text.
- A press on a chip or a suggestion keeps the keyboard up (the press does
  not take the focus).
- Escape closes the month first, then the open key (`uiEscapeClaimed`), then
  reaches the sheet, which ends the search. ↓ from the field lands on the
  first suggestion or card. Return with a key open picks its first value.

### «Кога»: preset, day or range

`VALUES` for «Кога» lists the presets that reach a visit: Днес, Утре, Вчера,
Тази седмица (today and the next six days) and Последните 7 дни (the six days
before today and today). Two more rows sit under the presets:

- «Конкретна дата…» opens the month picker over the values. One press sets the
  span to that day.
- «Период…» opens the same picker. The first press sets one end, the second
  sets the other, and the earlier day becomes the start. The caption under the
  picker says which end it waits for.

`SearchWhenPreset` gains `YESTERDAY` and `PAST_WEEK`. `SearchFilterSystem.whenOf`
and `presetOf` know them, so a token reads «Вчера» only while it is yesterday.

### The chip fill (design system)

`ui-chip` painted the opaque `--sys-color-surface-secondary`. On a sheet it
read pasted on, and on the elevated dropdown of the first build it nearly vanished (the two
greys are a step apart in dark). It now paints the translucent control fill
(`--sys-color-fill`), as every field does since 2026-09-17. This changes every
unselected chip in the app, not only the search's.

### The idle sheet

The old «Предложения» section of filter chips leaves the idle body: the keys
ride over the field now. The idle body keeps «Скорошни». The field takes
focus when the sheet opens.

## Not done (on purpose)

- **A client key** (`Клиент: …`). Typed text already finds a client by every
  name on the visit. A client filter would need a customer-id column in the
  search index and names that are not in the catalogue. It is a follow-up if
  typing proves not enough.
- **Typed `key:value` syntax.** Typing a key's name already offers the key
  (`MATCHES`), which covers the need without a parser.
- **A range drawn across the month grid.** The picker marks the chosen end and
  the caption names the span. Shading the days between needs a range input on
  `ui-month-picker`. Until a day is picked the picker marks today (it draws no
  month without a selected day).
- **The e2e journeys** (`apps/web/e2e/staff-search-sheet.spec.ts`) are
  updated, but not run locally while the dev server was up; CI runs them.
- **The keyboard lift on a real iPhone.** The band follows
  `visualViewport` and was checked in a desktop browser only; iOS Safari's
  panning when an input near the bottom takes focus has not been tried on a
  device.

## Where it lives

| Layer      | File                                                                       | Change                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| components | `search-when-preset.data.ts`                                               | `YESTERDAY`, `PAST_WEEK`                                                                                                                                                                                                         |
| systems    | `search-filter.system.ts`                                                  | the two presets in `whenOf`, `presetOf`, `suggestions`; `spanOf` (two picked days → a span)                                                                                                                                      |
| DS         | `ui-search-field`                                                          | segmented tokens (`key`, `value`, `faces`, `uiTokenPlaceholder`), `uiTokenActivate`, `uiActiveToken`, the dropdown slot, wrap; the floor (`uiPinEdge`, keyboard inset), `uiSearchAccessory`, `uiDismissLabel`, `uiEscapeClaimed` |
| DS         | `ui-page-action-bar`, `ui-modal-sheet`                                     | the `uiFill` slot; a scroller that floors a bottom-pinned search field                                                                                                                                                           |
| feature    | `staff-search.vm.ts`, `staff-search.presenter.ts`, `staff-search.words.ts` | `TokenVm`, `SearchSuggestionsVm` (its three modes, the key chips, the rows, the calendar state)                                                                                                                                  |
| feature    | `staff-search-sheet.*`                                                     | the open key, the calendar mode, the field on the floor, the chips and suggestion rows, autofocus                                                                                                                                |
| feature    | `staff-dashboard.html`, `staff-dashboard.chrome.css`                       | the field-shaped entry in the bottom bar on a phone; the toolbar button from 600px                                                                                                                                               |
| i18n       | `bg.json`, `en.json`                                                       | the key words, the suggestion headings, the new presets, the calendar captions, «избери…»                                                                                                                                        |
| DS         | `ui-chip`                                                                  | the rest fill is the translucent `--sys-color-fill`                                                                                                                                                                              |
| showcase   | `pages/controls/search-field`                                              | keyed tokens, a token being built, wrapping, chips above and a ✕ beside, a dropdown                                                                                                                                              |
