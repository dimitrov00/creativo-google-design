import { describe, expect, it } from 'vitest';
import { PipelineError, PipelineErrorCode } from './pipeline-errors.data';

describe('PipelineError', () => {
  it('uses the dotted pipeline.* codes the UI translates', () => {
    expect(Object.values(PipelineErrorCode)).toEqual([
      'pipeline.unauthenticated',
      'pipeline.slot_unavailable',
      'pipeline.catalog_changed',
      'pipeline.invalid_request',
      'pipeline.unavailable',
      'pipeline.unknown',
    ]);
  });

  it('carries the server code and its reason as i18n parameters', () => {
    expect(
      PipelineError.of(
        PipelineErrorCode.SlotUnavailable,
        'booking.reschedule.carried_seat_unplaceable',
        'barber_unavailable',
        null,
      ),
    ).toEqual({
      code: 'pipeline.slot_unavailable',
      serverCode: 'booking.reschedule.carried_seat_unplaceable',
      refusal: 'barber_unavailable',
      field: null,
    });
  });

  it('bare() has one shape with every detail null', () => {
    expect(PipelineError.bare(PipelineErrorCode.Unavailable)).toEqual({
      code: 'pipeline.unavailable',
      serverCode: null,
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
