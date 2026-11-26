# Accessibility findings — first full axe scan, 2026-11-26

axe (WCAG 2.0–2.2, levels A and AA) now scans every showcase page and every
route of the web app, once per theme:

- `apps/showcase/e2e/accessibility.spec.ts` — each design-system element on
  its own page. The pages are read off the showcase's route table.
- `apps/web/e2e/accessibility.spec.ts` — each route the app declares. A
  route with no row fails the spec.

The gate is zero violations. What the first scan found and that change did
not fix is switched off **one rule on one page** in those two specs, each
with its reason. A row may only be removed: fix the element or the page,
delete its row here and in the spec.

axe sees what is on screen when it runs. It does not open a menu or a sheet,
and it does not judge keyboard behaviour.

## Fixed

With the scan (2026-11-26):

- The showcase's icon-only buttons and its invalid text field had no name.
- The site header's language button was named «Смени език» while it draws
  the language code; its name now ends with the code.

After it (2026-11-26):

- `ui-bar-chart` was `role="img"` over bars that are buttons, which hides
  the buttons from a reader. It is a named `group` now, and a bar with no
  word of its own takes the chart's name instead of an empty one.
- `ui-scroll-column` over static content could not be scrolled from the
  keyboard. It becomes a keyboard stop while it overflows with nothing
  focusable inside, exactly as `ui-scroll-row` does; the two share
  `keyboardScrollStop`.
- The schedule's week strip named each day by its ISO key («2026-11-23»).
  A day is named as a person says it («понеделник, 23 ноември»).
- The showcase's search field with a token placeholder had no name (the
  demo passed none — the element was not at fault), and its photo tiles
  were named without the date they draw.

Found on CI once the scan walked the landing page (2026-11-26):

- A landing shop row was a `role="button"` around its call and directions
  links. The shop's name is the button now, stretched over the row.
- The landing map's pins were buttons with no name, inside a map marked
  as a picture. A pin says which shop it opens; the map is a named group.
- A team card's label left out the title and specialty it draws. The card
  is named by its own text.
- A word in the success or the warning tone read 4.32:1 and 4.24:1 on
  white. Words read `--sys-color-success-label` and
  `--sys-color-warning-label` (5.7:1 and 6.3:1), as destructive words
  already read their own; fills, dots and glyphs keep the tone.

Found once the scan opened sheets and menus (2026-11-26):

- The landing's shop sheet marked its map as a picture while the map holds
  controls. It is a named group, as the page's own map is.
- A chosen list row's trailing detail stayed secondary grey — 3.47:1 on
  the wash in dark (today's hours in the shop sheet). A rule that should
  have lifted it to the primary ink was outranked; it now wins.
- The service sheet's «Запази час» button was labelled «Запази
  &lt;услуга&gt;», without the word it draws. It is named by its words.
- A working-hours day row was named day, hours, break while it draws day,
  break, hours. The name follows the drawn order.

## Decided — not faults

axe's `label-content-name-mismatch` compares the accessible name with every
glyph drawn inside a control. In these the only drawn text the name leaves
out is a picture, and every word a person would say is in the name. WCAG
2.5.3 is about label text, so these stand; the rule is off on their showcase
pages because axe has no narrower switch.

| Element                            | The picture it draws                                   |
| ---------------------------------- | ------------------------------------------------------ |
| `uiChip` with a person             | The avatar's initials.                                 |
| `ui-search-field` token with faces | The faces' initials, between the key and the value.    |
| `ui-medal`                         | Its monogram, its level numeral and its «ново» marker. |
| `uiQuickAction` with a count       | The count, as a badge before the word.                 |

Three more, decided when the overlays were scanned:

- **Separate blocks.** axe fails every labelled control that draws its
  words as separate blocks: it reads them as one run with no space
  («Бакшиши0,00 €») and looks for that run in the label. Measured on bare
  markup, three `div`s under a label of the same three phrases fail. The
  scan now judges each such finding again with the browser's own reading
  of the drawn text (`rejudgeNameMismatches` in
  `libs/shared/axe-scan`), and keeps it unless the label holds every drawn
  word, in order. Nothing drawn is forgiven, hidden from readers or not.
- **Chart marks.** An analytics card or bar that holds a chart draws the
  chart's own marks as text (an axis' two dates, a bar's count) and is
  named by a sentence that begins with its title and says the figures in
  words. The rule is off on `/staff/analytics` and
  `/staff/analytics/:card`.
- **The timeline's edge handles.** Each draws as a 20px pill and is pressed
  through a 44px area its `::before` lays over the bar. axe measures the
  element's own box, so `target-size` is off on the two sheets that hold a
  timeline.

## Colour — settled 2026-11-26

All through tokens; no literal colour was added.

| Where                                             | Was                                            | Now                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destructive prominent button, dark                | `on-primary` (near-black) on the red, 3.9:1    | `--sys-color-on-destructive` (white), 4.98:1. The button read the wrong token.                                                                             |
| Date pill with no day, dark                       | plain secondary ink on the value pill, 3.28:1  | `--sys-color-secondary-label-on-fill`, 5.26:1                                                                                                              |
| Choice tile's detail line, dark                   | plain secondary ink on the tile's fill, 4.38:1 | the same on-fill ink, 7.03:1                                                                                                                               |
| A quiet line in a chosen list row, dark (`/book`) | plain secondary ink on the accent wash, 3.47:1 | the chosen row re-points `uiForegroundStyle="secondary"` to the on-fill ink, 5.57:1                                                                        |
| Coupon detail chip on a hooked ticket, dark       | on-fill ink at a third, 4.36:1                 | the on-fill ink is 40% of the way to the foreground (owner, 2026-11-26): 4.72:1 here                                                                       |
| Coupon figure on a hooked ticket, light           | orange on grey, 2.62:1                         | ink. A consumer that lifts the paper off white sets `--ui-coupon-card-value-ink` (owner, 2026-11-26; the accent law: a display figure is orange on white). |

Not a fault: on `/staff/schedule` in dark, axe reports today's chosen number
at 1.12:1. The number is near-black on the orange disc (6.16:1, held by
`accent-label.spec.ts`), but the disc is a separate sliding marker, so axe
measures the number against the bar behind it. The rule stays off on that
page for this reason.

## Owed — pages

Nothing. The four faults the first full scan left were fixed on 2026-11-26,
and their waivers are deleted:

- **The schedule's blocked-time and break rows** were list items given
  `role="button"`, which stops them being list items, under a label that
  left out the length they draw. The list item now holds a real button,
  named by the words it draws. A row that is only read is a named group.
- **An analytics barber row** was labelled «Виж …» over a name and a sum
  drawn without that word. The label is gone; the row is named by its
  name, its detail line and its sum.
- **The showcase's streak tile and client-card tiles** were buttons named
  by a hand-written summary, with the drawn words hidden from a reader.
  They are named by the words they draw; the streak's full sentence is the
  track's own.

The rule these four share: **a control is named by the words it draws.** A
separate label is written only for a control that draws no words (an icon
button), or draws a picture a reader cannot use.

## What is scanned

- **Every route**, in both themes, by `apps/web/e2e/accessibility.spec.ts`.
  None is pending: onboarding, the analytics home, the staff profile and
  the two team detail pages joined on 2026-11-26.
- **What a tap opens**, in both themes, by the same spec's second table:
  the landing's menu and its barber, shop and service sheets; the
  onboarding country picker; the profile edit sheet; the schedule's
  calendar, view menu, search, status filter, add menu and its new visit,
  blocked time and working hours sheets; the analytics period menu, notes
  and custom range; the team add menu; a member's profile, period, hours
  and services sheets; a permission's value menu; the rhythm qualifier
  menu and protections sheet; the support lookup.
- **Inside a flow**, by the spec that drives it: the booking time sheet
  (`booking-core.spec.ts`), the appointment and its cancel sheet
  (`appointments.spec.ts`), the staff visit sheet and the privacy alert
  (`staff-client-privacy.spec.ts`), the client card.

## Not scanned yet

Overlays nothing opens under a scan, each needing a flow or data of its
own:

- `/book`: the bag, note and contact sheets, the seat menu, the service
  sheet's variant and barber menus.
- `/staff/schedule`: the menus and calendars inside the visit, create and
  block editors; the cancel sheet; the free-time and empty-slot menus; the
  scope menu, the fields and time-scale sheets; the zone, break-scope and
  discard alerts.
- `/admin/team`: the barber-account, add and role sheets and their
  questions; a member's link, shops and return sheets, booked-by menu and
  delete and release alerts; the account's remove alert.
- `/admin/loyalty/rhythm`: its other menus, sheet cases and the save
  alert. `/admin/programs`: the event's shop menu. `/support`: the read-as
  sheet. `/account/profile`: the photo menu. The landing's photo lightbox
  (the strip is hidden today).
