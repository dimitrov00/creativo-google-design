import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiBadgeTone } from '@creativo/ui/controls';
import { UiBadge } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface BadgeSample {
  readonly tone: UiBadgeTone;
  readonly label: string;
}

@Component({
  selector: 'cr-badge-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiBadge, UiFlow, UiStack, UiTextDirective],
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
}
