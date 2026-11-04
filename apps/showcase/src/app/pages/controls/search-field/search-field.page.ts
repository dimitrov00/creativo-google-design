import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiSearchField, type UiSearchFieldToken } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

@Component({
  selector: 'cr-search-field-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiSearchField, UiStack],
  templateUrl: './search-field.page.html',
  styleUrl: './search-field.page.css',
})
export class SearchFieldPage {
  protected readonly plain = signal('');
  protected readonly withChips = signal('иван');
  protected readonly many = signal('');

  private readonly all: readonly UiSearchFieldToken[] = [
    { id: 'barber', label: 'Николай', removeLabel: 'Махни филтъра Николай' },
    { id: 'status', label: 'Отказани', removeLabel: 'Махни филтъра Отказани' },
    {
      id: 'when',
      label: 'Тази седмица',
      removeLabel: 'Махни филтъра Тази седмица',
    },
    {
      id: 'service',
      label: 'Класическо подстригване',
      removeLabel: 'Махни филтъра Класическо подстригване',
    },
  ];
  protected readonly chips = signal(this.all.slice(0, 2));
  protected readonly lots = signal(this.all);

  protected remove(
    tokens: ReturnType<typeof signal<readonly UiSearchFieldToken[]>>,
    id: string,
  ): void {
    tokens.update((held) => held.filter((token) => token.id !== id));
  }
}
