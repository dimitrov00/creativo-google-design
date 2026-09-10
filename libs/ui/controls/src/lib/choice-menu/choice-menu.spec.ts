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
});
