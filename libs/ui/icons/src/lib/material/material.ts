import { UiIconAsset, type UiVectorAsset } from '../manifest/icon-manifest';
import {
  MATERIAL_GLYPHS,
  MATERIAL_GLYPHS_SOURCE,
} from './material-glyphs.generated';

/**
 * The Material Symbols provider — the ONE concrete icon source that ships.
 *
 * A glyph name resolves to inert path data from the generated table, cut at
 * the house axes (Rounded · FILL 1 · wght 400 · GRAD 0 · opsz 24) from a
 * pinned revision of google/material-design-icons. Every Material Symbol
 * shares one viewBox, so the asset is the path alone plus that constant.
 *
 * This module is the extension seam: a second provider would be another
 * `iconAsset` value ({@link UiIconAsset}) with its own table and its own
 * `xxxGlyph()`; the resolver would gain one `case`. Nothing else in the
 * registry knows what "material" means.
 */
export const MATERIAL_VIEW_BOX = '0 -960 960 960';

export { MATERIAL_GLYPHS_SOURCE };

export function hasMaterialGlyph(glyph: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATERIAL_GLYPHS, glyph);
}

export function materialGlyph(glyph: string): UiVectorAsset | null {
  if (!hasMaterialGlyph(glyph)) return null;
  return {
    iconAsset: UiIconAsset.Vector,
    viewBox: MATERIAL_VIEW_BOX,
    paths: [{ d: MATERIAL_GLYPHS[glyph] as string }],
  };
}
