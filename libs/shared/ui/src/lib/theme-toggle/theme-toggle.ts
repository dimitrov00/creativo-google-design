import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '../button/button';
import { ThemeService } from '../theme/theme.service';

@Component({
  selector: 'cr-theme-toggle',
  imports: [Button],
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'cr-theme-toggle' },
})
export class ThemeToggle {
  protected readonly themeService = inject(ThemeService);
}
