import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  UiChip,
  UiSearchField,
  type UiSearchFieldToken,
} from '@creativo/ui/controls';
import { UiScrollRow, UiStack } from '@creativo/ui/layout';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

/** A keyed token, as the schedule search words one. */
function token(
  id: string,
  key: string,
  value: string,
  faces: UiSearchFieldToken['faces'] = [],
): UiSearchFieldToken {
  return {
    id,
    key,
    value,
    faces,
    label: value === '' ? `${key}: избери стойност` : `${key}: ${value}`,
    removeLabel: `Махни филтъра ${key}`,
  };
}

@Component({
  selector: 'cr-search-field-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiChip, UiScrollRow, UiSearchField, UiStack],
  templateUrl: './search-field.page.html',
  styleUrl: './search-field.page.css',
})
export class SearchFieldPage {
  protected readonly plain = signal('');
  protected readonly withTokens = signal('иван');
  protected readonly many = signal('');
  protected readonly dropped = signal('');
  protected readonly docked = signal('');

  private readonly all: readonly UiSearchFieldToken[] = [
    token('BARBER', 'Бръснар', 'Николай, Иван', [
      { src: null, name: 'Николай' },
      { src: null, name: 'Иван' },
    ]),
    token('STATUS', 'Статус', 'Отказани'),
    token('WHEN', 'Кога', 'Тази седмица'),
    token('SERVICE', 'Услуга', 'Класическо подстригване'),
  ];
  protected readonly tokens = signal(this.all.slice(0, 2));
  protected readonly lots = signal(this.all);
  protected readonly building = signal([
    this.all[2] as UiSearchFieldToken,
    token('SERVICE', 'Услуга', ''),
  ]);
  /** The token whose values the demo's owner "opened". */
  protected readonly active = signal<string | null>(null);
  protected readonly dropdownFocused = signal(false);

  protected remove(
    tokens: ReturnType<typeof signal<readonly UiSearchFieldToken[]>>,
    id: string,
  ): void {
    tokens.update((held) => held.filter((token) => token.id !== id));
  }

  protected toggle(id: string): void {
    this.active.update((open) => (open === id ? null : id));
  }
}
