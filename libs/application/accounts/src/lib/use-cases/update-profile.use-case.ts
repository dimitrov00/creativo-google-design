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
  readonly firstName: FirstName;
  readonly lastName: LastName;
  readonly today: ZonedDateTime;
}

/** Loads the current profile and rebuilds it through `User.create` with the new name — the domain's own validating door, not a partial patch. */
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

    const rebuiltResult = User.create(
      {
        id: current.id.value,
        phone: current.phone.value,
        firstName: input.firstName.value,
        lastName: input.lastName.value,
        roles: [...current.roles],
        status: current.status,
        ...(current.email && { email: current.email.value }),
        ...(current.birthDate && { birthDate: current.birthDate.toISODate() }),
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
