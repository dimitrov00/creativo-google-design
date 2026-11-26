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

## Fixed with the scan

- The showcase's icon-only buttons and its invalid text field had no name.
- The site header's language button was named «Смени език» while it draws
  the language code; its name now ends with the code.

## Owed — design-system elements

| Element                         | Rule                          | What is wrong                                                                                 |
| ------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `ui-bar-chart`, `ui-line-chart` | `nested-interactive`          | Focusable marks sit inside a drawing that is itself interactive.                              |
| `ui-bar-chart`                  | `aria-command-name`           | A bar is a command with an empty name.                                                        |
| `ui-search-field`               | `label`                       | With a token placeholder the input has no accessible name.                                    |
| `ui-search-field` tokens        | `label-content-name-mismatch` | A token's name does not contain the text it draws.                                            |
| `uiChip` remove button          | `label-content-name-mismatch` | Named «Премахни …», draws other text.                                                         |
| `ui-medal`                      | `label-content-name-mismatch` | With a value text, the name leaves out the drawn text.                                        |
| `ui-quick-actions`              | `label-content-name-mismatch` | An action with a count is named differently from what it draws.                               |
| `ui-scroll-column`              | `scrollable-region-focusable` | Over content with nothing focusable it cannot be scrolled from the keyboard in every browser. |

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

| Page                                                         | Rule                          | What is wrong                                                                                                    |
| ------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/staff/schedule`                                            | `label-content-name-mismatch` | The week strip's day buttons are named by an ISO date («2026-11-23») while they draw the weekday and the number. |
| `/staff/schedule`                                            | `list`                        | A list holds children that are not list items.                                                                   |
| `/staff/analytics/:card`                                     | `label-content-name-mismatch` | A barber row is named «Виж …» while it draws the name and the sum.                                               |
| Showcase demos (`scroll-row`, `streak-track`, `client-card`) | `label-content-name-mismatch` | A button's name does not contain the text drawn on it.                                                           |

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
