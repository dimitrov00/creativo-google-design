import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  CursorDotComponent,
  CursorTargetDirective,
} from '@creativo/shared/cursor';
import { UiButton, UiChip } from '@creativo/ui/controls';
import type { UiDensity } from '@creativo/ui/tokens';
import { DesignSystemPreferences } from './design-system-preferences.service';

@Component({
  selector: 'cr-root',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    CursorDotComponent,
    CursorTargetDirective,
    UiButton,
    UiChip,
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
