import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import { BusyKey, Result, UtcEpochMs } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { Email, ParsedIdentifier, WriteOp } from '@core/components';
import type { ClockPorts, HashPorts, IdPorts } from '@core/ports';
import {
  appointmentFixture,
  barberBusyDayFixture,
  otpFixture,
  recordingTelemetry,
  registeredUserFixture,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { type FirestorePorts, firestorePorts } from './firestore-ports';

describe('firestorePorts — the assembler', () => {
  const primitives: ClockPorts & HashPorts & IdPorts = {
    nowUtcMs: () => {
      const at = UtcEpochMs.of(1_760_000_000_000);
      if (!at.ok) throw new Error('a broken fixture');
      return at.value;
    },
    nextId: () => 'id-1',
    hash: (input: string) => `h(${input})`,
  };

  const assemble = (): {
    readonly fake: ReturnType<typeof createProjectionFirestore>;
    readonly ports: FirestorePorts;
  } => {
    const fake = createProjectionFirestore();
    return {
      fake,
      ports: firestorePorts(
        fake.db as unknown as Firestore,
        primitives,
        recordingTelemetry(),
      ),
    };
  };

  it('hands the three primitives through as given', () => {
    const { ports } = assemble();
    expect(ports.nowUtcMs).toBe(primitives.nowUtcMs);
    expect(ports.nowUtcMs()).toBe(1_760_000_000_000);
    expect(ports.nextId).toBe(primitives.nextId);
    expect(ports.hash).toBe(primitives.hash);
  });

  it('builds every port the booking flip’s pipelines read or write outside a transaction, each a function', () => {
    const { ports } = assemble();
    for (const member of [
      'commit',
      'loadPolicy',
      'findCouponByCode',
      'loadAccountContacts',
      'appendAudit',
      'createAuditRows',
      'auditActionsFor',
      'loadCatalog',
      'loadSchedule',
      'loadBusyDay',
      'listBarbers',
      'loadScheduleException',
      'loadCapacityMonths',
      'writeLeadTimeSample',
      'loadOpenWaitlist',
      'hasRecentNotification',
      'pageClients',
      'loadPolicyRecomputeJob',
      'loadBackfillJob',
      'writeBackfillJob',
      'pageAppointments',
      // flip 2 (identity): the `otps` store and the account lookup
      'loadOpenOtps',
      'saveOtp',
      'findUserByDestination',
    ] as const) {
      expect(typeof (ports as Record<string, unknown>)[member], member).toBe(
        'function',
      );
    }
  });

  it('commits over the db it was given — the purgeAt stamp included', async () => {
    const { fake, ports } = assemble();
    const result = await ports.commit(
      async () => null,
      () =>
        Result.ok({
          id: ports.nextId(),
          writes: [
            WriteOp.set(['barberBusy', ports.hash('k')], { blocks: [] }),
          ],
        }),
    );
    expect(result).toEqual({ ok: true, value: { id: 'id-1' } });
    expect(fake.docs.get('barberBusy/h(k)')).toEqual({ blocks: [] });
  });

  it('saves a challenge and finds an account through the same db — the otps purgeAt stamped', async () => {
    const { fake, ports } = assemble();
    const otp = otpFixture();
    expect((await ports.saveOtp(otp)).ok).toBe(true);
    expect(fake.docs.get('otps/otp-1')).toMatchObject({
      purgeAt: Timestamp.fromMillis(otp.expiresAtUtcMs + 86_400_000),
    });
    const mail = Email.of('maria@example.com');
    const { id, ...body } = registeredUserFixture({ email: mail });
    fake.docs.set(`users/${id}`, body);
    const found = await ports.findUserByDestination(
      ParsedIdentifier.email(mail),
    );
    expect(found.ok && found.value?.id).toBe(id);
  });

  it('reads the settings through the same db', async () => {
    const { fake, ports } = assemble();
    fake.docs.set('settings/bookingPolicy', { cancellationWindowHours: 6 });
    const policy = await ports.loadPolicy();
    expect(policy.ok && policy.value.cancellationWindowHours).toBe(6);
  });

  it('passes the stored-document guards and the telemetry log to every reader of the three collections (edge hardening D-7)', async () => {
    const fake = createProjectionFirestore();
    const telemetry = recordingTelemetry();
    const ports = firestorePorts(
      fake.db as unknown as Firestore,
      primitives,
      telemetry,
    );
    const body = (entity: { readonly id: string }) =>
      Object.fromEntries(
        Object.entries(entity).filter(([key]) => key !== 'id'),
      );
    const appointment = appointmentFixture();
    const day = barberBusyDayFixture();
    fake.docs.set(`appointments/${appointment.id}`, {
      ...body(appointment),
      bookingStatus: 'BOOKED',
    });
    fake.docs.set(`barberBusy/${day.id}`, { ...body(day), utcEpochMs: 'x' });

    const committed = await ports.commit(
      (tx) => tx.get(['appointments', appointment.id]),
      () => Result.ok({ writes: [] }),
    );
    const busy = await ports.loadBusyDay(
      BusyKey.of(day.barberId, day.localDate),
    );
    const page = await ports.pageAppointments(null, 10);

    const malformed = (path: string, reason: string) => ({
      ok: false,
      error: { errorCode: RepositoryErrorCode.Malformed, path, reason },
    });
    expect(committed).toEqual(
      malformed(`appointments/${appointment.id}`, 'bookingStatus'),
    );
    expect(busy).toEqual(malformed(`barberBusy/${day.id}`, 'utcEpochMs'));
    expect(page).toEqual(
      malformed(`appointments/${appointment.id}`, 'bookingStatus'),
    );
    expect(telemetry.lines.map((line) => line.fields)).toEqual([
      { path: `appointments/${appointment.id}`, field: 'bookingStatus' },
      { path: `barberBusy/${day.id}`, field: 'utcEpochMs' },
      { path: `appointments/${appointment.id}`, field: 'bookingStatus' },
    ]);
    expect(
      telemetry.lines.every(
        (line) =>
          line.level === 'error' && line.msg === 'malformed document refused',
      ),
    ).toBe(true);
  });
});
