import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, WriteBatch } from 'firebase-admin/firestore';
import { Result, ok } from '@creativo/domain/kernel';
import {
  WaitlistRequest,
  type WaitlistStatus,
} from '@creativo/domain/scheduling';
import {
  WAITLIST_COLLECTION,
  waitlistFromDocument,
  waitlistToDocument as sharedToDocument,
} from '@creativo/application/booking';

export { WAITLIST_COLLECTION };

/**
 * One waitlist request as Firestore holds it.
 *
 * `dayKeys` is the DENORMALIZED index the matcher queries by, alongside the
 * structured `when`. It exists because a trigger firing for one barber-day has
 * to find every open request naming that day, and Firestore cannot query
 * inside a nested array of maps. Derived on write from `when`, never authored
 * — the two cannot drift because only this function produces both.
 */
/**
 * The shared document shape plus the SERVER-only TTL mirror — `purgeAt` is a
 * native Timestamp the browser never writes, so it stays out of the shared
 * module.
 */
function toDocument(request: WaitlistRequest): Record<string, unknown> {
  const props = request.toProps();
  const lastDayKey = [...props.when.days.map((day) => day.dayKey)]
    .sort()
    .at(-1);
  return {
    ...sharedToDocument(request),
    // TTL mirror: a week past its own last watched day, a request is inert
    // whatever its status — the matcher already refuses lapsed days. Enable
    // the policy on `waitlistRequests.purgeAt` at deploy time.
    purgeAt: Timestamp.fromMillis(
      new Date(`${lastDayKey ?? '1970-01-01'}T00:00:00Z`).getTime() +
        7 * 24 * 3_600_000,
    ),
  };
}

/**
 * Reads and writes for the waitlist, Admin-SDK side.
 *
 * Thin on purpose: unlike `FirestoreBookingStore` there is no transaction to
 * run here. A waitlist request races with nothing — it claims no slot, so two
 * of them arriving at once is not a conflict, it is two people waiting.
 */
export class FirestoreWaitlistStore {
  constructor(private readonly db: Firestore) {}

  async save(request: WaitlistRequest): Promise<Result<void, never>> {
    await this.db
      .collection(WAITLIST_COLLECTION)
      .doc(request.id.value)
      .set(toDocument(request));
    return ok(undefined);
  }

  /**
   * Write ONCE — `create()`, which refuses if the doc already exists.
   *
   * The request's id is a deterministic hash of its normalized content
   * (owner + days + windows + bag + shop), so "is this a duplicate?" is not
   * a question anymore — an identical request IS the same document, and the
   * existence check happens atomically inside the write. The check-then-save
   * this replaces read the owner's every live request per call and still
   * raced: two double-tapped requests could both pass the check and both
   * land, each then notifying independently.
   */
  async createOnly(request: WaitlistRequest): Promise<boolean> {
    try {
      await this.db
        .collection(WAITLIST_COLLECTION)
        .doc(request.id.value)
        .create(toDocument(request));
      return true;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 6 || code === 'already-exists') return false;
      throw error;
    }
  }

  /** Every live request naming `dayKey` — what a freed slot has to consider. */
  async openForDay(dayKey: string): Promise<readonly WaitlistRequest[]> {
    const snapshot = await this.db
      .collection(WAITLIST_COLLECTION)
      .where('status', '==', 'open')
      .where('dayKeys', 'array-contains', dayKey)
      .get();

    return snapshot.docs
      .map((doc) => waitlistFromDocument(doc.id, doc.data()))
      .filter((request): request is WaitlistRequest => request !== null);
  }

  async updateStatus(
    request: WaitlistRequest,
    status: WaitlistStatus,
  ): Promise<void> {
    await this.db
      .collection(WAITLIST_COLLECTION)
      .doc(request.id.value)
      .update({ status });
  }

  /** The same transition, staged into a caller-owned batch — see `deliverInto`. */
  updateStatusInto(
    batch: WriteBatch,
    request: WaitlistRequest,
    status: WaitlistStatus,
  ): void {
    batch.update(
      this.db.collection(WAITLIST_COLLECTION).doc(request.id.value),
      { status },
    );
  }
}
