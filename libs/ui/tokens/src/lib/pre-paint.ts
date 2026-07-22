import type { UiDensity, UiTheme } from './theme';

/**
 * The single source of truth for everything `apps/web/src/index.html`'s
 * inline pre-paint script stamps on `<html>` before Angular boots (theme,
 * density, lang, `<meta name="theme-color">`) — blueprint §7.6 fixes v2's
 * `THEME_INIT_SCRIPT`/`app.store.ts` drift (two independently hand-typed
 * dark meta-color values) by making this the ONE place those values are
 * written. `pre-paint.spec.ts` asserts `META_THEME_COLOR` matches
 * `--sys-color-background` in `theme-light.css`/`theme-dark.css`, and
 * `apps/web/src/index.html`'s inline script is asserted (by the same
 * mechanism, from that app) to embed these exact values — so any future
 * edit to either copy fails a test instead of silently drifting.
 */
export const THEME_STORAGE_KEY = 'ui-theme';
export const DENSITY_STORAGE_KEY = 'ui-density';
export const LANG_STORAGE_KEY = 'ui-lang';

export const DEFAULT_LANG = 'bg';

/** Mirrors `--sys-color-background` per theme — see `pre-paint.spec.ts`. */
export const META_THEME_COLOR: Record<UiTheme, string> = {
  light: '#ffffff',
  dark: '#000000',
};

export const DEFAULT_THEME: UiTheme = 'dark';
export const DEFAULT_DENSITY: UiDensity = 'regular';
