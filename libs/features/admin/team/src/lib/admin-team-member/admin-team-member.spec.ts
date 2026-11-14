import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  BarberActivation,
  BarberEdit,
  BarberLinkChange,
  Role,
} from '@core/components';
import { PipelineError } from '@core/errors';
import { Callables } from '@core/ports';
import { localDate, locationFixture } from '@core/testing';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import {
  IVAN,
  IVAN_RECORD,
  NIKOLAY,
  NIKOLAY_RECORD,
  RECORDS,
  STEFAN_RECORD,
  TEAM,
  rosterOf,
  serviceOf,
} from '../team.fixtures.spec-support';
import { AdminTeamMember } from './admin-team-member';

/*
 * A team member's page: what it draws for whoever is looking, and the
 * calls its rows make — the real template over scripted calls.
 */

const NBSP = ' ';
const BARBERS = [IVAN_RECORD, NIKOLAY_RECORD, STEFAN_RECORD];

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: 'ACCESS_DENIED',
  staffCapability: 'TEAM_MANAGE',
});

async function render(barberId: string, options: TeamBedOptions = {}) {
  const bed = teamBed({ members: TEAM, barbers: BARBERS, ...options });
  await TestBed.configureTestingModule({
    imports: [AdminTeamMember],
    providers: bed.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminTeamMember);
  fixture.componentRef.setInput('barberId', barberId);
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const root = fixture.nativeElement as HTMLElement;
  const piece = (id: string) =>
    root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    (element?.textContent ?? '')
      .replaceAll(NBSP, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  /** Types into a field the way a person does. */
  const type = async (id: string, value: string): Promise<void> => {
    const field = piece(id) as HTMLInputElement | HTMLTextAreaElement;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const press = async (id: string): Promise<void> => {
    piece(id)?.click();
    await settle();
  };
  return { fixture, root, piece, text, type, press, settle, ...bed };
}

describe('AdminTeamMember — a record in preparation', () => {
  it('heads the page with the person and leads with what bookings need', async () => {
    const { piece, text } = await render('nikolay');

    expect(text(piece('member-name'))).toBe('Николай Стоянов');
    expect(text(piece('member-standing'))).toBe('Подготовка · 3 от 5');
    expect(text(piece('member-setup-NAME'))).toContain('Име — готово');
    expect(text(piece('member-setup-NAME'))).toContain('Николай Стоянов');
    expect(text(piece('member-setup-START_DAY'))).toContain('1.12');
    expect(text(piece('member-setup-SERVICES'))).toContain(
      'Услуги и цени — липсва',
    );
    expect(text(piece('member-setup-HOURS'))).toContain('Няма');
    expect(piece('member-setup-SHOPS')).toBeNull();
    expect(text(piece('member-goes-live'))).toBe(
      'Николай започва да приема записи, щом всичко тук е готово.',
    );
    // What is done carries the mark; what is missing does not.
    expect(piece('member-setup-NAME')?.hasAttribute('data-done')).toBe(true);
    expect(piece('member-setup-HOURS')?.hasAttribute('data-done')).toBe(false);
  });

  it('the name, the day and the hours are ways into their editors; the services are read', async () => {
    const { piece } = await render('nikolay');
    expect(piece('member-setup-NAME')?.tagName).toBe('BUTTON');
    expect(piece('member-setup-START_DAY')?.tagName).toBe('BUTTON');
    expect(piece('member-setup-HOURS')?.tagName).toBe('BUTTON');
    expect(piece('member-setup-SERVICES')?.tagName).not.toBe('BUTTON');
  });

  it('the hours row raises the schedule’s own sheet on this record; a week set there is ONE roster write, and the page says it was saved', async () => {
    const center = locationFixture();
    const { piece, press, text, settle, calls } = await render('nikolay', {
      locations: [center],
    });
    expect(piece('staff-hours-sheet')).toBeNull();

    await press('member-setup-HOURS');
    await settle();

    expect(piece('staff-hours-sheet')).not.toBeNull();
    // One chair: the sheet offers no chair to pick.
    expect(piece('staff-hours-chair')).toBeNull();
    expect((piece('staff-hours-save') as HTMLButtonElement).disabled).toBe(
      true,
    );

    // Monday: working, the sheet's own first shift.
    await press('staff-hours-day-1');
    await press('staff-hours-working');
    await press('staff-hours-done');
    await press('staff-hours-save');
    await settle();

    expect(calls.dialled).toHaveLength(1);
    expect(calls.dialled[0]?.callable).toBe(Callables.SetRosterWeek);
    const week = calls.dialled[0]?.input as {
      barberId: string;
      locationId: string;
      segments: readonly { weekday: number; locationId: string }[];
    };
    expect(week.barberId).toBe(NIKOLAY.barberId);
    // A record that works everywhere files its shifts at the first shop.
    expect(week.locationId).toBe(center.id);
    expect(week.segments).toHaveLength(1);
    expect(week.segments[0]?.locationId).toBe(center.id);
    // Saved: the sheet has left and the page says so.
    expect(piece('staff-hours-sheet')).toBeNull();
    expect(text(piece('member-hours-toast'))).toContain(
      'Работното време е запазено',
    );
  });

  it('hours that complete the record: it goes live, and the page says that instead of «запазено»', async () => {
    const { piece, press, settle, activates, liveSchedules } = await render(
      'nikolay',
      {
        locations: [locationFixture()],
        services: [serviceOf(NIKOLAY.barberId)],
      },
    );
    activates(BarberActivation.Activated);
    await press('member-setup-HOURS');
    await settle();
    await press('staff-hours-day-1');
    await press('staff-hours-working');
    await press('staff-hours-done');
    await press('staff-hours-save');
    await settle();
    // Saved: the hours' own receipt is up.
    expect(piece('member-hours-toast')?.hasAttribute('data-presented')).toBe(
      true,
    );

    // The roster's listener then says the week: every needed item is done.
    liveSchedules([rosterOf(NIKOLAY.barberId)]);
    await settle();
    await settle();

    expect(piece('member-live-toast')?.hasAttribute('data-presented')).toBe(
      true,
    );
    expect(piece('member-live-toast')?.textContent).toContain(
      'вече приема записи',
    );
    expect(piece('member-hours-toast')?.hasAttribute('data-presented')).toBe(
      false,
    );
  });

  it('a refused week is said in the hours sheet, which stays, and never on the page', async () => {
    const { piece, press, settle, dialRefuses } = await render('nikolay', {
      locations: [locationFixture()],
    });
    dialRefuses(Callables.SetRosterWeek, REFUSED);
    await press('member-setup-HOURS');
    await settle();
    await press('staff-hours-day-1');
    await press('staff-hours-working');
    await press('staff-hours-done');
    await press('staff-hours-save');
    await settle();

    expect(piece('staff-hours-sheet')).not.toBeNull();
    expect(piece('staff-hours-error')).not.toBeNull();
    expect(piece('member-refusal')).toBeNull();
  });

  it('the name row opens the profile on the record as it stands; a changed name is saved whole and the sheet leaves', async () => {
    const { piece, press, type, calls } = await render('nikolay');
    expect(piece('member-profile-sheet')).toBeNull();

    await press('member-setup-NAME');

    const name = piece('member-profile-name') as HTMLInputElement;
    expect(name.value).toBe('Николай Стоянов');
    // The English is its own text here, so the translation shows it.
    expect((piece('member-profile-name-en') as HTMLInputElement).value).toBe(
      'Nikolay Stoyanov',
    );
    const save = piece('member-profile-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await type('member-profile-name', 'Николай Стоянов-Илиев');
    await type('member-profile-position', 'Бръснар');
    await type('member-profile-instagram', '@niko.cuts');
    expect(save.disabled).toBe(false);

    await press('member-profile-save');

    expect(calls.edits).toHaveLength(1);
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Profile,
      barberId: NIKOLAY.barberId,
      name: { bg: 'Николай Стоянов-Илиев', en: 'Nikolay Stoyanov' },
      title: { bg: 'Бръснар', en: null },
      bio: { bg: '', en: null },
      instagramHandle: '@niko.cuts',
      yearsExperience: null,
    });
  });

  it('never offers a save the record would not take: a blank name, or a handle that is none', async () => {
    const { piece, press, type } = await render('nikolay');
    await press('member-setup-NAME');
    const save = piece('member-profile-save') as HTMLButtonElement;

    await type('member-profile-name', '   ');
    expect(save.disabled).toBe(true);

    await type('member-profile-name', 'Николай');
    await type('member-profile-instagram', 'not a handle');
    expect(save.disabled).toBe(true);

    await type('member-profile-instagram', 'niko');
    expect(save.disabled).toBe(false);
  });

  it('a refused save is said in the sheet, in the catalogue’s words, and the sheet stays', async () => {
    const { piece, press, type, text, refuses } = await render('nikolay');
    refuses('editBarber', REFUSED);
    await press('member-setup-NAME');
    await type('member-profile-name', 'Николай');
    await press('member-profile-save');

    expect(text(piece('member-profile-refusal')).length).toBeGreaterThan(0);
    expect(piece('member-profile-sheet')).not.toBeNull();
    // The page does not say an editor's refusal twice.
    expect(piece('member-refusal')).toBeNull();
  });

  it('the day row opens the working period on the record’s days, with nothing to save yet', async () => {
    const { piece, press, text } = await render('nikolay');
    await press('member-setup-START_DAY');

    expect(text(piece('member-period-start'))).toContain('1.12');
    expect(text(piece('member-period-last'))).toContain('Няма');
    expect(piece('member-period-last-clear')).toBeNull();
    expect((piece('member-period-save') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('«Без последен ден» removes the day, keeps the keyboard in the sheet, and the period is saved with none', async () => {
    const leaving = {
      ...NIKOLAY_RECORD,
      barberLastWorkingLocalDate: localDate('2026-12-31'),
    };
    const { piece, press, text, calls } = await render('nikolay', {
      barbers: [IVAN_RECORD, leaving],
    });
    expect(text(piece('member-row-period'))).toContain('1.12 – 31.12');

    await press('member-row-period');
    expect(text(piece('member-period-last'))).toContain('31.12');
    expect((piece('member-period-save') as HTMLButtonElement).disabled).toBe(
      true,
    );

    await press('member-period-last-clear');

    expect(piece('member-period-last-clear')).toBeNull();
    expect(text(piece('member-period-last'))).toContain('Няма');
    // The row that held focus is gone: focus is on the value beside it.
    expect(document.activeElement).toBe(piece('member-period-last'));

    await press('member-period-save');
    expect(calls.edits).toHaveLength(1);
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Period,
      barberStartsLocalDate: NIKOLAY_RECORD.barberStartsLocalDate,
      barberLastWorkingLocalDate: null,
      barberId: NIKOLAY.barberId,
    });
  });

  it('goes live by itself the moment the last needed item lands, and says so', async () => {
    const {
      piece,
      text,
      settle,
      calls,
      activates,
      liveSchedules,
      liveBarbers,
    } = await render('nikolay', { services: [serviceOf(NIKOLAY.barberId)] });
    expect(text(piece('member-standing'))).toBe('Подготовка · 4 от 5');

    activates(BarberActivation.Activated);
    liveSchedules([rosterOf(NIKOLAY.barberId)]);
    await settle();
    await settle();

    expect(calls.activations).toHaveLength(1);
    // The stream then says the record is at work.
    liveBarbers([
      IVAN_RECORD,
      { ...IVAN_RECORD, id: NIKOLAY.barberId, name: NIKOLAY.memberName },
    ]);
    await settle();
    expect(text(piece('member-standing'))).toBe('Приема записи');
    expect(piece('member-setup')).toBeNull();
    expect(piece('member-delete')).toBeNull();
  });

  it('«Изтрий» asks first, deletes on yes and goes back to the list', async () => {
    const { piece, press, text, calls, settle } = await render('nikolay');
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    await press('member-delete');
    expect(text(piece('member-delete-question'))).toContain(
      'Да изтрия ли Николай Стоянов?',
    );
    expect(calls.deletes).toEqual([]);

    await press('member-delete-confirm');
    await settle();

    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]?.barberId).toBe(NIKOLAY.barberId);
    expect(navigate).toHaveBeenCalledWith(['/admin/team']);
  });
});

describe('AdminTeamMember — the record’s own answers', () => {
  it('the pool switch flips at once and sends the one part', async () => {
    const { piece, press, calls } = await render('nikolay');
    const pool = piece('member-pool');
    expect(pool?.getAttribute('aria-checked')).toBe('true');

    await press('member-pool');

    expect(pool?.getAttribute('aria-checked')).toBe('false');
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Pool,
      barberJoinsAnyPool: false,
      barberId: NIKOLAY.barberId,
    });
  });

  it('a refused switch goes back, and the page says why', async () => {
    const { piece, press, text, refuses, settle } = await render('nikolay');
    refuses('editBarber', REFUSED);

    await press('member-pool');
    await settle();

    expect(piece('member-pool')?.getAttribute('aria-checked')).toBe('true');
    expect(text(piece('member-refusal')).length).toBeGreaterThan(0);
  });

  it('says who may book the person', async () => {
    const { piece, text } = await render('nikolay');
    expect(text(piece('member-booked-by-row'))).toContain(
      'Кой може да записва',
    );
    expect(text(piece('member-booked-by'))).toBe('Всички');
  });
});

describe('AdminTeamMember — «Това съм аз» · «Не съм аз» (staff permissions P9)', () => {
  it('offers the owner a record nobody is linked to, and says what no account means', async () => {
    const { piece, text } = await render('nikolay');
    expect(text(piece('member-is-me'))).toBe('Това съм аз');
    expect(piece('member-not-me')).toBeNull();
    expect(piece('member-account-linked')).toBeNull();
    expect(text(piece('member-account-note'))).toBe(
      'Без профил Николай не влиза в приложението. Часовете се записват от екипа.',
    );
  });

  it('pressed, it links the owner’s own account and turns into the way back', async () => {
    const { piece, press, text, calls } = await render('nikolay');

    await press('member-is-me');

    expect(calls.roles).toHaveLength(1);
    expect(calls.roles[0]).toMatchObject({
      targetUserId: 'u-owner',
      barberLinkChange: BarberLinkChange.Set,
      linkedBarberId: NIKOLAY.barberId,
    });
    expect(piece('member-is-me')).toBeNull();
    expect(text(piece('member-not-me'))).toBe('Не съм аз');
    expect(text(piece('member-account-note'))).toContain('Работиш и на стола');

    await press('member-not-me');
    expect(calls.roles[1]).toMatchObject({
      roles: [Role.Admin],
      barberLinkChange: BarberLinkChange.Clear,
    });
    expect(text(piece('member-is-me'))).toBe('Това съм аз');
  });

  it('is not offered on a record another account holds', async () => {
    const { piece, text } = await render('ivan');
    expect(piece('member-is-me')).toBeNull();
    expect(piece('member-not-me')).toBeNull();
    expect(text(piece('member-account-linked'))).toContain('Иван Петров');
    expect(text(piece('member-account-linked'))).toContain('Бръснар');
  });
});

describe('AdminTeamMember — a record at work', () => {
  const working: TeamBedOptions = {
    services: [serviceOf(IVAN.barberId)],
    schedules: [rosterOf(IVAN.barberId)],
  };

  it('has no checklist; its rows are at rest, and the owner finds the way to the level it holds', async () => {
    const { piece, text } = await render('ivan', working);

    expect(text(piece('member-standing'))).toBe('Приема записи');
    expect(piece('member-setup')).toBeNull();
    expect(text(piece('member-row-profile'))).toContain('Старши бръснар');
    expect(text(piece('member-row-hours'))).toContain('Зададено');
    expect(piece('member-row-hours')?.tagName).toBe('BUTTON');
    expect(text(piece('member-row-services'))).toContain('1 услуга');
    expect(text(piece('member-row-period'))).toContain('от 3.03.2024 г.');
    expect(piece('member-delete')).toBeNull();
    const level = piece('member-level-barber');
    expect(level?.getAttribute('href')).toBe('/admin/team/permissions/barber');
    expect(text(level)).toContain('Права на „Бръснар“');
    expect(text(level)).toContain('Стандартни');
  });

  it('for a content editor: the profile opens, the rest is read, and no account or level is shown', async () => {
    const { piece } = await render('ivan', {
      ...working,
      roles: [Role.ContentManager],
      members: RECORDS,
    });

    expect(piece('member-row-profile')?.tagName).toBe('BUTTON');
    expect(piece('member-row-hours')?.tagName).not.toBe('BUTTON');
    expect(piece('member-row-period')?.tagName).not.toBe('BUTTON');
    expect((piece('member-pool') as HTMLButtonElement).disabled).toBe(true);
    expect(piece('member-booked-by')?.tagName).not.toBe('BUTTON');
    expect(piece('member-account')).toBeNull();
    expect(piece('member-levels')).toBeNull();
    expect(piece('member-delete')).toBeNull();
  });
});

describe('AdminTeamMember — the edges', () => {
  it('a record that has left is read: when it left, and nothing to change', async () => {
    const { piece, text } = await render('stefan');
    expect(text(piece('member-standing'))).toBe('Напусна на 30.09');
    expect(piece('member-row-profile')?.tagName).not.toBe('BUTTON');
    expect(piece('member-pool-row')).toBeNull();
    expect(piece('member-booked-by-row')).toBeNull();
    expect(piece('member-is-me')).toBeNull();
    expect(piece('member-delete')).toBeNull();
  });

  it('says a record the team does not hold in words', async () => {
    const { piece, text } = await render('nobody');
    expect(text(piece('admin-team-member-missing'))).toBe(
      'Не намерихме този човек в екипа.',
    );
    expect(piece('member-name')).toBeNull();
  });

  it('reads the Team list on arrival, and the back chip leads to it', async () => {
    const { piece, listed } = await render('nikolay');
    expect(listed).toEqual([{}]);
    expect(piece('admin-team-member-back')?.getAttribute('href')).toBe(
      '/admin/team',
    );
  });
});
