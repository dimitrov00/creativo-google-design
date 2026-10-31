/**
 * What the admin's client card offers for a record's erasure — the field
 * `erasureOffer` (audit-hardening Phase 3 WS-D, P3-L-19, Law 10.2): a tag a
 * system DECIDES from the record's `erasureStatus`
 * (`ClientPrivacySystem.erasureOffer`) and the card's presenter only words.
 * The ONLY source of these strings; a tag dictionary only — readers use
 * `Tag.values` / `Tag.has` over it (the `OtpRefusalReason` precedent).
 */
export const ErasureOffer = {
  /** No erasure yet (`NONE`): erase the person's data. */
  Erase: 'ERASE',
  /** An erasure began and left work (`ERASING`): finish it — the same act, resumed. */
  Resume: 'RESUME',
  /** Erased (`ERASED`): sweep anything personal written since (P3-L-19). */
  Resweep: 'RESWEEP',
} as const;
export type ErasureOffer = (typeof ErasureOffer)[keyof typeof ErasureOffer];
