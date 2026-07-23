import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UiButton, UiChip } from '@creativo/ui/controls';
import { UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import { UiPaddingDirective, UiTextDirective } from '@creativo/ui/modifiers';
import type { UiDensity } from '@creativo/ui/tokens';
import { DesignSystemPreferences } from './design-system-preferences.service';

@Component({
  selector: 'cr-root',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    UiButton,
    UiChip,
    UiPaddingDirective,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiToolbar,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly preferences = inject(DesignSystemPreferences);
  protected readonly densities: UiDensity[] = [
    'compact',
    'regular',
    'spacious',
  ];
}
