import { describe, expect, it } from 'vitest';
import { CONFIRMED } from './appointment-status';
import {
  OFFERED_CANCELLATION_REASONS,
  cancellationReasonOf,
  seatCancelled,
  summarizeSeatOutcomes,
} from './seat-outcome';

/*
 * ── THE REASON IS OPTIONAL (owner, 2026-09-11) ─────────────────────────
 * A barber between cuts may not have the time to say why. Optional is not
 * absent: what nobody explained is filed `unspecified`, a bucket of its own,
 * so a report can count it rather than count holes.
 */
describe('cancellationReasonOf', () => {
  it('files no code as unspecified — declining to say is not an unknown code', () => {
    expect(cancellationReasonOf('', '')).toEqual({ kind: 'unspecified' });
    expect(cancellationReasonOf('  ', 'a note nobody asked for')).toEqual({
      kind: 'unspecified',
    });
    expect(cancellationReasonOf('unspecified', '')).toEqual({
      kind: 'unspecified',
    });
  });

  it('still refuses an unknown code, and `other` with nothing written', () => {
    expect(cancellationReasonOf('bogus', '')).toBeNull();
    expect(cancellationReasonOf('other', '   ')).toBeNull();
  });

  it('keeps the closed vocabulary, with a note only under `other`', () => {
    expect(cancellationReasonOf('client_unwell', 'ignored')).toEqual({
      kind: 'client_unwell',
    });
    expect(cancellationReasonOf('other', '  booked twice ')).toEqual({
      kind: 'other',
      note: 'booked twice',
    });
  });

  it('never offers unspecified as a chip — it is what picking nothing means', () => {
    expect(OFFERED_CANCELLATION_REASONS).not.toContain('unspecified');
    expect(OFFERED_CANCELLATION_REASONS).not.toContain('no_show_converted');
  });
});

describe('summarizeSeatOutcomes', () => {
  it('folds a chair cancelled seat by seat into one groupable root string, unspecified included', () => {
    const outcomes = [
      seatCancelled(2, 'client', { kind: 'client_unwell' }),
      seatCancelled(1, 'staff', { kind: 'unspecified' }),
    ];
    expect(summarizeSeatOutcomes(outcomes, CONFIRMED)).toEqual({
      kind: 'cancelled',
      reason: 'client_unwell+unspecified',
    });
  });
});
