# charts

`@creativo/ui/charts` — the chart kit of the staff analytics screen
(`docs/designs/staff-analytics-v2.md` «Chart kit»): hand-drawn SVG and CSS over
the design-system tokens, chosen by
`docs/design-research/staff-analytics/chart-library-survey.md`. Nx project
`charts`, tags `scope:shared, type:ui`, selectors `ui-*`.

Every input is a plain display struct a presenter built. The kit **decides
nothing and formats no number**: which parts a bar has, their values, their
order, which bar is highlighted, the average, and every printed figure arrive
decided and worded (`uiValueText`, `uiAverageText`). `type:ui` cannot import
ecs-core, so the kit has its own part vocabulary, `UiChartPart`, which the
feature's presenter maps its tags to.

## Elements

### `ui-bar-chart`

| Input              | Type                                                                                   | Default      |
| ------------------ | -------------------------------------------------------------------------------------- | ------------ |
| `uiBars`           | `readonly { label: string; parts: readonly { part: UiChartPart; value: number }[] }[]` | required     |
| `uiOrientation`    | `'vertical' \| 'horizontal'`                                                           | `'vertical'` |
| `uiStacking`       | `'stacked' \| 'single'` — `single` draws the bar's total as one mark on its first part | `'stacked'`  |
| `uiRanked`         | `boolean` — largest first (stable); a pick still reports the index in `uiBars`         | `false`      |
| `uiHighlightIndex` | `number \| null` — that bar in the accent, every other in the 48 % grey                | `null`       |
| `uiValueText`      | `readonly string[]`, one pre-formatted figure per bar                                  | `[]`         |
| `uiLabel`          | `string` — the drawing's accessible name                                               | required     |

Output `(uiBarPicked)`: the bar's index in `uiBars`, on tap, Enter or Space.
Content slot `[uiChartLegend]` under the drawing.

Vertical: the words along the baseline, each bar `(width ÷ n) − 2 px` wide,
the plot 120 px tall. Horizontal: a row per bar — the word and the value text
on the line above the bar, the bar 12 px thick across the width. Marks: 4 px
rounded data ends (`clip-path: inset(… round …)` on the bar's marks), 2 px of
surface between parts and between bars, a 1 px `--sys-color-separator` edge. A
bar's length and its place in the stack glide on the registered properties
`--ui-bar-size` / `--ui-bar-offset` after the first frame.

### `ui-line-chart`

| Input           | Type                                                                      | Default  |
| --------------- | ------------------------------------------------------------------------- | -------- |
| `uiPoints`      | `readonly { label: string; value: number; comparison: number \| null }[]` | required |
| `uiAverage`     | `number \| null`                                                          | `null`   |
| `uiValueText`   | `readonly string[]`, one per point; the last is printed at the right edge | `[]`     |
| `uiAverageText` | `string \| null`, printed on the average rule at the right edge           | `null`   |
| `uiLabel`       | `string`                                                                  | required |

One accent line (2 px, straight segments), the comparison as a grey line
behind it (`data-part="comparison"`; a `null` breaks it), a dashed rule at the
average, 8 px markers in a 2 px surface ring on the first and last points,
right-edge labels only. The box is 5 : 2 (`aspect-ratio` in the stylesheet,
the viewBox at the same ratio over the measured width). A changed path
cross-fades after the first frame. `uiAverageText` is not in the design's
table: the kit formats no number, and the design asks for the average's label.

### `ui-heatmap`

| Input       | Type                                                                     | Default  |
| ----------- | ------------------------------------------------------------------------ | -------- |
| `uiRows`    | `readonly string[]`                                                      | required |
| `uiColumns` | `readonly string[]`                                                      | required |
| `uiCells`   | `readonly { row: number; column: number; value: number; max: number }[]` | required |
| `uiLabel`   | `string`                                                                 | required |

A CSS grid; each cell with data sets `--ui-cell-strength` (value ÷ max,
0 … 1) and `charts.css` tints it on the accent at 10 % + 90 % × strength; a
cell without data is the control fill. Row and column words are ink.

## Geometry

`src/lib/geometry/`: `linearScale(domain, range)` (a flat domain maps to the
range's start), `zeroExtent(values)` (`[0, max]`, nulls skipped), `px(value)`
(a hundredth of a pixel), `linePath(points)` (straight segments, `null` breaks
the line), `stackOffsets(values)` / `stackTotal(values)` (negatives count as
0). Pure, over plain numbers, specified beside each file. The width comes
from `elementWidth()` in `@creativo/ui/layout` (`0` where `ResizeObserver` is
absent; the kit then draws at 320).

## Colour

CSS only, in `src/lib/charts.css`, imported by every element's stylesheet. A
mark carries `data-part`; the sheet sets `--ui-chart-paint` per part and the
marks read it as `fill` or `stroke`, never `color`. `.ui-chart-swatch` paints
the same disc in HTML for a legend row.

| `UiChartPart`                    | Paint                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `worked`, `online`               | `--sys-color-accent`                                                            |
| `no-show`                        | `--sys-color-destructive`                                                       |
| `unmarked`                       | `--sys-color-warning` under a diagonal hatch of the surface (`#ui-chart-hatch`) |
| `blocked`                        | `color-mix(in srgb, var(--sys-color-foreground) 76%, transparent)`              |
| `unsold`, `staff`                | … 62 %                                                                          |
| `other`, `unknown`, `comparison` | … 48 %                                                                          |

Every SVG part has a 1 px `--sys-color-separator` edge. The heatmap's ramp is
the accent at 10–100 %.

**The ramp is 76 / 62 / 48 %, not the design's 50 / 32 / 18 %.** A mark has to
clear 3:1 on the page and on the card (SC 1.4.11), and on white the
foreground reaches 3:1 only from 46 % up (32 % reads 2.09:1, 18 % 1.48:1). The
lightest grey is therefore 48 % and the other two step up by 14, which keeps
the design's direction (blocked heaviest, the time nobody bought lightest) and
every adjacent pair of parts ≥ 8 apart in OKLab × 100. The comparison line
takes the same 48 % for the same reason. `libs/ui/tokens/src/lib/chart-palette.spec.ts`
reads `charts.css` and pins these in both themes:

| Part (over page / card)               | Light                 | Dark                   |
| ------------------------------------- | --------------------- | ---------------------- |
| `blocked` 76 %                        | 8.74 / 8.74 (#4b4b4b) | 10.14 / 9.20 (#b4b4b4) |
| `unsold`, `staff` 62 %                | 5.25 / 5.25 (#6c6c6c) | 6.83 / 6.50 (#939393)  |
| `other`, `unknown`, `comparison` 48 % | 3.31 / 3.31 (#8d8d8d) | 4.35 / 4.40 (#727272)  |
| `worked`, `online`                    | 3.04 / 3.04           | 6.90 / 5.89            |
| `no-show`                             | 5.62 / 5.62           | 4.22 / 3.60            |
| `unmarked` (solid fill)               | 4.24 / 4.24           | 7.35 / 6.28            |
| hatch line on the fill                | 4.24                  | 6.28                   |

Adjacent pairs, OKLab × 100 (light / dark, on the page): worked · no-show
15.7 / 13.1; no-show · unmarked 13.3 / 18.3; unmarked · blocked ≈ 23 / 17;
blocked · unsold 11.3 / 11.2; unsold · other 11.9 / 10.7; online · staff
23.9 / 18.5; staff · unknown 11.9 / 10.7; comparison · accent 18.8 / 22.7.

## Accessibility

- Each drawing (`svg`, or the heatmap's grid) is `role="img"` with
  `aria-label` = `uiLabel`, one sentence the presenter writes.
- A bar is `role="button"` named by its word and its value text; the bars
  are one tab stop (roving `tabindex`), Arrow keys / Home / End move between
  them, Enter and Space pick.
- The line chart and the heatmap carry a `uiVisuallyHidden` table of every
  point / cell (`@creativo/ui/modifiers`), since their figures are not
  printed beside the drawing.
- Motion runs only after the first frame and never under
  `prefers-reduced-motion` (the global kill-switch plus the kit's own rule).

## Running unit tests

Run `pnpm nx test charts` to execute the unit tests.
