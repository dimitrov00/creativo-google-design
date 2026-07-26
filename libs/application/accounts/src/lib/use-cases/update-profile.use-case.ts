import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { FirstName, LastName, User, UserId } from '@creativo/domain/accounts';
import { ProfilePort } from '../ports/profile.port';
import {
  ProfileNotFoundError,
  UpdateProfileError,
  UpdateProfileRepositoryFailure,
  UpdateProfileValidationFailure,
} from './update-profile.errors';

export interface UpdateProfileInput {
  readonly userId: UserId;
  /** Omitted fields keep their current profile value — a birthday-only save (onboarding's personalization step) never has to re-supply the names. */
  readonly firstName?: FirstName;
  readonly lastName?: LastName;
  /**
   * OPTIONAL birthday as ISO `YYYY-MM-DD` (the wire/persistence format the
   * onboarding birthday step derives from its own `BirthDate` VO).
   * Validated here through `User.create`'s domain door — the accounts
   * `BirthDate.create` re-checks calendar reality and the 16–120 age
   * window before anything reaches the port. Omitted → the stored value
   * (if any) is preserved untouched.
   */
  readonly birthDate?: string;
  readonly today: ZonedDateTime;
}

/** Loads the current profile and rebuilds it through `User.create` with the changed fields — the domain's own validating door, not a partial patch. */
export class UpdateProfileUseCase {
  constructor(private readonly profiles: ProfilePort) {}

  async execute(
    input: UpdateProfileInput,
  ): Promise<Result<User, UpdateProfileError>> {
    const foundResult = await this.profiles.getProfile(input.userId);
    if (foundResult.isFailure()) {
      return fail(new UpdateProfileRepositoryFailure(foundResult.error));
    }
    const current = foundResult.value;
    if (!current) {
      return fail(new ProfileNotFoundError());
    }

    const birthDate = input.birthDate ?? current.birthDate?.toISODate();
    const rebuiltResult = User.create(
      {
        id: current.id.value,
        phone: current.phone.value,
        firstName: (input.firstName ?? current.firstName).value,
        lastName: (input.lastName ?? current.lastName).value,
        roles: [...current.roles],
        status: current.status,
        ...(current.email && { email: current.email.value }),
        ...(birthDate !== undefined && { birthDate }),
      },
      input.today,
    );
    if (rebuiltResult.isFailure()) {
      return fail(new UpdateProfileValidationFailure(rebuiltResult.error));
    }
    const updated = rebuiltResult.value;

    const saveResult = await this.profiles.saveProfile(updated);
    if (saveResult.isFailure()) {
      return fail(new UpdateProfileRepositoryFailure(saveResult.error));
    }

    return ok(updated);
  }
}
