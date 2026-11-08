import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { UiDateFieldParts } from '@creativo/ui/controls';
import type { AnalyticsRangeVm } from '../analytics.vm';
import { AnalyticsRangeSheet } from './analytics-range-sheet';

const WORDS: AnalyticsRangeVm = {
  pillLabel: 'Друг период',
  title: 'Друг период',
  fromLabel: 'От',
  toLabel: 'До',
  dayLabel: 'Ден',
  monthLabel: 'Месец',
  yearLabel: 'Година',
  dayPlaceholder: 'ДД',
  monthPlaceholder: 'ММ',
  yearPlaceholder: 'ГГГГ',
  applyLabel: 'Приложи',
  closeLabel: 'Затвори',
  refusal: 'Въведете двете дати',
  applyEnabled: false,
};

@Component({
  imports: [AnalyticsRangeSheet],
  template: `
    <lib-analytics-range-sheet
      [vm]="vm()"
      [open]="open()"
      [from]="from()"
      [to]="to()"
      (fromChange)="from.set($event)"
      (toChange)="to.set($event)"
      (applied)="applied = applied + 1"
      (closed)="closed = closed + 1"
    />
  `,
})
class Host {
  readonly vm = signal<AnalyticsRangeVm>(WORDS);
  readonly open = signal(true);
  readonly from = signal<UiDateFieldParts | null>(null);
  readonly to = signal<UiDateFieldParts | null>(null);
  applied = 0;
  closed = 0;
}

async function render(): Promise<{
  fixture: ComponentFixture<Host>;
  host: Host;
  root: HTMLElement;
}> {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
  };
}

const byTestId = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(() => TestBed.resetTestingModule());

describe('AnalyticsRangeSheet — two dates and «Приложи»', () => {
  it('prints the two fields, the refusal, and keeps «Приложи» off while the store refuses', async () => {
    const { root } = await render();
    expect(byTestId(root, 'analytics-range-from')).not.toBeNull();
    expect(byTestId(root, 'analytics-range-to')).not.toBeNull();
    expect(byTestId(root, 'analytics-range-refusal')?.textContent?.trim()).toBe(
      'Въведете двете дати',
    );
    const apply = byTestId(root, 'analytics-range-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.textContent?.trim()).toBe('Приложи');
  });

  it('applies once the store admits the range, then starts its own exit', async () => {
    const { fixture, host, root } = await render();
    host.vm.set({ ...WORDS, refusal: null, applyEnabled: true });
    fixture.detectChanges();
    const apply = byTestId(root, 'analytics-range-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    expect(byTestId(root, 'analytics-range-refusal')?.textContent?.trim()).toBe(
      '',
    );
    apply.click();
    fixture.detectChanges();
    expect(host.applied).toBe(1);
    // The exit is two-phase: the owner hears `closed` only once it finished.
    expect(host.closed).toBe(0);
  });
});
