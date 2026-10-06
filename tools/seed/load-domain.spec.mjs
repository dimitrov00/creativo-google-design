/**
 * The loader the seed runs under plain Node: it must bundle the functions'
 * projection and agree with the same code imported the ordinary way — the
 * whole point is that the seed's stats ARE the trigger's. Likewise the
 * client card's readers the seed reads its loyalty and waitlist documents
 * back with: they must read what the card's own import reads.
 *
 * And since revision 3 of the client card (client-card-revision-3.md §4):
 * the rhythm's projector, the rule's readers and writers, the activity
 * feed's reader and the promotions' mappers. The seed's rhythm IS the
 * domain's projection only if the bundle folds a book into the very
 * documents the ordinary imports fold it into.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  appointmentFromDocument,
  waitlistFromDocument,
  waitlistToDocument,
} from '@creativo/application/booking';
import * as engagement from '@creativo/application/engagement';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import { UserId } from '@creativo/domain/accounts';
import { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
import {
  ClientStatsPolicy,
  computeClientStats,
} from '@creativo/domain/scheduling';
// By their own paths, as the bundle's entry names them: the domain's barrel
// does not carry the projector's line yet (contract delta R2b-1), and the
// coupon's mapper is on no barrel.
import {
  projectStreak,
  traceStreak,
} from '../../libs/domain/engagement/src/lib/loyalty/streak-projector';
import {
  couponFromPersistence,
  couponToPersistence,
} from '../../libs/infrastructure/firestore/src/lib/coupon-persistence';
import { buildClientBook } from './fixtures.mjs';
import {
  SEED_DOMAIN_MODULES,
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
import { waitlistRequestWriteOf } from './waitlist.mjs';

const NOW = Date.parse('2026-09-25T15:00:00+03:00');

/** What the entry takes from `loyalty-document.ts`, which the application's barrel hands out by star. */
const LOYALTY_DOCUMENT_NAMES = [
  'activityEntryFromDocument',
  'badgeProgressFromDocument',
  'ledgerEntryFromDocument',
  'loyaltyAccountFromDocument',
  'loyaltyCatalogFromDocuments',
  'seasonProgressFromDocument',
  'streakDefinitionVersionFromDocument',
  'streakDefinitionVersionToDocument',
  'streakScheduleFromDocument',
  'streakScheduleToDocument',
  'streakStateToDocument',
];
const GIFT_VOUCHER_DOCUMENT_NAMES = [
  'giftVoucherFromDocument',
  'giftVoucherToDocument',
];

/** The same names, imported the ordinary way. */
const direct = {
  ...Object.fromEntries(
    [...LOYALTY_DOCUMENT_NAMES, ...GIFT_VOUCHER_DOCUMENT_NAMES].map((name) => [
      name,
      engagement[name],
    ]),
  ),
  ServiceCategoryId,
  ServiceId,
  couponFromPersistence,
  couponToPersistence,
  projectStreak,
  traceStreak,
};

const plain = (value) => JSON.parse(JSON.stringify(value));

describe('loadSeedDomain', () => {
  let domain;
  beforeAll(async () => {
    domain = await loadSeedDomain();
  });

  it('bundles the projection the trigger runs, and computes what it computes', () => {
    expect(typeof domain.recomputeClientStats).toBe('function');
    expect(typeof domain.loadClientStatsPolicy).toBe('function');

    const book = buildClientBook(NOW);
    // The stored placements too: the preferred barber reads them (§11.2 #6).
    const placements = new Map(
      book.appointments
        .filter(({ doc }) => doc.placement != null)
        .map(({ id, doc }) => [id, doc.placement]),
    );
    for (const uid of ['dev-client-1', 'dev-client-5', 'dev-client-10']) {
      const bundled = domain.computeClientStats(
        domain.UserId.create(uid).value,
        book.appointments.map(
          ({ id, doc }) => domain.appointmentFromDocument(id, doc).value,
        ),
        NOW,
        domain.ClientStatsPolicy.default(),
        placements,
      );
      const ordinary = computeClientStats(
        UserId.create(uid).value,
        book.appointments.map(
          ({ id, doc }) => appointmentFromDocument(id, doc).value,
        ),
        NOW,
        ClientStatsPolicy.default(),
        placements,
      );
      expect(plain(bundled), uid).toEqual(plain(ordinary));
    }
  });

  it('holds every name the fold and the read-back are handed, each a function', () => {
    for (const name of Object.keys(direct)) {
      expect(typeof domain[name], name).toBe('function');
      expect(typeof direct[name], `${name}, imported the ordinary way`).toBe(
        'function',
      );
    }
  });

  it('names the engagement modules by their files, and each is there', () => {
    expect(Object.keys(SEED_DOMAIN_MODULES).sort()).toEqual([
      'couponPersistence',
      'giftVoucherDocument',
      'loyaltyDocument',
      'streakProjector',
    ]);
    for (const [name, module] of Object.entries(SEED_DOMAIN_MODULES)) {
      expect(existsSync(join(WORKSPACE_ROOT, `${module}.ts`)), name).toBe(true);
    }
  });

  it('bundles the client card’s readers, and they read what the card’s own import reads', () => {
    // The fixtures the card's specs render: the catalogue with the rule's
    // first version, and both accounts.
    const writes = [
      ...loyaltyCatalogWritesOf(loyaltyFixtures.catalog),
      ...loyaltyWritesOf('dev-client-1', loyaltyFixtures.georgi),
      ...loyaltyWritesOf('dev-client-2', loyaltyFixtures.martin),
    ];
    const bundled = readLoyaltyWrites(domain, writes);
    expect(bundled.problems).toEqual([]);
    expect(bundled.catalog).not.toBeNull();
    expect(bundled.ruleVersions).toHaveLength(1);
    expect(bundled.accounts).toHaveLength(2);
    expect(plain(bundled)).toEqual(plain(readLoyaltyWrites(direct, writes)));

    const { path, data } = waitlistRequestWriteOf(buildClientBook(NOW));
    const id = path.split('/').at(-1);
    expect(
      domain.waitlistToDocument(domain.waitlistFromDocument(id, data)),
    ).toEqual(waitlistToDocument(waitlistFromDocument(id, data)));
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
      expect(bundled.account.streaks.cadence, holder.uid).toBeDefined();
      expect(bundled).toEqual(fold(direct));
      // Every kind of row, read back by the bundle as by the barrel.
      const writes = loyaltyWritesOf(holder.uid, bundled);
      const read = readLoyaltyWrites(domain, writes);
      expect(read.problems).toEqual([]);
      expect(read.activity).toHaveLength(bundled.account.seq);
      expect(plain(read)).toEqual(plain(readLoyaltyWrites(direct, writes)));
    }
  });

  it('answers the state a rule and its facts give, as the ordinary import does', () => {
    const head = loyaltyFixtures.catalog.streakDefinitions.cadence;
    const facts = {
      visits: ['2026-05-04', '2026-06-10', '2026-08-20'].map((day) => ({
        day,
        counted: true,
      })),
      excused: [{ day: '2026-07-15', reason: 'barberAbsence' }],
      bookings: [
        { placedOn: '2026-09-20', day: '2026-10-08', appointmentId: 'appt-x' },
      ],
      pauses: [],
      grants: [{ day: '2026-06-10', count: 1 }],
    };
    const answers = [domain, direct].map((handed) => {
      const rule = handed
        .streakScheduleFromDocument('cadence', head)
        .value.inForceOn('2026-09-28');
      const trace = handed.traceStreak(rule, facts, '2026-09-28');
      expect(handed.projectStreak(rule, facts, '2026-09-28')).toEqual(
        trace.state,
      );
      return plain({
        ...trace,
        state: handed.streakStateToDocument(trace.state),
      });
    });
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0].state).toMatchObject({ streakId: 'cadence', current: 3 });
  });

  it('bundles the promotions’ mappers, and they read what the app’s own import reads', () => {
    const book = buildClientBook(NOW);
    const today = book.calendar.dayKeyAt(0);
    const writes = [
      ...couponWritesOf(),
      ...couponGrantWritesOf(book, loyaltyCatalogFor(today), today),
      ...giftVoucherWritesOf(book.calendar),
    ];
    const bundled = readPromotionWrites(domain, writes);
    expect(bundled.problems).toEqual([]);
    expect(bundled.coupons).toHaveLength(couponWritesOf().length);
    expect(plain(bundled)).toEqual(plain(readPromotionWrites(direct, writes)));
    // Both halves: what the bundle reads, it writes back as it was written.
    for (const { path, data } of writes) {
      const [collection, id] = path.split('/');
      if (collection === 'coupons') {
        expect(
          domain.couponToPersistence(
            domain.couponFromPersistence(id, data).value,
          ),
          path,
        ).toEqual(data);
      }
      if (collection === 'giftVouchers') {
        expect(
          domain.giftVoucherToDocument(
            domain.giftVoucherFromDocument(id, data),
          ),
          path,
        ).toEqual(giftVoucherToDocumentOrdinary(id, data));
      }
    }
  });
});

/** A voucher read and written back by the ordinary import. */
function giftVoucherToDocumentOrdinary(id, data) {
  return engagement.giftVoucherToDocument(
    engagement.giftVoucherFromDocument(id, data),
  );
}
