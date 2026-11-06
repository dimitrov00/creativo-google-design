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
   switch. The switches edit a DRAFT (owner: "apply and reset"): the bar's
   «Нулирай» (leading, greyed while nothing is hidden) sets it back to
   everything drawn, «Приложи» (trailing, the primary) takes it to the
   schedule and closes, ✕ leaves the schedule as it was — the Zocdoc,
   Beli and Insight Timer bar. It applies in EVERY view (list and grid), so the
   control shows in every view. Per device, like the card fields
   (`ScheduleStatusFilter`, `staff-schedule-hidden-statuses`).
2. **It hides by each chair's OWN state** (C). The rows are built first and
   filtered after (`ScheduleFilterSystem.shown` over `DayRowVm`), so a
   party's cancelled seat leaves with the rest while its live chair stays.
3. **It decides what is DRAWN, never what is true** (C). Free time, the
   day's tips (`dayTipsLine`), sheet frames and the search read every visit.
4. **A filtered schedule says so** (U). The funnel wears an accent DOT on
   its corner (`uiDotBadge`, the DS button's `.badge()` mark — owner,
   2026-11-06: "a dot indicator like other apps"; Canva's filter count,
   said as a dot) while its own tint stays `neutral`, and an accessible
   «Филтър, включен» while any state is hidden. It used to wear the whole
   accent tint, which read as a pressed or primary control — the answer to `agenda-fields.ts`'s worry that hiding
   «ОТКАЗАН» is "a way to miss a cancellation": that was a silent field on
   a drawn card; this is a whole-card choice behind a lit control.
5. **It names the HIDDEN states** (R). A state added later is drawn until
   somebody hides it; a stored list from an older build cannot hide it.
6. **Card fields move under the view menu** (U, M). A second group under
   the four renderings, «Настройки» (`calendar.cardFields`, the `tune`
   sliders; owner: "it could be just settings"), list view only — a calendar block has no card. The
   view menu still holds no ACT (the 2026-09-23 ruling): fields are how the
   day is drawn, like the rendering above them.
7. **Blocked time is filterable too, and the list draws it** (owner:
   "blocked blocks should be able to be visible"). A second group in the
   sheet, «Блокирано време» (`booking.blocked`), its own stored switch
   (`staff-schedule-hide-blocks`), on by default. The list, which drew only
   visits and free time, gains a BLOCK row (`AgendaRow.Block`,
   `blockRowVm`): the grid block's word, length and neutral rail on the
   hole's line, its id the grid block's, so a press opens the block editor
   through the same `openBlock`. Hiding it takes the grid's blocks too.
8. **Free time joins blocked time in the filter, and a hole is a door**
   (owner: "free time as an option, as blocked time … on click the same
   menu as ＋"). «Свободно време» (`booking.slot`) moved from the card's
   fields to the filter's second group, OFF by default as before, read
   once from a device's old `staff-agenda-fields` choice. Showing it draws
   MORE, so it never lights the funnel; «Нулирай» returns to the defaults.
   A sellable hole in the list is the trigger of the ＋'s own menu, «Нов
   час · Блокирай време», on that hole's chair: a booking starts at the
   hole's start, a block takes the whole hole (`openCreate(intent, gap)`).
   The grid draws no holes — its empty space already is the free time.
9. **Free and blocked rows carry the event's clock** (owner: "the same
   range as the events … start and end time, not just duration"; U, T).
   Both mount the visit card's own head (`lib-staff-event-head`): the word
   and the length on the left (the length led by the filter's glyph,
   `booking.slot` / `booking.blocked`), start over end on the right. The
   head's new `quiet` state sets the word in the facts' ink at the regular
   weight, so names still lead the run. This overturns the earlier choice
   to leave a hole's start to its group heading: the heading reads one
   minute for several chairs.
10. **A hole is the chair's real empty time; «Нов час» waits out the
    turnaround** (owner: "the free time start is incorrect" — a hole drawn
    from 11:45 after a cut ending 11:35; C, U). The lane's busy spans were
    padded by the barber's turnaround before the roster was cut by them,
    so every hole lost the reset on both sides. They now arrive as stored
    (`laneGeometryOf` hands the turnaround over beside them): Иван's chair
    reads 10:00–11:00 and 11:35–16:00. The turnaround still binds a NEW
    client, so «Нов час» from a hole starts at
    `GridLayoutSystem.bookableFrom` — 11:45 there — where the commit's
    padded check (`AvailabilitySystem.paddedBusy`) will take it; a block
    still takes the whole hole. The day's free total now counts the
    reset minutes as free: they are empty chair time.
11. **The clock never cuts a hole; it decides what opens from one**
    (owner: "the free time shown should not depend on now … when opening
    to block time and schedule an appointment it should depend on now, and
    if passed makes no sense to be interactive"; C, U). A hole that
    straddles now is ONE row with its whole range — 13:00–15:00 at two
    o'clock as at nine (`GridLayoutSystem.sellableAt` no longer splits).
    It stays a press while at least the 20-minute floor of it is ahead;
    after that it is an elapsed line with no menu. What opens from it
    starts at `GridLayoutSystem.openFrom` — the hole's start, or the next
    5-minute tick of now — a block running to the hole's end and a
    booking also after the turnaround (`bookableFrom`).

## Not done

- A one-tap preset ("Hide cancelled") in the funnel itself — the sheet is
  one tap deeper; add it if the sheet proves to be opened only for that.
- Syncing the filter per account — per device by design, as the fields.
