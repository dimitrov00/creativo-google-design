# Hand-rolled CSS audit — DS adoption gaps

_Audited 2026-07-23 (post closing-CTA removal / neutral-tint / adaptive-sheet wave). Four parallel
sweeps: landing sections+shared, landing pages+header, client/staff/admin features, app shells +
global styles + DS internals. Every `.css` file, inline `styles:` block, and template was read in
full. Findings respect existing `KEPT:`/“Sanctioned”/owner-ruling annotations — those appear only
in §5 when they look questionable under current rulings._

**Overall health:** the app features (client/*) are exemplary — fully DS-composed, zero hardcoded
values. `apps/web` is clean. The landing is heavily migrated with well-annotated keeps. The two
places with real work: a handful of **control lookalikes hand-rolled in the landing**, and a set of
**token gaps / duplicated grammar inside `libs/ui` itself** (the DS not eating its own dog food).

---

## 1 · HIGH — DS controls re-implemented locally

> **STATUS: ✅ batch 2 executed 2026-07-23.** DS grew three small extensions to absorb the
> lookalikes: `span[uiButton]` (decorative button-chrome affordance inside a larger control),
> `li[uiListRow]` + `uiSelected` (semantic-list rows, SwiftUI List selection tint), and
> `ui-progress-view [uiValue]` (the determinate linear bar, ≙ `ProgressView(value:)`).
> Consumers converged: explore affordances (team-showcase + locations) are stroked
> capsule/icon-chip buttons; the schedule is `li[uiListRow]` rows with today as `uiSelected`;
> the work-gallery progress is the DS bar; the bundle chip lost its magic z-index and rides a
> space-unit size. Bonus fix: `[data-weight]` modifier rules now out-specify component-recipe
> baked weights (the explicit-override contract was silently losing to `.ui-list-row`'s 500).
> The judgment call: the 1.5px "signature" affordance border became the DS strokedBorder ring
> (28% currentColor) — revert by re-ruling if the heavier weight is missed.

| #   | Where                                                                                                                                                                                                               | What                                                                                                                                                                                                                                                        | Adopt instead                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | `libs/features/marketing/landing/src/lib/landing-shared.css:145-177` (`.explore-affordance*`) + consumers `team-showcase.component.html:66-82`, `locations.component.css:124-144` (`.location-card__explore-label`) | Hand-drawn bordered-capsule “Explore” button lookalikes: `1.5px`/`1px solid` borders, `--control-radius-capsule/regular`, `--control-size-small/regular` boxes, hover state-layer fills — the button vocabulary redrawn by hand (decorative, `aria-hidden`) | `uiButton` (`strokedBorder`/`bordered`, `uiIconOnly` glyph box) rendered non-interactive, or a `span[uiBadge]`; the ruling “landing-local, single consumer cluster” predates `uiTint`/current button coverage — worth re-ruling |
| 1.2 | `locations.component.css:344-372` (`.location-sheet__day`)                                                                                                                                                          | Hand-rolled schedule list row: flex + gap + `--control-size-regular` min-height + radius + tinted `[data-today]` selected state                                                                                                                             | `ui-list-row` with the today row as selected (`--sys-alpha-segment-selected` tint is already on-ladder)                                                                                                                         |
| 1.3 | `work-gallery.component.css:114-132` (`.cr-gallery__progress*`)                                                                                                                                                     | Hand-rolled scroll-progress bar (3px track, 6rem width, JS `scaleX` fill) — no sanctioning comment                                                                                                                                                          | `ui-progress-view`, or tokenize + annotate as a deliberate keep                                                                                                                                                                 |
| 1.4 | `service-tile.component.ts:186-200` (`.cr-services__bundle-chip`)                                                                                                                                                   | Badge/chip lookalike (28px floating disc). The shape keep is sanctioned, but `z-index: 20` and the 28px box are unnecessary deviations inside it                                                                                                            | Keep the disc if ruled, but move to `--sys-layer-*` + a control-size/ladder-derived size; ideally `span[uiBadge]`                                                                                                               |
| 1.5 | `libs/ui/controls/src/lib/button/button.css:309`                                                                                                                                                                    | `:active { transform: scale(0.98) }` **contradicts the DS's own token** `--sys-press-scale-control: 0.97` (tokens.css calls it one of “the only two sanctioned values”)                                                                                     | `transform: scale(var(--sys-press-scale-control))`                                                                                                                                                                              |

## 2 · MED — token gaps & duplicated grammar inside `libs/ui`

> **STATUS: ✅ batch 1 executed 2026-07-23** (together with 1.5): press scale → token, disabled/
> loading opacity → `--sys-opacity-disabled/-loading`, focus ring → `--sys-focus-ring-width/-offset`
> (button/chip/modifiers), field glow unified on `--sys-focus-glow-width/-alpha` at 25% (otp was
> 20%), glass blur → `--sys-material-regular-blur`, spread insets → `--control-spread-inset-*`,
> card padding ladder deduped onto the shared modifier, date-badge outside-day opacity dropped,
> rating GRAD axis aligned with icon.css. Deferred from batch 1: the **dot geometry reconcile**
> (date-badge 4px vs status-indicator 8px — a visual change; needs an owner ruling first).

- **Disabled opacity literal ×3** — `button.css:312`, `chip.css:41`, `text-field.css:66` all hardcode
  `opacity: 0.4`; `--sys-opacity-disabled: 0.4` exists and was “promoted to a token so … controls
  share a single value”. → use the token.
- **Focus ring copied ×3** — identical `outline: 2px solid var(--sys-color-ring); outline-offset: 2px`
  in `button.css:315-318`, `chip.css:35-38`, `modifiers.css:200-203` (whose comment admits the copy).
  → promote `--sys-focus-ring-width/-offset` (color token exists) and consume everywhere.
- **Focus glow divergence** — `text-field.css:53-54` (accent 25%, 3px) vs `otp-field.css:28-29,39-40`
  (accent 20%): same concept, two recipes. → one shared focus-glow recipe/token pair.
- **Glass blur literal** — `button.css:101-102` `blur(20px)` twice; `--sys-material-regular-blur: 20px`
  exists. → `blur(var(--sys-material-regular-blur))`.
- **Spread padding literals** — `button.css:205` `padding-inline: 1.2rem 1.05rem` (off-scale, not
  annotated). → space tokens or promote `--control-spread-inset-*`.
- **Card padding ladder duplicated** — `card.css:18-38` restates the seven-token `[data-padding]`
  ladder from `modifiers.css:78-98` verbatim. → let the modifier own it, or annotate why the
  specificity restatement is required.
- **De-emphasis via opacity** — `date-badge.css:16-17` stacks `opacity: 0.5` on secondary-label ink;
  `list-row.css:78-79` states the principle “de-emphasis through the foreground role, never opacity”.
  → drop the opacity.
- **Two DS dot geometries** — `date-badge.css:32-34` (4px marker) vs `status-indicator.css:23-24`
  (0.5rem, “ONE dot geometry”). → reconcile onto one shared dot size.
- **Loading dim literal** — `button.css:306` `opacity: 0.65` (no token; distinct from disabled).
- **Glyph recipe drift** — `rating.css:23-27` includes `'GRAD' 0` where `icon.css:31-34` omits it.
  → align variation axes.

## 3 · MED — off-token values & one-off grammar in features

> **STATUS: ✅ batch 3 executed 2026-07-23.** Converted: `cr-modal-sheet` grew a `closeFinished`
> output (exit-transitionend, locations precedent) and BOTH team-showcase and service-detail
> dropped their 300ms timer literals (service-detail's `CLOSE_ANIMATION_MS` was a second instance
> the audit missed); client calendar `‹›` → `ui-icon` `calendar.previous/next` + `uiIconOnly`;
> account checklist `✓/○` → `checklist.done/pending` registry keys; showcase nav → `ui-stack`;
> header float geometry promoted to named `--cr-header-float-*` vars; menu 5rem →
> `--landing-header-offset`; locations icon chip 50% → capsule rung; bundle glyph 12px →
> `--ui-icon-small`. Annotated as sanctioned keeps (with rationale in-code): team film-grade
> filter, hiring em word-gap + stagger steps, menu morph glyph geometry, service fallback
> placeholder art, phone-link color-shift hover (text-link exception). Team-showcase's 34% mix and
> font-role icon sizing died with batch 2's affordance conversion.

**Landing pages/header**

- `team-showcase.component.ts:140-143` — hardcoded `300` ms sheet-exit literal duplicating
  `--sys-motion-duration-deliberate`; sibling `locations.component.ts` already replaced this exact
  pattern with a `transitionend` listener. → same fix.
- `team-showcase.component.css:81-89` — `color-mix(… foreground 34%, …)` off the alpha ladder;
  `:91-95` sizes a `ui-icon` via a font role instead of `uiScale`; `:54-56` magic
  `saturate(1.02) contrast(1.02)` film filter.
- `team-showcase.component.html:20,31` — `morph-card`/`media-morph` hover layered on top of
  `uiInteractive` (second hover grammar; base recipes in `landing-shared.css`). → rule it a house
  extension explicitly, or fold into `uiInteractive`.
- `landing-header.component.css:30,58,62` — `1.25rem` / `2.75rem` / `3.75rem` float-view gutters off
  the space ladder (art-directed hero-card alignment; tokenize as `--landing-*` if kept).
- `landing-menu.component.css:41-43` — magic `5rem` header-clearance term. → `--landing-header-offset`
  (already exists at `5rem` in `landing-shared.css:48`).
- `locations.component.css:71-87` — circular icon chip (`border-radius: 50%` off the radius ladder,
  fill mix) → `ui-avatar` icon slot or badge; `:103-122` one-off phone-link hover;
  `:444` + `modal-sheet.component.css` — the shared `1.1rem` compact sheet inset is a house value
  worth promoting to a token rung during the sheets-misc convergence.

**Landing sections/shared**

- `hiring-section.component.css:78,100` — `0.28em` word gap; `0.22s`/`0.11s` stagger literals off the
  motion ladder.
- `icons.ts:41-66` (menu morph icon) — sanctioned custom morph, but fully magic px geometry
  (12/18/1.5/2/9/3.5px); tokenize or annotate as signature dimensions.
- `service-tile.component.ts:179,202` — `ui-icon` glyphs sized `2.25rem` / `12px`, off the fixed
  16/20/24 ladder; `:210,235` — 2px paddings/gaps.

**Client features** (otherwise exemplary)

- `client-appointments.html:84,104` — raw `‹` / `›` text glyphs as calendar month-nav labels →
  `ui-icon` semantic chevron keys + `uiIconOnly`.
- `client-account.html:138` — checklist status via `'✓' : '○'` string glyphs → `ui-status-indicator`
  or `ui-icon` semantic keys.

**Showcase shell**

- `apps/showcase/src/app/app.css:7-10` — nav is hand-rolled horizontal flex+gap → `ui-stack`
  (or let the hosting `ui-toolbar` own it).

> **Follow-up (owner-spotted, 2026-07-23):** `cr-service-tile`'s internals were still hand-rolled
> stacks — now DS composition: button → `ui-stack` (VStack, compact) → `ui-stack uiAxis="z"`
> (cover + corner bundle chip via `place-self`) + copy `ui-stack` (tight) with an HStack meta row.
> The old flex/margin rules died; only the button reset, name clamp, tabular price, 2px optical
> keeps and the (sanctioned) chip disc remain. Gotcha for future ZStacks: a corner layer needs
> `position: relative` (no z-index) or ui-async-image's absolute internals paint over it.

## 4 · LOW — defensible, listed for completeness

Art-directed measure caps (`21.25rem`, `34rem`…), fluid `clamp()` section/gallery rhythm steps,
viewport caps on sheet scrollers, footer `translate(1px,-1px)` nudge, work-gallery `scale(1.06)`
signature zoom, `--landing-gutter`/`--landing-header-offset` house vars, full-bleed
negative-margin keeps, MapLibre marker chrome, skeleton/progress loop durations above the motion
ladder, dialog `scale(0.95)` entrance (a `--sys-scale-enter` token would close the last raw-scale
gap), footer `<ul>` VStack kept for list semantics.

## 5 · Sanctioned keeps worth re-ruling

1. **`.explore-affordance`** (landing-shared) — see 1.1: the strongest candidate to lose its keep.
2. ~~**`--landing-radius-xl/-3xl`**~~ — ✅ RULED & folded 2026-07-23 ("we should use our sys radius
   everywhere"): the landing radius ladder is deleted; gallery grid tiles → `regular`, cards/tiles →
   `prominent` (the `-2xl` alias de-aliased), lightbox/map set-pieces → `hero`. Never reintroduce.
3. **Bundle-chip disc** (1.4) — keep the shape ruling if desired, fix the off-token internals.
4. **`--modal-sheet-safe` ↔ `--ui-sheet-inset` aliasing** (modal-sheet + locations) — pending the
   “sheets-misc convergence”; the compact `1.1rem` rung should become a token then.
5. **Menu morph icon** (icons.ts) — legitimate (no DS morph glyph); the one CSS-drawn glyph with
   fully hand-rolled geometry — keep on the radar.

## Suggested execution order

1. **DS self-consistency batch** (§2 + 1.5) — pure `libs/ui` token work, no visual intent changes,
   showcase verifies: press-scale token, disabled/loading opacity, focus ring/glow unification,
   glass blur, card padding dedup, dot geometry, date-badge opacity.
2. **Control lookalikes** (§1.1-1.4) — explore affordance → DS button/badge; schedule day rows →
   `ui-list-row`; gallery progress → `ui-progress-view`; bundle chip internals.
3. **Feature off-token sweep** (§3) — client glyphs → `ui-icon`/`ui-status-indicator`;
   team-showcase 300ms → `transitionend`; alpha/space/motion literal cleanup; showcase nav.
4. **Re-rulings** (§5) — each needs an owner call before touching.
