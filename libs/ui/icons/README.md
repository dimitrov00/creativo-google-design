# `@creativo/ui/icons` — the icon and logo registry

`ui-icon`, `ui-logo`, `UiIconRegistry`, the vocabulary, the manifest, and the
Material Symbols provider. This library is **the registry's boundary**: it is
the only project where glyph names and artwork are legitimate. Everything
outside it names icons by intent.

```html
<ui-icon uiName="sheet.close" />
<!-- ✓ intent -->
<ui-icon uiName="close" />
<!-- ✗ compile error AND lint error: raw glyph -->
<ui-logo uiLabel="Creativo" />
<!-- ✓ the brand mark, through the same registry -->
```

Design record: [docs/design-research/icon-registry-design.md](../../../docs/design-research/icon-registry-design.md).

## How a key becomes artwork

```
uiName ─▶ UiIconRegistry.resolve
            │  layers, most specific first
            ├─ DI overrides      provideUiIcons({...})      (tests, subtrees, white-label)
            ├─ remote manifest   (only if an app provides a source — none does today)
            └─ bundled           icon-vocabulary.ts         (UI_ICON_REGISTRY · VECTORS · ALIASES · LOGO)
            │  alias? → hop (≤ 8, cycle-checked, restarts at the top layer)
            ▼
        UiIconAsset ─▶ { kind: 'material', glyph } ─▶ material-glyphs.generated.ts ─▶ path data
                    └▶ { kind: 'vector', viewBox, paths }  ──────────────────────────▶ path data
            ▼
        <svg viewBox fill="currentColor"><path d/></svg>   (1em box, synchronous, no font)
```

An unresolvable key never throws: the component keeps its em box, stamps
`data-missing` (dashed outline in development) and the failure is reported
once through `UI_ICON_REPORTER` (console by default; plug an error reporter
in production).

## The vocabulary

Keys are `domain.action` or `domain.action.qualifier`, camelCase segments
(`UI_ICON_KEY_PATTERN`). Dots mark semantic keys; a raw glyph name never
contains one, which is what lets the lint rules and the runtime tell the two
apart without a lookup.

Rules (see the comments in `icon-vocabulary.ts`, which are the governance
record):

- **New intent → new key**, even when the artwork already appears in the
  table. Two keys sharing a glyph are FREE to diverge; that freedom is the
  whole point of the indirection.
- **An alias says "this intent IS an instance of that one"** and should
  follow it wherever it goes (`gallery.grid → layout.grid`). Also the tool
  for renames: alias the old key to the new one for a release, migrate call
  sites, delete the alias. The bundled alias table is typed against concrete
  keys, so it can never hold a chain; only a remote manifest can, and the
  resolver bounds and cycle-checks those.
- **`UiIconName = keyof REGISTRY | keyof VECTORS | keyof ALIASES`** — a closed
  union. Typos fail template type-checking. `as UiIconName` is a lint error
  everywhere outside this library; narrow with `isUiIconName()` instead.
- **Every Material glyph name must exist at the pinned revision.** Run
  `pnpm icons:glyphs` after editing `UI_ICON_REGISTRY`; the generator refuses
  a name Google's repository does not carry, and `icon-vocabulary.spec.ts`
  refuses a stale table. (The old ligature font rendered an unknown name as
  the WORD in capitals — `media.gallery` shipped that way.)
- **Brand marks Material does not carry are vector entries**
  (`social.instagram`): the same inert path-data shape a remote override
  uses.

## The manifest

One document, `schemaVersion: 1`, icons and the logo together — they are one
theme and change together. Today the only manifest is the bundled one; the
shape is what a backend override would have to speak:

```json
{
  "schemaVersion": 1,
  "icons": {
    "sheet.close": "cancel",
    "visit.noShow": { "kind": "material", "glyph": "person_off" },
    "party.removeGuest": { "alias": "sheet.close" },
    "social.instagram": {
      "kind": "vector",
      "viewBox": "0 0 24 24",
      "paths": [
        {
          "d": "M7 2h10a5 5 0 0 1 5 5v10…",
          "fill": "none",
          "stroke": "currentColor",
          "strokeWidth": 2
        }
      ]
    }
  },
  "logo": {
    "light": {
      "kind": "vector",
      "viewBox": "0 0 1920 419.82",
      "paths": [{ "d": "M1715.83,69.24c…" }]
    },
    "dark": {
      "kind": "image",
      "href": "https://firebasestorage.googleapis.com/…/logo-dark.png",
      "width": 1920,
      "height": 420
    }
  }
}
```

`parseUiIconManifest` (`icon-manifest.ts`) is the only way in:

| Input                               | Outcome                                        |
| ----------------------------------- | ---------------------------------------------- |
| `null` / no document                | bundled defaults (not an error)                |
| unsupported `schemaVersion`         | whole document rejected, current manifest kept |
| entry with an unknown key           | skipped with an issue (forward compatibility)  |
| entry that fails validation         | dropped with an issue; every other entry kept  |
| Material glyph not in the table     | dropped — send the path data instead           |
| vector `d` outside the path grammar | dropped                                        |
| image `href` off-origin / non-https | dropped                                        |
| unknown fields anywhere             | ignored                                        |

**Why data, never markup.** A remote SVG would need a sanitizer (DOMPurify's
SVG profile is the standard answer). Path data cannot express a script, a
URL, a stylesheet or an event handler, so the manifest carries `d` strings
and a closed set of presentation attributes, and the renderer builds the
`<svg>` itself. The one arbitrary asset — an `image` logo — goes through
`<img>`, where the platform disables scripting for SVG, from same-origin
paths or allow-listed https origins only.

## The remote source — a seam, not a backend

The registry knows nothing about Firestore. An app MAY supply a
`UiIconManifestSource` through `provideUiIconManifest(() => ({ cached,
changes, remember, allowedImageOrigins }))`:

- `cached()` — read once, synchronously, at startup: the last manifest that
  passed validation, so the first paint already wears it;
- `changes` — `Observable<Result<unknown, Error>>`; failures are reported and
  ignored, values validated and, if adopted, `remember`ed;
- `null` from the backend returns to the bundled defaults and forgets the cache.

**`apps/web` provides none** (owner ruling, 2026-09-24): on Firebase Hosting a
redeploy is a minute and reaches every user on their next load, so a live
override layer would only add a document, a cache and a listener to
maintain. The seam exists so that decision is reversible in one file — the
recipe (a `settings/branding` reader over `KEY_VALUE_STORE`) is in
[the design record §6](../../../docs/design-research/icon-registry-design.md).

## Sizing — the fixed ladder

Unchanged from the font era, now applied to a `1em` `<svg>`:

| `uiScale`  | Custom property    | Size                              |
| ---------- | ------------------ | --------------------------------- |
| absent     | —                  | 1em, rides the font (inline text) |
| `'small'`  | `--ui-icon-small`  | 1rem — 16px                       |
| `'medium'` | `--ui-icon-medium` | 1.25rem — 20px                    |
| `'large'`  | `--ui-icon-large`  | 1.5rem — 24px                     |

Button tiers set `font-size` on the host (`button.css`), which the unscaled
glyph inherits: `compact`/`regular` → medium, `large`/`data-spread` → large.
An explicit `uiScale` still wins. **No glyph renders off-ladder inside a
control.**

## Accessibility

Decorative by default (`aria-hidden` on the host). A glyph that carries the
meaning alone takes `uiLabel` and becomes `role="img"` with that name. The
logo follows the same rule (`uiLabel="Creativo"` when it is the only brand
name in the control, nothing when the anchor already names it).

## Imperative DOM

MapLibre owns the marker DOM, so pins use
`UiIconRegistry.createElement(document, 'location.pin', overrides)` — the
same resolution, built with `createElementNS`. Snapshot semantics: an
element handed out is not rewritten when the manifest changes.

## Enforcement

- **Types:** `UiIconName` is closed; `uiName`/`uiIcon` inputs take it.
- **`no-restricted-syntax`** (root `eslint.config.mjs`, selectors in
  `tools/lint-rules/icon-syntax.mjs`): icon-font / Angular Material
  imports, `as UiIconName`, Material class or font names in strings.
- **`creativo/icon-registry-only`** (`tools/lint-rules/icon-registry-only.mjs`,
  templates incl. inline): `<mat-icon>`, raw ligature spans, raw glyph names
  in `uiName`/`uiIcon` (static and literal branches of bindings), `<img>`
  logos.
- **stylelint:** `font-family` may not name Material; `.material-*` and
  `mat-icon` selectors are banned.
- **`pnpm icons:check`** (CI): repo-wide sweep — bypasses, unknown keys, and
  `--report` for the per-key usage inventory. `--propose` / `--fix --map`
  are the codemod for an icon-font codebase.
- **This project is the allow-list** (its `eslint.config.mjs` turns the two
  rules off). The package `material-symbols` is gone from `package.json`, so
  the old import cannot even resolve.

## What is NOT an icon — the sanctioned exceptions

Audited 2026-09-24 across `apps/` and `libs/` (templates, inline templates,
CSS, copy). Everything that draws a glyph goes through `ui-icon`/`ui-logo`;
these do not, on purpose, and the lint rule's `allowInlineSvg` list names
the SVG ones so a fourth needs a decision:

| What                                   | Where                                | Why it is not a registry icon                                                          |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Animated hamburger ⟷ ✕                 | `cr-menu-icon` (shell)               | two CSS bars whose morph IS the mark — a control, not a glyph                          |
| Draw-on checkmark                      | `ui-reward-moment`                   | a `pathLength`-normalised stroke choreographed by CSS; the geometry is the animation   |
| Countdown ring                         | `ui-toast`                           | a progress arc; the ✕ over it IS a registry icon (`toast.dismiss`)                     |
| Progress ring                          | `ui-progress-ring`                   | data, not iconography                                                                  |
| Country flags                          | `ui-phone-field`                     | `flag-icons` SVGs as `<img alt="">` — images of emblems, not glyphs                    |
| Noise texture, hatches, ticket notches | landing, staff grid, coupon card     | CSS backgrounds and masks — shapes, not symbols                                        |
| PWA icons and favicon                  | `apps/*/public/icons`, `favicon.ico` | rasters the OS shows outside the DOM; not derived from the registry's logo (open item) |

Typographic characters in prose (`×` in "Style × Size", arrows in
documentation sentences) are copy, not icons; an arrow that is an
AFFORDANCE (a back link, a link card) is `nav.back` / `nav.explore`.

## Testing

`provideUiIcons({...})` remaps keys in a `TestBed`; `UI_ICON_REPORTER` takes a
spy; `UI_ICON_MANIFEST_SOURCE` takes a `Subject` for the remote path. See the
specs beside each file, and `tools/lint-rules/*.spec.mjs` for the rules
themselves.
