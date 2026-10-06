import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import type { UiIconName } from '@creativo/ui/controls';
import {
  UiBadge,
  UiButton,
  UiQuickAction,
  UiQuickActions,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

/** One verb of a demo run. A verb with an `href` hands off; one without acts. */
interface Verb {
  readonly id: string;
  readonly icon: UiIconName;
  readonly label: string;
  /** The accessible name: it begins with the word under the disc. */
  readonly name: string;
  readonly href?: string;
  /** THE promoted verb of its run. */
  readonly promoted?: boolean;
}

const PHONE = '+359881234567';

@Component({
  selector: 'cr-quick-actions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiBadge,
    UiButton,
    UiQuickAction,
    UiQuickActions,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './quick-actions.page.html',
  styleUrl: './quick-actions.page.css',
})
export class QuickActionsPage {
  /** The staff client card's run: how to reach a person, and «Повтори». */
  protected readonly contactVerbs: readonly Verb[] = [
    {
      id: 'call',
      icon: 'contact.phone',
      label: 'Обади се',
      name: 'Обади се на Георги Петров, +359 88 123 4567',
      href: `tel:${PHONE}`,
    },
    {
      id: 'sms',
      icon: 'contact.sms',
      label: 'SMS',
      name: 'SMS до Георги Петров',
      href: `sms:${PHONE}`,
    },
    {
      id: 'viber',
      icon: 'contact.viber',
      label: 'Viber',
      name: 'Viber до Георги Петров',
      href: 'viber://chat?number=%2B359881234567',
    },
    {
      id: 'same',
      icon: 'visit.repeat',
      label: 'Повтори',
      name: 'Повтори посещението от 5 септември: фейд, оформяне на брада',
      promoted: true,
    },
  ];

  /** The wallet's run: what a client can do with what they hold. */
  protected readonly walletVerbs: readonly Verb[] = [
    {
      id: 'use',
      icon: 'promo.coupon',
      label: 'Използвай',
      name: 'Използвай награда',
      promoted: true,
    },
    {
      id: 'code',
      icon: 'loyalty.enterCode',
      label: 'Код',
      name: 'Код за отстъпка',
    },
    {
      id: 'catalog',
      icon: 'loyalty.reward',
      label: 'Награди',
      name: 'Награди за точки',
    },
    {
      id: 'history',
      icon: 'loyalty.ledger',
      label: 'История',
      name: 'История на точките',
    },
  ];

  /** A run whose first word is too long for a 330 pt phone's column. */
  protected readonly visitVerbs: readonly Verb[] = [
    {
      id: 'calendar',
      icon: 'visit.calendar',
      label: 'Добави в календара',
      name: 'Добави в календара часа на 12 октомври',
    },
    {
      id: 'move',
      icon: 'visit.reschedule',
      label: 'Премести',
      name: 'Премести часа',
    },
    {
      id: 'directions',
      icon: 'location.directions',
      label: 'Навигация',
      name: 'Навигация до салона',
    },
    {
      id: 'shop',
      icon: 'location.call',
      label: 'Обади се',
      name: 'Обади се на салона',
    },
  ];

  /** A client with no Viber: the verb is absent, never dimmed. */
  protected readonly hasViber = signal(false);
  protected readonly presentVerbs = computed(() =>
    this.contactVerbs.filter((verb) => verb.id !== 'viber' || this.hasViber()),
  );

  /** Ready tickets behind «Използвай»: more than one puts a count on the disc. */
  protected readonly tickets = signal(2);

  /** What the last verb did: a disc acts at once, it is never busy. */
  protected readonly lastAct = signal<string | null>(null);

  protected act(label: string, event: Event): void {
    // A demo page hands nothing off: the link is drawn, the dial is not.
    event.preventDefault();
    this.lastAct.set(label);
  }
}
