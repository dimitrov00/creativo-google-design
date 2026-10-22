import {
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, take } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  WAITLIST_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AppointmentId, type UserId } from '@core/primitives';
import {
  BookingFlowStep,
  MoveRefusal,
  MoveRefusalReason,
  Principal,
} from '@core/components';
import { ShopReachSystem } from '@core/systems';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiFrameDirective,
  UiMaterialDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiEmptyState, UiStepper } from '@creativo/ui/patterns';
import { AccountStateService } from '@creativo/features/client/account-state';
import { CatalogContentService } from '@creativo/features/shared/catalog';
import { BookingFlowStore } from '../booking-flow.store';
import {
  BOOKING_STEP_WORDS,
  MOVE_REFUSAL_WORDS,
  bookingStepOfWord,
} from '../booking-words';
import { carriedSeatsInReach } from './carried-reach';
import {
  BookingChromeHeight,
  BookingChromeService,
} from '../chrome/booking-chrome.service';
import { BookingConfirmedStep } from '../confirmed-step/booking-confirmed-step';
import { BookingWaitlistedStep } from '../waitlisted-step/booking-waitlisted-step';
import { BookingLocationStep } from '../location-step/booking-location-step';
import { BookingReviewStep } from '../review-step/booking-review-step';
import { BookingScheduleStep } from '../schedule-step/booking-schedule-step';
import { BookingServicesStep } from '../services-step/booking-services-step';
import { BookingStepLayout } from '../step-layout/booking-step-layout';

/**
 * The `/book` wizard shell — quiet navigation-stack chrome around whichever
 * step the machine is on, exactly the skeleton `/auth` and `/onboarding`
 * ship (owner ruling 2026-07-25): sticky toolbar reading as plain page
 * surface, icon-only back chevron, caption-less stepper, content
 * top-anchored rather than vertically centred.
 *
 * **No site header or footer.** `/book` is a task flow, and the screen
 * belongs to the task.
 *
 * **No route guard.** Browsing is anonymous; the auth prompt appears at
 * commitment, paired with its benefit (owner ruling 2026-07-29). When the
 * principal turns active mid-flow the store claims the party in place, so
 * signing in never costs the user what they assembled.
 *
 * ### The `?step=` contract
 * One route, the step in a query param — blueprint §5.3, and what goal
 * 6.5's exit gate tests. The Router is the single history authority; there
 * is deliberately no `popstate` listener anywhere (§7.5's dual-listener
 * bug). The binding is asymmetric on purpose:
 *
 * - **State → URL** on every advance, without `replaceUrl`, so each step is
 *   its own history entry and one browser Back moves exactly one step.
 * - **URL → state BACKWARD ONLY** (`rewindTo`). A hand-typed forward step
 *   is ignored: every forward transition has a precondition the machine
 *   checks, and an address bar cannot satisfy one.
 */
@Component({
  selector: 'lib-client-booking',
  imports: [
    BookingChromeHeight,
    NgTemplateOutlet,
    BookingConfirmedStep,
    BookingWaitlistedStep,
    BookingLocationStep,
    BookingReviewStep,
    BookingScheduleStep,
    BookingServicesStep,
    BookingStepLayout,
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiEmptyState,
    UiFrameDirective,
    UiMaterialDirective,
    UiIcon,
    UiSpacer,
    UiStack,
    UiStepper,
    UiTextDirective,
    UiToolbar,
  ],
  templateUrl: './client-booking.html',
  styleUrl: './client-booking.css',
  providers: [BookingFlowStore, BookingChromeService],
  host: {
    // The v2 E2E selector contract, preserved verbatim (blueprint §5.3) —
    // this overrides the house `*-page` testid convention on purpose. The
    // state is the step's lowercase word (`BOOKING_STEP_WORDS`).
    'data-testid': 'booking-machine',
    '[attr.data-state]': 'stepWord()',
  },
})
export class ClientBooking {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountState = inject(AccountStateService);

  protected readonly store = inject(BookingFlowStore);
  protected readonly chrome = inject(BookingChromeService);

  /** The wizard's steps, as the template switches on them. */
  protected readonly Step = BookingFlowStep;

  /** The refusal panel's i18n keys and `data-reason`, one word per reason. */
  protected readonly refusalWords = MOVE_REFUSAL_WORDS;

  /** The step as the URL (`?step=`) and the DOM (`data-state`) spell it. */
  protected readonly stepWord = computed(
    () => BOOKING_STEP_WORDS[this.store.step()],
  );

  /** Bound from `?step=` by `withComponentInputBinding()` (already enabled). */
  readonly step = input<string | undefined>(undefined);

  /** `?waitlist={requestId}&day={YYYY-MM-DD}` — the match notification's deep link. */
  readonly waitlist = input<string | undefined>(undefined);
  readonly day = input<string | undefined>(undefined);

  /** `?repeat={appointmentId}` — "the same again", from a past visit. */
  readonly repeat = input<string | undefined>(undefined);

  /** `?reschedule={appointmentId}` — the SAME booking, at a new time. */
  readonly reschedule = input<string | undefined>(undefined);

  private readonly waitlistReads = inject(WAITLIST_READ_PORTS);
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CatalogContentService);

  /**
   * Land the deep link: fetch the caller's own request and rebuild the flow
   * around it — bag, shop, and the freed day already selected, times sheet
   * opening on its own. The notification promised a live search; a blank
   * wizard with no memory of why you came is not that.
   *
   * Every failure path falls through SILENTLY to the ordinary entry (draft
   * restore already ran): a lapsed request, a foreign id, a retired service —
   * none of them are worth an error screen over what is still a working
   * booking flow.
   */
  private async landWaitlistDeepLink(
    requestId: string,
    owner: UserId,
  ): Promise<void> {
    // The caller's OWN requests (`ownerUserId ==`, owner-readable), first
    // answer — a foreign id is simply not among them.
    const mine = await firstValueFrom(
      this.waitlistReads.observeMyWaitlistRequests(owner).pipe(take(1)),
    );
    if (!mine.ok) return;
    const found = mine.value.find((request) => request.id === requestId);
    if (found === undefined) return;
    // The day is a shop day as it stands; the zone it is judged in is the
    // schedule step's (the location's, Law 7.2).
    this.store.restoreFromWaitlist(found, this.day() ?? null, (ordinal) =>
      this.transloco.translate('booking.party.guest', {
        number: ordinal,
      }),
    );
  }

  /** One reading of the live visit — its first answer (owner-readable). */
  private async readVisit(appointmentId: string) {
    const id = AppointmentId.parse(appointmentId);
    if (!id.ok) return null;
    const found = await firstValueFrom(
      this.appointments.observeAppointment(id.value).pipe(take(1)),
    );
    return found.ok ? found.value : null;
  }

  /**
   * Land "the same again": fetch the visit and rebuild the bag around it.
   * The store keeps the visit as the booking's source, so the commit carries
   * the rebooking edge (`bookedFromAppointmentId`).
   *
   * Owner-scoped like the waitlist read, and silent on every failure path —
   * a retired service or a foreign id is not worth an error screen over
   * what is still a perfectly good booking flow.
   */
  private async landRepeat(appointmentId: string): Promise<void> {
    // A CONTINUATION that already holds this source (a reload after the
    // landing ran) has nothing to do: the draft brought it back.
    if (this.restoredDraft && this.store.bookedFrom() === appointmentId) return;

    const found = await this.readVisit(appointmentId);
    if (found === null) return;
    if (this.restoredDraft) {
      // The person's own flow is back (the sign-in round trip of somebody who
      // arrived signed out and built the bag themselves): attach the visit it
      // started from, never overwrite what they built.
      this.store.attachRepeatSource(found);
      return;
    }
    this.store.repeat(found, (ordinal) =>
      this.transloco.translate('booking.party.guest', { number: ordinal }),
    );
  }

  /**
   * Land a move: the same bag as the appointment being moved, and the store
   * told to COMMIT it as a move rather than as a second booking.
   *
   * NOT silent on failure, unlike the two landings above. They open a new
   * booking either way, so falling through to the ordinary flow loses
   * nothing; a move link that falls through opens a bookable flow whose
   * Confirm writes a SECOND visit beside the one the person meant to move.
   * Every way this cannot become that move is a refusal the shell shows
   * instead of the wizard (`BookingFlowStore.moveRefusal`).
   */
  private async landReschedule(appointmentId: string): Promise<void> {
    // Already moving THIS visit (a reload, or the round trip of a flow that
    // landed signed in): the restored draft is the move, and its bag stays
    // as built. What the grid decides it with (who is carried, which chairs
    // are its own) is as old as the landing, so that alone is re-read from
    // the stored visit. Otherwise the bag is rebuilt from the visit even on
    // a continuation — a move is the SAME booking, so what is booked, not a
    // bag assembled before the visit could be read, is what moves.
    if (this.restoredDraft && this.store.rescheduleOf() === appointmentId) {
      await this.store.rereadMove();
      return;
    }
    const found = await this.readVisit(appointmentId);
    if (found === null) {
      this.store.refuseMove(MoveRefusalReason.Unavailable);
      return;
    }
    // Refuses on its own when the visit cannot move here — see `MoveRefusal`.
    this.store.rescheduleFrom(found, (ordinal) =>
      this.transloco.translate('booking.party.guest', { number: ordinal }),
    );
  }

  /**
   * A move whose carried seats the shop can no longer serve at all
   * (`carriedSeatsInReach`): a barber or service is gone, or no active shop
   * offers every carried service together. It ends in the call panel, not in
   * a grid with nothing on it.
   *
   * Asked only once BOTH catalogue reads have answered SUCCESSFULLY. An
   * unanswered read and a failed one both render as an empty list, and
   * either would refuse every move with a companion on it: "the list did not
   * arrive" is not "everyone is gone". The shops are the same, a third read:
   * until it has answered successfully the shop question is not asked, and
   * the barber, service and variant ones still are. A computed rather than a
   * latched refusal: it follows the live catalogue, so a barber put back on
   * the list reopens the move.
   */
  private readonly carriedRefusal = computed<MoveRefusal | null>(() => {
    const riders = this.store.moveRiders();
    if (riders.length === 0) return null;
    if (!this.catalog.servicesKnown() || !this.catalog.barbersKnown()) {
      return null;
    }
    return carriedSeatsInReach(
      riders,
      this.catalog.services(),
      this.catalog.barbers(),
      this.catalog.locationsKnown() ? this.catalog.locations() : null,
    )
      ? null
      : MoveRefusal.of(
          MoveRefusalReason.CarriedOutOfReach,
          this.store.locationId(),
        );
  });

  /**
   * Why this move cannot happen here, if it cannot: what the landing decided
   * (`BookingFlowStore.moveRefusal`), else what the catalogue says about the
   * people it carries. The shell shows it INSTEAD of the wizard.
   *
   * Never once the flow has ended. A move the server accepted is answered,
   * and the live catalogue changing afterwards (the companion's barber taken
   * off the list, say) must not replace its confirmation with a refusal.
   */
  protected readonly refusal = computed<MoveRefusal | null>(() => {
    if (this.store.isTerminal()) return null;
    return this.store.moveRefusal() ?? this.carriedRefusal();
  });

  /**
   * `tel:` for the shop of a refused move, when the catalogue knows it — a
   * companion only the shop can move is one phone call away, so the refusal
   * offers the call rather than just describing it.
   */
  private readonly refusalReach = computed(() =>
    // The catalogue's shops as they are: id, number and pin at their roots.
    ShopReachSystem.reach(
      this.catalog.locations(),
      this.refusal()?.locationId ?? null,
    ),
  );

  protected readonly refusalCallHref = computed(
    () => this.refusalReach().callHref,
  );

  /**
   * How the refusal's copy sends the client to the shop: "call" beside the
   * call button, "get in touch" when there is no number to dial — a shop
   * missing from the active catalogue, or locations still loading
   * (`ShopReach`).
   */
  protected readonly reachKey = computed(() => this.refusalReach().reach);

  /** One-shot latch — the deep link lands exactly once per visit. */
  private waitlistLanded = false;
  private repeatLanded = false;
  private rescheduleLanded = false;

  /** A draft came back in the constructor — see the continuation rule there. */
  private restoredDraft = false;

  constructor() {
    // A draft resumes only on a CONTINUATION, never on a fresh arrival.
    //
    // Tapping "Book now" and landing three steps in — someone else's day
    // already picked, someone else's bag already full — is the wizard
    // answering a question nobody asked. `/book` with nothing in the URL is
    // a person starting a booking, so it starts one.
    //
    // Every genuine continuation announces itself IN THE URL, which is what
    // makes this safe: the sign-in round trip returns to `?step=schedule`,
    // a reload and browser Back/Forward carry the step they were on, and a
    // waitlist match arrives as `?waitlist=…`. Those restore. Nothing else
    // does — and the stale draft is dropped rather than left to ambush the
    // next reload, which would otherwise restore a flow the user had just
    // been shown the start of.
    const params = this.route.snapshot.queryParamMap;
    // A `?step=` is a CONTINUATION whatever rides beside it: the sign-in
    // round trip comes back as `?step=schedule&repeat=…` (the source it could
    // not read signed out), and the machine writes `step` next to a landed
    // `?repeat=` too, so a reload carries both. Clearing the draft there
    // threw away the bag and the day the round trip exists to keep.
    //
    // Without a step, `?repeat=` / `?reschedule=` is a FRESH arrival that
    // starts a new, prefilled flow — the draft it replaces must go, or the
    // prefill lands on top of it.
    if (params.has('step') || params.has('waitlist')) {
      this.restoredDraft = this.store.restore();
    } else {
      this.store.clearDraft();
    }

    // A move link binds the flow to THAT move before anything is read:
    // until the visit lands (or is refused), Confirm cannot quietly become a
    // new booking — see `BookingFlowStore.expectMove`.
    const moveId = params.get('reschedule');
    if (moveId) this.store.expectMove(moveId);

    // The deep link can only be honoured once the PRINCIPAL is live: the
    // request is owner-readable, and on a cold tab Firebase auth hydrates
    // asynchronously — a constructor-time read raced it, got a rules denial
    // dressed as "no such request", and silently fell through to a blank
    // wizard (caught live by the E2E journey). Waiting on the principal is
    // not polish; it is the difference between the feature existing and not.
    effect(() => {
      const principal = this.accountState.principal();
      const waitlistId = this.waitlist();
      if (this.waitlistLanded || !waitlistId) return;
      if (!Principal.isActive(principal)) return;
      this.waitlistLanded = true;
      untracked(
        () => void this.landWaitlistDeepLink(waitlistId, principal.userId),
      );
    });

    // Same rule, same reason: the appointment is owner-readable, and on a
    // cold tab Firebase auth hydrates asynchronously.
    //
    // Both claim FIRST. The claim releases a restored source some OTHER
    // account read, and the landings' "already holding this visit" shortcut
    // must see the flow after that release — not before it, which is where
    // effect order alone would put it (the claim effect is declared last).
    effect(() => {
      const principal = this.accountState.principal();
      const repeatId = this.repeat();
      if (this.repeatLanded || !repeatId) return;
      if (!Principal.isActive(principal)) return;
      this.repeatLanded = true;
      untracked(() => {
        this.store.claim(principal.userId);
        void this.landRepeat(repeatId);
      });
    });

    effect(() => {
      const principal = this.accountState.principal();
      const moveId = this.reschedule();
      if (this.rescheduleLanded || !moveId) return;
      if (!Principal.isActive(principal)) return;
      this.rescheduleLanded = true;
      untracked(() => {
        this.store.claim(principal.userId);
        void this.landReschedule(moveId);
      });
    });

    // State → URL. Depends on the machine ONLY. `replaceUrl` stays false so
    // each step is its own history entry and Back walks the wizard.
    effect(() => {
      const word = this.stepWord();
      untracked(() => {
        this.writeStepParam(word);
        // A new step starts at ITS top. Same-route query navigation keeps
        // the scroll where the last step left it, so a step advanced from
        // halfway down arrived halfway down — with the sticky action bar
        // hanging mid-air over a page shorter than the leftover offset.
        window.scrollTo(0, 0);
      });
    });

    // URL → state. Depends on the query param ONLY.
    //
    // `untracked` here is load-bearing, not tidiness: `rewindTo` reads the
    // store's own signals, so without it this effect would also re-run on
    // every STATE change — including the instant `next()` advances. At that
    // moment the URL is still one step behind, so the effect would read it
    // as a browser-Back and rewind the advance it had just seen.
    effect(() => {
      const urlStep = this.step();
      untracked(() => {
        if (!urlStep || urlStep === this.stepWord()) return;

        // A URL BEHIND the machine is a browser Back — rewind to it. A word
        // that names no step rewinds nothing.
        const target = bookingStepOfWord(urlStep);
        if (target !== null) this.store.rewindTo(target);

        // Still out of step? Then the URL was AHEAD — a browser Forward or
        // a hand-typed param, which cannot satisfy a forward transition's
        // preconditions. The machine is the truth, so the URL is corrected
        // back to it rather than left describing a screen nobody is on.
        if (this.stepWord() !== urlStep) {
          this.writeStepParam(this.stepWord());
        }
      });
    });

    // Sign-in can land mid-flow (the review step's round trip). Claiming for
    // the account that already holds the party is a no-op, so re-running on
    // unrelated principal changes is harmless; a DIFFERENT account re-binds
    // the party to itself (see `BookingFlowStore.claim`).
    effect(() => {
      const principal = this.accountState.principal();
      if (Principal.isActive(principal)) {
        this.store.claim(principal.userId);
      }
    });
  }

  /** Put the step's word in the query string, unless it is already there. */
  private writeStepParam(step: string): void {
    if (step === this.route.snapshot.queryParamMap.get('step')) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Leave the flow. An explicit `await` continuation off the user's tap,
   * never an `effect()` watching store state — the documented zoneless +
   * `withViewTransitions()` hazard (`client-auth.ts`).
   */
  protected async leave(): Promise<void> {
    this.store.clearDraft();
    await this.router.navigate(['/']);
  }
}
