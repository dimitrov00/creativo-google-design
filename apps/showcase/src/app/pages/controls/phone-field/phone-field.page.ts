import {
  ChangeDetectionStrategy,
  Component,
  WritableSignal,
  signal,
} from '@angular/core';
import { CountryIso2, toCountryIso2 } from '@creativo/domain/kernel';
import type { UiControlSize } from '@creativo/ui/controls';
import { UiPhoneField } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

const BG = unwrapCountry('BG');

function unwrapCountry(raw: string): CountryIso2 {
  const result = toCountryIso2(raw);
  if (result.isFailure()) throw new Error(`Unsupported demo country: ${raw}`);
  return result.value;
}

interface LadderEntry {
  readonly size: UiControlSize;
  readonly country: WritableSignal<CountryIso2 | undefined>;
  readonly value: WritableSignal<string | null>;
}

@Component({
  selector: 'cr-phone-field-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiFlow, UiPhoneField, UiStack, UiTextDirective],
  templateUrl: './phone-field.page.html',
  styleUrl: './phone-field.page.css',
})
export class PhoneFieldPage {
  protected readonly defaultCountry = BG;

  /** Sizes ladder — each tier keeps its own live models. */
  protected readonly ladder: LadderEntry[] = (
    ['small', 'regular', 'large'] as const
  ).map((size) => ({
    size,
    country: signal<CountryIso2 | undefined>(undefined),
    value: signal<string | null>(null),
  }));

  /** Invalid — the consumer decides: `error` is an input. */
  protected readonly invalidCountry = signal<CountryIso2 | undefined>(
    undefined,
  );
  protected readonly invalidValue = signal<string | null>(null);

  /** Disabled — the whole frame dims, trigger and input both inert. */
  protected readonly disabledCountry = signal<CountryIso2 | undefined>(
    undefined,
  );
  protected readonly disabledValue = signal<string | null>(null);

  /** Prefilled +E.164 — an external model write acts like autofill: the
   *  country re-detects and the text formats. */
  protected readonly prefilledCountry = signal<CountryIso2 | undefined>(
    undefined,
  );
  protected readonly prefilledValue = signal<string | null>('+359888123456');

  /** Picker demo — watch the two-way models react to a selection. */
  protected readonly pickerCountry = signal<CountryIso2 | undefined>(undefined);
  protected readonly pickerValue = signal<string | null>(null);

  /** Normalized-display demo — messy pastes snap to canonical grouping. */
  protected readonly normalizedCountry = signal<CountryIso2 | undefined>(
    undefined,
  );
  protected readonly normalizedValue = signal<string | null>(null);
}
