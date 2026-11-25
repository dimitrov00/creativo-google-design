import { Component, computed, inject, resource } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { of, startWith, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  APPOINTMENT_READ_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  ShopZoneService,
  TEAM_BARBER_PORTS,
  distinctLocationIds,
  nowOfZones,
  sameLocationIds,
} from '@creativo/infrastructure/firebase-app';
import type { Appointment, Barber } from '@core/entities';
import {
  LocalizedText,
  Principal,
  ProfileCompletionKey,
  type ShopNow,
  VisitPerspective,
} from '@core/components';
import {
  type AppointmentId,
  type BarberId,
  type LocationId,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { AccountsErrorCode } from '@core/errors';
import {
  CatalogListingSystem,
  SameAgainSystem,
  VisitListSystem,
} from '@core/systems';
import {
  LoadSlice,
  LoadState,
  loadStateWords,
} from '@creativo/shared/view-state';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  LanguageService,
  OnboardingPhase,
  OnboardingStepHint,
  SessionIdentityService,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import {
  type AppointmentCardVm,
  VisitCard,
  VisitCardSlot,
  type VisitCardWords,
  type VisitLookup,
  type VisitWords,
  visitCardOf,
  visitLookupOf,
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
import {
  translateCodedError,
  loadedLanguage,
  pluralForm,
} from '@creativo/infrastructure/i18n';
import { sameAgainVm } from './same-again.presenter';
import type { SameAgainVm, SameAgainWords } from './same-again.vm';

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
  [ProfileCompletionKey.Name]: OnboardingStepHint.Services,
  [ProfileCompletionKey.Phone]: OnboardingStepHint.Services,
  [ProfileCompletionKey.Birthday]: OnboardingStepHint.Birthday,
  [ProfileCompletionKey.Photo]: OnboardingStepHint.Avatar,
} as const satisfies Record<ProfileCompletionKey, OnboardingStepHint>;

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
  /** «Пак същото» — the lead card when nothing is next (`account.sameAgain.*`). */
  readonly sameAgain: SameAgainWords;
}

/**
 * How many of the account's newest visits «Пак същото» reads — only while
 * nothing is next (a next visit is the lead card then, and the read is not
 * opened). The newest visit the person had sits among them unless nine
 * calls-off and no-shows came after it; the history page reads its own,
 * longer list.
 */
const SAME_AGAIN_HISTORY_LIMIT = 10;

/**
 * `/account` — the signed-in client's home. Top to bottom:
 *
 *  - THE shared site header (one nav component app-wide); its monogram menu
 *    carries the account rows, the preferences and sign-out, so the page
 *    has no chrome of its own.
 *  - Three live tiles: book a visit (`/book`), my appointments
 *    (`/account/appointments`) and my profile (`/account/profile`).
 *  - The next visit, from the live `APPOINTMENT_READ_PORTS.observeUpcoming`
 *    stream — the soonest live visit still to come, each judged on its
 *    OWN shop's wall clock (OR-8: one that has begun there is not «next»
 *    any more, DEP-F7) — as
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
    '[attr.data-lead]': 'leadWord()',
  },
})
export class ClientAccount {
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly shopZones = inject(ShopZoneService);
  private readonly language = inject(LanguageService);

  /**
   * THE CATALOGUE, AS NAMES (owner ruling Q6, 2026-11-25: the client's home
   * names the cut and the barber). The three reads are the very queries
   * the site menu holds open on every page with the header
   * (`SiteSectionsService`) and the booking flow reads
   * (`CatalogContentService`): the SDK shares one listen per query, so
   * naming them opens no new listener. Read here as plain entities, not
   * through `CatalogContentService`: that one resolves every cover and face
   * of the catalogue the moment it exists, and brings the shared catalogue
   * chunk (the service sheet, the gallery, the cards) with it — 45 kB and a
   * request per image for a card that prints two names. A card's barber is
   * drawn as his monogram.
   */
  private readonly catalogReads = inject(CATALOG_PORTS);
  private readonly servicesRead = toSignal(
    this.catalogReads.observeServices(),
    {
      initialValue: null,
    },
  );
  private readonly barbersRead = toSignal(this.catalogReads.observeBarbers(), {
    initialValue: null,
  });
  private readonly shopsRead = toSignal(this.catalogReads.observeLocations(), {
    initialValue: null,
  });

  /** The services and the barbers have both answered, successfully or not: a card names nothing before. */
  private readonly catalogueAnswered = computed(
    () => this.servicesRead() !== null && this.barbersRead() !== null,
  );

  /** Both answered SUCCESSFULLY — what «Пак същото» may judge a visit against (a list that never arrived is not "nothing offered"). */
  private readonly catalogueKnown = computed(
    () => this.servicesRead()?.ok === true && this.barbersRead()?.ok === true,
  );

  /** The active services as stored — every name a past visit may need. */
  private readonly storedServices = computed(() => {
    const read = this.servicesRead();
    return read?.ok ? read.value : [];
  });

  /** The public barbers — listed and bookable online (team onboarding D3). */
  private readonly publicBarbers = computed(() => {
    const read = this.barbersRead();
    return read?.ok ? read.value : [];
  });

  /** The active shops, with their zones. */
  private readonly shops = computed(() => {
    const read = this.shopsRead();
    return read?.ok ? read.value : [];
  });

  /**
   * A card's barber on no public list — one who left, or now works
   * staff-only — read by id (`loadBarbers`, the visit list's own lookup),
   * so the card names him; a record the client may not read stays
   * unnamed. Read again only when the set of such barbers changes.
   */
  private readonly offListReads = inject(TEAM_BARBER_PORTS, { optional: true });

  protected readonly accountState = inject(AccountStateService);

  /** The load states, for the template's `@switch`. */
  protected readonly LoadState = LoadState;
  /** The onboarding link's `?phase=` word, for the checklist rows (D-8.2). */
  protected readonly OnboardingPhase = OnboardingPhase;

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

  /**
   * The shops of the account's live visits, each once, in code-unit order —
   * the zone read's ONE input (`undefined` while there is no live visit to
   * judge). Equal by value: a snapshot that books, moves or drops a visit at
   * a shop already listed leaves it as it was, so each shop's zone is read
   * ONCE and a drawn card is replaced straight by the next one, never
   * through the skeleton.
   */
  private readonly liveLocationIds = computed<
    readonly LocationId[] | undefined
  >(
    () => {
      const result = this.upcomingResult();
      if (!result?.ok || result.value.length === 0) return undefined;
      return distinctLocationIds(result.value);
    },
    { equal: sameLocationIds },
  );

  /**
   * Each live visit's shop zone, by shop (Law 7.2 — the zone belongs to the
   * location, never the device or a default shop): "next" is judged on each
   * visit's OWN shop's wall clock (OR-8), through the session's memo
   * (`ShopZoneService.zonesOf`), so a shop already read costs no read.
   */
  private readonly cardZones = resource({
    params: () => this.liveLocationIds(),
    loader: ({ params }) => this.shopZones.zonesOf(params),
  });

  /** The live shops' zone answers, by shop — `null` while the reads are on their way. */
  private readonly cardZoneAnswers = computed(() =>
    this.cardZones.hasValue() ? (this.cardZones.value() ?? null) : null,
  );

  /**
   * A live shop's zone could not be read — the zone read threw, or a shop
   * answered no zone (none stored, or its read failed). Read only when no
   * visit is next: a visit at a shop whose zone did answer is drawn all
   * the same (OR-8).
   */
  private readonly cardZoneFailed = computed(() => {
    if (this.cardZones.error() !== undefined) return true;
    const answers = this.cardZoneAnswers();
    if (answers === null) return false;
    for (const answer of answers.values()) if (!answer.ok) return true;
    return false;
  });

  /**
   * "Now" on each live shop's OWN wall clock as the page opened
   * (`nowOfZones`, the menu badge's and `/account/appointments`' one fold)
   * — `null` until the live shops' zones have answered; a shop whose zone
   * could not be read has no clock (`null`). "Now" is read once per shop,
   * never per visit.
   */
  private readonly nowOf = computed<
    ((locationId: LocationId) => ShopNow | null) | null
  >(() => {
    const answers = this.cardZoneAnswers();
    return answers === null ? null : nowOfZones(answers, this.openedAtUtcMs);
  });

  /**
   * The next visit: the soonest live one that has not begun on its OWN
   * shop's wall clock (`VisitListSystem.nextUpcoming`, OR-8). It waits for
   * the live shops' zones — a visit is not judged before its shop's clock
   * is known. A visit whose shop zone is unknown is skipped, as the menu
   * badge skips it, so the soonest visit at a shop that answered is drawn
   * even when another shop's zone failed. Nothing next: the failed state
   * when a zone could not be read (a skipped visit makes "nothing to
   * come" untrue) or the read threw, else — every live visit begun — the
   * empty state.
   */
  protected readonly upcoming = computed<LoadSlice.WithEmpty<Appointment>>(
    () => {
      const result = this.upcomingResult();
      if (result === undefined) return LoadSlice.loading;
      if (result === null) return LoadSlice.empty;
      if (!result.ok) return LoadSlice.failed;
      if (result.value.length === 0) return LoadSlice.empty;
      // The read threw: no zone is known, and none will answer.
      if (this.cardZones.error() !== undefined) return LoadSlice.failed;
      const nowOf = this.nowOf();
      if (nowOf === null) return LoadSlice.loading;
      const next = VisitListSystem.nextUpcoming(result.value, nowOf);
      if (next !== null) return LoadSlice.ready(next);
      return this.cardZoneFailed() ? LoadSlice.failed : LoadSlice.empty;
    },
  );

  /**
   * The language the catalogue has LOADED, once it has (the appointments
   * page's rule): the card's words are built from it with
   * `translate(…, lang)`, so no lookup inside a `computed` can start a load
   * — a write the computed would read back and never settle on.
   */
  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

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
      sameAgain: {
        title: translate('account.sameAgain.title'),
        barberAway: (names, count) =>
          translate(`account.sameAgain.barberAway.${pluralForm(count, lang)}`, {
            names,
          }),
        barberAwayUnnamed: translate('account.sameAgain.barberAwayUnnamed'),
        serviceGone: (names, count) =>
          translate(
            `account.sameAgain.serviceGone.${pluralForm(count, lang)}`,
            { names },
          ),
        serviceGoneUnnamed: translate('account.sameAgain.serviceGoneUnnamed'),
      },
    };
  });

  /** The card barbers on no public list, each once, in code-unit order — `undefined` when there are none. */
  private readonly offListIds = computed<readonly BarberId[] | undefined>(
    () => {
      if (!this.catalogueKnown()) return undefined;
      const listed = new Set(this.publicBarbers().map((barber) => barber.id));
      const ids = new Set<BarberId>();
      const visits: Appointment[] = [];
      const next = this.upcoming();
      if (next.loadState === LoadState.Ready) visits.push(next.data);
      const source = this.sameAgainSource();
      if (source !== null) visits.push(source);
      for (const visit of visits) {
        for (const id of visit.barberIds) if (!listed.has(id)) ids.add(id);
      }
      return ids.size === 0 ? undefined : [...ids].sort();
    },
    { equal: (a, b) => a?.join('\n') === b?.join('\n') },
  );

  private readonly offListRead = resource({
    params: () => (this.offListReads === null ? undefined : this.offListIds()),
    loader: async ({ params }): Promise<readonly Barber[]> => {
      const read = await this.offListReads?.loadBarbers(params);
      return read?.ok ? read.value : [];
    },
  });

  /**
   * The catalogue, as a card reads it (`visitLookupOf`, the visit list's
   * own): the services and the barbers by name in the active language, the
   * shop and its zone. No faces are resolved — the card draws the
   * barber's monogram.
   */
  private readonly lookup = computed<VisitLookup>(() => {
    const lang = this.language.activeLang();
    const offList = this.offListRead.hasValue() ? this.offListRead.value() : [];
    const services = this.storedServices();
    return visitLookupOf({
      findService: (id) => services.find((service) => service.id === id),
      barbers: [...this.publicBarbers(), ...offList].map((barber) => ({
        id: barber.id,
        name: barber.name,
        avatarSrc: null,
      })),
      locations: this.shops(),
      text: (localized) => LocalizedText.pick(localized, lang),
    });
  });

  /**
   * The next visit as the shared card draws it: «Предстоящ час» as the
   * heading, the services and the barber's face (owner ruling Q6), the day
   * and the hour on the visit's own calendar, the status as the capsule.
   * Null until there is a visit, the words it is told in and the
   * catalogue's answer — a card never names «Посещение» and then the cut.
   * Its zone and "now" are the chosen visit's OWN shop's (Law 7.3).
   */
  protected readonly upcomingCard = computed<AppointmentCardVm | null>(() => {
    const state = this.upcoming();
    const words = this.cardWords();
    if (state.loadState !== LoadState.Ready || words === null) return null;
    if (!this.catalogueAnswered()) return null;
    const { locationId } = state.data;
    const answer = this.cardZoneAnswers()?.get(locationId);
    const now = this.nowOf()?.(locationId) ?? null;
    if (answer === undefined || !answer.ok || now === null) return null;
    const timeZone = answer.value;
    return visitCardOf(
      state.data,
      {
        visitCardSlot: VisitCardSlot.Next,
        perspective: VisitPerspective.Client,
        subjectUserId: null,
        now,
        timeZone,
        locale: words.lang,
        words: words.words,
        cardWords: words.cardWords,
        label: words.label,
        // The card's own ids: the button is `account-upcoming`, its capsule
        // `account-upcoming-status` — the ids this page has always worn.
        testId: 'account-upcoming',
      },
      { ...this.lookup(), locationTimeZone: () => timeZone },
    );
  });

  /**
   * Whose history «Пак същото» reads: the signed-in account, and only
   * once nothing is next — a next visit leads the slot, and two booking
   * prompts would be one too many, so the read is not opened then.
   */
  private readonly historyOwner = computed<UserId | null>(() => {
    const principal = this.accountState.principal();
    if (!Principal.isActive(principal)) return null;
    return this.upcoming().loadState === LoadState.Empty
      ? principal.userId
      : null;
  });

  /**
   * The account's newest visits (`observeHistory`, bounded at
   * {@link SAME_AGAIN_HISTORY_LIMIT}) — `null` while not asked for,
   * `undefined` while the listener has not answered.
   */
  private readonly historyResult = toSignal(
    toObservable(this.historyOwner).pipe(
      switchMap((userId) =>
        userId === null
          ? of(null)
          : this.appointments
              .observeHistory(userId, SAME_AGAIN_HISTORY_LIMIT)
              .pipe(startWith(undefined)),
      ),
    ),
    { initialValue: null },
  );

  /**
   * "Now" on each active shop's wall clock as the page opened — the
   * catalogue's shops carry their zones, so the history is judged with no
   * read of its own (`nowOfZones`, the page's one fold). A shop no longer
   * active has no clock, and a visit there is not booked again.
   */
  private readonly catalogueNowOf = computed(() =>
    nowOfZones(
      new Map(
        this.shops().map(
          (shop) => [shop.id, Result.ok(shop.timeZone)] as const,
        ),
      ),
      this.openedAtUtcMs,
    ),
  );

  /** The visit «Пак същото» books again from (`SameAgainSystem.sourceOf`) — `null` when none. */
  private readonly sameAgainSource = computed<Appointment | null>(() => {
    const history = this.historyResult();
    if (!history?.ok) return null;
    return SameAgainSystem.sourceOf(history.value, this.catalogueNowOf());
  });

  /**
   * «Пак същото» — the lead card when nothing is next: the last visit
   * the person had, what today's catalogue can book of it
   * (`SameAgainSystem.reachOf`, the answer the booking flow's pre-fill
   * rebuilds the basket from) and the way to book it. Null until the
   * catalogue has answered successfully, and when nothing of the visit is
   * offered any more.
   */
  protected readonly sameAgain = computed<SameAgainVm | null>(() => {
    const source = this.sameAgainSource();
    const words = this.cardWords();
    if (source === null || words === null) return null;
    if (!this.catalogueKnown()) return null;
    const now = this.catalogueNowOf()(source.locationId);
    const timeZone = this.lookup().locationTimeZone?.(source.locationId);
    if (now === null || timeZone === undefined || timeZone === null) {
      return null;
    }
    return sameAgainVm({
      source,
      // The public catalogue (team onboarding D3): offerings of listed
      // barbers only — the rule the booking flow books by.
      reach: SameAgainSystem.reachOf(
        source.seats,
        this.publicBarbers(),
        CatalogListingSystem.listedServices(
          this.storedServices(),
          this.publicBarbers(),
        ),
      ),
      now,
      timeZone,
      locale: words.lang,
      words: words.words,
      cardWords: words.cardWords,
      sameAgainWords: words.sameAgain,
      lookup: this.lookup(),
    });
  });

  /**
   * Where the lead slot stands — the next visit, else «Пак същото», else
   * the honest empty state. Loading until each has answered what it needs
   * (the history and the catalogue too, when nothing is next), so the slot
   * fills once and never swaps one card for another.
   */
  protected readonly leadState = computed<LoadState>(() => {
    const next = this.upcomingState();
    if (next !== LoadState.Empty) return next;
    if (!this.catalogueAnswered() || this.cardWords() === null) {
      return LoadState.Loading;
    }
    const history = this.historyResult();
    if (history === null || history === undefined) return LoadState.Loading;
    return this.sameAgain() === null ? LoadState.Empty : LoadState.Ready;
  });

  /**
   * The empty state's line: «Още нямаш записани часове.» for an account
   * that has booked nothing yet, else «Нямаш предстоящи часове.».
   */
  protected readonly emptyKey = computed(() => {
    const history = this.historyResult();
    return history?.ok === true && history.value.length === 0
      ? 'account.upcoming.none'
      : 'account.upcoming.empty';
  });

  /** The lead slot as the host prints it (`data-lead`): `loading` · `next` · `same-again` · `empty` · `error`. */
  protected readonly leadWord = computed(() => {
    const state = this.leadState();
    if (state === LoadState.Ready) {
      return this.upcomingCard() === null ? 'same-again' : 'next';
    }
    return upcomingStateWords[state];
  });

  /**
   * Where the next visit stands, on the HOST (`data-upcoming`) — the card
   * is a button and wears no state of its own — and on the waiting card
   * (`data-state`): READY only once the card can be drawn; a visit whose
   * words or shop zones have not loaded is still on its way, never "no
   * upcoming appointments"; a zone that could not be read, with no visit
   * next at a shop that answered, is the card's failed state
   * ({@link upcoming}), never loading forever.
   */
  protected readonly upcomingState = computed<LoadState>(() => {
    const state = this.upcoming().loadState;
    if (state !== LoadState.Ready) return state;
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
  protected openUpcoming(id: AppointmentId): void {
    void this.router.navigate(['/account/appointments'], {
      queryParams: { visit: id },
    });
  }

  /** A checklist item's word — its `account.completion.items.<word>` key and `account-completion-<word>` test id. */
  protected keyWord(key: ProfileCompletionKey): string {
    return COMPLETION_KEY_WORDS[key];
  }

  /** Which onboarding personalization step an open checklist item deep-links into (`?step=`). Name/phone are registration facts (always done for an active account) — their entry covers any future key honestly. */
  protected personalizeStep(key: ProfileCompletionKey): OnboardingStepHint {
    return PERSONALIZE_STEP_SLUGS[key];
  }

  /**
   * The failed card's alert line — one line whichever read failed (the
   * visits or the shop's zone), the words this card has always printed:
   * a zone read has no words of its own a client should see (plan DEP-5,
   * integrator ruling).
   */
  protected translateRepositoryError(): string {
    return translateCodedError(this.transloco, {
      errorCode: AccountsErrorCode.RepositoryFailure,
    });
  }
}
