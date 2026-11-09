import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiMenuTrigger } from '@creativo/ui/patterns';
import { describe, expect, it } from 'vitest';
import {
  UiChoiceLeading,
  UiChoiceMenu,
  type UiChoiceOption,
} from './choice-menu';

@Component({
  imports: [UiChoiceMenu, UiChoiceLeading, UiMenuTrigger],
  template: `
    <ui-choice-menu
      [uiOptions]="options"
      [uiSelectedId]="selected()"
      uiLabel="Кой"
      [(uiPresented)]="open"
      (uiPicked)="picked.push($event); selected.set($event)"
      (uiToggled)="toggled.push($event)"
    >
      <button
        type="button"
        uiMenuTrigger
        data-testid="trigger"
        (click)="open.set(true)"
      >
        {{ selected() }}
      </button>
      @if (legend) {
        <ng-template uiChoiceLeading let-option>
          <i data-testid="legend">{{ option.id }}</i>
        </ng-template>
      }
    </ui-choice-menu>
  `,
})
class Host {
  options: readonly UiChoiceOption[] = [
    { id: 'ivan', label: 'Иван', avatarSrc: null, testId: 'pick-ivan' },
    { id: 'niko', label: 'Нико', avatarSrc: null, testId: 'pick-niko' },
    { id: 'off', label: 'Изключен', disabled: true, testId: 'pick-off' },
  ];
  readonly selected = signal<string | null>('ivan');
  readonly open = signal(false);
  legend = false;
  picked: string[] = [];
  toggled: { row: string; id: string }[] = [];
}

async function render(legend = false, options?: readonly UiChoiceOption[]) {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.legend = legend;
  if (options) fixture.componentInstance.options = options;
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, host, q };
}

describe('UiChoiceMenu', () => {
  it('is a menu of segmented rows: radio items, a portrait, and one accent check', async () => {
    const { q, host } = await render();
    const ivan = q('pick-ivan');
    expect(ivan?.getAttribute('role')).toBe('menuitemradio');
    expect(ivan?.getAttribute('aria-checked')).toBe('true');
    expect(q('pick-niko')?.getAttribute('aria-checked')).toBe('false');
    expect(ivan?.classList.contains('ui-list-row')).toBe(true);
    expect(ivan?.closest('ui-list-group')).not.toBeNull();
    expect(ivan?.querySelector('ui-avatar')).not.toBeNull();
    // Exactly one check, on the chosen row.
    expect(host.querySelectorAll('[data-name="checklist.done"]').length).toBe(
      1,
    );
    expect(ivan?.querySelector('[data-name="checklist.done"]')).not.toBeNull();
    expect((q('pick-off') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens from the projected trigger, and a pick reports the id and closes', async () => {
    const { fixture, q } = await render();
    const menu = q('trigger')?.closest('ui-menu');
    expect(menu?.hasAttribute('data-open')).toBe(false);
    q('trigger')?.click();
    fixture.detectChanges();
    expect(menu?.hasAttribute('data-open')).toBe(true);
    q('pick-niko')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['niko']);
    expect(fixture.componentInstance.open()).toBe(false);
    expect(menu?.hasAttribute('data-open')).toBe(false);
    expect(q('pick-niko')?.getAttribute('aria-checked')).toBe('true');
  });

  it("takes the consumer's own leading rail over the portrait", async () => {
    const { q } = await render(true);
    expect(q('pick-ivan')?.querySelector('ui-avatar')).toBeNull();
    expect(
      q('pick-ivan')?.querySelector('[data-testid="legend"]')?.textContent,
    ).toBe('ivan');
  });

  it('states a detail at the trailing edge, muted on every row, and keeps the check column beside it', async () => {
    const { fixture, q } = await render(false, [
      { id: 'none', label: 'Няма', testId: 'pick-none' },
      { id: '5', label: '5%', detail: '1,40 €', testId: 'pick-5' },
      { id: '10', label: '10%', detail: '2,80 €', testId: 'pick-10' },
    ]);
    fixture.componentInstance.selected.set('10');
    fixture.detectChanges();
    const five = q('pick-5');
    const ten = q('pick-10');
    const detail = five?.querySelector('.ui-choice-menu__detail');
    expect(detail?.textContent?.trim()).toBe('1,40 €');
    expect(detail?.closest('[uitrailing]')).not.toBeNull();
    expect(detail?.getAttribute('data-foreground-style')).toBe('secondary');
    // The label is the label alone — the detail never folds into it.
    expect(five?.textContent).not.toContain('5% · 1,40');
    // The chosen row: the detail still muted, the accent check after it.
    expect(
      ten
        ?.querySelector('.ui-choice-menu__detail')
        ?.getAttribute('data-foreground-style'),
    ).toBe('secondary');
    expect(
      ten?.querySelector(
        'ui-icon[data-name="checklist.done"]:not(.ui-choice-menu__check-space)',
      ),
    ).not.toBeNull();
    // An unchosen row with a detail keeps the check's column empty…
    expect(five?.querySelector('.ui-choice-menu__check-space')).not.toBeNull();
    // …and a row without one reserves nothing.
    expect(
      q('pick-none')?.querySelector('.ui-choice-menu__check-space'),
    ).toBeNull();
  });
  it('parts the options into captioned sections at each change of group, each its own run', async () => {
    const { host } = await render(false, [
      {
        id: 'shop',
        label: 'Всички салони',
        group: 'Салони',
        testId: 'pick-shop',
      },
      { id: 'loc', label: 'Център', group: 'Салони', testId: 'pick-loc' },
      {
        id: 'ivan',
        label: 'Иван',
        avatarSrc: null,
        group: 'Екип',
        testId: 'pick-ivan',
      },
    ]);
    const groups = Array.from(host.querySelectorAll('ui-list-group'));
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Салони',
      'Екип',
    ]);
    expect(groups.map((group) => group.getAttribute('role'))).toEqual([
      'group',
      'group',
    ]);
    expect(
      groups.map((group) => group.querySelectorAll('[uiMenuItem]').length),
    ).toEqual([2, 1]);
    expect(
      Array.from(host.querySelectorAll('.ui-choice-menu__section')).map((c) =>
        c.textContent?.trim(),
      ),
    ).toEqual(['Салони', 'Екип']);
  });

  it('keeps one run with no caption when no option names a group', async () => {
    const { host } = await render();
    expect(host.querySelectorAll('ui-list-group')).toHaveLength(1);
    expect(host.querySelector('.ui-choice-menu__section')).toBeNull();
    expect(host.querySelector('ui-list-group')?.hasAttribute('role')).toBe(
      false,
    );
  });

  it('states a description under the label when an option carries one', async () => {
    const { q } = await render(false, [
      {
        id: 'code',
        label: 'Код',
        description: 'Промо код или ваучер',
        testId: 'pick-code',
      },
      { id: 'pct', label: 'Процент', testId: 'pick-pct' },
    ]);
    const code = q('pick-code');
    const description = code?.querySelector('.ui-choice-menu__description');
    expect(description?.textContent?.trim()).toBe('Промо код или ваучер');
    expect(description?.getAttribute('data-foreground-style')).toBe(
      'secondary',
    );
    expect(
      code?.querySelector('.ui-choice-menu__lines')?.textContent,
    ).toContain('Код');
    // Without one, the label stands alone.
    expect(
      q('pick-pct')?.querySelector('.ui-choice-menu__description'),
    ).toBeNull();
  });

  it('a row with a submenu: its own pick, then a chevron that opens tick boxes in its place — a toggle keeps the menu up, back returns', async () => {
    const options: readonly UiChoiceOption[] = [
      {
        id: 'team',
        label: 'Целият екип',
        icon: 'nav.team',
        selected: true,
        testId: 'team',
        childrenTitle: 'Екип',
        openLabel: 'Избери бръснари',
        openTestId: 'team-open',
        children: [
          { id: 'ivan', label: 'Иван', checked: true, testId: 'box-ivan' },
          { id: 'niko', label: 'Нико', checked: false, testId: 'box-niko' },
        ],
      },
    ];
    const { fixture, q } = await render(false, options);
    q('trigger')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const row = q('team');
    expect(row?.getAttribute('role')).toBe('menuitemradio');
    expect(row?.getAttribute('aria-checked')).toBe('true');
    const open = q('team-open');
    expect(open?.getAttribute('aria-label')).toBe('Избери бръснари');
    expect(open?.getAttribute('aria-haspopup')).toBe('menu');

    open?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(q('team')).toBeNull();
    expect(q('team-open-back')?.textContent).toContain('Екип');
    const ivan = q('box-ivan');
    expect(ivan?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(ivan?.getAttribute('aria-checked')).toBe('true');
    expect(q('box-niko')?.getAttribute('aria-checked')).toBe('false');

    q('box-niko')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.toggled).toEqual([
      { row: 'team', id: 'niko' },
    ]);
    expect(fixture.componentInstance.open()).toBe(true);

    q('team-open-back')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(q('team')).not.toBeNull();

    // The main part of the row picks it, and closes.
    q('team')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['team']);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('opens on the top level again after it closed on a submenu', async () => {
    const options: readonly UiChoiceOption[] = [
      {
        id: 'team',
        label: 'Целият екип',
        testId: 'team',
        openTestId: 'team-open',
        children: [{ id: 'ivan', label: 'Иван', checked: true }],
      },
    ];
    const { fixture, q } = await render(false, options);
    q('trigger')?.click();
    fixture.detectChanges();
    q('team-open')?.click();
    fixture.detectChanges();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(q('team')).not.toBeNull();
  });
});
