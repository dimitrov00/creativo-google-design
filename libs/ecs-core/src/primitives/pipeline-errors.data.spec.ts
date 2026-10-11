import { describe, expect, it } from 'vitest';
import { PipelineError, PipelineErrorCode } from './pipeline-errors.data';

describe('PipelineError', () => {
  it('uses the SCREAMING PIPELINE_* codes the UI translates as errors.<errorCode>', () => {
    expect(Object.values(PipelineErrorCode)).toEqual([
      'PIPELINE_UNAUTHENTICATED',
      'PIPELINE_SLOT_UNAVAILABLE',
      'PIPELINE_CATALOG_CHANGED',
      'PIPELINE_INVALID_REQUEST',
      'PIPELINE_UNAVAILABLE',
      'PIPELINE_UNKNOWN',
    ]);
  });

  it('carries the server wire code and its reason as i18n parameters', () => {
    expect(
      PipelineError.of(
        PipelineErrorCode.SlotUnavailable,
        'booking.reschedule.carried_seat_unplaceable',
        'barber_unavailable',
        null,
      ),
    ).toEqual({
      errorCode: 'PIPELINE_SLOT_UNAVAILABLE',
      serverErrorCode: 'booking.reschedule.carried_seat_unplaceable',
      refusal: 'barber_unavailable',
      field: null,
    });
  });

  it('bare() has one shape with every detail null', () => {
    expect(PipelineError.bare(PipelineErrorCode.Unavailable)).toEqual({
      errorCode: 'PIPELINE_UNAVAILABLE',
      serverErrorCode: null,
      refusal: null,
      field: null,
    });
  });

  it('is() compares the code', () => {
    const error = PipelineError.bare(PipelineErrorCode.Unauthenticated);
    expect(PipelineError.is(error, PipelineErrorCode.Unauthenticated)).toBe(
      true,
    );
    expect(PipelineError.is(error, PipelineErrorCode.Unknown)).toBe(false);
  });
});
