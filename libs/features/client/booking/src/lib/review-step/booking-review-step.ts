import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { type CartLineId, LocalDate } from '@core/primitives';
import {
  BookingContact,
  BookingFlowStep,
  type CartLine,
  Money,
  Principal,
  SeatKey,
  ServiceTerms,
} from '@core/components';
import {
  CalendarGridSystem,
  OfferingPriceSystem,
  PhoneSystem,
  ShopReachSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { Profile } from '@core/entities';
import {
  AUTH_DEPLOYMENT_PORTS,
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import {
  formatCents,
  formatMinute,
  formatWeekdayLabels,
} from '@creativo/ui/wall-clock';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import {
  UiAsyncImage,
  UiAvatar,
  UiBadge,
  UiButton,
  UiIcon,
  UiMap,
  type UiMapPin,
  UiModalSheet,
  UiTextField,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UiCalendarGrid,
  UiCard,
  UiDateBadge,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import {
  SessionIdentityService,
  ThemeService,
} from '@creativo/features/shared/shell';
import { BookingFlowStore } from '../booking-flow.store';
import { bookingSignInReturnUrl } from '../booking-return-url';
import {
  formatBookingDay,
  formatBookingMonth,
  formatBookingTime,
} from '../booking-wall-clock';
import {
  bookingErrorMessage,
  callHrefForRefusal,
} from './booking-error-message';
import { placeRiders } from './rider-placement';
import { BookingContactSheet } from '../contact-sheet/booking-contact-sheet';
import { BookingStepTitle } from '../chrome/booking-chrome.service';
import { BookingStepLayout } from '../step-layout/booking-step-layout';

/** One booked line, as the summary reads it out. */
interface ReviewLineVm {
  readonly key: string;
  readonly coverSrc: string | null;
  readonly serviceName: string;
  readonly variantName: string | null;
  readonly barberName: string;
  /** The barber's own face — a name alone is a string; a face is a person. */
  readonly barberAvatarSrc: string | null;
  /**
   * The minute THIS line starts, and only when the booking has more than
   * one: a single service already has its window stated under the calendar,
   * and repeating it on the line is the same fact twice. A sequence of two
   * or three needs it, because the order is the information.
   */
  readonly timeLabel: string | null;
  readonly priceLabel: string;
}

/**
 * One person the server moves WITH this visit without their being in the
 * cart — a line's anatomy without a price: what they are sold is the shop's
 * arrangement, kept as it was, not something this screen is quoting.
 */
type RiderLineVm = Omit<ReviewLineVm, 'priceLabel' | 'timeLabel'> & {
  readonly timeLabel: string;
};

/**
 * One person's shelf of the summary — the same anatomy the bag renders,
 * because this screen is the bag's content one step later: same people, same
 * lines, with the open questions (which barber, which minute) now closed.
 */
interface ReviewGroupVm {
  readonly key: string;
  readonly personLabel: string;
  /** Empty for the booker until a name is known — the avatar shows a silhouette. */
  readonly monogramName: string;
  readonly avatarSrc: string | null;
  readonly lines: readonly ReviewLineVm[];
  readonly subtotalLabel: string | null;
}

/**
 * Step 4 — is this right?
 *
 * ### What a summary is for
 * Not decoration and not a receipt: it is the last place a mistake is cheap.
 * So it says the things that are expensive to get wrong — who, with whom, at
 * what time, for how much — in that order, and each row is the same shape the
 * user has already seen twice.
 *
 * ### The auth prompt is HERE, not at the door
 * `/book` is browsable anonymously (owner ruling 2026-07-29). Signing in is
 * asked for at the moment it buys something — a booking that exists, that can
 * be cancelled, that shows up in an account — rather than as a toll on the way
 * in. `AccountStateService` claims the party in place when the principal turns
 * active, so the round trip costs nothing the user assembled.
 *
 * ### Confirm is a server round trip that can say no
 * The times on this screen came from a projection that may be seconds old. If
 * the slot goes while the user is reading, the store steps back to a freshly
 * computed grid with the day intact and an honest line about why — never a
 * dead end, and never a silent success against stale data.
 */
@Component({
  selector: 'lib-booking-review-step',
  imports: [
    BookingContactSheet,
    BookingStepLayout,
    BookingStepTitle,
    TranslocoDirective,
    UiAsyncImage,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCalendarGrid,
    UiCard,
    UiDateBadge,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMap,
    UiModalSheet,
    UiSectionHeader,
    UiSheetActionBar,
    UiStack,
    UiTextField,
    UiTextDirective,
    UiWeightDirective,
  ],
  templateUrl: './booking-review-step.html',
  // The bag's own stylesheet rides along so the shelf (`.bag-person`) and the
  // thumbnail (`.bag-line__art`) are the SAME rules the bag renders — one
  // anatomy, two screens, no copy to drift.
  styleUrls: [
    './booking-review-step.css',
    '../bag-sheet/booking-bag-sheet.css',
  ],
  host: { 'data-testid': 'booking-review-step' },
})
export class BookingReviewStep {
  private readonly transloco = inject(TranslocoService);
  private readonly identity = inject(SessionIdentityService);
  private readonly router = inject(Router);
  private readonly accountState = inject(AccountStateService);
  private readonly theme = inject(ThemeService);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly shopZones = inject(ShopZoneService);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogWording);
  protected readonly store = inject(BookingFlowStore);

  /** The booker has an account. Until then Confirm asks them to sign in. */
  protected readonly isSignedIn = computed(() =>
    Principal.isActive(this.accountState.principal()),
  );

  /** The booked shop, as an entity — the map, name, address, and directions
   *  link all read off this one resolution. */
  private readonly shop = computed(() => {
    const selection = this.store.selection();
    if (!selection) return null;
    return (
      this.catalog
        .locations()
        .find((candidate) => candidate.id === selection.locationId) ?? null
    );
  });

  protected readonly locationName = computed(() => {
    const shop = this.shop();
    if (shop) return this.content.text({ en: shop.name.en, bg: shop.name.bg });
    return this.store.selection()?.locationId ?? '';
  });

  protected readonly locationAddress = computed(() => {
    const shop = this.shop();
    return shop
      ? this.content.text({ en: shop.address.en, bg: shop.address.bg })
      : '';
  });

  /** ONE pin — the shop the booking is at, already selected so the camera
   *  centres it. Panning away wakes the DS map's offscreen indicator, which
   *  points back at it — the same behaviour the location step has. */
  protected readonly pins = computed<readonly UiMapPin[]>(() => {
    const shop = this.shop();
    if (!shop) return [];
    return [
      {
        id: shop.id,
        lat: shop.latitude,
        lng: shop.longitude,
        label: this.content.text({ en: shop.name.en, bg: shop.name.bg }),
      },
    ];
  });

  protected readonly selectedPinId = computed(() => this.shop()?.id ?? null);

  protected readonly colorScheme = computed(() => this.theme.theme());

  /** Hands the destination to the phone's real navigator — universal Maps
   *  URL, so iOS offers Apple Maps and everything else opens Google Maps. */
  protected readonly directionsHref = computed(() => {
    const shop = this.shop();
    // The shop's pin is its own root fields, already branded.
    return shop ? ShopReachSystem.directionsHref(shop) : null;
  });

  /** The day, spelled out — "Monday, 3 August". */
  protected readonly dayLabel = computed(() => {
    const selection = this.store.selection();
    return selection
      ? formatBookingDay(selection.localDate, this.content.locale())
      : '';
  });

  /**
   * This year on the SHOP's calendar — the booked shop's zone, else the
   * deployment's default location's; `null` until either answers. One clock
   * reading (`CLOCK_PORTS`), never the device's calendar.
   */
  private readonly defaultZone = this.shopZones.defaultZone();

  private readonly thisYear = computed<number | null>(() => {
    const zone = this.shop()?.timeZone ?? this.defaultZone();
    if (zone === null) return null;
    const today = ZonedTimeSystem.shopNow(
      this.clock.nowUtcMs(),
      zone,
    ).localDate;
    return LocalDate.parts(today).year;
  });

  /**
   * "Август" — sentence-cased month. The YEAR appears only when the booking
   * leaves the current one: on a calendar showing next Wednesday, "2026 г."
   * is a word that answers a question nobody asked (owner ruling
   * 2026-08-04).
   */
  protected readonly monthLabel = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    const thisYear = this.thisYear();
    return formatBookingMonth(
      selection.localDate,
      thisYear !== null &&
        LocalDate.parts(selection.localDate).year !== thisYear,
      this.content.locale(),
    );
  });

  /** Mon-first weekday initials, localized — labels are never modeled as data. */
  protected readonly weekdayLabels = computed(() =>
    formatWeekdayLabels(this.content.locale()),
  );

  /**
   * The chosen day's month as a Monday-first grid of day-of-month numbers,
   * `null` in the blank columns before the 1st and after the last — the
   * schedule step's own cell contract, without its availability states,
   * because this calendar ANSWERS a question rather than asking one.
   */
  protected readonly weeks = computed<readonly (number | null)[][]>(() => {
    const selection = this.store.selection();
    if (!selection) return [];
    // `CalendarGridSystem.monthGrid`: Monday-first, padded to whole weeks;
    // a weekday is civil arithmetic, so no day table is needed.
    return CalendarGridSystem.monthGrid(
      LocalDate.startOfMonth(selection.localDate),
      [],
    ).map((week) =>
      week.map((cell) => (cell.inMonth ? cell.dayOfMonth : null)),
    );
  });

  protected readonly selectedDayOfMonth = computed(() => {
    const selection = this.store.selection();
    return selection ? LocalDate.parts(selection.localDate).day : null;
  });

  /** The signed-in booker, for the contact row. `null` hides the row. */
  protected readonly account = this.accountState.account;

  protected readonly avatarUrl = computed(() => this.identity.avatarUrl());

  protected readonly bookerName = computed(
    () =>
      this.identity.displayName() ||
      this.transloco.translate('booking.party.you'),
  );

  /**
   * The address, on its own line and FIRST.
   *
   * An email is routinely three times the length of a phone number, so a
   * single joined line put the short fact where it read as a prefix and let
   * the long one run into the ellipsis. Two lines, longest first, and
   * neither truncates.
   */
  protected readonly contactEmail = computed(
    () => this.store.contact().contactEmail ?? this.account()?.email ?? null,
  );

  /**
   * "+359 89 633 0113" — INTERNATIONAL, the same form the session chip and
   * the profile screen show. The national format the review step used prints
   * Bulgaria's trunk prefix ("089 …"), which is a digit that exists only
   * inside the country and is not what is stored: storage is E.164.
   */
  protected readonly contactPhone = computed(() => {
    const phone =
      this.store.contact().contactPhone ?? this.account()?.phone ?? null;
    return phone === null ? null : PhoneSystem.formatInternational(phone);
  });

  /** The name on the booking — the override wins over the account's. */
  protected readonly contactName = computed(
    () => this.store.contact().contactName || this.bookerName(),
  );

  /** What the shop should know first. Shown only when there is one. */
  protected readonly contactNote = computed(
    () => this.store.contact().contactNote,
  );

  /** The HIG Edit affordance: back to the step that owns the answer. */
  protected editServices(): void {
    this.store.rewindTo(BookingFlowStep.Services);
  }

  /**
   * The contact sheet is mounted only while open, so it seeds itself from the
   * booking (or the account) once per visit rather than holding a stale draft
   * of an edit somebody abandoned.
   */
  protected readonly contactSheetOpen = signal(false);

  constructor() {
    // The note draft re-seeds each time its sheet opens, so an abandoned
    // edit never survives into the next one.
    effect(() => {
      if (this.noteSheetOpen()) {
        this.noteDraft.set(
          untracked(() => this.store.contact().contactNote ?? ''),
        );
      }
    });

    // Every booking carries a contact, whether or not anybody opened the
    // sheet: the shop needs a number for THIS appointment, and the account's
    // own details are the honest default. Runs once — an override the user
    // typed is never overwritten by the profile it was overriding.
    // (A registered account always holds a phone; the flat body types it
    // nullable for the stub, which `account` never is.)
    effect(() => {
      const user = this.account();
      if (!user || user.phone === null) return;
      if (BookingContact.isPresent(untracked(() => this.store.contact()))) {
        return;
      }
      this.store.setContact({
        contactName: Profile.fullName(user),
        contactPhone: user.phone,
        contactEmail: user.email,
        contactNote: null,
      });
    });
  }

  /** The tenant's phone country, from the same bundle auth and onboarding read. */
  protected readonly defaultCountry = inject(AUTH_DEPLOYMENT_PORTS)
    .authDeployment.defaultCountry;

  protected onContactSaved(contact: BookingContact.Present): void {
    this.store.setContact(contact);
    this.contactSheetOpen.set(false);
  }

  // ── The note, in its own place ─────────────────────────────────────

  protected readonly noteSheetOpen = signal(false);
  protected readonly noteDraft = signal('');
  protected readonly noteLimit = BookingContact.MAX_NOTE_LENGTH;

  protected saveNote(): void {
    const existing = this.store.contact();
    if (!BookingContact.isPresent(existing)) return;
    const note = this.noteDraft().trim().slice(0, this.noteLimit);
    this.store.setContact({ ...existing, contactNote: note || null });
    this.noteSheetOpen.set(false);
  }

  /** The envelope — when the party arrives and when it is done. */
  protected readonly windowLabel = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    const locale = this.content.locale();
    return `${formatBookingTime(
      selection.localDate,
      selection.startMinutes,
      locale,
    )} – ${formatBookingTime(selection.localDate, selection.endMinutes, locale)}`;
  });

  /**
   * The summary, GROUPED BY PERSON — one shelf each, exactly as the bag
   * showed them (owner ruling 2026-08-01: the review reads as the bag's
   * content, resolved). Grouping here rather than flat-listing matters for
   * the same reason it did there: a flat list with a name repeated down the
   * side is how a beard trim ends up attributed to the wrong guest at the
   * one moment a mistake is still cheap.
   *
   * Order: the booker first, then guests as the cart holds them — the same
   * order every previous step used.
   */
  protected readonly groups = computed<readonly ReviewGroupVm[]>(() => {
    const selection = this.store.selection();
    const cart = this.store.cart();
    if (!selection || !cart) return [];
    const locale = this.content.locale();

    const byLineId = new Map<
      CartLineId,
      { readonly seatKey: string; readonly line: CartLine }
    >();
    for (const seat of cart.cartSeats) {
      for (const line of seat.lines) {
        byLineId.set(line.lineId, { seatKey: seat.seatKey, line });
      }
    }

    const bySeat = new Map<
      string,
      { readonly lines: ReviewLineVm[]; total: Money | null; broken: boolean }
    >();

    for (const assignment of selection.assignments) {
      const found = byLineId.get(assignment.lineId);
      if (!found) continue;
      const service = this.catalog.findService(found.line.serviceId);
      if (!service) continue;

      // The price shown is `termsFor(the barber who actually got it)` — the
      // same resolution the server will redo. A summary quoting the catalog
      // base while the server charges the barber's rate is a summary that
      // lies.
      const variantId = found.line.variantId;
      const terms = OfferingPriceSystem.termsFor(
        service,
        assignment.barberId,
        variantId,
      );
      const price = ServiceTerms.price(terms);
      const variant =
        variantId === null
          ? null
          : (service.variants.find(
              (candidate) => candidate.variantId === variantId,
            ) ?? null);
      const vm = this.catalog.toServiceVm(service);

      const entry = bySeat.get(found.seatKey) ?? {
        lines: [],
        total: null,
        broken: false,
      };
      entry.lines.push({
        key: assignment.lineId,
        coverSrc: vm.coverSrc ?? null,
        serviceName: this.content.text({
          en: service.name.en,
          bg: service.name.bg,
        }),
        variantName: variant
          ? this.content.text({ en: variant.name.en, bg: variant.name.bg })
          : null,
        barberName: this.barberName(assignment.barberId),
        barberAvatarSrc: this.barberAvatarSrc(assignment.barberId),
        // Filled below, once the total line count is known — a lone service
        // does not repeat the window stated under the calendar.
        timeLabel: formatBookingTime(
          selection.localDate,
          assignment.startMinutes,
          locale,
        ),
        priceLabel: this.money(price),
      });
      if (!entry.broken) {
        if (entry.total === null) {
          entry.total = price;
        } else {
          const sum = Money.add(entry.total, price);
          if (!sum.ok) {
            entry.broken = true;
            entry.total = null;
          } else {
            entry.total = sum.value;
          }
        }
      }
      bySeat.set(found.seatKey, entry);
    }

    // Booker first, then guests in cart order — `cart.entries()` is already
    // the order seats first held something, with `self` wherever it landed;
    // the summary pins the booker to the front regardless.
    const seatKeys = [...bySeat.keys()].sort((a, b) =>
      a === SELF_SEAT ? -1 : b === SELF_SEAT ? 1 : 0,
    );

    // One line in the whole booking means the window under the calendar
    // already said when — so the card drops the minute and keeps the barber.
    const lineCount = [...bySeat.values()].reduce(
      (sum, entry) => sum + entry.lines.length,
      0,
    );

    return seatKeys.map((seatKey) => {
      const entry = bySeat.get(seatKey);
      const known = seatKey === SELF_SEAT ? this.identity.displayName() : null;
      return {
        key: seatKey,
        personLabel: this.personLabel(seatKey),
        // Initials of the fallback "You" spell nothing — the avatar falls
        // back to its silhouette, the same rule the seat scope applies.
        monogramName:
          seatKey === SELF_SEAT ? (known ?? '') : this.personLabel(seatKey),
        avatarSrc: seatKey === SELF_SEAT ? this.identity.avatarUrl() : null,
        lines: (entry?.lines ?? []).map((line) =>
          lineCount > 1 ? line : { ...line, timeLabel: null },
        ),
        subtotalLabel: entry?.total != null ? this.money(entry.total) : null,
      };
    });
  });

  /** More than one shelf — the only time naming each one says anything. */
  protected readonly multiPerson = computed(() => this.groups().length > 1);

  /**
   * WHO ELSE MOVES. On a move, anyone the cart cannot name — a companion the
   * shop seated beside the booker — is carried by the server, not sent from
   * here (`BookingFlowStore.riders`). They are shown anyway: a move must
   * never carry a person the client was not told about, and "call the shop"
   * lands better when the client could see who it was about.
   *
   * Placed by the server's own arithmetic — the cart's new earliest start
   * plus each rider's stored distance from it — so the minute on the card is
   * the minute the server will write.
   */
  protected readonly riderLines = computed<readonly RiderLineVm[]>(() => {
    const selection = this.store.selection();
    const riders = this.store.moveRiders();
    if (!selection || riders.length === 0) return [];

    return placeRiders(selection, riders).map(
      ({ rider, startMinutes }, index) => {
        const service = this.catalog.findService(rider.serviceId);
        const variant =
          service && rider.variantId !== null
            ? (service.variants.find(
                (candidate) => candidate.variantId === rider.variantId,
              ) ?? null)
            : null;
        return {
          key: `rider-${index}`,
          coverSrc: service
            ? (this.catalog.toServiceVm(service).coverSrc ?? null)
            : null,
          // A service the catalogue no longer lists still names a PERSON who
          // is moving — the line stays, under a neutral name.
          serviceName: service
            ? this.content.text({ en: service.name.en, bg: service.name.bg })
            : this.transloco.translate('booking.review.riderService'),
          variantName: variant
            ? this.content.text({ en: variant.name.en, bg: variant.name.bg })
            : null,
          barberName: this.barberName(rider.barberId),
          barberAvatarSrc: this.barberAvatarSrc(rider.barberId),
          // The minute on the shop's wall clock the server seats them at; a
          // distance that would leave the day is a seat the server refuses,
          // and the grid never offers a start that strands one.
          timeLabel:
            startMinutes === null
              ? ''
              : formatMinute(startMinutes, this.content.locale()),
        };
      },
    );
  });

  /**
   * What it comes to.
   *
   * Summed from the same per-barber terms each row shows, so the total and its
   * parts cannot disagree. Money is otherwise deferred (owner ruling
   * 2026-07-29) — nothing is charged here; this is what to expect at the
   * chair.
   */
  protected readonly totalLabel = computed(() => {
    const selection = this.store.selection();
    const cart = this.store.cart();
    if (!selection || !cart) return null;

    const byLineId = new Map<CartLineId, CartLine>();
    for (const seat of cart.cartSeats) {
      for (const line of seat.lines) byLineId.set(line.lineId, line);
    }

    let total: Money | null = null;
    for (const assignment of selection.assignments) {
      const line = byLineId.get(assignment.lineId);
      if (!line) continue;
      const service = this.catalog.findService(line.serviceId);
      if (!service) continue;
      const price = ServiceTerms.price(
        OfferingPriceSystem.termsFor(
          service,
          assignment.barberId,
          line.variantId,
        ),
      );
      if (total === null) {
        total = price;
        continue;
      }
      const sum = Money.add(total, price);
      // Mixed currencies are a data error the entity also refuses; showing
      // a partial total would be worse than showing none.
      if (!sum.ok) return null;
      total = sum.value;
    }
    return total ? this.money(total) : null;
  });

  /**
   * The `slot_unavailable` bounce is handled by the store; this is anything
   * else — in the server's own words when there are some (`bookingErrorMessage`).
   */
  protected readonly errorMessage = computed(() => {
    const error = this.store.error();
    if (!error || this.store.slotTaken()) return null;
    // Told whether the call button is beside it, so the copy says "call"
    // only when there is one to press.
    return bookingErrorMessage(this.transloco, error, this.refusalCallHref());
  });

  /** `tel:` for the shop beside a refused move — see `callHrefForRefusal`. */
  protected readonly refusalCallHref = computed(() =>
    callHrefForRefusal(this.store.error(), this.shop()?.phoneE164 ?? null),
  );

  /**
   * Confirm, or sign in first.
   *
   * The redirect lands on `?step=schedule` rather than back here on purpose:
   * the draft resumes one step back (see `BookingFlowStore.restore`), because
   * the offer this screen shows would be minutes old by then and nobody
   * re-checked it. The user's day survives, so it costs one tap. The visit
   * the flow was started from or is moving rides along
   * (`bookingSignInReturnUrl`) — it can only be read once somebody is signed
   * in, which is exactly what this round trip is for.
   */
  protected async confirm(): Promise<void> {
    if (!this.isSignedIn()) {
      await this.router.navigate(['/auth'], {
        queryParams: {
          redirect: bookingSignInReturnUrl(this.router, this.router.url),
        },
      });
      return;
    }
    await this.store.commit();
  }

  /** «28,00 €» — the currency's own exponent and fraction digits. */
  private money(money: Money): string {
    return formatCents(
      money.amountCents,
      money.currency,
      this.content.locale(),
    );
  }

  private barberName(barberId: string): string {
    const barber = this.catalog
      .barbers()
      .find((candidate) => candidate.id === barberId);
    return barber
      ? this.content.text({ en: barber.name.en, bg: barber.name.bg })
      : barberId;
  }

  /** The portrait the team cards already show — one source, not a second copy. */
  private barberAvatarSrc(barberId: string): string | null {
    return (
      this.catalog.barberVms().find((vm) => vm.id === barberId)?.avatarSrc ??
      null
    );
  }

  /** A cart seat key (`SeatKey.text`) — `'self'`, or the bare guest id. */
  private personLabel(seatKey: string): string {
    // The booker by NAME once we know it — three steps said "You" to a
    // signed-in user whose name was sitting in the session the whole time
    // (owner ruling 2026-07-31). "You" is the fallback, not the rule.
    if (seatKey === SELF_SEAT)
      return (
        this.identity.displayName() ||
        this.transloco.translate('booking.party.you')
      );
    const guest = this.store
      .guests()
      .find((candidate) => candidate.guestId === seatKey);
    return guest?.guestLabel ?? seatKey;
  }
}

/** The booker's own cart seat key. */
const SELF_SEAT: string = SeatKey.text(SeatKey.self());
