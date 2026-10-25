import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { CancellationReason } from './cancellation-reason.data';
import { CancellationReasonSet } from './cancellation-reason-set.data';

/* Moved with the name from seat-outcome.data.spec.ts (pass D, L-1 split). */

describe('CancellationReasonSet — a party’s reasons as one stored string', () => {
  it('joins distinct codes, sorted, with +', () => {
    expect(
      CancellationReasonSet.of([
        CancellationReason.Unspecified,
        CancellationReason.ClientUnwell,
        CancellationReason.ClientUnwell,
      ]),
    ).toBe('CLIENT_UNWELL+UNSPECIFIED');
    expect(
      CancellationReasonSet.of([CancellationReason.StaffShopClosure]),
    ).toBe('STAFF_SHOP_CLOSURE');
  });

  it('sorts as the lower-case stored codes sort — a legacy set keeps its bytes', () => {
    const all = Object.values(CancellationReason);
    expect(CancellationReasonSet.of(all).toLowerCase()).toBe(
      [...all]
        .map((code) => code.toLowerCase())
        .sort()
        .join('+'),
    );
  });

  it('splits back into its codes', () => {
    expect(
      CancellationReasonSet.codes(
        CancellationReasonSet.of([
          CancellationReason.StaffShopClosure,
          CancellationReason.ClientUnwell,
        ]),
      ),
    ).toEqual(['CLIENT_UNWELL', 'STAFF_SHOP_CLOSURE']);
    expect(CancellationReasonSet.codes(CancellationReasonSet.of([]))).toEqual(
      [],
    );
  });
});

describe('CancellationReasonSet — the split skips text that is no code', () => {
  it('keeps the codes and skips anything else, in stored order', () => {
    expect(
      CancellationReasonSet.codes(
        // A set from text written elsewhere: the companion's cast door.
        'CLIENT_UNWELL+client_unwell+NOT_A_CODE+OTHER' as CancellationReasonSet,
      ),
    ).toEqual(['CLIENT_UNWELL', 'OTHER']);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const reasons = deepFreeze([
      CancellationReason.Other,
      CancellationReason.ClientUnwell,
    ]);
    const set = CancellationReasonSet.of(reasons);
    expect(CancellationReasonSet.of(reasons)).toBe(set);
    expect(CancellationReasonSet.codes(set)).toEqual(
      CancellationReasonSet.codes(set),
    );
    expect(reasons).toEqual(['OTHER', 'CLIENT_UNWELL']);
  });
});
