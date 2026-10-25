import { describe, expect, it } from 'vitest';
import type {
  GiftVoucher,
  GiftVoucherMeta,
  JournalEntry,
  LoyaltyAccount,
  StreakDefinition,
} from '@core/entities';
import {
  FreezeReason,
  StreakExcuse,
  StreakInterval,
  StreakIntervalSource,
  StreakPeriodMark,
  StreakPhaseState,
  StreakQualifier,
  type StreakRule,
  StreakState,
  StreakTransition,
  TierOverride,
} from '@core/components';
import {
  AdjustmentId,
  AppointmentId,
  CouponGrantId,
  GiftVoucherId,
  type LocalDate,
  RewardId,
  ServiceId,
  TierId,
} from '@core/primitives';
import { StreakRuleSystem } from '@core/systems';
import { cents, localDate } from '@core/testing';
import type { ClientCardGrant } from './client-card.contracts';
import { NO_VISIT_NAMES } from './ledger.presenter';
import type { LoyaltyFlags } from './loyalty.presenter';
import {
  WALLET_ACTIVITY_READ,
  WALLET_ACTIVITY_ROWS,
  WALLET_RHYTHM_PERIODS,
  WALLET_RHYTHM_PERIODS_NARROW,
  type WalletInput,
  passVm,
  voucherVms,
  walletActions,
  walletHoldings,
  walletRhythmVm,
  walletVm,
} from './wallet.presenter';
import {
  GEORGI,
  GEORGI_GRANT,
  MARTIN,
  SHOP_TIME_ZONE,
  TODAY,
  achievementsDataOf,
  factMs,
  fixtureVoucher,
  fixtureVouchers,
  georgiHistory,
  loyaltyCatalogWith,
  loyaltyOf,
  martinHistory,
  must,
  rhythmHead,
  rhythmHeadWith,
  statsOf,
  translatorOf,
  voucherExpiry,
  wordsOf,
} from '../testing/client-card.fixtures';
import { LoadState } from '@creativo/shared/view-state';
import {
  type RewardTileVm,
  WalletHolding,
  type WalletTierVm,
} from './client-pages.vm';

/*
 * «ЛОЯЛНОСТ» AS A WALLET (client-card-revision-3 §2.2). Every model here
 * is built from the book: the two holders' accounts, the published
 * catalogue and its rule, the vouchers and the journal of the loyalty
 * fixtures, worded by the app's own catalogue. «Today» is Monday
 * 28 September 2026: Георги's fade is done, Мартин is in the chair.
 */

const WORDS = wordsOf('bg');
const TRANSLATE = translatorOf('bg');
const GEORGI_DATA = achievementsDataOf('georgi', null);
const CATALOG = GEORGI_DATA.catalog;
const GEORGI_ACCOUNT = GEORGI_DATA.account;
const MARTIN_ACCOUNT = achievementsDataOf('martin', null).account;
const GEORGI_STATS = statsOf(GEORGI, georgiHistory());
const MARTIN_STATS = statsOf(MARTIN, martinHistory());
/** The rhythm's head as the catalogue holds it: the rule in force since 1.03.2025, nothing waiting. */
const RHYTHM = rhythmHead();
const GEORGI_RHYTHM = must(
  StreakState.find(GEORGI_ACCOUNT.streaks, RHYTHM.id),
  'Георги’s rhythm',
);
const MARTIN_RHYTHM = must(
  StreakState.find(MARTIN_ACCOUNT.streaks, RHYTHM.id),
  'Мартин’s rhythm',
);

const ALL_FLAGS: LoyaltyFlags = {
  points: true,
  streaks: true,
  achievements: true,
  tiers: true,
};

const NBSP = String.fromCharCode(0xa0);
const MINUS = String.fromCharCode(0x2212);
/** `formatCents` keeps the sign on the figure's line. */
const euro = (amount: string) => `${amount}${NBSP}€`;

/** The vouchers issued to one person, as the reader answers them. */
function vouchersOf(uid: string): readonly GiftVoucher[] {
  return fixtureVouchers().filter((voucher) => voucher.holderUserId === uid);
}

/** One more voucher of Георги's, from a document of his own with some fields changed. */
function voucherWith(
  id: string,
  fields: Partial<GiftVoucherMeta>,
): GiftVoucher {
  return fixtureVoucher('voucher-dev-georgi', {
    id: GiftVoucherId.of(id),
    ...fields,
  });
}

/** The newest rows of a holder's journal, as the wallet's one read answers them. */
function journalOf(who: 'georgi' | 'martin'): readonly JournalEntry[] {
  return [...loyaltyOf(who).clientJournal]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, WALLET_ACTIVITY_READ);
}

/** The stored id of Георги's journal row `seq`. */
function georgiEntryId(seq: number): string {
  return must(
    loyaltyOf('georgi').clientJournal.find((row) => row.seq === seq),
    `Георги’s row ${seq}`,
  ).id;
}

/** The rhythm's head with its rule in force edited. */
function ruleWith(edit: (rule: StreakRule) => StreakRule): StreakDefinition {
  return rhythmHeadWith(edit);
}

function walletInput(overrides: Partial<WalletInput> = {}): WalletInput {
  return {
    account: GEORGI_ACCOUNT,
    catalog: { loadState: LoadState.Ready, data: CATALOG },
    flags: ALL_FLAGS,
    paused: false,
    usableGrants: [GEORGI_GRANT],
    usableGrantsOnBill: [],
    visitsMs: GEORGI_STATS.last365VisitsCompleted.map(factMs),
    lifetimeVisits: GEORGI_STATS.lifetimeVisitsCompleted,
    visitTitles: {
      byAppointment: new Map([[AppointmentId.of('appt-dev-1'), 'Фейд']]),
      byDay: new Map(),
    },
    visitBarbers: {
      byAppointment: new Map([[AppointmentId.of('appt-dev-1'), 'Иван']]),
      byDay: new Map(),
    },
    inChairToday: false,
    today: TODAY,
    zone: SHOP_TIME_ZONE,
    words: WORDS,
    holder: 'Георги Петров',
    sinceDay: GEORGI_STATS.firstVisitLocalDate,
    vouchers: { loadState: LoadState.Ready, data: vouchersOf(GEORGI) },
    activity: { loadState: LoadState.Ready, data: journalOf('georgi') },
    rhythm: RHYTHM,
    online: true,
    isOwner: true,
    visitGone: false,
    covers: new Map(),
    translate: TRANSLATE,
    ...overrides,
  };
}

/** Мартин's card, opened from his cut in the chair: he owns the visit and holds no reward. */
function martinInput(overrides: Partial<WalletInput> = {}): WalletInput {
  return walletInput({
    account: MARTIN_ACCOUNT,
    usableGrants: [],
    visitsMs: MARTIN_STATS.last365VisitsCompleted.map(factMs),
    lifetimeVisits: MARTIN_STATS.lifetimeVisitsCompleted,
    visitTitles: NO_VISIT_NAMES,
    visitBarbers: undefined,
    inChairToday: true,
    holder: 'Мартин Илиев',
    sinceDay: MARTIN_STATS.firstVisitLocalDate,
    vouchers: { loadState: LoadState.Ready, data: vouchersOf(MARTIN) },
    activity: { loadState: LoadState.Ready, data: journalOf('martin') },
    ...overrides,
  });
}

/** WE as the page draws it: the «Статус» section once read, `null` while there is none. */
function tierSection(input: WalletInput): WalletTierVm | null {
  const tier = walletVm(input).tier;
  return tier?.loadState === LoadState.Ready ? tier.data : null;
}

/** WF as the page draws it: the catalogue section's tiles once read, none while there is no section. */
function catalogTiles(input: WalletInput): readonly RewardTileVm[] {
  const catalog = walletVm(input).catalog;
  return catalog?.loadState === LoadState.Ready ? catalog.data.tiles : [];
}

/** What a spec changes on an account: any of its fields but the override's (`TierOverride` is a slice of its own). */
type AccountEdit = Partial<Omit<LoyaltyAccount, 'tierOverrideSource'>>;

function account(
  overrides: AccountEdit,
  override: TierOverride | null = null,
): LoyaltyAccount {
  return { ...GEORGI_ACCOUNT, ...overrides, ...(override ?? {}) };
}

/** What a spec changes on a rhythm's state: any field but the phase (a slice of its own). */
type RhythmEdit = Partial<Omit<StreakState, 'streakPhase'>>;

/** Георги's account with his rhythm in another state. */
function withRhythm(
  overrides: RhythmEdit,
  phase: StreakPhaseState = StreakPhaseState.active(),
): LoyaltyAccount {
  return account({ streaks: [{ ...GEORGI_RHYTHM, ...overrides, ...phase }] });
}

function rhythmIn(
  phase: StreakPhaseState,
  overrides: RhythmEdit = {},
  input: Partial<WalletInput> = {},
) {
  return must(
    walletRhythmVm(
      walletInput({ account: withRhythm(overrides, phase), ...input }),
    ),
    'the rhythm',
  );
}

/** The pinned period terms of a rhythm, flat (`period*`). */
function periodOf(
  intervalDays: number,
  graceDays: number,
  source: StreakIntervalSource,
  habitDays: number | null,
): RhythmEdit {
  return {
    periodIntervalDays: intervalDays,
    periodGraceDays: graceDays,
    periodSource: source,
    periodHabitDays: habitDays,
  };
}

/** No period is open: the four terms `null` together. */
const NO_PERIOD: RhythmEdit = {
  periodIntervalDays: null,
  periodGraceDays: null,
  periodSource: null,
  periodHabitDays: null,
};

/** The visit on the book that holds the period: none. */
const NOT_HELD: RhythmEdit = { heldByAppointmentId: null, heldOn: null };

const day = (raw: string): LocalDate => localDate(raw);

/** Every string of a model, by the path that holds it. */
function strings(
  value: unknown,
  path: string,
  out: [path: string, text: string][] = [],
): [path: string, text: string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) {
    value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      strings(item, `${path}.${key}`, out);
    }
  }
  return out;
}

describe('passVm', () => {
  it('draws the balance, the holder, the tier and the tenure, named as one card', () => {
    expect(passVm(walletInput())).toEqual({
      figure: '358',
      unit: 'точки',
      holder: 'Георги Петров',
      tier: 'Злато',
      since: 'Клиент от март 2025 г.',
      state: null,
      frozen: false,
      accessibleName:
        'Карта за лоялност: Георги Петров, Злато, 358 точки за размяна, клиент от март 2025 г.',
    });
  });

  it('agrees the unit with the figure, and groups a long one', () => {
    expect(
      passVm(walletInput({ account: account({ balance: 1 }) })),
    ).toMatchObject({
      figure: '1',
      unit: 'точка',
      accessibleName:
        'Карта за лоялност: Георги Петров, Злато, 1 точка за размяна, клиент от март 2025 г.',
    });
    const rich = passVm(walletInput({ account: account({ balance: 12450 }) }));
    expect(rich.figure).toBe(`12${NBSP}450`);
  });

  it('says what an account owes on the state line, in a minus, never in the name', () => {
    expect(
      passVm(walletInput({ account: account({ balance: -40 }) })),
    ).toMatchObject({
      figure: `${MINUS}40`,
      unit: 'точки',
      state: 'дължи 40 точки',
      accessibleName:
        'Карта за лоялност: Георги Петров, Злато, 0 точки за размяна, клиент от март 2025 г.',
    });
  });

  it('says when points lapse only once the notice runs, and until the day itself', () => {
    const expiring = (today: string) =>
      passVm(
        walletInput({
          today: localDate(today),
          account: account({
            pointsExpireOn: day('2026-12-31'),
            pointsExpiryNoticeFrom: day('2026-09-15'),
          }),
        }),
      ).state;
    expect(expiring(TODAY)).toBe('358 т. изтичат на 31.12');
    expect(expiring('2026-09-14')).toBeNull();
    expect(expiring('2026-12-31')).toBe('358 т. изтичат на 31.12');
    expect(expiring('2027-01-01')).toBeNull();
    // Nothing to lapse, nothing to say.
    expect(
      passVm(
        walletInput({
          account: account({
            balance: 0,
            pointsExpireOn: day('2026-12-31'),
            pointsExpiryNoticeFrom: day('2026-09-15'),
          }),
        }),
      ).state,
    ).toBeNull();
  });

  it('freezes a paused client’s pass and zeroes nothing on it', () => {
    expect(
      passVm(
        walletInput({
          paused: true,
          account: account({
            pointsExpireOn: day('2026-12-31'),
            pointsExpiryNoticeFrom: day('2026-09-15'),
          }),
        }),
      ),
    ).toMatchObject({
      figure: '358',
      tier: 'Злато',
      state: 'Замразено',
      frozen: true,
    });
  });

  it('counts the visits the tier is judged by where the points are off', () => {
    expect(
      passVm(
        walletInput({ flags: { ...ALL_FLAGS, points: false, tiers: false } }),
      ),
    ).toEqual({
      figure: '14',
      unit: 'посещения',
      holder: 'Георги Петров',
      tier: null,
      since: 'Клиент от март 2025 г.',
      state: null,
      frozen: false,
      accessibleName:
        'Лоялност, Георги Петров, 14 посещения за 12 месеца, клиент от март 2025 г.',
    });
    // An account that owes says nothing of points while they are off.
    expect(
      passVm(
        walletInput({
          flags: { ...ALL_FLAGS, points: false },
          account: account({ balance: -40 }),
        }),
      ),
    ).toMatchObject({
      figure: '14',
      tier: 'Злато',
      state: null,
      accessibleName:
        'Лоялност, Георги Петров, Злато, 14 посещения за 12 месеца, клиент от март 2025 г.',
    });
  });

  it('draws no plate without the tiers, their flag or the catalogue that names them', () => {
    expect(
      passVm(walletInput({ flags: { ...ALL_FLAGS, tiers: false } })),
    ).toMatchObject({
      tier: null,
      accessibleName:
        'Карта за лоялност: Георги Петров, 358 точки за размяна, клиент от март 2025 г.',
    });
    expect(
      passVm(walletInput({ catalog: { loadState: LoadState.Loading } })).tier,
    ).toBeNull();
    expect(passVm(walletInput({ catalog: null })).tier).toBeNull();
  });

  it('names the tier an override stands the account on', () => {
    expect(
      passVm(
        walletInput({
          account: account(
            {},
            TierOverride.adjustment(
              TierId.of('platinum'),
              null,
              AdjustmentId.of('adj-1'),
            ),
          ),
        }),
      ).tier,
    ).toBe('Платина');
  });

  it('leaves out a holder it does not know and a tenure that has not begun', () => {
    expect(passVm(walletInput({ holder: null, sinceDay: null }))).toMatchObject(
      {
        holder: null,
        since: null,
        accessibleName: 'Карта за лоялност: Злато, 358 точки за размяна',
      },
    );
    expect(passVm(walletInput({ holder: '  ' })).holder).toBeNull();
  });

  it('hands a long name over whole: the pass wraps it', () => {
    const name = 'Александър Константинов-Христов';
    expect(passVm(walletInput({ holder: name }))).toMatchObject({
      holder: name,
      accessibleName: `Карта за лоялност: ${name}, Злато, 358 точки за размяна, клиент от март 2025 г.`,
    });
  });
});

describe('voucherVms', () => {
  it('shows what can be spent: a voided voucher and an empty one are absent', () => {
    expect(vouchersOf(GEORGI)).toHaveLength(3);
    expect(voucherVms(vouchersOf(GEORGI), TODAY, WORDS)).toEqual([
      {
        voucherId: 'voucher-dev-georgi',
        title: 'Ваучер за подарък',
        balance: euro('25,00'),
        detail: `от ${euro('50,00')} · до 31.12`,
        accessibleName: `Ваучер за подарък: ${euro('25,00')} от ${euro('50,00')}, важи до 31 декември`,
      },
    ]);
  });

  it('says nothing under an untouched voucher but its validity: the figure is over it', () => {
    expect(voucherVms(vouchersOf(MARTIN), TODAY, WORDS)).toEqual([
      {
        voucherId: 'voucher-dev-martin',
        title: 'Ваучер за подарък',
        balance: euro('25,00'),
        detail: null,
        accessibleName: `Ваучер за подарък: ${euro('25,00')} от ${euro('25,00')}`,
      },
    ]);
    const untouched = voucherWith('voucher-new', { balanceCents: cents(5000) });
    expect(voucherVms([untouched], TODAY, WORDS)[0]).toMatchObject({
      balance: euro('50,00'),
      detail: 'до 31.12',
    });
    const drawn = voucherWith('voucher-open', voucherExpiry(null));
    expect(voucherVms([drawn], TODAY, WORDS)[0]).toMatchObject({
      detail: `от ${euro('50,00')}`,
      accessibleName: `Ваучер за подарък: ${euro('25,00')} от ${euro('50,00')}`,
    });
  });

  it('keeps a voucher to its last day and drops it after', () => {
    const [georgi] = vouchersOf(GEORGI);
    const held = [must(georgi)];
    expect(voucherVms(held, localDate('2026-12-31'), WORDS)).toHaveLength(1);
    expect(voucherVms(held, localDate('2027-01-01'), WORDS)).toEqual([]);
    // Next year's day names its year.
    const next = voucherWith(
      'voucher-next',
      voucherExpiry('2027-01-31T23:59:59.999+02:00'),
    );
    expect(voucherVms([next], TODAY, WORDS)[0]).toMatchObject({
      detail: `от ${euro('50,00')} · до 31.01.2027 г.`,
      accessibleName: `Ваучер за подарък: ${euro('25,00')} от ${euro('50,00')}, важи до 31 януари 2027 г.`,
    });
  });

  it('puts the soonest to expire first, one that never expires last', () => {
    const october = voucherWith(
      'voucher-b',
      voucherExpiry('2026-10-31T23:59:59.999+02:00'),
    );
    const open = voucherWith('voucher-a', voucherExpiry(null));
    expect(
      voucherVms([open, ...vouchersOf(GEORGI), october], TODAY, WORDS).map(
        (voucher) => voucher.voucherId,
      ),
    ).toEqual(['voucher-b', 'voucher-dev-georgi', 'voucher-a']);
  });
});

describe('walletHoldings', () => {
  it('files what is held as the wallet does: the voucher, the ticket, the stamp card', () => {
    expect(walletHoldings(walletInput())).toEqual([
      {
        walletHolding: WalletHolding.Voucher,
        voucher: {
          voucherId: 'voucher-dev-georgi',
          title: 'Ваучер за подарък',
          balance: euro('25,00'),
          detail: `от ${euro('50,00')} · до 31.12`,
          accessibleName: `Ваучер за подарък: ${euro('25,00')} от ${euro('50,00')}, важи до 31 декември`,
        },
      },
      {
        walletHolding: WalletHolding.Ticket,
        ticket: {
          grantId: 'grant-dev-georgi-punch',
          title: 'Безплатно подстригване',
          value: 'Безплатна услуга',
          detail: 'до 28.10',
          stack: null,
          applied: false,
          // Static on this page: named as what it is, not as a button.
          accessibleName:
            'Награда: безплатно подстригване, важи до 28 октомври',
          removeName: 'Премахни отстъпката: Безплатно подстригване',
        },
      },
      {
        walletHolding: WalletHolding.Stamps,
        card: {
          ruleId: 'rule-every-10th-visit',
          title: 'Безплатно подстригване',
          figure: '4 от 10',
          gauge: {
            value: 4,
            min: 0,
            max: 10,
            marks: [],
            label: 'Карта с печати',
            valueText: '4 от 10 печата, още 6 до безплатно подстригване',
          },
          sentence: 'Още 6 посещения',
        },
        line: '10 печата за безплатно подстригване',
      },
    ]);
  });

  it('keeps a ticket on the bill where it stood, under its own name, the soonest to expire first', () => {
    const beard: ClientCardGrant = {
      grantId: CouponGrantId.of('grant-beard'),
      title: 'Безплатно оформяне на брада',
      valueLabel: null,
      expiresOn: null,
    };
    const tickets = walletHoldings(
      walletInput({
        usableGrants: [beard],
        usableGrantsOnBill: [GEORGI_GRANT],
        vouchers: null,
        flags: { ...ALL_FLAGS, achievements: false },
      }),
    );
    expect(tickets).toMatchObject([
      {
        walletHolding: WalletHolding.Ticket,
        ticket: {
          grantId: 'grant-dev-georgi-punch',
          applied: true,
          accessibleName:
            'Безплатно подстригване, Безплатна услуга, с това посещение',
        },
      },
      {
        walletHolding: WalletHolding.Ticket,
        ticket: {
          grantId: 'grant-beard',
          applied: false,
          detail: null,
          accessibleName: 'Награда: безплатно оформяне на брада',
        },
      },
    ]);
  });

  it('draws no ticket for a companion, nor for a paused client', () => {
    const kinds = (input: Partial<WalletInput>) =>
      walletHoldings(walletInput(input)).map(
        (holding) => holding.walletHolding,
      );
    expect(kinds({ isOwner: false })).toEqual([
      WalletHolding.Voucher,
      WalletHolding.Stamps,
    ]);
    expect(kinds({ paused: true })).toEqual([
      WalletHolding.Voucher,
      WalletHolding.Stamps,
    ]);
    // Read-only ways in keep what is held on show.
    expect(kinds({ online: false })).toEqual([
      WalletHolding.Voucher,
      WalletHolding.Ticket,
      WalletHolding.Stamps,
    ]);
    expect(kinds({ visitGone: true })).toEqual([
      WalletHolding.Voucher,
      WalletHolding.Ticket,
      WalletHolding.Stamps,
    ]);
  });

  it('draws no stamp card with `loyalty.achievements` off, and none the account does not hold', () => {
    expect(
      walletHoldings(
        walletInput({ flags: { ...ALL_FLAGS, achievements: false } }),
      ).map((holding) => holding.walletHolding),
    ).toEqual([WalletHolding.Voucher, WalletHolding.Ticket]);
    expect(
      walletHoldings(walletInput({ account: account({ punchCards: [] }) })).map(
        (holding) => holding.walletHolding,
      ),
    ).toEqual([WalletHolding.Voucher, WalletHolding.Ticket]);
  });

  it('agrees a stamp card’s words with its size, and never counts past it', () => {
    const [card] = walletHoldings(
      walletInput({
        vouchers: null,
        usableGrants: [],
        account: account({
          punchCards: [
            { ...must(GEORGI_ACCOUNT.punchCards[0]), filled: 12, size: 10 },
          ],
        }),
      }),
    );
    expect(card).toMatchObject({
      walletHolding: WalletHolding.Stamps,
      card: {
        figure: '10 от 10',
        gauge: {
          value: 10,
          max: 10,
          valueText: '10 от 10 печата, още 0 до безплатно подстригване',
        },
      },
    });
  });
});

describe('walletActions', () => {
  const ids = (input: Partial<WalletInput>) =>
    walletActions(walletInput(input)).map((action) => action.id);

  it('draws the four discs on the owner’s card, «Използвай» promoted and naming its grant', () => {
    expect(walletActions(walletInput())).toEqual([
      {
        id: 'use',
        icon: 'promo.coupon',
        label: 'Използвай',
        prominence: 'accent',
        accessibleName: 'Използвай награда на това посещение',
        grantId: 'grant-dev-georgi-punch',
        count: null,
      },
      {
        id: 'code',
        icon: 'loyalty.enterCode',
        label: 'Код',
        prominence: 'standard',
        accessibleName: 'Код: въведи или сканирай',
        grantId: null,
        count: null,
      },
      {
        id: 'catalog',
        icon: 'loyalty.reward',
        label: 'Награди',
        prominence: 'standard',
        accessibleName: 'Награди за точки',
        grantId: null,
        count: null,
      },
      {
        id: 'history',
        icon: 'loyalty.ledger',
        label: 'История',
        prominence: 'standard',
        accessibleName: 'История на движението',
        grantId: null,
        count: null,
      },
    ]);
  });

  it('counts the tickets on the disc when several are ready, and names none', () => {
    const beard: ClientCardGrant = {
      grantId: CouponGrantId.of('grant-beard'),
      title: 'Безплатно оформяне на брада',
      valueLabel: null,
      expiresOn: null,
    };
    const twin: ClientCardGrant = {
      ...GEORGI_GRANT,
      grantId: CouponGrantId.of('grant-twin'),
    };
    const [use] = walletActions(
      walletInput({ usableGrants: [GEORGI_GRANT, beard] }),
    );
    expect(use).toMatchObject({
      id: 'use',
      accessibleName: 'Използвай награда на това посещение, 2 награди',
      grantId: null,
      count: 2,
    });
    // Identical grants are ONE ticket: the disc applies the soonest of them.
    expect(
      walletActions(walletInput({ usableGrants: [twin, GEORGI_GRANT] }))[0],
    ).toMatchObject({ grantId: 'grant-dev-georgi-punch', count: null });
  });

  it('draws no «Използвай» once every held reward is on the bill', () => {
    expect(
      ids({ usableGrants: [], usableGrantsOnBill: [GEORGI_GRANT] }),
    ).toEqual(['code', 'catalog', 'history']);
    expect(ids({ usableGrants: [] })).toEqual(['code', 'catalog', 'history']);
  });

  it('draws only the discs that read for a companion, offline, on a gone visit and for a paused client', () => {
    const readOnly = ['catalog', 'history'];
    expect(ids({ isOwner: false })).toEqual(readOnly);
    expect(ids({ online: false })).toEqual(readOnly);
    expect(ids({ visitGone: true })).toEqual(readOnly);
    expect(ids({ paused: true })).toEqual(readOnly);
  });

  it('draws the code alone where the points are off', () => {
    expect(
      ids({ flags: { ...ALL_FLAGS, points: false }, usableGrants: [] }),
    ).toEqual(['code']);
    expect(ids({ flags: { ...ALL_FLAGS, points: false } })).toEqual([
      'use',
      'code',
    ]);
  });

  it('draws «Награди» while its section stands: on its way, failed, or holding a reward', () => {
    expect(ids({ catalog: { loadState: LoadState.Loading } })).toContain(
      'catalog',
    );
    expect(ids({ catalog: { loadState: LoadState.Failed } })).toContain(
      'catalog',
    );
    expect(ids({ catalog: null })).not.toContain('catalog');
    const empty = loyaltyCatalogWith((catalog) => ({
      ...catalog,
      rewards: [],
    }));
    expect(
      ids({ catalog: { loadState: LoadState.Ready, data: empty } }),
    ).toEqual(['use', 'code', 'history']);
  });

  it('promotes one disc at most, and «Използвай» names a grant or counts them', () => {
    for (const input of [
      walletInput(),
      walletInput({ usableGrants: [] }),
      martinInput(),
      walletInput({ paused: true }),
    ]) {
      const actions = walletActions(input);
      expect(
        actions.filter((action) => action.prominence === 'accent').length,
      ).toBeLessThanOrEqual(1);
      for (const action of actions) {
        // WCAG 2.5.3: the name begins with the visible word.
        expect(action.accessibleName.startsWith(action.label)).toBe(true);
        if (action.id === 'use') {
          expect(action.grantId === null).not.toBe(action.count === null);
        } else {
          expect([action.grantId, action.count]).toEqual([null, null]);
        }
      }
    }
  });
});

describe('walletRhythmVm', () => {
  const RULE_FULL = [
    'Посещение на всеки 6 седмици пази ритъма.',
    '7 дни гратис след срока.',
    'До 2 защити покриват пропуснат срок; нова на всеки 5 посещения в ритъм.',
    'Час, отменен от салона, не се брои за пропуск.',
    'Записан час до 14 дни след срока пази ритъма.',
    'След прекъсване посещение до 14 дни връща ритъма.',
  ];

  it('draws a healthy run by its figure and its track: no capsule', () => {
    expect(walletRhythmVm(walletInput())).toEqual({
      figure: '24',
      unit: 'посещения в ритъм',
      phase: null,
      // Two visits share September, so every visit is captioned by its day.
      periods: [
        {
          id: 'kept-2026-04-22',
          mark: 'kept',
          caption: '22.04',
          description: 'април · посещение 22.04',
        },
        {
          id: 'kept-2026-05-19',
          mark: 'kept',
          caption: '19.05',
          description: 'май · посещение 19.05',
        },
        {
          id: 'kept-2026-06-15',
          mark: 'kept',
          caption: '15.06',
          description: 'юни · посещение 15.06',
        },
        {
          id: 'kept-2026-07-13',
          mark: 'kept',
          caption: '13.07',
          description: 'юли · посещение 13.07',
        },
        {
          id: 'kept-2026-08-06',
          mark: 'kept',
          caption: '6.08',
          description: 'август · посещение 6.08',
        },
        {
          id: 'kept-2026-09-03',
          mark: 'kept',
          caption: '3.09',
          description: 'септември · посещение 3.09',
        },
        {
          id: 'kept-2026-09-28',
          mark: 'kept',
          caption: '28.09',
          description: 'септември · посещение 28.09',
        },
        // The sentence under the track names the day: the mark does not.
        {
          id: 'current',
          mark: 'current',
          caption: '',
          description: 'текущ период · до 9 ноември',
        },
      ],
      trackName: '24 посещения в ритъм, следващото до 9 ноември',
      stateLine: 'Следващото посещение до 9.11 пази ритъма.',
      best: null,
      protections: 'Автоматични защити: 2',
      ruleLine: 'На всеки 6 седмици · 7 дни гратис',
      ruleFull: RULE_FULL,
      ruleUpcoming: null,
      frozen: false,
    });
  });

  it('says «днес» for the visit in the chair, and coaches towards the one after it', () => {
    const rhythm = must(walletRhythmVm(martinInput()));
    expect(rhythm).toMatchObject({
      figure: '13',
      phase: null,
      trackName: '13 посещения в ритъм, следващото до 9 ноември',
      stateLine: 'Следващото посещение до 9.11 пази ритъма.',
    });
    // Every drawn visit has a month of its own: the axis is months.
    expect(
      rhythm.periods.map((period) => [period.mark, period.caption]),
    ).toEqual([
      ['kept', 'дек.'],
      ['kept', 'фев.'],
      ['kept', 'март'],
      ['kept', 'апр.'],
      ['kept', 'май'],
      ['kept', 'юли'],
      ['kept', 'авг.'],
      ['current', 'днес'],
    ]);
    expect(rhythm.periods.at(-1)?.description).toBe(
      'текущ период · до 28 септември',
    );
  });

  it('says a visit on the book holds the due date, where a warning would have stood', () => {
    const held = must(walletRhythmVm(martinInput({ inChairToday: false })));
    expect(held).toMatchObject({
      phase: { text: 'Записан за 28.09', tone: 'neutral' },
      stateLine: 'Записан е за 28.09 · срокът се пази.',
      // The line names the booking: the track names no due date.
      trackName: '13 посещения в ритъм',
    });
    // The due date is another day than the one the line names: captioned.
    expect(held.periods.at(-1)).toMatchObject({
      mark: 'current',
      caption: 'до 30.09',
    });
    // Beside a healthy figure the line says it and nothing stands beside it.
    expect(
      rhythmIn(StreakPhaseState.active(), {
        heldByAppointmentId: AppointmentId.of('appt-next'),
        heldOn: day('2026-10-29'),
      }),
    ).toMatchObject({
      phase: null,
      stateLine: 'Записан е за 29.10 · срокът се пази.',
    });
  });

  it('warns when the due date is near, and in grace', () => {
    const atRisk = must(
      walletRhythmVm(
        martinInput({
          inChairToday: false,
          account: {
            ...MARTIN_ACCOUNT,
            streaks: [{ ...MARTIN_RHYTHM, ...NOT_HELD }],
          },
        }),
      ),
    );
    expect(atRisk).toMatchObject({
      phase: { text: 'До 30.09', tone: 'warning' },
      stateLine: 'Последно преди 6 седмици · посещение до 30.09 пази ритъма.',
      trackName: '13 посещения в ритъм, следващото до 30 септември',
    });
    expect(atRisk.periods.at(-1)).toMatchObject({
      mark: 'current',
      caption: '',
    });

    const inGrace = rhythmIn(StreakPhaseState.inGrace(day('2026-10-05')), {
      dueBy: day('2026-09-28'),
      ...NOT_HELD,
    });
    expect(inGrace).toMatchObject({
      phase: { text: 'Гратис до 5.10', tone: 'warning' },
      stateLine: 'В гратисния период до 5.10.',
    });
    expect(inGrace.periods.at(-1)).toMatchObject({
      mark: 'current',
      caption: 'до 28.09',
    });
  });

  it('draws a covered period as protected, and says what covers it', () => {
    const covered = (reason: FreezeReason) =>
      rhythmIn(StreakPhaseState.frozen(day('2026-11-16'), reason), {
        dueBy: day('2026-11-16'),
      });
    expect(covered(FreezeReason.Freeze)).toMatchObject({
      phase: { text: 'Защитен', tone: 'neutral' },
      stateLine: 'Пропускът е покрит автоматично.',
      trackName: '24 посещения в ритъм',
    });
    expect(covered(FreezeReason.Freeze).periods.at(-1)).toEqual({
      id: 'current',
      mark: 'protected',
      caption: 'до 16.11',
      description: 'ноември · защита: използвана защита',
    });
    expect(covered(FreezeReason.Excuse)).toMatchObject({
      phase: { text: 'Защитен', tone: 'neutral' },
      stateLine: 'Пропускът е за сметка на салона.',
    });
    expect(covered(FreezeReason.Excuse).periods.at(-1)?.description).toBe(
      'текущ период · до 16 ноември',
    );
    expect(covered(FreezeReason.Pause).stateLine).toBe(
      'Замразено, докато записването е спряно',
    );
    expect(covered(FreezeReason.ClientPause).stateLine).toBe(
      'Пауза по желание на клиента',
    );
    expect(covered(FreezeReason.ClientPause).periods.at(-1)?.description).toBe(
      'ноември · защита: пауза по желание на клиента',
    );
  });

  it('coaches a broken run back while a visit can still restore it, and never after', () => {
    const broken = (repairableUntil: string) =>
      rhythmIn(
        StreakPhaseState.broken(day('2026-09-20'), day(repairableUntil)),
        { current: 0, dueBy: null, ...NO_PERIOD },
      );
    const repairable = broken('2026-10-04');
    expect(repairable).toMatchObject({
      figure: '0',
      unit: 'посещения в ритъм',
      phase: { text: 'Прекъснат', tone: 'warning' },
      stateLine:
        'Ритъмът започва отначало · посещение до 4.10 го възстановява.',
      best: 'Най-много: 24',
      trackName: '0 посещения в ритъм, най-много 24',
    });
    // No period is open: the track ends on its last closed mark.
    expect(
      repairable.periods.filter((period) => period.id === 'current'),
    ).toEqual([]);
    // Nothing can be restored: the day before the break is no day to name.
    expect(broken('2026-09-19')).toMatchObject({
      phase: { text: 'Прекъснат', tone: 'neutral' },
      stateLine: 'Първото посещение започва ритъма.',
    });
  });

  it('draws what became of each closed period, captioning the visits alone', () => {
    const rhythm = rhythmIn(StreakPhaseState.active(), {
      periods: [
        {
          streakPeriodMark: StreakPeriodMark.Kept,
          on: day('2026-04-22'),
          periodReason: null,
        },
        {
          streakPeriodMark: StreakPeriodMark.Missed,
          on: day('2026-06-10'),
          periodReason: null,
        },
        {
          streakPeriodMark: StreakPeriodMark.Repaired,
          on: day('2026-06-20'),
          periodReason: null,
        },
        {
          streakPeriodMark: StreakPeriodMark.Protected,
          on: day('2026-08-08'),
          periodReason: StreakExcuse.StaffCancelled,
        },
        {
          streakPeriodMark: StreakPeriodMark.Protected,
          on: day('2026-08-20'),
          periodReason: FreezeReason.Freeze,
        },
        {
          streakPeriodMark: StreakPeriodMark.Kept,
          on: day('2026-09-28'),
          periodReason: null,
        },
      ],
    });
    expect(rhythm.periods).toEqual([
      {
        id: 'kept-2026-04-22',
        mark: 'kept',
        caption: 'апр.',
        description: 'април · посещение 22.04',
      },
      {
        id: 'missed-2026-06-10',
        mark: 'missed',
        caption: '',
        description: 'юни · без посещение',
      },
      {
        id: 'repaired-2026-06-20',
        mark: 'repaired',
        caption: 'юни',
        description: 'юни · възстановено',
      },
      {
        id: 'protected-2026-08-08',
        mark: 'protected',
        caption: '',
        description: 'август · защита: салонът отмени часа',
      },
      {
        id: 'protected-2026-08-20',
        mark: 'protected',
        caption: '',
        description: 'август · защита: използвана защита',
      },
      {
        id: 'kept-2026-09-28',
        mark: 'kept',
        caption: 'септ.',
        description: 'септември · посещение 28.09',
      },
      {
        id: 'current',
        mark: 'current',
        caption: '',
        description: 'текущ период · до 9 ноември',
      },
    ]);
  });

  it('draws eight marks at most, one of them open, whatever the run holds', () => {
    expect(WALLET_RHYTHM_PERIODS).toBe(8);
    expect(WALLET_RHYTHM_PERIODS_NARROW).toBe(6);
    for (const input of [walletInput(), martinInput()]) {
      const rhythm = must(walletRhythmVm(input));
      expect(rhythm.periods).toHaveLength(8);
      expect(
        rhythm.periods.filter((period) => period.mark === 'current'),
      ).toHaveLength(1);
      expect(new Set(rhythm.periods.map((period) => period.id)).size).toBe(8);
      expect(rhythm.ruleFull.length).toBeGreaterThan(0);
    }
  });

  it('starts a rhythm nobody has begun, and agrees a run of one', () => {
    expect(
      rhythmIn(StreakPhaseState.active(), {
        current: 0,
        best: 0,
        lastQualifiedAtUtcMs: null,
        dueBy: null,
        periods: [],
        ...NO_PERIOD,
      }),
    ).toMatchObject({
      figure: '0',
      phase: null,
      periods: [],
      stateLine: 'Първото посещение започва ритъма.',
      trackName: '0 посещения в ритъм',
      best: null,
    });
    expect(
      rhythmIn(StreakPhaseState.active(), {
        current: 1,
        best: 1,
        periods: GEORGI_RHYTHM.periods.slice(-1),
      }),
    ).toMatchObject({
      figure: '1',
      unit: 'посещение в ритъм',
      trackName: '1 посещение в ритъм, следващото до 9 ноември',
    });
  });

  it('keeps a paused client’s run and freezes it', () => {
    const rhythm = must(walletRhythmVm(walletInput({ paused: true })));
    expect(rhythm).toMatchObject({
      figure: '24',
      phase: null,
      stateLine: 'Замразено, докато записването е спряно',
      trackName: '24 посещения в ритъм',
      frozen: true,
    });
    expect(rhythm.periods.at(-1)).toMatchObject({
      mark: 'current',
      caption: 'до 9.11',
    });
  });

  it('says the best run only while the run in progress is shorter', () => {
    expect(
      rhythmIn(StreakPhaseState.active(), { current: 9, best: 23 }),
    ).toMatchObject({
      figure: '9',
      best: 'Най-много: 23',
      trackName: '9 посещения в ритъм, най-много 23, следващото до 9 ноември',
    });
  });

  it('counts the protections in reserve only where the rule grants them', () => {
    expect(
      rhythmIn(StreakPhaseState.active(), { freezesBanked: 0 }).protections,
    ).toBeNull();
    const without = ruleWith((rule) => ({
      ...rule,
      protectionsEnabled: false,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
    }));
    const rhythm = must(walletRhythmVm(walletInput({ rhythm: without })));
    expect(rhythm.protections).toBeNull();
    expect(rhythm.ruleFull).toEqual(
      RULE_FULL.filter((_, index) => index !== 2),
    );
  });

  it('words the rule in force, short on its line and whole under it', () => {
    const lean = ruleWith((rule) => ({
      ...rule,
      streakInterval: StreakInterval.Fixed,
      intervalDays: 35,
      graceDays: 0,
      riskLeadDays: 0,
      protectionsEnabled: false,
      protectionsMaxBanked: 0,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
      excuses: [],
      bookingHoldEnabled: false,
      bookingHoldMaxDaysPastDue: 0,
      repairEnabled: false,
      repairWindowDays: 14,
      repairPerYear: 1,
    }));
    expect(must(walletRhythmVm(walletInput({ rhythm: lean })))).toMatchObject({
      ruleLine: 'На всеки 5 седмици',
      ruleFull: ['Посещение на всеки 5 седмици пази ритъма.'],
    });
  });

  it('words a personal interval from the period the projection pinned', () => {
    const personal = ruleWith((rule) => ({
      ...rule,
      streakInterval: StreakInterval.Personal,
      intervalTolerancePct: 50,
      intervalMinDays: 21,
      intervalMaxDays: 84,
      intervalFallbackDays: 42,
    }));
    const known = must(
      walletRhythmVm(
        walletInput({
          rhythm: personal,
          account: withRhythm(
            periodOf(39, 7, StreakIntervalSource.Personal, 26),
          ),
        }),
      ),
    );
    expect(known.ruleLine).toBe('На всеки 5½ седмици · 7 дни гратис');
    expect(known.ruleFull[0]).toBe(
      'Идва на около 3½ седмици, срокът му е 5½ седмици.',
    );
    // The period the fixed rule opened knows no habit: the newcomer's words.
    expect(
      must(walletRhythmVm(walletInput({ rhythm: personal }))).ruleFull[0],
    ).toBe('Срокът е 6 седмици, докато опознаем навика му.');
  });

  it('names the services a rule counts, when the host can name them', () => {
    const counted = ruleWith((rule) => ({
      ...rule,
      streakQualifier: StreakQualifier.Services,
      qualifierServiceIds: [
        ServiceId.of('svc-fade'),
        ServiceId.of('svc-beard'),
      ],
    }));
    const names = new Map([
      ['svc-fade', 'Фейд'],
      ['svc-beard', 'Оформяне на брада'],
    ]);
    expect(
      must(
        walletRhythmVm(
          walletInput({
            rhythm: counted,
            nameOf: (id) => names.get(id) ?? null,
          }),
        ),
      ).ruleFull.at(-1),
    ).toBe('Броят се посещения с: Фейд и Оформяне на брада.');
    expect(
      must(walletRhythmVm(walletInput({ rhythm: counted }))).ruleFull,
    ).toEqual(RULE_FULL);
  });

  it('announces the rule that waits, from its day, in the running case', () => {
    const current = StreakRuleSystem.current(RHYTHM);
    const next = rhythmHeadWith(undefined, {
      ...current,
      version: 2,
      effectiveFromLocalDate: day('2026-10-01'),
      streakInterval: StreakInterval.Fixed,
      intervalDays: 35,
      streakTransition: StreakTransition.Grandfather,
    });
    expect(
      must(walletRhythmVm(walletInput({ rhythm: next }))).ruleUpcoming,
    ).toBe('От 1.10: на всеки 5 седмици · 7 дни гратис');
    // Its day has come: it is the rule in force, and nothing waits.
    expect(
      must(
        walletRhythmVm(
          walletInput({ rhythm: next, today: localDate('2026-10-01') }),
        ),
      ).ruleUpcoming,
    ).toBeNull();
  });

  it('is absent with the flag off, while the rule is off, and for an account without the rhythm', () => {
    expect(
      walletRhythmVm(walletInput({ flags: { ...ALL_FLAGS, streaks: false } })),
    ).toBeNull();
    expect(
      walletRhythmVm(
        walletInput({
          rhythm: ruleWith((rule) => ({ ...rule, enabled: false })),
        }),
      ),
    ).toBeNull();
    expect(walletRhythmVm(walletInput({ rhythm: null }))).toBeNull();
    expect(
      walletRhythmVm(walletInput({ account: account({ streaks: [] }) })),
    ).toBeNull();
  });
});

describe('walletVm — the status (WE)', () => {
  const TIERS = ['Бронз', 'Сребро', 'Злато', 'Платина'];

  it('holds what remains in the ring, from the tier the account stands on to the next', () => {
    expect(tierSection(walletInput())).toEqual({
      ring: {
        value: 2,
        min: 0,
        max: 8,
        marks: [],
        label: 'Статус',
        valueText: 'Злато, 14 посещения за 12 месеца, още 6 до Платина',
      },
      remaining: '6',
      line1: 'до Платина',
      line2: '14 посещения за 12 месеца',
      steps: {
        value: 14,
        min: 0,
        max: 20,
        // The ring says what remains: no node says it a second time.
        marks: [
          { value: 0, label: 'Бронз' },
          { value: 6, label: 'Сребро' },
          { value: 12, label: 'Злато' },
          { value: 20, label: 'Платина' },
        ],
        label: 'Статус',
        valueText: 'Злато, 14 посещения за 12 месеца, още 6 до Платина',
      },
      accessibleName: 'Злато, 14 посещения за 12 месеца, още 6 до Платина',
    });
  });

  it('fills the ring at the top, and says how the status is kept', () => {
    const top = must(
      tierSection(
        walletInput({
          account: account({
            tierId: TierId.of('platinum'),
            tierQualifying: 24,
            nextTierId: null,
            tierRemaining: null,
          }),
        }),
      ),
    );
    expect(top).toMatchObject({
      ring: { value: 1, max: 1 },
      remaining: null,
      line1: 'Най-високият статус',
      line2: '24 посещения за 12 месеца',
      steps: { value: 20, max: 20 },
      accessibleName:
        'Най-високият статус · запазва се с 20 посещения за 12 месеца',
    });
    expect(top.steps.marks.map((mark) => mark.label)).toEqual(TIERS);
  });

  it('starts the ring empty on the first tier, and agrees a count of one', () => {
    expect(
      tierSection(
        walletInput({
          account: account({
            tierId: TierId.of('bronze'),
            tierQualifying: 1,
            nextTierId: TierId.of('silver'),
            tierRemaining: 5,
          }),
        }),
      ),
    ).toMatchObject({
      ring: { value: 1, max: 6 },
      remaining: '5',
      line1: 'до Сребро',
      line2: '1 посещение за 12 месеца',
      accessibleName: 'Бронз, 1 посещение за 12 месеца, още 5 до Сребро',
    });
  });

  it('never runs the arc backwards under an override that stands above the visits', () => {
    const tier = must(
      tierSection(
        walletInput({
          account: account(
            {
              tierId: TierId.of('silver'),
              tierQualifying: 7,
              nextTierId: TierId.of('platinum'),
              tierRemaining: 13,
            },
            TierOverride.adjustment(
              TierId.of('gold'),
              null,
              AdjustmentId.of('adj-1'),
            ),
          ),
        }),
      ),
    );
    expect(tier.ring).toMatchObject({ value: 0, min: 0, max: 8 });
    expect(tier.remaining).toBe('13');
    expect(tier.steps.value).toBe(7);
  });

  it('is absent with the flag off and with a catalogue that names no tiers, and waits for the catalogue', () => {
    expect(
      'tier' in
        walletVm(walletInput({ flags: { ...ALL_FLAGS, tiers: false } })),
    ).toBe(false);
    expect(
      walletVm(walletInput({ catalog: { loadState: LoadState.Loading } })).tier,
    ).toEqual({ loadState: LoadState.Loading });
    expect(
      'tier' in
        walletVm(
          walletInput({
            catalog: {
              loadState: LoadState.Ready,
              data: loyaltyCatalogWith((catalog) => ({
                ...catalog,
                tiers: [],
              })),
            },
          }),
        ),
    ).toBe(false);
  });
});

describe('walletVm — what the points buy (WF)', () => {
  it('puts the rewards the points cover first, and meters the ones they do not', () => {
    expect(catalogTiles(walletInput())).toEqual([
      {
        rewardId: 'reward-beard',
        title: 'Безплатно оформяне на брада',
        cost: '120 т.',
        affordable: true,
        missing: null,
        progress: null,
        src: null,
        accessibleName: 'Безплатно оформяне на брада, 120 точки',
      },
      {
        rewardId: 'reward-cut',
        title: 'Безплатно подстригване',
        cost: '250 т.',
        affordable: true,
        missing: null,
        progress: null,
        src: null,
        accessibleName: 'Безплатно подстригване, 250 точки',
      },
      {
        rewardId: 'reward-product',
        title: 'Продукт по избор',
        cost: '400 т.',
        affordable: false,
        missing: 'още 42 т.',
        progress: 0.895,
        src: null,
        accessibleName: 'Продукт по избор, 400 точки, още 42',
      },
    ]);
  });

  it('keeps the catalogue’s order inside each half', () => {
    expect(
      catalogTiles(walletInput({ account: account({ balance: 300 }) })).map(
        (tile) => [tile.rewardId, tile.affordable],
      ),
    ).toEqual([
      ['reward-beard', true],
      ['reward-cut', true],
      ['reward-product', false],
    ]);
    expect(
      catalogTiles(walletInput({ account: account({ balance: 130 }) })).map(
        (tile) => [tile.rewardId, tile.missing],
      ),
    ).toEqual([
      ['reward-beard', null],
      ['reward-cut', 'още 120 т.'],
      ['reward-product', 'още 270 т.'],
    ]);
  });

  it('meters from nothing for an account that owes, and never to the full', () => {
    const owing = catalogTiles(
      walletInput({ account: account({ balance: -40 }) }),
    );
    expect(owing.map((tile) => [tile.missing, tile.progress])).toEqual([
      ['още 160 т.', 0],
      ['още 290 т.', 0],
      ['още 440 т.', 0],
    ]);
    for (const balance of [0, 119, 399, 400, 5000]) {
      for (const tile of catalogTiles(
        walletInput({ account: account({ balance }) }),
      )) {
        expect(tile.missing === null).toBe(tile.affordable);
        expect(tile.progress === null).toBe(tile.affordable);
        if (tile.progress !== null) {
          expect(tile.progress).toBeGreaterThanOrEqual(0);
          expect(tile.progress).toBeLessThan(1);
        }
      }
    }
  });

  it('judges a paused client’s reach by the points: nothing is zeroed', () => {
    expect(
      catalogTiles(walletInput({ paused: true })).map(
        (tile) => tile.affordable,
      ),
    ).toEqual([true, true, false]);
  });

  it('draws a reward’s picture where the host holds one, by the reward or by its coupon', () => {
    const tiles = catalogTiles(
      walletInput({
        covers: new Map([
          ['reward-beard', 'https://example.test/covers/beard.jpg'],
          ['coupon-punch-free-cut', 'https://example.test/covers/fade.jpg'],
        ]),
      }),
    );
    expect(tiles.map((tile) => tile.src)).toEqual([
      'https://example.test/covers/beard.jpg',
      'https://example.test/covers/fade.jpg',
      null,
    ]);
  });

  it('draws no tile for a reward nobody can take today', () => {
    const catalog = loyaltyCatalogWith((published) => ({
      ...published,
      rewards: published.rewards.map((reward) =>
        reward.id === RewardId.of('reward-beard')
          ? { ...reward, enabled: false }
          : reward.id === RewardId.of('reward-cut')
            ? {
                ...reward,
                availableFrom: day('2026-11-01'),
                availableUntil: null,
              }
            : reward.id === RewardId.of('reward-product')
              ? {
                  ...reward,
                  availableFrom: null,
                  availableUntil: day('2026-09-27'),
                }
              : reward,
      ),
    }));
    expect(
      catalogTiles(
        walletInput({
          catalog: { loadState: LoadState.Ready, data: catalog },
        }),
      ),
    ).toEqual([]);
  });

  it('is absent with the points off and while no reader answers, and waits for the catalogue', () => {
    expect(
      'catalog' in
        walletVm(walletInput({ flags: { ...ALL_FLAGS, points: false } })),
    ).toBe(false);
    expect(
      walletVm(walletInput({ catalog: { loadState: LoadState.Loading } }))
        .catalog,
    ).toEqual({ loadState: LoadState.Loading });
    expect('catalog' in walletVm(walletInput({ catalog: null }))).toBe(false);
  });
});

describe('walletVm', () => {
  it('draws Георги’s wallet whole, every section read', () => {
    const wallet = walletVm(walletInput());
    expect(wallet.frozen).toBe(false);
    expect(wallet.pass).toEqual(passVm(walletInput()));
    expect(wallet.actions.map((action) => action.id)).toEqual([
      'use',
      'code',
      'catalog',
      'history',
    ]);
    expect(wallet.holdings).toEqual({
      loadState: LoadState.Ready,
      data: walletHoldings(walletInput()),
    });
    // One voucher: the heading carries no detail — a bare count said
    // nothing the tickets under it do not (review 3, round 4).
    expect(wallet.holdingsDetail).toBeNull();
    expect(wallet.rhythm).toEqual(walletRhythmVm(walletInput()));
    expect(wallet.tier).toMatchObject({
      loadState: LoadState.Ready,
      data: { remaining: '6', line1: 'до Платина' },
    });
    expect(wallet.catalog).toMatchObject({
      loadState: LoadState.Ready,
      data: {
        name: 'Награди за точки: 358 точки, стигат за 2 от 3 награди',
        tiles: [
          { rewardId: 'reward-beard' },
          { rewardId: 'reward-cut' },
          { rewardId: 'reward-product' },
        ],
      },
    });
  });

  it('shows the newest five events of what moved, by month, a visit’s seats one row', () => {
    expect(WALLET_ACTIVITY_READ).toBe(12);
    expect(WALLET_ACTIVITY_ROWS).toBe(5);
    const wallet = walletVm(walletInput());
    const groups =
      wallet.activity?.loadState === LoadState.Ready
        ? wallet.activity.data
        : [];
    expect(
      groups.map((group) => [
        group.key,
        group.net,
        group.rows.map((row) => [row.title, row.amount, row.balanceAfter]),
      ]),
    ).toEqual([
      [
        '2026-09',
        '+34 т.',
        [
          ['Фейд', '+17 т.', '358 т.'],
          ['Посещение', '+17 т.', '341 т.'],
        ],
      ],
      ['2026-08', '+17 т.', [['Посещение', '+17 т.', '324 т.']]],
      ['2026-07', '+27 т.', [['Посещение', '+27 т.', '307 т.']]],
      ['2026-06', '+17 т.', [['Посещение', '+17 т.', '280 т.']]],
    ]);
    expect(groups[0]?.rows[0]).toMatchObject({
      entryId: georgiEntryId(35),
      lines: [{ text: `28.09${NBSP}· Иван` }],
    });
  });

  it('prints no net over a month the five rows cut', () => {
    const wallet = walletVm(
      walletInput({
        activity: {
          loadState: LoadState.Ready,
          data: journalOf('georgi').slice(0, 7),
        },
      }),
    );
    const groups =
      wallet.activity?.loadState === LoadState.Ready
        ? wallet.activity.data
        : [];
    // Seven rows are everything there is: six events, of which five show.
    expect(groups.map((group) => [group.key, group.net])).toEqual([
      ['2026-09', '+34 т.'],
      ['2026-08', '+17 т.'],
      ['2026-07', '+27 т.'],
      ['2026-06', '+17 т.'],
    ]);
    const cut = walletVm(
      walletInput({
        activity: {
          loadState: LoadState.Ready,
          data: journalOf('georgi').filter((row) => row.seq !== 34),
        },
      }),
    );
    const shown =
      cut.activity?.loadState === LoadState.Ready ? cut.activity.data : [];
    expect(shown.flatMap((group) => group.rows)).toHaveLength(5);
    expect(shown.at(-1)).toMatchObject({ key: '2026-05', net: '+17 т.' });
  });

  it('draws a section on its way as loading and a failed one as failed, each under its own heading', () => {
    const loading = walletVm(
      walletInput({
        catalog: { loadState: LoadState.Loading },
        vouchers: { loadState: LoadState.Loading },
        activity: { loadState: LoadState.Loading },
      }),
    );
    expect(loading).toMatchObject({
      holdings: { loadState: LoadState.Loading },
      holdingsDetail: null,
      tier: { loadState: LoadState.Loading },
      catalog: { loadState: LoadState.Loading },
      activity: { loadState: LoadState.Loading },
    });
    // The account is read: the pass and the rhythm draw at once.
    expect(loading.pass.figure).toBe('358');
    expect(loading.rhythm?.figure).toBe('24');

    const failed = walletVm(
      walletInput({
        catalog: { loadState: LoadState.Failed },
        vouchers: { loadState: LoadState.Failed },
        activity: { loadState: LoadState.Failed },
      }),
    );
    expect(failed).toMatchObject({
      holdings: { loadState: LoadState.Failed },
      holdingsDetail: null,
      tier: { loadState: LoadState.Failed },
      catalog: { loadState: LoadState.Failed },
      activity: { loadState: LoadState.Failed },
    });
  });

  it('holds the tickets and the stamp cards alone while no reader answers for the vouchers', () => {
    const wallet = walletVm(walletInput({ vouchers: null, activity: null }));
    expect(wallet.holdings).toMatchObject({
      loadState: LoadState.Ready,
      data: [
        { walletHolding: WalletHolding.Ticket },
        { walletHolding: WalletHolding.Stamps },
      ],
    });
    expect(wallet.holdingsDetail).toBeNull();
    expect('activity' in wallet).toBe(false);
  });

  it('sums the vouchers beside the count once several are held: the one detail the heading carries', () => {
    const second = voucherWith('voucher-second', {
      initialValueCents: cents(3000),
      balanceCents: cents(3000),
      ...voucherExpiry(null),
    });
    const wallet = walletVm(
      walletInput({
        vouchers: {
          loadState: LoadState.Ready,
          data: [...vouchersOf(GEORGI), second],
        },
      }),
    );
    expect(wallet.holdingsDetail).toBe(`4 · ${euro('55,00')}`);
    expect(
      wallet.holdings.loadState === LoadState.Ready
        ? wallet.holdings.data.map((holding) => holding.walletHolding)
        : [],
    ).toEqual([
      WalletHolding.Voucher,
      WalletHolding.Voucher,
      WalletHolding.Ticket,
      WalletHolding.Stamps,
    ]);
  });

  it('reads an account that holds nothing as an empty wallet, and one that moved nothing as no feed', () => {
    const wallet = walletVm(
      walletInput({
        account: account({ balance: 50, punchCards: [] }),
        usableGrants: [],
        vouchers: { loadState: LoadState.Ready, data: [] },
        activity: { loadState: LoadState.Ready, data: [] },
      }),
    );
    expect(wallet.holdings).toEqual({
      loadState: LoadState.Ready,
      data: [],
    });
    expect(wallet.holdingsDetail).toBeNull();
    expect('activity' in wallet).toBe(false);
    expect(wallet.actions.map((action) => action.id)).toEqual([
      'code',
      'catalog',
      'history',
    ]);
    expect(wallet.catalog).toMatchObject({
      loadState: LoadState.Ready,
      data: { name: 'Награди за точки: 50 точки, стигат за 0 от 3 награди' },
    });
  });

  it('drops each section with its flag', () => {
    const off = walletVm(
      walletInput({
        flags: {
          points: false,
          streaks: false,
          achievements: false,
          tiers: false,
        },
      }),
    );
    expect(Object.keys(off).sort()).toEqual([
      'actions',
      'frozen',
      'holdings',
      'holdingsDetail',
      'pass',
    ]);
    expect(off.pass).toMatchObject({
      figure: '14',
      unit: 'посещения',
      tier: null,
    });
    expect(off.actions.map((action) => action.id)).toEqual(['use', 'code']);
    expect(
      off.holdings.loadState === LoadState.Ready
        ? off.holdings.data.map((holding) => holding.walletHolding)
        : [],
    ).toEqual([WalletHolding.Voucher, WalletHolding.Ticket]);

    const pointsOnly = walletVm(
      walletInput({
        flags: {
          points: true,
          streaks: false,
          achievements: false,
          tiers: false,
        },
      }),
    );
    expect(Object.keys(pointsOnly).sort()).toEqual([
      'actions',
      'activity',
      'catalog',
      'frozen',
      'holdings',
      'holdingsDetail',
      'pass',
    ]);
  });

  it('drops the catalogue’s section once it is known to offer nothing', () => {
    const empty = loyaltyCatalogWith((catalog) => ({
      ...catalog,
      rewards: [],
    }));
    const wallet = walletVm(
      walletInput({
        catalog: { loadState: LoadState.Ready, data: empty },
      }),
    );
    expect('catalog' in wallet).toBe(false);
    expect(wallet.tier?.loadState).toBe(LoadState.Ready);
  });

  it('keeps a paused wallet’s values, and takes its tickets and the verbs that write', () => {
    const wallet = walletVm(walletInput({ paused: true }));
    expect(wallet.frozen).toBe(true);
    expect(wallet.pass).toMatchObject({
      figure: '358',
      state: 'Замразено',
      frozen: true,
    });
    expect(wallet.rhythm).toMatchObject({ figure: '24', frozen: true });
    expect(
      wallet.holdings.loadState === LoadState.Ready
        ? wallet.holdings.data.map((holding) => holding.walletHolding)
        : [],
    ).toEqual([WalletHolding.Voucher, WalletHolding.Stamps]);
    expect(wallet.holdingsDetail).toBeNull();
    expect(wallet.actions.map((action) => action.id)).toEqual([
      'catalog',
      'history',
    ]);
    // History is never frozen.
    expect(wallet.activity?.loadState).toBe(LoadState.Ready);
  });

  it('draws a companion’s own account without the tickets and the verbs of the visit', () => {
    const wallet = walletVm(
      martinInput({ isOwner: false, inChairToday: false }),
    );
    expect(wallet.pass).toMatchObject({
      holder: 'Мартин Илиев',
      figure: '215',
    });
    expect(wallet.actions.map((action) => action.id)).toEqual([
      'catalog',
      'history',
    ]);
    expect(
      wallet.holdings.loadState === LoadState.Ready
        ? wallet.holdings.data.map((holding) => holding.walletHolding)
        : [],
    ).toEqual([WalletHolding.Voucher, WalletHolding.Stamps]);
  });

  it('holds final copy only, in both languages: no slot, no stray value, a minus for a minus', () => {
    const models = [
      walletVm(walletInput()),
      walletVm(martinInput()),
      walletVm(walletInput({ paused: true })),
      walletVm(walletInput({ account: account({ balance: -40 }) })),
      walletVm(
        walletInput({
          words: wordsOf('en'),
          translate: translatorOf('en'),
        }),
      ),
    ];
    const all = strings(models, 'wallet');
    expect(all.length).toBeGreaterThan(300);
    expect(
      all.filter(
        ([, text]) =>
          /\{\{|\}\}|undefined|\bnull\b|NaN|\[object/u.test(text) ||
          / {2}/u.test(text) ||
          /(^|\s)-\d/u.test(text),
      ),
    ).toEqual([]);
    const names = all.filter(([path]) =>
      /\.(accessibleName|trackName|valueText|name)$/u.test(path),
    );
    expect(names.filter(([, text]) => text.trim().length < 3)).toEqual([]);
  });

  it('words the wallet in English', () => {
    const wallet = walletVm(
      walletInput({ words: wordsOf('en'), translate: translatorOf('en') }),
    );
    expect(wallet.pass).toMatchObject({
      figure: '358',
      unit: 'points',
      since: 'Client since March 2025',
    });
    expect(wallet.rhythm?.ruleLine).toBe('Every 6 weeks · 7 days of grace');
    expect(wallet.actions.map((action) => action.label)).toEqual([
      'Use now',
      'Code',
      'Rewards',
      'History',
    ]);
  });
});
