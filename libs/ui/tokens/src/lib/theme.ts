/** Values stamped as `data-theme` on `<html>` by the pre-paint theme-init script (§7.6). */
export type UiTheme = 'light' | 'dark';

/** Values stamped as `data-density` on `<html>`; unset resolves to the `regular` (1×) tier. */
export type UiDensity = 'compact' | 'regular' | 'spacious';

export const UI_THEMES: readonly UiTheme[] = ['light', 'dark'];
export const UI_DENSITIES: readonly UiDensity[] = [
  'compact',
  'regular',
  'spacious',
];
