import {
  UiIconAsset,
  type UiIconArtwork,
  type UiVectorAsset,
} from '../manifest/icon-manifest';
import {
  UI_ICON_ALIAS_DEPTH,
  resolveIconEntry,
  type UiIconLayer,
} from './icon-resolver';

const vector = (d: string): UiVectorAsset => ({
  iconAsset: UiIconAsset.Vector,
  viewBox: '0 0 1 1',
  paths: [{ d }],
});
const toVector = (asset: UiIconArtwork): UiVectorAsset | null =>
  asset.iconAsset === UiIconAsset.Material
    ? asset.glyph === 'ghost'
      ? null
      : vector(`M${asset.glyph}`)
    : asset;

const bundled: UiIconLayer = {
  name: 'bundled',
  icons: {
    'sheet.close': { iconAsset: UiIconAsset.Material, glyph: 'close' },
    'nav.back': { iconAsset: UiIconAsset.Material, glyph: 'chevron_left' },
    'gallery.grid': { alias: 'layout.grid' },
    'layout.grid': { iconAsset: UiIconAsset.Material, glyph: 'grid_view' },
  },
};

describe('resolveIconEntry', () => {
  it('resolves a plain key from the only layer', () => {
    const result = resolveIconEntry([bundled], 'sheet.close', toVector);
    expect(result).toMatchObject({
      ok: true,
      value: { layer: 'bundled', via: ['sheet.close'] },
    });
  });

  it('lets the most specific layer win', () => {
    const remote: UiIconLayer = {
      name: 'remote',
      icons: {
        'sheet.close': { iconAsset: UiIconAsset.Material, glyph: 'cancel' },
      },
    };
    const override: UiIconLayer = {
      name: 'override',
      icons: { 'sheet.close': vector('Mo') },
    };
    expect(
      resolveIconEntry([remote, bundled], 'sheet.close', toVector),
    ).toMatchObject({
      ok: true,
      value: { layer: 'remote', asset: vector('Mcancel') },
    });
    expect(
      resolveIconEntry([override, remote, bundled], 'sheet.close', toVector),
    ).toMatchObject({
      ok: true,
      value: { layer: 'override', asset: vector('Mo') },
    });
  });

  it('follows a bundled alias and reports the walk', () => {
    expect(resolveIconEntry([bundled], 'gallery.grid', toVector)).toMatchObject(
      {
        ok: true,
        value: {
          asset: vector('Mgrid_view'),
          via: ['gallery.grid', 'layout.grid'],
        },
      },
    );
  });

  it('restarts every alias hop at the top layer', () => {
    // A remote override of the TARGET reaches through the bundled alias.
    const remote: UiIconLayer = {
      name: 'remote',
      icons: {
        'layout.grid': { iconAsset: UiIconAsset.Material, glyph: 'apps' },
      },
    };
    expect(
      resolveIconEntry([remote, bundled], 'gallery.grid', toVector),
    ).toMatchObject({
      ok: true,
      value: { layer: 'remote', asset: vector('Mapps') },
    });
  });

  it('resolves a chain that only a remote manifest can build', () => {
    const remote: UiIconLayer = {
      name: 'remote',
      icons: { 'nav.back': { alias: 'gallery.grid' } },
    };
    expect(
      resolveIconEntry([remote, bundled], 'nav.back', toVector),
    ).toMatchObject({
      ok: true,
      value: { via: ['nav.back', 'gallery.grid', 'layout.grid'] },
    });
  });

  it('fails safely on a cycle, a dangling target, and an over-long chain', () => {
    const cycle: UiIconLayer = {
      name: 'remote',
      icons: { a: { alias: 'b' }, b: { alias: 'c' }, c: { alias: 'a' } },
    };
    expect(resolveIconEntry([cycle], 'a', toVector)).toMatchObject({
      ok: false,
      error: { reason: 'alias-cycle', via: ['a', 'b', 'c', 'a'] },
    });

    const dangling: UiIconLayer = {
      name: 'remote',
      icons: { a: { alias: 'nowhere' } },
    };
    expect(resolveIconEntry([dangling], 'a', toVector)).toMatchObject({
      ok: false,
      error: { reason: 'alias-dangling' },
    });

    const icons: Record<string, { alias: string }> = {};
    for (let i = 0; i < UI_ICON_ALIAS_DEPTH + 2; i++)
      icons[`k${i}`] = { alias: `k${i + 1}` };
    expect(
      resolveIconEntry([{ name: 'remote', icons }], 'k0', toVector),
    ).toMatchObject({
      ok: false,
      error: { reason: 'alias-depth' },
    });
  });

  it('distinguishes a missing key from a missing glyph', () => {
    expect(resolveIconEntry([bundled], 'no.such', toVector)).toMatchObject({
      ok: false,
      error: { reason: 'icon-missing' },
    });
    const ghost: UiIconLayer = {
      name: 'override',
      icons: {
        'nav.back': { iconAsset: UiIconAsset.Material, glyph: 'ghost' },
      },
    };
    expect(
      resolveIconEntry([ghost, bundled], 'nav.back', toVector),
    ).toMatchObject({
      ok: false,
      error: { reason: 'glyph-missing' },
    });
  });
});
