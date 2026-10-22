import type {
  StaffEventLine,
  VisitCardVm,
  VisitFilter,
  VisitLinePart,
  VisitRowVm,
  VisitSectionVm,
} from '@creativo/features/shared/visits';
import type {
  UiBadgeTone,
  UiIconName,
  UiStreakPeriod,
} from '@creativo/ui/controls';
import type { ClientCardRegion } from './client-card.contracts';
import type { JournalFeed, VisitLeg } from '@core/components';
import type {
  BadgeProgress,
  LoyaltyAccount,
  SeasonProgress,
} from '@core/entities';
import type { ValidLoyaltyCatalog } from '@core/systems';
import type { UiMark, UiMedalState } from '@creativo/ui/controls';
import type { AchievementScope } from './client-card.contracts';
import type { RecordKindWord } from './client-card.words';
// ── The built pages’ view models that survive (moved here in W4 from
// `client-card.vm.ts`, which is gone): what the new presenters and bodies
// still read, under the names they always imported from here. ──────────

/**
 * THE CARD'S VIEW MODELS — what every body renders, already worded
 * (client-card-redesign §5.2.2; the region letters are §3's).
 *
 * The store holds data; the pure presenters turn it into these shapes; the
 * bodies bind them. Every string is final copy — translated, formatted,
 * pluralised — and every accessible name is one sentence, so a template
 * never formats, counts or looks anything up, and a spec that reads a VM
 * knows what the page says.
 *
 * Absence is a missing key, a `null` or an empty list, never an empty
 * frame: a module with nothing to show is absent (data-less = absent,
 * never disabled), and a module whose read failed keeps its heading over
 * one retry notice.
 */

/**
 * One region's read as the page draws it (old spec §7.9, reused): a
 * skeleton, the content, or the heading over «Опитай пак». A region that
 * cannot exist at all — a flag off, no account, a guest — is not a fourth
 * status: its slice is absent.
 */
export type Slice<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'failed' };

export type SliceStatus = Slice<unknown>['status'];

/**
 * What a `ui-gauge` takes besides its style and size, which are the
 * template's and fixed per place: the points bar, a stamp card, the tier
 * track, a season's track, a family's ladder. `label` and `valueText` are
 * the meter's own name and reading — required by the DS even where the
 * gauge sits inside a button whose sentence already says it.
 */
export interface GaugeVm {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Notches (`label: null`), labelled thresholds, or the nodes of a `steps` track. */
  readonly marks: readonly UiMark[];
  readonly label: string;
  readonly valueText: string;
}

// ── The glance page «client» (§3.1) ─────────────────────────────────────

/** A — the head: the name, the state line and the trailing avatar in `ui-sheet-headline`. */
export interface ClientHeadVm {
  /** A1 — `users/{uid}`'s name once read, the seat's label until then. Wraps; never truncated on the page. */
  readonly name: string;
  /**
   * A2 — the ONE place for tenure, a first visit, a guest, a pause:
   * «Клиент от март 2025 г.», «Първо посещение», «Гост · без профил»,
   * «Онлайн записването е спряно до 12.10» (the cadence lives in the
   * history's band). Wraps, never truncated. `null` until `users/{uid}`
   * answers: a pause never pushes painted content (the D-9 gate).
   */
  readonly stateLine: string | null;
  /** A3 — the seat's picture first, then `AVATAR_UPLOADER.find(uid)`. */
  readonly avatarSrc: string | null;
  /** The name the avatar's initials come from (`ui-avatar [uiName]`). */
  readonly initialsFrom: string;
  /** Online booking is paused: the headline's warning ring. */
  readonly paused: boolean;
}

/** B — which capsule a `client-capsule-{id}` test id names (R17). */
export type ClientCapsuleId = 'tier' | 'birthday' | 'noShows';

/** B — one qualifier in the head's capsule row. Named apart from `shared/catalog`'s `CapsuleVm`. */
export interface ClientCapsuleVm {
  readonly id: ClientCapsuleId;
  /** «Злато» · «Рожден ден днес» · «2 неявявания». */
  readonly text: string;
  readonly tone: UiBadgeTone;
  /** The leading glyph (`span[uiBadge] [uiIcon]`): `loyalty.tier` on the tier; `null` on the rest. */
  readonly icon: UiIconName | null;
}

/** B — the capsule row: what shows, and what «+N» stands for. */
export interface ClientCapsulesVm {
  readonly shown: readonly ClientCapsuleVm[];
  /**
   * «+2» (`client-capsule-more`, `aria-hidden`) and the capsules it hides,
   * read in a visually hidden item; `null` when every capsule shows.
   */
  readonly more: {
    readonly text: string;
    readonly hidden: readonly ClientCapsuleVm[];
  } | null;
}

/** D — a link that leaves for the phone's own app: call, SMS, Viber. */
export interface ContactActionVm {
  /** The `client-quick-{id}` test id. */
  readonly id: 'call' | 'sms' | 'viber';
  readonly icon: UiIconName;
  /** The visible word: «Обади се» · «SMS» · «Viber». */
  readonly label: string;
  /** `tel:…` · `sms:…` · `viber://chat?number=%2B…` — the account's phone, else the seat's. */
  readonly href: string;
  /** Begins with the visible word (WCAG 2.5.3): «Обади се на Георги Петров, +359 88 123 4567». */
  readonly accessibleName: string;
}

/** D — «Повтори»: a button carrying the last visit's legs, emitted as `repeatLast`. */
export interface RepeatActionVm {
  readonly id: 'same';
  readonly icon: UiIconName;
  /** «Повтори» — one word, one line in the tile. */
  readonly label: string;
  readonly href: null;
  /** Begins with the visible word (WCAG 2.5.3): «Повтори посещението от 4 септември: фейд». */
  readonly accessibleName: string;
  /** `ClientStatsRecord.lastVisitLegs`: what the editor puts back in the draft. */
  readonly legs: readonly VisitLeg[];
}

/** D — one quick-action tile; `href` tells the link from the button. */
export type QuickActionVm = ContactActionVm | RepeatActionVm;

/**
 * E, and «Лоялност» LD — one held reward as a coupon ticket. Only ever the
 * appointment owner's (§3.1.3). READY, a `button[uiCouponCard]` whose tap
 * emits `openReward(grantId)`; APPLIED — on this visit's draft bill — the
 * same ticket where it stood as an `article[uiCouponCard][uiApplied]`,
 * the check on its glyph and «Премахни» (`removeReward(grantId)`) where
 * «Използвай» stood: the discount page's own applied card (WP7 review r6).
 */
export interface RewardReadyVm {
  /** The grant the discount page opens on: the soonest-expiring of a collapsed stack. */
  readonly grantId: string;
  /** The coupon's name: «Безплатно подстригване». */
  readonly title: string;
  /**
   * The rule, in the ticket's accent ink: «−20%», «Безплатна услуга»;
   * `null` when the name already says it (the ticket is the name alone).
   */
  readonly value: string | null;
  /** Only when it says something: «до 28.10», «· още 1»; else `null`. */
  readonly detail: string | null;
  /** «×2» when identical grants collapse into one ticket (`[uiCouponBadge]`); `null` for one, and on an applied ticket. */
  readonly stack: string | null;
  /** On this visit's draft bill: stamped, «Премахни» where «Използвай» stood. */
  readonly applied: boolean;
  /** «Безплатно подстригване, използвай»; applied «Безплатно подстригване, с това посещение». */
  readonly accessibleName: string;
  /** The applied ticket's «Премахни», named: «Премахни отстъпката: Безплатно подстригване». */
  readonly removeName: string;
}

/**
 * One medal family as `ui-medal` / `button[uiMedal]` draws it (§5.1.13),
 * already under the numeral rule: `level` is the highest EARNED level or
 * `null`, and a target lives only in words, in `caption`.
 */
export interface MedalVm {
  readonly seriesId: string;
  /**
   * The state DRAWN: the family's standing, except that a family the open
   * visit completes is drawn at least in progress (the pending face: the
   * solid ring, full ink, a full meter) — never the not-started silhouette.
   */
  readonly state: UiMedalState;
  /** The registry emblem (`BADGE_EMBLEM_ICONS`); drawn when there is neither art nor a monogram. */
  readonly icon: UiIconName | null;
  /** Art — owner art, else the barber's face, the service's or the shop's cover. Wins over everything. */
  readonly src: string | null;
  /** «Ф» · «И» · «Ц» — a service, barber or shop family without art. Wins over the emblem. */
  readonly monogram: string | null;
  /** The rim numeral «II»; `null` while nothing is earned. */
  readonly level: string | null;
  /** Under the disc on rails and grids; `null` on the glance strip and as the detail's headline media. */
  readonly title: string | null;
  /** «24/25 до III» · «с това посещение» · «Всички нива» · «4.09»; `null` where the disc stands alone. */
  readonly caption: string | null;
  /** 0 … 1 for the thin meter (in progress, or earned with a next level to go; 1 for the level this visit completes); `null` = no meter. */
  readonly value: number | null;
  readonly valueText: string | null;
  /**
   * Earned since the client's previous visit (staff never see a
   * celebration). Only where the page marks new (`MedalOptions.markNew`):
   * «Последни» draws the quiet «Ново» marker for it; the glance strip's
   * first slot only names it («, ново»), its cue saying «Ново: …» once.
   * `false` elsewhere.
   */
  readonly isNew: boolean;
  /** One sentence: «Фейд, ниво II, спечелено на 3 юни, 24 от 25 до ниво III, ново». */
  readonly accessibleName: string;
}

/** G1 — the glance strip: ≤3 medals and one cue. */
export interface MedalStripVm {
  readonly medals: readonly MedalVm[];
  /**
   * First match wins: «С това посещение: …» › «Ново: …» › «Близо: …» (≤2
   * lines); `null` when none applies (every family complete).
   */
  readonly cue: string | null;
}

/**
 * One past cut: a tile of the glance rail and, through `store.photoById`,
 * the read-only `photo` page — which the editor maps to its own
 * `VisitEditorPhoto` (this lib cannot import that type: a cycle).
 */
export interface ClientPhotoVm {
  readonly photoId: string;
  readonly appointmentId: string;
  readonly url: string;
  /** When it was taken (`AppointmentPhoto.takenAtUtcMs`). */
  readonly takenAtUtcMs: number;
  /** «12.08» (R59): the tile's on-media badge and the photo page's bar title. */
  readonly dateLabel: string;
  /** «Снимка от 12 август». */
  readonly accessibleName: string;
  /** The visit's chair; the editor names it through `ClientCardCatalog.barberName`. */
  readonly barberId: string;
  readonly width: number | null;
  readonly height: number | null;
}

/** LF — one punch card on the page. */
export interface StampCardVm {
  readonly ruleId: string;
  /** The card's reward: «Безплатно подстригване». */
  readonly title: string;
  /** «4 от 10». */
  readonly figure: string;
  /** discreteCapacity regular, 5 per row; `valueText` «4 от 10 посещения, още 6 до безплатно подстригване». */
  readonly gauge: GaugeVm;
  /** «Още 6 посещения» — the title above names the reward. */
  readonly sentence: string;
}

// ── «Постижения», a scope, a medal (§3.3–§3.5) ──────────────────────────

/**
 * What the three achievements pages compute from. The store holds it once;
 * each page derives its VM in a `computed` of this and its own inputs
 * (`medalsPageVm`, `medalScopeVm`, `medalDetailVm`). Progress is keyed
 * by id for the presenters' lookups; the standing systems read its values.
 */
export interface AchievementsData {
  /** The published catalogue as `LoyaltyCatalogSystem.validate` answers it: every list in display order. */
  readonly catalog: ValidLoyaltyCatalog;
  /** `loyaltyAccounts/{customerId}` as stored (the client RECORD's, D29). */
  readonly account: LoyaltyAccount;
  /** `badgeProgress`, by series id; a family without an entry is not started. */
  readonly progress: ReadonlyMap<string, BadgeProgress>;
  /** `seasonProgress`, by season id. */
  readonly seasonProgress: ReadonlyMap<string, SeasonProgress>;
  /** The shop calendar's today (`YYYY-MM-DD`, Europe/Sofia), read once from `CLOCK`: phases, closest levels. */
  readonly today: string;
  /** The start of the client's last worked visit before this one — what «Ново» is measured from. */
  readonly previousVisitAtMs: number | null;
}

/**
 * One tile of a rail or a grid: a medal, and where a tap goes. A family
 * opens its detail; a «Последни» day group (several levels earned on one
 * day, drawn as the DS stack with the face of one of its families — the
 * newest whose face the first screen does not already draw — titled by
 * that family and the rest's count, «Лятна събота +1», over its day) and a
 * season in the archive open a scope.
 */
export interface AchievementTileVm {
  /** The test id's suffix: the series id, or a day group's `YYYY-MM-DD`. */
  readonly key: string;
  readonly medal: MedalVm;
  /** The scope a tap pushes; `null` = the family's detail (`medal.seriesId`). */
  readonly opens: AchievementScope | null;
}

/** A season's medal over its step track: AF's card body and CE, the season scope's head. */
export interface SeasonTrackVm {
  readonly seasonId: string;
  /**
   * The season's medal, large and static. Its rim is empty while the steps
   * beside it print the level on their current node (§3.0, wave D r5); a
   * finished track of earned levels — checked to its end, an ended
   * season's always — leaves the rim as the one numeral.
   */
  readonly medal: MedalVm;
  /** steps I–V; value = the track's value. */
  readonly gauge: GaugeVm;
  /**
   * «Още 1 посещение до III», «Ниво III с това посещение» while the open
   * visit completes it — no date: the heading holds it. `null` for an
   * ended season: nothing is left to reach, and the scope's ended line
   * says that it closed (the rim and the steps say where).
   */
  readonly sentence: string | null;
}

/** AF — the running season's card. */
export interface SeasonCardVm extends SeasonTrackVm {
  /** «Есен 2026». */
  readonly title: string;
  /** «1.09 – 30.11»: the heading's detail, the only place the dates print. */
  readonly dates: string;
  /**
   * The season's families, regular and presentational, in shelf order —
   * all of them; the card draws a preview (`MedalPreviewVm`).
   */
  readonly families: readonly MedalVm[];
  /** «Сезонни: 1 от 4»: the whole count, whatever the preview draws. */
  readonly familiesCaption: string;
  /** «Есен 2026, ниво II, до 30 ноември». */
  readonly accessibleName: string;
}

/** AG — one open event, or an announced one (never hidden). */
export interface EventCardVm {
  readonly seasonId: string;
  /** «Седмица на брадата». */
  readonly title: string;
  /** «до 5.10»; announced: «от 1.11». */
  readonly when: string;
  /** Every family of the event, in shelf order; the card draws a preview (`MedalPreviewVm`). */
  readonly medals: readonly MedalVm[];
  /** «0 от 2»; `null` while announced (no progress yet). */
  readonly count: string | null;
  /** «Седмица на брадата, 0 от 2, до 5 октомври». */
  readonly accessibleName: string;
}

/** AJ — the one lone row to the archive. */
export interface ArchiveRowVm {
  /** «1»: ended seasons and events the client took part in. */
  readonly count: string;
  /** «Минали сезони и събития, 1». */
  readonly accessibleName: string;
}

/** CC/CD — one section of a scope page: a heading, or none, over a grid of tiles. */
export interface ScopeSectionVm {
  /** `achievements-scope-section-{key}`: a service category's id, `general`, `barbers`, `shops`, a year. */
  readonly key: string;
  /** «Коса» · «2026»; `null` = one unlabelled grid (a season, a day). */
  readonly title: string | null;
  /** «2 от 5» (families started); `null` where a count says nothing. */
  readonly detail: string | null;
  readonly tiles: readonly AchievementTileVm[];
}

/** One scope page: a category, a season, the archive or a day. */
export interface ScopePageVm {
  /** The `h2` and the bar's title: «Майсторство» · «Есен 2026» · «Минали сезони и събития» · «Спечелени на 4.09». */
  readonly title: string;
  /** «Георги Петров · 3 от 9 започнати»; a season: «1.09 – 30.11». */
  readonly subline: string;
  /** CE — a season scope's medal and steps, above the grid. */
  readonly track: SeasonTrackVm | null;
  /** CF — «Сезонът приключи.»: an ended season lists only what was earned; the rim and the track say the level. */
  readonly ended: string | null;
  readonly sections: readonly ScopeSectionVm[];
}

/** DE — «Още от Майсторство»: the family's neighbours; a tap REPLACES the detail. */
export interface DetailRelatedVm {
  /** «Още от Майсторство» — the one place the category is named. */
  readonly title: string;
  readonly icon: UiIconName | null;
  readonly tiles: readonly AchievementTileVm[];
}

// ── «Посещения» (§3.6) ──────────────────────────────────────────────────

/** HC — one open figure of the stats band. */
export interface HistoryCellVm {
  /** The `history-count-{id}` test id (R17). */
  readonly id: 'visits' | 'cadence' | 'noShows' | 'cancelled';
  /** «24» · «~4» · «2» · «1». */
  readonly value: string;
  /** «седм.» — the interval's unit, in ui-metric's unit slot; absent on a bare count. */
  readonly unit?: string;
  /** «посещения» · «интервал» · «неявявания» · «отказ от клиента». */
  readonly caption: string;
}

/** HD — the ‹admin› spend: never probed for anyone else. */
export interface HistorySpendVm {
  /** «462,50 €» (`formatMoney`): the figure, where the band gives spend a cell of its own (≥761 px). */
  readonly value: string;
  /** «Похарчени общо 462,50 €»: the footnote. */
  readonly sentence: string;
}

/** HD — the footnote beside the filter. */
export interface HistoryFactsVm {
  /** «Без неявявания и откази от клиента» when both are zero, «Първо посещение» before the first worked visit; else `null`. */
  readonly note: string | null;
  readonly spend: HistorySpendVm | null;
}

/** HG/HH — the list's foot, in the shape `lib-visit-list [paging]` takes. */
export interface HistoryPagingVm {
  readonly kind: 'more' | 'loading' | 'failed' | 'end';
  /** HH on `end`: «Това е всичко · първото посещение е на 6.03.2025 г.» / «Това е първото посещение.». */
  readonly endLabel: string | null;
}

/**
 * One run of a quiet line; a `fact` run is set in primary ink at weight
 * 500, the rest in the line's secondary ink. The runs carry their own
 * separators («Клиент от » · «март 2025 г.» · « · идва през » ·
 * «4 седмици»): a template joins nothing, and parts them at the joints
 * (`partedAtJoints`, `client-card.format.ts`) into the facts of a line of
 * facts. The shared visits' own run (`VisitLinePart`), so a visit card's
 * facts and a page's quiet line are one shape.
 */
export type LinePart = VisitLinePart;

// ── The glance: the hero and the overview (§2.1) ────────────────────────

/** A3, A2 — the tier as the plate on the avatar's rim and the ring around the face. */
export interface HeroTierVm {
  /** «Злато» — the plate's word. */
  readonly name: string;
  /**
   * 0 … 1 from the current tier's threshold to the next, the ring's arc;
   * 1 at the top tier. `null` draws the plate without an arc.
   */
  readonly progress: number | null;
  /** A3′ — the ring in words: «Злато, още 7 посещения до Платина». */
  readonly accessibleName: string;
}

/** A — the head as a centred hero: the face, the name, one quiet line. */
export interface ClientHeroVm {
  /** A4 — `users/{uid}`'s name once read, the seat's label until then. Wraps; never truncated. */
  readonly name: string;
  /**
   * A5 — the ONE place for tenure and cadence, a first visit, a guest, a
   * pause: «Клиент от **март 2025 г.** · идва през **4 седмици**»,
   * «Първо посещение», «Гост · без профил», «Онлайн записването е спряно
   * до **12.10**». `null` until `users/{uid}` answers (the D-9 gate).
   */
  readonly line: readonly LinePart[] | null;
  /** `null` without `loyalty.tiers`, for a guest, and until the account lands: no plate, no arc. */
  readonly tier: HeroTierVm | null;
  /** A1 — the seat's picture first, then `AVATAR_UPLOADER.find(uid)`. */
  readonly avatarSrc: string | null;
  /** The name the avatar's initials come from (`ui-avatar [uiName]`). */
  readonly initialsFrom: string;
  /** Online booking is paused: the WARNING ring, which takes the tier ring's place. */
  readonly paused: boolean;
}

/** BD — the birthday, a card of its own (R2-D): the band, and the gift under it when one is held. */
export interface BirthdayVm {
  /** `today`: the solid band; `upcoming`: the quiet notice of a birthday within the week. */
  readonly kind: 'today' | 'upcoming';
  /** «Рожден ден · 34 г.» · «Рожден ден днес» · «Рожден ден · петък, 2.10 · 34 г.». */
  readonly title: string;
  /**
   * The owner's usable grant whose coupon says `birthday` — today only;
   * `null` draws the band alone (a party member, offline, a gone visit, a
   * paused client, no gift held).
   */
  readonly gift: RewardReadyVm | null;
  /** «Подарък от салона» — the ticket's title under the figure. */
  readonly giftLabel: string;
  /** «Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай». */
  readonly accessibleName: string;
}

/** H — «Посещения» on the glance: up to three cards of ONE shape. */
export interface VisitCardsVm {
  /** H1 — the newest worked visit that is not the one on screen. */
  readonly last: VisitCardVm | null;
  /** H2 — the soonest visit to come that is not the one on screen. */
  readonly next: VisitCardVm | null;
  /** H3 — the newest watching request, when the first spec's rule lets it through. */
  readonly waitlist: VisitCardVm | null;
  /** H0 — `lifetime.visitsCompleted`: «23 ›». */
  readonly count: number;
}

/** F1 — one fact of the loyalty card's holdings line. */
export interface HoldingFactVm {
  /** The `client-loyalty-{id}` test id. */
  readonly id: 'voucher' | 'stamps' | 'rhythm';
  /** «Ваучер» · «Печати» · «Ритъм». */
  readonly label: string;
  /** «25,00 €» · «3 от 10» · «9» — the run in primary ink. */
  readonly value: string;
}

/** F1 — «Лоялност» on the glance: ONE white card, the whole card a button to the wallet. */
export interface LoyaltyGlanceVm {
  /** «371»; with `loyalty.points` off the first holding's value («25,00 €», «3 от 10»). */
  readonly figure: string;
  /** «точки»; `null` where the figure is a holding's value. */
  readonly unit: string | null;
  /** «Стигат за безплатно оформяне на брада» · «Още 42 до …» (DV5's held rule); `null` without a catalogue. */
  readonly sentence: string | null;
  /** A fact whose data is absent is absent; with none the line is absent. */
  readonly holdings: readonly HoldingFactVm[];
  /** «Лоялност: 371 точки. Стигат за безплатно оформяне на брада. Ваучер 25,00 €, печати 3 от 10, ритъм 9 посещения.» */
  readonly accessibleName: string;
}

/** G1 — one record on the medals card's quiet line. */
export interface RecordFactVm {
  /** The `client-record-{kind}` test id. */
  readonly kind: RecordKindWord;
  /** «Любима услуга» · «Най-много за година». */
  readonly label: string;
  /** «Фейд» · «13» — the run in primary ink. */
  readonly value: string;
}

/** G — «Постижения» on the glance: three NAMED medals, one cue, the records line. */
export interface MedalsGlanceVm {
  /** G0 — `earnedLevelCount(progress)`: «38 ›». */
  readonly levelCount: number;
  /** ≤ 3, medals `large`, each named and none captioned: slot 1 the newest earned level, slots 2–3 the closest. */
  readonly tiles: readonly AchievementTileVm[];
  /** First match wins: «С това посещение: …» › «Ново: …» › «Близо: …»; `null` when none applies. */
  readonly cue: string | null;
  /** ≤ 2, never the rhythm's (it is the wallet's and the records page's); empty = no line. */
  readonly records: readonly RecordFactVm[];
  /** The line as the button's name: «Рекорди: любима услуга Фейд, най-много за година 13»; `null` with no record. */
  readonly recordsName: string | null;
}

/**
 * The glance under the hero. Each module is its own `Slice`, and an ABSENT
 * key is an absent module — a flag off, no account, a guest, nothing to
 * show once loaded — so the page's order is the template's and its
 * content is this object's.
 */
export interface ClientOverviewVm {
  /** B — warnings and tags only: no tier (the plate), no birthday (the card). Absent when empty. */
  readonly capsules?: Slice<ClientCapsulesVm>;
  /** BD — absent on any other day; never promised by a skeleton. */
  readonly birthday?: BirthdayVm;
  /** D — from the seat's snapshot at once; the body promotes `same`. */
  readonly actions: readonly QuickActionVm[];
  /** E — the owner's reward ticket, less the birthday grant while BD carries it. */
  readonly reward?: Slice<RewardReadyVm>;
  /** H */
  readonly visits?: Slice<VisitCardsVm>;
  /** F */
  readonly loyalty?: Slice<LoyaltyGlanceVm>;
  /** G — absent until the first earned level. */
  readonly medals?: Slice<MedalsGlanceVm>;
  /** I — the newest three, without the featured visit's (they ride H1). */
  readonly photos?: Slice<readonly ClientPhotoVm[]>;
  /** K — «Махни от посещението» can be written now. */
  readonly canRemove: boolean;
  /** The regions whose read failed: one notice under a module, or one under the head for two and more. */
  readonly failed: readonly ClientCardRegion[];
}

// ── «Лоялност»: the wallet (§2.2) ───────────────────────────────────────

/** WA — the loyalty pass: the page's one orange slab, as `ui-pass-card` takes it. */
export interface PassVm {
  /** «371»; owed «−40»; with `loyalty.points` off the tier's count («13»). */
  readonly figure: string;
  /** «точки»; with `loyalty.points` off «посещения». */
  readonly unit: string;
  /** «Георги Петров» — the head's name; `null` until it is known. */
  readonly holder: string | null;
  /** «Злато» — the ONE plate; `null` without `loyalty.tiers`. */
  readonly tier: string | null;
  /** «Клиент от март 2025 г.»; `null` before the first worked visit. */
  readonly since: string | null;
  /** Only when it says something: «дължи 40 точки» · «40 т. изтичат на 31.12» · «Замразено». */
  readonly state: string | null;
  /** A paused client: the pass desaturates whole; values are never zeroed. */
  readonly frozen: boolean;
  /** «Карта за лоялност: Георги Петров, Злато, 371 точки за размяна, клиент от март 2025 г.» */
  readonly accessibleName: string;
}

/** WC1 — a gift voucher issued to the person: `active`, with a balance. */
export interface VoucherVm {
  /** The `rewards-voucher-{voucherId}` test id. */
  readonly voucherId: string;
  /** «Ваучер за подарък». */
  readonly title: string;
  /** «25,00 €» (`formatMoney`): the ticket's accent figure. */
  readonly balance: string;
  /** The ONE chip: «от 50,00 € · до 31.12»; `null` for an untouched voucher that never expires. */
  readonly detail: string | null;
  /** «Ваучер за подарък: 25,00 € от 50,00 €, важи до 31 декември». */
  readonly accessibleName: string;
}

/** WB — which disc a `rewards-action-{id}` test id names. */
export type WalletActionId = 'use' | 'code' | 'catalog' | 'history';

/** WB — one disc under the pass. A disc that cannot be used is ABSENT, never disabled. */
export interface WalletActionVm {
  readonly id: WalletActionId;
  readonly icon: UiIconName;
  /** «Използвай» · «Код» · «Награди» · «История» — one word, one line. */
  readonly label: string;
  /** `accent` on the ONE promoted verb of the row («Използвай»). */
  readonly prominence: 'standard' | 'accent';
  /** Begins with the visible word (WCAG 2.5.3). */
  readonly accessibleName: string;
  /** `use` with exactly ONE ready ticket: the grant it applies; else `null`. */
  readonly grantId: string | null;
  /** `use` with MORE than one: the count on the disc's badge; else `null`. */
  readonly count: number | null;
}

/** WC — one thing held, in the wallet's order: vouchers, reward tickets, stamp cards. */
export type WalletHoldingVm =
  | { readonly kind: 'voucher'; readonly voucher: VoucherVm }
  | { readonly kind: 'ticket'; readonly ticket: RewardReadyVm }
  | {
      readonly kind: 'stamps';
      readonly card: StampCardVm;
      /** «10 печата за безплатно подстригване» — the stamps themselves do the counting. */
      readonly line: string;
    };

/** WD — the capsule beside the rhythm's figure, only while the phase is NOT healthy. */
export interface RhythmPhaseVm {
  /** «До 10.11» · «Гратис до 17.11» · «Записан за 29.10» · «Защитен» · «Прекъснат». */
  readonly text: string;
  readonly tone: UiBadgeTone;
}

/** WD — «Ритъм»: the run, the track, where it stands and the rule in force. */
export interface WalletRhythmVm {
  /** «9». */
  readonly figure: string;
  /** «посещения в ритъм». */
  readonly unit: string;
  /** `null` while healthy: the figure and the track say it. */
  readonly phase: RhythmPhaseVm | null;
  /** The marks come from `StreakState.periods`, never re-derived. */
  readonly periods: readonly UiStreakPeriod[];
  /** The track's one sentence: «9 посещения в ритъм, най-много 23, следващото до 10 ноември». */
  readonly trackName: string;
  /** «Следващото посещение до 10.11 пази ритъма.» · «Записан е за 29.10 · срокът се пази.» */
  readonly stateLine: string;
  /** «Най-много: 23»; `null` while the run IS the best. */
  readonly best: string | null;
  /** «2 защити в запас»; `null` when the rule grants none or none is banked. */
  readonly protections: string | null;
  /** «На всеки 6 седмици · 7 дни гратис» — the button that unfolds the whole rule. */
  readonly ruleLine: string;
  /** The `rhythmRule.*` sentences, the rule whole, in its own order. */
  readonly ruleFull: readonly string[];
  /** «От 1.10: на всеки 5 седмици»; `null` with no version scheduled. */
  readonly ruleUpcoming: string | null;
  /** A paused client: the card draws frozen, its values kept. */
  readonly frozen: boolean;
}

/** WE — «Статус»: what remains in a ring, the four tiers as steps. */
export interface WalletTierVm {
  /** circularCapacity `large`: from the current tier's threshold to the next. */
  readonly ring: GaugeVm;
  /** The ring's centre, «7»; `null` at the top tier (the ring holds a check). */
  readonly remaining: string | null;
  /** «до Платина» · «Най-високият статус». */
  readonly line1: string;
  /** «13 посещения за 12 месеца»; at the top the keeping rule. */
  readonly line2: string;
  /** steps: the four tiers as nodes. */
  readonly steps: GaugeVm;
  /** The steps gauge's name (`clientCard.loyaltyPage.tierName`). */
  readonly accessibleName: string;
}

/** WF — one reward of the catalogue, a STATIC tile: information in this round (ES-2). */
export interface RewardTileVm {
  /** The `rewards-catalog-{rewardId}` test id. */
  readonly rewardId: string;
  /** «Безплатно оформяне на брада» — two lines at most. */
  readonly title: string;
  /** «120 т.» — the neutral capsule of a reward within reach. */
  readonly cost: string;
  readonly affordable: boolean;
  /** «още 29 т.» — the capsule of a reward out of reach; `null` within reach. */
  readonly missing: string | null;
  /** balance ÷ cost, 0 … 1, on out-of-reach tiles only; `null` within reach. */
  readonly progress: number | null;
  /** The cover of the ONE service its coupon names; `null` draws the reward glyph on a wash disc. */
  readonly src: string | null;
  /** «Безплатно оформяне на брада, 120 точки» · «Продукт по избор, 400 точки, още 29» (`clientCard.loyaltyPage.rewardName`). */
  readonly accessibleName: string;
}

/** WF — the catalogue grid under «Награди за точки». */
export interface RewardGridVm {
  /** The list's name: «Награди за точки: 371 точки, стигат за 2 от 3 награди». */
  readonly name: string;
  /** Affordable first. */
  readonly tiles: readonly RewardTileVm[];
}

/** WG, LE — one EVENT of the journal as one row: entries of one `correlationId`, folded (§2.2.5). */
export interface ActivityRowVm {
  /** The `…-entry-{entryId}` test id: the event's newest entry. */
  readonly entryId: string;
  /** By the event's leading effect: `loyalty.activity.*`. */
  readonly icon: UiIconName;
  /** The GLYPH's ink; the disc is white on the grey segment. */
  readonly tone: 'accent' | 'neutral';
  /** The visit's services · «Години с нас I» · the reward's name · «Статус: Злато» · «Бонус от салона» · «Изтекли» · «Анулирано». */
  readonly title: string;
  /** The fact line: «5.09 · Иван» · «1.03 · постижение» · «12.06 · от Сребро». */
  readonly lines: readonly StaffEventLine[];
  /** A row a later entry reversed: its title is struck. */
  readonly struck: boolean;
  /** «+27 т.» · «−250 т.» — the sign carries the direction, never a colour; `null` when no points moved. */
  readonly amount: string | null;
  /** «371 т.» under the amount; `null` when no points moved. */
  readonly balanceAfter: string | null;
  /** One sentence, the verb first. */
  readonly accessibleName: string;
}

/** WG, LD — a month of the journal. */
export interface ActivityGroupVm {
  /** `YYYY-MM` (Europe/Sofia): the `…-month-{key}` test id. */
  readonly key: string;
  /** «Септември 2026 г.». */
  readonly label: string;
  /** «+27 т.» — the month's net; `null` for a month not wholly loaded (one the page boundary cut). */
  readonly net: string | null;
  readonly rows: readonly ActivityRowVm[];
}

/**
 * The «Лоялност» page. Sections absent with their flag or their data; a
 * section whose own read failed keeps its heading over a compact notice.
 */
export interface WalletVm {
  /** A paused client: the `rewards-frozen` notice, the pass and the rhythm frozen, no tickets. */
  readonly frozen: boolean;
  readonly pass: PassVm;
  /** WB — only the discs that work today; the run closes up. */
  readonly actions: readonly WalletActionVm[];
  /** WC — `ready` with none held is the empty wallet (WC0). */
  readonly holdings: Slice<readonly WalletHoldingVm[]>;
  /** The heading's detail: «3 · 55,00 €» with several spendable vouchers (their sum is nowhere else); `null` otherwise — a bare count says nothing the tickets under it do not. */
  readonly holdingsDetail: string | null;
  /** WD — absent with `loyalty.streaks` off, and when the rule in force is off. */
  readonly rhythm?: WalletRhythmVm;
  /** WE — absent with `loyalty.tiers` off. */
  readonly tier?: Slice<WalletTierVm>;
  /** WF — absent with `loyalty.points` off, and with an empty catalogue. */
  readonly catalog?: Slice<RewardGridVm>;
  /** WG — the newest five events; absent with `loyalty.points` off and before the first entry. */
  readonly activity?: Slice<readonly ActivityGroupVm[]>;
}

/** LF, LG — the ledger's foot. */
export interface LedgerPagingVm {
  readonly kind: 'more' | 'loading' | 'failed' | 'end';
}

/** The ledger page «Движение» (§2.2.6). */
export interface LedgerPageVm {
  /** The first page's read: skeletons, the rows, or «Движението не се зареди.» [Опитай пак]. */
  readonly status: SliceStatus;
  /** LB — «Георги Петров · **371 т.**». */
  readonly subline: readonly LinePart[];
  /** LC — the chosen pill (its words and test id are the card's `LEDGER_FILTER_WORDS`). */
  readonly filter: JournalFeed;
  /** LD, LE — empty under a filter is the filtered empty state. */
  readonly groups: readonly ActivityGroupVm[];
  /** `null` while the first page is loading or failed, and offline with a cursor left. */
  readonly paging: LedgerPagingVm | null;
}

// ── «Постижения», «Рекорди», a medal (§2.3, §2.4) ───────────────────────

/** AC — one chip of the category band. No chip prints a count: its name says it. */
export interface AchievementChipVm {
  /** `all`, a category's id, or `seasons`: the store's `medalsChip`. */
  readonly id: string;
  /** «Всички» · «Етапи» · «Бръснари» · «Сезони». */
  readonly label: string;
  /** Named with its count: «Етапи, 3 от 5 спечелени» (`clientCard.achievements.chipName`). */
  readonly accessibleName: string;
}

/** AE — one personal record as a card of the 2 × 2. */
export interface RecordCardVm {
  /** The `achievements-record-{id}` test id. */
  readonly id: string;
  readonly kind: RecordKindWord;
  /** «Най-дълъг ритъм», sentence case. */
  readonly label: string;
  /** «23» · «Фейд» · «1 март» — a favourite's figure is the SERVICE. */
  readonly value: string;
  /** «септември 2026 г.» · «23 пъти» · «2025 г.»; `null` where the value says it all. */
  readonly detail: string | null;
  /** The emblem's glyph, white on the solid accent disc. */
  readonly icon: UiIconName;
  /** The subject's picture (a favourite service's cover), in the emblem's place; `null` draws the emblem. */
  readonly src: string | null;
  /** Set in the last 30 days of the shop's today: the capsule «Нов рекорд». */
  readonly isNew: boolean;
  /** «Най-дълъг ритъм: 23, септември 2026 г., нов рекорд» (`clientCard.achievements.recordName`). */
  readonly accessibleName: string;
}

/** AK — the collection: families with a level earned, of the families published today. */
export interface CollectionVm {
  /** circularCapacity `large`. */
  readonly ring: GaugeVm;
  /** The ring's centre, ONE number: «18». */
  readonly figure: string;
  /** «от 42 медала». */
  readonly line: string;
  /** «38 спечелени нива». */
  readonly levels: string;
  /** «Колекция: 18 от 42 медала, 38 спечелени нива». */
  readonly accessibleName: string;
}

/** AL — one category as a section of the overview: a grid, never a rail. */
export interface MedalSectionVm {
  /** The `achievements-shelf-{categoryId}` test id. */
  readonly categoryId: string;
  /** «Етапи». */
  readonly title: string;
  /** «3 от 5»: families started of the category's families — text, not a button. */
  readonly count: string;
  /** ALL the category's families, in shelf order: earned → in progress → not started. */
  readonly tiles: readonly AchievementTileVm[];
  /** AM — the category's total when it holds MORE than 9 families (two rows show, then «Покажи всички N»); else `null`. */
  readonly folded: number | null;
}

/** The «Постижения» overview (the chip «Всички»). An empty list or a `null` is an absent region. */
export interface MedalsPageVm {
  /** AE — FIRST on the page; ≤ 4, the account's records. */
  readonly records: readonly RecordCardVm[];
  /** AC — «Всички», the categories in their order, «Сезони» when a season or an event exists. */
  readonly chips: readonly AchievementChipVm[];
  /** AF — «Почти спечелени»: ONE row of ≤ 3; a medal this visit completes comes first. */
  readonly close: readonly AchievementTileVm[];
  /** AG — the running season. */
  readonly season: SeasonCardVm | null;
  /** AH — open and announced events. */
  readonly events: readonly EventCardVm[];
  /** AK */
  readonly collection: CollectionVm;
  /** AL */
  readonly sections: readonly MedalSectionVm[];
  /** AJ */
  readonly archive: ArchiveRowVm | null;
  /** «Първото постижение идва с първото посещение.» — one line under the chips while nothing is earned or under way. */
  readonly emptyHint: string | null;
}

/** RD — the themes «Рекорди» groups its rows by. */
export type RecordTheme = 'rhythm' | 'visits' | 'favourites';

/** RE — one row of «Рекорди»: a record of the account, or a fact the card already reads (§2.3.4). */
export interface RecordRowVm {
  /**
   * The card's own id, not a `PersonalRecordKind`: `longestRhythm` ·
   * `currentRhythm` · `totalVisits` · `last12Months` · `mostVisitsInYear` ·
   * `firstVisit` · `favouriteService` · `preferredBarber` · `usualServices`.
   */
  readonly id: string;
  readonly theme: RecordTheme;
  /** «Ритъм сега». */
  readonly title: string;
  /** «9» · «1.03.2025 г.» · «Фейд» · «Иван». */
  readonly figure: string;
  /** «от юни 2026 г.» · «2025 г.» · «23 пъти»; `null` for a bare figure. */
  readonly line: string | null;
  /** The accent glyph on the white disc; `null` where a picture or a face leads. */
  readonly icon: UiIconName | null;
  /** The subject's picture: a service's cover, a barber's face. */
  readonly src: string | null;
  /** The barber's name, for the avatar's initials; `null` where no face leads. */
  readonly faceName: string | null;
  readonly accessibleName: string;
}

/** RC — the record set most recently, the page's ONE hero figure. */
export type FeaturedRecordVm = RecordCardVm & {
  /** «поредни посещения в ритъм» — what the figure counts, under it. */
  readonly sentence: string;
};

/** RD, RE — one theme's rows; a group without a row is absent. */
export interface RecordGroupVm {
  readonly theme: RecordTheme;
  /** «Ритъм» · «Посещения» · «Любими». */
  readonly title: string;
  /** Without the featured record's row. */
  readonly rows: readonly RecordRowVm[];
}

/** RF — one year of «По години». */
export interface RecordYearVm {
  /** «2026». */
  readonly year: string;
  /** «11». */
  readonly count: string;
  /** linearCapacity `small`, against the record year. */
  readonly gauge: GaugeVm;
  /** The record year wears the emblem. */
  readonly record: boolean;
  /** «2025: 13 посещения, рекорд». */
  readonly accessibleName: string;
}

/** The «Рекорди» page (§2.3.4). */
export interface RecordsPageVm {
  /** RB — the head's name. */
  readonly subline: string;
  /** RC — `null` before the first record. */
  readonly featured: FeaturedRecordVm | null;
  readonly groups: readonly RecordGroupVm[];
  /**
   * RF — `null` unless the loaded history is the client's WHOLE history (no
   * cursor left): a year is never under-counted.
   */
  readonly years: readonly RecordYearVm[] | null;
}

/** DF — one cover of «Как се печели»: a picture, not a control. */
export interface DetailPictureVm {
  /** The `achievements-detail-count-{key}` test id: the subject's id. */
  readonly key: string;
  /** «Фейд» — under the cover, and the image's name. */
  readonly title: string;
  /** «28,00 €»; `null` for a barber or a shop. */
  readonly caption: string | null;
  readonly src: string | null;
  /** «+N» on the FOURTH cover: the subjects past it; else `null`. */
  readonly more: number | null;
}

/** DF — a face of the who line's avatar group. */
export interface DetailFaceVm {
  readonly name: string;
  readonly src: string | null;
}

/** DF — «Как се печели»: ONE sentence chosen by the family's metric, and the pictures (§2.4.3). */
export interface DetailHowVm {
  /** «Всяко посещение с фейд се брои, щом приключи.» */
  readonly sentence: string;
  /** By the family's subject; empty = no picture. */
  readonly pictures: readonly DetailPictureVm[];
  /** `16 / 9`: one cover across the card; `4 / 3`: two to four in a 2-up grid, and a barber's. */
  readonly ratio: '16 / 9' | '4 / 3';
  readonly columns: 1 | 2;
  /** The barbers' faces before the who line; empty for a barber's own family. */
  readonly faces: readonly DetailFaceVm[];
  /** «При всеки бръснар · във всеки салон». */
  readonly who: string;
  /** «Отменени часове и неявявания не се броят.» — ONCE; `null` where the metric counts no visits. */
  readonly excluded: string | null;
  /** Reserved, `[]` in this round (DV-B). */
  readonly steps: readonly string[];
}

/** DH — one level of the ladder of medals. */
export interface DetailLevelVm {
  /** The `achievements-detail-level-{n}` test id. */
  readonly level: number;
  /** `regular`: `complete` with ITS numeral when passed, else `notStarted` (the dashed silhouette). */
  readonly medal: MedalVm;
  /** «Ниво III · 25 посещения»; a one-off family's one row: «Награда». */
  readonly title: string;
  /** «50 точки» · «Безплатно оформяне на брада» · «Значка в профила»; `null` when the level pays nothing. */
  readonly reward: string | null;
  /** «16.04.2025»; `null` until earned. */
  readonly earnedOn: string | null;
  /** The words' ink: `passed` and `next` primary, `later` secondary. */
  readonly tone: 'passed' | 'next' | 'later';
  /** «Ниво II, 10 посещения, 50 точки, спечелено на 24 септември 2025 г.» */
  readonly accessibleName: string;
}

/** DK — the detail's one verb, drawn by the editor's DOCK, never in the body (DV-C). */
export interface DetailActionVm {
  /** The service the dock adds to this person's seat. */
  readonly serviceId: string;
  /** «Добави фейд». */
  readonly label: string;
  /** «Добави Фейд към посещението». */
  readonly accessibleName: string;
}

/** DE — the progress card, THE ONLY PLACE for the count. */
export interface MedalProgressVm {
  /** «23» — one-off: the state («С това посещение», or the date); complete: the last threshold. */
  readonly value: string;
  /** «от 25»; `null` for a one-off and a complete family. */
  readonly unit: string | null;
  /** «посещения с фейд». */
  readonly what: string;
  /** «Още 2 до ниво III» · «Всички нива»; `null` where nothing remains to say. */
  readonly remaining: string | null;
  /** «С това посещение: 24 от 25»; `null` unless this visit's legs hold what counts. */
  readonly thisVisit: string | null;
}

/** One medal family's detail (§2.4): six blocks, each fact once. */
export interface MedalDetailVm {
  readonly seriesId: string;
  /** The chip «Всички ›» chooses on «Постижения»; `null` for a season's family. */
  readonly categoryId: string | null;
  /** DC — «Фейд»: the `h2` and the bar's title. */
  readonly title: string;
  /** DA — the medal on its stage, `extraLarge`, wearing its own ring; `aria-hidden`. */
  readonly medal: MedalVm;
  /** DD — «Майсторство · Ниво II · от **24.09.2025 г.**» · «… · още не е започнато» · «Вече не се присъжда.» */
  readonly stateLine: readonly LinePart[];
  /** DE */
  readonly progress: MedalProgressVm;
  /** DF — `null` for a retired family. */
  readonly how: DetailHowVm | null;
  /** DH — every level; a one-off family's one «Награда» row. */
  readonly ladder: readonly DetailLevelVm[];
  /** DI — ≤ 5 of the loaded visits that counted (`countsToward`); empty = no section. */
  readonly visits: readonly VisitRowVm[];
  /** DJ — ≤ 3 tiles, ONE grid row; `null` when the family has no neighbours. */
  readonly related: DetailRelatedVm | null;
  /** DK — `null` unless the subject is a service the visit can take and does not hold. */
  readonly action: DetailActionVm | null;
}

// ── «Посещения» (§2.5) ──────────────────────────────────────────────────

/** The «Посещения» page: two quiet lines under the title, then the shared browser. */
export interface VisitsPageVm {
  /** The first page's read: skeletons, the list, or «Посещенията не се заредиха.» [Опитай пак]. */
  readonly status: SliceStatus;
  /** HB — «**23** посещения · през **4** седмици»; 0 visits: «Първо посещение». */
  readonly line: readonly LinePart[];
  /** HB as one sentence (`clientCard.history.statsName`). */
  readonly lineName: string;
  /** HC — «Без неявявания и откази от клиента · похарчени общо **492,50 €**» (the sum ‹admin› only); `null` with nothing to say. */
  readonly facts: readonly LinePart[] | null;
  /** The figures of HB as cells — kept for DV-D's way back; the page draws the line. */
  readonly cells: readonly HistoryCellVm[];
  readonly filter: VisitFilter;
  /** The funnel's options the loaded rows can answer: one nothing answers is absent, never disabled. */
  readonly offeredFilters: readonly VisitFilter[];
  /** «Предстоящи», then MONTHS newest first (grain `month`); empty under a filter = the filtered empty state. */
  readonly sections: readonly VisitSectionVm[];
  /** `null` while the first page is loading or failed, and offline with a cursor left. */
  readonly paging: HistoryPagingVm | null;
}
