import { Result, fail, ok } from '@creativo/domain/kernel';
import { Position, PositionStatus } from '@creativo/domain/programs';
import { IdGenerator } from '@creativo/application/shared';
import { PositionRepository } from '../ports/position-repository.port';
import {
  CreatePositionError,
  CreatePositionRepositoryFailure,
  CreatePositionValidationFailure,
} from './create-position.errors';

export interface CreatePositionInput {
  readonly title: { readonly en: string; readonly bg: string };
  readonly summary: { readonly en: string; readonly bg: string };
  readonly locationIds: readonly string[];
  readonly status: PositionStatus;
  readonly applyUrl?: string;
  readonly sortOrder: number;
}

export class CreatePositionUseCase {
  constructor(
    private readonly positions: PositionRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: CreatePositionInput,
  ): Promise<Result<Position, CreatePositionError>> {
    const positionResult = Position.create({
      id: this.idGenerator.next(),
      ...input,
    });
    if (positionResult.isFailure()) {
      return fail(new CreatePositionValidationFailure(positionResult.error));
    }
    const position = positionResult.value;

    const saveResult = await this.positions.save(position);
    if (saveResult.isFailure()) {
      return fail(new CreatePositionRepositoryFailure(saveResult.error));
    }

    return ok(position);
  }
}
