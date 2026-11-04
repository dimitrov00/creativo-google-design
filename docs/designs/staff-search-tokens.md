# Schedule search — keyed filter tokens and the filter dropdown

Status: built 2026-11-04 · Supersedes part of
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
- The whole token is one button. Pressing it opens the dropdown on that
  kind's values: each has a check mark, a press toggles it, and a destructive
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
keeps a minimum width (6 em), so it drops to its own line rather than
shrinking to a few letters. With tokens in the field the placeholder shortens
to «Търси…», which fits that width.

### The dropdown (≙ GitLab filtered search)

While focus is in the field or in the dropdown, a list hangs under the field
on the elevated surface, opaque. The menu's thick material was tried first
and dropped: the pinned band already blurs what is behind it, which makes it
a backdrop root, so a blur nested inside it samples only the band and the
results read straight through. The list covers the results and leaves the
field where it was. It has three modes:

| Mode      | When                             | Rows                                                                                                                                                               |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FIELDS`  | nothing typed, no key chosen     | «Филтрирай по»: Кога, Бръснар, Услуга, Статус, С бележка — only the kinds that still narrow (`SearchFilterSystem.suggestions`)                                     |
| `VALUES`  | a key chosen, or a token pressed | that kind's values, faces for barbers; typing filters them; ✓ on chosen values; «Махни филтъра» when the kind is held                                              |
| `MATCHES` | text typed, no key chosen        | the values with a word starting with the text (at most five), each with its key as detail («Нико Димов · Бръснар»), then the keys the text names («бръ» → Бръснар) |

- Picking a key in `FIELDS` puts a half-built token before the caret: the
  key, and a value segment that says «избери…» in placeholder ink, so the
  token already has the shape it will keep. The text beside it shows no
  placeholder of its own. The list switches to the key's values, and
  Backspace on the empty text drops the half-built token.
- Picking a value from a half-built token adds the filter and returns to
  `FIELDS`. Picking it from a pressed token toggles it and keeps the list open.
- «С бележка» has no values: picking the key adds the filter.
- Pressing a token while text is typed PARKS the search: the input empties,
  the text typed then narrows the token's values, and the search comes back
  when the values close (Escape, a press outside, the filter removed). The
  visits under the list do not jump while a filter is being changed.
- Typing narrows the list rather than standing beside it (owner, 2026-11-05:
  "when you type the filters below should disappear"). Only the values and
  the keys whose name the text starts a word of stay; a text that names
  nothing leaves no list, and the results are all there is. Picking a matched
  value or key TAKES the text, because the text was naming it, so what is
  offered is what would narrow the search without the text. A value is
  matched where a word of its name starts (the add-client page's rule), so
  «ни» offers «Нико», not «Потвърдени». To add a filter after typing a
  search, type the key's name, or clear the text.
- The list hangs a clear gap (`--sys-space-compact`) under the field, so it
  reads as its own surface and not as the field's lower half.
- Escape closes the month first, then the open key, then the list; a press
  outside or opening a card closes it. ↓ from the field lands on its first
  row; with the list closed, on the first card. Return with a key open picks
  its first value.

### «Кога»: preset, day or range

`VALUES` for «Кога» lists the presets that reach a visit: Днес, Утре, Вчера,
Тази седмица (today and the next six days) and Последните 7 дни (the six days
before today and today). Two more rows sit under the presets:

- «Конкретна дата…» opens the month picker inside the list. One press sets the
  span to that day.
- «Период…» opens the same picker. The first press sets one end, the second
  sets the other, and the earlier day becomes the start. The caption under the
  picker says which end it waits for.

`SearchWhenPreset` gains `YESTERDAY` and `PAST_WEEK`. `SearchFilterSystem.whenOf`
and `presetOf` know them, so a token reads «Вчера» only while it is yesterday.

### The chip fill (design system)

`ui-chip` painted the opaque `--sys-color-surface-secondary`. On a sheet it
read pasted on, and on the elevated dropdown it nearly vanished (the two
greys are a step apart in dark). It now paints the translucent control fill
(`--sys-color-fill`), as every field does since 2026-09-17. This changes every
unselected chip in the app, not only the search's.

### The idle sheet

The «Предложения» section leaves the sheet body, because the dropdown is now
where filters come from. The idle body keeps «Скорошни». The field takes focus
when the sheet opens, so the keys show at once, as Spotlight does.

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

## Where it lives

| Layer      | File                                                                       | Change                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| components | `search-when-preset.data.ts`                                               | `YESTERDAY`, `PAST_WEEK`                                                                                                                                                                       |
| systems    | `search-filter.system.ts`                                                  | the two presets in `whenOf`, `presetOf`, `suggestions`; `spanOf` (two picked days → a span)                                                                                                    |
| DS         | `ui-search-field`                                                          | segmented tokens (`key`, `value`, `faces`), `uiTokenActivate`, `uiActiveToken`, the dropdown slot (`uiDropdownOpen`), focus reported for the whole field, `aria-controls` from the input, wrap |
| feature    | `staff-search.vm.ts`, `staff-search.presenter.ts`, `staff-search.words.ts` | `TokenVm`, `SearchDropdownVm` with its three modes, the calendar state; the body suggestions removed                                                                                           |
| feature    | `staff-search-sheet.*`                                                     | the open key, the calendar mode, the dropdown template, autofocus                                                                                                                              |
| i18n       | `bg.json`, `en.json`                                                       | the key words, the dropdown headings, the new presets, the calendar captions                                                                                                                   |
| DS         | `ui-chip`                                                                  | the rest fill is the translucent `--sys-color-fill`                                                                                                                                            |
| showcase   | `pages/controls/search-field`                                              | keyed tokens, a token being built, wrapping, a dropdown                                                                                                                                        |
