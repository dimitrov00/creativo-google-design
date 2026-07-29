import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiBadgeProminence, UiBadgeTone } from '@creativo/ui/controls';
import { UiBadge } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

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
}
