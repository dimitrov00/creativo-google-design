import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Position } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { PositionRepository } from '../ports/position-repository.port';

export class ObserveOpenPositionsUseCase {
  constructor(private readonly positions: PositionRepository) {}

  execute(): Observable<Result<readonly Position[], RepositoryError>> {
    return this.positions.observeOpen();
  }
}
