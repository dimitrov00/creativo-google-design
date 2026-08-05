import { Component, effect, inject, input, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  APPOINTMENT_REPOSITORY,
  AppointmentId,
  WAITLIST_READER,
} from '@creativo/application/booking';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import { UiFrameDirective, UiMaterialDirective } from '@creativo/ui/modifiers';
import { UiStepper } from '@creativo/ui/patterns';
import { AccountStateService } from '@creativo/features/client/account-state';
import { BookingFlowStore } from '../booking-flow.store';
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
    TranslocoDirective,
    UiButton,
    UiFrameDirective,
    UiMaterialDirective,
    UiIcon,
    UiSpacer,
    UiStack,
    UiStepper,
    UiToolbar,
  ],
  templateUrl: './client-booking.html',
  styleUrl: './client-booking.css',
  providers: [BookingFlowStore, BookingChromeService],
  host: {
    // The v2 E2E selector contract, preserved verbatim (blueprint §5.3) —
    // this overrides the house `*-page` testid convention on purpose.
    'data-testid': 'booking-machine',
    '[attr.data-state]': 'store.step()',
  },
})
export class ClientBooking {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountState = inject(AccountStateService);

  protected readonly store = inject(BookingFlowStore);
  protected readonly chrome = inject(BookingChromeService);

  /** Bound from `?step=` by `withComponentInputBinding()` (already enabled). */
  readonly step = input<string | undefined>(undefined);

  /** `?waitlist={requestId}&day={dayKey}` — the match notification's deep link. */
  readonly waitlist = input<string | undefined>(undefined);
  readonly day = input<string | undefined>(undefined);

  /** `?repeat={appointmentId}` — "the same again", from a past visit. */
  readonly repeat = input<string | undefined>(undefined);

  /** `?reschedule={appointmentId}` — the SAME booking, at a new time. */
  readonly reschedule = input<string | undefined>(undefined);

  private readonly waitlistReader = inject(WAITLIST_READER);
  private readonly appointments = inject(APPOINTMENT_REPOSITORY);
  private readonly transloco = inject(TranslocoService);

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
  private async landWaitlistDeepLink(requestId: string): Promise<void> {
    const found = await this.waitlistReader.findMine(requestId);
    if (found.isFailure() || found.value === null) return;
    this.store.restoreFromWaitlist(found.value, this.day() ?? null, (ordinal) =>
      this.transloco.translate('booking.party.guest', {
        number: ordinal,
      }),
    );
  }

  /**
   * Land "the same again": fetch the visit and rebuild the bag around it.
   *
   * Owner-scoped like the waitlist read, and silent on every failure path —
   * a retired service or a foreign id is not worth an error screen over
   * what is still a perfectly good booking flow.
   */
  private async landRepeat(appointmentId: string): Promise<void> {
    const id = AppointmentId.create(appointmentId);
    if (id.isFailure()) return;

    const found = await this.appointments.findById(id.value);
    if (found.isFailure() || found.value === null) return;
    this.store.repeat(found.value, (ordinal) =>
      this.transloco.translate('booking.party.guest', { number: ordinal }),
    );
  }

  /**
   * Land a move: the same bag as the appointment being moved, and the store
   * told to COMMIT it as a move rather than as a second booking.
   */
  private async landReschedule(appointmentId: string): Promise<void> {
    const id = AppointmentId.create(appointmentId);
    if (id.isFailure()) return;

    const found = await this.appointments.findById(id.value);
    if (found.isFailure() || found.value === null) return;
    this.store.rescheduleFrom(found.value, (ordinal) =>
      this.transloco.translate('booking.party.guest', { number: ordinal }),
    );
  }

  /** One-shot latch — the deep link lands exactly once per visit. */
  private waitlistLanded = false;
  private repeatLanded = false;
  private rescheduleLanded = false;

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
    // `?repeat=` starts a NEW booking that happens to be prefilled — the
    // draft it replaces must go, or the prefill lands on top of it.
    if (params.has('repeat') || params.has('reschedule')) {
      this.store.clearDraft();
    } else if (params.has('step') || params.has('waitlist')) {
      this.store.restore();
    } else {
      this.store.clearDraft();
    }

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
      if (principal.kind !== 'active') return;
      this.waitlistLanded = true;
      untracked(() => void this.landWaitlistDeepLink(waitlistId));
    });

    // Same rule, same reason: the appointment is owner-readable, and on a
    // cold tab Firebase auth hydrates asynchronously.
    effect(() => {
      const principal = this.accountState.principal();
      const repeatId = this.repeat();
      if (this.repeatLanded || !repeatId) return;
      if (principal.kind !== 'active') return;
      this.repeatLanded = true;
      untracked(() => void this.landRepeat(repeatId));
    });

    effect(() => {
      const principal = this.accountState.principal();
      const moveId = this.reschedule();
      if (this.rescheduleLanded || !moveId) return;
      if (principal.kind !== 'active') return;
      this.rescheduleLanded = true;
      untracked(() => void this.landReschedule(moveId));
    });

    // State → URL. Depends on the machine ONLY. `replaceUrl` stays false so
    // each step is its own history entry and Back walks the wizard.
    effect(() => {
      const kind = this.store.step();
      untracked(() => {
        this.writeStepParam(kind);
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
        if (!urlStep || urlStep === this.store.step()) return;

        // A URL BEHIND the machine is a browser Back — rewind to it.
        this.store.rewindTo(urlStep);

        // Still out of step? Then the URL was AHEAD — a browser Forward or
        // a hand-typed param, which cannot satisfy a forward transition's
        // preconditions. The machine is the truth, so the URL is corrected
        // back to it rather than left describing a screen nobody is on.
        if (this.store.step() !== urlStep) {
          this.writeStepParam(this.store.step());
        }
      });
    });

    // Sign-in can land mid-flow (the review step's round trip). Claiming is
    // a no-op on an already-claimed party, so re-running on unrelated
    // principal changes is harmless.
    effect(() => {
      const principal = this.accountState.principal();
      if (principal.kind === 'active') {
        this.store.claim(principal.uid.value);
      }
    });
  }

  /** Put `step` in the query string, unless it is already there. */
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
