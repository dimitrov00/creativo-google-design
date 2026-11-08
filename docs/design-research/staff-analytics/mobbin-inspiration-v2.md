# Staff analytics — Mobbin inspiration, round 2 (2026-11-08)

Builds on `mobbin-inspiration.md` (2026-11-07). Nothing from that round is repeated here; the
screens below were pulled from Mobbin (iOS) to answer seven follow-up questions: Revolut's
chart and export surfaces, radar charts per person, the chart vocabulary beyond bars and rows,
period switching, where stats live in an app, how reports leave the app, and colour.

The brief this answers: graphs rather than rows, colour that explains, charts that stay
readable on a phone (a FIFA-style polygon per barber was named), day / week / month / year
scopes, exportable reports.

## 1. Revolut

### Performance charts (line and area, period switch, gain/loss)

- [Invest — Performance](https://mobbin.com/screens/8c585fe5-5428-416c-bad7-e7a4634c6d0b):
  `Total Value | Performance` toggle under the title, one hero figure (time-weighted return)
  with its absolute companion and "last updated", a single white line on black, a dashed 0 %
  baseline, right-edge tick labels only, then `1D 1W 1M 6M 1Y Max` pills. No left axis, no
  grid. Pattern: one line, one baseline, labels at the right edge where the eye lands.
- [Invest — Total value](https://mobbin.com/screens/753a9743-eead-45d2-b0a6-9833da25ddbc): the
  same frame with the amount instead of the return; the toggle swaps the measure, not the
  layout.
- [Crypto — Performance](https://mobbin.com/screens/fa3f6ffd-c4d0-416d-ae5d-cdcfa24fc91b) and
  [Crypto — Total value](https://mobbin.com/screens/b3deada9-67df-43bd-86bc-5690397a4eeb):
  under the chart, "Performance contribution" / "Current portfolio allocation" rows explain
  what made the line move (name, change in red/green, share %). Pattern: the chart answers
  "how much", the rows under it answer "because of whom/what" — the barber-per-service or
  shop-per-barber split.
- [Balanced Bundle](https://mobbin.com/screens/96cb6202-3f22-4373-9aa6-9fc60f19ca9a): a green
  line for a positive return with "+45.79 %" as the hero, "0 %" marked at the start and the
  min/max of the range labelled at the right edge. Colour follows the sign of the whole
  period, not each segment.
- [Global Markets](https://mobbin.com/screens/af53b579-e8b1-40ed-85c0-c975be03c533): three
  series (blue, violet, orange) each with a coloured left rule on its stat chip, the chips
  double as the legend, end-of-line dots in the same hue, `1D … 5Y Max` pills, `✕` to close
  the full-screen overlay. Pattern for comparing three barbers on one chart: the legend is
  the row of stat chips, not a separate key.
- [Stock comparison](https://mobbin.com/screens/a3ff853e-4a5a-4eef-a851-23196b3d3fe8): several
  lines on a percent scale with a label tag pinned at each line's end ("TSLA 59.43 %"). Tags
  at the line end beat a legend when lines cross.
- [AAPL overview](https://mobbin.com/screens/3170073a-cfed-4fa4-b64a-d6020349fc76): red/green
  candles, a dashed reference line, `1D … Max` plus a settings glyph for chart options. Noted
  for the settings glyph placement; candles are not for us.

### Analytics, financials and composition

- [Analytics (modal)](https://mobbin.com/screens/be0705ab-b8e1-4012-a110-3d1b3f2fa28b):
  "Analytics" as a full-screen page closed with `✕`, an account dropdown on the left and
  "This month" on the right, a wide `Spent` card with a chart placeholder, two half-width
  cards (`Income`, `Net cashflow`), then a `Budget` card with "€90 left to spend · On track"
  and a single progress bar. Pattern: a modal stats page with a scope row above a card grid.
- [Spent — view toggle](https://mobbin.com/screens/691ffd53-5aba-4a39-bfa6-6064a299bdcd): a
  three-glyph segmented control top-right swaps the same data between a step line,
  [bars with an average line](https://mobbin.com/screens/00858497-3c29-4b4c-a931-2ce62727360f)
  and a [ring](https://mobbin.com/screens/56d80261-ebab-49c4-aa2c-de9e23c41abb). The ring's
  segment hues (green, violet) repeat as the icon chip colour of each "By category" row.
  Pattern: one dataset, three views, same period pills; category colour lives in the row's
  icon disc.
- [Spent — custom period](https://mobbin.com/screens/6fb5bd20-f1f2-4ba8-8f7b-b8a410b2f852):
  with a custom range the pills are replaced by a "Custom period · 20 – 28 Feb" card with a
  `Clear` chip; the "…" pill in the period row is how you get there.
- [Total wealth](https://mobbin.com/screens/5ba63fd5-6d4c-4149-a1d9-2ac6b6aec32d): a gradient
  ring (blue → violet) with "Total assets $20" inside, `Assets | Liabilities` pills, rows under
  it with amount and share %. Pattern: the ring's figure is the total, the rows carry the
  parts; the ring never carries labels.
- [Budget allocations](https://mobbin.com/screens/519ee7b9-37d5-41ca-99d9-729905be9547): each
  category row has a small ring on its icon showing how much of that budget is left, with
  "$10 left of $10" and a per-day pace. Pattern: a tiny ring on a row icon is enough for a
  goal per item.
- [AAPL — income statement](https://mobbin.com/screens/b804bfa4-59b7-4975-b97b-54083f92346a)
  and [cash flow](https://mobbin.com/screens/693dd2a2-ee9c-49f5-9c3f-901cdc60fcab): paired
  bars per year (violet, cyan, indigo), `Annual | Quarterly` segmented control inside the
  card, the current year highlighted as a chip on the axis, legend rows with the figure under
  the chart, negatives drawn below a 0 line. Pattern for "takings vs tips" or "worked vs
  unsold" per month.
- [Gold — price targets](https://mobbin.com/screens/4aa04056-4a32-48d1-86a8-c2c9bd00ed89): a
  dotted projection with target points after the main chart; noted only as the shape for a
  "pace to goal" projection.

### Yearly summaries

Mobbin holds no Revolut "year in review" set. The nearest story-format references are
Whoop's and Oura's, listed under §5 (entry points). Revolut's own yearly scope is the plain
`1Y` pill plus the `Tax year` period in the statement flow.

### Statement export (PDF / Excel)

- [Statement — custom range](https://mobbin.com/screens/fb6d4548-17b9-43ca-aa0c-ebc40734b116):
  an account chip, `PDF | Excel` segmented control, a `Period` select, `From` / `To` date
  selects, a footnote, and one `Generate` button in the dock.
- [Statement — month](https://mobbin.com/screens/76d00d0e-58a3-416e-89e4-fa202591589c): with
  `Period = Month` the From / To become month chips in one card.
- [Period sheet](https://mobbin.com/screens/0206ad46-719f-42d7-98cc-559f0759942a): `All time ·
Month · Tax year · Custom` as a bottom sheet with a check on the current one.
- [Generating your document](https://mobbin.com/screens/737d70af-1cba-4db3-88d5-b9f7891ddffe)
  → [Your document is ready](https://mobbin.com/screens/7eb0fab4-72a9-4f1e-afdf-8345aa792fae):
  a bottom card with a spinner, then a check; the page behind is dimmed, not replaced.
- [PDF preview](https://mobbin.com/screens/703647ee-8362-4923-8dcc-f46471c987ba): the
  generated document opens in a viewer with the system share glyph top-right.
- [Transfer detail — Statement · Download](https://mobbin.com/screens/b7a4d4f5-b5a7-4f95-a39e-84e7a258996c):
  a single "Download" row inside a detail page for a one-item statement. Pattern: the export
  is reachable from the thing it describes, not only from a settings menu.

## 2. Radar / polygon charts per person

- [FotMob — player traits](https://mobbin.com/screens/7971bc77-dba6-432d-be00-40f4afa929dd):
  six axes, each vertex labelled outside the hexagon with the trait name on one line and its
  percentile on the next, a filled red polygon, dashed ring guides, and a subtitle "Stats
  compared to other keepers" with a help glyph. The closest to the FIFA card. What keeps it
  readable: six axes at most, labels outside the shape, one fill, and the subtitle stating the
  comparison base.
- [Hevy — muscle distribution](https://mobbin.com/screens/602918f6-a810-4f63-beb3-909f431ee787):
  a hexagon with a `Current` (blue) vs `Previous` (grey) legend, "Last 30 days" dropdown above,
  a share glyph top-right, and four stat tiles under it each showing the value and "→ previous
  value" in grey. The two-period overlay pattern: current in the accent, previous in grey,
  never two saturated hues.
- [Hevy — comparison](https://mobbin.com/screens/0f91d578-7a46-466f-897c-08a505b17507): two
  people as avatars with "VS" between them, a "STRONGER" badge under the winner, then one
  paired-bar row per metric with a red/green % delta. The two-person pattern when a radar
  would be too small: per-metric paired bars, winner marked once.
- [Life Reset — life map](https://mobbin.com/screens/fd6ebd45-63c7-421e-87e2-835f98ffb3de):
  orange polygon with a dot on each vertex, a glyph plus a word per axis, and under it one row
  per axis with a four-bar mini meter. Shows the polygon and the per-axis list as a pair; the
  list is where the numbers live.
- [Ahead — emotional profile](https://mobbin.com/screens/2f15066f-d1b8-419c-a170-76bb74c5d1bd):
  a pentagon with "label + %" at each vertex and, beneath, "Superpower" and "Growth area"
  callouts with a green and a red chip. Pattern: the polygon plus two sentences naming the
  strongest and weakest axis (computed, not eyeballed).
- [QUITTR — Ring | Radar](https://mobbin.com/screens/ffef51cf-ba6b-463e-82c1-1296b36bc0dd):
  a segmented toggle swaps a ring and a radar for the same score; the overall % sits in the
  polygon's centre. Pattern for letting the user pick the shape; the centre figure is a good
  home for the overall score.
- [Bevel — workout frequency](https://mobbin.com/screens/8afe35f5-23d2-4fb4-873a-74f68efceb86):
  a polar-area wheel (six wedges, radius = sessions) with "7 sessions / Arms" labels outside
  each wedge. An alternative to the polygon when values are counts.
- [Liven — pattern](https://mobbin.com/screens/40365966-8d27-4646-b11a-feeea1c408a7): a
  pentagon with labelled concentric rings and vertex dots in a second hue; fine at this size,
  but the labels wrap to two lines on the diagonal axes.
- Two-person comparison without a radar:
  [NBA — team comparison](https://mobbin.com/screens/2a85cf45-0207-498a-afe1-65473c8d3bae)
  (2-column grid of metric cards, each a pair of short bars with the figure right-aligned),
  [Apple Sports — team stats](https://mobbin.com/screens/a85e8a79-016d-47f3-b938-046bc96dbd74)
  (value left, metric centred, value right, one split bar beneath in the two team hues),
  [Premier League — player comparison](https://mobbin.com/screens/7bc475f9-158f-4d39-a25e-11730e237d5c)
  (two columns, the larger value in bold, season picker per column). The split bar is the
  most compact; bolding the winner is enough emphasis.

Not to copy: [Open — life score](https://mobbin.com/screens/cc0c5d78-5a3f-4c65-ba1d-ee9733fe2592)
(seven axes with labels rotated along the circumference — unreadable at phone size) and
[QUITTR — 30-day challenge](https://mobbin.com/screens/7e8c7a72-323a-46b7-b5c9-d8620dce6928)
(the polygon is a few pixels wide because values are tiny; a radar needs a floor or it shows
nothing).

## 3. Chart types

### Stacked bars (time breakdown)

- [Whoop — weekly trends](https://mobbin.com/screens/fa9775f5-34b2-4607-81a2-fa15a1f1c245):
  one card per metric; strain bars carry their value above each bar; HR zones are stacked
  (grey, blue, green) with a legend in the card header; today's column has a darker backdrop
  and its label in white. Readable because values are printed, not read off an axis.
- [The Outsiders — training focus](https://mobbin.com/screens/a15515cc-b122-4e5f-9e2b-c26a875be95b):
  six months of stacked bars (yellow, red, violet), a scrub tooltip that lists each zone's
  share and duration, and under the chart one row per zone with a proportion bar, % and
  duration. Pattern: the legend is the breakdown table.
- [Insight Timer — sessions per day](https://mobbin.com/screens/c7fd7cab-6457-4ad3-9dc1-a7cdd894dee5):
  stacked by session kind in seven pastel hues on white, legend chips with %. Shows the upper
  bound: seven colours is where a legend starts to be required reading.
- [Alta — during the week](https://mobbin.com/screens/04cd0d2b-1873-469d-8e5e-ac8d01375715):
  100 % stacked columns per weekday with the % printed inside each segment. The best shape for
  "share of the day by kind" per weekday; segments under ~8 % lose their label, which is fine.
- [BitePal — macro balance](https://mobbin.com/screens/7cfce97f-b720-4fbf-9a0e-efb04496943a):
  100 % stacked per day with a right axis at 0 / 50 / 100 %, a ▲ marker under today, and a
  one-line verdict beneath ("Low-protein diet …"). Pattern: chart, then sentence.
- [Liven — mood breakdown](https://mobbin.com/screens/11ae0c7b-4470-4704-9a9f-cc91e7350a8e):
  `7 days | 1 month | 1 year` chips, then "during the day" as four horizontal gradient bars
  (morning / afternoon / evening / late night) and "during the week" as stacked columns with a
  tap tooltip. The daypart bars are the shape for "which part of the day is busy".

### Heatmaps (calendar and hour-of-day)

- [Linktree — posting heatmap](https://mobbin.com/screens/c1d9432b-36f6-49b7-a8a3-0205edda536f):
  weekday columns × week rows, a four-step purple ramp with a "No posts · More posts" legend,
  and a single figure under it. One hue ramp, legend of two words.
- [Bevel — activity months](https://mobbin.com/screens/ac7933a1-0142-40f5-9b84-41c875470981):
  two months side by side as weekday grids, legend "1 activity · 2 · 3+" in three steps on
  dark. Shows that two months fit a phone width when cells are small squares.
- [timespent — reading heatmap](https://mobbin.com/screens/1d64ea0b-3a70-4245-ac74-ab08e297d805):
  a GitHub-style strip (May–Sep) scrolling horizontally above a month calendar; the strip's
  orange ramp is the only colour on the screen.
- [TIDE — focus calendar](https://mobbin.com/screens/3fc1df06-f9d1-489e-9912-2fa784eb2884):
  dots instead of squares, `Week | Month` toggle and a date-range stepper in the card header.
- [Brick — lifetime activity](https://mobbin.com/screens/e4af3339-f7d3-402a-a7b2-df751a4a8c82)
  and [Atoms — repetitions](https://mobbin.com/screens/f26fc9f2-1c6b-4a6d-9924-6ec1e4c58d21):
  month blocks under a big count; binary fill, no ramp. Enough when the question is "which
  days did it happen".
- Hour-of-day: [Strava — active times](https://mobbin.com/screens/1e8b3bf1-ea80-4f7f-bb46-a551a690e6f5)
  draws grey hour bars with one orange bar at the peak, a callout "5 PM – 6 PM · 70 % of peak
  traffic" and a sentence above ("Most people complete this route between 10 AM and 11 AM").
  [Oura — most active](https://mobbin.com/screens/3e211f3f-a95d-4478-ac8c-4153e3f91501) puts
  the hour in the accent colour inside the headline sentence over a layered area chart.
  [IKEA — popular times](https://mobbin.com/screens/dc59060c-57cf-4ffb-bbae-48fb4df27fa8) is
  the same shape in a sheet with a weekday stepper. The three together are the "busy hours"
  pattern: grey bars, one accent bar, a sentence that names the hour.

### Sparklines in rows

- [Stocks — list](https://mobbin.com/screens/b4a9a933-af68-4596-9752-dba966b686b8): name,
  sparkline, value, change pill; the sparkline and the pill take the sign's colour.
- [Yahoo Finance — list](https://mobbin.com/screens/6038b18e-23f5-4d11-8b82-0b33ad605ca1): the
  sparkline has a dotted baseline so the line's position reads without an axis.
- [Bevel — trends](https://mobbin.com/screens/47f105df-788c-4f7d-82a3-418af143d1c0): one card
  per metric with the delta as the figure, a plain-word verdict ("Within baseline"), and a
  sparkline drawn against a shaded baseline band with an end dot. The verdict is what makes
  the row readable without reading the line.
- [MacroFactor — expenditure changes](https://mobbin.com/screens/ff5a0c22-dee1-43d2-be4c-bbe11883253f):
  3 / 7 / 14 / 30 / 90-day rows, each a tiny area sparkline, a delta and a status word
  ("Decrease", "Waiting"). The "waiting" state is the small-sample rule in a row.
- [Kraken — newly listed](https://mobbin.com/screens/1fb88ace-8e64-48e5-9549-2c3753e5b73d):
  sparkline colour follows the sign alone; everything else is ink. Confirms: red/green is
  reserved for change.

### Ring / donut composition

- [Lloyds — breakdown](https://mobbin.com/screens/f18c1aae-e1a0-403d-bb93-8b57c8508515): a
  two-part ring (green, blue) with the total inside, legend dots under it, and a `Money |
Extras` segmented control that filters the list below. Two or three parts is where a ring
  works.
- [Whoop — zone breakdown](https://mobbin.com/screens/c2da59f2-5d9a-49ad-9936-984ca7ef7297):
  the donut bleeds off the right edge; the values are stacked on the left in the segment
  colours with the zone name beneath each. Labels never sit on the ring.
- [Clue — cycle statistics](https://mobbin.com/screens/581b26e9-861c-4878-8b26-b4661b69cf8a):
  a small ring per stat tile (one hue) and a strip chart (Average, then one row per cycle)
  with a four-step red ramp. The strip rows are a compact "intensity per day" view.
- [MLS — possession](https://mobbin.com/screens/d08078d9-7add-4c21-afb2-c07bffcdfa77): a
  two-colour ring for a two-way split with the figures outside left and right, then split
  bars for the other metrics.

Not to copy: [Whering — wardrobe](https://mobbin.com/screens/ebd7ff8b-529c-4ef1-9aff-aaa1a6bdd231)
(a ring with 14 slices in 14 hues; the legend list is the actual chart).

### Progress toward a goal

- [Tonal — weekly target](https://mobbin.com/screens/5e9461c9-d902-4e37-ad82-906753bc7583): a
  thick ring with the figure inside, a check disc when met, "WEEKLY TARGET EXCEEDED" set along
  the ring, and the target shown as a range ("25 – 34 reps") beneath. A range target is
  gentler than a single number.
- [Strava — widgets](https://mobbin.com/screens/1c996718-ab94-4247-85b3-80885bab44c9): a ring
  with the count and, beside it, seven small bars M–S coloured on the days that count toward
  the goal. The ring plus the week dots is the whole story in one card.
- [Blinkist — weekly goal](https://mobbin.com/screens/8fb088c9-d0d7-41f9-b5ac-f9087c7e1cd0):
  an open arc (gauge) with "1 / 3 days" inside and an `Edit` link under it.
- [Whoop — plan results](https://mobbin.com/screens/2f82e79e-543d-43c6-b74c-14248de208b0): a
  ring made of ticks, 33 % filled green, with one small ring per sub-goal in the list under
  it.
- [Lifesum — weekly score](https://mobbin.com/screens/665b9440-6309-40c0-8749-74230e98e866): a
  gauge with labelled bands around it (off-track / imbalanced / good / great / optimal) and
  the band name set above the figure. The band words are the colour's meaning.

### Comparison of two periods on one chart

- [Fi — activity day](https://mobbin.com/screens/ac29fa20-047e-40ec-804d-e9f063596987): `Day |
Week | Month` tabs, a date stepper, a "Comparison" sentence with the two dates in bold, the
  delta as a large green figure with an arrow, a green area for today over a grey one for
  yesterday, and a two-item legend. The clearest version: sentence, delta, chart, legend.
- [stoic — weeks](https://mobbin.com/screens/f1d0feba-86e3-4e2e-a8bd-508931b4b783): this week
  blue over previous week grey, an "Average" label on a faint line, `Weeks | Months | Years`
  in a dropdown and a "‹ This week ›" pager in the dock.
- [Gentler Streak — this week vs last week](https://mobbin.com/screens/cc039c5d-5b09-460f-b2bf-a66f733e94e8):
  two stacked lanes (this week above, last week below) sharing the weekday axis, and summary
  tiles each with an up/down/equal glyph and last week's value small under the figure. The
  lanes avoid overlapping lines when both are full.
- [The Outsiders — year](https://mobbin.com/screens/5f945b6c-9fde-4063-82b6-cf96c8da36a4):
  "2025 ⌄ vs. 2024", a cumulative line above monthly bars, the current month highlighted, and
  summary tiles with the previous year's value beneath each figure.
- [Whoop — trend view](https://mobbin.com/screens/e2217a0e-7bb4-4aac-9edb-20a890bd9788): a
  chip "▲ 231 % vs. prior 6 months", a sentence that explains the comparison in words, and the
  two averages drawn as labelled horizontal rules on the bars ("2:20" white, "1:19 · −44 %"
  gold). Averages as rules on the bars is a strong pattern for "this month vs usual".
- [Origin — spend this month](https://mobbin.com/screens/d9ac8ded-f15f-474d-ac19-62f1b603a66f):
  a "Compare with: April ⌄" chip; the comparison month is a dashed grey line, the budget a
  labelled rule. The chip is the UI for choosing the comparison period.
- [Commons — how you compare](https://mobbin.com/screens/98dbc571-d930-44fa-9860-3b79dbc8ef9b):
  paired bars (you in blue, average in grey) per month, the selected month as a dark pill on
  the axis; below, "you vs the world" as four labelled bars. Paired bars for "you vs the
  shop's average" per month.
- [Rocket Money — spending](https://mobbin.com/screens/dcfec893-ee01-4080-81d3-74f6bc83a090):
  a horizontal strip of month cards each with two mini bars (income, spend); the selected
  month card is outlined. A month strip as both picker and small multiples.
- [Strava — relative effort](https://mobbin.com/screens/fff0b506-9862-44e7-80a9-e1e447d404d9):
  a shaded "suggested range" band from a three-week average, this week in black, last week in
  grey. The band is a target without a single number.

### "Best day" annotations

- Strava active times (above): one bar in the accent plus a callout with the value.
- Oura most active (above): the answer in the headline sentence, the hour coloured.
- Whoop weekly trends (above): every bar labelled, so the best day needs no extra mark.
- [Splitwise — group spending](https://mobbin.com/screens/f77b2738-8716-4219-932f-3e9080cbbd2c):
  two months as bars with your share as the darker segment, each figure under the chart with
  its legend tick.

### Small multiples

- [MacroFactor — insights](https://mobbin.com/screens/dbb6adbe-687b-4528-aba0-21f9af8c1e6d):
  a 2 × 2 grid; each card is title, "Last 7 days", a mini chart in its own hue, the figure and
  a chevron. Each card opens its full chart.
- [Garmin — at a glance](https://mobbin.com/screens/9f93b867-0f95-4f9b-9467-46f481e4bef3):
  dark cards, each with a different mini visual (ring, tick row M–S, spike strip); readable
  because every card has the figure in large type and the visual is secondary.
- [Bloomberg — markets at a glance](https://mobbin.com/screens/9f7982fb-4800-4c31-b005-1a2195147d97):
  three mini area charts per row with a change chip; area colour follows the sign.
- [Letterboxd — list progress](https://mobbin.com/screens/3f9fd195-ecbb-4f60-96a3-aa5b5916c1c6):
  a 2-column grid of rings, each with the name, the % and "n of N" inside. One hue, many
  rings; the pattern for "each barber's progress toward their goal".
- [adidas Running — statistics](https://mobbin.com/flows/b8ed43d4-0902-49a1-b331-724c39e89a65):
  one full-width chart per metric, each with its own line / bar toggle and figure + date
  range in the header, stacked vertically. The flow also shows the entry (Progress tab →
  "SHOW MORE").
- [Substack — creator stats](https://mobbin.com/screens/55b79d4e-e96a-4a75-89ad-d89d158c9f77):
  four figure tiles (one with a "+1 · 30d" green chip) and then one large area chart. Tiles
  first, one big chart second.

## 4. Period switching

- Pills under the chart: Revolut `1D 1W 1M 6M 1Y Max` (§1); the Spent screens use `1W 1M 6M
1Y` plus a "…" pill that opens a custom range. [Public — chart](https://mobbin.com/screens/48dc37cf-ab70-4320-9a24-7e49ffc1bdcc)
  adds `YTD` and a `Chart | Data` toggle above.
- Tabs at the top plus a stepper: [Fi — rest, year](https://mobbin.com/screens/b292e1bc-e7be-4fac-8563-6bb6473bf0be)
  (`Day Week Month Year` underline tabs, then "‹ 2026 ›" with the forward arrow disabled at
  the edge); [Me+ — habit stats](https://mobbin.com/screens/bc859f54-d4fc-4f2c-a728-0a5f82dc2bd2)
  (`Week | Month | Year` pill, then "‹ 2026/03/15 ~ 03/21 ›"); [timespent — reading](https://mobbin.com/screens/0c62e0d0-ac45-4418-af1d-717f857bc48e)
  (same, with the range as the chart title).
- Segmented control inside the card: [Speechify — words listened](https://mobbin.com/screens/5bca0432-82c0-4923-ad02-75c6e7eba2e1)
  (`Week | Month | 6 Months | Year`); [Lifesum — statistics](https://mobbin.com/screens/aaf8008c-4f49-4613-a352-75b14f4a9c70)
  (`Week | 1 month | 3 months | All` as top tabs over several charts).
- Scope word plus a picker: [The Outsiders — choose week](https://mobbin.com/screens/7671cfad-ceda-4df6-a4b5-fad7edc74d97)
  ("This Week ⌄ vs. Last Week" opens a wheel with "Last Week / This Week" as words and other
  weeks as dates); [Gentler Streak — activities](https://mobbin.com/screens/cc039c5d-5b09-460f-b2bf-a66f733e94e8)
  (`Week | Month | Year | All Time`, "This Week ⌄ · vs. LAST WEEK", and a `SHARE` pill in the
  same row); stoic (dropdown `Weeks | Months | Years`, pager in the dock).
- Horizontal period strip: [Alta — monthly](https://mobbin.com/screens/04cd0d2b-1873-469d-8e5e-ac8d01375715)
  ("Monthly ⌄" plus scrolling month tabs "Jun 2026 · May 2026 …"); Rocket Money's month cards
  (§3). Swiping between periods appears only as these strips; none of the screens found swipes
  the chart itself.
- Combined pill: [Splitwise — all time | ‹ November 2025 ›](https://mobbin.com/screens/f77b2738-8716-4219-932f-3e9080cbbd2c)
  puts "All time" and a month stepper in one floating pill in the dock.
- Dropdown in a sheet: [Canva — insights](https://mobbin.com/screens/9d860aea-fa35-41d7-9953-94c9289b7cdb)
  (`7 days` chip opens a list 7 / 30 / 90 / All time); [Linktree — activity](https://mobbin.com/screens/2c4fbcf7-286f-4871-b7c4-3d73c47c39c0)
  ("Last 7 days" chip plus a filter glyph opening a Filters sheet; a `Daily ⌄` granularity
  menu beside the figures).
- Compare-with chooser: Origin's "Compare with: April ⌄" chip and The Outsiders' "vs. 2024"
  (§3) are the only explicit "compare with previous period" controls found; the others compare
  by default and say so in a sentence.

## 5. Entry points and transitions

- In place, from a toolbar toggle: [timespent — switching view to chart](https://mobbin.com/flows/816b80d0-e800-48f7-ab3e-3f81db77484f).
  A `list | pie` segmented toggle top-left of the "Today" screen swaps the plan/history list
  for a "Recap" (two circular badges and "Moments") while the date strip and the dock stay. A
  cross-fade of the content area only; the working screen is never left.
- Sheet from a button on the working screen: [IKEA — popular times](https://mobbin.com/screens/dc59060c-57cf-4ffb-bbae-48fb4df27fa8)
  (a "Popular times" disc button raises a sheet with the hour chart over the store page);
  [FocusFlight — trends](https://mobbin.com/screens/69c0f003-4faf-41e8-a8cf-d52dc4325093)
  (a "Trends" sheet over the map, `Total | Week | Month | Year` pills at its top, figure tiles
  then charts); [Garmin — insight](https://mobbin.com/screens/a8f2eb9b-1c06-42bb-8eb8-b346cd866860)
  (a sheet with a grabber, close disc, and a `Quantity | Type` segmented control); Canva
  insights (§4) with a second sheet stacking for the period list.
- Modal page with `✕`: Revolut Analytics and Global Markets (§1) open full-screen and close
  with `✕` rather than a back chevron; the slide-up of a modal page, then a back-stack inside
  it.
- Push from a tab: adidas Running (§3): a "Progress" tab shows a summary card; "SHOW MORE"
  pushes the full Statistics page.
- Chart option sheet: [Lloyds — select a graph](https://mobbin.com/screens/1d3fde5f-0431-457d-ab6f-1693f2fa54c9):
  a chart glyph disc on the chart raises a sheet with two radio options ("Paid in and spent",
  "Total spent") and `Save`.
- Drill-down from a bar: [Notion — graph detail](https://mobbin.com/flows/0de25c93-4064-40b4-a141-e7bea2c92be9):
  tap a bar → the column dims and a tooltip shows "Tuesday · 1 · Click to view data" → a sheet
  lists the rows behind it. The rule from round 1 (every figure opens its source) as a flow.
- Story overlays: [Whoop — your first week](https://mobbin.com/screens/c2da59f2-5d9a-49ad-9936-984ca7ef7297)
  and [Oura — most active](https://mobbin.com/screens/3e211f3f-a95d-4478-ac8c-4153e3f91501):
  full-screen, a dashed progress rail at the bottom, one chart and one sentence per page,
  close `✕` and a share glyph in the top bar. The format for a weekly or yearly digest.
- Share card over the stats tab: [Gentler Streak — share](https://mobbin.com/screens/845111bc-c398-4136-9a1e-4578b9eb1d38):
  the card rises as a sheet, the Activities page blurs behind, `Cancel | Share` in the dock.

## 6. Export and share

### Report files (PDF / CSV / Excel)

- Revolut statement (§1): format segmented control, period select, from/to, one `Generate`,
  progress and ready cards, then a viewer with the system share.
- [Satispay — exporting transactions](https://mobbin.com/flows/f363f1ec-4318-475c-a0b2-837ced17070a):
  an export glyph beside the search field on the transactions list; "Export Report" with
  `Select period` (Year) and `Select format` as radio rows with a reason under each ("PDF —
  Best for reading and sharing", "Excel — Best for sorting and operations"); then a preview
  with a "1 of 2" page badge and `Share · Download · Print` buttons. The one-line reason under
  each format is worth copying.
- [Expensify — downloading report as PDF](https://mobbin.com/flows/231efbaa-5f42-465b-86e5-e7b66bbdf1fb):
  a "…" menu with `Download as CSV` and `Download as PDF`; a "Generating PDF" banner at the
  bottom turns into a `Download` button; a system alert confirms. The banner stays while the
  user keeps reading the page.
- [Cal AI — export a PDF summary report](https://mobbin.com/flows/7cf29ab4-b955-478c-a6cd-2f1fac2cfd18):
  "Export PDF Summary Report" row in settings → enter an email ("send it to yourself or someone
  else") → "Your file is on the way!" with "we recommend downloading it on a computer". The
  email route for a report that is awkward on a phone.
- [Buddy — export data](https://mobbin.com/flows/9d3a2325-8146-4114-b13a-fb85ab099029): a CSV
  page with From / To rows, "FOUND 13 TRANSACTIONS" printed above the `Export` button, then
  the iOS share sheet with the file named. Showing the row count before exporting is a small,
  good check.
- [Wanderlog — exporting as CSV](https://mobbin.com/flows/aa4d67c0-a227-484c-89a2-4ea360f3485b):
  an `Export` chip in an expense settings sheet opens a Quick Look of the CSV with the share
  glyph. Minimal, but the raw CSV preview is unreadable; the Satispay/Revolut preview of a
  laid-out PDF is better.

### Share-as-image cards

- [Brink — share card](https://mobbin.com/screens/030d8444-998f-4263-aa6a-9ed1a7d3c072): a
  portrait card with the app mark, "This Year", one hero figure, two stats, a "Top shows"
  mini table and "Made on Brink" in the corner; one `Share` button. The template for a "my
  year / my month" card: figure, two stats, one list.
- [Strava — month in sport](https://mobbin.com/screens/3c96c039-8f09-4101-8fe1-c24716b83638):
  a horizontal carousel of card designs for the same stats, "Share to" with Message, Strava
  Post, Save, More. Several designs, same data.
- [Public — portfolio return](https://mobbin.com/screens/5be7661b-2f1b-4af1-98ca-abe4cf3edb63):
  a `$ | %` toggle in the top bar chooses what the card prints, a dot pager for variants.
- [Whoop — share your streak](https://mobbin.com/screens/72245e7f-faee-4efb-b078-315632e093d4):
  a "Remove background image" toggle, then `Copy · Download · Message · More` as equal icon
  buttons and a "Copied" toast.
- [Gentler Streak — share](https://mobbin.com/screens/845111bc-c398-4136-9a1e-4578b9eb1d38):
  the stats overlaid on a photo, with `Add Photo | Default` tiles to swap the background.
- [Any Distance — step card](https://mobbin.com/screens/c943710e-63f9-4237-89a2-b6b7f8b7c8b5):
  a theme strip (Dayglow, Frost, Moon …) under the card.
- [Beli — share this page](https://mobbin.com/screens/b90ece28-8ba8-4718-a7c3-3b010ab774e5)
  and [Polarsteps — share your travel stats](https://mobbin.com/screens/cca74022-8ef8-4b95-83a6-c968b545d5e4):
  one card, then the destination row (Messages, Save, Snapchat, More / Download, Other).
- [pillowtalk — share](https://mobbin.com/screens/9b40bd58-f9d7-48a9-82ed-9655b08920c7): the
  dot calendar itself as the card with a four-word legend. A calendar heatmap shares well.

## 7. Colour

- Revolut (§1): chrome is monochrome — black or white ground, grey pills, white or black type.
  A chart gets one colour at a time: white for the user's own line on black, green for a
  positive period, red/green only on candles and change figures; paired categories in
  violet / cyan / indigo; the Spent ring in two hues that repeat on the row icon discs. Dark
  mode is pure black with grey surfaces; light mode is white with the same grey pills and
  black bars.
- Whoop: dark navy chrome, one blue for its main metric, HR zones in an ordered ramp (grey →
  blue → green → orange), green only for the "vs prior" chip. The ramp is ordinal, so it reads
  without the legend.
- The Outsiders: dark ground, intensity zones as yellow → red → violet; again ordered.
- Strava and Oura: grey bars or areas with the one answer in orange / gold, and the same hue
  inside the sentence that names it.
- Fi, stoic, Hevy: current period in one hue, previous in grey; the delta in green/red.
- Linktree: one purple ramp for the heatmap and dark/light purple for the two series (views,
  clicks) — a single hue family keeps the brand accent free.
- Insight Timer: seven pastel categorical hues on white — the upper bound; the legend becomes
  necessary.
- Garmin: dark cards, every metric in its own hue (blue ring, orange spikes, green ticks);
  readable only because each card is isolated.
- Letterboxd and Tonal: one accent (blue) on near-black or white for every ring; the number
  carries the meaning.
- Bevel: pink sparklines with a grey baseline band on white; a verdict word carries the
  judgement rather than colour.
- Whering and Rocket Money are counter-examples: fourteen hues on one ring, and a red gradient
  header that competes with white chart bars.

Mapping to Creativo's accent law: orange `--sys-color-accent` is the selected series, the
best bar, the current period and the highlighted hour; previous periods, averages and context
are grey ink or washes; green/red appear only on change figures and chips; a stacked breakdown
uses at most four to six categorical hues with a legend that is also the breakdown table.
Dark mode follows Revolut: black ground, grey pills, the same accent.

## Patterns to adopt

1. Revolut's chart frame: hero figure plus its companion line, one series, dashed baseline,
   labels at the right edge, period pills under the chart, no left axis and no grid.
2. A view toggle (bars / line / ring) over one dataset with the same period pills (Revolut
   Spent), with the category hue repeated on each row's icon disc.
3. A radar per barber with at most six axes, labels and values outside the polygon, a filled
   accent shape, a subtitle naming the comparison base (FotMob), and current vs previous as
   accent over grey (Hevy); two sentences name the strongest and weakest axis (Ahead).
4. Two barbers compared with a split bar per metric, the larger value in bold, one "ahead"
   badge (Apple Sports, Hevy); a radar overlay only for one person across two periods.
5. Stacked bars whose legend is the breakdown table beneath (The Outsiders), 100 % stacked
   per weekday with % printed inside segments (Alta), and daypart bars for morning / afternoon
   / evening (Liven).
6. Busy hours as grey bars with one accent bar, a callout with the value and a sentence that
   names the hour (Strava, Oura).
7. Comparison of two periods: a sentence with both dates in bold, a large delta with an
   arrow, current in accent over previous in grey, and averages drawn as labelled rules on the
   bars (Fi, Whoop trend view); a "Compare with: ⌄" chip to change the baseline (Origin).
8. Sparkline rows with a dotted baseline and a verdict word (Bevel, Yahoo Finance); a
   "waiting" state when the sample is short (MacroFactor).
9. Goals as a range, not a number (Tonal); a ring with seven week-dots beside it (Strava);
   rings in a grid, one hue, "n of N" inside (Letterboxd).
10. Period control: `Day Week Month Year` tabs plus a "‹ range ›" stepper with the forward
    arrow disabled at the edge (Fi, Me+); a "…" pill for a custom range that becomes a
    "Custom period · Clear" card (Revolut).
11. Entry: stats as a modal page closed with `✕` launched from the schedule's toolbar
    (Revolut Analytics), chart drill-downs as sheets listing the source rows (Notion), and a
    weekly digest as a story overlay with a share glyph (Whoop, Oura).
12. Export: `PDF | Excel` format with a one-line reason under each, period select, row count
    before generating (Buddy), a progress card that becomes "ready", a laid-out preview with
    `Share · Download · Print` (Revolut, Satispay); share cards as one hero figure, two stats
    and one short list with several designs for the same data (Brink, Strava).

## Patterns to avoid

1. Radars with seven or more axes, labels rotated along the rim, or no value floor (Open,
   QUITTR 30-day): the polygon collapses or the labels cannot be read.
2. Rings with more than three or four slices (Whering); the legend becomes the chart.
3. Seven-plus categorical hues in one stacked chart (Insight Timer): the legend becomes
   required reading. Use an ordered ramp for ordered data and at most six hues otherwise.
4. Coloured chrome behind charts (Rocket Money) or a different hue per card (Garmin): the
   accent stops meaning "selected" or "best".
5. A raw CSV Quick Look as the export preview (Wanderlog): show a laid-out document or go
   straight to the share sheet.
6. Dense multi-signal timelines with six legend items (Ultrahuman stress timeline): one
   question per chart.
