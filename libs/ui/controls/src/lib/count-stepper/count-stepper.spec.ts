import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiCountStepper } from './count-stepper';

@Component({
  imports: [UiCountStepper],
  template: `
    <ui-count-stepper
      [uiValue]="value()"
      uiLabel="Фейд"
      uiAddLabel="Добави"
      uiRemoveLabel="Премахни"
      (uiValueChange)="value.set($event); seen.push($event)"
    />
  `,
})
class Host {
  readonly value = signal(0);
  seen: number[] = [];
}

async function render(value = 0) {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.value.set(value);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    q: (sel: string) => host.querySelector<HTMLElement>(sel),
  };
}

describe('UiCountStepper', () => {
  it('is one square at zero, that names the thing it adds', async () => {
    const { q, host } = await render();
    expect(q('.ui-count-stepper__add')?.getAttribute('aria-label')).toBe(
      'Добави Фейд',
    );
    expect(host.querySelector('.ui-count-stepper__group')).toBeNull();
  });

  it('turns to a check on the first press, then opens into − n +', async () => {
    const { fixture, q, host } = await render();
    q('.ui-count-stepper__add')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.seen).toEqual([1]);
    // The beat: still the square, now added.
    expect(q('.ui-count-stepper__add')?.hasAttribute('data-added')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    fixture.detectChanges();
    expect(host.querySelector('.ui-count-stepper__add')).toBeNull();
    expect(q('.ui-count-stepper__count')?.textContent?.trim()).toBe('1');
    expect(q('.ui-count-stepper__group')?.getAttribute('aria-label')).toBe(
      'Фейд',
    );
  });

  it('counts up and down, and folds back into the square at zero', async () => {
    const { fixture, q, host } = await render(2);
    const steps = host.querySelectorAll<HTMLButtonElement>(
      '.ui-count-stepper__step',
    );
    steps[1]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.seen).toEqual([3]);
    steps[0]?.click();
    fixture.detectChanges();
    steps[0]?.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('.ui-count-stepper__step')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.seen).toEqual([3, 2, 1, 0]);
    expect(q('.ui-count-stepper__add')).not.toBeNull();
  });
});
