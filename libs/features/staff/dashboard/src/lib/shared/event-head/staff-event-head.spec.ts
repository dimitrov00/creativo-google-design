import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  StaffEventHead,
  type StaffEventLine,
  hollowStatus,
} from './staff-event-head';

@Component({
  imports: [StaffEventHead],
  template: `
    <lib-staff-event-head
      [size]="size()"
      title="Георги Петров"
      [lines]="lines()"
      [inline]="inline()"
      [start]="start()"
      [end]="end()"
      [gloss]="gloss()"
      [glossState]="glossState()"
      [timesDecorative]="decorative()"
      [struck]="struck()"
      [receded]="receded()"
      timesTestId="times"
    />
  `,
})
class Host {
  readonly size = signal<'compact' | 'regular'>('regular');
  readonly lines = signal<readonly StaffEventLine[]>([
    { text: 'georgi@test.local', icon: 'contact.email', testId: 'email' },
    { text: 'Фейд' },
  ]);
  readonly inline = signal(false);
  readonly start = signal<string | null>('10:00');
  readonly end = signal<string | null>('10:45');
  readonly gloss = signal<string | null>('след 2 ч');
  readonly glossState = signal(false);
  readonly decorative = signal(false);
  readonly struck = signal(false);
  readonly receded = signal(false);
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const text = (sel: string) =>
    q(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  return { fixture, host, q, text };
}

describe('StaffEventHead', () => {
  it('sets the words on the left and the clock on the right, stamped with its density', async () => {
    const { q, text } = await render();
    expect(q('.staff-event-head')?.getAttribute('data-size')).toBe('regular');
    expect(text('.staff-event-head__title')).toBe('Георги Петров');
    const lines = [
      ...(q('.staff-event-head__lines')?.querySelectorAll(
        '.staff-event-head__line',
      ) ?? []),
    ];
    expect(
      lines.map((line) =>
        line.querySelector('.staff-event-head__text')?.textContent?.trim(),
      ),
    ).toEqual(['georgi@test.local', 'Фейд']);
    // The glyph leads only the line that asked for one, and never speaks.
    expect(
      lines[0]?.querySelector('ui-icon')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(lines[1]?.querySelector('ui-icon')).toBeNull();
    expect(lines[0]?.getAttribute('data-testid')).toBe('email');
    const times = q('.staff-event-head__times');
    expect(times?.getAttribute('data-testid')).toBe('times');
    expect(times?.getAttribute('aria-hidden')).toBeNull();
    expect(text('.staff-event-head__start')).toBe('10:00');
    expect(text('.staff-event-head__end')).toBe('10:45');
    expect(text('.staff-event-head__gloss')).toBe('след 2 ч');
  });

  it('rides the first line on the title for a block too short for two, and withholds a clock it was not given', async () => {
    const { fixture, q, text } = await render();
    fixture.componentInstance.size.set('compact');
    fixture.componentInstance.inline.set(true);
    fixture.componentInstance.end.set(null);
    fixture.componentInstance.gloss.set(null);
    fixture.componentInstance.decorative.set(true);
    fixture.detectChanges();
    expect(q('.staff-event-head')?.getAttribute('data-size')).toBe('compact');
    expect(text('.staff-event-head__title')).toBe(
      'Георги Петров · georgi@test.local',
    );
    expect(q('.staff-event-head__sep')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(text('.staff-event-head__inline')).toBe('georgi@test.local');
    // The line that moved up is not also stacked; the next one still is.
    expect(
      [
        ...(q('.staff-event-head__lines')?.querySelectorAll(
          '.staff-event-head__line',
        ) ?? []),
      ].length,
    ).toBe(1);
    expect(text('.staff-event-head__line')).toBe('Фейд');
    // A decorative clock is hidden from a reader — the host's name has the times.
    expect(q('.staff-event-head__times')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(text('.staff-event-head__start')).toBe('10:00');
    expect(q('.staff-event-head__end')).toBeNull();
    expect(q('.staff-event-head__gloss')).toBeNull();
    // No clock at all when there is nothing to say on the right.
    fixture.componentInstance.start.set(null);
    fixture.detectChanges();
    expect(q('.staff-event-head__times')).toBeNull();
  });

  /*
   * The states are the head's own, from INPUTS — never a host's rule
   * reaching in: the agenda's stylesheet is view-scoped, and its rule for
   * a struck title could not match a title in this view, so the no-show
   * silently lost its strike (2026-09-17).
   */
  it('stamps the states its hosts pass — struck for an hour that did not happen, receded for a past one', async () => {
    const { fixture, q } = await render();
    const head = q('.staff-event-head')!;
    expect(head.hasAttribute('data-struck')).toBe(false);
    expect(head.hasAttribute('data-receded')).toBe(false);
    fixture.componentInstance.struck.set(true);
    fixture.componentInstance.receded.set(true);
    fixture.detectChanges();
    expect(head.hasAttribute('data-struck')).toBe(true);
    expect(head.hasAttribute('data-receded')).toBe(true);
    // The predicate the hosts share: both hollow outcomes, nothing else.
    expect(hollowStatus('cancelled')).toBe(true);
    expect(hollowStatus('no_show')).toBe(true);
    expect(hollowStatus('completed')).toBe(false);
    expect(hollowStatus('confirmed')).toBe(false);
  });
  // An hour that did not happen says so where the countdown stood
  // (owner, 2026-09-24): the gloss names a state and outranks the clock.
  it('marks a gloss that names a state, so it can outrank the clock', async () => {
    const { fixture, q } = await render();
    const host = q('lib-staff-event-head') as HTMLElement;
    expect(host.hasAttribute('data-gloss-state')).toBe(false);
    expect(host.querySelector('[data-testid="staff-event-state"]')).toBeNull();
    fixture.componentInstance.gloss.set('Отказан');
    fixture.componentInstance.glossState.set(true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-gloss-state')).toBe(true);
    expect(
      host.querySelector('[data-testid="staff-event-state"]')?.textContent,
    ).toBe('Отказан');
  });
});
