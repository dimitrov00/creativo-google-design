import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiAlert, type UiAlertAction } from './alert';

@Component({
  imports: [UiAlert],
  template: `
    <ui-alert
      [uiPresented]="presented()"
      uiTitle="Отхвърли промените?"
      uiMessage="Промените по този час не са запазени."
      [uiActions]="actions()"
      (uiPicked)="picked.push($event)"
      (uiDismissed)="dismissed = dismissed + 1"
    />
  `,
})
class Host {
  readonly presented = signal(false);
  readonly actions = signal<readonly UiAlertAction[]>([
    {
      id: 'discard',
      label: 'Отхвърли',
      role: 'destructive',
      testId: 'discard',
    },
    {
      id: 'keep',
      label: 'Продължи редакцията',
      role: 'cancel',
      preferred: true,
      testId: 'keep',
    },
  ]);
  readonly picked: string[] = [];
  dismissed = 0;
}

describe('UiAlert', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  const dialog = () =>
    fixture.nativeElement.querySelector('dialog') as HTMLDialogElement | null;
  const labels = () =>
    [...(dialog()?.querySelectorAll('.ui-alert__action') ?? [])].map((b) =>
      b.textContent?.trim(),
    );

  it('is nothing until presented, then an open alert dialog naming its question', async () => {
    expect(dialog()).toBeNull();
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el?.getAttribute('role')).toBe('alertdialog');
    expect(el?.hasAttribute('open')).toBe(true);
    const title = el?.querySelector('.ui-alert__title');
    expect(title?.textContent?.trim()).toBe('Отхвърли промените?');
    expect(el?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(el?.querySelector('.ui-alert__message')?.textContent?.trim()).toBe(
      'Промените по този час не са запазени.',
    );
  });

  // A long answer stacks the pair, and the safe answer closes the stack —
  // the platform's own order; two short answers share a row, the safe one
  // leading.
  it('stacks long answers with cancel last, and rows short ones with cancel first', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      dialog()
        ?.querySelector('.ui-alert__actions')
        ?.getAttribute('data-layout'),
    ).toBe('stacked');
    expect(labels()).toEqual(['Отхвърли', 'Продължи редакцията']);

    fixture.componentInstance.actions.set([
      { id: 'delete', label: 'Изтрий', role: 'destructive' },
      { id: 'cancel', label: 'Отказ', role: 'cancel', preferred: true },
    ]);
    fixture.detectChanges();
    expect(
      dialog()
        ?.querySelector('.ui-alert__actions')
        ?.getAttribute('data-layout'),
    ).toBe('row');
    expect(labels()).toEqual(['Отказ', 'Изтрий']);
    const cancel = dialog()?.querySelector('.ui-alert__action');
    expect(cancel?.hasAttribute('data-preferred')).toBe(true);
    expect(
      dialog()
        ?.querySelectorAll('.ui-alert__action')[1]
        ?.getAttribute('data-role'),
    ).toBe('destructive');
  });

  it('reports the answer pressed, and Escape as a dismissal', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    (dialog()?.querySelector('[data-testid="discard"]') as HTMLElement).click();
    expect(fixture.componentInstance.picked).toEqual(['discard']);
    const cancel = new Event('cancel', { cancelable: true });
    dialog()?.dispatchEvent(cancel);
    expect(fixture.componentInstance.dismissed).toBe(1);
    // The exit is the alert's own; the platform's close is refused.
    expect(cancel.defaultPrevented).toBe(true);
  });

  it('gives the preferred answer on Return at the surface, and keeps Escape to itself', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const surface = dialog()?.querySelector(
      '.ui-alert__surface',
    ) as HTMLElement;
    surface.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(fixture.componentInstance.picked).toEqual(['keep']);
    // A sheet the alert was declared inside must never hear its Escape.
    let reached = false;
    fixture.nativeElement.addEventListener('keydown', () => (reached = true));
    dialog()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(reached).toBe(false);
  });

  it('leaves when no longer presented', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.presented.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dialog()).toBeNull();
  });
});
