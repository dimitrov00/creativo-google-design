/**
 * What a family or a season is drawn with when no art wins over it — a
 * domain id the feature maps to an icon key (`loyalty.badge.<emblem>`); no
 * icon key is ever stored. Two art-less families of one shelf or one
 * season never share one; a season's or an event's family never wears a
 * perennial family's face (§3.3, wave D r6). A stable catalogue identifier:
 * unlike the SCREAMING tag dictionaries it keeps its stored strings
 * (flatten-spec §0.4).
 */
export const BadgeEmblem = {
  Visits: 'visits',
  Streak: 'streak',
  Referral: 'referral',
  SelfService: 'selfService',
  Birthday: 'birthday',
  Welcome: 'welcome',
  Service: 'service',
  Barber: 'barber',
  Shop: 'shop',
  Anniversary: 'anniversary',
  EarlyBird: 'earlyBird',
  Weekend: 'weekend',
  OnTime: 'onTime',
  Waitlist: 'waitlist',
  Profile: 'profile',
  Party: 'party',
  Explorer: 'explorer',
  /** A visit in each month of a rolling year («Цяла година»). */
  YearRound: 'yearRound',
  /** Back in rhythm after a break («Завръщане»). */
  Comeback: 'comeback',
  /** An event — «Седмица на брадата» in the archive. */
  Event: 'event',
  Summer: 'summer',
  Autumn: 'autumn',
  /** Visits close together before the holidays («Преди отпуска»). */
  Vacation: 'vacation',
  /** «Всеки летен месец» — a visit in every month of the summer. */
  Sailing: 'sailing',
  /** «Лятна събота» — a summer Saturday in the chair. */
  Icecream: 'icecream',
  /** «Всеки есенен месец» — a visit in every month of the autumn. */
  Umbrella: 'umbrella',
  /** «Есенно утро» — an early visit on an autumn morning. */
  Fog: 'fog',
  /** «Приятел наесен» — a friend brought in this season. */
  Handshake: 'handshake',
  /** «Есенна брада» — a beard kept through the season. */
  Grooming: 'grooming',
  /** «Брада на седмицата» — the beard of an event. */
  BeardOil: 'beardOil',
  /** «Пълна грижа на седмицата» — the whole treatment, in an event. */
  Spa: 'spa',
} as const;
export type BadgeEmblem = (typeof BadgeEmblem)[keyof typeof BadgeEmblem];
