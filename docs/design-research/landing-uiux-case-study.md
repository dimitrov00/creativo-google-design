# Landing Route Case Study — "/" (creativo-google-design)

**Scope:** `libs/features/marketing/landing/src/lib/` against the design system in `libs/ui/`. Every claim below was verified in code; file:line citations are to the current `main` (16b8120).

---

## 1. Executive Summary — The Five Highest-Leverage Moves

**1. ~~Flip the accent token from orange to blue~~ — WITHDRAWN (owner correction, 2026-07-22).** The audit initially read the orange accent as a legacy leftover; the owner confirmed the opposite: `--sys-color-accent: #f26b22` (orange) **is the sanctioned brand accent** (v2 palette ported verbatim; the blue variant is the _old_ theme, deliberately not ported). What survives of this finding is pure token hygiene: the accent routing is healthy (~22 call sites all resolve through the token — good), but the hiring section hardcodes the accent as `rgb(242 107 34 / …)` decimal literals, which must route through `var(--sys-color-accent)` so the section follows any future accent change. The brown-vs-amber disagreement between `--sys-color-promo` light (#c2710c) and dark (#fbbf24) remains a real inconsistency for the owner to adjudicate.

**2. Fix the broken shipped features: phantom global classes mean the team-card morph never renders and the locations booking bar is unreachable.** Comments in two components claim shared recipes "live in styles.css" — they don't, anywhere in the repo. `.media-morph`/`.morph-card`/`.explore-affordance` have zero definitions, so barber portraits render as raw unclipped rectangles with no skeleton and no hover morph (team-showcase.component.css:60–69). Worse, `.sheet-bar-reveal` and `@keyframes sheet-content-in` exist only inside service-detail's _component-scoped_ CSS, so the locations sheet's call/directions/book bar is clipped out of view and can never be reached (locations.component.html:409). These are not polish items — they are shipped, silent breakage in flagship sections.

**3. Consolidate the four hand-rolled button systems onto ui-button and enforce the 44px floor.** The header login pill, burger trigger, prefs chips and inverted menu row are all bespoke re-implementations of `.ui-button` — one even comments that it's copying "the design system's tinted chip" (landing-header.component.css:106). The login pill and trigger are 36px, below Apple's 44px minimum, on the two most prominent controls on the page. Meanwhile every `uiSize="compact"` CTA (36px token) is hand-patched back up to ~52px with five copy-pasted padding blocks. Promote the two genuinely new shapes (glass "overlay" variant, tall spread-label sheet CTA) into ui-button once, then delete all the copies.

**4. Unify the page's two design registers — one grid, one title scale, one motion voice, one copy voice.** The page alternates between a 640px app column and full-bleed legacy editorial spreads with their own gutter system, a second headline tier (105px `display` vs 36px `largeTitle` in adjacent sections), a second (dead) reveal attribute, and a second poetic copy register whose terse v2 replacement copy already sits unused in en.json (`landing.barbers.*`, `landing.location.*`). Six hover grammars, six press scales, and four eyebrow recipes on one scroll are exactly what separates "near-premium" from Revolut/Apple. Converge on the v2 register and delete the forks.

**5. Rebuild the hero in the closing-CTA register and fix section order for conversion.** The closing CTA already nails the Apple register — centered trio, capsule button, house motion. The hero speaks a different language (bottom-left pinned copy, full-width icon CTA outside the card, bespoke entrance system) and the funnel runs proof-before-offer with a recruiting pitch wedged between "what can I buy" and "where are you." Mirror the hero on the closing composition, move the pref toggles into a bottom toolbar, and reorder to hero → services → proof → locations → closing. Section 3 below is the full spec.

---

## 2. Findings by Theme

### 2.1 The Orange Accent — sanctioned hue, token hygiene only

> **Owner correction (2026-07-22):** orange `#f26b22` is the intended brand accent; blue is the old theme. This section's original "flip to blue" recommendation is withdrawn. The token fan-out map below stays useful as documentation of accent routing; the only _defects_ are the hardcoded literals and the promo hue disagreement.

**Accent routing (healthy).** `--sys-color-accent: #f26b22` in theme-light.css:17 and theme-dark.css:15 — a verbatim v2 port. The fan-out:

- **The orange ВХОД pill:** landing-shared.css:70–90 builds the whole toolbar-control contract (`--landing-toolbar-fg`, `--landing-toolbar-fill`, `--landing-control-fill`) from the accent; landing-header.component.css:107–113 applies it to `.cr-header__login[data-surface='solid']`.
- **Orange links sitewide:** `@layer sys-base { a { color: var(--sys-color-accent) } }` at apps/web/src/styles.css:94–96. (Layer order makes this deterministically win over the legacy cr-base anchor rule at :55–62 — collapse to one rule when the donor pages die.)
- **Everything else:** every `.cr-section-eyebrow` (landing-shared.css:147), locale/theme chips (locale-theme-toggle.component.css:52–62), menu trigger (landing-header.component.css:146–158), tile/name hover inks (services-section.component.css:156, team-showcase.component.css:104, locations.component.css:121), gallery progress fill (work-gallery.component.css:154), today-row highlight (locations.component.css:504,519), plus ui-button tinted, ui-badge accent, input/otp focus rings, and the spinner.

**Fix (revised):** the token values stay. The actual defect is **hardcoded accent literals**: hiring-section.component.css:47 (`rgb(242 107 34 / 0.1)`) and :62 (cursor spotlight, `0.13`) spell the accent out in decimal, bypassing the token. Replace with `color-mix(in srgb, var(--sys-color-accent) 10%/13%, transparent)` — identical render today, correct routing forever. This is the only accent bypass in the whole landing (verified by exhaustive hex/rgb grep).

**Adjacent palette debt.**

- `--sys-color-promo` is **brown** (#c2710c) in light and amber-yellow (#fbbf24) in dark — the themes disagree in _hue_ — and has **zero consumers** (Medium). Either make light a proper yellow or delete the pair.
- `--sys-color-warning` (#b26a00 / #d08a2c) is brown-orange and _does_ render on this route: the "closing soon" status dot/text (locations.component.css:459, 474) and badge warning tone (Low). Shift into the yellow/amber family.
- **5.7MB of dead legacy assets** in apps/web/public: six `editorial-*` files (including `editorial-coral` warm imagery, 2.7MB), six `locations/*.jpg` (2.9MB — the section now sources `/work/*.jpg`, locations.component.ts:135–150), `hero-poster.jpg`, and both `logo-full-*.svg` (Medium). None referenced anywhere. Delete.

### 2.2 Broken-by-Phantom-CSS — dead classes that promised behavior

**Team cards (High).** team-showcase.component.css:60–62 and :130–131 claim "Skeleton + hover morph live in styles.css (.media-morph / .morph-card)" and "(.explore-affordance)". Repo-wide grep: **no definition exists anywhere.** Consequences:

- The circle-at-rest → rounded-on-hover clip morph configured via `--media-morph-clip-rest/hover/rotate` (css:63–68) never runs; portraits are raw rectangles, no radius, no loading skeleton. The signature moment of the section is silently absent.
- The "Разгледай" explore affordance renders as bold caption text — its `border-color` (css:138) is dead because no rule ever declares border-width/style. It shares nothing with the button vocabulary.

**Locations sheet (High, functional).** `.sheet-bar-reveal` (locations.component.html:409) and `@keyframes sheet-content-in` (locations.component.css:592–599) are defined only in _service-detail.component.css_ (:291–317, :321–332), which is emulated-encapsulation-scoped — Angular also scopes component keyframe names. The locations sheet's toolbar therefore gets **no styling at all**: it flows after the 100%-height scroller inside an `overflow:hidden` surface and is **clipped out of view**. The call/directions/book bar is unreachable, and the sheet's entrance animation no-ops.

**Fix for both:** move `.sheet-bar-reveal`, `@keyframes sheet-content-in`, and a real (or deleted) morph recipe into landing-shared.css — the file already hosts cross-section recipes and is imported globally at styles.css:45 — and delete the stale "lives in styles.css" comments. Same cleanup for the inert `data-reveal` and `data-nav-tone` attributes stamped in team-showcase/locations templates (html:5, 8, 32/44): zero consumers, markup that promises behavior the page doesn't have.

### 2.3 SwiftUI-Parity Violations — hand-rolled duplicates of the design system

**Four bespoke button recipes (High).** All rebuild `.ui-button`:

1. `.cr-header__login` (landing-header.component.css:70–113) — the tinted capsule, hand-copied (the comment at :106 admits it), 36px tall, plus an invented `data-surface="solid|overlay"` channel no directive stamps.
2. `.cr-header__trigger` (:117–158) — circular icon button with its own `:active scale(0.95)` (canonical is 0.98, button.css:69–71), 36px.
3. `.cr-prefs__chip` (locale-theme-toggle.component.css:12–78) — a third capsule copy (these at least hit 44px).
4. `.cr-menu__row--inverted` (landing-menu.component.css:89–107) — hand-inverted `prominent`.

Replace all four with `uiButton` (`uiVariant="tinted"`/`"prominent"`, `uiShape="capsule"`, `uiSize="regular"`). The glass/chrome-over-media surface is the only genuinely new treatment — add it **once** as a real ui-button variant.

**Invented attributes on buttons (High).** `data-tone="overlay"` hand-stamped on a uiButton (hiring-section.component.html:66, styled at landing-shared.css:177–190) mints a sixth button variant outside the typed `uiVariant` enum (button.ts:9–10), borrowing ui-card/ui-badge vocabulary with different meanings. `.cr-landing-cta` (:166–190) also overrides uiButton's min-height/padding/radius. Promote "overlay/glass" into `UiButtonVariant`; delete the class overrides and the raw attribute.

**The `compact` hand-patch pattern (Medium).** All five landing `uiSize="compact"` CTAs (service sheet ×2, barber sheet, location sheet ×2) declare the 36px token then re-inflate to 48–52px with per-component padding — three carry the identical "the host restores the chunky box" comment (service-detail.component.css:104–109, 310–317; team-showcase.component.css:226–234; locations.component.css:388–396, 579–586). The declared size is a lie and the 44px floor is guaranteed by scattered CSS, one forgotten override from shipping a 36px primary CTA. Add the "tall pill / small label / spread layout" geometry as a real DS size or layout option; delete the five copies.

**Hand-rolled badges/chips/avatars (Medium).**

- `.service-sheet__bundle-badge` duplicates `ui-badge[data-tone='accent']` at 12% fill where the DS says 14% (service-detail.component.css:47–58) — same badge, different render.
- Variant capsules (:141–152) and the 28px `.cr-services__bundle-chip` (services-section.component.css:115–129) rebuild the chip surface off-token.
- Location status pills, TODAY tag, and hand-drawn status dots (locations.component.html:58–74, 289–344, 362–367) are semantically `uiBadge uiTone="success|warning|accent"`.
- The barber sheet avatar is a raw `<img>` re-implementing ui-avatar's contract (team-showcase.component.css:165–171). ui-avatar caps at 52px vs the 112px sheet portrait — close the size gap in the DS (add a display tier or accept a size var), not in feature CSS. The prefs toggles similarly reassemble `button[uiChip]` from parts.

**Two sheet systems (Medium→structural).** `cr-modal-sheet` (~200 lines) rebuilds `ui-sheet` sharing zero CSS/tokens with it — hardcoded 0.72 scrim vs `--sys-color-scrim`, `0 2rem 7rem` shadow vs `--sys-elevation-overlay`, 2rem/1.5rem radius vs `--control-radius-prominent` — while owning all the real behavior (focus trap, Escape, drag-to-dismiss, inert background, focus restore, scroll progress) that UiSheet's docblock says it was designed to receive. Client appointments already uses ui-sheet, so the app has two diverging systems. Promote ModalSheet's behavior into libs/ui/layout's sheet and rebase its surface on the tokens; appointments then inherits drag/focus for free.

**Legacy parallel systems still loaded (Low).** The full `--cr-text-*` + `[data-text]` typography stack still imports alongside `--sys-*` + `[data-font]` (styles.css:26–34); two landing comments still point maintainers at it (team-showcase.component.css:27–28, locations.component.css:25–26) while the templates actually use `uiFont`. The `--page-gutter`/`--page-fg` legacy rhythm block (landing-shared.css:92–95; `--page-fg` is a pure alias of `--sys-color-foreground`) survives "by design call" in the two restored sections. Update the comments now; schedule the cr-* removal with the donor-page migration.

### 2.4 Typography — split-brain type application

**Eyebrows: six hand-rolled copies, three trackings, four colors, two systems (High).** The caption-uppercase overline is transcribed by hand in landing-shared.css:142–148, hero css:93–96, hiring css:92–95 (drifted to 0.05em/700), footer css:37–40, header css:79–82 and locale-theme-toggle css:22–25 (0.025em/700) — while `uiFont="eyebrow"` exists (modifiers.css:11–15) and is used by team/locations. Crucially the token is a _different_ recipe (Onest 760/0.64rem/0.13em vs DM Sans caption 600/11px/0.8px), so adjacent sections render eyebrows in different typefaces. Colors drift too: full accent, ad-hoc 80%-accent (hiring), media-subtle (hero), muted (footer). **Decision required once:** reconcile the intended cut _into_ `--sys-font-eyebrow` (the caption-based recipe is what 5 of 6 sites target), then migrate everything to `uiFont="eyebrow"` + `uiForeground` and delete the six copies. Footer column headers are nav labels, not eyebrows — give them caption + secondary foreground instead.

**Section titles: three scales across five adjacent sections (High).** Scroll order team → services → hiring → locations → closing changes h2 tier at every boundary: `display` (630/clamp 3.3–6.6rem/0.86) → `largeTitle` (800/fixed 2.25rem/0.96) → `extraLargeTitle` (800/clamp 2.125–2.75rem/1.02) → largeTitle → extraLargeTitle. At desktop the team title is ~3× the services title that follows it. Standardize on **extraLargeTitle** (fluid, already used twice, Apple-hero adjacent); reserve `display` for at most one showpiece.

**No sanctioned header pattern (High).** Only Services uses the full `.cr-section-eyebrow/-title/-subtitle` trio; locations re-implements the subtitle inline (admitting it in a comment, with a different measure), hiring hand-rolls both eyebrow and subtitle (the page's only 16px body text, css:145–147), hero carries a third verbatim eyebrow copy. Lede max-widths: 26.25rem, 22rem ×2, 20.625rem, 300px, 24rem — six values for one role. **Build `<ui-section-header>` in libs/ui/patterns** (eyebrow/title/lede slots, `align` and `onMedia` inputs, composed internally from uiFont directives) and delete all local re-implementations.

**Outline and role bugs (Medium).** The work-gallery — a full-viewport set piece linked as `#work` — has no h2, no accessible name; the outline jumps from h1 to the team h2. The bundles shelf titles itself with a `<p>` in eyebrow dress (key literally named `bundlesTitle`, services-section.component.html:82). Gallery captions are set in the _largeTitle_ tier (work-gallery.component.css:116–121), so six pseudo-titles fire before the first real section heading. Sheet titles use three scales for one role (title / display / extraLargeTitle across the three sheets); service-detail hand-rolls its h2/h3 fonts in CSS where directives exist. Fixes: visually-minimal header (or visually-hidden h2) for the gallery; h3 + `title3` for bundles; captions down a tier; sheets standardized on `extraLargeTitle` via `uiFont`.

**Token corrections (Low).** Hero and hiring both override extraLargeTitle's line-height to 0.98 with the same "token drifts ~2px" comment while closing renders the uncorrected 1.02 — change the token to /0.98 and delete both overrides. Hiring's subtitle should be `var(--sys-font-body)`. `--landing-gutter` should derive from `--sys-space-regular` (preserving its ≥40rem step).

### 2.5 Motion & Interaction States — six grammars for one gesture

**Card hover (High).** Hovering an interactive card animates a different property in every section: gallery cards grow (1.03 + inner 1.06 + gloss, three durations, one raw `ease-out`); services zoom only the image and recolor the title; team cards saturate + nudge the h3 0.12em; location cards flip an icon fill and animate a border; performer rows step a background alpha; ui-card itself swaps elevation. No shared layer, property, or duration. **Fix:** add `--sys-state-layer-hover`/`-press` tokens and one `::after` state-layer recipe on ui-card/ui-button's existing `[data-interactive]` hook (SwiftUI parity: `.hoverEffect(.highlight)`). Keep at most one signature embellishment per family (the image zoom), on one shared duration/ease.

**The primary CTAs are the least responsive elements on the page (High).** `.ui-button` has **no `:hover` rule for any variant**, and both prominent booking CTAs wrap the button in an `<a>` with `pointer-events: none` + `tabindex="-1"` on the button (landing-hero.component.css:132–135; closing-cta.component.ts:77–80) — so even the `:active` scale can never fire. Every secondary control around them has richer feedback than the page's conversion action. Give ui-button a per-variant hover tier (the 12%→18% tinted recipe is already proven in landing-shared.css:76–80) and style the anchor with `uiButton` directly so it receives events. Same hover/press pair for ui-chip.

**Legacy cursor system fires without its cursor (High).** `crCursorTarget` fill-morphs (~10 controls in locations + showcase gallery, plus team-showcase) apply an abrupt 120ms `!important` background/border/color inversion from the **legacy `--cr-motion-*` clock** — but `CursorDotComponent`, the custom cursor this morph hands off to, is mounted only in apps/showcase, never apps/web. Three sections invert surfaces at 120ms while neighbors animate at 200–300ms sys tokens. Decide the cursor's fate: mount it in the web shell, or strip `crCursorTarget` from the landing and use the standard state layer.

**Press feedback: six scale values, two mechanisms (Medium).** 0.9, 0.92, 0.95 ×2, 0.98 ×2, 0.99 across close/toggle/chips/trigger/buttons/menu/card, plus background-step presses at three different alpha ladders. Tokenize: `--sys-press-scale-control: 0.97`, `--sys-press-scale-surface: 0.99` + the shared press layer. (Note: a global reduced-motion kill-switch already exists at libs/shared/ui/…/reduced-motion.css, imported globally — per-component reduced-motion blocks are the redundant leftovers, not the missing piece.)

**Motion tokens bypassed everywhere (Medium).** `transition: all 0.3s` on the fixed header (an anti-pattern twice over); durations 0.2/0.22/0.26/0.28/0.3/0.32/0.45/0.5/0.68/0.7/1s scattered through menu, gallery, services, hiring, footer; the _value_ of `--sys-motion-ease-emphasized` re-typed as a literal in hiring css and fade-up.directive.ts; the _legacy_ emphasized curve `(0.16,1,0.3,1)` inlined in menu css and icons.ts. Sweep onto the `--sys-motion-*` scale (0.2s→regular, 0.26–0.32→deliberate, 0.45–0.5→slow, 0.68–1s→slowest/cinematic), replace both bezier literals with the token, and enumerate the header's transitioned properties. Interaction alphas similarly re-type the _light-theme_ `--sys-alpha-*` ladder as literals (menu 4/9%, sheet 5.5/8/9%, modal close 7%) — **wrong in dark mode**, where the ladder doubles; route through `var(--sys-alpha-*)`. Collapse the 48–64% foreground color-mix "ink soup" onto `--sys-color-secondary-label` (add one tertiary token if genuinely needed).

**Focus (Medium, corrected).** Keyboard users do get a ring — but from the **legacy cr-base fallback** (`--cr-color-focus-ring`, styles.css:64–67, a file that labels itself "fallback for not-yet-migrated pages"), while ui-button/ui-chip draw `--sys-color-ring`. Two ring systems on one page, and landing components alias `:focus-visible` to hover backgrounds on top. Worst case: the location-card h3 turns _accent_ on hover/`:focus-within` but _primary_ on `:focus-visible` — a different color per input modality. Give hand-rolled interactives an explicit `outline: 2px solid var(--sys-color-ring); outline-offset: 2px` and delete the hover-as-focus copies.

**Scroll reveals (Low).** Four entrance grammars (crFadeUp 800ms, gallery caption 0.45s+blur, hiring word-stagger 0.68s, menu trio on the legacy curve). Define reveal tokens (duration/rise/stagger) consumed by the directive and the keyframes.

### 2.6 Touch Targets & Ergonomics (Apple HIG)

| Control                    | Actual                                                                                       | Fix                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header ВХОД pill           | 36px (landing-header.component.css:75)                                                       | `--control-size-regular` (44px), or hit-area extender                                                                                                                         |
| Burger trigger             | 36px (:121–122)                                                                              | same                                                                                                                                                                          |
| Modal-sheet close, mobile  | 42.4px (modal-sheet.component.css:189–192)                                                   | delete the mobile shrink; 2.75rem everywhere                                                                                                                                  |
| Showcase layout toggle     | 40.8px, loses its background entirely on mobile (showcase-gallery.component.css:64, 149–164) | 44px; keep the chip surface                                                                                                                                                   |
| Location directions button | 41.6px (locations.component.css:215)                                                         | 44px                                                                                                                                                                          |
| Location phone link        | ~14px tall, _inside_ a `role=button` card (html:77)                                          | min-block-size regular; restructure so phone/maps sit outside the card button (nested interactive-in-button is invalid ARIA and a mis-tap opens the sheet instead of dialing) |
| Footer sitemap links       | ~20px at ~30px pitch, ten links incl. tel:/auth (landing-footer.component.css:50–62)         | min-block-size regular with compensating gap                                                                                                                                  |
| Map indicators             | 38.4px clickable buttons inside an `aria-hidden` container (locations-map.css:26)            | make decorative (drop listener) or real labeled 44px buttons                                                                                                                  |

**Functional bugs in the same lens (High/Medium):**

- **The hiring CTA is a dead button** — `type="button"`, uiButton styling, no click handler, no routerLink, nothing (hiring-section.component.html:62–71). The menu links `/#hiring` expecting this section to convert. Wire it or render it as copy; a focusable button that ignores activation must not ship.
- Gallery cards bind only `keydown.enter` — `role="button"` must also handle Space (team-showcase already does both; the page is internally inconsistent). The lightbox's only close affordance is an invisible full-screen backdrop button with no focus move into the dialog — add a visible 44px close and manage focus like the modal sheet already does.

### 2.7 Dark Mode & Theming

The default theme is **dark**, so these are most visitors' first impression:

- **The map is hardcoded light in both themes (High).** `MAP_STYLE_URL = …/positron` (locations.component.ts:23) feeds both MapLibre instances; the component never touches ThemeService. A bright beige panel glares mid-page on #000, and never reacts to the toggle. OpenFreeMap hosts a dark companion style (verified 200): inject the landing ThemeService, derive the URL from the theme signal, `setStyle` on change (DOM markers survive), and add a token override for the maplibre attribution chrome. Don't use a CSS invert filter — it degrades labels and inverts the pins.
- **Pins/indicators: #ededed-on-white glyphs (High).** Pin heads and off-screen chips hardcode `background: #fff` with `var(--sys-color-foreground)` ink (locations-map.css:29–31, 98–99) — near-invisible in dark. The `[data-active]` states directly below already do the token inversion correctly; the fix is three lines.
- **Location-sheet toolbar icons: white glass, dark ink token (High).** `rgb(255 255 255 / 0.78)` pills with `--sys-color-foreground` ink (locations.component.css:555–576) fail contrast in dark; the sibling `.location-sheet__icon-action` (:402–419) shows the correct color-mix recipe in the same file.
- **Black-alpha hairlines and shadows vanish on dark (Medium).** The services tile's crispness ring (`inset … rgb(0 0 0 / 0.06)`, services-section.component.css:111), status-card shadows, booking-bar float — all read as zero on #000/#171717, flattening depth exactly where dark needs it. Hairlines → separator idiom (the token already scales 4%→12% per theme); elevation → pair the shadow with a foreground-mix border, promoted to one `--sys-shadow-*` recipe.
- **Showcase toggle chip** hardcodes a warm off-white `rgb(247 247 244 / 0.78)` matching no token, with 74%-foreground ink — washed out in dark and reused inside the themed location sheet (Medium). Either theme it via surface color-mix, or if it must stay light over photography, pin its ink dark explicitly.
- **Scrims/overlays** bypass `--sys-color-scrim`/`--sys-color-media-scrim`: three overlay systems darken the page three different amounts (menu 45% token, modal 0.72, lightbox 0.85). Standardize on the media-scrim token; route shadows through `--sys-elevation-*`, adding one `--sys-elevation-floating` if a heavier cut is truly needed (Low–Medium).

### 2.8 Sheet Experience

- **The header "collapse" is a boolean flip, not a collapse (High).** The eyebrow leads the sheet above a 28px `title`-tier h2; `onSheetScroll` compares rects against the toolbar and toggles a fixed crossfade — nothing is scroll-linked, and the 0–1 progress the sheet already emits is ignored by the header. (The component docblock records the small-title look as a deliberate port; this is a redesign call, cleanly evidenced.) Spec: h2 first at `largeTitle`; scroll-driven interpolation via CSS scroll-driven animations (`view-timeline` on the h2, scale 1→0.62 / fade as it slides under the toolbar, the toolbar clone mapping the same progress inversely), with the current rect code kept only inside an `@supports not (animation-timeline: view())` fallback; `view-transition-name` on the tapped tile title + sheet h2 wrapped in `startViewTransition()` for shared-element continuity; feed the emitted progress into a toolbar hairline so the bar "lands" like UINavigationBar.
- **Double writer on `data-state` (Medium).** service-detail.component.html:6 re-binds `data-state` on `<cr-modal-sheet>` with a smaller vocabulary than the host's own binding — the exact leftover the host comment warns about. Delete the consumer binding.
- **Scroll handler** re-walks the DOM (closest + 3 querySelectors + up to 4 rect reads) per event (service-detail.component.ts:129–155). If the CSS-timeline redesign lands this mostly disappears; otherwise cache refs on open and use IO sentinels (Medium/Low).
- **Close timing** `CLOSE_ANIMATION_MS = 380` matches neither the 300ms opacity nor 480ms transform token — invisible today (fully transparent by 300ms) but pure magic-number drift risk; use `transitionend` (Low).
- **Gesture polish (Low):** backdrop dismisses on pointer*down* (stray touches close the sheet — pair down/up); no grabber pill despite a `touch-action:none` drag zone; drag-dismiss active on desktop centered dialogs; body scroll lock without `scrollbar-gutter` compensation shifts the page.

### 2.9 Structure, Rhythm & Voice

- **Two registers (High).** 640px app column vs 100vw breakout sections with their own `--page-gutter` and the `display` headline tier (a documented "design call" — this audit's recommendation is to reverse it). Converge team/locations onto the column register (or one new `--sys-container-wide` tier); if the map moment matters, keep only the _canvas_ full-bleed while its header/list hold the grid.
- **Section order (High).** hero → gallery (multi-viewport scroll-hijack) → team → services → **hiring** → locations → closing puts the offer 4th and a recruiting pitch mid-funnel. Reorder: hero → services → proof (gallery or team, trimmed) → locations → closing; demote hiring below locations or to the menu/footer (the menu already links it). A child-order swap in home.page.html.
- **Rhythm (Medium).** Section padding is a magic 7rem repeated five times with per-breakpoint exceptions (8rem, 10rem) and no shared token; mobile card-grid edges wobble 4–8px between the 0.75rem legacy padding and `--landing-gutter`. Add `--landing-section-gap` beside the other rhythm knobs; align inline padding on the gutter.
- **Radius (Medium).** The `--landing-radius-*` ladder re-types the token base literals (0.75rem/0.85 — exactly `--sys-radius-base`/`--sys-radius-scale`); a dozen surfaces skip both ladders with raw radii (hiring 32px, sheet 2rem, performer 1.5/1.05rem, map clamps, showcase clips). Derive the ladder with `calc()`, sweep the raws.
- **Copy voice (Medium).** Terse v2 voice vs poetic legacy voice alternate section-by-section — and the one-voice replacements (`landing.barbers.*`, `landing.location.*`) **already exist, fully written, unused** in en.json. Switch keys when converging; delete the marketing.* landing strings. Zero new copywriting.
- **Small stuff (Low).** `var(--sys-z-header, 60)` references a token that doesn't exist (`--sys-layer-header` does) — only the fallback saves the header; menu 30/40, lightbox 50, safe strips 40 all live off the ladder. The footer's spacing comment cites a closing "accent band" that was removed in the redesign.

---

## 3. Hero Redesign Proposal

**Diagnosis.** The closing CTA already speaks the target register: centered trio (h2 capped 25rem → paragraph capped 24rem → one intrinsic-width capsule button, no icon), house `crFadeUp` at 0/0.08/0.16s. The hero speaks another: bottom-left copy pinned by a flex spacer inside the video card, pref toggles _inside_ the copy block, a tagline row, and a full-width rounded prominent CTA with a calendar icon sitting _outside_ the card on plain background, animated by a bespoke `data-hero-enter` attribute system with its own ease. Opening and closing should bookend the page on the same chord — the Apple.com pattern.

**Structure.** Keep the video card, poster and media-ink contract untouched. Inside it:

```html
<div class="cr-hero__content">
  <!-- becomes centering flex, text-align:center -->
  <ui-stack
    uiAxis="vertical"
    uiGap="regular"
    uiAlign="center"
    class="cr-hero__copy"
  >
    <h1 …>{{ t('landing.hero.heading') }}</h1>
    <p …>{{ t('landing.hero.subtitle') }}</p>
    <a
      routerLink="/auth"
      [queryParams]="{ redirect: '/book' }"
      uiButton
      uiVariant="prominent"
      uiSize="regular"
      uiShape="capsule"
      data-testid="landing-hero-cta"
      >{{ t('landing.hero.cta') }}</a
    >
  </ui-stack>
  <ui-toolbar uiPlacement="bottom" uiTone="overlay" class="cr-hero__toolbar">
    <cr-locale-theme-toggle variant="overlay" />
  </ui-toolbar>
</div>
```

Deletions: the spacer div, the copy bottom-pinning recipe, the `inline-size:100%` button rule, the calendar glyph, the empty CTA strip below the card (the card reclaims that height via its existing `flex:1`). Note the anchor _is_ the button here (`a[uiButton]` is supported), which also fixes the dead hover/press from §2.5. Copy stack capped at 25rem mirroring closing; scrim retuned from bottom-weighted to a center vignette (~0.45 mid) since text now sits mid-card; drop the `white-space: pre-line` hard break.

**Toolbar extension (the one DS gap).** UiToolbar today is top-bar-only: opaque background, bottom border, sticky-top. Extend with two SwiftUI-parity inputs — `uiPlacement: 'top' | 'bottom'` (parity: `ToolbarItemPlacement.bottomBar`) and `uiTone: 'default' | 'overlay'` (parity: `.toolbarBackground(.hidden)`). Hero placement: bottom-left, `inset-inline-start: 1.75rem; inset-block-end: max(1.75rem, var(--landing-safe-bottom))`. The toggle chips are already 44px — compliant as-is.

**Copy options (BG-first, verb-led, no clichés).** Current: "Твоят стол." / "Резервирай час за секунди.\nБез обаждане." — and the closing already uses the chair motif, so the hero shouldn't repeat it verbatim.

- **A — Ownership (continuity-safe):** „Столът е твой." / „Избери час за секунди. Останалото е наша работа." / CTA „Запази час". Flips the label into a promise; pairs with the closing line without echoing it.
- **B — Time (recommended):** „Часът, който си заслужава." / „Резервираш за секунди. Идваш точно навреме. Излизаш друг човек." / CTA „Избери час". "Час" means both _appointment_ and _hour_ — native Revolut-grade wordplay.
- **C — Craft (Apple-minimal):** „Изглеждай както трябва." / „Майстори, които помнят как ти стои. Час — за секунди." / CTA „Запази си час".

Update both bg.json and en.json; drop (or footer-demote) the tagline row — a centered trio reads cleaner without an eyebrow.

**Motion spec (four layers).**

1. **Entrance (load, once):** keep the existing WAAPI system, retuned to the trio — title y18→0 @150ms/800ms; paragraph y12→0 @320ms/700ms; CTA y14→0 + scale 0.96→1 @480ms/700ms; bottom toolbar opacity-only @650ms/500ms (chrome appears, it doesn't perform). Whole choreography lands inside ~1.2s. Extract the entrance ease `(0.16,1,0.3,1)` into a semantic token (`--sys-motion-ease-entrance`) instead of the per-component literal.
2. **Video:** keep the 1s poster crossfade to 0.5 opacity; add a settle scale 1.04→1 over `--sys-motion-duration-cinematic` (900ms), skipped under reduced motion where the poster path already applies.
3. **Scroll exit:** compositor-only depth parallax — copy stack translates up at ~0.15× scroll delta, scrim+copy fade out by 60% exit — via `animation-timeline: view()` in CSS, guarded by `@supports` and `prefers-reduced-motion: no-preference`. Zero JS. Do **not** parallax the video (object-fit cover repaints; project memory notes scroll-stall sensitivity).
4. **CTA micro-interaction:** none bespoke — inherited from the ui-button hover/press tier added in §2.5.

---

## 4. Prioritized Backlog

| #   | Change                                                                                                                                     | Severity | Effort | Files                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| 1   | ~~Accent orange → blue~~ WITHDRAWN — orange is sanctioned (owner, 2026-07-22). Residual: promo light/dark hue disagreement, owner decision | —        | —      | libs/ui/tokens/theme-light.css, theme-dark.css                                                              |
| 2   | Route hardcoded `rgb(242 107 34)` literals through `var(--sys-color-accent)` via color-mix                                                 | High     | S      | hiring-section.component.css:47,62                                                                          |
| 3   | Move `.sheet-bar-reveal` + `@keyframes sheet-content-in` to landing-shared.css — unbreak locations booking bar                             | High     | S      | service-detail.component.css, locations.component.css, landing-shared.css                                   |
| 4   | Implement or delete `.media-morph`/`.morph-card`/`.explore-affordance`; remove dead `data-reveal`/`data-nav-tone`                          | High     | M      | team-showcase.component.{html,css}, locations.component.html, landing-shared.css                            |
| 5   | Wire (or de-button) the dead hiring CTA                                                                                                    | High     | S      | hiring-section.component.{html,ts}                                                                          |
| 6   | ui-button hover tier + make the CTA anchor the button (kills `pointer-events:none` wrapper)                                                | High     | M      | button.css, landing-hero.component.{html,css}, closing-cta.component.ts                                     |
| 7   | Replace 4 hand-rolled button recipes with uiButton; add `overlay` variant; kill `data-surface`/`data-tone`                                 | High     | M      | landing-header.component._, locale-theme-toggle._, landing-menu.component.css, landing-shared.css, button.* |
| 8   | 44px sweep: login/trigger/close/toggle/directions/phone/footer links                                                                       | High     | M      | header, modal-sheet, showcase-gallery, locations, landing-footer CSS                                        |
| 9   | Theme the map (dark style via ThemeService) + de-hardcode #fff pins/toolbar icons                                                          | High     | M      | locations.component.ts, locations-map.css, locations.component.css                                          |
| 10  | Hero redesign per §3 (incl. UiToolbar `uiPlacement`/`uiTone`)                                                                              | High     | L      | landing-hero._, toolbar._, closing-cta (shared register), bg/en.json                                        |
| 11  | Section reorder: hero → services → proof → locations → closing; demote hiring                                                              | High     | S      | home.page.html                                                                                              |
| 12  | One eyebrow: reconcile `--sys-font-eyebrow`, migrate all 6 sites to `uiFont="eyebrow"`                                                     | High     | M      | tokens.css, landing-shared.css, hero/hiring/footer/header/prefs CSS + templates                             |
| 13  | `<ui-section-header>` pattern; one title tier (extraLargeTitle); fix token line-height to 0.98                                             | High     | L      | libs/ui/patterns (new), tokens.css, all section templates                                                   |
| 14  | Consolidate cr-modal-sheet onto ui-sheet (behavior up, tokens in)                                                                          | Med      | L      | modal-sheet._, libs/ui/layout/sheet/_                                                                       |
| 15  | Apple-style scroll-linked sheet header + title-first intro; delete duplicate `data-state` binding                                          | Med      | M      | service-detail._, modal-sheet._                                                                             |
| 16  | State-layer tokens + unified hover/press (6 grammars → 1); press-scale tokens                                                              | Med      | M      | tokens.css, card.css, all section CSS                                                                       |
| 17  | Resolve crCursorTarget: mount cursor in web or strip from landing                                                                          | Med      | S      | apps/web app shell or locations/team/showcase templates                                                     |
| 18  | Motion-token sweep (durations, both inline beziers, `transition:all`); alpha-ladder + ink-soup sweep                                       | Med      | M      | header/menu/gallery/services/hiring/footer CSS, fade-up.directive.ts, icons.ts                              |
| 19  | uiBadge/uiChip/ui-avatar adoption (status pills, TODAY, bundle chips, variant capsules, sheet avatar + DS size tier)                       | Med      | M      | locations, services-section, service-detail, team-showcase, libs/ui/controls                                |
| 20  | Compact-CTA geometry into DS; delete 5 hand-patches                                                                                        | Med      | M      | button.*, service-detail/team-showcase/locations CSS                                                        |
| 21  | Converge breakout sections onto the column register; switch to `landing.barbers.*`/`landing.location.*` keys                               | Med      | L      | home.page._, team-showcase._, locations.*, en/bg.json                                                       |
| 22  | `--landing-section-gap` token; mobile gutter alignment; derive radius ladder from tokens; raw-radius sweep                                 | Med      | M      | landing-shared.css + section CSS                                                                            |
| 23  | Dark-mode depth: separator hairlines, shadow+border recipe; scrim/elevation tokens for overlays; theme the showcase chip                   | Med      | M      | services-section, locations, modal-sheet, work-gallery, showcase-gallery CSS                                |
| 24  | Focus: sys-ring on all hand-rolled interactives; fix accent/primary modality split                                                         | Med      | S      | landing CSS (shared rule), locations.component.css                                                          |
| 25  | Gallery: Space-key activation, visible lightbox close + focus management; gallery section header; captions down a tier                     | Med      | S      | work-gallery.*                                                                                              |
| 26  | Delete 5.7MB dead assets; delete dead `--sys-color-promo` or fix its light value                                                           | Med      | S      | apps/web/public, theme files                                                                                |
| 27  | Sheet polish: pointerup backdrop dismiss, grabber, desktop drag gate, scrollbar-gutter, transitionend teardown                             | Low      | S      | modal-sheet.*                                                                                               |
| 28  | Fix `--sys-z-header` name; z-index ladder adoption; single anchor rule; stale comments (data-text refs, footer band); cr-* freeze note     | Low      | S      | landing-header.css, menu/gallery/home CSS, styles.css, team-showcase/locations/footer comments              |

---

## Appendix — Refuted / Corrected Claims

- **"Sheet open/backdrop motion ignores prefers-reduced-motion" — refuted.** A global kill-switch (libs/shared/ui/…/motion/reduced-motion.css, imported at styles.css:31) clamps all transition/animation durations to 1ms under reduced motion with `!important`; the sheet is covered. The per-component reduced-motion blocks (service-detail, button.css) are the redundant leftovers under this architecture — don't add more.
- **"Keyboard focus loses its ring" — corrected.** A global 2px ring exists via the legacy cr-base fallback; the real defect is _two ring systems_ (legacy vs `--sys-color-ring`) and hover-as-focus aliasing, reported as such in §2.5.
- **Minor scope corrections folded in:** cr-base/sys-base anchor rules layer deterministically (duplication, not a runtime fight); the menu's foreign bezier appears twice, not three times; `crCursorTarget` affects _three_ sections (team-showcase too); the work-gallery is column-width, not a horizontal breakout; ui-avatar's fallback covers missing `uiSrc`, not broken loads; the ink-ramp tops out at 64%, not 74%; the truncated 380ms sheet exit is invisible today (opacity completes at 300ms) — drift risk only.
