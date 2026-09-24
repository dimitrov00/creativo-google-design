import * as fc from 'fast-check';
import {
  UI_ICON_MANIFEST_SCHEMA_VERSION,
  isAllowedImageHref,
  isSafePathData,
  mergeUiIconManifests,
  parseUiIconManifest,
  type UiIconManifest,
} from './icon-manifest';

const options = {
  knownKeys: new Set(['sheet.close', 'nav.back', 'visit.noShow']),
  hasGlyph: (glyph: string) =>
    ['close', 'cancel', 'chevron_left'].includes(glyph),
  allowedImageOrigins: ['https://firebasestorage.googleapis.com'],
};

const sample = {
  schemaVersion: 1,
  icons: {
    'sheet.close': 'cancel',
    'nav.back': { kind: 'material', glyph: 'chevron_left' },
    'visit.noShow': { alias: 'sheet.close' },
  },
  logo: {
    light: {
      kind: 'vector',
      viewBox: '0 0 10 10',
      paths: [{ d: 'M0 0h10v10H0z' }],
    },
    dark: {
      kind: 'image',
      href: 'https://firebasestorage.googleapis.com/v0/b/x/o/logo.png',
      width: 200,
      height: 40,
    },
  },
};

describe('parseUiIconManifest', () => {
  it('accepts a realistic document and normalizes the glyph shorthand', () => {
    const { manifest, issues } = parseUiIconManifest(sample, options);
    expect(issues).toEqual([]);
    expect(manifest?.schemaVersion).toBe(UI_ICON_MANIFEST_SCHEMA_VERSION);
    expect(manifest?.icons['sheet.close']).toEqual({
      kind: 'material',
      glyph: 'cancel',
    });
    expect(manifest?.icons['visit.noShow']).toEqual({ alias: 'sheet.close' });
    expect(manifest?.logo?.dark?.kind).toBe('image');
  });

  it('treats an absent document as "no remote manifest", not an error', () => {
    expect(parseUiIconManifest(null, options)).toEqual({
      manifest: null,
      issues: [],
    });
    expect(parseUiIconManifest(undefined, options)).toEqual({
      manifest: null,
      issues: [],
    });
  });

  it('rejects the whole document on an unsupported schema version', () => {
    const { manifest, issues } = parseUiIconManifest(
      { ...sample, schemaVersion: 2 },
      options,
    );
    expect(manifest).toBeNull();
    expect(issues.map((issue) => issue.code)).toEqual(['manifest-rejected']);
  });

  it('drops a bad entry and keeps the good ones (per-entry fallback)', () => {
    const { manifest, issues } = parseUiIconManifest(
      {
        schemaVersion: 1,
        icons: {
          'sheet.close': 'cancel',
          'nav.back': 'not_a_glyph_this_build_ships',
          'visit.noShow': { alias: 'nowhere.atAll' },
        },
      },
      options,
    );
    expect(Object.keys(manifest?.icons ?? {})).toEqual(['sheet.close']);
    expect(issues.map((issue) => [issue.code, issue.key])).toEqual([
      ['entry-rejected', 'nav.back'],
      ['entry-rejected', 'visit.noShow'],
    ]);
  });

  it('skips keys this build does not know (forward compatibility) with an issue', () => {
    const { manifest, issues } = parseUiIconManifest(
      {
        schemaVersion: 1,
        icons: { 'future.key': 'close', 'sheet.close': 'close' },
      },
      options,
    );
    expect(manifest?.icons['future.key']).toBeUndefined();
    expect(manifest?.icons['sheet.close']).toBeDefined();
    expect(issues).toEqual([
      { code: 'key-unknown', key: 'future.key', detail: expect.any(String) },
    ]);
  });

  it('ignores unknown fields (tolerant reader)', () => {
    const { manifest, issues } = parseUiIconManifest(
      {
        schemaVersion: 1,
        updatedBy: 'admin',
        icons: {
          'sheet.close': { kind: 'material', glyph: 'close', note: 'x' },
        },
      },
      options,
    );
    expect(issues).toEqual([]);
    expect(manifest?.icons['sheet.close']).toEqual({
      kind: 'material',
      glyph: 'close',
    });
  });

  it('refuses vector data that is not path data', () => {
    for (const d of [
      '<script>alert(1)</script>',
      'M0 0 url(javascript:alert(1))',
      'M0 0" onload="alert(1)',
      '',
      'L10 10', // must start with a move
    ]) {
      const { manifest, issues } = parseUiIconManifest(
        {
          schemaVersion: 1,
          icons: {
            'sheet.close': {
              kind: 'vector',
              viewBox: '0 0 24 24',
              paths: [{ d }],
            },
          },
        },
        options,
      );
      expect(manifest?.icons['sheet.close'], d).toBeUndefined();
      expect(issues[0]?.code, d).toBe('entry-rejected');
    }
  });

  it('refuses presentation attributes outside the closed set', () => {
    const { manifest } = parseUiIconManifest(
      {
        schemaVersion: 1,
        icons: {
          'sheet.close': {
            kind: 'vector',
            viewBox: '0 0 24 24',
            paths: [{ d: 'M0 0h1', fill: 'url(#evil)' }],
          },
        },
      },
      options,
    );
    expect(manifest?.icons['sheet.close']).toBeUndefined();
  });

  it('keeps the logo only when its assets are safe', () => {
    const bad = [
      { kind: 'image', href: 'javascript:alert(1)', width: 1, height: 1 },
      { kind: 'image', href: 'data:image/svg+xml,<svg/>', width: 1, height: 1 },
      { kind: 'image', href: '//evil.example/logo.svg', width: 1, height: 1 },
      {
        kind: 'image',
        href: 'https://evil.example/logo.svg',
        width: 1,
        height: 1,
      },
      { kind: 'image', href: '/logo.svg', width: 0, height: 10 },
    ];
    for (const light of bad) {
      const { manifest, issues } = parseUiIconManifest(
        { schemaVersion: 1, logo: { light } },
        options,
      );
      expect(manifest?.logo, light.href).toBeUndefined();
      expect(issues[0]?.code, light.href).toBe('logo-rejected');
    }
    const ok = parseUiIconManifest(
      {
        schemaVersion: 1,
        logo: {
          light: {
            kind: 'image',
            href: '/brand/logo.png',
            width: 10,
            height: 2,
          },
        },
      },
      options,
    );
    expect(ok.manifest?.logo?.light.kind).toBe('image');
  });

  it('never throws on arbitrary JSON (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = parseUiIconManifest(value, options);
        return result.manifest === null || result.manifest.schemaVersion === 1;
      }),
    );
  });

  it('accepts only the path-data alphabet (property)', () => {
    fc.assert(
      fc.property(fc.string(), (d) => {
        if (!isSafePathData(d)) return true;
        return !/[<>"'()&;:={}\\]/.test(d) && /^[Mm]/.test(d);
      }),
    );
  });
});

describe('isAllowedImageHref', () => {
  it('allows same-origin absolute paths and allow-listed https origins only', () => {
    const origins = ['https://cdn.example'];
    expect(isAllowedImageHref('/logo.png', origins)).toBe(true);
    expect(isAllowedImageHref('https://cdn.example/a.png', origins)).toBe(true);
    expect(isAllowedImageHref('http://cdn.example/a.png', origins)).toBe(false);
    expect(isAllowedImageHref('https://cdn.example.evil/a.png', origins)).toBe(
      false,
    );
    expect(isAllowedImageHref('//cdn.example/a.png', origins)).toBe(false);
    expect(isAllowedImageHref('logo.png', origins)).toBe(false);
  });
});

describe('mergeUiIconManifests', () => {
  const base: UiIconManifest = {
    schemaVersion: 1,
    icons: {
      a: { kind: 'material', glyph: 'x' },
      b: { kind: 'material', glyph: 'y' },
    },
    logo: {
      light: { kind: 'vector', viewBox: '0 0 1 1', paths: [{ d: 'M0 0' }] },
    },
  };

  it('lets the patch win per key and keeps the base logo when the patch has none', () => {
    const merged = mergeUiIconManifests(base, {
      schemaVersion: 1,
      icons: { b: { kind: 'material', glyph: 'z' } },
    });
    expect(merged.icons['a']).toEqual({ kind: 'material', glyph: 'x' });
    expect(merged.icons['b']).toEqual({ kind: 'material', glyph: 'z' });
    expect(merged.logo).toBe(base.logo);
  });

  it('returns the base untouched without a patch', () => {
    expect(mergeUiIconManifests(base, null)).toBe(base);
  });
});
