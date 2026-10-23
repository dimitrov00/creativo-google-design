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
  AccountLifecycle,
  AccountStatus,
  AuditAction,
  Actor,
  AuditContext,
  AuditTargetRef,
  BadgeCategoryKind,
  BlockReason,
  Combinability,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  CustomerOrigin,
  DayWindows,
  E164,
  Email,
  ExceptionEffectRule,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  HeadRole,
  JournalEffect,
  JournalFeed,
  JournalVisibility,
  MinuteRange,
  NotificationPayload,
  NotificationTopic,
  ParsedIdentifier,
  PhotoOrigin,
  RegistrationState,
  Role,
  SeasonKind,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  SystemSource,
  VoucherCode,
  VoucherLifecycle,
  WaitlistLifecycle,
} from '@core/components';
import type {
  AppointmentPhoto,
  AuditEntry,
  BarberLeadTimeSample,
  ClientMoneyRecord,
  ClientStatsRecord,
  Coupon,
  CouponGrant,
  Customer,
  GiftVoucher,
  InboxNotification,
  JournalEntry,
  LoyaltyAccount,
  ScheduleException,
  StreakDefinition,
  StreakDefinitionVersion,
  User,
  WaitlistRequest,
} from '@core/entities';
import {
  AppointmentId,
  AuditResourceId,
  BarberId,
  CouponId,
  Currency,
  JournalEntryId,
  LocationId,
  PublishRequestId,
  StreakDefinitionVersionId,
  UserId,
  WaitlistRequestId,
} from '@core/primitives';
import { RegistrationSystem, SearchFieldsSystem } from '@core/systems';
import {
  cents,
  customerOf,
  endMinute,
  localDate,
  minute,
  minuteCount,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { createEmulatorTestEnv } from '../testing/emulator-test-env';

/** The login phone and the e-mail of the accounts below. */
const IVAN_PHONE = E164.of('+359888123456');
const IVAN_EMAIL = Email.of('ivan@example.com');

/**
 * A registered `users/{uid}` document — the flat `User` (`@core/entities`)
 * minus its `id`, field for field what `completeRegistration` sets
 * (`REGISTERED`, `ACTIVE`, the search keys `SearchFieldsSystem` derives) —
 * so a rule that admits an edit of this shape admits the real save, and a
 * refusal is about the field under test, not a fixture that drifted.
 * `overrides` replace root keys verbatim (a block passes its variant keys).
 */
function registeredUser(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const body = {
    registrationState: RegistrationState.Registered,
    phone: IVAN_PHONE,
    firstName: 'Ivan',
    lastName: 'Petrov',
    roles: [Role.Client],
    ...AccountLifecycle.active(),
    email: IVAN_EMAIL,
    birthDate: null,
    profileEditedAtUtcMs: null,
    ...SearchFieldsSystem.searchFields(
      'Ivan',
      'Petrov',
      IVAN_PHONE,
      IVAN_EMAIL,
    ),
  } satisfies Omit<User, 'id'>;
  return { ...body, ...overrides };
}

/**
 * The `PROVISIONED` stub `verifyOtp` creates on a first phone sign-in —
 * `RegistrationSystem.provision`'s entity, as its document: the path its id
 * names and the body minus `id` (every key present, the login phone only,
 * names and birth date `null`, `roles: []`, no search keys). Its
 * `firstName: null` fails the rules' registered test exactly as an absent
 * key would.
 */
function provisionedStub(uid: string): {
  readonly path: string;
  readonly body: Omit<User, 'id'>;
} {
  const { id, ...body } = RegistrationSystem.provision(
    UserId.of(uid),
    ParsedIdentifier.phone(IVAN_PHONE),
  );
  return { path: `users/${id}`, body };
}

/** A block the server wrote — `AccountLifecycle`'s variant keys, at the root. */
const SERVER_BLOCK = AccountLifecycle.block(BlockReason.Manual, null);

/** The client record of an account, derived as the pipelines derive it (D29). */
const recordOf = (uid: string) => customerOf(UserId.of(uid));

/** 2026-09-01 09:00 in Sofia — the instant the flat fixtures below stamp. */
const SEPT_FIRST = utcMs('2026-09-01T09:00:00.000+03:00');

/**
 * A coupon grant as `couponGrants/{id}` stores it (`CouponGrant`, flip 1):
 * the record it rewards, the account that may read it, the value it was
 * granted at and its lifecycle — every field at the root.
 */
function grantBody(
  holder: string | null,
  lifecycle: GrantLifecycle = GrantLifecycle.active(
    GrantCapacityTerms.singleUse(),
    GrantExpiryTerms.none(),
  ),
): Omit<CouponGrant, 'id'> {
  return {
    customerId: recordOf(holder ?? 'walk-in'),
    holderUserId: holder === null ? null : UserId.of(holder),
    couponId: CouponId.of('coupon-1'),
    grantedAtUtcMs: SEPT_FIRST,
    ...unwrapOk(CouponValue.percentOff(20)),
    ...lifecycle,
  } satisfies Omit<CouponGrant, 'id'>;
}

/** A gift voucher as `giftVouchers/{id}` stores it (`GiftVoucher`, flip 1). */
function voucherBody(
  holder: string | null,
  code: string,
  balance = 2500,
): Omit<GiftVoucher, 'id'> {
  return {
    code: VoucherCode.of(code),
    initialValueCents: cents(5000),
    balanceCents: cents(balance),
    currency: Currency.EUR,
    issuedAtUtcMs: SEPT_FIRST,
    expiresAtUtcMs: null,
    expiresLocalDate: null,
    issuedToCustomerId: holder === null ? null : recordOf(holder),
    holderUserId: holder === null ? null : UserId.of(holder),
    ...VoucherLifecycle.active(),
  } satisfies Omit<GiftVoucher, 'id'>;
}

/**
 * A client's statistics, trimmed: rules check who, never the shape — but
 * every key a flat `ClientStatsRecord` key, keyed by the client RECORD.
 */
function statsBody(uid: string): Partial<Omit<ClientStatsRecord, 'id'>> {
  return {
    customerId: recordOf(uid),
    lifetimeVisitsCompleted: 23,
    lifetimeNoShows: 1,
    lifetimeLateCancels: 0,
    lifetimeClientCancels: 2,
    avgCadenceDays: 28,
    version: 4,
    updatedAtUtcMs: SEPT_FIRST,
  } satisfies Partial<Omit<ClientStatsRecord, 'id'>>;
}

/** The staff-only spend beside them (`ClientMoneyRecord`, `lifetimeSpendCents` + `currency`). */
function moneyBody(uid: string, spent: number): Omit<ClientMoneyRecord, 'id'> {
  return {
    customerId: recordOf(uid),
    lifetimeSpendCents: cents(spent),
    currency: Currency.EUR,
    version: 4,
    updatedAtUtcMs: SEPT_FIRST,
  } satisfies Omit<ClientMoneyRecord, 'id'>;
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
        await setDoc(doc(ctx.firestore(), 'users', uid), registeredUser());
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertSucceeds(getDoc(doc(alice.firestore(), 'users', uid)));
    });

    it('denies a signed-in user reading someone else’s doc', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), registeredUser());
      });
      const bob = testEnv.authenticatedContext('user-2');
      await assertFails(getDoc(doc(bob.firestore(), 'users', 'user-1')));
    });

    it('denies an anonymous (unauthenticated) read', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), registeredUser());
      });
      const anon = testEnv.unauthenticatedContext();
      await assertFails(getDoc(doc(anon.firestore(), 'users', 'user-1')));
    });

    it('lets the front desk read any client profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), registeredUser());
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
        await setDoc(
          doc(ctx.firestore(), 'users', uid),
          registeredUser({ firstName: 'Alice' }),
        );
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertFails(
        updateDoc(doc(alice.firestore(), 'users', uid), {
          roles: ['client', 'admin'],
        }),
      );
    });

    // Phase 4a 4A-3 (3): the owner's direct update closed with the
    // `updateProfile` callable — every users write is the Admin SDK's.
    it('refuses a client updating their own first name — `updateProfile` is the one door', async () => {
      const uid = 'user-6';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'users', uid),
          registeredUser({ firstName: 'Alice' }),
        );
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertFails(
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

  /**
   * FIX 2's allowlist is gone with the write it guarded (Phase 4a 4A-3 (3)):
   * the owner's names and birth date move only through `updateProfile`. The
   * cases the allowlist admitted are DENIED now; the ones it refused stay
   * refused.
   */
  describe('users/{uid} — the owner writes nothing directly (FIX 2 → 4A-3 (3))', () => {
    const uid = 'client-1';

    beforeEach(async () => {
      await seed(`users/${uid}`, registeredUser());
    });

    it('refuses the owner changing their names, birth date and the search keys in one write', async () => {
      await assertFails(
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
      ['accountStatus', AccountStatus.Blocked],
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
      await seed(`users/${uid}`, registeredUser(SERVER_BLOCK));
      // The whole transition: the active tag, the block's keys deleted.
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          ...AccountLifecycle.unblock(),
          blockReason: deleteField(),
          blockedUntilUtcMs: deleteField(),
        }),
      );
    });

    it("refuses the owner's name save, and leaves the server-written document as it was", async () => {
      const serverBlock = AccountLifecycle.block(
        BlockReason.Manual,
        utcMs('2026-10-12T00:00:00.000+03:00'),
      );
      await seed(`users/${uid}`, registeredUser(serverBlock));

      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivo',
          searchName: 'ivo petrov',
        }),
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snapshot = await getDoc(doc(ctx.firestore(), 'users', uid));
        expect(snapshot.data()?.['firstName']).toBe('Ivan');
        expect(snapshot.data()).toMatchObject(serverBlock);
      });
    });

    it('refuses a whole-document save of the owner’s own profile', async () => {
      await seed(`users/${uid}`, registeredUser(SERVER_BLOCK));
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
        await assertFails(updateDoc(target, { ...SERVER_BLOCK }));
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
   * and `verifyOtp` creates the provisioned stub before it — no client
   * creates this document, not even the plainest active `client` profile.
   */
  describe('users/{uid} — no client creates a profile', () => {
    it.each<[string, Record<string, unknown>]>([
      ['the full profile document', registeredUser()],
      ['a bare client role', { roles: ['client'] }],
      ['the contact-only stub', provisionedStub('user-10').body],
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
   * The owner's name edit needs a STORED first name. The rules read a
   * non-blank `firstName` as "registration completed", so an onboarding
   * user writing one onto `verifyOtp`'s stub (`firstName: null`) would
   * register themselves past `completeRegistration`.
   */
  describe('users/{uid} — only a registered owner edits their names', () => {
    const uid = 'client-2';
    const stub = provisionedStub(uid);

    it('refuses the owner of a contact-only stub adding a first and last name', async () => {
      await seed(stub.path, stub.body);
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
      await seed(stub.path, { ...stub.body, firstName: '  ', lastName: '' });
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivan',
        }),
      );
    });

    it('leaves the stub exactly as the server wrote it', async () => {
      await seed(stub.path, stub.body);
      await assertFails(
        updateDoc(doc(signedIn(uid).firestore(), 'users', uid), {
          firstName: 'Ivan',
        }),
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snapshot = await getDoc(doc(ctx.firestore(), 'users', uid));
        expect(snapshot.data()).toEqual(stub.body);
      });
    });

    it('refuses a registered owner’s name edit too — the callable is the one door', async () => {
      await seed(`users/${uid}`, registeredUser());
      await assertFails(
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
   * send the owner back through `completeRegistration`. The values the old
   * allowlist judged are `updateProfile`'s to judge now
   * (`ProfileEditSystem.decide`); the rules refuse every one of them,
   * well-formed or not.
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
    ])(
      'refuses %s as well — a well-formed value is the callable’s',
      async (_label, patch) => {
        await assertFails(
          updateDoc(doc(signedIn(uid).firestore(), 'users', uid), patch),
        );
      },
    );
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
          barberId: BarberId.of('ivan'),
          localDate: localDate('2026-08-05'),
          firstAvailableLocalDate: localDate('2026-08-07'),
          leadTimeDays: 2,
          freeMinutesOnFirstDay: minuteCount(120),
          horizonDayCount: 60,
          sampledAtUtcMs: utcMs('2026-08-05T03:30:00.000+03:00'),
        } satisfies Omit<BarberLeadTimeSample, 'id'>);
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
            { barberId: 'ivan', localDate: '2026-08-06', leadTimeDays: 0 },
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
    /** A day off as `scheduleExceptions/{BusyKey}` stores it — geometry only, no zone (Law 7.2). */
    const closedDay = (day: string): Omit<ScheduleException, 'id'> =>
      ({
        barberId: BarberId.of('ivan'),
        localDate: localDate(day),
        utcEpochMs: utcMs(`${day}T00:00:00.000+03:00`),
        locationId: LocationId.of('loc-center'),
        ...ExceptionEffectRule.closed(),
      }) satisfies Omit<ScheduleException, 'id'>;

    it('lets an anonymous visitor read an exception, and a client not write one', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'scheduleExceptions', 'ivan__2026-09-01'),
          closedDay('2026-09-01'),
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
          closedDay('2026-09-02'),
        ),
      );
    });
  });

  describe('couponGrants — the holder, and the book (2026-09-10)', () => {
    beforeEach(async () => {
      await seed('couponGrants/grant-1', grantBody('client-1'));
      await seed(
        'couponGrants/grant-used',
        grantBody(
          'client-1',
          GrantLifecycle.used(utcMs('2026-09-10T12:00:00.000+03:00'), 'seed'),
        ),
      );
    });

    it('lets the holder and a barber read a grant — the barber honours it at the chair', async () => {
      const owner = testEnv.authenticatedContext('client-1');
      await assertSucceeds(
        getDoc(doc(owner.firestore(), 'couponGrants', 'grant-1')),
      );
      // The holder's own list, pinned to the account key the rule reads.
      await assertSucceeds(
        getDocs(
          query(
            collection(owner.firestore(), 'couponGrants'),
            where('holderUserId', '==', 'client-1'),
          ),
        ),
      );
      const barber = testEnv.authenticatedContext('staff-1', {
        roles: ['barber'],
      });
      await assertSucceeds(
        getDoc(doc(barber.firestore(), 'couponGrants', 'grant-1')),
      );
      // The visit sheet lists a client's grants by their RECORD (D29).
      await assertSucceeds(
        getDocs(
          query(
            collection(barber.firestore(), 'couponGrants'),
            where('customerId', '==', recordOf('client-1')),
          ),
        ),
      );
    });

    it("denies another client, a content manager and an anonymous visitor someone else's grant", async () => {
      const other = testEnv.authenticatedContext('client-2');
      await assertFails(
        getDoc(doc(other.firestore(), 'couponGrants', 'grant-1')),
      );
      // A list not pinned to the caller's own account is refused whole.
      await assertFails(
        getDocs(
          query(
            collection(other.firestore(), 'couponGrants'),
            where('holderUserId', '==', 'client-1'),
          ),
        ),
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

    it('refuses a walk-in’s grant (no holder account) to every client, and lets the book read it', async () => {
      await seed('couponGrants/grant-walk-in', grantBody(null));
      await assertFails(
        getDoc(
          doc(
            signedIn('client-1', 'client').firestore(),
            'couponGrants',
            'grant-walk-in',
          ),
        ),
      );
      await assertSucceeds(
        getDoc(
          doc(
            signedIn('staff-1', 'barber').firestore(),
            'couponGrants',
            'grant-walk-in',
          ),
        ),
      );
    });

    /**
     * TIGHTENED in flip 1 (blueprint §3.2): `allow update: if false`. The
     * owner's exclusion-list update let a client move its own grant's
     * lifecycle — a used grant back to active included — and no sanctioned
     * client path ever needed it.
     */
    it('refuses the holder flipping their used grant back to active', async () => {
      const owner = signedIn('client-1', 'client').firestore();
      const active = GrantLifecycle.active(
        GrantCapacityTerms.singleUse(),
        GrantExpiryTerms.none(),
      );
      await assertFails(
        updateDoc(doc(owner, 'couponGrants', 'grant-used'), {
          ...active,
          usedAtUtcMs: deleteField(),
          usedNote: deleteField(),
        }),
      );
      await assertFails(
        setDoc(
          doc(owner, 'couponGrants', 'grant-used'),
          grantBody('client-1', active),
        ),
      );
    });

    it('refuses every other client-side update of a grant — the holder’s, the book’s and the admin’s', async () => {
      const used = GrantLifecycle.used(
        utcMs('2026-09-12T12:00:00.000+03:00'),
        'client',
      );
      for (const [uid, role] of [
        ['client-1', 'client'],
        ['staff-1', 'barber'],
        ['staff-2', 'receptionist'],
        ['staff-3', 'admin'],
        ['staff-4', 'sysadmin'],
      ] as const) {
        const db = signedIn(uid, role).firestore();
        // The lifecycle a redemption would move — never from a client.
        await assertFails(
          updateDoc(doc(db, 'couponGrants', 'grant-1'), { ...used }),
        );
        // Nor a key the old exclusion list left open.
        await assertFails(
          updateDoc(doc(db, 'couponGrants', 'grant-1'), {
            grantedAtUtcMs: utcMs('2026-09-02T09:00:00.000+03:00'),
          }),
        );
      }
    });

    it('refuses minting or deleting a grant from a client, whoever signs in', async () => {
      for (const [uid, role] of [
        ['client-1', 'client'],
        ['staff-3', 'admin'],
      ] as const) {
        const db = signedIn(uid, role).firestore();
        await assertFails(
          setDoc(doc(db, 'couponGrants', 'grant-new'), grantBody(uid)),
        );
        await assertFails(deleteDoc(doc(db, 'couponGrants', 'grant-1')));
      }
    });
  });

  describe('giftVouchers — the holder, the book, and nobody writes (2026-09-10)', () => {
    beforeEach(async () => {
      await seed('giftVouchers/v1', voucherBody('client-1', 'GIFT2025'));
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
          balanceCents: cents(0),
        }),
      );
    });
  });

  describe('waitlistRequests — callable-only writes', () => {
    it('refuses the owner direct status flip the callable replaced', async () => {
      const opened = utcMs('2026-08-31T21:10:00.000+03:00');
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'waitlistRequests', 'wl-1'), {
          ownerUserId: UserId.of('user-1'),
          locationId: LocationId.of('loc-center'),
          localDates: [localDate('2026-09-01')],
          utcEpochMs: utcMs('2026-09-01T00:00:00.000+03:00'),
          createdAtUtcMs: opened,
          cartSeats: [],
          cartNextSequence: 0,
          flexibleDays: [
            DayWindows.of(localDate('2026-09-01'), [
              MinuteRange.of(minute(14 * 60), endMinute(17 * 60)),
            ]),
          ],
          ...WaitlistLifecycle.open(opened),
        } satisfies Omit<WaitlistRequest, 'id'>);
      });
      const owner = testEnv.authenticatedContext('user-1', {
        roles: ['client'],
      });
      await assertFails(
        updateDoc(doc(owner.firestore(), 'waitlistRequests', 'wl-1'), {
          waitlistStatus: 'CANCELLED',
        }),
      );
    });
  });

  describe('users/{uid}/notifications — the recipient may stamp the read, and nothing else', () => {
    const inboxPath = 'users/client-1/notifications/n1';
    const sent = utcMs('2026-09-01T09:00:00.000+03:00');
    const readAt = utcMs('2026-09-01T10:00:00.000+03:00');

    beforeEach(async () => {
      await seed(inboxPath, {
        sentAtUtcMs: sent,
        readAtUtcMs: null,
        ...NotificationPayload.waitlistMatch(
          WaitlistRequestId.of('wl-1'),
          localDate('2026-09-04'),
          minute(15 * 60),
        ),
      } satisfies Omit<InboxNotification, 'id'>);
    });

    it('lets the recipient read their inbox and stamp a notification read', async () => {
      const owner = signedIn('client-1', 'client').firestore();
      await assertSucceeds(getDoc(doc(owner, inboxPath)));
      await assertSucceeds(
        updateDoc(doc(owner, inboxPath), { readAtUtcMs: readAt }),
      );
    });

    it('refuses the retired ISO read stamp, and any write beside the stamp', async () => {
      const owner = signedIn('client-1', 'client').firestore();
      // The key the rules allowed before flip 1 (`readAt` + `Iso`), spelled
      // indirectly: the flip's grep gate refuses the retired name, and this
      // is the one place that must still write it — to prove it is denied.
      const retiredReadStamp = ['readAt', 'Iso'].join('');
      await assertFails(
        updateDoc(doc(owner, inboxPath), {
          [retiredReadStamp]: '2026-09-01T10:00:00.000+03:00',
        }),
      );
      await assertFails(
        updateDoc(doc(owner, inboxPath), {
          readAtUtcMs: readAt,
          startMinutes: minute(9 * 60),
        }),
      );
      await assertFails(
        updateDoc(doc(owner, inboxPath), {
          notificationTopic: NotificationTopic.Announcement,
        }),
      );
    });

    it('refuses another account, the book, and every create or delete from a client', async () => {
      for (const db of [
        signedIn('client-2', 'client').firestore(),
        signedIn('staff-1', 'admin').firestore(),
      ]) {
        await assertFails(getDoc(doc(db, inboxPath)));
        await assertFails(
          updateDoc(doc(db, inboxPath), { readAtUtcMs: readAt }),
        );
      }
      const owner = signedIn('client-1', 'client').firestore();
      await assertFails(
        setDoc(doc(owner, 'users/client-1/notifications/n2'), {
          sentAtUtcMs: sent,
          readAtUtcMs: null,
          notificationTopic: NotificationTopic.RewardGranted,
        }),
      );
      await assertFails(deleteDoc(doc(owner, inboxPath)));
    });
  });

  describe('customers — the book keeps the records, an account reads its own (D29, flip 1)', () => {
    const ownPath = `customers/${recordOf('client-1')}`;
    const walkInPath = 'customers/cus_walkin0000000000000';

    /** A client record as `customers/{customerId}` stores it (`Customer`). */
    const customerBody = (userId: string | null): Omit<Customer, 'id'> =>
      ({
        userId: userId === null ? null : UserId.of(userId),
        displayName: 'Иван Петров',
        phone: null,
        email: null,
        searchName: 'иван петров',
        searchPrefixes: ['и', 'ив', 'ива', 'иван', 'п', 'пе', 'пет'],
        createdAtUtcMs: SEPT_FIRST,
        customerOrigin:
          userId === null ? CustomerOrigin.StaffWalkIn : CustomerOrigin.Seed,
      }) satisfies Omit<Customer, 'id'>;

    beforeEach(async () => {
      await seed(ownPath, customerBody('client-1'));
      await seed(walkInPath, customerBody(null));
    });

    it.each(['barber', 'receptionist', 'admin', 'sysadmin'])(
      'lets a %s read and keep client records',
      async (role) => {
        const db = signedIn('staff-1', role).firestore();
        await assertSucceeds(getDoc(doc(db, ownPath)));
        await assertSucceeds(getDoc(doc(db, walkInPath)));
        await assertSucceeds(
          getDocs(
            query(
              collection(db, 'customers'),
              where('userId', '==', 'client-1'),
              limit(1),
            ),
          ),
        );
        await assertSucceeds(
          setDoc(
            doc(db, 'customers/cus_walkin0000000000001'),
            customerBody(null),
          ),
        );
        await assertSucceeds(
          updateDoc(doc(db, walkInPath), { displayName: 'Борис' }),
        );
      },
    );

    it('lets an account read its own record, by id and by the one-record query', async () => {
      const owner = signedIn('client-1', 'client').firestore();
      await assertSucceeds(getDoc(doc(owner, ownPath)));
      await assertSucceeds(
        getDocs(
          query(
            collection(owner, 'customers'),
            where('userId', '==', 'client-1'),
            limit(1),
          ),
        ),
      );
    });

    it('refuses another client, a content manager and an anonymous visitor', async () => {
      for (const db of [
        signedIn('client-2', 'client').firestore(),
        signedIn('copy-1', 'content_manager').firestore(),
        testEnv.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(getDoc(doc(db, ownPath)));
        await assertFails(getDoc(doc(db, walkInPath)));
      }
      await assertFails(
        getDocs(
          query(
            collection(signedIn('client-2', 'client').firestore(), 'customers'),
            where('userId', '==', 'client-1'),
          ),
        ),
      );
    });

    it('refuses a client writing a record — their own included — and everyone deleting one', async () => {
      const owner = signedIn('client-1', 'client').firestore();
      await assertFails(updateDoc(doc(owner, ownPath), { displayName: 'X' }));
      await assertFails(
        setDoc(
          doc(owner, `customers/${recordOf('client-9')}`),
          customerBody('client-9'),
        ),
      );
      for (const role of ['client', 'barber', 'admin', 'sysadmin']) {
        await assertFails(
          deleteDoc(doc(signedIn('user-1', role).firestore(), ownPath)),
        );
      }
    });
  });

  describe('appointmentPhotos — the book’s pictures of a visit, staff-only both ways', () => {
    const photoPath = 'appointmentPhotos/photo-1';

    /** A photo as `appointmentPhotos/{id}` stores it (`AppointmentPhoto`, `clientCustomerId`). */
    const photoBody = (): Omit<AppointmentPhoto, 'id'> =>
      ({
        appointmentId: AppointmentId.of('appt-1'),
        barberId: BarberId.of('ivan'),
        clientCustomerId: recordOf('client-1'),
        clientLabel: 'Иван Петров',
        takenByUserId: UserId.of('staff-1'),
        takenAtUtcMs: SEPT_FIRST,
        path: 'appointmentPhotos/appt-1/photo-1',
        url: 'https://example.test/photo-1.jpg',
        width: 1100,
        height: 1400,
        photoOrigin: PhotoOrigin.Shot,
        label: null,
      }) satisfies Omit<AppointmentPhoto, 'id'>;

    beforeEach(async () => {
      await seed(photoPath, photoBody());
    });

    it('lets the book read a client’s photos by their record, newest first, and save one', async () => {
      const db = signedIn('staff-1', 'barber').firestore();
      await assertSucceeds(getDoc(doc(db, photoPath)));
      // The strip's own query (`listClientPhotos`, index #22): shots only.
      await assertSucceeds(
        getDocs(
          query(
            collection(db, 'appointmentPhotos'),
            where('clientCustomerId', '==', recordOf('client-1')),
            where('photoOrigin', '==', PhotoOrigin.Shot),
            orderBy('takenAtUtcMs', 'desc'),
          ),
        ),
      );
      await assertSucceeds(
        setDoc(doc(db, 'appointmentPhotos/photo-2'), {
          ...photoBody(),
          path: 'appointmentPhotos/appt-1/photo-2',
        }),
      );
    });

    it('refuses the client in the picture, a content manager and an anonymous visitor', async () => {
      for (const db of [
        signedIn('client-1', 'client').firestore(),
        signedIn('copy-1', 'content_manager').firestore(),
        testEnv.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(getDoc(doc(db, photoPath)));
        await assertFails(
          setDoc(doc(db, 'appointmentPhotos/photo-3'), photoBody()),
        );
      }
    });
  });

  describe('auditLog — admins read, only the server writes (FIX 1)', () => {
    // The flat row a booking act appends (`AuditEntry`): the actor, the
    // context and the CUSTOMER target slices at the root (D29).
    const row = {
      recordedAtUtcMs: utcMs('2026-09-25T13:00:00.000+03:00'),
      resourceId: AuditResourceId.forAppointment(AppointmentId.of('appt-1')),
      ...Actor.system(SystemSource.FirestoreSystem),
      ...AuditContext.cancelled('CLIENT_CHANGED_PLANS'),
      ...AuditTargetRef.customer(recordOf('client-1')),
    } satisfies Omit<AuditEntry, 'id'>;

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
            where('targetCustomerId', '==', recordOf('client-1')),
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
      await assertFails(
        updateDoc(target, { auditAction: AuditAction.BookingCommitted }),
      );
      await assertFails(deleteDoc(target));
    });
  });

  describe('clientStats — the book reads, only the server writes', () => {
    // Keyed by the client RECORD (D29): `clientStats/{customerId}`.
    const statsPath = `clientStats/${recordOf('client-1')}`;

    beforeEach(async () => {
      await seed(statsPath, statsBody('client-1'));
    });

    it.each(['barber', 'receptionist', 'admin', 'sysadmin'])(
      "lets a %s read a client's statistics",
      async (role) => {
        await assertSucceeds(
          getDoc(doc(signedIn('staff-1', role).firestore(), statsPath)),
        );
      },
    );

    it('refuses the client they describe, a content manager and an anonymous visitor', async () => {
      await assertFails(
        getDoc(doc(signedIn('client-1', 'client').firestore(), statsPath)),
      );
      await assertFails(
        getDoc(
          doc(signedIn('copy-1', 'content_manager').firestore(), statsPath),
        ),
      );
      await assertFails(
        getDoc(doc(testEnv.unauthenticatedContext().firestore(), statsPath)),
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
        setDoc(doc(db, statsPath), { ...statsBody('client-1'), version: 5 }),
      );
      await assertFails(
        setDoc(
          doc(db, `clientStats/${recordOf('client-2')}`),
          statsBody('client-2'),
        ),
      );
    });
  });

  describe('clientStats/{customerId}/restricted — lifetime spend is the shop admin’s alone', () => {
    const moneyPath = `clientStats/${recordOf('client-1')}/restricted/money`;

    beforeEach(async () => {
      await seed(moneyPath, moneyBody('client-1', 64_000));
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
          setDoc(
            doc(signedIn('staff-1', role).firestore(), moneyPath),
            moneyBody('client-1', 0),
          ),
        );
      }
    });
  });

  describe('the loyalty catalogue — anyone signed in reads, nobody writes (2026-09-28)', () => {
    // Trimmed documents (flat root keys, flip 3): rules check who, never the shape.
    const catalogue = [
      [
        'badgeCategories/cat-mastery',
        { badgeCategoryKind: BadgeCategoryKind.Mastery, order: 2 },
      ],
      ['badgeSeries/series-svc-fade', { categoryId: 'cat-mastery', order: 7 }],
      [
        'seasons/season-2026-autumn',
        { seasonKind: SeasonKind.Season, version: 1 },
      ],
      ['tierDefinitions/gold', { rank: 2, version: 1 }],
      ['rewardsCatalog/reward-beard', { cost: 120, enabled: true }],
      ['streakDefinitions/cadence', { rules: [], updatedAtUtcMs: 0 }],
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
    // Keyed by the client RECORD (D29, flip 3): `loyaltyAccounts/{customerId}`.
    const accountPath = `loyaltyAccounts/${recordOf('client-1')}`;
    const progressPath = `${accountPath}/badgeProgress/series-svc-fade`;
    const trackPath = `${accountPath}/seasonProgress/season-2026-autumn`;

    beforeEach(async () => {
      await seed(accountPath, {
        customerId: recordOf('client-1'),
        balance: 358,
        seq: 35,
      } satisfies Partial<Omit<LoyaltyAccount, 'id'>>);
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
    // Keyed by the client RECORD (D29, flip 3): `{customerId}_{seq:06}`, the
    // flat root keys the rule and the ledger query read.
    const record = recordOf('client-1');
    const rowPath = (seq: number) =>
      `clientJournal/${JournalEntryId.forEntry(record, seq)}`;
    const pointRow = {
      customerId: record,
      seq: 1,
      journalVisibility: JournalVisibility.Client,
      journalEffect: JournalEffect.Points,
      pointsDelta: 17,
    } satisfies Partial<JournalEntry>;
    const staffRow = {
      customerId: record,
      seq: 2,
      journalVisibility: JournalVisibility.Staff,
      journalEffect: JournalEffect.Pause,
    } satisfies Partial<JournalEntry>;

    beforeEach(async () => {
      await seed(rowPath(1), pointRow);
      await seed(rowPath(2), staffRow);
    });

    it('lets the book read a client-visible row, and never a staff row', async () => {
      const db = signedIn('staff-1', 'barber').firestore();
      await assertSucceeds(getDoc(doc(db, rowPath(1))));
      await assertFails(getDoc(doc(db, rowPath(2))));
    });

    it('lets the ledger query through only with its visibility filter', async () => {
      const db = signedIn('staff-1', 'receptionist').firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, 'clientJournal'),
            where('customerId' satisfies keyof JournalEntry, '==', record),
            where(
              'journalVisibility' satisfies keyof JournalEntry,
              '==',
              JournalVisibility.Client,
            ),
            where(
              'journalEffect' satisfies keyof JournalEntry,
              '==',
              JournalEffect.Points,
            ),
          ),
        ),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, 'clientJournal'),
            where('customerId' satisfies keyof JournalEntry, '==', record),
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
        await assertFails(getDoc(doc(db, rowPath(1))));
      }
    });

    it('refuses every client-side write — the journal is append-only, and the server’s', async () => {
      for (const role of ['barber', 'admin', 'sysadmin']) {
        const db = signedIn('staff-1', role).firestore();
        await assertFails(
          setDoc(doc(db, rowPath(3)), {
            ...pointRow,
            seq: 3,
          }),
        );
        await assertFails(deleteDoc(doc(db, rowPath(1))));
      }
    });
  });

  describe('streakDefinitions — staff read the rule, the admin pair reads its history, the server publishes (2026-09-29)', () => {
    const headPath = 'streakDefinitions/cadence';
    const versionsPath = `${headPath}/versions`;
    const firstPath = `${versionsPath}/${StreakDefinitionVersionId.forVersion(1)}`;
    const secondPath = `${versionsPath}/${StreakDefinitionVersionId.forVersion(2)}`;

    /**
     * The rule's documents as the callable leaves them: the seeded head
     * and its first version, then one publish that waits (grace from 7
     * days to 10, from 5.10) — the flat bodies (`StreakDefinition`,
     * `StreakDefinitionVersion` minus `id`, flip 3), built from the shared
     * rhythm fixtures of `@core/testing`, so the rules are held to the
     * documents the server writes.
     */
    async function published(): Promise<{
      head: Omit<StreakDefinition, 'id'>;
      versions: Readonly<Record<string, object>>;
    }> {
      const publishedAtUtcMs = utcMs('2026-09-29T10:00:00+03:00');
      const wider = {
        ...StreakRule.DEFAULT,
        version: 2,
        effectiveFromLocalDate: localDate('2026-10-05'),
        graceDays: 10,
      };
      const { id: headId, ...head } = streakDefinitionFixture({
        rules: [
          {
            ...StreakRule.DEFAULT,
            headRole: HeadRole.Current,
            streakTransition: null,
          },
          {
            ...wider,
            headRole: HeadRole.Scheduled,
            streakTransition: StreakTransition.Grandfather,
          },
        ],
        updatedAtUtcMs: publishedAtUtcMs,
      });
      const { id: firstId, ...first } = streakDefinitionVersionFixture();
      const { id: secondId, ...second } = streakDefinitionVersionFixture({
        ...wider,
        id: StreakDefinitionVersionId.forVersion(2),
        publishedAtUtcMs,
        publishedByUserId: UserId.of('staff-2'),
        streakTransition: StreakTransition.Grandfather,
        streakRuleDirection: StreakRuleDirection.Looser,
        changed: [StreakRuleParameter.GraceDays],
        requestId: PublishRequestId.of('req-wider-grace'),
        withdrawnAtUtcMs: null,
      } satisfies Partial<StreakDefinitionVersion>);
      expect(headId).toBe('cadence');
      return { head, versions: { [firstId]: first, [secondId]: second } };
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
          effectiveFromLocalDate: '2026-10-05',
          requestId: 'req-wider-grace',
          withdrawnAtUtcMs: null,
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
        await assertFails(updateDoc(doc(db, headPath), { rules: [] }));
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
            withdrawnAtUtcMs: utcMs('2026-09-29T11:00:00+03:00'),
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
        await assertFails(updateDoc(doc(db, headPath), { rules: [] }));
        await assertFails(
          updateDoc(doc(db, firstPath), { publishedByUserId: uid }),
        );
      }
    });
  });

  describe('coupons — an admin’s save keeps what the coupon is given for (2026-09-29)', () => {
    const couponPath = 'coupons/coupon-birthday';

    /**
     * The birthday coupon as `coupons/{id}` stores it (`Coupon`, flip 1):
     * the value, the expiry and the occasion slices at the root — what the
     * seed writes and an admin's editor saves back whole.
     */
    function birthday(percent: number): Omit<Coupon, 'id'> {
      return {
        name: 'Рожден ден',
        code: null,
        combinability: Combinability.Exclusive,
        usageLimit: null,
        couponStatus: CouponStatus.Enabled,
        couponOccasion: CouponOccasion.Birthday,
        ...unwrapOk(CouponValue.percentOff(percent)),
        ...unwrapOk(CouponExpiryRule.days(30)),
      } satisfies Omit<Coupon, 'id'>;
    }

    async function stored(
      db: ReturnType<RulesTestContext['firestore']>,
    ): Promise<Record<string, unknown>> {
      const snapshot = await assertSucceeds(getDoc(doc(db, couponPath)));
      return snapshot.data() ?? {};
    }

    it('round-trips the occasion through an admin’s edit of the birthday coupon', async () => {
      // As the seed writes it.
      await seed(couponPath, birthday(20));
      const admin = signedIn('staff-2', 'admin').firestore();

      // The editor reads the coupon, changes the figure, saves the whole document.
      const read = await stored(admin);
      expect(read['couponOccasion']).toBe(CouponOccasion.Birthday);
      await assertSucceeds(
        setDoc(doc(admin, couponPath), { ...read, discountPercent: 25 }),
      );

      // What the card reads afterwards: the gift is still the birthday's.
      const back = await stored(signedIn('staff-1', 'barber').firestore());
      expect(back['couponOccasion']).toBe(CouponOccasion.Birthday);
      expect(back).toEqual(birthday(25));
    });

    it('writes a coupon tied to no occasion back with the field, as `null`', async () => {
      await seed(couponPath, { ...birthday(20), couponOccasion: null });
      const admin = signedIn('staff-2', 'admin').firestore();

      const read = await stored(admin);
      expect(read['couponOccasion']).toBeNull();
      await assertSucceeds(setDoc(doc(admin, couponPath), read));

      const snapshot = await assertSucceeds(getDoc(doc(admin, couponPath)));
      expect(snapshot.data()).toHaveProperty('couponOccasion', null);
    });

    it('refuses the save to everyone but the admin pair', async () => {
      await seed(couponPath, birthday(20));
      for (const [uid, role] of [
        ['staff-1', 'barber'],
        ['staff-3', 'receptionist'],
        ['client-1', 'client'],
      ] as const) {
        await assertFails(
          updateDoc(doc(signedIn(uid, role).firestore(), couponPath), {
            couponOccasion: null,
          }),
        );
      }
    });
  });

  describe('the card’s new reads: a holder’s vouchers, the activity, the shop’s statistics (2026-09-29)', () => {
    /** A trimmed flat row (flip 3): the root keys the rule and the query read. */
    const record = recordOf('client-1');
    const journalRow = (
      seq: number,
      journalEffect: JournalEffect,
      journalVisibility: JournalVisibility = JournalVisibility.Client,
    ) =>
      ({
        customerId: record,
        seq,
        journalVisibility,
        journalEffect,
      }) satisfies Partial<JournalEntry>;
    const rowPath = (seq: number) =>
      `clientJournal/${JournalEntryId.forEntry(record, seq)}`;

    beforeEach(async () => {
      await seed('giftVouchers/v-georgi', voucherBody('client-1', 'GIFT50'));
      await seed('giftVouchers/v-martin', voucherBody('client-2', 'GIFT2025'));
      await seed('giftVouchers/v-paper', voucherBody(null, 'GIFT5'));
      await seed(rowPath(1), journalRow(1, JournalEffect.Points));
      await seed(rowPath(2), journalRow(2, JournalEffect.Tier));
      await seed(rowPath(3), journalRow(3, JournalEffect.Reward));
      await seed(rowPath(4), journalRow(4, JournalEffect.Redemption));
      await seed(rowPath(5), journalRow(5, JournalEffect.Achievement));
      await seed(rowPath(6), journalRow(6, JournalEffect.Streak));
      await seed(
        rowPath(7),
        journalRow(7, JournalEffect.Pause, JournalVisibility.Staff),
      );
      for (const uid of ['client-1', 'client-2', 'client-3']) {
        await seed(`clientStats/${recordOf(uid)}`, statsBody(uid));
        await seed(
          `clientStats/${recordOf(uid)}/restricted/money`,
          moneyBody(uid, 12_000),
        );
      }
    });

    const heldBy = (
      db: ReturnType<RulesTestContext['firestore']>,
      holder: string,
    ) =>
      getDocs(
        query(
          collection(db, 'giftVouchers'),
          where('holderUserId' satisfies keyof GiftVoucher, '==', holder),
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

    /**
     * The activity's query for one pill, given as the effects the pill
     * holds (`JournalFeed.effectsOf`) — the journal port's own query: the
     * record, the client-visible rows, the pill's effects, newest first,
     * older than the cursor's `seq`.
     */
    const activity = (
      db: ReturnType<RulesTestContext['firestore']>,
      effects: readonly JournalEffect[],
      beforeSeq: number | null = null,
    ) =>
      getDocs(
        query(
          collection(db, 'clientJournal'),
          where('customerId' satisfies keyof JournalEntry, '==', record),
          where(
            'journalVisibility' satisfies keyof JournalEntry,
            '==',
            JournalVisibility.Client,
          ),
          where('journalEffect' satisfies keyof JournalEntry, 'in', [
            ...effects,
          ]),
          ...(beforeSeq === null ? [] : [where('seq', '<', beforeSeq)]),
          orderBy('seq', 'desc'),
          limit(3),
        ),
      );

    it('lets the activity’s query through: every pill, newest first, older than the cursor', async () => {
      const db = signedIn('staff-1', 'barber').firestore();

      const all = JournalFeed.effectsOf(JournalFeed.All);
      const rewards = JournalFeed.effectsOf(JournalFeed.Rewards);
      const status = JournalFeed.effectsOf(JournalFeed.Status);

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
            where('customerId' satisfies keyof JournalEntry, '==', record),
            where('journalEffect' satisfies keyof JournalEntry, 'in', [
              ...JournalFeed.effectsOf(JournalFeed.All),
            ]),
            orderBy('seq', 'desc'),
          ),
        ),
      );
      await assertFails(
        activity(
          signedIn('client-1', 'client').firestore(),
          JournalFeed.effectsOf(JournalFeed.All),
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

        // The records in document-id order, as the walk pages them.
        const [one, two, three] = ['client-1', 'client-2', 'client-3']
          .map(recordOf)
          .sort();
        const first = await assertSucceeds(statsPage(db, null));
        expect(first.docs.map((entry) => entry.id)).toEqual([one, two]);
        const second = await assertSucceeds(statsPage(db, two ?? ''));
        expect(second.docs.map((entry) => entry.id)).toEqual([three]);
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

  // ── Phase 4a 4A-3 (4), (5): the callables took the client writes ──────

  describe('impersonationSessions — the admin pair reads, only the callables write (4A-3 (4))', () => {
    const SESSION = 'impersonationSessions/imp-1';
    const sessionBody = {
      adminUserId: 'staff-1',
      targetUserId: 'client-1',
      impersonationScope: 'READ',
      reason: 'support ticket 42',
      impersonationStatus: 'ACTIVE',
      startedAtUtcMs: SEPT_FIRST,
      expiresAtUtcMs: SEPT_FIRST + 3_600_000,
    };

    beforeEach(async () => {
      await seed(SESSION, sessionBody);
    });

    it.each(['admin', 'sysadmin'])(
      'lets %s read a session, by id and by list — the read is unchanged',
      async (role) => {
        const db = signedIn('staff-1', role).firestore();
        await assertSucceeds(getDoc(doc(db, SESSION)));
        await assertSucceeds(getDocs(collection(db, 'impersonationSessions')));
      },
    );

    it('refuses a client, a barber and an anonymous visitor the read', async () => {
      for (const db of [
        signedIn('client-1', 'client').firestore(),
        signedIn('staff-2', 'barber').firestore(),
        testEnv.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(getDoc(doc(db, SESSION)));
      }
    });

    it.each(['admin', 'sysadmin'])(
      'refuses %s opening, ending or deleting a session from the client SDK',
      async (role) => {
        const db = signedIn('staff-1', role).firestore();
        await assertFails(
          setDoc(doc(db, 'impersonationSessions', 'imp-2'), sessionBody),
        );
        await assertFails(
          updateDoc(doc(db, SESSION), {
            impersonationStatus: 'ENDED',
            endedAtUtcMs: SEPT_FIRST + 600_000,
          }),
        );
        await assertFails(deleteDoc(doc(db, SESSION)));
      },
    );
  });

  describe('invitations — a code is looked up, only the callable redeems (4A-3 (5))', () => {
    const INVITATION = 'invitations/inv-1';
    const invitationBody = { inviterUserId: 'client-1', redemptionCount: 0 };

    beforeEach(async () => {
      await seed(INVITATION, invitationBody);
      await seed(`${INVITATION}/redemptions/client-3`, {
        redeemedAtUtcMs: SEPT_FIRST,
      });
    });

    it('lets a signed-in client get an invitation, and the staff list them — the reads are unchanged', async () => {
      await assertSucceeds(
        getDoc(doc(signedIn('client-2', 'client').firestore(), INVITATION)),
      );
      await assertSucceeds(
        getDocs(
          collection(signedIn('staff-1', 'barber').firestore(), 'invitations'),
        ),
      );
    });

    it('refuses a client listing every invitation', async () => {
      await assertFails(
        getDocs(
          collection(signedIn('client-2', 'client').firestore(), 'invitations'),
        ),
      );
    });

    it('refuses a signed-in create of one’s own invitation, and the redemption’s +1', async () => {
      const inviter = signedIn('client-1', 'client').firestore();
      await assertFails(
        setDoc(doc(inviter, 'invitations', 'inv-2'), {
          inviterUserId: 'client-1',
          redemptionCount: 0,
        }),
      );
      await assertFails(
        updateDoc(doc(signedIn('client-2', 'client').firestore(), INVITATION), {
          redemptionCount: 1,
        }),
      );
    });

    it('lets a signed-in client get a redemption, and the staff list them — the reads are unchanged', async () => {
      await assertSucceeds(
        getDoc(
          doc(
            signedIn('client-2', 'client').firestore(),
            `${INVITATION}/redemptions/client-3`,
          ),
        ),
      );
      await assertSucceeds(
        getDocs(
          collection(
            signedIn('staff-1', 'barber').firestore(),
            `${INVITATION}/redemptions`,
          ),
        ),
      );
    });

    it('refuses a client listing the redemptions — the referral graph', async () => {
      await assertFails(
        getDocs(
          collection(
            signedIn('client-2', 'client').firestore(),
            `${INVITATION}/redemptions`,
          ),
        ),
      );
    });

    it('refuses the referee’s own redemption create — the callable records it', async () => {
      await assertFails(
        setDoc(
          doc(
            signedIn('client-2', 'client').firestore(),
            `${INVITATION}/redemptions/client-2`,
          ),
          { redeemedAtUtcMs: SEPT_FIRST },
        ),
      );
    });
  });
});
