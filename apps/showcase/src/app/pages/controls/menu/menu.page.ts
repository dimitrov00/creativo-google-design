import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  UiButton,
  UiIcon,
  UiModalSheet,
  UiMonthPicker,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** A fixed today, so the page draws the same month on every visit. */
const TODAY = '2026-10-06';

/** `вт, 6.10` — the day pill's grammar, as Intl writes it for Bulgarian. */
function dayPill(dayKey: string): string {
  const [year = 1970, month = 1, day = 1] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('bg', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

@Component({
  selector: 'cr-menu-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiModalSheet,
    UiMonthPicker,
    UiSheetActionBar,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './menu.page.html',
  styleUrl: './menu.page.css',
})
export class MenuPage {
  protected readonly plainOpen = signal(false);
  protected readonly destructiveOpen = signal(false);
  protected readonly alignedOpen = signal(false);
  protected readonly lastAction = signal('—');

  protected readonly today = TODAY;
  protected readonly day = signal(TODAY);
  protected readonly dayLabel = computed(() => dayPill(this.day()));
  protected readonly monthOpen = signal(false);

  protected readonly dockedOpen = signal(false);
  protected readonly dockedMonthOpen = signal(false);
  protected readonly dockedRows = [
    { label: 'Цял ден', value: 'Не' },
    { label: 'От', value: '12:00' },
    { label: 'До', value: '13:00' },
    { label: 'Повтаряне', value: 'Никога' },
  ];

  protected run(action: string): void {
    this.lastAction.set(action);
  }

  protected pickDay(dayKey: string): void {
    this.day.set(dayKey);
    this.monthOpen.set(false);
  }

  protected pickDockedDay(dayKey: string): void {
    this.day.set(dayKey);
    this.dockedMonthOpen.set(false);
  }

  protected closeDocked(): void {
    this.dockedMonthOpen.set(false);
    this.dockedOpen.set(false);
  }
}
