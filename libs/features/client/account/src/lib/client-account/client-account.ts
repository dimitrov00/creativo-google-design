import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { APPOINTMENT_READ_PORTS } from '@creativo/infrastructure/firebase-app';
import type { Appointment } from '@core/entities';
import { UserId } from '@core/primitives';
import { WallTime } from '@core/components';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  SessionIdentityService,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import {
  VisitCard,
  type VisitCardVm,
  type VisitCardWords,
  type VisitLookup,
  type VisitWords,
  visitCardOf,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import {
  UiButton,
  UiIcon,
  UiProgressRing,
  UiSkeleton,
} from '@creativo/ui/controls';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiEmptyState,
  UiListGroup,
  UiListRow,
} from '@creativo/ui/patterns';
import {
  UiFrameDirective,
  UiPaddingDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';

type UpcomingState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' }
  | { readonly kind: 'populated'; readonly appointment: Appointment };

/** The words the shared card is built from, once the catalogue has loaded. */
interface CardWords {
  readonly lang: string;
  readonly words: VisitWords;
  readonly cardWords: VisitCardWords;
  /** «Предстоящ час» — the card's own heading (`account.upcoming.title`). */
  readonly label: string;
}

/**
 * The catalogue as the card reads it — and this page reads none. With the
 * services and the barber left off the card (client-card revision 3 §3.10;
 * owner question Q7 may turn them on), nothing it would name is drawn, and
 * the client's home does not open the catalogue's three live reads for the
 * one word a reader would hear in the card's sentence. Until Q7, that word
 * is «Посещение» (`appointments.visit.unknownService`) where the service's
 * name would go; with Q7 the catalogue comes in as `/account/appointments`
 * reads it (`CatalogContentService`).
 */
const NO_CATALOGUE: VisitLookup = {
  serviceName: () => null,
  barberName: () => null,
  barberAvatarSrc: () => null,
  locationName: () => null,
  locationCount: 0,
};

/**
 * `/account` — the signed-in client's home. Top to bottom:
 *
 *  - THE shared site header (one nav component app-wide); its monogram menu
 *    carries the account rows, the preferences and sign-out, so the page
 *    has no chrome of its own.
 *  - Three live tiles: book a visit (`/book`), my appointments
 *    (`/account/appointments`) and my profile (`/account/profile`).
 *  - The next visit, from the live `APPOINTMENT_READ_PORTS.observeUpcoming`
 *    stream, as
 *    the SHARED visit card (`lib-visit-card`, client-card revision 3 §3.10,
 *    R2-I — the card the staff glance draws too): «Предстоящ час» as the
 *    card's own heading, the day and the hour in the SHOP's zone, the
 *    status capsule in the appointments screen's words; the whole card is
 *    the way to the visit on «Моите часове», where its sheet opens on
 *    arrival. Before it: loading, or an error line, or the honest empty
 *    state with a booking CTA. Loading is never shown as empty.
 *  - The profile-completion nudge while the profile is incomplete: a
 *    decorative `ui-progress-ring` (the line beside it says the progress in
 *    words) and one row per checklist item, where an open item is a REAL
 *    control (`uiInteractive`: the house hover and press) that deep-links
 *    into its onboarding personalization step. It waits for the photo
 *    lookup, and leaves once the profile is complete; the host's
 *    `data-completion` (`checking` / `open` / `complete`) tells those
 *    apart from outside, as its `data-upcoming` tells the next visit's
 *    state (the drawn card is a button and wears none of its own).
 *
 * The principal and the profile come from `AccountStateService`'s one live
 * account snapshot, and the photo lookup and the completion from
 * `SessionIdentityService` — the SAME lookup and the same computation the
 * header's portrait and the menu's nudge read (round 6, 2026-09-26: this
 * page ran a second Storage lookup and a second `profileCompletion` of its
 * own). Nothing here re-implements auth, profile fetching or the checklist.
 *
 * Still owed (the 6.3 row of `docs/migration/v2-parity-checklist.md`): v2's
 * loyalty summary. `REWARD_PROGRESS_READER.observeForUser` needs a program
 * id and there is no program-catalogue read port to find one — goal 6.6's
 * "Rewards, coupons, invites" job.
 */
@Component({
  selector: 'lib-client-account',
  imports: [
    RouterLink,
    SiteHeaderComponent,
    TranslocoDirective,
    UiButton,
    UiCard,
    UiEmptyState,
    UiFrameDirective,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiPaddingDirective,
    UiProgressRing,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    VisitCard,
  ],
  templateUrl: './client-account.html',
  styleUrl: './client-account.css',
  host: {
    'data-testid': 'account-page',
    '[attr.data-state]': "accountState.accountLoading() ? 'loading' : 'ready'",
    '[attr.data-completion]': 'completionState()',
    '[attr.data-upcoming]': 'upcomingState()',
  },
})
export class ClientAccount {
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  protected readonly accountState = inject(AccountStateService);

  /** The photo lookup and the checklist — the shell's, shared with the header and the menu. */
  private readonly identity = inject(SessionIdentityService);

  /**
   * "Now", once, as the page opened — what the card measures its day
   * against («днес», the year only outside the current one). A snapshot
   * rather than a clock read inside a `computed`, which would be a value
   * that changes under a pure function; the appointments store fixes its
   * `today` the same way.
   */
  private readonly openedAtMs = Date.now();

  /** The nudge card's model — null while loading AND once complete: a
   *  finished profile shows no completion card at all (Apple's suggestion
   *  cards disappear when done; owner ruling 2026-07-27). */
  protected readonly completion = this.identity.completion;

  /**
   * The same answer as a state, on the host: with the card gone once the
   * profile is complete, "complete" and "not known yet" would otherwise look
   * identical from outside — an absent card either way.
   */
  protected readonly completionState = computed(() => {
    const progress = this.identity.profileProgress();
    if (progress === null) return 'checking';
    return progress.complete ? 'complete' : 'open';
  });

  private readonly upcomingResult = toSignal(
    toObservable(this.accountState.principal).pipe(
      switchMap((principal) => {
        if (principal.kind !== 'active') return of(null);
        const userIdResult = UserId.parse(principal.uid.value);
        if (!userIdResult.ok) return of(null);
        return this.appointments.observeUpcoming(userIdResult.value);
      }),
    ),
    { initialValue: undefined },
  );

  protected readonly upcoming = computed<UpcomingState>(() => {
    const result = this.upcomingResult();
    if (result === undefined) return { kind: 'loading' };
    if (result === null) return { kind: 'empty' };
    if (!result.ok) return { kind: 'error' };

    // The soonest, on the shop's wall clock (`localDate` + `startMinutes`).
    const next = [...result.value].sort((a, b) =>
      WallTime.compare(
        WallTime.of(a.localDate, a.startMinutes),
        WallTime.of(b.localDate, b.startMinutes),
      ),
    )[0];
    return next ? { kind: 'populated', appointment: next } : { kind: 'empty' };
  });

  /**
   * The language the catalogue has LOADED, once it has (the appointments
   * page's rule): the card's words are built from it with
   * `translate(…, lang)`, so no lookup inside a `computed` can start a load
   * — a write the computed would read back and never settle on.
   */
  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.selectTranslation(lang).pipe(map(() => lang)),
      ),
    ),
    { initialValue: null },
  );

  /** The shared card's words in the client's perspective, and the page's own heading for it. */
  private readonly cardWords = computed<CardWords | null>(() => {
    const lang = this.loadedLang();
    if (lang === null) return null;
    const translate = (
      key: string,
      params?: Readonly<Record<string, string | number>>,
    ) => this.transloco.translate(key, params, lang);
    return {
      lang,
      words: visitWordsOf(translate, lang, 'client'),
      cardWords: {
        last: translate('visits.card.last'),
        next: translate('visits.card.next'),
        name: (label, sentence) =>
          translate('visits.card.name', { label, sentence }),
      },
      label: translate('account.upcoming.title'),
    };
  });

  /**
   * The next visit as the shared card draws it: «Предстоящ час» as the
   * heading, no services and no face (§3.10 — `/account`'s form, until Q7),
   * the day and the hour on the visit's own calendar, the status as the
   * capsule. Null until there is a visit AND the words it is told in.
   */
  protected readonly upcomingCard = computed<VisitCardVm | null>(() => {
    const state = this.upcoming();
    const words = this.cardWords();
    if (state.kind !== 'populated' || words === null) return null;
    return visitCardOf(
      state.appointment,
      {
        kind: 'next',
        perspective: 'client',
        subjectUserId: null,
        nowMs: this.openedAtMs,
        locale: words.lang,
        words: words.words,
        cardWords: words.cardWords,
        label: words.label,
        barber: false,
        // The card's own ids: the button is `account-upcoming`, its capsule
        // `account-upcoming-status` — the ids this page has always worn.
        testId: 'account-upcoming',
      },
      NO_CATALOGUE,
    );
  });

  /**
   * Where the next visit stands, on the HOST (`data-upcoming`) — the card
   * is a button and wears no state of its own — and on the waiting card
   * (`data-state`): `populated` only once the card can be drawn; a visit
   * whose words have not loaded is still on its way, never "no upcoming
   * appointments".
   */
  protected readonly upcomingState = computed(() => {
    const kind = this.upcoming().kind;
    return kind === 'populated' && this.upcomingCard() === null
      ? 'loading'
      : kind;
  });

  constructor() {
    // `account` is live, so profile writes elsewhere (onboarding's birthday
    // save) are already here. This only re-attaches a listener that stopped
    // on a failure — a no-op while it is healthy — so entering the
    // dashboard is one fresh attempt.
    this.accountState.refresh();
    // The photo has no live listener, so entering the dashboard re-checks
    // it — the card must not ask for a photo uploaded since the last look
    // (another device; a path that forgot to refresh). It keeps the last
    // answer meanwhile, and on a cold load this bump lands before the
    // shared lookup's first run, so it is still ONE request, not two.
    this.identity.refreshAvatar();
  }

  /**
   * The card was tapped: the visit, on «Моите часове», with its sheet open
   * on arrival (`?visit=<id>`, read by the appointments page's `visit`
   * input). The card is a button, so the hand-off is the router's.
   */
  protected openUpcoming(id: string): void {
    void this.router.navigate(['/account/appointments'], {
      queryParams: { visit: id },
    });
  }

  /** Which onboarding personalization step an open checklist item deep-links into. Name/phone are registration facts (always done for an active account) — the fallback entry covers any future key honestly. */
  protected personalizeStep(key: string): string {
    if (key === 'birthday') return 'birthday';
    if (key === 'photo') return 'avatar';
    return 'services';
  }

  protected translateRepositoryError(): string {
    return translateDomainError(this.transloco, { code: 'repository_failure' });
  }
}
