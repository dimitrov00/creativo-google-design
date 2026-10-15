import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { firstValueFrom } from 'rxjs';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  BusyKey,
  CustomerId,
  UserId,
} from '@core/primitives';
import { localDate, utcMs } from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { appointmentReadPorts } from './appointments.adapter';

const GEORGI = CustomerId.of('cus_georgi');
const MARTIN = CustomerId.of('cus_martin');
const IVAN_MONDAY = BusyKey.of(BarberId.of('ivan'), localDate('2026-09-28'));

/** The query keys of a stored visit — what every query and rule here reads. */
function visit(fields: {
  readonly at: string;
  readonly owner?: string;
  readonly subjects?: readonly CustomerId[];
  readonly status?: BookingStatus;
  readonly busyKeys?: readonly string[];
}) {
  return {
    locationId: 'loc-center',
    ownerUserId: fields.owner ?? 'u-georgi',
    subjectUserIds: [fields.owner ?? 'u-georgi'],
    subjectCustomerIds: fields.subjects ?? [GEORGI],
    barberIds: ['ivan'],
    busyKeys: fields.busyKeys ?? [],
    bookingStatus: fields.status ?? BookingStatus.Confirmed,
    utcEpochMs: utcMs(fields.at),
  };
}

const portsFor = (context: RulesTestContext) =>
  appointmentReadPorts(modularFirestore(context));

describe('appointmentReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  /** Visits written the way the server does — rules off, the flat body. */
  async function seed(visits: Readonly<Record<string, object>>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      for (const [id, body] of Object.entries(visits)) {
        await setDoc(doc(db, 'appointments', id), body);
      }
    });
  }

  const client = (uid = 'u-georgi') =>
    testEnv.authenticatedContext(uid, { roles: ['client'] });
  const barber = () =>
    testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] });

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-appointments');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('a client’s own visits', () => {
    it('a client reads back their own server-written appointment', async () => {
      await seed({ 'appt-own': visit({ at: '2026-10-20T10:00:00+03:00' }) });

      const found = await firstValueFrom(
        portsFor(client()).observeAppointment(AppointmentId.of('appt-own')),
      );

      expect(found.ok && found.value?.id).toBe('appt-own');
    });

    it('observeUpcoming emits only the requesting account’s own live appointments, by start — index #6', async () => {
      await seed({
        'appt-later': visit({ at: '2026-11-02T10:00:00+02:00' }),
        'appt-sooner': visit({
          at: '2026-10-20T10:00:00+03:00',
          status: BookingStatus.Pending,
        }),
        'appt-cancelled': visit({
          at: '2026-10-25T10:00:00+03:00',
          status: BookingStatus.Cancelled,
        }),
        'appt-someone-elses': visit({
          at: '2026-10-21T10:00:00+03:00',
          owner: 'u-martin',
          subjects: [MARTIN],
        }),
      });

      const upcoming = await firstValueFrom(
        portsFor(client()).observeUpcoming(UserId.of('u-georgi')),
      );

      if (!upcoming.ok) throw new Error(upcoming.error.errorCode);
      expect(upcoming.value.map((a) => a.id)).toEqual([
        'appt-sooner',
        'appt-later',
      ]);
    });

    it('observeHistory emits the account’s newest visits, newest first and bounded — index #18', async () => {
      await seed({
        'a-1': visit({ at: '2026-06-02T10:00:00+03:00' }),
        'a-2': visit({ at: '2026-07-01T10:00:00+03:00' }),
        'a-3': visit({
          at: '2026-08-05T10:00:00+03:00',
          status: BookingStatus.Completed,
        }),
      });

      const history = await firstValueFrom(
        portsFor(client()).observeHistory(UserId.of('u-georgi'), 2),
      );

      expect(history.ok && history.value.map((a) => a.id)).toEqual([
        'a-3',
        'a-2',
      ]);
    });
  });

  describe('RULES: appointments are callable-only', () => {
    it('a client cannot create an appointment at all — not even their own', async () => {
      const db = modularFirestore(client());

      await expect(
        setDoc(
          doc(db, 'appointments', 'appt-forged'),
          visit({ at: '2026-10-20T10:00:00+03:00' }),
        ),
      ).rejects.toThrow();
    });

    it('a client cannot forge an appointment owned by someone else', async () => {
      const db = modularFirestore(client());

      await expect(
        setDoc(
          doc(db, 'appointments', 'appt-other'),
          visit({ at: '2026-10-20T10:00:00+03:00', owner: 'u-martin' }),
        ),
      ).rejects.toThrow();
    });

    it('nobody creates appointments directly — staff included', async () => {
      const db = modularFirestore(barber());

      await expect(
        setDoc(
          doc(db, 'appointments', 'appt-counter'),
          visit({ at: '2026-10-20T10:00:00+03:00' }),
        ),
      ).rejects.toBeDefined();
    });

    it('lets staff READ any appointment, but never write its lifecycle directly', async () => {
      await seed({
        'appt-for-staff': visit({
          at: '2026-10-20T10:00:00+03:00',
          status: BookingStatus.Pending,
        }),
      });

      const found = await firstValueFrom(
        portsFor(barber()).observeAppointment(
          AppointmentId.of('appt-for-staff'),
        ),
      );
      expect(found.ok && found.value?.bookingStatus).toBe(
        BookingStatus.Pending,
      );

      await expect(
        updateDoc(
          doc(modularFirestore(barber()), 'appointments', 'appt-for-staff'),
          {
            bookingStatus: BookingStatus.Confirmed,
          },
        ),
      ).rejects.toBeDefined();
    });
  });

  describe('the staff day and search pool', () => {
    it('observeBarberDay answers one chair’s day, every status, by start', async () => {
      await seed({
        late: visit({
          at: '2026-09-28T15:00:00+03:00',
          busyKeys: [IVAN_MONDAY],
        }),
        early: visit({
          at: '2026-09-28T09:00:00+03:00',
          busyKeys: [IVAN_MONDAY],
          status: BookingStatus.Cancelled,
        }),
        elsewhere: visit({
          at: '2026-09-28T11:00:00+03:00',
          busyKeys: ['niko__2026-09-28'],
        }),
      });

      const day = await firstValueFrom(
        portsFor(barber()).observeBarberDay(IVAN_MONDAY),
      );

      expect(day.ok && day.value.map((a) => a.id)).toEqual(['early', 'late']);
    });

    it('searchAppointmentWindow reads the two halves around now on utcEpochMs alone — the single-field index, no composite', async () => {
      await seed({
        p2: visit({ at: '2026-10-09T10:00:00+03:00' }),
        p1: visit({ at: '2026-10-12T11:59:00+03:00', owner: 'u-martin' }),
        n1: visit({ at: '2026-10-12T12:00:00+03:00' }),
        n2: visit({ at: '2026-10-14T10:00:00+03:00' }),
        n3: visit({ at: '2026-10-15T10:00:00+03:00' }),
      });

      const pool = await portsFor(barber()).searchAppointmentWindow(
        utcMs('2026-10-12T12:00:00+03:00'),
        2,
      );

      expect(pool.ok && pool.value.map((a) => a.id)).toEqual([
        'p2',
        'p1',
        'n1',
        'n2',
      ]);
    });
  });

  describe('pageClientHistory — the client card (index #19)', () => {
    beforeEach(async () => {
      await seed({
        'a-01': visit({ at: '2026-06-02T10:00:00+03:00' }),
        'a-02': visit({
          at: '2026-07-01T10:00:00+03:00',
          owner: 'u-martin',
          subjects: [MARTIN, GEORGI],
        }),
        'a-03': visit({ at: '2026-08-05T10:00:00+03:00' }),
        'a-04': visit({
          at: '2026-09-02T10:00:00+03:00',
          owner: 'u-martin',
          subjects: [MARTIN],
        }),
        'a-05': visit({ at: '2026-09-28T10:00:00+03:00' }),
      });
    });

    it('reads every visit with a seat for the client record — as company too — newest first', async () => {
      const page = await portsFor(barber()).pageClientHistory(GEORGI, null, 10);

      expect(page.ok && page.value.appointments.map((a) => a.id)).toEqual([
        'a-05',
        'a-03',
        'a-02',
        'a-01',
      ]);
      expect(page.ok && page.value.nextBeforeUtcMs).toBeNull();
    });

    it('pages on the stored start until nothing older is left', async () => {
      const ports = portsFor(barber());

      const first = await ports.pageClientHistory(GEORGI, null, 3);
      if (!first.ok) throw new Error(first.error.errorCode);
      expect(first.value.appointments.map((a) => a.id)).toEqual([
        'a-05',
        'a-03',
        'a-02',
      ]);
      expect(first.value.nextBeforeUtcMs).toBe(
        utcMs('2026-07-01T10:00:00+03:00'),
      );
      const next = await ports.pageClientHistory(
        GEORGI,
        first.value.nextBeforeUtcMs,
        3,
      );
      expect(next.ok && next.value.appointments.map((a) => a.id)).toEqual([
        'a-01',
      ]);
      expect(next.ok && next.value.nextBeforeUtcMs).toBeNull();
    });

    it('keeps visits starting at the same instant on one page, and says when nothing is older', async () => {
      await seed({ 'a-05b': visit({ at: '2026-09-28T10:00:00+03:00' }) });
      const ports = portsFor(barber());

      const page = await ports.pageClientHistory(GEORGI, null, 1);
      if (!page.ok) throw new Error(page.error.errorCode);
      expect([...page.value.appointments.map((a) => a.id)].sort()).toEqual([
        'a-05',
        'a-05b',
      ]);
      const rest = await ports.pageClientHistory(
        GEORGI,
        page.value.nextBeforeUtcMs,
        5,
      );
      expect(rest.ok && rest.value.appointments.map((a) => a.id)).toEqual([
        'a-03',
        'a-02',
        'a-01',
      ]);

      await testEnv.clearFirestore();
      await seed({
        'b-01': visit({ at: '2026-09-28T10:00:00+03:00' }),
        'b-02': visit({ at: '2026-09-28T10:00:00+03:00' }),
      });
      const only = await ports.pageClientHistory(GEORGI, null, 1);
      expect(only.ok && only.value.nextBeforeUtcMs).toBeNull();
      expect(only.ok && only.value.appointments).toHaveLength(2);
    });

    it('is the book’s: a content manager is refused', async () => {
      const copy = portsFor(
        testEnv.authenticatedContext('copy-1', { roles: ['content_manager'] }),
      );

      const page = await copy.pageClientHistory(GEORGI, null, 5);

      expect(page.ok).toBe(false);
    });
  });
});
