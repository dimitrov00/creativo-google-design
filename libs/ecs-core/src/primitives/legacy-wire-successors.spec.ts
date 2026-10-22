import { describe, expect, it } from 'vitest';
import { BookingErrorCode } from './booking-errors.data';
import { CancellationRefusalCode } from './cancellation-errors.data';
import {
  GovernanceErrorCode,
  RunBackfillRefusalCode,
} from './governance-errors.data';
import {
  CompleteRegistrationRefusalCode,
  IdentityErrorCode,
} from './identity-errors.data';
import { PhoneErrorCode } from './phone-errors.data';
import { StreakPublishErrorCode } from './streak-publish-errors.data';
import { CancelWaitlistRefusalCode } from './waitlist-errors.data';

/*
 * THE LEGACY WIRE'S SUCCESSORS (Phase 4a §3.1, 4A-4) — the ledger of every
 * live `LegacyWireCode` of `apps/functions/src/edge.ts` (the codes a
 * decoder or a callable refusal function still raised on `e9d1ca4`), as the
 * dotted string literal it left as, → the SCREAMING code that succeeds it
 * and the domain dictionary that holds it. No transport-named catch-all
 * exists (no `callable-errors.data.ts`): each successor lives in ITS
 * domain's dictionary — an existing code where one already meant the same
 * (the reverse of `LEGACY_WIRE_CODE`'s pairing: `otp_locked_out` ↔
 * `IDENTITY_OTP_LOCKED_OUT`, the waitlist cancel's, the backfill's, the
 * registration aggregate's), else a new one, the dotted code in SCREAMING.
 * The seven rows no handler raises any more get none (`dead:` below); the
 * edge spec's `LegacyWireCode` cases land here (§11).
 */

const DICTIONARIES = {
  BookingErrorCode,
  CancellationRefusalCode,
  CancelWaitlistRefusalCode,
  CompleteRegistrationRefusalCode,
  GovernanceErrorCode,
  IdentityErrorCode,
  PhoneErrorCode,
  RunBackfillRefusalCode,
  StreakPublishErrorCode,
} as const;
type DictionaryName = keyof typeof DICTIONARIES;

/** [the legacy wire code, its successor, the dictionary holding it] */
const SUCCESSORS: readonly (readonly [string, string, DictionaryName])[] = [
  // booking — the callables' inline throws
  ['booking.commit.forbidden', 'BOOKING_COMMIT_FORBIDDEN', 'BookingErrorCode'],
  [
    'booking.commit.store_failed',
    'BOOKING_COMMIT_STORE_FAILED',
    'BookingErrorCode',
  ],
  [
    'booking.cancel.unauthenticated',
    'BOOKING_CANCEL_UNAUTHENTICATED',
    'CancellationRefusalCode',
  ],
  [
    'booking.cancel.invalid_input',
    'BOOKING_CANCEL_INVALID_INPUT',
    'CancellationRefusalCode',
  ],
  [
    'booking.cancel.not_found',
    'BOOKING_CANCEL_NOT_FOUND',
    'CancellationRefusalCode',
  ],
  [
    'booking.waitlist.not_found',
    'BOOKING_WAITLIST_NOT_FOUND',
    'CancelWaitlistRefusalCode',
  ],
  [
    'booking.waitlist.not_cancellable',
    'BOOKING_WAITLIST_NOT_CANCELLABLE',
    'CancelWaitlistRefusalCode',
  ],
  [
    'booking.transition.unauthenticated',
    'BOOKING_TRANSITION_UNAUTHENTICATED',
    'BookingErrorCode',
  ],
  [
    'booking.transition.forbidden',
    'BOOKING_TRANSITION_FORBIDDEN',
    'BookingErrorCode',
  ],
  [
    'booking.transition.invalid_input',
    'BOOKING_TRANSITION_INVALID_INPUT',
    'BookingErrorCode',
  ],
  [
    'booking.transition.not_found',
    'BOOKING_TRANSITION_NOT_FOUND',
    'BookingErrorCode',
  ],
  [
    'booking.transition.not_allowed',
    'BOOKING_TRANSITION_NOT_ALLOWED',
    'BookingErrorCode',
  ],
  [
    'booking.transition.reopen_window_closed',
    'BOOKING_TRANSITION_REOPEN_WINDOW_CLOSED',
    'BookingErrorCode',
  ],
  [
    'booking.transition.slot_taken',
    'BOOKING_TRANSITION_SLOT_TAKEN',
    'BookingErrorCode',
  ],
  [
    'booking.arrived.unauthenticated',
    'BOOKING_ARRIVED_UNAUTHENTICATED',
    'BookingErrorCode',
  ],
  [
    'booking.arrived.forbidden',
    'BOOKING_ARRIVED_FORBIDDEN',
    'BookingErrorCode',
  ],
  [
    'booking.arrived.invalid_input',
    'BOOKING_ARRIVED_INVALID_INPUT',
    'BookingErrorCode',
  ],
  [
    'booking.arrived.not_found',
    'BOOKING_ARRIVED_NOT_FOUND',
    'BookingErrorCode',
  ],
  [
    'booking.arrived.not_allowed',
    'BOOKING_ARRIVED_NOT_ALLOWED',
    'BookingErrorCode',
  ],
  [
    'booking.tip.unauthenticated',
    'BOOKING_TIP_UNAUTHENTICATED',
    'BookingErrorCode',
  ],
  ['booking.tip.forbidden', 'BOOKING_TIP_FORBIDDEN', 'BookingErrorCode'],
  [
    'booking.tip.invalid_input',
    'BOOKING_TIP_INVALID_INPUT',
    'BookingErrorCode',
  ],
  ['booking.tip.not_found', 'BOOKING_TIP_NOT_FOUND', 'BookingErrorCode'],
  // ops
  [
    'ops.backfill.unauthenticated',
    'OPS_BACKFILL_UNAUTHENTICATED',
    'RunBackfillRefusalCode',
  ],
  [
    'ops.backfill.forbidden',
    'OPS_BACKFILL_FORBIDDEN',
    'RunBackfillRefusalCode',
  ],
  [
    'ops.backfill.invalid_input',
    'OPS_BACKFILL_INVALID_INPUT',
    'RunBackfillRefusalCode',
  ],
  // loyalty — the streak publish's faults and its legacy-only refusal
  [
    'loyalty.streak_publish.unauthenticated',
    'LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED',
    'StreakPublishErrorCode',
  ],
  [
    'loyalty.streak_publish.invalid_input',
    'LOYALTY_STREAK_PUBLISH_INVALID_INPUT',
    'StreakPublishErrorCode',
  ],
  [
    'loyalty.streak_publish.store_failed',
    'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
    'StreakPublishErrorCode',
  ],
  [
    'loyalty.streak_publish.not_admin',
    'LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN',
    'StreakPublishErrorCode',
  ],
  // identity — the undotted codes of the OTP and registration callables
  ['invalid_input', 'IDENTITY_INVALID_INPUT', 'IdentityErrorCode'],
  ['repository_failure', 'IDENTITY_REPOSITORY_FAILURE', 'IdentityErrorCode'],
  [
    'otp_channel_mismatch',
    'IDENTITY_OTP_CHANNEL_MISMATCH',
    'IdentityErrorCode',
  ],
  ['otp_rate_limited', 'IDENTITY_OTP_RATE_LIMITED', 'IdentityErrorCode'],
  ['otp_send_failure', 'IDENTITY_OTP_SEND_FAILURE', 'IdentityErrorCode'],
  ['otp_not_found', 'IDENTITY_OTP_NOT_FOUND', 'IdentityErrorCode'],
  [
    'otp_already_consumed',
    'IDENTITY_OTP_ALREADY_CONSUMED',
    'IdentityErrorCode',
  ],
  ['otp_expired', 'IDENTITY_OTP_EXPIRED', 'IdentityErrorCode'],
  ['otp_locked_out', 'IDENTITY_OTP_LOCKED_OUT', 'IdentityErrorCode'],
  ['otp_incorrect_code', 'IDENTITY_OTP_WRONG_CODE', 'IdentityErrorCode'],
  [
    'otp_destination_corrupted',
    'IDENTITY_OTP_DESTINATION_CORRUPTED',
    'IdentityErrorCode',
  ],
  [
    'token_minting_failure',
    'IDENTITY_TOKEN_MINTING_FAILURE',
    'IdentityErrorCode',
  ],
  [
    'registration_unauthenticated',
    'IDENTITY_REGISTRATION_UNAUTHENTICATED',
    'IdentityErrorCode',
  ],
  [
    'registration_forbidden',
    'IDENTITY_REGISTRATION_FORBIDDEN',
    'IdentityErrorCode',
  ],
  [
    'registration_field_missing',
    'IDENTITY_REGISTRATION_FIELD_MISSING',
    'IdentityErrorCode',
  ],
  [
    'registration_birth_date_invalid',
    'IDENTITY_REGISTRATION_BIRTH_DATE_INVALID',
    'IdentityErrorCode',
  ],
  [
    'registration_user_not_found',
    'IDENTITY_REGISTRATION_USER_NOT_FOUND',
    'IdentityErrorCode',
  ],
  [
    'user_validation_failed',
    'IDENTITY_REGISTRATION_PROFILE_INVALID',
    'CompleteRegistrationRefusalCode',
  ],
  [
    'claims_promotion_failure',
    'IDENTITY_CLAIMS_PROMOTION_FAILURE',
    'IdentityErrorCode',
  ],
  // nested — rode only inside an aggregate's `details.errors[]`
  ['phone_number_invalid', 'PHONE_INVALID', 'PhoneErrorCode'],
  [
    'accounts.birth_date.invalid',
    'IDENTITY_BIRTH_DATE_INVALID',
    'IdentityErrorCode',
  ],
  [
    'accounts.birth_date.too_young',
    'IDENTITY_BIRTH_DATE_TOO_YOUNG',
    'IdentityErrorCode',
  ],
  [
    'accounts.birth_date.too_old',
    'IDENTITY_BIRTH_DATE_TOO_OLD',
    'IdentityErrorCode',
  ],
];

/**
 * dead: the seven rows no handler raised on `e9d1ca4` (their handlers gone
 * with flips 1–3; `edge.spec.ts` kept them pinned until Phase 4) — no
 * successor, no `errors.<CODE>` key.
 */
const DEAD: readonly string[] = [
  'otp_validation_failed',
  'otp_destination_empty',
  'invalid_otp_max_attempts',
  'empty_id',
  'invalid_date_time',
  'accounts.id.empty',
  'invalid_time_zone',
];

describe('the legacy wire codes’ successors — one per live code, in its domain’s dictionary', () => {
  it.each(SUCCESSORS)('%s → %s (%s)', (_legacy, successor, dictionary) => {
    const values: readonly string[] = Object.values(DICTIONARIES[dictionary]);
    expect(values).toContain(successor);
  });

  it('is total over the 53 live codes of the legacy table, each once; the seven dead ones get none', () => {
    const legacy = SUCCESSORS.map(([code]) => code);
    expect(new Set(legacy).size).toBe(legacy.length);
    expect(legacy).toHaveLength(53);
    expect(legacy.length + DEAD.length).toBe(60);
    for (const dead of DEAD) expect(legacy).not.toContain(dead);
  });

  it('never folds two legacy meanings into one code — each successor serves one legacy code', () => {
    const shared = new Map<string, string[]>();
    for (const [legacy, successor] of SUCCESSORS) {
      shared.set(successor, [...(shared.get(successor) ?? []), legacy]);
    }
    for (const [successor, legacies] of shared) {
      expect(legacies, successor).toHaveLength(1);
    }
  });

  it('spells every successor SCREAMING and domain-prefixed — never a transport-named catch-all', () => {
    for (const [, successor] of SUCCESSORS) {
      expect(successor).toMatch(
        /^(BOOKING|OPS|LOYALTY|IDENTITY|PHONE|GOVERNANCE)_[A-Z0-9_]+$/,
      );
      expect(successor).not.toMatch(/^(CALLABLE|WIRE|LEGACY)_/);
    }
  });
});
