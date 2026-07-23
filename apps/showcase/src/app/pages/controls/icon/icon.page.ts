import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiIcon } from '@creativo/ui/controls';
import type { UiIconName, UiIconScale } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { UiFontStyle } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface IconScaleSample {
  readonly scale: UiIconScale;
  readonly px: number;
}

@Component({
  selector: 'cr-icon-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiFlow, UiIcon, UiStack, UiTextDirective],
  templateUrl: './icon.page.html',
  styleUrl: './icon.page.css',
})
export class IconPage {
  /** A cross-domain sampler of the closed semantic vocabulary (icon-registry.ts). */
  protected readonly names: UiIconName[] = [
    'appointment.book',
    'appointment.launch',
    'account.reservations',
    'account.rewards',
    'auth.locked',
    'nav.team',
    'nav.services',
    'nav.explore',
    'sheet.close',
    'location.place',
    'location.call',
    'location.directions',
    'service.duration',
    'service.variants',
    'prefs.theme.light',
    'prefs.theme.dark',
    'rating.star',
    'media.play',
  ];

  /** The fixed ladder — absolute rem steps, never font-derived fractions. */
  protected readonly scales: IconScaleSample[] = [
    { scale: 'small', px: 16 },
    { scale: 'medium', px: 20 },
    { scale: 'large', px: 24 },
  ];

  /** Unscaled glyphs ride the surrounding font (1em). */
  protected readonly inheritFonts: UiFontStyle[] = [
    'caption',
    'body',
    'title2',
  ];
}
