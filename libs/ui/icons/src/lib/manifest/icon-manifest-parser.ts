import { Result } from '@core/primitives';
import {
  UI_ICON_MANIFEST_SCHEMA_VERSION,
  UiIconAsset,
  UiIconIssueCode,
  normalizeIconEntry,
  type UiIconEntry,
  type UiIconEntryInput,
  type UiIconIssue,
  type UiIconManifest,
  type UiImageAsset,
  type UiLogoAsset,
  type UiLogoEntry,
  type UiVectorAsset,
  type UiVectorPath,
} from './icon-manifest';

/**
 * The validator — untrusted JSON in, the manifest out (`icon-manifest.ts`
 * holds the shape and says why it carries data, never markup).
 *
 * Every parser answers a `Result`: the parsed value, or a flat
 * {@link UiIconIssue} naming what was refused and why — a failure is a value
 * (Law 7.5), never a thrown error and never a bare string. The `detail` texts
 * are the diagnostic words `consoleUiIconReporter` prints.
 */

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
  readonly issues: readonly UiIconIssue[];
}

/** The two refusals an asset parser answers with — by where the asset sits (an icon entry, or the logo). */
type UiAssetRejection =
  typeof UiIconIssueCode.EntryRejected | typeof UiIconIssueCode.LogoRejected;

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

/** A refusal — `iconIssue` and its words, no key (the manifest walk adds it). */
function refuse(
  iconIssue: UiIconIssueCode,
  detail: string,
): Result.Err<UiIconIssue> {
  return Result.err({ iconIssue, detail });
}

export function isSafePathData(d: unknown): d is string {
  return (
    typeof d === 'string' &&
    d.length > 0 &&
    d.length <= MAX_PATH_DATA_LENGTH &&
    PATH_DATA.test(d)
  );
}

function parsePath(
  raw: unknown,
  rejected: UiAssetRejection,
): Result<UiVectorPath, UiIconIssue> {
  if (!isRecord(raw)) return refuse(rejected, 'path must be an object');
  if (!isSafePathData(raw['d'])) {
    return refuse(rejected, 'path.d is not SVG path data');
  }
  const path: { -readonly [K in keyof UiVectorPath]: UiVectorPath[K] } = {
    d: raw['d'],
  };
  if (raw['fill'] !== undefined) {
    if (!isOneOf(raw['fill'], ['currentColor', 'none'])) {
      return refuse(rejected, 'path.fill');
    }
    path.fill = raw['fill'];
  }
  if (raw['stroke'] !== undefined) {
    if (!isOneOf(raw['stroke'], ['currentColor', 'none'])) {
      return refuse(rejected, 'path.stroke');
    }
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
      return refuse(rejected, 'path.strokeWidth');
    }
    path.strokeWidth = width;
  }
  if (raw['strokeLinecap'] !== undefined) {
    if (!isOneOf(raw['strokeLinecap'], ['butt', 'round', 'square'])) {
      return refuse(rejected, 'path.strokeLinecap');
    }
    path.strokeLinecap = raw['strokeLinecap'];
  }
  if (raw['strokeLinejoin'] !== undefined) {
    if (!isOneOf(raw['strokeLinejoin'], ['miter', 'round', 'bevel'])) {
      return refuse(rejected, 'path.strokeLinejoin');
    }
    path.strokeLinejoin = raw['strokeLinejoin'];
  }
  return Result.ok(path);
}

/**
 * A vector asset — `{ iconAsset: 'VECTOR', viewBox, paths }` — refused as
 * `rejected` (an icon entry by default; the logo passes its own).
 */
export function parseVectorAsset(
  raw: unknown,
  rejected: UiAssetRejection = UiIconIssueCode.EntryRejected,
): Result<UiVectorAsset, UiIconIssue> {
  if (!isRecord(raw) || raw['iconAsset'] !== UiIconAsset.Vector) {
    return refuse(rejected, 'not a vector asset');
  }
  if (
    typeof raw['viewBox'] !== 'string' ||
    !VIEW_BOX.test(raw['viewBox'].trim())
  ) {
    return refuse(rejected, 'viewBox must be four numbers');
  }
  const rawPaths = raw['paths'];
  if (
    !Array.isArray(rawPaths) ||
    rawPaths.length === 0 ||
    rawPaths.length > MAX_PATHS_PER_ASSET
  ) {
    return refuse(rejected, `paths must hold 1–${MAX_PATHS_PER_ASSET} entries`);
  }
  const paths: UiVectorPath[] = [];
  for (const rawPath of rawPaths) {
    const parsed = parsePath(rawPath, rejected);
    if (!parsed.ok) return parsed;
    paths.push(parsed.value);
  }
  return Result.ok({
    iconAsset: UiIconAsset.Vector,
    viewBox: raw['viewBox'].trim(),
    paths,
  });
}

function parseImageAsset(
  raw: Record<string, unknown>,
  allowedOrigins: readonly string[],
): Result<UiImageAsset, UiIconIssue> {
  const rejected = UiIconIssueCode.LogoRejected;
  const href = raw['href'];
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) {
    return refuse(rejected, 'image.href');
  }
  if (!isAllowedImageHref(href, allowedOrigins)) {
    return refuse(
      rejected,
      'image.href must be a same-origin path or an allow-listed https origin',
    );
  }
  const width = raw['width'];
  const height = raw['height'];
  if (!isImageDimension(width) || !isImageDimension(height)) {
    return refuse(rejected, 'image.width/height must be positive numbers');
  }
  return Result.ok({ iconAsset: UiIconAsset.Image, href, width, height });
}

function isImageDimension(dimension: unknown): dimension is number {
  return (
    typeof dimension === 'number' &&
    Number.isFinite(dimension) &&
    dimension > 0 &&
    dimension <= MAX_IMAGE_DIMENSION
  );
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
): Result<UiLogoAsset, UiIconIssue> {
  if (!isRecord(raw)) {
    return refuse(UiIconIssueCode.LogoRejected, 'logo asset must be an object');
  }
  if (raw['iconAsset'] === UiIconAsset.Image) {
    return parseImageAsset(raw, allowedOrigins);
  }
  return parseVectorAsset(raw, UiIconIssueCode.LogoRejected);
}

function parseEntry(
  raw: unknown,
  options: UiIconManifestParseOptions,
): Result<UiIconEntry, UiIconIssue> {
  const rejected = UiIconIssueCode.EntryRejected;
  const normalized = isRecord(raw) || typeof raw === 'string' ? raw : null;
  if (normalized === null) {
    return refuse(rejected, 'entry must be a glyph name or an object');
  }
  const entry = normalizeIconEntry(normalized as UiIconEntryInput);
  if ('alias' in entry) {
    if (
      typeof entry.alias !== 'string' ||
      !options.knownKeys.has(entry.alias)
    ) {
      return refuse(rejected, 'alias must name a known key');
    }
    return Result.ok({ alias: entry.alias });
  }
  if (entry.iconAsset === UiIconAsset.Material) {
    if (
      typeof entry.glyph !== 'string' ||
      !MATERIAL_GLYPH_NAME.test(entry.glyph)
    ) {
      return refuse(rejected, 'material.glyph is not a glyph name');
    }
    if (!options.hasGlyph(entry.glyph)) {
      return refuse(
        rejected,
        `glyph "${entry.glyph}" is not in the bundled table — send the path data instead`,
      );
    }
    return Result.ok({ iconAsset: UiIconAsset.Material, glyph: entry.glyph });
  }
  return parseVectorAsset(entry, rejected);
}

/**
 * Untrusted document → manifest, tolerant where tolerance is safe and strict
 * where it is not.
 *
 * - An absent document is not an error: `{ manifest: null, issues: [] }`.
 * - An unsupported `schemaVersion` rejects the WHOLE document — a newer
 *   shape may mean anything, and guessing is how a client renders garbage
 *   (a version 1 document, whose assets said `kind`, is refused the same way).
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
  const issues: UiIconIssue[] = [];
  const reject = (detail: string): UiIconManifestParseResult => ({
    manifest: null,
    issues: [
      ...issues,
      { iconIssue: UiIconIssueCode.ManifestRejected, detail },
    ],
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
          iconIssue: UiIconIssueCode.KeyUnknown,
          key,
          detail: 'not in this build’s vocabulary',
        });
        continue;
      }
      const entry = parseEntry(raw, options);
      if (!entry.ok) {
        issues.push({
          iconIssue: entry.error.iconIssue,
          key,
          detail: entry.error.detail,
        });
        continue;
      }
      icons[key] = entry.value;
    }
  }

  let logo: UiLogoEntry | undefined;
  const rawLogo = input['logo'];
  if (rawLogo !== undefined && rawLogo !== null) {
    const allowedOrigins = options.allowedImageOrigins ?? [];
    if (!isRecord(rawLogo)) {
      issues.push({
        iconIssue: UiIconIssueCode.LogoRejected,
        detail: 'logo must be an object',
      });
    } else {
      const light = parseLogoAsset(rawLogo['light'], allowedOrigins);
      if (!light.ok) {
        issues.push({
          ...light.error,
          detail: `logo.light: ${light.error.detail}`,
        });
      } else {
        let dark: UiLogoAsset | undefined;
        if (rawLogo['dark'] !== undefined && rawLogo['dark'] !== null) {
          const parsedDark = parseLogoAsset(rawLogo['dark'], allowedOrigins);
          if (!parsedDark.ok) {
            issues.push({
              ...parsedDark.error,
              detail: `logo.dark: ${parsedDark.error.detail}`,
            });
          } else {
            dark = parsedDark.value;
          }
        }
        logo = dark ? { light: light.value, dark } : { light: light.value };
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
