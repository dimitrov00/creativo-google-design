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

### Full screen, a capsule, and the filters out of the field (2026-11-05, later)

The owner used the floor build and asked for five changes. Looked up on
Mobbin first (iOS 26 Photos «Search», Mail search):

1. **A capsule field with a bigger glyph.** iOS 26 draws every search field
   as a capsule, the magnifier at the size of the ✕ beside it. `ui-search-field`
   is a capsule everywhere now (this changes the add-client page's field
   too), and its glyph is the control-glyph rung (20 px, `--ui-icon-medium`),
   the same one the ✕ button draws.
2. **Full screen, grown from the bar.** Photos' search is a page, not a
   sheet: the bar's search button grows into the field and the page comes
   up around it. `ui-modal-sheet` gains `fullScreen` (≙ `.fullScreenCover`,
   on `ui-sheet` as `uiFullScreen`): the surface fills the viewport, has no
   scrim, no rounding, no grabber and no drag, and its content owns its
   edges. The search opens and closes inside `runViewTransition` (the
   helper the frame's full screen and the view switch use), and the bar's
   entry and the page's field share the name `staff-search-field`, so the
   capsule GROWS into the field and back. The entry gives the name up while
   the search is open, so the two never hold it at once. On a wide screen
   the page keeps a drawer-wide column, centred.
3. **The filters float over the field, with their values.** The key │ value
   tokens leave the field (the DS keeps them for other screens). The chosen
   filters lead the chip row over the field, selected (the accent wash, the
   glyph orange, the words ink), each saying its VALUE — «10.11»,
   «(И) Иван, Стефан», «Потвърдени» — with the key's glyph; the keys still
   free follow, plain. Pressing a chosen filter opens its values, as the
   token did; the open one wears the ring. A key being picked stands in the
   row selected, saying its key, until a value is picked. Backspace no
   longer removes a filter: there is no token before the caret to remove.
4. **«Търси в „Бръснар“…».** With a key open the field's placeholder names
   it (Mail scopes a search the same way), and what is typed narrows that
   key's values. The matched rows under typed text keep their key beside
   them («Нико Димов · Бръснар», Mail's "via").
5. **The idle page offers before anything is typed.** Mail opens on
   «Suggestions» and «Recent Searches»; the page now opens on
   «Предложения» — Днес and Утре while the window reaches them, then the
   barbers who have visits in it, five rows at most
   (`SearchFilterSystem.starters`) — and «Скорошни» as rows with a history
   glyph.

### The bar's own floor, a card on focus, the typed run marked (2026-11-05, third pass)

The owner's third look, checked again against Photos and Mail on Mobbin:

1. **The floor is the page's bar, not a band of the field's.** The field
   drew its own pinned band on a translucent material. It now rides
   `ui-page-action-bar` — the bar the schedule's bottom row is — as its
   `uiFill`, the scroller's own last child: the house fade from the
   sheet's surface, no blur, no slab, the safe area, and the keyboard
   (`uiAvoidsKeyboard`, the visual viewport's lost height, moved out of the
   field into the bar). `ui-search-field` loses `uiPinEdge` and its band.
2. **The bar's rung.** The field and its ✕ are `uiControlSize="large"`,
   52 like the schedule bar's search capsule, filter and ＋.
3. **The keys are a card over the field, on focus (Photos).** Not a sliding
   row: a vertical stack of rows in the DS field's own dropdown, opened
   ABOVE the field (`uiDropdownPlacement="above"`) and hugging its rows at
   the leading edge, while the field has the focus. Escape puts the card
   away (after the month and an open key); typing or a new focus brings it
   back. The chosen filters stay as chips over the field. The card is the
   ＋ menu's segmented list (`ui-list-group` on the same popover recipe,
   which moved from `menu.css` into `list-group.css`, keyed on
   `data-popover-surface`) — but not a `ui-menu`: a menu is modal, takes
   the focus on open (the iPhone keyboard would close mid-typing) and
   swallows touches and scrolling behind it, where suggestions must let the
   results scroll while you type.
4. **Grouped by key.** The starters and the matched values stand under the
   key they belong to («Кога»: Днес, Утре · «Бръснар»: Иван, Нико), in the
   order the system gave them, instead of one «Предложения» list with the
   key trailing each row.
5. **The typed run is marked** in every suggestion — an open key's values,
   the matched values, the keys in the card — with `ui-marked-text`, the
   wash the result cards use.
6. **The open chip says what is typed into it**: «Кога: „ут“» (Mail scopes
   a search the same way).
7. **No ring on the chip.** HIG: an applied filter reads as selected — the
   tinted capsule (the accent wash, the glyph orange, the words ink, per the
   accent law) — and the open one needs no second mark: its values are the
   page.

### Glass under a bar's controls, and the filters wrap (2026-11-05, fourth pass)

- **A bar lends its controls a backdrop (design system).** The chips, the
  field and the ✕ painted their translucent fills straight over the
  results scrolling beneath, so letters read through them. A bar that
  content scrolls under (`ui-page-action-bar`, `ui-sheet-action-bar`) now
  sets `--ui-control-backdrop` (the thin material tier: blur and
  saturation), and the translucent FILL controls read it as their
  backdrop — bordered buttons, chips, text fields, the segmented track, a
  tokens frame (`modifiers.css`, «Floating chrome»). Their fills are
  unchanged, so the contrast each was tuned for holds. It is an
  environment, not a per-screen fix: the schedule's own bottom bar (the
  search capsule, the filter) gets it too, and every page and sheet bar
  after it.
- **Why only there.** A backdrop filter is a compositing layer re-sampled
  each frame the content under it moves, priced by area: worth it for the
  few 36–52px controls of a bar, wasted on a field in a form, where nothing
  moves behind it. Opaque (prominent, filled) and fill-less (plain)
  controls read nothing; a popover resets it (it is a material and a
  backdrop root of its own); a control's own material (`glass`,
  `uiMaterial`) wins (zero specificity).
- **The chosen filters wrap** (`ui-flow`) instead of sliding in a scroll
  row: every filter that narrows the search stays in view.
- **The rows above the results are segmented lists** (`ul[uiListGroup]`,
  the block editor's Repeat page grammar): one group per key, a held value
  wearing the app's one selection (`uiSelected`: the wash and the rounder
  corner) plus the ✓, «Махни филтъра» a group of its own, the recents one
  too.
- **A key's values keep their order**: a pick never moves a row under the
  thumb; a held value the window no longer offers follows the offered ones.
- **Every tap on a value applies and closes** (owner, 2026-11-05: "toggle
  for multiple, or apply on tap?"). As an iOS menu does even for its ✓
  items: an unticked value is added, a ticked one taken off, and the values
  close. Several barbers stay possible — the chip pressed again and another
  tapped — without a second rule for the same tap (the first pick used to
  close the list and later ones keep it open).
- **Several barbers are one group of faces** in the chip (`ui-avatar-group`,
  «+N» past three), the chip's face seat extended to a group in the DS.

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
- **Backspace removing a filter.** The filters are not before the caret any
  more; a chosen filter comes off from its own values («Махни филтъра»).
- **The keyboard lift on a real iPhone.** The band follows
  `visualViewport` and was checked in a desktop browser only; iOS Safari's
  panning when an input near the bottom takes focus has not been tried on a
  device.

## Where it lives

| Layer      | File                                                                       | Change                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| components | `search-when-preset.data.ts`                                               | `YESTERDAY`, `PAST_WEEK`                                                                                                                                                                                                         |
| systems    | `search-filter.system.ts`                                                  | the two presets in `whenOf`, `presetOf`, `suggestions`; `spanOf` (two picked days → a span); `starters` (an untouched search's offers)                                                                                           |
| DS         | `ui-search-field`                                                          | segmented tokens (`key`, `value`, `faces`, `uiTokenPlaceholder`), `uiTokenActivate`, `uiActiveToken`, the dropdown slot, wrap; the floor (`uiPinEdge`, keyboard inset), `uiSearchAccessory`, `uiDismissLabel`, `uiEscapeClaimed` |
| DS         | `ui-page-action-bar`, `ui-modal-sheet`, `ui-sheet`                         | the `uiFill` slot; a scroller that floors a bottom-pinned search field; `fullScreen` / `uiFullScreen` (≙ `.fullScreenCover`)                                                                                                     |
| DS         | `ui-search-field`                                                          | a capsule everywhere, the 20 px magnifier; `uiTransitionName` on the capsule; `uiControlSize`; `uiDropdownPlacement` (`above` hugs); the floor band (`uiPinEdge`) removed                                                        |
| DS         | `ui-page-action-bar`                                                       | `uiAvoidsKeyboard` (`--ui-keyboard-inset`)                                                                                                                                                                                       |
| feature    | `staff-day.store.ts`, `apps/web/src/styles.css`                            | the search opens and closes inside `runViewTransition`; the grow's timing (the pseudo-elements live on the root)                                                                                                                 |
| feature    | `staff-search.vm.ts`, `staff-search.presenter.ts`, `staff-search.words.ts` | `FilterChipVm` (was `TokenVm`), `SearchSuggestionsVm` (its three modes, the free key chips, the rows, the starters, the calendar state), the scoped placeholder                                                                  |
| feature    | `staff-search-sheet.*`                                                     | the open key, the calendar mode, the field on the floor, the chips and suggestion rows, autofocus                                                                                                                                |
| feature    | `staff-dashboard.html`, `staff-dashboard.chrome.css`                       | the field-shaped entry in the bottom bar on a phone; the toolbar button from 600px                                                                                                                                               |
| i18n       | `bg.json`, `en.json`                                                       | the key words, the suggestion headings, the new presets, the calendar captions, «избери…»                                                                                                                                        |
| DS         | `ui-chip`                                                                  | the rest fill is the translucent `--sys-color-fill`                                                                                                                                                                              |
| showcase   | `pages/controls/search-field`                                              | keyed tokens, a token being built, wrapping, chips above and a ✕ beside, a dropdown                                                                                                                                              |
