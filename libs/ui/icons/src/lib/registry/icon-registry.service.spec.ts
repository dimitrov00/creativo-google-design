import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { fail, ok, type Result } from '@creativo/domain/kernel';
import { UI_LOGO } from '../manifest/icon-vocabulary';
import { MATERIAL_GLYPHS } from '../material/material-glyphs.generated';
import {
  UI_ICON_MANIFEST_SOURCE,
  UI_ICON_REPORTER,
  UiIconDiagnostic,
  UiIconManifestSource,
  UiIconRegistry,
  provideUiIcons,
} from './icon-registry.service';

interface Harness {
  readonly registry: UiIconRegistry;
  readonly changes: Subject<Result<unknown, Error>>;
  readonly remembered: unknown[];
  readonly diagnostics: UiIconDiagnostic[];
}

function setUp(
  options: { cached?: unknown; overrides?: boolean } = {},
): Harness {
  const changes = new Subject<Result<unknown, Error>>();
  const remembered: unknown[] = [];
  const diagnostics: UiIconDiagnostic[] = [];
  const source: UiIconManifestSource = {
    cached: options.cached === undefined ? undefined : () => options.cached,
    changes,
    remember: (manifest) => remembered.push(manifest),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: UI_ICON_MANIFEST_SOURCE, useValue: source },
      {
        provide: UI_ICON_REPORTER,
        useValue: { report: (d: UiIconDiagnostic) => diagnostics.push(d) },
      },
      ...(options.overrides
        ? [provideUiIcons({ 'sheet.close': 'cancel' })]
        : []),
    ],
  });
  return {
    registry: TestBed.inject(UiIconRegistry),
    changes,
    remembered,
    diagnostics,
  };
}

const pathOf = (glyph: string) => MATERIAL_GLYPHS[glyph];

describe('UiIconRegistry', () => {
  it('serves the bundled vocabulary with no source configured', () => {
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(UiIconRegistry);
    expect(registry.origin()).toBe('bundled');
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('close'));
    expect(registry.logo()).toBe(UI_LOGO);
  });

  it('applies the cached last-known-good synchronously, before any live emission', () => {
    const { registry } = setUp({
      cached: { schemaVersion: 1, icons: { 'sheet.close': 'cancel' } },
    });
    expect(registry.origin()).toBe('cached');
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('cancel'));
  });

  it('adopts a valid live manifest, remembers it, and recomputes resolutions', () => {
    const { registry, changes, remembered } = setUp();
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('close'));

    changes.next(ok({ schemaVersion: 1, icons: { 'sheet.close': 'cancel' } }));
    expect(registry.origin()).toBe('remote');
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('cancel'));
    expect(remembered).toEqual([
      {
        schemaVersion: 1,
        icons: { 'sheet.close': { kind: 'material', glyph: 'cancel' } },
      },
    ]);
  });

  it('keeps the current manifest when a live one is rejected, and reports it', () => {
    const { registry, changes, remembered, diagnostics } = setUp({
      cached: { schemaVersion: 1, icons: { 'sheet.close': 'cancel' } },
    });
    changes.next(ok({ schemaVersion: 99 }));
    expect(registry.origin()).toBe('cached');
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('cancel'));
    expect(remembered).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual(['manifest-rejected']);
  });

  it('reports a source failure and carries on', () => {
    const { registry, changes, diagnostics } = setUp();
    changes.next(fail(new Error('offline')));
    expect(diagnostics).toEqual([
      { code: 'source-failed', origin: 'source', detail: 'offline' },
    ]);
    expect(registry.resolve('sheet.close')).not.toBeNull();
  });

  it('returns to the bundled defaults when the backend withdraws its manifest', () => {
    const { registry, changes, remembered } = setUp({
      cached: { schemaVersion: 1, icons: { 'sheet.close': 'cancel' } },
    });
    changes.next(ok(null));
    expect(registry.origin()).toBe('bundled');
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('close'));
    expect(remembered).toEqual([null]);
  });

  it('drops only the bad entries of a partly valid manifest', () => {
    const { registry, changes, diagnostics } = setUp();
    changes.next(
      ok({
        schemaVersion: 1,
        icons: {
          'sheet.close': 'cancel',
          'nav.back': 'no_such_glyph',
          'made.up': 'close',
        },
      }),
    );
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('cancel'));
    expect(registry.resolve('nav.back')?.paths[0]?.d).toBe(
      pathOf('chevron_left'),
    );
    expect(diagnostics.map((d) => [d.code, d.key])).toEqual([
      ['entry-rejected', 'nav.back'],
      ['key-unknown', 'made.up'],
    ]);
  });

  it('lets DI overrides beat the remote manifest', () => {
    const { registry, changes } = setUp({ overrides: true });
    changes.next(ok({ schemaVersion: 1, icons: { 'sheet.close': 'check' } }));
    const overrides = TestBed.inject(UiIconRegistry) && [
      { 'sheet.close': 'cancel' as const },
    ];
    expect(registry.resolve('sheet.close', overrides)?.paths[0]?.d).toBe(
      pathOf('cancel'),
    );
    expect(registry.resolve('sheet.close')?.paths[0]?.d).toBe(pathOf('check'));
  });

  it('reports an unresolvable key once and renders nothing for it', () => {
    const { registry, diagnostics } = setUp();
    expect(registry.resolve('no.such' as never)).toBeNull();
    expect(registry.resolve('no.such' as never)).toBeNull();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'icon-missing', key: 'no.such' }),
    ]);
  });

  it('takes a remote logo and falls back to the bundled one', () => {
    const { registry, changes } = setUp();
    const light = {
      kind: 'vector',
      viewBox: '0 0 2 2',
      paths: [{ d: 'M0 0h2v2H0z' }],
    };
    changes.next(ok({ schemaVersion: 1, logo: { light } }));
    expect(registry.logo().light).toEqual(light);
    changes.next(ok({ schemaVersion: 1, icons: {} }));
    expect(registry.logo()).toBe(UI_LOGO);
  });

  it('builds imperative DOM through the same resolution', () => {
    const { registry } = setUp();
    const svg = registry.createElement(document, 'location.pin');
    expect(svg?.tagName.toLowerCase()).toBe('svg');
    expect(svg?.getAttribute('data-name')).toBe('location.pin');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
      pathOf('storefront'),
    );
  });
});
