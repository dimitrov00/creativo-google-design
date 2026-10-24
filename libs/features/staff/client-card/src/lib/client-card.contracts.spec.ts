import type {
  VisitCardWords,
  VisitWaitlistWords,
  VisitWords,
} from '@creativo/features/shared/visits';
import type { CouponOccasion } from '@core/components';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as achievements from './achievements.presenter';
import * as card from './client-card.presenter';
import type {
  ClientCardGrant,
  ClientCardRegion,
  WalletAnchor,
} from './client-card.contracts';
import type { ClientCardWords } from './client-card.words';
import * as loyalty from './loyalty.presenter';

/*
 * THE CONTRACT OF REVISION 3, AS PUBLISHED IN W0 (client-card-revision-3
 * §4.9, §7.3): what the card is handed, and the built helpers the new
 * presenter files import instead of copying. Both are frozen from the
 * first gate — a change goes through the lead — so both are pinned here,
 * where a change breaks first. In W4 (Z1) the lists narrowed to what the
 * new files DO import: a published helper nobody took up went with the
 * built pages (`readyRewards`, `pointsText`, `redemptionsOf`,
 * `stateLineOf`, `awardShortOf`, `awardSentenceOf`). In the Law 10.2
 * pass the rhythm's two uncalled delegates went too (`rhythmLabel`,
 * `rhythmStateLine`): the wallet words `StreakSystem.outlook` through
 * `rhythmLineOf` and `rhythmTrackName`.
 */

describe('client card contracts, revision 3', () => {
  it('lets a grant say the moment its coupon was made for, and lets it say nothing', () => {
    expectTypeOf<ClientCardGrant['couponOccasion']>().toEqualTypeOf<
      CouponOccasion | null | undefined
    >();
    // Additive: a host that builds a grant without it still builds a grant.
    expectTypeOf<
      Omit<ClientCardGrant, 'couponOccasion'>
    >().toExtend<ClientCardGrant>();
  });

  it('opens the wallet on five sections, one type for the glance, the wallet and the editor (G1-4)', () => {
    expectTypeOf<WalletAnchor>().toEqualTypeOf<
      'catalog' | 'stamps' | 'rhythm' | 'wallet' | 'status'
    >();
  });

  it('words the shared visit card from the card’s own table, as it stands', () => {
    // What `visitCardOf` and `waitlistCardOf` take, the glance's presenter
    // hands over without an adapter.
    expectTypeOf<ClientCardWords['visitCard']>().toExtend<VisitCardWords>();
    expectTypeOf<ClientCardWords['visits']>().toEqualTypeOf<VisitWords>();
    expectTypeOf<
      ClientCardWords['waitlist']
    >().toEqualTypeOf<VisitWaitlistWords>();
  });

  it('retries the wallet’s two reads as regions of their own', () => {
    expectTypeOf<ClientCardRegion>().toEqualTypeOf<
      | 'profile'
      | 'loyalty'
      | 'achievements'
      | 'visits'
      | 'photos'
      | 'history'
      | 'vouchers'
      | 'activity'
    >();
  });
});

describe('the built helpers the new presenters import (§7.3)', () => {
  const published: readonly (readonly [
    string,
    Readonly<Record<string, unknown>>,
    readonly string[],
  ])[] = [
    [
      'achievements.presenter',
      achievements,
      [
        // Exported in W0.
        'localeOf',
        'progressOf',
        // `earnedAtOf` read an instant; the stored shop day is the fact (T5).
        'earnedOnOf',
        'latestEarned',
        'isOneOff',
        'isSingleLevel',
        'inEndedSeason',
        'landsOn',
        'familyTile',
        'archiveRowOf',
        'relatedOf',
        // Exported already, and used as they are.
        'medalVm',
        'shelfOrdered',
        'completesWithThisVisit',
        'newestFaceLevel',
        'seasonCardVm',
        'eventCardVm',
        'scopePageVm',
        'scopeTitleOf',
      ],
    ],
    [
      'loyalty.presenter',
      loyalty,
      ['groupedGrants', 'ticketOf', 'sliceMap', 'glanceReward'],
    ],
    [
      'client-card.presenter',
      card,
      [
        'phoneOf',
        'sameLegs',
        'pauseOf',
        'isBirthdayToday',
        'displayNameOf',
        'quickActionsVm',
        'lastWorkedVisit',
        'clientPhotoVm',
        'photoRailVm',
        'isInChairToday',
        'capsulesRun',
      ],
    ],
  ];

  for (const [file, module, names] of published) {
    it(`${file} exports every function the contract names`, () => {
      const exported = new Map(Object.entries(module));
      const missing = names.filter(
        (name) => typeof exported.get(name) !== 'function',
      );
      expect(missing).toEqual([]);
    });
  }

  it('exports the two emblem tables beside them', () => {
    expect(Object.keys(achievements.BADGE_EMBLEM_ICONS).length).toBeGreaterThan(
      0,
    );
    expect(
      Object.keys(achievements.BADGE_CATEGORY_ICONS).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the signatures the new files call', () => {
    expectTypeOf(loyalty.sliceMap<number, string>).returns.toEqualTypeOf<
      | { readonly loadState: 'LOADING' }
      | { readonly loadState: 'READY'; readonly data: string }
      | { readonly loadState: 'FAILED' }
      | undefined
    >();
    expectTypeOf(achievements.isOneOff).returns.toEqualTypeOf<boolean>();
    expectTypeOf(achievements.isSingleLevel).returns.toEqualTypeOf<boolean>();
    expectTypeOf(achievements.landsOn).returns.toEqualTypeOf<string | null>();
    expectTypeOf(card.sameLegs).returns.toEqualTypeOf<boolean>();
  });
});
