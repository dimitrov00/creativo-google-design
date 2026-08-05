import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Money, formatMoney } from '@creativo/application/booking';
import { PhoneNumber } from '@creativo/application/identity';
import { BarberId } from '@creativo/application/catalog';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import { translateDomainError } from '@creativo/infrastructure/i18n';
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
import type { BookingContactProps } from '@creativo/application/booking';
import { MAX_BOOKING_NOTE_LENGTH } from '@creativo/application/booking';
import { AUTH_DEPLOYMENT } from '@creativo/application/identity';
import { BookingFlowStore } from '../booking-flow.store';
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
    RouterLink,
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

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  /** The booker has an account. Until then Confirm asks them to sign in. */
  protected readonly isSignedIn = computed(
    () => this.accountState.principal().kind === 'active',
  );

  private readonly zone = computed(
    () => this.store.selection()?.timeSlot.start.zoneName ?? 'Europe/Sofia',
  );

  /** The booked shop, as an entity — the map, name, address, and directions
   *  link all read off this one resolution. */
  private readonly shop = computed(() => {
    const selection = this.store.selection();
    if (!selection) return null;
    return (
      this.catalog
        .locations()
        .find((candidate) => candidate.id.equals(selection.locationId)) ?? null
    );
  });

  protected readonly locationName = computed(() => {
    const shop = this.shop();
    if (shop) return this.content.text({ en: shop.name.en, bg: shop.name.bg });
    return this.store.selection()?.locationId.value ?? '';
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
        id: shop.id.value,
        lat: shop.geo.lat,
        lng: shop.geo.lng,
        label: this.content.text({ en: shop.name.en, bg: shop.name.bg }),
      },
    ];
  });

  protected readonly selectedPinId = computed(
    () => this.shop()?.id.value ?? null,
  );

  protected readonly colorScheme = computed(() => this.theme.theme());

  /** Hands the destination to the phone's real navigator — universal Maps
   *  URL, so iOS offers Apple Maps and everything else opens Google Maps. */
  protected readonly directionsHref = computed(() => {
    const shop = this.shop();
    if (!shop) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${shop.geo.lat},${shop.geo.lng}`;
  });

  /** The day, spelled out — "Monday, 3 August". */
  protected readonly dayLabel = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    return new Intl.DateTimeFormat(this.content.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: this.zone(),
    }).format(new Date(selection.timeSlot.start.toMillis()));
  });

  /**
   * The chosen day's calendar coordinates IN THE SHOP'S ZONE — `en-CA` is the
   * one locale whose date format is literally `YYYY-MM-DD`, which makes Intl
   * the zone-correct parser the Date object refuses to be.
   */
  private readonly selectedYmd = computed(() => {
    const selection = this.store.selection();
    if (!selection) return null;
    const key = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: this.zone(),
    }).format(new Date(selection.timeSlot.start.toMillis()));
    return {
      year: Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      day: Number(key.slice(8, 10)),
    };
  });

  /**
   * "Август" — sentence-cased month. The YEAR appears only when the booking
   * leaves the current one: on a calendar showing next Wednesday, "2026 г."
   * is a word that answers a question nobody asked (owner ruling
   * 2026-08-04).
   */
  protected readonly monthLabel = computed(() => {
    const ymd = this.selectedYmd();
    if (!ymd) return '';
    const locale = this.content.locale();
    const thisYear = new Date().getFullYear();
    const label = new Intl.DateTimeFormat(locale, {
      month: 'long',
      ...(ymd.year === thisYear ? {} : { year: 'numeric' }),
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(ymd.year, ymd.month - 1, 1)));
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  });

  /** Mon-first weekday initials, localized — labels are never modeled as data. */
  protected readonly weekdayLabels = computed(() => {
    const formatter = new Intl.DateTimeFormat(this.content.locale(), {
      weekday: 'short',
      timeZone: 'UTC',
    });
    // 2024-01-01 was a Monday; UTC keeps the walk zone-independent.
    return Array.from({ length: 7 }, (_, index) =>
      formatter.format(Date.UTC(2024, 0, 1 + index)),
    );
  });

  /**
   * The chosen day's month as a Monday-first grid of day-of-month numbers,
   * `null` in the blank columns before the 1st and after the last — the
   * schedule step's own cell contract, without its availability states,
   * because this calendar ANSWERS a question rather than asking one.
   */
  protected readonly weeks = computed<readonly (number | null)[][]>(() => {
    const ymd = this.selectedYmd();
    if (!ymd) return [];
    const lead =
      (new Date(Date.UTC(ymd.year, ymd.month - 1, 1)).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(ymd.year, ymd.month, 0)).getUTCDate();
    const cells: (number | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, index) => index + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (number | null)[][] = [];
    for (let index = 0; index < cells.length; index += 7) {
      weeks.push(cells.slice(index, index + 7));
    }
    return weeks;
  });

  protected readonly selectedDayOfMonth = computed(
    () => this.selectedYmd()?.day ?? null,
  );

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
    () => this.store.contact()?.email ?? this.account()?.email?.value ?? null,
  );

  /**
   * "+359 89 633 0113" — INTERNATIONAL, the same form the session chip and
   * the profile screen show. The national format the review step used prints
   * Bulgaria's trunk prefix ("089 …"), which is a digit that exists only
   * inside the country and is not what is stored: storage is E.164.
   */
  protected readonly contactPhone = computed(() => {
    const overridden = this.store.contact()?.phone;
    if (overridden) {
      const parsed = PhoneNumber.create(overridden);
      return parsed.isSuccess()
        ? parsed.value.formatInternational()
        : overridden;
    }
    return this.account()?.phone.formatInternational() ?? null;
  });

  /** The name on the booking — the override wins over the account's. */
  protected readonly contactName = computed(
    () => this.store.contact()?.name || this.bookerName(),
  );

  /** What the shop should know first. Shown only when there is one. */
  protected readonly contactNote = computed(
    () => this.store.contact()?.note ?? null,
  );

  /** The HIG Edit affordance: back to the step that owns the answer. */
  protected editServices(): void {
    this.store.rewindTo('services');
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
        this.noteDraft.set(untracked(() => this.store.contact()?.note ?? ''));
      }
    });

    // Every booking carries a contact, whether or not anybody opened the
    // sheet: the shop needs a number for THIS appointment, and the account's
    // own details are the honest default. Runs once — an override the user
    // typed is never overwritten by the profile it was overriding.
    effect(() => {
      const user = this.account();
      if (!user || untracked(() => this.store.contact()) !== null) return;
      this.store.setContact({
        name: user.fullName(),
        phone: user.phone.value,
        email: user.email?.value ?? null,
        note: null,
      });
    });
  }

  /** The tenant's phone country, from the same token auth and onboarding read. */
  protected readonly defaultCountry = inject(AUTH_DEPLOYMENT).defaultCountry;

  protected onContactSaved(contact: BookingContactProps): void {
    this.store.setContact(contact);
    this.contactSheetOpen.set(false);
  }

  // ── The note, in its own place ─────────────────────────────────────

  protected readonly noteSheetOpen = signal(false);
  protected readonly noteDraft = signal('');
  protected readonly noteLimit = MAX_BOOKING_NOTE_LENGTH;

  protected saveNote(): void {
    const existing = this.store.contact();
    if (!existing) return;
    const note = this.noteDraft().trim().slice(0, this.noteLimit);
    this.store.setContact({ ...existing, note: note || null });
    this.noteSheetOpen.set(false);
  }

  /** The envelope — when the party arrives and when it is done. */
  protected readonly windowLabel = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    return `${this.time(selection.timeSlot.start.toMillis())} – ${this.time(
      selection.timeSlot.end.toMillis(),
    )}`;
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

    const byLineId = new Map(
      cart
        .entries()
        .flatMap(([seatKey, lines]) =>
          lines.map((line) => [line.id.value, { seatKey, line }] as const),
        ),
    );

    const bySeat = new Map<
      string,
      { readonly lines: ReviewLineVm[]; total: Money | null; broken: boolean }
    >();

    for (const assignment of selection.assignments) {
      const found = byLineId.get(assignment.lineId.value);
      if (!found) continue;
      const service = this.catalog.findService(found.line.serviceId.value);
      if (!service) continue;

      // The price shown is `termsFor(the barber who actually got it)` — the
      // same resolution the server will redo. A summary quoting the catalog
      // base while the server charges the barber's rate is a summary that
      // lies.
      const terms = service.termsFor(assignment.barberId, found.line.variantId);
      const variant = found.line.variantId
        ? (service.variants.find((candidate) =>
            candidate.id.equals(found.line.variantId as never),
          ) ?? null)
        : null;
      const vm = this.catalog.toServiceVm(service);

      const entry = bySeat.get(found.seatKey) ?? {
        lines: [],
        total: null,
        broken: false,
      };
      entry.lines.push({
        key: assignment.lineId.value,
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
        timeLabel: this.time(assignment.slot.start.toMillis()),
        priceLabel: formatMoney(terms.price, this.content.locale()),
      });
      if (!entry.broken) {
        if (entry.total === null) {
          entry.total = terms.price;
        } else {
          const sum = entry.total.add(terms.price);
          if (sum.isFailure()) {
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
      a === 'self' ? -1 : b === 'self' ? 1 : 0,
    );

    // One line in the whole booking means the window under the calendar
    // already said when — so the card drops the minute and keeps the barber.
    const lineCount = [...bySeat.values()].reduce(
      (sum, entry) => sum + entry.lines.length,
      0,
    );

    return seatKeys.map((seatKey) => {
      const entry = bySeat.get(seatKey);
      const known = seatKey === 'self' ? this.identity.displayName() : null;
      return {
        key: seatKey,
        personLabel: this.personLabel(seatKey),
        // Initials of the fallback "You" spell nothing — the avatar falls
        // back to its silhouette, the same rule the seat scope applies.
        monogramName:
          seatKey === 'self' ? (known ?? '') : this.personLabel(seatKey),
        avatarSrc: seatKey === 'self' ? this.identity.avatarUrl() : null,
        lines: (entry?.lines ?? []).map((line) =>
          lineCount > 1 ? line : { ...line, timeLabel: null },
        ),
        subtotalLabel:
          entry?.total != null
            ? formatMoney(entry.total, this.content.locale())
            : null,
      };
    });
  });

  /** More than one shelf — the only time naming each one says anything. */
  protected readonly multiPerson = computed(() => this.groups().length > 1);

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

    const byLineId = new Map(
      cart
        .entries()
        .flatMap(([, lines]) =>
          lines.map((line) => [line.id.value, line] as const),
        ),
    );

    let total: Money | null = null;
    for (const assignment of selection.assignments) {
      const line = byLineId.get(assignment.lineId.value);
      if (!line) continue;
      const service = this.catalog.findService(line.serviceId.value);
      if (!service) continue;
      const price = service.termsFor(assignment.barberId, line.variantId).price;
      if (total === null) {
        total = price;
        continue;
      }
      const sum = total.add(price);
      // Mixed currencies are a data error the aggregate also refuses; showing
      // a partial total would be worse than showing none.
      if (sum.isFailure()) return null;
      total = sum.value;
    }
    return total ? formatMoney(total, this.content.locale()) : null;
  });

  /** The `slot_unavailable` bounce is handled by the store; this is anything else. */
  protected readonly errorMessage = computed(() => {
    const error = this.store.error();
    if (!error || this.store.slotTaken()) return null;
    return translateDomainError(this.transloco, error);
  });

  /**
   * Confirm, or sign in first.
   *
   * The redirect lands on `?step=schedule` rather than back here on purpose:
   * the draft resumes one step back (see `BookingFlowStore.restore`), because
   * the offer this screen shows would be minutes old by then and nobody
   * re-checked it. The user's day survives, so it costs one tap.
   */
  protected async confirm(): Promise<void> {
    if (!this.isSignedIn()) {
      await this.router.navigate(['/auth'], {
        queryParams: { redirect: '/book?step=schedule' },
      });
      return;
    }
    await this.store.commit();
  }

  private time(millis: number): string {
    return new Intl.DateTimeFormat(this.content.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.zone(),
    }).format(new Date(millis));
  }

  private barberName(barberId: BarberId): string {
    const barber = this.catalog
      .barbers()
      .find((candidate) => candidate.id.equals(barberId));
    return barber
      ? this.content.text({ en: barber.name.en, bg: barber.name.bg })
      : barberId.value;
  }

  /** The portrait the team cards already show — one source, not a second copy. */
  private barberAvatarSrc(barberId: BarberId): string | null {
    return (
      this.catalog.barberVms().find((vm) => vm.id === barberId.value)
        ?.avatarSrc ?? null
    );
  }

  /** `seatKeyValue` is `'self'` or the bare `GuestId`. */
  private personLabel(seatKey: string): string {
    // The booker by NAME once we know it — three steps said "You" to a
    // signed-in user whose name was sitting in the session the whole time
    // (owner ruling 2026-07-31). "You" is the fallback, not the rule.
    if (seatKey === 'self')
      return (
        this.identity.displayName() ||
        this.transloco.translate('booking.party.you')
      );
    const guest = this.store
      .guests()
      .find((candidate) => candidate.id.value === seatKey);
    return guest?.label.value ?? seatKey;
  }
}
