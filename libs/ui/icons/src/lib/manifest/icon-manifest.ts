/**
 * The icon manifest — the ONE document that says what every semantic key
 * renders as, and what the logo is.
 *
 * Two producers write this shape: the bundled vocabulary in
 * `icon-vocabulary.ts` (TypeScript, with the rationale comments the
 * vocabulary is governed by) and, later, a backend document that overrides
 * slices of it without a build. Both go through `parseUiIconManifest`
 * (`icon-manifest-parser.ts`); the bundled one only in tests (it is
 * trusted), the remote one always.
 *
 * This file is pure data — the shape, its tag dictionaries, the shorthand
 * normalizer and the merge — with no import at all: `tools/icons/*.mjs` load
 * the vocabulary (and through it this file) with Node and no path aliases.
 * The parser, which answers `Result`, lives beside it.
 *
 * ### Why the remote layer carries DATA, never MARKUP
 * A remotely supplied icon is untrusted input. The industry answer to
 * untrusted SVG is a sanitizer (DOMPurify's `USE_PROFILES: { svg: true }`),
 * and it is a good answer when markup has to be accepted. It does not have
 * to be accepted here: every Material Symbol is a single `<path d="…">`,
 * the wordmark is eight of them, and path data is inert — it cannot name a
 * script, a URL, a stylesheet, an event handler or another document. So the
 * manifest's vector asset is `{ iconAsset: 'VECTOR', viewBox, paths: [{ d,
 * fill?, stroke? }] }`, validated by grammar, and the renderer builds the
 * `<svg>` itself. There is nothing to sanitize because nothing executable
 * can be expressed.
 *
 * The one asset that may be arbitrary (a raster or multi-colour logo) is an
 * `IMAGE` rendered through `<img>`, where the platform already disables
 * scripting and external loads for SVG-as-image, and its `href` is limited
 * to same-origin paths and allow-listed https origins.
 */

/**
 * Bumped only for INCOMPATIBLE shape changes. Additive fields never bump it.
 * 2: the asset discriminator `kind` (`vector`/`material`/`image`) became
 * `iconAsset` ({@link UiIconAsset}) — a version 1 document is rejected whole.
 */
export const UI_ICON_MANIFEST_SCHEMA_VERSION = 2 as const;

/**
 * What an asset is — the field `iconAsset` (Law 6.2: a domain-prefixed
 * discriminator, never `kind`). Values: the manifest's WIRE spelling (a
 * remote document writes them), SCREAMING as every tag.
 */
export const UiIconAsset = {
  /** Inert path data — what every icon becomes once resolved. */
  Vector: 'VECTOR',
  /** A Material Symbol by name, resolved through the generated glyph table. */
  Material: 'MATERIAL',
  /** A raster or multi-colour mark shown through `<img>` — the logo only. */
  Image: 'IMAGE',
} as const;
export type UiIconAsset = (typeof UiIconAsset)[keyof typeof UiIconAsset];

/** One `<path>` of a vector asset. Presentation attributes are a closed set. */
export interface UiVectorPath {
  readonly d: string;
  readonly fill?: 'currentColor' | 'none';
  readonly stroke?: 'currentColor' | 'none';
  readonly strokeWidth?: number;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

/** Inert vector artwork — what every icon becomes once resolved. */
export interface UiVectorAsset {
  readonly iconAsset: typeof UiIconAsset.Vector;
  readonly viewBox: string;
  readonly paths: readonly UiVectorPath[];
}

/**
 * A Material Symbol by name (Rounded · FILL 1 · wght 400 · GRAD 0 · opsz 24,
 * the house cut). Resolves through the generated glyph table, so a name the
 * table does not carry cannot render — the manifest validator refuses it.
 */
export interface UiMaterialAsset {
  readonly iconAsset: typeof UiIconAsset.Material;
  readonly glyph: string;
}

/** A raster or multi-colour mark, shown through `<img>`. Logo only. */
export interface UiImageAsset {
  readonly iconAsset: typeof UiIconAsset.Image;
  readonly href: string;
  /** Intrinsic size — reserves the aspect ratio so the mark never shifts layout. */
  readonly width: number;
  readonly height: number;
}

/** `key → another key`. Chains are legal; the resolver bounds them. */
export interface UiIconAlias {
  readonly alias: string;
}

/** The artwork an icon key may name: a Material glyph or inert path data. */
export type UiIconArtwork = UiMaterialAsset | UiVectorAsset;
export type UiIconEntry = UiIconArtwork | UiIconAlias;
export type UiLogoAsset = UiVectorAsset | UiImageAsset;

/** The logo per colour scheme. `dark` falls back to `light`. */
export interface UiLogoEntry {
  readonly light: UiLogoAsset;
  readonly dark?: UiLogoAsset;
}

export interface UiIconManifest {
  readonly schemaVersion: typeof UI_ICON_MANIFEST_SCHEMA_VERSION;
  readonly icons: Readonly<Record<string, UiIconEntry>>;
  readonly logo?: UiLogoEntry;
}

/**
 * Authoring shorthand: a bare string is a Material glyph name. Accepted from
 * both the bundled vocabulary and remote documents, normalized once here.
 */
export type UiIconEntryInput = string | UiIconEntry;

export function normalizeIconEntry(input: UiIconEntryInput): UiIconEntry {
  return typeof input === 'string'
    ? { iconAsset: UiIconAsset.Material, glyph: input }
    : input;
}

/* ── Issues ─────────────────────────────────────────────────────────── */

/**
 * What the validator refused — the field `iconIssue`. Values: external
 * contract — the diagnostic codes `consoleUiIconReporter` prints
 * (`[ui-icon] entry-rejected "nav.back" (remote): …`), kebab as they were
 * (OQ-11), not SCREAMING.
 */
export const UiIconIssueCode = {
  /** The whole document: not an object, no or an unsupported `schemaVersion`. */
  ManifestRejected: 'manifest-rejected',
  /** A key this build's vocabulary does not know — skipped (forward compatibility). */
  KeyUnknown: 'key-unknown',
  /** One icon entry failed validation — dropped, every other entry kept. */
  EntryRejected: 'entry-rejected',
  /** A logo asset failed validation. */
  LogoRejected: 'logo-rejected',
} as const;
export type UiIconIssueCode =
  (typeof UiIconIssueCode)[keyof typeof UiIconIssueCode];

/**
 * One refusal of the validator — a flat struct, a value (never a thrown
 * error, never a bare string): what was refused (`iconIssue`), the key it
 * concerns when it concerns one, and the human `detail` the diagnostic line
 * prints.
 */
export interface UiIconIssue {
  readonly iconIssue: UiIconIssueCode;
  readonly key?: string;
  readonly detail: string;
}

/* ── Merge ──────────────────────────────────────────────────────────── */

/** Bundled ⊕ remote: the remote patch wins per key; the logo replaces whole. */
export function mergeUiIconManifests(
  base: UiIconManifest,
  patch: UiIconManifest | null,
): UiIconManifest {
  if (!patch) return base;
  return {
    schemaVersion: UI_ICON_MANIFEST_SCHEMA_VERSION,
    icons: { ...base.icons, ...patch.icons },
    logo: patch.logo ?? base.logo,
  };
}
