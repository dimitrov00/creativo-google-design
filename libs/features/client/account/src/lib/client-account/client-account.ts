import { Component, computed, inject, resource } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  APPOINTMENT_READ_PORTS,
  CLOCK_PORTS,
  type ShopZoneAnswer,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import type { Appointment } from '@core/entities';
import { Principal, WallTime } from '@core/components';
import {
  AccountsErrorCode,
  type LocationId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  ProfileCompletionKey,
  VisitPerspective,
  ZonedTimeSystem,
} from '@core/systems';
import {
  LoadSlice,
  LoadState,
  loadStateWords,
} from '@creativo/shared/view-state';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  SessionIdentityService,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import {
  VisitCard,
  VisitCardSlot,
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

/**
 * The checklist item keys as the copy and the DOM spell them — lowercase,
 * as today (Phase 4a 4A-10: one table, the SCREAMING dictionary mapped once).
 */
const COMPLETION_KEY_WORDS = {
  [ProfileCompletionKey.Name]: 'name',
  [ProfileCompletionKey.Phone]: 'phone',
  [ProfileCompletionKey.Birthday]: 'birthday',
  [ProfileCompletionKey.Photo]: 'photo',
} as const satisfies Record<ProfileCompletionKey, string>;

/** The onboarding step slug (`?step=`) an open checklist item resumes at. */
const PERSONALIZE_STEP_SLUGS = {
  [ProfileCompletionKey.Name]: 'services',
  [ProfileCompletionKey.Phone]: 'services',
  [ProfileCompletionKey.Birthday]: 'birthday',
  [ProfileCompletionKey.Photo]: 'avatar',
} as const satisfies Record<ProfileCompletionKey, string>;

/**
 * Where the next visit stands, as the host's `data-upcoming` and the waiting
 * card's `data-state` spell it — the e2e suite's contract (`populated`,
 * `error`), so this page keeps ONE page table over the ONE shared
 * {@link LoadState} dictionary (UI residue cleanup UR-3).
 */
const upcomingStateWords = {
  [LoadState.Loading]: 'loading',
  [LoadState.Empty]: 'empty',
  [LoadState.Failed]: 'error',
  [LoadState.Ready]: 'populated',
} as const satisfies Record<LoadState, string>;

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
 * loyalty summary — goal 6.6's "Rewards, coupons, invites" job, over the
 * loyalty read ports (the dormant reward-progress reader it once waited
 * on is gone, Phase 4a 4A-14).
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
    '[attr.data-state]': 'accountDataState()',
    '[attr.data-completion]': 'completionState()',
    '[attr.data-upcoming]': 'upcomingWord()',
  },
})
export class ClientAccount {
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly shopZones = inject(ShopZoneService);

  protected readonly accountState = inject(AccountStateService);

  /** The load states, for the template's `@switch`. */
  protected readonly LoadState = LoadState;

  /** The host's `data-state` — the account snapshot loading, or ready. */
  protected readonly accountDataState = computed(
    () =>
      loadStateWords[
        this.accountState.accountLoading() ? LoadState.Loading : LoadState.Ready
      ],
  );

  /** The photo lookup and the checklist — the shell's, shared with the header and the menu. */
  private readonly identity = inject(SessionIdentityService);

  /**
   * "Now", once, as the page opened — what the card measures its day
   * against («днес», the year only outside the current one), read through
   * the clock port (never a raw JS date). A snapshot rather than a clock
   * read inside a `computed`, which would be a value that changes under a
   * pure function; the appointments store fixes its `today` the same way.
   */
  private readonly openedAtUtcMs: UtcEpochMs = inject(CLOCK_PORTS).nowUtcMs();

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
      switchMap((principal) =>
        Principal.isActive(principal)
          ? this.appointments.observeUpcoming(principal.userId)
          : of(null),
      ),
    ),
    { initialValue: undefined },
  );

  protected readonly upcoming = computed<LoadSlice.WithEmpty<Appointment>>(
    () => {
      const result = this.upcomingResult();
      if (result === undefined) return LoadSlice.loading;
      if (result === null) return LoadSlice.empty;
      if (!result.ok) return LoadSlice.failed;

      // The soonest, on the shop's wall clock (`localDate` + `startMinutes`).
      const next = [...result.value].sort((a, b) =>
        WallTime.compare(
          WallTime.of(a.localDate, a.startMinutes),
          WallTime.of(b.localDate, b.startMinutes),
        ),
      )[0];
      return next ? LoadSlice.ready(next) : LoadSlice.empty;
    },
  );

  /**
   * The shown visit's shop, or `undefined` while no visit is shown — the
   * zone read's ONE input. A branded string, equal by value: a snapshot of
   * the same visit, or a sooner visit at the same shop, leaves it as it
   * was, so the zone is read ONCE per shop and a drawn card is replaced
   * straight by the next one, never through the skeleton.
   */
  private readonly shownLocationId = computed<LocationId | undefined>(
    () => LoadSlice.dataOf(this.upcoming())?.locationId,
  );

  /**
   * The zone the card reads "now" in: the shown visit's OWN shop's (Law
   * 7.2 — the zone belongs to the location, never the device or a default
   * shop), read once per shop and fed back from the read as a signal.
   */
  private readonly cardZone = resource({
    params: () => this.shownLocationId(),
    loader: ({ params }) => this.shopZones.zoneOf(params),
  });

  /** The card's zone answer — `null` while the read is on its way. */
  private readonly cardZoneAnswer = computed<ShopZoneAnswer | null>(() =>
    this.cardZone.hasValue() ? (this.cardZone.value() ?? null) : null,
  );

  /** The card's zone could not be read — no zone stored, or the read failed. */
  private readonly cardZoneFailed = computed(() => {
    const answer = this.cardZoneAnswer();
    // A read that threw (never an answer) fails the card too.
    return (
      (answer !== null && !answer.ok) || this.cardZone.error() !== undefined
    );
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
      words: visitWordsOf(translate, lang, VisitPerspective.Client),
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
   * capsule. Null until there is a visit, the words it is told in AND its
   * shop's zone — "now" is read on that shop's wall clock (Law 7.3).
   */
  protected readonly upcomingCard = computed<VisitCardVm | null>(() => {
    const state = this.upcoming();
    const words = this.cardWords();
    const zone = this.cardZoneAnswer();
    if (
      state.loadState !== LoadState.Ready ||
      words === null ||
      zone === null ||
      !zone.ok
    ) {
      return null;
    }
    const timeZone = zone.value;
    return visitCardOf(
      state.data,
      {
        visitCardSlot: VisitCardSlot.Next,
        perspective: VisitPerspective.Client,
        subjectUserId: null,
        now: ZonedTimeSystem.shopNow(this.openedAtUtcMs, timeZone),
        timeZone,
        locale: words.lang,
        words: words.words,
        cardWords: words.cardWords,
        label: words.label,
        barber: false,
        // The card's own ids: the button is `account-upcoming`, its capsule
        // `account-upcoming-status` — the ids this page has always worn.
        testId: 'account-upcoming',
      },
      { ...NO_CATALOGUE, locationTimeZone: () => timeZone },
    );
  });

  /**
   * Where the next visit stands, on the HOST (`data-upcoming`) — the card
   * is a button and wears no state of its own — and on the waiting card
   * (`data-state`): READY only once the card can be drawn; a visit whose
   * words or shop zone have not loaded is still on its way, never "no
   * upcoming appointments"; a zone that could not be read is the card's
   * failed state, never loading forever.
   */
  protected readonly upcomingState = computed<LoadState>(() => {
    const state = this.upcoming().loadState;
    if (state !== LoadState.Ready) return state;
    if (this.cardZoneFailed()) return LoadState.Failed;
    return this.upcomingCard() === null ? LoadState.Loading : LoadState.Ready;
  });

  /** The same state in the e2e suite's word (`loading` · `empty` · `error` · `populated`). */
  protected readonly upcomingWord = computed(
    () => upcomingStateWords[this.upcomingState()],
  );

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

  /** A checklist item's word — its `account.completion.items.<word>` key and `account-completion-<word>` test id. */
  protected keyWord(key: ProfileCompletionKey): string {
    return COMPLETION_KEY_WORDS[key];
  }

  /** Which onboarding personalization step an open checklist item deep-links into (`?step=`). Name/phone are registration facts (always done for an active account) — their entry covers any future key honestly. */
  protected personalizeStep(key: ProfileCompletionKey): string {
    return PERSONALIZE_STEP_SLUGS[key];
  }

  /**
   * The failed card's alert line — one line whichever read failed (the
   * visits or the shop's zone), the words this card has always printed:
   * a zone read has no words of its own a client should see (plan DEP-5,
   * integrator ruling).
   */
  protected translateRepositoryError(): string {
    return translateDomainError(this.transloco, {
      errorCode: AccountsErrorCode.RepositoryFailure,
    });
  }
}
