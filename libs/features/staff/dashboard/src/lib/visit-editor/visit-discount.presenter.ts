import {
  CouponValue,
  DiscountMethod,
  DiscountSource,
  type StaffEditDraft,
  TipPreset,
} from '@core/components';
import { PriceCents, VoucherRefusal } from '@core/primitives';
import { BillingSystem } from '@core/systems';
import type {
  UiChoiceOption,
  UiChoiceTile,
  UiIconName,
  UiSliderMark,
} from '@creativo/ui/controls';
import { formatCents } from '@creativo/ui/wall-clock';
import type {
  VisitEditorGrantOption,
  VisitEditorPromoOption,
} from './staff-visit-editor';
import {
  type DiscountApplyVm,
  DiscountCodeState,
  DiscountKind,
  type DiscountLineVm,
  type DiscountSummaryVm,
  type DockBillVm,
  type EvaluatedLine,
  type OfferChoice,
  OfferSource,
  TIP_AMOUNT_PREFIX,
  type TipPresetVm,
  TipTile,
  type VisitEditorWords,
  type VisitWording,
  type VoucherLineVm,
} from './visit-editor.vm';

/*
 * THE BILL'S WORDS (Law 10): the discount page, its tickets, the row that
 * reads them, the dock's figure and the tip's tiles. The bill's figures are
 * `BillingSystem.draftBill`'s and what may join it is `Combinability`'s and
 * `DiscountSystem`'s; they arrive here as cents and flags.
 */

/**
 * Cents → `2,80 €`, in the BILL's currency (`vm.currency` — DEP-21: it
 * was the constant EUR; identical for every EUR visit). Every figure the
 * sheet words is cents already, so there is no `''` path any more.
 */
export function moneyLabel(cents: PriceCents, wording: VisitWording): string {
  return formatCents(cents, wording.currency, wording.intlLocale);
}

/**
 * A percent as a figure: «20 %» — the sign set off by a narrow no-break
 * space, as Bulgarian typography and revision 3 (§1.1, §2.1.2) write it;
 * `Intl`'s percent style for `bg` sets none. The one place the spacing
 * lives: the ruler's marks, the dock, every ticket.
 */
export function percentLabel(percent: number): string {
  return `${percent}\u202f%`;
}

/** A percent discount's RULE: «−20 %» — one grammar for the ticket, the dock and the slider alike. */
export function percentOffLabel(percent: number): string {
  return `−${percentLabel(percent)}`;
}

/** The quarters, named: the percent ruler's marks. */
export const PERCENT_MARKS: readonly UiSliderMark[] = [0, 25, 50, 75, 100].map(
  (value) => ({ value, label: percentLabel(value) }),
);

/**
 * Whether a coupon's NAME already says its rule: a word of the name shares
 * its stem with the rule's first word — «Безплатно подстригване» and
 * «Безплатна услуга» (безплат-), "Free haircut" and "Free service". The
 * stem is the word less its ending (its last two letters, never under
 * four), so a gender or number ending does not hide the echo; «Пето
 * подстригване» says nothing of the kind.
 */
export function nameSaysRule(
  name: string,
  rule: string,
  locale: string,
): boolean {
  const words = (text: string): string[] =>
    text
      .toLocaleLowerCase(locale)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0);
  const [head] = words(rule);
  if (head === undefined) return false;
  const stem = head.slice(0, Math.max(4, head.length - 2));
  return words(name).some((word) => word.startsWith(stem));
}

/**
 * What a value does — the RULE: `−10 %`, `−5,00 €`, «Безплатна услуга».
 * The rule, never an echo of the coupon's name above it: «Безплатно
 * подстригване» over «Безплатно» said one word twice (WP7 review).
 */
function valueLabel(value: CouponValue, wording: VisitWording): string {
  switch (value.discountMethod) {
    case DiscountMethod.PercentOff:
      return percentOffLabel(value.discountPercent);
    case DiscountMethod.FixedAmount:
      return `−${moneyLabel(value.discountAmountCents, wording)}`;
    case DiscountMethod.FreeService:
      return wording.words.discountFree;
  }
}

/**
 * THE COUPON'S VALUE LINE — one grammar for every ticket that shows a
 * coupon: the discount page's offers and applied lines, the client
 * card's ready tickets (E, LD). The rule, as `valueLabel` words it —
 * unless the coupon's NAME already says it, and then nothing: «Безплатно
 * подстригване» over «Безплатна услуга» told one fact twice, in the
 * ticket's loudest line (WP7 review r6). Only a free service can: a
 * percentage or a sum is a figure the name does not carry. Never the
 * saving on this bill in its place — a free service zeroes whatever is
 * left, so its sum is a bill preview, and an offer shows its rule, never
 * a preview (owner, 2026-09-16). A name that does not say it («Пето
 * подстригване») keeps «Безплатна услуга»; an applied line's chip still
 * says what it took («−17,50 €»).
 */
export function couponValueLine(
  name: string,
  value: CouponValue,
  wording: VisitWording,
): string | null {
  const rule = valueLabel(value, wording);
  return value.discountMethod === DiscountMethod.FreeService &&
    nameSaysRule(name, rule, wording.lang)
    ? null
    : rule;
}

/** The line's title: the coupon's name, or the row's own word for a manual figure. */
function discountTitle(
  discount: StaffEditDraft.Discount,
  words: VisitEditorWords,
): string {
  return discount.discountSource === DiscountSource.Manual
    ? words.discount
    : discount.label;
}

/** The three spoken names a card carries, from what it says. */
function offerNames(
  label: string,
  code: string | null,
  value: string | null,
  words: VisitEditorWords,
): Pick<OfferChoice, 'accessibleName' | 'blockedName' | 'removeName'> {
  const accessibleName = [label, code, value]
    .filter((part): part is string => part !== null)
    .join(', ');
  return {
    accessibleName,
    blockedName: `${accessibleName}, ${words.couponBlocked}`,
    removeName: `${words.removeDiscount}: ${label}`,
  };
}

/**
 * One of the shop's live codes as its card: «−10 %», whether it stacks and
 * its spoken names. The card reads the offer's RULE as its figure, never what
 * it would take off this bill: two offers previewed on the same bill do not
 * add up once stacked, and a figure that changes under the reader is a figure
 * that lies (owner: "confusion = bad UX"). `applied` and `blocked` are the
 * sheet's answers (`Combinability.canAdd`), carried as they are.
 */
export function promoOfferVm(
  promo: VisitEditorPromoOption,
  applied: boolean,
  blocked: boolean,
  wording: VisitWording,
): OfferChoice {
  const { words } = wording;
  const value = couponValueLine(promo.label, promo.value, wording);
  return {
    offerSource: OfferSource.Promo,
    key: `code:${promo.code}`,
    testId: `staff-visit-discount-promo-${promo.code}`,
    code: promo.code,
    grantId: null,
    label: promo.label,
    exclusive: promo.exclusive,
    value,
    line: promo.exclusive ? words.alone : words.stacks,
    applied,
    blocked,
    ...offerNames(promo.label, promo.code, value, words),
  };
}

/** A coupon the client holds as its card — the same ticket as a shop code's. */
export function grantOfferVm(
  grant: VisitEditorGrantOption,
  applied: boolean,
  blocked: boolean,
  wording: VisitWording,
): OfferChoice {
  const { words } = wording;
  const value = couponValueLine(grant.label, grant.value, wording);
  return {
    offerSource: OfferSource.Grant,
    key: `grant:${grant.grantId}`,
    testId: `staff-visit-discount-grant-${grant.grantId}`,
    code: null,
    grantId: grant.grantId,
    label: grant.label,
    exclusive: grant.exclusive,
    value,
    // The card's chip: whether it stacks, in words.
    line: grant.exclusive ? words.alone : words.stacks,
    applied,
    blocked,
    ...offerNames(grant.label, null, value, words),
  };
}

/**
 * A bill's discount line as a TICKET on the ladder — the card's own applied
 * ticket, brought to the root (owner, 2026-09-17: "not list rows — the exact
 * components you use in the action sheet, the applied ones with «Премахни»"):
 * the kind's glyph, the name, the RULE as the figure with the code beside it,
 * exactly as it reads on the card. In the chip, what the rule made of THIS
 * bill — the evaluator's own settled figure, which adds up where the card's
 * previews could not — or nothing, where the rule is the sum itself (a fixed
 * sum, unless the bill capped it).
 */
export function discountLineVm(
  line: EvaluatedLine,
  wording: VisitWording,
): DiscountLineVm {
  const { discount } = line;
  const { words } = wording;
  const title = discountTitle(discount, words);
  const value = couponValueLine(title, discount, wording);
  const took = `−${moneyLabel(line.amount, wording)}`;
  const glyph: UiIconName =
    discount.discountSource === DiscountSource.Manual
      ? discount.discountMethod === DiscountMethod.PercentOff
        ? 'promo.percent'
        : 'promo.sum'
      : 'promo.coupon';
  const code =
    discount.discountSource === DiscountSource.Code ? discount.code : null;
  const detail = took === value ? null : took;
  return {
    key: line.key,
    discountSource: discount.discountSource,
    testId: `staff-visit-discount-${line.key}`,
    title,
    code,
    glyph,
    value,
    detail,
    name: [title, code, value, detail]
      .filter((part): part is string => part !== null)
      .join(', '),
    removeName: `${words.removeDiscount}: ${title}`,
  };
}

/**
 * The receipt's voucher line, a ticket too: each covers what the discounts
 * and the vouchers before it left, never more than it has (the drafted bill's
 * cascade) — what it covers is its figure, what it still holds its chip.
 */
export function voucherLineVm(
  voucher: StaffEditDraft.Voucher,
  coversCents: PriceCents,
  holdsCents: PriceCents,
  wording: VisitWording,
): VoucherLineVm {
  const { words } = wording;
  const amountLabel = `−${moneyLabel(coversCents, wording)}`;
  const left = words.voucherLeft(moneyLabel(holdsCents, wording));
  return {
    voucher,
    testId: `staff-visit-voucher-${voucher.voucherId}`,
    amountLabel,
    left,
    name: [words.voucher, voucher.code, amountLabel, left].join(', '),
    removeName: `${words.removeVoucher}: ${voucher.code}`,
  };
}

/**
 * THE ADD ROW'S WHISPER: while nothing is on the bill, the coupon the
 * client holds, so the promise the shop made is read without opening
 * anything (recognition over recall). Once a line stands, nothing — the
 * lines above the row say what is on the bill.
 */
export function discountWhisper(
  lines: readonly unknown[],
  vouchers: readonly unknown[],
  grants: readonly OfferChoice[],
  words: VisitEditorWords,
): string | null {
  if (lines.length > 0 || vouchers.length > 0) return null;
  const grant = grants.find((choice) => !choice.applied);
  return grant === undefined ? null : words.discountHasGrant(grant.label);
}

/**
 * A ROW'S READING OF THE WHOLE BILL (owner, 2026-09-17: "in the main sheet
 * they should live only minimal on the row"): «Няма»; one line — its code,
 * its name, or a figure's rule — with what it took off in brackets; more —
 * how many, with what they took off together (`many` is each row's word: the
 * root row says "2 приложени", the page's own row "2 отстъпки", because its
 * label already says applied). A voucher counts among them: it is a line on
 * the bill, and the page holds its ticket with the rest.
 */
export function discountSummaryVm(
  lines: readonly DiscountLineVm[],
  vouchers: readonly VoucherLineVm[],
  takenCents: PriceCents,
  many: (count: number) => string,
  wording: VisitWording,
): DiscountSummaryVm {
  const count = lines.length + vouchers.length;
  if (count === 0) {
    return { label: wording.words.discountNone, applied: false };
  }
  // What came off altogether — the lines and the covers (the drafted bill's).
  const amount = moneyLabel(takenCents, wording);
  if (count === 1) {
    const line = lines[0];
    const name =
      line !== undefined
        ? (line.code ??
          (line.discountSource !== DiscountSource.Manual
            ? line.title
            : (line.value ?? line.title)))
        : (vouchers[0]?.voucher.code ?? '');
    return { label: `${name} (${amount})`, applied: true };
  }
  return { label: `${many(count)} (${amount})`, applied: true };
}

/** The row's spoken name: «Отстъпка: Няма», «Отстъпка: FIRST10 (2,80 €)» — and the coupon whispered, when one is. */
export function discountRowName(
  value: DiscountSummaryVm,
  whisper: string | null,
  words: VisitEditorWords,
): string {
  return `${words.discount}: ${value.label}${whisper ? `, ${whisper}` : ''}`;
}

/** The page's own row, spoken: «Приложени: 2 отстъпки (5,00 €)». */
export function linesRowName(
  value: DiscountSummaryVm,
  words: VisitEditorWords,
): string {
  return `${words.appliedRow}: ${value.label}`;
}

/** What the dock's promise is worded from: the kind in force and its field. */
export type DiscountApplyInput = {
  readonly discountKind: DiscountKind;
  /** The code field, normalised. */
  readonly code: string;
  /** The owner is being asked about that code. */
  readonly checking: boolean;
  /** The typed figure, read — `null` when it is neither a percent nor a sum. */
  readonly figure: CouponValue.PercentOff | CouponValue.FixedAmount | null;
  readonly wording: VisitWording;
};

/**
 * THE CARD'S PROMISE on the discount sheet: what «Приложи» would put on
 * the bill from the field beneath the kind, in its own words — «Приложи GIFT2025»,
 * «Приложи −10 %», «Приложи −5,00 €» — or nothing, in which case the foot
 * keeps its «Готово» and the card is only being read. A code being checked
 * holds the button with «Проверявам…»; a figure never exceeds what the
 * page can take, since it snaps to it as it is written. The cards need
 * no promise: «Използвай» applies them.
 */
export function discountApplyVm(
  input: DiscountApplyInput,
): DiscountApplyVm | null {
  const { wording, figure } = input;
  const { words } = wording;
  switch (input.discountKind) {
    case DiscountKind.Coupon: {
      if (input.code.length === 0) return null;
      if (input.checking) {
        return { label: words.discountChecking, disabled: true };
      }
      return { label: words.applyDiscount(input.code), disabled: false };
    }
    case DiscountKind.Percent:
    case DiscountKind.Amount: {
      if (figure === null) return null;
      const what =
        figure.discountMethod === DiscountMethod.PercentOff
          ? percentOffLabel(figure.discountPercent)
          : `−${moneyLabel(figure.discountAmountCents, wording)}`;
      return { label: words.applyDiscount(what), disabled: false };
    }
    default:
      return null;
  }
}

/** The copy under the code field for its state; `null` when idle. */
export function codeNoteOf(
  state: DiscountCodeState,
  words: VisitEditorWords,
): string | null {
  switch (state) {
    case DiscountCodeState.Idle:
      return null;
    case DiscountCodeState.Checking:
      return words.discountChecking;
    case DiscountCodeState.Unknown:
      return words.discountUnknownCode;
    case DiscountCodeState.Already:
      return words.codeAlready;
    case VoucherRefusal.Void:
      return words.voucherVoid;
    case VoucherRefusal.Expired:
      return words.voucherExpired;
    case VoucherRefusal.Empty:
      return words.voucherEmpty;
    case DiscountCodeState.NothingLeft:
      return words.voucherNothingLeft;
  }
}

/** What the dock's bill is worded from. */
export type DockBillInput = {
  /** A visit the server has not seen: its figure is the catalogue's. */
  readonly isNew: boolean;
  /** The drafted legs' total by the catalogue (`BillingSystem.draftLegsTotal`). */
  readonly catalogueTotal: PriceCents | null;
  /** The VM owner's saved subtotal, already worded. */
  readonly savedLabel: string | null;
  /** What is due on the dock's bill (the drafted bill's balance). */
  readonly due: PriceCents | null;
  /** The price as it was, when something has come off it. */
  readonly was: PriceCents | null;
  readonly tip: PriceCents | null;
  readonly wording: VisitWording;
};

/**
 * THE DOCK'S BILL. The figure is what still changes hands at the counter —
 * the saved subtotal, less what the drafted discounts take off, less what the
 * drafted vouchers pay; on a new visit, the catalogue's. The subtotal is the
 * VM owner's (the legs' figures are labels, not a sum). `was` is the price
 * struck beside what is due — the sale tag's own grammar: the one line that
 * says what a discount did, or would do, without a word. `tip` is the dock's
 * green plus: the drafted tip, or nothing.
 */
export function dockBillVm(input: DockBillInput): DockBillVm {
  const { wording, isNew, due, was, tip } = input;
  const { words } = wording;
  const figure = isNew
    ? input.catalogueTotal === null
      ? '—'
      : moneyLabel(input.catalogueTotal, wording)
    : due === null
      ? (input.savedLabel ?? '—')
      : moneyLabel(due, wording);
  return {
    caption: isNew ? words.byCatalogue : words.atShop,
    was: was === null ? null : moneyLabel(was, wording),
    figure,
    tip:
      tip === null || tip <= 0
        ? null
        : words.tipInDock(moneyLabel(tip, wording)),
  };
}

/** What a reader hears for the percent thumb: «−15 % · 23,80 €» — the share, and what the dock says is due. */
export function percentValueText(percent: number, dockFigure: string): string {
  return `${percentOffLabel(percent)} · ${dockFigure}`;
}

/** The same for the sum's thumb: «−5,00 € · 23,80 €». */
export function amountValueText(
  value: PriceCents,
  dockFigure: string,
  wording: VisitWording,
): string {
  return `−${moneyLabel(value, wording)} · ${dockFigure}`;
}

/** The sum ruler's ends, named: «0,00 €» and the bill; none without a ruler. */
export function amountMarks(
  max: PriceCents | null,
  wording: VisitWording,
): readonly UiSliderMark[] {
  return max === null
    ? []
    : [
        { value: 0, label: moneyLabel(PriceCents.ZERO, wording) },
        { value: max, label: moneyLabel(max, wording) },
      ];
}

/**
 * The presets, each already a figure of THIS visit's total, sized for the
 * BENTO (owner, 2026-09-16: "small tiles for direct tips, bigger tiles for
 * the ones that mean something else"). The figures are
 * `BillingSystem.tipPresets`: the round-ups LARGE, the coins REGULAR. THE TIP
 * IS THE FIGURE, on every tile alike; the target a round-up rounds the bill to
 * is the muted line beneath — «0,50 € · общо 15,00 €» (owner, 2026-09-16:
 * «до 15,00 €» as the headline read as "anything up to 15"). No share beneath
 * a coin: the barber counts money, not percentages, and a coin says all it
 * means by itself. None when the total is unknown.
 */
export function tipPresetsVm(
  totalCents: PriceCents | null,
  wording: VisitWording,
): readonly TipPresetVm[] {
  return BillingSystem.tipPresets(totalCents).map((preset) => ({
    id: `${TIP_AMOUNT_PREFIX}${preset.amountCents}`,
    amount: preset.amountCents,
    label: moneyLabel(preset.amountCents, wording),
    detail:
      preset.targetCents === null
        ? ''
        : wording.words.tipRoundUp(moneyLabel(preset.targetCents, wording)),
    size: preset.tipPreset === TipPreset.RoundUp ? 'large' : 'regular',
  }));
}

/**
 * The section's tiles in the bento's order: the AMOUNTS first — the
 * large round-ups so they sit side by side, then the coins, and «Без»
 * closing the coins' row as the amounts' zero, so four regular tiles
 * fill a row (or the cells beside and beneath an odd round-up) — and
 * «Друга сума» as the full-width row at the end. The two that are not
 * amounts, «Без» and «Друга сума», sit together at the foot of the grid
 * (owner, 2026-09-17: "None and Other should be next to each other"; the
 * order Square's tipping screen keeps, with the amounts read first).
 */
export function tipTilesVm(
  presets: readonly TipPresetVm[],
  words: VisitEditorWords,
): readonly UiChoiceTile[] {
  const tile = (preset: TipPresetVm): UiChoiceTile => ({
    id: preset.id,
    label: preset.label,
    ...(preset.detail ? { detail: preset.detail } : {}),
    size: preset.size,
    testId: `staff-visit-tip-tile-${preset.amount}`,
  });
  return [
    ...presets.filter((preset) => preset.size === 'large').map(tile),
    ...presets.filter((preset) => preset.size === 'regular').map(tile),
    {
      id: TipTile.None,
      label: words.tipNone,
      testId: 'staff-visit-tip-tile-none',
    },
    {
      id: TipTile.Other,
      // The tile is the CHOICE, not the readout: its name stays whatever
      // sum the entry beneath holds (owner, 2026-09-16: "adding the
      // custom tip should not change the label"). The sum is read on
      // the entry, on the dock and on the row.
      label: words.tipPageAmount,
      size: 'wide',
      testId: 'staff-visit-tip-tile-other',
    },
  ];
}

/** The tip row's readout: «Без», or the amount — never a share it inferred. */
export function tipReadoutOf(
  tipCents: PriceCents | null,
  wording: VisitWording,
): string {
  return tipCents === null
    ? wording.words.tipNone
    : moneyLabel(tipCents, wording);
}

/** The tip row's spoken name: «Бакшиш: 2,00 €», «Бакшиш: Без». */
export function tipRowName(readout: string, words: VisitEditorWords): string {
  return `${words.tip}: ${readout}`;
}

/** The two gates on the «Вид» pop-up — the shop has live codes; this role handles money (D-2.2, D-2.6). */
export type DiscountKindGates = {
  readonly hasPromos: boolean;
  readonly mayDiscount: boolean;
};

/** The kinds on offer: the shop's codes when it has live ones, a voucher or coupon always, the figures for money roles. */
export function discountKindOptions(
  words: VisitEditorWords,
  gates: DiscountKindGates,
): readonly UiChoiceOption[] {
  const kinds: UiChoiceOption[] = [];
  if (gates.hasPromos) {
    kinds.push({
      id: DiscountKind.Promo,
      label: words.kindPromo,
      description: words.kindPromoDetail,
      testId: 'staff-visit-discount-kind-promo',
    });
  }
  kinds.push({
    id: DiscountKind.Coupon,
    label: words.kindCoupon,
    description: words.kindCouponDetail,
    testId: 'staff-visit-discount-kind-coupon',
  });
  if (gates.mayDiscount) {
    kinds.push({
      id: DiscountKind.Percent,
      label: words.discountPercent,
      description: words.discountScope,
      testId: 'staff-visit-discount-kind-percent',
    });
    kinds.push({
      id: DiscountKind.Amount,
      label: words.discountAmount,
      description: words.discountScope,
      testId: 'staff-visit-discount-kind-amount',
    });
  }
  return kinds;
}

/** The kind in force, by the pop-up's own label; nothing for one not on offer. */
export function discountKindLabelOf(
  kinds: readonly UiChoiceOption[],
  kind: DiscountKind,
): string {
  return kinds.find((option) => option.id === kind)?.label ?? '';
}

/** The pop-up's trigger, spoken: «Вид: Процент». */
export function discountKindName(
  label: string,
  words: VisitEditorWords,
): string {
  return `${words.discountKind}: ${label}`;
}
