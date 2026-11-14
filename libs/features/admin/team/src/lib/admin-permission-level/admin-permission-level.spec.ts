import { TestBed } from '@angular/core/testing';
import { Role, StaffPermissions } from '@core/components';
import { AccessScope, StaffCapability } from '@core/primitives';
import { PermissionsStore } from '../permissions.store';
import { type TeamBedOptions, teamBed } from '../team-bed.spec-support';
import { TEAM } from '../team.fixtures.spec-support';
import { AdminPermissionLevel } from './admin-permission-level';

/*
 * A level's page: one question a row, a value or a switch, the changed row
 * marked, «Върни стандартните» and the save.
 */

async function render(level: string, options: TeamBedOptions = {}) {
  const bed = teamBed({ members: TEAM, ...options });
  await TestBed.configureTestingModule({
    imports: [AdminPermissionLevel],
    providers: bed.providers,
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminPermissionLevel);
  fixture.componentRef.setInput('level', level);
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
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const all = (selector: string) => [
    ...root.querySelectorAll<HTMLElement>(selector),
  ];
  return {
    fixture,
    root,
    piece,
    text,
    all,
    settle,
    store: TestBed.inject(PermissionsStore),
    ...bed,
  };
}

describe('AdminPermissionLevel — a level’s page', () => {
  it('«Бръснар»: the six rows under three groups, values where «own» is offered and one switch', async () => {
    const { piece, text, all } = await render('barber');

    expect(piece('admin-permission-level')?.getAttribute('data-level')).toBe(
      'barber',
    );
    expect(text(piece('admin-permission-level-title'))).toBe('Бръснар');
    expect(text(piece('admin-permission-level-applies'))).toBe(
      'Важи за 3 души',
    );
    expect(all('h2').map((heading) => text(heading))).toEqual([
      'График',
      'Анализи',
      'Екип',
    ]);
    expect(all('[data-testid^="permission-barber-"]')).toHaveLength(6);
    expect(all('[data-testid^="permission-value-barber-"]')).toHaveLength(5);
    expect(
      all('[data-testid^="permission-switch-barber-"]').map(
        (control) => control.dataset['testid'],
      ),
    ).toEqual(['permission-switch-barber-TEAM_MANAGE']);
    // A value's control is named by its row and its answer.
    expect(
      piece('permission-value-barber-HOURS')?.getAttribute('aria-label'),
    ).toBe('Променя работното време: Само своите');
  });

  it('«Рецепция»: every row a switch, on where the standard grants', async () => {
    const { all } = await render('receptionist');
    const switches = all('[data-testid^="permission-switch-receptionist-"]');
    expect(switches).toHaveLength(6);
    expect(
      switches.map((control) => control.getAttribute('aria-checked')),
    ).toEqual(['true', 'true', 'false', 'false', 'false', 'false']);
    expect(all('[data-testid^="permission-value-"]')).toHaveLength(0);
  });

  it('a flipped switch marks its row, says what the standard was, and brings «Запази»', async () => {
    const { piece, text, store, settle } = await render('receptionist');
    expect(piece('admin-permissions-save')).toBeNull();

    piece('permission-switch-receptionist-HOURS')?.click();
    await settle();

    const row = piece('permission-receptionist-HOURS');
    expect(row?.hasAttribute('data-changed')).toBe(true);
    expect(text(row)).toBe(
      'Променено. Променя работното време Стандартно: включено',
    );
    expect(
      StaffPermissions.scopeOf(
        store.next(),
        Role.Receptionist,
        StaffCapability.Hours,
      ),
    ).toBe(AccessScope.None);
    expect(text(piece('admin-permissions-save'))).toBe('Запази');
  });

  it('a picked value is the row’s answer; one the cell does not offer is not', async () => {
    const { piece, text, fixture, settle } = await render('barber');
    const page = fixture.componentInstance as unknown as {
      pick: (
        level: 'barber',
        staffCapability: StaffCapability,
        picked: string,
      ) => void;
    };

    page.pick('barber', StaffCapability.Hours, AccessScope.All);
    await settle();
    expect(text(piece('permission-value-barber-HOURS'))).toBe('Всички');
    expect(text(piece('permission-barber-HOURS'))).toContain(
      'Стандартно: Само своите',
    );

    page.pick('barber', StaffCapability.Hours, 'EVERYONE');
    await settle();
    expect(text(piece('permission-value-barber-HOURS'))).toBe('Всички');
  });

  it('«Върни стандартните» has nothing to do on a standard level, and puts a changed one back', async () => {
    const { piece, all, settle } = await render('barber', {
      stored: {
        barberTimeOffScope: AccessScope.All,
        barberTeamOfferingsScope: AccessScope.Own,
      },
    });
    const restore = piece(
      'admin-permission-level-restore',
    ) as HTMLButtonElement;
    expect(all('[data-changed]')).toHaveLength(2);
    expect(restore.disabled).toBe(false);

    restore.click();
    await settle();

    expect(all('[data-changed]')).toHaveLength(0);
    expect(restore.disabled).toBe(true);
    // Back to the standard is itself a change to save.
    expect(piece('admin-permissions-save')).not.toBeNull();
  });

  it('«Запази» sends the draft and the dock goes', async () => {
    const { piece, saves, settle } = await render('receptionist');
    piece('permission-switch-receptionist-HOURS')?.click();
    await settle();

    piece('admin-permissions-save')?.click();
    await settle();

    expect(saves).toHaveLength(1);
    expect(saves[0]?.changes).toEqual([
      {
        staffCapability: StaffCapability.Hours,
        role: Role.Receptionist,
        accessScope: AccessScope.None,
      },
    ]);
    expect(piece('admin-permissions-save')).toBeNull();
    // The saved row stays as saved while the listener catches up.
    expect(
      piece('permission-switch-receptionist-HOURS')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
  });

  it('a word that is no editable level is no page: nothing to edit, said plainly', async () => {
    for (const word of ['admin', 'sysadmin', 'client', 'nobody']) {
      TestBed.resetTestingModule();
      const { piece, text, all } = await render(word);
      expect(text(piece('admin-permission-level-unknown'))).toBe(
        'Няма такова ниво.',
      );
      expect(all('[data-testid^="permission-"]')).toHaveLength(0);
      expect(piece('admin-permission-level-restore')).toBeNull();
    }
  });
});
