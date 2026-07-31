import { Component, effect, inject, input, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import { UiFrameDirective, UiMaterialDirective } from '@creativo/ui/modifiers';
import { UiStepper } from '@creativo/ui/patterns';
import { AccountStateService } from '@creativo/features/client/account-state';
import { BookingFlowStore } from '../booking-flow.store';
import { BookingChromeService } from '../chrome/booking-chrome.service';
import { BookingConfirmedStep } from '../confirmed-step/booking-confirmed-step';
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
    BookingConfirmedStep,
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

  constructor() {
    this.store.restore();

    // State → URL. Depends on the machine ONLY. `replaceUrl` stays false so
    // each step is its own history entry and Back walks the wizard.
    effect(() => {
      const kind = this.store.step();
      untracked(() => this.writeStepParam(kind));
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
