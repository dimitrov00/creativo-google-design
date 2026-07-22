import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { User, UserId } from '@creativo/domain/accounts';
import { ProfilePort } from '../ports/profile.port';
import { ContactChangePort } from '../ports/contact-change.port';
import { ContactChangeRequestId } from '../ports/contact-change.port';
import { ContactChangeTarget } from '../ports/contact-change-target';
import { ConfirmationCode } from '../ports/confirmation-code';
import {
  ConfirmContactChangeError,
  ConfirmContactChangeFailure,
  ConfirmContactChangeProfileNotFoundError,
  ConfirmContactChangeRepositoryFailure,
  ConfirmContactChangeValidationFailure,
} from './confirm-contact-change.errors';

export interface ConfirmContactChangeInput {
  readonly userId: UserId;
  readonly requestId: ContactChangeRequestId;
  readonly code: ConfirmationCode;
  readonly target: ContactChangeTarget;
  readonly today: ZonedDateTime;
}

/**
 * Confirms the pending change with the backend (`ContactChangePort`), then
 * rebuilds and saves the local `User` snapshot (`ProfilePort`) so the
 * client's own cached profile reflects the new contact immediately,
 * without waiting on a separate live-read to catch up.
 */
export class ConfirmContactChangeUseCase {
  constructor(
    private readonly contactChange: ContactChangePort,
    private readonly profiles: ProfilePort,
  ) {}

  async execute(
    input: ConfirmContactChangeInput,
  ): Promise<Result<User, ConfirmContactChangeError>> {
    const confirmResult = await this.contactChange.confirmChange(
      input.userId,
      input.requestId,
      input.code,
    );
    if (confirmResult.isFailure()) {
      return fail(new ConfirmContactChangeFailure(confirmResult.error));
    }

    const foundResult = await this.profiles.getProfile(input.userId);
    if (foundResult.isFailure()) {
      return fail(new ConfirmContactChangeRepositoryFailure(foundResult.error));
    }
    const current = foundResult.value;
    if (!current) {
      return fail(new ConfirmContactChangeProfileNotFoundError());
    }

    const rebuiltResult = User.create(
      {
        id: current.id.value,
        phone:
          input.target.kind === 'phone'
            ? input.target.phone.value
            : current.phone.value,
        firstName: current.firstName.value,
        lastName: current.lastName.value,
        roles: [...current.roles],
        status: current.status,
        email:
          input.target.kind === 'email'
            ? input.target.email.value
            : current.email?.value,
        ...(current.birthDate && { birthDate: current.birthDate.toISODate() }),
      },
      input.today,
    );
    if (rebuiltResult.isFailure()) {
      return fail(
        new ConfirmContactChangeValidationFailure(rebuiltResult.error),
      );
    }
    const updated = rebuiltResult.value;

    const saveResult = await this.profiles.saveProfile(updated);
    if (saveResult.isFailure()) {
      return fail(new ConfirmContactChangeRepositoryFailure(saveResult.error));
    }

    return ok(updated);
  }
}
