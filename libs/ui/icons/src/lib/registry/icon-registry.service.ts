import {
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  Provider,
  Signal,
  computed,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import type { Result } from '@core/primitives';
import {
  UiIconAsset,
  UiIconIssueCode,
  mergeUiIconManifests,
  normalizeIconEntry,
  type UiIconArtwork,
  type UiIconEntry,
  type UiIconEntryInput,
  type UiIconIssue,
  type UiIconManifest,
  type UiLogoEntry,
  type UiVectorAsset,
} from '../manifest/icon-manifest';
import { parseUiIconManifest } from '../manifest/icon-manifest-parser';
import {
  UI_BUNDLED_ICON_MANIFEST,
  UI_ICON_NAMES,
  UI_LOGO,
  UiIconName,
} from '../manifest/icon-vocabulary';
import { hasMaterialGlyph, materialGlyph } from '../material/material';
import {
  UiIconFailureReason,
  UiIconOrigin,
  resolveIconEntry,
  type UiIconLayer,
  type UiIconResolution,
} from './icon-resolver';

/* ── Diagnostics ─────────────────────────────────────────────────────── */

/**
 * Every code a diagnostic carries: the validator's issues, the resolver's
 * failure reasons, and the source's own failure — each family declared once
 * in its dictionary. Values: external contract — the kebab codes
 * `consoleUiIconReporter` prints (OQ-11).
 */
export const UiIconDiagnosticCode = {
  ...UiIconIssueCode,
  ...UiIconFailureReason,
  /** The remote source's stream failed, or its cached manifest was unreadable. */
  SourceFailed: 'source-failed',
} as const;
export type UiIconDiagnosticCode =
  (typeof UiIconDiagnosticCode)[keyof typeof UiIconDiagnosticCode];

export interface UiIconDiagnostic {
  readonly code: UiIconDiagnosticCode;
  readonly key?: string;
  readonly detail: string;
  readonly origin: UiIconOrigin;
}

/**
 * Where icon failures go. A missing key must never crash rendering — the
 * component draws an empty em box — but it must not be silent either: this
 * is the seam an error reporter plugs into in production. The default is
 * the console, `error` in development so it is impossible to miss and
 * `warn` in production so it is visible without being fatal.
 */
export interface UiIconReporter {
  report(diagnostic: UiIconDiagnostic): void;
}

/**
 * The console reporter — a plain object over a closure, not a class
 * (CLAUDE.md §2: `class` belongs to Angular kinds only). `loud` sends each
 * diagnostic to `console.error`, otherwise to `console.warn`.
 */
export function consoleUiIconReporter(loud: boolean): UiIconReporter {
  return {
    report(diagnostic: UiIconDiagnostic): void {
      const message = `[ui-icon] ${diagnostic.code}${
        diagnostic.key ? ` "${diagnostic.key}"` : ''
      } (${diagnostic.origin}): ${diagnostic.detail}`;
      if (loud) console.error(message);
      else console.warn(message);
    },
  };
}

export const UI_ICON_REPORTER = new InjectionToken<UiIconReporter>(
  'UI_ICON_REPORTER',
  {
    providedIn: 'root',
    factory: () => consoleUiIconReporter(isDevMode()),
  },
);

/* ── DI overrides (tests, route subtrees, white-label builds) ───────── */

/** A partial remap. Values: a Material glyph name, a vector asset, or an alias. */
export type UiIconOverrides = Partial<
  Record<UiIconName, UiIconEntryInput | { readonly alias: UiIconName }>
>;

/**
 * Multi-provider: several layers may each remap a slice; later (more
 * specific) providers win. Overrides beat the remote manifest on purpose —
 * they are code someone wrote deliberately for a scope, and the escape
 * hatch that pins an icon regardless of what the backend says.
 */
export const UI_ICON_OVERRIDES = new InjectionToken<readonly UiIconOverrides[]>(
  'UI_ICON_OVERRIDES',
);

export function provideUiIcons(overrides: UiIconOverrides): Provider {
  return { provide: UI_ICON_OVERRIDES, useValue: overrides, multi: true };
}

/* ── The manifest source (backend override seam) ────────────────────── */

/**
 * Why the source could not deliver a manifest — a flat struct, a value
 * (never an `Error`): the words the `source-failed` diagnostic prints.
 */
export interface UiIconSourceFailure {
  readonly detail: string;
}

/**
 * Where remote manifests come from. The registry knows nothing about
 * Firestore, HTTP or storage — the app's composition root builds one of
 * these from its ports (see `provideUiIconManifest`).
 *
 * - `cached` is read ONCE, synchronously, when the registry is created: the
 *   last manifest that passed validation, so the first paint already wears
 *   it and nothing swaps under the user when the live one lands.
 * - `changes` is the live stream. A failed `Result` (its
 *   {@link UiIconSourceFailure}) is reported and ignored; a value is
 *   validated and, if it passes, adopted and `remember`ed. `null` means "the
 *   backend has no manifest" and returns to the bundled defaults (and
 *   forgets the cache).
 */
export interface UiIconManifestSource {
  readonly cached?: () => unknown;
  readonly changes: Observable<Result<unknown, UiIconSourceFailure>>;
  readonly remember?: (manifest: UiIconManifest | null) => void;
  /** `https://` origins an `image` logo may load from, besides same-origin paths. */
  readonly allowedImageOrigins?: readonly string[];
}

export const UI_ICON_MANIFEST_SOURCE = new InjectionToken<UiIconManifestSource>(
  'UI_ICON_MANIFEST_SOURCE',
);

/**
 * Wires a remote manifest source and starts the registry with the app, so
 * the cached manifest is applied before the first icon renders.
 */
export function provideUiIconManifest(
  factory: () => UiIconManifestSource,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: UI_ICON_MANIFEST_SOURCE, useFactory: factory },
    provideEnvironmentInitializer(() => {
      inject(UiIconRegistry);
    }),
  ]);
}

/* ── The registry ────────────────────────────────────────────────────── */

/** Which layer the effective manifest comes from. */
export type UiIconManifestOrigin =
  | typeof UiIconOrigin.Bundled
  | typeof UiIconOrigin.Cached
  | typeof UiIconOrigin.Remote;

const BUNDLED_LAYER: UiIconLayer = {
  name: UiIconOrigin.Bundled,
  icons: UI_BUNDLED_ICON_MANIFEST.icons,
};

function toVector(asset: UiIconArtwork): UiVectorAsset | null {
  return asset.iconAsset === UiIconAsset.Material
    ? materialGlyph(asset.glyph)
    : asset;
}

/**
 * The effective manifest — bundled defaults with whatever the remote source
 * has overridden — and the one resolver every surface goes through:
 * `ui-icon`, `ui-logo`, and imperative DOM via `createElement`.
 *
 * Signals end to end: when a remote manifest is adopted, every rendered
 * icon recomputes; zoneless change detection needs nothing else.
 */
@Injectable({ providedIn: 'root' })
export class UiIconRegistry {
  private readonly reporter = inject(UI_ICON_REPORTER);
  private readonly source = inject(UI_ICON_MANIFEST_SOURCE, { optional: true });
  private readonly remote = signal<UiIconManifest | null>(null);
  private readonly reported = new Set<string>();

  /** Which layer the effective manifest currently comes from. */
  readonly origin = signal<UiIconManifestOrigin>(UiIconOrigin.Bundled);

  /** Bundled ⊕ remote. */
  readonly manifest: Signal<UiIconManifest> = computed(() =>
    mergeUiIconManifests(UI_BUNDLED_ICON_MANIFEST, this.remote()),
  );

  private readonly layers = computed<readonly UiIconLayer[]>(() => {
    const remote = this.remote();
    return remote
      ? [{ name: UiIconOrigin.Remote, icons: remote.icons }, BUNDLED_LAYER]
      : [BUNDLED_LAYER];
  });

  constructor() {
    const source = this.source;
    if (!source) return;
    if (source.cached) {
      try {
        this.adopt(source.cached(), UiIconOrigin.Cached, false);
      } catch (error) {
        this.report({
          code: UiIconDiagnosticCode.SourceFailed,
          origin: UiIconOrigin.Source,
          detail: `cached manifest unreadable: ${String(error)}`,
        });
      }
    }
    source.changes.pipe(takeUntilDestroyed()).subscribe((result) => {
      if (!result.ok) {
        this.report({
          code: UiIconDiagnosticCode.SourceFailed,
          origin: UiIconOrigin.Source,
          detail: result.error.detail,
        });
        return;
      }
      this.adopt(result.value, UiIconOrigin.Remote, true);
    });
  }

  /** The renderable artwork for a key, or `null` (reported) when there is none. */
  resolve(
    name: UiIconName,
    overrides?: readonly UiIconOverrides[] | null,
  ): UiVectorAsset | null {
    const resolution = this.resolution(name, overrides);
    if (resolution.ok) return resolution.value.asset;
    this.reportOnce({
      code: resolution.error.reason,
      key: name,
      detail: resolution.error.detail,
      origin: overrides?.length ? UiIconOrigin.Override : this.origin(),
    });
    return null;
  }

  /** Full detail — which layer answered, which aliases were walked. */
  resolution(
    name: UiIconName,
    overrides?: readonly UiIconOverrides[] | null,
  ): UiIconResolution {
    return resolveIconEntry(
      [...overrideLayers(overrides), ...this.layers()],
      name,
      toVector,
    );
  }

  /** The logo, remote first, bundled always. */
  logo(): UiLogoEntry {
    return this.manifest().logo ?? UI_LOGO;
  }

  /**
   * Imperative DOM (MapLibre-owned markers) — the same resolution, built
   * with `createElementNS`. Snapshot semantics: a later manifest change does
   * not rewrite an element already handed out.
   */
  createElement(
    document: Document,
    name: UiIconName,
    overrides?: readonly UiIconOverrides[] | null,
  ): SVGSVGElement | null {
    const asset = this.resolve(name, overrides);
    if (!asset) return null;
    return renderVectorAsset(document, asset, name);
  }

  private adopt(
    candidate: unknown,
    origin: UiIconManifestOrigin,
    remember: boolean,
  ): void {
    const { manifest, issues } = parseUiIconManifest(candidate, {
      knownKeys: UI_ICON_NAMES,
      hasGlyph: hasMaterialGlyph,
      allowedImageOrigins: this.source?.allowedImageOrigins,
    });
    for (const issue of issues) {
      this.reportOnce(diagnosticOf(issue, origin));
    }
    if (candidate === null || candidate === undefined) {
      this.remote.set(null);
      this.origin.set(UiIconOrigin.Bundled);
      if (remember) this.source?.remember?.(null);
      return;
    }
    // Rejected outright: keep whatever is current (last-known-good).
    if (!manifest) return;
    this.remote.set(manifest);
    this.origin.set(origin);
    if (remember) this.source?.remember?.(manifest);
  }

  private reportOnce(diagnostic: UiIconDiagnostic): void {
    const id = `${diagnostic.code}:${diagnostic.key ?? ''}:${diagnostic.detail}`;
    if (this.reported.has(id)) return;
    this.reported.add(id);
    this.report(diagnostic);
  }

  private report(diagnostic: UiIconDiagnostic): void {
    this.reporter.report(diagnostic);
  }
}

/** A validator issue as the diagnostic it is reported as — its `iconIssue` is the code. */
function diagnosticOf(
  issue: UiIconIssue,
  origin: UiIconManifestOrigin,
): UiIconDiagnostic {
  const { iconIssue, key, detail } = issue;
  return key === undefined
    ? { code: iconIssue, detail, origin }
    : { code: iconIssue, key, detail, origin };
}

function overrideLayers(
  overrides: readonly UiIconOverrides[] | null | undefined,
): UiIconLayer[] {
  if (!overrides?.length) return [];
  // Later providers are more specific — they go first.
  return [...overrides].reverse().map((layer) => ({
    name: UiIconOrigin.Override,
    icons: Object.fromEntries(
      Object.entries(layer).map(([key, entry]) => [
        key,
        normalizeIconEntry(entry as UiIconEntryInput) as UiIconEntry,
      ]),
    ),
  }));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds the `<svg>` for an asset — the imperative twin of `ui-icon`'s template. */
export function renderVectorAsset(
  document: Document,
  asset: UiVectorAsset,
  name?: string,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ui-icon__glyph');
  svg.setAttribute('viewBox', asset.viewBox);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  if (name) svg.setAttribute('data-name', name);
  for (const path of asset.paths) {
    const element = document.createElementNS(SVG_NS, 'path');
    element.setAttribute('d', path.d);
    if (path.fill) element.setAttribute('fill', path.fill);
    if (path.stroke) element.setAttribute('stroke', path.stroke);
    if (path.strokeWidth !== undefined) {
      element.setAttribute('stroke-width', String(path.strokeWidth));
    }
    if (path.strokeLinecap)
      element.setAttribute('stroke-linecap', path.strokeLinecap);
    if (path.strokeLinejoin) {
      element.setAttribute('stroke-linejoin', path.strokeLinejoin);
    }
    svg.appendChild(element);
  }
  return svg;
}
