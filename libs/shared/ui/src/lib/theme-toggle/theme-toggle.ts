import { Component, inject } from '@angular/core';
import { UiIcon } from '@creativo/ui/icons';
import { Button } from '../button/button';
import { ThemeService } from '../theme/theme.service';

@Component({
  selector: 'cr-theme-toggle',
  imports: [Button, UiIcon],
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.css',
  host: { class: 'cr-theme-toggle' },
})
export class ThemeToggle {
  protected readonly themeService = inject(ThemeService);
}
