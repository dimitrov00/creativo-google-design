import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiDateField, UiDateFieldParts } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-date-field-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiDateField, UiFlow, UiStack, UiTextDirective],
  templateUrl: './date-field.page.html',
  styleUrl: './date-field.page.css',
})
export class DateFieldPage {
  /** Untouched group — type into it; completing a segment advances focus. */
  protected readonly defaultValue = signal<UiDateFieldParts | null>(null);
  /** Prefilled — external writes repopulate the segments zero-padded. */
  protected readonly filledValue = signal<UiDateFieldParts | null>({
    day: 3,
    month: 7,
    year: 1990,
  });
  /** Consumer-decided error — the destructive color carries the state. */
  protected readonly invalidValue = signal<UiDateFieldParts | null>({
    day: 30,
    month: 2,
    year: 1990,
  });
  /** Bulgarian chrome — order and labels are inputs, nothing hardcoded. */
  protected readonly bgValue = signal<UiDateFieldParts | null>(null);

  protected format(parts: UiDateFieldParts | null): string {
    if (!parts) return 'null';
    return `{ day: ${parts.day}, month: ${parts.month}, year: ${parts.year} }`;
  }
}
