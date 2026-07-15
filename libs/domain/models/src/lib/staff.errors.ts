import { DomainError } from '@creativo/domain/kernel';
import {
  InvalidTimeOfDayError,
  InvalidWorkingHoursRangeError,
} from './working-hours.errors';
import { EmptyIdError } from './ids.errors';

export class EmptyStaffDisplayNameError extends DomainError {
  readonly code = 'staff_display_name_empty' as const;
  constructor() {
    super('Staff display name cannot be empty');
  }
}

export type StaffValidationError =
  | EmptyIdError
  | EmptyStaffDisplayNameError
  | InvalidTimeOfDayError
  | InvalidWorkingHoursRangeError;
