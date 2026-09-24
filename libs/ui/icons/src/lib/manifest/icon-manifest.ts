/**
 * The icon manifest — the ONE document that says what every semantic key
 * renders as, and what the logo is.
 *
 * Two producers write this shape: the bundled vocabulary in
 * `icon-vocabulary.ts` (TypeScript, with the rationale comments the
 * vocabulary is governed by) and, later, a backend document that overrides
 * slices of it without a build. Both go through {@link parseUiIconManifest};
 * the bundled one only in tests (it is trusted), the remote one always.
 *
 * ### Why the remote layer carries DATA, never MARKUP
 * A remotely supplied icon is untrusted input. The industry answer to
 * untrusted SVG is a sanitizer (DOMPurify's `USE_PROFILES: { svg: true }`),
 * and it is a good answer when markup has to be accepted. It does not have
 * to be accepted here: every Material Symbol is a single `<path d="…">`,
 * the wordmark is eight of them, and path data is inert — it cannot name a
 * script, a URL, a stylesheet, an event handler or another document. So the
 * manifest's vector asset is `{ viewBox, paths: [{ d, fill?, stroke? }] }`,
 * validated by grammar, and the renderer builds the `<svg>` itself. There
 * is nothing to sanitize because nothing executable can be expressed.
 *
 * The one asset that may be arbitrary (a raster or multi-colour logo) is an
 * `image` rendered through `<img>`, where the platform already disables
 * scripting and external loads for SVG-as-image, and its `href` is limited
 * to same-origin paths and allow-listed https origins.
 */

/** Bumped only for INCOMPATIBLE shape changes. Additive fields never bump it. */
export const UI_ICON_MANIFEST_SCHEMA_VERSION = 1 as const;

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
  readonly kind: 'vector';
  readonly viewBox: string;
  readonly paths: readonly UiVectorPath[];
}

/**
 * A Material Symbol by name (Rounded · FILL 1 · wght 400 · GRAD 0 · opsz 24,
 * the house cut). Resolves through the generated glyph table, so a name the
 * table does not carry cannot render — the manifest validator refuses it.
 */
export interface UiMaterialAsset {
  readonly kind: 'material';
  readonly glyph: string;
}

/** A raster or multi-colour mark, shown through `<img>`. Logo only. */
export interface UiImageAsset {
  readonly kind: 'image';
  readonly href: string;
  /** Intrinsic size — reserves the aspect ratio so the mark never shifts layout. */
  readonly width: number;
  readonly height: number;
}

/** `key → another key`. Chains are legal; the resolver bounds them. */
export interface UiIconAlias {
  readonly alias: string;
}

export type UiIconAsset = UiMaterialAsset | UiVectorAsset;
export type UiIconEntry = UiIconAsset | UiIconAlias;
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
  return typeof input === 'string' ? { kind: 'material', glyph: input } : input;
}

/* ── Validation ─────────────────────────────────────────────────────── */

export type UiIconIssueCode =
  'manifest-rejected' | 'key-unknown' | 'entry-rejected' | 'logo-rejected';

export interface UiIconManifestIssue {
  readonly code: UiIconIssueCode;
  readonly key?: string;
  readonly detail: string;
}

export interface UiIconManifestParseOptions {
  /** The vocabulary — remote documents may only speak about these keys. */
  readonly knownKeys: ReadonlySet<string>;
  /** Whether the glyph table can render this Material name. */
  readonly hasGlyph: (glyph: string) => boolean;
  /** `https://` origins an `image` logo may point at, besides same-origin paths. */
  readonly allowedImageOrigins?: readonly string[];
}

export interface UiIconManifestParseResult {
  /** `null` when the document was absent (`null`/`undefined`) or rejected outright. */
  readonly manifest: UiIconManifest | null;
  readonly issues: readonly UiIconManifestIssue[];
}

const MATERIAL_GLYPH_NAME = /^[a-z0-9_]{1,64}$/;
/** SVG path grammar — commands, numbers, separators. Nothing else exists in `d`. */
const PATH_DATA = /^[Mm][0-9,.\s\-+eEMmZzLlHhVvCcSsQqTtAa]*$/;
const VIEW_BOX = /^-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?){3}$/;
const MAX_PATH_DATA_LENGTH = 20_000;
const MAX_PATHS_PER_ASSET = 64;
const MAX_IMAGE_DIMENSION = 8192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

export function isSafePathData(d: unknown): d is string {
  return (
    typeof d === 'string' &&
    d.length > 0 &&
    d.length <= MAX_PATH_DATA_LENGTH &&
    PATH_DATA.test(d)
  );
}

function parsePath(raw: unknown): UiVectorPath | string {
  if (!isRecord(raw)) return 'path must be an object';
  if (!isSafePathData(raw['d'])) return 'path.d is not SVG path data';
  const path: { -readonly [K in keyof UiVectorPath]: UiVectorPath[K] } = {
    d: raw['d'],
  };
  if (raw['fill'] !== undefined) {
    if (!isOneOf(raw['fill'], ['currentColor', 'none'])) return 'path.fill';
    path.fill = raw['fill'];
  }
  if (raw['stroke'] !== undefined) {
    if (!isOneOf(raw['stroke'], ['currentColor', 'none'])) return 'path.stroke';
    path.stroke = raw['stroke'];
  }
  if (raw['strokeWidth'] !== undefined) {
    const width = raw['strokeWidth'];
    if (
      typeof width !== 'number' ||
      !Number.isFinite(width) ||
      width < 0 ||
      width > 64
    ) {
      return 'path.strokeWidth';
    }
    path.strokeWidth = width;
  }
  if (raw['strokeLinecap'] !== undefined) {
    if (!isOneOf(raw['strokeLinecap'], ['butt', 'round', 'square']))
      return 'path.strokeLinecap';
    path.strokeLinecap = raw['strokeLinecap'];
  }
  if (raw['strokeLinejoin'] !== undefined) {
    if (!isOneOf(raw['strokeLinejoin'], ['miter', 'round', 'bevel']))
      return 'path.strokeLinejoin';
    path.strokeLinejoin = raw['strokeLinejoin'];
  }
  return path;
}

export function parseVectorAsset(raw: unknown): UiVectorAsset | string {
  if (!isRecord(raw) || raw['kind'] !== 'vector') return 'not a vector asset';
  if (
    typeof raw['viewBox'] !== 'string' ||
    !VIEW_BOX.test(raw['viewBox'].trim())
  ) {
    return 'viewBox must be four numbers';
  }
  const rawPaths = raw['paths'];
  if (
    !Array.isArray(rawPaths) ||
    rawPaths.length === 0 ||
    rawPaths.length > MAX_PATHS_PER_ASSET
  ) {
    return `paths must hold 1–${MAX_PATHS_PER_ASSET} entries`;
  }
  const paths: UiVectorPath[] = [];
  for (const rawPath of rawPaths) {
    const parsed = parsePath(rawPath);
    if (typeof parsed === 'string') return parsed;
    paths.push(parsed);
  }
  return { kind: 'vector', viewBox: raw['viewBox'].trim(), paths };
}

function parseImageAsset(
  raw: Record<string, unknown>,
  allowedOrigins: readonly string[],
): UiImageAsset | string {
  const href = raw['href'];
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048)
    return 'image.href';
  if (!isAllowedImageHref(href, allowedOrigins)) {
    return 'image.href must be a same-origin path or an allow-listed https origin';
  }
  const width = raw['width'];
  const height = raw['height'];
  for (const dimension of [width, height]) {
    if (
      typeof dimension !== 'number' ||
      !Number.isFinite(dimension) ||
      dimension <= 0 ||
      dimension > MAX_IMAGE_DIMENSION
    ) {
      return 'image.width/height must be positive numbers';
    }
  }
  return {
    kind: 'image',
    href,
    width: width as number,
    height: height as number,
  };
}

export function isAllowedImageHref(
  href: string,
  allowedOrigins: readonly string[],
): boolean {
  // Same-origin, path-absolute only — never `//host/...` (protocol-relative
  // is a different origin) and never a bare scheme.
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && allowedOrigins.includes(url.origin);
}

function parseLogoAsset(
  raw: unknown,
  allowedOrigins: readonly string[],
): UiLogoAsset | string {
  if (!isRecord(raw)) return 'logo asset must be an object';
  if (raw['kind'] === 'image') return parseImageAsset(raw, allowedOrigins);
  return parseVectorAsset(raw);
}

function parseEntry(
  raw: unknown,
  options: UiIconManifestParseOptions,
): UiIconEntry | string {
  const normalized = isRecord(raw) || typeof raw === 'string' ? raw : null;
  if (normalized === null) return 'entry must be a glyph name or an object';
  const entry = normalizeIconEntry(normalized as UiIconEntryInput);
  if ('alias' in entry) {
    if (
      typeof entry.alias !== 'string' ||
      !options.knownKeys.has(entry.alias)
    ) {
      return 'alias must name a known key';
    }
    return { alias: entry.alias };
  }
  if (entry.kind === 'material') {
    if (
      typeof entry.glyph !== 'string' ||
      !MATERIAL_GLYPH_NAME.test(entry.glyph)
    ) {
      return 'material.glyph is not a glyph name';
    }
    if (!options.hasGlyph(entry.glyph)) {
      return `glyph "${entry.glyph}" is not in the bundled table — send the path data instead`;
    }
    return { kind: 'material', glyph: entry.glyph };
  }
  return parseVectorAsset(entry);
}

/**
 * Untrusted document → manifest, tolerant where tolerance is safe and strict
 * where it is not.
 *
 * - An absent document is not an error: `{ manifest: null, issues: [] }`.
 * - An unsupported `schemaVersion` rejects the WHOLE document — a newer
 *   shape may mean anything, and guessing is how a client renders garbage.
 * - Inside a supported document, each entry stands alone: a bad entry is
 *   dropped with an issue and every good one is kept, so one typo in an
 *   admin edit cannot un-theme the app.
 * - Keys the vocabulary does not know are skipped with an issue, not
 *   rejected: an older client reading a manifest written for a newer app
 *   must keep working (forward compatibility).
 * - Unknown fields anywhere are ignored (tolerant reader).
 */
export function parseUiIconManifest(
  input: unknown,
  options: UiIconManifestParseOptions,
): UiIconManifestParseResult {
  if (input === null || input === undefined)
    return { manifest: null, issues: [] };
  const issues: UiIconManifestIssue[] = [];
  const reject = (detail: string): UiIconManifestParseResult => ({
    manifest: null,
    issues: [...issues, { code: 'manifest-rejected', detail }],
  });

  if (!isRecord(input)) return reject('manifest must be an object');
  const version = input['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return reject('schemaVersion missing');
  }
  if (version !== UI_ICON_MANIFEST_SCHEMA_VERSION) {
    return reject(
      `schemaVersion ${version} is not supported (this build reads ${UI_ICON_MANIFEST_SCHEMA_VERSION})`,
    );
  }

  const icons: Record<string, UiIconEntry> = {};
  const rawIcons = input['icons'];
  if (rawIcons !== undefined) {
    if (!isRecord(rawIcons)) return reject('icons must be an object');
    for (const [key, raw] of Object.entries(rawIcons)) {
      if (!options.knownKeys.has(key)) {
        issues.push({
          code: 'key-unknown',
          key,
          detail: 'not in this build’s vocabulary',
        });
        continue;
      }
      const entry = parseEntry(raw, options);
      if (typeof entry === 'string') {
        issues.push({ code: 'entry-rejected', key, detail: entry });
        continue;
      }
      icons[key] = entry;
    }
  }

  let logo: UiLogoEntry | undefined;
  const rawLogo = input['logo'];
  if (rawLogo !== undefined && rawLogo !== null) {
    const allowedOrigins = options.allowedImageOrigins ?? [];
    if (!isRecord(rawLogo)) {
      issues.push({ code: 'logo-rejected', detail: 'logo must be an object' });
    } else {
      const light = parseLogoAsset(rawLogo['light'], allowedOrigins);
      if (typeof light === 'string') {
        issues.push({ code: 'logo-rejected', detail: `logo.light: ${light}` });
      } else {
        let dark: UiLogoAsset | undefined;
        if (rawLogo['dark'] !== undefined && rawLogo['dark'] !== null) {
          const parsedDark = parseLogoAsset(rawLogo['dark'], allowedOrigins);
          if (typeof parsedDark === 'string') {
            issues.push({
              code: 'logo-rejected',
              detail: `logo.dark: ${parsedDark}`,
            });
          } else {
            dark = parsedDark;
          }
        }
        logo = dark ? { light, dark } : { light };
      }
    }
  }

  return {
    manifest: logo
      ? { schemaVersion: UI_ICON_MANIFEST_SCHEMA_VERSION, icons, logo }
      : { schemaVersion: UI_ICON_MANIFEST_SCHEMA_VERSION, icons },
    issues,
  };
}

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
