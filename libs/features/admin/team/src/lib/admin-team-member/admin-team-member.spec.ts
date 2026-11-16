import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import {
  BarberActivation,
  BarberEdit,
  BarberLinkChange,
  E164,
  OfferingsEdit,
  Role,
  StaffPermissions,
  TeamMemberNote,
} from '@core/components';
import { GovernanceErrorCode, PipelineError } from '@core/errors';
import { Callables } from '@core/ports';
import {
  AccessScope,
  AppointmentId,
  type BarberId,
  BusyKey,
  type LocalDate,
  LocationId,
  StaffCapability,
  UserId,
} from '@core/primitives';
import {
  appointmentFixture,
  FIXTURE_TODAY,
  localDate,
  locationFixture,
  textFixture,
  userFixture,
} from '@core/testing';
import { UiDateRow } from '@creativo/ui/controls';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import {
  IVAN,
  IVAN_RECORD,
  NIKOLAY,
  NIKOLAY_RECORD,
  RECORDS,
  STEFAN,
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

async function render(
  barberId: string,
  options: TeamBedOptions & { readonly edit?: string } = {},
) {
  const bed = teamBed({ members: TEAM, barbers: BARBERS, ...options });
  await TestBed.configureTestingModule({
    imports: [AdminTeamMember],
    providers: bed.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminTeamMember);
  fixture.componentRef.setInput('barberId', barberId);
  if (options.edit !== undefined) {
    fixture.componentRef.setInput('edit', options.edit);
  }
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

  it('each needed item is a way into its editor', async () => {
    const { piece } = await render('nikolay');
    expect(piece('member-setup-NAME')?.tagName).toBe('BUTTON');
    expect(piece('member-setup-START_DAY')?.tagName).toBe('BUTTON');
    expect(piece('member-setup-HOURS')?.tagName).toBe('BUTTON');
    expect(piece('member-setup-SERVICES')?.tagName).toBe('BUTTON');
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

  it('«Без последен ден» is an answer of the last day’s own month: it removes the day, gives the keyboard back to the capsule, and the period is saved with none', async () => {
    const leaving = {
      ...NIKOLAY_RECORD,
      barberLastWorkingLocalDate: localDate('2026-12-31'),
    };
    const { fixture, piece, press, text, settle, calls } = await render(
      'nikolay',
      { barbers: [IVAN_RECORD, leaving] },
    );
    expect(text(piece('member-row-period'))).toContain('1.12 – 31.12');

    await press('member-row-period');
    expect(text(piece('member-period-last'))).toContain('31.12');
    expect((piece('member-period-save') as HTMLButtonElement).disabled).toBe(
      true,
    );
    // No row of its own: the answer lives in the month.
    expect(piece('member-period-last-clear')).toBeNull();

    piece('member-period-last')?.click();
    fixture.detectChanges();
    expect(text(piece('member-period-last-clear'))).toBe('Без последен ден');
    piece('member-period-last-clear')?.click();
    await settle();

    expect(piece('member-period-last-calendar')).toBeNull();
    expect(text(piece('member-period-last'))).toContain('Няма');
    // The month is gone with the answer that held focus: the keyboard is
    // back on the capsule, so the sheet still hears Escape.
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

  describe('a last day is how someone leaves the team (team onboarding D10)', () => {
    /** The last-day row's pick: its month is the DS's own, driven through its output. */
    const pickLast = async (
      fixture: Awaited<ReturnType<typeof render>>['fixture'],
      settle: () => Promise<void>,
      day: LocalDate,
    ): Promise<void> => {
      const rows = fixture.debugElement.queryAll(By.directive(UiDateRow));
      (rows.at(1)?.componentInstance as UiDateRow).uiPicked.emit(day);
      await settle();
    };

    it('a last day ahead says when the person leaves, and saves without a question', async () => {
      const { fixture, piece, press, text, settle, calls } =
        await render('ivan');
      await press('member-row-period');
      expect(piece('member-period-note')).toBeNull();

      await pickLast(fixture, settle, localDate('2026-12-31'));
      const note = piece('member-period-note');
      // One notice: the fact as its title, what follows under it.
      expect(text(note?.querySelector('[uiNoticeTitle]') ?? null)).toBe(
        'Иван напуска екипа след 31.12',
      );
      expect(text(note)).toContain(
        'След този ден не приема записи и губи достъпа си до графика.',
      );
      expect(note?.getAttribute('data-tone')).toBe('neutral');
      expect(piece('member-period-leftover')).toBeNull();

      await press('member-period-save');
      expect(calls.edits).toHaveLength(1);
      expect(calls.edits[0]).toMatchObject({
        barberEdit: BarberEdit.Period,
        barberLastWorkingLocalDate: '2026-12-31',
      });
    });

    /** A live visit seating `barberId` on `day`, keyed as the day's read finds it. */
    const visitOf = (id: string, barberId: BarberId, day: string) =>
      appointmentFixture({
        id: AppointmentId.of(id),
        localDate: localDate(day),
        barberIds: [barberId],
        busyKeys: [BusyKey.of(barberId, localDate(day))],
      });

    it('reads the barber’s visits ahead once, and turns the notice into a warning that counts the ones a last day would leave behind — and back with none', async () => {
      const { fixture, piece, press, text, settle, calls } = await render(
        'ivan',
        {
          visits: [
            visitOf('a-1', IVAN.barberId, '2027-01-04'),
            visitOf('a-2', IVAN.barberId, '2027-01-05'),
            visitOf('a-3', IVAN.barberId, '2026-12-20'),
          ],
        },
      );
      await press('member-row-period');
      await settle();
      // No last day: nothing is said — but the visits from today on are
      // read, once, for the month's dots.
      expect(piece('member-period-leftover')).toBeNull();
      expect(calls.aheadAsked).toEqual([
        { barberId: IVAN.barberId, fromLocalDate: FIXTURE_TODAY },
      ]);

      await pickLast(fixture, settle, localDate('2026-12-31'));
      await settle();
      const warning = piece('member-period-leftover');
      expect(warning?.getAttribute('data-tone')).toBe('warning');
      expect(text(warning?.querySelector('[uiNoticeTitle]') ?? null)).toBe(
        '2 записа след последния ден',
      );
      expect(text(warning)).toContain(
        'След 31.12 Иван напуска екипа, а записите остават в графика. Дай ги на друг бръснар или ги премести по-рано.',
      );
      // One notice for one day: the departure is said inside the warning.
      expect(piece('member-period-note')).toBeNull();
      // A warning wears its mark.
      expect(
        warning?.querySelector('.ui-notice__glyph')?.getAttribute('data-name'),
      ).toBe('notice.warning');

      // A later day leaves nothing behind: the warning goes back to the
      // quiet fact — and what was read covers it, so nothing is read again.
      await pickLast(fixture, settle, localDate('2027-01-31'));
      await settle();
      expect(piece('member-period-leftover')).toBeNull();
      expect(piece('member-period-note')).not.toBeNull();
      expect(calls.aheadAsked).toHaveLength(1);
    });

    it('offers one way to the visits left, «Виж записите» in the warning, which opens the schedule’s search on this barber from the day after — and nothing while none are left', async () => {
      const { fixture, piece, press, text, settle } = await render('ivan', {
        visits: [
          visitOf('a-2', IVAN.barberId, '2027-01-05'),
          visitOf('a-1', IVAN.barberId, '2027-01-04'),
          visitOf('a-kept', IVAN.barberId, '2026-12-20'),
        ],
      });
      await press('member-row-period');
      await settle();
      // No last day: nothing is left, so there is nothing to open.
      expect(piece('leftover-search')).toBeNull();

      await pickLast(fixture, settle, localDate('2026-12-31'));
      await settle();
      // The visits are not listed in the sheet: the warning has ONE action.
      expect(piece('leftover-visits')).toBeNull();
      const warning = piece('member-period-leftover');
      const action = warning?.querySelector<HTMLElement>(
        '.ui-notice__actions [data-testid="leftover-search"]',
      );
      expect(text(action)).toBe('Виж записите');

      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigate')
        .mockResolvedValue(true);
      action?.click();
      expect(navigate).toHaveBeenCalledWith(['/staff/schedule'], {
        queryParams: { searchBarber: IVAN.barberId, searchFrom: '2027-01-01' },
      });

      // A later day leaves nothing: the quiet fact has no action.
      await pickLast(fixture, settle, localDate('2027-01-31'));
      await settle();
      expect(piece('leftover-search')).toBeNull();
    });

    it('dots the days the barber is booked on in the last day’s month, and says what the dots mean under it', async () => {
      const { fixture, piece, press, settle, text } = await render('ivan', {
        visits: [
          visitOf('a-1', IVAN.barberId, '2026-09-29'),
          visitOf('a-2', IVAN.barberId, '2026-09-30'),
        ],
      });
      await press('member-row-period');
      await settle();
      // The row opens on today's month, not on the month the barber started.
      await press('member-period-last');
      fixture.detectChanges();

      expect(
        piece('ui-month-day-2026-09-29')?.hasAttribute('data-marked'),
      ).toBe(true);
      expect(
        piece('ui-month-day-2026-09-30')?.hasAttribute('data-marked'),
      ).toBe(true);
      expect(
        piece(`ui-month-day-${FIXTURE_TODAY}`)?.hasAttribute('data-marked'),
      ).toBe(false);
      expect(text(piece('member-period-last-legend'))).toBe('Дни със записи');
      // No day is chosen yet, so there is no «no day» answer to offer.
      expect(piece('member-period-last-clear')).toBeNull();
    });

    it('a last day already passed with bookings after it says the person leaves on saving, and to give, move or cancel them', async () => {
      const { fixture, piece, press, text, settle } = await render('ivan', {
        visits: [visitOf('a-1', IVAN.barberId, '2026-10-02')],
      });
      await press('member-row-period');
      await pickLast(fixture, settle, localDate('2026-09-01'));
      await settle();

      const warning = piece('member-period-leftover');
      expect(text(warning?.querySelector('[uiNoticeTitle]') ?? null)).toBe(
        '1 запис след последния ден',
      );
      expect(text(warning)).toContain(
        'Със запазването Иван напуска екипа веднага, а записът остава в графика. Дай го на друг бръснар, премести го или го откажи.',
      );
    });

    it('says it could not check when the bookings cannot be read', async () => {
      const { fixture, piece, press, text, settle } = await render('ivan', {
        aheadFails: true,
      });
      await press('member-row-period');
      await pickLast(fixture, settle, localDate('2026-12-31'));
      await settle();

      const warning = piece('member-period-leftover');
      expect(text(warning?.querySelector('[uiNoticeTitle]') ?? null)).toBe(
        'Иван напуска екипа след 31.12',
      );
      expect(text(warning)).toContain(
        'Не успяхме да проверим дали има записи след този ден.',
      );
    });

    it('a last day already passed says the person leaves on saving, and asks first: «Отказ» sends nothing, «Напуска» sends the period', async () => {
      const { fixture, piece, press, text, settle, calls } =
        await render('ivan');
      await press('member-row-period');
      await pickLast(fixture, settle, localDate('2026-09-01'));
      expect(
        text(
          piece('member-period-note')?.querySelector('[uiNoticeTitle]') ?? null,
        ),
      ).toBe('Иван напуска екипа веднага');
      expect(text(piece('member-period-note'))).toContain(
        '1.09 вече мина. Със запазването спира да приема записи и губи достъпа си до графика.',
      );

      await press('member-period-save');
      expect(calls.edits).toEqual([]);
      expect(text(piece('member-period-leave-question'))).toContain(
        'Иван напуска екипа сега?',
      );
      expect(text(piece('member-period-leave-question'))).toContain(
        'спира да приема записи',
      );

      await press('member-period-leave-cancel');
      expect(calls.edits).toEqual([]);
      expect(piece('member-period-sheet')).not.toBeNull();

      await press('member-period-save');
      await press('member-period-leave-confirm');
      expect(calls.edits).toHaveLength(1);
      expect(calls.edits[0]).toMatchObject({
        barberEdit: BarberEdit.Period,
        barberLastWorkingLocalDate: '2026-09-01',
        barberId: IVAN.barberId,
      });
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

describe('AdminTeamMember — «Услуги и цени»', () => {
  /** A unit field's figure, typed and left — the field commits on change. */
  const typeFigure = (field: HTMLElement | null, value: string): void => {
    const input = field as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('a service is switched on at the catalogue’s terms, repriced on its own page, and the whole list is saved as one act', async () => {
    const { piece, press, text, settle, calls } = await render('nikolay', {
      services: [serviceOf(IVAN.barberId)],
    });
    expect(piece('member-offerings-sheet')).toBeNull();

    await press('member-setup-SERVICES');
    await settle();

    const row = () => piece('offering-svc-classic-cut');
    expect(text(row())).toContain('Не извършва');
    const save = () => piece('member-offerings-save') as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    // THE SERVICE'S PAGE: off, and no terms to type until it is on.
    await press('offering-svc-classic-cut');
    expect(
      piece('member-offering-performs')?.getAttribute('aria-checked'),
    ).toBe('false');
    expect(piece('member-offering-terms-base')).toBeNull();

    await press('member-offering-performs');
    const price = () => piece('member-offering-price-base') as HTMLInputElement;
    expect(price().value).toBe('15,00');
    expect(
      (piece('member-offering-minutes-base') as HTMLInputElement).value,
    ).toBe('30');

    // A price typed is kept; one that is no amount puts the field back.
    typeFigure(price(), '18,50');
    await settle();
    expect(price().value).toBe('18,50');
    typeFigure(price(), 'скъпо');
    await settle();
    expect(price().value).toBe('18,50');
    typeFigure(piece('member-offering-minutes-base'), '45');
    await settle();

    await press('member-offerings-done');
    expect(text(row())).toContain('18,50 € · 45 мин');
    expect(row()?.hasAttribute('data-performed')).toBe(true);
    expect(save().disabled).toBe(false);

    await press('member-offerings-save');
    await settle();

    expect(calls.offerings).toHaveLength(1);
    expect(calls.offerings[0]).toMatchObject({
      offeringsEdit: OfferingsEdit.Set,
      barberId: NIKOLAY.barberId,
      offerings: [
        {
          serviceId: 'svc-classic-cut',
          priceCents: 1850,
          currency: 'EUR',
          durationMinutes: 45,
          overrides: [],
        },
      ],
    });
  });

  it('opens on what the barber performs, offers no save until something changes, and a service switched off leaves the list', async () => {
    const { piece, press, text, settle, calls } = await render('ivan', {
      services: [serviceOf(IVAN.barberId)],
      schedules: [rosterOf(IVAN.barberId)],
    });
    await press('member-row-services');
    await settle();

    expect(text(piece('offering-svc-classic-cut'))).toContain(
      '15,00 € · 30 мин',
    );
    const save = () => piece('member-offerings-save') as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    await press('offering-svc-classic-cut');
    await press('member-offering-performs');
    await press('member-offerings-back');
    expect(text(piece('offering-svc-classic-cut'))).toContain('Не извършва');
    expect(save().disabled).toBe(false);

    await press('member-offerings-save');
    await settle();
    expect(calls.offerings[0]).toMatchObject({
      offeringsEdit: OfferingsEdit.Set,
      offerings: [],
    });
  });

  it('a refused save is said in the sheet, which stays', async () => {
    const { piece, press, settle, refuses } = await render('ivan', {
      services: [serviceOf(IVAN.barberId)],
    });
    refuses('setBarberOfferings', REFUSED);
    await press('member-row-services');
    await settle();
    await press('offering-svc-classic-cut');
    await press('member-offering-performs');
    await press('member-offerings-done');
    await press('member-offerings-save');
    await settle();

    expect(piece('member-offerings-refusal')).not.toBeNull();
    expect(piece('member-offerings-sheet')).not.toBeNull();
    expect(piece('member-refusal')).toBeNull();
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
    // The owner links accounts too, so the line says how the person gets one.
    expect(text(piece('member-account-note'))).toBe(
      'Без профил Николай не влиза в приложението. Помоли Николай да влезе веднъж, после натисни „Свържи профил“.',
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

describe('AdminTeamMember — the photo (one photo per barber)', () => {
  /** A JPEG as a person picks it, and a browser that can measure it. */
  const jpeg = (size = 90_000): File =>
    new File([new Uint8Array(size)], 'portrait.jpg', { type: 'image/jpeg' });
  const measures = (width: number, height: number) =>
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width, height, close: () => undefined })),
    );
  /** Picks `file` in the page's hidden field, the way the label does. */
  const pick = async (
    field: HTMLElement | null,
    file: File,
    settle: () => Promise<void>,
  ): Promise<void> => {
    Object.defineProperty(field, 'files', {
      configurable: true,
      value: { length: 1, item: () => file, 0: file },
    });
    field?.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
  };

  afterEach(() => vi.unstubAllGlobals());

  it('a picture picked is staged under the owner’s account and named to the call with its size; the list is read again', async () => {
    measures(800, 1000);
    const { piece, text, settle, calls, listed } = await render('nikolay');
    expect(text(piece('member-photo-pick'))).toBe('Добави снимка');
    const before = listed.length;

    await pick(piece('member-photo-input'), jpeg(), settle);

    expect(calls.staged).toEqual([
      {
        userId: 'u-owner',
        stagedName: calls.photos[0]?.stagedName,
        contentType: 'image/jpeg',
        size: 90_000,
      },
    ]);
    expect(calls.photos).toEqual([
      expect.objectContaining({
        barberId: NIKOLAY.barberId,
        mediaWidth: 800,
        mediaHeight: 1000,
      }),
    ]);
    expect(calls.photos[0]?.stagedName).not.toBe(calls.photos[0]?.operationId);
    expect(listed.length).toBeGreaterThan(before);
    expect(piece('member-refusal')).toBeNull();
  });

  it('a record with a photo offers to change it', async () => {
    const { piece, text } = await render('nikolay', {
      barbers: [
        IVAN_RECORD,
        {
          ...NIKOLAY_RECORD,
          avatarMediaPath: 'media/barbers/nikolay/operation-photo-0123456',
        },
        STEFAN_RECORD,
      ],
    });
    expect(text(piece('member-photo-pick'))).toBe('Смени снимката');
  });

  it('a picture that is too large is refused on the page, and nothing is uploaded', async () => {
    measures(800, 1000);
    const { piece, text, settle, calls } = await render('nikolay');

    await pick(piece('member-photo-input'), jpeg(6 * 1024 * 1024), settle);

    expect(text(piece('member-refusal'))).toBe(
      'Тази снимка не става. Избери изображение до 5 MB.',
    );
    expect(calls.staged).toEqual([]);
    expect(calls.photos).toEqual([]);
  });

  it('a picture the browser cannot measure is refused the same way', async () => {
    const { piece, text, settle, calls } = await render('nikolay');

    await pick(piece('member-photo-input'), jpeg(), settle);

    expect(text(piece('member-refusal'))).toContain('Тази снимка не става');
    expect(calls.staged).toEqual([]);
  });

  it('an upload that fails, and a call that is refused, are said on the page', async () => {
    measures(800, 1000);
    const { piece, text, settle, calls, stagingFails, refuses } =
      await render('nikolay');

    stagingFails(true);
    await pick(piece('member-photo-input'), jpeg(), settle);
    expect(text(piece('member-refusal')).length).toBeGreaterThan(0);
    expect(calls.photos).toEqual([]);

    stagingFails(false);
    refuses('setBarberPhoto', REFUSED);
    await pick(piece('member-photo-input'), jpeg(), settle);
    expect(calls.photos).toHaveLength(1);
    expect(text(piece('member-refusal')).length).toBeGreaterThan(0);
  });

  it('is a content editor’s to set, and not the front desk’s', async () => {
    const editor = await render('ivan', {
      roles: [Role.ContentManager],
      members: RECORDS,
    });
    expect(editor.piece('member-photo-pick')).not.toBeNull();
    TestBed.resetTestingModule();
    const desk = await render('ivan', { roles: [Role.Receptionist] });
    expect(desk.piece('member-photo-pick')).toBeNull();
    expect(desk.piece('member-photo-input')).toBeNull();
  });
});

describe('AdminTeamMember — «Салони»', () => {
  const center = locationFixture();
  const mladost = locationFixture({
    id: LocationId.of('mladost'),
    name: textFixture('Mladost', 'Младост'),
  });
  const twoShops: TeamBedOptions = { locations: [center, mladost] };
  const checked = (element: HTMLElement | null) =>
    element?.getAttribute('aria-checked');

  it('opens on «Всички салони» with nothing to save; switched off, a tick taken away is saved as the shops left', async () => {
    const { piece, press, text, calls } = await render('nikolay', twoShops);
    expect(text(piece('member-setup-SHOPS'))).toContain('Всички');

    await press('member-setup-SHOPS');

    expect(piece('member-shops-sheet')).not.toBeNull();
    expect(piece('member-shops-list')).toBeNull();
    const save = piece('member-shops-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // Off: every shop starts ticked, so one press is the whole edit. The
    // list of every shop is not «Всички салони», so it can be saved.
    await press('member-shops-every');
    expect(checked(piece(`member-shop-${center.id}`))).toBe('true');
    expect(checked(piece('member-shop-mladost'))).toBe('true');
    expect(save.disabled).toBe(false);

    await press('member-shop-mladost');
    expect(checked(piece('member-shop-mladost'))).toBe('false');
    await press('member-shops-save');

    expect(calls.edits).toEqual([
      expect.objectContaining({
        barberEdit: BarberEdit.Shops,
        barberId: NIKOLAY.barberId,
        locationIds: [center.id],
      }),
    ]);
  });

  it('with no shop ticked there is no save, and the sheet says to pick one', async () => {
    const { piece, press, text } = await render('nikolay', twoShops);
    await press('member-setup-SHOPS');
    await press('member-shops-every');
    await press(`member-shop-${center.id}`);
    await press('member-shop-mladost');

    expect(text(piece('member-shops-pick-one'))).toBe(
      'Избери поне един салон.',
    );
    expect((piece('member-shops-save') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('a shop the roster still has hours at keeps its tick, and says why', async () => {
    const { piece, press, text, calls } = await render('ivan', {
      ...twoShops,
      services: [serviceOf(IVAN.barberId)],
      schedules: [rosterOf(IVAN.barberId)],
    });
    // Ivan works at the centre shop, where his roster's hours are.
    expect(text(piece('member-row-shops'))).toContain('Център');

    await press('member-row-shops');

    expect(piece('member-shops-every')?.getAttribute('aria-checked')).toBe(
      'false',
    );
    const held = piece(`member-shop-${center.id}`);
    expect(held?.getAttribute('aria-disabled')).toBe('true');
    expect(text(held)).toContain('Има работно време тук');
    await press(`member-shop-${center.id}`);
    expect(checked(held)).toBe('true');

    // A second shop is theirs to take: the record then lists both.
    expect(checked(piece('member-shop-mladost'))).toBe('false');
    await press('member-shop-mladost');
    await press('member-shops-save');
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Shops,
      locationIds: [center.id, mladost.id],
    });
  });

  it('a refused save is said in the sheet, which stays', async () => {
    const { piece, press, text, refuses } = await render('nikolay', twoShops);
    refuses('editBarber', REFUSED);
    await press('member-setup-SHOPS');
    await press('member-shops-every');
    await press('member-shops-save');

    expect(text(piece('member-shops-refusal')).length).toBeGreaterThan(0);
    expect(piece('member-shops-sheet')).not.toBeNull();
    expect(piece('member-refusal')).toBeNull();
  });

  it('is read by someone who does not manage the team, and a one-shop business has no row at all', async () => {
    const editor = await render('nikolay', {
      ...twoShops,
      roles: [Role.ContentManager],
      members: RECORDS,
    });
    expect(editor.piece('member-setup-SHOPS')?.tagName).not.toBe('BUTTON');
    TestBed.resetTestingModule();
    const oneShop = await render('ivan', {
      locations: [center],
      services: [serviceOf(IVAN.barberId)],
      schedules: [rosterOf(IVAN.barberId)],
    });
    expect(oneShop.piece('member-row-shops')).toBeNull();
  });
});

describe('AdminTeamMember — «Свържи профил» · «Разкачи профила» (team onboarding D8)', () => {
  /** A registered client the lookup finds by phone. */
  const georgi = userFixture({
    id: UserId.of('u-georgi'),
    firstName: 'Георги',
    lastName: 'Иванов',
    phone: E164.of('+359881112233'),
  });
  /** An account that is a barber record already: never offered. */
  const taken = userFixture({
    id: UserId.of('u-ivan'),
    firstName: 'Иван',
    lastName: 'Петров',
    roles: [Role.Barber],
    linkedBarberId: IVAN.barberId,
  });
  /** The change was written; the person's sessions were not ended. */
  const UNREVOKED = PipelineError.fromWire('functions/aborted', {
    errorCode: GovernanceErrorCode.RolesSessionsNotRevoked,
  });
  /** The typing rests, and the index answers. */
  const rested = async (settle: () => Promise<void>): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 320));
    await settle();
  };

  it('opens on the team’s own accounts with no record — never the owner’s, whose door is «Това съм аз»', async () => {
    const { piece, press, text, settle, root } = await render('nikolay');
    expect(piece('member-link-sheet')).toBeNull();

    await press('member-link');
    await settle();

    expect(piece('member-link-sheet')).not.toBeNull();
    expect(text(piece('member-link-list'))).toContain('Елена Василева');
    expect(text(piece('member-link-u-elena'))).toContain('Рецепция');
    expect(piece('member-link-u-maria')).not.toBeNull();
    expect(piece('member-link-u-owner')).toBeNull();
    expect(text(root)).toContain('От екипа');
  });

  it('a colleague picked is asked about first; «Свържи» sends their roles plus barber and the link, and the list is read again', async () => {
    const { piece, press, text, settle, calls, listed } =
      await render('nikolay');
    await press('member-link');
    await settle();
    const before = listed.length;

    await press('member-link-u-elena');
    expect(text(piece('member-link-question'))).toContain(
      'Да свържа ли Елена Василева с Николай?',
    );
    expect(text(piece('member-link-question'))).toContain(
      'Елена ще трябва да влезе отново в приложението.',
    );
    expect(calls.roles).toEqual([]);

    await press('member-link-confirm');
    await settle();

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-elena',
        roles: [Role.Barber, Role.Receptionist],
        barberLinkChange: BarberLinkChange.Set,
        linkedBarberId: NIKOLAY.barberId,
      }),
    ]);
    expect(listed.length).toBeGreaterThan(before);
    // The owner's own account did not move.
    expect(piece('member-not-me')).toBeNull();
  });

  it('«Отказ» sends nothing and the sheet stays', async () => {
    const { piece, press, settle, calls } = await render('nikolay');
    await press('member-link');
    await settle();
    await press('member-link-u-elena');
    await press('member-link-cancel');
    await settle();

    expect(calls.roles).toEqual([]);
    expect(piece('member-link-sheet')).not.toBeNull();
  });

  it('a lookup asks the index once the typing rests, and offers only who may be linked', async () => {
    const { piece, press, type, text, settle, calls, listAnswers } =
      await render('nikolay', { accounts: [georgi, taken] });
    await press('member-link');
    await settle();

    await type('member-link-query', 'Гео');
    await type('member-link-query', 'Георги');
    expect(calls.searched).toEqual([]);
    await rested(settle);

    expect(calls.searched).toEqual(['георги']);
    expect(text(piece('member-link-u-georgi'))).toContain('Георги Иванов');
    expect(text(piece('member-link-u-georgi'))).toContain('+359 88 111 2233');
    // Linked to a record already, and the team's own accounts gave way.
    expect(piece('member-link-u-ivan')).toBeNull();
    expect(piece('member-link-u-elena')).toBeNull();

    // The Team list will say the account beside the record.
    listAnswers(
      TEAM.map((member) =>
        member === NIKOLAY
          ? {
              ...NIKOLAY,
              memberUserId: georgi.id,
              memberAccountName: 'Георги Иванов',
              memberRoles: [Role.Client, Role.Barber],
              teamMemberNote: null,
            }
          : member,
      ),
    );
    await press('member-link-u-georgi');
    await press('member-link-confirm');
    await settle();

    expect(calls.roles[0]).toMatchObject({
      targetUserId: 'u-georgi',
      roles: [Role.Client, Role.Barber],
      barberLinkChange: BarberLinkChange.Set,
      linkedBarberId: NIKOLAY.barberId,
    });
    expect(text(piece('member-account-linked'))).toContain('Георги Иванов');
    expect(piece('member-link')).toBeNull();
    expect(text(piece('member-release'))).toBe('Разкачи профила');
  });

  it('says so when nobody is found, and when the index could not be read', async () => {
    const { piece, press, type, text, settle, searchFails } =
      await render('nikolay');
    await press('member-link');
    await settle();

    await type('member-link-query', 'Никой');
    await rested(settle);
    expect(text(piece('member-link-empty'))).toContain('Няма такъв профил');
    expect(text(piece('member-link-empty'))).toContain(
      'Помоли Николай да влезе веднъж в приложението и потърси пак.',
    );

    searchFails(true);
    await type('member-link-query', 'Някой');
    await rested(settle);
    expect(text(piece('member-link-empty'))).toBe(
      'Търсенето не успя. Опитай пак.',
    );
  });

  it('a refused link is said in the sheet, which stays', async () => {
    const { piece, press, text, settle, rolesRefuse } = await render('nikolay');
    rolesRefuse(REFUSED);
    await press('member-link');
    await settle();
    await press('member-link-u-elena');
    await press('member-link-confirm');
    await settle();

    expect(text(piece('member-link-refusal')).length).toBeGreaterThan(0);
    expect(piece('member-link-sheet')).not.toBeNull();
    expect(piece('member-refusal')).toBeNull();
  });

  it('«Разкачи профила» asks first, then takes barber from the account and clears the link', async () => {
    const { piece, press, text, settle, calls } = await render('ivan');
    expect(piece('member-link')).toBeNull();

    await press('member-release');
    expect(text(piece('member-release-question'))).toContain(
      'Да разкача ли профила на Иван Петров?',
    );
    expect(calls.roles).toEqual([]);

    await press('member-release-confirm');
    await settle();

    // Barber was the only role the account held: it is a client again.
    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-ivan',
        roles: [Role.Client],
        barberLinkChange: BarberLinkChange.Clear,
        linkedBarberId: null,
      }),
    ]);
  });

  it('a release the server wrote without ending the sessions is said with its retry, which sends the same change again', async () => {
    const { piece, press, text, settle, calls, rolesRefuse } =
      await render('ivan');
    rolesRefuse(UNREVOKED);
    await press('member-release');
    await press('member-release-confirm');
    await settle();

    expect(calls.roles).toHaveLength(1);
    expect(text(piece('member-sessions-pending'))).toContain(
      'Промяната е запазена, но старите сесии на профила не бяха прекратени.',
    );
    // The change landed: it is not said as a refusal as well.
    expect(piece('member-refusal')).toBeNull();

    rolesRefuse(null);
    await press('member-sessions-retry');
    await settle();

    expect(calls.roles).toHaveLength(2);
    expect(calls.roles[1]).toMatchObject({
      targetUserId: 'u-ivan',
      roles: [Role.Client],
      barberLinkChange: BarberLinkChange.Clear,
    });
    expect(piece('member-sessions-pending')).toBeNull();
  });

  it('a link written the same way is a link: the sheet says no refusal, and the page offers the retry', async () => {
    const { piece, press, settle, calls, rolesRefuse } =
      await render('nikolay');
    rolesRefuse(UNREVOKED);
    await press('member-link');
    await settle();
    await press('member-link-u-elena');
    await press('member-link-confirm');
    await settle();

    expect(calls.roles).toHaveLength(1);
    expect(piece('member-link-refusal')).toBeNull();
    expect(piece('member-sessions-pending')).not.toBeNull();
  });

  it('neither door is there for someone who manages the team and assigns no roles', async () => {
    const stored = {
      [StaffPermissions.fieldOf(Role.Receptionist, StaffCapability.TeamManage)]:
        AccessScope.All,
    };
    const free = await render('nikolay', {
      roles: [Role.Receptionist],
      userId: UserId.of('u-elena'),
      stored,
    });
    expect(free.piece('member-link')).toBeNull();
    expect(free.piece('member-is-me')).toBeNull();
    expect(free.text(free.piece('member-account-note'))).toBe(
      'Без профил Николай не влиза в приложението. Часовете се записват от екипа.',
    );
    TestBed.resetTestingModule();
    const held = await render('ivan', {
      roles: [Role.Receptionist],
      userId: UserId.of('u-elena'),
      stored,
    });
    expect(held.piece('member-release')).toBeNull();
    expect(held.text(held.piece('member-account-linked'))).toContain(
      'Иван Петров',
    );
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
    expect(piece('member-row-services')?.tagName).not.toBe('BUTTON');
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
    // Nobody signs in as a leaver: the page says why, and offers no link.
    expect(text(piece('member-account-note'))).toBe(
      'Стефан напусна екипа и вече няма достъп до графика.',
    );
    expect(piece('member-link')).toBeNull();
    expect(piece('member-row-profile')?.tagName).not.toBe('BUTTON');
    expect(piece('member-pool-row')).toBeNull();
    expect(piece('member-booked-by-row')).toBeNull();
    expect(piece('member-is-me')).toBeNull();
    expect(piece('member-delete')).toBeNull();
  });

  describe('a leaver’s bookings — what still stands after the last day (team onboarding D10)', () => {
    const visitOf = (id: string, day: string) =>
      appointmentFixture({
        id: AppointmentId.of(id),
        localDate: localDate(day),
        barberIds: [STEFAN.barberId],
        busyKeys: [BusyKey.of(STEFAN.barberId, localDate(day))],
      });

    it('tells whoever can bring the barber back how many bookings they still hold and what to do, and opens the search on them', async () => {
      const { piece, text, settle, calls } = await render('stefan', {
        visits: [
          visitOf('a-1', '2026-10-02'),
          visitOf('a-2', '2026-10-20'),
          // On the last day itself: worked, not left behind.
          visitOf('a-last', '2026-09-30'),
        ],
      });
      await settle();

      const warning = piece('member-leftover');
      expect(text(warning?.querySelector('[uiNoticeTitle]') ?? null)).toBe(
        'Стефан още има 2 записа',
      );
      // Not listed here: the warning's one action opens the schedule's
      // search on them, where the leaver keeps a column while booked.
      expect(piece('leftover-visits')).toBeNull();
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigate')
        .mockResolvedValue(true);
      warning
        ?.querySelector<HTMLElement>('[data-testid="leftover-search"]')
        ?.click();
      expect(navigate).toHaveBeenCalledWith(['/staff/schedule'], {
        queryParams: {
          searchBarber: STEFAN.barberId,
          searchFrom: '2026-10-01',
        },
      });
      expect(text(warning)).toContain(
        'Записите са след последния ден. Дай ги на друг бръснар, премести ги или ги откажи.',
      );
      expect(calls.aheadAsked).toEqual([
        { barberId: STEFAN.barberId, fromLocalDate: '2026-10-01' },
      ]);
    });

    it('says nothing for a leaver with none, and reads nothing for someone who cannot bring them back or for a working record', async () => {
      const none = await render('stefan');
      await none.settle();
      expect(none.piece('member-leftover')).toBeNull();
      expect(none.calls.aheadAsked).toHaveLength(1);

      TestBed.resetTestingModule();
      const editor = await render('stefan', {
        roles: [Role.ContentManager],
        visits: [visitOf('a-1', '2026-10-02')],
      });
      await editor.settle();
      expect(editor.piece('member-leftover')).toBeNull();
      expect(editor.calls.aheadAsked).toEqual([]);

      TestBed.resetTestingModule();
      const working = await render('ivan');
      await working.settle();
      expect(working.calls.aheadAsked).toEqual([]);
    });
  });

  describe('«Върни в екипа» — a barber who has left, back on the team (team onboarding D10)', () => {
    it('is offered on a leaver’s record to whoever manages the team, and never on a working one', async () => {
      const leaver = await render('stefan');
      expect(leaver.text(leaver.piece('member-return'))).toBe('Върни в екипа');
      expect(leaver.piece('member-return-sheet')).toBeNull();

      TestBed.resetTestingModule();
      const working = await render('ivan');
      expect(working.piece('member-return')).toBeNull();

      TestBed.resetTestingModule();
      const editor = await render('stefan', { roles: [Role.ContentManager] });
      expect(editor.piece('member-return')).toBeNull();
    });

    it('opens on the earliest day a return may start, says what comes back and what does not, and sends the return', async () => {
      const { piece, press, text, calls } = await render('stefan');
      await press('member-return');

      expect(text(piece('member-return-lede'))).toBe(
        'Стефан се връща със същия профил, цени и работното време от последната си седмица.',
      );
      // Stefan's last day is 30.09, two days ahead of the shop's today: the
      // return opens on the day after it.
      expect(text(piece('member-return-start'))).toContain('1.10');
      expect(text(piece('member-return-note'))).toBe(
        'Достъпът до приложението не се връща сам. След това свържи профила отново със „Свържи профил“.',
      );
      expect((piece('member-return-save') as HTMLButtonElement).disabled).toBe(
        false,
      );

      await press('member-return-save');
      expect(calls.edits).toHaveLength(1);
      expect(calls.edits[0]).toMatchObject({
        barberEdit: BarberEdit.Return,
        barberStartsLocalDate: '2026-10-01',
        barberId: STEFAN.barberId,
      });
    });

    it('a day on or before the last day worked cannot be sent', async () => {
      const { fixture, piece, press, settle, calls } = await render('stefan');
      await press('member-return');
      const row = fixture.debugElement.query(By.directive(UiDateRow));
      (row.componentInstance as UiDateRow).uiPicked.emit(
        localDate('2026-09-30'),
      );
      await settle();

      expect((piece('member-return-save') as HTMLButtonElement).disabled).toBe(
        true,
      );
      await press('member-return-save');
      expect(calls.edits).toEqual([]);
    });

    it('a refused return is said in the sheet, which stays', async () => {
      const { piece, press, text, refuses } = await render('stefan');
      refuses(
        'editBarber',
        PipelineError.fromWire('functions/failed-precondition', {
          errorCode: 'TEAM_BARBER_NOT_DEPARTED',
        }),
      );
      await press('member-return');
      await press('member-return-save');

      expect(text(piece('member-return-refusal'))).toBe(
        'Този бръснар не е напускал екипа.',
      );
      expect(piece('member-return-sheet')).not.toBeNull();
    });
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

describe('AdminTeamMember — the Team page’s notices, followed (team onboarding D10)', () => {
  it('«Удължи» arrives as ?edit=period: the working period opens on arrival — once, and only for whoever may change it', async () => {
    const owner = await render('ivan', { edit: 'period' });
    expect(owner.piece('member-period-sheet')).not.toBeNull();
    TestBed.resetTestingModule();

    const editor = await render('ivan', {
      edit: 'period',
      roles: [Role.ContentManager],
    });
    expect(editor.piece('member-period-sheet')).toBeNull();
  });

  it('says a leaver’s access is not stopped, and «Опитай пак» sends END_SESSIONS for the record', async () => {
    const owing = { ...STEFAN, teamMemberNote: TeamMemberNote.SessionsOwed };
    const { piece, text, press, calls } = await render('stefan', {
      members: [IVAN, owing],
    });
    const notice = piece('member-owing');
    expect(text(notice?.querySelector('[uiNoticeTitle]') ?? null)).toBe(
      'Достъпът на Стефан не е спрян',
    );
    await press('member-owing-retry');
    expect(calls.edits.at(-1)).toMatchObject({
      barberEdit: BarberEdit.EndSessions,
      barberId: STEFAN.barberId,
    });
  });

  it('says nothing about access for a leaver who owes nothing', async () => {
    const { piece } = await render('stefan');
    expect(piece('member-owing')).toBeNull();
  });
});
