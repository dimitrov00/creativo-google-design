import { describe, expect, it } from 'vitest';
import { ImpersonationScope, type ReadAsClaims } from '@core/components';
import { ImpersonationSessionId, UserId, UtcEpochMs } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import { readAsBannerVm } from './read-as-banner.presenter';
import type { ReadAsBannerWords } from './read-as.words';

/*
 * The read-as banner's words (OR-24): whose eyes, until when on the shop's
 * clock, and «Край» — nothing at all on a plain session.
 */

const WORDS: ReadAsBannerWords = {
  actingAs: (name) => `Действаш като ${name}`,
  someone: 'този профил',
  until: (time) => `до ${time}`,
  end: 'Край',
  label: 'Само за четене',
};

/** 12:32 in Sofia (UTC+2 in November). */
const EXPIRES = unwrapOk(UtcEpochMs.of(Date.UTC(2026, 10, 24, 10, 32)));

const READ_AS: ReadAsClaims = {
  readAsSessionId: ImpersonationSessionId.of('imp-1'),
  readAsByUserId: UserId.of('u-support'),
  readAsScope: ImpersonationScope.Read,
  readAsExpiresAtUtcMs: EXPIRES,
};

const SOFIA = unwrapOk(ZonedTimeSystem.checkZone('Europe/Sofia'));

describe('readAsBannerVm', () => {
  it('draws nothing on a plain session', () => {
    expect(
      readAsBannerVm({
        readAs: null,
        name: 'Иван Колев',
        zone: SOFIA,
        locale: 'bg-BG',
        words: WORDS,
      }),
    ).toBeNull();
  });

  it('words whose eyes these are and until when, on the shop’s clock', () => {
    expect(
      readAsBannerVm({
        readAs: READ_AS,
        name: 'Иван Колев',
        zone: SOFIA,
        locale: 'bg-BG',
        words: WORDS,
      }),
    ).toEqual({
      title: 'Действаш като Иван Колев',
      until: 'до 12:32',
      end: 'Край',
      label: 'Само за четене',
    });
  });

  it('names the account generically when it has no name, and leaves the time out until the zone is known', () => {
    expect(
      readAsBannerVm({
        readAs: READ_AS,
        name: '  ',
        zone: null,
        locale: 'bg-BG',
        words: WORDS,
      }),
    ).toEqual({
      title: 'Действаш като този профил',
      until: '',
      end: 'Край',
      label: 'Само за четене',
    });
  });
});
