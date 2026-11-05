# The schedule's bar filter and view options — ruling (2026-11-05)

> **Status: RULED and BUILT (2026-11-05).** The owner asked for the bar's
> leading control to "be for filter, so it should filter by statuses", and
> for the view select to "be like settings" holding what the event card
> shows, with the placement left to this pass. Rubric of
> `2026-10-26-owner-rulings.md`: **C** correctness · **T** one source of
> truth · **U** UX · **M** simplicity · **R** reversibility.

## What was there

- The bar's leading control (`action.filter`, the funnel) opened the card
  FIELDS sheet: which facts an agenda card carries (`agenda-fields.ts`).
  The glyph's own registry note says "narrow what a list shows" — it was
  borrowed for a dial.
- The top trailing cluster's view menu held the four renderings only.
- Nothing hid a visit by its state.

## References (Mobbin, iOS)

- **Status filters** are a show-list: one row per state, its mark and a
  switch, live (Cursor's «Status», Luma's events pull-down with its state
  glyphs, Wealthsimple's status checklist).
- **View options** put the layout choice above the "what to show" switches
  (Jobber's «View Options», Notion's «Layout»); iOS Files puts «View
  Options» under the layouts of the same pull-down.

## Ruling

1. **The bar's funnel filters by STATE** (U, T). It opens a sheet
   (`lib-staff-status-filter-sheet`) with a row per booking state — the
   calendar's own mark (`BOOKING_STATUS_ICONS`), the search's word, a
   switch — acting at once, «Покажи всички» in the sheet's bar only while
   something is hidden. It applies in EVERY view (list and grid), so the
   control shows in every view. Per device, like the card fields
   (`ScheduleStatusFilter`, `staff-schedule-hidden-statuses`).
2. **It hides by each chair's OWN state** (C). The rows are built first and
   filtered after (`ScheduleFilterSystem.shown` over `DayRowVm`), so a
   party's cancelled seat leaves with the rest while its live chair stays.
3. **It decides what is DRAWN, never what is true** (C). Free time, the
   day's tips (`dayTipsLine`), sheet frames and the search read every visit.
4. **A filtered schedule says so** (U). The funnel wears the accent tint
   (`bordered`, no `neutral`) and an accessible «Филтър, включен» while any
   state is hidden — the answer to `agenda-fields.ts`'s worry that hiding
   «ОТКАЗАН» is "a way to miss a cancellation": that was a silent field on
   a drawn card; this is a whole-card choice behind a lit control.
5. **It names the HIDDEN states** (R). A state added later is drawn until
   somebody hides it; a stored list from an older build cannot hide it.
6. **Card fields move under the view menu** (U, M). A second group under
   the four renderings, «Полета на картите…» (`calendar.cardFields`, the
   `tune` sliders), list view only — a calendar block has no card. The
   view menu still holds no ACT (the 2026-09-23 ruling): fields are how the
   day is drawn, like the rendering above them.

## Not done

- A one-tap preset ("Hide cancelled") in the funnel itself — the sheet is
  one tap deeper; add it if the sheet proves to be opened only for that.
- Syncing the filter per account — per device by design, as the fields.
