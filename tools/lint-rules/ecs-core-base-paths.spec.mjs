import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import {
  ECS_ID_CAST_RESTRICTIONS,
  UI_RAW_PRIMITIVE_RESTRICTIONS,
} from './ecs-syntax.mjs';

/**
 * Law 8's lint half must hold from EITHER base path ESLint resolves
 * `libs/ecs-core/eslint.config.mjs` against: the project directory (the
 * inferred `eslint .` lint target) and the workspace root (`eslint -c …`
 * from the root, or an `@nx/eslint:lint` target). A bare `src/…` glob in
 * that config matches nothing from the root, so its tier rules went silent
 * there; `fromEitherBase` writes each glob for both. This spec lints one
 * upward import — a primitives file reaching into components — both ways.
 */

const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = fileURLToPath(new URL('../../libs/ecs-core/', import.meta.url));
const CONFIG = fileURLToPath(
  new URL('../../libs/ecs-core/eslint.config.mjs', import.meta.url),
);
const SUBJECT = fileURLToPath(
  new URL('../../libs/ecs-core/src/primitives/brand.ts', import.meta.url),
);
const UPWARD_IMPORT =
  "import type { TimeCoordinate } from '@core/components';\nexport type Upward = TimeCoordinate;\n";

async function tierMessages(cwd) {
  const eslint = new ESLint({ cwd, overrideConfigFile: CONFIG });
  const [result] = await eslint.lintText(UPWARD_IMPORT, {
    filePath: SUBJECT,
  });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('libs/ecs-core lint: the tier rules from either base path', () => {
  it.each([
    ['the project directory', PROJECT],
    ['the workspace root', WORKSPACE],
  ])(
    'refuses a primitives file importing @core/components, linted from %s',
    async (_label, cwd) => {
      const messages = await tierMessages(cwd);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Law 8.2: src/primitives');
    },
    60_000,
  );
});

/**
 * Pass D's features/UI raw-brand guard (D-13.1, `uiRawPrimitiveBlock`) must
 * hold the same way: its two globs are repo-root-relative, which the
 * project-dir base of directory lookup would silence — so the block pins the
 * workspace root as its absolute `basePath`. The canary lints one view model
 * with three raw brand fields, one opaque UI key and one `UserId` cast in a
 * feature and in a design-system project, each from both base paths: three
 * guard reports (the key passes) and the L7 report the block restates. The
 * same text in a spec, and in a library outside the scope, draws no guard
 * report — and keeps L7 from the every-file blocks.
 *
 * libs/ui/icons is the registry boundary: its own config lifts the icon
 * selectors and restates the raw-brand guard and L7 (pass E, E-5), so the
 * same canary draws the same reports there — its specs L7 alone.
 */
const CANARY =
  'export interface CanaryVm {\n  readonly barberId: string;\n  readonly startUtcMs: number;\n  readonly today: string;\n  readonly rowId: string;\n}\nexport const canary = (raw: string) => raw as UserId;\n';

const at = (project) => ({
  dir: fileURLToPath(new URL(`../../${project}/`, import.meta.url)),
  config: fileURLToPath(
    new URL(`../../${project}/eslint.config.mjs`, import.meta.url),
  ),
});

async function syntaxMessages(project, file, cwd) {
  const { dir, config } = at(project);
  const eslint = new ESLint({ cwd: cwd ?? dir, overrideConfigFile: config });
  const [result] = await eslint.lintText(CANARY, { filePath: `${dir}${file}` });
  const messages = (result?.messages ?? []).filter(
    (message) => message.ruleId === 'no-restricted-syntax',
  );
  return {
    guard: messages.filter(
      (message) => message.message === UI_RAW_PRIMITIVE_RESTRICTIONS[0].message,
    ).length,
    cast: messages.filter(
      (message) => message.message === ECS_ID_CAST_RESTRICTIONS[0].message,
    ).length,
  };
}

describe('features and UI lint: the raw-brand guard from either base path', () => {
  const bases = [
    ['the project directory', null],
    ['the workspace root', WORKSPACE],
  ];

  it.each(
    [
      'libs/features/staff/dashboard',
      'libs/ui/controls',
      'libs/ui/icons',
    ].flatMap((project) => bases.map(([label, cwd]) => [project, label, cwd])),
  )(
    'reports three raw brand fields in %s, linted from %s',
    async (project, _label, cwd) => {
      expect(
        await syntaxMessages(project, 'src/lib/__canary__.vm.ts', cwd),
      ).toEqual({ guard: 3, cast: 1 });
    },
    60_000,
  );

  it.each(
    [
      ['libs/features/staff/dashboard', 'src/lib/__canary__.spec.ts'],
      ['libs/features/staff/dashboard', 'src/testing/__canary__.ts'],
      ['libs/ui/icons', 'src/lib/__canary__.spec.ts'],
      ['libs/shared/view-state', 'src/lib/__canary__.ts'],
    ].flatMap(([project, file]) =>
      bases.map(([label, cwd]) => [project, file, label, cwd]),
    ),
  )(
    'leaves %s %s alone, linted from %s',
    async (project, file, _label, cwd) => {
      expect(await syntaxMessages(project, file, cwd)).toEqual({
        guard: 0,
        cast: 1,
      });
    },
    60_000,
  );
});
