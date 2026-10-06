/**
 * `@creativo/application/booking/testing` — TEST SUPPORT, never production
 * API.
 *
 * The availability port's executable busy contract
 * (`availabilityReaderBusyCases`) and its reference reader
 * (`InMemoryAvailabilityReader`), which every implementation's spec and the
 * booking feature's specs run. They live behind their own entry point so
 * the production barrel (`@creativo/application/booking`) cannot hand an
 * in-memory reader to a provider: the only production `AVAILABILITY_READER`
 * is the Firestore adapter (`apps/web/src/app/app.config.ts`).
 *
 * Beside it, the staff card's two readers' references
 * (`InMemoryClientHistoryReader`, `InMemoryClientPhotosReader`), which
 * answer as their Firebase adapters do, failure included, and the
 * reference of the shop-wide walk the admin's rhythm preview reads
 * (`InMemoryClientStatsDirectory`).
 */
import type { Appointment } from '@creativo/domain/scheduling';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import { subjectUserIdsOf } from './lib/ports/appointment-document';
import type { AppointmentPhoto } from './lib/ports/appointment-photos.port';
import type {
  ClientHistoryPage,
  ClientHistoryReader,
} from './lib/ports/client-history-reader.port';
import type { ClientPhotosReader } from './lib/ports/client-photos-reader.port';
import type {
  ClientStatsDirectory,
  ClientStatsPage,
} from './lib/ports/client-stats-directory.port';
import type { ClientStatsRecord } from './lib/ports/client-stats-document';

export * from './lib/ports/availability-reader.contract';

// ── The staff card's readers (client-card-redesign §6.1) ────────────────

/**
 * `ClientHistoryReader` over a list of appointments — the reference the
 * card's specs run against. It pages exactly as the Firestore adapter
 * does: every appointment with a seat for the person, newest first by the
 * stored start, strictly before the cursor, visits starting at the same
 * instant kept together, and a cursor only when something older is left.
 */
export class InMemoryClientHistoryReader implements ClientHistoryReader {
  /** Every page asked for, in order. */
  readonly calls: {
    readonly userId: string;
    readonly beforeIso: string | null;
    readonly limit: number;
  }[] = [];
  private failure: RepositoryError | null = null;

  constructor(private readonly appointments: readonly Appointment[] = []) {}

  /** Every read answers this error until `recover()` — the history's failed state. */
  failWith(error = new RepositoryError('The history is unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async pageForSubject(
    userId: string,
    page: { readonly beforeIso: string | null; readonly limit: number },
  ): Promise<Result<ClientHistoryPage, RepositoryError>> {
    this.calls.push({ userId, beforeIso: page.beforeIso, limit: page.limit });
    if (this.failure !== null) return fail(this.failure);
    const limit = Math.max(1, Math.floor(page.limit));
    const newestFirst = this.appointments
      .filter((appointment) => subjectUserIdsOf(appointment).includes(userId))
      .map((appointment) => ({
        appointment,
        startIso: appointment.timeSlot.start.toISO(),
      }))
      .filter(
        ({ startIso }) => page.beforeIso === null || startIso < page.beforeIso,
      )
      .sort((a, b) =>
        a.startIso === b.startIso
          ? byText(b.appointment.id.value, a.appointment.id.value)
          : byText(b.startIso, a.startIso),
      );
    const boundary = newestFirst[limit - 1]?.startIso;
    if (boundary === undefined || newestFirst.length === limit) {
      return ok({
        appointments: newestFirst.map((entry) => entry.appointment),
        nextBeforeIso: null,
      });
    }
    const kept = newestFirst.filter(({ startIso }) => startIso >= boundary);
    return ok({
      appointments: kept.map((entry) => entry.appointment),
      nextBeforeIso: kept.length < newestFirst.length ? boundary : null,
    });
  }
}

/**
 * `ClientPhotosReader` over a list of photos, answering as the Firebase
 * adapter does: the client's newest `limit`, then the shop's own pictures
 * set aside; counts of each visit's own photos, every asked id a key.
 */
export class InMemoryClientPhotosReader implements ClientPhotosReader {
  /** Every read, in order. */
  readonly calls: (
    | { readonly method: 'listForClient'; readonly userId: string }
    | {
        readonly method: 'countByAppointment';
        readonly appointmentIds: readonly string[];
      }
  )[] = [];
  private failure: RepositoryError | null = null;

  constructor(private readonly photos: readonly AppointmentPhoto[] = []) {}

  /** Every read answers this error until `recover()` — the rail's failed state. */
  failWith(error = new RepositoryError('The photos are unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async listForClient(
    userId: string,
    options: { readonly limit: number },
  ): Promise<Result<readonly AppointmentPhoto[], RepositoryError>> {
    this.calls.push({ method: 'listForClient', userId });
    if (this.failure !== null) return fail(this.failure);
    return ok(
      this.photos
        .filter((photo) => photo.clientUserId === userId)
        .sort((a, b) => byText(b.takenAtIso, a.takenAtIso))
        .slice(0, Math.max(0, options.limit))
        .filter((photo) => photo.origin === 'shot'),
    );
  }

  async countByAppointment(
    appointmentIds: readonly string[],
  ): Promise<Result<ReadonlyMap<string, number>, RepositoryError>> {
    this.calls.push({ method: 'countByAppointment', appointmentIds });
    if (this.failure !== null) return fail(this.failure);
    const counts = new Map(appointmentIds.map((id) => [id, 0]));
    for (const photo of this.photos) {
      const count = counts.get(photo.appointmentId);
      if (count !== undefined && photo.origin === 'shot') {
        counts.set(photo.appointmentId, count + 1);
      }
    }
    return ok(counts);
  }
}

// ── The shop's clients, walked (client-card-revision-3 §4.4) ────────────

/**
 * `ClientStatsDirectory` over a list of stats records, paged as the
 * Firestore adapter pages `clientStats`: in the order of the clients' ids,
 * strictly after the cursor, `limit` at most, and a cursor only while
 * somebody is left. One record per client: a client listed twice answers
 * with the record listed last, as a document written twice would.
 */
export class InMemoryClientStatsDirectory implements ClientStatsDirectory {
  /** Every page asked for, in order: what a spec asserts was (or was not) read. */
  readonly calls: {
    readonly limit: number;
    readonly after: string | null;
  }[] = [];
  private readonly records: readonly ClientStatsRecord[];
  private failure: RepositoryError | null = null;

  constructor(records: readonly ClientStatsRecord[] = []) {
    const byClient = new Map(
      records.map((record) => [record.userId.value, record]),
    );
    this.records = [...byClient.values()].sort((a, b) =>
      byText(a.userId.value, b.userId.value),
    );
  }

  /** Every read answers this error until `recover()`: the preview's failed state. */
  failWith(
    error = new RepositoryError('The clients’ statistics are unavailable'),
  ): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async page(
    limit: number,
    after: string | null,
  ): Promise<Result<ClientStatsPage, RepositoryError>> {
    this.calls.push({ limit, after });
    if (this.failure !== null) return fail(this.failure);
    const size = Math.max(1, Math.floor(limit));
    const left = this.records.filter(
      (record) => after === null || record.userId.value > after,
    );
    const records = left.slice(0, size);
    const last = records[records.length - 1];
    return ok({
      records,
      next: last !== undefined && left.length > size ? last.userId.value : null,
    });
  }
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
