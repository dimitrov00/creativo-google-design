import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import type { UiGaugeControlSize, UiMark } from '@creativo/ui/controls';
import {
  UiAvatar,
  UiButton,
  UiCard,
  UiGauge,
  UiIcon,
  UiProgressRing,
} from '@creativo/ui/controls';
import { UiFlow, UiGrid, UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

@Component({
  selector: 'cr-gauge-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiAvatar,
    UiButton,
    UiCard,
    UiFlow,
    UiFrameDirective,
    UiGauge,
    UiGrid,
    UiIcon,
    UiProgressRing,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './gauge.page.html',
  styleUrl: './gauge.page.css',
})
export class GaugePage {
  /**
   * The ring's three sizes, each named by the disc it wraps. «Фейд» at 23
   * with II = 10 and III = 25: (23 − 10) / (25 − 10), 87 %.
   */
  protected readonly rings: readonly UiGaugeControlSize[] = [
    'regular',
    'large',
    'extraLarge',
  ];

  /** The grid's two sizes: a family not started wears the same quiet line at both. */
  protected readonly tiles: readonly UiGaugeControlSize[] = [
    'regular',
    'large',
  ];

  /** Visits towards the next status, ten to a rung: the live ring. */
  protected readonly visits = signal(13);
  protected readonly visitsLeft = computed(() => 20 - this.visits());
  protected readonly visitsText = computed(() =>
    this.visits() >= 20
      ? 'Платина, 20 посещения за 12 месеца'
      : `Злато, ${this.visits()} посещения за 12 месеца, още ${this.visitsLeft()} до Платина`,
  );

  /** The catalogue's costs as notches only: the glance tile's points bar. */
  protected readonly costNotches: readonly UiMark[] = [
    { value: 120, label: null },
    { value: 250, label: null },
  ];

  /** The same costs, named: the loyalty page's catalogue. */
  protected readonly costs: readonly UiMark[] = [
    { value: 120, label: '120 т.' },
    { value: 250, label: '250 т.' },
    { value: 400, label: '400 т.' },
  ];

  /** Бронз → Платина, qualifying visits in twelve months. */
  protected readonly tiers: readonly UiMark[] = [
    { value: 0, label: 'Бронз' },
    { value: 4, label: 'Сребро' },
    { value: 10, label: 'Злато' },
    { value: 20, label: 'Платина', detail: ['още 6'] },
  ];

  /** A season's levels I–V. */
  protected readonly seasonLevels: readonly UiMark[] = [
    { value: 1, label: null, short: 'I' },
    { value: 3, label: null, short: 'II' },
    { value: 5, label: null, short: 'III' },
    { value: 8, label: null, short: 'IV' },
    { value: 12, label: null, short: 'V' },
  ];

  /** A medal family's ladder: threshold under each node, then when it was won or what it pays. */
  protected readonly ladder: readonly UiMark[] = [
    { value: 1, label: '1', short: 'I', detail: ['2025'] },
    { value: 10, label: '10', short: 'II', detail: ['3.06'] },
    { value: 25, label: '25', short: 'III', detail: ['+50 т.'] },
    { value: 50, label: '50', short: 'IV', detail: ['+100 т.'] },
    { value: 100, label: '100', short: 'V', detail: ['+200 т.'] },
  ];

  /** The live demo: points and stamps that move while the page is open. */
  protected readonly balance = signal(308);
  protected readonly stamps = signal(4);
  protected readonly stampsText = computed(
    () =>
      `${this.stamps()} от 10 посещения, още ${10 - this.stamps()} до безплатно подстригване`,
  );

  protected earn(): void {
    this.balance.update((value) => Math.min(400, value + 40));
    this.stamps.update((value) => (value >= 10 ? 0 : value + 1));
    this.visits.update((value) => Math.min(20, value + 1));
  }

  protected spend(): void {
    this.balance.update((value) => Math.max(0, value - 120));
    this.visits.set(10);
  }
}
