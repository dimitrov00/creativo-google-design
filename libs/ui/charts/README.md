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
on the line above the bar, the bar 12 px thick across the width. A word
longer than the room its figure leaves is ellipsized (`fitLabel`, an estimate of
7 px a glyph); the accessible name keeps it whole. Marks: 4 px
rounded data ends (`clip-path: inset(… round …)` on the bar's marks), 2 px of
surface between parts and between bars, a 1 px `--sys-color-separator` edge. A
bar's length and its place in the stack glide on the registered properties
`--ui-bar-size` / `--ui-bar-offset` after the first frame.

### `ui-line-chart`

| Input           | Type                                                                      | Default    |
| --------------- | ------------------------------------------------------------------------- | ---------- |
| `uiPoints`      | `readonly { label: string; value: number; comparison: number \| null }[]` | required   |
| `uiAverage`     | `number \| null`                                                          | `null`     |
| `uiValueText`   | `readonly string[]`, one per point; the last is printed at the right edge | `[]`       |
| `uiAverageText` | `string \| null`, printed on the average rule at the right edge           | `null`     |
| `uiLabel`       | `string`                                                                  | required   |
| `uiCurve`       | `'linear' \| 'smooth'` — `smooth` is a monotone cubic (`monotonePath`)    | `'linear'` |
| `uiArea`        | `boolean` — a wash under this period's line, 22 % at the top to 0         | `false`    |

One accent line (2 px, straight segments), the comparison as a grey line
behind it (`data-part="comparison"`; a `null` breaks it), a dashed rule at the
average, 8 px markers in a 2 px surface ring on the first and last points,
right-edge labels only. The box is 5 : 2 (`aspect-ratio` in the stylesheet,
the viewBox at the same ratio over the measured width). A changed path
cross-fades after the first frame. `uiAverageText` is not in the design's
table: the kit formats no number, and the design asks for the average's label.
`uiCurve="smooth"` draws both lines as monotone cubics through their points
(Fritsch–Carlson, d3's `curveMonotoneX`), so a curve never swings past a
point; `uiArea` fills under this period's line with an SVG
`<linearGradient>` (an id of its own per chart) from the line's paint at
22 % to transparent at the zero baseline. At their defaults the chart draws
exactly as before.

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

### `ui-radar`

| Input           | Type                                                                                   | Default  |
| --------------- | -------------------------------------------------------------------------------------- | -------- |
| `uiAxes`        | `readonly { label: string; value: number \| null; comparison: number \| null }[]`      | required |
| `uiLabel`       | `string`                                                                               | required |
| `uiValueText`   | `readonly string[]`, one pre-formatted figure per axis, printed outside its end        | `[]`     |
| `uiMissingText` | `string` — the word printed in a `null` axis's value slot («малко данни»)              | `''`     |
| `uiTone`        | `number \| null` — `0 … 4` paints the polygon in `--sys-identity-N`; `null` the accent | `null`   |

One polygon over `n` axes (five in the design, any count drawn), the first
axis straight up and the rest clockwise; a vertex at `value ÷ 100` of the
radius (clamped to 0 … 100), a `null` axis collapsed to the centre with its
axis hairline dotted and `uiMissingText` in its value slot. The polygon is
its paint at 18 % (`color-mix`) under a 2 px solid stroke; the comparison
is a dashed 1.5 px outline in the 48 % grey (`data-part="comparison"`),
left out when no axis has one; the guide rings at 50 % and 100 % and the
axes are 1 px `--sys-color-separator`. Each axis's word (ink) and its value
text (quiet ink) sit 8 px past the axis's outer end — not on the moving
vertex, so the words never collide with each other — anchored away from the
centre (`text-anchor` start / middle / end; stacked upwards above the
centre, hanging below it). The box is square (`aspect-ratio: 1`, the
viewBox over the measured width); the words take a 60 px band off the
radius, which never drops below a quarter of the width. A changed polygon
cross-fades after the first frame. The hidden table prints each axis's
word, its value text and its comparison figure as given (an index 0 … 100,
not formatted). `uiValueText`, `uiMissingText` and `uiTone` are not in the
design's table: the kit formats no number and has no words, and the design's
«Colour» section asks for the identity tones per barber.

### `ui-spark-bars`

| Input         | Type                                                                            | Default  |
| ------------- | ------------------------------------------------------------------------------- | -------- |
| `uiValues`    | `readonly number[]` — zero-anchored, a negative counted as zero                 | required |
| `uiHighlight` | `number \| null` — that bar keeps the series paint, every other the 48 % grey   | `null`   |
| `uiAverage`   | `number \| null` — a dashed rule at that value in the comparison grey           | `null`   |
| `uiLabel`     | `string`                                                                        | required |
| `uiValueText` | `readonly string[]`, one figure per bar, for the hidden table only              | `[]`     |
| `uiLabels`    | `readonly string[]`, one word per bar for the hidden table; `1 … n` when absent | `[]`     |

A bento card's tiny graph: thin capsules (fully round ends) evenly spaced
across the host's width, standing on the bottom of a box
`--ui-spark-bars-height` tall (48 px by default; read once from the laid-out
box after the first frame). A bar is 60 % of its slot, at most 8 px, and
leaves at least 3 px of air; a zero still draws a 2 px stub. No axes, no
words. The series paint is the accent, or `--ui-chart-paint` when the host
carries `data-tone` or `data-part`; with no highlight every bar wears it.
The average's rule raises the scale's top when it is over every bar. New
values cross-fade; a resize or a moved highlight redraws in place.

### `ui-ring-chart`

| Input         | Type                                                                                                              | Default  |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| `uiSegments`  | `readonly { value: number; part: UiChartPart \| null; tone: number \| null; label: string; valueText: string }[]` | required |
| `uiLabel`     | `string`                                                                                                          | required |
| `uiThickness` | `number` — the stroke, px                                                                                         | `14`     |

Content slot `[uiRingCenter]`, laid over the hole as HTML and centred in the
square inscribed in it (a caption, a big figure, a sub-line).

A donut of shares: round-capped arcs from 12 o'clock clockwise, 4 px of air
between two segments' caps (`ringArcs` takes the air plus the thickness,
since a round cap reaches half the thickness past its arc); a share too
short for its gap is a dot. Paint: `tone` 0 … 4 → `data-tone`, else `part` →
`data-part`, else the accent. One share is the whole ring with no gap; a zero
total draws the track alone in the control fill. The host is square (the
measured width), the ring inset by half its thickness. New shares or paints
cross-fade; a resize redraws in place.

## Geometry

`src/lib/geometry/`: `linearScale(domain, range)` (a flat domain maps to the
range's start), `zeroExtent(values)` (`[0, max]`, nulls skipped), `px(value)`
(a hundredth of a pixel), `linePath(points)` (straight segments, `null` breaks
the line), `stackOffsets(values)` / `stackTotal(values)` (negatives count as
0), `radarVertex(index, count, radius, centre)` (the first axis up, then
clockwise), `polygonPoints(values, radius, centre)` (the SVG `points`, a
`null` on the centre), `ringPoints`, `axisLines`, `axisAnchor` (which side
of the centre an axis's words go), `monotonePath(points)` (a monotone cubic,
`null` breaks it), `areaPath(line, points, baseline)`, `sparkBarRects(values,
width, height, top)`, `ringPoint` / `arcPath` / `ringArcs(values, radius,
centre, gap)`. Pure, over plain numbers, specified beside each file. The width comes
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
| `unsold`                         | `color-mix(in srgb, var(--sys-color-accent) 34%, transparent)` — a wash         |
| `staff`                          | `color-mix(…foreground…)` 62 %                                                  |
| `other`, `unknown`, `comparison` | … 48 %                                                                          |

Every SVG part has a 1 px `--sys-color-separator` edge. The heatmap's ramp is
the accent at 10–100 %.

**Identity tones.** A series that is a _person_ — the admin's one radar per
barber — carries `data-tone` `0 … 4` on its host (`ui-radar`'s `uiTone`) and
`charts.css` sets `--ui-chart-paint` to `--sys-identity-0..4`, the barber's
chair colour in the schedule, in the catalogue's barber order; the radar's
polygon reads it as the stroke and as an 18 % wash. The host's descendants
inherit the paint, so a legend's `.ui-chart-swatch` with the same `data-tone`
matches. The tones are not pinned by `chart-palette.spec.ts`: they are the
schedule's identity colours, not series parts, and clear their own grounds
there.

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
| `staff` 62 %                          | 5.25 / 5.25 (#6c6c6c) | 6.83 / 6.50 (#939393)  |
| `other`, `unknown`, `comparison` 48 % | 3.31 / 3.31 (#8d8d8d) | 4.35 / 4.40 (#727272)  |
| `worked`, `online`                    | 3.04 / 3.04           | 6.90 / 5.89            |
| `no-show`                             | 5.62 / 5.62           | 4.22 / 3.60            |
| `unmarked` (solid fill)               | 4.24 / 4.24           | 7.35 / 6.28            |
| hatch line on the fill                | 4.24                  | 6.28                   |

Adjacent pairs, OKLab × 100 (light / dark, on the page): worked · no-show
15.7 / 13.1; no-show · unmarked 13.3 / 18.3; unmarked · blocked ≈ 23 / 17;
blocked · unsold 11.3 / 11.2; unsold · other 11.9 / 10.7; online · staff
23.9 / 18.5; staff · unknown 11.9 / 10.7; comparison · accent 18.8 / 22.7.

**The free time is a wash, the one part under 3:1** (owner, 2026-11-09: the
time chart's grey columns read as dead time, "so much monochrome"). `unsold`
— rostered time nobody booked — is capacity, not a thing of its own, so it
wears the worked hue at 34 %: a column reads as the chair's working time,
the solid foot the part that was used (Toggl's billable over non-billable).
Under 3:1 by design, it is never told by colour alone — every chart that
draws it carries a legend and a table — and the spec still holds it ≥ 8
apart from its neighbours and from the solid accent (`WASHES` in
`chart-palette.spec.ts`).

## Accessibility

- Each drawing (`svg`, or the heatmap's grid) is `role="img"` with
  `aria-label` = `uiLabel`, one sentence the presenter writes.
- A bar is `role="button"` named by its word and its value text; the bars
  are one tab stop (roving `tabindex`), Arrow keys / Home / End move between
  them, Enter and Space pick.
- The line chart, the heatmap, the radar, the spark bars and the ring carry a `uiVisuallyHidden` table of every
  point / cell (`@creativo/ui/modifiers`), since their figures are not
  printed beside the drawing.
- Motion runs only after the first frame and never under
  `prefers-reduced-motion` (the global kill-switch plus the kit's own rule).

## Running unit tests

Run `pnpm nx test charts` to execute the unit tests.
