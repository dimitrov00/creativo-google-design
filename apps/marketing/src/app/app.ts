import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@angular/aria/menu';
import { TranslocoDirective } from '@jsverse/transloco';
import { SupportedLang } from '@creativo/adapters/i18n';
import {
  CursorDotComponent,
  CursorTargetDirective,
} from '@creativo/shared/cursor';
import { CrText } from '@creativo/shared/ui';
import { LanguageService } from './language.service';

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
  private readonly language = inject(LanguageService);

  protected readonly menuOpen = signal(false);
  /** Delegated to LanguageService (shared with the hero's in-film pill). */
  protected readonly activeLang = this.language.activeLang;
  protected readonly languages = this.language.languages;

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
    this.language.set(lang);
  }
}
