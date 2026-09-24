import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type UiSegment, UiSegmentedControl } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiMaterialDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-segmented-control-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiMaterialDirective,
    UiSegmentedControl,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './segmented-control.page.html',
  styleUrl: './segmented-control.page.css',
})
export class SegmentedControlPage {
  protected readonly scopes: readonly UiSegment[] = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
  ];
  protected readonly scope = signal('week');

  protected readonly shops: readonly UiSegment[] = [
    { id: 'center', label: 'Creativo · Center' },
    { id: 'mladost', label: 'Creativo · Mladost' },
  ];
  protected readonly shop = signal('center');

  protected readonly views: readonly UiSegment[] = [
    { id: 'map', label: 'Map', icon: 'view.map', iconOnly: true },
    { id: 'list', label: 'List', icon: 'view.list', iconOnly: true },
    { id: 'grid', label: 'Grid', icon: 'layout.grid', iconOnly: true },
  ];
  protected readonly view = signal('map');

  protected readonly mixed: readonly UiSegment[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'closed', label: 'Closed', disabled: true },
  ];
  protected readonly mixedPick = signal<string | null>(null);
}
