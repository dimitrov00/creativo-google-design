import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KEY_PATTERN,
  WORKSPACE_ROOT,
  proposeKey,
  rawGlyphs,
  rewriteRawIcons,
  scan,
  scanFile,
} from './check-icon-usage.mjs';

const fixtures = join(WORKSPACE_ROOT, 'tools/icons/__fixtures__');
const known = new Set([
  'sheet.close',
  'frame.collapse',
  'frame.expand',
  'account.anonymous',
  'nav.back',
]);

describe('check-icon-usage', () => {
  it('finds nothing wrong in registry-shaped code and inventories its keys', () => {
    const { violations, usages } = scan(fixtures, known, ['clean']);
    expect(violations).toEqual([]);
    expect([...new Set(usages.map((u) => u.key))].sort()).toEqual(
      [
        'account.anonymous',
        'frame.collapse',
        'frame.expand',
        'sheet.close',
      ].sort(),
    );
  });

  it('reports every bypass shape with file and line', () => {
    const { violations } = scan(fixtures, known, ['dirty']);
    const codes = violations.map((v) => v.code).sort();
    expect(codes).toEqual(
      [
        'icon-font-import',
        'inline-svg',
        'key-cast',
        'mat-icon',
        'mat-icon',
        'material-class',
        'material-class',
        'material-class', // the side-effect import's path spells the class too
        'material-font',
        'raw-logo',
        'unknown-key',
        'unknown-key',
      ].sort(),
    );
    const unknown = violations
      .filter((v) => v.code === 'unknown-key')
      .map((v) => v.value)
      .sort();
    expect(unknown).toEqual(['close', 'not.known.here.four']);
    expect(
      violations.every((v) => v.line > 0 && v.file.startsWith('dirty/')),
    ).toBe(true);
  });

  it('exempts the registry boundary from bypass checks but still inventories it', () => {
    const inside = scanFile(
      join(WORKSPACE_ROOT, 'libs/ui/icons/src/lib/icon/icon.ts'),
      `const c = 'material-symbols-rounded'; const t = '<ui-icon uiName="sheet.close" />';`,
      known,
    );
    expect(inside.violations).toEqual([]);
    expect(inside.usages.map((u) => u.key)).toEqual(['sheet.close']);
  });

  it('proposes slice-scoped camelCase keys for raw glyphs', () => {
    expect(
      proposeKey('person_add', 'libs/features/client/booking/src/lib/x.html'),
    ).toBe('booking.personAdd');
    expect(proposeKey('close', 'apps/web/src/app/x.html')).toBe('web.close');
    expect(
      KEY_PATTERN.test(
        proposeKey('person_add', 'libs/features/client/booking/src/lib/x.html'),
      ),
    ).toBe(true);
  });

  it('rewrites mappable raw usages and leaves the rest untouched', () => {
    const source = readFileSync(
      join(fixtures, 'dirty/dirty.component.html'),
      'utf8',
    );
    expect(rawGlyphs(source).map((r) => r.glyph)).toEqual([
      'close',
      'delete',
      'person_add',
    ]);
    const { source: out, unmapped } = rewriteRawIcons(source, {
      close: 'sheet.close',
      person_add: 'party.addGuest',
    });
    expect(out).toContain('<ui-icon uiName="sheet.close" />');
    expect(out).toContain('<ui-icon uiName="party.addGuest" />');
    expect(out).toContain('<mat-icon>delete</mat-icon>');
    expect(unmapped).toEqual(['delete']);
  });
});
