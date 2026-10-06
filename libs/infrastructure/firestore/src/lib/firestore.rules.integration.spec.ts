import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Coupon,
  CouponCombinability,
  CouponExpiry,
  CouponValue,
  StreakDefinition,
} from '@creativo/domain/engagement';
import {
  ACTIVITY_EFFECT_KINDS,
  GIFT_VOUCHER_HOLDER_FIELD,
  streakDefinitionVersionId,
} from '@creativo/application/engagement';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { createEmulatorTestEnv } from '../testing/emulator-test-env';
import {
  couponFromPersistence,
  couponToPersistence,
} from './coupon-persistence';

/**
 * A registered `users/{uid}` document, field for field what the functions'
 * user repository writes on `completeRegistration` — so a rule that admits
 * an edit of this shape admits the real save, and a refusal is about the
 * field under test, not a fixture that drifted.
 */
function registeredUser(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    phone: '+359888123456',
    firstName: 'Ivan',
    lastName: 'Petrov',
    roles: ['client'],
    status: { kind: 'active' },
    email: 'ivan@example.com',
    birthDate: null,
    searchName: 'ivan petrov',
    searchPrefixes: ['i', 'iv', 'iva', 'ivan', 'p', 'pe', 'pet', 'petr'],
    ...overrides,
  };
}

describe('firestore.rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-rules');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  /** A signed-in caller whose ID token carries exactly these role claims. */
  function signedIn(uid: string, ...roles: string[]): RulesTestContext {
    return testEnv.authenticatedContext(uid, { roles });
  }

  async function seed(
    path: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), data);
    });
  }

  describe('users/{uid} — owner-only', () => {
    it('lets a signed-in user read their own doc', async () => {
      const uid = 'user-1';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', uid), {
          roles: ['client'],
        });
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertSucceeds(getDoc(doc(alice.firestore(), 'users', uid)));
    });

    it('denies a signed-in user reading someone else’s doc', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), {
          roles: ['client'],
        });
      });
      const bob = testEnv.authenticatedContext('user-2');
      await assertFails(getDoc(doc(bob.firestore(), 'users', 'user-1')));
    });

    it('denies an anonymous (unauthenticated) read', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), {
          roles: ['client'],
        });
      });
      const anon = testEnv.unauthenticatedContext();
      await assertFails(getDoc(doc(anon.firestore(), 'users', 'user-1')));
    });

    it('lets the front desk read any client profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), {
          roles: ['client'],
        });
      });
      const receptionist = testEnv.authenticatedContext('staff-1', {
        roles: ['receptionist'],
      });
      await assertSucceeds(
        getDoc(doc(receptionist.firestore(), 'users', 'user-1')),
      );
    });

    it('denies self-registration with a non-client role', async () => {
      const uid = 'user-4';
      const alice = testEnv.authenticatedContext(uid);
      await assertFails(
        setDoc(doc(alice.firestore(), 'users', uid), { roles: ['admin'] }),
      );
    });

    it('denies a client self-granting an extra role via update', async () => {
      const uid = 'user-5';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', uid), {
          roles: ['client'],
          firstName: 'Alice',
        });
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertFails(
        updateDoc(doc(alice.firestore(), 'users', uid), {
          roles: ['client', 'admin'],
        }),
      );
    });

    it('lets a client update their own first name', async () => {
      const uid = 'user-6';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'users', uid),
          registeredUser({ firstName: 'Alice' }),
        );
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertSucceeds(
        updateDoc(doc(alice.firestore(), 'users', uid), {
          firstName: 'Alicia',
        }),
      );
    });
  });

  // ── client details P0: FIX 1, 2, 3, 5 and the client's statistics ─────

  describe('users/{uid} — who may GET a profile (FIX 5)', () => {
    beforeEach(async () => {
      await seed('users/client-1', registeredUser());
      await seed(
        'users/copy-1',
        registeredUser({ roles: ['content_manager'] }),
      );
    });

    it('lets the owner and a barber read the profile — the barber sees who is in the chair', async () => {
      await assertSucceeds(
        getDoc(doc(signedIn('client-1').firestore(), 'users', 'client-1')),
      );
      await assertSucceeds(
        getDoc(
          doc(signedIn('staff-1', 'barber').firestore(), 'users', 'client-1'),
        ),
      );
    });

    it("refuses a content manager another user's profile, and still lets them read their own", async () => {
      const copy = signedIn('copy-1', 'content_manager');
      await assertFails(getDoc(doc(copy.firestore(), 'users', 'client-1')));
      await assertSucceeds(getDoc(doc(copy.firestore(), 'users', 'copy-1')));
    });

    it('keeps LISTING to the front desk: a barber is refused, a receptionist admitted', async () => {
      await assertFails(
        getDocs(collection(signedIn('staff-1', 'barber').firestore(), 'users')),
      );
      await assertSucceeds(
        getDocs(
          collection(signedIn('staff-2', 'receptionist').firestore(), 'users'),
        ),
      );
    });
  });

  describe('users/{uid} — the owner edits an allowlist (FIX 2)', () => {
    const uid = 'client-1';

    beforeEach(async () => {
      await seed(`users/${uid}`, registeredUser());
    });

    it('lets the owner change their names, birth date and the search keys derived from them in one write', async () => {
      await assertSucceeds(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivo',
          lastName: 'Ivanov',
          birthDate: '1990-05-01',
          searchName: 'ivo ivanov',
          searchPrefixes: ['i', 'iv', 'ivo', 'iva', 'ivan', 'ivano', 'ivanov'],
        }),
      );
    });

    it.each<[string, unknown]>([
      ['roles', ['client', 'admin']],
      ['status', { kind: 'blocked', reason: 'manual', untilIso: null }],
      ['phone', '+359888000000'],
      ['email', 'someone-else@example.com'],
      // A key no one has allowlisted yet — the field a later phase adds is
      // closed the day it lands, which is the whole point of FIX 2.
      ['loyaltyTier', 'gold'],
    ])('refuses the owner writing %s', async (field, value) => {
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          [field]: value,
        }),
      );
    });

    it('refuses a name edit that smuggles a phone change into the same write', async () => {
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivo',
          phone: '+359888000000',
        }),
      );
    });

    it('refuses the owner lifting a status the server wrote', async () => {
      await seed(
        `users/${uid}`,
        registeredUser({
          status: { kind: 'blocked', reason: 'manual', untilIso: null },
        }),
      );
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          status: { kind: 'active' },
        }),
      );
    });

    it("lets the owner's name save through, leaving a server-written status untouched", async () => {
      const serverStatus = {
        kind: 'blocked',
        reason: 'manual',
        untilIso: '2026-10-12T00:00:00.000+03:00',
      };
      await seed(`users/${uid}`, registeredUser({ status: serverStatus }));

      await assertSucceeds(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivo',
          searchName: 'ivo petrov',
        }),
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snapshot = await getDoc(doc(ctx.firestore(), 'users', uid));
        expect(snapshot.data()?.['firstName']).toBe('Ivo');
        expect(snapshot.data()?.['status']).toEqual(serverStatus);
      });
    });

    /**
     * Why `saveProfile` moves from a whole-document `setDoc` to an
     * `updateDoc` of the edited fields: a full save re-sends every field the
     * mapper knows, so the moment the server holds a value the mapper would
     * write differently, the client's own name save is refused.
     */
    it('refuses a whole-document save that would rewrite a server-written field', async () => {
      await seed(
        `users/${uid}`,
        registeredUser({
          status: { kind: 'blocked', reason: 'manual', untilIso: null },
        }),
      );
      await assertFails(
        setDoc(
          doc(signedIn(uid).firestore(), 'users', uid),
          registeredUser({ firstName: 'Ivo' }),
        ),
      );
    });
  });

  describe('users/{uid} — no client-side admin write (FIX 3)', () => {
    beforeEach(async () => {
      await seed('users/client-1', registeredUser());
    });

    it.each(['admin', 'sysadmin'])(
      "refuses a %s writing another user's roles, status or names from the client SDK",
      async (role) => {
        const actor = signedIn('staff-1', role);
        const target = doc(actor.firestore(), 'users', 'client-1');
        await assertFails(updateDoc(target, { roles: ['client', 'barber'] }));
        await assertFails(
          updateDoc(target, {
            status: { kind: 'blocked', reason: 'manual', untilIso: null },
          }),
        );
        await assertFails(updateDoc(target, { firstName: 'Forged' }));
      },
    );

    it('refuses an admin widening their own roles through the owner path', async () => {
      await seed('users/staff-1', registeredUser({ roles: ['admin'] }));
      await assertFails(
        updateDoc(
          doc(signedIn('staff-1', 'admin').firestore(), 'users', 'staff-1'),
          {
            roles: ['admin', 'sysadmin'],
          },
        ),
      );
    });
  });

  /**
   * Registration is the `completeRegistration` callable on the Admin SDK,
   * and `verifyOtp` writes the contact-only stub before it — no client
   * creates this document, not even the plainest active `client` profile.
   */
  describe('users/{uid} — no client creates a profile', () => {
    it.each<[string, Record<string, unknown>]>([
      ['the full profile document', registeredUser()],
      ['a bare client role', { roles: ['client'] }],
      [
        'the contact-only stub',
        { email: 'ivan@example.com', phone: '+359888123456' },
      ],
    ])('refuses the owner creating %s', async (_, data) => {
      await assertFails(
        setDoc(doc(signedIn('user-10').firestore(), 'users', 'user-10'), data),
      );
    });

    it('refuses the front desk and an admin creating one for someone else', async () => {
      for (const role of ['receptionist', 'admin', 'sysadmin']) {
        await assertFails(
          setDoc(
            doc(signedIn('staff-1', role).firestore(), 'users', 'user-11'),
            registeredUser(),
          ),
        );
      }
    });
  });

  /**
   * The owner's name edit needs a STORED first name. The server reads a
   * non-blank `firstName` as "registration completed", so an onboarding
   * user writing one onto `verifyOtp`'s stub would register themselves
   * past `completeRegistration`.
   */
  describe('users/{uid} — only a registered owner edits their names', () => {
    const uid = 'client-2';
    const stub = { email: 'ivan@example.com', phone: '+359888123456' };

    it('refuses the owner of a contact-only stub adding a first and last name', async () => {
      await seed(`users/${uid}`, stub);
      const owner = doc(signedIn(uid).firestore(), 'users', uid);

      await assertFails(
        updateDoc(owner, {
          firstName: 'Ivan',
          lastName: 'Petrov',
          searchName: 'ivan petrov',
          searchPrefixes: ['i', 'iv', 'iva', 'ivan'],
        }),
      );
      await assertFails(updateDoc(owner, { firstName: 'Ivan' }));
      await assertFails(updateDoc(owner, { lastName: 'Petrov' }));
    });

    it('refuses the owner filling in a blank stored first name', async () => {
      await seed(`users/${uid}`, { ...stub, firstName: '  ', lastName: '' });
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivan',
        }),
      );
    });

    it('leaves the stub exactly as the server wrote it', async () => {
      await seed(`users/${uid}`, stub);
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivan',
        }),
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snapshot = await getDoc(doc(ctx.firestore(), 'users', uid));
        expect(snapshot.data()).toEqual(stub);
      });
    });

    it('still lets a registered owner edit their names', async () => {
      await seed(`users/${uid}`, registeredUser());
      await assertSucceeds(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivo',
          lastName: 'Ivanov',
          searchName: 'ivo ivanov',
          searchPrefixes: ['i', 'iv', 'ivo', 'iva', 'ivan', 'ivano', 'ivanov'],
        }),
      );
    });
  });

  /**
   * A blanked first name reads as UNregistered server-side, which would
   * send the owner back through `completeRegistration`; the values must
   * stay a profile the accounts domain accepts.
   */
  describe('users/{uid} — the owner cannot unregister themselves', () => {
    const uid = 'client-3';

    beforeEach(async () => {
      await seed(`users/${uid}`, registeredUser());
    });

    it.each<[string, Record<string, unknown>]>([
      ['a blank first name', { firstName: '' }],
      ['a whitespace first name', { firstName: '   ' }],
      ['a one-letter first name', { firstName: 'I' }],
      ['a first name that is not a string', { firstName: 42 }],
      ['a deleted first name', { firstName: deleteField() }],
      ['a blank last name', { lastName: ' ' }],
      ['a one-letter last name', { lastName: 'P' }],
      ['a deleted last name', { lastName: deleteField() }],
      ['a birth date that is not a calendar date', { birthDate: '01.05.1990' }],
      ['a birth date that is not a string', { birthDate: 19900501 }],
      ['search keys of the wrong type', { searchPrefixes: 'ivan' }],
    ])('refuses %s', async (_label, patch) => {
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), patch),
      );
    });

    it.each<[string, Record<string, unknown>]>([
      ['a two-letter first name', { firstName: 'Iv' }],
      ['a cleared birth date', { birthDate: null }],
      ['an ISO birth date', { birthDate: '1990-05-01' }],
    ])('admits %s', async (_label, patch) => {
      await assertSucceeds(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), patch),
      );
    });
  });

  describe('programs (positions/courses/events) — public read, content-manager write', () => {
    it.each(['positions', 'courses', 'events'])(
      'lets an anonymous, unauthenticated visitor read %s',
      async (collectionName) => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), collectionName, 'doc-1'), {
            title: { en: 'Title', bg: 'Заглавие' },
          });
        });
        const anon = testEnv.unauthenticatedContext();
        await assertSucceeds(
          getDoc(doc(anon.firestore(), collectionName, 'doc-1')),
        );
      },
    );

    it.each(['positions', 'courses', 'events'])(
      'denies a plain client from writing %s',
      async (collectionName) => {
        const client = testEnv.authenticatedContext('client-1', {
          roles: ['client'],
        });
        await assertFails(
          setDoc(doc(client.firestore(), collectionName, 'doc-2'), {
            title: { en: 'Title', bg: 'Заглавие' },
          }),
        );
      },
    );

    it.each(['positions', 'courses', 'events'])(
      'lets a content_manager write %s',
      async (collectionName) => {
        const manager = testEnv.authenticatedContext('manager-1', {
          roles: ['content_manager'],
        });
        await assertSucceeds(
          setDoc(doc(manager.firestore(), collectionName, 'doc-3'), {
            title: { en: 'Title', bg: 'Заглавие' },
          }),
        );
      },
    );
  });

  describe('server-only collections', () => {
    it.each(['otps', 'rateLimits', 'blocklist'])(
      'denies every client read/write on %s',
      async (collectionName) => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), collectionName, 'doc-1'), {
            any: 'value',
          });
        });
        const admin = testEnv.authenticatedContext('admin-1', {
          roles: ['admin'],
        });
        await assertFails(
          getDoc(doc(admin.firestore(), collectionName, 'doc-1')),
        );
        await assertFails(
          setDoc(doc(admin.firestore(), collectionName, 'doc-2'), {
            any: 'value',
          }),
        );
      },
    );
  });

  describe('barberLeadTimeSamples — staff read, server-only write', () => {
    const sampleId = 'ivan__2026-08-05';

    async function seedSample(): Promise<void> {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'barberLeadTimeSamples', sampleId), {
          barberId: 'ivan',
          dayKey: '2026-08-05',
          leadTimeDays: 2,
        });
      });
    }

    it('lets a staff member read a sample', async () => {
      await seedSample();
      const barber = testEnv.authenticatedContext('staff-1', {
        roles: ['barber'],
      });
      await assertSucceeds(
        getDoc(doc(barber.firestore(), 'barberLeadTimeSamples', sampleId)),
      );
    });

    /**
     * Unlike the `capacity` rollup it is derived from, this is NOT public. A
     * lead-time series says how heavily booked the shop is and which way that
     * is trending — commercial intelligence a competitor would price against,
     * and nothing a client needs in order to book.
     */
    it('denies an anonymous visitor and a plain client', async () => {
      await seedSample();
      const anon = testEnv.unauthenticatedContext();
      await assertFails(
        getDoc(doc(anon.firestore(), 'barberLeadTimeSamples', sampleId)),
      );
      const client = testEnv.authenticatedContext('client-1', {
        roles: ['client'],
      });
      await assertFails(
        getDoc(doc(client.firestore(), 'barberLeadTimeSamples', sampleId)),
      );
    });

    it('refuses every client write, staff and admin included', async () => {
      for (const roles of [['barber'], ['admin']]) {
        const actor = testEnv.authenticatedContext(`actor-${roles[0]}`, {
          roles,
        });
        await assertFails(
          setDoc(
            doc(actor.firestore(), 'barberLeadTimeSamples', 'ivan__2026-08-06'),
            { barberId: 'ivan', leadTimeDays: 0 },
          ),
        );
      }
    });
  });

  // ── the booking-critical rules the audit found untested (F26) ─────────

  describe('settings — public read, admin write', () => {
    it('lets an anonymous visitor read the booking policy', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'settings', 'bookingPolicy'), {
          horizonMonths: 2,
        });
      });
      const anon = testEnv.unauthenticatedContext();
      await assertSucceeds(
        getDoc(doc(anon.firestore(), 'settings', 'bookingPolicy')),
      );
    });

    it('refuses a non-admin write to settings', async () => {
      const barber = testEnv.authenticatedContext('staff-1', {
        roles: ['barber'],
      });
      await assertFails(
        setDoc(doc(barber.firestore(), 'settings', 'bookingPolicy'), {
          horizonMonths: 12,
        }),
      );
    });
  });

  describe('scheduleExceptions — public read, staff write', () => {
    it('lets an anonymous visitor read an exception, and a client not write one', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'scheduleExceptions', 'ivan__2026-09-01'),
          {
            barberId: 'ivan',
            dayKey: '2026-09-01',
            zone: 'Europe/Sofia',
            locationId: 'loc-center',
            effect: { kind: 'closed' },
          },
        );
      });
      const anon = testEnv.unauthenticatedContext();
      await assertSucceeds(
        getDoc(doc(anon.firestore(), 'scheduleExceptions', 'ivan__2026-09-01')),
      );
      const client = testEnv.authenticatedContext('user-1', {
        roles: ['client'],
      });
      await assertFails(
        setDoc(
          doc(client.firestore(), 'scheduleExceptions', 'ivan__2026-09-02'),
          {
            barberId: 'ivan',
            dayKey: '2026-09-02',
            zone: 'Europe/Sofia',
            locationId: 'loc-center',
            effect: { kind: 'closed' },
          },
        ),
      );
    });
  });

  describe('couponGrants — the owner, and the book (2026-09-10)', () => {
    const grant = {
      id: 'grant-1',
      userId: 'client-1',
      couponId: 'coupon-1',
      value: { kind: 'percent_off', percent: 20 },
      grantedAt: '2026-09-01T09:00:00.000Z',
      state: {
        kind: 'active',
        capacity: { kind: 'single_use' },
        expiration: { kind: 'no_expiry' },
      },
    };

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'couponGrants', 'grant-1'), grant);
      });
    });

    it('lets the owner and a barber read a grant — the barber honours it at the chair', async () => {
      const owner = testEnv.authenticatedContext('client-1');
      await assertSucceeds(
        getDoc(doc(owner.firestore(), 'couponGrants', 'grant-1')),
      );
      const barber = testEnv.authenticatedContext('staff-1', {
        roles: ['barber'],
      });
      await assertSucceeds(
        getDoc(doc(barber.firestore(), 'couponGrants', 'grant-1')),
      );
      await assertSucceeds(
        getDocs(
          query(
            collection(barber.firestore(), 'couponGrants'),
            where('userId', '==', 'client-1'),
          ),
        ),
      );
    });

    it("denies another client, a content manager and an anonymous visitor someone else's grant", async () => {
      const other = testEnv.authenticatedContext('client-2');
      await assertFails(
        getDoc(doc(other.firestore(), 'couponGrants', 'grant-1')),
      );
      const copy = testEnv.authenticatedContext('staff-2', {
        roles: ['content_manager'],
      });
      await assertFails(
        getDoc(doc(copy.firestore(), 'couponGrants', 'grant-1')),
      );
      const anon = testEnv.unauthenticatedContext();
      await assertFails(
        getDoc(doc(anon.firestore(), 'couponGrants', 'grant-1')),
      );
    });
  });

  describe('giftVouchers — the holder, the book, and nobody writes (2026-09-10)', () => {
    const voucher = {
      code: 'GIFT2025',
      initialValueMinorUnits: 2500,
      balanceMinorUnits: 2500,
      currencyCode: 'EUR',
      issuedAt: { iso: '2026-09-01T09:00:00.000+03:00', zone: 'Europe/Sofia' },
      expiresAt: null,
      issuedToUserId: 'client-1',
      state: { kind: 'active' },
    };

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'giftVouchers', 'v1'), voucher);
      });
    });

    it('lets the holder and a barber read a voucher, by id and by code', async () => {
      const holder = testEnv.authenticatedContext('client-1');
      await assertSucceeds(
        getDoc(doc(holder.firestore(), 'giftVouchers', 'v1')),
      );
      const barber = testEnv.authenticatedContext('staff-1', {
        roles: ['barber'],
      });
      await assertSucceeds(
        getDoc(doc(barber.firestore(), 'giftVouchers', 'v1')),
      );
      await assertSucceeds(
        getDocs(
          query(
            collection(barber.firestore(), 'giftVouchers'),
            where('code', '==', 'GIFT2025'),
          ),
        ),
      );
    });

    it("denies another client, an anonymous visitor, and every client-side write — even the book's", async () => {
      const other = testEnv.authenticatedContext('client-2');
      await assertFails(getDoc(doc(other.firestore(), 'giftVouchers', 'v1')));
      const anon = testEnv.unauthenticatedContext();
      await assertFails(getDoc(doc(anon.firestore(), 'giftVouchers', 'v1')));
      const admin = testEnv.authenticatedContext('staff-2', {
        roles: ['admin'],
      });
      await assertFails(
        updateDoc(doc(admin.firestore(), 'giftVouchers', 'v1'), {
          balanceMinorUnits: 0,
        }),
      );
    });
  });

  describe('waitlistRequests — callable-only writes', () => {
    it('refuses the owner direct status flip the callable replaced', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'waitlistRequests', 'wl-1'), {
          ownerUserId: 'user-1',
          status: 'open',
          dayKeys: ['2026-09-01'],
        });
      });
      const owner = testEnv.authenticatedContext('user-1', {
        roles: ['client'],
      });
      await assertFails(
        updateDoc(doc(owner.firestore(), 'waitlistRequests', 'wl-1'), {
          status: 'cancelled',
        }),
      );
    });
  });

  describe('auditLog — admins read, only the server writes (FIX 1)', () => {
    // The persisted row shape (`auditEntryToDocument`).
    const row = {
      actor: { kind: 'admin', adminUserId: 'staff-1' },
      action: 'profile.updated',
      at: '2026-09-25T10:00:00.000Z',
      targetUserId: 'client-1',
      resourceId: 'client-1',
      context: null,
    };

    it.each(['admin', 'sysadmin'])(
      'refuses a %s client appending an audit row',
      async (role) => {
        await assertFails(
          setDoc(
            doc(signedIn('staff-1', role).firestore(), 'auditLog', 'row-2'),
            row,
          ),
        );
      },
    );

    it("lets an admin read a client's trail, by id and by the per-client query", async () => {
      await seed('auditLog/row-1', row);
      const admin = signedIn('staff-1', 'admin');
      await assertSucceeds(getDoc(doc(admin.firestore(), 'auditLog', 'row-1')));
      await assertSucceeds(
        getDocs(
          query(
            collection(admin.firestore(), 'auditLog'),
            where('targetUserId', '==', 'client-1'),
          ),
        ),
      );
    });

    it.each(['receptionist', 'barber', 'content_manager', 'client'])(
      'refuses a %s reading the trail',
      async (role) => {
        await seed('auditLog/row-1', row);
        await assertFails(
          getDoc(
            doc(signedIn('user-1', role).firestore(), 'auditLog', 'row-1'),
          ),
        );
      },
    );

    it('refuses an admin rewriting or deleting a row', async () => {
      await seed('auditLog/row-1', row);
      const target = doc(
        signedIn('staff-1', 'admin').firestore(),
        'auditLog',
        'row-1',
      );
      await assertFails(updateDoc(target, { action: 'nothing.happened' }));
      await assertFails(deleteDoc(target));
    });
  });

  describe('clientStats — the book reads, only the server writes', () => {
    // A trimmed `ClientStats`: rules check who, never the shape.
    const stats = {
      userId: 'client-1',
      lifetime: {
        visitsCompleted: 23,
        noShows: 1,
        lateCancels: 0,
        clientCancels: 2,
      },
      avgCadenceDays: 28,
      version: 4,
      updatedAt: '2026-09-25T10:00:00.000Z',
    };

    beforeEach(async () => {
      await seed('clientStats/client-1', stats);
    });

    it.each(['barber', 'receptionist', 'admin', 'sysadmin'])(
      "lets a %s read a client's statistics",
      async (role) => {
        await assertSucceeds(
          getDoc(
            doc(
              signedIn('staff-1', role).firestore(),
              'clientStats',
              'client-1',
            ),
          ),
        );
      },
    );

    it('refuses the client they describe, a content manager and an anonymous visitor', async () => {
      await assertFails(
        getDoc(
          doc(
            signedIn('client-1', 'client').firestore(),
            'clientStats',
            'client-1',
          ),
        ),
      );
      await assertFails(
        getDoc(
          doc(
            signedIn('copy-1', 'content_manager').firestore(),
            'clientStats',
            'client-1',
          ),
        ),
      );
      await assertFails(
        getDoc(
          doc(
            testEnv.unauthenticatedContext().firestore(),
            'clientStats',
            'client-1',
          ),
        ),
      );
    });

    it.each<[string, string]>([
      ['client-1', 'client'],
      ['staff-1', 'barber'],
      ['staff-2', 'receptionist'],
      ['staff-3', 'admin'],
      ['staff-4', 'sysadmin'],
    ])('refuses a client-side write by %s (%s)', async (uid, role) => {
      const db = signedIn(uid, role).firestore();
      await assertFails(
        setDoc(doc(db, 'clientStats', 'client-1'), { ...stats, version: 5 }),
      );
      await assertFails(
        setDoc(doc(db, 'clientStats', 'client-2'), {
          ...stats,
          userId: 'client-2',
        }),
      );
    });
  });

  describe('clientStats/{uid}/restricted — lifetime spend is the shop admin’s alone', () => {
    const moneyPath = 'clientStats/client-1/restricted/money';
    const money = {
      userId: 'client-1',
      lifetimeSpendMinor: 64_000,
      version: 4,
      updatedAt: '2026-09-25T10:00:00.000Z',
    };

    beforeEach(async () => {
      await seed(moneyPath, money);
    });

    it('lets the shop admin read lifetime spend', async () => {
      await assertSucceeds(
        getDoc(doc(signedIn('staff-1', 'admin').firestore(), moneyPath)),
      );
    });

    /**
     * Rules do not cascade: the parent's `worksTheBook()` read does not reach
     * this subcollection, so a barber who reads the stats whole still never
     * sees the spend — and sysadmin, a support role, is left out on purpose.
     */
    it.each<[string, string]>([
      ['staff-2', 'barber'],
      ['staff-3', 'receptionist'],
      ['staff-4', 'sysadmin'],
      ['copy-1', 'content_manager'],
      ['client-1', 'client'],
    ])('refuses %s (%s)', async (uid, role) => {
      await assertFails(
        getDoc(doc(signedIn(uid, role).firestore(), moneyPath)),
      );
    });

    it('refuses every client-side write, the admin’s included', async () => {
      for (const role of ['admin', 'sysadmin']) {
        await assertFails(
          setDoc(doc(signedIn('staff-1', role).firestore(), moneyPath), {
            ...money,
            lifetimeSpendMinor: 0,
          }),
        );
      }
    });
  });

  describe('the loyalty catalogue — anyone signed in reads, nobody writes (2026-09-28)', () => {
    // Trimmed documents: rules check who, never the shape.
    const catalogue = [
      ['badgeCategories/cat-mastery', { kind: 'mastery', order: 2 }],
      ['badgeSeries/series-svc-fade', { categoryId: 'cat-mastery', order: 7 }],
      ['seasons/season-2026-autumn', { kind: 'season', version: 1 }],
      ['tierDefinitions/gold', { rank: 2, version: 1 }],
      ['rewardsCatalog/reward-beard', { cost: 120, enabled: true }],
      ['streakDefinitions/cadence', { graceDays: 7, version: 1 }],
    ] as const;

    beforeEach(async () => {
      for (const [path, data] of catalogue) await seed(path, data);
    });

    it.each(catalogue.map(([path]) => path))(
      'lets a client and a barber read %s, and refuses an anonymous visitor',
      async (path) => {
        await assertSucceeds(
          getDoc(doc(signedIn('client-1', 'client').firestore(), path)),
        );
        await assertSucceeds(
          getDoc(doc(signedIn('staff-1', 'barber').firestore(), path)),
        );
        await assertFails(
          getDoc(doc(testEnv.unauthenticatedContext().firestore(), path)),
        );
      },
    );

    it('lets a signed-in client list a whole catalogue collection', async () => {
      await assertSucceeds(
        getDocs(
          collection(signedIn('client-1', 'client').firestore(), 'badgeSeries'),
        ),
      );
    });

    it.each(catalogue.map(([path]) => path))(
      'refuses a client-side write to %s, the admin’s included',
      async (path) => {
        await assertFails(
          setDoc(doc(signedIn('staff-1', 'admin').firestore(), path), {
            order: 0,
          }),
        );
        await assertFails(
          deleteDoc(doc(signedIn('staff-2', 'sysadmin').firestore(), path)),
        );
      },
    );
  });

  describe('loyaltyAccounts — the book reads a client’s loyalty, only the server writes it (2026-09-28)', () => {
    const accountPath = 'loyaltyAccounts/client-1';
    const progressPath = `${accountPath}/badgeProgress/series-svc-fade`;
    const trackPath = `${accountPath}/seasonProgress/season-2026-autumn`;

    beforeEach(async () => {
      await seed(accountPath, { userId: 'client-1', balance: 358, seq: 35 });
      await seed(progressPath, { value: 24, earned: [] });
      await seed(trackPath, { trackValue: 2, trackLevel: 2 });
    });

    it.each(['barber', 'receptionist', 'admin', 'sysadmin'])(
      "lets a %s read a client's account, progress and season track",
      async (role) => {
        const db = signedIn('staff-1', role).firestore();
        await assertSucceeds(getDoc(doc(db, accountPath)));
        await assertSucceeds(getDoc(doc(db, progressPath)));
        await assertSucceeds(getDoc(doc(db, trackPath)));
        await assertSucceeds(
          getDocs(collection(db, accountPath, 'badgeProgress')),
        );
      },
    );

    it('refuses the client they describe (until their own view), a content manager and an anonymous visitor', async () => {
      for (const db of [
        signedIn('client-1', 'client').firestore(),
        signedIn('copy-1', 'content_manager').firestore(),
        testEnv.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(getDoc(doc(db, accountPath)));
        await assertFails(getDoc(doc(db, progressPath)));
        await assertFails(getDoc(doc(db, trackPath)));
      }
    });

    it.each<[string, string]>([
      ['client-1', 'client'],
      ['staff-1', 'barber'],
      ['staff-2', 'admin'],
      ['staff-3', 'sysadmin'],
    ])('refuses a client-side write by %s (%s)', async (uid, role) => {
      const db = signedIn(uid, role).firestore();
      await assertFails(setDoc(doc(db, accountPath), { balance: 9999 }));
      await assertFails(
        setDoc(doc(db, progressPath), { value: 25, earned: [] }),
      );
      await assertFails(
        setDoc(doc(db, trackPath), { trackValue: 5, trackLevel: 5 }),
      );
    });
  });

  describe('clientJournal — the book reads client-visible rows only (2026-09-28)', () => {
    const pointRow = {
      userId: 'client-1',
      seq: 1,
      visibility: 'client',
      effect: { kind: 'points', delta: 17 },
    };
    const staffRow = {
      userId: 'client-1',
      seq: 2,
      visibility: 'staff',
      effect: { kind: 'pause', op: 'applied' },
    };

    beforeEach(async () => {
      await seed('clientJournal/client-1_000001', pointRow);
      await seed('clientJournal/client-1_000002', staffRow);
    });

    it('lets the book read a client-visible row, and never a staff row', async () => {
      const db = signedIn('staff-1', 'barber').firestore();
      await assertSucceeds(getDoc(doc(db, 'clientJournal/client-1_000001')));
      await assertFails(getDoc(doc(db, 'clientJournal/client-1_000002')));
    });

    it('lets the ledger query through only with its visibility filter', async () => {
      const db = signedIn('staff-1', 'receptionist').firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, 'clientJournal'),
            where('userId', '==', 'client-1'),
            where('visibility', '==', 'client'),
            where('effect.kind', '==', 'points'),
          ),
        ),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, 'clientJournal'),
            where('userId', '==', 'client-1'),
          ),
        ),
      );
    });

    it('refuses the client, a content manager and an anonymous visitor', async () => {
      for (const db of [
        signedIn('client-1', 'client').firestore(),
        signedIn('copy-1', 'content_manager').firestore(),
        testEnv.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(getDoc(doc(db, 'clientJournal/client-1_000001')));
      }
    });

    it('refuses every client-side write — the journal is append-only, and the server’s', async () => {
      for (const role of ['barber', 'admin', 'sysadmin']) {
        const db = signedIn('staff-1', role).firestore();
        await assertFails(
          setDoc(doc(db, 'clientJournal/client-1_000003'), {
            ...pointRow,
            seq: 3,
          }),
        );
        await assertFails(deleteDoc(doc(db, 'clientJournal/client-1_000001')));
      }
    });
  });

  describe('streakDefinitions — staff read the rule, the admin pair reads its history, the server publishes (2026-09-29)', () => {
    const headPath = 'streakDefinitions/cadence';
    const versionsPath = `${headPath}/versions`;
    const firstPath = `${versionsPath}/${streakDefinitionVersionId(1)}`;
    const secondPath = `${versionsPath}/${streakDefinitionVersionId(2)}`;

    /**
     * The rule's documents as the callable leaves them: the seeded head
     * and its first version, then one publish that waits (grace from 7
     * days to 10, from 5.10). Written by the port's reference, so the
     * rules are held to the documents the server writes.
     */
    async function published(): Promise<{
      head: object;
      versions: Readonly<Record<string, object>>;
    }> {
      const revised = StreakDefinition.default().revise(
        { graceDays: 10 },
        '2026-10-05',
      );
      if (revised.isFailure()) throw new Error('bad fixture rule');
      const reference = InMemoryStreakDefinitionRepository.seeded({
        today: loyaltyFixtures.today,
      });
      const written = await reference.publish({
        requestId: 'req-wider-grace',
        baseVersion: 1,
        definition: revised.value,
        transition: 'grandfather',
        previewHash: null,
      });
      if (written.isFailure()) throw written.error;
      const documents = reference.documentsOf('cadence');
      if (documents === null) throw new Error('the reference holds no rule');
      return documents;
    }

    /** The newest versions first, as the repository asks for the history. */
    const history = (db: ReturnType<RulesTestContext['firestore']>) =>
      getDocs(
        query(
          collection(db, versionsPath),
          orderBy('version', 'desc'),
          limit(20),
        ),
      );

    beforeEach(async () => {
      const { head, versions } = await published();
      await seed(headPath, { ...head });
      for (const [id, version] of Object.entries(versions)) {
        await seed(`${versionsPath}/${id}`, { ...version });
      }
    });

    // §4.3, case 1.
    it('lets a barber read the head, and refuses them a version', async () => {
      const db = signedIn('staff-1', 'barber').firestore();
      await assertSucceeds(getDoc(doc(db, headPath)));
      await assertFails(getDoc(doc(db, firstPath)));
      await assertFails(getDoc(doc(db, secondPath)));
      await assertFails(history(db));
      await assertFails(getDocs(collection(db, versionsPath)));
    });

    // §4.3, case 2.
    it.each(['admin', 'sysadmin'])(
      'lets an %s read a version, and the history newest first',
      async (role) => {
        const db = signedIn('staff-2', role).firestore();
        await assertSucceeds(getDoc(doc(db, headPath)));
        await assertSucceeds(getDoc(doc(db, firstPath)));
        const listed = await assertSucceeds(history(db));
        expect(listed.docs.map((entry) => entry.id)).toEqual([
          '000002',
          '000001',
        ]);
        expect(listed.docs[0]?.data()).toMatchObject({
          version: 2,
          graceDays: 10,
          effectiveFrom: '2026-10-05',
          requestId: 'req-wider-grace',
          withdrawnAt: null,
        });
      },
    );

    // §4.3, case 3.
    it.each(['admin', 'sysadmin'])(
      'refuses an %s’s CLIENT write, to the head and to a version: a rule is published by the callable',
      async (role) => {
        const db = signedIn('staff-2', role).firestore();
        const { head, versions } = await published();
        await assertFails(setDoc(doc(db, headPath), { ...head }));
        await assertFails(updateDoc(doc(db, headPath), { scheduled: null }));
        await assertFails(deleteDoc(doc(db, headPath)));
        await assertFails(
          setDoc(doc(db, 'streakDefinitions/another'), { ...head }),
        );
        await assertFails(
          setDoc(doc(db, `${versionsPath}/000003`), {
            ...versions['000002'],
            version: 3,
          }),
        );
        // The one field of a version that is ever set later is the server's too.
        await assertFails(
          updateDoc(doc(db, secondPath), {
            withdrawnAt: '2026-09-29T08:00:00.000Z',
          }),
        );
        await assertFails(deleteDoc(doc(db, firstPath)));
      },
    );

    // §4.3, case 4.
    it('refuses an anonymous read, of the head and of a version', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, headPath)));
      await assertFails(getDoc(doc(db, firstPath)));
      await assertFails(history(db));
    });

    it('lets the rest of the staff and a client read the head, and none of them a version', async () => {
      for (const [uid, role] of [
        ['staff-3', 'receptionist'],
        ['copy-1', 'content_manager'],
        ['client-1', 'client'],
      ] as const) {
        const db = signedIn(uid, role).firestore();
        await assertSucceeds(getDoc(doc(db, headPath)));
        await assertFails(getDoc(doc(db, firstPath)));
        await assertFails(history(db));
      }
    });

    it('refuses every other client-side write, whoever signs in', async () => {
      for (const [uid, role] of [
        ['staff-1', 'barber'],
        ['staff-3', 'receptionist'],
        ['client-1', 'client'],
      ] as const) {
        const db = signedIn(uid, role).firestore();
        await assertFails(updateDoc(doc(db, headPath), { scheduled: null }));
        await assertFails(updateDoc(doc(db, firstPath), { publishedBy: uid }));
      }
    });
  });

  describe('coupons — an admin’s save keeps what the coupon is given for (2026-09-29)', () => {
    const couponPath = 'coupons/coupon-birthday';

    function birthday(percent: number): Coupon {
      const value = CouponValue.percentOff(percent);
      const expiry = CouponExpiry.days(30);
      if (value.isFailure() || expiry.isFailure()) {
        throw new Error('bad fixture coupon');
      }
      const coupon = Coupon.create({
        id: 'coupon-birthday',
        name: 'Рожден ден',
        value: value.value,
        combinability: CouponCombinability.exclusive(),
        expiry: expiry.value,
        enabled: true,
        occasion: 'birthday',
      });
      if (coupon.isFailure()) throw new Error('bad fixture coupon');
      return coupon.value;
    }

    async function stored(
      db: ReturnType<RulesTestContext['firestore']>,
    ): Promise<Coupon> {
      const snapshot = await assertSucceeds(getDoc(doc(db, couponPath)));
      const coupon = couponFromPersistence(snapshot.id, snapshot.data() ?? {});
      if (coupon.isFailure()) throw coupon.error;
      return coupon.value;
    }

    it('round-trips the occasion through an admin’s edit of the birthday coupon', async () => {
      // As the seed writes it.
      await seed(couponPath, couponToPersistence(birthday(20)));
      const admin = signedIn('staff-2', 'admin').firestore();

      // The editor reads the coupon, changes the figure, saves the whole document.
      const read = await stored(admin);
      expect(read.occasion).toBe('birthday');
      const edited = Coupon.create({
        id: read.id.value,
        name: read.name,
        value: birthday(25).value,
        combinability: read.combinability,
        expiry: read.expiry,
        enabled: read.enabled,
        code: read.code,
        occasion: read.occasion,
      });
      if (edited.isFailure()) throw new Error('bad edit');
      await assertSucceeds(
        setDoc(doc(admin, couponPath), couponToPersistence(edited.value)),
      );

      // What the card reads afterwards: the gift is still the birthday's.
      const back = await stored(signedIn('staff-1', 'barber').firestore());
      expect(back.occasion).toBe('birthday');
      expect(couponToPersistence(back)).toEqual(
        couponToPersistence(birthday(25)),
      );
    });

    it('reads a coupon written before occasions existed as tied to none, and writes the field back', async () => {
      await seed(
        couponPath,
        Object.fromEntries(
          Object.entries(couponToPersistence(birthday(20))).filter(
            ([field]) => field !== 'occasion',
          ),
        ),
      );
      const admin = signedIn('staff-2', 'admin').firestore();

      const read = await stored(admin);
      expect(read.occasion).toBeNull();
      await assertSucceeds(
        setDoc(doc(admin, couponPath), couponToPersistence(read)),
      );

      const snapshot = await assertSucceeds(getDoc(doc(admin, couponPath)));
      expect(snapshot.data()).toHaveProperty('occasion', null);
    });

    it('refuses the save to everyone but the admin pair', async () => {
      await seed(couponPath, couponToPersistence(birthday(20)));
      for (const [uid, role] of [
        ['staff-1', 'barber'],
        ['staff-3', 'receptionist'],
        ['client-1', 'client'],
      ] as const) {
        await assertFails(
          updateDoc(doc(signedIn(uid, role).firestore(), couponPath), {
            occasion: null,
          }),
        );
      }
    });
  });

  describe('the card’s new reads: a holder’s vouchers, the activity, the shop’s statistics (2026-09-29)', () => {
    const voucher = (holder: string | null, code: string) => ({
      code,
      initialValueMinorUnits: 5000,
      balanceMinorUnits: 2500,
      currencyCode: 'EUR',
      issuedAt: { iso: '2026-06-13T10:45:00.000+03:00', zone: 'Europe/Sofia' },
      expiresAt: null,
      issuedToUserId: holder,
      state: { kind: 'active' },
    });

    const journalRow = (
      seq: number,
      kind: string,
      visibility: 'client' | 'staff' = 'client',
    ) => ({ userId: 'client-1', seq, visibility, effect: { kind } });

    beforeEach(async () => {
      await seed('giftVouchers/v-georgi', voucher('client-1', 'GIFT50'));
      await seed('giftVouchers/v-martin', voucher('client-2', 'GIFT2025'));
      await seed('giftVouchers/v-paper', voucher(null, 'GIFT5'));
      await seed('clientJournal/client-1_000001', journalRow(1, 'points'));
      await seed('clientJournal/client-1_000002', journalRow(2, 'tier'));
      await seed('clientJournal/client-1_000003', journalRow(3, 'reward'));
      await seed('clientJournal/client-1_000004', journalRow(4, 'redemption'));
      await seed('clientJournal/client-1_000005', journalRow(5, 'achievement'));
      await seed('clientJournal/client-1_000006', journalRow(6, 'streak'));
      await seed(
        'clientJournal/client-1_000007',
        journalRow(7, 'pause', 'staff'),
      );
      for (const uid of ['client-1', 'client-2', 'client-3']) {
        await seed(`clientStats/${uid}`, { userId: uid, version: 1 });
        await seed(`clientStats/${uid}/restricted/money`, {
          userId: uid,
          lifetimeSpendMinor: 12_000,
        });
      }
    });

    const heldBy = (
      db: ReturnType<RulesTestContext['firestore']>,
      holder: string,
    ) =>
      getDocs(
        query(
          collection(db, 'giftVouchers'),
          where(GIFT_VOUCHER_HOLDER_FIELD, '==', holder),
        ),
      );

    it('lets the book list the vouchers a client holds, and the client their own', async () => {
      const barber = await assertSucceeds(
        heldBy(signedIn('staff-1', 'barber').firestore(), 'client-1'),
      );
      expect(barber.docs.map((entry) => entry.id)).toEqual(['v-georgi']);

      const holder = await assertSucceeds(
        heldBy(signedIn('client-1', 'client').firestore(), 'client-1'),
      );
      expect(holder.docs.map((entry) => entry.id)).toEqual(['v-georgi']);
    });

    it('refuses a client the list of somebody else’s vouchers, and an anonymous visitor any', async () => {
      await assertFails(
        heldBy(signedIn('client-1', 'client').firestore(), 'client-2'),
      );
      await assertFails(
        heldBy(testEnv.unauthenticatedContext().firestore(), 'client-1'),
      );
    });

    /** The activity's query for one pill, given as the effects the pill holds. */
    const activity = (
      db: ReturnType<RulesTestContext['firestore']>,
      effects: readonly string[],
      after: number | null = null,
    ) =>
      getDocs(
        query(
          collection(db, 'clientJournal'),
          where('userId', '==', 'client-1'),
          where('visibility', '==', 'client'),
          where('effect.kind', 'in', [...effects]),
          orderBy('seq', 'desc'),
          ...(after === null ? [] : [startAfter(after)]),
          limit(3),
        ),
      );

    it('lets the activity’s query through: every pill, newest first, older than the cursor', async () => {
      const db = signedIn('staff-1', 'barber').firestore();

      const { all, rewards, status } = ACTIVITY_EFFECT_KINDS;

      const newest = await assertSucceeds(activity(db, all));
      expect(newest.docs.map((entry) => entry.data()['seq'])).toEqual([
        5, 4, 3,
      ]);
      const older = await assertSucceeds(activity(db, all, 3));
      expect(older.docs.map((entry) => entry.data()['seq'])).toEqual([2, 1]);
      const given = await assertSucceeds(activity(db, rewards));
      expect(given.docs.map((entry) => entry.data()['seq'])).toEqual([4, 3]);
      const tier = await assertSucceeds(activity(db, status));
      expect(tier.docs.map((entry) => entry.data()['seq'])).toEqual([2]);
    });

    it('refuses the activity’s query without its visibility filter, and to the client', async () => {
      await assertFails(
        getDocs(
          query(
            collection(
              signedIn('staff-1', 'barber').firestore(),
              'clientJournal',
            ),
            where('userId', '==', 'client-1'),
            where('effect.kind', 'in', [...ACTIVITY_EFFECT_KINDS.all]),
            orderBy('seq', 'desc'),
          ),
        ),
      );
      await assertFails(
        activity(
          signedIn('client-1', 'client').firestore(),
          ACTIVITY_EFFECT_KINDS.all,
        ),
      );
    });

    const statsPage = (
      db: ReturnType<RulesTestContext['firestore']>,
      after: string | null,
    ) =>
      getDocs(
        query(
          collection(db, 'clientStats'),
          orderBy(documentId()),
          ...(after === null ? [] : [startAfter(after)]),
          limit(2),
        ),
      );

    it.each(['barber', 'receptionist', 'admin', 'sysadmin'])(
      'lets a %s walk the shop’s statistics a page at a time, and never meets the spend',
      async (role) => {
        const db = signedIn('staff-1', role).firestore();

        const first = await assertSucceeds(statsPage(db, null));
        expect(first.docs.map((entry) => entry.id)).toEqual([
          'client-1',
          'client-2',
        ]);
        const second = await assertSucceeds(statsPage(db, 'client-2'));
        expect(second.docs.map((entry) => entry.id)).toEqual(['client-3']);
        expect(
          [...first.docs, ...second.docs].every(
            (entry) => entry.ref.parent.path === 'clientStats',
          ),
        ).toBe(true);
      },
    );

    it('refuses the walk to a client, a content manager and an anonymous visitor', async () => {
      for (const db of [
        signedIn('client-1', 'client').firestore(),
        signedIn('copy-1', 'content_manager').firestore(),
        testEnv.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(statsPage(db, null));
      }
    });
  });
});
