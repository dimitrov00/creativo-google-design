import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

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
