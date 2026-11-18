import { type Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Barber } from '@core/entities';
import { AccessScope, BarberId, UserId } from '@core/primitives';
import { barberFixture } from '@core/testing';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import {
  type BarberVm,
  TeamCatalogService,
} from '@creativo/features/shared/catalog';
import { StaffDayStore } from '../staff-day.store';
import type { WelcomeFaceVm } from './staff-home.vm';
import { setupCardVm } from './staff-setup-card.presenter';
import { StaffSetupCard } from './staff-setup-card';
import { StaffWelcomeSheet } from './staff-welcome';
import { type WelcomeWords, welcomeVm } from './staff-welcome.presenter';

/*
 * A barber's own way in (account first, A4–A5): the setup card while their
 * profile is not done, and the first-time welcome while it is untouched.
 */

const OWN = BarberId.of('b-own');
const ME = UserId.of('u-own');
const BARE: Barber = barberFixture({
  id: OWN,
  title: null,
  bio: null,
  instagramHandle: null,
  yearsExperience: null,
  avatarMediaId: null,
});

/** A colleague's face as the team stream words it. */
function colleague(id: string, bg: string): BarberVm {
  return {
    id: BarberId.of(id),
    name: { bg, en: bg },
    title: null,
    bio: null,
    avatarSrc: '',
    objectPosition: '50% 25%',
    specialty: null,
    gallery: [],
  };
}

async function render<T>(
  component: Type<T>,
  options: {
    readonly barber?: Barber;
    readonly linked?: BarberId | null;
    /** Whether their own page opens for them; it does unless told. */
    readonly opensOwn?: boolean;
    readonly colleagues?: readonly BarberVm[];
  } = {},
) {
  const linked = options.linked === undefined ? OWN : options.linked;
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      provideTransloco({
        config: {
          availableLangs: ['bg'],
          defaultLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: class {
          getTranslation() {
            return of({
              staff: {
                setupCard: {
                  title: 'Довърши профила си',
                  body: '{{done}} от {{total}} готови.',
                  action: 'Продължи',
                },
                welcome: {
                  headlineNamed: '{{name}}, вече си в екипа',
                  headline: 'Вече си в екипа',
                  lede: 'Добави снимка и няколко думи за себе си — така клиентите ще те познаят.',
                  start: 'Да започваме',
                  later: 'По-късно',
                },
              },
            });
          }
        },
      }),
      {
        provide: StaffAccessService,
        useValue: {
          linkedBarberId: signal(linked),
          scopeOf: () => AccessScope.None,
          // `SessionAccessSystem.opensOwnProfile`: a linked record, and the
          // route's gate.
          opensOwnProfile: signal(
            linked !== null && (options.opensOwn ?? true),
          ),
        },
      },
      {
        provide: AccountStateService,
        useValue: {
          userId: signal(ME),
          account: signal({ firstName: 'Петър' }),
        },
      },
      {
        provide: TeamCatalogService,
        useValue: {
          teamKnown: signal(true),
          teamBarbers: signal([options.barber ?? BARE]),
          liveBarberVms: signal(options.colleagues ?? []),
          findTeamBarberVm: () => undefined,
        },
      },
      { provide: StaffDayStore, useValue: { todayKey: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const piece = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, host, piece };
}

afterEach(() => {
  localStorage.clear();
  TestBed.resetTestingModule();
});

describe('setupCardVm', () => {
  it('words what is left of the profile, and nothing once it is done', () => {
    const words = {
      title: 'Довърши профила си',
      body: (done: number, total: number) => `${done} от ${total} готови.`,
      action: 'Продължи',
    };
    expect(setupCardVm({ done: 2, total: 5 }, words)).toEqual({
      title: 'Довърши профила си',
      body: '2 от 5 готови.',
      action: 'Продължи',
    });
    expect(setupCardVm(null, words)).toBeNull();
  });
});

describe('StaffSetupCard', () => {
  it('shows a linked barber what is left of their profile, and «Продължи» opens their own page', async () => {
    const { piece } = await render(StaffSetupCard, {
      barber: { ...BARE, title: { bg: 'Бръснар', en: 'Barber' } },
    });
    expect(piece('staff-setup-card')?.textContent).toContain('1 от 5 готови.');
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    piece('staff-setup-card-open')?.click();
    expect(navigate).toHaveBeenCalledWith(['/staff/profile']);
  });

  it('says nothing to an account with no record of its own, nor to one whose own page would not open', async () => {
    const unlinked = await render(StaffSetupCard, { linked: null });
    expect(unlinked.piece('staff-setup-card')).toBeNull();
    TestBed.resetTestingModule();
    const taken = await render(StaffSetupCard, { opensOwn: false });
    expect(taken.piece('staff-setup-card')).toBeNull();
  });
});

describe('StaffWelcomeSheet', () => {
  it('welcomes a linked barber whose profile is untouched; «По-късно» lets it go on this device', async () => {
    const first = await render(StaffWelcomeSheet);
    expect(first.piece('staff-welcome')).not.toBeNull();
    expect(first.piece('staff-welcome-headline')?.textContent?.trim()).toBe(
      'Петър, вече си в екипа',
    );
    first.piece('staff-welcome-later')?.click();
    first.fixture.detectChanges();
    expect(localStorage.getItem(`staff-welcome-seen:${ME}`)).toBe('1');
    TestBed.resetTestingModule();

    const again = await render(StaffWelcomeSheet);
    expect(again.piece('staff-welcome')).toBeNull();
  });

  it('«Да започваме» opens their own page', async () => {
    const { piece } = await render(StaffWelcomeSheet);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    piece('staff-welcome-start')?.click();
    expect(navigate).toHaveBeenCalledWith(['/staff/profile']);
  });

  it('puts their face at the centre of the colleagues they join, and leads to the profile in one line — never a list of names', async () => {
    const { piece } = await render(StaffWelcomeSheet, {
      colleagues: [
        colleague('b-ivan', 'Иван'),
        colleague('b-niko', 'Нико'),
        colleague('b-own', 'Аз'),
      ],
    });
    expect(
      piece('staff-welcome-faces')?.querySelectorAll('ui-avatar'),
    ).toHaveLength(3);
    expect(piece('staff-welcome-lede')?.textContent?.trim()).toBe(
      'Добави снимка и няколко думи за себе си — така клиентите ще те познаят.',
    );
    // Who they are is the faces' to say, and the label's.
    expect(piece('staff-welcome-faces')?.getAttribute('aria-label')).toContain(
      'Иван и Нико',
    );
  });

  it('never welcomes someone who has set anything of their profile, nor an account with no record', async () => {
    const started = await render(StaffWelcomeSheet, {
      barber: { ...BARE, bio: { bg: 'Здравейте', en: 'Hi' } },
    });
    expect(started.piece('staff-welcome')).toBeNull();
    TestBed.resetTestingModule();
    const unlinked = await render(StaffWelcomeSheet, { linked: null });
    expect(unlinked.piece('staff-welcome')).toBeNull();
    TestBed.resetTestingModule();
    const taken = await render(StaffWelcomeSheet, { opensOwn: false });
    expect(taken.piece('staff-welcome')).toBeNull();
  });
});

describe('welcomeVm', () => {
  const face = (id: string, name: string): WelcomeFaceVm => ({
    id,
    name,
    avatarSrc: null,
  });
  const own = face('b-own', 'Петър Петров');
  const team = [
    face('b-1', 'Иван'),
    face('b-2', 'Нико'),
    face('b-3', 'Мартин'),
    face('b-4', 'Елена'),
    face('b-5', 'Георги'),
  ];
  const bg: WelcomeWords = {
    headlineNamed: (name) => `${name}, вече си в екипа`,
    headline: 'Вече си в екипа',
  };
  const en: WelcomeWords = {
    headlineNamed: (name) => `${name}, you’re on the team`,
    headline: 'You’re on the team',
  };

  it('greets by first name, puts the newcomer at the centre of everyone they join, and names them all to assistive tech', () => {
    const vm = welcomeVm({
      firstName: ' Петър ',
      accountName: '',
      own,
      colleagues: team,
      words: bg,
      locale: 'bg',
    });
    expect(vm.headline).toBe('Петър, вече си в екипа');
    expect(vm.own).toBe(own);
    expect(vm.colleagues).toBe(team);
    expect(vm.facesLabel).toBe(
      'Петър Петров, Иван, Нико, Мартин, Елена и Георги',
    );
  });

  it('names the centre as the account names the person — the greeting and the initials agree — the record’s photo kept', () => {
    const record: WelcomeFaceVm = {
      id: 'b-own',
      name: 'Нов Бръснар',
      avatarSrc: 'https://example.test/own.jpg',
    };
    const vm = welcomeVm({
      firstName: 'Петър',
      accountName: ' Петър Петров ',
      own: record,
      colleagues: team.slice(0, 1),
      words: bg,
      locale: 'bg',
    });
    expect(vm.headline).toBe('Петър, вече си в екипа');
    expect(vm.own).toEqual({
      id: 'b-own',
      name: 'Петър Петров',
      avatarSrc: 'https://example.test/own.jpg',
    });
    expect(vm.facesLabel).toBe('Петър Петров и Иван');
    // An account with no name keeps the record's.
    expect(
      welcomeVm({
        firstName: null,
        accountName: '',
        own: record,
        colleagues: [],
        words: bg,
        locale: 'bg',
      }).own.name,
    ).toBe('Нов Бръснар');
  });

  it('in English, and with no first name, and alone', () => {
    expect(
      welcomeVm({
        firstName: 'Peter',
        accountName: '',
        own,
        colleagues: team.slice(0, 2),
        words: en,
        locale: 'en',
      }),
    ).toMatchObject({
      headline: 'Peter, you’re on the team',
      facesLabel: 'Петър Петров, Иван, and Нико',
    });
    expect(
      welcomeVm({
        firstName: null,
        accountName: '',
        own,
        colleagues: team.slice(0, 1),
        words: bg,
        locale: 'bg',
      }).headline,
    ).toBe('Вече си в екипа');
    const alone = welcomeVm({
      firstName: '',
      accountName: '',
      own,
      colleagues: [],
      words: bg,
      locale: 'bg',
    });
    expect(alone).toMatchObject({
      headline: 'Вече си в екипа',
      facesLabel: 'Петър Петров',
    });
    expect(alone.own).toBe(own);
    expect(alone.colleagues).toEqual([]);
  });
});
