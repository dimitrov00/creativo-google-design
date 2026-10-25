import * as fc from 'fast-check';
import {
  UI_ICON_MANIFEST_SCHEMA_VERSION,
  UiIconAsset,
  UiIconIssueCode,
  mergeUiIconManifests,
  type UiIconManifest,
} from './icon-manifest';
import {
  isAllowedImageHref,
  isSafePathData,
  parseUiIconManifest,
} from './icon-manifest-parser';

const options = {
  knownKeys: new Set(['sheet.close', 'nav.back', 'visit.noShow']),
  hasGlyph: (glyph: string) =>
    ['close', 'cancel', 'chevron_left'].includes(glyph),
  allowedImageOrigins: ['https://firebasestorage.googleapis.com'],
};

const sample = {
  schemaVersion: 2,
  icons: {
    'sheet.close': 'cancel',
    'nav.back': { iconAsset: 'MATERIAL', glyph: 'chevron_left' },
    'visit.noShow': { alias: 'sheet.close' },
  },
  logo: {
    light: {
      iconAsset: 'VECTOR',
      viewBox: '0 0 10 10',
      paths: [{ d: 'M0 0h10v10H0z' }],
    },
    dark: {
      iconAsset: 'IMAGE',
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
      iconAsset: UiIconAsset.Material,
      glyph: 'cancel',
    });
    expect(manifest?.icons['nav.back']).toEqual({
      iconAsset: UiIconAsset.Material,
      glyph: 'chevron_left',
    });
    expect(manifest?.icons['visit.noShow']).toEqual({ alias: 'sheet.close' });
    expect(manifest?.logo?.dark?.iconAsset).toBe(UiIconAsset.Image);
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
      { ...sample, schemaVersion: 3 },
      options,
    );
    expect(manifest).toBeNull();
    expect(issues.map((issue) => issue.iconIssue)).toEqual([
      UiIconIssueCode.ManifestRejected,
    ]);
  });

  // DEP-16: schema 2 renamed the asset discriminator `kind` to `iconAsset`.
  // A version 1 document (here as the JSON it arrives as) is refused whole,
  // by its version — never read as a half-understood shape.
  it('rejects a version 1 document, whose assets said `kind`, whole (DEP-16)', () => {
    const v1 = JSON.parse(
      '{"schemaVersion":1,"icons":{"nav.back":{"kind":"material","glyph":"chevron_left"}}}',
    );
    expect(parseUiIconManifest(v1, options)).toEqual({
      manifest: null,
      issues: [
        {
          iconIssue: UiIconIssueCode.ManifestRejected,
          detail: 'schemaVersion 1 is not supported (this build reads 2)',
        },
      ],
    });
  });

  it('refuses an old `kind` asset inside a version 2 document as an entry (DEP-16)', () => {
    const { manifest, issues } = parseUiIconManifest(
      JSON.parse(
        '{"schemaVersion":2,"icons":{"sheet.close":"close","nav.back":{"kind":"material","glyph":"chevron_left"}}}',
      ),
      options,
    );
    expect(Object.keys(manifest?.icons ?? {})).toEqual(['sheet.close']);
    expect(issues).toEqual([
      {
        iconIssue: UiIconIssueCode.EntryRejected,
        key: 'nav.back',
        detail: 'not a vector asset',
      },
    ]);
  });

  it('drops a bad entry and keeps the good ones (per-entry fallback)', () => {
    const { manifest, issues } = parseUiIconManifest(
      {
        schemaVersion: 2,
        icons: {
          'sheet.close': 'cancel',
          'nav.back': 'not_a_glyph_this_build_ships',
          'visit.noShow': { alias: 'nowhere.atAll' },
        },
      },
      options,
    );
    expect(Object.keys(manifest?.icons ?? {})).toEqual(['sheet.close']);
    expect(issues.map((issue) => [issue.iconIssue, issue.key])).toEqual([
      ['entry-rejected', 'nav.back'],
      ['entry-rejected', 'visit.noShow'],
    ]);
  });

  it('skips keys this build does not know (forward compatibility) with an issue', () => {
    const { manifest, issues } = parseUiIconManifest(
      {
        schemaVersion: 2,
        icons: { 'future.key': 'close', 'sheet.close': 'close' },
      },
      options,
    );
    expect(manifest?.icons['future.key']).toBeUndefined();
    expect(manifest?.icons['sheet.close']).toBeDefined();
    expect(issues).toEqual([
      {
        iconIssue: 'key-unknown',
        key: 'future.key',
        detail: expect.any(String),
      },
    ]);
  });

  it('ignores unknown fields (tolerant reader)', () => {
    const { manifest, issues } = parseUiIconManifest(
      {
        schemaVersion: 2,
        updatedBy: 'admin',
        icons: {
          'sheet.close': { iconAsset: 'MATERIAL', glyph: 'close', note: 'x' },
        },
      },
      options,
    );
    expect(issues).toEqual([]);
    expect(manifest?.icons['sheet.close']).toEqual({
      iconAsset: UiIconAsset.Material,
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
          schemaVersion: 2,
          icons: {
            'sheet.close': {
              iconAsset: 'VECTOR',
              viewBox: '0 0 24 24',
              paths: [{ d }],
            },
          },
        },
        options,
      );
      expect(manifest?.icons['sheet.close'], d).toBeUndefined();
      expect(issues[0]?.iconIssue, d).toBe('entry-rejected');
    }
  });

  it('refuses presentation attributes outside the closed set', () => {
    const { manifest } = parseUiIconManifest(
      {
        schemaVersion: 2,
        icons: {
          'sheet.close': {
            iconAsset: 'VECTOR',
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
      { iconAsset: 'IMAGE', href: 'javascript:alert(1)', width: 1, height: 1 },
      {
        iconAsset: 'IMAGE',
        href: 'data:image/svg+xml,<svg/>',
        width: 1,
        height: 1,
      },
      {
        iconAsset: 'IMAGE',
        href: '//evil.example/logo.svg',
        width: 1,
        height: 1,
      },
      {
        iconAsset: 'IMAGE',
        href: 'https://evil.example/logo.svg',
        width: 1,
        height: 1,
      },
      { iconAsset: 'IMAGE', href: '/logo.svg', width: 0, height: 10 },
    ];
    for (const light of bad) {
      const { manifest, issues } = parseUiIconManifest(
        { schemaVersion: 2, logo: { light } },
        options,
      );
      expect(manifest?.logo, light.href).toBeUndefined();
      expect(issues[0]?.iconIssue, light.href).toBe('logo-rejected');
    }
    const ok = parseUiIconManifest(
      {
        schemaVersion: 2,
        logo: {
          light: {
            iconAsset: 'IMAGE',
            href: '/brand/logo.png',
            width: 10,
            height: 2,
          },
        },
      },
      options,
    );
    expect(ok.manifest?.logo?.light.iconAsset).toBe(UiIconAsset.Image);
  });

  it('never throws on arbitrary JSON (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = parseUiIconManifest(value, options);
        return result.manifest === null || result.manifest.schemaVersion === 2;
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
    schemaVersion: 2,
    icons: {
      a: { iconAsset: UiIconAsset.Material, glyph: 'x' },
      b: { iconAsset: UiIconAsset.Material, glyph: 'y' },
    },
    logo: {
      light: {
        iconAsset: UiIconAsset.Vector,
        viewBox: '0 0 1 1',
        paths: [{ d: 'M0 0' }],
      },
    },
  };

  it('lets the patch win per key and keeps the base logo when the patch has none', () => {
    const merged = mergeUiIconManifests(base, {
      schemaVersion: 2,
      icons: { b: { iconAsset: UiIconAsset.Material, glyph: 'z' } },
    });
    expect(merged.icons['a']).toEqual({
      iconAsset: UiIconAsset.Material,
      glyph: 'x',
    });
    expect(merged.icons['b']).toEqual({
      iconAsset: UiIconAsset.Material,
      glyph: 'z',
    });
    expect(merged.logo).toBe(base.logo);
  });

  it('returns the base untouched without a patch', () => {
    expect(mergeUiIconManifests(base, null)).toBe(base);
  });
});
