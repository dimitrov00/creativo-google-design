# Staff analytics v3 — the Revolut layout

- **Status:** built (2026-11-09), on top of v2 (`staff-analytics-v2.md`), whose data,
  callables, day documents, goals and export stand unchanged.
- **Owner ask (2026-11-09):** "I don't like the design at all … copy the newest Revolut
  Analytics": a title, a row of two dropdowns (whose figures · which period), a carousel of
  bento pages that swipes back through past periods and relabels the period button, more
  data under it; every card opens its own screen whose chart switches between a curve, bars
  and a ring, with 1W 1M 6M 1Y MAX under it and a custom period set in collapsible rows with
  inline start and end calendars.

## References (Mobbin, Revolut iOS)

- Analytics home: [empty](https://mobbin.com/screens/be0705ab-b8e1-4012-a110-3d1b3f2fa28b),
  [with figures](https://mobbin.com/screens/df7b1aab-511c-4959-9238-7ec8da733902),
  [scrolled](https://mobbin.com/screens/0f3fc978-ae0e-44f7-ae02-f81311e5fc8f).
- A card's screen, three views of one chart:
  [line](https://mobbin.com/screens/691ffd53-5aba-4a39-bfa6-6064a299bdcd),
  [bars](https://mobbin.com/screens/00858497-3c29-4b4c-a931-2ce62727360f),
  [ring](https://mobbin.com/screens/56d80261-ebab-49c4-aa2c-de9e23c41abb); light theme
  [bars](https://mobbin.com/screens/69913e7a-7c90-4051-9fe1-84f2f55920d9).
- Custom period: [range calendar](https://mobbin.com/screens/18cbc897-9d9c-45a4-987c-aed71d256faa).

## The home screen (`/staff/analytics`)

Top to bottom:

1. The icon-only back and the large title «Анализи».
2. **One row:** leading, the scope menu (`ui-choice-menu`): «Салон», «Аз» and every
   barber with their portrait — the admin's only; a barber has nothing to choose and sees no
   menu. Trailing, the period menu (Revolut's «This month»). Both triggers are the same
   small bordered pill with the pop-up chevron. The period's label is
   the page on screen — «Днес», «Вчера», «Тази седмица», «Миналата седмица», «Този месец»,
   «Миналия месец», «Тази година», «Миналата година», older ones by name («Септември
   2026», «28.09 – 4.10», «вт, 29.09», «2025») — and its options are the grain: «Ден»,
   «Седмица», «Месец», «Година».
3. **The carousel:** one page per period of the grain, oldest first, from the reach's
   earliest (12 months back) to the current one, opened on the current (last) page. A
   swipe from left to right settles on the period before: the period button relabels, the
   URL is replaced (`?span&from`), and that page's report is asked for (cache first). Pages
   snap one at a time; only the page on screen and its two neighbours render content, the
   rest are empty slots. A neighbour shows its cached report when the device has one, a
   skeleton otherwise.
4. **Each page is a bento grid** of simple cards, each a figure, a word and one tiny graph:
   - «Оборот» (full width): the takings, the change against the previous period (a
     triangle shape in the trend's paint, the figure in ink — the accent law), the period's
     buckets as spark bars with the latest highlighted and the average dashed, «средно
     X на ден/седмица/месец».
   - «Работно време» (half): worked hours, «от N ч по график», a capacity bar.
   - «Бакшиши» (half): the tips, their share of the takings.
   - «Презаписали» (half): the rebooking rate (or «3 от 9» under the base), a ring.
   - «Неявили се» (half): the no-show count over its base, a ring.
   - «Екипът» (full width, the shop scope only): each barber's takings as a bar.
5. **Under the carousel** (not tied to the page): «Цел за месеца» (Revolut's Budget card:
   the range, a progress bar, the pace), «Предстои» (the next 7 days' open hours as bars,
   opening the schedule), and «Инструменти» rows — «Задай цел» / «Промени целта» and
   «Експорт» (the v2 CSV; the floating dock goes).

## A card's screen (`/staff/analytics/:topic`)

`topic` ∈ `takings`, `time`, `tips`, `clients`, `no-shows`, `team`. Its own store instance
on its own URL (`?span&from&to&barber`), opened on the home page's period and scope.

- The bar: the icon-only back; trailing, the chart switch — an icon-only segmented capsule
  (`chart.line`, `chart.bars`, `chart.ring`).
- The topic's word, the big figure, «средно X на ден · 1 – 30 ноем».
- The chart, by the switch: a smooth line with a gradient area (`uiCurve="smooth"`,
  `uiArea`), the bars, or the ring of the topic's breakdown with the figure in its centre
  (takings by service, time by part, the team by barber, the clients' rebooked/not).
- The range row: a segmented control «1С 1М 6М 1Г МАКС» and a «…» icon button. 1С is the
  week holding today, 1М the month, 6М the six calendar months up to today's (CUSTOM),
  1Г the year, МАКС the reach (CUSTOM, earliest … today). A period the home handed over
  that is none of them (a day, a past week) shows with no segment on.
- Under it, the breakdown as a list group (by service, by part, by barber); a service or
  a barber opens the v2 rows page.
- The v2 ⓘ definitions move here, one per topic.

## The custom period sheet

«…» opens a modal sheet «Друг период» with two collapsible rows, «От» and «До», each
showing its date; tapping one unfolds an inline `ui-month-picker` under it (one open at a
time), and «Приложи» in the sheet's action row applies the range (the v2 refusals stand:
up to today, within the reach, at most 366 days).

## What goes

The v2 home's long column (hero, line, stacked time bars, heatmap, open-hours card,
ranked services, clients tiles, origins, radars, the goal ring, the export dock). Their
contents move into the card screens: the heatmap and the stacked parts under «Работно
време», services and origins under «Оборот», the radars under «Екипът».

## Decisions

- **V3-D1 — One page per period, rendered lazily.** A year of days is 366 slots; content
  renders only around the page on screen, so the carousel costs one report read per
  settled page, as v2's switcher did.
- **V3-D2 — The ranges are calendar periods**, as Revolut's are (1W is 7–13 Apr, 6M is
  Jan–Jun), so a range's figures match the home page's.
- **V3-D3 — The card screens reuse the store** on their own route rather than a second
  data path; the period and scope travel in the URL.

## As built (2026-11-09)

- **The grain menu opens the current period** («Тази седмица», «Този месец») whatever
  page was on screen (`StaffAnalyticsStore.pickGrain`), as Revolut's does; a swipe is the
  only way back through the past.
- **The year carousel holds this year alone**: v2's reach (the 1st of the month twelve
  months back) refuses a period that starts before it, and last year starts in January.
- **A carousel page settles** on `scrollend`, or after 140 ms of quiet where the browser
  has no `scrollend`; the owner moves the track by setting `scrollLeft` (an instant jump).
  The rules — the pages, how far back a page sits, the range chips, the series' bucket,
  the bucket to stress, the rostered time so far, the tips' share and the tips per bucket
  — are `AnalyticsCarouselSystem` (`libs/ecs-core/src/systems/analytics-carousel.system.ts`).
- **The views each card offers** (the default first): takings line · bars · ring (by
  service); working time bars · line (worked per bucket) · ring (the six parts); tips line
  · bars · ring (tips against takings) — line and bars only where day rows place in the
  buckets; rebooked and no-shows ring, plus bars by barber on the shop; the team bars ·
  ring by barber. A card with one view shows no switch.
- **The scope pill leads with a disc**: the chosen barber's face (their monogram without a
  photo), or the shop's storefront glyph (`location.shop`), inset 6 px in the 36 px pill
  as the staff schedule's scope trigger does. The menu's shop row draws the same glyph
  disc beside the faces (`ui-choice-menu` passes an avatar option's `icon` to its disc).
- **Several locations**: with two or more locations the shop option reads «Всички
  салони» (the plural form of the location count) and each location follows it in the
  scope menu as its own storefront disc. A location's figures count every barber for
  what happened there (`?location=`, the callable's `scopeLocationId`); its card screens
  carry it, it has no goal. The stored days say which locations each day touched and hold
  each one's share of a day split across shops (ADR
  `docs/architecture/decisions/2026-11-09-analytics-location-scope.md`, definition 3).
- **Owner review, 2026-11-09 (round 2)**: both pills sit at the regular rung; the period
  pill is its word alone, no chevron. The scope menu parts the shops («Салони», captioned
  beside locations) from the people («Екип») as two sections (`UiChoiceOption.group`).
  The carousel shows Revolut's dots (`ui-page-control`: a sliding window of seven, the
  ends shrinking over a longer run). Every card wears the segmented list's fill
  (`uiTone="muted"`) in both themes, so a hover darkens it as a row does instead of
  greying a white card, and a page keeps room above and below its cards so the track's
  clip never cuts the last one.
- **Owner review, 2026-11-09 (round 3)**: the half cards are square (`aspect-ratio: 1`, the
  line under the figure at the foot), and the takings card draws its PACE instead of 30
  daily bars: the running total to today (`ui-spark-line`, accent, a dot at today) beside
  the previous period's running total dashed in grey, the period's first and last day
  under it, and a legend that words both by the same day — «Този месец 35,00 €» · «Миналия
  месец 44,00 €» (`AnalyticsCarouselSystem.paceOf`). A shorter previous period's line
  stops at its last day; a day page has no line and keeps the comparison sentence.
- **Owner review, 2026-11-09 (round 4)** — the home's tiles (`AnalyticsTile`), each opening a
  card screen: «Оборот» split like Revolut's «Spent» (the figure and the legend on the
  leading half, the pace line on the trailing); «Работно време» with a ring of how full
  the roster was («55% от 14 ч 40 мин по график», `occupancyOf`); «Свободно време» — unsold
  plus still-open time, whole hours past ten, seven weekday bars with the emptiest stressed
  and named («най-свободно: вт», `freeWeekOf`), opening the time screen; «Бакшиши»; and
  «Клиенти» — the clients served with an attendance bar and «1 не дойде» (`servedOf`),
  opening the clients' screen, where the rebooking rate now lives. A set goal can be
  removed («Премахни целта»: `setAnalyticsGoal` with no range deletes the month's goal and
  writes an `ANALYTICS_GOAL_CLEARED` audit row).
- **New clients** («1 нов · 1 не дойде» on «Клиенти»): the clients whose FIRST worked visit
  at the shop fell in the period — with the scope's barber, or at its location. The
  client-stats projection now records whom and where a client first came to
  (`firstVisitBarberIds`, `firstVisitLocationId` beside `firstVisitLocalDate`), and the
  report reads `clientStats where firstVisitLocalDate` in the period — one range, as many
  reads as new clients, no change to the stored days (`newClientCountOf`,
  `reportNewClientCount`). Considered and set aside: a per-day stored count, which would
  have read every visit's client record at each day's write and bumped the definition.
- **The takings card, round 5**: the roomier padding and gaps, a taller line, one quiet
  comparison under the figure (the dashed swatch, «Миналия месец», its figure by the same
  day — the figure itself is this period's), and a faint dot grid behind the line that
  fades toward its edges (texture, never data). The roster's whole and the free time are
  said in whole hours past ten.
- **Charts, round 6**: the line charts take a texture (`uiTexture` on `ui-spark-line` and
  `ui-line-chart`): hairlines in the ink every 6 px behind the plot, fading out toward the
  top. The card screen's line runs full bleed (`[uiInset]` keeps its figures in the page
  gutter), and the takings line there is the same running total as the home card's
  (`UiChartLinePoint.value` may be `null` past today). The range row is the regular-rung
  capsule `ui-segmented-control` — 44 px like «…», a 4 px inset round its pill, no
  hairlines in a capsule, and a slower emphasized glide.
- **A service ring paints the top service in the accent and the rest in the chart's
  greys**; the identity tones stay the people's (the team).
- **The card's figure opens its rows** (`analytics-card-figure`), which add up to it —
  v2's CUJ 8 kept.
- **The rebooked card's line reads «клиенти с нов час»**: the figure already says «1 от 2»
  under the base of 20, so the line explains instead of repeating it.
- **The custom period sheet opens pre-filled** with the period on screen (`openRange`):
  `ui-month-picker` shows no month without a selection.
- **New chart kit pieces**: `ui-spark-bars`, `ui-ring-chart`, `ui-line-chart`'s
  `uiCurve="smooth"` and `uiArea`; glyphs `chart.line`, `chart.bars`, `chart.ring`.
- **Fixed on the way**: the radars' hidden tables no longer widen the page; the line
  chart's label column grows with its longest label (PR #54, which this stacks on).

### Round 7 — reading the line with a finger (2026-11-09)

- **Tap and drag (Revolut, Apple Health)** — `ui-line-chart` gained
  `uiScrubbable` and the `uiScrubbed` output (the index under the pointer,
  `null` on lift). Native pointer events, no chart library: a hairline down
  the plot and a ringed dot on each line mark the point; the end markers and
  edge figures step back while one is read. `touch-action: pan-y` keeps a
  vertical swipe scrolling the page; a mouse reads on hover.
- **The header reads the point** — on a card's screen the big figure becomes
  that day's running total and the line under it «19 ноември · предходен
  104,50 €» (`card.readoutVersus`, one readout per point from the presenter);
  the change chip hides and `aria-live` goes quiet while scrubbing. A day
  past today keeps the period's figure and reads only the previous total.
- **The view switch is the regular rung** — 44 px like the back button and
  the range row; icon-only segments at that rung are 42 px wide with a
  20 px glyph.

### Round 8 — a quicker glide (2026-11-09)

- **The segmented glide is 200 ms** on the emphasized curve (was 480 ms, a
  marketing tier).
- A DS-wide light-mode "lift" hover (shadow instead of the wash, quiet
  buttons turning into white pills) was tried and REVERTED the same day:
  the owner found the buttons odd and preferred the cards' hover as it was.

### Round 9 — «Салони», and a grid that means something (2026-11-09)

- **«Салони»** — the shop's report over two or more salons carries
  `reportLocations`: each salon's row from its own location report (no
  extra read). Home: a «Салони» card under «Екипът». Its screen: a running
  total per salon in its identity tone, salon toggles (a legend that hides
  a line; never the last), bars by salon, and a row per salon —
  «72% заетост · 14 клиента · 3 нови» — opening that salon's analytics.
  Nested menus with checkboxes were weighed and declined: no room for a
  side menu on a phone, and a subset of salons has no goal or comparison.
- **The dot texture is gone from every chart.** In its place, on a card's
  screen: dotted rules at round amounts (`AnalyticsCarouselSystem.moneyTicksOf`,
  1/2/5 × 10ⁿ, never under 1 €) worded in whole euros at the right
  («50 €», `formatCentsWhole`), and faint guides up from each named day
  (a month's week starts, a week's days, a year's months) with the day
  under the plot. A tick's word yields to a figure it would crowd.
- **Salon toggles are quiet** — a shown salon keeps the control fill and
  its dot; a hidden one goes hollow and faded. Never the solid primary pill.

### Round 10 — the scope menu as submenus of tick boxes (2026-11-09)

- The scope menu has two rows: «Всички салони» (two or more shops) and
  «Целият екип». A row picks its list whole; a hairline and a chevron open
  its submenu in the menu's place — «‹ Салони» / «‹ Екип», then a tick box
  per shop or barber (`ui-choice-menu` `children`, `menuitemcheckbox`; a
  box keeps the menu open). Shops and barbers combine: «Младост · Нико
  Димов». The pill keeps one line and cuts with an ellipsis.
- Reports, the URL, the cache key and the goal rules take the sets — see
  the amendment in `docs/architecture/decisions/2026-11-09-analytics-location-scope.md`.
