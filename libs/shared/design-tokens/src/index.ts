// The design tokens themselves live in ../css/{tokens,light,dark}.css as
// hand-written CSS custom properties — apps @import those files directly.
// This entry point only carries the theme vocabulary shared with TS code
// (ThemeService and friends).

export type Theme = 'light' | 'dark';
export const THEMES: readonly Theme[] = ['light', 'dark'];

export { motion } from './lib/motion';
