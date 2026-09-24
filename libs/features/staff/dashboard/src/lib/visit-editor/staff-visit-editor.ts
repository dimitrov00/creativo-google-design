import { SwipeToDeleteDirective } from '../swipe-to-delete/swipe-to-delete.directive';
import { NgTemplateOutlet } from '@angular/common';
import { StaffDayPill, formatDayPill } from '../day-pill/staff-day-pill';
import {
  AUTH_DEPLOYMENT,
  countryCallingCode,
  formatPhoneDraft,
} from '@creativo/application/identity';
import type { CountryIso2 } from '@creativo/application/identity';
import {
  type ParsedClientQuery,
  type TextSegment,
  emailSegments,
  nameSegments,
  parseClientQuery,
  phoneInternationalDigits,
  phoneSegments,
  rankClients,
} from './client-query';
import { ShowcaseGalleryComponent } from '@creativo/features/shared/catalog';
import { ThemeService } from '@creativo/features/shared/shell';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  Money,
  ZonedDateTime,
  formatMoney,
} from '@creativo/application/booking';
import {
  CouponValue,
  DiscountApplication,
  type DiscountInput,
} from '@creativo/application/engagement';
import {
  type UiChoiceOption,
  type UiChoiceTile,
  type UiChoiceTileSize,
  type UiIconName,
  type UiMapPin,
  type UiSegment,
  type UiSliderMark,
  UiAmountField,
  UiAsyncImage,
  UiAvatar,
  UiBadge,
  UiButton,
  UiChip,
  UiChoiceLeading,
  UiChoiceMenu,
  UiChoiceTiles,
  UiCodeField,
  UiCountStepper,
  UiIcon,
  UiMap,
  UiPhoneField,
  UiProgressView,
  UiSegmentedControl,
  UiSearchField,
  UiSlider,
  UiTextField,
  UiTimeField,
  UiUnitField,
} from '@creativo/ui/controls';
import { catalogMinutesOf, minutesDeltaLabel } from '../shared/catalog-delta';
import {
  StaffEventHead,
  type StaffEventLine,
  type StaffEventRun,
} from '../shared/event-head/staff-event-head';
import { FrameFullscreen } from '../shared/frame-fullscreen';
import { UiScrollColumn, UiStack } from '@creativo/ui/layout';
import {
  UiMaterialDirective,
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  type CameraCaptureState,
  isCameraSupported,
  isCodeScannerSupported,
  UiCameraCapture,
  UiCodeScanner,
  UiCouponCard,
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import {
  type GridColumn,
  type GridCommit,
  type GridDraft,
  type GridDragCopy,
  type GridEvent,
  type GridWindow,
  StaffTimeGrid,
} from '../time-grid/staff-time-grid';

/* ────────────────────────────────────────────────────────────────────────
 * THE INPUT CONTRACT
 *
 * A view model, not a domain object. The editor draws a visit and edits a
 * DRAFT of it; the mapping from `Appointment` (seats, terms, ZonedDateTime)
 * to these flat, already-formatted fields belongs to the surface that owns
 * the store, and keeping it there is what lets this component be rendered
 * from a spec with a literal.
 * ──────────────────────────────────────────────────────────────────────── */

/** One sold service inside the visit — a seat, in the domain's vocabulary. */
export interface VisitEditorLeg {
  readonly seatId: string;
  /** The catalogue's id — what an ADDED leg is priced and timed by. */
  readonly serviceId: string;
  /**
   * The variant chosen, or `null` for a service that declares none. A
   * service WITH variants is only ever offered per variant — the server
   * refuses a bare seat on it, because the price moves with the choice.
   */
  readonly variantId: string | null;
  /**
   * WHOSE seat, as the owner of this sheet keys people (`vm.people`). Absent
   * on a leg the sheet minted itself; the draft seeds it to the first person.
   */
  readonly clientId?: string;
  readonly serviceLabel: string;
  readonly minutes: number;
  /**
   * The chair's CATALOGUE minutes for this seat, as the dashboard resolved
   * them — the base terms for a seat booked without a variant on a service
   * that has some. The sheet's own option list is per variant only, so
   * without this the frame's tag and the agenda card's disagreed on exactly
   * that seat (owner, 2026-09-10: "if it's subtracted the expected should
   * also show"). `null` when the catalogue no longer knows the service.
   */
  readonly catalogMinutes?: number | null;
  readonly priceLabel: string | null;
  readonly barberId: string;
  readonly barberName: string;
  readonly barberTone: number;
  /**
   * The stored terms differ from the catalogue's — staff repriced or
   * re-timed this seat. Shown, never hidden: a shop that discounts should
   * be able to see it (`по избор` on the leg's line).
   */
  readonly overridden: boolean;
}

/** One status transition the graph currently allows, already named. */
export interface VisitEditorVerb {
  /** The `AppointmentStatusKind` the callable is asked for. */
  readonly kind: string;
  /** Translated — `Дойде`, `Готово`, `Не дойде`, `Откажи`. */
  readonly label: string;
  /** Cancelling asks a question first; the others do not. */
  readonly destructive: boolean;
}

/**
 * `Запази` — the whole draft, as ONE intent, and the sheet's ONLY commit.
 *
 * A save publishes what the sheet now says, and the owner works out the
 * difference from the appointment it handed in. That split is deliberate:
 * this component knows what a barber typed, and only the parent knows which
 * seats it belongs to, which zone the day is in and which of the changes
 * the server has a command for. The frame's drag and resize used to commit
 * on their own (2026-09-03 to 2026-09-18: an immediate write with a toast);
 * since 2026-09-23 they are draft edits like «Начало» — see the component's
 * "regimes of writing".
 */
export type VisitEditorCommit = {
  readonly kind: 'save';
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
  /**
   * The shop the visit is at, as drafted — the «Салон» row's pick. The
   * owner sends a `relocate` only when it differs from the row's.
   */
  readonly locationId: string | null;
  readonly legs: readonly {
    readonly seatId: string;
    readonly serviceId: string;
    readonly variantId: string | null;
    readonly minutes: number;
    readonly priceLabel: string | null;
    /**
     * A price typed on the ladder, in minor units — the owner sends it
     * as a `reprice`. Absent or `null` when nobody touched the money.
     */
    readonly priceMinorUnits?: number | null;
    readonly barberId: string;
    /** Whose seat — one of `clients[].id`. */
    readonly clientId: string;
  }[];
  /** The team note as drafted — `null` when cleared. */
  readonly note: string | null;
  /** The bill's discounts as drafted — empty for full price. */
  readonly discounts: readonly VisitEditorDiscount[];
  /** The vouchers paying the bill, in cover order. */
  readonly vouchers: readonly VisitEditorVoucher[];
  /**
   * What the client left this chair, in minor units — drafted like every
   * other line since 2026-09-15; `null` when none, or cleared. The owner
   * writes it beside the batch when it differs from what is recorded.
   */
  readonly tipMinorUnits: number | null;
  /** Who the visit is for — an account id, or a guest's label. */
  readonly clients: readonly {
    readonly id: string;
    readonly label: string;
    readonly phone: string | null;
  }[];
};

/**
 * ANOTHER CHAIR'S SHARE of the same booking.
 *
 * A party is one appointment spread over several chairs, and this sheet frames
 * exactly one of them (owner ruling 2026-09-03: the editor is seat-scoped, not
 * party-scoped). That is the right shape for editing — a barber acts on their
 * own seat — but it must not pretend the rest of the booking is not there, or
 * moving a seat looks like moving the whole visit.
 */
/**
 * WHAT SETTLED THIS CHAIR — the head of a cancelled or no-showed sheet.
 *
 * Built by the page, which holds the seats and the clock; the sheet only
 * says it. `detail` is already in words: the reason's label, or the note
 * itself when the reason was «Друго», joined when two seats in one chair
 * were called off for different reasons — and `null` when nobody said why,
 * which the head shows as nothing rather than as "no reason".
 */
export interface VisitEditorResolution {
  readonly kind: 'cancelled' | 'no_show';
  /** Whose act a cancellation was; `null` on a no-show, which is nobody's. */
  readonly by: 'client' | 'staff' | null;
  /** `14:32` on the visit's own day, `24.08, 14:32` on another. */
  readonly whenLabel: string;
  readonly detail: string | null;
}

export interface VisitEditorPeer {
  /** The row this pushes the sheet to — `appointmentId#barberId`. */
  readonly rowId: string;
  /** Who is in that chair. On a party this is usually NOT this sheet's client. */
  readonly clientLabel: string;
  readonly chairName: string;
  readonly chairTone: number;
  /** `16:00 – 16:30`, already localized. */
  readonly timeLabel: string;
}

export interface VisitEditorVm {
  /** Empty while CREATING: the sheet drafts a visit that does not exist yet. */
  readonly appointmentId: string;
  /**
   * THIS ROW's own name — `appointmentId#barberId`.
   *
   * The sheet is one chair's share, and on a party the appointment id names
   * two of them. Anything switching sheets uses this; anything addressing the
   * server uses `appointmentId`.
   */
  readonly rowId: string;
  /**
   * The OTHER chairs of this booking, empty on an ordinary one-person visit.
   */
  readonly peers: readonly VisitEditorPeer[];
  readonly dayKey: string;
  /** Already localized — `вт, 26 авг`. */
  readonly dayLabel: string;
  /** Minutes from midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly legs: readonly VisitEditorLeg[];
  readonly clientLabel: string;
  /**
   * EVERYONE in the chair, when there is more than the one `clientLabel`
   * names. A party reopened must read as a party: each person a row, each
   * leg named. Absent (or empty) means the one client the fields describe.
   */
  readonly people?: readonly VisitEditorClientOption[];
  /** The client's account, when they have one — what a booking is placed FOR. */
  readonly clientUserId: string | null;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  /** `Нов` · `посл. 3 авг` — the shop's one fact about this person. */
  readonly clientMeta: string | null;
  /** The CLIENT's own note. Read-only, always — overwriting it destroys evidence. */
  readonly note: string | null;
  /**
   * The TEAM's note — the shop's words about this visit, from the staff-only
   * sibling collection. Seeds the draft's note; never merged with the
   * client's.
   */
  readonly teamNote: string | null;
  /**
   * THE SHOP'S PHOTOS of this visit, in the order they were taken — read
   * live beside the appointment, like the team's note, and never part of
   * the draft: a photo commits on pick. Absent on a visit the server has
   * not seen. `photoBusy` while one is going up or coming down.
   */
  readonly photos?: readonly VisitEditorPhoto[];
  readonly photoBusy?: boolean;
  /** The visit subtotal, already through `formatMoney`. */
  readonly priceLabel: string | null;
  /**
   * The same total in minor units — what a tip preset is a share of.
   * `null` when the seats disagree on currency, or on a draft with none.
   */
  readonly priceMinorUnits: number | null;
  /**
   * What the client left THIS chair's barber, already formatted, or `null`
   * when nothing has been recorded.
   *
   * `null` is not zero: a visit nobody has settled up yet and one that
   * genuinely tipped nothing are different facts, and the row says so by
   * being an add-row in the first case and a value in the second.
   */
  readonly tipLabel: string | null;
  /**
   * The tip in minor units, so the field can be edited rather than re-typed
   * from a formatted string.
   */
  readonly tipMinorUnits: number | null;
  /**
   * What the server has taken off the bill — every discount, empty at full
   * price. The ladder's baseline: the draft seeds from it, `dirty` compares
   * back against it.
   */
  readonly discounts: readonly VisitEditorDiscount[];
  /** The vouchers still paying the bill, in cover order. */
  readonly vouchers: readonly VisitEditorVoucher[];
  /**
   * What became of a settled chair, for the head — `null` while it is live,
   * and on a finished visit, whose ending needs no explaining.
   */
  readonly resolution: VisitEditorResolution | null;
  readonly status: string;
  readonly statusLabel: string;
  /**
   * When the party walked in, minutes from midnight in shop time, or `null`.
   *
   * `arrivedAt` is a stamp, not a status (see `Appointment.arrivedAt`), so it
   * rides beside `status` rather than inside it. The state header reads the
   * waiting time off it; nothing else on the sheet does.
   */
  readonly arrivedMinute: number | null;
  /**
   * WHERE the visit is — `Appointment.locationId`, the root's own fact: one
   * visit is one physical place, whatever chairs it spans. `null` on a
   * visit the sheet cannot place, which the row reads as unknown rather
   * than inventing a shop.
   */
  readonly locationId: string | null;
  /** The chair the frame draws — its id, for a leg added from this sheet. */
  readonly chairId: string;
  /** The chair the frame draws. */
  readonly chairName: string;
  readonly chairTone: number;
  readonly neighbours: readonly {
    name: string;
    startMinute: number;
    endMinute: number;
    tone: number;
  }[];
  readonly rosterStartMinute: number;
  readonly rosterEndMinute: number;
  readonly nowMinute: number | null;
  /**
   * Today, `YYYY-MM-DD` — so the month picker can mark it and the relative
   * shortcuts can resolve against the SHOP's today rather than the device's.
   */
  readonly todayKey: string;
  /**
   * The ONE verb the dock leads with, or `null` on a settled visit.
   *
   * These are **Regime A** — they write immediately, through
   * `transitionAppointment`, which ships. They are not part of the draft and
   * they are not waiting on `staffEditAppointment`; an editor that dropped
   * them would take away the only thing this sheet can currently do.
   */
  readonly primaryVerb: VisitEditorVerb | null;
  /** Everything else the graph allows — the `⋯` menu. */
  readonly overflowVerbs: readonly VisitEditorVerb[];
  /** A transition is in flight; the dock spins rather than double-firing. */
  readonly acting: boolean;
}

/**
 * The surroundings of whatever day the frame is currently drawing.
 *
 * Split out of `VisitEditorVm` deliberately — see `uiFrameDay`. Everything
 * here is REDRAWN when the drafted day moves; nothing here is ever seeded
 * into the draft or compared against it.
 */
export interface VisitEditorFrameDay {
  readonly neighbours: readonly {
    name: string;
    startMinute: number;
    endMinute: number;
    tone: number;
  }[];
  readonly rosterStartMinute: number;
  readonly rosterEndMinute: number;
  /** `null` on any day that is not today — there is no "now" to draw. */
  readonly nowMinute: number | null;
}

/**
 * One catalogue row for the pushed add-service page.
 *
 * A second input rather than an injected `CatalogReader`: the visit VM is
 * the appointment, and the catalogue is the shop. Threading it as data keeps
 * this component free of a port it would otherwise have to stub in every
 * test, and the owner of the store already holds the catalogue.
 */
export interface VisitEditorServiceOption {
  /** The option's own key — the service id, or `service:variant`. */
  readonly id: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly label: string;
  /** The service's own name, bare — `Класическа подстрижка` — the row's title. */
  readonly serviceLabel?: string;
  /** The variant's own name — `Дълга коса` — for a row that changes it. */
  readonly variantLabel?: string | null;
  readonly minutes: number;
  readonly priceLabel: string | null;
}

/** One of the shop's photos of the visit, as the sheet shows it. */
export interface VisitEditorPhoto {
  readonly photoId: string;
  readonly url: string;
  readonly takenAtIso: string;
  /** The chair, and its name when the catalogue still knows it. */
  readonly barberId: string;
  readonly barberName: string | null;
  readonly clientLabel: string;
  readonly width: number | null;
  readonly height: number | null;
  /** The visit's own picture, or one of the shop's pointed at — with its name. */
  readonly origin: 'shot' | 'library';
  readonly label: string | null;
}

/** One of the shop's own pictures — a catalogue cover, a work shot — on offer to a visit. */
export interface VisitEditorLibraryImage {
  readonly id: string;
  readonly url: string;
  readonly path: string;
  readonly label: string;
}

/** One person for the pushed add-client page. */
export interface VisitEditorClientOption {
  readonly id: string;
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly meta: string | null;
  /** The person's own portrait, when they have one; initials otherwise. */
  readonly avatarSrc?: string | null;
  /** Their mail, when the owner knows it — what a typed mail is matched by. */
  readonly email?: string | null;
}

/** A person row as the add-client page draws it: ticked, matched, marked. */
interface ClientRowVm extends VisitEditorClientOption {
  readonly selected: boolean;
  /** The typed number or mail IS theirs. */
  readonly exact: boolean;
  /** The name as runs, only while some run is the typed one. */
  readonly titleParts: readonly StaffEventRun[] | null;
  /** The facts under the name — the mail, the number, the last visit. */
  readonly lines: readonly StaffEventLine[];
}

/** One detected part of what was typed, as the create row shows it. */
interface CreatePart {
  readonly kind: 'name' | 'phone' | 'email';
  readonly icon: UiIconName;
  readonly value: string;
}

/** Runs only when one of them is the typed one; otherwise the plain text. */
function markedRuns(
  runs: readonly TextSegment[],
): readonly StaffEventRun[] | undefined {
  return runs.some((run) => run.hit) ? runs : undefined;
}

/**
 * A SECTION of the add-client page before anything is typed — «Днес», the
 * people booked on the shown day; «Скорошни», the shop's last visitors —
 * the owner of the sheet decides which sections exist and in what order,
 * so a new source (regulars, the waitlist) is one more entry here, not a
 * page redesign.
 */
export interface VisitEditorClientSection {
  readonly id: string;
  readonly title: string;
  readonly clients: readonly VisitEditorClientOption[];
}

/**
 * What a discount does to the bill, as plain data — the engagement domain's
 * `CouponValue` without the `Money` inside it, so a draft can hold it, a
 * `savedShape` can compare it and a VM can carry it across the sheet's edge.
 */
export type VisitEditorDiscountValue =
  | { readonly kind: 'percent_off'; readonly percent: number }
  | { readonly kind: 'fixed_amount'; readonly amountMinorUnits: number }
  | { readonly kind: 'free_service' };

/**
 * A discount ON the visit — saved (on the VM) or drafted (in the draft).
 * `source` says where it came from and what the save sends: a grant and a
 * code travel as references the server re-resolves; a manual figure travels
 * as its value. `label` is the coupon's name; a manual discount has none and
 * the line names it by its value. `exclusive` is the coupon's own rule: such
 * a discount must be alone on the bill.
 */
export interface VisitEditorDiscount {
  readonly source: 'grant' | 'code' | 'manual';
  readonly label: string;
  readonly value: VisitEditorDiscountValue;
  readonly grantId: string | null;
  readonly code: string | null;
  readonly exclusive: boolean;
}

/**
 * A gift voucher PAYING for the visit. `availableMinorUnits` is what this
 * visit may draw on it: the balance it had, plus whatever this visit had
 * already drawn (a saved redemption re-settles rather than double-draws).
 * What it actually covers is computed live, in cover order, against what
 * the discounts leave.
 */
export interface VisitEditorVoucher {
  readonly voucherId: string;
  readonly code: string;
  readonly availableMinorUnits: number;
}

/** A coupon THIS client already holds — one option in the discount menu. */
export interface VisitEditorGrantOption {
  readonly grantId: string;
  /** The coupon behind the grant — the same one may be published as a code. */
  readonly couponId: string;
  readonly label: string;
  readonly value: VisitEditorDiscountValue;
  readonly exclusive: boolean;
}

/** One of the shop's live promo codes — offered as a row, never typed. */
export interface VisitEditorPromoOption {
  readonly code: string;
  readonly couponId: string;
  readonly label: string;
  readonly value: VisitEditorDiscountValue;
  readonly exclusive: boolean;
}

/**
 * The answer to a typed code, keyed by the code it answers so a slow answer
 * to an earlier code can never apply to a later one. A code opens a coupon
 * (`promo`), or names a voucher (`voucher`, whatever its state — `refusal`
 * says why it will not take), or nothing at all.
 */
export interface VisitEditorCodeResult {
  readonly code: string;
  readonly promo: {
    readonly label: string;
    readonly value: VisitEditorDiscountValue;
    readonly exclusive: boolean;
  } | null;
  readonly voucher: VisitEditorVoucher | null;
  readonly refusal: 'void' | 'expired' | 'empty' | null;
}

/** The domain's value → the sheet's plain one. The one place the two meet. */
export function discountValueOf(value: CouponValue): VisitEditorDiscountValue {
  switch (value.kind) {
    case 'percent_off':
      return { kind: 'percent_off', percent: value.percent };
    case 'fixed_amount':
      return {
        kind: 'fixed_amount',
        amountMinorUnits: value.amount.toMinorUnits(),
      };
    case 'free_service':
      return { kind: 'free_service' };
  }
}

/** The sheet's plain value → the domain's, through its validating doors, or `null`. */
function toCouponValue(
  value: VisitEditorDiscountValue,
  currencyCode: string,
): CouponValue | null {
  switch (value.kind) {
    case 'percent_off': {
      const result = CouponValue.percentOff(value.percent);
      return result.isSuccess() ? result.value : null;
    }
    case 'fixed_amount': {
      const money = Money.fromMinorUnitsAndCode(
        value.amountMinorUnits,
        currencyCode,
      );
      if (money.isFailure()) return null;
      const result = CouponValue.fixedAmount(money.value);
      return result.isSuccess() ? result.value : null;
    }
    case 'free_service':
      return CouponValue.freeService();
  }
}

/* ── The draft ─────────────────────────────────────────────────────────── */

/**
 * A leg in the draft.
 *
 * Identical to the input shape today, and named separately on purpose: the
 * draft is the thing being edited and the VM is the thing that arrived, and
 * collapsing the two is how an edit starts leaking back into its own source.
 */
type DraftLeg = VisitEditorLeg & {
  /**
   * WHOSE seat this is — a client id from the draft's client list. Every
   * service on a visit belongs to a person; a party is people with services,
   * never services with a crowd beside them. Seeded to the first client.
   */
  readonly clientId: string;
  /**
   * A price TYPED on the ladder's pill, in minor units — what the save sends
   * as the seat's new terms. Absent until someone who may reprice does; the
   * label beside it is the same number, formatted.
   */
  readonly priceMinorUnits?: number | null;
};

interface DraftClient {
  readonly id: string;
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly meta: string | null;
  /** The face and the mail the pick came with, when it came with them (2026-09-22). */
  readonly avatarSrc?: string | null;
  readonly email?: string | null;
}

interface VisitDraft {
  readonly dayKey: string;
  readonly dayLabel: string;
  readonly startMinute: number;
  /**
   * `null` means "the duration is the services' summed span" — the invariant
   * that makes a leg's duration edit move the end for free. A menu pick or a
   * span that never matched the catalogue pins a number here instead.
   */
  readonly durationOverride: number | null;
  /**
   * THE CHAIR the visit is drafted on — where a new leg lands, what the
   * frame draws. Seeded from the row's; moved by the chair row's menu even
   * while there is no leg yet to re-chair (a new visit, owner 2026-09-09).
   */
  readonly chairId: string;
  /** THE SHOP the visit is at, as drafted — the «Салон» row's pick. */
  readonly locationId: string | null;
  readonly legs: readonly DraftLeg[];
  readonly clients: readonly DraftClient[];
  /** The STAFF note. The client's is on the VM and is never merged with it. */
  readonly note: string | null;
  /** The discounts as drafted, in the order added. Empty is full price. */
  readonly discounts: readonly VisitEditorDiscount[];
  /** The vouchers as drafted, in cover order. */
  readonly vouchers: readonly VisitEditorVoucher[];
  /** The tip as drafted — `null` for none. Seeded from the recording. */
  readonly tipMinorUnits: number | null;
}

/** Which page is presented on top of the ladder. Depth is exactly one. */
type EditorPageKind =
  | 'client'
  | 'clientSearch'
  | 'clientNew'
  | 'service'
  | 'discount'
  | 'scan'
  | 'photo'
  | 'camera'
  | 'library';

/** What the discount page adds: a code, the client's coupon, or — for money roles — a figure. */
/** What the «Вид» pop-up offers: the shop's codes, a voucher or coupon, a percent, a sum. */
type DiscountKind = 'promo' | 'coupon' | 'percent' | 'amount';
/** The sum's ruler steps by half a euro, a euro a tick, five the taller. */
const AMOUNT_SLIDER_STEP_MINOR = 50;
const AMOUNT_SLIDER_TICK_MINOR = 100;
const AMOUNT_SLIDER_MAJOR_MINOR = 500;

/**
 * One offer on the discount card — a coupon the client holds or a code the
 * shop published — in one of three states: on offer, applied (its line is
 * on the bill), or blocked by what is on the bill.
 */
interface OfferChoice {
  readonly kind: 'promo' | 'grant';
  /** The code, or the grant id. */
  readonly id: string;
  /** The bill line's key, for the way off. */
  readonly key: string;
  readonly testId: string;
  readonly code: string | null;
  readonly label: string;
  readonly exclusive: boolean;
  /** The RULE — «−10%», «−5,00 €» — never a figure computed on this bill. */
  readonly value: string;
  /** Whether it stacks, in words. */
  readonly line: string;
  readonly applied: boolean;
  readonly blocked: boolean;
}

interface EditorPage {
  readonly kind: EditorPageKind;
  /** The leg or client the page is about, when it is about one. */
  readonly subjectId: string | null;
  /** The row that opened it — focus goes back there on pop (WCAG 3.2.2). */
  readonly originTestId: string | null;
}

/**
 * Status → badge tone.
 *
 * The same five rows `staff-dashboard.ts` keeps in its own `STATUS_TONES`,
 * and deliberately the same reasoning: `confirmed` and `completed` stay
 * NEUTRAL because nine visits in ten are one of them, and a colour that
 * means "ordinary" means nothing. The map is module-private over there, so
 * it cannot be imported today — it belongs in a shared module the moment the
 * dashboard wires this component, and that is a one-line move, not a rewrite.
 */
/** The glyph that doubles the state word — form, so the state survives a
    greyscale print and a reader who cannot separate two washes. */
/**
 * One row of the sheet's last group — an act that is not an edit and not a
 * stamp. `act` is the graph edge the owner performs; `null` for the two that
 * are the sheet's own (the next visit, the block instead).
 */
interface VisitExit {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly destructive: boolean;
  readonly act: string | null;
}
/** A chair the picker offers — the shop's roster, not this visit's. */
export interface VisitEditorBarberOption {
  readonly id: string;
  readonly label: string;
  readonly tone: number;
  /**
   * ⚠ The PORTRAIT, and it is the reason barbers wore monograms here.
   *
   * `ui-avatar` draws initials whenever `uiSrc` is absent — it is a fallback,
   * not an error — so a face-shaped control with no `src` fails silently and
   * looks deliberate. The scope switcher in the toolbar has always passed
   * `[uiSrc]="option.avatarSrc"`; this surface passed only `[uiName]`.
   */
  readonly avatarSrc: string | null;
}

/**
 * A SHOP, as the «Салон» row offers it — the name the row and its tile
 * read, the address as the row's own line, the pin on the map.
 */
export interface VisitEditorShopOption {
  readonly id: string;
  readonly label: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

/**
 * A barber as a PARTICIPANT — one token at the top of the sheet.
 *
 * Derived, never stored: a visit has no barber of its own, it has legs, and
 * each leg is worked by someone. Two legs worked by one barber are one
 * participant with two services named on the line under him.
 */
interface EditorBarberRow {
  readonly id: string;
  readonly label: string;
  readonly tone: number;
  readonly avatarSrc: string | null;
}

/**
 * THE CHAIR'S SHIFT, or `null` when the roster cannot say.
 *
 * One reading, shared by the window, the closed-hour shading and the
 * outside-the-shift verdict, because three different readings of the same
 * two numbers is how a frame ends up drawn shut over a visit it is happily
 * editing. `null` means "no usable shift": an end at or below the start,
 * which is what a shift closing at midnight becomes when it is read as a
 * wall-clock minute without being anchored to the day.
 */
function shiftOf(
  day: VisitEditorFrameDay,
): { startMinute: number; endMinute: number } | null {
  return day.rosterEndMinute > day.rosterStartMinute
    ? { startMinute: day.rosterStartMinute, endMinute: day.rosterEndMinute }
    : null;
}

/** The booking increment. Every authored time on this surface lands on it. */
const GRAIN_MINUTES = 5;

/**
 * The shortest duration worth applying MID-TYPE.
 *
 * `6` on the way to `60` is not a six-minute visit, and applying it would
 * shrink the frame under the reader between two keystrokes. Below this the
 * typing arm stays quiet and `change` has the final word on blur.
 */
const MIN_TYPED_MINUTES = 10;
const DAY_MINUTES = 1440;

function clockLabel(minute: number): string {
  const wrapped = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(wrapped / 60);
  return `${String(hour).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function snap(minute: number): number {
  return Math.round(minute / GRAIN_MINUTES) * GRAIN_MINUTES;
}

/** The minutes a draft describes — its override, or the legs it holds. */
/** A visit with no service yet still needs a shape to draw: half an hour. */
const DEFAULT_SPAN_MINUTES = 30;

function sumOrDefault(legs: readonly DraftLeg[]): number {
  return legs.length === 0
    ? DEFAULT_SPAN_MINUTES
    : legs.reduce((total, leg) => total + leg.minutes, 0);
}

function spanOf(draft: VisitDraft): number {
  return draft.durationOverride ?? sumOrDefault(draft.legs);
}

/**
 * THE FIRST PERSON TAKES THE PLACEHOLDER'S SEATS. A service picked before
 * anyone was named sits on `'primary'`; when the first person joins an
 * empty draft those seats become theirs — the mirror of the heir rule in
 * `toggleClient` — so the catalogue is not asked for them again and the
 * save does not file their cut under a walk-in (found in review).
 */
function adoptPlaceholderLegs(
  draft: VisitDraft,
  id: string,
): readonly DraftLeg[] {
  if (draft.clients.length > 0) return draft.legs;
  return draft.legs.map((leg) =>
    leg.clientId === 'primary' ? { ...leg, clientId: id } : leg,
  );
}

/**
 * ONE RULE FOR A PERSON LEAVING (2026-09-24), wherever it is done — the
 * row's «−», its swipe, or unticking them on the add-client page. While
 * others remain on the visit, the person leaves WITH their services: a
 * seat is a service for a person, and handing a son's haircut to his
 * father rewrote somebody's booking without asking (the heir rule this
 * replaces). The last person is the visit's own: their services stay, as
 * the walk-in's — "nobody seated is the walk-in".
 */
function withoutClient(draft: VisitDraft, clientId: string): VisitDraft {
  const clients = draft.clients.filter((client) => client.id !== clientId);
  if (clients.length === draft.clients.length) return draft;
  if (clients.length === 0) {
    return {
      ...draft,
      clients,
      legs: draft.legs.map((leg) =>
        leg.clientId === clientId ? { ...leg, clientId: 'primary' } : leg,
      ),
    };
  }
  const legs = draft.legs.filter((leg) => leg.clientId !== clientId);
  return {
    ...draft,
    clients,
    legs,
    // Seats left: the span is the services' again, as removing one does.
    durationOverride:
      legs.length === draft.legs.length ? draft.durationOverride : null,
  };
}

function seedDraft(vm: VisitEditorVm): VisitDraft {
  // A NEW visit starts with nobody in the chair; the add row invites one.
  const clients: VisitDraft['clients'] = vm.people?.length
    ? vm.people
    : vm.clientLabel
      ? [
          {
            id: vm.clientUserId ?? 'primary',
            label: vm.clientLabel,
            phone: vm.phone,
            phoneHref: vm.phoneHref,
            meta: vm.clientMeta,
          },
        ]
      : [];
  const firstClient = clients[0]?.id ?? 'primary';
  const legs = vm.legs.map<DraftLeg>((leg) => ({
    ...leg,
    clientId: leg.clientId ?? firstClient,
  }));
  const sum = sumOrDefault(legs);
  const span = vm.endMinute - vm.startMinute;
  return {
    dayKey: vm.dayKey,
    dayLabel: vm.dayLabel,
    startMinute: vm.startMinute,
    // Only pin a number when the booked span never was the catalogue's.
    durationOverride: span === sum ? null : span,
    chairId: vm.chairId,
    locationId: vm.locationId ?? null,
    legs,
    clients,
    note: vm.teamNote,
    discounts: vm.discounts,
    vouchers: vm.vouchers,
    tipMinorUnits: vm.tipMinorUnits,
  };
}

/**
 * The draft as «Запази» publishes it — ONE function for the live draft and
 * for a snapshot (`snapshotCommitOf`), so a save and its undo speak the
 * same shape and the shell's arithmetic (its `commandsFor`) serves both.
 */
function commitOf(draft: VisitDraft, endMinute: number): VisitEditorCommit {
  return {
    kind: 'save',
    dayKey: draft.dayKey,
    startMinute: draft.startMinute,
    endMinute,
    locationId: draft.locationId,
    note: draft.note?.trim() ? draft.note.trim() : null,
    discounts: draft.discounts,
    vouchers: draft.vouchers,
    tipMinorUnits: draft.tipMinorUnits,
    clients: draft.clients.map((client) => ({
      id: client.id,
      label: client.label,
      phone: client.phone,
    })),
    legs: draft.legs.map((leg) => ({
      seatId: leg.seatId,
      serviceId: leg.serviceId,
      variantId: leg.variantId,
      minutes: leg.minutes,
      priceLabel: leg.priceLabel,
      // Only a TYPED price travels; an untouched leg's payload is what it
      // always was.
      ...(leg.priceMinorUnits != null
        ? { priceMinorUnits: leg.priceMinorUnits }
        : {}),
      barberId: leg.barberId,
      clientId: leg.clientId,
    })),
  };
}

/**
 * THE SNAPSHOT a save's undo aims at (owner, 2026-09-23: "the save receipt
 * with whole-save undo"): the sheet's seed, published as if «Запази» had
 * been pressed on it untouched. Every leg carries its STORED price as a
 * figure, so a seat the save repriced can be priced back — the live draft
 * only carries a price somebody typed.
 */
export function snapshotCommitOf(vm: VisitEditorVm): VisitEditorCommit {
  const seed = seedDraft(vm);
  const priced: VisitDraft = {
    ...seed,
    legs: seed.legs.map((leg) => ({
      ...leg,
      priceMinorUnits:
        leg.priceLabel === null ? null : parsePriceInput(leg.priceLabel),
    })),
  };
  return commitOf(priced, seed.startMinute + spanOf(seed));
}

/**
 * THE VISIT EDITOR — one sheet, one draft, one commit boundary.
 *
 * ### The shape, in one paragraph (as built; rewritten 2026-09-18)
 * The CONTENT of a `ui-modal-sheet` the dashboard shells: the bar names
 * the seat's person (`sheetTitle`, bound to the draft) and, on a pushed
 * page, that page. Under it the ladder runs WHO → WHERE → WHAT → WHEN →
 * PEOPLE → BILL → EXITS: the chair rows (a menu re-chairs), «Салон» (a
 * fold: the map, or the shops as rows), the service legs and the add row
 * (a page), the frame — the chair's day as a picture with the day pill in
 * its head — over the typed «Начало» and «Времетраене», the client rows
 * with the client's own note under them, the rest of a party, the team's
 * note, the photos, «Отстъпка ›» and «Бакшиш ⌄» directly above the red
 * exits, and a dock that carries the total, the call and the one write.
 * Each group is a chromeless `ui-list-group` with no eyebrow over it.
 *
 * ### One navigation stack, depth exactly one
 * A row that owns SEVERAL values travels (`›`); a value with a spatial editor
 * of its own expands in place (`⌄`). The service, the two searches, the
 * discount, the scanner, the camera, the gallery and a photo are pages inside
 * THIS sheet — one scrim, one focus trap, one commit — not sheets on top of a
 * sheet. `‹` in the bar pops (and walks a party trail), Escape pops the child
 * and only closes at root, and there is no `Готово` on a child: the HIG's
 * own reason is that a second commit-shaped control is the one people
 * mistake for the dismiss.
 *
 * ### Two regimes of writing
 * The DRAFT: everything typed, picked OR DRAGGED here mutates a local
 * draft and travels as ONE batched `staffEdit` on «Запази» — the day, the
 * start, the span (the frame's drag and resize included since 2026-09-23;
 * they wrote on release from 2026-09-03 until then, and their toast's undo
 * moved the server while the draft stayed put), each leg, the chair, the
 * shop, the discounts, the vouchers, the tip, the note (`savedShape` is
 * what «Запази» waits for). The shell asks before a dirty draft is
 * dropped. IMMEDIATE: the status verbs (arrived, done, no-show, cancel)
 * and a photo write at once and are not the draft's; each stamp offers
 * its way back in the page's toast.
 */
@Component({
  selector: 'lib-staff-visit-editor',
  imports: [
    NgTemplateOutlet,
    SwipeToDeleteDirective,
    StaffTimeGrid,
    TranslocoDirective,
    UiAvatar,
    StaffEventHead,
    UiBadge,
    UiButton,
    UiChip,
    UiChoiceLeading,
    UiAmountField,
    UiChoiceMenu,
    UiChoiceTiles,
    StaffDayPill,
    UiForegroundStyleDirective,
    UiIcon,
    UiMap,
    UiSegmentedControl,
    UiInteractiveDirective,
    UiMaterialDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiPhoneField,
    UiRadiusDirective,
    UiSheetActionBar,
    UiCouponCard,
    UiCodeScanner,
    UiCountStepper,
    UiScrollColumn,
    UiStack,
    UiTextDirective,
    UiCodeField,
    UiSlider,
    UiTextField,
    UiSearchField,
    UiSheetHeadline,
    UiTimeField,
    UiUnitField,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
    UiAsyncImage,
    UiProgressView,
    UiCameraCapture,
    ShowcaseGalleryComponent,
  ],
  templateUrl: './staff-visit-editor.html',
  styleUrl: './staff-visit-editor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every surface in this feature: the `.staff-*` classes are
  // the styling contract and several of them dress projected DS content.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'staff-visit',
    'data-testid': 'staff-visit-editor',
    '[attr.data-depth]': 'depth()',
    '[attr.data-dirty]': "dirty() ? '' : null",
    // The drafted day, published on the host: the pill renders a LABEL and a
    // label cannot tell a stale draft from a stale formatter apart. Tests and
    // a browser both read the key here.
    '[attr.data-draft-day]': 'draft().dayKey',
  },
})
export class StaffVisitEditor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);

  readonly vm = input.required<VisitEditorVm>();
  /** The shop's catalogue, for the pushed add-service page. */
  /**
   * The DRAFTED day's surroundings — what the frame draws AROUND the block.
   *
   * ⚠ A SECOND INPUT, and the split is load-bearing rather than tidy. `vm`
   * is the APPOINTMENT: `seedDraft` copies it into the draft and `dirty`
   * compares against it — so `vm` must not change
   * when the draft does. These fields DO change when the draft does, because
   * stepping the pill moves the frame to another day.
   *
   * Putting them on `vm` closed a loop and cost two bugs before the shape
   * was right: the draft reseeded on every step, so the pill snapped back to
   * the appointment's own date while the frame moved without it; and `dirty`
   * went blind to the day, because the seed moved with the very value it was
   * measuring — the sheet never believed the booking had been re-dated. The
   * appointment and the day around it are two facts with two lifetimes, and
   * one input cannot carry both.
   *
   * `null` falls back to `vm`'s own fields, so a consumer that never
   * re-dates the sheet passes nothing and gets what it had before.
   */
  /**
   * Bumped by the owner each time a save actually lands.
   *
   * The sheet cannot tell "saved" from "not saved" by comparing itself to
   * the appointment, because the two encode the same visit DIFFERENTLY. A
   * `resize` writes the seat's own `durationMinutes`, so a 30-minute service
   * stretched to 45 comes back as a 45-minute service — while the draft
   * still holds a 30-minute leg with a 45-minute override on top of it. Both
   * describe the same booking; neither string-equals the other, so `dirty`
   * stayed true forever and the button never went away.
   *
   * This is the owner saying "the server has spoken". What the sheet does
   * with it is below.
   */
  /**
   * May this user INVENT a discount — the manual amount and percent arms of
   * the discount menu. The front desk and the owners; a barber may still
   * honour a coupon the client holds or a code the shop published, which is
   * not gated here (see `handlesMoney` in the accounts domain).
   */
  readonly uiMayDiscount = input(false);
  /** The coupons this visit's client already holds — the menu's own picks. */
  readonly uiGrants = input<readonly VisitEditorGrantOption[]>([]);
  /** The shop's live promo codes — the «Промо код» kind's rows. */
  readonly uiPromos = input<readonly VisitEditorPromoOption[]>([]);
  /** The owner's answer to `promoCodeEntered` — see `VisitEditorCodeResult`. */
  readonly uiPromoCode = input<VisitEditorCodeResult | null>(null);

  readonly uiSavedMark = input(0);
  /**
   * THE SHELL'S «Отмени» ON A SAVE RECEIPT (2026-09-23): bumped once the
   * server's row agrees with the snapshot the undo aimed at. The WHOLE
   * draft is re-seeded from it — pages, menus and anything typed since the
   * save go with it, because «Отмени» means "as it was before I saved".
   */
  readonly uiReseedMark = input<{
    readonly appointmentId: string;
    readonly n: number;
  } | null>(null);
  /** The last reseed mark this sheet has answered. */
  private reseededMark = 0;
  protected readonly reseedOnMark = effect(() => {
    const mark = this.uiReseedMark();
    // ONLY ITS OWN SUBJECT: a mark raised for the visit undone a moment
    // ago must not wipe a sheet since opened on another (found in review).
    if (
      mark === null ||
      mark.n === 0 ||
      mark.n === this.reseededMark ||
      mark.appointmentId !== this.vm().appointmentId
    ) {
      return;
    }
    this.reseededMark = mark.n;
    untracked(() => this.discard());
  });

  readonly uiFrameDay = input<VisitEditorFrameDay | null>(null);

  readonly uiServices = input<readonly VisitEditorServiceOption[]>([]);
  /** Known people, for the pushed add-client page. */
  readonly uiClients = input<readonly VisitEditorClientOption[]>([]);
  /** What the add-client page offers BEFORE a search: sections of people. */
  readonly uiClientSections = input<readonly VisitEditorClientSection[]>([]);
  /**
   * THE BOOK THIS DEVICE ALREADY HOLDS (2026-09-18) — everyone in the loaded
   * days. Never listed; searched the moment a key lands, so a person who is
   * already in the book answers before the index does (and answers at all
   * when the index does not know them).
   */
  readonly uiClientBook = input<readonly VisitEditorClientOption[]>([]);
  /** The add-client page opened — the owner may load its sections now. */
  readonly clientsBrowsed = output<void>();
  /** A lookup is in flight — the field turns a quiet ring meanwhile. */
  readonly uiClientSearching = input(false);
  /** The shop's chairs, for the barber combobox. */
  readonly uiBarbers = input<readonly VisitEditorBarberOption[]>([]);
  /** The sheet asked to close AT ROOT. A child pops and never emits this. */
  readonly dismissed = output<void>();

  /** A status transition the parent performs — never a draft edit. */
  readonly acted = output<string>();

  /**
   * A finished geometry gesture, in the editor's own vocabulary.
   *
   * Minutes-from-midnight rather than an ISO instant: the editor knows the
   * day only as a key and must not invent a zone to build a timestamp from.
   * The dashboard owns the clock and does that conversion, which is also the
   * only place that knows which shop calendar the day belongs to.
   */
  readonly committed = output<VisitEditorCommit>();

  /**
   * A promo code typed in the discount menu, normalised. The owner resolves
   * it and answers through `uiPromoCode`; nothing is applied until it does.
   */
  readonly promoCodeEntered = output<string>();

  /**
   * Another chair's share was tapped — the sheet should re-frame on that row.
   *
   * A push rather than a second sheet: it is the same booking at the same
   * depth, so stacking a sheet on a sheet would claim a hierarchy that is not
   * there.
   */
  readonly peerPicked = output<string>();

  /**
   * THE SHUTTER (owner, 2026-09-17: "attach / take pictures to an
   * appointment, with meta on them"): every file picked, at once — a photo
   * is not a draft and rides no «Запази». The dashboard sizes it, stamps
   * the visit's facts and writes; the live read draws it back here.
   */
  readonly photoPicked = output<File>();
  /** «Изтрий снимката» on a photo's page — by id; the page pops at once. */
  readonly photoRemoved = output<string>();
  /** One of the shop's own pictures, assigned from the gallery page. */
  readonly libraryPicked = output<VisitEditorLibraryImage>();
  /** The shop's own pictures on offer — the catalogue's covers and work, from the dashboard. */
  readonly uiLibrary = input<readonly VisitEditorLibraryImage[]>([]);
  /** The shops the «Салон» row can move the visit between. One or none hides the row. */
  readonly uiShops = input<readonly VisitEditorShopOption[]>([]);
  /** Whether a camera can be asked for here; `null` lets the engine say. */
  readonly uiCamera = input<boolean | null>(null);

  /**
   * The day the DRAFT is on, whenever it changes — including the reseed that
   * fires when the sheet opens on a new appointment.
   *
   * The frame under the pill draws this chair's day around the block, and it
   * is fed by the VM, which the parent computes from the day the AGENDA is
   * showing. Stepping the pill moved the draft and left the picture behind:
   * a barber saw the pill say `сб, 5.09` over Friday's neighbours, with the
   * `today` marker still lit. A frame that draws the wrong day's bookings is
   * worse than one that draws none, because it answers "is anyone else in
   * this chair" with somebody else's answer. (owner ruling 2026-09-04)
   *
   * The parent keeps the day live and hands back its lane; this component
   * stays the thing that draws, not the thing that fetches.
   */
  readonly dayChanged = output<string>();
  /**
   * The chair the FRAME is for — the draft's, once a barber has been
   * switched (owner, 2026-09-09: "switching the barber doesn't switch to the
   * selected barber's availability"). The owner builds the frame's day —
   * neighbours, roster, shading — for this chair, as it does for the day.
   */
  readonly chairChanged = output<string>();
  /** What the barber typed into the client search — the owner searches. */
  readonly clientQuery = output<string>();
  /** `Запиши пак` on a settled visit: a new visit, prefilled from this one. */
  readonly rebooked = output<void>();
  /**
   * «Откажи и блокирай времето»: cancel this visit and block its time — the
   * appointment that should have been a block. Two acts, named as both.
   */
  readonly blockedInstead = output<void>();

  constructor() {
    // The catalogue's keys: heard only while its page is up.
    effect(() => {
      const open = this.page()?.kind === 'service';
      untracked(() => {
        if (open) this.listenForPickerKeys();
        else this.detachPickerKeys?.();
      });
    });
    this.destroyRef.onDestroy(() => this.detachPickerKeys?.());
    this.resolveDragCopy();

    /*
     * ⚠ An EFFECT rather than an emit inside `pickDay`/`stepDay`/`goToday`.
     * There are four ways the drafted day moves — three buttons, the month
     * grid, and the reseed when the sheet is handed a different appointment
     * — and a fifth will be added by somebody who does not know about the
     * other four. The draft is the single fact; watching it is the only
     * version of this that cannot be forgotten.
     */
    /*
     * ADOPT THE SERVER'S ENCODING once it agrees with what was sent.
     *
     * Only the TIME is adopted — the day, the start, the span and each leg's
     * own minutes and chair. The note, the clients, the promotion and any
     * added service are NOT touched, because the save could not carry them
     * (see the dock's sentence) and re-seeding wholesale would throw away
     * work the barber can still see on screen.
     *
     * ⚠ It waits for AGREEMENT rather than firing on the mark alone. The
     * callable returns before the listener has delivered the new document,
     * so adopting immediately would snap the sheet back to the pre-save
     * values and then sit there while the truth arrived behind it. Comparing
     * the ends is the cheapest honest test of "this is the visit I just
     * saved"; a server that normalised the save into something else leaves
     * the sheet dirty, which is the correct thing for it to say.
     */
    effect(() => {
      const mark = this.uiSavedMark();
      const seed = this.seed();
      if (mark === 0 || mark === this.adoptedMark) return;
      /*
       * AGREEMENT is the seed saying what «Запази» SENT — its start and its
       * end. It used to compare the seed's end with the draft's end alone,
       * and a save that moved the start by five minutes and shortened the
       * span by five kept the same end: the STALE seed agreed, the draft
       * snapped back to the pre-save values, and the sheet showed «Запази»
       * over a visit the server had just accepted (found 2026-09-23 while
       * exercising the save receipt).
       */
      const saved = this.savedCommit;
      if (saved === null) return;
      if (
        seed.startMinute !== saved.startMinute ||
        seed.startMinute + spanOf(seed) !== saved.endMinute
      ) {
        return;
      }

      this.adoptedMark = mark;
      untracked(() =>
        this.draft.update((draft) => ({
          ...draft,
          dayKey: seed.dayKey,
          dayLabel: seed.dayLabel,
          startMinute: seed.startMinute,
          durationOverride: seed.durationOverride,
          legs: draft.legs.map((leg) => {
            const saved = seed.legs.find(
              (entry) => entry.seatId === leg.seatId,
            );
            return saved === undefined
              ? leg
              : { ...leg, minutes: saved.minutes, barberId: saved.barberId };
          }),
        })),
      );
    });

    effect(() => {
      const dayKey = this.draft().dayKey;
      untracked(() => this.dayChanged.emit(dayKey));
    });

    effect(() => {
      const chair = this.frameChairId();
      untracked(() => this.chairChanged.emit(chair));
    });
  }

  /** The chair the frame draws: the draft's first leg's, else the draft's. */
  protected readonly frameChairId = computed(
    () => this.draft().legs[0]?.barberId ?? this.draft().chairId,
  );

  /** A chair by id — from the roster, falling back to the row's own. */
  protected chairOf(id: string): { id: string; name: string; tone: number } {
    const vm = this.vm();
    const known = this.barberOptions().find((barber) => barber.id === id);
    return known
      ? { id: known.id, name: known.name, tone: known.tone }
      : { id: vm.chairId, name: vm.chairName, tone: vm.chairTone };
  }

  /** …and its name and tone, from the draft's own barber rows. */
  protected readonly frameChair = computed(() => {
    const vm = this.vm();
    const chair = this.barbers().find((b) => b.id === this.frameChairId());
    return chair
      ? { name: chair.label, tone: chair.tone }
      : { name: vm.chairName, tone: vm.chairTone };
  });

  /**
   * The draft, reseeded only when the SUBJECT changes.
   *
   * ⚠ IT CARRIES `previous` FORWARD, and that is load-bearing. (owner
   * ruling 2026-09-04)
   *
   * The source was already `appointmentId`, on the reasoning that an
   * unchanged id means an unchanged subject. The reasoning was right and the
   * computation did not honour it: it re-derived on every VM RECOMPUTE, so
   * a fresh `VisitEditorVm` object wiped what the barber had typed even
   * though the id was identical.
   *
   * That was not theoretical even before the frame started following the
   * pill. `nowMinute` is on the VM and ticks every sixty seconds, so a draft
   * left open across a minute boundary was silently reset — the exact
   * failure the old docblock promised could not happen. Re-dating the sheet
   * made it obvious rather than causing it: the day moved, the probe moved
   * the store's lanes, the lanes moved the VM, and the day snapped back
   * inside the same tick, so the pill never even flickered.
   *
   * The guard is a plain field because it is not state anything renders —
   * it is a memory of which appointment this draft belongs to, and a signal
   * would invite a reader to depend on it.
   */
  /** The last mark this sheet has already taken the server's answer for. */
  private adoptedMark = 0;

  protected readonly draft = linkedSignal<string, VisitDraft>({
    // The ROW's name, not the appointment's: an existing visit's row id is
    // stable, and a NEW visit (empty appointment id) gets a fresh row id per
    // create, so opening a second create does not inherit the first draft.
    source: () => `${this.vm().appointmentId}|${this.vm().rowId}`,
    /*
     * ⚠ `previous` IS THE FIX. Without it this computation ran on every VM
     * recompute — `linkedSignal` re-derives when its source's DEPENDENCIES
     * change, not only when the source's value does — so a fresh
     * `VisitEditorVm` object wiped the draft even though the appointment id
     * beside it was identical. Comparing `previous.source` is what turns the
     * intent ("reseed on a new subject") into the behaviour.
     */
    computation: (appointmentId, previous) =>
      previous !== undefined && previous.source === appointmentId
        ? previous.value
        : seedDraft(untracked(() => this.vm())),
  });

  private readonly seed = computed(() => seedDraft(this.vm()));

  /**
   * The team note the draft was last SEEDED with. The note is read live from
   * its own document and usually lands a tick after the sheet opened, so a
   * draft seeded before it arrived must adopt it — unless the barber has
   * already typed, in which case their words win.
   */
  private adoptedNote: string | null = null;

  protected readonly adoptNote = effect(() => {
    const incoming = this.vm().teamNote;
    untracked(() => {
      const draft = this.draft();
      if (draft.note === this.adoptedNote && incoming !== draft.note) {
        this.draft.update((current) => ({ ...current, note: incoming }));
      }
      this.adoptedNote = incoming;
    });
  });

  /**
   * ⚠ `dirty` MEANS "THERE IS SOMETHING `ЗАПАЗИ` CAN DO", not "anything on
   * this sheet differs". (owner ruling 2026-09-04)
   *
   * It used to be a whole-draft string compare, and that was wrong in both
   * directions. It said dirty when nothing could be saved — a typed note
   * raised the button, the barber tapped it, the note did not travel, and
   * the button stayed, which reads as a failed save. And it said dirty
   * FOREVER after a real save, because the sheet and the server encode one
   * visit two ways: a `resize` writes the seat's own duration, so a
   * 30-minute service stretched to 45 comes back AS a 45-minute service
   * while the draft still holds a 30-minute leg under a 45-minute override.
   *
   * The saveable shape is the answer to both. What the command set can carry
   * is the day, the start, the span and each leg's minutes and chair — so
   * that, and nothing else, is what the button waits for. The rest is named
   * under the dock instead of being promised by a control.
   */
  private savedShape(draft: VisitDraft): string {
    return JSON.stringify({
      dayKey: draft.dayKey,
      startMinute: draft.startMinute,
      // The shop travels as its own command (2026-09-18): the other tile
      // is a change worth a «Запази».
      shop: draft.locationId,
      span: spanOf(draft),
      legs: draft.legs.map((leg) => ({
        seatId: leg.seatId,
        serviceId: leg.serviceId,
        minutes: leg.minutes,
        barberId: leg.barberId,
        // A typed price travels with the save (owner, 2026-09-10), so it
        // is part of the shape; the seed never carries one.
        price: leg.priceMinorUnits ?? null,
      })),
      // The team note saves now (its own staff-only document), so a typed
      // note is a change worth a `Запази`.
      note: draft.note?.trim() || null,
      // The bill travels as its own commands (2026-09-10): the discounts as
      // a set, the vouchers as codes in cover order.
      discounts: draft.discounts.map((discount) => ({
        source: discount.source,
        grantId: discount.grantId,
        code: discount.code,
        value: discount.value,
      })),
      vouchers: draft.vouchers.map((voucher) => voucher.code),
      // The tip drafts with the rest (2026-09-15): a changed tip is a
      // change worth a «Запази».
      tip: draft.tipMinorUnits,
    });
  }

  /** Public: the shell's ✕ asks before dropping a dirty draft. */
  readonly dirty = computed(
    () => this.savedShape(this.draft()) !== this.savedShape(this.seed()),
  );

  /* ── Disclosure and menu state ─────────────────────────────────────── */

  protected readonly dayOpen = signal(false);
  protected readonly legDurationMenu = signal(false);
  /**
   * WHICH LEG'S CHIP IS OPEN, and which chip — the ladder row carries three
   * menus per seat (person on a party, variant), so the state is one record
   * rather than booleans that could all be true. The barber is not on the
   * row (owner, 2026-09-09): the sheet is opened for a chair, and the chair
   * row at the top is where it changes.
   */
  protected readonly legMenu = signal<{
    readonly seatId: string;
    readonly kind: 'variant' | 'client';
  } | null>(null);

  protected isLegMenu(seatId: string, kind: 'variant' | 'client'): boolean {
    const open = this.legMenu();
    return open !== null && open.seatId === seatId && open.kind === kind;
  }

  protected setLegMenu(
    seatId: string,
    kind: 'variant' | 'client',
    open: boolean,
  ): void {
    this.legMenu.set(open ? { seatId, kind } : null);
  }

  /**
   * The row's title: the service AND its variant, joined the way the
   * catalogue joins them — «Класическа подстрижка · Дълга коса», as on the
   * search page (owner, 2026-09-09). The variant's chip is an icon, so the
   * name has to live here.
   */
  protected legTitle(leg: DraftLeg): string {
    return this.legOption(leg)?.label ?? leg.serviceLabel;
  }

  /** The catalogue's option for a leg — its service and variant — or none. */
  private legOption(leg: DraftLeg): VisitEditorServiceOption | undefined {
    return this.uiServices().find(
      (entry) =>
        entry.serviceId === leg.serviceId &&
        (entry.variantId ?? null) === (leg.variantId ?? null),
    );
  }

  /**
   * THE SERVICE, bare — the row's title (owner, 2026-09-10: "the variant
   * could be a description, muted and a size down"). The variant goes on
   * the line beneath, in the footnote every other row keeps its readings
   * in, rather than welded to the name with a middot.
   */
  protected legService(leg: DraftLeg): string {
    const option = this.legOption(leg);
    return option?.serviceLabel ?? option?.label ?? leg.serviceLabel;
  }

  /** The variant, as a description — or nothing for a service without one. */
  protected legVariant(leg: DraftLeg): string | null {
    return this.legOption(leg)?.variantLabel ?? null;
  }

  /* ── The ladder's rows ─────────────────────────────────────────────── */

  /**
   * The seats a row's control acts on. One row IS one seat since the fold
   * went (owner, 2026-09-10: the same service twice is two rows); kept as
   * the one place a mutator names its seats, so the day a row folds again
   * is a one-line change here.
   */
  private seatsOf(seatId: string): ReadonlySet<string> {
    return new Set([seatId]);
  }

  /** What the services need, by the catalogue — `null` with no legs. */
  protected readonly catalogSum = computed<number | null>(() => {
    return catalogMinutesOf(
      this.draft().legs,
      (leg) => this.catalogTermsOf(leg)?.minutes ?? leg.catalogMinutes ?? null,
      (leg) => leg.minutes,
    );
  });

  /**
   * The VISIT's distance from that — the one number the tag, the readout
   * and the frame's surplus stretch all read.
   */
  protected readonly catalogDelta = computed<number | null>(() => {
    const sum = this.catalogSum();
    return sum === null ? null : this.durationMinutes() - sum;
  });

  /** The VISIT's readout: the catalogue's total and the distance from it. */
  protected readonly visitCatalogNote = computed<string | null>(() => {
    const sum = this.catalogSum();
    const delta = this.catalogDelta();
    if (sum === null || delta === null || delta === 0) return null;
    return `${this.transloco.translate('staff.visit.catalogMinutes', { minutes: sum })} · ${this.minutesDelta(delta)}`;
  });
  private readonly frameGrid = viewChild(StaffTimeGrid);

  /**
   * Full screen for the frame — shared with the block sheet. Either way
   * through, the block is centred again in the picture's new height.
   */
  private readonly frameSection =
    viewChild<ElementRef<HTMLElement>>('frameSection');

  protected readonly fullscreen = new FrameFullscreen({
    surface: () => this.frameSection()?.nativeElement,
    settled: () => this.frameGrid()?.recenter('auto'),
  });

  protected readonly noteOpen = signal(false);
  protected readonly query = signal('');
  /**
   * The decoupling line fires ONCE, on the first duration edit, and then
   * never again — a sentence repeated on every edit is chrome, not an answer.
   */
  protected readonly durationTouched = signal(false);

  /* ── The navigation stack ──────────────────────────────────────────── */

  private readonly page = signal<EditorPage | null>(null);
  protected readonly currentPage = computed(() => this.page());
  /** PUBLIC: the sheet shell draws the way back in its header bar. */
  readonly depth = computed(() => (this.page() ? 1 : 0));

  /**
   * PUBLIC: the pushed page's own name, for the sheet shell's bar (owner,
   * 2026-09-09: "when in a follow-up page it should use its header title,
   * not the main modal's"). `null` at the root, where the shell's title
   * stands. The detail pages are named after their subject.
   */
  /**
   * THE BAR'S TITLE (2026-09-18, the order review): a pushed page's own
   * name, else the seat's PERSON — «Мартин Илиев», «Мартин +1» when the
   * chair holds two, «Случаен клиент» when nobody is seated — and «Нов
   * час» while the visit does not exist yet. Bound to the DRAFT, so it
   * follows an edit instead of contradicting it (the 2026-08-26 worry).
   * It replaces «Редактиране на час», the one line that never scrolled and
   * answered nothing while the name sat below the first screen.
   */
  readonly sheetTitle = computed<string>(() => {
    const page = this.pageTitle();
    if (page !== null) return page;
    if (this.isNew()) return this.rawCopy('staff.visit.newTitle');
    const clients = this.draft().clients;
    const first = clients[0];
    if (first === undefined) return this.rawCopy('staff.visit.walkIn');
    return clients.length > 1
      ? `${first.label} +${clients.length - 1}`
      : first.label;
  });

  readonly pageTitle = computed<string | null>(() => {
    const page = this.page();
    if (page === null) return null;
    switch (page.kind) {
      case 'client':
        return this.currentClient()?.label ?? null;
      case 'clientSearch':
        return this.rawCopy('staff.visit.addClient');
      case 'clientNew':
        return this.rawCopy('staff.visit.newClientTitle');
      case 'service':
        return this.rawCopy('staff.visit.addService');
      case 'discount':
        return this.rawCopy('staff.visit.discount');
      case 'scan':
        return this.rawCopy('staff.visit.scanTitle');
      case 'photo': {
        // The moment, as Photos names it — the picture itself is the page.
        const photo = this.currentPhoto();
        return photo === null
          ? this.rawCopy('staff.visit.photo')
          : this.photoWhen(photo);
      }
      case 'camera':
        return this.rawCopy('staff.visit.photoTake');
      case 'library':
        return this.rawCopy('staff.visit.photoSystem');
    }
  });

  /**
   * The dock's ✓ on a page — the draft already holds the edits; back to the
   * ladder. On the discount page it stands while there is nothing to
   * apply, on the service page while nothing is picked.
   */
  protected confirmPage(): void {
    const leaving = this.page()?.kind ?? null;
    this.pop();
    // The add-client page's ✓ asks the party's next question at once.
    if (leaving === 'clientSearch') this.serveNext();
  }

  /** The catalogue's terms for a leg, by service and variant — or none. */
  protected catalogTermsOf(
    leg: DraftLeg,
  ): { minutes: number; priceLabel: string | null } | null {
    const option = this.uiServices().find(
      (entry) =>
        entry.serviceId === leg.serviceId &&
        (entry.variantId ?? null) === (leg.variantId ?? null),
    );
    return option
      ? { minutes: option.minutes, priceLabel: option.priceLabel }
      : null;
  }

  /** `−10 мин` / `+15 мин` — a signed distance from a catalogue length. */
  protected minutesDelta(minutes: number): string {
    return minutesDeltaLabel(minutes, (count) => this.minutesLabel(count));
  }

  /** The VISIT's distance from the catalogue's total, for the frame's tag. */
  protected readonly frameTag = computed<string | null>(() => {
    const delta = this.catalogDelta();
    return delta === null || delta === 0 ? null : this.minutesDelta(delta);
  });

  /* ── The variant row ─────────────────────────────────────────────────── */

  /** A service's variants as choices — empty for a service that has none. */
  protected legVariantChoices(leg: DraftLeg): readonly UiChoiceOption[] {
    return this.uiServices()
      .filter(
        (option) =>
          option.serviceId === leg.serviceId && option.variantId !== null,
      )
      .map((option) => ({
        id: option.id,
        label: option.variantLabel ?? option.label,
        testId: `staff-visit-variant-pick-${option.variantId}`,
      }));
  }

  protected legVariantId(leg: DraftLeg): string | null {
    return (
      this.uiServices().find(
        (option) =>
          option.serviceId === leg.serviceId &&
          option.variantId !== null &&
          option.variantId === leg.variantId,
      )?.id ?? null
    );
  }

  protected legVariantLabel(leg: DraftLeg): string {
    const id = this.legVariantId(leg);
    return (
      this.uiServices().find((option) => option.id === id)?.variantLabel ?? '—'
    );
  }

  /**
   * A different variant IS different terms (owner, 2026-09-09: "changing it
   * would be nice when you open the service itself"): the leg takes the
   * variant's catalogue minutes and price along with its name.
   */
  protected pickLegVariant(seatId: string, optionId: string): void {
    this.legMenu.set(null);
    const option = this.uiServices().find((entry) => entry.id === optionId);
    if (!option) return;
    const seats = this.seatsOf(seatId);
    this.draft.update((draft) => ({
      ...draft,
      durationOverride: null,
      legs: draft.legs.map((leg) =>
        seats.has(leg.seatId)
          ? {
              ...leg,
              variantId: option.variantId,
              serviceLabel: option.label,
              minutes: option.minutes,
              priceLabel: option.priceLabel,
            }
          : leg,
      ),
    }));
  }

  /* ── Derived time ──────────────────────────────────────────────────── */

  /** The catalogue's span — sequential legs, which is every visit today. */
  protected readonly legSum = computed(() =>
    this.draft().legs.reduce((total, leg) => total + leg.minutes, 0),
  );

  protected readonly durationMinutes = computed(
    () =>
      this.draft().durationOverride ??
      Math.max(sumOrDefault(this.draft().legs), GRAIN_MINUTES),
  );

  /** THE DERIVED END. It is a computation and it is persisted nowhere. */
  protected readonly endMinute = computed(
    () => this.draft().startMinute + this.durationMinutes(),
  );

  protected readonly startLabel = computed(() =>
    clockLabel(this.draft().startMinute),
  );
  protected readonly endLabel = computed(() => clockLabel(this.endMinute()));
  /** `input[type=time]` for the end, in `Край` mode — wrapped past midnight. */
  protected readonly endValue = this.endLabel;

  /**
   * HOW THE END IS ENTERED (owner, 2026-09-09): as a duration, or as a
   * clock time. Both write the same `durationOverride`; the row's title is
   * the switch. Per sheet, not per visit — it is how the barber thinks,
   * not a fact about the appointment.
   */
  protected readonly timingMode = signal<'duration' | 'end'>('duration');
  protected readonly timingMenu = signal(false);

  /** The row title's two words, as choice-menu options. */
  protected readonly timingOptions = computed<readonly UiChoiceOption[]>(() => [
    {
      id: 'duration',
      label: this.rawCopy('staff.visit.duration'),
      testId: 'staff-visit-timing-duration',
    },
    {
      id: 'end',
      label: this.rawCopy('staff.visit.end'),
      testId: 'staff-visit-timing-end',
    },
  ]);

  protected setTimingMode(mode: string): void {
    if (mode !== 'duration' && mode !== 'end') return;
    this.timingMenu.set(false);
    this.timingMode.set(mode);
  }

  /**
   * An end typed as a clock. Before the start means the NEXT day — a 23:25
   * cut that ends at 00:15 — never a negative visit. Snapped to the grain
   * and floored like a typed duration.
   */
  protected commitEnd(value: string): void {
    const minute = parseClock(value);
    if (minute === null) return;
    const start = this.draft().startMinute;
    let span = minute - (start % DAY_MINUTES);
    if (span <= 0) span += DAY_MINUTES;
    this.setDuration(Math.max(GRAIN_MINUTES, snap(span)));
  }
  /** `input[type=time]` speaks `HH:MM` and nothing else. */
  protected readonly startValue = this.startLabel;

  // Bounded by the SHIFT when there is one; by the civil day when there is
  // not, so an unreadable roster never narrows what can be typed.
  protected readonly startMinAttr = computed(() => {
    const shift = shiftOf(this.frameDay());
    return clockLabel(shift ? Math.max(0, shift.startMinute - 60) : 0);
  });
  protected readonly startMaxAttr = computed(() => {
    const shift = shiftOf(this.frameDay());
    return clockLabel(
      Math.min(DAY_MINUTES - 1, shift ? shift.endMinute + 60 : DAY_MINUTES - 1),
    );
  });

  /* ── The pinned summary strip ──────────────────────────────────────── */

  protected readonly clientHeadline = computed(
    () => this.draft().clients[0]?.label ?? this.vm().clientLabel,
  );

  /**
   * THE PARTICIPANTS, barber side — deduplicated by id, in leg order.
   *
   * Reads the DRAFT, so reassigning a leg's barber inside the service page
   * moves him into this list immediately, before anything is saved. The
   * fallback to the chair is not decoration: a visit whose legs have not
   * loaded still has a barber, and a participants group that renders empty
   * says the appointment has nobody working it.
   */
  protected readonly barbers = computed<readonly EditorBarberRow[]>(() => {
    const roster = this.uiBarbers();
    const portrait = (id: string) =>
      roster.find((barber) => barber.id === id)?.avatarSrc ?? null;
    const gathered: EditorBarberRow[] = [];
    for (const leg of this.draft().legs) {
      // The barber's SERVICES used to ride on a second line here. They are
      // the ladder's own next section; a participant repeating them said the
      // same thing twice and made the token two lines tall for nothing.
      if (gathered.some((barber) => barber.id === leg.barberId)) continue;
      gathered.push({
        id: leg.barberId,
        label: leg.barberName,
        tone: leg.barberTone,
        avatarSrc: portrait(leg.barberId),
      });
    }
    if (gathered.length === 0) {
      // The DRAFT's chair, by its real id (2026-09-09): this row used to be
      // keyed `'chair'`, so the menu on a new visit re-chaired nothing.
      const chair = this.chairOf(this.draft().chairId);
      return [
        {
          id: chair.id,
          label: chair.name,
          tone: chair.tone,
          avatarSrc: portrait(chair.id),
        },
      ];
    }
    return gathered;
  });

  /* ── The barber picker ─────────────────────────────────────────────── */

  /**
   * Which barber row has its menu open, by id — the same `ui-menu` the view
   * toolbar's scope switcher uses (owner ruling 2026-08-27), not a combobox.
   *
   * ONE MENU PER ROW, which is what makes a split visit unambiguous: the menu
   * on Иван's row re-chairs Иван's legs and nobody else's. A single field for
   * the whole visit had to guess whose legs a pick meant, and the guess it
   * settled on ("the primary barber's") was a rule the surface never stated.
   */
  protected readonly barberMenu = signal<string | null>(null);

  /**
   * Press to open, press again to close — the same `togglePicker` contract
   * the view toolbar's scope switcher has. `ui-menu` light-dismisses only on
   * presses OUTSIDE its host, and the trigger is inside it, so a press on the
   * trigger reached the click handler with the menu still open and reopened
   * what it should have shut.
   */
  protected toggleBarberMenu(id: string): void {
    this.barberMenu.update((open) => (open === id ? null : id));
  }

  protected pickBarberFor(
    fromId: string,
    // The MENU's own shape (`name`), the one `setLegBarber` already takes —
    // not the input's (`label`). One vocabulary per boundary.
    option: { id: string; name: string; tone: number },
  ): void {
    this.barberMenu.set(null);
    if (option.id === fromId) return;
    this.draft.update((draft) => ({
      ...draft,
      // The draft's own chair follows when it is the one being switched —
      // which is how a new visit with no leg yet changes barber at all.
      chairId: draft.chairId === fromId ? option.id : draft.chairId,
      legs: draft.legs.map((leg) =>
        leg.barberId === fromId
          ? {
              ...leg,
              barberId: option.id,
              barberName: option.name,
              barberTone: option.tone,
            }
          : leg,
      ),
    }));
  }

  /* ── The frame ─────────────────────────────────────────────────────── */

  /**
   * THE WHOLE CIVIL DAY — 00:00 to 24:00 (owner ruling 2026-08-26).
   *
   * It was a hundred minutes around the block, and a hundred minutes is not
   * a day: the grid DROPS what falls outside the window, so the shop's
   * afternoon was not merely off-screen, it was not in the frame at all —
   * unreachable by scrolling and undraggable into. The intermediate answer
   * (the roster plus an hour) had the same shape and the same flaw, one size
   * larger. A constant needs no fallbacks and can never disagree with the
   * data: whatever the roster says, midnight to midnight contains it.
   *
   * The day is SCROLLED, never compressed. `--staff-frame-minute` stays at
   * 2.4px, so the box shows about a hundred minutes at a time and a
   * 30-minute block is still 72px to grab. Fitting twenty-four hours into a
   * 240px box would put the five-minute grain at a sixth of a pixel, which
   * is the one thing the 5-minute ruling cannot survive. The grid centres
   * the frame on the edited block once, on open, and edge-scrolls under a
   * drag — those two are what make a day-long window navigable.
   *
   * ⚠ **A CONSTANT, which is what finally makes it safe.** Centring the
   * window on the draft made it chase the block: a drag emitted a new
   * interval, the window re-centred, every block moved in pixels under a
   * finger that had not moved, the pointer handler read a different minute
   * from the same position and published again — a feedback loop that pinned
   * a CPU. A window that depends on nothing cannot enter that loop at all.
   */
  protected readonly frameWindow = computed<GridWindow>(
    // Not the roster, not the roster plus a margin — MIDNIGHT TO MIDNIGHT
    // (owner ruling 2026-08-26). The shift is drawn inside it as shaded
    // closed hours, which is the honest way to show it: the shop's day is a
    // region OF the day, not the whole of what exists. Anything narrower is
    // a window the barber has to fight — the grid drops what falls outside
    // it, so every earlier attempt at "the useful part of the day" made some
    // other part unreachable. There is nothing to fall outside of now.
    () => ({ startMinute: 0, endMinute: DAY_MINUTES }),
  );

  /**
   * The day the frame draws — the dedicated input, or the appointment's own
   * when a consumer passes none.
   */
  protected readonly frameDay = computed<VisitEditorFrameDay>(() => {
    const supplied = this.uiFrameDay();
    if (supplied !== null) return supplied;
    const vm = this.vm();
    return {
      neighbours: vm.neighbours,
      rosterStartMinute: vm.rosterStartMinute,
      rosterEndMinute: vm.rosterEndMinute,
      nowMinute: vm.nowMinute,
    };
  });

  /** One column — this chair, always. The neighbours ride in it at 7%. */
  protected readonly frameColumns = computed<readonly GridColumn[]>(() => {
    const vm = this.vm();
    const day = this.frameDay();
    const draft = this.draft();
    const chair = this.frameChair();
    const edited: GridEvent = {
      id: vm.appointmentId,
      kind: 'visit',
      barberTone: chair.tone,
      tag: this.frameTag(),
      // The minutes beyond what the services need, drawn as their own
      // stretch at the block's end (owner, 2026-09-09).
      surplusMinutes: Math.max(0, this.catalogDelta() ?? 0),
      startMinute: draft.startMinute,
      endMinute: this.endMinute(),
      title: draft.clients[0]?.label ?? vm.clientLabel,
      // Services only, joined the way the agenda card joins them; a
      // variant is a description, and the block's one line is for names.
      detail: draft.legs.map((leg) => this.legService(leg)).join(' + ') || null,
      attribution: null,
      status: vm.status,
      terminal: false,
      past: false,
      accessibleName: this.frameSummary(),
      statusIcon: null,
      // The frame draws THIS chair's share and the peer run above it names
      // the rest by person and hour, which is strictly more than a ratio
      // could say. Repeating "1 / 2" on the block would be a second, vaguer
      // telling of the same fact.
      partyLabel: null,
    };

    // A neighbour's hour has gone when the day has, or when the clock on
    // this day is past its end — not always, as it was marked: `past` is a
    // fact the drag guards read, and a 16:00 neighbour at noon is not one.
    const dayGone = draft.dayKey < vm.todayKey;
    const neighbours = day.neighbours.map<GridEvent>((neighbour, index) => ({
      id: `neighbour-${index}`,
      kind: 'visit',
      barberTone: neighbour.tone,
      startMinute: neighbour.startMinute,
      endMinute: neighbour.endMinute,
      title: neighbour.name,
      detail: null,
      attribution: null,
      status: null,
      terminal: false,
      past:
        dayGone ||
        (day.nowMinute !== null && neighbour.endMinute <= day.nowMinute),
      accessibleName: neighbour.name,
      statusIcon: null,
      // The frame draws THIS chair's share and the peer run above it names
      // the rest by person and hour, which is strictly more than a ratio
      // could say. Repeating "1 / 2" on the block would be a second, vaguer
      // telling of the same fact.
      partyLabel: null,
    }));

    return [
      {
        id: 'chair',
        title: chair.name,
        detail: null,
        dayNumber: null,
        isToday: day.nowMinute !== null,
        avatarSrc: null,
        events: [...neighbours, edited],
        // ⚠ `shiftOf`, not the raw pair — the same reading `frameWindow` uses.
        // Handing the grid an inverted window makes `closedRuns` drop it and
        // paint the WHOLE frame as shut hours, so a chair rostered to
        // midnight had every minute of its day drawn closed.
        open: [shiftOf(day) ?? { startMinute: 0, endMinute: DAY_MINUTES }],
      },
    ];
  });

  /**
   * The AUTHORITATIVE description of the frame, and the only narration of it.
   *
   * Everything drawn inside the frame is `aria-hidden`, so this sentence
   * carries both boundaries, both neighbours and the shift regardless of what
   * the window happens to be showing. Assert its CONTENT in a test: with the
   * visible twin deleted (comment 6), a regression here is invisible to
   * everyone who can see.
   */
  protected readonly frameSummary = computed(() => {
    const range = `${this.startLabel()} – ${this.endLabel()}`;
    const day = this.frameDay();
    const shift = `${clockLabel(day.rosterStartMinute)} – ${clockLabel(day.rosterEndMinute)}`;
    const around = day.neighbours
      .map(
        (neighbour) =>
          `${neighbour.name} ${clockLabel(neighbour.startMinute)} – ${clockLabel(neighbour.endMinute)}`,
      )
      .join(', ');
    return [
      `${range}, ${this.minutesLabel(this.durationMinutes())}`,
      this.frameChair().name,
      shift,
      around,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /**
   * The line under the frame is SILENT by default.
   *
   * It speaks only for something the picture cannot draw: a neighbour that
   * may be off-screen, or a consequence (no online booking) that a hatch
   * cannot state. Everything else the frame already draws.
   */
  protected readonly frameVerdict = computed<{
    kind: 'conflict' | 'outsideRoster';
    name: string;
    start: string;
    end: string;
    time: string;
  } | null>(() => {
    const vm = this.vm();
    const start = this.draft().startMinute;
    const end = this.endMinute();

    const clash = vm.neighbours.find(
      (neighbour) => neighbour.startMinute < end && start < neighbour.endMinute,
    );
    if (clash) {
      return {
        kind: 'conflict',
        name: clash.name,
        start: clockLabel(clash.startMinute),
        end: clockLabel(clash.endMinute),
        time: '',
      };
    }

    // A roster that cannot be read is not a roster the visit can be OUTSIDE
    // of. Judging against the raw pair pinned this warning on for every visit
    // in a chair rostered to midnight — a footnote that is always on is a
    // footnote nobody reads when it finally means something.
    const shift = shiftOf(vm);
    if (shift && (start < shift.startMinute || end > shift.endMinute)) {
      return {
        kind: 'outsideRoster',
        name: '',
        start: '',
        end: '',
        time: clockLabel(shift.startMinute),
      };
    }
    return null;
  });

  /* ── Pages: their subjects ─────────────────────────────────────────── */

  protected readonly currentClient = computed(() => {
    const page = this.page();
    if (!page || page.kind !== 'client') return null;
    return (
      this.draft().clients.find((client) => client.id === page.subjectId) ??
      null
    );
  });

  /** Every barber this visit already knows about, the chair included. */
  protected readonly barberOptions = computed(() => {
    // THE ROSTER when it is bound — real ids, real portraits. The derived
    // fallback below keys a synthesized chair by its NAME, which is not an
    // id and never matched anything; it survives only for the case where no
    // roster is supplied.
    const roster = this.uiBarbers();
    if (roster.length > 0) {
      return roster.map((barber) => ({
        id: barber.id,
        name: barber.label,
        tone: barber.tone,
        avatarSrc: barber.avatarSrc,
      }));
    }
    const vm = this.vm();
    const seen = new Map<
      string,
      { id: string; name: string; tone: number; avatarSrc: string | null }
    >();
    for (const leg of this.draft().legs) {
      seen.set(leg.barberId, {
        id: leg.barberId,
        name: leg.barberName,
        tone: leg.barberTone,
        avatarSrc: null,
      });
    }
    if (!seen.has('chair')) {
      seen.set(vm.chairName, {
        id: vm.chairName,
        name: vm.chairName,
        tone: vm.chairTone,
        avatarSrc: null,
      });
    }
    return [...seen.values()];
  });

  /** The consequence strip under a service page's large title — live. */

  /**
   * The whole catalogue, each row knowing whether this visit already has it.
   *
   * ⚠ NOT filtered by `query()`: the card renders `serviceResults`, this
   * list with the query applied, and `openServiceSheet` empties the query
   * first — so what was typed last time cannot silently shorten the
   * catalogue the next time the card rises.
   */
  protected readonly serviceOptions = computed(() => this.uiServices());

  protected readonly serviceResults = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('bg');
    return this.serviceOptions().filter((service) =>
      service.label.toLocaleLowerCase('bg').includes(query),
    );
  });

  /**
   * WHAT WAS TYPED, read for every part at once (2026-09-18): the words
   * are a name, the digit run a number, the `@` token a mail — see
   * `client-query.ts`. The most selective part leads the lookup and the
   * filter; the rest rank the rows and prefill the form.
   */
  protected readonly parsedQuery = computed<ParsedClientQuery>(() =>
    parseClientQuery(this.query()),
  );

  /**
   * A PERSON ROW IS THE EVENT'S HEAD (owner, 2026-09-22: "there should be
   * phone and email fields dedicated to themselves, not all the data
   * separated by a dot — this looks cheap"): the name, then every fact on
   * its own glyph-led line in the agenda card's order — the mail, the
   * number, when they were last here — the same recipe the card and the
   * frame's block already draw, so a person reads the same on every staff
   * surface. The typed run stays marked in the name and in the lines.
   */
  private toRowVm(
    client: VisitEditorClientOption,
    parsed: ParsedClientQuery,
    chosen: ReadonlySet<string>,
    exact: boolean,
  ): ClientRowVm {
    const code = this.callingCode();
    const lines: StaffEventLine[] = [];
    if (client.email) {
      lines.push({
        text: client.email,
        icon: 'contact.email',
        parts: markedRuns(emailSegments(client.email, parsed)),
      });
    }
    if (client.phone) {
      lines.push({
        text: client.phone,
        icon: 'contact.phone',
        parts: markedRuns(phoneSegments(client.phone, parsed, code)),
      });
    }
    // `meta` is the owner's own line — «посл. 22.09» — unless it only
    // repeats the mail (the index's hits carry it in both).
    if (client.meta && client.meta !== client.email) {
      lines.push({ text: client.meta, icon: 'visit.last' });
    }
    return {
      ...client,
      selected: chosen.has(client.id),
      exact,
      titleParts: markedRuns(nameSegments(client.label, parsed)) ?? null,
      lines,
    };
  }

  /**
   * THE SHOP'S DIAL CODE (2026-09-22): the country the form opens on is
   * the country a typed «088…» is read in — the trunk zero becomes «+359»
   * for the lookup, the ranking, the marks and the create row's reading.
   */
  private readonly callingCode = computed(() =>
    countryCallingCode(
      this.newClientCountry() ?? this.deployment.defaultCountry,
    ),
  );

  /**
   * The owner's hits, FILTERED BY THE LEADING PART and ranked best first —
   * an exact number or mail, a number that begins as typed, names whose
   * every typed word begins one of theirs — with the typed run marked in
   * each row, Spotlight's own grammar.
   */
  protected readonly clientResults = computed<readonly ClientRowVm[]>(() => {
    const parsed = this.parsedQuery();
    const chosen = new Set(this.draft().clients.map((client) => client.id));
    // ONE PERSON, ONE PLACE (2026-09-22): the picked stand in their own
    // group right under the field, so the answers leave them out — a
    // search for «Мартин» with Мартин already on the visit shows him
    // there, not twice.
    return rankClients(
      this.searchPool().filter((client) => !chosen.has(client.id)),
      parsed,
      this.callingCode(),
    ).map(({ client, exact }) => this.toRowVm(client, parsed, chosen, exact));
  });

  /**
   * LOCAL FIRST (2026-09-18). While a search is on, what is ranked is the
   * people this device already holds — the sections and the book — AND the
   * index's answers: the first are here on the keystroke, the second a
   * debounce and a round trip later, so the list never sits empty waiting.
   * A person in both keeps the place the book gave them (rows must not jump
   * under a finger when the index lands) and takes the index's fields — the
   * profile is the truth about a name, a number and a mail.
   */
  private readonly searchPool = computed<readonly VisitEditorClientOption[]>(
    () => {
      if (!this.searchActive()) return this.uiClients();
      const pool = new Map<string, VisitEditorClientOption>();
      const held = [
        ...this.uiClientSections().flatMap((section) => section.clients),
        ...this.uiClientBook(),
      ];
      for (const client of held) {
        if (!pool.has(client.id)) pool.set(client.id, client);
      }
      for (const client of this.uiClients()) {
        const known = pool.get(client.id);
        pool.set(
          client.id,
          known === undefined ? client : { ...known, ...client },
        );
      }
      return [...pool.values()];
    },
  );

  /* ── The line under a leg's row ────────────────────────────────────── */

  /**
   * `30 мин · 20,00 €`, and the barber ONLY when he is not the chair.
   *
   * When they agree the frame's owner header has already said it once, and
   * repeating it on every row is the duplication that deleted the `Стол` row.
   */
  protected legLine(leg: DraftLeg): string {
    const draft = this.draft();
    /*
     * MINUTES only when they say something the frame does not (owner,
     * 2026-09-09). With one leg the frame's duration IS the leg's, and once
     * the frame has been resized the catalogue's minutes on each leg are a
     * number the visit no longer runs to — both read as "the original
     * minutes" beside the real ones. The leg page still edits them.
     */
    const parts: string[] = [];
    // THE VARIANT leads the line — a description of the service above it.
    const variant = this.legVariant(leg);
    if (variant !== null) parts.push(variant);
    if (draft.legs.length > 1 && draft.durationOverride === null) {
      parts.push(this.minutesLabel(leg.minutes));
    }
    // No money on the service line (owner, 2026-09-10): the receipt
    // says what each seat costs. Only whose chair, when it is not this one.
    if (leg.barberName !== this.vm().chairName) parts.push(leg.barberName);
    // On a party, whose seat this is — the leg page is where it changes.
    const clients = this.draft().clients;
    if (clients.length > 1) {
      const person = clients.find((client) => client.id === leg.clientId);
      if (person) parts.push(person.label);
    }
    // Provenance shown, never hidden: a repriced or re-timed seat says so.
    if (leg.overridden)
      parts.push(this.transloco.translate('staff.visit.custom'));
    return parts.join(' · ');
  }

  protected minutesLabel(minutes: number): string {
    return this.transloco.translate('staff.visit.minutes', { minutes });
  }

  /**
   * Every transition the graph allows, as ONE list — the `СТАТУС` picker's
   * items. (owner ruling 2026-09-04)
   *
   * The VM still splits them into `primaryVerb` and `overflowVerbs`, and
   * that split is real to the STORE — `canTransition` decides it, and the
   * agenda card's own affordances still lead with the primary. It stopped
   * being real to THIS sheet the moment the dock stopped promoting one of
   * them: `Дойде`, `Готово`, `Не дойде` and `Откажи` are the same kind of
   * act, and a picker that showed three of them under a `⋯` would be
   * re-drawing a seam the state machine does not have.
   *
   * The primary leads, because the graph's own most-likely next step is the
   * one a thumb should land on first, and the DESTRUCTIVE ones trail — the
   * convention `UiMenuItem` states in its own docblock, and the reason the
   * `⋯` could get away with any order was that it never held the primary.
   * Flattening here rather than widening the VM keeps the contract honest
   * for every other consumer of it.
   */
  /* ── The state header ──────────────────────────────────────────────
   *
   * One strip at the head of the ladder that answers "where does this visit
   * stand and what do I do" in a glance (owner review, 2026-09-08). It
   * replaces the status ROW: the same picker, the same verbs, plus the two
   * things a row could not carry — a measured tagline and the one verb the
   * clock says comes next, docked on the strip's trailing edge.
   *
   * ⚠ NOTHING HERE IS HOMEWORK. Every stamp is optional: a visit that
   * reaches its end with no stamp reads "Минал" in the neutral tone, counts
   * as an ordinary visit, and offers no verb it would nag about. `Дойде`
   * disappears once the visit has elapsed, because "they came" is no longer
   * a useful thing to record after the fact; the menu still offers every
   * legal transition for the barber who wants to.
   */

  /** Over, one way or another — the graph has settled it. */
  protected readonly settled = computed(() => {
    const status = this.vm().status;
    return (
      status === 'completed' || status === 'cancelled' || status === 'no_show'
    );
  });

  /**
   * GONE — cancelled, or a no-show: nothing happened, so there is nothing to
   * correct, and the sheet reads rather than edits. A FINISHED visit is not
   * gone (owner, 2026-09-09): the barber who had no time for the sheet
   * mid-cut comes back to it — services, length, price, even the time —
   * and the book takes the correction. `settled` still shapes the header
   * (the state word, «Запиши пак»); only `gone` locks the rows.
   */
  protected readonly gone = computed(() => {
    const status = this.vm().status;
    return status === 'cancelled' || status === 'no_show';
  });

  /*
   * THE HEAD OF THE SHEET SAYS DECISIONS, NOT STATES (owner, 2026-09-09).
   * The status chip and the stamps — «Дойде», «Готово» — are gone: no
   * barber has the time to note who came and when a cut ended, and a
   * lifecycle nobody stamps is bookkeeping the sheet did for itself. The
   * frame shows where the clock is, and the sheet says nothing twice.
   */

  /*
   * THE HEAD OF A SETTLED CHAIR SAYS WHAT SETTLED IT (owner, 2026-09-11:
   * "the cancellation reason or no-show is not showing in the event detail
   * sheets"). Not a state the barber tracks — the one fact that closed the
   * visit, which the frame cannot draw: who called it off and when, or that
   * nobody came, and the reason recorded, in the barber's own words when it
   * was «Друго».
   */

  /** Which line the head reads — the act, and whose it was. */
  protected readonly resolutionKey = computed<
    'cancelledByStaff' | 'cancelledByClient' | 'noShow' | null
  >(() => {
    const resolution = this.vm().resolution;
    if (resolution === null) return null;
    if (resolution.kind === 'no_show') return 'noShow';
    return resolution.by === 'client'
      ? 'cancelledByClient'
      : 'cancelledByStaff';
  });

  /**
   * The glyph's ink. Cancelling keeps the sheet's one red — it is the
   * destructive act everywhere else on it — and a no-show is a warning, the
   * client's fact rather than the shop's.
   */
  protected readonly resolutionTone = computed<'destructive' | 'warning'>(() =>
    this.vm().resolution?.kind === 'no_show' ? 'warning' : 'destructive',
  );

  protected readonly resolutionIcon = computed<UiIconName>(() =>
    this.vm().resolution?.kind === 'no_show'
      ? 'visit.noShow'
      : 'visit.cancelled',
  );

  /** A REQUEST waiting for its answer: the confirm edge, while pending. */
  protected readonly requestVerb = computed<VisitEditorVerb | null>(() => {
    if (this.vm().status !== 'pending') return null;
    return this.allVerbs().find((verb) => verb.kind === 'confirmed') ?? null;
  });

  private allVerbs(): readonly VisitEditorVerb[] {
    const vm = this.vm();
    return vm.primaryVerb
      ? [vm.primaryVerb, ...vm.overflowVerbs]
      : [...vm.overflowVerbs];
  }

  /**
   * THE EXITS — the sheet's last group. Every act that is not an edit and
   * not a stamp: no-show once the start has passed (before it, nobody has
   * failed to come), cancel, cancel-and-block for the appointment that
   * should have been a block, the way back from a no-show, and the next
   * visit after any settled one. The stamps the graph still allows —
   * arrived, completed — are not offered anywhere.
   */
  protected readonly exits = computed<readonly VisitExit[]>(() => {
    const vm = this.vm();
    if (this.isNew()) return [];
    const started =
      vm.dayKey < vm.todayKey ||
      (vm.dayKey === vm.todayKey &&
        vm.nowMinute !== null &&
        vm.nowMinute >= vm.startMinute);
    const out: VisitExit[] = [];
    for (const verb of this.allVerbs()) {
      if (verb.kind === 'arrived' || verb.kind === 'completed') continue;
      if (verb.kind === 'cancelled') continue; // last, below
      if (verb.kind === 'confirmed') {
        if (vm.status === 'pending') continue; // the head's own
        out.push({
          id: 'reinstate',
          label: verb.label,
          icon: 'visit.confirmed',
          destructive: false,
          act: verb.kind,
        });
        continue;
      }
      if (verb.kind === 'no_show') {
        if (started) {
          out.push({
            id: 'no-show',
            label: verb.label,
            icon: 'visit.noShow',
            destructive: false,
            act: verb.kind,
          });
        }
        continue;
      }
      out.push({
        id: verb.kind,
        label: verb.label,
        icon: 'visit.confirmed',
        destructive: verb.destructive,
        act: verb.kind,
      });
    }
    // A FINISHED visit offers the next one here; a visit that is GONE
    // offers it from the dock instead (owner, 2026-09-11), where nothing is
    // due and «Запази» has nothing left to save — one control per act.
    if (this.settled() && !this.gone()) {
      out.push({
        id: 'rebook',
        label: this.rawCopy('staff.visit.rebook'),
        icon: 'appointment.book',
        destructive: false,
        act: null,
      });
    }
    const cancel = this.allVerbs().find((verb) => verb.kind === 'cancelled');
    if (cancel) {
      // ON A PARTY'S CHAIR the exit calls off THIS chair's share alone —
      // the shell scopes it to the chair's seats — so it says whose
      // (2026-09-24): «Откажи часа» read as the whole booking.
      const names = this.draft()
        .clients.map((client) => client.label)
        .join(', ');
      out.push({
        id: 'cancel',
        label:
          vm.peers.length > 0 && names.length > 0
            ? this.transloco.translate('staff.visit.cancelFor', { names })
            : this.rawCopy('staff.visit.cancelVisit'),
        icon: 'visit.cancelled',
        destructive: true,
        act: cancel.kind,
      });
      out.push({
        id: 'cancel-block',
        label: this.rawCopy('staff.visit.cancelAndBlock'),
        icon: 'booking.blocked',
        destructive: true,
        act: null,
      });
    }
    return out;
  });

  protected runExit(exit: VisitExit): void {
    if (exit.id === 'rebook') {
      this.rebooked.emit();
      return;
    }
    if (exit.id === 'cancel-block') {
      this.blockedInstead.emit();
      return;
    }
    if (exit.act !== null) this.acted.emit(exit.act);
  }

  /**
   * THE LINE UNDER A PERSON'S NAME on their page: what the rows below do
   * not already say (2026-09-24). It printed the number, and the call row
   * right under it printed the same number again; the number is the call
   * row's, and this line keeps the one fact the sheet's own client rows
   * gave up — the last visit — or says there is no number to call.
   */
  protected clientLine(client: DraftClient): string {
    return [
      client.meta,
      client.phone ? null : this.rawCopy('staff.day.visitNoPhone'),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /* ── Navigation ────────────────────────────────────────────────────── */

  protected push(
    kind: EditorPageKind,
    subjectId: string | null,
    originTestId: string | null,
  ): void {
    // Depth is exactly one: a push from a child would be a different screen,
    // and this sheet is not the place for one.
    if (this.page()) return;
    this.query.set('');
    // A page re-opened must not remember the focus its last field had.
    this.searchFocused.set(false);
    this.page.set({ kind, subjectId, originTestId });
    if (kind === 'clientSearch') this.clientsBrowsed.emit();
    this.scrollPageToTop();
    // Focus lands on the page CONTAINER, not on its first control, so a
    // price field cannot steal the keyboard on entry.
    this.focusLater('.staff-visit__page');
  }

  /**
   * A PAGE OPENS AT ITS OWN TOP (2026-09-19). The scroller is the SHEET's,
   * an ancestor — the host stopped being one when the sheet took the
   * scrolling over, and zeroing the host alone left a pushed page opening
   * wherever the root had been scrolled to, its title under the ‹. Every
   * scrolled box between here and the sheet's own edge goes back to zero;
   * the page behind the sheet is not this component's to move.
   */
  private scrollPageToTop(): void {
    let node: HTMLElement | null = this.host.nativeElement;
    while (node !== null && node !== node.ownerDocument.body) {
      if (node.scrollTop > 0) node.scrollTop = 0;
      if (node.tagName === 'UI-SHEET' || node.tagName === 'DIALOG') return;
      node = node.parentElement;
    }
  }

  /** PUBLIC: the sheet shell's header back button calls it. */
  pop(): void {
    const page = this.page();
    // The new-client form was pushed FROM the search; back returns there,
    // with what was typed still in the field.
    if (page?.kind === 'clientNew') {
      this.page.set({
        kind: 'clientSearch',
        subjectId: null,
        originTestId: 'staff-visit-add-client',
      });
      this.focusLater('[data-testid="staff-visit-client-query"]');
      return;
    }
    if (page?.kind === 'scan') {
      // Back to the discount page the camera stood in for — its field
      // focused again, with nothing lost.
      this.returnToDiscountPage('[data-testid="staff-visit-discount-code"]');
      return;
    }
    // What a page was in the middle of does not survive it: picks not
    // seated, a code half-typed, a figure drafted, a kind picked. What is
    // on the bill stays — it is the draft's.
    if (page?.kind === 'service') this.servicePicks.set(new Map());
    if (page?.kind === 'discount') this.resetDiscountEntry();
    if (page?.kind === 'library') this.librarySelection.set(new Set());
    const origin = page?.originTestId ?? null;
    this.page.set(null);
    if (origin) this.focusLater(`[data-testid="${origin}"]`);
  }

  /**
   * ⚠ THE SHEET OWNS THE DISMISS NOW (owner ruling 2026-08-26).
   *
   * `✕`, the backdrop, Escape and the drag-down all reach the shell, which
   * closes outright from any depth — this component no longer sees them, and
   * `dismissed` survives only for `discard()`. The rule they used to
   * discharge here, *back is not intended to dismiss a sheet*, is discharged
   * by the page's own `‹` instead: a pushed page carries the way back to the
   * ladder, so the dismiss is never the only exit from a child.
   */
  /**
   * The UNTRANSPILED translation, placeholders and all.
   *
   * `translate()` always runs the transpiler, and the grid does its own
   * filling — it takes `{{minutes}} мин` and substitutes per frame as the
   * block is dragged. Asking `translate()` for that string is a trap in both
   * directions: with no params the hole is filled with nothing and the copy
   * reads `Най-малко  мин`, and with `{ minutes: '{{minutes}}' }` — which is
   * what this used to do — the transpiler substitutes the placeholder with
   * ITSELF and rescans the result forever. That is a synchronous infinite
   * loop inside `afterNextRender`: the renderer never gets the frame back,
   * the tab wedges hard enough that the debugger has to interrupt it, and no
   * error is ever printed. Read the raw table instead.
   */
  private rawCopy(key: string): string {
    const table = this.transloco.getTranslation(this.transloco.getActiveLang());
    const raw = (table as Record<string, unknown> | undefined)?.[key];
    // A scope that has not loaded leaves `translate()` as the honest
    // fallback — it returns the key, which is what a missing string looks
    // like everywhere else in the app.
    return typeof raw === 'string' ? raw : this.transloco.translate(key);
  }

  private resolveDragCopy(): void {
    afterNextRender(
      () => {
        this.dragCopy.set({
          handleStart: this.rawCopy('staff.visit.handleStart'),
          handleEnd: this.rawCopy('staff.visit.handleEnd'),
          blockRole: this.rawCopy('staff.visit.blockRole'),
          minutes: this.rawCopy('staff.visit.minutes'),
          overlap: this.rawCopy('staff.visit.overlapShort'),
          outside: this.rawCopy('staff.visit.outsideShort'),
          tooShort: this.rawCopy('staff.visit.tooShort'),
          backTo: this.rawCopy('staff.visit.backTo'),
        });
      },
      { injector: this.injector },
    );
  }

  private focusLater(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>(selector)
          ?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /* ── Editing the draft ─────────────────────────────────────────────── */

  /**
   * The words the frame's drag surfaces need.
   *
   * The grid formats every number itself and takes every word from here, so
   * the time-grid library stays free of copy — the convention `zoneLabel` and
   * `allDayLabel` already set.
   */
  /**
   * ⚠ `translate()` is called inside `untracked`, and that is not a nicety.
   *
   * `TranslocoService.translate` reads signals it also WRITES — a lazy scope
   * load is a write — so calling it from a bare `computed` makes the computed
   * invalidate itself the moment it evaluates: it recomputes, writes, is
   * dirtied by its own write, and recomputes again. It never settles. The
   * symptom is a pinned CPU and a sheet that never paints, which is exactly
   * what shipped for one build of this component.
   *
   * The language IS real reactive state, so it stays tracked; the lookups
   * that depend on it do not.
   */
  /**
   * ⚠ NOT reactive, and that is the fix rather than an oversight.
   *
   * `TranslocoService.translate` reads state it also WRITES — a lazy scope
   * load is a write — so calling it from a tracked `computed` makes the
   * computed dirty itself the instant it evaluates: it recomputes, writes, is
   * invalidated by its own write, recomputes. It never settles, and the
   * symptom is a pinned CPU and a sheet that never paints. Tracking
   * `langChanges$` instead does not help; the write happens either way.
   *
   * So the lookups run once, lazily, on the first template read — which the
   * `*transloco` directive guarantees is after the scope has loaded — and are
   * cached from then on. **Stated limit:** switching language while this
   * sheet is open leaves the drag readout in the old one until it is
   * reopened. Every other string on the surface goes through the directive
   * and updates normally; these seven do not, because they are handed to a
   * child as data rather than rendered here.
   */
  /**
   * ⚠ Resolved AFTER the first render, never during construction or change
   * detection — and the distinction is the whole bug.
   *
   * `TranslocoService.translate()` reads state it also writes: a scope that
   * has not loaded yet is fetched as a side effect of asking for a key. Call
   * it from a `computed()` and the computed dirties itself forever. Call it
   * from a FIELD INITIALIZER instead — the obvious fix, and the one shipped
   * first — and it re-enters during component construction and pins the main
   * thread so hard that Chrome's own debugger protocol stops answering. It
   * reproduces in a browser and never in jsdom, so the component's spec stays
   * green while the app is frozen.
   *
   * `afterNextRender` is the one moment that is neither: the scope has loaded
   * (the `*transloco` directive guaranteed it), the first render is finished,
   * and setting a signal there costs exactly one more pass. For that single
   * frame the grid sees empty strings, which its own contract defines as
   * "say it with the numbers alone" — a degraded readout for one frame, not a
   * wrong one.
   */
  protected readonly dragCopy = signal<GridDragCopy>({
    handleStart: '',
    handleEnd: '',
    blockRole: '',
    minutes: '',
    overlap: '',
    outside: '',
    tooShort: '',
    backTo: '',
  });

  /**
   * A gesture in flight — the draft follows the finger and nothing is written.
   *
   * The grid holds its own draft only until we answer; answering here on every
   * snap is what keeps the two pictures identical while the finger is down.
   */
  protected onFrameDraft(draft: GridDraft): void {
    const span = Math.max(GRAIN_MINUTES, draft.endMinute - draft.startMinute);
    this.draft.update((current) => {
      // ⚠ There is no `endMinute` FIELD to write. The end is derived from
      // `durationOverride ?? legSum`, so a resize pins the duration and a
      // move leaves it alone — writing a phantom field made every resize
      // snap back to the services' sum and re-emit from the grid.
      const overrideNow =
        span === Math.max(this.legSum(), GRAIN_MINUTES) ? null : span;

      // No-op when nothing actually moved. A redundant write is a redundant
      // render, and a redundant render mid-gesture is how a loop starts.
      if (
        current.startMinute === draft.startMinute &&
        current.durationOverride === overrideNow
      ) {
        return current;
      }
      return {
        ...current,
        startMinute: draft.startMinute,
        durationOverride: overrideNow,
      };
    });
  }

  /**
   * The gesture ended — and it is STILL A DRAFT (owner, 2026-09-23).
   *
   * Until this pass the release was the sheet's one immediate write, with
   * the page's toast offering the way back. That way back rewrote the
   * server and left THIS draft where the finger had put it: «Отмени» moved
   * the agenda's row home while the frame and «Начало» went on showing the
   * dragged time, and the dock offered to save the drag all over again. A
   * drag is an edit like every other on this sheet: it lands in the draft,
   * «Запази» carries it with the rest, and ✕ asks before it is dropped.
   * Nothing is written here; there is nothing to undo, so there is no
   * toast.
   *
   * The last snap is re-applied so a keyboard step — a whole gesture with
   * no snaps before it — lands too.
   */
  protected onFrameCommit(commit: GridCommit): void {
    this.onFrameDraft(commit);
  }

  protected pickDay(dayKey: string): void {
    // Moving the day HOLDS the duration and slides the whole block — the
    // same invariant `Начало` holds.
    this.draft.update((draft) => ({
      ...draft,
      dayKey,
      dayLabel: this.dayLabelFor(dayKey),
    }));
    // Collapsing the calendar DESTROYS the button that was just pressed, and
    // a modal sheet that drops focus to `<body>` restarts every reader at the
    // top of the ladder with nothing announced. Focus goes back to the pill,
    // which now carries the new date as its own label — so the change is
    // spoken by the thing the user lands on. The same collapse fires from the
    // three step buttons, which is why this lives in `pickDay` rather than in
    // the calendar's own handler.
    const wasOpen = this.dayOpen();
    this.dayOpen.set(false);
    if (wasOpen) this.focusLater('[data-testid="staff-visit-day-pill"]');
  }

  /**
   * `пт, 4.09` / `Fri, Sep 4` — the pill is ALWAYS value-bearing.
   *
   * ⚠ TWINNED WITH `StaffDashboard.dayPillLabel`, which formats the SAME
   * pill on open while this one formats it after a step. Keep them
   * identical until one absorbs the other.
   */
  /** The shared pill's grammar — `ср, 26 август` — so the frame's summary
   *  and the pill never disagree. */
  private dayLabelFor(dayKey: string): string {
    return formatDayPill(dayKey, this.transloco.getActiveLang());
  }

  protected commitStart(value: string): void {
    const minute = parseClock(value);
    if (minute === null) return;
    // The duration is the stored fact, so it is ALWAYS pinned: a client
    // arriving ten minutes late does not get a ten-minute-shorter cut.
    this.draft.update((draft) => ({ ...draft, startMinute: snap(minute) }));
  }

  protected setDuration(minutes: number): void {
    this.draft.update((draft) => ({
      ...draft,
      durationOverride: minutes === this.legSum() ? null : minutes,
    }));
    this.durationTouched.set(true);
  }

  /**
   * A TYPED duration, snapped and floored before it is believed.
   *
   * A number field hands back whatever was keyed — a blank, a `0`, a `7`,
   * `1e9`. Nothing here is coerced into plausibility for its own sake, but
   * two rules are real and belong to the surface rather than to the input:
   * the grid draws on a five-minute grain, and it refuses to draw a block
   * below the floor. A value that breaks either is not a smaller booking,
   * it is a typo, so it is pulled onto the nearest legal one rather than
   * written through or silently dropped.
   *
   * A blank or unparseable entry leaves the draft alone — the field
   * re-renders the value it still holds, which is what makes clearing it and
   * tabbing away a no-op instead of a zero-minute visit.
   */
  /**
   * ⚠ WHILE TYPING, so the draft is already dirty when the thumb arrives.
   * (owner ruling 2026-09-04)
   *
   * `Запази` is rendered by `@if (dirty())`, and the draft only moved on
   * `change` — which fires on BLUR. So the tap that reached for the button
   * was the tap that created it: the press landed on nothing, the blur made
   * the button appear under the finger, and the release had no element to
   * complete a click on. It took two taps, and the first one looked ignored.
   *
   * ⚠ NO WRITE-BACK HERE. `commitDuration` rewrites the field with what was
   * ACCEPTED, which is the honest close on blur and would be a fight during
   * typing — `6` on the way to `60` would snap the box to `10` under the
   * cursor. This arm only takes a value that is already whole and legal, and
   * leaves everything else to `change`.
   */
  protected typeDuration(raw: string): void {
    const typed = Number.parseInt(raw, 10);
    if (!Number.isFinite(typed) || typed < MIN_TYPED_MINUTES) return;
    if (String(typed) !== raw.trim()) return;
    this.setDuration(snap(typed));
  }

  /** The minutes as the field's figure. */
  protected readonly durationFigure = computed(() =>
    String(this.durationMinutes()),
  );

  protected commitDuration(raw: string): void {
    const typed = Number.parseInt(raw, 10);
    if (Number.isFinite(typed)) {
      this.setDuration(Math.max(GRAIN_MINUTES, snap(typed)));
    }

    // What the field shows afterwards is `ui-unit-field`'s own business:
    // it writes the bound figure straight back, so a snapped or refused
    // entry visibly springs back rather than sitting there looking saved.
  }

  protected setLegDuration(seatId: string, minutes: number): void {
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        leg.seatId === seatId ? { ...leg, minutes } : leg,
      ),
    }));
    this.durationTouched.set(true);
    this.legDurationMenu.set(false);
  }

  protected setLegBarber(
    seatId: string,
    barber: { id: string; name: string; tone: number },
  ): void {
    const seats = this.seatsOf(seatId);
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        seats.has(leg.seatId)
          ? {
              ...leg,
              barberId: barber.id,
              barberName: barber.name,
              barberTone: barber.tone,
            }
          : leg,
      ),
    }));
    this.legMenu.set(null);
  }

  /**
   * Minor units as a bare figure in the shop's locale — `18,00` — for a
   * unit field, whose unit is its own word. `formatMoney` stays the one way
   * a Money becomes a LABEL; this is a figure beside a label.
   */
  private figureOf(minor: number): string {
    return new Intl.NumberFormat(this.transloco.getActiveLang(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  }

  /** The swipe's act: the whole row — every seat it holds. */
  protected removeLeg(seatId: string): void {
    this.legMenu.set(null);
    const seats = this.seatsOf(seatId);
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.filter((leg) => !seats.has(leg.seatId)),
      durationOverride: null,
    }));
  }

  /* ── THE PICKS ON THE SERVICE PAGE (owner, 2026-09-17: "make it animated
   * like select — in place of a check, a stepper should animate, expand";
   * later that day: "adding a service → push sheet / page") ──
   * A row's tap PICKS the service rather than seating it: the row takes
   * the selection wash and its stepper unfolds to `− 1 +`, so a second of
   * the same is one more press there, not a second trip through the page
   * (a service may be wanted twice; owner, 2026-09-10). The DOCK's
   * «Добави» — «Добави 2 услуги» — seats every pick and pops the page;
   * the ‹ and the ✓ let the picks go. */

  /** What is picked on the page and not seated yet: the option's id → how many. */
  private readonly servicePicks = signal<ReadonlyMap<string, number>>(
    new Map(),
  );

  /** A row's count on the page — its stepper's figure, its selection when above zero. */
  protected serviceCount(id: string): number {
    return this.servicePicks().get(id) ?? 0;
  }

  /**
   * The pick's tap: on, or off again. ANY service, beside any other (owner,
   * 2026-09-17: "a staff account could do whatever he wants"): the
   * catalogue's "does not combine" rule is the client's self-booking
   * rule, and the shop's own book is not bound by it — the server does
   * not refuse the shop either.
   */
  protected pickService(option: VisitEditorServiceOption): void {
    this.countService(option, this.serviceCount(option.id) > 0 ? 0 : 1);
  }

  /** The stepper's answer: so many of this one; none takes the pick off. */
  protected countService(
    option: VisitEditorServiceOption,
    count: number,
  ): void {
    this.servicePicks.update((picks) => {
      const next = new Map(picks);
      if (count <= 0) next.delete(option.id);
      else next.set(option.id, count);
      return next;
    });
  }

  private readonly servicePickTotal = computed(() =>
    [...this.servicePicks().values()].reduce((sum, count) => sum + count, 0),
  );

  /**
   * THE DOCK'S PROMISE on the service page: «Добави» for one pick, «Добави
   * 3 услуги» for more — or nothing, and the dock keeps its ✓: the page is
   * only being read.
   */
  protected readonly serviceApply = computed<{
    label: string;
    count: number;
  } | null>(() => {
    if (this.page()?.kind !== 'service') return null;
    const count = this.servicePickTotal();
    if (count === 0) return null;
    return {
      count,
      label:
        count === 1
          ? this.rawCopy('staff.visit.servicesAddOne')
          : this.transloco.translate('staff.visit.servicesAddCount', { count }),
    };
  });

  /**
   * The dock's act: every pick seated, in the order it was picked and as
   * many times as its stepper says, and the page pops — the focus back on
   * the add row.
   */
  protected applyServices(): void {
    const options = new Map(
      this.serviceOptions().map((option) => [option.id, option] as const),
    );
    // Seated for the person the page opened for, else for the first.
    const forClientId = this.page()?.subjectId ?? null;
    for (const [id, count] of this.servicePicks()) {
      const option = options.get(id);
      if (!option) continue;
      for (let seat = 0; seat < count; seat += 1) {
        this.addServiceLeg(option, forClientId);
      }
    }
    this.servicePicks.set(new Map());
    this.pop();
    // A page opened for someone hands on to whoever is still waiting.
    if (forClientId !== null) this.serveNext();
  }

  /** Seats minted by this sheet, so two picks in one tick differ. */
  private minted = 0;

  /**
   * THE ONE DOOR to the catalogue (owner, 2026-09-10; a pushed page again
   * since 2026-09-17: "adding a service → push sheet / page"): the add row
   * pushes the page. Opens on the whole list every time, nothing picked —
   * a query typed the last time must not shorten this one before a letter
   * is typed.
   */
  protected openServicePage(forClientId: string | null = null): void {
    this.servicePicks.set(new Map());
    this.push('service', forClientId, 'staff-visit-add-service');
  }

  /**
   * TYPE TO SEARCH, from anywhere. While the service page is up, a
   * printable key pressed with focus outside an editable control lands in
   * the search field — heard at the DOCUMENT, because where focus sits
   * after the tap is not ours to know: the page takes it on push, a mouse
   * may leave it on the trigger, Safari on the sheet. The character is
   * written by hand, since a focus moved mid-keystroke does not reliably
   * receive it.
   */
  private detachPickerKeys: (() => void) | null = null;

  private listenForPickerKeys(): void {
    if (this.detachPickerKeys !== null) return;
    const doc = this.host.nativeElement.ownerDocument;
    const onKey = (event: Event) => this.onPickerKey(event as KeyboardEvent);
    doc.addEventListener('keydown', onKey, true);
    this.detachPickerKeys = () => {
      doc.removeEventListener('keydown', onKey, true);
      this.detachPickerKeys = null;
    };
  }

  private onPickerKey(event: KeyboardEvent): void {
    if (
      event.key.length !== 1 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const field = this.host.nativeElement.querySelector<HTMLInputElement>(
      '[data-testid="staff-visit-service-query"]',
    );
    if (!field) return;
    const target = event.target as HTMLElement | null;
    // Already typing somewhere that takes letters — the field itself, or
    // any other editable control: leave it be.
    if (target?.closest?.('input, textarea, [contenteditable]')) return;
    // A key aimed at a DIALOG over this sheet — the discard guard's alert,
    // whose answers are plain buttons — is the dialog's: Space on «Отхвърли»
    // must press it, not write a space into the catalogue's search under the
    // scrim (found in review, 2026-09-23; the top layer inerts the page for
    // pointers and focus, never for a listener on the document).
    if (target?.closest?.('dialog[open]')) return;
    event.preventDefault();
    field.focus();
    field.value += event.key;
    this.onQuery(field.value);
  }

  /**
   * One more leg of this service, priced and timed by the catalogue.
   *
   * THE SERVICES DRIVE THE LENGTH (owner, 2026-09-09: "adding or removing
   * services should be priority one — it should modify the duration, and
   * then if they want to override it they get to that part"). Every change
   * to the legs — a service on or off, one more of the same, a variant —
   * drops a typed length, so the visit runs to what the services need
   * until the barber types over it again. Here and in every leg mutator.
   */
  private addServiceLeg(
    option: VisitEditorServiceOption,
    forClientId: string | null = null,
  ): void {
    this.draft.update((draft) => {
      const chair = this.chairOf(draft.chairId);
      return {
        ...draft,
        durationOverride: null,
        legs: [
          ...draft.legs,
          {
            // Minted here so a later command in the same batch can address
            // the seat; the server keeps the id. Unique per pick — a barber
            // may add the same service twice, and two taps in one
            // millisecond must still be two seats, so a counter joins the
            // clock.
            seatId: `draft-${option.id}-${Date.now().toString(36)}-${this.minted++}`,
            serviceId: option.serviceId,
            variantId: option.variantId,
            serviceLabel: option.serviceLabel ?? option.label,
            minutes: option.minutes,
            priceLabel: option.priceLabel,
            // ⚠ The chair's ID, and the DRAFT's chair (2026-09-09): a new
            // visit whose barber was switched before any service was picked
            // seats the service on the switched chair, not the row's.
            barberId: chair.id,
            barberName: chair.name,
            barberTone: chair.tone,
            // Straight from the catalogue — nothing has been overridden yet.
            overridden: false,
            // The person the catalogue opened for; else the first person's,
            // until the leg's own chip says otherwise.
            clientId: forClientId ?? draft.clients[0]?.id ?? 'primary',
          },
        ],
      };
    });
  }

  /*
   * THE ADD-CLIENT PAGE (redesigned 2026-09-18; owner: "what is the CTA,
   * what lives in the toolbar, what should be the content — creative and
   * scalable"). The page answers one question — who is coming — and is
   * built from three states of the search field:
   *   – nothing typed: SECTIONS the owner supplies («Днес», «Скорошни»),
   *     each a run of person rows; or, with nothing to suggest, a quiet
   *     hint instead of «Няма съвпадение» for a search nobody has run;
   *   – typing: the owner's results, and never a dead end — the CREATE row
   *     reads what was typed («＋ Създай „Мария“»), Shopify's "create a
   *     customer" and Contacts' "Create New Contact";
   *   – the create row is FIRST and always there (the 2026-09-09 reason it
   *     lived in the dock — always reachable, whatever was typed — met by
   *     the top of the list rather than the bar).
   * The PICKED people show as removable chips under the search, Messages'
   * «To:» grammar, so a choice made three scrolls ago is still in view;
   * the dock reads their count in the bill's own dress and keeps ✓ as the
   * one way back — a pick is already in the draft, so nothing else is a
   * verb here.
   */
  protected readonly searchActive = computed(
    () => this.parsedQuery().kind !== 'empty',
  );

  /**
   * THE TITLE GIVES WAY TO THE LIST (2026-09-22, the Mobbin benchmark's
   * R1). A search engaged — the field focused, or holding a query — is a
   * list being read over a keyboard, and a 100 pt large title over that
   * list cost it a person and a half of the three it could show. So the
   * title FOLDS the moment the field takes focus and the field rises under
   * the bar, where the compact title lands to keep the page's name — the
   * UISearchController grammar, where the large title collapses as the
   * search bar activates and returns as it is cancelled. Ours returns when
   * the field is left EMPTY: a query still standing is a list still being
   * read, keyboard or not.
   *
   * PUBLIC: the shell binds it to the sheet's `titleCollapsed` — the
   * folded title never scrolls under the bar, so no observer could see it
   * cross; the owner has to say so.
   */
  protected readonly searchFocused = signal(false);
  readonly searchEngaged = computed(() => {
    // EVERY PAGE WITH A SEARCH folds the same way (owner, 2026-09-24:
    // "this should be done in adding a service and other places"): the
    // people and the catalogue.
    switch (this.page()?.kind) {
      case 'clientSearch':
        return this.searchFocused() || this.searchActive();
      case 'service':
        return this.searchFocused() || this.query().trim().length > 0;
      default:
        return false;
    }
  });

  /**
   * THE SECTIONS ARE SUGGESTIONS, AND A PERSON ALREADY ON THE VISIT IS NOT
   * ONE (owner, 2026-09-22: "we have repetition of the selected clients").
   * The picked live in «На посещението», the group right under the field
   * — the one place they show — and a tap on a suggestion moves the person
   * up into it; a tap there puts them back. The search's answers leave
   * them out for the same reason (`clientResults`).
   */
  protected readonly clientSections = computed(() => {
    const chosen = new Set(this.draft().clients.map((client) => client.id));
    const nothing = parseClientQuery('');
    return this.uiClientSections()
      .map((section) => ({
        ...section,
        clients: section.clients
          .filter((client) => !chosen.has(client.id))
          .map((client) => this.toRowVm(client, nothing, chosen, false)),
      }))
      .filter((section) => section.clients.length > 0);
  });

  /** The field's own glyph says what it took the typing for. */
  protected readonly searchGlyph = computed<UiIconName>(() => {
    const kind = this.parsedQuery().kind;
    return kind === 'phone'
      ? 'contact.phone'
      : kind === 'email'
        ? 'contact.email'
        : 'action.search';
  });

  /**
   * THE CREATE ROW SAYS WHAT IT WILL ASSIGN: every detected part with its
   * glyph — the name as typed, the number printed the way the profile
   * prints it once it is a whole number, the mail — so the desk sees the
   * form it is about to open before opening it.
   */
  protected readonly createParts = computed<readonly CreatePart[]>(() => {
    const parsed = this.parsedQuery();
    const parts: CreatePart[] = [];
    if (parsed.name.length > 0) {
      parts.push({ kind: 'name', icon: 'contact.person', value: parsed.name });
    }
    if (parsed.phoneTyped.length > 0) {
      parts.push({
        kind: 'phone',
        icon: 'contact.phone',
        value: this.phoneAsTyped(parsed),
      });
    }
    if (parsed.email.length > 0) {
      parts.push({ kind: 'email', icon: 'contact.email', value: parsed.email });
    }
    return parts;
  });

  /**
   * A NUMBER READ AS IT IS TYPED (owner, 2026-09-22: "translate the 0 to
   * +359 when not specifying the country code"): «088 76» prints
   * «+359 88 76» before it is whole — the trunk zero becomes the shop's
   * dial code, a «+…» or «00…» keeps the code it carries — and a whole
   * number prints the way the profile prints it. The kernel's as-you-type
   * formatter, fed the international form.
   */
  private phoneAsTyped(parsed: ParsedClientQuery): string {
    const [international] = phoneInternationalDigits(
      parsed,
      this.callingCode(),
    );
    if (international === undefined) return parsed.phoneTyped;
    return formatPhoneDraft(`+${international}`).formatted;
  }

  /** The create row's facts: every detected part on its own line. */
  protected readonly createLines = computed<readonly StaffEventLine[]>(() =>
    this.createParts().map((part) => ({
      text: part.value,
      icon: part.icon,
      testId: `staff-visit-new-client-${part.kind}`,
    })),
  );

  protected readonly createRowName = computed(() => {
    const parts = this.createParts();
    return parts.length === 0
      ? this.rawCopy('staff.visit.newClient')
      : this.rawCopy('staff.visit.newClientParts').replace(
          '{{parts}}',
          parts.map((part) => part.value).join(', '),
        );
  });

  /** The typed number or mail is already somebody's — badged as such. */
  protected readonly exactMatch = computed(() =>
    this.clientResults().some((row) => row.exact),
  );

  /**
   * WHEN THE CREATE ROW SHOWS (owner rulings 2026-09-22): «Нов клиент» is
   * the DOCK's — a person-add beside the ✓, as the root docks its call
   * beside «Запази» and Contacts keeps its «+» in the bar — and, the
   * moment a search is on, ALSO the list's, first: "the new user should
   * always be visible". The keyboard is up over the dock then, and a row
   * at the top of the list is the one place the desk can reach without
   * dismissing it; Return opens the same form when nobody matches. It
   * yields only to an exact number or mail (the template): then they
   * lead, badged, and the row follows. Before anything is typed the dock
   * alone is the way in.
   */
  protected readonly createRowShown = computed(() => this.searchActive());

  /**
   * RETURN in the field: one match is the answer — on the visit, and the
   * field clears for the next person; no match is a new client, the form
   * opening with every part in place; several, and focus steps into them.
   */
  protected onSearchEnter(event: Event): void {
    event.preventDefault();
    if (this.parsedQuery().kind === 'empty') return;
    /*
     * THE INDEX HAS NOT ANSWERED YET: the book's one «Мартин» may be one of
     * three, so Return waits for the answer instead of racing it — unless
     * the typed number or mail is already exactly somebody's, which no
     * later answer can change.
     */
    if (this.uiClientSearching() && !this.exactMatch()) {
      this.enterPending.set(true);
      return;
    }
    this.answerEnter(event);
  }

  private readonly enterPending = signal(false);

  protected readonly settleEnter = effect(() => {
    if (this.uiClientSearching() || !this.enterPending()) return;
    untracked(() => {
      this.enterPending.set(false);
      this.answerEnter(null);
    });
  });

  private answerEnter(event: Event | null): void {
    const rows = this.clientResults();
    if (this.parsedQuery().kind === 'empty') return;
    const [only] = rows;
    if (rows.length === 1 && only !== undefined) {
      if (!only.selected) this.toggleClient(only);
      this.onQuery('');
      return;
    }
    if (rows.length === 0) {
      this.openNewClient();
      return;
    }
    this.focusFirstResult(event);
  }

  protected focusFirstResult(event: Event | null): void {
    // ↓ from a search moves into ITS list — the people's answers, or the
    // catalogue's rows — the one keyboard path both searches share.
    const list =
      this.page()?.kind === 'service'
        ? 'staff-visit-service-list'
        : 'staff-visit-client-results';
    const first = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-testid="${list}"] [role="checkbox"]`,
    );
    if (first === null) return;
    event?.preventDefault();
    first.focus();
  }

  /**
   * RETURN ON THE CATALOGUE'S SEARCH: the platform's own — the keyboard
   * goes and the answers stay, the title still folded while the query
   * stands. Nothing is picked on a keystroke the reader cannot see land.
   */
  protected leaveSearch(event: KeyboardEvent): void {
    event.preventDefault();
    (event.target as HTMLElement | null)?.blur();
  }

  /**
   * THE PICKED, AS THE PAGE KNOWS THEM (owner, 2026-09-22: "why does the
   * selected not have an avatar"). A pick copies the option it came from,
   * face and facts and all; the visit's own person arrives from the VM
   * with a name and a number only, so their row is filled from wherever
   * the page already has them — the sections, the book, the index's
   * answers — mail, last visit and face included, so the group reads the
   * same for everyone in it.
   */
  protected readonly pickedClients = computed<
    readonly VisitEditorClientOption[]
  >(() => {
    const known = [
      ...this.uiClientSections().flatMap((section) => section.clients),
      ...this.uiClientBook(),
      ...this.uiClients(),
    ];
    return this.draft().clients.map((client) => {
      const fuller = known.find((option) => option.id === client.id);
      return {
        ...client,
        email: client.email ?? fuller?.email ?? null,
        meta: client.meta ?? fuller?.meta ?? null,
        avatarSrc:
          client.avatarSrc ??
          known.find((option) => option.id === client.id && option.avatarSrc)
            ?.avatarSrc ??
          null,
      };
    });
  });

  /** The picked, as rows of their own group — selected, unmarked. */
  protected readonly pickedRows = computed<readonly ClientRowVm[]>(() => {
    const chosen = new Set(this.draft().clients.map((client) => client.id));
    const nothing = parseClientQuery('');
    return this.pickedClients().map((client) =>
      this.toRowVm(client, nothing, chosen, false),
    );
  });

  protected toggleClient(option: VisitEditorClientOption): void {
    this.draft.update((draft) => {
      const existing = draft.clients.find((client) => client.id === option.id);
      if (existing) return withoutClient(draft, existing.id);
      return {
        ...draft,
        clients: [...draft.clients, { ...option }],
        legs: adoptPlaceholderLegs(draft, option.id),
      };
    });
  }

  /**
   * A PARTY'S PERSON COMES OFF (owner, 2026-09-24: "having multiple
   * clients should be possible to remove one of them") — the row's «−» or
   * its swipe, the service rows' own grammar. See `withoutClient` for what
   * leaves with them.
   */
  protected removeClient(clientId: string): void {
    this.draft.update((draft) => withoutClient(draft, clientId));
  }

  /** The «−» is a party's: the last person is the visit's, not a row's. */
  protected readonly clientsRemovable = computed(
    () => !this.gone() && this.draft().clients.length > 1,
  );

  /** The last row of the client search: the guest who has no record yet. */
  /* ── The new-client form ───────────────────────────────────────────── */

  /**
   * «Нов клиент», always reachable from the dock of the search (owner,
   * 2026-09-09) — never a row that appears only once something is typed.
   * What WAS typed is read for what it is: digits become the number, an
   * `@` becomes the mail, anything else the name, so the form opens with
   * the barber's work already in the right field.
   */
  protected readonly newClient = signal<{
    readonly name: string;
    readonly phone: string | null;
    readonly email: string;
  }>({ name: '', phone: null, email: '' });
  /**
   * THE SHOP'S OWN COUNTRY (2026-09-22): the same tenant default the login
   * flow, onboarding and the booking contact sheet hand the phone field —
   * one source, not a second `'BG'` written here. And it is the default
   * EVERY time the form opens: a country picked for one person is that
   * person's, not the next one's (found live: a form re-opened at +994).
   */
  private readonly deployment = inject(AUTH_DEPLOYMENT);
  protected readonly newClientCountry = signal<CountryIso2 | undefined>(
    this.deployment.defaultCountry,
  );
  /** A person needs a name; the number and the mail are welcome. */
  protected readonly newClientReady = computed(
    () => this.newClient().name.trim().length > 0,
  );

  protected openNewClient(): void {
    // EVERY PART, where it belongs (2026-09-18): «Мария 088 765 4321
    // maria@mail.bg» opens the form with all three fields filled.
    const parsed = this.parsedQuery();
    // The number in front of the phone field as E.164 by the shop's own
    // dial code — the field validates for real. Fewer than five digits are
    // not a number on its way anywhere.
    const [international] = phoneInternationalDigits(
      parsed,
      countryCallingCode(this.deployment.defaultCountry),
    );
    this.newClient.set({
      name: parsed.name,
      phone:
        international !== undefined && parsed.phoneDigits.length >= 5
          ? `+${international}`
          : null,
      email: parsed.email,
    });
    this.newClientCountry.set(this.deployment.defaultCountry);
    // A push from the search page — the one place this sheet goes two
    // deep, and `pop` knows the way back to the search.
    this.page.set({
      kind: 'clientNew',
      subjectId: null,
      originTestId: 'staff-visit-add-client',
    });
    this.focusLater('[data-testid="staff-visit-new-name"]');
  }

  protected setNewClientName(name: string): void {
    this.newClient.update((form) => ({ ...form, name }));
  }

  protected setNewClientPhone(phone: string | null): void {
    this.newClient.update((form) => ({ ...form, phone }));
  }

  protected setNewClientEmail(email: string): void {
    this.newClient.update((form) => ({ ...form, email }));
  }

  /** The dock's ✓ — the person joins the visit, and the sheet returns to the ladder. */
  protected saveNewClient(): void {
    const { name, phone, email } = this.newClient();
    const label = name.trim();
    if (!label) return;
    // NEVER A REUSED ID (found in review): `guest-${length}` handed a third
    // guest the id of one already unticked, and the flow then took the
    // newcomer for served — the seat-id rule, `minted`, applies to people
    // too. The `guest-` prefix is what the shell keys a walk-in on.
    const id = `guest-${Date.now().toString(36)}-${this.minted++}`;
    this.draft.update((draft) => ({
      ...draft,
      clients: [
        ...draft.clients,
        { id, label, phone, phoneHref: phone, meta: email.trim() || null },
      ],
      legs: adoptPlaceholderLegs(draft, id),
    }));
    this.query.set('');
    this.page.set(null);
    this.focusLater('[data-testid="staff-visit-add-client"]');
    // A person just created is a person without a service.
    this.serveNext();
  }

  /**
   * The button BECOMES the field.
   *
   * Focus moves in the same beat, because a reveal that costs a second tap
   * has not done what was asked. And the textarea does not collapse back
   * when it is emptied mid-session — a control that vanishes from under the
   * caret is worse than a two-line empty box.
   */
  /**
   * THE TIP ROW — on every saved visit that still stands (owner, 2026-09-10:
   * "where are the tips?"). It used to wait for the visit to begin, which
   * hid the whole row from a barber looking at this afternoon's booking and
   * read as nothing built. The shares default to «Няма» until money changes
   * hands. Absent only where there is nothing to attach it to — a draft the
   * server has not seen — and on a cancelled or no-show visit.
   */
  protected readonly tipRowShown = computed(
    () => !this.isNew() && !this.gone(),
  );

  /**
   * THE RECEIPT draws for a visit that has seats, or a tip to take — never
   * for a cancelled one, and not for a draft with nothing on it yet.
   */
  /** The bill's group exists for its rows: none on a new visit or a gone one. */
  protected readonly moneyShown = computed(
    () => this.discountRowShown() || this.tipRowShown(),
  );

  /* ── THE TIP (2026-09-15 / 16) ────────────────────────────────────────
   *
   * One row — «＋ Добави бакшиш», the ladder's own add grammar, or «Бакшиш ·
   * 2,00 €» once one is drafted — that raises an ACTION SHEET inside this
   * sheet (owner, 2026-09-16, evening: the value rows read wrong beside
   * «Добави услуга» and «Добави бележка», and a page push was too heavy for
   * a pick). The card holds what the 2026-09-15 page held ("predefined
   * tiles plus a custom option, more Apple-like"): a grid of tiles, Apple
   * Cash's quick amounts: «Без», the ROUND-UP targets a hand actually holds
   * («до 15 €», «до 20 €» — owner, 2026-09-16: "brilliant … 25 and 30 may
   * also fall into this"), the coins on top of an exact payment (1, 2, 5 €),
   * and «Друга сума» as a tile of its own — SELECTABLE like the rest, which
   * is how every tipping screen in the Mobbin sweep does it — that reveals
   * the field beneath the grid only once chosen. The row's value is a
   * READOUT: the amount first, the share muted, never a share the row
   * inferred. The tip DRAFTS like every other line and travels with
   * «Запази» (owner's call 1, 2026-09-15) — nothing is written on a tap.
   */

  /**
   * The presets, each already a figure of THIS visit's total, sized for the
   * BENTO (owner, 2026-09-16: "small tiles for direct tips, bigger tiles
   * for the ones that mean something else"): the round-ups LARGE — next
   * whole euro, next 5, next 10, while the tip stays within the cap — and
   * the coins on top REGULAR: the three lowest of 1, 2, 5, 10, 20 € inside
   * their share band, never an amount a round-up already is. None when the
   * total is unknown.
   */
  protected readonly tipPresets = computed<
    readonly {
      id: string;
      amount: number;
      label: string;
      detail: string;
      size: UiChoiceTileSize;
    }[]
  >(() => {
    const total = this.vm().priceMinorUnits;
    if (total === null || total <= 0) return [];
    const roundUps: {
      id: string;
      amount: number;
      label: string;
      detail: string;
      size: UiChoiceTileSize;
    }[] = [];
    const coins: typeof roundUps = [];
    const seen = new Set<number>();
    const roundUpTo = (step: number) => {
      const target = Math.ceil(total / step) * step;
      const tip = target - total;
      if (
        tip < TIP_ROUND_UP_MIN_MINOR ||
        tip > total * TIP_ROUND_UP_MAX_SHARE ||
        seen.has(tip)
      ) {
        return;
      }
      seen.add(tip);
      // THE TIP IS THE FIGURE, on every tile alike; the target it rounds
      // the bill to is the muted line beneath — «0,50 € · общо 15,00 €»
      // (owner, 2026-09-16: «до 15,00 €» as the headline read as "anything
      // up to 15"). «Общо» rather than «до»: a total cannot read as a range.
      roundUps.push({
        id: `amt:${tip}`,
        amount: tip,
        label: this.moneyLabel(tip),
        detail: this.rawCopy('staff.visit.tipRoundUp').replace(
          '{{total}}',
          this.moneyLabel(target),
        ),
        size: 'large',
      });
    };
    roundUpTo(100);
    roundUpTo(500);
    roundUpTo(1000);
    for (const amount of TIP_FIXED_MINOR) {
      if (coins.length >= TIP_FIXED_SLOTS) break;
      const share = amount / total;
      if (share < TIP_FIXED_MIN_SHARE || share > TIP_FIXED_MAX_SHARE) continue;
      if (seen.has(amount)) continue;
      seen.add(amount);
      // No share beneath a coin: the barber counts money, not percentages
      // (owner, 2026-09-16), and a coin says all it means by itself.
      coins.push({
        id: `amt:${amount}`,
        amount,
        label: this.moneyLabel(amount),
        detail: '',
        size: 'regular',
      });
    }
    return [...roundUps, ...coins];
  });

  /* ── THE TIP, A DISCLOSURE ON THE LADDER (owner, 2026-09-17: "adding a
   * tip should be collapsible: «Бакшиш — Без ⌃», and it should expand the
   * contents it has now") ──
   * The row reads the tip and opens, in place, the tiles it had on the
   * card — «Без», the round-ups, the coins, «Друга сума» with its entry.
   * There is no foot to apply from any more: a tile IS the answer and
   * writes the draft at once, the row reads it, the dock's plus rises.
   * The section stays open until the row folds it. */

  /** The tip's section is unfolded under its row. */
  protected readonly tipOpen = signal(false);
  /** «Друга сума» is chosen but nothing typed yet: the entry is open and empty. */
  private readonly tipOtherOpen = signal(false);

  /** The drafted tip — the row's one fact. */
  protected readonly tipMinor = computed(() => this.draft().tipMinorUnits);

  /** The drafted sum is one a preset tile says. */
  private readonly tipMatchesPreset = computed(() => {
    const minor = this.tipMinor();
    return (
      minor !== null &&
      this.tipPresets().some((preset) => preset.amount === minor)
    );
  });

  /**
   * Which tile is on: «Друга сума» while its entry is open, or while the
   * draft holds a sum no preset says; else the preset the draft matches;
   * else «Без».
   */
  protected readonly tipTileId = computed<string>(() => {
    const minor = this.tipMinor();
    if (this.tipOtherOpen()) return 'other';
    if (minor === null) return 'none';
    return this.tipMatchesPreset() ? `amt:${minor}` : 'other';
  });

  /** «Друга сума» is the tile that is on AND a sum is drafted: the entry holds it. */
  private readonly tipIsCustom = computed(
    () => this.tipTileId() === 'other' && this.tipMinor() !== null,
  );

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
  protected readonly tipTiles = computed<readonly UiChoiceTile[]>(() => {
    const presets = this.tipPresets();
    const tile = (preset: (typeof presets)[number]): UiChoiceTile => ({
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
        id: 'none',
        label: this.rawCopy('staff.visit.tipNone'),
        testId: 'staff-visit-tip-tile-none',
      },
      {
        id: 'other',
        // The tile is the CHOICE, not the readout: its name stays whatever
        // sum the entry beneath holds (owner, 2026-09-16: "adding the
        // custom tip should not change the label"). The sum is read on
        // the entry, on the dock and on the row.
        label: this.rawCopy('staff.visit.tipPageAmount'),
        size: 'wide',
        testId: 'staff-visit-tip-tile-other',
      },
    ];
  });

  /** The bento is four cells across. */
  protected readonly tipTileColumns = TIP_TILE_COLUMNS;

  /** The field under the grid shows only while «Друга сума» is the choice. */
  protected readonly tipCustomShown = computed(
    () => this.tipTileId() === 'other',
  );

  /** The row's readout: «Без», or the amount — never a share it inferred. */
  protected readonly tipReadout = computed(() => {
    const minor = this.tipMinor();
    return minor === null
      ? this.rawCopy('staff.visit.tipNone')
      : this.moneyLabel(minor);
  });

  /** The trigger's spoken value: «Бакшиш: 2,00 €». */
  protected readonly tipChoiceName = computed(() => this.tipReadout());

  /**
   * The row's tap: the section unfolds, or folds. Opening a custom sum
   * already drafted opens with its entry OPEN, so stepping it onto a
   * coin's amount does not fold the entry away under the thumb.
   */
  protected toggleTip(): void {
    const open = !this.tipOpen();
    this.tipOtherOpen.set(
      open && this.tipMinor() !== null && !this.tipMatchesPreset(),
    );
    this.tipOpen.set(open);
  }

  /** Return in the entry: the sum is already the draft's; the section folds. */
  protected foldTip(): void {
    this.tipOtherOpen.set(false);
    this.tipOpen.set(false);
    this.focusLater('[data-testid="staff-visit-tip"]');
  }

  /**
   * A tile IS the answer, in place: «Без» and a preset write the draft on
   * the tap. «Друга сума» is a new choice — a drafted preset is let go, the
   * entry opens on its muted «0,00», and whatever is stepped or typed
   * belongs to this tile (Wonder, Keeta); a custom sum already drafted
   * stays, the tile was already on.
   */
  protected pickTip(id: string): void {
    if (id === 'none') {
      this.tipOtherOpen.set(false);
      this.setTip(null);
      return;
    }
    if (id === 'other') {
      if (this.tipMatchesPreset()) this.setTip(null);
      this.tipOtherOpen.set(true);
      this.focusLater('#staff-visit-tip');
      return;
    }
    const preset = this.tipPresets().find((entry) => entry.id === id);
    if (preset) {
      this.tipOtherOpen.set(false);
      this.setTip(preset.amount);
    }
  }

  private setTip(minor: number | null): void {
    this.draft.update((draft) =>
      draft.tipMinorUnits === minor
        ? draft
        : { ...draft, tipMinorUnits: minor },
    );
  }

  /** The row's spoken name: «Бакшиш: 2,00 €», «Бакшиш: Без». */
  protected readonly tipRowName = computed(
    () => `${this.rawCopy('staff.visit.tip')}: ${this.tipReadout()}`,
  );

  /* ── «Салон» — the shop, a row that unfolds a map ──────────────────── */

  /**
   * THE SHOP ROW (owner, 2026-09-18: "a location in the main sheet — like
   * the tip, expandable, reusing our map"): «Салон · Креативо · Център ⌄»
   * right under the chairs — a chair stands in a shop, so the place is
   * answered straight after the person — with the shop's address as the
   * row's own line under its name. It unfolds, the tip's way, into the DS
   * map with every shop pinned and this one filled, and a tile per shop
   * beneath it; a tile or a pin IS the answer — the draft takes it on the
   * tap, the map flies to it, the row reads it — and «Запази» carries it
   * as a `relocate`. Shown only where there is a choice: one shop is a
   * fact nobody needs told.
   */
  protected readonly shopOpen = signal(false);
  /**
   * The map is MOUNTED on the first unfold and kept: a WebGL map for every
   * sheet opened is a cost most visits would never spend, and unmounting
   * it on the fold would leave the fold nothing to close over.
   */
  protected readonly shopMapMounted = signal(false);
  protected readonly theme = inject(ThemeService);

  protected readonly shop = computed<VisitEditorShopOption | null>(() => {
    const id = this.draft().locationId;
    return this.uiShops().find((shop) => shop.id === id) ?? null;
  });

  /** What the row reads: the shop's name, or a dash for one the catalogue no longer lists. */
  protected readonly shopReadout = computed(
    () => this.shop()?.label ?? this.rawCopy('staff.visit.shopUnknown'),
  );

  protected readonly shopRowName = computed(
    () => `${this.rawCopy('staff.visit.shop')}: ${this.shopReadout()}`,
  );

  /**
   * THE VIEW PILL (owner, 2026-09-18: "a segmented control for toggling
   * map or list view — a toolbar pill with two icons, list and map"): an
   * icon-only capsule at the fold's toolbar, its trailing end — Files'
   * own grid | list toggle — switching what the fold shows. The MAP by
   * default (the owner: "map only"); the LIST is the shops as rows in the
   * location step's grammar, the chosen one checked. A row or a pin drafts
   * the shop; the pill never does.
   */
  protected readonly shopView = signal<'map' | 'list'>('map');

  protected readonly shopViews = computed<readonly UiSegment[]>(() => [
    {
      id: 'map',
      label: this.rawCopy('staff.visit.shopMap'),
      icon: 'view.map',
      iconOnly: true,
      testId: 'staff-visit-shop-view-map',
    },
    {
      id: 'list',
      label: this.rawCopy('staff.visit.shopList'),
      icon: 'view.list',
      iconOnly: true,
      testId: 'staff-visit-shop-view-list',
    },
  ]);

  protected setShopView(id: string): void {
    if (id === 'map' || id === 'list') this.shopView.set(id);
  }

  /**
   * The pill's band over the map — the small control and its inset above
   * and below — handed to the camera so the pin and the other shop's edge
   * arrow stay out from under it.
   */
  protected readonly mapChromeInset = 52;

  protected readonly shopPins = computed<readonly UiMapPin[]>(() =>
    this.uiShops().map((shop) => ({
      id: shop.id,
      lat: shop.lat,
      lng: shop.lng,
      label: shop.label,
    })),
  );

  protected toggleShop(): void {
    const open = !this.shopOpen();
    if (open) this.shopMapMounted.set(true);
    this.shopOpen.set(open);
  }

  /**
   * A tile or a pin: the shop as drafted. The section stays open — picking
   * a shop is a request to SEE it, and the flight is the point of the map.
   */
  protected pickShop(id: string): void {
    if (!this.uiShops().some((shop) => shop.id === id)) return;
    this.draft.update((draft) => ({ ...draft, locationId: id }));
  }

  /** The entry's sum in minor units: the custom sum, or nothing while it waits for one. */
  protected readonly tipCustomMinor = computed<number | null>(() =>
    this.tipIsCustom() ? this.tipMinor() : null,
  );

  /**
   * The entry's answer, in minor units — a step of the −/+ pair or a typed
   * sum. Zero and an emptied field both mean no tip: the two are one fact
   * at the till, and «Без» is the tile that says it — the entry stays open
   * for the next figure.
   */
  protected setTipFromEntry(minor: number | null): void {
    this.setTip(minor === null || minor <= 0 ? null : minor);
  }

  /** The dock's green plus — the drafted tip, formatted, or nothing. */
  protected readonly tipDockLabel = computed(() => {
    const minor = this.tipMinor();
    return minor === null || minor <= 0 ? null : this.moneyLabel(minor);
  });

  /* ── THE BILL'S LADDER (2026-09-10) ──────────────────────────────────
   *
   * A value gets a pill; a LIST gets a ladder. What the shop takes off the
   * bill — coupons the client holds, codes the shop published, the front
   * desk's own figure — can be several, and what pays it — gift vouchers —
   * can be several too, so each is a line in the receipt with its actual
   * amount, in the order the evaluator applies them, removed by a swipe
   * like a seat. One add row, «Отстъпка или код», opens the menu: the
   * client's coupons as picks, and typed in its second group a CODE (a
   * coupon's or a voucher's — the shop works out which), and for whoever
   * handles the shop's money a sum or a percent.
   *
   * Every figure comes from `DiscountApplication`, the same evaluator the
   * server runs, so the lines, the dock and the stored bill cannot disagree
   * on a rounding. The lines ride the draft and travel with «Запази» as two
   * commands — the discounts as a set the server re-resolves, the vouchers
   * as codes it re-settles against the balances it reads in the same
   * transaction.
   */

  /**
   * The row: on every SAVED visit that still stands and has something to
   * bill. A draft the server has not seen waits for its first save.
   */
  protected readonly discountRowShown = computed(
    () => !this.isNew() && !this.gone() && this.draft().legs.length > 0,
  );

  /* ── THE DISCOUNT SHEET (2026-09-15; a card since 2026-09-16) ────────
   *
   * One row on the root — «＋ Добави отстъпка», or «Отстъпка» with what is
   * on the bill as its value — that raises an ACTION SHEET inside this
   * sheet (owner, 2026-09-16, evening), the card holding what the pushed
   * page of 2026-09-15 held (owner, 2026-09-12: "a single row"; Clock's
   * Add Alarm, where nothing unfolds in place — the card rises instead).
   * On the card the KIND is a choice — the client's coupon, a code, and for
   * money roles a percent or a sum — and the input beneath follows it; the
   * applied lines sit above with a way off. No field lives in a menu.
   */

  /**
   * WHAT THE PAGE HOLDS BEFORE «ПРИЛОЖИ» (owner, 2026-09-16: "make the
   * bottom CTA say what it applies — Приложи −10 % — and switch"): the code
   * as typed, the figure as typed, the coupon chosen. Nothing joins the
   * bill until the dock's CTA says so — the one constant of the Mobbin
   * sweep (Bolt, Coinbase, IKEA, talabat, Under Armour: a field, an
   * explicit Apply that waits for something to apply, the verdict under
   * the field; Splitwise's adjustments for "choose a kind, enter, add").
   * Typing only changes what the CTA promises.
   */
  private readonly codeDraft = signal('');
  private readonly figureDraft = signal('');

  /* ── THE KIND, AND WHAT APPEARS BENEATH IT (2026-09-16, fourth pass) ──
   *
   * The owner: "a dropdown with options like Promo code, Voucher/Coupon,
   * Percent, Flat — and based on the selection something should appear;
   * see what Apple HIG suggests; and let a voucher be scanned as well as
   * typed." HIG, pop-up buttons: "Use a pop-up button to present a flat
   * list of mutually exclusive options or states. A pop-up button helps
   * people make a choice that affects their content or the surrounding
   * view" — with "an introductory label" so the options can be predicted
   * without opening it, and "a useful default selection … an item that
   * most people are likely to want." HIG, pickers: "Avoid switching views
   * … displayed in context, below or in proximity to the field." So: a
   * «Вид» row whose VALUE is the pop-up (the root's duration-title
   * grammar, plain), its kinds by role and by what is at hand, and beneath
   * it, in place, what that kind needs — the shop's live codes as cards in
   * a frame, the client's coupons as cards over a code typed or scanned, a
   * percent, a sum. The default is the client's own coupon when they hold
   * one, else the shop's codes.
   */
  private readonly discountKindPicked = signal<DiscountKind | null>(null);
  protected readonly discountKindMenu = signal(false);
  /** Whether the camera can read a code here; `null` lets the engine say. */
  readonly uiScan = input<boolean | null>(null);
  protected readonly scanAvailable = computed(
    () => this.uiScan() ?? isCodeScannerSupported(),
  );

  /** The kinds on offer: the shop's codes when it has live ones, a voucher or coupon always, the figures for money roles. */
  protected readonly discountKinds = computed<readonly UiChoiceOption[]>(() => {
    const kinds: UiChoiceOption[] = [];
    if (this.promoChoices().length > 0) {
      kinds.push({
        id: 'promo',
        label: this.rawCopy('staff.visit.kindPromo'),
        description: this.rawCopy('staff.visit.kindPromoDetail'),
        testId: 'staff-visit-discount-kind-promo',
      });
    }
    kinds.push({
      id: 'coupon',
      label: this.rawCopy('staff.visit.kindCoupon'),
      description: this.rawCopy('staff.visit.kindCouponDetail'),
      testId: 'staff-visit-discount-kind-coupon',
    });
    if (this.uiMayDiscount()) {
      kinds.push({
        id: 'percent',
        label: this.rawCopy('staff.visit.discountPercent'),
        description: this.rawCopy('staff.visit.discountScope'),
        testId: 'staff-visit-discount-kind-percent',
      });
      kinds.push({
        id: 'amount',
        label: this.rawCopy('staff.visit.discountAmount'),
        description: this.rawCopy('staff.visit.discountScope'),
        testId: 'staff-visit-discount-kind-amount',
      });
    }
    return kinds;
  });

  /** The kind in force: the one picked while offered; else the client's coupon when they hold one; else the first on offer. */
  protected readonly discountKind = computed<DiscountKind>(() => {
    const picked = this.discountKindPicked();
    const offered = this.discountKinds().map((kind) => kind.id as DiscountKind);
    if (picked !== null && offered.includes(picked)) return picked;
    if (this.grantChoices().length > 0) return 'coupon';
    return offered[0] ?? 'coupon';
  });

  protected readonly discountKindLabel = computed(
    () =>
      this.discountKinds().find((kind) => kind.id === this.discountKind())
        ?.label ?? '',
  );

  /** A new kind is a new entry: what was typed for the last one goes. */
  protected pickDiscountKind(id: string): void {
    this.discountKindPicked.set(id as DiscountKind);
    this.settleCode();
    this.codeDraft.set('');
    this.figureDraft.set('');
  }

  /**
   * The row's way in (owner, 2026-09-17: "adding a discount → push sheet /
   * page; the bottom toolbar for applying goes to the main sheet; applied
   * discounts live in the pushed sheet"): a fresh entry, the default kind,
   * the tickets on the bill at the top of the page.
   */
  protected openDiscountPage(): void {
    this.resetDiscountEntry();
    this.push('discount', null, 'staff-visit-discount-row');
  }

  /** What the page was in the middle of — a code half-checked or typed, a figure typed, a kind picked — goes; the lines on the bill stay. */
  private resetDiscountEntry(): void {
    this.settleCode();
    this.codeDraft.set('');
    this.figureDraft.set('');
    this.discountKindPicked.set(null);
    this.linesOpen.set(false);
  }

  /** The page back in the camera's place, everything as it was, and the field to focus. */
  private returnToDiscountPage(focus: string): void {
    this.page.set({
      kind: 'discount',
      subjectId: null,
      originTestId: 'staff-visit-discount-row',
    });
    this.focusLater(focus);
  }

  /**
   * THE SHOP'S LIVE CODES, every one of them, in the store's order — never
   * re-sorted, never moved to a section of their own (owner, 2026-09-16,
   * evening: "they stay at their position, changing their action button
   * to remove"). Each a card in the frame in ONE OF THREE STATES: on offer
   * («Използвай»), APPLIED (stamped, «Премахни» where the call stood) or
   * BLOCKED by what is on the bill — an exclusive offer beside anything,
   * any offer beside an exclusive one — muted with the "cannot combine"
   * glyph, the way an unusable service card is (HIG). The card reads the
   * offer's RULE as its figure («−10%», «−5,00 €»), never what it would
   * take off this bill: two offers previewed on the same bill do not add
   * up once stacked, and a figure that changes under the reader is a
   * figure that lies (owner: "confusion = bad UX"). A code the client
   * already holds as a coupon of their own is offered once, as theirs.
   */
  protected readonly promoChoices = computed<readonly OfferChoice[]>(() => {
    const onBill = new Set(
      this.draft()
        .discounts.map((discount) => discount.code)
        .filter((code): code is string => code !== null),
    );
    const held = new Set(this.uiGrants().map((grant) => grant.couponId));
    return this.uiPromos()
      .filter((promo) => !held.has(promo.couponId))
      .map((promo) => {
        const applied = onBill.has(promo.code);
        return {
          kind: 'promo',
          id: promo.code,
          key: `code:${promo.code}`,
          testId: `staff-visit-discount-promo-${promo.code}`,
          code: promo.code,
          label: promo.label,
          exclusive: promo.exclusive,
          value: this.valueLabel(promo.value),
          line: this.rawCopy(
            promo.exclusive ? 'staff.visit.alone' : 'staff.visit.stacks',
          ),
          applied,
          blocked: this.offerBlocked(promo.exclusive, applied),
        };
      });
  });

  /** An offer's spoken name: «Първо посещение, FIRST10, −10%». */
  protected offerName(offer: OfferChoice): string {
    return [offer.label, offer.code, offer.value]
      .filter((part): part is string => part !== null)
      .join(', ');
  }

  /**
   * Whether an offer can join what is on the bill: an exclusive offer only
   * an empty one, any offer only a bill with no exclusive line. An applied
   * offer is never blocked — its card carries the way off instead.
   */
  private offerBlocked(exclusive: boolean, applied: boolean): boolean {
    if (applied) return false;
    const discounts = this.draft().discounts;
    return exclusive
      ? discounts.length > 0
      : discounts.some((discount) => discount.exclusive);
  }

  /** A card's «Използвай» — a coupon of the client's or one of the shop's codes; a blocked card asks nothing. */
  protected applyOffer(offer: OfferChoice): void {
    if (offer.applied || offer.blocked) return;
    if (offer.kind === 'grant') {
      this.applyGrant(offer.id);
      return;
    }
    // Known live, it joins the bill as the owner's answer to a typed code
    // would have — no round trip; the save re-resolves the code regardless.
    const promo = this.uiPromos().find((entry) => entry.code === offer.id);
    if (promo === undefined) return;
    this.addDiscount({
      source: 'code',
      label: promo.label,
      value: promo.value,
      grantId: null,
      code: promo.code,
      exclusive: promo.exclusive,
    });
  }

  /**
   * THE CAMERA, in place of the page (owner, 2026-09-16: "scan a QR code or
   * barcode — they are too much to type — but allow both"): a voucher's
   * code is printed as one, and a barber holds the phone to it rather than
   * copying it. The one place besides the search this sheet goes two deep;
   * `pop` knows the way back to the field, with nothing lost.
   */
  /* ── The shop's photos of the visit ─────────────────────────────────── */

  /** The photo whose page is up, or `null` — gone the moment the live read drops it. */
  protected readonly currentPhoto = computed<VisitEditorPhoto | null>(() => {
    const page = this.page();
    if (page?.kind !== 'photo') return null;
    return (
      this.vm().photos?.find((photo) => photo.photoId === page.subjectId) ??
      null
    );
  });

  /** A thumbnail's tap: the picture as a page, the facts in rows under it, «Изтрий» in the dock. */
  protected openPhoto(photoId: string): void {
    this.push('photo', photoId, `staff-visit-photo-${photoId}`);
  }

  /**
   * The chair the picture was taken in, as a person row: the portrait and
   * the legend while the sheet still knows the chair; the name alone when
   * only the photo remembers it; nothing when neither does.
   */
  protected photoChairRow(photo: VisitEditorPhoto): {
    readonly label: string;
    readonly avatarSrc: string | null;
    readonly tone: number | null;
  } | null {
    const chair = this.uiBarbers().find((entry) => entry.id === photo.barberId);
    if (chair !== undefined) {
      return {
        label: chair.label,
        avatarSrc: chair.avatarSrc,
        tone: chair.tone,
      };
    }
    return photo.barberName === null
      ? null
      : { label: photo.barberName, avatarSrc: null, tone: null };
  }

  /** «Добави снимка» opens its doors — the camera, the phone's own pictures, the shop's. */
  protected readonly photoMenuOpen = signal(false);

  /**
   * THE DOORS, as the sheet's every pop-up offers its options — the DS
   * choice menu, the chair's and «Вид»'s own (owner, 2026-09-17: "why is
   * it not using our ui menu the other dropdowns are using?"). The camera
   * is offered only where the engine has one to ask for.
   */
  protected readonly photoDoors = computed<readonly UiChoiceOption[]>(() => {
    const doors: UiChoiceOption[] = [];
    if (this.uiCamera() ?? isCameraSupported()) {
      doors.push({
        id: 'camera',
        label: this.rawCopy('staff.visit.photoTake'),
        icon: 'media.camera',
        testId: 'staff-visit-photo-take',
      });
    }
    doors.push(
      {
        id: 'upload',
        label: this.rawCopy('staff.visit.photoUpload'),
        icon: 'media.library',
        testId: 'staff-visit-photo-upload',
      },
      {
        id: 'system',
        label: this.rawCopy('staff.visit.photoSystem'),
        icon: 'media.gallery',
        testId: 'staff-visit-photo-system',
      },
    );
    return doors;
  });

  private readonly libraryInput =
    viewChild<ElementRef<HTMLInputElement>>('photoLibrary');

  /** A door picked: the camera as a page, the phone's picker, or the shop's pictures as a page. */
  protected openPhotoDoor(id: string): void {
    this.photoMenuOpen.set(false);
    switch (id) {
      case 'camera':
        this.cameraState.set('starting');
        this.push('camera', null, 'staff-visit-add-photo');
        return;
      case 'upload':
        // Inside the tap that picked the door, so the engine lets the
        // picker open — a hidden input's own click, the profile photo's way.
        this.libraryInput()?.nativeElement.click();
        return;
      case 'system':
        this.librarySelection.set(new Set());
        this.push('library', null, 'staff-visit-add-photo');
        return;
    }
  }

  /* ── The camera page ────────────────────────────────────────────────── */

  private readonly camera = viewChild<UiCameraCapture>('camera');
  protected readonly cameraState = signal<CameraCaptureState>('starting');
  protected readonly shutterBusy = signal(false);

  /** The dock's shutter: the viewfinder's picture, taken once. */
  protected async shoot(): Promise<void> {
    const camera = this.camera();
    if (camera === undefined || this.shutterBusy()) return;
    this.shutterBusy.set(true);
    try {
      await camera.shoot();
    } finally {
      this.shutterBusy.set(false);
    }
  }

  /** The picture taken: up like a picked file, and the page pops — the live read draws it. */
  protected shot(picture: Blob): void {
    this.photoPicked.emit(
      new File([picture], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }),
    );
    this.pop();
  }

  /** The shop's pictures as the gallery draws them — URLs, in the catalogue's order. */
  protected readonly libraryUrls = computed(() =>
    this.uiLibrary().map((image) => image.url),
  );

  /**
   * THE SELECTION on the gallery page (owner, 2026-09-17: "multi-select,
   * the selection count in the bottom action bar, like Photos"): a tap
   * marks a picture, another unmarks it; the dock counts them and adds
   * them all at once. Cleared when the page opens and when it goes.
   */
  private readonly librarySelection = signal<ReadonlySet<string>>(new Set());
  protected readonly librarySelected = computed(() => [
    ...this.librarySelection(),
  ]);

  protected toggleLibraryImage(url: string): void {
    this.librarySelection.update((selection) => {
      const next = new Set(selection);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  /** The dock's «Добави»: every picked picture assigned, in the catalogue's order, and back. */
  protected adoptSelected(): void {
    const selection = this.librarySelection();
    for (const image of this.uiLibrary()) {
      if (selection.has(image.url)) this.libraryPicked.emit(image);
    }
    this.librarySelection.set(new Set());
    this.pop();
  }

  /** A door's answer — the camera's one picture, or as many as the library gave. */
  protected pickPhotos(event: Event): void {
    this.photoMenuOpen.set(false);
    const input = event.target as HTMLInputElement;
    for (const file of Array.from(input.files ?? []))
      this.photoPicked.emit(file);
    // Emptied so the same picture can be picked again, and nothing lingers
    // in a control the sheet never reads back.
    input.value = '';
  }

  /** The dock's «Изтрий снимката»: said upward by id; the page is gone at once. */
  protected removePhoto(): void {
    const photo = this.currentPhoto();
    if (photo === null) return;
    this.photoRemoved.emit(photo.photoId);
    this.pop();
  }

  private readonly photoWhenFormat = new Intl.DateTimeFormat('bg-BG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  /** «17 септ., 16:21» — when the shutter was pressed, in the shop's own clock. */
  protected photoWhen(photo: VisitEditorPhoto): string {
    return this.photoWhenFormat.format(new Date(photo.takenAtIso));
  }

  /** The picture's own shape for its page; a photo that never said is drawn 4:3. */
  protected photoRatio(photo: VisitEditorPhoto): string {
    return photo.width !== null &&
      photo.height !== null &&
      photo.width > 0 &&
      photo.height > 0
      ? `${photo.width} / ${photo.height}`
      : '4 / 3';
  }

  protected openScanner(): void {
    // The camera takes the discount page's place — nothing of the entry is
    // cleared; `pop` brings the page back.
    this.page.set({
      kind: 'scan',
      subjectId: null,
      originTestId: 'staff-visit-discount-scan',
    });
    this.scrollPageToTop();
    this.focusLater('.staff-visit__page');
  }

  /** A code the camera read: back to the field with it, asked at once. */
  protected scanned(code: string): void {
    this.returnToDiscountPage('[data-testid="staff-visit-discount-code"]');
    this.discountKindPicked.set('coupon');
    const normalised = code.trim().toUpperCase();
    this.codeDraft.set(normalised);
    this.commitCode(normalised);
  }

  /** The code field shows what was typed, until a hit clears it. */
  protected readonly discountCodeFigure = computed(() => this.codeDraft());

  /** A keystroke in the code field: a new code is a new question, so the last verdict goes. */
  protected typeCode(raw: string): void {
    this.codeDraft.set(raw);
    if (this.codeState() !== 'idle') this.settleCode();
  }

  /**
   * A keystroke. A figure past what the page can take SNAPS to it at once
   * — a percent to a hundred, a sum to the bill (owner, 2026-09-16: "if
   * typed more than the actual price it should auto-cap it to the total,
   * same for the percentage and the flat sum"); the snap is the message.
   */
  protected typeFigure(raw: string): void {
    this.figureDraft.set(this.cappedFigure(raw));
  }

  private cappedFigure(raw: string): string {
    switch (this.discountKind()) {
      case 'percent': {
        const digits = raw.replace(/[^\d]/g, '');
        return digits.length > 0 && Number(digits) > 100 ? '100' : raw;
      }
      case 'amount': {
        const minor = parsePriceInput(raw);
        const subtotal = this.subtotalMoney()?.toMinorUnits() ?? null;
        return minor !== null && subtotal !== null && minor > subtotal
          ? this.figureOf(subtotal)
          : raw;
      }
      default:
        return raw;
    }
  }

  /** The typed figure, read: a whole percent or a sum in minor units; `null` when it is neither. */
  private readonly figureRead = computed<
    | { kind: 'percent'; percent: number }
    | { kind: 'amount'; minor: number }
    | null
  >(() => {
    const raw = this.figureDraft().trim();
    if (raw.length === 0) return null;
    switch (this.discountKind()) {
      case 'percent': {
        const digits = raw.replace(/[^\d]/g, '');
        const percent = digits.length === 0 ? NaN : Number(digits);
        return Number.isInteger(percent) && percent > 0
          ? { kind: 'percent', percent }
          : null;
      }
      case 'amount': {
        const minor = parsePriceInput(raw);
        return minor !== null && minor > 0 ? { kind: 'amount', minor } : null;
      }
      default:
        return null;
    }
  });

  /**
   * THE CARD'S PROMISE on the discount sheet: what «Приложи» would put on
   * the bill from the field beneath the kind, in its own words — «Приложи GIFT2025»,
   * «Приложи −10%», «Приложи −5,00 €» — or nothing, in which case the foot
   * keeps its «Готово» and the card is only being read. A code being checked
   * holds the button with «Проверявам…»; a figure never exceeds what the
   * page can take, since it snaps to it as it is written. The cards need
   * no promise: «Използвай» applies them.
   */
  protected readonly discountApply = computed<{
    label: string;
    disabled: boolean;
  } | null>(() => {
    if (this.page()?.kind !== 'discount') return null;
    const apply = (what: string) =>
      this.transloco.translate('staff.visit.applyDiscount', { what });
    switch (this.discountKind()) {
      case 'coupon': {
        const code = this.codeDraft().trim().toUpperCase();
        if (code.length === 0) return null;
        if (this.codeState() === 'checking') {
          return {
            label: this.rawCopy('staff.visit.discountChecking'),
            disabled: true,
          };
        }
        return { label: apply(code), disabled: false };
      }
      case 'percent':
      case 'amount': {
        const read = this.figureRead();
        if (read === null) return null;
        const what =
          read.kind === 'percent'
            ? `−${read.percent}%`
            : `−${this.moneyLabel(read.minor)}`;
        return { label: apply(what), disabled: false };
      }
      default:
        return null;
    }
  });

  /**
   * The dock's act: the promise kept and the PAGE STAYS — the line lands
   * at the top of the page as a ticket, where the applied ones live
   * (owner, 2026-09-17), the field empties for the next, and the dock
   * gives its ✓ back. A code first asks; a hit empties the field, a
   * refusal leaves it with the verdict beneath.
   */
  protected applyDiscount(): void {
    const apply = this.discountApply();
    if (apply === null || apply.disabled) return;
    switch (this.discountKind()) {
      case 'coupon': {
        const code = this.codeDraft().trim().toUpperCase();
        this.codeDraft.set(code);
        this.commitCode(code);
        return;
      }
      case 'percent':
      case 'amount': {
        const read = this.figureRead();
        if (read === null) return;
        this.addDiscount({
          source: 'manual',
          label: 'manual',
          value:
            read.kind === 'percent'
              ? { kind: 'percent_off', percent: read.percent }
              : { kind: 'fixed_amount', amountMinorUnits: read.minor },
          grantId: null,
          code: null,
          exclusive: false,
        });
        this.figureDraft.set('');
        return;
      }
      default:
        return;
    }
  }

  /**
   * The manual line as the field's figure, when the kind matches it — the
   * counter corrects a figure rather than piling another on, so the field
   * shows what a new figure would replace.
   */
  protected readonly manualFigure = computed(() => {
    const manual = this.draft().discounts.find(
      (discount) => discount.source === 'manual',
    );
    if (manual === undefined) return '';
    const kind = this.discountKind();
    if (kind === 'percent' && manual.value.kind === 'percent_off') {
      return String(manual.value.percent);
    }
    if (kind === 'amount' && manual.value.kind === 'fixed_amount') {
      return this.figureOf(manual.value.amountMinorUnits);
    }
    return '';
  });

  /** The field's figure: what is being typed, else the manual line a new one would replace. */
  protected readonly figureField = computed(
    () => this.figureDraft() || this.manualFigure(),
  );

  /* ── THE PERCENT, ON A RULER (owner, 2026-09-16: "not tiles — a slider
   * or something like that, but catchy and creative"). The figure written
   * large — the DS amount field on a whole count, no stepper, a tap types
   * it — with what it takes off this bill beneath, and the DS slider as a
   * ruler under both. The dock's promise and the applied line read the
   * same `figureDraft` as before; a move of the thumb writes it, a typed
   * figure writes it, and the ruler follows either. The sum is the same
   * instrument from nothing to the bill.
   */

  /** The percent in hand: what is being typed, else the manual line a new one would replace; `null` for none. */
  protected readonly percentValue = computed<number | null>(() => {
    const digits = this.figureField().replace(/[^\d]/g, '');
    return digits.length === 0 ? null : Number(digits);
  });

  /** The thumb never leaves the ruler: a figure typed past a hundred parks it at the end while the words beneath refuse. */
  protected readonly percentSliderValue = computed(() =>
    Math.min(100, this.percentValue() ?? 0),
  );

  /** The quarters, named. */
  protected readonly percentMarks: readonly UiSliderMark[] = [
    0, 25, 50, 75, 100,
  ].map((value) => ({ value, label: `${value}%` }));

  /** What a reader hears for the thumb: «−15% · 23,80 €» — the share, and what the dock says is due. */
  protected readonly percentValueText = computed(
    () => `−${this.percentSliderValue()}% · ${this.dockTotalLabel()}`,
  );

  /** A move of the thumb writes the figure; the floor writes a zero, which promises nothing. */
  protected slidePercent(percent: number): void {
    this.figureDraft.set(String(percent));
  }

  /**
   * The percent entry's answer as the figure the promise reads. Guarded by
   * the kind: leaving the entry for the «Вид» pop-up makes the engine fire
   * its `change` a beat after the kind has already moved on, and a whole
   * percent read as cents («1,40») is not what anybody typed.
   */
  protected setPercentFromEntry(percent: number | null): void {
    if (this.discountKind() !== 'percent') return;
    const figure = percent === null ? '' : this.cappedFigure(String(percent));
    // A leave event that repeats what the field already shows is not
    // typing — Return's own `change`, a beat after the ask, must not redraft
    // the figure it just kept.
    if (figure === this.figureField()) return;
    this.figureDraft.set(figure);
  }

  /** The sum entry's answer, in minor units, as the figure the promise reads — guarded the same way. */
  protected setAmountFromEntry(minor: number | null): void {
    if (this.discountKind() !== 'amount') return;
    const figure =
      minor === null ? '' : this.cappedFigure(this.figureOf(minor));
    if (figure === this.figureField()) return;
    this.figureDraft.set(figure);
  }

  /** The bill, exactly — the sum's ceiling for the field; the ruler's is the last half-euro step under it. */
  protected readonly amountCap = computed<number | null>(
    () => this.subtotalMoney()?.toMinorUnits() ?? null,
  );

  /** The sum in hand, in minor units: what is being typed, else the manual sum a new one would replace. */
  protected readonly amountValue = computed<number | null>(() => {
    const raw = this.figureField().trim();
    return raw.length === 0 ? null : parsePriceInput(raw);
  });

  /** The ruler runs to the bill — the last half-euro step that fits it; none without a bill. */
  protected readonly amountSliderMax = computed<number | null>(() => {
    const subtotal = this.subtotalMoney()?.toMinorUnits() ?? null;
    if (subtotal === null) return null;
    const max =
      Math.floor(subtotal / AMOUNT_SLIDER_STEP_MINOR) *
      AMOUNT_SLIDER_STEP_MINOR;
    return max > 0 ? max : null;
  });

  protected readonly amountSliderStep = AMOUNT_SLIDER_STEP_MINOR;
  protected readonly amountSliderTick = AMOUNT_SLIDER_TICK_MINOR;
  protected readonly amountSliderMajor = AMOUNT_SLIDER_MAJOR_MINOR;

  protected readonly amountSliderValue = computed(() =>
    Math.min(this.amountSliderMax() ?? 0, Math.max(0, this.amountValue() ?? 0)),
  );

  /** The ends, named: «0,00 €» and the bill. */
  protected readonly amountMarks = computed<readonly UiSliderMark[]>(() => {
    const max = this.amountSliderMax();
    return max === null
      ? []
      : [
          { value: 0, label: this.moneyLabel(0) },
          { value: max, label: this.moneyLabel(max) },
        ];
  });

  protected readonly amountValueText = computed(
    () =>
      `−${this.moneyLabel(this.amountSliderValue())} · ${this.dockTotalLabel()}`,
  );

  protected slideAmount(minor: number): void {
    this.figureDraft.set(this.figureOf(minor));
  }

  /** The code being checked, normalised; `null` when nothing is in flight. */
  private readonly pendingCode = signal<string | null>(null);

  /** The code field's state: idle, waiting for the owner, or one of the refusals. */
  protected readonly codeState = signal<
    | 'idle'
    | 'checking'
    | 'unknown'
    | 'already'
    | 'void'
    | 'expired'
    | 'empty'
    | 'nothingLeft'
  >('idle');

  /** The copy under the code field for its state; `null` when idle. */
  protected readonly codeNote = computed<string | null>(() => {
    switch (this.codeState()) {
      case 'idle':
        return null;
      case 'checking':
        return this.rawCopy('staff.visit.discountChecking');
      case 'unknown':
        return this.rawCopy('staff.visit.discountUnknownCode');
      case 'already':
        return this.rawCopy('staff.visit.codeAlready');
      case 'void':
        return this.rawCopy('staff.visit.voucherVoid');
      case 'expired':
        return this.rawCopy('staff.visit.voucherExpired');
      case 'empty':
        return this.rawCopy('staff.visit.voucherEmpty');
      case 'nothingLeft':
        return this.rawCopy('staff.visit.voucherNothingLeft');
    }
  });

  /** A refusal reads red; a wait reads quiet. */
  protected readonly codeRefused = computed(
    () => this.codeState() !== 'idle' && this.codeState() !== 'checking',
  );

  /** The saved subtotal as money — what every discount here is a share of. */
  private readonly subtotalMoney = computed<Money | null>(() => {
    const minor = this.vm().priceMinorUnits;
    if (minor === null || minor <= 0) return null;
    const money = Money.fromMinorUnitsAndCode(minor, MONEY_CODE);
    return money.isSuccess() ? money.value : null;
  });

  /**
   * THE BILL, evaluated: every drafted discount through the one evaluator,
   * in the order it applies them (fixed amounts first, then percents on the
   * remainder, then a free service), each with what it actually took off.
   */
  private readonly bill = computed(() => this.evaluate(this.draft().discounts));

  /**
   * THE DOCK'S BILL: the draft's lines, with the figure being written on
   * the discount page standing in for the manual line it would replace —
   * so the price — on the card's foot while it is up, on the dock beneath
   * — previews it, the old price struck and the new one said, before it is
   * kept (owner, 2026-09-16: "edit the bottom toolbar price, add a
   * strikethrough — for all discount addition"). A figure the card refuses
   * previews nothing.
   */
  private readonly dockBill = computed(() => {
    const drafted = this.draftedManual();
    if (drafted === null) return this.bill();
    return this.evaluate([
      ...this.draft().discounts.filter(
        (discount) => discount.source !== 'manual',
      ),
      drafted,
    ]);
  });

  /** The manual line the discount page's figure would put on the bill, while it would take. */
  private readonly draftedManual = computed<VisitEditorDiscount | null>(() => {
    if (this.page()?.kind !== 'discount') return null;
    const read = this.figureRead();
    if (read === null) return null;
    return {
      source: 'manual',
      label: 'manual',
      value:
        read.kind === 'percent'
          ? { kind: 'percent_off', percent: read.percent }
          : { kind: 'fixed_amount', amountMinorUnits: read.minor },
      grantId: null,
      code: null,
      exclusive: false,
    };
  });

  /** Every discount through the one evaluator, in the order it applies them — see `bill`. */
  private evaluate(discounts: readonly VisitEditorDiscount[]) {
    const subtotal = this.subtotalMoney();
    const inputs: DiscountInput[] = [];
    const keys = new Map<string, VisitEditorDiscount>();
    discounts.forEach((discount, index) => {
      const value = toCouponValue(discount.value, MONEY_CODE);
      if (value === null) return;
      const key = discountKey(discount);
      keys.set(key, discount);
      inputs.push({
        id: key,
        label: discount.label,
        value,
        grantedAt: instantAt(index),
      });
    });
    const breakdown =
      subtotal === null ? null : DiscountApplication.apply(subtotal, inputs);
    const amounts = new Map<string, number>();
    for (const line of breakdown?.lines ?? []) {
      amounts.set(line.id, line.amount.toMinorUnits());
    }
    // The evaluator's own order — the two keys where the meaning lives.
    const ordered = [...inputs].sort(
      (a, b) =>
        CouponValue.kindRank(a.value) - CouponValue.kindRank(b.value) ||
        CouponValue.magnitude(a.value) - CouponValue.magnitude(b.value),
    );
    return {
      subtotal,
      discountTotal: breakdown?.discountTotal.toMinorUnits() ?? 0,
      total:
        breakdown?.total.toMinorUnits() ?? subtotal?.toMinorUnits() ?? null,
      lines: ordered.map((input) => ({
        key: input.id,
        discount: keys.get(input.id) as VisitEditorDiscount,
        amount: amounts.get(input.id) ?? 0,
      })),
    };
  }

  /**
   * The bill's discount lines as TICKETS on the ladder — the card's own
   * applied ticket, brought to the root (owner, 2026-09-17: "not list rows
   * — the exact components you use in the action sheet, the applied ones
   * with «Премахни»"): the kind's glyph, the name, the RULE as the figure
   * with the code beside it, exactly as it reads on the card. In the chip,
   * what the rule made of THIS bill — the evaluator's own settled figure,
   * which adds up where the card's previews could not — or nothing, where
   * the rule is the sum itself (a fixed sum, unless the bill capped it).
   */
  protected readonly discountLines = computed(() =>
    this.bill().lines.map((line) => {
      const title = this.discountTitle(line.discount);
      const value = this.valueLabel(line.discount.value);
      const took = `−${this.moneyLabel(line.amount)}`;
      const glyph: UiIconName =
        line.discount.source === 'manual'
          ? line.discount.value.kind === 'percent_off'
            ? 'promo.percent'
            : 'promo.sum'
          : 'promo.coupon';
      const code = line.discount.source === 'code' ? line.discount.code : null;
      const detail = took === value ? null : took;
      return {
        key: line.key,
        source: line.discount.source,
        testId: `staff-visit-discount-${line.key}`,
        title,
        code,
        glyph,
        value,
        detail,
        /** The ticket's spoken name: «Първо посещение, FIRST10, −10%, −2,80 €». */
        name: [title, code, value, detail]
          .filter((part): part is string => part !== null)
          .join(', '),
      };
    }),
  );

  /**
   * The tickets are unfolded under the «Приложени» row. Linked to whether
   * there is anything to unfold: the last «Премахни» folds the row, and a
   * line applied later finds it folded — it opens on the tap, never on
   * its own.
   */
  protected readonly linesOpen = linkedSignal<boolean, boolean>({
    source: () => this.linesRowValue().applied,
    computation: (applied, previous) => applied && (previous?.value ?? false),
  });

  protected toggleLines(): void {
    this.linesOpen.update((open) => !open);
  }

  /**
   * The receipt's voucher lines, tickets too: each covers what the
   * discounts and the vouchers before it left, never more than it has —
   * what it covers is its figure, what it still holds its chip.
   */
  protected readonly voucherLines = computed(() => {
    let due = this.bill().total ?? 0;
    return this.draft().vouchers.map((voucher) => {
      const cover = Math.max(0, Math.min(voucher.availableMinorUnits, due));
      due -= cover;
      const amountLabel = `−${this.moneyLabel(cover)}`;
      const left = this.rawCopy('staff.visit.voucherLeft').replace(
        '{{amount}}',
        this.moneyLabel(voucher.availableMinorUnits - cover),
      );
      return {
        voucher,
        cover,
        testId: `staff-visit-voucher-${voucher.voucherId}`,
        amountLabel,
        /** What the voucher still holds — the ticket's chip. */
        left,
        name: [
          this.rawCopy('staff.visit.voucher'),
          voucher.code,
          amountLabel,
          left,
        ].join(', '),
      };
    });
  });

  private readonly voucherTotal = computed(() =>
    this.voucherLines().reduce((sum, line) => sum + line.cover, 0),
  );

  /** Minor units → `2,80 €`, or `''` for anything that is not money. */
  private moneyLabel(minor: number): string {
    const money = Money.fromMinorUnitsAndCode(Math.max(0, minor), MONEY_CODE);
    return money.isFailure()
      ? ''
      : formatMoney(money.value, this.transloco.getActiveLang());
  }

  /** What a value does, as a word: `−10%`, `−5,00 €`, «Безплатно». */
  private valueLabel(value: VisitEditorDiscountValue): string {
    switch (value.kind) {
      case 'percent_off':
        return `−${value.percent}%`;
      case 'fixed_amount':
        return `−${this.moneyLabel(value.amountMinorUnits)}`;
      case 'free_service':
        return this.rawCopy('staff.visit.discountFree');
    }
  }

  /** The line's title: the coupon's name, or the row's own word for a manual figure. */
  private discountTitle(discount: VisitEditorDiscount): string {
    return discount.source === 'manual'
      ? this.rawCopy('staff.visit.discount')
      : discount.label;
  }

  /** The client's coupons not yet on the bill — the grant kind's rows, and the row's whisper. */
  protected readonly grantChoices = computed<readonly OfferChoice[]>(() => {
    const onBill = new Set(
      this.draft()
        .discounts.filter((discount) => discount.source === 'grant')
        .map((discount) => discount.grantId),
    );
    return this.uiGrants().map((grant) => {
      const applied = onBill.has(grant.grantId);
      return {
        kind: 'grant',
        id: grant.grantId,
        key: `grant:${grant.grantId}`,
        testId: `staff-visit-discount-grant-${grant.grantId}`,
        code: null,
        label: grant.label,
        exclusive: grant.exclusive,
        value: this.valueLabel(grant.value),
        // The card's chip: whether it stacks, in words.
        line: this.rawCopy(
          grant.exclusive ? 'staff.visit.alone' : 'staff.visit.stacks',
        ),
        applied,
        blocked: this.offerBlocked(grant.exclusive, applied),
      };
    });
  });

  /**
   * THE ADD ROW'S WHISPER: while nothing is on the bill, the coupon the
   * client holds, so the promise the shop made is read without opening
   * anything (recognition over recall). Once a line stands, nothing — the
   * lines above the row say what is on the bill.
   */
  protected readonly discountWhisper = computed<string | null>(() => {
    if (this.discountLines().length > 0 || this.voucherLines().length > 0) {
      return null;
    }
    const grant = this.grantChoices().find((choice) => !choice.applied);
    return grant === undefined
      ? null
      : this.rawCopy('staff.visit.discountHasGrant').replace(
          '{{label}}',
          grant.label,
        );
  });

  /** The add row's spoken name: «Добави отстъпка», and the coupon it whispers. */
  /**
   * THE ROW'S VALUE (owner, 2026-09-17: "in the main sheet they should live
   * only minimal on the row"): «Няма»; one line — its code, its name, or a
   * figure's rule — with what it took off in brackets; more — how many,
   * with what they took off together. A voucher counts among them: it is a
   * line on the bill, and the page holds its ticket with the rest.
   */
  protected readonly discountRowValue = computed(() =>
    this.discountSummary((count) =>
      this.transloco.translate('staff.visit.discountApplied', { count }),
    ),
  );

  /**
   * THE PAGE'S OWN ROW (owner, 2026-09-17, later still: "if you switch the
   * type there is no indication that some discounts are applied — only
   * the bottom price — and no way to jump and see all applied"; then: "if
   * shown expanded I expect the coupon card, not just list rows"): each
   * door shows only its own offers, so the page keeps ONE row above «Вид»
   * — «Приложени» — that reads the whole bill whatever kind is in force,
   * and unfolds, on the tap and never on its own, THE TICKETS: every line
   * on the bill as the coupon card it is, «Премахни» on each, the
   * vouchers after — the one place the applied lines live (an offer's
   * card is only ever stamped in its frame). Always there — «Няма»,
   * asleep, on a clean bill — so a new line changes its text and moves
   * nothing. It says "2 отстъпки" where the root row says "2 приложени":
   * the label already says applied.
   */
  protected readonly linesRowValue = computed(() =>
    this.discountSummary((count) =>
      this.transloco.translate('staff.visit.discountCount', { count }),
    ),
  );

  private discountSummary(many: (count: number) => string): {
    label: string;
    applied: boolean;
  } {
    const lines = this.discountLines();
    const vouchers = this.voucherLines();
    const count = lines.length + vouchers.length;
    if (count === 0) {
      return {
        label: this.rawCopy('staff.visit.discountNone'),
        applied: false,
      };
    }
    const took =
      this.bill().lines.reduce((sum, line) => sum + line.amount, 0) +
      vouchers.reduce((sum, line) => sum + line.cover, 0);
    const amount = this.moneyLabel(took);
    if (count === 1) {
      const line = lines[0];
      const name =
        line !== undefined
          ? (line.code ??
            (line.glyph === 'promo.coupon' ? line.title : line.value))
          : (vouchers[0]?.voucher.code ?? '');
      return { label: `${name} (${amount})`, applied: true };
    }
    return { label: `${many(count)} (${amount})`, applied: true };
  }

  /** The row's spoken name: «Отстъпка: Няма», «Отстъпка: FIRST10 (2,80 €)» — and the coupon whispered, when one is. */
  protected readonly discountRowName = computed(() => {
    const note = this.discountWhisper();
    return `${this.rawCopy('staff.visit.discount')}: ${this.discountRowValue().label}${note ? `, ${note}` : ''}`;
  });

  /**
   * THE DOCK'S FIGURE: what still changes hands at the counter — the saved
   * subtotal, less what the drafted discounts take off, less what the
   * drafted vouchers pay. The subtotal is the VM owner's (the legs' figures
   * are labels, not a sum); the bill is the one live term, because this
   * sheet is where it is chosen.
   */
  protected readonly dockTotalLabel = computed(() => {
    if (this.isNew()) return this.catalogueTotalLabel() ?? '—';
    const saved = this.vm().priceLabel ?? '—';
    const due = this.dockDue();
    return due === null ? saved : this.moneyLabel(due) || saved;
  });

  /** What is due on the dock's bill: its total, less what the vouchers would cover of it. */
  private readonly dockDue = computed<number | null>(() => {
    const total = this.dockBill().total;
    if (total === null) return null;
    let due = total;
    for (const voucher of this.draft().vouchers) {
      due -= Math.max(0, Math.min(voucher.availableMinorUnits, due));
    }
    return Math.max(0, due);
  });

  /**
   * THE PRICE AS IT WAS, struck through beside what is due once something
   * has come off it — the sale tag's own grammar (Grab's «Rp500.000»
   * struck over «Rp425.000», Depop's new price beside the old): the one
   * line that says what a discount did, or would do, without a word.
   */
  protected readonly dockWasLabel = computed<string | null>(() => {
    const subtotal = this.subtotalMoney()?.toMinorUnits() ?? null;
    const due = this.dockDue();
    if (subtotal === null || due === null || due >= subtotal) return null;
    return this.moneyLabel(subtotal);
  });

  protected applyGrant(grantId: string): void {
    const grant = this.uiGrants().find((entry) => entry.grantId === grantId);
    if (grant === undefined) return;
    this.addDiscount({
      source: 'grant',
      label: grant.label,
      value: grant.value,
      grantId: grant.grantId,
      code: null,
      exclusive: grant.exclusive,
    });
  }

  /**
   * A discount joins the bill — or REPLACES it. An exclusive coupon must be
   * alone, so picking one takes the others off; and one already on the bill
   * that is exclusive gives way to whatever is picked next. A manual figure
   * replaces the manual figure before it: the counter corrects, it does not
   * pile up. The same promise twice is a no-op.
   */
  private addDiscount(discount: VisitEditorDiscount): void {
    this.settleCode();
    this.draft.update((draft) => {
      if (draft.discounts.some((entry) => samePromise(entry, discount))) {
        return draft;
      }
      const keeps = draft.discounts.filter(
        (entry) =>
          !entry.exclusive &&
          !(entry.source === 'manual' && discount.source === 'manual'),
      );
      return {
        ...draft,
        discounts: discount.exclusive ? [discount] : [...keeps, discount],
      };
    });
  }

  private addVoucher(voucher: VisitEditorVoucher): void {
    this.settleCode();
    this.draft.update((draft) =>
      draft.vouchers.some((entry) => entry.voucherId === voucher.voucherId)
        ? draft
        : { ...draft, vouchers: [...draft.vouchers, voucher] },
    );
  }

  /** The swipe's act — one line off the bill. */
  protected removeDiscount(key: string): void {
    this.draft.update((draft) => ({
      ...draft,
      discounts: draft.discounts.filter(
        (discount) => discountKey(discount) !== key,
      ),
    }));
  }

  protected removeVoucher(voucherId: string): void {
    this.draft.update((draft) => ({
      ...draft,
      vouchers: draft.vouchers.filter(
        (voucher) => voucher.voucherId !== voucherId,
      ),
    }));
  }

  /**
   * A typed code → a question to the owner, never an answer here.
   *
   * Normalised the way the catalogue stores codes (trimmed, upper-case), so
   * `first10` and `FIRST10` are one code. A code already on the bill — as a
   * discount or a voucher — is not asked about again; the answer arrives
   * through `uiPromoCode` and `adoptCode` does the rest.
   */
  protected commitCode(raw: string): void {
    const code = raw.trim().toUpperCase();
    if (code.length === 0) {
      this.settleCode();
      return;
    }
    const draft = this.draft();
    const onBill =
      draft.discounts.some((discount) => discount.code === code) ||
      draft.vouchers.some((voucher) => voucher.code === code);
    if (onBill) {
      this.pendingCode.set(code);
      this.codeState.set('already');
      return;
    }
    this.pendingCode.set(code);
    this.codeState.set('checking');
    this.promoCodeEntered.emit(code);
  }

  /**
   * The owner's answer, taken only for the code still being asked about — a
   * slow answer to an earlier code cannot land on a later one. A coupon or
   * a voucher joins the bill — its ticket at the top of the page — and the
   * field empties for the next; a miss leaves the field with its refusal
   * under it, and the code where it was typed.
   */
  protected readonly adoptCode = effect(() => {
    const answer = this.uiPromoCode();
    untracked(() => {
      const pending = this.pendingCode();
      if (answer === null || pending === null) return;
      if (answer.code.trim().toUpperCase() !== pending) return;
      if (answer.promo !== null) {
        this.addDiscount({
          source: 'code',
          label: answer.promo.label,
          value: answer.promo.value,
          grantId: null,
          code: pending,
          exclusive: answer.promo.exclusive,
        });
        this.codeDraft.set('');
        return;
      }
      if (answer.voucher !== null) {
        if (answer.refusal !== null) {
          this.codeState.set(answer.refusal);
          return;
        }
        // Nothing left for it to cover: the bill is already paid.
        const due = (this.bill().total ?? 0) - this.voucherTotal();
        if (due <= 0) {
          this.codeState.set('nothingLeft');
          return;
        }
        this.addVoucher(answer.voucher);
        this.codeDraft.set('');
        return;
      }
      this.codeState.set('unknown');
    });
  });

  /** The code field, at rest: nothing pending, nothing said. */
  private settleCode(): void {
    this.pendingCode.set(null);
    this.codeState.set('idle');
  }

  protected openNote(): void {
    this.noteOpen.set(true);
    this.focusLater('[data-testid="staff-visit-note-field"]');
  }

  protected commitNote(value: string): void {
    const trimmed = value.trim();
    this.draft.update((draft) => ({ ...draft, note: trimmed || null }));
  }

  /**
   * Publish the whole draft.
   *
   * ⚠ It does NOT close the sheet. The write is a round trip that can be
   * refused — an overlap, a stale revision — and a sheet that dismissed
   * itself on the tap would take the draft with it and leave the barber with
   * a toast about a booking they can no longer see. The owner closes it when
   * the server has actually agreed.
   */
  /** Creating, rather than editing something that exists. */
  protected readonly isNew = computed(() => this.vm().appointmentId === '');

  protected legClientLabel(leg: DraftLeg): string {
    return (
      this.draft().clients.find((client) => client.id === leg.clientId)
        ?.label ?? ''
    );
  }

  /** The leg page's `За кого`: move a service to another person. */
  /** The visit's people, as choice-menu options for a leg's «За кого». */
  protected readonly legClientOptions = computed<readonly UiChoiceOption[]>(
    () =>
      this.draft().clients.map((client) => ({
        id: client.id,
        label: client.label,
        testId: `staff-visit-leg-client-${client.id}`,
      })),
  );

  /**
   * THE ROSTER as choice-menu options — one list for the chair row and a
   * leg's barber row, both `ui-choice-menu` now (owner, 2026-09-09). The
   * legend swatch rides the projected leading rail, keyed by `barberToneOf`.
   */
  protected readonly barberChoices = computed<readonly UiChoiceOption[]>(() =>
    this.barberOptions().map((barber) => ({
      id: barber.id,
      label: barber.name,
      avatarSrc: barber.avatarSrc ?? null,
      testId: `staff-visit-barber-pick-${barber.id}`,
    })),
  );

  protected barberToneOf(id: string): number {
    return this.barberOptions().find((barber) => barber.id === id)?.tone ?? 0;
  }

  protected pickChairBarber(fromId: string, id: string): void {
    const barber = this.barberOptions().find((option) => option.id === id);
    if (barber) this.pickBarberFor(fromId, barber);
  }

  protected setLegClient(seatId: string, clientId: string): void {
    this.legMenu.set(null);
    const seats = this.seatsOf(seatId);
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        seats.has(leg.seatId) ? { ...leg, clientId } : leg,
      ),
    }));
  }

  /**
   * THE FIRST PERSON WITHOUT A SERVICE, or `null`. A person without a
   * service is nothing in this model — a seat IS a service for a person —
   * so a party saves only once everyone has one, and this is who the
   * catalogue opens for next.
   */
  protected readonly unserved = computed<DraftClient | null>(() => {
    const draft = this.draft();
    // A lone person is served by whatever legs there are (a stored visit's
    // legs name them) — unless there are none at all: the first person on
    // a new visit is exactly who the catalogue must open for (found in
    // review).
    if (draft.clients.length <= 1 && draft.legs.length > 0) return null;
    return (
      draft.clients.find(
        (client) => !draft.legs.some((leg) => leg.clientId === client.id),
      ) ?? null
    );
  });

  protected readonly everyoneServed = computed(() => this.unserved() === null);

  /**
   * Whether `Запази` has anything it can do. A new visit needs at least one
   * service before it is a visit at all; an existing one needs a change.
   */
  protected readonly saveable = computed(
    () =>
      this.everyoneServed() &&
      // A visit is its seats: with none left there is nothing to write —
      // the dock asks for a service, and calling it off is an exit's.
      this.draft().legs.length > 0 &&
      (this.isNew() || this.dirty()),
  );

  /**
   * THE WITHHELD «Запази» SAYS WHY AND TAKES YOU THERE (2026-09-18, the
   * order review): a party client with no service used to make the save
   * vanish from the dock while the reason sat 600 px above. The slot then
   * offers «Избери услуга» — enabled, never the disabled dress — and a tap
   * lands the services' add row under the thumb and in focus.
   */
  protected readonly serviceWanted = computed(
    // Dirty or not (owner, 2026-09-24): a person just added is not a
    // change the save can carry, so the draft stayed clean, the dock stayed
    // empty and the only word about it sat 600 px up the ladder.
    () =>
      !this.gone() &&
      (!this.everyoneServed() ||
        // A saved visit whose every service was removed.
        (!this.isNew() && this.draft().legs.length === 0)),
  );

  /** The dock's «Избери услуга»: the catalogue, for the person without one. */
  protected goToServices(): void {
    // For whoever has none; with everyone served (a visit whose services
    // were all removed) the catalogue opens as the add row opens it.
    this.openServicePage(this.unserved()?.id ?? null);
  }

  /**
   * THE PARTY'S NEXT QUESTION (owner, 2026-09-24: "the auto-push flow").
   * Whoever on the visit has no service yet gets the catalogue pushed FOR
   * them — after the add-client page's ✓, after a new client is saved,
   * and again after their picks are seated while somebody is still
   * waiting — so the flow is pick person, pick cut, «Запази». Nothing to
   * do when everyone is served.
   */
  private serveNext(): void {
    const next = this.unserved();
    if (next !== null) this.openServicePage(next.id);
  }

  /** «За Мартин» under the catalogue's title, when the page is for someone. */
  protected readonly serviceFor = computed<string | null>(() => {
    const page = this.page();
    if (page?.kind !== 'service' || page.subjectId === null) return null;
    return (
      this.draft().clients.find((client) => client.id === page.subjectId)
        ?.label ?? null
    );
  });

  /**
   * WHAT A NEW VISIT WILL COST, BY THE CATALOGUE (2026-09-18): the drafted
   * legs' catalogue prices summed, so the desk can answer «колко?» on the
   * phone before the first save. The server's figure replaces it once the
   * visit exists; «По каталог» says so meanwhile. `null` while a leg's
   * price is unknown («по договорка») or nothing is drafted.
   */
  protected readonly catalogueTotalLabel = computed<string | null>(() => {
    if (!this.isNew()) return null;
    const legs = this.draft().legs;
    if (legs.length === 0) return null;
    let sum = 0;
    for (const leg of legs) {
      const minor =
        leg.priceMinorUnits ??
        (leg.priceLabel === null ? null : parsePriceInput(leg.priceLabel));
      if (minor === null) return null;
      sum += minor;
    }
    return this.moneyLabel(sum) || null;
  });

  /** What «Запази» last published — what the saved mark's adoption waits for. */
  private savedCommit: VisitEditorCommit | null = null;

  protected save(): void {
    if (!this.saveable()) return;
    const commit = commitOf(this.draft(), this.endMinute());
    this.savedCommit = commit;
    this.committed.emit(commit);
  }

  protected discard(): void {
    this.draft.set(seedDraft(this.vm()));
    this.durationTouched.set(false);
    this.noteOpen.set(false);
    this.page.set(null);
    this.resetDiscountEntry();
    this.servicePicks.set(new Map());
    this.tipOpen.set(false);
    this.tipOtherOpen.set(false);
    this.shopOpen.set(false);
  }

  /* ── Small template helpers ────────────────────────────────────────── */

  /**
   * Step the draft a day either way — Outlook's calendar bar, and the reason
   * the month grid is a jump rather than the only route.
   *
   * `relativeDay` walks from the APPOINTMENT's day, not the draft's, so this
   * steps from wherever the draft already is instead of snapping back.
   */
  protected stepDay(offset: number): void {
    const [year, month, day] = this.draft().dayKey.split('-').map(Number);
    const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
    at.setUTCDate(at.getUTCDate() + offset);
    this.pickDay(at.toISOString().slice(0, 10));
  }

  /**
   * The one date every shop names out loud.
   *
   * ⚠ The SHOP's today off the VM, not the device's. `new Date()` here read
   * the browser's clock, which is a different day from the shop's for any
   * counter open across midnight in another zone — the same trap
   * `StaffDayStore` documents for its own `todayKey`.
   */
  protected goToday(): void {
    this.pickDay(this.vm().todayKey);
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    // A Return that was waiting for the index answered an OLDER question.
    this.enterPending.set(false);
    // The client list is a search the OWNER runs (a prefix index, not a
    // local filter), so the query has to leave this component.
    if (this.page()?.kind === 'clientSearch') this.clientQuery.emit(value);
  }

  /** The locale the shared picker writes its month and weekday row in. */
  protected readonly locale = computed(() => this.transloco.getActiveLang());

  /**
   * `Днес` / `Утре` — most re-datings are one or two days, and aiming at a
   * cell for that is the wrong amount of work. The picker resolves the
   * offsets against `uiToday`, so these cannot drift from the shop's own
   * today the way a locally-computed date could.
   */
  protected readonly dayRelatives = computed(() => [
    { offset: 0, label: this.rawCopy('staff.visit.today') },
    { offset: 1, label: this.rawCopy('staff.visit.tomorrow') },
  ]);

  protected readonly snapMinutes = GRAIN_MINUTES;
}

/** The shop's one currency (see `project_currency_is_eur`). */
const MONEY_CODE = 'EUR';

/**
 * The evaluator orders discounts by the instant they were applied, as its
 * last tie-break; a draft has no clock, so the order of ADDING stands in —
 * one millisecond apart from the epoch, deterministic and never read back.
 */
function instantAt(index: number): ZonedDateTime {
  const instant = ZonedDateTime.fromMillis(index, 'UTC');
  if (instant.isFailure()) throw new Error('unreachable: the UTC epoch');
  return instant.value;
}

/** A line's identity on the ladder — the promise, never a stored id. */
function discountKey(discount: VisitEditorDiscount): string {
  switch (discount.source) {
    case 'grant':
      return `grant:${discount.grantId ?? ''}`;
    case 'code':
      return `code:${discount.code ?? ''}`;
    case 'manual':
      return 'manual';
  }
}

/** The same promise: source and provenance agree (a manual figure by its value). */
function samePromise(a: VisitEditorDiscount, b: VisitEditorDiscount): boolean {
  if (a.source !== b.source) return false;
  if (a.source === 'manual') {
    return JSON.stringify(a.value) === JSON.stringify(b.value);
  }
  return a.grantId === b.grantId && a.code === b.code;
}

/** The tip shares on offer (owner, 2026-09-10) — the till's own trio. */
/**
 * THE TIP'S PRESETS ARE CASH (2026-09-16, after a Mobbin sweep of Lyft, Uber
 * Eats, Grab, Bolt, Freenow, Wonder, Keeta, Gojek, Deliveroo, Blank Street):
 * amounts on a small ticket, «round up» as one option among them, and the
 * custom sum as a SELECTABLE option in the same set. Round-ups mirror the
 * counter — the client hands a note and says keep it — so the targets are
 * the sums a hand actually holds: the next whole euro, the next 5, the next
 * 10; then the coins on top of an exact payment: 1, 2, 5, 10 €.
 */
/** A round-up target is offered only while its tip stays within this share of the bill. */
const TIP_ROUND_UP_MAX_SHARE = 0.4;
/** A round-up smaller than this is not worth a tile. */
const TIP_ROUND_UP_MIN_MINOR = 20;
/**
 * The coins on top of an exact payment, and the share of the bill a coin
 * must fall in to be offered. THREE are offered — with «Без» they fill a
 * row of the four-column bento, or the two cells beside a large tile and
 * the two beneath them.
 */
const TIP_FIXED_MINOR: readonly number[] = [100, 200, 500, 1000, 2000];
const TIP_FIXED_MIN_SHARE = 0.03;
const TIP_FIXED_MAX_SHARE = 0.5;
const TIP_FIXED_SLOTS = 3;
/** The bento is four cells across: two large round-ups side by side, four regular tiles a row. */
const TIP_TILE_COLUMNS = 4;

/**
 * Typed money → minor units, or `null` for anything that is not money.
 *
 * Takes what a phone keypad and a formatted label both produce: `18`,
 * `18,5`, `18.50`, `1.234,50`, `28,00 €`. The LAST separator is the decimal
 * one and may carry at most two digits; every other separator groups
 * thousands. Currency signs, spaces and letters are noise. Negative money
 * does not exist here, and neither does an empty answer.
 */
export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (cleaned === '') return null;
  const last = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const major =
    last === -1 ? cleaned : cleaned.slice(0, last).replace(/[.,]/g, '');
  const minor = last === -1 ? '' : cleaned.slice(last + 1);
  if (!/^\d*$/.test(major) || !/^\d{0,2}$/.test(minor)) return null;
  if (major === '' && minor === '') return null;
  const cents = Number(major || '0') * 100 + Number((minor + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
