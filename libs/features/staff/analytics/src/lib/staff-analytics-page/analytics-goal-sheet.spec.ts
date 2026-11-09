import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalyticsGoalSheetVm } from '../analytics.vm';
import { AnalyticsGoalSheet } from './analytics-goal-sheet';

const WORDS: AnalyticsGoalSheetVm = {
  title: 'Цел за месеца',
  lowLabel: 'Долна граница',
  highLabel: 'Горна граница',
  decreaseLabel: 'По-малко',
  increaseLabel: 'Повече',
  unit: '€',
  saveLabel: 'Запази',
  closeLabel: 'Затвори',
  refusal: 'Въведете двете суми',
  saveEnabled: false,
  saving: false,
};

@Component({
  imports: [AnalyticsGoalSheet],
  template: `
    <lib-analytics-goal-sheet
      [vm]="vm()"
      [open]="open()"
      [low]="low()"
      [high]="high()"
      (lowChange)="low.set($event)"
      (highChange)="high.set($event)"
      (saved)="saved = saved + 1"
      (closed)="closed = closed + 1"
    />
  `,
})
class Host {
  readonly vm = signal<AnalyticsGoalSheetVm>(WORDS);
  readonly open = signal(true);
  readonly low = signal<number | null>(null);
  readonly high = signal<number | null>(null);
  saved = 0;
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

describe('AnalyticsGoalSheet — two sums and «Запази»', () => {
  it('prints the two fields in euro, the refusal, and keeps «Запази» off while the store refuses', async () => {
    const { root } = await render();
    const low = byTestId(root, 'analytics-goal-low') as HTMLInputElement;
    const high = byTestId(root, 'analytics-goal-high') as HTMLInputElement;
    expect(low.getAttribute('aria-label')).toBe('Долна граница');
    expect(high.getAttribute('aria-label')).toBe('Горна граница');
    expect(byTestId(root, 'analytics-goal-refusal')?.textContent?.trim()).toBe(
      'Въведете двете суми',
    );
    const save = byTestId(root, 'analytics-goal-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent?.trim()).toBe('Запази');
  });

  it('hands a typed sum up in cents, and asks the owner to save once the store admits the range', async () => {
    const { fixture, host, root } = await render();
    const low = byTestId(root, 'analytics-goal-low') as HTMLInputElement;
    low.value = '1800';
    low.dispatchEvent(new Event('input'));
    low.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(host.low()).toBe(180_000);

    host.vm.set({ ...WORDS, refusal: null, saveEnabled: true });
    fixture.detectChanges();
    const save = byTestId(root, 'analytics-goal-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    fixture.detectChanges();
    expect(host.saved).toBe(1);
    // The save is the owner's; the sheet stays up until `open` falls.
    expect(
      byTestId(root, 'analytics-goal-sheet')?.getAttribute('data-state'),
    ).toBe('open');
  });

  it('shows the save under way, and a failed one in words', async () => {
    const { fixture, host, root } = await render();
    host.vm.set({ ...WORDS, refusal: null, saveEnabled: false, saving: true });
    fixture.detectChanges();
    const save = byTestId(root, 'analytics-goal-save') as HTMLButtonElement;
    expect(save.getAttribute('data-state')).toBe('loading');
    expect(save.disabled).toBe(true);
    host.vm.set({
      ...WORDS,
      refusal: 'Целта не се записа. Опитай пак.',
      saveEnabled: true,
    });
    fixture.detectChanges();
    expect(byTestId(root, 'analytics-goal-refusal')?.textContent?.trim()).toBe(
      'Целта не се записа. Опитай пак.',
    );
  });

  it('starts its exit when the owner lowers `open`, and reports the exit once it finished', async () => {
    const { fixture, host, root } = await render();
    const sheet = byTestId(root, 'analytics-goal-sheet') as HTMLElement;
    expect(sheet.getAttribute('data-state')).toBe('open');
    host.open.set(false);
    fixture.detectChanges();
    // Two-phase: on its way out, still on screen.
    expect(sheet.getAttribute('data-state')).toBe('closing');
    expect(host.closed).toBe(0);
  });
});
