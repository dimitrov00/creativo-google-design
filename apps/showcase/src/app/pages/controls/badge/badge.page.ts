import { ChangeDetectionStrategy, Component } from '@angular/core';
import type {
  UiBadgeProminence,
  UiBadgeSize,
  UiBadgeTone,
  UiIconName,
} from '@creativo/ui/controls';
import { UiBadge, UiMediaCard } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

interface BadgeSample {
  readonly tone: UiBadgeTone;
  readonly label: string;
}

@Component({
  selector: 'cr-badge-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBadge,
    UiFlow,
    UiForegroundStyleDirective,
    UiMediaCard,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './badge.page.html',
  styleUrl: './badge.page.css',
})
export class BadgePage {
  /** Every uiTone, each with the kind of status copy it exists for. */
  protected readonly samples: BadgeSample[] = [
    { tone: 'neutral', label: 'Draft' },
    { tone: 'accent', label: 'New' },
    { tone: 'success', label: 'Confirmed' },
    { tone: 'warning', label: 'Pending' },
    { tone: 'destructive', label: 'Cancelled' },
  ];

  /** The prominence ladder, shown on a COUNT — the case the axis exists for. */
  protected readonly prominences: readonly {
    readonly prominence: UiBadgeProminence;
    readonly note: string;
  }[] = [
    {
      prominence: 'decreased',
      note: 'no fill — informational, “1,234 photos”',
    },
    { prominence: 'standard', note: 'tinted fill (default)' },
    { prominence: 'increased', note: 'solid fill — act on it, the iOS badge' },
  ];

  /** The photo rail's dates: a short and a longer label, each capsule its own width. */
  protected readonly photoDates: readonly string[] = ['7.08', '11.07'];

  /** The glyph grammar across tones and both size tiers. */
  protected readonly glyphs: readonly {
    readonly tone: UiBadgeTone;
    readonly size: UiBadgeSize;
    readonly icon: UiIconName;
    readonly label: string;
  }[] = [
    { tone: 'accent', size: 'regular', icon: 'loyalty.tier', label: 'Злато' },
    {
      tone: 'warning',
      size: 'regular',
      icon: 'loyalty.freeze',
      label: 'Пауза',
    },
    {
      tone: 'neutral',
      size: 'large',
      icon: 'service.variant.length',
      label: 'Дълга коса',
    },
  ];
}
