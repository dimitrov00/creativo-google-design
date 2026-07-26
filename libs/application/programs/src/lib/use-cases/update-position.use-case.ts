import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Position,
  PositionId,
  PositionStatus,
} from '@creativo/domain/programs';
import { PositionRepository } from '../ports/position-repository.port';
import {
  PositionNotFoundError,
  UpdatePositionError,
  UpdatePositionRepositoryFailure,
  UpdatePositionValidationFailure,
} from './update-position.errors';

export interface UpdatePositionInput {
  readonly id: PositionId;
  readonly title: { readonly en: string; readonly bg: string };
  readonly summary: { readonly en: string; readonly bg: string };
  readonly locationIds: readonly string[];
  readonly status: PositionStatus;
  readonly applyUrl?: string;
  readonly sortOrder: number;
}

/** The admin form submits the full edited record (this entity has no
 *  server-managed fields the client shouldn't touch), so this rebuilds
 *  through `Position.create` directly rather than merging onto a loaded
 *  current entity — the `findById` below only confirms the position still
 *  exists before an update masquerades as a silent create. */
export class UpdatePositionUseCase {
  constructor(private readonly positions: PositionRepository) {}

  async execute(
    input: UpdatePositionInput,
  ): Promise<Result<Position, UpdatePositionError>> {
    const foundResult = await this.positions.findById(input.id);
    if (foundResult.isFailure()) {
      return fail(new UpdatePositionRepositoryFailure(foundResult.error));
    }
    if (!foundResult.value) {
      return fail(new PositionNotFoundError());
    }

    const rebuiltResult = Position.create({
      id: input.id.value,
      title: input.title,
      summary: input.summary,
      locationIds: input.locationIds,
      status: input.status,
      ...(input.applyUrl !== undefined && { applyUrl: input.applyUrl }),
      sortOrder: input.sortOrder,
    });
    if (rebuiltResult.isFailure()) {
      return fail(new UpdatePositionValidationFailure(rebuiltResult.error));
    }
    const updated = rebuiltResult.value;

    const saveResult = await this.positions.save(updated);
    if (saveResult.isFailure()) {
      return fail(new UpdatePositionRepositoryFailure(saveResult.error));
    }

    return ok(updated);
  }
}
