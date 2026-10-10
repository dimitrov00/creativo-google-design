/**
 * The names this lib re-exports from other modules, by name. Kept out of
 * `index.ts` and reached through its `export *`, so a bundle that uses none
 * of them never reaches their modules (esbuild follows a barrel's named
 * re-exports unconditionally, its star re-exports only when used).
 */
export {
  STREAK_EXCUSES,
  STREAK_LIMITS,
  StreakDefinition,
} from './loyalty/streak-definition';
export { StreakDefinitionError } from './loyalty/streak-definition.errors';
export { StreakInterval } from './loyalty/streak-interval';
export { StreakQualifier } from './loyalty/streak-qualifier';
export { StreakDefinitionSchedule } from './loyalty/streak-schedule';
export { projectStreak } from './loyalty/streak-projector';
