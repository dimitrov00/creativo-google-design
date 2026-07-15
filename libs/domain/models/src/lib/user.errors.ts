import { DomainError } from '@creativo/domain/kernel';
import { InvalidEmailError } from './email.errors';
import { EmptyIdError } from './ids.errors';

export class EmptyReferralCodeError extends DomainError {
  readonly code = 'referral_code_empty' as const;
  constructor() {
    super('Referral code cannot be empty');
  }
}

export class NegativeGamificationPointsError extends DomainError {
  readonly code = 'gamification_points_negative' as const;
  constructor(public readonly rawValue: number) {
    super(`Gamification points cannot be negative: ${rawValue}`, { rawValue });
  }
}

export type UserValidationError =
  | EmptyIdError
  | InvalidEmailError
  | EmptyReferralCodeError
  | NegativeGamificationPointsError;
