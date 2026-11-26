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

| Page                                           | Rule                          | What is wrong                                                                 |
| ---------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `/staff/schedule`                              | `label-content-name-mismatch` | A break row of the agenda is named differently from the words it draws.       |
| `/staff/schedule`                              | `list`                        | A list holds children that are not list items.                                |
| `/staff/analytics/:card`                       | `label-content-name-mismatch` | A barber row is named «Виж …» while it draws the name and the sum.            |
| Showcase demos (`streak-track`, `client-card`) | `label-content-name-mismatch` | A card that is a button is named by a summary that leaves out words it draws. |

## Not scanned yet

Each has a `pending` row in the web spec saying what it needs.

| Route                          | Why                                                                        |
| ------------------------------ | -------------------------------------------------------------------------- |
| `/onboarding`                  | Needs a session in the onboarding stage.                                   |
| `/staff/profile`               | Needs an account linked to a barber record.                                |
| `/staff/analytics`             | The bento keeps placeholder tiles for an owner seeded with no worked days. |
| `/admin/team/member/:barberId` | Needs a seeded barber record.                                              |
| `/admin/team/account/:userId`  | Needs a seeded account.                                                    |

Open sheets, open menus and the later steps of the booking, sign-in and
onboarding flows are scanned only where a spec that drives them calls
`expectNoAxeViolations` — today the client appointments page, the account
dashboard and the staff client card.
