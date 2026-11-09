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
   menu. Trailing, the period menu in the accent ink (Revolut's «This month»): its label is
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
