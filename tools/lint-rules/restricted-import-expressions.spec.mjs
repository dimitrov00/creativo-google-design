import { ESLint, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import {
  PARENT_SEGMENT_REGEX,
  noRestrictedImportExpressions,
} from './restricted-import-expressions.mjs';

const COMPONENTS = {
  regex: '^@core/(components)(/.*)?$',
  caseSensitive: true,
  message: 'Law 8.2: primitives imports nothing from the library.',
};
const PARENT = {
  regex: PARENT_SEGMENT_REGEX,
  caseSensitive: true,
  message: 'No `../` inside libs/ecs-core (Law 8.3).',
};
const options = [{ patterns: [COMPONENTS, PARENT] }];
const reported = (specifier, message) => ({
  messageId: 'restricted',
  data: { specifier, message },
});

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

tester.run(
  'creativo/no-restricted-import-expressions',
  noRestrictedImportExpressions,
  {
    valid: [
      // Static imports are `no-restricted-imports`' half, not this rule's.
      { code: "import { X } from '@core/components';", options },
      { code: "export { X } from '../x';", options },
      // A sibling, another tier, a package — lazily — are not matched.
      { code: "export const y = () => import('./sibling.system');", options },
      { code: "export const y = () => import('@core/systems');", options },
      { code: "export type Y = import('rxjs').Observable<1>;", options },
      // A file named `..x` is no parent segment.
      { code: "export const y = () => import('./..x');", options },
      // A computed specifier is not a literal — left to the verifier.
      { code: 'export const y = (name: string) => import(name);', options },
      {
        code: 'export const y = (tier: string) => import(`@core/${tier}`);',
        options,
      },
      // Case-sensitive patterns miss a differently-cased specifier.
      { code: "export const y = () => import('@CORE/components');", options },
    ],
    invalid: [
      {
        code: "export const y = () => import('@core/components');",
        options,
        errors: [reported('@core/components', COMPONENTS.message)],
      },
      {
        code: 'export const y = () => import(`@core/components`);',
        options,
        errors: [reported('@core/components', COMPONENTS.message)],
      },
      {
        code: "export type Y = import('@core/components').X;",
        options,
        errors: [reported('@core/components', COMPONENTS.message)],
      },
      {
        code: "import z = require('../q');\nexport const y = z;",
        options,
        errors: [reported('../q', PARENT.message)],
      },
      {
        code: "export const y = () => import('./../components/x.data');",
        options,
        errors: [reported('./../components/x.data', PARENT.message)],
      },
      {
        code: "export const y = () => import('./a/../../x');",
        options,
        errors: [reported('./a/../../x', PARENT.message)],
      },
      // One report per specifier — the first pattern it matches.
      {
        code: "export const y = () => import('@core/components/../x');",
        options,
        errors: [reported('@core/components/../x', COMPONENTS.message)],
      },
      // `caseSensitive` defaults to false, as in `no-restricted-imports`.
      {
        code: "export const y = () => import('@CORE/Components');",
        options: [{ patterns: [{ regex: '^@core/components$' }] }],
        errors: [reported('@CORE/Components', '')],
      },
    ],
  },
);

/** The static half: core `no-restricted-imports` with the shared regex. */
async function staticHits(specifier) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser },
        rules: { 'no-restricted-imports': ['error', { patterns: [PARENT] }] },
      },
    ],
  });
  const [result] = await eslint.lintText(
    `import { X } from '${specifier}';\nexport const y = X;\n`,
    { filePath: 'libs/ecs-core/src/primitives/x.primitive.ts' },
  );
  return result.messages.length;
}

describe('PARENT_SEGMENT_REGEX through no-restricted-imports', () => {
  it.each(['../x', '..', './../x', './../components/x.data', './a/../../x'])(
    'reports `%s` — a parent segment anywhere climbs',
    async (specifier) => {
      expect(await staticHits(specifier)).toBe(1);
    },
  );

  it.each(['./x', './x/y.data', './..x', '@core/systems', 'rxjs/operators'])(
    'leaves `%s` alone',
    async (specifier) => {
      expect(await staticHits(specifier)).toBe(0);
    },
  );
});
