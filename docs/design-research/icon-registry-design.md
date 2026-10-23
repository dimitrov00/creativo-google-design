# The icon and logo registry

## Semantic keys in code, artwork decided elsewhere — and, later, by the backend

**Status:** design record · **canonical for icons and the logo.** Supersedes the icon sections of [design-system-proposal.md](./design-system-proposal.md) and the "icons inherit font size" mechanics in [styling-typography-case-study.md](./styling-typography-case-study.md) (the ladder survives; the font does not).
**Scope:** every icon in the app and the wordmark — vocabulary, manifest, resolution, rendering, backend override, enforcement, migration.
**Surface:** `libs/ui/icons` (`ui-icon`, `ui-logo`, `UiIconRegistry`), `tools/icons`, `tools/lint-rules`.
**Date:** 2026-09-24 · Angular **22.0.6** installed (`^22.0.0` is the active release line, 2026-06-03 → 2027-06; [angular.dev/reference/releases](https://angular.dev/reference/releases)).

> **What was already true before this pass.** The repo had a semantic registry since 2026-07-23: `ui-icon` took a closed `UiIconName` union, `icon-registry.ts` mapped ~130 dotted keys to Material Symbols ligatures, `provideUiIcons` remapped through DI, map pins resolved imperatively. What it did not have: a manifest, aliases, a logo path, a backend seam, a defined failure mode, lint enforcement, or a delivery mechanism that did not cost 5.1 MB and render an unknown glyph as its own name in capitals. This document keeps the first and adds the rest. **Assumption stated up front:** the brief's snake_case `<domain>_<action>` convention is an offered starting point; the repo's `domain.action` grammar is kept (§3) because 259 call sites, CSS keyed on `data-name`, and dated owner rulings already speak it.

---

## 1 · Research summary

Every claim below was checked against the linked source on 2026-09-24 unless marked **[not verified]**.

### 1.1 Angular version and idiom

| Option                        | Finding                                                                                                                                                           | Decision                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Target v22 (installed 22.0.6) | v22 is the active line; v21/v20 are LTS ([releases](https://angular.dev/reference/releases)). The app is already zoneless, standalone, signal inputs, `@if/@for`. | **Target v22.** Everything new is signals + `computed`; `provideEnvironmentInitializer` starts the registry; no `NgModule`, no `zone.js`. |

### 1.2 Material icons in Angular — delivery

| Option                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                              | Trade-off                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Angular Material `mat-icon` + `MatIconRegistry`**      | Font ligatures by default (Material Symbols); SVG icons are fetched with `HttpClient` and "must be marked as trusted" via `DomSanitizer`; `aria-hidden="true"` by default ([icon.md](https://github.com/angular/components/blob/main/src/material/icon/icon.md)).                                                                                                     | Adds `@angular/material` (not installed here) for one component; SVG path is async per icon (a blank until fetched); the registry API is imperative and string-keyed — no closed key type.                                                                                                                                                                                                     |
| **Variable ligature font (status quo)**                  | Axes FILL/wght/GRAD/opsz; Google recommends `display=block` "to prevent a flash of unstyled text content"; the CSS API's `icon_names` subsets 295 KB → 1.7 KB ([Material Symbols guide](https://developers.google.com/fonts/docs/material_symbols)). Self-hosted, the `material-symbols` package's rounded face is **5.1 MB** and its CSS sets `font-display: block`. | Any name renders at runtime (good for remote overrides) — but an unknown name renders as its own text, 5 MB on first visit, `block` hides icons until the font lands, and a subset needs either Google's origin (CSP, privacy, a runtime third party) or a font-tooling build step. The house pins every axis (`FILL 1 · wght 400 · opsz 24`), so the variable font's one advantage is unused. |
| **Per-icon SVG packages (`@material-symbols/svg-400`)**  | Filled/unfilled per style; **"size (opsz) 48px … other variations … are not included"** (package README).                                                                                                                                                                                                                                                             | Wrong optical size for a house cut pinned at 24 — strokes visibly lighter at 16–24 px. Rejected on fidelity.                                                                                                                                                                                                                                                                                   |
| **Pinned path data from `google/material-design-icons`** | `symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg` is served per commit; every file is one `<path>` on `viewBox="0 -960 960 960"` (verified by fetching).                                                                                                                                                                                              | Needs a generator and a committed table (a build step the repo otherwise avoids — justified in §2.3). Synchronous render, ~35 KB of path data for 88 glyphs (11 KB gzip), no font, no flash, no layout shift.                                                                                                                                                                                  |

**Decision: inline SVG path data, generated from a pinned revision, drawn by `ui-icon`.** It is the only option that meets _no flash / no shift / minimal bytes_ and _validated remote overrides_ at once. Font vs SVG for icons is not contested in 2025–26 writing (fonts lose on FOUT, CLS and per-glyph shipping — e.g. [KeyCDN](https://www.keycdn.com/blog/icon-fonts-vs-svgs), secondary source); what is contested is _how_ to ship SVG. For 88 icons in one SPA, an inlined table beats per-icon fetches (mat-icon's model) because the first render of every screen is synchronous and offline-safe.

### 1.3 Prior art for semantic icon systems

| System         | What it does                                                                                                                                                                                                                                                                                                                 | Taken here                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **SF Symbols** | "over 7,000 symbols" named by concept, "nine weights and three scales, automatically align with text", four rendering modes ([developer.apple.com/sf-symbols](https://developer.apple.com/sf-symbols/)). Code says `Image(systemName:)`; Apple redraws per OS.                                                               | The mental model: keys are concepts; the 1em/ladder sizing; `uiLabel` ≙ accessibility label vs decorative. |
| **Carbon**     | Icons published as `name--modifier`; metadata tracks **aliases** used for search; deprecations are dated ([icons guide](https://github.com/carbon-design-system/carbon/blob/main/docs/guides/icons.md)).                                                                                                                     | Aliases as first-class data; a deprecation path (alias old → new for a release).                           |
| **Polaris**    | Removed `Major`/`Minor` size suffixes and renamed the whole set in one version, with a migrator ([issue #11088](https://github.com/Shopify/polaris-react/issues/11088), [v12 guide](https://polaris-react.shopify.com/version-guides/migrating-from-v11-to-v12)).                                                            | A rename is a codemod plus a deprecation window, not a manual sweep.                                       |
| **Atlassian**  | Rebuilt "more than 350 icons created by different product teams" into one system; kept a `migration-map` entry point until "the legacy glyph icon migration path … has now been fully completed", then deleted it ([building the new icon system](https://atlassian.design/whats-new/building-atlassians-new-icon-system/)). | Migration tooling is temporary by design; the sweep script stays, the codemod's map is a `tmp/` artefact.  |

**Decision on naming (§3):** dotted `domain.action[.qualifier]`, camelCase segments, closed TypeScript union, aliases typed against concrete keys.

### 1.4 Delivering runtime configuration (Firebase-compatible)

| Option                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fit for a single-tenant Firebase SPA                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Firebase Remote Config**            | 3,000 parameters, 1,000,000 characters of values per project ([quotas](https://firebase.google.com/docs/remote-config/quotas-limits)); real-time updates on web need JS SDK ≥ 12.3.0 ([real-time](https://firebase.google.com/docs/remote-config/web/real-time)); **not part of the Local Emulator Suite** ([emulator suite](https://firebase.google.com/docs/emulator-suite/install_and_configure) — from the docs' service list; the sentence itself was not fetched verbatim **[partly verified]**). | Built for exactly this ("change appearance without an update"), but: no emulator (this repo's whole dev loop is `pnpm dev` = emulators + seed), a second SDK module, and an admin surface that already exists here for Firestore, not RC. |
| **Firestore `settings/<doc>`**        | Persistent cache serves documents offline transparently; `persistentMultipleTabManager` shares it across tabs; `fromCache` metadata distinguishes stale reads ([offline data](https://firebase.google.com/docs/firestore/manage-data/enable-offline)). The repo already has `settings/bookingPolicy` with a reader port, adapter, rules (`allow read: if true; allow write: if isAdmin()`), seed and rules tests.                                                                                       | Live push, offline-by-default, emulated, admin-writable, one existing pattern to mirror.                                                                                                                                                  |
| **Static `manifest.json` on Hosting** | Cheapest read; versioned by deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | "Without shipping a build" holds only if a hosting-only deploy counts; no admin edit path; no live update. Rejected.                                                                                                                      |
| **Client-side patterns**              | Bootstrap with an initial value set so evaluation is never a network round trip away ([LaunchDarkly bootstrapping](https://launchdarkly.com/docs/sdk/features/bootstrapping)); work from cached configuration when offline, validate before swapping into memory, keep the previous cache on failure ([Unleash best practices](https://docs.getunleash.io/guides/feature-flag-best-practices)).                                                                                                         | Adopted verbatim: bundled defaults → synchronous last-known-good → validated live stream; a rejected document never replaces a good one.                                                                                                  |

**Decision: ship the seam, not the backend.** The registry exposes `UiIconManifestSource` / `provideUiIconManifest` and validates whatever arrives through it (§6); nothing in `apps/web` provides one. Owner ruling (2026-09-24): "change icons without an app update" is a native-app concern — on Firebase Hosting a redeploy takes a minute and reaches every user on their next load, so a live layer would only add a document, rules, a cache and a listener to maintain. If it is ever wired, the analysis above says Firestore `settings/<doc>` over Remote Config (emulated, admin-writable, one existing pattern to mirror), and the recipe in §6 is the whole change.

### 1.5 Sanitizing remotely supplied SVG

| Option                           | Evidence                                                                                                                                                                                                                                                                                                            | Decision                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DOMPurify**                    | `USE_PROFILES: { svg: true, svgFilters: true }` allows "all safe SVG elements and SVG Filters"; `FORBID_TAGS`/`FORBID_ATTR` narrow further; `javascript:` in `href`/`xlink:href` is the classic vector; `foreignObject` should be forbidden for untrusted input ([DOMPurify](https://github.com/cure53/DOMPurify)). | The correct tool **if markup must be accepted**.                                                                                                                                                                                                                         |
| **Accept data, not markup**      | SVG path data (`d`) is a grammar of commands and numbers; it cannot name a script, URL, stylesheet, handler or external document. Every Material Symbol is one path; the wordmark is eight.                                                                                                                         | **Chosen.** The manifest's vector asset is `{ viewBox, paths: [{ d, fill?, stroke?, … }] }`, validated by regex and length, rendered by our own `<svg>` builder. Nothing executable can be expressed, so there is nothing to sanitize and no dependency to keep current. |
| **`<img>` for arbitrary assets** | When SVG is used as an image, "JavaScript is disabled" and "external resources … cannot be loaded" ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image)).                                                                                                                                | The logo's `image` kind: any raster or multi-colour SVG, restricted to same-origin paths and allow-listed `https://` origins, with intrinsic `width`/`height` so the box is reserved.                                                                                    |

### 1.6 Enforcing "no direct usage" in an Angular codebase

| Layer                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                            | Used                                                                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`no-restricted-imports`**                    | gitignore-style `group` patterns, `regex`, `importNames`, custom `message` ([ESLint docs](https://eslint.org/docs/latest/rules/no-restricted-imports)).                                                                                                                                                                                                                                             | Considered — but this repo's infra/kernel/functions configs _redeclare_ that rule to drop the Firebase half, so a root-level addition would be silently lost in 9 projects.       |
| **`no-restricted-syntax` + esquery selectors** | Attribute regex (`[attr=/re/]`), nested attributes (`[value.raw]`), child/descendant combinators ([selectors](https://eslint.org/docs/latest/extend/selectors)).                                                                                                                                                                                                                                    | **Used** for imports (`ImportDeclaration[source.value=/^(material-symbols                                                                                                         | …)/]`), dynamic imports, `as UiIconName`, and Material class/font names in literals — one rule no project overrides. |
| **Custom angular-eslint template rule**        | `getTemplateParserServices(context)`, `Element[name="…"]` selectors, `convertNodeSourceSpanToLoc`, tested with `RuleTester` + `@angular-eslint/template-parser` ([WRITING_CUSTOM_RULES.md](https://github.com/angular-eslint/angular-eslint/blob/main/docs/WRITING_CUSTOM_RULES.md)). Nx's `flat/angular` applies the inline-template processor to `**/*.ts` (checked in `@nx/eslint-plugin` 23.1). | **Used:** `creativo/icon-registry-only` — `<mat-icon>`, raw ligature classes, raw glyph names in `uiName`/`uiIcon` (static and every literal branch of a binding), `<img>` logos. |
| **Nx `workspace-rule` generator**              | Predates flat config; the loader has open issues ([nrwl/nx#19754](https://github.com/nrwl/nx/issues/19754)); and `@nx/eslint-plugin` treats the literal folder `tools/eslint-rules` as its TypeScript rule root (observed: it tried to load a `tsconfig.json` from there).                                                                                                                          | Rejected. The plugin is plain ESM in `tools/lint-rules`, imported by relative path from the root config — the one loading path flat config guarantees.                            |
| **Template type-checking**                     | `strictTemplates` rejects a raw `uiName` on `ui-icon` at build. But `nx typecheck` is plain `tsc` and never sees templates ([project memory](../../README.md)).                                                                                                                                                                                                                                     | The base guarantee; the lint rules give the same answer at lint time, per project, and cover what types cannot see.                                                               |
| **stylelint**                                  | `declaration-property-value-disallowed-list`, `selector-disallowed-list`.                                                                                                                                                                                                                                                                                                                           | `font-family` may not name Material; `.material-*` / `mat-icon` selectors banned — re-declared inside the `--sys-*` override that otherwise nulls the rule.                       |
| **Repo-wide sweep in CI**                      | —                                                                                                                                                                                                                                                                                                                                                                                                   | `pnpm icons:check` runs regardless of the affected graph; the lint rules only run for projects that changed.                                                                      |

---

## 2 · Architecture

### 2.1 The picture

```
 feature template                       ui/icons (the registry's boundary)                    backend
 ─────────────────                      ────────────────────────────────────────────────      ─────────────────
 <ui-icon uiName="visit.noShow"/>  ──▶  UiIcon ── computed ──▶ UiIconRegistry.resolve(key, DI overrides)
 <ui-logo uiLabel="Creativo"/>     ──▶  UiLogo ── computed ──▶ UiIconRegistry.logo()
 map pins (MapLibre DOM)           ──▶  UiIconRegistry.createElement(document, key)
                                                          │
                                        layers, most specific first
                                        ├─ override   provideUiIcons({...})      (tests · subtrees · white-label)
                                        ├─ remote     signal<UiIconManifest|null>  ◀── UI_ICON_MANIFEST_SOURCE
                                        └─ bundled    UI_BUNDLED_ICON_MANIFEST       │  cached() · changes · remember()
                                                          │                          │
                                        alias? hop (≤8, cycle-checked, restart at top)   NOT PROVIDED TODAY (owner ruling):
                                                          │                          │   a redeploy is a minute on Hosting.
                                        UiIconAsset ──▶ material ──▶ MATERIAL_GLYPHS │   When ever needed: provideUiIconManifest
                                                    └─▶ vector ────────────┐         └── in app.config.ts over a settings
                                                          ▼                │             document (§6) — no consumer changes.
                                        <svg viewBox fill=currentColor><path d/></svg>
                                                          │
                                        failure ──▶ UI_ICON_REPORTER (once per key) + data-missing on the host
```

### 2.2 Resolution, step by step

1. `UiIcon` reads `uiName()` and its nearest `UI_ICON_OVERRIDES` (multi-provider, optional).
2. `UiIconRegistry.resolve` builds the layer list: override layers (later providers first) → remote manifest (if adopted) → bundled.
3. `resolveIconEntry` walks: first layer with an entry for the key wins; an `alias` re-enters the walk at the **top** layer for the target (so an override of the target is honoured through a bundled alias); a visited set catches cycles, `UI_ICON_ALIAS_DEPTH = 8` bounds chains.
4. The winning asset becomes a `UiVectorAsset`: `material` through the generated table (`null` if the glyph is not there → `glyph-missing`), `vector` as is.
5. `UiIcon` renders the paths inside a `1em` `<svg fill="currentColor">`; `data-name` stamps the _requested_ key; `data-scale` the ladder step; `aria-hidden` unless `uiLabel` makes it `role="img"`.
6. On failure: `null` → empty em box + `data-missing` (`loud` in dev → dashed outline), one diagnostic through `UI_ICON_REPORTER` (console `error` in dev, `warn` in prod; the token is the seam for a real reporter).

Every read in steps 1–4 is a signal or a pure function of signals, so adopting a remote manifest recomputes exactly the icons whose answer changed — zoneless needs nothing else.

### 2.3 Key decisions

| Decision                                                       | Requirement it serves                                | Why this and not the obvious alternative                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One library `libs/ui/icons`, below `controls` and `patterns`   | testability; enforcement allow-list; the rating star | `ui-rating` (patterns) must compose `ui-icon`, and `controls` re-exports `patterns` — the registry had to sit under both. The project path is also the crispest allow-list a lint rule can name.                                                                                           |
| Path data, generated from a **pinned commit**                  | no flash, minimal bundle, security                   | See §1.2. The repo removed its token build pipeline in July because generated output drifted with no consumer; here the table has 259 consumers, `icon-vocabulary.spec.ts` fails on drift, and the generator refuses names the revision lacks — the failure the old font could not report. |
| Keep the dotted key grammar, add typed aliases                 | typed keys; aliasing with safe chains                | The bundled alias table is `satisfies Record<string, keyof typeof UI_ICON_REGISTRY>`: a chain is a type error at authoring time; only a remote manifest can build one, and the resolver bounds those.                                                                                      |
| One manifest for icons **and** the logo                        | logo through the same mechanism                      | They are one theme and change together; one document, one version, one validation, one cache entry. Separate logo variants (`light`/`dark`) live inside it.                                                                                                                                |
| Remote is a **patch**, validated per entry — and **not wired** | backend-override _readiness_; resilience; versioning | The seam ships tested; the backend does not. An admin typo would drop one entry, not the theme; an unsupported `schemaVersion` rejects the document and keeps the last good one; unknown keys are skipped, unknown fields ignored. Wiring it later changes no consumer (§6).               |
| DI overrides beat the remote manifest                          | testability; escape hatch                            | Overrides are code someone wrote for a scope; the backend should not be able to un-pin a deliberate override. Documented, and in practice there are none in app code.                                                                                                                      |
| The source is `Observable<Result<unknown, Error>>`             | backend abstraction; resilience                      | `Result` keeps a failed read as a _value_ so the retrying subscription continues; `unknown` keeps the schema in the design system, where the validator is.                                                                                                                                 |
| `image` logos through `<img>`, origin allow-listed             | security for the one arbitrary asset                 | The platform disables scripting for SVG-as-image; the validator refuses `javascript:`, `data:`, protocol-relative and non-allow-listed hosts.                                                                                                                                              |

### 2.4 Rejected alternatives

- **`@angular/material` for `mat-icon`** — one dependency for one component, async per-icon SVG fetches, an untyped string API, and a `DomSanitizer` "trust" step the design avoids by construction.
- **Keeping the font and subsetting it** — needs either Google's origin (`icon_names`) or a font toolchain, and still fails silently on an unknown name.
- **`@material-symbols/svg-400`** — opsz 48 only; visibly lighter than the pinned opsz 24.
- **Per-icon SVG assets fetched at runtime** (mat-icon's model, `flag-icons` precedent in this repo) — correct for thousands of rarely used icons; for 88 icons on every screen it trades a synchronous first paint for a first-visit blank per icon.
- **Accepting SVG markup + DOMPurify** — correct when markup is required; unnecessary when the asset language cannot express anything executable.
- **Any live backend layer today** — owner ruling: a web app on Firebase Hosting redeploys in a minute; the remote layer's costs (document, rules, cache, listener, admin UI) buy nothing until there is someone who must change icons without a deploy. The seam stays so that decision is reversible in one file.
- **Firebase Remote Config** (if a backend is ever wired) — no emulator, a second SDK, and the shop's admin surface is Firestore-backed already.
- **snake_case keys** — would churn 259 call sites and the `data-name` CSS for no gain over the established grammar.
- **Nx workspace rules** — flat-config loader issues and a reserved folder name; plain ESM is simpler and testable.

---

## 3 · Naming convention and the typed key model

**Grammar** (`UI_ICON_KEY_PATTERN`): `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$` — `domain.action` or `domain.action.qualifier`, camelCase segments. Examples in the vocabulary: `sheet.close`, `party.addGuest`, `visit.noShow`, `service.variant.length`, `calendar.viewThreeDay`, `prefs.theme.dark`. The brief's examples map 1:1 (`appointment_no_show` → `visit.noShow`, `add_guest` → `party.addGuest`, `close_sheet` → `sheet.close`).

**Why dotted, camelCase:** it is what 259 call sites, `[data-name='field.expand']` CSS, and three dated owner rulings use; a dot never appears in a Material glyph name, so a raw glyph and a key are distinguishable by shape alone (the lint rules and the sweep rely on this).

**Governance** (the comments in `icon-vocabulary.ts` are the record):

- New intent → new key, even when the artwork already exists. Two keys sharing a glyph are free to diverge.
- An alias says "this intent **is** an instance of that one" (`gallery.grid → layout.grid`). Also the rename tool: alias old → new for one release, migrate, delete.
- Brand marks Material lacks are `vector` entries (`social.instagram`), the same shape a remote override uses.
- Every Material name must exist at the pinned revision (`pnpm icons:glyphs` refuses otherwise; the spec refuses a stale table).

**Types:**

```ts
export const UI_ICON_REGISTRY = {
  'sheet.close': 'close' /* … */,
} as const satisfies Record<string, string>;
export const UI_ICON_VECTORS = {
  'social.instagram': { kind: 'vector' /* … */ },
} as const satisfies Record<string, UiVectorAsset>;
export const UI_ICON_ALIASES = {
  'gallery.grid': 'layout.grid',
} as const satisfies Record<string, keyof typeof UI_ICON_REGISTRY>;

export type UiIconName =
  | keyof typeof UI_ICON_REGISTRY
  | keyof typeof UI_ICON_VECTORS
  | keyof typeof UI_ICON_ALIASES;
export function isUiIconName(value: unknown): value is UiIconName; // the sanctioned narrowing
```

`uiName`, `uiIcon` (avatar, search field), `ChoiceMenuOption.icon`, `Segment.icon`, and every view-model field take `UiIconName`. `as UiIconName` is a lint error outside the library; the one that existed (service variants) became an exhaustive `Record<ServiceVariantVm['icon'], UiIconName>`.

---

## 4 · Manifest schema

```ts
interface UiIconManifest {
  schemaVersion: 1;                                   // bumped only for incompatible shape changes
  icons: Record<string, UiIconEntry>;                 // key → entry; a remote document is a PATCH
  logo?: UiLogoEntry;
}
type UiIconEntry = { kind: 'material'; glyph: string }          // Material Symbols Rounded · FILL 1 · wght 400 · opsz 24
                 | { kind: 'vector'; viewBox: string; paths: UiVectorPath[] }
                 | { alias: string };
interface UiVectorPath { d: string; fill?: 'currentColor'|'none'; stroke?: 'currentColor'|'none';
                         strokeWidth?: number; strokeLinecap?: 'butt'|'round'|'square'; strokeLinejoin?: 'miter'|'round'|'bevel'; }
interface UiLogoEntry { light: UiLogoAsset; dark?: UiLogoAsset }   // dark falls back to light
type UiLogoAsset = { kind: 'vector'; … } | { kind: 'image'; href: string; width: number; height: number };
```

A bare string is accepted as shorthand for `{ kind: 'material', glyph }` (bundled and remote alike; normalized once).

**Sample remote document** (the shape the seam accepts; nothing provides one today):

```json
{
  "schemaVersion": 1,
  "icons": {
    "sheet.close": "cancel",
    "visit.noShow": { "kind": "material", "glyph": "person_off" },
    "party.removeGuest": { "alias": "sheet.close" },
    "booking.removeLine": { "alias": "party.removeGuest" },
    "social.instagram": {
      "kind": "vector",
      "viewBox": "0 0 24 24",
      "paths": [
        {
          "d": "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z",
          "fill": "none",
          "stroke": "currentColor",
          "strokeWidth": 2,
          "strokeLinecap": "round",
          "strokeLinejoin": "round"
        },
        {
          "d": "M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0z",
          "fill": "none",
          "stroke": "currentColor",
          "strokeWidth": 2
        },
        { "d": "M18 6.5a.5.5 0 1 1-1 0a.5.5 0 1 1 1 0z" }
      ]
    }
  },
  "logo": {
    "light": {
      "kind": "vector",
      "viewBox": "0 0 1920 419.82",
      "paths": [{ "d": "M1715.83,69.24c-77.57,0-140.67,63.11…" }]
    },
    "dark": {
      "kind": "image",
      "href": "https://firebasestorage.googleapis.com/v0/b/<bucket>/o/brand%2Flogo-dark.png?alt=media",
      "width": 1920,
      "height": 420
    }
  }
}
```

The chain `booking.removeLine → party.removeGuest → sheet.close → cancel` is legal from the backend (two hops), resolved against the top layer at each hop, and would be refused only if it looped or exceeded eight hops.

**Validation outcomes** (`parseUiIconManifest`): absent → bundled (no error) · unsupported version → whole document rejected, current kept · unknown key → skipped with issue · bad entry → dropped with issue, others kept · Material glyph not in the table → dropped ("send the path data instead") · `d` outside the path grammar / `fill: url(#x)` / `href` off-origin → dropped · unknown fields → ignored. Property-tested: arbitrary JSON never throws; anything `isSafePathData` accepts contains none of `< > " ' ( ) & ; : = { } \`.

---

## 5 · Core implementation

All in `libs/ui/icons/src/lib/` (Angular 22, strict, signals; specs beside each file):

| File                                    | Role                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest/icon-manifest.ts`             | Types, `normalizeIconEntry`, `parseUiIconManifest`, `mergeUiIconManifests`, `isSafePathData`, `isAllowedImageHref`. Pure TS.                                                                                                                                                                                                                 |
| `manifest/icon-vocabulary.ts`           | `UI_ICON_REGISTRY` (with the governance comments), `UI_ICON_VECTORS`, `UI_ICON_ALIASES`, `UI_LOGO`, `UiIconName`, `UI_ICON_KEY_PATTERN`, `UI_BUNDLED_ICON_MANIFEST`, `UI_ICON_NAMES`. Pure TS — the tools import it.                                                                                                                         |
| `material/material-glyphs.generated.ts` | 88 glyphs · 34,492 bytes of path data · provenance constant (`repository`, `commit`, style, axes). **Generated, do not edit.**                                                                                                                                                                                                               |
| `material/material.ts`                  | The Material provider: `MATERIAL_VIEW_BOX`, `hasMaterialGlyph`, `materialGlyph(name) → UiVectorAsset`. The extension seam: a second provider is one more `kind`, one more table, one more `case`.                                                                                                                                            |
| `registry/icon-resolver.ts`             | `resolveIconEntry(layers, key, toVector)` — pure, table-tested: precedence, alias hops, cycle, dangling, depth, glyph-missing.                                                                                                                                                                                                               |
| `registry/icon-registry.service.ts`     | `UiIconRegistry` (root): `manifest`, `origin` signals; `resolve`, `resolution`, `logo`, `createElement`; the adopt/validate/remember loop. Tokens: `UI_ICON_OVERRIDES` + `provideUiIcons`, `UI_ICON_MANIFEST_SOURCE` + `provideUiIconManifest`, `UI_ICON_REPORTER` + `consoleUiIconReporter`. `renderVectorAsset` builds imperative `<svg>`. |
| `icon/icon.ts` · `icon.css`             | `ui-icon`: `uiName` (required, `UiIconName`), `uiScale`, `uiLabel`; host stamps `data-name`, `data-scale`, `data-missing`, ARIA; template is one `<svg>` with `@for` paths. The ladder (`--ui-icon-small/medium/large`) and the `field.expand` rotation rule are unchanged.                                                                  |
| `logo/logo.ts` · `logo.css`             | `ui-logo`: `uiLabel`, `uiScheme`; draws one mark when light and dark are the same asset, both otherwise, and CSS shows the one `<html data-theme>` asks for (no JS theme listener, so the pre-paint script's choice holds from the first frame).                                                                                             |

The component in full, because it is the whole consumer surface:

```ts
@Component({
  selector: 'ui-icon',
  template: `@if (asset(); as glyph) {
    <svg
      class="ui-icon__glyph"
      [attr.viewBox]="glyph.viewBox"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      @for (path of glyph.paths; track $index) {
        <svg:path
          [attr.d]="path.d"
          [attr.fill]="path.fill ?? null"
          [attr.stroke]="path.stroke ?? null"
          [attr.stroke-width]="path.strokeWidth ?? null"
          [attr.stroke-linecap]="path.strokeLinecap ?? null"
          [attr.stroke-linejoin]="path.strokeLinejoin ?? null"
        />
      }
    </svg>
  }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './icon.css',
  host: {
    class: 'ui-icon',
    '[attr.aria-hidden]': 'uiLabel() ? null : "true"',
    '[attr.role]': 'uiLabel() ? "img" : null',
    '[attr.aria-label]': 'uiLabel() || null',
    '[attr.data-scale]': 'uiScale()',
    '[attr.data-name]': 'uiName()',
    '[attr.data-missing]': 'asset() ? null : missingMark',
  },
})
export class UiIcon {
  readonly uiName = input.required<UiIconName>();
  readonly uiScale = input<UiIconScale | null>(null);
  readonly uiLabel = input<string | null>(null);
  private readonly registry = inject(UiIconRegistry);
  private readonly overrides = inject(UI_ICON_OVERRIDES, { optional: true });
  protected readonly missingMark = isDevMode() ? 'loud' : '';
  protected readonly asset = computed(() =>
    this.registry.resolve(this.uiName(), this.overrides),
  );
}
```

---

## 6 · Backend-override layer — the seam (shipped) and the wiring (deliberately not)

**What ships.** `UiIconManifestSource` and `provideUiIconManifest` in `libs/ui/icons`, plus everything that makes a remote document safe to adopt: `parseUiIconManifest` (§4), per-entry fallback, last-known-good semantics, `source-failed` diagnostics, and the `allowedImageOrigins` allow-list. All of it is unit-tested against a fake source (`icon-registry.service.spec.ts`, `logo.spec.ts`). No provider for the token exists in `apps/web`, so the registry serves the bundled manifest and the code path costs nothing at runtime.

**Why not wired.** Owner ruling, 2026-09-24: "change icons without an app update" protects native apps from store review and slow adoption; this is a web app on Firebase Hosting, where a redeploy takes about a minute and every user gets it on the next load. A live layer would add a Firestore document and rules, an admin surface, a cache and a listener — and a second source of truth for the theme — for no gain today. The requirement in the brief was _readiness_; readiness is a tested seam and a documented recipe.

**The recipe, when ever it is needed** (one file, no consumer changes). Port in `application/shared` (`BrandingReader.observe(): Observable<Result<Record<string, unknown> | null, RepositoryError>>`), a `FirestoreBrandingReader` mirroring `FirestoreBookingPolicyReader` (`onSnapshot` on `settings/branding` through `subscribeWithRetry`; the existing `settings/{docId}` rule already grants public read / admin write), and in `app.config.ts`:

```ts
{ provide: BRANDING_READER, useClass: FirestoreBrandingReader },
provideUiIconManifest(() => {
  const reader = inject(BRANDING_READER);
  const store = inject(KEY_VALUE_STORE);                       // localStorage adapter, already wired
  return {
    cached: () => { const raw = store.get('ui-icon-manifest'); return raw.isSuccess() && raw.value ? JSON.parse(raw.value) : null; },
    changes: reader.observe(),
    remember: (m) => (m ? store.set('ui-icon-manifest', JSON.stringify(m)) : store.remove('ui-icon-manifest')),
    allowedImageOrigins: ['https://firebasestorage.googleapis.com'],
  };
}),
```

**Sequence it would give:** registry constructed by the environment initializer → `cached()` adopted synchronously → first paint → the document answers (from the SDK's persistent cache when offline or warm) → validated → adopted and remembered → later admin edits push through the same path; a failed read is one diagnostic and no change on screen; a deleted document returns to bundled.

**Versioning holds either way:** `schemaVersion` is a major only. Additive changes (a new asset kind, a new logo variant) do not bump it — old clients ignore unknown kinds per entry and unknown fields everywhere. A breaking change bumps it; old clients reject the document and keep their last good one until they update.

---

## 7 · Enforcement configuration

Root `eslint.config.mjs` (excerpt — the real file carries the comments):

```js
import templateParser from '@angular-eslint/template-parser';
import creativo, { ICON_SYNTAX_RESTRICTIONS } from './tools/lint-rules/index.mjs';
// …
{ files: ['**/*.ts'],      rules: { 'no-restricted-syntax': ['error', ...ICON_SYNTAX_RESTRICTIONS] } },
{ files: ['**/*.spec.ts'], rules: { 'no-restricted-syntax': ['error', ...ICON_SYNTAX_RESTRICTIONS.filter(r => !r.selector.includes('UiIconName'))] } },
{ files: ['**/*.html'], plugins: { creativo }, languageOptions: { parser: templateParser }, rules: { 'creativo/icon-registry-only': 'error' } },
```

`tools/lint-rules/icon-syntax.mjs` — the selectors: `ImportDeclaration|ImportExpression[source.value=/^(material-symbols|@material-symbols\/|@angular\/material)/]`, `TSAsExpression|TSTypeAssertion > TSTypeReference > Identifier[name='UiIconName']`, `Literal[value=/material[-_ ]?(symbols|icons)/i]`, `TemplateElement[value.raw=/…/i]`.

`tools/lint-rules/icon-registry-only.mjs` — the template rule: `Element[name="mat-icon"]`; `class` attributes and `[class.…]`/`[ngClass]` bindings naming `material-symbols*`/`material-icons*`; `uiName` on `ui-icon` and `uiIcon` anywhere whose static value or any _evaluable_ literal (`cond ? 'a.b' : 'c.d'`, `x ?? 'a.b'`; comparison operands excluded) fails the key grammar; `<img src>` naming a logo file.

**Allow-list:** `libs/ui/icons/eslint.config.mjs` turns both off. Nothing else does. The `material-symbols` package is removed from `package.json`, so the old import cannot resolve at all.

**stylelint** (`.stylelintrc.json`): `font-family: /Material\s?(Symbols|Icons)/i` disallowed at root _and_ inside the `--sys-*` override (which otherwise nulls the rule); `selector-disallowed-list: [/material-(symbols|icons)/i, /(^|[\s>+~])mat-icon\b/]`.

**CI** (`.github/workflows/ci.yml`): after `nx affected -t lint test build`, `pnpm icons:check` (repo-wide sweep, independent of the affected graph) and `node tools/icons/build-material-glyphs.mjs --check` (table covers the vocabulary, offline).

---

## 8 · Migration plan

**Principle:** the app works at every step; each step is one commit that lint, typecheck, tests and the build accept.

| Step | What                                                                                                                                                                                                                                                                                                                      | How it stayed safe                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create `libs/ui/icons`; `git mv` the registry, component, CSS, spec; split the vocabulary into an Angular-free module; add the manifest, validator, resolver, service; `controls` re-exports the lib.                                                                                                                     | 259 call sites import `UiIcon`/`UiIconName` from `@creativo/ui/controls` and keep compiling. `pnpm nx sync` fixed project references.                                                   |
| 2    | Generate the glyph table from the pinned commit.                                                                                                                                                                                                                                                                          | The generator refused `collections` → `media.gallery` became `photo_album` (a latent defect: the name never existed in the font either).                                                |
| 3    | Swap the renderer (font span → inline SVG); drop the vendor `@import`; move the ladder rules into the layer; delete `material-symbols`.                                                                                                                                                                                   | Same inputs, same host attributes, same ladder; the two specs that read ligature text now read `data-name` / `svg path`. The showcase, which never imported the font, gains real icons. |
| 4    | Migrate the bypasses: `ui-rating`'s raw `star` → `rating.star`; `svg[crIconInstagram]` → `social.instagram` (vector entry); map pins (DS map and landing) → `createElement`; the `as UiIconName` cast → typed map; `<img src="/logo-*.svg">` → `<ui-logo>` coloured by CSS (`data-view`), `logo-black/white.svg` deleted. | Each is a local edit with its own spec update; `pnpm icons:check` confirmed zero bypasses and 257 static usages.                                                                        |
| 5    | Backend seam only: `UiIconManifestSource` + `provideUiIconManifest`, tested against a fake source. A Firestore port/adapter/seed/rules test were built and then **removed on the owner's ruling** (§6).                                                                                                                   | No provider → bundled; nothing to seed, nothing to keep alive.                                                                                                                          |
| 6    | Enforcement: local plugin, root config, stylelint, CI step.                                                                                                                                                                                                                                                               | The rules ran against the whole affected graph (55 projects) with zero new errors.                                                                                                      |

**Inventory & codemod tooling (`tools/icons/check-icon-usage.mjs`)** — for this repo and for any icon-font codebase:

```bash
pnpm icons:check             # verify: exit 1 on any bypass or unknown key
pnpm icons:check --report    # + markdown table of static usages per key, and the keys with none
pnpm icons:check --propose   # scan raw <span class="material-symbols-…">glyph</span> / <mat-icon> usages,
                             #   write tmp/icon-key-proposals.json: { "person_add": "booking.personAdd", … }
pnpm icons:check --fix --map tmp/icon-key-proposals.json   # rewrite to <ui-icon uiName="…" />; unmapped glyphs are reported, untouched
pnpm icons:check             # verify again — the loop's exit condition
```

Proposals are `<slice>.<glyphCamelCase>` from the file path (a human renames them to intents before adding to `UI_ICON_REGISTRY`; `pnpm icons:glyphs` then fetches the artwork). Tested on fixtures (`tools/icons/__fixtures__`): clean and dirty trees, every bypass code, the rewrite, the proposal grammar.

**Inventory of this repo after migration:** 262 static usages across 131 keys; 30 keys have no _static_ usage (they are bound from view models — `visit.*` status marks, `calendar.view*`, `service.variant.*` — or reserved: `media.play`); 0 bypasses.

**Second audit (same day), beyond what the sweep's patterns see** — templates, inline templates, CSS (`content`, `mask-image`, `background-image`), `<img>` sources, Unicode symbol and emoji characters, single-character glyph elements, and the i18n copy. Found and migrated: the legacy `cr-theme-toggle`'s 🌙/☀️ (→ `prefs.theme.*`; the component is unused — a deletion candidate), the toast's hand-drawn ✕ (→ `toast.dismiss`, a new intent), the showcase's typographic `←`/`→` affordances (→ `nav.back`/`nav.explore`). Confirmed not icons and left as they are: the hamburger morph, the reward moment's draw-on check, the toast and progress rings, country flags, textures and masks, PWA rasters, and typographic characters in prose (the copy has zero symbol characters). The lint rule and the sweep now flag any hand-drawn `<svg>` outside a three-file allow-list (`allowInlineSvg`), so the exceptions are enforced, not remembered — see the README's exception table.

---

## 9 · Test strategy

| Layer                    | Where                                                                                                                                                                                                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validator                | `icon-manifest.spec.ts` (14)                                                                                                                                                                               | realistic document; absent; unsupported version; per-entry drop; unknown key skipped; unknown fields ignored; malicious `d`, `fill: url()`, `javascript:`/`data:`/protocol-relative/off-origin hrefs; **fast-check**: arbitrary JSON never throws, accepted path data has no dangerous characters.                                                                                                                                  |
| Resolver                 | `icon-resolver.spec.ts` (7)                                                                                                                                                                                | precedence; alias walk; hop restarts at the top; remote-built chains; cycle, dangling, depth; missing key vs missing glyph.                                                                                                                                                                                                                                                                                                         |
| Vocabulary               | `icon-vocabulary.spec.ts` (6)                                                                                                                                                                              | key grammar; plain glyph names; **every Material glyph in the generated table and no orphan in it**; alias targets concrete; no key in two tables; the bundled manifest passes the remote validator.                                                                                                                                                                                                                                |
| Registry                 | `icon-registry.service.spec.ts` (11)                                                                                                                                                                       | no source → bundled; cached applied synchronously; live adopt + remember; rejected keeps current + reports; `Result.fail` reported; withdraw → bundled; partial adopt; overrides beat remote; report-once; remote logo; imperative DOM.                                                                                                                                                                                             |
| Components               | `icon.spec.ts` (11), `logo.spec.ts` (4)                                                                                                                                                                    | SVG from the table, no text; name changes; `data-name`; decorative vs labelled; ladder; vector entry attributes; alias renders target and keeps its own `data-name`; missing → box + flag + one report; DI overrides incl. raw vector. Logo: one mark, eight paths, `role="img"`; decorative; two cuts for two assets; forced scheme.                                                                                               |
| **The rules themselves** | `tools/lint-rules/icon-registry-only.spec.mjs` (21) with ESLint's `RuleTester` + `@angular-eslint/template-parser`; `icon-syntax.spec.mjs` (4) runs `ESLint.lintText` with exactly the exported selectors. | valid: keys, conditionals, `row.icon`, `ui-avatar [uiName]` (a person, never a key), `ui-logo`, comparison operands; invalid: `<mat-icon>`, ligature classes (static, `[class.x]`, `[ngClass]`), raw keys (static, literal, conditional branch, `uiIcon`), `<img>` logos (static and both branches). Syntax: imports (static, dynamic, side-effect), casts (`as`, `<T>`), literals, template literals; registry-shaped code passes. |
| The sweep                | `tools/icons/check-icon-usage.spec.mjs` (5)                                                                                                                                                                | clean/dirty fixtures, every bypass code with file:line, boundary exemption, proposals, rewrite + unmapped.                                                                                                                                                                                                                                                                                                                          |
| Consumers                | rating, header, locations specs updated; visit-editor helper comment updated.                                                                                                                              | The header no longer asserts a file name; it asserts the mark and `data-view`.                                                                                                                                                                                                                                                                                                                                                      |
| CI                       | `nx affected -t lint test build` + `pnpm icons:check` + `--check`                                                                                                                                          | Lint rules per project; sweep repo-wide.                                                                                                                                                                                                                                                                                                                                                                                            |

Not automated: the Playwright visual snapshots (`apps/web/e2e/*-snapshots`) are not run in CI and **will differ** (vector glyphs vs font hinting) — re-baseline them on the next e2e pass.

---

## 10 · Risks and open questions (ranked by impact)

1. **If a backend layer is ever wired, a remote manifest is trusted admin input, validated for safety, not for taste.** An admin could map `visit.noShow` to a smiley. Mitigations then: an admin editor that previews and restricts to a curated palette; a rules-level `schemaVersion == 1` check. Today: moot — nothing provides the source, by ruling.
2. **The generated table must be regenerated when the vocabulary changes** (network at generation time). `icon-vocabulary.spec.ts` and the CI `--check` make a stale table a red build, never a silent regression; but a contributor without network cannot add a Material key. Acceptable; documented in the README.
3. **Icon set drift on pin bumps.** Moving `MATERIAL_DESIGN_ICONS_COMMIT` can redraw glyphs (Google revises artwork). Treat a bump as a design review with the showcase page open. Pinning is what makes this a decision rather than a surprise.
4. **`image` logos and CSP.** `img-src` must allow the Storage origin when a raster logo ships (`docs/security/csp-baseline.md` already anticipates it). Vector logos need nothing.
5. **Imperative DOM is a snapshot.** Map pins built by `createElement` do not redraw if a manifest changes later. Irrelevant while no remote source exists; a `computed`-driven rebuild is a small follow-up if one is ever wired.
6. **`nx typecheck` is not in CI** (`lint test build` is), so spec-only type errors accumulate unseen: four such failures (`slider.spec.ts`, `appointment-photos.adapter.spec.ts`, `booking-flow.store.spec.ts`, `staff-dashboard.spec.ts`) predated this pass and were fixed alongside it. Open: add `typecheck` to the CI target list so the next one is caught when it is written.
7. **Bundle budget.** `main.js` is 1.49 MB (1.59 MB initial, already over the 1 MB warning before this pass); the glyph table adds ~11 KB gzip. The removed font was 5.1 MB of first-visit transfer. Net win; the budget warning is not this pass's to fix.
8. **`opsz` fidelity at 16 px.** The font rendered `opsz 24` at every size too, so nothing changed — but if the ladder ever wanted a true 20-opsz cut for `small`, the generator would need a second variant column.
9. **Open: aliases in the bundled table are deliberately rare** (one). The vocabulary's culture is "duplicate the glyph, keep the intents free"; aliases are for renames and remote theming. Revisit if the owner wants `gallery.*` and `layout.*` unified further.
10. **Open: the SF-Symbols-style `hierarchical`/`palette` rendering** (multi-layer fills) is expressible in the vector shape (per-path `fill`) but no key uses it. Not built.
11. **Open: the favicon and PWA icons are rasters in `public/`, not derived from the registry's logo.** A logo change means regenerating them by hand. Low impact (the brand mark rarely changes); a small script from `UI_LOGO` to PNG would close it.

---

### Appendix — sources

- Angular releases: https://angular.dev/reference/releases
- Angular Material icon overview: https://github.com/angular/components/blob/main/src/material/icon/icon.md
- Material Symbols guide (axes, subsetting, `display=block`): https://developers.google.com/fonts/docs/material_symbols
- `material-symbols` / `@material-symbols/svg-*` packages: https://github.com/marella/material-symbols
- Pinned artwork source: https://github.com/google/material-design-icons (commit `27e9ef1dbeedc13d682fece4a58e1eda4cb0961a`, `symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`)
- SF Symbols: https://developer.apple.com/sf-symbols/ (the HIG page could not be fetched; claims limited to this page)
- Carbon icons guide: https://github.com/carbon-design-system/carbon/blob/main/docs/guides/icons.md
- Polaris icon rename: https://github.com/Shopify/polaris-react/issues/11088 · https://polaris-react.shopify.com/version-guides/migrating-from-v11-to-v12
- Atlassian icon system: https://atlassian.design/whats-new/building-atlassians-new-icon-system/
- Firebase Remote Config quotas: https://firebase.google.com/docs/remote-config/quotas-limits · real-time: https://firebase.google.com/docs/remote-config/web/real-time · Emulator Suite: https://firebase.google.com/docs/emulator-suite/install_and_configure
- Firestore offline persistence: https://firebase.google.com/docs/firestore/manage-data/enable-offline
- DOMPurify: https://github.com/cure53/DOMPurify
- SVG as an image (MDN): https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
- ESLint `no-restricted-imports`: https://eslint.org/docs/latest/rules/no-restricted-imports · selectors: https://eslint.org/docs/latest/extend/selectors
- angular-eslint custom rules: https://github.com/angular-eslint/angular-eslint/blob/main/docs/WRITING_CUSTOM_RULES.md
- Nx workspace rules and flat config: https://github.com/nrwl/nx/issues/19754 · https://nx.dev/docs/technologies/eslint/generators
- Client config patterns: https://launchdarkly.com/docs/sdk/features/bootstrapping · https://docs.getunleash.io/guides/feature-flag-best-practices
- Icon fonts vs SVG (secondary): https://www.keycdn.com/blog/icon-fonts-vs-svgs
