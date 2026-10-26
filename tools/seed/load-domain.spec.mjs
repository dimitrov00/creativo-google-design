/**
 * The loader the seed runs under plain Node: it must bundle the server's
 * client-stats projection and agree with the same code imported the
 * ordinary way — the whole point is that the seed's stats ARE the
 * trigger's. Likewise the one TTL stamp (`purgeAtFor`, F1-7), the seed's
 * own plan modules (whose bodies are TypeScript since flip 1, the
 * accounts' `users` bodies since flip 2, the loyalty bodies since flip 3)
 * and the loyalty domain the seed folds and reads its loyalty documents
 * back with: each must answer what the ordinary import answers.
 *
 * The rhythm (client-card-revision-3.md §4, flip 3): the seed's rhythm IS
 * the domain's projection (`StreakSystem.trace` under the rule
 * `StreakRuleSystem.inForceOn` reads off the head) only if the bundle folds
 * a book into the very documents the ordinary imports fold it into.
 *
 * The preflight (OR-35) reads the default location through the bundle: its
 * id, its collection, the read guard and the zone constructor must judge
 * what the ordinary imports judge.
 *
 * The seed's commit reads through the REAL read guard (OR-33), the bundle's
 * `StoredDocumentSystem.guardOf`: every body the seed writes to a guarded
 * collection must pass it, so a seed run the guard would refuse fails here
 * first — a defect of the fixture, never a reason to unguard the seed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BookingPolicy, StreakRule, TenantConfig } from '@core/components';
import { Collections } from '@core/entities';
import { clientStatsPaths, projectClientStats } from '@core/pipelines';
import { Result } from '@core/primitives';
import {
  LoyaltyCatalogSystem,
  StoredDocumentSystem,
  StreakRuleSystem,
  StreakSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  locationFixture,
  loyaltyAccountJson,
  loyaltyCatalogJson,
  memoryDefaultLocationPorts,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
} from '@core/testing';
// By its own path, as the bundle's entry names it: the server's TTL stamp
// lives in the functions app.
import { purgeAtFor } from '../../apps/functions/src/adapters/firestore-ttl.adapter';
import { busyDayBody, busyKeyOf } from './catalog.mjs';
import { buildClientBook } from './fixtures.mjs';
import { BOOKING_POLICY } from './fixtures/settings.fixtures.ts';
import { staffAccountBody } from './fixtures/users.fixtures.ts';
import {
  SEED_PLAN_MODULES,
  SEED_SERVER_MODULES,
  WORKSPACE_ROOT,
  loadSeedDomain,
} from './load-domain.mjs';
import {
  LOYALTY_HOLDERS,
  loyaltyCatalogFor,
  loyaltyCatalogWritesOf,
  loyaltyWritesOf,
  projectLoyaltyFor,
  readLoyaltyWrites,
} from './loyalty.mjs';
import {
  couponGrantWritesOf,
  couponWritesOf,
  giftVoucherWritesOf,
  readPromotionWrites,
} from './promotions.mjs';
import { programWritesOf } from './programs.mjs';
import { waitlistRequestWriteOf } from './waitlist.mjs';

const NOW = Date.parse('2026-09-25T15:00:00+03:00');

/** What the fold and the read-back are handed of the loyalty domain: each companion, by the members they call. */
const LOYALTY_DOMAIN_MEMBERS = {
  StreakSystem: ['trace'],
  StreakRuleSystem: ['inForceOn'],
  StreakRule: ['parse'],
  LoyaltyCatalogSystem: ['validate'],
};

/** What the preflight is handed of the read guard and the zone (OR-35): each companion, by the members it calls. */
const PREFLIGHT_DOMAIN_MEMBERS = {
  StoredDocumentSystem: ['admit', 'guardOf'],
  ZonedTimeSystem: ['checkZone'],
};

/** What the seed's commit plan is handed of the read guard (OR-33): the registry itself. */
const SEED_COMMIT_MEMBERS = {
  StoredDocumentSystem: ['guardOf'],
};

/** The same names, imported the ordinary way. */
const direct = {
  projectClientStats,
  purgeAtFor,
  StreakSystem,
  StreakRuleSystem,
  StreakRule,
  LoyaltyCatalogSystem,
  StoredDocumentSystem,
  ZonedTimeSystem,
};

const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Runs a `projectClientStats` over the book's appointments in a memory
 * store, for `customerIds`, and answers the documents it left.
 */
async function projectedBy(project, book, customerIds) {
  const store = memoryStore(
    book.appointments.map(({ id, doc }) => ({
      path: [Collections.Appointments, id],
      body: doc,
    })),
  );
  const answer = await project({
    ...memoryTxPorts(store, { nowUtcMs: () => NOW }),
    ...recordingTelemetry(),
    // The default location (F-4) — the shop on the book's own clock.
    ...memoryDefaultLocationPorts(),
    loadLocation: async (id) =>
      Result.ok(
        id === TenantConfig.DEFAULT.defaultLocationId
          ? locationFixture({ id, timeZone: book.calendar.zone })
          : null,
      ),
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
  })({ customerIds });
  expect(answer.ok).toBe(true);
  expect(answer.value.failures).toEqual([]);
  return customerIds.map((customerId) => {
    const paths = clientStatsPaths(customerId);
    return {
      stats: store.get(paths.stats.join('/')) ?? null,
      money: store.get(paths.money.join('/')) ?? null,
    };
  });
}

describe('loadSeedDomain', () => {
  let domain;
  beforeAll(async () => {
    domain = await loadSeedDomain();
  });

  it('bundles the projection the trigger runs, and computes what it computes', async () => {
    expect(typeof domain.projectClientStats).toBe('function');
    expect(typeof domain.firestoreCommitPlan).toBe('function');
    expect(typeof domain.firestoreSettingsPorts).toBe('function');
    expect(typeof domain.firestoreCatalogPorts).toBe('function');
    expect(domain.TenantConfig.DEFAULT).toEqual(TenantConfig.DEFAULT);

    const book = buildClientBook(NOW);
    const customerIds = book.customers
      .filter(({ uid }) =>
        ['dev-client-1', 'dev-client-5', 'dev-client-10'].includes(uid),
      )
      .map(({ id }) => id);
    expect(customerIds).toHaveLength(3);
    const bundled = await projectedBy(
      domain.projectClientStats,
      book,
      customerIds,
    );
    const ordinary = await projectedBy(projectClientStats, book, customerIds);
    for (const [index, written] of bundled.entries()) {
      expect(written.stats, customerIds[index]).not.toBeNull();
      expect(written.money, customerIds[index]).not.toBeNull();
    }
    expect(plain(bundled)).toEqual(plain(ordinary));
  });

  it('holds every name the fold, the read-back and the writes are handed, each a function', () => {
    for (const name of ['projectClientStats', 'purgeAtFor']) {
      expect(typeof domain[name], name).toBe('function');
      expect(typeof direct[name], `${name}, imported the ordinary way`).toBe(
        'function',
      );
    }
    for (const [name, members] of [
      ...Object.entries(LOYALTY_DOMAIN_MEMBERS),
      ...Object.entries(PREFLIGHT_DOMAIN_MEMBERS),
      ...Object.entries(SEED_COMMIT_MEMBERS),
    ]) {
      for (const member of members) {
        expect(typeof domain[name]?.[member], `${name}.${member}`).toBe(
          'function',
        );
        expect(
          typeof direct[name][member],
          `${name}.${member}, imported the ordinary way`,
        ).toBe('function');
      }
    }
  });

  it('names its modules by their files, and each is there', () => {
    expect(Object.keys(SEED_SERVER_MODULES).sort()).toEqual([
      'catalog',
      'commitPlan',
      'settings',
      'ttl',
    ]);
    for (const [name, module] of Object.entries(SEED_SERVER_MODULES)) {
      expect(existsSync(join(WORKSPACE_ROOT, `${module}.ts`)), name).toBe(true);
    }
    expect(Object.keys(SEED_PLAN_MODULES).sort()).toEqual([
      'appointments',
      'book',
      'catalog',
      'customers',
      'loyalty',
      'programs',
      'promotions',
      'settings',
      'users',
      'waitlist',
    ]);
    for (const [name, file] of Object.entries(SEED_PLAN_MODULES)) {
      expect(existsSync(join(WORKSPACE_ROOT, file)), name).toBe(true);
      expect(domain[name], name).toBeDefined();
    }
  });

  it('stamps purgeAt with the server’s own function: the bundle answers what the adapter answers', () => {
    const book = buildClientBook(NOW);
    const waitlist = waitlistRequestWriteOf(book);
    const localDate = book.calendar.dayKeyAt(9);
    const busyPath = `barberBusy/${busyKeyOf('ivan', localDate)}`;
    const busy = busyDayBody('ivan', localDate, [[600, 645]]);
    for (const [path, body] of [
      [waitlist.path, waitlist.data],
      [busyPath, busy],
    ]) {
      const segments = path.split('/');
      const stamped = domain.purgeAtFor(segments, body);
      expect(stamped, path).not.toBeNull();
      expect(stamped.toMillis(), path).toBe(
        purgeAtFor(segments, body).toMillis(),
      );
    }
    // Only a TTL group is stamped: an appointment never is.
    const [{ id, doc }] = book.appointments;
    expect(domain.purgeAtFor(['appointments', id], doc)).toBeNull();
  });

  it('bundles the seed’s plan modules: each writes the very documents the ordinary import writes', () => {
    const ordinary = buildClientBook(NOW);
    const bundled = domain.book.buildClientBook(NOW);
    const written = (book) =>
      plain({
        users: book.users,
        customers: book.customers,
        appointments: book.appointments,
        subjects: book.subjects,
        subjectCustomerIds: book.subjectCustomerIds,
      });
    expect(written(bundled)).toEqual(written(ordinary));
    expect(plain(domain.waitlist.waitlistRequestWriteOf(bundled))).toEqual(
      plain(waitlistRequestWriteOf(ordinary)),
    );
    // The programs (OR-41): engine output on the same shop calendar.
    expect(plain(domain.programs.programWritesOf(bundled.calendar))).toEqual(
      plain(programWritesOf(ordinary.calendar)),
    );
    // The accounts (flip 2): the staff account `seed-dev-catalog.mjs` takes
    // from the bundle is the body the ordinary import builds.
    expect(plain(domain.users.staffAccountBody)).toEqual(
      plain(staffAccountBody),
    );
    // So is the booking policy it writes.
    expect(plain(domain.settings.BOOKING_POLICY)).toEqual(
      plain(BOOKING_POLICY),
    );
  });

  it('bundles the read-back’s two checks, and they judge what the ordinary import judges', () => {
    // The fixtures the card's specs render: the catalogue with the rule's
    // first version, and both accounts — the flat documents as stored.
    const writes = [
      ...loyaltyCatalogWritesOf(loyaltyCatalogJson),
      ...loyaltyWritesOf('dev-client-1', loyaltyAccountJson.georgi),
      ...loyaltyWritesOf('dev-client-2', loyaltyAccountJson.martin),
    ];
    const bundled = readLoyaltyWrites(domain, writes);
    expect(bundled.problems).toEqual([]);
    expect(bundled.catalog).not.toBeNull();
    expect(bundled.ruleVersions).toHaveLength(1);
    expect(bundled.accounts).toHaveLength(2);
    expect(plain(bundled)).toEqual(plain(readLoyaltyWrites(direct, writes)));
    // And both refuse alike: a rule whose grace outlasts its interval.
    const [head] = writes.filter(
      ({ path }) => path === 'streakDefinitions/cadence',
    );
    const graceless = {
      ...head,
      data: {
        ...head.data,
        rules: head.data.rules.map((rule) => ({ ...rule, graceDays: 42 })),
      },
    };
    const refused = readLoyaltyWrites(domain, [graceless]);
    expect(refused.problems).toHaveLength(1);
    expect(refused.problems).toEqual(
      readLoyaltyWrites(direct, [graceless]).problems,
    );
  });

  it('bundles the rhythm’s projector: the seed’s book folds into the documents the ordinary imports fold it into', () => {
    const book = buildClientBook(NOW);
    const today = book.calendar.dayKeyAt(0);
    const catalog = loyaltyCatalogFor(today);
    for (const holder of LOYALTY_HOLDERS) {
      const user = book.users.find((entry) => entry.uid === holder.uid);
      const fold = (handed) =>
        projectLoyaltyFor(
          handed,
          holder.uid,
          book.appointments,
          catalog,
          today,
          {
            profile: {
              email: user.doc.email,
              birthDate: user.doc.birthDate,
              hasAvatar: false,
            },
            redemptions: holder.redemptions,
            stampGrants: holder.stampGrants,
          },
        );
      const bundled = fold(domain);
      expect(
        bundled.account.streaks.map((state) => state.streakId),
        holder.uid,
      ).toEqual(['cadence']);
      expect(bundled).toEqual(fold(direct));
      // Every kind of row, read back by the bundle as by the barrel.
      const writes = loyaltyWritesOf(holder.uid, bundled);
      const read = readLoyaltyWrites(domain, writes);
      expect(read.problems).toEqual([]);
      expect(read.journal).toHaveLength(bundled.account.seq);
      expect(plain(read)).toEqual(plain(readLoyaltyWrites(direct, writes)));
    }
  });

  it('answers the state a rule and its facts give, as the ordinary import does', () => {
    const head = loyaltyCatalogJson.streakDefinitions.cadence;
    const facts = {
      visits: ['2026-05-04', '2026-06-10', '2026-08-20'].map((localDate) => ({
        localDate,
        counted: true,
        // 10:00 on the shop's clock (UTC+3 in summer).
        utcEpochMs: Date.parse(`${localDate}T10:00:00+03:00`),
      })),
      excused: [{ localDate: '2026-07-15', reason: 'BARBER_ABSENCE' }],
      bookings: [
        {
          placedOn: '2026-09-20',
          localDate: '2026-10-08',
          appointmentId: 'appt-x',
        },
      ],
      pauses: [],
      grants: [{ localDate: '2026-06-10', count: 1 }],
    };
    const answers = [domain, direct].map((handed) => {
      const rule = handed.StreakRuleSystem.inForceOn(head, '2026-09-28');
      return plain(
        handed.StreakSystem.trace('cadence', rule, facts, '2026-09-28'),
      );
    });
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0].state).toMatchObject({ streakId: 'cadence', current: 3 });
  });

  it('bundles the preflight’s domain (OR-35): the default location, its collection, the read guard and the zone judge what the ordinary imports judge', () => {
    expect(domain.TenantConfig.DEFAULT).toEqual(TenantConfig.DEFAULT);
    expect(domain.Collections).toEqual(Collections);
    // The zone constructor: canonical, canonicalised, refused — alike.
    for (const raw of ['Europe/Sofia', 'europe/sofia', 'UTC', 'Mars/Olympus']) {
      expect(plain(domain.ZonedTimeSystem.checkZone(raw)), raw).toEqual(
        plain(ZonedTimeSystem.checkZone(raw)),
      );
    }
    // The read guard: the same registry behind the same dispatch — a seeded
    // visit admitted, a tampered one refused alike, a location read as stored.
    const [{ id, doc }] = buildClientBook(NOW).appointments;
    const visit = { ...doc, id };
    const tampered = { ...visit, busyKeys: 'not-a-list' };
    const location = {
      id: TenantConfig.DEFAULT.defaultLocationId,
      timeZone: 'Europe/Sofia',
    };
    const admitted = [
      [Collections.Appointments, visit, true],
      [Collections.Appointments, tampered, false],
      [Collections.Locations, location, true],
    ];
    for (const [collection, stored, ok] of admitted) {
      const bundled = domain.StoredDocumentSystem.admit(
        domain.StoredDocumentSystem.guardOf,
        collection,
        stored,
      );
      const ordinary = StoredDocumentSystem.admit(
        StoredDocumentSystem.guardOf,
        collection,
        stored,
      );
      expect(ordinary.ok, `${collection}/${stored.id}`).toBe(ok);
      expect(plain(bundled)).toEqual(plain(ordinary));
    }
  });

  it('hands the seed’s commit the REAL read guard (OR-33): every body the seed writes to a guarded collection is admitted, as the ordinary import admits it', () => {
    const book = buildClientBook(NOW);
    const localDate = book.calendar.dayKeyAt(9);
    const written = [
      ...book.appointments.map(({ id, doc }) => [
        Collections.Appointments,
        { ...doc, id },
      ]),
      ...book.customers.map(({ id, body }) => [
        Collections.Customers,
        { ...body, id },
      ]),
      [
        Collections.BarberBusy,
        {
          ...busyDayBody('ivan', localDate, [
            [600, 645],
            [900, 960],
          ]),
          id: busyKeyOf('ivan', localDate),
        },
      ],
    ];
    expect(book.appointments.length).toBeGreaterThan(0);
    expect(book.customers.length).toBeGreaterThan(0);
    const { guardOf } = domain.StoredDocumentSystem;
    for (const [collection, stored] of written) {
      const where = `${collection}/${stored.id}`;
      // A guarded collection: the registry answers its guard, never `null`.
      expect(guardOf(collection), where).not.toBeNull();
      const bundled = domain.StoredDocumentSystem.admit(
        guardOf,
        collection,
        stored,
      );
      expect(bundled.ok ? null : bundled.error, where).toBeNull();
      expect(
        StoredDocumentSystem.admit(
          StoredDocumentSystem.guardOf,
          collection,
          stored,
        ).ok,
        where,
      ).toBe(true);
    }
  });

  it('bundles the promotions’ plan, and it writes and reads back what the ordinary import does', () => {
    const book = buildClientBook(NOW);
    const today = book.calendar.dayKeyAt(0);
    const catalog = loyaltyCatalogFor(today);
    const writesBy = (promotions) => [
      ...promotions.couponWritesOf(),
      ...promotions.couponGrantWritesOf(book, catalog, today),
      ...promotions.giftVoucherWritesOf(book.calendar),
    ];
    const writes = writesBy({
      couponWritesOf,
      couponGrantWritesOf,
      giftVoucherWritesOf,
    });
    expect(plain(writesBy(domain.promotions))).toEqual(plain(writes));
    const bundled = domain.promotions.readPromotionWrites(writes);
    expect(bundled.problems).toEqual([]);
    expect(bundled.coupons).toHaveLength(couponWritesOf().length);
    expect(plain(bundled)).toEqual(plain(readPromotionWrites(writes)));
  });
});
