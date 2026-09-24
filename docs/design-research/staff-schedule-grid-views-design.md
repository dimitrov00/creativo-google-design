# `/staff/schedule` — the grid views (day · 3 дни · седмица), the settled design

**Owner ask, 2026-09-23 (verbatim):** "refactor and ensure the User Experience on all possible views in the staff/schedule. right now I really like the list view but we need to ensure that is usable and cool creative on the other views (day, 3 days, week) also decide vertical view, horizontal view like we did in the event detail sheets, time columns, scrollability etc. also i dont think there should be padding on the frame in other views idk. It has to be really responsive and well thought and have a premium feel like Apple built it."

**Status.** Shipped 2026-09-23 in one pass. Three independent designs (an Apple-parity purist, a barbershop-counter pragmatist, a responsive-layout engineer) were judged by two reviewers and synthesised into one spec; this record is that spec as built, with two deliberate departures stated in §12. The agenda (the list) is untouched. The sheets' frames — the vertical framed grid in the visit sheet, the horizontal timeline in the block sheet — are cited, not changed.

**Units.** 1 u = `--sys-space-unit` = 4px at regular density (3.68 compact, 4.32 spacious). Every figure is a unit multiple and resolves through the token, with one recorded exception: a container-query or media-query condition cannot read a custom property, so thresholds are `rem` constants (1 u ≙ 0.25rem), stated once. They track dynamic type and miss the 8% density step, which fails the right way — fewer words, never clipped ones.

---

## 0. The shape in one paragraph

In a grid view the calendar IS the screen. The page is one viewport tall and never scrolls; the toolbar sits on top and the canvas fills what is left as a flex child — no height arithmetic, no measured bar, no token guess — and the pane-anchored action bar lands on the viewport floor. Time is vertical in every view at **6 u per quarter hour (96px per hour)**, so a 30-minute cut is a 48px two-line block. The hour rail is **12 u (48px)**, opaque, pinned on the inline axis; the zone corner and the all-day label pin both ways; the now pill lives inside the rail and pins with it; the page draws 24 hour labels, not 25. A day is columned by chair at a **26 u (104px) floor** with proximity snap once the chairs outnumber the width (three fit a 360px and a 390px phone; a fourth pages); 3 дни and седмица are fluid date columns, never sideways, and a block's content degrades by the column's own width — words → title → rail — the way Apple's portrait week draws blocks without a word on them. Heads degrade the same way: full name → first name → portrait; weekday beside the capsule → initial over it; a date head is a button to that day. The all-day band is always present, its chips never leave their cell, and at the narrowest tier a chip is the chair's tone disc with the initial. The period pill keeps the day pill's numeric grammar («21 – 27.09»); the view switcher is the cluster's menu on a phone and an icon-pill segmented control from 600px of toolbar, both in the DOM. `view` and `barber` join `day` in the URL; a view switch cross-fades; turning a day keeps the reader's hour and only «Към днес» and a month pick reveal. No today wash, no half-hour rules, no dot beside the pill, no swipe recogniser, no carousel.

---

## 1. Vertical vs horizontal time on the page

**Ruling.** Every page view keeps vertical time; no page view mounts `lib-staff-timeline`. The page takes exactly one thing from the sheets — the _strategy switch keyed on the box's width_ — and answers it with paging (chairs) and degradation (dates), never with ghosting and never by turning the axis.

**Why.** The visit sheet's own record (R20) already refused a horizontal availability axis: time runs vertically everywhere else in this product. The block sheet's timeline is not a counter-example — its subject is one band across N chairs, a row-selection problem in a 240px window with no sideways scroll to spend. The page's subject is a day of bookings, and every reference the case study cites (Apple Calendar, Google, Fresha's staff columns, Mangomint, Booksy, Phorest, Square) draws that vertically on a phone. The counter's questions — who is free now, what does the next hour look like across chairs, is Thursday busy — are all "at THIS time, which chair", which the eye answers along one row; a Gantt asks it to scan down ragged rows for one x. A horizontal page at the timeline's 80px/hour shows ~4 hours across a portrait phone against ~7 down at §5's scale.

**Mechanism.** `lib-staff-time-grid` stays the single renderer and gains `uiColumnKind: 'chairs' | 'dates'` (default `chairs`, so the framed grid is untouched); the page binds `store.view() === 'day' ? 'chairs' : 'dates'` and the frame publishes it as `data-columns` — on the page only.

## 2. The frame's box

**Ruling.** In grid views the page is exactly `100svh` and never scrolls (`overflow: hidden`); the grid leaves the padded `ui-stack.staff-lanes` for a sibling `.staff-canvas` that fills the remaining height as a flex child (no padding, `uiFrameMaxWidth="infinity"`); the frame's height is a layout result (`flex: 1 1 0; min-block-size: 0`), never `100svh − offset`; `--staff-head-offset` is deleted (`--staff-toolbar-real` stays for the agenda's sticky all-day band); the pane-anchored action bar lands on the viewport floor by construction; the horizontal hairlines are ONE, under the chrome; the vertical hairline is the sticky rail's trailing edge and the first column drops its leading rule in every band.

**Why.** The three measured page defects — the frame's floor at y=925 in an 844px viewport, the body scrolling ~130px with the FAB below the fold, two sticky bands fighting — were one bug: the frame subtracted the toolbar's TOKEN floor (52px) while the bar with its week strip measured 117px. A flex child cannot be wrong about a height it never computes. The card was the second bug: 16px of stack padding and the agenda's 52rem cap put 56 + 3×104 = 368px of tracks in a 358px frame (a 10px sideways jitter) and crammed seven week columns into 800px of a 1440px desktop. The 52rem cap was written for the agenda and is right there. `svh` over `dvh`: an inner scroller never collapses Safari's URL bar, so `dvh` buys nothing and can resize the frame mid-gesture.

## 3. Time columns / the gutter

**Ruling.** The rail is **12 u** plus `env(safe-area-inset-left)` folded INTO `--staff-gutter` (a sticky inset resolves against the scrollport and ignores a scroller's padding); sticky on the inline axis with an opaque ground and the axis hairline on its trailing edge; the zone and the all-day label are sticky the same way inside the sticky chrome, so the corner holds both ways; the now pill is the gutter's LAST CHILD, so it pins with the rail and shares the columns' basis by construction (no `--staff-body-pad` correction); the page draws **no closing midnight label** — 24 rows, not 25 — and an extent stretched past midnight prints its «00:00» as the 25th hour's OPENING label; the frame is a focusable `role="region"` named for its period (`staff.day.gridRegion`) with an inset focus ring.

**Z-order, for the record.** Chrome 5 · gutter 4 · now-line 3 (inside its column, which is not a stacking context — so it must sit under the rail's own z, or it crossed the rail the moment the first chair slid under it) · blocks 2 · zone/all-day label 6 inside the chrome's own context · the now pill 4 inside the gutter's own context. The chrome rides ABOVE the rail or hour labels paint through the names; the pill disappears under the head at the top edge, as Apple's does. The chrome's box is the scrollport's width while its bands run to the tracks' width, so the ground and the one hairline are painted on the bands.

## 4. Column width strategy per view

**Ruling.** One template for every view — `var(--staff-gutter) repeat(N, minmax(var(--staff-column-min), 1fr))` — with `--staff-column-min` = **26 u (104px)** under `data-columns='chairs'` (chairs page sideways with `scroll-snap-type: x proximity` and `scroll-padding-inline-start: var(--staff-gutter)`, every band's cell a `scroll-snap-align: start`) and **0** under `data-columns='dates'` (fluid, never sideways — a zero floor turns the bands' intrinsic width into "fit"). The head cell, the all-day cell and the column are query containers (`container: staff-column / inline-size`, page only) and share a track by template, so they cross every threshold together:

| container width | block                                      | chair head                        | date head                | all-day chip        |
| --------------- | ------------------------------------------ | --------------------------------- | ------------------------ | ------------------- |
| ≥ 9rem (36 u)   | words + clock (the head's own 144px query) | full name + portrait              | weekday + capsule        | «Нико почива»       |
| 5.5–9rem        | words                                      | first name + portrait             | weekday + capsule        | «Нико почива»       |
| 5–5.5rem        | title only                                 | first name + portrait             | weekday + capsule        | «Нико»              |
| 4–5rem          | title only                                 | portrait alone (its own monogram) | initial OVER the capsule | «Нико»              |
| < 4rem (16 u)   | rail + tint                                | portrait alone                    | initial over the capsule | tone disc + initial |

A date head is a button (`staff-grid-head-day`) that opens that day in the day view — Apple's own week-head tap. The head cell carries the whole name or the long date as its accessible name at every width; the block's accessible name carries client, service and times at every width.

**Phone numbers at regular density.** 390 → day (3 chairs) 114px: words, first names; 3 дни 114px: same; седмица 49px: rail-only blocks, initials, discs. 360 → day 104px exactly (no sideways scroll), 320 → 104px with 40px of pan and the rail pinned. Tablet 834 → седмица 112px (words). Desktop 1440 → седмица 199px (words with the clock), day 464px (full names).

## 5. Scale

**Ruling.** `--staff-slot-height: round(calc(var(--sys-space-unit) * 6), 1px)` — 24px a quarter hour, 96px an hour, on whole pixels at every density (the plain `calc` stated first for an engine without `round()`). One scale for every view and viewport; landscape keeps it. `SHORT_BLOCK_MINUTES` stays 30, re-measured: 48px less 1px margins and 3px padding each way is 40px for ~31px of two lines. No pinch-zoom or scale steps in this pass; the token is the single future knob (a pinch would set it on the frame with the minute under the fingers held via `scrollTop`).

## 6. Scrollability & navigation

**Ruling.** Only the frame scrolls (both axes, native momentum, `overscroll-behavior: contain`, `overflow-anchor: none`); chairs snap per column; period paging is the week strip and the day pill — **no frame swipe in this pass**; the grid reveals (a quarter down on now, else the first rostered minute, else 08:00) on first mount and on JUMPS only — «Към днес» and a month-picker pick, keyed on the store's `revealKey` counter; turning a day from the strip and switching view or scope keep the reader's minute; «Към сега» appears on today once the now-line has left the frame (reported by the grid's own scroll path as `nowInView`) and glides back to it; off today the same button is «Към днес».

**Why the kept minute needs no restoring effect.** The chrome is both in flow (pushing the body down by its height) and sticky at the top (covering the same height), so the minute at the chrome's seam is `(scrollTop − bodyPad) / pxPerMinute` whatever the chrome's height. With one scale, a kept `scrollTop` IS the same minute across a view switch or a day turn. The frame element persists across column re-renders; only the `@for` children churn.

**Why no swipe.** A pointer recogniser on a box that scrolls vertically and hosts a 250ms hold-to-drag is three gestures on one surface; a three-panel snap carousel is the right shape if swiping is ever wanted (the browser arbitrates x-snap vs y-scroll) but the most expensive machinery to keep correct. The strip already turns periods on the compositor and is Apple's own ribbon. Recorded as the door: the carousel, never a pointer handler, with a fixed swipe meaning per view.

## 7. Responsive tiers

**Ruling.** Tiers are the container's width and the viewport's height, never device classes. A short viewport (`@media (max-height: 30rem)`, a phone held sideways) folds the week strip away in the grid views (the day pill still opens the month), keeps the all-day row and the scale, and the rail absorbs the notch. On a wide bar the strip is capped at 52rem and centred so its discs stay finger-spaced. `--sys-container-content: 52rem` applies to the agenda only. Density is the reader's `data-density` and is never set per tier.

## 8. All-day row

**Ruling.** Always present on the page in every grid view (min 8 u), with a hairline above it as well as below (owner, 2026-09-23: a row of its own between the names and the hours), and every cell two kinds of door: its blank space a BUTTON laid under the chips (`staff-grid-allday-add`) that opens the block sheet with «Цял ден» already on, and every chip a BUTTON (`staff-grid-allday-chip`) that opens THAT chair's day off on that date to edit or lift it («+N» opens the date itself); a button cannot hold buttons, so the cell is a plain box with the add button filling it beneath the chips — for that chair on the shown day in the day view, for the create chair on that date in the date views, the frame drawing the tapped day (a whole-day fact sits in that band, so that is where one is made; in a sheet's frame both are pictures). The sheet's lift takes the OPENED day, not the shown one. It grows to hold its chips stacked one per line, capped at three with a «+N» fourth (`staff.day.allDayMore`); a chip never leaves its cell (the cell is a column, `overflow: hidden`); the chip wears the block's tone wash and degrades by §4's table; in the day view the chip states the fact alone («Почивен ден»); `allDay` is typed (`AllDayEntry`: label, shortLabel, initial, tone, accessibleName) and only the dashboard binds it.

## 9. Toolbar

**Ruling.** In 3 дни and седмица the period pill takes the day pill's numeric grammar through `formatDayPillRange` («21 – 27.09» inside a month with the shared month said once on the side the locale puts it — «Sep 21 – 27» in English — and `Intl`'s own `formatRange` across a month or a year); the pill may shrink and clip before the cluster does. The view switcher is the `ui-choice-menu` below **37.5rem (600px) of toolbar** (`container: staff-toolbar / inline-size`) and an icon-only capsule `ui-segmented-control` at `regular` from there, both rendered, one `display: none`; segments take `staff-view-segment-{id}`. The menu holds VIEWS ONLY (owner, 2026-09-23, HIG pull-down menus hold one kind of item): «Блокирай време» left it, and blocking time has one door, the ＋ menu's «Блок», with the other acts.

## 10. Persistence & transitions

**Ruling.** `view` and `barber` join `day` in the URL (`?view=week&barber=<id>`; agenda and everyone are absent), published through one `publishQuery` — `replaceUrl: true`, the published record as the echo guard, and the write **deferred to the next task and coalesced** (see §13); the last view is mirrored to `localStorage['staff.schedule.view']` in `try/catch` and restored when the URL is silent, and the restored view is STATED in the URL from the first frame; scope is never remembered across sessions, and a chair the catalogue does not know resolves to everyone once the catalogue has answered. A view switch cross-fades the canvas through `runViewTransition` (`shared/view-transition.ts`, lifted from the frame's full screen — reuse, never copy); day changes are instant; reduced motion switches without animation.

## 11. Premium details

No wash on today's column — the head's accent capsule is the only mark (the accent already means NOW; hue means WHOSE). The now pill stays the accent capsule in the rail, flush to the column boundary. Hour rules only, one hairline weight, on whole pixels. The elapsed hatch is the only past treatment. Every sticky surface is opaque `--sys-color-background`, never material. Every new hover has its ungated `:active` mirror; every `font:` shorthand re-asserts tabular figures. Dark keeps the 28% block alpha and the disc's 36% in both themes.

---

## 12. Departures from the synthesised spec

1. **No `viewport-fit=cover`.** The spec asked for it so the safe-area floors go live. It wakes every dormant `env()` guard in the design system at once (the page action bar, every sheet dock, the toolbar's inline padding) and needs a notched device in both orientations to re-measure. The `env()` terms are in place (the rail, the footer, the bands' trailing edge) and resolve to zero until the meta tag changes; the tag is the owner's call.
2. **No per-column ceiling on wide displays.** The spec proposed 72 u (288px) per column with the frame's ground continuing to the right. Apple's day view and Fresha's staff columns fill the window; the panel's own risk list flagged a detached ＋ over empty canvas. Columns fill.

## 13. What the build taught (2026-09-23)

- **An effect must not depend on the signal it writes.** The route-input effects call the store from inside their tracked context; the store's publisher read the published record before writing it, so the effect came to depend on the record it changed and re-ran on its own write, synchronously, forever — the first silent URL after a remembered view hung the tab. The store now reads the record `untracked`, and every store call from a route effect is wrapped in `untracked(...)`.
- **A route-bound input receives `undefined`, not its default, for an absent parameter.** The binder sets every declared input from the route's data. Both are read as "silent" before any comparison.
- **Never navigate from inside the page's first activation.** A `router.navigate` inside change detection during the first navigation re-enters the router before it has settled (`router.navigated` is still false, so even the same URL is processed anew), which re-activates the page. The URL write is deferred to the next task and coalesced: three writes in one tick are one navigation with the final record.
- **The review pass (four lenses, two skeptics per finding) caught what the live pass could not.** The router starts a view transition on every navigation and the platform allows one at a time, so the deferred URL write was cutting the canvas's cross-fade a few milliseconds in — the write now waits for `settledViewTransition()`. A `display: none` strip forgot its `scrollLeft` on rotation — it collapses to zero height with hidden visibility instead. The sticky chrome's box is the scrollport's width while its bands run to the tracks' width — the ground and the hairline moved onto the bands. A custom property declared twice is not a fallback (the later `round()` always wins) — it is an `@supports` block now. `aria-label` on a plain span or cell is forbidden by the generic role and ignored by most readers — the chip and the chair head carry a hidden span instead, the date button keeps its label and gains `aria-current`. «Към сега» removed itself under the keyboard — it focuses the region it scrolled. The «+N» cap collapsed one chip early; chips are keyed on the chair, not the sentence; an unknown `?view=` falls back to the list; a silent arrival from the site menu restates the view; a jump reveals only once the asked day's lanes are on hand (`store.settled`). And the day pill's shrink rules in the page's scoped stylesheet could never reach the pill's own template — they live in the pill's stylesheet, with the label ellipsising and the focus ring left uncut.
- **A component stylesheet has a budget.** The canvas's own recipe crossed the app's 20 kB per-stylesheet line once the page's chapter was added; the page-only rules live in `staff-time-grid.page.css` (a second `styleUrls` entry) — its own chapter, unscoped like the rest.

## 13a. Companion rulings on the block sheet (owner, 2026-09-23)

- **The view menu holds views only.** «Блокирай време» left it; blocking time has one door, the ＋ menu's «Блок», with the other acts (HIG: a pull-down menu holds one kind of item).
- **A destructive act on a saved thing is a row, not a bar control.** The block sheet's lift was a plain red text button alone in the dock ("just text ghosted"). It is now the last row of the sheet's exits group in the visit sheet's grammar — destructive ink on a list row, Calendar's own «Delete Event» — arming on the first tap («Да, освободи целия ден», the warning beneath) and lifting on the second. The dock holds «Запази» alone and hides when there is nothing to save. The lift takes the OPENED day, which a date column's band may have set.

## 13b. Companion rulings on confirmations and the toast (owner, 2026-09-23)

- **A confirmation is an ALERT, not a second sheet.** «Отхвърли промените?» and the zone notice presented as fitted modal sheets over the sheet whose ✕ asked — a card with a large title and a dock, "a second sheet appearing". They are `ui-alert` now, a new DS pattern ≙ SwiftUI `.alert`: the platform's centred 270pt card of near-solid thick material over the scrim, the question and one sentence centred, the answers as hairline-divided text rows — two short ones side by side with Cancel leading, longer ones stacked with Cancel last — the destructive one in the destructive ink, the safe one bold. Built on the native `<dialog>` shown modally (top layer, focus trap, `inert` beneath, Escape, focus restore); it pops in from 1.12× on the emphasized curve and fades out; reduced motion switches. Escape and the scrim mean the `cancel` answer. Test ids `staff-discard-sheet`, `staff-discard-keep`, `staff-discard-confirm`, `staff-zone-sheet` survive on the alert.
- **The review pass on the alert (three lenses, two skeptics per finding) fixed ten things before shipping:** the alert's answers carried two hover grammars (the modifier's and its own) and the modifier's press shrink; the row-vs-stack decision counted characters where the platform measures, so the pair is now tried side by side and MEASURED, stacking on any wrap; Return at the surface gives the preferred answer and Escape/Tab stop at the dialog so a sheet around it never hears them; the scrim carries the token's literal for engines whose backdrop cannot read a custom property; the card's fill rose to 96% so the accent ink keeps 4.5:1 over a dark ground; the toast's label breaks unbreakable tokens. Two older defects the alert exposed: the visit editor's catalogue key listener typed under a modal dialog (it now yields to any open dialog), and a drag-to-dismiss the guard refused left the sheet sunk (the drag offset now resets when the gesture ends).
- **The owner's look at the alert (2026-09-23, later) changed three things.** (1) _"Each row looks a different height"_: the two answers were both 44px, but the second drew its hairline INSIDE its box and the first did not, so their labels sat a pixel apart and the bold one read shorter still. The hairlines between answers are paint now (a one-pixel shadow outside the later sibling's box, clear of the modifier's state layer), every answer is a centred grid cell, and the rung is the LARGE control (52pt): an alert's answers are the most important buttons on the screen and this app's primary buttons are 52pt. (2) _"The danger action looks the same as the main CTA"_: the platform tints its answers, but the sanctioned accent is an orange one step from red, and «Отхвърли» in the destructive ink beside «Продължи редакцията» in the accent read as two shades of one colour. Answers are LABEL INK now; only the destructive one is coloured; the preferred one is bold — danger by colour, default by weight. (3) _"Isn't it too small?"_: the platform's 270pt is scaled to 17pt text and 44pt rows; against this app's 52pt buttons and 60pt rows it read as a small card. The measure is a token now, `--sys-container-alert: 20rem` (320px, the viewport minus its gutters on a 320px phone), still a card and never a sheet. The row-vs-stack character floor rose with it (13), and the review of this pass made the measurement honest: it compares the label's own box with the answer's CONTENT box (scrollWidth only reports overflow past the padding, so a bold 13-letter Bulgarian answer on a 320px phone, where the card is 288px, spilled into the padding unseen), and a stacked answer breaks inside a word wider than the row (`overflow-wrap: anywhere`; `break-word` is dead on a grid item).
- **The toast is a pill of the house material.** It was a drawer-wide bar of the thick material with a literal shadow and an 8px slide. It hugs its sentence now (a capsule, the drawer measure only its ceiling), wears the DS thick tier at a near-solid 92% fill with a hairline ring and the overlay token's lift, clamps to two lines, and lands from below with a breath of scale on the entrance curve at the slow tier. The clock ring, the hold and the exit are unchanged (2026-09-11 rulings).

## 14. Open

- Pinch-to-zoom (§5); the period swipe as a carousel (§6); `viewport-fit=cover` (§12).
- The stale-day notice still wraps as a third sibling in the toolbar at 320px (the phone audit's Medium).
- The visit editor's stylesheet is over the same 20 kB budget from work outside this record; the production build reports it.
- A real iPhone should confirm the sticky rail through a diagonal flick in the chair-columned day (the flex-band construction is the recorded WebKit fallback) and the container-query tier pairing at 767/768px.

## 15. Verified

Unit: 338 cases green (11 new). Live, Chromium: 390×844 — day (three chairs at 114px, first names, no sideways scroll, no page scroll, the FAB on the floor), 3 дни, седмица (49px rail-only columns, initials over capsules, discs in the all-day band); 320×640 — three chairs at 104px, 40px of pan with the rail, the corner and the now pill at x=0; 844×390 — the strip folded, the segmented switcher, 337px of day; 834×1194 and 1440×900 — the canvas fills the display, the week at 112/199px with words. Behaviour: `?view=week&barber=ivan` round trip; the remembered view restored and stated on a silent URL; «Към сега» appearing when scrolled away and gliding back; a view switch and a strip turn keeping `scrollTop`; the head tap opening that day; the agenda untouched (52rem, its stack, page scroll).

## 13c. An hour that did not happen, recognised at a glance (owner, 2026-09-24)

The owner, on a cancelled card: _"besides strikethrough for no show and for
cancelled event would you recommend something else so it's instantly
recognised?"_ Everything on that card but a 1px strike still said "live":
the full-colour rail, the countdown «след 27 мин», the tags. Two changes,
in both views, form and a word — never a hue (§ status is form):

- **The state, in one word, where the eye looks for "when".** The agenda
  card's gloss under the clock reads «Отказан» / «Не дойде» instead of a
  countdown to a visit that will not happen — in the foreground ink and
  the weight (`glossState` on the shared event head), shown whatever the
  relative-time field says. The calendar block has no countdown and
  withholds its clock on a narrow column, so there the word takes the line
  under the name (the service). ONE word, not «Отказан от салона»: at a
  phone's width the phrase widened the clock's column and broke the
  service line in two; whose act it was is the sheet's head, one tap away.
- **A hollow rail.** The rail — the card's strongest glance cue — becomes
  an outline in the barber's tone instead of a bar, on the card and the
  block alike: the grid's "filled is live, unfilled is time that was lost"
  said by the rail too. Still the barber's colour; identity, not state.

Not done, on purpose: no grey and no fade for a cancellation still ahead
(it is the hour that just came free), no red (a cancellation is not an
error).

**The same day, the owner: _"do 3 and 4 as well."_**

- **The live-only marks go.** The catalogue tag («−15 мин») says how far a
  run is from the catalogue's length — nothing, for a visit that will not
  run. A hollow card and a hollow block no longer draw it; the party share
  and the note stay, being facts about the booking, not the run.
- **The glyph rides the face.** The state's glyph (`visit.cancelled`,
  `visit.noShow` — the grid block's and the sheet's own) leaves the foot
  for a badge on the client's disc at the BOTTOM LEADING corner: on the
  edge where a glance starts, level with the party's «+N» opposite it and
  in its dress — foreground disc, background ink, the card's cut-out ring.
  A glyph, never a coloured dot: the arrival dot that sat on this disc was
  removed for reading as a presence light. The top corner was tried first
  and crowded the start of the struck name. With the client's face
  switched off, the foot carries the glyph again. The block has no face;
  its mark row keeps the glyph.

**And for a no-show (owner, same day: _"do the same for no-show
visits"_).** Every piece above keys on BOTH hours that did not happen, so a
no-show reads «Не дойде» where the countdown stood and on the block's
line, wears the hollow rail, drops the tag, and carries `visit.noShow` on
the face — verified on a real no-show of the seed and pinned in a spec.
Checking it found the block's glyph map missing the other half: a
CANCELLED block drew no glyph at all while the card's face and the sheet
carried one; `STATUS_ICONS` holds `cancelled: 'visit.cancelled'` now.
