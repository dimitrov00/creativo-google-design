# `/staff/schedule` — HIG audit, phone-first

**Date:** 2026-08-11 · **Method:** measured in-browser at 375×812 signed in as staff, across all four views, then audited under five HIG lenses and adversarially verified against the source.
**Result:** 32 candidate findings, **15 refuted**, 17 survived. One of the survivors (§1.2) is a regression I introduced earlier the same day. The refutations are as useful as the findings and are kept below — several killed proposals contradict rulings already recorded in this repo.

---

## 0. Two measurement corrections, first

Read these before trusting any number quoted elsewhere.

**Menu contents measure 8% small while the menu is closed.** `ui-menu` keeps its surface mounted and hidden under `transform: scale(0.92)`, so anything measured inside a closed popover is deflated. Corrected values:

| Control                  | Measured (closed) | Actual    | Verdict                            |
| ------------------------ | ----------------- | --------- | ---------------------------------- |
| Date-popover day cell    | 29.8px            | **~32px** | ⚠️ genuinely under 44pt            |
| Month prev/next          | 33.1px            | **36px**  | fine — the DS `small` rung, chosen |
| Row verbs (Done/Arrived) | 40.5px            | **44px**  | fine — compliant                   |

So there is **one** real touch-target violation on this screen, not three.

**The FAB does not overflow the viewport.** The `bottomGap: -3px` I measured was the _open_ state: the trigger is 52px and rotates 45°, and 52 × √2 = 73.5, so `getBoundingClientRect` returns the rotated bounding box. The real defect underneath is different and worse — see §1.

---

## 1. High — fix these first

### 1.1 Tapping a booking in day / 3-day / week does nothing

Three of the four views have no destination. `openVisit` resolves the row and sets `openMenuId`, but the only renderer for that signal lives inside the **agenda** row loop, which isn't in the DOM in grid views. The block is a real `<button>` with press feedback, so it looks live and swallows the tap.
**HIG _Feedback_:** every action must visibly respond.
**Fix:** hoist the visit action surface out of the agenda loop into a top-level sheet keyed on `openMenuId()`, sibling to the cancel sheet.

### 1.2 The block sheet docks the _destructive_ action in the thumb slot — my regression

`.ui-sheet-action-bar > [data-spread]` gets `margin-inline-start: auto`, and it matches **every** spread child, not just the first. `[data-spread]` deliberately does not grow (owner ruling 2026-07-23: "spread = the chunky ROW GRAMMAR only, never width"), so free space splits between the two auto margins and the **DOM-last** child lands flush against the trailing gutter. In the block sheet that's `staff-block-lift` — destructive, unconfirmed, and now sitting exactly where every other sheet in this app puts "yes". The confirm is pushed to the middle.

One tap in the thumb dock deletes the barber's entire exception document for the day — every blocked range at once, since the port cannot remove one among several.

Introduced by me earlier today when I wired the previously-orphaned `liftBlock`. **Manifests only at ≤760px** — the media query zeroes those margins above it — so it is a phone-only hazard, which is the context this audit was asked to favour.

**Fix:** drop `[uiSpread]` from `staff-block-lift` so it clusters leading as a secondary and the confirm reclaims the trailing dock. One attribute.
**DS-level:** the dock rule should match only the first primary-ish child, and `sheet-action-bar.ts`'s doc header still claims a spread primary "flexes into all leftover row space", which contradicts `button.css`. That stale line is plausibly how the double-spread got written.

### 1.3 The safe-area guard under the bottom bar is dead code

`env(safe-area-inset-*)` appears in the DS, but the app's viewport meta has no `viewport-fit=cover`, so every `env()` floor resolves to `0` on iOS. The bar and the FAB sit against the physical bottom edge, inside the home-indicator gesture area.
**HIG _Layout_:** keep interactive controls clear of the home indicator.
**Fix:** add `viewport-fit=cover` to the viewport meta, then re-measure the action bar and sheets — several existing `env()` guards become live at once.

### 1.4 The page action bar has no positioned ancestor

It's anchored `uiAnchor="pane"` (`position: absolute; inset-block-end: 0`), which the DS documents as pinning to its positioned ancestor — and `.staff-day` has no `position: relative`. It's currently resolving against the viewport by accident.
**Fix:** one line — `position: relative` on `.staff-day`.

### 1.5 The grid frame overhangs the viewport by the page's own padding

The frame is sized `100svh − toolbar`, then the page pushes it down another 48px of vertical padding, so its bottom edge lands 48px below the fold. The last part of every day is unreachable without the page itself scrolling.
**Fix:** give the grid its own gutters — `uiPaddingVertical` = `none` in grid views — or subtract the padding in the frame's height math.

### 1.6 The hour rail scrolls away in week view

The frame pans both axes (838 × 2810 inside 375 × 760), and only the row axis is pinned. `.staff-grid__chrome` sticks so the column heads survive vertical scroll, but the hour gutter is an ordinary grid item: after ~56px of horizontal pan, the week view has **no time axis**.
**HIG _Scrolling_** and the platform table convention: a grid that scrolls on two axes pins both headers. Apple Calendar keeps the hour rail fixed.
**Fix:** `position: sticky; inset-inline-start: 0; z-index: 4;` plus an opaque background on `.staff-grid__gutter`, `.staff-grid__zone` and the all-day label cell.

### 1.7 The date popover's day cells are ~32px

The month grid lives in a `ui-menu` sized `max-content`, landing at ~259px, so seven fluid columns get ~32px each — the smallest targets on the screen, and the **only** way to change the day.
**Fix:** the DS already ships the hook — set `--ui-menu-min-width: calc(7 * var(--control-size-regular) + 6 * var(--sys-space-tight))` (332px) on the date menu host. Keep the popover; iOS's own compact date picker anchors rather than adapting to a sheet.

### 1.8 Nothing shows that the day is loading, and stale data is presented as fresh

There is no loading branch in the template — `store.loading()` only ever _suppresses_ the empty-state sentence, so a resolving day renders as a blank screen. Worse: `loading()` is `lanesResult() === undefined`, and `toSignal` holds its last value forever, so **switching day shows the previous day's appointments under the new date** with no indication.
**HIG _Loading_ / _Feedback_.**
**Fix:** make the flag input-derived rather than emission-derived, and add skeleton lanes/columns with `aria-busy`.

### 1.9 Two failures render as confident negative answers

A failed schedule read surfaces as **"Off today: Ivan"**; a failed search renders **"Nothing matches."** Both are errors wearing an empty state's clothes — the worst possible outcome on a schedule, because both are plausible.
**Fix:** filter `workingLanes` on `lane.failed` first and exclude failed lanes from `offToday`; add a `_searchError` signal with an error-before-empty branch and a retry.

### 1.10 One verb, two acts

`primaryVerb` returns `confirmed` for a pending booking and `arrived` for a confirmed one — and the catalogue gives both the identical string. The label doesn't change after the first tap, so confirming looks like it failed and invites a second tap.
**Fix:** rename `act.confirmed` to "Confirm"/"Потвърди" and leave "Arrived" to the arrival stamp.

### 1.11 The type ladder is 1–2pt below the iOS ladder whose names it borrows

Body 15 (iOS 17), callout 14 (16), subheadline 13 (15), footnote 12 (13), caption 11 (12). Every rung from Body down is short, so the whole surface reads one step denser than an iOS user expects. Compounding it, **the 11px caption rung carries load-bearing facts** — the hour rail _is_ the time axis, and the service name on every booking sits there too — and the caption role also forces secondary ink.
**Fix:** either move the roles onto the iOS specification and absorb the layout consequences, or stop borrowing the names. Independently, promote the hour rail, event attribution and all-day chips to footnote.

### 1.12 Dynamic Type does not reach iOS

The good half: every type role is `rem` and there's no `html { font-size: <px> }` anywhere, so the ladder scales with a UA font-size preference. The gap: iOS Safari does not expose the system Dynamic Type setting that way, and nothing adjusts layout at large sizes.
**Fix:** `font-size: -apple-system-body` on the root behind an `@supports (font: -apple-system-body)` guard, so the rem ladder inherits the user's chosen size.

### 1.13 The day-view column head truncates every name

A column is (375 − 56) / 3 = 106px; minus padding and a 24px portrait, ~66px is left for a full name at 12px. All three heads truncate.
**Fix:** first name only in the day view, full name on the accessible label, and drop the portrait from the head — the toolbar's scope control already identifies who you're looking at.

---

## 2. Medium

- **The FAB's action run is a hand-rolled `role="menu"` emitted before its trigger.** Tab leaves it, nothing focuses in, Escape doesn't close it. Reuse `ui-menu`, which already does all three.
- **The date popover never receives focus on open**, Escape from the trigger doesn't close it, and `pickDay` closes the surface while the tapped day still holds focus — so focus is blurred to `<body>`.
- **No live region.** The design brief (§9) mandates one; the surface has none. Scope it to user-caused events, not the Firestore stream.
- **The grid frame isn't focusable** — 2810 × 838px of scrollable content with no keyboard or switch-control path. `tabindex="0" role="region"` with a label fixes it.
- **Week view blocks never name their date to VoiceOver.** The accessible name is "client, service, time" with no day, and there's no per-column landmark.
- **`view` and `scope` are lost on every relaunch.** `?day=` is restored deliberately; publish these alongside it.
- **Blocking time can fail silently** — two bare `return`s in `confirmBlock` produce no message, no error state and no dismissal.
- **Every write failure collapses to one generic sentence.** `BookingGatewayError.code` is a constant; the real reason lives in a `failure` discriminant this feature never reads.
- **The stale-day notice is a wrapping third sibling in a fixed-height toolbar** — the first string to break at 375px. Move it to its own band beneath.
- **`openSearch()` doesn't clear `fabOpen`** — dismissing the search sheet reveals a still-fanned FAB.
- **Cancelled bookings fail contrast** — tertiary ink, struck through, at 11–12px, over a hatch. Move to secondary ink and let the strike-through and outline carry the state (three channels already).
- **112px per hour × 24 hours = 3.7 screens per day.** A barber never sees a whole shift. Raising the short-block threshold to 45 min lets the slot height drop.

## 3. Low

- Sheet body copy sits at 13px (subheadline) where it should be body scale.
- `.staff-fab__action-label` is `nowrap` with no width cap — the longest Bulgarian label will overflow.
- `--staff-allday-offset` is referenced but set nowhere; the inner sticky is redundant since `.staff-grid__chrome` already pins head and all-day row together. Delete it.
- Three `var(--cr-font-weight-semibold)` references reach into the legacy donor token namespace; use `uiWeight="semibold"`.

---

## 4. Refuted — proposals that contradict existing rulings

Kept because re-proposing them wastes a cycle each time.

| Proposal                             | Why it fails                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Add a confirmation to No-show        | §5 of the design brief rules **undo, not confirm** — already decided and scheduled                                |
| Tint No-show destructive             | Same ruling; it isn't destructive, it's a settlement                                                              |
| Restore ± day chevrons               | **Removed by owner ruling 2026-08-07** and enforced by a live test                                                |
| Flip the row error to `role="alert"` | The cancel sheet renders the same message from the same entry — promoting it double-announces every failed cancel |
| Autofocus the search field           | Contradicts the 2026-07-23 ruling: no control autofocus in sheets/overlays                                        |
| Adapt the date popover into a sheet  | Presentation was settled; iOS's own compact date picker anchors. The real bug is width, not form factor           |
| Drop `[title]` on back-to-today      | `aria-label` carries the name, so the hover-only rule isn't engaged; the pattern is a documented ruling           |
| Add a confirmation to "Lift blocks"  | Already covered by the stated destructive-tint + named-scope ruling                                               |
| Build a staff shell with a tab bar   | Over-scoped. The real kernel: no path to account or sign-out, which bites under `display: standalone`             |
| Push history entries for sheets      | Real gap, but the proposal's mechanism was wrong; needs its own design                                            |

---

## 5. Suggested order

1. **§1.2** — one attribute, and it removes a one-tap data-loss hazard from the thumb dock. Mine; do it first.
2. **§1.3 + §1.4 + §1.5** — three small layout-contract fixes that together stop the bottom of the calendar being unreachable.
3. **§1.1** — the visit sheet. Three of four views are currently read-only.
4. **§1.8 + §1.9** — stop the surface lying: no stale days, no errors dressed as empty states.
5. **§1.6 + §1.7** — the two that make the phone actually usable: sticky hour rail, 44pt day cells.
6. **§1.11 + §1.12** — the type ladder. Cheapest now, most expensive later.
