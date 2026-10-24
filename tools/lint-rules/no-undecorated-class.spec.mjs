import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noUndecoratedClass } from './no-undecorated-class.mjs';
import { pathScope, scopedPath } from './path-scope.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

// The options the root config passes (ui-residue-cleanup §3.1): every lib and
// app, never tools/**.
const options = [{ include: ['/libs/', '/apps/'] }];
const feature = '/repo/libs/features/shared/visits/src/lib/visit-clock.ts';
const uiLib = 'C:\\repo\\libs\\ui\\controls\\src\\lib\\x.ts';
const showcase = '/repo/apps/showcase/src/app/x.ts';
const tool = '/repo/tools/seed/settle.ts';
const undecorated = [{ messageId: 'undecoratedClass' }];

tester.run('creativo/no-undecorated-class', noUndecoratedClass, {
  valid: [
    // The five Angular kinds, each decorator CALLED.
    {
      code: "@Component({ selector: 'x-a', template: '' }) export class A {}",
      filename: feature,
      options,
    },
    { code: '@Injectable() export class S {}', filename: feature, options },
    {
      code: "@Injectable({ providedIn: 'root' }) export class R {}",
      filename: showcase,
      options,
    },
    {
      code: "@Directive({ selector: '[xD]' }) export class D {}",
      filename: uiLib,
      options,
    },
    {
      code: "@Pipe({ name: 'p' }) export class P { transform(v: string) { return v; } }",
      filename: feature,
      options,
    },
    { code: '@NgModule({}) export class M {}', filename: feature, options },
    // One Angular decorator among others is enough.
    {
      code: "@Other() @Component({ selector: 'x-b', template: '' }) export class B {}",
      filename: feature,
      options,
    },
    // Not a class at all.
    {
      code: 'export interface VisitClock { time(): string }',
      filename: feature,
      options,
    },
    {
      code: 'export const visitClockOf = (minute: number) => ({ time: () => String(minute) });',
      filename: feature,
      options,
    },
    // Outside `include`: the rule never reads Node tooling (UR-8).
    {
      code: 'export class SeedHelper {}',
      filename: tool,
      options,
    },
    // An `allowIn` fragment skips the file.
    {
      code: 'export class Fake {}',
      filename: feature,
      options: [{ include: ['/libs/'], allowIn: ['/shared/visits/'] }],
    },
  ],
  invalid: [
    {
      code: 'export class VisitClock {}',
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      // Windows separators are normalised before matching.
      code: 'class EdgeScroller {}',
      filename: uiLib,
      options,
      errors: undecorated,
    },
    {
      code: 'export const Reporter = class {};',
      filename: showcase,
      options,
      errors: undecorated,
    },
    {
      code: 'export const Named = class Inner {};',
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      code: '@Foo() export class X {}',
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      code: 'export class Y implements OnDestroy { ngOnDestroy() {} }',
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      // Uncalled: Angular never compiles `@Component` without its metadata.
      code: '@Component export class Z {}',
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      // A member access is not the Angular decorator.
      code: "@ng.Component({ selector: 'x-c', template: '' }) export class C {}",
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      code: 'export abstract class Base {}',
      filename: feature,
      options,
      errors: undecorated,
    },
    {
      // Without `include` the rule runs on every file it is given.
      code: 'export class Anywhere {}',
      filename: tool,
      errors: undecorated,
    },
  ],
});

describe('pathScope', () => {
  const contextOf = (filename, first) => ({
    physicalFilename: filename,
    options: first === undefined ? [] : [first],
  });

  it('normalises separators and roots a relative path', () => {
    expect(scopedPath(contextOf('C:\\repo\\libs\\x.ts'))).toBe(
      '/C:/repo/libs/x.ts',
    );
    expect(scopedPath(contextOf('libs/ui/x.ts'))).toBe('/libs/ui/x.ts');
    expect(scopedPath(contextOf('/repo/apps/web/src/main.ts'))).toBe(
      '/repo/apps/web/src/main.ts',
    );
  });

  it('is active inside include, inactive outside it and on allowIn', () => {
    const first = { include: ['/libs/'], allowIn: ['/libs/ui/icons/'] };
    expect(pathScope(contextOf('/r/libs/features/a.ts', first)).active).toBe(
      true,
    );
    expect(pathScope(contextOf('libs/features/a.ts', first)).active).toBe(true);
    expect(pathScope(contextOf('/r/tools/a.ts', first)).active).toBe(false);
    expect(pathScope(contextOf('/r/libs/ui/icons/a.ts', first)).active).toBe(
      false,
    );
    expect(pathScope(contextOf('/r/tools/a.ts')).active).toBe(true);
  });

  it('answers listed() for any option key', () => {
    const scope = pathScope(
      contextOf('/r/libs/ui/patterns/src/lib/confetti/confetti.ts', {
        allowRandomIn: ['/libs/ui/patterns/src/lib/confetti/confetti.ts'],
      }),
    );
    expect(scope.listed('allowRandomIn')).toBe(true);
    expect(scope.listed('allowIn')).toBe(false);
  });
});
