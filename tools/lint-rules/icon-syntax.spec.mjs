import { ESLint } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import {
  ICON_SPEC_SYNTAX_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
} from './icon-syntax.mjs';

/** Lints TypeScript source with exactly the selectors the root config installs. */
async function lint(code) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser },
        rules: {
          'no-restricted-syntax': ['error', ...ICON_SYNTAX_RESTRICTIONS],
        },
      },
    ],
  });
  const [result] = await eslint.lintText(code, {
    filePath: 'libs/features/x/src/lib/x.ts',
  });
  return result.messages.map((message) => message.message);
}

describe('icon syntax restrictions', () => {
  it('lets registry-shaped code through', async () => {
    expect(
      await lint(`
        import { UiIcon, isUiIconName, type UiIconName } from '@creativo/ui/icons';
        const key: UiIconName = 'sheet.close';
        const maybe: unknown = 'x';
        const narrowed = isUiIconName(maybe) ? maybe : null;
        const label = \`material design\`;
      `),
    ).toEqual([]);
  });

  it('blocks icon-font and Angular Material imports, static and dynamic', async () => {
    // An import specifier that spells the font also trips the literal
    // selector, so each case yields one OR two messages — never zero.
    for (const code of [
      `import 'material-symbols/rounded.css';`,
      `import x from '@material-symbols/svg-400/rounded/close.svg';`,
      `import { MatIconModule } from '@angular/material/icon';`,
      `const m = () => import('@angular/material/icon');`,
    ]) {
      const messages = await lint(code);
      expect(messages.length, code).toBeGreaterThanOrEqual(1);
      expect(
        messages.some((m) => m.includes('@creativo/ui/icons')),
        code,
      ).toBe(true);
    }
  });

  it('blocks the cast that punches through the closed key union', async () => {
    const messages = await lint(
      `const k = ('service.variant.' + v) as UiIconName;`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/isUiIconName/);
    expect(await lint(`const k = <UiIconName>('a.b');`)).toHaveLength(1);
  });

  it('blocks raw Material class and font names in strings', async () => {
    expect(
      await lint(`el.className = 'pin material-symbols-rounded';`),
    ).toHaveLength(1);
    expect(await lint(`const f = 'Material Symbols Rounded';`)).toHaveLength(1);
    expect(await lint(`const c = \`x material-icons \${y}\`;`)).toHaveLength(1);
  });

  it('lets specs cast to UiIconName and nothing else', () => {
    expect(
      ICON_SYNTAX_RESTRICTIONS.filter(
        (restriction) => !ICON_SPEC_SYNTAX_RESTRICTIONS.includes(restriction),
      ).map((restriction) => restriction.selector),
    ).toEqual([
      "TSAsExpression > TSTypeReference > Identifier[name='UiIconName']",
      "TSTypeAssertion > TSTypeReference > Identifier[name='UiIconName']",
    ]);
  });
});
