import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import { Result, UtcEpochMs } from '@core/primitives';
import { Email, ParsedIdentifier, WriteOp } from '@core/components';
import type { ClockPorts, HashPorts, IdPorts } from '@core/ports';
import {
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
      'loadWaitlistRequest',
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
});
