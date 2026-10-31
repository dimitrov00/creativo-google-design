import { describe, expect, it } from 'vitest';
import { unwrapOk } from '@core/testing';
import { PrivacyMarker } from './privacy-marker.data';
import { SeatLabel } from './seat-label.data';

/* The one pseudonym marker (audit-hardening Phase 3, P3-RU-23): an em dash,
 * never a word, and a walk-in seat's `— <n>` label through SeatLabel's own
 * smart constructor. */

describe('PrivacyMarker', () => {
  it('TEXT is the em dash alone — language-neutral, no copy in stored data', () => {
    expect(PrivacyMarker.TEXT).toBe('—');
    expect(PrivacyMarker.TEXT).toBe('—');
    expect(PrivacyMarker.TEXT).toHaveLength(1);
  });

  it('seatLabel(1…3) answers valid SeatLabels, distinct per ordinal', () => {
    const labels = [1, 2, 3].map((ordinal) => PrivacyMarker.seatLabel(ordinal));
    expect(labels).toEqual(['— 1', '— 2', '— 3']);
    for (const label of labels) {
      // A label the edge guard admits as it is: trimmed, non-blank, short.
      expect(unwrapOk(SeatLabel.parse(label))).toBe(label);
    }
    expect(new Set(labels).size).toBe(3);
    expect(PrivacyMarker.seatLabel(12)).toBe('— 12');
  });

  it('seatLabel refuses an ordinal that is no positive whole number — a defect, not a value', () => {
    for (const ordinal of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => PrivacyMarker.seatLabel(ordinal)).toThrow(
        /not a 1-based ordinal/,
      );
    }
  });

  it('isMarker knows the dash and every seat label it builds, and nothing personal', () => {
    expect(PrivacyMarker.isMarker(PrivacyMarker.TEXT)).toBe(true);
    for (const ordinal of [1, 2, 9, 10, 431]) {
      expect(PrivacyMarker.isMarker(PrivacyMarker.seatLabel(ordinal))).toBe(
        true,
      );
    }
    for (const text of [
      '',
      ' ',
      '-',
      '— ',
      '—1',
      '— 0',
      '— 01',
      '— 1 ',
      ' —',
      '— a',
      'Sentinel Label',
      'Walk-in 14:30',
      '— Sentinel',
    ]) {
      expect(PrivacyMarker.isMarker(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('is pure: the same ordinal answers the same label, every time', () => {
    expect(PrivacyMarker.seatLabel(4)).toBe(PrivacyMarker.seatLabel(4));
    expect(PrivacyMarker.isMarker('— 4')).toBe(PrivacyMarker.isMarker('— 4'));
  });
});
