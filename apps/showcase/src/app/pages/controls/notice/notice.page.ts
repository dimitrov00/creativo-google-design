import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { UiIconName, UiNoticeTone } from '@creativo/ui/controls';
import { UiButton, UiNotice } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

interface ToneSample {
  readonly tone: UiNoticeTone;
  readonly icon: UiIconName;
  readonly title: string;
  readonly facts: readonly string[];
  readonly use: string;
}

@Component({
  selector: 'cr-notice-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiButton, UiNotice, UiStack, UiTextDirective],
  templateUrl: './notice.page.html',
  styleUrl: './notice.page.css',
})
export class NoticePage {
  /** Every tone, each with the fact it exists for. */
  protected readonly tones: readonly ToneSample[] = [
    {
      tone: 'neutral',
      icon: 'calendar.watching',
      title: '3 неявявания за 60 дни · Спри онлайн записването?',
      facts: ['Предложение — нищо не е спряно още.'],
      use: 'a suggestion: nothing has happened yet',
    },
    {
      tone: 'accent',
      icon: 'visit.pending',
      title: 'Чака одобрение',
      facts: ['Корекция +50 т. · изпратена от Иван · 12.09'],
      use: 'something in progress',
    },
    {
      tone: 'warning',
      icon: 'loyalty.freeze',
      title: 'Онлайн записването е спряно',
      facts: ['до 12.10 · 3 неявявания за 60 дни', 'Спряно от Иван · 12.09'],
      use: 'a restriction in force',
    },
    {
      tone: 'destructive',
      icon: 'booking.blocked',
      title: 'Не можеш да коригираш собствения си профил',
      facts: ['Помоли друг управител.'],
      use: 'a refusal',
    },
  ];

  /** The module-failure demo: a retry that fails once, then loads. */
  protected readonly loyaltyLoaded = signal(false);
  protected readonly retries = signal(0);

  protected retry(): void {
    this.retries.update((count) => count + 1);
    if (this.retries() > 1) this.loyaltyLoaded.set(true);
  }

  protected resetRetry(): void {
    this.retries.set(0);
    this.loyaltyLoaded.set(false);
  }

  /** A notice that lands while the page is open, announced politely. */
  protected readonly liveStatus = signal(false);
}
