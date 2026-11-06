# The calendar grid as a place to work — ruling (2026-11-06)

> **Status: RULED and BUILT (2026-11-06).** The owner asked for three things
> on the day / 3-day / week grid: blank time that books "like Apple Calendar,
> Fresha", with "tap and move in empty space" drawing the new event's range;
> a time-scale setting "like Teams / Outlook — 30, 15, 60 min"; and "tap and
> hold on an event to move it and/or expand it — what the sheet already
> does". Rubric of `2026-10-26-owner-rulings.md`: **C** correctness · **T**
> one source of truth · **U** UX · **M** simplicity · **R** reversibility.

## References (Mobbin, iOS)

- **Google Calendar** — a tap on blank time drops a draft block with grab
  handles; **monday.com** draws it dashed («Draft»).
- **Microsoft Outlook**, **Toggl Track** — a selected event wears round
  handles on opposite corners; dragging them resizes, dragging the body moves.
- **Mammoth** — a short list of durations (5 / 15 / 30 min, 1 h), not a free
  picker, is how a time step is chosen.

## Ruling

1. **Blank time is a target** (U, T). A tap on a column's blank space drops a
   dashed accent draft block at the slot it landed in (floored to the time
   scale's row, at most 30 minutes) with the ＋'s own menu open on it —
   «Нов час · Блокирай време», the one `#createActs` template the ＋ and the
   list's free-time rows use. A chair column seats the create on that chair;
   a date column (3-day, week) on that date, at the chair a create aims at
   (`createFromSlot`). Pointer-only: the ＋ is the keyboard's door to the same
   two sheets.
2. **Press and drag on blank time draws the range** (owner: "tap and move …
   should create an event with that time"; U). A mouse draws past 4px, as
   Google and Outlook do; a finger holds 250ms first (Apple's), because a
   travelling finger is the frame's scroll. The end follows the finger to the
   nearest snap; the release opens the same menu for the drawn range, and a
   booking from it drafts that length. **A tap or a draw stays inside its
   neighbours** (owner: "it should know about its neighbours — cap it at the
   appointment's end or start, depending on where I drag";
   `GridLayoutSystem.drawnRange`): a press in a visit's last minutes begins
   at its end, a tap's half hour and a drag down stop at the next visit's
   start, a drag up at the previous one's end. A cancelled visit gave the
   chair back and is no neighbour; blocked time is.
3. **The time scale is Outlook's** (U, M). «Мащаб на времето» says how many
   minutes a row of the calendar holds — **10 · 15 (default) · 30 мин · 1 ч**
   (`GridTimeScale`, per device, `staff-schedule-time-scale`). 5 minutes is
   left out: 288 rows is a scroll, not a calendar. The page's slot height is
   zoomed by `15 / scale`; a block is SHORT by its height, not its minutes
   (two lines need the half-hour's height at the default), and a new scale
   keeps the reader's hour. It lives under the view menu's «Настройки», now
   shown in every view: the list's sheet holds the card fields, the grid's the
   scale (`lib-staff-time-scale-sheet`). A row picks a DRAFT and the bar's
   «Приложи» applies it and closes (owner: "there should be an apply button
   at the bottom toolbar") — the filter sheet's bar; ✕ leaves the calendar
   as it was.
4. **A hold lifts a block** (U, T). A held finger, a held mouse, or a mouse
   past the threshold lifts a visit whose story is not over (`movableIdsOf`)
   — from then it is the grid's editable block, drawn by minute, with the
   sheet frame's own handles. A drag moves it by the snap; a lifted block
   released unmoved stays up for a resize (Outlook's select); a tap on blank
   time puts it down. The page grid and the sheet's frame share ONE gesture
   machine (`staff-time-grid.ts`).
5. **A drop applies itself; the sheet opens only for a decision** (U, R —
   SUPERSEDES the first build's "a drop is a draft, never a write"; owner,
   2026-11-06: "auto applying is the most common sense"). A move or resize
   released on the grid is SAVED where it landed — Google Calendar's, Apple
   Calendar's, Outlook's — and the save's receipt «Промените са запазени ·
   Отмени» is the way back, the same whole-save undo «Запази» raises. Its
   commit is the sheet's own seed with the drop laid on it
   (`snapshotCommitOf(vm, frame)`, the VM built by `editorVmOf`), so it
   carries exactly what «Запази» on an untouched sheet would, and no side
   field it never loaded. The block stays where it was dropped while the
   save travels (`setDown`); refused, it goes home with the refusal's toast.
   The SHEET opens instead, the move drafted (`uiDropped` → `withFrame`), for
   what a drag cannot say (`dropRouteOf`): a span that runs into another
   visit or blocked time, or leaves the chair's shift (the frame's own
   verdict), and a chair of a party, whose other chairs a move of this one
   may part from. A drop that moved nothing goes back down. Reversibility
   (R) is the receipt's: the first build put every drop through the sheet
   for it, before the save had a whole-save undo.
6. **The page draws every block at its own minutes** (owner: "the one
   barber finishes at 11:35 but the block reads 11:45, the group's end — he
   could take another appointment in the meantime"; C). The page grid rounded
   a block OUTWARD to the quarter hour, so a party chair ending 11:35 drew to
   11:45 and hid the gap. It now places by minute (`uiPlacement=
"proportional"`), as the sheet's frame and a lifted block already did.

## Not done

- Moving a block ACROSS columns (to another chair or date) — the gesture is
  along the minute axis only; the sheet's chair row and day pill do it.
- Dragging blocked time — a block opens its editor on a tap, as before.
- A pinch to change the scale — the setting is the one door for now.
