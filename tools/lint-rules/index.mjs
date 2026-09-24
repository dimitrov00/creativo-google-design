/**
 * The workspace's local ESLint plugin — `creativo/*` rules. Plain ESM, no
 * build step and no generator: the root eslint.config.mjs imports this file
 * directly, which is the one loading path ESLint 9's flat config guarantees
 * (Nx's `workspace-rule` generator predates flat config and its loader has
 * open issues — nrwl/nx#19754). The folder is deliberately NOT named
 * `tools/eslint-rules`: @nx/eslint-plugin treats that exact path as its
 * legacy TypeScript rule root and tries to load a tsconfig from it.
 */
import { iconRegistryOnly } from './icon-registry-only.mjs';

export { ICON_SYNTAX_RESTRICTIONS } from './icon-syntax.mjs';

const plugin = {
  meta: { name: 'creativo', version: '1.0.0' },
  rules: {
    'icon-registry-only': iconRegistryOnly,
  },
};

export default plugin;
