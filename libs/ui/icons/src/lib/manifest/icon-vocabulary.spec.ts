import { MATERIAL_GLYPHS } from '../material/material-glyphs.generated';
import { hasMaterialGlyph } from '../material/material';
import { parseUiIconManifest } from './icon-manifest';
import {
  UI_BUNDLED_ICON_MANIFEST,
  UI_ICON_ALIASES,
  UI_ICON_KEY_PATTERN,
  UI_ICON_NAMES,
  UI_ICON_REGISTRY,
  UI_ICON_VECTORS,
  UI_LOGO,
} from './icon-vocabulary';

describe('the bundled vocabulary', () => {
  it('names every key in the domain.action grammar', () => {
    for (const key of UI_ICON_NAMES) {
      expect(key, key).toMatch(UI_ICON_KEY_PATTERN);
    }
  });

  it('keeps every registry value a plain glyph name (dots mark semantic keys)', () => {
    for (const [key, glyph] of Object.entries(UI_ICON_REGISTRY)) {
      expect(glyph, key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  /**
   * Every Material glyph the vocabulary names must be in the GENERATED
   * table. This replaces the old check against the icon font's `index.d.ts`
   * and catches the same class of defect — `staff.day` once shipped as
   * `contact_calendar`, a name newer than the pinned font, and the menu row
   * rendered "CONTACT_CALENDAR" in capitals. Now the generator refuses an
   * unknown name and this test refuses a stale table.
   */
  it('has generated path data for every Material glyph it names', () => {
    // Guard the guard: an empty table would pass vacuously.
    expect(Object.keys(MATERIAL_GLYPHS).length).toBeGreaterThan(50);
    const missing = Object.entries(UI_ICON_REGISTRY)
      .filter(([, glyph]) => !hasMaterialGlyph(glyph))
      .map(([key, glyph]) => `${key} → ${glyph}`);
    expect(missing).toEqual([]);
  });

  it('carries no glyph the vocabulary stopped naming (table not stale the other way)', () => {
    const named = new Set(Object.values(UI_ICON_REGISTRY));
    const orphaned = Object.keys(MATERIAL_GLYPHS).filter(
      (glyph) => !named.has(glyph as never),
    );
    expect(orphaned).toEqual([]);
  });

  it('points every alias at a concrete (non-alias) key, and no key lives in two tables', () => {
    for (const [key, target] of Object.entries(UI_ICON_ALIASES)) {
      expect(target in UI_ICON_REGISTRY || target in UI_ICON_VECTORS, key).toBe(
        true,
      );
      expect(target in UI_ICON_ALIASES, key).toBe(false);
      expect(key in UI_ICON_REGISTRY, key).toBe(false);
      expect(key in UI_ICON_VECTORS, key).toBe(false);
    }
    for (const key of Object.keys(UI_ICON_VECTORS)) {
      expect(key in UI_ICON_REGISTRY, key).toBe(false);
    }
  });

  it('is itself a valid manifest under the remote validator', () => {
    const { manifest, issues } = parseUiIconManifest(UI_BUNDLED_ICON_MANIFEST, {
      knownKeys: UI_ICON_NAMES,
      hasGlyph: hasMaterialGlyph,
    });
    expect(issues).toEqual([]);
    expect(Object.keys(manifest?.icons ?? {}).length).toBe(UI_ICON_NAMES.size);
    expect(manifest?.logo).toEqual(UI_LOGO);
  });
});
