import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiCheckList, type UiCheckOption } from './check-list';

/*
 * The check list: a head row that stands for every option — checked, mixed
 * or empty — and one row per option; data in, the chosen ids out in the
 * options' order.
 */

@Component({
  imports: [UiCheckList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-check-list
      [uiOptions]="options"
      [uiSelectedIds]="selected()"
      [uiDisabled]="disabled()"
      [uiInvalid]="invalid()"
      [uiSummary]="summary()"
      uiAllLabel="All shops"
      uiLabel="Shops"
      uiAllTestId="all"
      (uiSelectedIdsChange)="picks.push($event); selected.set($event)"
    />
  `,
})
class Host {
  readonly options: readonly UiCheckOption[] = [
    { id: 'a', label: 'Center', testId: 'a' },
    { id: 'b', label: 'Mladost', testId: 'b', detail: 'bul. 1' },
    { id: 'c', label: 'Old Town', testId: 'c' },
  ];
  readonly selected = signal<readonly string[]>([]);
  readonly disabled = signal(false);
  readonly invalid = signal(false);
  readonly summary = signal<string | null>(null);
  readonly picks: (readonly string[])[] = [];
}

describe('ui-check-list', () => {
  let fixture: ComponentFixture<Host>;
  let host: HTMLElement;
  const row = (id: string) =>
    host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const checked = (id: string) => row(id)?.getAttribute('aria-checked');
  const mark = (id: string) =>
    row(id)?.querySelector('.ui-check-list__mark')?.getAttribute('data-state');
  const tap = (id: string) => {
    row(id)?.click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('is a named group of checkboxes: the head, then one per option with its detail', () => {
    const group = host.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Shops');
    expect(
      Array.from(host.querySelectorAll('[role="checkbox"]'), (each) =>
        each.querySelector('.ui-check-list__label')?.textContent?.trim(),
      ),
    ).toEqual(['All shops', 'Center', 'Mladost', 'Old Town']);
    expect(
      row('b')?.querySelector('.ui-check-list__detail')?.textContent?.trim(),
    ).toBe('bul. 1');
    expect(checked('all')).toBe('false');
  });

  it('shows the head mixed while some are chosen and checked once all are, reporting ids in list order', () => {
    tap('c');
    expect(fixture.componentInstance.picks.at(-1)).toEqual(['c']);
    expect(checked('all')).toBe('mixed');
    expect(mark('all')).toBe('MIXED');
    expect(mark('c')).toBe('ON');

    tap('a');
    expect(fixture.componentInstance.picks.at(-1)).toEqual(['a', 'c']);

    tap('b');
    expect(fixture.componentInstance.picks.at(-1)).toEqual(['a', 'b', 'c']);
    expect(checked('all')).toBe('true');
    expect(mark('all')).toBe('ON');

    tap('a');
    expect(fixture.componentInstance.picks.at(-1)).toEqual(['b', 'c']);
    expect(checked('a')).toBe('false');
  });

  it('chooses everything from the head, and clears everything when everything is chosen', () => {
    tap('b');
    tap('all');
    expect(fixture.componentInstance.picks.at(-1)).toEqual(['a', 'b', 'c']);

    tap('all');
    expect(fixture.componentInstance.picks.at(-1)).toEqual([]);
    expect(checked('all')).toBe('false');
    expect(['a', 'b', 'c'].map(checked)).toEqual(['false', 'false', 'false']);
  });

  it('ignores a chosen id no option holds', () => {
    fixture.componentInstance.selected.set(['a', 'gone']);
    fixture.detectChanges();
    expect(checked('all')).toBe('mixed');
    tap('b');
    expect(fixture.componentInstance.picks.at(-1)).toEqual(['a', 'b']);
  });

  it('prints a summary on the head, marks itself invalid, and answers nothing while disabled', () => {
    fixture.componentInstance.summary.set('1 of 3');
    fixture.componentInstance.invalid.set(true);
    fixture.detectChanges();
    expect(row('all')?.textContent).toContain('1 of 3');
    expect(
      host.querySelector('ui-check-list')?.hasAttribute('data-invalid'),
    ).toBe(true);

    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    tap('a');
    tap('all');
    expect(fixture.componentInstance.picks).toEqual([]);
  });
});
