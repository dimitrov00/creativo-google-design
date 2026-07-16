import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { SupportedLang } from '@creativo/adapters/i18n';
import {
  CursorDotComponent,
  CursorTargetDirective,
} from '@creativo/shared/cursor';

@Component({
  selector: 'cr-root',
  imports: [
    RouterLink,
    RouterOutlet,
    CursorDotComponent,
    CursorTargetDirective,
    TranslocoDirective,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService);

  protected readonly menuOpen = signal(false);
  protected readonly activeLang = signal<SupportedLang>('bg');

  constructor() {
    let lang: SupportedLang = 'bg';
    if (isPlatformBrowser(this.platformId)) {
      try {
        const stored =
          this.document.defaultView?.localStorage.getItem('creativo-language');
        if (stored === 'bg' || stored === 'en') lang = stored;
      } catch {
        // Storage can be unavailable in privacy-restricted browsers.
      }
    }
    this.applyLanguage(lang, false);
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
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
