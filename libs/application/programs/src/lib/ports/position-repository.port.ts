import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Position, PositionId } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export interface PositionRepository {
  findById(id: PositionId): Promise<Result<Position | null, RepositoryError>>;
  save(position: Position): Promise<Result<void, RepositoryError>>;
  /** Live open positions, careers-page order. */
  observeOpen(): Observable<Result<readonly Position[], RepositoryError>>;
  /** Live positions regardless of status — the admin view, which manages closed roles too (e.g. reopening one). */
  observeAll(): Observable<Result<readonly Position[], RepositoryError>>;
}

export const POSITION_REPOSITORY = new InjectionToken<PositionRepository>(
  'PositionRepository',
);
