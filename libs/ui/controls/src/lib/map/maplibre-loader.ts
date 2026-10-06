// The text-loaded stylesheet's type travels with its one importer: an app
// compiles this file from source through `paths`, and its program includes
// only its own `src/**`, never this lib's ambient declarations.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- see above.
/// <reference path="./maplibre-gl-css.d.ts" />
import {
  CSP_NONCE,
  DOCUMENT,
  Injectable,
  InjectionToken,
  inject,
} from '@angular/core';

/**
 * MapLibre's namespace as it exists at RUNTIME — the object `Map` and
 * `Marker` hang off.
 *
 * maplibre-gl ships a UMD bundle, not a real ESM module: it builds its exports
 * object inside a factory, so esbuild cannot detect named exports and a
 * dynamic import's named properties come back undefined — only `.default` is
 * populated. Confirmed live on both maps: `maplibregl.Map` off the named
 * import threw "not a constructor". The sources below unwrap `.default` once,
 * here, so no map has to know.
 */
export type MapLibreNamespace = typeof import('maplibre-gl');

/** Where MapLibre's two halves come from: the library, and ITS stylesheet. */
export interface MapLibreSources {
  readonly library: () => Promise<MapLibreNamespace>;
  /** `maplibre-gl/dist/maplibre-gl.css`, as text. */
  readonly stylesheet: () => Promise<string>;
}

/**
 * Both halves as lazy chunks — neither is on the initial path.
 *
 * The stylesheet used to be a global `@import` in `apps/web/src/styles.css`:
 * 69.9 kB of CSS every visitor downloaded at boot for a map only lazy routes
 * and a deferred landing section ever draw. It now rides the builder's
 * `loader: 'text'` import attribute into its own chunk, fetched beside the
 * library the first time a map asks. Text, not a `file` URL: a chunk lands at
 * the root beside every other chunk, where the service worker's `/*.js` group
 * already caches it, and a `<style>` applies synchronously — the rules are in
 * force before the first `new Map(...)`, so nothing paints unstyled.
 *
 * The attribute only works where the builder BUNDLES the package. The dev
 * server prebundles node packages by default, which leaves this bare import
 * external, `with` clause and all, for the browser — and browsers reject a
 * `loader` attribute (Chrome: "Invalid attribute key"), so no map would ever
 * draw under `nx serve`. Every app's dev-server target therefore excludes
 * `maplibre-gl` from prebundling (`prebundle.exclude`), bundling it exactly
 * as a production build does; `maplibre-loader.spec.ts` holds each app to it.
 *
 * A token so a test swaps the network out; nothing in the app overrides it.
 */
export const MAPLIBRE_SOURCES = new InjectionToken<MapLibreSources>(
  'MapLibreSources',
  {
    providedIn: 'root',
    factory: () => ({
      library: async () => (await import('maplibre-gl')).default,
      stylesheet: async () =>
        (
          await import('maplibre-gl/dist/maplibre-gl.css', {
            with: { loader: 'text' },
          })
        ).default,
    }),
  },
);

/** Stamped on the one `<style>` MapLibre's rules live in — the idempotency key. */
export const MAPLIBRE_STYLESHEET_ATTRIBUTE = 'data-maplibre-stylesheet';

/**
 * THE way to get MapLibre — the library AND its stylesheet, or neither.
 *
 * Every map in the app (`ui-map`, and the landing's locations section) loads
 * through here, so "a map without its CSS" cannot be written: MapLibre without
 * `maplibre-gl.css` renders its markers un-positioned (invisible), its canvas
 * container unsized and its attribution unstyled. The namespace resolves only
 * once the stylesheet is in the document, and `maplibre-loader.spec.ts` fails
 * CI on any other value import of `maplibre-gl` in an app or lib — and on the
 * sheet coming back through a global stylesheet or a `styles` entry.
 *
 * Once per app: concurrent and later callers share the first load. A load
 * that fails (a chunk that could not be fetched) is forgotten, so the next map
 * retries rather than inheriting the rejection forever.
 */
@Injectable({ providedIn: 'root' })
export class MapLibreLoader {
  private readonly document = inject(DOCUMENT);
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private readonly sources = inject(MAPLIBRE_SOURCES);
  private pending: Promise<MapLibreNamespace> | null = null;

  load(): Promise<MapLibreNamespace> {
    this.pending ??= this.fetch().catch((error: unknown) => {
      this.pending = null;
      throw error;
    });
    return this.pending;
  }

  private async fetch(): Promise<MapLibreNamespace> {
    const [library, css] = await Promise.all([
      this.sources.library(),
      this.sources.stylesheet(),
    ]);
    installMapLibreStylesheet(this.document, css, this.nonce);
    return library;
  }
}

/**
 * Put MapLibre's rules in the document, once — FIRST in `<head>`'s cascade.
 *
 * First, because that is where the global `@import` put them: at the top of
 * `styles.css`, ahead of every rule the app writes. MapLibre's sheet is
 * unlayered, so it already beats every `@layer` rule regardless of position;
 * what position decides is a TIE between it and the app's own unlayered
 * rules (`map.css`'s canvas box and stacking containment, the landing's
 * `locations-map.css`). Appended last it would win those ties; inserted
 * first it loses them, exactly as it always did — so every map draws as it
 * did when the sheet shipped at boot.
 *
 * Idempotent by attribute, not by memory: a second loader (another injector,
 * a hot reload) finds the sheet already there. Carries the page's CSP nonce
 * when one is set (`ngCspNonce`), as Angular's own component `<style>`s do —
 * `docs/security/csp-baseline.md`'s target `style-src` has no
 * `'unsafe-inline'`.
 */
export function installMapLibreStylesheet(
  document: Document,
  css: string,
  nonce: string | null = null,
): void {
  const head = document.head;
  if (head.querySelector(`style[${MAPLIBRE_STYLESHEET_ATTRIBUTE}]`)) return;

  const style = document.createElement('style');
  style.setAttribute(MAPLIBRE_STYLESHEET_ATTRIBUTE, '');
  if (nonce) style.setAttribute('nonce', nonce);
  style.textContent = css;
  head.insertBefore(
    style,
    head.querySelector('style, link[rel~="stylesheet"]'),
  );
}
