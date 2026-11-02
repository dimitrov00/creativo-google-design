import {
  type ClientQueryShape,
  PlacementVerdict,
  type StaffEditDraft,
  type VoucherCode,
} from '@core/components';
import type {
  BarberId,
  CouponGrantId,
  Currency,
  DraftPersonKey,
  PriceCents,
  SeatId,
  Tag,
  VoucherRefusal,
} from '@core/primitives';
import type { DraftBill } from '@core/systems';
import type {
  StaffEventLine,
  StaffEventRun,
} from '@creativo/features/shared/visits';
import type {
  UiChoiceOption,
  UiChoiceTileSize,
  UiIconName,
} from '@creativo/ui/controls';
import type { UiForegroundStyle } from '@creativo/ui/modifiers';
import type { ROW_VERB_WORD, RowVerb } from '../row-verb';
import type { VisitEditorClientOption } from './staff-visit-editor';

/*
 * THE VISIT SHEET'S DISPLAY MODEL (Law 10.3): the words a presenter takes,
 * the display structs it hands back, and the tag-to-word tables. Types and
 * tables only — the functions that fill them are `visit-editor.presenter.ts`,
 * `visit-discount.presenter.ts` and `visit-client-row.presenter.ts`.
 *
 * The contract types the sheet's host binds (`VisitEditorVm` and its family)
 * stay exported from the component (D-9).
 */

/* ── The words ─────────────────────────────────────────────────────────── */

/**
 * Every word the sheet's presenters print, read from the catalogue
 * (`visitEditorWordsOf`). A presenter cannot inject Transloco, so it takes
 * this struct; the component builds it inside a `computed()` from the
 * reactive copy table, so a presenter called in a `computed()` is re-run when
 * the words land or the language moves, and no lookup happens in a presenter.
 */
export type VisitEditorWords = {
  /* The bar's page names. */
  readonly addClient: string;
  readonly addService: string;
  readonly discount: string;
  readonly newClientTitle: string;
  readonly newTitle: string;
  readonly photo: string;
  readonly photoSystem: string;
  readonly photoTake: string;
  readonly photoUpload: string;
  readonly scanTitle: string;
  readonly walkIn: string;
  readonly loyaltyTitle: string;
  readonly ledgerTitle: string;
  readonly recordsTitle: string;
  readonly visitsTitle: string;
  readonly achievementsTitle: string;
  /* The rows' own words. */
  readonly duration: string;
  readonly end: string;
  readonly shop: string;
  readonly shopList: string;
  readonly shopMap: string;
  readonly shopUnknown: string;
  readonly today: string;
  readonly tomorrow: string;
  readonly custom: string;
  readonly rebook: string;
  readonly cancelVisit: string;
  readonly cancelAndBlock: string;
  readonly visitNoPhone: string;
  readonly noAccount: string;
  readonly newClient: string;
  readonly servicesAddOne: string;
  /* The discount page. */
  readonly alone: string;
  readonly stacks: string;
  readonly discountAmount: string;
  readonly discountChecking: string;
  readonly discountFree: string;
  readonly discountKind: string;
  readonly discountNone: string;
  readonly discountPercent: string;
  readonly discountScope: string;
  readonly discountUnknownCode: string;
  readonly kindCoupon: string;
  readonly kindCouponDetail: string;
  readonly kindPromo: string;
  readonly kindPromoDetail: string;
  readonly codeAlready: string;
  readonly voucher: string;
  readonly voucherEmpty: string;
  readonly voucherExpired: string;
  readonly voucherNothingLeft: string;
  readonly voucherVoid: string;
  readonly appliedRow: string;
  readonly couponBlocked: string;
  readonly removeDiscount: string;
  readonly removeVoucher: string;
  /* The tip. */
  readonly tip: string;
  readonly tipNone: string;
  readonly tipPageAmount: string;
  /* The names assistive tech hears for a control. */
  readonly forWhom: string;
  readonly variant: string;
  readonly removeService: string;
  readonly removeClient: string;
  readonly visitCall: string;
  /* The dock. */
  readonly byCatalogue: string;
  readonly atShop: string;
  /* With a figure or a name in them. */
  readonly minutes: (minutes: number) => string;
  readonly catalogMinutes: (minutes: number) => string;
  readonly cancelFor: (names: string) => string;
  readonly servicesAddCount: (count: number) => string;
  readonly applyDiscount: (what: string) => string;
  readonly discountApplied: (count: number) => string;
  readonly discountCount: (count: number) => string;
  readonly sameAsLast: (date: string) => string;
  readonly tipInDock: (amount: string) => string;
  readonly tipRoundUp: (total: string) => string;
  readonly voucherLeft: (amount: string) => string;
  readonly discountHasGrant: (label: string) => string;
  readonly newClientParts: (parts: string) => string;
};

/**
 * What money and a name's echo are worded in, beside the words: the BILL's
 * currency (`vm.currency` — DEP-21), the `Intl` tag it formats in (OR-5,
 * DEP-F4) and the raw active language (`nameSaysRule`'s case folding).
 */
export type VisitWording = {
  readonly words: VisitEditorWords;
  readonly currency: Currency;
  readonly intlLocale: string;
  readonly lang: string;
};

/* ── The sheet's tags ──────────────────────────────────────────────────── */

/**
 * Which page is presented on top of the ladder. The client card's pages
 * (client-card-redesign §2) stack under the person's page, four deep at
 * most; every other page sits one deep, straight on the ladder.
 *
 * Revision 3 (§5.1) adds the wallet's ledger «Движение» (`ClientLedger`,
 * three deep under «Лоялност») and the records page «Рекорди»
 * (`ClientRecords`, two deep from the glance's line, three from
 * «Постижения»). `AchievementCategory` stays for the season, archive and
 * day scopes; a category is a chip on «Постижения» now, never a page.
 * The field is `editorPage`; `editorPageWords` keeps each page's word.
 */
export const EditorPage = {
  Client: 'CLIENT',
  ClientSearch: 'CLIENT_SEARCH',
  ClientNew: 'CLIENT_NEW',
  Service: 'SERVICE',
  Discount: 'DISCOUNT',
  Scan: 'SCAN',
  Photo: 'PHOTO',
  Camera: 'CAMERA',
  Library: 'LIBRARY',
  ClientLoyalty: 'CLIENT_LOYALTY',
  ClientLedger: 'CLIENT_LEDGER',
  ClientAchievements: 'CLIENT_ACHIEVEMENTS',
  ClientRecords: 'CLIENT_RECORDS',
  AchievementCategory: 'ACHIEVEMENT_CATEGORY',
  AchievementDetail: 'ACHIEVEMENT_DETAIL',
  ClientHistory: 'CLIENT_HISTORY',
} as const;
export type EditorPage = (typeof EditorPage)[keyof typeof EditorPage];

/**
 * Each page as the DOM spells it — the section's `data-page` (the CSS and
 * the specs select on it).
 */
export const editorPageWords = {
  [EditorPage.Client]: 'client',
  [EditorPage.ClientSearch]: 'clientSearch',
  [EditorPage.ClientNew]: 'clientNew',
  [EditorPage.Service]: 'service',
  [EditorPage.Discount]: 'discount',
  [EditorPage.Scan]: 'scan',
  [EditorPage.Photo]: 'photo',
  [EditorPage.Camera]: 'camera',
  [EditorPage.Library]: 'library',
  [EditorPage.ClientLoyalty]: 'clientLoyalty',
  [EditorPage.ClientLedger]: 'clientLedger',
  [EditorPage.ClientAchievements]: 'clientAchievements',
  [EditorPage.ClientRecords]: 'clientRecords',
  [EditorPage.AchievementCategory]: 'achievementCategory',
  [EditorPage.AchievementDetail]: 'achievementDetail',
  [EditorPage.ClientHistory]: 'clientHistory',
} as const satisfies Record<EditorPage, string>;

/**
 * What the «Вид» pop-up offers: the shop's codes, a voucher or coupon, and —
 * for money roles — a percent or a sum. The pop-up's option ids; internal
 * values, printed nowhere (the options' test ids spell their own words).
 */
export const DiscountKind = {
  Promo: 'PROMO',
  Coupon: 'COUPON',
  Percent: 'PERCENT',
  Amount: 'AMOUNT',
} as const;
export type DiscountKind = Tag<typeof DiscountKind>;

/**
 * Where the code field stands: at rest, asking the owner, or one of its
 * refusals — beside a voucher's own (`VoucherRefusal`, whose values no
 * member here shares). Internal values, printed nowhere.
 */
export const DiscountCodeState = {
  Idle: 'IDLE',
  Checking: 'CHECKING',
  Unknown: 'UNKNOWN',
  Already: 'ALREADY',
  NothingLeft: 'NOTHING_LEFT',
} as const;
export type DiscountCodeState = Tag<typeof DiscountCodeState> | VoucherRefusal;

/**
 * How the end is entered — as a duration, or as a clock time (owner,
 * 2026-09-09). The «Времетраене / Край» pop-up's option ids; internal
 * values, printed nowhere.
 */
export const TimingMode = {
  Duration: 'DURATION',
  End: 'END',
} as const;
export type TimingMode = Tag<typeof TimingMode>;

/**
 * The «Салон» fold's view — values: external contract (the segmented
 * control's `data-segment-id` and the fold's `data-view`), so they keep
 * their spelling.
 */
export const ShopView = {
  Map: 'map',
  List: 'list',
} as const;
export type ShopView = Tag<typeof ShopView>;

/**
 * «Добави снимка»'s doors — the camera, the phone's own pictures, the
 * shop's. The pop-up's option ids; internal values, printed nowhere.
 */
export const PhotoDoor = {
  Camera: 'CAMERA',
  Upload: 'UPLOAD',
  System: 'SYSTEM',
} as const;
export type PhotoDoor = Tag<typeof PhotoDoor>;

/**
 * The tip section's two tiles that are not amounts — values: external
 * contract (the DS tiles' `data-tile-id`), so they keep their spelling.
 * An amount's tile is {@link TIP_AMOUNT_PREFIX} and its cents.
 */
export const TipTile = {
  None: 'none',
  Other: 'other',
} as const;
export type TipTile = Tag<typeof TipTile>;

/** An amount tile's id: `amt:<cents>` (the same `data-tile-id` contract). */
export const TIP_AMOUNT_PREFIX = 'amt:';

/**
 * Which line the head of a settled chair reads — values: external
 * contract (the `staff.visit.resolution.<word>` i18n key segment).
 */
export const ResolutionWord = {
  CancelledByStaff: 'cancelledByStaff',
  CancelledByClient: 'cancelledByClient',
  NoShow: 'noShow',
} as const;
export type ResolutionWord = Tag<typeof ResolutionWord>;

/**
 * The exits the sheet names itself — values: external contract (the
 * `staff-visit-<id>` test id). Any other exit is a lifecycle verb, named by
 * its word (`ROW_VERB_WORD`).
 */
export const VisitExitId = {
  Reinstate: 'reinstate',
  NoShow: 'no-show',
  Rebook: 'rebook',
  Cancel: 'cancel',
  CancelBlock: 'cancel-block',
} as const;
export type VisitExitId = Tag<typeof VisitExitId>;

/** Where an offer on the discount card comes from — the field `offerSource`. */
export const OfferSource = {
  /** One of the shop's published codes. */
  Promo: 'PROMO',
  /** A coupon the client holds. */
  Grant: 'GRANT',
} as const;
export type OfferSource = (typeof OfferSource)[keyof typeof OfferSource];

/** The verdicts the line under the frame speaks (`GridLayoutSystem.frameVerdict`). */
export type SheetVerdict =
  typeof PlacementVerdict.Overlap | typeof PlacementVerdict.Outside;

/** Each verdict as the line's `data-verdict` spells it (the CSS selects on it). */
export const placementVerdictWords = {
  [PlacementVerdict.Overlap]: 'conflict',
  [PlacementVerdict.Outside]: 'outsideRoster',
} as const satisfies Record<SheetVerdict, string>;

/* ── The display structs ───────────────────────────────────────────────── */

/** The line under the frame, with what each verdict names. */
export type FrameVerdictSlice =
  | {
      readonly placementVerdict: typeof PlacementVerdict.Overlap;
      /** The neighbour run into, and its hours. */
      readonly name: string;
      readonly start: string;
      readonly end: string;
    }
  | {
      readonly placementVerdict: typeof PlacementVerdict.Outside;
      /** When the shift opens. */
      readonly time: string;
    };

/**
 * One offer on the discount card — a coupon the client holds or a code the
 * shop published — in one of three states: on offer, applied (its line is
 * on the bill), or blocked by what is on the bill.
 */
export type OfferChoice = {
  /** Where the offer comes from — a shop code or the client's own coupon. */
  readonly offerSource: OfferSource;
  /** The bill line's key, for the way off — and the card's `@for` track key. */
  readonly key: string;
  readonly testId: string;
  /** The shop code a promo card offers; `null` on the client's own coupon. */
  readonly code: VoucherCode | null;
  /** The grant a coupon card honours; `null` on a shop code. */
  readonly grantId: CouponGrantId | null;
  readonly label: string;
  readonly exclusive: boolean;
  /**
   * The RULE — «−10 %», «−5,00 €» — never a figure computed on this bill;
   * `null` when the name already says it (`couponValueLine`).
   */
  readonly value: string | null;
  /** Whether it stacks, in words. */
  readonly line: string;
  readonly applied: boolean;
  readonly blocked: boolean;
  /** The card's spoken name: «Първо посещение, FIRST10, −10 %». */
  readonly accessibleName: string;
  /** The same name, on a blocked card — it says why. */
  readonly blockedName: string;
  /** The stamped card's way off, spoken. */
  readonly removeName: string;
};

/** A discount line on the bill, as its ticket reads. */
export type DiscountLineVm = {
  readonly key: string;
  readonly discountSource: StaffEditDraft.Discount['discountSource'];
  readonly testId: string;
  readonly title: string;
  readonly code: VoucherCode | null;
  readonly glyph: UiIconName;
  readonly value: string | null;
  readonly detail: string | null;
  /** The ticket's spoken name: «Първо посещение, FIRST10, −10 %, −2,80 €». */
  readonly name: string;
  readonly removeName: string;
};

/** A voucher line on the bill, as its ticket reads. */
export type VoucherLineVm = {
  readonly voucher: StaffEditDraft.Voucher;
  readonly testId: string;
  readonly amountLabel: string;
  /** What the voucher still holds — the ticket's chip. */
  readonly left: string;
  readonly name: string;
  readonly removeName: string;
};

/** A row's reading of the whole bill. */
export type DiscountSummaryVm = {
  readonly label: string;
  readonly applied: boolean;
};

/** The dock's promise on a page: its label, and whether it may be pressed. */
export type DiscountApplyVm = {
  readonly label: string;
  readonly disabled: boolean;
};

/** The dock's promise on the service page. */
export type ServiceApplyVm = {
  readonly label: string;
  readonly count: number;
};

/** The dock's bill, worded: the caption, the price struck, what is due, the tip. */
export type DockBillVm = {
  readonly caption: string;
  readonly was: string | null;
  readonly figure: string;
  readonly tip: string | null;
};

/** A tip preset, its figure worded and its tile's id beside it. */
export type TipPresetVm = {
  readonly id: string;
  readonly amount: PriceCents;
  readonly label: string;
  readonly detail: string;
  readonly size: UiChoiceTileSize;
};

/**
 * The drafted bill as the sheet reads it: the system's figures
 * (`BillingSystem.draftBill`), and each listed line with the drafted
 * discount it is — keyed the way the ladder keys it.
 */
export type EvaluatedBill = {
  readonly figures: DraftBill;
  readonly lines: readonly EvaluatedLine[];
};

/** One listed line of {@link EvaluatedBill}. */
export type EvaluatedLine = {
  readonly key: string;
  readonly discount: StaffEditDraft.Discount;
  readonly amount: PriceCents;
};

/**
 * One row of the sheet's last group — an act that is not an edit and not a
 * stamp. `act` is the graph edge the owner performs; `null` for the two that
 * are the sheet's own (the next visit, the block instead).
 */
export type VisitExit = {
  /** The exit's own name, or the lifecycle verb's word — the `staff-visit-<id>` test id. */
  readonly id: VisitExitId | (typeof ROW_VERB_WORD)[RowVerb];
  readonly label: string;
  readonly icon: UiIconName;
  readonly destructive: boolean;
  readonly act: RowVerb | null;
};

/**
 * A barber as a PARTICIPANT — one token at the top of the sheet.
 *
 * Derived, never stored: a visit has no barber of its own, it has legs, and
 * each leg is worked by someone. Two legs worked by one barber are one
 * participant with two services named on the line under him. `null` is a
 * chair the sheet cannot name (was `''`).
 */
export type EditorBarberRow = {
  readonly id: BarberId | null;
  readonly label: string;
  readonly tone: number;
  readonly avatarSrc: string | null;
};

/**
 * A chair as the chair row's menu offers it. `key` is the DS option's id —
 * the chair's id, or, on the roster-less fallback's chair, its name, which
 * the menu has always keyed it by; `id` is what a pick writes into the
 * draft.
 */
export type EditorChairOption = {
  readonly key: string;
  readonly id: BarberId | null;
  readonly name: string;
  readonly tone: number;
  readonly avatarSrc: string | null;
};

/** One seat's row on the ladder, worded. */
export type LegRowVm = {
  readonly seatId: SeatId;
  readonly clientId: DraftPersonKey;
  /** The seat's own label — what a gone visit's row prints. */
  readonly serviceLabel: string;
  /** The service, bare — the row's title. */
  readonly service: string;
  /** The line under it; empty, it takes no line. */
  readonly line: string;
  /** Whose seat, on a party. */
  readonly clientLabel: string;
  readonly forWhomName: string;
  /** The service's variants as choices — empty for a service that has none. */
  readonly variantChoices: readonly UiChoiceOption[];
  /** The chosen choice's option id, or none. */
  readonly variantKey: string | null;
  readonly variantName: string;
  readonly removeName: string;
};

/** The head of a settled chair: which line, in which ink, under which glyph. */
export type ResolutionHeadVm = {
  readonly word: ResolutionWord;
  /** The design system's own foreground tones (its `data-tone`). */
  readonly tone: Extract<UiForegroundStyle, 'destructive' | 'warning'>;
  readonly icon: UiIconName;
};

/**
 * Each settled head. Cancelling keeps the sheet's one red — it is the
 * destructive act everywhere else on it — and a no-show is a warning, the
 * client's fact rather than the shop's. The glyph doubles the state word, so
 * the state survives a greyscale print and a reader who cannot separate two
 * washes.
 */
export const RESOLUTION_HEADS = {
  [ResolutionWord.CancelledByStaff]: {
    word: ResolutionWord.CancelledByStaff,
    tone: 'destructive',
    icon: 'visit.cancelled',
  },
  [ResolutionWord.CancelledByClient]: {
    word: ResolutionWord.CancelledByClient,
    tone: 'destructive',
    icon: 'visit.cancelled',
  },
  [ResolutionWord.NoShow]: {
    word: ResolutionWord.NoShow,
    tone: 'warning',
    icon: 'visit.noShow',
  },
} as const satisfies Record<ResolutionWord, ResolutionHeadVm>;

/** A person row as the add-client page draws it: ticked, matched, marked. */
export type ClientRowVm = VisitEditorClientOption & {
  readonly selected: boolean;
  /** The typed number or mail IS theirs. */
  readonly exact: boolean;
  /** The name as runs, only while some run is the typed one. */
  readonly titleParts: readonly StaffEventRun[] | null;
  /** The facts under the name — the mail, the number, the last visit. */
  readonly lines: readonly StaffEventLine[];
};

/** One detected part of what was typed, as the create row shows it. */
export type CreatePart = {
  /** Which part of the reading it is — never the empty one. */
  readonly clientQueryShape: Exclude<
    ClientQueryShape,
    typeof ClientQueryShape.Empty
  >;
  readonly icon: UiIconName;
  readonly value: string;
};
