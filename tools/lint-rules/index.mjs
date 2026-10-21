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
import { noRestrictedImportExpressions } from './restricted-import-expressions.mjs';
import { noSlicedPorts } from './no-sliced-ports.mjs';

export {
  ICON_SPEC_SYNTAX_RESTRICTIONS,
  ICON_SYNTAX_RESTRICTIONS,
} from './icon-syntax.mjs';
export {
  ECS_ADAPTER_RESTRICTIONS,
  ECS_ALL_SUFFIXES,
  ECS_DATA_RESTRICTIONS,
  ECS_DATE_RESTRICTIONS,
  ECS_ENTITY_RESTRICTIONS,
  ECS_ID_CAST_RESTRICTIONS,
  ECS_INTL_RESTRICTION,
  ECS_PIPELINE_RESTRICTIONS,
  ECS_PORT_RESTRICTIONS,
  ECS_PRIMITIVE_RESTRICTIONS,
  ECS_ROOT_SUFFIXES,
  ECS_SYSTEM_GLOBALS,
  ECS_SYSTEM_RESTRICTIONS,
  ECS_TOKEN_RESTRICTIONS,
  ECS_ZONED_TIME_RESTRICTIONS,
  ecsProjectBlocks,
  ecsRootEveryFileBlocks,
  ecsSyntaxBlocks,
} from './ecs-syntax.mjs';
export { PARENT_SEGMENT_REGEX } from './restricted-import-expressions.mjs';

const plugin = {
  meta: { name: 'creativo', version: '1.0.0' },
  rules: {
    'icon-registry-only': iconRegistryOnly,
    'no-restricted-import-expressions': noRestrictedImportExpressions,
    'no-sliced-ports': noSlicedPorts,
  },
};

export default plugin;
