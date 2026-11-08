# Chart library survey — the staff analytics screen

Date: 2026-11-08. Scope: the charts the analytics screen will grow into
(takings over time as bars, line or area; chair-time breakdown as a stacked
bar or ring; weekday × hour demand heatmap; a per-barber radar polygon; goal
progress rings; sparklines in rows; this-period-vs-previous comparison; a
calendar heatmap) and the export of a report (CSV, image, PDF), for an
Angular 22 zoneless PWA on mid-range phones under the owner's rule "load on
demand and higher ceilings are OK, lag never"
(`.claude/.../feedback_buttery_smooth_pwa.md`, 2026-11-07).

Every size in this document was measured in a scratch folder with the
repo's own bundler family (esbuild 0.27, `bundle: true, minify: true,
format: 'esm', target: 'es2022'`, gzip at zlib's default level) over an
entry file that imports only the pieces our chart set needs. The Angular
application builder's output differs by a few percent (it adds a module
wrapper and its own minifier settings), so treat each figure as ±5 %.
Versions and release dates come from `npm view <pkg> time`; licences from
each package's `package.json` and `LICENSE` file; CSP behaviour from a grep
of each package's distributed code for `new Function`, `eval(`,
`innerHTML`, `cssText`, `createElement('style')` and `.style.`.

## 1. The repo constraints, verified

### 1.1 Content-Security-Policy

`firebase.json:40-42` serves the one policy for `**`:

- `script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ 'sha256-…' 'sha256-…'`
  — no `'unsafe-eval'`, no `'unsafe-inline'`, no nonce. The guard
  `tools/verify/csp/check-csp.mjs:13-15` and `:82-87`
  (`REFUSED_SCRIPT_KEYWORDS`) refuses a policy that adds any of them, and
  `:28-31` (check f) refuses any extra script host. **A library that
  compiles expressions with `new Function` or `eval` cannot run**, and
  nothing can be loaded from a CDN.
- `style-src 'self' 'unsafe-inline'` — inline `style` attributes, Angular's
  `[style.x]` bindings and injected `<style>` elements are all allowed. The
  spec `tools/verify/csp/check-csp.spec.mjs:41` pins exactly this value.
  Chart libraries that set element styles are therefore not blocked today;
  the CSP cost is only on the script side.
- `img-src 'self' data: blob: https://firebasestorage.googleapis.com` —
  `canvas.toDataURL()` and `URL.createObjectURL(blob)` images render; an
  SVG-to-PNG export through an `Image` works.
- `worker-src 'self' blob:` — an export that rasterises in a worker is
  allowed.
- `firebase.json:44-45` additionally serves, **report-only**,
  `require-trusted-types-for 'script'; trusted-types angular angular#bundler`.
  Today a library that assigns `innerHTML` only produces a report; the day
  the policy is enforced, every such assignment throws. Libraries are graded
  on this below because the policy exists to be enforced.
- `eslint.config.mjs:378-383` runs `no-unsanitized/method` and
  `no-unsanitized/property` as errors on our own code, so a hand-built chart
  may not build its SVG from strings either.
- `pnpm run verify:csp` (`package.json`) builds, checks the header against
  the built `index.html`, and runs the `web:e2e-csp` smoke under the
  emulator with the header enforced; any library choice must pass it.

### 1.2 Bundle budgets

- `tools/verify/bundle/budgets.json`: the analytics route's ceiling is
  `"libs/features/staff/analytics/src/index.ts": 1680000` raw bytes,
  recorded with its dated reason ("// routes 2026-11-08, later": "Staff
  analytics' first ceiling, about 5% above its first build (1.60 MB)").
  `tools/verify/bundle/check-initial-bundle.mjs:20-21`: "A ceiling rises
  only in the commit that says why. Lower one when a route gets lighter".
- What a route is charged for: `tools/verify/bundle/initial-bundle.mjs:85-99`
  (`routeBytes`) sums the initial files, the route's chunk and "everything
  that chunk reaches through a static import". **A `@defer` block's chunk
  is a dynamic import and is not in that closure**, so a library loaded
  inside `@defer` costs the ceiling nothing (the staff dashboard already
  does this for its seven sheets, `staff-dashboard.html:324,1190,1202,1205`
  with `prefetch on idle`). The owner's rule still applies to what the phone
  then has to parse.
- Today's build (`dist/apps/web/browser-stats.json`, 2026-11-08 02:27):
  initial files 654,782 B; the analytics route 1,598,734 B — **81,266 B of
  raw headroom** under its ceiling. The route's own chunk is 61,468 B; the
  rest is the shared closure (Firebase, Angular, the DS).
- `apps/web/project.json:42-51`: the builder's own budgets — `initial`
  650 kB warning / 750 kB error, `anyComponentStyle` 10 kB warning / 20 kB
  error. A chart component's stylesheet must stay under 10 kB
  (`ui-gauge`'s is 26.9 kB on disk before minification and sits under the
  warning only once minified; a chart kit must split its CSS per component).

### 1.3 Design-system constraints

- Colour is CSS custom properties only. `libs/ui/tokens/theme-light.css:45`
  and `theme-dark.css:45` set `--sys-color-accent: #f26b22`; the dark theme
  is `:root[data-theme='dark']` (`theme-dark.css:3,6`), stamped on `<html>`
  before paint and toggled at runtime by `ThemeService.theme` (a signal,
  `libs/ui/theme/src/lib/theme.service.ts:34-43`) with a cross-fade. A chart
  that paints CSS colours (SVG `fill: var(--sys-color-accent)`) follows the
  theme for free; a canvas chart must resolve every token through
  `getComputedStyle` and re-render in an `effect()` on that signal.
- **There is no categorical or data palette.** A grep of
  `libs/ui/tokens/*.css` for `chart`, `series` and `data-` finds only
  `data-theme`, `data-density` and `data-tone`. The one multi-hue set is the
  five identity tones `--sys-identity-0…4` (`theme-light.css:130-134`,
  Apple's calendar blue/green/purple/teal/pink), documented at `:100-118`
  as "WHOSE chair, never what state" — legal for a per-barber series, not
  for categories of anything else. Everything else follows the accent law
  (`project_two_hue_palette.md`, 2026-10-06): colour is a shape, words are
  ink, one orange. The existing time bar applies it to a six-part series by
  grading the foreground: `analytics-time-bar.css:31-49` uses
  `color-mix(in srgb, var(--sys-color-foreground) 72|50|32|18|9%, transparent)`
  with the accent for the one part that matters. A chart kit inherits this
  vocabulary; a library needs the resolved hex values handed to it.
- Motion tokens: `libs/ui/tokens/tokens.css:280-294`
  (`--sys-motion-duration-instant|regular|deliberate|slow|slowest|cinematic`,
  `--sys-motion-ease-standard|emphasized|entrance`). The global reduced-
  motion switch `libs/ui/tokens/reduced-motion.css:19-29` forces every CSS
  transition and animation to 1 ms under `prefers-reduced-motion: reduce`
  (`!important`, except `[data-motion-essential]`). **It only reaches CSS**:
  a library's JavaScript tween (Chart.js, ECharts, ApexCharts, Frappe) runs
  on regardless unless we wire its own switch. The DS's JS animations check
  `matchMedia` themselves (`metric.ts:261,342`, `map.ts:569`).
- `ui-*` selectors, `.ui-x__part` class contracts, `ViewEncapsulation.None`
  on patterns (`gauge.ts`, `calendar-grid.ts`), `scope:shared type:ui` tags
  (`libs/ui/patterns/project.json`), a `type:ui` lib may depend only on
  `type:ui` (`eslint.config.mjs:240-242`) and so never on a feature or
  infrastructure lib; a new `@creativo/ui/charts` alias goes beside the
  others at `tsconfig.base.json:25-31`.
- The DS never formats a number (`metric.ts:51-53`): axis labels, readouts
  and legends arrive as strings from a presenter (Law 10), which is also
  where every decision (bucketing, comparison, threshold) has to happen —
  a chart component decides nothing.

### 1.4 Existing in-repo visuals that can be reused

| Element                              | Where                                                                                                       | How it draws                                                                                                                                                                                                                                                                  | Reusable for                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `lib-analytics-time-bar`             | `libs/features/staff/analytics/src/lib/analytics-time-bar/analytics-time-bar.ts` (2.2 kB) + `.css` (1.3 kB) | A flex track of `<span>` parts with `[style.flex-grow]="segment.share"`, `role="img"` + `aria-label`, legend as a `uiListGroup` of `uiListRow`s with a round swatch; colours by `[data-part]` in CSS                                                                          | The chair-time breakdown as a horizontal stacked bar; promote to `ui-stacked-bar` in the DS and let the feature keep only its words |
| `ui-gauge` `circularCapacity`        | `libs/ui/patterns/src/lib/gauge/gauge.ts:193-199`, `gauge.css:520-560`                                      | Two SVG `<circle>`s; the value is a custom property (`'[style.--ui-gauge-value]': 'ratio()'`, `gauge.ts:271`) driving `stroke-dasharray: calc(value × circumference)`; a rise transitions the dasharray (`gauge.css:624-628`); `role="meter"`, `aria-label`, `aria-valuetext` | Goal progress rings — already built. Also the `linearCapacity` bar with `ui-mark-scale` ticks and the `steps` style                 |
| `ui-metric`                          | `libs/ui/patterns/src/lib/metric/metric.ts`                                                                 | Figure, unit, delta on one baseline; count-up driven by a WAAPI clock (`host.animate([], {duration, easing})`) read in `requestAnimationFrame` (`metric.ts:275-300`), stopped by pointerdown/keydown/scroll, skipped under reduced motion; an accessory slot for a meter      | The hero figure and every tile; the accessory slot is where a sparkline goes                                                        |
| `ui-mark-scale`                      | `libs/ui/patterns/src/lib/mark-scale/`                                                                      | Tick marks with labels along a range                                                                                                                                                                                                                                          | An x-axis or a radial scale's rings                                                                                                 |
| `ui-calendar-grid` + `ui-date-badge` | `libs/ui/patterns/src/lib/calendar-grid/calendar-grid.ts`                                                   | Headless 7-column grid, projected cells, size set once for all badges                                                                                                                                                                                                         | A calendar heatmap is this grid with each badge's fill driven by a `--ui-cell` property                                             |
| `ui-streak-track`                    | `libs/ui/patterns/src/lib/streak-track/`                                                                    | Up to 12 period marks joined by connectors, a hidden list describing each                                                                                                                                                                                                     | A discrete per-period mini-series (kept/missed) — the pattern for a "hidden list beside the picture" a11y shape                     |
| `ui-toast` clock                     | `libs/ui/patterns/src/lib/toast/toast.ts:135-136`                                                           | Another dasharray ring                                                                                                                                                                                                                                                        | Confirms the ring recipe is already shared twice; a third copy is the point at which to extract it                                  |
| `ui-confetti`                        | `libs/ui/patterns/src/lib/confetti/confetti.ts:14`                                                          | `gsap` 3.15 timelines (gsap is a dependency; 164 kB raw of it sits in the shared chunk `chunk-BBkxT5k0.js`)                                                                                                                                                                   | Available for a path morph if CSS cannot do one; not needed for the chart set                                                       |
| The analytics page's share bars      | `staff-analytics.page.html:579` (`.staff-analytics__share`)                                                 | Horizontal bars by weekday / origin                                                                                                                                                                                                                                           | The pattern the bar chart generalises                                                                                               |
| `ResizeObserver` use                 | `libs/ui/layout/src/lib/scroll-row/scroll-row.ts:116-117`, `libs/ui/patterns/src/lib/menu/menu.ts`          | Guarded `typeof ResizeObserver === 'undefined'`                                                                                                                                                                                                                               | The width signal a chart needs to lay out in pixels                                                                                 |
| `uiVisuallyHidden`                   | `libs/ui/modifiers/src/lib/visually-hidden.directive.ts`                                                    | The one screen-reader-only recipe                                                                                                                                                                                                                                             | The hidden data table beside a chart                                                                                                |

### 1.5 Angular compatibility

`apps/web/src/app/app.config.ts:250` — `provideZonelessChangeDetection()`.
Nothing in a chart may rely on zone.js ticking after a timer or a resize;
every imperative library must be driven from `effect()` /
`afterRenderEffect()` and must call back into a signal. Angular is 22.2.3,
TypeScript 6.0.3 (`node_modules/@angular/core/package.json`). Wrapper
packages, checked on npm 2026-11-08:

- `ng2-charts` 11.0.0 (2026-09-29) — peers `@angular/core >=22`, `chart.js ^3.4||^4`.
- `ngx-echarts` 22.0.0 (2026-06-11) — peers `@angular/core >=22`, `echarts >=5`.
- `@swimlane/ngx-charts` 25.0.3 (2026-10-08) — peers `@angular/core ^21.2||^22`
  plus `@angular/animations`, `@angular/cdk`, `@angular/forms`,
  `@angular/platform-browser-dynamic`; depends on 15 d3 packages including
  `d3-selection`, `d3-transition`, `d3-brush`, `d3-sankey`, `d3-hierarchy`.

None of the three adds anything a ten-line `effect()` does not; each adds
peers we do not install (`@angular/animations`, `@angular/cdk`). They are
not assessed further.

## 2. Chart libraries

Sizes are for **our chart set only**: bars, line/area, ring (doughnut/pie),
radar, heatmap where the library has one, plus the minimum scales,
tooltip/grid components and one renderer. "Headroom" is against the 81,266 B
the analytics route has left today; a library inside `@defer` is outside
that number (§1.2) but is still parsed on open.

| Library                                                                                                                         | Version (date)                                      | Raw / gzip for our set                                                                                                                                                                   | Draws                                                            | CSP fit                                                                                                                                                                                                                                                                  | Angular 22 zoneless                                                                      | Dark mode via CSS vars                                                                                                                                                 | Radar / heatmap / sparkline                                                                                                                                                | Animation                                                                                                           | Accessibility                                                                                                            | Licence                                                                                                                                                                                                                                   | Maintenance (releases, 12 mo)      |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Chart.js** (bar, line, radar, doughnut controllers; category, linear, radialLinear scales; Filler, Tooltip)                   | 4.6.1 (2026-10-22)                                  | 184,206 / 64,524 (all registerables: 206,078 / 71,088)                                                                                                                                   | canvas                                                           | OK: 0 `new Function`/`eval`, 0 `innerHTML`, no `<style>` injection (dropped in v3, "CSS is never injected in v3", chartjs.org v3 migration guide); sets `canvas.style` via CSSOM only                                                                                    | OK; imperative `new Chart()` + `update()` from an `effect()`; no zone dependency         | No: colours are strings in options; resolve tokens with `getComputedStyle` and re-`update()` on `ThemeService.theme`                                                   | radar yes; heatmap no (needs the `chartjs-chart-matrix` plugin, not measured); sparkline = one canvas per row                                                              | JS tweens on canvas, configurable; ignores the CSS reduced-motion switch (set `animation: false` from `matchMedia`) | Bitmap: `role="img"` + `aria-label` on the canvas or fallback content; 0 ARIA in the library                             | MIT                                                                                                                                                                                                                                       | 1                                  |
| **Apache ECharts** (bar, line, pie, radar, heatmap; grid, tooltip, radar, visualMap, calendar; SVG renderer)                    | 6.1.0 (2026-05-19)                                  | 632,133 / 216,885 (canvas renderer: 624,726 / 213,127; full: 1,141,536 / 384,277)                                                                                                        | SVG or canvas (zrender)                                          | Script OK: the one `new Function` is in `coord/geo/GeoJSONResource.js:143` (not in our set); the HTML tooltip assigns `innerHTML` (`TooltipHTMLContent.js:308,316`) — fails Trusted Types when enforced unless `tooltip.renderMode: 'richText'` (`TooltipView.js:87-88`) | OK; `setOption()` from an `effect()`; `ngx-echarts` 22 exists but is unnecessary         | No: option colours are strings; re-`setOption` on theme change (6.0 added runtime theme switching)                                                                     | all three, plus a calendar coordinate system                                                                                                                               | JS tweens, good quality; ignores the CSS switch                                                                     | Has an `aria` component (`lib/component/aria.js`) generating a description                                               | Apache-2.0                                                                                                                                                                                                                                | 3                                  |
| **d3 modules** (`d3-shape`, `d3-scale`, `d3-array`, `d3-interpolate`, named imports), rendered through Angular templates as SVG | 3.2.1 / 4.0.3 / 3.2.5 / 3.0.2 (d3-shape 2026-11-03) | 73,831 / 23,538; without `d3-interpolate` and with only `scaleLinear`/`scaleBand`: 56,652 / 18,285; `d3-shape` + `d3-array` only: 29,891 / 7,868                                         | nothing — path strings and scale functions; Angular owns the DOM | OK: no DOM, 0 `innerHTML`, 0 `Function`                                                                                                                                                                                                                                  | OK: pure functions inside `computed()`                                                   | Yes, inherently (CSS paints the SVG)                                                                                                                                   | radar via `lineRadial` + `curveLinearClosed`; heatmap via `scaleBand` × 2 and a `color-mix` cell; sparkline via `line()`                                                   | Whatever CSS/WAAPI we write                                                                                         | Whatever we write                                                                                                        | ISC                                                                                                                                                                                                                                       | 1                                  |
| **Observable Plot** (named marks `barY`, `line`, `areaY`, `cell`, `rectY`, `dot`, `ruleY`)                                      | 0.6.19 (2026-11-05)                                 | 281,445 / 95,937 (namespace import: 387,444 / 132,120)                                                                                                                                   | SVG it builds itself via `document` (d3-selection)               | OK: 0 `innerHTML`, 0 `Function`; one `figure.style.maxWidth`                                                                                                                                                                                                             | Works, but it returns a detached SVG to append in `afterNextRender`; not template-driven | Partly: marks take `currentColor` and CSS classes, but fills are attributes; dark mode works if every fill is `var(--…)` via `fill: "var(--sys-color-accent)"` strings | radar no (no polar scale); heatmap yes (`cell`); sparkline yes (`axis: null`)                                                                                              | None built in                                                                                                       | Generates `aria-label` per mark group, root `ariaLabel`/`ariaDescription` (observablehq.com/plot/features/accessibility) | ISC                                                                                                                                                                                                                                       | 5                                  |
| **uPlot**                                                                                                                       | 1.6.32 (2025-03-14)                                 | 51,998 / 23,195 (+ its CSS file)                                                                                                                                                         | canvas                                                           | OK: 0 `innerHTML`/`Function`; sets `el.style.*` via CSSOM                                                                                                                                                                                                                | OK; imperative                                                                           | No; colour strings                                                                                                                                                     | time series, lines, areas, bars only — "No transitions or animations — they're always pure distractions" (README "Non-Features"); no radar, no heatmap (custom draw hooks) | None by design                                                                                                      | 2 ARIA strings                                                                                                           | MIT                                                                                                                                                                                                                                       | 0                                  |
| **ApexCharts**                                                                                                                  | 8.8.0 (2026-11-08)                                  | 974,689 / 294,177                                                                                                                                                                        | SVG (svg.js)                                                     | Script OK; `innerHTML` in legend markers (`apexcharts.esm.js:2683,2686`)                                                                                                                                                                                                 | OK; imperative                                                                           | No; colour strings and its own CSS theme                                                                                                                               | all three                                                                                                                                                                  | JS/SVG tweens                                                                                                       | Some ARIA                                                                                                                | **Not MIT since 8.x: dual licence**. `LICENSE.md`: Community only under $2M revenue, and "Embedding in a product or platform used by other people … needs the OEM License … whatever your size" — a SaaS used by barbershops is that case | 67                                 |
| **Chartist** (`BarChart`, `LineChart`, `PieChart`)                                                                              | 2.2.0 (2026-10-20)                                  | 53,846 / 19,748 (+ its CSS)                                                                                                                                                              | SVG, styled by CSS classes                                       | Script OK; `container.innerHTML = content` (`dist/index.js:1173`) and `style.cssText` — Trusted Types risk                                                                                                                                                               | OK; imperative                                                                           | **Yes** — its whole model is "style the SVG with CSS"                                                                                                                  | no radar, no heatmap; sparkline = a tiny line chart                                                                                                                        | SMIL `<animate>` helpers; none by default                                                                           | 3 ARIA strings                                                                                                           | MIT OR WTFPL                                                                                                                                                                                                                              | 6                                  |
| **Frappe Charts**                                                                                                               | `latest` 1.6.2; `next` 2.0.0-rc31 (2026-10-19)      | 76,748 / 18,553                                                                                                                                                                          | SVG                                                              | 17 `innerHTML`/`cssText` sites (tooltip `innerHTML`, `frappe-charts.esm.js:218-243`) — fails enforced Trusted Types                                                                                                                                                      | OK; imperative                                                                           | Partly (CSS on SVG, but colours are option strings)                                                                                                                    | heatmap yes (GitHub-style calendar), radar no, sparkline no                                                                                                                | SVG transform tweens                                                                                                | None found                                                                                                               | MIT                                                                                                                                                                                                                                       | 4 (all RCs; 1.x last stable 1.6.2) |
| **Vega + Vega-Lite + vega-interpreter**                                                                                         | 6.4.0 / 6.5.0 / 2.3.2 (2026-10-08)                  | 804,819 / 279,246                                                                                                                                                                        | SVG or canvas                                                    | Default expression compiler uses `Function` (25 sites in `vega-functions`, 2 in `vega-expression`) — **blocked** by our `script-src`; `vega-interpreter` makes it CSP-compliant at "~10% slower" (vega.github.io/vega/usage/interpreter)                                 | OK; imperative                                                                           | No; colour strings in the spec                                                                                                                                         | all three                                                                                                                                                                  | Limited                                                                                                             | Generates `aria-label`/`role`                                                                                            | BSD-3-Clause                                                                                                                                                                                                                              | 3                                  |
| **Hand-built `libs/ui/charts`** (SVG from Angular templates, own scales and path builders)                                      | —                                                   | ≈ 0 third-party; the kit itself ≈ 25–40 kB raw across 8 components judging by the DS's `ui-gauge` (20.9 kB TS + 26.9 kB CSS on disk) and `ui-metric` (13.0 + 5.6 kB) before minification | SVG + CSS                                                        | OK by construction: templates, no strings into the DOM (`no-unsanitized` enforced)                                                                                                                                                                                       | Native: signals in, SVG out                                                              | Yes, the same `--sys-*` tokens and `color-mix` grading the time bar uses                                                                                               | all three, as templates                                                                                                                                                    | CSS transitions / `@property` / WAAPI, under the global reduced-motion switch                                       | We write it: `role="img"`, `aria-label` from the presenter, a `uiVisuallyHidden` table                                   | —                                                                                                                                                                                                                                         | Ours                               |

Notes on the table:

- **CSP, script side.** Only Vega is blocked outright (and only its default
  compiler). Everything else runs under today's `script-src`. The
  differentiator is Trusted Types: Chart.js, uPlot, Plot and the d3
  modules assign no `innerHTML`; ECharts does in one tooltip mode; ApexCharts,
  Chartist and Frappe do in their core.
- **CSP, style side.** `style-src 'unsafe-inline'` means no library is
  blocked on styles today. The design system's own `[style.--ui-x]`
  bindings depend on the same keyword.
- **Why canvas costs more here than its bytes.** Three repo mechanisms are
  CSS-only: the theme (`data-theme` tokens), the reduced-motion switch, and
  the accent grading via `color-mix`. A canvas chart has to re-implement
  each in JavaScript (resolve tokens, watch `ThemeService.theme`, watch
  `matchMedia`, compute the mixes), and still ends as a bitmap a screen
  reader cannot enter. An SVG chart styled by CSS gets all three for free.
- **Phone performance.** The whole screen's chart set is small: ≤ 31 bars
  per period, a 7 × ~14 heatmap (~100 cells), a radar of 6–8 vertices, a
  few rings, sparklines of 7–30 points — under ~500 SVG nodes in total.
  Published comparisons put canvas ahead of SVG only above a few hundred
  _animated_ elements (jad-apps-site.pages.dev "SVG vs canvas": "above
  200–500 elements for animated content"); below that the cost is parse and
  layout, which is where 184–975 kB of library loses to 0. Transitions on
  `transform`, `opacity` and `stroke-dasharray` stay off the main thread;
  path-`d` morphs do not and are avoided in §5.
- **Observable Plot** is the closest off-the-shelf fit for a CSS-styled SVG
  kit but costs 281 kB raw for a subset, has no radar, and builds its SVG
  outside Angular's template so every label, test id and token binding is a
  post-processing step.

## 3. Export options

| Option                                                                             | Version (date)       | Raw / gzip        | CSP fit                                                                                                                                | Licence | Maintenance                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSV via `Blob` + `<a download>` / `navigator.share({ files })`**                 | browser              | 0                 | OK (`blob:` is in `img-src`; a download link needs nothing)                                                                            | —       | —                                | `text/csv;charset=utf-8` with a BOM so Excel reads UTF-8 Cyrillic; rows come from the presenter's display structs (the figures the screen shows, by definition identical to them). The design doc lists CSV export at v2 (`docs/designs/staff-analytics.md:758`).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Native share of a PNG** (`SVG → Image → canvas.toBlob → File → navigator.share`) | browser              | 0                 | OK; needs transient activation (a tap) and a secure context (MDN `Navigator.share`)                                                    | —       | —                                | caniuse.com/web-share (fetched 2026-11-08) lists the API as supported in Safari iOS 12.2+, Safari 12.1+, Chrome Android, Chrome desktop 128+ (89–127 partial) and not in Firefox desktop; it does not break out the `files` member, and MDN's compatibility table did not load, so the per-browser file-sharing versions are **unverified** here (from memory: Safari iOS 15, Chrome Android 75; confirm before relying on them). The rule that holds regardless: detect with `navigator.canShare({ files })`, fall back to `<a download>`. Our SVG is ours, so inlining the computed `fill`/`stroke`/`font` before serialising is a short walk (CSS variables do not survive serialisation into an `Image`). |
| **Print to PDF** (`@media print` stylesheet + `window.print()`)                    | browser              | 0                 | OK                                                                                                                                     | —       | —                                | iOS and Android share sheets offer "Save as PDF"; prints the live DOM, so the chart's SVG and the DS type come through. No file is produced in-app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **html-to-image** (`toPng`, `toBlob`)                                              | 1.11.13 (2025-02-14) | 13,255 / 5,292    | OK: 0 `Function`/`innerHTML`; serialises DOM to SVG `foreignObject`                                                                    | MIT     | 0 releases in 12 months          | Known to miss `foreignObject` rendering details in Safari; fonts must be embedded. Unnecessary when the chart is already SVG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **dom-to-image-more**                                                              | 3.11.0 (2026-09-24)  | 29,834 / 10,964   | OK                                                                                                                                     | MIT     | 9                                | Same technique as above, maintained fork. Same remark.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **jsPDF**                                                                          | 4.2.1 (2026-03-17)   | 818,496 / 251,742 | OK: 0 `Function`/`eval` in `jspdf.es.min.js`; optional deps `canvg`, `html2canvas`, `dompurify`, `core-js` not bundled unless imported | MIT     | 5                                | Produces a real PDF file in the browser; text needs a font with Cyrillic glyphs embedded (adds the TTF, ~100–300 kB). Only ever inside a `@defer` chunk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **pdf-lib**                                                                        | 1.17.1 (2021-11-06)  | 524,287 / 206,933 | OK                                                                                                                                     | MIT     | **0 — no release in five years** | Lower-level than jsPDF; same font requirement; unmaintained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 4. Recommendation

**Build `libs/ui/charts` — SVG drawn from Angular templates, styled by the
`--sys-*` tokens, with no third-party dependency** (adopt `d3-shape` +
`d3-array`, 29,891 B raw / 7,868 B gzip, ISC, only if the hand-written
monotone curve or stack layout proves wrong in a spec). Export CSV and PNG
through the browser's own `Blob`, `canvas.toBlob` and Web Share; defer any
in-app PDF file until a user asks for one, and meet "PDF" with a print
stylesheet first.

### Rubric (1 = poor, 5 = fits the repo as it is)

| Criterion                                                                                              | Weight | Hand-built SVG | Chart.js 4 | ECharts 6 (SVG) | d3 modules + templates | Observable Plot | Chartist 2 | Frappe 1.6 / 2 rc | uPlot    | ApexCharts 8 | Vega-Lite 6 |
| ------------------------------------------------------------------------------------------------------ | ------ | -------------- | ---------- | --------------- | ---------------------- | --------------- | ---------- | ----------------- | -------- | ------------ | ----------- |
| Bundle cost (vs 81 kB headroom; `@defer` possible)                                                     | 25 %   | 5              | 2          | 1               | 4                      | 2               | 4          | 4                 | 4        | 1            | 1           |
| CSP fit (script-src today, Trusted Types tomorrow)                                                     | 15 %   | 5              | 5          | 3               | 5                      | 5               | 3          | 2                 | 5        | 3            | 2           |
| Design-system fit (tokens, dark mode, accent law, reduced motion, `ui-*` contracts, presenter wording) | 25 %   | 5              | 2          | 2               | 5                      | 3               | 4          | 2                 | 2        | 1            | 1           |
| Phone performance for this chart set                                                                   | 20 %   | 5              | 4          | 3               | 5                      | 4               | 4          | 3                 | 5        | 2            | 2           |
| Maintenance (theirs and ours; coverage of radar + heatmap + sparkline)                                 | 15 %   | 3              | 4          | 5               | 4                      | 3               | 2          | 2                 | 2        | 1            | 3           |
| **Weighted**                                                                                           |        | **4.70**       | **3.15**   | **2.60**        | **4.65**               | **3.25**        | **3.55**   | **2.75**          | **3.50** | **1.50**     | **1.70**    |

The d3-modules row and the hand-built row differ only in who writes ~300
lines of scale and path code; the hand-built row scores higher on bundle
cost and equal elsewhere, which is why the recommendation is to start without
d3 and let a failing spec, not a preference, bring `d3-shape` in.

What the recommendation costs: a kit of about eight components (§5), each
with a geometry spec, a CSS-contract spec in the style of `gauge.spec.ts`,
and both-theme screenshots in the existing Playwright screenshot suites
(`apps/web/e2e/*-screenshots.spec.ts` with `expectNoAxeViolations`). Judged
by `ui-gauge` (four styles, 47 kB of source) and `ui-metric`, that is on the
order of two to three weeks of design-system work before the analytics
feature can compose the first screen from it.

### The strongest counter-argument

Chart.js 4, tree-shaken to our set, inside a `@defer (on viewport; prefetch
on idle)` block, costs the route ceiling nothing (§1.2: a dynamic chunk is
outside `routeBytes`' static closure), is MIT, has no `eval`, no
`innerHTML`, no CSS injection, radar built in, one maintained release a
year, and ships tooltips, hit-testing, tick selection, label fitting,
responsive resize and animation today. The owner's rule explicitly allows
"load on demand and higher ceilings"; the bundle argument alone does not
decide against it, and a team that has never shipped a radar or a touch
readout will spend the saved bytes in weeks of edge cases (axis ticks that
land on round numbers, labels that collide at 320 px, a pointer readout
that does not fight the page scroll, radial text). The honest answer is
that this counter-argument wins on _time to first chart_ and loses on
everything the design system already paid for: the theme, reduced motion,
the accent grading and the `ui-*` contract are CSS, and a canvas forces each
back into JavaScript, then adds a bitmap a screen reader cannot enter and a
second animation system beside the one the DS already runs
(`metric.ts:275-300`). If the kit is not built, Chart.js inside `@defer`
with `animation` gated on `matchMedia` and colours resolved from
`getComputedStyle` on `ThemeService.theme` is the fallback, and the heatmap
and calendar heatmap are still built by hand on `ui-calendar-grid` because
Chart.js has neither.

## 5. What a hand-built `libs/ui/charts` needs

**Project.** `libs/ui/charts`, tags `scope:shared`, `type:ui`, alias
`@creativo/ui/charts` beside the others at `tsconfig.base.json:25-31`;
`ui-*` selectors, `ViewEncapsulation.None` with `.ui-<name>__*` class
contracts like every pattern; one stylesheet per component under the 10 kB
`anyComponentStyle` warning; `OnPush`, `input()`/`computed()`, no `class`
outside the Angular shell. It may import `@creativo/ui/tokens`, `modifiers`,
`patterns` (the gauge, the mark scale, the calendar grid) and nothing
outside `type:ui`.

**Components** (each takes display structs from a presenter and decides
nothing):

| Element               | Draws                                                                                                                                                                                                                            | Reuses                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `ui-bar-chart`        | Vertical bars, grouped or stacked; an optional previous-period series drawn as a quieter bar behind or beside each bar (`color-mix(foreground 18–32 %)`); x labels as strings                                                    | `ui-mark-scale` for the y ticks     |
| `ui-line-chart`       | Line and/or area for 7–31 points, optional comparison series, one highlighted point with a readout                                                                                                                               | —                                   |
| `ui-sparkline`        | A line of 7–30 points with no axes, sized by its row; sits in a `ui-list-row` trailing slot or `ui-metric`'s accessory slot                                                                                                      | —                                   |
| `ui-stacked-bar`      | The horizontal track promoted from `lib-analytics-time-bar`, legend included                                                                                                                                                     | The time bar's CSS verbatim         |
| `ui-ring`             | Not new: `ui-gauge` `circularCapacity`, with a multi-arc variant (several dasharray arcs offset by `stroke-dashoffset`) for the chair-time ring                                                                                  | `ui-gauge`                          |
| `ui-heatmap`          | A 7 × N grid of `<rect>` (or a CSS grid of `<span>`) with `--ui-cell: 0…1` per cell and `fill: color-mix(in srgb, var(--sys-color-accent) calc(var(--ui-cell) * 100%), var(--sys-color-fill))`; row and column labels as strings | —                                   |
| `ui-calendar-heatmap` | `ui-calendar-grid` with tinted `ui-date-badge` cells                                                                                                                                                                             | `ui-calendar-grid`, `ui-date-badge` |
| `ui-radar`            | 3–8 axes, gridlines as concentric polygons, one or two filled polygons (`fill-opacity` 0.18 + stroke), vertex labels as strings; per-barber series may use `--sys-identity-N`                                                    | —                                   |
| `ui-chart-legend`     | The time bar's legend generalised: swatch + words + value in `uiListRow`s                                                                                                                                                        | `UiListGroup`, `UiListRow`          |
| `ui-chart-readout`    | One pointer-driven vertical rule plus a value label; `touch-action: pan-y` so vertical scroll wins, horizontal drag moves the readout; no floating tooltips                                                                      | —                                   |

**Geometry (`*.geometry.ts`, pure, specced).** `linearScale(domain,
range)`, `bandScale(count, range, paddingInner, paddingOuter)`, `niceTicks(
min, max, count)` (1-2-5 stepping, always includes 0 for bars),
`polarPoint(cx, cy, r, angle)`, `linePath(points)`, `monotonePath(points)`
(Fritsch–Carlson tangents, ~60 lines), `areaPath(points, baseline)`,
`roundedBarPath(x, y, w, h, r)` (top corners only), `polygonPath(points)`,
`arcDasharray(value, circumference)`, `stackOffsets(series)`. Every function
has a same-input-same-output spec and boundary cases (one point, all zeros,
negative deltas, max = min). These are display geometry, not domain math:
the values are already decided.

**Sizing.** A `ResizeObserver` (guarded as in `scroll-row.ts:116-117`) feeds
a `width` signal; geometry is computed in CSS pixels in a `computed()` and
written as attributes, so text never stretches; the SVG has `viewBox` equal
to its pixel box. Text uses the DS type roles through CSS, tabular figures
on every numeral (`project_tabular_figures_shorthand.md`).

**Colour.** CSS only. The accent is the one series that matters (this
period, worked, the goal); the previous period and secondary parts are the
foreground graded through `color-mix`, as in `analytics-time-bar.css:31-49`;
per-barber series are `--sys-identity-0…4` and nothing else may use them;
heatmap cells mix the accent into `--sys-color-fill` by value. Words are ink.
Marks must clear 3:1 against the surface (SC 1.4.11) or get a hairline — the
18 % and 9 % greys do not, which the time bar accepts because it is read as
one shape; a bar chart cannot, so its comparison bars take 32 % and a
1 px `--sys-color-separator` edge.

**Animation.** Enter: bars `transform: scaleY(0 → 1)` with
`transform-origin` at the baseline, lines via `stroke-dasharray`/`-offset`
draw-on, areas and radar polygons via `opacity`, rings via the gauge's
dasharray transition — all compositor-friendly CSS transitions on
`--sys-motion-duration-deliberate` / `--sys-motion-ease-emphasized`, which
the global switch (`reduced-motion.css:19-29`) shortens to 1 ms. Change of
value: register `@property --ui-chart-value { syntax: '<number>'; inherits:
false; initial-value: 0; }` so the custom property itself transitions and
`calc()`-driven heights, dasharrays and heatmap mixes glide (Safari 16.4+,
Chrome 85+); where a path's `d` would have to morph (line, radar), cross-
fade the old and new path instead — `d` is not animatable in Safari and
morphing on the main thread is the one thing here that could lag. Count-up
figures stay `ui-metric`'s. No JavaScript tween loop of our own; if one is
ever needed, copy `metric.ts:275-300` (WAAPI clock + rAF, stopped by
pointerdown/keydown/scroll, skipped under reduced motion). Verify on a
production build at 4× CPU throttle (`feedback_buttery_smooth_pwa.md`).

**Accessibility.** The SVG is `role="img"` with `aria-label` set to a
one-sentence summary the presenter writes («Оборот по дни, най-висок
петък, 420 €»), `focusable="false"`, `aria-hidden` on decorative gridlines;
beside it a `uiVisuallyHidden` `<table>` (or `<ul>` for a sparkline) with
the same labels and values, linked by `aria-describedby`, so the data is
readable row by row — the `ui-streak-track` shape. The readout's current
value goes into one `aria-live="polite"` span, updated on pointer-up, not
per frame. Every chart has a Playwright screenshot in both themes and
passes `expectNoAxeViolations`.

**Export (`chart-export.ts`, in the analytics feature, not the DS).**
`svgToPngBlob(svg, scale = devicePixelRatio)`: clone the SVG, walk its
nodes copying `fill`, `stroke`, `stroke-width`, `font`, `opacity` from
`getComputedStyle` into attributes (CSS variables do not survive
serialisation), set the theme's `--sys-color-background` as a `<rect>`
behind, `XMLSerializer` → `Blob` → `Image` → `canvas` → `toBlob('image/png')`.
Share with `navigator.canShare({ files }) ? navigator.share(...) :
<a download>`, from a tap (transient activation). CSV: the presenter's rows
joined with `;` or `,` by locale, BOM-prefixed, `text/csv`. PDF: a print
stylesheet first; `jsPDF` only in a `@defer` chunk and only if a file is
demanded, with a Cyrillic-capable font embedded. `pdf-lib` is not an option
(unmaintained since 2021).

**Order of work.** 1) promote the time bar track and legend to
`ui-stacked-bar` / `ui-chart-legend` (zero new drawing); 2) `ui-sparkline`
and `ui-bar-chart` with comparison, which cover takings and period
comparison; 3) `ui-heatmap` and `ui-calendar-heatmap` on the calendar grid
(the design doc's v1.1 "weekday × hour demand grid",
`docs/designs/staff-analytics.md:752`); 4) `ui-radar`; 5) export. Rings are
`ui-gauge` from day one.

## Sources

- Repo: `firebase.json`, `tools/verify/csp/check-csp.mjs`,
  `tools/verify/bundle/{budgets.json,initial-bundle.mjs,check-initial-bundle.mjs}`,
  `apps/web/project.json`, `libs/ui/tokens/*.css`,
  `libs/ui/theme/src/lib/theme.service.ts`, `libs/ui/patterns/src/lib/{gauge,metric,calendar-grid,streak-track,toast,confetti}`,
  `libs/features/staff/analytics/src/lib/**`, `docs/designs/staff-analytics.md`,
  `dist/apps/web/browser-stats.json` (build of 2026-11-08).
- Measurements: scratch bundle with esbuild 0.27 over the npm packages at
  the versions named; `npm view <pkg> time` for dates.
- Chart.js: chartjs.org/docs/latest/getting-started/integration.html
  (tree-shaking, registration); chartjs.org/docs/latest/migration/v3-migration.html
  ("No more CSS injection"; `disableCSSInjection` removed).
- ECharts: echarts.apache.org/handbook/en/basics/import (modular import,
  renderer choice); `node_modules/echarts/lib/component/tooltip/*.js`.
- uPlot: `node_modules/uplot/README.md` ("No transitions or animations").
- Vega: vega.github.io/vega/usage/interpreter (CSP-compliant interpreter,
  ~10 % slower).
- ApexCharts: `node_modules/apexcharts/LICENSE.md` (Community / Commercial /
  OEM terms).
- Observable Plot: observablehq.com/plot/features/accessibility.
- Web Share: caniuse.com/web-share; developer.mozilla.org/en-US/docs/Web/API/Navigator/share
  (secure context, transient activation, `canShare`).
- SVG vs canvas thresholds: jad-apps-site.pages.dev/svg-tools/guides/svg-vs-canvas-rendering-performance;
  chartts.pages.dev/blog/best-lightweight-chart-libraries (third-party, not relied on for figures).
