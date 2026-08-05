import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { Otp, OtpId } from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';
import { OtpDestination } from './otp-destination';

export interface OtpRepositoryPort {
  save(otp: Otp): Promise<Result<void, RepositoryError>>;
  findById(id: OtpId): Promise<Result<Otp | null, RepositoryError>>;
  findRecentUnconsumedByDestination(
    destination: OtpDestination,
    since: ZonedDateTime,
  ): Promise<Result<boolean, RepositoryError>>;

  /**
   * Read, decide, write — ATOMICALLY.
   *
   * `decide` receives the current OTP (or `null`) and returns what to
   * persist, or `null` to write nothing. The adapter runs the whole exchange
   * inside a transaction and may invoke `decide` more than once on
   * contention, so it must be pure over its argument.
   *
   * This exists for verification: a plain find-then-save let N parallel
   * wrong guesses all read `attemptCount: 0` and all persist `1`, so the
   * lockout a brute-forcer is supposed to hit never accrued. The same shape
   * `FirestoreBookingStore.commit` uses, one aggregate over.
   */
  update(
    id: OtpId,
    decide: (otp: Otp | null) => Otp | null,
  ): Promise<Result<Otp | null, RepositoryError>>;
}
