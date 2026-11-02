import { CancelledSide, PlacementVerdict } from '@core/components';
import {
  type BarberId,
  BookingStatus,
  type DraftPersonKey,
  type DurationMinutes,
  type SeatId,
  type ServiceId,
  type ServiceVariantId,
  type TrackMinute,
} from '@core/primitives';
import { AppointmentLifecycleSystem } from '@core/systems';
import type { UiChoiceOption, UiSegment } from '@creativo/ui/controls';
import { ClockClosing, formatClock } from '@creativo/ui/wall-clock';
import { ROW_VERB_WORD } from '../row-verb';
import type {
  VisitEditorBarberOption,
  VisitEditorPeer,
  VisitEditorResolution,
  VisitEditorServiceOption,
  VisitEditorShopOption,
  VisitEditorVerb,
} from './staff-visit-editor';
import {
  EditorPage,
  type EditorChairOption,
  type FrameVerdictSlice,
  type LegRowVm,
  PhotoDoor,
  RESOLUTION_HEADS,
  type ResolutionHeadVm,
  ResolutionWord,
  type ServiceApplyVm,
  ShopView,
  TimingMode,
  type VisitEditorWords,
  type VisitExit,
  VisitExitId,
} from './visit-editor.vm';

/*
 * THE VISIT SHEET'S WORDS (Law 10), the ladder and the bar. What is legal,
 * how long and where is ecs-core's (`AppointmentLifecycleSystem`,
 * `VisitDraftSystem`, `GridLayoutSystem`); they arrive here as values and
 * tags, and this words them. The bill's words are
 * `visit-discount.presenter.ts`, the person rows'
 * `visit-client-row.presenter.ts`.
 */

/** How a host's catalogue answers a word with a figure or a name in it. */
export type VisitEditorTranslate = (
  key: string,
  params: Readonly<Record<string, string | number>>,
) => string;

/**
 * THE WORDS, from the catalogue (VE-11). `copy` is a plain string of the
 * loaded table; `translate` fills a word's params. The four that fill their
 * hole by hand read the raw string, as they always have.
 */
export function visitEditorWordsOf(
  copy: (key: string) => string,
  translate: VisitEditorTranslate,
): VisitEditorWords {
  const tipRoundUp = copy('staff.visit.tipRoundUp');
  const voucherLeft = copy('staff.visit.voucherLeft');
  const discountHasGrant = copy('staff.visit.discountHasGrant');
  const newClientParts = copy('staff.visit.newClientParts');
  return {
    addClient: copy('staff.visit.addClient'),
    addService: copy('staff.visit.addService'),
    discount: copy('staff.visit.discount'),
    newClientTitle: copy('staff.visit.newClientTitle'),
    newTitle: copy('staff.visit.newTitle'),
    photo: copy('staff.visit.photo'),
    photoSystem: copy('staff.visit.photoSystem'),
    photoTake: copy('staff.visit.photoTake'),
    photoUpload: copy('staff.visit.photoUpload'),
    scanTitle: copy('staff.visit.scanTitle'),
    walkIn: copy('staff.visit.walkIn'),
    loyaltyTitle: copy('clientCard.loyalty.title'),
    ledgerTitle: copy('clientCard.ledgerPage.title'),
    recordsTitle: copy('clientCard.achievements.records'),
    visitsTitle: copy('clientCard.visits.title'),
    achievementsTitle: copy('clientCard.achievements.title'),
    duration: copy('staff.visit.duration'),
    end: copy('staff.visit.end'),
    shop: copy('staff.visit.shop'),
    shopList: copy('staff.visit.shopList'),
    shopMap: copy('staff.visit.shopMap'),
    shopUnknown: copy('staff.visit.shopUnknown'),
    today: copy('staff.visit.today'),
    tomorrow: copy('staff.visit.tomorrow'),
    custom: copy('staff.visit.custom'),
    rebook: copy('staff.visit.rebook'),
    cancelVisit: copy('staff.visit.cancelVisit'),
    cancelAndBlock: copy('staff.visit.cancelAndBlock'),
    visitNoPhone: copy('staff.day.visitNoPhone'),
    noAccount: copy('staff.client.noAccount'),
    newClient: copy('staff.visit.newClient'),
    servicesAddOne: copy('staff.visit.servicesAddOne'),
    alone: copy('staff.visit.alone'),
    stacks: copy('staff.visit.stacks'),
    discountAmount: copy('staff.visit.discountAmount'),
    discountChecking: copy('staff.visit.discountChecking'),
    discountFree: copy('staff.visit.discountFree'),
    discountKind: copy('staff.visit.discountKind'),
    discountNone: copy('staff.visit.discountNone'),
    discountPercent: copy('staff.visit.discountPercent'),
    discountScope: copy('staff.visit.discountScope'),
    discountUnknownCode: copy('staff.visit.discountUnknownCode'),
    kindCoupon: copy('staff.visit.kindCoupon'),
    kindCouponDetail: copy('staff.visit.kindCouponDetail'),
    kindPromo: copy('staff.visit.kindPromo'),
    kindPromoDetail: copy('staff.visit.kindPromoDetail'),
    codeAlready: copy('staff.visit.codeAlready'),
    voucher: copy('staff.visit.voucher'),
    voucherEmpty: copy('staff.visit.voucherEmpty'),
    voucherExpired: copy('staff.visit.voucherExpired'),
    voucherNothingLeft: copy('staff.visit.voucherNothingLeft'),
    voucherVoid: copy('staff.visit.voucherVoid'),
    appliedRow: copy('staff.visit.appliedRow'),
    couponBlocked: copy('staff.visit.couponBlocked'),
    removeDiscount: copy('staff.visit.removeDiscount'),
    removeVoucher: copy('staff.visit.removeVoucher'),
    tip: copy('staff.visit.tip'),
    tipNone: copy('staff.visit.tipNone'),
    tipPageAmount: copy('staff.visit.tipPageAmount'),
    forWhom: copy('staff.visit.forWhom'),
    variant: copy('staff.visit.variant'),
    removeService: copy('staff.visit.removeService'),
    removeClient: copy('staff.visit.removeClient'),
    visitCall: copy('staff.day.visitCall'),
    byCatalogue: copy('staff.visit.byCatalogue'),
    atShop: copy('staff.visit.atShop'),
    minutes: (minutes) => translate('staff.visit.minutes', { minutes }),
    catalogMinutes: (minutes) =>
      translate('staff.visit.catalogMinutes', { minutes }),
    cancelFor: (names) => translate('staff.visit.cancelFor', { names }),
    servicesAddCount: (count) =>
      translate('staff.visit.servicesAddCount', { count }),
    applyDiscount: (what) => translate('staff.visit.applyDiscount', { what }),
    discountApplied: (count) =>
      translate('staff.visit.discountApplied', { count }),
    discountCount: (count) => translate('staff.visit.discountCount', { count }),
    sameAsLast: (date) =>
      translate('staff.visit.client.announce.sameAsLast', { date }),
    tipInDock: (amount) => translate('staff.visit.tipInDock', { amount }),
    tipRoundUp: (total) => tipRoundUp.replace('{{total}}', total),
    voucherLeft: (amount) => voucherLeft.replace('{{amount}}', amount),
    discountHasGrant: (label) => discountHasGrant.replace('{{label}}', label),
    newClientParts: (parts) => newClientParts.replace('{{parts}}', parts),
  };
}

/** The 24-hour face every time on the sheet is written in — a late minute wraps onto the next day's clock. */
export function clockLabel(minute: TrackMinute): string {
  return formatClock(minute, ClockClosing.Wrap);
}

/* ── The pop-ups' options ──────────────────────────────────────────────── */

/** The row title's two words, as choice-menu options. */
export function timingOptions(
  words: VisitEditorWords,
): readonly UiChoiceOption[] {
  return [
    {
      id: TimingMode.Duration,
      label: words.duration,
      testId: 'staff-visit-timing-duration',
    },
    {
      id: TimingMode.End,
      label: words.end,
      testId: 'staff-visit-timing-end',
    },
  ];
}

/** The «Салон» fold's view pill: two icons, the words their names. */
export function shopViews(words: VisitEditorWords): readonly UiSegment[] {
  return [
    {
      id: ShopView.Map,
      label: words.shopMap,
      icon: 'view.map',
      iconOnly: true,
      testId: 'staff-visit-shop-view-map',
    },
    {
      id: ShopView.List,
      label: words.shopList,
      icon: 'view.list',
      iconOnly: true,
      testId: 'staff-visit-shop-view-list',
    },
  ];
}

/**
 * THE DOORS, as the sheet's every pop-up offers its options — the DS
 * choice menu, the chair's and «Вид»'s own (owner, 2026-09-17: "why is
 * it not using our ui menu the other dropdowns are using?"). The camera
 * is offered only where the engine has one to ask for (`camera`, the host's
 * or the engine's own answer).
 */
export function photoDoors(
  words: VisitEditorWords,
  camera: boolean,
): readonly UiChoiceOption[] {
  const doors: UiChoiceOption[] = [];
  if (camera) {
    doors.push({
      id: PhotoDoor.Camera,
      label: words.photoTake,
      icon: 'media.camera',
      testId: 'staff-visit-photo-take',
    });
  }
  doors.push(
    {
      id: PhotoDoor.Upload,
      label: words.photoUpload,
      icon: 'media.library',
      testId: 'staff-visit-photo-upload',
    },
    {
      id: PhotoDoor.System,
      label: words.photoSystem,
      icon: 'media.gallery',
      testId: 'staff-visit-photo-system',
    },
  );
  return doors;
}

/**
 * `Днес` / `Утре` — most re-datings are one or two days, and aiming at a
 * cell for that is the wrong amount of work. The picker resolves the
 * offsets against `uiToday`, so these cannot drift from the shop's own
 * today the way a locally-computed date could.
 */
export function dayRelatives(
  words: VisitEditorWords,
): readonly { readonly offset: number; readonly label: string }[] {
  return [
    { offset: 0, label: words.today },
    { offset: 1, label: words.tomorrow },
  ];
}

/* ── The «Салон» row ───────────────────────────────────────────────────── */

/** What the row reads: the shop's name, or a dash for one the catalogue no longer lists. */
export function shopReadoutOf(
  shop: VisitEditorShopOption | null,
  words: VisitEditorWords,
): string {
  return shop?.label ?? words.shopUnknown;
}

/** The row, spoken: «Салон: Креативо · Център». */
export function shopRowName(readout: string, words: VisitEditorWords): string {
  return `${words.shop}: ${readout}`;
}

/* ── The frame ─────────────────────────────────────────────────────────── */

/** What the frame's narration says. */
export type FrameSummaryInput = {
  readonly startLabel: string;
  readonly endLabel: string;
  readonly durationMinutes: DurationMinutes;
  readonly chairName: string;
  readonly rosterStartMinute: TrackMinute;
  readonly rosterEndMinute: TrackMinute;
  readonly neighbours: readonly {
    readonly name: string;
    readonly startMinute: TrackMinute;
    readonly endMinute: TrackMinute;
  }[];
  readonly words: VisitEditorWords;
};

/**
 * The AUTHORITATIVE description of the frame, and the only narration of it.
 *
 * Everything drawn inside the frame is `aria-hidden`, so this sentence
 * carries both boundaries, both neighbours and the shift regardless of what
 * the window happens to be showing. Assert its CONTENT in a test: with the
 * visible twin deleted (comment 6), a regression here is invisible to
 * everyone who can see.
 */
export function frameSummaryOf(input: FrameSummaryInput): string {
  const range = `${input.startLabel} – ${input.endLabel}`;
  const shift = `${clockLabel(input.rosterStartMinute)} – ${clockLabel(input.rosterEndMinute)}`;
  const around = input.neighbours
    .map(
      (neighbour) =>
        `${neighbour.name} ${clockLabel(neighbour.startMinute)} – ${clockLabel(neighbour.endMinute)}`,
    )
    .join(', ');
  return [
    `${range}, ${input.words.minutes(input.durationMinutes)}`,
    input.chairName,
    shift,
    around,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The line under the frame, from `GridLayoutSystem.frameVerdict`'s tag: the
 * neighbour it names and its hours, or when the shift opens. Silent for
 * anything else — and for a verdict whose subject did not arrive.
 */
export function frameVerdictVm(
  verdict: PlacementVerdict | null,
  clash:
    | {
        readonly name: string;
        readonly startMinute: TrackMinute;
        readonly endMinute: TrackMinute;
      }
    | undefined,
  shift: { readonly startMinute: TrackMinute } | null,
): FrameVerdictSlice | null {
  if (verdict === PlacementVerdict.Overlap && clash) {
    return {
      placementVerdict: PlacementVerdict.Overlap,
      name: clash.name,
      start: clockLabel(clash.startMinute),
      end: clockLabel(clash.endMinute),
    };
  }
  if (verdict === PlacementVerdict.Outside && shift) {
    return {
      placementVerdict: PlacementVerdict.Outside,
      time: clockLabel(shift.startMinute),
    };
  }
  return null;
}

/* ── The services' rows ────────────────────────────────────────────────── */

/** The seat as a row reads it — a draft's leg passes as it is. */
export type LegFacts = {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly clientId: DraftPersonKey;
  readonly serviceLabel: string;
  readonly durationMinutes: DurationMinutes;
  readonly barberName: string;
  readonly overridden: boolean;
};

/** What the services' rows are worded from. */
export type LegRowsInput = {
  readonly legs: readonly LegFacts[];
  readonly durationOverride: DurationMinutes | null;
  readonly clients: readonly {
    readonly id: DraftPersonKey;
    readonly label: string;
  }[];
  /** The shop's catalogue (D-2.5: a lookup that does or does not answer). */
  readonly services: readonly VisitEditorServiceOption[];
  /** The chair the frame is headed by. */
  readonly chairName: string;
  readonly words: VisitEditorWords;
};

/** What {@link chairOptionsOf} reads. */
export type ChairOptionsInput = {
  /** The shop's chairs, when the host bound them. */
  readonly roster: readonly VisitEditorBarberOption[];
  readonly legs: readonly {
    readonly barberId: BarberId | null;
    readonly barberName: string;
    readonly barberTone: number;
  }[];
  readonly chairId: BarberId | null;
  readonly chairName: string;
  readonly chairTone: number;
};

/**
 * Every barber a visit knows about, the chair included. THE ROSTER when it is
 * bound: real ids, real portraits. The fallback lists the legs' chairs and then
 * the visit's own, for a host that binds no roster; a pick of its row writes
 * the row's own chair. The chair is listed once, whether or not a leg sits on it
 * (BUG-4).
 */
export function chairOptionsOf(
  input: ChairOptionsInput,
): readonly EditorChairOption[] {
  if (input.roster.length > 0) {
    return input.roster.map((barber) => ({
      key: barber.id,
      id: barber.id,
      name: barber.label,
      tone: barber.tone,
      avatarSrc: barber.avatarSrc,
    }));
  }
  const seen = new Map<string, EditorChairOption>();
  for (const leg of input.legs) {
    const key = leg.barberId ?? '';
    seen.set(key, {
      key,
      id: leg.barberId,
      name: leg.barberName,
      tone: leg.barberTone,
      avatarSrc: null,
    });
  }
  if (!seen.has(input.chairId ?? '')) {
    seen.set(input.chairName, {
      key: input.chairName,
      id: input.chairId,
      name: input.chairName,
      tone: input.chairTone,
      avatarSrc: null,
    });
  }
  return [...seen.values()];
}

/** The catalogue's option for a leg — its service and variant — or none. */
function legOption(
  leg: LegFacts,
  services: readonly VisitEditorServiceOption[],
): VisitEditorServiceOption | undefined {
  return services.find(
    (entry) =>
      entry.serviceId === leg.serviceId &&
      (entry.variantId ?? null) === (leg.variantId ?? null),
  );
}

/**
 * `30 мин · 20,00 €`, and the barber ONLY when he is not the chair.
 *
 * When they agree the frame's owner header has already said it once, and
 * repeating it on every row is the duplication that deleted the `Стол` row.
 */
function legLine(
  leg: LegFacts,
  variant: string | null,
  input: LegRowsInput,
): string {
  const { legs, clients, words } = input;
  /*
   * MINUTES only when they say something the frame does not (owner,
   * 2026-09-09). With one leg the frame's duration IS the leg's, and once
   * the frame has been resized the catalogue's minutes on each leg are a
   * number the visit no longer runs to — both read as "the original
   * minutes" beside the real ones. The leg page still edits them.
   */
  const parts: string[] = [];
  // THE VARIANT leads the line — a description of the service above it.
  if (variant !== null) parts.push(variant);
  if (legs.length > 1 && input.durationOverride === null) {
    parts.push(words.minutes(leg.durationMinutes));
  }
  // No money on the service line (owner, 2026-09-10): the receipt
  // says what each seat costs. Only whose chair, when it is not this one.
  if (leg.barberName !== input.chairName) parts.push(leg.barberName);
  // On a party, whose seat this is — the leg page is where it changes.
  if (clients.length > 1) {
    const person = clients.find((client) => client.id === leg.clientId);
    if (person) parts.push(person.label);
  }
  // Provenance shown, never hidden: a repriced or re-timed seat says so.
  if (leg.overridden) parts.push(words.custom);
  return parts.join(' · ');
}

/**
 * ONE ROW PER SEAT, each worded once. The title is THE SERVICE, bare (owner,
 * 2026-09-10: "the variant could be a description, muted and a size down"):
 * the variant goes on the line beneath, in the footnote every other row keeps
 * its readings in, rather than welded to the name with a middot. The row's
 * spoken name keeps them joined the way the catalogue joins them — «Класическа
 * подстрижка · Дълга коса», as on the search page (owner, 2026-09-09).
 */
export function legRowsVm(input: LegRowsInput): readonly LegRowVm[] {
  const { services, clients, words } = input;
  return input.legs.map((leg) => {
    const option = legOption(leg, services);
    const title = option?.label ?? leg.serviceLabel;
    const clientLabel =
      clients.find((client) => client.id === leg.clientId)?.label ?? '';
    const variantKey =
      services.find(
        (entry) =>
          entry.serviceId === leg.serviceId &&
          entry.variantId !== null &&
          entry.variantId === leg.variantId,
      )?.id ?? null;
    const variantLabel =
      services.find((entry) => entry.id === variantKey)?.variantLabel ?? '—';
    return {
      seatId: leg.seatId,
      clientId: leg.clientId,
      serviceLabel: leg.serviceLabel,
      service: option?.serviceLabel ?? option?.label ?? leg.serviceLabel,
      line: legLine(leg, option?.variantLabel ?? null, input),
      clientLabel,
      forWhomName: `${words.forWhom}: ${clientLabel}`,
      // A service's variants as choices — empty for a service that has none.
      variantChoices: services
        .filter(
          (entry) =>
            entry.serviceId === leg.serviceId && entry.variantId !== null,
        )
        .map((entry) => ({
          id: entry.id,
          label: entry.variantLabel ?? entry.label,
          testId: `staff-visit-variant-pick-${entry.variantId}`,
        })),
      variantKey,
      variantName: `${words.variant}: ${variantLabel}`,
      removeName: `${words.removeService}: ${title}`,
    };
  });
}

/** A catalogue row's line: «Дълга коса · 30 мин · 20,00 €». */
export function serviceOptionLine(
  option: VisitEditorServiceOption,
  words: VisitEditorWords,
): string {
  return [
    option.variantLabel || null,
    words.minutes(option.minutes),
    option.priceLabel || null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/**
 * THE DOCK'S PROMISE on the service page: «Добави» for one pick, «Добави
 * 3 услуги» for more — or nothing, and the dock keeps its ✓: the page is
 * only being read.
 */
export function serviceApplyVm(
  count: number,
  words: VisitEditorWords,
): ServiceApplyVm | null {
  if (count === 0) return null;
  return {
    count,
    label: count === 1 ? words.servicesAddOne : words.servicesAddCount(count),
  };
}

/** The person a catalogue page is for, by the page's subject — their label, or none. */
export function servicePersonOf(
  clients: readonly {
    readonly id: DraftPersonKey;
    readonly label: string;
  }[],
  subjectId: string,
): string | null {
  return clients.find((client) => client.id === subjectId)?.label ?? null;
}

/* ── The bar ───────────────────────────────────────────────────────────── */

/** What the bar's title is worded from at the sheet's root. */
export type SheetTitleInput = {
  /** A pushed page's own name, which stands above all else. */
  readonly pageTitle: string | null;
  readonly isNew: boolean;
  readonly clients: readonly { readonly label: string }[];
  readonly words: VisitEditorWords;
};

/**
 * THE BAR'S TITLE (2026-09-18, the order review): a pushed page's own
 * name, else the seat's PERSON — «Мартин Илиев», «Мартин +1» when the
 * chair holds two, «Случаен клиент» when nobody is seated — and «Нов
 * час» while the visit does not exist yet. Bound to the DRAFT, so it
 * follows an edit instead of contradicting it (the 2026-08-26 worry).
 * It replaces «Редактиране на час», the one line that never scrolled and
 * answered nothing while the name sat below the first screen.
 */
export function sheetTitleOf(input: SheetTitleInput): string {
  if (input.pageTitle !== null) return input.pageTitle;
  if (input.isNew) return input.words.newTitle;
  const [first] = input.clients;
  if (first === undefined) return input.words.walkIn;
  return input.clients.length > 1
    ? `${first.label} +${input.clients.length - 1}`
    : first.label;
}

/** What a pushed page's name is worded from: the facts only the card's store and the sheet hold. */
export type EditorPageTitleInput = {
  readonly editorPage: EditorPage;
  /** The person, as their profile names them once read, else the seat's label. */
  readonly clientName: string | null;
  /** The photo page's day; `null` while the page has no photo. */
  readonly photoTitle: string | null;
  /** The card's own name for a module page (`ClientCardStore.barTitle`). */
  readonly cardTitle: string | null;
  readonly words: VisitEditorWords;
};

/**
 * THE CLIENT STACK'S NAMES are the card's (§2.1): the person as their profile
 * names them once read, a module page's own name, the scope's or the family's
 * title — each falling back to what is known before the card's words and data
 * have loaded.
 */
export function editorPageTitleOf(input: EditorPageTitleInput): string | null {
  const { words, cardTitle } = input;
  switch (input.editorPage) {
    case EditorPage.Client:
      return input.clientName;
    case EditorPage.ClientSearch:
      return words.addClient;
    case EditorPage.ClientNew:
      return words.newClientTitle;
    case EditorPage.Service:
      return words.addService;
    case EditorPage.Discount:
      return words.discount;
    case EditorPage.Scan:
      return words.scanTitle;
    case EditorPage.Photo:
      // The day, as Photos names it — the picture itself is the page.
      return input.photoTitle ?? words.photo;
    case EditorPage.Camera:
      return words.photoTake;
    case EditorPage.Library:
      return words.photoSystem;
    case EditorPage.ClientLoyalty:
      return cardTitle ?? words.loyaltyTitle;
    // Revision 3's two leaves: the wallet's ledger and the records page
    // (§5.3), named by the store's `barTitle` as the module pages are.
    case EditorPage.ClientLedger:
      return cardTitle ?? words.ledgerTitle;
    case EditorPage.ClientRecords:
      return cardTitle ?? words.recordsTitle;
    case EditorPage.ClientHistory:
      return cardTitle ?? words.visitsTitle;
    case EditorPage.ClientAchievements:
    case EditorPage.AchievementCategory:
    case EditorPage.AchievementDetail:
      return cardTitle ?? words.achievementsTitle;
  }
}

/* ── The head of a settled chair ───────────────────────────────────────── */

/**
 * THE HEAD OF A SETTLED CHAIR SAYS WHAT SETTLED IT (owner, 2026-09-11: "the
 * cancellation reason or no-show is not showing in the event detail sheets"):
 * which line it reads — the act, and whose it was — in which ink, under which
 * glyph. `null` on a chair nothing settled.
 */
export function resolutionHeadOf(
  resolution: VisitEditorResolution | null,
): ResolutionHeadVm | null {
  if (resolution === null) return null;
  if (resolution.bookingStatus === BookingStatus.NoShow) {
    return RESOLUTION_HEADS[ResolutionWord.NoShow];
  }
  return resolution.by === CancelledSide.Client
    ? RESOLUTION_HEADS[ResolutionWord.CancelledByClient]
    : RESOLUTION_HEADS[ResolutionWord.CancelledByStaff];
}

/* ── The exits ─────────────────────────────────────────────────────────── */

/** What the sheet's last group is worded from. */
export type VisitExitsInput = {
  readonly bookingStatus: BookingStatus;
  /** Every transition the graph allows, already named. */
  readonly verbs: readonly VisitEditorVerb[];
  /** Has the visit begun (`VisitListSystem.hasStarted`). */
  readonly started: boolean;
  /** How many other chairs share this booking. */
  readonly peerCount: number;
  /** The chair's people, as the draft holds them. */
  readonly clients: readonly { readonly label: string }[];
  readonly words: VisitEditorWords;
};

/**
 * THE EXITS — the sheet's last group. Every act that is not an edit and
 * not a stamp: no-show once the start has passed (before it, nobody has
 * failed to come), cancel, cancel-and-block for the appointment that
 * should have been a block, the way back from a no-show, and the next
 * visit after any settled one. WHICH verbs are exits, in which order, is the
 * lifecycle's (`AppointmentLifecycleSystem.exitVerbs`); this gives each its
 * id, its glyph and its words.
 */
export function visitExitsVm(input: VisitExitsInput): readonly VisitExit[] {
  const { verbs, words } = input;
  const legal = AppointmentLifecycleSystem.exitVerbs(
    input.bookingStatus,
    verbs.map((verb) => verb.rowVerb),
    input.started,
  );
  const out: VisitExit[] = [];
  for (const verb of verbs) {
    if (!legal.verbs.includes(verb.rowVerb)) continue;
    if (verb.rowVerb === BookingStatus.Confirmed) {
      out.push({
        id: VisitExitId.Reinstate,
        label: verb.label,
        icon: 'visit.confirmed',
        destructive: false,
        act: verb.rowVerb,
      });
      continue;
    }
    if (verb.rowVerb === BookingStatus.NoShow) {
      out.push({
        id: VisitExitId.NoShow,
        label: verb.label,
        icon: 'visit.noShow',
        destructive: false,
        act: verb.rowVerb,
      });
      continue;
    }
    out.push({
      // The exit's id is the verb's word — what its test id prints.
      id: ROW_VERB_WORD[verb.rowVerb],
      label: verb.label,
      icon: 'visit.confirmed',
      destructive: verb.destructive,
      act: verb.rowVerb,
    });
  }
  // A FINISHED visit offers the next one here; a visit that is GONE
  // offers it from the dock instead (owner, 2026-09-11), where nothing is
  // due and «Запази» has nothing left to save — one control per act.
  if (legal.rebook) {
    out.push({
      id: VisitExitId.Rebook,
      label: words.rebook,
      icon: 'appointment.book',
      destructive: false,
      act: null,
    });
  }
  if (legal.cancel) {
    // ON A PARTY'S CHAIR the exit calls off THIS chair's share alone —
    // the shell scopes it to the chair's seats — so it says whose
    // (2026-09-24): «Откажи часа» read as the whole booking.
    const names = input.clients.map((client) => client.label).join(', ');
    out.push({
      id: VisitExitId.Cancel,
      label:
        input.peerCount > 0 && names.length > 0
          ? words.cancelFor(names)
          : words.cancelVisit,
      icon: 'visit.cancelled',
      destructive: true,
      act: BookingStatus.Cancelled,
    });
    out.push({
      id: VisitExitId.CancelBlock,
      label: words.cancelAndBlock,
      icon: 'booking.blocked',
      destructive: true,
      act: null,
    });
  }
  return out;
}

/* ── The people's lines ────────────────────────────────────────────────── */

/**
 * THE LINE UNDER A PERSON'S NAME on their page: what the rows below do
 * not already say (2026-09-24). It printed the number, and the call row
 * right under it printed the same number again; the number is the call
 * row's, and this line keeps the one fact the sheet's own client rows
 * gave up — the last visit — or says there is no number to call.
 */
export function clientLineOf(
  client: { readonly meta: string | null; readonly phone: string | null },
  words: VisitEditorWords,
): string {
  return [client.meta, client.phone ? null : words.visitNoPhone]
    .filter(Boolean)
    .join(' · ');
}

/** A party person's way off, spoken: «Махни: Мартин». */
export function removeClientName(
  label: string,
  words: VisitEditorWords,
): string {
  return `${words.removeClient}: ${label}`;
}

/** The dock's call, spoken: «Обади се — Мартин». */
export function callName(clientLabel: string, words: VisitEditorWords): string {
  return `${words.visitCall} — ${clientLabel}`;
}

/** A peer chair's line: «Иван · 16:00 – 16:30». */
export function peerLine(peer: VisitEditorPeer): string {
  return `${peer.chairName} · ${peer.timeLabel}`;
}
