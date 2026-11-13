import { Pipe, type PipeTransform, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { StaffBlockFailure } from '@core/errors';
import { translateCodedError } from '@creativo/infrastructure/i18n';
import { blockFailureSentence } from './staff-day-error.words';

/**
 * `failure | staffBlockFailure: 'staff.day.blockFailed'` — why a block, a
 * day's breaks or the hours did not save, as the one line its sheet
 * prints: the server's refusal in the catalogue's words when it has them
 * (`blockFailureSentence`), else the sheet's own generic line (`genericKey`).
 * `null` in, `null` out — nothing has failed.
 */
@Pipe({ name: 'staffBlockFailure' })
export class StaffBlockFailurePipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);

  transform(
    failure: StaffBlockFailure | null,
    genericKey: string,
  ): string | null {
    if (failure === null) return null;
    return blockFailureSentence(
      failure,
      (code, params) =>
        translateCodedError(this.transloco, { ...params, errorCode: code }),
      this.transloco.translate(genericKey),
    );
  }
}
