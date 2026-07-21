import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@angular/aria/menu';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { SupportedLang } from '@creativo/adapters/i18n';
import {
  CursorDotComponent,
  CursorTargetDirective,
} from '@creativo/shared/cursor';
import { CrText } from '@creativo/shared/ui';

@Component({
  selector: 'cr-root',
  imports: [
    RouterLink,
    RouterOutlet,
    CrText,
    CursorDotComponent,
    CursorTargetDirective,
    TranslocoDirective,
    Menu,
    MenuContent,
    MenuItem,
    MenuTrigger,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService);

  protected readonly menuOpen = signal(false);
  protected readonly activeLang = signal<SupportedLang>('bg');

  /**
   * One entry per locale — adding a language is a single line here (plus its
   * translation file), unlike the old fixed BG/EN two-button toggle. Labels
   * are each language's own name for itself, so they are deliberately not
   * run through transloco.
   */
  protected readonly languages: ReadonlyArray<{
    code: SupportedLang;
    label: string;
  }> = [
    { code: 'bg', label: 'Български' },
    { code: 'en', label: 'English' },
  ];

  constructor() {
    this.applyLanguage('bg', false);

    // The stored language is applied only after first render: hydrating
    // against the server-rendered (bg) DOM first avoids NG0500 text
    // mismatches for returning EN visitors, which would otherwise force a
    // destructive re-render of the whole shell.
    afterNextRender(() => {
      try {
        const stored =
          this.document.defaultView?.localStorage.getItem('creativo-language');
        if (stored === 'en') this.applyLanguage(stored, false);
      } catch {
        // Storage can be unavailable in privacy-restricted browsers.
      }
    });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.syncMenuState();
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
    this.syncMenuState();
  }

  /** Scroll-locks the page behind the full-screen menu overlay. */
  private syncMenuState(): void {
    if (this.menuOpen()) {
      this.document.documentElement.setAttribute('data-menu-open', '');
    } else {
      this.document.documentElement.removeAttribute('data-menu-open');
    }
  }

  protected setLanguage(lang: SupportedLang): void {
    this.applyLanguage(lang, true);
  }

  private applyLanguage(lang: SupportedLang, persist: boolean): void {
    this.activeLang.set(lang);
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;

    if (!persist || !isPlatformBrowser(this.platformId)) return;
    try {
      this.document.defaultView?.localStorage.setItem(
        'creativo-language',
        lang,
      );
    } catch {
      // The language still changes when storage is unavailable.
    }
  }
}
