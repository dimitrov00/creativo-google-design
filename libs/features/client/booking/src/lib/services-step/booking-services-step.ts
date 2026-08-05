import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  BarberPref,
  CartLineId,
  SeatKey,
  seatKeyValue,
} from '@creativo/application/booking';
import {
  BarberId,
  Service,
  ServiceId,
  ServiceVariantId,
  selectabilityFor,
} from '@creativo/application/catalog';
import {
  CatalogContentService,
  CatalogPresenter,
  ServiceCardComponent,
  ServiceDetailSheetComponent,
  type ServiceVm,
} from '@creativo/features/shared/catalog';
import {
  UiAvatar,
  UiBadge,
  UiButton,
  UiChip,
  UiIcon,
  UiTextField,
} from '@creativo/ui/controls';
import { UiGrid, UiScrollRow, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { BookingBagSheet } from '../bag-sheet/booking-bag-sheet';
import { BookingFlowStore } from '../booking-flow.store';
import { BookingStepTitle } from '../chrome/booking-chrome.service';
import type { SeatScopeVm } from '../seat-scope-vm';
import { BookingStepLayout } from '../step-layout/booking-step-layout';

/**
 * The person menu's own box, in px.
 *
 * The menu is measured and placed BEFORE it renders, so the clamp has to know
 * the width it is protecting — and it is pushed to the DS as an inline custom
 * property rather than restated in CSS. A `rem` width in a stylesheet and a
 * px constant here agree only at a 16px root: raise the browser's text size
 * and the clamp starts protecting a box narrower than the one on screen.
 */
const SEAT_MENU_WIDTH = 192;
const SEAT_MENU_GUTTER = 16;

/**
 * Step 2 — what each person is having.
 *
 * ### Multi-guest without an M×N matrix
 * Three shapes were possible and two are bad: N parallel catalogs (one per
 * guest) stops being scannable past two people, and one catalog where each
 * service is assigned via a checklist of people is an M×N matrix the user
 * has to hold in their head.
 *
 * What this does instead: **one catalog, one active person.** A scroll-row
 * of person chips scopes everything below it, and adding a service always
 * means "for whoever is selected". That is the iOS Files/Photos *scope*
 * idiom, and it collapses M×N into M sequential N-choices. The row is
 * rendered only when there is more than one person — a scope control with
 * one option is a control that asks a question with one answer.
 *
 * Deliberately NOT a segmented control: the row needs avatars, live counts
 * and horizontal scrolling for five people, all of which a segmented picker
 * forbids.
 *
 * ### Conflicts explain themselves
 * `selectabilityFor` is asked per candidate against the ACTIVE SEAT's lines
 * only — conflicts are scoped to one person, so a Father & Son bundle stays
 * legal when two guests each hold one of the conflicting services. A
 * blocked card dims and badges (the discrete half) but stays pressable, and
 * the sheet it opens names the blockers and offers to replace them (the
 * on-tap half). A disabled card would make its own explanation unreachable.
 */
@Component({
  selector: 'lib-booking-services-step',
  imports: [
    BookingBagSheet,
    BookingStepLayout,
    BookingStepTitle,
    ServiceCardComponent,
    ServiceDetailSheetComponent,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiChip,
    UiForegroundStyleDirective,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiScrollRow,
    UiSectionHeader,
    UiStack,
    UiTextDirective,
    UiTextField,
  ],
  templateUrl: './booking-services-step.html',
  // The select recipe is SHARED with the bag (see booking-select.css) — two
  // surfaces rendering the same control from two stylesheets is two controls
  // that agree today and drift on the next change.
  styleUrls: ['./booking-services-step.css', '../chrome/booking-select.css'],
  host: { 'data-testid': 'booking-services-step' },
})
export class BookingServicesStep {
  private readonly transloco = inject(TranslocoService);
  private readonly identity = inject(SessionIdentityService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  /** Whose lines the catalog is currently adding to. */
  private readonly activeSeatKeyValue = signal<string>('self');

  protected readonly seats = computed<readonly SeatScopeVm[]>(() => {
    const cart = this.store.cart();
    // A real name when we have one; "You" only as the LABEL. It is
    // deliberately not passed to the avatar — deriving initials from the word
    // "You" produced a "Т" that stands for nothing (owner ruling 2026-07-31).
    const known = this.identity.displayName();
    const self: SeatScopeVm = {
      key: 'self',
      seatKey: SeatKey.self(),
      label: known || this.transloco.translate('booking.party.you'),
      // A real name reads the same in either position; only the pronoun we
      // fall back to has a case to get wrong.
      objectLabel: known || this.transloco.translate('booking.party.youObject'),
      monogramName: known,
      lineCount: cart?.lineCountFor(SeatKey.self()) ?? 0,
      avatarSrc: this.identity.avatarUrl(),
    };
    return [
      self,
      ...this.store.guests().map((guest) => {
        const seatKey = SeatKey.guest(guest.id);
        return {
          key: seatKeyValue(seatKey),
          seatKey,
          label: guest.label.value,
          objectLabel: guest.label.value,
          monogramName: guest.label.value,
          lineCount: cart?.lineCountFor(seatKey) ?? 0,
          avatarSrc: null,
        };
      }),
    ];
  });

  protected readonly activeSeat = computed<SeatScopeVm>(() => {
    const seats = this.seats();
    return (
      seats.find((seat) => seat.key === this.activeSeatKeyValue()) ??
      (seats[0] as SeatScopeVm)
    );
  });

  /** The domain services the active seat already holds — the conflict input. */
  private readonly selectedServices = computed<readonly Service[]>(() => {
    const cart = this.store.cart();
    if (!cart) return [];
    return cart.linesFor(this.activeSeat().seatKey).flatMap((line) => {
      const service = this.catalog.findService(line.serviceId.value);
      return service ? [service] : [];
    });
  });

  /** How many lines of `serviceId` the active seat holds. */
  protected selectedCountFor(serviceId: string): number {
    const cart = this.store.cart();
    if (!cart) return 0;
    return cart
      .linesFor(this.activeSeat().seatKey)
      .filter((line) => line.serviceId.value === serviceId).length;
  }

  /** Localized names of everything blocking `serviceId`, empty when free. */
  protected blockersFor(serviceId: string): readonly string[] {
    const candidate = this.catalog.findService(serviceId);
    if (!candidate) return [];
    // The full catalog is passed so a bundle's members resolve and their
    // conflicts are inherited — otherwise a second haircut could be
    // smuggled in inside a bundle.
    const selectability = selectabilityFor(
      this.selectedServices(),
      candidate,
      this.catalog.services(),
    );
    if (selectability.kind === 'selectable') return [];
    return selectability.by.flatMap((id) => {
      const blocker = this.catalog.findService(id.value);
      return blocker
        ? [this.content.text(this.catalog.toServiceVm(blocker).name)]
        : [];
    });
  }

  protected isBlocked(serviceId: string): boolean {
    return this.blockersFor(serviceId).length > 0;
  }

  /**
   * The card's second line: "30 – 45 мин · от 13,00 €".
   *
   * Delegated, not rebuilt: `cr-service-card` renders this same line in
   * onboarding, and booking's own copy of the format had drifted — it had
   * lost the "от" prefix entirely and ran the two facts in the opposite
   * order, so one catalog read as two different products.
   */
  protected metaFor(service: ServiceVm): string {
    return this.content.serviceMeta(
      service,
      this.transloco.translate('landing.services.from'),
    );
  }

  protected setActiveSeat(key: string): void {
    this.activeSeatKeyValue.set(key);
  }

  // ── The party, assembled here instead of on a step of its own ───────

  /** Whose options menu is open, and who is being renamed inline. */
  protected readonly seatMenuKey = signal<string | null>(null);

  /**
   * How far along the row the open menu should sit.
   *
   * The menu has to live OUTSIDE the scroller to escape its clipping, which
   * costs it the automatic anchoring it would have had inside — so the offset
   * is measured and written back. Without it every person's menu opened under
   * the first pill, which reads as belonging to the wrong guest.
   */
  protected readonly seatMenuOffset = signal(0);

  /** Handed to the DS so the rendered box IS the box the clamp assumed. */
  protected readonly seatMenuWidth = SEAT_MENU_WIDTH;

  /** The person the open menu belongs to — `null` when nothing is open. */
  protected readonly menuSeat = computed<SeatScopeVm | null>(() => {
    const key = this.seatMenuKey();
    if (key === null) return null;
    return this.seats().find((seat) => seat.key === key) ?? null;
  });
  protected readonly renamingKey = signal<string | null>(null);

  /**
   * What is CURRENTLY typed in the rename field.
   *
   * The stored label only moves on commit, so an avatar bound to it sat on
   * the old initial until blur — you renamed someone and their monogram
   * argued with the field above it for as long as you were typing. The draft
   * is what the editor shows, and it empties to the silhouette if the field
   * is cleared, which is exactly what an unnamed person looks like.
   */
  protected readonly renameDraft = signal('');

  /**
   * First press selects; a second press on the person you are already on
   * offers what else can be done with them.
   *
   * The booker has no second meaning — they cannot be renamed here or
   * removed at all — so their pill stays a plain scope control.
   */
  /**
   * When the menu last light-dismissed itself.
   *
   * The DS menu closes on any press outside its own host, and this pill is a
   * SIBLING of its menu rather than the projected trigger — so a press meant
   * to close the menu dismissed it on `pointerdown` and the `click` right
   * behind it opened it straight back up, and the pill could never shut what
   * it had opened. Reading `seatMenuKey` in a `pointerdown` handler does not
   * help: the menu's listener is on the document in the CAPTURE phase, so it
   * has already run. The dismissal's own timestamp is the only thing that
   * still knows (same stale-press suppression the detent sheet uses).
   */
  private dismissedAt = 0;

  protected dismissSeatMenu(): void {
    this.seatMenuKey.set(null);
    this.dismissedAt = performance.now();
  }

  /**
   * The row scrolled out from under the open menu.
   *
   * A popover whose anchor has moved is pointing at the wrong person, and
   * chasing it while a finger is dragging would be worse — so it dismisses,
   * which is what every system menu does on scroll.
   */
  protected onSeatScopeScroll(): void {
    if (this.seatMenuKey() !== null) this.dismissSeatMenu();
  }

  protected pressSeat(seat: SeatScopeVm): void {
    if (this.renamingKey() === seat.key) return;
    if (this.activeSeat().key !== seat.key) {
      this.setActiveSeat(seat.key);
      return;
    }
    if (seat.seatKey.kind !== 'guest') return;
    // This press is the one that just dismissed the menu — it closes, it does
    // not reopen.
    if (performance.now() - this.dismissedAt < 250) return;
    this.dockSeatMenu(seat);
    this.seatMenuKey.set(seat.key);
  }

  /**
   * Park the menu under the pill it belongs to.
   *
   * Clamped to the row so a person near the trailing edge still opens a menu
   * that is fully on screen — a popover half off the side is worse than one
   * an inch from its anchor.
   */
  private dockSeatMenu(seat: SeatScopeVm): void {
    const host = this.host.nativeElement;
    const wrap = host.querySelector('.booking-seat-scope-wrap');
    const pill = host.querySelector(`[data-testid="booking-seat-${seat.key}"]`);
    if (!wrap || !pill) return;
    const wrapBox = wrap.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const viewport =
      this.host.nativeElement.ownerDocument.documentElement.clientWidth;

    // A pill past the halfway mark hangs its menu from the TRAILING edge, the
    // way a system menu flips rather than shoving itself back to the left.
    const fromTrailing = pillBox.left + pillBox.width / 2 > viewport / 2;
    const wanted = fromTrailing
      ? pillBox.right - SEAT_MENU_WIDTH
      : pillBox.left;

    // Clamped to the VIEWPORT, not the content column: the row is full-bleed,
    // so a pill can legitimately sit outside the column's gutters.
    const clamped = Math.min(
      Math.max(wanted, SEAT_MENU_GUTTER),
      viewport - SEAT_MENU_GUTTER - SEAT_MENU_WIDTH,
    );
    this.seatMenuOffset.set(Math.round(clamped - wrapBox.left));
  }

  protected addGuest(): void {
    // Numbered off the monotonic id counter, not the roster LENGTH: ids are
    // never reused, so after add → add → remove-first the length-based number
    // repeats one that is still on screen and two people end up with the same
    // name. The number can skip after removals, which is the honest cost of
    // never showing two "Guest 2"s.
    this.store.addGuest(
      this.transloco.translate('booking.party.guest', {
        number: this.nextGuestNumber(),
      }),
    );
    // Read the id BACK rather than deriving it from the count: guest ids are
    // monotonic and never reused (§7.7), so after any add → remove → add the
    // new guest's id runs ahead of the roster length and this would have
    // selected a seat that does not exist.
    const added = this.store.guests().at(-1);
    if (!added) return;
    // Straight to the person you just added — adding someone and then having
    // to find them is a second step wearing the first one's clothes. The row
    // lives at the TOP of a scrolling page, so it is brought into view too:
    // otherwise the press appears to do nothing at all.
    this.activeSeatKeyValue.set(seatKeyValue(SeatKey.guest(added.id)));
    this.revealSeatRow();
  }

  /** One past the highest guest id minted so far — ids encode `guest-<n>`. */
  private nextGuestNumber(): number {
    const highest = this.store.guests().reduce((max, guest) => {
      const seq = Number.parseInt(guest.id.value.replace('guest-', ''), 10);
      return Number.isFinite(seq) ? Math.max(max, seq) : max;
    }, -1);
    return highest + 2;
  }

  protected startRename(seat: SeatScopeVm): void {
    this.seatMenuKey.set(null);
    this.renameDraft.set(seat.label);
    this.renamingKey.set(seat.key);
    this.focusIn(`[data-testid="booking-seat-rename-${seat.key}"]`);
  }

  protected commitRename(seat: SeatScopeVm, label: string): void {
    this.renamingKey.set(null);
    this.renameDraft.set('');
    if (seat.seatKey.kind !== 'guest') return;
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed === seat.label) return;
    this.store.renameGuest(seat.seatKey.guestId, trimmed);
  }

  /** Bring the scope row into view — it is above the fold only at the top. */
  private revealSeatRow(): void {
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelector(
          '[data-testid="booking-seat-scope"]',
        );
        // jsdom has no layout and no `scrollIntoView` — this is polish, and
        // polish never throws in an environment that cannot do it.
        row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      },
      { injector: this.injector },
    );
  }

  private focusIn(selector: string): void {
    afterNextRender(
      () => {
        const el =
          this.host.nativeElement.querySelector<HTMLInputElement>(selector);
        el?.focus();
        el?.select?.();
      },
      { injector: this.injector },
    );
  }

  protected removeSeat(seat: SeatScopeVm): void {
    this.seatMenuKey.set(null);
    if (seat.seatKey.kind !== 'guest') return;
    // Whoever is left takes the scope — pointing at a person who is gone
    // would leave the catalog adding to nobody.
    if (this.activeSeat().key === seat.key) this.activeSeatKeyValue.set('self');
    this.store.removeGuest(seat.seatKey.guestId);
  }

  // ── The forward move ────────────────────────────────────────────────

  /**
   * The next person with an empty bag, if there is one.
   *
   * Ordered after the ACTIVE seat and wrapping, so "next" means the next one
   * the user has not dealt with rather than always the first in the row. The
   * wrap is INCLUSIVE (`<= seats.length`), so the active seat is the last
   * candidate rather than no candidate at all: an earlier version stopped one
   * short of it, which meant the person on screen could be the empty one and
   * the button would still read "Continue" — and it continued, leaving them
   * with nothing booked. That exclusion was itself a fix for a real bug (the
   * CTA "handing over" to the seat already selected is a `signal.set` of the
   * value it holds, which notifies nothing and made the button inert), so the
   * active-seat case is handled by BRANCHING in {@link advance} rather than
   * by pretending nobody is empty.
   */
  private readonly nextEmptySeat = computed<SeatScopeVm | null>(() => {
    const seats = this.seats();
    if (seats.length < 2) return null;
    const from = seats.findIndex((seat) => seat.key === this.activeSeat().key);
    for (let step = 1; step <= seats.length; step++) {
      const seat = seats[(from + step) % seats.length];
      if (seat && seat.lineCount === 0) return seat;
    }
    return null;
  });

  /**
   * The person still holding nothing IS the one the catalog is pointing at.
   *
   * There is nobody to hand over to here — the hand-over already happened, or
   * they were just added — so the forward move has no move to make. The CTA
   * says whose turn it is and goes quiet until they have something, which
   * keeps the rule where the user can see it instead of behind a press.
   */
  protected readonly activeSeatEmpty = computed(() => {
    const pending = this.nextEmptySeat();
    return pending !== null && pending.key === this.activeSeat().key;
  });

  /** Nothing in the bag, or somebody in the party still booking nothing. */
  protected readonly forwardBlocked = computed(
    () => this.store.lineCount() === 0 || this.activeSeatEmpty(),
  );

  /**
   * What the primary action says.
   *
   * A guest with an empty bag is almost always someone the user has not got
   * to yet, so the button hands them over BY NAME instead of letting the
   * party leave with a person who booked nothing — which would only surface
   * at the summary, several steps too late. Naming them is the point: "Next"
   * would be a mystery, "Maria's services" is a destination.
   *
   * Once the scope is already ON that person the sentence changes rather than
   * the button going blank: "Now for Maria" would be pointing at the screen
   * you are looking at, so it becomes "Choose for Maria" — the same fact, said
   * from where the user is standing.
   */
  protected readonly forwardLabel = computed(() => {
    const pending = this.nextEmptySeat();
    if (!pending) return this.transloco.translate('booking.continue');
    return this.transloco.translate(
      this.activeSeatEmpty()
        ? 'booking.services.pickFor'
        : 'booking.services.nextPerson',
      // Both read "… за {{person}}" — object position, see `objectLabel`.
      { person: pending.objectLabel },
    );
  });

  /** Hand over to the next empty person, or leave the step. */
  protected advance(): void {
    // Belt to the disabled binding's braces: the bag renders this same action
    // from its own bar, and a second surface is a second chance to press it.
    if (this.forwardBlocked()) return;
    const pending = this.nextEmptySeat();
    if (pending) {
      this.setActiveSeat(pending.key);
      return;
    }
    this.store.next();
  }

  // ── The detail sheet, in "add to bag" mode ──────────────────────────

  /** The service whose sheet is open (null = shut). */
  protected readonly detailsId = signal<string | null>(null);

  protected readonly detailsVm = computed<ServiceVm | null>(() => {
    const id = this.detailsId();
    if (!id) return null;
    const service = this.catalog.findService(id);
    return service ? this.catalog.toServiceVm(service) : null;
  });

  /** The line being edited, when the sheet was opened from the bag. */
  protected readonly editingLineId = signal<CartLineId | null>(null);

  protected readonly draftVariantId = signal<string | null>(null);
  protected readonly draftBarberId = signal<string | null>(null);

  /**
   * The two selects that sit ON the bar, stacked above the CTA.
   *
   * Not a form behind the button and not two sections up in the sheet: the
   * questions live where the answer is spent, in the thumb zone, and the CTA
   * stays disabled until both are answered so the price it names is the price
   * this line will cost (owner ruling 2026-07-31).
   */
  protected readonly variantMenuOpen = signal(false);
  protected readonly barberMenuOpen = signal(false);

  /**
   * The barbers who perform the open service, with THEIR terms for the
   * chosen variant — a select whose options don't say what they cost is a
   * select that makes you press one to find out.
   *
   * Cheapest first, on the terms actually shown: a list that claims
   * cheapest-first has to be one.
   */
  protected readonly performerOptions = computed(() => {
    const vm = this.detailsVm();
    if (!vm) return [];
    const variantId = this.draftVariantId();
    return vm.offerings
      .flatMap((offering) => {
        const barber = this.catalog
          .barberVms()
          .find((candidate) => candidate.id === offering.barberId);
        if (!barber) return [];
        const terms =
          (variantId ? offering.byVariant?.[variantId] : undefined) ??
          offering.base;
        return [
          {
            id: barber.id,
            name: barber.name,
            avatarSrc: barber.avatarSrc,
            price: terms.price,
            minutes: terms.minutes,
          },
        ];
      })
      .sort((a, b) => a.price - b.price);
  });

  /** The chosen barber, or `null` under "anyone". */
  protected readonly draftBarber = computed(() => {
    const id = this.draftBarberId();
    if (id === null) return null;
    return this.performerOptions().find((barber) => barber.id === id) ?? null;
  });

  /**
   * What each select says. Unset they ASK — a pull-down showing a
   * placeholder is the standard iOS form shape for a required choice, and the
   * two of them are the whole reason the CTA below is disabled.
   */
  protected readonly variantLabel = computed(() => {
    const chosen = this.detailsVm()?.variants.find(
      (variant) => variant.id === this.draftVariantId(),
    );
    return chosen
      ? this.content.text(chosen.name)
      : this.transloco.translate('booking.configure.variantPick');
  });

  protected readonly barberLabel = computed(() => {
    if (!this.barberAnswered()) {
      return this.transloco.translate('booking.configure.barberPick');
    }
    const barber = this.draftBarber();
    return barber
      ? this.content.text(barber.name)
      : this.transloco.translate('booking.configure.anyBarber');
  });

  /** One line per option: "35 мин · 15,50 €". */
  protected optionTerms(option: { minutes: number; price: number }): string {
    return `${this.content.durationRange(option.minutes, option.minutes)} · ${this.content.price(option.price)}`;
  }

  protected pickVariant(variantId: string): void {
    this.draftVariantId.set(variantId);
    this.variantMenuOpen.set(false);
  }

  protected pickBarber(barberId: string | null): void {
    // "Anyone" is `null`, which is also "not asked yet" — so the ANSWER is
    // tracked separately rather than inferred from the value. Without it a
    // user who deliberately chose "anyone" would look identical to one who
    // had not opened the select at all, and the CTA could not tell them apart.
    this.barberAnswered.set(true);
    this.draftBarberId.set(barberId);
    this.barberMenuOpen.set(false);
  }

  // ── The docked decision ─────────────────────────────────────────────

  /**
   * What the closed CTA says. It names the OUTCOME, which is why a blocked
   * service reads "replace and add" rather than being disabled with the way
   * out hidden in a footnote halfway up the sheet (owner ruling 2026-07-30).
   */
  protected readonly primaryLabel = computed(() => {
    const id = this.detailsId();
    if (id && this.isBlocked(id)) {
      return this.transloco.translate('booking.services.replace');
    }
    return this.transloco.translate(
      this.editingLineId() ? 'booking.services.save' : 'booking.services.add',
    );
  });

  /**
   * The same sentence the button is showing, spelled out with its subject.
   *
   * It has to follow {@link primaryLabel} rather than being pinned to "Add":
   * a button that reads "Replace it" and announces "Add a haircut for Maria"
   * lies to a screen reader, and gives a voice-control user words that match
   * nothing on screen (WCAG 2.5.3, Label in Name).
   */
  protected readonly primaryAria = computed(() => {
    const vm = this.detailsVm();
    if (!vm) return '';
    const params = {
      service: this.content.text(vm.name),
      // All three of these read "… за {{person}}" — object position.
      person: this.activeSeat().objectLabel,
    };
    const id = this.detailsId();
    if (id && this.isBlocked(id)) {
      return this.transloco.translate('booking.services.replaceAria', params);
    }
    return this.transloco.translate(
      this.editingLineId()
        ? 'booking.services.saveAria'
        : 'booking.services.addAria',
      params,
    );
  });

  /**
   * Both questions answered — the gate on the CTA.
   *
   * A variant is required when the service declares any, and the barber is
   * required always: "anyone" is a real answer, but it has to be GIVEN. The
   * select says "choose barber" until then, and a CTA that went live while
   * the control beside it still reads as a question would be adding on an
   * assumption the user never made (owner ruling 2026-07-31).
   */
  protected readonly canAdd = computed(() => {
    return this.variantAnswered() && this.barberAnswered();
  });

  /**
   * Whether the variant question is settled — nothing, when there is none.
   *
   * The barber select waits on it: every option's price and duration come
   * from the variant, so an open select would be quoting terms that are
   * about to change (owner ruling 2026-07-31).
   */
  protected readonly variantAnswered = computed(() => {
    const vm = this.detailsVm();
    if (!vm) return false;
    return vm.variants.length === 0 || this.draftVariantId() !== null;
  });

  /**
   * Whether the barber select has been answered.
   *
   * Tracked separately because "anyone" IS `null` — inferring the answer from
   * the value would make a deliberate "anyone" look identical to a select
   * nobody has opened.
   */
  protected readonly barberAnswered = signal(false);

  /** Live price for the current draft — what the CTA is committing to. */
  protected readonly livePrice = computed(() => {
    const vm = this.detailsVm();
    if (!vm) return 0;
    const barberId = this.draftBarberId();
    const variantId = this.draftVariantId();
    const offering = barberId
      ? vm.offerings.find((candidate) => candidate.barberId === barberId)
      : undefined;
    if (!offering) {
      // "Anyone" quotes the cheapest performer — v2's `price.from` semantics.
      const prices = vm.offerings.map(
        (candidate) =>
          (variantId ? candidate.byVariant?.[variantId] : undefined)?.price ??
          candidate.base.price,
      );
      return prices.length > 0 ? Math.min(...prices) : 0;
    }
    return (
      (variantId ? offering.byVariant?.[variantId] : undefined)?.price ??
      offering.base.price
    );
  });

  /**
   * True while the price shown is a RANGE rather than this line's price.
   *
   * The CTA names the whole span — "Добави 9,00 – 15,00 €" — instead of
   * hedging with a "from": a range states both ends, which is what someone
   * deciding whether to open the selects actually wants to know. Once both
   * selects are answered there is one number and it stops being a range.
   */
  protected readonly priceRangeLabel = computed(() => {
    const prices = this.performerOptions().map((option) => option.price);
    if (prices.length === 0) return this.content.price(this.livePrice());

    // A NAMED barber pins one number. "Anyone" does not — whoever is free
    // decides, and the price moves with them — so the span is the honest
    // answer even once the choice is made and the CTA is live. Quoting the
    // cheapest there would name a price the booking may not cost.
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    if (this.draftBarberId() === null && low !== high) {
      return `${this.content.price(low)} – ${this.content.price(high)}`;
    }
    return this.content.price(this.livePrice());
  });

  /** Drop this line and leave — the way OUT of a service already chosen. */
  protected removeOpenLine(): void {
    const editing = this.editingLineId();
    if (!editing) return;
    this.store.removeLine(this.activeSeat().seatKey, editing);
    this.closeDetails();
  }

  protected openDetails(serviceId: string): void {
    // A service this person ALREADY has opens for editing, not for a second
    // add. One person cannot have two of the same service, so "add again" is
    // not a thing the sheet could do — and a press that silently changed
    // nothing (which is what a refused duplicate looked like) is worse than
    // one that opens the choices they made last time.
    const existing = this.store
      .cart()
      ?.linesFor(this.activeSeat().seatKey)
      .find((line) => line.serviceId.value === serviceId);
    if (existing) {
      this.editLine(existing.id);
      return;
    }

    this.detailsId.set(serviceId);
    this.editingLineId.set(null);
    // Nothing is pre-picked, including a sole variant: the variant re-prices
    // the service, and a price the user never agreed to is not a saved tap
    // (owner ruling 2026-07-30).
    this.draftVariantId.set(null);
    this.draftBarberId.set(null);
    this.barberAnswered.set(false);
    // A NEW subject, with the sheet still mounted — everything transient has
    // to stand down or it would be answering about the service you just left.
    this.resetBarChrome();
  }

  /** Reopen the sheet on an existing line, with its choices restored. */
  protected editLine(lineId: CartLineId): void {
    const cart = this.store.cart();
    const line = cart
      ?.linesFor(this.activeSeat().seatKey)
      .find((candidate) => candidate.id.equals(lineId));
    if (!line) return;
    this.detailsId.set(line.serviceId.value);
    this.editingLineId.set(lineId);
    this.draftVariantId.set(line.variantId?.value ?? null);
    this.draftBarberId.set(
      line.barberPref.kind === 'specific'
        ? line.barberPref.barberId.value
        : null,
    );
    // A saved line HAS an answer for both, whatever it was — reopening it must
    // not present them as unasked.
    this.barberAnswered.set(true);
    this.resetBarChrome();
  }

  protected closeDetails(): void {
    this.detailsId.set(null);
    this.editingLineId.set(null);
    // The drafts used to outlive the sheet, so a dismissed sheet came back
    // pre-filled on the NEXT service.
    this.draftVariantId.set(null);
    this.draftBarberId.set(null);
    this.barberAnswered.set(false);
    this.resetBarChrome();
  }

  /** Shut the transient bits of the bar. */
  private resetBarChrome(): void {
    this.variantMenuOpen.set(false);
    this.barberMenuOpen.set(false);
  }

  /**
   * Commit: replace whatever blocks this service, if anything, then add.
   *
   * The order matters and so does the guard — an earlier version removed the
   * blocking lines and THEN called an add that silently bailed on an
   * unchosen variant, destroying the user's existing booking and adding
   * nothing in its place.
   */
  protected confirm(): void {
    if (!this.canAdd()) return;
    const id = this.detailsId();
    if (id && this.isBlocked(id)) {
      this.replaceBlockers();
      return;
    }
    this.addLine();
  }

  /** Drop every line blocking the open service, then add it. One dispatch each. */
  protected replaceBlockers(): void {
    const cart = this.store.cart();
    const id = this.detailsId();
    if (!cart || !id || !this.canAdd()) return;
    const blockedNames = new Set(this.blockersFor(id));
    if (blockedNames.size === 0) return;

    for (const line of cart.linesFor(this.activeSeat().seatKey)) {
      const service = this.catalog.findService(line.serviceId.value);
      if (!service) continue;
      const name = this.content.text(this.catalog.toServiceVm(service).name);
      if (blockedNames.has(name)) {
        this.store.removeLine(this.activeSeat().seatKey, line.id);
      }
    }
    this.addLine();
  }

  protected addLine(): void {
    const id = this.detailsId();
    if (!id || !this.canAdd()) return;

    const serviceIdResult = ServiceId.create(id);
    if (serviceIdResult.isFailure()) return;

    const rawVariantId = this.draftVariantId();
    let variantId: ServiceVariantId | null = null;
    if (rawVariantId !== null) {
      const result = ServiceVariantId.create(rawVariantId);
      if (result.isFailure()) return;
      variantId = result.value;
    }

    let barberPref = BarberPref.any();
    const rawBarberId = this.draftBarberId();
    if (rawBarberId !== null) {
      const result = BarberId.create(rawBarberId);
      if (result.isFailure()) return;
      barberPref = BarberPref.specific(result.value);
    }

    const editing = this.editingLineId();
    if (editing) {
      // Editing keeps the line's identity so the bag does not reorder under
      // the user while they are looking at it.
      this.store.setLineVariant(this.activeSeat().seatKey, editing, variantId);
      this.store.setLineBarber(this.activeSeat().seatKey, editing, barberPref);
    } else {
      this.store.addLine(this.activeSeat().seatKey, {
        serviceId: serviceIdResult.value,
        variantId,
        barberPref,
      });
    }
    this.closeDetails();
  }

  // ── The bag ─────────────────────────────────────────────────────────

  protected readonly bagOpen = signal(false);

  /**
   * Reopen a bag line in the full sheet.
   *
   * The seat is scoped FIRST: `editLine` writes through the active seat, so
   * committing a guest's line while the scope still pointed at the booker
   * would move it between people. Closing the bag is part of the same move —
   * two sheets on top of each other is not an edit, it is a stack.
   */
  protected editFromBag(request: {
    seatKey: string;
    lineId: CartLineId;
  }): void {
    this.setActiveSeat(request.seatKey);
    this.editLine(request.lineId);
    this.bagOpen.set(false);
  }

  protected leaveBag(): void {
    this.bagOpen.set(false);
  }
}
