import { isPlatformBrowser } from '@angular/common';
import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import {
  DEFAULT_THEME,
  META_THEME_COLOR,
  THEME_STORAGE_KEY,
  UI_THEMES,
  type UiTheme,
} from '@creativo/ui/tokens';

/** The system appearance the pre-paint script asks for when nothing is stored. */
const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * Light/dark over the pre-paint contract (OR-47): the boot script stamps
 * `data-theme` on `<html>` before Angular runs — the stored `ui-theme`
 * choice, else the system appearance — and this service is the ONE runtime
 * writer of the same three surfaces (the attribute, the storage key,
 * `<meta name="theme-color">`), every value read from `@creativo/ui/tokens`,
 * so a toggle and a reload always agree.
 *
 * It saves only an explicit choice. Boot reads the stamped attribute and
 * writes nothing: a first visit that saved the resolved theme froze the
 * system setting forever. Until the visitor picks (`set`, `toggle`), a
 * `prefers-color-scheme` listener follows the system live (DEP-F33).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly window = this.document.defaultView;
  /** A choice made this session, even where storage refused to keep it. */
  private chosen = false;

  readonly theme = signal<UiTheme>(this.readInitial());

  constructor() {
    const system =
      typeof this.window?.matchMedia === 'function'
        ? this.window.matchMedia(SYSTEM_LIGHT_QUERY)
        : undefined;
    if (system === undefined) return;
    const follow = (event: MediaQueryListEvent): void => {
      if (this.chosen || this.storedChoice() !== undefined) return;
      this.crossfade(event.matches ? 'light' : 'dark');
    };
    system.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() =>
      system.removeEventListener('change', follow),
    );
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  /** The visitor's explicit choice: saved, then painted. */
  set(theme: UiTheme): void {
    this.chosen = true;
    try {
      this.window?.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in privacy-restricted browsers.
    }
    this.crossfade(theme);
  }

  /**
   * A same-document View Transition crossfades the WHOLE page (root
   * snapshot old → new) as one smooth pass — the same browser primitive
   * `withViewTransitions` already uses for route changes (app.config.ts),
   * styled by the SAME global `::view-transition-old(root)` /
   * `::view-transition-new(root)` rule in apps/web/src/styles.css (so route
   * changes and theme switches share one consistent crossfade feel, no
   * separate duration to invent). Without this, per-element CSS
   * transitions — e.g. the header's scroll-driven background-color ease in
   * landing-header.component.css vs body's in styles.css — fire
   * independently at different speeds, so only some surfaces visibly
   * animate and others snap: reads as the header "lagging" behind an
   * otherwise-instant switch. `skipTransition()` on reduced-motion mirrors
   * app.config.ts's `onViewTransitionCreated` check exactly.
   */
  private crossfade(theme: UiTheme): void {
    if (
      !isPlatformBrowser(this.platformId) ||
      typeof this.document.startViewTransition !== 'function'
    ) {
      this.applyTheme(theme);
      return;
    }

    const transition = this.document.startViewTransition(() =>
      this.applyTheme(theme),
    );
    const reducedMotion = this.document.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) transition.skipTransition();
  }

  private applyTheme(theme: UiTheme): void {
    this.theme.set(theme);
    this.document.documentElement.setAttribute('data-theme', theme);
    // The same per-theme background the pre-paint script writes —
    // `pre-paint.spec.ts` holds both to `--sys-color-background`.
    this.document
      .querySelector('meta[name="theme-color"]')
      // eslint-disable-next-line security/detect-object-injection -- closed union.
      ?.setAttribute('content', META_THEME_COLOR[theme]);
  }

  /** What the pre-paint script stamped; the tokens' default where it never ran. */
  private readInitial(): UiTheme {
    const stamped = this.document.documentElement.getAttribute('data-theme');
    return UI_THEMES.find((theme) => theme === stamped) ?? DEFAULT_THEME;
  }

  /** A saved choice — the pre-paint script ignores anything else it finds. */
  private storedChoice(): UiTheme | undefined {
    let stored: string | null = null;
    try {
      stored = this.window?.localStorage.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      // Unreadable storage holds no choice.
    }
    return UI_THEMES.find((theme) => theme === stored);
  }
}
