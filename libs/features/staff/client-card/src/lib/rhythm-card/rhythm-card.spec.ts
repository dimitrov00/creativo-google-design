import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { UiStreakPeriod } from '@creativo/ui/controls';
import { must } from '../../testing/client-card.fixtures';
import { WALLET_RHYTHM } from '../../testing/client-pages.vm-fixtures';
import { cssRule } from '../../testing/css-rule';
import type { WalletRhythmVm } from '../client-pages.vm';
import { RhythmCard } from './rhythm-card';

@Component({
  imports: [RhythmCard],
  template: `<lib-rhythm-card [vm]="vm()" ruleMoreLabel="Цялото правило" />`,
})
class Host {
  readonly vm = signal<WalletRhythmVm>(WALLET_RHYTHM.healthy);
}

function mount(vm: WalletRhythmVm = WALLET_RHYTHM.healthy) {
  // A case may mount twice (two states side by side): a fresh module each time.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, byId, text };
}

/** Ten kept months, newest last: more than the widest column draws. */
function tenPeriods(): readonly UiStreakPeriod[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `2026-${String(i + 1).padStart(2, '0')}`,
    mark: 'kept' as const,
    caption: `м${i + 1}`,
    description: `месец ${i + 1}`,
  }));
}

describe('lib-rhythm-card — the run, the track, the rule', () => {
  it('prints the run as the figure with its unit beside it, on a white elevated card, and no capsule while the phase is healthy', () => {
    const { host, byId, text } = mount();
    const card = must(host.querySelector('ui-card'));
    expect(card.getAttribute('data-tone')).toBe('elevated');
    expect(byId('rewards-rhythm')).toBe(host.firstElementChild);
    const figure = must(byId('rewards-rhythm-figure'));
    expect(text(figure)).toBe('9');
    expect(figure.getAttribute('data-font')).toBe('title2');
    // Primary ink: no foreground style on the figure, no accent word.
    expect(figure.hasAttribute('data-foreground-style')).toBe(false);
    const unit = must(figure.nextElementSibling);
    expect(text(unit)).toBe('посещения в ритъм');
    expect(unit.getAttribute('data-font')).toBe('callout');
    expect(unit.getAttribute('data-foreground-style')).toBe('secondary');
    expect(byId('rewards-rhythm-phase')).toBeNull();
    // The figure is said ONCE outside the track: the track's own metric is
    // in the DOM (its sentence is on it) and the card's sheet hides it.
    const outsideTrack = [...host.querySelectorAll('ui-card > * > *')]
      .filter((part) => part.tagName !== 'UI-STREAK-TRACK')
      .map((part) => text(part))
      .join(' ');
    expect(outsideTrack.match(/\b9\b/g)).toHaveLength(1);
  });

  it('draws the track with the marks the presenter gave it, named by its one sentence, its own metric hidden by the stylesheet', () => {
    const { byId, text } = mount();
    const track = must(byId('rewards-rhythm-track'));
    expect(track.tagName).toBe('UI-STREAK-TRACK');
    expect(track.getAttribute('data-control-size')).toBe('regular');
    expect(track.querySelectorAll('.ui-streak-track__period')).toHaveLength(6);
    expect(
      track
        .querySelector('.ui-streak-track__figure')
        ?.getAttribute('aria-label'),
    ).toBe(WALLET_RHYTHM.healthy.trackName);
    // The count still reaches the track (its metric is in the DOM) …
    expect(track.querySelector('.ui-metric')).not.toBeNull();
    // … and the card's sheet is what keeps it from printing twice.
    expect(
      cssRule(
        'rhythm-card/rhythm-card.css',
        '.rhythm-card__track > .ui-streak-track__figure > .ui-metric',
      ),
    ).toEqual(new Map([['display', 'none']]));
    expect(text(byId('rewards-rhythm-state'))).toBe(
      'Следващото посещение до 10.11 пази ритъма.',
    );
    expect(byId('rewards-rhythm-state')?.getAttribute('data-font')).toBe(
      'callout',
    );
  });

  it('keeps the newest eight marks when the run is longer', () => {
    const { byId } = mount({
      ...WALLET_RHYTHM.healthy,
      periods: tenPeriods(),
    });
    const periods = must(byId('rewards-rhythm-track')).querySelectorAll(
      '.ui-streak-track__period',
    );
    expect(periods).toHaveLength(8);
    expect(periods[0]?.textContent?.trim()).toBe('м3');
    expect(periods[7]?.textContent?.trim()).toBe('м10');
  });

  it('says the best run and the protections banked as one quiet line, and nothing when there is nothing to say', () => {
    const { byId, text } = mount();
    const best = must(byId('rewards-rhythm-best'));
    expect(text(best)).toBe('Най-много: 23');
    expect(text(byId('rewards-rhythm-protections'))).toBe(
      'Автоматични защити: 2',
    );
    const line = must(best.parentElement);
    expect(line.getAttribute('data-font')).toBe('footnote');
    expect(line.getAttribute('data-foreground-style')).toBe('secondary');
    expect(text(line)).toBe('Най-много: 23 · Автоматични защити: 2');

    const first = mount(WALLET_RHYTHM.first);
    expect(first.byId('rewards-rhythm-best')).toBeNull();
    expect(first.byId('rewards-rhythm-protections')).toBeNull();
    expect(first.host.querySelector('.rhythm-card__facts')).toBeNull();
    expect(first.text(first.byId('rewards-rhythm-figure'))).toBe('1');
  });

  it('stands the phase capsule beside the figure only when the phase is not healthy, in the presenter’s tone', () => {
    const atRisk = mount(WALLET_RHYTHM.atRisk);
    const capsule = must(atRisk.byId('rewards-rhythm-phase'));
    expect(capsule.tagName).toBe('SPAN');
    expect(capsule.classList).toContain('ui-badge');
    expect(capsule.getAttribute('data-tone')).toBe('warning');
    expect(atRisk.text(capsule)).toBe('До 10.11');
    expect(capsule.parentElement).toBe(
      atRisk.byId('rewards-rhythm-figure')?.parentElement,
    );
    expect(atRisk.text(atRisk.byId('rewards-rhythm-rule-upcoming'))).toBe(
      'От 1.10: На всеки 5 седмици · 7 дни гратис',
    );

    const held = mount(WALLET_RHYTHM.held);
    expect(held.byId('rewards-rhythm-phase')?.getAttribute('data-tone')).toBe(
      'neutral',
    );
    expect(held.text(held.byId('rewards-rhythm-phase'))).toBe(
      'Записан за 29.10',
    );
    expect(held.byId('rewards-rhythm-rule-upcoming')).toBeNull();
  });

  it('closes on the rule as one line, a small plain button named by the line and its verb, that unfolds the whole rule in place', () => {
    const { fixture, byId, text } = mount();
    const rule = must(byId<HTMLButtonElement>('rewards-rhythm-rule'));
    expect(rule.tagName).toBe('BUTTON');
    expect(rule.getAttribute('type')).toBe('button');
    expect(rule.getAttribute('data-button-style')).toBe('plain');
    expect(rule.getAttribute('data-control-size')).toBe('small');
    expect(text(rule)).toBe('На всеки 6 седмици · 7 дни гратис');
    expect(rule.getAttribute('aria-label')).toBe(
      'На всеки 6 седмици · 7 дни гратис · Цялото правило',
    );
    expect(rule.getAttribute('aria-expanded')).toBe('false');
    expect(rule.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'field.expand',
    );
    expect(byId('rewards-rhythm-rule-full')).toBeNull();

    rule.click();
    fixture.detectChanges();
    const full = must(byId('rewards-rhythm-rule-full'));
    expect(rule.getAttribute('aria-expanded')).toBe('true');
    expect(full.tagName).toBe('UL');
    expect(full.getAttribute('data-font')).toBe('footnote');
    expect([...full.querySelectorAll('li')].map((item) => text(item))).toEqual([
      ...WALLET_RHYTHM.healthy.ruleFull,
    ]);

    rule.click();
    fixture.detectChanges();
    expect(byId('rewards-rhythm-rule-full')).toBeNull();
    expect(rule.getAttribute('aria-expanded')).toBe('false');
  });

  it('draws a paused client’s card frozen: the host and the track say so, the values stay', () => {
    const { host, byId, text } = mount(WALLET_RHYTHM.frozen);
    expect(host.firstElementChild?.hasAttribute('data-frozen')).toBe(true);
    expect(byId('rewards-rhythm-track')?.hasAttribute('data-frozen')).toBe(
      true,
    );
    expect(text(byId('rewards-rhythm-figure'))).toBe('9');
    expect(text(byId('rewards-rhythm-state'))).toBe(
      'Замразено, докато записването е спряно',
    );
    expect(byId('rewards-rhythm-phase')).toBeNull();
  });

  it('reads its stylesheet as a contract: the figure row on one baseline, the rule hugged at the leading edge', () => {
    expect(
      cssRule('rhythm-card/rhythm-card.css', '.rhythm-card__figure'),
    ).toEqual(
      new Map([
        ['display', 'flex'],
        ['flex-wrap', 'wrap'],
        ['align-items', 'baseline'],
        ['column-gap', 'var(--sys-space-compact)'],
        ['row-gap', 'var(--sys-space-tight)'],
      ]),
    );
    expect(
      cssRule('rhythm-card/rhythm-card.css', '.rhythm-card__rule').get(
        'align-self',
      ),
    ).toBe('flex-start');
    expect(
      cssRule('rhythm-card/rhythm-card.css', '.rhythm-card__body').get('gap'),
    ).toBe('var(--sys-space-regular)');
  });
});
