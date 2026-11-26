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

## Owed — colour (the owner decides)

| Where                                                 | Theme | Measured    | Needs |
| ----------------------------------------------------- | ----- | ----------- | ----- |
| Destructive prominent button: near-black words on red | dark  | 3.9:1       | 4.5:1 |
| Coupon card, hooked: orange value on the grey ticket  | light | 2.62:1      | 3:1   |
| Coupon card, hooked: the 11px detail line             | dark  | 4.35:1      | 4.5:1 |
| Date row: the placeholder value                       | dark  | 3.28:1      | 4.5:1 |
| Choice tile: the detail line                          | dark  | 4.38:1      | 4.5:1 |
| `/book`: a footnote line on the first step            | dark  | under 4.5:1 | 4.5:1 |
| `/staff/schedule`: today's number on the week strip   | dark  | under 4.5:1 | 4.5:1 |

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
