import { DomainError } from '@creativo/domain/kernel';

export class LocalizedTextFieldEmptyError extends DomainError {
  readonly code = 'catalog.localized_text.field_empty' as const;
  constructor(public readonly locale: 'en' | 'bg') {
    super(`Localized text "${locale}" field cannot be empty`, { locale });
  }
}
