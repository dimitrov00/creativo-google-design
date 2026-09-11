import { SwipeToDeleteDirective } from '../swipe-to-delete/swipe-to-delete.directive';
import { StaffDayPill, formatDayPill } from '../day-pill/staff-day-pill';
import {
  looksLikePhone,
  normalizeSearchQuery,
} from '@creativo/application/governance';
import type { CountryIso2 } from '@creativo/application/identity';
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
  UiChoiceLeading,
  UiChoiceMenu,
  type UiChoiceOption,
  UiPhoneField,
  UiAvatar,
  UiBadge,
  UiButton,
  UiIcon,
  type UiIconName,
  UiTextField,
  UiTimeField,
  UiUnitField,
} from '@creativo/ui/controls';
import { catalogMinutesOf, minutesDeltaLabel } from '../shared/catalog-delta';
import { FrameFullscreen } from '../shared/frame-fullscreen';
import { UiStack } from '@creativo/ui/layout';
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
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiSheetActionBar,
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

/** A finished drag, named by the gesture the barber actually performed. */
export type VisitEditorCommit =
  | { readonly kind: 'move'; readonly startMinute: number }
  | {
      readonly kind: 'resize';
      readonly edge: 'start' | 'end';
      readonly startMinute: number;
      readonly endMinute: number;
    }
  /**
   * `Запази` — the whole draft, as ONE intent.
   *
   * A gesture publishes what it just did; a save publishes what the sheet
   * now says, and the owner works out the difference from the appointment it
   * handed in. That split is deliberate: this component knows what a barber
   * typed, and only the parent knows which seats it belongs to, which zone
   * the day is in and which of the changes the server has a command for.
   */
  | {
      readonly kind: 'save';
      readonly dayKey: string;
      readonly startMinute: number;
      readonly endMinute: number;
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

/** One person for the pushed add-client page. */
export interface VisitEditorClientOption {
  readonly id: string;
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly meta: string | null;
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
  readonly legs: readonly DraftLeg[];
  readonly clients: readonly DraftClient[];
  /** The STAFF note. The client's is on the VM and is never merged with it. */
  readonly note: string | null;
  /** The discounts as drafted, in the order added. Empty is full price. */
  readonly discounts: readonly VisitEditorDiscount[];
  /** The vouchers as drafted, in cover order. */
  readonly vouchers: readonly VisitEditorVoucher[];
}

/** Which page is presented on top of the ladder. Depth is exactly one. */
type EditorPageKind = 'client' | 'clientSearch' | 'clientNew';

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
 * A typed number as E.164, by the shop's own conventions: `+…` as is,
 * `00…` international, `0…` a Bulgarian national number. The phone field
 * validates for real; this only puts the digits in front of it.
 */
function guessE164(typed: string): string | null {
  const digits = typed.replace(/\D/g, '');
  if (digits.length < 5) return null;
  if (typed.trim().startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+359${digits.slice(1)}`;
  return `+${digits}`;
}
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
    legs,
    clients,
    note: vm.teamNote,
    discounts: vm.discounts,
    vouchers: vm.vouchers,
  };
}

/**
 * THE VISIT EDITOR — one sheet, one draft, one commit boundary.
 *
 * ### The shape, in one paragraph
 * A `ui-modal-sheet` with a static title (`Час`), a pinned summary strip that
 * never scrolls away, and a ladder that runs **day → picture → clock**: the
 * `Ден` row whose calendar expands as the next segment of its own list group,
 * a 100-minute close-up of the chair's day, then `Начало` and `Времетраене` —
 * the two facts a barber actually authors, from which the end time is
 * computed and stored nowhere. Below that: services, clients, money, notes,
 * each a chromeless `ui-list-group` with no eyebrow over it.
 *
 * ### One navigation stack, depth exactly one
 * A row that owns SEVERAL values travels (`›`); a value with a spatial editor
 * of its own expands in place (`⌄`). The service, the two searches and the
 * promo are pages inside THIS sheet — one scrim, one focus trap, one commit —
 * not sheets on top of a sheet. `‹` pops, Escape pops the child and only
 * closes at root, and there is no `Готово` on a child: the HIG's own reason
 * is that a second commit-shaped control is the one people mistake for the
 * dismiss.
 *
 * ### Nothing here reaches the server
 * `staffEditAppointment` does not exist. Every edit mutates the local draft
 * and the dock says so in a sentence rather than offering a `Запази` that
 * cannot save — the same construction R8 specifies for offline, and for the
 * same reason: a disabled promise is worse than an honest refusal.
 *
 * ### Two DS gaps, named rather than worked around
 * `ui-modal-sheet` has no `[sheet-action]` slot and `ui-sheet-header` has no
 * `[uiLeading]` slot, so the `⋯` and the child page's `‹` ride at the two
 * ends of the PINNED `[sheet-accessory]` strip instead of in the header bar.
 * They stay in the sticky chrome, which is the property that mattered; when
 * the two slots land, both controls move up one row and nothing else changes.
 * The shell's own `✕` keeps its place and POPS while a child is presented —
 * it is labelled `Назад` there, so it announces as what it does.
 */
@Component({
  selector: 'lib-staff-visit-editor',
  imports: [
    SwipeToDeleteDirective,
    StaffTimeGrid,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiChoiceLeading,
    UiChoiceMenu,
    StaffDayPill,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiMaterialDirective,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiPhoneField,
    UiRadiusDirective,
    UiSheetActionBar,
    UiStack,
    UiTextDirective,
    UiTextField,
    UiTimeField,
    UiUnitField,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
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
   * WHO MAY REPRICE — the owner's answer from the session's roles. A barber
   * may stretch his own time; he may not discount the shop's money. The
   * ladder's price pill is ABSENT for him, not disabled: the figure stays
   * on the line as text, and an absent control needs no apology.
   */
  readonly uiMayReprice = input(false);
  /**
   * May this user INVENT a discount — the manual amount and percent arms of
   * the discount menu. The front desk and the owners; a barber may still
   * honour a coupon the client holds or a code the shop published, which is
   * not gated here (see `handlesMoney` in the accounts domain).
   */
  readonly uiMayDiscount = input(false);
  /** The coupons this visit's client already holds — the menu's own picks. */
  readonly uiGrants = input<readonly VisitEditorGrantOption[]>([]);
  /** The owner's answer to `promoCodeEntered` — see `VisitEditorCodeResult`. */
  readonly uiPromoCode = input<VisitEditorCodeResult | null>(null);

  readonly uiSavedMark = input(0);

  readonly uiFrameDay = input<VisitEditorFrameDay | null>(null);

  readonly uiServices = input<readonly VisitEditorServiceOption[]>([]);
  /** Known people, for the pushed add-client page. */
  readonly uiClients = input<readonly VisitEditorClientOption[]>([]);
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
   * A tip was entered, cleared, or corrected — in MINOR UNITS, `null` to
   * clear.
   *
   * Unlike the rest of this sheet's draft, a tip writes STRAIGHT THROUGH:
   * it is a fact about money that has already changed hands, and the whole
   * reason it is recorded is a running daily total, which a draft nobody
   * commits could never feed.
   */
  readonly tipped = output<number | null>();
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
    // The picker's keys: heard only while its dropdown is open.
    effect(() => {
      const open = this.serviceMenu();
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
      if (seed.startMinute + spanOf(seed) !== untracked(() => this.endMinute()))
        return;

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
    });
  }

  protected readonly dirty = computed(
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
    }
  });

  /** The dock's ✓ on a page — the draft already holds the edits; back to the ladder. */
  protected confirmPage(): void {
    this.pop();
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
   * ⚠ NOT filtered by `query()`. The quick-add menu renders this and the
   * pushed search page renders `serviceResults`, which is this list with the
   * query applied — so a query typed on the page, which outlives the page's
   * own dismissal, cannot silently shorten the menu the next time it opens.
   */
  protected readonly serviceOptions = computed(() => this.uiServices());

  protected readonly serviceResults = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('bg');
    return this.serviceOptions().filter((service) =>
      service.label.toLocaleLowerCase('bg').includes(query),
    );
  });

  protected readonly clientResults = computed(() => {
    // Name, number or mail (owner, 2026-09-09) — the server already searched
    // by all three; this keeps a stale result list honest as the query
    // moves on. A number is compared as digits.
    const query = normalizeSearchQuery(this.query());
    const chosen = new Set(this.draft().clients.map((client) => client.id));
    return this.uiClients()
      .filter(
        (client) =>
          client.label.toLocaleLowerCase('bg').includes(query) ||
          (client.phone ?? '').replace(/\D/g, '').includes(query) ||
          (client.meta ?? '').toLocaleLowerCase('bg').includes(query),
      )
      .map((client) => ({ ...client, selected: chosen.has(client.id) }));
  });

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
      out.push({
        id: 'cancel',
        label: this.rawCopy('staff.visit.cancelVisit'),
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

  protected clientLine(client: DraftClient): string {
    return [client.phone, client.meta].filter(Boolean).join(' · ');
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
    this.page.set({ kind, subjectId, originTestId });
    this.host.nativeElement.scrollTop = 0;
    // Focus lands on the page CONTAINER, not on its first control, so a
    // price field cannot steal the keyboard on entry.
    this.focusLater('.staff-visit__page');
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
   * The gesture ended. THIS is the write.
   *
   * `kind` cannot be re-derived from the numbers — a move that happens to land
   * on a legal duration is arithmetically identical to two resizes, and the
   * server command differs by which one the barber actually performed.
   */
  protected onFrameCommit(commit: GridCommit): void {
    this.onFrameDraft(commit);
    this.committed.emit(
      commit.kind === 'move'
        ? { kind: 'move', startMinute: commit.startMinute }
        : {
            kind: 'resize',
            // A move fixes the start; a resize reports whichever edge left
            // the appointment's own interval.
            edge:
              commit.startMinute !== this.vm().startMinute ? 'start' : 'end',
            startMinute: commit.startMinute,
            endMinute: commit.endMinute,
          },
    );
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
   * A price typed on the ladder's pill (owner, 2026-09-10: money is edited
   * where the figure already is, not on a page). Accepts what a keypad
   * produces — `18`, `18,5`, `18.50`, even the formatted `18,00 €` handed
   * back — and writes the SAME number twice: formatted onto the line, and
   * in minor units for the save. Anything that is not money springs the
   * field back to what the row says, the tip's own rule. The whole row —
   * every seat it folds — takes the price.
   */
  protected setLegPrice(seatId: string, raw: string): void {
    const minor = parsePriceInput(raw);
    const money =
      minor === null ? null : Money.fromMinorUnitsAndCode(minor, MONEY_CODE);
    // Not money: the unit field springs back to the figure it was given.
    if (minor === null || money === null || money.isFailure()) return;
    const label = formatMoney(money.value, this.transloco.getActiveLang());
    const seats = this.seatsOf(seatId);
    this.draft.update((draft) => ({
      ...draft,
      legs: draft.legs.map((leg) =>
        seats.has(leg.seatId)
          ? { ...leg, priceLabel: label, priceMinorUnits: minor }
          : leg,
      ),
    }));
  }

  /** A seat's price as the field's figure — `18,00`, no unit; empty when unknown. */
  protected priceFigure(leg: DraftLeg): string {
    const minor =
      leg.priceMinorUnits ??
      (leg.priceLabel === null ? null : parsePriceInput(leg.priceLabel));
    return minor === null ? '' : this.figureOf(minor);
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

  /**
   * EVERY line is editable for whoever may reprice (owner, 2026-09-10:
   * "why only the first service price could be changed?") — a seat added
   * in this draft too: its `addSeat` carries the catalogue's terms and a
   * `reprice` for the minted id follows it in the same batch. Only a visit
   * that does not exist yet keeps its figures as text: a booking is priced
   * by the server when it is made.
   */
  protected showsPricePill(leg: DraftLeg): boolean {
    void leg;
    return this.uiMayReprice() && !this.isNew();
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

  /**
   * The dropdown's row — ONE TAP AND HIDE (owner, 2026-09-10: "like the
   * country code dropdown — no check, no page"): the service is seated and
   * the menu closes. Tapping a service the visit already has seats it
   * again: one more row on the ladder, marked ×2 here next time.
   */
  protected quickAdd(option: VisitEditorServiceOption): void {
    this.addServiceLeg(option);
    this.serviceMenu.set(false);
  }

  /** Seats minted by this sheet, so two picks in one tick differ. */
  private minted = 0;

  protected readonly serviceMenu = signal(false);

  /**
   * THE ONE DOOR to the catalogue (owner, 2026-09-10): the dropdown on the
   * row. Opens on the whole list every time — a query typed the last time
   * must not shorten this one before a letter is typed.
   */
  protected openServiceMenu(): void {
    this.query.set('');
    this.serviceMenu.set(true);
  }

  /**
   * TYPE TO SEARCH, from anywhere. While the dropdown is open, a printable
   * key pressed with focus outside an editable control lands in the search
   * field — heard at the DOCUMENT, because where focus sits after the tap
   * is not ours to know: a mouse leaves it on the trigger, Safari leaves
   * it on the sheet, and the menu's own first-row focus may or may not
   * have taken. The character is written by hand, since a focus moved
   * mid-keystroke does not reliably receive it.
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
  private addServiceLeg(option: VisitEditorServiceOption): void {
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
            // The first person's, until the leg page says otherwise.
            clientId: draft.clients[0]?.id ?? 'primary',
          },
        ],
      };
    });
  }

  protected toggleClient(option: VisitEditorClientOption): void {
    this.draft.update((draft) => {
      const existing = draft.clients.find((client) => client.id === option.id);
      if (existing) {
        const clients = draft.clients.filter((client) => client !== existing);
        const heir = clients[0]?.id ?? 'primary';
        return {
          ...draft,
          clients,
          // Their services stay on the visit, on the first person left.
          legs: draft.legs.map((leg) =>
            leg.clientId === existing.id ? { ...leg, clientId: heir } : leg,
          ),
        };
      }
      return { ...draft, clients: [...draft.clients, { ...option }] };
    });
  }

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
  protected readonly newClientCountry = signal<CountryIso2 | undefined>(
    'BG' as CountryIso2,
  );
  /** A person needs a name; the number and the mail are welcome. */
  protected readonly newClientReady = computed(
    () => this.newClient().name.trim().length > 0,
  );

  protected openNewClient(): void {
    const typed = this.query().trim();
    this.newClient.set(
      looksLikePhone(typed)
        ? { name: '', phone: guessE164(typed), email: '' }
        : typed.includes('@')
          ? { name: '', phone: null, email: typed }
          : { name: typed, phone: null, email: '' },
    );
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
    this.draft.update((draft) => ({
      ...draft,
      clients: [
        ...draft.clients,
        {
          id: `guest-${draft.clients.length}`,
          label,
          phone,
          phoneHref: phone,
          meta: email.trim() || null,
        },
      ],
    }));
    this.query.set('');
    this.page.set(null);
    this.focusLater('[data-testid="staff-visit-add-client"]');
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
  protected readonly moneyShown = computed(
    () => !this.gone() && (this.draft().legs.length > 0 || this.tipRowShown()),
  );

  /**
   * The shares on offer, each already a figure of THIS visit's total — so
   * the choice can say what it would leave. None when the total is unknown.
   */
  protected readonly tipPresets = computed<
    readonly { percent: number; amount: number; label: string }[]
  >(() => {
    const total = this.vm().priceMinorUnits;
    if (total === null || total <= 0) return [];
    return TIP_PERCENTS.map((percent) => {
      const amount = Math.round((total * percent) / 100);
      const money = Money.fromMinorUnitsAndCode(amount, MONEY_CODE);
      return {
        percent,
        amount,
        label: money.isFailure()
          ? String(amount / 100)
          : formatMoney(money.value, this.transloco.getActiveLang()),
      };
    });
  });

  /**
   * Which choice is on: the recorded tip read back against the shares —
   * nothing recorded is «Няма», a share is its percent, anything else is
   * «Друго», the sum typed in the menu's own field.
   */
  protected readonly tipChoice = computed<'none' | 'other' | number>(() => {
    const recorded = this.vm().tipMinorUnits;
    if (recorded === null) return 'none';
    const hit = this.tipPresets().find((preset) => preset.amount === recorded);
    return hit ? hit.percent : 'other';
  });

  protected readonly tipMenu = signal(false);

  /**
   * The menu's picks: «Няма», then the shares with their figures. «Друго»
   * is not a pick — it is the field in the menu's second group.
   */
  protected readonly tipChoices = computed<readonly UiChoiceOption[]>(() => [
    {
      id: 'none',
      label: this.rawCopy('staff.visit.tipNone'),
      testId: 'staff-visit-tip-pick-none',
    },
    ...this.tipPresets().map((preset) => ({
      id: String(preset.percent),
      label: `${preset.percent}%`,
      detail: preset.label,
      testId: `staff-visit-tip-pick-${preset.percent}`,
    })),
  ]);

  protected readonly tipChoiceId = computed(() => String(this.tipChoice()));

  /** What the value pill says — «Няма», the share, or «Друго». */
  protected readonly tipChoiceLabel = computed(() => {
    if (this.tipChoice() === 'other') {
      return this.rawCopy('staff.visit.tipOther');
    }
    return (
      this.tipChoices().find((choice) => choice.id === this.tipChoiceId())
        ?.label ?? ''
    );
  });

  /** The figure beside it — the share's, or the sum typed for «Друго». */
  protected readonly tipChoiceDetail = computed(() => {
    if (this.tipChoice() === 'other') return this.vm().tipLabel ?? '';
    return (
      this.tipChoices().find((choice) => choice.id === this.tipChoiceId())
        ?.detail ?? ''
    );
  });

  /** The trigger's spoken value: «10%, 2,80 €». */
  protected readonly tipChoiceName = computed(() => {
    const detail = this.tipChoiceDetail();
    const label = this.tipChoiceLabel();
    return detail ? `${label}, ${detail}` : label;
  });

  /** The recorded tip as the field's figure — `5,00`, or empty. */
  protected readonly tipFigure = computed(() => {
    const minor = this.vm().tipMinorUnits;
    return minor === null ? '' : this.figureOf(minor);
  });

  /**
   * The menu's field holds the sum only when the sum IS «Друго» — a share
   * is read back on its own row, and the field shows its placeholder.
   */
  protected readonly tipOtherFigure = computed(() =>
    this.tipChoice() === 'other' ? this.tipFigure() : '',
  );

  protected pickTip(id: string): void {
    if (id === 'none') {
      if (this.vm().tipMinorUnits !== null) this.tipped.emit(null);
      return;
    }
    const preset = this.tipPresets().find(
      (entry) => String(entry.percent) === id,
    );
    if (preset && this.vm().tipMinorUnits !== preset.amount) {
      this.tipped.emit(preset.amount);
    }
  }

  /**
   * A typed tip → minor units, or nothing at all.
   *
   * Accepts what a keypad on a phone actually produces: `5`, `5.50`, and
   * `5,50`, because a Bulgarian keyboard offers a comma and the shop's
   * money is written with one. An empty field CLEARS the tip rather than
   * recording zero — the two are different answers, and clearing is the
   * only way back from a mistyped one. Not money: the unit field springs
   * back to the figure it was given. What was typed is recorded on leaving
   * the field, however the field is left — Enter, a tap elsewhere, the
   * keyboard's Done — and the menu closes behind it.
   */
  protected commitTip(raw: string): void {
    const recorded = this.vm().tipMinorUnits;
    if (raw.trim().length === 0) {
      if (recorded !== null) this.tipped.emit(null);
      this.closeTipMenu();
      return;
    }
    const minor = parsePriceInput(raw);
    if (minor === null) return;
    if (minor !== recorded) this.tipped.emit(minor);
    this.closeTipMenu();
  }

  /**
   * A committed sum closes the menu and hands focus back to the pill —
   * unless a tap elsewhere already closed it, in which case the tap keeps
   * its focus.
   */
  private closeTipMenu(): void {
    if (!this.tipMenu()) return;
    this.tipMenu.set(false);
    this.focusLater('[data-testid="staff-visit-tip-choice"]');
  }

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
   * The add row: on every SAVED visit that still stands and has something
   * to bill. A draft the server has not seen waits for its first save.
   */
  protected readonly discountAddShown = computed(
    () => !this.isNew() && !this.gone() && this.draft().legs.length > 0,
  );

  protected readonly discountMenu = signal(false);

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
  private readonly bill = computed(() => {
    const subtotal = this.subtotalMoney();
    const discounts = this.draft().discounts;
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
  });

  /** The receipt's discount lines: title, the rule beneath, the amount. */
  protected readonly discountLines = computed(() =>
    this.bill().lines.map((line) => ({
      key: line.key,
      title: this.discountTitle(line.discount),
      footnote: this.discountFootnote(line.discount),
      amountLabel: `−${this.moneyLabel(line.amount)}`,
    })),
  );

  /**
   * The receipt's voucher lines: each covers what the discounts and the
   * vouchers before it left, never more than it has.
   */
  protected readonly voucherLines = computed(() => {
    let due = this.bill().total ?? 0;
    return this.draft().vouchers.map((voucher) => {
      const cover = Math.max(0, Math.min(voucher.availableMinorUnits, due));
      due -= cover;
      return {
        voucher,
        cover,
        amountLabel: `−${this.moneyLabel(cover)}`,
        footnote: `${voucher.code} · ${this.rawCopy(
          'staff.visit.voucherLeft',
        ).replace(
          '{{amount}}',
          this.moneyLabel(voucher.availableMinorUnits - cover),
        )}`,
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

  /**
   * The line's footnote — the RULE, where the amount alone would not say
   * it: a percent (its share), a code (what was typed), a free service.
   * A fixed sum's amount is its rule, so nothing.
   */
  private discountFootnote(discount: VisitEditorDiscount): string {
    const rule =
      discount.value.kind === 'fixed_amount'
        ? ''
        : this.valueLabel(discount.value);
    if (discount.source === 'code' && discount.code) {
      return rule ? `${discount.code} · ${rule}` : discount.code;
    }
    return rule;
  }

  /** The menu's picks: the client's coupons not yet on the bill, with their figures. */
  protected readonly discountChoices = computed<readonly UiChoiceOption[]>(
    () => {
      const applied = new Set(
        this.draft()
          .discounts.filter((discount) => discount.source === 'grant')
          .map((discount) => discount.grantId),
      );
      return this.uiGrants()
        .filter((grant) => !applied.has(grant.grantId))
        .map((grant) => ({
          id: `grant:${grant.grantId}`,
          label: grant.label,
          detail: this.previewLabel(grant.value),
          testId: `staff-visit-discount-pick-${grant.grantId}`,
        }));
    },
  );

  /** `−5,60 €` — what a value would take off the bill on its own. */
  private previewLabel(value: VisitEditorDiscountValue): string {
    const subtotal = this.subtotalMoney();
    const couponValue = toCouponValue(value, MONEY_CODE);
    if (subtotal === null || couponValue === null) return '';
    const breakdown = DiscountApplication.apply(subtotal, [
      {
        id: 'preview',
        label: 'preview',
        value: couponValue,
        grantedAt: instantAt(0),
      },
    ]);
    return `−${this.moneyLabel(breakdown.discountTotal.toMinorUnits())}`;
  }

  /**
   * THE DOCK'S FIGURE: what still changes hands at the counter — the saved
   * subtotal, less what the drafted discounts take off, less what the
   * drafted vouchers pay. The subtotal is the VM owner's (the legs' figures
   * are labels, not a sum); the bill is the one live term, because this
   * sheet is where it is chosen.
   */
  protected readonly dockTotalLabel = computed(() => {
    const saved = this.vm().priceLabel ?? '—';
    const total = this.bill().total;
    if (total === null) return saved;
    return this.moneyLabel(Math.max(0, total - this.voucherTotal())) || saved;
  });

  /** `2,80 €` for the dock's discount line, or `null` at full price. */
  protected readonly dockDiscountAmount = computed(() => {
    const off = this.bill().discountTotal;
    return off > 0 ? this.moneyLabel(off) || null : null;
  });

  /** `10,00 €` for the dock's voucher line, or `null` when nothing is paid that way. */
  protected readonly dockVoucherAmount = computed(() => {
    const paid = this.voucherTotal();
    return paid > 0 ? this.moneyLabel(paid) || null : null;
  });

  /** The dock's discount line, singular or plural by how many lines feed it. */
  protected readonly dockDiscountKey = computed(() =>
    this.draft().discounts.length > 1
      ? 'staff.visit.discountsInDock'
      : 'staff.visit.discountInDock',
  );

  protected readonly dockVoucherKey = computed(() =>
    this.draft().vouchers.length > 1
      ? 'staff.visit.vouchersInDock'
      : 'staff.visit.voucherInDock',
  );

  protected pickDiscount(id: string): void {
    const grant = this.uiGrants().find(
      (entry) => `grant:${entry.grantId}` === id,
    );
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
   * a voucher joins the bill and the menu closes, the way a committed tip
   * does; a miss leaves the field with its refusal under it, and the code
   * where it was typed.
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
        this.closeDiscountMenu();
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
        this.closeDiscountMenu();
        return;
      }
      this.codeState.set('unknown');
    });
  });

  /**
   * A typed sum off the bill — for whoever handles the shop's money. Takes
   * what a keypad produces (`5`, `5,50`, `5.50`); anything that is not money
   * springs the field back, the tip's rule. Empty does nothing: a manual
   * figure leaves the bill by its swipe, like every line.
   */
  protected commitDiscountAmount(raw: string): void {
    if (raw.trim().length === 0) return;
    const minor = parsePriceInput(raw);
    if (minor === null || minor <= 0) return;
    this.addDiscount({
      source: 'manual',
      label: 'manual',
      value: { kind: 'fixed_amount', amountMinorUnits: minor },
      grantId: null,
      code: null,
      exclusive: false,
    });
    this.closeDiscountMenu();
  }

  /** A typed percent off the bill — whole, 1 to 100; same rules as the sum. */
  protected commitDiscountPercent(raw: string): void {
    if (raw.trim().length === 0) return;
    const digits = raw.replace(/[^\d]/g, '');
    const percent = digits.length === 0 ? NaN : Number(digits);
    if (!Number.isInteger(percent) || percent <= 0 || percent > 100) return;
    this.addDiscount({
      source: 'manual',
      label: 'manual',
      value: { kind: 'percent_off', percent },
      grantId: null,
      code: null,
      exclusive: false,
    });
    this.closeDiscountMenu();
  }

  /** The code field, at rest: nothing pending, nothing said. */
  private settleCode(): void {
    this.pendingCode.set(null);
    this.codeState.set('idle');
  }

  /** The code field's figure: what is being checked, or nothing. */
  protected readonly discountCodeFigure = computed(
    () => this.pendingCode() ?? '',
  );

  /** A settled choice closes the menu and hands focus back to the add row. */
  private closeDiscountMenu(): void {
    if (!this.discountMenu()) return;
    this.discountMenu.set(false);
    this.focusLater('[data-testid="staff-visit-add-discount"]');
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
   * A person without a service is nothing in this model — a seat IS a
   * service for a person — so a party saves only once everyone has one.
   */
  protected readonly everyoneServed = computed(() => {
    const draft = this.draft();
    if (draft.clients.length <= 1) return true;
    return draft.clients.every((client) =>
      draft.legs.some((leg) => leg.clientId === client.id),
    );
  });

  /**
   * Whether `Запази` has anything it can do. A new visit needs at least one
   * service before it is a visit at all; an existing one needs a change.
   */
  protected readonly saveable = computed(
    () =>
      this.everyoneServed() &&
      (this.isNew() ? this.draft().legs.length > 0 : this.dirty()),
  );

  protected save(): void {
    if (!this.saveable()) return;
    const draft = this.draft();
    this.committed.emit({
      kind: 'save',
      dayKey: draft.dayKey,
      startMinute: draft.startMinute,
      endMinute: this.endMinute(),
      note: draft.note?.trim() ? draft.note.trim() : null,
      discounts: draft.discounts,
      vouchers: draft.vouchers,
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
    });
  }

  protected discard(): void {
    this.draft.set(seedDraft(this.vm()));
    this.durationTouched.set(false);
    this.noteOpen.set(false);
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
const TIP_PERCENTS: readonly number[] = [5, 10, 15];

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
