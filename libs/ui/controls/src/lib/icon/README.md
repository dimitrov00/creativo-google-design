# ui-icon — semantic vocabulary & size policy

## Semantic icon registry

`uiName` takes a **semantic intent key** (`UiIconName`), never a raw
Material Symbols ligature:

```html
<ui-icon uiName="sheet.close" />
<!-- ✓ intent -->
<ui-icon uiName="close" />
<!-- ✗ compile error: raw glyph -->
```

### Why

Raw glyph names couple call sites to today's artwork. Two different
intents — say `appointment.service.remove` and `appointment.guest.remove`
— may both render a trash can now; when guest-remove should become
`person_remove`, a raw-name codebase needs a call-site audit, a semantic
one edits **one line** in `icon-registry.ts`. This is the indirection SF
Symbols already gives SwiftUI: `Image(systemName:)` names a concept whose
artwork Apple revises per platform release without app code changing.

Rules of the vocabulary (see `UI_ICON_REGISTRY`):

- Keys are `domain.action`, intent-first: `location.directions`,
  `account.rewards`, `gallery.strip`.
- **New intent → new key**, even when the glyph already appears in the
  map (`nav.services` and `service.bundle` both map to `layers` today —
  on purpose, and free to diverge).
- `UiIconName = keyof typeof UI_ICON_REGISTRY` — the vocabulary is a
  closed union; typos and unregistered intents fail template
  type-checking.
- Runtime resolution falls back to the raw string for un-migrated or
  dynamically built names, so nothing renders as a tofu box mid-migration
  — the _type_ is the enforcement, not the runtime.

### Remapping without forking — `provideUiIcons`

Apps, themes, or route subtrees remap semantic keys through DI instead of
forking the registry:

```ts
// app.config.ts, or any route/component `providers`
providers: [
  provideUiIcons({
    'location.pin': 'distance',
    'sheet.close': 'cancel',
  }),
];
```

The hook is a **multi**-provider: several layers may each remap a slice;
the later (more specific) provider wins on conflicts. Only known
`UiIconName` keys are accepted — remap typos are compile errors. Values
are raw Material Symbols ligatures (that is the one place raw names are
legitimate: the registry/override layer is exactly where intent meets
artwork).

Imperative DOM (e.g. MapLibre-created pins) can resolve through the same
vocabulary with `resolveUiIcon('location.pin', inject(UI_ICON_OVERRIDES,
{ optional: true }))`.

## Icon size policy — the fixed ladder

Owner ruling: font-derived glyph sizes produce odd in-between values —
17.5px next to 20px next to 24px in adjacent rows reads as badly
designed. Every deliberately sized glyph therefore comes from a **fixed
three-step ladder**, published as custom properties in `icon.css`:

| `uiScale`  | Custom property    | Size           |
| ---------- | ------------------ | -------------- |
| `'small'`  | `--ui-icon-small`  | 1rem — 16px    |
| `'medium'` | `--ui-icon-medium` | 1.25rem — 20px |
| `'large'`  | `--ui-icon-large`  | 1.5rem — 24px  |

These are **absolute rem sizes, not em-relative fractions**: setting
`uiScale` detaches the glyph from the surrounding font and snaps it to
the ladder. Any context that sizes glyphs (button tiers, list rows)
must reference the `--ui-icon-*` properties, never restate the numbers.

### When to leave an icon unscaled (the default)

`uiScale` **defaults to absent** — no `data-scale` attribute is stamped
and the glyph rides the current font (`1em`), exactly like an SF Symbol
in running text. This is correct **only for glyphs inline in text
flow**: footer link arrows, caption glyphs, a symbol inside a sentence.
There the glyph must match the letterforms around it, and "the current
font size" is by definition the right size — an inline glyph is not on
the ladder because the _text_ owns its size.

### When to use each step

- **`small` (16px)** — trailing/status accessories: chevrons and
  disclosure arrows on list rows, status dots' glyph companions, dense
  metadata accessories that sit beside secondary text.
- **`medium` (20px)** — the workhorse control glyph: icons inside
  `compact`/`regular` buttons (the tier applies this automatically, see
  below) and **list-row leading icons**.
- **`large` (24px)** — glyphs in `prominent` (52px) controls and
  `data-spread` rows, and hero-level accessories that anchor a row.

### Buttons: the tier picks the step for you

`button.css` plumbs its glyph tiers onto the same custom properties —
one optical glyph size per tier, labeled and icon-only alike:

| Button tier                                                            | Box  | Glyph                     |
| ---------------------------------------------------------------------- | ---- | ------------------------- |
| `compact`                                                              | 36px | `--ui-icon-medium` (20px) |
| `regular` (default)                                                    | 44px | `--ui-icon-medium` (20px) |
| `prominent` — and any `data-spread` row (it sits on the prominent box) | 52px | `--ui-icon-large` (24px)  |

Everything in one control group (a sheet action bar, a hero CTA row)
shares one tier → automatically shares one glyph step. Inside buttons an
explicit `uiScale` still wins over the tier — but since both resolve to
the same ladder it can only move the glyph to _another rung_, so it
should be rare (a genuine one-step optical correction, nothing else).

### The invariant

**No glyph may render off-ladder inside a control.** Inline-text glyphs
ride their font; every other glyph is `--ui-icon-small`, `-medium`, or
`-large`. A consumer stylesheet that hard-codes a fourth glyph size
(15px, 18px, 1.05em…) on a control icon is a bug — re-step it onto the
ladder or, for inline text, remove the sizing and let the font carry it.
