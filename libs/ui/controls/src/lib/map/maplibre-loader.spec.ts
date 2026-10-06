import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { CSP_NONCE } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAPLIBRE_SOURCES,
  MAPLIBRE_STYLESHEET_ATTRIBUTE,
  MapLibreLoader,
  type MapLibreNamespace,
  type MapLibreSources,
  installMapLibreStylesheet,
} from './maplibre-loader';

const CSS = '.maplibregl-map{position:relative}';
const NAMESPACE = { Map: class {} } as unknown as MapLibreNamespace;

function mapLibreStyles(): HTMLStyleElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLStyleElement>(
      `style[${MAPLIBRE_STYLESHEET_ATTRIBUTE}]`,
    ),
  );
}

/** Sources that count their calls and resolve only when told to. */
function deferredSources(): MapLibreSources & {
  readonly calls: { library: number; stylesheet: number };
  release(): void;
  fail(error: Error): void;
} {
  const calls = { library: 0, stylesheet: 0 };
  let release: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  let gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return {
    calls,
    library: async () => {
      calls.library += 1;
      await gate;
      return NAMESPACE;
    },
    stylesheet: async () => {
      calls.stylesheet += 1;
      await gate;
      return CSS;
    },
    release: () => release(),
    fail: (error) => {
      fail(error);
      // The next load gets a fresh, open gate.
      gate = Promise.resolve();
    },
  };
}

function setUp(sources: MapLibreSources, nonce: string | null = null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: MAPLIBRE_SOURCES, useValue: sources },
      { provide: CSP_NONCE, useValue: nonce },
    ],
  });
  return TestBed.inject(MapLibreLoader);
}

afterEach(() => {
  for (const style of mapLibreStyles()) style.remove();
  document.head
    .querySelectorAll('[data-test-sheet]')
    .forEach((node) => node.remove());
});

describe('MapLibreLoader', () => {
  it('resolves the namespace only once the stylesheet is in the document', async () => {
    const sources = deferredSources();
    const loader = setUp(sources);

    const load = loader.load();
    expect(mapLibreStyles()).toHaveLength(0);

    sources.release();
    const namespace = await load;

    expect(namespace).toBe(NAMESPACE);
    expect(mapLibreStyles()).toHaveLength(1);
    expect(mapLibreStyles()[0]?.textContent).toBe(CSS);
  });

  it('fetches each half once, however many maps ask and whenever', async () => {
    const sources = deferredSources();
    const loader = setUp(sources);

    const first = loader.load();
    const second = loader.load();
    sources.release();
    await Promise.all([first, second]);
    await loader.load();

    expect(first).toBe(second);
    expect(sources.calls).toEqual({ library: 1, stylesheet: 1 });
    expect(mapLibreStyles()).toHaveLength(1);
  });

  it('forgets a failed load, so the next map retries instead of inheriting it', async () => {
    const sources = deferredSources();
    const loader = setUp(sources);

    const failed = loader.load();
    sources.fail(new Error('chunk failed'));
    await expect(failed).rejects.toThrow('chunk failed');
    expect(mapLibreStyles()).toHaveLength(0);

    await expect(loader.load()).resolves.toBe(NAMESPACE);
    expect(sources.calls).toEqual({ library: 2, stylesheet: 2 });
    expect(mapLibreStyles()).toHaveLength(1);
  });

  it("stamps the page's CSP nonce, as Angular's own component styles carry it", async () => {
    const sources = deferredSources();
    const loader = setUp(sources, 'n0nce');
    sources.release();

    await loader.load();

    expect(mapLibreStyles()[0]?.getAttribute('nonce')).toBe('n0nce');
  });
});

describe('installMapLibreStylesheet', () => {
  it("goes FIRST in <head>'s cascade, where the global import used to put it", () => {
    // The app's own sheets — a critical-CSS <style> and the global bundle.
    const appStyle = document.createElement('style');
    appStyle.setAttribute('data-test-sheet', '');
    const appLink = document.createElement('link');
    appLink.rel = 'stylesheet';
    appLink.setAttribute('data-test-sheet', '');
    document.head.append(appStyle, appLink);

    installMapLibreStylesheet(document, CSS);

    const sheets = Array.from(
      document.head.querySelectorAll('style, link[rel~="stylesheet"]'),
    );
    expect(sheets[0]?.hasAttribute(MAPLIBRE_STYLESHEET_ATTRIBUTE)).toBe(true);
    expect(sheets.indexOf(appStyle)).toBeGreaterThan(0);
    expect(sheets.indexOf(appLink)).toBeGreaterThan(0);
  });

  it('is idempotent by attribute — a second loader finds the sheet in place', () => {
    installMapLibreStylesheet(document, CSS);
    installMapLibreStylesheet(document, '.other{}');

    expect(mapLibreStyles()).toHaveLength(1);
    expect(mapLibreStyles()[0]?.textContent).toBe(CSS);
  });

  it('carries no nonce when the page sets none', () => {
    installMapLibreStylesheet(document, CSS, null);

    expect(mapLibreStyles()[0]?.hasAttribute('nonce')).toBe(false);
  });
});

/*
 * THE WORKSPACE, HELD TO THE LOADER. Read from disk: MapLibre reaches a page
 * only through `MapLibreLoader`, and its sheet enters a build only through the
 * loader's text import — never a global stylesheet, a `styles` entry, a
 * `<link>`, or a second import of the library that could draw a map without
 * its CSS. And the dev server has to BUNDLE the package for that text import
 * to work at all (see `MAPLIBRE_SOURCES`).
 */
const ROOT = resolve(__dirname, '../../../../../..');
const LOADER = resolve(__dirname, 'maplibre-loader.ts');

function read(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this workspace's own files, found by listing it.
  return readFileSync(path, 'utf8');
}

/** Every file under an app's or a lib's `src/` — installs and dotfolders skipped. */
function sources(): string[] {
  const found: string[] = [];
  const walk = (dir: string, inSrc: boolean): void => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this workspace's own apps/ and libs/.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path, inSrc || entry.name === 'src');
      else if (inSrc && entry.isFile()) found.push(path);
    }
  };
  walk(resolve(ROOT, 'apps'), false);
  walk(resolve(ROOT, 'libs'), false);
  return found;
}

/** Comments out of the way, so prose that names an import is not one. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** Every VALUE import of MapLibre in a script: anything but `import type`. */
function valueImports(source: string): string[] {
  const code = withoutComments(source);
  return [
    // `typeof import('maplibre-gl')` is a TYPE, and erased.
    /(?<!\btypeof\s+)\bimport\s*\(\s*['"`]maplibre-gl[^'"`]*['"`]/g,
    /^\s*import\s*['"]maplibre-gl[^'"]*['"]/gm,
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*['"]maplibre-gl[^'"]*['"]/gm,
    /\brequire\s*\(\s*['"]maplibre-gl[^'"]*['"]/g,
  ].flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[0].trim()));
}

const SCRIPT = /\.(?:[cm]?[jt]s)$/;

describe('MapLibre reaches a page only through the loader', () => {
  it('tells a value import from a type-only one', () => {
    for (const offender of [
      "import('maplibre-gl')",
      "import('maplibre-gl/dist/maplibre-gl.css', { with: { loader: 'text' } })",
      "import 'maplibre-gl/dist/maplibre-gl.css';",
      "import maplibregl from 'maplibre-gl';",
      "import { Map } from 'maplibre-gl';",
      "import {\n  type Map,\n  Marker,\n} from 'maplibre-gl';",
      "export { Map } from 'maplibre-gl';",
      "const m = require('maplibre-gl');",
    ]) {
      expect(valueImports(offender), offender).toHaveLength(1);
    }
    for (const allowed of [
      "import type { Map as MapLibreMap } from 'maplibre-gl';",
      "export type MapLibreNamespace = typeof import('maplibre-gl');",
      "// the dynamic import('maplibre-gl') lives in the loader",
      "/* `import('maplibre-gl')` */",
      "import { signal } from '@angular/core';",
    ]) {
      expect(valueImports(allowed), allowed).toEqual([]);
    }
  });

  it('finds what it guards — the loader, both maps, the global sheets', () => {
    const scanned = sources().map((path) => relative(ROOT, path));
    expect(scanned).toEqual(
      expect.arrayContaining([
        'libs/ui/controls/src/lib/map/maplibre-loader.ts',
        'libs/ui/controls/src/lib/map/map.ts',
        'libs/features/marketing/landing/src/lib/pages/home/locations/locations.component.ts',
        'apps/web/src/styles.css',
        'apps/web/src/index.html',
        'apps/showcase/src/styles.css',
      ]),
    );
    // The loader's own two imports are the ones the scan must see.
    expect(valueImports(read(LOADER))).toHaveLength(2);
  });

  it('no app or lib imports maplibre-gl for real but the loader — `import type` only', () => {
    const offenders = sources()
      .filter(
        (path) =>
          SCRIPT.test(path) && !path.endsWith('.spec.ts') && path !== LOADER,
      )
      .flatMap((path) =>
        valueImports(read(path)).map(
          (hit) => `${relative(ROOT, path)}: ${hit}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('no stylesheet imports MapLibre’s sheet, and no page links it', () => {
    const offenders = sources().flatMap((path) => {
      const hit = /\.s?css$/.test(path)
        ? /@import\s+(?:url\()?\s*['"]?[^;'")]*maplibre-gl/.exec(
            withoutComments(read(path)),
          )
        : /\.html$/.test(path)
          ? /\b(?:href|src)\s*=\s*['"][^'"]*maplibre-gl/.exec(read(path))
          : null;
      return hit ? [`${relative(ROOT, path)}: ${hit[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});

interface TargetJson {
  readonly executor?: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly configurations?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

/** Every app's targets, from its `project.json`. */
function appTargets(): [string, TargetJson][] {
  const apps = resolve(ROOT, 'apps');
  return readdirSync(apps).flatMap((app) => {
    let project: { targets?: Record<string, TargetJson> };
    try {
      project = JSON.parse(read(resolve(apps, app, 'project.json')));
    } catch {
      return []; // not a project
    }
    return Object.entries(project.targets ?? {}).map(
      ([name, target]): [string, TargetJson] => [`${app}:${name}`, target],
    );
  });
}

/** Each option set a target runs with: its options, then each configuration over them. */
function optionSets(
  target: TargetJson,
): [string, Readonly<Record<string, unknown>>][] {
  const base = target.options ?? {};
  return [
    ['options', base],
    ...Object.entries(target.configurations ?? {}).map(
      ([name, overrides]): [string, Readonly<Record<string, unknown>>] => [
        name,
        { ...base, ...overrides },
      ],
    ),
  ];
}

describe('the apps’ build and serve targets', () => {
  it('never list MapLibre’s sheet as a global style', () => {
    let styled = 0;
    for (const [id, target] of appTargets()) {
      for (const [set, options] of optionSets(target)) {
        const styles = options['styles'];
        if (!Array.isArray(styles)) continue;
        styled += 1;
        expect(JSON.stringify(styles), `${id} ${set}`).not.toMatch(
          /maplibre-gl/,
        );
      }
    }
    expect(styled, 'targets with global styles').toBeGreaterThan(0);
  });

  /**
   * `nx serve` prebundles node packages unless told otherwise, and a
   * prebundled `maplibre-gl` leaves the loader's text import for the browser,
   * which rejects it: no map draws in dev. Excluded, the package is bundled
   * exactly as a production build bundles it.
   */
  it('bundle maplibre-gl on every dev server, so the text import works in dev', () => {
    const servers = appTargets().filter(([, target]) =>
      /:dev-server$/.test(target.executor ?? ''),
    );
    expect(servers.map(([id]) => id)).toEqual(
      expect.arrayContaining(['web:serve', 'showcase:serve']),
    );
    for (const [id, target] of servers) {
      for (const [set, options] of optionSets(target)) {
        // The builder's default is `true`: prebundle everything.
        const prebundle = options['prebundle'] ?? true;
        const bundlesMapLibre =
          prebundle === false ||
          (typeof prebundle === 'object' &&
            prebundle !== null &&
            'exclude' in prebundle &&
            Array.isArray(prebundle.exclude) &&
            prebundle.exclude.includes('maplibre-gl'));
        expect(bundlesMapLibre, `${id} ${set}: prebundle`).toBe(true);
      }
    }
  });
});
