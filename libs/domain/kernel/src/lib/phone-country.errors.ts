import { DomainError } from './domain-error';

export class CountryUnsupportedError extends DomainError {
  readonly code = 'country_unsupported' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a supported ISO 3166-1 alpha-2 country code`, {
      attempted,
    });
  }
}
