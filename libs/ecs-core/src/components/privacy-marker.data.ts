import { defect } from '@core/primitives';
import { SeatLabel } from './seat-label.data';

/** The one pseudonym mark — an em dash, language-neutral (P3-RU-23). */
const TEXT = '—';

/** A walk-in seat's mark: the dash, one space, a 1-based ordinal (`— 1`, `— 12`). */
const SEAT_LABEL = /^— [1-9][0-9]*$/;

/**
 * THE PSEUDONYM MARKER (audit-hardening Phase 3, P3-RU-23) — what a
 * person's cleared value is replaced by where a value must stay: an em dash,
 * never a word. Copy in stored data would bypass i18n and print raw on the
 * day grid, so screens word the record's TAG («Изтрит клиент»), never this
 * mark. A required string (`customers.displayName`, an account's names,
 * `invitations.inviterName`) becomes {@link PrivacyMarker.TEXT}; a walk-in
 * seat's label becomes `— <n>` ({@link PrivacyMarker.seatLabel}), unique per
 * visit so no two seats share a label; a nullable field becomes `null`.
 * The export (WS-C) marks the other people's seats of a shared visit the
 * same way.
 */
export type PrivacyMarker = typeof TEXT;

export const PrivacyMarker = {
  /** The mark a cleared required string holds. */
  TEXT,

  /**
   * A walk-in seat's marked label — `— <ordinal>`, the seat's 1-based
   * ordinal among its visit's marked seats — through `SeatLabel`'s own smart
   * constructor (the cast stays in its file, Law 7.4). An ordinal that is no
   * positive whole number is a programmer defect, never a value.
   */
  seatLabel(ordinal: number): SeatLabel {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      return defect(
        `PrivacyMarker.seatLabel: not a 1-based ordinal: ${ordinal}`,
      );
    }
    const label = SeatLabel.parse(`${TEXT} ${ordinal}`);
    return label.ok
      ? label.value
      : defect(`PrivacyMarker.seatLabel: ${label.error.errorCode}`);
  },

  /** Whether a text is a mark — {@link PrivacyMarker.TEXT} or a `— <n>` seat label: no personal value. */
  isMarker(text: string): boolean {
    return text === TEXT || SEAT_LABEL.test(text);
  },
} as const;
