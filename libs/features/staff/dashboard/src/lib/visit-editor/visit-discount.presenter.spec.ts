import { describe, expect, it } from 'vitest';
import {
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  type StaffEditDraft,
  VoucherCode,
} from '@core/components';
import {
  CouponGrantId,
  CouponId,
  Currency,
  GiftVoucherId,
  PriceCents,
  VoucherRefusal,
} from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { catalogueWording } from '../testing/visit-editor-words';
import {
  PERCENT_MARKS,
  amountMarks,
  amountValueText,
  codeNoteOf,
  couponValueLine,
  discountApplyVm,
  discountKindLabelOf,
  discountKindName,
  discountKindOptions,
  discountLineVm,
  discountRowName,
  discountSummaryVm,
  discountWhisper,
  dockBillVm,
  grantOfferVm,
  linesRowName,
  moneyLabel,
  nameSaysRule,
  percentLabel,
  percentOffLabel,
  percentValueText,
  promoOfferVm,
  tipPresetsVm,
  tipReadoutOf,
  tipRowName,
  tipTilesVm,
  voucherLineVm,
} from './visit-discount.presenter';
import { DiscountCodeState, DiscountKind } from './visit-editor.vm';

/*
 * THE BILL'S WORDS, in both languages, from the app's real catalogue and
 * fixed cents. What may join the bill and what a line takes off are the
 * systems' and pinned there; these pin only how the answers read.
 */

const BG = catalogueWording('bg');
const EN = catalogueWording('en');

/** `Intl` sets a no-break space before the sign; the assertions read plain. */
const plain = (text: string | null) =>
  text === null ? null : text.replace(/\u00a0/g, ' ');

const cents = (raw: number) => unwrapOk(PriceCents.of(raw));
const FIRST10 = VoucherCode.of('FIRST10');
const percent10 = unwrapOk(CouponValue.percentOff(10));
const fiveEuro = unwrapOk(CouponValue.fixedAmount(cents(500), Currency.EUR));
const free = CouponValue.freeService();

const line = (
  discount: StaffEditDraft.Discount,
  amount: number,
  key = 'k',
) => ({ key, discount, amount: cents(amount) });

const codeLine = (value: CouponValue, label = 'Първо посещение') =>
  ({
    ...DiscountProvenance.code(FIRST10),
    ...CouponValue.sliceOf(value),
    label,
    grantId: null,
    code: FIRST10,
    exclusive: false,
  }) as StaffEditDraft.Discount;

const manualLine = (value: CouponValue) =>
  ({
    ...DiscountProvenance.manual(),
    ...CouponValue.sliceOf(value),
    label: 'manual',
    grantId: null,
    code: null,
    exclusive: false,
  }) as StaffEditDraft.Discount;

const voucher = {
  voucherId: GiftVoucherId.of('v-1'),
  code: VoucherCode.of('GIFT25'),
  availableCents: cents(2500),
} as StaffEditDraft.Voucher;

describe('a figure', () => {
  it('sets the percent sign off by a narrow no-break space, minus and all', () => {
    expect(percentLabel(20)).toBe('20\u202f%');
    expect(percentOffLabel(20)).toBe('−20\u202f%');
    expect(PERCENT_MARKS.map((mark) => mark.value)).toEqual([
      0, 25, 50, 75, 100,
    ]);
    expect(PERCENT_MARKS[1]?.label).toBe('25\u202f%');
  });

  it('words money in the bill’s currency and the language’s own tag', () => {
    expect(plain(moneyLabel(cents(280), BG))).toBe('2,80 €');
    expect(moneyLabel(cents(280), EN)).toBe('€2.80');
  });
});

describe('a coupon’s value line', () => {
  it('words the rule', () => {
    expect(couponValueLine('Първо посещение', percent10, BG)).toBe(
      '−10\u202f%',
    );
    expect(plain(couponValueLine('Първо посещение', fiveEuro, BG))).toBe(
      '−5,00 €',
    );
    expect(couponValueLine('Пето подстригване', free, BG)).toBe(
      'Безплатна услуга',
    );
    expect(couponValueLine('Fifth cut', free, EN)).toBe('Free service');
  });

  it('says nothing when a free service’s name already says it', () => {
    expect(couponValueLine('Безплатно подстригване', free, BG)).toBeNull();
    expect(couponValueLine('Free haircut', free, EN)).toBeNull();
  });

  it('reads a name’s echo by its stem, whatever the ending', () => {
    expect(
      nameSaysRule('Безплатно подстригване', 'Безплатна услуга', 'bg'),
    ).toBe(true);
    expect(nameSaysRule('Пето подстригване', 'Безплатна услуга', 'bg')).toBe(
      false,
    );
    expect(nameSaysRule('anything', '', 'en')).toBe(false);
  });
});

describe('an offer’s card', () => {
  const promo = {
    code: FIRST10,
    couponId: CouponId.of('c-1'),
    label: 'Първо посещение',
    value: percent10,
    exclusive: false,
  };
  const grant = {
    grantId: CouponGrantId.of('g-1'),
    couponId: CouponId.of('c-2'),
    label: 'Рожден ден',
    value: percent10,
    exclusive: true,
    couponOccasion: null,
  };

  it('words a shop’s code, its ids and spoken names as the template reads them', () => {
    const offer = promoOfferVm(promo, false, false, BG);
    expect(offer).toMatchObject({
      offerSource: 'PROMO',
      key: 'code:FIRST10',
      testId: 'staff-visit-discount-promo-FIRST10',
      code: FIRST10,
      grantId: null,
      value: '−10\u202f%',
      line: 'комбинира се',
      applied: false,
      blocked: false,
      accessibleName: 'Първо посещение, FIRST10, −10\u202f%',
      blockedName: 'Първо посещение, FIRST10, −10\u202f%, Не се комбинира',
      removeName: 'Премахни отстъпката: Първо посещение',
    });
  });

  it('words a held coupon, carrying the sheet’s applied and blocked answers', () => {
    const offer = grantOfferVm(grant, true, true, EN);
    expect(offer).toMatchObject({
      offerSource: 'GRANT',
      key: 'grant:g-1',
      testId: 'staff-visit-discount-grant-g-1',
      code: null,
      line: 'on its own',
      applied: true,
      blocked: true,
      accessibleName: 'Рожден ден, −10\u202f%',
    });
  });
});

describe('a bill’s tickets', () => {
  it('a percent keeps its rule as the figure and what it took as the chip', () => {
    expect(discountLineVm(line(codeLine(percent10), 280), BG)).toMatchObject({
      key: 'k',
      testId: 'staff-visit-discount-k',
      title: 'Първо посещение',
      code: FIRST10,
      glyph: 'promo.coupon',
      value: '−10\u202f%',
      removeName: 'Премахни отстъпката: Първо посещение',
    });
    const vm = discountLineVm(line(codeLine(percent10), 280), BG);
    expect(plain(vm.detail)).toBe('−2,80 €');
    expect(plain(vm.name)).toBe(
      'Първо посещение, FIRST10, −10\u202f%, −2,80 €',
    );
  });

  it('a sum that is exactly what it took has no chip', () => {
    expect(discountLineVm(line(codeLine(fiveEuro), 500), BG).detail).toBeNull();
    // Capped by the bill, the chip says what it really took.
    expect(
      plain(discountLineVm(line(codeLine(fiveEuro), 300), BG).detail),
    ).toBe('−3,00 €');
  });

  it('names a manual figure by the row’s own word, under its own glyph', () => {
    const vm = discountLineVm(line(manualLine(percent10), 280), EN);
    expect(vm.title).toBe('Discount');
    expect(vm.glyph).toBe('promo.percent');
    expect(vm.code).toBeNull();
    expect(discountLineVm(line(manualLine(fiveEuro), 500), EN).glyph).toBe(
      'promo.sum',
    );
  });

  it('a voucher reads what it covers and what it still holds', () => {
    const vm = voucherLineVm(voucher, cents(1500), cents(1000), BG);
    expect(vm.testId).toBe('staff-visit-voucher-v-1');
    expect(plain(vm.amountLabel)).toBe('−15,00 €');
    expect(plain(vm.left)).toBe('остават 10,00 €');
    expect(plain(vm.name)).toBe('Ваучер, GIFT25, −15,00 €, остават 10,00 €');
    expect(vm.removeName).toBe('Премахни ваучера: GIFT25');
    expect(
      plain(voucherLineVm(voucher, cents(1500), cents(1000), EN).left),
    ).toBe('€10.00 left');
  });
});

describe('a row’s reading of the bill', () => {
  const one = discountLineVm(line(codeLine(percent10), 280), BG);
  const manual = discountLineVm(line(manualLine(percent10), 280), BG);
  const held = voucherLineVm(voucher, cents(1500), cents(1000), BG);

  it('says «Няма» on a clean bill, asleep', () => {
    expect(
      discountSummaryVm([], [], cents(0), BG.words.discountApplied, BG),
    ).toEqual({ label: 'Няма', applied: false });
    expect(
      discountSummaryVm([], [], cents(0), EN.words.discountApplied, EN).label,
    ).toBe('None');
  });

  it('names one line by its code, its name, or a figure’s rule', () => {
    expect(
      plain(
        discountSummaryVm([one], [], cents(280), BG.words.discountApplied, BG)
          .label,
      ),
    ).toBe('FIRST10 (2,80 €)');
    expect(
      plain(
        discountSummaryVm(
          [manual],
          [],
          cents(280),
          BG.words.discountApplied,
          BG,
        ).label,
      ),
    ).toBe('−10\u202f% (2,80 €)');
    expect(
      plain(
        discountSummaryVm([], [held], cents(1500), BG.words.discountApplied, BG)
          .label,
      ),
    ).toBe('GIFT25 (15,00 €)');
  });

  it('counts more in the word each row brings', () => {
    expect(
      plain(
        discountSummaryVm(
          [one],
          [held],
          cents(1780),
          BG.words.discountApplied,
          BG,
        ).label,
      ),
    ).toBe('2 приложени (17,80 €)');
    expect(
      plain(
        discountSummaryVm(
          [one],
          [held],
          cents(1780),
          BG.words.discountCount,
          BG,
        ).label,
      ),
    ).toBe('2 отстъпки (17,80 €)');
    expect(
      discountSummaryVm([one], [held], cents(1780), EN.words.discountCount, EN)
        .label,
    ).toBe('2 discounts (€17.80)');
  });

  it('speaks the rows, the whisper after the value', () => {
    const none = { label: 'Няма', applied: false };
    expect(discountRowName(none, null, BG.words)).toBe('Отстъпка: Няма');
    expect(discountRowName(none, 'Има купон: X', BG.words)).toBe(
      'Отстъпка: Няма, Има купон: X',
    );
    expect(linesRowName(none, BG.words)).toBe('Приложени: Няма');
  });

  it('whispers the held coupon only while nothing is on the bill', () => {
    const grant = grantOfferVm(
      {
        grantId: CouponGrantId.of('g-1'),
        couponId: CouponId.of('c-2'),
        label: 'Рожден ден',
        value: percent10,
        exclusive: false,
        couponOccasion: null,
      },
      false,
      false,
      BG,
    );
    expect(discountWhisper([], [], [grant], BG.words)).toBe(
      'Има купон: Рожден ден',
    );
    expect(discountWhisper([one], [], [grant], BG.words)).toBeNull();
    expect(discountWhisper([], [held], [grant], BG.words)).toBeNull();
    expect(discountWhisper([], [], [], BG.words)).toBeNull();
  });
});

describe('the dock’s promise', () => {
  const base = {
    discountKind: DiscountKind.Coupon,
    code: '',
    checking: false,
    figure: null,
    wording: BG,
  };

  it('promises a typed code, holding the button while it is asked', () => {
    expect(discountApplyVm(base)).toBeNull();
    expect(discountApplyVm({ ...base, code: 'GIFT25' })).toEqual({
      label: 'Приложи GIFT25',
      disabled: false,
    });
    expect(
      discountApplyVm({ ...base, code: 'GIFT25', checking: true }),
    ).toEqual({ label: 'Проверявам…', disabled: true });
    expect(
      discountApplyVm({ ...base, code: 'GIFT25', wording: EN })?.label,
    ).toBe('Apply GIFT25');
  });

  it('promises a figure in its own words, and nothing without one', () => {
    expect(
      discountApplyVm({
        ...base,
        discountKind: DiscountKind.Percent,
        figure: {
          discountMethod: DiscountMethod.PercentOff,
          discountPercent: 15,
        },
      })?.label,
    ).toBe('Приложи −15\u202f%');
    expect(
      plain(
        discountApplyVm({
          ...base,
          discountKind: DiscountKind.Amount,
          figure: fiveEuro as CouponValue.FixedAmount,
        })?.label ?? null,
      ),
    ).toBe('Приложи −5,00 €');
    expect(
      discountApplyVm({ ...base, discountKind: DiscountKind.Amount }),
    ).toBeNull();
    // The shop's codes apply by their own cards.
    expect(
      discountApplyVm({ ...base, discountKind: DiscountKind.Promo, code: 'X' }),
    ).toBeNull();
  });
});

describe('the note under the code field', () => {
  it.each([
    [DiscountCodeState.Idle, null, null],
    [DiscountCodeState.Checking, 'Проверявам…', 'Checking…'],
    [DiscountCodeState.Unknown, 'Няма такъв код.', 'No such code.'],
    [DiscountCodeState.Already, 'Вече е добавен.', 'Already added.'],
    [
      DiscountCodeState.NothingLeft,
      'Няма какво да покрие.',
      'Nothing left to cover.',
    ],
    [VoucherRefusal.Void, 'Ваучерът е анулиран.', 'The voucher was cancelled.'],
    [VoucherRefusal.Expired, 'Ваучерът е изтекъл.', 'The voucher has expired.'],
    [VoucherRefusal.Empty, 'Ваучерът е изчерпан.', 'The voucher is used up.'],
  ])('%s', (state, bg, en) => {
    expect(codeNoteOf(state, BG.words)).toBe(bg);
    expect(codeNoteOf(state, EN.words)).toBe(en);
  });
});

describe('the dock’s bill', () => {
  const base = {
    isNew: false,
    catalogueTotal: null,
    savedLabel: '28,00 €',
    due: null,
    was: null,
    tip: null,
    wording: BG,
  };

  it('on a saved visit: the shop’s caption, the saved label, else what is due', () => {
    expect(dockBillVm(base)).toEqual({
      caption: 'В салона',
      was: null,
      figure: '28,00 €',
      tip: null,
    });
    expect(dockBillVm({ ...base, savedLabel: null }).figure).toBe('—');
    const off = dockBillVm({ ...base, due: cents(2520), was: cents(2800) });
    expect(plain(off.figure)).toBe('25,20 €');
    expect(plain(off.was)).toBe('28,00 €');
  });

  it('on a new visit: the catalogue’s caption and total, a dash while unknown', () => {
    expect(dockBillVm({ ...base, isNew: true }).caption).toBe('По каталог');
    expect(dockBillVm({ ...base, isNew: true }).figure).toBe('—');
    expect(
      plain(
        dockBillVm({ ...base, isNew: true, catalogueTotal: cents(4500) })
          .figure,
      ),
    ).toBe('45,00 €');
  });

  it('words the tip as the green plus, never a zero', () => {
    expect(plain(dockBillVm({ ...base, tip: cents(200) }).tip)).toBe(
      '+2,00 € бакшиш',
    );
    expect(dockBillVm({ ...base, tip: cents(0) }).tip).toBeNull();
    expect(dockBillVm({ ...base, tip: cents(200), wording: EN }).tip).toBe(
      '+€2.00 tip',
    );
  });

  it('reads the rulers’ thumbs and ends', () => {
    expect(percentValueText(15, '23,80 €')).toBe('−15\u202f% · 23,80 €');
    expect(plain(amountValueText(cents(500), '23,80 €', BG))).toBe(
      '−5,00 € · 23,80 €',
    );
    expect(amountMarks(null, BG)).toEqual([]);
    expect(
      amountMarks(cents(2800), EN).map((mark) => [mark.value, mark.label]),
    ).toEqual([
      [0, '€0.00'],
      [2800, '€28.00'],
    ]);
  });
});

describe('the tip', () => {
  it('sizes and words the system’s presets, the amount beside the words', () => {
    const presets = tipPresetsVm(cents(1450), BG);
    expect(presets.length).toBeGreaterThan(0);
    const roundUp = presets.find((preset) => preset.size === 'large');
    expect(roundUp?.id).toBe(`amt:${roundUp?.amount}`);
    expect(plain(roundUp?.label ?? null)).toBe('0,50 €');
    expect(plain(roundUp?.detail ?? null)).toBe('общо 15,00 €');
    const coin = presets.find((preset) => preset.size === 'regular');
    expect(coin?.detail).toBe('');
    expect(tipPresetsVm(null, BG)).toEqual([]);
  });

  it('lays the tiles out: round-ups, coins, «Без», then «Друга сума» wide', () => {
    const presets = tipPresetsVm(cents(1450), BG);
    const tiles = tipTilesVm(presets, BG.words);
    const none = tiles.at(-2);
    const other = tiles.at(-1);
    expect(none).toEqual({
      id: 'none',
      label: 'Без',
      testId: 'staff-visit-tip-tile-none',
    });
    expect(other).toEqual({
      id: 'other',
      label: 'Друга сума',
      size: 'wide',
      testId: 'staff-visit-tip-tile-other',
    });
    const sizes = tiles.slice(0, -2).map((tile) => tile.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => a!.localeCompare(b!)));
    const first = tiles[0];
    expect(first?.testId).toBe(`staff-visit-tip-tile-${presets[0]?.amount}`);
    // A coin says nothing beneath it: no empty detail on the tile.
    expect(tiles.find((tile) => tile.size === 'regular')).not.toHaveProperty(
      'detail',
    );
  });

  it('reads the row, spoken too', () => {
    expect(tipReadoutOf(null, BG)).toBe('Без');
    expect(tipReadoutOf(null, EN)).toBe('None');
    expect(plain(tipReadoutOf(cents(200), BG))).toBe('2,00 €');
    expect(tipRowName('Без', BG.words)).toBe('Бакшиш: Без');
  });
});

describe('the «Вид» pop-up', () => {
  it('offers by its two gates, in order', () => {
    expect(
      discountKindOptions(BG.words, {
        hasPromos: false,
        mayDiscount: false,
      }).map((kind) => kind.id),
    ).toEqual([DiscountKind.Coupon]);
    const all = discountKindOptions(BG.words, {
      hasPromos: true,
      mayDiscount: true,
    });
    expect(all.map((kind) => [kind.id, kind.label, kind.testId])).toEqual([
      ['PROMO', 'Промо код', 'staff-visit-discount-kind-promo'],
      ['COUPON', 'Ваучер / Купон', 'staff-visit-discount-kind-coupon'],
      ['PERCENT', 'Процент', 'staff-visit-discount-kind-percent'],
      ['AMOUNT', 'Сума', 'staff-visit-discount-kind-amount'],
    ]);
    expect(all[2]?.description).toBe('Отстъпка за целия час');
  });

  it('reads the kind in force, spoken too', () => {
    const kinds = discountKindOptions(EN.words, {
      hasPromos: false,
      mayDiscount: true,
    });
    expect(discountKindLabelOf(kinds, DiscountKind.Percent)).toBe('Percent');
    expect(discountKindLabelOf(kinds, DiscountKind.Promo)).toBe('');
    expect(discountKindName('Percent', EN.words)).toBe('Kind: Percent');
  });
});
