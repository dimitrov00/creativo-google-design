import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { Identifier } from '@core/components';
import { AppointmentId, LogEvent } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type AppointmentPhoto,
  CLIENT_MONEY_DOC,
  Collections,
  Subcollections,
} from '@core/entities';
import type { Log } from '@core/ports';
import { StoredDocumentSystem } from '@core/systems';
import { PRIVACY_SENTINELS, privacyWorld, unguarded } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestorePrivacyPorts } from './firestore-privacy.adapter';

/*
 * The person's footprint over the in-memory Admin SDK (audit-hardening
 * Phase 3, WS-C): each read's query shape (one root equality or
 * `array-contains`, the limit it is handed, never an `orderBy`), the
 * documents it answers as stored, the stored-document guard on the three
 * guarded collections (the first malformed document fails the read, logged
 * once) and a throwing read answered as a code-only value. The erasure's
 * two reads (WS-D): the sessions that targeted the account and the
 * challenges under a destination — whose failure names `otps` alone, never
 * the destination; and no read carries the adapter-stamped `purgeAt` into
 * an entity (P3-RU-37 (i)).
 */

type Data = Record<string, unknown>;

function bodyOf(entity: { readonly id: string }): Data {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const NO_LOG: Log = () => undefined;

/** The world's documents at their stored paths. */
function seeded() {
  const world = privacyWorld();
  const docs: Record<string, Data> = {};
  const put = (path: string, entity: { readonly id: string }) => {
    docs[`${path}/${entity.id}`] = bodyOf(entity);
  };
  for (const record of world.state.records) put(Collections.Customers, record);
  for (const user of world.state.users) put(Collections.Users, user);
  for (const visit of world.state.visits) put(Collections.Appointments, visit);
  for (const note of world.state.notes) put(Collections.AppointmentNotes, note);
  for (const photo of world.state.photos) {
    put(Collections.AppointmentPhotos, photo);
  }
  for (const grant of world.state.grants) put(Collections.CouponGrants, grant);
  for (const voucher of world.state.vouchers) {
    put(Collections.GiftVouchers, voucher);
  }
  for (const entry of world.state.journal)
    put(Collections.ClientJournal, entry);
  for (const [userId, inbox] of world.state.notifications) {
    for (const notification of inbox) {
      put(
        `${Collections.Users}/${userId}/${Subcollections.Notifications}`,
        notification,
      );
    }
  }
  for (const request of world.state.waitlist) {
    put(Collections.WaitlistRequests, request);
  }
  for (const invitation of world.state.invitations) {
    put(Collections.Invitations, invitation);
  }
  for (const session of world.state.sessions) {
    put(Collections.ImpersonationSessions, session);
  }
  for (const otp of world.state.otps) put(Collections.Otps, otp);
  for (const [customerId, account] of world.loyalty.accounts) {
    put(Collections.LoyaltyAccounts, account);
    for (const progress of world.loyalty.badgeProgress.get(customerId) ?? []) {
      put(
        `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.BadgeProgress}`,
        progress,
      );
    }
    for (const progress of world.loyalty.seasonProgress.get(customerId) ?? []) {
      put(
        `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.SeasonProgress}`,
        progress,
      );
    }
  }
  for (const stats of world.stats.stats) put(Collections.ClientStats, stats);
  for (const money of world.stats.money) {
    put(
      `${Collections.ClientStats}/${money.customerId}/${Subcollections.Restricted}`,
      money,
    );
  }
  return { world, fake: createProjectionFirestore(docs) };
}

/** One query as it was asked: its collection path and every clause, in order. */
type Shape = {
  readonly path: string;
  readonly steps: readonly (readonly unknown[])[];
};

/**
 * The fake's `collection(path)` wrapped so every query that is READ records
 * its shape — the clauses on the way to its `get()`, each branch its own.
 */
function recording(db: unknown) {
  const shapes: Shape[] = [];
  const wrap = (target: object, shape: Shape): object =>
    new Proxy(target, {
      get(inner, prop) {
        const value: unknown = Reflect.get(inner, prop);
        if (typeof value !== 'function') return value;
        if (prop === 'get') {
          return () => {
            shapes.push(shape);
            return Reflect.apply(value, inner, []);
          };
        }
        if (prop === 'doc') return value.bind(inner);
        return (...args: unknown[]) => {
          const next: unknown = Reflect.apply(value, inner, args);
          return typeof next === 'object' && next !== null
            ? wrap(next, {
                path: shape.path,
                steps: [...shape.steps, [String(prop), ...args]],
              })
            : next;
        };
      },
    });
  const base = db as { collection: (path: string) => object };
  const proxied = new Proxy(base, {
    get(inner, prop) {
      if (prop === 'collection') {
        return (path: string) =>
          wrap(base.collection(path), { path, steps: [] });
      }
      const value: unknown = Reflect.get(inner, prop);
      return typeof value === 'function' ? value.bind(inner) : value;
    },
  });
  return { db: proxied as unknown as Firestore, shapes };
}

describe('firestorePrivacyPorts — the query shapes', () => {
  it('reads every list by ONE root equality (or array-contains) and the limit it is handed — never an orderBy', async () => {
    const { world, fake } = seeded();
    const { db, shapes } = recording(fake.db);
    const ports = firestorePrivacyPorts(db, unguarded, NO_LOG);
    const p = world.person.customerId;
    const u = world.person.userId;
    await ports.listClientVisits(p, 11);
    await ports.listPhotosOfClient(p, 12);
    await ports.listClientGrants(p, 13);
    await ports.listClientVouchers(p, 14);
    await ports.listClientJournal(p, 15);
    await ports.listAccountNotifications(u, 16);
    await ports.listAccountWaitlist(u, 17);
    await ports.listAccountInvitations(u, 18);
    await ports.listBadgeProgress(p);
    await ports.listSeasonProgress(p);
    expect(shapes).toEqual([
      {
        path: Collections.Appointments,
        steps: [
          ['where', 'subjectCustomerIds', 'array-contains', p],
          ['limit', 11],
        ],
      },
      {
        path: Collections.AppointmentPhotos,
        steps: [
          ['where', 'clientCustomerId', '==', p],
          ['limit', 12],
        ],
      },
      {
        path: Collections.CouponGrants,
        steps: [
          ['where', 'customerId', '==', p],
          ['limit', 13],
        ],
      },
      {
        path: Collections.GiftVouchers,
        steps: [
          ['where', 'issuedToCustomerId', '==', p],
          ['limit', 14],
        ],
      },
      {
        path: Collections.ClientJournal,
        steps: [
          ['where', 'customerId', '==', p],
          ['limit', 15],
        ],
      },
      {
        path: `${Collections.Users}/${u}/${Subcollections.Notifications}`,
        steps: [['limit', 16]],
      },
      {
        path: Collections.WaitlistRequests,
        steps: [
          ['where', 'ownerUserId', '==', u],
          ['limit', 17],
        ],
      },
      {
        path: Collections.Invitations,
        steps: [
          ['where', 'inviterUserId', '==', u],
          ['limit', 18],
        ],
      },
      {
        path: `${Collections.LoyaltyAccounts}/${p}/${Subcollections.BadgeProgress}`,
        steps: [],
      },
      {
        path: `${Collections.LoyaltyAccounts}/${p}/${Subcollections.SeasonProgress}`,
        steps: [],
      },
    ]);
  });

  it('reads the photos of the given visits in `in` chunks of 30, each limited to what is still owed', async () => {
    const { fake } = seeded();
    const { db, shapes } = recording(fake.db);
    const ports = firestorePrivacyPorts(db, unguarded, NO_LOG);
    const ids = Array.from({ length: 61 }, (_, i) =>
      AppointmentId.of(`appt-${String(i).padStart(2, '0')}`),
    );
    expect(await ports.listVisitPhotos(ids, 100)).toEqual({
      ok: true,
      value: [],
    });
    expect(shapes).toEqual([
      {
        path: Collections.AppointmentPhotos,
        steps: [
          ['where', 'appointmentId', 'in', ids.slice(0, 30)],
          ['limit', 100],
        ],
      },
      {
        path: Collections.AppointmentPhotos,
        steps: [
          ['where', 'appointmentId', 'in', ids.slice(30, 60)],
          ['limit', 100],
        ],
      },
      {
        path: Collections.AppointmentPhotos,
        steps: [
          ['where', 'appointmentId', 'in', ids.slice(60)],
          ['limit', 100],
        ],
      },
    ]);
  });

  it('reads nothing for no visits — no `in []`, no `getAll()`', async () => {
    const { fake } = seeded();
    const { db, shapes } = recording(fake.db);
    const getAll = vi.spyOn(fake.db, 'getAll');
    const ports = firestorePrivacyPorts(db, unguarded, NO_LOG);
    expect(await ports.listVisitPhotos([], 5)).toEqual({ ok: true, value: [] });
    expect(await ports.loadVisitNotes([])).toEqual({ ok: true, value: [] });
    expect(shapes).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  it('reads the erasure’s two lists by ONE root equality and the limit it is handed — the account’s sessions, the challenges under a destination', async () => {
    const { world, fake } = seeded();
    const { db, shapes } = recording(fake.db);
    const ports = firestorePrivacyPorts(db, unguarded, NO_LOG);
    const u = world.person.userId;
    const destination = Identifier.of(PRIVACY_SENTINELS.phone);
    await ports.listAccountSessions(u, 19);
    await ports.listOtpsByDestination(destination, 20);
    expect(shapes).toEqual([
      {
        path: Collections.ImpersonationSessions,
        steps: [
          ['where', 'targetUserId', '==', u],
          ['limit', 19],
        ],
      },
      {
        path: Collections.Otps,
        steps: [
          ['where', 'destination', '==', destination],
          ['limit', 20],
        ],
      },
    ]);
  });
});

describe('firestorePrivacyPorts — the visits by contact (P3-DEP-28)', () => {
  it('reads ONE root equality per contact field, each at the limit it is handed — never an orderBy', async () => {
    const { fake } = seeded();
    const { db, shapes } = recording(fake.db);
    const ports = firestorePrivacyPorts(db, unguarded, NO_LOG);
    const value = Identifier.of(PRIVACY_SENTINELS.phone);
    await ports.listVisitsByContact(value, 21);
    expect(shapes).toEqual([
      {
        path: Collections.Appointments,
        steps: [
          ['where', 'contactPhone', '==', value],
          ['limit', 21],
        ],
      },
      {
        path: Collections.Appointments,
        steps: [
          ['where', 'contactEmail', '==', value],
          ['limit', 21],
        ],
      },
    ]);
  });

  it('answers every visit carrying the value as stored — a visit both equalities answer comes once; nobody’s value answers none', async () => {
    const { world, fake } = seeded();
    // A visit carrying P's phone AND P's e-mail, seating Q alone.
    fake.docs.set(`${Collections.Appointments}/appt-p-removed`, {
      ...bodyOf(world.visits.party),
      contactPhone: PRIVACY_SENTINELS.phone,
      contactEmail: PRIVACY_SENTINELS.phone,
    });
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    const byPhone = await ports.listVisitsByContact(
      Identifier.of(PRIVACY_SENTINELS.phone),
      50,
    );
    expect(byPhone.ok).toBe(true);
    if (!byPhone.ok) return;
    expect(byPhone.value.map((visit) => visit.id).sort()).toEqual(
      ['appt-p-removed', world.visits.solo.id].sort(),
    );
    expect(
      byPhone.value.find((visit) => visit.id === world.visits.solo.id),
    ).toEqual(world.visits.solo);
    expect(
      await ports.listVisitsByContact(
        Identifier.of(PRIVACY_SENTINELS.email),
        50,
      ),
    ).toEqual({ ok: true, value: [world.visits.solo] });
    expect(
      await ports.listVisitsByContact(
        Identifier.of('nobody@example.invalid'),
        50,
      ),
    ).toEqual({ ok: true, value: [] });
  });

  it('refuses a malformed visit it finds — the guarded collection', async () => {
    const { fake } = seeded();
    fake.docs.set(`${Collections.Appointments}/appt-broken`, {
      contactPhone: PRIVACY_SENTINELS.phone,
      junk: true,
    });
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    const read = await ports.listVisitsByContact(
      Identifier.of(PRIVACY_SENTINELS.phone),
      50,
    );
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.errorCode).toBe('REPOSITORY_MALFORMED');
  });

  it('names the collection alone when it cannot be read — never the value', async () => {
    const { fake } = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(
        new Error(`14 UNAVAILABLE: ${PRIVACY_SENTINELS.phone}`),
        { code: 14 },
      );
    });
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    );
    const failed = await ports.listVisitsByContact(
      Identifier.of(PRIVACY_SENTINELS.phone),
      5,
    );
    expect(failed).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.Appointments,
        'unavailable',
      ),
    });
    expect(JSON.stringify(failed)).not.toContain('359880000777');
  });
});

describe('firestorePrivacyPorts — the documents', () => {
  it('answers the person’s documents as stored — and nobody else’s', async () => {
    const { world, fake } = seeded();
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    const p = world.person.customerId;
    const u = world.person.userId;
    const record = world.state.records.find((r) => r.id === p);
    const account = world.state.users.find((a) => a.id === u);
    const byId = <T extends { readonly id: string }>(rows: readonly T[]) =>
      [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));

    expect(await ports.loadClientRecord(p)).toEqual({
      ok: true,
      value: record,
    });
    expect(await ports.loadProfile(u)).toEqual({ ok: true, value: account });
    const visits = await ports.listClientVisits(p, 50);
    expect(visits.ok && byId(visits.value)).toEqual(
      byId([world.visits.solo, world.visits.party]),
    );
    expect(
      await ports.loadVisitNotes([
        world.visits.solo.id,
        AppointmentId.of('appt-without-a-note'),
      ]),
    ).toEqual({
      ok: true,
      value: world.state.notes.filter(
        (note) => note.id === world.visits.solo.id,
      ),
    });
    const photos = await ports.listPhotosOfClient(p, 50);
    expect(photos.ok && byId(photos.value)).toEqual(
      byId(world.state.photos.filter((photo) => photo.clientCustomerId === p)),
    );
    const onSolo = await ports.listVisitPhotos([world.visits.solo.id], 50);
    expect(onSolo.ok && byId(onSolo.value)).toEqual(
      byId(
        world.state.photos.filter(
          (photo: AppointmentPhoto) =>
            photo.appointmentId === world.visits.solo.id,
        ),
      ),
    );
    expect(await ports.listClientGrants(p, 50)).toEqual({
      ok: true,
      value: world.state.grants.filter((grant) => grant.customerId === p),
    });
    expect(await ports.listClientVouchers(p, 50)).toEqual({
      ok: true,
      value: world.state.vouchers.filter(
        (voucher) => voucher.issuedToCustomerId === p,
      ),
    });
    const journal = await ports.listClientJournal(p, 50);
    expect(journal.ok && byId(journal.value)).toEqual(
      byId(world.state.journal.filter((entry) => entry.customerId === p)),
    );
    expect(await ports.listAccountNotifications(u, 50)).toEqual({
      ok: true,
      value: world.state.notifications.get(u),
    });
    expect(await ports.listAccountWaitlist(u, 50)).toEqual({
      ok: true,
      value: world.state.waitlist.filter((r) => r.ownerUserId === u),
    });
    expect(await ports.listAccountInvitations(u, 50)).toEqual({
      ok: true,
      value: world.state.invitations.filter((i) => i.inviterUserId === u),
    });
    expect(await ports.loadLoyaltyAccount(p)).toEqual({
      ok: true,
      value: world.loyalty.accounts.get(p),
    });
    const badges = await ports.listBadgeProgress(p);
    expect(badges.ok && byId(badges.value)).toEqual(
      byId(world.loyalty.badgeProgress.get(p) ?? []),
    );
    const seasons = await ports.listSeasonProgress(p);
    expect(seasons.ok && byId(seasons.value)).toEqual(
      byId(world.loyalty.seasonProgress.get(p) ?? []),
    );
    expect(await ports.loadClientStats(p)).toEqual({
      ok: true,
      value: world.stats.stats.find((s) => s.customerId === p),
    });
    expect(await ports.loadClientMoney(p)).toEqual({
      ok: true,
      value: world.stats.money.find((m) => m.customerId === p),
    });
  });

  it('answers the sessions that targeted the account and the challenges under a destination as stored — and nobody else’s', async () => {
    const { world, fake } = seeded();
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    const u = world.person.userId;
    expect(await ports.listAccountSessions(u, 50)).toEqual({
      ok: true,
      value: world.state.sessions.filter(
        (session) => session.targetUserId === u,
      ),
    });
    const destination = Identifier.of(PRIVACY_SENTINELS.phone);
    expect(await ports.listOtpsByDestination(destination, 50)).toEqual({
      ok: true,
      value: world.state.otps.filter((otp) => otp.destination === destination),
    });
    expect(
      await ports.listOtpsByDestination(
        Identifier.of('nobody@example.invalid'),
        50,
      ),
    ).toEqual({ ok: true, value: [] });
  });

  it('never reads the adapter-stamped purgeAt into an entity — the TTL stamp is part of none (P3-RU-37 (i))', async () => {
    const { world, fake } = seeded();
    const u = world.person.userId;
    const purgeAt = Timestamp.fromMillis(1_800_000_000_000);
    const stamped = (path: string): void => {
      fake.docs.set(path, { ...(fake.docs.get(path) ?? {}), purgeAt });
    };
    const [notification] = world.state.notifications.get(u) ?? [];
    const [request] = world.state.waitlist.filter((r) => r.ownerUserId === u);
    const [session] = world.state.sessions.filter((s) => s.targetUserId === u);
    const [otp] = world.state.otps;
    if (!notification || !request || !session || !otp) {
      throw new Error('the world must hold one of each TTL group');
    }
    stamped(
      `${Collections.Users}/${u}/${Subcollections.Notifications}/${notification.id}`,
    );
    stamped(`${Collections.WaitlistRequests}/${request.id}`);
    stamped(`${Collections.ImpersonationSessions}/${session.id}`);
    stamped(`${Collections.Otps}/${otp.id}`);
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    const reads = [
      await ports.listAccountNotifications(u, 50),
      await ports.listAccountWaitlist(u, 50),
      await ports.listAccountSessions(u, 50),
      await ports.listOtpsByDestination(otp.destination, 50),
    ];
    expect(reads).toEqual([
      { ok: true, value: [notification] },
      { ok: true, value: [request] },
      { ok: true, value: [session] },
      { ok: true, value: [otp] },
    ]);
    for (const read of reads) {
      if (!read.ok) continue;
      for (const entity of read.value) {
        expect(entity).not.toHaveProperty('purgeAt');
      }
    }
  });

  it('answers an absent document as null and an empty list as []', async () => {
    const ports = firestorePrivacyPorts(
      createProjectionFirestore().db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      NO_LOG,
    );
    const { world } = seeded();
    const p = world.person.customerId;
    const u = world.person.userId;
    for (const read of [
      ports.loadClientRecord(p),
      ports.loadProfile(u),
      ports.loadLoyaltyAccount(p),
      ports.loadClientStats(p),
      ports.loadClientMoney(p),
    ]) {
      expect(await read).toEqual({ ok: true, value: null });
    }
    expect(await ports.listClientVisits(p, 5)).toEqual({ ok: true, value: [] });
    expect(await ports.listAccountNotifications(u, 5)).toEqual({
      ok: true,
      value: [],
    });
  });

  it('applies the limit it is handed — the caller’s cap and one', async () => {
    const { world, fake } = seeded();
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    );
    const visits = await ports.listClientVisits(world.person.customerId, 1);
    expect(visits.ok && visits.value).toHaveLength(1);
    const photos = await ports.listVisitPhotos(
      [world.visits.solo.id, world.visits.party.id],
      1,
    );
    expect(photos.ok && photos.value).toHaveLength(1);
  });
});

describe('firestorePrivacyPorts — the guard and the failures', () => {
  it.each([
    [Collections.Customers, 'loadClientRecord'],
    [Collections.Appointments, 'listClientVisits'],
    [Collections.AppointmentNotes, 'loadVisitNotes'],
  ] as const)(
    'refuses a malformed %s document — the whole read fails, the refusal logged once',
    async (collection, port) => {
      const { world, fake } = seeded();
      const p = world.person.customerId;
      const id =
        collection === Collections.Customers
          ? p
          : collection === Collections.Appointments
            ? 'appt-p-broken'
            : world.visits.solo.id;
      fake.docs.set(`${collection}/${id}`, {
        subjectCustomerIds: [p],
        junk: true,
      });
      const log = vi.fn<Log>();
      const ports = firestorePrivacyPorts(
        fake.db as unknown as Firestore,
        StoredDocumentSystem.guardOf,
        log,
      );
      const read =
        port === 'loadClientRecord'
          ? await ports.loadClientRecord(p)
          : port === 'listClientVisits'
            ? await ports.listClientVisits(p, 50)
            : await ports.loadVisitNotes([world.visits.solo.id]);
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.error.errorCode).toBe('REPOSITORY_MALFORMED');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'error',
        LogEvent.DocumentRefused,
        expect.objectContaining({ path: `${collection}/${id}` }),
      );
    },
  );

  it('answers a read that throws as a value, the canonical code its reason — never the message', async () => {
    const { world, fake } = seeded();
    const denied = Object.assign(
      new Error('7 PERMISSION_DENIED: sentinel@example.invalid'),
      { code: 7 },
    );
    vi.spyOn(fake.db, 'doc').mockImplementation(() => {
      throw denied;
    });
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw denied;
    });
    vi.spyOn(fake.db, 'getAll').mockImplementation(() => {
      throw denied;
    });
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    );
    const p = world.person.customerId;
    const u = world.person.userId;
    expect(await ports.loadClientRecord(p)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        `${Collections.Customers}/${p}`,
        'permission-denied',
      ),
    });
    expect(await ports.loadClientMoney(p)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        `${Collections.ClientStats}/${p}/${Subcollections.Restricted}/${CLIENT_MONEY_DOC}`,
        'permission-denied',
      ),
    });
    expect(await ports.loadVisitNotes([world.visits.solo.id])).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.AppointmentNotes,
        'permission-denied',
      ),
    });
    for (const read of [
      ports.listClientVisits(p, 5),
      ports.listVisitPhotos([world.visits.solo.id], 5),
      ports.listAccountWaitlist(u, 5),
      ports.listBadgeProgress(p),
    ]) {
      const failed = await read;
      expect(failed.ok).toBe(false);
      if (failed.ok) continue;
      expect(failed.error).toMatchObject({
        errorCode: 'REPOSITORY_READ_FAILED',
        reason: 'permission-denied',
      });
      expect(JSON.stringify(failed.error)).not.toContain('sentinel');
    }
  });

  it('names the collection alone when the challenges under a destination cannot be read — never the destination', async () => {
    const { fake } = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(
        new Error(`14 UNAVAILABLE: ${PRIVACY_SENTINELS.phone}`),
        { code: 14 },
      );
    });
    const ports = firestorePrivacyPorts(
      fake.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    );
    const failed = await ports.listOtpsByDestination(
      Identifier.of(PRIVACY_SENTINELS.phone),
      5,
    );
    expect(failed).toEqual({
      ok: false,
      error: RepositoryError.readFailed(Collections.Otps, 'unavailable'),
    });
    expect(JSON.stringify(failed)).not.toContain(PRIVACY_SENTINELS.phone);
    expect(JSON.stringify(failed)).not.toContain('359880000777');
  });
});
