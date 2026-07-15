// Re-exports the generated `var(--cr-...)` reference constants — regenerate
// via `nx run design-tokens:build` (runs libs/shared/design-tokens/build.mjs).
export * from '../generated/ts/core';
export * from '../generated/ts/color';
export * from '../generated/ts/vars';

export type Theme = 'light' | 'dark';
export const THEMES: readonly Theme[] = ['light', 'dark'];
